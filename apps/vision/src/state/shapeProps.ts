// ─────────────────────────────────────────────────────────────
// shapeProps — a shape layer's live properties, read and patched in scene JSON
// ─────────────────────────────────────────────────────────────
// Photoshop keeps a shape layer editable forever: fill, stroke (colour, width,
// align, dash, cap, join), W/H/X/Y and FOUR independent corner radii. Vision's
// shapes are real Artisan scene items, so every one of those is a read or a
// patch of the layer's scene JSON — pure functions here, so the maths unit-tests
// in node instead of behind wasm, and the Store only has to route the result
// through `vector_set_scene` for one undoable step. (#450)

/** r,g,b and a all 0..255 — the store's colour convention (`hsvToRgba`). The
 *  scene's own paint model wants 0..255 channels but 0..1 alpha. */
export type ShapeRgba = [number, number, number, number];

export const STROKE_ALIGNS = ["inside", "center", "outside"] as const;
export const STROKE_CAPS = ["butt", "round", "square"] as const;
export const STROKE_JOINS = ["miter", "round", "bevel"] as const;
export type StrokeAlign = (typeof STROKE_ALIGNS)[number];
export type StrokeCap = (typeof STROKE_CAPS)[number];
export type StrokeJoin = (typeof STROKE_JOINS)[number];

export interface ShapeStroke {
  /** null when the item has no stroke paint (or a gradient/pattern one). */
  color: ShapeRgba | null;
  width: number;
  align: StrokeAlign;
  cap: StrokeCap;
  join: StrokeJoin;
  dash: number[];
}

export interface ShapeProps {
  id: string;
  kind: string;
  /** CANVAS-space bounds: the item's local bounds through its whole matrix. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when the transform carries a rotation, scale or skew (an imported
   *  .artisan scene can). X/Y still move such an item — a translation shifts
   *  its bounds 1:1 — but W/H are the bounds of the transformed shape and
   *  read-only: no single local size resizes a rotated rect to a given box. */
  transformed: boolean;
  /** [top-left, top-right, bottom-right, bottom-left]; null unless it's a rect. */
  radii: [number, number, number, number] | null;
  /** null when the fill is none, or a gradient/pattern the panel can't show. */
  fill: ShapeRgba | null;
  stroke: ShapeStroke;
}

export type ShapePatch = Partial<Pick<ShapeProps, "x" | "y" | "w" | "h" | "radii" | "fill">>
  & { stroke?: Partial<ShapeStroke> };

interface Pt { x: number; y: number }
interface Anchor { point?: Pt; handleIn?: Pt; handleOut?: Pt }
interface Geometry { anchors?: Anchor[]; closed?: boolean }
interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number }
interface Paint { type?: string; color?: { r?: number; g?: number; b?: number; a?: number } }
interface RawStroke { paint?: Paint; width?: number; align?: string; cap?: string; join?: string; dash?: number[] }
interface RawItem {
  type?: string; id?: string; transform?: Matrix;
  width?: number; height?: number; rx?: number; ry?: number; radii?: number[];
  fill?: Paint; stroke?: RawStroke;
  geometry?: Geometry; subpaths?: Geometry[]; children?: RawItem[];
  x1?: number; y1?: number; x2?: number; y2?: number;
}
interface Scene { layers?: { items?: RawItem[] }[] }

interface Bounds { x: number; y: number; w: number; h: number }

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  (list as readonly string[]).includes(v as string) ? (v as T) : fallback;

/** Items positioned+sized by width/height (their local origin is 0,0) rather
 *  than by their anchors. `image` is deliberately absent: it isn't a shape. */
const isSized = (it: RawItem) => it.type === "rect" || it.type === "ellipse";

/** Where a cubic reaches its extremes on one axis, between its endpoints: the
 *  roots of B'(t) = 0 that fall inside the segment. Without these a curve that
 *  bulges past its anchors measures short — an arch whose anchors share a
 *  baseline read as zero high, so the panel could neither report its height nor
 *  scale it. */
