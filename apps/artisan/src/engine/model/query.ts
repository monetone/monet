// ─────────────────────────────────────────────────────────────
// model/query — traversal, world transforms, bounds, hit testing
// ─────────────────────────────────────────────────────────────
// Read-only document interrogation. Item geometry is stored in local space; a
// world transform is the composition of the ancestor groups' transforms with
// the item's own. Layers do not transform (they are pure containers).

import {
  IDENTITY,
  applyToPoint,
  compose,
  invert,
  type Matrix,
  meanScale,
  mul,
} from "../geometry/matrix";
import {
  type Rect,
  intersects,
  transform as transformRect,
  union,
  containsRect,
} from "../geometry/bbox";
import { containsPoint as pathContains, hitsOutline } from "../geometry/path";
import type { Point } from "../geometry/vec";
import { appearancePaints, hasExplicitAppearance, paintedFill, paintedStroke } from "./appearance";
import { assetModeFromHref, assetNameFromSource } from "./factory";
import { dimensionLabel } from "./dimensions";
import { paintSeparationContributions, resolvedPrepressSettings, type PaintSeparationContribution } from "./prepress";
import { localBounds, localPaths } from "./shapes";
import type {
  BrushDefinition,
  DimensionObject,
  Document,
  GradientMeshObject,
  GraphKind,
  GraphObject,
  GroupItem,
  ID,
  ImageItem,
  Item,
  Layer,
  LivePaintObject,
  Paint,
  PerspectiveObject,
  PlacedAsset,
  PrintSettings,
  SymbolDefinition,
} from "./types";

export interface ItemLocation {
  item: Item;
  layer: Layer;
  layerIndex: number;
  /** Group ancestors from outermost (layer-level) to innermost. */
  ancestors: GroupItem[];
  /** The array holding the item (layer.items or a group's children). */
  container: Item[];
  index: number;
}

/** Depth-first walk over every item; return false from cb to stop. */
export const eachItem = (
  doc: Document,
  cb: (item: Item, loc: ItemLocation) => void | boolean,
): void => {
  for (let li = 0; li < doc.layers.length; li++) {
    const layer = doc.layers[li];
    const walk = (container: Item[], ancestors: GroupItem[]): boolean => {
      for (let i = 0; i < container.length; i++) {
        const item = container[i];
        const loc: ItemLocation = { item, layer, layerIndex: li, ancestors, container, index: i };
        if (cb(item, loc) === false) return false;
        if (item.type === "group") {
          if (!walk(item.children, [...ancestors, item])) return false;
        }
      }
      return true;
    };
    if (!walk(layer.items, [])) return;
  }
};

export const findItem = (doc: Document, id: ID): ItemLocation | null => {
  let found: ItemLocation | null = null;
  eachItem(doc, (item, loc) => {
    if (item.id === id) {
      found = loc;
      return false;
    }
  });
  return found;
};

export const getItem = (doc: Document, id: ID): Item | null => findItem(doc, id)?.item ?? null;

/** Leaf items represented by a selection. Live derived groups are boundaries:
 *  their generated children are a cache, not authorable artwork. */
export const selectionLeaves = (doc: Document, ids: Iterable<ID>): Item[] => {
  const selected = new Set(ids);
  const leaves: Item[] = [];
  const walk = (items: Item[], inherited: boolean): void => {
    for (const item of items) {
      const chosen = inherited || selected.has(item.id);
      if (item.type === "group") {
        if (chosen && (item.envelope || item.mesh)) continue;
        walk(item.children, chosen);
      } else if (chosen) leaves.push(item);
    }
  };
  for (const layer of doc.layers) walk(layer.items, false);
  return leaves;
};

export interface PlacedAssetEntry {
  itemId: ID;
  itemName: string;
  layerId: ID;
  layerName: string;
  href: string;
  asset: PlacedAsset;
}

export const imageAsset = (item: ImageItem): PlacedAsset => {
  if (item.asset) return item.asset;
  const mode = assetModeFromHref(item.href);
  return {
    id: item.id,
    mode,
    status: "ok",
    name: item.name || assetNameFromSource(item.href),
    ...(mode === "linked" ? { source: item.href } : {}),
  };
};

export const placedAssetEntries = (doc: Document): PlacedAssetEntry[] => {
  const entries: PlacedAssetEntry[] = [];
  eachItem(doc, (item, loc) => {
    if (item.type !== "image") return;
    entries.push({
      itemId: item.id,
      itemName: item.name || "Image",
      layerId: loc.layer.id,
      layerName: loc.layer.name,
      href: item.href,
      asset: imageAsset(item),
    });
  });
  return entries;
};

