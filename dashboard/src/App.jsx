import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { Plus, Search, Printer, Clock, ShieldAlert, FileText, X, LogOut, LogIn, ScanLine, CheckCircle2, AlertCircle, Building2, ArrowRight, ArrowLeft, User, UserPlus, ChevronDown, Phone, Pencil, Package, Info, Upload, Download, Loader2, LayoutGrid, AlertTriangle, CalendarClock, Activity, Paperclip, KeyRound } from "lucide-react";
import Login, { FirstRunSetup } from "./Login.jsx";
import UpdateManager from "./UpdateManager.jsx";
import FilingHelper from "./Filing.jsx";
import ClientFiles from "./Vault.jsx";
import { computeNextDue } from "./deadlines.js";
import { ComplianceTiles, countUrgent } from "./Comply.jsx";
import { Spinner, LoadingPanel, TopBar } from "./Loading.jsx";
import { Pager, usePaging } from "./Pager.jsx";
import { LiveClock } from "./Clock.jsx";
import { OnboardingHub, ClientOnboarding } from "./Onboard.jsx";
import { Wallpaper, glassPanel, glassDark, LOGO_URL, BRAND_GREEN, BRAND_GREEN_DEEP, BRAND_GREEN_BRIGHT, HIGHLIGHT_BG, HIGHLIGHT_TEXT } from "./theme.jsx";
import {
  getStoredUser,
  clearSession,
  fetchSetupStatus,
  fetchClients,
  fetchDocuments,
  fetchAccessLog,
  createDocument,
  createBatchIntake,
  createClient,
  updateClient,
  toggleCheckout as apiToggleCheckout,
  lookupDocument,
  printDocumentLabel,
  printClientFolderLabel,
  updateClientReportFields,
  fetchAllSchedules,
  fetchClientSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  fetchDocumentFiles,
  uploadDocumentFile,
  deleteDocumentFile,
  openDocumentFile,
  changePassword,
  ApiError,
} from "./api.js";

const CATEGORIES = [
  { key: "secretarial", label: "Secretarial records", note: "Shareholders, partners, owners", sensitivity: "High" },
  { key: "bookkeeping", label: "Bookkeeping", note: "Bank statements, sales/purchases, payroll, GST, director payments", sensitivity: "Medium" },
  { key: "banking_tax", label: "Banking & tax details", note: "Bank statements, tax filings, GST", sensitivity: "High" },
  { key: "personal", label: "Personal particulars", note: "Director / secretary ID data", sensitivity: "Critical" },
];

const CAT_STYLE = {
  secretarial: { bar: "#2F6F62", chip: HIGHLIGHT_BG, text: HIGHLIGHT_TEXT },
  bookkeeping: { bar: "#3C6E9C", chip: "#E1EAF6", text: "#20415F" },
  banking_tax: { bar: "#B4791F", chip: "#F6ECDA", text: "#7A5215" },
  personal: { bar: "#A63D40", chip: "#F5E1E1", text: "#7A2C2E" },
};

// Recurring bookkeeping intake — a monthly document, not a one-off filing.
// Composed into the document's free-text serviceDetail as "<Subtype> — <Period>"
// so no schema change is needed; the client's document list already shows
// this chronologically once it's part of the normal ledger.
const BOOKKEEPING_SUBTYPES = [
  "Bank Statement",
  "Sales / Invoices",
  "Purchases / Bills",
  "Payroll",
  "GST",
  "Director KYC / Update",
  "Payment Intimation",
  "Other",
];

const SHELF_OPTIONS = ["Shelf 1", "Shelf 2", "Shelf 3", "Shelf 4", "Shelf 5", "Shelf 6", "Shelf 7", "Shelf 8", "Shelf 9", "Shelf 10"];

// Box/bag intake checklist — "this box has bank statements, vouchers, etc."
// One tick per document type actually in the box; each ticked item becomes
// its own document entry (own code, own label) once submitted, so staff
// don't fill the whole form out once per type.
const BATCH_CHECKLIST = [
  { key: "secretarial", category: "secretarial", label: "Secretarial records" },
  { key: "banking_tax", category: "banking_tax", label: "Banking & tax details" },
  { key: "personal", category: "personal", label: "Personal particulars" },
  ...BOOKKEEPING_SUBTYPES.map((s) => ({ key: `bk:${s}`, category: "bookkeeping", serviceDetail: s, label: s })),
];

function monthLabel(monthValue) {
  // monthValue is "YYYY-MM" from an <input type="month">
  if (!monthValue) return "";
  const [y, m] = monthValue.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-SG", { month: "short", year: "numeric" });
}

// ACRA rule for private companies (post-2021): Annual Return is due within
// 7 months of FYE — not a fixed calendar date, since every company's FYE
// falls in a different month depending on when they were incorporated.
// Rolls forward to the next FYE cycle once last_agm_date shows this
// cycle's filing is already done.
const MONTH_INDEX = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

// toISOString() converts to UTC first, which silently shifts the displayed
// date back a day for anyone in a timezone ahead of UTC (Singapore is
// UTC+8) — format from the Date's own local fields instead.
function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Hand-mapped rather than toLocaleDateString — en-GB's CLDR data abbreviates
// September as "Sept", not "Sep" (bit the label printer earlier this project).
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDisplayDate(date) {
  return `${date.getDate()} ${MONTH_ABBR[date.getMonth()]} ${date.getFullYear()}`;
}

// date.setMonth(date.getMonth() + n) preserves the original day-of-month,
// which overflows into the following month whenever the target month is
// shorter (e.g. FYE=July, day 31, + 7 months lands on "Feb 31" -> rolls to
// Mar 3 instead of the intended Feb 28/29). Clamp to the target month's own
// last day instead, same as computeNextDue's lastDayOfMonth/makeDate below.
function addMonthsClamped(date, monthsToAdd) {
  const targetMonthIndex = date.getMonth() + monthsToAdd;
  const targetYear = date.getFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  return new Date(targetYear, normalizedMonth, Math.min(date.getDate(), lastDayOfTargetMonth));
}

function computeArDeadline(yearEndMonth, lastAgmDate, today = new Date()) {
  const m = MONTH_INDEX[String(yearEndMonth || "").trim().toUpperCase().slice(0, 3)];
  if (m === undefined) return null;

  let fyeYear = today.getFullYear();
  let fye = new Date(fyeYear, m + 1, 0); // last day of that month
  if (fye > today) {
    fyeYear -= 1;
    fye = new Date(fyeYear, m + 1, 0);
  }
  if (lastAgmDate && new Date(lastAgmDate) >= fye) {
    fyeYear += 1;
    fye = new Date(fyeYear, m + 1, 0);
  }

  const deadline = addMonthsClamped(fye, 7);
  const daysLeft = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
  return { fye, deadline, daysLeft, overdue: daysLeft < 0 };
}

const SCHEDULE_TASK_PRESETS = ["CPF Filing", "GST Filing", "Compilation", "Accounting"];

// Same "current cycle, roll forward once completed" idea as computeArDeadline,
// generalized across monthly/quarterly/yearly — recurring tasks (CPF, GST,
// Compilation, Accounting) that aren't tied to FYE the way AR/AGM is.
//
// "Completed" is matched by which cycle window the completion date falls
// in, not by literal day-of-month comparison — filing a few days *before*
// the due date should still satisfy that cycle, not silently get attributed
// to the next one (comparing raw dates got this wrong for early filers).

// A green "Verified" tick means the core statutory fields a corporate
// secretary actually needs are on file — not a claim about ACRA's own
// records, just our own data completeness signal.
function isVerifiedProfile(client) {
  return !!(client.roc && client.registeredAddress && client.directors && client.yearEnd);
}

function recurringServicesFor(clientId, entries) {
  const docs = entries.filter((e) => e.clientId === clientId);
  const cats = new Set(docs.map((d) => d.category));
  return CATEGORIES.filter((c) => cats.has(c.key));
}

const CLIENT_STATUS = {
  A: { label: "Active", chip: BRAND_GREEN_BRIGHT, text: "#FFFFFF" },
  D: { label: "Dormant", chip: "#E5E1D5", text: "#4A4638" },
  ADHOC: { label: "Adhoc", chip: "#F6ECDA", text: "#7A5215" },
  SO: { label: "Struck Off", chip: "#F5E1E1", text: "#7A2C2E" },
  NR: { label: "Not Reachable", chip: "#EDE4D3", text: "#8A6D3A" },
  L: { label: "Left", chip: "#E5E1D5", text: "#6B6656" },
};

function Label({ entry }) {
  const style = CAT_STYLE[entry.category];
  const cat = CATEGORIES.find((c) => c.key === entry.category);
  return (
    <div style={{ width: 300, border: "1px solid #C9C4B6", background: "#FBFAF6", display: "flex", fontFamily: "'Fraunces', Georgia, serif" }}>
      <div style={{ width: 10, background: style.bar }} />
      <div style={{ padding: "12px 14px", flex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: 1, color: "#8A8577", marginBottom: 4, fontFamily: "'Inter', sans-serif" }}>
          {cat.sensitivity} · Financial Asset Register
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1C2430", marginBottom: 2 }}>{entry.client}</div>
        <div style={{ fontSize: 12, color: "#4A4638", marginBottom: 8 }}>{cat.label}</div>
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            letterSpacing: 2,
            background: "repeating-linear-gradient(90deg, #1C2430 0 2px, transparent 2px 4px)",
            height: 26,
            marginBottom: 6,
          }}
        />
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#1C2430" }}>{entry.code}</div>
        <div style={{ fontSize: 10, color: "#8A8577", marginTop: 4, fontFamily: "'Inter', sans-serif" }}>{entry.location}</div>
      </div>
    </div>
  );
}

function ClientLabel({ client }) {
  return (
    <div style={{ width: 300, border: "1px solid #C9C4B6", background: "#FBFAF6", display: "flex", fontFamily: "'Fraunces', Georgia, serif" }}>
      <div style={{ width: 10, background: "#1C2430" }} />
      <div style={{ padding: "12px 14px", flex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: 1, color: "#8A8577", marginBottom: 4, fontFamily: "'Inter', sans-serif" }}>
          Client Master File · Financial Asset Register
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1C2430", marginBottom: 2 }}>{client.company}</div>
        {client.roc && <div style={{ fontSize: 12, color: "#4A4638", marginBottom: 8 }}>ROC {client.roc}</div>}
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            letterSpacing: 2,
            background: "repeating-linear-gradient(90deg, #1C2430 0 2px, transparent 2px 4px)",
            height: 26,
            marginBottom: 6,
          }}
        />
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#1C2430" }}>{client.fileNo}</div>
      </div>
    </div>
  );
}

