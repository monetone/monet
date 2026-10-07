// ─────────────────────────────────────────────────────────────
// commands — high-level editor actions bound to the store
// ─────────────────────────────────────────────────────────────
// Each command wraps store + ops in an undo transaction and keeps the selection
// coherent. Used by the menu bar, keyboard shortcuts, and panels.

import {
  type ArtisanStore,
  type ActionStepCommand,
  type BlendMode,
  type Document,
  type DrawingMode,
  type ID,
  type Item,
  type Paint,
  type Rect,
  type TransformOp,
  BLACK,
  Mat,
  Ops,
  Query,
  WHITE,
  cloneDeep,
  makeArtboard,
  rgbToHsv,
  complement,
  invert,
  defaultStroke,
  makeImage,
  newId,
  noPaint,
  pattern,
  paintedFill,
  solid,
} from "./engine";
import { svgToPngDataURL } from "./io/files";
import { importSVG } from "./io/import/svg";
import type { AlignAction } from "./engine/ops/align";
import type { AverageAxis } from "./engine/ops/path-edit";
import type { OffsetPathOptions } from "./engine/ops/offset-path";
import type { BlendOptions, BlendSpacing } from "./engine/ops/blend";
import type { ZigZagOptions } from "./engine/ops/zigzag";
import type { WarpOptions, WarpStyle } from "./engine/ops/warp";
import type { FindReplaceOptions } from "./engine/ops/find-replace";
import type { WidthProfilePreset } from "./engine/ops/width-profile";
import type { ArrowEnd, ArrowheadStyle } from "./engine/ops/arrowheads";
import type { ScribbleOptions } from "./engine/ops/scribble";
import type { TransformEachOptions } from "./engine/ops/transform-each";
import type { TrimMarksOptions } from "./engine/ops/trim-marks";
import type { SplitGridOptions } from "./engine/ops/split-grid";
import type { ConvertToShapeOptions, ShapeKind } from "./engine/ops/convert-shape";
import type { EditColorsMode } from "./engine/ops/edit-colors";
import type { ColorBlendMode } from "./engine/ops/blend-colors";
import type { CaseMode } from "./engine/ops/change-case";
import type { PathfinderOp } from "./engine/ops/pathfinder";
import type { SelectKind } from "./engine/ops/select-objects";
import type { TransformCopiesOptions } from "./engine/ops/transform-copies";
import type { RoughenOptions } from "./engine/ops/roughen";
import type { TweakOptions } from "./engine/ops/tweak";
import { clampZoom } from "./tools/view";

let clipboard: Item[] = [];
// Origin of the artboard the clipboard was copied from. Paste in Place / Paste on
// All Artboards reposition the copy relative to the destination artboard from it.
let clipboardOrigin: { x: number; y: number } | null = null;
const notifyClipboardChange = () => globalThis.dispatchEvent?.(new Event("artisan-clipboard-change"));

// ── OS pasteboard (cross-app Copy / Paste) ───────────────────────────
// `clipboard` above never leaves this window, so Copy here used to be invisible
// to Vision, Illustrator, Figma and everything else. Copy now also publishes
// the selection on the SYSTEM pasteboard using flavours every app understands:
// SVG markup as `text/plain` — what Illustrator, Figma, Inkscape and Vision all
// parse on paste — plus a rendered `image/png` (macOS `public.png`) for
// everything that only takes bitmaps. Deliberately NO Monet-private mime:
// WebKit's ClipboardItem drops types it does not recognise (including
// image/svg+xml), so a private flavour would be silently lost anyway.
const PASTEBOARD_TEXT = "text/plain";
const PASTEBOARD_PNG = "image/png";
/** The SVG this window last published, so Paste can tell our own Copy coming
 *  back (keep the richer in-app items) from artwork another app copied. */
let publishedSvg: string | null = null;

