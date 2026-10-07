// PDF page render-scale planning for browser PDF rasterization. Pure,
// deterministic, node-safe (no DOM, no pdf.js) — so it unit-tests without a
// browser and any Monet app that opens PDF pages plans them identically. The
// pdf.js page render (Vite ?url worker + a 2D canvas) stays app-side; this
// module is the shared clamping math it feeds. (Distinct from pdf.ts's export
// builder — this is the import side.)

export const PDF_RE = /\.pdf$/i;

export const PDF_MAX_DIM = 8192;             // guard a poster MediaBox from a giant canvas
export const PDF_PIXEL_BUDGET = 24_000_000;  // ~24 MP ceiling (~96 MB RGBA)
const PDF_DEFAULT_SCALE = 2;                 // 144 DPI — a sensible on-screen default

export interface PdfRenderPlan { scale: number; w: number; h: number; }

/** Choose a render scale + clamped pixel dims for a PDF page `ptW`×`ptH` points.
 *  Starts from `scale` (default 2 = 144 DPI), then shrinks so neither axis
 *  exceeds `maxDim` and the total pixel count stays within `budget` — a huge
 *  MediaBox must never allocate an enormous canvas. Pure + deterministic. */
export function pdfRenderPlan(
  ptW: number,
  ptH: number,
  opts: { scale?: number; maxDim?: number; budget?: number } = {},
): PdfRenderPlan {
  const maxDim = opts.maxDim && opts.maxDim > 0 ? opts.maxDim : PDF_MAX_DIM;
  const budget = opts.budget && opts.budget > 0 ? opts.budget : PDF_PIXEL_BUDGET;
  const w0 = Number.isFinite(ptW) && ptW > 0 ? ptW : 1;
  const h0 = Number.isFinite(ptH) && ptH > 0 ? ptH : 1;
  let scale = Number.isFinite(opts.scale) && (opts.scale as number) > 0 ? (opts.scale as number) : PDF_DEFAULT_SCALE;
  scale = Math.min(scale, maxDim / w0, maxDim / h0);            // per-axis cap
  const area = w0 * h0 * scale * scale;
  if (area > budget) scale *= Math.sqrt(budget / area);         // total-pixel cap
  // floor to match the canvas's integer width (assigning a float to
  // canvas.width truncates), so the rendered viewport fills it exactly.
  const w = Math.max(1, Math.min(maxDim, Math.floor(w0 * scale)));
  const h = Math.max(1, Math.min(maxDim, Math.floor(h0 * scale)));
  return { scale, w, h };
}
