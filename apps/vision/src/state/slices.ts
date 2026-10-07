// ─────────────────────────────────────────────────────────────
// Slices — pure geometry + stack logic for the Slice / Slice Select
// tools (Photoshop). A slice is a rectangular region of the document
// (doc-space px) used to divide an image for web export. Engine-free so
// it unit-tests in node; the store holds the slice list + selection and
// CanvasView draws/edits them through these helpers.
// ─────────────────────────────────────────────────────────────

export interface Slice {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalize a drag (two corners) into a positive-extent, integer Slice. */
export function sliceFromDrag(x0: number, y0: number, x1: number, y1: number): Slice {
  return {
    x: Math.round(Math.min(x0, x1)),
    y: Math.round(Math.min(y0, y1)),
    w: Math.round(Math.abs(x1 - x0)),
    h: Math.round(Math.abs(y1 - y0)),
  };
}

/** Append a slice to the stack (immutable). */
export function addSlice(slices: Slice[], s: Slice): Slice[] {
  return [...slices, s];
}

/** Remove slice `i` from the stack (immutable; out-of-range → unchanged). */
export function deleteSlice(slices: Slice[], i: number): Slice[] {
  if (i < 0 || i >= slices.length) return slices;
  return slices.filter((_, j) => j !== i);
}

/** The topmost slice whose body contains (x,y), or -1. Later slices draw on top,
 *  so the search runs from the end (the visually-frontmost first). */
export function hitTestSlice(slices: Slice[], x: number, y: number): number {
  for (let i = slices.length - 1; i >= 0; i--) {
    const s = slices[i];
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return i;
  }
  return -1;
}

/** Move a slice by (dx,dy), keeping its size (immutable; integer result). */
export function moveSliceBy(s: Slice, dx: number, dy: number): Slice {
  return { x: Math.round(s.x + dx), y: Math.round(s.y + dy), w: s.w, h: s.h };
}

/** The 8 resize handles of a slice, doc-space px — 4 corners + 4 edge midpoints,
 *  clockwise from top-left: TL, T, TR, R, BR, B, BL, L (matches transformHandles). */
export function sliceHandles(s: Slice): { x: number; y: number }[] {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const r = s.x + s.w;
  const b = s.y + s.h;
  return [
    { x: s.x, y: s.y }, { x: cx, y: s.y }, { x: r, y: s.y },
    { x: r, y: cy }, { x: r, y: b }, { x: cx, y: b },
    { x: s.x, y: b }, { x: s.x, y: cy },
  ];
}

/** Index (0..7, matching sliceHandles) of the handle within `tol` doc-px of
 *  (x,y), or -1 when the point is on no handle. */
export function hitTestHandle(s: Slice, x: number, y: number, tol: number): number {
  const hs = sliceHandles(s);
  for (let i = 0; i < hs.length; i++) {
    if (Math.abs(hs[i].x - x) <= tol && Math.abs(hs[i].y - y) <= tol) return i;
  }
  return -1;
}

// Which edges each handle drags (left/top/right/bottom), ordered like sliceHandles.
const HANDLE_EDGES: { l: boolean; t: boolean; r: boolean; b: boolean }[] = [
  { l: true, t: true, r: false, b: false },  // 0 TL
  { l: false, t: true, r: false, b: false }, // 1 T
  { l: false, t: true, r: true, b: false },  // 2 TR
  { l: false, t: false, r: true, b: false }, // 3 R
  { l: false, t: false, r: true, b: true },  // 4 BR
  { l: false, t: false, r: false, b: true }, // 5 B
  { l: true, t: false, r: false, b: true },  // 6 BL
  { l: true, t: false, r: false, b: false }, // 7 L
];

/** Resize a slice by dragging handle `h` to (px,py). Returns a normalized,
 *  integer Slice (min extent 1) — edges flip cleanly if dragged past each other. */
export function resizeSliceTo(s: Slice, h: number, px: number, py: number): Slice {
  const e = HANDLE_EDGES[h] ?? HANDLE_EDGES[4];
  let left = s.x;
  let top = s.y;
  let right = s.x + s.w;
  let bottom = s.y + s.h;
  if (e.l) left = px;
  if (e.r) right = px;
  if (e.t) top = py;
  if (e.b) bottom = py;
  return {
    x: Math.round(Math.min(left, right)),
    y: Math.round(Math.min(top, bottom)),
    w: Math.max(1, Math.round(Math.abs(right - left))),
    h: Math.max(1, Math.round(Math.abs(bottom - top))),
  };
}

/** Clamp a slice to the document bounds; null when nothing remains. */
export function clampSliceToDoc(s: Slice, docW: number, docH: number): Slice | null {
  const x = Math.max(0, Math.min(s.x, docW));
  const y = Math.max(0, Math.min(s.y, docH));
  const w = Math.min(s.x + s.w, docW) - x;
  const h = Math.min(s.y + s.h, docH) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Photoshop Save-for-Web slice naming: "{stem}_{NN}.{ext}" (1-based, padded). */
export function sliceExportName(stem: string, index: number, ext: string): string {
  return `${stem}_${String(index + 1).padStart(2, "0")}.${ext}`;
}
