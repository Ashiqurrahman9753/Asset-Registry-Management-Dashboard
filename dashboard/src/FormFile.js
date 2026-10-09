import { createDocument, uploadDocumentFile } from "./api.js";
import { canvasesToPdf } from "./KycPdf.js";
import { todayIso } from "./FormUi.jsx";

// Makes the PDF from a form's page images, files it in the register against the
// client as a digital-only entry, and lets the caller remember where it went
// (link receives the register entry id and the uploaded file's id).
export async function fileFormPdf({ canvases, title, fileName, serviceDetail, client, user, link }) {
  const blob = await canvasesToPdf(canvases, title);
  const doc = await createDocument({
    clientId: client.id,
    category: "personal",
    serviceDetail,
    location: "Digital copy (no paper)",
    dateReceived: todayIso(),
    loggedBy: user.username,
    isAgmFiling: false,
    isBatch: false,
  });
  const file = await uploadDocumentFile(doc.id, new File([blob], fileName, { type: "application/pdf" }));
  await link(doc.id, file.id);
  return { documentId: doc.id, fileId: file.id };
}

// A scan or photo of the printed form after it's been signed by hand. Kept under a clear
// name so it's recognisable in the document list, with the original file's extension.
export function signedCopyFile(original, label) {
  const m = (original.name || "").match(/\.([A-Za-z0-9]{1,5})$/);
  const ext = m ? m[1].toLowerCase() : "pdf";
  return new File([original], `${label} - signed copy - ${todayIso()}.${ext}`, { type: original.type || (ext === "pdf" ? "application/pdf" : "application/octet-stream") });
}