const bytesToDataURL = (bytes: Uint8Array, mime: string): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(bin)}`;
};

/** Publish the copied selection on the system pasteboard. Fire-and-forget: the
 *  in-app Copy already succeeded and must not depend on the platform saying yes. */
async function publishToPasteboard(s: ArtisanStore, ids: ID[]): Promise<void> {
  const board = globalThis.navigator?.clipboard;
  if (!ids.length || !board?.write || typeof ClipboardItem === "undefined") return;
  const doc = s.getState().doc;
  const bounds = Query.selectionBounds(doc, ids);
  if (!bounds) return;
  const svg = Ops.Rasterize.selectionToSvg(doc, ids, bounds);
  publishedSvg = svg;
  const parts: Record<string, Blob> = { [PASTEBOARD_TEXT]: new Blob([svg], { type: PASTEBOARD_TEXT }) };
  try {
    const url = await svgToPngDataURL(svg, bounds.width, bounds.height, 2);
    const bin = atob(url.slice(url.indexOf(",") + 1));
    const png = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) png[i] = bin.charCodeAt(i);
    parts[PASTEBOARD_PNG] = new Blob([png as BlobPart], { type: PASTEBOARD_PNG });
  } catch {
    // No canvas (headless) — the SVG text alone still crosses app boundaries.
  }
  try {
    await board.write([new ClipboardItem(parts)]);
  } catch {
    // Denied / no user gesture. The in-app clipboard is unaffected.
  }
}

/** Load a raster data URL far enough to learn its natural size. */
function imageSize(href: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => reject(new Error("pasteboard image failed to decode"));
    img.src = href;
  });
}

/** Adopt artwork another app put on the system pasteboard into `clipboard`.
 *  Returns true when it replaced the in-app clipboard.
 *
 *  Pulled on window focus rather than inside Paste so every Paste variant stays
 *  synchronous — menus, the shortcut registry and the ⌘V key handler all invoke
 *  them as plain actions. Focus is also exactly when the pasteboard can have
 *  changed: the user copied in Vision / Illustrator and came back.
 *  ponytail: a focus pull, not a pasteboard change-count subscription — copy
 *  elsewhere WITHOUT leaving Artisan focused (a scripted copy) is missed until
 *  the next focus. A Rust NSPasteboard changeCount poll is the upgrade. */
export async function adoptPasteboardArtwork(): Promise<boolean> {
  const board = globalThis.navigator?.clipboard;
  if (!board?.read) return false;
  let items: Awaited<ReturnType<Clipboard["read"]>>;
  try {
    items = await board.read();
  } catch {
    return false; // denied / unsupported — fall through to the in-app clipboard
  }
  for (const item of items) {
    const types = Array.from(item.types);
    // SVG text first: vector in, vector out. Only *our* SVG is skipped, and
    // then so is the PNG beside it — both are this window's own Copy.
    if (types.includes(PASTEBOARD_TEXT)) {
      const text = (await item.getType(PASTEBOARD_TEXT).then((b) => b.text()).catch(() => "")).trim();
      if (text.startsWith("<svg") || text.startsWith("<?xml")) {
        if (text === publishedSvg) return false;
        try {
          const imported = importSVG(text).layers.flatMap((l) => l.items);
          if (imported.length) {
            clipboard = imported.map((i) => Ops.Items.cloneItemDeep(i));
            clipboardOrigin = null; // foreign artwork has no artboard of ours
            publishedSvg = null;
            notifyClipboardChange();
            return true;
          }
        } catch {
          // Not artwork — keep looking (it may still carry a bitmap).
        }
      }
    }
    const raster = types.find((t) => t.startsWith("image/") && t !== "image/svg+xml");
    if (!raster) continue;
    try {
      const bytes = new Uint8Array(await (await item.getType(raster)).arrayBuffer());
      const href = bytesToDataURL(bytes, raster);
      const { width, height } = await imageSize(href);
      clipboard = [makeImage(href, 0, 0, width, height)];
      clipboardOrigin = null;
      publishedSvg = null;
      notifyClipboardChange();
      return true;
    } catch {
      // Unreadable flavour — try the next pasteboard item.
    }
  }
  return false;
}

// Pull the pasteboard whenever the window regains focus, so ⌘V right after
// switching back from another app pastes what that app copied.
globalThis.addEventListener?.("focus", () => void adoptPasteboardArtwork());

// The origin (top-left) of the artboard a selection sits on — the artboard whose
// bounds contain the selection's centre, else the active artboard. Null when the
// document has no artboards.
const sourceArtboardOrigin = (d: Document, bounds: Rect | null): { x: number; y: number } | null => {
  const boards = d.artboards;
  if (!boards.length) return null;
  if (bounds) {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const hit = boards.find((ab) => cx >= ab.x && cx <= ab.x + ab.width && cy >= ab.y && cy <= ab.y + ab.height);
    if (hit) return { x: hit.x, y: hit.y };
  }
  const active = boards[d.activeArtboard] ?? boards[0];
  return { x: active.x, y: active.y };
};

const sel = (s: ArtisanStore): ID[] => s.getState().selection;

// Default Free Distort quad: a perspective trapezoid (top edge pulled in 20% on
// each side, bottom edge full width) — a recognizable, symmetric distortion.
const FREE_DISTORT_PERSPECTIVE: Ops.FreeDistort.FreeDistortCorners = {
  topLeft: { x: 0.2, y: 0 },
  topRight: { x: 0.8, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};

const zoomKeepCenter = (s: ArtisanStore, nextZoom: number) => {
  const { view, viewport } = s.getState();
  const z = clampZoom(nextZoom);
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const wx = (cx - view.tx) / view.zoom;
  const wy = (cy - view.ty) / view.zoom;
  s.setView({ zoom: z, tx: cx - wx * z, ty: cy - wy * z });
};

const activeArtboardRect = (s: ArtisanStore): Rect => {
  const d = s.doc;
  const ab = d.artboards[d.activeArtboard] ?? d.artboards[0];
  return ab ? { x: ab.x, y: ab.y, width: ab.width, height: ab.height } : { x: 0, y: 0, width: 0, height: 0 };
};

// Layers to keep unlocked/visible for the "… Other Layers" commands: every layer
// that holds a selected object, or — when nothing is selected — the active layer.
const layersToKeep = (s: ArtisanStore): Set<ID> => {
  const keep = new Set<ID>();
  for (const id of s.getState().selection) {
    const loc = Query.findItem(s.doc, id);
    if (loc) keep.add(loc.layer.id);
  }
  if (!keep.size) keep.add(s.activeLayer().id);
  return keep;
};

export const commands = {
  undo: (s: ArtisanStore) => s.undo(),
  redo: (s: ArtisanStore) => s.redo(),

  delete(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Delete", (d) => Ops.Items.removeItems(d, ids));
    s.clearSelection();
  },

  copy(s: ArtisanStore) {
    const ids = sel(s);
    clipboard = ids
      .map((id) => Query.findItem(s.doc, id)?.item)
      .filter((i): i is Item => !!i)
      .map((i) => Ops.Items.cloneItemDeep(i));
    clipboardOrigin = sourceArtboardOrigin(s.doc, Query.selectionBounds(s.doc, ids));
    notifyClipboardChange();
    void publishToPasteboard(s, ids); // …and onto the system pasteboard
  },

  cut(s: ArtisanStore) {
    commands.copy(s);
    commands.delete(s);
  },

  paste(s: ArtisanStore) {
    if (!clipboard.length) return;
    const copies = clipboard.map((i) => Ops.Items.cloneItemDeep(i));
    // Illustrator pastes at the CENTRE of the current view (not a fixed offset).
    // The viewport centre maps to the same world point under any view rotation.
    const { view, viewport } = s.getState();
    const cx = (viewport.width / 2 - view.tx) / view.zoom;
    const cy = (viewport.height / 2 - view.ty) / view.zoom;
    s.transact("Paste", (d) => {
      const ids = Ops.Items.addItems(d, copies, s.getState().activeLayerId);
      const b = Query.selectionBounds(d, ids);
      if (b) {
        const dx = cx - (b.x + b.width / 2);
        const dy = cy - (b.y + b.height / 2);
        if (dx || dy) Ops.Transform.translateItems(d, ids, dx, dy);
      }
    });
    s.setSelection(copies.map((c) => c.id));
  },

  /** Paste at the EXACT original position, at the front of the active layer (⌘F). */
  pasteInFront(s: ArtisanStore) {
    if (!clipboard.length) return;
    const copies = clipboard.map((i) => Ops.Items.cloneItemDeep(i));
    s.transact("Paste in Front", (d) => Ops.Items.addItems(d, copies, s.getState().activeLayerId));
    s.setSelection(copies.map((c) => c.id));
  },

  /** Paste at the EXACT original position, at the back of the active layer (⌘B). */
  pasteInBack(s: ArtisanStore) {
    if (!clipboard.length) return;
    const copies = clipboard.map((i) => Ops.Items.cloneItemDeep(i));
    s.transact("Paste in Back", (d) => Ops.Items.addItemsBack(d, copies, s.getState().activeLayerId));
    s.setSelection(copies.map((c) => c.id));
  },

  /** Paste at the same position relative to the ACTIVE artboard as it had on its
   *  source artboard (Illustrator ⌥⌘V). Same as the original position when the
   *  active artboard is the one it was copied from. */
  pasteInPlace(s: ArtisanStore) {
    if (!clipboard.length) return;
    const copies = clipboard.map((i) => Ops.Items.cloneItemDeep(i));
    const active = s.doc.artboards[s.doc.activeArtboard] ?? s.doc.artboards[0];
    const dx = active && clipboardOrigin ? active.x - clipboardOrigin.x : 0;
    const dy = active && clipboardOrigin ? active.y - clipboardOrigin.y : 0;
    s.transact("Paste in Place", (d) => {
      const ids = Ops.Items.addItems(d, copies, s.getState().activeLayerId);
      if (dx || dy) Ops.Transform.translateItems(d, ids, dx, dy);
    });
    s.setSelection(copies.map((c) => c.id));
  },

  /** Paste a copy onto EVERY artboard at the same relative position (⌥⇧⌘V). With
   *  a single artboard this is just Paste in Place. */
  pasteOnAllArtboards(s: ArtisanStore) {
    if (!clipboard.length) return;
    const boards = s.doc.artboards;
    if (boards.length <= 1) {
      commands.pasteInPlace(s);
      return;
    }
    const origin = clipboardOrigin ?? { x: boards[0].x, y: boards[0].y };
    const newIds: ID[] = [];
    s.transact("Paste on All Artboards", (d) => {
      for (const ab of d.artboards) {
        const copies = clipboard.map((i) => Ops.Items.cloneItemDeep(i));
        const ids = Ops.Items.addItems(d, copies, s.getState().activeLayerId);
        const dx = ab.x - origin.x;
        const dy = ab.y - origin.y;
        if (dx || dy) Ops.Transform.translateItems(d, ids, dx, dy);
        newIds.push(...ids);
      }
    });
    s.setSelection(newIds);
  },

  duplicate(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    let newIds: ID[] = [];
    s.transact("Duplicate", (d) => {
      newIds = Ops.Items.duplicateItems(d, ids);
    });
    s.setSelection(newIds);
  },

  /** Layers panel — add a new empty layer above the active one and select it. */
  newLayer(s: ArtisanStore) {
    let id = "";
    s.transact("New Layer", (d) => {
      id = Ops.Layers.addLayer(d, s.getState().activeLayerId);
    });
    if (id) s.setActiveLayer(id);
  },

  /** Layers panel — duplicate a layer (its items too) above it and select it. */
  duplicateLayer(s: ArtisanStore, layerId?: ID) {
    const id = layerId ?? s.getState().activeLayerId;
    let nid: ID | null = null;
    s.transact("Duplicate Layer", (d) => {
      nid = Ops.Layers.duplicateLayer(d, id);
    });
    if (nid) s.setActiveLayer(nid);
  },

  /** Layers panel — delete a layer and its items (never the last one); move the
   *  active layer to a neighbour and drop any now-missing items from the selection. */
  deleteLayer(s: ArtisanStore, layerId?: ID) {
    const id = layerId ?? s.getState().activeLayerId;
    if (s.doc.layers.length <= 1) return; // a document always keeps ≥1 layer
    let next: ID | null = null;
    s.transact("Delete Layer", (d) => {
      next = Ops.Layers.removeLayer(d, id);
    });
    if (next) s.setActiveLayer(next);
    s.setSelection(s.getState().selection.filter((sid) => Query.findItem(s.doc, sid)));
  },

  /** Layers panel — Flatten Artwork: merge every layer into the active one,
   *  preserving stacking order. The selection survives (items keep their ids). */
  flattenArtwork(s: ArtisanStore) {
    if (s.doc.layers.length <= 1) return;
    let sid: ID | null = null;
    s.transact("Flatten Artwork", (d) => {
      sid = Ops.Layers.flattenArtwork(d, s.getState().activeLayerId);
    });
    if (sid) s.setActiveLayer(sid);
  },

  /** Layers panel ▸ Release to Layers (Sequence) — distribute the active layer's
   *  top-level items onto their own new layers. No-op (no undo entry) when the
   *  active layer has fewer than two items. Selects the topmost new layer. */
  releaseToLayers(s: ArtisanStore) {
    const layerId = s.getState().activeLayerId;
    let created: ID[] = [];
    s.transact("Release to Layers", (d) => {
      created = Ops.Layers.releaseToLayers(d, layerId);
    });
    if (created.length) s.setActiveLayer(created[created.length - 1]);
  },

  /** Layers panel ▸ Template — toggle the active layer as a non-printing, dimmed
   *  tracing-reference layer (Illustrator's Template option). Undoable. */
  toggleLayerTemplate(s: ArtisanStore) {
    const id = s.getState().activeLayerId;
    s.transact("Template Layer", (d) => {
      const l = d.layers.find((x) => x.id === id);
      if (l) l.template = !l.template;
    });
  },

  /** Layers panel ▸ Reverse Order — flip the stacking order of every layer
   *  (undoable). No-op (no undo entry) with fewer than two layers. */
  reverseLayerOrder(s: ArtisanStore) {
    if (s.doc.layers.length <= 1) return;
    s.transact("Reverse Layer Order", (d) => Ops.Layers.reverseLayers(d));
  },

  /** Layers panel ▸ Collect in New Layer — move the selected objects into a fresh
   *  layer (kept selected), made active. No-op (no undo / dirty) when no selected
   *  object is a top-level layer item. */
  collectInNewLayer(s: ArtisanStore) {
    const idset = new Set(sel(s));
    if (!idset.size || !s.doc.layers.some((l) => l.items.some((it) => idset.has(it.id)))) return;
    let layerId: ID | null = null;
    s.transact("Collect in New Layer", (d) => {
      layerId = Ops.Layers.collectInNewLayer(d, idset);
    });
    if (layerId) s.setActiveLayer(layerId);
  },

  /** Object ▸ Arrange ▸ Send to Current Layer — move the selection onto the active
   *  layer (re-stacked on top, relative order kept). Selection is preserved. */
  sendToCurrentLayer(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Send to Current Layer", (d) => Ops.Items.moveToLayer(d, ids, s.getState().activeLayerId));
  },

  /**
   * Arrow-key nudge: move the selection by (dx,dy) world units (one undo step).
   * With a Direct-Selection anchor selection active, nudges those ANCHORS instead
   * (the world delta is mapped into each path's local space).
   */
  nudge(s: ArtisanStore, dx: number, dy: number) {
    const anchorSel = s.getState().anchorSelection;
    const anchorIds = Object.keys(anchorSel).filter((id) => anchorSel[id]?.length);
    if (anchorIds.length) {
      s.transact("Move", (d) => {
        for (const id of anchorIds) {
          const loc = Query.findItem(d, id);
          if (!loc || loc.item.type !== "path") continue;
          const local = Mat.applyToVector(Mat.invert(Query.worldTransformAt(loc)), { x: dx, y: dy });
          Ops.PathEdit.moveAnchors(d, id, anchorSel[id], local.x, local.y);
        }
      });
      return;
    }
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Move", (d) => Ops.Transform.translateItems(d, ids, dx, dy));
  },

  selectAll: (s: ArtisanStore) => s.selectAll(),
  deselectAll: (s: ArtisanStore) => s.clearSelection(),
  /** Select ▸ All on Active Artboard — select every top-level object whose bounds
   *  fall within the active artboard. */
  selectAllOnActiveArtboard: (s: ArtisanStore) => s.setSelection(Query.itemsInRect(s.doc, activeArtboardRect(s))),
  /** Select ▸ Inverse — select every selectable object that isn't selected. */
  selectInverse: (s: ArtisanStore) => s.setSelection(Query.selectInverse(s.doc, s.getState().selection)),

  /** Transparency ▸ Blend Mode — set the blend mode on the selection. */
  setBlendMode(s: ArtisanStore, mode: BlendMode) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Blend Mode", (d) => Ops.Items.setBlendMode(d, ids, mode));
  },

  /** X — toggle the active fill/stroke target. */
  toggleFillStroke: (s: ArtisanStore) => s.setActivePaint(s.getState().activePaint === "fill" ? "stroke" : "fill"),

  /** Shift+X — swap fill and stroke colours: on the selection, or (with nothing
   *  selected) on the default toolbar colours. */
  /** Gradient panel "Reverse" — reverse the stop order of the selection's
   *  gradient fill/stroke. */
  reverseGradient(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Reverse Gradient", (d) => Ops.Paint.reverseGradient(d, ids));
  },

  swapFillStroke(s: ArtisanStore) {
    const st = s.getState();
    if (st.selection.length) {
      s.transact("Swap Fill & Stroke", (d) => Ops.Paint.swapFillStroke(d, st.selection));
    } else {
      const fill = st.fill;
      s.setFill(st.stroke.paint);
      s.setStroke({ ...st.stroke, paint: fill });
    }
  },

  /** "/" — set the active fill/stroke to None (the default AND the selection). */
  noneFillStroke(s: ArtisanStore) {
    const st = s.getState();
    const none = noPaint();
    if (st.activePaint === "fill") {
      s.setFill(none);
      if (st.selection.length) s.transact("None Fill", (d) => Ops.Paint.applyFill(d, st.selection, none));
    } else {
      s.setStroke({ ...st.stroke, paint: none });
      if (st.selection.length) s.transact("None Stroke", (d) => Ops.Paint.applyStrokePaint(d, st.selection, none));
    }
  },

  /** Color panel "Complement" — replace the active fill/stroke colour with its
   *  colour-wheel complement. Reads the shown colour (selection's first paintable
   *  object, else the default) and applies it to that target + the selection.
   *  No-op for a non-solid (gradient/pattern/none) paint. */
  complementColor(s: ArtisanStore) {
    const st = s.getState();
    const fillTarget = st.activePaint === "fill";
    // the colour currently shown: the selection's first non-group item, else the default
    let shown: Paint = fillTarget ? st.fill : st.stroke.paint;
    for (const id of st.selection) {
      const loc = Query.findItem(s.doc, id);
      if (loc && loc.item.type !== "group") {
        shown = fillTarget ? loc.item.fill : loc.item.stroke.paint;
        break;
      }
    }
    if (shown.type !== "solid") return; // only solid colours have a complement
    const comp = solid(complement(shown.color));
    if (fillTarget) {
      s.setFill(comp);
      if (st.selection.length) s.transact("Complement", (d) => Ops.Paint.applyFill(d, st.selection, comp));
    } else {
      s.setStroke({ ...st.stroke, paint: comp });
      if (st.selection.length) s.transact("Complement", (d) => Ops.Paint.applyStrokePaint(d, st.selection, comp));
    }
  },

  /** Color panel "Invert" — replace the active fill/stroke colour with its negative
   *  (255 − each channel). Reads the shown colour (selection's first paintable
   *  object, else the default), applies to that target + the selection. No-op for
   *  a non-solid paint. */
  invertColor(s: ArtisanStore) {
    const st = s.getState();
    const fillTarget = st.activePaint === "fill";
    let shown: Paint = fillTarget ? st.fill : st.stroke.paint;
    for (const id of st.selection) {
      const loc = Query.findItem(s.doc, id);
      if (loc && loc.item.type !== "group") {
        shown = fillTarget ? loc.item.fill : loc.item.stroke.paint;
        break;
      }
    }
    if (shown.type !== "solid") return; // only solid colours invert
    const inv = solid(invert(shown.color));
    if (fillTarget) {
      s.setFill(inv);
      if (st.selection.length) s.transact("Invert Color", (d) => Ops.Paint.applyFill(d, st.selection, inv));
    } else {
      s.setStroke({ ...st.stroke, paint: inv });
      if (st.selection.length) s.transact("Invert Color", (d) => Ops.Paint.applyStrokePaint(d, st.selection, inv));
    }
  },

  /** D — default colours: white fill, black 1-pt stroke (defaults AND selection). */
  defaultFillStroke(s: ArtisanStore) {
    const fill = solid(WHITE);
    const stroke = defaultStroke(solid(BLACK));
    s.setFill(fill);
    s.setStroke(stroke);
    const ids = s.getState().selection;
    if (ids.length) s.transact("Default Fill & Stroke", (d) => Ops.Paint.applyAppearance(d, ids, { fill, stroke }));
  },

  /** Object ▸ Lock (⌘2) — lock the selection; locked objects can't be selected. */
  lockSelection(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Lock", (d) => Ops.Items.setLocked(d, ids, true));
    s.clearSelection(); // a locked object can't stay selected
  },
  /** Object ▸ Unlock All (⌥⌘2) — unlock every locked object and select them. */
  unlockAll(s: ArtisanStore) {
    let unlocked: ID[] = [];
    s.transact("Unlock All", (d) => {
      unlocked = Ops.Items.unlockAll(d);
    });
    if (unlocked.length) s.setSelection(unlocked);
  },
  /** Object ▸ Lock ▸ All Artwork Above (⌥⇧⌘2) — lock every object stacked above
   *  the selection in the same container. */
  lockAllArtworkAbove(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Lock All Artwork Above", (d) => Ops.Items.lockAllAbove(d, ids));
  },
  /** Object ▸ Hide ▸ All Artwork Above — hide every object stacked above the
   *  selection (the selection itself stays visible + selected). */
  hideAllArtworkAbove(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Hide All Artwork Above", (d) => Ops.Items.hideAllAbove(d, ids));
  },
  /** Object ▸ Hide (⌘3) — hide the selection. */
  hideSelection(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Hide", (d) => Ops.Items.setHidden(d, ids, true));
    s.clearSelection(); // a hidden object can't stay selected
  },
  /** Object ▸ Show All (⌥⌘3) — reveal every hidden object and select them. */
  showAll(s: ArtisanStore) {
    let shown: ID[] = [];
    s.transact("Show All", (d) => {
      shown = Ops.Items.showAll(d);
    });
    if (shown.length) s.setSelection(shown);
  },
  /** Object ▸ Lock ▸ Other Layers — lock every layer except the selection's
   *  layer(s) (or the active layer when nothing is selected). */
  lockOtherLayers(s: ArtisanStore) {
    const keep = layersToKeep(s);
    s.transact("Lock Other Layers", (d) => Ops.Layers.lockOtherLayers(d, keep));
  },
  /** Object ▸ Hide ▸ Other Layers — hide every layer except the selection's
   *  layer(s) (or the active layer when nothing is selected). */
  hideOtherLayers(s: ArtisanStore) {
    const keep = layersToKeep(s);
    s.transact("Hide Other Layers", (d) => Ops.Layers.hideOtherLayers(d, keep));
  },

  /** Object ▸ Path ▸ Clean Up — delete stray points, unpainted objects, empty text. */
  cleanUp(s: ArtisanStore) {
    if (Ops.Items.cleanUpTargets(s.doc).length === 0) return; // nothing to clean — no undo entry
    s.transact("Clean Up", (d) => {
      Ops.Items.cleanUp(d);
    });
    s.setSelection(Query.selectableIds(s.doc, s.getState().selection)); // drop any deleted ids
  },

  /** Select ▸ Same — select every object sharing the reference's attribute. The
   *  font criteria key off a text object, so they prefer the first selected text
   *  as the reference (the menu gates them on a text selection). */
  selectSame(s: ArtisanStore, criterion: Query.SameCriterion) {
    const ids = sel(s);
    if (!ids.length) return;
    s.setLastSelectQuery({ kind: "same", criterion }); // remembered for Reselect
    // The text-keyed criteria prefer the first selected text object as the reference
    // (the menu gates them on a text selection).
    const textKeyed = criterion === "font-family" || criterion === "font-size" || criterion === "font-family-style" || criterion === "text-fill";
    const refId = textKeyed ? (ids.find((id) => Query.getItem(s.doc, id)?.type === "text") ?? ids[0]) : ids[0];
    const matches = Query.selectSame(s.doc, refId, criterion);
    if (matches.length) s.setSelection(matches);
  },

  /** Select ▸ Reselect (⌘6) — re-run the last Select ▸ Same / Select ▸ Object query
   *  against the current selection. No-op until one has been run. */
  reselect(s: ArtisanStore) {
    const q = s.getState().lastSelectQuery;
    if (!q) return;
    if (q.kind === "same") commands.selectSame(s, q.criterion);
    else if (q.kind === "same-layers") commands.selectSameLayers(s);
    else commands.selectObjects(s, q.k);
  },

  /** Select ▸ Object ▸ {Text Objects | Stray Points | Clipping Masks} — select
   *  every object of that kind across the document. */
  selectObjects(s: ArtisanStore, kind: SelectKind) {
    s.setLastSelectQuery({ kind: "object", k: kind }); // remembered for Reselect
    s.setSelection(Ops.SelectObjects.matchingObjectIds(s.doc, kind));
  },

  /** Select ▸ Object ▸ All on Same Layers — select every selectable object on the
   *  same layer(s) as the current selection. No-op when nothing is selected. */
  selectSameLayers(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.setLastSelectQuery({ kind: "same-layers" }); // remembered for Reselect
    const matches = Query.itemsOnSameLayers(s.doc, ids);
    if (matches.length) s.setSelection(matches);
  },

  /** Select ▸ Save Selection — remember the current selection under an
   *  auto-incremented name; it appears at the bottom of the Select menu. No-op
   *  when nothing is selected. */
  saveSelection(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.saveSelection(`Selection ${s.getState().savedSelections.length + 1}`, ids);
  },

  /** Apply a saved selection by id, restoring it to the objects that still exist
   *  (deleted ids are dropped). */
  applySavedSelection(s: ArtisanStore, id: ID) {
    const saved = s.getState().savedSelections.find((sv) => sv.id === id);
    if (!saved) return;
    s.setSelection(Query.selectableIds(s.doc, saved.ids));
  },

  /** Select ▸ Next Object Above / Below — move the selection to the sibling in
   *  front of / behind the single selected object (no-op at the container ends,
   *  or unless exactly one object is selected). */
  selectNextObject(s: ArtisanStore, dir: "above" | "below") {
    const ids = sel(s);
    if (ids.length !== 1) return;
    const next = Query.nextObject(s.doc, ids[0], dir);
    if (next) s.setSelection([next]);
  },

  /** Effect ▸ Distort & Transform ▸ Transform — stamp transformed copies of the
   *  selection. Defaults to a step-and-repeat (move 20,20 × 5 copies); pass `opts`
   *  for rotate/scale/reflect/reference/copies. */
  transformCopies(s: ArtisanStore, opts: Partial<TransformCopiesOptions> = {}) {
    const ids = sel(s);
    if (!ids.length) return;
    const params: TransformCopiesOptions = {
      scaleX: opts.scaleX,
      scaleY: opts.scaleY,
      rotate: opts.rotate,
      moveX: opts.moveX ?? 20,
      moveY: opts.moveY ?? 20,
      reflectX: opts.reflectX,
      reflectY: opts.reflectY,
      reference: opts.reference,
      copies: opts.copies ?? 5,
    };
    let newIds: ID[] = [];
    s.transact("Transform", (d) => {
      newIds = Ops.TransformCopies.transformCopies(d, ids, params);
    });
    if (newIds.length) s.setSelection(newIds);
  },

  /** Effect ▸ Distort & Transform ▸ Pucker & Bloat — curve the selection's edges
   *  radially. `amount` > 0 bloats, < 0 puckers (default 0.5 = 50% bloat). */
  puckerBloat(s: ArtisanStore, amount = 0.5) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact(amount >= 0 ? "Bloat" : "Pucker", (d) => {
      Ops.PuckerBloat.puckerBloat(d, ids, amount);
    });
  },

  /** Effect ▸ Distort & Transform ▸ Twist — whirl the selection around its centre
   *  (interior more than the rim). `angleDeg` defaults to 30°. */
  twist(s: ArtisanStore, angleDeg = 30) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Twist", (d) => {
      Ops.Twist.twist(d, ids, (angleDeg * Math.PI) / 180);
    });
  },

  /** Effect ▸ Distort & Transform ▸ Free Distort — bilinearly remap the selection
   *  from its bounding box onto a quadrilateral. `corners` are normalized
   *  unit-square positions; the default is a perspective trapezoid (top edge
   *  pulled in 20% each side). */
  freeDistort(s: ArtisanStore, corners: Ops.FreeDistort.FreeDistortCorners = FREE_DISTORT_PERSPECTIVE) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Free Distort", (d) => {
      Ops.FreeDistort.freeDistort(d, ids, corners);
    });
  },

  /** Object ▸ Perspective ▸ Make — preserve a source-art snapshot and generate
   *  the current affine/bilinear perspective approximation as editable artwork. */
  makePerspective(s: ArtisanStore, corners: Ops.FreeDistort.FreeDistortCorners = FREE_DISTORT_PERSPECTIVE) {
    const ids = sel(s);
    if (!ids.length) return;
    let gid: ID | null = null;
    s.transact("Make Perspective", (d) => {
      gid = Ops.Perspective.makePerspectiveGroup(d, ids, { corners });
    });
    if (gid) s.setSelection([gid]);
  },

  /** Object ▸ Perspective ▸ Expand — keep generated artwork but drop live
   *  perspective metadata. */
  expandPerspective(s: ArtisanStore) {
    if (!selectionHasPerspective(s)) return;
    const ids = sel(s);
    let expanded: ID[] = [];
    s.transact("Expand Perspective", (d) => {
      expanded = Ops.Perspective.expandPerspectiveGroups(d, ids);
    });
    if (expanded.length) s.setSelection(expanded);
  },

  /** Object ▸ Perspective ▸ Release — restore the stored source artwork and
   *  ungroup it back into ordinary objects. */
  releasePerspective(s: ArtisanStore) {
    if (!selectionHasPerspective(s)) return;
    const ids = sel(s);
    let released: ID[] = [];
    s.transact("Release Perspective", (d) => {
      released = Ops.Perspective.releasePerspectiveGroups(d, ids);
    });
    if (released.length) s.setSelection(released);
  },

  /** Object ▸ Envelope Distort ▸ Make with Warp — bend the selection inside one
   *  shared box. Re-running it re-derives from the ORIGINAL art, so repeated
   *  bends never compound. */
  makeEnvelopeWarp(s: ArtisanStore, style: WarpStyle, bend = 0.4) {
    const ids = sel(s);
    if (!ids.length) return;
    let gid: ID | null = null;
    s.transact("Envelope Distort", (d) => {
      gid = Ops.Envelope.makeWithWarp(d, ids, { style, bend });
    });
    if (gid) s.setSelection([gid]);
  },

  /** Object ▸ Envelope Distort ▸ Make with Top Object — the frontmost selected
   *  object becomes the envelope outline; everything below is mapped into it. */
  makeEnvelopeTopObject(s: ArtisanStore) {
    const ids = sel(s);
    if (ids.length < 2) return;
    let gid: ID | null = null;
    s.transact("Envelope Distort", (d) => {
      gid = Ops.Envelope.makeWithTopObject(d, ids);
    });
    if (gid) s.setSelection([gid]);
  },

  /** Object ▸ Envelope Distort ▸ Envelope Options — re-bend the selected warp
   *  envelope(s) from their original artwork. */
  envelopeOptions(s: ArtisanStore, style: WarpStyle, bend: number) {
    if (!selectionHasEnvelope(s)) return;
    const ids = sel(s);
    s.transact("Envelope Options", (d) => {
      Ops.Envelope.updateWarp(d, ids, { style, bend });
    });
  },

  /** Object ▸ Envelope Distort ▸ Release — restore the undistorted contents (and
   *  the envelope outline, for a top-object envelope). */
  releaseEnvelope(s: ArtisanStore) {
    if (!selectionHasEnvelope(s)) return;
    const ids = sel(s);
    let released: ID[] = [];
    s.transact("Release Envelope", (d) => {
      released = Ops.Envelope.release(d, ids);
    });
    if (released.length) s.setSelection(released);
  },

  /** Object ▸ Envelope Distort ▸ Expand — keep the distorted art, drop the envelope. */
  expandEnvelope(s: ArtisanStore) {
    if (!selectionHasEnvelope(s)) return;
    const ids = sel(s);
    let expanded: ID[] = [];
    s.transact("Expand Envelope", (d) => {
      expanded = Ops.Envelope.expand(d, ids);
    });
    if (expanded.length) s.setSelection(expanded);
  },

  /** Effect ▸ Stylize ▸ Scribble — fill the selection with a hatched scribble
   *  stroked in its former fill colour. Defaults: 30°, spacing 8, width 2. */
  scribble(s: ArtisanStore, opts: Partial<ScribbleOptions> = {}) {
    const ids = sel(s);
    if (!ids.length) return;
    const params: ScribbleOptions = { angle: opts.angle ?? 30, spacing: opts.spacing ?? 8, strokeWidth: opts.strokeWidth ?? 2 };
    s.transact("Scribble", (d) => {
      Ops.Scribble.scribble(d, ids, params);
    });
  },

  /** Effect ▸ Distort & Transform ▸ Roughen — jitter the selection into a jagged
   *  (Corner) or wavy (Smooth) edge. Defaults: size 10, 2 points/segment, corner. */
  roughen(s: ArtisanStore, opts: Partial<RoughenOptions> = {}) {
    const ids = sel(s);
    if (!ids.length) return;
    const params: RoughenOptions = {
      size: opts.size ?? 10,
      detail: opts.detail ?? 2,
      smooth: opts.smooth ?? false,
      seed: opts.seed ?? 1,
    };
    s.transact("Roughen", (d) => {
      Ops.Roughen.roughen(d, ids, params);
    });
  },

  /** Effect ▸ Distort & Transform ▸ Tweak — randomly nudge the selection's anchors
   *  / handles. Defaults: horizontal 10, vertical 10, anchor points only. */
  tweak(s: ArtisanStore, opts: Partial<TweakOptions> = {}) {
    const ids = sel(s);
    if (!ids.length) return;
    const params: TweakOptions = {
      horizontal: opts.horizontal ?? 10,
      vertical: opts.vertical ?? 10,
      anchors: opts.anchors ?? true,
      inHandles: opts.inHandles ?? false,
      outHandles: opts.outHandles ?? false,
      seed: opts.seed ?? 1,
    };
    s.transact("Tweak", (d) => {
      Ops.Tweak.tweak(d, ids, params);
    });
  },

  group(s: ArtisanStore) {
    const ids = sel(s);
    if (ids.length < 2) return; // 2+ items to group, matching the menu (AR-H6)
    let gid: ID | null = null;
    s.transact("Group", (d) => {
      gid = Ops.Group.group(d, ids);
    });
    if (gid) s.setSelection([gid]);
  },

  ungroup(s: ArtisanStore) {
    const ids = sel(s);
    if (!Ops.Group.canUngroup(s.doc, ids)) return;
    let released: ID[] = [];
    s.transact("Ungroup", (d) => {
      released = Ops.Group.ungroup(d, ids);
    });
    if (released.length) s.setSelection(released);
  },

  makeClipMask(s: ArtisanStore) {
    const ids = sel(s);
    if (ids.length < 2) return;
    let gid: ID | null = null;
    s.transact("Make Clipping Mask", (d) => {
      gid = Ops.Group.makeClipGroup(d, ids);
    });
    if (gid) s.setSelection([gid]);
  },

  releaseClipMask(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    let released: ID[] = [];
    s.transact("Release Clipping Mask", (d) => {
      released = Ops.Group.releaseClipGroup(d, ids);
    });
    if (released.length) s.setSelection(released);
  },

  makeMask(s: ArtisanStore) {
    const ids = sel(s);
    if (ids.length < 2) return;
    let tid: ID | null = null;
    s.transact("Make Opacity Mask", (d) => {
      tid = Ops.Group.makeOpacityMask(d, ids);
    });
    if (tid) s.setSelection([tid]);
  },

  releaseMask(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    let released: ID[] = [];
    s.transact("Release Opacity Mask", (d) => {
      released = Ops.Group.releaseOpacityMask(d, ids);
    });
    s.setSelection([...ids, ...released]);
  },

  /** Object ▸ Live Paint ▸ Make — wrap the selection as a Live Paint group with
   *  baseline face/edge metadata tied to the child artwork. */
  makeLivePaint(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    let gid: ID | null = null;
    s.transact("Make Live Paint", (d) => {
      gid = Ops.LivePaint.makeLivePaintGroup(d, ids);
    });
    if (gid) s.setSelection([gid]);
  },

  /** Object ▸ Live Paint ▸ Expand — keep generated artwork but drop Live Paint
   *  editability metadata. */
  expandLivePaint(s: ArtisanStore) {
    if (!selectionHasLivePaint(s)) return;
    const ids = sel(s);
    let expanded: ID[] = [];
    s.transact("Expand Live Paint", (d) => {
      expanded = Ops.LivePaint.expandLivePaintGroups(d, ids);
    });
    if (expanded.length) s.setSelection(expanded);
  },

  /** Object ▸ Live Paint ▸ Release — ungroup selected Live Paint groups back to
   *  ordinary artwork. */
  releaseLivePaint(s: ArtisanStore) {
    if (!selectionHasLivePaint(s)) return;
    const ids = sel(s);
    let released: ID[] = [];
    s.transact("Release Live Paint", (d) => {
      released = Ops.LivePaint.releaseLivePaintGroups(d, ids);
    });
    if (released.length) s.setSelection(released);
  },

  makePattern(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    const bounds = Query.selectionBounds(s.doc, ids);
    if (!bounds) return;
    // Deep-clone each selected item, bake its WORLD transform, shift so the
    // selection bbox origin maps to the tile origin (0,0).
    const tile: Item[] = [];
    for (const id of ids) {
      const loc = Query.findItem(s.doc, id);
      if (!loc) continue;
      const world = Query.worldTransformAt(loc);
      const clone = Ops.Items.cloneItemDeep(loc.item);
      clone.transform = { ...world, e: world.e - bounds.x, f: world.f - bounds.y };
      tile.push(clone);
    }
    if (!tile.length) return;
    const paint = pattern(tile, bounds.width, bounds.height);
    s.transact("Make Pattern", (d) => {
      d.swatches.push(cloneDeep(paint));
    });
    s.setFill(paint); // active fill, ready to apply
  },

  /** Stroke panel — apply a Width Profile preset to the selected paths (live
   *  shapes are converted to paths first so the variable width renders). */
  applyWidthProfile(s: ArtisanStore, preset: WidthProfilePreset) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Width Profile", (d) => Ops.WidthProfile.applyWidthProfile(d, ids, preset));
  },

  /** Object ▸ Artboards ▸ Fit to Selected Art — resize the active artboard to the
   *  selection's world bounding box (undoable). No-op without a selection/artboard. */
  fitArtboardToSelection(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length || !s.doc.artboards.length) return;
    const b = Query.selectionBounds(s.doc, ids);
    if (!b) return;
    s.transact("Fit Artboard to Selection", (d) => {
      const ab = d.artboards[d.activeArtboard] ?? d.artboards[0];
      ab.x = b.x;
      ab.y = b.y;
      ab.width = b.width;
      ab.height = b.height;
    });
  },

  /** Object ▸ Artboards ▸ Fit to Artwork Bounds — resize the active artboard to the
   *  combined bounds of all top-level artwork (undoable). No-op with no artwork/artboard. */
  fitArtboardToArtwork(s: ArtisanStore) {
    if (!s.doc.artboards.length) return;
    const ids = s.doc.layers.flatMap((l) => l.items).map((i) => i.id);
    if (!ids.length) return;
    const b = Query.selectionBounds(s.doc, ids);
    if (!b) return;
    s.transact("Fit Artboard to Artwork", (d) => {
      const ab = d.artboards[d.activeArtboard] ?? d.artboards[0];
      ab.x = b.x;
      ab.y = b.y;
      ab.width = b.width;
      ab.height = b.height;
    });
  },

  /** Object ▸ Artboards ▸ New Artboard — add an artboard the size of the active one,
   *  20 units to the right of the rightmost artboard, and make it active. Undoable. */
  newArtboard(s: ArtisanStore) {
    s.transact("New Artboard", (d) => {
      const boards = d.artboards;
      const active = boards[d.activeArtboard] ?? boards[0];
      const w = active?.width ?? 800;
      const h = active?.height ?? 600;
      const y = active?.y ?? 0;
      const x = boards.length ? Math.max(...boards.map((a) => a.x + a.width)) + 20 : 0;
      boards.push(makeArtboard(`Artboard ${boards.length + 1}`, x, y, w, h));
      d.activeArtboard = boards.length - 1;
    });
  },

  /** Object ▸ Artboards ▸ Delete Artboard — remove the active artboard and re-point
   *  activeArtboard at a valid index. No-op (no undo entry) on the last artboard. */
  deleteArtboard(s: ArtisanStore) {
    if (s.doc.artboards.length <= 1) return;
    s.transact("Delete Artboard", (d) => {
      const i = d.activeArtboard;
      d.artboards.splice(i, 1);
      d.activeArtboard = Math.min(i, d.artboards.length - 1);
    });
  },

  /** Object ▸ Artboards ▸ Duplicate Artboard — copy the active artboard (and the
   *  top-level artwork fully on it) to a new artboard 20 units to the right; the
   *  duplicated artwork is offset to land on it, becomes active + selected. Undoable. */
  duplicateArtboard(s: ArtisanStore) {
    const ab0 = s.doc.artboards[s.doc.activeArtboard];
    if (!ab0) return;
    const dx = ab0.width + 20;
    const onBoard = Query.itemsInRect(s.doc, { x: ab0.x, y: ab0.y, width: ab0.width, height: ab0.height }, "window");
    let cloneIds: ID[] = [];
    s.transact("Duplicate Artboard", (d) => {
      cloneIds = [];
      for (const id of onBoard) {
        const loc = Query.findItem(d, id);
        if (!loc) continue;
        const clone = Ops.Items.cloneItemDeep(loc.item);
        loc.container.push(clone);
        cloneIds.push(clone.id);
      }
      if (cloneIds.length) Ops.Transform.translateItems(d, cloneIds, dx, 0);
      const ab = d.artboards[d.activeArtboard];
      d.artboards.push(makeArtboard(`Artboard ${d.artboards.length + 1}`, ab.x + dx, ab.y, ab.width, ab.height));
      d.activeArtboard = d.artboards.length - 1;
    });
    if (cloneIds.length) s.setSelection(cloneIds);
  },

  /** Object ▸ Artboards ▸ Rearrange All Artboards — lay every artboard out in a
   *  single left-to-right row, anchored at the first artboard, top-aligned, with a
   *  20-unit gap (sizes preserved). Undoable; no-op with fewer than two artboards. */
  rearrangeArtboards(s: ArtisanStore) {
    if (s.doc.artboards.length < 2) return;
    s.transact("Rearrange Artboards", (d) => {
      const gap = 20;
      const { x: startX, y } = d.artboards[0];
      let x = startX;
      for (const ab of d.artboards) {
        ab.x = x;
        ab.y = y;
        x += ab.width + gap;
      }
    });
  },

  /** Object ▸ Artboards ▸ Convert to Artboards — add one new artboard matching the
   *  world bounds of each selected object (the artwork is kept). Undoable; no-op
   *  when nothing selectable is selected. */
  convertToArtboards(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    const rects = ids.map((id) => Query.worldBounds(s.doc, id)).filter((b): b is Rect => !!b);
    if (!rects.length) return;
    s.transact("Convert to Artboards", (d) => {
      for (const b of rects) {
        d.artboards.push({ id: newId("A"), name: `Artboard ${d.artboards.length + 1}`, x: b.x, y: b.y, width: b.width, height: b.height });
      }
    });
  },

  /** Object ▸ Slice ▸ Create from Selection — add an export slice matching the
   *  selection's world bounding box (undoable). No-op when nothing is selected. */
  createSliceFromSelection(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    const b = Query.selectionBounds(s.doc, ids);
    if (!b) return;
    s.transact("Create Slice", (d) => {
      if (!d.slices) d.slices = [];
      d.slices.push({ id: newId("S"), name: `Slice ${d.slices.length + 1}`, x: b.x, y: b.y, width: b.width, height: b.height });
    });
  },

  /** Object ▸ Slice ▸ Create from Guides — partition the active artboard into a
   *  grid of export slices at the ruler guides that fall inside it (undoable).
   *  With no guides this is a single artboard-sized slice. No-op without an artboard. */
  createSlicesFromGuides(s: ArtisanStore) {
    const r = activeArtboardRect(s);
    if (r.width <= 0 || r.height <= 0) return;
    const cuts = (orient: "h" | "v", lo: number, hi: number): number[] =>
      [...new Set(s.getState().guides.filter((g) => g.orientation === orient && g.pos > lo && g.pos < hi).map((g) => g.pos))].sort((a, b) => a - b);
    const xs = [r.x, ...cuts("v", r.x, r.x + r.width), r.x + r.width];
    const ys = [r.y, ...cuts("h", r.y, r.y + r.height), r.y + r.height];
    s.transact("Create Slices from Guides", (d) => {
      if (!d.slices) d.slices = [];
      let n = d.slices.length;
      for (let row = 0; row < ys.length - 1; row++) {
        for (let col = 0; col < xs.length - 1; col++) {
          d.slices.push({ id: newId("S"), name: `Slice ${++n}`, x: xs[col], y: ys[row], width: xs[col + 1] - xs[col], height: ys[row + 1] - ys[row] });
        }
      }
    });
  },

  /** Object ▸ Slice ▸ Delete All Slices — clear every export slice (undoable).
   *  No-op (no undo entry) when there are none. */
  deleteAllSlices(s: ArtisanStore) {
    if (!s.doc.slices?.length) return;
    s.transact("Delete All Slices", (d) => {
      d.slices = [];
    });
    s.setSelectedSlice(undefined); // drop any stale slice selection
  },

  /** Swatches panel — save a paint as a new document swatch (undoable). */
  newSwatch(s: ArtisanStore, paint: Paint) {
    s.transact("New Swatch", (d) => {
      d.swatches.push(cloneDeep(paint));
    });
  },

  /** Swatches panel — remove the swatch at `index` (undoable, bounds-guarded). */
  deleteSwatch(s: ArtisanStore, index: number) {
    if (index < 0 || index >= s.doc.swatches.length) return;
    s.transact("Delete Swatch", (d) => {
      d.swatches.splice(index, 1);
    });
  },

  /** Swatches panel — Illustrator's "Select All Unused" cleanup, as one action:
   *  remove every swatch no artwork references (undoable). No-op when all are used. */
  deleteUnusedSwatches(s: ArtisanStore) {
    const unused = Query.unusedSwatchIndices(s.doc);
    if (!unused.length) return; // nothing unused — no undo entry
    s.transact("Delete Unused Swatches", (d) => {
      for (let i = unused.length - 1; i >= 0; i--) d.swatches.splice(unused[i], 1); // splice high→low
    });
  },

  /** Swatches panel — Illustrator's "Add Used Colors": append every solid colour
   *  the artwork uses that isn't already a swatch (undoable). No-op when none. */
  addUsedColors(s: ArtisanStore) {
    const add = Query.usedColorsNotInSwatches(s.doc);
    if (!add.length) return; // every used colour is already a swatch — no undo entry
    s.transact("Add Used Colors", (d) => {
      for (const p of add) d.swatches.push(cloneDeep(p));
    });
  },

  /** Swatches panel — merge an imported Adobe library (.aco / .ase / .act) into
   *  the document's swatches, skipping colours already there (undoable).
   *  Returns how many were added; 0 makes no undo entry. */
  importSwatches(s: ArtisanStore, paints: Paint[]): number {
    const have = new Set(s.doc.swatches.map(Query.paintKey));
    const add = paints.filter((paint) => {
      const key = Query.paintKey(paint);
      if (have.has(key)) return false;
      have.add(key); // also de-dupes repeats inside the imported file
      return true;
    });
    if (!add.length) return 0;
    s.transact("Import Swatches", (d) => {
      for (const paint of add) d.swatches.push(cloneDeep(paint));
    });
    return add.length;
  },

  /** Swatches panel — Illustrator's "Sort by Hue": order solid swatches by hue
   *  (then saturation, value); gradient / none swatches keep their order after the
   *  solids. Undoable; no-op (no undo entry) when already sorted or < 2 swatches. */
  sortSwatchesByHue(s: ArtisanStore) {
    const current = s.doc.swatches;
    if (current.length < 2) return;
    const sorted = sortPaintsByHue(current);
    if (sorted.every((p, i) => p === current[i])) return; // already in hue order
    s.transact("Sort Swatches by Hue", (d) => {
      d.swatches = sortPaintsByHue(d.swatches);
    });
  },

  /** Graphic Styles panel — save the (first) selected object's appearance as a new
   *  named style (undoable). No-op (no dirty) without a selection. */
  newGraphicStyle(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    const it = Query.getItem(s.getState().doc, ids[0]);
    if (!it) return;
    const appearance = Ops.GraphicStyles.styleAppearance(it);
    s.transact("New Graphic Style", (d) => {
      if (!d.graphicStyles) d.graphicStyles = [];
      d.graphicStyles.push({ id: newId("gs"), name: `Style ${d.graphicStyles.length + 1}`, ...appearance });
    });
  },

  /** Graphic Styles panel — apply a saved style's appearance to the selection (undoable). */
  applyGraphicStyle(s: ArtisanStore, id: ID) {
    const ids = sel(s);
    if (!ids.length) return;
    const style = (s.getState().doc.graphicStyles ?? []).find((g) => g.id === id);
    if (!style) return;
    s.transact("Apply Graphic Style", (d) => Ops.GraphicStyles.applyGraphicStyle(d, ids, style));
  },

  /** Graphic Styles panel — delete the style at `index` (undoable, bounds-guarded). */
  deleteGraphicStyle(s: ArtisanStore, index: number) {
    const styles = s.getState().doc.graphicStyles ?? [];
    if (index < 0 || index >= styles.length) return;
    s.transact("Delete Graphic Style", (d) => {
      d.graphicStyles?.splice(index, 1);
    });
  },

  /** Actions panel — create a document-backed action with a default Duplicate step. */
  newAction(s: ArtisanStore, name = `Action ${(s.getState().doc.actions?.length ?? 0) + 1}`): ID | null {
    let id: ID | null = null;
    s.transact("New Action", (d) => {
      id = Ops.Actions.createAction(d, name);
    });
    return id;
  },

  renameAction(s: ArtisanStore, actionId: ID, name: string) {
    if (!name.trim()) return;
    s.transact("Rename Action", (d) => {
      Ops.Actions.renameAction(d, actionId, name);
    });
  },

  deleteAction(s: ArtisanStore, actionId: ID) {
    if (!(s.getState().doc.actions ?? []).some((action) => action.id === actionId)) return;
    s.transact("Delete Action", (d) => {
      Ops.Actions.deleteAction(d, actionId);
    });
  },

  appendActionStep(s: ArtisanStore, actionId: ID, command: ActionStepCommand) {
    if (!(s.getState().doc.actions ?? []).some((action) => action.id === actionId)) return;
    s.transact("Add Action Step", (d) => {
      Ops.Actions.appendActionStep(d, actionId, command);
    });
  },

  deleteActionStep(s: ArtisanStore, actionId: ID, stepId: ID) {
    if (!(s.getState().doc.actions ?? []).some((action) => action.id === actionId)) return;
    s.transact("Delete Action Step", (d) => {
      Ops.Actions.deleteActionStep(d, actionId, stepId);
    });
  },

  setActionStepEnabled(s: ArtisanStore, actionId: ID, stepId: ID, enabled: boolean) {
    if (!(s.getState().doc.actions ?? []).some((action) => action.id === actionId)) return;
    s.transact("Toggle Action Step", (d) => {
      Ops.Actions.setActionStepEnabled(d, actionId, stepId, enabled);
    });
  },

  /** Actions panel — replay a saved action against the current selection as one undo step. */
  playAction(s: ArtisanStore, actionId: ID) {
    const action = (s.getState().doc.actions ?? []).find((candidate) => candidate.id === actionId);
    const ids = sel(s);
    if (!action || !ids.length || !action.steps.some((step) => step.enabled !== false)) return;
    let nextSelection: ID[] = ids;
    s.transact(`Play Action: ${action.name}`, (d) => {
      nextSelection = Ops.Actions.replayAction(d, actionId, ids).selection;
    });
    s.setSelection(nextSelection);
  },

  /** Object ▸ Create Trim Marks — add printer's trim marks around the selection's
   *  bounding box (artwork is kept; the marks group becomes the selection). */
  createTrimMarks(s: ArtisanStore, opts: TrimMarksOptions = {}) {
    const ids = sel(s);
    if (!ids.length) return;
    let gid: ID | null = null;
    s.transact("Make Trim Marks", (d) => {
      gid = Ops.TrimMarks.trimMarks(d, ids, opts);
    });
    if (gid) s.setSelection([gid]);
  },

  /** Object ▸ Convert to Shape — replace the selection with a Rectangle / Rounded
   *  Rectangle / Ellipse fitting each object's bounds. */
  convertToShape(s: ArtisanStore, shape: ShapeKind, opts: ConvertToShapeOptions = {}) {
    const ids = sel(s);
    if (!ids.length) return;
    let newIds: ID[] = [];
    s.transact("Convert to Shape", (d) => {
      newIds = Ops.ConvertShape.convertToShape(d, ids, shape, opts);
    });
    if (newIds.length) s.setSelection(newIds);
  },

  /** Edit ▸ Edit Colors ▸ {Invert Colors | Convert to Grayscale} — recolour the
   *  selection's fills/strokes in place. */
  editColors(s: ArtisanStore, mode: EditColorsMode) {
    const ids = sel(s);
    if (!ids.length) return;
    const label = { invert: "Invert Colors", grayscale: "Convert to Grayscale", saturate: "Saturate", desaturate: "Desaturate" }[mode];
    s.transact(label, (d) => {
      Ops.EditColors.editColors(d, ids, mode);
    });
  },

  /** Edit ▸ Edit Colors ▸ Blend {Front to Back | Horizontally | Vertically} —
   *  interpolate the solid fills of ≥3 selected objects across order/position. */
  blendColors(s: ArtisanStore, mode: ColorBlendMode) {
    const ids = sel(s);
    const solidCount = ids.filter((id) => {
      const item = Query.getItem(s.doc, id);
      return item ? paintedFill(item).type === "solid" : false;
    }).length;
    if (solidCount < 3) return;
    s.transact("Blend Colors", (d) => {
      Ops.BlendColors.blendColors(d, ids, mode);
    });
  },

  /** Type ▸ Change Case — recase the selected text objects. */
  changeCase(s: ArtisanStore, mode: CaseMode) {
    const ids = sel(s);
    if (!ids.some((id) => Query.findItem(s.doc, id)?.item.type === "text")) return;
    s.transact("Change Case", (d) => {
      Ops.ChangeCase.changeCase(d, ids, mode);
    });
  },

  /** Type ▸ Smart Punctuation — curl quotes and convert -- / ... in selected text. */
  smartPunctuation(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.some((id) => Query.findItem(s.doc, id)?.item.type === "text")) return;
    s.transact("Smart Punctuation", (d) => {
      Ops.SmartPunctuation.smartPunctuation(d, ids);
    });
  },

  /** Type ▸ Convert to Area / Point Type — toggle the selected text between auto-
   *  width point text and a fixed area box (undoable; no-op when nothing converts). */
  convertTextType(s: ArtisanStore, target: "area" | "point") {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact(target === "area" ? "Convert to Area Type" : "Convert to Point Type", (d) => Ops.Text.convertText(d, ids, target));
  },

  bringToFront: (s: ArtisanStore) => mutateArrange(s, "Bring to Front", Ops.Arrange.bringToFront),
  bringForward: (s: ArtisanStore) => mutateArrange(s, "Bring Forward", Ops.Arrange.bringForward),
  sendBackward: (s: ArtisanStore) => mutateArrange(s, "Send Backward", Ops.Arrange.sendBackward),
  sendToBack: (s: ArtisanStore) => mutateArrange(s, "Send to Back", Ops.Arrange.sendToBack),

  rotate90CW: (s: ArtisanStore) => transformAroundCenter(s, "Rotate 90° CW", (d, ids, c) => Ops.Transform.rotateItems(d, ids, Math.PI / 2, c), { kind: "rotate90cw" }),
  rotate90CCW: (s: ArtisanStore) => transformAroundCenter(s, "Rotate 90° CCW", (d, ids, c) => Ops.Transform.rotateItems(d, ids, -Math.PI / 2, c), { kind: "rotate90ccw" }),
  reflectHorizontal: (s: ArtisanStore) => transformAroundCenter(s, "Reflect Horizontal", (d, ids, c) => Ops.Transform.reflectItems(d, ids, Math.PI / 2, c), { kind: "reflect-h" }),
  reflectVertical: (s: ArtisanStore) => transformAroundCenter(s, "Reflect Vertical", (d, ids, c) => Ops.Transform.reflectItems(d, ids, 0, c), { kind: "reflect-v" }),

  /** Object ▸ Transform ▸ Transform Each — scale/rotate/move EACH selected object
   *  around its own centre. Defaults to a 50% scale-in-place (Illustrator's dialog
   *  is non-modal here; pass `opts` for other values). */
  transformEach(s: ArtisanStore, opts: Partial<TransformEachOptions> = {}) {
    const ids = sel(s);
    if (!ids.length) return;
    const params: TransformEachOptions = {
      scaleX: opts.scaleX ?? 0.5,
      scaleY: opts.scaleY ?? 0.5,
      rotate: opts.rotate ?? 0,
      moveX: opts.moveX ?? 0,
      moveY: opts.moveY ?? 0,
      reflectX: opts.reflectX,
      reflectY: opts.reflectY,
    };
    s.transact("Transform Each", (d) => Ops.TransformEach.transformEach(d, ids, params));
    s.setLastTransform({ kind: "transform-each", opts }); // remembered for Transform Again
  },

  /** Object ▸ Transform ▸ Transform Again — re-apply the last transform to the
   *  current selection (Illustrator's step-and-repeat). No-op when none recorded. */
  transformAgain(s: ArtisanStore) {
    const last = s.getState().lastTransform;
    if (!last) return;
    switch (last.kind) {
      case "rotate90cw":
        return commands.rotate90CW(s);
      case "rotate90ccw":
        return commands.rotate90CCW(s);
      case "reflect-h":
        return commands.reflectHorizontal(s);
      case "reflect-v":
        return commands.reflectVertical(s);
      case "transform-each":
        return commands.transformEach(s, last.opts);
    }
  },

  align(s: ArtisanStore, action: AlignAction, relativeTo: "selection" | "artboard" | "key-object" = "selection") {
    const ids = sel(s);
    if (!ids.length) return;
    const key = s.keyObjectId;
    // "Align to Key Object": measure against the key's bounds (it stays put). Falls
    // back to the selection bounds if no valid key is set (Illustrator parity).
    let ref: Rect | null;
    if (relativeTo === "artboard") ref = activeArtboardRect(s);
    else if (relativeTo === "key-object" && key && ids.includes(key)) ref = Query.worldBounds(s.doc, key) ?? Query.selectionBounds(s.doc, ids);
    else ref = Query.selectionBounds(s.doc, ids);
    if (!ref) return;
    s.transact(`Align ${action}`, (d) => Ops.Align.align(d, ids, action, ref));
  },

  /** Align panel ▸ Distribute Spacing — space the selection with an exact gap
   *  between adjacent objects along the axis (Illustrator parity). No-op (<2). */
  distributeSpacing(s: ArtisanStore, axis: "h" | "v", gap: number) {
    const ids = sel(s);
    if (ids.length < 2) return;
    s.transact("Distribute Spacing", (d) => Ops.Align.distributeSpacing(d, ids, axis, gap));
  },

  applyEffect(s: ArtisanStore, type: "drop-shadow" | "blur" | "feather" | "glow" | "inner-glow") {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact(`Effect: ${type}`, (d) => Ops.Effects.addEffect(d, ids, Ops.Effects.defaultEffect(type)));
  },
  clearEffects(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Clear Effects", (d) => Ops.Effects.clearEffects(d, ids));
  },

  join(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    let nid: ID | null = null;
    s.transact("Join", (d) => {
      nid = Ops.PathEdit.joinPaths(d, ids);
    });
    if (nid) s.setSelection([nid]);
  },

  outlineStroke(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    let newIds: ID[] = [];
    s.transact("Outline Stroke", (d) => {
      newIds = Ops.PathEdit.outlineStroke(d, ids);
    });
    if (newIds.length) s.setSelection(newIds);
  },

  /** Effect ▸ Stylize ▸ Add Arrowheads — bake arrowhead shapes onto the open ends
   *  of the selected stroked paths (start / end / both) in the chosen style
   *  (triangle / circle / square / bar). */
  addArrowheads(s: ArtisanStore, end: ArrowEnd = "end", style: ArrowheadStyle = "triangle") {
    const ids = sel(s);
    if (!ids.length) return;
    let newIds: ID[] = [];
    s.transact("Add Arrowheads", (d) => {
      newIds = Ops.Arrowheads.addArrowheads(d, ids, end, style);
    });
    if (newIds.length) s.setSelection(newIds);
  },

  /** Object ▸ Expand — convert live shapes to editable paths and outline strokes
   *  on the selection (recursing into groups). */
  expand(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    let newIds: ID[] = [];
    s.transact("Expand", (d) => {
      newIds = Ops.PathEdit.expand(d, ids);
    });
    if (newIds.length) s.setSelection(newIds);
  },

  /** Edit ▸ Find and Replace — replace every occurrence across the document's type
   *  objects (or the selection when `scoped`). Returns the number replaced. */
  findAndReplace(s: ArtisanStore, opts: FindReplaceOptions & { scoped?: boolean }): number {
    if (!opts.find) return 0;
    const ids = opts.scoped ? sel(s) : undefined;
    let replaced = 0;
    s.transact("Find and Replace", (d) => {
      replaced = Ops.FindReplace.replaceAll(d, { ...opts, ids });
    });
    return replaced;
  },

  /** Edit ▸ Find and Replace ▸ Find — select every type object containing the
   *  needle, so the next Find lands you on the artwork. */
  findText(s: ArtisanStore, opts: FindReplaceOptions): ID[] {
    const found = Ops.FindReplace.findMatches(s.doc, opts).map((m) => m.id);
    s.setSelection(found);
    return found;
  },

  /** Object ▸ Expand Appearance — flatten each selected object's appearance stack
   *  (multiple fills / strokes, entry effects) into one real object per entry. */
  expandAppearance(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    let newIds: ID[] = [];
    s.transact("Expand Appearance", (d) => {
      newIds = Ops.PathEdit.expandAppearance(d, ids);
    });
    if (newIds.length) s.setSelection(newIds);
  },

  addAnchorPoints(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Add Anchor Points", (d) => {
      Ops.PathEdit.addAnchorPoints(d, ids);
    });
  },

  /** Object ▸ Path ▸ Remove Anchor Points — delete the Direct-Selection-selected
   *  anchors, keeping each path connected (same as ⌫ on selected anchors). A path
   *  left with fewer than 2 anchors is removed. */
  removeAnchorPoints(s: ArtisanStore) {
    const anchorSel = s.getState().anchorSelection;
    const ids = Object.keys(anchorSel).filter((id) => anchorSel[id]?.length);
    if (!ids.length) return;
    s.transact("Remove Anchor Points", (d) => {
      for (const id of ids) Ops.PathEdit.deleteAnchors(d, id, anchorSel[id]);
    });
    s.setAnchorSelection({}); // the old indices no longer map after deletion
  },

  /** Object ▸ Path ▸ Convert to Corner / Smooth — batch-convert the Direct-Selection
   *  anchor set (Illustrator's Control/Properties "Convert" buttons). Keeps the same
   *  anchors selected. No-op (no undo, no dirty) when nothing would change. */
  convertAnchorPoints(s: ArtisanStore, target: Ops.PathEdit.AnchorConvert) {
    const anchorSel = s.getState().anchorSelection;
    if (!Ops.PathEdit.anchorsNeedConvert(s.doc, anchorSel, target)) return;
    s.transact(target === "corner" ? "Convert to Corner" : "Convert to Smooth", (d) => {
      Ops.PathEdit.convertAnchors(d, anchorSel, target);
    });
  },

  /** Object ▸ Path ▸ Offset Path — create an offset copy of each selected object.
   *  Defaults match Illustrator's Offset Path dialog (10 px, Miter join, miter
   *  limit 4); pass `opts` to override distance / join / miterLimit. */
  offsetPath(s: ArtisanStore, opts: Partial<OffsetPathOptions> = {}) {
    const ids = sel(s);
    if (!ids.length) return;
    const params: OffsetPathOptions = {
      distance: opts.distance ?? 10,
      join: opts.join ?? "miter",
      miterLimit: opts.miterLimit ?? 4,
    };
    let newIds: ID[] = [];
    s.transact("Offset Path", (d) => {
      newIds = Ops.OffsetPath.offsetPath(d, ids, params);
    });
    if (newIds.length) s.setSelection(newIds);
  },

  /** Object ▸ Path ▸ Round Corners — round each selected object's sharp corners
   *  into circular-arc fillets of `radius` (default 10, Illustrator's default). */
  roundCorners(s: ArtisanStore, radius = 10) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Round Corners", (d) => {
      Ops.RoundCorners.roundCorners(d, ids, radius);
    });
  },

  /** Object ▸ Path ▸ Zig Zag — distort the selection into a zig-zag (Corner) or
   *  wave (Smooth). Defaults: size 10, 4 ridges per segment, sharp corners. */
  zigZag(s: ArtisanStore, opts: Partial<ZigZagOptions> = {}) {
    const ids = sel(s);
    if (!ids.length) return;
    const params: ZigZagOptions = { size: opts.size ?? 10, ridges: opts.ridges ?? 4, smooth: opts.smooth ?? false };
    s.transact("Zig Zag", (d) => {
      Ops.ZigZag.zigZag(d, ids, params);
    });
  },

  /** Effect ▸ Warp ▸ Arc / Arc Lower / Arc Upper — bend the selection along a
   *  parabolic arc. Default bend +50%. */
  warp(s: ArtisanStore, style: WarpStyle = "arc", opts: Partial<WarpOptions> = {}) {
    const ids = sel(s);
    if (!ids.length) return;
    const params: WarpOptions = { style, bend: opts.bend ?? 0.5 };
    const label = { arc: "Warp: Arc", "arc-lower": "Warp: Arc Lower", "arc-upper": "Warp: Arc Upper", flag: "Warp: Flag", wave: "Warp: Wave", bulge: "Warp: Bulge", rise: "Warp: Rise" }[style];
    s.transact(label, (d) => {
      Ops.Warp.warp(d, ids, params);
    });
  },

  /** Object ▸ Path ▸ Split Into Grid — replace each selected object with a grid
   *  of rectangular cells (default 2×2, no gutters). */
  splitIntoGrid(s: ArtisanStore, opts: Partial<SplitGridOptions> = {}) {
    const ids = sel(s);
    if (!ids.length) return;
    const params: SplitGridOptions = {
      rows: opts.rows ?? 2,
      columns: opts.columns ?? 2,
      rowGutter: opts.rowGutter ?? 0,
      columnGutter: opts.columnGutter ?? 0,
    };
    let newIds: ID[] = [];
    s.transact("Split Into Grid", (d) => {
      newIds = Ops.SplitGrid.splitIntoGrid(d, ids, params);
    });
    if (newIds.length) s.setSelection(newIds);
  },

  /** Object ▸ Path ▸ Simplify — reduce the anchor count of each selected path
   *  within `tolerance` (default 2), keeping the shape. */
  simplify(s: ArtisanStore, tolerance = 2) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Simplify", (d) => {
      Ops.Simplify.simplify(d, ids, { tolerance });
    });
  },

  /** Object ▸ Path ▸ Reverse Path Direction — flip the direction of each selected
   *  path (and compound subpath). */
  reversePath(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    s.transact("Reverse Path Direction", (d) => {
      Ops.ReversePath.reversePath(d, ids);
    });
  },

  average(s: ArtisanStore, axis: AverageAxis) {
    const anchorSel = s.getState().anchorSelection;
    const total = Object.values(anchorSel).reduce((n, a) => n + a.length, 0);
    if (total < 2) return;
    s.transact("Average", (d) => {
      Ops.PathEdit.averageAnchors(d, anchorSel, axis);
    });
  },

  makeCompoundPath(s: ArtisanStore) {
    const ids = sel(s);
    if (ids.length < 2) return;
    let nid: ID | null = null;
    s.transact("Make Compound Path", (d) => {
      nid = Ops.PathEdit.makeCompoundPath(d, ids);
    });
    if (nid) s.setSelection([nid]);
  },

  releaseCompoundPath(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    let newIds: ID[] = [];
    s.transact("Release Compound Path", (d) => {
      newIds = Ops.PathEdit.releaseCompoundPath(d, ids);
    });
    if (newIds.length) s.setSelection(newIds);
  },

  pathfinder(s: ArtisanStore, op: PathfinderOp) {
    const ids = sel(s);
    if (ids.length < 2) return;
    let nid: ID | null = null;
    s.transact(`Pathfinder ${op}`, (d) => {
      nid = Ops.Pathfinder.pathfinder(d, ids, op);
    });
    if (nid) s.setSelection([nid]);
  },

  /** Object ▸ Path ▸ Divide Objects Below — use the single selected object as a
   *  cookie-cutter, splitting every object beneath it and removing the cutter. */
  divideObjectsBelow(s: ArtisanStore) {
    const ids = sel(s);
    if (ids.length !== 1) return;
    let pieces: ID[] = [];
    s.transact("Divide Objects Below", (d) => {
      pieces = Ops.Pathfinder.divideObjectsBelow(d, ids[0]);
    });
    if (pieces.length) s.setSelection(pieces);
  },

  /** Object ▸ Blend ▸ Make — interpolate intermediate shapes between the selected
   *  objects (≥2) and group them as a Blend. `opts.steps` sets the step count. */
  blend(s: ArtisanStore, opts: BlendOptions = {}) {
    const ids = sel(s);
    if (ids.length < 2) return;
    let gid: ID | null = null;
    s.transact("Blend", (d) => {
      gid = Ops.Blend.blend(d, ids, opts);
    });
    if (gid) s.setSelection([gid]);
  },
  /** Object ▸ Blend ▸ Release — restore a blend's original key objects, dropping
   *  the interpolated steps. */
  releaseBlend(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    let restored: ID[] = [];
    s.transact("Release Blend", (d) => {
      restored = Ops.Blend.releaseBlend(d, ids);
    });
    if (restored.length) s.setSelection(restored);
  },
  /** Object ▸ Blend ▸ Reverse Front to Back — flip the paint order of the objects
   *  inside the selected blend(s). No-op (no undo / dirty) without a blend selected. */
  reverseBlendFrontToBack(s: ArtisanStore) {
    if (!selectionHasBlend(s)) return;
    const ids = sel(s);
    s.transact("Reverse Front to Back", (d) => {
      Ops.Blend.reverseBlendFrontToBack(d, ids);
    });
  },
  /** Object ▸ Blend ▸ Blend Options — re-space the selected blend(s) with Smooth Color
   *  (auto step count from colour distance) or a specified step count. No-op (no undo /
   *  dirty) without a blend selected. */
  blendOptions(s: ArtisanStore, spacing: BlendSpacing) {
    if (!selectionHasBlend(s)) return;
    const ids = sel(s);
    s.transact("Blend Options", (d) => {
      Ops.Blend.reblend(d, ids, spacing);
    });
  },
  /** Object ▸ Rasterize — replace the selected vector artwork with an embedded PNG
   *  image at its bounds (rendered via canvas). No-op without a selection; if
   *  rasterization is unavailable (e.g. no canvas) the artwork is left untouched. */
  async rasterize(s: ArtisanStore, scale = 2) {
    const ids = sel(s);
    if (!ids.length) return;
    const doc = s.getState().doc;
    const bounds = Query.selectionBounds(doc, ids);
    if (!bounds) return;
    const svg = Ops.Rasterize.selectionToSvg(doc, ids, bounds);
    let href: string;
    try {
      href = await svgToPngDataURL(svg, bounds.width, bounds.height, scale);
    } catch {
      return; // rasterization unavailable — leave the artwork untouched
    }
    let gid: ID | null = null;
    s.transact("Rasterize", (d) => {
      gid = Ops.Rasterize.rasterize(d, ids, href, scale);
    });
    if (gid) s.setSelection([gid]);
  },

  zoomIn: (s: ArtisanStore) => zoomKeepCenter(s, s.getState().view.zoom * 1.25),
  zoomOut: (s: ArtisanStore) => zoomKeepCenter(s, s.getState().view.zoom / 1.25),
  zoomActual: (s: ArtisanStore) => zoomKeepCenter(s, 1),
  resetRotation: (s: ArtisanStore) => s.setView({ angle: 0 }),
  zoomFit(s: ArtisanStore) {
    const { viewport } = s.getState();
    const ab = s.doc.artboards[s.doc.activeArtboard] ?? s.doc.artboards[0];
    if (!ab) return;
    const z = clampZoom(Math.min((viewport.width * 0.85) / ab.width, (viewport.height * 0.85) / ab.height));
    s.setView({ zoom: z, tx: viewport.width / 2 - (ab.x + ab.width / 2) * z, ty: viewport.height / 2 - (ab.y + ab.height / 2) * z });
  },

  /** View ▸ Fit All in Window (⌥⌘0) — frame the union of every artboard, centred.
   *  With a single artboard this matches Fit Artboard. */
  zoomFitAll(s: ArtisanStore) {
    const { viewport } = s.getState();
    const boards = s.doc.artboards;
    if (!boards.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ab of boards) {
      minX = Math.min(minX, ab.x);
      minY = Math.min(minY, ab.y);
      maxX = Math.max(maxX, ab.x + ab.width);
      maxY = Math.max(maxY, ab.y + ab.height);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (w <= 0 || h <= 0) return;
    const z = clampZoom(Math.min((viewport.width * 0.85) / w, (viewport.height * 0.85) / h));
    s.setView({ zoom: z, tx: viewport.width / 2 - (minX + w / 2) * z, ty: viewport.height / 2 - (minY + h / 2) * z });
  },

  toggleRulers: (s: ArtisanStore) => s.setRulers(!s.getState().rulers),
  toggleGrid: (s: ArtisanStore) => s.patchGrid({ show: !s.getState().grid.show }),
  toggleOutline: (s: ArtisanStore) => s.setOutlineMode(!s.getState().outlineMode),
  toggleTrimView: (s: ArtisanStore) => s.setTrimView(!s.getState().trimView),
  toggleHideEdges: (s: ArtisanStore) => s.setHideEdges(!s.getState().hideEdges),
  /** View ▸ Hide/Show Bounding Box (⇧⌘B) — toggle the selection's transform box. */
  toggleBoundingBox: (s: ArtisanStore) => s.setShowBoundingBox(!s.getState().showBoundingBox),
  /** View ▸ Show/Hide Transparency Grid (⇧⌘D) — checkerboard behind the artwork. */
  toggleTransparencyGrid: (s: ArtisanStore) => s.setTransparencyGrid(!s.getState().transparencyGrid),
  /** Toolbar drawing mode — where the creation tools place new art. */
  setDrawingMode: (s: ArtisanStore, mode: DrawingMode) => s.setDrawingMode(mode),
  cycleDrawingMode: (s: ArtisanStore) => {
    const m = s.getState().drawingMode;
    s.setDrawingMode(m === "normal" ? "behind" : m === "behind" ? "inside" : "normal");
  },
  toggleGuides: (s: ArtisanStore) => s.setShowGuides(!s.getState().showGuides),
  clearGuides: (s: ArtisanStore) => s.clearGuides(),

  /** View ▸ Guides ▸ Make Guides — add H/V guides at each selected object's
   *  bounding-box edges (deduped against existing). Artisan's guides are H/V ruler
   *  lines kept separate from the art and non-undoable, so this adds guides without
   *  removing the objects. No-op with an empty selection. */
  makeGuides(s: ArtisanStore) {
    const ids = sel(s);
    if (!ids.length) return;
    const guides = [...s.getState().guides];
    const seen = new Set(guides.map((g) => `${g.orientation}:${g.pos}`));
    for (const id of ids) {
      const b = Query.worldBounds(s.doc, id);
      if (!b) continue;
      for (const g of boundsToGuides(b)) {
        const key = `${g.orientation}:${g.pos}`;
        if (!seen.has(key)) {
          seen.add(key);
          guides.push({ id: newId("gd"), orientation: g.orientation, pos: g.pos });
        }
      }
    }
    if (guides.length !== s.getState().guides.length) s.setGuides(guides);
  },
  toggleSnap: (s: ArtisanStore) => s.patchSnap({ enabled: !s.getState().snap.enabled }),
  toggleSnapGrid: (s: ArtisanStore) => s.patchSnap({ toGrid: !s.getState().snap.toGrid }),
  /** View ▸ Snap to Pixel — round drawing/dragging to whole document units. */
  toggleSnapPixel: (s: ArtisanStore) => s.patchSnap({ toPixel: !s.getState().snap.toPixel }),
  toggleSmartGuides: (s: ArtisanStore) => {
    const on = !s.getState().snap.toPoint; // Smart Guides = snap to anchors AND object edges
    s.patchSnap({ toPoint: on, toObject: on });
  },
};

const mutateArrange = (s: ArtisanStore, label: string, fn: (d: import("./engine").Document, ids: ID[]) => void) => {
  const ids = sel(s);
  if (!ids.length) return;
  s.transact(label, (d) => fn(d, ids));
};

const transformAroundCenter = (
  s: ArtisanStore,
  label: string,
  fn: (d: import("./engine").Document, ids: ID[], center: { x: number; y: number }) => void,
  record?: TransformOp,
) => {
  const ids = sel(s);
  if (!ids.length) return;
  const b = Query.selectionBounds(s.doc, ids);
  if (!b) return;
  const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  s.transact(label, (d) => fn(d, ids, center));
  if (record) s.setLastTransform(record); // remembered for Transform Again
};

export const hasClipboard = (): boolean => clipboard.length > 0;

export const selectionHasClipGroup = (s: ArtisanStore): boolean =>
  s.getState().selection.some((id) => {
    const it = Query.findItem(s.doc, id)?.item;
    return it?.type === "group" && it.clip === true;
  });

export const selectionHasCompound = (s: ArtisanStore): boolean =>
  s.getState().selection.some((id) => Query.findItem(s.doc, id)?.item.type === "compound");

export const selectionHasBlend = (s: ArtisanStore): boolean =>
  s.getState().selection.some((id) => {
    const it = Query.findItem(s.doc, id)?.item;
    return it?.type === "group" && !!it.blendKeyIds?.length;
  });

export const selectionHasLivePaint = (s: ArtisanStore): boolean =>
  s.getState().selection.some((id) => {
    const it = Query.findItem(s.doc, id)?.item;
    return it?.type === "group" && !!it.livePaint;
  });

export const selectionHasPerspective = (s: ArtisanStore): boolean =>
  s.getState().selection.some((id) => {
    const it = Query.findItem(s.doc, id)?.item;
    return it?.type === "group" && !!it.perspective;
  });

export const selectionHasEnvelope = (s: ArtisanStore): boolean =>
  s.getState().selection.some((id) => {
    const it = Query.findItem(s.doc, id)?.item;
    return it?.type === "group" && !!it.envelope;
  });

/** Order swatches by colour: solids by hue → saturation → value, then non-solid
 *  paints (gradient / none) in their original relative order. Returns a new array
 *  of the same paint values (Array.sort is stable, so equal keys keep order). */
export const sortPaintsByHue = (paints: Paint[]): Paint[] =>
  [...paints].sort((a, b) => {
    const ka = a.type === "solid" ? rgbToHsv(a.color) : null;
    const kb = b.type === "solid" ? rgbToHsv(b.color) : null;
    if (ka && kb) return ka.h - kb.h || ka.s - kb.s || ka.v - kb.v;
    if (ka) return -1; // solids sort before non-solids
    if (kb) return 1;
    return 0; // two non-solids: keep their relative order
  });

/** The four edge guides for a bounding box (verticals at the left/right x, horizontals
 *  at the top/bottom y), collapsing a zero-width/height box to one guide on that axis. */
export const boundsToGuides = (b: Rect): { orientation: "h" | "v"; pos: number }[] => {
  const xs = b.width === 0 ? [b.x] : [b.x, b.x + b.width];
  const ys = b.height === 0 ? [b.y] : [b.y, b.y + b.height];
  return [
    ...xs.map((x) => ({ orientation: "v" as const, pos: x })),
    ...ys.map((y) => ({ orientation: "h" as const, pos: y })),
  ];
};

export const selectionHasText = (s: ArtisanStore): boolean =>
  Query.selectionLeaves(s.doc, s.getState().selection).some((item) => item.type === "text");

/** Plain point text (auto-width, no box, not on a path) — eligible for Convert to Area Type. */
export const selectionHasPointText = (s: ArtisanStore): boolean =>
  Query.selectionLeaves(s.doc, s.getState().selection).some(
    (item) => item.type === "text" && item.boxWidth == null && item.boxHeight == null && item.pathD == null,
  );

/** Boxed area text (not on a path) — eligible for Convert to Point Type. */
export const selectionHasAreaText = (s: ArtisanStore): boolean =>
  Query.selectionLeaves(s.doc, s.getState().selection).some(
    (item) => item.type === "text" && (item.boxWidth != null || item.boxHeight != null) && item.pathD == null,
  );

export const selectionHasMask = (s: ArtisanStore): boolean =>
  s.getState().selection.some((id) => !!Query.findItem(s.doc, id)?.item.mask?.length);

export const hasLockedItems = (s: ArtisanStore): boolean => {
  let found = false;
  Query.eachItem(s.doc, (item) => {
    if (item.locked) {
      found = true;
      return false;
    }
  });
  return found;
};

export const hasHiddenItems = (s: ArtisanStore): boolean => {
  let found = false;
  Query.eachItem(s.doc, (item) => {
    if (!item.visible) {
      found = true;
      return false;
    }
  });
  return found;
};
