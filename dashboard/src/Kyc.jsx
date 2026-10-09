import React, { useState, useEffect, useRef } from "react";
import { X, Download, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { BRAND_GREEN, BRAND_GREEN_DEEP, HIGHLIGHT_BG, HIGHLIGHT_TEXT } from "./theme.jsx";
import {
  fetchClientKyc,
  fetchKycRecord,
  createKycRecord,
  linkKycFiles,
  verifyKycRecord,
  createDocument,
  uploadDocumentFile,
  downloadDocumentFile,
  openDocumentFile,
} from "./api.js";
import { checkSgId, isoToDisplay, kycRowToData, renderKycPdf } from "./KycPdf.js";

// Digital KYC form. The customer fills it in on the screen and signs; staff
// then review it against the person's real ID and mark it verified. A PDF of
// the signed form is filed with the client's documents.

const FIRM_NAME = "Jardeen Management";
const ROLES = ["Director", "Shareholder", "Secretary", "Beneficial owner", "Other"];
const TRAVEL_DOC_TYPES = ["Passport", "Certificate of Identity", "Document of Identity", "Others"];

// The wording the customer agrees to. Have the client's compliance adviser
// confirm it before relying on it.
function consentWording(company) {
  return `I confirm that the information I have given on this form is true and complete. I consent to ${FIRM_NAME} collecting, using and keeping these personal details to verify my identity and to meet legal and regulatory requirements relating to ${company}.`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPTY = {
  role: "",
  fullName: "",
  chineseName: "",
  birthplace: "",
  dateOfBirth: "",
  nationalityCurrent: "",
  nationalityBirth: "",
  travelDocType: "",
  travelDocNo: "",
  travelDocIssueDate: "",
  travelDocCountry: "",
  idCardNo: "",
  idCardIssueDate: "",
  idCardCountry: "",
  addressSg: "",
  phone: "",
  email: "",
  addressOverseas: "",
  addressOther: "",
  completedByName: "",
};

// Everything wrong with the form as it stands, in plain words.
function findProblems(f, signature, consent, residenceNA, residence) {
  const out = [];
  if (!f.fullName.trim()) out.push("Your full name (1)");
  if (!f.birthplace.trim()) out.push("Your town and place of birth (2)");
  if (!f.dateOfBirth) out.push("Your date of birth (2)");
  else if (f.dateOfBirth > todayIso()) out.push("Your date of birth can't be in the future (2)");
  if (!f.nationalityCurrent.trim() || !f.nationalityBirth.trim()) out.push("Your nationality now and at birth (3)");
  if (!f.idCardNo.trim() && !f.travelDocNo.trim()) out.push("Your identity card number or travel document number (4 or 5)");
  if (!f.addressSg.trim() && !f.addressOverseas.trim()) out.push("Your address in Singapore or overseas (6)");
  if (!f.phone.trim()) out.push("A phone number (6)");
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) out.push("The email address doesn't look right (6)");
  if (!residenceNA && residence.some((r) => !r.country.trim() && (r.from || r.to))) out.push("Each period of residence needs a country (7)");
  if (!f.completedByName.trim()) out.push("The name of the person completing this form");
  if (!signature) out.push("Your signature");
  if (!consent) out.push("The confirmation box at the bottom");
  return out;
}

// ---------- Signature pad ----------

const PAD_W = 700;
const PAD_H = 220;

function SignaturePad({ onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = PAD_W * dpr;
    canvas.height = PAD_H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    ctx.fillStyle = "#111";
  }, []);

  function point(e) {
    const r = ref.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * PAD_W) / r.width, y: ((e.clientY - r.top) * PAD_H) / r.height };
  }
  function down(e) {
    e.preventDefault();
    if (ref.current.setPointerCapture) ref.current.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    last.current = p;
    const ctx = ref.current.getContext("2d");
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const p = point(e);
    const ctx = ref.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    setHasInk(true);
    onChange(ref.current.toDataURL("image/png"));
  }
  function clear() {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasInk(false);
    onChange("");
  }

  return (
    <div>
      <div style={{ border: "2px dashed #8A8577", background: "#fff", position: "relative", maxWidth: PAD_W }}>
        <canvas
          ref={ref}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          style={{ display: "block", width: "100%", aspectRatio: `${PAD_W} / ${PAD_H}`, touchAction: "none", cursor: "crosshair" }}
        />
        {!hasInk && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#B0AA9A", fontSize: 18, pointerEvents: "none" }}>
            Sign here with your finger, pen or mouse
          </div>
        )}
      </div>
      <button type="button" onClick={clear} style={{ marginTop: 8, border: "1px solid #C9C4B6", background: "#fff", padding: "8px 16px", fontSize: 14, cursor: "pointer" }}>
        Clear and sign again
      </button>
    </div>
  );
}

