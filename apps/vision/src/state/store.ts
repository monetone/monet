import { typeOutlineScene } from "../text/outline";
// ─────────────────────────────────────────────────────────────
// Store — the reactive UI state for Monet Vision. A tiny observable
// (useSyncExternalStore-compatible) plus the action layer that drives
// the Rust/WASM engine and keeps the panels in sync.
// ─────────────────────────────────────────────────────────────

import { useSyncExternalStore } from "react";
import { hsvToRgb, type DockableWorkspaceHandle, type GradientValue, type HSV } from "@monet-ui/monet-react";
import { EngineClient, type CaptureMetadata } from "../engine/EngineClient";
import { historyTransactionActive } from "../engine/historyTransaction";
import type { SelectionPreviewMode } from "./selectionPreview";
import { flattenContours, normalizeContours, type CustomContour } from "./contours";
import { vectorFontStacksFromSceneJson } from "../engine/vectorFonts";
import type { ProofOptions } from "@monet-ui/monet-color";
import type { GenerateOpts } from "../ml/diffusion";
import { addSampler, removeNearestSampler, moveSampler, cmykWorkingSpace, ICC_MIN_BYTES, ICC_MAX_BYTES } from "@monet-ui/monet-color";
import { rgbToCmyk, rgbToLab, resolveLensProfile, type LensCorrectionSettings, type LensMetadata } from "@monet-ui/monet-photo";
import {
  MAX_NOTE_ID,
  MAX_PERSISTED_NOTES,
  addNote,
  cloneNotes,
  nextNoteIdAfter,
  normalizeNotes,
  setNoteTextById,
  moveNoteById,
  removeNoteById,
  type Note,
} from "./notes";
import type { ImportedNote } from "./noteImport";
import { normalizePath, isValidPath, defaultCustomShapeName, removeCustomShapeAt, parseCustomShapes, denormalizePath, BUILTIN_CUSTOM_SHAPES, withBuiltinCustomShapes, type CustomShape } from "./customShapes";
import { polygonVertices } from "./polygonShape";
import { shapePropsFromScene, sceneWithShapeProps, type ShapePatch, type ShapeProps } from "./shapeProps";
import { roundedRectVertices } from "./roundRectShape";
import { arrowheadPolygon } from "./arrowhead";
import { decodeDuotoneSpec, duotoneLutF32, normalizeDuotoneInks, type DuotoneInk, type DuotoneInks, type Overprints } from "./duotone";
import { DEFAULT_SWATCHES, addSwatchTo, removeSwatchAt, parseSwatches } from "@monet-ui/monet-color";
import { DEFAULT_TIMELINE, cloneTimeline, clampPlayhead, upsertKey, sampleTimeline, timelineLayerIds, type TimelineState, type TimelineKey } from "./timeline";
import { DEFAULT_BRUSH_PRESETS, defaultBrushPresetName, addBrushPresetTo, removeBrushPresetAt, parseBrushPresets, brushPresetNavigationIndex, type BrushPreset } from "./brushPresets";
import { DEFAULT_TOOL_PRESETS, defaultToolPresetName, addToolPresetTo, removeToolPresetAt, parseToolPresets, type ToolPreset } from "./toolPresets";
import { GRADIENT_PRESETS, defaultGradientPresetName, addGradientPresetTo, removeGradientPresetAt, parseGradientPresets, gradientForeignOf, stopFromHex, toGradientValue, type GradientForeign, type GradientPreset } from "./gradientPresets";
import { noiseGradientStops } from "./noiseGradient";
import { DEFAULT_STYLE_PRESETS, defaultStylePresetName, addStylePresetTo, removeStylePresetAt, parseStylePresets, sanitizeStyleEffects, type StylePreset, type StyleData, type StyleEffect } from "./stylePresets";
import { FX, FX_DEFS, fxDef, fxGradientStops, withFxGradientStops } from "./effects";
import { moveItem, renamePresetAt, mergeNamed, type PresetCategory } from "./presetManager";
import { defaultBrushTipName, addBrushTipTo, removeBrushTipAt, activeAfterRemove, serializeBrushTips, parseBrushTips, MAX_BRUSH_TIP_SIDE, MAX_BRUSH_TIPS, MAX_BRUSH_TIP_LIBRARY_BYTES, type BrushTip } from "./brushTips";
import { defaultPatternName, addPatternTo, removePatternAt, flattenStylePatterns, serializePatterns, parsePatterns, type PatternPreset } from "./patternPresets";
import { patternLibraryId } from "./effects";
import { persistLocalStorage } from "./persistLocalStorage";
import { DEFAULT_PANEL_OPTIONS, normalizePanelOptions, type PanelOptions } from "./panelOptions";
import { alignDeltas, arrangeComponents, distributeDeltas, type ComponentBounds, type ComponentDelta } from "./pathComponents";
import { hexToRgb, resolveFillRgb, type FillContent, type RGB } from "./fillContents";
import { setQuickMaskOverlay } from "./quickMaskOverlay";
import { hasPath, pathXY, defaultPathName, addPath, removeAt, hasAnchorForm, flattenAnchorPath, fromPhotoshopPaths, simulatedPressures, ANCHOR_STRIDE, MAX_CLIP_FLATNESS, MIN_CLIP_FLATNESS, MAX_PERSISTED_SAVED_PATHS, anchorLoops, workPathPolygon, pullAnchorHandles, WORK_PATH_ITEM, type SavedPath, type FillPathOptions } from "./paths";
import { nearestOverlayAnchor, nearestOverlayHandle, workPathOverlays, type OverlayPath } from "../canvas/vectorPathOverlay";
import { selectionToPath } from "./selectionToPath";
import { featherActive } from "./selectionFeather";
import { pathBounds, pathTransformMatrix, transformAnchors, transformHandles, transformPoints, type Affine, type HandlePt, type PathTransform } from "./transformControls";
import type { SamOutput, SamParams } from "./selectAndMask";
import { svgToPng } from "./svg";
import type { SelRect } from "./selectionInfo";
import { fitZoom, orientedDocSize } from "./zoomPresets";
import { matchedView, panToShow, type DocView, type PlacedView } from "./viewTransform";
import { spotHealDabs } from "./spotHeal";
import { defaultLiquify, liquifyReduce } from "./liquify";
import { clonePlanes, movePlaneHandle, resolvePlanes, tearOffPlane, uvRectQuad, warpQuadToQuad, type VanishingPlane, type VanishingRect } from "../canvas/vanishingPoint";
import { encodeLiquifyMesh, parseLiquifyMesh, type LiquifyMeshData } from "./liquifyMesh";
import { cloneLayerComps, defaultLayerCompName, addLayerComp, removeLayerCompAt, MAX_LAYER_COMPS, MAX_LAYERS_PER_COMP, MAX_LAYER_STATES, type LayerComp } from "./layerComps";
import { defaultSnapshotName, addSnapshot, removeSnapshot, type DocSnapshot } from "./snapshots";
import type { MarqueeStyle } from "./marqueeStyle";
import { frameFillOffset, type FrameMode } from "./frameTool";
import { ARTBOARD_PRESETS, presetSize, type Orientation } from "./artboardTool";
import { rasterizeSpec } from "../text/raster";
import { defaultSpec, type TextSpec } from "../text/spec";
import type { CropOverlay } from "./cropOverlay";
import type { HistChannel, HistScope } from "./channelHistogram";
import { bgFill, type BgContents } from "./bgContents";
import { DEFAULT_DOCUMENT_RESOLUTION_PPI, normalizeDocumentResolutionPpi } from "./docPresets";
import { DEFAULT_GUIDE_COLOR, cloneGuides, normalizeGuides, type Guide } from "./newGuide";
import { CLONE_SLOT_COUNT, defaultCloneSlots, validateCloneOptions, type CloneSlot, type CloneSlotTransform } from "./cloneSample";
import {
  DEFAULT_MEASURE_SCALE,
  isDefaultMeasureScale,
  normalizeMeasureScale,
  normalizeMeasureScalePresets,
  type MeasureScale,
  type MeasureScalePreset,
} from "./measureScale";
import type { StrokeAlign } from "./shapeStroke";
import type { StatusInfoMode } from "./statusInfo";
import { DEFAULT_FONT_PREVIEW_SIZE, normalizeFontPreviewSize, type FontPreviewSize } from "./fontPreview";
import {
  DEFAULT_PIXEL_ASPECT_PRESETS,
  deletePixelAspectPreset as deletePixelAspectPresetFrom,
  normalizePixelAspectPresets,
  normalizePixelAspectRatio,
  resetPixelAspectPresets as resetPixelAspectPresetsFrom,
  savePixelAspectPreset as savePixelAspectPresetTo,
  type PixelAspectPreset,
} from "./pixelAspect";
import type { LayerAttributeFilter, LayerEffectFilter, LayerKindFilter, LayerModeFilter } from "./layerKindFilter";
import { BLEND_ORDER, LAYER_KIND, blendIndex } from "./engineContracts";
import { toggleColorFilter } from "./layerColorFilter";
import { adjacentLayerIndex } from "./layerNav";
import { nextScreenMode, type ScreenMode } from "./screenMode";
import type { RampMode } from "@monet-ui/monet-color";
import { setLabel, type LayerLabel } from "./layerLabels";
import { sliceFromDrag, addSlice, deleteSlice, type Slice } from "./slices";
import {
  clampProfile,
  colorModeName,
  DEFAULT_COLOR_POLICY_PREFS,
  iccColorMode,
  normalizeCustomProfileName,
  normalizeColorPolicyPrefs,
  canConvertPasteProfile,
  pasteProfilePolicyDecisionForInfo,
  pasteProfileWarningForInfo,
  profileName,
  type ColorPolicyPrefs,
  type PasteProfileInfo,
  type RgbProfileId,
} from "@monet-ui/monet-color";
import { autoNameLayerUpdates } from "./layerAutoName";
import {
  DEFAULT_FILE_HANDLING_PREFS, DEFAULT_WEB_EXPORT_PREFS, RAW_DEMOSAICS,
  normalizeFileHandlingPrefs, normalizeWebExportPrefs,
  type FileHandlingPrefs, type RawDemosaic, type WebExportPrefs,
} from "./webExportPrefs";
import {
  DEFAULT_CAMERA_RAW_PREFS, DEFAULT_CURSOR_PREFS, DEFAULT_WORKSPACE_PREFS,
  isBrushTipCursor, normalizeCameraRawPrefs, normalizeCursorPrefs, normalizeWorkspacePrefs,
  type CameraRawPrefs, type CursorPrefs, type WorkspacePrefs,
} from "./preferencePanes";
import { DEFAULT_AUTO_RECOVER_MINUTES, normalizeAutoRecoverMinutes } from "./autoRecover";
import { emptyVariableData, normalizeVariableData, parseVariableCsv, type DataVariable, type VariableData } from "./dataVariables";
import type { ScriptEventId } from "./scriptEvents";
import { decodeProjectEnvelope, encodeProjectEnvelope, normalizeCaptureMetadata, normalizeSavedPaths, type PersistedSmartEditSource, type ProjectDocumentMeta } from "./projectEnvelope";
import {
  MAX_CAMERA_RAW_PENDING_SESSIONS,
  MAX_CAMERA_RAW_PENDING_SOURCE_BYTES,
  MAX_CAMERA_RAW_SOURCE_BYTES,
  normalizeCameraRawSourceMetadata,
  type CameraRawInvocationKind,
  type CameraRawDisposition,
  type CameraRawRecipe,
  type CameraRawSession,
  type CameraRawSource,
  type CameraRawSourceMetadata,
  type CameraRawSnapshotEntry,
} from "./cameraRaw";
import {
  cloneCameraRawSource,
  normalizeCameraRawSnapshots,
  normalizeCameraRawSource,
} from "./cameraRawSource";
import {
  cameraRawSidecarSourceSnapshot,
  serializeCameraRawXmp,
  type CameraRawSidecarSourceSnapshot,
} from "./cameraRawSidecar";
import {
  engineParamsToWorkingRecipe,
  normalizeWorkingRecipe,
  workingRecipeToParams,
  type VisionDevelopRecipe,
} from "./visionDevelopRecipe";
import {
  CAMERA_RAW_PROFILES_KEY,
  MAX_CAMERA_PROFILE_BYTES,
  MAX_CAMERA_PROFILES,
  asShotKelvin,
  cameraProfileSource,
  embeddedCameraProfile,
  keepProfileName,
  parseCameraRawProfiles,
  parseProfileInfo,
  resolveCameraRawProfile,
  storedProfileFileName,
  storedProfileName,
  type CameraRawProfileEntry,
  type CameraRawProfileStorage,
} from "./cameraRawProfiles";
import { getSmartLink, restoreSmartLinksForDoc, serializeSmartLinksForDoc } from "./smartLinks";
import { setSmartEditBinding } from "./smartEdits";
import { loadShortcutOverrides, normalizeShortcutOverrides, preserveToolActionOverrides, saveShortcutOverrides, type ShortcutOverrides } from "./keyboardShortcuts";
import { factoryToolbarConfiguration, validateToolbarConfiguration, type ToolbarConfiguration } from "./toolRail";
import type { Engine } from "@engine";
import type { PhotoshopRawLayout } from "./photoshopRaw";

export interface LayerInfo {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..100 — affects the layer AND its layer effects
  fillOpacity: number; // 0..100 — affects only the layer's own pixels, not its effects
  blendMode: string; // kebab id
  thumb: string; // data URL
  hasMask: boolean;
  maskThumb?: string; // data URL — the mask as grayscale (absent when there is none)
  maskEnabled?: boolean; // false = Layer ▸ Layer Mask ▸ Disable (red X on the thumbnail)
  hasFx: boolean; // has at least one enabled layer effect
  /** Which effect types are enabled on the layer: bit `FX id` set (#423). */
  fxMask?: number;
  clipped?: boolean; // clipping-masked to the layer below (Layer ▸ Create Clipping Mask)
  kind: number; // 0 pixel, 1 adjustment, 2 text, 3 vector, 4 fill, 6 group, 7 smart object
  group: number; // containing group id (0 = none)
  smartLink?: { name: string; path?: string; missing: boolean };
  /** Shared smart-object source; layers with the same non-zero value are
   *  instances of one another. 0 = standalone. */
  smartSourceId?: number;
  /** Per-attribute locks: 1 transparent · 2 image · 4 position (#418). */
  locks?: number;
}

/** Layer-mask preview mode (Photoshop's ⌥-click / `\` on the mask thumbnail). */
export type MaskView = "off" | "gray" | "rubylith";

/** An artboard (kind=6 bounds container with a white background), surfaced to the
 *  Artboard tool for its overlay (rect + handles + name) and hit-testing. Bounds
 *  are document-space px; `id` is the header layer's id. */
export interface ArtboardInfo {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ToolId =
  | "move"
  | "marquee"
  | "ellipse"
  | "singlerow"
  | "singlecolumn"
  | "lasso"
  | "polylasso"
  | "magneticlasso"
  | "wand"
  | "quickselection"
  | "objectselection"
  | "crop"
  | "frame"
  | "artboard"
  | "slice"
  | "sliceselect"
  | "brush"
  | "pencil"
  | "erase"
  | "magiceraser"
  | "clone"
  | "vanishingpoint"
  | "heal"
  | "spothealing"
  | "remove"
  | "adjustmentbrush"
  | "patch"
  | "contentawaremove"
  | "patternstamp"
  | "dodge"
  | "burn"
  | "sponge"
  | "smudge"
  | "liquify"
  | "blur"
  | "sharpen"
  | "backgrounderaser"
  | "colorreplace"
  | "mixerbrush"
  | "historybrush"
  | "redeye"
  | "bucket"
  | "gradient"
  | "shape"
  | "pen"
  | "freeformpen"
  | "curvaturepen"
  | "addanchor"
  | "deleteanchor"
  | "convertpoint"
  | "directselect"
  | "pathselect"
  | "text"
  | "verticaltype"
  | "horizontaltypemask"
  | "verticaltypemask"
  | "dropper"
  | "colorsampler"
  | "ruler"
  | "count"
  | "note"
  | "hand"
  | "rotateview"
  | "zoom";

/** The tools whose edit target is a path rather than pixels (Pen family +
 *  Path/Direct Selection). Photoshop relabels Edit ▸ Free Transform / Transform
 *  to "…Path" exactly while one of these holds a path — see
 *  Store.pathIsTransformTarget. */
export const PATH_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  "pen", "freeformpen", "curvaturepen", "addanchor", "deleteanchor", "convertpoint",
  "directselect", "pathselect",
]);

/** A summary of one open document, surfaced to the title-bar tab strip and the
 *  document browser. The heavy state (the wasm Engine + view state) lives in the
 *  Store's private `DocEntry` list; this is the reactive, render-safe slice. */
export interface DocSummary {
  id: number;
  name: string;
  dirty: boolean; // has unsaved changes since the last save / open
  /** A remembered file path — File ▸ Revert has something to reload. */
  hasFile: boolean;
}

/** Window ▸ Arrange layouts for the second view. `single` is Photoshop's "New
 *  Window for <doc>" (one extra view of the active document); the rest are its
 *  n-up tilings of every open document. */
export type ArrangeMode = "single" | "vertical" | "horizontal" | "grid";

/** Columns to lay `n` open documents out in. Photoshop's Tile All Vertically
 *  puts the windows side by side (n columns), Tile All Horizontally stacks them
 *  (1 column), and Tile picks the squarest grid. */
export function arrangeColumns(n: number, mode: ArrangeMode): number {
  if (n < 2) return 1;
  if (mode === "vertical") return n;
  if (mode === "horizontal") return 1;
  return Math.ceil(Math.sqrt(n));
}

/** A canvas view: where the document sits, and the viewport it sits in. */
export interface CanvasViewState extends DocView {
  viewport: { w: number; h: number };
}
const PANE_VIEW: CanvasViewState = { zoom: 1, panX: 0, panY: 0, rotationAngle: 0, viewport: { w: 0, h: 0 } };

/** The main canvas's view (`pane` omitted) — it lives at the top of the
 *  snapshot and travels with the document on tab switches — or the view of the
 *  Window ▸ Arrange pane showing document `pane`, which is its own. */
export function viewOf(s: AppSnapshot, pane?: number): CanvasViewState {
  return pane === undefined ? s : s.paneViews[pane] ?? PANE_VIEW;
}

/** Internal per-document record. One wasm `Engine` instance per open document,
 *  plus the view state that travels with it across tab switches. */
interface DocEntry extends VariableData {
  id: number;
  engine: Engine;
  name: string;
  savedPath: string | null; // native file path for save-in-place (Tauri)
  captureMetadata?: CaptureMetadata;
  zoom: number;
  panX: number;
  panY: number;
  rotationAngle: number; // Rotate View: non-destructive canvas rotation (degrees)
  historyLabels: string[];
  dirty: boolean;
  /** Monotonic content token. Every dirtying mutation advances it so an
   *  asynchronous save can only acknowledge the exact bytes it serialized. */
  contentRevision: number;
  /** Repaints that edit nothing (a dialog preview or its cancel, late font
   *  provisioning). With contentRevision it keys a view of a background
   *  document, which has no blit to follow (see docDisplayRevision). */
  displayRevision: number;
  pristineBlank: boolean; // launch blank only. A user File ▸ New stays open when a file opens (#528)
  colorProfileAssigned: boolean; // false = Photoshop-style untagged RGB document
  iccProfileBytes: Uint8Array | null; // raw PSD ICC payload for imported custom profiles
  iccProfileName: string | null;
  notes: Note[];
  activeNoteId: number;
  nextNoteId: number;
  layerComps: LayerComp[];
  /** Layers panel colour tags. Keyed by layer id, and ids are per engine, so
   *  the map belongs to its document — a global one tagged the same-id layer in
   *  every other open tab (#144). */
  layerColorLabels: Record<number, LayerLabel>;
  guides: Guide[];
  resolutionPpi: number;
  pixelAspect: number;
  pixelAspectCorrection: boolean;
  measureScale: MeasureScale;
  /** Paths panel: named paths belong to the document (they persist in the file). */
  savedPaths: SavedPath[];
  /** The Pen tool's work path travels with its document across tab switches.
   *  ponytail: session-only, like Photoshop's temporary Work Path — promote it
   *  into the envelope if a document should reopen mid-authoring. */
  penPath: number[];
  penAnchors: number[];
  penContours: number[];
  /** Filter ▸ Vanishing Point: the planes and the Alt-sampled source are raw
   *  document pixel coordinates, so they belong to the document that was open
   *  when they were placed (#503). */
  vanishingPointPlanes: VanishingPlane[];
  vanishingPointActivePlane: number;
  vanishingPointSource: { x: number; y: number } | null;
  /** Image ▸ Mode ▸ Duotone: the ink specification and the adjustment layer it
   *  drives. The layer id is per engine, so this belongs to its document — held
   *  globally it was dropped on every tab switch, and the dialog then built a
   *  second ink layer on a document that already had one (#492). */
  duotone: DuotoneDoc | null;
  /** Timeline panel state travels with the document. The playhead is not a key. */
  timeline: TimelineState;
  playhead: number;
  /** The generation settings that produced this document ("Generate Similar" re-rolls). */
  genMeta?: GenerateOpts;
  /** Original camera source + canonical non-destructive recipe for RAW-backed documents. */
  cameraRaw: CameraRawSource | null;
  /** The layer that owns the source recipe. Kept runtime-only; restored by filter identity. */
  cameraRawLayerId: number | null;
}

export interface PendingDialogRequest {
  name: string;
  arg?: unknown;
  /** Monotonic token so two consecutive requests for the same dialog are distinct. */
  serial: number;
}

export interface CameraRawDialogRequest {
  invocation: CameraRawInvocationKind;
  sessionId?: string;
  targetDocumentId?: number;
  targetLayerId?: number;
}

/** What a Camera Raw develop is for, to find its camera profiles: a staged
 *  session, or a document's layer. */
export interface CameraRawProfileTarget {
  sessionId?: string;
  documentId?: number;
  layerId?: number;
}

/** Derived, byte-free data captured synchronously for a DNG export. */
export interface CameraRawExportSnapshot {
  metadata?: { make?: string; model?: string; serialNumber?: string };
  xmp?: string;
}

export interface OpenCameraRawOptions {
  originalPath?: string;
  sidecarPath?: string;
  sha256?: string;
  lastModified?: number;
  invocation?: Extract<CameraRawInvocationKind, "raw-open" | "open-as-smart-object">;
  /** Seed recipe: the working V2 recipe (e.g. from a sidecar) or the legacy
   *  Canonical shape — both are migrated/normalized by normalizeCameraRawSource. */
  recipe?: CameraRawRecipe | VisionDevelopRecipe;
}

interface RuntimeCameraRawSession {
  state: CameraRawSession;
  engine: Engine;
  completion: Promise<Exclude<CameraRawDisposition, "pending">>;
  resolveCompletion: (disposition: Exclude<CameraRawDisposition, "pending">) => void;
  // The authoritative develop state (docs/plans/10 d2e): the store holds the
  // working V2 recipe; state.source.recipe is the same working recipe (both are
  // VisionDevelopRecipe now — the Canonical compat projection is retired).
  working: VisionDevelopRecipe;
}

interface ClipboardProfileMeta {
  profile: RgbProfileId;
  assigned: boolean;
  iccProfileBytes: Uint8Array | null;
  iccProfileName: string | null;
}

interface DocumentAdoptionCheckpoint {
  docs: DocEntry[];
  activeDocId: number;
  nextDocId: number;
  snapshot: AppSnapshot;
  activeEngine: Engine | null;
  clipboardProfileMetaByDoc: Map<number, ClipboardProfileMeta>;
  snapshotsByDoc: Map<number, DocSnapshot[]>;
}

export interface BrushState {
  size: number;
  hardness: number;
  flow: number;
  opacity: number;
  spacing: number;
  smoothing: number; // 0..1 — Photoshop brush-path Smoothing (lag toward the cursor)
  angle: number; // Brush Tip Shape angle in degrees (-180..180; elliptical tip)
  roundness: number; // Brush Tip Shape roundness 0..1 (1 = round, <1 = squashed)
  sizePressure: boolean;
  flowPressure: boolean;
  /** Brush Mode (Photoshop's blend dropdown; BlendMode index, 0 = Normal). Applies
   *  to the paint/pencil path only — the engine ignores it for other brush tools. */
  blend: number;
  // Dodge/Burn tool options (Photoshop): tonal range 0 shadows/1 midtones/
  // 2 highlights, exposure 0..1, and protect-tones (preserve hue/saturation).
  dodgeRange: number;
  dodgeExposure: number;
  protectTones: boolean;
  // Sponge: mode 0 saturate / 1 desaturate, rate 0..1, vibrance protects
  // already-saturated pixels from clipping (Photoshop's Vibrance option).
  spongeMode: number;
  spongeRate: number;
  spongeVibrance: boolean;
  // Blur / Sharpen brush strength 0..1; Sharpen Protect limits shadow boost.
  blurRate: number;
  sharpenRate: number;
  sharpenProtect: boolean;
  // Background Eraser: colour-match tolerance 0..1 + Protect Foreground.
  bgEraserTolerance: number;
  bgEraserProtectFg: boolean;
  // Mixer Brush: Wet (canvas pickup / smear rate), Load (foreground paint in the
  // reservoir at stroke start), Mix (reservoir-vs-canvas fraction per deposit;
  // high mix → reservoir dominates). All 0..1.
  mixerWet: number;
  mixerLoad: number;
  mixerMix: number;
  // Smudge ▸ Finger Painting: seed the smear with the foreground colour.
  smudgeFinger: boolean;
  // Sample All Layers (Blur / Sharpen / Smudge / Mixer): the dab reads the merged
  // image beneath the brush, so a retouch can live on an empty layer over a stack.
  sampleAllLayers: boolean;
  // Background Eraser ▸ Sampling 0 Continuous / 1 Once / 2 Background Swatch and
  // Limits 0 Discontiguous / 1 Contiguous / 2 Find Edges. Both default to what
  // the tool did before they existed — Once + Discontiguous — matching the
  // engine's own defaults (raster/mod.rs `bg_sampling` / `bg_limits`). Photoshop
  // ships Continuous / Contiguous, but that would re-render existing strokes.
  bgEraserSampling: number;
  bgEraserLimits: number;
  // Mixer Brush ▸ Load / Clean the brush after each stroke.
  mixerAutoLoad: boolean;
  mixerAutoClean: boolean;
  // Airbrush / Build-up (Photoshop's airbrush toggle): a brush held still keeps
  // depositing at the Flow rate. Dabs are otherwise gated on travelled distance,
  // so CanvasView runs a repeat-dab timer while this is on.
  airbrush: boolean;
  // Eraser ▸ Erase to History: strokes restore the History source (the History
  // Brush's paint path) instead of erasing to transparency. Needs a source set.
  eraseToHistory: boolean;
  // Pencil ▸ Auto Erase: a stroke that starts on a pixel already wearing the
  // foreground colour paints the background colour for its whole length.
  autoErase: boolean;
  // Healing Brush ▸ Source: "sampled" heals from the alt-clicked canvas point,
  // "pattern" heals the defined pattern tile in (Edit ▸ Define Pattern) — the
  // Pattern Stamp's clone source, run through the heal's boundary solve.
  healSource: "sampled" | "pattern";
  // Healing Brush ▸ Diffusion 1..7 (Photoshop's default is 5): how fast the
  // patch falls off into its surroundings. 1 carries the transplanted grain out
  // to the rim; 7 ramps it in gradually, which is what skin and sky want.
  healDiffusion: number;
  // Spot Healing Brush ▸ Type: 0 Content-Aware · 1 Proximity Match · 2 Create
  // Texture, and Sample All Layers (heal from the composite, write the active
  // layer only).
  spotHealType: number;
  spotHealSampleAll: boolean;
}

export type LiquifyBackdropSource = "all" | "active" | "behind";

/** Liquify forward-warp brush options (Filter ▸ Liquify). The tool drives the
 *  engine's runtime liquify session (begin/dab/end/cancel) with these. mode:
 *  0 push · 1 bloat · 2 pucker · 3 twirl CW · 4 twirl CCW · 5 reconstruct ·
 *  6 freeze mask · 7 thaw mask. */
export interface LiquifyState {
  size: number;       // brush diameter (px); the engine footprint radius is size/2
  density: number;    // 0..1 edge feather (the smoothstep falloff hardness)
  pressure: number;   // 0..1 base per-dab effect, scaled by pointer pressure
  strength: number;   // 0..1 per-dab warp strength
  mode: number;       // 0..7 mode (see above)
  targetLayerId: number; // 0 = current active layer; otherwise an unlocked pixel layer id
  preview: boolean;   // display the live warp preview; false shows the pre-session composite
  showBackdrop: boolean; // display the pre-session composite behind the live warp
  backdropSource: LiquifyBackdropSource; // all = pre-session composite; active = active layer only; behind = layers below active
  backdropOpacity: number; // 0..1 display-only backdrop opacity
  showMesh: boolean; // display the live Liquify displacement mesh overlay
  // 0..1 Brush Rate: 0 = no effect while the pointer is held still (today's
  // behaviour); >0 drives a repeat-dab timer in CanvasView.
  rate: number;
  pinEdges: boolean; // Pin Edges: the outer 1px canvas border never displaces
}

type LiquifySession = {
  docId: number;
  engine: Engine;
  targetLayerId: number;
  restoreLayerId: number;
};

/** One colour stop in the gradient-tool ramp. pos 0..1; r/g/b/a 0..255.
 *  `midpoint` (0..1, the blend centre toward the NEXT stop) has no Vision UI — it
 *  is carried so a gradient authored in Artisan round-trips unharmed. */
export interface GradientStop { pos: number; r: number; g: number; b: number; a: number; midpoint?: number; }

export interface LayerStyleState extends StyleData {
  knockout: number;
  transparencyShapes: boolean;
  blendInteriorGroup: boolean;
  blendClippedGroup: boolean;
  /** Advanced Blending ▸ Channels (bits 1 R / 2 G / 4 B). Optional: a style
   *  recorded before the control existed replays as all three (#421). */
  blendChannels?: number;
}

export interface PhotoshopPreview {
  mode: number; // raw Adobe mode: 0 Bitmap, 1 Gray, 2 Indexed, 4 CMYK, 7 Multi, 8 Duotone, 9 Lab
  depth: number;
  isPsb: boolean;
}

/** One document plate's value at a pixel, following the same ink model the
 *  engine's duplicate_channel uses: `channel` is 1-based within the mode's plate
 *  set (R,G,B · Gray · C,M,Y,K · L,a,b) and 0 — or an index past the set — is the
 *  composite Rec.601 luminance. Feeds the Channels panel's thumbnails.
 *  ponytail: mirrors monet-photo's channelCounts binning; fold both onto a shared
 *  per-pixel helper there if a third caller appears. */
function plateValue(mode: number, channel: number, r: number, g: number, b: number): number {
  let v: number | undefined;
  if (channel >= 1 && mode !== 1) {
    if (mode === 2 || mode === 4) { const c = rgbToCmyk(r, g, b); v = [c.c, c.m, c.y, c.k][channel - 1] * 255 / 100; }
    else if (mode === 3) { const l = rgbToLab(r, g, b); v = [l.l * 255 / 100, l.a + 128, l.b + 128][channel - 1]; }
    else v = [r, g, b][channel - 1];
  }
  if (v === undefined) v = r * 0.299 + g * 0.587 + b * 0.114;
  return Math.round(v) < 0 ? 0 : Math.min(255, Math.round(v));
}

/** Nearest-neighbour `tw`×`th` grayscale RGBA thumbnail of one document plate,
 *  sampled straight out of an RGBA composite. Sampling (rather than scaling the
 *  whole plane) keeps the cost the thumbnail's pixels, not the document's.
 *  Exported for its unit test; the DOM half lives in channelThumbUrls. */
export function channelPlaneThumb(src: ArrayLike<number>, w: number, h: number, tw: number, th: number, mode: number, channel: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / tw));
      const o = (sy * w + sx) * 4;
      const v = plateValue(mode, channel, src[o], src[o + 1], src[o + 2]);
      const p = (y * tw + x) * 4;
      out[p] = out[p + 1] = out[p + 2] = v;
      out[p + 3] = 255;
    }
  }
  return out;
}

/** One gray byte per pixel → opaque grayscale RGBA. */
export function grayToRgba(gray: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0; i < gray.length; i++) {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = gray[i];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Downsample a coverage plane (w*h, 255 = selected/full ink) to an opaque
 *  grayscale thumbnail — the alpha / spot / Quick Mask twin of
 *  `channelPlaneThumb`, which reads an RGBA composite instead. Same nearest
 *  sampling, so every Channels row scales identically. Pure; exported for its
 *  unit test, with the DOM half in `coverageThumbUrl`. */
export function coverageThumb(src: ArrayLike<number>, w: number, h: number, tw: number, th: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / tw));
      const v = src[sy * w + sx];
      const p = (y * tw + x) * 4;
      out[p] = out[p + 1] = out[p + 2] = v;
      out[p + 3] = 255;
    }
  }
  return out;
}

/** Channels panel ▸ Channel Options for one alpha channel: the overlay colour it
 *  is drawn in, that overlay's opacity (0..1) and whether the colour indicates
 *  Masked Areas or Selected Areas. Display-only, exactly like Quick Mask — the
 *  channel's bytes are untouched, so nothing here is persisted. */
export interface ChannelOptions {
  color: string; // #rrggbb
  opacity: number; // 0..1
  indicates: "masked" | "selected";
}

/** Photoshop's defaults for a new alpha channel: 50% red indicating Masked Areas. */
export const DEFAULT_CHANNEL_OPTIONS: ChannelOptions = { color: "#ff0000", opacity: 0.5, indicates: "masked" };

/** History panel flyout ▸ History Options. Application-wide (not per document)
 *  and persisted alongside History States, like Photoshop.
 *  Photoshop's "Allow Non-Linear History" is absent: preserving the redo branch
 *  across a new edit is an engine undo-model change, not a store one.
 *  https://helpx.adobe.com/photoshop/using/undo-history.html */
export interface HistoryOptions {
  /** Snapshot every document at its opened/created state. */
  autoFirstSnapshot: boolean;
  /** Snapshot a document each time it is saved. */
  autoSnapshotOnSave: boolean;
  /** Ask for a name when taking a snapshot instead of auto-naming it. */
  showNewSnapshotDialog: boolean;
  /** Whether toggling a layer's eye pushes an undo state (Photoshop: off). */
  layerVisibilityUndoable: boolean;
}

/** Photoshop "History States" bounds, mirroring the engine's own clamp. */
export const HISTORY_STATES_MIN = 1;
export const HISTORY_STATES_MAX = 1000;

/** Photoshop's out-of-the-box History Options. */
export const DEFAULT_HISTORY_OPTIONS: HistoryOptions = {
  autoFirstSnapshot: true,
  autoSnapshotOnSave: false,
  showNewSnapshotDialog: false,
  layerVisibilityUndoable: false,
};

/** Re-validate persisted History Options — user-editable storage, so every flag
 *  is checked and anything unknown falls back to the Photoshop default. */
export function normalizeHistoryOptions(raw: unknown): HistoryOptions {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const flag = (k: keyof HistoryOptions) => typeof o[k] === "boolean" ? o[k] as boolean : DEFAULT_HISTORY_OPTIONS[k];
  return {
    autoFirstSnapshot: flag("autoFirstSnapshot"),
    autoSnapshotOnSave: flag("autoSnapshotOnSave"),
    showNewSnapshotDialog: flag("showNewSnapshotDialog"),
    layerVisibilityUndoable: flag("layerVisibilityUndoable"),
  };
}

/** Preferences ▸ History Log ▸ Edit Log Items. "Sessions Only" records opening
 *  and saving a document, "Concise" adds every History-panel state, "Detailed"
 *  prefixes each state with its document and timeline position. */
export type HistoryLogDetail = "sessions" | "concise" | "detailed";
export const HISTORY_LOG_DETAILS: readonly HistoryLogDetail[] = ["sessions", "concise", "detailed"];

export interface HistoryLogPrefs {
  /** Off by default, exactly like Photoshop — the log is opt-in. */
  enabled: boolean;
  detail: HistoryLogDetail;
}

export const DEFAULT_HISTORY_LOG: HistoryLogPrefs = { enabled: false, detail: "concise" };
/** Keep a long session's log bounded; the oldest lines fall off the front. */
export const HISTORY_LOG_MAX = 5000;

/** Re-validate the persisted History Log preference — user-editable storage. */
export function normalizeHistoryLog(raw: unknown): HistoryLogPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULT_HISTORY_LOG.enabled,
    detail: HISTORY_LOG_DETAILS.includes(o.detail as HistoryLogDetail)
      ? o.detail as HistoryLogDetail
      : DEFAULT_HISTORY_LOG.detail,
  };
}

/** One log line, in Photoshop's "date time  text" shape (local time). */
export function historyLogLine(at: Date, text: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
  return `${date} ${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}  ${text}`;
}

/** Append lines, oldest-first, dropping the front once HISTORY_LOG_MAX is passed.
 *  Returns `entries` itself when there is nothing to add, so a sync that logged
 *  nothing cannot trigger a re-render. */
export function appendHistoryLog(entries: readonly string[], lines: readonly string[]): readonly string[] {
  if (!lines.length) return entries;
  const next = [...entries, ...lines];
  return next.length > HISTORY_LOG_MAX ? next.slice(next.length - HISTORY_LOG_MAX) : next;
}

/** The log lines a freshly-read timeline adds. A plain undo/redo leaves the
 *  labels alone and only moves the cursor, so only a *changed* timeline (a new
 *  state appended, with or without a truncated redo tail) is logged. */
export function historyLogDelta(
  log: HistoryLogPrefs,
  prev: readonly string[],
  history: readonly string[],
  historyIndex: number,
  docName: string,
  at: Date,
): string[] {
  if (!log.enabled || log.detail === "sessions") return [];
  if (historyIndex < 1 || historyIndex > history.length) return [];
  const changed = history.length !== prev.length || history.some((label, i) => label !== prev[i]);
  if (!changed) return [];
  const label = history[historyIndex - 1];
  return [historyLogLine(at, log.detail === "detailed"
    ? `${docName}: ${label} (state ${historyIndex} of ${history.length})`
    : label)];
}

/** A History Snapshot as the panel draws it: the checkpoint plus the thumbnail
 *  captured when it was taken. The bytes stay the source of truth — `thumb` is
 *  presentation only, and empty when no canvas was available (headless). */
export interface SnapshotRow extends DocSnapshot {
  thumb: string; // data URL, or "" when the capture failed
}

/** History panel snapshot thumbnail box, in CSS px (fits the 24px-tall row). */
export const SNAPSHOT_THUMB_W = 30;
export const SNAPSHOT_THUMB_H = 20;

/** A duotone document's ink specification: the named inks with their transfer
 *  curves, the Overprint Colors, and the gradient-map adjustment layer that
 *  prints the gray plate through them. */
export interface DuotoneDoc extends DuotoneInks {
  layerId: number;
}

export interface AppSnapshot {
  ready: boolean;
  /** A dialog the store has asked the UI to open (e.g. Camera Raw after a RAW
   *  open); the App drains it to `open(name)` then clears it. null = nothing pending. */
  pendingDialog: PendingDialogRequest | null;
  tool: ToolId;
  spacePan: boolean; // spacebar held → temporary Hand (pan), like Photoshop
  fg: HSV;
  bg: HSV;
  brush: BrushState;
  liquify: LiquifyState;
  zoom: number;
  panX: number;
  panY: number;
  rotationAngle: number; // Rotate View tool: non-destructive view rotation (degrees, ±180)
  viewport: { w: number; h: number }; // canvas viewport size (px), published by CanvasView for the Navigator
  /** Window ▸ Arrange panes' own zoom/pan/rotation/viewport, by the document each shows. */
  paneViews: Record<number, CanvasViewState>;
  /** Window ▸ Arrange ▸ Float in Window: documents out of the tab bar, each in
   *  its own OS window (desktop only), in the order they floated — Cascade's. */
  floatDocs: number[];
  doc: { width: number; height: number; name: string };
  // open documents (title-bar tabs + document browser) and the active one
  documents: DocSummary[];
  activeDocId: number;
  layers: LayerInfo[];
  activeLayerId: number;
  selectedLayerIds: number[]; // multi-layer selection (always includes the active id)
  selectionActive: boolean;
  // monotonic revision of the selection mask — the marching-ants outline is
  // rebuilt exactly when this changes (a boolean can't see select→reselect)
  selectionGen: number;
  // monotonic revision of the pending Camera Raw session set — the workspace
  // filmstrip re-reads pendingCameraRawSessions() when this changes (sessions
  // stage asynchronously, so the list grows after the workspace has mounted).
  cameraRawSessionsRev: number;
  maskEdit: boolean;
  // Display-only preview of the ACTIVE layer's mask: "gray" shows the mask alone
  // (⌥-click its thumbnail), "rubylith" paints it red over the image (\). Like
  // Quick Mask this is drawn by CanvasView from layerMaskBuffer() — the engine
  // output, and so export/pick_color/histogram, is never touched.
  maskView: MaskView;
  // Quick Mask mode (true rubylith overlay) — distinct from maskEdit (layer-mask
  // painting). quickMaskGen mirrors the engine's qm_gen so the overlay rebuilds
  // exactly when the Quick Mask buffer changes (enter/exit/stroke).
  quickMask: boolean;
  quickMaskGen: number;
  // Liquify Freeze Mask overlay revision. Painting the mask changes this without
  // marking the document dirty because the overlay is session-only workspace data.
  liquifyMaskGen: number;
  // Liquify Backdrop overlay revision. The actual pixels are runtime-only on the
  // Store; this generation lets CanvasView redraw when a session starts/ends.
  liquifyBackdropGen: number;
  // Liquify Mesh preview revision. The displacement fields live in the engine
  // only while a session is open; this generation lets CanvasView redraw after
  // warps, Restore All, mesh loads, Apply, and Cancel.
  liquifyMeshGen: number;
  isolated: boolean; // Layer ▸ Isolate Layers active
  mode: number; // 0 RGB, 1 Grayscale, 2 CMYK, 3 Lab, 4 Multichannel
  /** Image ▸ Mode ▸ Duotone. Non-null = this is a duotone document: `mode` is
   *  Grayscale (the single plate) and these inks print it. Editable and
   *  re-openable, like Photoshop's Duotone Options. */
  duotone: DuotoneDoc | null;
  depth: number; // 8, 16, 32
  /** Exact-source-preserved non-RGB Photoshop import. The RGB rendering is a
   *  read-only preview until the user explicitly accepts conversion to RGB. */
  photoshopPreview: PhotoshopPreview | null;
  resolutionPpi: number; // physical print resolution; does not change pixel dimensions
  colorProfile: RgbProfileId;
  colorProfileAssigned: boolean;
  iccProfileBytes: Uint8Array | null;
  iccProfileName: string | null;
  /** The CMYK / Gray / Lab profile Convert to Profile separated the document
   *  through — read back from the engine, which owns it (and its undo). */
  modeProfileName: string | null;
  canUndo: boolean;
  canRedo: boolean;
  canFade: boolean;
  canReselect: boolean;
  hasClipboard: boolean;
  hasHistorySource: boolean;
  hasSmartFilterMask: boolean;
  undoLabel: string;
  redoLabel: string;
  undoDepth: number;
  historyStates: number; // Photoshop "History States": retained undo steps (1–1000, default 50)
  historyOptions: HistoryOptions; // History panel flyout ▸ History Options (app-wide, persisted)
  panelOptions: PanelOptions;
  historyLog: HistoryLogPrefs; // Preferences ▸ History Log (app-wide, persisted)
  historyLogEntries: readonly string[]; // the log itself — session-only, bounded by HISTORY_LOG_MAX
  // tool options
  selMode: number; // 0 replace, 1 add, 2 subtract, 3 intersect
  selectionFeather: number; // Marquee/Lasso options-bar Feather radius in px (0 = hard edge)
  histChannel: HistChannel; // Histogram panel channel (luma/r/g/b)
  histAllChannels: boolean; // Histogram panel: show R/G/B histograms together (All Channels View)
  histScope: HistScope; // Histogram panel: which scope to show (tonal histogram / hue-sat vectorscope / luma waveform) — ACR right-click cycle
  colorRampMode: RampMode; // Color panel ramp type (spectrum / grayscale / current colours)
  shapeKind: "rect" | "ellipse" | "custom" | "polygon" | "line" | "roundrect";
  // Shape tool Mode — Photoshop's Shape/Path/Pixels dropdown. "shape" commits a
  // live kind-3 vector layer (like the Pen's Shape mode), "path" sets the work
  // path, "pixels" fills raster pixels (the historical behaviour).
  shapeMode: "shape" | "path" | "pixels";
  roundRectRadius: number; // Rounded Rectangle corner radius in px
  // Shape Stroke (Rectangle / Ellipse): outline width in px (0 = no stroke) drawn
  // in the background colour, aligned inside / centre / outside the shape edge.
  shapeStrokeWidth: number;
  shapeStrokeAlign: StrokeAlign;
  cropAspect: string; // Crop tool Ratio preset key ("free" = unconstrained)
  cropOverlay: CropOverlay; // Crop tool composition overlay (Rule of Thirds default)
  cropOverlayOrientation: number; // Shift+O: Triangle (2) / Golden Spiral (8) orientation
  cropContentAware: boolean; // Crop tool: content-aware-fill the border exposed by an enlarging crop
  /** Crop tool ▸ Delete Cropped Pixels. Off keeps the whole plane so Image ▸
   *  Reveal All can bring it back; on reclaims it (Photoshop's default), which
   *  is the only way a crop ever shrinks the saved file. */
  cropDeletePixels: boolean;
  // Rectangular/Elliptical Marquee "Style": normal (free drag), ratio (lock the
  // marqueeFixedW:marqueeFixedH aspect), or size (an exact marqueeFixedW×H px box).
  marqueeStyle: MarqueeStyle;
  marqueeFixedW: number;
  marqueeFixedH: number;
  // Frame tool (K): the clip shape a drag creates — rectangular or elliptical
  // (mirrors the Rectangular/Elliptical Marquee pair).
  frameMode: FrameMode;
  // Artboard tool: the live artboard list (for the overlay + hit-testing), the
  // selected artboard id (0 = none), and the options-bar size preset/orientation
  // that drive the "Add Artboard" button.
  artboards: ArtboardInfo[];
  selectedArtboard: number;
  artboardPreset: string;
  artboardOrientation: Orientation;
  swatches: string[]; // Swatches panel: saved foreground colours (#rrggbb)
  timeline: TimelineState; // Timeline panel: keyframe motion (opacity + layer offset)
  playhead: number; // seconds; clamped into the active document's duration
  brushPresets: BrushPreset[]; // Brushes panel: saved brush settings snapshots
  activeBrushPreset: number; // selected settings preset; -1 until one is applied
  toolPresets: ToolPreset[]; // Tool Presets: saved tool + brush + foreground snapshots
  gradientPresets: GradientPreset[]; // Gradients panel: built-in + user-saved colour ramps
  stylePresets: StylePreset[]; // Styles panel: saved layer-effect stacks (fx + blend-if + fill)
  spotChannelNames: string[]; // Channels panel: names of the active doc's spot-ink plates
  // Channels panel ▸ channel targeting. The alpha channel currently open for
  // editing (null = the composite, Photoshop's default target). A targeted
  // channel lives in the Quick Mask buffer, so brushes paint it and CanvasView
  // draws it; leaving the target writes the buffer back into the channel.
  channelTarget: string | null;
  channelAlone: boolean; // the channel's eye: show the targeted plane alone, in grayscale
  channelOptions: Record<string, ChannelOptions>; // per-alpha-channel display options
  selectedAnchor: { item: string; index: number } | null; // Direct Selection: the grabbed path anchor
  selectedHandle: { item: string; index: number; end: "in" | "out" } | null; // Direct Selection: the grabbed bezier handle end
  selectedPaths: string[]; // Path Selection: the selected path component ids (shift-click extends)
  paintSymmetry: number; // Paint Symmetry preset index in Photoshop menu order (0..10)
  paintSymmetrySegments: number; // radial 2–12; mandala 3–10
  paintSymmetryAxisX: number; // document-space centre of the active symmetry path
  paintSymmetryAxisY: number;
  paintSymmetryAngle: number; // path rotation in degrees
  paintSymmetryScale: number; // uniform path scale
  paintSymmetryVisible: boolean; // display-only guide visibility
  paintSymmetryTransforming: boolean; // transient Image ▸ Transform Symmetry session
  patternPreview: boolean; // View ▸ Pattern Preview: tile the document edge-to-edge
  // Edit ▸ Define Brush Preset: custom brush TIPS (captured alpha bitmaps) the
  // brush paints with instead of the round disc. Runtime-only (NOT in .mvision);
  // only the active tip's bytes are pushed to the engine. -1 = the round brush.
  brushTips: BrushTip[];
  activeBrushTip: number;
  // Edit ▸ Define Pattern: the named Patterns library. The engine holds ONE
  // active tile; picking a preset pushes its texels into that slot, which every
  // pattern consumer reads. -1 = nothing pushed yet.
  patternPresets: PatternPreset[];
  activePattern: number;
  // Polygon shape (Photoshop's Polygon tool): a regular N-gon, or a star with an
  // inner radius of polygonIndent×outer when polygonStar is on.
  polygonSides: number;
  polygonStar: boolean;
  polygonIndent: number;
  lineWeight: number; // Line shape thickness in px (Photoshop's Line tool Weight)
  // Line tool arrowheads: Start/End enable, plus Width/Length (absolute px) and
  // Concavity (-50..50%) — Photoshop's Line arrowhead options.
  lineArrowStart: boolean;
  lineArrowEnd: boolean;
  lineArrowWidth: number;
  lineArrowLength: number;
  lineArrowConcavity: number;
  // Edit ▸ Define Custom Shape: reusable vector presets captured from the Pen
  // path, stored normalized (0..1) to their bounding box. activeCustomShape is an
  // index into customShapes that the Shape tool draws when shapeKind === "custom".
  customShapes: CustomShape[];
  activeCustomShape: number;
  fillTolerance: number; // 0..1
  fillContiguous: boolean;
  fillSampleAllLayers: boolean; // bucket determines the region from the merged image (PS default: false)
  fillSource: "foreground" | "pattern"; // Paint Bucket Fill source (pattern = the defined pattern)
  fillMode: string; // Paint Bucket blend Mode (kebab key; blendIndex → engine u8)
  fillOpacity: number; // Paint Bucket fill opacity 0..1
  wandTolerance: number; // 0..1
  wandContiguous: boolean;
  wandSampleAllLayers: boolean; // wand samples the merged image vs the active layer (PS default: false)
  quickSelectionTolerance: number; // 0..1 — Quick Selection colour-match tolerance
  quickSelectionMode: number; // 0 New / 1 Add / 2 Subtract (options-bar Mode; Alt still forces Subtract)
  patchMode: number; // Patch tool Mode: 0 Normal / 1 Content-Aware (engine u8)
  patchDestination: boolean; // Patch: Source (heal the selection from the drop point) vs Destination (push its contents there)
  patchTransparent: boolean; // Patch (Normal): transfer only the sampled texture, keep the selection's own tone/gradient
  patchStructure: number; // Patch (Content-Aware) Structure 1..7 — how much of the sampled pattern survives
  patchColor: number; // Patch (Content-Aware) Color 0..10 — how far the sample's tone is pulled toward the surroundings
  camExtend: boolean; // Content-Aware Move Mode: Move (false) relocates, Extend (true) duplicates
  camStructure: number; // Content-Aware Move Structure 1..7 — how much of the dropped object's texture survives
  camColor: number; // Content-Aware Move Color 0..10 — how far its tone is pulled toward the new surroundings
  camTransformOnDrop: boolean; // Content-Aware Move: leave the drop in a live transform frame
  /** Live Transform On Drop frame; the drop previews in a history transaction until it closes. */
  camDrop: CamDropSession | null;
  quickSelectionSampleAll: boolean; // sample the merged image vs the active layer (PS default: false)
  /** Color Range ▸ Selection Preview: how an uncommitted selection is drawn over
   *  the document while the dialog is open. Display-only, never persisted. */
  selectionPreviewMode: SelectionPreviewMode;
  /** Bumped whenever the preview coverage changes, since the buffer itself is
   *  outside reactive state — this is what the canvas overlay watches. */
  selectionPreviewGen: number;
  /** Layer Style ▸ Contour Editor: the document's named custom curves (#419). */
  contours: CustomContour[];
  objectSelectionTolerance: number; // 0..1 — how far the background flood grows by colour
  objectSelectionLasso: boolean; // draw the hint as a freehand lasso instead of a box
  quickSelectionAutoEnhance: boolean; // run the Refine Edge matte on each dab so the stroke snaps to edges
  magneticLassoRadius: number; // px — Magnetic Lasso edge-search width
  magneticLassoThreshold: number; // 0..1 — minimum edge contrast to snap to
  // Magic Eraser: click erases the similar region to transparency (own options, like the wand).
  eraserMode: "brush" | "pencil" | "block"; // Eraser tool Mode (soft / hard round / hard square)
  magicEraserTolerance: number; // 0..1
  magicEraserContiguous: boolean;
  magicEraserSampleAll: boolean;
  magicEraserOpacity: number; // 0..1 (partial erase)
  gradientType: "linear" | "radial" | "angle" | "reflected" | "diamond";
  gradientReverse: boolean; // reverse the gradient colour ramp (end colour at the start)
  gradientDither: boolean; // add an ordered dither to the gradient to reduce banding
  gradientTransparency: boolean; // honour the stops' alpha (off = fill fully opaque)
  gradientMethod: "perceptual" | "linear" | "classic"; // stop blend space (Photoshop's Method)
  gradientMode: string; // Gradient blend Mode (kebab key; blendIndex → engine u8)
  gradientOpacity: number; // Gradient fill opacity 0..1
  gradientStops: GradientStop[]; // editable multi-stop ramp (pos 0..1, rgba 0..255)
  gradientForeign: GradientForeign; // shared-model geometry Vision can't edit (radial centre/focal, spread, axis angle), parked for the trip back
  gradientNoiseSeed: number; // Noise gradient: current LCG seed (bumped each Randomize)
  gradientNoiseRoughness: number; // Noise gradient: 0..1, raises the colour-band count
  cloneAligned: boolean; // Clone Stamp / Healing: lock the source offset across strokes
  patternAligned: boolean; // Pattern Stamp: tile to canvas (on) vs re-anchor per stroke (off)
  cloneSample: number; // Clone/Heal Sample source: 0 current layer, 1 current & below, 2 all layers
  cloneSources: CloneSlot[]; // Window ▸ Clone Source: five session-only slots, each bound to the document it was sampled in
  cloneSourceSlot: number; // the slot Alt-click samples into and clone/heal strokes read
  cloneOverlay: { show: boolean; opacity: number }; // Clone Source ▸ Show Overlay under the brush, opacity 0..100
  cloneSourceError: string; // why the last Clone Source field edit was refused ("" when none)
  vanishingPointPlanes: VanishingPlane[]; // Filter ▸ Vanishing Point: plane quads TL,TR,BR,BL in document px; torn-off planes follow their parent
  vanishingPointActivePlane: number; // index of the selected plane
  vanishingPointSource: { x: number; y: number } | null; // Alt-sampled source point on the active plane
  vanishingPointSession: boolean; // the Vanishing Point workspace is open (one history transaction)
  vanishingPointTool: "edit" | "marquee" | "stamp"; // the workspace's own tool
  vanishingPointMarquee: VanishingRect | null; // perspective marquee, in its plane's unit square
  vanishingPointFloat: VanishingRect | null; // floating image awaiting OK (its pixels stay private to the store)
  colorReplaceMode: number; // Color Replacement Mode: 0 Hue, 1 Saturation, 2 Color, 3 Luminosity
  redeyePupil: number; // Red Eye tool: Pupil Size (0..1) — area/sensitivity of the correction
  redeyeDarken: number; // Red Eye tool: Darken Amount (0..1) — how dark the corrected pupil
  showTransformControls: boolean; // Move tool: draw the active layer's transform box + handles
  statusInfo: StatusInfoMode; // status bar: which info the configurable readout shows
  fontPreviewSize: FontPreviewSize; // Type ▸ Font Preview Size (application preference)
  useShiftKeyForToolSwitch: boolean; // Preferences ▸ General (Photoshop default: true)
  springLoadedToolShortcuts: boolean; // Preferences ▸ Tools (Photoshop default: true)
  springLoadedToolDelayMs: number; // 200..2000, default 200 ms
  cursorPrefs: CursorPrefs; // Preferences ▸ Cursors
  workspacePrefs: WorkspacePrefs; // Preferences ▸ Workspace
  cameraRawPrefs: CameraRawPrefs; // Preferences ▸ Camera Raw
  cameraRawProfiles: CameraRawProfileEntry[]; // Camera Raw ▸ Profile's DNG camera profile library (#446)
  antiAlias: boolean; // Elliptical Marquee / lasso: smooth (anti-aliased) selection edge
  sampleSize: number; // Eyedropper sample window N (1 = Point Sample, 3, 5, 11…)
  sampleMode: number; // Eyedropper Sample source: 0 All Layers · 1 Current Layer · 2 Current & Below
  // view overlays (View menu)
  showExtras: boolean; // View ▸ Extras (⌘H): master toggle for all overlays
  showGrid: boolean;
  showPixelGrid: boolean;
  showLayerEdges: boolean;
  showSelectionEdges: boolean;
  showSmartGuides: boolean; // View ▸ Show ▸ Smart Guides (align-on-drag)
  showTargetPath: boolean;
  showBrushPreview: boolean;
  showGuides: boolean;
  showRulers: boolean;
  screenMode: ScreenMode; // View ▸ Screen Mode (standard / fullMenu / full); F cycles
  snapEnabled: boolean;
  snapGuides: boolean; // View ▸ Snap To: align to guides
  snapGrid: boolean; // View ▸ Snap To: align to grid lines (when the grid is shown)
  snapDocBounds: boolean; // View ▸ Snap To: align to the document edges
  guidesLocked: boolean;
  guides: Guide[]; // h = horizontal (y), v = vertical (x), doc px
  gridSpacing: number; // px between gridlines (Preferences ▸ Guides, Grid & Slices)
  gridColor: string; // gridline colour
  // View ▸ Proof Colors / Proof Setup: a display-only soft-proof transform.
  proofOn: boolean; // master toggle (View ▸ Proof Colors)
  proofMode: string; // the configured Proof Setup (see EngineClient.setProof)
  proofSimulatePaperColor: boolean; // Custom Proof: display paper white simulation
  proofSimulateBlackInk: boolean; // Custom Proof: display printable black simulation
  proofBpc: boolean; // Custom Proof: Black Point Compensation (baked into the CMYK proof LUT); PS default on
  proofPreserveNumbers: boolean; // Custom Proof: send document numbers to the proof device unconverted (custom RGB device profiles only)
  proofProfileName: string | null; // Custom Proof: user-loaded device ICC profile ("Device to Simulate"); bytes live on the store
  proofProfileIsRgb: boolean; // device colorspace of the loaded proof profile (sniffed from the ICC header)
  gamutWarningOn: boolean; // View ▸ Gamut Warning (display-only)
  onionSkin: boolean; // Animation panel: ghost the last captured frame over the canvas (display-only)
  generatorWatch: boolean; // File ▸ Generate ▸ Image Assets watch mode (Tauri: silent re-export on edit)
  // View ▸ Pixel Aspect Ratio: a display-only horizontal stretch (for video
  // formats with non-square pixels). The stored pixels are never resampled.
  pixelAspect: number; // horizontal display factor (1 = square)
  pixelAspectCorrection: boolean; // View ▸ Pixel Aspect Ratio Correction
  pixelAspectPresets: PixelAspectPreset[]; // application-level preset catalog
  // Image ▸ Analysis: the Ruler tool's measurement line + the Count tool markers.
  rulerLine: { x0: number; y0: number; x1: number; y1: number } | null;
  countPoints: { x: number; y: number }[];
  showCount: boolean; // View ▸ Show ▸ Count
  // Color Sampler tool: persistent sample points (#1..#10). Stored as positions
  // only — the Info panel reads each one's colour live via engine.pick_sample, so
  // the readouts track edits (Photoshop's colour-monitoring behaviour).
  colorSamplers: { x: number; y: number }[];
  showSamplers: boolean; // gates the on-canvas sampler markers
  // Note tool: annotation notes tied to a location on the image (not a layer).
  // Stored per open document and persisted in .mvision envelopes. activeNoteId 0 = none.
  notes: Note[];
  activeNoteId: number;
  noteAuthor: string; // author stamped on newly created notes (options bar)
  showNotes: boolean; // View ▸ Show ▸ Notes — gates the on-canvas note icons
  nextNoteId: number; // monotonic id source for notes
  // Image ▸ Analysis ▸ Set Measurement Scale + the recorded Measurement Log.
  measureScale: MeasureScale; // px pixels = units <unit>; document-owned metadata
  measureScalePresets: MeasureScalePreset[]; // application-level named scale catalog
  measurements: { n: number; lengthPx: number; lengthUnits: number; angle: number; count: number }[];
  dataPoints: { lengthPx: boolean; lengthUnits: boolean; angle: boolean; count: boolean }; // log columns
  // Slices: rectangular regions (Slice tool draws; Slice Select edits; Layer ▸ New
  // Layer Based Slice; View ▸ Show/Lock/Clear). selectedSlice is the index the
  // Slice Select tool is editing (-1 = none).
  slices: Slice[];
  showSlices: boolean;
  slicesLocked: boolean;
  selectedSlice: number;
  // Select ▸ Find Layers: a name filter for the Layers panel.
  layerFilter: string;
  layerFilterOpen: boolean;
  layerKindFilter: LayerKindFilter; // Layers panel: filter rows by layer kind (applies while the filter row is open)
  layerAttributeFilter: LayerAttributeFilter; // Layers panel: filter rows by visibility, lock, mask, clipping or effects
  layerModeFilter: LayerModeFilter; // Layers panel: filter rows by blend mode (#423)
  layerEffectFilter: LayerEffectFilter; // Layers panel: filter rows by one layer-style type (#423)
  layerColorLabels: Record<number, LayerLabel>; // Layers panel: the ACTIVE document's colour tags, keyed by layer id (#144)
  layerColorFilter: LayerLabel[]; // Layers panel: "Filter for layer color" — selected colours (empty = no colour filtering)
  // The Pen tool's in-progress path (doc-space, flat x,y pairs) — drives
  // Layer ▸ Vector Mask ▸ Current Path.
  penPath: number[];
  // The work path's bezier form when it has curves (AnchorPath, 6 floats per
  // anchor with relative handles — see paths.ts). Empty = corner path; penPath
  // then IS the geometry. When set, penPath is its sub-pixel flattening, so
  // every polyline consumer (overlay, Make Selection, Fill, Stroke) stays smooth.
  penAnchors: number[];
  // Anchor count of each closed loop when penAnchors holds several (Type ▸
  // Create Work Path's glyph outlines); empty = one loop. See anchorLoops.
  penContours: number[];
  // Photoshop's Pen/Shape mode: "pixels" fills the closed path on the active
  // layer, "shape" commits it as an editable kind-3 vector layer instead.
  penMode: "pixels" | "shape";
  savedPaths: SavedPath[]; // Paths panel: named paths saved from the work path
  layerComps: LayerComp[]; // Layer Comps panel: named snapshots of per-layer visibility/opacity/blend
  snapshots: SnapshotRow[]; // History panel: named full-document checkpoints (active doc; session-only)
  // File ▸ Open Recent: recently opened/saved native file paths (newest first).
  /** File ▸ Open Recent + the Home start screen's grid (#476). `thumb` (a
   *  composite data URL) and `openedAt` are absent on entries persisted before
   *  the grid existed; the card falls back to the file extension and no date. */
  recentFiles: { name: string; path: string; thumb?: string; openedAt?: number }[];
  // File ▸ Export ▸ Export Preferences: the format + JPEG quality used by the
  // format-agnostic "Export As…" command. Persisted to localStorage.
  exportPrefs: { format: "png" | "jpeg"; quality: number };
  // File ▸ Save for Web: format + browser-oriented export choices.
  webExportPrefs: WebExportPrefs;
  // Preferences ▸ File Handling/New Document defaults that affect opening and
  // starter document creation.
  filePrefs: FileHandlingPrefs;
  // Edit ▸ Color Settings: RGB profile-mismatch policies.
  colorPolicyPrefs: ColorPolicyPrefs;
  // Preferences ▸ File Handling: minutes between crash-recovery snapshots
  // (0 = off). Persisted to localStorage.
  autoRecoverMinutes: number;
  // Edit ▸ Keyboard Shortcuts: application-menu command id → custom chord.
  // Missing uses the Photoshop default; null explicitly removes the shortcut.
  keyboardShortcuts: ShortcutOverrides;
  toolbarConfiguration: ToolbarConfiguration;
  toolbarConfigurationError: string;
  /** Why the saved panel options (#480) could not be fully loaded; "" when they could. */
  panelOptionsError: string;
  // Image ▸ Variables: data-driven graphics — layer→variable bindings + data sets.
  variables: DataVariable[];
  dataSetBaseDir: string;
  dataSets: Record<string, string>[]; // each row maps a variable name → value
  activeDataSet: number;
  // readouts
  cursor: { x: number; y: number } | null;
  picked: { r: number; g: number; b: number; a: number } | null;
  selectionDragRect: SelRect | null; // ephemeral live Rectangular/Elliptical Marquee geometry
  // history list (labels, oldest first — the engine's full undo+redo timeline)
  history: string[];
  historyIndex: number; // applied-op count (0 = initial/Open state); the active row
  actionVersion: number; // bumps when the macro/action list or recording state changes
  // bumped to ask the viewport to re-fit
  fitNonce: number;
  // Zoom tool preset request applied by the viewport (Fill Screen / 100%); the
  // nonce re-triggers the canvas effect. Fit Screen reuses fitNonce.
  zoomCmd: { mode: "fill" | "actual"; nonce: number } | null;
  // Active on-canvas text edit session: the type layer being edited in place
  // (null = none). `fresh` = just created, so the editor selects its
  // placeholder. CanvasView renders the on-canvas editor from this.
  textEdit: { id: number; fresh: boolean } | null;
  // Live Select ▸ Transform Selection frame (null = none). CanvasView draws the
  // draggable box + handles from this; the mask only changes on commit.
  selectionTransform: SelectionTransformSession | null;
}

export { BLEND_ORDER, blendIndex };

export function hsvToRgba(c: HSV): [number, number, number, number] {
  const { r, g, b } = hsvToRgb(c);
  const a = Math.round((c.a ?? 1) * 255);
  return [r, g, b, a];
}

export type ColorRangeSample = readonly [number, number, number];
export interface ColorRangeOptions {
  fuzziness: number;
  samples: readonly ColorRangeSample[];
  subtractSamples?: readonly ColorRangeSample[];
  mode?: number; // 0 replace · 1 add · 2 subtract · 3 intersect
  invert?: boolean;
  allLayers?: boolean;
  /** Localized Color Clusters: where each sample was picked, paired with
   *  `samples`. Required for a non-zero `clusterRange`. */
  points?: readonly (readonly [number, number])[];
  /** Localized Color Clusters ▸ Range, in document pixels. 0 = off. */
  clusterRange?: number;
}

/** Compact dialog-preview version of the engine's graded RGB-distance mask.
 *  `pixels` is an RGBA8 thumbnail, so preview work stays bounded even for a
 *  large document. Final selection still runs through the Rust engine. */
/** Preview twin of the engine's `select_tonal_range`, so Color Range's document
 *  preview matches what OK will select. Same Rec.601 luma and same band shape;
 *  `kind` 0 shadows / 1 midtones / 2 highlights, `range` 0..1. Pure. */
export function tonalPreviewMask(
  pixels: Uint8Array | Uint8ClampedArray,
  kind: number,
  range: number,
  invert = false,
): Uint8Array {
  const width = Math.max(0.02, Math.min(1, range));
  const out = new Uint8Array(pixels.length / 4);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    const l = (0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]) / 255;
    const cov = kind === 0 ? 1 - l / width
      : kind === 2 ? 1 - (1 - l) / width
      : 1 - Math.abs(l - 0.5) / width;
    const v = Math.round(Math.max(0, Math.min(1, cov)) * 255);
    out[i] = invert ? 255 - v : v;
  }
  return out;
}

export function colorRangePreviewMask(
  pixels: ArrayLike<number>,
  samples: readonly ColorRangeSample[],
  subtractSamples: readonly ColorRangeSample[],
  fuzziness: number,
  invert = false,
): Uint8Array {
  const count = Math.floor(pixels.length / 4);
  const mask = new Uint8Array(count);
  const radius = Math.max(Math.max(0, Math.min(200, fuzziness)) / 200 * Math.sqrt(3), 1e-3);
  const normalized = (targets: readonly ColorRangeSample[]) => targets.map(([r, g, b]) => [
    Math.max(0, Math.min(255, r)) / 255,
    Math.max(0, Math.min(255, g)) / 255,
    Math.max(0, Math.min(255, b)) / 255,
  ] as const);
  const include = normalized(samples);
  const exclude = normalized(subtractSamples);
  const coverage = (i: number, [tr, tg, tb]: readonly [number, number, number]) => {
    const p = i * 4;
    const r = pixels[p] / 255;
    const g = pixels[p + 1] / 255;
    const b = pixels[p + 2] / 255;
    const dist = Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2);
    return Math.round(Math.max(0, Math.min(1, 1 - dist / radius)) * 255);
  };
  for (let i = 0; i < count; i++) {
    let value = 0;
    for (const target of include) value = Math.max(value, coverage(i, target));
    for (const target of exclude) value = Math.max(0, value - coverage(i, target));
    mask[i] = invert ? 255 - value : value;
  }
  return mask;
}

/** Focus Area's add/subtract brushes on top of the engine's auto result: the
 *  painted regions force coverage in (`add`) or out (`subtract`), which is how
 *  Photoshop's Focus Area brushes correct the inevitable auto misses. Both
 *  strokes are doc-sized (empty = unpainted); subtract wins where they overlap. */
export function applyFocusBrushes(coverage: Uint8Array, add: Uint8Array, subtract: Uint8Array): Uint8Array {
  const out = coverage.slice();
  for (let i = 0; i < out.length; i++) {
    if (add[i]) out[i] = 255;
    if (subtract[i]) out[i] = 0;
  }
  return out;
}

const cloneIccProfileBytes = (bytes?: Uint8Array | null): Uint8Array | null => bytes?.length ? bytes.slice() : null;
const EMPTY_ICC_PROFILE = new Uint8Array();
const sameBytes = (a?: Uint8Array | null, b?: Uint8Array | null): boolean => {
  if (!a?.length && !b?.length) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
const iccProfileKey = (bytes?: Uint8Array | null): string | null => {
  if (!bytes?.length) return null;
  let h = 2166136261;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${bytes.length}:${h.toString(16).padStart(8, "0")}`;
};

/** Filter ▸ Vanishing Point's starting plane, as a fraction of the canvas it is
 *  drawn on. The quad is document pixels, so a fixed one lands off-canvas on a
 *  small image and in the top-left corner of a large one — and it belongs to the
 *  document, never to the session (#503). */
export function defaultVanishingPointPlane(w: number, h: number): number[] {
  return [
    Math.round(w * 0.22), Math.round(h * 0.18),
    Math.round(w * 0.78), Math.round(h * 0.22),
    Math.round(w * 0.68), Math.round(h * 0.78),
    Math.round(w * 0.30), Math.round(h * 0.72),
  ];
}
export function defaultVanishingPointPlanes(w: number, h: number): VanishingPlane[] {
  return [{ quad: defaultVanishingPointPlane(w, h), parent: null, edge: 0, angle: 90 }];
}

const initial: AppSnapshot = {
  ready: false,
  pendingDialog: null,
  tool: "brush",
  spacePan: false,
  fg: { h: 0, s: 0, v: 0, a: 1 },
  bg: { h: 0, s: 0, v: 1, a: 1 },
  brush: { size: 24, hardness: 0.8, flow: 1, opacity: 1, spacing: 0.16, smoothing: 0, angle: 0, roundness: 1, sizePressure: true, flowPressure: true, blend: 0, dodgeRange: 1, dodgeExposure: 0.5, protectTones: true, spongeMode: 1, spongeRate: 0.5, spongeVibrance: true, blurRate: 0.5, sharpenRate: 0.5, sharpenProtect: false, bgEraserTolerance: 0.18, bgEraserProtectFg: true, mixerWet: 0.5, mixerLoad: 0.5, mixerMix: 0.5, smudgeFinger: false, sampleAllLayers: false, bgEraserSampling: 1, bgEraserLimits: 0, mixerAutoLoad: true, mixerAutoClean: false, airbrush: false, eraseToHistory: false, autoErase: false, healSource: "sampled", healDiffusion: 5, spotHealType: 0, spotHealSampleAll: false },
  liquify: defaultLiquify(),
  zoom: 1,
  panX: 0,
  panY: 0,
  rotationAngle: 0,
  viewport: { w: 0, h: 0 },
  paneViews: {},
  floatDocs: [],
  doc: { width: 0, height: 0, name: "Untitled" },
  documents: [],
  activeDocId: 0,
  layers: [],
  activeLayerId: 0,
  selectedLayerIds: [],
  selectionActive: false,
  selectionGen: 0,
  cameraRawSessionsRev: 0,
  maskEdit: false,
  maskView: "off",
  quickMask: false,
  quickMaskGen: 0,
  liquifyMaskGen: 0,
  liquifyBackdropGen: 0,
  liquifyMeshGen: 0,
  isolated: false,
  mode: 0,
  duotone: null,
  depth: 8,
  photoshopPreview: null,
  resolutionPpi: DEFAULT_DOCUMENT_RESOLUTION_PPI,
  colorProfile: 0,
  colorProfileAssigned: true,
  iccProfileBytes: null,
  iccProfileName: null,
  modeProfileName: null,
  canUndo: false,
  canRedo: false,
  canFade: false,
  canReselect: false,
  hasClipboard: false,
  hasHistorySource: false,
  hasSmartFilterMask: false,
  undoLabel: "",
  redoLabel: "",
  undoDepth: 0,
  historyStates: 50,
  historyOptions: DEFAULT_HISTORY_OPTIONS,
  panelOptions: DEFAULT_PANEL_OPTIONS,
  historyLog: DEFAULT_HISTORY_LOG,
  historyLogEntries: [],
  selMode: 0,
  selectionFeather: 0,
  histChannel: "luma",
  histAllChannels: false,
  histScope: "histogram",
  colorRampMode: "spectrum",
  shapeKind: "rect",
  // ponytail: Photoshop defaults the shape tools to Shape mode; "pixels" keeps
  // every existing raster shape e2e spec true — flip once they opt in explicitly.
  shapeMode: "pixels",
  customShapes: [...BUILTIN_CUSTOM_SHAPES], // stocked like Photoshop's picker; loadCustomShapes replaces it with the saved library
  activeCustomShape: 0,
  polygonSides: 5,
  polygonStar: false,
  polygonIndent: 0.5,
  lineWeight: 3,
  lineArrowStart: false,
  lineArrowEnd: false,
  lineArrowWidth: 15,
  lineArrowLength: 30,
  lineArrowConcavity: 0,
  roundRectRadius: 12,
  shapeStrokeWidth: 0,
  shapeStrokeAlign: 1,
  cropAspect: "free",
  cropOverlay: "thirds",
  cropOverlayOrientation: 0,
  cropContentAware: false,
  cropDeletePixels: true,
  marqueeStyle: "normal",
  marqueeFixedW: 1,
  marqueeFixedH: 1,
  frameMode: "rect",
  artboards: [],
  selectedArtboard: 0,
  artboardPreset: ARTBOARD_PRESETS[0].name,
  artboardOrientation: "landscape",
  swatches: [...DEFAULT_SWATCHES],
  timeline: { ...DEFAULT_TIMELINE },
  playhead: 0,
  brushPresets: [...DEFAULT_BRUSH_PRESETS],
  activeBrushPreset: -1,
  toolPresets: [...DEFAULT_TOOL_PRESETS],
  gradientPresets: [...GRADIENT_PRESETS],
  stylePresets: [...DEFAULT_STYLE_PRESETS],
  spotChannelNames: [],
  channelTarget: null,
  channelAlone: false,
  channelOptions: {},
  selectedAnchor: null,
  selectedHandle: null,
  selectedPaths: [],
  paintSymmetry: 0,
  paintSymmetrySegments: 6,
  paintSymmetryAxisX: 0,
  paintSymmetryAxisY: 0,
  paintSymmetryAngle: 0,
  paintSymmetryScale: 1,
  paintSymmetryVisible: true,
  paintSymmetryTransforming: false,
  patternPreview: false,
  brushTips: [],
  activeBrushTip: -1,
  patternPresets: [],
  activePattern: -1,
  fillTolerance: 0.18,
  fillContiguous: true,
  fillSampleAllLayers: false,
  fillSource: "foreground",
  fillMode: "normal",
  fillOpacity: 1,
  wandTolerance: 0.18,
  quickSelectionTolerance: 0.12,
  quickSelectionMode: 0,
  patchMode: 0,
  patchDestination: false,
  patchTransparent: false,
  patchStructure: 4,
  patchColor: 2,
  camExtend: false,
  camStructure: 4,
  camColor: 2,
  camTransformOnDrop: false,
  camDrop: null as CamDropSession | null,
  quickSelectionSampleAll: false,
  selectionPreviewMode: "none" as SelectionPreviewMode,
  selectionPreviewGen: 0,
  contours: [] as CustomContour[],
  objectSelectionTolerance: 0.2,
  objectSelectionLasso: false,
  quickSelectionAutoEnhance: false,
  magneticLassoRadius: 10,
  magneticLassoThreshold: 0.2,
  wandContiguous: true,
  wandSampleAllLayers: false,
  eraserMode: "brush",
  magicEraserTolerance: 0.18,
  magicEraserContiguous: true,
  magicEraserSampleAll: false,
  magicEraserOpacity: 1,
  gradientType: "linear",
  gradientReverse: false,
  gradientDither: false,
  gradientTransparency: true,
  gradientMethod: "classic", // exact gamma-space ramp; Perceptual/Linear are opt-in
  gradientMode: "normal",
  gradientOpacity: 1,

  gradientStops: [{ pos: 0, r: 0, g: 0, b: 0, a: 255 }, { pos: 1, r: 255, g: 255, b: 255, a: 255 }],
  gradientForeign: {},
  gradientNoiseSeed: 1,
  gradientNoiseRoughness: 0.5,
  cloneAligned: true,
  patternAligned: true,
  cloneSample: 2, // All Layers (Vision's prior clone behavior)
  cloneSources: defaultCloneSlots(),
  cloneSourceSlot: 0,
  cloneOverlay: { show: false, opacity: 100 },
  cloneSourceError: "",
  vanishingPointPlanes: defaultVanishingPointPlanes(384, 320),
  vanishingPointActivePlane: 0,
  vanishingPointSource: null,
  vanishingPointSession: false,
  vanishingPointTool: "edit",
  vanishingPointMarquee: null,
  vanishingPointFloat: null,
  colorReplaceMode: 2, // Color (hue+saturation, preserve luminance) — Photoshop default
  redeyePupil: 0.5, // Red Eye Pupil Size — Photoshop default 50%
  redeyeDarken: 0.5, // Red Eye Darken Amount — Photoshop default 50%
  showTransformControls: false,
  statusInfo: "sizes",
  fontPreviewSize: DEFAULT_FONT_PREVIEW_SIZE,
  useShiftKeyForToolSwitch: true,
  springLoadedToolShortcuts: true,
  springLoadedToolDelayMs: 200,
  cursorPrefs: DEFAULT_CURSOR_PREFS,
  workspacePrefs: DEFAULT_WORKSPACE_PREFS,
  cameraRawPrefs: DEFAULT_CAMERA_RAW_PREFS,
  cameraRawProfiles: [],
  antiAlias: true,
  sampleSize: 1,
  sampleMode: 0,
  showExtras: true,
  showGrid: false,
  showPixelGrid: true,
  showLayerEdges: false,
  showSelectionEdges: true,
  showSmartGuides: true,
  showTargetPath: true,
  showBrushPreview: true,
  showGuides: true,
  showRulers: false,
  screenMode: "standard",
  snapEnabled: true,
  snapGuides: true,
  snapGrid: true,
  snapDocBounds: true,
  guidesLocked: false,
  guides: [],
  gridSpacing: 32,
  gridColor: "#8080a0",
  proofOn: false,
  proofMode: "cmyk",
  proofSimulatePaperColor: false,
  proofSimulateBlackInk: false,
  proofBpc: true,
  proofPreserveNumbers: false,
  proofProfileName: null,
  proofProfileIsRgb: false,
  gamutWarningOn: false,
  onionSkin: false,
  generatorWatch: false,
  pixelAspect: 1,
  pixelAspectCorrection: true,
  pixelAspectPresets: DEFAULT_PIXEL_ASPECT_PRESETS.map((preset) => ({ ...preset })),
  rulerLine: null,
  countPoints: [],
  showCount: true,
  colorSamplers: [],
  showSamplers: true,
  notes: [],
  activeNoteId: 0,
  noteAuthor: "Monet",
  showNotes: true,
  nextNoteId: 1,
  measureScale: { ...DEFAULT_MEASURE_SCALE },
  measureScalePresets: [],
  measurements: [],
  dataPoints: { lengthPx: true, lengthUnits: true, angle: true, count: true },
  slices: [],
  showSlices: true,
  slicesLocked: false,
  selectedSlice: -1,
  layerFilter: "",
  layerFilterOpen: false,
  layerKindFilter: "all",
  layerAttributeFilter: "all",
  layerModeFilter: "all",
  layerEffectFilter: "all",
  layerColorLabels: {},
  layerColorFilter: [],
  penPath: [],
  penAnchors: [],
  penContours: [],
  penMode: "pixels",
  savedPaths: [],
  layerComps: [],
  snapshots: [],
  recentFiles: [],
  exportPrefs: { format: "png", quality: 90 },
  webExportPrefs: DEFAULT_WEB_EXPORT_PREFS,
  filePrefs: DEFAULT_FILE_HANDLING_PREFS,
  colorPolicyPrefs: DEFAULT_COLOR_POLICY_PREFS,
  autoRecoverMinutes: DEFAULT_AUTO_RECOVER_MINUTES,
  keyboardShortcuts: {},
  toolbarConfiguration: factoryToolbarConfiguration(),
  toolbarConfigurationError: "",
  panelOptionsError: "",
  dataSetBaseDir: "",
  variables: [],
  dataSets: [],
  activeDataSet: 0,
  cursor: null,
  picked: null,
  selectionDragRect: null,
  history: [],
  historyIndex: 0,
  actionVersion: 0,
  fitNonce: 0,
  zoomCmd: null,
  textEdit: null,
  selectionTransform: null,
};

// ── Monet Artisan (.artisan) documents ───────────────────────────────
// An Artisan file is JSON: a `{format,version,document}` wrapper (or a bare
// document object). The merged engine parses exactly the same JSON into a
// kind-3 vector layer, so Vision only has to validate it and measure the
// artboard — the ORIGINAL text goes to the engine, never a TS re-serialization.
export const ARTISAN_RE = /\.artisan$/i;
const ARTISAN_FORMAT = "monet-artisan";
// Artisan's own `makeDocument` default, used only when a document carries no
// usable artboard. `Engine::new` clamps the upper bound.
const ARTISAN_FALLBACK_SIZE = 1000;

export interface ArtisanScene {
  /** The document JSON verbatim, as the engine's `set_document` expects it. */
  json: string;
  width: number;
  height: number;
  /** The active artboard's origin in document world space. */
  x: number;
  y: number;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" ? v as Record<string, unknown> : null;
const artisanNumber = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const artisanDimension = (v: unknown): number => {
  const n = Math.round(artisanNumber(v));
  return n > 0 ? n : ARTISAN_FALLBACK_SIZE;
};

/** Validate a `.artisan` payload and measure its active artboard. Mirrors
 *  Artisan's own `deserializeDocument` discriminator, so a mis-named or foreign
 *  file throws HERE — opening the wrong format must fail loudly, not produce a
 *  blank "Untitled" document. */
export function parseArtisanScene(bytes: Uint8Array): ArtisanScene {
  const json = new TextDecoder().decode(bytes);
  let data: unknown = null;
  try { data = JSON.parse(json); } catch { /* reported as a format error below */ }
  const wrapper = asRecord(data);
  const doc = wrapper?.format === ARTISAN_FORMAT ? asRecord(wrapper.document)
    // Tolerate a bare document object too (same leniency as Artisan).
    : wrapper && Array.isArray(wrapper.layers) && Array.isArray(wrapper.artboards) ? wrapper
      : null;
  if (!doc) throw new Error("Not a valid Monet Artisan document");
  const boards = (Array.isArray(doc.artboards) ? doc.artboards : []).map(asRecord);
  const board = boards[artisanNumber(doc.activeArtboard)] ?? boards[0] ?? null;
  return {
    json,
    width: artisanDimension(board?.width),
    height: artisanDimension(board?.height),
    x: artisanNumber(board?.x),
    y: artisanNumber(board?.y),
  };
}

export interface SceneItem { type: string; id?: string; children?: SceneItem[] }
interface SceneLayer { items?: SceneItem[] }
interface Scene { layers?: SceneLayer[] }

const collectItemIds = (items: SceneItem[] | undefined, out: Set<string>) => {
  for (const it of items ?? []) {
    if (typeof it?.id === "string") out.add(it.id);
    collectItemIds(it?.children, out);
  }
};

/** The TOP-LEVEL item ids of a vector layer's scene — a shape layer's "path
 *  components" in Photoshop terms, and what a path boolean operates on. A group
 *  is one component (the engine's pathfinder walks its own children), so this
 *  deliberately does not descend. Returns [] for an empty/garbage scene.
 *  ponytail: every component; the Path Selection tool now publishes its picked
 *  ids as `selectedPaths` (#456) — pass those to boolean only the selection. */
export function sceneComponentIds(sceneJson: string): string[] {
  if (!sceneJson) return [];
  let scene: Scene;
  try {
    scene = JSON.parse(sceneJson) as Scene;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const layer of scene?.layers ?? []) {
    for (const it of layer?.items ?? []) if (typeof it?.id === "string") out.push(it.id);
  }
  return out;
}

/** Layer ▸ Combine Shapes modes → the vector pathfinder's op names. 0 unite ·
 *  1 subtract front · 2 unite at overlap (intersect) · 3 subtract at overlap. */
const BOOLEAN_OPS = ["unite", "minus-front", "intersect", "exclude"] as const;

/** Pen ▸ Shape: turn a work path (doc-space, flat x,y pairs) into ONE Artisan
 *  `path` item filled with `rgba` (r,g,b,a all 0..255 — the vector model wants
 *  0..255 channels but 0..1 alpha). Given an existing scene it appends into the
 *  last layer, so drawing on an imported Artisan layer EXTENDS that scene rather
 *  than orphaning it; otherwise it starts a fresh one-layer scene. The result is
 *  what `add_vector_layer` / `vector_set_scene` take.
 *  `anchors` (an AnchorPath, see paths.ts) keeps the Pen's bezier handles; the
 *  flat `path` alone falls back to corner anchors.
 *  ponytail: doc px used directly as scene world space — which is how the shipped `vector_hit_test` /
 *  `vector_nearest_anchor` already read them. A layer panned by `vector_set_view`
 *  (an off-origin Artisan artboard) needs an engine-side view getter before
 *  authoring OR picking can be view-aware; fix both there, not here. */
export function shapeSceneFromPath(
  path: number[],
  rgba: [number, number, number, number],
  sceneJson = "",
  anchors?: number[],
): string {
  return appendSceneItems([pathItem(path, rgba, anchors)], "mv-path", sceneJson);
}

/** The vector model wants 0..255 channels but 0..1 alpha. */
const solidPaint = (rgba: [number, number, number, number]) => ({
  type: "solid",
  color: { r: rgba[0], g: rgba[1], b: rgba[2], a: rgba[3] / 255 },
});

/** Closed `path` item filled solid: bezier anchors (AnchorPath, relative
 *  handles — the scene's own Anchor model) when given, else corner anchors from
 *  the flat [x,y,…] outline. */
function pathItem(path: number[], rgba: [number, number, number, number], anchorPath?: number[]): SceneItem {
  const anchors: { point: { x: number; y: number }; handleIn?: { x: number; y: number }; handleOut?: { x: number; y: number } }[] = [];
  if (anchorPath && anchorPath.length >= 3 * ANCHOR_STRIDE) {
    for (let i = 0; i + ANCHOR_STRIDE <= anchorPath.length; i += ANCHOR_STRIDE) {
      anchors.push({
        point: { x: anchorPath[i], y: anchorPath[i + 1] },
        handleIn: { x: anchorPath[i + 2], y: anchorPath[i + 3] },
        handleOut: { x: anchorPath[i + 4], y: anchorPath[i + 5] },
      });
    }
  } else {
    for (let i = 0; i + 1 < path.length; i += 2) anchors.push({ point: { x: path[i], y: path[i + 1] } });
  }
  return { type: "path", fill: solidPaint(rgba), geometry: { anchors, closed: true } } as SceneItem;
}

/** Append items into the scene's LAST layer (or a fresh one-layer scene), each
 *  under a fresh `${prefix}-N` id. Item ids key hit-testing and anchor edits, so
 *  a new item must not collide with anything the imported scene already defines
 *  (including nested groups). */
function appendSceneItems(items: SceneItem[], prefix: string, sceneJson: string): string {
  const scene: Scene = sceneJson ? JSON.parse(sceneJson) as Scene : {};
  if (!Array.isArray(scene.layers) || !scene.layers.length) scene.layers = [{ items: [] }];
  const target = scene.layers[scene.layers.length - 1];
  if (!Array.isArray(target.items)) target.items = [];
  const used = new Set<string>();
  for (const l of scene.layers) collectItemIds(l.items, used);
  let n = 0;
  for (const it of items) {
    do { n++; } while (used.has(`${prefix}-${n}`));
    target.items.push({ ...it, id: `${prefix}-${n}` });
  }
  return JSON.stringify(scene);
}

/** The state slice the Shape-tool item builders read (pass `store.state`). */
export type ShapeToolOptions = Pick<AppSnapshot,
  "shapeKind" | "roundRectRadius" | "polygonSides" | "polygonStar" | "polygonIndent"
  | "customShapes" | "activeCustomShape" | "shapeStrokeWidth" | "shapeStrokeAlign"
  | "lineWeight" | "lineArrowStart" | "lineArrowEnd" | "lineArrowWidth" | "lineArrowLength"
  | "lineArrowConcavity" | "fg" | "bg">;

const STROKE_ALIGN_NAME = ["inside", "center", "outside"] as const; // StrokeAlign 0/1/2

const translate = (x: number, y: number) => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });

/** The Rectangle/Ellipse "Stroke" option as a live vector stroke (bg colour),
 *  matching the raster ring `strokeRingRects` fills in Pixels mode. */
function shapeItemStroke(s: ShapeToolOptions) {
  if (s.shapeStrokeWidth <= 0) return undefined;
  return { paint: solidPaint(hsvToRgba(s.bg)), width: s.shapeStrokeWidth, align: STROKE_ALIGN_NAME[s.shapeStrokeAlign] };
}

/** Shape tool ▸ Path mode: the dragged shape's outline as a work path (flat
 *  doc-space x,y pairs) — also the geometry Shape mode uses for the kinds the
 *  vector model has no native item for (polygon/star, custom). */
export function shapeOutlineVerts(s: ShapeToolOptions, x0: number, y0: number, w: number, h: number): number[] {
  const kind = s.shapeKind;
  const custom = kind === "custom" ? s.customShapes[s.activeCustomShape] : undefined;
  if (custom) {
    const { xs, ys } = denormalizePath(custom.path, x0, y0, w, h);
    const out: number[] = [];
    for (let i = 0; i < xs.length; i++) out.push(xs[i], ys[i]);
    return out;
  }
  if (kind === "polygon") return polygonVertices(x0 + w / 2, y0 + h / 2, w / 2, h / 2, s.polygonSides, s.polygonStar, s.polygonIndent);
  if (kind === "roundrect") return roundedRectVertices(x0, y0, w, h, s.roundRectRadius);
  if (kind === "ellipse") {
    // ponytail: work-path ellipse = sampled 64-gon (the work path model is
    // corner-anchored); Shape mode gets a true `ellipse` item with bezier arcs.
    const out: number[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      out.push(x0 + w / 2 + (Math.cos(a) * w) / 2, y0 + h / 2 + (Math.sin(a) * h) / 2);
    }
    return out;
  }
  return [x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h];
}

/** Shape tool ▸ Shape mode: the LIVE Artisan scene item for a dragged bbox.
 *  Rect/rounded/ellipse become native items (position, size, corner radii, fill
 *  and stroke all stay re-editable); polygon/star and custom shapes become
 *  corner-anchor path items — exact parity with the Pixels rasterization, and
 *  editable with Direct Selection. */
export function shapeBBoxItem(s: ShapeToolOptions, x0: number, y0: number, w: number, h: number): SceneItem {
  const kind = s.shapeKind;
  const fg = hsvToRgba(s.fg);
  if (kind === "rect" || kind === "roundrect" || kind === "ellipse") {
    const r = kind === "roundrect" ? s.roundRectRadius : 0;
    return {
      type: kind === "ellipse" ? "ellipse" : "rect",
      transform: translate(x0, y0),
      width: w,
      height: h,
      rx: r,
      ry: r, // the engine clamps radii to w/2 × h/2
      fill: solidPaint(fg),
      // Stroke parity with Pixels mode: the option applies to rect/ellipse only.
      stroke: kind === "roundrect" ? undefined : shapeItemStroke(s),
    } as SceneItem;
  }
  return pathItem(shapeOutlineVerts(s, x0, y0, w, h), fg);
}

/** Line shape ▸ Shape mode: a live `line` item stroked lineWeight thick with the
 *  foreground colour, plus filled arrowhead path items when arrows are on. */
export function lineShapeItems(s: ShapeToolOptions, x0: number, y0: number, x1: number, y1: number): SceneItem[] {
  const fg = hsvToRgba(s.fg);
  const items: SceneItem[] = [
    { type: "line", x1: x0, y1: y0, x2: x1, y2: y1, stroke: { paint: solidPaint(fg), width: s.lineWeight } } as SceneItem,
  ];
  const arrow = (tipX: number, tipY: number, dx: number, dy: number) => {
    const poly = arrowheadPolygon(tipX, tipY, dx, dy, s.lineArrowWidth, s.lineArrowLength, s.lineArrowConcavity);
    if (poly.length >= 6) items.push(pathItem(poly, fg));
  };
  if (s.lineArrowEnd) arrow(x1, y1, x1 - x0, y1 - y0);
  if (s.lineArrowStart) arrow(x0, y0, x0 - x1, y0 - y1);
  return items;
}

// ── OS pasteboard (cross-app Copy / Paste) ───────────────────────────
// The engine clipboard is a Rust struct inside wasm — invisible to every other
// process, which is why Copy here never used to reach Artisan, Preview or
// Figma. Copy now also publishes the pixels on the SYSTEM pasteboard as
// `image/png` (macOS `public.png`), so paste works into non-Monet apps too, and
// Paste reads back png / svg / SVG-on-text-plain. Deliberately NO Monet-private
// mime: WebKit's ClipboardItem drops types it doesn't recognise, so a
// vnd.monet.graphics flavour would need a Rust NSPasteboard command to survive.
export const PASTEBOARD_PNG = "image/png";
export const PASTEBOARD_SVG = "image/svg+xml";
export const PASTEBOARD_TEXT = "text/plain";

export interface PasteboardImage {
  bytes: Uint8Array;
  mime: string;
}

/** Publish PNG bytes on the system pasteboard. Resolves false when the platform
 *  refuses (denied permission, headless test env) — a pasteboard that says no
 *  must never break the in-app Copy, which already succeeded. */
export async function writePasteboardPng(bytes: Uint8Array): Promise<boolean> {
  const board = globalThis.navigator?.clipboard;
  if (!bytes.length || !board?.write || typeof ClipboardItem === "undefined") return false;
  try {
    const blob = new Blob([bytes as BlobPart], { type: PASTEBOARD_PNG });
    await board.write([new ClipboardItem({ [PASTEBOARD_PNG]: blob })]);
    return true;
  } catch {
    return false; // no permission / no user gesture / no pasteboard
  }
}

/** Read the first image the system pasteboard offers. SVG wins over PNG when
 *  both are present (Artisan publishes both; the vector copy is the better
 *  source), and the caller rasterizes it. Null = nothing pasteable. */
export async function readPasteboardImage(): Promise<PasteboardImage | null> {
  const board = globalThis.navigator?.clipboard;
  if (!board?.read) return null;
  let items: Awaited<ReturnType<Clipboard["read"]>>;
  try {
    items = await board.read();
  } catch {
    return null;
  }
  for (const item of items) {
    const types = Array.from(item.types);
    try {
      // SVG markup rides on text/plain — that is the flavour Artisan,
      // Illustrator, Figma and Inkscape all publish and accept, and WebKit's
      // ClipboardItem refuses an image/svg+xml entry outright.
      if (types.includes(PASTEBOARD_TEXT)) {
        const text = (await (await item.getType(PASTEBOARD_TEXT)).text()).trim();
        if (text.startsWith("<svg") || text.startsWith("<?xml")) {
          return { bytes: new TextEncoder().encode(text), mime: PASTEBOARD_SVG };
        }
      }
      const mime = types.find((t) => t === PASTEBOARD_SVG) ?? types.find((t) => t.startsWith("image/"));
      if (!mime) continue;
      const blob = await item.getType(mime);
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime };
    } catch {
      // The flavour vanished between read() and getType() — try the next item.
    }
  }
  return null;
}

// The Camera Raw develop recipe's smart-filter id — the one filter whose params
// are a workspace, not a handful of fields.
export const CAMERA_RAW_FID = 17;
// Liquify's smart-filter id. Its params are a resampled displacement mesh
// (thousands of floats), re-edited in the Liquify workspace.
export const LIQUIFY_MESH_FID = 117;
// Smart filters whose params are a workspace, not editable panel fields — the
// Layers panel never copies these out of wasm (a per-repaint megabyte).
const WORKSPACE_FIDS = new Set([CAMERA_RAW_FID, LIQUIFY_MESH_FID]);
// One smart filter as the Layers panel sees it.
export type SmartFilterRow = {
  index: number;
  fid: number; // -1 when the wasm build predates smart_filter_id
  enabled: boolean;
  blend: number; // BlendMode index
  opacity: number; // 0..1
  params: number[];
};
// Per-filter engine surface, typed locally so a wasm build that predates the
// exports still typechecks (SamEngine pattern; the store feature-detects).
type SmartFilterRowEngine = {
  smart_filter_id?(id: number, index: number): number;
  smart_filter_enabled?(id: number, index: number): boolean;
  smart_filter_blend_mode?(id: number, index: number): number;
  smart_filter_opacity?(id: number, index: number): number;
  set_smart_filter_enabled?(id: number, index: number, enabled: boolean): void;
  set_smart_filter_blend?(id: number, index: number, mode: number, opacity: number): void;
  smart_remove_filter?(id: number, index: number): void;
  smart_move_filter?(id: number, from: number, to: number): void;
};

// Select and Mask workspace engine surface, typed locally so a wasm build that
// predates the exports still typechecks (SpinBlur pattern; the dialog
// feature-detects at runtime).
type SamEngine = {
  select_and_mask(radius: number, smart: boolean, smooth: number, feather: number, contrast: number, shift: number, stroke: Uint8Array): void;
  select_and_mask_preview(radius: number, smart: boolean, smooth: number, feather: number, contrast: number, shift: number, stroke: Uint8Array): Uint8Array;
};
type StoreHistoryTransactionEngine = Engine & {
  begin_history_transaction(): boolean;
  cancel_history_transaction(): boolean;
  commit_history_transaction(): boolean;
  history_transaction_active(): boolean;
};
// Focus Area dialog engine surface, typed locally for the same reason (a wasm
// build predating the preview/Auto exports still typechecks).
type FocusAreaEngine = {
  select_focus_area(threshold: number, noise: number, soften: number): void;
  focus_area_preview(threshold: number, noise: number, soften: number): Uint8Array;
  focus_area_auto_range(noise: number): number;
};
// Clamp workspace params into the engine's expected ranges, shared by
// preview + commit so the two always send identical arguments.
function samArgs(p: SamParams, stroke: Uint8Array): [number, boolean, number, number, number, number, Uint8Array] {
  return [
    Math.max(0, Math.round(p.radius)),
    !!p.smartRadius,
    Math.max(0, Math.round(p.smooth)),
    Math.max(0, p.feather),
    Math.min(1, Math.max(0, p.contrast)),
    Math.round(p.shift),
    stroke,
  ];
}

/** The engine's SelMode arithmetic (0 replace · 1 add · 2 subtract · 3 intersect)
 *  on two coverage masks. Mirrored in TS because the engine only ever combines
 *  *into* the selection, and Save Selection has to combine into a channel. */
export function combineMasks(base: Uint8Array, incoming: Uint8Array, mode: number): Uint8Array {
  const out = new Uint8Array(base.length);
  for (let i = 0; i < base.length; i++) {
    const b = base[i], c = incoming[i] ?? 0;
    out[i] = mode === 1 ? Math.max(b, c) : mode === 2 ? Math.max(0, b - c) : mode === 3 ? Math.min(b, c) : c;
  }
  return out;
}

// ── Select ▸ Transform Selection: live frame geometry ────────────────
// The frame is a PathTransform (scale / rotate / skew / move) taken about the
// selection bbox centre — the very affine Free Transform Path already uses, so
// the matrix math is shared with transformControls rather than re-derived.
// Every drag is computed from the transform AT GRAB TIME, so it is absolute and
// drift-free (same discipline as the area-type box and slice drags).

export interface SelectionBox { x: number; y: number; w: number; h: number }

/** Live Select ▸ Transform Selection session: the marquee's bounding box when
 *  the frame opened plus the affine being dragged out over it. The mask is only
 *  rewritten on commit — the pixels are never touched at all. */
export interface SelectionTransformSession {
  box: SelectionBox;
  t: PathTransform;
}

/** Content-Aware Move ▸ Transform On Drop: the frame over the dropped object
 *  (`box`), the drag that put it there, and the frame's own transform on top. */
export interface CamDropSession extends SelectionTransformSession {
  dx: number;
  dy: number;
}

const DEG = Math.PI / 180;
const boxCentre = (b: SelectionBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
/** Handle offsets from the box centre, in transformHandles order (TL, T, TR, R, BR, B, BL, L). */
const handleOffsets = (b: SelectionBox): HandlePt[] => {
  const c = boxCentre(b);
  return transformHandles(b.x, b.y, b.w, b.h).map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
};

/** The frame's corners in doc px (TL, TR, BR, BL) — the box run through its affine. */
export function selectionFrameQuad(box: SelectionBox, t: PathTransform): HandlePt[] {
  const c = boxCentre(box);
  const m = pathTransformMatrix(t, c.x, c.y);
  const f = transformPoints([box.x, box.y, box.x + box.w, box.y, box.x + box.w, box.y + box.h, box.x, box.y + box.h], m);
  return [0, 2, 4, 6].map((i) => ({ x: f[i], y: f[i + 1] }));
}

/** The frame's 8 drag handles in doc px, in transformHandles order. */
export function selectionFrameHandles(box: SelectionBox, t: PathTransform): HandlePt[] {
  const c = boxCentre(box);
  const m = pathTransformMatrix(t, c.x, c.y);
  const flat = transformPoints(transformHandles(box.x, box.y, box.w, box.h).flatMap((p) => [p.x, p.y]), m);
  return Array.from({ length: 8 }, (_, i) => ({ x: flat[i * 2], y: flat[i * 2 + 1] }));
}

// The handle OPPOSITE the dragged one is the anchor: it stays exactly put, so
// every drag is solved against it and the dragged handle lands under the
// pointer. Returns Rot⁻¹·(q − anchor) — the pointer in the frame's pre-rotation
// space, measured from that anchor. The dragged handle is 2·u away from it.
function fromAnchor(box: SelectionBox, t0: PathTransform, u: HandlePt, q: HandlePt): HandlePt {
  const c = boxCentre(box);
  const r = (t0.deg ?? 0) * DEG, cos = Math.cos(r), sin = Math.sin(r);
  const kh = Math.tan((t0.skewH ?? 0) * DEG), kv = Math.tan((t0.skewV ?? 0) * DEG);
  const lx = (t0.sx ?? 1) * (u.x + kh * u.y), ly = (t0.sy ?? 1) * (kv * u.x + u.y);
  const ax = c.x + (t0.tx ?? 0) - (cos * lx - sin * ly); // anchor = C + T − L₀·u
  const ay = c.y + (t0.ty ?? 0) - (sin * lx + cos * ly);
  const dx = q.x - ax, dy = q.y - ay;
  return { x: cos * dx + sin * dy, y: -sin * dx + cos * dy };
}

// Recompute tx/ty so the handle OPPOSITE the dragged one stays put — Photoshop's
// default anchor. The linear part is Rot·S·K, and the opposite handle sits at −u,
// so the whole change of L·u is absorbed into the translation column.
function anchorOpposite(t0: PathTransform, u: HandlePt, next: { sx: number; sy: number; kh: number; kv: number }): { tx: number; ty: number } {
  const r = (t0.deg ?? 0) * DEG, cos = Math.cos(r), sin = Math.sin(r);
  const kh0 = Math.tan((t0.skewH ?? 0) * DEG), kv0 = Math.tan((t0.skewV ?? 0) * DEG);
  const dx = next.sx * (u.x + next.kh * u.y) - (t0.sx ?? 1) * (u.x + kh0 * u.y);
  const dy = next.sy * (next.kv * u.x + u.y) - (t0.sy ?? 1) * (kv0 * u.x + u.y);
  return { tx: (t0.tx ?? 0) + cos * dx - sin * dy, ty: (t0.ty ?? 0) + sin * dx + cos * dy };
}

/** Drag handle `handle` (0..7) to `q` (doc px): the resize. Corners scale both
 *  axes — `proportional` (Shift) locks the aspect ratio; the edge midpoints
 *  scale their one axis. */
export function scaleSelectionFrame(box: SelectionBox, t0: PathTransform, handle: number, q: HandlePt, proportional = false): PathTransform {
  const u = handleOffsets(box)[handle];
  if (!u) return t0;
  const kh = Math.tan((t0.skewH ?? 0) * DEG), kv = Math.tan((t0.skewV ?? 0) * DEG);
  const g = fromAnchor(box, t0, u, q);
  const sx0 = t0.sx ?? 1, sy0 = t0.sy ?? 1;
  const vx = u.x + kh * u.y, vy = kv * u.x + u.y;
  const wantX = handle !== 1 && handle !== 5; // top/bottom midpoints are height-only
  const wantY = handle !== 3 && handle !== 7; // left/right midpoints are width-only
  let sx = wantX && Math.abs(vx) > 1e-6 ? g.x / (2 * vx) : sx0;
  let sy = wantY && Math.abs(vy) > 1e-6 ? g.y / (2 * vy) : sy0;
  if (proportional && wantX && wantY) {
    // Follow whichever axis the pointer pulled hardest, mirroring Photoshop.
    const fx = sx / (sx0 || 1), fy = sy / (sy0 || 1);
    const f = Math.abs(fx) > Math.abs(fy) ? fx : fy;
    sx = sx0 * f;
    sy = sy0 * f;
  }
  return { ...t0, sx, sy, ...anchorOpposite(t0, u, { sx, sy, kh, kv }) };
}

/** ⌘/Ctrl-drag an edge midpoint: shear along that edge. Corners are a no-op —
 *  ponytail: corner-distort is a 4-point homography, not an affine, so it needs
 *  a different mask warp than the shared pathTransformMatrix path. */
export function skewSelectionFrame(box: SelectionBox, t0: PathTransform, handle: number, q: HandlePt): PathTransform {
  const u = handleOffsets(box)[handle];
  if (!u || handle % 2 === 0) return t0;
  const g = fromAnchor(box, t0, u, q);
  const sx = t0.sx ?? 1, sy = t0.sy ?? 1;
  let kh = Math.tan((t0.skewH ?? 0) * DEG), kv = Math.tan((t0.skewV ?? 0) * DEG);
  if (handle === 1 || handle === 5) kh = g.x / (2 * sx * u.y);
  else kv = g.y / (2 * sy * u.x);
  if (!Number.isFinite(kh) || !Number.isFinite(kv)) return t0;
  const next = { sx, sy, kh, kv };
  return { ...t0, skewH: Math.atan(kh) / DEG, skewV: Math.atan(kv) / DEG, ...anchorOpposite(t0, u, next) };
}

/** Drag outside a corner to rotate about the frame's centre. `snap` (Shift)
 *  quantises to 15°, as Photoshop does. */
export function rotateSelectionFrame(box: SelectionBox, t0: PathTransform, from: HandlePt, to: HandlePt, snap = false): PathTransform {
  const c = boxCentre(box);
  const px = c.x + (t0.tx ?? 0), py = c.y + (t0.ty ?? 0); // the frame centre is the pivot
  const a0 = Math.atan2(from.y - py, from.x - px);
  const a1 = Math.atan2(to.y - py, to.x - px);
  let deg = (t0.deg ?? 0) + (a1 - a0) / DEG;
  if (snap) deg = Math.round(deg / 15) * 15;
  return { ...t0, deg };
}

/** Invert a 2×3 affine [a,b,c,d,e,f]; null when it is singular — a frame
 *  collapsed to zero area. */
export function invertAffine(m: Affine): Affine | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** Warp a doc-sized selection coverage mask through `m`, inverse-mapped and
 *  bilinear so a rotated marquee keeps a clean antialiased edge (identity and
 *  whole-pixel moves still land on exact samples). Sources outside the doc read
 *  0 = deselected. Returns a new mask; `mask` is untouched. */
export function warpSelectionMask(mask: Uint8Array, w: number, h: number, m: Affine): Uint8Array {
  const out = new Uint8Array(w * h);
  const inv = invertAffine(m);
  if (!inv || mask.length !== w * h) return out; // collapsed frame → empty selection
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      const fx = inv[0] * px + inv[2] * py + inv[4] - 0.5;
      const fy = inv[1] * px + inv[3] * py + inv[5] - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      out[y * w + x] = Math.round(
        at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty)
        + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty,
      );
    }
  }
  return out;
}

export class Store {
  /** Mounted workspace operations shared by native UI and MCP commands. */
  getWorkspace: () => DockableWorkspaceHandle | null = () => null;
  private snap: AppSnapshot = initial;
  private listeners = new Set<() => void>();
  engine: EngineClient;
  onDocumentEvent: ((event: ScriptEventId) => void) | null = null;
  onVectorFontTargetsChanged: (() => void) | null = null;

  // ── open documents ───────────────────────────────────────────
  // Each entry owns its own wasm Engine; the active one is mirrored into
  // `engine.engine`. View state (zoom/pan/history/blend) travels per entry.
  private docs: DocEntry[] = [];
  private activeDocId = 0;
  private nextDocId = 1;
  // Camera Raw opens are transactions, not documents. Decoded engines stay in
  // this queue until the user chooses Open/Open Object; Cancel and Done can
  // therefore leave the document list byte-for-byte untouched. Only one request
  // is presented at a time, which also makes native/browser multi-RAW open safe.
  private cameraRawSessions = new Map<string, RuntimeCameraRawSession>();
  private cameraRawQueue: string[] = [];
  private activeCameraRawSessionId: string | null = null;
  private nextCameraRawSessionId = 1;
  private nextDialogSerial = 1;
  // Type Mask: the id of the type layer being edited as a mask. When its edit
  // ends, it is converted into a selection (and the layer removed).
  private maskTypeId: number | null = null;
  // Liquify is an engine-owned transaction. Pin its identity so a tab/layer
  // switch or same-id document replacement can only cancel the original engine,
  // never continue the session against whatever is active now.
  private liquifySession: LiquifySession | null = null;
  // Filter ▸ Vanishing Point workspace: what Cancel restores, the undo mark OK
  // collapses to, and the floating image's pixels (never in the snapshot).
  private vpSession: {
    docId: number; engine: Engine; pushes: number;
    planes: VanishingPlane[]; active: number; source: { x: number; y: number } | null;
    float: { rgba: ArrayLike<number>; w: number; h: number; srcQuad: number[] } | null;
  } | null = null;
  private liquifySavedMesh: LiquifyMeshData | null = null;
  private liquifyBackdrops: Partial<Record<LiquifyBackdropSource, { docId: number; w: number; h: number; pixels: Uint8ClampedArray }>> = {};
  private temporaryErase = false;
  private strokeTool: ToolId | null = null;
  /** Set per stroke by beginBrushStroke: the Pencil's Auto Erase swapped in the background colour. */
  private strokePaintsBackground = false;
  private quickStrokeMode = 0; // the Quick Selection mode the current stroke started in
  private paintSymmetryTransformStart: {
    docId: number;
    x: number;
    y: number;
    angle: number;
    scale: number;
  } | null = null;
  private clipboardProfileMetaByDoc = new Map<number, ClipboardProfileMeta>();
  // History Snapshots per document (session-only; each holds full project bytes).
  // ponytail: snapshots keep full save_project() bytes in memory — fine for a
  // session (Photoshop does the same); not persisted to .mvision.
  private snapshotsByDoc = new Map<number, DocSnapshot[]>();
  private nextSnapshotId = 1;
  // Camera Raw ▸ Profile library bytes by digest (user .dcp files + the
  // desktop's Adobe profiles); state.cameraRawProfiles lists them.
  private cameraRawProfileBytes = new Map<string, Uint8Array>();
  private cameraRawProfileStorage: CameraRawProfileStorage | null = null;
  /** Settles once the stored library is listed (attachCameraRawProfileStorage). */
  cameraRawProfilesReady: Promise<void> = Promise.resolve();
  // Missing profiles already reported this session (warnMissingDevelopProfiles).
  private reportedMissingProfiles = new Set<string>();

  constructor(engine: EngineClient) {
    this.engine = engine;
    // Any content-changing commit flags the active document dirty (→ tab `*`).
    this.engine.onCommit = () => this.markDirty();
    this.loadStorePreferences();
    this.loadPatternPresets(); // the Patterns library, so a picker has it before first paint
    // Camera Raw profiles (#446): a develop naming a profile the engine does
    // not hold (evicted, or reopened from a project) asks for its bytes here,
    // synchronously, instead of rendering Camera Default.
    (globalThis as { __monetDevelopProfileBytes?: (digest: string) => Uint8Array | undefined })
      .__monetDevelopProfileBytes = (digest) => this.developProfileBytes(digest) ?? undefined;
    this.engine.onDevelopProfileMissing = (digests) => this.warnMissingDevelopProfiles(digests);
  }

  /** Restore the preferences the store owns outright: Preferences ▸ Performance
   *  History States and Preferences ▸ Guides, Grid & Slices. Read in the
   *  constructor rather than from app.ts's boot block because the first document
   *  is built before that runs, and it pushes `historyStates` into the engine.
   *  Values come from user-editable storage, so both are re-validated here. */
  private loadStorePreferences() {
    try {
      const saved = localStorage.getItem("mv.toolbarConfiguration");
      if (saved) this.set({ toolbarConfiguration: validateToolbarConfiguration(JSON.parse(saved)) });
    } catch {
      if (typeof localStorage !== "undefined") this.set({ toolbarConfigurationError: "Saved toolbar configuration could not be loaded. Open Edit ▸ Toolbar and Restore Defaults, then save your toolbar again." });
    }
    try {
      const hist = Number(localStorage.getItem("mv.historyStates"));
      if (Number.isFinite(hist) && hist >= 1) this.set({ historyStates: Math.min(1000, Math.round(hist)) });
      // Own try: corrupt History Options must not block the grid prefs below.
      try { this.set({ historyOptions: normalizeHistoryOptions(JSON.parse(localStorage.getItem("mv.historyOptions") ?? "null")) }); }
      catch { /* malformed JSON → keep the Photoshop defaults */ }
      // Reported like the toolbar: values the panel menus never offer are dropped,
      // the valid fields kept, and the stored preference left untouched.
      try {
        const saved: unknown = JSON.parse(localStorage.getItem("mv.panelOptions") ?? "null");
        const panelOptions = normalizePanelOptions(saved);
        this.set({ panelOptions });
        if (saved !== null && (typeof saved !== "object" || Array.isArray(saved)
          || Object.entries(saved).some(([key, value]) => key in panelOptions && panelOptions[key as keyof PanelOptions] !== value))) throw new Error("invalid panel options");
      } catch {
        this.set({ panelOptionsError: "Saved panel options could not be loaded. Choose Panel Options from this panel's ☰ menu to save them again." });
      }
      // Own try for the same reason: a corrupt History Log pref is not fatal.
      try { this.set({ historyLog: normalizeHistoryLog(JSON.parse(localStorage.getItem("mv.historyLog") ?? "null")) }); }
      catch { /* malformed JSON → logging stays off */ }
      const raw: unknown = JSON.parse(localStorage.getItem("mv.gridPrefs") ?? "null");
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      const { spacing, color } = raw as { spacing?: unknown; color?: unknown };
      const grid: Partial<AppSnapshot> = {};
      if (typeof spacing === "number" && Number.isFinite(spacing)) grid.gridSpacing = Math.min(512, Math.max(2, Math.round(spacing)));
      if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) grid.gridColor = color;
      this.set(grid);
    } catch { /* storage may be unavailable */ }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<AppSnapshot>) {
    // Component ids belong to one layer in one document. A retained selection
    // must never target same-named items after a layer/document switch.
    if ((patch.activeDocId !== undefined && patch.activeDocId !== this.snap.activeDocId)
      || (patch.activeLayerId !== undefined && patch.activeLayerId !== this.snap.activeLayerId)) {
      patch = { ...patch, selectedPaths: [] };
      this.pathDragLast = null;
    }
    // A float window is a view of its document (#477): whichever path takes a
    // document away — closing it, or a new one replacing the untouched blank —
    // publishes the new list here, and its window goes with it.
    const floats = patch.floatDocs ?? this.snap.floatDocs;
    if (patch.documents && floats.some((id) => !patch.documents!.some((d) => d.id === id))) {
      patch = { ...patch, floatDocs: floats.filter((id) => patch.documents!.some((d) => d.id === id)) };
    }
    this.snap = { ...this.snap, ...patch };
    for (const listener of this.listeners) {
      try { listener(); }
      catch (error) { console.error("Store listener failed:", error); }
    }
  }

  /** Persist an app-global authored library and report a rejected write through
   *  the same visible error path used for refused engine edits. */
  persistAuthoredContent(key: string, value: string, label: string): boolean {
    if (persistLocalStorage(key, value)) return true;
    this.engine.onEditError?.(`Could not save ${label} — browser storage is full or unavailable. Free storage and try again.`);
    return false;
  }
  /** Force a re-render (used by the action recorder for its indicator). */
  bump() {
    this.set({ actionVersion: this.snap.actionVersion + 1 });
  }
  get state() {
    return this.snap;
  }

  /** Push the document metadata the engine does not own but has to write into a
   *  Photoshop export: print resolution (ResolutionInfo 1005) and ruler guides
   *  (1032). Without the first, Photoshop reopens a 300 ppi document at 72.
   *  The store stays the authority — the engine is only the courier — so every
   *  activate/commit resync refreshes its copy. */
  private pushDocumentMetadata() {
    const e = this.engine.engine;
    if (!e) return;
    e.set_resolution_ppi(this.snap.resolutionPpi);
    const guides = new Float32Array(this.snap.guides.length * 2);
    this.snap.guides.forEach((guide, i) => {
      guides[i * 2] = guide.o === "h" ? 1 : 0; // 0 vertical (x), 1 horizontal (y)
      guides[i * 2 + 1] = guide.p;
    });
    e.set_guides(guides);
  }

  /** The Layers panel's second thumbnail: the mask as grayscale, as a data URL.
   *  ponytail: a second data-URL builder next to EngineClient.layerThumbUrl —
   *  fold the two together once the mask thumb needs its own sizing knobs. */
  private maskThumbUrl(id: number, w = 44, h = 44): string {
    const e = this.engine.engine;
    if (!e) return "";
    const px = e.layer_mask_thumb(id, w, h);
    if (!px.length) return "";
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d");
    if (!cx) return "";
    const img = cx.createImageData(w, h);
    img.data.set(px);
    cx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  // ── engine → store sync ──────────────────────────────────────
  syncFromEngine() {
    const e = this.engine.engine;
    if (!e) return;
    this.pushDocumentMetadata();
    const keepPaintSymmetryDraft = this.snap.paintSymmetryTransforming
      && this.paintSymmetryTransformStart?.docId === this.activeDocId;
    const count = e.layer_count();
    const layers: LayerInfo[] = [];
    // While a live type session is open the glyphs churn per keystroke; the
    // thumbnails only change for the edited layer, so carry the previous ones
    // instead of regenerating every data URL per keystroke. endTextEdit
    // refreshes them once typing stops.
    const carryThumbs = this.snap.textEdit ? new Map(this.snap.layers.map((l) => [l.id, l])) : null;
    for (let i = 0; i < count; i++) {
      const id = e.layer_id_at(i);
      const kind = e.layer_kind(id);
      const smartLink = kind === LAYER_KIND.smartObject ? getSmartLink(this.activeDocId, id) : null;
      const hasMask = e.layer_has_mask(id);
      const hasFx = e.layer_has_effects(id);
      // Effect types with at least one enabled instance (params[0] is the
      // enabled flag), so the Layers filter bar can narrow by effect (#423).
      // Only layers that carry an effect at all pay the per-type scan.
      let fxMask = 0;
      if (hasFx) for (const { id: fx } of FX_DEFS) {
        const n = e.layer_effect_count(id, fx);
        for (let k = 0; k < n; k++) {
          if (e.layer_effect_params_at(id, fx, k)[0] >= 0.5) { fxMask |= 1 << fx; break; }
        }
      }
      const carried = carryThumbs?.get(id);
      layers.push({
        id,
        name: e.layer_name(id),
        visible: e.layer_visible(id),
        locked: e.layer_locked(id),
        opacity: Math.round(e.layer_opacity(id) * 100),
        fillOpacity: Math.round(e.layer_fill_opacity(id) * 100),
        blendMode: BLEND_ORDER[e.layer_blend(id)] || "normal",
        thumb: carried ? carried.thumb : this.engine.layerThumbUrl(id),
        hasMask,
        maskThumb: carried ? carried.maskThumb : (hasMask ? this.maskThumbUrl(id) : ""),
        maskEnabled: e.layer_mask_enabled(id),
        hasFx,
        fxMask,
        clipped: this.layerClipping(id),
        kind,
        group: e.layer_group(id),
        smartLink: smartLink ? { name: smartLink.name, path: smartLink.path, missing: smartLink.missing } : undefined,
        // Non-zero when this smart object shares its source with another layer,
        // so the panel can mark instances (#417).
        locks: typeof (e as { layer_locks?: unknown }).layer_locks === "function"
          ? (e as unknown as { layer_locks: (id: number) => number }).layer_locks(id)
          : 0,
        smartSourceId: kind === LAYER_KIND.smartObject && typeof (e as { smart_source_id?: unknown }).smart_source_id === "function"
          ? (e as unknown as { smart_source_id: (id: number) => number }).smart_source_id(id)
          : 0,
      });
    }
    // A File ▸ Revert swaps in a fresh engine, which has an empty undo stack.
    // The pre-revert project stays in `revertUndo` so Edit ▸ Undo can put it
    // back. While that is the only thing to undo, the History panel shows it.
    const revertPending = this.revertUndo.has(this.activeDocId) && !e.can_undo();
    const undoLabel = revertPending ? "Revert" : e.undo_label();
    const undoDepth = e.undo_depth();
    // The History panel reflects the engine's true undo+redo timeline (oldest→newest)
    // and the current applied-op position, so it stays accurate across undo/redo/seek.
    const history = revertPending ? ["Revert"] : Array.from(e.history_labels()) as string[];
    const historyIndex = revertPending ? 1 : e.history_current();
    // Drop a dangling text-edit session if its target is no longer a live type
    // layer — deleted, or reverted/rasterized to a non-type layer by undo/redo
    // (a blank overlay would otherwise linger). Doc swaps clear it eagerly too.
    // Close the engine-side session too, so the dangling session can't coalesce
    // a later, unrelated type edit into the previous undo step.
    const te = this.snap.textEdit;
    const teLayer = te ? layers.find((l) => l.id === te.id) : undefined;
    const textEdit = te && teLayer && teLayer.kind === LAYER_KIND.text ? te : null;
    if (te && !textEdit) e.text_edit_session(false);
    // A pending Type-Mask conversion is dead once its layer is gone (deleted /
    // reverted): clear it so a later edit of a same-id layer can't be wrongly
    // converted + destroyed (maskTypeId is a cross-doc singleton).
    if (this.maskTypeId != null && !layers.some((l) => l.id === this.maskTypeId)) this.maskTypeId = null;
    // Artboard tool: rebuild the artboard list (id + bounds + name) from the
    // engine, and drop the selection if its artboard is gone (deleted/undone).
    const abIds = Array.from(e.artboard_ids()) as number[];
    const artboards: ArtboardInfo[] = abIds.map((id) => {
      const b = Array.from(e.frame_bounds(id)) as number[];
      return { id, name: e.layer_name(id), x: b[0] ?? 0, y: b[1] ?? 0, w: b[2] ?? 0, h: b[3] ?? 0 };
    });
    const selectedArtboard = abIds.includes(this.snap.selectedArtboard) ? this.snap.selectedArtboard : 0;
    const photoshop = e as Engine & {
      imported_photoshop_read_only?: () => boolean;
      imported_photoshop_source_mode?: () => number;
      imported_photoshop_source_depth?: () => number;
      imported_photoshop_source_is_psb?: () => boolean;
    };
    const photoshopPreview: PhotoshopPreview | null = photoshop.imported_photoshop_read_only?.()
      ? {
        mode: photoshop.imported_photoshop_source_mode?.() ?? 3,
        depth: photoshop.imported_photoshop_source_depth?.() ?? e.doc_depth(),
        isPsb: photoshop.imported_photoshop_source_is_psb?.() ?? false,
      }
      : null;
    const activeLayerId = e.active_layer_id();
    this.set({
      ready: true,
      layers,
      artboards,
      selectedArtboard,
      textEdit,
      documents: this.docSummaries(),
      activeDocId: this.activeDocId,
      activeLayerId,
      selectedPaths: this.snap.selectedPaths.filter((item) => e.vector_item_bounds(activeLayerId, item).length === 4),
      selectedLayerIds: (() => {
        const active = activeLayerId;
        const live = new Set(layers.map((l) => l.id));
        const kept = this.snap.selectedLayerIds.filter((id) => live.has(id));
        return kept.includes(active) ? kept : [active, ...kept];
      })(),
      selectionActive: e.has_selection(),
      // A mask preview dies with its mask (delete / apply / undo / layer swap):
      // a grayscale canvas with no mask behind it would be a dead end.
      maskView: layers.find((l) => l.id === activeLayerId)?.hasMask ? this.snap.maskView : "off",
      // A live Transform Selection frame is dead once the marquee is gone
      // (deselect / undo / doc swap) — a floating box over nothing.
      selectionTransform: e.has_selection() ? this.snap.selectionTransform : null,
      selectionGen: e.selection_generation(),
      quickMask: e.quick_mask_on(),
      quickMaskGen: e.quick_mask_generation(),
      // A targeted channel lives in the Quick Mask buffer: once that is gone
      // (undo of the round-trip, Q, doc swap) there is nothing left to write back.
      channelTarget: e.quick_mask_on() ? this.snap.channelTarget : null,
      liquifyMaskGen: e.liquify_freeze_mask_generation(),
      liquifyMeshGen: this.snap.liquifyMeshGen,
      mode: e.doc_mode(),
      depth: e.doc_depth(),
      photoshopPreview,
      colorProfile: clampProfile(e.doc_profile()),
      modeProfileName: e.mode_profile_name?.() || null,
      doc: { ...this.snap.doc, width: e.width(), height: e.height() },
      history,
      historyIndex,
      // Preferences ▸ History Log: the timeline read-back is the one place every
      // edit funnels through, so the audit trail is recorded here, not per-caller.
      historyLogEntries: appendHistoryLog(
        this.snap.historyLogEntries,
        historyLogDelta(this.snap.historyLog, this.snap.history, history, historyIndex, this.snap.doc.name, new Date()),
      ),
      canUndo: e.can_undo() || this.revertUndo.has(this.activeDocId),
      canRedo: e.can_redo(),
      canFade: e.can_fade(),
      canReselect: e.can_reselect(),
      // A published PNG remains pasteable after switching documents even though
      // each document owns a separate engine clipboard.
      hasClipboard: e.has_clipboard() || !!this.publishedPng?.length || this.windowClip !== null,
      hasHistorySource: e.has_history_source(),
      hasSmartFilterMask: e.has_smart_filter_mask(activeLayerId),
      undoLabel,
      redoLabel: e.redo_label(),
      undoDepth,
      isolated: e.is_soloed(),
      spotChannelNames: this.readSpotNames(),
      paintSymmetry: e.paint_symmetry_mode(),
      paintSymmetrySegments: e.paint_symmetry_segment_count(),
      paintSymmetryAxisX: keepPaintSymmetryDraft ? this.snap.paintSymmetryAxisX : e.paint_symmetry_axis_x(),
      paintSymmetryAxisY: keepPaintSymmetryDraft ? this.snap.paintSymmetryAxisY : e.paint_symmetry_axis_y(),
      paintSymmetryAngle: keepPaintSymmetryDraft ? this.snap.paintSymmetryAngle : e.paint_symmetry_angle(),
      paintSymmetryScale: keepPaintSymmetryDraft ? this.snap.paintSymmetryScale : e.paint_symmetry_scale(),
    });
    this.syncDisplayProfile();
  }
  /** Keep the canvas display-compensation LUT in step with the active
   *  document's assigned profile (see EngineClient.setDisplayProfile). */
  private syncDisplayProfile() {
    this.engine.setDisplayProfile(
      this.snap.colorProfile,
      this.snap.colorProfileAssigned,
      this.snap.iccProfileBytes,
      this.snap.iccProfileName,
    );
    this.refreshIccProof();
  }
  // ── ICC soft proof (View ▸ Proof Setup ▸ Working CMYK) ────────
  // The bundled FOGRA39 press profile upgrades the profile-free proof/gamut
  // heuristics to a real ICC round-trip. Fetched once; the bake is cached by
  // key so per-commit syncs stay free; the heuristic remains the degraded
  // path when the asset is unavailable.
  private iccProofProfile: Uint8Array | null = null;
  private iccProofFetch: Promise<Uint8Array | null> | null = null;
  private iccProofKey = "";
  // Proof Setup ▸ Custom: a user-loaded device profile (name/colorspace mirror
  // into state; the raw bytes stay here, like the bundled press profile above).
  private proofProfileBytes: Uint8Array | null = null;
  /** The working CMYK press profile's ICC bytes — the same bundled profile the
   *  soft proof uses, so a CMYK export separates through what the user is
   *  previewing. null when it can't be fetched; callers fall back to the
   *  engine's built-in UCR separation. */
  workingCmykProfile(): Promise<Uint8Array | null> {
    return this.fetchProofProfile();
  }
  private fetchProofProfile(): Promise<Uint8Array | null> {
    if (this.iccProofProfile) return Promise.resolve(this.iccProofProfile);
    this.iccProofFetch ??= fetch("/profiles/ISOcoated_v2_300_eci.icc")
      .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null))
      .then((bytes) => { this.iccProofProfile = bytes; return bytes; })
      .catch(() => null);
    return this.iccProofFetch;
  }
  refreshIccProof() {
    // "custom" proofs against the user-loaded device profile; "cmyk" against
    // the bundled press profile. Every other mode keeps the display heuristics.
    const custom = this.snap.proofMode === "custom" ? this.proofProfileBytes : null;
    const want = (this.snap.proofMode === "cmyk" || !!custom) && (this.snap.proofOn || this.snap.gamutWarningOn);
    // Preserve Numbers only means anything for an RGB device profile (the doc
    // is RGB); the dialog gates the checkbox the same way.
    const preserve = !!custom && this.snap.proofProfileIsRgb && this.snap.proofPreserveNumbers;
    const key = want
      ? `${this.snap.proofMode}:${this.snap.proofProfileName ?? ""}:${custom?.length ?? 0}:${preserve}:${this.snap.colorProfile}:${this.snap.iccProfileName ?? ""}:${this.snap.iccProfileBytes?.length ?? 0}:${this.snap.colorPolicyPrefs.intent}:${this.snap.proofBpc}`
      : "off";
    if (key === this.iccProofKey) return;
    this.iccProofKey = key;
    if (!want) { this.engine.setIccProofLut(null); return; }
    const profile = custom ? Promise.resolve<Uint8Array | null>(custom) : this.fetchProofProfile();
    void profile.then((proof) => {
      if (!proof || this.iccProofKey !== key || !this.engine.engine) return; // asset missing or stale bake
      // ponytail: Preserve Numbers bakes with the proof profile as the SOURCE
      // too, so document numbers reach the device unconverted. Exact for
      // matrix-TRC profiles; a LUT-based profile's same-profile round-trip is
      // only near-identity — an engine-side identity flag is the upgrade path.
      const lut = this.engine.e.proof_lut(
        preserve ? proof : (this.snap.iccProfileBytes ?? EMPTY_ICC_PROFILE),
        proof,
        this.snap.colorPolicyPrefs.intent,
        33,
        this.snap.proofBpc && !preserve, // PS disables BPC under Preserve Numbers
      );
      this.engine.setIccProofLut(lut.length ? lut : null);
    });
  }
  /** Proof Setup ▸ Custom ▸ Load: install a device ICC profile picked from disk
   *  as the "Device to Simulate". The header is sniffed at this trust boundary
   *  (the engine re-validates fully before baking); THROWS on a non-profile so
   *  the import path reports the file instead of silently proofing nothing. */
  setProofProfile(name: string, bytes: Uint8Array) {
    // ponytail: deliberately laxer than `parseIccProfile` (which the Assign /
    // Convert import path uses) — it does not check the profile's declared size,
    // because a proof profile is only ever handed to the engine, which re-checks
    // it fully. Fold the two together when the proof picker can also report.
    const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    if (bytes.length < ICC_MIN_BYTES || bytes.length >= ICC_MAX_BYTES || tag(36) !== "acsp") {
      throw new Error(`"${name}" is not a usable ICC profile`);
    }
    const space = tag(16);
    if (space !== "RGB " && space !== "CMYK") {
      throw new Error(`"${name}" must be an RGB or CMYK device profile`);
    }
    this.proofProfileBytes = bytes;
    this.set({
      proofProfileName: name,
      proofProfileIsRgb: space === "RGB ",
      proofPreserveNumbers: this.snap.proofPreserveNumbers && space === "RGB ",
    });
  }
  /** The loaded custom device profile's raw bytes (proof-setup file export). */
  getProofProfileBytes(): Uint8Array | null { return this.proofProfileBytes; }
  // ── Layer ▸ Isolate Layers / Select ▸ All Layers ───────────────
  /** Solo the active layer (toggle). A view filter — not an undoable edit. */
  toggleIsolate() {
    const e = this.engine.e;
    if (e.is_soloed()) e.set_solo(new Uint32Array());
    else e.set_solo(new Uint32Array(this.snap.selectedLayerIds.length ? this.snap.selectedLayerIds : [this.snap.activeLayerId]));
    this.engine.sync();
  }
  /** Layer ▸ Distribute: space the selected layers' content evenly. */
  distributeLayers(axis: number, key: number) {
    this.engine.e.distribute_layers(new Uint32Array(this.snap.selectedLayerIds), axis, key);
    this.engine.commit();
  }

  // ── tool / view ──────────────────────────────────────────────
  setTool(tool: ToolId) {
    // Leaving the Vanishing Point tool applies its open workspace, as Liquify
    // commits; a float the layer refuses keeps the tool (the toast says why).
    if (this.snap.tool === "vanishingpoint" && tool !== "vanishingpoint" && !this.applyVanishingPoint()) return;
    if (this.snap.paintSymmetryTransforming) this.commitPaintSymmetryTransform();
    // endTextEdit (not a bare textEdit:null) so the engine-side undo
    // coalescing session closes with the editor.
    this.endTextEdit();
    // Leaving the Liquify tool commits any open warp session (one history step).
    if (this.snap.tool === "liquify" && tool !== "liquify") this.endLiquify();
    // Adjustment Brush: leaving the tool stops forcing mask strokes to reveal.
    if (this.snap.tool === "adjustmentbrush" && tool !== "adjustmentbrush") this.engine.engine?.set_mask_reveal(false);
    this.set({ tool });
    this.pushBrush();
  }

  /** Adjustment Brush: ensure the paint target is a hidden-mask adjustment
   *  layer, then brush strokes reveal a local, non-destructive adjustment.
   *  Creates a new (hidden) Brightness adjustment unless one is already active;
   *  tweak its amount/type afterward in the Properties/Adjustments panel. */
  beginAdjustmentBrush() {
    const e = this.engine.e;
    const active = this.snap.layers.find((l) => l.id === this.snap.activeLayerId);
    if (!active || active.kind !== LAYER_KIND.adjustment) {
      e.add_adjustment_layer_hidden(0, new Float32Array([0.4, 0.0]), "Adjustment Brush");
      this.engine.commit();
    }
    e.set_mask_edit(true);
    e.set_mask_reveal(true);
    if (!this.snap.maskEdit) this.set({ maskEdit: true });
  }
  // Spacebar-held temporary Hand (pan). Transient; doesn't change the active tool.
  setSpacePan(on: boolean) {
    if (this.snap.spacePan !== on) this.set({ spacePan: on });
  }
  // Grave/tilde-held Brush erase is transient and sampled by beginBrushStroke().
  setTemporaryErase(on: boolean) {
    this.temporaryErase = on && this.snap.tool === "brush";
  }
  /** `x`/`y` is where the stroke starts, for the Pencil's Auto Erase: a stroke
   *  begun on a pixel that already wears the foreground colour paints the
   *  background colour instead, for its whole length (#432). */
  beginBrushStroke(x?: number, y?: number) {
    this.strokeTool = this.snap.tool === "brush" && this.temporaryErase ? "erase" : this.snap.tool;
    this.strokePaintsBackground = this.strokeTool === "pencil" && this.snap.brush.autoErase
      && x !== undefined && y !== undefined && this.pixelWearsForeground(x, y);
    this.pushBrush();
  }
  endBrushStroke() {
    this.strokeTool = null;
    this.strokePaintsBackground = false;
  }
  /** Whether the active layer's pixel at (x, y) is the foreground colour — an
   *  opaque pixel within one 8-bit step per channel, which is what a Pencil
   *  stroke leaves behind. Degrades to "no" on a wasm build without the reader. */
  private pixelWearsForeground(x: number, y: number): boolean {
    const e = this.engine.engine as { active_layer_pixel?: (x: number, y: number) => number } | null;
    if (!e?.active_layer_pixel) return false;
    const px = e.active_layer_pixel(Math.floor(x), Math.floor(y)) >>> 0;
    if ((px & 255) < 255) return false;
    const [r, g, b] = hsvToRgba(this.snap.fg);
    return Math.abs(((px >>> 24) & 255) - r) <= 1 && Math.abs(((px >>> 16) & 255) - g) <= 1 && Math.abs(((px >>> 8) & 255) - b) <= 1;
  }
  // Patch tool: heal the active selection from a source region offset by (dx,dy)
  // — the drag from the selection to the area to sample (or, in Destination
  // mode, push the selection's contents there). The options bar's Mode,
  // Transparent and Structure / Color ride along. One undo step.
  patchSelectionBy(dx: number, dy: number) {
    if (!this.engine.e.has_selection()) return;
    const s = this.snap;
    this.engine.e.patch_selection(Math.round(dx), Math.round(dy), s.patchMode, s.patchDestination, s.patchTransparent,
      s.patchStructure, s.patchColor);
    this.engine.commit();
  }
  // Quick Selection: one brush dab grows the selection from (x,y). `mode` is what
  // the pointer knows — 2 when Alt is held (Photoshop's subtract modifier), else 0
  // on the first dab and 1 while dragging. The options-bar Mode decides what a
  // plain drag actually does, and it carries through the rest of the stroke.
  // `first` pushes the single per-stroke undo. Radius follows the brush size.
  // A selection-only op → sync (no pixel edit / history step).
  quickSelectionAt(x: number, y: number, mode: number, first: boolean) {
    const radius = Math.max(1, Math.round(this.snap.brush.size / 2));
    if (first) this.quickStrokeMode = mode === 2 ? 2 : this.snap.quickSelectionMode;
    const m = first ? this.quickStrokeMode : mode === 2 || this.quickStrokeMode === 2 ? 2 : 1;
    this.engine.e.quick_selection(Math.round(x), Math.round(y), radius, this.snap.quickSelectionTolerance, m, first,
      this.snap.quickSelectionSampleAll, this.snap.quickSelectionAutoEnhance);
    this.engine.sync();
  }
  // Magnetic Lasso: snap the freehand path (flat x,y pairs) to nearby edges and
  // select the resulting polygon. One undo step; selection-only → sync.
  magneticLassoApply(xs: number[], ys: number[], mode: number) {
    if (xs.length < 3) return;
    this.engine.e.set_selection_antialias(this.snap.antiAlias);
    this.engine.e.magnetic_lasso(new Float32Array(xs), new Float32Array(ys), this.snap.magneticLassoRadius, this.snap.magneticLassoThreshold, mode);
    // The caller applies Feather + sync (mirrors the plain-lasso commit path).
  }

  // ── on-canvas text editing ───────────────────────────────────
  /** Begin editing a type layer in place (on the canvas). `fresh` selects the
   *  placeholder text so the first keystroke replaces it. */
  beginTextEdit(id: number, fresh: boolean) {
    if (this.liquifySession && id !== this.liquifySession.targetLayerId) this.cancelLiquify();
    // Activate the layer if needed (avoid a redundant full sync — which
    // regenerates every layer thumbnail — when it is already active, e.g. the
    // just-created layer).
    if (this.engine.e.active_layer_id() !== id) {
      this.engine.e.set_active_layer(id);
      this.engine.sync();
    }
    // Coalesce this session's per-keystroke re-applies into one undo step.
    this.engine.e.text_edit_session(true);
    this.set({ textEdit: { id, fresh } });
  }
  /** Commit/close the on-canvas text editor (the engine already has the live
   *  pixels + spec; this just dismisses the caret overlay). */
  endTextEdit() {
    const editing = this.snap.textEdit?.id ?? null;
    // Closing the undo-coalescing session is best-effort: it is already skipped
    // when the document is gone, and an engine that refuses (a failed export can
    // leave one unusable) must not keep the caret overlay up or block the
    // document switch that is dismissing it. Everything below still runs.
    try { this.engine.engine?.text_edit_session(false); } catch { /* worst case: one extra undo step */ }
    if (this.snap.textEdit) this.set({ textEdit: null });
    // Type Mask: when a mask-type edit finishes, convert the glyphs to a selection
    // and drop the temp layer. Only runs for mask layers — normal type is untouched.
    // Vertical type has no in-place session (it is edited from the toolbar), so
    // the commit keys off the pending mask target rather than the caret — the
    // Vertical Type Mask tool has to end somewhere too (#500).
    const maskTarget = this.maskTypeId;
    if (maskTarget != null && (editing == null || editing === maskTarget)) {
      this.maskTypeId = null;
      this.convertTypeToSelection(maskTarget);
    }
    // The live session carried the previous thumbnails; rebuild them once now
    // that typing stopped.
    if (editing != null) this.engine.sync();
  }
  /** Mark a just-created type layer as a Type Mask (becomes a selection on commit). */
  markTypeMask(id: number) {
    this.maskTypeId = id;
  }
  /** Rasterize a type layer's glyphs to an alpha mask → selection, then remove the
   *  layer. The selection inherits the glyph anti-aliasing (graded coverage). */
  private convertTypeToSelection(id: number) {
    const e = this.engine.engine;
    if (!e) return;
    const json = e.layer_text_spec(id);
    if (!json) { e.delete_layer(id); this.engine.commit(); return; }
    let spec: TextSpec;
    try { spec = JSON.parse(json) as TextSpec; } catch { e.delete_layer(id); this.engine.commit(); return; }
    const r = rasterizeSpec(spec);
    const alpha = new Uint8Array(r.w * r.h);
    let anyInk = false;
    for (let i = 0; i < alpha.length; i++) { const a = r.data[i * 4 + 3]; alpha[i] = a; if (a) anyInk = true; }
    // Empty / whitespace text → no glyphs: drop the temp layer but leave any
    // existing selection untouched (don't Replace it with an empty selection).
    if (anyInk) e.select_from_alpha(r.placeX, r.placeY, r.w, r.h, alpha, 0); // Replace
    e.delete_layer(id);
    this.engine.commit();
  }
  // The view setters act on the main canvas, or with `pane` on the Window ▸
  // Arrange pane showing that document (see viewOf).
  setZoom(zoom: number, panX?: number, panY?: number, pane?: number) {
    const z = Math.min(32, Math.max(0.02, zoom));
    this.setView(pane, { zoom: z, ...(panX !== undefined ? { panX } : {}), ...(panY !== undefined ? { panY } : {}) });
  }
  setPan(panX: number, panY: number, pane?: number) {
    this.setView(pane, { panX, panY });
  }
  /** Rotate View: set the non-destructive view rotation in degrees (wrapped to
   *  (-180, 180]). View-only — never bakes into the document pixels. */
  setRotation(deg: number, pane?: number) {
    let a = deg % 360;
    if (a > 180) a -= 360;
    if (a <= -180) a += 360;
    this.setView(pane, { rotationAngle: a });
  }
  private setView(pane: number | undefined, patch: Partial<CanvasViewState>) {
    if (pane === undefined) this.set(patch);
    else this.set({ paneViews: { ...this.snap.paneViews, [pane]: { ...viewOf(this.snap, pane), ...patch } } });
  }
  /** A view with the document it shows: the main canvas's is the active one. */
  private placedView(pane?: number): PlacedView {
    const d = pane === undefined ? null : this.docs.find((x) => x.id === pane);
    return {
      ...viewOf(this.snap, pane),
      docW: d ? d.engine.width() : this.snap.doc.width,
      docH: d ? d.engine.height() : this.snap.doc.height,
    };
  }
  /** A Window ▸ Arrange pane's zoom control: zoom about the pane's centre. */
  setPaneZoom(pane: number, zoom: number) {
    const v = this.placedView(pane);
    const par = this.snap.pixelAspectCorrection ? this.snap.pixelAspect : 1;
    this.setView(pane, matchedView({ ...v, zoom: Math.min(32, Math.max(0.02, zoom)) }, v, { zoom: true }, par));
  }
  /** Rotate View: nudge the rotation by a delta (e.g. ±15° steps). */
  rotateBy(delta: number) {
    this.setRotation(this.snap.rotationAngle + delta);
  }
  /** Publish the canvas viewport size (px) for the Navigator. ResizeObserver
   *  fires continuously, so skip no-op churn (every set() notifies subscribers). */
  setViewport(w: number, h: number, pane?: number) {
    const vp = viewOf(this.snap, pane).viewport;
    if (vp.w === w && vp.h === h) return;
    this.setView(pane, { viewport: { w, h } });
  }
  setCursor(c: { x: number; y: number } | null) {
    // Skip no-op churn: pointermove fires continuously but often within the same
    // integer pixel, and every set() notifies all store subscribers.
    const cur = this.snap.cursor;
    if (c === null ? cur === null : cur !== null && cur.x === c.x && cur.y === c.y) return;
    this.set({ cursor: c });
  }
  setSelectionDragRect(rect: SelRect | null) {
    const current = this.snap.selectionDragRect;
    if (rect === null ? current === null : current !== null
        && current.x === rect.x && current.y === rect.y && current.w === rect.w && current.h === rect.h) return;
    this.set({ selectionDragRect: rect });
  }

  // ── color ────────────────────────────────────────────────────
  setForeground(fg: HSV) {
    this.set({ fg });
    this.pushBrush();
  }
  setBackground(bg: HSV) {
    this.set({ bg });
  }
  swapColors() {
    this.set({ fg: this.snap.bg, bg: this.snap.fg });
    this.pushBrush();
  }
  setPicked(p: { r: number; g: number; b: number; a: number } | null) {
    this.set({ picked: p });
  }

  // ── brush ────────────────────────────────────────────────────
  setBrush(patch: Partial<BrushState>) {
    this.set({ brush: { ...this.snap.brush, ...patch } });
    this.pushBrush();
  }
  pushBrush() {
    const e = this.engine.engine;
    if (!e) return;
    const b = this.snap.brush;
    const t = this.strokeTool
      ?? (this.snap.tool === "brush" && this.temporaryErase ? "erase" : this.snap.tool);
    const [r, g, bl, a] = hsvToRgba(this.strokePaintsBackground ? this.snap.bg : this.snap.fg);
    // Erase to History rides the History Brush's paint path (mode 12) with the
    // Eraser's own tip; nothing erases, so the engine's erase flag stays off.
    const eraseToHistory = t === "erase" && b.eraseToHistory && this.snap.hasHistorySource;
    const erase = t === "erase" && !eraseToHistory;
    // Eraser Mode (Photoshop): Brush = soft, Pencil = hard aliased round, Block =
    // hard aliased square. Pencil/Block force hardness 1 (crisp, non-anti-aliased
    // disc); Block additionally switches the footprint to a square via set_block.
    const eraserHard = t === "erase" && this.snap.eraserMode !== "brush";
    // Pencil paints with a hard, 100%-aliased edge (Photoshop Pencil) — the engine
    // already renders a crisp, non-anti-aliased disc at hardness 1, so the Pencil
    // is the Brush with hardness forced to 1 (the UI hides the Hardness control).
    const hardness = t === "pencil" || eraserHard ? 1 : b.hardness;
    e.set_brush(b.size, hardness, b.flow, b.opacity, b.spacing, r, g, bl, a, erase);
    // Capture the brush config so a collaboratively-broadcast stroke replays with
    // the same brush on peers (see EngineClient.strokeCaptureBegin / src/collab).
    this.engine.lastBrush = [b.size, hardness, b.flow, b.opacity, b.spacing, r, g, bl, a, erase ? 1 : 0];
    e.set_brush_dynamics(b.sizePressure, b.flowPressure);
    e.set_brush_shape(b.angle, b.roundness);
    e.set_block(t === "erase" && this.snap.eraserMode === "block");
    const mode = eraseToHistory ? 12 : erase ? 1 : t === "dodge" ? 2 : t === "burn" ? 3 : t === "smudge" ? 4 : t === "heal" ? 5 : t === "colorreplace" ? 6 : t === "backgrounderaser" ? 7 : t === "sponge" ? 8 : t === "blur" ? 9 : t === "sharpen" ? 10 : t === "mixerbrush" ? 11 : t === "historybrush" ? 12 : 0;
    e.set_brush_mode(mode);
    // Brush Mode (blend dropdown) — engine applies it to the paint/pencil path only.
    // Negative sentinels are the non-blend composites: -1 Behind, -2 Clear.
    const blend = b.blend ?? 0;
    e.set_brush_paint_mode(blend === -1 ? 1 : blend === -2 ? 2 : 0);
    e.set_brush_blend(blend >= 0 ? blend : 0);
    e.set_dodge_options(b.dodgeRange, b.dodgeExposure, b.protectTones);
    e.set_sponge_options(b.spongeMode, b.spongeRate, b.spongeVibrance);
    e.set_blur_options(b.blurRate);
    e.set_sharpen_options(b.sharpenRate, b.sharpenProtect);
    e.set_background_eraser_options(b.bgEraserTolerance, b.bgEraserProtectFg);
    e.set_mixer_params(b.mixerWet, b.mixerLoad, b.mixerMix);
    e.set_smudge_finger(b.smudgeFinger);
    e.set_retouch_sample_all(b.sampleAllLayers);
    e.set_background_eraser_sampling(b.bgEraserSampling, b.bgEraserLimits);
    e.set_mixer_auto(b.mixerAutoLoad, b.mixerAutoClean);
    // Patterns live in the store's library, so re-push the picked tile when the
    // engine slot is empty — a New/Open engine swap drops it, and the Pattern
    // Stamp paints nothing without it. Picking a pattern pushes it directly, so
    // only the emptied-slot case has to be repaired here.
    const pat = this.snap.activePattern >= 0 ? this.snap.patternPresets[this.snap.activePattern] : undefined;
    if (pat && !e.has_pattern()) e.set_pattern(pat.w, pat.h, pat.px);
    // Layer styles name library tiles by id, and a new/opened engine has none.
    this.syncStylePatterns();
    // Pattern Stamp: the clone source is the defined pattern (tiled, canvas-aligned).
    // The Healing Brush's Source: Pattern rides the same flag — the dab then heals
    // the tile into place through the boundary solve instead of a sampled point.
    if (t === "patternstamp" || (t === "heal" && b.healSource === "pattern")) {
      e.set_clone(true, 0, 0);
      e.set_pattern_stamp(true);
    } else {
      e.set_pattern_stamp(false);
      if (t !== "clone" && t !== "heal") e.set_clone(false, 0, 0);
    }
    e.set_heal_diffusion(b.healDiffusion);
    e.set_clone_sample(this.snap.cloneSample);
    e.set_color_replace_mode(this.snap.colorReplaceMode);
    e.set_mask_edit(this.snap.maskEdit);
    // Define Brush Preset: when a custom tip is active, push its bytes (so it
    // survives an engine swap on New/Open) and enable the tip paint path; else
    // fall back to the procedural round brush.
    const tip = this.snap.activeBrushTip >= 0 ? this.snap.brushTips[this.snap.activeBrushTip] : undefined;
    if (tip) {
      e.set_brush_tip(tip.w, tip.h, tip.alpha);
      e.set_brush_tip_active(true);
    } else {
      e.set_brush_tip_active(false);
    }
  }

  // ── liquify (forward-warp brush) ──────────────────────────────
  setLiquify(patch: Partial<LiquifyState>) {
    const session = this.liquifySession ? this.currentLiquifySession() : null;
    if (session && patch.targetLayerId !== undefined) {
      patch = { ...patch };
      delete patch.targetLayerId;
    }
    this.set({ liquify: liquifyReduce(this.snap.liquify, patch) });
    const lq = this.snap.liquify;
    if (patch.preview === false || (patch.preview === true && lq.showBackdrop) || (patch.showBackdrop && lq.showBackdrop) || (patch.backdropSource && lq.showBackdrop)) {
      this.captureLiquifyBackdrop(this.liquifyBackdropSource());
    }
  }
  private liquifyBackdropSource(): LiquifyBackdropSource {
    return this.snap.liquify.preview ? this.snap.liquify.backdropSource : "all";
  }
  private captureLiquifyBackdrop(source: LiquifyBackdropSource) {
    const pending = this.liquifySession;
    const session = pending ? this.currentLiquifySession() : null;
    if (pending && !session) return;
    const e = session?.engine ?? this.engine.engine;
    if (!e) return;
    const existing = this.liquifyBackdrops[source];
    if (existing && existing.docId === this.activeDocId && existing.w === e.width() && existing.h === e.height()) return;
    const pixels = source === "active" ? this.engine.activeLayerCopy()
      : source === "behind" ? this.liquifyBehindActiveCopy(e)
        : this.engine.outputCopy();
    if (!pixels) return;
    this.liquifyBackdrops[source] = { docId: this.activeDocId, w: e.width(), h: e.height(), pixels };
    this.set({ liquifyBackdropGen: this.snap.liquifyBackdropGen + 1 });
  }
  private liquifyBehindActiveCopy(e: Engine): Uint8ClampedArray | null {
    const clone = this.engine.buildProject(this.engine.projectBytes(e));
    this.applyBlendGamma(clone);
    const active = clone.active_layer_id();
    let activeIndex = -1;
    const ids: number[] = [];
    for (let i = 0; i < clone.layer_count(); i++) {
      const id = clone.layer_id_at(i);
      ids.push(id);
      if (id === active) activeIndex = i;
    }
    if (activeIndex < 0) return null;
    for (let i = 0; i <= activeIndex; i++) {
      if (clone.layer_visible(ids[i])) clone.set_layer_visible(ids[i], false);
    }
    return this.engine.engineOutputCopy(clone);
  }
  private captureLiquifySessionBackdrops() {
    this.captureLiquifyBackdrop("all");
    this.captureLiquifyBackdrop("active");
    this.captureLiquifyBackdrop("behind");
  }
  private clearLiquifyBackdrop() {
    if (!this.liquifyBackdrops.all && !this.liquifyBackdrops.active && !this.liquifyBackdrops.behind) return;
    this.liquifyBackdrops = {};
    this.set({ liquifyBackdropGen: this.snap.liquifyBackdropGen + 1 });
  }
  private liquifyTargetLayerId(): number {
    const target = this.snap.liquify.targetLayerId;
    if (target > 0 && this.snap.layers.some((l) => l.id === target && l.kind === LAYER_KIND.pixel && !l.locked)) return target;
    // Smart objects arrive through the active-layer fallback: liquify_begin now
    // accepts them and commits the session mesh as a re-editable smart filter.
    return this.snap.activeLayerId;
  }
  private restoreLiquifyActiveLayer(session: LiquifySession) {
    if (session.restoreLayerId !== session.targetLayerId) session.engine.set_active_layer(session.restoreLayerId);
  }
  private liquifySessionIsCurrent(session: LiquifySession): boolean {
    return this.activeDocId === session.docId
      && this.engine.engine === session.engine
      && session.engine.active_layer_id() === session.targetLayerId;
  }
  private currentLiquifySession(): LiquifySession | null {
    const session = this.liquifySession;
    if (!session || this.liquifySessionIsCurrent(session)) return session;
    this.cancelLiquifySession(session);
    return null;
  }
  private cancelLiquifySession(session: LiquifySession) {
    if (this.liquifySession !== session) return;
    const ownsTarget = this.liquifySessionIsCurrent(session);
    this.liquifySession = null;
    session.engine.liquify_cancel();
    if (ownsTarget) this.restoreLiquifyActiveLayer(session);
    this.clearLiquifyBackdrop();
    this.set({ liquifyMeshGen: this.snap.liquifyMeshGen + 1 });
    if (this.activeDocId === session.docId && this.engine.engine === session.engine) {
      this.engine.refreshFromEngine();
    }
  }
  private beginLiquifyIfNeeded() {
    const e = this.engine.engine;
    if (!e) return null;
    if (this.liquifySession) return this.currentLiquifySession()?.engine ?? null;
    const restoreLayerId = e.active_layer_id();
    const requestedTargetId = this.liquifyTargetLayerId();
    if (requestedTargetId > 0 && requestedTargetId !== restoreLayerId) e.set_active_layer(requestedTargetId);
    const targetLayerId = e.active_layer_id();
    this.captureLiquifySessionBackdrops();
    if (!e.liquify_begin()) {
      this.clearLiquifyBackdrop();
      if (restoreLayerId !== targetLayerId) e.set_active_layer(restoreLayerId);
      // Report a named refusal (e.g. 32-bit) now, not on the next unrelated commit.
      if (!this.engine.consumeEditError()) this.engine.sync();
      return null;
    }
    this.liquifySession = { docId: this.activeDocId, engine: e, targetLayerId, restoreLayerId };
    this.set({ liquifyMaskGen: e.liquify_freeze_mask_generation(), liquifyMeshGen: this.snap.liquifyMeshGen + 1 });
    return e;
  }
  hasLiquifySession(): boolean {
    return !!this.currentLiquifySession();
  }
  liquifyBackdropPixels(): { w: number; h: number; pixels: Uint8ClampedArray } | null {
    const pending = this.liquifySession;
    if (pending && !this.currentLiquifySession()) return null;
    const backdrop = this.liquifyBackdrops[this.liquifyBackdropSource()];
    if (backdrop?.docId !== this.activeDocId) return null;
    return backdrop;
  }
  /** Apply one Liquify dab at (cx, cy) in document space. (gx, gy) is the drag
   *  vector since the last dab (used by Push). The session begins lazily on the
   *  first dab (one undo step), capturing any active selection as the editable
   *  Liquify area; the dirty rect is composited + blitted live. */
  liquifyDab(cx: number, cy: number, gx: number, gy: number, pressure = 1) {
    const e = this.beginLiquifyIfNeeded();
    if (!e) return;
    const lq = this.snap.liquify;
    const radius = Math.max(1, lq.size / 2);
    const strength = lq.strength * lq.pressure * pressure;
    if (lq.mode === 6 || lq.mode === 7) {
      const r = e.liquify_mask_dab(cx, cy, radius, lq.density, lq.mode === 6, strength);
      if (r[2] > 0 && r[3] > 0) this.set({ liquifyMaskGen: e.liquify_freeze_mask_generation() });
      return;
    }
    e.liquify_set_pin_edges(lq.pinEdges);
    const r = e.liquify_dab(cx, cy, radius, lq.density, lq.mode, strength, gx, gy);
    if (r[2] > 0 && r[3] > 0) {
      this.set({ liquifyMeshGen: this.snap.liquifyMeshGen + 1 });
      this.engine.paintRegion(r[0], r[1], r[2], r[3]);
    }
  }
  /** Liquify workspace Restore All: clear every live displacement but keep the
   *  current session open so subsequent dabs still fold into the same undo step. */
  restoreLiquify() {
    const e = this.currentLiquifySession()?.engine;
    if (!e) return;
    if (e.liquify_restore_all()) {
      this.set({ liquifyMeshGen: this.snap.liquifyMeshGen + 1 });
      this.engine.blit();
    }
  }
  liquifyMaskAll(): boolean {
    const e = this.beginLiquifyIfNeeded();
    if (!e || !e.liquify_mask_all()) return false;
    this.set({ liquifyMaskGen: e.liquify_freeze_mask_generation() });
    return true;
  }
  liquifyMaskClear(): boolean {
    const e = this.beginLiquifyIfNeeded();
    if (!e || !e.liquify_mask_clear()) return false;
    this.set({ liquifyMaskGen: e.liquify_freeze_mask_generation() });
    return true;
  }
  liquifyMaskInvert(): boolean {
    const e = this.beginLiquifyIfNeeded();
    if (!e || !e.liquify_mask_invert()) return false;
    this.set({ liquifyMaskGen: e.liquify_freeze_mask_generation() });
    return true;
  }
  /** Liquify Mask Options: load the active layer's alpha channel as the Freeze
   *  Mask source and combine it into the current overlay. op: 0 Replace ·
   *  1 Add · 2 Subtract · 3 Intersect (same convention as the selection tools'
   *  combine modes). */
  liquifyMaskFromTransparency(op: number): boolean {
    const e = this.beginLiquifyIfNeeded();
    if (!e || !e.liquify_mask_from_transparency(op)) return false;
    this.set({ liquifyMaskGen: e.liquify_freeze_mask_generation() });
    return true;
  }
  /** Liquify Mask Options: load the active layer's own layer mask as the
   *  Freeze Mask source (no layer mask = fully revealed) and combine it into
   *  the current overlay. op: 0 Replace · 1 Add · 2 Subtract · 3 Intersect. */
  liquifyMaskFromLayerMask(op: number): boolean {
    const e = this.beginLiquifyIfNeeded();
    if (!e || !e.liquify_mask_from_layer_mask(op)) return false;
    this.set({ liquifyMaskGen: e.liquify_freeze_mask_generation() });
    return true;
  }
  /** Liquify workspace Save Mesh: snapshot the live displacement field in
   *  memory; Load Mesh can reapply it to any same-size document before
   *  Apply/Cancel. */
  saveLiquifyMesh(): boolean {
    const e = this.currentLiquifySession()?.engine;
    if (!e) return false;
    const w = e.width();
    const h = e.height();
    const fx = e.liquify_mesh_fx();
    const fy = e.liquify_mesh_fy();
    if (fx.length !== w * h || fy.length !== w * h) return false;
    this.liquifySavedMesh = { w, h, fx: new Float32Array(fx), fy: new Float32Array(fy) };
    return true;
  }
  /** Export the current live Liquify mesh as a portable same-size JSON file. */
  exportLiquifyMesh(): Uint8Array | null {
    if (!this.saveLiquifyMesh()) return null;
    return this.liquifySavedMesh ? encodeLiquifyMesh(this.liquifySavedMesh) : null;
  }
  /** Import a portable same-size Liquify mesh and load it into the current
   *  workspace. Loading into an idle Liquify tool opens a normal one-step
   *  session through loadLiquifyMesh(). */
  importLiquifyMesh(input: string | Uint8Array): boolean {
    const mesh = parseLiquifyMesh(input);
    if (!mesh) return false;
    const pending = this.liquifySession;
    if (pending && !this.currentLiquifySession()) return false;
    const e = this.engine.engine;
    if (!e || e.width() !== mesh.w || e.height() !== mesh.h) return false;
    this.liquifySavedMesh = mesh;
    return this.loadLiquifyMesh();
  }
  /** Liquify workspace Load Mesh: replace the live displacement field with the
   *  last saved mesh and re-render from the session base. Loading into an idle
   *  Liquify tool opens a normal one-step Liquify session. */
  loadLiquifyMesh(): boolean {
    const mesh = this.liquifySavedMesh;
    if (!mesh) return false;
    const current = this.engine.engine;
    if (!current || current.width() !== mesh.w || current.height() !== mesh.h) return false;
    const e = this.beginLiquifyIfNeeded();
    if (!e) return false;
    if (!e.liquify_load_mesh(mesh.fx, mesh.fy)) return false;
    this.set({ liquifyMeshGen: this.snap.liquifyMeshGen + 1 });
    this.engine.blit();
    return true;
  }
  private finishLiquify(apply: boolean) {
    const session = this.liquifySession;
    if (!session) return;
    if (!apply || !this.liquifySessionIsCurrent(session)) {
      this.cancelLiquifySession(session);
      return;
    }
    const warped = session.engine.liquify_mesh_fx().some((d) => d !== 0)
      || session.engine.liquify_mesh_fy().some((d) => d !== 0);
    this.liquifySession = null;
    session.engine.liquify_end();
    this.restoreLiquifyActiveLayer(session);
    this.clearLiquifyBackdrop();
    this.set({ liquifyMeshGen: this.snap.liquifyMeshGen + 1 });
    if (warped) this.engine.commit();
    else this.engine.refreshFromEngine();
  }
  /** Commit the open Liquify session as a single history step (Apply / Enter /
   *  leaving the tool). No-op when no session is open. */
  endLiquify() {
    this.finishLiquify(true);
  }
  /** Discard the open Liquify session, restoring the frozen base and dropping its
   *  undo step (Esc). No-op when no session is open. */
  cancelLiquify() {
    this.finishLiquify(false);
  }

  // ── Filter ▸ Vanishing Point workspace ───────────────────────
  // Modal like Photoshop's: clone strokes and placed floats inside it share one
  // history transaction. OK keeps a single "Vanishing Point" step; Cancel
  // restores the document and the planes, active plane and source it opened with.
  openVanishingPoint() {
    const e = this.engine.engine as StoreHistoryTransactionEngine | null;
    if (this.vpSession || !e) return;
    const refuse = () => this.engine.onEditError?.("Finish or cancel the current edit before opening Vanishing Point.");
    // Refuse before arming the tool, so a refused open leaves the tool as it was.
    if (e.history_transaction_active()) { refuse(); return; }
    this.setTool("vanishingpoint");
    if (!this.beginHistory("Vanishing Point")) { refuse(); return; }
    this.vpSession = {
      docId: this.activeDocId, engine: e, pushes: e.undo_pushes(), float: null,
      planes: clonePlanes(this.snap.vanishingPointPlanes), active: this.snap.vanishingPointActivePlane, source: this.snap.vanishingPointSource,
    };
    this.set({ vanishingPointSession: true, vanishingPointTool: "edit", vanishingPointMarquee: null, vanishingPointFloat: null });
  }
  /** False when the float could not be placed: the workspace stays open with it. */
  applyVanishingPoint(): boolean {
    const s = this.vpSession;
    if (!s) return true;
    if (!this.commitVanishingPointFloat()) return false;
    this.vpSession = null;
    this.set({ vanishingPointSession: false, vanishingPointMarquee: null, vanishingPointFloat: null });
    const e = s.engine as StoreHistoryTransactionEngine;
    // beginHistory's labelled entry is a whole-stack snapshot, so dropping the
    // per-edit entries above it leaves one step that undoes the lot.
    let pushed = Math.round(e.undo_pushes() - s.pushes);
    if (pushed <= 0) { this.dropHistory(); return true; } // only planes changed: no history step
    while (pushed-- > 0) e.drop_last_undo();
    // A miscounted collapse must never strand the transaction: it blocks every shortcut.
    if (!this.commitHistory() && e.history_transaction_active()) this.dropHistory();
    return true;
  }
  cancelVanishingPoint() {
    const s = this.vpSession;
    if (!s) return;
    this.vpSession = null;
    if ((s.engine as StoreHistoryTransactionEngine).cancel_history_transaction() && this.engine.engine === s.engine) {
      this.engine.refreshFromEngine();
    }
    this.set({
      vanishingPointPlanes: s.planes, vanishingPointActivePlane: s.active, vanishingPointSource: s.source,
      vanishingPointSession: false, vanishingPointMarquee: null, vanishingPointFloat: null,
    });
  }
  tearOffVanishingPlane(parent: number, edge: number): boolean {
    const planes = this.snap.vanishingPointPlanes;
    const quad = planes[parent] ? tearOffPlane(planes[parent].quad, edge, 90, this.snap.doc.width, this.snap.doc.height) : null;
    if (!quad) {
      this.engine.onEditError?.("Could not tear off a plane from that edge: it would fold behind the camera. Adjust the parent plane's corners and try again.");
      return false;
    }
    this.set({
      vanishingPointPlanes: [...clonePlanes(planes), { quad, parent, edge, angle: 90 }],
      vanishingPointActivePlane: planes.length,
    });
    return true;
  }
  /** The fold angle of the active torn-off plane (root planes have none). */
  setVanishingPlaneAngle(angle: number): boolean {
    const planes = this.snap.vanishingPointPlanes, i = this.snap.vanishingPointActivePlane, plane = planes[i];
    if (!plane || plane.parent === null) return false;
    const { width, height } = this.snap.doc;
    if (!tearOffPlane(planes[plane.parent].quad, plane.edge, angle, width, height)) {
      this.engine.onEditError?.("That angle folds the plane flat onto itself or behind the camera. Enter an angle between 1° and 359°.");
      return false;
    }
    const next = clonePlanes(planes);
    next[i].angle = angle;
    this.set({ vanishingPointPlanes: resolvePlanes(next, width, height) });
    return true;
  }
  /** Numeric corner entry (index 0..7 = TL X … BL Y) on the active plane's root. */
  setVanishingRootCorner(index: number, value: number): boolean {
    const planes = this.snap.vanishingPointPlanes;
    let root = this.snap.vanishingPointActivePlane;
    while (planes[root] && planes[root].parent !== null) root = planes[root].parent!;
    const quad = planes[root]?.quad;
    if (!quad || !Number.isInteger(index) || index < 0 || index > 7 || !Number.isFinite(value)) {
      this.engine.onEditError?.("Enter each plane corner as a number of document pixels.");
      return false;
    }
    const handle = index >> 1;
    const x = index % 2 ? quad[handle * 2] : value, y = index % 2 ? value : quad[handle * 2 + 1];
    this.set({ vanishingPointPlanes: movePlaneHandle(planes, root, handle, x, y, this.snap.doc.width, this.snap.doc.height) });
    return true;
  }
  resetVanishingPlanes() {
    this.set({
      vanishingPointPlanes: defaultVanishingPointPlanes(this.snap.doc.width, this.snap.doc.height),
      vanishingPointActivePlane: 0, vanishingPointSource: null, vanishingPointMarquee: null, vanishingPointFloat: null,
    });
    if (this.vpSession) this.vpSession.float = null;
  }
  /** Float an image (sw×sh RGBA mapped from `srcQuad`) onto a plane rectangle,
   *  placing any float already out first. */
  setVanishingFloat(rgba: ArrayLike<number>, w: number, h: number, srcQuad: number[], rect: VanishingRect) {
    const s = this.vpSession;
    if (!s) return;
    this.commitVanishingPointFloat();
    s.float = { rgba, w, h, srcQuad };
    this.set({ vanishingPointFloat: rect });
  }
  vanishingPointFloatImage() {
    return this.vpSession?.float ?? null;
  }
  /** Render the float into the active layer (inside the workspace transaction).
   *  False when it was refused: the float stays out so the toast's fix can follow. */
  commitVanishingPointFloat(): boolean {
    const s = this.vpSession, float = s?.float, rect = this.snap.vanishingPointFloat;
    if (!s) return true;
    if (float && rect) {
      const { width, height } = this.snap.doc;
      const dst = uvRectQuad(this.snap.vanishingPointPlanes[rect.plane]?.quad ?? [], rect);
      const out = dst && warpQuadToQuad(float.rgba, float.w, float.h, float.srcQuad, dst, width, height);
      if (!out) {
        this.engine.onEditError?.("The floating image is off the canvas. Drag it onto a plane inside the document, then apply.");
        return false;
      }
      const before = s.engine.undo_pushes();
      // ponytail: stamp_image is 8-bit in, so a float on a 16-bit document is
      // quantized (and 32-bit refuses it); a u16 Rust warp is the upgrade.
      s.engine.stamp_image(out.x, out.y, out.w, out.h, out.rgba);
      if (s.engine.undo_pushes() === before) {
        if (!this.engine.consumeEditError()) {
          this.engine.onEditError?.("Could not place the image because the active layer is locked or is not a pixel layer. Select an unlocked pixel layer and try again.");
        }
        return false;
      }
      this.engine.commit();
    }
    s.float = null;
    if (rect) this.set({ vanishingPointFloat: null });
    return true;
  }

  // ── tool options ─────────────────────────────────────────────
  setOptions(patch: Partial<AppSnapshot>) {
    const { guides, ...options } = patch;
    if (guides !== undefined) this.setGuides(guides);
    // Brush Preview is the brush-tip outline, so it stays off while Preferences
    // ▸ Cursors paints with a Standard/Precise cursor (View ▸ Show ▸ All too).
    if (options.showBrushPreview && !isBrushTipCursor((options.cursorPrefs ?? this.snap.cursorPrefs).painting)) {
      options.showBrushPreview = false;
    }
    this.set(options);
    if (patch.cloneSample !== undefined) this.engine.e.set_clone_sample(patch.cloneSample);
    if (patch.colorReplaceMode !== undefined) this.engine.e.set_color_replace_mode(patch.colorReplaceMode);
    // Preferences ▸ Guides, Grid & Slices routes through here — an application
    // preference, not document state, so it has to survive relaunch.
    if (patch.gridSpacing !== undefined || patch.gridColor !== undefined) {
      try { localStorage.setItem("mv.gridPrefs", JSON.stringify({ spacing: this.snap.gridSpacing, color: this.snap.gridColor })); } catch { /* storage may be unavailable */ }
    }
  }

  // ── Window ▸ Clone Source (#427) ─────────────────────────────
  /** Alt-click: sample (x, y) of the active document into the active slot. */
  setCloneSource(x: number, y: number) {
    const slot = this.snap.cloneSourceSlot;
    this.set({ cloneSources: this.snap.cloneSources.map((s, i) => (i === slot ? { ...s, source: { docId: this.activeDocId, x, y } } : s)) });
  }
  selectCloneSlot(i: number) {
    if (Number.isInteger(i) && i >= 0 && i < CLONE_SLOT_COUNT) this.set({ cloneSourceSlot: i });
  }
  /** Patch the active slot's transform. Out-of-range input (including a field's
   *  NaN) changes nothing and says why; Reset Transform passes the defaults. */
  setCloneTransform(patch: Partial<CloneSlotTransform>) {
    const error = validateCloneOptions(patch);
    if (error) { this.set({ cloneSourceError: error }); return; }
    const slot = this.snap.cloneSourceSlot;
    this.set({
      cloneSourceError: "",
      cloneSources: this.snap.cloneSources.map((s, i) => (i === slot ? { ...s, transform: { ...s.transform, ...patch } } : s)),
    });
  }
  setCloneOverlay(patch: Partial<AppSnapshot["cloneOverlay"]>) {
    const error = validateCloneOptions({ opacity: patch.opacity });
    if (error) { this.set({ cloneSourceError: error }); return; }
    this.set({ cloneSourceError: "", cloneOverlay: { ...this.snap.cloneOverlay, ...patch } });
  }
  /** The active slot's source pixels (RGBA8, per the Sample mode) from the
   *  document it was sampled in; null with no source or once that document closed. */
  cloneSourceImage(): { w: number; h: number; px: Uint8Array } | null {
    const src = this.snap.cloneSources[this.snap.cloneSourceSlot]?.source;
    const e = src && this.docs.find((d) => d.id === src.docId)?.engine;
    if (!e) return null;
    e.set_clone_sample(this.snap.cloneSample);
    return { w: e.width(), h: e.height(), px: e.clone_source_rgba8() };
  }
  /** Arm the next clone/heal stroke with the active slot's source. The active
   *  document captures its own at stroke_begin; another document's pixels are
   *  pushed into the active engine for that one stroke. */
  prepareCloneSource(): boolean {
    const src = this.snap.cloneSources[this.snap.cloneSourceSlot]?.source;
    if (!src) return false;
    if (src.docId === this.activeDocId) return true;
    const img = this.cloneSourceImage();
    return !!img && this.engine.e.set_clone_source(img.w, img.h, img.px);
  }
  /** Type ▸ Font Preview Size: application preference, not document state. */
  setFontPreviewSize(size: FontPreviewSize) {
    const next = normalizeFontPreviewSize(size);
    if (next === this.snap.fontPreviewSize) return;
    this.set({ fontPreviewSize: next });
    try { localStorage.setItem("mv.fontPreviewSize", next); } catch { /* storage may be unavailable */ }
  }
  loadFontPreviewSize() {
    try {
      const saved = localStorage.getItem("mv.fontPreviewSize");
      if (saved != null) this.set({ fontPreviewSize: normalizeFontPreviewSize(saved) });
    } catch { /* storage may be unavailable */ }
  }
  setUseShiftKeyForToolSwitch(enabled: boolean) {
    if (enabled === this.snap.useShiftKeyForToolSwitch) return;
    this.set({ useShiftKeyForToolSwitch: enabled });
    try {
      if (enabled) localStorage.removeItem("mv.useShiftKeyForToolSwitch");
      else localStorage.setItem("mv.useShiftKeyForToolSwitch", "false");
    } catch { /* storage may be unavailable */ }
  }
  loadUseShiftKeyForToolSwitch() {
    try {
      this.set({ useShiftKeyForToolSwitch: localStorage.getItem("mv.useShiftKeyForToolSwitch") !== "false" });
    } catch { /* storage may be unavailable */ }
  }
  setSpringLoadedToolPreferences(patch: Partial<Pick<AppSnapshot, "springLoadedToolShortcuts" | "springLoadedToolDelayMs">>) {
    const springLoadedToolShortcuts = patch.springLoadedToolShortcuts ?? this.snap.springLoadedToolShortcuts;
    const rawDelay = patch.springLoadedToolDelayMs ?? this.snap.springLoadedToolDelayMs;
    const springLoadedToolDelayMs = Number.isFinite(rawDelay)
      ? Math.min(2000, Math.max(200, Math.round(rawDelay)))
      : this.snap.springLoadedToolDelayMs;
    if (springLoadedToolShortcuts === this.snap.springLoadedToolShortcuts && springLoadedToolDelayMs === this.snap.springLoadedToolDelayMs) return;
    this.set({ springLoadedToolShortcuts, springLoadedToolDelayMs });
    try {
      if (springLoadedToolShortcuts && springLoadedToolDelayMs === 200) localStorage.removeItem("mv.springLoadedTools");
      else localStorage.setItem("mv.springLoadedTools", JSON.stringify({ enabled: springLoadedToolShortcuts, delayMs: springLoadedToolDelayMs }));
    } catch { /* storage may be unavailable */ }
  }
  loadSpringLoadedToolPreferences() {
    try {
      const saved = localStorage.getItem("mv.springLoadedTools");
      if (!saved) return;
      const value: unknown = JSON.parse(saved);
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const prefs = value as { enabled?: unknown; delayMs?: unknown };
      const springLoadedToolDelayMs = typeof prefs.delayMs === "number" && Number.isFinite(prefs.delayMs)
        ? Math.min(2000, Math.max(200, Math.round(prefs.delayMs)))
        : 200;
      this.set({ springLoadedToolShortcuts: prefs.enabled !== false, springLoadedToolDelayMs });
    } catch { /* storage may be unavailable */ }
  }
  // ── Preferences ▸ Cursors / Workspace / Camera Raw (#482) ──────
  setCursorPrefs(patch: Partial<CursorPrefs>) {
    const cursorPrefs = normalizeCursorPrefs({ ...this.snap.cursorPrefs, ...patch }, this.snap.cursorPrefs);
    // The brush-tip outline is the one View ▸ Show ▸ Brush Preview shows, so a
    // Painting Cursors choice switches it with the outline: picking a tip never
    // chooses something invisible, and Standard/Precise read as "no preview".
    const showBrushPreview = patch.painting ? isBrushTipCursor(cursorPrefs.painting) : this.snap.showBrushPreview;
    this.set({ cursorPrefs, showBrushPreview });
    try { localStorage.setItem("mv.cursorPrefs", JSON.stringify(cursorPrefs)); } catch { /* storage may be unavailable */ }
  }
  setWorkspacePrefs(patch: Partial<WorkspacePrefs>) {
    const workspacePrefs = normalizeWorkspacePrefs({ ...this.snap.workspacePrefs, ...patch }, this.snap.workspacePrefs);
    this.set({ workspacePrefs });
    try { localStorage.setItem("mv.workspacePrefs", JSON.stringify(workspacePrefs)); } catch { /* storage may be unavailable */ }
  }
  setCameraRawPrefs(patch: Partial<CameraRawPrefs>) {
    const cameraRawPrefs = normalizeCameraRawPrefs({ ...this.snap.cameraRawPrefs, ...patch }, this.snap.cameraRawPrefs);
    this.set({ cameraRawPrefs });
    try { localStorage.setItem("mv.cameraRawPrefs", JSON.stringify(cameraRawPrefs)); } catch { /* storage may be unavailable */ }
  }
  loadPreferencePanes() {
    const saved = (key: string): unknown => {
      try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
    };
    const cursorPrefs = normalizeCursorPrefs(saved("mv.cursorPrefs"));
    this.set({
      cursorPrefs,
      showBrushPreview: isBrushTipCursor(cursorPrefs.painting),
      workspacePrefs: normalizeWorkspacePrefs(saved("mv.workspacePrefs")),
      cameraRawPrefs: normalizeCameraRawPrefs(saved("mv.cameraRawPrefs")),
    });
  }
  // ── View ▸ overlays (grid/guides/rulers/snap) ──────────────────
  toggleView(key: "showExtras" | "showGrid" | "showPixelGrid" | "showLayerEdges" | "showSelectionEdges" | "showSmartGuides" | "showTargetPath" | "showBrushPreview" | "showGuides" | "showRulers" | "snapEnabled" | "snapGuides" | "snapGrid" | "snapDocBounds" | "guidesLocked") {
    // Turning Brush Preview on under a Standard/Precise painting cursor would
    // show nothing; it brings back the default Normal Brush Tip outline.
    if (key === "showBrushPreview" && !this.snap.showBrushPreview && !isBrushTipCursor(this.snap.cursorPrefs.painting)) {
      this.setCursorPrefs({ painting: "normal" });
      return;
    }
    this.set({ [key]: !this.snap[key] } as Partial<AppSnapshot>);
  }
  /** View ▸ Screen Mode: set a specific mode (menu items). */
  setScreenMode(m: ScreenMode) {
    this.set({ screenMode: m });
  }
  /** View ▸ Screen Mode: cycle forward (F) or backward (Shift+F). */
  cycleScreenMode(reverse = false) {
    this.set({ screenMode: nextScreenMode(this.snap.screenMode, reverse) });
  }
  /** View ▸ New Guide: add a horizontal (y) or vertical (x) guide at doc px `p`. */
  addGuide(o: "h" | "v", p: number, color = DEFAULT_GUIDE_COLOR) {
    this.setGuides([...this.snap.guides, { o, p, color }]);
  }
  setGuides(guides: unknown) {
    const next = normalizeGuides(guides);
    if (next.length === this.snap.guides.length
      && next.every((guide, i) => guide.o === this.snap.guides[i].o
        && guide.p === this.snap.guides[i].p
        && guide.color === this.snap.guides[i].color)) return;
    this.markDirty();
    this.set({ guides: next, documents: this.docSummaries() });
    this.pushDocumentMetadata(); // guides change without an engine resync
  }
  /** Keep document-space annotations attached to the same pixels after an Image
   *  Size resample or a Crop/Canvas Size origin shift. The caller has already
   *  committed the geometry edit, so `doc` contains the new bounds. */
  remapDocSpaceAnnotations(scaleX: number, scaleY: number, dx = 0, dy = 0) {
    if (![scaleX, scaleY, dx, dy].every(Number.isFinite)) return;
    const mapX = (x: number) => this.clampDocX(Math.round(x * scaleX + dx));
    const mapY = (y: number) => this.clampDocY(Math.round(y * scaleY + dy));
    const guides = normalizeGuides(this.snap.guides.map((guide) => ({
      ...guide,
      p: guide.o === "v" ? guide.p * scaleX + dx : guide.p * scaleY + dy,
    })));
    this.set({
      guides,
      notes: this.snap.notes.map((note) => ({ ...note, x: mapX(note.x), y: mapY(note.y) })),
      colorSamplers: this.snap.colorSamplers.map((point) => ({ x: mapX(point.x), y: mapY(point.y) })),
    });
    this.pushDocumentMetadata();
  }
  /** View ▸ Clear Guides: remove all guides. */
  clearGuides() {
    if (this.snap.guides.length) this.setGuides([]);
  }
  /** View ▸ New Guides From Shape: guides at the active selection's edges. */
  guidesFromShape() {
    const b = Array.from(this.engine.e.selection_bounds()); // [x, y, w, h]
    if (b[2] <= 0 || b[3] <= 0) return;
    this.setGuides([...this.snap.guides,
      { o: "v", p: b[0], color: DEFAULT_GUIDE_COLOR }, { o: "v", p: b[0] + b[2], color: DEFAULT_GUIDE_COLOR },
      { o: "h", p: b[1], color: DEFAULT_GUIDE_COLOR }, { o: "h", p: b[1] + b[3], color: DEFAULT_GUIDE_COLOR }]);
    this.set({ showGuides: true });
  }
  // ── View ▸ Proof Colors / Proof Setup / Gamut Warning ──────────────
  // Soft-proofing is a display-only transform applied in EngineClient.blit
  // (it never touches the engine's real output, so save/export are unaffected).
  private currentProofOptions(): ProofOptions {
    return {
      simulatePaperColor: this.snap.proofSimulatePaperColor,
      simulateBlackInk: this.snap.proofSimulateBlackInk,
      blackPointCompensation: this.snap.proofBpc,
      // Color Settings ▸ Working Spaces ▸ CMYK. Its dot gain and ink limit are
      // what make an uncoated stock proof differently from a coated one; the
      // proof used to assume one press, so the setting rendered nothing (#488).
      press: cmykWorkingSpace(this.snap.colorPolicyPrefs.workingCmyk),
    };
  }
  /** View ▸ Proof Setup ▸ X: select the proof and enable Proof Colors.
   *  `preserveNumbers` is store-side only (it changes how the LUT is baked),
   *  so it rides alongside the display ProofOptions instead of inside them. */
  setProof(mode: string, options?: ProofOptions & { preserveNumbers?: boolean }) {
    const nextOptions: ProofOptions = options
      ? {
          simulatePaperColor: !!options.simulatePaperColor,
          simulateBlackInk: !!options.simulateBlackInk,
          // BPC defaults on (Photoshop's proof-setup default) when unspecified.
          blackPointCompensation: options.blackPointCompensation ?? true,
          press: cmykWorkingSpace(this.snap.colorPolicyPrefs.workingCmyk),
        }
      : this.currentProofOptions();
    this.set({
      proofMode: mode,
      proofOn: true,
      proofSimulatePaperColor: !!nextOptions.simulatePaperColor,
      proofSimulateBlackInk: !!nextOptions.simulateBlackInk,
      proofBpc: !!nextOptions.blackPointCompensation,
      proofPreserveNumbers: !!(options?.preserveNumbers ?? this.snap.proofPreserveNumbers),
    });
    this.engine.setProof(mode, true, nextOptions);
    this.refreshIccProof();
    this.engine.blit();
  }
  /** View ▸ Proof Colors (⌘Y): toggle the configured proof on/off. */
  toggleProofColors() {
    const on = !this.snap.proofOn;
    this.set({ proofOn: on });
    this.engine.setProof(this.snap.proofMode, on, this.currentProofOptions());
    this.refreshIccProof();
    this.engine.blit();
  }
  /** View ▸ Gamut Warning: toggle display-only out-of-gamut overlay. */
  toggleOnionSkin() {
    this.set({ onionSkin: !this.snap.onionSkin });
  }
  toggleGamutWarning() {
    const on = !this.snap.gamutWarningOn;
    this.set({ gamutWarningOn: on });
    this.engine.setGamutWarning(on);
    this.refreshIccProof();
    this.engine.blit();
  }
  /** View ▸ Pixel Aspect Ratio ▸ X: assign document metadata and enable its
   *  display correction. Stored pixels are not resampled. */
  setPixelAspect(ratio: number) {
    const next = normalizePixelAspectRatio(ratio);
    if (next === this.snap.pixelAspect && this.snap.pixelAspectCorrection) return;
    this.set({ pixelAspect: next, pixelAspectCorrection: true });
    this.markDocDirty(this.activeDocId);
  }
  /** View ▸ Pixel Aspect Ratio Correction: toggle the display stretch. */
  togglePixelAspectCorrection() {
    this.set({ pixelAspectCorrection: !this.snap.pixelAspectCorrection });
    this.markDocDirty(this.activeDocId);
  }
  /** Save a named ratio into the application catalog and assign it to the doc. */
  savePixelAspectPreset(name: string, ratio: number) {
    const presets = savePixelAspectPresetTo(this.snap.pixelAspectPresets, name, ratio);
    this.set({ pixelAspectPresets: presets });
    this.persistPixelAspectPresets(presets);
    const saved = presets.find((preset) => preset.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
    if (saved) this.setPixelAspect(saved.ratio);
  }
  deletePixelAspectPreset(name: string) {
    const presets = deletePixelAspectPresetFrom(this.snap.pixelAspectPresets, name);
    if (presets.length === this.snap.pixelAspectPresets.length) return;
    this.set({ pixelAspectPresets: presets });
    this.persistPixelAspectPresets(presets);
  }
  /** Reset: Append restores missing defaults and preserves custom values; Replace
   *  discards the current catalog and restores only the defaults. */
  resetPixelAspectPresets(mode: "append" | "replace") {
    const presets = resetPixelAspectPresetsFrom(this.snap.pixelAspectPresets, mode === "append");
    this.set({ pixelAspectPresets: presets });
    this.persistPixelAspectPresets(presets);
  }
  private persistPixelAspectPresets(presets: readonly PixelAspectPreset[]): boolean {
    return this.persistAuthoredContent("mv.pixelAspectPresets", JSON.stringify(presets), "pixel aspect presets");
  }
  loadPixelAspectPresets() {
    try {
      const saved = localStorage.getItem("mv.pixelAspectPresets");
      if (saved != null) this.set({ pixelAspectPresets: normalizePixelAspectPresets(JSON.parse(saved)) });
    } catch { /* storage may be unavailable */ }
  }
  // ── Image ▸ Analysis: Ruler + Count tools ──────────────────────
  /** The Ruler tool's measurement line (doc-space), or null to clear it. */
  setRulerLine(line: AppSnapshot["rulerLine"]) {
    this.set({ rulerLine: line });
  }
  /** Count tool: drop a numbered marker. */
  addCountPoint(x: number, y: number) {
    this.set({ countPoints: [...this.snap.countPoints, { x: Math.round(x), y: Math.round(y) }], showCount: true });
  }
  /** Count tool: remove the last marker (Alt-click / undo gesture). */
  removeLastCountPoint() {
    if (this.snap.countPoints.length) this.set({ countPoints: this.snap.countPoints.slice(0, -1) });
  }
  /** Reset the count markers. */
  clearCountPoints() {
    if (this.snap.countPoints.length) this.set({ countPoints: [] });
  }
  /** View ▸ Show ▸ Count: toggle the count markers' visibility. */
  toggleShowCount() {
    this.set({ showCount: !this.snap.showCount });
  }
  /** Color Sampler tool: drop a sample point, clamped to the canvas (Photoshop
   *  keeps samplers inside the image). Caps at 10 (#1..#10) — clicks past the cap
   *  are ignored. Positions only — colour is read live. */
  addColorSampler(x: number, y: number) {
    const next = addSampler(this.snap.colorSamplers, this.clampDocX(x), this.clampDocY(y));
    if (next !== this.snap.colorSamplers) this.set({ colorSamplers: next, showSamplers: true });
  }
  /** Color Sampler tool: Alt-click removes the single nearest sample point. */
  removeNearestColorSampler(x: number, y: number) {
    const next = removeNearestSampler(this.snap.colorSamplers, x, y);
    if (next !== this.snap.colorSamplers) this.set({ colorSamplers: next });
  }
  /** Color Sampler tool: drag a sample point to a new position (clamped). */
  moveColorSampler(i: number, x: number, y: number) {
    const next = moveSampler(this.snap.colorSamplers, i, this.clampDocX(x), this.clampDocY(y));
    if (next !== this.snap.colorSamplers) this.set({ colorSamplers: next });
  }
  private clampDocX(x: number): number {
    return Math.max(0, Math.min(this.snap.doc.width - 1, x));
  }
  private clampDocY(y: number): number {
    return Math.max(0, Math.min(this.snap.doc.height - 1, y));
  }
  private commitNoteState(patch: Partial<Pick<AppSnapshot, "notes" | "activeNoteId" | "nextNoteId" | "showNotes">>) {
    this.markDirty();
    this.set({ ...patch, documents: this.docSummaries() });
  }

  // ── Note tool (annotations) ────────────────────────────────────
  /** Drop a note at (x,y), clamped to the canvas, stamped with the current
   *  author. It becomes the active note. Returns the new note's id. */
  addNote(x: number, y: number): number {
    const id = this.snap.nextNoteId;
    this.commitNoteState({
      notes: addNote(this.snap.notes, id, this.clampDocX(x), this.clampDocY(y), this.snap.noteAuthor),
      activeNoteId: id,
      nextNoteId: id + 1,
      showNotes: true,
    });
    return id;
  }
  /** Merge imported PDF/FDF annotations into the active document in one state
   *  update. IDs remain monotonic and the shared persistence bounds still apply. */
  importNotes(imported: readonly ImportedNote[]): number {
    const available = Math.max(0, MAX_PERSISTED_NOTES - this.snap.notes.length);
    if (!available || !imported.length) return 0;

    const additions: Note[] = [];
    const used = new Set(this.snap.notes.map((note) => note.id));
    let id = nextNoteIdAfter(this.snap.notes, this.snap.nextNoteId);
    for (const note of imported) {
      while (id <= MAX_NOTE_ID && used.has(id)) id++;
      if (id > MAX_NOTE_ID || additions.length >= available) break;
      additions.push({
        id,
        x: this.clampDocX(note.x),
        y: this.clampDocY(note.y),
        text: note.text,
        author: note.author,
      });
      used.add(id++);
    }
    const notes = normalizeNotes([...this.snap.notes, ...additions]);
    const added = notes.length - this.snap.notes.length;
    if (added <= 0) return 0;
    const activeNoteId = notes[notes.length - 1].id;
    this.commitNoteState({
      notes,
      activeNoteId,
      nextNoteId: nextNoteIdAfter(notes, id),
      showNotes: true,
    });
    return added;
  }
  /** Make `id` the active note (clicking a note icon, or the panel arrows). */
  selectNote(id: number) {
    if (id !== this.snap.activeNoteId) this.set({ activeNoteId: id });
  }
  /** Edit a note's annotation text. */
  setNoteText(id: number, text: string) {
    const next = setNoteTextById(this.snap.notes, id, text);
    if (next !== this.snap.notes) this.commitNoteState({ notes: next });
  }
  /** Options bar Author — stamped on notes created from now on. */
  setNoteAuthor(author: string) {
    if (author !== this.snap.noteAuthor) this.set({ noteAuthor: author });
  }
  /** Drag a note icon to a new position (clamped to the canvas). */
  moveNote(id: number, x: number, y: number) {
    const next = moveNoteById(this.snap.notes, id, this.clampDocX(x), this.clampDocY(y));
    if (next !== this.snap.notes) this.commitNoteState({ notes: next });
  }
  /** Delete one note (Alt-click / panel Delete). The selection falls back to the
   *  last remaining note, or to none (0). */
  deleteNote(id: number) {
    const next = removeNoteById(this.snap.notes, id);
    if (next === this.snap.notes) return;
    const activeNoteId = this.snap.activeNoteId === id ? (next.length ? next[next.length - 1].id : 0) : this.snap.activeNoteId;
    this.commitNoteState({ notes: next, activeNoteId });
  }
  /** Options bar ▸ Clear All: remove every note. */
  clearNotes() {
    if (this.snap.notes.length) this.commitNoteState({ notes: [], activeNoteId: 0 });
  }
  /** View ▸ Show ▸ Notes: toggle the on-canvas note icons. */
  toggleShowNotes() {
    this.set({ showNotes: !this.snap.showNotes });
  }

  // ── Swatches panel ─────────────────────────────────────────────
  /** Save a colour (hex) as a swatch; a duplicate is ignored. */
  addSwatch(hex: string) {
    const next = addSwatchTo(this.snap.swatches, hex);
    if (next !== this.snap.swatches) { this.set({ swatches: next }); this.saveSwatches(); }
  }
  /** Remove the swatch at index `i`. */
  removeSwatch(i: number) {
    const next = removeSwatchAt(this.snap.swatches, i);
    if (next !== this.snap.swatches) { this.set({ swatches: next }); this.saveSwatches(); }
  }
  /** Merge imported colours (e.g. from an .aco file) into the library, in order,
   *  skipping duplicates. Returns how many new swatches were actually added. */
  importSwatches(hexes: string[]): number {
    let next = this.snap.swatches;
    for (const h of hexes) next = addSwatchTo(next, h);
    const added = next.length - this.snap.swatches.length;
    if (added > 0) { this.set({ swatches: next }); this.saveSwatches(); }
    return added;
  }
  /** Persist the swatch library so reusable colours survive across sessions
   *  (a local CC-Libraries analog). */
  private saveSwatches(): boolean {
    return this.persistAuthoredContent("mv.swatches", JSON.stringify(this.snap.swatches), "swatches");
  }
  /** Restore the saved swatch library from localStorage (called once at boot). */
  loadSwatches() {
    try {
      const list = parseSwatches(localStorage.getItem("mv.swatches"));
      if (list) this.set({ swatches: list });
    } catch { /* ignore */ }
  }
  // ── Timeline (keyframe motion graphics) ─────────────────────────
  /** Capture the active layer's current opacity + offset as a keyframe at `t`s. */
  timelineAddKey(t: number) {
    const id = this.snap.activeLayerId;
    if (!id) return;
    const e = this.engine.e;
    const off = e.layer_offset(id);
    const key: TimelineKey = { layerId: id, t: clampPlayhead(t, this.snap.timeline.durationS), opacity: e.layer_opacity(id), dx: off[0] ?? 0, dy: off[1] ?? 0 };
    this.set({ timeline: { ...this.snap.timeline, keys: upsertKey(this.snap.timeline.keys, key) } });
  }
  timelineDeleteKey(i: number) {
    this.set({ timeline: { ...this.snap.timeline, keys: this.snap.timeline.keys.filter((_, j) => j !== i) } });
  }
  timelineSetFps(fps: number) {
    this.set({ timeline: { ...this.snap.timeline, fps: Math.max(1, Math.min(60, Math.round(fps))) } });
  }
  timelineSetDuration(durationS: number) {
    const next = Math.max(0.1, Math.min(60, durationS));
    // Shortening the duration moves the playhead inside it. Keys past the new
    // end stay — Restore / a later lengthening still has them.
    this.set({
      timeline: { ...this.snap.timeline, durationS: next },
      playhead: clampPlayhead(this.snap.playhead, next),
    });
  }
  timelineSetPlayhead(t: number) {
    this.set({ playhead: clampPlayhead(t, this.snap.timeline.durationS) });
  }
  /** Bake the keyframe animation into the frame list (restoring each layer's
   *  live opacity/offset afterwards) so Export GIF / Export Video renders the
   *  motion. Returns the number of frames rendered. */
  timelineRender(): number {
    const { fps, durationS, keys } = this.snap.timeline;
    if (!keys.length) return 0;
    const e = this.engine.e;
    const ids = timelineLayerIds(keys);
    const base = ids.map((id) => ({ id, op: e.layer_opacity(id), off: e.layer_offset(id) }));
    const n = Math.max(1, Math.round(durationS * fps));
    e.clear_frames();
    for (let f = 0; f < n; f++) {
      const t = f / fps;
      for (const id of ids) {
        const s = sampleTimeline(keys, id, t);
        if (!s) continue;
        // (#84) Baking is history-neutral. set_layer_opacity is undoable and
        // coalesces only consecutive edits of the same layer, so with ≥2
        // animated layers every frame pushed two full-document snapshots —
        // a 5s@12fps render evicted the user's whole undo history.
        this.withoutHistoryStep(() => e.set_layer_opacity(id, s.opacity));
        e.set_layer_offset(id, s.dx, s.dy); // untracked by contract
      }
      e.bake_frame();
    }
    for (const b of base) { this.withoutHistoryStep(() => e.set_layer_opacity(b.id, b.op)); e.set_layer_offset(b.id, b.off[0] ?? 0, b.off[1] ?? 0); }
    this.engine.commit();
    return n;
  }
  // ── Brushes panel ──────────────────────────────────────────────
  /** Save the current brush settings as a preset (auto-named "Brush N"). */
  addBrushPreset() {
    const names = this.snap.brushPresets.map((p) => p.name);
    const preset: BrushPreset = { name: defaultBrushPresetName(names), brush: { ...this.snap.brush } };
    const next = addBrushPresetTo(this.snap.brushPresets, preset);
    if (next !== this.snap.brushPresets) { this.set({ brushPresets: next }); this.saveBrushPresets(); }
  }
  /** Remove the brush preset at index `i`. */
  removeBrushPreset(i: number) {
    const next = removeBrushPresetAt(this.snap.brushPresets, i);
    if (next !== this.snap.brushPresets) {
      const active = this.snap.activeBrushPreset;
      this.set({
        brushPresets: next,
        activeBrushPreset: active === i ? -1 : active > i ? active - 1 : active,
      });
      this.saveBrushPresets();
    }
  }
  /** Tool Presets: snapshot the current tool + brush + foreground colour. */
  addToolPreset() {
    const names = this.snap.toolPresets.map((p) => p.name);
    const preset: ToolPreset = {
      name: defaultToolPresetName(names),
      tool: this.snap.tool,
      brush: { ...this.snap.brush },
      fg: { ...this.snap.fg },
    };
    const next = addToolPresetTo(this.snap.toolPresets, preset);
    if (next !== this.snap.toolPresets) { this.set({ toolPresets: next }); this.saveToolPresets(); }
  }
  removeToolPreset(i: number) {
    const next = removeToolPresetAt(this.snap.toolPresets, i);
    if (next !== this.snap.toolPresets) { this.set({ toolPresets: next }); this.saveToolPresets(); }
  }
  /** Select the preset's tool and restore its brush + foreground colour. */
  applyToolPreset(i: number) {
    const preset = this.snap.toolPresets[i];
    if (!preset) return;
    this.setTool(preset.tool);
    this.setBrush(preset.brush);
    this.setForeground(preset.fg);
  }
  /** Gradients panel: save the current ramp as a preset (auto-named "Gradient N"). */
  addGradientPreset() {
    const names = this.snap.gradientPresets.map((p) => p.name);
    const preset: GradientPreset = { name: defaultGradientPresetName(names), stops: this.snap.gradientStops.map((s) => ({ ...s })) };
    const next = addGradientPresetTo(this.snap.gradientPresets, preset);
    if (next !== this.snap.gradientPresets) { this.set({ gradientPresets: next }); this.saveGradientPresets(); }
  }
  removeGradientPreset(i: number) {
    const next = removeGradientPresetAt(this.snap.gradientPresets, i);
    if (next !== this.snap.gradientPresets) { this.set({ gradientPresets: next }); this.saveGradientPresets(); }
  }
  /** Load the preset's stops into the live gradient ramp. */
  applyGradientPreset(i: number) {
    const preset = this.snap.gradientPresets[i];
    if (!preset) return;
    this.setOptions({ gradientStops: preset.stops.map((s) => ({ ...s })) });
  }
  /** The live ramp as the shared cross-app gradient model — what Artisan (and a
   *  `.monetgfx` gradient paint) reads. Reverse is baked into the stop order. */
  gradientValue(): GradientValue {
    return toGradientValue(this.snap.gradientStops, this.snap.gradientType, this.snap.gradientReverse, this.snap.gradientForeign);
  }
  /** Load a gradient from the shared model (an Artisan paint, a dropped document)
   *  into the live ramp, parking the geometry Vision has no UI for so it rides
   *  back out unchanged. An empty stop list is refused rather than blanking the tool. */
  setGradientValue(gv: GradientValue) {
    const stops: GradientStop[] = [...gv.stops]
      .sort((a, b) => a.offset - b.offset)
      .map((s) => {
        let stop: GradientStop;
        if (typeof s.color === "string") stop = stopFromHex(s.offset, s.color);
        else {
          const [r, g, b, a] = hsvToRgba(s.color);
          stop = { pos: s.offset, r, g, b, a };
        }
        return s.midpoint == null ? stop : { ...stop, midpoint: s.midpoint };
      });
    if (!stops.length) return;
    this.setOptions({
      gradientStops: stops,
      gradientType: gv.type,
      gradientReverse: false, // the incoming order already is the drawn order
      gradientForeign: gradientForeignOf(gv),
    });
  }
  /** Gradient tool ▸ Noise: fill the ramp with a fresh seeded noise gradient.
   *  Each call reseeds (Randomize); roughness controls the colour-band count. */
  noiseGradient() {
    const seed = this.snap.gradientNoiseSeed >>> 0;
    this.setOptions({
      gradientStops: noiseGradientStops(seed, this.snap.gradientNoiseRoughness),
      gradientNoiseSeed: (seed + 0x9e3779b1) >>> 0, // next Randomize gets a new ramp
    });
  }
  // ── Preset Manager (Edit ▸ Presets) ─────────────────────────────
  /** Move a swatch by `delta` positions (persisted like the rest of the list). */
  reorderSwatch(index: number, delta: number) {
    const next = moveItem(this.snap.swatches, index, delta);
    if (next !== this.snap.swatches) { this.set({ swatches: next }); this.saveSwatches(); }
  }
  reorderBrushPreset(index: number, delta: number) {
    const active = this.snap.brushPresets[this.snap.activeBrushPreset];
    const next = moveItem(this.snap.brushPresets, index, delta);
    if (next !== this.snap.brushPresets) {
      this.set({ brushPresets: next, activeBrushPreset: active ? next.indexOf(active) : -1 });
      this.saveBrushPresets();
    }
  }
  renameBrushPreset(index: number, name: string) {
    const next = renamePresetAt(this.snap.brushPresets, index, name);
    if (next !== this.snap.brushPresets) { this.set({ brushPresets: next }); this.saveBrushPresets(); }
  }
  reorderToolPreset(index: number, delta: number) {
    const next = moveItem(this.snap.toolPresets, index, delta);
    if (next !== this.snap.toolPresets) { this.set({ toolPresets: next }); this.saveToolPresets(); }
  }
  renameToolPreset(index: number, name: string) {
    const next = renamePresetAt(this.snap.toolPresets, index, name);
    if (next !== this.snap.toolPresets) { this.set({ toolPresets: next }); this.saveToolPresets(); }
  }
  reorderGradientPreset(index: number, delta: number) {
    const next = moveItem(this.snap.gradientPresets, index, delta);
    if (next !== this.snap.gradientPresets) { this.set({ gradientPresets: next }); this.saveGradientPresets(); }
  }
  renameGradientPreset(index: number, name: string) {
    const next = renamePresetAt(this.snap.gradientPresets, index, name);
    if (next !== this.snap.gradientPresets) { this.set({ gradientPresets: next }); this.saveGradientPresets(); }
  }
  // Preset Manager ▸ Load… — merge an imported library into the live one,
  // renaming collisions (mergeNamed), persist, and report how many arrived.
  // Swatches and Styles already have importSwatches / importStylePresets.
  importBrushPresets(list: BrushPreset[]): number {
    this.set({ brushPresets: mergeNamed(this.snap.brushPresets, list) }); // appends, so the active index still points at the same preset
    this.saveBrushPresets();
    return list.length;
  }
  importToolPresets(list: ToolPreset[]): number {
    this.set({ toolPresets: mergeNamed(this.snap.toolPresets, list) });
    this.saveToolPresets();
    return list.length;
  }
  importGradientPresets(list: GradientPreset[]): number {
    this.set({ gradientPresets: mergeNamed(this.snap.gradientPresets, list) });
    this.saveGradientPresets();
    return list.length;
  }
  importCustomShapes(list: CustomShape[]): number {
    this.set({ customShapes: mergeNamed(this.snap.customShapes, list) });
    this.saveCustomShapes();
    return list.length;
  }
  /** The live library for a Preset Manager category — what Save Set… writes.
   *  Swatches are hex strings; every other category is a named-preset list. */
  presetsFor(cat: PresetCategory): readonly unknown[] {
    switch (cat) {
      case "swatches": return this.snap.swatches;
      case "brushes": return this.snap.brushPresets;
      case "tools": return this.snap.toolPresets;
      // (#3) Both callers plain-JSON.stringify this, and a Uint16Array tile
      // stringifies to an index-keyed object that parsePatterns drops on load —
      // hand back the base64 `px` wire form the reader validates.
      case "patterns": return JSON.parse(serializePatterns(this.snap.patternPresets)) as unknown[];
      case "gradients": return this.snap.gradientPresets;
      case "styles": return this.snap.stylePresets;
      case "shapes": return this.snap.customShapes;
    }
  }
  reorderStylePreset(index: number, delta: number) {
    const next = moveItem(this.snap.stylePresets, index, delta);
    if (next !== this.snap.stylePresets) { this.set({ stylePresets: next }); this.saveStylePresets(); }
  }
  renameStylePreset(index: number, name: string) {
    const next = renamePresetAt(this.snap.stylePresets, index, name);
    if (next !== this.snap.stylePresets) { this.set({ stylePresets: next }); this.saveStylePresets(); }
  }
  /** Persist the brush/tool/gradient-preset libraries so they survive across sessions
   *  (mirrors saveSwatches; Photoshop keeps presets between launches). */
  private saveBrushPresets(): boolean {
    return this.persistAuthoredContent("mv.brushPresets", JSON.stringify(this.snap.brushPresets), "brush presets");
  }
  /** Custom brush tips are user-authored pixel data, so they persist like the
   *  preset libraries do — a tip defined from a selection used to vanish on reload. */
  private saveBrushTips(): boolean {
    return this.persistAuthoredContent("mv.brushTips", JSON.stringify(serializeBrushTips(this.snap.brushTips)), "custom brush tips");
  }
  private reportBrushTipLimit() {
    this.engine.onEditError?.(`Could not add the custom brush tip because the library is limited to ${MAX_BRUSH_TIPS} tips, ${MAX_BRUSH_TIP_SIDE} pixels per side, and ${MAX_BRUSH_TIP_LIBRARY_BYTES / 1024 / 1024} MB.`);
  }
  private saveToolPresets(): boolean {
    return this.persistAuthoredContent("mv.toolPresets", JSON.stringify(this.snap.toolPresets), "tool presets");
  }
  private saveGradientPresets(): boolean {
    return this.persistAuthoredContent("mv.gradientPresets", JSON.stringify(this.snap.gradientPresets), "gradient presets");
  }
  private saveStylePresets(): boolean {
    return this.persistAuthoredContent("mv.stylePresets", JSON.stringify(this.snap.stylePresets), "style presets");
  }
  /** Restore the saved brush/tool/gradient-preset libraries from localStorage (once at boot). */
  loadBrushPresets() {
    try { const list = parseBrushPresets(localStorage.getItem("mv.brushPresets")); if (list) this.set({ brushPresets: list, activeBrushPreset: -1 }); } catch { /* ignore */ }
  }
  loadBrushTips() {
    try { const list = parseBrushTips(localStorage.getItem("mv.brushTips")); if (list) this.set({ brushTips: list, activeBrushTip: -1 }); } catch { /* ignore */ }
  }
  loadToolPresets() {
    try { const list = parseToolPresets(localStorage.getItem("mv.toolPresets")); if (list) this.set({ toolPresets: list }); } catch { /* ignore */ }
  }
  loadGradientPresets() {
    try { const list = parseGradientPresets(localStorage.getItem("mv.gradientPresets")); if (list) this.set({ gradientPresets: list }); } catch { /* ignore */ }
  }
  loadStylePresets() {
    try { const list = parseStylePresets(localStorage.getItem("mv.stylePresets")); if (list) this.set({ stylePresets: list }); } catch { /* ignore */ }
  }
  /** Make the preset at index `i` the active brush (reuses setBrush). */
  applyBrushPreset(i: number) {
    const preset = this.snap.brushPresets[i];
    if (!preset) return;
    this.set({ activeBrushPreset: i });
    this.setBrush(preset.brush);
  }
  /** Photoshop comma/period navigation through the Brushes preset library.
   *  Shift requests the first/last preset instead of one adjacent step. */
  navigateBrushPresets(direction: -1 | 1, endpoint = false) {
    const i = brushPresetNavigationIndex(
      this.snap.activeBrushPreset,
      this.snap.brushPresets.length,
      direction,
      endpoint,
    );
    if (i >= 0) this.applyBrushPreset(i);
  }

  // ── Edit ▸ Define Brush Preset (custom tip bitmaps) ────────────
  /** Capture the selection (or whole active layer) as a custom brush tip, add it
   *  to the runtime tip library, and make it the active tip. No-op when the
   *  capture is empty (e.g. an empty layer with no selection). */
  defineBrushPreset() {
    const e = this.engine.e;
    e.define_brush_from_selection();
    if (!e.has_brush_tip()) return;
    const tip: BrushTip = {
      name: defaultBrushTipName(this.snap.brushTips.map((t) => t.name)),
      w: e.brush_tip_w(),
      h: e.brush_tip_h(),
      alpha: e.brush_tip_bytes(),
    };
    const next = addBrushTipTo(this.snap.brushTips, tip);
    if (next === this.snap.brushTips) {
      this.reportBrushTipLimit();
      const active = this.snap.brushTips[this.snap.activeBrushTip];
      if (active) e.set_brush_tip(active.w, active.h, active.alpha);
      e.set_brush_tip_active(!!active);
      return;
    }
    this.set({ brushTips: next, activeBrushTip: next.indexOf(tip) });
    this.saveBrushTips();
    e.set_brush_tip_active(true);
  }
  /** Make the tip at index `i` the active brush tip (pushes its bytes + enables
   *  the tip paint path). Out-of-range is ignored. */
  selectBrushTip(i: number) {
    const tip = this.snap.brushTips[i];
    if (!tip) return;
    const e = this.engine.e;
    e.set_brush_tip(tip.w, tip.h, tip.alpha);
    e.set_brush_tip_active(true);
    this.set({ activeBrushTip: i });
  }
  /** Revert to the procedural round brush (no custom tip). */
  selectRoundBrush() {
    this.engine.e.set_brush_tip_active(false);
    this.set({ activeBrushTip: -1 });
  }
  /** Remove the tip at index `i`, fixing up the active-tip index (the active tip
   *  going away reverts to the round brush). */
  removeBrushTip(i: number) {
    const next = removeBrushTipAt(this.snap.brushTips, i);
    if (next === this.snap.brushTips) return;
    const active = activeAfterRemove(this.snap.activeBrushTip, i);
    this.set({ brushTips: next, activeBrushTip: active });
    this.saveBrushTips();
    if (active < 0) this.engine.e.set_brush_tip_active(false);
  }

  // ── Edit ▸ Define Custom Shape ─────────────────────────────────
  /** Capture the current Pen path as a reusable custom shape (normalized to its
   *  bounding box) and select it for the Shape tool. No-op when there is no path
   *  with at least a triangle; returns the new shape's index, or -1. */
  defineCustomShape(): number {
    const path = this.snap.penPath;
    if (!isValidPath(path)) return -1;
    const name = defaultCustomShapeName(this.snap.customShapes.map((s) => s.name));
    const next = [...this.snap.customShapes, { name, path: normalizePath(path) }];
    this.set({ customShapes: next, activeCustomShape: next.length - 1, shapeKind: "custom" });
    this.saveCustomShapes();
    return next.length - 1;
  }
  /** Options bar: pick which defined custom shape the Shape tool draws. */
  setActiveCustomShape(i: number) {
    if (i >= 0 && i < this.snap.customShapes.length && i !== this.snap.activeCustomShape) {
      this.set({ activeCustomShape: i });
    }
  }
  /** Delete a defined custom shape, keeping activeCustomShape pointed sensibly. */
  removeCustomShape(i: number) {
    const active = this.snap.customShapes[this.snap.activeCustomShape];
    const next = removeCustomShapeAt(this.snap.customShapes, i);
    if (next === this.snap.customShapes) return;
    const followed = next.indexOf(active); // -1 when the active shape was the one removed
    const activeCustomShape = followed >= 0 ? followed : Math.max(0, Math.min(this.snap.activeCustomShape, next.length - 1));
    this.set({ customShapes: next, activeCustomShape });
    this.saveCustomShapes();
  }
  /** Preset Manager: reorder a custom shape; the active pointer follows its shape. */
  reorderCustomShape(index: number, delta: number) {
    const active = this.snap.customShapes[this.snap.activeCustomShape];
    const next = moveItem(this.snap.customShapes, index, delta);
    if (next === this.snap.customShapes) return;
    this.set({ customShapes: next, activeCustomShape: Math.max(0, next.indexOf(active)) });
    this.saveCustomShapes();
  }
  renameCustomShape(index: number, name: string) {
    const next = renamePresetAt(this.snap.customShapes, index, name);
    if (next !== this.snap.customShapes) { this.set({ customShapes: next }); this.saveCustomShapes(); }
  }
  /** Preset Manager ▸ Restore Defaults: put back every built-in shape the library
   *  is missing (deleted, or never seen because a saved library replaced them).
   *  Returns how many arrived; 0 when the library is already complete. */
  restoreDefaultCustomShapes(): number {
    const next = withBuiltinCustomShapes(this.snap.customShapes);
    if (next === this.snap.customShapes) return 0;
    const added = next.length - this.snap.customShapes.length; // before set(), which swaps the snapshot
    this.set({ customShapes: next });
    this.saveCustomShapes();
    return added;
  }
  private saveCustomShapes(): boolean {
    return this.persistAuthoredContent("mv.customShapes", JSON.stringify(this.snap.customShapes), "custom shapes");
  }
  loadCustomShapes() {
    try {
      const list = parseCustomShapes(localStorage.getItem("mv.customShapes"));
      if (list) this.set({ customShapes: list, activeCustomShape: 0 });
    } catch { /* ignore */ }
  }
  /** Options bar ▸ Clear: remove all sample points. */
  clearColorSamplers() {
    if (this.snap.colorSamplers.length) this.set({ colorSamplers: [] });
  }
  /** Toggle the on-canvas sampler markers' visibility. */
  toggleShowSamplers() {
    this.set({ showSamplers: !this.snap.showSamplers });
  }
  /** Image ▸ Analysis ▸ Set Measurement Scale: `px` pixels = `units` <unit>. */
  setMeasureScale(px: number, units: number, unit: string) {
    if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(units) || units <= 0) return;
    const next = normalizeMeasureScale({ px, units, unit });
    const current = this.snap.measureScale;
    if (next.px === current.px && next.units === current.units && next.unit === current.unit) return;
    this.markDirty();
    this.set({ measureScale: next, documents: this.docSummaries() });
  }
  setMeasureScalePresets(value: unknown) {
    const presets = normalizeMeasureScalePresets(value);
    this.set({ measureScalePresets: presets });
    this.persistAuthoredContent("mv.measureScalePresets", JSON.stringify(presets), "measurement scale presets");
  }
  loadMeasureScalePresets() {
    try {
      const saved = localStorage.getItem("mv.measureScalePresets");
      if (saved != null) this.set({ measureScalePresets: normalizeMeasureScalePresets(JSON.parse(saved)) });
    } catch { /* storage may be unavailable */ }
  }
  /** Convert a pixel length to the calibrated logical unit. */
  pxToUnits(lengthPx: number): number {
    const s = this.snap.measureScale;
    return (lengthPx / s.px) * s.units;
  }
  /** Image ▸ Analysis ▸ Record Measurements: log the current ruler line (length
   *  in calibrated units + angle) and the count-marker total. */
  recordMeasurement() {
    const r = this.snap.rulerLine;
    const lengthPx = r ? Math.hypot(r.x1 - r.x0, r.y1 - r.y0) : 0;
    const angle = r ? (Math.atan2(-(r.y1 - r.y0), r.x1 - r.x0) * 180) / Math.PI : 0;
    const entry = {
      n: this.snap.measurements.length + 1,
      lengthPx: Math.round(lengthPx * 100) / 100,
      lengthUnits: Math.round(this.pxToUnits(lengthPx) * 1000) / 1000,
      angle: Math.round(angle * 100) / 100,
      count: this.snap.countPoints.length,
    };
    this.set({ measurements: [...this.snap.measurements, entry] });
  }
  clearMeasurements() {
    if (this.snap.measurements.length) this.set({ measurements: [] });
  }
  /** Image ▸ Analysis ▸ Select Data Points: choose which Measurement Log columns show. */
  setDataPoints(dp: Partial<AppSnapshot["dataPoints"]>) {
    this.set({ dataPoints: { ...this.snap.dataPoints, ...dp } });
  }
  // ── Slices ──────────────────────────────────────────────────────
  /** Layer ▸ New Layer Based Slice: a slice covering the active layer's content. */
  newLayerBasedSlice() {
    const b = Array.from(this.engine.e.active_layer_bounds()); // [x, y, w, h]
    if (b[2] <= 0 || b[3] <= 0) return;
    this.set({ slices: [...this.snap.slices, { x: b[0], y: b[1], w: b[2], h: b[3] }], showSlices: true, selectedSlice: this.snap.slices.length });
  }
  /** Slice tool: add a user slice from a drag rect; it becomes the selected slice. */
  addSliceRect(x0: number, y0: number, x1: number, y1: number) {
    const s = sliceFromDrag(x0, y0, x1, y1);
    if (s.w < 1 || s.h < 1) return; // a click (no drag) draws nothing
    this.set({ slices: addSlice(this.snap.slices, s), showSlices: true, selectedSlice: this.snap.slices.length });
  }
  /** Slice Select tool: set the edited slice index (-1 = none; out-of-range → -1). */
  selectSlice(i: number) {
    const v = i >= 0 && i < this.snap.slices.length ? i : -1;
    if (v !== this.snap.selectedSlice) this.set({ selectedSlice: v });
  }
  /** Slice Select tool: replace the selected slice's geometry (move/resize drag).
   *  Blocked while slices are locked. */
  setSelectedSliceGeom(s: Slice) {
    const i = this.snap.selectedSlice;
    if (this.snap.slicesLocked || i < 0 || i >= this.snap.slices.length) return;
    const next = this.snap.slices.slice();
    next[i] = { x: Math.round(s.x), y: Math.round(s.y), w: Math.max(1, Math.round(s.w)), h: Math.max(1, Math.round(s.h)) };
    this.set({ slices: next });
  }
  /** Slice Select tool: delete the selected slice (Delete/Backspace). Blocked while locked. */
  deleteSelectedSlice() {
    const i = this.snap.selectedSlice;
    if (this.snap.slicesLocked || i < 0 || i >= this.snap.slices.length) return;
    this.set({ slices: deleteSlice(this.snap.slices, i), selectedSlice: -1 });
  }
  /** View ▸ Clear Slices (blocked while slices are locked). */
  clearSlices() {
    if (!this.snap.slicesLocked && this.snap.slices.length) this.set({ slices: [], selectedSlice: -1 });
  }
  /** View ▸ Show ▸ Slices. */
  toggleShowSlices() {
    this.set({ showSlices: !this.snap.showSlices });
  }
  /** View ▸ Lock Slices. */
  toggleLockSlices() {
    this.set({ slicesLocked: !this.snap.slicesLocked });
  }
  // Photoshop "History States": clamp 1–1000, push it to the engine cap (which
  // trims the oldest undo entries), then resync so the History panel's timeline +
  // current index come from the engine (not a stale TS slice of the combined list).
  setHistoryStates(n: number) {
    const v = Math.max(HISTORY_STATES_MIN, Math.min(HISTORY_STATES_MAX, Math.round(n) || HISTORY_STATES_MIN));
    this.set({ historyStates: v });
    try { localStorage.setItem("mv.historyStates", String(v)); } catch { /* storage may be unavailable */ }
    if (this.engine.engine) {
      this.engine.engine.set_history_states(v);
      this.engine.sync();
    }
  }
  /** History panel flyout ▸ History Options. Persisted like History States. */
  setHistoryOptions(patch: Partial<HistoryOptions>) {
    const next = normalizeHistoryOptions({ ...this.snap.historyOptions, ...patch });
    this.set({ historyOptions: next });
    try { localStorage.setItem("mv.historyOptions", JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  }

  setPanelOptions(patch: Partial<PanelOptions>) {
    const panelOptions = normalizePanelOptions({ ...this.snap.panelOptions, ...patch });
    if (!this.persistAuthoredContent("mv.panelOptions", JSON.stringify(panelOptions), "panel options")) return false;
    this.set({ panelOptions, panelOptionsError: "" });
    return true;
  }

  // ── Preferences ▸ History Log ────────────────────────────────
  // Photoshop's edit audit trail: every state that lands on the timeline, plus
  // the session events around it (opened, saved), timestamped.
  // ponytail: no "Save Log Items To: Metadata / Text File / Both" radio. The
  // engine's DocMetadata carries no history field, so "Metadata" could not embed
  // anything — the pane exports a text file instead. Add `history` to DocMetadata
  // (raster/mod.rs) and the target choice becomes real.

  /** Preferences ▸ History Log. Persisted like History Options. */
  setHistoryLog(patch: Partial<HistoryLogPrefs>) {
    const next = normalizeHistoryLog({ ...this.snap.historyLog, ...patch });
    this.set({ historyLog: next });
    try { localStorage.setItem("mv.historyLog", JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  }
  clearHistoryLog() {
    this.set({ historyLogEntries: [] });
  }
  /** The log as a text file's worth of lines (the pane's Save Log…). */
  historyLogText(): string {
    return this.snap.historyLogEntries.join("\n");
  }
  /** A session event (opened / saved) — logged at every Edit Log Items level. */
  private logHistorySession(text: string) {
    if (!this.snap.historyLog.enabled) return;
    this.set({ historyLogEntries: appendHistoryLog(this.snap.historyLogEntries, [historyLogLine(new Date(), text)]) });
  }

  // ── documents (multi-document file manager) ──────────────────
  // New/Open create a *new* document tab; switching tabs swaps the active
  // wasm Engine and restores that document's view state. Always ≥1 open doc.

  private docSummaries(): DocSummary[] {
    return this.docs.map((d) => ({ id: d.id, name: d.name, dirty: d.dirty, hasFile: !!d.savedPath }));
  }
  /** Names of every open document with unsaved changes, in tab order. Drives the
   *  quit / window-close guard: closing a TAB has always prompted, but quitting
   *  discarded every unsaved document silently. (#54) */
  dirtyDocNames(): string[] {
    return this.docs.filter((d) => d.dirty).map((d) => d.name);
  }
  /** Each open document's composited PNG (for File ▸ Automate ▸ PDF Presentation). */
  eachDocPng(): Uint8Array[] {
    return this.docs.map((d) => { try { return d.engine.export_png(); } catch { return new Uint8Array(); } });
  }
  private activeEntry(): DocEntry | undefined {
    return this.docs.find((d) => d.id === this.activeDocId);
  }
  /** Tag the active document with the generation settings that produced it. */
  stampGenMeta(meta: GenerateOpts) {
    const d = this.activeEntry();
    if (d) d.genMeta = meta;
  }
  /** The active document's generation settings (null for non-generated docs). */
  activeGenMeta(): GenerateOpts | null {
    return this.activeEntry()?.genMeta ?? null;
  }
  private dirtyEntry(entry: DocEntry) {
    const wasClean = !entry.dirty;
    entry.contentRevision += 1;
    entry.dirty = true;
    entry.pristineBlank = false;
    // The tab '*', the Window menu, the Document Browser dot and the close
    // prompt all read the PUBLISHED summary. An engine commit republishes it
    // through syncFromEngine, but a metadata-only edit (File Info, Assign
    // Profile's same-profile ICC swap) never syncs — so publish the transition
    // here, once per clean→dirty flip rather than on every later edit.
    if (wasClean) this.set({ documents: this.docSummaries() });
  }
  private noteStateForEngine(eng: Engine, notes?: Note[] | null, activeNoteId = 0, nextNoteId?: number): { notes: Note[]; activeNoteId: number; nextNoteId: number } {
    const maxX = Math.max(0, eng.width() - 1);
    const maxY = Math.max(0, eng.height() - 1);
    const normalized = cloneNotes(notes ?? []).map((note) => ({
      ...note,
      x: Math.max(0, Math.min(maxX, note.x)),
      y: Math.max(0, Math.min(maxY, note.y)),
    }));
    const active = normalized.some((note) => note.id === activeNoteId)
      ? activeNoteId
      : normalized.length ? normalized[normalized.length - 1].id : 0;
    return { notes: normalized, activeNoteId: active, nextNoteId: nextNoteIdAfter(normalized, nextNoteId) };
  }
  openDocIds(): number[] {
    return this.docs.map((d) => d.id);
  }
  docName(id: number): string | null {
    return this.docs.find((d) => d.id === id)?.name ?? null;
  }
  docDirty(id: number): boolean {
    return this.docs.find((d) => d.id === id)?.dirty ?? false;
  }
  /** Snapshot document metadata. Project encoders may borrow immutable RAW
   * bytes with `copyCameraRawBytes: false` only for immediate synchronous use. */
  docDocumentMeta(
    id: number,
    options: { includeCameraRaw?: boolean; copyCameraRawBytes?: boolean } = {},
  ): ProjectDocumentMeta | null {
    const d = this.docs.find((x) => x.id === id);
    if (!d) return null;
    this.syncCameraRawRecipeFromEngine(d);
    const notes = cloneNotes(id === this.activeDocId ? this.snap.notes : d.notes);
    const layerComps = cloneLayerComps(id === this.activeDocId ? this.snap.layerComps : d.layerComps);
    const guides = cloneGuides(id === this.activeDocId ? this.snap.guides : d.guides);
    const savedPaths = normalizeSavedPaths(id === this.activeDocId ? this.snap.savedPaths : d.savedPaths);
    const duotone = this.docDuotone(id);
    return {
      colorProfileAssigned: id === this.activeDocId ? this.snap.colorProfileAssigned : d.colorProfileAssigned,
      ...(Object.keys(d.captureMetadata ?? {}).length ? { captureMetadata: { ...d.captureMetadata } } : {}),
      iccProfileBytes: cloneIccProfileBytes(id === this.activeDocId ? this.snap.iccProfileBytes : d.iccProfileBytes),
      iccProfileName: normalizeCustomProfileName(id === this.activeDocId ? this.snap.iccProfileName : d.iccProfileName),
      resolutionPpi: id === this.activeDocId ? this.snap.resolutionPpi : d.resolutionPpi,
      pixelAspect: id === this.activeDocId ? this.snap.pixelAspect : d.pixelAspect,
      pixelAspectCorrection: id === this.activeDocId ? this.snap.pixelAspectCorrection : d.pixelAspectCorrection,
      measureScale: { ...(id === this.activeDocId ? this.snap.measureScale : d.measureScale) },
      ...(notes.length ? { notes } : {}),
      ...(layerComps.length ? { layerComps } : {}),
      ...(guides.length ? { guides } : {}),
      ...(savedPaths.length ? { savedPaths } : {}),
      // The inks live only here: the engine keeps the ink layer's LUT, not them.
      ...(duotone ? { duotone: { inks: duotone.inks, overprints: duotone.overprints, ...(duotone.overprintSpecs ? { overprintSpecs: duotone.overprintSpecs } : {}) } } : {}),
      ...((id === this.activeDocId ? this.snap : d).variables?.length || (id === this.activeDocId ? this.snap : d).dataSets?.length ? { variableData: normalizeVariableData(id === this.activeDocId ? this.snap : d) } : {}),
      // Custom tips are a global library rather than per-document, but a .mvision
      // that paints with a tip is useless without it, so it travels with the file.
      ...(this.snap.brushTips.length ? { brushTips: this.snap.brushTips.map((t) => ({ ...t })) } : {}),
      ...(options.includeCameraRaw === false || !d.cameraRaw
        ? {}
        : {
          cameraRaw: options.copyCameraRawBytes === false
            ? normalizeCameraRawSource(d.cameraRaw, { copyBytes: false })!
            : cloneCameraRawSource(d.cameraRaw),
        }),
      ...(options.includeCameraRaw === false || !d.cameraRaw || d.cameraRawLayerId === null
        ? {}
        : { cameraRawLayerId: d.cameraRawLayerId }),
    };
  }
  docProjectBytes(id: number): Uint8Array | null {
    const d = this.docs.find((x) => x.id === id);
    if (!d) return null;
    return this.engine.projectBytes(d.engine);
  }
  layerKindInDoc(docId: number, layerId: number): number | null {
    const d = this.docs.find((x) => x.id === docId);
    if (!d) return null;
    try { return d.engine.layer_kind(layerId); } catch { return null; }
  }
  mutateDocEngine(docId: number, mutate: (engine: Engine) => boolean): boolean {
    const d = this.docs.find((x) => x.id === docId);
    if (!d) return false;
    // Capture both sides: cancel/commit closes the transaction during `mutate`,
    // while begin opens it. Either transition is preview bookkeeping, not an
    // independently dirtying document edit.
    const transactionBefore = historyTransactionActive(d.engine);
    const changed = mutate(d.engine);
    if (!changed) return false;
    const historyNeutral = transactionBefore || historyTransactionActive(d.engine);
    if (docId === this.activeDocId) {
      if (historyNeutral) this.engine.refreshFromEngine();
      else this.engine.commit();
    } else if (!historyNeutral) {
      this.dirtyEntry(d);
      this.set({ documents: this.docSummaries() });
    } else {
      d.displayRevision += 1;
      this.bump();
    }
    this.notifyVectorFontTargetsChanged();
    return true;
  }
  vectorFontStacksForOpenDocs(): string[] {
    const stacks = new Set<string>();
    for (const d of this.docs) {
      let layerCount = 0;
      try {
        layerCount = d.engine.layer_count();
      } catch {
        continue;
      }

      for (let i = 0; i < layerCount; i++) {
        try {
          const layerId = d.engine.layer_id_at(i);
          if (d.engine.layer_kind(layerId) === LAYER_KIND.text) {
            const spec = JSON.parse(d.engine.layer_text_spec(layerId)) as TextSpec;
            for (const font of [spec.font, ...spec.runs.flatMap((run) => [run.font, run.face ? JSON.stringify(run.face) : undefined])]) {
              if (font) stacks.add(font);
            }
            continue;
          }
          if (d.engine.layer_kind(layerId) !== LAYER_KIND.vector) continue;
          for (const stack of vectorFontStacksFromSceneJson(d.engine.vector_scene_json(layerId))) {
            stacks.add(stack);
          }
        } catch {
          // Ignore malformed or stale vector-layer scene data; provisioning is best-effort.
        }
      }
    }
    return [...stacks].sort((a, b) => a.localeCompare(b));
  }
  /** Font provisioning changes the shared WASM vector-font registry, not the
   *  document itself. Refresh every open document's vector cache without marking
   *  tabs dirty or creating history entries. */
  refreshVectorFontsForOpenDocs() {
    for (const d of this.docs) {
      try {
        d.engine.refreshVectorFonts();
      } catch {
        // Older generated bindings or no vector layers.
      }
      d.displayRevision += 1;
    }
    this.engine.refreshFromEngine();
  }
  private notifyVectorFontTargetsChanged() {
    try {
      this.onVectorFontTargetsChanged?.();
    } catch (e) {
      console.warn("Vector font target notification failed:", e);
    }
  }
  /** True when a flat opened image may become a layer in the current document.
   *  The untouched launch/New blank is intentionally excluded because Open
   *  should replace it, matching the existing first-open tab behavior. */
  canOpenImageAsLayer(): boolean {
    const a = this.activeEntry();
    return !!a && !(this.docs.length === 1 && a.pristineBlank && !a.dirty);
  }
  /** Disambiguate a display name against the other open documents (Photoshop
   *  style: "Untitled", "Untitled-2", …) — the title-bar identifies tabs by
   *  their (now unique) string. */
  private uniqueName(raw: string): string {
    const base = raw || "Untitled";
    if (!this.docs.some((d) => d.name === base)) return base;
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    for (let n = 2; ; n++) {
      const cand = `${stem}-${n}${ext}`;
      if (!this.docs.some((d) => d.name === cand)) return cand;
    }
  }
  /** Save the active document's live view state back into its entry before we
   *  switch away from it. */
  private captureActiveView() {
    // Leaving the active document: drop any pending live-edit frame so a queued
    // requestAnimationFrame can't re-apply against the document we're switching to.
    this.cancelLive();
    // Best-effort cleanup on the engine we are LEAVING. If it refuses (a failed
    // export can leave one unusable), that is no reason to abandon the switch
    // half-done and strand the user on a document they cannot leave or close.
    try { this.engine.engine?.end_prop_edit(); } catch { /* the outgoing view is gone anyway */ }
    const a = this.activeEntry();
    if (!a) return;
    a.zoom = this.snap.zoom;
    a.panX = this.snap.panX;
    a.panY = this.snap.panY;
    a.rotationAngle = this.snap.rotationAngle;
    a.historyLabels = this.snap.history;
    a.colorProfileAssigned = this.snap.colorProfileAssigned;
    a.iccProfileBytes = cloneIccProfileBytes(this.snap.iccProfileBytes);
    a.iccProfileName = normalizeCustomProfileName(this.snap.iccProfileName);
    a.notes = cloneNotes(this.snap.notes);
    a.activeNoteId = this.snap.activeNoteId;
    a.nextNoteId = this.snap.nextNoteId;
    a.layerComps = cloneLayerComps(this.snap.layerComps);
    a.layerColorLabels = { ...this.snap.layerColorLabels };
    a.guides = cloneGuides(this.snap.guides);
    a.resolutionPpi = this.snap.resolutionPpi;
    a.pixelAspect = this.snap.pixelAspect;
    a.pixelAspectCorrection = this.snap.pixelAspectCorrection;
    a.measureScale = { ...this.snap.measureScale };
    a.savedPaths = normalizeSavedPaths(this.snap.savedPaths);
    Object.assign(a, normalizeVariableData(this.snap));
    a.penPath = [...this.snap.penPath];
    a.penAnchors = [...this.snap.penAnchors];
    a.penContours = [...this.snap.penContours];
    a.vanishingPointPlanes = clonePlanes(this.snap.vanishingPointPlanes);
    a.vanishingPointActivePlane = this.snap.vanishingPointActivePlane;
    a.vanishingPointSource = this.snap.vanishingPointSource;
    a.duotone = this.snap.duotone;
    a.timeline = cloneTimeline(this.snap.timeline);
    a.playhead = this.snap.playhead;
  }

  /** Finalize transient edits before a document switch. Camera Raw runs this
   * before taking its adoption checkpoint, so rollback restores a coherent
   * post-edit document instead of resurrecting UI state for an ended engine
   * session or a Type Mask layer that no longer exists. */
  private finalizeActiveDocumentForAdoption(): boolean {
    let completed = true;
    this.cancelLiquify();
    this.cancelVanishingPoint();
    try {
      if (this.snap.paintSymmetryTransforming) this.commitPaintSymmetryTransform();
    } catch (error) {
      // commitPaintSymmetryTransform clears the transient pointer before its
      // repaint/sync. Keep the committed document conservative and coherent if
      // that notification path fails, then let the caller abort adoption.
      this.paintSymmetryTransformStart = null;
      if (this.snap.paintSymmetryTransforming) this.set({ paintSymmetryTransforming: false });
      this.markDocDirty(this.activeDocId);
      console.error("Could not finalize the paint-symmetry transform before switching documents:", error);
      completed = false;
    }
    try {
      this.captureActiveView();
    } catch (error) {
      console.error("Could not capture the active document before switching documents:", error);
      completed = false;
    }
    try {
      this.endTextEdit();
    } catch (error) {
      // A Type Mask conversion may already have changed engine content. Never
      // retain UI pointers to that ended session; the post-finalization
      // checkpoint below becomes the coherent rollback boundary.
      this.maskTypeId = null;
      if (this.snap.textEdit) this.set({ textEdit: null });
      this.markDocDirty(this.activeDocId);
      console.error("Could not finalize text editing before switching documents:", error);
      completed = false;
    }
    return completed;
  }

  private documentAdoptionCheckpoint(): DocumentAdoptionCheckpoint {
    return {
      docs: [...this.docs],
      activeDocId: this.activeDocId,
      nextDocId: this.nextDocId,
      snapshot: this.snap,
      activeEngine: this.engine.engine,
      clipboardProfileMetaByDoc: new Map(this.clipboardProfileMetaByDoc),
      snapshotsByDoc: new Map(this.snapshotsByDoc),
    };
  }

  /** Restore the exact published document/store state when a fallible adoption
   * fails. The staged engine remains owned by its caller and can then be freed. */
  private restoreDocumentAdoption(checkpoint: DocumentAdoptionCheckpoint) {
    this.docs = checkpoint.docs;
    this.activeDocId = checkpoint.activeDocId;
    this.nextDocId = checkpoint.nextDocId;
    this.clipboardProfileMetaByDoc = checkpoint.clipboardProfileMetaByDoc;
    this.snapshotsByDoc = checkpoint.snapshotsByDoc;

    const onSync = this.engine.onSync;
    this.engine.onSync = null;
    try {
      if (checkpoint.activeEngine) this.engine.activate(checkpoint.activeEngine);
      else {
        this.engine.engine = null;
        this.engine.width = 0;
        this.engine.height = 0;
      }
    } catch (error) {
      // Keep ownership and routing correct even if repainting the restored
      // engine fails; the next regular sync can repair the canvas surface.
      this.engine.engine = checkpoint.activeEngine;
      if (checkpoint.activeEngine) {
        try {
          this.engine.width = checkpoint.activeEngine.width();
          this.engine.height = checkpoint.activeEngine.height();
        } catch {
          this.engine.width = 0;
          this.engine.height = 0;
        }
      }
      console.error("Could not repaint the restored document after a failed adoption:", error);
    } finally {
      this.engine.onSync = onSync;
    }
    this.snap = checkpoint.snapshot;
    for (const listener of this.listeners) {
      try { listener(); }
      catch (error) { console.error("Could not notify a listener after restoring a failed document adoption:", error); }
    }
  }

  /** Adopt a freshly built Engine as a new document tab and make it active. */
  private addDoc(
    eng: Engine,
    rawName: string,
    fit: boolean,
    pristineBlank: boolean,
    colorProfileAssigned = true,
    iccProfileBytes?: Uint8Array | null,
    iccProfileName?: string | null,
    notes?: Note[] | null,
    layerComps?: LayerComp[] | null,
    activeNoteId = 0,
    nextNoteId?: number,
    pixelAspect = 1,
    pixelAspectCorrection = true,
    resolutionPpi = DEFAULT_DOCUMENT_RESOLUTION_PPI,
    guides?: Guide[] | null,
    measureScale?: MeasureScale | null,
  ) {
    if (!this.finalizeActiveDocumentForAdoption()) {
      throw new Error("Could not finalize the active document before adoption");
    }
    // Replace a lone, untouched blank document instead of stacking a tab onto
    // it — so the boot "Untitled" doesn't linger after the first real open.
    const evict = this.docs.length === 1 && this.docs[0].pristineBlank && !this.docs[0].dirty
      ? this.docs[0] : null;
    if (evict) {
      this.clipboardProfileMetaByDoc.delete(evict.id);
      this.revertUndo.delete(evict.id);
      this.forgetDocSnapshots(evict.id);
      this.docs = this.docs.filter((d) => d !== evict);
    }
    const name = this.uniqueName(rawName);
    const noteState = this.noteStateForEngine(eng, notes, activeNoteId, nextNoteId);
    // Canvas geometry can make a valid guide temporarily off-canvas. Preserve
    // that position across tabs and reopen instead of clamping only on load.
    const guideState = normalizeGuides(guides);
    const scaleState = normalizeMeasureScale(measureScale);
    const entry: DocEntry = {
      id: this.nextDocId++, engine: eng, name, savedPath: null,
      zoom: 1, panX: 0, panY: 0, rotationAngle: 0, historyLabels: [], dirty: false, contentRevision: 0, displayRevision: 0, pristineBlank,
      colorProfileAssigned,
      iccProfileBytes: cloneIccProfileBytes(iccProfileBytes),
      iccProfileName: normalizeCustomProfileName(iccProfileName),
      notes: cloneNotes(noteState.notes),
      activeNoteId: noteState.activeNoteId,
      nextNoteId: noteState.nextNoteId,
      layerComps: cloneLayerComps(layerComps ?? []),
      layerColorLabels: {},
      guides: cloneGuides(guideState),
      resolutionPpi: normalizeDocumentResolutionPpi(resolutionPpi),
      pixelAspect: normalizePixelAspectRatio(pixelAspect),
      pixelAspectCorrection,
      measureScale: { ...scaleState },
      savedPaths: [],
      ...emptyVariableData(),
      penPath: [],
      penAnchors: [],
      penContours: [],
      vanishingPointPlanes: defaultVanishingPointPlanes(eng.width(), eng.height()),
      vanishingPointActivePlane: 0,
      vanishingPointSource: null,
      duotone: null,
      timeline: { ...DEFAULT_TIMELINE, keys: [] },
      playhead: 0,
      cameraRaw: null,
      cameraRawLayerId: null,
    };
    this.docs.push(entry);
    this.activeDocId = entry.id;
    // Seed the per-doc view fields; the engine sync below preserves them (it
    // only merges width/height) and rebuilds layers/selection/undo state.
    this.set({
      doc: { ...this.snap.doc, name },
      zoom: 1,
      panX: 0,
      panY: 0,
      rotationAngle: 0,
      history: [],
      snapshots: [], // a fresh document starts with no History Snapshots
      maskEdit: false,
      maskView: "off",
      quickMask: false,
      colorProfileAssigned,
      iccProfileBytes: cloneIccProfileBytes(iccProfileBytes),
      iccProfileName: normalizeCustomProfileName(iccProfileName),
      notes: cloneNotes(noteState.notes),
      activeNoteId: noteState.activeNoteId,
      nextNoteId: noteState.nextNoteId,
      layerComps: cloneLayerComps(layerComps ?? []),
      layerColorLabels: {}, // colour tags are per document (#144): a fresh tab starts untagged
      guides: cloneGuides(guideState),
      resolutionPpi: entry.resolutionPpi,
      pixelAspect: entry.pixelAspect,
      pixelAspectCorrection: entry.pixelAspectCorrection,
      measureScale: { ...scaleState },
      // Paths belong to the document: a fresh tab starts with an empty Paths
      // panel instead of inheriting the one we just switched away from.
      savedPaths: [],
      ...emptyVariableData(),
      penPath: [],
      penAnchors: [],
      penContours: [],
      vanishingPointPlanes: clonePlanes(entry.vanishingPointPlanes),
      vanishingPointActivePlane: 0,
      vanishingPointSource: null,
      // The inks belong to the document they were set on; left in place they
      // made the next opened file save as that document's Duotone.
      duotone: null,
      timeline: { ...DEFAULT_TIMELINE, keys: [] },
      playhead: 0,
    });
    this.applyBlendGamma(eng); // before the first blit, so it shows the right blend
    this.engine.activate(eng);
    this.set({ history: [] });
    if (fit) this.fit();
    this.pushBrush();
    // Each document owns a fresh engine (default 50 states); re-apply the chosen
    // History States so the preference persists across New/Open and tab switches.
    this.engine.engine?.set_history_states(this.snap.historyStates);
    // History Options ▸ Automatically Create First Snapshot: every document gets a
    // checkpoint of its untouched opened state, named after the document.
    if (this.snap.historyOptions.autoFirstSnapshot) this.snapshotDoc(entry.id, name);
    this.logHistorySession(`File opened: ${name}`);
    // The blank tab this open replaced is gone. Free it now that the new engine
    // is the active one (#539).
    if (evict) this.releaseEngine(evict.engine);
    this.notifyVectorFontTargetsChanged();
  }

  /** Attach a document's saved paths to the tab addDoc just made active (same
   *  post-adoption idiom as the Camera Raw provenance below). */
  private adoptSavedPaths(paths: SavedPath[] | null | undefined) {
    const entry = this.activeEntry();
    if (!entry || !paths?.length) return;
    entry.savedPaths = normalizeSavedPaths(paths);
    this.set({ savedPaths: normalizeSavedPaths(entry.savedPaths) });
  }

  newDocument(
    width: number,
    height: number,
    name = "Untitled",
    bg: BgContents = "white",
    pixelAspect = 1,
    options: { resolutionPpi?: number; colorMode?: number; colorProfile?: number; pristineBlank?: boolean } = {},
  ) {
    const eng = this.engine.buildNew(width, height);
    const requestedMode = options.colorMode ?? 0;
    const colorMode = Number.isInteger(requestedMode) && requestedMode >= 0 && requestedMode <= 4 ? requestedMode : 0;
    const colorProfile = colorMode === 0 ? clampProfile(options.colorProfile ?? (this.docs.length ? 0 : this.snap.colorProfile)) : 0;
    const homeProfile = !this.docs.length && colorMode === 0 && colorProfile === this.snap.colorProfile;
    const icc = homeProfile ? this.snap.iccProfileBytes : null;
    const iccName = homeProfile ? this.snap.iccProfileName : null;
    // The engine's new document is opaque white by default, so only Background
    // Color (fill) and Transparent (clear) need work; White is a no-op.
    if (bg !== "white") {
      const [r, g, b] = hsvToRgba(this.snap.bg);
      const fill = bgFill(bg, r, g, b);
      // A rect selection (not select_all, which is an *inactive* whole-canvas
      // marker) so clear_selection has an active region to clear to transparent.
      eng.select_rect(0, 0, eng.width(), eng.height(), 0);
      if (fill) eng.fill_selection(fill.r, fill.g, fill.b, fill.a);
      else eng.clear_selection();
      eng.select_none();
    }
    if (colorMode === 1) eng.convert_grayscale();
    else eng.set_mode(colorMode);
    eng.assign_profile(colorProfile);
    if (icc) eng.setDocumentIcc(icc, iccName ?? "");
    eng.purge();
    eng.set_history_source();
    this.addDoc(
      eng,
      name,
      true,
      options.pristineBlank === true,
      true,
      icc,
      iccName,
      null,
      null,
      0,
      undefined,
      pixelAspect,
      true,
      normalizeDocumentResolutionPpi(options.resolutionPpi),
    );
    this.onDocumentEvent?.("newDocument");
  }
  /** `event`: what Photoshop raises for this adoption — Open for a file, New
   *  for a generated document, nothing for a command like Split Channels. */
  openImage(bytes: Uint8Array, name: string, event: ScriptEventId | null = "openDocument") {
    this.addDoc(this.engine.buildImage(bytes), name, true, false);
    this.captureImageMetadata(bytes);
    if (event) this.onDocumentEvent?.(event);
  }
  /** Open headerless Photoshop Raw with the layout its dialog described. */
  openPhotoshopRaw(bytes: Uint8Array, name: string, layout: PhotoshopRawLayout) {
    this.addDoc(this.engine.buildPhotoshopRaw(bytes, layout), name, true, false);
    this.onDocumentEvent?.("openDocument");
  }
  /** Metadata failures never prevent a valid image from opening. */
  captureImageMetadata(bytes: Uint8Array, docId = this.activeDocId) {
    const d = this.docs.find((entry) => entry.id === docId);
    if (!d) return;
    try { d.captureMetadata = normalizeCaptureMetadata(this.engine.captureMetadata(bytes)); }
    catch { d.captureMetadata = {}; }
  }
  /** A loaded document's Convert to Profile separation profile travels in its
   *  engine bytes. If this build cannot use it, the engine keeps the bytes (a
   *  save writes them back) and falls back to the built-in plates — say so. */
  private reportModeProfile(eng: Engine) {
    const problem = eng.mode_profile_error?.();
    if (!problem) return;
    // The engine names the profile by its Convert to Profile role
    // ("Destination ICC profile …"); on reload it is simply the saved profile.
    const reason = problem.replace(/^Destination ICC profile /, "");
    this.engine.onEditError?.(`This document's ${colorModeName(eng.doc_mode())} profile “${eng.mode_profile_name()}” couldn't be used (${reason}); plates use the built-in model until you convert again. The profile is kept in the file.`);
  }
  /** Open an engine as a new tab and restore everything the file recorded that
   *  does NOT live in the engine. Shared by the `.mvision` envelope and the
   *  `.mvis` container, which carry the same ProjectDocumentMeta. */
  private addDocWithMeta(eng: Engine, name: string, document: ProjectDocumentMeta | null) {
    this.reportModeProfile(eng);
    this.addDoc(
      eng,
      name,
      true,
      false,
      document?.colorProfileAssigned ?? true,
      document?.iccProfileBytes ?? null,
      document?.iccProfileName ?? null,
      document?.notes ?? null,
      document?.layerComps ?? null,
      0,
      undefined,
      document?.pixelAspect ?? 1,
      document?.pixelAspectCorrection ?? true,
      document?.resolutionPpi ?? DEFAULT_DOCUMENT_RESOLUTION_PPI,
      document?.guides ?? null,
      document?.measureScale ?? null,
    );
    if (!document) return;
    this.adoptSavedPaths(document.savedPaths);
    this.adoptVariableData(document.variableData);
    const duotone = this.bindDuotone(eng, document.duotone);
    if (duotone) this.set({ duotone });
    // Merge, never replace: opening a file that carries tips must not wipe the
    // library the user already had. Same-named tips from the file are skipped.
    if (document.brushTips?.length) {
      const before = this.snap.brushTips;
      let next = before;
      let refused = false;
      const names = new Set(next.map((t) => t.name));
      for (const tip of document.brushTips) {
        if (names.has(tip.name)) continue;
        const added = addBrushTipTo(next, tip);
        if (added === next) refused = true;
        else { next = added; names.add(tip.name); }
      }
      if (next !== before) { this.set({ brushTips: next }); this.saveBrushTips(); }
      if (refused) this.reportBrushTipLimit();
    }
    const opened = this.activeEntry();
    if (opened) opened.captureMetadata = normalizeCaptureMetadata(document.captureMetadata);
    if (opened && document.cameraRaw) {
      opened.cameraRaw = normalizeCameraRawSource(document.cameraRaw, { copyBytes: false });
      opened.cameraRawLayerId = this.findCameraRawLayerId(opened.engine, document.cameraRawLayerId);
      this.adoptCameraRawProfile(opened);
    }
  }
  openProject(bytes: Uint8Array, name: string) {
    const envelope = decodeProjectEnvelope(bytes);
    this.addDocWithMeta(this.engine.buildProject(envelope?.engineBytes ?? bytes), name, envelope?.document ?? null);
    if (!envelope) { this.onDocumentEvent?.("openDocument"); return; }
    this.adoptProjectEnvelope(this.activeDocId, bytes);
    this.onDocumentEvent?.("openDocument");
  }
  /** Re-bind a `.mvision` envelope's smart links and nested smart-edit sources
   *  after its engine is in place. Open and Revert both go through here, so a
   *  revert cannot keep an in-session relink. */
  adoptProjectEnvelope(docId: number, bytes: Uint8Array) {
    const envelope = decodeProjectEnvelope(bytes);
    if (!envelope) return;
    const parentLayerIds = this.smartLayerIdsForDoc(docId);
    restoreSmartLinksForDoc(docId, envelope.smartLinks, parentLayerIds);
    this.restoreSmartEditSources(docId, envelope.smartEditSources, parentLayerIds);
  }
  /** `document` is the container's own metadata entry — absent on a container
   *  written by another Monet app, or by a Vision old enough to have had nowhere
   *  to record it (#493). */
  openGraphics(bytes: Uint8Array, name: string, document: ProjectDocumentMeta | null = null) {
    this.addDocWithMeta(this.engine.buildGraphics(bytes), name, document);
    this.onDocumentEvent?.("openDocument");
  }
  /** Build a Vision document from a Monet Artisan `.artisan` file: the scene
   *  becomes ONE kind-3 vector layer on a transparent canvas the size of the
   *  active artboard, rasterized on demand by the shared engine. `set_document`
   *  is the same engine entry Artisan itself renders through, and it THROWS on a
   *  malformed scene — so a bad file surfaces an error instead of opening blank.
   *  ponytail: the engine names that layer "Artisan"; naming it after the file
   *  would need an engine-side rename — not worth a shim until someone asks. */
  buildArtisan(bytes: Uint8Array): Engine {
    const scene = parseArtisanScene(bytes);
    const eng = this.engine.buildNew(scene.width, scene.height);
    eng.set_document(scene.json);
    // The scene lives in document world space; pan the artboard's top-left onto
    // the canvas origin so an off-origin artboard isn't cropped out of view.
    if (scene.x || scene.y) eng.vector_set_view(eng.layer_id_at(0), -scene.x, -scene.y, 1, 0);
    eng.set_history_source(); // recapture: buildNew sampled the white background
    return eng;
  }
  openArtisan(bytes: Uint8Array, name: string) {
    this.addDoc(this.buildArtisan(bytes), name, true, false);
    this.onDocumentEvent?.("openDocument");
  }
  saveProject(smartEditSources: PersistedSmartEditSource[] = []): Uint8Array {
    return this.saveProjectForDoc(this.activeDocId, smartEditSources) ?? this.engine.projectBytes();
  }
  /** `commitTransientEdits` (default true) folds a live paint-symmetry draft into
   *  the document before serializing — right for a user-invoked Save/Export, wrong
   *  for the background recovery snapshot, which would otherwise commit a
   *  half-finished axis and kick the user out of the transform mid-drag. (#57) */
  saveProjectForDoc(
    docId: number,
    smartEditSources: PersistedSmartEditSource[] = [],
    { commitTransientEdits = true }: { commitTransientEdits?: boolean } = {},
  ): Uint8Array | null {
    if (commitTransientEdits && docId === this.activeDocId && this.snap.paintSymmetryTransforming) this.commitPaintSymmetryTransform();
    const d = this.docs.find((x) => x.id === docId);
    if (!d) return null;
    const engineBytes = this.engine.projectBytes(d.engine);
    const links = serializeSmartLinksForDoc(docId, this.smartLayerIdsForEngine(d.engine));
    const document = this.docDocumentMeta(docId, { copyCameraRawBytes: false }) ?? { colorProfileAssigned: true };
    return links.length || !document.colorProfileAssigned || !!document.iccProfileBytes?.length || !!document.notes?.length || !!document.layerComps?.length || !!document.guides?.length
      || document.resolutionPpi !== DEFAULT_DOCUMENT_RESOLUTION_PPI
      || document.pixelAspect !== 1 || document.pixelAspectCorrection === false || smartEditSources.length
      || !!document.cameraRaw
      || !!Object.keys(document.captureMetadata ?? {}).length
      || !!document.brushTips?.length
      || !!document.savedPaths?.length
      || !!document.variableData
      || !!document.duotone
      || !isDefaultMeasureScale(normalizeMeasureScale(document.measureScale))
      ? encodeProjectEnvelope(engineBytes, links, document, smartEditSources)
      : engineBytes;
  }
  private smartLayerIdsForDoc(docId: number): Set<number> {
    const d = this.docs.find((x) => x.id === docId);
    return d ? this.smartLayerIdsForEngine(d.engine) : new Set<number>();
  }
  private smartLayerIdsForEngine(e: Engine): Set<number> {
    const ids = new Set<number>();
    for (let i = 0; i < e.layer_count(); i++) {
      const id = e.layer_id_at(i);
      if (e.layer_kind(id) === LAYER_KIND.smartObject) ids.add(id);
    }
    return ids;
  }
  private cameraRawFilterIndex(e: Engine, layerId: number): number | null {
    if (!this.engineHasLayer(e, layerId) || e.layer_kind(layerId) !== LAYER_KIND.smartObject) return null;
    const withFilterId = e as Engine & { smart_filter_id?: (layerId: number, index: number) => number };
    const count = e.smart_filter_count(layerId);
    for (let index = 0; index < count; index++) {
      if (withFilterId.smart_filter_id?.(layerId, index) === 17) return index;
      // Backward-compatible fallback while an older generated wasm binding is
      // active. It is only used for a document that already declares RAW
      // provenance; arbitrary documents are never classified this way.
      if (!withFilterId.smart_filter_id && e.smart_filter_params(layerId, index).length >= 1050) return index;
    }
    return null;
  }
  private findCameraRawLayerId(e: Engine, persistedLayerId?: number): number | null {
    // A persisted owner is authoritative. If it is stale or no longer owns
    // fid-17, do not silently bind the source to some other Camera Raw layer.
    if (persistedLayerId !== undefined) {
      return this.cameraRawFilterIndex(e, persistedLayerId) !== null ? persistedLayerId : null;
    }
    for (let i = 0; i < e.layer_count(); i++) {
      const id = e.layer_id_at(i);
      if (this.cameraRawFilterIndex(e, id) !== null) return id;
    }
    return null;
  }
  private syncCameraRawRecipeFromEngine(d: DocEntry): void {
    if (!d.cameraRaw || d.cameraRawLayerId === null) return;
    const index = this.cameraRawFilterIndex(d.engine, d.cameraRawLayerId);
    if (index === null) return;
    try {
      // Read back through the working seam directly — the persisted source recipe
      // is now the working V2 recipe.
      const next = engineParamsToWorkingRecipe(d.engine.smart_filter_params(d.cameraRawLayerId, index));
      // The params name a DNG profile by digest only; keep the name it goes by.
      next.profile = keepProfileName(next.profile, d.cameraRaw.recipe.profile);
      d.cameraRaw.recipe = next;
    } catch {
      // A malformed engine payload must not destroy the last valid source
      // recipe. The renderer rejects malformed fid-17 tails atomically.
    }
  }
  private engineHasLayer(e: Engine, layerId: number): boolean {
    for (let index = 0; index < e.layer_count(); index++) {
      if (e.layer_id_at(index) === layerId) return true;
    }
    return false;
  }
  private restoreSmartEditSources(parentDocId: number, sources: PersistedSmartEditSource[], parentLayerIds: Set<number>) {
    for (const source of sources) {
      const parentLayerId = Math.trunc(source.parentLayerId);
      if (!parentLayerIds.has(parentLayerId)) continue;
      try {
        this.addDoc(
          this.engine.buildProject(source.engineBytes),
          source.name,
          true,
          false,
          source.document.colorProfileAssigned,
          source.document.iccProfileBytes ?? null,
          source.document.iccProfileName ?? null,
          source.document.notes ?? null,
          source.document.layerComps ?? null,
          0,
          undefined,
          source.document.pixelAspect ?? 1,
          source.document.pixelAspectCorrection ?? true,
          source.document.resolutionPpi ?? DEFAULT_DOCUMENT_RESOLUTION_PPI,
          source.document.guides ?? null,
          source.document.measureScale ?? null,
        );
        const editDocId = this.activeDocId;
        this.adoptSavedPaths(source.document.savedPaths);
        this.adoptVariableData(source.document.variableData);
        const editEntry = this.activeEntry();
        if (editEntry) editEntry.captureMetadata = normalizeCaptureMetadata(source.document.captureMetadata);
        if (editEntry && source.document.cameraRaw) {
          editEntry.cameraRaw = normalizeCameraRawSource(source.document.cameraRaw, { copyBytes: false });
          editEntry.cameraRawLayerId = this.findCameraRawLayerId(editEntry.engine, source.document.cameraRawLayerId);
          this.adoptCameraRawProfile(editEntry);
        }
        setSmartEditBinding({ editDocId, parentDocId, parentLayerId, name: source.name });
        if (source.smartEditSources?.length) {
          this.restoreSmartEditSources(editDocId, source.smartEditSources, this.smartLayerIdsForDoc(editDocId));
        }
        if (source.dirty) this.markDocDirty(editDocId);
      } catch {
        // Ignore stale or malformed source tabs; the parent project remains open.
      }
    }
    this.activateDoc(parentDocId);
  }
  openPsd(bytes: Uint8Array, name: string) {
    // Route .psd through the layered importer (groups, masks, effects, text).
    this.openFormat(bytes, name);
  }
  /** Layered import of PSD / PSB / GIMP XCF (auto-detected by the engine). */
  openFormat(bytes: Uint8Array, name: string) {
    const eng = this.engine.buildFormat(bytes, this.snap.filePrefs.photoshop32BitImport);
    const duotone = this.adoptPhotoshopDuotone(eng);
    this.addDoc(eng, name, true, false);
    this.captureImageMetadata(bytes);
    if (duotone) this.set({ duotone });
    // PSD image resources 2000-2997 and 2999: the file's named paths and clipping path.
    const paths = fromPhotoshopPaths(eng.photoshop_paths_json());
    this.adoptSavedPaths(paths);
    // A save writes only the adopted paths, so say what the open left behind.
    const skipped = eng.photoshop_paths_skipped() + paths.length - normalizeSavedPaths(paths).length;
    if (skipped > 0) {
      this.engine.onEditError?.(`Vision could not open ${skipped} path ${skipped === 1 ? "entry" : "entries"} in ${name} (an open or malformed path, a clipping path that names no path, or paths past the ${MAX_PERSISTED_SAVED_PATHS}-path limit). Saving this document leaves ${skipped === 1 ? "it" : "them"} out of the file.`);
    }
    this.onDocumentEvent?.("openDocument");
  }
  /** A Duotone Photoshop file opens as its gray plate under the ink layer
   *  convertDuotone builds, so Duotone Options re-opens on the file's inks.
   *  Built before the document is adopted: the open stays one clean state,
   *  with the file's own top layer still the one being edited. */
  private adoptPhotoshopDuotone(eng: Engine): DuotoneDoc | null {
    const spec = eng.doc_mode() === 1
      ? decodeDuotoneSpec(eng.photoshop_duotone_spec(), eng.photoshop_duotone_alternates())
      : null;
    if (!spec) return null;
    const active = eng.active_layer_id();
    const layerId = eng.add_adjustment_layer(13, duotoneLutF32(spec.inks, spec.overprints), "Duotone");
    if (!layerId) return null;
    eng.set_active_layer(active);
    eng.purge();
    eng.set_history_source();
    return { ...spec, layerId };
  }
  /** A document's Duotone ink record, only while it still describes the
   *  document: a Grayscale document whose ink layer is still there. An Undo
   *  past Image ▸ Mode ▸ Duotone leaves the record behind with no layer. */
  docDuotone(id: number): DuotoneDoc | null {
    const d = this.docs.find((x) => x.id === id);
    const record = id === this.activeDocId ? this.snap.duotone : d?.duotone ?? null;
    if (!d || !record || d.engine.doc_mode() !== 1 || !this.engineHasLayer(d.engine, record.layerId)) return null;
    const e = d.engine as Engine & { layer_adj_kind?: (id: number) => number };
    return e.layer_kind(record.layerId) === LAYER_KIND.adjustment && e.layer_adj_kind?.(record.layerId) === 13 ? record : null;
  }
  /** Re-attach a saved ink specification to the ink layer of a reopened
   *  document; layer ids do not survive a reload. */
  private bindDuotone(eng: Engine, inks: DuotoneInks | undefined): DuotoneDoc | null {
    const layerId = inks ? this.existingDuotoneLayer(eng) : null;
    return inks && layerId !== null ? { ...inks, layerId } : null;
  }
  /** Decode a RAW into an off-document transaction. No tab/path/history changes
   * happen until completeCameraRawOpen; malformed inputs throw before any state
   * is published, and multiple opens are serialized through the session queue. */
  openRaw(bytes: Uint8Array, name: string, options: OpenCameraRawOptions = {}): string {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_CAMERA_RAW_SOURCE_BYTES) {
      throw new Error("The camera source is empty or exceeds the size limit.");
    }
    if (this.cameraRawSessions.size >= MAX_CAMERA_RAW_PENDING_SESSIONS) {
      throw new Error("Finish a pending Camera Raw workspace before opening another source.");
    }
    let pendingSourceBytes = 0;
    for (const runtime of this.cameraRawSessions.values()) {
      pendingSourceBytes += runtime.state.source?.originalBytes.length ?? 0;
    }
    if (bytes.length > MAX_CAMERA_RAW_PENDING_SOURCE_BYTES - pendingSourceBytes) {
      throw new Error("Pending Camera Raw sources exceed the aggregate size limit.");
    }
    const demosaic = this.snap.filePrefs.rawDemosaic;
    const eng = this.engine.buildRaw(bytes, demosaic);
    let metadata: unknown = {};
    try {
      const getter = (eng as Engine & { raw_metadata_json?: () => string }).raw_metadata_json;
      const json = getter?.call(eng) ?? "";
      if (json) metadata = JSON.parse(json);
    } catch {
      metadata = {};
    }
    const source = normalizeCameraRawSource({
      version: 1,
      originalName: name,
      originalPath: options.originalPath,
      sha256: options.sha256,
      lastModified: options.lastModified,
      originalBytes: bytes,
      metadata: normalizeCameraRawSourceMetadata(metadata),
      // normalizeCameraRawSource migrates/normalizes to the working V2 recipe.
      recipe: options.recipe,
      demosaic,
    });
    if (!source) {
      eng.free();
      throw new Error("The camera source is too large or contains invalid metadata.");
    }
    const sessionId = `camera-raw-${this.nextCameraRawSessionId++}`;
    let resolveCompletion!: RuntimeCameraRawSession["resolveCompletion"];
    const completion = new Promise<Exclude<CameraRawDisposition, "pending">>((resolve) => {
      resolveCompletion = resolve;
    });
    const state: CameraRawSession = {
      sessionId,
      invocation: options.invocation ?? "raw-open",
      disposition: "pending",
      source,
      previousDocumentId: this.activeDocId || undefined,
      sidecarPath: options.sidecarPath,
      startedAt: new Date().toISOString(),
    };
    this.cameraRawSessions.set(sessionId, {
      state, engine: eng, completion, resolveCompletion,
      working: source.recipe,
    });
    this.cameraRawQueue.push(sessionId);
    this.bumpCameraRawSessions();
    this.presentNextCameraRawSession();
    return sessionId;
  }

  private presentNextCameraRawSession() {
    if (this.activeCameraRawSessionId) return;
    while (this.cameraRawQueue.length) {
      const sessionId = this.cameraRawQueue.shift()!;
      const runtime = this.cameraRawSessions.get(sessionId);
      if (!runtime) continue;
      this.activeCameraRawSessionId = sessionId;
      const present = () => this.requestDialog("cameraRaw", { invocation: runtime.state.invocation, sessionId } satisfies CameraRawDialogRequest);
      if (this.snap.cameraRawPrefs.openInCameraRaw) { present(); return; }
      // Preferences ▸ Camera Raw ▸ Show Camera Raw off: open straight into a
      // document with the source's sidecar/default recipe. Deferred so the
      // opener can still wait on the session it was just handed; an opener
      // that settles it first (Batch) wins. A recipe this engine cannot run
      // (Super Resolution) falls back to the workspace.
      queueMicrotask(() => {
        if (this.activeCameraRawSessionId !== sessionId || !this.cameraRawSessions.has(sessionId)) return;
        try {
          const { missing, lensWarning } = this.prepareProfileWith(runtime.working, runtime.state.source);
          const warning = [missing, lensWarning].filter(Boolean).join(" ");
          if (this.completeCameraRawOpen(sessionId, runtime.working, false) === null) present();
          else if (warning) this.engine.onEditError?.(`Opened ${runtime.state.source?.originalName ?? "the raw file"}: ${warning}`);
        } catch (error) {
          this.engine.onEditError?.(`Could not open ${runtime.state.source?.originalName ?? "the raw file"} with its Camera Raw settings (${error instanceof Error ? error.message : String(error)}). Turn on Preferences ▸ Camera Raw ▸ Show Camera Raw to adjust it before opening.`);
        }
      });
      return;
    }
  }

  /** Internal workspace borrow. The dialog must treat source bytes as read-only;
   * public callers use cameraRawSession(), which returns a defensive clone. */
  cameraRawWorkspaceSession(sessionId: string): { source: CameraRawSource; engine: Engine } | null {
    const runtime = this.cameraRawSessions.get(sessionId);
    return runtime?.state.source ? { source: runtime.state.source, engine: runtime.engine } : null;
  }

  cameraRawSession(sessionId: string): { session: CameraRawSession } | null {
    const runtime = this.cameraRawSessions.get(sessionId);
    return runtime ? {
      session: {
        ...runtime.state,
        // External callers get a defensive clone of the source carrying the
        // authoritative working recipe (a fresh copy, so a caller mutating the
        // returned recipe can't reach into the store's live session state).
        source: runtime.state.source
          ? {
            ...cloneCameraRawSource(runtime.state.source),
            recipe: normalizeWorkingRecipe(runtime.working),
          }
          : null,
      },
    } : null;
  }

  /** Bump the reactive session-set revision so the workspace filmstrip
   *  re-renders when a session is added, retired, or activated. */
  private bumpCameraRawSessions() {
    this.set({ cameraRawSessionsRev: this.snap.cameraRawSessionsRev + 1 });
  }

  /** Pending Camera Raw sessions for the filmstrip: the active session first,
   *  then the queued ones, each with its display name. */
  pendingCameraRawSessions(): { sessionId: string; name: string }[] {
    const order: string[] = [];
    if (this.activeCameraRawSessionId) order.push(this.activeCameraRawSessionId);
    for (const id of this.cameraRawQueue) if (!order.includes(id)) order.push(id);
    return order.flatMap((sessionId) => {
      const runtime = this.cameraRawSessions.get(sessionId);
      return runtime?.state.source ? [{ sessionId, name: runtime.state.source.originalName }] : [];
    });
  }

  /** Persist a per-image recipe onto its pending session (filmstrip switching /
   *  Synchronize). Lenient input: routes through normalizeWorkingRecipe, which
   *  accepts the old Canonical schema-2 (migrated) and the new V2 shape. */
  setCameraRawSessionRecipe(sessionId: string, recipe: CameraRawRecipe): boolean {
    const runtime = this.cameraRawSessions.get(sessionId);
    if (!runtime?.state.source) return false;
    runtime.working = normalizeWorkingRecipe(recipe);
    runtime.state.source.recipe = runtime.working;
    return true;
  }

  /** Working (V2) read accessor for the Camera Raw workspace (docs/plans/10 d2c).
   *  Returns the authoritative runtime.working recipe (== source.recipe). */
  cameraRawSessionWorking(sessionId: string): VisionDevelopRecipe | null {
    return this.cameraRawSessions.get(sessionId)?.working ?? null;
  }

  /** Working (V2) write accessor. Normalizes onto runtime.working; source.recipe
   *  is the same working recipe. */
  setCameraRawSessionWorkingRecipe(sessionId: string, working: VisionDevelopRecipe): boolean {
    const runtime = this.cameraRawSessions.get(sessionId);
    if (!runtime?.state.source) return false;
    runtime.working = normalizeWorkingRecipe(working);
    runtime.state.source.recipe = runtime.working;
    return true;
  }

  /** Camera Raw ▸ Demosaic: re-decode a staged RAW with another demosaic and
   *  make it the import preference. The workspace rebuilds its preview from
   *  the new session engine (sessions revision). A decode failure throws and
   *  leaves the session and the preference as they were. */
  setCameraRawSessionDemosaic(sessionId: string, demosaic: RawDemosaic): boolean {
    if (!RAW_DEMOSAICS.includes(demosaic)) {
      throw new Error(`Unknown demosaic "${String(demosaic)}". Use ${RAW_DEMOSAICS.join(" or ")}.`);
    }
    const runtime = this.cameraRawSessions.get(sessionId);
    const source = runtime?.state.source;
    if (!runtime || !source) return false;
    if ((source.demosaic ?? "bilinear") !== demosaic) {
      const eng = this.engine.buildRaw(source.originalBytes, demosaic);
      const previous = runtime.engine;
      runtime.engine = eng;
      source.demosaic = demosaic;
      previous.free();
      this.bumpCameraRawSessions();
    }
    this.setFilePrefs({ rawDemosaic: demosaic });
    return true;
  }

  /** Camera Raw ▸ Profile library (#446): the .dcp files the user loaded,
   *  kept file by file in `storage` (app-data on the desktop, IndexedDB in a
   *  browser). Moves the library older builds kept in localStorage over once,
   *  then lists what is stored. Every develop and resolution waits on
   *  `cameraRawProfilesReady` before calling a profile missing. */
  attachCameraRawProfileStorage(storage: CameraRawProfileStorage): Promise<void> {
    this.cameraRawProfileStorage = storage;
    this.cameraRawProfilesReady = (async () => {
      let legacy: ReturnType<typeof parseCameraRawProfiles> = [];
      try { legacy = parseCameraRawProfiles(localStorage.getItem(CAMERA_RAW_PROFILES_KEY)); } catch { /* storage unavailable */ }
      if (legacy.length) {
        try {
          await Promise.all(legacy.map(({ entry, bytes }) => storage.put(storedProfileFileName(entry), bytes)));
          try { localStorage.removeItem(CAMERA_RAW_PROFILES_KEY); } catch { /* storage unavailable */ }
          legacy = [];
        } catch (error) {
          // Kept where it was for the next launch, and usable in this one.
          this.engine.onEditError?.(`Could not move the Camera Raw profile library out of browser storage (${error instanceof Error ? error.message : String(error)}); it stays there for now.`);
        }
      }
      const stored = [
        ...(await storage.list()),
        ...legacy.map(({ entry, bytes }) => ({ fileName: storedProfileFileName(entry), bytes })),
      ];
      const entries: CameraRawProfileEntry[] = [];
      for (const { fileName, bytes } of stored) {
        let info;
        try { info = parseProfileInfo(this.engine.developProfileInfo(bytes)); } catch { continue; }
        if (info.embedded || entries.some((entry) => entry.digest === info.digest)) continue;
        this.cameraRawProfileBytes.set(info.digest, bytes);
        entries.push({ name: info.name || storedProfileName(fileName), model: info.model, digest: info.digest, origin: "user" });
      }
      const loaded = new Set(entries.map((entry) => entry.digest));
      this.set({ cameraRawProfiles: [...entries, ...this.snap.cameraRawProfiles.filter((entry) => !loaded.has(entry.digest))] });
      this.refreshDevelopProfiles();
    })().catch((error: unknown) => {
      this.engine.onEditError?.(`Could not read the Camera Raw profile library (${error instanceof Error ? error.message : String(error)}).`);
    });
    return this.cameraRawProfilesReady;
  }

  /** Profile ▸ Load Profile…: add a DNG camera profile (.dcp) to the library,
   *  where it is offered for images from the camera it was made for, and
   *  store it. Throws an actionable message, and leaves the library as it
   *  was, for a file that is not one. Loading a profile twice keeps one entry. */
  importCameraRawProfile(fileName: string, bytes: Uint8Array): CameraRawProfileEntry {
    if (bytes.length > MAX_CAMERA_PROFILE_BYTES) {
      throw new Error(`That camera profile is larger than ${MAX_CAMERA_PROFILE_BYTES / (1024 * 1024)} MB.`);
    }
    const info = parseProfileInfo(this.engine.developProfileInfo(bytes));
    if (info.embedded) throw new Error("That is a DNG image, not a camera profile (.dcp). Open it to use its embedded profile.");
    const existing = this.snap.cameraRawProfiles.find((entry) => entry.digest === info.digest && entry.origin === "user");
    if (existing) return existing;
    const others = this.snap.cameraRawProfiles.filter((entry) => entry.digest !== info.digest);
    if (others.filter((entry) => entry.origin === "user").length >= MAX_CAMERA_PROFILES) {
      throw new Error(`The profile library holds up to ${MAX_CAMERA_PROFILES} camera profiles.`);
    }
    const entry: CameraRawProfileEntry = {
      name: info.name || fileName.replace(/^.*[\\/]/, "").replace(/\.dcp$/i, "") || "Custom",
      model: info.model,
      digest: info.digest,
      origin: "user",
    };
    this.cameraRawProfileBytes.set(entry.digest, bytes);
    this.set({ cameraRawProfiles: [...others, entry] });
    const storage = this.cameraRawProfileStorage;
    const kept = storage
      ? storage.put(storedProfileFileName(entry), bytes)
      : Promise.reject(new Error("no profile storage"));
    kept.catch((error: unknown) => {
      this.engine.onEditError?.(`Loaded “${entry.name}”, but could not store it (${error instanceof Error ? error.message : String(error)}) — it is available until Vision quits.`);
    });
    // Layers that rendered Camera Default for want of it show it now.
    this.reportedMissingProfiles.delete(entry.digest);
    this.refreshDevelopProfiles();
    return entry;
  }

  /** Desktop: camera profiles found in Adobe's CameraProfiles folders (see
   *  app.ts findAdobeCameraProfiles). Listed for this launch, not stored. */
  addFoundCameraRawProfiles(found: readonly Uint8Array[]) {
    const added: CameraRawProfileEntry[] = [];
    for (const bytes of found) {
      let info;
      try { info = parseProfileInfo(this.engine.developProfileInfo(bytes)); } catch { continue; }
      if (info.embedded || this.cameraRawProfileBytes.has(info.digest)) continue;
      this.cameraRawProfileBytes.set(info.digest, bytes);
      added.push({ name: info.name || "Camera Profile", model: info.model, digest: info.digest, origin: "adobe" });
    }
    if (added.length) this.set({ cameraRawProfiles: [...this.snap.cameraRawProfiles, ...added] });
  }

  /** The RAW source a develop target's camera profiles come from: its staged
   *  session's, or the document's raw source for its Camera Raw Smart Object.
   *  A Camera Raw Filter on pixels has none, as in ACR. */
  private cameraRawProfileSource(target: CameraRawProfileTarget): CameraRawSource | null {
    if (target.sessionId) return this.cameraRawSessions.get(target.sessionId)?.state.source ?? null;
    const d = this.docs.find((entry) => entry.id === target.documentId);
    return d?.cameraRaw && d.cameraRawLayerId !== null && d.cameraRawLayerId === target.layerId ? d.cameraRaw : null;
  }

  /** The metadata Camera Raw ▸ Profile matches profiles against for a target. */
  cameraRawProfileMetadata(target: CameraRawProfileTarget): CameraRawSourceMetadata | null {
    return this.cameraRawProfileSource(target)?.metadata ?? null;
  }

  /** Lens capture facts apply to pixel documents too, not only RAW Smart Objects. */
  lensMetadata(target: CameraRawProfileTarget = {}): LensMetadata {
    if (target.sessionId) return { ...this.cameraRawSessions.get(target.sessionId)?.state.source?.metadata };
    const d = this.docs.find((entry) => entry.id === (target.documentId ?? this.activeDocId));
    const source = d?.cameraRaw;
    return { ...d?.captureMetadata, ...source?.metadata };
  }

  /** Make the embedded/custom camera profile a develop recipe names renderable:
   *  find it again and hand the engine its tables unless they are already
   *  there. Returns the recipe to develop — its profile pointed at what was
   *  found, at the image's as-shot white — and, when the profile is missing,
   *  why: the develop then renders Camera Default while the recipe keeps its
   *  selection. */
  prepareCameraRawProfile(recipe: VisionDevelopRecipe, target: CameraRawProfileTarget, lensSettings: LensCorrectionSettings = recipe.optics): { recipe: VisionDevelopRecipe; missing: string | null; lensWarning: string | null } {
    return this.prepareProfileWith(recipe, this.cameraRawProfileSource(target), this.lensMetadata(target), lensSettings);
  }

  private prepareProfileWith(recipe: VisionDevelopRecipe, source: CameraRawSource | null, metadata: LensMetadata = source?.metadata ?? {}, lensSettings: LensCorrectionSettings = recipe.optics): { recipe: VisionDevelopRecipe; missing: string | null; lensWarning: string | null } {
    const resolved = recipe.optics.enableProfileCorrections ? resolveLensProfile(metadata, lensSettings) : null;
    const working = resolved || recipe.optics.profileCalibration ? { ...recipe, optics: {
      ...recipe.optics, profileCalibration: resolved?.status === "resolved" ? resolved.calibration : undefined,
    } } : recipe;
    const prepared = this.prepareColorProfileWith(working, source);
    const message = resolved?.status === "missing" ? resolved.message : resolved?.warnings.join(" ");
    // DCP Amount depends on `missing`; an optics warning must not disable it.
    return { ...prepared, lensWarning: message || null };
  }

  private prepareColorProfileWith(recipe: VisionDevelopRecipe, source: CameraRawSource | null): { recipe: VisionDevelopRecipe; missing: string | null } {
    // Presets/Sync/XMP may carry another image's decoder basis. Only this
    // target's RAW source can supply it while preparing a new render; already
    // persisted Smart Filters replay their own V7 params inside the engine.
    if (recipe.profile.sourceCamera) recipe = { ...recipe, profile: { ...recipe.profile, sourceCamera: undefined } };
    const found = resolveCameraRawProfile(recipe.profile, this.snap.cameraRawProfiles, source?.metadata);
    if (found.status === "builtin") return { recipe, missing: null };
    if (found.status === "missing") return { recipe, missing: found.message };
    if (!this.engine.developProfileRegistered(found.digest)) {
      const bytes = this.developProfileBytes(found.digest, source);
      let registered = "";
      try { registered = bytes ? parseProfileInfo(this.engine.registerDevelopProfile(bytes)).digest : ""; } catch { /* reported below */ }
      if (registered !== found.digest) {
        return { recipe, missing: `The camera profile “${found.name}” could not be read — showing Camera Default. Load it again with Load Profile….` };
      }
    }
    const kelvin = asShotKelvin(source?.metadata) ?? recipe.profile.asShotKelvin;
    const sourceCamera = cameraProfileSource(source?.metadata);
    // Old RAW recipes acquire the actual decoder basis here before preview,
    // Open/Object, Revert and smart-filter replay serialize their parameters.
    if (!sourceCamera) {
      const bytes = this.developProfileBytes(found.digest, source);
      if (bytes && parseProfileInfo(this.engine.developProfileInfo(bytes)).matrixOnly) {
        return { recipe: { ...recipe, profile: { ...recipe.profile, sourceCamera: undefined } }, missing: "This matrix-only camera profile needs the original three-channel RAW camera data. Reopen the RAW file to apply it." };
      }
    }
    return {
      recipe: {
        ...recipe,
        profile: {
          ...recipe.profile,
          id: found.source === "embedded" ? "embedded" : "custom",
          ...(found.source === "embedded" ? { group: "Embedded" } : {}),
          name: found.name,
          digest: found.digest,
          ...(kelvin ? { asShotKelvin: kelvin } : {}),
          sourceCamera,
        },
      },
      missing: null,
    };
  }

  /** A profile's bytes, for the engine to (re-)register when a develop names
   *  its digest: from the library, or — a DNG's own profile — from an open
   *  RAW source that carries it. */
  private developProfileBytes(digest: string, source?: CameraRawSource | null): Uint8Array | null {
    const stored = this.cameraRawProfileBytes.get(digest);
    if (stored) return stored;
    const sources = [
      source ?? null,
      ...[...this.cameraRawSessions.values()].map((runtime) => runtime.state.source),
      ...this.docs.map((d) => d.cameraRaw),
    ];
    return sources.find((s) => s && embeddedCameraProfile(s.metadata)?.digest === digest)?.originalBytes ?? null;
  }

  /** What a profile digest goes by in the open documents, sessions and library. */
  private developProfileName(digest: string): string | null {
    const recipes = [
      ...this.docs.map((d) => d.cameraRaw?.recipe),
      ...[...this.cameraRawSessions.values()].map((runtime) => runtime.working),
    ];
    return recipes.find((recipe) => recipe?.profile.digest === digest)?.profile.name
      ?? this.snap.cameraRawProfiles.find((entry) => entry.digest === digest)?.name
      ?? null;
  }

  /** Develops named profiles nobody could supply, so they rendered as Camera
   *  Default (EngineClient.onDevelopProfileMissing): say so, once a session a
   *  profile, after the library has loaded — a profile it holds is no gap. */
  private warnMissingDevelopProfiles(digests: string[]) {
    void this.cameraRawProfilesReady.then(() => {
      const gone = digests.filter((digest) => !this.reportedMissingProfiles.has(digest) && !this.developProfileBytes(digest));
      if (!gone.length) {
        // Loaded meanwhile: render the layers that missed it again.
        if (digests.some((digest) => this.developProfileBytes(digest))) this.refreshDevelopProfiles();
        return;
      }
      for (const digest of gone) this.reportedMissingProfiles.add(digest);
      const names = gone.map((digest) => `“${this.developProfileName(digest) ?? "Custom"}”`).join(", ");
      this.engine.onEditError?.(`The camera profile ${names} isn't installed, so layers using it show Camera Default. Load it with Camera Raw ▸ Profile ▸ Load Profile… and they show it again.`);
    });
  }

  /** Re-render the Smart Objects whose Camera Raw profile can be found now,
   *  in every open document (engine refresh_develop_profiles). */
  private refreshDevelopProfiles() {
    for (const d of this.docs) {
      const source = cameraProfileSource(d.cameraRaw?.metadata);
      const refreshed = d.engine.refresh_develop_profiles(d.cameraRawLayerId ?? 0, Float32Array.from(source ? [...source.cameraToXyz, ...source.whiteBalance] : []));
      if (refreshed && d.id === this.activeDocId) this.engine.refreshFromEngine();
    }
    this.engine.reportMissingDevelopProfiles?.();
  }

  /** A reopened Camera Raw Smart Object re-develops on every stack re-render:
   *  once the library has loaded, show its profile (a project saved while it
   *  was missing has Camera Default pixels), or say it is missing. */
  private adoptCameraRawProfile(d: DocEntry) {
    void this.cameraRawProfilesReady.then(() => {
      if (!this.docs.includes(d)) return;
      const source = cameraProfileSource(d.cameraRaw?.metadata);
      const refreshed = d.engine.refresh_develop_profiles(d.cameraRawLayerId ?? 0, Float32Array.from(source ? [...source.cameraToXyz, ...source.whiteBalance] : []));
      if (refreshed && d.id === this.activeDocId) this.engine.refreshFromEngine();
      this.engine.reportMissingDevelopProfiles?.();
    });
  }

  /** The Camera Raw session the workspace is showing, if any. */
  activeCameraRawSession(): string | null {
    return this.activeCameraRawSessionId;
  }

  /** Make a queued Camera Raw session the active one (filmstrip navigation).
   *  The already-open workspace re-presents it in place; the outgoing session
   *  is returned to the queue (its cleanup-cancel then no-ops, since it is no
   *  longer the active session), so switching never discards a staged image. */
  activateCameraRawSession(sessionId: string): boolean {
    if (sessionId === this.activeCameraRawSessionId) return true;
    const runtime = this.cameraRawSessions.get(sessionId);
    if (!runtime || !this.cameraRawQueue.includes(sessionId)) return false;
    const current = this.activeCameraRawSessionId;
    this.cameraRawQueue = this.cameraRawQueue.filter((id) => id !== sessionId);
    if (current && !this.cameraRawQueue.includes(current)) this.cameraRawQueue.unshift(current);
    this.activeCameraRawSessionId = sessionId;
    this.bumpCameraRawSessions();
    return true;
  }

  /** Activate a pending session AND re-present the workspace on it (the full
   *  filmstrip switch, for programmatic/MCP navigation). The open workspace is
   *  keyed on sessionId, so requesting the dialog remounts it on the target. */
  selectCameraRawSession(sessionId: string): boolean {
    const runtime = this.cameraRawSessions.get(sessionId);
    if (!runtime || !this.activateCameraRawSession(sessionId)) return false;
    this.requestDialog("cameraRaw", { invocation: runtime.state.invocation, sessionId } satisfies CameraRawDialogRequest);
    return true;
  }

  /** Await the user's terminal choice for a staged RAW. Batch workflows use
   * this to pause instead of accidentally processing whichever tab was active
   * before the Camera Raw transaction opened. */
  waitForCameraRawSession(sessionId: string): Promise<Exclude<CameraRawDisposition, "pending"> | null> {
    return this.cameraRawSessions.get(sessionId)?.completion ?? Promise.resolve(null);
  }

  private retireCameraRawSession(sessionId: string, freeEngine: boolean) {
    const runtime = this.cameraRawSessions.get(sessionId);
    this.cameraRawSessions.delete(sessionId);
    this.cameraRawQueue = this.cameraRawQueue.filter((id) => id !== sessionId);
    if (this.activeCameraRawSessionId === sessionId) this.activeCameraRawSessionId = null;
    this.bumpCameraRawSessions();
    if (freeEngine && runtime) {
      try { runtime.engine.free(); }
      catch (error) { console.error("Could not free Camera Raw session engine:", error); }
    }
    queueMicrotask(() => this.presentNextCameraRawSession());
  }

  cancelCameraRawSession(sessionId: string): boolean {
    const runtime = this.cameraRawSessions.get(sessionId);
    if (!runtime || this.activeCameraRawSessionId !== sessionId) return false;
    runtime.state.disposition = "cancelled";
    runtime.state.completedAt = new Date().toISOString();
    runtime.resolveCompletion("cancelled");
    this.retireCameraRawSession(sessionId, true);
    return true;
  }

  completeCameraRawDone(sessionId: string): boolean {
    const runtime = this.cameraRawSessions.get(sessionId);
    if (!runtime || this.activeCameraRawSessionId !== sessionId) return false;
    runtime.state.disposition = "done";
    runtime.state.completedAt = new Date().toISOString();
    runtime.resolveCompletion("done");
    this.retireCameraRawSession(sessionId, true);
    return true;
  }

  /** Commit one staged RAW. Open develops a regular pixel document, matching
   * Photoshop; Open Object retains the decoded source as a Smart Object with a
   * re-editable fid-17 recipe. Both keep original camera bytes in the project
   * envelope for provenance, Revert, and source-aware export. */
  /** Persist the workspace's named snapshots onto the session's source so
   *  they survive into the sidecar/XMP alongside the recipe. */
  setCameraRawSnapshots(sessionId: string, snapshots: CameraRawSnapshotEntry[]) {
    const runtime = this.cameraRawSessions.get(sessionId);
    if (!runtime?.state.source) return;
    runtime.state.source.snapshots = normalizeCameraRawSnapshots(snapshots);
  }
  completeCameraRawOpen(sessionId: string, recipe: VisionDevelopRecipe, asSmartObject: boolean): number | null {
    const runtime = this.cameraRawSessions.get(sessionId);
    if (!runtime?.state.source || this.activeCameraRawSessionId !== sessionId) return null;
    const working = this.prepareProfileWith(normalizeWorkingRecipe(recipe), runtime.state.source, runtime.state.source.metadata, recipe.optics).recipe;
    const eng = runtime.engine;
    if (working.enhance?.superResolution && !eng.can_super_resolution()) return null;
    const openAsSmartObject = asSmartObject || runtime.state.invocation === "open-as-smart-object";
    let layerId = 0;
    let adoptionCheckpoint: DocumentAdoptionCheckpoint | null = null;
    let entry!: DocEntry;
    try {
      if (working.enhance?.superResolution && !eng.super_resolution()) {
        throw new Error("Super Resolution exceeds the document size limit");
      }
      runtime.working = working;
      runtime.state.source.recipe = working;
      const params = workingRecipeToParams(working);
      layerId = eng.active_layer_id();
      if (openAsSmartObject) {
        if (eng.layer_kind(layerId) !== LAYER_KIND.smartObject) {
          eng.convert_to_smart_object(layerId);
          layerId = eng.active_layer_id();
        }
        eng.smart_add_filter(layerId, 17, params);
      } else {
        eng.camera_raw_develop(params);
        // Release the RAW headroom the develop read; at 32 bits it becomes the
        // float document's range above white (on Image ▸ Mode ▸ 32 Bits' scale).
        const float = this.snap.filePrefs.rawDepth === 32;
        if (!eng.camera_raw_commit(params, float)) {
          throw new Error(eng.last_edit_error() || "Could not open the RAW at 32 bits.");
        }
        if (float) runtime.state.source.depth = 32;
      }
      eng.purge();
      eng.set_history_source();
      // A document switch intentionally commits any live transform/text edit.
      // Checkpoint after that preflight so a later adoption failure cannot
      // restore stale UI pointers into already-finalized engine state.
      const preflightComplete = this.finalizeActiveDocumentForAdoption();
      adoptionCheckpoint = this.documentAdoptionCheckpoint();
      if (!preflightComplete) throw new Error("Could not finalize the active document before Camera Raw adoption");
      this.addDoc(eng, runtime.state.source.originalName, true, false);
      const adopted = this.activeEntry();
      if (!adopted || adopted.engine !== eng) throw new Error("Camera Raw document adoption failed.");
      entry = adopted;
      entry.cameraRaw = runtime.state.source;
      entry.cameraRawLayerId = openAsSmartObject ? layerId : null;
      entry.savedPath = runtime.state.source.originalPath ?? null;
      // The camera file is source material, not a writable document format. The
      // developed document remains unsaved until its project (or flat copy) is
      // explicitly written, so closing it cannot silently discard the recipe.
      this.dirtyEntry(entry);
    } catch (error) {
      if (adoptionCheckpoint) this.restoreDocumentAdoption(adoptionCheckpoint);
      runtime.state.disposition = "cancelled";
      runtime.state.completedAt = new Date().toISOString();
      runtime.resolveCompletion("cancelled");
      this.retireCameraRawSession(sessionId, !this.docs.some((entry) => entry.engine === eng));
      throw error;
    }
    const disposition = openAsSmartObject ? "open-as-smart-object" as const : "open" as const;
    runtime.state.disposition = disposition;
    runtime.state.provisionalDocumentId = entry.id;
    runtime.state.targetDocumentId = entry.id;
    if (openAsSmartObject) runtime.state.smartObjectLayerId = layerId;
    runtime.state.completedAt = new Date().toISOString();
    runtime.resolveCompletion(disposition);
    this.retireCameraRawSession(sessionId, false);
    try {
      if (entry.savedPath) this.recordRecentFile(entry.savedPath);
      this.set({ documents: this.docSummaries() });
    } catch (error) {
      console.error("Could not refresh the committed Camera Raw document:", error);
    }
    // The image is open whatever happens to its sidecar from here on.
    if (this.snap.cameraRawPrefs.sidecarOnOpen) {
      try {
        this.onCameraRawSidecarOnOpen?.(cameraRawSidecarSourceSnapshot(runtime.state.source));
      } catch (error) {
        this.engine.onEditError?.(`Opened ${entry.name}, but could not save its Camera Raw settings to a sidecar .xmp (${error instanceof Error ? error.message : String(error)}).`);
      }
    }
    this.onDocumentEvent?.("openDocument");
    return entry.id;
  }

  cameraRawTarget(docId: number, layerId: number): { engine: Engine; source: CameraRawSidecarSourceSnapshot | null } | null {
    const d = this.docs.find((entry) => entry.id === docId);
    if (!d || !this.engineHasLayer(d.engine, layerId)) return null;
    this.syncCameraRawRecipeFromEngine(d);
    return { engine: d.engine, source: d.cameraRaw ? cameraRawSidecarSourceSnapshot(d.cameraRaw) : null };
  }

  cameraRawSourceForDoc(docId = this.activeDocId): CameraRawSource | null {
    const d = this.docs.find((entry) => entry.id === docId);
    if (!d) return null;
    this.syncCameraRawRecipeFromEngine(d);
    return d.cameraRaw ? cloneCameraRawSource(d.cameraRaw) : null;
  }

  /** Capture only the derived, immutable values required by DNG export. No
   * project-owned RAW bytes or mutable metadata escape this boundary. */
  cameraRawExportSnapshotForDoc(docId: number): CameraRawExportSnapshot {
    const d = this.docs.find((entry) => entry.id === docId);
    if (!d) return {};
    this.syncCameraRawRecipeFromEngine(d);
    const source = d.cameraRaw;
    if (!source) return {};
    const { make, model, serialNumber } = source.metadata;
    return {
      metadata: {
        ...(make ? { make } : {}),
        ...(model ? { model } : {}),
        ...(serialNumber ? { serialNumber } : {}),
      },
      xmp: serializeCameraRawXmp(source),
    };
  }

  /** Route the active target through a typed, pinned dialog request. RAW-backed
   * documents reopen their canonical recipe; ordinary documents enter Filter. */
  requestCameraRawEdit() {
    const d = this.activeEntry();
    if (!d) return;
    this.syncCameraRawRecipeFromEngine(d);
    const canReopen = !!d.cameraRaw && d.cameraRawLayerId !== null
      && this.engineHasLayer(d.engine, d.cameraRawLayerId);
    const layerId = canReopen ? d.cameraRawLayerId! : this.snap.activeLayerId;
    const invocation: CameraRawInvocationKind = canReopen ? "reopen" : "filter";
    this.requestDialog("cameraRaw", {
      invocation,
      targetDocumentId: d.id,
      targetLayerId: layerId,
    } satisfies CameraRawDialogRequest);
  }

  /** Apply/update fid 17 against the originally captured document/layer. A tab
   * switch cannot retarget the operation, and a deleted/stale layer cleanly
   * aborts without touching any other document. */
  cameraRawDevelopTarget(
    docId: number,
    layerId: number,
    recipe: VisionDevelopRecipe,
    smartIndex?: number,
  ): boolean {
    const d = this.docs.find((entry) => entry.id === docId);
    if (!d) return false;
    const working = this.prepareCameraRawProfile(normalizeWorkingRecipe(recipe), { documentId: docId, layerId }, recipe.optics).recipe;
    const params = workingRecipeToParams(working);
    let applied = false;
    const changed = this.mutateDocEngine(docId, (eng) => {
      if (!this.engineHasLayer(eng, layerId)) return false;
      const kind = eng.layer_kind(layerId);
      if (kind === LAYER_KIND.smartObject) {
        const withFilterId = eng as Engine & { smart_filter_id?: (id: number, index: number) => number };
        if (smartIndex === undefined) eng.smart_add_filter(layerId, 17, params);
        else {
          if (smartIndex < 0 || smartIndex >= eng.smart_filter_count(layerId)) return false;
          if (withFilterId.smart_filter_id && withFilterId.smart_filter_id(layerId, smartIndex) !== 17) return false;
          eng.smart_update_filter(layerId, smartIndex, params);
        }
      } else {
        const previous = eng.active_layer_id();
        eng.set_active_layer(layerId);
        eng.camera_raw_develop(params);
        if (previous !== layerId) eng.set_active_layer(previous);
      }
      applied = true;
      return true;
    });
    if (!changed || !applied) return false;
    if (d.cameraRaw && d.cameraRawLayerId === layerId && smartIndex !== undefined) {
      // Treat the engine's fid-17 payload as authoritative so Store metadata
      // follows the same float/advanced-tail representation as undo/redo/save.
      this.syncCameraRawRecipeFromEngine(d);
    }
    return true;
  }

  /** Ask the UI to open a dialog by name (drained + cleared by the App). */
  requestDialog(name: string, arg?: unknown) {
    const previous = this.snap.pendingDialog;
    const previousArg = previous?.arg && typeof previous.arg === "object"
      ? previous.arg as { sessionId?: unknown }
      : null;
    const nextArg = arg && typeof arg === "object" ? arg as { sessionId?: unknown } : null;
    const previousSessionId = previous?.name === "cameraRaw" && typeof previousArg?.sessionId === "string"
      ? previousArg.sessionId
      : null;
    const nextSessionId = name === "cameraRaw" && typeof nextArg?.sessionId === "string"
      ? nextArg.sessionId
      : null;
    // A request can be replaced before React mounts its workspace, so no
    // component cleanup exists yet. Retire that transaction at the handoff
    // boundary instead of leaving an invisible active session behind.
    if (previousSessionId && previousSessionId !== nextSessionId) {
      this.cancelCameraRawSession(previousSessionId);
    }
    const request = { name, arg, serial: this.nextDialogSerial++ };
    this.set({ pendingDialog: request });
  }
  /** Clear a pending dialog request once the UI has opened it. */
  clearPendingDialog(serial = this.snap.pendingDialog?.serial) {
    const current = this.snap.pendingDialog;
    if (!current || serial !== current.serial) return;
    this.set({ pendingDialog: null });
  }
  openGif(bytes: Uint8Array, name: string) {
    const eng = this.engine.buildNew(1, 1);
    eng.importGif(bytes);
    this.addDoc(eng, name, true, false);
    this.onDocumentEvent?.("openDocument");
  }
  /** Image ▸ Duplicate: open an independent copy of the active document in a
   *  new tab (serialise → reload). `mergedOnly` flattens the copy. */
  duplicateDocument(name?: string, mergedOnly = false) {
    if (this.snap.paintSymmetryTransforming) this.commitPaintSymmetryTransform();
    const sourceEntry = this.activeEntry();
    if (sourceEntry) this.syncCameraRawRecipeFromEngine(sourceEntry);
    const source = sourceEntry?.cameraRaw;
    const sourceLayerId = sourceEntry?.cameraRawLayerId ?? null;
    // addDoc resets the live snapshot, so copy the paths before adopting the tab
    // (flattening keeps them — paths are not pixels).
    const savedPaths = normalizeSavedPaths(this.snap.savedPaths);
    const variableData = normalizeVariableData(this.snap);
    const duotone = sourceEntry ? this.docDuotone(sourceEntry.id) : null;
    const bytes = this.engine.projectBytes();
    const eng = this.engine.buildProject(bytes);
    this.applyBlendGamma(eng); // Merged Layers Only bakes the blend the canvas shows
    if (mergedOnly) eng.flatten();
    const dot = this.snap.doc.name.replace(/\.[^.]+$/, "");
    this.addDoc(
      eng,
      name && name.trim() ? name.trim() : `${dot} copy`,
      true,
      false,
      this.snap.colorProfileAssigned,
      this.snap.iccProfileBytes,
      this.snap.iccProfileName,
      this.snap.notes,
      mergedOnly ? [] : this.snap.layerComps,
      this.snap.activeNoteId,
      this.snap.nextNoteId,
      this.snap.pixelAspect,
      this.snap.pixelAspectCorrection,
      this.snap.resolutionPpi,
      this.snap.guides,
      this.snap.measureScale,
    );
    this.adoptSavedPaths(savedPaths);
    this.adoptVariableData(variableData);
    const duplicateInks = this.bindDuotone(eng, duotone ?? undefined); // none once flattened
    if (duplicateInks) this.set({ duotone: duplicateInks });
    const duplicate = this.activeEntry();
    if (duplicate) {
      duplicate.captureMetadata = normalizeCaptureMetadata(sourceEntry?.captureMetadata);
      // A duplicate has no saved destination even when its pixels initially
      // match the source, so closing it must follow the unsaved-document path.
      this.dirtyEntry(duplicate);
      if (!mergedOnly && source) {
        duplicate.cameraRaw = normalizeCameraRawSource(source, { copyBytes: false });
        duplicate.cameraRawLayerId = sourceLayerId === null
          ? null
          : this.findCameraRawLayerId(duplicate.engine, sourceLayerId);
      }
      this.set({ documents: this.docSummaries() });
    }
  }

  /** File ▸ Revert: replace the active document's content with a freshly-loaded
   *  engine (its on-disk file, decoded by the caller), in place — the tab keeps
   *  its id, position and saved path; dirty flag and history are reset. */
  /** Swap the active document's engine for another state.
   *
   *  `opts.dirty` — File ▸ Revert reloads the document from its saved file, so the
   *  result genuinely matches disk and is clean. A History-panel SNAPSHOT restore
   *  does not: it is an in-memory state that was never written, so clearing the
   *  dirty flag made Vision believe the file was up to date — closing then threw the
   *  restored state away with no prompt, and the crash-recovery snapshot went with
   *  it. Callers restoring unsaved state must pass `{ dirty: true }`. (#27) */
  revertActiveDoc(eng: Engine, document?: ProjectDocumentMeta | null, opts?: { dirty?: boolean }) {
    this.cancelLiquify();
    this.cancelVanishingPoint();
    if (this.snap.paintSymmetryTransforming) this.cancelPaintSymmetryTransform();
    const d = this.activeEntry();
    if (!d) return;
    const previous = d.engine;
    this.captureActiveView();
    this.endTextEdit();
    this.reportModeProfile(eng);
    const noteState = this.noteStateForEngine(eng, document?.notes ?? null);
    const guideState = normalizeGuides(document?.guides);
    const scaleState = normalizeMeasureScale(document?.measureScale);
    d.engine = eng;
    d.captureMetadata = normalizeCaptureMetadata(document?.captureMetadata);
    d.historyLabels = [];
    d.dirty = opts?.dirty ?? false;
    d.pristineBlank = false;
    d.colorProfileAssigned = document?.colorProfileAssigned ?? d.colorProfileAssigned;
    d.iccProfileBytes = document ? cloneIccProfileBytes(document.iccProfileBytes) : d.iccProfileBytes;
    d.iccProfileName = document ? normalizeCustomProfileName(document.iccProfileName) : d.iccProfileName;
    d.notes = cloneNotes(noteState.notes);
    d.activeNoteId = noteState.activeNoteId;
    d.nextNoteId = noteState.nextNoteId;
    d.layerComps = cloneLayerComps(document?.layerComps ?? []);
    d.layerColorLabels = {}; // (#144) the reloaded file brings its own layer ids
    d.guides = cloneGuides(guideState);
    d.resolutionPpi = normalizeDocumentResolutionPpi(document?.resolutionPpi);
    d.pixelAspect = normalizePixelAspectRatio(document?.pixelAspect ?? 1);
    d.pixelAspectCorrection = document?.pixelAspectCorrection ?? true;
    d.measureScale = { ...scaleState };
    // Revert replaces the document's content: its paths come from the reloaded
    // file, and the unsaved work path goes with the reverted edits. A PSD brings
    // no document, so its paths are the ones the reloaded engine read (every
    // other engine reads none), or the next save would delete them from disk.
    d.savedPaths = normalizeSavedPaths(document ? document.savedPaths : fromPhotoshopPaths(eng.photoshop_paths_json?.()));
    Object.assign(d, normalizeVariableData(document?.variableData));
    d.penPath = [];
    d.penAnchors = [];
    d.penContours = [];
    // A replacement without Camera Raw metadata (for example a flattened PNG
    // loaded by Revert) must clear provenance even if it reuses the same layer
    // id. Otherwise the next Camera Raw edit could target rendered pixels as RAW.
    d.cameraRaw = document?.cameraRaw ? cloneCameraRawSource(document.cameraRaw) : null;
    d.cameraRawLayerId = d.cameraRaw
      ? this.findCameraRawLayerId(eng, document?.cameraRawLayerId)
      : null;
    // The reloaded file's own inks: a project records them, a Photoshop Duotone
    // carries them in the file.
    d.duotone = document ? this.bindDuotone(eng, document.duotone) : this.adoptPhotoshopDuotone(eng);
    this.set({
      history: [],
      maskEdit: false,
      maskView: "off",
      quickMask: false,
      colorProfileAssigned: d.colorProfileAssigned,
      iccProfileBytes: cloneIccProfileBytes(d.iccProfileBytes),
      iccProfileName: normalizeCustomProfileName(d.iccProfileName),
      notes: cloneNotes(noteState.notes),
      activeNoteId: noteState.activeNoteId,
      nextNoteId: noteState.nextNoteId,
      layerComps: cloneLayerComps(d.layerComps),
      layerColorLabels: {},
      guides: cloneGuides(guideState),
      resolutionPpi: d.resolutionPpi,
      pixelAspect: d.pixelAspect,
      pixelAspectCorrection: d.pixelAspectCorrection,
      measureScale: { ...scaleState },
      savedPaths: normalizeSavedPaths(d.savedPaths),
      ...normalizeVariableData(d),
      penPath: [],
      penAnchors: [],
      penContours: [],
      vanishingPointPlanes: defaultVanishingPointPlanes(eng.width(), eng.height()),
      vanishingPointActivePlane: 0,
      vanishingPointSource: null,
      duotone: d.duotone,
    });
    this.applyBlendGamma(eng);
    this.engine.activate(eng);
    if (previous !== eng) this.releaseEngine(previous);
    this.set({ history: [] });
    this.fit();
    this.pushBrush();
    this.engine.engine?.set_history_states(this.snap.historyStates);
    this.set({ documents: this.docSummaries() });
    this.notifyVectorFontTargetsChanged();
    // Only when the result really matches disk. A snapshot restore is unsaved
    // state, so its recovery snapshot must be KEPT — dropping it was the second
    // half of #27 (silent loss on close with no crash backup either).
    if (!d.dirty) this.onDocSaved?.(d.id);
  }

  /** Rebuild an initially-opened camera file from the embedded original bytes
   * and its last committed recipe. Used by Revert while the remembered path is
   * still a manufacturer RAW rather than a later .mvision Save As target. */
  revertActiveCameraRawSource(): boolean {
    const d = this.activeEntry();
    if (!d?.cameraRaw) return false;
    const source = d.cameraRaw;
    // A source without a recorded demosaic predates #443: rebuild it the way it
    // opened, through the 3×3 average and without highlight headroom
    // (camera_raw_commit with float = false only releases the headroom).
    const legacy = !source.demosaic;
    const eng = this.engine.buildRaw(source.originalBytes, source.demosaic ?? "bilinear");
    if (legacy) eng.camera_raw_commit(new Float32Array(0), false);
    if (source.recipe.enhance?.superResolution && !eng.super_resolution()) {
      eng.free();
      throw new Error("Super Resolution exceeds the document size limit");
    }
    let layerId = eng.active_layer_id();
    const asSmartObject = d.cameraRawLayerId !== null;
    const prepared = this.prepareProfileWith(source.recipe, source);
    const params = workingRecipeToParams(prepared.recipe);
    if (asSmartObject) {
      eng.convert_to_smart_object(layerId);
      layerId = eng.active_layer_id();
      eng.smart_add_filter(layerId, 17, params);
    } else {
      eng.camera_raw_develop(params);
      if (!eng.camera_raw_commit(params, source.depth === 32)) {
        const message = eng.last_edit_error();
        eng.free();
        throw new Error(message || "Could not rebuild the RAW at 32 bits.");
      }
    }
    eng.purge();
    eng.set_history_source();
    const document = this.docDocumentMeta(d.id, { includeCameraRaw: false }) ?? { colorProfileAssigned: true };
    document.cameraRaw = source;
    document.cameraRawLayerId = asSmartObject ? layerId : undefined;
    this.revertActiveDoc(eng, document);
    if (prepared.lensWarning) this.engine.onEditError?.(prepared.lensWarning);
    const current = this.activeEntry();
    if (current) current.cameraRawLayerId = asSmartObject ? layerId : null;
    return true;
  }

  /** Switch the active document to an already-open tab. */
  activateDoc(id: number) {
    if (id === this.activeDocId) return;
    const target = this.docs.find((d) => d.id === id);
    if (!target) return;
    this.cancelLiquify();
    this.cancelVanishingPoint();
    if (this.snap.paintSymmetryTransforming) this.commitPaintSymmetryTransform();
    this.captureActiveView();
    this.endTextEdit();
    this.activeDocId = id;
    // Set the target's name/zoom/pan before the engine sync so it doesn't flash
    // the previous doc's view (sync preserves name and never touches zoom/pan).
    // maskEdit is a per-document targeting mode — doc A's mask-edit must not
    // silently re-target the brush onto doc B's mask (pushBrush below pushes
    // the flag into the newly activated engine).
    this.set({
      doc: { ...this.snap.doc, name: target.name },
      zoom: target.zoom, panX: target.panX, panY: target.panY, rotationAngle: target.rotationAngle,
      colorProfileAssigned: target.colorProfileAssigned,
      iccProfileBytes: cloneIccProfileBytes(target.iccProfileBytes),
      iccProfileName: normalizeCustomProfileName(target.iccProfileName),
      notes: cloneNotes(target.notes),
      activeNoteId: target.activeNoteId,
      nextNoteId: target.nextNoteId,
      layerComps: cloneLayerComps(target.layerComps),
      layerColorLabels: { ...target.layerColorLabels }, // (#144) ids are per engine
      guides: cloneGuides(target.guides),
      resolutionPpi: target.resolutionPpi,
      pixelAspect: target.pixelAspect,
      pixelAspectCorrection: target.pixelAspectCorrection,
      measureScale: { ...target.measureScale },
      savedPaths: normalizeSavedPaths(target.savedPaths),
      ...normalizeVariableData(target),
      penPath: [...target.penPath],
      penAnchors: [...target.penAnchors],
      penContours: [...target.penContours],
      vanishingPointPlanes: clonePlanes(target.vanishingPointPlanes),
      vanishingPointActivePlane: target.vanishingPointActivePlane,
      vanishingPointSource: target.vanishingPointSource,
      maskEdit: false,
      maskView: "off",
      // Layer ids are per engine, so this is the document's own record — another
      // document's duotone layer id would aim the ink edit at the wrong layer.
      duotone: target.duotone,
      timeline: cloneTimeline(target.timeline),
      playhead: clampPlayhead(target.playhead ?? 0, cloneTimeline(target.timeline).durationS),
      quickMask: false, // resynced from the target engine by activate() below
      channelTarget: null, // channel targeting is per document (it is a mask-buffer state)
    });
    setQuickMaskOverlay(null);
    this.engine.activate(target.engine);
    this.set({ history: target.historyLabels });
    this.pushBrush();
    this.engine.engine?.set_history_states(this.snap.historyStates); // global preference
    this.set({ snapshots: this.snapshotRows(this.snapshotsByDoc.get(id) ?? []) }); // History Snapshots are per document
  }

  /** Window ▸ Arrange ▸ Match Zoom/Location/Rotation/All: push the active
   *  document's view onto every other open document (Photoshop's Match View
   *  family) and onto every Window ▸ Arrange pane. Flags select which view
   *  properties to copy; the active document is left untouched and a
   *  single-document session with no pane is a no-op. */
  matchView(flags: { zoom?: boolean; location?: boolean; rotation?: boolean }) {
    const { zoom, panX, panY, rotationAngle } = this.snap;
    for (const d of this.docs) {
      if (d.id === this.activeDocId) continue;
      if (flags.zoom) d.zoom = zoom;
      if (flags.location) { d.panX = panX; d.panY = panY; }
      if (flags.rotation) d.rotationAngle = rotationAngle;
    }
    // A pane is sized unlike the canvas, so Location matches the document point
    // at the centre rather than the raw pan.
    const panes = Object.keys(this.snap.paneViews).map(Number).filter((id) => this.docs.some((d) => d.id === id));
    if (!panes.length) return;
    const main = this.placedView();
    const par = this.snap.pixelAspectCorrection ? this.snap.pixelAspect : 1;
    const paneViews = { ...this.snap.paneViews };
    for (const id of panes) paneViews[id] = { ...paneViews[id], ...matchedView(main, this.placedView(id), flags, par) };
    this.set({ paneViews });
  }

  /** Window ▸ Arrange ▸ Float in Window: document `id` leaves the tab bar for
   *  a window of its own. Float All in Windows (`floatAllDocs`) does it for
   *  every open document and Consolidate All to Tabs (`consolidateFloats`)
   *  brings them all back; closing one window returns just its document. The
   *  document stays open throughout — a window is only a view of it. */
  floatDoc(id: number) {
    if (this.snap.floatDocs.includes(id) || !this.docs.some((d) => d.id === id)) return;
    this.set({ floatDocs: [...this.snap.floatDocs, id] });
  }
  floatAllDocs() {
    const rest = this.docs.filter((d) => !this.snap.floatDocs.includes(d.id)).map((d) => d.id);
    if (rest.length) this.set({ floatDocs: [...this.snap.floatDocs, ...rest] });
  }
  unfloatDoc(id: number) {
    if (this.snap.floatDocs.includes(id)) this.set({ floatDocs: this.snap.floatDocs.filter((x) => x !== id) });
  }
  consolidateFloats() {
    if (this.snap.floatDocs.length) this.set({ floatDocs: [] });
  }

  /** Drop a document engine once nothing in the store still displays it (#539). */
  private releaseEngine(eng: { free?: () => void } | null | undefined) {
    if (!eng || typeof eng.free !== "function") return;
    try { eng.free(); }
    catch (error) { console.error("Could not free document engine:", error); }
  }

  /** Close a document tab. Frees its wasm Engine. Closing the last one leaves
   *  the store documentless (`documents: []`, `ready: false`, no active engine)
   *  — the UI shows the Home start screen there instead of a fabricated blank
   *  (#476). Unsaved-changes confirmation is the UI layer's job (so this stays
   *  deterministic for tests). */
  closeDoc(id: number) {
    if (this.liquifySession?.docId === id) this.cancelLiquify();
    if (this.vpSession?.docId === id) this.cancelVanishingPoint();
    if (id === this.activeDocId && this.snap.paintSymmetryTransforming) this.commitPaintSymmetryTransform();
    const idx = this.docs.findIndex((d) => d.id === id);
    if (idx < 0) return;
    const wasActive = id === this.activeDocId;
    const dropped = this.docs[idx];
    this.clipboardProfileMetaByDoc.delete(id);
    this.revertUndo.delete(id);
    this.forgetDocSnapshots(id); // free the doc's snapshot bytes + thumbnails
    // A Clone Source slot sampled in this document has nothing left to sample (#485).
    if (this.snap.cloneSources.some((s) => s.source?.docId === id)) {
      this.set({ cloneSources: this.snap.cloneSources.map((s) => (s.source?.docId === id ? { ...s, source: null } : s)) });
    }
    this.docs.splice(idx, 1);
    const release = () => this.releaseEngine(dropped.engine);
    if (this.docs.length === 0) {
      this.cancelLive();
      this.activeDocId = -1;
      this.iccProofKey = ""; // cancel a pending proof bake; the next document must rebuild it
      this.engine.deactivate();
      release();
      this.set({
        ready: false,
        documents: [],
        activeDocId: -1,
        // Full Screen gives the CANVAS the whole window and hides the menubar.
        // Home has no canvas, and its screen-mode commands are disabled, so
        // carrying the mode across would strand the user with no way back.
        screenMode: "standard",
        doc: { width: 0, height: 0, name: "" },
        layers: [],
        activeLayerId: 0,
        selectedLayerIds: [],
        selectionActive: false,
        history: [],
        snapshots: [],
        textEdit: null,
        canUndo: false,
        canRedo: false,
        maskEdit: false,
        maskView: "off",
        quickMask: false,
        photoshopPreview: null,
        timeline: { ...DEFAULT_TIMELINE, keys: [] },
        playhead: 0,
      });
      this.notifyVectorFontTargetsChanged();
      this.onDocumentEvent?.("closeDocument");
      return;
    }
    if (wasActive) {
      const next = this.docs[Math.min(idx, this.docs.length - 1)];
      this.activeDocId = -1; // don't capture the removed doc's view
      this.activateDoc(next.id);
    } else {
      this.set({ documents: this.docSummaries() });
    }
    release();
    this.onDocumentEvent?.("closeDocument");
  }

  /** Reorder the open-document tabs to match a new order of display names. */
  reorderDocs(names: string[]) {
    const byName = new Map(this.docs.map((d) => [d.name, d]));
    const next: DocEntry[] = [];
    for (const n of names) { const d = byName.get(n); if (d) next.push(d); }
    for (const d of this.docs) if (!next.includes(d)) next.push(d);
    this.docs = next;
    this.set({ documents: this.docSummaries() });
  }

  /** A composited thumbnail data URL for one open document (any tab). */
  docThumb(id: number): string {
    const d = this.docs.find((x) => x.id === id);
    return d ? this.engine.docThumbUrl(d.engine) : "";
  }
  /** An open document's size, and its current composite — what a Window ▸
   *  Arrange pane shows for a document that is not the active one. */
  docSize(id: number): { w: number; h: number } | null {
    const d = this.docs.find((x) => x.id === id);
    return d ? { w: d.engine.width(), h: d.engine.height() } : null;
  }
  docPixels(id: number): ImageData | null {
    const d = this.docs.find((x) => x.id === id);
    const px = d ? this.engine.engineOutputCopy(d.engine) : null;
    return d && px ? new ImageData(px as Uint8ClampedArray<ArrayBuffer>, d.engine.width(), d.engine.height()) : null;
  }
  /** The document the engine holds right now. An activation blits before the
   *  snapshot's `activeDocId` catches up, so a blit's owner is read here. */
  engineDocId(): number {
    return this.activeDocId;
  }
  /** Rich cards for the document browser (thumb + dimensions + active flag). */
  docCards(): { id: number; name: string; dirty: boolean; active: boolean; thumb: string; width: number; height: number }[] {
    return this.docs.map((d) => ({
      id: d.id, name: d.name, dirty: d.dirty, active: d.id === this.activeDocId,
      thumb: this.engine.docThumbUrl(d.engine), width: d.engine.width(), height: d.engine.height(),
    }));
  }

  // ── dirty / saved-path tracking (drives the unsaved-`*` marker) ──
  /** Flag the active document as having unsaved changes. Every call advances
   *  its content revision, even when it is already dirty, so edits made during
   *  an in-flight save cannot be acknowledged by that older save. */
  /** Set by app.ts to the Generator watch runner (kept as a callback so the
   *  store stays engine-/app-agnostic). */
  onGeneratorRun: (() => void) | null = null;
  private generatorTimer: ReturnType<typeof setTimeout> | null = null;
  toggleGeneratorWatch(): boolean {
    const on = !this.snap.generatorWatch;
    this.set({ generatorWatch: on });
    return on;
  }
  markDirty() {
    const a = this.activeEntry();
    if (a) this.dirtyEntry(a);
    if (this.snap.generatorWatch && this.onGeneratorRun) {
      if (this.generatorTimer) clearTimeout(this.generatorTimer);
      // ponytail: fixed 600ms debounce; make it a pref if anyone ever asks.
      this.generatorTimer = setTimeout(() => { this.generatorTimer = null; this.onGeneratorRun?.(); }, 600);
    }
  }
  markDocDirty(id: number) {
    const d = this.docs.find((x) => x.id === id);
    if (!d) return;
    this.dirtyEntry(d);
    this.set({ documents: this.docSummaries() });
  }
  /** Capture this immediately before serializing or awaiting a save. */
  docContentRevision(id: number): number | null {
    return this.docs.find((x) => x.id === id)?.contentRevision ?? null;
  }
  /** Changes whenever an open document's pixels may have: an edit or a
   *  repaint that edits nothing. Both counters only grow, so their sum does. */
  docDisplayRevision(id: number): number | null {
    const d = this.docs.find((x) => x.id === id);
    return d ? d.contentRevision + d.displayRevision : null;
  }
  /** Clear the active document's dirty flag (after a successful save). */
  markActiveSaved() {
    this.markDocSaved(this.activeDocId);
  }
  /** Clear a SPECIFIC document's dirty flag — saves pin the doc id before
   *  their awaits, so a mid-save tab switch can't clear the wrong tab's `*`. */
  markDocSaved(id: number) {
    const d = this.docs.find((x) => x.id === id);
    if (d) d.dirty = false;
    this.set({ documents: this.docSummaries() });
    if (d) this.onDocSaved?.(id);
  }
  /** Set by app.ts: a document whose changes are now on disk no longer needs
   *  its crash-recovery snapshot. Fired wherever `dirty` is cleared by a save. */
  onDocSaved: ((id: number) => void) | null = null;
  /** Acknowledge a completed asynchronous save only when no later content
   *  mutation occurred on that same document. */
  markDocSavedAtRevision(id: number, contentRevision: number): boolean {
    const d = this.docs.find((x) => x.id === id);
    if (!d || d.contentRevision !== contentRevision) return false;
    d.dirty = false;
    this.set({ documents: this.docSummaries() });
    this.onDocSaved?.(id);
    if (d.savedPath) this.recordRecentFile(d.savedPath);
    return true;
  }
  /** The open tab already saved at this native path, if any (#525). */
  docIdForSavedPath(path: string): number | null {
    if (!path) return null;
    return this.docs.find((d) => d.savedPath === path)?.id ?? null;
  }
  activePath(): string | null { return this.activeEntry()?.savedPath ?? null; }
  activeName(): string { return this.activeEntry()?.name ?? this.snap.doc.name; }
  /** Record a native file path after Save As / native Open, and adopt its
   *  basename as the (de-duplicated) tab name. Clears dirty. */
  setActivePath(path: string) {
    this.setDocPath(this.activeDocId, path);
  }
  /** Path/name/dirty bookkeeping for a SPECIFIC document (see markDocSaved). */
  setDocPath(id: number, path: string) {
    this.adoptDocPath(id, path, true);
  }
  /** Adopt a successful Save As destination, but only clear dirty when its
   *  serialized revision is still current. The path/name adoption is retained
   *  after a concurrent edit so the next save targets the chosen destination. */
  setDocPathAfterSave(id: number, path: string, contentRevision: number): boolean {
    return this.adoptDocPath(id, path, false, contentRevision);
  }
  private adoptDocPath(id: number, path: string, clearDirty: boolean, contentRevision?: number): boolean {
    const d = this.docs.find((x) => x.id === id);
    if (!d) return false;
    d.savedPath = path;
    const base = path.replace(/^.*[\\/]/, "");
    if (base) d.name = d.name === base ? base : this.renameDoc(d, base);
    const savedCurrentRevision = clearDirty || d.contentRevision === contentRevision;
    if (savedCurrentRevision) d.dirty = false;
    d.pristineBlank = false;
    const docPatch = id === this.activeDocId ? { doc: { ...this.snap.doc, name: d.name } } : {};
    this.set({ ...docPatch, documents: this.docSummaries() });
    // History Options ▸ Automatically Create New Snapshot When Saving. Only when
    // the write really captured the current revision — a stale save is not a state
    // worth checkpointing.
    if (savedCurrentRevision && this.snap.historyOptions.autoSnapshotOnSave) this.snapshotDoc(id);
    if (savedCurrentRevision) this.logHistorySession(`File saved: ${d.name}`);
    if (savedCurrentRevision) this.onDocSaved?.(id);
    if (savedCurrentRevision) this.recordRecentFile(path);
    return savedCurrentRevision;
  }
  private renameDoc(target: DocEntry, base: string): string {
    // unique among the *other* docs
    if (!this.docs.some((d) => d !== target && d.name === base)) return base;
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    for (let n = 2; ; n++) {
      const cand = `${stem}-${n}${ext}`;
      if (!this.docs.some((d) => d !== target && d.name === cand)) return cand;
    }
  }

  // ── layers ───────────────────────────────────────────────────
  addLayer() {
    const e = this.engine.e;
    e.add_layer(`Layer ${e.layer_count()}`);
    this.engine.commit();
  }
  deleteLayer(id?: number) {
    this.engine.e.delete_layer(id ?? this.snap.activeLayerId);
    this.engine.commit();
  }
  duplicateLayer(id?: number) {
    this.engine.e.duplicate_layer(id ?? this.snap.activeLayerId);
    this.engine.commit();
  }
  // Layer ▸ New ▸ Layer Via Copy (⌘J) / Layer Via Cut (⇧⌘J): lift the active
  // selection onto a new layer. The new layer inherits the source's blend mode.
  layerViaCopy() {
    this.engine.e.layer_via_copy();
    this.engine.commit();
  }
  layerViaCut() {
    this.engine.e.layer_via_cut();
    this.engine.commit();
  }
  // Edit ▸ Cut / Copy / Copy Merged / Paste — the in-app clipboard. Copy and
  // Copy Merged only capture (no document change → no commit); Cut and the
  // Paste variants mutate the document and commit a new history step.
  copy() {
    if (this.engine.e.copy()) {
      this.rememberClipboardProfile();
      this.publishClipboard();
      this.engine.sync();
    }
    else if (!this.engine.e.has_clipboard()) this.setActiveClipboardProfileMeta(null);
  }
  copyMerged() {
    if (this.engine.e.copy_merged()) {
      this.rememberClipboardProfile();
      this.publishClipboard();
      this.engine.sync();
    }
    else if (!this.engine.e.has_clipboard()) this.setActiveClipboardProfileMeta(null);
  }
  cut() {
    if (this.engine.e.cut()) {
      this.rememberClipboardProfile();
      this.publishClipboard();
      this.engine.commit();
    }
  }
  /** The PNG this window last put on the system pasteboard, so Paste can tell
   *  "our own Copy came back" from "another app copied something". Set only
   *  after the pasteboard write succeeds, so a refused write is not "ours". */
  private publishedPng: Uint8Array | null = null;
  /** u16 clipboard for this window. Each document has its own engine clipboard,
   *  so a paste into another document installs this snapshot (anchor included)
   *  instead of re-decoding the 8-bit PNG. */
  private windowClip: {
    w: number; h: number; ox: number; oy: number; profile: number;
    pixels: Uint16Array;
    source: Engine;
  } | null = null;
  private windowClipMeta: ClipboardProfileMeta | null = null;
  private publishGeneration = 0;
  /** Mirror the engine clipboard onto the system pasteboard. Fire-and-forget:
   *  the in-app Copy has already succeeded and must not depend on it. */
  private publishClipboard() {
    const png = this.engine.e.clipboard_png();
    if (!png.length) return;
    this.snapshotWindowClip();
    const generation = ++this.publishGeneration;
    void this.finishPublish(png, generation);
  }
  private async finishPublish(png: Uint8Array, generation: number) {
    const ok = await writePasteboardPng(png);
    if (generation !== this.publishGeneration) return;
    this.publishedPng = ok ? png : null;
  }
  private snapshotWindowClip() {
    const e = this.engine.e as Engine & {
      clipboard_geometry?: () => ArrayLike<number>;
      clipboard_pixels?: () => Uint16Array;
    };
    if (typeof e.clipboard_geometry !== "function" || typeof e.clipboard_pixels !== "function") {
      this.windowClip = null;
      return;
    }
    const geo = Array.from(e.clipboard_geometry());
    const pixels = e.clipboard_pixels();
    if (geo.length < 5 || !pixels?.length) {
      this.windowClip = null;
      return;
    }
    this.windowClip = {
      w: geo[0], h: geo[1], ox: geo[2], oy: geo[3], profile: geo[4],
      pixels: pixels.slice(),
      source: e,
    };
    this.windowClipMeta = this.activeClipboardProfileMeta();
  }
  /** Install the window clip into a different document's engine. Same-engine
   *  paste leaves the richer in-app clip alone. */
  private installWindowClip(target: Engine): boolean {
    const clip = this.windowClip;
    if (!clip || clip.source === target) return false;
    const install = (target as Engine & {
      install_clipboard?: (w: number, h: number, ox: number, oy: number, profile: number, pixels: Uint16Array) => boolean;
    }).install_clipboard;
    if (typeof install !== "function") return false;
    if (!install.call(target, clip.w, clip.h, clip.ox, clip.oy, clip.profile, clip.pixels)) return false;
    if (this.windowClipMeta) {
      this.setActiveClipboardProfileMeta({
        profile: this.windowClipMeta.profile,
        assigned: this.windowClipMeta.assigned,
        iccProfileBytes: cloneIccProfileBytes(this.windowClipMeta.iccProfileBytes),
        iccProfileName: this.windowClipMeta.iccProfileName,
      });
    }
    return true;
  }
  /** Before any Paste: if the system pasteboard holds an image this window did
   *  not put there, adopt it as the engine clipboard. This is what makes Copy
   *  in Artisan / Preview / Figma pasteable here at all.
   *  ponytail: identity is "byte-identical to what we published". A platform
   *  that re-encodes public.png on the way back would look foreign, so a
   *  Vision→Vision paste would degrade to 8-bit and lose the Paste-in-Place
   *  anchor; the fix is a private application/vnd.monet.graphics flavour
   *  written from Rust (NSPasteboard), which the webview cannot carry. */
  private async adoptPasteboardImage(target: Engine, generation: number): Promise<boolean> {
    const current = () => this.engine.engine === target && this.engine.docGen === generation;
    const found = await readPasteboardImage();
    if (!current()) return false;
    // A foreign image wins over the window clip. Our own PNG (or an empty
    // pasteboard) keeps the 16-bit clip, installed into the target document
    // when that document's engine is not the one that copied.
    if (found && !sameBytes(this.publishedPng, found.bytes)) {
      try {
        // SVG is vector; the engine only decodes rasters, so rasterize it first
        // (same browser path File ▸ Open uses for .svg).
        const bytes = found.mime === PASTEBOARD_SVG ? await svgToPng(found.bytes) : found.bytes;
        if (!current()) return false;
        target.set_clipboard_from_image(bytes);
        this.publishedPng = null;
        this.windowClip = null;
        this.windowClipMeta = null;
        this.setActiveClipboardProfileMeta(null); // foreign pixels: sRGB, untagged
        return true;
      } catch (error) {
        // Fail loudly rather than pasting stale in-app pixels the user didn't copy.
        console.error("Could not paste the image on the system clipboard:", error);
        return false;
      }
    }
    this.installWindowClip(target);
    return true;
  }
  private rememberClipboardProfile() {
    const e = this.engine.e;
    if (!e.has_clipboard()) {
      this.setActiveClipboardProfileMeta(null);
      return;
    }
    this.setActiveClipboardProfileMeta({
      profile: clampProfile(e.clipboard_profile()),
      assigned: this.snap.colorProfileAssigned,
      iccProfileBytes: cloneIccProfileBytes(this.snap.iccProfileBytes),
      iccProfileName: normalizeCustomProfileName(this.snap.iccProfileName),
    });
  }
  private activeClipboardProfileMeta(): ClipboardProfileMeta | null {
    return this.clipboardProfileMetaByDoc.get(this.activeDocId) ?? null;
  }
  private setActiveClipboardProfileMeta(meta: ClipboardProfileMeta | null) {
    if (meta) this.clipboardProfileMetaByDoc.set(this.activeDocId, meta);
    else this.clipboardProfileMetaByDoc.delete(this.activeDocId);
  }
  private profileInfoForPaste(meta: ClipboardProfileMeta | null, fallbackProfile: number): PasteProfileInfo {
    return {
      profile: meta?.profile ?? clampProfile(fallbackProfile),
      assigned: meta?.assigned ?? true,
      customName: meta?.iccProfileName ?? null,
      customProfile: !!meta?.iccProfileBytes?.length,
      customKey: iccProfileKey(meta?.iccProfileBytes),
    };
  }
  private prepareClipboardForPaste() {
    const e = this.engine.e;
    if (!e.has_clipboard()) return;
    if (!this.snap.colorProfileAssigned) return;
    const target = clampProfile(this.snap.colorProfile);
    const targetMeta: ClipboardProfileMeta = {
      profile: target,
      assigned: this.snap.colorProfileAssigned,
      iccProfileBytes: this.snap.iccProfileBytes,
      iccProfileName: this.snap.iccProfileName,
    };
    const sourceMeta = this.activeClipboardProfileMeta();
    const targetInfo = this.profileInfoForPaste(targetMeta, target);
    const sourceInfo = this.profileInfoForPaste(sourceMeta, e.clipboard_profile());
    const convertClipboard = () => {
      e.convert_clipboard_profile_with_icc(
        sourceInfo.profile,
        sourceMeta?.iccProfileBytes ?? EMPTY_ICC_PROFILE,
        target,
        targetMeta.iccProfileBytes ?? EMPTY_ICC_PROFILE,
        this.snap.colorPolicyPrefs.intent, // Color Settings' conversion options
        this.snap.colorPolicyPrefs.blackPointCompensation,
      );
      this.setActiveClipboardProfileMeta({
        profile: target,
        assigned: true,
        iccProfileBytes: cloneIccProfileBytes(targetMeta.iccProfileBytes),
        iccProfileName: normalizeCustomProfileName(targetMeta.iccProfileName),
      });
    };
    const decision = pasteProfilePolicyDecisionForInfo(targetInfo, sourceInfo, this.snap.colorPolicyPrefs.pasteProfilePolicy);
    if (decision === "convert") {
      convertClipboard();
      return;
    }
    if (decision !== "ask") return;
    const warning = pasteProfileWarningForInfo(targetInfo, sourceInfo);
    if (!warning || typeof confirm !== "function") return;
    if (!canConvertPasteProfile(targetInfo, sourceInfo)) {
      confirm(`${warning}\n\nOK preserves pasted RGB numbers.`);
      return;
    }
    const convert = confirm(`${warning}\n\nOK converts pasted pixels to the document profile (${profileName(target)}). Cancel preserves RGB numbers from ${profileName(sourceInfo.profile)}.`);
    if (convert) {
      convertClipboard();
    }
  }
  /** Every Paste's preamble: adopt a foreign pasteboard image and settle the
   *  clipboard's colour profile. Null when there is no document, adoption
   *  failed, or the document changed while the pasteboard was read. */
  async readyClipboardForPaste(): Promise<Engine | null> {
    const target = this.engine.engine, generation = this.engine.docGen;
    if (!target || !await this.adoptPasteboardImage(target, generation)
      || this.engine.engine !== target || this.engine.docGen !== generation) return null;
    if (!target.has_clipboard()) {
      this.engine.onEditError?.("Nothing to paste.");
      return null;
    }
    this.prepareClipboardForPaste();
    return target;
  }
  private async pasteFromClipboard(paste: (e: Engine) => number) {
    const target = await this.readyClipboardForPaste();
    if (target && paste(target)) this.engine.commit();
  }
  async paste() { await this.pasteFromClipboard((e) => e.paste()); }
  async pasteInPlace() {
    await this.pasteFromClipboard((e) => e.paste_in_place());
  }
  async pasteInto(outside: boolean) {
    await this.pasteFromClipboard((e) => e.paste_into(outside));
  }
  selectLayer(id?: number) {
    id = id ?? this.snap.activeLayerId;
    if (this.liquifySession && id !== this.liquifySession.targetLayerId) this.cancelLiquify();
    this.engine.e.set_active_layer(id);
    // Selecting a *different* layer commits any in-place text edit (and must
    // close the engine-side coalescing session with it).
    const te = this.snap.textEdit;
    if (te && te.id !== id) this.endTextEdit();
    this.set({
      maskEdit: false,
      maskView: "off", // the mask preview belongs to the mask you were on
      selectedLayerIds: [id], // plain click resets the multi-selection
      selectedArtboard: this.snap.artboards.some((artboard) => artboard.id === id) ? id : 0,
    });
    this.engine.e.set_mask_edit(false);
    this.engine.sync();
  }
  /** Select the previous/next layer up (delta<0) or down the stack (Photoshop
   *  Alt+] / Alt+[); `toEnd` jumps to the top/bottom row. Clamped, no-op at ends. */
  selectAdjacentLayer(delta: number, toEnd = false) {
    const layers = this.snap.layers;
    const cur = layers.findIndex((l) => l.id === this.snap.activeLayerId);
    if (cur < 0) return;
    const next = adjacentLayerIndex(cur, layers.length, delta, toEnd);
    if (next >= 0 && layers[next].id !== this.snap.activeLayerId) this.selectLayer(layers[next].id);
  }
  /** Shift/⌘-click a layer row: toggle it in the multi-selection (and make it active). */
  toggleLayerInSelection(id: number) {
    const cur = this.snap.selectedLayerIds;
    const adding = !cur.includes(id);
    const next = adding ? [...cur, id] : cur.filter((x) => x !== id);
    if (next.length === 0) next.push(id); // never empty
    const active = adding ? id : (next.includes(this.snap.activeLayerId) ? this.snap.activeLayerId : next[next.length - 1]);
    if (this.liquifySession && active !== this.liquifySession.targetLayerId) this.cancelLiquify();
    this.engine.e.set_active_layer(active);
    this.set({
      selectedLayerIds: next,
      selectedArtboard: this.snap.artboards.some((artboard) => artboard.id === active) ? active : 0,
    });
    this.engine.sync();
  }
  /** Select ▸ Find Layers: toggle the Layers-panel name filter (clears on close). */
  toggleLayerFilter() {
    const open = !this.snap.layerFilterOpen;
    this.set({ layerFilterOpen: open, layerFilter: open ? this.snap.layerFilter : "" });
  }
  setLayerFilter(s: string) {
    this.set({ layerFilter: s });
  }
  /** Select ▸ Focus Area: select the in-focus (sharp) regions. `threshold` is
   *  the In-Focus Range 0..1, `noise` the Advanced ▸ Image Noise Level 0..1,
   *  `soften` the Soften Edge radius in px. */
  selectFocusArea(threshold: number, noise = 0, soften = 0) {
    // Cast: a wasm build predating the noise/soften params ignores the extras.
    (this.engine.e as unknown as FocusAreaEngine).select_focus_area(threshold, noise, soften);
    this.engine.commit();
  }
  /** Focus Area dialog live preview: the coverage those settings select, with
   *  the dialog's add/subtract brush strokes forced on top. Pure — the live
   *  selection, undo history and canvas stay untouched. Empty on a stale wasm
   *  build, which degrades the dialog to the old blind apply. */
  focusAreaPreview(threshold: number, noise: number, soften: number, add: Uint8Array, subtract: Uint8Array): Uint8Array {
    const e = this.engine.e as unknown as FocusAreaEngine;
    if (typeof e.focus_area_preview !== "function") return new Uint8Array(0);
    return applyFocusBrushes(e.focus_area_preview(threshold, noise, soften), add, subtract);
  }
  /** Focus Area ▸ Auto: the In-Focus Range that best splits this image into
   *  blurred vs in-focus (Otsu in the engine). −1 on a stale wasm build. */
  focusAreaAutoRange(noise: number): number {
    const e = this.engine.e as unknown as FocusAreaEngine;
    return typeof e.focus_area_auto_range === "function" ? e.focus_area_auto_range(noise) : -1;
  }
  /** Commit a brush-corrected Focus Area mask, routed by Output To. ponytail:
   *  the mask path is not action-recordable (doc-sized args, like Select and
   *  Mask); the plain slider commit still goes through selectFocusArea. */
  applyFocusArea(mask: Uint8Array, output: SamOutput = "selection") {
    return this.commitSelectionOutput("Focus Area", () => this.engine.e.set_selection_mask(mask), output, false);
  }
  // ── File ▸ Open Recent ──────────────────────────────────────────
  /** Record a freshly opened/saved native path at the top of the recent list
   *  (deduplicated, capped at 10); persisted to localStorage. The entry carries
   *  a composite thumbnail and the time, for the Home start screen's grid (#476). */
  recordRecentFile(path: string) {
    if (!path) return;
    const name = path.replace(/^.*[\\/]/, "");
    const doc = this.docs.find((d) => d.savedPath === path) ?? this.activeEntry();
    let thumb: string | undefined;
    try { thumb = doc ? this.engine.docThumbUrl(doc.engine) || undefined : undefined; } catch { /* no DOM canvas: the card shows the extension instead */ }
    const next = [
      { name, path, ...(thumb ? { thumb } : {}), openedAt: Date.now() },
      ...this.snap.recentFiles.filter((r) => r.path !== path),
    ].slice(0, 10);
    this.set({ recentFiles: next });
    try { localStorage.setItem("mv.recentFiles", JSON.stringify(next)); } catch {
      // ponytail: ten PNG thumbnails can trip a tight quota — keep names/paths
      // rather than nothing; move thumbs to IndexedDB if that ever bites.
      try { localStorage.setItem("mv.recentFiles", JSON.stringify(next.map(({ thumb: _thumb, ...r }) => r))); } catch { /* storage may be unavailable */ }
    }
  }
  /** File ▸ Open Recent ▸ Clear Recent File List. */
  clearRecentFiles() {
    if (!this.snap.recentFiles.length) return;
    this.set({ recentFiles: [] });
    try { localStorage.removeItem("mv.recentFiles"); } catch { /* ignore */ }
  }
  // ── Image ▸ Variables (data-driven graphics) ────────────────────
  private adoptVariableData(value: unknown) {
    const data = normalizeVariableData(value);
    const entry = this.activeEntry();
    if (entry) Object.assign(entry, data);
    this.set(data);
  }
  setVariables(vars: AppSnapshot["variables"]) {
    const normalized = normalizeVariableData({ variables: vars }).variables;
    if (normalized.length !== vars.length || vars.some((v) => v.fit !== undefined && v.fit !== "conform") || new Set(vars.map((v) => v.layer)).size !== vars.length) throw new Error("Variables need a layer, a name and a supported type; define each layer only once.");
    for (const v of normalized) {
      const layers = this.snap.layers.filter((l) => l.name === v.layer);
      if (layers.length !== 1) throw new Error(`Rename the layer “${v.layer}” to a unique name before binding it.`);
      if (v.type === "pixel" && layers[0].kind !== LAYER_KIND.pixel) throw new Error(`Pixel Replacement requires a raster pixel layer: “${v.layer}”.`);
      if (v.type === "text" && layers[0].kind !== LAYER_KIND.text) throw new Error(`Text Replacement requires a text layer: “${v.layer}”.`);
    }
    this.set({ variables: normalized });
    const entry = this.activeEntry(); if (entry) this.dirtyEntry(entry);
  }
  setActiveDataSet(i: number) {
    if (!Number.isInteger(i)) return;
    this.set({ activeDataSet: Math.max(0, Math.min(this.snap.dataSets.length - 1, i)) });
  }
  /** Parse completely before replacing the current data sets. */
  importDataSets(csv: string, dataSetBaseDir = "") {
    const dataSets = parseVariableCsv(csv);
    this.set({ dataSets, activeDataSet: 0, dataSetBaseDir });
    const entry = this.activeEntry(); if (entry) this.dirtyEntry(entry);
  }
  /** Restore the recent list from localStorage (called once at boot). */
  loadRecentFiles() {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem("mv.recentFiles") ?? "[]");
      if (!Array.isArray(parsed)) return;
      this.set({ recentFiles: parsed.filter((r): r is AppSnapshot["recentFiles"][number] =>
        !!r && typeof r.name === "string" && typeof r.path === "string" && !!r.path,
      ).slice(0, 10).map((r) => ({
        name: r.name, path: r.path,
        ...(typeof r.thumb === "string" && r.thumb.startsWith("data:image/png;base64,") ? { thumb: r.thumb } : {}),
        ...(typeof r.openedAt === "number" && Number.isFinite(new Date(r.openedAt).getTime()) ? { openedAt: r.openedAt } : {}),
      })) });
    } catch { /* ignore */ }
  }
  // ── File ▸ Export ▸ Export Preferences ──
  /** Update the Export As format/quality and persist it. */
  setExportPrefs(patch: Partial<AppSnapshot["exportPrefs"]>) {
    const next = { ...this.snap.exportPrefs, ...patch };
    next.quality = Math.max(1, Math.min(100, Math.round(next.quality)));
    this.set({ exportPrefs: next });
    try { localStorage.setItem("mv.exportPrefs", JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  }
  /** Restore export preferences from a prior session. */
  loadExportPrefs() {
    try {
      const s = localStorage.getItem("mv.exportPrefs");
      if (s) this.set({ exportPrefs: JSON.parse(s) as AppSnapshot["exportPrefs"] });
    } catch { /* ignore */ }
  }
  // ── File ▸ Save for Web + Preferences ▸ File Handling ──
  setWebExportPrefs(patch: Partial<WebExportPrefs>) {
    const next = normalizeWebExportPrefs(patch, this.snap.webExportPrefs);
    this.set({ webExportPrefs: next });
    try { localStorage.setItem("mv.webExportPrefs", JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  }
  setFilePrefs(patch: Partial<FileHandlingPrefs>) {
    const next = normalizeFileHandlingPrefs(patch, this.snap.filePrefs);
    this.set({ filePrefs: next });
    try { localStorage.setItem("mv.filePrefs", JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  }
  loadWebAndFilePrefs() {
    try {
      const s = localStorage.getItem("mv.webExportPrefs");
      if (s) this.set({ webExportPrefs: normalizeWebExportPrefs(JSON.parse(s), DEFAULT_WEB_EXPORT_PREFS) });
    } catch { /* ignore */ }
    try {
      const s = localStorage.getItem("mv.filePrefs");
      if (s) this.set({ filePrefs: normalizeFileHandlingPrefs(JSON.parse(s), DEFAULT_FILE_HANDLING_PREFS) });
    } catch { /* ignore */ }
  }
  /** Preferences ▸ File Handling ▸ Automatically Save Recovery Information.
   *  Set by app.ts to restart the recovery timer, so the interval follows the
   *  preference no matter which surface changed it. */
  onAutoRecoverChange: (() => void) | null = null;
  /** Preferences ▸ Camera Raw ▸ save the sidecar on Open: app.ts owns the file
   *  I/O, so it writes the settings of each image Camera Raw opens. */
  onCameraRawSidecarOnOpen: ((source: CameraRawSidecarSourceSnapshot) => void) | null = null;
  setAutoRecoverMinutes(minutes: number) {
    const next = normalizeAutoRecoverMinutes(minutes);
    if (next === this.snap.autoRecoverMinutes) return;
    this.set({ autoRecoverMinutes: next });
    try { localStorage.setItem("mv.autoRecoverMinutes", String(next)); } catch { /* storage may be unavailable */ }
    this.onAutoRecoverChange?.();
  }
  loadAutoRecoverMinutes() {
    try {
      const saved = localStorage.getItem("mv.autoRecoverMinutes");
      if (saved != null) this.set({ autoRecoverMinutes: normalizeAutoRecoverMinutes(saved) });
    } catch { /* storage may be unavailable */ }
  }
  // ── Edit ▸ Color Settings policy preferences ──
  setColorPolicyPrefs(patch: Partial<ColorPolicyPrefs>) {
    const before = this.snap.colorPolicyPrefs;
    const next = normalizeColorPolicyPrefs({ ...before, ...patch }, before);
    this.set({ colorPolicyPrefs: next });
    try { localStorage.setItem("mv.colorPolicyPrefs", JSON.stringify(next)); } catch { /* storage may be unavailable */ }
    this.applyColorRendering();
    // A new blend gamma changed the composite under the panels that cache it
    // (Navigator, Histogram…); a sync hands them a new composite generation.
    // Monitor desaturation is display-only: their document data is unchanged.
    if (this.blendGammas(before).join() !== this.blendGammas(next).join() && this.engine.engine) this.engine.sync();
    // The working CMYK space is a proof input, so a change to it has to reach
    // the live canvas — otherwise the new press only takes effect on the next
    // proof toggle (#488).
    if (next.workingCmyk !== before.workingCmyk && (this.snap.proofOn || this.snap.gamutWarningOn)) {
      this.engine.setProof(this.snap.proofMode, this.snap.proofOn, this.currentProofOptions());
      this.engine.blit();
    }
  }
  loadColorPolicyPrefs() {
    try {
      const s = localStorage.getItem("mv.colorPolicyPrefs");
      if (s) this.set({ colorPolicyPrefs: normalizeColorPolicyPrefs(JSON.parse(s), DEFAULT_COLOR_POLICY_PREFS) });
    } catch { /* ignore */ }
    this.applyColorRendering();
  }
  /** Color Settings ▸ Advanced ▸ Blend RGB / Text Colors Using Gamma are
   *  compositor state, so every open document's engine takes them (a changed
   *  value recomposites, and exports then bake it); a new document's engine
   *  takes them as it is adopted. Desaturate Monitor Colors is display only. */
  private applyColorRendering() {
    for (const d of this.docs) this.applyBlendGamma(d.engine);
    const p = this.snap.colorPolicyPrefs;
    this.engine.setMonitorDesaturation(p.desaturateMonitorColors ? p.desaturateMonitorAmount : 0);
    this.engine.blit();
  }
  /** Also for a disposable clone that renders what the document shows. */
  applyBlendGamma(eng: Engine) {
    eng.set_blend_gamma?.(...this.blendGammas());
  }
  private blendGammas(p = this.snap.colorPolicyPrefs): [number, number] {
    return [p.blendRgbColorsUsingGamma ? p.blendRgbGamma : 0, p.blendTextColorsUsingGamma ? p.blendTextGamma : 0];
  }
  // ── Edit ▸ Keyboard Shortcuts ──
  setKeyboardShortcuts(value: ShortcutOverrides) {
    const next = preserveToolActionOverrides(normalizeShortcutOverrides(value));
    this.set({ keyboardShortcuts: next });
    saveShortcutOverrides(next);
  }
  setToolbarConfiguration(value: ToolbarConfiguration): boolean {
    const toolbarConfiguration = validateToolbarConfiguration(value);
    if (!this.persistAuthoredContent("mv.toolbarConfiguration", JSON.stringify(toolbarConfiguration), "toolbar configuration")) return false;
    this.set({ toolbarConfiguration, toolbarConfigurationError: "" });
    return true;
  }
  loadKeyboardShortcuts() {
    this.set({ keyboardShortcuts: loadShortcutOverrides() });
  }
  // ── Vector masks (Pen path → resolution-independent layer clip) ──
  setPenPath(p: number[]) {
    // A raw polyline replaces any bezier form — corner tools own the path now.
    this.set({ penPath: p, penAnchors: [], penContours: [] });
  }
  /** Set the work path in its bezier form; penPath becomes its flattening so
   *  every existing polyline consumer keeps working (and renders smooth).
   *  `contours` splits the anchors into closed loops (glyph outlines); penPath
   *  is then their even-odd fill polygon (workPathPolygon). */
  setPenAnchors(anchors: number[], contours: number[] = []) {
    this.set({ penAnchors: anchors, penContours: contours, penPath: workPathPolygon(anchors, contours) });
  }
  /** Whether Edit ▸ Free Transform / Transform targets the Pen work path instead
   *  of the active layer — true exactly when a path tool holds a path, which is
   *  when Photoshop reads "Free Transform Path" / "Transform Path". */
  pathIsTransformTarget(): boolean {
    return PATH_TOOLS.has(this.snap.tool) && hasPath(this.snap.penPath);
  }
  /** Edit ▸ Free Transform Path / Transform Path: scale, rotate, skew and move
   *  the work path about its bounding-box centre. A bezier work path transforms
   *  in its anchor form (handles are linear-only) so curves survive; a corner
   *  path transforms its points. Returns false when there is no path — the
   *  caller then falls back to the layer transform. Work-path geometry is
   *  session state, so like every other pen edit this takes no history step. */
  transformWorkPath(t: PathTransform): boolean {
    const b = hasPath(this.snap.penPath) ? pathBounds(this.snap.penPath) : null;
    if (!b) return false;
    const m = pathTransformMatrix(t, b.x + b.w / 2, b.y + b.h / 2);
    if (hasAnchorForm(this.snap.penAnchors)) this.setPenAnchors(transformAnchors(this.snap.penAnchors, m), this.snap.penContours);
    else this.setPenPath(transformPoints(this.snap.penPath, m));
    this.lastPathTransform = t;
    return true;
  }
  /** Edit ▸ Transform Path ▸ Again (⇧⌘T): replay the last path transform.
   *  False = nothing to replay, so Again falls through to the layer transform. */
  canRepeatWorkPathTransform(): boolean {
    return !!this.lastPathTransform && this.pathIsTransformTarget();
  }
  repeatWorkPathTransform(): boolean {
    if (!this.canRepeatWorkPathTransform()) return false;
    return this.transformWorkPath(this.lastPathTransform!);
  }
  /** Session-global, like app.ts's layer-transform `lastTransform`. */
  private lastPathTransform: PathTransform | null = null;
  // ── Paths panel (Window ▸ Paths) ────────────────────────────────
  /** Make a selection from a path (Paths panel "Make Selection…"). `mode` is the
   *  dialog's Operation group (0 New / 1 Add / 2 Subtract / 3 Intersect), `feather`
   *  its Feather Radius in px and `antialias` its Anti-aliased checkbox — all
   *  defaulting to Photoshop's dialog defaults (New, 0 px, anti-aliased on). */
  makeSelectionFromPath(path: number[], mode = 0, feather = 0, antialias = true) {
    if (!hasPath(path)) return;
    const { xs, ys } = pathXY(path);
    const e = this.engine.e;
    e.set_selection_antialias(antialias);
    e.select_polygon(Float32Array.from(xs), Float32Array.from(ys), mode);
    if (featherActive(feather)) e.feather_selection(feather);
    e.set_selection_antialias(this.snap.antiAlias); // leave the options-bar setting as the user left it
    this.engine.sync(); // selection-only op → sync (no pixel edit, no history step), like the other selection tools
  }
  /** Make a work path from the active selection (Paths panel "Make Work Path",
   *  the inverse of Make Selection). Traces the selection mask into the Pen work
   *  path, simplified by tolerance (px). No history step (it only sets penPath). */
  makeWorkPathFromSelection(tolerance = 2) {
    const e = this.engine.e;
    if (!e.has_selection()) return;
    const m = this.engine.selectionMask();
    if (!m) return;
    const { width, height } = this.snap.doc;
    const path = selectionToPath(m, width, height, tolerance);
    if (hasPath(path)) this.setPenPath(path);
  }
  /** Spot Healing Brush: heal the painted footprint (dab centers, a flat [x,y,…])
   *  from its surroundings — no source point. Builds the footprint as a temporary
   *  selection, heals it through the options bar's Type (Content-Aware /
   *  Proximity Match / Create Texture) and Sample All Layers, then restores the
   *  user's selection so it is left untouched (the undo is layer-pixels only). */
  spotHeal(points: number[], radius: number) {
    const dabs = spotHealDabs(points, radius);
    if (!dabs.length) return;
    const e = this.engine.e;
    // Copy the live mask OUT of wasm memory before select_ellipse mutates it.
    const saved = this.engine.selectionMask();
    const savedCopy = saved ? Uint8Array.from(saved) : null;
    for (const d of dabs) e.select_ellipse(d.x, d.y, d.w, d.h, d.mode);
    e.spot_heal_selection(this.snap.brush.spotHealType, this.snap.brush.spotHealSampleAll);
    if (savedCopy) e.set_selection_mask(savedCopy);
    else e.select_none();
    this.engine.commit();
  }
  /** Fill a path, leaving no selection (the Pen's pattern). `o` is the Fill Path
   *  dialog — Contents + Blending + Rendering, routed through the same fill the
   *  Edit ▸ Fill dialog uses; the defaults reproduce a plain foreground fill. */
  fillPath(path: number[], o: FillPathOptions = {}) {
    if (!hasPath(path)) return;
    const { xs, ys } = pathXY(path);
    const e = this.engine.e;
    const feather = o.feather ?? 0;
    // The selection the fill runs through is scaffolding, not history: only the
    // fill leaves an undo step, so one Undo takes Fill Path back.
    e.set_selection_antialias(o.antialias !== false);
    this.withoutHistoryStep(() => e.select_polygon(Float32Array.from(xs), Float32Array.from(ys), 0));
    if (featherActive(feather)) this.withoutHistoryStep(() => e.feather_selection(feather));
    e.set_selection_antialias(this.snap.antiAlias); // leave the options-bar setting as the user left it
    const contents = o.contents ?? "fg";
    // Content-Aware is not a flat-colour fill and ignores Preserve Transparency,
    // exactly like the Edit ▸ Fill dialog's routing.
    if (contents === "contentAware") e.content_aware_fill();
    else this.applyFill(contents, o.opacity ?? 1, o.mode ?? "normal", o.custom ?? [0, 0, 0], o.preserve ?? false);
    this.withoutHistoryStep(() => e.select_none());
    this.engine.commit();
  }
  /** Stroke a path's outline (Paths panel "Stroke Path"). `tool` is the dialog's
   *  tool picker — any painting tool, applied through the same `strokeTool` the
   *  live canvas paints with, so Clone / Smudge / Dodge / … stroke the path
   *  exactly as they would by hand (Clone still needs its source set first, like
   *  Photoshop). `simulatePressure` tapers the stroke at both ends. Outlines,
   *  does not fill. */
  strokePath(path: number[], tool?: ToolId, simulatePressure = false) {
    if (!hasPath(path)) return;
    // A work path of several loops (glyph outlines) strokes each loop on its
    // own: its penPath joins them with bridges only an even-odd fill cancels.
    const loops = path === this.snap.penPath && hasAnchorForm(this.snap.penAnchors)
      ? anchorLoops(this.snap.penAnchors, this.snap.penContours)
      : [];
    const outlines = (loops.length > 1 ? loops.map((loop) => flattenAnchorPath(loop)) : [path]).map((flat) => {
      const { xs, ys } = pathXY(flat);
      // Close the outline back to the first vertex.
      return { px: [...xs, xs[0]], py: [...ys, ys[0]] };
    });
    this.strokeTool = tool ?? null; // null = the active tool, pushBrush's default
    this.pushBrush(); // match the engine brush to that tool + the current size/hardness + foreground
    const e = this.engine.e;
    // Pressure only reaches the dab size when size dynamics are on, so Simulate
    // Pressure force-enables them for this stroke (pushBrush below restores).
    if (simulatePressure) e.set_brush_dynamics(true, this.snap.brush.flowPressure);
    const began = e.stroke_begin();
    if (began) {
      outlines.forEach(({ px, py }, k) => {
        const pressure = simulatePressure ? simulatedPressures(px, py) : null;
        for (let i = 0; i < px.length; i++) {
          // stroke_dab lifts the pen onto the next loop, so no line crosses the gap.
          if (k > 0 && i === 0) e.stroke_dab(px[i], py[i], pressure ? pressure[i] : 1);
          else e.stroke_to(px[i], py[i], pressure ? pressure[i] : 1);
        }
      });
      e.stroke_end();
      e.composite(); // a live brush composites per-dab (paintRegion); a headless stroke must composite once
    }
    this.strokeTool = null;
    this.pushBrush(); // restore the live tool's brush config (dynamics included)
    if (began) this.engine.commit(); // one history step, labelled by stroke_end (like a normal brush stroke)
  }
  /** Pen ▸ Shape mode: commit a work path as EDITABLE vector geometry instead of
   *  pixels — the only way Vision authors a kind-3 layer, and what makes the
   *  shipped Direct/Path Selection tools reachable without importing a `.artisan`
   *  file. Draws into the active vector layer when there is one (so an imported
   *  Artisan scene grows), otherwise adds a new one. Returns whether it landed —
   *  false also covers a read-only imported-Photoshop document, whose refusal
   *  `commit()` surfaces as a toast. */
  addShapeLayerFromPath(path: number[], anchors?: number[]): boolean {
    if (!hasPath(path)) return false;
    // No explicit bezier form but the caller is committing the current work
    // path → carry its curves into the scene (editable with Direct Selection).
    const a = anchors ?? (hasAnchorForm(this.snap.penAnchors) && path === this.snap.penPath ? this.snap.penAnchors : undefined);
    return this.commitShapeScene((sceneJson) => shapeSceneFromPath(path, hsvToRgba(this.snap.fg), sceneJson, a));
  }
  /** Shape tool ▸ Shape mode: commit ready-built scene items (`shapeBBoxItem` /
   *  `lineShapeItems`) as an editable kind-3 vector layer — same routing as the
   *  Pen's Shape mode, so drawing on an active vector layer grows its scene. */
  addShapeLayerItems(items: SceneItem[]): boolean {
    if (!items.length) return false;
    return this.commitShapeScene((sceneJson) => appendSceneItems(items, "mv-shape", sceneJson));
  }
  /** Grow the active vector layer's scene (or add a new vector layer) with the
   *  scene JSON `build` returns, and commit. */
  private commitShapeScene(build: (sceneJson: string) => string): boolean {
    const e = this.engine.engine;
    if (!e) return false;
    const id = this.state.activeLayerId;
    const onVector = e.layer_kind(id) === LAYER_KIND.vector;
    const before = onVector ? e.vector_scene_json(id) : "";
    const json = build(before);
    if (onVector && json === before) return false; // nothing changed — don't spend an undo step
    if (onVector) {
      // Rejected only when the document is a read-only Photoshop import (the
      // JSON is ours, so it cannot fail to parse); commit() reports that.
      try { e.vector_set_scene(id, json); } catch { /* surfaced by commit() */ }
    } else {
      e.add_vector_layer(json, `Shape ${e.layer_count()}`);
    }
    return this.engine.commit(); // marks the document dirty via onCommit
  }
  /** Save the current work path as a named path (bezier form included). */
  saveWorkPath() {
    if (!hasPath(this.snap.penPath)) return;
    const name = defaultPathName(this.snap.savedPaths.map((p) => p.name));
    const anchors = hasAnchorForm(this.snap.penAnchors) ? [...this.snap.penAnchors] : undefined;
    const contours = anchors && anchorLoops(anchors, this.snap.penContours).length > 1 ? [...this.snap.penContours] : undefined;
    const next = addPath(this.snap.savedPaths, { name, path: [...this.snap.penPath], anchors, contours });
    if (next === this.snap.savedPaths) {
      this.engine.onEditError?.("This document already has the maximum 512 saved paths.");
      return;
    }
    this.commitSavedPaths(next);
  }
  /** Saved paths are document content (they persist in the project envelope), so
   *  a change has to dirty the tab or closing it would drop them silently. */
  private commitSavedPaths(savedPaths: SavedPath[]) {
    this.markDirty();
    this.set({ savedPaths, documents: this.docSummaries() });
  }
  /** Load a saved path back as the active work path. */
  loadSavedPath(i: number) {
    const p = this.snap.savedPaths[i];
    if (p) this.set({ penPath: [...p.path], penAnchors: p.anchors ? [...p.anchors] : [], penContours: p.contours ? [...p.contours] : [] });
  }
  deleteSavedPath(i: number) {
    if (i < 0 || i >= this.snap.savedPaths.length) return;
    this.commitSavedPaths(removeAt(this.snap.savedPaths, i));
  }
  /** Paths panel ▸ Clipping Path…: mark saved path `index` as the document's
   *  clipping path at `flatness` device pixels, or clear it with `null` (the
   *  dialog's None). A PSD export names it in image resource 2999. Not undoable,
   *  like saving or deleting a path. A path that no longer exists or a flatness
   *  Photoshop cannot store is reported and changes nothing. */
  setClippingPath(index: number | null, flatness: number): boolean {
    const paths = this.snap.savedPaths;
    if (index !== null && !(Number.isInteger(index) && index >= 0 && index < paths.length)) {
      this.engine.onEditError?.("That saved path no longer exists. Choose another path for the clipping path.");
      return false;
    }
    if (index !== null && !(flatness >= MIN_CLIP_FLATNESS && flatness <= MAX_CLIP_FLATNESS)) {
      this.engine.onEditError?.(`Flatness must be between ${MIN_CLIP_FLATNESS} and ${MAX_CLIP_FLATNESS} device pixels.`);
      return false;
    }
    const next: SavedPath[] = paths.map(({ clipFlatness: _clip, ...path }, i) => (i === index ? { ...path, clipFlatness: flatness } : path));
    if (next.every((path, i) => path.clipFlatness === paths[i].clipFlatness)) return true;
    this.commitSavedPaths(next);
    return true;
  }
  /** Clear the current work path (Paths panel ▸ Delete Work Path). */
  deleteWorkPath() {
    this.set({ penPath: [], penAnchors: [], penContours: [] });
  }
  // ── Layer Comps panel (Window ▸ Layer Comps) ───────────────────────
  private commitLayerComps(layerComps: LayerComp[]) {
    if (layerComps === this.snap.layerComps) return;
    this.markDirty();
    this.set({ layerComps, documents: this.docSummaries() });
  }
  /** Snapshot the current layers' visibility, position, and appearance. */
  private captureCompLayers() {
    const e = this.engine.e;
    return this.snap.layers.map((l) => {
      const [x = 0, y = 0] = e.layer_offset(l.id);
      return { id: l.id, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, offset: [x, y] as [number, number], style: this.captureStyle(l.id) };
    });
  }
  /** New Layer Comp: save the current layer state under an auto-numbered name. */
  saveLayerComp() {
    const name = defaultLayerCompName(this.snap.layerComps.map((c) => c.name));
    const next = addLayerComp(this.snap.layerComps, { name, layers: this.captureCompLayers() });
    if (next === this.snap.layerComps) {
      this.engine.onEditError?.(`Could not save the Layer Comp because the document is limited to ${MAX_LAYER_COMPS} comps, ${MAX_LAYERS_PER_COMP} layers per comp, and ${MAX_LAYER_STATES} captured layer states.`);
      return;
    }
    this.commitLayerComps(next);
  }
  /** Restore a comp into any engine (the live document or an export clone). */
  applyLayerCompToEngine(e: Engine, comp: LayerComp) {
    const live = comp.layers.filter((layer) => e.layer_offset(layer.id).length === 2);
    if (!live.length) return;
    e.apply_layer_comp(
      Uint32Array.from(live.map((layer) => layer.id)),
      Uint8Array.from(live.map((layer) => layer.visible ? 1 : 0)),
      Float32Array.from(live.map((layer) => layer.opacity / 100)),
      Uint8Array.from(live.map((layer) => blendIndex(layer.blendMode))),
      Int32Array.from(live.flatMap((layer) => layer.offset ?? Array.from(e.layer_offset(layer.id)))),
      Float32Array.from(live.map((layer) => (layer.style?.fillOpacity ?? e.layer_fill_opacity(layer.id) * 100) / 100)),
    );
    for (const layer of live) {
      if (!layer.style) continue;
      // Full replace, not a whole-type collapse: clear the layer's stack, then
      // re-push each instance at its own index via set_layer_effect_at so a
      // stacked stroke/shadow survives the comp round trip.
      e.clear_layer_effects(layer.id);
      this.applyStyleEffects(e, layer.id, layer.style.effects);
      e.set_layer_blend_if(layer.id, Float32Array.from(layer.style.blendIf));
    }
  }
  /** Apply a saved comp to the live document in one history step. */
  applyLayerComp(i: number) {
    const comp = this.snap.layerComps[i];
    if (!comp) return;
    this.applyLayerCompToEngine(this.engine.e, comp);
    this.engine.commit();
  }
  /** Re-capture the current layer state into an existing comp (keeps its name and options). */
  updateLayerComp(i: number) {
    const c = this.snap.layerComps[i];
    if (!c) return;
    const next = this.snap.layerComps.slice();
    next[i] = { ...c, layers: this.captureCompLayers() };
    this.commitLayerComps(next);
  }
  deleteLayerComp(i: number) {
    this.commitLayerComps(removeLayerCompAt(this.snap.layerComps, i));
  }
  /** Layer Comp Options: rename, comment, and which attributes the comp applies. */
  setLayerCompOptions(i: number, patch: Partial<LayerComp>) {
    const c = this.snap.layerComps[i];
    if (!c) return;
    const next = this.snap.layerComps.slice();
    next[i] = { ...c, ...patch };
    this.commitLayerComps(next);
  }

  // ── History Snapshots (named full-document checkpoints) ──────────
  // Photoshop draws a thumbnail beside each snapshot (the states below it get an
  // icon, not a thumbnail). Captured once, at snapshot time — the checkpoint's
  // bytes are the truth, so a re-render never has to rebuild the whole document
  // to draw its row. Keyed by snapshot id, which is monotone and never reused.
  private snapshotThumbs = new Map<number, string>();
  /** Pre-revert project bytes, keyed by document. Edit ▸ Undo consumes one. */
  private revertUndo = new Map<number, { bytes: Uint8Array; document: ProjectDocumentMeta | null; dirty: boolean }>();

  /** Keep the active document's current project so Revert can be undone.
   *  Returns false when the project cannot be serialized — the caller then
   *  confirms before an irreversible reload. */
  captureRevertUndo(): boolean {
    const d = this.activeEntry();
    if (!d) return false;
    try {
      this.revertUndo.set(d.id, {
        bytes: this.engine.projectBytes(d.engine),
        document: this.docDocumentMeta(d.id),
        dirty: d.dirty,
      });
      return true;
    } catch {
      this.revertUndo.delete(d.id);
      return false;
    }
  }
  discardRevertUndo(id = this.activeDocId) {
    this.revertUndo.delete(id);
  }

  private activeSnapshots(): DocSnapshot[] {
    return this.snapshotsByDoc.get(this.activeDocId) ?? [];
  }
  /** Decorate stored snapshots with their captured thumbnails for the panel. */
  private snapshotRows(list: DocSnapshot[]): SnapshotRow[] {
    return list.map((s) => ({ ...s, thumb: this.snapshotThumbs.get(s.id) ?? "" }));
  }
  /** Drop a closed document's checkpoints and their thumbnails. */
  private forgetDocSnapshots(docId: number) {
    for (const s of this.snapshotsByDoc.get(docId) ?? []) this.snapshotThumbs.delete(s.id);
    this.snapshotsByDoc.delete(docId);
  }
  /** New Snapshot: capture the whole active document under an auto/explicit name. */
  takeSnapshot(name?: string): number {
    return this.snapshotDoc(this.activeDocId, name);
  }
  /** Capture any open document as a snapshot — the automatic History Options fire
   *  for documents that need not be the active tab. Returns 0 (never a real id)
   *  when the capture fails: a snapshot is a convenience, never a reason to fail
   *  the open or save that triggered it. */
  private snapshotDoc(docId: number, name?: string): number {
    const d = this.docs.find((x) => x.id === docId);
    if (!d) return 0;
    const list = this.snapshotsByDoc.get(docId) ?? [];
    let bytes: Uint8Array;
    try { bytes = this.engine.projectBytes(d.engine); }
    catch { return 0; }
    const snap: DocSnapshot = {
      id: this.nextSnapshotId++,
      name: name?.trim() || defaultSnapshotName(list.map((s) => s.name)),
      bytes,
    };
    // A thumbnail is decoration: a headless/canvas-less host still gets the
    // checkpoint, just without a preview.
    try { this.snapshotThumbs.set(snap.id, this.engine.docThumbUrl(d.engine, SNAPSHOT_THUMB_W, SNAPSHOT_THUMB_H)); }
    catch { /* no canvas (node/headless) → the row draws its placeholder */ }
    const next = addSnapshot(list, snap);
    this.snapshotsByDoc.set(docId, next);
    if (docId === this.activeDocId) this.set({ snapshots: this.snapshotRows(next) });
    return snap.id;
  }
  /** Restore a snapshot: replace the document with that checkpoint. Like Revert,
   *  this resets the linear history; the snapshot list itself is preserved.
   *
   *  The engine has no in-place project load — `load_project` builds a fresh
   *  Engine and `load_graphics` replaces `*self`, both dropping the undo stack —
   *  so a restore cannot become an undoable step without engine support. Instead
   *  the pre-restore state is captured as its own checkpoint first (#511), so one
   *  click can never irreversibly discard the edits made since the snapshot. */
  restoreSnapshot(id: number) {
    const snap = this.activeSnapshots().find((s) => s.id === id);
    if (!snap) return;
    // Capture BEFORE the swap: revertActiveDoc replaces the engine and clears
    // history, so this is the only chance to keep the current state recoverable.
    this.snapshotDoc(this.activeDocId, `Before "${snap.name}"`);
    // A snapshot is unsaved in-memory state: restoring it leaves the document
    // DIFFERENT from what is on disk, so it stays dirty. (#27)
    this.revertActiveDoc(this.engine.buildProject(snap.bytes), this.docDocumentMeta(this.activeDocId), { dirty: true });
    this.set({ snapshots: this.snapshotRows(this.activeSnapshots()) });
  }
  deleteSnapshot(id: number) {
    const next = removeSnapshot(this.activeSnapshots(), id);
    this.snapshotsByDoc.set(this.activeDocId, next);
    this.snapshotThumbs.delete(id);
    this.set({ snapshots: this.snapshotRows(next) });
  }
  /** Layer ▸ Vector Mask ▸ Current Path: clip the active layer to the pen path.
   *  A bezier work path is handed over as true curves, so the stored mask
   *  outline stays smooth (and exports as `C` segments) instead of faceting.
   *  `op` is a path operation folded into any existing vector mask — 0 Combine ·
   *  1 Subtract Front · 2 Intersect · 3 Exclude Overlapping, mirroring
   *  combineShapes's modes — via the engine's combine_layer_vector_mask*;
   *  omitted (or out of range), it replaces the mask outright via
   *  set_layer_vector_mask*, today's default behavior. */
  addVectorMaskFromPath(op?: number) {
    const id = this.snap.activeLayerId;
    const hasOp = op !== undefined && op >= 0 && op <= 3;
    const loops = anchorLoops(this.snap.penAnchors, this.snap.penContours).length;
    // Several loops under a path operation take the polygon branch below: the
    // boolean's even-odd fill cancels the bridges joining them in penPath.
    if (hasAnchorForm(this.snap.penAnchors) && !(hasOp && loops > 1)) {
      const anchors = Float32Array.from(this.snap.penAnchors);
      if (loops > 1) {
        // Glyph loops stay separate bezier contours, so a counter stays a hole.
        this.engine.e.set_layer_vector_mask_bezier_loops(id, anchors, Uint32Array.from(this.snap.penContours));
      } else if (hasOp) {
        if (!this.engine.e.combine_layer_vector_mask_bezier(id, anchors, op)) return;
      } else {
        this.engine.e.set_layer_vector_mask_bezier(id, anchors);
      }
      this.engine.commit();
      this.set({ penPath: [], penAnchors: [], penContours: [] });
      return;
    }
    const p = this.snap.penPath;
    if (p.length < 6) return; // need ≥3 points
    const n = p.length / 2;
    const xs = new Float32Array(n), ys = new Float32Array(n);
    for (let i = 0; i < n; i++) { xs[i] = p[i * 2]; ys[i] = p[i * 2 + 1]; }
    if (hasOp) {
      if (!this.engine.e.combine_layer_vector_mask(id, xs, ys, op)) return;
    } else {
      this.engine.e.set_layer_vector_mask(id, xs, ys);
    }
    this.engine.commit();
    this.set({ penPath: [], penAnchors: [], penContours: [] });
  }
  /** Layer ▸ Vector Mask ▸ Delete. */
  deleteVectorMask() {
    this.engine.e.delete_vector_mask(this.snap.activeLayerId);
    this.engine.commit();
  }
  /** Layer ▸ Rasterize ▸ Vector Mask: keep the mask, drop the path. */
  rasterizeVectorMask() {
    if (!this.engine.e.rasterize_vector_mask(this.snap.activeLayerId)) return;
    this.engine.commit();
  }
  private applyTypeOutline(shape: boolean): boolean {
    const e = this.engine.e;
    const id = this.snap.activeLayerId;
    const spec = e.layer_text_spec(id);
    if (!spec) return false;
    let parsed: TextSpec;
    try { parsed = { ...defaultSpec(), ...JSON.parse(spec) } as TextSpec; }
    catch { return false; }
    const scene = typeOutlineScene(parsed, (json) => e.outline_text_scene(json));
    if (!scene) {
      // No registered outline for the font. Tracing its pixels would give the
      // corner-only staircase these commands exist to replace, so refuse.
      this.engine.onEditError?.(`${shape ? "Convert to Shape" : "Create Work Path"} needs outline data for this layer's font, and none is available. Choose an installed font and try again.`);
      return true;
    }
    e.set_type_outline(id, scene, shape);
    // A refused edit (a locked layer) is already reported; keep the old work path.
    if (!this.engine.commit() || shape) return true;
    // Create Work Path: the glyph loops become the Paths panel's work path, in
    // canvas space like the engine's copy (layer-local points + layer offset).
    type Pt = { x?: number; y?: number } | undefined;
    const doc = JSON.parse(scene) as { layers?: { items?: { subpaths?: { closed?: boolean; anchors?: { point?: Pt; handleIn?: Pt; handleOut?: Pt }[] }[] }[] }[] };
    const [ox = 0, oy = 0] = e.layer_offset(id);
    const anchors: number[] = [];
    const lens: number[] = [];
    for (const layer of doc.layers ?? []) for (const item of layer.items ?? []) for (const g of item.subpaths ?? []) {
      const loop = (g.anchors ?? []).flatMap((a) => [
        (a.point?.x ?? 0) + ox, (a.point?.y ?? 0) + oy,
        a.handleIn?.x ?? 0, a.handleIn?.y ?? 0, a.handleOut?.x ?? 0, a.handleOut?.y ?? 0,
      ]);
      // The engine's rule for a usable contour: ≥2 anchors enclosing ≥3 points.
      if (!g.closed || loop.length < 2 * ANCHOR_STRIDE || flattenAnchorPath(loop).length < 6) continue;
      anchors.push(...loop);
      lens.push(loop.length / ANCHOR_STRIDE);
    }
    if (lens.length) this.setPenAnchors(anchors, lens);
    return true;
  }
  /** Type ▸ Create Work Path: the rendered glyph outlines, with real handles,
   *  become the work path (Paths panel row, canvas outline, Direct Selection). */
  createWorkPath() {
    if (!this.applyTypeOutline(false)) this.engine.onEditError?.("Create Work Path needs a type layer. Select a type layer first.");
  }
  /** Type ▸ Convert to Shape: preserve glyph layout in an editable vector layer. */
  convertToShape() {
    if (!this.applyTypeOutline(true)) this.engine.onEditError?.("Convert to Shape needs a type layer. Select a type layer first.");
  }
  /** Layer ▸ Rasterize ▸ Shape: drop a shape layer's vector outline (its pixels
   *  remain). Kind-3 vector layers drop their editable scene; legacy traced
   *  outlines fall back to the path-clearing vector-mask routine. */
  rasterizeShape() {
    const id = this.snap.activeLayerId;
    const changed = this.engine.e.layer_kind(id) === LAYER_KIND.vector
      ? this.engine.e.rasterize_vector_layer(id)
      : this.engine.e.rasterize_vector_mask(id);
    if (!changed) return;
    this.engine.commit();
  }
  /** Selected visible pixel layers that are neither locked nor position-locked. */
  private alignableSelectedIds(): number[] {
    return this.snap.selectedLayerIds.filter((id) => {
      const layer = this.snap.layers.find((l) => l.id === id);
      return !!layer && layer.kind === LAYER_KIND.pixel && layer.visible && !layer.locked && ((layer.locks ?? 0) & 4) === 0;
    });
  }
  /** Edit ▸ Auto-Align Layers: translation-register the selected pixel layers. */
  autoAlignLayers() {
    const align = this.engine.e.auto_align_layers as unknown as (ids: Uint32Array) => void;
    align(Uint32Array.from(this.alignableSelectedIds()));
    this.engine.commit();
  }
  /** Edit ▸ Auto-Blend Layers: focus-stack the selected pixel layers. */
  autoBlendLayers() {
    const blend = this.engine.e.auto_blend_layers as unknown as (ids: Uint32Array) => void;
    blend(Uint32Array.from(this.alignableSelectedIds()));
    this.engine.commit();
  }
  /** File ▸ Automate ▸ Photomerge: register + feather-blend the visible layers
   *  into a single panorama layer. */
  photomerge() {
    this.engine.e.photomerge();
    this.engine.commit();
  }
  /** Layer ▸ Combine Shapes. On a kind-3 shape layer this is a REAL path
   *  boolean over the layer's components (the vector pathfinder), so the result
   *  stays editable geometry; anywhere else it falls back to the destructive
   *  alpha combine with the layer below — the only thing pixels can do.
   *  mode 0 unite · 1 subtract front · 2 intersect · 3 exclude. */
  combineShapes(mode: number) {
    const e = this.engine.engine;
    if (!e) return;
    const id = this.snap.activeLayerId;
    if (e.layer_kind(id) === LAYER_KIND.vector) {
      const ids = sceneComponentIds(e.vector_scene_json(id));
      // ponytail: one component is a no-op — combining ACROSS two shape layers
      // would mean merging their scenes, which needs an engine-side op to stay
      // one undo step; the Shape/Pen tools grow one layer's scene, so this is
      // the shape the components arrive in.
      if (ids.length < 2) return;
      e.vector_boolean(id, JSON.stringify(ids), BOOLEAN_OPS[mode] ?? BOOLEAN_OPS[0]);
      this.engine.commit();
      return;
    }
    e.combine_shapes(mode);
    this.engine.commit();
  }
  /** Layer ▸ Merge Shape Components: unite a shape layer's path components into
   *  ONE compound path. Vector-only — a pixel layer has no components, and the
   *  raster fallback would eat the layer below it. */
  mergeShapeComponents() {
    const e = this.engine.engine;
    if (!e || e.layer_kind(this.snap.activeLayerId) !== LAYER_KIND.vector) return;
    this.combineShapes(0);
  }
  /** Image ▸ Trap: spread lighter colours into darker at edges by `width` px. */
  trap(width: number) {
    this.engine.e.trap(Math.max(1, Math.round(width)));
    this.engine.commit();
  }
  /** Layer ▸ New ▸ Artboard: a bounds-clipped, white-backed group at (0,0,w,h). */
  newArtboard(w: number, h: number) {
    // `nextArtboardName` exists precisely so two artboards cannot share a name;
    // only the Artboard tool was using it. Export writes one file per name, so
    // duplicates overwrote each other on Export Artboards To Files.
    this.engine.e.new_artboard(0, 0, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), this.nextArtboardName());
    this.engine.commit();
  }
  /** A document-unique artboard name ("Artboard N", N = lowest free index). */
  private nextArtboardName(): string {
    const used = new Set(this.snap.artboards.map((a) => a.name));
    let n = 1;
    while (used.has(`Artboard ${n}`)) n++;
    return `Artboard ${n}`;
  }
  /** Artboard tool: create an EMPTY artboard of the dragged bounds (wraps no
   *  layer) and select it. Returns the new artboard id. */
  createArtboardRect(x: number, y: number, w: number, h: number): number {
    const id = this.engine.e.new_artboard_rect(
      Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), this.nextArtboardName(),
    );
    this.set({ selectedArtboard: id, selectedLayerIds: [id] });
    this.engine.commit();
    return id;
  }
  /** Artboard tool options bar ("Add Artboard"): create a preset-sized artboard,
   *  oriented per the options bar, offset so successive ones don't fully overlap. */
  createArtboardPreset(): number {
    const size = presetSize(this.snap.artboardPreset, this.snap.artboardOrientation)
      ?? { w: this.snap.doc.width || 1280, h: this.snap.doc.height || 800 };
    const off = (this.snap.artboards.length % 8) * 24;
    return this.createArtboardRect(off, off, size.w, size.h);
  }
  /** Artboard tool: move/resize an artboard. A pure move (size kept) drags its
   *  child layers along; a resize only reframes (engine-side semantics). */
  setArtboardBounds(id: number, x: number, y: number, w: number, h: number) {
    if (this.engine.e.set_artboard_bounds(id, Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))) {
      this.engine.commit();
    }
  }
  /** Layers panel drop / context menu: re-parent an existing layer into an
   *  artboard (0 = back to the document root). Canvas Move drags re-home
   *  automatically in the engine (`commit_offset` → auto-adopt). */
  moveLayerToArtboard(id: number, artboardId: number) {
    if (this.engine.e.move_layer_to_artboard(id, artboardId)) this.engine.commit();
  }
  /** Select an artboard in both models; 0/unknown clears only the overlay. */
  setSelectedArtboard(id: number) {
    const next = this.snap.artboards.some((a) => a.id === id) ? id : 0;
    const alreadySelected = next === this.snap.selectedArtboard
      && next === this.snap.activeLayerId
      && this.snap.selectedLayerIds.length === 1
      && this.snap.selectedLayerIds[0] === next;
    if (next) {
      if (!alreadySelected) this.selectLayer(next);
    } else if (this.snap.selectedArtboard) this.set({ selectedArtboard: 0 });
  }
  /** Artboard tool: delete the selected artboard and its contents (Delete key). */
  deleteSelectedArtboard() {
    const id = this.snap.selectedArtboard;
    if (!id) return;
    this.engine.e.delete_artboard(id);
    this.set({ selectedArtboard: 0 });
    this.engine.commit();
  }
  /** Layer ▸ New ▸ Artboard from Layers: artboard sized to the active layer. */
  artboardFromLayers() {
    this.engine.e.artboard_from_layers(this.nextArtboardName());
    this.engine.commit();
  }
  /** Layer ▸ New ▸ Artboard from Group: tag the active group as an artboard. */
  artboardFromGroup() {
    this.engine.e.artboard_from_group();
    this.engine.commit();
  }
  /** A document-unique frame name ("Frame N", N = lowest free index), mirroring
   *  `nextArtboardName`. Every constructor used to hardcode "Frame 1", so the
   *  Layers panel filled up with frames sharing one name. */
  private nextFrameName(): string {
    const used = new Set(this.snap.layers.map((l) => l.name));
    let n = 1;
    while (used.has(`Frame ${n}`)) n++;
    return `Frame ${n}`;
  }
  /** Layer ▸ New ▸ Frame: a transparent bounds-clipped container. */
  newFrame() {
    this.engine.e.new_frame(this.nextFrameName());
    this.engine.commit();
  }
  /** Frame tool (K): create an empty placeholder frame of the dragged bounds —
   *  rectangular or elliptical per `frameMode`. Returns the new frame id (0 if
   *  the rect was degenerate). Unlike newFrame() this wraps no existing layer. */
  createFrame(x: number, y: number, w: number, h: number): number {
    const fw = Math.max(1, Math.round(w));
    const fh = Math.max(1, Math.round(h));
    const fx = Math.round(x);
    const fy = Math.round(y);
    const name = this.nextFrameName();
    const id = this.snap.frameMode === "ellipse"
      ? this.engine.e.new_frame_ellipse(fx, fy, fw, fh, name)
      : this.engine.e.new_frame_rect(fx, fy, fw, fh, name);
    this.engine.commit();
    return id;
  }
  /** The id of the frame to fill, derived from the active layer: the active
   *  layer if it IS a frame container, else the frame group it sits inside, else
   *  0 (no target). */
  activeFrameId(): number {
    const E = this.engine.engine;
    if (!E) return 0;
    const id = this.snap.activeLayerId;
    if (E.frame_bounds(id).length >= 4) return id;
    const g = E.layer_group(id);
    if (g && E.frame_bounds(g).length >= 4) return g;
    return 0;
  }
  /** Frame tool: place a decoded image INTO a frame — import it as a layer,
   *  centre it on the frame bounds, and reparent it as a clipped member. Returns
   *  the new image layer id (0 if `frameId` isn't a frame). */
  fillFrame(frameId: number, bytes: Uint8Array, name: string): number {
    const E = this.engine.e;
    const b = Array.from(E.frame_bounds(frameId));
    if (b.length < 4) return 0;
    const imageId = E.importImage(bytes, name);
    const cb = Array.from(E.active_layer_bounds()); // imported content bbox [x,y,w,h]
    const off = frameFillOffset(
      { x: b[0], y: b[1], w: b[2], h: b[3] },
      { x: cb[0] || 0, y: cb[1] || 0, w: cb[2] || 0, h: cb[3] || 0 },
    );
    E.set_layer_group(imageId, frameId);
    E.set_layer_offset(imageId, off.dx, off.dy);
    this.engine.commit();
    return imageId;
  }
  /** Layer ▸ Vector Mask ▸ Reveal All / Hide All. */
  addVectorMaskRevealAll() {
    this.engine.e.add_vector_mask_reveal_all(this.snap.activeLayerId);
    this.engine.commit();
  }
  addVectorMaskHideAll() {
    this.engine.e.add_vector_mask_hide_all(this.snap.activeLayerId);
    this.engine.commit();
  }
  /** Layer ▸ Vector Mask ▸ Enable / Disable (toggles; needs a vector mask). */
  toggleVectorMaskEnabled() {
    const id = this.snap.activeLayerId;
    if (!this.engine.e.has_vector_mask(id)) return;
    this.engine.e.set_layer_mask_enabled(id, !this.engine.e.layer_mask_enabled(id));
    this.engine.commit();
  }
  /** Layer ▸ Vector Mask ▸ Link / Unlink (needs a vector mask). */
  toggleVectorMaskLinked() {
    const id = this.snap.activeLayerId;
    if (!this.engine.e.has_vector_mask(id)) return;
    this.engine.e.set_layer_mask_linked(id, !this.engine.e.layer_mask_linked(id));
    this.engine.commit();
  }
  /** Select ▸ All Layers / Deselect Layers. */
  selectAllLayers() {
    this.set({ selectedLayerIds: this.snap.layers.map((l) => l.id) });
  }
  deselectLayers() {
    this.set({ selectedLayerIds: [this.snap.activeLayerId] });
  }
  /** Layer ▸ Link Layers: toggle the selected layers' shared link set (linked
   *  layers move/nudge together). Needs ≥2 selected to link. */
  linkLayers() {
    const ids = this.snap.selectedLayerIds;
    const e = this.engine.e;
    const allLinked = ids.length >= 2 && ids.every((id) => e.is_linked(id));
    if (allLinked) e.unlink_layers(new Uint32Array(ids));
    else e.link_layers(new Uint32Array(ids));
    this.engine.commit();
  }
  /** Layer ▸ Select Linked Layers: multi-select the active layer's link set. */
  selectLinkedLayers() {
    const set = Array.from(this.engine.e.linked_layers(this.snap.activeLayerId)) as number[];
    if (set.length) this.set({ selectedLayerIds: set });
  }
  setLayerVisible(id: number, v: boolean) {
    // History Options ▸ Make Layer Visibility Changes Undoable. The engine always
    // pushes a "Visibility" state, so when the option is off (Photoshop's default)
    // the toggle runs without leaving one behind.
    const e = this.engine.e;
    if (this.snap.historyOptions.layerVisibilityUndoable) {
      e.set_layer_visible(id, v);
    } else {
      this.withoutHistoryStep(() => e.set_layer_visible(id, v));
    }
    this.engine.commit();
  }
  /** Run an engine edit and undo-log nothing: drop the state it pushed, if any.
   *  The cap is lifted first because a push at the History-States limit evicts
   *  the OLDEST state — dropping the new one would then silently cost the user a
   *  real edit. Nothing is dropped when the edit pushed no state (a no-op change,
   *  or a read-only imported Photoshop source), which would eat the prior edit. */
  private withoutHistoryStep(edit: () => void) {
    const e = this.engine.e;
    e.set_history_states(HISTORY_STATES_MAX);
    const before = e.undo_pushes();
    try {
      edit();
      if (e.undo_pushes() > before) {
        e.drop_last_undo();
        // Vanishing Point collapses its session by counting pushes; this one is gone.
        const vp = this.vpSession;
        if (vp && vp.engine === e) vp.pushes++;
      }
    } finally {
      e.set_history_states(this.snap.historyStates);
    }
  }
  /** Layer ▸ Align: shift the active layer's content to a canvas edge/centre.
   *  mode 0 left, 1 h-centre, 2 right, 3 top, 4 v-centre, 5 bottom. */
  alignLayer(mode: number) {
    const ids = this.snap.selectedLayerIds;
    if (ids.length >= 2) {
      // Multi-layer: align relative to the group (Photoshop). mode 0-2 = horizontal
      // (left/centre/right), 3-5 = vertical (top/middle/bottom); key = mode % 3.
      this.engine.e.align_layers(new Uint32Array(ids), mode < 3 ? 0 : 1, mode % 3);
    } else {
      this.engine.e.align_layer(mode); // single layer → align to the canvas
    }
    this.engine.commit();
  }
  setLayerOpacity(id?: number, pct?: number) {
    if (pct == null || !Number.isFinite(pct)) return;
    this.engine.e.set_layer_opacity(id ?? this.snap.activeLayerId, pct / 100);
    this.engine.commit();
  }
  setLayerBlend(id?: number, kebab?: string) {
    if (!kebab) return;
    this.engine.e.set_layer_blend(id ?? this.snap.activeLayerId, blendIndex(kebab));
    this.engine.commit();
  }
  setLayerLocked(id: number, locked: boolean) {
    this.engine.e.set_layer_locked(id, locked);
    this.markDirty();
    this.engine.sync();
  }

  /** Photoshop's per-attribute locks as a bitfield: 1 transparent pixels ·
   *  2 image pixels · 4 position. Independent of Lock All above. */
  setLayerLocks(id: number, flags: number) {
    const e = this.engine.e as unknown as { set_layer_locks?: (id: number, f: number) => void };
    if (typeof e.set_layer_locks !== "function") return;
    e.set_layer_locks(id, flags & 7);
    this.markDirty();
    this.engine.sync();
  }

  /** The layer's lock bitfield (0 on a wasm build without per-attribute locks). */
  layerLocks(id: number): number {
    const e = this.engine.e as unknown as { layer_locks?: (id: number) => number };
    return typeof e.layer_locks === "function" ? e.layer_locks(id) : 0;
  }
  /** Layers panel: tag a layer with a colour label (client-side, keyed by id).
   *  The map belongs to the active document — captureActiveView/activateDoc swap
   *  it per tab, since layer ids repeat across engines (#144). */
  setLayerColorLabel(id: number, label: LayerLabel) {
    this.set({ layerColorLabels: setLabel(this.snap.layerColorLabels, id, label) });
  }
  /** Layers panel: toggle a colour in the "Filter for layer color" selection. */
  toggleLayerColorFilter(label: LayerLabel) {
    this.set({ layerColorFilter: toggleColorFilter(this.snap.layerColorFilter, label) });
  }
  /** Layer ▸ Layer Style ▸ Create Layer: extract each effect into its own layer. */
  createLayersFromStyle() {
    this.engine.e.create_layers_from_style(this.snap.activeLayerId);
    this.engine.commit();
  }
  /** Layer ▸ Rasterize ▸ Layer Style: bake the active layer's effects into pixels. */
  rasterizeLayerStyle() {
    this.engine.e.rasterize_layer_style(this.state.activeLayerId);
    this.engine.commit();
  }
  /** Layer ▸ Layer Style ▸ Hide/Show All Effects (document-wide). */
  toggleEffectsVisible() {
    this.engine.e.set_effects_visible(!this.engine.e.effects_visible());
    this.engine.commit();
  }
  /** Layer ▸ Create Clipping Mask: clip the active layer to the one below it. */
  setClipping(id: number, clip: boolean) {
    this.engine.e.set_layer_clipping(id, clip);
    this.engine.commit();
  }
  /** Whether `id` is clipping-masked. */
  layerClipping(id: number): boolean {
    return this.engine.e.layer_clipping(id);
  }
  /** Layer ▸ Create/Release Clipping Mask (⌥⌘G): a toggle, like Photoshop's. */
  toggleClipping(id = this.state.activeLayerId) {
    this.setClipping(id, !this.layerClipping(id));
  }
  renameLayer(id: number, name: string) {
    this.engine.e.set_layer_name(id, name);
    this.markDirty();
    this.engine.sync();
  }
  moveLayer(id: number, toVisual: number) {
    this.engine.e.move_layer(id, toVisual);
    this.engine.commit();
  }
  /** Layers-panel tree drop: reorder and reparent in one engine history step.
   *  position: 0 before target · 1 inside target group · 2 after target. */
  moveLayerInTree(id: number, targetId: number, position: 0 | 1 | 2): boolean {
    const moved = this.engine.e.move_layer_in_tree(id, targetId, position);
    if (moved) this.engine.commit();
    return moved;
  }
  // Layer ▸ Arrange — dir: 0 Bring to Front · 1 Bring Forward · 2 Send Backward · 3 Send to Back.
  arrangeLayer(dir: number) {
    this.engine.e.arrange_layer(this.state.activeLayerId, dir);
    this.engine.commit();
  }
  /** Layer ▸ Arrange ▸ Reverse: flip the whole layer stack order. */
  reverseLayers() {
    this.engine.e.reverse_layers();
    this.engine.commit();
  }
  /** Edit ▸ Purge: free undo/redo history, clipboard and pattern. */
  purge() {
    this.engine.e.purge();
    this.setActiveClipboardProfileMeta(null);
    this.engine.sync();
  }
  /** File ▸ Scripts ▸ Delete All Empty Layers. */
  deleteEmptyLayers(): number {
    const before = this.engine.e.layer_count();
    this.engine.e.delete_empty_layers();
    this.engine.commit();
    return Math.max(0, before - this.engine.e.layer_count());
  }
  /** Layer ▸ Auto-Name Layers: assign descriptive names from kind/state. */
  autoNameLayers(onlyGeneric = false): number {
    const updates = autoNameLayerUpdates(this.snap.layers, { onlyGeneric });
    if (!updates.length) return 0;
    // One snapshot for the whole sweep, then the untracked setter — renaming
    // N layers is one user action and must cost exactly one undo step.
    if (!this.beginHistory("Auto-Name Layers")) return 0;
    for (const u of updates) this.engine.e.set_layer_name_untracked(u.id, u.name);
    return this.commitHistory() ? updates.length : 0;
  }
  /** Layer Cleanup: delete empty pixel layers and optionally auto-name the
   *  resulting stack in one user-facing workflow. */
  cleanupLayers(opts: { deleteEmpty?: boolean; autoName?: boolean; onlyGeneric?: boolean } = {}): { deleted: number; renamed: number } {
    const deleteEmpty = opts.deleteEmpty ?? true;
    const autoName = opts.autoName ?? true;
    const deleted = deleteEmpty ? this.deleteEmptyLayers() : 0;
    const renamed = autoName ? this.autoNameLayers(opts.onlyGeneric ?? true) : 0;
    return { deleted, renamed };
  }
  /** File ▸ Scripts ▸ Flatten All Masks. */
  flattenAllMasks() {
    this.engine.e.apply_all_masks();
    this.engine.commit();
  }
  /** File ▸ Scripts ▸ Flatten All Layer Effects. */
  flattenAllLayerEffects() {
    this.engine.e.flatten_all_layer_effects();
    this.engine.commit();
  }
  /** File ▸ Scripts ▸ Statistics: combine the visible layers into a new layer by
   *  a per-pixel stack statistic (0 mean … 6 stddev). */
  stackStatistic(mode: number) {
    this.engine.e.stack_statistic(mode);
    this.engine.commit();
  }
  mergeDown(id?: number) {
    this.engine.e.merge_down(id ?? this.snap.activeLayerId);
    this.engine.commit();
  }
  /** Layer ▸ Merge Visible: collapse all visible layers, keep hidden ones. */
  mergeVisible() {
    this.engine.e.merge_visible();
    this.engine.commit();
  }
  flatten() {
    this.engine.e.flatten();
    this.engine.commit();
  }
  createGroup() {
    const e = this.engine.e;
    const id = e.create_group(`Group ${e.layer_count()}`);
    e.set_layer_blend(id, blendIndex("pass-through")); // Photoshop's group default
    this.engine.commit();
  }
  /** Layer ▸ Group Layers / New ▸ Group from Layers: wrap the current selection
   *  (or the active layer) in a new group; the new group becomes the selection. */
  groupSelectedLayers() {
    const ids = this.snap.selectedLayerIds.length ? this.snap.selectedLayerIds : [this.snap.activeLayerId];
    const gid = this.engine.e.group_layers(new Uint32Array(ids), `Group ${this.engine.e.layer_count()}`);
    this.engine.commit();
    if (gid) this.selectLayer(gid);
  }
  /** Layer ▸ New Fill Layer ▸ Solid Color: a new layer flooded with one colour. */
  addSolidFillLayer(r: number, g: number, b: number): number {
    const id = this.engine.e.add_solid_fill_layer(r, g, b);
    this.engine.commit();
    return id;
  }
  /** Layer ▸ New Fill Layer ▸ Gradient: a new layer with the current top→bottom ramp. */
  addGradientFillLayer(stops: GradientStop[] = this.snap.gradientStops): number {
    const gs = [...stops].sort((a, b) => a.pos - b.pos);
    const packed = new Float32Array(gs.flatMap((s) => [s.pos, s.r / 255, s.g / 255, s.b / 255, s.a / 255]));
    const id = this.engine.e.add_gradient_fill_layer(packed);
    this.engine.commit();
    return id;
  }
  /** Layer ▸ New Fill Layer ▸ Pattern: a new layer tiled with the defined pattern. */
  addPatternFillLayer(): number {
    const id = this.engine.e.add_pattern_fill_layer();
    this.engine.commit();
    return id;
  }
  setFillParams(id: number, params: Float32Array) {
    this.engine.e.set_fill_params(id, params);
    this.engine.commit();
  }
  setPatternFillScale(id: number, scale: number) {
    const params = this.adjParams(id);
    if (params.length < 3) return;
    params[2] = scale;
    this.setFillParams(id, params);
  }
  replacePatternFill(id: number) {
    this.engine.e.replace_pattern_fill(id);
    this.engine.commit();
  }
  rasterizeFillLayer(id: number) {
    if (this.engine.e.layer_kind(id) !== LAYER_KIND.fill) return;
    this.engine.e.rasterize_fill_layer(id);
    this.engine.commit();
  }
  ungroup(id: number) {
    this.engine.e.ungroup(id);
    this.engine.commit();
  }
  /** Edit ▸ Content-Aware Scale: seam-carve the document to a smaller size. */
  contentAwareScale(newW: number, newH: number) {
    this.engine.e.content_aware_scale(newW, newH);
    if (this.engine.commit()) this.requestFit();
  }
  /** Chunked scale used by the dialog. Begin composites once and returns the seam count. */
  beginContentAwareScale(newW: number, newH: number): number {
    const e = this.engine.e as { content_aware_scale_begin(w: number, h: number): number };
    return e.content_aware_scale_begin(newW, newH);
  }
  stepContentAwareScale(passes: number): number {
    const e = this.engine.e as { content_aware_scale_step(passes: number): number };
    return e.content_aware_scale_step(passes);
  }
  finishContentAwareScale() {
    const e = this.engine.e as { content_aware_scale_finish(): void };
    e.content_aware_scale_finish();
    if (this.engine.commit()) this.requestFit();
  }
  cancelContentAwareScale() {
    const e = this.engine.e as { content_aware_scale_cancel(): void };
    e.content_aware_scale_cancel();
  }
  /** Image ▸ Mode ▸ Bitmap: reduce the active layer to 1-bit B&W — 0 threshold,
   *  1 diffusion dither, 2 pattern dither, 3 halftone screen, 4 custom pattern.
   *  The Halftone Screen options ride along on method 3: `frequency` in lines per
   *  inch, `angle` in degrees and the dot `shape`. `outputPpi` is Photoshop's
   *  Output resolution, which IS the converted document's resolution: the engine
   *  resamples the image by output ÷ input and restamps its ppi inside the one
   *  Bitmap step (its document snapshot carries the ppi, so Undo restores it),
   *  and the screen's lpi is measured against it. 0 converts in place. False
   *  when the engine refused, with its reason already reported. */
  convertBitmap(method: number, frequency = 0, angle = 45, shape = 0, outputPpi = 0): boolean {
    const e = this.engine.e;
    const [w, h] = [e.width(), e.height()];
    this.adoptingResolution(() => e.convert_bitmap(method, frequency, angle, shape, outputPpi > 0 ? normalizeDocumentResolutionPpi(outputPpi) : 0));
    if (!this.engine.commit()) return false;
    if (e.width() !== w || e.height() !== h) {
      this.remapDocSpaceAnnotations(e.width() / w, e.height() / h, 0, 0);
      this.requestFit();
    }
    this.set({ duotone: null });
    return true;
  }
  /** The store is the print resolution's authority — every resync pushes it to
   *  the engine — but Bitmap's Output resolution restamps it inside an engine
   *  History step. So around that op, and any Undo/Redo/seek that may cross
   *  one, a change in the engine's copy is adopted before the next resync
   *  pushes the stale store value back over it. */
  private adoptingResolution(run: () => void) {
    const e = this.engine.e;
    const before = e.resolution_ppi();
    run();
    const after = e.resolution_ppi();
    if (after !== before) this.set({ resolutionPpi: normalizeDocumentResolutionPpi(after) });
  }
  /** Image ▸ Mode ▸ Duotone: turn the document into a duotone one — a single
   *  grayscale plate printed with 1–4 named inks (Monotone…Quadtone), each with
   *  its own transfer curve, plus the Overprint Colors. The ink composite renders
   *  through a gradient-map adjustment layer over the plate, so the plate is
   *  untouched and re-opening the dialog edits the inks instead of re-mapping
   *  already-mapped pixels. Re-invoking on a duotone document only re-inks it. */
  convertDuotone(inks: DuotoneInk[], overprints: Overprints = {}) {
    const norm = normalizeDuotoneInks(inks);
    const params = duotoneLutF32(norm, overprints);
    const cur = this.snap.duotone;
    // How a Photoshop file stated its overprints rides along; a save writes
    // one back only while its colour is unchanged.
    const record = (layerId: number): DuotoneDoc => ({
      inks: norm,
      overprints,
      ...(cur?.overprintSpecs ? { overprintSpecs: cur.overprintSpecs } : {}),
      layerId,
    });
    if (cur && this.engineHasLayer(this.engine.e, cur.layerId)) {
      this.setAdjustmentParams(cur.layerId, params);
      this.set({ duotone: record(cur.layerId) });
      return;
    }
    // A project reload rebuilds every layer id, so the record above is gone
    // while the ink layer itself is still in the document. Adopt it rather than
    // stacking a second gradient map on top of the first (#492).
    const existing = this.existingDuotoneLayer();
    if (existing !== null) {
      this.setAdjustmentParams(existing, params);
      this.set({ duotone: record(existing) });
      return;
    }
    this.convertGrayscale(); // Photoshop: a duotone document prints one gray plate
    if (this.engine.e.doc_mode() !== 1) return; // refused (32-bit float / imported-Photoshop doc)
    const layerId = this.addAdjustmentLayer(13, params, "Duotone");
    if (!layerId) return;
    this.set({ duotone: record(layerId) });
  }
  /** The document's own ink layer, if it already has one: the kind-13 gradient
   *  map named "Duotone" that convertDuotone builds. Layer ids do not survive a
   *  reload, so this is how a duotone document is recognised without one. */
  existingDuotoneLayer(engine: Engine | null = this.engine.engine): number | null {
    const e = engine as (Engine & { layer_adj_kind?: (id: number) => number }) | null;
    if (!e?.layer_adj_kind) return null;
    for (let index = 0; index < e.layer_count(); index++) {
      const id = e.layer_id_at(index);
      if (e.layer_kind(id) === LAYER_KIND.adjustment && e.layer_adj_kind(id) === 13 && e.layer_name(id) === "Duotone") {
        return id;
      }
    }
    return null;
  }
  /** Reset or restore the ink record — activateDoc and a project reload both
   *  invalidate the layer id it holds. */
  setDuotoneRecord(record: DuotoneDoc | null) {
    this.set({ duotone: record });
  }
  /** Image ▸ Mode ▸ Indexed Color: quantize the document to a small palette,
   *  optionally with Floyd-Steinberg dithering. An indexed image is one layer
   *  with one palette, so the engine flattens a layered document first, as
   *  Photoshop does, and keeps the table as the document palette Color Table
   *  shows. `palette` is Photoshop's Palette menu (0 Exact, 1 System, 2 Web,
   *  3 Uniform, 4 Perceptual, 5 Selective, 6 Adaptive, 7 Custom — from
   *  `custom`, packed RGB — 8 Previous), `forced`
   *  the entries reserved before quantization (0 None, 1 Black and White,
   *  2 Primaries, 3 Web), and Transparency/`matte` decide whether the empty
   *  pixels stay empty or are composited onto the matte colour. Colours arrive
   *  as #rrggbb (what the dialog's inputs and a parsed .act both speak) and go
   *  to the engine as packed RGB bytes. `previous` is Color Table's Apply: the
   *  table that dialog SHOWED, so an edited entry recolours the pixels that used
   *  it instead of being re-quantized onto the nearest surviving colour. False
   *  when the engine refused, with its reason already reported. */
  convertIndexed(
    colors: number,
    dither: boolean,
    palette = 6,
    forced = 0,
    transparency = true,
    matte = "#ffffff",
    custom: readonly string[] = [],
    previous: readonly string[] = [],
  ): boolean {
    const pack = (hexes: readonly string[]) => Uint8Array.from(hexes.slice(0, 256).flatMap(hexToRgb));
    this.engine.e.convert_indexed(colors, dither, palette, forced, transparency, pack([matte]), pack(custom), pack(previous));
    if (!this.engine.commit()) return false;
    this.set({ duotone: null });
    return true;
  }
  convertGrayscale() {
    const e = this.engine.e;
    // Photoshop's Duotone → Grayscale discards the inks, so their layer goes in
    // the same undo step. The record stays: docDuotone ignores it while the
    // layer is gone, and an Undo that brings the layer back is Duotone again.
    const duotone = this.docDuotone(this.activeDocId);
    const pushes = e.undo_pushes();
    e.convert_grayscale();
    if (duotone && e.undo_pushes() > pushes) this.withoutHistoryStep(() => e.delete_layer(duotone.layerId));
    this.engine.commit();
    if (!duotone) this.set({ duotone: null });
  }
  /** File ▸ Automate ▸ Conditional Mode Change: convert to `target` only if the
   *  document's current mode is in `sources` (0 RGB, 1 Grayscale, 2 CMYK, 3 Lab,
   *  4 Multichannel). */
  conditionalModeChange(sources: number[], target: number) {
    if (!sources.includes(this.snap.mode) || this.snap.mode === target) return;
    if (target === 1) this.convertGrayscale();
    else this.setColorMode(target);
  }
  setColorMode(m: number) {
    const e = this.engine.e as Engine & { convert_imported_photoshop_to_rgb?: () => boolean };
    if (this.snap.photoshopPreview && m === 0) {
      if (e.convert_imported_photoshop_to_rgb?.()) this.engine.commit();
      else this.engine.consumeEditError();
      return;
    }
    e.set_mode(m);
    this.engine.commit();
    if (e.doc_mode() !== 1) this.set({ duotone: null }); // a duotone document is its gray plate; any other mode drops the inks
  }
  assignProfile(profile: number, iccProfileBytes?: Uint8Array | null, iccProfileName?: string | null) {
    const p = clampProfile(profile);
    const rawIcc = cloneIccProfileBytes(iccProfileBytes);
    const rawName = rawIcc ? normalizeCustomProfileName(iccProfileName) : null;
    if (!this.engine.engine) {
      this.set({ colorProfile: p, colorProfileAssigned: true, iccProfileBytes: rawIcc, iccProfileName: rawName });
      return; // Color Settings on Home seeds the next New document.
    }
    if (this.snap.colorProfile === p && this.snap.colorProfileAssigned && sameBytes(this.snap.iccProfileBytes, rawIcc) && this.snap.iccProfileName === rawName) return;
    if (this.snap.photoshopPreview && this.snap.colorProfile === p) return;
    if (this.snap.colorProfile !== p) {
      this.engine.e.assign_profile(p);
      if (!this.engine.commit()) return;
    } else {
      this.markDirty();
    }
    this.set({ colorProfile: p, colorProfileAssigned: true, iccProfileBytes: rawIcc, iccProfileName: rawName });
    this.syncDocumentIcc(rawIcc, rawName);
    this.syncDisplayProfile();
  }
  /** Mirror the assigned profile into the engine's `.monetgfx` envelope. Vision
   *  keeps the profile in JS state; without this a container saved from Vision
   *  carries no `iccProfile` and every other Monet app has to guess sRGB. */
  private syncDocumentIcc(rawIcc: Uint8Array | null, rawName: string | null) {
    this.engine.e.setDocumentIcc(rawIcc ?? EMPTY_ICC_PROFILE, rawName ?? "");
  }
  markProfileUntagged(profile: number = this.snap.colorProfile) {
    if (this.snap.photoshopPreview) return;
    const p = clampProfile(profile);
    if (this.snap.colorProfile !== p) this.engine.e.assign_profile(p);
    this.set({ colorProfile: p, colorProfileAssigned: false, iccProfileBytes: null, iccProfileName: null });
    this.syncDocumentIcc(null, null); // untagged: the container must not claim a profile
    this.engine.sync();
  }
  convertToProfile(
    profile: number,
    intent = 1,
    blackPointCompensation = false,
    destinationIccProfileBytes?: Uint8Array | null,
    destinationIccProfileName?: string | null,
    dither = false,
  ) {
    const p = clampProfile(profile);
    const destinationIcc = cloneIccProfileBytes(destinationIccProfileBytes);
    const destinationName = destinationIcc ? normalizeCustomProfileName(destinationIccProfileName) : null;
    // A CMYK, Gray or Lab destination separates the document and switches its
    // mode (the engine keeps that profile for the mode's plates). The RGB
    // pixels stay in the assigned RGB profile, so none of that state moves.
    if (destinationIcc && iccColorMode(String.fromCharCode(...destinationIcc.subarray(16, 20)))) {
      this.engine.e.convert_profile_with_icc(
        this.snap.colorProfile,
        this.snap.iccProfileBytes ?? EMPTY_ICC_PROFILE,
        this.snap.colorProfile,
        destinationIcc,
        intent,
        blackPointCompensation,
        dither,
        destinationName ?? "",
      );
      if (this.engine.commit() && this.snap.mode !== 1) this.set({ duotone: null });
      return;
    }
    // Converting a CMYK / Gray / Lab document into its own RGB profile is how
    // it becomes RGB again, so only an RGB document can be a no-op here.
    if (this.snap.mode === 0
      && this.snap.colorProfile === p
      && this.snap.colorProfileAssigned
      && sameBytes(this.snap.iccProfileBytes, destinationIcc)
      && this.snap.iccProfileName === destinationName) return;
    // The ICC transform is the accurate one and stays the default, but it is
    // u16-only: on a 32-bit document it refuses outright (FLOAT_EDIT_UNSUPPORTED)
    // rather than clamp the HDR range. When neither side carries a custom ICC
    // profile the destination is a built-in matrix profile, which the engine can
    // convert natively in f32 — so that is the route a float document takes
    // instead of being told the conversion is impossible (#487).
    //
    // Black Point Compensation is not lost on that route: every built-in matrix
    // profile puts black at exactly 0, so a black-point lift between two of them
    // is the identity. The engine names the parameter `_black_point_compensation`
    // for that reason.
    const matrixOnly = !this.snap.iccProfileBytes?.length && !destinationIcc?.length;
    if (matrixOnly && this.snap.depth === 32) {
      this.engine.e.convert_to_profile(p, intent, blackPointCompensation);
    } else {
      this.engine.e.convert_profile_with_icc(
        this.snap.colorProfile,
        this.snap.iccProfileBytes ?? EMPTY_ICC_PROFILE,
        p,
        destinationIcc ?? EMPTY_ICC_PROFILE,
        intent,
        blackPointCompensation,
        dither,
        "",
      );
    }
    if (!this.engine.commit()) return;
    // An RGB destination makes an RGB document (the ICC route switches the mode).
    this.set({
      colorProfile: p, colorProfileAssigned: true, iccProfileBytes: destinationIcc, iccProfileName: destinationName,
      ...(this.snap.mode !== 1 ? { duotone: null } : {}),
    });
    this.syncDocumentIcc(destinationIcc, destinationName);
    this.syncDisplayProfile();
  }
  setDepth(d: number) {
    this.engine.e.set_depth(d);
    this.engine.commit();
  }
  addLayerMask(id?: number) {
    this.engine.e.add_layer_mask(id ?? this.snap.activeLayerId);
    this.engine.commit();
  }
  /** Layer ▸ Layer Mask ▸ From Transparency: move the layer's alpha into a mask. */
  maskFromTransparency(id: number) {
    this.engine.e.layer_mask_from_transparency(id);
    this.engine.commit();
  }
  /** Layer ▸ Layer Mask ▸ Hide All / Hide Selection: add a hiding (black) mask. */
  addLayerMaskHidden(id: number) {
    this.engine.e.add_layer_mask_hidden(id);
    this.engine.commit();
  }
  /** Layer ▸ Layer Mask ▸ Enable / Disable: toggle whether the mask applies. */
  setLayerMaskEnabled(id: number, enabled: boolean) {
    this.engine.e.set_layer_mask_enabled(id, enabled);
    this.engine.commit();
  }
  /** ⇧-click the mask thumbnail: enable/disable the mask (the panel shows a red
   *  X over a disabled one). No-op without a mask — the engine guards it. */
  toggleLayerMaskEnabled(id: number) {
    this.setLayerMaskEnabled(id, !this.engine.e.layer_mask_enabled(id));
  }
  /** ⌥-click the mask thumbnail: show that mask ALONE as grayscale on canvas
   *  (toggle). Targets the layer first, like Photoshop. Display-only. */
  toggleMaskGrayView(id: number) {
    if (id !== this.snap.activeLayerId) this.selectLayer(id);
    if (!this.engine.e.layer_has_mask(id)) return;
    this.set({ maskView: this.snap.maskView === "gray" ? "off" : "gray" });
  }
  /** `\`: preview the active layer's mask as a red rubylith over the image
   *  (toggle). Display-only, and the mask stays editable underneath. */
  toggleMaskRubylith() {
    if (!this.engine.e.layer_has_mask(this.snap.activeLayerId)) return;
    this.set({ maskView: this.snap.maskView === "rubylith" ? "off" : "rubylith" });
  }
  /** The active layer's effective mask as a w*h grayscale plane (255 = reveals),
   *  for the display-only mask previews CanvasView draws. Null when there is no
   *  mask or no preview running. */
  layerMaskBuffer(): Uint8Array | null {
    const e = this.engine.engine;
    if (!e || this.snap.maskView === "off") return null;
    const gray = e.layer_mask_gray(this.snap.activeLayerId);
    return gray.length ? gray : null;
  }
  /** Layer ▸ Layer Mask ▸ Unlink / Link: toggle whether the mask follows moves. */
  toggleLayerMaskLinked(id: number) {
    this.engine.e.set_layer_mask_linked(id, !this.engine.e.layer_mask_linked(id));
    this.engine.commit();
  }
  // ── Mask Properties (Photoshop's Properties panel for a layer/vector mask) ──
  // Read back from the engine like Blending Options does, so the panel renders
  // live off the engine without a cache.
  /** Properties ▸ Density (0..100): non-destructively fade the mask toward
   *  fully revealing. `live` coalesces a slider drag (engine coalesces undo). */
  setLayerMaskDensity(id: number, pct: number, live = false) {
    const apply = () => this.engine.e.set_layer_mask_density(id, pct / 100);
    if (live) { this.liveRender(apply); return; }
    apply();
    this.engine.commit();
  }
  layerMaskDensity(id: number): number {
    return Math.round(this.engine.e.layer_mask_density(id) * 100);
  }
  /** Properties ▸ Feather (px): live Gaussian softening of the mask edge. The
   *  mask pixels are untouched, so it stays re-adjustable. */
  setLayerMaskFeather(id: number, px: number, live = false) {
    const apply = () => this.engine.e.set_layer_mask_feather(id, px);
    if (live) { this.liveRender(apply); return; }
    apply();
    this.engine.commit();
  }
  layerMaskFeather(id: number): number {
    return this.engine.e.layer_mask_feather(id);
  }
  /** Layer ▸ Layer Mask ▸ Reveal Selection: mask reveals inside the selection. */
  addLayerMaskRevealSelection(id: number) {
    this.engine.e.add_layer_mask_reveal_selection(id);
    this.engine.commit();
  }
  /** Layer ▸ Layer Mask ▸ Hide Selection: mask hides inside the selection. */
  addLayerMaskHideSelection(id: number) {
    this.engine.e.add_layer_mask_hide_selection(id);
    this.engine.commit();
  }
  applyLayerMask(id: number) {
    this.engine.e.apply_layer_mask(id);
    this.engine.commit();
  }
  deleteLayerMask(id: number) {
    this.engine.e.delete_layer_mask(id);
    this.maskEdit(false);
    this.engine.commit();
  }
  maskEdit(on: boolean) {
    this.set({ maskEdit: on });
    this.engine.e.set_mask_edit(on);
  }
  /** Select ▸ Edit in Quick Mask Mode (Q): enter rasterizes the selection into the
   *  rubylith buffer and suspends the marquee; exit converts the painted buffer
   *  back into a selection (one undoable Sel step). The red overlay is rendered by
   *  CanvasView from quickMaskBuffer(); the engine output is never tinted. This is a
   *  selection-mode change (no pixel edit), so it syncs — not commits — so it never
   *  marks the doc dirty and never needs a re-blit (the overlay is a separate canvas). */
  toggleQuickMask() {
    const e = this.engine.e;
    if (e.quick_mask_on()) this.leaveQuickMask();
    else e.enter_quick_mask();
    this.engine.sync();
  }

  /** Exit Quick Mask, first writing the buffer back into the targeted alpha
   *  channel. Every exit routes through here — Q, the toolbar toggle and
   *  untargeting all reach it — or a channel painted through Quick Mask would
   *  silently lose the edit to the selection. */
  private leaveQuickMask() {
    const e = this.engine.e;
    const target = this.snap.channelTarget;
    e.exit_quick_mask();
    if (!target) return;
    e.save_selection(target);
    this.markDirty();
    this.set({ channelTarget: null });
    setQuickMaskOverlay(null);
  }

  /** Channels panel ▸ click a channel to target it. Photoshop targets a channel
   *  so brushes and filters act on that plane alone; here an alpha channel is
   *  targeted by loading it into the Quick Mask buffer — which is exactly the
   *  paintable, canvas-visible grayscale plane the engine already owns — and
   *  writing it back on the way out. `null` targets the composite again.
   *  ponytail: brushes follow the target (they paint the mask buffer), filters
   *  and adjustments still hit the layer's pixels — routing those through the
   *  target needs an engine op that adjusts the mask buffer in place. */
  targetChannel(name: string | null) {
    const e = this.engine.e;
    if (this.snap.channelTarget === name) return;
    if (e.quick_mask_on()) this.leaveQuickMask();
    if (name) {
      e.load_selection(name, 0); // replace: the channel IS the buffer
      e.enter_quick_mask();
      this.set({ channelTarget: name });
      this.applyChannelOverlay(name);
    }
    this.engine.sync();
  }

  channelOptionsFor(name: string): ChannelOptions {
    return this.snap.channelOptions[name] ?? DEFAULT_CHANNEL_OPTIONS;
  }

  /** Channels panel ▸ Channel Options: the targeted channel's overlay colour,
   *  opacity and what the colour indicates. Display-only, so it never dirties
   *  the document. */
  setChannelOptions(name: string, patch: Partial<ChannelOptions>) {
    const next = { ...this.channelOptionsFor(name), ...patch };
    this.set({ channelOptions: { ...this.snap.channelOptions, [name]: next } });
    if (this.snap.channelTarget === name) this.applyChannelOverlay(name);
  }

  /** The channel's eye: show the targeted plane alone in grayscale instead of
   *  tinted over the document. */
  setChannelAlone(on: boolean) {
    this.set({ channelAlone: on });
    this.applyChannelOverlay(this.snap.channelTarget);
  }

  /** Push the targeted channel's Channel Options into the overlay module and
   *  force the overlay canvas to rebuild. The gen bump is display-only — the
   *  next engine sync restores the engine's own qm_gen, which redraws the same
   *  pixels again. */
  private applyChannelOverlay(name: string | null) {
    if (!name) { setQuickMaskOverlay(null); }
    else {
      const o = this.channelOptionsFor(name);
      const [r, g, b] = hexToRgb(o.color);
      setQuickMaskOverlay({ color: { r, g, b }, opacity: o.opacity, indicates: o.indicates, alone: this.snap.channelAlone });
    }
    this.set({ quickMaskGen: this.snap.quickMaskGen + 1 });
  }

  /** ⌘-click a channel row: load that document plate as the selection. The
   *  engine has no load-plate op, so the plate is separated into a scratch alpha
   *  channel through its real ink model and dropped again — net zero, so this
   *  does not dirty the document. */
  loadChannelAsSelection(channel: number, mode = 0) {
    const e = this.engine.e;
    const scratch = "\u0000channel-selection"; // unnameable in the UI, so it can't collide
    // (#85) duplicate_channel and delete_saved_selection each push their own
    // history state ("Duplicate Channel" / "Delete Channel"), so the scratch
    // round trip burned three states and the first ⌘Z resurrected the hidden
    // channel instead of reverting the selection. Only Load Selection is the
    // user's edit; the create/drop pair runs history-neutral.
    this.withoutHistoryStep(() => e.duplicate_channel(channel, scratch));
    e.load_selection(scratch, mode);
    this.withoutHistoryStep(() => e.delete_saved_selection(scratch));
    this.engine.sync();
  }

  /** ⌘-click a layer thumbnail: load that layer's own transparency as the
   *  selection. Unlike the channel round trip above this needs no scratch
   *  channel — the engine hands back document-sized coverage and
   *  `apply_selection_mask` combines it as one "Load Selection" step. */
  /** Color Range's live preview coverage. Deliberately outside reactive state:
   *  a document-sized buffer that changes on every slider tick, which nothing
   *  should diff — the mode flag in state is what triggers the repaint. */
  private selectionPreviewMask: Uint8Array | null = null;

  loadLayerTransparencyAsSelection(id: number, mode = 0) {
    const e = this.engine.e;
    const alpha = e.layer_alpha_gray(id);
    if (!alpha.length) return;
    e.apply_selection_mask(alpha, mode);
    this.engine.sync();
  }

  /** ⌘-click a layer's mask thumbnail: load the mask itself as the selection,
   *  through the same effective coverage the mask preview shows (so Density and
   *  a disabled mask read the way the panel draws them). */
  loadLayerMaskAsSelection(id: number, mode = 0) {
    const e = this.engine.e;
    const mask = e.layer_mask_gray(id);
    if (!mask.length) return;
    e.apply_selection_mask(mask, mode);
    this.engine.sync();
  }

  // ── Blending Options (Photoshop Layer Style) ─────────────────
  // Advanced blending + the 10 layer effects. Engine reads these back, so
  // the dialog can render live from the engine (no cache needed).
  setFillOpacity(id: number, pct: number, live = false) {
    const apply = () => this.engine.e.set_layer_fill_opacity_undoable(id, pct / 100);
    if (live) { this.liveRender(apply); return; }
    apply();
    this.engine.commit();
  }
  /** Raw Fill mutation inside a compound history transaction such as the Layer
   *  Style dialog, whose surrounding snapshot owns OK/Cancel and Undo. */
  setFillOpacityInTransaction(id: number, pct: number, live = false) {
    const apply = () => this.engine.e.set_layer_fill_opacity(id, pct / 100);
    if (live) { this.liveRender(apply); return; }
    apply();
    this.engine.commit();
  }
  fillOpacity(id: number): number {
    return Math.round(this.engine.e.layer_fill_opacity(id) * 100);
  }
  setKnockout(id: number, k: number) {
    this.engine.e.set_layer_knockout(id, k);
    this.engine.commit();
  }
  knockout(id: number): number {
    return this.engine.e.layer_knockout(id);
  }
  /** Blending Options ▸ Transparency Shapes Layer (default on). */
  setTransparencyShapes(id: number, on: boolean) {
    this.engine.e.set_layer_transparency_shapes(id, on);
    this.engine.commit();
  }
  transparencyShapes(id: number): boolean {
    return this.engine.e.layer_transparency_shapes(id);
  }
  /** Blending Options ▸ Advanced Blending ▸ Channels: the R/G/B bits this layer
   *  may blend into (1 R, 2 G, 4 B; 7 = all, the default). A cleared bit leaves
   *  that channel of the composite as the layers below left it. Degrades to
   *  "all channels" on a wasm build without the export. */
  setLayerBlendChannels(id: number, mask: number) {
    const e = this.engine.engine as { set_layer_blend_channels?: (id: number, mask: number) => void } | null;
    if (!e?.set_layer_blend_channels) return;
    e.set_layer_blend_channels(id, mask & 7);
    this.engine.commit();
  }
  layerBlendChannels(id: number): number {
    const e = this.engine.engine as { layer_blend_channels?: (id: number) => number } | null;
    return e?.layer_blend_channels ? e.layer_blend_channels(id) : 7;
  }
  /** Blending Options ▸ Blend Interior Effects as Group (default off). */
  setBlendInteriorGroup(id: number, on: boolean) {
    this.engine.e.set_layer_blend_interior_group(id, on);
    this.engine.commit();
  }
  blendInteriorGroup(id: number): boolean {
    return this.engine.e.layer_blend_interior_group(id);
  }
  /** Blending Options ▸ Blend Clipped Layers as Group (on a clip base; default off). */
  setBlendClippedGroup(id: number, on: boolean) {
    this.engine.e.set_layer_blend_clipped_group(id, on);
    this.engine.commit();
  }
  blendClippedGroup(id: number): boolean {
    return this.engine.e.layer_blend_clipped_group(id);
  }
  setBlendIf(id: number, vals: number[], live = false) {
    const apply = () => this.engine.e.set_layer_blend_if(id, Float32Array.from(vals));
    if (live) { this.liveRender(apply); return; }
    apply();
    this.engine.commit();
  }
  blendIf(id: number): number[] {
    return Array.from(this.engine.e.layer_blend_if(id));
  }
  setEffect(id: number | undefined, effectId: number, params: number[], live = false) {
    id = id ?? this.snap.activeLayerId;
    const apply = () => this.engine.e.set_layer_effect(id as number, effectId, Float32Array.from(params));
    if (live) { this.liveRender(apply); return; }
    apply();
    this.engine.commit();
  }
  clearEffect(id: number, effectId: number) {
    this.engine.e.set_layer_effect(id, effectId, new Float32Array(0));
    this.engine.commit();
  }
  clearAllEffects(id: number) {
    this.engine.e.clear_layer_effects(id);
    this.engine.commit();
  }
  effectParams(id: number, effectId: number): number[] {
    return Array.from(this.engine.e.layer_effect_params(id, effectId));
  }
  // ── Layer-effect instances (stacked strokes, layered shadows) ─
  // Photoshop allows up to FX_MAX_INSTANCES of each type; setEffect/effectParams
  // above are the whole-type ops (index 0, and a set collapses the type to just
  // that one instance) — these address one instance at a time, for the Blending
  // Options dialog's per-type add/remove/reorder.
  effectInstanceCount(id: number, effectId: number): number {
    return this.engine.e.layer_effect_count(id, effectId);
  }
  /** One instance's params, in render order (bottom→top) within that type. */
  effectParamsAt(id: number, effectId: number, index: number): number[] {
    return Array.from(this.engine.e.layer_effect_params_at(id, effectId, index));
  }
  /** Edit an existing instance, or append one past the current count (capped at
   *  FX_MAX_INSTANCES — see set_layer_effect_at). Mirrors setEffect's live-drag
   *  coalescing. */
  setEffectAt(id: number, effectId: number, index: number, params: number[], live = false) {
    const apply = () => this.engine.e.set_layer_effect_at(id, effectId, index, Float32Array.from(params));
    if (live) { this.liveRender(apply); return; }
    apply();
    this.engine.commit();
  }
  /** Delete one instance, keeping the rest of the stack (Blending Options' per-row ✕). */
  removeEffectAt(id: number, effectId: number, index: number) {
    this.engine.e.set_layer_effect_at(id, effectId, index, new Float32Array(0));
    this.engine.commit();
  }
  /** Swap two instances of the same type (Blending Options' move up/down). */
  moveEffectInstance(id: number, effectId: number, from: number, to: number) {
    const count = this.effectInstanceCount(id, effectId);
    if (from === to || from < 0 || to < 0 || from >= count || to >= count) return;
    const a = this.effectParamsAt(id, effectId, from);
    const b = this.effectParamsAt(id, effectId, to);
    this.engine.e.set_layer_effect_at(id, effectId, from, Float32Array.from(b));
    this.engine.e.set_layer_effect_at(id, effectId, to, Float32Array.from(a));
    this.engine.commit();
  }
  /** Push a style's effect-instance list onto a layer via set_layer_effect_at,
   *  in render order (bottom→top within each fx type). Caller clears/prepares
   *  the layer's existing effects first — this only appends instances. */
  private applyStyleEffects(e: Engine, id: number, effects: StyleEffect[]) {
    const counts = new Map<number, number>();
    for (const { fx, params } of effects) {
      if (!params.length) continue;
      const index = counts.get(fx) ?? 0;
      e.set_layer_effect_at(id, fx, index, Float32Array.from(params));
      counts.set(fx, index + 1);
    }
  }

  /** Apply one complete Blending Options result as a single undoable action. */
  applyLayerStyleState(state: LayerStyleState): boolean {
    const effects = sanitizeStyleEffects(state?.effects);
    if (!state || effects.length !== state.effects.length
      || !Array.isArray(state.blendIf) || (state.blendIf.length !== 0 && state.blendIf.length !== 32)
      || state.blendIf.some((value) => !Number.isFinite(value))
      || !Number.isFinite(state.fillOpacity) || !Number.isFinite(state.knockout)
      || typeof state.transparencyShapes !== "boolean" || typeof state.blendInteriorGroup !== "boolean"
      || typeof state.blendClippedGroup !== "boolean"
      || (state.blendChannels !== undefined && !Number.isFinite(state.blendChannels))) return false;
    if (!this.beginHistory("Blending Options")) return false;
    const e = this.engine.e;
    const id = this.state.activeLayerId;
    e.clear_layer_effects(id);
    this.applyStyleEffects(e, id, effects);
    e.set_layer_blend_if(id, Float32Array.from(state.blendIf));
    e.set_layer_fill_opacity(id, Math.max(0, Math.min(100, state.fillOpacity)) / 100);
    e.set_layer_knockout(id, Math.max(0, Math.min(2, Math.round(state.knockout))));
    e.set_layer_transparency_shapes(id, state.transparencyShapes);
    e.set_layer_blend_interior_group(id, state.blendInteriorGroup);
    e.set_layer_blend_clipped_group(id, state.blendClippedGroup);
    this.setLayerBlendChannels(id, state.blendChannels ?? 7);
    return this.commitHistory();
  }

  scaleEffects(percent: number): boolean {
    if (!Number.isFinite(percent) || percent <= 0 || percent === 100 || !this.beginHistory("Scale Effects")) return false;
    const id = this.state.activeLayerId;
    const factor = percent / 100;
    let changed = false;
    for (const d of FX_DEFS) {
      for (let i = this.effectInstanceCount(id, d.id) - 1; i >= 0; i--) {
        const params = this.effectParamsAt(id, d.id, i);
        const next = [...params];
        for (const field of d.fields) if (field.k === "px") next[field.i] *= factor;
        if (next.every((value, index) => value === params[index])) continue;
        this.engine.e.set_layer_effect_at(id, d.id, i, Float32Array.from(next));
        changed = true;
      }
    }
    return changed ? this.commitHistory() : (this.dropHistory(), false);
  }

  setGlobalLight(angle: number): boolean {
    if (!Number.isFinite(angle) || !this.beginHistory("Global Light")) return false;
    const id = this.state.activeLayerId;
    let changed = false;
    for (const d of FX_DEFS) {
      const field = d.fields.find((candidate) => candidate.k === "angle");
      if (!field) continue;
      for (let i = this.effectInstanceCount(id, d.id) - 1; i >= 0; i--) {
        const params = this.effectParamsAt(id, d.id, i);
        if (params.length <= field.i || (params[d.def.length] ?? 1) < 0.5 || params[field.i] === angle) continue;
        const next = [...params];
        next[field.i] = angle;
        this.engine.e.set_layer_effect_at(id, d.id, i, Float32Array.from(next));
        changed = true;
      }
    }
    return changed ? this.commitHistory() : (this.dropHistory(), false);
  }
  /** Gradient Overlay's ramp as the app-wide `GradientStop` shape (rgba 0..255),
   *  so the Gradient tool's picker, the presets and this effect speak one model.
   *  Falls back to the effect's two Start/End colours when no ramp was authored. */
  effectGradientStops(id: number): GradientStop[] {
    return this.effectGradientStopsAt(id, 0);
  }
  /** Load a multi-stop ramp (a preset, the live Gradient tool ramp, an Artisan
   *  gradient) into Gradient Overlay, leaving its other params alone. Enables the
   *  effect, since picking a gradient is how Photoshop turns the overlay on. */
  setEffectGradientStops(id: number, stops: GradientStop[], live = false) {
    this.setEffectGradientStopsAt(id, 0, stops, live);
  }
  /** Same as effectGradientStops, for one instance of a stacked Gradient Overlay. */
  effectGradientStopsAt(id: number, index: number): GradientStop[] {
    const p = this.effectParamsAt(id, FX.GRADIENT_OVERLAY, index);
    const src = p.length ? p : fxDef(FX.GRADIENT_OVERLAY).def;
    return fxGradientStops(src).map((s) => ({
      pos: s.pos, r: Math.round(s.r * 255), g: Math.round(s.g * 255), b: Math.round(s.b * 255), a: Math.round(s.a * 255),
    }));
  }
  /** Same as setEffectGradientStops, for one instance of a stacked Gradient Overlay. */
  setEffectGradientStopsAt(id: number, index: number, stops: GradientStop[], live = false) {
    const cur = this.effectParamsAt(id, FX.GRADIENT_OVERLAY, index);
    const base = cur.length ? cur : fxDef(FX.GRADIENT_OVERLAY).def.slice();
    const next = withFxGradientStops(base, stops.map((s) => ({
      pos: s.pos, r: s.r / 255, g: s.g / 255, b: s.b / 255, a: s.a / 255,
    })));
    next[0] = 1;
    this.setEffectAt(id, FX.GRADIENT_OVERLAY, index, next, live);
  }

  // ── Smart filter rows (Layers panel sub-rows, VIS-LS-02) ─────
  // Each entry in a smart object's stack is its own row: eye, Blending Options,
  // drag to reorder, delete, and live params. Engine methods are read through
  // `smartRowEngine` so a wasm build that predates them degrades to read-only
  // rows instead of throwing (the SpinBlur/SamEngine pattern).
  private get smartRowEngine(): SmartFilterRowEngine {
    return this.engine.e as unknown as SmartFilterRowEngine;
  }
  /** One row per filter on `id`'s stack, in apply order. Empty when the layer
   *  is not a smart object. */
  smartFilterRows(id: number): SmartFilterRow[] {
    const e = this.engine.e;
    if (!this.engineHasLayer(e, id) || e.layer_kind(id) !== LAYER_KIND.smartObject) return [];
    const rowEngine = this.smartRowEngine;
    return Array.from({ length: e.smart_filter_count(id) }, (_unused, index) => {
      const fid = rowEngine.smart_filter_id?.(id, index) ?? -1;
      return {
        index,
        fid,
        enabled: rowEngine.smart_filter_enabled?.(id, index) ?? true,
        blend: rowEngine.smart_filter_blend_mode?.(id, index) ?? 0,
        opacity: rowEngine.smart_filter_opacity?.(id, index) ?? 1,
        // fid 17 carries the 1086-float develop recipe and fid 117 a displacement
        // mesh — both are re-edited in their own workspace, never as loose fields,
        // so the panel never copies them out of wasm.
        params: WORKSPACE_FIDS.has(fid) ? [] : Array.from(e.smart_filter_params(id, index)),
      };
    });
  }
  /** The per-filter eye. Distinct from Layer ▸ Smart Filter ▸ Disable, which
   *  bypasses the whole stack. */
  setSmartFilterEnabled(id: number, index: number, on: boolean) {
    if (!this.smartRowEngine.set_smart_filter_enabled) return;
    this.smartRowEngine.set_smart_filter_enabled(id, index, on);
    this.engine.commit();
  }
  /** Delete ONE filter, keeping the rest of the stack. */
  removeSmartFilter(id: number, index: number) {
    if (!this.smartRowEngine.smart_remove_filter) return;
    this.smartRowEngine.smart_remove_filter(id, index);
    this.engine.commit();
  }
  /** Drag a filter row to a new position in the stack (apply order matters). */
  moveSmartFilter(id: number, from: number, to: number) {
    if (!this.smartRowEngine.smart_move_filter || from === to) return;
    this.smartRowEngine.smart_move_filter(id, from, to);
    this.engine.commit();
  }
  /** Smart Filter ▸ Blending Options: blend mode index + 0..1 opacity. */
  setSmartFilterBlend(id: number, index: number, mode: number, opacity: number) {
    if (!this.smartRowEngine.set_smart_filter_blend) return;
    this.smartRowEngine.set_smart_filter_blend(id, index, mode, Math.min(1, Math.max(0, opacity)));
    this.engine.commit();
  }
  /** Re-edit one stored parameter of a filter (Photoshop reopens the filter's
   *  dialog; the row edits the same values in place). Out-of-range indices and
   *  non-finite values are dropped rather than written to the stack. */
  setSmartFilterParam(id: number, index: number, paramIndex: number, value: number) {
    if (!Number.isFinite(value)) return;
    const params = Array.from(this.engine.e.smart_filter_params(id, index));
    if (paramIndex < 0 || paramIndex >= params.length || params[paramIndex] === value) return;
    params[paramIndex] = value;
    this.engine.e.smart_update_filter(id, index, Float32Array.from(params));
    this.engine.commit();
  }

  // ── Layer Style clipboard (Copy / Paste / Clear Layer Style) ──
  // The full advanced-blending state: every effect instance, blend-if, fill opacity.
  private styleClip: StyleData | null = null;
  copyLayerStyle() {
    this.styleClip = this.captureStyle(this.state.activeLayerId);
    this.bump(); // refresh menus (Paste becomes available)
  }
  pasteLayerStyle() {
    if (!this.styleClip) return;
    // The engine's layer-style setters are raw by contract: the caller owns
    // the snapshot. Without this, destroying a style cost zero undo steps.
    if (!this.beginHistory("Paste Layer Style")) return;
    const id = this.state.activeLayerId;
    const e = this.engine.e;
    // Full replace (Photoshop's Paste Layer Style overwrites, not merges): clear
    // first, since the instance list has no "off" placeholder for absent types.
    e.clear_layer_effects(id);
    this.applyStyleEffects(e, id, this.styleClip.effects);
    e.set_layer_blend_if(id, Float32Array.from(this.styleClip.blendIf));
    e.set_layer_fill_opacity(id, this.styleClip.fillOpacity / 100);
    this.commitHistory();
  }
  clearLayerStyle() {
    // The engine's layer-style setters are raw by contract: the caller owns
    // the snapshot. Without this, destroying a style cost zero undo steps.
    if (!this.beginHistory("Clear Layer Style")) return;
    this.clearAllEffects(this.state.activeLayerId);
    this.commitHistory();
  }

  // ── Styles panel (saved layer-effect presets) ────────────────
  /** Snapshot the active layer's full style (every effect instance + blend-if +
   *  fill) into the current one — the same shape the Copy Layer Style clipboard
   *  captures. */
  private captureStyle(id: number): StyleData {
    const effects: StyleEffect[] = [];
    for (const d of FX_DEFS) {
      const count = this.effectInstanceCount(id, d.id);
      for (let index = 0; index < count; index++) {
        const params = this.effectParamsAt(id, d.id, index);
        if (params.length) effects.push({ fx: d.id, params });
      }
    }
    return { effects, blendIf: this.blendIf(id), fillOpacity: this.fillOpacity(id) };
  }
  /** Styles panel: save the active layer's style as a preset (auto-named "Style N"). */
  addStylePreset() {
    const names = this.snap.stylePresets.map((p) => p.name);
    const preset: StylePreset = { name: defaultStylePresetName(names), style: this.captureStyle(this.state.activeLayerId) };
    const next = addStylePresetTo(this.snap.stylePresets, preset);
    if (next !== this.snap.stylePresets) { this.set({ stylePresets: next }); this.saveStylePresets(); }
  }
  removeStylePreset(i: number) {
    const next = removeStylePresetAt(this.snap.stylePresets, i);
    if (next !== this.snap.stylePresets) { this.set({ stylePresets: next }); this.saveStylePresets(); }
  }
  /** Styles ▸ Import: set the library to an already-merged list (e.g. from
   *  mergeStylePresets) and persist it. */
  importStylePresets(list: StylePreset[]) {
    this.set({ stylePresets: list });
    this.saveStylePresets();
  }
  /** Apply the preset's style to the active layer (mirrors pasteLayerStyle). */
  applyStylePreset(i: number) {
    const preset = this.snap.stylePresets[i];
    if (!preset) return;
    // The engine's layer-style setters are raw by contract: the caller owns
    // the snapshot. Without this, destroying a style cost zero undo steps.
    if (!this.beginHistory("Apply Style")) return;
    const id = this.state.activeLayerId;
    const e = this.engine.e;
    e.clear_layer_effects(id); // full replace, same as pasteLayerStyle
    this.applyStyleEffects(e, id, preset.style.effects);
    e.set_layer_blend_if(id, Float32Array.from(preset.style.blendIf));
    e.set_layer_fill_opacity(id, preset.style.fillOpacity / 100);
    this.commitHistory();
  }

  // ── adjustment layers ────────────────────────────────────────
  addAdjustmentLayer(kind: number, params: Float32Array, name: string): number {
    const id = this.engine.e.add_adjustment_layer(kind, params, name);
    this.engine.commit();
    return id;
  }
  setAdjustmentParams(id: number, params: Float32Array) {
    this.engine.e.set_adjustment_params(id, params);
    this.engine.commit();
  }
  adjParams(id: number): Float32Array {
    return this.engine.e.layer_adj_params(id);
  }

  // ── selection ────────────────────────────────────────────────
  selectAll() {
    this.engine.e.select_all();
    this.engine.sync();
  }
  deselect() {
    this.engine.e.select_none();
    this.engine.sync();
  }
  invertSelection() {
    this.engine.e.select_invert();
    this.engine.sync();
  }
  /** Select ▸ Transform Selection: scale, rotate, skew and move the marquee —
   *  the PIXELS are untouched, only the selection mask is reshaped. Scales are
   *  factors (1 = unchanged), `deg`/`skew*` are degrees. */
  transformSelection(sx: number, sy: number, tx: number, ty: number, deg = 0, skewH = 0, skewV = 0) {
    const e = this.engine.e;
    const scale = (s: number) => (Number.isFinite(s) && Math.abs(s) >= 1e-3 ? s : 1e-3);
    // tan() blows up at ±90°, which would fold the frame to zero area.
    const shear = (d: number) => (Number.isFinite(d) ? Math.max(-89, Math.min(89, d)) : 0);
    const t: PathTransform = {
      sx: scale(sx), sy: scale(sy), deg: Number.isFinite(deg) ? deg : 0,
      skewH: shear(skewH), skewV: shear(skewV),
      tx: Number.isFinite(tx) ? tx : 0, ty: Number.isFinite(ty) ? ty : 0,
    };
    if (t.sx === 1 && t.sy === 1 && !t.tx && !t.ty && !t.deg && !t.skewH && !t.skewV) return;
    if (!t.deg && !t.skewH && !t.skewV) {
      // Pure scale + move has a native engine path (and its own undo label).
      e.transform_selection(t.sx!, t.sy!, t.tx!, t.ty!);
      this.engine.sync();
      return;
    }
    if (!e.has_selection()) return;
    const b = Array.from(e.selection_bounds()) as number[];
    if (b[2] <= 0 || b[3] <= 0) return;
    const m = pathTransformMatrix(t, b[0] + b[2] / 2, b[1] + b[3] / 2);
    e.transform_selection_affine(m[0], m[1], m[2], m[3], m[4], m[5]);
    this.engine.sync();
  }
  /** Select ▸ Transform Selection: open the live on-canvas frame over the
   *  marquee, optionally seeded from the dialog's numeric fields. False when
   *  there is no selection to transform. */
  beginSelectionTransform(t: PathTransform = {}): boolean {
    const e = this.engine.engine;
    if (!e || !e.has_selection()) return false;
    const b = Array.from(e.selection_bounds()) as number[];
    if (b[2] <= 0 || b[3] <= 0) return false;
    this.set({ selectionTransform: { box: { x: b[0], y: b[1], w: b[2], h: b[3] }, t } });
    return true;
  }
  /** Merge a patch into the live frame (a handle drag, or a numeric field). */
  updateSelectionTransform(patch: PathTransform) {
    const cur = this.snap.selectionTransform;
    if (!cur) return;
    this.set({ selectionTransform: { ...cur, t: { ...cur.t, ...patch } } });
  }
  /** Apply the live frame to the mask and close it (Enter / ✓). */
  commitSelectionTransform() {
    const s = this.snap.selectionTransform;
    if (!s) return;
    this.set({ selectionTransform: null });
    const { sx = 1, sy = 1, deg = 0, skewH = 0, skewV = 0, tx = 0, ty = 0 } = s.t;
    if (sx === 1 && sy === 1 && !deg && !skewH && !skewV && !tx && !ty) return; // identity — nothing to undo
    this.transformSelection(sx, sy, tx, ty, deg, skewH, skewV);
  }
  /** Drop the live frame; the marquee is left exactly as it was (Esc / ✕). */
  cancelSelectionTransform() {
    if (this.snap.selectionTransform) this.set({ selectionTransform: null });
  }
  /** Select ▸ Reselect: restore the most recently deselected selection. */
  reselect() {
    if (this.engine.e.reselect()) this.engine.sync();
  }
  /** Select ▸ Sky: automatically select the connected sky region. */
  selectSky() {
    if (this.engine.e.select_sky(0.45, 0.35)) this.engine.sync();
  }
  /** Select ▸ Modify ▸ Expand: grow the selection by `n` pixels. */
  expandSelection(n: number) {
    this.engine.e.expand_selection(Math.max(0, Math.round(n)));
    this.engine.sync();
  }
  /** Select ▸ Modify ▸ Contract: shrink the selection by `n` pixels. */
  contractSelection(n: number) {
    this.engine.e.contract_selection(Math.max(0, Math.round(n)));
    this.engine.sync();
  }
  /** Select ▸ Modify ▸ Feather: soften the selection edge by `radius` pixels. */
  featherSelection(radius: number) {
    this.engine.e.feather_selection(Math.max(0, radius));
    this.engine.sync();
  }
  /** Select ▸ Modify ▸ Border: a band of `width` px straddling the edge. */
  borderSelection(width: number) {
    this.engine.e.border_selection(Math.max(1, Math.round(width / 2)));
    this.engine.sync();
  }
  /** Select ▸ Modify ▸ Smooth: round corners/spikes by a `radius`-px majority filter. */
  smoothSelection(radius: number) {
    this.engine.e.smooth_selection(Math.max(1, Math.round(radius)));
    this.engine.sync();
  }
  /** Select and Mask workspace live preview: the coverage the parameters +
   *  Refine Edge Brush `stroke` would produce. Pure — the live selection, undo
   *  history and canvas stay untouched. Empty when no selection is active. */
  selectAndMaskPreview(p: SamParams, stroke: Uint8Array): Uint8Array {
    const e = this.engine.e as unknown as SamEngine;
    // Stale wasm (predates the workspace exports): no preview, dialog degrades
    // to blind apply like the old modal.
    if (typeof e.select_and_mask_preview !== "function") return new Uint8Array(0);
    return e.select_and_mask_preview(...samArgs(p, stroke));
  }
  /** Select ▸ Select and Mask: commit the workspace in one undo step — Refine
   *  Edge (global Radius band + brush region, Smart Radius), Smooth, Feather,
   *  Contrast, Shift Edge (`shift` > 0 expands) — then route the result per
   *  Output To: the selection itself, a reveal-selection layer mask on the
   *  active layer, or a new layer with layer mask (optionally decontaminated). */
  selectAndMask(
    p: SamParams,
    stroke: Uint8Array,
    output: SamOutput = "selection",
    decontaminate: boolean | number = false,
    baseSelection?: Uint8Array,
  ): boolean {
    const e = this.engine.e as unknown as SamEngine;
    const [radius, smart, smooth, feather, contrast, shift] = samArgs(p, stroke);
    return this.commitSelectionOutput("Select and Mask", () => {
      if (typeof e.select_and_mask_preview !== "function") {
        // Stale wasm (predates the workspace): the old 4-arg whole-edge apply —
        // no brush region / Smart Radius / Contrast, but never misaligned args.
        (e.select_and_mask as unknown as (r: number, s: number, sh: number, f: number) => void)(radius, smooth, shift, feather);
      } else {
        e.select_and_mask(radius, smart, smooth, feather, contrast, shift, stroke);
      }
    }, output, decontaminate, baseSelection);
  }
  /** Commit "build a selection, then route it per Output To" as one transaction.
   *  The optional base is the workspace's scratch selection captured at OK. */
  private commitSelectionOutput(
    label: string,
    build: () => void,
    output: SamOutput,
    // Photoshop's Amount slider, 0..1. `true` is the historical full strength.
    decontaminate: boolean | number,
    baseSelection?: Uint8Array,
  ): boolean {
    if (!this.beginHistory(label)) return false;
    try {
      if (baseSelection) this.withoutHistoryStep(() => this.engine.e.set_selection_mask(baseSelection));
      this.withoutHistoryStep(build);
      this.routeSelectionOutput(output, decontaminate);
      return this.commitHistory();
    } catch (error) {
      this.dropHistory();
      throw error;
    }
  }
  /** Photoshop's "Output To" for a just-built selection — shared by Select and
   *  Mask and Focus Area so both route identically. History-neutral: the
   *  caller's transaction owns the single undo step (#172). */
  private routeSelectionOutput(output: SamOutput, decontaminate: boolean | number = false) {
    const e = this.engine.e;
    // The engine blends by 0..1; `true` is the historical full strength, and the
    // workspace's Amount slider now sends everything in between.
    const amount = typeof decontaminate === "number"
      ? Math.max(0, Math.min(1, decontaminate))
      : decontaminate ? 1 : 0;
    if (output === "layermask") {
      // Photoshop consumes the selection into the mask.
      this.withoutHistoryStep(() => e.add_layer_mask_reveal_selection(e.active_layer_id()));
      this.withoutHistoryStep(() => e.select_none());
    } else if (output === "newlayermask") {
      // Amount 0 = plain merged copy; the engine emits the new layer masked by
      // the just-built selection either way.
      this.withoutHistoryStep(() => e.decontaminate_colors(amount));
      this.withoutHistoryStep(() => e.select_none());
    } else if (amount > 0) {
      this.withoutHistoryStep(() => e.decontaminate_colors(amount));
    }
  }
  /** Select and Mask ▸ Decontaminate Colors: unmix the background fringe from
   *  partial-alpha edge pixels and emit the result as a new layer masked by the
   *  current selection (Photoshop's "New Layer with Layer Mask" output). */
  decontaminateColors(amount = 1) {
    this.engine.e.decontaminate_colors(Math.min(1, Math.max(0, amount)));
    this.markDirty();
    this.engine.sync();
  }
  /** Object Selection tool: select the distinct object inside a drawn box by
   *  flooding the background inward from the box border. Like every other
   *  selection tool it honours the combine mode (`mode`: 0 New / 1 Add /
   *  2 Subtract / 3 Intersect — the options-bar setting unless the caller passes
   *  the Shift/Alt-derived one) plus the options-bar Anti-alias and Feather. */
  selectObject(
    x: number,
    y: number,
    w: number,
    h: number,
    tol = this.snap.objectSelectionTolerance,
    mode = this.snap.selMode,
  ) {
    const e = this.engine.e;
    e.set_selection_antialias(this.snap.antiAlias);
    e.select_object(Math.round(x), Math.round(y), Math.round(w), Math.round(h), tol, mode);
    if (featherActive(this.snap.selectionFeather)) e.feather_selection(this.snap.selectionFeather);
    this.engine.sync();
  }

  /** Object Selection ▸ Lasso hint: the same tool with a freehand outline
   *  instead of a box. `pts` is a flat [x,y,…] polygon in document pixels;
   *  everything inside its bounding rect but outside the outline is background
   *  by construction, so a rough loop isolates better than a box can. */
  selectObjectLasso(pts: number[], tol = this.snap.objectSelectionTolerance, mode = this.snap.selMode) {
    const e = this.engine.e;
    e.set_selection_antialias(this.snap.antiAlias);
    e.select_object_lasso(new Float32Array(pts), tol, mode);
    if (featherActive(this.snap.selectionFeather)) e.feather_selection(this.snap.selectionFeather);
    this.engine.sync();
  }
  /** Select ▸ Grow: extend to contiguous pixels within the wand tolerance. */
  growSelection() {
    this.engine.e.grow_selection(this.snap.wandTolerance);
    this.engine.sync();
  }
  /** Select ▸ Similar: select every pixel within the wand tolerance of the selection. */
  similarSelection() {
    this.engine.e.similar_selection(this.snap.wandTolerance);
    this.engine.sync();
  }
  /** Select ▸ Color Range: build a graded global selection from explicit image
   *  samples. The numeric overload preserves the original foreground-colour API
   *  used by actions/E2E. */
  colorRangeSelect(options: ColorRangeOptions | number, legacyMode = 0) {
    const [fr, fg, fb] = hsvToRgba(this.snap.fg);
    const config: ColorRangeOptions = typeof options === "number"
      ? { fuzziness: options, mode: legacyMode, samples: [[fr, fg, fb]] }
      : options;
    const fuzziness = Math.max(0, Math.min(200, config.fuzziness));
    const mode = Math.max(0, Math.min(3, Math.round(config.mode ?? 0)));
    const samples = config.samples.length ? config.samples : [[fr, fg, fb] as const];
    const subtractSamples = config.subtractSamples ?? [];
    const allLayers = config.allLayers ?? true;
    const bytes = (colors: readonly ColorRangeSample[]) =>
      new Uint8Array(colors.flatMap(([r, g, b]) => [r, g, b]));
    const clusterRange = Math.max(0, config.clusterRange ?? 0);
    const points = config.points ?? [];
    if (clusterRange > 0 && points.length === samples.length) {
      // Localized Color Clusters has no subtract pass in Photoshop — the spatial
      // limit is what narrows the match — so the minus-eyedropper stays on the
      // unlocalized path.
      this.engine.e.select_color_range_localized(
        bytes(samples),
        new Float32Array(points.flatMap(([x, y]) => [x, y])),
        fuzziness,
        clusterRange,
        mode,
        config.invert ?? false,
        allLayers,
      );
      this.engine.sync();
      return;
    }
    this.engine.e.select_color_range_batch(
      bytes(samples),
      bytes(subtractSamples),
      fuzziness,
      mode,
      config.invert ?? false,
      allLayers,
    );
    this.engine.sync();
  }

  /** Layer Style ▸ Contour Editor: replace the document's custom curve library.
   *  The engine is handed the flattened LUTs, so every effect using one
   *  re-renders; the named points stay here for the editor to reopen. */
  setContours(next: CustomContour[]) {
    const library = normalizeContours(next);
    const e = this.engine.e as unknown as {
      set_contours?: (flat: Float32Array, lengths: Uint32Array) => void;
    };
    if (typeof e.set_contours === "function") {
      const { flat, lengths } = flattenContours(library);
      e.set_contours(flat, lengths);
    }
    this.set({ contours: library });
    this.markDirty();
    this.engine.sync();
  }

  /** Color Range ▸ Selection Preview: install (or clear) the coverage the canvas
   *  overlay paints, and the rendering to paint it with. The dialog owns the
   *  lifetime — it clears on OK and on Cancel. */
  setSelectionPreview(mask: Uint8Array | null, mode: SelectionPreviewMode) {
    this.selectionPreviewMask = mask && mode !== "none" ? mask : null;
    this.set({ selectionPreviewMode: mask ? mode : "none", selectionPreviewGen: this.snap.selectionPreviewGen + 1 });
  }

  /** The live preview coverage, or null when nothing is previewing. */
  selectionPreviewBuffer(): Uint8Array | null {
    return this.selectionPreviewMask;
  }

  /** Color Range ▸ Highlights / Midtones / Shadows. `kind` 0 shadows /
   *  1 midtones / 2 highlights; `range` 0..1 is the dialog's Range slider. */
  tonalRangeSelect(kind: number, range: number, opts: { mode?: number; invert?: boolean; allLayers?: boolean } = {}) {
    this.engine.e.select_tonal_range(
      Math.max(0, Math.min(2, Math.round(kind))),
      Math.max(0, Math.min(1, range)),
      Math.max(0, Math.min(3, Math.round(opts.mode ?? 0))),
      opts.invert ?? false,
      opts.allLayers ?? true,
    );
    this.engine.sync();
  }

  /** Color Range ▸ Out of Gamut: select what the current proof cannot print.
   *  The flag comes from the same ICC LUT (or profile-free heuristic) the
   *  View ▸ Gamut Warning overlay paints with. */
  outOfGamutSelect(opts: { mode?: number; invert?: boolean } = {}) {
    const mask = this.engine.outOfGamutMask();
    if (!mask.length) return;
    if (opts.invert) for (let i = 0; i < mask.length; i++) mask[i] = 255 - mask[i];
    this.engine.e.apply_selection_mask(mask, Math.max(0, Math.min(3, Math.round(opts.mode ?? 0))));
    this.engine.sync();
  }
  /** Select ▸ Save Selection: store the current selection as a named channel.
   *  `mode` combines into an existing channel of that name (0 replace · 1 add ·
   *  2 subtract · 3 intersect — Photoshop's Operation, offered only when
   *  overwriting); `docId` writes it into another open document of the same
   *  size. Recorded actions replay by document id, so a cross-document step
   *  only replays inside the session that recorded it. */
  saveSelection(name: string, mode = 0, docId?: number) {
    const dest = docId ?? this.activeDocId;
    if (dest === this.activeDocId && mode === 0) {
      this.engine.e.save_selection(name);
      this.markDirty();
      this.engine.sync();
      return;
    }
    const sel = this.engine.e.get_selection_mask(); // whole canvas when nothing is selected
    const previous = mode === 0 ? null : this.savedSelectionMask(dest, name);
    const mask = previous ? combineMasks(previous, sel, mode) : sel;
    this.mutateDocEngine(dest, (e) => {
      if (e.width() * e.height() !== mask.length) return false; // different size: not exchangeable
      const pushes = e.undo_pushes();
      (e as Engine & { save_selection_mask(name: string, mask: Uint8Array): void })
        .save_selection_mask(name, mask);
      // `undo_pushes()`, not depth: a cap-sized stack evicts as it pushes. (#169)
      return e.undo_pushes() > pushes;
    });
  }
  /** Select ▸ Load Selection: bring a saved channel back, combining by `mode`.
   *  `invert` flips the channel first; `docId` sources it from another open
   *  document of the same size. */
  loadSelection(name: string, mode = 0, invert = false, docId?: number) {
    const src = docId ?? this.activeDocId;
    if (src === this.activeDocId && !invert) {
      this.engine.e.load_selection(name, mode);
      this.engine.sync();
      return;
    }
    const mask = this.savedSelectionMask(src, name);
    const a = this.activeEntry();
    if (!mask || !a || mask.length !== a.engine.width() * a.engine.height()) return;
    if (invert) for (let i = 0; i < mask.length; i++) mask[i] = 255 - mask[i];
    this.applyMaskToSelection(mask, mode);
  }
  /** Read a saved alpha channel without changing the source selection or history. */
  private savedSelectionMask(docId: number, name: string): Uint8Array | null {
    const d = this.docs.find((x) => x.id === docId);
    if (!d || ![...d.engine.saved_selection_names()].includes(name)) return null;
    // A PURE read. This used to load the channel and undo, which left the
    // counterpart on the SOURCE document's redo stack — that document then
    // reported canRedo and Ctrl+Shift+Z there re-applied a selection load the user
    // never performed in it. (#88)
    const mask = d.engine.saved_selection_mask(name);
    return mask.length > 0 ? mask : null;
  }
  /** Combine document-sized coverage into the active selection as one engine step. */
  private applyMaskToSelection(mask: Uint8Array, mode: number) {
    const e = this.engine.e;
    const pushes = e.undo_pushes();
    (e as Engine & { apply_selection_mask(mask: Uint8Array, mode: number): void })
      .apply_selection_mask(mask, mode);
    if (e.undo_pushes() === pushes) return; // wrong size or read-only import
    this.engine.sync();
  }
  /** Names of the saved selection channels (for the Load dialog). */
  savedSelectionNames(): string[] {
    return this.engine.engine ? [...this.engine.engine.saved_selection_names()] : [];
  }
  /** Saved channel names in any open document (Load/Save Selection's Channel
   *  list once a source/destination document is picked). */
  savedSelectionNamesIn(docId: number): string[] {
    const d = this.docs.find((x) => x.id === docId);
    if (d) return [...d.engine.saved_selection_names()];
    return docId === this.activeDocId ? this.savedSelectionNames() : [];
  }
  /** Open documents whose pixel size matches the active one — Photoshop's rule
   *  for which documents Save/Load Selection can trade channels with. */
  selectionExchangeDocs(): { id: number; name: string }[] {
    const a = this.activeEntry();
    if (!a) return [];
    const [w, h] = [a.engine.width(), a.engine.height()];
    return this.docs
      .filter((d) => d.engine.width() === w && d.engine.height() === h)
      .map((d) => ({ id: d.id, name: d.name }));
  }
  deleteSavedSelection(name: string) {
    this.engine.e.delete_saved_selection(name);
    this.markDirty();
    this.engine.sync();
  }
  /** Channels panel ▸ Duplicate Channel: copy a document channel's grayscale into
   *  a new named alpha channel (0 = composite luminance, 1 = red, 2 = green,
   *  3 = blue; grayscale maps every plane to gray). */
  duplicateChannel(channel: number, name: string) {
    this.engine.e.duplicate_channel(channel, name);
    this.markDirty();
    this.engine.sync();
  }
  /** Channels panel thumbnails: one grayscale data URL per document channel
   *  index (duplicate_channel's convention — 0 = composite luminance, 1..n = the
   *  mode's plates). Every channel is sampled from a single composite read, so
   *  the panel costs one buffer copy per revision, like the Navigator. */
  channelThumbUrls(channels: number[], maxW = 32, maxH = 32): string[] {
    const src = this.engine.outputCopy();
    const { width: w, height: h } = this.engine;
    const cv = w && h ? document.createElement("canvas") : null;
    const cx = cv?.getContext("2d");
    if (!src || !cv || !cx) return channels.map(() => "");
    const scale = Math.min(maxW / w, maxH / h, 1);
    cv.width = Math.max(1, Math.round(w * scale));
    cv.height = Math.max(1, Math.round(h * scale));
    const img = cx.createImageData(cv.width, cv.height);
    // A document separated through a profile reads its plates from the engine,
    // like the Info readout and the exporters; the built-in model stays in TS.
    const e = this.engine.engine;
    const plates = this.snap.modeProfileName && e?.plate_thumb ? e : null;
    return channels.map((channel) => {
      img.data.set(plates
        ? grayToRgba(plates.plate_thumb(channel, cv.width, cv.height))
        : channelPlaneThumb(src, w, h, cv.width, cv.height, this.snap.mode, channel));
      cx.putImageData(img, 0, 0);
      return cv.toDataURL();
    });
  }
  /** One coverage plane → a data URL for a Channels row thumbnail. Shares the
   *  canvas sizing with `channelThumbUrls` so every row lines up. */
  coverageThumbUrl(plane: ArrayLike<number>, maxW = 32, maxH = 32): string {
    const { width: w, height: h } = this.engine;
    if (!w || !h || plane.length !== w * h) return "";
    const cv = document.createElement("canvas");
    const cx = cv.getContext("2d");
    if (!cx) return "";
    const scale = Math.min(maxW / w, maxH / h, 1);
    cv.width = Math.max(1, Math.round(w * scale));
    cv.height = Math.max(1, Math.round(h * scale));
    const img = cx.createImageData(cv.width, cv.height);
    img.data.set(coverageThumb(plane, w, h, cv.width, cv.height));
    cx.putImageData(img, 0, 0);
    return cv.toDataURL();
  }

  /** Thumbnail for a saved alpha channel — its stored coverage, not its
   *  overlay colour. */
  savedChannelThumbUrl(name: string): string {
    return this.coverageThumbUrl(this.engine.e.saved_selection_mask(name));
  }

  /** Thumbnail for a spot plate — its ink coverage. */
  spotChannelThumbUrl(index: number): string {
    const e = this.engine.e as unknown as { spot_channel_coverage?: (i: number) => Uint8Array };
    return typeof e.spot_channel_coverage === "function"
      ? this.coverageThumbUrl(e.spot_channel_coverage(index))
      : "";
  }

  /** Thumbnail for the temporary Quick Mask row, while it exists. */
  quickMaskThumbUrl(): string {
    const buf = this.engine.quickMaskBuffer();
    return buf ? this.coverageThumbUrl(buf) : "";
  }

  /** Channels panel ▸ Split Channels: open one grayscale document per RGB channel
   *  of the active document. */
  splitChannels() {
    const base = (this.docName(this.state.activeDocId) ?? "Untitled").replace(/\.[^.]+$/, "");
    // Capture every plane from the active doc first — openImage switches the active doc.
    const planes = [1, 2, 3].map((c) => new Uint8Array(this.engine.e.export_channel_png(c)));
    const names = ["Red", "Green", "Blue"];
    planes.forEach((bytes, i) => this.openImage(bytes, `${base}_${names[i]}`, null));
  }
  /** Channels panel ▸ Merge Channels: rebuild an RGB document from a Split set —
   *  documents named "<base>_Red/_Green/_Blue" of matching size. No-op if no
   *  complete set is open. */
  mergeChannels() {
    const groups = new Map<string, Partial<Record<"Red" | "Green" | "Blue", DocEntry>>>();
    for (const d of this.docs) {
      const m = /^(.*)_(Red|Green|Blue)$/.exec(d.name);
      if (!m) continue;
      const grp = groups.get(m[1]) ?? {};
      grp[m[2] as "Red" | "Green" | "Blue"] = d;
      groups.set(m[1], grp);
    }
    for (const [base, grp] of groups) {
      if (grp.Red && grp.Green && grp.Blue) {
        const png = this.engine.e.merge_channel_pngs(
          grp.Red.engine.export_png(),
          grp.Green.engine.export_png(),
          grp.Blue.engine.export_png(),
        );
        this.openImage(new Uint8Array(png), `${base}_Merged`, null);
        return true;
      }
    }
    return false;
  }
  /** Names of the active document's spot channels (mirrors the engine list). */
  private readSpotNames(): string[] {
    const e = this.engine.engine;
    if (!e) return [];
    const out: string[] = [];
    const n = e.spot_channel_count();
    for (let i = 0; i < n; i++) out.push(e.spot_channel_name(i));
    return out;
  }
  private afterSpotChange() {
    this.engine.engine?.composite(); // apply/clear the ink overprint
    this.markDirty();
    this.set({ spotChannelNames: this.readSpotNames() });
    this.engine.refreshFromEngine(); // blit the new composite + resync
  }
  /** Channels panel ▸ New Spot Channel: add an ink plate from the current
   *  selection, tinted with the foreground colour. */
  newSpotChannel() {
    const before = this.engine.e.spot_channel_count();
    const [r, g, b] = hsvToRgba(this.snap.fg);
    // Count+1 alone repeats a name after a delete (add 1 and 2, delete 1, and the
    // next plate is a second "Spot 2"). Skip past what is taken, as the alpha
    // channel rows in ChannelsPanel already do.
    const taken = new Set(this.readSpotNames());
    let n = before + 1;
    while (taken.has(`Spot ${n}`)) n++;
    const name = `Spot ${n}`;
    this.engine.e.add_spot_channel(name, r, g, b, 1);
    if (this.engine.e.spot_channel_count() === before) return;
    this.afterSpotChange();
  }
  removeSpotChannel(i: number) {
    this.engine.e.remove_spot_channel(i);
    this.afterSpotChange();
  }
  /** Direct Selection ▸ grab the path anchor nearest a document-space point
   *  (`tol` in document px). Snapshots one undo step; deselects if none is hit. */
  directSelectAt(x: number, y: number, tol = 8): boolean {
    // The shown work path is targeted first, like Photoshop's active path. Its
    // edits are session state, so there is no engine edit to open.
    const work = nearestOverlayAnchor(this.workPathTargets(), x, y, tol);
    if (work) {
      this.set({ selectedAnchor: work });
      return true;
    }
    const e = this.engine.engine;
    if (!e) return false;
    const id = this.state.activeLayerId;
    const hit = e.vector_nearest_anchor(id, x, y, tol);
    if (!hit) {
      if (this.snap.selectedAnchor) this.set({ selectedAnchor: null });
      return false;
    }
    const a = JSON.parse(hit) as { item: string; index: number };
    e.vector_begin_edit(id); // collapse the whole drag into one undo step
    // Refused on a locked layer. Surface it here and do not arm the drag —
    // an undrained message would resurface on the next unrelated commit.
    if (this.engine.consumeEditError()) return false;
    this.set({ selectedAnchor: a });
    return true;
  }
  /** Direct Selection ▸ drag the grabbed anchor to a document-space point. */
  dragSelectedAnchor(x: number, y: number) {
    const a = this.snap.selectedAnchor;
    if (!a) return;
    if (a.item === WORK_PATH_ITEM) {
      this.moveWorkPathAnchors([{ index: a.index, x, y }]);
      return;
    }
    this.engine.e.vector_move_anchor(this.state.activeLayerId, a.item, a.index, x, y);
    this.markDirty();
    this.engine.refreshFromEngine();
  }
  /** Direct Selection ▸ release the grabbed anchor. */
  endAnchorDrag() {
    if (this.snap.selectedAnchor) this.set({ selectedAnchor: null });
  }
  /** Direct Selection ▸ grab the bezier handle end nearest a document-space
   *  point (`tol` in document px). Callers try this BEFORE the anchor grab so
   *  a dragged-out handle stays grabbable. Snapshots one undo step. */
  directSelectHandleAt(x: number, y: number, tol = 8): boolean {
    const work = nearestOverlayHandle(this.workPathTargets(), x, y, tol);
    if (work) {
      this.set({ selectedHandle: work });
      return true;
    }
    const e = this.engine.engine;
    if (!e) return false;
    const id = this.state.activeLayerId;
    const hit = e.vector_nearest_handle(id, x, y, tol);
    if (!hit) {
      if (this.snap.selectedHandle) this.set({ selectedHandle: null });
      return false;
    }
    const h = JSON.parse(hit) as { item: string; index: number; end: "in" | "out" };
    e.vector_begin_edit(id); // collapse the whole drag into one undo step
    if (this.engine.consumeEditError()) return false; // locked layer — see directSelectAt
    this.set({ selectedHandle: h });
    return true;
  }
  /** Direct Selection ▸ drag the grabbed handle end to a document-space point.
   *  `mirror` keeps the opposite handle symmetric (smooth point); plain drags
   *  pass false so an asymmetric curve edits one side at a time. */
  dragSelectedHandle(x: number, y: number, mirror = false) {
    const h = this.snap.selectedHandle;
    if (!h) return;
    if (h.item === WORK_PATH_ITEM) {
      const next = [...this.snap.penAnchors];
      pullAnchorHandles(next, h.index, x, y, mirror, h.end);
      this.setPenAnchors(next, this.snap.penContours);
      return;
    }
    this.engine.e.vector_move_handle(this.state.activeLayerId, h.item, h.index, h.end === "in", x, y, mirror);
    this.markDirty();
    this.engine.refreshFromEngine();
  }
  /** Direct Selection ▸ release the grabbed handle. */
  endHandleDrag() {
    if (this.snap.selectedHandle) this.set({ selectedHandle: null });
  }
  /** The shown work path's loops as Direct Selection targets: none without a
   *  bezier form, or while View ▸ Show ▸ Target Path hides it. */
  private workPathTargets(): OverlayPath[] {
    return this.snap.showTargetPath && hasAnchorForm(this.snap.penAnchors)
      ? workPathOverlays(this.snap.penAnchors, this.snap.penContours)
      : [];
  }
  /** Direct Selection ▸ move work-path anchors (flat indices) to document-space
   *  points with one re-flatten; relative handles ride along. Work-path geometry
   *  is session state, so like every other pen edit this takes no history step. */
  moveWorkPathAnchors(moves: { index: number; x: number; y: number }[]) {
    const next = [...this.snap.penAnchors];
    for (const m of moves) {
      const o = m.index * ANCHOR_STRIDE;
      if (m.index < 0 || o + ANCHOR_STRIDE > next.length) continue;
      next[o] = m.x;
      next[o + 1] = m.y;
    }
    this.setPenAnchors(next, this.snap.penContours);
  }
  /** Add Anchor Point tool ▸ insert an anchor on the path segment under the
   *  cursor without changing the shape (`tol` in document px). */
  addAnchorAt(x: number, y: number, tol = 6): boolean {
    const e = this.engine.engine;
    if (!e) return false;
    if (!e.vector_insert_anchor(this.state.activeLayerId, x, y, tol)) {
      this.engine.consumeEditError(); // no-op when the miss was just an empty segment
      return false;
    }
    this.markDirty();
    this.engine.refreshFromEngine();
    return true;
  }
  /** Delete Anchor Point tool ▸ remove the anchor under the cursor (the path
   *  itself goes when fewer than two anchors remain). */
  deleteAnchorAt(x: number, y: number, tol = 8): boolean {
    const e = this.engine.engine;
    if (!e) return false;
    const id = this.state.activeLayerId;
    const hit = e.vector_nearest_anchor(id, x, y, tol);
    if (!hit) return false;
    const a = JSON.parse(hit) as { item: string; index: number };
    if (!e.vector_delete_anchor(id, a.item, a.index)) { this.engine.consumeEditError(); return false; }
    if (this.snap.selectedAnchor) this.set({ selectedAnchor: null }); // indices shifted under the selection
    this.markDirty();
    this.engine.refreshFromEngine();
    return true;
  }
  /** Convert Point tool ▸ toggle the anchor under the cursor smooth ⇄ corner. */
  convertPointAt(x: number, y: number, tol = 8): boolean {
    const e = this.engine.engine;
    if (!e) return false;
    const hit = e.vector_nearest_anchor(this.state.activeLayerId, x, y, tol);
    if (!hit) return false;
    const a = JSON.parse(hit) as { item: string; index: number };
    if (!e.vector_convert_anchor(this.state.activeLayerId, a.item, a.index)) { this.engine.consumeEditError(); return false; }
    this.markDirty();
    this.engine.refreshFromEngine();
    return true;
  }
  private pathDragLast: { x: number; y: number } | null = null;
  /** Path Selection ▸ grab the path component under a document-space point
   *  (`tol` in document px). Snapshots one undo step. A plain click selects that
   *  component alone (or keeps the current selection when it is already in it,
   *  so a drag moves all of them); `extend` (Shift) toggles it in and out of
   *  the selection (#456). A plain click on nothing deselects; a shift-click on
   *  nothing keeps the selection, as in Photoshop. */
  pathSelectAt(x: number, y: number, tol = 6, extend = false): boolean {
    const e = this.engine.engine;
    if (!e) return false;
    const id = this.state.activeLayerId;
    const item = e.vector_hit_test(id, x, y, tol);
    const prev = this.snap.selectedPaths;
    if (!item) {
      this.pathDragLast = null;
      if (!extend && prev.length) this.set({ selectedPaths: [] });
      return false;
    }
    e.vector_begin_edit(id);
    if (this.engine.consumeEditError()) return false; // locked layer — see selectAnchorAt
    this.pathDragLast = { x, y };
    const selectedPaths = extend
      ? (prev.includes(item) ? prev.filter((p) => p !== item) : [...prev, item])
      : (prev.includes(item) ? prev : [item]);
    this.set({ selectedPaths });
    return true;
  }
  /** Path Selection ▸ drag the selected component(s) to a document-space point. */
  dragSelectedPath(x: number, y: number) {
    const items = this.snap.selectedPaths;
    if (!items.length || !this.pathDragLast) return;
    const dx = x - this.pathDragLast.x;
    const dy = y - this.pathDragLast.y;
    this.pathDragLast = { x, y };
    // ponytail: one engine call (and re-raster) per component per move; batch
    // through a translate-by-ids export if a many-component drag ever lags.
    for (const item of items) this.engine.e.vector_translate_item(this.state.activeLayerId, item, dx, dy);
    this.markDirty();
    this.engine.refreshFromEngine();
  }
  /** Path Selection ▸ release the grabbed path. The PICK survives the release —
   *  it is what the Properties panel's Shape section edits, exactly as a
   *  selected component drives Photoshop's live-shape properties. Clicking
   *  nothing (`pathSelectAt` with no hit) drops it again. */
  endPathDrag() {
    this.pathDragLast = null;
  }
  /** Properties panel ▸ Shape: the live properties (fill, stroke, W/H/X/Y, four
   *  corner radii) of the component Path Selection picked — or the active vector
   *  layer's first one. Null when the active layer isn't a shape layer, so the
   *  panel can stay contextual. Read per render off the engine, like the mask
   *  rows: an undo, an MCP call or a canvas drag must show up without a cache. */
  shapeProps(): ShapeProps | null {
    const e = this.engine.engine;
    const id = this.state.activeLayerId;
    if (!e || e.layer_kind(id) !== LAYER_KIND.vector) return null;
    return shapePropsFromScene(e.vector_scene_json(id), this.snap.selectedPaths[0]);
  }
  /** Properties panel ▸ Shape: patch those properties back through the scene —
   *  ONE `vector_set_scene` + commit, so every field edit is one undo step and
   *  persists with the layer's scene. */
  setShapeProps(patch: ShapePatch): boolean {
    const e = this.engine.engine;
    if (!e || e.layer_kind(this.state.activeLayerId) !== LAYER_KIND.vector) return false;
    return this.commitShapeScene((json) => sceneWithShapeProps(json, this.snap.selectedPaths[0] ?? "", patch));
  }
  /** Path Selection ▸ Align the selected components (mode as alignLayer: 0 left
   *  · 1 h-centre · 2 right · 3 top · 4 v-centre · 5 bottom). */
  alignPathComponents(mode: number) {
    this.movePathComponents((b) => alignDeltas(b, mode));
  }
  /** Path Selection ▸ Distribute the selected components ((axis, key) as
   *  distributeLayers: axis 0 h · 1 v; key 0 start · 1 centre · 2 end · 3 spacing). */
  distributePathComponents(axis: number, key: number) {
    this.movePathComponents((b) => distributeDeltas(b, axis, key));
  }
  /** Translate the selected components by what `plan` makes of their world
   *  bounds. ONE undo step: vector_begin_edit snapshots the layer once and the
   *  per-component translates ride on it (the drag's own recipe). */
  private movePathComponents(plan: (bounds: ComponentBounds[]) => ComponentDelta[]) {
    const e = this.engine.engine;
    if (!e) return;
    const id = this.snap.activeLayerId;
    const bounds: ComponentBounds[] = [];
    for (const item of this.snap.selectedPaths) {
      const [x, y, w, h] = e.vector_item_bounds(id, item); // empty = stale id
      if (h !== undefined) bounds.push({ id: item, x, y, w, h });
    }
    const moves = plan(bounds).filter((d) => d.dx !== 0 || d.dy !== 0);
    if (!moves.length) return;
    e.vector_begin_edit(id);
    if (this.engine.consumeEditError()) return; // locked layer
    for (const d of moves) e.vector_translate_item(id, d.id, d.dx, d.dy);
    this.engine.commit();
  }
  /** Path Selection ▸ Arrange: Bring to Front (`toFront`) / Send to Back the
   *  selected components inside their shape layer — a scene reorder, one undo
   *  step through vector_set_scene. Returns whether the command was CLAIMED
   *  (Path Selection active with a selection — an already-frontmost component
   *  is a claimed no-op), so Layer ▸ Arrange can fall back to the layer move. */
  arrangePathComponents(toFront: boolean): boolean {
    const e = this.engine.engine;
    const ids = this.snap.selectedPaths;
    if (!e || this.snap.tool !== "pathselect" || !ids.length) return false;
    const id = this.snap.activeLayerId;
    const json = arrangeComponents(e.vector_scene_json(id), ids, toFront);
    if (json) {
      try { e.vector_set_scene(id, json); } catch { /* read-only import — surfaced by commit() */ }
      this.engine.commit();
    }
    return true;
  }
  /** Paint Symmetry: axis mirrors plus radial/mandala repeats around the centre. */
  setPaintSymmetry(mode: number, segments = this.snap.paintSymmetrySegments) {
    if (this.snap.paintSymmetryTransforming) this.commitPaintSymmetryTransform();
    const next = Math.max(0, Math.min(10, Math.round(Number.isFinite(mode) ? mode : 0)));
    const requestedSegments = Math.round(Number.isFinite(segments) ? segments : 6);
    const nextSegments = Math.max(next === 10 ? 3 : 2, Math.min(next === 10 ? 10 : 12, requestedSegments));
    const e = this.engine.e;
    const modeChanged = e.paint_symmetry_mode() !== next;
    const cx = modeChanged ? this.state.doc.width / 2 : e.paint_symmetry_axis_x();
    const cy = modeChanged ? this.state.doc.height / 2 : e.paint_symmetry_axis_y();
    const angle = modeChanged ? 0 : e.paint_symmetry_angle();
    const scale = modeChanged ? 1 : e.paint_symmetry_scale();
    const changed = e.commit_paint_symmetry(next, nextSegments, cx, cy, angle, scale);
    this.set({ paintSymmetryVisible: next === 0 ? this.snap.paintSymmetryVisible : true });
    if (changed) {
      this.engine.sync();
      this.markDocDirty(this.activeDocId);
    }
  }
  setPaintSymmetrySegments(segments: number) {
    if (this.snap.paintSymmetryTransforming) this.commitPaintSymmetryTransform();
    const mode = this.snap.paintSymmetry;
    const requested = Math.round(Number.isFinite(segments) ? segments : 6);
    const next = Math.max(mode === 10 ? 3 : 2, Math.min(mode === 10 ? 10 : 12, requested));
    const e = this.engine.e;
    const changed = e.commit_paint_symmetry(
      mode,
      next,
      e.paint_symmetry_axis_x(),
      e.paint_symmetry_axis_y(),
      e.paint_symmetry_angle(),
      e.paint_symmetry_scale(),
    );
    if (!changed) return;
    this.engine.sync();
    this.markDocDirty(this.activeDocId);
  }
  beginPaintSymmetryTransform() {
    if (this.snap.paintSymmetry === 0 || this.snap.paintSymmetryTransforming) return;
    const e = this.engine.e;
    const x = e.paint_symmetry_axis_x();
    const y = e.paint_symmetry_axis_y();
    const angle = e.paint_symmetry_angle();
    const scale = e.paint_symmetry_scale();
    this.paintSymmetryTransformStart = { docId: this.activeDocId, x, y, angle, scale };
    this.set({
      paintSymmetryAxisX: x,
      paintSymmetryAxisY: y,
      paintSymmetryAngle: angle,
      paintSymmetryScale: scale,
      paintSymmetryVisible: true,
      paintSymmetryTransforming: true,
    });
  }
  movePaintSymmetryPath(
    x: number,
    y: number,
    angle = this.snap.paintSymmetryAngle,
    scale = this.snap.paintSymmetryScale,
  ) {
    const start = this.paintSymmetryTransformStart;
    if (!start || start.docId !== this.activeDocId
      || !Number.isFinite(x) || !Number.isFinite(y)
      || !Number.isFinite(angle) || !Number.isFinite(scale)) return;
    const normalizedAngle = ((angle + 180) % 360 + 360) % 360 - 180;
    this.set({
      paintSymmetryAxisX: x,
      paintSymmetryAxisY: y,
      paintSymmetryAngle: normalizedAngle,
      paintSymmetryScale: Math.max(0.01, Math.min(100, scale)),
    });
  }
  commitPaintSymmetryTransform() {
    const start = this.paintSymmetryTransformStart;
    let changed = false;
    if (start && start.docId === this.activeDocId) {
      const e = this.engine.e;
      const draft = {
        x: this.snap.paintSymmetryAxisX,
        y: this.snap.paintSymmetryAxisY,
        angle: this.snap.paintSymmetryAngle,
        scale: this.snap.paintSymmetryScale,
      };
      changed = e.commit_paint_symmetry(
        this.snap.paintSymmetry,
        this.snap.paintSymmetrySegments,
        draft.x,
        draft.y,
        draft.angle,
        draft.scale,
      );
    }
    this.paintSymmetryTransformStart = null;
    if (this.snap.paintSymmetryTransforming) this.set({ paintSymmetryTransforming: false });
    if (changed) {
      this.engine.sync();
      this.markDocDirty(this.activeDocId);
    }
  }
  cancelPaintSymmetryTransform() {
    const start = this.paintSymmetryTransformStart;
    if (start && start.docId === this.activeDocId) {
      this.set({
        paintSymmetryAxisX: start.x,
        paintSymmetryAxisY: start.y,
        paintSymmetryAngle: start.angle,
        paintSymmetryScale: start.scale,
      });
    }
    this.paintSymmetryTransformStart = null;
    if (this.snap.paintSymmetryTransforming) this.set({ paintSymmetryTransforming: false });
  }
  togglePaintSymmetryVisibility() {
    this.set({ paintSymmetryVisible: !this.snap.paintSymmetryVisible });
  }
  /** View ▸ Pattern Preview: tile the document edge-to-edge to design seamless
   *  patterns (a display-only view; the document itself is unchanged). */
  togglePatternPreview() {
    this.set({ patternPreview: !this.snap.patternPreview });
  }
  /** Layer ▸ Matting ▸ Defringe: bleed the interior colour into the active
   *  layer's transparency-edge pixels, removing a contaminating fringe. */
  defringe(width: number) {
    this.engine.e.defringe(Math.max(1, Math.round(width)));
    this.engine.commit();
  }
  /** Layer ▸ Matting ▸ Remove White/Black Matte: un-mix the matte colour from the
   *  active layer's anti-aliased edge pixels. */
  removeMatte(white: boolean) {
    this.engine.e.remove_matte(white);
    this.engine.commit();
  }
  /** Image ▸ Apply Image: blend a source layer onto the active layer with a
   *  blend mode + opacity (0..100), optionally inverting the source. */
  /** Image ▸ Apply Image. `channel` 255 = the RGB composite (Photoshop's
   *  default); otherwise the shared channel vocabulary — 0 Gray · 1 R · 2 G ·
   *  3 B · 4 Transparency · 5+ the saved alpha channel at that index. */
  applyImage(srcId: number, blendKebab: string, opacity: number, invert: boolean, channel = 255) {
    const e = this.engine.e as unknown as {
      apply_image_channel?: (id: number, b: number, o: number, i: boolean, c: number) => void;
    };
    const args = [srcId, blendIndex(blendKebab), Math.max(0, Math.min(1, opacity / 100)), invert] as const;
    if (typeof e.apply_image_channel === "function") e.apply_image_channel(...args, channel);
    else this.engine.e.apply_image(...args); // stale wasm: composite only
    this.engine.commit();
  }
  /** Image ▸ Calculations: blend two layers' channels into a new selection.
   *  `ch`: 0 Gray · 1 Red · 2 Green · 3 Blue. */
  calculations(s1: number, ch1: number, inv1: boolean, s2: number, ch2: number, inv2: boolean, blendKebab: string, opacity: number) {
    this.engine.e.calculations(s1, ch1, inv1, s2, ch2, inv2, blendIndex(blendKebab), Math.max(0, Math.min(1, opacity / 100)));
    this.engine.sync();
  }

  /** Image ▸ Calculations ▸ Result ▸ New Document: the same blend, opened as a
   *  standalone grayscale document instead of becoming the selection. Reads the
   *  result back without touching the live selection or history. */
  calculationsToDocument(
    s1: number, ch1: number, inv1: boolean,
    s2: number, ch2: number, inv2: boolean,
    blendKebab: string, opacity: number,
  ): boolean {
    const e = this.engine.e as unknown as {
      calculations_mask?: (...a: unknown[]) => Uint8Array;
      encode_gray_png?: (plane: Uint8Array) => Uint8Array;
    };
    if (typeof e.calculations_mask !== "function" || typeof e.encode_gray_png !== "function") return false;
    const mask = e.calculations_mask(s1, ch1, inv1, s2, ch2, inv2, blendIndex(blendKebab), Math.max(0, Math.min(1, opacity / 100)));
    if (!mask.length) return false;
    const base = (this.docName(this.state.activeDocId) ?? "Untitled").replace(/\.[^.]+$/, "");
    this.openImage(new Uint8Array(e.encode_gray_png(mask)), `${base}_Calculations`, null);
    return true;
  }
  /** Edit ▸ Stroke: paint a band along the selection edge with the foreground
   *  colour. `location`: 0 inside, 1 center, 2 outside. */
  strokeSelection(width: number, location: number) {
    const [r, g, b, a] = hsvToRgba(this.snap.fg);
    this.engine.e.stroke_selection(Math.max(1, Math.round(width)), r, g, b, a, location);
    this.engine.commit();
  }
  /** Edit ▸ Fill: fill the selection (or whole layer) with a preset content at
   *  the given opacity and blend mode. */
  fillContents(contents: FillContent, opacity: number, modeKebab: string, custom: RGB = [0, 0, 0], preserve = false) {
    if (this.applyFill(contents, opacity, modeKebab, custom, preserve)) this.engine.commit();
  }
  /** The Fill routing itself, without the commit — shared with `fillPath`, which
   *  has to keep its select/fill/deselect inside ONE history step. False = the
   *  contents are not a fill this method performs (content-aware). */
  private applyFill(contents: FillContent, opacity: number, modeKebab: string, custom: RGB, preserve: boolean): boolean {
    const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
    const mode = blendIndex(modeKebab);
    if (contents === "pattern") {
      if (preserve) this.engine.e.fill_pattern_preserve(a, mode);
      else this.engine.e.fill_pattern(a, mode);
      return true;
    }
    if (contents === "history") {
      // Edit ▸ Fill ▸ History: fill from the History Brush source (no flat colour).
      this.engine.e.fill_history(a, mode);
      return true;
    }
    const fg = hsvToRgba(this.snap.fg), bg = hsvToRgba(this.snap.bg);
    const rgb = resolveFillRgb(contents, [fg[0], fg[1], fg[2]], [bg[0], bg[1], bg[2]], custom);
    if (!rgb) return false; // content-aware is routed to its own op by the caller
    if (preserve) this.engine.e.fill_blend_preserve(rgb[0], rgb[1], rgb[2], a, mode);
    else this.engine.e.fill_blend(rgb[0], rgb[1], rgb[2], a, mode);
    return true;
  }
  /** Edit ▸ Define Pattern: capture the selection (or layer) as a NAMED pattern
   *  in the Patterns library, and make it the active tile. Defining a second
   *  pattern no longer destroys the first — every consumer reads the engine's
   *  one active slot, which `selectPattern` repoints. */
  definePattern() {
    const e = this.engine.e;
    e.define_pattern();
    if (!e.has_pattern()) return; // empty capture (zero-area selection)
    const preset: PatternPreset = {
      name: defaultPatternName(this.snap.patternPresets.map((p) => p.name)),
      w: e.pattern_w(),
      h: e.pattern_h(),
      px: e.pattern_bytes(),
    };
    const next = addPatternTo(this.snap.patternPresets, preset);
    this.set({ patternPresets: next, activePattern: next.indexOf(preset) });
    this.syncStylePatterns();
    this.savePatternPresets();
    // Layer styles set to the "Defined" pattern sample this tile, so the engine
    // recomposites — repaint. Not a document edit, so no commit() (no dirty flag,
    // no history entry).
    this.engine.blit();
  }
  /** Make the library pattern at index `i` the engine's active tile. Every
   *  consumer — Edit ▸ Fill ▸ Pattern, the Pattern Stamp, new/replaced pattern
   *  fill layers, the Pattern Overlay style — reads that one slot, so this is
   *  the whole of "picking a pattern". Out-of-range is ignored. */
  selectPattern(i: number) {
    const p = this.snap.patternPresets[i];
    if (!p) return;
    this.engine.e.set_pattern(p.w, p.h, p.px);
    this.set({ activePattern: i });
    this.engine.blit();
  }
  /** Push the library to the engine as the tiles a LAYER STYLE may name (#420).
   *  Styles hold a pattern id, so this has to run whenever the library changes
   *  and whenever a document becomes active — an engine that never received a
   *  tile renders the checker in its place. Silently skipped on a wasm build
   *  without the export. */
  syncStylePatterns() {
    const e = this.engine.engine as { set_style_patterns?: (f: Uint16Array, w: Uint32Array, h: Uint32Array, i: Int32Array) => void } | null;
    if (!e?.set_style_patterns) return;
    const { flat, widths, heights, ids } = flattenStylePatterns(this.snap.patternPresets, patternLibraryId);
    e.set_style_patterns(flat, widths, heights, ids);
  }
  /** Delete the pattern at `i`. The engine keeps whatever tile it was last
   *  given (an existing pattern fill layer owns its own copy either way); the
   *  library just stops offering this one. */
  removePatternPreset(i: number) {
    const next = removePatternAt(this.snap.patternPresets, i);
    if (next === this.snap.patternPresets) return;
    this.set({ patternPresets: next, activePattern: activeAfterRemove(this.snap.activePattern, i) });
    this.syncStylePatterns();
    this.savePatternPresets();
  }
  /** Preset Manager ▸ reorder a pattern. `activePattern` is an INDEX, so the
   *  reorder has to follow the tile it points at — otherwise moving any row
   *  silently changes which pattern Fill and the Pattern Stamp use. */
  reorderPatternPreset(index: number, delta: number) {
    const list = this.snap.patternPresets;
    const next = moveItem(list, index, delta);
    if (next === list) return;
    const active = this.snap.activePattern;
    const stillActive = active >= 0 && active < list.length ? next.indexOf(list[active]) : active;
    this.set({ patternPresets: next, activePattern: stillActive });
    this.syncStylePatterns();
    this.savePatternPresets();
  }
  /** Preset Manager ▸ rename a pattern. */
  renamePatternPreset(index: number, name: string) {
    const next = renamePresetAt(this.snap.patternPresets, index, name);
    if (next === this.snap.patternPresets) return;
    this.set({ patternPresets: next });
    // The id is the name, so a rename re-keys the tile: a style that named the
    // old name renders the checker until it is repointed.
    this.syncStylePatterns();
    this.savePatternPresets();
  }
  /** Load…/Import: append a library, renaming collisions rather than dropping
   *  them (Photoshop never silently discards a loaded preset). */
  importPatternPresets(list: readonly PatternPreset[]): number {
    if (!list.length) return 0;
    this.set({ patternPresets: mergeNamed(this.snap.patternPresets, list) });
    this.savePatternPresets();
    this.syncStylePatterns();
    return list.length;
  }
  /** Persist the Patterns library (mirrors saveBrushPresets). Tiles are pixels,
   *  so a big library can exceed the storage quota; persistAuthoredContent
   *  reports that refusal through the app's existing warning toast.
   *  ponytail: localStorage only, so patterns do not travel with a project.
   *  Move them into the .monetgfx document when project-scoped patterns land. */
  private savePatternPresets(): boolean {
    return this.persistAuthoredContent("mv.patternPresets", serializePatterns(this.snap.patternPresets), "pattern presets");
  }
  /** Restore the saved Patterns library. Nothing is pushed into the engine —
   *  the active tile starts empty until the user picks one (same as
   *  loadBrushPresets resetting activeBrushPreset). */
  loadPatternPresets() {
    try {
      const list = parsePatterns(localStorage.getItem("mv.patternPresets"));
      if (list?.length) this.set({ patternPresets: list, activePattern: -1 });
    } catch { /* ignore */ }
  }
  /** Image ▸ Adjustments ▸ Replace Color: shift pixels near the foreground colour. */
  replaceColor(fuzziness: number, hue: number, sat: number, light: number) {
    const [r, g, b] = hsvToRgba(this.snap.fg);
    this.engine.e.adjust_replace_color(r, g, b, fuzziness, hue, sat, light);
    this.engine.commit();
  }
  /** Edit ▸ Fade: blend the last edit back toward the pre-op state. */
  fadeLast(opacity: number, modeKebab: string) {
    this.engine.e.fade_last(Math.max(0, Math.min(1, opacity)), blendIndex(modeKebab));
    this.engine.commit();
  }

  // ── history ──────────────────────────────────────────────────
  undo() {
    if (this.snap.paintSymmetryTransforming) this.commitPaintSymmetryTransform();
    const prior = this.revertUndo.get(this.activeDocId);
    if (prior && !this.engine.e.can_undo()) {
      this.revertUndo.delete(this.activeDocId);
      this.revertActiveDoc(this.engine.buildProject(prior.bytes), prior.document, { dirty: prior.dirty });
      return;
    }
    this.adoptingResolution(() => this.engine.e.undo());
    this.engine.commit();
    const d = this.activeEntry();
    if (d) this.syncCameraRawRecipeFromEngine(d);
  }
  redo() {
    if (this.snap.paintSymmetryTransforming) this.commitPaintSymmetryTransform();
    this.adoptingResolution(() => this.engine.e.redo());
    this.engine.commit();
    const d = this.activeEntry();
    if (d) this.syncCameraRawRecipeFromEngine(d);
  }
  /** History panel: jump the document to the timeline state with `applied` ops
   *  applied (0 = the initial/Open state), undoing/redoing as needed. */
  seekHistory(applied: number) {
    if (this.snap.paintSymmetryTransforming) this.commitPaintSymmetryTransform();
    this.adoptingResolution(() => this.engine.e.history_seek(Math.max(0, Math.round(applied))));
    this.engine.commit();
    const d = this.activeEntry();
    if (d) this.syncCameraRawRecipeFromEngine(d);
  }
  /** History panel flyout ▸ Delete: drop the selected state and every state after
   *  it, leaving the document at the state before the selection. State 0 is the
   *  document's opened state and cannot be deleted.
   *  ponytail: the redo branch is cleared by pushing a throwaway state rather than
   *  by an engine truncate — `push_undo` clears redo for us. Swap in an
   *  `Engine::truncate_redo()` if a cheaper/clearer primitive lands. */
  deleteHistoryFrom(applied: number) {
    const target = Math.round(applied);
    if (target < 1 || target > this.snap.history.length) return;
    this.seekHistory(target - 1);
    this.withoutHistoryStep(() => this.engine.e.push_history("Delete State"));
    this.engine.sync();
  }
  /** History panel flyout ▸ New Document: open the selected history state as its
   *  own document. The source tab stays on that state, exactly as clicking the
   *  row already left it. */
  newDocumentFromHistory(applied?: number): void {
    const target = Math.max(0, Math.min(Math.round(applied ?? this.snap.historyIndex), this.snap.history.length));
    if (target !== this.snap.historyIndex) this.seekHistory(target);
    // Named after the state, like Photoshop; "Open" for the untouched document.
    this.duplicateDocument(target === 0 ? "Open" : this.snap.history[target - 1]);
  }
  /** History panel "Set Source": freeze the active layer's current pixels as the
   *  History Brush / Edit ▸ Fill ▸ History source. Seek to any timeline state
   *  first to mark it, then seek back — the snapshot persists (runtime-only). */
  setHistorySource() {
    this.engine.e.set_history_source();
  }
  /** One labelled snapshot for a compound edit. The engine parks redo and
   *  defers History-States eviction until commit, so Cancel is exactly neutral. */
  beginHistory(label: string): boolean {
    const e = this.engine.e as StoreHistoryTransactionEngine;
    if (!e.begin_history_transaction()) return false;
    const before = e.undo_pushes();
    e.push_history(label);
    if (e.undo_pushes() > before) return true;
    e.cancel_history_transaction();
    return false;
  }
  commitHistory(): boolean {
    const e = this.engine.e as StoreHistoryTransactionEngine;
    const committed = e.commit_history_transaction();
    if (committed) this.engine.commit();
    else this.engine.refreshFromEngine();
    return committed;
  }
  dropHistory(): boolean {
    const cancelled = (this.engine.e as StoreHistoryTransactionEngine).cancel_history_transaction();
    if (cancelled) this.engine.refreshFromEngine();
    return cancelled;
  }
  /** End a continuous property edit (slider release) so the next drag is a
   *  separate undo step. No state change, so no sync needed. */
  endPropEdit() {
    this.engine.engine?.end_prop_edit();
  }

  // ── live (coalesced) property edits ──────────────────────────
  // Dialog sliders — Blending Options especially — fire onChange continuously.
  // Routing every tick through the engine setter's full composite + a full
  // canvas blit + a full UI sync (which regenerates *every* layer thumbnail via
  // toDataURL) saturates the main thread: layer effects re-render their blurs
  // per tick and the work piles up far faster than it drains, so the dialog
  // becomes unusable. During a drag we instead coalesce to at most one composite
  // + blit per animation frame (latest value wins; the unseen intermediate
  // frames are dropped) and defer the expensive UI sync until the drag settles.
  // `flushLive` finalizes on OK; `cancelLive` discards a pending edit so a queued
  // frame can't re-apply over a Cancel restore.
  private liveRaf = 0;
  private livePending: (() => void) | null = null;
  private liveSettle: ReturnType<typeof setTimeout> | 0 = 0;

  private liveRender(mutate: () => void) {
    const target = this.engine.engine;
    this.livePending = () => {
      if (this.engine.engine !== target) return;
      mutate();
      this.engine.blit();
      this.markDirty();
    };
    if (!this.liveRaf) {
      this.liveRaf = requestAnimationFrame(() => {
        this.liveRaf = 0;
        const fn = this.livePending; this.livePending = null;
        fn?.();
      });
    }
    // Trailing fallback: if no slider release fires (e.g. a colour-picker drag),
    // still settle with one full sync shortly after the edits stop.
    if (this.liveSettle) clearTimeout(this.liveSettle);
    this.liveSettle = setTimeout(() => this.flushLive(), 140);
  }

  /** Apply any pending live edit immediately and run the deferred full UI sync. */
  flushLive() {
    if (this.liveSettle) { clearTimeout(this.liveSettle); this.liveSettle = 0; }
    if (this.liveRaf) { cancelAnimationFrame(this.liveRaf); this.liveRaf = 0; }
    const fn = this.livePending; this.livePending = null;
    fn?.();
    this.engine.sync();
  }

  /** Discard a pending live edit without applying it (Cancel / reset paths). */
  cancelLive() {
    if (this.liveSettle) { clearTimeout(this.liveSettle); this.liveSettle = 0; }
    if (this.liveRaf) { cancelAnimationFrame(this.liveRaf); this.liveRaf = 0; }
    this.livePending = null;
  }

  // ── view helpers ─────────────────────────────────────────────
  fit() {
    this.requestFit();
  }
  /** Fit Layer(s) on Screen (Photoshop): zoom/pan so the active layer's opaque
   *  content fills the viewport. Falls back to whole-doc fit when the layer is
   *  empty (fully transparent) or the viewport hasn't been measured yet. */
  fitLayer() {
    const e = this.engine.engine;
    const { w: vw, h: vh } = this.snap.viewport;
    const b = e?.active_layer_bbox();
    if (!b || b.length < 4 || vw <= 0 || vh <= 0) {
      this.requestFit();
      return;
    }
    const rw = b[2] - b[0] + 1;
    const rh = b[3] - b[1] + 1;
    const angle = this.snap.rotationAngle;
    const par = this.snap.pixelAspectCorrection ? this.snap.pixelAspect : 1;
    const box = orientedDocSize(rw, rh, angle, par);
    const zoom = fitZoom(vw, vh, box.w, box.h);
    const cx = (b[0] + b[2] + 1) / 2;
    const cy = (b[1] + b[3] + 1) / 2;
    const { panX, panY } = panToShow(zoom, angle, par, this.snap.doc.width, this.snap.doc.height, { x: cx, y: cy }, vw / 2, vh / 2);
    this.setZoom(zoom, panX, panY);
  }
  requestFit() {
    this.set({ fitNonce: this.snap.fitNonce + 1 });
  }
  /** Zoom tool presets: ask the viewport to Fill Screen or set 100% (actual). */
  requestZoom(mode: "fill" | "actual") {
    this.set({ zoomCmd: { mode, nonce: (this.snap.zoomCmd?.nonce ?? 0) + 1 } });
  }
  zoomBy(factor: number) {
    this.setZoom(this.snap.zoom * factor);
  }
}

// Bound hooks are created in app.ts against the singleton store.
export function makeUseStore(store: Store) {
  return function useStore<T>(selector: (s: AppSnapshot) => T): T {
    return useSyncExternalStore(
      store.subscribe,
      () => selector(store.getSnapshot()),
      () => selector(store.getSnapshot()),
    );
  };
}
