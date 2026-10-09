// Digital KYC form — the personal-particulars form a customer used to fill in
// on paper, completed on screen instead. The details are stored once as a
// record; the app also files a PDF of the signed form with the client's
// documents (see dashboard/src/Kyc.jsx).

const KYC_SCHEMA = `
  CREATE TABLE IF NOT EXISTS kyc_records (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    role TEXT,
    full_name TEXT NOT NULL,
    chinese_name TEXT,
    birthplace TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    nationality_current TEXT NOT NULL,
    nationality_birth TEXT NOT NULL,
    travel_doc_type TEXT,
    travel_doc_no TEXT,
    travel_doc_issue_date TEXT,
    travel_doc_country TEXT,
    id_card_no TEXT,
    id_card_issue_date TEXT,
    id_card_country TEXT,
    address_sg TEXT,
    phone TEXT,
    email TEXT,
    address_overseas TEXT,
    address_other TEXT,
    residence TEXT,                 -- JSON: [{ from, to, country }], empty when not applicable
    completed_by_name TEXT NOT NULL,
    signature TEXT NOT NULL,        -- PNG data URL of the on-screen signature
    consent_text TEXT NOT NULL,     -- the exact wording the person agreed to
    consented_at TEXT NOT NULL,
    document_id INTEGER REFERENCES documents(id),   -- register entry holding the PDF copy
    file_id INTEGER,                                -- the PDF itself (document_files.id)
    handed_by TEXT NOT NULL,        -- staff member logged in when the form was completed
    verified_by TEXT,               -- staff member who compared the form with the customer's actual ID
    verified_at TEXT,
    verify_note TEXT,
    created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE TABLE IF NOT EXISTS kyc_access_log (
    id SERIAL PRIMARY KEY,
    kyc_id INTEGER NOT NULL,
    staff TEXT NOT NULL,
    action TEXT NOT NULL,
    logged_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );

  CREATE INDEX IF NOT EXISTS idx_kyc_records_client ON kyc_records(client_id);
`;

// Never lets a problem here stop the app from starting.
async function initKycSchema({ dbRun }) {
  try {
    await dbRun(KYC_SCHEMA);
  } catch (err) {
    console.error("KYC form setup failed (the rest of the app is unaffected):", err);
    return;
  }
  // Added after the first release of this form: signing by hand on a printed copy,
  // and keeping the scanned signed copy. Each is added on its own so one failure
  // can't block the others.
  for (const sql of [
    "ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS signature_method TEXT NOT NULL DEFAULT 'screen'",
    "ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS signed_file_id INTEGER",
    "ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS signed_at TEXT",
    "ALTER TABLE kyc_records ADD COLUMN IF NOT EXISTS signed_by TEXT",
  ]) {
    try {
      await dbRun(sql);
    } catch (err) {
      console.error("KYC form upgrade step failed:", err.message);
    }
  }
}

const ROLES = ["Director", "Shareholder", "Secretary", "Beneficial owner", "Other"];
const TRAVEL_DOC_TYPES = ["Passport", "Certificate of Identity", "Document of Identity", "Others"];

