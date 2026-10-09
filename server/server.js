// Financial Asset Management System — backend
// Run: npm install, then npm start
// Serves a REST API on http://localhost:4000, backed by a PostgreSQL database.
// Point DATABASE_URL at a local Postgres for dev, or a managed instance
// (Neon, Supabase, etc.) to go live — no other code changes needed.

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const { CATEGORY_INFO, sendRawTSPL, buildDocumentLabelTSPL, buildBoxLabelTSPL, buildClientFolderLabelTSPL } = require("./print.js");
const multer = require("multer");
const storage = require("./storage.js");

// The Filing Helper is loaded defensively — if anything about it is broken, the
// register itself (clients, documents, scanning, labels) must still start and work.
let filings = null;
try {
  filings = require("./filings.js");
} catch (err) {
  console.error("Filing Helper failed to load (the rest of the app is unaffected):", err);
}

let kyc = null;
try {
  kyc = require("./kyc.js");
} catch (err) {
  console.error("KYC form failed to load (the rest of the app is unaffected):", err);
}

let vault = null;
try {
  vault = require("./vault.js");
} catch (err) {
  console.error("Document vault failed to load (the rest of the app is unaffected):", err);
}

// Client PDFs/photos of statements — kept modest since these are office
// documents, not media; large uploads almost certainly mean the wrong file.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// In production, set this via an environment variable instead of hardcoding it.
// Every login token is signed with this — treat it like a password.
const JWT_SECRET = process.env.FAMS_JWT_SECRET || "change-this-before-real-use";

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Point it at a Postgres instance, e.g.\n" +
      "  postgres://user:password@host:5432/fams\n" +
      "For local dev, see server/README.md for how to run one."
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Managed providers (Neon, Supabase, RDS, ...) require TLS; a local dev
  // Postgres normally doesn't have a cert to validate, so this is opt-in.
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
  // PGlite (the desktop build's embedded database) only processes one query
  // at a time — pglite-socket doesn't multiplex the way a real Postgres
  // server does, so opening pg's normal pool of concurrent connections
  // against it causes random "Connection terminated unexpectedly" errors
  // under the simultaneous requests a dashboard page load fires off. The
  // Electron shell sets PG_POOL_MAX=1 to force everything through one
  // connection; a real Postgres (cloud/dev) is unaffected since this is
  // undefined there, leaving pg's own default pool size.
  ...(process.env.PG_POOL_MAX ? { max: Number(process.env.PG_POOL_MAX) } : {}),
  // With only one connection in the pool, anything that gets that
  // connection stuck (a hung query, a transaction that never commits or
  // rolls back) blocks every other request indefinitely — including ones
  // completely unrelated to whatever got stuck, since they're all queued
  // behind the same single connection. These bound how long that can last:
  // a query/transaction that doesn't finish in time is killed, freeing the
  // connection back up, instead of the whole app silently hanging forever.
  statement_timeout: 20000,
  idle_in_transaction_session_timeout: 20000,
  connectionTimeoutMillis: 15000,
});

async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);

  // CREATE TABLE IF NOT EXISTS won't update a CHECK constraint on a table
  // that already exists — needed when the status list grows (e.g. adding
  // Struck Off / Not Reachable / Left) after the table was first created.
  await pool.query(`
    ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_status_check;
    ALTER TABLE clients ADD CONSTRAINT clients_status_check CHECK (status IN ('A', 'D', 'ADHOC', 'SO', 'NR', 'L'));
    ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
    ALTER TABLE documents ADD CONSTRAINT documents_category_check CHECK (category IN ('secretarial', 'bookkeeping', 'banking_tax', 'personal'));
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS acra_status TEXT NOT NULL DEFAULT 'Not checked';
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_notes TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS pending_work TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS annual_revenue NUMERIC;
  `);

  if (filings) await filings.initFilingSchema({ dbRun, dbGet });
  if (vault) await vault.initVaultSchema({ dbRun });
  if (kyc) await kyc.initKycSchema({ dbRun });
}

// Small helpers so route handlers read close to the original synchronous
// style (one row / all rows / just run it) instead of raw pool.query calls.
async function dbGet(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0];
}
async function dbAll(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}
async function dbRun(sql, params = []) {
  return pool.query(sql, params);
}

