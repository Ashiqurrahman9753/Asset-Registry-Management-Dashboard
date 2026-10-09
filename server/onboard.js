// Onboarding — the PEP declaration (Part 2) and enhanced due diligence (Section D)
// form, plus the summary behind the Onboarding tab that shows, for every client,
// how far their onboarding paperwork has got. The personal particulars (KYC) form
// lives in kyc.js; this builds on the same ideas: details stored once, a PDF copy
// filed with the client's documents, optional signing by hand on a printed copy,
// and a staff "verified" step.
const { maskId, clean, cleanMultiline, isIsoDate } = require("./kyc.js");

const PEP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS pep_records (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    kyc_id INTEGER,                    -- the person's KYC record, when chosen from the list
    person_name TEXT NOT NULL,
    id_number TEXT NOT NULL,           -- NRIC / FIN / passport number
    pep_types TEXT NOT NULL,           -- JSON array: sg_pep, foreign_pep, intl_org_pep, family_member, close_associate
    family_relationship TEXT,
    associate_relationship TEXT,
    pep_name TEXT NOT NULL,
    pep_country TEXT NOT NULL,         -- country / international organisation of the prominent public function
    pep_function TEXT NOT NULL,        -- nature of the prominent public function
    pep_period TEXT,
    source_of_wealth TEXT,             -- Section D: enhanced due diligence
    source_of_funds TEXT,
    other_info TEXT,
    declaration_date TEXT NOT NULL,
    declaration_text TEXT NOT NULL,    -- the exact declaration the person agreed to
    signature_method TEXT NOT NULL DEFAULT 'screen',
    signature TEXT NOT NULL,           -- PNG data URL, or empty when signed by hand on paper
    document_id INTEGER REFERENCES documents(id),
    file_id INTEGER,
    signed_file_id INTEGER,
    signed_at TEXT,
    signed_by TEXT,
    handed_by TEXT NOT NULL,
    verified_by TEXT,
    verified_at TEXT,
    verify_note TEXT,
    created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE TABLE IF NOT EXISTS pep_access_log (
    id SERIAL PRIMARY KEY,
    pep_id INTEGER NOT NULL,
    staff TEXT NOT NULL,
    action TEXT NOT NULL,
    logged_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE INDEX IF NOT EXISTS idx_pep_records_client ON pep_records(client_id);

  -- Forms that were already filled in and signed before the app: just the scan/PDF, kept as is.
  CREATE TABLE IF NOT EXISTS uploaded_forms (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    form_type TEXT NOT NULL,           -- kyc | pep | other
    person_name TEXT,
    document_id INTEGER,
    file_id INTEGER NOT NULL,
    note TEXT,
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );
  CREATE INDEX IF NOT EXISTS idx_uploaded_forms_client ON uploaded_forms(client_id);
`;

// Never lets a problem here stop the app from starting.
async function initOnboardingSchema({ dbRun }) {
  try {
    await dbRun(PEP_SCHEMA);
  } catch (err) {
    console.error("PEP form setup failed (the rest of the app is unaffected):", err);
  }
}

const PEP_TYPES = ["sg_pep", "foreign_pep", "intl_org_pep", "family_member", "close_associate"];

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Returns { value } with cleaned fields, or { error } with a message fit to show the customer.
function validatePepBody(body) {
  const b = body || {};
  const types = Array.isArray(b.pepTypes) ? [...new Set(b.pepTypes.filter((t) => PEP_TYPES.includes(t)))] : [];
  const v = {
    kycId: Number.isInteger(b.kycId) ? b.kycId : null,
    personName: clean(b.personName),
    idNumber: clean(b.idNumber, 40).toUpperCase(),
    pepTypes: types,
    familyRelationship: clean(b.familyRelationship, 200),
    associateRelationship: clean(b.associateRelationship, 200),
    pepName: clean(b.pepName),
    pepCountry: clean(b.pepCountry),
    pepFunction: cleanMultiline(b.pepFunction, 600),
    pepPeriod: clean(b.pepPeriod, 120),
    sourceOfWealth: cleanMultiline(b.sourceOfWealth, 1500),
    sourceOfFunds: cleanMultiline(b.sourceOfFunds, 1500),
    otherInfo: cleanMultiline(b.otherInfo, 1500),
    declarationDate: clean(b.declarationDate, 10) || todayLocal(),
    declarationText: cleanMultiline(b.declarationText, 1500),
    declared: b.declared === true,
    signatureMethod: b.signatureMethod === "paper" ? "paper" : "screen",
    signature: String(b.signature || ""),
  };

  if (!v.personName) return { error: "Please enter the name of the customer." };
  if (!/^[A-Z0-9-]{5,20}$/.test(v.idNumber)) return { error: "Please enter the NRIC, FIN or passport number correctly." };
  if (v.pepTypes.length === 0) return { error: "Please tick at least one box under \"Is the identified individual a:\"." };
  if (v.pepTypes.includes("family_member") && !v.familyRelationship) return { error: "Please describe the relationship with the PEP (family member)." };
  if (v.pepTypes.includes("close_associate") && !v.associateRelationship) return { error: "Please describe the relationship with the PEP (close associate)." };
  if (!v.pepName) return { error: "Please enter the name of the PEP." };
  if (!v.pepCountry) return { error: "Please enter the country or international organisation where the PEP holds a prominent public function." };
  if (!v.pepFunction) return { error: "Please describe the nature of the prominent public function." };
  if (!isIsoDate(v.declarationDate)) return { error: "The declaration date isn't a valid date." };
  if (v.declarationDate > todayLocal()) return { error: "The declaration date can't be in the future." };
  if (!v.declared || !v.declarationText) return { error: "Please tick the declaration box." };
  if (v.signatureMethod === "paper") {
    v.signature = "";
  } else {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v.signature) || v.signature.length < 400) return { error: "Please sign in the signature box." };
    if (v.signature.length > 400000) return { error: "The signature image is too large — please sign again." };
  }
  return { value: v };
}

function toListItem(row) {
  return {
    id: row.id,
    kyc_id: row.kyc_id,
    person_name: row.person_name,
    id_masked: maskId(row.id_number),
    pep_types: row.pep_types,
    pep_name: row.pep_name,
    pep_country: row.pep_country,
    declaration_date: row.declaration_date,
    document_id: row.document_id,
    file_id: row.file_id,
    signature_method: row.signature_method || "screen",
    signed_file_id: row.signed_file_id || null,
    signed_at: row.signed_at || null,
    signed_by: row.signed_by || null,
    sign_status: (row.signature_method || "screen") === "paper" ? (row.signed_file_id ? "signed" : "awaiting_signature") : "signed",
    handed_by: row.handed_by,
    verified_by: row.verified_by,
    verified_at: row.verified_at,
    verify_note: row.verify_note,
    created_at: row.created_at,
  };
}

function registerOnboardingRoutes(app, { dbGet, dbAll, dbRun }) {
  async function note(table, idCol, id, staff, action) {
    try {
      await dbRun(`INSERT INTO ${table} (${idCol}, staff, action) VALUES ($1, $2, $3)`, [id, staff, action]);
    } catch (err) {
      console.error("Could not record PEP form activity:", err.message);
    }
  }

  app.get("/api/clients/:id/pep", async (req, res, next) => {
    try {
      const rows = await dbAll("SELECT * FROM pep_records WHERE client_id = $1 ORDER BY created_at DESC, id DESC", [req.params.id]);
      res.json(rows.map(toListItem));
    } catch (err) {
      next(err);
    }
  });

  // Full details (unmasked, with the signature) — every read is recorded.
  app.get("/api/pep/:id", async (req, res, next) => {
    try {
      const row = await dbGet("SELECT * FROM pep_records WHERE id = $1", [req.params.id]);
      if (!row) return res.status(404).json({ error: "PEP form not found" });
      await note("pep_access_log", "pep_id", row.id, req.user.username, "viewed");
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/clients/:id/pep", async (req, res, next) => {
    try {
      const client = await dbGet("SELECT id FROM clients WHERE id = $1", [req.params.id]);
      if (!client) return res.status(404).json({ error: "Client not found" });
      const { value: v, error } = validatePepBody(req.body);
      if (error) return res.status(400).json({ error });
      const created = await dbGet(
        `INSERT INTO pep_records
          (client_id, kyc_id, person_name, id_number, pep_types, family_relationship, associate_relationship,
           pep_name, pep_country, pep_function, pep_period, source_of_wealth, source_of_funds, other_info,
           declaration_date, declaration_text, signature_method, signature, handed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING *`,
        [
          client.id, v.kycId, v.personName, v.idNumber, JSON.stringify(v.pepTypes), v.familyRelationship || null, v.associateRelationship || null,
          v.pepName, v.pepCountry, v.pepFunction, v.pepPeriod || null, v.sourceOfWealth || null, v.sourceOfFunds || null, v.otherInfo || null,
          v.declarationDate, v.declarationText, v.signatureMethod, v.signature, req.user.username,
        ]
      );
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/pep/:id/verify", async (req, res, next) => {
    try {
      const row = await dbGet("SELECT * FROM pep_records WHERE id = $1", [req.params.id]);
      if (!row) return res.status(404).json({ error: "PEP form not found" });
      if (row.verified_at) return res.status(400).json({ error: `Already verified by ${row.verified_by} on ${row.verified_at.slice(0, 10)}` });
      const updated = await dbGet(
        `UPDATE pep_records SET verified_by = $1, verified_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), verify_note = $2 WHERE id = $3 RETURNING *`,
        [req.user.username, cleanMultiline(req.body && req.body.note, 300) || null, row.id]
      );
      await note("pep_access_log", "pep_id", row.id, req.user.username, "verified");
      res.json(toListItem(updated));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/pep/:id/signed", async (req, res, next) => {
    try {
      const row = await dbGet("SELECT * FROM pep_records WHERE id = $1", [req.params.id]);
      if (!row) return res.status(404).json({ error: "PEP form not found" });
      if (!row.document_id) return res.status(400).json({ error: "File the PDF copy first, then upload the signed copy against it." });
      const file = await dbGet("SELECT id FROM document_files WHERE id = $1 AND document_id = $2", [req.body.fileId, row.document_id]);
      if (!file) return res.status(404).json({ error: "That file isn't attached to this form's register entry" });
      const updated = await dbGet(
        "UPDATE pep_records SET signed_file_id = $1, signed_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), signed_by = $2 WHERE id = $3 RETURNING *",
        [file.id, req.user.username, row.id]
      );
      await note("pep_access_log", "pep_id", row.id, req.user.username, "signed copy uploaded");
      res.json(toListItem(updated));
    } catch (err) {
      next(err);
    }
  });

  app.patch("/api/pep/:id/link", async (req, res, next) => {
    try {
      const row = await dbGet("SELECT * FROM pep_records WHERE id = $1", [req.params.id]);
      if (!row) return res.status(404).json({ error: "PEP form not found" });
      const doc = await dbGet("SELECT id FROM documents WHERE id = $1 AND client_id = $2", [req.body.documentId, row.client_id]);
      if (!doc) return res.status(404).json({ error: "That register entry doesn't belong to this client" });
      const updated = await dbGet("UPDATE pep_records SET document_id = $1, file_id = $2 WHERE id = $3 RETURNING *", [doc.id, req.body.fileId || null, row.id]);
      res.json(toListItem(updated));
    } catch (err) {
      next(err);
    }
  });

  // Already-filled forms uploaded as they are (no data extracted).
  app.get("/api/clients/:id/uploaded-forms", async (req, res, next) => {
    try {
      res.json(await dbAll("SELECT * FROM uploaded_forms WHERE client_id = $1 ORDER BY id DESC", [req.params.id]));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/clients/:id/uploaded-forms", async (req, res, next) => {
    try {
      const b = req.body || {};
      const formType = ["kyc", "pep", "other"].includes(b.formType) ? b.formType : null;
      if (!formType) return res.status(400).json({ error: "Choose what kind of form it is." });
      const doc = await dbGet("SELECT id FROM documents WHERE id = $1 AND client_id = $2", [b.documentId, req.params.id]);
      if (!doc) return res.status(404).json({ error: "That register entry doesn't belong to this client" });
      const file = await dbGet("SELECT id FROM document_files WHERE id = $1 AND document_id = $2", [b.fileId, doc.id]);
      if (!file) return res.status(404).json({ error: "That file isn't attached to the register entry" });
      const created = await dbGet(
        `INSERT INTO uploaded_forms (client_id, form_type, person_name, document_id, file_id, note, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.params.id, formType, clean(b.personName) || null, doc.id, file.id, cleanMultiline(b.note, 300) || null, req.user.username]
      );
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  // One row per client for the Onboarding tab: how many forms, and what's still waiting.
  app.get("/api/onboarding/summary", async (req, res, next) => {
    try {
      const count = (table, where = "") => `(SELECT COUNT(*) FROM ${table} t WHERE t.client_id = c.id ${where})`;
      let rows;
      try {
        rows = await dbAll(
          `SELECT c.id, c.file_no, c.company, c.status,
             ${count("kyc_records")} AS kyc_total,
             ${count("kyc_records", "AND t.verified_at IS NOT NULL")} AS kyc_verified,
             ${count("kyc_records", "AND t.signature_method = 'paper' AND t.signed_file_id IS NULL")} AS kyc_unsigned,
             ${count("pep_records")} AS pep_total,
             ${count("pep_records", "AND t.verified_at IS NOT NULL")} AS pep_verified,
             ${count("pep_records", "AND t.signature_method = 'paper' AND t.signed_file_id IS NULL")} AS pep_unsigned,
             ${count("uploaded_forms")} AS uploaded_total
           FROM clients c ORDER BY c.company ASC`
        );
      } catch (err) {
        // The PEP table couldn't be created on this install — still show the KYC side.
        console.error("Onboarding summary fell back to KYC only:", err.message);
        rows = await dbAll(
          `SELECT c.id, c.file_no, c.company, c.status,
             ${count("kyc_records")} AS kyc_total,
             ${count("kyc_records", "AND t.verified_at IS NOT NULL")} AS kyc_verified,
             ${count("kyc_records", "AND t.signature_method = 'paper' AND t.signed_file_id IS NULL")} AS kyc_unsigned,
             0 AS pep_total, 0 AS pep_verified, 0 AS pep_unsigned
           FROM clients c ORDER BY c.company ASC`
        );
      }
      res.json(
        rows.map((r) => {
          const n = (k) => Number(r[k] || 0);
          const total = n("kyc_total") + n("pep_total") + n("uploaded_total"); // uploaded forms count as already checked
          const verified = n("kyc_verified") + n("pep_verified") + n("uploaded_total");
          const unsigned = n("kyc_unsigned") + n("pep_unsigned");
          let stage = "not_started";
          if (total > 0) stage = unsigned === 0 && verified === total ? "complete" : "in_progress";
          return {
            client_id: r.id,
            file_no: r.file_no,
            company: r.company,
            client_status: r.status,
            kyc_total: n("kyc_total"),
            kyc_verified: n("kyc_verified"),
            pep_total: n("pep_total"),
            pep_verified: n("pep_verified"),
            uploaded_total: n("uploaded_total"),
            awaiting_signature: unsigned,
            awaiting_verification: total - verified,
            stage,
          };
        })
      );
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { initOnboardingSchema, registerOnboardingRoutes, validatePepBody, PEP_TYPES };
