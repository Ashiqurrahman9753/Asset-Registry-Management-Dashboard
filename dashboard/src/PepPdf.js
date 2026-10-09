// The PEP declaration (Part 2) and enhanced due diligence (Section D) form as a PDF,
// laid out like the paper form: letterhead, Section A with tick boxes, Section D,
// and the declaration with a signature table on each of its two pages. Like the KYC
// form, nothing typed is ever silently cut off — anything too long for its box is
// shortened on the page and printed in full on a continuation sheet.
import { PAGE_W, PAGE_H, drawText, measure, ellipsize, wrapBlock, wrapText, isoToDisplay, newPageCanvas, loadImage, canvasesToPdf } from "./KycPdf.js";

// The firm's letterhead as printed on the paper form. Edit here if the details change.
export const LETTERHEAD = {
  name: "JARDEEN MANAGEMENT SERVICES PTE. LTD.",
  lines: ["(Incorporated in the Republic of Singapore)", "(Reg No: 200200756R)"],
  address: ["10 Jalan Besar, #10-08", "Sim Lim Tower, Singapore 208787", "Tel: 63375090 / Fax: 63965292"],
};

export const PEP_TYPE_ORDER = ["sg_pep", "foreign_pep", "intl_org_pep", "family_member", "close_associate"];
export const PEP_TYPE_LABELS = {
  sg_pep: "Singapore PEP;",
  foreign_pep: "Foreign PEP;",
  intl_org_pep: "International Organisation PEP;",
  family_member: "Family member of PEP (please describe relationship with the PEP):",
  close_associate: "Close associate of PEP (please describe relationship with the PEP):",
};
export const PEP_DECLARATION =
  "I declare that the information provided in this form is true and correct. I am aware that I may be subject to prosecution and criminal sanctions under written law if I am found to have made any false statement which I know to be false or which I do not believe to be true, or if I have intentionally suppressed any material fact.";

const ENHANCED_CDD_EXAMPLES = [
  "(a)  A foreign PEP, or his family members and close associates.",
  "(b)  A high risk domestic PEP, or his family members and close associates.",
  "(c)  A high risk international organisation PEP, or his family members and close associates.",
  "(d)  A high risk individual.",
];

// Server row (snake_case) → the shape the drawing uses.
export function pepRowToData(row, companyName) {
  let pepTypes = [];
  try {
    pepTypes = JSON.parse(row.pep_types || "[]");
  } catch {
    pepTypes = [];
  }
  return {
    companyName,
    personName: row.person_name,
    idNumber: row.id_number,
    pepTypes,
    familyRelationship: row.family_relationship || "",
    associateRelationship: row.associate_relationship || "",
    pepName: row.pep_name,
    pepCountry: row.pep_country,
    pepFunction: row.pep_function,
    pepPeriod: row.pep_period || "",
    sourceOfWealth: row.source_of_wealth || "",
    sourceOfFunds: row.source_of_funds || "",
    otherInfo: row.other_info || "",
    declarationDate: row.declaration_date,
    declarationText: row.declaration_text || PEP_DECLARATION,
    signature: row.signature,
    signatureMethod: row.signature_method || "screen",
    completedAt: row.created_at || "",
    handedBy: row.handed_by || "",
  };
}

const X = 80;
const R = 1160;
const W = R - X;