// JDM<YY><MM><category code><sequence> — e.g. JDM2609BK2 is the 2nd
// bookkeeping document logged in Sep 2026. The sequence resets each
// month per category, matching how staff actually think about it
// ("the 2nd time docs came in for bookkeeping this month").
//
// The year is included even though it wasn't in the originally requested
// format (just "JDM09BK2") — without it, the same code would repeat every
// year (Sep 2026's 2nd bookkeeping doc and Sep 2027's would both be
// JDM09BK2), which breaks the one-code-per-document guarantee the scan
// lookup and the UNIQUE constraint on documents.code both depend on.
const CATEGORY_CODE = { secretarial: "SC", bookkeeping: "BK", banking_tax: "BT", personal: "PS" };

// queryAll defaults to a plain pool query, but batch-intake passes one bound
// to a transaction's own client so the scan sees that transaction's own
// not-yet-committed inserts (needed to number items within one box correctly).
async function genCode(category, queryAll = dbAll) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const catCode = CATEGORY_CODE[category] || "XX";
  const prefix = `JDM${yy}${mm}${catCode}`;
  const existing = await queryAll("SELECT code FROM documents WHERE code LIKE $1", [`${prefix}%`]);
  let maxSeq = 0;
  for (const row of existing) {
    const m = row.code.slice(prefix.length).match(/^(\d+)$/);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }
  return `${prefix}${maxSeq + 1}`;
}

const DUPLICATE_CODE_RETRY_ATTEMPTS = 5;

// genCode's next-sequence number is computed by scanning existing codes, not
// a DB sequence, so two requests logging the same category in the same
// month can race and compute the same code. insertWithCode must use
// `ON CONFLICT (code) DO NOTHING RETURNING *` so a collision comes back as
// "no row" instead of throwing — that lets this retry with a freshly
// generated code without aborting an enclosing transaction.
async function genCodeAndInsert(queryAll, category, insertWithCode) {
  for (let attempt = 1; attempt <= DUPLICATE_CODE_RETRY_ATTEMPTS; attempt++) {
    const code = await genCode(category, queryAll);
    const row = await insertWithCode(code);
    if (row) return row;
  }
  throw new Error(`Could not generate a unique document code for "${category}" after ${DUPLICATE_CODE_RETRY_ATTEMPTS} attempts`);
}

// File numbers are assigned by the system, not typed by staff — nobody
// should have to remember which number comes next out of ~150 clients.
async function genClientFileNo() {
  const row = await dbGet("SELECT COUNT(*) AS n FROM clients");
  return `A${Number(row.n) + 1}`;
}

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Authentication ----------

app.post("/api/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await dbGet("SELECT * FROM users WHERE username = $1", [username || ""]);
    const ok = user && bcrypt.compareSync(password || "", user.password_hash);

    await dbRun("INSERT INTO login_log (username, success) VALUES ($1, $2)", [username || "(blank)", ok ? 1 : 0]);

    if (!ok) return res.status(401).json({ error: "Invalid username or password" });

    const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    next(err);
  }
});

// A freshly installed desktop app has an empty database and no login —
// there's no terminal access on the client's machine to run a setup
// script, so the dashboard needs a public way to ask "does this install
// need its first account?" and to create exactly one admin account if so.
app.get("/api/setup-status", async (req, res, next) => {
  try {
    const row = await dbGet("SELECT COUNT(*) AS n FROM users");
    res.json({ needsSetup: Number(row.n) === 0 });
  } catch (err) {
    next(err);
  }
});

app.post("/api/setup", async (req, res, next) => {
  try {
    const row = await dbGet("SELECT COUNT(*) AS n FROM users");
    if (Number(row.n) > 0) {
      return res.status(403).json({ error: "This install already has an account — use the login screen." });
    }
    const { username, password } = req.body;
    if (!username || !String(username).trim() || !password || String(password).length < 8) {
      return res.status(400).json({ error: "Username and an 8+ character password are required" });
    }
    const hash = bcrypt.hashSync(password, 10);
    const user = await dbGet(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') RETURNING *",
      [String(username).trim(), hash]
    );
    const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
    res.status(201).json({ token, username: user.username, role: user.role });
  } catch (err) {
    next(err);
  }
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired — please log in again" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

// Everything below this line requires a valid login.
app.use("/api", requireAuth);

// ---------- Users (admin only — creating logins for staff) ----------

app.get("/api/users", requireAdmin, async (req, res, next) => {
  try {
    res.json(await dbAll("SELECT id, username, role, created_at FROM users ORDER BY username"));
  } catch (err) {
    next(err);
  }
});

app.post("/api/users", requireAdmin, async (req, res, next) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: "username and password are required" });
    const hash = bcrypt.hashSync(password, 10);
    const finalRole = role === "admin" ? "admin" : "staff";
    try {
      const created = await dbGet(
        "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role",
        [username, hash, finalRole]
      );
      res.status(201).json(created);
    } catch {
      res.status(400).json({ error: "Username may already be taken" });
    }
  } catch (err) {
    next(err);
  }
});