function cubicExtent(p0: number, c1: number, c2: number, p3: number): [number, number] {
  const values = [p0, p3];
  const a = -p0 + 3 * c1 - 3 * c2 + p3;
  const b = 2 * (p0 - 2 * c1 + c2);
  const c = c1 - p0;
  const at = (t: number) => {
    if (!(t > 0 && t < 1)) return;
    const u = 1 - t;
    values.push(u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p3);
  };
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) at(-c / b); // the derivative is linear
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      at((-b + root) / (2 * a));
      at((-b - root) / (2 * a));
    }
  }
  return [Math.min(...values), Math.max(...values)];
}

/** LOCAL-space bounds, ignoring the item's transform. Null for anything the
 *  panel can't measure — a group, an image, a text run, an Artisan polygon/star
 *  (radius-driven, which Vision never authors). Curves are measured through
 *  their extrema, so W/H/X/Y describe what the shape actually occupies. */
function localBounds(it: RawItem): Bounds | null {
  if (isSized(it)) return { x: 0, y: 0, w: Math.max(0, num(it.width)), h: Math.max(0, num(it.height)) };
  const xs: number[] = [];
  const ys: number[] = [];
  if (it.type === "line") {
    xs.push(num(it.x1), num(it.x2));
    ys.push(num(it.y1), num(it.y2));
  }
  for (const geo of [it.geometry, ...(it.subpaths ?? [])]) {
    const anchors = (geo?.anchors ?? []).filter((a) => a?.point);
    for (const a of anchors) {
      xs.push(num(a.point!.x));
      ys.push(num(a.point!.y));
    }
    // Each segment between consecutive anchors, plus the closing one. Handles
    // are offsets from their own anchor (the scene's model).
    const last = geo?.closed ? anchors.length : anchors.length - 1;
    for (let i = 0; i < last; i++) {
      const from = anchors[i];
      const to = anchors[(i + 1) % anchors.length];
      if (!from || !to) continue;
      const [x0, y0] = [num(from.point!.x), num(from.point!.y)];
      const [x3, y3] = [num(to.point!.x), num(to.point!.y)];
      const [cx1, cy1] = [x0 + num(from.handleOut?.x), y0 + num(from.handleOut?.y)];
      const [cx2, cy2] = [x3 + num(to.handleIn?.x), y3 + num(to.handleIn?.y)];
      xs.push(...cubicExtent(x0, cx1, cx2, x3));
      ys.push(...cubicExtent(y0, cy1, cy2, y3));
    }
  }
  if (!xs.length) return null;
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const matrixOf = (it: RawItem): Matrix => {
  const t = it.transform;
  return { a: num(t?.a, 1), b: num(t?.b), c: num(t?.c), d: num(t?.d, 1), e: num(t?.e), f: num(t?.f) };
};
const isTranslate = (t: Matrix) => t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1;
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
/** `m ∘ n` — n applied first. The engine's `vector/geom.rs m_mul`. */
const mul = (m: Matrix, n: Matrix): Matrix => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
});
/** Null for a collapsed matrix — a group scaled to nothing has no space to
 *  write a canvas-space edit back into. */