function serif(ctx, str, x, y, size, bold) {
  ctx.font = `${bold ? "700 " : ""}${size}px "Times New Roman", Times, serif`;
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(str, x, y);
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function letterhead(ctx) {
  serif(ctx, LETTERHEAD.name, X, 110, 32, true);
  LETTERHEAD.lines.forEach((l, i) => serif(ctx, l, X, 172 + i * 34, 22, false));
  LETTERHEAD.address.forEach((l, i) => serif(ctx, l, 740, 148 + i * 34, 24, false));
}

function footer(ctx, d, page, pages) {
  const text = `${d.companyName ? `${d.companyName} · ` : ""}Completed on screen${d.completedAt ? ` on ${d.completedAt}` : ""}${d.handedBy ? ` · handled by ${d.handedBy}` : ""} · ${
    d.signatureMethod === "paper" ? "to be signed by hand on the printed copy" : "signed digitally"
  }`;
  drawText(ctx, ellipsize(ctx, text, 17, false, 960), X, PAGE_H - 36, { size: 17, color: "#777" });
  drawText(ctx, `Page ${page} of ${pages}`, R, PAGE_H - 36, { size: 17, color: "#777", align: "right" });
}

// Wrapped text inside a table cell. Returns the lines and whether it had to be shortened.
function cellBlock(ctx, text, size, bold, w, maxLines) {
  const block = wrapBlock(ctx, text, size, bold, w, maxLines);
  return block;
}

// "Declaration" paragraph and the customer / ID / date / signature table. Returns the y after it.
function declarationBlock(ctx, d, y, sigImg, overflow) {
  const lines = wrapText(ctx, d.declarationText, 21, false, W);
  lines.forEach((ln, i) => drawText(ctx, ln, X, y + i * 29, { size: 21, color: "#222" }));
  y += lines.length * 29 + 26;
  const TW = 720;
  const labelW = 340;
  const rows = [
    ["Name of customer", d.personName, 52],
    ["NRIC/FIN/Passport number", d.idNumber, 52],
    ["Date", isoToDisplay(d.declarationDate), 52],
    ["Signature", "", 120],
  ];
  const total = rows.reduce((a, r) => a + r[2], 0);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.strokeRect(X, y, TW, total);
  line(ctx, X + labelW, y, X + labelW, y + total);
  let ry = y;
  rows.forEach(([label, value, h], i) => {
    if (i > 0) line(ctx, X, ry, X + TW, ry);
    drawText(ctx, label, X + 14, ry + h / 2 + 8, { size: 22, color: "#444" });
    if (value) {
      const fitted = ellipsize(ctx, value, 24, true, TW - labelW - 28);
      if (fitted !== value && overflow) overflow.push({ label, value });
      drawText(ctx, fitted, X + labelW + 14, ry + h / 2 + 9, { size: 24, bold: true });
    }
    ry += h;
  });
  const sigTop = y + total - 120;
  if (sigImg) {
    const scale = Math.min((TW - labelW - 40) / sigImg.width, 100 / sigImg.height, 1.5);
    ctx.drawImage(sigImg, X + labelW + 20, sigTop + 10, sigImg.width * scale, sigImg.height * scale);
  } else if (d.signatureMethod === "paper") {
    drawText(ctx, "Please sign here by hand", X + labelW + 20, sigTop + 66, { size: 21, color: "#999" });
  }
  return y + total;
}

// ---------- Page 1: Part 2, Section A ----------

function drawPage1(ctx, d, sigImg, pages, overflow) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  letterhead(ctx);

  let y = 300;
  drawText(ctx, "PART 2 – FORM FOR POLITICALLY EXPOSED PERSONS <To fill up if any of PART 1, Section B in Yes>", X, y, { size: 21, bold: true });
  y += 34;
  drawText(ctx, ellipsize(ctx, "Section A – Information about politically exposed persons, their immediate family members and close associates", 20, true, W), X, y, { size: 20, bold: true });
  y += 16;

  // "Information on PEP" box with the tick boxes
  ctx.strokeRect(X, y, W, 40);
  drawText(ctx, "Information on PEP", X + W / 2, y + 28, { size: 22, bold: true, align: "center" });
  const bodyTop = y + 40;
  const bodyH = 318;
  ctx.strokeRect(X, bodyTop, W, bodyH);
  drawText(ctx, "Is the identified individual a:", X + 20, bodyTop + 42, { size: 22, color: "#222" });
  PEP_TYPE_ORDER.forEach((key, i) => {
    const ly = bodyTop + 100 + i * 46;
    const checked = d.pepTypes.includes(key);
    ctx.lineWidth = 2;
    ctx.strokeRect(X + 40, ly - 22, 24, 24);
    if (checked) {
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(X + 45, ly - 9);
      ctx.lineTo(X + 52, ly - 1);
      ctx.lineTo(X + 62, ly - 20);
      ctx.stroke();
      ctx.lineWidth = 2;
    }
    const label = PEP_TYPE_LABELS[key];
    drawText(ctx, label, X + 80, ly, { size: 22, color: "#222" });
    if (key === "family_member" || key === "close_associate") {
      const startX = X + 80 + measure(ctx, label, 22, false) + 10;
      const endX = X + W - 50;
      line(ctx, startX, ly + 6, endX, ly + 6);
      const rel = key === "family_member" ? d.familyRelationship : d.associateRelationship;
      if (checked && rel) {
        const fitted = ellipsize(ctx, rel, 22, true, endX - startX - 10);
        if (fitted !== rel) overflow.push({ label: key === "family_member" ? "Family member of PEP — relationship" : "Close associate of PEP — relationship", value: rel });
        drawText(ctx, fitted, startX + 6, ly - 2, { size: 22, bold: true });
      }
    }
  });

  // The four-row table
  let ty = bodyTop + bodyH;
  const labelW = 470;
  const valueW = W - labelW - 36;
  const rowsSpec = [
    ["Name of PEP", d.pepName, 2, 64],
    ["Country / international organisation which PEP holds prominent public function", d.pepCountry, 3, 90],
    ["Describe nature of prominent public function that the person is or has been entrusted with", d.pepFunction, 5, 120],
    ["Period of time in which the person is / was a PEP", d.pepPeriod, 2, 64],
  ];
  const planned = rowsSpec.map(([label, value, maxLines, min]) => {
    const labelLines = wrapText(ctx, label, 21, false, labelW - 30);
    const block = cellBlock(ctx, value, 22, true, valueW, maxLines);
    if (block.truncated) overflow.push({ label: label, value });
    return { labelLines, block, h: Math.max(min, 28 + Math.max(labelLines.length, block.lines.length) * 30) };
  });
  const tableH = planned.reduce((a, p) => a + p.h, 0);
  ctx.strokeRect(X, ty, W, tableH);
  line(ctx, X + labelW, ty, X + labelW, ty + tableH);
  let ry = ty;
  planned.forEach((p, i) => {
    if (i > 0) line(ctx, X, ry, R, ry);
    p.labelLines.forEach((ln, j) => drawText(ctx, ln, X + 14, ry + 38 + j * 28, { size: 21, color: "#333" }));
    p.block.lines.forEach((ln, j) => drawText(ctx, ln, X + labelW + 18, ry + 38 + j * 30, { size: 22, bold: true }));
    ry += p.h;
  });

  declarationBlock(ctx, d, ty + tableH + 60, sigImg, overflow);
  footer(ctx, d, 1, pages);
}

