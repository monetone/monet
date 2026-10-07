// print — Output/Print (Phase 5): compose the developed photo(s) onto
// print-sized pages — a contact sheet paginates when the selection outgrows its
// grid — and send them where the Print Job panel points it:
// an OS printer (spooled through the webview's print pipeline — which is where
// Page Setup, Print Settings, printer choice and the driver's color management
// live) or a JPEG file. Reuses the shared develop render (export.developToImage),
// the pure page layout (lib/printLayout) and the shared output sharpener
// (lib/outputSharpen).

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

import type { PhotoRow } from "./catalog/types";
import { developToImage } from "./export";
import { sharpenParams, type SharpenSpec, unsharpMask } from "./lib/outputSharpen";
import {
  contactSheetCells,
  DPI,
  fitInCell,
  gridForCount,
  type MarginSpec,
  marginSides,
  picturePackageCells,
  printableBox,
  type Rect,
} from "./lib/printLayout";
import { fontPx, watermarkLayout, type WatermarkSpec } from "./lib/watermark";

// ─────────────────────────────────────────────────────────────
// Print Job — everything downstream of composition
// ─────────────────────────────────────────────────────────────

/** LR's Print Job "Print To". */
export type PrintDestination = "printer" | "jpeg";

/** LR's rendering intent — only meaningful when Monet does the conversion. */
export type RenderingIntent = "perceptual" | "relative";

/** Color Management: the printer driver converts (LR's "Managed by Printer",
 *  the default), or Monet converts into a named printer profile first. */
export type PrintColorManagement =
  | { managedBy: "printer" }
  | { managedBy: "monet"; profile: string; intent: RenderingIntent };

export interface PrintJob {
  /** Printer or JPEG file. */
  to: PrintDestination;
  /** Print Resolution in pixels per inch, clamped to MIN_PPI…MAX_PPI. */
  ppi: number;
  /** Draft Mode Printing — fast, low resolution, no output sharpening. */
  draft: boolean;
  /** Print Sharpening: media (matte/glossy) × amount (low/standard/high). */
  sharpen: SharpenSpec | null;
  /** 16 Bit Output (macOS). */
  sixteenBit: boolean;
  color: PrintColorManagement;
  /** Print Adjustment, each −100…100 — compensates for ink/paper darkening. */
  adjust: { brightness: number; contrast: number };
}

/** Today's behaviour: a 300-ppi JPEG file, unsharpened, driver-managed color. */
export const DEFAULT_PRINT_JOB: PrintJob = {
  to: "jpeg",
  ppi: DPI,
  draft: false,
  sharpen: null,
  sixteenBit: false,
  color: { managedBy: "printer" },
  adjust: { brightness: 0, contrast: 0 },
};

export const MIN_PPI = 72;
export const MAX_PPI = 1440;
/** Draft Mode's ceiling — LR draft-prints from previews, not from the master. */
export const DRAFT_PPI = 96;

/** The ppi a job actually renders at: clamped, and capped again by Draft Mode. */
export function effectivePpi(job: PrintJob): number {
  const ppi = Number.isFinite(job.ppi) ? Math.round(job.ppi) : DPI;
  const clamped = Math.min(MAX_PPI, Math.max(MIN_PPI, ppi));
  return job.draft ? Math.min(DRAFT_PPI, clamped) : clamped;
}

/** Refuse a job we cannot honor instead of quietly printing something else.
 *  ponytail: both ceilings are one ceiling — the webview print pipeline takes an
 *  8-bit bitmap and leaves color to the driver. Lifting them means spooling from
 *  Rust: a 16-bit surface plus a moxcms transform into the printer profile at the
 *  chosen intent (with the driver's own matching switched off), which is the
 *  route the native 16-bit export already rides. */
function assertPrintable(job: PrintJob): void {
  if (job.sixteenBit) {
    throw new Error("16 Bit Output is not supported yet — this print path spools 8-bit");
  }
  if (job.color.managedBy === "monet") {
    throw new Error(
      `printer profile "${job.color.profile}" is not supported yet — use Color Management "Managed by Printer"`,
    );
  }
}

