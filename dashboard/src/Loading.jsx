import React from "react";

// Shared loading indicators, so anything that takes a moment to appear shows
// that it's working instead of looking frozen: a spinner, a labelled panel,
// shimmering placeholder blocks, and a slim progress bar for the top of the screen.

const CSS = `
@keyframes fams-spin { to { transform: rotate(360deg); } }
@keyframes fams-shimmer { 0% { background-position: -420px 0; } 100% { background-position: 420px 0; } }
@keyframes fams-pulse { 0% { box-shadow: 0 0 0 0 rgba(166,61,64,0.5); } 70% { box-shadow: 0 0 0 9px rgba(166,61,64,0); } 100% { box-shadow: 0 0 0 0 rgba(166,61,64,0); } }
@keyframes fams-bar { 0% { left: -40%; } 100% { left: 100%; } }
@keyframes fams-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes fams-pop { from { opacity: 0; transform: scale(0.975); } to { opacity: 1; transform: none; } }
`;

if (typeof document !== "undefined" && !document.getElementById("fams-anim")) {
  const style = document.createElement("style");
  style.id = "fams-anim";
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function Spinner({ size = 18, color = "#1F4A40", thickness = 2.6, style }) {
  const r = (size - thickness) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="status" aria-label="Loading" style={{ animation: "fams-spin 0.8s linear infinite", flexShrink: 0, ...style }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity="0.18" strokeWidth={thickness} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" strokeDasharray={`${r * 1.6} ${r * 6.28}`} />
    </svg>
  );
}

// A centred spinner with a short label, for a panel or section that's still loading.
export function LoadingPanel({ label = "Loading…", minHeight = 160, color }) {
  return (
    <div style={{ minHeight, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#6B6656", fontSize: 13 }}>
      <Spinner size={30} color={color} />
      <div>{label}</div>
    </div>
  );
}

// Shimmering placeholder block — shown where content will appear.
export function Skeleton({ width = "100%", height = 14, radius = 3, style }) {
  return (
    <div
      aria-hidden
      style={{
        width,
        height,
        borderRadius: radius,
        background: "linear-gradient(90deg, #E9E5D8 0%, #F6F3EA 40%, #E9E5D8 80%)",
        backgroundSize: "840px 100%",
        animation: "fams-shimmer 1.3s linear infinite",
        ...style,
      }}
    />
  );
}

// Slim indeterminate bar pinned to the top of the window while something refreshes in the background.
export function TopBar({ active }) {
  if (!active) return null;
  return (
    <div aria-hidden style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 100, overflow: "hidden", background: "rgba(31,74,64,0.12)" }}>
      <div style={{ position: "absolute", top: 0, height: 3, width: "40%", background: "linear-gradient(90deg, #2FA866, #1B3F2A)", animation: "fams-bar 1.1s ease-in-out infinite" }} />
    </div>
  );
}
