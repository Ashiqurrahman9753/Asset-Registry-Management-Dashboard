import React, { useState, useEffect } from "react";
import { X, Download, CheckCircle2, AlertCircle, AlertTriangle, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { BRAND_GREEN, BRAND_GREEN_DEEP, HIGHLIGHT_BG, HIGHLIGHT_TEXT } from "./theme.jsx";
import {
  fetchClientFilings,
  fetchClientSchedules,
  startFiling,
  fetchFiling,
  fetchFilingLog,
  updateFilingItem,
  linkFilingDocument,
  unlinkFilingDocument,
  markFilingFiled,
  reopenFiling,
  downloadFilingBundle,
  openDocumentFile,
  downloadDocumentFile,
  fetchFilingTemplates,
  createFilingTemplate,
  updateFilingTemplate,
  deleteFilingTemplate,
} from "./api.js";

// Filing Helper — gets a client's documents lined up for a GST or AGM / Annual
// Return filing. It never files anything: staff still file on the official
// portal. This screen is the checklist, the company details to copy from, and
// one download of everything that's on file.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CATEGORY_LABEL = {
  secretarial: "Secretarial records",
  bookkeeping: "Bookkeeping",
  banking_tax: "Banking & tax",
  personal: "Personal particulars",
};
const PORTALS = {
  gst: { label: "Open IRAS myTax Portal", url: "https://mytax.iras.gov.sg/" },
  agm: { label: "Open ACRA BizFile+", url: "https://www.bizfile.gov.sg/" },
};

// ---------- Date helpers (local dates only — never toISOString, which shifts a day in Singapore) ----------