/** Print Resolution: page geometry is authored on printLayout's 300-DPI grid, so
 *  a job at another ppi scales every length before layout — the photo is drawn
 *  once, at the real output resolution, never upsampled afterwards. */
function scaleLen(v: number, s: number): number {
  return Math.round(v * s);
}

function scaleMargin(m: MarginSpec, s: number): MarginSpec {
  if (typeof m === "number") return scaleLen(m, s);
  return {
    top: scaleLen(m.top, s),
    right: scaleLen(m.right, s),
    bottom: scaleLen(m.bottom, s),
    left: scaleLen(m.left, s),
  };
}

/** Page size in pixels at `ppi` (the layout px are at printLayout's DPI). */
function scalePage(page: { w: number; h: number }, s: number): { w: number; h: number } {
  return { w: Math.max(1, scaleLen(page.w, s)), h: Math.max(1, scaleLen(page.h, s)) };
}

/** Physical page size in inches — the @page box the driver lays out. */
function pageInches(page: { w: number; h: number }): { w: number; h: number } {
  return { w: page.w / DPI, h: page.h / DPI };
}

/** A page canvas + its context, filled with the Page Background Color. */
function newPage(w: number, h: number, background = "#fff"): {
  page: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
} {
  const page = new OffscreenCanvas(w, h);
  const ctx = page.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  return { page, ctx };
}

/** A developed photo as a drawable source canvas. */
function sourceCanvas(img: { rgba: Uint8Array; width: number; height: number }): OffscreenCanvas {
  const src = new OffscreenCanvas(img.width, img.height);
  const sctx = src.getContext("2d");
  if (!sctx) throw new Error("no 2d context");
  sctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  return src;
}

/** Print Adjustment: brightness/contrast (each −100…100) over RGB, in place;
 *  alpha is untouched. Uint8ClampedArray does the rounding and clamping. */
export function applyPrintAdjustment(
  data: Uint8ClampedArray,
  brightness: number,
  contrast: number,
): void {
  const b = Math.max(-100, Math.min(100, brightness)) * 1.275; // ±100 → ±127.5 of the 8-bit range
  const c = 1 + Math.max(-100, Math.min(100, contrast)) / 100;
  if (b === 0 && c === 1) return;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (data[i] - 128) * c + 128 + b;
    data[i + 1] = (data[i + 1] - 128) * c + 128 + b;
    data[i + 2] = (data[i + 2] - 128) * c + 128 + b;
  }
}

/** Print Adjustment then Print Sharpening over the composed page, in place.
 *  ponytail: the sharpen pass walks the whole page (≈8 Mpx on 300-ppi Letter);
 *  restrict it to the drawn cells if that shows up in a profile. */
function finishPixels(
  page: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  job: PrintJob,
  ppi: number,
): void {
  const { brightness, contrast } = job.adjust;
  const sharpen = job.draft ? null : job.sharpen; // Draft Mode skips output sharpening
  if (!sharpen && brightness === 0 && contrast === 0) return;
  const img = ctx.getImageData(0, 0, page.width, page.height);
  applyPrintAdjustment(img.data, brightness, contrast);
  if (sharpen) {
    const p = sharpenParams(sharpen);
    // Radius is in output pixels, so it has to track the job's ppi — the
    // resolution adaptation lib/outputSharpen's own ponytail note calls out.
    const radius = Math.max(1, Math.round(p.radius * (ppi / DPI)));
    img.data.set(unsharpMask(img.data, page.width, page.height, { ...p, radius }));
  }
  ctx.putImageData(img, 0, 0);
}

const PRINT_LOAD_TIMEOUT_MS = 30_000;
/** Backstop for releasing the print frame if `afterprint` never arrives. */
const PRINT_CLEANUP_MS = 5 * 60_000;