export interface PackageReport {
  linkedAssets: number;
  embeddedAssets: number;
  missingAssets: number;
  modifiedAssets: number;
  fonts: string[];
  missingFonts: string[];
  processInks: number;
  spotInks: number;
  printSettings: PrintSettings;
  warnings: string[];
}

export const packageReport = (doc: Document): PackageReport => {
  const assets = placedAssetEntries(doc);
  const fonts = new Set<string>();
  const missingFonts = new Set<string>();
  eachItem(doc, (item) => {
    if (item.type !== "text") return;
    if (item.fontFamily) fonts.add(item.fontFamily);
    if (item.fontResolution?.status === "missing" && item.fontResolution.requestedFamily) {
      missingFonts.add(item.fontResolution.requestedFamily);
    }
  });
  const prepress = resolvedPrepressSettings(doc.prepress);
  const processInks = prepress.inks?.filter((ink) => ink.kind === "process").length ?? 0;
  const spotInks = prepress.inks?.filter((ink) => ink.kind === "spot").length ?? 0;
  const missingAssets = assets.filter((entry) => entry.asset.status === "missing").length;
  const modifiedAssets = assets.filter((entry) => entry.asset.status === "modified").length;
  const warnings: string[] = [];
  if (missingAssets) warnings.push(`${missingAssets} missing linked asset${missingAssets === 1 ? "" : "s"}`);
  if (modifiedAssets) warnings.push(`${modifiedAssets} modified linked asset${modifiedAssets === 1 ? "" : "s"}`);
  if (missingFonts.size) warnings.push(`${missingFonts.size} missing font${missingFonts.size === 1 ? "" : "s"}`);
  return {
    linkedAssets: assets.filter((entry) => entry.asset.mode === "linked").length,
    embeddedAssets: assets.filter((entry) => entry.asset.mode === "embedded").length,
    missingAssets,
    modifiedAssets,
    fonts: [...fonts].sort(),
    missingFonts: [...missingFonts].sort(),
    processInks,
    spotInks,
    printSettings: prepress.print!,
    warnings,
  };
};

export interface BrushDefinitionEntry {
  brush: BrushDefinition;
  usageCount: number;
}

export const brushDefinitionEntries = (doc: Document): BrushDefinitionEntry[] => {
  const counts = new Map<ID, number>();
  eachItem(doc, (item) => {
    const brushId = item.brush?.brushId;
    if (!brushId) return;
    counts.set(brushId, (counts.get(brushId) ?? 0) + 1);
  });
  return (doc.brushes ?? []).map((brush) => ({
    brush,
    usageCount: counts.get(brush.id) ?? 0,
  }));
};

export interface SymbolInstanceEntry {
  itemId: ID;
  itemName: string;
  layerId: ID;
  layerName: string;
  symbolId: ID;
  symbolName: string;
  detached: boolean;
  missingDefinition: boolean;
}

export interface SymbolDefinitionEntry {
  symbol: SymbolDefinition;
  instanceCount: number;
}

export const symbolInstanceEntries = (doc: Document): SymbolInstanceEntry[] => {
  const entries: SymbolInstanceEntry[] = [];
  eachItem(doc, (item, loc) => {
    if (item.type !== "group" || !item.symbolInstance) return;
    const definition = doc.symbols?.find((symbol) => symbol.id === item.symbolInstance!.symbolId) ?? null;
    entries.push({
      itemId: item.id,
      itemName: item.name || "Symbol Instance",
      layerId: loc.layer.id,
      layerName: loc.layer.name,
      symbolId: item.symbolInstance.symbolId,
      symbolName: definition?.name ?? item.symbolInstance.symbolId,
      detached: item.symbolInstance.detached ?? false,
      missingDefinition: !definition,
    });
  });
  return entries;
};

export const symbolDefinitionEntries = (doc: Document): SymbolDefinitionEntry[] => {
  const counts = new Map<ID, number>();
  for (const entry of symbolInstanceEntries(doc)) {
    counts.set(entry.symbolId, (counts.get(entry.symbolId) ?? 0) + 1);
  }
  return (doc.symbols ?? []).map((symbol) => ({
    symbol,
    instanceCount: counts.get(symbol.id) ?? 0,
  }));
};

export interface GraphEntry {
  itemId: ID;
  itemName: string;
  layerId: ID;
  layerName: string;
  kind: GraphKind;
  graph: GraphObject;
  datumCount: number;
}

export const graphEntries = (doc: Document): GraphEntry[] => {
  const entries: GraphEntry[] = [];
  eachItem(doc, (item, loc) => {
    if (item.type !== "group" || !item.graph) return;
    entries.push({
      itemId: item.id,
      itemName: item.name || "Graph",
      layerId: loc.layer.id,
      layerName: loc.layer.name,
      kind: item.graph.kind,
      graph: item.graph,
      datumCount: item.graph.data.length,
    });
  });
  return entries;
};

