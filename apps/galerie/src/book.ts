// book — Book module output (Phase 5): compose the book's pages from the
// catalog's developed photos and deliver them as ONE PDF or as one JPEG per
// page. Ordering a Blurb book is not supported, so PDF/JPEG is the output here.
//
// Geometry lives in lib/bookLayout; the develop render (export.developToImage),
// the Photo Text tokens (print.photoCaption), the page-file naming
// (print.pageDest) and the output sharpener are the ones Export and Print
// already use. ui/BookDialog edits the book and calls exportBook.

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

import { buildPDF } from "@monet-ui/monet-imageio";
import type { PhotoRow } from "./catalog/types";
import { developToImage } from "./export";
import {
  BOOK_SIZES,
  coverPageSize,
  DEFAULT_BOOK_SIZE,
  pageCells,
  pageNumberAnchor,
  pageTemplate,
  type BookPage,
  type CoverType,
} from "./lib/bookLayout";
import { sharpenParams, unsharpMask, type SharpenSpec } from "./lib/outputSharpen";
import { coverCrop, DPI, fitInCell, type Rect } from "./lib/printLayout";
import { MAX_PPI, MIN_PPI, pageDest, photoCaption, type PhotoInfoToken } from "./print";

/** Book Settings ▸ "Book": a PDF file, or one JPEG per page. */
export type BookDestination = "pdf" | "jpeg";

/** Book Settings ▸ Color Profile. */
export type BookColorProfile = "sRGB" | "AdobeRGB";

/** Everything the Book panels set, flat and JSON-serializable — what a Book
 *  template stores and what a Saved Book reproduces. Lengths are page px on
 *  printLayout's 300-DPI grid. */
export interface BookSettings {
  /** A BOOK_SIZES key. */
  sizeName: string;
  cover: CoverType;
  to: BookDestination;
  /** JPEG Quality, 0–1. */
  quality: number;
  /** File Resolution in ppi (page geometry is authored at DPI and scaled). */
  ppi: number;
  /** Sharpening for the destination medium; null = off. */
  sharpen: SharpenSpec | null;
  profile: BookColorProfile;
  /** Background panel: the page colour behind every cell. */
  background: string;
  /** Page margin — also the Guides' text-safe area. */
  margin: number;
  /** Cell Padding, off every side of every cell. */
  padding: number;
  /** Page panel ▸ Page Numbers. */
  pageNumbers: boolean;
  /** Photo Text: the caption token drawn under each photo; null = off. */
  photoText: PhotoInfoToken | null;
  /** Type panel: point size and colour for Photo Text, Page Text, page numbers. */
  textSizePt: number;
  textColor: string;
}

export const DEFAULT_BOOK_SETTINGS: BookSettings = {
  sizeName: DEFAULT_BOOK_SIZE,
  cover: "hardcover-image",
  to: "pdf",
  quality: 0.92,
  ppi: DPI,
  sharpen: null,
  profile: "sRGB",
  background: "#ffffff",
  margin: Math.round(0.5 * DPI),
  padding: Math.round(0.08 * DPI),
  pageNumbers: true,
  photoText: null,
  textSizePt: 10,
  textColor: "#222222",
};

/** A book: its settings and its pages, in print order (page 0 is the cover). */
export interface Book {
  settings: BookSettings;
  pages: BookPage[];
}

/** Outcome of an export. `dest` is the PDF path, or the first JPEG written. */
export interface BookResult {
  to: BookDestination;
  dest: string;
  /** Pages composed and written. */
  pages: number;
  /** Photos placed in a cell. */
  drawn: number;
  /** Photos that failed to develop (their cell is left blank). */
  failed: number;
}

/** Refuse an output we cannot honour rather than mislabelling the file.
 *  ponytail: pages are composed in the webview's sRGB canvas, so only sRGB
 *  comes out honest. Adobe RGB means composing in Rust — a moxcms transform
 *  plus the ICC embed the native 16-bit export already carries. */
function assertRenderable(s: BookSettings): void {
  if (s.profile !== "sRGB") {
    throw new Error(`color profile "${s.profile}" is not supported yet — export the book as sRGB`);
  }
}

/** The trim size a book prints at. An unknown name (a Saved Book from a build
 *  with more sizes) falls back rather than throwing. */
