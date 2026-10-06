// Sends labels directly to the Gainscha GS-2406T over its raw CUPS queue.
// This printer only understands TSPL2 (its own raw command language) — it
// has no usable Linux driver, so printing means generating TSPL text
// ourselves and handing it to `lp -o raw`, not going through a browser
// print dialog or a PPD.
const { spawn } = require("child_process");

const PRINTER_QUEUE = process.env.LABEL_PRINTER_QUEUE || "gainscha2406t";

// Confirmed by a real test print — see LABEL_PRINTER_QUEUE setup notes.
// If labels come out cut off or with a lot of blank space, this is the
// first thing to adjust (it must match the label stock actually loaded).
const LABEL_WIDTH_MM = Number(process.env.LABEL_WIDTH_MM || 40);
const LABEL_HEIGHT_MM = Number(process.env.LABEL_HEIGHT_MM || 30);
const GAP_MM = Number(process.env.LABEL_GAP_MM || 2);

// Mirrors dashboard/src/App.jsx's CATEGORIES — kept here too since the
// backend builds label text itself rather than trusting it from the client.
const CATEGORY_INFO = {
  secretarial: { label: "Secretarial records", sensitivity: "High" },
  bookkeeping: { label: "Bookkeeping", sensitivity: "Medium" },
  banking_tax: { label: "Banking & tax details", sensitivity: "High" },
  personal: { label: "Personal particulars", sensitivity: "Critical" },
};

function tsplEscape(text) {
  return String(text || "").replace(/["\\]/g, "").replace(/[\r\n]+/g, " ");
}

function truncate(text, max) {
  const s = tsplEscape(text);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// TSPL's built-in bitmap fonts have no bold variant — the standard
// workaround is printing the same text twice, offset by one dot, so the
// strokes double up.
function boldText(x, y, font, mult, content) {
  return (
    `TEXT ${x},${y},"${font}",0,${mult},${mult},"${content}"\n` +
    `TEXT ${x + 1},${y},"${font}",0,${mult},${mult},"${content}"\n`
  );
}

// "2026-09-11" -> "11 Sep 2026" — matches the readable format on the
// reference test print. Hand-mapped rather than Intl's toLocaleDateString,
// since en-GB's CLDR data abbreviates September as "Sept", not "Sep".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDate(isoDate) {
  if (!isoDate) return "";
  const s = String(isoDate).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const [, y, mo, d] = m;
  return `${d} ${MONTHS[Number(mo) - 1]} ${y}`;
}

function sendRawTSPL(tspl) {
  return new Promise((resolve, reject) => {
    const proc = spawn("lp", ["-d", PRINTER_QUEUE, "-o", "raw"]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    proc.on("error", (err) => reject(new Error(`Could not run 'lp': ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `lp exited with code ${code}`));
    });
    proc.stdin.write(tspl);
    proc.stdin.end();
  });
}

function header() {
  return `SIZE ${LABEL_WIDTH_MM} mm, ${LABEL_HEIGHT_MM} mm\nGAP ${GAP_MM} mm, 0 mm\nCLS\n`;
}

// Mirrors the on-screen <Label> component: client name, category, a real
// scannable QR of the code (the on-screen version is just decorative
// dashes), and the date received given its own large, clearly legible
// line — the one field staff most need to read at a glance.
function buildDocumentLabelTSPL({ categoryLabel, clientName, code, location, dateReceived }) {
  let t = header();
  t += `TEXT 15,12,"3",0,1,1,"${truncate(clientName, 26)}"\n`;
  t += `TEXT 15,48,"1",0,1,1,"${truncate(code, 20)}"\n`;
  t += `BAR 15,68,450,2\n`;
  t += `QRCODE 15,84,L,4,A,0,"${tsplEscape(code)}"\n`;
  t += boldText(300, 100, "2", 1, truncate(categoryLabel, 14).toUpperCase());
  t += `BAR 15,212,450,2\n`;
  t += `TEXT 15,224,"0",0,1,1,"DATE RECEIVED"\n`;
  t += `TEXT 15,244,"3",0,1,1,"${truncate(formatDate(dateReceived), 20)}"\n`;
  if (location) {
    t += `TEXT 15,292,"0",0,1,1,"${truncate(location, 42)}"\n`;
  }
  t += `PRINT 1\n`;
  return t;
}

// Mirrors <BoxLabel>: a bulk box/bag intake that hasn't been sorted yet.
function buildBoxLabelTSPL({ clientName, code, location, batchCount, dateReceived }) {
  let t = header();
  t += `TEXT 15,10,"1",0,1,1,"BULK INTAKE — NOT YET SORTED"\n`;
  t += `TEXT 15,32,"3",0,1,1,"${truncate(clientName, 26)}"\n`;
  t += `TEXT 15,68,"1",0,1,1,"${truncate(code, 20)}${batchCount ? `   ~${batchCount} docs` : ""}"\n`;
  t += `BAR 15,92,450,2\n`;
  t += `QRCODE 15,108,L,4,A,0,"${tsplEscape(code)}"\n`;
  t += `BAR 15,212,450,2\n`;
  t += `TEXT 15,224,"0",0,1,1,"DATE RECEIVED"\n`;
  t += `TEXT 15,244,"3",0,1,1,"${truncate(formatDate(dateReceived), 20)}"\n`;
  if (location) {
    t += `TEXT 15,292,"0",0,1,1,"${truncate(location, 42)}"\n`;
  }
  t += `PRINT 1\n`;
  return t;
}

// Mirrors <ClientLabel>: a folder/master-file label for the client's
// physical file, keyed by file number rather than a document code. No
// "date received" here — it's the file itself, not an intake event.
function buildClientFolderLabelTSPL({ company, roc, fileNo }) {
  let t = header();
  t += `TEXT 15,12,"3",0,1,1,"${truncate(company, 26)}"\n`;
  t += `TEXT 15,48,"1",0,1,1,"CLIENT MASTER FILE"\n`;
  if (roc) {
    t += `TEXT 260,42,"2",0,1,1,"${truncate(`ROC ${roc}`, 16)}"\n`;
  }
  t += `BAR 15,68,450,2\n`;
  t += `QRCODE 15,84,L,4,A,0,"${tsplEscape(fileNo)}"\n`;
  t += `TEXT 160,150,"3",0,1,1,"${truncate(fileNo, 18)}"\n`;
  t += `PRINT 1\n`;
  return t;
}

module.exports = {
  PRINTER_QUEUE,
  CATEGORY_INFO,
  sendRawTSPL,
  buildDocumentLabelTSPL,
  buildBoxLabelTSPL,
  buildClientFolderLabelTSPL,
};