export interface DimensionEntry {
  itemId: ID;
  itemName: string;
  layerId: ID;
  layerName: string;
  dimension: DimensionObject;
  length: number;
  label: string;
}

export const dimensionEntries = (doc: Document): DimensionEntry[] => {
  const entries: DimensionEntry[] = [];
  eachItem(doc, (item, loc) => {
    if (item.type !== "group" || !item.dimension) return;
    entries.push({
      itemId: item.id,
      itemName: item.name || "Dimension",
      layerId: loc.layer.id,
      layerName: loc.layer.name,
      dimension: item.dimension,
      length: item.dimension.length,
      label: dimensionLabel(item.dimension),
    });
  });
  return entries;
};

export interface MeshEntry {
  itemId: ID;
  itemName: string;
  layerId: ID;
  layerName: string;
  rows: number;
  columns: number;
  pointCount: number;
  mesh: GradientMeshObject;
}

export const meshEntries = (doc: Document): MeshEntry[] => {
  const entries: MeshEntry[] = [];
  eachItem(doc, (item, loc) => {
    if (item.type !== "group" || !item.mesh) return;
    entries.push({
      itemId: item.id,
      itemName: item.name || "Gradient Mesh",
      layerId: loc.layer.id,
      layerName: loc.layer.name,
      rows: item.mesh.rows,
      columns: item.mesh.columns,
      pointCount: item.mesh.points.length,
      mesh: item.mesh,
    });
  });
  return entries;
};

export interface LivePaintEntry {
  itemId: ID;
  itemName: string;
  layerId: ID;
  layerName: string;
  faceCount: number;
  edgeCount: number;
  gapDetection: LivePaintObject["gapDetection"];
  livePaint: LivePaintObject;
}

export const livePaintEntries = (doc: Document): LivePaintEntry[] => {
  const entries: LivePaintEntry[] = [];
  eachItem(doc, (item, loc) => {
    if (item.type !== "group" || !item.livePaint) return;
    entries.push({
      itemId: item.id,
      itemName: item.name || "Live Paint Group",
      layerId: loc.layer.id,
      layerName: loc.layer.name,
      faceCount: item.livePaint.faces.length,
      edgeCount: item.livePaint.edges.length,
      gapDetection: item.livePaint.gapDetection,
      livePaint: item.livePaint,
    });
  });
  return entries;
};

export interface PerspectiveEntry {
  itemId: ID;
  itemName: string;
  layerId: ID;
  layerName: string;
  plane: PerspectiveObject["plane"];
  sourceCount: number;
  perspective: PerspectiveObject;
}

export const perspectiveEntries = (doc: Document): PerspectiveEntry[] => {
  const entries: PerspectiveEntry[] = [];
  eachItem(doc, (item, loc) => {
    if (item.type !== "group" || !item.perspective) return;
    entries.push({
      itemId: item.id,
      itemName: item.name || "Perspective Group",
      layerId: loc.layer.id,
      layerName: loc.layer.name,
      plane: item.perspective.plane,
      sourceCount: item.perspective.sourceItems.length,
      perspective: item.perspective,
    });
  });
  return entries;
};

/** Compose the transforms of group ancestors (outer→inner), excluding the item. */
export const parentTransform = (ancestors: GroupItem[]): Matrix =>
  ancestors.reduce((m, g) => mul(m, g.transform), IDENTITY);

export const worldTransform = (doc: Document, id: ID): Matrix => {
  const loc = findItem(doc, id);
  if (!loc) return IDENTITY;
  return mul(parentTransform(loc.ancestors), loc.item.transform);
};

export const worldTransformAt = (loc: ItemLocation): Matrix => mul(parentTransform(loc.ancestors), loc.item.transform);

/** Geometric world bounds (AABB of the transformed local bounds). */
export const worldBounds = (doc: Document, id: ID): Rect | null => {
  const loc = findItem(doc, id);
  if (!loc) return null;
  return transformRect(localBounds(loc.item), worldTransformAt(loc));
};

export const selectionBounds = (doc: Document, ids: Iterable<ID>): Rect | null => {
  let r: Rect | null = null;
  for (const id of ids) {
    const b = worldBounds(doc, id);
    if (b) r = union(r, b);
  }
  return r;
};

const itemFillVisible = (item: Item): boolean =>
  paintedFill(item).type !== "none" || item.type === "text" || item.type === "image";

