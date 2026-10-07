import React from "react";

// Drop the actual logo file at dashboard/public/jardeen-logo.png — every
// reference to it (wallpaper, login mark, header mark) picks it up
// automatically once it exists; until then the <img> tags hide themselves
// via onError and the wallpaper just shows the cream gradient underneath.
export const LOGO_URL = "/jardeen-logo.png";

// Sampled from the logo mark itself — the app's primary accent, replacing
// the old neutral gold everywhere it was doing structural work (buttons,
// active tab, links, borders).
export const BRAND_GREEN = "#275A3C";
export const BRAND_GREEN_DEEP = "#1B3F2A";
// A more saturated, lighter step of the same hue — used only for things
// that need to actively pop (the Active status badge, the current page,
// hovered tiles, the selected tab) rather than baseline UI color.
export const BRAND_GREEN_BRIGHT = "#2FA866";
// For highlighted info boxes that carry real text/links (success banners,
// the person-in-charge card) — brighter and more saturated than a standard
// pastel chip, but still light enough to keep long text readable.
export const HIGHLIGHT_BG = "#C9F2DA";
export const HIGHLIGHT_TEXT = "#0F3D24";

// Fixed, full-viewport backdrop: the logo blurred and mostly washed out by
// a cream scrim so it reads as texture, not a competing image, behind the
// glass panels everywhere in the app (including the login screen).
export function Wallpaper() {
  return (
    <>
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          backgroundImage: `url(${LOGO_URL})`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center 48%",
          backgroundSize: "min(62vw, 900px) auto",
          filter: "blur(7.7px)",
          opacity: 0.5,
          transform: "scale(1.05)",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          background:
            "linear-gradient(180deg, rgba(237,234,226,0.55) 0%, rgba(237,234,226,0.6) 100%), radial-gradient(circle at 50% 40%, rgba(255,255,255,0.12), transparent 65%)",
        }}
      />
    </>
  );
}

// Light glass surface — cards, panels, tiles, table containers.
// backdrop-filter: blur() is intentionally not used here (or anywhere else
// in the app — see every modal overlay too). It's a known source of
// Chromium GPU-compositor instability on some Windows driver combinations;
// confirmed on a real client machine as the cause of both a GPU-process
// freeze and, after disabling hardware acceleration to fix that, a
// different failure where panels stopped dimming/obscuring the content
// behind them at all (backdrop-filter silently not compositing under
// software rendering). A plain semi-opaque background has no such
// dependency — it works the same regardless of GPU/driver/acceleration
// state, at the cost of the frosted-glass blur look.
export function glassPanel(opacity = 0.62) {
  return {
    background: `rgba(251,250,246,${opacity})`,
    border: "1px solid rgba(201,196,182,0.55)",
    boxShadow: "0 8px 28px rgba(28,36,48,0.09)",
  };
}

// Dark glass surface — header bar, dark UI chrome.
export function glassDark(opacity = 0.62) {
  return {
    background: `rgba(28,36,48,${opacity})`,
    border: "1px solid rgba(255,255,255,0.08)",
  };
}