function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function clean(value, max = 300) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}
function cleanMultiline(value, max = 500) {
  return String(value == null ? "" : value).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

// Keeps the last four characters visible — enough to recognise, not enough to misuse.
function maskId(value) {
  const s = String(value || "");
  if (s.length <= 4) return s ? "••••" : "";
  return "•".repeat(s.length - 4) + s.slice(-4);
}

// Returns { value } with cleaned fields, or { error } with a message fit to show the customer.
function validateKycBody(body) {
  const b = body || {};
  const v = {
    role: ROLES.includes(b.role) ? b.role : null,
    fullName: clean(b.fullName),
    chineseName: clean(b.chineseName),
    birthplace: clean(b.birthplace),
    dateOfBirth: clean(b.dateOfBirth, 10),
    nationalityCurrent: clean(b.nationalityCurrent),
    nationalityBirth: clean(b.nationalityBirth),
    travelDocType: TRAVEL_DOC_TYPES.includes(b.travelDocType) ? b.travelDocType : null,
    travelDocNo: clean(b.travelDocNo, 40),
    travelDocIssueDate: clean(b.travelDocIssueDate, 10),
    travelDocCountry: clean(b.travelDocCountry),
    idCardNo: clean(b.idCardNo, 40).toUpperCase(),
    idCardIssueDate: clean(b.idCardIssueDate, 10),
    idCardCountry: clean(b.idCardCountry),
    addressSg: cleanMultiline(b.addressSg),
    phone: clean(b.phone, 40),
    email: clean(b.email, 120),
    addressOverseas: cleanMultiline(b.addressOverseas),
    addressOther: cleanMultiline(b.addressOther),
    completedByName: clean(b.completedByName),
    // "screen": signed on the device. "paper": printed, signed by hand, and the scan uploaded later.
    signatureMethod: b.signatureMethod === "paper" ? "paper" : "screen",
    signature: String(b.signature || ""),
    consentText: cleanMultiline(b.consentText, 1500),
    consent: b.consent === true,
  };

  if (!v.fullName) return { error: "Please enter your full name." };
  if (!v.birthplace) return { error: "Please enter your town and place of birth." };
  if (!isIsoDate(v.dateOfBirth)) return { error: "Please enter your date of birth." };
  if (v.dateOfBirth > new Date().toISOString().slice(0, 10)) return { error: "Date of birth can't be in the future." };
  if (!v.nationalityCurrent || !v.nationalityBirth) return { error: "Please enter your nationality now and at birth." };
  for (const [label, date] of [["travel document", v.travelDocIssueDate], ["identity card", v.idCardIssueDate]]) {
    if (date && !isIsoDate(date)) return { error: `The ${label} issue date isn't a valid date.` };
  }
  if (!v.idCardNo && !v.travelDocNo) return { error: "Please give your identity card number or your travel document number." };
  if (v.idCardNo && !/^[A-Z0-9-]{5,20}$/.test(v.idCardNo)) return { error: "The identity card number looks wrong — please check it." };
  if (!v.addressSg && !v.addressOverseas) return { error: "Please give your address in Singapore or overseas." };
  if (!v.phone) return { error: "Please enter a phone number." };
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return { error: "The email address doesn't look right." };
  if (!v.completedByName) return { error: "Please enter the name of the person completing this form." };
  if (v.signatureMethod === "paper") {
    v.signature = ""; // signed by hand on the printed copy instead
  } else {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v.signature) || v.signature.length < 400) return { error: "Please sign in the signature box." };
    if (v.signature.length > 400000) return { error: "The signature image is too large — please sign again." };
  }
  if (!v.consent || !v.consentText) return { error: "Please tick the confirmation box." };

  let residence = [];
  if (Array.isArray(b.residence)) {
    residence = b.residence
      .slice(0, 5)
      .map((r) => ({ from: clean(r && r.from, 10), to: clean(r && r.to, 10), country: clean(r && r.country) }))
      .filter((r) => r.country || r.from || r.to);
    for (const r of residence) {
      if (!r.country) return { error: "Each period of residence needs a country." };
      if ((r.from && !isIsoDate(r.from)) || (r.to && !isIsoDate(r.to))) return { error: "A residence period has an invalid date." };
    }
  }
  v.residence = residence;
  return { value: v };
}

// A record as listed on the client's page: ID numbers masked, no signature image.
function toListItem(row) {
  return {
    id: row.id,
    role: row.role,
    full_name: row.full_name,
    date_of_birth: row.date_of_birth,
    nationality_current: row.nationality_current,
    id_card_no_masked: maskId(row.id_card_no),
    travel_doc_no_masked: maskId(row.travel_doc_no),
    document_id: row.document_id,
    file_id: row.file_id,
    signature_method: row.signature_method || "screen",
    signed_file_id: row.signed_file_id || null,
    signed_at: row.signed_at || null,
    signed_by: row.signed_by || null,
    // screen-signed forms are signed on submission; paper ones are waiting until the scan is uploaded
    sign_status: (row.signature_method || "screen") === "paper" ? (row.signed_file_id ? "signed" : "awaiting_signature") : "signed",
    handed_by: row.handed_by,
    verified_by: row.verified_by,
    verified_at: row.verified_at,
    verify_note: row.verify_note,
    created_at: row.created_at,
  };
}