/** Does `worldPoint` hit a single leaf item (fill or stroke)? */
const leafHit = (item: Item, worldPoint: Point, world: Matrix, worldTol: number): boolean => {
  const inv = invert(world);
  const local = applyToPoint(inv, worldPoint);
  const scale = meanScale(world) || 1;
  const localTol = worldTol / scale;

  if (item.type === "text" || item.type === "image") {
    const b = localBounds(item);
    return (
      local.x >= b.x - localTol &&
      local.x <= b.x + b.width + localTol &&
      local.y >= b.y - localTol &&
      local.y <= b.y + b.height + localTol
    );
  }

  const paths = localPaths(item);
  if (paths.length === 0) return false;
  const stroke = paintedStroke(item);
  const strokeTol = stroke.paint.type !== "none" ? stroke.width / 2 : 0;

  // Stroke / outline hit.
  for (const p of paths) {
    if (hitsOutline(p, local, localTol + strokeTol)) return true;
  }
  // Fill hit (only if the object has a fill).
  if (itemFillVisible(item)) {
    if (item.type === "compound") {
      let toggles = 0;
      for (const p of paths) if (pathContains(p, local, true)) toggles++;
      if (toggles % 2 === 1) return true;
    } else {
      for (const p of paths) if (pathContains(p, local, !!item.evenOdd)) return true;
    }
  }
  return false;
};

export interface HitResult {
  /** Deepest leaf item under the point. */
  leaf: ItemLocation;
  /** Outermost selectable target (outer group, or the leaf if ungrouped). */
  target: ItemLocation;
}

/**
 * Topmost hit at a world point. Walks layers + items front-to-back. `tol` is a
 * pick tolerance in world units. Hidden/locked layers and items are skipped.
 */
export const hitTest = (
  doc: Document,
  worldPoint: Point,
  tol = 4,
  opts: { includeLocked?: boolean } = {},
): HitResult | null => {
  let result: HitResult | null = null;

  const walkLayer = (layer: Layer, layerIndex: number) => {
    if (!layer.visible) return;
    if (layer.locked && !opts.includeLocked) return;
    const walk = (container: Item[], ancestors: GroupItem[], parentWorld: Matrix): boolean => {
      for (let i = container.length - 1; i >= 0; i--) {
        const item = container[i];
        if (!item.visible) continue;
        if (item.locked && !opts.includeLocked) continue;
        const world = mul(parentWorld, item.transform);
        if (item.type === "group") {
          // Recurse first so deeper (front-most) items win.
          if (!walk(item.children, [...ancestors, item], world)) return false;
        } else if (leafHit(item, worldPoint, world, tol)) {
          const leaf: ItemLocation = { item, layer, layerIndex, ancestors, container, index: i };
          const target = ancestors.length > 0
            ? { item: ancestors[0], layer, layerIndex, ancestors: [], container: layer.items, index: layer.items.indexOf(ancestors[0]) }
            : leaf;
          result = { leaf, target };
          return false;
        }
      }
      return true;
    };
    walk(layer.items, [], IDENTITY);
  };

  for (let li = doc.layers.length - 1; li >= 0 && !result; li--) {
    walkLayer(doc.layers[li], li);
  }
  return result;
};

/** Items whose world bounds intersect (crossing) or are contained (window) by a rect. */
export const itemsInRect = (
  doc: Document,
  rect: Rect,
  mode: "crossing" | "window" = "crossing",
  opts: { includeLocked?: boolean } = {},
): ID[] => {
  const out: ID[] = [];
  for (let li = 0; li < doc.layers.length; li++) {
    const layer = doc.layers[li];
    if (!layer.visible || (layer.locked && !opts.includeLocked)) continue;
    for (let i = 0; i < layer.items.length; i++) {
      const item = layer.items[i];
      if (!item.visible || (item.locked && !opts.includeLocked)) continue;
      const world = item.transform;
      const wb = transformRect(localBounds(item), world);
      const hit = mode === "window" ? containsRect(rect, wb) : intersects(rect, wb);
      if (hit) out.push(item.id);
    }
  }
  return out;
};

// ── Lasso selection (polygon marquee) ────────────────────────
const pointInPoly = (poly: Point[], p: Point): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const orient = (p: Point, q: Point, r: Point): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
/** Do segments a→b and c→d properly cross? */
const segmentsCross = (a: Point, b: Point, c: Point, d: Point): boolean =>
  orient(a, b, c) > 0 !== orient(a, b, d) > 0 && orient(c, d, a) > 0 !== orient(c, d, b) > 0;

/** Does a (closed) polygon intersect an axis-aligned rect? (vertex-in / edge-cross) */
const polygonIntersectsRect = (poly: Point[], r: Rect): boolean => {
  if (poly.length < 3) return false;
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
  for (const p of poly) if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) return true;
  for (const c of corners) if (pointInPoly(poly, c)) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (let j = 0; j < 4; j++) if (segmentsCross(a, b, corners[j], corners[(j + 1) % 4])) return true;
  }
  return false;
};

/**
 * Ids of objects whose world bounds intersect a world-space lasso polygon —
 * touch-select, matching the rectangular marquee (`itemsInRect` "crossing").
 */
