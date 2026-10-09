// Pure helpers for the digital KYC form: the ID-number check, and the PDF copy.
//
// The PDF is the filled form drawn onto an A4 page (so it looks like the paper
// form, including any Chinese characters and the on-screen signature) and
// wrapped as a PDF. No library needed, and it works offline.
//
// Nothing the customer typed is ever silently cut off: boxes grow to fit the
// text, long text shrinks or wraps, and if something still can't fit it is
// shortened on page 1 with its full text printed on a continuation page 2.

// ---------- Singapore NRIC / FIN check ----------
// Returns { kind }: "empty" | "valid" | "invalid" | "unchecked" | "other".
//   valid / invalid — an S/T (NRIC) or F/G (FIN) number whose check letter does / doesn't match
//   unchecked       — an M-series FIN (format fine, check letter not verified here)
//   other           — doesn't look like a Singapore number (e.g. another country's ID)
export function checkSgId(raw) {
  const v = String(raw || "").trim().toUpperCase();
  if (!v) return { kind: "empty" };
  if (!/^[STFGM]\d{7}[A-Z]$/.test(v)) return { kind: "other" };
  const first = v[0];
  if (first === "M") return { kind: "unchecked" };
  const weights = [2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(v[i + 1]) * weights[i];
  if (first === "T" || first === "G") sum += 4;
  const remainder = sum % 11;
  const expected = first === "S" || first === "T" ? "JZIHGFEDCBA"[remainder] : "XWUTRQPNMLK"[remainder];
  return { kind: expected === v[8] ? "valid" : "invalid" };
}

export function isoToDisplay(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return iso || "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

// Server row (snake_case) → the shape the form drawing uses.
export function kycRowToData(row, companyName) {
  let residence = [];
  try {
    residence = JSON.parse(row.residence || "[]");
  } catch {
    residence = [];
  }
  return {
    companyName,
    role: row.role || "",
    fullName: row.full_name,
    chineseName: row.chinese_name || "",
    birthplace: row.birthplace,
    dateOfBirth: row.date_of_birth,
    nationalityCurrent: row.nationality_current,
    nationalityBirth: row.nationality_birth,
    travelDocType: row.travel_doc_type || "",
    travelDocNo: row.travel_doc_no || "",
    travelDocIssueDate: row.travel_doc_issue_date || "",
    travelDocCountry: row.travel_doc_country || "",
    idCardNo: row.id_card_no || "",
    idCardIssueDate: row.id_card_issue_date || "",
    idCardCountry: row.id_card_country || "",
    addressSg: row.address_sg || "",
    phone: row.phone || "",
    email: row.email || "",
    addressOverseas: row.address_overseas || "",
    addressOther: row.address_other || "",
    residence,
    completedByName: row.completed_by_name,
    signature: row.signature,
    consentText: row.consent_text,
    completedAt: row.consented_at || row.created_at || "",
    handedBy: row.handed_by || "",
    signatureMethod: row.signature_method || "screen",
  };
}

// ---------- Text measuring and fitting ----------

export const PAGE_W = 1240; // A4 at 150 dpi
export const PAGE_H = 1754;
const FONT = '"Segoe UI", "Microsoft YaHei", "SimSun", "Noto Sans CJK SC", Arial, sans-serif';

export function setFont(ctx, size, bold) {
  ctx.font = `${bold ? "700 " : ""}${size}px ${FONT}`;
}
export function measure(ctx, str, size, bold) {
  setFont(ctx, size, bold);
  return ctx.measureText(str).width;
}

export function drawText(ctx, str, x, y, { size = 26, bold = false, color = "#111", align = "left" } = {}) {
  setFont(ctx, size, bold);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(str || ""), x, y);
}

export function ellipsize(ctx, str, size, bold, maxW) {
  let s = String(str || "");
  if (measure(ctx, s, size, bold) <= maxW) return s;
  while (s.length > 1 && measure(ctx, `${s}…`, size, bold) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

// Splits text to fit maxW at the given size: on spaces where possible, and
// inside a word only when a single word is wider than the line (long emails, IDs).
export function wrapText(ctx, str, size, bold, maxW) {
  const lines = [];
  for (const para of String(str || "").split("\n")) {
    let line = "";
    const flush = () => {
      if (line) lines.push(line);
      line = "";
    };
    for (const word of para.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (measure(ctx, test, size, bold) <= maxW) {
        line = test;
        continue;
      }
      flush();
      if (measure(ctx, word, size, bold) <= maxW) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const ch of word) {
        if (measure(ctx, chunk + ch, size, bold) > maxW && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    }
    flush();
    if (para === "") lines.push("");
  }
  return lines.length ? lines : [""];
}

// Wraps to at most maxLines; marks the block truncated if text had to be cut.
export function wrapBlock(ctx, str, size, bold, maxW, maxLines) {
  const all = wrapText(ctx, str, size, bold, maxW);
  if (all.length <= maxLines) return { lines: all, truncated: false };
  const lines = all.slice(0, maxLines);
  lines[maxLines - 1] = ellipsize(ctx, `${lines[maxLines - 1]}…`, size, bold, maxW);
  return { lines, truncated: true };
}

// "Label: VALUE". The value sits after the label if it fits (shrinking a little
// if needed); otherwise it drops below the label and wraps over up to maxLines.
export function plan(ctx, label, value, w, maxLines) {
  const val = String(value || "").replace(/\s+/g, " ").trim();
  const labelW = label ? measure(ctx, `${label} `, 24, false) : 0;
  const base = { label, labelW, val, truncated: false };
  if (!val) return { ...base, mode: "inline", size: 28, lines: [""], h: 34 };
  for (const size of [28, 26, 24, 22]) {
    if (measure(ctx, val, size, true) <= w - labelW) return { ...base, mode: "inline", size, lines: [val], h: 34 };
  }
  if (maxLines <= 1) {
    return { ...base, mode: "inline", size: 22, lines: [ellipsize(ctx, val, 22, true, w - labelW)], h: 34, truncated: true };
  }
  const block = wrapBlock(ctx, val, 22, true, w, maxLines);
  return { ...base, mode: "stack", size: 22, lines: block.lines, h: (label ? 30 : 0) + block.lines.length * 30 + 4, truncated: block.truncated };
}

export function paintPlan(ctx, p, x, yTop) {
  if (p.mode === "inline") {
    if (p.label) drawText(ctx, p.label, x, yTop + 26, { size: 24, color: "#444" });
    drawText(ctx, p.lines[0], x + p.labelW, yTop + 26, { size: p.size, bold: true });
  } else {
    if (p.label) drawText(ctx, p.label, x, yTop + 24, { size: 24, color: "#444" });
    p.lines.forEach((ln, i) => drawText(ctx, ln, x, yTop + (p.label ? 56 : 26) + i * 30, { size: p.size, bold: true }));
  }
}

// ---------- The form page ----------

const X = 80;
const R = 1160;
const NUM = 60;
const TOP = 170;
const SPLIT = 760;
const L = X + NUM + 20; // left text edge inside a row
const M = SPLIT + 20; // left text edge right of the split
const AX = 520; // address column split
const MAX_TOTAL = 1240; // tallest the table may be before the signature block would collide

function layoutForm(ctx, d, maxLines) {
  const overflow = [];
  const note = (p, label) => {
    if (p.truncated) overflow.push({ label, value: p.val });
    return p;
  };
  const wL = SPLIT - L - 20;
  const wR = R - M - 20;
  const wN = R - 470 - 20;
  const wA = R - AX - 40;
  const P = {
    name: note(plan(ctx, "Name:", d.fullName, wL, maxLines), "Name"),
    chinese: note(plan(ctx, "Chinese Characters:", d.chineseName, wR, maxLines), "Chinese characters"),
    birthplace: note(plan(ctx, "Town & Place of Birth:", d.birthplace, wL, maxLines), "Town & place of birth"),
    dob: plan(ctx, "Date of Birth:", isoToDisplay(d.dateOfBirth), wR, 1),
    natA: note(plan(ctx, "(a) Current:", d.nationalityCurrent, wN, maxLines), "Nationality — current"),
    natB: note(plan(ctx, "(b) At Birth:", d.nationalityBirth, wN, maxLines), "Nationality — at birth"),
    tdNo: note(plan(ctx, "Travel Document Number:", d.travelDocNo, wL, maxLines), "Travel document number"),
    tdDate: plan(ctx, "Date of Issue:", isoToDisplay(d.travelDocIssueDate), wR, 1),
    tdCountry: note(plan(ctx, "Country of Issue:", d.travelDocCountry, wR, maxLines), "Travel document — country of issue"),
    idNo: note(plan(ctx, "Identity Card Number:", d.idCardNo, wL, maxLines), "Identity card number"),
    idDate: plan(ctx, "(a) Date of Issue:", isoToDisplay(d.idCardIssueDate), wR, 1),
    idCountry: note(plan(ctx, "(b) Country of Issue:", d.idCardCountry, wR, maxLines), "Identity card — country of issue"),
  };
  const typeLine = d.travelDocType ? ellipsize(ctx, `(${d.travelDocType})`, 22, false, wL) : "";

  // Address block (a): address lines, then phone, then email
  const addr = wrapBlock(ctx, d.addressSg || "NIL", 26, true, wA, Math.min(maxLines + 1, 4));
  if (addr.truncated) overflow.push({ label: "Address in Singapore", value: d.addressSg });
  const phone = wrapBlock(ctx, d.phone ? `HP: ${d.phone}` : "", 25, true, wA, 1);
  if (d.phone && phone.truncated) overflow.push({ label: "Phone", value: d.phone });
  let email = { lines: [], truncated: false };
  if (d.email) {
    email = measure(ctx, d.email, 25, true) <= wA ? { lines: [d.email], size: 25, truncated: false } : { ...wrapBlock(ctx, d.email, 22, true, wA, 2), size: 22 };
    if (email.truncated) overflow.push({ label: "Email", value: d.email });
  }
  const overseas = wrapBlock(ctx, d.addressOverseas || "NIL", 24, true, wA, maxLines);
  if (overseas.truncated) overflow.push({ label: "Address overseas", value: d.addressOverseas });
  const other = wrapBlock(ctx, d.addressOther || "NIL", 24, true, wA, maxLines);
  if (other.truncated) overflow.push({ label: "Other address", value: d.addressOther });

  const hasRes = Array.isArray(d.residence) && d.residence.length > 0;
  const residence = (hasRes ? d.residence.slice(0, 5) : []).map((r, i) => {
    const cw = R - (X + NUM + 500) - 32;
    const country = ellipsize(ctx, r.country, 24, true, cw);
    if (country !== r.country) overflow.push({ label: `Country of residence ${i + 1}`, value: r.country });
    return { from: isoToDisplay(r.from), to: isoToDisplay(r.to), country };
  });
  if (hasRes && d.residence.length > 5) overflow.push({ label: "More countries of residence", value: d.residence.slice(5).map((r) => `${r.country} (${isoToDisplay(r.from)} to ${isoToDisplay(r.to)})`).join("; ") });

  // Row heights
  const h1 = Math.max(76, 24 + Math.max(P.name.h, P.chinese.h));
  const h2 = Math.max(76, 24 + Math.max(P.birthplace.h, P.dob.h));
  const natA = 8 + P.natA.h + 6;
  const natB = 8 + P.natB.h + 6;
  const h3 = Math.max(100, natA + natB);
  const tdA = Math.max(56, 8 + P.tdDate.h + 6);
  const tdB = Math.max(56, 8 + P.tdCountry.h + 6);
  const h4 = Math.max(128, 24 + P.tdNo.h + (typeLine ? 34 : 0), tdA + tdB);
  const idA = Math.max(56, 8 + P.idDate.h + 6);
  const idB = Math.max(56, 8 + P.idCountry.h + 6);
  const h5 = Math.max(128, 24 + P.idNo.h, idA + idB);
  const aH = Math.max(130, 16 + addr.lines.length * 32 + (d.phone ? 34 : 0) + email.lines.length * 30 + 12);
  const bH = Math.max(60, 14 + overseas.lines.length * 30 + 10);
  const cH = Math.max(60, 14 + other.lines.length * 30 + 10);
  const h6 = aH + bH + cH;
  const h7 = 70 + 42 + 5 * 38;
  const rows = [h1, h2, h3, h4, h5, h6, h7];
  const total = rows.reduce((a, b) => a + b, 0);
  return { P, rows, total, overflow, typeLine, addr, phone, email, overseas, other, residence, hasRes, natA, tdA, idA, aH, bH };
}

// Chooses the roomiest layout that still leaves space for the signature block.
function bestLayout(ctx, d) {
  for (const maxLines of [3, 2, 1]) {
    const lay = layoutForm(ctx, d, maxLines);
    if (lay.total <= MAX_TOTAL || maxLines === 1) return lay;
  }
  return null;
}

export function drawKycForm(ctx, d, sigImg) {
  const lay = bestLayout(ctx, d);
  const { P, rows, total } = lay;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;

  const hLine = (yy, x1 = X, x2 = R) => {
    ctx.beginPath();
    ctx.moveTo(x1, yy);
    ctx.lineTo(x2, yy);
    ctx.stroke();
  };
  const vLine = (xx, y1, y2) => {
    ctx.beginPath();
    ctx.moveTo(xx, y1);
    ctx.lineTo(xx, y2);
    ctx.stroke();
  };

  // Header
  drawText(ctx, "PERSONAL PARTICULARS FORM", 80, 92, { size: 36, bold: true });
  drawText(ctx, ellipsize(ctx, `${d.companyName || ""}${d.role ? `   ·   ${d.role}` : ""}`, 24, false, 1000), 80, 134, { size: 24, color: "#444" });

  // Frame, number column, row lines, row numbers
  ctx.strokeRect(X, TOP, R - X, total);
  vLine(X + NUM, TOP, TOP + total);
  const ys = [];
  let acc = TOP;
  rows.forEach((h, i) => {
    ys.push(acc);
    if (i > 0) hLine(acc);
    drawText(ctx, String(i + 1), X + NUM / 2, acc + h / 2 + 8, { size: 24, color: "#333", align: "center" });
    acc += h;
  });

  // One-line values are centred in their box; wrapped ones start near the top.
  const cy = (p, top, h) => (p.mode === "inline" ? top + Math.max(8, (h - p.h) / 2) : top + 12);

  // 1 Name | Chinese characters
  vLine(SPLIT, ys[0], ys[0] + rows[0]);
  paintPlan(ctx, P.name, L, cy(P.name, ys[0], rows[0]));
  paintPlan(ctx, P.chinese, M, cy(P.chinese, ys[0], rows[0]));

  // 2 Town & place of birth | Date of birth
  vLine(SPLIT, ys[1], ys[1] + rows[1]);
  paintPlan(ctx, P.birthplace, L, cy(P.birthplace, ys[1], rows[1]));
  paintPlan(ctx, P.dob, M, cy(P.dob, ys[1], rows[1]));

  // 3 Nationality
  drawText(ctx, "Nationality / Citizenship", L, ys[2] + rows[2] / 2 + 8, { size: 26, color: "#222" });
  paintPlan(ctx, P.natA, 470, ys[2] + 8);
  paintPlan(ctx, P.natB, 470, ys[2] + lay.natA + 8);

  // 4 Travel document | issue details
  vLine(SPLIT, ys[3], ys[3] + rows[3]);
  hLine(ys[3] + lay.tdA, SPLIT, R);
  paintPlan(ctx, P.tdNo, L, ys[3] + 12);
  if (lay.typeLine) drawText(ctx, lay.typeLine, L, ys[3] + 12 + P.tdNo.h + 30, { size: 22, color: "#444" });
  paintPlan(ctx, P.tdDate, M, ys[3] + 8);
  paintPlan(ctx, P.tdCountry, M, ys[3] + lay.tdA + 8);

  // 5 Identity card | issue details
  vLine(SPLIT, ys[4], ys[4] + rows[4]);
  hLine(ys[4] + lay.idA, SPLIT, R);
  paintPlan(ctx, P.idNo, L, cy(P.idNo, ys[4], rows[4]));
  paintPlan(ctx, P.idDate, M, ys[4] + 8);
  paintPlan(ctx, P.idCountry, M, ys[4] + lay.idA + 8);

  // 6 Addresses
  vLine(AX, ys[5], ys[5] + rows[5]);
  hLine(ys[5] + lay.aH, AX, R);
  hLine(ys[5] + lay.aH + lay.bH, AX, R);
  drawText(ctx, "Address In:", L, ys[5] + 48, { size: 26, color: "#222" });
  drawText(ctx, "(a) Singapore", L + 40, ys[5] + 90, { size: 24, color: "#444" });
  drawText(ctx, "(b) Overseas", L + 40, ys[5] + lay.aH + 38, { size: 24, color: "#444" });
  drawText(ctx, "(c) Others", L + 40, ys[5] + lay.aH + lay.bH + 38, { size: 24, color: "#444" });
  let ay = ys[5] + 38;
  lay.addr.lines.forEach((ln, i) => drawText(ctx, ln, AX + 20, ay + i * 32, { size: 26, bold: true }));
  ay += lay.addr.lines.length * 32 + 2;
  if (lay.phone.lines[0]) {
    drawText(ctx, lay.phone.lines[0], AX + 20, ay, { size: 25, bold: true });
    ay += 34;
  }
  lay.email.lines.forEach((ln, i) => drawText(ctx, ln, AX + 20, ay + i * 30, { size: lay.email.size, bold: true }));
  lay.overseas.lines.forEach((ln, i) => drawText(ctx, ln, AX + 20, ys[5] + lay.aH + 38 + i * 30, { size: 24, bold: true }));
  lay.other.lines.forEach((ln, i) => drawText(ctx, ln, AX + 20, ys[5] + lay.aH + lay.bH + 38 + i * 30, { size: 24, bold: true }));

  // 7 Countries of residence
  drawText(ctx, "Countries of Residence (if different from Country of Birth):", L, ys[6] + 46, { size: 24, color: "#222" });
  if (!lay.hasRes) drawText(ctx, "N.A.", L + 830, ys[6] + 46, { size: 28, bold: true });
  hLine(ys[6] + 70, X + NUM, R);
  const tx0 = X + NUM;
  const cFrom = tx0 + 250;
  const cTo = cFrom + 250;
  hLine(ys[6] + 112, tx0, R);
  vLine(cFrom, ys[6] + 70, ys[6] + rows[6]);
  vLine(cTo, ys[6] + 70, ys[6] + rows[6]);
  drawText(ctx, "From", tx0 + 125, ys[6] + 100, { size: 23, color: "#444", align: "center" });
  drawText(ctx, "To", cFrom + 125, ys[6] + 100, { size: 23, color: "#444", align: "center" });
  drawText(ctx, "Country", cTo + (R - cTo) / 2, ys[6] + 100, { size: 23, color: "#444", align: "center" });
  for (let i = 0; i < 5; i++) {
    const ry = ys[6] + 112 + i * 38;
    if (i > 0) hLine(ry, tx0, R);
    const r = lay.residence[i];
    if (r) {
      drawText(ctx, r.from, tx0 + 125, ry + 27, { size: 23, bold: true, align: "center" });
      drawText(ctx, r.to, cFrom + 125, ry + 27, { size: 23, bold: true, align: "center" });
      drawText(ctx, r.country, cTo + 16, ry + 27, { size: 24, bold: true });
    }
  }

  // Confirmation (left) and signature (right)
  const bottom = TOP + total;
  const sigLineY = Math.max(bottom + 150, 1530);
  drawText(ctx, "Confirmation", X, bottom + 48, { size: 22, bold: true, color: "#333" });
  const conf = wrapBlock(ctx, d.consentText || "", 19, false, 560, 8);
  conf.lines.forEach((ln, i) => drawText(ctx, ln, X, bottom + 78 + i * 25, { size: 19, color: "#333" }));
  if (sigImg) {
    const scale = Math.min(420 / sigImg.width, 120 / sigImg.height, 1.5);
    const w = sigImg.width * scale;
    const h = sigImg.height * scale;
    ctx.drawImage(sigImg, 930 - w / 2, sigLineY - h - 4, w, h);
  }
  const byHand = d.signatureMethod === "paper";
  if (byHand) drawText(ctx, "Please sign here by hand", 930, sigLineY - 50, { size: 21, color: "#999", align: "center" });
  hLine(sigLineY, 700, R);
  drawText(ctx, "Signature", 930, sigLineY + 30, { size: 22, color: "#444", align: "center" });
  const nameSize = [28, 25, 22, 19].find((s) => measure(ctx, d.completedByName, s, true) <= 440) || 19;
  let completedBy = d.completedByName;
  if (measure(ctx, completedBy, nameSize, true) > 440) {
    completedBy = ellipsize(ctx, completedBy, nameSize, true, 440);
    lay.overflow.push({ label: "Name of person completing this form", value: d.completedByName });
  }
  drawText(ctx, completedBy, 930, sigLineY + 78, { size: nameSize, bold: true, align: "center" });
  hLine(sigLineY + 90, 700, R);
  drawText(ctx, "Name of Person Completing this Form", 930, sigLineY + 118, { size: 22, color: "#444", align: "center" });

  // Footer
  const footer = `Completed on screen${d.completedAt ? ` on ${d.completedAt}` : ""}${d.handedBy ? ` · handled by ${d.handedBy}` : ""} · ${byHand ? "to be signed by hand on the printed copy" : "signed digitally"}`;
  drawText(ctx, ellipsize(ctx, footer, 17, false, R - X), X, PAGE_H - 36, { size: 17, color: "#777" });
  if (lay.overflow.length) {
    drawText(ctx, "Some entries are shown in short form — their full text is on page 2.", X, PAGE_H - 74, { size: 21, bold: true, color: "#A63D40" });
  }
  return lay.overflow;
}

// Page 2: the full text of anything that had to be shortened on page 1.
export function drawKycAnnex(ctx, d, overflow, sigImg) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  drawText(ctx, "CONTINUATION SHEET", 80, 92, { size: 36, bold: true });
  drawText(ctx, ellipsize(ctx, `Full text of entries shortened on page 1  ·  ${d.fullName}  ·  ${d.companyName || ""}`, 24, false, 1080), 80, 134, { size: 24, color: "#444" });
  let y = 200;
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1;
  for (const item of overflow) {
    const lines = wrapText(ctx, item.value, 26, true, 1000);
    const need = 40 + lines.length * 34 + 24;
    if (y + need > PAGE_H - 120) {
      drawText(ctx, "(more entries could not be shown — see the stored record in the app)", 80, y + 20, { size: 20, color: "#A63D40" });
      break;
    }
    drawText(ctx, item.label, 80, y + 26, { size: 22, color: "#444" });
    lines.forEach((ln, i) => drawText(ctx, ln, 80, y + 64 + i * 34, { size: 26, bold: true }));
    y += need;
    ctx.beginPath();
    ctx.moveTo(80, y - 10);
    ctx.lineTo(1160, y - 10);
    ctx.stroke();
  }
  // Repeat the signature so this page can't be separated from the signed form.
  const lineY = PAGE_H - 150;
  if (sigImg) {
    const scale = Math.min(360 / sigImg.width, 100 / sigImg.height, 1.5);
    ctx.drawImage(sigImg, 930 - (sigImg.width * scale) / 2, lineY - sigImg.height * scale - 4, sigImg.width * scale, sigImg.height * scale);
  }
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(700, lineY);
  ctx.lineTo(R, lineY);
  ctx.stroke();
  drawText(ctx, ellipsize(ctx, d.completedByName, 22, true, 440), 930, lineY + 30, { size: 22, bold: true, align: "center" });
  drawText(ctx, "Signature of person completing the form", 930, lineY + 58, { size: 19, color: "#444", align: "center" });
  drawText(ctx, `Completed on screen${d.completedAt ? ` on ${d.completedAt}` : ""} · page 2 of 2`, 80, PAGE_H - 36, { size: 17, color: "#777" });
}

// ---------- PDF around JPEG page images ----------

export function buildPdf(jpegs, widthPx, heightPx, title) {
  const enc = (s) => new TextEncoder().encode(s);
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (u8) => {
    parts.push(u8);
    length += u8.length;
  };
  const object = (n, dict, stream) => {
    offsets[n] = length;
    push(enc(`${n} 0 obj\n${dict}`));
    if (stream) {
      push(enc("\nstream\n"));
      push(stream);
      push(enc("\nendstream"));
    }
    push(enc("\nendobj\n"));
  };

  const safeTitle = String(title || "KYC form").replace(/[^\x20-\x7e]/g, "").replace(/([()\\])/g, "\\$1");
  const pageW = 595.28;
  const pageH = 841.89;
  const content = enc(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`);
  const n = jpegs.length;
  const pageId = (i) => 3 + i * 3;
  const infoId = 3 + n * 3;

  push(enc("%PDF-1.4\n"));
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${jpegs.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] /Count ${n} >>`);
  jpegs.forEach((jpeg, i) => {
    const p = pageId(i);
    object(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${p + 1} 0 R >> >> /Contents ${p + 2} 0 R >>`);
    object(p + 1, `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
    object(p + 2, `<< /Length ${content.length} >>`, content);
  });
  object(infoId, `<< /Title (${safeTitle}) /Producer (FAMS digital KYC form) >>`);

  const xref = length;
  let table = `xref\n0 ${infoId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= infoId; i++) table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  table += `trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  push(enc(table));

  const out = new Uint8Array(length);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the signature image"));
    img.src = src;
  });
}

export async function canvasToJpeg(canvas) {
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the page image"))), "image/jpeg", 0.88)
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export function newPageCanvas() {
  const c = document.createElement("canvas");
  c.width = PAGE_W;
  c.height = PAGE_H;
  return c;
}

// The form's pages as canvases (1, or 2 if anything needed a continuation sheet) —
// used both for the PDF and for printing, so the paper copy is identical to the filed one.
export async function renderKycCanvases(data) {
  const sigImg = data.signature && data.signatureMethod !== "paper" ? await loadImage(data.signature) : null;
  const first = newPageCanvas();
  const overflow = drawKycForm(first.getContext("2d"), data, sigImg);
  const pages = [first];
  if (overflow.length > 0) {
    const second = newPageCanvas();
    drawKycAnnex(second.getContext("2d"), data, overflow, sigImg);
    pages.push(second);
  }
  return pages;
}

export async function canvasesToPdf(canvases, title) {
  const jpegs = [];
  for (const c of canvases) jpegs.push(await canvasToJpeg(c));
  return new Blob([buildPdf(jpegs, PAGE_W, PAGE_H, title)], { type: "application/pdf" });
}

// data: the form values (see kycRowToData). Returns a PDF Blob.
export async function renderKycPdf(data) {
  return canvasesToPdf(await renderKycCanvases(data), `KYC - ${data.fullName}`);
}
