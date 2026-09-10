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

const app = express();
app.use(cors());
app.use(express.json());

function genCode() {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT COUNT(*) AS n FROM documents WHERE code LIKE ?").get(`FAM-${year}-%`);
  const next = row.n + 1;
  return `FAM-${year}-${String(next).padStart(4, "0")}`;
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
  const { fileNo, company, roc, yearEnd, dateInc, contact, status } = req.body;
  if (!fileNo || !company) return res.status(400).json({ error: "fileNo and company are required" });
  try {
    const stmt = db.prepare(
      "INSERT INTO clients (file_no, company, roc, year_end, date_inc, contact, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const info = stmt.run(fileNo, company, roc || null, yearEnd || null, dateInc || null, contact || null, status || "A");
    const created = db.prepare("SELECT * FROM clients WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
  const row = db
    .prepare(
      `SELECT documents.*, clients.company AS client_name, clients.file_no AS client_file_no
       FROM documents JOIN clients ON documents.client_id = clients.id
       WHERE documents.code = ?`
    )
    .get(req.params.code.toUpperCase());
  if (!row) return res.status(404).json({ error: "No record matches that code" });
  res.json(row);
});

app.post("/api/documents", (req, res) => {
  const { clientId, category, serviceDetail, location, dateReceived, loggedBy } = req.body;
  if (!clientId || !category || !location || !dateReceived || !loggedBy) {
    return res.status(400).json({ error: "clientId, category, location, dateReceived, loggedBy are required" });
  }
  const code = genCode();
  const stmt = db.prepare(
    `INSERT INTO documents (code, client_id, category, service_detail, location, date_received, logged_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Filed')`
  );
  const info = stmt.run(code, clientId, category, serviceDetail || null, location, dateReceived, loggedBy);
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