export const itemsInPolygon = (doc: Document, poly: Point[], opts: { includeLocked?: boolean } = {}): ID[] => {
  const out: ID[] = [];
  for (const layer of doc.layers) {
    if (!layer.visible || (layer.locked && !opts.includeLocked)) continue;
    for (const item of layer.items) {
      if (!item.visible || (item.locked && !opts.includeLocked)) continue;
      const wb = transformRect(localBounds(item), item.transform);
      if (polygonIntersectsRect(poly, wb)) out.push(item.id);
    }
  }
  return out;
};

/** Flat list of all item ids, optionally only leaves. */
export const allItemIds = (doc: Document, leavesOnly = false): ID[] => {
  const out: ID[] = [];
  eachItem(doc, (item) => {
    if (!leavesOnly || item.type !== "group") out.push(item.id);
  });
  return out;
};

// ── Select ▸ Same ────────────────────────────────────────────
/** Attributes the "Select ▸ Same" command can match against. */
export type SameCriterion =
  | "fill"
  | "stroke"
  | "stroke-weight"
  | "opacity"
  | "blend-mode"
  | "fill-stroke"
  | "font-family"
  | "font-size"
  | "font-family-style"
  | "text-fill";

/** A stable comparison key for a paint (solid colours compared by value). */
export const paintKey = (p: Paint): string => {
  if (p.type === "none") return "none";
  if (p.type === "solid") {
    const ink = p.ink
      ? `|ink:${p.ink.kind}:${p.ink.id ?? ""}:${p.ink.name}:${p.ink.tint ?? 100}:${JSON.stringify(p.ink.components ?? {})}`
      : "";
    return `solid:${Math.round(p.color.r)},${Math.round(p.color.g)},${Math.round(p.color.b)},${p.color.a}${ink}`;
  }
  return `${p.type}:${JSON.stringify(p)}`; // gradient / pattern compared structurally
};

const sameKey = (item: Item, c: SameCriterion): string => {
  switch (c) {
    case "fill":
      return paintKey(paintedFill(item));
    case "stroke":
      return paintKey(paintedStroke(item).paint);
    case "stroke-weight": {
      const stroke = paintedStroke(item);
      return `w:${stroke.paint.type === "none" ? "none" : stroke.width}`;
    }
    case "opacity":
      return `o:${item.opacity}`;
    case "blend-mode":
      return `bm:${item.blendMode}`;
    case "fill-stroke": {
      // Illustrator's "Fill & Stroke": same fill paint, stroke paint AND weight.
      const stroke = paintedStroke(item);
      return `fs:${paintKey(paintedFill(item))}|${paintKey(stroke.paint)}|${stroke.paint.type === "none" ? "none" : stroke.width}`;
    }
    case "font-family":
      // Only text matches by font; non-text gets a per-item key so it never coincides.
      return item.type === "text" ? `ff:${item.fontFamily}` : `ff:∅:${item.id}`;
    case "font-size":
      return item.type === "text" ? `fz:${item.fontSize}` : `fz:∅:${item.id}`;
    case "font-family-style":
      // Illustrator's "Font Family & Style": same family AND weight + slant.
      return item.type === "text" ? `ffs:${item.fontFamily}|${item.fontWeight}|${item.fontStyle}` : `ffs:∅:${item.id}`;
    case "text-fill":
      // "Text Fill Color": text objects sharing a fill (non-text never matches).
      return item.type === "text" ? `tf:${paintKey(paintedFill(item))}` : `tf:∅:${item.id}`;
  }
};

// ── Magic Wand ───────────────────────────────────────────────
/** Illustrator's Magic Wand default fill-colour tolerance (RGB, 0–255). */
export const MAGIC_WAND_TOLERANCE = 32;

const colorClose = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, tol: number): boolean =>
  Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;

/** Paint match for the Magic Wand: solid colours within `tolerance` (per channel);
 *  non-solid paints match by type. Used for both fill and stroke comparison. */
const paintWithinTolerance = (paint: Paint, ref: Paint, tolerance: number): boolean => {
  if (paint.type !== ref.type) return false;
  if (paint.type === "solid" && ref.type === "solid") return colorClose(paint.color, ref.color, tolerance);
  return true; // gradient / pattern / none — same type matches
};

/**
 * Ids of every selectable LEAF object whose fill is within `tolerance` of the
 * reference fill — Illustrator's Magic Wand (fill colour). Skips groups and
 * hidden / locked objects.
 */
export const magicWandSelect = (doc: Document, refFill: Paint, tolerance = MAGIC_WAND_TOLERANCE): ID[] => {
  const out: ID[] = [];
  eachItem(doc, (item, loc) => {
    if (item.type === "group" || !isSelectableLocation(loc)) return;
    if (paintWithinTolerance(paintedFill(item), refFill, tolerance)) out.push(item.id);
  });
  return out;
};

