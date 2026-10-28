// Sends labels to a TSPL label printer (the Gainscha GS-2406T family and similar) on whatever
// computer the app runs on. The printer is not fixed in code: the app lists the printers the
// computer has installed, the user picks one in Printer settings, and the choice and label size are
// saved with the app's data. Labels are sent as raw TSPL text, bypassing the printer driver's page
// layout: through the Windows print spooler on Windows, and through `lp -o raw` on macOS / Linux.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_CONFIG = { printer: process.env.LABEL_PRINTER_QUEUE || "", widthMm: 60, heightMm: 40, gapMm: 2, topMm: 2.5 };
let config = { ...DEFAULT_CONFIG };

// Accepts the saved settings, keeping only sensible values.
function setConfig(next) {
  const n = next || {};
  const num = (v, lo, hi, fallback) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= lo && x <= hi ? x : fallback;
  };
  config = {
    printer: typeof n.printer === "string" ? n.printer.trim().slice(0, 200) : config.printer,
    widthMm: num(n.widthMm, 20, 120, config.widthMm),
    heightMm: num(n.heightMm, 15, 200, config.heightMm),
    gapMm: num(n.gapMm, 0, 10, config.gapMm),
    topMm: num(n.topMm, 0, 8, config.topMm),
  };
  return config;
}
function getConfig() {
  return { ...config };
}
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
  return s.length > max ? s.slice(0, max - 2) + ".." : s;
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

// ---------- Finding and using the computer's printers ----------

function run(cmd, args, { input, env, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(cmd, args, { env: { ...process.env, ...(env || {}) }, windowsHide: true });
    } catch (err) {
      return reject(err);
    }
    let out = "";
    let errText = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`${cmd} took too long to answer`));
    }, timeoutMs);
    proc.stdout.on("data", (c) => { out += c; });
    proc.stderr.on("data", (c) => { errText += c; });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not run '${cmd}': ${err.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(errText.trim() || out.trim() || `${cmd} exited with code ${code}`));
    });
    if (input != null) proc.stdin.write(input);
    proc.stdin.end();
  });
}

// PowerShell scripts are passed encoded, so no quoting problems with printer names.
function powershell(script, env) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { env, timeoutMs: 30000 });
}

const LABEL_PRINTER_HINT = /gainscha|gprinter|godex|tsc|zebra|label|tspl|gs-?\d{4}|ga-?\d{4}|xprinter|munbyn|argox/i;

async function listPrinters() {
  let names = [];
  if (process.platform === "win32") {
    const out = await powershell(
      "$ErrorActionPreference='Stop'; $p = @(Get-Printer | Select-Object Name,DriverName,PortName); if ($p.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $p -Compress }"
    );
    const parsed = JSON.parse(out.trim() || "[]");
    names = (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({ name: p.Name, driver: p.DriverName || "", port: p.PortName || "" }));
  } else {
    let out = "";
    try {
      out = await run("lpstat", ["-e"]);
    } catch {
      out = "";
    }
    names = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name, driver: "", port: "" }));
  }
  return names.map((p) => ({ ...p, looksLikeLabelPrinter: LABEL_PRINTER_HINT.test(`${p.name} ${p.driver}`) }));
}

// With nothing chosen yet, use the only printer that looks like a label printer.
async function resolvePrinter(explicit) {
  const chosen = (explicit || config.printer || "").trim();
  if (chosen) return chosen;
  const printers = await listPrinters();
  const likely = printers.filter((p) => p.looksLikeLabelPrinter);
  if (likely.length === 1) return likely[0].name;
  throw new Error(
    likely.length > 1
      ? "More than one label printer was found. Open Printer settings and choose which one to use."
      : "No label printer is set up yet. Open Printer settings and choose one."
  );
}

