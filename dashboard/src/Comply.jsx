import React, { useState, useMemo } from "react";
import { X, CalendarClock, CheckCircle2, AlertTriangle, ArrowRight, Search } from "lucide-react";
import { BRAND_GREEN_DEEP, glassPanel } from "./theme.jsx";
import { createSchedule, updateSchedule } from "./api.js";
import { cycleView, ACTION_DAYS } from "./deadlines.js";
import { Spinner } from "./Loading.jsx";

// The CPF and GST board: every active company's recurring filing for the
// current cycle in one place. Two live tiles on the dashboard (with an
// "Action needed" tag when anything is overdue or due within 5 days) and a
// panel where each filing gets a quick "Has it been filed? Yes / Not yet".

export const TASKS = [
  { key: "cpf", label: "CPF", name: "CPF Filing", test: /cpf/i, frequency: "monthly", defaultDay: 14, blurb: "Monthly contributions" },
  { key: "gst", label: "GST", name: "GST Filing", test: /gst/i, frequency: "quarterly", blurb: "Quarterly returns" },
];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d) => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One entry per active client who has this kind of schedule, with the state of its current cycle.
export function buildItems(task, clients, schedules, today = new Date()) {
  const items = [];
  for (const s of schedules) {
    if (!task.test.test(s.taskName || "") || s.clientStatus !== "A") continue;
    const client = clients.find((c) => c.id === s.clientId);
    const view = client ? cycleView(s, today) : null;
    if (view) items.push({ schedule: s, client, view });
  }
  // Most urgent first; filed ones at the bottom, alphabetical within each group.
  items.sort((a, b) => {
    if (a.view.done !== b.view.done) return a.view.done ? 1 : -1;
    if (a.view.daysLeft !== b.view.daysLeft) return a.view.daysLeft - b.view.daysLeft;
    return a.client.company.localeCompare(b.client.company);
  });
  return items;
}

export function statsFor(items) {
  const done = items.filter((i) => i.view.done).length;
  const overdue = items.filter((i) => !i.view.done && i.view.overdue).length;
  const urgent = items.filter((i) => !i.view.done && i.view.action).length; // includes overdue
  return { total: items.length, done, overdue, urgent, dueSoon: urgent - overdue, upcoming: items.length - done - urgent };
}

// How many filings across CPF and GST need action right now — drives the badge on the Dashboard tab.
export function countUrgent(clients, schedules, today = new Date()) {
  return TASKS.reduce((sum, task) => sum + statsFor(buildItems(task, clients, schedules, today)).urgent, 0);
}

// ---------- Dashboard tiles ----------

