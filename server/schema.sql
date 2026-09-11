-- Financial Asset Management System — SQLite schema
-- One file, no server admin required. Lives at fams.db once created.

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_no TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL,
  roc TEXT,
  year_end TEXT,
  date_inc TEXT,
  registered_address TEXT,
  directors TEXT,             -- one director name per line
  last_agm_date TEXT,         -- set automatically when an AGM/Annual Return filing is logged
  contact TEXT,               -- person in charge — name
  contact_phone TEXT,         -- person in charge — phone (the one number staff actually call)
  contact_email TEXT,         -- person in charge — email, optional
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A', 'D', 'ADHOC')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,          -- e.g. FAM-2026-0001
  client_id INTEGER NOT NULL REFERENCES clients(id),
  category TEXT NOT NULL CHECK (category IN ('secretarial', 'banking_tax', 'personal')),
  service_detail TEXT,                -- optional, e.g. "GST Q2 2026"
  location TEXT NOT NULL,             -- e.g. "Cabinet A / Drawer 1"
  date_received TEXT NOT NULL,
  logged_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Filed' CHECK (status IN ('Filed', 'Checked out')),
  is_batch INTEGER NOT NULL DEFAULT 0,  -- 1 = this entry represents a whole box/bag, not one document
  batch_count INTEGER,                  -- approximate number of documents inside, when is_batch
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  action TEXT NOT NULL CHECK (action IN ('Checked out', 'Checked in')),
  staff TEXT NOT NULL,
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  success INTEGER NOT NULL,   -- 1 = succeeded, 0 = failed attempt
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Client particulars are edited by admins only (see requireAdmin on PATCH
-- /api/clients/:id) — every field change is recorded here so there's a real
-- paper trail on data sensitive enough to matter (registered address,
-- directors, contact details).
CREATE TABLE IF NOT EXISTS client_edit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_id);
CREATE INDEX IF NOT EXISTS idx_documents_code ON documents(code);
CREATE INDEX IF NOT EXISTS idx_access_log_document ON access_log(document_id);
CREATE INDEX IF NOT EXISTS idx_client_edit_log_client ON client_edit_log(client_id);
