import React, { useState, useRef } from "react";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { BRAND_GREEN_DEEP } from "./theme.jsx";
import { createKycRecord, linkKycFiles } from "./api.js";
import { checkSgId, kycRowToData, renderKycCanvases } from "./KycPdf.js";
import { canvasesToDataUrls, printPages } from "./Print.js";
import { fileFormPdf } from "./FormFile.js";
import { FIRM_NAME, todayIso, bigInput, sectionBox, fieldBlock, sectionHeading, Shell, SignatureChoice } from "./FormUi.jsx";

// Digital KYC form (personal particulars). The customer fills it in on the screen
// and signs — on the screen, or by hand on a printed copy — then staff review the
// details against the person's real ID and mark it verified. A PDF of the form is
// filed with the client's documents. The staff list for these records lives in
// Onboarding.jsx.

const ROLES = ["Director", "Shareholder", "Secretary", "Beneficial owner", "Other"];
const TRAVEL_DOC_TYPES = ["Passport", "Certificate of Identity", "Document of Identity", "Others"];

// The wording the customer agrees to. Have the client's compliance adviser
// confirm it before relying on it.
export function kycConsentWording(company) {
  return `I confirm that the information I have given on this form is true and complete. I consent to ${FIRM_NAME} collecting, using and keeping these personal details to verify my identity and to meet legal and regulatory requirements relating to ${company}.`;
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
function findProblems(f, signatureMethod, signature, consent, residenceNA, residence) {
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
  if (signatureMethod === "screen" && !signature) out.push("Your signature");
  if (!consent) out.push("The confirmation box at the bottom");
  return out;
}

// ---------- The form the customer fills in ----------

export function KycForm({ client, user, onClose, onSaved }) {
  const company = client.company;
  const [f, setF] = useState({ ...EMPTY });
  const [residenceNA, setResidenceNA] = useState(true);
  const [residence, setResidence] = useState([{ from: "", to: "", country: "" }]);
  const [signatureMethod, setSignatureMethod] = useState("screen");
  const [signature, setSignature] = useState("");
  const [consent, setConsent] = useState(false);
  // Once they've tried to submit, the "please complete" list keeps itself up to date as they fill things in.
  const [attempted, setAttempted] = useState(false);
  const [stage, setStage] = useState("fill"); // fill | saving | done | doneNoPdf
  const [error, setError] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [printUrls, setPrintUrls] = useState(null);
  const [printMsg, setPrintMsg] = useState("");
  const topRef = useRef(null);
  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
  const today = todayIso();
  const idCheck = checkSgId(f.idCardNo);
  const problems = attempted ? findProblems(f, signatureMethod, signature, consent, residenceNA, residence) : [];

  const text = (k, extra = {}) => <input value={f[k]} onChange={(e) => set(k, e.target.value)} style={bigInput} {...extra} />;
  const date = (k) => <input type="date" value={f[k]} max={today} onChange={(e) => set(k, e.target.value)} style={bigInput} />;

  async function submit(ev) {
    ev.preventDefault();
    const found = findProblems(f, signatureMethod, signature, consent, residenceNA, residence);
    setAttempted(true);
    setError("");
    if (found.length > 0) {
      if (topRef.current) topRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setStage("saving");
    let record;
    try {
      record = await createKycRecord(client.id, {
        ...f,
        role: f.role || null,
        travelDocType: f.travelDocType || null,
        residence: residenceNA ? [] : residence,
        signatureMethod,
        signature: signatureMethod === "screen" ? signature : "",
        consentText: kycConsentWording(company),
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
      const canvases = await renderKycCanvases(kycRowToData(record, company));
      setPrintUrls(canvasesToDataUrls(canvases));
      await fileFormPdf({
        canvases,
        title: `KYC - ${record.full_name}`,
        fileName: `KYC - ${record.full_name} - ${todayIso()}.pdf`,
        serviceDetail: `KYC form — ${record.full_name}`,
        client,
        user,
        link: (documentId, fileId) => linkKycFiles(record.id, documentId, fileId),
      });
      setStage("done");
    } catch (err) {
      setPdfError(err && err.message ? err.message : "unknown reason");
      setStage("doneNoPdf");
    }
    if (onSaved) onSaved();
  }

  async function printNow() {
    setPrintMsg("");
    try {
      await printPages(printUrls);
    } catch (err) {
      setPrintMsg(err.message || "Printing failed");
    }
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
    const byHand = signatureMethod === "paper";
    return (
      <Shell>
        <div style={{ textAlign: "center", padding: "70px 10px" }}>
          <CheckCircle2 size={52} color="#2F6F62" />
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 28, fontWeight: 700, marginTop: 14 }}>Thank you</div>
          <div style={{ fontSize: 18, color: "#4A4638", marginTop: 10, lineHeight: 1.6 }}>
            {byHand ? "Your details have been received. A member of staff will now print the form for you to sign." : "Your form has been received. Please hand the device back to a member of staff."}
          </div>
          {byHand && printUrls && (
            <div style={{ marginTop: 22 }}>
              <button type="button" onClick={printNow} style={{ background: "#fff", color: "#1C2430", border: "1px solid #8A8577", padding: "11px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                Staff: print the form now
              </button>
              {printMsg && <div style={{ marginTop: 8, color: "#7A2C2E", fontSize: 13 }}>{printMsg}</div>}
            </div>
          )}
          {stage === "doneNoPdf" && (
            <div style={{ marginTop: 22, fontSize: 14, color: "#7A5215", background: "#FBF1E0", padding: "10px 14px", display: "inline-block" }}>
              Staff note: the details are saved, but the PDF copy couldn&apos;t be filed ({pdfError}). Use &quot;PDF not filed — retry&quot; in Onboarding.
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
          {fieldBlock(
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
          {sectionHeading(1, "Name")}
          {fieldBlock("Full name (as on your identity card or passport)", text("fullName", { autoComplete: "off" }), { required: true })}
          {fieldBlock("Chinese characters (if any)", text("chineseName"))}
        </div>

        <div style={sectionBox}>
          {sectionHeading(2, "Birth")}
          {fieldBlock("Town and place of birth", text("birthplace"), { required: true })}
          {fieldBlock("Date of birth", date("dateOfBirth"), { required: true })}
        </div>

        <div style={sectionBox}>
          {sectionHeading(3, "Nationality / citizenship")}
          {fieldBlock("(a) Current", text("nationalityCurrent"), { required: true })}
          {fieldBlock("(b) At birth", text("nationalityBirth"), { required: true })}
        </div>

        <div style={sectionBox}>
          {sectionHeading(4, "Travel document")}
          <div style={{ fontSize: 14, color: "#8A8577", marginBottom: 12 }}>Leave this section blank if you don&apos;t have one.</div>
          {fieldBlock(
            "Type",
            <select value={f.travelDocType} onChange={(e) => set("travelDocType", e.target.value)} style={bigInput}>
              <option value="">Choose…</option>
              {TRAVEL_DOC_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
          {fieldBlock("Travel document number", text("travelDocNo", { autoCapitalize: "characters" }))}
          {fieldBlock("Date of issue", date("travelDocIssueDate"))}
          {fieldBlock("Country of issue", text("travelDocCountry"))}
        </div>

        <div style={sectionBox}>
          {sectionHeading(5, "Identity card")}
          {fieldBlock("Identity card number", text("idCardNo", { autoCapitalize: "characters", autoComplete: "off" }), { required: !f.travelDocNo.trim() })}
          {idCheck.kind === "invalid" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", color: "#7A5215", background: "#FBF1E0", padding: "8px 12px", fontSize: 14, margin: "-6px 0 14px" }}>
              <AlertTriangle size={16} /> This number doesn&apos;t look right. Please check every digit and the last letter.
            </div>
          )}
          {fieldBlock("(a) Date of issue", date("idCardIssueDate"))}
          {fieldBlock("(b) Country of issue", text("idCardCountry"))}
        </div>

        <div style={sectionBox}>
          {sectionHeading(6, "Address and contact")}
          {fieldBlock(
            "(a) Address in Singapore",
            <textarea value={f.addressSg} onChange={(e) => set("addressSg", e.target.value)} style={{ ...bigInput, minHeight: 84, resize: "vertical" }} />,
            { required: !f.addressOverseas.trim() }
          )}
          {fieldBlock("Mobile / phone number", text("phone", { type: "tel" }), { required: true })}
          {fieldBlock("Email address", text("email", { type: "email", autoCapitalize: "none" }))}
          {fieldBlock(
            "(b) Address overseas",
            <textarea value={f.addressOverseas} onChange={(e) => set("addressOverseas", e.target.value)} style={{ ...bigInput, minHeight: 70, resize: "vertical" }} />,
            { hint: "Write NIL if none." }
          )}
          {fieldBlock(
            "(c) Other address",
            <textarea value={f.addressOther} onChange={(e) => set("addressOther", e.target.value)} style={{ ...bigInput, minHeight: 56, resize: "vertical" }} />,
            { hint: "Write NIL if none." }
          )}
        </div>

        <div style={sectionBox}>
          {sectionHeading(7, "Countries of residence")}
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
          {sectionHeading(8, "Confirmation and signature")}
          <div style={{ fontSize: 15, color: "#4A4638", lineHeight: 1.6, marginBottom: 14 }}>{kycConsentWording(company)}</div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 17, marginBottom: 18 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} />
            <span>I confirm and agree <span style={{ color: "#A63D40" }}>*</span></span>
          </label>
          {fieldBlock("Name of the person completing this form", text("completedByName"), { required: true })}
          <SignatureChoice method={signatureMethod} onMethod={setSignatureMethod} onSignature={setSignature} />
        </div>

        <button type="submit" style={{ width: "100%", background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "16px", fontSize: 19, fontWeight: 700, cursor: "pointer" }}>
          Submit my form
        </button>
      </form>
    </Shell>
  );
}
