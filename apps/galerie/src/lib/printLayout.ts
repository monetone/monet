// printLayout — place a photo centered within a page's printable area (Phase 5
// Print). Pure geometry (unit-tested); print.ts draws the page + image using it.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Common page sizes in pixels at 300 DPI, portrait. */
export const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  Letter: { w: 2550, h: 3300 }, // 8.5 × 11 in
  A4: { w: 2480, h: 3508 }, // 210 × 297 mm
};

/** Page Setup orientation — landscape is a PAGE_SIZES entry rotated 90°. */
export type PageOrientation = "portrait" | "landscape";

/** A (portrait) page size in `orientation`: landscape swaps w/h. */
export function orientPage(
  size: { w: number; h: number },
  orientation: PageOrientation,
): { w: number; h: number } {
  return orientation === "landscape" ? { w: size.h, h: size.w } : size;
}

/** Per-side page margins in px. A bare number means the same margin on all
 *  four sides — every layout entry point takes either. */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export type MarginSpec = number | Margins;

/** Normalize a margin spec to four non-negative sides. */
export function marginSides(m: MarginSpec): Margins {
  if (typeof m === "number") {
    const v = Math.max(0, m);
    return { top: v, right: v, bottom: v, left: v };
  }
  return {
    top: Math.max(0, m.top),
    right: Math.max(0, m.right),
    bottom: Math.max(0, m.bottom),
    left: Math.max(0, m.left),
  };
}

/** The printable box left by `margin` on a page. */
export function printableBox(pageW: number, pageH: number, margin: MarginSpec): Rect {
  const m = marginSides(margin);
  return {
    x: m.left,
    y: m.top,
    w: Math.max(1, pageW - m.left - m.right),
    h: Math.max(1, pageH - m.top - m.bottom),
  };
}

/** Fit `imgW`×`imgH` inside the page's printable box, preserving aspect and
 *  centering *in that box* (so asymmetric margins shift the image). Never
 *  upscales past the box (it scales down to fit; a small image is drawn at its
 *  fitted size, still centered). */
export function fitOnPage(
  imgW: number,
  imgH: number,
  pageW: number,
  pageH: number,
  margin: MarginSpec,
): Rect {
  const box = printableBox(pageW, pageH, margin);
  const scale = Math.min(box.w / imgW, box.h / imgH);
  const w = Math.max(1, Math.round(imgW * scale));
  const h = Math.max(1, Math.round(imgH * scale));
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h };
}

/** A contact-sheet page grid: rows × cols cells, page margins (uniform or
 *  per-side), and a gutter between cells (all in px). */
export interface ContactSheetGrid {
  rows: number;
  cols: number;
  margin: MarginSpec;
  gutter: number;
  /** LR's cell-size mode: cells are exactly this big (px) and the rows × cols
   *  block is centered in the printable box. Omitted → cells divide the box. */
  cell?: { w: number; h: number };
}

/** Equal cell rectangles for a contact-sheet grid on a page. Row-major order
 *  (left-to-right, top-to-bottom). */
export function contactSheetCells(pageW: number, pageH: number, grid: ContactSheetGrid): Rect[] {
  const rows = Math.max(1, Math.floor(grid.rows));
  const cols = Math.max(1, Math.floor(grid.cols));
  const gutter = Math.max(0, grid.gutter);
  const box = printableBox(pageW, pageH, grid.margin);
  const cellW = Math.max(1, grid.cell ? grid.cell.w : (box.w - (cols - 1) * gutter) / cols);
  const cellH = Math.max(1, grid.cell ? grid.cell.h : (box.h - (rows - 1) * gutter) / rows);
  // Derived cells already span the box exactly, so centering is a no-op there.
  const originX = box.x + (box.w - (cols * cellW + (cols - 1) * gutter)) / 2;
  const originY = box.y + (box.h - (rows * cellH + (rows - 1) * gutter)) / 2;
  const cells: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        x: Math.round(originX + c * (cellW + gutter)),
        y: Math.round(originY + r * (cellH + gutter)),
        w: Math.round(cellW),
        h: Math.round(cellH),
      });
    }
  }
  return cells;
}

/** Fit `imgW`×`imgH` inside `cell`, preserving aspect and centering within it. */
export function fitInCell(imgW: number, imgH: number, cell: Rect): Rect {
  const scale = Math.min(cell.w / imgW, cell.h / imgH);
  const w = Math.max(1, Math.round(imgW * scale));
  const h = Math.max(1, Math.round(imgH * scale));
  return { x: cell.x + Math.round((cell.w - w) / 2), y: cell.y + Math.round((cell.h - h) / 2), w, h };
}

/** Page pixels per inch — PAGE_SIZES above are 300 DPI. */
export const DPI = 300;

/** Ruler units: page px per unit. The Print dialog edits in these. */
export const UNITS = { in: DPI, cm: DPI / 2.54, px: 1 } as const;
export type Unit = keyof typeof UNITS;

/** `v` in `unit` → page px (rounded — page geometry is integral). */
export function toPx(v: number, unit: Unit): number {
  return Math.round(v * UNITS[unit]);
}