/** Which attribute the Magic Wand matches on (Illustrator's Magic Wand panel). */
export type MagicWandMatch = "fill" | "stroke";

/**
 * Ids of every selectable LEAF object whose chosen attribute (`match`) is within
 * `tolerance` of the reference object's — Illustrator's Magic Wand with Fill
 * Colour / Stroke Colour matching. Skips groups, hidden, and locked objects.
 */
export const magicWandSelectBy = (
  doc: Document,
  ref: Item,
  match: MagicWandMatch,
  tolerance = MAGIC_WAND_TOLERANCE,
): ID[] => {
  const refPaint = match === "stroke" ? paintedStroke(ref).paint : paintedFill(ref);
  const out: ID[] = [];
  eachItem(doc, (item, loc) => {
    if (item.type === "group" || !isSelectableLocation(loc)) return;
    const paint = match === "stroke" ? paintedStroke(item).paint : paintedFill(item);
    if (paintWithinTolerance(paint, refPaint, tolerance)) out.push(item.id);
  });
  return out;
};

/**
 * Indices of document swatches not referenced by any artwork — Illustrator's
 * Swatches ▸ "Select All Unused". A swatch counts as used when its paint (by
 * value) matches any leaf object's fill or stroke, or any text run's fill.
 */
export const unusedSwatchIndices = (doc: Document): number[] => {
  const used = new Set<string>();
  eachItem(doc, (item) => {
    if (item.type === "group") return; // containers carry no artwork paint of their own
    if (hasExplicitAppearance(item)) for (const paint of appearancePaints(item)) used.add(paintKey(paint));
    else {
      used.add(paintKey(item.fill));
      used.add(paintKey(item.stroke.paint));
    }
    if (item.type === "text" && item.runs) for (const r of item.runs) if (r.fill) used.add(paintKey(r.fill));
  });
  const out: number[] = [];
  doc.swatches.forEach((sw, i) => {
    if (!used.has(paintKey(sw))) out.push(i);
  });
  return out;
};

/**
 * Solid colours the artwork uses that are NOT already document swatches —
 * Illustrator's Swatches ▸ "Add Used Colors". Walks every leaf object's fill,
 * stroke, and text-run fills; returns the new solid paints in first-seen order,
 * de-duplicated by value, excluding any already present in doc.swatches.
 * NOTE: returns LIVE paint references from the artwork — callers that store the
 * result must clone first (commands.addUsedColors does, via cloneDeep).
 */