export function ComplianceTiles({ clients, schedules, onChanged, onOpenClient }) {
  const [openKey, setOpenKey] = useState(null);
  const [setupFirst, setSetupFirst] = useState(false);
  const today = new Date();

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginBottom: 20 }}>
        {TASKS.map((task) => {
          const items = buildItems(task, clients, schedules, today);
          const st = statsFor(items);
          const activeClients = clients.filter((c) => c.status === "A").length;
          const missing = activeClients - new Set(schedules.filter((s) => task.test.test(s.taskName || "") && s.clientStatus === "A").map((s) => s.clientId)).size;
          const nextDue = items.find((i) => !i.view.done);
          const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
          return (
            <div key={task.key} style={{ ...glassPanel(0.82), padding: 0, overflow: "hidden", position: "relative", borderLeft: `4px solid ${st.urgent > 0 ? "#A63D40" : "#2FA866"}`, animation: "fams-fade 0.4s ease-out" }}>
              <button
                type="button"
                onClick={() => {
                  setSetupFirst(false);
                  setOpenKey(task.key);
                }}
                style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer", padding: "16px 18px" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 34, height: 34, borderRadius: 8, background: "#E3EFE9", display: "inline-flex", alignItems: "center", justifyContent: "center", color: BRAND_GREEN_DEEP }}>
                      <CalendarClock size={17} />
                    </span>
                    <div>
                      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 700, color: "#1C2430" }}>{task.label} filings</div>
                      <div style={{ fontSize: 11.5, color: "#8A8577" }}>
                        {nextDue ? `${nextDue.view.period} · due ${shortDate(nextDue.view.due)}` : items.length ? "All filed for this cycle" : task.blurb}
                      </div>
                    </div>
                  </div>
                  {items.length > 0 &&
                    (st.urgent > 0 ? (
                      <span style={{ background: "#A63D40", color: "#fff", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, padding: "5px 10px", borderRadius: 999, animation: "fams-pulse 1.8s infinite", whiteSpace: "nowrap" }}>
                        ACTION NEEDED · {st.urgent}
                      </span>
                    ) : (
                      <span style={{ background: "#E3EFE9", color: "#1F4A40", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, padding: "5px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>ON TRACK</span>
                    ))}
                </div>

                {items.length === 0 ? (
                  <div style={{ marginTop: 16, fontSize: 13, color: "#6B6656", lineHeight: 1.5 }}>
                    No {task.label} schedules yet. {missing > 0 ? `${missing} active clients have none.` : ""}{" "}
                    <span style={{ color: BRAND_GREEN_DEEP, fontWeight: 700 }}>Set up →</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 14 }}>
                      <span style={{ fontSize: 34, fontWeight: 800, color: "#1C2430", lineHeight: 1 }}>{st.done}</span>
                      <span style={{ fontSize: 13, color: "#6B6656" }}>of {st.total} filed this cycle</span>
                      <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "#1F4A40" }}>{pct}%</span>
                    </div>
                    <div style={{ display: "flex", height: 8, background: "#E9E5D8", borderRadius: 999, overflow: "hidden", marginTop: 10 }}>
                      <div style={{ width: `${(st.done / st.total) * 100}%`, background: "#2FA866", transition: "width 0.5s" }} />
                      <div style={{ width: `${(st.upcoming / st.total) * 100}%`, background: "#C9C4B6", transition: "width 0.5s" }} />
                      <div style={{ width: `${(st.dueSoon / st.total) * 100}%`, background: "#B4791F", transition: "width 0.5s" }} />
                      <div style={{ width: `${(st.overdue / st.total) * 100}%`, background: "#A63D40", transition: "width 0.5s" }} />
                    </div>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11.5, color: "#4A4638" }}>
                      <span><b style={{ color: "#A63D40" }}>{st.overdue}</b> overdue</span>
                      <span><b style={{ color: "#B4791F" }}>{st.dueSoon}</b> due within {ACTION_DAYS} days</span>
                      <span><b>{st.upcoming}</b> upcoming</span>
                    </div>
                  </>
                )}
                <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: BRAND_GREEN_DEEP, display: "flex", alignItems: "center", gap: 4 }}>
                  {items.length ? "Review and tick off" : "Open"} <ArrowRight size={13} />
                </div>
              </button>
              {items.length > 0 && missing > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSetupFirst(true);
                    setOpenKey(task.key);
                  }}
                  style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderTop: "1px solid rgba(201,196,182,0.5)", background: "rgba(255,255,255,0.5)", padding: "8px 18px", fontSize: 11.5, color: "#7A5215", cursor: "pointer" }}
                >
                  {missing} active clients have no {task.label} schedule — set them up
                </button>
              )}
            </div>
          );
        })}
      </div>

      {openKey && (
        <ComplianceModal
          task={TASKS.find((t) => t.key === openKey)}
          clients={clients}
          schedules={schedules}
          startInSetup={setupFirst}
          onClose={() => setOpenKey(null)}
          onChanged={onChanged}
          onOpenClient={onOpenClient}
        />
      )}
    </>
  );
}

// ---------- The review panel ----------

const FILTERS = [
  ["action", "Needs action"],
  ["upcoming", "Upcoming"],
  ["done", "Filed"],
  ["all", "All"],
];

