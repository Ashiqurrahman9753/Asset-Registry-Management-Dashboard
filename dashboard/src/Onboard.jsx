import React, { useState, useEffect, useMemo } from "react";
import { X, Download, Search } from "lucide-react";
import { Spinner } from "./Loading.jsx";
import { Pager, usePaging } from "./Pager.jsx";
import { BRAND_GREEN_DEEP, HIGHLIGHT_BG, HIGHLIGHT_TEXT } from "./theme.jsx";
import {
  fetchOnboardingSummary,
  fetchClientKyc,
  fetchKycRecord,
  verifyKycRecord,
  markKycSigned,
  linkKycFiles,
  fetchClientPep,
  fetchPepRecord,
  verifyPepRecord,
  markPepSigned,
  linkPepFiles,
  uploadDocumentFile,
  createDocument,
  fetchUploadedForms,
  createUploadedForm,
  downloadDocumentFile,
  openDocumentFile,
} from "./api.js";
import { isoToDisplay, kycRowToData, renderKycCanvases } from "./KycPdf.js";
import { pepRowToData, renderPepCanvases, PEP_TYPE_ORDER } from "./PepPdf.js";
import { canvasesToDataUrls, printPages } from "./Print.js";
import { fileFormPdf, signedCopyFile } from "./FormFile.js";
import { todayIso } from "./FormUi.jsx";
import { KycForm } from "./Kyc.jsx";
import { PepForm } from "./Pep.jsx";

// Onboarding home: the Onboarding tab (every client's progress at a glance) and the
// per-client panel where the KYC form and the PEP declaration are given to the
// customer, printed for signing by hand, verified, and kept.

const STAGE = {
  not_started: { label: "Not started", bg: "#F5E1E1", fg: "#7A2C2E" },
  in_progress: { label: "In progress", bg: "#FBF1E0", fg: "#7A5215" },
  complete: { label: "Complete", bg: "#E3EFE9", fg: "#1F4A40" },
};

const TYPE_TITLES = {
  sg_pep: "Singapore PEP",
  foreign_pep: "Foreign PEP",
  intl_org_pep: "International organisation PEP",
  family_member: "Family member of a PEP",
  close_associate: "Close associate of a PEP",
};

