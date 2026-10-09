import React, { useState, useRef } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { BRAND_GREEN_DEEP } from "./theme.jsx";
import { createPepRecord, linkPepFiles } from "./api.js";
import { PEP_TYPE_ORDER, PEP_TYPE_LABELS, PEP_DECLARATION, pepRowToData, renderPepCanvases } from "./PepPdf.js";
import { canvasesToDataUrls, printPages } from "./Print.js";
import { fileFormPdf } from "./FormFile.js";
import { FIRM_NAME, todayIso, bigInput, sectionBox, fieldBlock, sectionHeading, Shell, SignatureChoice } from "./FormUi.jsx";

// Digital PEP declaration (Part 2) with the enhanced due diligence section (Section D).
// Same flow as the KYC form: the customer fills it in and signs on the screen or by
// hand on a printed copy; staff verify it; a PDF is filed with the client's documents.

const TYPE_TITLES = {
  sg_pep: "Singapore PEP",
  foreign_pep: "Foreign PEP",
  intl_org_pep: "International organisation PEP",
  family_member: "Family member of a PEP",
  close_associate: "Close associate of a PEP",
};

const EMPTY = {
  personName: "",
  idNumber: "",
  familyRelationship: "",
  associateRelationship: "",
  pepName: "",
  pepCountry: "",
  pepFunction: "",
  pepPeriod: "",
  sourceOfWealth: "",
  sourceOfFunds: "",
  otherInfo: "",
};

function findProblems(f, types, signatureMethod, signature, declared) {
  const out = [];
  if (!f.personName.trim()) out.push("Your name");
  if (!/^[A-Za-z0-9-]{5,20}$/.test(f.idNumber.trim())) out.push("Your NRIC, FIN or passport number");
  if (types.length === 0) out.push("At least one box under \"Is the identified individual a:\"");
  if (types.includes("family_member") && !f.familyRelationship.trim()) out.push("How the PEP is related to you (family member)");
  if (types.includes("close_associate") && !f.associateRelationship.trim()) out.push("How the PEP is connected to you (close associate)");
  if (!f.pepName.trim()) out.push("The name of the PEP");
  if (!f.pepCountry.trim()) out.push("The country or international organisation");
  if (!f.pepFunction.trim()) out.push("The nature of the prominent public function");
  if (!declared) out.push("The declaration box");
  if (signatureMethod === "screen" && !signature) out.push("Your signature");
  return out;
}