// Self-service — any logged-in user can change their OWN password (not
// gated admin-only like creating new logins above). Requires the current
// password, same as changing a password on any normal account.
app.patch("/api/users/me/password", async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "Current password and a new password (8+ characters) are required" });
    }
    const user = await dbGet("SELECT * FROM users WHERE id = $1", [req.user.sub]);
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    await dbRun("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, user.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get("/api/login-log", requireAdmin, async (req, res, next) => {
  try {
    res.json(await dbAll("SELECT * FROM login_log ORDER BY logged_at DESC LIMIT 100"));
  } catch (err) {
    next(err);
  }
});

// ---------- Clients ----------

app.get("/api/clients", async (req, res, next) => {
  try {
    res.json(await dbAll("SELECT * FROM clients ORDER BY company ASC"));
  } catch (err) {
    next(err);
  }
});

app.post("/api/clients", async (req, res, next) => {
  try {
    const { fileNo: explicitFileNo, company, roc, yearEnd, dateInc, registeredAddress, directors, contact, contactPhone, contactEmail, fax, status } = req.body;
    if (!company) return res.status(400).json({ error: "company is required" });
    try {
      // Normally the system assigns the next file number, but a bulk import
      // of pre-existing clients needs to keep whatever's already written on
      // their physical folder — pass an explicit fileNo to preserve it.
      const fileNo = explicitFileNo && String(explicitFileNo).trim() ? String(explicitFileNo).trim() : await genClientFileNo();
      const created = await dbGet(
        `INSERT INTO clients
          (file_no, company, roc, year_end, date_inc, registered_address, directors, contact, contact_phone, contact_email, fax, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          fileNo,
          company,
          roc || null,
          yearEnd || null,
          dateInc || null,
          registeredAddress || null,
          directors || null,
          contact || null,
          contactPhone || null,
          contactEmail || null,
          fax || null,
          status || "A",
        ]
      );
      res.status(201).json(created);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  } catch (err) {
    next(err);
  }
});

// Client particulars are sensitive enough (registered address, directors,
// the one contact number staff actually call) that editing them is admin-only,
// and every changed field is written to client_edit_log below — not just
// "someone edited this" but the actual before/after value and who did it.
// file_no and last_agm_date are deliberately excluded: file_no is assigned
// once by the system, and last_agm_date is only ever set by logging an
// AGM/Annual Return filing, not hand-edited.
const CLIENT_EDITABLE_FIELDS = {
  company: "company",
  roc: "roc",
  yearEnd: "year_end",
  dateInc: "date_inc",
  registeredAddress: "registered_address",
  directors: "directors",
  contact: "contact",
  contactPhone: "contact_phone",
  contactEmail: "contact_email",
  fax: "fax",
  gstRegNo: "gst_reg_no",
  status: "status",
};

app.patch("/api/clients/:id", requireAdmin, async (req, res, next) => {
  try {
    const client = await dbGet("SELECT * FROM clients WHERE id = $1", [req.params.id]);
    if (!client) return res.status(404).json({ error: "Client not found" });

    const updates = [];
    const logEntries = [];
    for (const [bodyKey, column] of Object.entries(CLIENT_EDITABLE_FIELDS)) {
      if (!(bodyKey in req.body)) continue;
      const newValue = req.body[bodyKey] === "" ? null : req.body[bodyKey];
      const oldValue = client[column];
      if (newValue === oldValue) continue;
      updates.push({ column, value: newValue });
      logEntries.push({ field: column, oldValue, newValue });
    }

    if (updates.length === 0) {
      return res.json(client);
    }

    const setClause = updates.map((u, i) => `${u.column} = $${i + 1}`).join(", ");
    const values = updates.map((u) => u.value);
    await dbRun(`UPDATE clients SET ${setClause} WHERE id = $${values.length + 1}`, [...values, req.params.id]);

    for (const entry of logEntries) {
      await dbRun(
        "INSERT INTO client_edit_log (client_id, field, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4, $5)",
        [req.params.id, entry.field, entry.oldValue, entry.newValue, req.user.username]
      );
    }

    const updated = await dbGet("SELECT * FROM clients WHERE id = $1", [req.params.id]);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.get("/api/clients/:id/edit-log", requireAdmin, async (req, res, next) => {
  try {
    const rows = await dbAll("SELECT * FROM client_edit_log WHERE client_id = $1 ORDER BY changed_at DESC", [req.params.id]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Report-page working fields (ACRA status, tax notes, pending work) — quick
// notes any staff member updates day to day, not gated admin-only like the
// core particulars above. Still written to client_edit_log like every other
// client field, so there's a record of who changed what even though anyone
// logged in (not just admins) can make the change.
const REPORT_FIELDS = { acraStatus: "acra_status", taxNotes: "tax_notes", pendingWork: "pending_work", annualRevenue: "annual_revenue" };

app.patch("/api/clients/:id/report-fields", async (req, res, next) => {
  try {
    const client = await dbGet("SELECT * FROM clients WHERE id = $1", [req.params.id]);
    if (!client) return res.status(404).json({ error: "Client not found" });

    const sets = [];
    const params = [];
    const logEntries = [];
    for (const [bodyKey, column] of Object.entries(REPORT_FIELDS)) {
      if (req.body[bodyKey] === undefined) continue;
      const newValue = req.body[bodyKey];
      const oldValue = client[column];
      if (String(newValue ?? "") === String(oldValue ?? "")) continue;
      params.push(newValue);
      sets.push(`${column} = $${params.length}`);
      logEntries.push({ field: column, oldValue, newValue });
    }
    if (sets.length === 0) return res.status(400).json({ error: "No report fields provided" });
    params.push(client.id);
    const updated = await dbGet(`UPDATE clients SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);

    for (const entry of logEntries) {
      await dbRun(
        "INSERT INTO client_edit_log (client_id, field, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4, $5)",
        [client.id, entry.field, entry.oldValue, entry.newValue, req.user.username]
      );
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.post("/api/clients/:id/print-folder-label", async (req, res, next) => {
  try {
    const client = await dbGet("SELECT * FROM clients WHERE id = $1", [req.params.id]);
    if (!client) return res.status(404).json({ error: "Client not found" });
    const tspl = buildClientFolderLabelTSPL({ company: client.company, roc: client.roc, fileNo: client.file_no });
    await sendRawTSPL(tspl);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `Printing failed: ${err.message}` });
  }
});

// ---------- Recurring schedules (CPF, GST, Compilation, etc.) ----------
// The AR/AGM cycle already has its own FYE-driven engine (see
// computeArDeadline on the frontend) — this covers everything else that
// recurs on a schedule but isn't tied to FYE, and varies client to client.

app.get("/api/schedules", async (req, res, next) => {
  try {
    const rows = await dbAll(
      `SELECT client_schedules.*, clients.company AS client_name, clients.file_no AS client_file_no, clients.status AS client_status
       FROM client_schedules JOIN clients ON client_schedules.client_id = clients.id
       WHERE client_schedules.active = 1
       ORDER BY clients.company ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get("/api/clients/:id/schedules", async (req, res, next) => {
  try {
    const rows = await dbAll(
      "SELECT * FROM client_schedules WHERE client_id = $1 AND active = 1 ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.post("/api/clients/:id/schedules", async (req, res, next) => {
  try {
    const client = await dbGet("SELECT id FROM clients WHERE id = $1", [req.params.id]);
    if (!client) return res.status(404).json({ error: "Client not found" });
    const { taskName, frequency, dueDay, dueMonth } = req.body;
    if (!taskName || !frequency || !dueDay) {
      return res.status(400).json({ error: "taskName, frequency, and dueDay are required" });
    }
    if (!["monthly", "quarterly", "yearly"].includes(frequency)) {
      return res.status(400).json({ error: "frequency must be monthly, quarterly, or yearly" });
    }
    if (frequency !== "monthly" && !dueMonth) {
      return res.status(400).json({ error: "dueMonth is required for quarterly/yearly schedules" });
    }
    const created = await dbGet(
      `INSERT INTO client_schedules (client_id, task_name, frequency, due_day, due_month)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [client.id, taskName, frequency, Number(dueDay), dueMonth ? Number(dueMonth) : null]
    );
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

app.patch("/api/schedules/:id", async (req, res, next) => {
  try {
    const schedule = await dbGet("SELECT * FROM client_schedules WHERE id = $1", [req.params.id]);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    const { taskName, frequency, dueDay, dueMonth, lastCompletedDate } = req.body;
    const updated = await dbGet(
      `UPDATE client_schedules SET
        task_name = $1, frequency = $2, due_day = $3, due_month = $4, last_completed_date = $5
       WHERE id = $6 RETURNING *`,
      [
        taskName ?? schedule.task_name,
        frequency ?? schedule.frequency,
        dueDay ? Number(dueDay) : schedule.due_day,
        dueMonth !== undefined ? (dueMonth ? Number(dueMonth) : null) : schedule.due_month,
        lastCompletedDate !== undefined ? lastCompletedDate : schedule.last_completed_date,
        schedule.id,
      ]
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/schedules/:id", async (req, res, next) => {
  try {
    const schedule = await dbGet("SELECT id FROM client_schedules WHERE id = $1", [req.params.id]);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    await dbRun("UPDATE client_schedules SET active = 0 WHERE id = $1", [schedule.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Documents (register) ----------

app.get("/api/documents", async (req, res, next) => {
  try {
    const { clientId, category, q } = req.query;
    let sql = `
      SELECT documents.*, clients.company AS client_name, clients.file_no AS client_file_no
      FROM documents JOIN clients ON documents.client_id = clients.id
      WHERE 1=1
    `;
    const params = [];
    if (clientId) { params.push(clientId); sql += ` AND documents.client_id = $${params.length}`; }
    if (category) { params.push(category); sql += ` AND documents.category = $${params.length}`; }
    if (q) {
      params.push(`%${q}%`);
      const companyParam = params.length;
      params.push(`%${q}%`);
      const codeParam = params.length;
      sql += ` AND (clients.company ILIKE $${companyParam} OR documents.code ILIKE $${codeParam})`;
    }
    sql += " ORDER BY documents.created_at DESC";
    res.json(await dbAll(sql, params));
  } catch (err) {
    next(err);
  }
});

app.get("/api/documents/lookup/:code", async (req, res, next) => {
  try {
    // Scanned from a physical label, so this returns the client's full
    // "who do I call, what do they have on file" snapshot, not just the
    // document — a handheld scanner is usually used away from the register UI.
    const row = await dbGet(
      `SELECT documents.*,
        clients.company AS client_name,
        clients.file_no AS client_file_no,
        clients.roc AS client_roc,
        clients.registered_address AS client_registered_address,
        clients.directors AS client_directors,
        clients.last_agm_date AS client_last_agm_date,
        clients.contact AS client_contact_name,
        clients.contact_phone AS client_contact_phone,
        clients.contact_email AS client_contact_email,
        clients.fax AS client_fax
       FROM documents JOIN clients ON documents.client_id = clients.id
       WHERE documents.code = $1`,
      [req.params.code.toUpperCase()]
    );
    if (row) return res.json({ ...row, result_type: "document" });

    // Not a document code — the client folder label's QR encodes the
    // client's file number instead (e.g. "A1"), so fall back to that
    // before giving up. Same client-snapshot fields, just no document
    // (category/location/status) to go with them.
    const client = await dbGet(
      `SELECT id, file_no AS client_file_no, company AS client_name, roc AS client_roc,
        registered_address AS client_registered_address, directors AS client_directors,
        last_agm_date AS client_last_agm_date, contact AS client_contact_name,
        contact_phone AS client_contact_phone, contact_email AS client_contact_email,
        fax AS client_fax, status AS client_status
       FROM clients WHERE file_no = $1`,
      [req.params.code.toUpperCase()]
    );
    if (client) return res.json({ ...client, code: client.client_file_no, result_type: "client" });

    res.status(404).json({ error: "No record matches that code" });
  } catch (err) {
    next(err);
  }
});

app.post("/api/documents", async (req, res, next) => {
  try {
    const { clientId, category, serviceDetail, location, dateReceived, loggedBy, isAgmFiling, isBatch, batchCount } = req.body;
    if (!clientId || !category || !location || !dateReceived || !loggedBy) {
      return res.status(400).json({ error: "clientId, category, location, dateReceived, loggedBy are required" });
    }
    // A "batch" entry represents a whole box/bag a client dropped off — one
    // register entry and one label for the box itself, not one per page, since
    // there's rarely space to file or scan each document individually on intake.
    const created = await genCodeAndInsert(dbAll, category, (code) =>
      dbGet(
        `INSERT INTO documents (code, client_id, category, service_detail, location, date_received, logged_by, status, is_batch, batch_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Filed', $8, $9)
         ON CONFLICT (code) DO NOTHING
         RETURNING *`,
        [
          code,
          clientId,
          category,
          serviceDetail || null,
          location,
          dateReceived,
          loggedBy,
          isBatch ? 1 : 0,
          isBatch && batchCount ? Number(batchCount) : null,
        ]
      )
    );

    // An explicit flag, not text-matching on service_detail — reliable signal
    // that this filing settles the client's Annual Return / AGM for the year.
    if (isAgmFiling && category === "secretarial") {
      await dbRun("UPDATE clients SET last_agm_date = $1 WHERE id = $2", [dateReceived, clientId]);
    }

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// A client drops off one box covering several document types at once
// ("bank statements, vouchers, etc. for bookkeeping") — instead of staff
// re-filling the whole form per type, they tick a checklist once and this
// creates one document row per ticked item, all sharing the same box,
// location, date, and logged-by, each still getting its own unique code.
app.post("/api/documents/batch-intake", async (req, res, next) => {
  const { clientId, location, dateReceived, loggedBy, batchCount, items, isAgmFiling } = req.body;
  if (!clientId || !location || !dateReceived || !loggedBy || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "clientId, location, dateReceived, loggedBy, and at least one checked item are required" });
  }

  // One transaction for the whole box: if any item fails partway through
  // (e.g. exhausting the code-collision retries above), nothing in the
  // batch is left half-committed — the client either gets every item
  // logged, or none of them.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const queryAll = async (sql, params) => (await client.query(sql, params)).rows;
    const queryGet = async (sql, params) => (await client.query(sql, params)).rows[0];

    const created = [];
    for (const item of items) {
      const row = await genCodeAndInsert(queryAll, item.category, (code) =>
        queryGet(
          `INSERT INTO documents (code, client_id, category, service_detail, location, date_received, logged_by, status, is_batch, batch_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'Filed', 1, $8)
           ON CONFLICT (code) DO NOTHING
           RETURNING *`,
          [code, clientId, item.category, item.serviceDetail || null, location, dateReceived, loggedBy, batchCount ? Number(batchCount) : null]
        )
      );
      created.push(row);
    }

    // Same explicit-flag signal as the single-document route (POST
    // /api/documents above) — a box that includes the AGM/Annual Return
    // filing settles the client's AR for the year just as much as if it
    // had been logged individually. Without this, the batch-intake path
    // could never clear a client's AR-overdue status.
    if (isAgmFiling) {
      await client.query("UPDATE clients SET last_agm_date = $1 WHERE id = $2", [dateReceived, clientId]);
    }

    await client.query("COMMIT");
    res.status(201).json(created);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

app.post("/api/documents/:id/toggle-checkout", async (req, res, next) => {
  try {
    const doc = await dbGet("SELECT * FROM documents WHERE id = $1", [req.params.id]);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    const nextStatus = doc.status === "Filed" ? "Checked out" : "Filed";
    // documents.status uses 'Filed'/'Checked out'; access_log.action uses
    // 'Checked out'/'Checked in' — two different vocabularies for the same
    // transition, so they can't share nextStatus directly.
    const action = nextStatus === "Checked out" ? "Checked out" : "Checked in";
    // req.user comes from the verified login token, not the request body —
    // so the log can't be spoofed by typing someone else's name.
    const staff = req.user.username;
    const updated = await dbGet("UPDATE documents SET status = $1 WHERE id = $2 RETURNING *", [nextStatus, doc.id]);
    await dbRun("INSERT INTO access_log (document_id, action, staff) VALUES ($1, $2, $3)", [doc.id, action, staff]);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.post("/api/documents/:id/print", async (req, res, next) => {
  try {
    const doc = await dbGet(
      `SELECT documents.*, clients.company AS client_name
       FROM documents JOIN clients ON documents.client_id = clients.id
       WHERE documents.id = $1`,
      [req.params.id]
    );
    if (!doc) return res.status(404).json({ error: "Document not found" });

    const tspl = doc.is_batch
      ? buildBoxLabelTSPL({ clientName: doc.client_name, code: doc.code, location: doc.location, batchCount: doc.batch_count, dateReceived: doc.date_received })
      : buildDocumentLabelTSPL({
          categoryLabel: (CATEGORY_INFO[doc.category] || {}).label || doc.category,
          clientName: doc.client_name,
          code: doc.code,
          location: doc.location,
          dateReceived: doc.date_received,
        });

    await sendRawTSPL(tspl);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `Printing failed: ${err.message}` });
  }
});

// ---------- Document file attachments ----------
// The digital copy of a document a client emailed in — a PDF bank
// statement, a scanned ID, etc. — alongside the physical paper trail
// above. Files live under server/uploads/ for now (see storage.js).

app.get("/api/documents/:id/files", async (req, res, next) => {
  try {
    const rows = await dbAll(
      "SELECT id, document_id, filename, mime_type, size_bytes, uploaded_by, uploaded_at FROM document_files WHERE document_id = $1 ORDER BY uploaded_at DESC",
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.post("/api/documents/:id/files", upload.single("file"), async (req, res, next) => {
  try {
    const doc = await dbGet("SELECT id FROM documents WHERE id = $1", [req.params.id]);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!ALLOWED_FILE_TYPES.has(req.file.mimetype)) {
      return res.status(400).json({ error: "Unsupported file type — PDF, Word, Excel, or an image is expected" });
    }

    const storageKey = storage.makeStorageKey(req.file.originalname);
    await storage.saveFile(req.file.buffer, storageKey);

    const created = await dbGet(
      `INSERT INTO document_files (document_id, filename, storage_key, mime_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, document_id, filename, mime_type, size_bytes, uploaded_by, uploaded_at`,
      [doc.id, req.file.originalname, storageKey, req.file.mimetype, req.file.size, req.user.username]
    );
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

app.get("/api/files/:fileId/download", async (req, res, next) => {
  try {
    const file = await dbGet("SELECT * FROM document_files WHERE id = $1", [req.params.fileId]);
    if (!file) return res.status(404).json({ error: "File not found" });
    const buffer = await storage.readFile(file.storage_key);
    if (vault) await vault.logFileAccess({ dbRun }, file, req.user.username, req.query.action);
    res.setHeader("Content-Type", file.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.filename)}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/files/:fileId", async (req, res, next) => {
  try {
    const file = await dbGet("SELECT * FROM document_files WHERE id = $1", [req.params.fileId]);
    if (!file) return res.status(404).json({ error: "File not found" });
    await dbRun("DELETE FROM document_files WHERE id = $1", [file.id]);
    await storage.deleteFile(file.storage_key);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Filing Helper (GST / AGM preparation) ----------
if (filings) {
  try {
    filings.registerFilingRoutes(app, { dbGet, dbAll, dbRun, pool, requireAdmin, storage });
  } catch (err) {
    console.error("Filing Helper routes could not be registered (the rest of the app is unaffected):", err);
  }
}

if (vault) {
  try {
    vault.registerVaultRoutes(app, { dbGet, dbAll, requireAdmin });
  } catch (err) {
    console.error("Document vault routes could not be registered (the rest of the app is unaffected):", err);
  }
}

if (kyc) {
  try {
    kyc.registerKycRoutes(app, { dbGet, dbAll, dbRun });
  } catch (err) {
    console.error("KYC form routes could not be registered (the rest of the app is unaffected):", err);
  }
}

// ---------- Access log ----------

app.get("/api/access-log", async (req, res, next) => {
  try {
    const rows = await dbAll(
      `SELECT access_log.*, documents.code, clients.company AS client_name
       FROM access_log
       JOIN documents ON access_log.document_id = documents.id
       JOIN clients ON documents.client_id = clients.id
       ORDER BY access_log.logged_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Desktop build only — the Electron app serves the built dashboard from
// this same process instead of a separate dev server, so there's one
// process, one port, no CORS. Cloud/dev deployments never set this.
if (process.env.SERVE_DASHBOARD) {
  const dashboardDist = path.join(__dirname, process.env.SERVE_DASHBOARD);
  app.use(express.static(dashboardDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dashboardDist, "index.html")));
}

// Centralized error handler — keeps route handlers from needing their own
// try/catch boilerplate for anything except the specific errors they handle.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const PORT = process.env.PORT || 4000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`FAMS backend running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });
