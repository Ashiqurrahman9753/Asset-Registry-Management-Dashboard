import React, { useState, useEffect, useMemo } from "react";
import { fetchFileItems, fetchClientKyc, fetchClientPep } from "./api.js";
import { cycleView } from "./deadlines.js";
import { Spinner } from "./Loading.jsx";

// Shown under a scanned folder label: what paperwork is on file (and where), and how
// the client's filings stand, so one scan answers "what's missing for this company?".

const ITEMS = [
  { key: "kyc", label: "KYC form" },
  { key: "pep", label: "PEP declaration" },
  { key: "id", label: "ID copies" },
  { key: "letter", label: "Engagement letter" },
];

const chip = (bg, fg) => ({ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: "3px 9px", whiteSpace: "nowrap" });

export default function ScanCompliance({ clientId, schedules }) {
  const [items, setItems] = useState(null);
  const [digital, setDigital] = useState({ kyc: 0, pep: 0 });

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    Promise.all([
      fetchFileItems(clientId).catch(() => []),
      fetchClientKyc(clientId).catch(() => []),
      fetchClientPep(clientId).catch(() => []),
    ]).then(([rows, kyc, pep]) => {
      if (cancelled) return;
      const map = {};
      for (const r of rows) map[r.item_key] = r;
      setItems(map);
      setDigital({ kyc: kyc.length, pep: pep.length });
    });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const filings = useMemo(() => {
    const today = new Date();
    return (schedules || [])
      .filter((s) => s.clientId === clientId)
      .map((s) => ({ s, v: cycleView(s, today) }))
      .filter((x) => x.v)
      .sort((a, b) => Number(b.v.action) - Number(a.v.action) || a.v.due - b.v.due);
  }, [schedules, clientId]);

  const dueText = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const heading = { fontSize: 11, color: "#8A8577", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={heading}>Paperwork on file</div>
      {items === null ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#8A8577" }}>
          <Spinner size={14} /> Loading…
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #C9C4B6", marginBottom: 16 }}>
          {ITEMS.map((it) => {
            const saved = items[it.key];
            const inApp = digital[it.key] || 0;
            let badge;
            if (saved && saved.status === "paper") badge = <span style={chip("#E3EFE9", "#1F4A40")}>On paper{saved.location ? ` · ${saved.location}` : ""}</span>;
            else if (saved && saved.status === "na") badge = <span style={chip("#ECE9E0", "#4A4638")}>Not applicable</span>;
            else if (inApp > 0) badge = <span style={chip("#E3EFE9", "#1F4A40")}>In the app ({inApp})</span>;
            else badge = <span style={chip("#F5E1E1", "#7A2C2E")}>Missing</span>;
            return (
              <div key={it.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", borderBottom: "1px solid #E5E1D5", fontSize: 12.5, gap: 8 }}>
                <span>{it.label}</span>
                {badge}
              </div>
            );
          })}
        </div>
      )}

      <div style={heading}>Filings</div>
      {filings.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#8A8577" }}>No filing schedule set up for this client yet.</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #C9C4B6" }}>
          {filings.map(({ s, v }) => {
            let badge;
            if (v.done) badge = <span style={chip("#E3EFE9", "#1F4A40")}>Filed</span>;
            else if (v.overdue) badge = <span style={chip("#F5E1E1", "#7A2C2E")}>{Math.abs(v.daysLeft)} day{Math.abs(v.daysLeft) === 1 ? "" : "s"} overdue</span>;
            else if (v.action) badge = <span style={chip("#FBF1E0", "#7A5215")}>{v.daysLeft === 0 ? "Due today" : `${v.daysLeft} day${v.daysLeft === 1 ? "" : "s"} left`}</span>;
            else badge = <span style={chip("#ECE9E0", "#4A4638")}>Upcoming</span>;
            return (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", borderBottom: "1px solid #E5E1D5", fontSize: 12.5, gap: 8 }}>
                <span>
                  <strong>{s.taskName}</strong> <span style={{ color: "#6B6656" }}>· {v.period} · due {dueText(v.due)}</span>
                </span>
                {badge}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