/** The print document: the composed pages at their physical size, each in its
 *  own @page box so the driver neither re-scales nor re-margins them. One
 *  document = one Print Job, however many pages a contact sheet paginates to. */
export function printPageHtml(srcs: string[], pageIn: { w: number; h: number }): string {
  const w = `${pageIn.w.toFixed(3)}in`;
  const h = `${pageIn.h.toFixed(3)}in`;
  return (
    `<!doctype html><meta charset="utf-8"><title>Monet Galerie — Print</title>` +
    `<style>@page{size:${w} ${h};margin:0}` +
    `html,body{margin:0;padding:0;background:#fff}` +
    // page-break-after (not break-after): the spelling older WebKit honors.
    `img{display:block;width:${w};height:${h};page-break-after:always}</style>` +
    srcs.map((src, i) => `<img alt="Print page ${i + 1}" src="${src}">`).join("")
  );
}

/** Hand the composed pages to the OS print pipeline as ONE job. `window.print()`
 *  on the page-sized document is what raises the system Print dialog — printer
 *  choice, copies, Page Setup and the driver's Print Settings / color management
 *  all live there, so the job actually spools instead of landing in a file. */
async function spoolToPrinter(pages: OffscreenCanvas[], pageIn: { w: number; h: number }): Promise<void> {
  if (typeof document === "undefined") throw new Error("printing requires a webview document");
  // PNG, not JPEG: the spooler should get the composed pages losslessly.
  const urls: string[] = [];
  for (const page of pages) {
    urls.push(URL.createObjectURL(await page.convertToBlob({ type: "image/png" })));
  }
  const frame = document.createElement("iframe");
  frame.title = "Print page";
  frame.setAttribute("aria-hidden", "true"); // decorative: the print dialog is the UI
  // Off-screen rather than hidden — a display:none / visibility:hidden frame is
  // not guaranteed to lay out (and so to print) in WebKit.
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0";
  document.body.appendChild(frame);
  const release = () => {
    frame.remove();
    for (const url of urls) URL.revokeObjectURL(url);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("print page failed to load")), PRINT_LOAD_TIMEOUT_MS);
      // srcdoc (not document.write): its load event waits for the page image.
      frame.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      frame.srcdoc = printPageHtml(urls, pageIn);
    });
    const win = frame.contentWindow;
    if (!win) throw new Error("print frame has no window");
    // The spooler reads the frame while the (modal) dialog is up, so the frame
    // has to outlive print(); afterprint releases it, the timer is the backstop.
    const backstop = setTimeout(release, PRINT_CLEANUP_MS);
    win.addEventListener(
      "afterprint",
      () => {
        clearTimeout(backstop);
        release();
      },
      { once: true },
    );
    win.focus();
    win.print();
  } catch (e) {
    release();
    throw e;
  }
}

/** One composed page and the context that drew it. */
type Sheet = { page: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D };

/** JPEG filename for page `index`: the picked path as-is for page 1, "-N"
 *  spliced in before the extension for the rest (contact-sheet.jpg →
 *  contact-sheet-2.jpg) — one file per page, JPEG having no multi-page form. */
export function pageDest(dest: string, index: number): string {
  if (index === 0) return dest;
  const dot = dest.lastIndexOf(".");
  const sep = Math.max(dest.lastIndexOf("/"), dest.lastIndexOf("\\"));
  return dot > sep ? `${dest.slice(0, dot)}-${index + 1}${dest.slice(dot)}` : `${dest}-${index + 1}`;
}

/** Everything downstream of composition, for ALL pages of the job: Print
 *  Adjustment, Print Sharpening, then the destination — printer pages spool as
 *  ONE document, JPEG pages write one file each (pageDest naming). Returns the
 *  first JPEG path written, or null for a printer job. */
