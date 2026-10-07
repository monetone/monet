// vectorPathOverlay: the geometry behind the Direct/Path Selection overlay.
// The engine hands us a vector layer's scene as `.artisan` JSON
// (`vector_scene_json`); the canvas needs the same anchors the engine picks with
// `vector_nearest_anchor` — in WORLD space, keyed by the same {item, index} pair
// `vector_move_anchor` takes. So this walks the scene exactly like the Rust walk
// does (children first, then the item's own geometry) and flattens it.
//
// Pure + node-testable on purpose: CanvasView.tsx cannot be imported by a unit
// test (it pulls the wasm `@engine`), so every rule that can be wrong lives here.

import { ANCHOR_STRIDE, WORK_PATH_ITEM, anchorLoops } from "../state/paths";

/** A 2×3 affine matrix, the vector model's `transform` (see vector/model.rs). */
export interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number }

/** One anchor in world space. `in`/`out` are the bezier handles as OFFSETS from
 *  the point, matching the model (which is why moving a point carries them). */
export interface OverlayAnchor {
  x: number; y: number;
  inX: number; inY: number;
  outX: number; outY: number;
}

export interface OverlayPath {
  item: string;
  closed: boolean;
  anchors: OverlayAnchor[];
  /** Where this outline's anchors start in the item's flat address space. One
   *  item can carry several — a glyph converted from type is a single `compound`
   *  whose contours live in `subpaths` — and the engine numbers them straight
   *  through, so each outline after the first is offset. (#452) */
  indexBase: number;
}