const box = { background: "#fff", border: "1px solid #C9C4B6" };
const smallBtn = { border: "1px solid #C9C4B6", background: "#fff", color: "#1C2430", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" };

// What differs between the two kinds of form, in one place.
const KINDS = {
  kyc: {
    title: "KYC forms",
    short: "KYC",
    blurb: "Personal particulars of each director, shareholder or other connected person.",
    give: "Give the KYC form to a customer",
    fetchList: fetchClientKyc,
    fetchFull: fetchKycRecord,
    verify: verifyKycRecord,
    markSigned: markKycSigned,
    link: linkKycFiles,
    name: (r) => r.full_name,
    subtitle: (r) => `${r.role ? `${r.role} · ` : ""}Born ${isoToDisplay(r.date_of_birth)} · ID ${r.id_card_no_masked || r.travel_doc_no_masked || "—"}`,
    toData: (row, company) => kycRowToData(row, company),
    canvases: renderKycCanvases,
    fileTitle: (r) => `KYC - ${r.full_name}`,
    serviceDetail: (r) => `KYC form — ${r.full_name}`,
  },
  pep: {
    title: "PEP declarations",
    short: "PEP",
    blurb: "Politically exposed person declaration, with source of wealth and funds where required.",
    give: "Give the PEP declaration to a customer",
    fetchList: fetchClientPep,
    fetchFull: fetchPepRecord,
    verify: verifyPepRecord,
    markSigned: markPepSigned,
    link: linkPepFiles,
    name: (r) => r.person_name,
    subtitle: (r) => {
      let types = [];
      try {
        types = JSON.parse(r.pep_types || "[]");
      } catch {
        types = [];
      }
      return `${types.map((t) => TYPE_TITLES[t] || t).join(", ") || "PEP"} · PEP: ${r.pep_name} (${r.pep_country}) · ID ${r.id_masked || "—"}`;
    },
    toData: (row, company) => pepRowToData(row, company),
    canvases: renderPepCanvases,
    fileTitle: (r) => `PEP declaration - ${r.person_name}`,
    serviceDetail: (r) => `PEP declaration — ${r.person_name}`,
  },
};

// ---------- Details shown while a member of staff reviews a record ----------

function DetailGrid({ rows }) {
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

function kycRows(d) {
  let residence = [];
  try {
    residence = JSON.parse(d.residence || "[]");
  } catch {
    residence = [];
  }
  return [
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
    ["Signed", (d.signature_method || "screen") === "paper" ? "By hand on a printed copy" : "On screen"],
    ["Agreed on", d.consented_at],
    ["Handled by", d.handed_by],
  ];
}

function pepRows(d) {
  let types = [];
  try {
    types = JSON.parse(d.pep_types || "[]");
  } catch {
    types = [];
  }
  return [
    ["Customer", d.person_name],
    ["NRIC / FIN / passport", d.id_number],
    ["Is the individual a", PEP_TYPE_ORDER.filter((t) => types.includes(t)).map((t) => TYPE_TITLES[t]).join(", ")],
    ["Family member — relationship", d.family_relationship],
    ["Close associate — relationship", d.associate_relationship],
    ["Name of PEP", d.pep_name],
    ["Country / organisation", d.pep_country],
    ["Nature of public function", d.pep_function],
    ["Period as PEP", d.pep_period],
    ["Source of wealth", d.source_of_wealth],
    ["Source of funds", d.source_of_funds],
    ["Other information", d.other_info],
    ["Declaration date", isoToDisplay(d.declaration_date)],
    ["Signed", (d.signature_method || "screen") === "paper" ? "By hand on a printed copy" : "On screen"],
    ["Handled by", d.handed_by],
  ];
}

// ---------- One record (a KYC form or a PEP declaration) ----------

function RecordCard({ kind, rec, client, user, busy, run, reload, setNotice }) {
  const K = KINDS[kind];
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState("");
  const pdfName = `${K.fileTitle(rec)}.pdf`;
  const byHand = rec.signature_method === "paper";

  async function fullRecord() {
    return detail && detail.id === rec.id ? detail : K.fetchFull(rec.id);
  }

  function toggleDetails() {
    if (open) {
      setOpen(false);
      setDetail(null);
      return;
    }
    run(async () => {
      setDetail(await K.fetchFull(rec.id));
      setNote("");
      setOpen(true);
    });
  }

  function verify() {
    run(async () => {
      await K.verify(rec.id, note);
      await reload();
      setNotice(`${K.name(rec)}'s ${K.short} form is marked as verified.`);
      setOpen(false);
      setDetail(null);
    });
  }

  function printIt() {
    run(async () => {
      const full = await fullRecord();
      const canvases = await K.canvases(K.toData(full, client.company));
      await printPages(canvasesToDataUrls(canvases));
    });
  }

  function retryPdf() {
    run(async () => {
      const full = await fullRecord();
      const canvases = await K.canvases(K.toData(full, client.company));
      await fileFormPdf({
        canvases,
        title: K.fileTitle(rec),
        fileName: `${K.fileTitle(rec)} - ${todayIso()}.pdf`,
        serviceDetail: K.serviceDetail(rec),
        client,
        user,
        link: (documentId, fileId) => K.link(rec.id, documentId, fileId),
      });
      await reload();
      setNotice("The PDF copy has been filed.");
    });
  }

  function uploadSigned(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    run(async () => {
      const stored = await uploadDocumentFile(rec.document_id, signedCopyFile(file, K.fileTitle(rec)));
      await K.markSigned(rec.id, stored.id);
      await reload();
      setNotice(`Signed copy of ${K.name(rec)}'s ${K.short} form has been saved.`);
    });
  }

  const signChip =
    rec.sign_status === "awaiting_signature" ? (
      <span style={{ background: "#F5E1E1", color: "#7A2C2E", fontSize: 11, fontWeight: 700, padding: "3px 9px" }}>Awaiting signed copy</span>
    ) : (
      <span style={{ background: "#E3EFE9", color: "#1F4A40", fontSize: 11, fontWeight: 700, padding: "3px 9px" }}>
        {byHand ? "Signed copy on file" : "Signed on screen"}
      </span>
    );

  return (
    <div style={{ ...box, padding: "12px 14px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{K.name(rec)}</div>
          <div style={{ fontSize: 12, color: "#8A8577", marginTop: 2 }}>
            {K.subtitle(rec)} · submitted {String(rec.created_at).slice(0, 16)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {signChip}
          {rec.verified_at ? (
            <span style={{ background: "#E3EFE9", color: "#1F4A40", fontSize: 11, fontWeight: 700, padding: "3px 9px" }}>
              Verified · {rec.verified_by} · {rec.verified_at.slice(0, 10)}
            </span>
          ) : (
            <span style={{ background: "#FBF1E0", color: "#7A5215", fontSize: 11, fontWeight: 700, padding: "3px 9px" }}>Awaiting verification</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button type="button" style={smallBtn} disabled={busy} onClick={toggleDetails}>
          {open ? "Hide details" : rec.verified_at ? "View details" : "Review & verify"}
        </button>
        <button type="button" style={{ ...smallBtn, ...(rec.sign_status === "awaiting_signature" ? { background: BRAND_GREEN_DEEP, color: "#EDEAE2", borderColor: BRAND_GREEN_DEEP } : {}) }} disabled={busy} onClick={printIt}>
          Print form
        </button>
        {rec.file_id ? (
          <>
            <button type="button" style={{ ...smallBtn, display: "flex", alignItems: "center", gap: 5 }} onClick={() => run(() => downloadDocumentFile(rec.file_id, pdfName))}>
              <Download size={12} /> Download PDF
            </button>
            <button type="button" style={smallBtn} onClick={() => run(() => openDocumentFile(rec.file_id, pdfName))}>
              Open PDF
            </button>
          </>
        ) : (
          <button type="button" style={{ ...smallBtn, color: "#7A5215", borderColor: "#B4791F" }} disabled={busy} onClick={retryPdf}>
            PDF not filed — retry
          </button>
        )}
        {byHand && rec.file_id && (
          <label style={{ ...smallBtn, display: "inline-flex", alignItems: "center", cursor: busy ? "default" : "pointer", color: rec.signed_file_id ? "#1C2430" : BRAND_GREEN_DEEP, borderColor: rec.signed_file_id ? "#C9C4B6" : BRAND_GREEN_DEEP }}>
            {rec.signed_file_id ? "Replace signed copy" : "Upload signed copy"}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic" onChange={uploadSigned} disabled={busy} style={{ display: "none" }} />
          </label>
        )}
        {rec.signed_file_id && (
          <>
            <button type="button" style={smallBtn} onClick={() => run(() => downloadDocumentFile(rec.signed_file_id, `${K.fileTitle(rec)} - signed copy`))}>
              Download signed copy
            </button>
            <button type="button" style={smallBtn} onClick={() => run(() => openDocumentFile(rec.signed_file_id, `${K.fileTitle(rec)} - signed copy`))}>
              Open signed copy
            </button>
          </>
        )}
      </div>

      {rec.sign_status === "awaiting_signature" && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#7A2C2E", background: "#FBEFEF", padding: "7px 10px" }}>
          Print the form, have the customer sign it, then scan or photograph it and press &quot;Upload signed copy&quot;.
        </div>
      )}

      {open && detail && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #E5E1D5" }}>
          <div style={{ background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, fontSize: 12, padding: "8px 12px", marginBottom: 12 }}>
            Full details are showing, and this view is recorded. Compare them with the customer&apos;s original ID before verifying.
          </div>
          <DetailGrid rows={kind === "kyc" ? kycRows(detail) : pepRows(detail)} />
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
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (e.g. checked against NRIC)" style={{ border: "1px solid #C9C4B6", padding: "8px 10px", fontSize: 13, flex: "1 1 240px" }} />
              <button type="button" disabled={busy} onClick={verify} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                Mark as verified
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Forms that were already filled in and signed before the app ----------

const UPLOAD_TYPES = { kyc: "KYC form", pep: "PEP declaration", other: "Other form" };

// Just keeps the scan/PDF against the client — nothing is read from it.
function ExistingForms({ client, user, items, reload, setNotice, setError }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("kyc");
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  function addFiles(list) {
    const picked = Array.from(list || []);
    if (picked.length) setFiles((cur) => [...cur, ...picked].slice(0, 20));
  }

  async function save() {
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    let done = 0;
    try {
      for (const file of files) {
        const label = person.trim() || file.name.replace(/\.[^.]+$/, "");
        const doc = await createDocument({
          clientId: client.id,
          category: "personal",
          serviceDetail: `${UPLOAD_TYPES[type]} (signed, uploaded) - ${label}`,
          location: "Digital copy (no paper)",
          dateReceived: todayIso(),
          loggedBy: user.username,
          isAgmFiling: false,
          isBatch: false,
        });
        const stored = await uploadDocumentFile(doc.id, file);
        await createUploadedForm(client.id, { formType: type, personName: person.trim(), documentId: doc.id, fileId: stored.id, note });
        done += 1;
      }
      setNotice(`${done} form${done === 1 ? "" : "s"} saved to ${client.company}.`);
      setFiles([]);
      setPerson("");
      setNote("");
      setOpen(false);
    } catch (err) {
      setError(`${err.message || "Upload failed"}${done ? ` (${done} saved before the problem)` : ""}`);
    } finally {
      setBusy(false);
      await reload();
    }
  }

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 700 }}>Existing forms on file</div>
          <div style={{ fontSize: 12, color: "#8A8577" }}>Already filled in and signed? Upload the scan or PDF and it is stored here as it is.</div>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ border: `1px solid ${BRAND_GREEN_DEEP}`, background: open ? BRAND_GREEN_DEEP : "#fff", color: open ? "#EDEAE2" : BRAND_GREEN_DEEP, padding: "9px 16px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
          {open ? "Cancel" : "Upload filled forms"}
        </button>
      </div>

      {open && (
        <div style={{ ...box, padding: "14px 16px", marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ border: "1px solid #C9C4B6", padding: "8px 10px", fontSize: 13 }}>
              {Object.entries(UPLOAD_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Person's name (optional)" style={{ border: "1px solid #C9C4B6", padding: "8px 10px", fontSize: 13, flex: "1 1 200px" }} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={{ border: "1px solid #C9C4B6", padding: "8px 10px", fontSize: 13, flex: "1 1 200px" }} />
          </div>
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
            style={{ display: "block", border: `2px dashed ${drag ? "#2FA866" : "#B8B2A0"}`, background: drag ? "#EEF4F1" : "#FAF8F2", padding: "18px 16px", textAlign: "center", cursor: "pointer", fontSize: 13, color: "#4A4638" }}
          >
            Drop scans or PDFs here, or click to choose (up to 20)
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic" style={{ display: "none" }} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {files.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0", borderBottom: "1px solid #EFEBDF" }}>
                  <span style={{ wordBreak: "break-all" }}>{f.name}</span>
                  <button type="button" disabled={busy} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} style={{ border: "none", background: "none", color: "#7A2C2E", cursor: "pointer", fontSize: 12 }}>Remove</button>
                </div>
              ))}
              {files.length > 1 && person.trim() && <div style={{ fontSize: 11.5, color: "#7A5215", marginTop: 6 }}>All {files.length} files will be saved under the name &quot;{person.trim()}&quot;. Leave the name empty to use each file&apos;s own name.</div>}
              <button type="button" disabled={busy} onClick={save} style={{ marginTop: 12, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "10px 20px", fontWeight: 700, fontSize: 13, cursor: busy ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                {busy && <Spinner size={14} color="#fff" />} {busy ? "Saving…" : `Save ${files.length} file${files.length === 1 ? "" : "s"}`}
              </button>
            </div>
          )}
        </div>
      )}

      {items === null && <div style={{ color: "#8A8577", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}><Spinner size={16} /> Loading…</div>}
      {items && items.length === 0 && !open && <div style={{ ...box, padding: "14px", textAlign: "center", color: "#8A8577", fontSize: 13 }}>None uploaded.</div>}
      {items &&
        items.map((it) => (
          <div key={it.id} style={{ ...box, padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                {UPLOAD_TYPES[it.form_type] || "Form"}
                {it.person_name ? ` — ${it.person_name}` : ""}
              </div>
              <div style={{ fontSize: 11.5, color: "#8A8577", marginTop: 2 }}>
                Uploaded {String(it.created_at).slice(0, 10)} by {it.uploaded_by}
                {it.note ? ` · ${it.note}` : ""}
              </div>
            </div>
            <span style={{ background: "#E3EFE9", color: "#1F4A40", fontSize: 11, fontWeight: 700, padding: "3px 9px" }}>Signed copy on file</span>
            <button type="button" style={smallBtn} onClick={() => openDocumentFile(it.file_id, `${UPLOAD_TYPES[it.form_type] || "Form"}${it.person_name ? ` - ${it.person_name}` : ""}`).catch((e) => setError(e.message))}>Open</button>
            <button type="button" style={{ ...smallBtn, display: "flex", alignItems: "center", gap: 5 }} onClick={() => downloadDocumentFile(it.file_id, `${UPLOAD_TYPES[it.form_type] || "Form"}${it.person_name ? ` - ${it.person_name}` : ""}`).catch((e) => setError(e.message))}>
              <Download size={12} /> Download
            </button>
          </div>
        ))}
    </div>
  );
}

// ---------- The panel for one client ----------

export function ClientOnboarding({ client, user, onClose, onChanged }) {
  const [lists, setLists] = useState({ kyc: null, pep: null });
  const [uploaded, setUploaded] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null); // null | "kyc" | "pep"

  async function reload() {
    try {
      const [kyc, pep] = await Promise.all([fetchClientKyc(client.id), fetchClientPep(client.id).catch(() => [])]);
      setLists({ kyc, pep });
      setUploaded(await fetchUploadedForms(client.id).catch(() => []));
    } catch (err) {
      setError(err.message || "Could not load the onboarding forms");
      setLists({ kyc: [], pep: [] });
    }
    if (onChanged) onChanged();
  }
  useEffect(() => {
    reload();
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

  const knownNames = useMemo(() => (lists.kyc || []).map((r) => r.full_name), [lists.kyc]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 52, background: "rgba(28,36,48,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: 820, maxWidth: "100%", maxHeight: "92vh", background: "#FBFAF6", padding: 24, overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 19, fontWeight: 700 }}>Onboarding</div>
            <div style={{ fontSize: 12, color: "#8A8577", marginTop: 3 }}>
              {client.company} <span style={{ fontFamily: "monospace" }}>({client.fileNo})</span>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", flexShrink: 0 }} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error && <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{error}</div>}
        {notice && <div style={{ background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, padding: "8px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{notice}</div>}

        {["kyc", "pep"].map((kind) => {
          const K = KINDS[kind];
          const records = lists[kind];
          return (
            <div key={kind} style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <div>
                  <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 700 }}>{K.title}</div>
                  <div style={{ fontSize: 12, color: "#8A8577" }}>{K.blurb}</div>
                </div>
                <button type="button" onClick={() => setForm(kind)} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 16px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
                  {K.give}
                </button>
              </div>
              {records === null && <div style={{ color: "#8A8577", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}><Spinner size={16} /> Loading…</div>}
              {records && records.length === 0 && <div style={{ ...box, padding: "18px 14px", textAlign: "center", color: "#8A8577", fontSize: 13 }}>None yet.</div>}
              {records &&
                records.map((rec) => (
                  <RecordCard key={rec.id} kind={kind} rec={rec} client={client} user={user} busy={busy} run={run} reload={reload} setNotice={setNotice} />
                ))}
            </div>
          );
        })}
        <ExistingForms client={client} user={user} items={uploaded} reload={reload} setNotice={setNotice} setError={setError} />
        <div style={{ fontSize: 11, color: "#8A8577" }}>
          The form opens full-screen for the customer. Hand over the device and take it back when they see &quot;Thank you&quot;.
        </div>
      </div>

      {form === "kyc" && (
        <KycForm
          client={client}
          user={user}
          onClose={() => {
            setForm(null);
            reload();
          }}
          onSaved={reload}
        />
      )}
      {form === "pep" && (
        <PepForm
          client={client}
          user={user}
          knownNames={knownNames}
          onClose={() => {
            setForm(null);
            reload();
          }}
          onSaved={reload}
        />
      )}
    </div>
  );
}

// ---------- The Onboarding tab ----------

export function OnboardingHub({ clients, user, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("attention"); // attention | all | not_started | in_progress | complete
  const [activeOnly, setActiveOnly] = useState(true);
  const [openId, setOpenId] = useState(null);

  async function load() {
    try {
      setRows(await fetchOnboardingSummary());
    } catch (err) {
      setError(err.message || "Could not load onboarding progress");
      setRows([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const base = useMemo(() => (rows || []).filter((r) => !activeOnly || r.client_status === "A"), [rows, activeOnly]);
  const counts = useMemo(() => {
    const c = { not_started: 0, in_progress: 0, complete: 0, signature: 0, verification: 0 };
    for (const r of base) {
      c[r.stage] += 1;
      if (r.awaiting_signature > 0) c.signature += 1;
      if (r.awaiting_verification > 0 && r.stage !== "not_started") c.verification += 1;
    }
    return c;
  }, [base]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return base.filter((r) => {
      if (filter === "attention" && r.stage === "complete") return false;
      if (filter === "not_started" && r.stage !== "not_started") return false;
      if (filter === "in_progress" && r.stage !== "in_progress") return false;
      if (filter === "complete" && r.stage !== "complete") return false;
      if (q && !`${r.company} ${r.file_no}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [base, filter, query]);
  const paging = usePaging(visible, 20, `${query}|${filter}|${activeOnly}`);

  const openClient = clients.find((c) => c.id === openId);

  const chip = (key, label, n) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      style={{ border: "1px solid #C9C4B6", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: filter === key ? BRAND_GREEN_DEEP : "#fff", color: filter === key ? "#EDEAE2" : "#1C2430" }}
    >
      {label}
      {n !== undefined ? ` (${n})` : ""}
    </button>
  );

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 700 }}>Onboarding</div>
        <div style={{ fontSize: 12.5, color: "#6B6656", marginTop: 3 }}>
          Every client&apos;s KYC and PEP paperwork in one place: what&apos;s been filled in, signed and verified, and what&apos;s still waiting.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {[
          ["Not started", counts.not_started, "#7A2C2E", "#F5E1E1"],
          ["In progress", counts.in_progress, "#7A5215", "#FBF1E0"],
          ["Complete", counts.complete, "#1F4A40", "#E3EFE9"],
          ["Waiting for a signed copy", counts.signature, "#7A2C2E", "#FBEFEF"],
        ].map(([label, n, fg, bg]) => (
          <div key={label} style={{ background: bg, color: fg, padding: "10px 16px", minWidth: 130 }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{n}</div>
            <div style={{ fontSize: 11, fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #C9C4B6", padding: "7px 10px", flex: "1 1 220px" }}>
          <Search size={14} color="#8A8577" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients…" style={{ border: "none", outline: "none", fontSize: 13, flex: 1, background: "transparent" }} />
        </div>
        {chip("attention", "Needs attention", counts.not_started + counts.in_progress)}
        {chip("not_started", "Not started", counts.not_started)}
        {chip("in_progress", "In progress", counts.in_progress)}
        {chip("complete", "Complete", counts.complete)}
        {chip("all", "All", base.length)}
        <label style={{ fontSize: 12, color: "#4A4638", display: "flex", alignItems: "center", gap: 5 }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active clients only
        </label>
      </div>

      {error && <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{error}</div>}
      {rows === null && <div style={{ color: "#8A8577", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}><Spinner size={16} /> Loading…</div>}

      {rows && (
        <div style={{ ...box, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5, color: "#8A8577" }}>
                {["Client", "KYC forms", "PEP declarations", "Waiting for", "Status", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", borderBottom: "1px solid #E5E1D5", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "22px 12px", textAlign: "center", color: "#8A8577" }}>
                    {filter === "attention" ? "Nothing needs attention — every active client's onboarding is complete." : "No clients match."}
                  </td>
                </tr>
              )}
              {paging.pageItems.map((r) => {
                const st = STAGE[r.stage];
                const waiting = [];
                if (r.awaiting_signature > 0) waiting.push(`${r.awaiting_signature} signed cop${r.awaiting_signature === 1 ? "y" : "ies"}`);
                const toVerify = r.awaiting_verification - r.awaiting_signature;
                if (r.stage !== "not_started" && toVerify > 0) waiting.push(`${toVerify} to verify`);
                return (
                  <tr key={r.client_id} style={{ borderBottom: "1px solid #EFEBDF" }}>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ fontWeight: 600 }}>{r.company}</div>
                      <div style={{ fontSize: 11, color: "#8A8577", fontFamily: "monospace" }}>{r.file_no}</div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>{r.kyc_total === 0 ? <span style={{ color: "#B0AA9A" }}>—</span> : `${r.kyc_verified} of ${r.kyc_total} verified`}</td>
                    <td style={{ padding: "10px 12px" }}>{r.pep_total === 0 ? <span style={{ color: "#B0AA9A" }}>—</span> : `${r.pep_verified} of ${r.pep_total} verified`}</td>
                    <td style={{ padding: "10px 12px", color: waiting.length ? "#7A2C2E" : "#B0AA9A", fontSize: 12 }}>{waiting.length ? waiting.join(", ") : "—"}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ background: st.bg, color: st.fg, fontSize: 11, fontWeight: 700, padding: "3px 9px" }}>{st.label}</span>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <button type="button" onClick={() => setOpenId(r.client_id)} style={smallBtn}>
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows && <Pager page={paging.page} pageCount={paging.pageCount} onPage={paging.setPage} total={visible.length} pageSize={20} />}

      {openClient && (
        <ClientOnboarding
          client={openClient}
          user={user}
          onClose={() => {
            setOpenId(null);
            load();
          }}
          onChanged={() => {
            load();
            if (onChanged) onChanged();
          }}
        />
      )}
    </div>
  );
}

