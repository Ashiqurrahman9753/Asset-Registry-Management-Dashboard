// Document vault — every uploaded file for one client in one place, plus a
// record of who opened or downloaded which file (the files include bank
// statements and ID copies, so "who looked at what" is worth keeping).

const VAULT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS file_access_log (
    id SERIAL PRIMARY KEY,
    file_id INTEGER NOT NULL,
    filename TEXT,
    action TEXT NOT NULL,
    staff TEXT NOT NULL,
    logged_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );
  CREATE INDEX IF NOT EXISTS idx_file_access_log_file ON file_access_log(file_id);
`;

// Never lets a problem here stop the app from starting.
async function initVaultSchema({ dbRun }) {
  try {
    await dbRun(VAULT_SCHEMA);
  } catch (err) {
    console.error("Document vault setup failed (the rest of the app is unaffected):", err);
  }
}

// Viewing a file must never fail just because the log couldn't be written.
async function logFileAccess({ dbRun }, file, staff, action) {
  try {
    await dbRun("INSERT INTO file_access_log (file_id, filename, action, staff) VALUES ($1, $2, $3, $4)", [
      file.id,
      file.filename,
      action === "download" ? "downloaded" : "viewed",
      staff,
    ]);
  } catch (err) {
    console.error("Could not record file access:", err.message);
  }
}

function registerVaultRoutes(app, { dbGet, dbAll, requireAdmin }) {
  // All uploaded files for a client, with the register entry each one belongs to.
  app.get("/api/clients/:id/files", async (req, res, next) => {
    try {
      const client = await dbGet("SELECT id FROM clients WHERE id = $1", [req.params.id]);
      if (!client) return res.status(404).json({ error: "Client not found" });
      const rows = await dbAll(
        `SELECT document_files.id, document_files.document_id, document_files.filename, document_files.mime_type,
                document_files.size_bytes, document_files.uploaded_by, document_files.uploaded_at,
                documents.code AS document_code, documents.category, documents.service_detail,
                documents.date_received, documents.location, documents.status AS document_status
         FROM document_files JOIN documents ON document_files.document_id = documents.id
         WHERE documents.client_id = $1
         ORDER BY document_files.uploaded_at DESC, document_files.id DESC`,
        [client.id]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // Who opened / downloaded a file (admin only).
  app.get("/api/files/:fileId/access-log", requireAdmin, async (req, res, next) => {
    try {
      res.json(await dbAll("SELECT * FROM file_access_log WHERE file_id = $1 ORDER BY logged_at DESC, id DESC LIMIT 200", [req.params.fileId]));
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { initVaultSchema, registerVaultRoutes, logFileAccess };