/** Page px → `unit`, rounded to 2 decimals for display. */
export function fromPx(px: number, unit: Unit): number {
  return Math.round((px / UNITS[unit]) * 100) / 100;
}

/** LR's Picture Package zone presets: ONE photo repeated at classic print
 *  sizes. Cell dimensions in INCHES as they land on a portrait Letter page
 *  (landscape sizes pre-rotated); the shelf packer lays them out in order,
 *  biggest first — the classic school-photo sheet. */
export const PICTURE_PACKAGES: Record<string, { w: number; h: number }[]> = {
  "(1) 5×7 + (4) 2.5×3.5": [
    { w: 7, h: 5 },
    { w: 3.5, h: 2.5 },
    { w: 3.5, h: 2.5 },
    { w: 3.5, h: 2.5 },
    { w: 3.5, h: 2.5 },
  ],
  "(2) 5×7": [
    { w: 7, h: 5 },
    { w: 7, h: 5 },
  ],
  "(4) 3.5×5": [
    { w: 3.5, h: 5 },
    { w: 3.5, h: 5 },
    { w: 3.5, h: 5 },
    { w: 3.5, h: 5 },
  ],
  "(8) 2.5×3.5": Array.from({ length: 8 }, () => ({ w: 3.5, h: 2.5 })),
};

/** Shelf-pack `sizes` (px) into the page's printable box, in order: rows fill
 *  left→right and wrap when the next cell would overflow; each row centers
 *  horizontally and the whole block centers vertically (LR centers the
 *  package). A cell that cannot fit anywhere is dropped and counted — the
 *  caller reports it rather than silently printing fewer prints. */
export function picturePackageCells(
  pageW: number,
  pageH: number,
  margin: MarginSpec,
  gutter: number,
  sizes: readonly { w: number; h: number }[],
): { cells: Rect[]; dropped: number } {
  const box = printableBox(pageW, pageH, margin);
  const availW = box.w;
  const availH = box.h;
  interface Shelf {
    cells: { w: number; h: number }[];
    w: number;
    h: number;
  }
  const shelves: Shelf[] = [];
  let cur: Shelf | null = null;
  let usedH = 0; // total height of all shelves incl. inter-shelf gutters
  let dropped = 0;
  for (const s of sizes) {
    if (s.w > availW || s.h > availH) {
      dropped++;
      continue;
    }
    if (cur != null && cur.w + gutter + s.w <= availW) {
      const grow = Math.max(0, s.h - cur.h);
      if (usedH + grow <= availH) {
        cur.cells.push({ ...s });
        cur.w += gutter + s.w;
        cur.h += grow;
        usedH += grow;
        continue;
      }
      // taller than the remaining page — fall through to try a new shelf
    }
    const nextH = usedH + (shelves.length > 0 ? gutter : 0) + s.h;
    if (nextH > availH) {
      dropped++;
      continue; // later, smaller cells may still fit the current shelf
    }
    cur = { cells: [{ ...s }], w: s.w, h: s.h };
    shelves.push(cur);
    usedH = nextH;
  }

  const cells: Rect[] = [];
  let y = box.y + (availH - usedH) / 2;
  for (const shelf of shelves) {
    let x = box.x + (availW - shelf.w) / 2;
    for (const c of shelf.cells) {
      cells.push({
        x: Math.round(x),
        y: Math.round(y + (shelf.h - c.h) / 2),
        w: Math.round(c.w),
        h: Math.round(c.h),
      });
      x += c.w + gutter;
    }
    y += shelf.h + gutter;
  }
  return { cells, dropped };
}

/** Source crop (image px) that fills a `cellW`×`cellH` cell edge-to-edge —
 *  LR's Zoom to Fill, the Picture Package default: the largest centered
 *  region matching the cell's aspect. */
export function coverCrop(imgW: number, imgH: number, cellW: number, cellH: number): Rect {
  const cellAspect = cellW / Math.max(1, cellH);
  if (imgW / imgH > cellAspect) {
    const w = Math.max(1, Math.round(imgH * cellAspect));
    return { x: Math.round((imgW - w) / 2), y: 0, w, h: imgH };
  }
  const h = Math.max(1, Math.round(imgW / cellAspect));
  return { x: 0, y: Math.round((imgH - h) / 2), w: imgW, h };
}

/** A rows × cols grid that holds at least `n` cells, shaped so the cells track
 *  the page's printable `aspect` (= printableW / printableH). On a portrait page
 *  (aspect < 1) this is row-dominant so landscape thumbnails don't float in tall
 *  cells; on a landscape page it's column-dominant. aspect=1 → near-square. */
export function gridForCount(n: number, aspect = 1): { rows: number; cols: number } {
  const count = Math.max(1, Math.floor(n));
  const a = aspect > 0 ? aspect : 1;
  const cols = Math.max(1, Math.round(Math.sqrt(count * a)));
  const rows = Math.max(1, Math.ceil(count / cols));
  return { rows, cols };
}