export function PepForm({ client, user, knownNames, onClose, onSaved }) {
  const company = client.company;
  const [f, setF] = useState({ ...EMPTY });
  const [types, setTypes] = useState([]);
  const [declared, setDeclared] = useState(false);
  const [signatureMethod, setSignatureMethod] = useState("screen");
  const [signature, setSignature] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [stage, setStage] = useState("fill"); // fill | saving | done | doneNoPdf
  const [error, setError] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [printUrls, setPrintUrls] = useState(null);
  const [printMsg, setPrintMsg] = useState("");
  const topRef = useRef(null);
  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
  const problems = attempted ? findProblems(f, types, signatureMethod, signature, declared) : [];
  const text = (k, extra = {}) => <input value={f[k]} onChange={(e) => set(k, e.target.value)} style={bigInput} {...extra} />;
  const area = (k, rows = 3) => <textarea value={f[k]} onChange={(e) => set(k, e.target.value)} style={{ ...bigInput, minHeight: rows * 30 + 24, resize: "vertical" }} />;
  const toggleType = (key) => setTypes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  async function submit(ev) {
    ev.preventDefault();
    const found = findProblems(f, types, signatureMethod, signature, declared);
    setAttempted(true);
    setError("");
    if (found.length > 0) {
      if (topRef.current) topRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setStage("saving");
    let record;
    try {
      record = await createPepRecord(client.id, {
        ...f,
        pepTypes: types,
        declarationDate: todayIso(),
        declarationText: PEP_DECLARATION,
        declared: true,
        signatureMethod,
        signature: signatureMethod === "screen" ? signature : "",
      });
    } catch (err) {
      setStage("fill");
      setError(err.message || "Your form couldn't be saved. Please try again or ask a member of staff.");
      if (topRef.current) topRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    try {
      const canvases = await renderPepCanvases(pepRowToData(record, company));
      setPrintUrls(canvasesToDataUrls(canvases));
      await fileFormPdf({
        canvases,
        title: `PEP declaration - ${record.person_name}`,
        fileName: `PEP declaration - ${record.person_name} - ${todayIso()}.pdf`,
        serviceDetail: `PEP declaration — ${record.person_name}`,
        client,
        user,
        link: (documentId, fileId) => linkPepFiles(record.id, documentId, fileId),
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
          <div style={{ marginTop: 14 }}>Saving your declaration…</div>
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
            {byHand ? "Your declaration has been received. A member of staff will now print it for you to sign." : "Your declaration has been received. Please hand the device back to a member of staff."}
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
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 28, fontWeight: 700, marginTop: 2, lineHeight: 1.15 }}>Politically exposed person (PEP) declaration</div>
          <div style={{ fontSize: 16, color: "#4A4638", marginTop: 6 }}>For: {company}</div>
        </div>
        <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: "#8A8577", fontSize: 12, flexShrink: 0 }}>
          Staff: cancel
        </button>
      </div>
      <div style={{ fontSize: 16, color: "#4A4638", margin: "10px 0 20px", lineHeight: 1.5 }}>
        Part 2 of the onboarding forms. Please complete it only if you, a family member or a close associate of yours is a politically exposed person. Fields marked <span style={{ color: "#A63D40" }}>*</span> are required.
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
          {sectionHeading(1, "About you")}
          {fieldBlock(
            "Your name (as on your identity document)",
            <>
              <input list="pep-known-names" value={f.personName} onChange={(e) => set("personName", e.target.value)} style={bigInput} autoComplete="off" />
              <datalist id="pep-known-names">
                {(knownNames || []).map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </>,
            { required: true }
          )}
          {fieldBlock("NRIC / FIN / passport number", text("idNumber", { autoCapitalize: "characters", autoComplete: "off" }), { required: true })}
        </div>

        <div style={sectionBox}>
          {sectionHeading(2, "Section A — The politically exposed person")}
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>
            Is the identified individual a: <span style={{ color: "#A63D40" }}>*</span>
          </div>
          {PEP_TYPE_ORDER.map((key) => (
            <div key={key} style={{ marginBottom: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 17 }}>
                <input type="checkbox" checked={types.includes(key)} onChange={() => toggleType(key)} style={{ width: 22, height: 22 }} />
                {TYPE_TITLES[key]}
              </label>
              {key === "family_member" && types.includes(key) && (
                <div style={{ marginLeft: 32, marginTop: 8 }}>
                  {fieldBlock("Please describe the relationship with the PEP", text("familyRelationship"), { required: true })}
                </div>
              )}
              {key === "close_associate" && types.includes(key) && (
                <div style={{ marginLeft: 32, marginTop: 8 }}>
                  {fieldBlock("Please describe the relationship with the PEP", text("associateRelationship"), { required: true })}
                </div>
              )}
            </div>
          ))}
          <div style={{ borderTop: "1px solid #E5E1D5", margin: "16px 0" }} />
          {fieldBlock("Name of the PEP", text("pepName"), { required: true })}
          {fieldBlock("Country / international organisation where the PEP holds a prominent public function", text("pepCountry"), { required: true })}
          {fieldBlock("Nature of the prominent public function the person is, or has been, entrusted with", area("pepFunction", 3), { required: true })}
          {fieldBlock("Period of time in which the person is / was a PEP", text("pepPeriod"), { hint: "For example: 2015 to 2021, or 2019 to present." })}
        </div>

        <div style={sectionBox}>
          {sectionHeading(3, "Section D — Source of wealth and funds")}
          <div style={{ fontSize: 14, color: "#8A8577", marginBottom: 12, lineHeight: 1.5 }}>
            Enhanced checks apply to some PEPs. If a member of staff has asked you for this, please complete it; otherwise you can leave it blank.
          </div>
          {fieldBlock("Information on the person's source of wealth", area("sourceOfWealth", 3))}
          {fieldBlock("Information on the person's source of funds in the establishment of the business relationship, or in the proposed business relationship", area("sourceOfFunds", 3))}
          {fieldBlock("Any other information as necessary", area("otherInfo", 2))}
        </div>

        <div style={sectionBox}>
          {sectionHeading(4, "Declaration and signature")}
          <div style={{ fontSize: 15, color: "#4A4638", lineHeight: 1.6, marginBottom: 14 }}>{PEP_DECLARATION}</div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 17, marginBottom: 18 }}>
            <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} />
            <span>I declare that the above is true and correct <span style={{ color: "#A63D40" }}>*</span></span>
          </label>
          <div style={{ fontSize: 14, color: "#6B6656", marginBottom: 14 }}>Date of declaration: {todayIso().split("-").reverse().join("-")}</div>
          <SignatureChoice method={signatureMethod} onMethod={setSignatureMethod} onSignature={setSignature} />
        </div>

        <button type="submit" style={{ width: "100%", background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "16px", fontSize: 19, fontWeight: 700, cursor: "pointer" }}>
          Submit my declaration
        </button>
      </form>
    </Shell>
  );
}