function invert(m: Matrix): Matrix | null {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || det === 0) return null;
  return {
    a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** `local` mapped through `t` (SVG order: x' = ax + cy + e, y' = bx + dy + f)
 *  and re-boxed — what the shape occupies on the canvas. */
function canvasBounds(local: Bounds, t: Matrix): Bounds {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [[local.x, local.y], [local.x + local.w, local.y], [local.x, local.y + local.h], [local.x + local.w, local.y + local.h]]) {
    xs.push(t.a * x + t.c * y + t.e);
    ys.push(t.b * x + t.d * y + t.f);
  }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const solidRgba = (p: Paint | undefined): ShapeRgba | null =>
  p?.type === "solid"
    ? [num(p.color?.r), num(p.color?.g), num(p.color?.b), Math.round(num(p.color?.a, 1) * 255)]
    : null;

const solidPaint = (c: ShapeRgba): Paint => ({ type: "solid", color: { r: c[0], g: c[1], b: c[2], a: c[3] / 255 } });

/** Every top-level item of every layer, in scene order — a shape layer's "path
 *  components", the same level `sceneComponentIds` and the pathfinder work at. */
function components(scene: Scene): RawItem[] {
  const out: RawItem[] = [];
  for (const layer of scene?.layers ?? []) for (const it of layer?.items ?? []) if (it) out.push(it);
  return out;
}

/** An item and the world transform of whatever contains it (identity at the top
 *  level), so a grouped child reads and writes in canvas space. */
interface Picked { item: RawItem; parent: Matrix }

/** Depth-first through groups, accumulating their transforms — Path Selection
 *  hit-tests into groups and hands back the LEAF id (`query::hit_items`), so an
 *  imported grouped scene needs the same reach here. */
function findItem(items: RawItem[], id: string, parent: Matrix): Picked | null {
  for (const it of items) {
    if (it.id === id && localBounds(it)) return { item: it, parent };
    if (it.children?.length) {
      const nested = findItem(it.children, id, mul(parent, matrixOf(it)));
      if (nested) return nested;
    }
  }
  return null;
}

/** The component the panel edits. With a pick, it is THAT component or nothing:
 *  falling through to another one showed — and edited — a shape the user never
 *  selected. Without a pick, the first measurable component. */
function pickItem(scene: Scene, itemId?: string): Picked | null {
  const items = components(scene);
  if (itemId) return findItem(items, itemId, IDENTITY);
  const first = items.find((it) => localBounds(it));
  return first ? { item: first, parent: IDENTITY } : null;
}

const parse = (sceneJson: string): Scene | null => {
  if (!sceneJson) return null;
  try {
    return JSON.parse(sceneJson) as Scene;
  } catch {
    return null;
  }
};

/** The live properties of one measurable item. */
function propsOf(item: RawItem, local: Bounds, parent: Matrix = IDENTITY): ShapeProps {
  const t = mul(parent, matrixOf(item));
  const box = canvasBounds(local, t);
  const s = item.stroke;
  const r = num(item.rx);
  const radii = Array.isArray(item.radii) && item.radii.length === 4
    ? (item.radii.map((v) => Math.max(0, num(v))) as [number, number, number, number])
    : ([r, r, r, r] as [number, number, number, number]);
  return {
    id: item.id ?? "",
    kind: item.type ?? "",
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    transformed: !isTranslate(t),
    radii: item.type === "rect" ? radii : null,
    fill: solidRgba(item.fill),
    stroke: {
      color: solidRgba(s?.paint),
      width: Math.max(0, num(s?.width)),
      align: oneOf(STROKE_ALIGNS, s?.align, "center"),
      cap: oneOf(STROKE_CAPS, s?.cap, "butt"),
      join: oneOf(STROKE_JOINS, s?.join, "miter"),
      dash: Array.isArray(s?.dash) ? s.dash.map((v) => num(v)) : [],
    },
  };
}

/** The live properties of `itemId` (or the layer's first editable component).
 *  Null when the scene has none — an empty/garbage scene, or a layer holding
 *  nothing but groups and images. */
export function shapePropsFromScene(sceneJson: string, itemId?: string): ShapeProps | null {
  const scene = parse(sceneJson);
  if (!scene) return null;
  const picked = pickItem(scene, itemId);
  const local = picked && localBounds(picked.item);
  return picked && local ? propsOf(picked.item, local, picked.parent) : null;
}

/** Scale an anchored item about its local bounds origin, so the visible left/top
 *  edge stays put while W/H grow — what dragging a bbox handle does. */
function scaleAnchors(it: RawItem, local: Bounds, sx: number, sy: number) {
  const map = (p: Pt | undefined, isPoint: boolean) => {
    if (!p) return;
    p.x = isPoint ? local.x + (num(p.x) - local.x) * sx : num(p.x) * sx;
    p.y = isPoint ? local.y + (num(p.y) - local.y) * sy : num(p.y) * sy;
  };
  if (it.type === "line") {
    it.x1 = local.x + (num(it.x1) - local.x) * sx;
    it.x2 = local.x + (num(it.x2) - local.x) * sx;
    it.y1 = local.y + (num(it.y1) - local.y) * sy;
    it.y2 = local.y + (num(it.y2) - local.y) * sy;
  }
  for (const geo of [it.geometry, ...(it.subpaths ?? [])]) {
    for (const a of geo?.anchors ?? []) {
      map(a?.point, true);
      map(a?.handleIn, false); // handles are RELATIVE to their anchor
      map(a?.handleOut, false);
    }
  }
}

/** `sceneJson` with `itemId`'s live properties patched — the whole scene back,
 *  ready for `vector_set_scene`. Returns the input untouched when nothing
 *  changed, so a no-op never costs an undo step. */
export function sceneWithShapeProps(sceneJson: string, itemId: string, patch: ShapePatch): string {
  const scene = parse(sceneJson);
  if (!scene) return sceneJson;
  const picked = pickItem(scene, itemId);
  const local = picked && localBounds(picked.item);
  if (!picked || !local) return sceneJson;
  const { item, parent } = picked;
  const before = propsOf(item, local, parent);
  // Edits are expressed on the canvas, so they are applied to the item's WORLD
  // transform and folded back through its container's.
  const toLocal = invert(parent);
  if (!toLocal) return sceneJson;
  const t = mul(parent, matrixOf(item));

  // Position: move the transform, never the geometry — X/Y is where the item's
  // bounds land on the canvas, and a translation shifts them 1:1 whatever the
  // rest of the matrix does.
  if (Number.isFinite(patch.x as number)) t.e += (patch.x as number) - before.x;
  if (Number.isFinite(patch.y as number)) t.f += (patch.y as number) - before.y;
  item.transform = mul(toLocal, t);

  // Size: only through a plain translation (see ShapeProps.transformed).
  if (!before.transformed) {
    const w = Number.isFinite(patch.w as number) ? Math.max(0, patch.w as number) : local.w;
    const h = Number.isFinite(patch.h as number) ? Math.max(0, patch.h as number) : local.h;
    if (isSized(item)) {
      if (w !== local.w) item.width = w;
      if (h !== local.h) item.height = h;
    } else if (w !== local.w || h !== local.h) {
      // A zero-extent axis (a horizontal line's height) has nothing to scale.
      scaleAnchors(item, local, local.w > 0 ? w / local.w : 1, local.h > 0 ? h / local.h : 1);
    }
  }

  if (patch.radii && item.type === "rect") {
    const r = patch.radii.map((v) => Math.max(0, num(v)));
    // Uniform corners stay the plain rx/ry pair; four different ones need the
    // engine's `radii` list, which wins over the pair under the SAME per-axis
    // clamp, so flipping between the two never reshapes a corner.
    // ponytail: Artisan's TS engine (RectItem rx/ry, render/item-node.tsx,
    // engine/io/svg.ts) doesn't read `radii`, so the pair it does read is the
    // mean — the closest one uniform radius. Teaching its model/shapes.ts,
    // renderer and exporter the list is the upgrade.
    if (r.some((v, i) => v !== before.radii![i])) {
      item.rx = item.ry = (r[0] + r[1] + r[2] + r[3]) / 4;
      if (r.every((v) => v === r[0])) delete item.radii;
      else item.radii = r;
    }
  }

  if (patch.fill) item.fill = solidPaint(patch.fill);
  if (patch.stroke) {
    const p = patch.stroke;
    const s: RawStroke = item.stroke ?? {};
    item.stroke = s;
    if (p.color) s.paint = solidPaint(p.color);
    if (Number.isFinite(p.width as number)) s.width = Math.max(0, p.width as number);
    if (p.align) s.align = p.align;
    if (p.cap) s.cap = p.cap;
    if (p.join) s.join = p.join;
    if (p.dash) s.dash = p.dash.filter((v) => Number.isFinite(v)).map((v) => Math.max(0, v));
    // A width with no paint would stroke nothing; black is the visible default,
    // the same call Photoshop makes when you give a shape a stroke.
    if (num(s.width) > 0 && !s.paint) s.paint = solidPaint([0, 0, 0, 255]);
  }
  // Compared on the live properties, not the text: a write above may only have
  // materialised a default (an identity transform, an empty stroke) that the
  // engine reads the same — that is not an edit, and must not cost an undo step.
  const after = propsOf(item, localBounds(item) ?? local, parent);
  return JSON.stringify(after) === JSON.stringify(before) ? sceneJson : JSON.stringify(scene);
}

/** "6, 3" → [6, 3] — the Stroke dash field's free-text pattern. Empty (or all
 *  junk) means a solid stroke. */
export function parseDash(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .filter((part) => part !== "") // "" splits to [""], and Number("") is 0
    .map((part) => Number(part))
    .filter((v) => Number.isFinite(v) && v >= 0);
}

export const formatDash = (dash: number[]) => dash.join(", ");
