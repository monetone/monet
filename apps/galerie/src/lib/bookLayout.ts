// bookLayout — Book module (Phase 5) geometry + the book model: the trim
// sizes, the per-page cell templates the Page panel picks from, Auto Layout,
// spreads and page numbers. Pure (unit-tested); book.ts composes the pages at
// output resolution and ui/BookDialog edits them.
//
// Ordering a Blurb book is not supported, so a book here outputs PDF/JPEG.
// Paper stock and the Blurb logo page only mean something
// on Blurb's press, so they are omitted rather than faked; cover type stays,
// because it really does change the sheet the cover prints on.

import { DPI, marginSides, printableBox, type MarginSpec, type Rect } from "./printLayout";

const inches = (w: number, h: number) => ({ w: Math.round(w * DPI), h: Math.round(h * DPI) });

/** Trim sizes, in layout px at printLayout's DPI (Blurb's book shapes). */
export const BOOK_SIZES: Record<string, { w: number; h: number }> = {
  "Small Square": inches(7, 7),
  "Standard Portrait": inches(8, 10),
  "Standard Landscape": inches(10, 8),
  "Large Square": inches(12, 12),
  "Large Landscape": inches(13, 11),
};

export const DEFAULT_BOOK_SIZE = "Standard Portrait";

/** Cover kinds. Both hardcovers print as ONE wrap sheet — back cover, spine,
 *  front cover — so their cover page is spread-wide; a softcover cover is a
 *  single trim page. */
export type CoverType = "hardcover-image" | "hardcover-dust" | "softcover";

/** Spine thickness for a book with `interiorPages` pages, in layout px.
 *  ponytail: a flat 0.0025 in per page (the usual trade rule of thumb) — swap
 *  in a per-stock table if real paper weights ever matter. */
export function spineWidth(interiorPages: number): number {
  return Math.round(Math.max(0, interiorPages) * 0.0025 * DPI);
}

/** The sheet a cover prints on, given the trim size and the interior length. */
export function coverPageSize(
  trim: { w: number; h: number },
  cover: CoverType,
  interiorPages: number,
): { w: number; h: number } {
  if (cover === "softcover") return { w: trim.w, h: trim.h };
  return { w: trim.w * 2 + spineWidth(interiorPages), h: trim.h };
}

// ─────────────────────────────────────────────────────────────
// Page templates — the Page panel's cell layouts
// ─────────────────────────────────────────────────────────────

export interface PageTemplate {
  label: string;
  /** Photo cells as fractions (0…1) of the page's content box, row-major. */
  cells: Rect[];
  /** The cells leave room under them for Photo Text. */
  caption?: boolean;
  /** Full bleed: the cells span the trim, ignoring the page margin. */
  bleed?: boolean;
}

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
/** Half a page with a gap between the two halves. */
const A = 0.49;
const B = 0.51;

export const PAGE_TEMPLATES: Record<string, PageTemplate> = {
  cover: { label: "Cover", cells: [FULL], bleed: true, caption: false },
  blank: { label: "Blank", cells: [] },
  one: { label: "One Photo", cells: [FULL] },
  "one-bleed": { label: "One Photo — Full Bleed", cells: [FULL], bleed: true },
  "one-caption": {
    label: "One Photo with Caption",
    cells: [{ x: 0, y: 0, w: 1, h: 0.88 }],
    caption: true,
  },
  "two-h": {
    label: "Two Photos — Side by Side",
    cells: [
      { x: 0, y: 0, w: A, h: 1 },
      { x: B, y: 0, w: A, h: 1 },
    ],
  },
  "two-v": {
    label: "Two Photos — Stacked",
    cells: [
      { x: 0, y: 0, w: 1, h: A },
      { x: 0, y: B, w: 1, h: A },
    ],
  },
  three: {
    label: "Three Photos",
    cells: [
      { x: 0, y: 0, w: 1, h: A },
      { x: 0, y: B, w: A, h: A },
      { x: B, y: B, w: A, h: A },
    ],
  },
  four: {
    label: "Four Photos",
    cells: [
      { x: 0, y: 0, w: A, h: A },
      { x: B, y: 0, w: A, h: A },
      { x: 0, y: B, w: A, h: A },
      { x: B, y: B, w: A, h: A },
    ],
  },
};

/** A template by id, falling back rather than throwing — a Saved Book written
 *  by a build with more templates still opens. */
export function pageTemplate(id: string): PageTemplate {
  return PAGE_TEMPLATES[id] ?? PAGE_TEMPLATES.one;
}

