// pdfImport.ts — open a PDF by rasterizing a chosen page to PNG. Photoshop opens
// PDF; Monet Vision could only *export* it (see pdf.ts / buildPDF — do not
// collide with it). Rust's `image` can't decode PDF, so render a page in the
// browser via pdf.js and hand the engine a PNG it already opens. The pure
// render-scale math now lives in @monet-ui/monet-imageio (pdfRaster); the pdf.js
// canvas render below stays app-side. Mirrors [[svg]] / [[avif]].
//
// pdf.js is dynamically imported so it code-splits out of the boot path; its
// worker is bundled locally as a ?url asset (NO CDN fetch) so it loads under the
// self-contained Tauri CSP (worker-src 'self').

import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDF_RE, PDF_MAX_DIM, PDF_PIXEL_BUDGET, pdfRenderPlan, type PdfRenderPlan } from "@monet-ui/monet-imageio";
export { PDF_RE, PDF_MAX_DIM, PDF_PIXEL_BUDGET, pdfRenderPlan, type PdfRenderPlan };

// A fresh copy per load: pdf.js may transfer/detach the input buffer, and a
// multi-page open reads the same bytes twice (count, then render).
async function loadPdf(bytes: Uint8Array) {
  if (!bytes || bytes.length === 0) throw new Error("Empty PDF");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  return await pdfjs.getDocument({ data: bytes.slice() }).promise;
}

/** Number of pages in a PDF. Throws a clean error on corrupt/empty input. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await loadPdf(bytes);
  try { return doc.numPages; } finally { void doc.loadingTask.destroy(); }
}

/** Rasterize one PDF page (0-based) to PNG bytes at a clamped resolution. Throws
 *  a clean error on corrupt input or an out-of-range page (no crash). */
export async function pdfPageToPng(
  bytes: Uint8Array,
  pageIndex = 0,
  opts?: { scale?: number; maxDim?: number; budget?: number },
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  try {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.numPages) {
      throw new Error(`PDF has no page ${pageIndex + 1} (of ${doc.numPages})`);
    }
    const page = await doc.getPage(pageIndex + 1); // pdf.js pages are 1-based
    const base = page.getViewport({ scale: 1 });
    const plan = pdfRenderPlan(base.width, base.height, opts);
    const viewport = page.getViewport({ scale: plan.scale });
    const canvas = document.createElement("canvas");
    canvas.width = plan.w;
    canvas.height = plan.h;
    const cx = canvas.getContext("2d");
    if (!cx) throw new Error("2D canvas unavailable");
    // PDF pages are opaque paper — render onto white, not a transparent canvas.
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("PNG encode failed");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    void doc.loadingTask.destroy();
  }
}
