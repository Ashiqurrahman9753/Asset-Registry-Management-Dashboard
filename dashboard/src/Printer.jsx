import React, { useState, useEffect } from "react";
import { Printer as PrinterIcon, RefreshCw } from "lucide-react";
import BackButton from "./Back.jsx";
import InfoTip from "./InfoTip.jsx";
import { Spinner } from "./Loading.jsx";
import { fetchPrinters, fetchPrinterSettings, savePrinterSettings, printTestLabel } from "./api.js";
import { BRAND_GREEN_DEEP, glassPanel } from "./theme.jsx";

// Printer settings: which label printer this computer uses, and the size of the labels loaded.
// Works on any computer, because the list comes from the printers that computer has installed.

const SIZES = [
  { key: "60x40", label: "60 × 40 mm", w: 60, h: 40 },
  { key: "50x30", label: "50 × 30 mm", w: 50, h: 30 },
  { key: "40x30", label: "40 × 30 mm", w: 40, h: 30 },
  { key: "custom", label: "Other size…" },
];

export default function PrinterSettingsModal({ onClose }) {
  const [printers, setPrinters] = useState(null);
  const [form, setForm] = useState(null);
  const [auto, setAuto] = useState({ effective: "", problem: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [custom, setCustom] = useState(false);

  async function load() {
    setError("");
    try {
      const [list, cfg] = await Promise.all([fetchPrinters().catch((err) => { setError(err.message); return []; }), fetchPrinterSettings()]);
      setPrinters(list);
      setForm({ printer: cfg.printer || "", widthMm: cfg.widthMm, heightMm: cfg.heightMm, gapMm: cfg.gapMm, topMm: cfg.topMm });
      setAuto({ effective: cfg.effectivePrinter || "", problem: cfg.problem || "" });
      setCustom(!SIZES.some((s) => s.w === cfg.widthMm && s.h === cfg.heightMm));
    } catch (err) {
      setError(err.message || "Could not load the printer settings");
      setPrinters([]);
      setForm({ printer: "", widthMm: 60, heightMm: 40, gapMm: 2, topMm: 2.5 });
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setBusy("save");
    setError("");
    setNotice("");
    try {
      await savePrinterSettings(form);
      await load();
      setNotice("Saved.");
      return true;
    } catch (err) {
      setError(err.message || "Could not save");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function test() {
    if (!(await save())) return;
    setBusy("test");
    setError("");
    setNotice("");
    try {
      const out = await printTestLabel();
      setNotice(`Test label sent to ${out.printer}. Check that it printed fully and the QR is sharp.`);
    } catch (err) {
      setError(err.message || "Test print failed");
    } finally {
      setBusy("");
    }
  }

  const sizeKey = custom ? "custom" : (SIZES.find((s) => s.w === form?.widthMm && s.h === form?.heightMm) || {}).key || "custom";
  const field = { border: "1px solid #C9C4B6", background: "#fff", padding: "9px 11px", fontSize: 13.5, boxSizing: "border-box" };
  const label = { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#4A4638" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(28,36,48,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...glassPanel(0.97, 18), padding: "22px 26px", width: 460, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BackButton onClick={onClose} />
          <div style={{ fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            Printer settings
            <InfoTip align="left" text="Choose the label printer connected to this computer and the size of the labels loaded in it. Each computer keeps its own choice. Use Print test label to check the printer and alignment before real use." />
          </div>
        </div>

        {form === null ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A8577", fontSize: 13 }}>
            <Spinner size={16} /> Looking for printers…
          </div>
        ) : (
          <>
            <label style={label}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                Label printer
                <button type="button" onClick={load} title="Look for printers again" style={{ border: "none", background: "none", cursor: "pointer", color: "#4A4638", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5 }}>
                  <RefreshCw size={12} /> Refresh
                </button>
              </span>
              <select value={form.printer} onChange={(e) => setForm({ ...form, printer: e.target.value })} style={field}>
                <option value="">Choose automatically{auto.effective ? ` (${auto.effective})` : ""}</option>
                {(printers || []).map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                    {p.looksLikeLabelPrinter ? "  ·  label printer" : ""}
                  </option>
                ))}
              </select>
            </label>
            {!form.printer && auto.problem && <div style={{ background: "#FBF1E0", color: "#7A5215", padding: "8px 12px", fontSize: 12.5, fontWeight: 600 }}>{auto.problem}</div>}

            <label style={label}>
              Label size
              <select
                value={sizeKey}
                onChange={(e) => {
                  const s = SIZES.find((x) => x.key === e.target.value);
                  if (s && s.w) {
                    setCustom(false);
                    setForm({ ...form, widthMm: s.w, heightMm: s.h });
                  } else setCustom(true);
                }}
                style={field}
              >
                {SIZES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
            <label style={label}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                Top margin (mm)
                <InfoTip align="left" text="Space left blank at the top of every label. Increase it if the first line touches the top edge, decrease it if the bottom is cut off." />
              </span>
              <input type="number" min="0" max="8" step="0.5" value={form.topMm} onChange={(e) => setForm({ ...form, topMm: Number(e.target.value) })} style={{ ...field, width: 120 }} />
            </label>
            {custom && (
              <div style={{ display: "flex", gap: 10 }}>
                <label style={{ ...label, flex: 1 }}>
                  Width (mm)
                  <input type="number" min="20" max="120" value={form.widthMm} onChange={(e) => setForm({ ...form, widthMm: Number(e.target.value) })} style={field} />
                </label>
                <label style={{ ...label, flex: 1 }}>
                  Height (mm)
                  <input type="number" min="15" max="200" value={form.heightMm} onChange={(e) => setForm({ ...form, heightMm: Number(e.target.value) })} style={field} />
                </label>
                <label style={{ ...label, flex: 1 }}>
                  Gap (mm)
                  <input type="number" min="0" max="10" value={form.gapMm} onChange={(e) => setForm({ ...form, gapMm: Number(e.target.value) })} style={field} />
                </label>
              </div>
            )}
          </>
        )}

        {error && <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12.5, fontWeight: 600 }}>{error}</div>}
        {notice && <div style={{ background: "#C9F2DA", color: "#0F3D24", padding: "8px 12px", fontSize: 12.5, fontWeight: 600 }}>{notice}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button type="button" disabled={!form || !!busy} onClick={test} style={{ border: `1px solid ${BRAND_GREEN_DEEP}`, background: "#fff", color: BRAND_GREEN_DEEP, padding: "9px 16px", fontWeight: 600, fontSize: 13, cursor: busy ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
            {busy === "test" ? <Spinner size={13} /> : <PrinterIcon size={14} />} Print test label
          </button>
          <button type="button" disabled={!form || !!busy} onClick={save} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "9px 18px", fontWeight: 600, fontSize: 13, cursor: busy ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
            {busy === "save" && <Spinner size={13} color="#fff" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
