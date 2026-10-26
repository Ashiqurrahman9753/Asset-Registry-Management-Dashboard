import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, User } from "lucide-react";
import BackButton from "./Back.jsx";
import { fetchMyProfile, saveMyProfile } from "./api.js";
import { Spinner } from "./Loading.jsx";
import { BRAND_GREEN_BRIGHT, BRAND_GREEN_DEEP, glassPanel } from "./theme.jsx";

// A dropdown for the top bar: a button that opens a short list. Used for "More" and for the
// compact menu that holds every tab.
export function NavDropdown({ label, active, items, onPick, icon, strong }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function away(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function key(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          padding: "8px 14px",
          background: strong ? "rgba(255,255,255,0.6)" : "none",
          border: strong ? "1px solid #C9C4B6" : "none",
          borderBottom: strong ? "1px solid #C9C4B6" : active ? `2px solid ${BRAND_GREEN_BRIGHT}` : "2px solid transparent",
          color: active ? BRAND_GREEN_DEEP : "#4A4638",
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
        {icon}
        {label}
        <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div
          role="menu"
          style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 200, ...glassPanel(0.96, 16), boxShadow: "0 12px 28px rgba(0,0,0,0.25)", zIndex: 40, animation: "fams-fade 0.15s ease-out" }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(it.key);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                border: "none",
                background: it.active ? "rgba(47,168,102,0.12)" : "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: it.active ? 700 : 500,
                color: "#1C2430",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {it.icon}
                {it.label}
              </span>
              {it.badge ? (
                <span style={{ background: "#A63D40", color: "#fff", fontSize: 10, fontWeight: 800, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{it.badge}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// "My profile": the signed-in person's own display name, job title and phone.
export function ProfileModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyProfile()
      .then((p) => {
        if (!cancelled) setForm({ fullName: p.fullName || "", jobTitle: p.jobTitle || "", phone: p.phone || "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || "Could not load your profile");
          setForm({ fullName: "", jobTitle: "", phone: "" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(ev) {
    ev.preventDefault();
    setBusy(true);
    setError("");
    setDone(false);
    try {
      const saved = await saveMyProfile(form);
      setDone(true);
      if (onSaved) onSaved(saved);
    } catch (err) {
      setError(err.message || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const input = { border: "1px solid #C9C4B6", background: "#fff", padding: "9px 11px", fontSize: 13.5, width: "100%", boxSizing: "border-box" };
  const label = { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(28,36,48,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ ...glassPanel(0.97, 18), padding: "22px 26px", width: 400, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BackButton onClick={onClose} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>My profile</div>
            <div style={{ fontSize: 12, color: "#8A8577" }}>
              Signed in as <b>{user.username}</b> ({user.role})
            </div>
          </div>
        </div>
        {form === null ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A8577", fontSize: 13 }}>
            <Spinner size={16} /> Loading…
          </div>
        ) : (
          <>
            <label style={label}>
              Full name
              <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} style={input} placeholder="Shown in the top bar" autoFocus />
            </label>
            <label style={label}>
              Job title
              <input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} style={input} />
            </label>
            <label style={label}>
              Phone
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={input} placeholder="e.g. +65 9123 4567" />
            </label>
          </>
        )}
        {error && <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>{error}</div>}
        {done && <div style={{ background: "#C9F2DA", color: "#0F3D24", padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>Saved.</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} style={{ border: "1px solid #C9C4B6", background: "#fff", padding: "9px 16px", fontSize: 13, cursor: "pointer" }}>
            Close
          </button>
          <button type="submit" disabled={busy || form === null} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 18px", fontWeight: 600, fontSize: 13, cursor: busy ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
            {busy && <Spinner size={13} color="#fff" />} Save
          </button>
        </div>
      </form>
    </div>
  );
}

// The little user icon and name that sits at the right of the top bar.
export function UserLabel({ user, profileName }) {
  return (
    <>
      <User size={14} /> {profileName || user.username}
      {profileName ? "" : ` (${user.role})`}
    </>
  );
}
