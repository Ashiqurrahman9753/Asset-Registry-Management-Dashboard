import React, { useState, useEffect, useRef } from "react";
import { BRAND_GREEN_DEEP } from "./theme.jsx";

// Pieces shared by the customer-facing onboarding forms (KYC, PEP declaration):
// the full-screen shell, form field helpers, and the signature area where the
// customer chooses to sign on the screen or by hand on a printed copy.

export const FIRM_NAME = "Jardeen Management";

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const bigInput = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #8A8577",
  background: "#fff",
  padding: "13px 14px",
  fontSize: 18,
  fontFamily: "inherit",
  color: "#1C2430",
};
export const sectionBox = { background: "#fff", border: "1px solid #C9C4B6", padding: "18px 20px", marginBottom: 16 };

// Plain functions that return JSX (called like fieldBlock(...)), not components, so a
// text box inside one never loses its cursor when the form re-renders.
export function fieldBlock(label, node, { required, hint } = {}) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#1C2430", marginBottom: 5 }}>
        {label}
        {required && <span style={{ color: "#A63D40" }}> *</span>}
      </div>
      {node}
      {hint && <div style={{ fontSize: 13, color: "#8A8577", marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

export function sectionHeading(n, title) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>{n}</span>
      <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 700 }}>{title}</span>
    </div>
  );
}

export function Shell({ children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 58, background: "#F3F0E6", overflowY: "auto" }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "26px 20px 60px", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>{children}</div>
    </div>
  );
}

// ---------- Signature pad ----------

const PAD_W = 700;
const PAD_H = 220;

export function SignaturePad({ onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = PAD_W * dpr;
    canvas.height = PAD_H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    ctx.fillStyle = "#111";
  }, []);

  function point(e) {
    const r = ref.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * PAD_W) / r.width, y: ((e.clientY - r.top) * PAD_H) / r.height };
  }
  function down(e) {
    e.preventDefault();
    if (ref.current.setPointerCapture) ref.current.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    last.current = p;
    const ctx = ref.current.getContext("2d");
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const p = point(e);
    const ctx = ref.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    setHasInk(true);
    onChange(ref.current.toDataURL("image/png"));
  }
  function clear() {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasInk(false);
    onChange("");
  }

  return (
    <div>
      <div style={{ border: "2px dashed #8A8577", background: "#fff", position: "relative", maxWidth: PAD_W }}>
        <canvas
          ref={ref}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          style={{ display: "block", width: "100%", aspectRatio: `${PAD_W} / ${PAD_H}`, touchAction: "none", cursor: "crosshair" }}
        />
        {!hasInk && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#B0AA9A", fontSize: 18, pointerEvents: "none" }}>
            Sign here with your finger, pen or mouse
          </div>
        )}
      </div>
      <button type="button" onClick={clear} style={{ marginTop: 8, border: "1px solid #C9C4B6", background: "#fff", padding: "8px 16px", fontSize: 14, cursor: "pointer" }}>
        Clear and sign again
      </button>
    </div>
  );
}

// The signature part of a form: sign on this screen, or sign by hand on a printed copy.
export function SignatureChoice({ method, onMethod, onSignature }) {
  const option = (value, title, detail) => (
    <label
      key={value}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        marginBottom: 8,
        border: method === value ? "2px solid #1F4A40" : "1px solid #C9C4B6",
        background: method === value ? "#EEF4F1" : "#fff",
        cursor: "pointer",
      }}
    >
      <input type="radio" name="signature-method" checked={method === value} onChange={() => onMethod(value)} style={{ marginTop: 4, width: 20, height: 20 }} />
      <span>
        <span style={{ display: "block", fontSize: 17, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", fontSize: 14, color: "#6B6656", marginTop: 2 }}>{detail}</span>
      </span>
    </label>
  );
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#1C2430", marginBottom: 8 }}>
        How would you like to sign? <span style={{ color: "#A63D40" }}>*</span>
      </div>
      {option("screen", "Sign on this screen", "Draw your signature below with your finger, a pen or the mouse.")}
      {option("paper", "Print and sign by hand", "A member of staff will print your completed form for you to sign with a pen.")}
      {method === "screen" && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1C2430", marginBottom: 6 }}>
            Your signature <span style={{ color: "#A63D40" }}>*</span>
          </div>
          <SignaturePad onChange={onSignature} />
        </div>
      )}
      {method === "paper" && (
        <div style={{ marginTop: 10, fontSize: 14, color: "#4A4638", background: "#FBF1E0", padding: "10px 14px", lineHeight: 1.5 }}>
          Your form isn&apos;t finished until you&apos;ve signed the printed copy. Please wait for the staff member to bring it to you.
        </div>
      )}
    </div>
  );
}