async function deliver(
  sheets: Sheet[],
  job: PrintJob,
  pageIn: { w: number; h: number },
  quality: number,
  dest: string | null,
): Promise<string | null> {
  for (const { page, ctx } of sheets) finishPixels(page, ctx, job, effectivePpi(job));
  if (job.to === "printer") {
    await spoolToPrinter(
      sheets.map((s) => s.page),
      pageIn,
    );
    return null;
  }
  if (!dest) throw new Error("no JPEG destination");
  for (let i = 0; i < sheets.length; i++) {
    const blob = await sheets[i].page.convertToBlob({ type: "image/jpeg", quality });
    await writeFile(pageDest(dest, i), new Uint8Array(await blob.arrayBuffer()));
  }
  return dest;
}

/** Pick the JPEG destination for a file-bound job; printer jobs skip the dialog
 *  (the system Print dialog is their destination picker). Returns undefined when
 *  the save dialog was cancelled. */
async function pickDest(
  job: PrintJob,
  title: string,
  defaultPath: string,
): Promise<string | null | undefined> {
  if (job.to === "printer") return null;
  const dest = await save({
    title,
    defaultPath,
    filters: [{ name: "JPEG", extensions: ["jpg", "jpeg"] }],
  });
  return dest ?? undefined;
}

/** Outcome of a print. `dest` is the JPEG path written — null for a printer job
 *  (the spooler owns the output) and null when nothing was rendered. */
export interface PrintResult {
  to: PrintDestination;
  dest: string | null;
  /** Photos placed on the page. */
  drawn: number;
  /** Photos that failed to develop (their cell is left blank). */
  failed: number;
  /** Picture-package cells the page had no room for — reported, never silently
   *  dropped. Always 0 for contact sheets, which paginate instead. */
  dropped: number;
  /** Pages composed and delivered (a contact sheet paginates; others are 1). */
  pages: number;
}

// ─────────────────────────────────────────────────────────────
// Image Settings + Page panels (OUT-14)
// ─────────────────────────────────────────────────────────────

/** LR's Image Settings panel — how each photo sits in its cell. */
export interface ImageSettings {
  /** Zoom to Fill: cover-crop the cell edge-to-edge instead of fitting inside. */
  zoomToFill: boolean;
  /** Rotate to Fit: rotate 90° when the photo's orientation fights the cell's. */
  rotateToFit: boolean;
  /** Repeat One Photo per Page: each photo gets its own contact-sheet page,
   *  every cell on it repeating that photo. */
  repeatOne: boolean;
  /** Stroke Border around each placed photo: width in layout px + CSS color. */
  stroke: { width: number; color: string } | null;
}

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  zoomToFill: false,
  rotateToFit: false,
  repeatOne: false,
  stroke: null,
};

/** Photo Info caption token — LR's Photo Info dropdown, the core entries.
 *  ponytail: single token, not LR's free token-template editor; grow this union
 *  (or take a template string) when someone asks for combined captions. */
export type PhotoInfoToken = "filename" | "date" | "exposure" | "caption";

/** LR's Page panel — overlays drawn onto the composed page. */
export interface PageSettings {
  /** Page Background Color (CSS color). */
  background: string;
  /** Identity Plate text drawn in the top margin; null = off. */
  identityPlate: string | null;
  /** Watermark over each placed photo — the same spec Export renders. */
  watermark: WatermarkSpec | null;
  /** Page Numbers, bottom-center of the page. */
  pageNumbers: boolean;
  /** Page Info: ppi / sharpening / color-management line, bottom-left. */
  pageInfo: boolean;
  /** Crop Marks: corner trim ticks around each placed photo. */
  cropMarks: boolean;
  /** Photo Info: caption under each photo + font size in points. */
  photoInfo: { token: PhotoInfoToken; sizePt: number } | null;
}

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  background: "#fff",
  identityPlate: null,
  watermark: null,
  pageNumbers: false,
  pageInfo: false,
  cropMarks: false,
  photoInfo: null,
};