// ---------- The form the customer fills in ----------

const bigInput = { width: "100%", boxSizing: "border-box", border: "1px solid #8A8577", background: "#fff", padding: "13px 14px", fontSize: 18, fontFamily: "inherit", color: "#1C2430" };
const sectionBox = { background: "#fff", border: "1px solid #C9C4B6", padding: "18px 20px", marginBottom: 16 };

function KycForm({ client, user, onClose, onSaved }) {
  const company = client.company;
  const [f, setF] = useState({ ...EMPTY });
  const [residenceNA, setResidenceNA] = useState(true);
  const [residence, setResidence] = useState([{ from: "", to: "", country: "" }]);
  const [signature, setSignature] = useState("");
  const [consent, setConsent] = useState(false);
  // Once they've tried to submit, the "please complete" list keeps itself up to date as they fill things in.
  const [attempted, setAttempted] = useState(false);
  const [stage, setStage] = useState("fill"); // fill | saving | done | doneNoPdf
  const [error, setError] = useState("");
  const [pdfError, setPdfError] = useState("");
  const topRef = useRef(null);
  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
  const today = todayIso();
  const idCheck = checkSgId(f.idCardNo);
  const problems = attempted ? findProblems(f, signature, consent, residenceNA, residence) : [];

  function field(label, node, { required, hint } = {}) {
    return (
      <label style={{ display: "block", marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1C2430", marginBottom: 5 }}>
          {label}
          {required && <span style={{ color: "#A63D40" }}> *</span>}
        </div>
        {node}
        {hint && <div style={{ fontSize: 13, color: "#8A8577", marginTop: 4 }}>{hint}</div>}
      </label>
    );
  }
  const text = (k, extra = {}) => <input value={f[k]} onChange={(e) => set(k, e.target.value)} style={bigInput} {...extra} />;
  const date = (k) => <input type="date" value={f[k]} max={today} onChange={(e) => set(k, e.target.value)} style={bigInput} />;
  const heading = (n, title) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>{n}</span>
      <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 700 }}>{title}</span>
    </div>
  );

  async function submit(ev) {
    ev.preventDefault();
    const found = findProblems(f, signature, consent, residenceNA, residence);
    setAttempted(true);
    setError("");
    if (found.length > 0) {
      if (topRef.current) topRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setStage("saving");
    setError("");
    let record;
    try {
      record = await createKycRecord(client.id, {
        ...f,
        role: f.role || null,
        travelDocType: f.travelDocType || null,
        residence: residenceNA ? [] : residence,
        signature,
        consentText: consentWording(company),
        consent: true,
      });
    } catch (err) {
      setStage("fill");
      setError(err.message || "Your form couldn't be saved. Please try again or ask a member of staff.");
      if (topRef.current) topRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // From here the details are safely saved; filing the PDF copy is a second step.
    try {
      await filePdf(record, client, user);
      setStage("done");
    } catch (err) {
      setPdfError(err && err.message ? err.message : "unknown reason");
      setStage("doneNoPdf");
    }
    if (onSaved) onSaved();
  }

  if (stage === "saving") {
    return (
      <Shell>
        <div style={{ textAlign: "center", padding: "90px 0", fontSize: 18, color: "#4A4638" }}>
          <Loader2 size={34} style={{ animation: "fams-spin 1s linear infinite" }} />
          <div style={{ marginTop: 14 }}>Saving your form…</div>
          <style>{"@keyframes fams-spin { to { transform: rotate(360deg); } }"}</style>
        </div>
      </Shell>
    );
  }

  if (stage === "done" || stage === "doneNoPdf") {
    return (
      <Shell>
        <div style={{ textAlign: "center", padding: "70px 10px" }}>
          <CheckCircle2 size={52} color="#2F6F62" />
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 28, fontWeight: 700, marginTop: 14 }}>Thank you</div>
          <div style={{ fontSize: 18, color: "#4A4638", marginTop: 10, lineHeight: 1.6 }}>
            Your form has been received. Please hand the device back to a member of staff.
          </div>
          {stage === "doneNoPdf" && (
            <div style={{ marginTop: 22, fontSize: 14, color: "#7A5215", background: "#FBF1E0", padding: "10px 14px", display: "inline-block" }}>
              Staff note: the details are saved, but the PDF copy couldn&apos;t be filed ({pdfError}). Use &quot;PDF not filed — retry&quot; on the KYC list.
            </div>
          )}
          <div style={{ marginTop: 34 }}>
            <button type="button" onClick={onClose} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "13px 34px", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
              Done
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div ref={topRef} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 13, color: "#8A8577", letterSpacing: 0.5, textTransform: "uppercase" }}>{FIRM_NAME}</div>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 30, fontWeight: 700, marginTop: 2 }}>Personal particulars form</div>
          <div style={{ fontSize: 16, color: "#4A4638", marginTop: 6 }}>For: {company}</div>
        </div>
        <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: "#8A8577", fontSize: 12, flexShrink: 0 }}>
          Staff: cancel
        </button>
      </div>
      <div style={{ fontSize: 16, color: "#4A4638", margin: "10px 0 20px", lineHeight: 1.5 }}>
        Please fill in your own details below. Fields marked <span style={{ color: "#A63D40" }}>*</span> are required. Your form is kept securely by {FIRM_NAME}.
      </div>

      {(problems.length > 0 || error) && (
        <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "14px 18px", marginBottom: 16, fontSize: 15 }}>
          {error && <div style={{ fontWeight: 700 }}>{error}</div>}
          {problems.length > 0 && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Please complete:</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <form onSubmit={submit} noValidate>
        <div style={sectionBox}>
          {field(
            "Your role in the company",
            <select value={f.role} onChange={(e) => set("role", e.target.value)} style={bigInput}>
              <option value="">Choose…</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
        </div>

        <div style={sectionBox}>
          {heading(1, "Name")}
          {field("Full name (as on your identity card or passport)", text("fullName", { autoComplete: "off" }), { required: true })}
          {field("Chinese characters (if any)", text("chineseName"))}
        </div>

        <div style={sectionBox}>
          {heading(2, "Birth")}
          {field("Town and place of birth", text("birthplace"), { required: true })}
          {field("Date of birth", date("dateOfBirth"), { required: true })}
        </div>

        <div style={sectionBox}>
          {heading(3, "Nationality / citizenship")}
          {field("(a) Current", text("nationalityCurrent"), { required: true })}
          {field("(b) At birth", text("nationalityBirth"), { required: true })}
        </div>

        <div style={sectionBox}>
          {heading(4, "Travel document")}
          <div style={{ fontSize: 14, color: "#8A8577", marginBottom: 12 }}>Leave this section blank if you don&apos;t have one.</div>
          {field(
            "Type",
            <select value={f.travelDocType} onChange={(e) => set("travelDocType", e.target.value)} style={bigInput}>
              <option value="">Choose…</option>
              {TRAVEL_DOC_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
          {field("Travel document number", text("travelDocNo", { autoCapitalize: "characters" }))}
          {field("Date of issue", date("travelDocIssueDate"))}
          {field("Country of issue", text("travelDocCountry"))}
        </div>

        <div style={sectionBox}>
          {heading(5, "Identity card")}
          {field("Identity card number", text("idCardNo", { autoCapitalize: "characters", autoComplete: "off" }), { required: !f.travelDocNo.trim() })}
          {idCheck.kind === "invalid" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#7A5215", background: "#FBF1E0", padding: "8px 12px", fontSize: 14, margin: "-6px 0 14px" }}>
              <AlertTriangle size={16} /> This number doesn&apos;t look right. Please check every digit and the last letter.
            </div>
          )}
          {field("(a) Date of issue", date("idCardIssueDate"))}
          {field("(b) Country of issue", text("idCardCountry"))}
        </div>

        <div style={sectionBox}>
          {heading(6, "Address and contact")}
          {field(
            "(a) Address in Singapore",
            <textarea value={f.addressSg} onChange={(e) => set("addressSg", e.target.value)} style={{ ...bigInput, minHeight: 84, resize: "vertical" }} />,
            { required: !f.addressOverseas.trim() }
          )}
          {field("Mobile / phone number", text("phone", { type: "tel" }), { required: true })}
          {field("Email address", text("email", { type: "email", autoCapitalize: "none" }))}
          {field(
            "(b) Address overseas",
            <textarea value={f.addressOverseas} onChange={(e) => set("addressOverseas", e.target.value)} style={{ ...bigInput, minHeight: 70, resize: "vertical" }} />,
            { hint: "Write NIL if none." }
          )}
          {field(
            "(c) Other address",
            <textarea value={f.addressOther} onChange={(e) => set("addressOther", e.target.value)} style={{ ...bigInput, minHeight: 56, resize: "vertical" }} />,
            { hint: "Write NIL if none." }
          )}
        </div>

        <div style={sectionBox}>
          {heading(7, "Countries of residence")}
          <div style={{ fontSize: 14, color: "#8A8577", marginBottom: 12 }}>Only if different from your country of birth.</div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 17, marginBottom: 12 }}>
            <input type="checkbox" checked={residenceNA} onChange={(e) => setResidenceNA(e.target.checked)} style={{ width: 22, height: 22 }} />
            Not applicable
          </label>
          {!residenceNA &&
            residence.map((r, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12, paddingBottom: 12, borderBottom: "1px dashed #D8D3C4" }}>
                <label style={{ fontSize: 14, fontWeight: 600 }}>
                  From
                  <input type="date" value={r.from} max={today} onChange={(e) => setResidence(residence.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} style={{ ...bigInput, marginTop: 4 }} />
                </label>
                <label style={{ fontSize: 14, fontWeight: 600 }}>
                  To
                  <input type="date" value={r.to} max={today} onChange={(e) => setResidence(residence.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} style={{ ...bigInput, marginTop: 4 }} />
                </label>
                <label style={{ fontSize: 14, fontWeight: 600, gridColumn: "1 / -1" }}>
                  Country
                  <input value={r.country} onChange={(e) => setResidence(residence.map((x, j) => (j === i ? { ...x, country: e.target.value } : x)))} style={{ ...bigInput, marginTop: 4 }} />
                </label>
              </div>
            ))}
          {!residenceNA && residence.length < 5 && (
            <button type="button" onClick={() => setResidence([...residence, { from: "", to: "", country: "" }])} style={{ border: "1px solid #C9C4B6", background: "#fff", padding: "9px 16px", fontSize: 14, cursor: "pointer" }}>
              + Add another country
            </button>
          )}
        </div>

        <div style={sectionBox}>
          {heading(8, "Confirmation and signature")}
          <div style={{ fontSize: 15, color: "#4A4638", lineHeight: 1.6, marginBottom: 14 }}>{consentWording(company)}</div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 17, marginBottom: 18 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} />
            <span>I confirm and agree <span style={{ color: "#A63D40" }}>*</span></span>
          </label>
          {field("Name of the person completing this form", text("completedByName"), { required: true })}
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1C2430", marginBottom: 6 }}>
            Signature <span style={{ color: "#A63D40" }}>*</span>
          </div>
          <SignaturePad onChange={setSignature} />
        </div>

        <button type="submit" style={{ width: "100%", background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "16px", fontSize: 19, fontWeight: 700, cursor: "pointer" }}>
          Submit my form
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 58, background: "#F3F0E6", overflowY: "auto" }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "26px 20px 60px", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>{children}</div>
    </div>
  );
}

