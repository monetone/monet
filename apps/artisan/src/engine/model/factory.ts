// ─────────────────────────────────────────────────────────────
// model/factory — id generation, defaults, and node constructors
// ─────────────────────────────────────────────────────────────

import { IDENTITY, translation, type Matrix } from "../geometry/matrix";
import { anchor, type Anchor, type PathGeometry } from "../geometry/path";
import { BLACK, type RGBA, WHITE, rgba } from "../color";
import { cloneDeep } from "../clone";
import { makeCalligraphicBrushDefinition } from "./brushes";
import { defaultExportForScreensSettings } from "./export";
import { defaultShortcutSettings } from "./shortcuts";
import { defaultVariableSettings } from "./variables";
import type {
  AppearanceStack,
  Artboard,
  BrushDefinition,
  CompoundPathItem,
  Document,
  EllipseItem,
  Gradient,
  GroupItem,
  ImageItem,
  Item,
  ItemBase,
  Layer,
  LineItem,
  Paint,
  PathItem,
  PlacedAsset,
  PlacedAssetMode,
  PolygonItem,
  RectItem,
  StarItem,
  Stroke,
  TextItem,
} from "./types";

// ── IDs ──────────────────────────────────────────────────────
let _counter = 0;
const _base = Math.floor(Math.random() * 0x7fffffff).toString(36);
export const newId = (prefix = "i"): string => `${prefix}_${_base}${(_counter++).toString(36)}`;

// ── Paint / Stroke defaults ──────────────────────────────────
export const noPaint = (): Paint => ({ type: "none" });
export const solid = (color: RGBA): Paint => ({ type: "solid", color: { ...color } });

export const linearGradient = (stops = defaultStops(), angleDeg = 0): Paint => {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  return {
    type: "gradient",
    gradient: {
      type: "linear",
      stops,
      x1: 0.5 - dx,
      y1: 0.5 - dy,
      x2: 0.5 + dx,
      y2: 0.5 + dy,
      cx: 0.5,
      cy: 0.5,
      r: 0.5,
    },
  };
};

export const radialGradient = (stops = defaultStops()): Paint => ({
  type: "gradient",
  gradient: { type: "radial", stops, x1: 0.5, y1: 0.5, x2: 1, y2: 0.5, cx: 0.5, cy: 0.5, r: 0.5 },
});

/** Re-aim a gradient from drag points n1→n2 (objectBoundingBox 0..1 coords): the
 *  linear axis is set for any type, and a RADIAL gradient also gets its centre
 *  (n1), radius (|n2−n1|) and focal point (n1) — so the Gradient tool actually
 *  moves a radial fill (which renders from cx/cy/r, not the linear endpoints). */
export const aimGradient = (
  grad: Gradient,
  n1: { x: number; y: number },
  n2: { x: number; y: number },
): Gradient => {
  const next: Gradient = { ...grad, x1: n1.x, y1: n1.y, x2: n2.x, y2: n2.y };
  if (grad.type === "radial") {
    next.cx = n1.x;
    next.cy = n1.y;
    next.r = Math.hypot(n2.x - n1.x, n2.y - n1.y);
    next.fx = n1.x;
    next.fy = n1.y;
  }
  return next;
};

export const pattern = (tile: Item[], width: number, height: number, transform?: Matrix): Paint => ({
  type: "pattern",
  pattern: { tile, width, height, ...(transform ? { transform } : {}) },
});

export const defaultStops = (): Gradient["stops"] => [
  { offset: 0, color: WHITE },
  { offset: 1, color: BLACK },
];

export const defaultStroke = (paint: Paint = solid(BLACK)): Stroke => ({
  paint,
  width: 1,
  cap: "butt",
  join: "miter",
  miterLimit: 10,
  dash: [],
  dashOffset: 0,
  align: "center",
});

export const defaultFill = (): Paint => solid(WHITE);

export const makeCalligraphicBrush = (
  name = "Basic Calligraphic",
  opts: Partial<Omit<BrushDefinition, "id" | "name" | "kind">> & { id?: string } = {},
): BrushDefinition =>
  makeCalligraphicBrushDefinition(opts.id ?? newId("br"), name, opts, {
    createdAt: opts.createdAt,
    updatedAt: opts.updatedAt,
  });

export const defaultBrushes = (): BrushDefinition[] => [
  makeCalligraphicBrush("Basic Calligraphic"),
];

// ── Item base ────────────────────────────────────────────────
export interface BaseOpts {
  name?: string;
  transform?: Matrix;
  fill?: Paint;
  stroke?: Stroke;
  appearance?: AppearanceStack;
  opacity?: number;
}

const base = (kind: string, opts: BaseOpts = {}): ItemBase => ({
  id: newId(kind[0]),
  name: opts.name ?? "",
  transform: opts.transform ? { ...opts.transform } : { ...IDENTITY },
  fill: opts.fill ?? defaultFill(),
  stroke: opts.stroke ?? defaultStroke(),
  ...(opts.appearance ? { appearance: cloneDeep(opts.appearance) } : {}),
  opacity: opts.opacity ?? 1,
  blendMode: "normal",
  visible: true,
  locked: false,
});