export function ComplianceModal({ task, clients, schedules, startInSetup, onClose, onChanged, onOpenClient }) {
  const items = useMemo(() => buildItems(task, clients, schedules), [task, clients, schedules]);
  const st = statsFor(items);
  const [filter, setFilter] = useState(st.urgent > 0 ? "action" : "all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [ask, setAsk] = useState(null); // schedule id, or "bulk"
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [undo, setUndo] = useState(null);
  const [setupOpen, setSetupOpen] = useState(!!startInSetup || items.length === 0);
  const [dueDay, setDueDay] = useState(String(task.defaultDay || 14));
  const [markEarlier, setMarkEarlier] = useState(true);
  const [creating, setCreating] = useState(null);

  const withSchedule = new Set(schedules.filter((s) => task.test.test(s.taskName || "") && s.clientStatus === "A").map((s) => s.clientId));
  const needSetup = clients.filter((c) => c.status === "A" && !withSchedule.has(c.id));

  const visible = items.filter((i) => {
    if (filter === "action" && (i.view.done || !i.view.action)) return false;
    if (filter === "upcoming" && (i.view.done || i.view.action)) return false;
    if (filter === "done" && !i.view.done) return false;
    const q = query.trim().toLowerCase();
    return !q || `${i.client.company} ${i.client.fileNo}`.toLowerCase().includes(q);
  });
  const counts = { action: st.urgent, upcoming: st.upcoming, done: st.done, all: st.total };
  const selectable = visible.filter((i) => !i.view.done);

  async function markFiled(list) {
    setBusy(true);
    setError("");
    const prev = [];
    try {
      for (let i = 0; i < list.length; i++) {
        setProgress({ i: i + 1, n: list.length });
        const s = list[i].schedule;
        prev.push({ id: s.id, last: s.lastCompletedDate || null });
        await updateSchedule(s.id, { lastCompletedDate: isoOf(new Date()) });
      }
      setUndo({ prev, text: list.length === 1 ? `${list[0].client.company} marked as filed.` : `${list.length} filings marked as filed.` });
    } catch (err) {
      setError(err.message || "Could not save — please try again.");
    } finally {
      setBusy(false);
      setProgress(null);
      setAsk(null);
      setSelected(new Set());
      if (onChanged) await onChanged();
    }
  }

  async function undoLast() {
    if (!undo) return;
    setBusy(true);
    try {
      for (const p of undo.prev) await updateSchedule(p.id, { lastCompletedDate: p.last });
      setUndo(null);
    } catch (err) {
      setError(err.message || "Could not undo.");
    } finally {
      setBusy(false);
      if (onChanged) await onChanged();
    }
  }

  async function createAll() {
    setError("");
    const day = Number(dueDay);
    if (!day || day < 1 || day > 31) {
      setError("Enter a due day between 1 and 31.");
      return;
    }
    let lastCompletedDate;
    if (markEarlier) {
      // Everything before this month's cycle counts as already filed, so only the live cycle shows up.
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate();
      lastCompletedDate = isoOf(new Date(prevMonth.getFullYear(), prevMonth.getMonth(), Math.min(day, lastDay)));
    }
    try {
      for (let i = 0; i < needSetup.length; i++) {
        setCreating({ i: i + 1, n: needSetup.length });
        await createSchedule(needSetup[i].id, { taskName: task.name, frequency: task.frequency, dueDay: day, dueMonth: task.frequency === "monthly" ? undefined : 1, lastCompletedDate });
      }
      setSetupOpen(false);
    } catch (err) {
      setError(`${err.message || "Could not create schedules"} (${creating ? creating.i - 1 : 0} were created before this.)`);
    } finally {
      setCreating(null);
      if (onChanged) await onChanged();
    }
  }

  const pill = (text, bg, fg) => <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>{text}</span>;

  function row(item) {
    const { schedule: s, client, view } = item;
    const asking = ask === s.id;
    const bg = view.done ? "#F4F9F6" : view.overdue ? "#FBEDED" : view.action ? "#FFF6E6" : "#fff";
    const edge = view.done ? "#2FA866" : view.overdue ? "#A63D40" : view.action ? "#B4791F" : "#C9C4B6";
    let when;
    if (view.done) when = pill("Filed", "#E3EFE9", "#1F4A40");
    else if (view.overdue) when = pill(`Overdue ${Math.abs(view.daysLeft)}d`, "#A63D40", "#fff");
    else if (view.daysLeft === 0) when = pill("Due today", "#B4791F", "#fff");
    else when = pill(`${view.daysLeft} day${view.daysLeft === 1 ? "" : "s"} left`, view.action ? "#B4791F" : "#ECE9E0", view.action ? "#fff" : "#4A4638");
    return (
      <div key={s.id} style={{ borderLeft: `4px solid ${edge}`, background: bg, marginBottom: 8, border: "1px solid rgba(201,196,182,0.5)", borderLeftWidth: 4, borderLeftColor: edge, animation: "fams-fade 0.25s ease-out" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", flexWrap: "wrap" }}>
          {!view.done ? (
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              disabled={busy}
              onChange={() => {
                const next = new Set(selected);
                if (next.has(s.id)) next.delete(s.id);
                else next.add(s.id);
                setSelected(next);
              }}
              style={{ width: 17, height: 17, flexShrink: 0 }}
              aria-label={`Select ${client.company}`}
            />
          ) : (
            <CheckCircle2 size={18} color="#2FA866" style={{ flexShrink: 0 }} />
          )}
          <button type="button" onClick={() => onOpenClient(client)} style={{ border: "none", background: "none", cursor: "pointer", textAlign: "left", flex: "1 1 220px", minWidth: 0, padding: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1C2430", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.company}</div>
            <div style={{ fontSize: 11, color: "#8A8577", fontFamily: "monospace" }}>{client.fileNo}</div>
          </button>
          <div style={{ fontSize: 12, color: "#4A4638", minWidth: 150 }}>
            <div style={{ fontWeight: 600 }}>{view.period}</div>
            <div style={{ color: "#8A8577", fontSize: 11 }}>due {shortDate(view.due)}</div>
          </div>
          {when}
          {!view.done && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setAsk(asking ? null : s.id)}
              style={{ border: `1px solid ${BRAND_GREEN_DEEP}`, background: asking ? BRAND_GREEN_DEEP : "#fff", color: asking ? "#EDEAE2" : BRAND_GREEN_DEEP, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer", minWidth: 92 }}
            >
              Filed?
            </button>
          )}
        </div>
        {asking && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", background: "#EEF4F1", borderTop: "1px solid rgba(201,196,182,0.5)", animation: "fams-pop 0.18s ease-out" }}>
            <div style={{ fontSize: 13, color: "#1C2430", flex: "1 1 260px" }}>
              Has <b>{task.label}</b> for <b>{view.period}</b> been filed for <b>{client.company}</b>?
            </div>
            <button type="button" disabled={busy} onClick={() => markFiled([item])} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "8px 18px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
              {busy && <Spinner size={13} color="#EDEAE2" />} Yes, filed
            </button>
            <button type="button" disabled={busy} onClick={() => setAsk(null)} style={{ background: "#fff", border: "1px solid #C9C4B6", padding: "8px 16px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
              Not yet
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 56, background: "rgba(28,36,48,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 900, maxWidth: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column", background: "#FBFAF6", boxShadow: "0 24px 64px rgba(0,0,0,0.35)", animation: "fams-pop 0.22s ease-out" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid #E5E1D5" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700 }}>{task.label} filings</div>
                {st.urgent > 0 ? (
                  <span style={{ background: "#A63D40", color: "#fff", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, padding: "5px 10px", borderRadius: 999, animation: "fams-pulse 1.8s infinite" }}>ACTION NEEDED · {st.urgent}</span>
                ) : (
                  items.length > 0 && <span style={{ background: "#E3EFE9", color: "#1F4A40", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, padding: "5px 10px", borderRadius: 999 }}>ALL ON TRACK</span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: "#6B6656", marginTop: 4 }}>
                {st.done} of {st.total} filed this cycle · {st.overdue} overdue · {st.dueSoon} due within {ACTION_DAYS} days · {st.upcoming} upcoming
              </div>
            </div>
            <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", flexShrink: 0 }} aria-label="Close">
              <X size={20} />
            </button>
          </div>

          {items.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 14 }}>
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  style={{ border: "1px solid #C9C4B6", padding: "6px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", background: filter === key ? BRAND_GREEN_DEEP : "#fff", color: filter === key ? "#EDEAE2" : "#1C2430" }}
                >
                  {label} ({counts[key]})
                </button>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #C9C4B6", padding: "6px 10px", flex: "1 1 180px", minWidth: 160 }}>
                <Search size={13} color="#8A8577" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies…" style={{ border: "none", outline: "none", flex: 1, fontSize: 12.5, background: "transparent" }} />
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: "16px 24px", overflowY: "auto", flex: 1 }}>
          {error && <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{error}</div>}

          {(setupOpen || items.length === 0) && (
            <div style={{ border: "1px solid #C9C4B6", background: "#fff", padding: "16px 18px", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Set up {task.label} for your clients</div>
              {needSetup.length === 0 ? (
                <div style={{ fontSize: 13, color: "#6B6656" }}>Every active client already has a {task.label} schedule.</div>
              ) : task.key === "cpf" ? (
                <>
                  <div style={{ fontSize: 13, color: "#4A4638", lineHeight: 1.5, marginBottom: 12 }}>
                    <b>{needSetup.length}</b> active clients have no CPF schedule. This adds a monthly one to each, so they all appear here. CPF is normally due on the 14th of the following month.
                  </div>
                  <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ fontSize: 12.5, fontWeight: 600 }}>
                      Due day of the month{" "}
                      <input type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} style={{ width: 64, border: "1px solid #C9C4B6", padding: "6px 8px", marginLeft: 6 }} />
                    </label>
                    <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={markEarlier} onChange={(e) => setMarkEarlier(e.target.checked)} /> Treat earlier months as already filed
                    </label>
                    <button type="button" disabled={!!creating} onClick={createAll} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 18px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                      {creating && <Spinner size={14} color="#EDEAE2" />}
                      {creating ? `Creating ${creating.i} of ${creating.n}…` : `Create for ${needSetup.length} clients`}
                    </button>
                    {items.length > 0 && !creating && (
                      <button type="button" onClick={() => setSetupOpen(false)} style={{ border: "none", background: "none", cursor: "pointer", color: "#6B6656", fontSize: 12 }}>
                        Not now
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: "#4A4638", lineHeight: 1.5 }}>
                  GST quarters differ from client to client (IRAS assigns each company its own), so they&apos;re set per client: open a client and add a <b>GST Filing</b> under <b>Recurring filings</b>, choosing the month its return falls due. <b>{needSetup.length}</b> active clients have no GST schedule yet.
                  {items.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <button type="button" onClick={() => setSetupOpen(false)} style={{ border: "none", background: "none", cursor: "pointer", color: "#6B6656", fontSize: 12, padding: 0 }}>Close this note</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {items.length > 0 && !setupOpen && needSetup.length > 0 && (
            <button type="button" onClick={() => setSetupOpen(true)} style={{ border: "none", background: "none", cursor: "pointer", color: "#7A5215", fontSize: 12, fontWeight: 600, marginBottom: 12, padding: 0 }}>
              {needSetup.length} active clients have no {task.label} schedule — set them up
            </button>
          )}

          {items.length > 0 && visible.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#6B6656", fontSize: 14 }}>
              {filter === "action" ? (
                <>
                  <CheckCircle2 size={34} color="#2FA866" />
                  <div style={{ marginTop: 10, fontWeight: 700, color: "#1F4A40" }}>Nothing needs action</div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>No {task.label} filing is overdue or due within {ACTION_DAYS} days.</div>
                </>
              ) : (
                "No companies match."
              )}
            </div>
          )}

          {selectable.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, fontSize: 12.5, color: "#4A4638", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={selectable.every((i) => selected.has(i.schedule.id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((i) => i.schedule.id)) : new Set())}
                />
                Select all {selectable.length} shown
              </label>
              {selected.size > 0 && (
                <button type="button" disabled={busy} onClick={() => setAsk("bulk")} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "7px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  Mark {selected.size} as filed…
                </button>
              )}
            </div>
          )}

          {ask === "bulk" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 14px", background: "#EEF4F1", border: "1px solid #C9D9D0", marginBottom: 12, animation: "fams-pop 0.18s ease-out" }}>
              <div style={{ fontSize: 13, flex: "1 1 280px" }}>
                Have the <b>{task.label}</b> filings for these <b>{selected.size}</b> companies all been filed?
              </div>
              <button type="button" disabled={busy} onClick={() => markFiled(items.filter((i) => selected.has(i.schedule.id)))} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "8px 18px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                {busy && <Spinner size={13} color="#EDEAE2" />}
                {progress ? `Saving ${progress.i} of ${progress.n}…` : "Yes, all filed"}
              </button>
              <button type="button" disabled={busy} onClick={() => setAsk(null)} style={{ background: "#fff", border: "1px solid #C9C4B6", padding: "8px 16px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
                Not yet
              </button>
            </div>
          )}

          {visible.map(row)}
        </div>

        {/* Undo bar */}
        {undo && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 24px", background: "#1C2430", color: "#EDEAE2", fontSize: 13, animation: "fams-fade 0.2s ease-out" }}>
            <CheckCircle2 size={16} color="#2FA866" />
            <span style={{ flex: 1 }}>{undo.text}</span>
            <button type="button" disabled={busy} onClick={undoLast} style={{ border: "1px solid #6B7280", background: "transparent", color: "#EDEAE2", padding: "5px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              {busy && <Spinner size={12} color="#EDEAE2" />} Undo
            </button>
            <button type="button" onClick={() => setUndo(null)} style={{ border: "none", background: "none", color: "#A8AFBA", cursor: "pointer" }} aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
