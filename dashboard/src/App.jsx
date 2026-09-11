import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Plus, Search, Printer, Clock, ShieldAlert, FileText, X, LogOut, LogIn, ScanLine, CheckCircle2, AlertCircle, Building2, ArrowRight, ArrowLeft, User, UserPlus, ChevronDown, Phone, Pencil, Package } from "lucide-react";
import Login from "./Login.jsx";
import {
  getStoredUser,
  clearSession,
  fetchClients,
  fetchDocuments,
  fetchAccessLog,
  createDocument,
  createClient,
  updateClient,
  toggleCheckout as apiToggleCheckout,
  lookupDocument,
  ApiError,
} from "./api.js";

const CATEGORIES = [
  { key: "secretarial", label: "Secretarial records", note: "Shareholders, partners, owners", sensitivity: "High" },
  { key: "banking_tax", label: "Banking & tax details", note: "Bank statements, tax filings, GST", sensitivity: "High" },
  { key: "personal", label: "Personal particulars", note: "Director / secretary ID data", sensitivity: "Critical" },
];

const CAT_STYLE = {
  secretarial: { bar: "#2F6F62", chip: "#E4EFEC", text: "#1F4A40" },
  banking_tax: { bar: "#B4791F", chip: "#F6ECDA", text: "#7A5215" },
  personal: { bar: "#A63D40", chip: "#F5E1E1", text: "#7A2C2E" },
};

const CLIENT_STATUS = {
  A: { label: "Active", chip: "#E4EFEC", text: "#1F4A40" },
  D: { label: "Deactivated", chip: "#E5E1D5", text: "#4A4638" },
  ADHOC: { label: "Adhoc (dormant)", chip: "#F6ECDA", text: "#7A5215" },
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

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  return <Dashboard user={user} onLogout={() => { clearSession(); setUser(null); }} />;
}

