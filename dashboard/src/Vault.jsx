import React, { useState, useEffect, useRef, useMemo } from "react";
import { X, Download, ArrowLeft, ArrowRight, Upload, Search, LayoutGrid, List } from "lucide-react";
import { BRAND_GREEN, BRAND_GREEN_DEEP, HIGHLIGHT_BG, HIGHLIGHT_TEXT } from "./theme.jsx";
import { fetchClientFiles, fetchFileBytes, uploadDocumentFile, downloadDocumentFile, openDocumentFile } from "./api.js";
import { Spinner, Skeleton } from "./Loading.jsx";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Document vault — every file uploaded for a client in one place: a gallery with
// first-page previews, and a full viewer inside the app. Works offline; the PDF
// engine is loaded only when this screen is opened.

const CATEGORY_LABEL = {
  secretarial: "Secretarial records",
  bookkeeping: "Bookkeeping",
  banking_tax: "Banking & tax",
  personal: "Personal particulars",
};
const CATEGORY_DOT = { secretarial: "#2F6F62", bookkeeping: "#3C6E9C", banking_tax: "#B4791F", personal: "#A63D40" };
const KIND_STYLE = {
  pdf: { label: "PDF", bg: "#F8E3E3", fg: "#9B2F32" },
  image: { label: "IMAGE", bg: "#EBE3F6", fg: "#5B3C93" },
  word: { label: "WORD", bg: "#E1EAF6", fg: "#20415F" },
  excel: { label: "EXCEL", bg: "#E0F0E8", fg: "#1F5A43" },
  other: { label: "FILE", bg: "#ECE9E0", fg: "#4A4638" },
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const VAULT_CSS = `
.fv-card { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; cursor: pointer; }
.fv-card:hover, .fv-card:focus-visible { transform: translateY(-4px); box-shadow: 0 16px 34px rgba(28,36,48,.18); border-color: #8FB9A5 !important; outline: none; }
.fv-card .fv-quick { opacity: 0; transform: translateY(-4px); transition: opacity .15s, transform .15s; }
.fv-card:hover .fv-quick, .fv-card:focus-within .fv-quick { opacity: 1; transform: none; }
.fv-iconbtn { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: none; background: rgba(255,255,255,.95); color: #1C2430; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.2); transition: background .12s, transform .12s; }
.fv-iconbtn:hover { background: #1F4A40; color: #fff; transform: scale(1.06); }
.fv-row { transition: background .12s; cursor: pointer; }
.fv-row:hover { background: #F2EFE4; }
.fv-thumb img { transition: opacity .35s ease, transform .35s ease; }
.fv-card:hover .fv-thumb img { transform: scale(1.03); }
.fv-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.fv-scroll::-webkit-scrollbar-thumb { background: rgba(120,120,120,.45); border-radius: 8px; }
.fv-rail-page { cursor: pointer; border: 2px solid transparent; transition: border-color .12s, transform .12s; display: block; margin: 0 auto 10px; background: #fff; }
.fv-rail-page:hover { transform: scale(1.03); }
.fv-rail-page.fv-on { border-color: #2FA866; }
.fv-film { cursor: pointer; border: 2px solid transparent; opacity: .72; transition: opacity .12s, border-color .12s, transform .12s; flex-shrink: 0; background: #1E252E; }
.fv-film:hover { opacity: 1; transform: translateY(-2px); }
.fv-film.fv-on { opacity: 1; border-color: #2FA866; }
.fv-barbtn { border: 1px solid #3B4552; background: transparent; color: #EDEAE2; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background .12s, border-color .12s; }
.fv-barbtn:hover:not(:disabled) { background: #26303B; border-color: #5A6674; }
.fv-barbtn:disabled { opacity: .4; cursor: default; }
.fv-barbtn.fv-active { background: #1F4A40; border-color: #2FA866; }
`;

let pdfLibPromise = null;
function loadPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = import("pdfjs-dist/build/pdf.min.mjs")
      .then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        return lib;
      })
      .catch((err) => {
        pdfLibPromise = null; // allow a retry next time
        throw err;
      });
  }
  return pdfLibPromise;
}

function kindOf(file) {
  const name = (file.filename || "").toLowerCase();
  const type = (file.mimeType || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type === "image/heic" || name.endsWith(".heic")) return "other"; // Chromium can't show HEIC
  if (type.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/.test(name)) return "image";
  if (/\.docx?$/.test(name)) return "word";
  if (/\.xlsx?$/.test(name)) return "excel";
  return "other";
}