export const usedColorsNotInSwatches = (doc: Document): Paint[] => {
  const have = new Set(doc.swatches.map(paintKey));
  const seen = new Set<string>();
  const out: Paint[] = [];
  const consider = (p: Paint) => {
    if (p.type !== "solid") return; // "Add Used Colors" collects flat colours only
    const k = paintKey(p);
    if (have.has(k) || seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  eachItem(doc, (item) => {
    if (item.type === "group") return;
    if (hasExplicitAppearance(item)) for (const paint of appearancePaints(item)) consider(paint);
    else {
      consider(item.fill);
      consider(item.stroke.paint);
    }
    if (item.type === "text" && item.runs) for (const r of item.runs) if (r.fill) consider(r.fill);
  });
  return out;
};

/**
 * Ids of every LEAF object (anywhere in the document) whose `criterion` attribute
 * matches the reference object's — Illustrator's "Select ▸ Same". The reference
 * itself is included (it matches itself). Returns [] if the reference is gone.
 */
export const selectSame = (doc: Document, refId: ID, criterion: SameCriterion): ID[] => {
  const ref = getItem(doc, refId);
  if (!ref) return [];
  const key = sameKey(ref, criterion);
  const out: ID[] = [];
  eachItem(doc, (item, loc) => {
    if (item.type === "group" || !isSelectableLocation(loc)) return; // match selectable leaf objects, not containers
    if (sameKey(item, criterion) === key) out.push(item.id);
  });
  return out;
};

/**
 * Illustrator's Select ▸ Next Object Above / Below — the nearest selectable
 * sibling in front of ("above") or behind ("below") `id` in the SAME container's
 * paint order (higher index = nearer the front, as in Object ▸ Arrange). Hidden
 * and locked siblings are skipped (they cannot be selected, matching Illustrator
 * and every other selection path). Returns null at the top/bottom of the
 * container — navigation does not wrap or cross into a parent group.
 */
export const nextObject = (doc: Document, id: ID, dir: "above" | "below"): ID | null => {
  const loc = findItem(doc, id);
  if (!loc) return null;
  const step = dir === "above" ? 1 : -1;
  for (let j = loc.index + step; j >= 0 && j < loc.container.length; j += step) {
    if (isSelectable(doc, loc.container[j].id)) return loc.container[j].id;
  }
  return null;
};

export const isAncestorSelected = (doc: Document, id: ID, selected: Set<ID>): boolean => {
  const loc = findItem(doc, id);
  if (!loc) return false;
  return loc.ancestors.some((a) => selected.has(a.id));
};

/** Whether an item can currently be selected/edited: it, every ancestor group, and
 *  its layer must all be visible and unlocked. Hiding/locking cascades down, à la
 *  Illustrator (you cannot keep a hidden or locked object selected). */
export const isSelectableLocation = (loc: ItemLocation): boolean => {
  if (!loc.item.visible || loc.item.locked) return false;
  if (!loc.layer.visible || loc.layer.locked) return false;
  return loc.ancestors.every((group) => group.visible && !group.locked);
};

export const isSelectable = (doc: Document, id: ID): boolean => {
  const loc = findItem(doc, id);
  return !!loc && isSelectableLocation(loc);
};

/** Drop any ids that are no longer selectable (hidden/locked/their layer is). */
export const selectableIds = (doc: Document, ids: Iterable<ID>): ID[] => {
  const out: ID[] = [];
  for (const id of ids) if (isSelectable(doc, id)) out.push(id);
  return out;
};

// ── Separations / prepress preview ───────────────────────────
export type SeparationAttribute = "fill" | "stroke" | "appearance-fill" | "appearance-stroke" | "text-run";

export interface SeparationPaintUse {
  itemId: ID;
  itemName: string;
  layerId: ID;
  layerName: string;
  attribute: SeparationAttribute;
  overprint: boolean;
  inkName: string;
  kind: "process" | "spot";
  coverage: number;
  tint?: number;
}

export interface SeparationPlate {
  id: string;
  name: string;
  kind: "process" | "spot";
  color: { r: number; g: number; b: number; a: number };
  enabled: boolean;
  uses: SeparationPaintUse[];
  overprintUses: number;
  maxCoverage: number;
}

export interface SeparationPreview {
  overprintPreview: boolean;
  plates: SeparationPlate[];
  processPlateCount: number;
  spotPlateCount: number;
  overprintObjectCount: number;
}

const roundCoverage = (value: number): number => +Math.max(0, Math.min(100, value)).toFixed(3);

/** Print-separation view over visible artwork. Existing RGB fills/strokes are
 *  treated as process CMYK; opt-in spot paints preserve their own plate. */
export const separationPreview = (doc: Document): SeparationPreview => {
  const prepress = resolvedPrepressSettings(doc.prepress);
  const plates = new Map<string, SeparationPlate>();
  const overprintItemIds = new Set<ID>();

  const ensurePlate = (contribution: PaintSeparationContribution): SeparationPlate => {
    const ink = prepress.inks?.find((candidate) => candidate.id === contribution.id);
    const existing = plates.get(contribution.id);
    if (existing) return existing;
    const plate: SeparationPlate = {
      id: contribution.id,
      name: ink?.name ?? contribution.name,
      kind: ink?.kind ?? contribution.kind,
      color: { ...(ink?.color ?? contribution.color) },
      enabled: ink?.enabled !== false,
      uses: [],
      overprintUses: 0,
      maxCoverage: 0,
    };
    plates.set(plate.id, plate);
    return plate;
  };

  for (const ink of prepress.inks ?? []) {
    plates.set(ink.id, {
      id: ink.id,
      name: ink.name,
      kind: ink.kind,
      color: { ...ink.color },
      enabled: ink.enabled !== false,
      uses: [],
      overprintUses: 0,
      maxCoverage: 0,
    });
  }

  const addPaint = (
    loc: ItemLocation,
    paint: Paint,
    attribute: SeparationAttribute,
    overprint: boolean,
    opacity: number,
  ) => {
    const contributions = paintSeparationContributions(paint);
    for (const contribution of contributions) {
      const coverage = roundCoverage(contribution.coverage * opacity);
      if (coverage <= 0) continue;
      const plate = ensurePlate(contribution);
      const use: SeparationPaintUse = {
        itemId: loc.item.id,
        itemName: loc.item.name || loc.item.type,
        layerId: loc.layer.id,
        layerName: loc.layer.name,
        attribute,
        overprint,
        inkName: plate.name,
        kind: plate.kind,
        coverage,
        ...(contribution.tint !== undefined ? { tint: contribution.tint } : {}),
      };
      plate.uses.push(use);
      plate.maxCoverage = Math.max(plate.maxCoverage, coverage);
      if (overprint) {
        plate.overprintUses++;
        overprintItemIds.add(loc.item.id);
      }
    }
  };

  eachItem(doc, (item, loc) => {
    if (item.type === "group") return;
    if (!loc.layer.visible || loc.ancestors.some((ancestor) => !ancestor.visible) || !item.visible) return;
    const ancestryOpacity = loc.ancestors.reduce((n, ancestor) => n * ancestor.opacity, loc.layer.opacity);
    const objectOpacity = ancestryOpacity * item.opacity;

    if (hasExplicitAppearance(item)) {
      for (const entry of item.appearance!.entries) {
        if (entry.visible === false) continue;
        const opacity = objectOpacity * (entry.opacity ?? 1);
        if (entry.kind === "fill") {
          addPaint(loc, entry.paint, "appearance-fill", entry.overprint ?? item.overprintFill ?? false, opacity);
        } else {
          addPaint(loc, entry.stroke.paint, "appearance-stroke", entry.overprint ?? item.overprintStroke ?? false, opacity);
        }
      }
    } else {
      addPaint(loc, item.fill, "fill", item.overprintFill ?? false, objectOpacity);
      addPaint(loc, item.stroke.paint, "stroke", item.overprintStroke ?? false, objectOpacity);
    }

    if (item.type === "text" && item.runs) {
      for (const run of item.runs) {
        if (run.fill) addPaint(loc, run.fill, "text-run", item.overprintFill ?? false, objectOpacity);
      }
    }
  });

  const out = [...plates.values()];
  return {
    overprintPreview: prepress.overprintPreview,
    plates: out,
    processPlateCount: out.filter((plate) => plate.kind === "process").length,
    spotPlateCount: out.filter((plate) => plate.kind === "spot").length,
    overprintObjectCount: overprintItemIds.size,
  };
};

/** Select ▸ Inverse — every selectable top-level object NOT currently selected
 *  (visible & unlocked, in a visible & unlocked layer), à la Illustrator. */
export const selectInverse = (doc: Document, current: Iterable<ID>): ID[] => {
  const cur = new Set(current);
  const out: ID[] = [];
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const it of layer.items) {
      if (it.visible && !it.locked && !cur.has(it.id)) out.push(it.id);
    }
  }
  return out;
};

