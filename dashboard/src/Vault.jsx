import React, { useState, useEffect, useRef, useMemo } from "react";
import { X, Download, ArrowLeft, ArrowRight, Loader2, Upload } from "lucide-react";
import { BRAND_GREEN, BRAND_GREEN_DEEP, HIGHLIGHT_BG, HIGHLIGHT_TEXT } from "./theme.jsx";
import { fetchClientFiles, fetchFileBytes, uploadDocumentFile, downloadDocumentFile, openDocumentFile } from "./api.js";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Document vault — every file uploaded for a client in one place: a pile of
// cards with a first-page preview, and a full viewer inside the app. Works
// offline; the PDF engine is loaded only when this screen is opened.

const CATEGORY_LABEL = {
  secretarial: "Secretarial records",
  bookkeeping: "Bookkeeping",
  banking_tax: "Banking & tax",
  personal: "Personal particulars",
};

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

const THUMB_WIDTH = 320;

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
  const url = canvas.toDataURL("image/jpeg", 0.72);
  if (thumbCache.size > 300) thumbCache.delete(thumbCache.keys().next().value);
  thumbCache.set(file.id, url);
  return url;
}

function Thumb({ file, kind }) {
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
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [file, kind, src, failed, canPreview]);

  return (
    <div ref={ref} style={{ height: 150, background: "#EFEBDF", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", borderBottom: "1px solid #E5E1D5" }}>
      {src ? (
        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
      ) : (
        <div style={{ textAlign: "center", color: "#8A8577" }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, color: kind === "pdf" ? "#A63D40" : kind === "word" ? "#3C6E9C" : kind === "excel" ? "#2F6F62" : "#8A8577" }}>{extLabel(file)}</div>
          <div style={{ fontSize: 10, marginTop: 4 }}>
            {canPreview ? (failed ? "Preview unavailable" : "Loading preview…") : "Download to open"}
          </div>
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
  const [pageNote, setPageNote] = useState("");
  const [actionError, setActionError] = useState("");
  const holderRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    let doc = null;
    setStatus("loading");
    setError("");
    setImgUrl(null);
    setPdfDoc(null);
    setZoom(1);
    setPageNote("");
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
    (async () => {
      const width = Math.max(300, holder.clientWidth - 24);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const total = pdfDoc.numPages;
      const pages = Math.min(total, 80);
      setPageNote(total > pages ? `Showing the first ${pages} of ${total} pages — download the file to see the rest.` : `${total} page${total === 1 ? "" : "s"}`);
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
        canvas.style.margin = "0 auto 12px";
        canvas.style.background = "#fff";
        canvas.style.boxShadow = "0 2px 10px rgba(0,0,0,0.25)";
        holder.appendChild(canvas);
        task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
        await task.promise;
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

  // Keyboard: Esc closes, arrow keys move through the pile.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "ArrowRight" && index < files.length - 1) onIndex(index + 1);
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

  const bar = { display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#1C2430", color: "#EDEAE2", flexWrap: "wrap" };
  const barBtn = { border: "1px solid #4A5568", background: "transparent", color: "#EDEAE2", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
  const canZoom = status === "ready" && (kind === "pdf" || kind === "image");

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 56, background: "rgba(14,18,24,0.96)", display: "flex", flexDirection: "column" }}>
      <div style={bar}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.filename}</div>
          <div style={{ fontSize: 11, color: "#A8AFBA" }}>
            {file.documentCode} · {file.serviceDetail || CATEGORY_LABEL[file.category] || file.category} · received {file.dateReceived} · {formatSize(file.sizeBytes)}
          </div>
        </div>
        <button type="button" style={{ ...barBtn, opacity: index === 0 ? 0.4 : 1 }} disabled={index === 0} onClick={() => onIndex(index - 1)} title="Previous (←)">
          <ArrowLeft size={13} />
        </button>
        <span style={{ fontSize: 12 }}>
          {index + 1} / {files.length}
        </span>
        <button type="button" style={{ ...barBtn, opacity: index === files.length - 1 ? 0.4 : 1 }} disabled={index === files.length - 1} onClick={() => onIndex(index + 1)} title="Next (→)">
          <ArrowRight size={13} />
        </button>
        {canZoom && (
          <>
            <button type="button" style={barBtn} onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} title="Zoom out">
              −
            </button>
            <span style={{ fontSize: 12, minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
            <button type="button" style={barBtn} onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))} title="Zoom in">
              +
            </button>
          </>
        )}
        <button type="button" style={{ ...barBtn, display: "flex", alignItems: "center", gap: 5 }} onClick={save}>
          <Download size={13} /> Download
        </button>
        <button type="button" style={barBtn} onClick={openOutside} title="Open in a separate window">
          New window
        </button>
        <button type="button" style={{ ...barBtn, padding: "6px 8px" }} onClick={onClose} aria-label="Close viewer" title="Close (Esc)">
          <X size={15} />
        </button>
      </div>

      {actionError && <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "6px 16px", fontSize: 12, fontWeight: 600 }}>{actionError}</div>}

      <div style={{ flex: 1, overflow: "auto", padding: 12, position: "relative" }}>
        {status === "loading" && (
          <div style={{ color: "#EDEAE2", textAlign: "center", marginTop: 80, fontSize: 13 }}>
            <Loader2 size={22} style={{ animation: "fams-spin 1s linear infinite" }} />
            <div style={{ marginTop: 8 }}>Opening…</div>
            <style>{"@keyframes fams-spin { to { transform: rotate(360deg); } }"}</style>
          </div>
        )}
        {status === "unsupported" && (
          <div style={{ color: "#EDEAE2", textAlign: "center", marginTop: 80, fontSize: 14, lineHeight: 1.6 }}>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 1 }}>{extLabel(file)}</div>
            <div style={{ marginTop: 6 }}>
              {kind === "word" || kind === "excel"
                ? "Word and Excel files can't be shown inside the app."
                : "This type of file can't be shown inside the app."}
            </div>
            <div style={{ color: "#A8AFBA", fontSize: 12 }}>Download it and it will open in your usual program.</div>
            <button type="button" onClick={save} style={{ ...barBtn, marginTop: 14, padding: "9px 18px", background: BRAND_GREEN_DEEP, borderColor: BRAND_GREEN_DEEP }}>
              Download {file.filename}
            </button>
          </div>
        )}
        {status === "error" && (
          <div style={{ color: "#F5C6C6", textAlign: "center", marginTop: 80, fontSize: 14, lineHeight: 1.6 }}>
            <div>{error}</div>
            <button type="button" onClick={save} style={{ ...barBtn, marginTop: 14, padding: "9px 18px" }}>
              Download instead
            </button>
          </div>
        )}
        {status === "ready" && kind === "image" && imgUrl && (
          <div style={{ display: "flex", justifyContent: "center", minHeight: "100%" }}>
            <img
              src={imgUrl}
              alt={file.filename}
              style={zoom === 1 ? { maxWidth: "100%", maxHeight: "calc(100vh - 110px)", objectFit: "contain", alignSelf: "center" } : { width: `${zoom * 100}%`, maxWidth: "none", height: "auto" }}
            />
          </div>
        )}
        {status === "ready" && kind === "pdf" && (
          <>
            {pageNote && <div style={{ color: "#A8AFBA", fontSize: 11, textAlign: "center", marginBottom: 8 }}>{pageNote}</div>}
            <div ref={holderRef} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------- The vault ----------

const box = { background: "#fff", border: "1px solid #C9C4B6" };
const chipBase = { border: "1px solid #C9C4B6", padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const fieldInput = { border: "1px solid #C9C4B6", background: "#fff", padding: "7px 10px", fontSize: 13, boxSizing: "border-box" };

export default function ClientFiles({ client, documents, onClose }) {
  const [files, setFiles] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all"); // all | pdf | image | office
  const [catFilter, setCatFilter] = useState("all");
  const [sort, setSort] = useState("new"); // new | old | name
  const [shown, setShown] = useState(24);
  const [viewIndex, setViewIndex] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDoc, setUploadDoc] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function handleUpload(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file || !uploadDoc) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await uploadDocumentFile(Number(uploadDoc), file);
      await load();
      setNotice(`Added ${file.name}`);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const chip = (key, label) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        setKindFilter(key);
        setShown(24);
      }}
      style={{ ...chipBase, background: kindFilter === key ? BRAND_GREEN_DEEP : "#fff", color: kindFilter === key ? "#EDEAE2" : "#1C2430" }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 52, background: "rgba(28,36,48,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: 960, maxWidth: "100%", maxHeight: "92vh", background: "#FBFAF6", padding: 24, overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 19, fontWeight: 700 }}>Uploaded documents</div>
            <div style={{ fontSize: 12, color: "#8A8577", marginTop: 3 }}>
              {client.company} <span style={{ fontFamily: "monospace" }}>({client.fileNo})</span>
              {files ? ` · ${files.length} file${files.length === 1 ? "" : "s"}` : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", flexShrink: 0 }} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(24);
            }}
            placeholder="Search by file name or code…"
            style={{ ...fieldInput, flex: "1 1 200px" }}
          />
          {chip("all", "All")}
          {chip("pdf", "PDF")}
          {chip("image", "Images")}
          {chip("office", "Word / Excel")}
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
          <button
            type="button"
            onClick={() => setUploadOpen((o) => !o)}
            style={{ display: "flex", alignItems: "center", gap: 5, background: BRAND_GREEN_DEEP, color: "#EDEAE2", border: "none", padding: "8px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
          >
            <Upload size={13} /> Upload a file
          </button>
        </div>

        {uploadOpen && (
          <div style={{ ...box, padding: "12px 14px", marginBottom: 12 }}>
            {documents.length === 0 ? (
              <div style={{ fontSize: 13, color: "#4A4638" }}>
                Files are attached to an entry in the register. This client has no entries yet — use <strong>Log a document</strong> first, then come back to upload the file.
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#4A4638" }}>Attach to</span>
                <select value={uploadDoc} onChange={(e) => setUploadDoc(e.target.value)} style={{ ...fieldInput, flex: "1 1 260px" }}>
                  <option value="">Choose the register entry…</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} — {d.serviceDetail || CATEGORY_LABEL[d.category] || d.category}
                    </option>
                  ))}
                </select>
                <label style={{ background: uploadDoc && !busy ? BRAND_GREEN : "#C9C4B6", color: "#fff", padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: uploadDoc && !busy ? "pointer" : "default" }}>
                  {busy ? "Uploading…" : "Choose file"}
                  <input
                    type="file"
                    disabled={!uploadDoc || busy}
                    onChange={handleUpload}
                    style={{ display: "none" }}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.heic"
                  />
                </label>
                <span style={{ fontSize: 11, color: "#8A8577" }}>PDF, Word, Excel or image, up to 20 MB.</span>
              </div>
            )}
          </div>
        )}

        {error && <div style={{ background: "#F5E1E1", color: "#7A2C2E", padding: "8px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{error}</div>}
        {notice && <div style={{ background: HIGHLIGHT_BG, color: HIGHLIGHT_TEXT, padding: "8px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{notice}</div>}

        {files === null && <div style={{ color: "#8A8577", fontSize: 13 }}>Loading…</div>}
        {files && files.length === 0 && !error && (
          <div style={{ ...box, padding: "28px 16px", textAlign: "center", color: "#8A8577", fontSize: 13 }}>
            No files have been uploaded for this client yet. Use <strong>Upload a file</strong> above, or attach one from the register.
          </div>
        )}
        {files && files.length > 0 && filtered.length === 0 && <div style={{ color: "#8A8577", fontSize: 13 }}>No files match those filters.</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
          {filtered.slice(0, shown).map((f, i) => {
            const kind = kindOf(f);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setViewIndex(i)}
                title={`Open ${f.filename}`}
                style={{ ...box, padding: 0, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", overflow: "hidden" }}
              >
                <Thumb file={f} kind={kind} />
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1C2430", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</div>
                  <div style={{ fontSize: 11, color: "#8A8577", marginTop: 2 }}>
                    {f.serviceDetail || CATEGORY_LABEL[f.category] || f.category}
                  </div>
                  <div style={{ fontSize: 10.5, color: "#8A8577", marginTop: 2 }}>
                    {f.documentCode} · {f.dateReceived} · {formatSize(f.sizeBytes)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {filtered.length > shown && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <button type="button" onClick={() => setShown((n) => n + 24)} style={{ border: "1px solid #C9C4B6", background: "#fff", padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              Show more ({filtered.length - shown} more)
            </button>
          </div>
        )}
      </div>

      {viewIndex !== null && filtered[viewIndex] && (
        <FileViewer files={filtered} index={viewIndex} onIndex={setViewIndex} onClose={() => setViewIndex(null)} />
      )}
    </div>
  );
}