// Windows: write the bytes straight to the print queue in RAW mode.
const WIN_RAW_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class FamsRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  public static string Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "Windows could not open the printer '" + printer + "' (error " + Marshal.GetLastWin32Error() + ").";
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "Jardeen label";
    di.pDataType = "RAW";
    string err = "";
    if (StartDocPrinter(h, 1, di)) {
      if (StartPagePrinter(h)) {
        IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, p, bytes.Length);
        int written;
        if (!WritePrinter(h, p, bytes.Length, out written)) err = "Could not send the label to the printer (error " + Marshal.GetLastWin32Error() + ").";
        Marshal.FreeCoTaskMem(p);
        EndPagePrinter(h);
      } else err = "Could not start the print page (error " + Marshal.GetLastWin32Error() + ").";
      EndDocPrinter(h);
    } else err = "Could not start the print job (error " + Marshal.GetLastWin32Error() + ").";
    ClosePrinter(h);
    return err;
  }
}
"@
$bytes = [System.IO.File]::ReadAllBytes($env:FAMS_LABEL_FILE)
$result = [FamsRawPrint]::Send($env:FAMS_LABEL_PRINTER, $bytes)
if ($result) { [Console]::Error.WriteLine($result); exit 1 }
`;

async function sendRawTSPL(tspl, printerName) {
  const printer = await resolvePrinter(printerName);
  const file = path.join(os.tmpdir(), `fams-label-${Date.now()}-${Math.random().toString(16).slice(2)}.tspl`);
  fs.writeFileSync(file, Buffer.from(String(tspl), "latin1"));
  try {
    if (process.platform === "win32") {
      await powershell(WIN_RAW_SCRIPT, { FAMS_LABEL_PRINTER: printer, FAMS_LABEL_FILE: file });
    } else {
      await run("lp", ["-d", printer, "-o", "raw", file]);
    }
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* temp file already gone */
    }
  }
  return printer;
}
function header() {
  return `SIZE ${config.widthMm} mm, ${config.heightMm} mm\nGAP ${config.gapMm} mm, 0 mm\nCLS\nREFERENCE 0,${Math.round(config.topMm * 8)}\n`;
}

// Where the paper is kept is only printed when someone actually entered a place.
// Digital-only entries have no shelf, so they print nothing there.
function placeText(location) {
  const s = String(location || "").trim();
  if (!s || /^digital copy/i.test(s)) return "";
  return s;
}

// Splits text into at most `maxLines` lines of `maxChars` characters, breaking at spaces.
function wrapText(text, maxChars, maxLines) {
  const words = tsplEscape(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const word = w.length > maxChars ? w.slice(0, maxChars) : w;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, Math.max(0, maxChars - 2)) + "..";
  }
  return lines;
}

// The bottom strip every label shares: when it came in and who received it.
function receivedFooter(dateReceived, receivedBy, y) {
  let t = `BAR 15,${y},450,2\n`;
  t += `TEXT 15,${y + 8},"0",0,1,1,"DATE RECEIVED"\n`;
  t += `TEXT 15,${y + 24},"3",0,1,1,"${truncate(formatDate(dateReceived), 14)}"\n`;
  t += `TEXT 250,${y + 8},"0",0,1,1,"RECEIVED BY"\n`;
  t += `TEXT 250,${y + 24},"3",0,1,1,"${truncate(receivedBy, 13)}"\n`;
  return t;
}

// The place the paper is kept, printed beside the QR code, only when entered.
function placeBlock(x, y, location) {
  const place = placeText(location);
  if (!place) return "";
  let t = `TEXT ${x},${y},"0",0,1,1,"KEPT AT"\n`;
  wrapText(place, 26, 4).forEach((line, i) => {
    t += `TEXT ${x},${y + 18 + i * 18},"1",0,1,1,"${line}"\n`;
  });
  return t;
}

// Mirrors the on-screen <Label> component: client name, code, a large scannable
// QR (about 21 mm square), the category, the date received and who received it.
// The place the paper is kept is shown only when one was entered.
function buildDocumentLabelTSPL({ categoryLabel, clientName, code, location, dateReceived, receivedBy }) {
  let t = header();
  t += `TEXT 15,10,"3",0,1,1,"${truncate(clientName, 26)}"\n`;
  t += `TEXT 15,44,"2",0,1,1,"${truncate(code, 24)}"\n`;
  t += `BAR 15,72,450,2\n`;
  t += `QRCODE 15,82,L,7,A,0,"${tsplEscape(code)}"\n`;
  t += boldText(190, 92, "2", 1, truncate(categoryLabel, 22).toUpperCase());
  t += placeBlock(190, 132, location);
  t += receivedFooter(dateReceived, receivedBy, 238);
  t += `PRINT 1\n`;
  return t;
}

// Mirrors <BoxLabel>: a bulk box/bag intake that hasn't been sorted yet.
function buildBoxLabelTSPL({ clientName, code, location, batchCount, dateReceived, receivedBy }) {
  let t = header();
  t += `TEXT 15,8,"1",0,1,1,"BULK INTAKE - NOT YET SORTED"\n`;
  t += `TEXT 15,28,"3",0,1,1,"${truncate(clientName, 26)}"\n`;
  t += `TEXT 15,62,"1",0,1,1,"${truncate(code, 20)}${batchCount ? `   ~${batchCount} docs` : ""}"\n`;
  t += `BAR 15,82,450,2\n`;
  t += `QRCODE 15,92,L,6,A,0,"${tsplEscape(code)}"\n`;
  t += placeBlock(190, 102, location);
  t += receivedFooter(dateReceived, receivedBy, 232);
  t += `PRINT 1\n`;
  return t;
}

// Mirrors <ClientLabel>: the label stuck on a client's physical folder or box. It is keyed
// by file number, so scanning it opens that client with everything filed under them.
// `boxNote` is optional text such as "Box 2 of 3 - FY2024 records" for clients with several boxes.
function buildClientFolderLabelTSPL({ company, roc, fileNo, boxNote }) {
  let t = header();
  const nameLines = wrapText(company, 28, 2);
  nameLines.forEach((line, i) => {
    t += `TEXT 15,${10 + i * 28},"3",0,1,1,"${line}"\n`;
  });
  const top = nameLines.length > 1 ? 70 : 44;
  t += `BAR 15,${top},450,2\n`;
  t += `QRCODE 15,${top + 10},L,8,A,0,"${tsplEscape(fileNo)}"\n`;
  const fn = String(fileNo || "");
  const big = fn.length <= 6;
  t += `TEXT 215,${top + 18},"0",0,1,1,"FILE NO."\n`;
  t += boldText(215, top + 36, big ? "5" : "4", 1, truncate(fn, big ? 6 : 10));
  if (boxNote) {
    wrapText(boxNote, 16, 2).forEach((line, i) => {
      t += boldText(215, top + 100 + i * 26, "3", 1, line);
    });
  }
  t += `BAR 15,240,450,2\n`;
  t += `TEXT 15,250,"2",0,1,1,"${roc ? truncate(`ROC ${roc}`, 24) : "JARDEEN MANAGEMENT"}"\n`;
  t += `PRINT 1\n`;
  return t;
}
module.exports = {
  setConfig,
  getConfig,
  listPrinters,
  resolvePrinter,
  CATEGORY_INFO,
  sendRawTSPL,
  buildDocumentLabelTSPL,
  buildBoxLabelTSPL,
  buildClientFolderLabelTSPL,
};