/** The caption a Photo Info token resolves to for one photo ("" = nothing). */
export function photoCaption(photo: PhotoRow, token: PhotoInfoToken): string {
  switch (token) {
    case "filename":
      return photo.path.split(/[\\/]/).pop() ?? photo.path;
    case "date":
      return photo.captureTime != null ? new Date(photo.captureTime * 1000).toLocaleDateString() : "";
    case "exposure": {
      const t = photo.exposureTime;
      return [
        t != null ? (t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}s`) : null,
        photo.fNumber != null ? `f/${photo.fNumber}` : null,
        photo.iso != null ? `ISO ${photo.iso}` : null,
      ]
        .filter((p) => p != null)
        .join("  ");
    }
    case "caption":
      return photo.caption ?? "";
  }
}

/** LR's Page Info line: resolution · sharpening · color management. */
export function pageInfoText(job: PrintJob): string {
  const parts = [`${effectivePpi(job)} ppi`];
  if (job.draft) parts.push("Draft");
  else if (job.sharpen) parts.push(`Sharpening: ${job.sharpen.amount} (${job.sharpen.media})`);
  parts.push(job.color.managedBy === "printer" ? "Managed by Printer" : job.color.profile);
  return parts.join(" · ");
}

/** Points → output px at the job's ppi (page text is authored in points). */
function ptPx(pt: number, ppi: number): number {
  return Math.max(1, Math.round((pt / 72) * ppi));
}

/** Draw one photo into `cell` honoring Image Settings; returns the placed rect
 *  (the whole cell under Zoom to Fill). `s` is the layout→output scale. */
function renderCell(
  ctx: OffscreenCanvasRenderingContext2D,
  src: OffscreenCanvas,
  imgW: number,
  imgH: number,
  cell: Rect,
  is: ImageSettings,
  s: number,
): Rect {
  // Rotate to Fit only helps when the photo and the cell disagree on orientation.
  const rotate = is.rotateToFit && imgW !== imgH && cell.w !== cell.h && (imgW > imgH) !== (cell.w > cell.h);
  const w = rotate ? imgH : imgW; // photo dims as they land on the page
  const h = rotate ? imgW : imgH;
  const r = is.zoomToFill ? { ...cell } : fitInCell(w, h, cell);
  if (!rotate && !is.zoomToFill) {
    ctx.drawImage(src, r.x, r.y, r.w, r.h); // the plain pre-OUT-14 path
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip(); // Zoom to Fill overflows the cell; the clip is the crop
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    if (rotate) ctx.rotate(Math.PI / 2);
    const scale = is.zoomToFill ? Math.max(r.w / w, r.h / h) : Math.min(r.w / w, r.h / h);
    ctx.drawImage(src, (-imgW * scale) / 2, (-imgH * scale) / 2, imgW * scale, imgH * scale);
    ctx.restore();
  }
  if (is.stroke && is.stroke.width > 0) {
    const lw = Math.max(1, scaleLen(is.stroke.width, s));
    ctx.strokeStyle = is.stroke.color;
    ctx.lineWidth = lw;
    // Inset so the border hugs the photo instead of bleeding into a neighbor.
    ctx.strokeRect(r.x + lw / 2, r.y + lw / 2, r.w - lw, r.h - lw);
  }
  return r;
}

/** Per-photo overlays: watermark over the image, Photo Info caption under it,
 *  crop marks around it. `caption` is pre-resolved (null/"" = off). */
function decorateCell(
  ctx: OffscreenCanvasRenderingContext2D,
  r: Rect,
  decor: PageSettings,
  caption: string | null,
  ppi: number,
): void {
  const wm = decor.watermark;
  if (wm && wm.text.trim()) {
    // Same treatment as the export encoder; placement shared via lib/watermark.
    // ponytail: the ~10 draw lines are duplicated from lib/exportImage — extract
    // a drawTextWatermark(ctx, rect, spec) there when a third caller appears.
    const px = fontPx(r.h, wm.sizePct);
    ctx.font = `${px}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const tw = ctx.measureText(wm.text).width;
    const p = watermarkLayout(r.w, r.h, tw, px, wm);
    ctx.globalAlpha = Math.min(1, Math.max(0, wm.opacity));
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = Math.max(1, px * 0.06);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(wm.text, r.x + p.x, r.y + p.y);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }
  if (decor.photoInfo && caption) {
    const px = ptPx(decor.photoInfo.sizePt, ppi);
    ctx.font = `${px}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillStyle = "#000";
    ctx.fillText(caption, r.x + r.w / 2, r.y + r.h + Math.round(px * 0.4));
  }
  if (decor.cropMarks) {
    const len = Math.max(4, Math.round(ppi * 0.12));
    const gap = Math.max(2, Math.round(ppi * 0.03));
    ctx.strokeStyle = "#000";
    ctx.lineWidth = Math.max(1, Math.round(ppi / DPI));
    ctx.beginPath();
    for (const [cx, dx] of [
      [r.x, -1],
      [r.x + r.w, 1],
    ] as const) {
      for (const [cy, dy] of [
        [r.y, -1],
        [r.y + r.h, 1],
      ] as const) {
        // A horizontal and a vertical tick, held off the corner by `gap`.
        ctx.moveTo(cx + dx * gap, cy);
        ctx.lineTo(cx + dx * (gap + len), cy);
        ctx.moveTo(cx, cy + dy * gap);
        ctx.lineTo(cx, cy + dy * (gap + len));
      }
    }
    ctx.stroke();
  }
}

/** Page-level overlays: Identity Plate (top-left, in the top margin), Page
 *  Numbers (bottom-center) and Page Info (bottom-left, in the bottom margin). */
function decoratePage(
  ctx: OffscreenCanvasRenderingContext2D,
  size: { w: number; h: number },
  margin: MarginSpec,
  decor: PageSettings,
  job: PrintJob,
  ppi: number,
  pageNo = 1,
): void {
  const m = marginSides(margin);
  ctx.fillStyle = "#333";
  const plate = decor.identityPlate?.trim();
  if (plate) {
    // ponytail: fixed 18 pt text plate — no styled/graphic Identity Plate editor;
    // grow PageSettings.identityPlate into a spec when someone wants one.
    const px = ptPx(18, ppi);
    ctx.font = `${px}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(plate, m.left, Math.max(0, m.top - px - Math.round(ppi * 0.02)));
  }
  if (decor.pageNumbers || decor.pageInfo) {
    const px = ptPx(10, ppi);
    ctx.font = `${px}px sans-serif`;
    ctx.textBaseline = "bottom";
    const y = size.h - Math.max(2, Math.round(px / 2));
    if (decor.pageInfo) {
      ctx.textAlign = "left";
      ctx.fillText(pageInfoText(job), m.left, y);
    }
    if (decor.pageNumbers) {
      ctx.textAlign = "center";
      ctx.fillText(String(pageNo), size.w / 2, y);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// The three layouts
// ─────────────────────────────────────────────────────────────

export interface PrintOptions {
  /** Page size in layout pixels at printLayout's DPI (see PAGE_SIZES). */
  page: { w: number; h: number };
  /** Margin in layout pixels — one number for all sides, or per-side. */
  margin: MarginSpec;
  /** JPEG quality 0–1 (the "jpeg" destination only). */
  quality: number;
  /** Print Job settings; omitted = DEFAULT_PRINT_JOB (300-ppi JPEG file). */
  job?: PrintJob;
  /** Image Settings; omitted = fit in cell, no rotation, no border. */
  image?: ImageSettings;
  /** Page panel overlays; omitted = a plain white page. */
  decor?: PageSettings;
}

/** Render `photo` centered on a white page and send it to the job's destination.
 *  Returns null if the save dialog was cancelled. */
export async function printPhoto(photo: PhotoRow, opts: PrintOptions): Promise<PrintResult | null> {
  const job = opts.job ?? DEFAULT_PRINT_JOB;
  assertPrintable(job);
  const dest = await pickDest(job, "Print to JPEG", "print.jpg");
  if (dest === undefined) return null;

  const is = opts.image ?? DEFAULT_IMAGE_SETTINGS;
  const decor = opts.decor ?? DEFAULT_PAGE_SETTINGS;
  const img = await developToImage(photo);
  const ppi = effectivePpi(job);
  const s = ppi / DPI;
  const size = scalePage(opts.page, s);
  const margin = scaleMargin(opts.margin, s);
  const { page, ctx } = newPage(size.w, size.h, decor.background);
  // The printable box is the single layout's one "cell" (same centering math
  // fitOnPage used, plus the Image Settings the cell renderer adds).
  const r = renderCell(ctx, sourceCanvas(img), img.width, img.height, printableBox(size.w, size.h, margin), is, s);
  decorateCell(ctx, r, decor, decor.photoInfo ? photoCaption(photo, decor.photoInfo.token) : null, ppi);
  decoratePage(ctx, size, margin, decor, job, ppi);

  const written = await deliver([{ page, ctx }], job, pageInches(opts.page), opts.quality, dest);
  return { to: job.to, dest: written, drawn: 1, failed: 0, dropped: 0, pages: 1 };
}

export interface ContactSheetOptions extends PrintOptions {
  /** Gutter between cells in layout pixels. */
  gutter: number;
  /** Fixed grid. Omitted → shaped from the photo count and the page aspect. */
  grid?: { rows: number; cols: number };
  /** Explicit cell size in layout px (needs `grid`); the block centers on the page. */
  cell?: { w: number; h: number };
}

/** Compose `photos` into contact-sheet pages (grid shaped to the page aspect)
 *  and send them to the job's destination as ONE run — a selection larger than
 *  the grid paginates instead of dropping the overflow. A photo that fails to
 *  develop leaves its cell blank; an all-blank page is neither spooled nor
 *  written. Returns null if cancelled / no photos. */
export async function printContactSheet(
  photos: PhotoRow[],
  opts: ContactSheetOptions,
): Promise<PrintResult | null> {
  if (photos.length === 0) return null;
  const job = opts.job ?? DEFAULT_PRINT_JOB;
  assertPrintable(job);
  const dest = await pickDest(job, "Print Contact Sheet to JPEG", "contact-sheet.jpg");
  if (dest === undefined) return null;

  const is = opts.image ?? DEFAULT_IMAGE_SETTINGS;
  const decor = opts.decor ?? DEFAULT_PAGE_SETTINGS;
  const ppi = effectivePpi(job);
  const s = ppi / DPI;
  const size = scalePage(opts.page, s);
  const margin = scaleMargin(opts.margin, s);
  const m = marginSides(margin);
  const aspect = (size.w - m.left - m.right) / (size.h - m.top - m.bottom);
  const { rows, cols } = opts.grid ?? gridForCount(photos.length, aspect);
  const cells = contactSheetCells(size.w, size.h, {
    rows,
    cols,
    margin,
    gutter: scaleLen(opts.gutter, s),
    cell: opts.cell ? { w: scaleLen(opts.cell.w, s), h: scaleLen(opts.cell.h, s) } : undefined,
  });

  // Pagination: a grid smaller than the selection flows onto further pages
  // (LR: a 60-photo selection on a 3×3 grid prints 7 pages, one job). Repeat
  // One Photo per Page gives each photo its own page with every cell repeated
  // (LR's meaning of the checkbox). ponytail: all page canvases are held until
  // deliver() so the printer path spools ONE document; stream pages through
  // deliver if a huge selection makes memory show up.
  const perPage = cells.length;
  const batches: PhotoRow[][] = is.repeatOne
    ? photos.map((p) => new Array<PhotoRow>(perPage).fill(p))
    : Array.from({ length: Math.ceil(photos.length / perPage) }, (_, i) =>
        photos.slice(i * perPage, (i + 1) * perPage),
      );

  let drawn = 0;
  let failed = 0;
  const sheets: Sheet[] = [];
  for (let p = 0; p < batches.length; p++) {
    const sheet = newPage(size.w, size.h, decor.background);
    let placed = 0;
    // The page's repeated photo develops once; its canvas fills every cell.
    let src: { img: { width: number; height: number }; canvas: OffscreenCanvas } | null = null;
    for (let i = 0; i < batches[p].length; i++) {
      const photo = batches[p][i];
      try {
        if (!is.repeatOne || src == null) {
          const img = await developToImage(photo);
          src = { img, canvas: sourceCanvas(img) };
        }
        const r = renderCell(sheet.ctx, src.canvas, src.img.width, src.img.height, cells[i], is, s);
        decorateCell(sheet.ctx, r, decor, decor.photoInfo ? photoCaption(photo, decor.photoInfo.token) : null, ppi);
        placed++;
        drawn++;
      } catch (e) {
        failed++;
        console.error("galerie contact sheet: skipped", photo.path, e);
        if (is.repeatOne) break; // one photo per page: the rest would fail too
      }
    }
    decoratePage(sheet.ctx, size, margin, decor, job, ppi, p + 1);
    // Don't spool or write an all-blank page.
    if (placed > 0) sheets.push(sheet);
  }

  if (sheets.length === 0) return { to: job.to, dest: null, drawn, failed, dropped: 0, pages: 0 };

  const written = await deliver(sheets, job, pageInches(opts.page), opts.quality, dest);
  return { to: job.to, dest: written, drawn, failed, dropped: 0, pages: sheets.length };
}

export interface PicturePackageOptions extends PrintOptions {
  /** Gutter between cells in layout pixels. */
  gutter: number;
  /** Cell sizes in layout px (a PICTURE_PACKAGES preset × DPI). */
  sizes: { w: number; h: number }[];
}

/** Render ONE photo repeated into each package cell — cover-cropped edge-to-edge
 *  (LR's Zoom to Fill, the Picture Package default) — and send the page to the
 *  job's destination. */
export async function printPicturePackage(
  photo: PhotoRow,
  opts: PicturePackageOptions,
): Promise<PrintResult | null> {
  const job = opts.job ?? DEFAULT_PRINT_JOB;
  assertPrintable(job);
  // Zoom to Fill is the Picture Package default (LR), but it can be unchecked.
  const is = { ...DEFAULT_IMAGE_SETTINGS, zoomToFill: true, ...opts.image };
  const decor = opts.decor ?? DEFAULT_PAGE_SETTINGS;
  const ppi = effectivePpi(job);
  const s = ppi / DPI;
  const size = scalePage(opts.page, s);
  const { cells, dropped } = picturePackageCells(
    size.w,
    size.h,
    scaleMargin(opts.margin, s),
    scaleLen(opts.gutter, s),
    opts.sizes.map((c) => ({ w: scaleLen(c.w, s), h: scaleLen(c.h, s) })),
  );
  if (cells.length === 0) return { to: job.to, dest: null, drawn: 0, failed: 0, dropped, pages: 0 };

  const dest = await pickDest(job, "Print Picture Package to JPEG", "picture-package.jpg");
  if (dest === undefined) return null;

  const img = await developToImage(photo);
  const src = sourceCanvas(img);
  const { page, ctx } = newPage(size.w, size.h, decor.background);
  const caption = decor.photoInfo ? photoCaption(photo, decor.photoInfo.token) : null;
  for (const cell of cells) {
    const r = renderCell(ctx, src, img.width, img.height, cell, is, s);
    decorateCell(ctx, r, decor, caption, ppi);
  }
  decoratePage(ctx, size, scaleMargin(opts.margin, s), decor, job, ppi);

  const written = await deliver([{ page, ctx }], job, pageInches(opts.page), opts.quality, dest);
  return { to: job.to, dest: written, drawn: cells.length, failed: 0, dropped, pages: 1 };
}