/** Copy the non-geometric state when an operation replaces one item type with another. */
export const carryItemState = <T extends Item>(dst: T, src: Item): T =>
  Object.assign(dst, {
    name: src.name,
    fill: cloneDeep(src.fill),
    stroke: cloneDeep(src.stroke),
    opacity: src.opacity,
    blendMode: src.blendMode,
    visible: src.visible,
    locked: src.locked,
    ...(src.brush ? { brush: cloneDeep(src.brush) } : {}),
    ...(src.appearance ? { appearance: cloneDeep(src.appearance) } : {}),
    ...(src.evenOdd !== undefined ? { evenOdd: src.evenOdd } : {}),
    ...(src.effects ? { effects: cloneDeep(src.effects) } : {}),
    ...(src.overprintFill !== undefined ? { overprintFill: src.overprintFill } : {}),
    ...(src.overprintStroke !== undefined ? { overprintStroke: src.overprintStroke } : {}),
    ...(src.mask ? { mask: cloneDeep(src.mask) } : {}),
    ...(src.maskType ? { maskType: src.maskType } : {}),
  });

// ── Item constructors ────────────────────────────────────────
export const makePath = (geometry: PathGeometry, opts: BaseOpts = {}): PathItem => ({
  ...base("p", opts),
  type: "path",
  name: opts.name ?? "Path",
  geometry,
});

export const makeCompound = (subpaths: PathGeometry[], opts: BaseOpts = {}): CompoundPathItem => ({
  ...base("c", opts),
  type: "compound",
  name: opts.name ?? "Compound Path",
  subpaths,
});

export const makeGroup = (children: Item[], opts: BaseOpts = {}): GroupItem => ({
  ...base("g", opts),
  type: "group",
  name: opts.name ?? "Group",
  children,
  clip: false,
});

export const makeRect = (
  x: number,
  y: number,
  width: number,
  height: number,
  rx = 0,
  ry = 0,
  opts: BaseOpts = {},
): RectItem => ({
  ...base("r", { ...opts, transform: opts.transform ?? translation(x, y) }),
  type: "rect",
  name: opts.name ?? "Rectangle",
  width,
  height,
  rx,
  ry,
});

export const makeEllipse = (
  x: number,
  y: number,
  width: number,
  height: number,
  opts: BaseOpts = {},
): EllipseItem => ({
  ...base("e", { ...opts, transform: opts.transform ?? translation(x, y) }),
  type: "ellipse",
  name: opts.name ?? "Ellipse",
  width,
  height,
});

export const makePolygon = (
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  opts: BaseOpts = {},
): PolygonItem => ({
  ...base("y", { ...opts, transform: opts.transform ?? translation(cx, cy) }),
  type: "polygon",
  name: opts.name ?? "Polygon",
  radius,
  sides: Math.max(3, Math.round(sides)),
});

export const makeStar = (
  cx: number,
  cy: number,
  radius1: number,
  radius2: number,
  points: number,
  opts: BaseOpts = {},
): StarItem => ({
  ...base("s", { ...opts, transform: opts.transform ?? translation(cx, cy) }),
  type: "star",
  name: opts.name ?? "Star",
  radius1,
  radius2,
  points: Math.max(3, Math.round(points)),
});

export const makeLine = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: BaseOpts = {},
): LineItem => ({
  ...base("l", { ...opts, fill: opts.fill ?? noPaint() }),
  type: "line",
  name: opts.name ?? "Line",
  x1,
  y1,
  x2,
  y2,
});

export const makeText = (
  text: string,
  x: number,
  y: number,
  opts: BaseOpts & Partial<Pick<TextItem, "fontSize" | "fontFamily" | "fontWeight" | "fontStyle" | "letterSpacing" | "lineHeight" | "align" | "fontResolution" | "language" | "direction" | "writingMode" | "glyphOrientation" | "features" | "shapingRuns" | "layout">> = {},
): TextItem => ({
  ...base("t", { ...opts, transform: opts.transform ?? translation(x, y), fill: opts.fill ?? solid(BLACK), stroke: opts.stroke ?? defaultStroke(noPaint()) }),
  type: "text",
  name: opts.name ?? (text ? text.slice(0, 24) : "Type"),
  text,
  fontFamily: opts.fontFamily ?? "Helvetica, Arial, sans-serif",
  fontSize: opts.fontSize ?? 48,
  fontWeight: opts.fontWeight ?? 400,
  fontStyle: opts.fontStyle ?? "normal",
  letterSpacing: opts.letterSpacing ?? 0,
  lineHeight: opts.lineHeight ?? 1.2,
  align: opts.align ?? "left",
  ...(opts.fontResolution ? { fontResolution: cloneDeep(opts.fontResolution) } : {}),
  ...(opts.language ? { language: opts.language } : {}),
  ...(opts.direction ? { direction: opts.direction } : {}),
  ...(opts.writingMode ? { writingMode: opts.writingMode } : {}),
  ...(opts.glyphOrientation ? { glyphOrientation: opts.glyphOrientation } : {}),
  ...(opts.features ? { features: cloneDeep(opts.features) } : {}),
  ...(opts.shapingRuns ? { shapingRuns: cloneDeep(opts.shapingRuns) } : {}),
  ...(opts.layout ? { layout: cloneDeep(opts.layout) } : {}),
});