function extLabel(file) {
  const m = (file.filename || "").match(/\.([A-Za-z0-9]{1,5})$/);
  return m ? m[1].toUpperCase() : "FILE";
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function monthLabel(stamp) {
  const m = String(stamp || "").match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "Earlier";
}

function TypeBadge({ kind, small }) {
  const s = KIND_STYLE[kind];
  return (
    <span style={{ background: s.bg, color: s.fg, fontSize: small ? 9 : 10, fontWeight: 800, letterSpacing: 0.6, padding: small ? "2px 6px" : "3px 8px", borderRadius: 4 }}>{s.label}</span>
  );
}

// ---------- Thumbnails ----------
// At most two are generated at once, only for cards scrolled into view, and
// each result is kept so reopening the vault doesn't redo the work.

const thumbCache = new Map();
let activeThumbs = 0;
const waitingThumbs = [];

function runQueued(task) {
  return new Promise((resolve, reject) => {
    const go = () => {
      activeThumbs += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeThumbs -= 1;
          const next = waitingThumbs.shift();
          if (next) next();
        });
    };
    if (activeThumbs < 2) go();
    else waitingThumbs.push(go);
  });
}

const THUMB_WIDTH = 360;

async function makeThumb(file, kind) {
  const { bytes, type } = await fetchFileBytes(file.id);
  const canvas = document.createElement("canvas");
  if (kind === "image") {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: file.mimeType || type }));
    const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
  } else {
    const lib = await loadPdfLib();
    const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    } finally {
      doc.destroy();
    }
  }
  const url = canvas.toDataURL("image/jpeg", 0.74);
  if (thumbCache.size > 300) thumbCache.delete(thumbCache.keys().next().value);
  thumbCache.set(file.id, url);
  return url;
}

