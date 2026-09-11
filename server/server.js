// Financial Asset Management System — local backend
// Run: npm install, then npm start
// Serves a REST API on http://localhost:4000, backed by a single fams.db SQLite file.

const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

// In production, set this via an environment variable instead of hardcoding it.
// Every login token is signed with this — treat it like a password.
const JWT_SECRET = process.env.FAMS_JWT_SECRET || "change-this-before-real-use";

const DB_PATH = path.join(__dirname, "fams.db");
const dbExists = fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

if (!dbExists) {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  console.log("Initialized new database at", DB_PATH);
} else {
  // Always safe to re-run — CREATE TABLE IF NOT EXISTS guards it.
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
}

// Column additions for databases created before these fields existed.
// CREATE TABLE IF NOT EXISTS above won't add columns to an existing table,
// so each ALTER runs here too — harmless once the column is already there.
const columnMigrations = [
  "ALTER TABLE clients ADD COLUMN registered_address TEXT",
  "ALTER TABLE clients ADD COLUMN directors TEXT",
  "ALTER TABLE clients ADD COLUMN last_agm_date TEXT",
  "ALTER TABLE clients ADD COLUMN contact_phone TEXT",
  "ALTER TABLE clients ADD COLUMN contact_email TEXT",
  "ALTER TABLE documents ADD COLUMN is_batch INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE documents ADD COLUMN batch_count INTEGER",
];
for (const sql of columnMigrations) {
  try {
    db.exec(sql);
  } catch {
    // column already exists
  }
}

const app = express();
app.use(cors());
app.use(express.json());

function genCode() {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT COUNT(*) AS n FROM documents WHERE code LIKE ?").get(`FAM-${year}-%`);
  const next = row.n + 1;
  return `FAM-${year}-${String(next).padStart(4, "0")}`;
}

// File numbers are assigned by the system, not typed by staff — nobody
// should have to remember which number comes next out of ~150 clients.
function genClientFileNo() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM clients").get();
  return `A${row.n + 1}`;
}

// ---------- Authentication ----------

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username || "");
  const ok = user && bcrypt.compareSync(password || "", user.password_hash);

  db.prepare("INSERT INTO login_log (username, success) VALUES (?, ?)").run(username || "(blank)", ok ? 1 : 0);

  if (!ok) return res.status(401).json({ error: "Invalid username or password" });

  const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, username: user.username, role: user.role });
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

app.get("/api/users", requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT id, username, role, created_at FROM users ORDER BY username").all());
});

app.post("/api/users", requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: "username and password are required" });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run(username, hash, role === "admin" ? "admin" : "staff");
    res.status(201).json({ id: info.lastInsertRowid, username, role: role === "admin" ? "admin" : "staff" });
  } catch (err) {
    res.status(400).json({ error: "Username may already be taken" });
  }
});

app.get("/api/login-log", requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM login_log ORDER BY logged_at DESC LIMIT 100").all());
});

// ---------- Clients ----------

app.get("/api/clients", (req, res) => {
  const rows = db.prepare("SELECT * FROM clients ORDER BY company ASC").all();
  res.json(rows);
});

