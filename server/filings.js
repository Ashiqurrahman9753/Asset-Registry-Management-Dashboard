// Filing Helper — gets a client's documents lined up for a GST or AGM /
// Annual Return filing. It never files anything itself: staff still file on
// IRAS / ACRA as usual. This only builds a checklist of what's needed, shows
// what's already on file (digital copy and/or physical shelf), and bundles
// the files for download.
const { buildZip } = require("./zip.js");

const FILING_TYPES = ["gst", "agm"];

const FILING_SCHEMA = `
  -- Editable checklist definitions. A filing copies these into filing_items when
  -- it's created, so editing a template later never changes a filing in progress.
  CREATE TABLE IF NOT EXISTS filing_templates (
    id SERIAL PRIMARY KEY,
    filing_type TEXT NOT NULL CHECK (filing_type IN ('gst', 'agm')),
    label TEXT NOT NULL,
    category TEXT,                 -- documents.category to look in; empty = any
    subtype TEXT,                  -- matches the start of documents.service_detail, e.g. 'Sales / Invoices'
    keyword TEXT,                  -- comma-separated words to find in service_detail (any one matches)
    period_scope TEXT NOT NULL DEFAULT 'period' CHECK (period_scope IN ('period', 'any')),
    required INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS filings (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    filing_type TEXT NOT NULL CHECK (filing_type IN ('gst', 'agm')),
    period_label TEXT NOT NULL,    -- e.g. "Apr-Jun 2026" or "FY ending Dec 2026"
    period_start TEXT NOT NULL,    -- YYYY-MM-DD
    period_end TEXT NOT NULL,      -- YYYY-MM-DD
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'filed')),
    filed_date TEXT,
    reference_no TEXT,
    filed_by TEXT,
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    UNIQUE (client_id, filing_type, period_label)
  );

  CREATE TABLE IF NOT EXISTS filing_items (
    id SERIAL PRIMARY KEY,
    filing_id INTEGER NOT NULL REFERENCES filings(id),
    label TEXT NOT NULL,
    category TEXT,
    subtype TEXT,
    keyword TEXT,
    period_scope TEXT NOT NULL DEFAULT 'period',
    required INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'ticked', 'na')),
    na_reason TEXT,
    updated_by TEXT,
    updated_at TEXT
  );

  -- Documents staff linked to a checklist item by hand, for anything the
  -- automatic matching (category / type / keyword / period) didn't pick up.
  CREATE TABLE IF NOT EXISTS filing_item_docs (
    item_id INTEGER NOT NULL REFERENCES filing_items(id),
    document_id INTEGER NOT NULL REFERENCES documents(id),
    PRIMARY KEY (item_id, document_id)
  );

  CREATE TABLE IF NOT EXISTS filing_log (
    id SERIAL PRIMARY KEY,
    filing_id INTEGER NOT NULL REFERENCES filings(id),
    action TEXT NOT NULL,
    detail TEXT,
    staff TEXT NOT NULL,
    logged_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE INDEX IF NOT EXISTS idx_filings_client ON filings(client_id);
  CREATE INDEX IF NOT EXISTS idx_filing_items_filing ON filing_items(filing_id);
  CREATE INDEX IF NOT EXISTS idx_filing_log_filing ON filing_log(filing_id);
`;

// Starting points only — the right document list for a given client is the
// accountant's call, and admins can edit these from the checklist editor.
// [filing_type, label, category, subtype, keyword, period_scope, required]
const DEFAULT_TEMPLATES = [
  ["gst", "Sales invoices for the period", "bookkeeping", "Sales / Invoices", null, "period", 1],
  ["gst", "Purchase bills for the period", "bookkeeping", "Purchases / Bills", null, "period", 1],
  ["gst", "Bank statements for the period", "bookkeeping", "Bank Statement", null, "period", 1],
  ["gst", "Credit / debit notes", "bookkeeping", null, "credit note,debit note", "period", 0],
  ["gst", "Import / customs documents", "bookkeeping", null, "import,customs,permit", "period", 0],
  ["gst", "Previous GST return and workings", "banking_tax", null, "gst", "any", 0],
  ["agm", "Signed financial statements", "secretarial", null, "financial statement,accounts", "any", 1],
  ["agm", "Directors' statement", "secretarial", null, "director", "any", 1],
  ["agm", "Auditor's report or audit exemption note", "secretarial", null, "audit", "any", 0],
  ["agm", "AGM notice and minutes", "secretarial", null, "agm,minutes,notice", "any", 1],
  ["agm", "Registers (members, directors)", "secretarial", null, "register", "any", 0],
  ["agm", "Previous annual return", "secretarial", null, "annual return", "any", 0],
  ["agm", "Director particulars / KYC update", "personal", null, null, "any", 0],
];

