import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Plus, Search, Printer, Clock, ShieldAlert, FileText, X, LogOut, LogIn, ScanLine, CheckCircle2, AlertCircle, Building2, ArrowRight, User } from "lucide-react";
import Login from "./Login.jsx";
import {
  getStoredUser,
  clearSession,
  fetchClients,
  fetchDocuments,
  fetchAccessLog,
  createDocument,
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
    <div style={{ width: 300, border: "1px solid #C9C4B6", background: "#FBFAF6", display: "flex", fontFamily: "Georgia, serif" }}>
      <div style={{ width: 10, background: style.bar }} />
      <div style={{ padding: "12px 14px", flex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: 1, color: "#8A8577", marginBottom: 4, fontFamily: "Inter, sans-serif" }}>
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
        <div style={{ fontSize: 10, color: "#8A8577", marginTop: 4, fontFamily: "Inter, sans-serif" }}>{entry.location}</div>
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
  const [showForm, setShowForm] = useState(false);
  const [printPreview, setPrintPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [form, setForm] = useState({ clientId: "", category: "secretarial", serviceDetail: "", location: "", dateReceived: "", loggedBy: user.username });
  const [formBusy, setFormBusy] = useState(false);

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
      });
      await refreshAll();
      const clientName = clients.find((c) => c.id === Number(form.clientId))?.company || "";
      setShowForm(false);
      setPrintPreview({ ...created, client: created.client || clientName });
      setForm({ clientId: "", category: "secretarial", serviceDetail: "", location: "", dateReceived: "", loggedBy: user.username });
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
      <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#EDEAE2", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6656" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#EDEAE2", minHeight: "100vh", color: "#1C2430" }}>
      {/* Header */}
      <div style={{ background: "#1C2430", color: "#EDEAE2", padding: "18px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 700 }}>Financial Asset Register</div>
          <div style={{ fontSize: 12, color: "#A9A48F", marginTop: 2 }}>Chain-of-custody for statutory, tax and personal records</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#A9A48F" }}>
            <User size={14} /> {user.username} ({user.role})
          </div>
          <button
            onClick={() => setShowForm(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#9C7A3C", color: "#1C2430", border: "none", padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}
          >
            <Plus size={16} /> New entry
          </button>
          <button
            onClick={onLogout}
            title="Log out"
            style={{ display: "flex", alignItems: "center", gap: 6, background: "none", color: "#EDEAE2", border: "1px solid #4A4638", padding: "10px 14px", fontWeight: 600, cursor: "pointer" }}
          >
            <LogOut size={14} /> Log out
          </button>
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
                      <tr key={c.id} style={{ borderBottom: "1px solid #E5E1D5" }}>
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
                            onClick={() => viewClientDocs(c.company)}
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

      {/* New entry form (slide-over) */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(28,36,48,0.4)", display: "flex", justifyContent: "flex-end" }}>
          <div style={{ width: 380, background: "#FBFAF6", height: "100%", padding: 24, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 700 }}>New register entry</div>
              <button onClick={() => setShowForm(false)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <form onSubmit={submitForm} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Client">
                <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} style={inputStyle}>
                  <option value="">Select a client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.company} ({c.fileNo})</option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inputStyle}>
                  {CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>{c.label} — {c.sensitivity}</option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: "#8A8577", marginTop: 4 }}>{CATEGORIES.find((c) => c.key === form.category).note}</div>
              </Field>
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
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} style={inputStyle} placeholder="e.g. Cabinet A / Drawer 2" />
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
          </div>
        </div>
      )}

      {/* Label preview modal */}
      {printPreview && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(28,36,48,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#FBFAF6", padding: 24, border: "1px solid #C9C4B6" }}>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Label preview</div>
            <Label entry={printPreview} />
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
      <div style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 700 }}>{value}</div>
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

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" }}>
      {label}
      {children}
    </label>
  );
}

const inputStyle = {
  border: "1px solid #C9C4B6",
  background: "#fff",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "Inter, sans-serif",
  color: "#1C2430",
};