function Dashboard({ user, onLogout }) {
  const [entries, setEntries] = useState([]);
  const [log, setLog] = useState([]);
  const [clients, setClients] = useState([]);
  const [tab, setTab] = useState("clients");
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [clientQuery, setClientQuery] = useState("");
  const [clientStatusFilter, setClientStatusFilter] = useState("all");
  const [hoveredClientId, setHoveredClientId] = useState(null);
  const [clientDetail, setClientDetail] = useState(null);
  const [clientDetailMode, setClientDetailMode] = useState("view"); // view | edit
  const [editClientForm, setEditClientForm] = useState(null);
  const [editClientBusy, setEditClientBusy] = useState(false);
  const [editClientError, setEditClientError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [printPreview, setPrintPreview] = useState(null);
  const [clientLabelPreview, setClientLabelPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [form, setForm] = useState({ clientId: "", category: "secretarial", serviceDetail: "", location: "", dateReceived: "", loggedBy: user.username, isAgmFiling: false, isBatch: false, batchCount: "" });
  const [formBusy, setFormBusy] = useState(false);

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
    status: "A",
  });
  const [newClientBusy, setNewClientBusy] = useState(false);
  const [newClientError, setNewClientError] = useState("");
  const [onboardedClient, setOnboardedClient] = useState(null);
  const [showPostOnboardActions, setShowPostOnboardActions] = useState(false);
  const postOnboardTimer = useRef(null);

  useEffect(() => () => clearTimeout(postOnboardTimer.current), []);

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
      status: "A",
    });
    setNewClientError("");
    setOnboardedClient(null);
    setShowPostOnboardActions(false);
    setForm({ clientId: "", category: "secretarial", serviceDetail: "", location: "", dateReceived: "", loggedBy: user.username, isAgmFiling: false, isBatch: false, batchCount: "" });
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
    setForm({ clientId: onboardedClient.id, category: "secretarial", serviceDetail: "", location: "", dateReceived: "", loggedBy: user.username, isAgmFiling: false, isBatch: false, batchCount: "" });
    setEntryStep("document");
  }

  function proceedToPrintFolderLabel() {
    clearTimeout(postOnboardTimer.current);
    setClientLabelPreview(onboardedClient);
    closeEntryForm();
  }

  const [scanValue, setScanValue] = useState("");
  const [scanResult, setScanResult] = useState(null);
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

  const refreshAll = useCallback(async () => {
    try {
      const [c, d, l] = await Promise.all([fetchClients(), fetchDocuments(), fetchAccessLog()]);
      setClients(c);
      setEntries(d);
      setLog(l);
      setErrorMsg("");
    } catch (err) {
      if (!handleAuthError(err)) setErrorMsg(err.message || "Failed to load data");
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
    // encoding just the short ID (e.g. FAM-2026-0001) lands here the same
    // way manual typing would. We look up as soon as the code shape matches.
    if (/^FAM-\d{4}-\d{4}$/i.test(val.trim())) {
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
    return clients.filter((c) => {
      const matchesQuery =
        clientQuery.trim() === "" ||
        c.company.toLowerCase().includes(clientQuery.toLowerCase()) ||
        c.fileNo.toLowerCase().includes(clientQuery.toLowerCase()) ||
        c.roc.toLowerCase().includes(clientQuery.toLowerCase());
      const matchesStatus = clientStatusFilter === "all" || c.status === clientStatusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [clients, clientQuery, clientStatusFilter]);

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
    setForm({ clientId: client.id, category: "secretarial", serviceDetail: "", location: "", dateReceived: "", loggedBy: user.username, isAgmFiling: false, isBatch: false, batchCount: "" });
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

  const stats = useMemo(() => {
    const total = entries.length;
    const critical = entries.filter((e) => e.category === "personal").length;
    const high = entries.filter((e) => e.category !== "personal").length;
    const checkedOut = entries.filter((e) => e.status === "Checked out").length;
    return { total, critical, high, checkedOut };
  }, [entries]);

  async function submitForm(ev) {
    ev.preventDefault();
    if (!form.clientId || !form.location.trim() || !form.dateReceived || !form.loggedBy.trim()) return;
    setFormBusy(true);
    try {
      const created = await createDocument({
        clientId: Number(form.clientId),
        category: form.category,
        serviceDetail: form.serviceDetail.trim(),
        location: form.location.trim(),
        dateReceived: form.dateReceived,
        loggedBy: form.loggedBy.trim(),
        isAgmFiling: form.category === "secretarial" && form.isAgmFiling,
        isBatch: form.isBatch,
        batchCount: form.isBatch && form.batchCount ? Number(form.batchCount) : null,
      });
      await refreshAll();
      const clientName = selectedClient?.company || clients.find((c) => c.id === Number(form.clientId))?.company || "";
      closeEntryForm();
      setPrintPreview({ ...created, client: created.client || clientName });
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

  if (loading) {
    return (
      <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#EDEAE2", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6656" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#EDEAE2", minHeight: "100vh", color: "#1C2430" }}>
      {/* Header */}
      <div style={{ background: "#1C2430", color: "#EDEAE2", padding: "18px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 700 }}>Financial Asset Register</div>
          <div style={{ fontSize: 12, color: "#A9A48F", marginTop: 2 }}>Chain-of-custody for statutory, tax and personal records</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={openEntryForm}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#9C7A3C", color: "#1C2430", border: "none", padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}
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

      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "24px 28px" }}>
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          <StatCard label="Active clients" value={clients.filter((c) => c.status === "A").length} icon={<Building2 size={16} />} accent="#2F6F62" />
          <StatCard label="Total documents" value={stats.total} icon={<FileText size={16} />} />
          <StatCard label="Critical (personal ID)" value={stats.critical} icon={<ShieldAlert size={16} />} accent="#A63D40" />
          <StatCard label="Currently checked out" value={stats.checkedOut} icon={<Clock size={16} />} accent="#B4791F" />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #C9C4B6" }}>
          {[
            { key: "clients", label: "Clients" },
            { key: "register", label: "Register" },
            { key: "scan", label: "Scan lookup" },
            { key: "log", label: "Access log" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "10px 16px",
                background: "none",
                border: "none",
                borderBottom: tab === t.key ? "2px solid #9C7A3C" : "2px solid transparent",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                color: "#1C2430",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {t.key === "scan" && <ScanLine size={14} />}
              {t.label}
            </button>
          ))}
        </div>

        {tab === "clients" && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#FBFAF6", border: "1px solid #C9C4B6", padding: "8px 12px", flex: 1 }}>
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
                style={{ border: "1px solid #C9C4B6", background: "#FBFAF6", padding: "8px 12px", fontSize: 13, color: "#1C2430" }}
              >
                <option value="all">All statuses</option>
                <option value="A">Active</option>
                <option value="D">Deactivated</option>
                <option value="ADHOC">Adhoc</option>
              </select>
            </div>

            <div style={{ background: "#FBFAF6", border: "1px solid #C9C4B6" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #C9C4B6" }}>
                    {["File no.", "Company", "ROC", "Year end", "Date inc.", "Contact", "Status", "Documents", ""].map((h) => (
                      <th key={h} style={{ padding: "10px 14px", color: "#6B6656", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.length === 0 && (
                    <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "#8A8577" }}>No matching clients.</td></tr>
                  )}
                  {filteredClients.map((c) => {
                    const s = CLIENT_STATUS[c.status];
                    const docCount = docCountFor(c.company);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => openClientDetail(c)}
                        onMouseEnter={() => setHoveredClientId(c.id)}
                        onMouseLeave={() => setHoveredClientId((h) => (h === c.id ? null : h))}
                        style={{
                          borderBottom: "1px solid #E5E1D5",
                          cursor: "pointer",
                          background: hoveredClientId === c.id ? "#F1EEE4" : "transparent",
                        }}
                      >
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12 }}>{c.fileNo}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>{c.company}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12, color: "#4A4638" }}>{c.roc}</td>
                        <td style={{ padding: "10px 14px", color: "#4A4638" }}>{c.yearEnd}</td>
                        <td style={{ padding: "10px 14px", color: "#4A4638" }}>{c.dateInc}</td>
                        <td style={{ padding: "10px 14px", color: "#4A4638" }}>{c.contact}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ background: s.chip, color: s.text, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}>{s.label}</span>
                        </td>
                        <td style={{ padding: "10px 14px", color: "#4A4638" }}>{docCount}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              viewClientDocs(c.company);
                            }}
                            style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "none", cursor: "pointer", color: "#9C7A3C", fontSize: 12, fontWeight: 600 }}
                          >
                            View docs <ArrowRight size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "register" && (
          <>
            {/* Search + filter */}
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#FBFAF6", border: "1px solid #C9C4B6", padding: "8px 12px", flex: 1 }}>
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
                style={{ border: "1px solid #C9C4B6", background: "#FBFAF6", padding: "8px 12px", fontSize: 13, color: "#1C2430" }}
              >
                <option value="all">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>

            {/* Table */}
            <div style={{ background: "#FBFAF6", border: "1px solid #C9C4B6" }}>
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
                  {filtered.map((e) => {
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
          </>
        )}

        {tab === "scan" && (
          <div>
            <div style={{ fontSize: 12, color: "#6B6656", marginBottom: 10 }}>
              Scan the label's QR code, or type the unique ID printed above it. The QR only encodes the short ID (e.g.{" "}
              <span style={{ fontFamily: "monospace" }}>FAM-2026-0001</span>) — this lookup resolves it to the live record, not a
              frozen snapshot from print time.
            </div>
            <form onSubmit={handleScanSubmit} style={{ display: "flex", gap: 10, marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FBFAF6", border: "1px solid #C9C4B6", padding: "10px 14px", flex: 1 }}>
                <ScanLine size={16} color="#9C7A3C" />
                <input
                  autoFocus
                  value={scanValue}
                  onChange={handleScanChange}
                  placeholder="FAM-2026-0001"
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
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#E4EFEC", color: "#1F4A40", padding: "10px 16px", fontSize: 13, fontWeight: 600 }}>
                  <CheckCircle2 size={16} /> Record found
                </div>
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

                <div style={{ borderTop: "1px solid #E5E1D5", padding: "16px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
                    <Building2 size={13} /> Company snapshot
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                    <DetailRow label="ROC" value={scanResult.clientRoc || "—"} mono />
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

                  <div style={{ background: "#E4EFEC", padding: "10px 14px" }}>
                    <div style={{ fontSize: 10, color: "#1F4A40", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, fontWeight: 700 }}>
                      Person in charge
                    </div>
                    {scanResult.clientContactName ? (
                      <div style={{ fontSize: 13, color: "#1C2430" }}>
                        <div style={{ fontWeight: 600 }}>{scanResult.clientContactName}</div>
                        {scanResult.clientContactPhone && (
                          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                            <Phone size={12} color="#1F4A40" />
                            <a href={`tel:${scanResult.clientContactPhone}`} style={{ color: "#1F4A40", fontWeight: 600, textDecoration: "none" }}>
                              {scanResult.clientContactPhone}
                            </a>
                          </div>
                        )}
                        {scanResult.clientContactEmail && (
                          <div style={{ marginTop: 2 }}>
                            <a href={`mailto:${scanResult.clientContactEmail}`} style={{ color: "#1F4A40", textDecoration: "none" }}>
                              {scanResult.clientContactEmail}
                            </a>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: "#7A5215" }}>No contact on record — add one from the Clients tab.</div>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, padding: "0 20px 18px" }}>
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
          <div style={{ background: "#FBFAF6", border: "1px solid #C9C4B6" }}>
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
        )}
      </div>

      {/* New entry / client onboarding wizard */}
      {showForm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(28,36,48,0.45)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div style={{ width: 440, maxWidth: "100%", maxHeight: "88vh", background: "#FBFAF6", padding: 24, overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 700 }}>
                  {entryStep === "new-client" ? "New client" : entryStep === "onboarded" ? "Client added" : "New register entry"}
                </div>
                <div style={{ fontSize: 12, color: "#8A8577", marginTop: 3 }}>
                  {entryStep === "search" && "Find the client this document belongs to."}
                  {entryStep === "new-client" && "This company isn't in the register yet — add their details below."}
                  {entryStep === "document" && selectedClient && `Client: ${selectedClient.company} (${selectedClient.fileNo})`}
                </div>
              </div>
              <button onClick={closeEntryForm} style={{ border: "none", background: "none", cursor: "pointer", flexShrink: 0 }}><X size={18} /></button>
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
                  style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, border: "none", background: "none", cursor: "pointer", color: "#9C7A3C", fontSize: 12, fontWeight: 600, padding: 0 }}
                >
                  <UserPlus size={13} /> Can't find them? Add a new client instead
                </button>
              </div>
            )}

            {entryStep === "new-client" && (
              <form onSubmit={submitNewClient} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 11, color: "#8A8577" }}>
                  A file number is assigned automatically once this client is saved.
                </div>
                <Field label="Company" required>
                  <input value={newClientForm.company} onChange={(e) => setNewClientForm({ ...newClientForm, company: e.target.value })} style={inputStyle} placeholder="Registered company name" />
                </Field>
                <Field label="ROC number" required>
                  <input value={newClientForm.roc} onChange={(e) => setNewClientForm({ ...newClientForm, roc: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Year end" required>
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
                <Field label="Directors" required>
                  <DirectorsInput value={newClientForm.directors} onChange={(val) => setNewClientForm({ ...newClientForm, directors: val })} />
                </Field>

                <div style={{ borderTop: "1px solid #E5E1D5", paddingTop: 12, marginTop: 2 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1C2430", marginBottom: 2 }}>Person in charge</div>
                  <div style={{ fontSize: 11, color: "#8A8577", marginBottom: 10 }}>
                    Staff can't call every director — this is the one number to actually reach for this client.
                  </div>
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
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#E4EFEC", color: "#1F4A40", padding: "12px 16px", fontSize: 13, fontWeight: 600, marginBottom: 18 }}>
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
                      style={{ display: "flex", alignItems: "center", gap: 8, background: "#9C7A3C", color: "#1C2430", border: "none", padding: "10px 14px", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
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
                  style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", border: "none", background: "none", cursor: "pointer", color: "#9C7A3C", fontSize: 12, fontWeight: 600, padding: 0 }}
                >
                  <ArrowLeft size={13} /> Change client
                </button>
                <Field label="Category">
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value, isAgmFiling: e.target.value === "secretarial" && form.isAgmFiling })}
                    style={inputStyle}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>{c.label} — {c.sensitivity}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: "#8A8577", marginTop: 4 }}>{CATEGORIES.find((c) => c.key === form.category).note}</div>
                </Field>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#E5E1D5", padding: "10px 12px", fontSize: 12, color: "#4A4638", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.isBatch}
                    onChange={(e) => setForm({ ...form, isBatch: e.target.checked })}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <strong>This is a box/bag intake</strong> — the client dropped off several documents at once with no room to file or scan each one individually. Logs one entry and one label for the whole box.
                  </span>
                </label>
                {form.isBatch && (
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
                )}
                {form.category === "secretarial" && (
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#F6ECDA", padding: "10px 12px", fontSize: 12, color: "#4A4638", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.isAgmFiling}
                      onChange={(e) => setForm({ ...form, isAgmFiling: e.target.checked })}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      This is the AGM / Annual Return filing — checking this updates the client's <strong>Last AGM Filed</strong> date to the date received below.
                    </span>
                  </label>
                )}
                <Field label="Service detail (optional)">
                  <input
                    value={form.serviceDetail}
                    onChange={(e) => setForm({ ...form, serviceDetail: e.target.value })}
                    style={inputStyle}
                    placeholder="e.g. GST Q2 2026, Annual Return 2025"
                  />
                  <div style={{ fontSize: 11, color: "#8A8577", marginTop: 4 }}>
                    Use this to tell apart multiple filings in the same category — doesn't need to follow any order.
                  </div>
                </Field>
                <Field label="Storage location">
                  <input
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    style={inputStyle}
                    placeholder={form.isBatch ? "e.g. Box #3, client shelf" : "e.g. Cabinet A / Drawer 2"}
                  />
                </Field>
                <Field label="Date received">
                  <input type="date" value={form.dateReceived} onChange={(e) => setForm({ ...form, dateReceived: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Logged by">
                  <input value={form.loggedBy} onChange={(e) => setForm({ ...form, loggedBy: e.target.value })} style={inputStyle} placeholder="Staff name" />
                </Field>
                <button type="submit" disabled={formBusy} style={{ marginTop: 8, background: "#9C7A3C", color: "#1C2430", border: "none", padding: "10px 16px", fontWeight: 600, cursor: formBusy ? "default" : "pointer", opacity: formBusy ? 0.7 : 1 }}>
                  {formBusy ? "Saving…" : "Save & generate label"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Label preview modal */}
      {printPreview && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(28,36,48,0.45)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
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
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setPrintPreview(null)} style={{ border: "1px solid #C9C4B6", background: "none", padding: "9px 14px", cursor: "pointer", fontSize: 13 }}>Close</button>
              <button
                onClick={() => setPrintPreview(null)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "#1C2430", color: "#EDEAE2", border: "none", padding: "9px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
              >
                <Printer size={14} /> Send to label printer
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
            background: "rgba(28,36,48,0.45)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div style={{ background: "#FBFAF6", padding: 24, border: "1px solid #C9C4B6", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Folder label preview</div>
            <ClientLabel client={clientLabelPreview} />
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setClientLabelPreview(null)} style={{ border: "1px solid #C9C4B6", background: "none", padding: "9px 14px", cursor: "pointer", fontSize: 13 }}>Close</button>
              <button
                onClick={() => setClientLabelPreview(null)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "#1C2430", color: "#EDEAE2", border: "none", padding: "9px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
              >
                <Printer size={14} /> Send to label printer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client detail — one place for everything about a client, whether you're */}
      {/* browsing or on a call and need an answer right now */}
      {clientDetail && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(28,36,48,0.45)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
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
                    style={{ display: "flex", alignItems: "center", gap: 6, background: "#9C7A3C", color: "#1C2430", border: "none", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                  >
                    <FileText size={14} /> Log a document
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
                  <DetailRow label="ROC" value={clientDetail.roc || "—"} mono />
                  <DetailRow label="Year end" value={clientDetail.yearEnd || "—"} />
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

                <div style={{ background: "#E4EFEC", padding: "10px 14px", marginBottom: 20 }}>
                  <div style={{ fontSize: 10, color: "#1F4A40", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, fontWeight: 700 }}>Person in charge</div>
                  {clientDetail.contact ? (
                    <div style={{ fontSize: 13, color: "#1C2430" }}>
                      <div style={{ fontWeight: 600 }}>{clientDetail.contact}</div>
                      {clientDetail.contactPhone && (
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                          <Phone size={12} color="#1F4A40" />
                          <a href={`tel:${clientDetail.contactPhone}`} style={{ color: "#1F4A40", fontWeight: 600, textDecoration: "none" }}>
                            {clientDetail.contactPhone}
                          </a>
                        </div>
                      )}
                      {clientDetail.contactEmail && (
                        <div style={{ marginTop: 2 }}>
                          <a href={`mailto:${clientDetail.contactEmail}`} style={{ color: "#1F4A40", textDecoration: "none" }}>
                            {clientDetail.contactEmail}
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "#7A5215" }}>No contact on record.</div>
                  )}
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
                      style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "none", cursor: "pointer", color: "#9C7A3C", fontSize: 12, fontWeight: 600 }}
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
                          <div
                            key={d.id}
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #E5E1D5", fontSize: 12 }}
                          >
                            <span style={{ fontFamily: "monospace" }}>{d.code}</span>
                            <span style={{ color: "#4A4638" }}>{CATEGORIES.find((c) => c.key === d.category)?.label}</span>
                            <span style={{ color: d.status === "Checked out" ? "#A63D40" : "#2F6F62", fontWeight: 600 }}>{d.status}</span>
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
                  <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 700 }}>Edit client</div>
                  <button type="button" onClick={closeClientDetail} style={{ border: "none", background: "none", cursor: "pointer" }}>
                    <X size={18} />
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "#8A8577", marginTop: -8 }}>
                  Admin only. Every changed field is recorded with your username and the time.
                </div>

                <Field label="Company" required>
                  <input value={editClientForm.company} onChange={(e) => setEditClientForm({ ...editClientForm, company: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="ROC number" required>
                  <input value={editClientForm.roc} onChange={(e) => setEditClientForm({ ...editClientForm, roc: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Year end" required>
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
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", color: "#EDEAE2", border: "1px solid #4A4638", padding: "10px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
      >
        <User size={14} /> {user.username} ({user.role}) <ChevronDown size={12} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "#FBFAF6",
            border: "1px solid #C9C4B6",
            minWidth: 160,
            boxShadow: "0 12px 28px rgba(0,0,0,0.25)",
            zIndex: 30,
          }}
        >
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
    </div>
  );
}

function StatCard({ label, value, icon, accent }) {
  return (
    <div style={{ background: "#FBFAF6", border: "1px solid #C9C4B6", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: accent || "#6B6656", marginBottom: 8 }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      </div>
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 700 }}>{value}</div>
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

function Field({ label, required, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
      {label}
      {required && <span style={{ color: "#A63D40" }}> *</span>}
      {children}
    </label>
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