// Never lets a problem here stop the app from starting — the register itself
// must keep working even if this feature's tables couldn't be created.
async function initFilingSchema({ dbRun, dbGet }) {
  try {
    await dbRun("ALTER TABLE clients ADD COLUMN IF NOT EXISTS gst_reg_no TEXT");
    await dbRun(FILING_SCHEMA);
    const row = await dbGet("SELECT COUNT(*) AS n FROM filing_templates");
    if (Number(row.n) === 0) {
      let order = 0;
      for (const [type, label, category, subtype, keyword, scope, required] of DEFAULT_TEMPLATES) {
        order += 10;
        await dbRun(
          `INSERT INTO filing_templates (filing_type, label, category, subtype, keyword, period_scope, required, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [type, label, category, subtype, keyword, scope, required, order]
        );
      }
    }
  } catch (err) {
    console.error("Filing Helper setup failed (the rest of the app is unaffected):", err);
  }
}

// ---------- Period + matching helpers ----------

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Documents are labelled "<Subtype> — <Mon YYYY>" by the intake form (see
// monthLabel in the dashboard), so a period's matching labels are every
// "Mon YYYY" between its start and end dates.
function monthLabelsBetween(startIso, endIso) {
  const labels = [];
  const [sy, sm] = startIso.split("-").map(Number);
  const [ey, em] = endIso.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    labels.push(`${MONTH_ABBR[m - 1]} ${y}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (labels.length > 24) break; // a filing period is never longer than ~a year
  }
  return labels;
}

function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// Does this document belong in this checklist item (for this filing period)?
function documentMatchesItem(doc, item, monthLabels) {
  if (item.category && doc.category !== item.category) return false;
  const detail = String(doc.service_detail || "").toLowerCase();
  if (item.subtype && !detail.startsWith(String(item.subtype).toLowerCase())) return false;
  if (item.keyword) {
    const words = String(item.keyword).split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (words.length && !words.some((w) => detail.includes(w))) return false;
  }
  // An item with no category, type or keyword would match every document — nothing to go on, so don't.
  if (!item.category && !item.subtype && !item.keyword) return false;
  if (item.period_scope === "period") {
    return monthLabels.some((label) => detail.includes(label.toLowerCase()));
  }
  return true;
}

// Strip characters that are illegal or awkward in file names on Windows.
function safeName(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120) || "file";
}

// ---------- Routes ----------

function registerFilingRoutes(app, { dbGet, dbAll, dbRun, pool, requireAdmin, storage }) {
  async function logEvent(filingId, action, detail, staff) {
    await dbRun("INSERT INTO filing_log (filing_id, action, detail, staff) VALUES ($1, $2, $3, $4)", [filingId, action, detail || null, staff]);
  }

  // Everything the filing screen shows: the filing, the client's details, and for
  // each checklist item the documents that match it (with their digital files
  // and physical shelf location).
  async function loadFilingView(filingId) {
    const filing = await dbGet("SELECT * FROM filings WHERE id = $1", [filingId]);
    if (!filing) return null;
    const client = await dbGet("SELECT * FROM clients WHERE id = $1", [filing.client_id]);
    const items = await dbAll("SELECT * FROM filing_items WHERE filing_id = $1 ORDER BY sort_order ASC, id ASC", [filingId]);
    const documents = await dbAll("SELECT * FROM documents WHERE client_id = $1 ORDER BY date_received DESC, id DESC", [filing.client_id]);
    const files = await dbAll(
      `SELECT document_files.id, document_files.document_id, document_files.filename, document_files.mime_type,
              document_files.size_bytes, document_files.uploaded_at
       FROM document_files JOIN documents ON document_files.document_id = documents.id
       WHERE documents.client_id = $1 ORDER BY document_files.uploaded_at DESC`,
      [filing.client_id]
    );
    const links = await dbAll(
      `SELECT filing_item_docs.item_id, filing_item_docs.document_id
       FROM filing_item_docs JOIN filing_items ON filing_item_docs.item_id = filing_items.id
       WHERE filing_items.filing_id = $1`,
      [filingId]
    );

    const filesByDoc = new Map();
    for (const f of files) {
      if (!filesByDoc.has(f.document_id)) filesByDoc.set(f.document_id, []);
      filesByDoc.get(f.document_id).push(f);
    }
    const monthLabels = monthLabelsBetween(filing.period_start, filing.period_end);
    const docById = new Map(documents.map((d) => [d.id, d]));

    const viewItems = items.map((item) => {
      const matched = new Map();
      for (const doc of documents) {
        if (documentMatchesItem(doc, item, monthLabels)) matched.set(doc.id, { doc, how: "auto" });
      }
      for (const link of links) {
        if (link.item_id !== item.id) continue;
        const doc = docById.get(link.document_id);
        if (doc) matched.set(doc.id, { doc, how: "linked" });
      }
      const docs = [...matched.values()].map(({ doc, how }) => ({
        id: doc.id,
        code: doc.code,
        category: doc.category,
        serviceDetail: doc.service_detail,
        location: doc.location,
        status: doc.status, // Filed | Checked out
        dateReceived: doc.date_received,
        isBatch: doc.is_batch === 1,
        batchCount: doc.batch_count,
        how,
        files: filesByDoc.get(doc.id) || [],
      }));
      const hasFile = docs.some((d) => d.files.length > 0);
      let availability = "missing";
      if (hasFile) availability = "digital";
      else if (docs.length > 0) availability = "paper";
      return {
        id: item.id,
        label: item.label,
        category: item.category,
        required: item.required === 1,
        state: item.state, // open | ticked | na
        naReason: item.na_reason,
        availability, // digital | paper | missing
        docs,
      };
    });

    return { filing, client, items: viewItems };
  }

  // Default checklist, for the picker's preview and the admin editor.
  app.get("/api/filing-templates", async (req, res, next) => {
    try {
      res.json(await dbAll("SELECT * FROM filing_templates WHERE active = 1 ORDER BY filing_type, sort_order, id"));
    } catch (err) {
      next(err);
    }
  });

  // A client's filings, newest first (open one or start a new one from here).
  app.get("/api/clients/:id/filings", async (req, res, next) => {
    try {
      res.json(await dbAll("SELECT * FROM filings WHERE client_id = $1 ORDER BY period_end DESC, id DESC", [req.params.id]));
    } catch (err) {
      next(err);
    }
  });

  // Start (or reopen) the filing for one period. Reopening is deliberate: the
  // same client + type + period is one filing, so a second click never makes a duplicate.
  app.post("/api/clients/:id/filings", async (req, res, next) => {
    try {
      const client = await dbGet("SELECT id FROM clients WHERE id = $1", [req.params.id]);
      if (!client) return res.status(404).json({ error: "Client not found" });
      const { filingType, periodLabel, periodStart, periodEnd, dueDate } = req.body;
      if (!FILING_TYPES.includes(filingType)) return res.status(400).json({ error: "filingType must be gst or agm" });
      if (!periodLabel || !String(periodLabel).trim()) return res.status(400).json({ error: "periodLabel is required" });
      if (!isIsoDate(periodStart) || !isIsoDate(periodEnd) || periodStart > periodEnd) {
        return res.status(400).json({ error: "periodStart and periodEnd must be valid YYYY-MM-DD dates, start before end" });
      }
      if (dueDate && !isIsoDate(dueDate)) return res.status(400).json({ error: "dueDate must be YYYY-MM-DD" });

      const label = String(periodLabel).trim();
      const existing = await dbGet(
        "SELECT id FROM filings WHERE client_id = $1 AND filing_type = $2 AND period_label = $3",
        [client.id, filingType, label]
      );
      if (existing) return res.json(await loadFilingView(existing.id));

      const created = await dbGet(
        `INSERT INTO filings (client_id, filing_type, period_label, period_start, period_end, due_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [client.id, filingType, label, periodStart, periodEnd, dueDate || null, req.user.username]
      );
      const templates = await dbAll(
        "SELECT * FROM filing_templates WHERE filing_type = $1 AND active = 1 ORDER BY sort_order, id",
        [filingType]
      );
      for (const t of templates) {
        await dbRun(
          `INSERT INTO filing_items (filing_id, label, category, subtype, keyword, period_scope, required, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [created.id, t.label, t.category, t.subtype, t.keyword, t.period_scope, t.required, t.sort_order]
        );
      }
      await logEvent(created.id, "prepared", `${filingType.toUpperCase()} ${label}`, req.user.username);
      res.status(201).json(await loadFilingView(created.id));
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/filings/:id", async (req, res, next) => {
    try {
      const view = await loadFilingView(req.params.id);
      if (!view) return res.status(404).json({ error: "Filing not found" });
      res.json(view);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/filings/:id/log", async (req, res, next) => {
    try {
      res.json(await dbAll("SELECT * FROM filing_log WHERE filing_id = $1 ORDER BY logged_at DESC, id DESC", [req.params.id]));
    } catch (err) {
      next(err);
    }
  });

  // Tick an item off, mark it not applicable (with a reason), or reopen it.
  app.patch("/api/filing-items/:id", async (req, res, next) => {
    try {
      const item = await dbGet(
        "SELECT filing_items.*, filings.status AS filing_status FROM filing_items JOIN filings ON filing_items.filing_id = filings.id WHERE filing_items.id = $1",
        [req.params.id]
      );
      if (!item) return res.status(404).json({ error: "Checklist item not found" });
      if (item.filing_status === "filed") return res.status(400).json({ error: "This filing is already marked as filed" });

      const { state, naReason } = req.body;
      if (!["open", "ticked", "na"].includes(state)) return res.status(400).json({ error: "state must be open, ticked or na" });
      const reason = state === "na" ? String(naReason || "").trim() : null;
      if (state === "na" && !reason) return res.status(400).json({ error: "Please give a reason for marking this as not applicable" });

      await dbRun(
        `UPDATE filing_items SET state = $1, na_reason = $2, updated_by = $3, updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $4`,
        [state, reason, req.user.username, item.id]
      );
      await logEvent(item.filing_id, state === "ticked" ? "ticked" : state === "na" ? "not applicable" : "reopened",
        state === "na" ? `${item.label} — ${reason}` : item.label, req.user.username);
      res.json(await loadFilingView(item.filing_id));
    } catch (err) {
      next(err);
    }
  });

  // Link / unlink a document to a checklist item by hand.
  app.post("/api/filing-items/:id/documents", async (req, res, next) => {
    try {
      const item = await dbGet("SELECT * FROM filing_items WHERE id = $1", [req.params.id]);
      if (!item) return res.status(404).json({ error: "Checklist item not found" });
      const filing = await dbGet("SELECT * FROM filings WHERE id = $1", [item.filing_id]);
      if (filing.status === "filed") return res.status(400).json({ error: "This filing is already marked as filed" });
      const doc = await dbGet("SELECT * FROM documents WHERE id = $1 AND client_id = $2", [req.body.documentId, filing.client_id]);
      if (!doc) return res.status(404).json({ error: "That document doesn't belong to this client" });
      await dbRun("INSERT INTO filing_item_docs (item_id, document_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [item.id, doc.id]);
      await logEvent(filing.id, "linked document", `${doc.code} → ${item.label}`, req.user.username);
      res.json(await loadFilingView(filing.id));
    } catch (err) {
      next(err);
    }
  });

  app.delete("/api/filing-items/:id/documents/:documentId", async (req, res, next) => {
    try {
      const item = await dbGet("SELECT * FROM filing_items WHERE id = $1", [req.params.id]);
      if (!item) return res.status(404).json({ error: "Checklist item not found" });
      const filing = await dbGet("SELECT * FROM filings WHERE id = $1", [item.filing_id]);
      if (filing.status === "filed") return res.status(400).json({ error: "This filing is already marked as filed" });
      await dbRun("DELETE FROM filing_item_docs WHERE item_id = $1 AND document_id = $2", [item.id, req.params.documentId]);
      await logEvent(filing.id, "unlinked document", `${req.params.documentId} from ${item.label}`, req.user.username);
      res.json(await loadFilingView(filing.id));
    } catch (err) {
      next(err);
    }
  });

  // ---------- ZIP bundle ----------
  // One download with every digital file for the checklist, neatly named, plus a
  // cover sheet (company details, checklist status, what's missing / paper-only).
  // Files from the "personal particulars" category (director IDs etc.) are held
  // back unless the staff member explicitly asks for them.

  function coverSheetText(view, extras) {
    const { filing, client, items } = view;
    const lines = [];
    const typeName = filing.filing_type === "gst" ? "GST return" : "AGM / Annual Return";
    lines.push(`${typeName} — ${filing.period_label}`);
    lines.push(`${client.company}`);
    lines.push("=".repeat(60));
    lines.push("");
    lines.push("COMPANY DETAILS");
    lines.push(`  Company name     : ${client.company || ""}`);
    lines.push(`  ROC / UEN        : ${client.roc || ""}`);
    if (filing.filing_type === "gst") lines.push(`  GST reg. no.     : ${client.gst_reg_no || "(not recorded)"}`);
    lines.push(`  Financial year-end: ${client.year_end || ""}`);
    lines.push(`  Date incorporated: ${client.date_inc || ""}`);
    lines.push(`  Registered address: ${client.registered_address || ""}`);
    const directors = String(client.directors || "").split("\n").map((d) => d.trim()).filter(Boolean);
    lines.push(`  Directors        : ${directors.join("; ")}`);
    lines.push(`  Contact          : ${client.contact || ""} ${client.contact_phone || ""} ${client.contact_email || ""}`.trimEnd());
    lines.push(`  Last AGM date    : ${client.last_agm_date || ""}`);
    lines.push("");
    lines.push("FILING");
    lines.push(`  Period           : ${filing.period_start} to ${filing.period_end}`);
    lines.push(`  Due date         : ${filing.due_date || "(not set)"}`);
    lines.push(`  Status           : ${filing.status}${filing.filed_date ? ` on ${filing.filed_date}` : ""}${filing.reference_no ? ` (ref ${filing.reference_no})` : ""}`);
    lines.push("");
    lines.push("CHECKLIST");
    const icon = { digital: "[files in this bundle]", paper: "[paper only]", missing: "[MISSING]" };
    for (const item of items) {
      let status;
      if (item.state === "na") status = `[not applicable: ${item.naReason || ""}]`;
      else status = icon[item.availability];
      const mark = item.state === "ticked" ? "[x]" : "[ ]";
      lines.push(`  ${mark} ${item.label}${item.required ? "" : " (optional)"}  ${status}`);
      for (const d of item.docs) {
        if (d.files.length === 0) {
          lines.push(`        - ${d.code}: paper on ${d.location} (${d.status})`);
        }
      }
    }
    if (extras.withheld.length) {
      lines.push("");
      lines.push("HELD BACK (personal particulars — not included unless requested)");
      for (const w of extras.withheld) lines.push(`  - ${w}`);
    }
    if (extras.unreadable.length) {
      lines.push("");
      lines.push("COULD NOT BE ADDED (file missing on this computer)");
      for (const w of extras.unreadable) lines.push(`  - ${w}`);
    }
    lines.push("");
    lines.push(`Prepared ${extras.preparedAt} by ${extras.preparedBy}. This bundle is for preparing the filing only;`);
    lines.push("the return itself is still filed by staff on the official IRAS / ACRA portal.");
    return lines.join("\r\n") + "\r\n";
  }

  app.get("/api/filings/:id/bundle", async (req, res, next) => {
    try {
      const view = await loadFilingView(req.params.id);
      if (!view) return res.status(404).json({ error: "Filing not found" });
      const includePersonal = req.query.includePersonal === "true";

      const entries = [];
      const withheld = [];
      const unreadable = [];
      const folder = safeName(`${view.filing.filing_type.toUpperCase()} ${view.filing.period_label} - ${view.client.company}`);
      const usedNames = new Set();
      const takenFileIds = new Set();
      let number = 0;

      for (const item of view.items) {
        if (item.state === "na") continue;
        number += 1;
        const prefix = String(number).padStart(2, "0");
        for (const doc of item.docs) {
          for (const file of doc.files) {
            if (takenFileIds.has(file.id)) continue; // the same file can match two items — include it once
            if (doc.category === "personal" && !includePersonal) {
              withheld.push(`${file.filename} (${doc.code})`);
              continue;
            }
            let data;
            try {
              const row = await dbGet("SELECT storage_key FROM document_files WHERE id = $1", [file.id]);
              data = await storage.readFile(row.storage_key);
            } catch {
              unreadable.push(`${file.filename} (${doc.code})`);
              continue;
            }
            takenFileIds.add(file.id);
            let name = `${folder}/${prefix} ${safeName(item.label)}/${safeName(file.filename)}`;
            for (let n = 2; usedNames.has(name.toLowerCase()); n++) {
              const dot = file.filename.lastIndexOf(".");
              const base = dot > 0 ? file.filename.slice(0, dot) : file.filename;
              const ext = dot > 0 ? file.filename.slice(dot) : "";
              name = `${folder}/${prefix} ${safeName(item.label)}/${safeName(`${base} (${n})${ext}`)}`;
            }
            usedNames.add(name.toLowerCase());
            entries.push({ name, data });
          }
        }
      }

      const preparedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
      const cover = coverSheetText(view, { withheld, unreadable, preparedAt, preparedBy: req.user.username });
      entries.unshift({ name: `${folder}/00 Cover sheet.txt`, data: Buffer.from("﻿" + cover, "utf8") });

      const zip = buildZip(entries);
      await logEvent(
        view.filing.id,
        "downloaded bundle",
        `${entries.length - 1} file(s)${withheld.length ? `, ${withheld.length} personal file(s) held back` : ""}${includePersonal ? ", personal files included" : ""}`,
        req.user.username
      );
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(folder + ".zip")}`);
      res.send(zip);
    } catch (err) {
      next(err);
    }
  });

  // ---------- Mark as filed ----------
  // Records that staff filed on the official portal (date + the portal's own
  // reference number) and rolls the client's own tracking forward, so nobody
  // has to enter it twice: GST completes the client's GST schedule cycle, AGM
  // sets the last AGM date the overdue / due-soon logic already reads.
  app.post("/api/filings/:id/mark-filed", async (req, res, next) => {
    try {
      const filing = await dbGet("SELECT * FROM filings WHERE id = $1", [req.params.id]);
      if (!filing) return res.status(404).json({ error: "Filing not found" });
      if (filing.status === "filed") return res.status(400).json({ error: "This filing is already marked as filed" });

      const { filedDate, referenceNo, notes } = req.body;
      if (!isIsoDate(filedDate)) return res.status(400).json({ error: "Please give the date it was filed (YYYY-MM-DD)" });
      const ref = String(referenceNo || "").trim() || null;

      await dbRun(
        `UPDATE filings SET status = 'filed', filed_date = $1, reference_no = $2, notes = $3, filed_by = $4 WHERE id = $5`,
        [filedDate, ref, String(notes || "").trim() || null, req.user.username, filing.id]
      );

      let rolled = "";
      if (filing.filing_type === "agm") {
        const client = await dbGet("SELECT last_agm_date FROM clients WHERE id = $1", [filing.client_id]);
        if (!client.last_agm_date || client.last_agm_date < filedDate) {
          await dbRun("UPDATE clients SET last_agm_date = $1 WHERE id = $2", [filedDate, filing.client_id]);
          rolled = "last AGM date updated";
        }
      } else {
        const result = await dbRun(
          `UPDATE client_schedules SET last_completed_date = $1
           WHERE client_id = $2 AND active = 1 AND task_name ILIKE '%GST%'`,
          [filedDate, filing.client_id]
        );
        if (result.rowCount > 0) rolled = "GST schedule rolled forward";
      }

      await logEvent(filing.id, "marked as filed", `${filedDate}${ref ? ` — ref ${ref}` : ""}${rolled ? ` (${rolled})` : ""}`, req.user.username);
      res.json(await loadFilingView(filing.id));
    } catch (err) {
      next(err);
    }
  });

  // A filing marked as filed by mistake can be reopened by an admin. This does
  // not undo the schedule / AGM-date update — those are edited where they live.
  app.post("/api/filings/:id/reopen", requireAdmin, async (req, res, next) => {
    try {
      const filing = await dbGet("SELECT * FROM filings WHERE id = $1", [req.params.id]);
      if (!filing) return res.status(404).json({ error: "Filing not found" });
      if (filing.status !== "filed") return res.status(400).json({ error: "This filing isn't marked as filed" });
      await dbRun("UPDATE filings SET status = 'preparing', filed_date = NULL, reference_no = NULL, filed_by = NULL WHERE id = $1", [filing.id]);
      await logEvent(filing.id, "reopened", "Filing reopened by an admin", req.user.username);
      res.json(await loadFilingView(filing.id));
    } catch (err) {
      next(err);
    }
  });

  // ---------- Checklist editor (admin) ----------
  // Edits apply to filings started from now on; filings already in progress keep
  // the checklist they were created with.

  function cleanTemplateBody(body) {
    const label = String(body.label || "").trim();
    if (!label) return { error: "A label is required" };
    if (!FILING_TYPES.includes(body.filingType)) return { error: "filingType must be gst or agm" };
    const category = body.category ? String(body.category) : null;
    if (category && !["secretarial", "bookkeeping", "banking_tax", "personal"].includes(category)) return { error: "Unknown category" };
    const scope = body.periodScope === "any" ? "any" : "period";
    return {
      value: {
        filingType: body.filingType,
        label,
        category,
        subtype: String(body.subtype || "").trim() || null,
        keyword: String(body.keyword || "").trim() || null,
        scope,
        required: body.required === false || body.required === 0 ? 0 : 1,
      },
    };
  }

  app.post("/api/filing-templates", requireAdmin, async (req, res, next) => {
    try {
      const { value, error } = cleanTemplateBody(req.body);
      if (error) return res.status(400).json({ error });
      const max = await dbGet("SELECT COALESCE(MAX(sort_order), 0) AS m FROM filing_templates WHERE filing_type = $1", [value.filingType]);
      const created = await dbGet(
        `INSERT INTO filing_templates (filing_type, label, category, subtype, keyword, period_scope, required, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [value.filingType, value.label, value.category, value.subtype, value.keyword, value.scope, value.required, Number(max.m) + 10]
      );
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.patch("/api/filing-templates/:id", requireAdmin, async (req, res, next) => {
    try {
      const existing = await dbGet("SELECT * FROM filing_templates WHERE id = $1 AND active = 1", [req.params.id]);
      if (!existing) return res.status(404).json({ error: "Checklist item not found" });
      const { value, error } = cleanTemplateBody({ filingType: existing.filing_type, ...req.body });
      if (error) return res.status(400).json({ error });
      const updated = await dbGet(
        `UPDATE filing_templates SET label = $1, category = $2, subtype = $3, keyword = $4, period_scope = $5, required = $6
         WHERE id = $7 RETURNING *`,
        [value.label, value.category, value.subtype, value.keyword, value.scope, value.required, existing.id]
      );
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete("/api/filing-templates/:id", requireAdmin, async (req, res, next) => {
    try {
      const existing = await dbGet("SELECT id FROM filing_templates WHERE id = $1 AND active = 1", [req.params.id]);
      if (!existing) return res.status(404).json({ error: "Checklist item not found" });
      await dbRun("UPDATE filing_templates SET active = 0 WHERE id = $1", [existing.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return { loadFilingView, logEvent };
}

module.exports = { FILING_TYPES, initFilingSchema, registerFilingRoutes, monthLabelsBetween, documentMatchesItem, safeName, isIsoDate };