export function trimSize(s: BookSettings): { w: number; h: number } {
  return BOOK_SIZES[s.sizeName] ?? BOOK_SIZES[DEFAULT_BOOK_SIZE];
}

/** The sheet page `index` composes on: a cover page is a hardcover wrap (or a
 *  softcover trim page); every other page is a trim page. */
export function bookPageSize(book: Book, index: number): { w: number; h: number } {
  const trim = trimSize(book.settings);
  if (index !== 0 || book.pages[0]?.template !== "cover") return trim;
  return coverPageSize(trim, book.settings.cover, Math.max(0, book.pages.length - 1));
}

/** File Resolution, clamped to the range Print already enforces. */
export function bookPpi(s: BookSettings): number {
  const ppi = Number.isFinite(s.ppi) ? Math.round(s.ppi) : DPI;
  return Math.min(MAX_PPI, Math.max(MIN_PPI, ppi));
}

// ─────────────────────────────────────────────────────────────
// Composition
// ─────────────────────────────────────────────────────────────

// ponytail: newSheet/sourceCanvas/ptPx mirror print.ts's private helpers
// (they're 4 lines each). Hoist the three into a shared module if a third
// page compositor turns up.

type Sheet = { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D };

function newSheet(w: number, h: number, background: string): Sheet {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

/** A developed photo as a drawable source canvas. */
function sourceCanvas(img: { rgba: Uint8Array; width: number; height: number }): OffscreenCanvas {
  const src = new OffscreenCanvas(img.width, img.height);
  const sctx = src.getContext("2d");
  if (!sctx) throw new Error("no 2d context");
  sctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  return src;
}

/** Points → output px at `ppi` (book text is authored in points). */
function ptPx(pt: number, ppi: number): number {
  return Math.max(1, Math.round((pt / 72) * ppi));
}

type Source = { canvas: OffscreenCanvas; w: number; h: number };

/** Draw one photo into `cell`. Full-bleed templates fill the cell edge-to-edge
 *  (centre crop); the rest fit inside it, centred. */
function drawCell(ctx: OffscreenCanvasRenderingContext2D, src: Source, cell: Rect, bleed: boolean): void {
  if (bleed) {
    const c = coverCrop(src.w, src.h, cell.w, cell.h);
    ctx.drawImage(src.canvas, c.x, c.y, c.w, c.h, cell.x, cell.y, cell.w, cell.h);
    return;
  }
  const r = fitInCell(src.w, src.h, cell);
  ctx.drawImage(src.canvas, r.x, r.y, r.w, r.h);
}

/** One line of book text (Photo Text, Page Text, page numbers) at `ppi`. */
function drawText(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: "left" | "center" | "right",
  s: BookSettings,
  ppi: number,
): void {
  ctx.font = `${ptPx(s.textSizePt, ppi)}px sans-serif`;
  ctx.fillStyle = s.textColor;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

/** Sharpening over the composed page, in place (skipped when it's off). */
function finishPixels(sheet: Sheet, sharpen: SharpenSpec | null, ppi: number): void {
  if (!sharpen) return;
  const { canvas, ctx } = sheet;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const p = sharpenParams(sharpen);
  // Radius is in output px, so it tracks the book's resolution (the same
  // adaptation print.ts makes).
  const radius = Math.max(1, Math.round(p.radius * (ppi / DPI)));
  img.data.set(unsharpMask(img.data, canvas.width, canvas.height, { ...p, radius }));
  ctx.putImageData(img, 0, 0);
}

/** Compose page `index` at output resolution. A photo used on several pages
 *  develops once (`cache`); one that fails to develop leaves its cell blank
 *  rather than failing the whole book. */
async function composePage(
  book: Book,
  index: number,
  byId: Map<number, PhotoRow>,
  cache: Map<number, Source>,
  ppi: number,
): Promise<{ sheet: Sheet; drawn: number; failed: number }> {
  const s = book.settings;
  const scale = ppi / DPI;
  const px = (v: number) => Math.round(v * scale);
  const layout = bookPageSize(book, index);
  const size = { w: Math.max(1, px(layout.w)), h: Math.max(1, px(layout.h)) };
  const margin = px(s.margin);
  const page = book.pages[index];
  const tpl = pageTemplate(page.template);
  const cells = pageCells(size, page.template, { margin, padding: px(s.padding) });
  const sheet = newSheet(size.w, size.h, s.background);
  const gap = Math.round(ptPx(s.textSizePt, ppi) * 0.4);
  // Text is drawn from its top, so a thin (or zero) margin would push a line
  // off the sheet — keep the last line on the page instead.
  const textY = (y: number) => Math.min(y, size.h - ptPx(s.textSizePt, ppi));

  let drawn = 0;
  let failed = 0;
  for (let i = 0; i < cells.length; i++) {
    const id = page.photos[i];
    const photo = id != null ? byId.get(id) : undefined;
    if (!photo) continue; // an empty cell is a layout choice, not a failure
    try {
      let src = cache.get(photo.id);
      if (!src) {
        const img = await developToImage(photo);
        src = { canvas: sourceCanvas(img), w: img.width, h: img.height };
        cache.set(photo.id, src);
      }
      drawCell(sheet.ctx, src, cells[i], tpl.bleed === true);
      if (s.photoText && tpl.caption) {
        const caption = photoCaption(photo, s.photoText);
        if (caption) {
          drawText(sheet.ctx, caption, cells[i].x + cells[i].w / 2, textY(cells[i].y + cells[i].h + gap), "center", s, ppi);
        }
      }
      drawn++;
    } catch (e) {
      failed++;
      console.error("galerie book: skipped", photo.path, e);
    }
  }

  // Page Text — centred in the bottom margin, under the cells.
  const text = page.text.trim();
  if (text) drawText(sheet.ctx, text, size.w / 2, textY(size.h - margin + gap), "center", s, ppi);
  // Page Numbers — the cover is never numbered.
  if (s.pageNumbers && index > 0) {
    const a = pageNumberAnchor(index, size, margin);
    drawText(sheet.ctx, String(index), a.x, textY(a.y), a.align, s, ppi);
  }
  finishPixels(sheet, s.sharpen, ppi);
  return { sheet, drawn, failed };
}

// ─────────────────────────────────────────────────────────────
// Delivery
// ─────────────────────────────────────────────────────────────

/** Compose every page and write the book — one PDF, or one JPEG per page
 *  (print.ts's "-2" page naming). Returns null when the book is empty or the
 *  save dialog was cancelled. */
export async function exportBook(
  book: Book,
  photos: PhotoRow[],
  onProgress?: (fraction: number) => void,
): Promise<BookResult | null> {
  if (book.pages.length === 0) return null;
  assertRenderable(book.settings);
  const pdf = book.settings.to === "pdf";
  const dest = await save({
    title: pdf ? "Export Book as PDF" : "Export Book as JPEG",
    defaultPath: pdf ? "book.pdf" : "book.jpg",
    filters: pdf
      ? [{ name: "PDF", extensions: ["pdf"] }]
      : [{ name: "JPEG", extensions: ["jpg", "jpeg"] }],
  });
  if (typeof dest !== "string") return null;

  const byId = new Map(photos.map((p) => [p.id, p]));
  const cache = new Map<number, Source>();
  const ppi = bookPpi(book.settings);
  // ponytail: a PDF holds every page's JPEG until buildPDF runs (it takes the
  // whole book), so a long book at high ppi peaks at the sum of its pages.
  // Stream the pages into the PDF writer if that ever bites; JPEG output
  // already writes each page as it is composed.
  const pdfPages: { jpeg: Uint8Array; w: number; h: number }[] = [];
  let drawn = 0;
  let failed = 0;
  for (let i = 0; i < book.pages.length; i++) {
    const composed = await composePage(book, i, byId, cache, ppi);
    drawn += composed.drawn;
    failed += composed.failed;
    const blob = await composed.sheet.canvas.convertToBlob({
      type: "image/jpeg",
      quality: book.settings.quality,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (pdf) {
      pdfPages.push({ jpeg: bytes, w: composed.sheet.canvas.width, h: composed.sheet.canvas.height });
    } else {
      await writeFile(pageDest(dest, i), bytes);
    }
    onProgress?.((i + 1) / book.pages.length);
  }
  if (pdf) await writeFile(dest, buildPDF(pdfPages));
  return { to: book.settings.to, dest, pages: book.pages.length, drawn, failed };
}
