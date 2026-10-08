import React, { useState, useEffect } from "react";
import { Download, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { BRAND_GREEN_DEEP } from "./theme.jsx";

// In-app update flow, driven by the Electron updater through window.famsUpdater
// (see electron/preload.js). In a plain browser that bridge doesn't exist and
// this renders nothing.
//
//   update found -> small notice -> "Review" -> summary + Confirm
//   -> download progress -> app closes itself -> user reopens + logs in
//   -> one-time "What's new" popup
export default function UpdateManager() {
  const bridge = typeof window !== "undefined" ? window.famsUpdater : undefined;
  const [state, setState] = useState(null);
  const [step, setStep] = useState("notice"); // notice | review | hidden
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!bridge) return undefined;
    bridge.getState().then(setState).catch(() => {});
    return bridge.onState(setState);
  }, [bridge]);

  // Once the user has confirmed and the download finishes, close the app so the installer can run.
  useEffect(() => {
    if (!bridge || !confirmed || state?.status !== "downloaded") return undefined;
    const t = setTimeout(() => bridge.install(), 2500);
    return () => clearTimeout(t);
  }, [bridge, confirmed, state?.status]);

  if (!bridge || !state) return null;

  const overlay = {
    position: "fixed",
    inset: 0,
    zIndex: 80,
    background: "rgba(28,36,48,0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  };
  const card = { width: 460, maxWidth: "100%", background: "#FBFAF6", padding: 24, boxShadow: "0 24px 64px rgba(0,0,0,0.35)" };
  const title = { fontFamily: "'Fraunces', Georgia, serif", fontSize: 18, fontWeight: 700, marginBottom: 6 };
  const notesBox = {
    background: "#fff",
    border: "1px solid #C9C4B6",
    padding: "10px 12px",
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "#1C2430",
    whiteSpace: "pre-wrap",
    maxHeight: 220,
    overflowY: "auto",
    margin: "12px 0 16px",
  };
  const primaryBtn = {
    flex: 1,
    background: BRAND_GREEN_DEEP,
    color: "#EDEAE2",
    border: "none",
    padding: "10px 16px",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  };
  const secondaryBtn = { border: "1px solid #C9C4B6", background: "none", padding: "10px 14px", fontSize: 13, cursor: "pointer" };

  // 1) Right after an update was installed — shown once, after login (this
  //    component is only mounted for a logged-in user).
  if (state.whatsNew) {
    return (
      <div style={overlay}>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle2 size={20} color="#2F6F62" />
            <div style={title}>Updated to version {state.whatsNew.version}</div>
          </div>
          <div style={{ fontSize: 12, color: "#8A8577" }}>Here's what's new:</div>
          <div style={notesBox}>{state.whatsNew.notes}</div>
          <button type="button" onClick={() => bridge.ackWhatsNew()} style={{ ...primaryBtn, width: "100%" }}>
            Got it
          </button>
        </div>
      </div>
    );
  }

  // 2) Download in progress / installing — blocks interaction so nothing is mid-edit when the app closes.
  if (confirmed && (state.status === "downloading" || state.status === "downloaded")) {
    const done = state.status === "downloaded";
    return (
      <div style={overlay}>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {done ? <CheckCircle2 size={20} color="#2F6F62" /> : <Loader2 size={20} style={{ animation: "fams-spin 1s linear infinite" }} />}
            <div style={title}>{done ? "Installing update…" : `Downloading version ${state.version}…`}</div>
          </div>
          <style>{"@keyframes fams-spin { to { transform: rotate(360deg); } }"}</style>
          {done ? (
            <div style={{ fontSize: 13, color: "#4A4638", marginTop: 8, lineHeight: 1.5 }}>
              The app is closing to finish the update. Please <strong>reopen it and log in</strong> in a moment.
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ height: 8, background: "#E5E1D5" }}>
                <div style={{ height: 8, width: `${state.percent}%`, background: BRAND_GREEN_DEEP, transition: "width 0.2s" }} />
              </div>
              <div style={{ fontSize: 12, color: "#8A8577", marginTop: 6 }}>{state.percent}% — please keep the app open.</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 3) Something went wrong during the update.
  if (confirmed && state.status === "error") {
    return (
      <div style={overlay}>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertCircle size={20} color="#A63D40" />
            <div style={title}>Update didn't finish</div>
          </div>
          <div style={{ fontSize: 13, color: "#4A4638", margin: "8px 0 16px" }}>{state.error}</div>
          <button type="button" onClick={() => setConfirmed(false)} style={{ ...primaryBtn, width: "100%" }}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (state.status !== "available" || step === "hidden") return null;

  // 4) Summary + confirmation.
  if (step === "review") {
    return (
      <div style={overlay}>
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={title}>Update to version {state.version}</div>
            <button type="button" onClick={() => setStep("hidden")} style={{ border: "none", background: "none", cursor: "pointer" }} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#8A8577" }}>What's in this update:</div>
          <div style={notesBox}>{state.notes}</div>
          <div style={{ fontSize: 12, color: "#8A8577", marginBottom: 14, lineHeight: 1.5 }}>
            Your data stays on this computer. The app will download the update, then close — reopen it and log in again to finish.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setStep("hidden")} style={secondaryBtn}>
              Not now
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmed(true);
                bridge.download();
              }}
              style={primaryBtn}
            >
              Confirm update
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 5) Small notice in the corner.
  return (
    <div
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 80,
        width: 300,
        background: "#FBFAF6",
        border: "1px solid #C9C4B6",
        boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13.5, color: "#1C2430" }}>
        <Download size={16} color={BRAND_GREEN_DEEP} /> Update available
      </div>
      <div style={{ fontSize: 12, color: "#4A4638", margin: "6px 0 12px" }}>Version {state.version} is ready to install.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => setStep("hidden")} style={{ ...secondaryBtn, padding: "8px 12px", fontSize: 12 }}>
          Later
        </button>
        <button type="button" onClick={() => setStep("review")} style={{ ...primaryBtn, padding: "8px 12px", fontSize: 12 }}>
          Review update
        </button>
      </div>
    </div>
  );
}