function pad(n) {
  return String(n).padStart(2, "0");
}
function isoOf(y, m0, d) {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`;
}
function lastDayOf(y, m0) {
  return new Date(y, m0 + 1, 0).getDate();
}
function todayIso() {
  const d = new Date();
  return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
}
function isIso(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || "");
}
function parseIso(s) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m0: m - 1, d };
}
function addMonthsIso(iso, n) {
  const { y, m0, d } = parseIso(iso);
  const t = m0 + n;
  const ny = y + Math.floor(t / 12);
  const nm = ((t % 12) + 12) % 12;
  return isoOf(ny, nm, Math.min(d, lastDayOf(ny, nm)));
}
function daysUntil(iso) {
  const { y, m0, d } = parseIso(iso);
  const due = new Date(y, m0, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86400000);
}
function prettyDate(iso) {
  if (!isIso(iso)) return iso || "";
  const { y, m0, d } = parseIso(iso);
  return `${d} ${MON[m0]} ${y}`;
}

// GST: the period is the month or quarter ending in `endMonth` ("YYYY-MM");
// the return is due by the end of the following month.
function deriveGst(endMonth, months) {
  if (!/^\d{4}-\d{2}$/.test(endMonth || "")) return null;
  const [ey, em] = endMonth.split("-").map(Number);
  const em0 = em - 1;
  const t = em0 - (months - 1);
  const sy = ey + Math.floor(t / 12);
  const sm0 = ((t % 12) + 12) % 12;
  const nextT = em0 + 1;
  const ny = ey + Math.floor(nextT / 12);
  const nm0 = ((nextT % 12) + 12) % 12;
  let periodLabel;
  if (months === 1) periodLabel = `${MON[em0]} ${ey}`;
  else if (sy === ey) periodLabel = `${MON[sm0]}-${MON[em0]} ${ey}`;
  else periodLabel = `${MON[sm0]} ${sy}-${MON[em0]} ${ey}`;
  return {
    periodLabel,
    periodStart: isoOf(sy, sm0, 1),
    periodEnd: isoOf(ey, em0, lastDayOf(ey, em0)),
    dueDate: isoOf(ny, nm0, lastDayOf(ny, nm0)),
  };
}

// Most recent finished GST period. A GST schedule's anchor month is the month
// the return falls due, so the period ends the month before it.
function defaultGstPeriod(schedule) {
  const now = new Date();
  const monthly = !!schedule && schedule.frequency === "monthly";
  const anchor = schedule && schedule.dueMonth ? (Number(schedule.dueMonth) + 10) % 12 : 2;
  for (let k = 0; k < 14; k++) {
    const t = now.getMonth() - k;
    const y = now.getFullYear() + Math.floor(t / 12);
    const m0 = ((t % 12) + 12) % 12;
    if (new Date(y, m0 + 1, 0) > now) continue; // that month hasn't finished yet
    if (monthly || (m0 - anchor + 12) % 3 === 0) return { endMonth: `${y}-${pad(m0 + 1)}`, months: monthly ? 1 : 3 };
  }
  return { endMonth: "", months: 3 };
}

// AGM / Annual Return: the financial year ending on `fyeIso`; due 7 months after
// year-end, the same rule the dashboard's overdue tracking already uses.
function deriveAgm(fyeIso) {
  if (!isIso(fyeIso)) return null;
  const { y, m0 } = parseIso(fyeIso);
  const prev = parseIso(addMonthsIso(fyeIso, -12));
  const start = new Date(prev.y, prev.m0, prev.d + 1);
  return {
    periodLabel: `FY ending ${MON[m0]} ${y}`,
    periodStart: isoOf(start.getFullYear(), start.getMonth(), start.getDate()),
    periodEnd: fyeIso,
    dueDate: addMonthsIso(fyeIso, 7),
  };
}

// ---------- Styles ----------

const box = { background: "#fff", border: "1px solid #C9C4B6" };
const smallLabel = { fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 };
const primaryBtn = { background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" };
const plainBtn = { border: "1px solid #C9C4B6", background: "#fff", color: "#1C2430", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" };
const linkBtn = { border: "none", background: "none", cursor: "pointer", color: BRAND_GREEN, fontSize: 11, fontWeight: 600, padding: 0 };
const fieldInput = { border: "1px solid #C9C4B6", background: "#fff", padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" };

const AVAILABILITY = {
  digital: { label: "Files on record", bg: "#E3EFE9", fg: "#1F4A40" },
  paper: { label: "Paper only", bg: "#FBF1E0", fg: "#7A5215" },
  missing: { label: "Not found", bg: "#F5E1E1", fg: "#7A2C2E" },
  na: { label: "Not applicable", bg: "#ECE9E0", fg: "#5B5648" },
};

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilingHelper({ client, user, documents, ar, revealed, onRequestReveal, onClose, onChanged, renderAttachments }) {
  const [step, setStep] = useState("loading"); // loading | list | new | filing | templates
  const [templates, setTemplates] = useState([]);
  const [tplEdit, setTplEdit] = useState(null); // the checklist item being edited, or a blank one for "add"
  const [filings, setFilings] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [view, setView] = useState(null);
  const [log, setLog] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [naFor, setNaFor] = useState(null);
  const [naText, setNaText] = useState("");
  const [linkChoice, setLinkChoice] = useState({});
  const [includePersonal, setIncludePersonal] = useState(false);
  const [filedForm, setFiledForm] = useState(null);
  const [copied, setCopied] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchClientFilings(client.id), fetchClientSchedules(client.id)])
      .then(([f, s]) => {
        if (cancelled) return;
        setFilings(f);
        setSchedules(s);
        setStep("list");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Could not load filings");
        setStep("list");
      });
    return () => {
      cancelled = true;
    };
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

  async function refreshList() {
    try {
      setFilings(await fetchClientFilings(client.id));
    } catch {
      // the list is a convenience — the open filing is what matters
    }
  }

  function openFiling(id) {
    run(async () => {
      setView(await fetchFiling(id));
      setLog(null);
      setFiledForm(null);
      setStep("filing");
    });
  }

  function beginNew(type) {
    if (type === "gst") {
      const schedule = schedules.find((s) => /gst/i.test(s.taskName || ""));
      const d = defaultGstPeriod(schedule);
      const derived = deriveGst(d.endMonth, d.months);
      setForm({ type, endMonth: d.endMonth, months: d.months, fyeDate: "", dueDate: derived ? derived.dueDate : "" });
    } else {
      const fye = ar && ar.fye ? isoOf(ar.fye.getFullYear(), ar.fye.getMonth(), ar.fye.getDate()) : "";
      const derived = deriveAgm(fye);
      setForm({ type, endMonth: "", months: 3, fyeDate: fye, dueDate: derived ? derived.dueDate : "" });
    }
    setError("");
    setStep("new");
  }

  function updateForm(patch) {
    const next = { ...form, ...patch };
    const derived = next.type === "gst" ? deriveGst(next.endMonth, Number(next.months)) : deriveAgm(next.fyeDate);
    // The due date follows the period until it's edited by hand.
    if (derived && !("dueDate" in patch)) next.dueDate = derived.dueDate;
    setForm(next);
  }

  function submitNew(ev) {
    ev.preventDefault();
    const derived = form.type === "gst" ? deriveGst(form.endMonth, Number(form.months)) : deriveAgm(form.fyeDate);
    if (!derived) {
      setError(form.type === "gst" ? "Choose the month the GST period ends." : "Choose the financial year-end date.");
      return;
    }
    run(async () => {
      const created = await startFiling(client.id, {
        filingType: form.type,
        periodLabel: derived.periodLabel,
        periodStart: derived.periodStart,
        periodEnd: derived.periodEnd,
        dueDate: isIso(form.dueDate) ? form.dueDate : derived.dueDate,
      });
      setView(created);
      setLog(null);
      setFiledForm(null);
      setStep("filing");
      refreshList();
    });
  }

  // ----- Checklist editor (admins) -----

  function openTemplates() {
    run(async () => {
      setTemplates(await fetchFilingTemplates());
      setTplEdit(null);
      setStep("templates");
    });
  }

  function blankTemplate(type) {
    return { id: null, filingType: type, label: "", category: "", subtype: "", keyword: "", periodScope: "period", required: true };
  }

  function editTemplate(t) {
    setTplEdit({
      id: t.id,
      filingType: t.filing_type,
      label: t.label,
      category: t.category || "",
      subtype: t.subtype || "",
      keyword: t.keyword || "",
      periodScope: t.period_scope,
      required: t.required === 1,
    });
    setError("");
  }

  function saveTemplate(ev) {
    ev.preventDefault();
    if (!tplEdit.label.trim()) {
      setError("Give the checklist item a name.");
      return;
    }
    if (!tplEdit.category && !tplEdit.subtype.trim() && !tplEdit.keyword.trim()) {
      setError("Say where to look: pick a category, or add a type or keywords, otherwise nothing can be matched automatically.");
      return;
    }
    run(async () => {
      const body = {
        filingType: tplEdit.filingType,
        label: tplEdit.label,
        category: tplEdit.category,
        subtype: tplEdit.subtype,
        keyword: tplEdit.keyword,
        periodScope: tplEdit.periodScope,
        required: tplEdit.required,
      };
      if (tplEdit.id) await updateFilingTemplate(tplEdit.id, body);
      else await createFilingTemplate(body);
      setTemplates(await fetchFilingTemplates());
      setTplEdit(null);
    });
  }

  function removeTemplate(t) {
    run(async () => {
      await deleteFilingTemplate(t.id);
      setTemplates(await fetchFilingTemplates());
      if (tplEdit && tplEdit.id === t.id) setTplEdit(null);
    });
  }

  function applyView(next) {
    if (next) {
      setView(next);
      setLog(null);
    }
  }

  function tick(item) {
    run(async () => applyView(await updateFilingItem(item.id, item.state === "ticked" ? "open" : "ticked")));
  }
  function reopenItem(item) {
    run(async () => applyView(await updateFilingItem(item.id, "open")));
  }
  function submitNa(item) {
    if (!naText.trim()) {
      setError("Please give a short reason for marking this as not applicable.");
      return;
    }
    run(async () => {
      applyView(await updateFilingItem(item.id, "na", naText.trim()));
      setNaFor(null);
      setNaText("");
    });
  }
  function link(item) {
    const docId = linkChoice[item.id];
    if (!docId) return;
    run(async () => {
      applyView(await linkFilingDocument(item.id, Number(docId)));
      setLinkChoice({ ...linkChoice, [item.id]: "" });
    });
  }
  function unlink(item, doc) {
    run(async () => applyView(await unlinkFilingDocument(item.id, doc.id)));
  }
  function refresh() {
    run(async () => applyView(await fetchFiling(view.filing.id)));
  }

  function downloadBundle() {
    run(async () => {
      const name = await downloadFilingBundle(view.filing.id, { includePersonal });
      setNotice(`Download started: ${name}. Your computer may ask where to save it.`);
    });
  }

  function submitFiled(ev) {
    ev.preventDefault();
    if (!isIso(filedForm.date)) {
      setError("Please enter the date it was filed.");
      return;
    }
    run(async () => {
      applyView(await markFilingFiled(view.filing.id, { filedDate: filedForm.date, referenceNo: filedForm.ref, notes: filedForm.notes }));
      setFiledForm(null);
      refreshList();
      if (onChanged) onChanged();
    });
  }

  function reopenFilingClick() {
    run(async () => {
      applyView(await reopenFiling(view.filing.id));
      refreshList();
    });
  }

  function toggleLog() {
    if (log) {
      setLog(null);
      return;
    }
    run(async () => setLog(await fetchFilingLog(view.filing.id)));
  }

  async function copyText(key, text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        // nothing more to try
      }
      ta.remove();
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? "" : c)), 1500);
  }

  function openPortal(url) {
    window.open(url, "_blank", "noopener");
  }

  function openFile(file) {
    run(() => openDocumentFile(file.id, file.filename));
  }
  function saveFile(file) {
    run(() => downloadDocumentFile(file.id, file.filename));
  }

  // ---------- Pieces ----------

  // These are plain functions that return JSX (called like `copyRow(...)`), not
  // components — a component defined inside another component gets a new
  // identity on every render, which would drop the cursor out of any text box
  // inside it after each keystroke.
  function copyRow(id, label, value, mono) {
    const text = String(value || "");
    return (
      <div key={id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 0", borderBottom: "1px solid #EFEBDF" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={smallLabel}>{label}</div>
          <div style={{ fontSize: 13, color: text ? "#1C2430" : "#8A8577", fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-word", whiteSpace: "pre-line" }}>
            {text || "Not on record"}
          </div>
        </div>
        {text && (
          <button type="button" onClick={() => copyText(id, text)} style={{ ...linkBtn, flexShrink: 0, marginTop: 14 }}>
            {copied === id ? "Copied ✓" : "Copy"}
          </button>
        )}
      </div>
    );
  }

  function hiddenRow(label) {
    return (
      <div key={label} style={{ padding: "7px 0", borderBottom: "1px solid #EFEBDF" }}>
        <div style={smallLabel}>{label}</div>
        <button type="button" onClick={onRequestReveal} style={{ ...linkBtn, fontSize: 13 }}>
          •••• — View
        </button>
      </div>
    );
  }

  function detailsPanel() {
    const c = view.client;
    const directors = String(c.directors || "").split("\n").map((d) => d.trim()).filter(Boolean);
    return (
      <div style={{ ...box, padding: "10px 14px" }}>
        <div style={{ fontSize: 11, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 2 }}>
          Company details to copy
        </div>
        {copyRow("company", "Company name", c.company)}
        {revealed ? copyRow("roc", "ROC / UEN", c.roc, true) : hiddenRow("ROC / UEN")}
        {view.filing.filing_type === "gst" && copyRow("gst", "GST registration no.", c.gst_reg_no, true)}
        {copyRow("fye", "Financial year-end", c.year_end)}
        {copyRow("inc", "Date incorporated", c.date_inc)}
        {copyRow("addr", "Registered address", c.registered_address)}
        {directors.length === 0
          ? copyRow("dir", "Directors", "")
          : directors.map((name, i) => copyRow(`dir${i}`, i === 0 ? "Directors" : " ", name))}
        {view.filing.filing_type === "agm" && copyRow("agm", "Last AGM filed", c.last_agm_date)}
        {revealed ? (
          <>
            {copyRow("contact", "Person in charge", c.contact)}
            {copyRow("phone", "Phone", c.contact_phone)}
            {copyRow("email", "Email", c.contact_email)}
          </>
        ) : (
          hiddenRow("Person in charge (name, phone, email)")
        )}
        {view.filing.filing_type === "gst" && !c.gst_reg_no && (
          <div style={{ fontSize: 11, color: "#7A5215", marginTop: 8 }}>GST registration number isn&apos;t recorded yet. An admin can add it under Edit details.</div>
        )}
      </div>
    );
  }

  function itemCard(item, readOnly) {
    const availKey = item.state === "na" ? "na" : item.availability;
    const chip = AVAILABILITY[availKey];
    const linkable = documents.filter((d) => !item.docs.some((x) => x.id === d.id));
    return (
      <div key={item.id} style={{ ...box, padding: "10px 12px", marginBottom: 8, opacity: item.state === "na" ? 0.8 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={item.state === "ticked"}
            disabled={readOnly || busy || item.state === "na"}
            onChange={() => tick(item)}
            title="Tick when you have checked this item"
            style={{ width: 16, height: 16, flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1C2430" }}>
              {item.label}
              {!item.required && <span style={{ fontWeight: 400, color: "#8A8577", fontSize: 11, marginLeft: 6 }}>optional</span>}
            </div>
          </div>
          <span style={{ background: chip.bg, color: chip.fg, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", flexShrink: 0 }}>{chip.label}</span>
        </div>

        {item.state === "na" && (
          <div style={{ fontSize: 12, color: "#5B5648", marginTop: 6 }}>
            Reason: {item.naReason}
            {!readOnly && (
              <button type="button" onClick={() => reopenItem(item)} style={{ ...linkBtn, marginLeft: 8 }}>
                Undo
              </button>
            )}
          </div>
        )}

        {item.state !== "na" && item.docs.length === 0 && (
          <div style={{ fontSize: 12, color: "#7A2C2E", marginTop: 6 }}>
            Nothing matched yet. If it&apos;s been logged under a different name, link it below; otherwise log it first with &quot;Log a document&quot;.
          </div>
        )}

        {item.state !== "na" &&
          item.docs.map((d) => (
            <div key={d.id} style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #E5E1D5" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                <span style={{ fontFamily: "monospace", color: "#4A4638" }}>{d.code}</span>
                <span style={{ color: "#1C2430" }}>{d.serviceDetail || CATEGORY_LABEL[d.category] || d.category}</span>
                <span style={{ color: "#8A8577" }}>received {d.dateReceived}</span>
                {d.how === "linked" && (
                  <span style={{ background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>linked by hand</span>
                )}
                {d.how === "linked" && !readOnly && (
                  <button type="button" onClick={() => unlink(item, d)} style={{ ...linkBtn, color: "#A63D40" }}>
                    Unlink
                  </button>
                )}
              </div>
              <div style={{ fontSize: 12, marginTop: 4, color: d.status === "Checked out" ? "#A63D40" : "#4A4638" }}>
                {d.isBatch ? `Paper box (about ${d.batchCount || "?"} documents)` : "Paper"} — {d.location} · {d.status}
                {d.status === "Checked out" && " (currently out of the filing cabinet)"}
              </div>
              {d.files.map((f) => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => openFile(f)}
                    title="Open"
                    style={{ ...linkBtn, fontSize: 12, textAlign: "left", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {f.filename}
                  </button>
                  <span style={{ fontSize: 11, color: "#8A8577", flexShrink: 0 }}>{formatSize(f.size_bytes)}</span>
                  <button type="button" onClick={() => saveFile(f)} style={{ ...linkBtn, flexShrink: 0 }}>
                    Save
                  </button>
                </div>
              ))}
              {d.files.length === 0 && !readOnly && renderAttachments && <div style={{ marginTop: 4 }}>{renderAttachments(d.id)}</div>}
            </div>
          ))}

        {!readOnly && item.state !== "na" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {linkable.length > 0 && (
              <>
                <select
                  value={linkChoice[item.id] || ""}
                  onChange={(e) => setLinkChoice({ ...linkChoice, [item.id]: e.target.value })}
                  style={{ ...fieldInput, width: "auto", maxWidth: 260, padding: "5px 8px", fontSize: 12 }}
                >
                  <option value="">Link another document…</option>
                  {linkable.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} — {d.serviceDetail || CATEGORY_LABEL[d.category] || d.category}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={!linkChoice[item.id] || busy} onClick={() => link(item)} style={{ ...plainBtn, padding: "5px 10px" }}>
                  Link
                </button>
              </>
            )}
            {naFor === item.id ? (
              <>
                <input
                  value={naText}
                  onChange={(e) => setNaText(e.target.value)}
                  placeholder="Why isn't this needed?"
                  style={{ ...fieldInput, width: 220, padding: "5px 8px", fontSize: 12 }}
                />
                <button type="button" onClick={() => submitNa(item)} disabled={busy} style={{ ...plainBtn, padding: "5px 10px" }}>
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNaFor(null);
                    setNaText("");
                  }}
                  style={linkBtn}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNaFor(item.id);
                  setNaText("");
                }}
                style={linkBtn}
              >
                Not applicable
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---------- Screens ----------

  const overlay = {
    position: "fixed",
    inset: 0,
    zIndex: 52,
    background: "rgba(28,36,48,0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  };
  const card = { width: step === "filing" ? 980 : 520, maxWidth: "100%", maxHeight: "92vh", background: "#FBFAF6", padding: 24, overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" };
  const titleStyle = { fontFamily: "'Fraunces', Georgia, serif", fontSize: 19, fontWeight: 700 };

  const errorBox = error && (
    <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600, margin: "12px 0" }}>{error}</div>
  );

  let body = null;

  if (step === "loading") {
    body = (
      <div style={{ padding: "30px 0", textAlign: "center", color: "#8A8577", fontSize: 13 }}>
        <Loader2 size={20} style={{ animation: "fams-spin 1s linear infinite" }} /> <div style={{ marginTop: 8 }}>Loading…</div>
        <style>{"@keyframes fams-spin { to { transform: rotate(360deg); } }"}</style>
      </div>
    );
  }

  if (step === "list") {
    body = (
      <div>
        <div style={{ fontSize: 12, color: "#8A8577", margin: "4px 0 16px", lineHeight: 1.5 }}>
          Lines up the documents for a filing and bundles them for download. The return itself is still filed by you on the official portal.
        </div>
        {errorBox}
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <button type="button" onClick={() => beginNew("gst")} style={{ ...primaryBtn, flex: 1 }}>
            Prepare a GST return
          </button>
          <button type="button" onClick={() => beginNew("agm")} style={{ ...primaryBtn, flex: 1 }}>
            Prepare AGM / Annual Return
          </button>
        </div>
        {user.role === "admin" && (
          <div style={{ marginBottom: 16 }}>
            <button type="button" onClick={openTemplates} style={linkBtn}>
              Edit the document checklists (admin)
            </button>
          </div>
        )}
        <div style={{ ...smallLabel, marginBottom: 6 }}>Earlier filings for this client</div>
        {filings.length === 0 ? (
          <div style={{ fontSize: 13, color: "#8A8577" }}>None yet.</div>
        ) : (
          <div style={box}>
            {filings.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => openFiling(f.id)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", border: "none", borderBottom: "1px solid #E5E1D5", background: "none", padding: "10px 12px", cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ fontSize: 13, color: "#1C2430" }}>
                  <strong>{f.filing_type === "gst" ? "GST" : "AGM / Annual Return"}</strong> — {f.period_label}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: f.status === "filed" ? "#2F6F62" : "#B4791F" }}>
                  {f.status === "filed" ? `Filed ${prettyDate(f.filed_date)}` : "In preparation"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (step === "templates") {
    const types = [
      { key: "gst", title: "GST return" },
      { key: "agm", title: "AGM / Annual Return" },
    ];
    body = (
      <div>
        <button type="button" onClick={() => { setStep("list"); setError(""); }} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4, margin: "6px 0 10px" }}>
          <ArrowLeft size={12} /> Back
        </button>
        <div style={{ fontSize: 12, color: "#8A8577", lineHeight: 1.5, marginBottom: 12 }}>
          These are the documents each filing asks for. Changes apply to filings started from now on; filings already in progress keep the list they started with.
          &quot;Type&quot; matches the start of a document&apos;s description (e.g. Bank Statement), and keywords match anywhere in it (separate several with commas).
        </div>
        {errorBox}
        {types.map((t) => (
          <div key={t.key} style={{ marginBottom: 18 }}>
            <div style={{ ...smallLabel, marginBottom: 6 }}>{t.title}</div>
            <div style={box}>
              {templates.filter((x) => x.filing_type === t.key).map((x) => (
                <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #E5E1D5", fontSize: 13 }}>
                  <span style={{ flex: 1 }}>
                    {x.label}
                    {!x.required && <span style={{ color: "#8A8577", fontSize: 11, marginLeft: 6 }}>optional</span>}
                  </span>
                  <button type="button" onClick={() => editTemplate(x)} style={linkBtn}>Edit</button>
                  <button type="button" onClick={() => removeTemplate(x)} style={{ ...linkBtn, color: "#A63D40" }}>Remove</button>
                </div>
              ))}
              <div style={{ padding: "8px 12px" }}>
                <button type="button" onClick={() => { setTplEdit(blankTemplate(t.key)); setError(""); }} style={linkBtn}>+ Add an item</button>
              </div>
            </div>
          </div>
        ))}

        {tplEdit && (
          <form onSubmit={saveTemplate} style={{ ...box, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {tplEdit.id ? "Edit item" : "New item"} — {tplEdit.filingType === "gst" ? "GST return" : "AGM / Annual Return"}
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
              Name shown on the checklist
              <input value={tplEdit.label} onChange={(e) => setTplEdit({ ...tplEdit, label: e.target.value })} style={{ ...fieldInput, marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
              Look in category
              <select value={tplEdit.category} onChange={(e) => setTplEdit({ ...tplEdit, category: e.target.value })} style={{ ...fieldInput, marginTop: 4 }}>
                <option value="">Any category</option>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
              Type (optional) — e.g. Sales / Invoices
              <input value={tplEdit.subtype} onChange={(e) => setTplEdit({ ...tplEdit, subtype: e.target.value })} style={{ ...fieldInput, marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
              Keywords (optional) — e.g. minutes, notice
              <input value={tplEdit.keyword} onChange={(e) => setTplEdit({ ...tplEdit, keyword: e.target.value })} style={{ ...fieldInput, marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
              Which documents count
              <select value={tplEdit.periodScope} onChange={(e) => setTplEdit({ ...tplEdit, periodScope: e.target.value })} style={{ ...fieldInput, marginTop: 4 }}>
                <option value="period">Only those labelled with a month inside the filing period</option>
                <option value="any">Any date (show everything that matches)</option>
              </select>
            </label>
            <label style={{ fontSize: 12, color: "#4A4638", display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={tplEdit.required} onChange={(e) => setTplEdit({ ...tplEdit, required: e.target.checked })} />
              Required (untick for optional)
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => setTplEdit(null)} style={plainBtn}>Cancel</button>
              <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving…" : "Save item"}</button>
            </div>
          </form>
        )}
      </div>
    );
  }

  if (step === "new" && form) {
    const derived = form.type === "gst" ? deriveGst(form.endMonth, Number(form.months)) : deriveAgm(form.fyeDate);
    body = (
      <form onSubmit={submitNew} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
        <button type="button" onClick={() => setStep("list")} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4, alignSelf: "flex-start" }}>
          <ArrowLeft size={12} /> Back
        </button>
        {form.type === "gst" ? (
          <>
            <div style={{ fontSize: 13, color: "#4A4638" }}>
              Which GST period are you filing? We&apos;ve picked the latest finished one
              {schedules.some((s) => /gst/i.test(s.taskName || "")) ? " from this client's GST schedule" : ""}. Change it if needed.
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
              Period ends in
              <input type="month" value={form.endMonth} onChange={(e) => updateForm({ endMonth: e.target.value })} style={{ ...fieldInput, marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
              Period covers
              <select value={form.months} onChange={(e) => updateForm({ months: Number(e.target.value) })} style={{ ...fieldInput, marginTop: 4 }}>
                <option value={3}>3 months (quarterly)</option>
                <option value={1}>1 month (monthly)</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "#4A4638" }}>
              Which financial year is the AGM / Annual Return for? We&apos;ve picked the client&apos;s current cycle from their year-end. Change it if needed.
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
              Financial year-end date
              <input type="date" value={form.fyeDate} onChange={(e) => updateForm({ fyeDate: e.target.value })} style={{ ...fieldInput, marginTop: 4 }} />
            </label>
          </>
        )}
        <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
          Due date
          <input type="date" value={form.dueDate} onChange={(e) => updateForm({ dueDate: e.target.value })} style={{ ...fieldInput, marginTop: 4 }} />
        </label>
        {derived && (
          <div style={{ background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, fontSize: 12, padding: "8px 12px" }}>
            {form.type === "gst" ? "GST" : "AGM / Annual Return"} — <strong>{derived.periodLabel}</strong> ({prettyDate(derived.periodStart)} to {prettyDate(derived.periodEnd)})
          </div>
        )}
        {errorBox}
        <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>
          {busy ? "Opening…" : "Open checklist"}
        </button>
      </form>
    );
  }

  if (step === "filing" && view) {
    const { filing, items } = view;
    const filed = filing.status === "filed";
    const typeName = filing.filing_type === "gst" ? "GST return" : "AGM / Annual Return";
    const counted = items.filter((i) => i.state !== "na");
    const requiredItems = counted.filter((i) => i.required);
    const notTicked = requiredItems.filter((i) => i.state !== "ticked");
    const missing = requiredItems.filter((i) => i.state !== "ticked" && i.availability === "missing");
    const days = filing.due_date ? daysUntil(filing.due_date) : null;
    const portal = PORTALS[filing.filing_type];
    const hasPersonalFiles = items.some((i) => i.docs.some((d) => d.category === "personal" && d.files.length > 0));

    body = (
      <div>
        {/* Header */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", margin: "6px 0 14px" }}>
          <button type="button" onClick={() => { setStep("list"); setView(null); setError(""); setNotice(""); }} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4 }}>
            <ArrowLeft size={12} /> All filings
          </button>
          <div style={{ fontSize: 13, color: "#4A4638" }}>
            <strong>{typeName}</strong> — {filing.period_label}
          </div>
          {filing.due_date && (
            <span style={{ fontSize: 12, fontWeight: 700, color: filed ? "#8A8577" : days < 0 ? "#A63D40" : days <= 14 ? "#B4791F" : "#2F6F62" }}>
              Due {prettyDate(filing.due_date)}
              {!filed && (days < 0 ? ` · ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue` : ` · ${days} day${days === 1 ? "" : "s"} left`)}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => openPortal(portal.url)} style={plainBtn}>
            {portal.label} <ArrowRight size={11} style={{ verticalAlign: "middle" }} />
          </button>
          <button type="button" onClick={refresh} disabled={busy} style={plainBtn}>
            Refresh
          </button>
        </div>

        {filed && (
          <div style={{ background: "#E3EFE9", color: "#1F4A40", padding: "10px 14px", fontSize: 13, marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <CheckCircle2 size={16} />
            <span>
              Filed on <strong>{prettyDate(filing.filed_date)}</strong>
              {filing.reference_no ? ` — reference ${filing.reference_no}` : ""} (by {filing.filed_by}).
            </span>
            {user.role === "admin" && (
              <button type="button" onClick={reopenFilingClick} disabled={busy} style={{ ...linkBtn, marginLeft: "auto" }}>
                Reopen
              </button>
            )}
          </div>
        )}

        {errorBox}
        {notice && <div style={{ background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, padding: "8px 12px", fontSize: 12, fontWeight: 600, margin: "0 0 12px" }}>{notice}</div>}

        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* Checklist */}
          <div style={{ flex: "1 1 520px", minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#4A4638", marginBottom: 10 }}>
              <strong>{requiredItems.length - notTicked.length}</strong> of <strong>{requiredItems.length}</strong> required items ticked
              {missing.length > 0 && <span style={{ color: "#A63D40", fontWeight: 600 }}> · {missing.length} not found</span>}
            </div>
            {items.map((item) => itemCard(item, filed))}
          </div>

          {/* Details */}
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>{detailsPanel()}</div>
        </div>

        {/* Bottom bar */}
        <div style={{ ...box, padding: "14px 16px", marginTop: 16 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={downloadBundle} disabled={busy} style={{ ...primaryBtn, display: "flex", alignItems: "center", gap: 6, opacity: busy ? 0.7 : 1 }}>
              <Download size={14} /> Download all files (ZIP)
            </button>
            {hasPersonalFiles && (
              <label style={{ fontSize: 12, color: "#4A4638", display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={includePersonal} onChange={(e) => setIncludePersonal(e.target.checked)} />
                Include personal particulars (director ID etc.) — held back by default
              </label>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={toggleLog} style={linkBtn}>
              {log ? "Hide activity" : "Show activity"}
            </button>
            {!filed && !filedForm && (
              <button
                type="button"
                onClick={() => setFiledForm({ date: todayIso(), ref: "", notes: "" })}
                style={plainBtn}
              >
                Mark as filed
              </button>
            )}
          </div>

          {filedForm && !filed && (
            <form onSubmit={submitFiled} style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #E5E1D5", display: "flex", flexDirection: "column", gap: 10 }}>
              {notTicked.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FBF1E0", color: "#7A5215", fontSize: 12, padding: "8px 12px" }}>
                  <AlertTriangle size={14} />
                  {notTicked.length} required item{notTicked.length === 1 ? " isn't" : "s aren't"} ticked yet. You can still mark it as filed.
                </div>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638", flex: "0 0 160px" }}>
                  Date filed
                  <input type="date" value={filedForm.date} onChange={(e) => setFiledForm({ ...filedForm, date: e.target.value })} style={{ ...fieldInput, marginTop: 4 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638", flex: "1 1 200px" }}>
                  Reference number from the portal
                  <input value={filedForm.ref} onChange={(e) => setFiledForm({ ...filedForm, ref: e.target.value })} style={{ ...fieldInput, marginTop: 4 }} placeholder="Optional" />
                </label>
              </div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
                Notes
                <input value={filedForm.notes} onChange={(e) => setFiledForm({ ...filedForm, notes: e.target.value })} style={{ ...fieldInput, marginTop: 4 }} placeholder="Optional" />
              </label>
              <div style={{ fontSize: 11, color: "#8A8577" }}>
                {filing.filing_type === "agm"
                  ? "This also sets the client's last AGM date, which clears the overdue / due-soon warning."
                  : "This also marks the client's GST schedule as completed for this cycle, if they have one."}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => setFiledForm(null)} style={plainBtn}>
                  Cancel
                </button>
                <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>
                  {busy ? "Saving…" : notTicked.length > 0 ? "Mark as filed anyway" : "Mark as filed"}
                </button>
              </div>
            </form>
          )}

          {log && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #E5E1D5", maxHeight: 180, overflowY: "auto" }}>
              {log.length === 0 && <div style={{ fontSize: 12, color: "#8A8577" }}>No activity yet.</div>}
              {log.map((e) => (
                <div key={e.id} style={{ fontSize: 12, color: "#4A4638", padding: "3px 0" }}>
                  <span style={{ color: "#8A8577", fontFamily: "monospace" }}>{String(e.logged_at).slice(0, 16)}</span> · {e.staff} · <strong>{e.action}</strong>
                  {e.detail ? ` — ${e.detail}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={titleStyle}>Prepare filing</div>
            <div style={{ fontSize: 12, color: "#8A8577", marginTop: 3 }}>
              {client.company} <span style={{ fontFamily: "monospace" }}>({client.fileNo})</span>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", flexShrink: 0 }} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
