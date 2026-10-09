import React, { useState, useEffect } from "react";
import { BRAND_GREEN_BRIGHT, BRAND_GREEN_DEEP } from "./theme.jsx";

// A live clock that ticks every second: a large one for the sign-in page and a small
// one for the dashboard header. It shows the computer's own time.

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const pad = (n) => String(n).padStart(2, "0");

function greeting(hour) {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function zoneName() {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    return part ? part.value : "";
  } catch {
    return "";
  }
}

// A thin ring that fills as the seconds go by.
function SecondsRing({ seconds, size, stroke, track = "rgba(28,36,48,0.12)" }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", flexShrink: 0 }} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={BRAND_GREEN_BRIGHT}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - (seconds + 1) / 60)}
        style={{ transition: "stroke-dashoffset 0.9s linear" }}
      />
    </svg>
  );
}

export function LiveClock({ variant = "compact" }) {
  const now = useNow();
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const label = `${pad(h)}:${pad(m)}:${pad(s)}, ${date}`;

  if (variant === "hero") {
    return (
      <div role="timer" aria-label={label} style={{ textAlign: "center", position: "relative", zIndex: 1, marginBottom: 22, animation: "fams-fade 0.5s ease-out" }}>
        <div style={{ fontSize: 12, letterSpacing: 2.4, textTransform: "uppercase", color: "#4A4638", fontWeight: 600, marginBottom: 6 }}>{greeting(h)}</div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 18 }}>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 64, fontWeight: 600, color: "#1C2430", lineHeight: 1, letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>
            {pad(h)}
            <span style={{ color: BRAND_GREEN_BRIGHT, opacity: s % 2 === 0 ? 1 : 0.25, transition: "opacity 0.4s" }}>:</span>
            {pad(m)}
          </div>
          <div style={{ position: "relative", width: 54, height: 54, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "absolute", inset: 0 }}>
              <SecondsRing seconds={s} size={54} stroke={3} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: BRAND_GREEN_DEEP, fontVariantNumeric: "tabular-nums" }}>{pad(s)}</div>
          </div>
        </div>
        <div style={{ fontSize: 13.5, color: "#4A4638", marginTop: 8 }}>
          {date}
          {zoneName() && <span style={{ color: "#8A8577" }}> · {zoneName()}</span>}
        </div>
      </div>
    );
  }

  return (
    <div
      role="timer"
      aria-label={label}
      title={`${date}${zoneName() ? ` · ${zoneName()}` : ""}`}
      style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 12px 5px 7px", border: "1px solid rgba(201,196,182,0.8)", background: "rgba(255,255,255,0.55)", borderRadius: 999, flexShrink: 0 }}
    >
      <div style={{ position: "relative", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", inset: 0 }}>
          <SecondsRing seconds={s} size={30} stroke={2.4} />
        </div>
        <div style={{ width: 6, height: 6, borderRadius: 999, background: BRAND_GREEN_BRIGHT, opacity: s % 2 === 0 ? 1 : 0.35, transition: "opacity 0.4s" }} />
      </div>
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 700, color: "#1C2430", fontVariantNumeric: "tabular-nums" }}>
          {pad(h)}:{pad(m)}
          <span style={{ fontSize: 11, color: BRAND_GREEN_DEEP, marginLeft: 3, fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 600 }}>{pad(s)}</span>
        </div>
        <div style={{ fontSize: 10.5, color: "#6B6656", letterSpacing: 0.3 }}>
          {now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
        </div>
      </div>
    </div>
  );
}