// Makes the PDF from a saved record, files it in the register against the
// client, and remembers where it went.
async function filePdf(recordRow, client, user) {
  const data = kycRowToData(recordRow, client.company);
  const blob = await renderKycPdf(data);
  const fileName = `KYC - ${recordRow.full_name} - ${todayIso()}.pdf`;
  const doc = await createDocument({
    clientId: client.id,
    category: "personal",
    serviceDetail: `KYC form — ${recordRow.full_name}`,
    location: "Digital copy (no paper)",
    dateReceived: todayIso(),
    loggedBy: user.username,
    isAgmFiling: false,
    isBatch: false,
  });
  const file = await uploadDocumentFile(doc.id, new File([blob], fileName, { type: "application/pdf" }));
  await linkKycFiles(recordRow.id, doc.id, file.id);
}

// ---------- Staff panel ----------

const box = { background: "#fff", border: "1px solid #C9C4B6" };
const smallBtn = { border: "1px solid #C9C4B6", background: "#fff", color: "#1C2430", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" };

export default function KycPanel({ client, user, onClose, onChanged }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRecords(await fetchClientKyc(client.id));
    } catch (err) {
      setError(err.message || "Could not load the KYC forms");
      setRecords([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  async function run(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      return await fn();
    } catch (err) {
      setError(err.message || "Something went wrong");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  function review(rec) {
    if (openId === rec.id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    run(async () => {
      setDetail(await fetchKycRecord(rec.id));
      setOpenId(rec.id);
      setNote("");
    });
  }

  function verify(rec) {
    run(async () => {
      await verifyKycRecord(rec.id, note);
      await load();
      setNotice(`${rec.full_name}'s form is marked as verified.`);
      setOpenId(null);
      setDetail(null);
    });
  }

  function retryPdf(rec) {
    run(async () => {
      const full = detail && detail.id === rec.id ? detail : await fetchKycRecord(rec.id);
      await filePdf(full, client, user);
      await load();
      if (onChanged) onChanged();
      setNotice("The PDF copy has been filed.");
    });
  }

  const pdfName = (rec) => `KYC - ${rec.full_name}.pdf`;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 52, background: "rgba(28,36,48,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: 760, maxWidth: "100%", maxHeight: "92vh", background: "#FBFAF6", padding: 24, overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 19, fontWeight: 700 }}>KYC forms</div>
            <div style={{ fontSize: 12, color: "#8A8577", marginTop: 3 }}>
              {client.company} <span style={{ fontFamily: "monospace" }}>({client.fileNo})</span>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", flexShrink: 0 }} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <button type="button" onClick={() => setFormOpen(true)} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "10px 18px", fontWeight: 600, fontSize: 13, cursor: "pointer", marginBottom: 6 }}>
          Give the form to a customer to fill in
        </button>
        <div style={{ fontSize: 12, color: "#8A8577", marginBottom: 14 }}>It opens full-screen for the customer. Hand over the device, and take it back when they see &quot;Thank you&quot;.</div>

        {error && <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{error}</div>}
        {notice && <div style={{ background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, padding: "8px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{notice}</div>}

        {records === null && <div style={{ color: "#8A8577", fontSize: 13 }}>Loading…</div>}
        {records && records.length === 0 && !error && (
          <div style={{ ...box, padding: "26px 16px", textAlign: "center", color: "#8A8577", fontSize: 13 }}>No KYC forms for this client yet.</div>
        )}

        {records &&
          records.map((rec) => (
            <div key={rec.id} style={{ ...box, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {rec.full_name}
                    {rec.role && <span style={{ fontWeight: 400, color: "#8A8577", fontSize: 12, marginLeft: 8 }}>{rec.role}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#8A8577", marginTop: 2 }}>
                    Born {isoToDisplay(rec.date_of_birth)} · ID {rec.id_card_no_masked || rec.travel_doc_no_masked || "—"} · submitted {String(rec.created_at).slice(0, 16)}
                  </div>
                </div>
                {rec.verified_at ? (
                  <span style={{ background: "#E3EFE9", color: "#1F4A40", fontSize: 11, fontWeight: 700, padding: "3px 9px" }}>
                    Verified · {rec.verified_by} · {rec.verified_at.slice(0, 10)}
                  </span>
                ) : (
                  <span style={{ background: "#FBF1E0", color: "#7A5215", fontSize: 11, fontWeight: 700, padding: "3px 9px" }}>Awaiting verification</span>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button type="button" style={smallBtn} disabled={busy} onClick={() => review(rec)}>
                  {openId === rec.id ? "Hide details" : rec.verified_at ? "View details" : "Review & verify"}
                </button>
                {rec.file_id ? (
                  <>
                    <button type="button" style={{ ...smallBtn, display: "flex", alignItems: "center", gap: 5 }} onClick={() => run(() => downloadDocumentFile(rec.file_id, pdfName(rec)))}>
                      <Download size={12} /> Download PDF
                    </button>
                    <button type="button" style={smallBtn} onClick={() => run(() => openDocumentFile(rec.file_id, pdfName(rec)))}>
                      Open PDF
                    </button>
                  </>
                ) : (
                  <button type="button" style={{ ...smallBtn, color: "#7A5215", borderColor: "#B4791F" }} disabled={busy} onClick={() => retryPdf(rec)}>
                    PDF not filed — retry
                  </button>
                )}
              </div>

              {openId === rec.id && detail && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #E5E1D5" }}>
                  <div style={{ background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, fontSize: 12, padding: "8px 12px", marginBottom: 12 }}>
                    Full details are showing, and this view is recorded. Compare them with the customer&apos;s original ID before verifying.
                  </div>
                  <DetailGrid d={detail} />
                  {detail.signature && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Signature</div>
                      <img src={detail.signature} alt="Signature" style={{ background: "#fff", border: "1px solid #E5E1D5", maxWidth: 320, display: "block" }} />
                    </div>
                  )}
                  {detail.verified_at ? (
                    <div style={{ marginTop: 12, fontSize: 12, color: "#1F4A40" }}>
                      Verified by <strong>{detail.verified_by}</strong> on {detail.verified_at.slice(0, 16)}
                      {detail.verify_note ? ` — ${detail.verify_note}` : ""}
                    </div>
                  ) : (
                    <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Optional note (e.g. checked against NRIC)"
                        style={{ border: "1px solid #C9C4B6", padding: "8px 10px", fontSize: 13, flex: "1 1 240px" }}
                      />
                      <button type="button" disabled={busy} onClick={() => verify(rec)} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                        Mark as verified
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
      </div>

      {formOpen && (
        <KycForm
          client={client}
          user={user}
          onClose={() => {
            setFormOpen(false);
            load();
          }}
          onSaved={() => {
            load();
            if (onChanged) onChanged();
          }}
        />
      )}
    </div>
  );
}

function DetailGrid({ d }) {
  let residence = [];
  try {
    residence = JSON.parse(d.residence || "[]");
  } catch {
    residence = [];
  }
  const rows = [
    ["Name", d.full_name],
    ["Chinese characters", d.chinese_name],
    ["Role", d.role],
    ["Town & place of birth", d.birthplace],
    ["Date of birth", isoToDisplay(d.date_of_birth)],
    ["Nationality now / at birth", `${d.nationality_current} / ${d.nationality_birth}`],
    ["Travel document", [d.travel_doc_type, d.travel_doc_no].filter(Boolean).join(" · ")],
    ["Travel doc issued", [isoToDisplay(d.travel_doc_issue_date), d.travel_doc_country].filter(Boolean).join(" · ")],
    ["Identity card", d.id_card_no],
    ["ID issued", [isoToDisplay(d.id_card_issue_date), d.id_card_country].filter(Boolean).join(" · ")],
    ["Address in Singapore", d.address_sg],
    ["Phone", d.phone],
    ["Email", d.email],
    ["Address overseas", d.address_overseas],
    ["Other address", d.address_other],
    ["Countries of residence", residence.length ? residence.map((r) => `${r.country} (${isoToDisplay(r.from) || "?"} to ${isoToDisplay(r.to) || "?"})`).join("; ") : "Not applicable"],
    ["Completed by", d.completed_by_name],
    ["Agreed on", d.consented_at],
    ["Handled by", d.handed_by],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "10px 18px" }}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 13, color: value ? "#1C2430" : "#B0AA9A", whiteSpace: "pre-line", wordBreak: "break-word" }}>{value || "—"}</div>
        </div>
      ))}
    </div>
  );
}
