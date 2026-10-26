import React, { useState, useRef, useEffect } from "react";
import { BRAND_GREEN_DEEP } from "./theme.jsx";

// A small ⓘ icon that explains a complex button or screen on hover (or on click / keyboard focus).
// Keeps the page itself free of explanatory text.
export default function InfoTip({ text, align = "right", size = 16 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function away(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <span
      ref={ref}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", verticalAlign: "middle", flexShrink: 0 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="More information"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          border: `1.5px solid ${open ? BRAND_GREEN_DEEP : "#8A8577"}`,
          background: open ? BRAND_GREEN_DEEP : "transparent",
          color: open ? "#EDEAE2" : "#6B6656",
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
          fontWeight: 700,
          fontSize: size - 6,
          lineHeight: 1,
          padding: 0,
          cursor: "help",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .12s, color .12s, border-color .12s",
        }}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: size + 6,
            [align === "left" ? "left" : "right"]: -4,
            width: 270,
            maxWidth: "70vw",
            background: "#1C2430",
            color: "#EDEAE2",
            fontFamily: "'Public Sans', system-ui, sans-serif",
            fontStyle: "normal",
            fontWeight: 400,
            fontSize: 12,
            lineHeight: 1.5,
            textTransform: "none",
            letterSpacing: 0,
            textAlign: "left",
            padding: "9px 12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
            zIndex: 80,
            animation: "fams-fade 0.15s ease-out",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