export interface CellLayout {
  /** Page margin in page px — also what the Guides draw as the text-safe area. */
  margin: MarginSpec;
  /** Cell Padding in page px, taken off every side of every cell. */
  padding: number;
}

/** The photo cells `templateId` puts on a `size` page, row-major, in page px. */
export function pageCells(
  size: { w: number; h: number },
  templateId: string,
  o: CellLayout,
): Rect[] {
  const t = pageTemplate(templateId);
  const box = t.bleed ? { x: 0, y: 0, w: size.w, h: size.h } : printableBox(size.w, size.h, o.margin);
  const pad = Math.max(0, o.padding);
  return t.cells.map((c) => ({
    x: Math.round(box.x + c.x * box.w + pad),
    y: Math.round(box.y + c.y * box.h + pad),
    // Padding never eats a cell whole — a cell narrower than its padding keeps 1 px.
    w: Math.max(1, Math.round(c.w * box.w - 2 * pad)),
    h: Math.max(1, Math.round(c.h * box.h - 2 * pad)),
  }));
}

// ─────────────────────────────────────────────────────────────
// The book — pages, Auto Layout, spreads, page numbers
// ─────────────────────────────────────────────────────────────

export interface BookPage {
  /** A PAGE_TEMPLATES key. */
  template: string;
  /** Photo ids filling the template's cells in order; short = empty cells. */
  photos: number[];
  /** Page Text — the per-page text box under the cells; "" = none. */
  text: string;
}

/** LR's Auto Layout preset: the template cycle pages are laid out with. The
 *  preset editor is that list, edited in place. */
export interface AutoLayoutPreset {
  name: string;
  templates: string[];
}

export const AUTO_LAYOUT_PRESETS: AutoLayoutPreset[] = [
  { name: "One Photo Per Page", templates: ["one"] },
  { name: "One Photo Per Page with Caption", templates: ["one-caption"] },
  { name: "Left Blank, Right One Photo", templates: ["blank", "one"] },
  { name: "Two Photos Per Page", templates: ["two-h"] },
  { name: "Four Photos Per Page", templates: ["four"] },
  { name: "Full Bleed", templates: ["one-bleed"] },
];

/** Auto Layout: the first photo becomes the cover, then every photo flows into
 *  the preset's template cycle, one page per step. Trust boundary on a
 *  user-edited preset: a cycle that holds no photo cells at all (all Blank)
 *  would never consume a photo, so it lays out one cycle and stops instead of
 *  looping forever. */
export function autoLayout(photoIds: number[], preset: AutoLayoutPreset): BookPage[] {
  if (photoIds.length === 0) return [];
  const cycle = preset.templates.length > 0 ? preset.templates : ["one"];
  const perCycle = cycle.reduce((n, id) => n + pageTemplate(id).cells.length, 0);
  const pages: BookPage[] = [{ template: "cover", photos: [photoIds[0]], text: "" }];
  let placed = 0;
  for (let step = 0; step === 0 || placed < photoIds.length; step++) {
    const id = cycle[step % cycle.length];
    const n = pageTemplate(id).cells.length;
    pages.push({ template: id, photos: photoIds.slice(placed, placed + n), text: "" });
    placed += n;
    if (perCycle === 0 && step + 1 >= cycle.length) break;
  }
  return pages;
}

/** The multi-page view grouped the way the book opens: the cover on its own,
 *  page 1 as a right-hand page, then every later pair as a left/right spread.
 *  `pages[0]` is the cover (what autoLayout puts first); a slot with no page
 *  is null. Generic so the UI can group page *indices* just as well. */
export function spreads<T>(pages: T[]): (T | null)[][] {
  if (pages.length === 0) return [];
  const out: (T | null)[][] = [[null, pages[0]]];
  if (pages.length > 1) out.push([null, pages[1]]);
  for (let i = 2; i < pages.length; i += 2) out.push([pages[i], pages[i + 1] ?? null]);
  return out;
}

/** Where a page number sits: the outside bottom corner, inside the margin —
 *  odd (right-hand) pages bottom-right, even pages bottom-left, the way a
 *  printed book alternates. `number` is the printed number (1-based over the
 *  interior; the cover is not numbered). */
export function pageNumberAnchor(
  number: number,
  size: { w: number; h: number },
  margin: MarginSpec,
): { x: number; y: number; align: "left" | "right" } {
  const m = marginSides(margin);
  const odd = number % 2 === 1;
  return {
    x: odd ? size.w - m.right : m.left,
    y: size.h - Math.round(m.bottom / 2),
    align: odd ? "right" : "left",
  };
}