function registerKycRoutes(app, { dbGet, dbAll, dbRun }) {
  app.get("/api/clients/:id/kyc", async (req, res, next) => {
    try {
      const rows = await dbAll("SELECT * FROM kyc_records WHERE client_id = $1 ORDER BY created_at DESC, id DESC", [req.params.id]);
      res.json(rows.map(toListItem));
    } catch (err) {
      next(err);
    }
  });

  // Full details (unmasked, with the signature) — every read is recorded.
  app.get("/api/kyc/:id", async (req, res, next) => {
    try {
      const row = await dbGet("SELECT * FROM kyc_records WHERE id = $1", [req.params.id]);
      if (!row) return res.status(404).json({ error: "KYC record not found" });
      try {
        await dbRun("INSERT INTO kyc_access_log (kyc_id, staff, action) VALUES ($1, $2, 'viewed')", [row.id, req.user.username]);
      } catch (err) {
        console.error("Could not record KYC access:", err.message);
      }
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/clients/:id/kyc", async (req, res, next) => {
    try {
      const client = await dbGet("SELECT id FROM clients WHERE id = $1", [req.params.id]);
      if (!client) return res.status(404).json({ error: "Client not found" });
      const { value: v, error } = validateKycBody(req.body);
      if (error) return res.status(400).json({ error });
      const created = await dbGet(
        `INSERT INTO kyc_records
          (client_id, role, full_name, chinese_name, birthplace, date_of_birth, nationality_current, nationality_birth,
           travel_doc_type, travel_doc_no, travel_doc_issue_date, travel_doc_country,
           id_card_no, id_card_issue_date, id_card_country,
           address_sg, phone, email, address_overseas, address_other, residence,
           completed_by_name, signature, consent_text, consented_at, handed_by, signature_method)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),$25,$26)
         RETURNING *`,
        [
          client.id, v.role, v.fullName, v.chineseName || null, v.birthplace, v.dateOfBirth, v.nationalityCurrent, v.nationalityBirth,
          v.travelDocType, v.travelDocNo || null, v.travelDocIssueDate || null, v.travelDocCountry || null,
          v.idCardNo || null, v.idCardIssueDate || null, v.idCardCountry || null,
          v.addressSg || null, v.phone, v.email || null, v.addressOverseas || null, v.addressOther || null, JSON.stringify(v.residence),
          v.completedByName, v.signature, v.consentText, req.user.username, v.signatureMethod,
        ]
      );
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  // Staff confirm they've compared the form with the customer's actual ID. The
  // person who handed the tablet over can verify too — it's one small office —
  // but who verified and when is always recorded.
  app.post("/api/kyc/:id/verify", async (req, res, next) => {
    try {
      const row = await dbGet("SELECT * FROM kyc_records WHERE id = $1", [req.params.id]);
      if (!row) return res.status(404).json({ error: "KYC record not found" });
      if (row.verified_at) return res.status(400).json({ error: `Already verified by ${row.verified_by} on ${row.verified_at.slice(0, 10)}` });
      const note = cleanMultiline(req.body && req.body.note, 300);
      const updated = await dbGet(
        `UPDATE kyc_records SET verified_by = $1, verified_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), verify_note = $2
         WHERE id = $3 RETURNING *`,
        [req.user.username, note || null, row.id]
      );
      try {
        await dbRun("INSERT INTO kyc_access_log (kyc_id, staff, action) VALUES ($1, $2, 'verified')", [row.id, req.user.username]);
      } catch (err) {
        console.error("Could not record KYC verification:", err.message);
      }
      res.json(toListItem(updated));
    } catch (err) {
      next(err);
    }
  });

  // The printed form, signed by hand and scanned or photographed, has been
  // uploaded against this record's register entry — remember which file it is.
  app.post("/api/kyc/:id/signed", async (req, res, next) => {
    try {
      const row = await dbGet("SELECT * FROM kyc_records WHERE id = $1", [req.params.id]);
      if (!row) return res.status(404).json({ error: "KYC record not found" });
      if (!row.document_id) return res.status(400).json({ error: "File the PDF copy first, then upload the signed copy against it." });
      const file = await dbGet("SELECT id FROM document_files WHERE id = $1 AND document_id = $2", [req.body.fileId, row.document_id]);
      if (!file) return res.status(404).json({ error: "That file isn't attached to this form's register entry" });
      const updated = await dbGet(
        "UPDATE kyc_records SET signed_file_id = $1, signed_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), signed_by = $2 WHERE id = $3 RETURNING *",
        [file.id, req.user.username, row.id]
      );
      try {
        await dbRun("INSERT INTO kyc_access_log (kyc_id, staff, action) VALUES ($1, $2, 'signed copy uploaded')", [row.id, req.user.username]);
      } catch (err) {
        console.error("Could not record signed-copy upload:", err.message);
      }
      res.json(toListItem(updated));
    } catch (err) {
      next(err);
    }
  });

  // Once the PDF copy has been filed in the register, remember where it is.
  app.patch("/api/kyc/:id/link", async (req, res, next) => {
    try {
      const row = await dbGet("SELECT * FROM kyc_records WHERE id = $1", [req.params.id]);
      if (!row) return res.status(404).json({ error: "KYC record not found" });
      const doc = await dbGet("SELECT id FROM documents WHERE id = $1 AND client_id = $2", [req.body.documentId, row.client_id]);
      if (!doc) return res.status(404).json({ error: "That register entry doesn't belong to this client" });
      const updated = await dbGet("UPDATE kyc_records SET document_id = $1, file_id = $2 WHERE id = $3 RETURNING *", [doc.id, req.body.fileId || null, row.id]);
      res.json(toListItem(updated));
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { initKycSchema, registerKycRoutes, validateKycBody, maskId, clean, cleanMultiline, isIsoDate, ROLES, TRAVEL_DOC_TYPES };
