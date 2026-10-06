-- Financial Asset Management System — PostgreSQL schema
-- Migrated from the original single-file SQLite schema so the app can run
-- against a managed Postgres instance (Neon/Supabase/etc.) instead of a
-- local file. Date/timestamp columns stay TEXT, formatted the same way
-- SQLite's datetime('now') did, so nothing downstream (frontend display,
-- the "T" -> " " replace in api.js) needed to change.

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
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
  fax TEXT,                   -- company fax number, optional
  -- A=Active, D=Dormant, ADHOC=Adhoc, SO=Struck Off, NR=Not Reachable, L=Left
  status TEXT NOT NULL DEFAULT 'A' CHECK (status IN ('A', 'D', 'ADHOC', 'SO', 'NR', 'L')),
  -- Report-page fields — not auto-fetched (ACRA/IRAS have no free live API,
  -- see server/README or the Report tab for why), just quick working notes
  -- any staff member can update, not gated behind admin like the fields above.
  acra_status TEXT NOT NULL DEFAULT 'Not checked',
  tax_notes TEXT,
  pending_work TEXT,
  annual_revenue NUMERIC,      -- the client company's own annual revenue, manually entered — not Jardeen's billing
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,          -- e.g. FAM-2026-0001
  client_id INTEGER NOT NULL REFERENCES clients(id),
  category TEXT NOT NULL CHECK (category IN ('secretarial', 'bookkeeping', 'banking_tax', 'personal')),
  service_detail TEXT,                -- optional, e.g. "GST Q2 2026"
  location TEXT NOT NULL,             -- e.g. "Cabinet A / Drawer 1"
  date_received TEXT NOT NULL,
  logged_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Filed' CHECK (status IN ('Filed', 'Checked out')),
  is_batch INTEGER NOT NULL DEFAULT 0,  -- 1 = this entry represents a whole box/bag, not one document
  batch_count INTEGER,                  -- approximate number of documents inside, when is_batch
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS access_log (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  action TEXT NOT NULL CHECK (action IN ('Checked out', 'Checked in')),
  staff TEXT NOT NULL,
  logged_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS login_log (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  success INTEGER NOT NULL,   -- 1 = succeeded, 0 = failed attempt
  logged_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Client particulars are edited by admins only (see requireAdmin on PATCH
-- /api/clients/:id) — every field change is recorded here so there's a real
-- paper trail on data sensitive enough to matter (registered address,
-- directors, contact details).
CREATE TABLE IF NOT EXISTS client_edit_log (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- The digital copy of a physical document — a client emails a PDF bank
-- statement, staff logs the physical paper as a document entry as usual,
-- and attaches the PDF here too. storage_key is a local file path for now;
-- kept separate from the path format so swapping to object storage (R2)
-- later only means changing storage.js, not this table.
CREATE TABLE IF NOT EXISTS document_files (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Recurring compliance tasks a client needs handled on a schedule that
-- isn't the AR/AGM cycle (which already has its own FYE-driven engine) —
-- CPF on the 14th every month, GST quarterly, Compilation/Accounting
-- yearly, etc. Client-specific because not every client needs every task.
CREATE TABLE IF NOT EXISTS client_schedules (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  task_name TEXT NOT NULL,               -- e.g. "CPF Filing", "GST Filing", "Compilation"
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  due_month INTEGER CHECK (due_month BETWEEN 1 AND 12),  -- anchor month for quarterly/yearly; unused for monthly
  last_completed_date TEXT,              -- rolls the next-due date forward once filed
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_id);
CREATE INDEX IF NOT EXISTS idx_documents_code ON documents(code);
CREATE INDEX IF NOT EXISTS idx_access_log_document ON access_log(document_id);
CREATE INDEX IF NOT EXISTS idx_client_edit_log_client ON client_edit_log(client_id);
CREATE INDEX IF NOT EXISTS idx_document_files_document ON document_files(document_id);
CREATE INDEX IF NOT EXISTS idx_client_schedules_client ON client_schedules(client_id);
