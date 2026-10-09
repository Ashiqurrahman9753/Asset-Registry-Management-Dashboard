// Printing a form's pages. In the desktop app this opens the Windows print dialog
// through the Electron shell; in a plain browser it prints via a hidden frame.
// Either way the paper copy is made from exactly the same page images as the PDF
// that gets filed, so what's signed by hand matches what's on record.

export function canvasesToDataUrls(canvases) {
  return canvases.map((c) => c.toDataURL("image/jpeg", 0.92));
}

const PRINT_CSS =
  "@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}img{display:block;width:210mm;height:297mm;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}";

export function pagesHtml(urls) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Print</title><style>${PRINT_CSS}</style></head><body>${urls
    .map((u) => `<img src="${u}">`)
    .join("")}</body></html>`;
}

export async function printPages(urls) {
  if (typeof window !== "undefined" && window.famsPrint && window.famsPrint.html) {
    const result = await window.famsPrint.html(pagesHtml(urls));
    if (result && result.ok === false && !/cancel/i.test(result.reason || "")) {
      throw new Error(result.reason || "Printing failed");
    }
    return;
  }
  await new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    iframe.onload = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (err) {
        iframe.remove();
        reject(err);
        return;
      }
      setTimeout(() => {
        iframe.remove();
        resolve();
      }, 1500);
    };
    iframe.srcdoc = pagesHtml(urls);
    document.body.appendChild(iframe);
  });
}