/** The engine's anchor address: item id + index into that item's `geometry.anchors`. */
export interface AnchorRef { item: string; index: number }

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** `geom::m_mul` — parent ∘ child, so a child's transform composes under its group. */
export function mMul(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function matrixOf(raw: unknown): Matrix {
  const t = raw as Partial<Matrix> | undefined;
  if (!t || typeof t !== "object") return IDENTITY;
  return { a: num(t.a, 1), b: num(t.b), c: num(t.c), d: num(t.d, 1), e: num(t.e), f: num(t.f) };
}

const applyPoint = (m: Matrix, x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
// Handles are directions, not positions — no translation (`geom::apply_vector`).
const applyVector = (m: Matrix, x: number, y: number) => ({ x: m.a * x + m.c * y, y: m.b * x + m.d * y });

interface RawItem {
  id?: unknown;
  transform?: unknown;
  visible?: unknown;
  children?: unknown;
  geometry?: { anchors?: unknown; closed?: unknown };
  subpaths?: unknown;
}

function walk(items: unknown, parent: Matrix, out: OverlayPath[]) {
  if (!Array.isArray(items)) return;
  for (const raw of items as RawItem[]) {
    if (!raw || typeof raw !== "object") continue;
    const world = mMul(parent, matrixOf(raw.transform));
    // Same order as `vector_nearest_anchor`: descend first, then this item.
    walk(raw.children, world, out);
    if (raw.visible === false) continue;
    // geometry first, then each subpath — the order the engine addresses them in.
    const outlines = [
      ...(raw.geometry ? [raw.geometry] : []),
      ...(Array.isArray(raw.subpaths) ? (raw.subpaths as { anchors?: unknown; closed?: unknown }[]) : []),
    ];
    let indexBase = 0;
    for (const outline of outlines) {
    const anchors = outline?.anchors;
    if (!Array.isArray(anchors) || anchors.length === 0) continue;
    out.push({
      item: typeof raw.id === "string" ? raw.id : "",
      closed: outline?.closed === true,
      indexBase,
      anchors: anchors.map((a) => {
        const rec = (a ?? {}) as { point?: { x?: unknown; y?: unknown }; handleIn?: { x?: unknown; y?: unknown }; handleOut?: { x?: unknown; y?: unknown } };
        const p = applyPoint(world, num(rec.point?.x), num(rec.point?.y));
        const hi = applyVector(world, num(rec.handleIn?.x), num(rec.handleIn?.y));
        const ho = applyVector(world, num(rec.handleOut?.x), num(rec.handleOut?.y));
        return { x: p.x, y: p.y, inX: hi.x, inY: hi.y, outX: ho.x, outY: ho.y };
      }),
    });
    indexBase += anchors.length;
    }
  }
}

/** Flatten a vector layer's scene into world-space outlines + anchors. Returns
 *  [] for an empty/garbage scene — the overlay must never take the canvas down. */
export function vectorPathsFromSceneJson(sceneJson: string): OverlayPath[] {
  if (!sceneJson) return [];
  let root: { layers?: unknown } | null = null;
  try {
    root = JSON.parse(sceneJson) as { layers?: unknown };
  } catch {
    return [];
  }
  const out: OverlayPath[] = [];
  if (Array.isArray(root?.layers)) {
    for (const layer of root.layers as { items?: unknown; visible?: unknown }[]) {
      if (layer?.visible === false) continue;
      walk(layer?.items, IDENTITY, out);
    }
  }
  return out;
}

/** The host work path (Type ▸ Create Work Path, the Pen) as overlay outlines:
 *  one closed entry per loop, anchors numbered straight through the way a
 *  compound's contours are, so the marquee and drag origins address it too. */
export function workPathOverlays(anchors: number[], contours: number[]): OverlayPath[] {
  let indexBase = 0;
  return anchorLoops(anchors, contours).map((loop) => {
    const out: OverlayAnchor[] = [];
    for (let o = 0; o + ANCHOR_STRIDE <= loop.length; o += ANCHOR_STRIDE) {
      out.push({ x: loop[o], y: loop[o + 1], inX: loop[o + 2], inY: loop[o + 3], outX: loop[o + 4], outY: loop[o + 5] });
    }
    const path: OverlayPath = { item: WORK_PATH_ITEM, closed: true, anchors: out, indexBase };
    indexBase += out.length;
    return path;
  });
}

/** Nearest anchor within `tol` (document px), by flat index — what
 *  `vector_nearest_anchor` answers for an engine scene. */
export function nearestOverlayAnchor(paths: OverlayPath[], x: number, y: number, tol: number): AnchorRef | null {
  let best: AnchorRef | null = null;
  let bestD = tol;
  for (const p of paths) {
    for (let i = 0; i < p.anchors.length; i++) {
      const d = Math.hypot(p.anchors[i].x - x, p.anchors[i].y - y);
      if (d <= tol && (!best || d < bestD)) { best = { item: p.item, index: p.indexBase + i }; bestD = d; }
    }
  }
  return best;
}

/** Nearest direction-handle end within `tol`, like `vector_nearest_handle`: a
 *  zero-length handle sits on its anchor, so it is never the one grabbed. */
export function nearestOverlayHandle(paths: OverlayPath[], x: number, y: number, tol: number): (AnchorRef & { end: "in" | "out" }) | null {
  let best: (AnchorRef & { end: "in" | "out" }) | null = null;
  let bestD = tol;
  for (const p of paths) {
    for (let i = 0; i < p.anchors.length; i++) {
      const a = p.anchors[i];
      for (const [end, hx, hy] of [["in", a.inX, a.inY], ["out", a.outX, a.outY]] as const) {
        if (hx === 0 && hy === 0) continue;
        const d = Math.hypot(a.x + hx - x, a.y + hy - y);
        if (d <= tol && (!best || d < bestD)) { best = { item: p.item, index: p.indexBase + i, end }; bestD = d; }
      }
    }
  }
  return best;
}

/** SVG `d` for one path — cubic segments so a curved shape draws as the engine
 *  renders it, not as a polygon. */
export function pathOutlineD(path: OverlayPath): string {
  const a = path.anchors;
  if (a.length === 0) return "";
  let d = `M ${a[0].x} ${a[0].y}`;
  const last = path.closed ? a.length : a.length - 1;
  for (let i = 0; i < last; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    d += ` C ${p.x + p.outX} ${p.y + p.outY} ${q.x + q.inX} ${q.y + q.inY} ${q.x} ${q.y}`;
  }
  if (path.closed) d += " Z";
  return d;
}

/** Stable key for a selection Set — `{item,index}` is the engine's own address. */
export const anchorKey = (a: AnchorRef) => `${a.item}#${a.index}`;

/** Every anchor inside the marquee (document space, corners in any order). */
export function anchorsInRect(paths: OverlayPath[], x0: number, y0: number, x1: number, y1: number): AnchorRef[] {
  const lx = Math.min(x0, x1), rx = Math.max(x0, x1);
  const ty = Math.min(y0, y1), by = Math.max(y0, y1);
  const out: AnchorRef[] = [];
  for (const p of paths) {
    p.anchors.forEach((a, index) => {
      if (a.x >= lx && a.x <= rx && a.y >= ty && a.y <= by) out.push({ item: p.item, index: p.indexBase + index });
    });
  }
  return out;
}

/** World position of each selected anchor, captured at drag start so a
 *  multi-anchor drag stays absolute (delta from the grab point, drift-free). */
export function anchorOrigins(paths: OverlayPath[], sel: AnchorRef[]): { item: string; index: number; x: number; y: number }[] {
  const out: { item: string; index: number; x: number; y: number }[] = [];
  for (const s of sel) {
    // One item can span several outlines and the address runs flat across them,
    // so the anchor is in whichever outline's range holds the index.
    const p = paths.find((q) => q.item === s.item
      && s.index >= q.indexBase && s.index < q.indexBase + q.anchors.length);
    const a = p?.anchors[s.index - p.indexBase];
    if (a) out.push({ item: s.item, index: s.index, x: a.x, y: a.y });
  }
  return out;
}

/** Shift-click semantics: toggle one anchor in/out of the selection. */
export function toggleAnchor(sel: AnchorRef[], hit: AnchorRef): AnchorRef[] {
  const key = anchorKey(hit);
  const next = sel.filter((a) => anchorKey(a) !== key);
  return next.length === sel.length ? [...sel, hit] : next;
}