// ---------- Page 2: Section D ----------

function drawPage2(ctx, d, sigImg, pages, overflow) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  letterhead(ctx);

  let y = 300;
  drawText(ctx, "Section D – Enhanced CDD³ relating to source of wealth and funds", X, y, { size: 21, bold: true });
  y += 18;
  const labelW = 440;
  const valueW = W - labelW - 36;
  ctx.strokeRect(X, y, W, 40);
  line(ctx, X + labelW, y, X + labelW, y + 40);
  drawText(ctx, "Additional Information", X + labelW + (W - labelW) / 2, y + 28, { size: 22, bold: true, align: "center" });
  y += 40;

  const rowsSpec = [
    ["Information on the person's source of wealth", d.sourceOfWealth, 7, 130],
    ["Information on the person's source of funds in the establishment of the business relationship or in the proposed business relationship", d.sourceOfFunds, 7, 150],
    ["Any other information as necessary", d.otherInfo, 6, 120],
  ];
  const planned = rowsSpec.map(([label, value, maxLines, min]) => {
    const labelLines = wrapText(ctx, label, 21, false, labelW - 30);
    const block = cellBlock(ctx, value, 22, true, valueW, maxLines);
    if (block.truncated) overflow.push({ label, value });
    return { labelLines, block, h: Math.max(min, 28 + Math.max(labelLines.length, block.lines.length) * 30) };
  });
  const tableH = planned.reduce((a, p) => a + p.h, 0);
  ctx.strokeRect(X, y, W, tableH);
  line(ctx, X + labelW, y, X + labelW, y + tableH);
  let ry = y;
  planned.forEach((p, i) => {
    if (i > 0) line(ctx, X, ry, R, ry);
    p.labelLines.forEach((ln, j) => drawText(ctx, ln, X + 14, ry + 38 + j * 28, { size: 21, color: "#333" }));
    p.block.lines.forEach((ln, j) => drawText(ctx, ln, X + labelW + 18, ry + 38 + j * 30, { size: 22, bold: true }));
    ry += p.h;
  });

  let fy = y + tableH + 60;
  drawText(ctx, "³Examples of situations where enhanced CDD may be required include the individuals identified as:", X + 20, fy, { size: 20, color: "#333" });
  ENHANCED_CDD_EXAMPLES.forEach((ex, i) => drawText(ctx, ex, X + 50, fy + 32 + i * 28, { size: 20, color: "#333" }));
  fy += 32 + ENHANCED_CDD_EXAMPLES.length * 28 + 70;

  declarationBlock(ctx, d, fy, sigImg, overflow);
  footer(ctx, d, 2, pages);
}