app.post("/api/clients", (req, res) => {
  const { company, roc, yearEnd, dateInc, registeredAddress, directors, contact, contactPhone, contactEmail, status } = req.body;
  if (!company) return res.status(400).json({ error: "company is required" });
  try {
    const fileNo = genClientFileNo();
    const stmt = db.prepare(
      `INSERT INTO clients
        (file_no, company, roc, year_end, date_inc, registered_address, directors, contact, contact_phone, contact_email, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
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
      status || "A"
    );
    const created = db.prepare("SELECT * FROM clients WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
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
  status: "status",
};

app.patch("/api/clients/:id", requireAdmin, (req, res) => {
  const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
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

  const setClause = updates.map((u) => `${u.column} = ?`).join(", ");
  const values = updates.map((u) => u.value);
  db.prepare(`UPDATE clients SET ${setClause} WHERE id = ?`).run(...values, req.params.id);

  const logStmt = db.prepare(
    "INSERT INTO client_edit_log (client_id, field, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?)"
  );
  for (const entry of logEntries) {
    logStmt.run(req.params.id, entry.field, entry.oldValue, entry.newValue, req.user.username);
  }

  const updated = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
  res.json(updated);
});

app.get("/api/clients/:id/edit-log", requireAdmin, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM client_edit_log WHERE client_id = ? ORDER BY changed_at DESC")
    .all(req.params.id);
  res.json(rows);
});

// ---------- Documents (register) ----------

app.get("/api/documents", (req, res) => {
  const { clientId, category, q } = req.query;
  let sql = `
    SELECT documents.*, clients.company AS client_name, clients.file_no AS client_file_no
    FROM documents JOIN clients ON documents.client_id = clients.id
    WHERE 1=1
  `;
  const params = [];
  if (clientId) { sql += " AND documents.client_id = ?"; params.push(clientId); }
  if (category) { sql += " AND documents.category = ?"; params.push(category); }
  if (q) { sql += " AND (clients.company LIKE ? OR documents.code LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
  sql += " ORDER BY documents.created_at DESC";
  res.json(db.prepare(sql).all(...params));
});

app.get("/api/documents/lookup/:code", (req, res) => {
  // Scanned from a physical label, so this returns the client's full
  // "who do I call, what do they have on file" snapshot, not just the
  // document — a handheld scanner is usually used away from the register UI.
  const row = db
    .prepare(
      `SELECT documents.*,
        clients.company AS client_name,
        clients.file_no AS client_file_no,
        clients.roc AS client_roc,
        clients.registered_address AS client_registered_address,
        clients.directors AS client_directors,
        clients.last_agm_date AS client_last_agm_date,
        clients.contact AS client_contact_name,
        clients.contact_phone AS client_contact_phone,
        clients.contact_email AS client_contact_email
       FROM documents JOIN clients ON documents.client_id = clients.id
       WHERE documents.code = ?`
    )
    .get(req.params.code.toUpperCase());
  if (!row) return res.status(404).json({ error: "No record matches that code" });
  res.json(row);
});

app.post("/api/documents", (req, res) => {
  const { clientId, category, serviceDetail, location, dateReceived, loggedBy, isAgmFiling, isBatch, batchCount } = req.body;
  if (!clientId || !category || !location || !dateReceived || !loggedBy) {
    return res.status(400).json({ error: "clientId, category, location, dateReceived, loggedBy are required" });
  }
  const code = genCode();
  // A "batch" entry represents a whole box/bag a client dropped off — one
  // register entry and one label for the box itself, not one per page, since
  // there's rarely space to file or scan each document individually on intake.
  const stmt = db.prepare(
    `INSERT INTO documents (code, client_id, category, service_detail, location, date_received, logged_by, status, is_batch, batch_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Filed', ?, ?)`
  );
  const info = stmt.run(
    code,
    clientId,
    category,
    serviceDetail || null,
    location,
    dateReceived,
    loggedBy,
    isBatch ? 1 : 0,
    isBatch && batchCount ? Number(batchCount) : null
  );

  // An explicit flag, not text-matching on service_detail — reliable signal
  // that this filing settles the client's Annual Return / AGM for the year.
  if (isAgmFiling && category === "secretarial") {
    db.prepare("UPDATE clients SET last_agm_date = ? WHERE id = ?").run(dateReceived, clientId);
  }

  const created = db.prepare("SELECT * FROM documents WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(created);
});

app.post("/api/documents/:id/toggle-checkout", (req, res) => {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  const nextStatus = doc.status === "Filed" ? "Checked out" : "Filed";
  // req.user comes from the verified login token, not the request body —
  // so the log can't be spoofed by typing someone else's name.
  const staff = req.user.username;
  db.prepare("UPDATE documents SET status = ? WHERE id = ?").run(nextStatus, doc.id);
  db.prepare("INSERT INTO access_log (document_id, action, staff) VALUES (?, ?, ?)").run(doc.id, nextStatus, staff);
  const updated = db.prepare("SELECT * FROM documents WHERE id = ?").get(doc.id);
  res.json(updated);
});

// ---------- Access log ----------

app.get("/api/access-log", (req, res) => {
  const rows = db
    .prepare(
      `SELECT access_log.*, documents.code, clients.company AS client_name
       FROM access_log
       JOIN documents ON access_log.document_id = documents.id
       JOIN clients ON documents.client_id = clients.id
       ORDER BY access_log.logged_at DESC
       LIMIT 100`
    )
    .all();
  res.json(rows);
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = 4000;
app.listen(PORT, () => console.log(`FAMS backend running on http://localhost:${PORT}`));