/**
 * Select ▸ Object ▸ All on Same Layers — every selectable top-level object on
 * the same layer(s) as `current`. The reference selection can sit at any nesting
 * depth (a nested item still resolves to its owning layer); the result is the
 * layers' direct children, skipping locked/hidden layers and items. Empty when
 * nothing is selected.
 */
export const itemsOnSameLayers = (doc: Document, current: Iterable<ID>): ID[] => {
  const layerIds = new Set<ID>();
  for (const id of current) {
    const loc = findItem(doc, id);
    if (loc) layerIds.add(loc.layer.id);
  }
  if (!layerIds.size) return [];
  const out: ID[] = [];
  for (const layer of doc.layers) {
    if (!layerIds.has(layer.id) || !layer.visible || layer.locked) continue;
    for (const it of layer.items) {
      if (it.visible && !it.locked) out.push(it.id);
    }
  }
  return out;
};

export { localBounds, localPaths };

/** A read-only summary of a document for the Document Info panel (Illustrator's
 *  Window ▸ Document Info). Everything is derived from the document + selection. */
export interface DocInfo {
  name: string;
  colorMode: string;
  units: string;
  dpi: number;
  artboards: number;
  activeArtboard: { name: string; width: number; height: number } | null;
  layers: number;
  swatches: number;
  graphicStyles: number;
  /** Total items, counting items nested inside groups. */
  objects: number;
  /** Per item.type counts (recursive), e.g. { path: 3, group: 1, text: 2 }. */
  byType: Record<string, number>;
  /** Number of currently selected ids. */
  selected: number;
  /** Distinct font families used by text items (recursive), sorted. */
  fonts: string[];
}

/** Compute the Document Info summary for `doc` under the current `selection`. */
export const documentInfo = (doc: Document, selection: Iterable<ID>): DocInfo => {
  const byType: Record<string, number> = {};
  const fonts = new Set<string>();
  let objects = 0;
  eachItem(doc, (item) => {
    objects++;
    byType[item.type] = (byType[item.type] ?? 0) + 1;
    if (item.type === "text" && item.fontFamily) fonts.add(item.fontFamily);
  });
  const ab = doc.artboards[doc.activeArtboard] ?? doc.artboards[0] ?? null;
  return {
    name: doc.name,
    colorMode: doc.meta.colorMode,
    units: doc.meta.units,
    dpi: doc.meta.dpi,
    artboards: doc.artboards.length,
    activeArtboard: ab ? { name: ab.name, width: ab.width, height: ab.height } : null,
    layers: doc.layers.length,
    swatches: doc.swatches.length,
    graphicStyles: doc.graphicStyles?.length ?? 0,
    objects,
    byType,
    selected: [...selection].length,
    fonts: [...fonts].sort(),
  };
};