// A preview of the file's first page, with a shimmer while it's being made.
function Thumb({ file, kind, height = 190 }) {
  const [src, setSrc] = useState(thumbCache.get(file.id) || null);
  const [failed, setFailed] = useState(false);
  const ref = useRef(null);
  const canPreview = kind === "pdf" || kind === "image";

  useEffect(() => {
    if (src || failed || !canPreview) return undefined;
    let cancelled = false;
    const start = () =>
      runQueued(() => makeThumb(file, kind))
        .then((url) => {
          if (!cancelled) setSrc(url);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    const el = ref.current;
    if (typeof IntersectionObserver === "undefined" || !el) {
      start();
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: "240px" }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [file, kind, src, failed, canPreview]);

  const loading = canPreview && !src && !failed;
  return (
    <div ref={ref} className="fv-thumb" style={{ height, position: "relative", background: "#EFEBDF", overflow: "hidden", borderBottom: "1px solid #E5E1D5" }}>
      {src && <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }} />}
      {loading && (
        <>
          <Skeleton width="100%" height="100%" radius={0} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Spinner size={22} color="#6B6656" />
          </div>
        </>
      )}
      {!src && !loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#8A8577", gap: 6 }}>
          <div style={{ width: 54, height: 66, background: "#fff", border: "1px solid #D8D3C4", boxShadow: "0 2px 8px rgba(0,0,0,.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: KIND_STYLE[kind].fg }}>{extLabel(file)}</div>
          <div style={{ fontSize: 11 }}>{canPreview ? "Preview unavailable" : "Download to open"}</div>
        </div>
      )}
    </div>
  );
}

// ---------- Full viewer ----------

function FileViewer({ files, index, onIndex, onClose }) {
  const file = files[index];
  const kind = kindOf(file);
  const [status, setStatus] = useState("loading"); // loading | ready | unsupported | error
  const [error, setError] = useState("");
  const [imgUrl, setImgUrl] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [rendered, setRendered] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [showRail, setShowRail] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [actionError, setActionError] = useState("");
  const holderRef = useRef(null);
  const scrollRef = useRef(null);
  const railRef = useRef(null);
  const filmRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    let doc = null;
    setStatus("loading");
    setError("");
    setImgUrl(null);
    setPdfDoc(null);
    setZoom(1);
    setPageCount(0);
    setRendered(0);
    setCurrentPage(1);
    setActionError("");
    (async () => {
      if (kind !== "pdf" && kind !== "image") {
        setStatus("unsupported");
        return;
      }
      const { bytes, type } = await fetchFileBytes(file.id);
      if (cancelled) return;
      if (kind === "image") {
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: file.mimeType || type }));
        setImgUrl(objectUrl);
        setStatus("ready");
        return;
      }
      const lib = await loadPdfLib();
      doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
      if (cancelled) {
        doc.destroy();
        return;
      }
      setPdfDoc(doc);
      setPageCount(doc.numPages);
      setStatus("ready");
    })().catch((err) => {
      if (cancelled) return;
      setStatus("error");
      setError(
        kind === "pdf"
          ? "Couldn't open this PDF — it may be damaged or password-protected. You can still download it."
          : err && err.message
            ? err.message
            : "Couldn't open this file."
      );
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (doc) doc.destroy();
    };
  }, [file, kind]);

  // Draw every page (up to 80) at the current zoom, one after another.
  useEffect(() => {
    if (!pdfDoc || !holderRef.current) return undefined;
    let cancelled = false;
    let task = null;
    const holder = holderRef.current;
    holder.innerHTML = "";
    setRendered(0);
    (async () => {
      const width = Math.max(300, holder.clientWidth - 24);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pages = Math.min(pdfDoc.numPages, 80);
      for (let i = 1; i <= pages; i++) {
        if (cancelled) return;
        const page = await pdfDoc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = (width / base.width) * zoom;
        const viewport = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        canvas.style.display = "block";
        canvas.style.margin = "0 auto 16px";
        canvas.style.background = "#fff";
        canvas.style.boxShadow = "0 4px 22px rgba(0,0,0,0.45)";
        canvas.dataset.page = String(i);
        holder.appendChild(canvas);
        task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
        await task.promise;
        if (!cancelled) setRendered(i);
      }
    })().catch((err) => {
      if (cancelled || (err && err.name === "RenderingCancelledException")) return;
      setStatus("error");
      setError("Couldn't display this PDF. You can still download it.");
    });
    return () => {
      cancelled = true;
      if (task && task.cancel) task.cancel();
    };
  }, [pdfDoc, zoom]);

  // Small page previews down the left side; clicking one jumps to that page.
  useEffect(() => {
    if (!pdfDoc || !showRail || !railRef.current) return undefined;
    let cancelled = false;
    const rail = railRef.current;
    rail.innerHTML = "";
    (async () => {
      const pages = Math.min(pdfDoc.numPages, 80);
      for (let i = 1; i <= pages; i++) {
        if (cancelled) return;
        const page = await pdfDoc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 104 / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className = "fv-rail-page" + (i === 1 ? " fv-on" : "");
        canvas.dataset.page = String(i);
        rail.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const num = document.createElement("div");
        num.textContent = String(i);
        num.style.cssText = "text-align:center;color:#8A93A0;font-size:10px;margin:-6px 0 10px";
        rail.appendChild(num);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, showRail]);

  // Highlight the page in view (in the rail) and keep the "page x of y" counter honest.
  function onScroll() {
    const holder = holderRef.current;
    const box = scrollRef.current;
    if (!holder || !box) return;
    const top = box.scrollTop + 120;
    let page = 1;
    for (const c of holder.children) {
      if (c.offsetTop <= top) page = Number(c.dataset.page) || page;
    }
    if (page !== currentPage) setCurrentPage(page);
  }
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    for (const c of rail.querySelectorAll("canvas")) c.classList.toggle("fv-on", Number(c.dataset.page) === currentPage);
    const active = rail.querySelector("canvas.fv-on");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }, [currentPage]);

  function goToPage(n) {
    const holder = holderRef.current;
    const target = holder && [...holder.children].find((c) => Number(c.dataset.page) === n);
    if (target && scrollRef.current) scrollRef.current.scrollTo({ top: target.offsetTop - 12, behavior: "smooth" });
  }

  // Keep the current file visible in the filmstrip.
  useEffect(() => {
    const strip = filmRef.current;
    const el = strip && strip.querySelector(".fv-on");
    if (el && el.scrollIntoView) el.scrollIntoView({ inline: "center", block: "nearest" });
  }, [index]);

  // Keyboard: Esc closes, ← → move through the files, + / − zoom.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "ArrowRight" && index < files.length - 1) onIndex(index + 1);
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100));
      else if (e.key === "-") setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, files.length, onIndex, onClose]);

  async function save() {
    setActionError("");
    try {
      await downloadDocumentFile(file.id, file.filename);
    } catch (err) {
      setActionError(err.message || "Download failed");
    }
  }
  async function openOutside() {
    setActionError("");
    try {
      await openDocumentFile(file.id, file.filename);
    } catch (err) {
      setActionError(err.message || "Could not open the file");
    }
  }

  const canZoom = status === "ready" && (kind === "pdf" || kind === "image");
  const infoRows = [
    ["Register entry", file.documentCode],
    ["Description", file.serviceDetail || CATEGORY_LABEL[file.category] || file.category],
    ["Category", CATEGORY_LABEL[file.category] || file.category],
    ["Received", file.dateReceived],
    ["Paper copy", `${file.location} · ${file.documentStatus}`],
    ["Uploaded", `${file.uploadedAt}${file.uploadedBy ? ` by ${file.uploadedBy}` : ""}`],
    ["Size", formatSize(file.sizeBytes)],
    ["Type", file.mimeType || extLabel(file)],
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 56, background: "#0F1318", display: "flex", flexDirection: "column", animation: "fams-fade 0.2s ease-out" }}>
      <style>{VAULT_CSS}</style>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#161C23", borderBottom: "1px solid #232B35", color: "#EDEAE2", flexWrap: "wrap" }}>
        <button type="button" className="fv-barbtn" onClick={onClose} title="Back to documents (Esc)">
          <ArrowLeft size={14} /> Documents
        </button>
        <div style={{ flex: "1 1 220px", minWidth: 0, marginLeft: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TypeBadge kind={kind} small />
            <span style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.filename}</span>
          </div>
          <div style={{ fontSize: 11, color: "#8A93A0", marginTop: 2 }}>
            {file.documentCode} · {file.serviceDetail || CATEGORY_LABEL[file.category] || file.category} · {formatSize(file.sizeBytes)}
          </div>
        </div>
        {kind === "pdf" && status === "ready" && pageCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <button type="button" className="fv-barbtn" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)} title="Previous page" style={{ padding: "6px 9px" }}>
              ‹
            </button>
            <span style={{ minWidth: 82, textAlign: "center" }}>
              Page <b>{currentPage}</b> of {pageCount}
            </span>
            <button type="button" className="fv-barbtn" disabled={currentPage >= pageCount} onClick={() => goToPage(currentPage + 1)} title="Next page" style={{ padding: "6px 9px" }}>
              ›
            </button>
          </div>
        )}
        {canZoom && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" className="fv-barbtn" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} title="Zoom out (−)" style={{ padding: "6px 10px" }}>
              −
            </button>
            <button type="button" className={`fv-barbtn${zoom === 1 ? " fv-active" : ""}`} onClick={() => setZoom(1)} title="Fit to width" style={{ minWidth: 62, justifyContent: "center" }}>
              {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
            </button>
            <button type="button" className="fv-barbtn" onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))} title="Zoom in (+)" style={{ padding: "6px 10px" }}>
              +
            </button>
          </div>
        )}
        {kind === "pdf" && status === "ready" && (
          <button type="button" className={`fv-barbtn${showRail ? " fv-active" : ""}`} onClick={() => setShowRail((s) => !s)} title="Show page previews">
            Pages
          </button>
        )}
        <button type="button" className={`fv-barbtn${showInfo ? " fv-active" : ""}`} onClick={() => setShowInfo((s) => !s)} title="Details about this file">
          Details
        </button>
        <button type="button" className="fv-barbtn" onClick={save}>
          <Download size={13} /> Download
        </button>
        <button type="button" className="fv-barbtn" onClick={openOutside} title="Open in a separate window">
          New window
        </button>
        <button type="button" className="fv-barbtn" onClick={onClose} aria-label="Close viewer" title="Close (Esc)" style={{ padding: "6px 9px" }}>
          <X size={15} />
        </button>
      </div>

      {actionError && <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "6px 16px", fontSize: 12, fontWeight: 600 }}>{actionError}</div>}

      {/* Body */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {kind === "pdf" && status === "ready" && showRail && (
          <div className="fv-scroll" style={{ width: 138, background: "#12171D", borderRight: "1px solid #232B35", overflowY: "auto", padding: "14px 0", flexShrink: 0 }}>
            <div
              ref={railRef}
              onClick={(e) => {
                const c = e.target.closest && e.target.closest("canvas");
                if (c) goToPage(Number(c.dataset.page));
              }}
            />
          </div>
        )}

        <div ref={scrollRef} onScroll={onScroll} className="fv-scroll" style={{ flex: 1, overflow: "auto", padding: 16, position: "relative" }}>
          {status === "loading" && (
            <div style={{ color: "#EDEAE2", textAlign: "center", marginTop: 110, fontSize: 14 }}>
              <Spinner size={44} color="#2FA866" thickness={3.4} />
              <div style={{ marginTop: 16, fontWeight: 600 }}>Opening {file.filename}…</div>
              <div style={{ marginTop: 4, fontSize: 12, color: "#8A93A0" }}>Preparing the pages</div>
            </div>
          )}
          {status === "unsupported" && (
            <div style={{ color: "#EDEAE2", textAlign: "center", marginTop: 90, fontSize: 14, lineHeight: 1.6, animation: "fams-fade 0.3s ease-out" }}>
              <div style={{ width: 88, height: 108, margin: "0 auto 18px", background: "#fff", color: KIND_STYLE[kind].fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, boxShadow: "0 8px 28px rgba(0,0,0,.5)" }}>{extLabel(file)}</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>
                {kind === "word" || kind === "excel" ? "Word and Excel files can't be shown inside the app." : "This type of file can't be shown inside the app."}
              </div>
              <div style={{ color: "#8A93A0", fontSize: 12.5, marginTop: 4 }}>Download it and it will open in your usual program.</div>
              <button type="button" onClick={save} className="fv-barbtn" style={{ marginTop: 18, padding: "10px 20px", background: BRAND_GREEN_DEEP, borderColor: "#2FA866" }}>
                <Download size={14} /> Download {file.filename}
              </button>
            </div>
          )}
          {status === "error" && (
            <div style={{ color: "#F5C6C6", textAlign: "center", marginTop: 100, fontSize: 14, lineHeight: 1.6, animation: "fams-fade 0.3s ease-out" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{error}</div>
              <button type="button" onClick={save} className="fv-barbtn" style={{ marginTop: 16, padding: "10px 20px" }}>
                Download instead
              </button>
            </div>
          )}
          {status === "ready" && kind === "image" && imgUrl && (
            <div style={{ display: "flex", justifyContent: "center", minHeight: "100%", animation: "fams-fade 0.25s ease-out" }}>
              <img
                src={imgUrl}
                alt={file.filename}
                style={zoom === 1 ? { maxWidth: "100%", maxHeight: "calc(100vh - 220px)", objectFit: "contain", alignSelf: "center", boxShadow: "0 6px 28px rgba(0,0,0,.5)" } : { width: `${zoom * 100}%`, maxWidth: "none", height: "auto", boxShadow: "0 6px 28px rgba(0,0,0,.5)" }}
              />
            </div>
          )}
          {status === "ready" && kind === "pdf" && (
            <>
              {rendered < Math.min(pageCount, 80) && (
                <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(22,28,35,.92)", color: "#EDEAE2", fontSize: 12, padding: "6px 14px", borderRadius: 999, marginBottom: 10 }}>
                    <Spinner size={13} color="#2FA866" /> Rendering page {Math.min(rendered + 1, pageCount)} of {pageCount}
                  </div>
                </div>
              )}
              {pageCount > 80 && <div style={{ color: "#8A93A0", fontSize: 11.5, textAlign: "center", marginBottom: 10 }}>Showing the first 80 of {pageCount} pages — download the file to see the rest.</div>}
              <div ref={holderRef} />
            </>
          )}
        </div>

        {showInfo && (
          <div className="fv-scroll" style={{ width: 290, background: "#161C23", borderLeft: "1px solid #232B35", color: "#EDEAE2", overflowY: "auto", padding: "18px 18px", flexShrink: 0, animation: "fams-fade 0.18s ease-out" }}>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 700, marginBottom: 14 }}>File details</div>
            {infoRows.map(([label, value]) => (
              <div key={label} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#8A93A0", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
                <div style={{ fontSize: 13, wordBreak: "break-word" }}>{value || "—"}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filmstrip of the other files */}
      {files.length > 1 && (
        <div style={{ background: "#12171D", borderTop: "1px solid #232B35", padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" className="fv-barbtn" disabled={index === 0} onClick={() => onIndex(index - 1)} title="Previous file (←)" style={{ padding: "6px 9px" }}>
            <ArrowLeft size={13} />
          </button>
          <div ref={filmRef} className="fv-scroll" style={{ display: "flex", gap: 10, overflowX: "auto", flex: 1, padding: "4px 2px" }}>
            {files.map((f, i) => {
              const k = kindOf(f);
              const t = thumbCache.get(f.id);
              return (
                <div key={f.id} title={f.filename} onClick={() => onIndex(i)} className={`fv-film${i === index ? " fv-on" : ""}`} style={{ width: 62, height: 78, overflow: "hidden", position: "relative" }}>
                  {t ? (
                    <img src={t} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }} />
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: KIND_STYLE[k].fg, background: KIND_STYLE[k].bg }}>{extLabel(f)}</div>
                  )}
                </div>
              );
            })}
          </div>
          <span style={{ color: "#8A93A0", fontSize: 12, whiteSpace: "nowrap" }}>
            {index + 1} / {files.length}
          </span>
          <button type="button" className="fv-barbtn" disabled={index === files.length - 1} onClick={() => onIndex(index + 1)} title="Next file (→)" style={{ padding: "6px 9px" }}>
            <ArrowRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- The vault ----------

const box = { background: "#fff", border: "1px solid #C9C4B6" };
const fieldInput = { border: "1px solid #C9C4B6", background: "#fff", padding: "8px 11px", fontSize: 13, boxSizing: "border-box" };

export default function ClientFiles({ client, documents, onClose }) {
  const [files, setFiles] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all"); // all | pdf | image | office
  const [catFilter, setCatFilter] = useState("all");
  const [sort, setSort] = useState("new"); // new | old | name
  const [view, setView] = useState("grid"); // grid | list
  const [shown, setShown] = useState(24);
  const [viewIndex, setViewIndex] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDoc, setUploadDoc] = useState(documents.length === 1 ? String(documents[0].id) : "");
  const [picked, setPicked] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const pickRef = useRef(null);

  async function load() {
    try {
      setFiles(await fetchClientFiles(client.id));
    } catch (err) {
      setError(err.message || "Could not load the files");
      setFiles([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const filtered = useMemo(() => {
    if (!files) return [];
    const q = query.trim().toLowerCase();
    const out = files.filter((f) => {
      const k = kindOf(f);
      if (kindFilter === "pdf" && k !== "pdf") return false;
      if (kindFilter === "image" && k !== "image") return false;
      if (kindFilter === "office" && k !== "word" && k !== "excel") return false;
      if (catFilter !== "all" && f.category !== catFilter) return false;
      if (q && !`${f.filename} ${f.documentCode} ${f.serviceDetail}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sort === "name") out.sort((a, b) => a.filename.localeCompare(b.filename));
    else if (sort === "old") out.sort((a, b) => a.id - b.id);
    else out.sort((a, b) => b.id - a.id);
    return out;
  }, [files, query, kindFilter, catFilter, sort]);

  const kindCounts = useMemo(() => {
    const c = { all: 0, pdf: 0, image: 0, office: 0 };
    for (const f of files || []) {
      const k = kindOf(f);
      c.all += 1;
      if (k === "pdf") c.pdf += 1;
      else if (k === "image") c.image += 1;
      else if (k === "word" || k === "excel") c.office += 1;
    }
    return c;
  }, [files]);
  const totalBytes = (files || []).reduce((sum, f) => sum + (f.sizeBytes || 0), 0);

  const visible = filtered.slice(0, shown);
  const groups = useMemo(() => {
    if (sort === "name") return [{ label: null, items: visible }];
    const out = [];
    for (const f of visible) {
      const label = monthLabel(f.uploadedAt || f.dateReceived);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(f);
      else out.push({ label, items: [f] });
    }
    return out;
  }, [visible, sort]);

  async function handleUpload() {
    if (!picked || !uploadDoc) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await uploadDocumentFile(Number(uploadDoc), picked);
      await load();
      setNotice(`Added ${picked.name}`);
      setPicked(null);
      setUploadOpen(false);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const segment = (key, label) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        setKindFilter(key);
        setShown(24);
      }}
      style={{ border: "none", padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", background: kindFilter === key ? BRAND_GREEN_DEEP : "transparent", color: kindFilter === key ? "#EDEAE2" : "#4A4638", display: "flex", alignItems: "center", gap: 6 }}
    >
      {label}
      <span style={{ fontSize: 10.5, opacity: 0.75 }}>{kindCounts[key]}</span>
    </button>
  );

  function card(f, indexInFiltered) {
    const kind = kindOf(f);
    return (
      <div
        key={f.id}
        className="fv-card"
        role="button"
        tabIndex={0}
        title={`Open ${f.filename}`}
        onClick={() => setViewIndex(indexInFiltered)}
        onKeyDown={(e) => {
          if (e.key === "Enter") setViewIndex(indexInFiltered);
        }}
        style={{ ...box, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", animation: "fams-fade 0.3s ease-out" }}
      >
        <Thumb file={f} kind={kind} />
        <div style={{ position: "absolute", top: 8, left: 8 }}>
          <TypeBadge kind={kind} />
        </div>
        <div className="fv-quick" style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
          <button type="button" className="fv-iconbtn" title="Download" aria-label={`Download ${f.filename}`} onClick={(e) => { e.stopPropagation(); downloadDocumentFile(f.id, f.filename).catch((err) => setError(err.message || "Download failed")); }}>
            <Download size={15} />
          </button>
        </div>
        <div style={{ padding: "10px 12px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1C2430", lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 34 }}>{f.filename}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#4A4638", marginTop: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: CATEGORY_DOT[f.category] || "#8A8577", flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.serviceDetail || CATEGORY_LABEL[f.category] || f.category}</span>
          </div>
          <div style={{ fontSize: 11, color: "#8A8577", marginTop: 3 }}>
            {f.documentCode} · {f.dateReceived} · {formatSize(f.sizeBytes)}
          </div>
        </div>
      </div>
    );
  }

  function listRow(f, indexInFiltered) {
    const kind = kindOf(f);
    return (
      <div key={f.id} className="fv-row" role="button" tabIndex={0} title={`Open ${f.filename}`} onClick={() => setViewIndex(indexInFiltered)} onKeyDown={(e) => { if (e.key === "Enter") setViewIndex(indexInFiltered); }} style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 14px", borderBottom: "1px solid #EFEBDF" }}>
        <div style={{ width: 40, height: 52, flexShrink: 0, overflow: "hidden", border: "1px solid #E5E1D5" }}>
          <Thumb file={f} kind={kind} height={52} />
        </div>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1C2430", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</div>
          <div style={{ fontSize: 11.5, color: "#8A8577" }}>{f.serviceDetail || CATEGORY_LABEL[f.category] || f.category}</div>
        </div>
        <TypeBadge kind={kind} small />
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4A4638", width: 150 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: CATEGORY_DOT[f.category] || "#8A8577" }} />
          {CATEGORY_LABEL[f.category] || f.category}
        </div>
        <div style={{ fontSize: 12, color: "#8A8577", width: 96 }}>{f.dateReceived}</div>
        <div style={{ fontSize: 12, color: "#8A8577", width: 64, textAlign: "right" }}>{formatSize(f.sizeBytes)}</div>
        <button type="button" className="fv-iconbtn" style={{ boxShadow: "none", border: "1px solid #C9C4B6" }} title="Download" aria-label={`Download ${f.filename}`} onClick={(e) => { e.stopPropagation(); downloadDocumentFile(f.id, f.filename).catch((err) => setError(err.message || "Download failed")); }}>
          <Download size={14} />
        </button>
      </div>
    );
  }

  let running = 0;
  const content = groups.map((g, gi) => (
    <div key={g.label || `g${gi}`} style={{ marginBottom: 22 }}>
      {g.label && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "0 0 10px" }}>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 700, color: "#1C2430" }}>{g.label}</div>
          <div style={{ fontSize: 11.5, color: "#8A8577" }}>{g.items.length} file{g.items.length === 1 ? "" : "s"}</div>
          <div style={{ flex: 1, height: 1, background: "#E5E1D5", alignSelf: "center" }} />
        </div>
      )}
      {view === "grid" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16 }}>
          {g.items.map((f) => card(f, running++))}
        </div>
      ) : (
        <div style={box}>{g.items.map((f) => listRow(f, running++))}</div>
      )}
    </div>
  ));

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 52, background: "rgba(28,36,48,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) {
          setPicked(f);
          setUploadOpen(true);
        }
      }}
    >
      <style>{VAULT_CSS}</style>
      <div style={{ width: 1100, maxWidth: "100%", maxHeight: "94vh", background: "#FBFAF6", display: "flex", flexDirection: "column", boxShadow: "0 28px 72px rgba(0,0,0,0.4)", position: "relative", animation: "fams-pop 0.22s ease-out" }}>
        {dragging && (
          <div style={{ position: "absolute", inset: 10, zIndex: 5, border: "3px dashed #2FA866", background: "rgba(227,239,233,0.94)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#1F4A40", pointerEvents: "none" }}>
            <Upload size={34} />
            <div style={{ fontSize: 18, fontWeight: 800 }}>Drop the file to upload it</div>
            <div style={{ fontSize: 13 }}>You&apos;ll choose which register entry it belongs to.</div>
          </div>
        )}

        {/* Header */}
        <div style={{ padding: "20px 26px 14px", borderBottom: "1px solid #E5E1D5" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700 }}>Documents</div>
              <div style={{ fontSize: 12.5, color: "#6B6656", marginTop: 3 }}>
                {client.company} <span style={{ fontFamily: "monospace", color: "#8A8577" }}>({client.fileNo})</span>
                {files ? ` · ${files.length} file${files.length === 1 ? "" : "s"} · ${formatSize(totalBytes) || "0 KB"}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => setUploadOpen((o) => !o)}
                style={{ display: "flex", alignItems: "center", gap: 7, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
              >
                <Upload size={15} /> Upload
              </button>
              <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer" }} aria-label="Close">
                <X size={20} />
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, background: "#fff", border: "1px solid #C9C4B6", padding: "8px 12px", flex: "1 1 220px", minWidth: 200 }}>
              <Search size={15} color="#8A8577" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShown(24);
                }}
                placeholder="Search by file name or code…"
                style={{ border: "none", outline: "none", flex: 1, fontSize: 13, background: "transparent" }}
              />
            </div>
            <div style={{ display: "flex", border: "1px solid #C9C4B6", background: "#fff" }}>
              {segment("all", "All")}
              {segment("pdf", "PDF")}
              {segment("image", "Images")}
              {segment("office", "Word / Excel")}
            </div>
            <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setShown(24); }} style={fieldInput}>
              <option value="all">All categories</option>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} style={fieldInput}>
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
              <option value="name">Name A–Z</option>
            </select>
            <div style={{ display: "flex", border: "1px solid #C9C4B6", background: "#fff" }}>
              <button type="button" onClick={() => setView("grid")} title="Grid view" aria-label="Grid view" style={{ border: "none", padding: "8px 11px", cursor: "pointer", background: view === "grid" ? BRAND_GREEN_DEEP : "transparent", color: view === "grid" ? "#EDEAE2" : "#4A4638", display: "flex" }}>
                <LayoutGrid size={15} />
              </button>
              <button type="button" onClick={() => setView("list")} title="List view" aria-label="List view" style={{ border: "none", padding: "8px 11px", cursor: "pointer", background: view === "list" ? BRAND_GREEN_DEEP : "transparent", color: view === "list" ? "#EDEAE2" : "#4A4638", display: "flex" }}>
                <List size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="fv-scroll" style={{ padding: "18px 26px 26px", overflowY: "auto", flex: 1 }}>
          {uploadOpen && (
            <div style={{ ...box, padding: "16px 18px", marginBottom: 18, animation: "fams-pop 0.18s ease-out" }}>
              {documents.length === 0 ? (
                <div style={{ fontSize: 13, color: "#4A4638", lineHeight: 1.5 }}>
                  Files are attached to an entry in the register. This client has no entries yet — use <strong>Log a document</strong> first, then come back to upload the file.
                </div>
              ) : (
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
                  <div style={{ flex: "1 1 260px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#4A4638", marginBottom: 6 }}>1. Which register entry is it for?</div>
                    <select value={uploadDoc} onChange={(e) => setUploadDoc(e.target.value)} style={{ ...fieldInput, width: "100%" }}>
                      <option value="">Choose the register entry…</option>
                      {documents.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code} — {d.serviceDetail || CATEGORY_LABEL[d.category] || d.category}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: "1 1 300px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#4A4638", marginBottom: 6 }}>2. Choose the file</div>
                    <div
                      onClick={() => pickRef.current && pickRef.current.click()}
                      style={{ border: "2px dashed #B8B2A0", background: picked ? "#EEF4F1" : "#FAF8F2", padding: "14px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, minHeight: 44 }}
                    >
                      <Upload size={18} color="#6B6656" />
                      <div style={{ fontSize: 13, color: "#1C2430", flex: 1, minWidth: 0 }}>
                        {picked ? (
                          <>
                            <b style={{ wordBreak: "break-all" }}>{picked.name}</b> <span style={{ color: "#8A8577" }}>({formatSize(picked.size)})</span>
                          </>
                        ) : (
                          "Drop a file here, or click to choose"
                        )}
                      </div>
                      <input ref={pickRef} type="file" style={{ display: "none" }} accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.heic" onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) setPicked(f); }} />
                    </div>
                    <div style={{ fontSize: 11, color: "#8A8577", marginTop: 5 }}>PDF, Word, Excel or image, up to 20 MB.</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                    <button type="button" disabled={!picked || !uploadDoc || busy} onClick={handleUpload} style={{ background: picked && uploadDoc && !busy ? BRAND_GREEN : "#C9C4B6", color: "#fff", border: "none", padding: "11px 22px", fontWeight: 700, fontSize: 13, cursor: picked && uploadDoc && !busy ? "pointer" : "default", display: "flex", alignItems: "center", gap: 8 }}>
                      {busy && <Spinner size={14} color="#fff" />} {busy ? "Uploading…" : "Upload"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => { setUploadOpen(false); setPicked(null); }} style={{ border: "none", background: "none", cursor: "pointer", color: "#6B6656", fontSize: 12.5, padding: "11px 4px" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "9px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 14 }}>{error}</div>}
          {notice && <div style={{ background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, padding: "9px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 14 }}>{notice}</div>}

          {files === null && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#6B6656", fontSize: 13, marginBottom: 14 }}>
                <Spinner size={18} /> Loading documents…
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16 }}>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <div key={i} style={{ ...box, overflow: "hidden" }}>
                    <Skeleton height={190} radius={0} />
                    <div style={{ padding: 12 }}>
                      <Skeleton width="80%" height={13} />
                      <Skeleton width="55%" height={11} style={{ marginTop: 10 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {files && files.length === 0 && !error && (
            <div style={{ ...box, padding: "54px 20px", textAlign: "center", animation: "fams-fade 0.3s ease-out" }}>
              <div style={{ width: 74, height: 92, margin: "0 auto 18px", background: "#F6F3EA", border: "2px dashed #C9C4B6", display: "flex", alignItems: "center", justifyContent: "center", color: "#B0AA9A" }}>
                <Upload size={26} />
              </div>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 18, fontWeight: 700 }}>No documents uploaded yet</div>
              <div style={{ fontSize: 13, color: "#6B6656", margin: "6px 0 18px" }}>Upload a PDF, scan or photo and it will appear here, ready to preview.</div>
              <button type="button" onClick={() => setUploadOpen(true)} style={{ background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "11px 24px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                Upload the first file
              </button>
            </div>
          )}
          {files && files.length > 0 && filtered.length === 0 && <div style={{ color: "#6B6656", fontSize: 13.5, padding: "30px 0", textAlign: "center" }}>No files match those filters.</div>}

          {content}

          {filtered.length > shown && (
            <div style={{ textAlign: "center", marginTop: 6 }}>
              <button type="button" onClick={() => setShown((n) => n + 24)} style={{ border: "1px solid #C9C4B6", background: "#fff", padding: "10px 24px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                Show {Math.min(24, filtered.length - shown)} more ({filtered.length - shown} left)
              </button>
            </div>
          )}
        </div>
      </div>

      {viewIndex !== null && filtered[viewIndex] && <FileViewer files={filtered} index={viewIndex} onIndex={setViewIndex} onClose={() => setViewIndex(null)} />}
    </div>
  );
}
