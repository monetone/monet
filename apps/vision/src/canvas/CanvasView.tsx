// ─────────────────────────────────────────────────────────────
// CanvasView — the document viewport. Blits the engine's composited
// output, routes pointer events to the active tool, handles zoom/pan,
// draws animated selection "marching ants" and the brush cursor.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { I, isDropdownOpen, isEditableTarget, rgbToHsv } from "@monet-ui/monet-react";
import { CollabCursors } from "@monet-ui/monet-collab/react";
import { actions, anim, collab, engine, store, useStore, text, xform, contentAwareMoveBy, removeStroke, beginContentAwareMoveDrop, updateContentAwareMoveDrop, commitContentAwareMoveDrop, cancelContentAwareMoveDrop } from "../state/app";
import { PuppetWarpOverlay } from "./PuppetWarpOverlay";
import {
  hsvToRgba, blendIndex, lineShapeItems, shapeBBoxItem, shapeOutlineVerts,
  selectionFrameQuad, selectionFrameHandles, scaleSelectionFrame, skewSelectionFrame, rotateSelectionFrame, viewOf,
  type AppSnapshot, type SelectionTransformSession, type ToolId,
} from "../state/store";
import { docPointAt, viewCss } from "../state/viewTransform";
import { antsCache, drawAnts } from "./ants";
import type { HandlePt, PathTransform } from "../state/transformControls";
import { LAYER_KIND } from "../state/engineContracts";
import { isBrushTipCursor } from "../state/preferencePanes";
import { TOOL_DEFS } from "../state/toolRail";
import { cssFont, variationSettings } from "../text/spec";
import { caretIndexAt, pointTypeCaretXs } from "../text/raster";
import { nearestSamplerIndex } from "@monet-ui/monet-color";
import { nearestNoteIndex } from "../state/notes";
import { denormalizePath } from "../state/customShapes";
import { polygonVertices } from "../state/polygonShape";
import { lineQuad } from "../state/lineShape";
import { arrowheadPolygon } from "../state/arrowhead";
import { roundedRectVertices } from "../state/roundRectShape";
import { strokeRingRects } from "../state/shapeStroke";
import { redEyeArgs } from "../state/redEye";
import { smoothStrokePoint } from "../state/brushSmoothing";
import { catmullRomAnchors, catmullRomResample } from "../state/pathSmooth";
import { ANCHOR_STRIDE, flattenAnchorPath, hasAnchorForm, pullAnchorHandles, WORK_PATH_ITEM } from "../state/paths";
import { axisSnapTargets, snapValue } from "../state/snapTargets";
import { featherActive } from "../state/selectionFeather";
import { aspectRatioFor, fitRectToAspect } from "../state/cropAspect";
import { singleRowRect, singleColumnRect } from "../state/lineMarquee";
import { fixedRatioRect, fixedSizeRect } from "../state/marqueeStyle";
import { frameIsValid } from "../state/frameTool";
import { overlayLines } from "../state/cropOverlay";
import { fillZoom, fitOrientedView, orientedDocSize } from "../state/zoomPresets";
import { quickMaskPixel } from "../state/quickMaskOverlay";
import { selectionPreviewPixel } from "../state/selectionPreview";
import { nearPoint, canClose, polygonArrays } from "../state/polyLasso";
import { hitTestSlice, hitTestHandle, moveSliceBy, resizeSliceTo, sliceHandles, type Slice } from "../state/slices";
import {
  artboardRect, artboardDragIsValid, hitTestArtboard, hitTestArtboardHandle,
  moveArtboardBy, resizeArtboardTo, artboardHandles,
} from "../state/artboardTool";
import { smartSnap, type Rect } from "./smartGuides";
import { typeBoxFromDrag, isOverset, TYPE_BOX_CURSORS } from "./typeBox";
import {
  hitPlaneEdge, hitPlaneHandle, movePlaneHandle, planeAt, shiftRect, uvAt, uvInRect, uvRectQuad, warpQuadToQuad,
  type VanishingPlane, type VanishingRect,
} from "./vanishingPoint";
import { cloneOverlayMatrix, isIdentityCloneTransform } from "../state/cloneSample";
import {
  vectorPathsFromSceneJson, pathOutlineD, anchorsInRect, anchorOrigins, toggleAnchor, anchorKey,
  workPathOverlays, type AnchorRef,
} from "./vectorPathOverlay";

// Airbrush build-up needs a stationary stamp: `stroke_to` only dabs once the
// pointer has travelled a spacing's worth. Just the slice of the engine the
// build-up tick uses, so it can be exercised without a wasm instance.
export type AirbrushEngine = {
  stroke_dab(x: number, y: number, pressure: number): Int32Array;
};

/** Smallest brush-tip outline (screen px) still drawn as a ring. */
const MIN_BRUSH_TIP_PX = 6;

/** The painting tools Preferences ▸ Cursors ▸ Painting Cursors applies to. */
const PAINTING_TOOLS = new Set<ToolId>(["brush", "pencil", "erase", "backgrounderaser", "clone", "vanishingpoint", "heal", "spothealing", "remove", "adjustmentbrush", "dodge", "burn", "sponge", "smudge", "liquify", "blur", "sharpen", "mixerbrush", "historybrush"]);

/** On-screen diameter of the brush-tip outline, or 0 when the tool or the
 *  Painting Cursors choice draws none. Full Size rings the whole footprint;
 *  Normal rings the part a dab paints at 50% or more. The engine's
 *  smootherstep falloff crosses 0.5 halfway through the soft edge, which starts
 *  at `hardness` × the radius, so that is (1 + hardness) / 2 of the size. */
export function brushTipDiameter(
  tool: ToolId,
  s: Pick<AppSnapshot, "showBrushPreview" | "cursorPrefs" | "brush" | "liquify" | "eraserMode" | "zoom">,
): number {
  if (!s.showBrushPreview || !PAINTING_TOOLS.has(tool) || !isBrushTipCursor(s.cursorPrefs.painting)) return 0;
  const size = tool === "liquify" ? s.liquify.size : s.brush.size;
  if (s.cursorPrefs.painting === "full") return size * s.zoom;
  // Pencil and the Eraser's Pencil/Block modes paint hard whatever the Hardness
  // (store.pushBrush); Liquify's Density is its falloff hardness.
  const hardness = tool === "liquify" ? s.liquify.density
    : tool === "pencil" || (tool === "erase" && s.eraserMode !== "brush") ? 1 : s.brush.hardness;
  return size * s.zoom * (1 + hardness) / 2;
}

/** Standard cursor: the tool's own toolbar icon, outlined so it reads on any
 *  pixels. ponytail: hotspot is the icon centre, not the tool's tip; give
 *  TOOL_DEFS a per-icon hotspot if that ever reads as off. */
function toolIconCursor(tool: ToolId): string {
  const icon = TOOL_DEFS[tool]?.icon;
  if (!icon) return "default";
  const d = I[icon as keyof typeof I] ?? icon;
  const stroke = (color: string, width: number) =>
    `<path d='${d}' fill='none' stroke='${color}' stroke-width='${width}' stroke-linecap='round' stroke-linejoin='round'/>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='-2 -2 20 20'>${stroke("black", 3)}${stroke("white", 1.3)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, default`;
}

type PerspectiveCloneEngine = {
  set_clone_perspective(
    enabled: boolean,
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    srcX: number, srcY: number,
    dstX: number, dstY: number,
  ): boolean;
};

interface DragState {
  mode: ToolId;
  // Set only when WASM accepts stroke_begin(). Pointer cancellation pairs that
  // active transaction with stroke_end instead of inferring from the selected tool
  // (Vanishing Point also drags plane handles without beginning a paint stroke).
  strokeActive?: boolean;
  sx: number;
  sy: number;
  lx: number;
  ly: number;
  // Liquify: last-known pointer pressure, for the Brush Rate repeat timer
  // (which has no pointer event of its own to read pressure from).
  pressure?: number;
  panX0: number;
  panY0: number;
  clientX0: number;
  clientY0: number;
  layerId: number;
  shift: boolean;
  alt: boolean;
  // Move tool with an active selection: float the selection instead of the whole
  // layer. selBounds = the selection's doc-space bbox, for the drag preview.
  selMove: boolean;
  selBounds: number[] | null;
  // Color Sampler tool: index of the sample point being dragged (set when a
  // pointerdown lands on an existing sampler), else undefined.
  samplerIdx?: number;
  // Note tool: id of the note being dragged (set when a pointerdown lands on an
  // existing note icon), else undefined.
  noteId?: number;
  // Slice Select tool: the slice index being dragged, how it's edited
  // (sliceHandle -1 = move the body, 0..7 = resize that handle), and its geometry
  // at drag start so the edit stays absolute (drift-free across move events).
  sliceIdx?: number;
  sliceHandle?: number;
  sliceOrig?: Slice;
  // Artboard tool: the artboard id being dragged, how it's edited (artboardHandle
  // -1 = move the body, 0..7 = resize that handle), and its bounds at drag start
  // (absolute, drift-free). Absent for a create-drag (a rubber-band on empty
  // canvas); the projected bounds preview live in `preview`, committed on release.
  artboardId?: number;
  artboardHandle?: number;
  artboardOrig?: { x: number; y: number; w: number; h: number };
  // Vanishing Point: a root plane corner being dragged, an edge being torn off
  // (⌘/Ctrl-drag), a perspective marquee being drawn from its plane-uv anchor, or
  // the marquee / float being moved from its rectangle at drag start.
  vpHandle?: { plane: number; handle: number };
  vpTearOff?: { plane: number; edge: number };
  vpMarquee?: { plane: number; u: number; v: number };
  vpMove?: { kind: "marquee" | "float"; u: number; v: number; orig: VanishingRect };
  // Direct Selection: the world position of every selected anchor at drag start,
  // so the whole set moves by ONE delta (absolute, drift-free). Empty while the
  // drag is a rubber-band over empty canvas instead (`anchorMarquee`).
  anchorOrigins?: { item: string; index: number; x: number; y: number }[];
  anchorMarquee?: boolean;
  // Direct Selection grabbed a direction-handle end instead of an anchor; the
  // drag reshapes the curve through dragSelectedHandle. Mirror is latched at
  // grab (Alt breaks the opposite-handle pairing, Photoshop-style).
  handleDrag?: boolean;
  handleMirror?: boolean;
  // Pen: index of the anchor just dropped by this click. While the pointer is
  // down, motion pulls that anchor's direction handles (Photoshop's click-drag).
  penAnchor?: number;
  // Image ▸ Transform Symmetry: drag the path centre or its outer similarity
  // handle (polar motion rotates while radial motion scales uniformly).
  symmetryPath?: { x: number; y: number };
  symmetryOuter?: {
    axisX: number;
    axisY: number;
    startAngle: number;
    startScale: number;
    pointerAngle: number;
    pointerDistance: number;
  };
}

interface PreviewRect {
  kind: "rect" | "ellipse" | "line";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  crop?: boolean; // crop drag: render the composition overlay guides inside the rect
  lineShape?: boolean; // pointer-down was Shape ▸ Line; stable if a tool shortcut fires mid-drag
  clipToDocument?: boolean; // fixed-size selection: hide the off-canvas outline
}

/** The document viewport. With `paneDocId` it is a Window ▸ Arrange pane: a
 *  second view of that document with its own zoom, pan and rotation, driving
 *  the same tools. While that document is not the active one the pane shows its
 *  last composite, and a click activates it before the tool applies.
 *  `floatHost` makes the pane the unseen stand-in for a float window (#477):
 *  it hosts the editors a full editing surface needs (text, transform frames)
 *  but draws no pixels or ants itself — the float window does, from the frames
 *  and the boundary (`onBoundary`) it is sent. */