// ---------- Continuation sheet ----------

function drawAnnex(ctx, d, overflow, sigImg, pages) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  letterhead(ctx);
  drawText(ctx, "CONTINUATION SHEET", X, 300, { size: 30, bold: true });
  drawText(ctx, ellipsize(ctx, `Full text of entries shortened on pages 1–2  ·  ${d.personName}`, 22, false, W), X, 336, { size: 22, color: "#444" });
  let y = 390;
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1;
  for (const item of overflow) {
    const lines = wrapText(ctx, item.value, 24, true, 1000);
    const need = 40 + lines.length * 32 + 24;
    if (y + need > PAGE_H - 300) {
      drawText(ctx, "(more entries could not be shown — see the stored record in the app)", X, y + 20, { size: 20, color: "#A63D40" });
      break;
    }
    drawText(ctx, item.label, X, y + 24, { size: 20, color: "#444" });
    lines.forEach((ln, i) => drawText(ctx, ln, X, y + 60 + i * 32, { size: 24, bold: true }));
    y += need;
    line(ctx, X, y - 10, R, y - 10);
  }
  const lineY = PAGE_H - 150;
  if (sigImg) {
    const scale = Math.min(360 / sigImg.width, 100 / sigImg.height, 1.5);
    ctx.drawImage(sigImg, 930 - (sigImg.width * scale) / 2, lineY - sigImg.height * scale - 4, sigImg.width * scale, sigImg.height * scale);
  }
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  line(ctx, 700, lineY, R, lineY);
  drawText(ctx, ellipsize(ctx, d.personName, 22, true, 440), 930, lineY + 30, { size: 22, bold: true, align: "center" });
  drawText(ctx, "Signature of customer", 930, lineY + 58, { size: 19, color: "#444", align: "center" });
  footer(ctx, d, pages, pages);
}

// The form's pages as canvases (2, or 3 with a continuation sheet).
export async function renderPepCanvases(d) {
  const sigImg = d.signature && d.signatureMethod !== "paper" ? await loadImage(d.signature) : null;
  const overflow = [];
  const first = newPageCanvas();
  const second = newPageCanvas();
  // Draw once to learn whether a continuation sheet is needed, so page numbers are right.
  drawPage1(first.getContext("2d"), d, sigImg, 2, overflow);
  drawPage2(second.getContext("2d"), d, sigImg, 2, overflow);
  // The customer's name appears on both pages; list each shortened entry once.
  const seen = new Set();
  for (let i = overflow.length - 1; i >= 0; i--) {
    const key = `${overflow[i].label}\u0000${overflow[i].value}`;
    if (seen.has(key)) overflow.splice(i, 1);
    else seen.add(key);
  }
  const pages = [first, second];
  if (overflow.length > 0) {
    const total = 3;
    const discard = [];
    drawPage1(first.getContext("2d"), d, sigImg, total, discard);
    drawPage2(second.getContext("2d"), d, sigImg, total, discard);
    const annex = newPageCanvas();
    drawAnnex(annex.getContext("2d"), d, overflow, sigImg, total);
    pages.push(annex);
    // A short note on page 1 so nobody reads the shortened text as complete.
    const ctx = first.getContext("2d");
    drawText(ctx, "Some entries are shown in short form — their full text is on the continuation sheet (last page).", X, PAGE_H - 74, { size: 21, bold: true, color: "#A63D40" });
  }
  return pages;
}

export async function renderPepPdf(d) {
  return canvasesToPdf(await renderPepCanvases(d), `PEP declaration - ${d.personName}`);
}