function BoxLabel({ entry }) {
  return (
    <div style={{ width: 300, border: "2px solid #1C2430", background: "#FBFAF6", fontFamily: "'Fraunces', Georgia, serif" }}>
      <div style={{ background: "#1C2430", color: "#EDEAE2", padding: "6px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, fontFamily: "'Inter', sans-serif" }}>
        BULK INTAKE — NOT YET SORTED
      </div>
      <div style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1C2430", marginBottom: 4 }}>{entry.client}</div>
        {entry.batchCount && (
          <div style={{ fontSize: 12, color: "#4A4638", marginBottom: 8 }}>Approx. {entry.batchCount} documents</div>
        )}
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            letterSpacing: 2,
            background: "repeating-linear-gradient(90deg, #1C2430 0 2px, transparent 2px 4px)",
            height: 26,
            marginBottom: 6,
          }}
        />
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#1C2430" }}>{entry.code}</div>
        <div style={{ fontSize: 10, color: "#8A8577", marginTop: 4, fontFamily: "'Inter', sans-serif" }}>{entry.location}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(() => getStoredUser());
  // null = still checking, true = empty database (brand-new install), false = normal login.
  // Skipped entirely once a session token already exists.
  const [needsSetup, setNeedsSetup] = useState(null);

  useEffect(() => {
    if (user) return;
    fetchSetupStatus()
      .then((res) => setNeedsSetup(!!res.needsSetup))
      .catch(() => setNeedsSetup(false)); // if the check itself fails, fall back to the normal login screen
  }, [user]);

  if (!user) {
    if (needsSetup === null) return null; // avoid a login-screen flash while this loads
    return needsSetup ? <FirstRunSetup onLoggedIn={setUser} /> : <Login onLoggedIn={setUser} />;
  }

  return (
    <>
      <Dashboard user={user} onLogout={() => { clearSession(); setUser(null); }} />
      <UpdateManager />
    </>
  );
}

function Dashboard({ user, onLogout }) {
  const [entries, setEntries] = useState([]);
  const [log, setLog] = useState([]);
  const [clients, setClients] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [tab, setTab] = useState("dashboard");
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [clientQuery, setClientQuery] = useState("");
  const [clientStatusFilter, setClientStatusFilter] = useState("all");
  const [hoveredClientId, setHoveredClientId] = useState(null);
  const [clientPage, setClientPage] = useState(1);
  const [activeLetter, setActiveLetter] = useState(null);
  const clientTileRefs = useRef({});
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [clientDetail, setClientDetail] = useState(null);
  const [clientDetailMode, setClientDetailMode] = useState("view"); // view | edit
  const [showFiling, setShowFiling] = useState(false); // GST / AGM filing helper for the open client
  const [showVault, setShowVault] = useState(false); // uploaded-documents vault for the open client
  const [showKyc, setShowKyc] = useState(false); // onboarding forms (KYC, PEP) for the open client
  const [editClientForm, setEditClientForm] = useState(null);
  const [editClientBusy, setEditClientBusy] = useState(false);
  const [editClientError, setEditClientError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [printPreview, setPrintPreview] = useState(null);
  const [clientLabelPreview, setClientLabelPreview] = useState(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [printStatus, setPrintStatus] = useState(null); // { ok: bool, message: string }
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [form, setForm] = useState({ clientId: "", category: "secretarial", serviceDetail: "", bookkeepingSubtype: "", bookkeepingPeriod: "", location: "", dateReceived: "", loggedBy: user.username, isAgmFiling: false, isBatch: false, batchCount: "", checkedItems: [] });
  const [formBusy, setFormBusy] = useState(false);
  // A client emailed a soft copy alongside the physical drop-off — attach
  // it right in the same step instead of a separate trip to the document
  // row afterward. Single-document entries only (see submitForm).
  const [attachFile, setAttachFile] = useState(null);
  const [locationOtherMode, setLocationOtherMode] = useState(false);
  // After submitting, ask before printing rather than always popping the
  // label preview — most days staff don't need to re-label a file that's
  // already on the shelf, just log what came in.
  const [labelPrompt, setLabelPrompt] = useState(null);

  // "New entry" is a small wizard: search/pick a client, or fall through to
  // onboarding a client that doesn't exist yet, before logging a document.
  const [entryStep, setEntryStep] = useState("search"); // search | new-client | onboarded | document
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [newClientForm, setNewClientForm] = useState({
    company: "",
    roc: "",
    yearEnd: "",
    dateInc: "",
    registeredAddress: "",
    directors: "",
    contact: "",
    contactPhone: "",
    contactEmail: "",
    fax: "",
    status: "A",
  });
  const [newClientBusy, setNewClientBusy] = useState(false);
  const [newClientError, setNewClientError] = useState("");
  const [onboardedClient, setOnboardedClient] = useState(null);
  const [showPostOnboardActions, setShowPostOnboardActions] = useState(false);
  const postOnboardTimer = useRef(null);

  useEffect(() => () => clearTimeout(postOnboardTimer.current), []);
  useEffect(() => { setPrintStatus(null); }, [printPreview, clientLabelPreview]);

  function resetEntryWizard() {
    clearTimeout(postOnboardTimer.current);
    setEntryStep("search");
    setClientSearch("");
    setSelectedClient(null);
    setNewClientForm({
      company: "",
      roc: "",
      yearEnd: "",
      dateInc: "",
      registeredAddress: "",
      directors: "",
      contact: "",
      contactPhone: "",
      contactEmail: "",
      fax: "",
      status: "A",
    });
    setNewClientError("");
    setOnboardedClient(null);
    setShowPostOnboardActions(false);
    setForm({ clientId: "", category: "secretarial", serviceDetail: "", bookkeepingSubtype: "", bookkeepingPeriod: "", location: "", dateReceived: "", loggedBy: user.username, isAgmFiling: false, isBatch: false, batchCount: "", checkedItems: [] });
    setAttachFile(null);
    setLocationOtherMode(false);
  }

  function openEntryForm() {
    resetEntryWizard();
    setShowForm(true);
  }

  function closeEntryForm() {
    setShowForm(false);
    resetEntryWizard();
  }

  const clientMatches = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return clients.filter((c) => c.company.toLowerCase().includes(q) || c.fileNo.toLowerCase().includes(q)).slice(0, 8);
  }, [clients, clientSearch]);

  function handleSelectClient(client) {
    setSelectedClient(client);
    setForm((f) => ({ ...f, clientId: client.id }));
    setEntryStep("document");
  }

  function handleStartNewClient() {
    setNewClientForm((f) => ({ ...f, company: clientSearch.trim() }));
    setNewClientError("");
    setEntryStep("new-client");
  }

  function backToClientSearch() {
    setSelectedClient(null);
    setForm((f) => ({ ...f, clientId: "" }));
    setClientSearch("");
    setEntryStep("search");
  }

  async function submitNewClient(ev) {
    ev.preventDefault();
    if (
      !newClientForm.company.trim() ||
      !newClientForm.roc.trim() ||
      !newClientForm.yearEnd.trim() ||
      !newClientForm.dateInc ||
      !newClientForm.registeredAddress.trim() ||
      !newClientForm.directors.trim() ||
      !newClientForm.contact.trim() ||
      !newClientForm.contactPhone.trim()
    ) {
      setNewClientError(
        "Company, ROC number, year end, date incorporated, registered address, at least one director, and the person in charge's name and phone are all required."
      );
      return;
    }
    setNewClientBusy(true);
    setNewClientError("");
    try {
      const created = await createClient({
        company: newClientForm.company.trim(),
        roc: newClientForm.roc.trim(),
        yearEnd: newClientForm.yearEnd.trim(),
        dateInc: newClientForm.dateInc || "",
        registeredAddress: newClientForm.registeredAddress.trim(),
        directors: (newClientForm.directors || "").trim(),
        contact: newClientForm.contact.trim(),
        contactPhone: newClientForm.contactPhone.trim(),
        contactEmail: (newClientForm.contactEmail || "").trim(),
        fax: (newClientForm.fax || "").trim(),
        status: newClientForm.status,
      });
      setClients((prev) => [...prev, created].sort((a, b) => a.company.localeCompare(b.company)));
      setOnboardedClient(created);
      setEntryStep("onboarded");
      postOnboardTimer.current = setTimeout(() => setShowPostOnboardActions(true), 4000);
    } catch (err) {
      if (!handleAuthError(err)) setNewClientError(err.message || "Failed to add client");
    } finally {
      setNewClientBusy(false);
    }
  }

  function proceedToLogDocument() {
    clearTimeout(postOnboardTimer.current);
    setSelectedClient(onboardedClient);
    setForm({ clientId: onboardedClient.id, category: "secretarial", serviceDetail: "", bookkeepingSubtype: "", bookkeepingPeriod: "", location: "", dateReceived: "", loggedBy: user.username, isAgmFiling: false, isBatch: false, batchCount: "", checkedItems: [] });
    setAttachFile(null);
    setLocationOtherMode(false);
    setEntryStep("document");
  }

  function proceedToPrintFolderLabel() {
    clearTimeout(postOnboardTimer.current);
    setClientLabelPreview(onboardedClient);
    closeEntryForm();
  }

  const [scanValue, setScanValue] = useState("");
  const [scanResult, setScanResult] = useState(null);
  // ROC and contact details are hidden by default — on a scan result (often
  // used away from the desk) and in the client detail view — and only
  // shown after an explicit confirm. revealTarget is which view asked:
  // "scan" or "client"; confirming reveals only that one.
  const [scanRevealed, setScanRevealed] = useState(false);
  const [clientDetailRevealed, setClientDetailRevealed] = useState(false);
  const [revealTarget, setRevealTarget] = useState(null);
  useEffect(() => { setScanRevealed(false); }, [scanResult]);
  useEffect(() => { setClientDetailRevealed(false); }, [clientDetail]);
  const [scanStatus, setScanStatus] = useState("idle");
  const [scanHistory, setScanHistory] = useState([]);

  const handleAuthError = useCallback(
    (err) => {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return true;
      }
      return false;
    },
    [onLogout]
  );

  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [c, d, l, s] = await Promise.all([fetchClients(), fetchDocuments(), fetchAccessLog(), fetchAllSchedules()]);
      setClients(c);
      setEntries(d);
      setLog(l);
      setSchedules(s);
      setErrorMsg("");
    } catch (err) {
      if (!handleAuthError(err)) setErrorMsg(err.message || "Failed to load data");
    } finally {
      setRefreshing(false);
    }
  }, [handleAuthError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await refreshAll();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAll]);

  async function lookupCode(raw) {
    const code = raw.trim().toUpperCase();
    if (!code) {
      setScanStatus("idle");
      setScanResult(null);
      return;
    }
    try {
      const match = await lookupDocument(code);
      setScanResult(match);
      setScanStatus("found");
      setScanHistory((prev) => [{ code: match.code, time: new Date().toISOString().slice(11, 16) }, ...prev].slice(0, 6));
    } catch (err) {
      if (handleAuthError(err)) return;
      setScanResult(null);
      setScanStatus("not_found");
    }
  }

  function handleScanChange(ev) {
    const val = ev.target.value;
    setScanValue(val);
    // A barcode scanner types the full code fast then sends Enter; a QR
    // encoding just the short ID lands here the same way manual typing
    // would. Three shapes are valid: a document code (JDM2609BK2 — the
    // current scheme), an older FAM-2026-0001 code still on file for
    // documents logged before the switch, or a client file number (A1,
    // B15) from a folder label — look up as soon as any shape matches.
    const trimmed = val.trim();
    if (/^JDM\d{4}[A-Z]{2}\d+$/i.test(trimmed) || /^FAM-\d{4}-\d{4}$/i.test(trimmed) || /^[A-Z]{1,2}\d{1,4}$/i.test(trimmed)) {
      lookupCode(val);
    } else {
      setScanStatus("idle");
      setScanResult(null);
    }
  }

  function handleScanSubmit(ev) {
    ev.preventDefault();
    lookupCode(scanValue);
  }

  const filteredClients = useMemo(() => {
    return clients
      .filter((c) => {
        const matchesQuery =
          clientQuery.trim() === "" ||
          c.company.toLowerCase().includes(clientQuery.toLowerCase()) ||
          c.fileNo.toLowerCase().includes(clientQuery.toLowerCase()) ||
          c.roc.toLowerCase().includes(clientQuery.toLowerCase());
        const matchesStatus = clientStatusFilter === "all" || c.status === clientStatusFilter;
        return matchesQuery && matchesStatus;
      })
      .sort((a, b) => a.company.localeCompare(b.company));
  }, [clients, clientQuery, clientStatusFilter]);

  const CLIENTS_PER_PAGE = 24;
  const clientTotalPages = Math.max(1, Math.ceil(filteredClients.length / CLIENTS_PER_PAGE));
  const pagedClients = useMemo(
    () => filteredClients.slice((clientPage - 1) * CLIENTS_PER_PAGE, clientPage * CLIENTS_PER_PAGE),
    [filteredClients, clientPage]
  );
  useEffect(() => {
    setClientPage(1);
  }, [clientQuery, clientStatusFilter]);
  useEffect(() => {
    if (clientPage > clientTotalPages) setClientPage(clientTotalPages);
  }, [clientTotalPages, clientPage]);

  // Letters present in the current filtered set — drives which sidebar
  // letters are clickable vs. greyed out.
  const availableLetters = useMemo(() => {
    const set = new Set();
    for (const c of filteredClients) {
      const ch = (c.company || "").trim()[0];
      if (ch) set.add(ch.toUpperCase());
    }
    return set;
  }, [filteredClients]);

  function jumpToLetter(letter) {
    const idx = filteredClients.findIndex((c) => (c.company || "").trim()[0]?.toUpperCase() === letter);
    if (idx === -1) return;
    const targetPage = Math.floor(idx / CLIENTS_PER_PAGE) + 1;
    setActiveLetter(letter);
    if (targetPage !== clientPage) {
      setClientPage(targetPage);
      // wait for the new page's tiles to render before scrolling to one
      setTimeout(() => {
        const client = filteredClients[idx];
        clientTileRefs.current[client.id]?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 30);
    } else {
      const client = filteredClients[idx];
      clientTileRefs.current[client.id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function docCountFor(companyName) {
    return entries.filter((e) => (e.client || "").toLowerCase() === companyName.toLowerCase()).length;
  }

  function viewClientDocs(companyName) {
    setQuery(companyName);
    setCatFilter("all");
    setTab("register");
  }

  function openClientDetail(client) {
    setClientDetail(client);
    setClientDetailMode("view");
    setEditClientError("");
  }

  function closeClientDetail() {
    setClientDetail(null);
    setShowFiling(false);
    setShowVault(false);
    setShowKyc(false);
    setClientDetailMode("view");
    setEditClientForm(null);
    setEditClientError("");
  }

  function startEditClient() {
    setEditClientForm({
      company: clientDetail.company,
      roc: clientDetail.roc,
      yearEnd: clientDetail.yearEnd,
      dateInc: clientDetail.dateInc,
      registeredAddress: clientDetail.registeredAddress,
      directors: clientDetail.directors,
      contact: clientDetail.contact,
      contactPhone: clientDetail.contactPhone,
      contactEmail: clientDetail.contactEmail,
      fax: clientDetail.fax,
      gstRegNo: clientDetail.gstRegNo,
      status: clientDetail.status,
    });
    setEditClientError("");
    setClientDetailMode("edit");
  }

  function cancelEditClient() {
    setClientDetailMode("view");
    setEditClientForm(null);
    setEditClientError("");
  }

  async function submitEditClient(ev) {
    ev.preventDefault();
    if (
      !editClientForm.company.trim() ||
      !editClientForm.roc.trim() ||
      !editClientForm.yearEnd.trim() ||
      !editClientForm.dateInc ||
      !editClientForm.registeredAddress.trim() ||
      !editClientForm.directors.trim() ||
      !editClientForm.contact.trim() ||
      !editClientForm.contactPhone.trim()
    ) {
      setEditClientError(
        "Company, ROC number, year end, date incorporated, registered address, at least one director, and the person in charge's name and phone are all required."
      );
      return;
    }
    setEditClientBusy(true);
    setEditClientError("");
    try {
      const updated = await updateClient(clientDetail.id, {
        company: editClientForm.company.trim(),
        roc: editClientForm.roc.trim(),
        yearEnd: editClientForm.yearEnd.trim(),
        dateInc: editClientForm.dateInc,
        registeredAddress: editClientForm.registeredAddress.trim(),
        directors: editClientForm.directors.trim(),
        contact: editClientForm.contact.trim(),
        contactPhone: editClientForm.contactPhone.trim(),
        contactEmail: (editClientForm.contactEmail || "").trim(),
        fax: (editClientForm.fax || "").trim(),
        gstRegNo: (editClientForm.gstRegNo || "").trim(),
        status: editClientForm.status,
      });
      await refreshAll();
      setClientDetail(updated);
      setClientDetailMode("view");
      setEditClientForm(null);
    } catch (err) {
      if (!handleAuthError(err)) setEditClientError(err.message || "Failed to save changes");
    } finally {
      setEditClientBusy(false);
    }
  }

  function logDocumentForClient(client) {
    closeClientDetail();
    setSelectedClient(client);
    setForm({ clientId: client.id, category: "secretarial", serviceDetail: "", bookkeepingSubtype: "", bookkeepingPeriod: "", location: "", dateReceived: "", loggedBy: user.username, isAgmFiling: false, isBatch: false, batchCount: "", checkedItems: [] });
    setAttachFile(null);
    setLocationOtherMode(false);
    setEntryStep("document");
    setShowForm(true);
  }

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const matchesQuery =
        query.trim() === "" ||
        (e.client || "").toLowerCase().includes(query.toLowerCase()) ||
        e.code.toLowerCase().includes(query.toLowerCase());
      const matchesCat = catFilter === "all" || e.category === catFilter;
      return matchesQuery && matchesCat;
    });
  }, [entries, query, catFilter]);
  const regPaging = usePaging(filtered, 25, `${query}|${catFilter}`);

  const stats = useMemo(() => {
    const total = entries.length;
    const critical = entries.filter((e) => e.category === "personal").length;
    const high = entries.filter((e) => e.category !== "personal").length;
    const checkedOut = entries.filter((e) => e.status === "Checked out").length;
    return { total, critical, high, checkedOut };
  }, [entries]);

  async function submitForm(ev) {
    ev.preventDefault();
    // Each of these used to just silently `return` with zero feedback —
    // on a form this long, a missed required field (easy to do: Storage
    // location defaults to a disabled, unselected placeholder) meant
    // clicking Submit appeared to do nothing at all, indistinguishable
    // from a genuine freeze. Say exactly what's missing instead.
    const missing = [];
    if (!form.clientId) missing.push("Client");
    if (!form.location.trim()) missing.push("Storage location");
    if (!form.dateReceived) missing.push("Date received");
    if (!form.loggedBy.trim()) missing.push("Logged by");
    if (form.isBatch && form.checkedItems.length === 0) missing.push("At least one checklist item");
    if (!form.isBatch && form.category === "bookkeeping" && !form.bookkeepingSubtype) missing.push("Document type");
    if (missing.length > 0) {
      setErrorMsg(`Please fill in: ${missing.join(", ")}`);
      return;
    }
    setErrorMsg("");
    setFormBusy(true);
    try {
      const clientName = selectedClient?.company || clients.find((c) => c.id === Number(form.clientId))?.company || "";
      let created;

      if (form.isBatch) {
        // One ticked checklist item -> one document row, all sharing the
        // same box/location/date — see BATCH_CHECKLIST above.
        const items = form.checkedItems.map((key) => {
          const opt = BATCH_CHECKLIST.find((o) => o.key === key);
          return { category: opt.category, serviceDetail: opt.serviceDetail || null };
        });
        const rows = await createBatchIntake({
          clientId: Number(form.clientId),
          location: form.location.trim(),
          dateReceived: form.dateReceived,
          loggedBy: form.loggedBy.trim(),
          batchCount: form.batchCount ? Number(form.batchCount) : null,
          items,
          isAgmFiling: form.checkedItems.includes("secretarial") && form.isAgmFiling,
        });
        created = rows[0]; // one physical box gets one label, printed from the first entry
      } else {
        let serviceDetail = form.serviceDetail.trim();
        if (form.category === "bookkeeping") {
          const parts = [form.bookkeepingSubtype];
          if (form.bookkeepingPeriod) parts.push(monthLabel(form.bookkeepingPeriod));
          const composed = parts.join(" — ");
          serviceDetail = serviceDetail ? `${composed} (${serviceDetail})` : composed;
        }
        created = await createDocument({
          clientId: Number(form.clientId),
          category: form.category,
          serviceDetail,
          location: form.location.trim(),
          dateReceived: form.dateReceived,
          loggedBy: form.loggedBy.trim(),
          isAgmFiling: form.category === "secretarial" && form.isAgmFiling,
          isBatch: false,
          batchCount: null,
        });
        if (attachFile) {
          try {
            await uploadDocumentFile(created.id, attachFile);
          } catch (err) {
            setErrorMsg(`Document saved, but the attached file failed to upload: ${err.message || "unknown error"}`);
          }
        }
      }

      await refreshAll();
      closeEntryForm();
      setLabelPrompt({ ...created, client: created.client || clientName });
    } catch (err) {
      if (!handleAuthError(err)) setErrorMsg(err.message || "Failed to create entry");
    } finally {
      setFormBusy(false);
    }
  }

  async function toggleCheckout(entry) {
    try {
      await apiToggleCheckout(entry.id);
      await refreshAll();
      if (scanResult && scanResult.id === entry.id) {
        const refreshed = await lookupDocument(entry.code);
        setScanResult(refreshed);
      }
    } catch (err) {
      if (!handleAuthError(err)) setErrorMsg(err.message || "Failed to update checkout status");
    }
  }

  async function saveReportField(clientId, patch) {
    try {
      const updated = await updateClientReportFields(clientId, patch);
      setClients((prev) => prev.map((c) => (c.id === clientId ? updated : c)));
    } catch (err) {
      if (!handleAuthError(err)) setErrorMsg(err.message || "Failed to save");
    }
  }

  async function sendToPrinter(kind) {
    setPrintBusy(true);
    setPrintStatus(null);
    try {
      if (kind === "document") await printDocumentLabel(printPreview.id);
      else await printClientFolderLabel(clientLabelPreview.id);
      setPrintStatus({ ok: true, message: "Sent to printer." });
    } catch (err) {
      if (!handleAuthError(err)) setPrintStatus({ ok: false, message: err.message || "Printing failed." });
    } finally {
      setPrintBusy(false);
    }
  }

  if (loading) {
    return (
      <div style={{ fontFamily: "'Inter', system-ui, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6656", position: "relative" }}>
        <Wallpaper />
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <Spinner size={42} color={BRAND_GREEN_DEEP} thickness={3.4} />
          <span style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: 0.3 }}>Loading your register…</span>
        </div>
      </div>
    );
  }

  // Filings (CPF, GST) that are overdue or due within 5 days — shown as a live badge on the Dashboard tab.
  const urgentFilings = countUrgent(clients, schedules);

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", minHeight: "100vh", color: "#1C2430", position: "relative" }}>
      <TopBar active={refreshing} />
      <Wallpaper />
      {/* Header — clean light nav bar: wordmark left, flat nav links center, actions right */}
      <div style={{ ...glassPanel(0.6, 20), position: "sticky", top: 0, zIndex: 10, color: "#1C2430", padding: "14px 28px", display: "flex", alignItems: "center", gap: 28, borderTop: "none", borderLeft: "none", borderRight: "none", boxShadow: "0 2px 16px rgba(28,36,48,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <img
            src={LOGO_URL}
            alt=""
            style={{ width: 30, height: 30, objectFit: "contain" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
          <div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 700, letterSpacing: 0.2, color: "#1C2430", lineHeight: 1.1 }}>JARDEEN MANAGEMENT</div>
            <div style={{ fontSize: 10, color: "#8A8577", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.6 }}>Financial Asset Register</div>
          </div>
        </div>

        <nav style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
          {[
            { key: "dashboard", label: "Dashboard" },
            { key: "clients", label: "Clients" },
            { key: "onboarding", label: "Onboarding" },
            { key: "register", label: "Register" },
            { key: "report", label: "Report" },
            { key: "scan", label: "Scan lookup" },
            { key: "log", label: "Access log" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "8px 14px",
                background: "none",
                border: "none",
                borderBottom: tab === t.key ? `2px solid ${BRAND_GREEN_BRIGHT}` : "2px solid transparent",
                color: tab === t.key ? BRAND_GREEN_DEEP : "#4A4638",
                fontWeight: 600,
                fontSize: 12.5,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {t.key === "dashboard" && <LayoutGrid size={13} />}
              {t.key === "scan" && <ScanLine size={13} />}
              {t.label}
              {t.key === "dashboard" && urgentFilings > 0 && (
                <span title={`${urgentFilings} CPF / GST filings overdue or due within 5 days`} style={{ background: "#A63D40", color: "#fff", fontSize: 10, fontWeight: 800, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", animation: "fams-pulse 1.8s infinite" }}>
                  {urgentFilings}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <LiveClock />
          <button
            onClick={openEntryForm}
            style={{ display: "flex", alignItems: "center", gap: 6, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 16px", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
          >
            <Plus size={16} /> New entry
          </button>
          <UserMenu user={user} onLogout={onLogout} />
        </div>
      </div>

      {errorMsg && (
        <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "10px 28px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertCircle size={14} /> {errorMsg}
        </div>
      )}

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 28px", position: "relative", zIndex: 1 }}>
        {tab === "dashboard" && (
          <DashboardOverview clients={clients} entries={entries} log={log} schedules={schedules} docCountFor={docCountFor} onOpenClient={openClientDetail} onRefresh={refreshAll} />
        )}

        {tab === "clients" && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, ...glassPanel(0.55, 10), padding: "8px 12px", flex: 1 }}>
                <Search size={15} color="#8A8577" />
                <input
                  value={clientQuery}
                  onChange={(e) => setClientQuery(e.target.value)}
                  placeholder="Search by company, file no, or ROC"
                  style={{ border: "none", outline: "none", background: "none", fontSize: 13, flex: 1, color: "#1C2430" }}
                />
              </div>
              <select
                value={clientStatusFilter}
                onChange={(e) => setClientStatusFilter(e.target.value)}
                style={{ ...glassPanel(0.55, 10), padding: "8px 12px", fontSize: 13, color: "#1C2430" }}
              >
                <option value="all">All statuses</option>
                {Object.entries(CLIENT_STATUS).map(([key, s]) => (
                  <option key={key} value={key}>{s.label}</option>
                ))}
              </select>
              <button
                onClick={() => setShowBulkImport(true)}
                style={{ display: "flex", alignItems: "center", gap: 6, ...glassPanel(0.55, 10), padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#1C2430", cursor: "pointer" }}
              >
                <Upload size={14} /> Import clients
              </button>
            </div>

            <div style={{ fontSize: 11, color: "#6B6656", marginBottom: 10 }}>
              {filteredClients.length} client{filteredClients.length === 1 ? "" : "s"}
              {clientTotalPages > 1 && ` · page ${clientPage} of ${clientTotalPages}`}
            </div>

            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              {/* A-Z jump sidebar */}
              <div
                style={{
                  ...glassPanel(0.5, 10),
                  position: "sticky",
                  top: 84,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 1,
                  padding: "10px 5px",
                  flexShrink: 0,
                }}
              >
                {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => {
                  const has = availableLetters.has(letter);
                  return (
                    <button
                      key={letter}
                      disabled={!has}
                      onClick={() => jumpToLetter(letter)}
                      title={has ? `Jump to ${letter}` : undefined}
                      style={{
                        width: 22,
                        height: 16,
                        border: "none",
                        background: "none",
                        cursor: has ? "pointer" : "default",
                        color: !has ? "#D3CFC1" : activeLetter === letter ? BRAND_GREEN_BRIGHT : "#6B6656",
                        fontWeight: activeLetter === letter ? 700 : 600,
                        fontSize: 10,
                        letterSpacing: 0.3,
                        transition: "color 120ms ease, transform 120ms ease",
                      }}
                      onMouseEnter={(e) => { if (has) e.currentTarget.style.transform = "scale(1.25)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                    >
                      {letter}
                    </button>
                  );
                })}
              </div>

              {/* Tile grid */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {filteredClients.length === 0 && (
                  <div style={{ ...glassPanel(0.55, 10), padding: 32, textAlign: "center", color: "#8A8577" }}>No matching clients.</div>
                )}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(268px, 1fr))",
                    gap: 12,
                  }}
                >
                  {pagedClients.map((c) => {
                    const s = CLIENT_STATUS[c.status];
                    const docCount = docCountFor(c.company);
                    const hovered = hoveredClientId === c.id;
                    const verified = isVerifiedProfile(c);
                    const services = recurringServicesFor(c.id, entries);
                    const ar = computeArDeadline(c.yearEnd, c.lastAgmDate);
                    return (
                      <div
                        key={c.id}
                        ref={(el) => { if (el) clientTileRefs.current[c.id] = el; }}
                        onClick={() => openClientDetail(c)}
                        onMouseEnter={() => setHoveredClientId(c.id)}
                        onMouseLeave={() => setHoveredClientId((h) => (h === c.id ? null : h))}
                        style={{
                          ...glassPanel(hovered ? 0.78 : 0.55, 12),
                          padding: "14px 16px",
                          cursor: "pointer",
                          scrollMarginTop: 90,
                          transform: hovered ? "translateY(-3px)" : "translateY(0)",
                          boxShadow: hovered ? "0 14px 32px rgba(47,168,102,0.22)" : "0 4px 14px rgba(28,36,48,0.06)",
                          borderColor: hovered ? "rgba(47,168,102,0.6)" : "rgba(201,196,182,0.55)",
                          transition: "transform 160ms ease, box-shadow 160ms ease, background 160ms ease, border-color 160ms ease",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                            {verified && <CheckCircle2 size={13} color={BRAND_GREEN_BRIGHT} style={{ flexShrink: 0 }} title="Verified — core profile fields on file" />}
                            <div style={{ fontWeight: 700, fontSize: 13.5, color: "#1C2430", lineHeight: 1.3 }}>{c.company}</div>
                          </div>
                          <span style={{ flexShrink: 0, background: s.chip, color: s.text, padding: "3px 7px", fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" }}>{s.label}</span>
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8A8577" }}>{c.fileNo}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6B6656", marginTop: 2 }}>
                          <span>FYE {c.yearEnd || "—"}</span>
                          {ar && (
                            <span
                              title={`Annual Return due ${formatDisplayDate(ar.deadline)}`}
                              style={{ color: ar.overdue ? "#A63D40" : ar.daysLeft <= 30 ? "#B4791F" : "#6B6656", fontWeight: ar.daysLeft <= 30 ? 600 : 400 }}
                            >
                              AR {ar.overdue ? "overdue" : "due"} {formatDisplayDate(ar.deadline)}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#6B6656" }}>
                          Annual revenue:{" "}
                          <strong style={{ color: c.annualRevenue != null ? "#1C2430" : "#8A8577" }}>
                            {c.annualRevenue != null ? `S$${c.annualRevenue.toLocaleString()}` : "Not set"}
                          </strong>
                        </div>
                        {services.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                            {services.map((cat) => {
                              const cs = CAT_STYLE[cat.key];
                              return (
                                <span key={cat.key} style={{ background: cs.chip, color: cs.text, padding: "2px 6px", fontSize: 9.5, fontWeight: 600 }}>
                                  {cat.label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, paddingTop: 8, borderTop: "1px solid rgba(201,196,182,0.4)" }}>
                          <span style={{ fontSize: 11, color: "#8A8577" }}>{docCount} doc{docCount === 1 ? "" : "s"}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              viewClientDocs(c.company);
                            }}
                            style={{ display: "flex", alignItems: "center", gap: 3, border: "none", background: "none", cursor: "pointer", color: BRAND_GREEN, fontSize: 11.5, fontWeight: 600 }}
                          >
                            View docs <ArrowRight size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination — page count follows the client list, growing/shrinking as clients are added or removed */}
                {clientTotalPages > 1 && (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 20 }}>
                    <button
                      onClick={() => setClientPage((p) => Math.max(1, p - 1))}
                      disabled={clientPage === 1}
                      style={{ ...glassPanel(0.5, 8), width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: clientPage === 1 ? "default" : "pointer", opacity: clientPage === 1 ? 0.4 : 1 }}
                    >
                      <ArrowLeft size={13} />
                    </button>
                    {Array.from({ length: clientTotalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === clientTotalPages || Math.abs(p - clientPage) <= 1)
                      .reduce((acc, p, i, arr) => {
                        if (i > 0 && p - arr[i - 1] > 1) acc.push("…" + p);
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((p) =>
                        typeof p === "string" ? (
                          <span key={p} style={{ color: "#8A8577", fontSize: 12, padding: "0 2px" }}>···</span>
                        ) : (
                          <button
                            key={p}
                            onClick={() => setClientPage(p)}
                            style={{
                              ...(p === clientPage
                                ? { background: BRAND_GREEN_BRIGHT, border: `1px solid ${BRAND_GREEN_BRIGHT}`, boxShadow: "0 4px 14px rgba(47,168,102,0.35)" }
                                : glassPanel(0.5, 8)),
                              width: 30,
                              height: 30,
                              fontSize: 12,
                              fontWeight: p === clientPage ? 700 : 600,
                              color: p === clientPage ? "#FFFFFF" : "#1C2430",
                              cursor: "pointer",
                            }}
                          >
                            {p}
                          </button>
                        )
                      )}
                    <button
                      onClick={() => setClientPage((p) => Math.min(clientTotalPages, p + 1))}
                      disabled={clientPage === clientTotalPages}
                      style={{ ...glassPanel(0.5, 8), width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: clientPage === clientTotalPages ? "default" : "pointer", opacity: clientPage === clientTotalPages ? 0.4 : 1 }}
                    >
                      <ArrowRight size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {tab === "onboarding" && <OnboardingHub clients={clients} user={user} onChanged={refreshAll} />}

        {tab === "register" && (
          <>
            <div style={{ fontSize: 12, color: "#8A8577", marginBottom: 12 }}>
              Every document ever logged, across every client — the master ledger. Look here to find one specific entry by
              code or client; for a client's own documents, open them from the Clients tab instead.
            </div>
            {/* Search + filter */}
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, ...glassPanel(0.55, 10), padding: "8px 12px", flex: 1 }}>
                <Search size={15} color="#8A8577" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by client or code"
                  style={{ border: "none", outline: "none", background: "none", fontSize: 13, flex: 1, color: "#1C2430" }}
                />
              </div>
              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                style={{ ...glassPanel(0.55, 10), padding: "8px 12px", fontSize: 13, color: "#1C2430" }}
              >
                <option value="all">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>

            {/* Table */}
            <div style={{ ...glassPanel(0.55, 10) }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #C9C4B6" }}>
                    {["Code", "Client", "Category", "Location", "Received", "Status", ""].map((h) => (
                      <th key={h} style={{ padding: "10px 14px", color: "#6B6656", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#8A8577" }}>No matching records.</td>
                    </tr>
                  )}
                  {regPaging.pageItems.map((e) => {
                    const s = CAT_STYLE[e.category];
                    const cat = CATEGORIES.find((c) => c.key === e.category);
                    return (
                      <tr key={e.id} style={{ borderBottom: "1px solid #E5E1D5" }}>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12 }}>{e.code}</td>
                        <td style={{ padding: "10px 14px" }}>{e.client}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ background: s.chip, color: s.text, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}>{cat.label}</span>
                          {e.isBatch && (
                            <span
                              title={e.batchCount ? `Approx. ${e.batchCount} documents, not yet sorted` : "Not yet sorted"}
                              style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#E5E1D5", color: "#4A4638", padding: "3px 8px", fontSize: 11, fontWeight: 600, marginLeft: 6 }}
                            >
                              <Package size={11} /> Box{e.batchCount ? ` · ~${e.batchCount}` : ""}
                            </span>
                          )}
                          {e.serviceDetail && <div style={{ fontSize: 11, color: "#8A8577", marginTop: 3 }}>{e.serviceDetail}</div>}
                          <div style={{ marginTop: 5 }}>
                            <DocumentAttachments documentId={e.id} />
                          </div>
                        </td>
                        <td style={{ padding: "10px 14px", color: "#4A4638" }}>{e.location}</td>
                        <td style={{ padding: "10px 14px", color: "#4A4638" }}>{e.dateReceived}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ color: e.status === "Checked out" ? "#A63D40" : "#2F6F62", fontWeight: 600 }}>{e.status}</span>
                        </td>
                        <td style={{ padding: "10px 14px", display: "flex", gap: 8 }}>
                          <button onClick={() => setPrintPreview(e)} title="Print label" style={{ border: "none", background: "none", cursor: "pointer", color: "#6B6656" }}>
                            <Printer size={15} />
                          </button>
                          <button onClick={() => toggleCheckout(e)} title={e.status === "Filed" ? "Check out" : "Check in"} style={{ border: "none", background: "none", cursor: "pointer", color: "#6B6656" }}>
                            {e.status === "Filed" ? <LogOut size={15} /> : <LogIn size={15} />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={regPaging.page} pageCount={regPaging.pageCount} onPage={regPaging.setPage} total={filtered.length} pageSize={25} />
          </>
        )}

        {tab === "report" && (
          <ReportTab clients={clients} entries={entries} onSaveField={saveReportField} onOpenClient={openClientDetail} onRefresh={refreshAll} />
        )}

        {tab === "scan" && (
          <div>
            <div style={{ fontSize: 12, color: "#6B6656", marginBottom: 10 }}>
              Scan the label's QR code, or type the ID printed on it — a document/box label's ID (e.g.{" "}
              <span style={{ fontFamily: "monospace" }}>JDM2609BK2</span>) or a client folder label's file no. (e.g.{" "}
              <span style={{ fontFamily: "monospace" }}>A1</span>). Either resolves to the live record, not a frozen snapshot
              from print time.
            </div>
            <form onSubmit={handleScanSubmit} style={{ display: "flex", gap: 10, marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FBFAF6", border: "1px solid #C9C4B6", padding: "10px 14px", flex: 1 }}>
                <ScanLine size={16} color={BRAND_GREEN} />
                <input
                  autoFocus
                  value={scanValue}
                  onChange={handleScanChange}
                  placeholder="JDM2609BK2"
                  style={{ border: "none", outline: "none", background: "none", fontSize: 14, fontFamily: "monospace", flex: 1, color: "#1C2430" }}
                />
              </div>
              <button type="submit" style={{ background: "#1C2430", color: "#EDEAE2", border: "none", padding: "0 18px", fontWeight: 600, cursor: "pointer" }}>
                Look up
              </button>
            </form>

            {scanStatus === "idle" && (
              <div style={{ color: "#8A8577", fontSize: 13, padding: "20px 0" }}>Waiting for a scan or an ID.</div>
            )}

            {scanStatus === "not_found" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F5E1E1", color: "#7A2C2E", padding: "12px 16px", fontSize: 13, fontWeight: 600 }}>
                <AlertCircle size={16} /> No record matches that ID. Check the code and try again.
              </div>
            )}

            {scanStatus === "found" && scanResult && (
              <div style={{ background: "#FBFAF6", border: "1px solid #C9C4B6" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, padding: "10px 16px", fontSize: 13, fontWeight: 600 }}>
                  <CheckCircle2 size={16} /> {scanResult.resultType === "client" ? "Client folder found" : "Document found"}
                </div>
                {scanResult.resultType === "client" ? (
                  <div style={{ padding: "18px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <DetailRow label="Client" value={scanResult.client} />
                    <DetailRow label="File no." value={scanResult.clientFileNo} mono />
                    <DetailRow label="Status" value={CLIENT_STATUS[scanResult.clientStatus]?.label || scanResult.clientStatus} />
                  </div>
                ) : (
                  <div style={{ padding: "18px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <DetailRow label="Client" value={scanResult.client} />
                    <DetailRow label="Category" value={CATEGORIES.find((c) => c.key === scanResult.category).label} />
                    {scanResult.serviceDetail && <DetailRow label="Service detail" value={scanResult.serviceDetail} />}
                    <DetailRow label="Unique ID" value={scanResult.code} mono />
                    <DetailRow label="Sensitivity" value={CATEGORIES.find((c) => c.key === scanResult.category).sensitivity} />
                    <DetailRow label="Storage location" value={scanResult.location} />
                    <DetailRow label="Date received" value={scanResult.dateReceived} />
                    <DetailRow label="Logged by" value={scanResult.loggedBy} />
                    <DetailRow label="Status" value={scanResult.status} accent={scanResult.status === "Checked out" ? "#A63D40" : "#2F6F62"} />
                  </div>
                )}

                <div style={{ borderTop: "1px solid #E5E1D5", padding: "16px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
                    <Building2 size={13} /> Company snapshot
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                    {scanRevealed ? (
                      <DetailRow label="ROC" value={scanResult.clientRoc || "—"} mono />
                    ) : (
                      <div>
                        <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>ROC</div>
                        <button
                          onClick={() => setRevealTarget("scan")}
                          style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: "none", cursor: "pointer", color: BRAND_GREEN, fontSize: 13, fontWeight: 600, padding: 0 }}
                        >
                          <Info size={12} /> •••• — View
                        </button>
                      </div>
                    )}
                    <DetailRow
                      label="Last AGM filed"
                      value={scanResult.clientLastAgmDate || "Not on record yet"}
                      accent={scanResult.clientLastAgmDate ? undefined : "#B4791F"}
                    />
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Registered address</div>
                    <div style={{ fontSize: 13, color: "#1C2430" }}>{scanResult.clientRegisteredAddress || "Not on record"}</div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Fax</div>
                    <div style={{ fontSize: 13, color: "#1C2430" }}>{scanResult.clientFax || "Not on record"}</div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Directors</div>
                    {scanResult.clientDirectors ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#1C2430" }}>
                        {scanResult.clientDirectors
                          .split("\n")
                          .map((name) => name.trim())
                          .filter(Boolean)
                          .map((name, i) => (
                            <li key={i}>{name}</li>
                          ))}
                      </ul>
                    ) : (
                      <div style={{ fontSize: 13, color: "#8A8577" }}>Not on record</div>
                    )}
                  </div>

                  {scanRevealed ? (
                    <PersonInChargeBox name={scanResult.clientContactName} phone={scanResult.clientContactPhone} email={scanResult.clientContactEmail} />
                  ) : (
                    <button
                      onClick={() => setRevealTarget("scan")}
                      style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", border: "none", background: HIGHLIGHT_BG, padding: "10px 14px", cursor: "pointer", fontSize: 12, color: HIGHLIGHT_TEXT, fontWeight: 600 }}
                    >
                      <Info size={13} /> Person in charge — contact details hidden. View?
                    </button>
                  )}

                  {(() => {
                    const historyClientId = scanResult.resultType === "client" ? scanResult.id : scanResult.clientId;
                    const history = entries.filter((e) => e.clientId === historyClientId).slice(0, 8);
                    return (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                          <FileText size={13} /> Full history for this client ({history.length})
                        </div>
                        {history.length === 0 ? (
                          <div style={{ fontSize: 12.5, color: "#8A8577" }}>No documents logged yet.</div>
                        ) : (
                          <div style={{ background: "#fff", border: "1px solid #C9C4B6" }}>
                            {history.map((d) => (
                              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", borderBottom: "1px solid #E5E1D5", fontSize: 12 }}>
                                <span style={{ fontFamily: "monospace" }}>{d.code}</span>
                                <span style={{ color: "#4A4638" }}>{CATEGORIES.find((c) => c.key === d.category)?.label}{d.serviceDetail ? ` — ${d.serviceDetail}` : ""}</span>
                                <span style={{ color: d.status === "Checked out" ? "#A63D40" : "#2F6F62", fontWeight: 600 }}>{d.status}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div style={{ display: "flex", gap: 10, padding: "0 20px 18px" }}>
                  {scanResult.resultType === "client" ? (
                    <button
                      onClick={() => setClientLabelPreview({ id: scanResult.id, company: scanResult.client, roc: scanResult.clientRoc, fileNo: scanResult.clientFileNo })}
                      style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #C9C4B6", background: "#fff", padding: "8px 14px", fontSize: 13, cursor: "pointer" }}
                    >
                      <Printer size={14} /> Reprint folder label
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => toggleCheckout(scanResult)}
                        style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #C9C4B6", background: "#fff", padding: "8px 14px", fontSize: 13, cursor: "pointer" }}
                      >
                        {scanResult.status === "Filed" ? <LogOut size={14} /> : <LogIn size={14} />}
                        {scanResult.status === "Filed" ? "Check out" : "Check in"}
                      </button>
                      <button
                        onClick={() => setPrintPreview(scanResult)}
                        style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #C9C4B6", background: "#fff", padding: "8px 14px", fontSize: 13, cursor: "pointer" }}
                      >
                        <Printer size={14} /> Reprint label
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {scanHistory.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div style={{ fontSize: 11, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Recent lookups</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {scanHistory.map((h, i) => (
                    <span key={i} style={{ fontFamily: "monospace", fontSize: 11, background: "#E5E1D5", padding: "4px 8px" }}>
                      {h.code} · {h.time}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "log" && (
          <>
            <div style={{ fontSize: 12, color: "#8A8577", marginBottom: 12 }}>
              A record of every time a physical document was checked out or back in — proof of who took what and when, for
              when a client or auditor asks "where is this paper right now."
            </div>
            <div style={{ ...glassPanel(0.55, 10) }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #C9C4B6" }}>
                  {["Time", "Code", "Client", "Action", "Staff"].map((h) => (
                    <th key={h} style={{ padding: "10px 14px", color: "#6B6656", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#8A8577" }}>No activity logged yet.</td></tr>
                )}
                {log.map((l) => (
                  <tr key={l.id} style={{ borderBottom: "1px solid #E5E1D5" }}>
                    <td style={{ padding: "10px 14px", color: "#4A4638" }}>{l.time}</td>
                    <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12 }}>{l.code}</td>
                    <td style={{ padding: "10px 14px" }}>{l.client}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ color: l.action === "Checked out" ? "#A63D40" : "#2F6F62", fontWeight: 600 }}>{l.action}</span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#4A4638" }}>{l.user}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>

      {/* New entry / client onboarding wizard */}
      {showForm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(28,36,48,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div style={{ width: 480, maxWidth: "100%", maxHeight: "88vh", ...glassPanel(0.94, 22), padding: 26, overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid rgba(201,196,182,0.5)" }}>
              <div>
                <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 18, fontWeight: 700, color: "#1C2430" }}>
                  {entryStep === "new-client" ? "New client" : entryStep === "onboarded" ? "Client added" : "New register entry"}
                </div>
                <div style={{ fontSize: 12, color: "#8A8577", marginTop: 3 }}>
                  {entryStep === "search" && "Find the client this document belongs to."}
                  {entryStep === "new-client" && "This company isn't in the register yet — add their details below."}
                  {entryStep === "document" && selectedClient && `Client: ${selectedClient.company} (${selectedClient.fileNo})`}
                </div>
              </div>
              <button onClick={closeEntryForm} style={{ border: "none", background: "none", cursor: "pointer", flexShrink: 0, color: "#6B6656" }}><X size={18} /></button>
            </div>

            {entryStep === "search" && (
              <div>
                <Field label="Client">
                  <input
                    autoFocus
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    style={inputStyle}
                    placeholder="Type at least 2 letters of the company name or file no."
                  />
                </Field>

                {clientSearch.trim().length >= 2 && (
                  <div style={{ marginTop: 8, border: "1px solid #C9C4B6", background: "#fff", maxHeight: 220, overflowY: "auto" }}>
                    {clientMatches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectClient(c)}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: "none", borderBottom: "1px solid #E5E1D5", background: "none", cursor: "pointer", fontSize: 13 }}
                      >
                        <div style={{ fontWeight: 600, color: "#1C2430" }}>{c.company}</div>
                        <div style={{ fontSize: 11, color: "#8A8577", fontFamily: "monospace" }}>{c.fileNo}</div>
                      </button>
                    ))}
                    {clientMatches.length === 0 && (
                      <button
                        type="button"
                        onClick={handleStartNewClient}
                        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "10px 12px", border: "none", background: "#F6ECDA", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#7A5215" }}
                      >
                        <UserPlus size={14} /> Add "{clientSearch.trim()}" as a new client
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleStartNewClient}
                  style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, border: "none", background: "none", cursor: "pointer", color: BRAND_GREEN, fontSize: 12, fontWeight: 600, padding: 0 }}
                >
                  <UserPlus size={13} /> Can't find them? Add a new client instead
                </button>
              </div>
            )}

            {entryStep === "new-client" && (
              <form onSubmit={submitNewClient} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label="Company" required>
                  <input value={newClientForm.company} onChange={(e) => setNewClientForm({ ...newClientForm, company: e.target.value })} style={inputStyle} placeholder="Registered company name" />
                </Field>
                <Field label="ROC number" required>
                  <input value={newClientForm.roc} onChange={(e) => setNewClientForm({ ...newClientForm, roc: e.target.value })} style={inputStyle} />
                </Field>
                <Field
                  label="FYE"
                  required
                  hint="Financial Year End — the month a client's accounting year closes. Used to calculate ACRA/IRAS filing deadlines."
                >
                  <input value={newClientForm.yearEnd} onChange={(e) => setNewClientForm({ ...newClientForm, yearEnd: e.target.value })} style={inputStyle} placeholder="e.g. DEC" />
                </Field>
                <Field label="Date incorporated" required>
                  <input type="date" value={newClientForm.dateInc} onChange={(e) => setNewClientForm({ ...newClientForm, dateInc: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Registered address" required>
                  <textarea
                    value={newClientForm.registeredAddress}
                    onChange={(e) => setNewClientForm({ ...newClientForm, registeredAddress: e.target.value })}
                    style={{ ...inputStyle, minHeight: 56, resize: "vertical", fontFamily: "inherit" }}
                    placeholder="As per ACRA / registered office"
                  />
                </Field>
                <Field label="Fax number (optional)">
                  <input value={newClientForm.fax} onChange={(e) => setNewClientForm({ ...newClientForm, fax: e.target.value })} style={inputStyle} placeholder="e.g. +65 6123 4567" />
                </Field>
                <Field label="Directors" required>
                  <DirectorsInput value={newClientForm.directors} onChange={(val) => setNewClientForm({ ...newClientForm, directors: val })} />
                </Field>

                <div style={{ display: "inline-flex", alignItems: "center", borderTop: "1px solid #E5E1D5", paddingTop: 12, marginTop: 2, fontSize: 12, fontWeight: 700, color: "#1C2430" }}>
                  Person in charge
                  <InfoHint text="Staff can't call every director — this is the one number to actually reach for this client." />
                </div>
                <Field label="Name" required>
                  <input value={newClientForm.contact} onChange={(e) => setNewClientForm({ ...newClientForm, contact: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Phone" required>
                  <input value={newClientForm.contactPhone} onChange={(e) => setNewClientForm({ ...newClientForm, contactPhone: e.target.value })} style={inputStyle} placeholder="e.g. +65 9123 4567" />
                </Field>
                <Field label="Email (optional)">
                  <input type="email" value={newClientForm.contactEmail} onChange={(e) => setNewClientForm({ ...newClientForm, contactEmail: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Status">
                  <select value={newClientForm.status} onChange={(e) => setNewClientForm({ ...newClientForm, status: e.target.value })} style={inputStyle}>
                    {Object.entries(CLIENT_STATUS).map(([key, s]) => (
                      <option key={key} value={key}>{s.label}</option>
                    ))}
                  </select>
                </Field>

                {newClientError && (
                  <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>{newClientError}</div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => setEntryStep("search")}
                    style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #C9C4B6", background: "none", padding: "10px 14px", fontSize: 13, cursor: "pointer" }}
                  >
                    <ArrowLeft size={14} /> Back
                  </button>
                  <button
                    type="submit"
                    disabled={newClientBusy}
                    style={{ flex: 1, background: "#1C2430", color: "#EDEAE2", border: "none", padding: "10px 16px", fontWeight: 600, cursor: newClientBusy ? "default" : "pointer", opacity: newClientBusy ? 0.7 : 1 }}
                  >
                    {newClientBusy ? "Saving…" : "Save client"}
                  </button>
                </div>
              </form>
            )}

            {entryStep === "onboarded" && onboardedClient && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, padding: "12px 16px", fontSize: 13, fontWeight: 600, marginBottom: 18 }}>
                  <CheckCircle2 size={16} /> {onboardedClient.company} added as file no. {onboardedClient.fileNo}.
                </div>

                {!showPostOnboardActions && (
                  <div style={{ fontSize: 12, color: "#8A8577" }}>One moment…</div>
                )}

                {showPostOnboardActions && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#4A4638", marginBottom: 2 }}>What would you like to do next?</div>
                    <button
                      onClick={proceedToLogDocument}
                      style={{ display: "flex", alignItems: "center", gap: 8, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "10px 14px", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
                    >
                      <FileText size={15} /> Log a document now
                    </button>
                    <button
                      onClick={proceedToPrintFolderLabel}
                      style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", color: "#1C2430", border: "1px solid #C9C4B6", padding: "10px 14px", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
                    >
                      <Printer size={15} /> Print folder label
                    </button>
                    <button
                      onClick={closeEntryForm}
                      style={{ background: "none", color: "#6B6656", border: "none", padding: "8px 14px", cursor: "pointer", fontSize: 12 }}
                    >
                      Done for now
                    </button>
                  </div>
                )}
              </div>
            )}

            {entryStep === "document" && (
              <form onSubmit={submitForm} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <button
                  type="button"
                  onClick={backToClientSearch}
                  style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", border: "none", background: "none", cursor: "pointer", color: BRAND_GREEN, fontSize: 12, fontWeight: 600, padding: 0 }}
                >
                  <ArrowLeft size={13} /> Change client
                </button>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    ...glassPanel(0.6, 8),
                    padding: "10px 12px",
                    fontSize: 12,
                    color: "#4A4638",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.isBatch}
                    onChange={(e) => setForm({ ...form, isBatch: e.target.checked, checkedItems: [] })}
                  />
                  <span style={{ display: "inline-flex", alignItems: "center" }}>
                    <strong>This is a box/bag intake</strong>
                    <InfoHint text="A client dropped off several documents at once — tick every type that's actually in the box below, and each becomes its own tracked entry sharing one label." />
                  </span>
                </label>

                {form.isBatch ? (
                  <>
                    <Field label="What's in the box?" hint="Tick every type present — each becomes its own entry, sharing this box's location and date.">
                      <div style={{ ...glassPanel(0.5, 8), padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                        {BATCH_CHECKLIST.filter((o) => !o.key.startsWith("bk:")).map((opt) => (
                          <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#1C2430", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={form.checkedItems.includes(opt.key)}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  checkedItems: e.target.checked ? [...form.checkedItems, opt.key] : form.checkedItems.filter((k) => k !== opt.key),
                                })
                              }
                            />
                            {opt.label}
                          </label>
                        ))}
                        <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6, marginBottom: 2 }}>
                          Bookkeeping
                        </div>
                        {BATCH_CHECKLIST.filter((o) => o.key.startsWith("bk:")).map((opt) => (
                          <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#1C2430", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={form.checkedItems.includes(opt.key)}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  checkedItems: e.target.checked ? [...form.checkedItems, opt.key] : form.checkedItems.filter((k) => k !== opt.key),
                                })
                              }
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </Field>
                    {form.checkedItems.includes("secretarial") && (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, background: "#F6ECDA", padding: "10px 12px", fontSize: 12, color: "#4A4638", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={form.isAgmFiling}
                          onChange={(e) => setForm({ ...form, isAgmFiling: e.target.checked })}
                        />
                        <span style={{ display: "inline-flex", alignItems: "center" }}>
                          This box includes the AGM / Annual Return filing
                          <InfoHint text="Checking this updates the client's Last AGM Filed date to the date received below." />
                        </span>
                      </label>
                    )}
                    <Field label="Approximate number of documents">
                      <input
                        type="number"
                        min="1"
                        value={form.batchCount}
                        onChange={(e) => setForm({ ...form, batchCount: e.target.value })}
                        style={inputStyle}
                        placeholder="e.g. 40"
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Category" hint={CATEGORIES.find((c) => c.key === form.category).note}>
                      <select
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value, isAgmFiling: e.target.value === "secretarial" && form.isAgmFiling })}
                        style={inputStyle}
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c.key} value={c.key}>{c.label} — {c.sensitivity}</option>
                        ))}
                      </select>
                    </Field>
                    {form.category === "secretarial" && (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, background: "#F6ECDA", padding: "10px 12px", fontSize: 12, color: "#4A4638", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={form.isAgmFiling}
                          onChange={(e) => setForm({ ...form, isAgmFiling: e.target.checked })}
                        />
                        <span style={{ display: "inline-flex", alignItems: "center" }}>
                          This is the AGM / Annual Return filing
                          <InfoHint text="Checking this updates the client's Last AGM Filed date to the date received below." />
                        </span>
                      </label>
                    )}
                    {form.category === "bookkeeping" && (
                      <>
                        <Field label="Document type">
                          <select
                            value={form.bookkeepingSubtype}
                            onChange={(e) => setForm({ ...form, bookkeepingSubtype: e.target.value })}
                            style={inputStyle}
                          >
                            <option value="">Select…</option>
                            {BOOKKEEPING_SUBTYPES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </Field>
                        <Field
                          label="Period (optional)"
                          hint="For recurring items like statements or payroll — leave blank for one-off items like a KYC update."
                        >
                          <input
                            type="month"
                            value={form.bookkeepingPeriod}
                            onChange={(e) => setForm({ ...form, bookkeepingPeriod: e.target.value })}
                            style={inputStyle}
                          />
                        </Field>
                      </>
                    )}
                    <Field
                      label={form.category === "bookkeeping" ? "Notes (optional)" : "Service detail (optional)"}
                      hint="Use this to tell apart multiple filings in the same category — doesn't need to follow any order."
                    >
                      <input
                        value={form.serviceDetail}
                        onChange={(e) => setForm({ ...form, serviceDetail: e.target.value })}
                        style={inputStyle}
                        placeholder="e.g. GST Q2 2026, Annual Return 2025"
                      />
                    </Field>
                    {attachFile ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", ...glassPanel(0.6, 8), padding: "10px 12px", fontSize: 12, color: "#4A4638" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <Paperclip size={13} /> {attachFile.name}
                        </span>
                        <button type="button" onClick={() => setAttachFile(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#A63D40", flexShrink: 0 }}>
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <label
                        style={{
                          position: "relative",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          ...glassPanel(0.6, 8),
                          padding: "10px 12px",
                          fontSize: 12,
                          color: "#4A4638",
                          cursor: "pointer",
                        }}
                      >
                        <Upload size={13} />
                        Client also sent a soft copy — attach it now
                        <input
                          type="file"
                          onChange={(e) => setAttachFile(e.target.files?.[0] || null)}
                          style={{ position: "absolute", opacity: 0, width: "100%", height: "100%", inset: 0, cursor: "pointer" }}
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.heic"
                        />
                      </label>
                    )}
                  </>
                )}
                <Field label="Storage location">
                  {locationOtherMode ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        autoFocus
                        value={form.location}
                        onChange={(e) => setForm({ ...form, location: e.target.value })}
                        style={inputStyle}
                        placeholder="e.g. Cabinet A / Drawer 2"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setLocationOtherMode(false);
                          setForm({ ...form, location: "" });
                        }}
                        style={{ border: "1px solid #C9C4B6", background: "#fff", padding: "0 12px", cursor: "pointer", fontSize: 12, color: "#4A4638" }}
                      >
                        Shelves
                      </button>
                    </div>
                  ) : (
                    <select
                      value={form.location}
                      onChange={(e) => {
                        if (e.target.value === "__other__") {
                          setLocationOtherMode(true);
                          setForm({ ...form, location: "" });
                        } else {
                          setForm({ ...form, location: e.target.value });
                        }
                      }}
                      style={inputStyle}
                    >
                      <option value="" disabled>Select a shelf…</option>
                      {SHELF_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                      <option value="__other__">Other (specify)…</option>
                    </select>
                  )}
                </Field>
                <Field label="Date received">
                  <input type="date" value={form.dateReceived} onChange={(e) => setForm({ ...form, dateReceived: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Logged by">
                  <input value={form.loggedBy} onChange={(e) => setForm({ ...form, loggedBy: e.target.value })} style={inputStyle} placeholder="Staff name" />
                </Field>
                <button type="submit" disabled={formBusy} style={{ marginTop: 8, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "10px 16px", fontWeight: 600, cursor: formBusy ? "default" : "pointer", opacity: formBusy ? 0.7 : 1 }}>
                  {formBusy ? "Submitting…" : "Submit"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Onboarding forms (KYC, PEP) — customer fills in on screen, signs on screen or by hand, staff verify, PDF filed */}
      {showKyc && clientDetail && (
        <ClientOnboarding client={clientDetail} user={user} onClose={() => setShowKyc(false)} onChanged={refreshAll} />
      )}

      {/* Uploaded documents — pile of files with previews and an in-app viewer */}
      {showVault && clientDetail && (
        <ClientFiles
          client={clientDetail}
          documents={entries.filter((e) => e.clientId === clientDetail.id)}
          onClose={() => setShowVault(false)}
        />
      )}

      {/* GST / AGM filing helper — checklist, company details to copy, ZIP of files */}
      {showFiling && clientDetail && (
        <FilingHelper
          client={clientDetail}
          user={user}
          documents={entries.filter((e) => e.clientId === clientDetail.id)}
          ar={computeArDeadline(clientDetail.yearEnd, clientDetail.lastAgmDate)}
          revealed={clientDetailRevealed}
          onRequestReveal={() => setRevealTarget("client")}
          onClose={() => setShowFiling(false)}
          onChanged={refreshAll}
          renderAttachments={(documentId) => <DocumentAttachments documentId={documentId} />}
        />
      )}

      {/* Permission check before showing ROC / contact details, on a scan result or in the client detail view */}
      {revealTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(28,36,48,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div style={{ ...glassPanel(0.96, 22), width: 360, maxWidth: "100%", padding: 22, boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <ShieldAlert size={18} color="#A63D40" />
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 700 }}>Show sensitive details?</div>
            </div>
            <div style={{ fontSize: 13, color: "#4A4638", marginBottom: 18 }}>
              This reveals the client's ROC number and personal contact details (phone, email) on screen. Only continue if
              no one else can see this screen right now.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setRevealTarget(null)} style={{ border: "1px solid #C9C4B6", background: "#fff", padding: "8px 14px", fontSize: 13, cursor: "pointer", color: "#4A4638" }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  if (revealTarget === "scan") setScanRevealed(true);
                  if (revealTarget === "client") setClientDetailRevealed(true);
                  setRevealTarget(null);
                }}
                style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Generate label?" prompt — most entries don't need the physical
          file re-labeled, so printing is asked for instead of automatic. */}
      {labelPrompt && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            animation: "fams-slide-down 220ms ease-out",
          }}
        >
          <style>{"@keyframes fams-slide-down { from { transform: translate(-50%, -30px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }"}</style>
          <div
            style={{
              ...glassPanel(0.96, 22),
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "12px 16px",
              boxShadow: "0 12px 32px rgba(28,36,48,0.25)",
            }}
          >
            <Printer size={16} color={BRAND_GREEN} />
            <div style={{ fontSize: 13, color: "#1C2430" }}>
              Entry saved for <strong>{labelPrompt.client}</strong>. Generate a label now?
            </div>
            <button
              onClick={() => {
                setPrintPreview(labelPrompt);
                setLabelPrompt(null);
              }}
              style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              Generate label
            </button>
            <button
              onClick={() => setLabelPrompt(null)}
              style={{ border: "1px solid #C9C4B6", background: "#fff", padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#4A4638" }}
            >
              Skip
            </button>
            <button onClick={() => setLabelPrompt(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#8A8577", padding: 0 }}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Label preview modal */}
      {printPreview && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(28,36,48,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div style={{ background: "#FBFAF6", padding: 24, border: "1px solid #C9C4B6", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 700, marginBottom: 14 }}>
              {printPreview.isBatch ? "Box label preview" : "Label preview"}
            </div>
            {printPreview.isBatch ? <BoxLabel entry={printPreview} /> : <Label entry={printPreview} />}
            {printStatus && (
              <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: printStatus.ok ? "#1F4A40" : "#7A2C2E" }}>
                {printStatus.message}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setPrintPreview(null)} style={{ border: "1px solid #C9C4B6", background: "none", padding: "9px 14px", cursor: "pointer", fontSize: 13 }}>Close</button>
              <button
                onClick={() => sendToPrinter("document")}
                disabled={printBusy}
                style={{ display: "flex", alignItems: "center", gap: 6, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 14px", cursor: printBusy ? "default" : "pointer", fontSize: 13, fontWeight: 600, opacity: printBusy ? 0.7 : 1 }}
              >
                <Printer size={14} /> {printBusy ? "Sending…" : "Send to label printer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client folder label preview modal */}
      {clientLabelPreview && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(28,36,48,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div style={{ background: "#FBFAF6", padding: 24, border: "1px solid #C9C4B6", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Folder label preview</div>
            <ClientLabel client={clientLabelPreview} />
            {printStatus && (
              <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: printStatus.ok ? "#1F4A40" : "#7A2C2E" }}>
                {printStatus.message}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setClientLabelPreview(null)} style={{ border: "1px solid #C9C4B6", background: "none", padding: "9px 14px", cursor: "pointer", fontSize: 13 }}>Close</button>
              <button
                onClick={() => sendToPrinter("client")}
                disabled={printBusy}
                style={{ display: "flex", alignItems: "center", gap: 6, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 14px", cursor: printBusy ? "default" : "pointer", fontSize: 13, fontWeight: 600, opacity: printBusy ? 0.7 : 1 }}
              >
                <Printer size={14} /> {printBusy ? "Sending…" : "Send to label printer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk client import from Excel/CSV */}
      {showBulkImport && (
        <BulkImportClients
          onClose={() => setShowBulkImport(false)}
          onImported={async () => {
            await refreshAll();
          }}
          existingClients={clients}
        />
      )}

      {/* Client detail — one place for everything about a client, whether you're */}
      {/* browsing or on a call and need an answer right now */}
      {clientDetail && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(28,36,48,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div style={{ width: 560, maxWidth: "100%", maxHeight: "88vh", background: "#FBFAF6", padding: 24, overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
            {clientDetailMode === "view" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 19, fontWeight: 700 }}>{clientDetail.company}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: "#8A8577" }}>{clientDetail.fileNo}</span>
                      <span
                        style={{
                          background: CLIENT_STATUS[clientDetail.status].chip,
                          color: CLIENT_STATUS[clientDetail.status].text,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {CLIENT_STATUS[clientDetail.status].label}
                      </span>
                    </div>
                  </div>
                  <button onClick={closeClientDetail} style={{ border: "none", background: "none", cursor: "pointer", flexShrink: 0 }}>
                    <X size={18} />
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                  <button
                    onClick={() => logDocumentForClient(clientDetail)}
                    style={{ display: "flex", alignItems: "center", gap: 6, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                  >
                    <FileText size={14} /> Log a document
                  </button>
                  <button
                    onClick={() => setShowFiling(true)}
                    style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: BRAND_GREEN_DEEP, border: `1px solid ${BRAND_GREEN_DEEP}`, padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                  >
                    <CheckCircle2 size={14} /> Prepare filing
                  </button>
                  <button
                    onClick={() => setShowVault(true)}
                    style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1C2430", border: "1px solid #C9C4B6", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                  >
                    <Paperclip size={14} /> View uploaded documents
                  </button>
                  <button
                    onClick={() => setShowKyc(true)}
                    style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1C2430", border: "1px solid #C9C4B6", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                  >
                    <Pencil size={14} /> Onboarding
                  </button>
                  <button
                    onClick={() => {
                      setClientLabelPreview(clientDetail);
                      closeClientDetail();
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1C2430", border: "1px solid #C9C4B6", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                  >
                    <Printer size={14} /> Print folder label
                  </button>
                  {user.role === "admin" && (
                    <button
                      onClick={startEditClient}
                      style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: "#1C2430", border: "1px solid #C9C4B6", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                    >
                      <Pencil size={14} /> Edit details
                    </button>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                  {clientDetailRevealed ? (
                    <DetailRow label="ROC" value={clientDetail.roc || "—"} mono />
                  ) : (
                    <div>
                      <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>ROC</div>
                      <button
                        onClick={() => setRevealTarget("client")}
                        style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: "none", cursor: "pointer", color: BRAND_GREEN, fontSize: 13, fontWeight: 600, padding: 0 }}
                      >
                        <Info size={12} /> •••• — View
                      </button>
                    </div>
                  )}
                  <DetailRow label="FYE" value={clientDetail.yearEnd || "—"} />
                  <DetailRow label="Date incorporated" value={clientDetail.dateInc || "—"} />
                  <DetailRow
                    label="Last AGM filed"
                    value={clientDetail.lastAgmDate || "Not on record yet"}
                    accent={clientDetail.lastAgmDate ? undefined : "#B4791F"}
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Registered address</div>
                  <div style={{ fontSize: 13, color: "#1C2430" }}>{clientDetail.registeredAddress || "Not on record"}</div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Fax</div>
                  <div style={{ fontSize: 13, color: "#1C2430" }}>{clientDetail.fax || "Not on record"}</div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>GST registration no.</div>
                  <div style={{ fontSize: 13, color: "#1C2430", fontFamily: "monospace" }}>{clientDetail.gstRegNo || "Not on record"}</div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Directors</div>
                  {clientDetail.directors ? (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#1C2430" }}>
                      {clientDetail.directors.split("\n").filter(Boolean).map((name, i) => (
                        <li key={i}>{name}</li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontSize: 13, color: "#8A8577" }}>Not on record</div>
                  )}
                </div>

                <div style={{ marginBottom: 20 }}>
                  {clientDetailRevealed ? (
                    <PersonInChargeBox name={clientDetail.contact} phone={clientDetail.contactPhone} email={clientDetail.contactEmail} />
                  ) : (
                    <button
                      onClick={() => setRevealTarget("client")}
                      style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", border: "none", background: HIGHLIGHT_BG, padding: "10px 14px", cursor: "pointer", fontSize: 12, color: HIGHLIGHT_TEXT, fontWeight: 600 }}
                    >
                      <Info size={13} /> Person in charge — contact details hidden. View?
                    </button>
                  )}
                </div>

                <div style={{ marginBottom: 20 }}>
                  <ScheduleManager clientId={clientDetail.id} />
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Documents ({entries.filter((e) => e.clientId === clientDetail.id).length})
                    </div>
                    <button
                      onClick={() => {
                        viewClientDocs(clientDetail.company);
                        closeClientDetail();
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "none", cursor: "pointer", color: BRAND_GREEN, fontSize: 12, fontWeight: 600 }}
                    >
                      View all in Register <ArrowRight size={12} />
                    </button>
                  </div>
                  {entries.filter((e) => e.clientId === clientDetail.id).length === 0 ? (
                    <div style={{ fontSize: 13, color: "#8A8577" }}>No documents logged yet.</div>
                  ) : (
                    <div style={{ background: "#fff", border: "1px solid #C9C4B6" }}>
                      {entries
                        .filter((e) => e.clientId === clientDetail.id)
                        .slice(0, 6)
                        .map((d) => (
                          <div key={d.id} style={{ padding: "8px 12px", borderBottom: "1px solid #E5E1D5" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 5 }}>
                              <span style={{ fontFamily: "monospace" }}>{d.code}</span>
                              <span style={{ color: "#4A4638" }}>{CATEGORIES.find((c) => c.key === d.category)?.label}</span>
                              <span style={{ color: d.status === "Checked out" ? "#A63D40" : "#2F6F62", fontWeight: 600 }}>{d.status}</span>
                            </div>
                            <DocumentAttachments documentId={d.id} />
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {clientDetailMode === "edit" && editClientForm && (
              <form onSubmit={submitEditClient} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 700 }}>
                    Edit client
                    <InfoHint text="Admin only. Every changed field is recorded with your username and the time." />
                  </div>
                  <button type="button" onClick={closeClientDetail} style={{ border: "none", background: "none", cursor: "pointer" }}>
                    <X size={18} />
                  </button>
                </div>

                <Field label="Company" required>
                  <input value={editClientForm.company} onChange={(e) => setEditClientForm({ ...editClientForm, company: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="ROC number" required>
                  <input value={editClientForm.roc} onChange={(e) => setEditClientForm({ ...editClientForm, roc: e.target.value })} style={inputStyle} />
                </Field>
                <Field
                  label="FYE"
                  required
                  hint="Financial Year End — the month a client's accounting year closes. Used to calculate ACRA/IRAS filing deadlines."
                >
                  <input value={editClientForm.yearEnd} onChange={(e) => setEditClientForm({ ...editClientForm, yearEnd: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Date incorporated" required>
                  <input type="date" value={editClientForm.dateInc} onChange={(e) => setEditClientForm({ ...editClientForm, dateInc: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Registered address" required>
                  <textarea
                    value={editClientForm.registeredAddress}
                    onChange={(e) => setEditClientForm({ ...editClientForm, registeredAddress: e.target.value })}
                    style={{ ...inputStyle, minHeight: 56, resize: "vertical", fontFamily: "inherit" }}
                  />
                </Field>
                <Field label="Fax number (optional)">
                  <input value={editClientForm.fax || ""} onChange={(e) => setEditClientForm({ ...editClientForm, fax: e.target.value })} style={inputStyle} placeholder="e.g. +65 6123 4567" />
                </Field>
                <Field label="GST registration number (optional)" hint="Shown in the Filing Helper so it can be copied into the IRAS return. Leave blank if the company isn't GST-registered.">
                  <input value={editClientForm.gstRegNo || ""} onChange={(e) => setEditClientForm({ ...editClientForm, gstRegNo: e.target.value })} style={inputStyle} placeholder="e.g. M2-1234567-8" />
                </Field>
                <Field label="Directors" required>
                  <DirectorsInput value={editClientForm.directors} onChange={(val) => setEditClientForm({ ...editClientForm, directors: val })} />
                </Field>

                <div style={{ borderTop: "1px solid #E5E1D5", paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1C2430" }}>Person in charge</div>
                </div>
                <Field label="Name" required>
                  <input value={editClientForm.contact} onChange={(e) => setEditClientForm({ ...editClientForm, contact: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Phone" required>
                  <input value={editClientForm.contactPhone} onChange={(e) => setEditClientForm({ ...editClientForm, contactPhone: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Email (optional)">
                  <input type="email" value={editClientForm.contactEmail || ""} onChange={(e) => setEditClientForm({ ...editClientForm, contactEmail: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Status">
                  <select value={editClientForm.status} onChange={(e) => setEditClientForm({ ...editClientForm, status: e.target.value })} style={inputStyle}>
                    {Object.entries(CLIENT_STATUS).map(([key, s]) => (
                      <option key={key} value={key}>{s.label}</option>
                    ))}
                  </select>
                </Field>

                {editClientError && (
                  <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>{editClientError}</div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={cancelEditClient}
                    style={{ border: "1px solid #C9C4B6", background: "none", padding: "10px 14px", fontSize: 13, cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editClientBusy}
                    style={{ flex: 1, background: "#1C2430", color: "#EDEAE2", border: "none", padding: "10px 16px", fontWeight: 600, cursor: editClientBusy ? "default" : "pointer", opacity: editClientBusy ? 0.7 : 1 }}
                  >
                    {editClientBusy ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DirectorsInput({ value, onChange }) {
  const [draft, setDraft] = useState("");
  const names = value ? value.split("\n").filter(Boolean) : [];

  function addName() {
    const name = draft.trim();
    if (!name || names.includes(name)) {
      setDraft("");
      return;
    }
    onChange([...names, name].join("\n"));
    setDraft("");
  }

  function removeName(idx) {
    onChange(names.filter((_, i) => i !== idx).join("\n"));
  }

  function handleKeyDown(ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      addName();
    } else if (ev.key === "Backspace" && draft === "" && names.length > 0) {
      removeName(names.length - 1);
    }
  }

  return (
    <div style={{ border: "1px solid #C9C4B6", background: "#fff", padding: 8 }}>
      {names.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {names.map((name, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 5, background: "#E5E1D5", padding: "4px 8px", fontSize: 12, color: "#1C2430" }}>
              {name}
              <button
                type="button"
                onClick={() => removeName(i)}
                style={{ display: "flex", alignItems: "center", border: "none", background: "none", cursor: "pointer", padding: 0, color: "#6B6656" }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addName}
        style={{ border: "none", outline: "none", width: "100%", fontSize: 13, fontFamily: "inherit" }}
        placeholder={names.length ? "Add another director…" : "Type a name and press Enter"}
      />
    </div>
  );
}

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(ev) {
      if (ref.current && !ref.current.contains(ev.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", color: "#1C2430", border: "1px solid #C9C4B6", padding: "10px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
      >
        <User size={14} /> {user.username} ({user.role}) <ChevronDown size={12} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            ...glassPanel(0.92, 16),
            minWidth: 180,
            boxShadow: "0 12px 28px rgba(0,0,0,0.25)",
            zIndex: 30,
          }}
        >
          <button
            onClick={() => {
              setOpen(false);
              setShowChangePassword(true);
            }}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "10px 14px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1C2430" }}
          >
            <KeyRound size={14} /> Change password
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "10px 14px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1C2430" }}
          >
            <LogOut size={14} /> Log out
          </button>
        </div>
      )}
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
}

function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(ev) {
    ev.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Couldn't change the password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(28,36,48,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ ...glassPanel(0.96, 18), padding: "24px 26px", width: 360, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1C2430" }}>Change password</div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: "#8A8577" }}>
            <X size={16} />
          </button>
        </div>

        {success ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#2F6F62", fontSize: 13 }}>
              <CheckCircle2 size={16} /> Password changed.
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ marginTop: 6, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              Done
            </button>
          </>
        ) : (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
              Current password
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                style={inputStyle}
                autoFocus
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={inputStyle}
              />
            </label>

            {error && (
              <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{ marginTop: 6, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
            >
              {busy ? "Changing…" : "Change password"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

const CLIENT_IMPORT_COLUMNS = [
  { key: "fileNo", label: "File No", required: false, aliases: ["fileno", "file", "filenumber", "no"] },
  { key: "company", label: "Company", required: true, aliases: ["company", "companyname", "clientname", "client"] },
  { key: "roc", label: "ROC", required: true, aliases: ["roc", "rocnumber", "uen"] },
  { key: "yearEnd", label: "FYE", required: true, aliases: ["fye", "yearend", "financialyearend"] },
  { key: "dateInc", label: "Date Incorporated", required: true, aliases: ["dateincorporated", "dateinc", "incorporationdate"] },
  { key: "registeredAddress", label: "Registered Address", required: true, aliases: ["registeredaddress", "address"] },
  { key: "fax", label: "Fax", required: false, aliases: ["fax", "faxnumber"] },
  { key: "directors", label: "Directors", required: false, aliases: ["directors", "directorname", "directornames"] },
  { key: "contact", label: "Contact Name", required: true, aliases: ["contactname", "contact", "personincharge", "picname"] },
  { key: "contactPhone", label: "Contact Phone", required: true, aliases: ["contactphone", "phone", "picphone"] },
  { key: "contactEmail", label: "Contact Email", required: false, aliases: ["contactemail", "email", "picemail"] },
  { key: "status", label: "Status", required: false, aliases: ["status"] },
];

function normalizeHeader(h) {
  return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeImportStatus(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "A";
  if (v.startsWith("adhoc")) return "ADHOC";
  if (v === "so" || v.startsWith("struck") || v.startsWith("struk")) return "SO";
  if (v === "nr" || v.startsWith("not reach") || v.startsWith("notreach")) return "NR";
  if (v === "l" || v.startsWith("left")) return "L";
  if (v.startsWith("d")) return "D";
  return "A";
}

// Only a genuine Excel date cell (unambiguous) or an already-ISO string is
// accepted — silently guessing at "15/01/2024"-style text risks swapping
// day/month for an incorporation date, which the AGM/compliance logic relies on.
function normalizeImportDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    // formatLocalDate, not toISOString() — see the comment above it.
    return formatLocalDate(value);
  }
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function mapRawRowToClient(rawRow) {
  const lookup = {};
  for (const [k, v] of Object.entries(rawRow)) lookup[normalizeHeader(k)] = v;

  const data = {};
  const missing = [];
  for (const col of CLIENT_IMPORT_COLUMNS) {
    let raw = "";
    for (const alias of col.aliases) {
      if (lookup[alias] !== undefined && String(lookup[alias]).trim() !== "") {
        raw = lookup[alias];
        break;
      }
    }
    let value;
    if (col.key === "dateInc") {
      value = normalizeImportDate(raw);
    } else if (col.key === "status") {
      value = normalizeImportStatus(raw);
    } else if (col.key === "directors") {
      value = String(raw || "")
        .split(/[;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join("\n");
    } else {
      value = String(raw || "").trim();
    }
    data[col.key] = value;
    if (col.required && !value) {
      missing.push(col.key === "dateInc" && raw ? `${col.label} (use YYYY-MM-DD)` : col.label);
    }
  }
  return { data, missing };
}

// Workbooks often carry a "READ ME" or notes sheet ahead of the data. Rather
// than blindly using the first sheet, take the one whose headers best match
// the client columns (ties go to the earlier sheet), falling back to sheet 1.
function pickClientSheetRows(workbook) {
  const required = CLIENT_IMPORT_COLUMNS.filter((c) => c.required);
  let best = { score: -1, rows: [] };
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "" });
    if (rows.length === 0) continue;
    const headers = new Set(Object.keys(rows[0]).map(normalizeHeader));
    const score = required.filter((c) => c.aliases.some((a) => headers.has(a))).length;
    if (score > best.score) best = { score, rows };
  }
  return best.rows;
}

function downloadClientImportTemplate() {
  const headers = CLIENT_IMPORT_COLUMNS.map((c) => c.label);
  const example = [
    "",
    "Sample Trading Pte Ltd",
    "202412345A",
    "DEC",
    "2024-01-15",
    "10 Anson Road, #20-01, Singapore 079903",
    "",
    "Tan Wei Ming; Sarah Lim",
    "Priya Nair",
    "+65 9123 4567",
    "priya@sampletrading.com.sg",
    "Active",
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clients");
  XLSX.writeFile(wb, "fams-client-import-template.xlsx");
}

function BulkImportClients({ onClose, onImported, existingClients }) {
  const [step, setStep] = useState("upload"); // upload | preview | importing | results
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [parseError, setParseError] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const [results, setResults] = useState([]);
  const fileInputRef = useRef(null);

  const existingRocs = useMemo(
    () => new Set(existingClients.map((c) => (c.roc || "").trim().toLowerCase()).filter(Boolean)),
    [existingClients]
  );
  const existingFileNos = useMemo(
    () => new Set(existingClients.map((c) => (c.fileNo || "").trim().toLowerCase()).filter(Boolean)),
    [existingClients]
  );

  const readyRows = rows.filter((r) => r.missing.length === 0 && !r.duplicate);
  const skippedRows = rows.filter((r) => r.missing.length > 0 || r.duplicate);

  async function handleFile(file) {
    console.log("Import file selected:", file.name, file.size);
    setParseError("");
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const rawRows = pickClientSheetRows(workbook);
      if (rawRows.length === 0) {
        setParseError("No rows found — make sure the first row has column headers.");
        return;
      }
      const mapped = rawRows.map((raw) => {
        const { data, missing } = mapRawRowToClient(raw);
        const duplicate =
          (!!data.roc && existingRocs.has(data.roc.toLowerCase())) ||
          (!!data.fileNo && existingFileNos.has(data.fileNo.toLowerCase()));
        return { data, missing, duplicate };
      });
      setRows(mapped);
      setStep("preview");
    } catch (err) {
      console.error("Import file read failed:", err);
      setParseError(`Couldn't read this file (${err?.message || "unknown error"}) — make sure it's a valid .xlsx, .xls, or .csv file.`);
    }
  }

  function reset() {
    setStep("upload");
    setFileName("");
    setRows([]);
    setParseError("");
    setResults([]);
    setImportProgress(0);
  }

  async function runImport() {
    setStep("importing");
    const outcomes = [];
    for (let i = 0; i < readyRows.length; i++) {
      setImportProgress(i + 1);
      try {
        await createClient(readyRows[i].data);
        outcomes.push({ company: readyRows[i].data.company, success: true });
      } catch (err) {
        outcomes.push({ company: readyRows[i].data.company, success: false, error: err.message || "Failed" });
      }
    }
    setResults(outcomes);
    setStep("results");
    await onImported();
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 55,
        background: "rgba(28,36,48,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ width: 640, maxWidth: "100%", maxHeight: "88vh", background: "#FBFAF6", padding: 24, overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 18, fontWeight: 700 }}>Import clients</div>
            <div style={{ fontSize: 12, color: "#8A8577", marginTop: 3 }}>
              For onboarding a backlog at once, instead of adding clients one by one.
            </div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        {step === "upload" && (
          <div>
            <button
              type="button"
              onClick={downloadClientImportTemplate}
              style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #C9C4B6", background: "#fff", padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "#1C2430", cursor: "pointer", marginBottom: 16 }}
            >
              <Download size={13} /> Download template
            </button>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{ border: "2px dashed #C9C4B6", background: "#fff", padding: "36px 20px", textAlign: "center", cursor: "pointer" }}
            >
              <Upload size={22} color="#8A8577" style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1C2430" }}>Click to choose a file, or drag it here</div>
              <div style={{ fontSize: 11, color: "#8A8577", marginTop: 4 }}>{fileName || ".xlsx, .xls, or .csv"}</div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  // Clear the value so picking the same file twice still fires onChange.
                  const f = e.target.files[0];
                  e.target.value = "";
                  if (f) handleFile(f);
                }}
                style={{ display: "none" }}
              />
            </div>

            {parseError && (
              <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600, marginTop: 14 }}>{parseError}</div>
            )}

            <div style={{ fontSize: 11, color: "#8A8577", marginTop: 16, lineHeight: 1.5 }}>
              Required columns: Company, ROC, FYE, Date Incorporated, Registered Address, Directors, Contact Name, Contact
              Phone. File No, Fax, Contact Email, and Status are optional. List multiple directors in one cell separated by
              semicolons. Leave File No blank to have one assigned automatically — fill it in only to preserve an existing
              file number (e.g. migrating clients who already have a physical folder).
            </div>
          </div>
        )}

        {step === "preview" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "#4A4638" }}>
                <strong>{fileName}</strong> — {rows.length} row{rows.length === 1 ? "" : "s"} found,{" "}
                <span style={{ color: "#2F6F62", fontWeight: 600 }}>{readyRows.length} ready</span>
                {skippedRows.length > 0 && (
                  <span style={{ color: "#B4791F", fontWeight: 600 }}>, {skippedRows.length} skipped</span>
                )}
              </div>
              <button type="button" onClick={reset} style={{ border: "none", background: "none", cursor: "pointer", color: BRAND_GREEN, fontSize: 12, fontWeight: 600 }}>
                Choose a different file
              </button>
            </div>

            <div style={{ border: "1px solid #C9C4B6", background: "#fff", maxHeight: 320, overflowY: "auto" }}>
              {rows.map((row, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderBottom: "1px solid #E5E1D5",
                    fontSize: 12,
                    background: row.duplicate ? "#FBF5E6" : row.missing.length ? "#FBEAEA" : "transparent",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: "#1C2430" }}>
                      {row.data.company || `Row ${i + 2}`}
                      {row.data.fileNo && <span style={{ fontFamily: "monospace", fontWeight: 400, color: "#8A8577", marginLeft: 6 }}>({row.data.fileNo})</span>}
                    </div>
                    {row.missing.length > 0 && <div style={{ color: "#A63D40", fontSize: 11 }}>Missing: {row.missing.join(", ")}</div>}
                    {row.duplicate && <div style={{ color: "#7A5215", fontSize: 11 }}>ROC or File No already in the register — skipped</div>}
                  </div>
                  {row.missing.length === 0 && !row.duplicate && <CheckCircle2 size={15} color="#2F6F62" />}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button type="button" onClick={onClose} style={{ border: "1px solid #C9C4B6", background: "none", padding: "10px 14px", fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={runImport}
                disabled={readyRows.length === 0}
                style={{
                  flex: 1,
                  background: readyRows.length === 0 ? "#C9C4B6" : BRAND_GREEN_DEEP,
                  color: readyRows.length === 0 ? "#1C2430" : "#EDEAE2",
                  border: "none",
                  padding: "10px 16px",
                  fontWeight: 600,
                  cursor: readyRows.length === 0 ? "default" : "pointer",
                }}
              >
                Import {readyRows.length} client{readyRows.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <style>{"@keyframes fams-spin { to { transform: rotate(360deg); } }"}</style>
            <Loader2 size={28} color={BRAND_GREEN} style={{ marginBottom: 12, animation: "fams-spin 1s linear infinite" }} />
            <div style={{ fontSize: 13, color: "#4A4638" }}>
              Importing {importProgress} of {readyRows.length}…
            </div>
          </div>
        )}

        {step === "results" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, padding: "12px 16px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
              <CheckCircle2 size={16} /> {results.filter((r) => r.success).length} of {results.length} clients imported.
            </div>
            {results.some((r) => !r.success) && (
              <div style={{ border: "1px solid #C9C4B6", background: "#fff", marginBottom: 16 }}>
                {results
                  .filter((r) => !r.success)
                  .map((r, i) => (
                    <div key={i} style={{ padding: "8px 12px", borderBottom: "1px solid #E5E1D5", fontSize: 12 }}>
                      <span style={{ fontWeight: 600 }}>{r.company || "Unnamed row"}</span> <span style={{ color: "#A63D40" }}>— {r.error}</span>
                    </div>
                  ))}
              </div>
            )}
            <button type="button" onClick={onClose} style={{ background: "#1C2430", color: "#EDEAE2", border: "none", padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_DONUT_COLORS = {
  A: BRAND_GREEN_BRIGHT,
  D: "#B9AE8F",
  ADHOC: "#D9A44C",
  SO: "#C0555A",
  NR: "#D8C08A",
  L: "#8A8577",
};

// Hand-rolled — no charting library in this project, and one ring chart
// doesn't justify adding a dependency. Segments are stacked plain <circle>s
// using stroke-dasharray/-dashoffset, rotated so the first segment starts
// at 12 o'clock.
function DonutChart({ data, size = 150, thickness = 20, centerValue, centerLabel }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = size / 2;
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let cumulative = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(201,196,182,0.35)" strokeWidth={thickness} />
      {total > 0 &&
        data
          .filter((d) => d.value > 0)
          .map((d) => {
            const dash = (d.value / total) * circumference;
            const el = (
              <circle
                key={d.label}
                cx={cx}
                cy={cx}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-cumulative}
                transform={`rotate(-90 ${cx} ${cx})`}
              />
            );
            cumulative += dash;
            return el;
          })}
      <text x="50%" y="47%" textAnchor="middle" fontSize={size * 0.19} fontWeight="700" fill="#1C2430" fontFamily="'Fraunces', Georgia, serif">
        {centerValue}
      </text>
      <text x="50%" y="63%" textAnchor="middle" fontSize={size * 0.075} fill="#8A8577" fontFamily="'Inter', sans-serif" letterSpacing="0.5">
        {centerLabel}
      </text>
    </svg>
  );
}

function DonutLegend({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
          <span style={{ color: "#4A4638", flex: 1 }}>{d.label}</span>
          <span style={{ color: "#1C2430", fontWeight: 600 }}>{d.value}</span>
          <span style={{ color: "#8A8577", fontSize: 11, width: 34, textAlign: "right" }}>
            {total > 0 ? `${Math.round((d.value / total) * 100)}%` : "0%"}
          </span>
        </div>
      ))}
    </div>
  );
}

function DashboardOverview({ clients, entries, log, schedules, docCountFor, onOpenClient, onRefresh }) {
  const [showDeadlines, setShowDeadlines] = useState(false);
  const totalClients = clients.length;
  const activeClients = clients.filter((c) => c.status === "A").length;
  const checkedOut = entries.filter((e) => e.status === "Checked out").length;
  const critical = entries.filter((e) => e.category === "personal").length;

  const statusData = Object.entries(CLIENT_STATUS).map(([key, s]) => ({
    label: s.label,
    value: clients.filter((c) => c.status === key).length,
    color: STATUS_DONUT_COLORS[key],
  }));

  const categoryData = CATEGORIES.map((c) => ({
    label: c.label,
    value: entries.filter((e) => e.category === c.key).length,
    color: CAT_STYLE[c.key].bar,
  }));

  // The client portfolio's own revenue — not Jardeen's billing/fee income.
  // "Monthly" is that same pool divided by 12, not a separate recurring-fee figure.
  const totalAnnualRevenue = clients.reduce((sum, c) => sum + (c.annualRevenue || 0), 0);
  const monthlyRevenue = totalAnnualRevenue / 12;
  const noDocsCount = clients.filter((c) => docCountFor(c.company) === 0).length;
  const agmOverdueCount = clients.filter((c) => {
    if (c.status !== "A") return false;
    if (!c.lastAgmDate) return true;
    const monthsSince = (Date.now() - new Date(c.lastAgmDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
    return monthsSince > 15;
  }).length;

  // Proactive window — so staff can review/file before the deadline hits,
  // not just find out it's already overdue. Includes anything already
  // overdue too (still needs action, just more urgently). Merges the
  // FYE-driven AR/AGM cycle with the client-configured recurring tasks
  // (CPF, GST, Compilation, ...) into one list, sorted soonest-first.
  const DEADLINE_WINDOW_DAYS = 30;
  const arItems = clients
    .filter((c) => c.status === "A")
    .map((c) => {
      const ar = computeArDeadline(c.yearEnd, c.lastAgmDate);
      return ar ? { client: c, taskLabel: "Annual Return", due: ar.deadline, daysLeft: ar.daysLeft, overdue: ar.overdue } : null;
    })
    .filter(Boolean);
  const scheduleItems = schedules
    .filter((s) => s.clientStatus === "A")
    .map((s) => {
      const client = clients.find((c) => c.id === s.clientId);
      const next = client ? computeNextDue(s) : null;
      return next ? { client, taskLabel: s.taskName, due: next.due, daysLeft: next.daysLeft, overdue: next.overdue } : null;
    })
    .filter(Boolean);
  const upcomingDeadlines = [...arItems, ...scheduleItems]
    .filter((item) => item.daysLeft <= DEADLINE_WINDOW_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const recentActivity = [...log].slice(0, 8);

  return (
    <div>
      {/* CPF and GST for every active company: live status, action-needed tag, and one-click tick-off */}
      <ComplianceTiles clients={clients} schedules={schedules} onChanged={onRefresh} onOpenClient={onOpenClient} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard label="Total clients" value={totalClients} icon={<Building2 size={16} />} accent={BRAND_GREEN_DEEP} />
        <StatCard label="Active clients" value={activeClients} icon={<Activity size={16} />} accent="#2F6F62" />
        <StatCard label="Total documents" value={entries.length} icon={<FileText size={16} />} />
        <StatCard label="Currently checked out" value={checkedOut} icon={<Clock size={16} />} accent="#B4791F" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard label="Total annual revenue managed" value={`S$${totalAnnualRevenue.toLocaleString()}`} icon={<Building2 size={16} />} accent={BRAND_GREEN_DEEP} />
        <StatCard label="Monthly (portfolio ÷ 12)" value={`S$${monthlyRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={<Activity size={16} />} accent="#2F6F62" />
        <StatCard label="Onboarding (no docs yet)" value={noDocsCount} icon={<UserPlus size={16} />} accent="#B4791F" />
        <StatCard
          label="Filings due within 30 days"
          value={upcomingDeadlines.length}
          icon={<CalendarClock size={16} />}
          accent="#A63D40"
          onClick={() => setShowDeadlines(true)}
          hint={upcomingDeadlines.length > 0 ? "Click to review →" : undefined}
        />
      </div>

      {showDeadlines && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 55,
            background: "rgba(28,36,48,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => setShowDeadlines(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 520, maxWidth: "100%", maxHeight: "80vh", ...glassPanel(0.96, 22), padding: 24, overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 700 }}>Filings due within 30 days</div>
              <button onClick={() => setShowDeadlines(false)} style={{ border: "none", background: "none", cursor: "pointer", flexShrink: 0 }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#8A8577", marginBottom: 16 }}>
              Active clients whose Annual Return deadline is here or coming up — review and file before it's overdue.
            </div>
            {upcomingDeadlines.length === 0 ? (
              <div style={{ fontSize: 13, color: "#8A8577", padding: "20px 0", textAlign: "center" }}>Nothing due in the next 30 days.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {upcomingDeadlines.map((item, i) => (
                  <button
                    key={`${item.client.id}-${item.taskLabel}-${i}`}
                    onClick={() => {
                      setShowDeadlines(false);
                      onOpenClient(item.client);
                    }}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      width: "100%",
                      textAlign: "left",
                      border: "1px solid rgba(201,196,182,0.5)",
                      background: item.overdue ? "#F5E1E1" : "#fff",
                      padding: "10px 14px",
                      cursor: "pointer",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1C2430" }}>{item.client.company}</div>
                      <div style={{ fontSize: 11, color: "#8A8577", fontFamily: "monospace" }}>{item.client.fileNo} · {item.taskLabel}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: item.overdue ? "#A63D40" : "#B4791F" }}>
                        {item.overdue ? "Overdue" : `${item.daysLeft}d left`}
                      </div>
                      <div style={{ fontSize: 10, color: "#8A8577" }}>{formatDisplayDate(item.due)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={{ ...glassPanel(0.55, 12), padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#4A4638", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 16 }}>
            Clients by status
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <DonutChart data={statusData} centerValue={totalClients} centerLabel="clients" />
            <DonutLegend data={statusData} />
          </div>
        </div>

        <div style={{ ...glassPanel(0.55, 12), padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#4A4638", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 16 }}>
            Documents by category
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <DonutChart data={categoryData} centerValue={entries.length} centerLabel="documents" />
            <DonutLegend data={categoryData} />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ ...glassPanel(0.55, 12), padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#4A4638", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 14 }}>
            <Activity size={13} /> Recent activity
          </div>
          {recentActivity.length === 0 && <div style={{ fontSize: 12.5, color: "#8A8577" }}>No activity logged yet.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recentActivity.map((l) => (
              <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 12.5, paddingBottom: 8, borderBottom: "1px solid rgba(201,196,182,0.35)" }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ color: l.action === "Checked out" ? "#A63D40" : "#2F6F62", fontWeight: 600 }}>{l.action}</span>
                  <span style={{ color: "#4A4638" }}> · {l.client}</span>
                </div>
                <div style={{ color: "#8A8577", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>{l.time}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...glassPanel(0.55, 12), padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#4A4638", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 14 }}>
            <AlertTriangle size={13} /> Needs attention
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: HIGHLIGHT_BG, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: HIGHLIGHT_TEXT, fontWeight: 600 }}>
                <FileText size={14} /> Clients with no documents on file
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: HIGHLIGHT_TEXT }}>{noDocsCount}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F6ECDA", padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#7A5215", fontWeight: 600 }}>
                <CalendarClock size={14} /> Active clients with no recent AGM filing
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#7A5215" }}>{agmOverdueCount}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ACRA_STATUS_OPTIONS = ["Not checked", "Live Company", "Struck Off", "Dissolved", "In Liquidation", "Amalgamated"];
const ACRA_STATUS_COLOR = {
  "Not checked": { chip: "#E5E1D5", text: "#6B6656" },
  "Live Company": { chip: BRAND_GREEN_BRIGHT, text: "#FFFFFF" },
  "Struck Off": { chip: "#F5E1E1", text: "#7A2C2E" },
  "Dissolved": { chip: "#F5E1E1", text: "#7A2C2E" },
  "In Liquidation": { chip: "#F6ECDA", text: "#7A5215" },
  "Amalgamated": { chip: "#EDE4D3", text: "#8A6D3A" },
};

// A text cell that behaves like a spreadsheet cell — edits locally, saves
// on blur only if the value actually changed, so typing doesn't fire a
// request per keystroke.
function ReportTextCell({ value, onSave, placeholder }) {
  const [local, setLocal] = useState(value || "");
  useEffect(() => { setLocal(value || ""); }, [value]);
  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== (value || "")) onSave(local); }}
      placeholder={placeholder}
      style={{ border: "1px solid #E5E1D5", background: "#fff", fontSize: 12, width: "100%", padding: "5px 7px", color: "#1C2430" }}
    />
  );
}

function ReportNumberCell({ value, onSave, placeholder }) {
  const [local, setLocal] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => { setLocal(value === null || value === undefined ? "" : String(value)); }, [value]);
  return (
    <input
      type="number"
      min="0"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const num = local.trim() === "" ? null : Number(local);
        if (num !== value) onSave(num);
      }}
      placeholder={placeholder}
      style={{ border: "1px solid #E5E1D5", background: "#fff", fontSize: 12, width: "100%", padding: "5px 7px", color: "#1C2430" }}
    />
  );
}

const REPORT_PAGE_SIZE = 20;

function ReportTab({ clients, entries, onSaveField, onOpenClient, onRefresh }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [exportedMsg, setExportedMsg] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients
      .filter((c) => !q || c.company.toLowerCase().includes(q) || c.fileNo.toLowerCase().includes(q) || (c.registeredAddress || "").toLowerCase().includes(q))
      .map((c) => {
        const docs = entries.filter((e) => e.clientId === c.id);
        const services = recurringServicesFor(c.id, entries);
        const serviceTaken = services.length ? services.map((cat) => cat.label).join(", ") : "—";
        const lastActivity = docs.length ? docs.reduce((max, d) => (d.dateReceived > max ? d.dateReceived : max), docs[0].dateReceived) : "—";
        const ar = computeArDeadline(c.yearEnd, c.lastAgmDate);
        return { client: c, serviceTaken, lastActivity, ar };
      })
      .sort((a, b) => a.client.company.localeCompare(b.client.company));
  }, [clients, entries, query]);

  const totalPages = Math.max(1, Math.ceil(rows.length / REPORT_PAGE_SIZE));
  const pagedRows = useMemo(() => rows.slice((page - 1) * REPORT_PAGE_SIZE, page * REPORT_PAGE_SIZE), [rows, page]);
  useEffect(() => { setPage(1); }, [query]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);

  function exportExcel() {
    const data = rows.map(({ client: c, serviceTaken, lastActivity, ar }) => ({
      "File No": c.fileNo,
      "Company": c.company,
      "Registered Address": c.registeredAddress,
      "Verified": isVerifiedProfile(c) ? "Yes" : "No",
      "ACRA Status": c.acraStatus,
      "Annual Revenue": c.annualRevenue ?? "",
      "Tax Notes": c.taxNotes,
      "Service Taken": serviceTaken,
      "AR Deadline": ar ? formatLocalDate(ar.deadline) : "",
      "Last Activity": lastActivity,
      "Pending Work": c.pendingWork,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 8 }, { wch: 32 }, { wch: 40 }, { wch: 9 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Client Report");
    XLSX.writeFile(wb, `jardeen-client-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExportedMsg(true);
    setTimeout(() => setExportedMsg(false), 3000);
  }

  return (
    <div>
      {exportedMsg && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            animation: "fams-slide-down 220ms ease-out",
          }}
        >
          <style>{"@keyframes fams-slide-down { from { transform: translate(-50%, -30px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }"}</style>
          <div style={{ ...glassPanel(0.96, 22), display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", boxShadow: "0 12px 32px rgba(28,36,48,0.25)" }}>
            <CheckCircle2 size={16} color={BRAND_GREEN} />
            <div style={{ fontSize: 13, color: "#1C2430" }}>Excel file saved.</div>
            <button onClick={() => setExportedMsg(false)} style={{ border: "none", background: "none", cursor: "pointer", color: "#8A8577", padding: 0 }}>
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {showImport && (
        <ReportImportModal
          clients={clients}
          onClose={() => setShowImport(false)}
          onImported={onRefresh}
        />
      )}

      <div style={{ fontSize: 12, color: "#8A8577", marginBottom: 12 }}>
        A spreadsheet-style view of every client — ACRA Status, Tax Notes, and Pending Work are quick working notes any
        staff member can edit here (not auto-fetched — see chat for why). Service Taken and Last Activity are derived
        automatically from the document log.
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, ...glassPanel(0.55, 10), padding: "8px 12px", flex: 1 }}>
          <Search size={15} color="#8A8577" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by company, file no, or address"
            style={{ border: "none", outline: "none", background: "none", fontSize: 13, flex: 1, color: "#1C2430" }}
          />
        </div>
        <button
          onClick={() => setShowImport(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, ...glassPanel(0.55, 10), padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#1C2430", cursor: "pointer" }}
        >
          <Upload size={14} /> Update from Excel
        </button>
        <button
          onClick={exportExcel}
          style={{ display: "flex", alignItems: "center", gap: 6, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          <Download size={14} /> Export to Excel
        </button>
      </div>

      <div style={{ fontSize: 11, color: "#8A8577", marginBottom: 10 }}>
        {rows.length} client{rows.length === 1 ? "" : "s"}{totalPages > 1 && ` · page ${page} of ${totalPages}`}
      </div>

      <div style={{ ...glassPanel(0.55, 10), overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1500 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #C9C4B6" }}>
              {["Company", "Address", "ACRA Status", "Annual Revenue", "Tax Notes", "Service Taken", "AR Deadline", "Last Activity", "Pending Work"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", color: "#6B6656", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedRows.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "#8A8577" }}>No matching clients.</td></tr>
            )}
            {pagedRows.map(({ client: c, serviceTaken, lastActivity, ar }) => {
              const acraStyle = ACRA_STATUS_COLOR[c.acraStatus] || ACRA_STATUS_COLOR["Not checked"];
              const verified = isVerifiedProfile(c);
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid #E5E1D5" }}>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <button
                        onClick={() => onOpenClient(c)}
                        style={{ border: "none", background: "none", cursor: "pointer", color: "#1C2430", fontWeight: 600, fontSize: 13, textAlign: "left", padding: 0 }}
                      >
                        {c.company}
                      </button>
                      {verified && <CheckCircle2 size={12} color={BRAND_GREEN_BRIGHT} title="Core profile fields complete" />}
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#8A8577" }}>{c.fileNo}</div>
                  </td>
                  <td style={{ padding: "8px 12px", color: "#4A4638", fontSize: 12, maxWidth: 220 }}>{c.registeredAddress || "—"}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <select
                      value={c.acraStatus}
                      onChange={(e) => onSaveField(c.id, { acraStatus: e.target.value })}
                      style={{ background: acraStyle.chip, color: acraStyle.text, border: "none", padding: "5px 7px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                    >
                      {ACRA_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "8px 12px", minWidth: 120 }}>
                    <ReportNumberCell value={c.annualRevenue} onSave={(v) => onSaveField(c.id, { annualRevenue: v })} placeholder="S$" />
                  </td>
                  <td style={{ padding: "8px 12px", minWidth: 180 }}>
                    <ReportTextCell value={c.taxNotes} onSave={(v) => onSaveField(c.id, { taxNotes: v })} placeholder="e.g. GST filed to Q2 2026" />
                  </td>
                  <td style={{ padding: "8px 12px", color: "#4A4638", fontSize: 12 }}>{serviceTaken}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, whiteSpace: "nowrap" }}>
                    {ar ? (
                      <span style={{ color: ar.overdue ? "#A63D40" : ar.daysLeft <= 30 ? "#B4791F" : "#4A4638", fontWeight: ar.daysLeft <= 30 ? 600 : 400 }}>
                        {formatLocalDate(ar.deadline)} {ar.overdue ? "(overdue)" : `(${ar.daysLeft}d)`}
                      </span>
                    ) : (
                      <span style={{ color: "#8A8577" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#4A4638", fontSize: 12, whiteSpace: "nowrap" }}>{lastActivity}</td>
                  <td style={{ padding: "8px 12px", minWidth: 180 }}>
                    <ReportTextCell value={c.pendingWork} onSave={(v) => onSaveField(c.id, { pendingWork: v })} placeholder="e.g. Awaiting Annual Return" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 20 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{ ...glassPanel(0.5, 8), width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: page === 1 ? "default" : "pointer", opacity: page === 1 ? 0.4 : 1 }}
          >
            <ArrowLeft size={13} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
            .reduce((acc, p, i, arr) => {
              if (i > 0 && p - arr[i - 1] > 1) acc.push("…" + p);
              acc.push(p);
              return acc;
            }, [])
            .map((p) =>
              typeof p === "string" ? (
                <span key={p} style={{ color: "#8A8577", fontSize: 12, padding: "0 2px" }}>···</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    ...(p === page
                      ? { background: BRAND_GREEN_BRIGHT, border: `1px solid ${BRAND_GREEN_BRIGHT}`, boxShadow: "0 4px 14px rgba(47,168,102,0.35)" }
                      : glassPanel(0.5, 8)),
                    width: 30,
                    height: 30,
                    fontSize: 12,
                    fontWeight: p === page ? 700 : 600,
                    color: p === page ? "#FFFFFF" : "#1C2430",
                    cursor: "pointer",
                  }}
                >
                  {p}
                </button>
              )
            )}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{ ...glassPanel(0.5, 8), width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: page === totalPages ? "default" : "pointer", opacity: page === totalPages ? 0.4 : 1 }}
          >
            <ArrowRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// Re-import the same report you exported, after editing it in Excel —
// matches rows by File No (the one column that can't have changed) and
// only touches ACRA Status / Tax Notes / Pending Work, only for columns
// actually present in the uploaded file (so a partial edit — say, only the
// ACRA Status column filled in — doesn't blank out Tax Notes for everyone).
function ReportImportModal({ onClose, onImported, clients }) {
  const [step, setStep] = useState("upload");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [parseError, setParseError] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const [results, setResults] = useState([]);
  const fileInputRef = useRef(null);

  async function handleFile(file) {
    console.log("Import file selected:", file.name, file.size);
    setParseError("");
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (rawRows.length === 0) {
        setParseError("No rows found — make sure the first row has column headers.");
        return;
      }
      const mapped = rawRows.map((raw) => {
        const lookup = {};
        for (const [k, v] of Object.entries(raw)) lookup[normalizeHeader(k)] = v;
        const fileNo = String(lookup["fileno"] || "").trim();
        const client = clients.find((c) => c.fileNo.toLowerCase() === fileNo.toLowerCase());
        const hasAcra = Object.prototype.hasOwnProperty.call(lookup, "acrastatus");
        const hasTax = Object.prototype.hasOwnProperty.call(lookup, "taxnotes");
        const hasPending = Object.prototype.hasOwnProperty.call(lookup, "pendingwork");
        const hasRevenue = Object.prototype.hasOwnProperty.call(lookup, "annualrevenue");
        // Strip thousands separators ("1,234,000") before parsing — without
        // this, Number() returns NaN, which JSON.stringify silently turns
        // into null and wipes out the client's existing revenue figure.
        const rawRevenue = hasRevenue ? String(lookup["annualrevenue"]).trim().replace(/,/g, "") : "";
        const parsedRevenue = rawRevenue === "" ? null : Number(rawRevenue);
        const revenueInvalid = hasRevenue && rawRevenue !== "" && Number.isNaN(parsedRevenue);
        return {
          fileNo,
          client,
          acraStatus: hasAcra ? String(lookup["acrastatus"]).trim() : null,
          taxNotes: hasTax ? String(lookup["taxnotes"]).trim() : null,
          pendingWork: hasPending ? String(lookup["pendingwork"]).trim() : null,
          annualRevenue: hasRevenue ? parsedRevenue : undefined,
          revenueInvalid,
        };
      });
      setRows(mapped);
      setStep("preview");
    } catch (err) {
      console.error("Import file read failed:", err);
      setParseError(`Couldn't read this file (${err?.message || "unknown error"}) — make sure it's a valid .xlsx, .xls, or .csv file.`);
    }
  }

  function reset() {
    setStep("upload");
    setFileName("");
    setRows([]);
    setParseError("");
    setResults([]);
    setImportProgress(0);
  }

  const matchedRows = rows.filter((r) => r.client);
  const unmatchedRows = rows.filter((r) => !r.client);

  async function runImport() {
    setStep("importing");
    const outcomes = [];
    for (let i = 0; i < matchedRows.length; i++) {
      setImportProgress(i + 1);
      const r = matchedRows[i];
      if (r.revenueInvalid) {
        outcomes.push({ company: r.client.company, success: false, error: "Annual Revenue isn't a number — row skipped" });
        continue;
      }
      const patch = {};
      if (r.acraStatus !== null) patch.acraStatus = r.acraStatus;
      if (r.taxNotes !== null) patch.taxNotes = r.taxNotes;
      if (r.pendingWork !== null) patch.pendingWork = r.pendingWork;
      if (r.annualRevenue !== undefined) patch.annualRevenue = r.annualRevenue;
      if (Object.keys(patch).length === 0) {
        // None of the report-field columns were present for this row (e.g. an
        // older export template) — nothing to send, and PATCHing an empty
        // object just gets a 400 that reads like every client failed.
        outcomes.push({ company: r.client.company, success: true, note: "No report-field columns to update — skipped" });
        continue;
      }
      try {
        await updateClientReportFields(r.client.id, patch);
        outcomes.push({ company: r.client.company, success: true });
      } catch (err) {
        outcomes.push({ company: r.client.company, success: false, error: err.message || "Failed" });
      }
    }
    setResults(outcomes);
    setStep("results");
    await onImported();
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 55,
        background: "rgba(28,36,48,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ width: 640, maxWidth: "100%", maxHeight: "88vh", ...glassPanel(0.94, 22), padding: 24, overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 18, fontWeight: 700 }}>Update report from Excel</div>
            <div style={{ fontSize: 12, color: "#8A8577", marginTop: 3 }}>
              Upload the report after editing it — matched by File No, updates ACRA Status, Tax Notes, and Pending Work only.
            </div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        {step === "upload" && (
          <div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{ border: "2px dashed #C9C4B6", background: "#fff", padding: "36px 20px", textAlign: "center", cursor: "pointer" }}
            >
              <Upload size={22} color="#8A8577" style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1C2430" }}>Click to choose a file, or drag it here</div>
              <div style={{ fontSize: 11, color: "#8A8577", marginTop: 4 }}>{fileName || ".xlsx, .xls, or .csv"}</div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  // Clear the value so picking the same file twice still fires onChange.
                  const f = e.target.files[0];
                  e.target.value = "";
                  if (f) handleFile(f);
                }}
                style={{ display: "none" }}
              />
            </div>
            {parseError && (
              <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600, marginTop: 14 }}>{parseError}</div>
            )}
            <div style={{ fontSize: 11, color: "#8A8577", marginTop: 16, lineHeight: 1.5 }}>
              Easiest way to get a valid file: export the report first, edit the ACRA Status / Tax Notes / Pending Work
              columns in Excel, then upload it here. File No must be untouched — it's how each row is matched back to a client.
            </div>
          </div>
        )}

        {step === "preview" && (
          <div>
            <div style={{ fontSize: 12, color: "#4A4638", marginBottom: 14 }}>
              <strong>{matchedRows.length}</strong> row{matchedRows.length === 1 ? "" : "s"} matched and ready to update.
              {unmatchedRows.length > 0 && (
                <span style={{ color: "#A63D40" }}> {unmatchedRows.length} row{unmatchedRows.length === 1 ? "" : "s"} skipped — file no. not found.</span>
              )}
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #C9C4B6" }}>
              {matchedRows.map((r, i) => (
                <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid #E5E1D5", fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: "#1C2430" }}>{r.client.company} <span style={{ fontFamily: "monospace", fontWeight: 400, color: "#8A8577" }}>({r.fileNo})</span></div>
                  <div style={{ color: "#4A4638", marginTop: 2 }}>
                    {r.acraStatus !== null && <div>ACRA Status → {r.acraStatus || "(cleared)"}</div>}
                    {r.taxNotes !== null && <div>Tax Notes → {r.taxNotes || "(cleared)"}</div>}
                    {r.pendingWork !== null && <div>Pending Work → {r.pendingWork || "(cleared)"}</div>}
                    {r.annualRevenue !== undefined && <div>Annual Revenue → {r.annualRevenue === null ? "(cleared)" : r.annualRevenue}</div>}
                  </div>
                </div>
              ))}
              {unmatchedRows.map((r, i) => (
                <div key={`u${i}`} style={{ padding: "10px 14px", borderBottom: "1px solid #E5E1D5", fontSize: 12, background: "#FBF5E6", color: "#7A5215" }}>
                  File no. "{r.fileNo || "(blank)"}" — no matching client, skipped
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button type="button" onClick={reset} style={{ border: "1px solid #C9C4B6", background: "#fff", padding: "9px 14px", fontSize: 13, cursor: "pointer" }}>
                Choose a different file
              </button>
              <button
                type="button"
                onClick={runImport}
                disabled={matchedRows.length === 0}
                style={{ background: matchedRows.length === 0 ? "#C9C4B6" : BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: matchedRows.length === 0 ? "default" : "pointer" }}
              >
                Update {matchedRows.length} client{matchedRows.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <Loader2 size={26} color={BRAND_GREEN} style={{ animation: "fams-spin 1s linear infinite", marginBottom: 12 }} />
            <div style={{ fontSize: 13, color: "#4A4638" }}>Updating {importProgress} of {matchedRows.length}…</div>
          </div>
        )}

        {step === "results" && (
          <div>
            <div style={{ fontSize: 13, color: "#4A4638", marginBottom: 14 }}>
              {results.filter((r) => r.success).length} updated, {results.filter((r) => !r.success).length} failed.
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #C9C4B6" }}>
              {results.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: "1px solid #E5E1D5", fontSize: 12 }}>
                  {r.success ? <CheckCircle2 size={13} color="#2F6F62" /> : <AlertCircle size={13} color="#A63D40" />}
                  <span>{r.company}</span>
                  {!r.success && <span style={{ color: "#A63D40" }}> — {r.error}</span>}
                  {r.success && r.note && <span style={{ color: "#8A8577" }}> — {r.note}</span>}
                </div>
              ))}
            </div>
            <button onClick={onClose} style={{ marginTop: 16, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, accent, onClick, hint }) {
  return (
    <div
      onClick={onClick}
      style={{ ...glassPanel(0.58, 14), padding: "14px 16px", cursor: onClick ? "pointer" : "default", position: "relative" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: accent || "#6B6656", marginBottom: 8 }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      </div>
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 700 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: BRAND_GREEN, fontWeight: 600, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function DetailRow({ label, value, mono, accent }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: accent || "#1C2430", fontFamily: mono ? "monospace" : "inherit" }}>{value}</div>
    </div>
  );
}

// The digital copy of a document — a client emails a PDF bank statement,
// staff logs the physical paper as usual, and attaches the file here too.
// Self-contained: loads its own files lazily on first expand so the
// document list above doesn't need to fetch attachments for every row.
// Recurring compliance tasks for one client — CPF, GST, Compilation,
// Accounting, or anything custom, each on its own monthly/quarterly/yearly
// cycle. Self-contained like DocumentAttachments: loads its own data,
// manages its own add-form state.
function ScheduleManager({ clientId }) {
  const [schedules, setSchedules] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ taskName: SCHEDULE_TASK_PRESETS[0], customName: "", frequency: "monthly", dueDay: "14", dueMonth: "1" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      setSchedules(await fetchClientSchedules(clientId));
    } catch (err) {
      setError(err.message || "Failed to load schedules");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function handleAdd(ev) {
    ev.preventDefault();
    const taskName = form.taskName === "Custom" ? form.customName.trim() : form.taskName;
    if (!taskName || !form.dueDay) return;
    setBusy(true);
    setError("");
    try {
      await createSchedule(clientId, {
        taskName,
        frequency: form.frequency,
        dueDay: Number(form.dueDay),
        dueMonth: form.frequency !== "monthly" ? Number(form.dueMonth) : undefined,
      });
      setForm({ taskName: SCHEDULE_TASK_PRESETS[0], customName: "", frequency: "monthly", dueDay: "14", dueMonth: "1" });
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err.message || "Failed to add schedule");
    } finally {
      setBusy(false);
    }
  }

  async function markDone(schedule) {
    try {
      await updateSchedule(schedule.id, { lastCompletedDate: formatLocalDate(new Date()) });
      await load();
    } catch (err) {
      setError(err.message || "Failed to update");
    }
  }

  async function handleDelete(schedule) {
    try {
      await deleteSchedule(schedule.id);
      await load();
    } catch (err) {
      setError(err.message || "Failed to remove");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5 }}>
          Recurring filings {schedules ? `(${schedules.length})` : ""}
        </div>
        <button
          onClick={() => setShowAdd((s) => !s)}
          style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "none", cursor: "pointer", color: BRAND_GREEN, fontSize: 12, fontWeight: 600 }}
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} style={{ background: "#fff", border: "1px solid #C9C4B6", padding: 10, marginBottom: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={form.taskName}
              onChange={(e) => setForm({ ...form, taskName: e.target.value })}
              style={{ ...inputStyle, flex: 1 }}
            >
              {SCHEDULE_TASK_PRESETS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
              <option value="Custom">Custom…</option>
            </select>
            {form.taskName === "Custom" && (
              <input
                value={form.customName}
                onChange={(e) => setForm({ ...form, customName: e.target.value })}
                placeholder="Task name"
                style={{ ...inputStyle, flex: 1 }}
              />
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} style={{ ...inputStyle, flex: 1 }}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
            <input
              type="number"
              min="1"
              max="31"
              value={form.dueDay}
              onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
              placeholder="Due day"
              style={{ ...inputStyle, width: 90 }}
            />
            {form.frequency !== "monthly" && (
              <select value={form.dueMonth} onChange={(e) => setForm({ ...form, dueMonth: e.target.value })} style={{ ...inputStyle, width: 130 }}>
                {MONTH_ABBR.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            )}
          </div>
          <div style={{ fontSize: 10, color: "#8A8577" }}>
            {form.frequency === "quarterly" && "Repeats every 3 months from the month picked."}
            {form.frequency === "yearly" && "Repeats once a year, in the month picked."}
          </div>
          <button type="submit" disabled={busy} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", alignSelf: "flex-start" }}>
            {busy ? "Adding…" : "Add schedule"}
          </button>
        </form>
      )}

      {error && <div style={{ color: "#7A2C2E", fontSize: 11, marginBottom: 8 }}>{error}</div>}

      {schedules === null ? (
        <LoadingPanel label="Loading filings…" minHeight={70} />
      ) : schedules.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8A8577" }}>No recurring filings tracked for this client.</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #C9C4B6" }}>
          {schedules.map((s) => {
            const next = computeNextDue(s);
            return (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #E5E1D5", fontSize: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, color: "#1C2430" }}>
                    {s.taskName} <span style={{ fontWeight: 400, color: "#8A8577" }}>· {s.frequency}</span>
                  </div>
                  {next && (
                    <div style={{ color: next.overdue ? "#A63D40" : next.daysLeft <= 7 ? "#B4791F" : "#6B6656", fontSize: 11 }}>
                      {next.overdue ? "Overdue —" : "Due"} {formatDisplayDate(next.due)} {!next.overdue && `(${next.daysLeft}d)`}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={() => markDone(s)} title="Mark this cycle done" style={{ border: "none", background: "none", cursor: "pointer", color: BRAND_GREEN }}>
                    <CheckCircle2 size={15} />
                  </button>
                  <button onClick={() => handleDelete(s)} title="Remove" style={{ border: "none", background: "none", cursor: "pointer", color: "#A63D40" }}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DocumentAttachments({ documentId }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadFiles() {
    try {
      setFiles(await fetchDocumentFiles(documentId));
    } catch (err) {
      setError(err.message || "Failed to load attachments");
    }
  }

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next && files === null) loadFiles();
      return next;
    });
  }

  async function handleUpload(ev) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await uploadDocumentFile(documentId, file);
      await loadFiles();
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(file) {
    try {
      await openDocumentFile(file.id, file.filename);
    } catch (err) {
      setError(err.message || "Could not open file");
    }
  }

  async function handleDelete(fileId) {
    try {
      await deleteDocumentFile(fileId);
      await loadFiles();
    } catch (err) {
      setError(err.message || "Delete failed");
    }
  }

  return (
    <div>
      <button
        onClick={toggle}
        style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "none", cursor: "pointer", color: "#8A8577", fontSize: 11, padding: 0 }}
      >
        <Paperclip size={11} />
        {files ? `${files.length} attachment${files.length === 1 ? "" : "s"}` : "Attachments"}
      </button>
      {open && (
        <div style={{ marginTop: 6, background: "#fff", border: "1px solid #E5E1D5", padding: 8 }}>
          {files === null && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#8A8577" }}>
              <Spinner size={13} /> Loading…
            </div>
          )}
          {files && files.length === 0 && <div style={{ fontSize: 11, color: "#8A8577" }}>No files attached yet.</div>}
          {files &&
            files.map((f) => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                <button
                  onClick={() => handleOpen(f)}
                  title={f.filename}
                  style={{ border: "none", background: "none", cursor: "pointer", color: BRAND_GREEN, textAlign: "left", padding: 0, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}
                >
                  {f.filename}
                </button>
                <button onClick={() => handleDelete(f.id)} title="Remove" style={{ border: "none", background: "none", cursor: "pointer", color: "#A63D40", padding: 0, flexShrink: 0 }}>
                  <X size={11} />
                </button>
              </div>
            ))}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 11, color: BRAND_GREEN, fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
            <Upload size={11} /> {busy ? "Uploading…" : "Add file"}
            <input
              type="file"
              onChange={handleUpload}
              disabled={busy}
              style={{ display: "none" }}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.heic"
            />
          </label>
          {error && <div style={{ color: "#7A2C2E", fontSize: 11, marginTop: 4 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function PersonInChargeBox({ name, phone, email }) {
  const [open, setOpen] = useState(false);

  if (!name) {
    return (
      <div style={{ background: HIGHLIGHT_BG, padding: "10px 14px" }}>
        <div style={{ fontSize: 10, color: HIGHLIGHT_TEXT, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, fontWeight: 700 }}>Person in charge</div>
        <div style={{ fontSize: 13, color: "#7A5215" }}>No contact on record.</div>
      </div>
    );
  }

  return (
    <div
      onClick={() => setOpen((o) => !o)}
      style={{ background: HIGHLIGHT_BG, padding: "10px 14px", cursor: "pointer" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: HIGHLIGHT_TEXT, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, fontWeight: 700 }}>Person in charge</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1C2430" }}>{name}</div>
        </div>
        <ChevronDown size={14} color={HIGHLIGHT_TEXT} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
      </div>

      {open ? (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(31,74,64,0.2)", display: "flex", flexDirection: "column", gap: 5 }}>
          {phone ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Phone size={12} color={HIGHLIGHT_TEXT} />
              <a href={`tel:${phone}`} onClick={(e) => e.stopPropagation()} style={{ color: HIGHLIGHT_TEXT, fontWeight: 600, textDecoration: "none", fontSize: 13 }}>
                {phone}
              </a>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#6B6656" }}>No phone on record.</div>
          )}
          {email ? (
            <a href={`mailto:${email}`} onClick={(e) => e.stopPropagation()} style={{ color: HIGHLIGHT_TEXT, textDecoration: "none", fontSize: 13 }}>
              {email}
            </a>
          ) : (
            <div style={{ fontSize: 12, color: "#6B6656" }}>No email on record.</div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "#4A4638", marginTop: 3 }}>Click for contact details</div>
      )}
    </div>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        {label}
        {required && <span style={{ color: "#A63D40" }}> *</span>}
        {hint && <InfoHint text={hint} />}
      </span>
      {children}
    </label>
  );
}

function InfoHint({ text }) {
  const [show, setShow] = useState(false);
  const [shift, setShift] = useState(0);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (!show || !tooltipRef.current) return;
    // Clamp against the nearest scroll-constrained ancestor (the modal panel),
    // not the browser window — overflowing the panel's own width is what
    // triggers an unwanted horizontal scrollbar on the panel itself.
    let container = tooltipRef.current.parentElement;
    while (container && getComputedStyle(container).overflowY === "visible") {
      container = container.parentElement;
    }
    const bounds = container ? container.getBoundingClientRect() : { left: 12, right: window.innerWidth - 12 };
    const rect = tooltipRef.current.getBoundingClientRect();
    const margin = 8;
    const overflowRight = rect.right - (bounds.right - margin);
    const overflowLeft = bounds.left + margin - rect.left;
    if (overflowRight > 0) setShift((s) => s - overflowRight);
    else if (overflowLeft > 0) setShift((s) => s + overflowLeft);
  }, [show]);

  return (
    <span
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => {
        setShow(false);
        setShift(0);
      }}
      style={{ position: "relative", display: "inline-flex", marginLeft: 5 }}
    >
      <Info size={12} color="#8A8577" style={{ cursor: "help" }} />
      {show && (
        <span
          ref={tooltipRef}
          style={{
            position: "absolute",
            bottom: "calc(100% + 7px)",
            left: shift,
            background: "#fff",
            color: "#4A4638",
            border: "1px solid #C9C4B6",
            boxShadow: "0 10px 24px rgba(0,0,0,0.2)",
            padding: "8px 10px",
            fontSize: 11,
            fontWeight: 400,
            lineHeight: 1.4,
            width: 220,
            zIndex: 50,
            textTransform: "none",
            letterSpacing: "normal",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

const inputStyle = {
  border: "1px solid #C9C4B6",
  background: "#fff",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "'Inter', sans-serif",
  color: "#1C2430",
};