export function CanvasView({ paneDocId, floatHost = false, onBoundary, onOverlay }: {
  paneDocId?: number;
  floatHost?: boolean;
  onBoundary?: (pts: Int32Array) => void;
  onOverlay?: () => void;
}) {
  const isPane = paneDocId !== undefined;
  const editors = !isPane || floatHost;
  const passive = useStore((s) => isPane && s.activeDocId !== paneDocId);
  const viewportRef = useRef<HTMLDivElement>(null);
  // A Transform On Drop preview holds an open history transaction. Settle it
  // before any click outside the canvas (a panel, the toolbar, a document tab)
  // reaches its target, so that action cannot land inside the preview and be
  // rolled back with it. Canvas clicks commit in onPointerDown; the keyboard,
  // the native menu and MCP are already gated while a transaction is open.
  const camDropOpen = useStore((s) => s.camDrop !== null);
  useEffect(() => {
    if (!camDropOpen) return;
    const onDown = (e: Event) => { if (!(e.target as Element).closest?.(".mv-canvas-viewport")) commitContentAwareMoveDrop(); };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [camDropOpen]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const patternCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const cursorPointerRef = useRef<{ x: number; y: number; buttons: number; capsLock: boolean } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const boundaryRef = useRef<Int32Array>(new Int32Array(0));
  const antsRef = useRef(antsCache());
  // Quick Mask rubylith overlay: a non-interactive canvas + one cached full-size
  // ImageData (rebuilt on resize), updated per dirty rect during strokes — the
  // marching-ants caching discipline applied to a static (non-animated) overlay.
  const qmOverlayRef = useRef<HTMLCanvasElement>(null);
  const qmImgRef = useRef<ImageData | null>(null);
  const maskViewOverlayRef = useRef<HTMLCanvasElement>(null);
  const selPreviewOverlayRef = useRef<HTMLCanvasElement>(null);
  const selPreviewImgRef = useRef<ImageData | null>(null);
  const maskViewImgRef = useRef<ImageData | null>(null);
  const lqBackdropOverlayRef = useRef<HTMLCanvasElement>(null);
  const lqBackdropImgRef = useRef<ImageData | null>(null);
  const lqMaskOverlayRef = useRef<HTMLCanvasElement>(null);
  const lqMaskImgRef = useRef<ImageData | null>(null);
  const lqMeshOverlayRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(0);
  const rafRef = useRef(0);
  // Move-tool drag is coalesced to one composite+blit per animation frame, and
  // only repaints the moved layer's footprint (see EngineClient + the engine's
  // move_layer_offset). Without this, every pointermove did a full-canvas
  // composite + putImageData → ~2 fps when dragging on a large document.
  const moveRafRef = useRef(0);
  const pendingMoveRef = useRef<{ dx: number; dy: number } | null>(null);
  // The offset this drag last handed to the engine. Smart-guide snapping means
  // it is NOT the raw pointer delta, and the flushed frame nulls the pending
  // one, so release has to read what was applied instead of recomputing it (#5).
  const appliedMoveRef = useRef<{ dx: number; dy: number } | null>(null);
  // Liquify Brush Rate: while the pointer is held down (moving or not), repeat
  // a stationary dab at the last-known point so Rate > 0 behaves like Photoshop's
  // "apply while held still". MUST be cleared on pointer-up/cancel, tool change,
  // document switch, and unmount — a leaked interval keeps warping the document
  // after the user lets go. See the cleanup effect below and both pointer-end
  // handlers, which all call clearLiquifyRateTimer unconditionally.
  const liquifyRateTimerRef = useRef(0);
  // Airbrush build-up: the paint-family twin of the Rate timer, with the same
  // leak hazard and the same unconditional-clear discipline.
  const airbrushTimerRef = useRef(0);
  // Smart Guides: cached static bounds for the current move drag + the live lines.
  const smartBoundsRef = useRef<{ active: Rect; others: Rect[] } | null>(null);
  const [smartGuides, setSmartGuides] = useState<{ o: "v" | "h"; p: number; from: number; to: number }[]>([]);

  const [preview, setPreview] = useState<PreviewRect | null>(null);
  const [lasso, setLasso] = useState<number[] | null>(null);
  const lassoRef = useRef<number[]>([]);
  const spotHealPtsRef = useRef<number[]>([]); // Spot Healing: accumulated dab centers for the current stroke
  // Last painted brush point (doc space) — Shift-clicking the brush draws a
  // straight line from here to the click (Photoshop). Cleared on document swap.
  const lastBrushPtRef = useRef<{ x: number; y: number } | null>(null);
  // Brush "Smoothing": the eased ("pulled") point the stroke is currently drawing
  // toward. Anchored on a brush-down, advanced per move, cleared on stroke end.
  const smoothPtRef = useRef<{ x: number; y: number } | null>(null);
  // The destination anchor for the Clone Stamp's "Aligned" mode. Set on the
  // first stroke after a source is sampled and reused for every later stroke, so
  // the source point follows the brush continuously; cleared when the active
  // Clone Source slot's source, the slot itself or the document changes.
  const cloneAnchorRef = useRef<{ x: number; y: number } | null>(null);
  // Clone Source ▸ Show Overlay: the doc-space overlay and its captured source.
  const cloneOverlayRef = useRef<HTMLCanvasElement>(null);
  const cloneOverlayImgRef = useRef<HTMLCanvasElement | null>(null);
  const [penPts, setPenPts] = useState<number[] | null>(null);
  const penRef = useRef<number[]>([]);
  // Pen: the work path in its BEZIER form (AnchorPath, 6 floats per anchor with
  // relative handles — see state/paths.ts). `penRef` stays its flattening, so
  // every polyline consumer (preview, fill, rubber band) is unchanged. Only the
  // Pen authors it; the freeform/curvature pens fit their anchors on commit.
  const penAnchorRef = useRef<number[]>([]);
  const [penAnchorPath, setPenAnchorPath] = useState<number[] | null>(null);
  // Rotate View: the pointer angle (about the content centre) + the view rotation
  // captured at drag start, so the drag rotates the view by the angular delta.
  const rotateStartRef = useRef<{ a: number; rot: number } | null>(null);
  // Polygonal Lasso: clicked vertices (separate from the Pen) + the modifiers
  // sampled at the first click (they set the New/Add/Subtract combine mode).
  const [polyLassoPts, setPolyLassoPts] = useState<number[] | null>(null);
  const polyLassoRef = useRef<number[]>([]);
  const polyLassoModRef = useRef<{ shift: boolean; alt: boolean }>({ shift: false, alt: false });
  // Curvature Pen: discrete CLICKED anchors the smooth curve interpolates through.
  // Unlike the Freeform Pen (one continuous drag), each click drops one anchor and
  // the path re-fits a Catmull-Rom curve through ALL anchors live. Transient —
  // filled on double-click/Enter, discarded on Escape or when leaving the tool.
  const [curveAnchors, setCurveAnchors] = useState<number[] | null>(null);
  const curveRef = useRef<number[]>([]);
  // Direct Selection: every anchor currently selected (shift-click or marquee),
  // and the live rubber band while one is being dragged. The engine only tracks
  // the ONE grabbed anchor (`store.selectedAnchor`); the set is view state.
  const [pathAnchors, setPathAnchors] = useState<AnchorRef[]>([]);
  const [anchorMarquee, setAnchorMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // Bumped whenever an anchor drag mutates the scene, so the overlay re-reads it
  // (an interactive drag is one undo step, so undoDepth alone stays put).
  const [vectorRev, setVectorRev] = useState(0);

  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => viewOf(s, paneDocId).zoom);
  const panX = useStore((s) => viewOf(s, paneDocId).panX);
  const panY = useStore((s) => viewOf(s, paneDocId).panY);
  const rotationAngle = useStore((s) => viewOf(s, paneDocId).rotationAngle); // Rotate View: view-only canvas rotation
  // View ▸ Pixel Aspect Ratio: a display-only horizontal stretch factor.
  const pixelAspect = useStore((s) => s.pixelAspect);
  const pixelAspectCorrection = useStore((s) => s.pixelAspectCorrection);
  const parX = pixelAspectCorrection ? pixelAspect : 1;
  const rulerLine = useStore((s) => s.rulerLine);
  const countPoints = useStore((s) => s.countPoints);
  const showCount = useStore((s) => s.showCount);
  const colorSamplers = useStore((s) => s.colorSamplers);
  const showSamplers = useStore((s) => s.showSamplers);
  const notes = useStore((s) => s.notes);
  const activeNoteId = useStore((s) => s.activeNoteId);
  const showNotes = useStore((s) => s.showNotes);
  const slices = useStore((s) => s.slices);
  const showSlices = useStore((s) => s.showSlices);
  const selectedSlice = useStore((s) => s.selectedSlice);
  const artboards = useStore((s) => s.artboards);
  // View ▸ Pattern Preview: tile the composited canvas edge-to-edge behind the
  // live document, refreshing whole commits and dirty regions during strokes.
  const patternPreview = useStore((s) => s.patternPreview);
  // `doc` is replaced on every engine→store sync, so its identity is the
  // composite generation these overlays need. `undoDepth` is not: it never moves
  // for an edit that pushes no undo state (a layer-visibility toggle, the tail of
  // a coalesced opacity drag — #102), and it stops moving entirely once the undo
  // stack reaches the History States cap, where a run of same-label edits (every
  // brush stroke pushes "Brush") leaves the whole key byte-identical (#171).
  const compositeRev = useStore((s) => s.doc);
  const selectedArtboard = useStore((s) => s.selectedArtboard);
  const spacePan = useStore((s) => s.spacePan);
  const cursorPrefs = useStore((s) => s.cursorPrefs);
  const showBrushPreview = useStore((s) => s.showBrushPreview);
  const [capsLock, setCapsLock] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const on = e.getModifierState?.("CapsLock") === true;
      setCapsLock(on);
      if (cursorPointerRef.current) cursorPointerRef.current.capsLock = on;
      repaintBrushCursor();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cursor repaint reads store and refs fresh
  }, []);
  const showExtras = useStore((s) => s.showExtras);
  const showGrid = useStore((s) => s.showGrid) && showExtras;
  const showPixelGrid = useStore((s) => s.showPixelGrid) && showExtras;
  const showLayerEdges = useStore((s) => s.showLayerEdges) && showExtras;
  const showSmartGuides = useStore((s) => s.showSmartGuides);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const undoDepth = useStore((s) => s.undoDepth);
  const layerEdges = useMemo(
    () => (showLayerEdges ? Array.from(engine.e.active_layer_bounds()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showLayerEdges, activeLayerId, compositeRev],
  );
  const showTransformControls = useStore((s) => s.showTransformControls);
  // Move tool ▸ Show Transform Controls: the active layer's bounding box + handles.
  const xformBox = useMemo(
    () => (tool === "move" && showTransformControls ? Array.from(engine.e.active_layer_bounds()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool, showTransformControls, activeLayerId, compositeRev],
  );
  const showGuides = useStore((s) => s.showGuides) && showExtras;
  const showTargetPath = useStore((s) => s.showTargetPath);
  // Paths panel ▸ work path (Make Work Path / a loaded saved path). Distinct from
  // `penPts`, which is only the in-progress Pen drag.
  const penPath = useStore((s) => s.penPath);
  const penAnchors = useStore((s) => s.penAnchors);
  const penContours = useStore((s) => s.penContours);
  // The path tools are the ones that make a shape layer's geometry editable, so
  // they're the ones that show its outline — Photoshop hides it under a brush.
  const pathToolActive = tool === "directselect" || tool === "pathselect"
    || tool === "pen" || tool === "freeformpen" || tool === "curvaturepen" || tool === "shape";
  // The active vector layer's committed geometry, in document space, after the
  // shown bezier work path (Type ▸ Create Work Path's glyph loops), which Direct
  // Selection edits too and targets first.
  // ponytail: re-parsed per edit; scenes Vision authors are a handful of paths,
  // so an incremental scene cache only pays off once whole `.artisan` imports
  // are being anchor-edited.
  const vectorPaths = useMemo(
    () => [
      ...(tool === "directselect" && showTargetPath && hasAnchorForm(penAnchors) ? workPathOverlays(penAnchors, penContours) : []),
      ...(pathToolActive && engine.engine?.layer_kind(activeLayerId) === LAYER_KIND.vector
        ? vectorPathsFromSceneJson(engine.e.vector_scene_json(activeLayerId))
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool, showTargetPath, penAnchors, penContours, pathToolActive, activeLayerId, undoDepth, vectorRev],
  );
  const selectedAnchorKeys = useMemo(() => new Set(pathAnchors.map(anchorKey)), [pathAnchors]);
  // A different tool or layer means a different path — drop a stale selection.
  useEffect(() => { setPathAnchors([]); }, [tool, activeLayerId]);
  const showRulers = useStore((s) => s.showRulers);
  const guides = useStore((s) => s.guides);
  const gridSpacing = useStore((s) => s.gridSpacing);
  const gridColor = useStore((s) => s.gridColor);
  const docW = useStore((s) => s.doc.width);
  const docH = useStore((s) => s.doc.height);
  // Animation onion skin: ghost the LAST captured frame over the live canvas.
  const onionSkin = useStore((s) => s.onionSkin);
  const onionFrames = useStore(() => anim.count());
  const onionHistory = useStore((s) => s.historyIndex);
  // ponytail: recomputed per edit while enabled (full-res frame render); a
  // frames-generation counter would make this cheaper if it ever matters.
  const onionSrc = useMemo(
    () => (onionSkin && onionFrames > 0 && !passive ? engine.frameThumbUrl(onionFrames - 1, docW, docH) : ""),
    // onionHistory (historyIndex) is a deliberate per-edit invalidation trigger: it bumps
    // on every edit so the ghost frame re-renders even when the frame count is unchanged.
    // It is intentionally not read in the body, so exhaustive-deps' "unnecessary dep" is wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onionSkin, onionFrames, docW, docH, onionHistory, passive],
  );
  const drawPatternPreview = useCallback((rx = 0, ry = 0, rw = store.state.doc.width, rh = store.state.doc.height) => {
    const src = canvasRef.current;
    const dst = patternCanvasRef.current;
    if (!src || !dst) return;
    const { width: w, height: h } = store.state.doc;
    const resized = dst.width !== w * 3 || dst.height !== h * 3;
    if (resized) { dst.width = w * 3; dst.height = h * 3; }
    const x0 = resized ? 0 : Math.max(0, Math.floor(rx));
    const y0 = resized ? 0 : Math.max(0, Math.floor(ry));
    const x1 = resized ? w : Math.min(w, Math.ceil(rx + rw));
    const y1 = resized ? h : Math.min(h, Math.ceil(ry + rh));
    if (x1 <= x0 || y1 <= y0) return;
    const ctx = dst.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 3; tx++) {
        const dx = tx * w + x0, dy = ty * h + y0, dw = x1 - x0, dh = y1 - y0;
        ctx.clearRect(dx, dy, dw, dh);
        ctx.drawImage(src, x0, y0, dw, dh, dx, dy, dw, dh);
      }
    }
  }, []);
  useEffect(() => {
    if (patternPreview) drawPatternPreview();
  }, [patternPreview, compositeRev, docW, docH, drawPatternPreview]);
  const selectionActive = useStore((s) => s.selectionActive);
  const selectionGen = useStore((s) => s.selectionGen);
  const maskView = useStore((s) => s.maskView);
  const selectionPreviewMode = useStore((s) => s.selectionPreviewMode);
  const selectionPreviewGen = useStore((s) => s.selectionPreviewGen);
  const quickMask = useStore((s) => s.quickMask);
  const quickMaskGen = useStore((s) => s.quickMaskGen);
  const liquifyMaskGen = useStore((s) => s.liquifyMaskGen);
  const liquifyBackdropGen = useStore((s) => s.liquifyBackdropGen);
  const liquifyMeshGen = useStore((s) => s.liquifyMeshGen);
  const liquifyPreview = useStore((s) => s.liquify.preview);
  const liquifyShowBackdrop = useStore((s) => s.liquify.showBackdrop);
  const liquifyBackdropSource = useStore((s) => s.liquify.backdropSource);
  const liquifyBackdropOpacity = useStore((s) => s.liquify.backdropOpacity);
  const liquifyShowMesh = useStore((s) => s.liquify.showMesh);
  const vanishingPointPlanes = useStore((s) => s.vanishingPointPlanes);
  const vanishingPointActivePlane = useStore((s) => s.vanishingPointActivePlane);
  const vanishingPointSource = useStore((s) => s.vanishingPointSource);
  const vanishingPointEdges = useStore((s) => s.vanishingPointSession && s.vanishingPointTool === "edit");
  const vanishingPointMarquee = useStore((s) => s.vanishingPointMarquee);
  const vanishingPointFloat = useStore((s) => s.vanishingPointFloat);
  const paintSymmetry = useStore((s) => s.paintSymmetry);
  const paintSymmetrySegments = useStore((s) => s.paintSymmetrySegments);
  const paintSymmetryAxisX = useStore((s) => s.paintSymmetryAxisX);
  const paintSymmetryAxisY = useStore((s) => s.paintSymmetryAxisY);
  const paintSymmetryAngle = useStore((s) => s.paintSymmetryAngle);
  const paintSymmetryScale = useStore((s) => s.paintSymmetryScale);
  const paintSymmetryVisible = useStore((s) => s.paintSymmetryVisible);
  const paintSymmetryTransforming = useStore((s) => s.paintSymmetryTransforming);
  const activeDocId = useStore((s) => s.activeDocId);
  const cloneSource = useStore((s) => s.cloneSources[s.cloneSourceSlot]?.source ?? null);
  const cloneSample = useStore((s) => s.cloneSample);
  const cloneOverlayShow = useStore((s) => s.cloneOverlay.show);
  // A new document invalidates document-space transient state. An in-progress
  // marquee must not later commit against the newly activated engine.
  useEffect(() => {
    lastBrushPtRef.current = null;
    smoothPtRef.current = null;
    const d = dragRef.current;
    if (d?.mode === "marquee" || d?.mode === "ellipse") {
      dragRef.current = null;
      setPreview(null);
      store.setSelectionDragRect(null);
    }
    // The Pen's anchors live in a ref the store does not redraw. A tab switch
    // has already swapped `penAnchors` / `penPath`; put those on the ref or
    // Enter closes the previous document's path on this one.
    const anchors = store.state.penAnchors.slice();
    const path = store.state.penPath.slice();
    penAnchorRef.current = anchors;
    penRef.current = path;
    setPenAnchorPath(anchors.length ? anchors : null);
    setPenPts(path.length ? path : null);
    curveRef.current = [];
    setCurveAnchors(null);
  }, [activeDocId]);
  const ready = useStore((s) => s.ready);
  const fitNonce = useStore((s) => s.fitNonce);
  const zoomCmd = useStore((s) => s.zoomCmd);
  const cursor = useStore((s) => s.cursor);
  const textEdit = useStore((s) => s.textEdit);

  // Mount the document canvas into the engine.
  useEffect(() => {
    if (canvasRef.current && !isPane) engine.setCanvas(canvasRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a view never changes kind
  }, []);

  // A pane's canvas mirrors the engine's while its document is the active one
  // (so it takes every blit, dab by dab); otherwise it holds that document's
  // own composite, recomposited only when that document's pixels change
  // (activation hands it back; a background write-back, a dialog preview's
  // cancel or late font provisioning bumps its display revision) — never on
  // the active document's syncs. Layout effect: a click that activates the
  // document hands the canvas over before its stroke's first dab.
  const bgRevision = useStore(() => (passive && !floatHost ? store.docDisplayRevision(paneDocId!) : null));
  useLayoutEffect(() => {
    const cv = canvasRef.current;
    if (paneDocId === undefined || !cv || floatHost) return;
    if (!passive) {
      engine.addMirror(cv);
      return () => engine.removeMirror(cv);
    }
    const img = store.docPixels(paneDocId);
    if (!img) return;
    cv.width = img.width;
    cv.height = img.height;
    cv.getContext("2d")?.putImageData(img, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a view never changes kind
  }, [paneDocId, passive, bgRevision, ready]);

  // Publish the viewport size to the store so the Navigator panel can size its
  // view box from the live zoom/pan. ResizeObserver tracks dock/window resizes.
  // A pane opens fitted to its document, once it has a size to fit into.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    // Neither view starts fitted. A 0×0 viewport (cold Home, before layout)
    // only publishes the size. The first positive viewport with a positive
    // document fits. The main view allows one more fit if that size changes
    // before two frames have passed, then locks so a later window resize does
    // not throw away the user's zoom. A pane fits once.
    let fitted = false;
    let fittedW = -1;
    let fittedH = -1;
    let locked = false;
    let raf1 = 0;
    let raf2 = 0;
    const armLock = () => {
      if (isPane || locked || raf1) return;
      raf1 = requestAnimationFrame(() => {
        raf1 = 0;
        raf2 = requestAnimationFrame(() => { raf2 = 0; locked = true; });
      });
    };
    const publish = () => {
      const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight);
      store.setViewport(w, h, paneDocId);
      if (!w || !h) return;
      const snap = store.state;
      const size = paneDocId !== undefined ? store.docSize(paneDocId) : { w: snap.doc.width, h: snap.doc.height };
      if (!size || size.w <= 0 || size.h <= 0) return;
      if (isPane) {
        if (fitted) return;
      } else if (locked || (fitted && w === fittedW && h === fittedH)) {
        return;
      }
      const angle = paneDocId !== undefined ? (snap.paneViews[paneDocId]?.rotationAngle ?? 0) : snap.rotationAngle;
      const par = snap.pixelAspectCorrection ? snap.pixelAspect : 1;
      const view = fitOrientedView(w, h, size.w, size.h, angle, par);
      fitted = true;
      fittedW = w;
      fittedH = h;
      store.setZoom(view.zoom, view.panX, view.panY, paneDocId);
      if (!isPane) armLock();
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a view never changes kind
  }, []);

  // Fit-to-view on explicit fit requests only (open/new/resize/crop/rotate/⌘0
  // all bump fitNonce). Switching document tabs deliberately does NOT bump it,
  // so each document keeps its own restored zoom/pan regardless of dimensions.
  // These commands address the main canvas and the float window showing the
  // active document (a crop there refits it too), never an Arrange pane.
  useLayoutEffect(() => {
    if ((isPane && !floatHost) || passive || !docW || !docH || !viewportRef.current) return;
    const vp = viewportRef.current.getBoundingClientRect();
    const view = fitOrientedView(vp.width, vp.height, docW, docH, rotationAngle, parX);
    store.setZoom(view.zoom, view.panX, view.panY, paneDocId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce]);

  // Zoom presets (Zoom tool 100% / Fill Screen). Fit Screen reuses fitNonce above.
  useLayoutEffect(() => {
    if ((isPane && !floatHost) || passive || !zoomCmd || !docW || !docH || !viewportRef.current) return;
    const vp = viewportRef.current.getBoundingClientRect();
    if (zoomCmd.mode === "fill") {
      const box = orientedDocSize(docW, docH, rotationAngle, parX);
      const z = fillZoom(vp.width, vp.height, box.w, box.h);
      store.setZoom(z, (vp.width - docW * z * parX) / 2, (vp.height - docH * z) / 2, paneDocId);
    } else {
      store.setZoom(1, (vp.width - docW) / 2, (vp.height - docH) / 2, paneDocId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomCmd?.nonce]);

  // Rebuild the selection boundary list whenever the selection changes.
  useEffect(() => {
    // The probe also covers "engine not ready yet" (engine.e would throw).
    if (passive || !engine.selectionMask() || !docW || !docH) {
      boundaryRef.current = new Int32Array(0);
      onBoundary?.(boundaryRef.current);
      const ov = overlayRef.current;
      if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height);
      return;
    }
    // Scan only the selection's bounding box, not the whole document — the edge
    // test still reads neighbours, but outside the bbox the mask is unselected so
    // nothing is ever lit. Turns an O(W·H) main-thread pass into O(bbox area).
    const pts: number[] = [];
    const w = docW;
    const b = engine.e.selection_bounds(); // [x, y, w, h]
    // selection_bounds() allocates a Vec inside WASM, so it can grow — and thus
    // detach — the memory the mask view points at. Build the view AFTER the last
    // WASM call, never before it, or every read below returns undefined and the
    // marching ants come out empty. (#13)
    const mask = engine.selectionMask()!;
    const x0 = Math.max(0, b[0]);
    const y0 = Math.max(0, b[1]);
    const x1 = Math.min(docW, b[0] + b[2]);
    const y1 = Math.min(docH, b[1] + b[3]);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (mask[y * w + x] < 128) continue;
        const edge =
          x === 0 || y === 0 || x === docW - 1 || y === docH - 1 ||
          mask[y * w + x - 1] < 128 || mask[y * w + x + 1] < 128 ||
          mask[(y - 1) * w + x] < 128 || mask[(y + 1) * w + x] < 128;
        if (edge) {
          pts.push(x, y);
        }
      }
    }
    boundaryRef.current = new Int32Array(pts);
    onBoundary?.(boundaryRef.current);
    // selectionGen sees select→reselect (a boolean doesn't); activeDocId covers
    // switching between same-size documents whose generations happen to match.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onBoundary is a sink, not an input
  }, [selectionActive, selectionGen, activeDocId, docW, docH, passive]);

  // Animate marching ants (a float window animates its own).
  useEffect(() => {
    const ov = overlayRef.current;
    if (!ov || floatHost) return;
    if (ov.width !== docW || ov.height !== docH) {
      ov.width = docW;
      ov.height = docH;
    }
    const ctx = ov.getContext("2d")!;
    // The overlay was (re)sized; drop any cached ants buffer built for the old size.
    antsRef.current = antsCache();
    // No selection, no ants: an idle frame loop would repaint the overlay forever and
    // make the compositor re-run every glass backdrop-filter above the canvas.
    if (!selectionActive) { ctx.clearRect(0, 0, ov.width, ov.height); return; }
    const tick = () => {
      ctx.clearRect(0, 0, ov.width, ov.height);
      if (store.state.showSelectionEdges && store.state.showExtras) {
        phaseRef.current = (phaseRef.current + 1) % 8;
        drawAnts(ctx, boundaryRef.current, phaseRef.current, antsRef.current);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a view never changes kind
  }, [docW, docH, selectionActive, passive]);

  // ── Quick Mask rubylith overlay ─────────────────────────────
  // Paint the red overlay from the engine's Quick Mask buffer (display only — the
  // engine's output, and thus export/pick_color/histogram, is never touched). With
  // no rect → full rebuild; with a rect → just that dirty area (live stroke redraw).
  const drawQuickMask = useCallback((rx?: number, ry?: number, rw?: number, rh?: number) => {
    const cv = qmOverlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = store.state.doc.width, H = store.state.doc.height;
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; qmImgRef.current = null; }
    const buf = engine.quickMaskBuffer();
    if (!buf) { ctx.clearRect(0, 0, cv.width, cv.height); qmImgRef.current = null; return; }
    let img = qmImgRef.current;
    if (!img || img.width !== W || img.height !== H) { img = ctx.createImageData(W, H); qmImgRef.current = img; }
    const x0 = rx === undefined ? 0 : Math.max(0, Math.floor(rx));
    const y0 = ry === undefined ? 0 : Math.max(0, Math.floor(ry));
    const x1 = rw === undefined ? W : Math.min(W, x0 + Math.ceil(rw));
    const y1 = rh === undefined ? H : Math.min(H, y0 + Math.ceil(rh));
    const d = img.data;
    for (let y = y0; y < y1; y++) {
      let p = (y * W + x0) * 4;
      for (let x = x0; x < x1; x++, p += 4) {
        const px = quickMaskPixel(buf[y * W + x]);
        d[p] = px.r; d[p + 1] = px.g; d[p + 2] = px.b; d[p + 3] = px.a;
      }
    }
    ctx.putImageData(img, 0, 0, x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
  }, []);

  // Layer-mask preview: ⌥-click a mask thumbnail shows the mask alone in
  // grayscale; `\\` composites it as rubylith over the document. Display-only —
  // it reads the compositor's effective coverage (Feather + Density included)
  // and never touches the engine's output buffer.
  const drawMaskView = useCallback(() => {
    const cv = maskViewOverlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = store.state.doc.width, H = store.state.doc.height;
    const mode = store.state.maskView;
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; maskViewImgRef.current = null; }
    const buf = mode === "off" ? null : store.layerMaskBuffer();
    if (!buf) { ctx.clearRect(0, 0, cv.width, cv.height); maskViewImgRef.current = null; return; }
    let img = maskViewImgRef.current;
    if (!img || img.width !== W || img.height !== H) { img = ctx.createImageData(W, H); maskViewImgRef.current = img; }
    const d = img.data;
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      if (mode === "gray") {
        // Opaque: the mask channel alone, standing in for the document.
        d[p] = d[p + 1] = d[p + 2] = buf[i]; d[p + 3] = 255;
      } else {
        const px = quickMaskPixel(buf[i]);
        d[p] = px.r; d[p + 1] = px.g; d[p + 2] = px.b; d[p + 3] = px.a;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [compositeRev]);
  useEffect(() => {
    if (passive) return;
    drawMaskView();
  }, [drawMaskView, maskView, activeLayerId, docW, docH, passive]);

  // Color Range ▸ Selection Preview: the uncommitted selection drawn over the
  // document while the dialog is open, in Photoshop's five renderings. Reads the
  // preview coverage the dialog installed on the store; display-only.
  useEffect(() => {
    const cv = selPreviewOverlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = docW, H = docH;
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; selPreviewImgRef.current = null; }
    const buf = selectionPreviewMode === "none" ? null : store.selectionPreviewBuffer();
    if (!buf || buf.length !== W * H) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      selPreviewImgRef.current = null;
      return;
    }
    let img = selPreviewImgRef.current;
    if (!img || img.width !== W || img.height !== H) { img = ctx.createImageData(W, H); selPreviewImgRef.current = img; }
    const d = img.data;
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const px = selectionPreviewPixel(buf[i], selectionPreviewMode);
      d[p] = px.r; d[p + 1] = px.g; d[p + 2] = px.b; d[p + 3] = px.a;
    }
    ctx.putImageData(img, 0, 0);
  }, [selectionPreviewMode, selectionPreviewGen, docW, docH, passive]);

  // Full rebuild on enter / qm_gen change / doc swap / resize; clear on exit.
  useEffect(() => {
    if (quickMask) drawQuickMask();
    else {
      const cv = qmOverlayRef.current;
      cv?.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
      qmImgRef.current = null;
    }
  }, [quickMask, quickMaskGen, activeDocId, docW, docH, drawQuickMask]);

  // Live dirty-rect redraw during a stroke (fired after each brush stamp). One
  // hook, so the main canvas owns it; a pane's overlays catch up on commit.
  useEffect(() => {
    if (isPane) return;
    engine.onPaintRegion = (x, y, w, h) => {
      if (store.state.quickMask) drawQuickMask(x, y, w, h);
      if (store.state.patternPreview) drawPatternPreview(x, y, w, h);
      if (store.state.maskView !== "off") drawMaskView();
    };
    return () => { engine.onPaintRegion = null; };
  }, [isPane, drawQuickMask, drawPatternPreview, drawMaskView]);

  // Liquify Freeze Mask overlay. Like Quick Mask, this is display-only. The
  // engine stores 255 where future Liquify warps are protected; the document
  // pixels are untouched until a real warp dab happens.
  const drawLiquifyFreezeMask = useCallback(() => {
    const cv = lqMaskOverlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = store.state.doc.width, H = store.state.doc.height;
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; lqMaskImgRef.current = null; }
    const buf = engine.liquifyFreezeMaskBuffer();
    if (!buf) { ctx.clearRect(0, 0, cv.width, cv.height); lqMaskImgRef.current = null; return; }
    let img = lqMaskImgRef.current;
    if (!img || img.width !== W || img.height !== H) { img = ctx.createImageData(W, H); lqMaskImgRef.current = img; }
    const d = img.data;
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const a = Math.round((buf[i] / 255) * 150);
      d[p] = 255; d[p + 1] = 55; d[p + 2] = 55; d[p + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  useEffect(() => {
    if (tool === "liquify") drawLiquifyFreezeMask();
    else {
      const cv = lqMaskOverlayRef.current;
      cv?.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
      lqMaskImgRef.current = null;
    }
  }, [tool, liquifyMaskGen, activeDocId, docW, docH, drawLiquifyFreezeMask]);

  // Liquify Backdrop / Preview overlay. Photoshop's Liquify workspace can show
  // a semi-transparent pre-session image behind the live warp, or temporarily
  // hide the preview and show the before image at full opacity. This frontend
  // overlay keeps saved/exported pixels untouched.
  const drawLiquifyBackdrop = useCallback(() => {
    const cv = lqBackdropOverlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = store.state.doc.width, H = store.state.doc.height;
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; lqBackdropImgRef.current = null; }
    const backdrop = store.liquifyBackdropPixels();
    if (!backdrop || backdrop.w !== W || backdrop.h !== H) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      lqBackdropImgRef.current = null;
      return;
    }
    let img = lqBackdropImgRef.current;
    if (!img || img.width !== W || img.height !== H) { img = ctx.createImageData(W, H); lqBackdropImgRef.current = img; }
    const src = backdrop.pixels;
    const dst = img.data;
    const opacity = store.state.liquify.preview ? store.state.liquify.backdropOpacity : 1;
    for (let i = 0; i < src.length; i += 4) {
      dst[i] = src[i];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i + 2];
      dst[i + 3] = Math.round(src[i + 3] * opacity);
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  useEffect(() => {
    if (tool === "liquify" && (liquifyShowBackdrop || !liquifyPreview)) drawLiquifyBackdrop();
    else {
      const cv = lqBackdropOverlayRef.current;
      cv?.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
      lqBackdropImgRef.current = null;
    }
  }, [tool, liquifyPreview, liquifyShowBackdrop, liquifyBackdropSource, liquifyBackdropOpacity, liquifyBackdropGen, activeDocId, docW, docH, drawLiquifyBackdrop]);

  // Aligned's locked anchor belongs to one source in one document.
  useEffect(() => { cloneAnchorRef.current = null; }, [activeDocId, cloneSource]);

  // Clone Source ▸ Show Overlay: the active slot's source, drawn through its
  // transform and clipped to the brush, exactly where the next dab samples it.
  // ponytail: the captured source is rebuilt on pointerenter and after each
  // pointerup, so an undo made while hovering shows stale pixels until then;
  // key it on the engine's commit hook if that ever matters.
  const drawCloneOverlay = useCallback((at: { x: number; y: number } | null) => {
    const cv = cloneOverlayRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const s = store.state;
    if (cv.width !== s.doc.width || cv.height !== s.doc.height) { cv.width = s.doc.width; cv.height = s.doc.height; }
    ctx.clearRect(0, 0, cv.width, cv.height);
    const slot = s.cloneSources[s.cloneSourceSlot];
    const sampled = s.tool === "clone" || (s.tool === "heal" && s.brush.healSource !== "pattern");
    if (!at || !slot?.source || !s.cloneOverlay.show || !sampled) return;
    let img = cloneOverlayImgRef.current;
    if (!img) {
      const src = store.cloneSourceImage();
      const next = document.createElement("canvas");
      const nctx = next.getContext("2d");
      if (!src || !nctx) return;
      next.width = src.w;
      next.height = src.h;
      const data = nctx.createImageData(src.w, src.h);
      data.data.set(src.px);
      nctx.putImageData(data, 0, 0);
      img = cloneOverlayImgRef.current = next;
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(at.x, at.y, s.brush.size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = s.cloneOverlay.opacity / 100;
    ctx.setTransform(...cloneOverlayMatrix(slot.source, (s.cloneAligned && cloneAnchorRef.current) || at, slot.transform));
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }, []);

  useEffect(() => {
    cloneOverlayImgRef.current = null;
    drawCloneOverlay(null);
  }, [tool, cloneSource, cloneSample, cloneOverlayShow, activeDocId, docW, docH, drawCloneOverlay]);

  // Liquify Mesh preview. The engine's mesh is session-only and display-only;
  // draw a sampled warped grid over the canvas so users can inspect the live
  // deformation without changing saved/exported pixels.
  const drawLiquifyMesh = useCallback(() => {
    const cv = lqMeshOverlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = store.state.doc.width, H = store.state.doc.height;
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const mesh = engine.liquifyMesh();
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!mesh || mesh.w !== W || mesh.h !== H) return;
    const step = Math.max(8, Math.min(32, Math.round(Math.min(W, H) / 6)));
    const point = (x: number, y: number): [number, number] => {
      const ix = Math.max(0, Math.min(W - 1, Math.round(x)));
      const iy = Math.max(0, Math.min(H - 1, Math.round(y)));
      const i = iy * W + ix;
      return [x + mesh.fx[i], y + mesh.fy[i]];
    };
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(74, 210, 255, 0.72)";
    ctx.setLineDash([4, 3]);
    const drawPolyline = (pts: [number, number][]) => {
      if (!pts.length) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    };
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = 0; x < W; x += step) xs.push(x);
    if (xs[xs.length - 1] !== W - 1) xs.push(W - 1);
    for (let y = 0; y < H; y += step) ys.push(y);
    if (ys[ys.length - 1] !== H - 1) ys.push(H - 1);
    for (const x of xs) drawPolyline(ys.map((y) => point(x, y)));
    for (const y of ys) drawPolyline(xs.map((x) => point(x, y)));
    ctx.restore();
  }, []);

  useEffect(() => {
    if (tool === "liquify" && liquifyShowMesh) drawLiquifyMesh();
    else {
      const cv = lqMeshOverlayRef.current;
      cv?.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
    }
  }, [tool, liquifyShowMesh, liquifyMeshGen, activeDocId, docW, docH, drawLiquifyMesh]);

  // Canvas writes do not trigger MutationObserver. Publish after the effects
  // above repaint overlays, and redraw a float's Quick Mask during each dab.
  useEffect(() => { onOverlay?.(); });
  useEffect(() => {
    if (!floatHost) return;
    const repaint = (x: number, y: number, w: number, h: number) => {
      if (store.state.activeDocId !== paneDocId) return;
      if (store.state.quickMask) drawQuickMask(x, y, w, h);
      onOverlay?.();
    };
    engine.blitListeners.add(repaint);
    return () => { engine.blitListeners.delete(repaint); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sinks read current store state
  }, [floatHost, paneDocId, drawQuickMask]);

  // ── coordinate mapping ──────────────────────────────────────
  // Effective horizontal scale = zoom × pixel-aspect (the canvas div is
  // stretched horizontally for non-square-pixel display, so the x axis maps back
  // through that extra factor while y stays at plain zoom).
  const parOf = () => (store.state.pixelAspectCorrection ? store.state.pixelAspect : 1);
  // This view's zoom/pan/rotation, read fresh (handlers outlive a render).
  const view = () => viewOf(store.state, paneDocId);
  const toDoc = (clientX: number, clientY: number) => {
    const vp = viewportRef.current!.getBoundingClientRect();
    return docPointAt(view(), parOf(), store.state.doc.width, store.state.doc.height, clientX - vp.left, clientY - vp.top);
  };

  // Photoshop selection-combine modes from the modifiers held at gesture start
  // (sampled at pointer-down): Shift = add, Alt/Option = subtract, Shift+Alt =
  // intersect, none = the options-bar mode. 0 replace · 1 add · 2 subtract · 3 intersect.
  const modeFromKeys = (shift: boolean, alt: boolean) =>
    shift && alt ? 3 : shift ? 1 : alt ? 2 : store.state.selMode;

  // Options-bar Feather: soften the just-committed selection (marquee/lasso) when
  // the feather radius is large enough to matter.
  const applyFeather = () => {
    const f = store.state.selectionFeather;
    if (featherActive(f)) engine.e.feather_selection(f);
  };

  // Rectangular/Elliptical Marquee geometry honouring the "Style" option: Fixed
  // Ratio locks the aspect, Fixed Size makes an exact px box at the anchor, Normal
  // is the free Shift(square)/Alt(centre) drag. (ex,ey) is the live pointer.
  const styledSelectionRect = (sx: number, sy: number, ex: number, ey: number, shift: boolean, alt: boolean) => {
    const s = store.state;
    if (s.marqueeStyle === "ratio") return fixedRatioRect(sx, sy, ex, ey, s.marqueeFixedW, s.marqueeFixedH);
    if (s.marqueeStyle === "size") return fixedSizeRect(sx, sy, s.marqueeFixedW, s.marqueeFixedH, s.doc.width, s.doc.height);
    return marqueeRect(sx, sy, ex, ey, shift, alt);
  };

  // Apply the latest pending Move-drag offset: recomposite + reblit only the
  // moved layer's footprint. Runs at most once per animation frame.
  const flushMove = () => {
    moveRafRef.current = 0;
    const d = dragRef.current;
    const p = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (!d || d.mode !== "move" || !p) return;
    const E = engine.engine;
    if (!E) return;
    const r = E.move_layer_offset(d.layerId, p.dx, p.dy);
    appliedMoveRef.current = p;
    if (r[2] > 0 && r[3] > 0) engine.blitRegion(r[0], r[1], r[2], r[3]);
  };

  // Liquify Brush Rate: dabs otherwise only fire on pointermove, so a brush
  // held still with Rate > 0 would do nothing. This timer re-dabs at the last
  // known point while the pointer is down. It is intentionally started in ONE
  // place (liquify pointerdown) and cleared in every place a liquify drag can
  // end, so it can never outlive the gesture that started it.
  const clearLiquifyRateTimer = () => {
    if (liquifyRateTimerRef.current) {
      window.clearInterval(liquifyRateTimerRef.current);
      liquifyRateTimerRef.current = 0;
    }
  };
  const startLiquifyRateTimer = () => {
    clearLiquifyRateTimer();
    const rate = store.state.liquify.rate;
    if (rate <= 0) return; // 0 = today's behaviour: no stationary-brush effect
    // ponytail: linear rate→interval mapping (20ms..300ms); tune the curve if
    // Rate feels off in practice.
    const delayMs = Math.round(300 - rate * 280);
    liquifyRateTimerRef.current = window.setInterval(() => {
      const d = dragRef.current;
      if (!d || d.mode !== "liquify") { clearLiquifyRateTimer(); return; }
      store.liquifyDab(d.lx, d.ly, 0, 0, d.pressure ?? 1);
    }, delayMs);
  };
  // Airbrush / Build-up: same shape as the Liquify Rate timer, for the paint
  // family. Started at brush pointerdown, cleared wherever the Rate timer is.
  const clearAirbrushTimer = () => {
    if (airbrushTimerRef.current) {
      window.clearInterval(airbrushTimerRef.current);
      airbrushTimerRef.current = 0;
    }
  };
  const startAirbrushTimer = () => {
    clearAirbrushTimer();
    airbrushTimerRef.current = startAirbrushRepeat(store.state.brush, () => airbrushTick(
      dragRef.current,
      engine.engine,
      (x, y, w, h) => engine.paintRegion(x, y, w, h),
    ));
  };
  // Stop the Rate timer on tool change, document switch, and unmount (cleanup
  // runs on every dependency change AND on unmount).
  useEffect(() => () => { clearLiquifyRateTimer(); clearAirbrushTimer(); }, [tool, activeDocId]);

  // Cancel transient pointer state on unmount so a latched brush mode cannot leak
  // if the whole canvas disappears mid-stroke.
  useEffect(() => () => {
    clearLiquifyRateTimer();
    clearAirbrushTimer();
    if (moveRafRef.current) cancelAnimationFrame(moveRafRef.current);
    moveRafRef.current = 0;
    pendingMoveRef.current = null;
    appliedMoveRef.current = null;
    smartBoundsRef.current = null;
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.strokeActive && engine.engine) {
      smoothPtRef.current = null;
      try {
        engine.engine.stroke_end();
      } finally {
        engine.strokeCaptureEnd();
        store.endBrushStroke();
      }
      engine.commit();
    } else {
      store.endBrushStroke();
    }
    if (d?.mode === "move" && !d.selMove && engine.engine) {
      const r = engine.engine.move_layer_offset(d.layerId, 0, 0);
      engine.engine.commit_offset(d.layerId); // zero offset: terminate the cached drag footprint without history
      if (r[2] > 0 && r[3] > 0) engine.blitRegion(r[0], r[1], r[2], r[3]);
    }
    if (d?.mode === "directselect") {
      if (d.handleDrag) store.endHandleDrag();
      else store.endAnchorDrag();
    }
    if (d?.mode === "pathselect") store.endPathDrag();
    store.setSelectionDragRect(null);
    rotateStartRef.current = null;
    lassoRef.current = [];
    spotHealPtsRef.current = [];
  }, []);

  function repaintBrushCursor(e?: { clientX: number; clientY: number; buttons: number; getModifierState?: (key: "CapsLock") => boolean }) {
    if (e) cursorPointerRef.current = { x: e.clientX, y: e.clientY, buttons: e.buttons, capsLock: e.getModifierState?.("CapsLock") === true };
    const el = cursorRef.current, pointer = cursorPointerRef.current, s = store.state;
    if (!el) return;
    const diameter = !pointer || pointer.capsLock || (paneDocId !== undefined && paneDocId !== s.activeDocId)
      ? 0 : brushTipDiameter(s.tool, { ...s, zoom: viewOf(s, paneDocId).zoom });
    el.style.display = diameter > 0 ? "block" : "none";
    if (!diameter || !pointer) return;
    const crosshairOnly = diameter < MIN_BRUSH_TIP_PX || (s.cursorPrefs.crosshairWhilePainting && (pointer.buttons & 1) === 1);
    el.style.width = `${diameter}px`;
    el.style.height = `${diameter}px`;
    el.style.left = `${pointer.x}px`;
    el.style.top = `${pointer.y}px`;
    (el.firstElementChild as HTMLElement).style.display = crosshairOnly ? "none" : "block";
    (el.lastElementChild as SVGElement).style.display = crosshairOnly || s.cursorPrefs.crosshairInTip ? "block" : "none";
  }
  // Preferences, brush size and view zoom can change without a pointer move.
  useEffect(() => {
    const unsubscribe = store.subscribe(() => repaintBrushCursor());
    return () => { unsubscribe(); };
  }, [paneDocId]); // eslint-disable-line react-hooks/exhaustive-deps -- reads store and refs fresh

  // ── pointer handlers ────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    // A pane over a background document: the click activates that document —
    // rendered synchronously, so every per-document reset has already run —
    // and then the current tool applies there through the re-rendered handler,
    // as every Photoshop window is an editing surface.
    if (passive) {
      flushSync(() => store.activateDoc(paneDocId!));
      if (store.state.activeDocId === paneDocId) pointerDownRef.current(e);
      return;
    }
    repaintBrushCursor(e);
    if (!engine.engine) return;
    // A click anywhere on the canvas while editing text in place commits the
    // edit (the editor's own pointer events are stopped, so this only fires
    // for clicks outside it). Any button commits, consistently.
    if (store.state.textEdit) { store.endTextEdit(); return; }
    // Same rule for a live Transform Selection frame: the frame's own handles
    // stop their events, so reaching here means a click outside it — commit,
    // and never let the click also paint.
    if (store.state.selectionTransform) { store.commitSelectionTransform(); return; }
    if (store.state.camDrop) { commitContentAwareMoveDrop(); return; }
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* synthetic events */ }
    const { x, y } = toDoc(e.clientX, e.clientY);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    // Middle (1) or right (2) button drags pan the canvas (hand tool). Holding
    // Space turns any tool into a temporary Hand for a left-button pan-drag.
    const midPan = e.button === 1;
    let mode = store.state.tool;
    if (e.button === 2 || midPan || store.state.spacePan) mode = "hand";
    // Move tool + an active selection → float the selection (Photoshop): move the
    // selected pixels and the marquee, not the whole layer.
    const selMove = mode === "move" && !!engine.engine && engine.engine.has_selection();
    // Patch / Content-Aware Move drag the selection to a target; reuse selBounds
    // for the drag preview (Patch heals in place; Content-Aware Move relocates).
    const patchDrag = (mode === "patch" || mode === "contentawaremove") && !!engine.engine && engine.engine.has_selection();
    const selBounds = selMove || patchDrag ? (Array.from(engine.e.selection_bounds()) as number[]) : null;
    const d: DragState = {
      mode,
      sx: x, sy: y, lx: x, ly: y,
      panX0: view().panX, panY0: view().panY,
      clientX0: e.clientX, clientY0: e.clientY,
      layerId: store.state.activeLayerId,
      shift: e.shiftKey, alt: e.altKey,
      selMove, selBounds,
    };
    dragRef.current = d;
    const E = engine.engine;
    const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 1;

    // A symmetry transform is modal like Photoshop's path transform: painting is
    // paused until Enter/Escape. The centre translates; the outer handle rotates
    // and uniformly scales the live path.
    if (store.state.paintSymmetryTransforming && e.button === 0 && !store.state.spacePan) {
      const ax = store.state.paintSymmetryAxisX;
      const ay = store.state.paintSymmetryAxisY;
      const hitRadius = 12 / view().zoom;
      const outer = paintSymmetryOuterHandle(
        ax,
        ay,
        store.state.paintSymmetryAngle,
        store.state.paintSymmetryScale,
        store.state.doc.width,
        store.state.doc.height,
      );
      const centreDistance = Math.hypot(x - ax, y - ay);
      const outerDistance = Math.hypot(x - outer.x, y - outer.y);
      if (outerDistance <= hitRadius && outerDistance < centreDistance) {
        const pointerDistance = Math.hypot(x - ax, y - ay);
        if (pointerDistance > 0.0001) {
          d.symmetryOuter = {
            axisX: ax,
            axisY: ay,
            startAngle: store.state.paintSymmetryAngle,
            startScale: store.state.paintSymmetryScale,
            pointerAngle: Math.atan2(y - ay, x - ax),
            pointerDistance,
          };
        }
      } else if (centreDistance <= hitRadius) {
        d.symmetryPath = { x: ax, y: ay };
      }
      if (!d.symmetryPath && !d.symmetryOuter) dragRef.current = null;
      return;
    }

    switch (mode) {
      case "directselect": {
        // Direct Selection: grab the nearest anchor (within ~8 screen px). Shift
        // extends the selection; a plain click on an already-selected anchor
        // keeps the group so the whole set drags together. A miss on empty
        // canvas starts a rubber band instead (resolved on pointerup).
        // A direction-handle end wins over the anchor under it — Photoshop
        // grabs the stick, not the point, when both are in range. Mirror is
        // decided at grab time: Alt breaks the pair, plain drag keeps it.
        if (store.directSelectHandleAt(x, y, 8 / view().zoom)) {
          d.handleDrag = true;
          d.handleMirror = !e.altKey;
          break;
        }
        if (store.directSelectAt(x, y, 8 / view().zoom)) {
          const hit = store.state.selectedAnchor;
          if (hit) {
            const next = e.shiftKey
              ? toggleAnchor(pathAnchors, hit)
              : pathAnchors.some((a) => anchorKey(a) === anchorKey(hit)) ? pathAnchors : [hit];
            setPathAnchors(next);
            d.anchorOrigins = anchorOrigins(vectorPaths, next);
          }
        } else {
          if (!e.shiftKey) setPathAnchors([]); // shift keeps what's selected and adds to it
          d.anchorMarquee = true;
          setAnchorMarquee({ x0: x, y0: y, x1: x, y1: y });
        }
        break;
      }
      case "pathselect": {
        // Path Selection: grab the path component under the cursor; Shift
        // toggles it in and out of the multi-selection (#456).
        store.pathSelectAt(x, y, 6 / view().zoom, e.shiftKey);
        break;
      }
      case "addanchor":
        // Lossless de Casteljau split at the clicked segment point; a click on
        // an existing anchor is a miss (the engine refuses, nothing changes).
        if (store.addAnchorAt(x, y, 6 / view().zoom)) setVectorRev((r) => r + 1);
        break;
      case "deleteanchor":
        if (store.deleteAnchorAt(x, y, 8 / view().zoom)) setVectorRev((r) => r + 1);
        break;
      case "convertpoint":
        if (store.convertPointAt(x, y, 8 / view().zoom)) setVectorRev((r) => r + 1);
        break;
      case "adjustmentbrush":
        // Ensure a hidden-mask adjustment layer is the paint target, then fall
        // through to the brush path — the stroke reveals it (mask_reveal).
        store.beginAdjustmentBrush();
        // falls through
      case "brush":
      case "pencil":
      case "erase":
      case "dodge":
      case "burn":
      case "patternstamp":
      case "colorreplace":
      case "sponge":
      case "blur":
      case "sharpen":
      case "backgrounderaser":
      case "mixerbrush":
      case "historybrush":
      case "smudge": {
        // Photoshop: Alt with the Brush/Pencil is a temporary Eyedropper — sample
        // the foreground colour (honouring Sample Size) instead of painting.
        if ((mode === "brush" || mode === "pencil") && e.altKey) {
          pickColor(ix, iy);
          dragRef.current = null; // a sample isn't a stroke — don't drag-paint
          break;
        }
        store.beginBrushStroke(ix, iy); // the start pixel decides the Pencil's Auto Erase
        // Pattern Stamp ▸ Aligned: on tiles to the canvas origin across all strokes;
        // off re-anchors the pattern to this stroke's start point.
        if (mode === "patternstamp") {
          E.set_pattern_anchor(store.state.patternAligned ? 0 : ix, store.state.patternAligned ? 0 : iy);
        }
        if (!E.stroke_begin()) {
          // Drain the refusal HERE. stroke_begin now explains itself (locked,
          // smart object, type layer…), and an undrained message would surface
          // on the user's next unrelated commit, blaming the wrong action.
          engine.consumeEditError();
          store.endBrushStroke();
          dragRef.current = null;
          break;
        }
        d.strokeActive = true;
        engine.strokeCaptureBegin(); // collab: record this brush/erase stroke (if a session is bound)
        smoothPtRef.current = { x, y }; // Brush Smoothing anchors at the first point
        // Photoshop: Shift-click draws a straight line from the previous brush
        // point to this click (a dab to the anchor, then interpolate to here).
        if (e.shiftKey && lastBrushPtRef.current) {
          const lp = lastBrushPtRef.current;
          const r1 = E.stroke_to(lp.x, lp.y, pressure);
          const r2 = E.stroke_to(x, y, pressure);
          engine.strokeCapturePoint(lp.x, lp.y, pressure);
          engine.strokeCapturePoint(x, y, pressure);
          if (r1[2] > 0 && r1[3] > 0) engine.paintRegion(r1[0], r1[1], r1[2], r1[3]);
          if (r2[2] > 0 && r2[3] > 0) engine.paintRegion(r2[0], r2[1], r2[2], r2[3]);
        } else {
          const r = E.stroke_to(x, y, pressure);
          engine.strokeCapturePoint(x, y, pressure);
          engine.paintRegion(r[0], r[1], r[2], r[3]);
        }
        d.lx = x; d.ly = y; d.pressure = pressure;
        startAirbrushTimer(); // Airbrush: keep depositing while held still; no-op when off
        break;
      }
      case "liquify": {
        // Forward-warp brush: the first dab opens the engine warp session (one
        // undo step); subsequent dabs accumulate into the same field. Session is
        // committed on Apply / Enter / tool-leave, discarded on Esc.
        store.liquifyDab(x, y, 0, 0, pressure);
        d.lx = x; d.ly = y; d.pressure = pressure;
        startLiquifyRateTimer(); // Brush Rate: repeat-dab while held still; no-op if rate is 0
        break;
      }
      case "bucket": {
        const fillMode = blendIndex(store.state.fillMode);
        const fillOpacity = store.state.fillOpacity;
        if (store.state.fillSource === "pattern") {
          E.bucket_fill_pattern(ix, iy, store.state.fillTolerance, store.state.fillContiguous, store.state.fillSampleAllLayers, fillMode, fillOpacity);
        } else {
          const [r, g, b, a] = hsvToRgba(store.state.fg);
          E.bucket_fill(ix, iy, r, g, b, a, store.state.fillTolerance, store.state.fillContiguous, store.state.fillSampleAllLayers, fillMode, fillOpacity);
        }
        engine.commit();
        break;
      }
      case "wand": {
        E.set_selection_antialias(store.state.antiAlias);
        E.magic_wand(ix, iy, store.state.wandTolerance, store.state.wandContiguous, modeFromKeys(e.shiftKey, e.altKey), store.state.wandSampleAllLayers);
        applyFeather(); // Photoshop: the wand options-bar Feather softens the new selection
        engine.sync();
        break;
      }
      case "quickselection": {
        // First dab: Alt subtracts, otherwise start a new selection. Subsequent
        // dabs (pointermove) add (or keep subtracting). One undo step per stroke.
        E.set_selection_antialias(store.state.antiAlias);
        store.quickSelectionAt(ix, iy, e.altKey ? 2 : 0, true);
        break;
      }
      case "magiceraser": {
        // One click erases the similar region to transparency (no marquee left).
        E.magic_eraser(ix, iy, store.state.magicEraserTolerance, store.state.magicEraserContiguous, store.state.magicEraserSampleAll, store.state.magicEraserOpacity);
        engine.commit();
        dragRef.current = null; // a click, not a drag
        break;
      }
      case "clone":
      case "heal": {
        if (e.altKey) {
          // Alt-click samples a new source into the active Clone Source slot;
          // the slot's new source resets any locked alignment (see the effect).
          store.setCloneSource(ix, iy);
          dragRef.current = null;
          break;
        }
        // Healing Brush ▸ Source: Pattern takes its source from the pattern
        // (pushBrush installs it), so demanding an Alt-clicked point made the
        // control inert until the user sampled one this path then discards
        // — set_clone's offset is unused on that branch (#484).
        const fromPattern = store.state.tool === "heal" && store.state.brush.healSource === "pattern";
        const slot = store.state.cloneSources[store.state.cloneSourceSlot];
        const src = fromPattern ? null : slot?.source ?? null;
        if (!src && !fromPattern) { dragRef.current = null; break; }
        store.pushBrush();
        let armed = true;
        if (!src) E.set_clone(true, 0, 0);
        else {
          // Aligned (Photoshop default): lock the destination anchor on the first
          // stroke and reuse it, so the source follows the brush across strokes.
          // Non-aligned: every stroke re-samples from the original source point.
          const anchor = (store.state.cloneAligned && cloneAnchorRef.current) || { x, y };
          if (store.state.cloneAligned) cloneAnchorRef.current = anchor;
          const t = slot.transform;
          if (isIdentityCloneTransform(t)) E.set_clone(true, Math.round(src.x - anchor.x), Math.round(src.y - anchor.y));
          else armed = E.set_clone_transform(src.x, src.y, anchor.x, anchor.y, t.w, t.h, t.angle, t.flipH, t.flipV);
          // Last, so nothing between the push and stroke_begin can strand it:
          // a slot from another document hands its pixels to this one stroke.
          armed &&= store.prepareCloneSource();
        }
        if (!armed) { dragRef.current = null; break; }
        if (!E.stroke_begin()) { engine.consumeEditError(); dragRef.current = null; break; }
        d.strokeActive = true;
        smoothPtRef.current = { x, y }; // Brush Smoothing anchors at the first point (clone/heal)
        const r = E.stroke_to(x, y, pressure);
        engine.paintRegion(r[0], r[1], r[2], r[3]);
        break;
      }
      case "vanishingpoint": {
        const planes = store.state.vanishingPointPlanes;
        const active = store.state.vanishingPointActivePlane;
        // Outside the workspace the tool is the perspective clone stamp.
        const vpTool = store.state.vanishingPointSession ? store.state.vanishingPointTool : "stamp";
        if (e.altKey && vpTool === "stamp") {
          store.setOptions({ vanishingPointSource: { x: ix, y: iy } });
          dragRef.current = null;
          break;
        }
        const handle = hitPlaneHandle(planes, x, y, view().zoom);
        if (handle) {
          d.vpHandle = handle;
          break;
        }
        if (vpTool === "edit") {
          const edge = (e.metaKey || e.ctrlKey) && planes[active] ? hitPlaneEdge(planes[active].quad, x, y, view().zoom) : null;
          if (edge !== null) {
            d.vpTearOff = { plane: active, edge };
            break;
          }
          const hit = planeAt(planes, x, y);
          if (hit !== null) store.setOptions({ vanishingPointActivePlane: hit });
          dragRef.current = null;
          break;
        }
        if (vpTool === "marquee") {
          const float = store.state.vanishingPointFloat;
          const marquee = store.state.vanishingPointMarquee;
          const inFloat = uvInRect(planes, float, x, y);
          const inMarquee = uvInRect(planes, marquee, x, y);
          if (float && inFloat) {
            d.vpMove = { kind: "float", u: inFloat[0], v: inFloat[1], orig: float };
          } else if (marquee && inMarquee && e.altKey) {
            // Alt-drag floats a copy of the marquee's pixels that moves in perspective.
            const pixels = engine.activeLayerCopy();
            const srcQuad = uvRectQuad(planes[marquee.plane].quad, marquee);
            if (!pixels || !srcQuad) { dragRef.current = null; break; }
            store.setVanishingFloat(pixels, store.state.doc.width, store.state.doc.height, srcQuad, marquee);
            d.vpMove = { kind: "float", u: inMarquee[0], v: inMarquee[1], orig: marquee };
          } else if (marquee && inMarquee) {
            d.vpMove = { kind: "marquee", u: inMarquee[0], v: inMarquee[1], orig: marquee };
          } else {
            const hit = planeAt(planes, x, y);
            const uv = hit === null ? null : uvAt(planes[hit].quad, x, y);
            if (hit === null || !uv) { dragRef.current = null; break; }
            store.setOptions({ vanishingPointActivePlane: hit, vanishingPointMarquee: null });
            d.vpMarquee = { plane: hit, u: uv[0], v: uv[1] };
          }
          break;
        }
        const q = planes[planeAt(planes, x, y) ?? active]?.quad ?? [];
        const src = store.state.vanishingPointSource;
        if (!src || q.length !== 8) { dragRef.current = null; break; }
        store.pushBrush();
        const ok = (E as typeof E & PerspectiveCloneEngine).set_clone_perspective(
          true,
          q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7],
          src.x, src.y, x, y,
        );
        if (!ok) {
          engine.onEditError?.("This plane is not a valid perspective quad. Drag its corners so its edges do not cross, then paint again.");
          dragRef.current = null;
          break;
        }
        if (!E.stroke_begin()) { engine.consumeEditError(); dragRef.current = null; break; }
        d.strokeActive = true;
        smoothPtRef.current = { x, y };
        const r = E.stroke_to(x, y, pressure);
        engine.paintRegion(r[0], r[1], r[2], r[3]);
        break;
      }
      case "remove":
      case "spothealing": {
        // Spot Healing / Remove: accumulate the painted footprint; the
        // content-aware fill runs once on pointerup (off the hot per-dab path).
        spotHealPtsRef.current = [x, y];
        break;
      }
      case "magneticlasso":
      case "lasso": {
        lassoRef.current = [x, y];
        setLasso([x, y]);
        break;
      }
      case "freeformpen": {
        // Begin a freehand path; points accumulate on drag, fill on release.
        penRef.current = [x, y];
        setPenPts([x, y]);
        store.setPenPath([x, y]);
        break;
      }
      case "pen": {
        // Photoshop's Pen: the click drops a corner anchor, and dragging out of
        // that same click pulls symmetric direction handles from it, turning the
        // adjoining segments into true cubics (Alt breaks the pairing → cusp).
        // The drag stays live, so `dragRef` is NOT cleared here.
        d.penAnchor = penAnchorRef.current.length / ANCHOR_STRIDE;
        penAnchorRef.current.push(x, y, 0, 0, 0, 0);
        syncPen();
        break;
      }
      case "curvaturepen": {
        // Drop a discrete anchor; the curve re-fits (Catmull-Rom through every
        // clicked anchor) on each click. Finish on double-click/Enter, cancel on Esc.
        curveRef.current = [...curveRef.current, x, y];
        setCurveAnchors(curveRef.current.slice());
        // Expose the live smoothed curve for the Paths panel / Vector Mask ▸ Current Path.
        store.setPenPath(curveRef.current.length >= 6 ? catmullRomResample(curveRef.current, 12) : curveRef.current.slice());
        dragRef.current = null;
        break;
      }
      case "polylasso": {
        const pts = polyLassoRef.current;
        // Clicking the start point (with at least a triangle) closes the polygon.
        if (canClose(pts) && nearPoint(pts[0], pts[1], x, y, 8 / view().zoom)) {
          closePolyLasso();
          dragRef.current = null;
          break;
        }
        if (pts.length === 0) polyLassoModRef.current = { shift: e.shiftKey, alt: e.altKey };
        pts.push(x, y);
        setPolyLassoPts(pts.slice());
        dragRef.current = null;
        break;
      }
      case "text":
      case "horizontaltypemask":
      case "verticaltype":
      case "verticaltypemask": {
        // Photoshop's primary area-type gesture: a drag rubber-bands a
        // paragraph box, committed on pointerup; a within-slop release falls
        // back to point text at the click (see typeBoxFromDrag).
        setPreview({ kind: "rect", x0: x, y0: y, x1: x, y1: y });
        break;
      }
      case "dropper": {
        pickColor(ix, iy);
        break;
      }
      case "singlerow":
      case "singlecolumn": {
        // Click tools: select a 1px row/column spanning the canvas at the click,
        // honouring Shift/Alt combine modes (like the other marquee tools).
        const r = mode === "singlerow" ? singleRowRect(iy, docW, docH) : singleColumnRect(ix, docW, docH);
        E.select_rect(r.x, r.y, r.w, r.h, modeFromKeys(e.shiftKey, e.altKey));
        engine.sync();
        dragRef.current = null;
        break;
      }
      case "ruler": {
        // Start a measurement line; the drag updates its far end.
        store.setRulerLine({ x0: x, y0: y, x1: x, y1: y });
        break;
      }
      case "count": {
        // Alt-click removes the nearest/last marker; plain click drops one.
        if (e.altKey) store.removeLastCountPoint();
        else store.addCountPoint(ix, iy);
        dragRef.current = null; // a click, not a drag
        break;
      }
      case "colorsampler": {
        // Hit-test the nearest sample point within ~8 screen px. Alt-click removes
        // it only when the click lands ON a point (Photoshop parity — an Alt-click
        // in empty canvas does nothing); a plain pointerdown on a point starts a
        // drag-to-move; otherwise a new point is added.
        const hitR = 8 / view().zoom; // screen px → doc units
        const samplers = store.state.colorSamplers;
        const near = nearestSamplerIndex(samplers, x, y);
        const onSampler = near >= 0 && (samplers[near].x - x) ** 2 + (samplers[near].y - y) ** 2 <= hitR * hitR;
        if (e.altKey) { if (onSampler) store.removeNearestColorSampler(x, y); dragRef.current = null; break; }
        if (onSampler) d.samplerIdx = near;        // keep the drag → move on pointermove
        else { store.addColorSampler(ix, iy); dragRef.current = null; }
        break;
      }
      case "note": {
        // Hit-test the nearest note within ~10 screen px. Alt-click on a note
        // deletes it; a plain pointerdown on a note selects it and starts a
        // drag-to-move; clicking empty canvas adds a new note.
        const hitR = 10 / view().zoom; // screen px → doc units
        const ns = store.state.notes;
        const near = nearestNoteIndex(ns, x, y);
        const onNote = near >= 0 && (ns[near].x - x) ** 2 + (ns[near].y - y) ** 2 <= hitR * hitR;
        if (onNote) {
          if (e.altKey) { store.deleteNote(ns[near].id); dragRef.current = null; break; }
          store.selectNote(ns[near].id);
          d.noteId = ns[near].id;                  // keep the drag → move on pointermove
        } else {
          store.addNote(ix, iy);
          dragRef.current = null;
        }
        break;
      }
      case "zoom": {
        const factor = e.altKey ? 1 / 1.4 : 1.4;
        zoomAt(e.clientX, e.clientY, view().zoom * factor);
        break;
      }
      case "rotateview": {
        // Capture the pointer angle about the content centre + the current view
        // rotation; the drag rotates the view by the angular delta.
        const vp = viewportRef.current!.getBoundingClientRect();
        const pvx = vp.left + view().panX + (store.state.doc.width / 2) * view().zoom * parOf();
        const pvy = vp.top + view().panY + (store.state.doc.height / 2) * view().zoom;
        rotateStartRef.current = { a: Math.atan2(e.clientY - pvy, e.clientX - pvx), rot: view().rotationAngle };
        break;
      }
      case "sliceselect": {
        // Slice Select: a handle of the current slice → resize; else select +
        // move the topmost slice under the pointer; else deselect. Selecting works
        // even when locked; the geometry mutators no-op while locked.
        const sls = store.state.slices;
        const sel = store.state.selectedSlice;
        const tol = 6 / view().zoom; // ~6px handle hit radius regardless of zoom
        if (sel >= 0 && sel < sls.length) {
          const hh = hitTestHandle(sls[sel], x, y, tol);
          if (hh >= 0) { d.sliceIdx = sel; d.sliceHandle = hh; d.sliceOrig = sls[sel]; break; }
        }
        const hit = hitTestSlice(sls, x, y);
        store.selectSlice(hit);
        if (hit >= 0) { d.sliceIdx = hit; d.sliceHandle = -1; d.sliceOrig = sls[hit]; }
        else dragRef.current = null; // empty click → just deselect, no drag
        break;
      }
      case "artboard": {
        // Artboard tool: a handle of the selected artboard → resize; else the body
        // of an artboard → select + move; else empty canvas → rubber-band a new
        // artboard. Move/resize commit ONCE on release (a live engine update per
        // pointer step would spam the undo stack); the in-flight bounds preview in
        // `preview`, the static overlay shows the artboard at its pre-drag spot.
        const abs = store.state.artboards;
        const cur = abs.find((a) => a.id === store.state.selectedArtboard);
        const tol = 6 / view().zoom;
        if (cur) {
          const hh = hitTestArtboardHandle(cur, x, y, tol);
          if (hh >= 0) {
            d.artboardId = cur.id; d.artboardHandle = hh;
            d.artboardOrig = { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
            setPreview({ kind: "rect", x0: cur.x, y0: cur.y, x1: cur.x + cur.w, y1: cur.y + cur.h });
            break;
          }
        }
        const hit = hitTestArtboard(abs, x, y);
        if (hit >= 0) {
          const a = abs[hit];
          store.setSelectedArtboard(a.id);
          d.artboardId = a.id; d.artboardHandle = -1;
          d.artboardOrig = { x: a.x, y: a.y, w: a.w, h: a.h };
          setPreview({ kind: "rect", x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.h });
          break;
        }
        store.setSelectedArtboard(0); // empty canvas → deselect + start a create-drag
        setPreview({ kind: "rect", x0: x, y0: y, x1: x, y1: y });
        break;
      }
      case "objectselection":
      case "marquee":
      case "ellipse":
      case "crop":
      case "frame":
      case "slice":
      case "redeye":
      case "shape":
      case "gradient":
        // Object Selection ▸ Lasso hint trails a freehand outline rather than a
        // rubber-band box, so it borrows the Lasso tool's own point buffer.
        if (mode === "objectselection" && store.state.objectSelectionLasso) {
          lassoRef.current = [x, y];
          setLasso([x, y]);
          break;
        }
        setPreview({
          kind: (mode === "gradient" || (mode === "shape" && store.state.shapeKind === "line")) ? "line"
            : (mode === "ellipse" || (mode === "shape" && store.state.shapeKind === "ellipse") || (mode === "frame" && store.state.frameMode === "ellipse")) ? "ellipse"
            : "rect",
          x0: x, y0: y, x1: x, y1: y,
          crop: mode === "crop",
          lineShape: mode === "shape" && store.state.shapeKind === "line",
          clipToDocument: (mode === "marquee" || mode === "ellipse") && store.state.marqueeStyle === "size",
        });
        if (mode === "marquee" || mode === "ellipse") {
          const start = store.state.marqueeStyle === "size" ? snapToGuides(x, y) : { x, y };
          const r = styledSelectionRect(start.x, start.y, x, y, e.shiftKey, e.altKey);
          setPreview((p) => (p ? { ...p, x0: r.x0, y0: r.y0, x1: r.x0 + r.w, y1: r.y0 + r.h } : p));
          store.setSelectionDragRect({ x: r.x0, y: r.y0, w: r.w, h: r.h });
        }
        break;
      default:
        break;
    }
  };

  const pointerDownRef = useRef(onPointerDown);
  pointerDownRef.current = onPointerDown;

  const onPointerMove = (e: React.PointerEvent) => {
    if (passive) return; // hovering a background document: nothing of it is live yet
    const { x, y } = toDoc(e.clientX, e.clientY);
    collab?.setCursor({ x, y }); // publish my cursor (document space) to collaborators
    // Brush cursor (Preferences ▸ Cursors). Caps Lock swaps any cursor for the
    // precise crosshair, as in Photoshop.
    const capsLockOn = e.getModifierState?.("CapsLock") === true;
    if (capsLockOn !== capsLock) setCapsLock(capsLockOn);
    repaintBrushCursor(e);
    if (store.state.cloneOverlay.show && (tool === "clone" || tool === "heal")) drawCloneOverlay({ x, y });

    const d = dragRef.current;
    if (!d) {
      if (x >= 0 && y >= 0 && x < docW && y < docH) {
        store.setCursor({ x: Math.floor(x), y: Math.floor(y) });
      }
      return;
    }
    if (d.mode === "colorsampler") {
      if (d.samplerIdx !== undefined) store.moveColorSampler(d.samplerIdx, x, y);
      return;
    }
    if (d.mode === "note") {
      if (d.noteId !== undefined) store.moveNote(d.noteId, x, y);
      return;
    }
    if (d.symmetryPath) {
      store.movePaintSymmetryPath(
        d.symmetryPath.x + x - d.sx,
        d.symmetryPath.y + y - d.sy,
      );
      return;
    }
    if (d.symmetryOuter) {
      const dx = x - d.symmetryOuter.axisX;
      const dy = y - d.symmetryOuter.axisY;
      const pointerAngle = Math.atan2(dy, dx);
      const delta = Math.atan2(
        Math.sin(pointerAngle - d.symmetryOuter.pointerAngle),
        Math.cos(pointerAngle - d.symmetryOuter.pointerAngle),
      );
      store.movePaintSymmetryPath(
        d.symmetryOuter.axisX,
        d.symmetryOuter.axisY,
        d.symmetryOuter.startAngle + delta * 180 / Math.PI,
        d.symmetryOuter.startScale * Math.hypot(dx, dy) / d.symmetryOuter.pointerDistance,
      );
      return;
    }
    if (d.mode === "directselect") {
      if (d.handleDrag) {
        store.dragSelectedHandle(x, y, d.handleMirror !== false);
        setVectorRev((r) => r + 1);
        return;
      }
      if (d.anchorMarquee) { setAnchorMarquee({ x0: d.sx, y0: d.sy, x1: x, y1: y }); return; }
      // Every selected anchor moves by the SAME delta from its drag-start
      // position, so a multi-anchor drag translates the run rigidly (and the
      // grabbed anchor cannot jump to the cursor when it was grabbed off-centre).
      const origins = d.anchorOrigins ?? [];
      if (!origins.length) return;
      const dx = x - d.sx;
      const dy = y - d.sy;
      // Work-path anchors are host state: one batch, one re-flatten.
      const work = origins.filter((o) => o.item === WORK_PATH_ITEM);
      if (work.length) store.moveWorkPathAnchors(work.map((o) => ({ index: o.index, x: o.x + dx, y: o.y + dy })));
      const layerOrigins = origins.filter((o) => o.item !== WORK_PATH_ITEM);
      const primary = store.state.selectedAnchor;
      const isPrimary = (o: { item: string; index: number }) => !!primary && o.item === primary.item && o.index === primary.index;
      for (const o of layerOrigins) {
        if (!isPrimary(o)) engine.e.vector_move_anchor(d.layerId, o.item, o.index, o.x + dx, o.y + dy);
      }
      // The grabbed anchor goes through the store last — it owns the dirty flag
      // and the re-blit for the whole batch.
      const p = layerOrigins.find(isPrimary);
      if (p) store.dragSelectedAnchor(p.x + dx, p.y + dy);
      else if (layerOrigins.length) { store.markDirty(); engine.refreshFromEngine(); }
      setVectorRev((r) => r + 1);
      return;
    }
    if (d.mode === "pathselect") {
      store.dragSelectedPath(x, y);
      setVectorRev((r) => r + 1);
      return;
    }
    if (d.mode === "vanishingpoint" && (d.vpHandle || d.vpTearOff || d.vpMarquee || d.vpMove)) {
      const planes = store.state.vanishingPointPlanes;
      if (d.vpHandle) {
        store.setOptions({ vanishingPointPlanes: movePlaneHandle(planes, d.vpHandle.plane, d.vpHandle.handle, x, y, docW, docH) });
      } else if (d.vpMarquee) {
        const { plane, u, v } = d.vpMarquee;
        const uv = uvAt(planes[plane]?.quad ?? [], x, y);
        if (uv) {
          const cu = Math.max(0, Math.min(1, uv[0])), cv = Math.max(0, Math.min(1, uv[1]));
          store.setOptions({ vanishingPointMarquee: { plane, u0: Math.min(u, cu), v0: Math.min(v, cv), u1: Math.max(u, cu), v1: Math.max(v, cv) } });
        }
      } else if (d.vpMove) {
        const { kind, u, v, orig } = d.vpMove;
        const over = kind === "float" ? planeAt(planes, x, y) : null;
        let next: VanishingRect | null = null;
        if (over !== null && over !== orig.plane) {
          // A float dragged onto another plane moves onto it, centred on the pointer.
          const uv = uvAt(planes[over].quad, x, y);
          const w = orig.u1 - orig.u0, h = orig.v1 - orig.v0;
          if (uv) next = shiftRect({ plane: over, u0: uv[0] - w / 2, v0: uv[1] - h / 2, u1: uv[0] + w / 2, v1: uv[1] + h / 2 }, 0, 0);
        } else {
          const uv = uvAt(planes[orig.plane]?.quad ?? [], x, y);
          if (uv) next = shiftRect(orig, uv[0] - u, uv[1] - v);
        }
        if (next) store.setOptions(kind === "float" ? { vanishingPointFloat: next } : { vanishingPointMarquee: next });
      }
      return;
    }
    const E = engine.e;
    const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 1;

    switch (d.mode) {
      case "adjustmentbrush":
      case "brush":
      case "pencil":
      case "erase":
      case "clone":
      case "vanishingpoint":
      case "heal":
      case "dodge":
      case "burn":
      case "patternstamp":
      case "colorreplace":
      case "sponge":
      case "blur":
      case "sharpen":
      case "backgrounderaser":
      case "mixerbrush":
      case "historybrush":
      case "smudge": {
        // Brush Smoothing: ease the drawn point toward the cursor (smoothing 0 →
        // the cursor exactly, so the stroke path is unchanged).
        const sp = smoothStrokePoint(smoothPtRef.current ?? { x, y }, { x, y }, store.state.brush.smoothing);
        smoothPtRef.current = sp;
        const r = E.stroke_to(sp.x, sp.y, pressure);
        engine.strokeCapturePoint(sp.x, sp.y, pressure); // no-op unless a brush/erase stroke is being captured
        engine.paintRegion(r[0], r[1], r[2], r[3]);
        d.lx = sp.x; d.ly = sp.y; d.pressure = pressure; // also the Airbrush build-up point
        break;
      }
      case "liquify": {
        // Drag vector (gx, gy) since the last dab drives Push; other modes ignore it.
        store.liquifyDab(x, y, x - d.lx, y - d.ly, pressure);
        d.lx = x; d.ly = y; d.pressure = pressure;
        break;
      }
      case "remove":
      case "spothealing": {
        // Accumulate dab centers along the drag (throttled); the fill runs on release.
        const pts = spotHealPtsRef.current;
        if (Math.hypot(x - pts[pts.length - 2], y - pts[pts.length - 1]) > 2) pts.push(x, y);
        break;
      }
      case "magneticlasso":
      case "lasso": {
        const pts = lassoRef.current;
        const lx = pts[pts.length - 2];
        const ly = pts[pts.length - 1];
        if (Math.hypot(x - lx, y - ly) > 2) {
          pts.push(x, y);
          setLasso(pts.slice());
        }
        break;
      }
      case "freeformpen": {
        const pts = penRef.current;
        if (pts.length < 2 || Math.hypot(x - pts[pts.length - 2], y - pts[pts.length - 1]) > 2) {
          pts.push(x, y);
          setPenPts(pts.slice());
          store.setPenPath(pts.slice());
        }
        break;
      }
      case "pen": {
        // Drag out of the click = pull the new anchor's handles. Alt is read
        // live (not latched at press) so it can break the pairing mid-drag.
        if (d.penAnchor === undefined) break;
        pullAnchorHandles(penAnchorRef.current, d.penAnchor, x, y, !e.altKey);
        syncPen();
        break;
      }
      case "move": {
        if (d.selMove) {
          // Selection float: don't move the whole layer live — preview where the
          // selection will land; the pixels move on release.
          const mdx = Math.round(x - d.sx), mdy = Math.round(y - d.sy);
          const b = d.selBounds!;
          setPreview({ kind: "rect", x0: b[0] + mdx, y0: b[1] + mdy, x1: b[0] + b[2] + mdx, y1: b[1] + b[3] + mdy });
          break;
        }
        // Shift constrains the move to horizontal/vertical/45° (Photoshop).
        const mp = e.shiftKey ? constrain45(d.sx, d.sy, x, y) : { x, y };
        let mdx = Math.round(mp.x - d.sx), mdy = Math.round(mp.y - d.sy);
        // Smart Guides: snap the active layer's edges/centres to other layers'.
        if (showSmartGuides && !e.shiftKey) {
          if (!smartBoundsRef.current) {
            const ab = Array.from(engine.e.active_layer_bounds()); // [x,y,w,h]
            const all = Array.from(engine.e.all_layer_bounds()) as number[]; // [id,x,y,w,h,…]
            const others: Rect[] = [];
            for (let i = 0; i + 4 < all.length; i += 5) {
              if (all[i] !== d.layerId) others.push({ x: all[i + 1], y: all[i + 2], w: all[i + 3], h: all[i + 4] });
            }
            smartBoundsRef.current = { active: { x: ab[0], y: ab[1], w: ab[2], h: ab[3] }, others };
          }
          const sb = smartBoundsRef.current;
          if (sb.active.w > 0 && sb.active.h > 0 && sb.others.length) {
            const snap = smartSnap({ x: sb.active.x + mdx, y: sb.active.y + mdy, w: sb.active.w, h: sb.active.h }, sb.others, 6);
            mdx += snap.dx; mdy += snap.dy;
            setSmartGuides(snap.guides);
          }
        }
        pendingMoveRef.current = { dx: mdx, dy: mdy };
        if (!moveRafRef.current) moveRafRef.current = requestAnimationFrame(flushMove);
        break;
      }
      case "patch":
      case "contentawaremove": {
        // Preview the drag target rect; the op (heal / move) runs on release.
        if (d.selBounds) {
          const mdx = Math.round(x - d.sx), mdy = Math.round(y - d.sy);
          const b = d.selBounds;
          setPreview({ kind: "rect", x0: b[0] + mdx, y0: b[1] + mdy, x1: b[0] + b[2] + mdx, y1: b[1] + b[3] + mdy });
        }
        break;
      }
      case "quickselection": {
        // Grow the selection along the drag — Alt keeps subtracting.
        store.quickSelectionAt(Math.round(x), Math.round(y), d.alt ? 2 : 1, false);
        break;
      }
      case "hand": {
        store.setPan(d.panX0 + (e.clientX - d.clientX0), d.panY0 + (e.clientY - d.clientY0), paneDocId);
        break;
      }
      case "rotateview": {
        const rs = rotateStartRef.current;
        if (!rs) break;
        const vp = viewportRef.current!.getBoundingClientRect();
        const pvx = vp.left + view().panX + (store.state.doc.width / 2) * view().zoom * parOf();
        const pvy = vp.top + view().panY + (store.state.doc.height / 2) * view().zoom;
        const a = Math.atan2(e.clientY - pvy, e.clientX - pvx);
        store.setRotation(rs.rot + (a - rs.a) * 180 / Math.PI, paneDocId);
        break;
      }
      case "objectselection":
      case "marquee":
      case "ellipse":
      case "frame":
      case "shape": {
        if (d.mode === "objectselection" && lassoRef.current.length) {
          const pts = lassoRef.current;
          if (Math.hypot(x - pts[pts.length - 2], y - pts[pts.length - 1]) > 2) {
            pts.push(x, y);
            setLasso(pts.slice());
          }
          break;
        }
        // Line shape: preview the true drag endpoints (Shift→45°), not a bbox rect —
        // matches the commit path, so the rubber-band can't mirror the slope.
        if (d.mode === "shape" && store.state.shapeKind === "line") {
          const end = e.shiftKey ? constrain45(d.sx, d.sy, x, y) : { x, y };
          setPreview((p) => (p ? { ...p, x0: d.sx, y0: d.sy, x1: end.x, y1: end.y } : p));
          break;
        }
        // Photoshop: Shift held WHILE dragging constrains a marquee/shape to a
        // perfect square/circle; Alt/Option draws it from the center. (For the
        // marquee the combine mode was already fixed from the pointer-down keys.)
        // The marquee/ellipse Style option (Fixed Ratio / Fixed Size) constrains the
        // preview to match the commit; the Shape tool always uses the free rect.
        const start = (d.mode === "marquee" || d.mode === "ellipse") && store.state.marqueeStyle === "size"
          ? snapToGuides(d.sx, d.sy)
          : { x: d.sx, y: d.sy };
        const r = (d.mode === "marquee" || d.mode === "ellipse")
          ? styledSelectionRect(start.x, start.y, x, y, e.shiftKey, e.altKey)
          : marqueeRect(d.sx, d.sy, x, y, e.shiftKey, e.altKey);
        setPreview((p) => (p ? { ...p, x0: r.x0, y0: r.y0, x1: r.x0 + r.w, y1: r.y0 + r.h } : p));
        if (d.mode === "marquee" || d.mode === "ellipse") {
          store.setSelectionDragRect({ x: r.x0, y: r.y0, w: r.w, h: r.h });
        }
        break;
      }
      case "gradient": {
        // Shift constrains the gradient line to a 45° axis (Photoshop).
        const gp = e.shiftKey ? constrain45(d.sx, d.sy, x, y) : { x, y };
        setPreview((p) => (p ? { ...p, x1: gp.x, y1: gp.y } : p));
        break;
      }
      case "text":
      case "horizontaltypemask":
      case "verticaltype":
      case "verticaltypemask":
      case "redeye":
        // Type (area box) / Red Eye: a plain rubber-band rect.
        setPreview((p) => (p ? { ...p, x1: x, y1: y } : p));
        break;
      case "crop": {
        // With a Ratio preset, constrain the crop box to that aspect; Free uses
        // the raw drag rect.
        const cr = aspectRatioFor(store.state.cropAspect);
        if (cr > 0) {
          const r = fitRectToAspect(d.sx, d.sy, x, y, cr);
          setPreview((p) => (p ? { ...p, x0: r.x0, y0: r.y0, x1: r.x0 + r.w, y1: r.y0 + r.h } : p));
        } else {
          setPreview((p) => (p ? { ...p, x1: x, y1: y } : p));
        }
        break;
      }
      case "ruler": {
        // Shift constrains the measurement line to a 45° axis (Photoshop).
        const rp = e.shiftKey ? constrain45(d.sx, d.sy, x, y) : { x, y };
        store.setRulerLine({ x0: d.sx, y0: d.sy, x1: rp.x, y1: rp.y });
        break;
      }
      case "slice":
        // Plain rubber-band rect; committed as a new slice on release.
        setPreview((p) => (p ? { ...p, x1: x, y1: y } : p));
        break;
      case "sliceselect": {
        // Live move/resize from the geometry captured at pointerdown (absolute →
        // no drift). Blocked while locked (the store mutator no-ops).
        if (d.sliceIdx === undefined || !d.sliceOrig) break;
        if (d.sliceHandle !== undefined && d.sliceHandle >= 0) {
          store.setSelectedSliceGeom(resizeSliceTo(d.sliceOrig, d.sliceHandle, x, y));
        } else {
          store.setSelectedSliceGeom(moveSliceBy(d.sliceOrig, x - d.sx, y - d.sy));
        }
        break;
      }
      case "artboard": {
        // Preview the projected bounds (move/resize an existing artboard, or
        // rubber-band a new one). The actual engine update happens once on release.
        if (d.artboardId !== undefined && d.artboardOrig) {
          const r = d.artboardHandle !== undefined && d.artboardHandle >= 0
            ? resizeArtboardTo(d.artboardOrig, d.artboardHandle, x, y)
            : moveArtboardBy(d.artboardOrig, x - d.sx, y - d.sy);
          setPreview((p) => (p ? { ...p, x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h } : p));
        } else {
          const r = artboardRect(d.sx, d.sy, x, y, e.shiftKey, e.altKey);
          setPreview((p) => (p ? { ...p, x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h } : p));
        }
        break;
      }
      default:
        break;
    }
  };

  const finishStrokeDrag = (end?: { x: number; y: number; pressure: number }) => {
    const E = engine.e;
    // A normal release catches smoothing up to the pointer. Pointer cancellation
    // commits only the already-painted portion; its coordinates are not reliable.
    const sm = smoothPtRef.current;
    if (end && store.state.brush.smoothing > 0 && sm && (sm.x !== end.x || sm.y !== end.y)) {
      const r = E.stroke_to(end.x, end.y, end.pressure);
      engine.strokeCapturePoint(end.x, end.y, end.pressure);
      engine.paintRegion(r[0], r[1], r[2], r[3]);
    }
    smoothPtRef.current = null;
    try {
      E.stroke_end();
    } finally {
      engine.strokeCaptureEnd();
      store.endBrushStroke();
    }
    engine.commit();
    if (end) lastBrushPtRef.current = { x: end.x, y: end.y };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    repaintBrushCursor(e);
    const d = dragRef.current;
    dragRef.current = null;
    cloneOverlayImgRef.current = null; // the release may have changed what the overlay shows
    clearLiquifyRateTimer(); // CRITICAL: pointer released → the Rate repeat must stop, unconditionally
    clearAirbrushTimer();    // …and so must the Airbrush build-up repeat
    if (smartBoundsRef.current) { smartBoundsRef.current = null; setSmartGuides([]); } // end the drag → drop guides
    if (!d) return;
    const E = engine.e;
    const { x, y } = toDoc(e.clientX, e.clientY);
    const rectOf = () => {
      const x0 = Math.round(Math.min(d.sx, x));
      const y0 = Math.round(Math.min(d.sy, y));
      const w = Math.round(Math.abs(x - d.sx));
      const h = Math.round(Math.abs(y - d.sy));
      return { x0, y0, w, h };
    };
    if (d.mode === "vanishingpoint" && (d.vpHandle || d.vpTearOff || d.vpMarquee || d.vpMove)) {
      if (d.vpTearOff) store.tearOffVanishingPlane(d.vpTearOff.plane, d.vpTearOff.edge);
      return;
    }
    if (d.symmetryPath || d.symmetryOuter) return;
    if (d.strokeActive) {
      finishStrokeDrag({ x, y, pressure: e.pointerType === "pen" ? e.pressure || 0.5 : 1 });
      setPreview(null);
      return;
    }

    switch (d.mode) {
      case "directselect":
        if (d.anchorMarquee) {
          // Rubber band released: take every anchor it enclosed (shift adds).
          const hits = anchorsInRect(vectorPaths, d.sx, d.sy, x, y);
          setPathAnchors((prev) => {
            if (!d.shift) return hits;
            const seen = new Set(prev.map(anchorKey));
            return [...prev, ...hits.filter((a) => !seen.has(anchorKey(a)))];
          });
          setAnchorMarquee(null);
        }
        store.endAnchorDrag();
        break;
      case "pathselect":
        store.endPathDrag();
        break;
      case "remove": {
        // MI-GAN inpaint when installed; classic content-aware heal otherwise.
        void removeStroke(spotHealPtsRef.current, store.state.brush.size / 2);
        spotHealPtsRef.current = [];
        break;
      }
      case "spothealing": {
        // Content-aware-fill the accumulated footprint from its surroundings.
        store.spotHeal(spotHealPtsRef.current, store.state.brush.size / 2);
        spotHealPtsRef.current = [];
        break;
      }
      case "freeformpen": {
        // Smooth the freehand path, then fill it like a closed pen path.
        if (penRef.current.length >= 6) {
          // ponytail: anchor fit = every 8th raw sample (≈ a handful of anchors
          // per stroke). A curvature-adaptive fit is the upgrade path.
          const dec: number[] = [];
          for (let i = 0; i < penRef.current.length; i += 16) dec.push(penRef.current[i], penRef.current[i + 1]);
          if (dec.length >= 6) store.setPenAnchors(catmullRomAnchors(dec, true));
          penRef.current = catmullRomResample(penRef.current, 6);
          closePen(); // select_polygon + fill + commit; clears penRef
        } else {
          penRef.current = [];
          setPenPts(null);
          store.setPenPath([]);
        }
        break;
      }
      case "magneticlasso": {
        const pts = lassoRef.current;
        if (pts.length >= 6) {
          const n = pts.length / 2;
          const xs: number[] = [], ys: number[] = [];
          for (let i = 0; i < n; i++) { xs.push(pts[i * 2]); ys.push(pts[i * 2 + 1]); }
          store.magneticLassoApply(xs, ys, modeFromKeys(d.shift, d.alt)); // snaps to edges, then selects
          applyFeather();
          engine.sync();
        }
        lassoRef.current = [];
        setLasso(null);
        break;
      }
      case "lasso": {
        const pts = lassoRef.current;
        if (pts.length >= 6) {
          const n = pts.length / 2;
          const xs = new Float32Array(n);
          const ys = new Float32Array(n);
          for (let i = 0; i < n; i++) { xs[i] = pts[i * 2]; ys[i] = pts[i * 2 + 1]; }
          E.set_selection_antialias(store.state.antiAlias);
          E.select_polygon(xs, ys, modeFromKeys(d.shift, d.alt));
          applyFeather();
          engine.sync();
          actions.recordTool(["selectPolygon", [xs, ys, modeFromKeys(d.shift, d.alt)]]);
        }
        lassoRef.current = [];
        setLasso(null);
        break;
      }
      case "move": {
        // Apply the final pending offset (a coalesced frame may still be queued)
        // before baking it into the layer pixels.
        if (moveRafRef.current) { cancelAnimationFrame(moveRafRef.current); moveRafRef.current = 0; }
        const mEnd = e.shiftKey ? constrain45(d.sx, d.sy, x, y) : { x, y };
        let fdx = Math.round(mEnd.x - d.sx);
        let fdy = Math.round(mEnd.y - d.sy);
        // Selection float: relocate the selected pixels + marquee, leaving a hole.
        if (d.selMove) {
          setPreview(null);
          if (fdx !== 0 || fdy !== 0) {
            const [bgr, bgg, bgb] = hsvToRgba(store.state.bg);
            E.move_selection(fdx, fdy, bgr, bgg, bgb);
            engine.commit();
          } else {
            engine.sync();
          }
          break;
        }
        if (pendingMoveRef.current) {
          const p = pendingMoveRef.current;
          E.move_layer_offset(d.layerId, p.dx, p.dy);
          appliedMoveRef.current = p;
          pendingMoveRef.current = null;
        }
        // The offset the engine is holding is the authority, not the raw pointer
        // delta: Smart Guides snap the drag (up to 6 doc px, and the last frame
        // has usually flushed by release), so recomputing it here re-anchored a
        // text layer off its previewed snap — or read 0 while a non-zero snap was
        // live, skipping the text branch and letting commit_offset bake an offset
        // the spec never learned about (#5).
        const applied = appliedMoveRef.current;
        appliedMoveRef.current = null;
        if (applied) { fdx = applied.dx; fdy = applied.dy; }
        // A live type layer moves by re-anchoring its spec, not by baking
        // pixels — commit_offset would leave the spec's ax/ay stale, snapping
        // the text back to the old spot on the next edit.
        if (E.layer_kind(d.layerId) === LAYER_KIND.text && (fdx !== 0 || fdy !== 0)) {
          const spec = text.get(d.layerId);
          if (spec) {
            E.move_layer_offset(d.layerId, 0, 0); // reset the live offset
            text.apply(d.layerId, { ...spec, ax: spec.ax + fdx, ay: spec.ay + fdy });
            break;
          }
        }
        E.commit_offset(d.layerId);
        engine.commit();
        break;
      }
      case "patch": {
        // Heal the selection from the dragged-to source region (offset = the drag).
        setPreview(null);
        const pdx = Math.round(x - d.sx), pdy = Math.round(y - d.sy);
        if (d.selBounds && (pdx !== 0 || pdy !== 0)) store.patchSelectionBy(pdx, pdy);
        else engine.sync();
        break;
      }
      case "contentawaremove": {
        // Relocate the selection's contents by the drag and content-aware-fill the
        // source it vacates — one undo step (recordable action). Transform On
        // Drop previews it under a live frame instead, committed on Enter.
        setPreview(null);
        const cdx = Math.round(x - d.sx), cdy = Math.round(y - d.sy);
        const o = store.state;
        if (!d.selBounds || (cdx === 0 && cdy === 0)) engine.sync();
        else if (o.camTransformOnDrop) beginContentAwareMoveDrop(cdx, cdy);
        else contentAwareMoveBy(cdx, cdy, o.camExtend, o.camStructure, o.camColor);
        break;
      }
      case "quickselection": {
        // The selection grew live during the drag; soften by the Feather option.
        applyFeather();
        engine.sync();
        break;
      }
      case "rotateview": {
        rotateStartRef.current = null; // release the captured drag anchor
        break;
      }
      case "text":
      case "horizontaltypemask":
      case "verticaltype":
      case "verticaltypemask": {
        // Past the slop → area type: the drag rect becomes a fixed paragraph
        // box. Within it → point text at the pointer-down spot (as before).
        const box = typeBoxFromDrag(d.sx, d.sy, x, y, view().zoom);
        if (box) doText(box.x, box.y, box);
        else doText(Math.floor(d.sx), Math.floor(d.sy));
        break;
      }
      case "objectselection": {
        // Shift/Alt still override, exactly like every other selection tool;
        // with neither held the options-bar Mode decides.
        const mode = d.shift || d.alt ? modeFromKeys(d.shift, d.alt) : store.state.selMode;
        const tol = store.state.objectSelectionTolerance;
        const pts = lassoRef.current;
        if (store.state.objectSelectionLasso) {
          if (pts.length >= 6) store.selectObjectLasso(pts.slice(), tol, mode);
          lassoRef.current = [];
          setLasso([]);
          engine.sync();
          break;
        }
        const { x0, y0, w, h } = marqueeRect(d.sx, d.sy, x, y, e.shiftKey, e.altKey);
        if (w > 1 && h > 1) store.selectObject(x0, y0, w, h, tol, mode);
        else E.select_none();
        engine.sync();
        break;
      }
      case "marquee": {
        // Geometry honours live Shift (square) / Alt (from-center) and the Style
        // option (Fixed Ratio / Fixed Size); the combine mode honours the modifiers
        // sampled at pointer-down (d.shift/d.alt).
        const a = snapToGuides(d.sx, d.sy), b = snapToGuides(x, y);
        const { x0, y0, w, h } = styledSelectionRect(a.x, a.y, b.x, b.y, e.shiftKey, e.altKey);
        if (w > 0 && h > 0) {
          E.select_rect(x0, y0, w, h, modeFromKeys(d.shift, d.alt));
          applyFeather();
          actions.recordTool(["selectRect", [x0, y0, w, h, modeFromKeys(d.shift, d.alt)]]);
        } else E.select_none();
        engine.sync();
        break;
      }
      case "ellipse": {
        const a = snapToGuides(d.sx, d.sy), b = snapToGuides(x, y);
        const { x0, y0, w, h } = styledSelectionRect(a.x, a.y, b.x, b.y, e.shiftKey, e.altKey);
        E.set_selection_antialias(store.state.antiAlias);
        if (w > 0 && h > 0) {
          E.select_ellipse(x0, y0, w, h, modeFromKeys(d.shift, d.alt));
          applyFeather();
          actions.recordTool(["selectEllipse", [x0, y0, w, h, modeFromKeys(d.shift, d.alt)]]);
        }
        engine.sync();
        break;
      }
      case "shape": {
        // Line shape: drawn from the drag endpoints (not a bbox); Shift constrains
        // to 0/45/90°, like the gradient tool. Filled as a weight-thick quad.
        if (store.state.shapeKind === "line") {
          const end = e.shiftKey ? constrain45(d.sx, d.sy, x, y) : { x, y };
          // Mode (Photoshop's Shape/Path/Pixels dropdown): Shape → a live vector
          // line layer, Path → the work path quad, Pixels → the raster fill below.
          if (store.state.shapeMode === "shape") {
            store.addShapeLayerItems(lineShapeItems(store.state, d.sx, d.sy, end.x, end.y));
            break;
          }
          if (store.state.shapeMode === "path") {
            store.setPenPath(lineQuad(d.sx, d.sy, end.x, end.y, store.state.lineWeight));
            break;
          }
          const [r, g, b, a] = hsvToRgba(store.state.fg);
          // Fill a 4-point polygon (flat [x,y×4]) with the foreground colour.
          const fillPoly = (flat: number[]) => {
            if (flat.length !== 8) return;
            E.select_polygon(Float32Array.from([flat[0], flat[2], flat[4], flat[6]]), Float32Array.from([flat[1], flat[3], flat[5], flat[7]]), 0);
            E.fill_selection(r, g, b, a);
            E.select_none();
          };
          fillPoly(lineQuad(d.sx, d.sy, end.x, end.y, store.state.lineWeight));
          const s = store.state;
          if (s.lineArrowEnd) fillPoly(arrowheadPolygon(end.x, end.y, end.x - d.sx, end.y - d.sy, s.lineArrowWidth, s.lineArrowLength, s.lineArrowConcavity));
          if (s.lineArrowStart) fillPoly(arrowheadPolygon(d.sx, d.sy, d.sx - end.x, d.sy - end.y, s.lineArrowWidth, s.lineArrowLength, s.lineArrowConcavity));
          engine.commit();
          break;
        }
        // Shift → square/circle, Alt → from center (Photoshop, same as the marquee).
        const a = snapToGuides(d.sx, d.sy), b = snapToGuides(x, y);
        const { x0, y0, w, h } = marqueeRect(a.x, a.y, b.x, b.y, e.shiftKey, e.altKey);
        // Shape mode: a live, forever re-editable vector layer; Path mode: just
        // the work path (Paths panel). Neither touches raster pixels.
        if (store.state.shapeMode !== "pixels") {
          if (w > 0 && h > 0) {
            if (store.state.shapeMode === "shape") store.addShapeLayerItems([shapeBBoxItem(store.state, x0, y0, w, h)]);
            else store.setPenPath(shapeOutlineVerts(store.state, x0, y0, w, h));
          }
          break;
        }
        if (w > 0 && h > 0) {
          const kind = store.state.shapeKind;
          const custom = kind === "custom" ? store.state.customShapes[store.state.activeCustomShape] : undefined;
          if (custom) {
            const { xs, ys } = denormalizePath(custom.path, x0, y0, w, h);
            E.select_polygon(xs, ys, 0);
          } else if (kind === "polygon") {
            const verts = polygonVertices(x0 + w / 2, y0 + h / 2, w / 2, h / 2, store.state.polygonSides, store.state.polygonStar, store.state.polygonIndent);
            const n = verts.length / 2;
            const xs = new Float32Array(n), ys = new Float32Array(n);
            for (let i = 0; i < n; i++) { xs[i] = verts[i * 2]; ys[i] = verts[i * 2 + 1]; }
            E.select_polygon(xs, ys, 0);
          } else if (kind === "roundrect") {
            const verts = roundedRectVertices(x0, y0, w, h, store.state.roundRectRadius);
            const n = verts.length / 2;
            const xs = new Float32Array(n), ys = new Float32Array(n);
            for (let i = 0; i < n; i++) { xs[i] = verts[i * 2]; ys[i] = verts[i * 2 + 1]; }
            E.select_polygon(xs, ys, 0);
          } else if (kind === "ellipse") {
            E.select_ellipse(x0, y0, w, h, 0);
          } else {
            E.select_rect(x0, y0, w, h, 0);
          }
          const [r, g, b, a] = hsvToRgba(store.state.fg);
          E.fill_selection(r, g, b, a);
          E.select_none();
          // Shape Stroke (Rectangle / Ellipse): fill an outline ring with the bg
          // colour — select the outer rect/ellipse, subtract the inner, fill.
          const ring = (kind === "rect" || kind === "ellipse")
            ? strokeRingRects(x0, y0, w, h, store.state.shapeStrokeWidth, store.state.shapeStrokeAlign) : null;
          if (ring) {
            const o = ring.outer, i = ring.inner;
            if (kind === "ellipse") {
              E.select_ellipse(o.x, o.y, o.w, o.h, 0);
              if (i.w > 0 && i.h > 0) E.select_ellipse(i.x, i.y, i.w, i.h, 2);
            } else {
              E.select_rect(o.x, o.y, o.w, o.h, 0);
              if (i.w > 0 && i.h > 0) E.select_rect(i.x, i.y, i.w, i.h, 2);
            }
            const [sr, sg, sb, sa] = hsvToRgba(store.state.bg);
            E.fill_selection(sr, sg, sb, sa);
            E.select_none();
          }
        }
        engine.commit();
        break;
      }
      case "redeye": {
        // Red Eye: neutralize red-dominant pixels inside the dragged rect.
        const { x0, y0, w, h } = rectOf();
        if (w > 0 && h > 0) {
          const { pupil, darken } = redEyeArgs(store.state.redeyePupil, store.state.redeyeDarken);
          E.remove_red_eye(x0, y0, w, h, pupil, darken);
          engine.commit();
        }
        break;
      }
      case "crop": {
        // Honour the Ratio preset (Free → raw drag rect).
        const cr = aspectRatioFor(store.state.cropAspect);
        const { x0, y0, w, h } = cr > 0 ? fitRectToAspect(d.sx, d.sy, x, y, cr) : rectOf();
        if (w > 2 && h > 2) {
          // Content-Aware crop fills any border the box exposes beyond the canvas.
          if (store.state.cropContentAware) E.crop_content_aware(x0, y0, w, h);
          else E.crop(x0, y0, w, h);
          // Delete Cropped Pixels: raw by contract, so it folds into the crop's
          // own undo step rather than adding a second one.
          if (store.state.cropDeletePixels) E.delete_cropped_pixels();
          if (engine.commit()) {
            store.remapDocSpaceAnnotations(1, 1, -x0, -y0);
            store.requestFit();
          }
        }
        break;
      }
      case "frame": {
        // Frame tool (K): a drag creates an empty placeholder frame of those
        // bounds (Shift → square, Alt → from centre). A click makes nothing.
        const { x0, y0, w, h } = marqueeRect(d.sx, d.sy, x, y, e.shiftKey, e.altKey);
        if (frameIsValid(w, h)) store.createFrame(x0, y0, w, h);
        break;
      }
      case "slice": {
        // Commit the dragged rect as a new user slice (a click → no slice).
        store.addSliceRect(d.sx, d.sy, x, y);
        break;
      }
      case "artboard": {
        if (d.artboardId !== undefined && d.artboardOrig) {
          // Commit the move/resize once (no-op when nothing changed → no undo step).
          const r = d.artboardHandle !== undefined && d.artboardHandle >= 0
            ? resizeArtboardTo(d.artboardOrig, d.artboardHandle, x, y)
            : moveArtboardBy(d.artboardOrig, x - d.sx, y - d.sy);
          const o = d.artboardOrig;
          if (r.x !== o.x || r.y !== o.y || r.w !== o.w || r.h !== o.h) {
            store.setArtboardBounds(d.artboardId, r.x, r.y, r.w, r.h);
          }
        } else {
          // Create a new artboard of the dragged bounds (a click → nothing).
          const r = artboardRect(d.sx, d.sy, x, y, e.shiftKey, e.altKey);
          if (artboardDragIsValid(r.w, r.h)) store.createArtboardRect(r.x, r.y, r.w, r.h);
        }
        break;
      }
      case "gradient": {
        // Multi-stop ramp from the gradient editor (pos 0..1, rgba 0..1 per stop).
        const gs = [...store.state.gradientStops].sort((a, b) => a.pos - b.pos);
        const stops = new Float32Array(gs.flatMap((s) => [s.pos, s.r / 255, s.g / 255, s.b / 255, s.a / 255]));
        const GKIND = { linear: 0, radial: 1, angle: 2, reflected: 3, diamond: 4 } as const;
        const GMETHOD = { classic: 0, perceptual: 1, linear: 2 } as const;
        const gEnd = e.shiftKey ? constrain45(d.sx, d.sy, x, y) : { x, y };
        E.gradient_fill(d.sx, d.sy, gEnd.x, gEnd.y, GKIND[store.state.gradientType], store.state.gradientReverse, stops, store.state.gradientDither, store.state.gradientTransparency, GMETHOD[store.state.gradientMethod], blendIndex(store.state.gradientMode), store.state.gradientOpacity);
        engine.commit();
        break;
      }
      default:
        break;
    }
    setPreview(null);
    store.setSelectionDragRect(null);
  };

  const onPointerCancel = () => {
    if (cursorPointerRef.current) cursorPointerRef.current.buttons = 0;
    repaintBrushCursor();
    const d = dragRef.current;
    dragRef.current = null;
    clearLiquifyRateTimer(); // CRITICAL: pointer cancelled → the Rate repeat must stop, unconditionally
    clearAirbrushTimer();    // …and so must the Airbrush build-up repeat
    if (moveRafRef.current) cancelAnimationFrame(moveRafRef.current);
    moveRafRef.current = 0;
    pendingMoveRef.current = null;
    appliedMoveRef.current = null;
    smartBoundsRef.current = null;
    setSmartGuides([]);
    setPreview(null);
    store.setSelectionDragRect(null);
    if (!d) return;

    // A paint stroke is already live, so preserve its painted portion and close
    // the WASM/collaboration transaction. Other tools must never run pointerup's
    // destructive commit path after the browser cancels their gesture.
    if (d.strokeActive) {
      finishStrokeDrag();
      return;
    }
    if (d.mode === "move" && !d.selMove) {
      const r = engine.e.move_layer_offset(d.layerId, 0, 0);
      engine.e.commit_offset(d.layerId); // clear move_bbox; zero offset creates no edit
      if (r[2] > 0 && r[3] > 0) engine.blitRegion(r[0], r[1], r[2], r[3]);
    } else if (d.mode === "directselect") {
      setAnchorMarquee(null); // cancelled band selects nothing
      store.endAnchorDrag();
    } else if (d.mode === "pathselect") {
      store.endPathDrag();
    } else if (d.mode === "sliceselect" && d.sliceOrig) {
      store.setSelectedSliceGeom(d.sliceOrig);
    } else if (d.mode === "quickselection") {
      engine.sync();
    }
    if (d.mode === "magneticlasso" || d.mode === "lasso") {
      lassoRef.current = [];
      setLasso(null);
    }
    if (d.mode === "freeformpen") {
      penRef.current = [];
      setPenPts(null);
      store.setPenPath([]);
    }
    if (d.mode === "remove" || d.mode === "spothealing") spotHealPtsRef.current = [];
    if (d.mode === "rotateview") rotateStartRef.current = null;
  };

  const pickColor = (ix: number, iy: number) => {
    // Eyedropper "Sample Size": N=1 → Point Sample (radius 0); else average a
    // (2·radius+1)² window, radius = (N−1)/2.
    const radius = Math.max(0, Math.floor((store.state.sampleSize - 1) / 2));
    // Eyedropper "Sample" source: All Layers / Current Layer / Current & Below.
    const packed = engine.e.pick_sample(ix, iy, radius, store.state.sampleMode);
    const r = (packed >>> 24) & 255;
    const g = (packed >>> 16) & 255;
    const b = (packed >>> 8) & 255;
    const a = packed & 255;
    store.setForeground({ ...rgbToHsv({ r, g, b }), a: store.state.fg.a });
    store.setPicked({ r, g, b, a });
  };

  // Type tool: create a new text layer here. It becomes the active layer, so
  // the docked Type toolbar appears automatically (no modal popup). `box` is
  // the drag-created area-type rect (paragraph mode); absent = point text.
  const doText = (ix: number, iy: number, box?: Slice) => {
    const t = store.state.tool;
    const vertical = t === "verticaltype" || t === "verticaltypemask";
    const id = text.createAt(ix, iy, {
      ...(vertical ? { vertical: true } : {}),
      ...(box ? { kind: "paragraph" as const, boxW: box.w, boxH: box.h } : {}),
    });
    // Type Mask tools: the layer becomes a selection when the edit is committed.
    if (t === "horizontaltypemask" || t === "verticaltypemask") store.markTypeMask(id);
  };

  // Re-edit a text layer (double-click): open the on-canvas editor with the
  // caret at the end of the existing text. Vertical type is edited via the
  // toolbar (the on-canvas editor lays out horizontally).
  const editText = (id: number) => {
    if (engine.e.layer_kind(id) !== LAYER_KIND.text) return;
    const spec = text.get(id);
    // Vertical and path-on-curve type edit via the toolbar (the on-canvas editor
    // lays out a horizontal block), not the in-place caret.
    if (spec?.vertical || (spec?.path && spec.path.length >= 4)) { store.selectLayer(id); return; }
    store.beginTextEdit(id, false);
  };

  // Close the current pen path. Pixels mode fills the polygon on the active
  // layer with FG; Shape mode commits it as an editable kind-3 vector layer
  // instead (Photoshop's Pen mode dropdown).
  const syncPen = () => {
    const a = penAnchorRef.current;
    // Open flatten: an in-progress path must not preview a closing edge, and the
    // rubber band has to start at the LAST anchor (the flattening's last point).
    penRef.current = flattenAnchorPath(a, 0.25, false);
    setPenPts(penRef.current.slice());
    setPenAnchorPath(a.slice());
    store.setPenAnchors(a.slice()); // work path (bezier + closed flattening) for Vector Mask ▸ Current Path
  };

  const closePen = () => {
    // The Pen's own bezier anchors win: closing them re-flattens WITH the wrap
    // segment, so the closing curve honours its handles instead of being a chord.
    const penBezier = penAnchorRef.current;
    const pts = hasAnchorForm(penBezier) ? flattenAnchorPath(penBezier) : penRef.current;
    if (pts.length >= 6) {
      if (store.state.penMode === "shape") {
        const anchors = hasAnchorForm(penBezier) ? penBezier : store.state.penAnchors;
        store.addShapeLayerFromPath(pts, hasAnchorForm(anchors) ? anchors : undefined);
      } else {
        const n = pts.length / 2;
        const xs = new Float32Array(n);
        const ys = new Float32Array(n);
        for (let i = 0; i < n; i++) { xs[i] = pts[i * 2]; ys[i] = pts[i * 2 + 1]; }
        const E = engine.e;
        E.select_polygon(xs, ys, 0);
        const [r, g, b, a] = hsvToRgba(store.state.fg);
        E.fill_selection(r, g, b, a);
        E.select_none();
        engine.commit();
      }
    }
    penAnchorRef.current = [];
    setPenAnchorPath(null);
    penRef.current = [];
    setPenPts(null);
    store.setPenPath([]);
  };

  // Curvature Pen: fit a smooth Catmull-Rom curve through the clicked anchors,
  // then fill it like a closed pen path (reusing closePen's polygon fill + commit).
  const commitCurvePen = () => {
    const anchors = curveRef.current;
    if (anchors.length >= 6) {
      // True cubics through the clicked anchors — Shape mode and the Paths
      // panel keep an editable bezier; the polyline is just the fill form.
      const bezier = catmullRomAnchors(anchors, true);
      penAnchorRef.current = bezier.slice();
      store.setPenAnchors(bezier);
      penRef.current = catmullRomResample(anchors, 12);
      closePen(); // select_polygon + fill + commit; clears penRef + penPath
    }
    curveRef.current = [];
    setCurveAnchors(null);
    store.setPenPath([]);
  };
  const cancelCurvePen = () => {
    curveRef.current = [];
    setCurveAnchors(null);
    store.setPenPath([]);
  };

  // Polygonal Lasso: close the accumulated vertices into a selection (anti-aliased,
  // with the combine mode sampled at the first click), then reset.
  const closePolyLasso = () => {
    const pts = polyLassoRef.current;
    if (canClose(pts)) {
      const { xs, ys } = polygonArrays(pts);
      const E = engine.e;
      E.set_selection_antialias(store.state.antiAlias);
      E.select_polygon(xs, ys, modeFromKeys(polyLassoModRef.current.shift, polyLassoModRef.current.alt));
      applyFeather();
      engine.sync();
    }
    polyLassoRef.current = [];
    setPolyLassoPts(null);
  };
  // Escape cancels an in-progress marquee without creating a selection or
  // leaving its live Info-panel geometry behind.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const d = dragRef.current;
      if (e.key !== "Escape" || (d?.mode !== "marquee" && d?.mode !== "ellipse")) return;
      e.preventDefault();
      dragRef.current = null;
      setPreview(null);
      store.setSelectionDragRect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Cancel an in-progress polygon when leaving the tool or pressing Escape.
  useEffect(() => {
    if (tool !== "polylasso") {
      if (polyLassoRef.current.length) { polyLassoRef.current = []; setPolyLassoPts(null); }
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && polyLassoRef.current.length) {
        e.preventDefault();
        polyLassoRef.current = [];
        setPolyLassoPts(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);

  // Curvature Pen: Enter (or double-click) commits the curve, Escape cancels it,
  // and leaving the tool discards any in-progress anchors (mirrors the Poly Lasso).
  useEffect(() => {
    if (tool !== "curvaturepen") {
      if (curveRef.current.length) cancelCurvePen();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "Enter") { e.preventDefault(); commitCurvePen(); }
      else if (e.key === "Escape" && curveRef.current.length) { e.preventDefault(); cancelCurvePen(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers read refs/store/engine fresh; rebind only on tool change
  }, [tool]);

  // Image ▸ Transform Symmetry follows the standard path-transform contract:
  // Enter commits the similarity transform; Escape restores its starting path.
  useEffect(() => {
    if (!paintSymmetryTransforming) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        dragRef.current = null;
        store.commitPaintSymmetryTransform();
      } else if (e.key === "Escape") {
        e.preventDefault();
        dragRef.current = null;
        store.cancelPaintSymmetryTransform();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paintSymmetryTransforming]);

  const zoomAt = (clientX: number, clientY: number, nextZoom: number) => {
    const vp = viewportRef.current!.getBoundingClientRect();
    const z0 = view().zoom;
    const z1 = Math.max(0.02, Math.min(32, nextZoom));
    const par = parOf(); // x axis carries the pixel-aspect stretch; keep the point fixed
    const docx = (clientX - vp.left - view().panX) / (z0 * par);
    const docy = (clientY - vp.top - view().panY) / z0;
    const panX = clientX - vp.left - docx * z1 * par;
    const panY = clientY - vp.top - docy * z1;
    store.setZoom(z1, panX, panY, paneDocId);
  };

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, view().zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    } else {
      store.setPan(view().panX - e.deltaX, view().panY - e.deltaY, paneDocId);
    }
  };
  // react-dom attaches its delegated wheel listener passively, so preventDefault()
  // inside a JSX onWheel is a no-op and ctrl+wheel / pinch page-zooms the whole UI
  // on top of our canvas zoom. Bind natively with { passive: false }, like the
  // exported web gallery does. (#12)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handler reads store/refs fresh; bind once
  }, []);

  const paintingTool = PAINTING_TOOLS.has(tool);
  const precise = capsLock || (paintingTool ? cursorPrefs.painting !== "standard" : cursorPrefs.other === "precise");
  const cursorCss =
    spacePan ? "grab" :
    tool === "hand" ? "grab" :
    tool === "zoom" ? "zoom-in" :
    tool === "move" ? "move" :
    // The brush-tip outline (with its own crosshair) is the pointer.
    paintingTool && !capsLock && showBrushPreview && isBrushTipCursor(cursorPrefs.painting) ? "none" :
    precise ? "crosshair" :
    toolIconCursor(tool);
  // A background document's pane is sized to that document, not the active one.
  const paneSize = passive ? store.docSize(paneDocId!) : null;
  const boxW = paneSize?.w ?? docW, boxH = paneSize?.h ?? docH;

  return (
    <div
      ref={viewportRef}
      className="mv-canvas-viewport"
      data-mv-pane={paneDocId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onPointerEnter={() => { cloneOverlayImgRef.current = null; }}
      onPointerLeave={() => { cursorPointerRef.current = null; repaintBrushCursor(); store.setCursor(null); collab?.setCursor(null); drawCloneOverlay(null); }}
      onDoubleClick={() => { if (store.state.tool === "pen") closePen(); else if (store.state.tool === "curvaturepen") commitCurvePen(); else if (store.state.tool === "polylasso") closePolyLasso(); else editText(store.state.activeLayerId); }}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "absolute", inset: 0, overflow: "hidden",
        cursor: cursorCss,
        background:
          "repeating-conic-gradient(#1a1d22 0% 25%, #15171c 0% 50%) 50% / 22px 22px",
      }}
    >
      {/* Live collaborator cursors (presence) — doc-space coords mapped through
          THIS viewer's pan/zoom so peers track correctly. pointer-events:none. */}
      <CollabCursors
        session={collab}
        toScreen={(p) => {
          const zx = zoom * parX, zy = zoom;
          let x = panX + p.x * zx, y = panY + p.y * zy;
          if (rotationAngle) {
            const pvx = panX + (docW / 2) * zx, pvy = panY + (docH / 2) * zy;
            const r = rotationAngle * Math.PI / 180, ca = Math.cos(r), sa = Math.sin(r);
            const dx = x - pvx, dy = y - pvy;
            x = ca * dx - sa * dy + pvx; y = sa * dx + ca * dy + pvy;
          }
          return { x, y };
        }}
      />
      {ready && (
        <div
          data-mv-docbox=""
          style={{
            position: "absolute", left: 0, top: 0,
            width: boxW, height: boxH,
            // Rotate View: rotate about the content centre.
            transform: viewCss({ zoom, panX, panY, rotationAngle }, parX, boxW, boxH),
            transformOrigin: "0 0",
            boxShadow: "0 12px 48px rgba(0,0,0,0.6)",
          }}
        >
          {/* Pattern Preview: the composited document tiled edge-to-edge (3×3)
              behind the live centre tile; dirty paint regions update live. */}
          {patternPreview && !passive && (
            <canvas
              ref={patternCanvasRef}
              width={docW * 3}
              height={docH * 3}
              data-mv-pattern-preview="1"
              style={{
                position: "absolute", left: -docW, top: -docH,
                width: docW * 3, height: docH * 3,
                imageRendering: "pixelated",
                pointerEvents: "none",
              }}
            />
          )}
          {/* transparency checker behind the doc */}
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage:
              "repeating-conic-gradient(#cfcfcf 0% 25%, #ffffff 0% 50%)",
            backgroundSize: "16px 16px",
          }} />
          <canvas
            ref={canvasRef}
            data-mv-pixels=""
            style={{ position: "absolute", inset: 0, imageRendering: zoom >= 2 ? "pixelated" : "auto", width: boxW, height: boxH }}
          />
          {!passive && <PuppetWarpOverlay docW={docW} docH={docH} />}
          {/* Everything drawn over the pixels belongs to the active document, so a
              pane showing a background one mounts none of it (no full-size
              overlay canvases, no ants loop); its effects redraw on activation. */}
          {!passive && (<>
          {/* Onion skin — the last captured animation frame, ghosted (display-only). */}
          {onionSrc && (
            <img
              src={onionSrc}
              alt=""
              data-mv-onion="1"
              data-mv-float-raster="1"
              style={{ position: "absolute", inset: 0, width: docW, height: docH, opacity: 0.35, pointerEvents: "none" }}
            />
          )}
          <canvas
            ref={overlayRef}
            style={{ position: "absolute", inset: 0, imageRendering: "pixelated", width: docW, height: docH, pointerEvents: "none" }}
          />
          {/* Layer-mask preview overlay (⌥-click a mask thumb, or `\\`). */}
          <canvas
            ref={maskViewOverlayRef}
            data-mv-mask-view={maskView}
            data-mv-float-raster={maskView !== "off" ? 1 : 0}
            style={{ position: "absolute", inset: 0, imageRendering: "pixelated", width: docW, height: docH, pointerEvents: "none" }}
          />
          {/* Color Range Selection Preview — display-only, dialog-lifetime. */}
          <canvas
            ref={selPreviewOverlayRef}
            data-mv-selection-preview={selectionPreviewMode}
            data-mv-float-raster={selectionPreviewMode !== "none" ? 1 : 0}
            style={{ position: "absolute", inset: 0, imageRendering: "pixelated", width: docW, height: docH, pointerEvents: "none" }}
          />
          {/* Quick Mask rubylith overlay — display-only red over masked areas. */}
          <canvas
            ref={qmOverlayRef}
            data-mv-quickmask={quickMask ? 1 : 0}
            data-mv-float-raster={quickMask ? 1 : 0}
            style={{ position: "absolute", inset: 0, imageRendering: "pixelated", width: docW, height: docH, pointerEvents: "none" }}
          />
          {/* Liquify Backdrop overlay — pre-session composite for comparison. */}
          <canvas
            ref={lqBackdropOverlayRef}
            data-mv-liquify-backdrop={tool === "liquify" && (liquifyShowBackdrop || !liquifyPreview) ? 1 : 0}
            data-mv-float-raster={tool === "liquify" && (liquifyShowBackdrop || !liquifyPreview) ? 1 : 0}
            style={{ position: "absolute", inset: 0, imageRendering: "pixelated", width: docW, height: docH, pointerEvents: "none" }}
          />
          {/* Clone Source ▸ Show Overlay — the sampled source under the brush (#427). */}
          <canvas
            ref={cloneOverlayRef}
            data-mv-clone-overlay={cloneOverlayShow && (tool === "clone" || tool === "heal") ? 1 : 0}
            data-mv-float-raster={cloneOverlayShow && (tool === "clone" || tool === "heal") ? 1 : 0}
            style={{ position: "absolute", inset: 0, imageRendering: "pixelated", width: docW, height: docH, pointerEvents: "none" }}
          />
          {/* Liquify Freeze Mask overlay — red protects pixels from future warps. */}
          <canvas
            ref={lqMaskOverlayRef}
            data-mv-liquify-freeze-mask={tool === "liquify" ? 1 : 0}
            data-mv-float-raster={tool === "liquify" ? 1 : 0}
            style={{ position: "absolute", inset: 0, imageRendering: "pixelated", width: docW, height: docH, pointerEvents: "none" }}
          />
          {/* Liquify Mesh overlay — sampled live displacement field. */}
          <canvas
            ref={lqMeshOverlayRef}
            data-mv-liquify-mesh={tool === "liquify" && liquifyShowMesh ? 1 : 0}
            data-mv-float-raster={tool === "liquify" && liquifyShowMesh ? 1 : 0}
            style={{ position: "absolute", inset: 0, imageRendering: "pixelated", width: docW, height: docH, pointerEvents: "none" }}
          />
          {preview && <PreviewOverlay preview={preview} />}
          {tool === "vanishingpoint" && (
            <VanishingPointOverlay
              planes={vanishingPointPlanes}
              active={vanishingPointActivePlane}
              source={vanishingPointSource}
              edges={vanishingPointEdges}
              marquee={vanishingPointMarquee}
              float={vanishingPointFloat}
            />
          )}
          {paintSymmetry !== 0 && paintSymmetryVisible && (
            <PaintSymmetryOverlay
              mode={paintSymmetry}
              segments={paintSymmetrySegments}
              axisX={paintSymmetryAxisX}
              axisY={paintSymmetryAxisY}
              angle={paintSymmetryAngle}
              scale={paintSymmetryScale}
              width={docW}
              height={docH}
              zoom={zoom}
              transforming={paintSymmetryTransforming}
            />
          )}
          {showPixelGrid && zoom >= 8 && (
            <svg style={{ position: "absolute", inset: 0, width: docW, height: docH, pointerEvents: "none" }}>
              <defs>
                <pattern id={`mv-pxgrid${paneDocId ?? ""}`} width={1} height={1} patternUnits="userSpaceOnUse">
                  <path d="M1,0 L0,0 L0,1" fill="none" stroke="rgba(128,128,160,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                </pattern>
              </defs>
              <rect width={docW} height={docH} fill={`url(#mv-pxgrid${paneDocId ?? ""})`} />
            </svg>
          )}
          {(showGrid || (showGuides && guides.length > 0)) && (
            <svg style={{ position: "absolute", inset: 0, width: docW, height: docH, pointerEvents: "none", overflow: "hidden" }}>
              {showGrid && (() => {
                const step = Math.max(2, gridSpacing);
                const lines = [];
                for (let x = step; x < docW; x += step)
                  lines.push(<line key={`vx${x}`} x1={x} y1={0} x2={x} y2={docH} stroke={gridColor} strokeOpacity={0.4} strokeWidth={1} vectorEffect="non-scaling-stroke" />);
                for (let y = step; y < docH; y += step)
                  lines.push(<line key={`hy${y}`} x1={0} y1={y} x2={docW} y2={y} stroke={gridColor} strokeOpacity={0.4} strokeWidth={1} vectorEffect="non-scaling-stroke" />);
                return lines;
              })()}
              {showGuides && guides.map((g, i) => g.o === "v"
                ? <line key={`g${i}`} data-mv-guide="v" x1={g.p} y1={0} x2={g.p} y2={docH} stroke={g.color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                : <line key={`g${i}`} data-mv-guide="h" x1={0} y1={g.p} x2={docW} y2={g.p} stroke={g.color} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            </svg>
          )}
          {layerEdges && layerEdges[2] > 0 && (
            <svg style={{ position: "absolute", inset: 0, width: docW, height: docH, pointerEvents: "none", overflow: "visible" }}>
              <rect x={layerEdges[0]} y={layerEdges[1]} width={layerEdges[2]} height={layerEdges[3]}
                fill="none" stroke="#5b8cff" strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          {xformBox && xformBox[2] > 0 && editors && (
            <LayerTransformOverlay
              key={`${activeDocId}:${activeLayerId}`}
              docId={activeDocId}
              box={{ x: xformBox[0], y: xformBox[1], w: xformBox[2], h: xformBox[3] }}
              docW={docW} docH={docH} toDoc={toDoc} zoom={zoom}
            />
          )}
          {lasso && lasso.length >= 4 && (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
              <polyline
                points={lasso.reduce((acc, v, i) => (i % 2 === 0 ? `${acc} ${v},` : `${acc}${v}`), "").trim()}
                fill="rgba(120,170,255,0.12)" stroke="rgba(255,255,255,0.9)" strokeWidth={1}
                strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          {penPts && penPts.length >= 2 && showTargetPath && showExtras && (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
              <polyline points={penPts.reduce((acc, v, i) => (i % 2 === 0 ? `${acc} ${v},` : `${acc}${v}`), "").trim()}
                fill="rgba(120,170,255,0.10)" stroke="rgba(255,255,255,0.9)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {cursor && (
                <line x1={penPts[penPts.length - 2]} y1={penPts[penPts.length - 1]} x2={cursor.x} y2={cursor.y}
                  stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              )}
              {/* A bezier path's dots belong on its ANCHORS, not on every vertex
                  of its flattening (which is a dense curve). Handles are drawn
                  live so a click-drag shows the curve it is pulling. */}
              {penAnchorPath
                ? Array.from({ length: penAnchorPath.length / ANCHOR_STRIDE }).map((_, i) => {
                    const o = i * ANCHOR_STRIDE;
                    const ax = penAnchorPath[o], ay = penAnchorPath[o + 1];
                    return (
                      <g key={i}>
                        {([[penAnchorPath[o + 2], penAnchorPath[o + 3]], [penAnchorPath[o + 4], penAnchorPath[o + 5]]] as [number, number][])
                          .map(([hx, hy], k) => (hx === 0 && hy === 0 ? null : (
                            <g key={k}>
                              <line x1={ax} y1={ay} x2={ax + hx} y2={ay + hy}
                                stroke="#5b8cff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                              <circle cx={ax + hx} cy={ay + hy} r={2.5}
                                fill="#fff" stroke="#5b8cff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            </g>
                          )))}
                        <circle data-mv-pen-anchor={i} cx={ax} cy={ay} r={3} fill="#fff" stroke="#000" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
                      </g>
                    );
                  })
                : Array.from({ length: penPts.length / 2 }).map((_, i) => (
                    <circle key={i} cx={penPts[i * 2]} cy={penPts[i * 2 + 1]} r={3} fill="#fff" stroke="#000" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
                  ))}
            </svg>
          )}
          {/* Work path — the COMMITTED path (Paths panel ▸ Make Work Path, or a
              saved path loaded back). `penPts` above is only the in-progress Pen
              drag, so without this a made work path was invisible.
              ponytail: outline only; its anchors are the Pen's to edit, and a
              traced selection can carry hundreds of them. */}
          {!penPts && penPath.length >= 6 && showTargetPath && showExtras && (() => {
            const pts = penPath.reduce((acc, v, i) => (i % 2 === 0 ? `${acc} ${v},` : `${acc}${v}`), "").trim();
            // A bezier work path draws each loop as its own curve, so the
            // bridges that join glyph loops in penPath (for fills) never show.
            const loops = hasAnchorForm(penAnchors) ? workPathOverlays(penAnchors, penContours) : null;
            const d = loops?.map((loop) => pathOutlineD(loop)).join(" ");
            return (
              <svg data-mv-workpath={penPath.length / 2} data-mv-workpath-contours={loops?.length ?? 1}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
                {/* Dark halo under a white hairline so the outline reads on any image. */}
                {d ? <path d={d} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  : <polygon points={pts} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                {d ? <path d={d} fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  : <polygon points={pts} fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
              </svg>
            );
          })()}
          {/* Direct / Path Selection — the active shape layer's committed outline,
              an anchor square per point (hollow = unselected, solid = selected),
              direction handles on the selected ones, and the rubber band. */}
          {vectorPaths.length > 0 && showTargetPath && showExtras && (() => {
            const hs = 7 / zoom; // constant ~7px anchors regardless of zoom
            return (
              <svg data-mv-vector-paths={vectorPaths.length}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
                {vectorPaths.map((p, pi) => (
                  <path key={`o${pi}`} d={pathOutlineD(p)} fill="none"
                    stroke="#5b8cff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
                {vectorPaths.flatMap((p, pi) => p.anchors.flatMap((a, i) => {
                  // The selection holds flat indices, which run on across an item's outlines.
                  const on = selectedAnchorKeys.has(anchorKey({ item: p.item, index: p.indexBase + i }));
                  const nodes = [
                    <rect key={`a${pi}-${i}`} data-mv-anchor={on ? "on" : "off"}
                      x={a.x - hs / 2} y={a.y - hs / 2} width={hs} height={hs}
                      fill={on ? "#5b8cff" : "#fff"} stroke="#1c2333" strokeWidth={1} vectorEffect="non-scaling-stroke" />,
                  ];
                  // Direction handles belong to the anchor being edited, like Photoshop.
                  if (on) {
                    for (const [hx, hy, k] of [[a.inX, a.inY, "i"], [a.outX, a.outY, "o"]] as [number, number, string][]) {
                      if (hx === 0 && hy === 0) continue;
                      nodes.push(
                        <g key={`h${pi}-${i}-${k}`}>
                          <line x1={a.x} y1={a.y} x2={a.x + hx} y2={a.y + hy}
                            stroke="#5b8cff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                          <circle cx={a.x + hx} cy={a.y + hy} r={hs / 2}
                            fill="#fff" stroke="#5b8cff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                        </g>,
                      );
                    }
                  }
                  return nodes;
                }))}
              </svg>
            );
          })()}
          {anchorMarquee && (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
              <rect data-mv-anchor-marquee
                x={Math.min(anchorMarquee.x0, anchorMarquee.x1)} y={Math.min(anchorMarquee.y0, anchorMarquee.y1)}
                width={Math.abs(anchorMarquee.x1 - anchorMarquee.x0)} height={Math.abs(anchorMarquee.y1 - anchorMarquee.y0)}
                fill="rgba(120,170,255,0.10)" stroke="rgba(255,255,255,0.9)" strokeWidth={1}
                strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          {/* Curvature Pen — the smooth curve fitted through the clicked anchors,
              a rubber-band to the cursor, and a handle dot on each clicked anchor. */}
          {tool === "curvaturepen" && curveAnchors && curveAnchors.length >= 2 && showTargetPath && showExtras && (() => {
            const curve = curveAnchors.length >= 6 ? catmullRomResample(curveAnchors, 16) : curveAnchors;
            return (
              <svg data-mv-curvepen={curveAnchors.length / 2} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
                <polyline points={curve.reduce((acc, v, i) => (i % 2 === 0 ? `${acc} ${v},` : `${acc}${v}`), "").trim()}
                  fill="rgba(120,170,255,0.10)" stroke="rgba(255,255,255,0.9)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {cursor && (
                  <line x1={curveAnchors[curveAnchors.length - 2]} y1={curveAnchors[curveAnchors.length - 1]} x2={cursor.x} y2={cursor.y}
                    stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                )}
                {Array.from({ length: curveAnchors.length / 2 }).map((_, i) => (
                  <circle key={i} cx={curveAnchors[i * 2]} cy={curveAnchors[i * 2 + 1]} r={3} fill="#fff" stroke="#000" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
            );
          })()}
          {/* Polygonal Lasso — in-progress vertices + rubber-band to the cursor. */}
          {tool === "polylasso" && polyLassoPts && polyLassoPts.length >= 2 && (
            <svg data-mv-polylasso={polyLassoPts.length / 2}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
              <polyline points={polyLassoPts.reduce((acc, v, i) => (i % 2 === 0 ? `${acc} ${v},` : `${acc}${v}`), "").trim()}
                fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              {cursor && (
                <line x1={polyLassoPts[polyLassoPts.length - 2]} y1={polyLassoPts[polyLassoPts.length - 1]} x2={cursor.x} y2={cursor.y}
                  stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              )}
              {Array.from({ length: polyLassoPts.length / 2 }).map((_, i) => (
                <circle key={i} cx={polyLassoPts[i * 2]} cy={polyLassoPts[i * 2 + 1]} r={3} fill="#fff" stroke="#000" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          )}
          {/* Image ▸ Analysis ▸ Ruler — the measurement line + endpoint ticks. */}
          {rulerLine && (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
              <line x1={rulerLine.x0} y1={rulerLine.y0} x2={rulerLine.x1} y2={rulerLine.y1}
                stroke="rgba(0,0,0,0.85)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
              <line x1={rulerLine.x0} y1={rulerLine.y0} x2={rulerLine.x1} y2={rulerLine.y1}
                stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {[[rulerLine.x0, rulerLine.y0], [rulerLine.x1, rulerLine.y1]].map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r={3} fill="#fff" stroke="#000" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          )}
          {/* Smart Guides — magenta alignment lines during a Move drag. */}
          {smartGuides.length > 0 && (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
              {smartGuides.map((g, i) => g.o === "v"
                ? <line key={i} x1={g.p} y1={g.from} x2={g.p} y2={g.to} stroke="#ff2bd6" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                : <line key={i} x1={g.from} y1={g.p} x2={g.to} y2={g.p} stroke="#ff2bd6" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            </svg>
          )}
          {/* Slices — numbered rectangular regions. The Slice / Slice Select tools
              highlight the active slice; Slice Select also draws resize handles.
              Pointer-events stay off — CanvasView's pointer switches own the hit-
              testing (in doc space) so this only renders. */}
          {showSlices && slices.length > 0 && (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
              {slices.map((s, i) => {
                const active = (tool === "slice" || tool === "sliceselect") && i === selectedSlice;
                return (
                  <g key={i} data-mv-slice={i}>
                    <rect data-mv-slice-rect={i} x={s.x} y={s.y} width={s.w} height={s.h}
                      fill={active ? "rgba(255,176,32,0.08)" : "none"}
                      stroke={active ? "#ffd060" : "#ffb020"} strokeWidth={active ? 2 : 1} vectorEffect="non-scaling-stroke" />
                    <text x={s.x + 3} y={s.y + 12} fill="#fff" stroke="#000" strokeWidth={0.4}
                      style={{ font: "bold 11px var(--font-mono, monospace)" }}>{`0${i + 1}`.slice(-2)}</text>
                  </g>
                );
              })}
              {tool === "sliceselect" && selectedSlice >= 0 && selectedSlice < slices.length &&
                sliceHandles(slices[selectedSlice]).map((p, i) => {
                  const hs = 6 / zoom; // constant ~6px handles regardless of zoom
                  return <rect key={`h${i}`} data-mv-slice-handle={i} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs}
                    fill="#fff" stroke="#ffb020" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
                })}
            </svg>
          )}
          {/* Artboards — the Artboard tool outlines every artboard with its name
              label above it, highlights the selected one, and draws its 8 resize
              handles. Pointer-events stay off; CanvasView owns the hit-testing. */}
          {tool === "artboard" && artboards.length > 0 && (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
              {artboards.map((a) => {
                const active = a.id === selectedArtboard;
                return (
                  <g key={a.id} data-mv-artboard={a.id}>
                    <rect data-mv-artboard-rect={a.id} x={a.x} y={a.y} width={a.w} height={a.h}
                      fill="none" stroke={active ? "#39b0ff" : "#5a6472"} strokeWidth={active ? 2 : 1} vectorEffect="non-scaling-stroke" />
                    <text data-mv-artboard-label={a.id} x={a.x + 2} y={a.y - 4} fill={active ? "#7cc7ff" : "#cfd6df"} stroke="#000" strokeWidth={0.4}
                      style={{ font: "bold 11px var(--font-mono, monospace)" }}>{a.name}</text>
                  </g>
                );
              })}
              {(() => {
                const sel = artboards.find((a) => a.id === selectedArtboard);
                if (!sel) return null;
                return artboardHandles(sel).map((p, i) => {
                  const hs = 6 / zoom; // constant ~6px handles regardless of zoom
                  return <rect key={`abh${i}`} data-mv-artboard-handle={i} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs}
                    fill="#fff" stroke="#39b0ff" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
                });
              })()}
            </svg>
          )}
          {/* Image ▸ Analysis ▸ Count — numbered markers. */}
          {showCount && countPoints.length > 0 && (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
              {countPoints.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={4} fill="#33aaff" stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  <text x={p.x + 6} y={p.y - 6} fill="#fff" stroke="#000" strokeWidth={0.4}
                    style={{ font: "bold 11px var(--font-mono, monospace)" }}>{i + 1}</text>
                </g>
              ))}
            </svg>
          )}
          {/* Color Sampler — crosshair targets numbered #1..#N (positions only;
              their colours are read live in the Info panel). */}
          {showSamplers && colorSamplers.length > 0 && (
            <svg data-mv-samplers={colorSamplers.length}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
              {colorSamplers.map((p, i) => (
                <g key={i}>
                  <line x1={p.x - 7} y1={p.y} x2={p.x + 7} y2={p.y} stroke="rgba(0,0,0,0.85)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                  <line x1={p.x} y1={p.y - 7} x2={p.x} y2={p.y + 7} stroke="rgba(0,0,0,0.85)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                  <line x1={p.x - 7} y1={p.y} x2={p.x + 7} y2={p.y} stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  <line x1={p.x} y1={p.y - 7} x2={p.x} y2={p.y + 7} stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  <text x={p.x + 8} y={p.y - 6} fill="#fff" stroke="#000" strokeWidth={0.4}
                    style={{ font: "bold 11px var(--font-mono, monospace)" }}>{i + 1}</text>
                </g>
              ))}
            </svg>
          )}
          {/* Note tool — sticky-note icons tied to a location; the active note is
              ringed. Clicks are handled by the canvas (overlay is non-interactive). */}
          {showNotes && notes.length > 0 && (
            <svg data-mv-notes={notes.length}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
              {notes.map((n) => {
                const active = n.id === activeNoteId;
                return (
                  <g key={n.id}>
                    <rect x={n.x} y={n.y - 12} width={14} height={12} rx={2}
                      fill={active ? "#ffcf33" : "#ffe08a"} stroke="rgba(0,0,0,0.85)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
                    <line x1={n.x + 2.5} y1={n.y - 8.5} x2={n.x + 11.5} y2={n.y - 8.5} stroke="rgba(0,0,0,0.5)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
                    <line x1={n.x + 2.5} y1={n.y - 6} x2={n.x + 11.5} y2={n.y - 6} stroke="rgba(0,0,0,0.5)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
                    <line x1={n.x + 2.5} y1={n.y - 3.5} x2={n.x + 8} y2={n.y - 3.5} stroke="rgba(0,0,0,0.5)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
                    {active && (
                      <rect x={n.x - 1.5} y={n.y - 13.5} width={17} height={15} rx={3}
                        fill="none" stroke="#33aaff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    )}
                  </g>
                );
              })}
            </svg>
          )}
          {/* The modal editors take the keyboard, so only the main canvas and a
              float window's stand-in host them — the latter without taking the
              main window's focus: its float types into a field of its own. */}
          {textEdit && editors && (
            <TextEditOverlay key={textEdit.id} id={textEdit.id} fresh={textEdit.fresh} toDoc={toDoc} zoom={zoom} grabFocus={!floatHost} />
          )}
          {editors && <SelectionTransformOverlay toDoc={toDoc} zoom={zoom} {...SELECTION_FRAME} />}
          {editors && <SelectionTransformOverlay toDoc={toDoc} zoom={zoom} {...DROP_FRAME} />}
          </>)}
        </div>
      )}
      {ready && showRulers && !passive && (
        <>
          <svg style={{ position: "absolute", top: 0, left: 0, right: 0, height: 18, background: "rgba(20,22,28,0.92)", borderBottom: "1px solid rgba(255,255,255,0.1)", pointerEvents: "none", zIndex: 6 }}>
            {(() => {
              const ticks = [];
              for (let dx = 0; dx <= docW; dx += 50) {
                // x carries the pixel-aspect stretch (the content transform scales
                // by zoom * parX), so the ticks must too or they drift. (#11)
                const sx = panX + dx * zoom * parX;
                ticks.push(<line key={dx} x1={sx} y1={dx % 100 === 0 ? 6 : 12} x2={sx} y2={18} stroke="rgba(255,255,255,0.4)" strokeWidth={1} />);
                if (dx % 100 === 0) ticks.push(<text key={`t${dx}`} x={sx + 2} y={9} fill="rgba(255,255,255,0.55)" fontSize={8}>{dx}</text>);
              }
              return ticks;
            })()}
          </svg>
          <svg style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 18, background: "rgba(20,22,28,0.92)", borderRight: "1px solid rgba(255,255,255,0.1)", pointerEvents: "none", zIndex: 6 }}>
            {(() => {
              const ticks = [];
              for (let dy = 0; dy <= docH; dy += 50) {
                const sy = panY + dy * zoom;
                ticks.push(<line key={dy} x1={dy % 100 === 0 ? 6 : 12} y1={sy} x2={18} y2={sy} stroke="rgba(255,255,255,0.4)" strokeWidth={1} />);
                if (dy % 100 === 0) ticks.push(<text key={`t${dy}`} x={2} y={sy + 8} fill="rgba(255,255,255,0.55)" fontSize={8}>{dy}</text>);
              }
              return ticks;
            })()}
          </svg>
        </>
      )}
      {/* brush cursor (screen-space): the tip outline, then its crosshair */}
      <div
        ref={cursorRef}
        data-testid="mv-brush-cursor"
        style={{
          position: "fixed", display: "none", pointerEvents: "none",
          transform: "translate(-50%, -50%)", mixBlendMode: "difference", zIndex: 50,
        }}
      >
        <div style={{
          position: "absolute", inset: 0, boxSizing: "border-box", borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
        }} />
        <svg width={11} height={11} style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", display: "none" }}>
          <path d="M5.5 0v11M0 5.5h11" stroke="#fff" strokeWidth={1} />
        </svg>
      </div>
    </div>
  );
}

/** Airbrush build-up rate: Flow sets how fast a held brush keeps depositing —
 *  300ms per dab at flow 0 down to 20ms at flow 1 (the Liquify Rate curve).
 *  ponytail: linear map; retune here if build-up feels off against Photoshop. */
export function airbrushIntervalMs(flow: number): number {
  return Math.round(300 - Math.min(1, Math.max(0, flow)) * 280);
}

/** Start the Airbrush build-up repeat for a held stroke. Returns the interval id,
 *  or 0 when Airbrush is off — there is then nothing to repeat and the brush
 *  behaves exactly as before. `step` returns false once the stroke is over,
 *  which stops the repeat on its own. */
export function startAirbrushRepeat(brush: { airbrush: boolean; flow: number }, step: () => boolean): number {
  if (!brush.airbrush) return 0;
  // Cast: @types/node types the return as Timeout; in the browser it is the
  // numeric handle the component's ref stores.
  const id = setInterval(() => { if (!step()) clearInterval(id); }, airbrushIntervalMs(brush.flow)) as unknown as number;
  return id;
}

/** One Airbrush build-up tick: stamp a dab at the point the pointer is held on.
 *  The engine gates dabs on travelled distance, so a stationary pointer deposits
 *  nothing without this. Returns false when there is no live stroke left to
 *  build up — the caller stops the timer. */
export function airbrushTick(
  d: { strokeActive?: boolean; lx: number; ly: number; pressure?: number } | null,
  E: AirbrushEngine | null | undefined,
  paint: (x: number, y: number, w: number, h: number) => void,
): boolean {
  if (!d?.strokeActive || !E) return false;
  const r = E.stroke_dab(d.lx, d.ly, d.pressure ?? 1);
  if (r[2] > 0 && r[3] > 0) paint(r[0], r[1], r[2], r[3]);
  return true;
}

// Photoshop marquee geometry. Given the gesture's start (sx,sy) and the live
// pointer (x,y): `constrain` (Shift) forces a perfect square/circle (the larger
// of |dx|,|dy| on both axes, in the dragged direction); `fromCenter` (Alt) grows
// the marquee symmetrically about the start point instead of from a corner.
// Returns an integer top-left rect {x0,y0,w,h}.
// Snap a doc-space point to the nearest guide / grid line / canvas edge within a
// zoom-aware threshold, when View ▸ Snap is on. Used by the marquee/shape drags.
export function snapToGuides(x: number, y: number): { x: number; y: number } {
  const s = store.state;
  if (!s.snapEnabled) return { x, y };
  const thresh = 6 / Math.max(0.01, s.zoom);
  const targets = { guides: s.snapGuides, grid: s.snapGrid, docBounds: s.snapDocBounds };
  const vGuides: number[] = [], hGuides: number[] = [];
  for (const g of s.guides) (g.o === "v" ? vGuides : hGuides).push(g.p);
  const grid = { on: s.showGrid && s.showExtras, spacing: s.gridSpacing };
  const xc = axisSnapTargets(s.doc.width, vGuides, grid, targets);
  const yc = axisSnapTargets(s.doc.height, hGuides, grid, targets);
  return { x: snapValue(x, xc, thresh), y: snapValue(y, yc, thresh) };
}

export function marqueeRect(
  sx: number, sy: number, x: number, y: number,
  constrain: boolean, fromCenter: boolean,
): { x0: number; y0: number; w: number; h: number } {
  let dx = x - sx;
  let dy = y - sy;
  if (constrain) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -m : m);
    dy = (dy < 0 ? -m : m);
  }
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  let left: number, top: number, w: number, h: number;
  if (fromCenter) {
    left = sx - adx; top = sy - ady;
    w = adx * 2; h = ady * 2;
  } else {
    left = Math.min(sx, sx + dx); top = Math.min(sy, sy + dy);
    w = adx; h = ady;
  }
  return { x0: Math.round(left), y0: Math.round(top), w: Math.round(w), h: Math.round(h) };
}

// Snap the end point so the line from (sx,sy) sits on the nearest 45° axis
// (horizontal / vertical / diagonal), preserving its length — Photoshop's Shift
// constraint for the Gradient and Move tools.
export function constrain45(sx: number, sy: number, x: number, y: number): { x: number; y: number } {
  const dx = x - sx, dy = y - sy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x, y };
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: sx + Math.cos(a) * len, y: sy + Math.sin(a) * len };
}

function PreviewOverlay({ preview }: { preview: PreviewRect }) {
  const cropOverlay = useStore((s) => s.cropOverlay);
  const cropOverlayOrientation = useStore((s) => s.cropOverlayOrientation);
  const x = Math.min(preview.x0, preview.x1);
  const y = Math.min(preview.y0, preview.y1);
  const w = Math.abs(preview.x1 - preview.x0);
  const h = Math.abs(preview.y1 - preview.y0);
  const stroke = { stroke: "rgba(255,255,255,0.9)", strokeWidth: 1, fill: "none", vectorEffect: "non-scaling-stroke" as const };
  // Crop composition overlay, drawn inside the live crop rectangle. These
  // subscriptions make O / Shift+O update a stationary in-progress drag.
  const cropGuides = preview.crop ? overlayLines(cropOverlay, x, y, w, h, cropOverlayOrientation) : [];
  const s = store.state;
  const lineArrows = preview.lineShape
    ? [
        s.lineArrowStart && { key: "start", points: arrowheadPolygon(preview.x0, preview.y0, preview.x0 - preview.x1, preview.y0 - preview.y1, s.lineArrowWidth, s.lineArrowLength, s.lineArrowConcavity) },
        s.lineArrowEnd && { key: "end", points: arrowheadPolygon(preview.x1, preview.y1, preview.x1 - preview.x0, preview.y1 - preview.y0, s.lineArrowWidth, s.lineArrowLength, s.lineArrowConcavity) },
      ].filter((arrow): arrow is { key: string; points: number[] } => arrow !== false && arrow.points.length === 8)
    : [];
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: preview.clipToDocument ? "hidden" : "visible" }}>
      {preview.kind === "rect" && <rect data-mv-preview="rect" x={x} y={y} width={w} height={h} {...stroke} strokeDasharray="4 3" />}
      {cropGuides.map((l, i) => (
        <line key={i} data-mv-crop-guide x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
          stroke="rgba(255,255,255,0.55)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {preview.kind === "ellipse" && <ellipse data-mv-preview="ellipse" cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...stroke} strokeDasharray="4 3" />}
      {preview.kind === "line" && <line data-mv-preview="line" x1={preview.x0} y1={preview.y0} x2={preview.x1} y2={preview.y1} {...stroke} />}
      {lineArrows.map((arrow) => (
        <polygon
          key={arrow.key}
          data-mv-preview-arrow={arrow.key}
          points={arrow.points.join(" ")}
          {...stroke}
        />
      ))}
    </svg>
  );
}

function VanishingPointOverlay({ planes, active, source, edges, marquee, float }: {
  planes: VanishingPlane[];
  active: number;
  source: { x: number; y: number } | null;
  edges: boolean;
  marquee: VanishingRect | null;
  float: VanishingRect | null;
}) {
  const points = (q: number[] | null) => (q && q.length === 8 ? `${q[0]},${q[1]} ${q[2]},${q[3]} ${q[4]},${q[5]} ${q[6]},${q[7]}` : null);
  const rectPoints = (r: VanishingRect | null) => (r ? points(uvRectQuad(planes[r.plane]?.quad ?? [], r)) : null);
  const activeQuad = planes[active]?.quad ?? [];
  const marqueePoints = rectPoints(marquee);
  const floatPoints = rectPoints(float);
  return (
    <>
      {float && <VanishingFloatPreview rect={float} planes={planes} />}
      <svg data-mv-vanishing-point style={{ position: "absolute", inset: 0, width: store.state.doc.width, height: store.state.doc.height, pointerEvents: "none", overflow: "visible" }}>
        {planes.map((p, i) => {
          const pts = points(p.quad);
          if (!pts) return null;
          const on = i === active;
          return (
            <g key={i}>
              <polygon data-mv-vp-plane={i} data-mv-vp-plane-active={on ? "1" : undefined} points={pts}
                fill={on ? "rgba(64, 180, 255, 0.1)" : "rgba(64, 180, 255, 0.04)"} stroke={on ? "rgba(64, 180, 255, 0.95)" : "rgba(64, 180, 255, 0.5)"}
                strokeWidth={on ? 1.5 : 1} vectorEffect="non-scaling-stroke" />
              <line x1={p.quad[0]} y1={p.quad[1]} x2={p.quad[4]} y2={p.quad[5]} stroke="rgba(64, 180, 255, 0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <line x1={p.quad[2]} y1={p.quad[3]} x2={p.quad[6]} y2={p.quad[7]} stroke="rgba(64, 180, 255, 0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {planes.map((p, i) => p.parent === null && p.quad.length === 8 && [0, 1, 2, 3].map((h) => (
          <circle key={`${i}:${h}`} data-mv-vp-handle={`${i}:${h}`} cx={p.quad[h * 2]} cy={p.quad[h * 2 + 1]} r={3.5} fill="rgba(64, 180, 255, 0.95)" stroke="rgba(0,0,0,0.65)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )))}
        {edges && activeQuad.length === 8 && [0, 1, 2, 3].map((k) => {
          const j = (k + 1) % 4;
          const cx = (activeQuad[k * 2] + activeQuad[j * 2]) / 2, cy = (activeQuad[k * 2 + 1] + activeQuad[j * 2 + 1]) / 2;
          return <rect key={k} data-mv-vp-edge={k} x={cx - 2.5} y={cy - 2.5} width={5} height={5} fill="rgba(255, 255, 255, 0.9)" stroke="rgba(64, 180, 255, 0.95)" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
        })}
        {marqueePoints && <polygon data-mv-vp-marquee points={marqueePoints} fill="none" stroke="rgba(255, 255, 255, 0.95)" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        {floatPoints && <polygon data-mv-vp-float points={floatPoints} fill="none" stroke="rgba(255, 224, 96, 0.95)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />}
        {source && (
          <g data-mv-vp-source>
            <line x1={source.x - 6} y1={source.y} x2={source.x + 6} y2={source.y} stroke="rgba(255, 224, 96, 0.95)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <line x1={source.x} y1={source.y - 6} x2={source.x} y2={source.y + 6} stroke="rgba(255, 224, 96, 0.95)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </g>
        )}
      </svg>
    </>
  );
}

/** The float drawn with the same warp OK stamps, so the preview is the result.
 *  One warp per animation frame at most while it is dragged. */
function VanishingFloatPreview({ rect, planes }: { rect: VanishingRect; planes: VanishingPlane[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const cv = ref.current;
      const ctx = cv?.getContext("2d");
      if (!cv || !ctx) return;
      const W = store.state.doc.width, H = store.state.doc.height;
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      ctx.clearRect(0, 0, W, H);
      const img = store.vanishingPointFloatImage();
      const dst = img ? uvRectQuad(planes[rect.plane]?.quad ?? [], rect) : null;
      const out = img && dst ? warpQuadToQuad(img.rgba, img.w, img.h, img.srcQuad, dst, W, H) : null;
      if (!out) return;
      const data = ctx.createImageData(out.w, out.h);
      data.data.set(out.rgba);
      ctx.putImageData(data, out.x, out.y);
    });
    return () => cancelAnimationFrame(frame);
  }, [rect, planes]);
  return (
    <canvas ref={ref} data-mv-vp-float-preview
      style={{ position: "absolute", inset: 0, width: store.state.doc.width, height: store.state.doc.height, imageRendering: "pixelated", pointerEvents: "none" }} />
  );
}

function paintSymmetryOuterHandle(
  axisX: number,
  axisY: number,
  angle: number,
  scale: number,
  width: number,
  height: number,
) {
  const safeScale = Math.max(0.01, Math.min(100, Number.isFinite(scale) ? scale : 1));
  const radius = Math.min(width, height) * 0.35 * safeScale;
  const radians = (Number.isFinite(angle) ? angle : 0) * Math.PI / 180;
  return {
    x: axisX + Math.sin(radians) * radius,
    y: axisY - Math.cos(radians) * radius,
  };
}

function PaintSymmetryOverlay({
  mode, segments, axisX, axisY, angle, scale, width, height, zoom, transforming,
}: {
  mode: number;
  segments: number;
  axisX: number;
  axisY: number;
  angle: number;
  scale: number;
  width: number;
  height: number;
  zoom: number;
  transforming: boolean;
}) {
  const lines: [number, number, number, number][] = [];
  let curve = "";
  let circleRadius = 0;
  const safeScale = Math.max(0.01, Math.min(100, Number.isFinite(scale) ? scale : 1));
  // Axis paths are mathematically unbounded. Compensate their finite SVG span
  // for scale so they continue to cover the document at every allowed size.
  const span = Math.max(width, height) * 2 / safeScale;
  if (mode === 1 || mode === 3) lines.push([0, -span, 0, span]);
  if (mode === 2 || mode === 3) lines.push([-span, 0, span, 0]);
  if (mode === 4) lines.push([-span, -span, span, span]);
  if (mode === 5) {
    const amplitude = Math.min(width, height) * 0.1;
    curve = Array.from({ length: 129 }, (_, i) => {
      const y = -span + span * 2 * i / 128;
      const x = amplitude * Math.sin(Math.PI * 2 * y / height);
      return `${i ? "L" : "M"}${x},${y}`;
    }).join(" ");
  }
  if (mode === 6) circleRadius = Math.min(width, height) * 0.25;
  if (mode === 7) {
    const spacing = Math.min(width, height) * 0.45 / 2;
    curve = Array.from({ length: 97 }, (_, i) => {
      const radians = Math.PI * 4 * i / 96;
      const radius = radians / (Math.PI * 2) * spacing;
      return `${i ? "L" : "M"}${Math.cos(radians) * radius},${Math.sin(radians) * radius}`;
    }).join(" ");
  }
  if (mode === 8) {
    const offset = width / 6;
    lines.push([-offset, -span, -offset, span], [offset, -span, offset, span]);
  }
  if (mode === 9 || mode === 10) {
    const count = Math.max(mode === 10 ? 3 : 2, Math.min(mode === 10 ? 10 : 12, Math.round(segments)));
    const radius = Math.min(width, height) * 0.45;
    for (let i = 0; i < count; i++) {
      const radians = Math.PI * 2 * i / count;
      lines.push([0, 0, Math.cos(radians) * radius, Math.sin(radians) * radius]);
    }
  }
  const guide = { fill: "none", stroke: "rgba(64, 180, 255, 0.95)", strokeWidth: 1.25, vectorEffect: "non-scaling-stroke" as const };
  const handleRadius = 5 / Math.max(0.02, zoom);
  const outer = paintSymmetryOuterHandle(axisX, axisY, angle, safeScale, width, height);
  return (
    <svg data-mv-symmetry-guide={mode} style={{ position: "absolute", inset: 0, width, height, pointerEvents: "none", overflow: "visible" }}>
      <g transform={`translate(${axisX} ${axisY}) rotate(${angle}) scale(${safeScale})`}>
        {lines.map((line, i) => (
          <line key={i} data-mv-symmetry-path x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} {...guide} />
        ))}
        {curve && <path data-mv-symmetry-path d={curve} {...guide} />}
        {circleRadius > 0 && <circle data-mv-symmetry-path cx={0} cy={0} r={circleRadius} {...guide} />}
      </g>
      {transforming && (
        <>
          <line data-mv-symmetry-transform-line x1={axisX} y1={axisY} x2={outer.x} y2={outer.y}
            stroke="rgba(64, 180, 255, 0.7)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <circle data-mv-symmetry-handle cx={axisX} cy={axisY} r={handleRadius}
            fill="rgba(255,255,255,0.95)" stroke="rgba(64, 180, 255, 1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <circle data-mv-symmetry-transform-handle cx={outer.x} cy={outer.y} r={handleRadius}
            fill="rgba(64,180,255,0.95)" stroke="rgba(255,255,255,0.95)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}

// ── In-place text editor ────────────────────────────────────────
// A transparent <textarea> overlaid on the live engine glyphs, positioned in
// document space inside the zoom/pan-transformed canvas wrapper (so it scales
// with the view). It shows only a blinking caret + selection over the
// engine-rendered text; each keystroke re-applies the spec (re-rasterizes the
// layer live). Lives over the canvas so tool hotkeys are suppressed while
// editing (App's global key handler ignores focused INPUT/TEXTAREA).
// ── Select ▸ Transform Selection ─────────────────────────────────────
// The live free-transform frame on the marching ants: drag a handle to scale
// (Shift locks the aspect), ⌘/Ctrl an edge handle to skew, drag the ring just
// outside a corner to rotate (Shift snaps to 15°), drag inside to move. Enter/✓
// applies, Esc/✕ throws it away. The PIXELS are never touched — only the
// selection mask, and only on commit.
// ponytail: the ants themselves don't warp during the drag — that would be a
//   full-document mask rewrite per pointermove. The frame previews the result
//   and commit applies it once. Upgrade path: an engine-side transformed
//   selection preview texture.
type SelDrag = { kind: "scale" | "skew" | "rotate" | "move"; handle: number; t0: PathTransform; from: { x: number; y: number } };

type SelectionFrame = {
  /** The live session this frame draws, read from the store so a drag re-renders only the frame. */
  select: (s: AppSnapshot) => SelectionTransformSession | null;
  update: (patch: PathTransform) => void;
  commit: () => void;
  cancel: () => void;
  /** `data-mv-<attr>…` hooks for tests. */
  attr: string;
  /** Names the ✓/✕ buttons: "Apply <noun>" / "Cancel <noun>". */
  noun: string;
  /** ⌘/Ctrl edge-drag shear — off where the commit is a similarity. */
  skew?: boolean;
};

const SELECTION_FRAME: SelectionFrame = {
  select: (s) => s.selectionTransform,
  update: (patch) => store.updateSelectionTransform(patch),
  commit: () => store.commitSelectionTransform(),
  cancel: () => store.cancelSelectionTransform(),
  attr: "seltf",
  noun: "selection transform",
};

// Content-Aware Move ▸ Transform On Drop (#429): the same frame over the dropped
// object. Its commit is a similarity (scale/rotate about the dropped centre).
const DROP_FRAME: SelectionFrame = {
  select: (s) => s.camDrop,
  update: (patch) => updateContentAwareMoveDrop(patch),
  commit: () => commitContentAwareMoveDrop(),
  cancel: () => cancelContentAwareMoveDrop(),
  attr: "camdrop",
  noun: "Content-Aware Move",
  skew: false,
};

function SelectionTransformOverlay(
  { toDoc, zoom, select, update, commit, cancel, attr, noun, skew = true }:
  SelectionFrame & { toDoc: (clientX: number, clientY: number) => { x: number; y: number }; zoom: number },
) {
  const sess = useStore(select);
  const dragRef = useRef<SelDrag | null>(null);
  const hook = (part: string, value: string | number = "1") => ({ [`data-mv-${attr}${part}`]: value });

  // Enter/Esc while the frame is live. Capture phase so the app's global
  // shortcuts can't steal them first.
  useEffect(() => {
    if (!sess) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      // An open dropdown list owns Enter/Esc (pick / close it).
      if (isDropdownOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Enter") commit();
      else cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sess, commit, cancel]);

  if (!sess) return null;
  const { box, t } = sess;
  const quad = selectionFrameQuad(box, t);
  const handles = selectionFrameHandles(box, t);
  const hs = 8 / zoom;   // constant ~8px handles regardless of zoom
  const hair = 1 / zoom;
  const centre = { x: box.x + box.w / 2 + (t.tx ?? 0), y: box.y + box.h / 2 + (t.ty ?? 0) };

  const down = (kind: SelDrag["kind"], handle: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* synthetic events */ }
    // ⌘/Ctrl turns an edge-midpoint resize into a shear, as Photoshop does.
    const skewable = skew && kind === "scale" && handle % 2 === 1 && (e.metaKey || e.ctrlKey);
    dragRef.current = { kind: skewable ? "skew" : kind, handle, t0: t, from: toDoc(e.clientX, e.clientY) };
  };
  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    const q = toDoc(e.clientX, e.clientY);
    update(
      d.kind === "rotate" ? rotateSelectionFrame(box, d.t0, d.from, q, e.shiftKey)
        : d.kind === "skew" ? skewSelectionFrame(box, d.t0, d.handle, q)
          : d.kind === "move" ? { tx: (d.t0.tx ?? 0) + q.x - d.from.x, ty: (d.t0.ty ?? 0) + q.y - d.from.y }
            : scaleSelectionFrame(box, d.t0, d.handle, q, e.shiftKey),
    );
  };
  const up = () => { dragRef.current = null; };
  const dragProps = { onPointerMove: move, onPointerUp: up, onPointerCancel: up };

  // Anchor the ✓/✕ pair below the frame's lowest corner so it never covers it.
  const low = quad.reduce((a, p) => (p.y > a.y ? p : a), quad[0]);
  const btn: CSSProperties = {
    width: 22 / zoom, height: 22 / zoom, padding: 0, lineHeight: 1, cursor: "pointer",
    fontSize: 13 / zoom, borderRadius: 3 / zoom, border: `${hair}px solid rgba(0,0,0,0.5)`,
  };

  return (
    <>
      <svg {...hook("")}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
        <polygon
          {...hook("-body")}
          points={quad.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="rgba(120,170,255,0.10)" stroke="#5b8cff" strokeWidth={1} vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "auto", cursor: "move" }}
          onPointerDown={down("move", -1)} {...dragProps}
        />
        {/* Rotate rings sit just outside each corner, on the corner→centre ray. */}
        {quad.map((p, i) => {
          const dx = p.x - centre.x, dy = p.y - centre.y;
          const len = Math.hypot(dx, dy) || 1;
          const off = 14 / zoom;
          return (
            <circle key={`r${i}`} {...hook("-rotate", i)}
              cx={p.x + (dx / len) * off} cy={p.y + (dy / len) * off} r={hs * 0.75}
              fill="rgba(91,140,255,0.25)" stroke="#5b8cff" strokeWidth={1} vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "auto", cursor: "grab" }}
              onPointerDown={down("rotate", i)} {...dragProps}
            >
              <title>Rotate the selection</title>
            </circle>
          );
        })}
        {handles.map((p, i) => (
          <rect key={i} {...hook("-handle", i)}
            x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs}
            fill="#fff" stroke="#5b8cff" strokeWidth={1} vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "auto", cursor: TYPE_BOX_CURSORS[i] }}
            onPointerDown={down("scale", i)} {...dragProps}
          />
        ))}
      </svg>
      <div style={{ position: "absolute", left: low.x, top: low.y + 10 / zoom, display: "flex", gap: 4 / zoom }}>
        <button type="button" {...hook("-commit")} aria-label={`Apply ${noun}`} title="Apply (Enter)"
          onPointerDown={(e) => e.stopPropagation()} onClick={commit}
          style={{ ...btn, background: "#5b8cff", color: "#fff" }}>✓</button>
        <button type="button" {...hook("-cancel")} aria-label={`Cancel ${noun}`} title="Cancel (Esc)"
          onPointerDown={(e) => e.stopPropagation()} onClick={cancel}
          style={{ ...btn, background: "rgba(30,33,40,0.95)", color: "#fff" }}>✕</button>
      </div>
    </>
  );
}

// ── Move ▸ Show Transform Controls: interactive layer Free Transform ─────
// The same frame as Transform Selection, over the ACTIVE LAYER's bounds: drag a
// handle to scale (Shift locks the aspect), drag the ring just outside a corner
// to rotate (Shift snaps to 15°), drag inside an OPEN frame to move it. Enter/✓
// bakes it through xform.transformLayer, Esc/✕ throws it away. All the frame
// math is the already unit-tested selection-frame math — only the pivot
// conversion below is new.
// ponytail: the pixels don't warp during the drag (the frame previews, commit
//   applies once); there is no corner-distort/skew, and a handle dragged past
//   its anchor does not flip — transform_layer is a similarity that takes
//   |scale|, so both would need a second bake. Upgrade path: an engine-side
//   transformed-layer preview texture + a combined affine bake.

export interface LayerFrameBox { x: number; y: number; w: number; h: number }

/** Is this frame anything other than the identity? Guards a pointless bake. */
export function layerFrameIsDirty(t: PathTransform): boolean {
  return (t.sx ?? 1) !== 1 || (t.sy ?? 1) !== 1 || (t.deg ?? 0) !== 0 || (t.tx ?? 0) !== 0 || (t.ty ?? 0) !== 0;
}

/** Convert a live frame — a PathTransform pivoted on the layer's own bbox
 *  centre — into the (sx, sy, deg, tx, ty) Engine::transform_layer takes, which
 *  pivots on the DOCUMENT centre. The linear part is identical between the two
 *  (pathTransformMatrix and layer_transform_inverse_matrix agree on R·S), so
 *  only the translation has to absorb the pivot shift: moving the pivot by d
 *  costs (I − L)·d. */
export function layerTransformArgs(
  box: LayerFrameBox, t: PathTransform, docW: number, docH: number,
): [number, number, number, number, number] {
  const sx = t.sx ?? 1, sy = t.sy ?? 1, deg = t.deg ?? 0;
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const a = cos * sx, c = -sin * sy, b = sin * sx, d = cos * sy;
  const dx = box.x + box.w / 2 - docW / 2, dy = box.y + box.h / 2 - docH / 2;
  return [
    sx, sy, deg,
    (t.tx ?? 0) + dx - (a * dx + c * dy),
    (t.ty ?? 0) + dy - (b * dx + d * dy),
  ];
}

type LayerDrag = { kind: "scale" | "rotate" | "move"; handle: number; t0: PathTransform; from: HandlePt };

function LayerTransformOverlay(
  { box, docW, docH, toDoc, zoom, docId }:
  { box: LayerFrameBox; docW: number; docH: number; toDoc: (clientX: number, clientY: number) => { x: number; y: number }; zoom: number; docId: number },
) {
  // The frame is frozen at grab time: the engine bounds only move again once the
  // transform is baked, and re-reading them mid-drag would compound the scale.
  const [sess, setSess] = useState<{ box: LayerFrameBox; t: PathTransform } | null>(null);
  const dragRef = useRef<LayerDrag | null>(null);
  const live = sess !== null && layerFrameIsDirty(sess.t);
  const frame = sess ?? { box, t: {} as PathTransform };

  const commit = useCallback(() => {
    if (store.state.activeDocId !== docId) { setSess(null); return; }
    if (sess && layerFrameIsDirty(sess.t)) xform.transformLayer(...layerTransformArgs(sess.box, sess.t, docW, docH));
    setSess(null);
  }, [sess, docW, docH, docId]);

  // Enter/Esc while the frame is live. Capture phase so the app's global
  // shortcuts can't steal them first.
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      // An open dropdown list owns Enter/Esc (pick / close it).
      if (isDropdownOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Enter") commit();
      else setSess(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [live, commit]);

  const quad = selectionFrameQuad(frame.box, frame.t);
  const handles = selectionFrameHandles(frame.box, frame.t);
  const hs = 8 / zoom;   // constant ~8px handles regardless of zoom
  const hair = 1 / zoom;
  const centre = { x: frame.box.x + frame.box.w / 2 + (frame.t.tx ?? 0), y: frame.box.y + frame.box.h / 2 + (frame.t.ty ?? 0) };

  const down = (kind: LayerDrag["kind"], handle: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* synthetic events */ }
    const base = sess ?? { box, t: {} as PathTransform };
    setSess(base);
    dragRef.current = { kind, handle, t0: base.t, from: toDoc(e.clientX, e.clientY) };
  };
  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    const q = toDoc(e.clientX, e.clientY);
    setSess((s) => {
      if (!s) return s;
      const t = d.kind === "rotate" ? rotateSelectionFrame(s.box, d.t0, d.from, q, e.shiftKey)
        : d.kind === "move" ? { ...d.t0, tx: (d.t0.tx ?? 0) + q.x - d.from.x, ty: (d.t0.ty ?? 0) + q.y - d.from.y }
          : scaleSelectionFrame(s.box, d.t0, d.handle, q, e.shiftKey);
      return { box: s.box, t };
    });
  };
  const up = () => { dragRef.current = null; };
  const dragProps = { onPointerMove: move, onPointerUp: up, onPointerCancel: up };

  // Anchor the ✓/✕ pair below the frame's lowest corner so it never covers it.
  const low = quad.reduce((a, p) => (p.y > a.y ? p : a), quad[0]);
  const btn: CSSProperties = {
    width: 22 / zoom, height: 22 / zoom, padding: 0, lineHeight: 1, cursor: "pointer",
    fontSize: 13 / zoom, borderRadius: 3 / zoom, border: `${hair}px solid rgba(0,0,0,0.5)`,
  };

  return (
    <>
      <svg style={{ position: "absolute", inset: 0, width: docW, height: docH, pointerEvents: "none", overflow: "visible" }}>
        {/* The body only takes the drag once a transform is open. With an
            untouched frame the plain Move-tool drag underneath is strictly
            better (live pixels + Smart Guides), so it keeps the gesture. */}
        <polygon data-mv-xform-box points={quad.map((p) => `${p.x},${p.y}`).join(" ")}
          fill={live ? "rgba(120,170,255,0.10)" : "transparent"} stroke="#5b8cff" strokeWidth={1} vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: live ? "auto" : "none", cursor: "move" }}
          onPointerDown={down("move", -1)} {...dragProps} />
        {/* Rotate rings sit just outside each corner, on the corner→centre ray. */}
        {quad.map((p, i) => {
          const dx = p.x - centre.x, dy = p.y - centre.y;
          const len = Math.hypot(dx, dy) || 1;
          const off = 14 / zoom;
          return (
            <circle key={`r${i}`} data-mv-xform-rotate={i}
              cx={p.x + (dx / len) * off} cy={p.y + (dy / len) * off} r={hs * 0.75}
              fill="rgba(91,140,255,0.25)" stroke="#5b8cff" strokeWidth={1} vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "auto", cursor: "grab" }}
              onPointerDown={down("rotate", i)} {...dragProps}>
              <title>Rotate the layer</title>
            </circle>
          );
        })}
        {handles.map((p, i) => (
          <rect key={i} data-mv-xform-handle={i}
            x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs}
            fill="#fff" stroke="#5b8cff" strokeWidth={1} vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "auto", cursor: TYPE_BOX_CURSORS[i] }}
            onPointerDown={down("scale", i)} {...dragProps} />
        ))}
      </svg>
      {live && (
        <div style={{ position: "absolute", left: low.x, top: low.y + 10 / zoom, display: "flex", gap: 4 / zoom }}>
          <button type="button" data-mv-xform-commit="1" aria-label="Apply layer transform" title="Apply (Enter)"
            onPointerDown={(e) => e.stopPropagation()} onClick={commit}
            style={{ ...btn, background: "#5b8cff", color: "#fff" }}>✓</button>
          <button type="button" data-mv-xform-cancel="1" aria-label="Cancel layer transform" title="Cancel (Esc)"
            onPointerDown={(e) => e.stopPropagation()} onClick={() => setSess(null)}
            style={{ ...btn, background: "rgba(30,33,40,0.95)", color: "#fff" }}>✕</button>
        </div>
      )}
    </>
  );
}

function TextEditOverlay({ id, fresh, toDoc, zoom, grabFocus = true }: {
  id: number; fresh: boolean; toDoc: (clientX: number, clientY: number) => { x: number; y: number }; zoom: number; grabFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const spec = text.get(id);
  const [sel, setSel] = useState<[number, number]>([0, 0]);
  // Natural (unclipped) content height in doc px, measured off the textarea —
  // drives the auto-height box chrome and the overset ⊞ badge.
  const [contentH, setContentH] = useState(0);
  // Area-box handle drag: which handle + the box rect at grab time, so the
  // resize is absolute/drift-free (same discipline as the slice/artboard drags).
  const boxDragRef = useRef<{ handle: number; orig: Slice } | null>(null);

  // Grow to fit the content so the caret is never clipped or scrolled (which
  // would misalign it from the engine glyphs).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const h = el.scrollHeight;
    el.style.height = `${h}px`;
    if (el.wrap === "off") {
      el.style.width = "0px";
      el.style.width = `${el.scrollWidth + 4}px`;
    }
    setContentH(h); // same-value sets bail out — no render loop
  });

  // Focus on open; a fresh layer selects its placeholder so the first keystroke
  // replaces it, an existing one drops the caret at the end. We re-grab focus
  // on the next frame too: when the editor is created mid-click (Type tool),
  // the opening click's trailing mouseup/click would otherwise leave it
  // unfocused.
  useEffect(() => {
    const el = ref.current;
    if (!el || !grabFocus) return;
    const initial = el.value;
    const place = () => {
      if (fresh) el.select();
      else el.setSelectionRange(el.value.length, el.value.length);
    };
    el.focus({ preventScroll: true });
    place();
    const expectedStart = el.selectionStart;
    const expectedEnd = el.selectionEnd;
    // Re-grab focus next frame (a mid-click mount can lose it to the opening
    // click's trailing events), but only re-place the caret/selection if
    // nothing has been typed yet — otherwise we'd drop the first keystroke.
    const raf = requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      if (el.value === initial && el.selectionStart === expectedStart && el.selectionEnd === expectedEnd) place();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vertical type lays out top-to-bottom; the (horizontal) on-canvas editor
  // can't match it, so it's edited via the toolbar instead — no overlay here.
  if (!spec || spec.vertical || (spec.path && spec.path.length >= 4)) return null;
  const scales = spec.runs.map((run) => text.resolveStyle(spec, run).hScale);
  const hScale = scales[0] ?? 1;
  const uniform = scales.every((scale) => scale === hScale);
  // Layout (and its canvas measure) only when the runs disagree. A uniform
  // scale, including 1, stays on the CSS transform the existing editor uses.
  const mixed = !uniform && scales.some((scale) => scale !== 1);
  const caretXs = mixed ? pointTypeCaretXs(spec) : null;
  const st = text.resolveStyle(spec, spec.runs[0] ?? { text: "" });
  const size = st.size;
  const lh = spec.leading > 0 ? spec.leading : size * 1.2;
  const isPara = spec.kind === "paragraph";
  const caret = `rgba(${st.color[0]},${st.color[1]},${st.color[2]},${(st.color[3] ?? 255) / 255})`;
  const align: CSSProperties["textAlign"] =
    spec.align === "right" ? "right"
      : spec.align === "center" ? "center"
        : spec.align === "justify" || spec.align === "justifyAll" ? "justify"
          : "left";

  // Area-type box chrome (paragraph mode only): border + 8 resize handles that
  // reflow the text live, and the ⊞ overset badge when a fixed height clips it.
  // ponytail: overset uses the textarea's DOM metrics (the overlay already
  // relies on DOM≈engine layout for the caret); exact check would re-run the
  // engine layout with boxH=0.
  const box: Slice = { x: spec.ax, y: spec.ay, w: spec.boxW, h: spec.boxH > 0 ? spec.boxH : contentH };
  const overset = isOverset(spec.kind, spec.boxH, contentH);
  const hs = 8 / zoom; // constant ~8px handles regardless of zoom
  const hair = 1 / zoom;
  const onHandleDown = (handle: number) => (e: React.PointerEvent) => {
    e.preventDefault(); // keep the textarea focused so typing resumes after the resize
    e.stopPropagation();
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* synthetic events */ }
    boxDragRef.current = { handle, orig: box };
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const bd = boxDragRef.current;
    const s = text.get(id);
    if (!bd || !s) return;
    const p = toDoc(e.clientX, e.clientY);
    const r = resizeSliceTo(bd.orig, bd.handle, p.x, p.y);
    // Live reflow: re-apply the spec with the new box each move. The open
    // text_edit_session coalesces these into the edit's single undo step.
    text.apply(id, { ...s, kind: "paragraph", ax: r.x, ay: r.y, boxW: r.w, boxH: r.h });
  };
  const onHandleUp = () => { boxDragRef.current = null; };

  return (
    <>
    <textarea
      ref={ref}
      className="mv-text-edit"
      aria-label="Text layer editor"
      value={text.fullText(spec)}
      spellCheck={false}
      wrap={isPara ? "soft" : "off"}
      onChange={(e) => text.apply(id, text.setText(spec, e.target.value))}
      onSelect={(e) => setSel([e.currentTarget.selectionStart, e.currentTarget.selectionEnd])}
      onPointerUp={(e) => {
        if (!caretXs) return;
        const p = toDoc(e.clientX, e.clientY);
        const idx = caretIndexAt(caretXs, p.x - spec.ax);
        e.currentTarget.setSelectionRange(idx, idx);
        setSel([idx, idx]);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") { e.preventDefault(); store.endTextEdit(); }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        // half-leading offset so the first baseline lands where the engine
        // draws it (engine first baseline ≈ 0.8·size below the block top).
        left: spec.ax,
        top: spec.ay - (lh - size) / 2,
        width: isPara ? spec.boxW / (uniform && hScale ? hScale : 1) : "auto",
        minWidth: 2,
        margin: 0,
        padding: 0,
        border: "none",
        outline: "none",
        background: "transparent",
        color: "transparent",
        caretColor: mixed ? "transparent" : caret,
        transform: uniform && hScale !== 1 ? `scaleX(${hScale})` : undefined,
        // The very font the raster paints (real weight, variable axes), so the
        // caret and selection measure against the face on screen, not a 400/700
        // stand-in — a Semibold or a wide `wdth` run is a different width.
        font: cssFont(st, size, lh),
        fontVariationSettings: variationSettings(st) || undefined,
        letterSpacing: `${spec.tracking}px`,
        textAlign: align,
        whiteSpace: isPara ? "pre-wrap" : "pre",
        overflow: "hidden",
        resize: "none",
        boxSizing: "content-box",
        transformOrigin: "0 0",
      }}
    />
    {caretXs && sel[0] === sel[1] && (
      <div
        data-mv-text-caret="1"
        style={{
          position: "absolute",
          left: spec.ax + (caretXs[Math.min(sel[0], caretXs.length - 1)] ?? 0),
          top: spec.ay,
          width: 1,
          height: lh,
          background: caret,
          pointerEvents: "none",
        }}
      />
    )}
    {caretXs && sel[0] !== sel[1] && (
      <div
        data-mv-text-selection="1"
        style={{
          position: "absolute",
          left: spec.ax + (caretXs[Math.min(sel[0], sel[1])] ?? 0),
          top: spec.ay,
          width: Math.abs((caretXs[Math.min(Math.max(sel[0], sel[1]), caretXs.length - 1)] ?? 0) - (caretXs[Math.min(sel[0], sel[1])] ?? 0)),
          height: lh,
          background: "rgba(91,140,255,0.35)",
          pointerEvents: "none",
        }}
      />
    )}
    {isPara && (
      <div
        data-mv-text-box="1"
        style={{
          position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h,
          border: `${hair}px solid rgba(64,180,255,0.9)`,
          boxSizing: "border-box", pointerEvents: "none",
        }}
      />
    )}
    {isPara && sliceHandles(box).map((p, i) => (
      <div
        key={i}
        data-mv-text-box-handle={i}
        onPointerDown={onHandleDown(i)}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        style={{
          position: "absolute", left: p.x - hs / 2, top: p.y - hs / 2, width: hs, height: hs,
          background: "#fff", border: `${hair}px solid rgba(64,180,255,0.95)`,
          boxSizing: "border-box", cursor: TYPE_BOX_CURSORS[i],
        }}
      />
    ))}
    {isPara && overset && (
      // Photoshop's overset marker: a small ⊞ just past the bottom-right corner.
      <div
        data-mv-text-overset="1"
        title="Text overflows the box — drag a handle to reveal the rest"
        style={{
          position: "absolute", left: box.x + box.w + 6 / zoom, top: box.y + box.h - 12 / zoom,
          width: 12 / zoom, height: 12 / zoom,
          background: "#fff", color: "#c22", border: `${hair}px solid #c22`,
          fontSize: 10 / zoom, lineHeight: `${11 / zoom}px`, textAlign: "center",
          fontFamily: "sans-serif", pointerEvents: "none", userSelect: "none",
          boxSizing: "border-box",
        }}
      >+</div>
    )}
    </>
  );
}