const isDataImageHref = (href: string): boolean => /^data:image\//i.test(href);

export const assetNameFromSource = (source: string): string => {
  if (isDataImageHref(source)) return "Embedded image";
  const withoutQuery = source.split(/[?#]/, 1)[0] || source;
  const tail = withoutQuery.split(/[\\/]/).filter(Boolean).pop();
  try {
    return tail ? decodeURIComponent(tail) : "Linked image";
  } catch {
    return tail || "Linked image";
  }
};

export const assetModeFromHref = (href: string): PlacedAssetMode =>
  isDataImageHref(href) ? "embedded" : "linked";

export const makePlacedAsset = (
  href: string,
  opts: Partial<Omit<PlacedAsset, "id" | "mode" | "status">> & Partial<Pick<PlacedAsset, "id" | "mode" | "status">> = {},
): PlacedAsset => {
  const mode = opts.mode ?? assetModeFromHref(href);
  const now = new Date().toISOString();
  return {
    id: opts.id ?? newId("asset"),
    mode,
    status: opts.status ?? "ok",
    name: opts.name ?? assetNameFromSource(opts.source ?? href),
    ...(mode === "linked" || opts.source ? { source: opts.source ?? href } : {}),
    ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
    ...(opts.sizeBytes !== undefined ? { sizeBytes: opts.sizeBytes } : {}),
    ...(opts.lastModified !== undefined ? { lastModified: opts.lastModified } : {}),
    ...(opts.linkedAt ? { linkedAt: opts.linkedAt } : mode === "linked" ? { linkedAt: now } : {}),
    ...(opts.embeddedAt ? { embeddedAt: opts.embeddedAt } : mode === "embedded" ? { embeddedAt: now } : {}),
    ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
  };
};

export const makeImage = (
  href: string,
  x: number,
  y: number,
  width: number,
  height: number,
  naturalWidth = width,
  naturalHeight = height,
  opts: BaseOpts & { asset?: PlacedAsset } = {},
): ImageItem => ({
  ...base("m", { ...opts, transform: opts.transform ?? translation(x, y), fill: opts.fill ?? noPaint(), stroke: opts.stroke ?? defaultStroke(noPaint()) }),
  type: "image",
  name: opts.name ?? "Image",
  href,
  asset: cloneDeep(opts.asset ?? makePlacedAsset(href)),
  width,
  height,
  naturalWidth,
  naturalHeight,
});

// ── Polyline / simple path helpers ───────────────────────────
export const pathFromPoints = (points: { x: number; y: number }[], closed = false, opts: BaseOpts = {}): PathItem =>
  makePath({ anchors: points.map((p) => anchor(p)), closed }, opts);

export const makeAnchor = anchor;

// ── Layers / Artboards / Document ────────────────────────────
const LAYER_COLORS = ["#4a9eff", "#e0573a", "#3ac06a", "#c97f4a", "#a978e0", "#e0c14a", "#4ad0c0", "#e04a8a"];
let _layerColorIndex = 0;

export const makeLayer = (name: string, items: Item[] = []): Layer => ({
  id: newId("L"),
  name,
  color: LAYER_COLORS[_layerColorIndex++ % LAYER_COLORS.length],
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  template: false,
  items,
});

export const makeArtboard = (name: string, x: number, y: number, width: number, height: number): Artboard => ({
  id: newId("A"),
  name,
  x,
  y,
  width,
  height,
});

export const defaultSwatches = (): Paint[] => {
  const hues = [0, 30, 50, 120, 200, 240, 280, 320];
  const out: Paint[] = [
    solid(WHITE),
    solid(rgba(204, 204, 204)),
    solid(rgba(128, 128, 128)),
    solid(BLACK),
  ];
  for (const h of hues) {
    for (const [s, v] of [[0.85, 0.95], [0.7, 0.7]] as const) {
      const c = hsvSwatch(h, s, v);
      out.push(solid(c));
    }
  }
  return out;
};

const hsvSwatch = (h: number, s: number, v: number): RGBA => {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgba(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
};

export const makeDocument = (
  name = "Untitled-1",
  width = 1000,
  height = 1000,
): Document => ({
  id: newId("D"),
  name,
  meta: { colorMode: "RGB", units: "px", dpi: 72 },
  artboards: [makeArtboard("Artboard 1", 0, 0, width, height)],
  activeArtboard: 0,
  layers: [makeLayer("Layer 1")],
  swatches: defaultSwatches(),
  brushes: defaultBrushes(),
  graphicStyles: [],
  characterStyles: [],
  paragraphStyles: [],
  actions: [],
  shortcuts: defaultShortcutSettings(),
  variables: defaultVariableSettings(),
  exportForScreens: defaultExportForScreensSettings(),
});
