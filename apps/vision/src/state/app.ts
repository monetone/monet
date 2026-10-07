// ─────────────────────────────────────────────────────────────
// app.ts — singletons + the action layer for adjustments, filters,
// transforms and file IO. UI imports `engine`, `store`, `useStore`
// and these helpers.
// ─────────────────────────────────────────────────────────────

import { invoke, isTauri } from "@tauri-apps/api/core";
import { startCollab } from "../collab";
import { MODEL_REGISTRY, type ModelDef } from "../ml/modelRegistry";
import type { GenControls } from "../ml/diffusion";
import type { PathTransform } from "./transformControls";
import type { FaceLiquifyParams } from "../ml/onnx";
import type { StyleBlendOpts } from "../ml/styleBlend";
import { docChanged, editStamp } from "../ml/editStamp";
import { EngineClient } from "../engine/EngineClient";
import { variableImagePath } from "./dataVariables";
import { runScriptEventBindings, scriptEventRunning, documentSaveEvent } from "./scriptEvents";
import { assertHistorySettled } from "../engine/historyTransaction";
import { ARTISAN_RE, Store, makeUseStore, hsvToRgba, blendIndex, type DuotoneDoc } from "./store";
import { IMPORTED_PHOTOSHOP_SAVE_BLOCKED, importedPhotoshopApi } from "./photoshopContainment";
import { LAYER_KIND } from "./engineContracts";
import { MAX_SCRIPT_IMPORT_BYTES, SCRIPT_LIMIT_ERROR, SCRIPT_MAX_OPS } from "./scriptLimits";
import { selectionRect } from "./selectionInfo";
import type { SamOutput, SamParams } from "./selectAndMask";
import type { ContentAwareFillOptions } from "./contentAwareFill";
import {
  PUPPET_GH,
  PUPPET_GW,
  cancelPuppetSession,
  openPuppetSession,
  pinsMoved,
  puppetDestinations,
  takePuppetCommit,
  type PuppetPin,
} from "./puppetWarp";
export { placePuppetPin, movePuppetPin } from "./puppetWarp";
import { formatColor, type ColorCopyFormat } from "@monet-ui/monet-color";
import { installQuitGuard } from "@monet-ui/monet-react";
import {
  VISION_CONTAINER_EXT,
  VISION_DOCUMENT_ENTRY_PATH,
  VISION_DOCUMENT_ROLE,
  canSaveInPlace,
  courierContainerSave,
  documentFitsFlatFormat,
  extOf,
  ignoredContainerEntries,
  isProjectSaveExtension,
  isSupportedSaveExtension,
  saveAsIsCopy,
  suggestedSaveName,
  type FlatDocumentFacts,
  type FlatLayerFacts,
} from "./nativeIoPolicy";
import {
  CONTAINER_APPS,
  entriesByRole,
  initMonetFormat,
  isContainer,
  readContainer,
  setEntry,
  writeContainer,
  type MonetContainer,
} from "@monet-ui/monet-format";
import { MAX_CAMERA_RAW_SOURCE_BYTES, type CameraRawSourceMetadata } from "./cameraRaw";
import {
  ADOBE_CAMERA_PROFILE_DIRS,
  MAX_CAMERA_PROFILE_BYTES,
  cameraModelKeys,
  collectAdobeProfilePaths,
  type CameraRawProfileEntry,
  type CameraRawProfileStorage,
} from "./cameraRawProfiles";
import { assertReadableFileSize, readWithinFileSizeLimit } from "./boundedRead";
import { readNativeFileBounded } from "./nativeBoundedRead";
import { decodeImportText, readBrowserImportBytes, readBrowserImportText, type LocalImportLimit } from "./localImport";
import { runBrowserSave } from "./browserSave";
import { RECOVERY_DIR, parseRecoveryFileName, planRecovery, recoveryFileName, recoveryLaunchBlocked, restoreRecoveryFiles } from "./autoRecover";
import { atomicWriteBytes } from "./atomicWrite";
import { isCliBoot, type CliJob, type CliResult } from "../native/cli";
import { BATCH_SAVE_OPS, BATCH_SCAN_RE, BATCH_SERIAL_ERROR, DEFAULT_BATCH_TEMPLATE, DROPLET_MAX_BYTES, batchSummary, collectBatchFolder, expandBatchTemplate, findDroplet, formatBatchLog, parseBatchSerial, parseDroplet, type BatchDestination, type BatchError, type DropletDescriptor } from "./batchIo";
import { IMAGE_PROCESSOR_DIR, IMAGE_PROCESSOR_EXT, IMAGE_PROCESSOR_MIME, fitWithinScale, jpegWithComment, pngWithCopyright, type ImageProcessorOptions } from "./imageProcessorIo";
import { printPng } from "../print";
import { decodeProfileIcc, loadPrintSettings, printLayout, printPageCss, printSettingsError, type PrintSettings } from "./printSettings";
import {
  documentFormatReadLimit,
  hasPhotoshopExtension,
  imageReadLimit,
  nextImageStackReadTotal,
  photoshopHeader,
  photoshopVersion,
  savePayloadTooLarge,
  usesPhotoshopRgbProfilePolicy,
  type ImageReadPurpose,
} from "./photoshopFilePolicy";
import {
  MAX_CAMERA_RAW_XMP_BYTES,
  applyCameraRawXmp,
  isOwnCameraRawXmp,
  parseCameraRawLookXmp,
  parseCameraRawXmp,
  serializeCameraRawXmp,
  type CameraRawSidecarSourceSnapshot,
} from "./cameraRawSidecar";
import type { VisionDevelopRecipe } from "./visionDevelopRecipe";
import {
  parseCameraRawPresetXmp,
  serializeCameraRawPresetXmp,
  type CameraRawPreset,
} from "./cameraRawPresets";
import { buildDNG16, resolveDNGInputProfile } from "./dng";
import { rasterizeSpec, PATH_ALIGNS } from "../text/raster";
import { boxShadowValue } from "./layerCss";
import {
  buildPdf, cmykFromPsd, deflate, rgbFromRgba,
  type PdfOutputIntent, type PdfPage, type PdfPreset, type PdfTextLine,
} from "./pdfExport";
import { loadLibrary, saveLibrary, addGraphic, removeGraphic, type LibraryGraphic } from "./libraries";
import { AVIF_RE, avifToPng, imageDataToPng } from "./avif";
import { SVG_RE, svgToPng } from "./svg";
import { embedRasterInSvg } from "@monet-ui/monet-imageio";
import { PDF_RE, pdfPageCount, pdfPageToPng } from "./pdfImport";
import { HEIC_RE } from "./heic";
import { DEFAULT_PHOTOSHOP_RAW_SAVE, PHOTOSHOP_RAW_RE, type PhotoshopRawLayout, type PhotoshopRawSaveOptions } from "./photoshopRaw";
import { TGA_RE, decodeTga, encodeTga } from "@monet-ui/monet-imageio";
import { PNM_RE, decodePnm, encodePnm } from "@monet-ui/monet-imageio";
import { PCX_RE, decodePcx, encodePcx } from "@monet-ui/monet-imageio";
import {
  defaultSpec, setText, fullText, applyRangeFormat, mergeRuns, resolveStyle, insertGlyph,
  FONTS, fontFamilyKey, WARP_STYLES, ANTIALIAS, ANTIALIAS_LABELS, KERNING, KERNING_LABELS, ALIGNMENTS, DIRECTIONS, COMPOSERS, KASHIDAS,
  hyphenationOf, justificationOf, LINE_COMPOSERS, type TextSpec, type TextWarp,
} from "../text/spec";
import { warpGrid } from "./warpMesh";
import { adaptiveWideGrid, type AdaptiveWideOptions } from "./adaptiveWideAngle";
import { composeOrder, effectArgs, filterDef, type GalleryEffect } from "./filterGallery";
import {
  createActionMeta, defaultActionName, filterActionMetas, findActionRef, markActionPlayed,
  renameActionMeta, toggleActionFavorite, decodeOpArgs, isSerializableArgs,
  resolvePlaybackLayerArg, retargetRecordedLayerArg, ZERO_ARG_MENU_PATHS,
  serializeAtn,
  moveItem, parseStopArgs, stepArgsPreview, stepLabel, DEFAULT_ACTION_SET, STOP_OP,
  MAX_ACTIONS_IMPORT_BYTES, parseActionsFile, serializeActionsFile,
  ACTION_CONDITIONS, IF_OP, MAX_ACTION_PLAY_DEPTH, PLAYBACK_MODES, ifBranchTarget,
  atnToActionsFile, MAX_ATN_IMPORT_BYTES,
  type ActionCondition, type ActionConditionContext, type ActionMeta, type ActionOp,
  type ActionStepInfo, type PlaybackMode, type PortableAction,
} from "./actionSets";
import { applyWebExportPixels, isLayerOpenJpegName, matteLevel, type WebExportMatte, type WebExportPrefs } from "./webExportPrefs";
import {
  optimizeQualityToSize, saveForWebFilename, webExportMime, webQualityApplies,
  type SaveForWebFormat, type SaveForWebMetadata,
} from "./webExportEstimate";
import { skyEdgePixels, skyGradientLine, skyGradientStops, type SkyReplacementOptions } from "./skyReplacement";
import { isIdentityWarp, perspectiveWarpCoords, type WarpOffset } from "./perspectiveWarp";
import { cropQuadPixels, isIdentityCrop, type CropCorner } from "./perspectiveCrop";
import { lightingArgs, type LightingOptions } from "./lightingEffects";
import { LIQUIFY_MESH_MIME, MAX_LIQUIFY_MESH_IMPORT_BYTES } from "./liquifyMesh";
import { ZOOMIFY_QUALITY, zipStore, zoomifyImageProperties, zoomifyTiles, zoomifyViewerHtml } from "./zoomify";
import { MAX_ACO_IMPORT_BYTES, parseAco, buildAco } from "@monet-ui/monet-imageio";
import { MAX_ASE_IMPORT_BYTES, parseAse } from "@monet-ui/monet-imageio";
import { MAX_ASL_IMPORT_BYTES, parseAsl, buildAsl, mergeStylePresets, parseStylePresets } from "./stylePresets";
import {
  MAX_ABR_IMPORT_BYTES,
  MAX_GRD_IMPORT_BYTES,
  MAX_PRESET_SET_BYTES,
  PRESET_CATEGORIES,
  PRESET_SET_EXT,
  buildGrd,
  buildPresetSet,
  parseAbr,
  parseGrd,
  presetSetItems,
  type PresetCategory,
} from "./presetManager";
import { parseBrushPresets } from "./brushPresets";
import { parseToolPresets } from "./toolPresets";
import { parseGradientPresets } from "./gradientPresets";
import { parseCustomShapes } from "./customShapes";
import { parsePatterns } from "./patternPresets";
import { parseSwatches } from "@monet-ui/monet-color";
import { MAX_ACT_IMPORT_BYTES, parseAct, buildAct, isActLength } from "@monet-ui/monet-imageio";
import { MAX_CUBE_LUT_IMPORT_BYTES, parseCubeLut, parse3dlLut, applyCubeLut16, lensFilterParams, resolveLensProfile, type LensCorrectionSettings, type CubeLut } from "@monet-ui/monet-photo";
import { clampSliceToDoc, sliceExportName, type Slice } from "./slices";
import { spotHealDabs } from "./spotHeal";
import {
  DISPLAY_LUT_SIZE,
  detectEmbeddedRgbProfile,
  embeddedProfileOpenWarning,
  embeddedProfilePolicyDecision,
  iccColorMode,
  lutSizeFor,
  missingProfileOpenWarning,
  missingProfilePolicyDecision,
  parseIccProfile,
  profileName,
  type IccProfileInfo,
} from "@monet-ui/monet-color";
import {
  deleteSmartLink,
  getSmartLink,
  listSmartLinks,
  markSmartLinkMissing,
  setSmartLink,
  type SmartLinkInfo,
} from "./smartLinks";
import { planPackageLinks, resolveProjectLinks, writePackageFiles } from "./packageDocument";
import {
  deleteSmartEditBinding,
  getSmartEditBinding,
  listSmartEditBindings,
  setSmartEditBinding,
  type SmartEditBinding,
} from "./smartEdits";
import {
  decodeDocumentMetaBytes,
  decodeProjectEnvelope,
  encodeDocumentMetaBytes,
  encodeProjectEnvelope,
  handoffDecodedProjectEnvelope,
  type PersistedSmartEditSource,
  type ProjectDocumentMeta,
} from "./projectEnvelope";
import { toPhotoshopPaths } from "./paths";
import { encodeDuotoneSpec } from "./duotone";
import { MAX_NOTE_IMPORT_BYTES, parseImportedNotes } from "./noteImport";
import type { ShortcutCommand } from "./keyboardShortcuts";
import {
  duplicateExportScaleFilename,
  duplicateExportScaleTargetFilename,
  exportScaleFilename,
  exportScaleFits,
  exportScaleTargetFilename,
  normalizeExportScaleRows,
  type ExportScaleRow,
} from "./exportScaleRows";

export const engine = new EngineClient();
// The generated, gitignored wasm declaration can lag a fresh Rust export.
export type HistoryTransactionEngine = typeof engine.e & {
  begin_history_transaction(): boolean;
  reset_history_transaction(): boolean;
  cancel_history_transaction(): boolean;
  commit_history_transaction(): boolean;
  history_transaction_active?(): boolean;
};
export const store = new Store(engine);
store.onDocumentEvent = (event) => {
  if (scriptEventRunning()) return;
  const docId = store.state.activeDocId;
  queueMicrotask(() => {
    if (event === "closeDocument" || store.openDocIds().includes(docId)) void runScriptEventBindings(event);
  });
};
engine.onSync = () => store.syncFromEngine();
export const useStore = makeUseStore(store);

// The universal Monet container (docs/plans/11-universal-container.md) is read
// and written through the shared monet-format WASM, which cannot instantiate
// synchronously in a browser. Kick it off at module load; the one place that
// can arrive before it resolves (routeOpen) waits for it.
const monetFormatReady = initMonetFormat();
let monetFormatLoaded = false;
void monetFormatReady
  .then(() => { monetFormatLoaded = true; })
  .catch((e) => console.error("monet-format failed to initialize:", e));

let documentNoticeSink: ((message: string) => void) | null = null;
/** Wire a visible, non-blocking notice channel (the UI's toast stack). */
export function setDocumentNoticeSink(sink: ((message: string) => void) | null) {
  documentNoticeSink = sink;
}
/** Report something the user must SEE but that is not an error — chiefly "this
 *  document contains entries Vision does not open" (design doc 11 rule 1).
 *  ponytail: falls back to the engine's edit-error bridge, the only toast sink a
 *  non-React module has today; call `setDocumentNoticeSink` from the UI to give
 *  these notices their own title. */
function notify(message: string) {
  const sink = documentNoticeSink ?? engine.onEditError;
  if (sink) sink(message);
  else console.info(message);
}

/** Real-time collaboration session (null unless ?room= / VITE_COLLAB=1). Vision
 *  collaborates via a stroke-operation channel — see ../collab. */
export let collab: ReturnType<typeof startCollab> = null;
export function startVisionCollab(): ReturnType<typeof startCollab> {
  return collab ??= startCollab(engine);
}
store.loadRecentFiles(); // restore File ▸ Open Recent from a prior session
store.loadExportPrefs(); // restore File ▸ Export ▸ Export Preferences
store.loadSwatches(); // restore the saved swatch library (reusable colour assets)
store.loadBrushPresets(); // restore the saved Brushes-panel preset library
store.loadBrushTips();    // and the custom tips defined from selections
store.loadToolPresets(); // restore the saved Tool Presets library
store.loadGradientPresets(); // restore the saved Gradients library
store.loadStylePresets(); // restore the saved Styles (layer-effect) library
store.loadCustomShapes(); // restore the saved custom-shape library
store.loadWebAndFilePrefs(); // restore Save for Web + File Handling preferences
store.loadColorPolicyPrefs(); // restore Color Settings profile policy preferences
store.loadAutoRecoverMinutes(); // restore Preferences ▸ File Handling recovery interval
store.loadFontPreviewSize(); // restore Type ▸ Font Preview Size
store.loadUseShiftKeyForToolSwitch(); // restore Preferences ▸ General tool cycling
store.loadSpringLoadedToolPreferences(); // restore Preferences ▸ Tools spring-loaded shortcuts
store.loadPreferencePanes(); // restore Preferences ▸ Cursors / Workspace / Camera Raw
store.onCameraRawSidecarOnOpen = (source) => {
  saveCameraRawSidecarOnOpen(source).catch((error: unknown) => engine.onEditError?.(
    `Opened ${source.originalName}, but could not save its Camera Raw settings to a sidecar .xmp (${error instanceof Error ? error.message : String(error)}).`));
};
store.loadPixelAspectPresets(); // restore View ▸ Pixel Aspect Ratio preset catalog
store.loadMeasureScalePresets(); // restore Image ▸ Analysis measurement-scale presets
store.loadKeyboardShortcuts(); // restore Edit ▸ Keyboard Shortcuts overrides

// Edit ▸ Search: a flat, runnable list of every wired menu command, populated by
// App.tsx from the built menu tree and read by the command-palette dialog.
export const commandPalette: {
  /** Runnable right now — what dispatch and Edit ▸ Search use. */
  items: ShortcutCommand[];
  toolItems: ShortcutCommand[];
  /** Every bindable application command, whatever its current state. Edit ▸
   *  Keyboard Shortcuts edits bindings, not availability, so it lists these
   *  (#501). Never dispatched from. */
  catalog: ShortcutCommand[];
} = {
  items: [],
  toolItems: [],
  catalog: [],
};

const E = () => engine.e;

function assertImportedPhotoshopWritable(eng = E()): void {
  if (importedPhotoshopApi(eng).imported_photoshop_read_only?.()) {
    throw new Error(IMPORTED_PHOTOSHOP_SAVE_BLOCKED);
  }
}

type SmartLinkedSourceReader = (path: string) => Promise<Uint8Array>;
type SmartLinkedSourceWatchEvent = { type?: unknown; paths?: string[] };
type SmartLinkedSourceWatchCallback = (event: SmartLinkedSourceWatchEvent) => void | Promise<void>;
type SmartLinkedSourceWatcher = (path: string, cb: SmartLinkedSourceWatchCallback) => Promise<() => void>;

let smartLinkedSourceReaderForTests: SmartLinkedSourceReader | null = null;
let smartLinkedSourceWatcherForTests: SmartLinkedSourceWatcher | null = null;
let smartLinkedSourceWatchSignature = "";
let smartLinkedSourceWatchRevision = 0;
const smartLinkedSourceWatchers = new Map<string, { revision: number; unwatch?: () => void }>();

const SMART_LINK_ACCEPT = "image/*,.svg,.tga,.pnm,.ppm,.pgm,.pbm,.pcx,.psd,.psb";
const SMART_LINK_FILTERS = [
  { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "gif", "avif", "heic", "heif", "svg", "tga", "pnm", "ppm", "pgm", "pbm", "pcx", "psd", "psb"] },
];

async function readSmartLinkedSource(path: string): Promise<Uint8Array> {
  if (smartLinkedSourceReaderForTests) return smartLinkedSourceReaderForTests(path);
  if (!isTauri()) throw new Error("Linked source path refresh is only available in the desktop app.");
  return readNativeImagePath(path, "place");
}

async function watchSmartLinkedSource(path: string, cb: SmartLinkedSourceWatchCallback): Promise<() => void> {
  if (smartLinkedSourceWatcherForTests) return smartLinkedSourceWatcherForTests(path, cb);
  if (!isTauri()) throw new Error("Linked source watching is only available in the desktop app.");
  const { watch } = await import("@tauri-apps/plugin-fs");
  return await watch(path, (event) => { void cb(event as SmartLinkedSourceWatchEvent); }, { delayMs: 300 });
}

async function pickSmartLinkedSourceFile(): Promise<{ bytes: Uint8Array; name: string; path: string } | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ multiple: false, filters: SMART_LINK_FILTERS });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return null;
    return {
      bytes: await readSmartLinkedSource(path),
      name: path.replace(/^.*[\\/]/, ""),
      path,
    };
  } catch (e) {
    reportOpen("linked source", e);
    return null;
  }
}

function smartWatchEventIsRemove(event: SmartLinkedSourceWatchEvent): boolean {
  const type = event.type;
  return !!type && typeof type === "object" && "remove" in type;
}

function smartWatchEventIsAccess(event: SmartLinkedSourceWatchEvent): boolean {
  const type = event.type;
  return !!type && typeof type === "object" && "access" in type;
}

function smartLinkedObjectsForDoc(docId: number): SmartLinkInfo[] {
  return listSmartLinks(docId, (layerId) => store.layerKindInDoc(docId, layerId) === 7);
}

function smartLinkedObjectsForAllOpenDocs(): SmartLinkInfo[] {
  return store.openDocIds().flatMap((docId) => smartLinkedObjectsForDoc(docId));
}

function smartWatchPaths(): string[] {
  const paths = new Set<string>();
  for (const info of smartLinkedObjectsForAllOpenDocs()) {
    if (info.path) paths.add(info.path);
  }
  return [...paths].sort();
}

function markSmartLinkedPathMissing(path: string): number {
  let count = 0;
  let activeDocChanged = false;
  for (const info of smartLinkedObjectsForAllOpenDocs()) {
    if (info.path !== path) continue;
    if (markSmartLinkMissing(info.docId, info.layerId, true)) {
      count++;
      store.markDocDirty(info.docId);
      if (info.docId === store.state.activeDocId) activeDocChanged = true;
    }
  }
  if (activeDocChanged) store.syncFromEngine();
  return count;
}

async function updateSmartLinkedPath(path: string): Promise<number> {
  let count = 0;
  for (const info of smartLinkedObjectsForAllOpenDocs()) {
    if (info.path !== path) continue;
    if (await smart.updateLinkedContentsFromPath(info.layerId, info.docId)) count++;
  }
  return count;
}

async function handleSmartLinkedSourceWatch(path: string, event: SmartLinkedSourceWatchEvent): Promise<void> {
  if (smartWatchEventIsAccess(event)) return;
  if (smartWatchEventIsRemove(event)) {
    markSmartLinkedPathMissing(path);
    return;
  }
  await updateSmartLinkedPath(path);
}

function stopSmartLinkedSourceWatchers(): void {
  for (const entry of smartLinkedSourceWatchers.values()) entry.unwatch?.();
  smartLinkedSourceWatchers.clear();
  smartLinkedSourceWatchSignature = "";
}

// ── Actions (macro record / playback) ──────────────────────────
let _recording = false;
let _suspended = false;
// A recorded step keeps its thunk (verbatim in-session replay) plus, when the
// call routed through a proxied namespace or a free fn with an explicit
// descriptor, a serializable [path, args] op used for persistence/export. A step
// with no op is VOLATILE: replays in-session but never persists.
// `enabled` undefined means on — only an explicit false skips the step at play.
// `dialog` true is Photoshop's modal toggle: playback pauses to confirm the step.
type Step = { run: () => unknown; op?: ActionOp; enabled?: boolean; dialog?: boolean };
const _recorded: Step[] = [];
export interface ActionRecorderMark {
  readonly steps: readonly Step[];
  readonly pendingOp: ActionOp | null;
  readonly lastApplyOp: ActionOp | null;
  readonly suspended: boolean;
}
type SavedAction = ActionMeta & { steps: Step[] };
let _nextActionId = 1;
let _savedActions: SavedAction[] = [];
// Descriptor capture state. `withOpCapture` stamps `_pendingOp` BEFORE invoking
// the impl (only at call depth 0); `rec`/`suspend`/`record` consume it. See the
// C2 boundary notes below.
let _pendingOp: ActionOp | null = null;   // descriptor of the last top-level proxied call
let _lastApplyOp: ActionOp | null = null; // snapshot taken at actions.suspend(false)
let _opDepth = 0;
function restoreActionRecorder(mark: ActionRecorderMark) {
  _recorded.splice(0, _recorded.length, ...mark.steps);
  _pendingOp = mark.pendingOp;
  _lastApplyOp = mark.lastApplyOp;
  _suspended = mark.suspended;
}
function withOpCapture<T extends object>(ns: string, obj: T): T {
  return new Proxy(obj, {
    get(t, prop, r) {
      const v = Reflect.get(t, prop, r);
      if (typeof v !== "function" || typeof prop !== "string") return v;
      return (...args: unknown[]) => {
        const top = _opDepth === 0;
        if (top) _pendingOp = [`${ns}.${prop}`, args];
        const before = _recorded.length;
        _opDepth++;
        let out: unknown;
        try { out = (v as (...a: unknown[]) => unknown)(...args); } finally { _opDepth--; }
        // Most adjustment/filter impls call rec() themselves. Transform-style
        // commands do not, so capture the successful top-level call here when
        // no inner step did it already.
        if (top && _recording && !_suspended && _recorded.length === before) {
          const op = _pendingOp;
          _recorded.push({ run: () => { (v as (...a: unknown[]) => unknown)(...args); }, op: op && isSerializableArgs(op[1]) ? op : undefined });
          _pendingOp = null;
        }
        return out;
      };
    },
  }) as T;
}
const savedActionMetas = (): ActionMeta[] => _savedActions.map((a) => ({
  id: a.id,
  name: a.name,
  stepCount: a.stepCount,
  favorite: a.favorite,
  createdAt: a.createdAt,
  lastPlayedAt: a.lastPlayedAt,
  set: a.set,
}));
// Run a thunk; if recording, capture it plus (when available) its serializable
// descriptor. The proxy wrapper stamps `_pendingOp` BEFORE invoking the impl, and
// each recorded impl calls rec() synchronously inside that call, so inside a
// proxied call `_opDepth > 0` and `_pendingOp` is THIS call's descriptor. A rec()
// reached at depth 0 without an explicit descriptor records a volatile step.
function rec(thunk: () => void, explicitOp?: ActionOp) {
  const captured = _opDepth > 0 ? _pendingOp : null;
  thunk();
  if (_recording && !_suspended) {
    const op = explicitOp ?? captured ?? undefined;
    _recorded.push({ run: thunk, op: op && isSerializableArgs(op[1]) ? op : undefined });
    if (!explicitOp && captured) _pendingOp = null; // consume — never reused by a later step
  }
}
// Rebuild a persisted/imported step's runner. Op resolution happens at PLAY time
// against the live visionOps() allowlist — the same trust path as runScript.
function opRunner(op: ActionOp): () => unknown {
  return () => {
    const fn = visionOps()[op[0]];
    if (!fn) return false;
    const args = resolvePlaybackLayerArg(op[0], decodeOpArgs(op[1]), store.state.activeLayerId, store.state.layers);
    return fn(...(args as never[]));
  };
}
function actionFromPortable(p: PortableAction): SavedAction {
  const disabled = new Set(p.disabled ?? []);
  const dialogs = new Set(p.dialogs ?? []);
  const steps: Step[] = p.steps.map((op, i) => ({ run: opRunner(op), op, ...(disabled.has(i) ? { enabled: false } : {}), ...(dialogs.has(i) ? { dialog: true } : {}) }));
  const meta = createActionMeta(_nextActionId++, p.name, steps.length, p.createdAt, p.set);
  return { ...meta, favorite: p.favorite, steps };
}
// Persistable = every step carries a descriptor (volatile steps can't survive
// restart). Only these are written to localStorage / exported.
const isActionPersistable = (a: SavedAction): boolean => a.steps.length > 0 && a.steps.every((s) => s.op != null);
function toPortable(a: SavedAction): PortableAction | null {
  if (!isActionPersistable(a)) return null;
  return {
    name: a.name, favorite: a.favorite, createdAt: a.createdAt, set: a.set,
    steps: a.steps.map((s) => s.op as ActionOp),
    disabled: a.steps.flatMap((s, i) => (s.enabled === false ? [i] : [])),
    dialogs: a.steps.flatMap((s, i) => (s.dialog === true ? [i] : [])),
  };
}
// Playback Options (Photoshop's flyout): accelerated by default. Depth guards
// conditional branches — an action whose branch plays back into it would loop.
let _playbackMode: PlaybackMode = "accelerated";
let _allowToolRecording = false;
let _playDepth = 0;
/** Command-line and droplet playback. Checked before any native dialog import,
 *  so a hidden window cannot hang on a confirm nobody can answer. */
let _unattended = false;
// The document/layer facts Insert Conditional tests, flattened off the store.
function actionConditionContext(): ActionConditionContext {
  const st = store.state;
  const layer = st.layers.find((l) => l.id === st.activeLayerId);
  return {
    documentOpen: st.documents.length > 0,
    width: st.doc.width,
    height: st.doc.height,
    mode: st.mode,
    dirty: st.documents.find((d) => d.id === st.activeDocId)?.dirty === true,
    hasSelection: st.selectionActive,
    layerVisible: layer?.visible === true,
    layerLocked: layer?.locked === true,
    layerHasMask: layer?.hasMask === true,
    layerKind: layer ? layer.kind : -1,
  };
}
// Shared tail of the Insert Stop / Menu Item / Conditional commands.
// ponytail: append-only — reposition with moveStep, no insert-at-selection.
function appendActionStep(id: number, step: Step) {
  _savedActions = _savedActions.map((a) => (a.id === id
    ? { ...a, steps: [...a.steps, step], stepCount: a.steps.length + 1 }
    : a));
  persistActions();
  store.bump();
}
function persistActions(): boolean {
  const portable = _savedActions.map(toPortable).filter((p): p is PortableAction => p !== null);
  return store.persistAuthoredContent("mv.actions", serializeActionsFile(portable), "actions");
}
function loadPersistedActions() {
  try {
    const { actions: loaded } = parseActionsFile(localStorage.getItem("mv.actions"), new Set(Object.keys(visionOps())));
    for (const p of loaded) _savedActions.push(actionFromPortable(p));
  } catch (e) { console.warn("Failed to load persisted actions:", e); }
}
/** OK/Cancel pause for Stop and modal steps. On the desktop, tauri-plugin-dialog
 *  replaces window.confirm with an async call to a command it never registers,
 *  so a bare confirm() there returns a Promise and playback never paused (#480). */
async function confirmPlaybackPause(message: string, alertOnUnattended = false): Promise<boolean> {
  if (_unattended) {
    // A continuable Stop is a failure nobody saw, so it is collected. A modal
    // "Apply this step?" just continues — alerting would fail every modal step.
    if (alertOnUnattended && typeof alert === "function") alert(message);
    return true;
  }
  if (isTauri()) {
    try {
      const { confirm: ask } = await import("@tauri-apps/plugin-dialog");
      return await ask(message, { title: "Actions" });
    } catch { /* fall through to web confirm */ }
  }
  return typeof confirm === "function" ? confirm(message) : true;
}
/** Actions panel ▸ Insert Stop. The desktop webview's prompt/confirm never
 *  present a dialog (#542), so that path uses the same native ask playback does. */
export async function authorActionStop(): Promise<{ message: string; allowContinue: boolean } | null> {
  if (isTauri()) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const allowContinue = await ask(
      "Allow Continue?\n\nOK — playback can resume after the stop.\nCancel — playback always halts at the stop.",
      { title: "Insert Stop" },
    );
    return { message: "Stop", allowContinue };
  }
  if (typeof prompt !== "function") return null;
  const entered = prompt("Stop message shown during playback:");
  if (entered === null) return null;
  const allowContinue = typeof confirm === "function"
    && confirm("Allow Continue?\n\nOK — playback can resume after the stop.\nCancel — playback always halts at the stop.");
  return { message: entered, allowContinue };
}
/** Play a list of recorded steps under the current Playback Options: per-step
 *  enable flags, Stop steps, modal toggles, Insert Conditional branches and
 *  Step By Step.
 *
 *  Shared by the two Play buttons. The Actions panel's toolbar Play replayed the
 *  live recording through a bare `_recorded.forEach(s => s.run())`, so every one
 *  of those was silently ignored there while Playback Options claimed to be a
 *  panel-wide setting (#499). */
async function runActionSteps(steps: readonly Step[], fromStep = 0, skipOps?: ReadonlySet<string>): Promise<boolean> {
  for (const raw of steps.slice(Math.max(0, fromStep))) {
    if (raw.enabled === false) continue;
    // Batch's Override Action "Save As" Commands: its own output replaces them.
    if (raw.op && skipOps?.has(raw.op[0])) continue;
    // Step By Step is the modal toggle applied to the whole action; the
    // pseudo-ops pause on their own terms, so they stay untouched.
    const s = _playbackMode === "stepByStep" && raw.op?.[0] !== STOP_OP && raw.op?.[0] !== IF_OP
      ? { ...raw, dialog: true } : raw;
    // ponytail: Stop + modal pauses ride native confirm/alert with an args
    // preview — upgrade path: reopen the op's real dialog seeded with the
    // recorded args if authoring needs editable mid-play values.
    if (s.op?.[0] === STOP_OP) {
      const { message, allowContinue } = parseStopArgs(s.op[1]);
      if (!allowContinue) { if (typeof alert === "function") alert(message); return false; }
      if (!(await confirmPlaybackPause(`${message}\n\nContinue playing this action?`, true))) return false;
      continue;
    }
    // Insert Conditional: test the document/active layer, then play the named
    // branch action. An unknown or missing branch is simply a no-op step.
    if (s.op?.[0] === IF_OP) {
      const branch = ifBranchTarget(s.op[1], actionConditionContext());
      const target = branch
        ? _savedActions.find((a) => a.name.trim().toLowerCase() === branch.toLowerCase())
        : undefined;
      if (target && await actions.playNamed(target.id, 0, skipOps) === false) return false;
      continue;
    }
    if (s.dialog && !(await confirmPlaybackPause(
      `${stepLabel(s.op?.[0] ?? null)}\n${s.op ? stepArgsPreview(s.op[1]) : ""}\n\nApply this step? Cancel stops playback.`))) return false;
    if (await s.run() === false) return false;
  }
  return true;
}

export const actions = {
  start() { _recording = true; _recorded.length = 0; store.bump(); },
  stop() { _recording = false; store.bump(); },
  isRecording: () => _recording,
  count: () => _recorded.length,
  /** Checkpoint modal preview capture so Cancel can erase every transient step. */
  mark(): ActionRecorderMark {
    return {
      steps: _recorded.slice(),
      pendingOp: _pendingOp,
      lastApplyOp: _lastApplyOp,
      suspended: _suspended,
    };
  },
  rollback(mark: ActionRecorderMark) { restoreActionRecorder(mark); },
  /** Replace everything recorded since `mark` with the one accepted operation. */
  commit(mark: ActionRecorderMark, thunk: () => void, explicitOp?: ActionOp | null) {
    const accepted = explicitOp === undefined ? _lastApplyOp : explicitOp;
    restoreActionRecorder(mark);
    actions.record(thunk, accepted);
  },
  /** The Actions panel toolbar's Play: replay what is being recorded now, under
   *  the same Playback Options a saved action gets. */
  async play(skipOps?: ReadonlySet<string>): Promise<boolean> {
    if (_playDepth >= MAX_ACTION_PLAY_DEPTH) return false;
    _playDepth++;
    try { return await runActionSteps(_recorded, 0, skipOps); } finally { _playDepth--; }
  },
  list(): ActionMeta[] { return savedActionMetas(); },
  filter(query = "", favoritesOnly = false): ActionMeta[] { return filterActionMetas(savedActionMetas(), query, favoritesOnly); },
  isPersistable(id: number): boolean { const a = _savedActions.find((x) => x.id === id); return a ? isActionPersistable(a) : false; },
  save(name?: string): number {
    if (!_recorded.length) return 0;
    const requested = name?.trim() || defaultActionName(savedActionMetas());
    const taken = savedActionMetas().some((a) => a.name.trim().toLowerCase() === requested.toLowerCase());
    const unique = taken ? defaultActionName(savedActionMetas(), requested) : requested;
    const meta = createActionMeta(_nextActionId++, unique, _recorded.length);
    _savedActions = [..._savedActions, { ...meta, steps: _recorded.slice() }];
    persistActions();
    store.bump();
    return meta.id;
  },
  rename(id: number, name: string) {
    const metas = renameActionMeta(savedActionMetas(), id, name);
    _savedActions = _savedActions.map((a) => ({ ...a, ...(metas.find((m) => m.id === a.id) ?? a) }));
    persistActions();
    store.bump();
  },
  delete(id: number) {
    _savedActions = _savedActions.filter((a) => a.id !== id);
    persistActions();
    store.bump();
  },
  toggleFavorite(id: number) {
    const metas = toggleActionFavorite(savedActionMetas(), id);
    _savedActions = _savedActions.map((a) => ({ ...a, ...(metas.find((m) => m.id === a.id) ?? a) }));
    persistActions();
    store.bump();
  },
  // Play a saved action, honoring per-step enable flags, Stop steps, modal
  // toggles, conditional branches and the Step By Step playback mode.
  // `fromStep` is Photoshop's Play From Here: skip everything before that index.
  /** Resolve a reference that OUTLIVED the session that wrote it — a droplet on
   *  disk, a Script Events binding in localStorage.
   *
   *  Runtime ids are positional: `_nextActionId` restarts at 1 on every module
   *  load and `actionFromPortable` hands them out in persisted-array order, so a
   *  stored id survives exactly until the list is edited. Delete an earlier
   *  action and every later id shifts by one — the reference then names nothing,
   *  or worse, a DIFFERENT action. An id whose action still has the stored name
   *  wins, so two actions that share a name stay distinct. A stale id falls
   *  through to a name that only one action has. */
  resolve(ref: { id?: number; name?: string }): number | null {
    // The id wins when it still names that action, including when an older
    // action shares the name (#551). A stale id (the action was deleted and
    // the slot reused under a different name) falls through to a unique name.
    const name = ref.name?.trim().toLowerCase();
    if (ref.id !== undefined) {
      const byId = _savedActions.find((a) => a.id === ref.id);
      if (byId && (!name || byId.name.trim().toLowerCase() === name)) return byId.id;
    }
    if (name) {
      const matches = _savedActions.filter((a) => a.name.trim().toLowerCase() === name);
      if (matches.length === 1) return matches[0].id;
    }
    return null;
  },
  /** Returns false when the id names no action — unattended callers (droplets,
   *  Script Events, MCP) need to report that instead of counting a no-op as a
   *  successful run. */
  async playNamed(id: number, fromStep = 0, skipOps?: ReadonlySet<string>): Promise<boolean> {
    const found = _savedActions.find((a) => a.id === id);
    if (!found || _playDepth >= MAX_ACTION_PLAY_DEPTH) return false;
    _playDepth++;
    let finished = false;
    try {
      finished = await runActionSteps(found.steps, fromStep, skipOps);
    } finally { _playDepth--; }
    if (!finished) return false;
    const metas = markActionPlayed(savedActionMetas(), id);
    _savedActions = _savedActions.map((a) => ({ ...a, ...(metas.find((m) => m.id === a.id) ?? a) }));
    persistActions();
    store.bump();
    return true;
  },
  clearNamed() { _savedActions = []; persistActions(); store.bump(); },
  // ── Step tree (sets → actions → steps): list, toggle, reorder, delete ──────
  getSteps(id: number): ActionStepInfo[] {
    const a = _savedActions.find((x) => x.id === id);
    return a ? a.steps.map((s, i) => ({
      index: i,
      label: stepLabel(s.op?.[0] ?? null),
      args: s.op ? stepArgsPreview(s.op[1]) : "",
      enabled: s.enabled !== false,
      dialog: s.dialog === true,
      volatile: s.op == null,
    })) : [];
  },
  setStepEnabled(id: number, index: number, on: boolean) {
    _savedActions = _savedActions.map((a) => (a.id === id && a.steps[index]
      ? { ...a, steps: a.steps.map((s, i) => (i === index ? { ...s, enabled: on } : s)) }
      : a));
    persistActions();
    store.bump();
  },
  // Photoshop's per-step modal toggle: pause and confirm the step on playback.
  setStepDialog(id: number, index: number, on: boolean) {
    _savedActions = _savedActions.map((a) => (a.id === id && a.steps[index]
      ? { ...a, steps: a.steps.map((s, i) => (i === index ? { ...s, dialog: on } : s)) }
      : a));
    persistActions();
    store.bump();
  },
  // Photoshop's Insert Stop: a step that pauses playback with a message.
  insertStop(id: number, message: string, allowContinue: boolean) {
    const op: ActionOp = [STOP_OP, [message.trim() || "Stop", allowContinue]];
    appendActionStep(id, { run: () => {}, op });
  },
  // Photoshop's Insert Menu Item: add a step for a command that was never
  // recorded, picked from the same visionOps allowlist playback resolves
  // against. Rejects unknown paths and args a saved action couldn't hold.
  insertMenuItem(id: number, path: string, args: unknown[] = []): boolean {
    if (!actions.menuItemPaths().includes(path) || args.length > 0 || !isSerializableArgs(args)) return false;
    const op: ActionOp = [path, args];
    appendActionStep(id, { run: opRunner(op), op });
    return true;
  },
  /** Every command Insert Menu Item accepts — what its picker lists. */
  menuItemPaths: (): string[] => ZERO_ARG_MENU_PATHS.filter((path) => Object.prototype.hasOwnProperty.call(visionOps(), path)).sort(),
  // Photoshop's Insert Conditional: branch on a document/layer test into another
  // saved action, named so the branch survives export/import.
  insertConditional(id: number, condition: string, thenAction: string, elseAction = ""): boolean {
    if (!ACTION_CONDITIONS.includes(condition as ActionCondition)) return false;
    const op: ActionOp = [IF_OP, [condition, thenAction.trim(), elseAction.trim()]];
    appendActionStep(id, { run: () => {}, op });
    return true;
  },
  // Photoshop's Allow Tool Recording. Off, a pointer gesture records nothing,
  // exactly as before; on, the canvas hands finished gestures to recordTool.
  allowToolRecording: (): boolean => _allowToolRecording,
  setAllowToolRecording(on: boolean) {
    _allowToolRecording = on;
    // Capturing costs a point-array per stroke, so only subscribe while on.
    engine.onStrokeRecorded = on
      ? (op) => actions.recordTool(["paintStroke", [Float32Array.from(op.brush), Float32Array.from(op.pts)]])
      : null;
    store.bump();
  },
  /** A pointer gesture that has ALREADY happened, recorded as a replayable
   *  step — so unlike `record`, the runner is the one playback will use. */
  recordTool(op: ActionOp) {
    if (!_allowToolRecording || !_recording || _suspended || !isSerializableArgs(op[1])) return;
    _recorded.push({ run: opRunner(op), op });
  },
  // Playback Options. See PLAYBACK_MODES for why "Pause For N Seconds" is absent.
  playbackMode: (): PlaybackMode => _playbackMode,
  setPlaybackMode(mode: PlaybackMode) {
    _playbackMode = PLAYBACK_MODES.includes(mode) ? mode : "accelerated";
    store.bump();
  },
  // ponytail: reorder is index-pair moves (↑/↓ buttons), not drag-and-drop —
  // add DnD in the panel if step lists grow past what buttons comfortably serve.
  moveStep(id: number, from: number, to: number) {
    _savedActions = _savedActions.map((a) => (a.id === id ? { ...a, steps: moveItem(a.steps, from, to) } : a));
    persistActions();
    store.bump();
  },
  deleteStep(id: number, index: number) {
    _savedActions = _savedActions.map((a) => (a.id === id && a.steps[index]
      ? { ...a, steps: a.steps.filter((_, i) => i !== index), stepCount: a.steps.length - 1 }
      : a));
    persistActions();
    store.bump();
  },
  // Move an action to a (possibly new) set — sets exist as soon as named.
  setActionSet(id: number, set: string) {
    const clean = set.trim() || DEFAULT_ACTION_SET;
    _savedActions = _savedActions.map((a) => (a.id === id ? { ...a, set: clean } : a));
    persistActions();
    store.bump();
  },
  // Export every persistable action as a versioned .mvactions JSON string.
  exportJson(): string {
    const portable = _savedActions.map(toPortable).filter((p): p is PortableAction => p !== null);
    return serializeActionsFile(portable);
  },
  // Photoshop's Save Actions: the given actions as ONE Adobe .atn set. Steps
  // Photoshop has no event for are written as Stops naming them, so the pack
  // loads with the gap visible rather than replaying something else.
  exportAtn(ids: readonly number[], setName?: string): Uint8Array {
    const chosen = _savedActions.filter((a) => ids.includes(a.id));
    const portable = chosen.map(toPortable).filter((p): p is PortableAction => p !== null);
    return serializeAtn(portable, setName ?? portable[0]?.set);
  },
  // Merge actions from an .mvactions payload, validating every op against the
  // visionOps() allowlist (whole-action rejection). Duplicate names auto-renamed.
  importJson(json: string): { imported: number; rejected: { name: string; reason: string }[] } {
    const { actions: incoming, rejected } = parseActionsFile(json, new Set(Object.keys(visionOps())));
    for (const p of incoming) {
      const existing = new Set(savedActionMetas().map((m) => m.name.trim().toLowerCase()));
      const name = existing.has(p.name.trim().toLowerCase()) ? defaultActionName(savedActionMetas(), p.name) : p.name;
      _savedActions.push(actionFromPortable({ ...p, name }));
    }
    if (incoming.length) persistActions();
    store.bump();
    return { imported: incoming.length, rejected };
  },
  // Preview dialogs suspend capture while their sliders live-apply (Photoshop
  // records one step per dialog COMMIT, not one per preview tick) and record
  // exactly the final OK'd thunk. suspend(true) CLEARS any stale descriptor
  // before the apply runs; suspend(false) SNAPSHOTS what this apply produced so a
  // non-proxied apply (perspectiveWarp/…) leaves _lastApplyOp null →
  // volatile step, never a stale descriptor from an earlier proxied call.
  suspend(on: boolean) {
    if (on) { _pendingOp = null; _lastApplyOp = null; }
    else { _lastApplyOp = _pendingOp; _pendingOp = null; }
    _suspended = on;
  },
  record(thunk: () => void, explicitOp?: ActionOp | null) {
    if (!_recording) return;
    const candidate = explicitOp === null ? null : explicitOp ?? _lastApplyOp;
    const op = candidate && isSerializableArgs(candidate[1]) ? candidate : undefined;
    _lastApplyOp = null; // consume
    _recorded.push({ run: thunk, op });
  },
};

// ── Recordable command surface beyond the proxied namespaces ──────────────
// Photoshop records nearly every command — layer, selection, type, save/export
// — not just filter/adjustment dialogs. `recordedCall` wraps a plain function
// or store method so a TOP-LEVEL call records one persistable [path, args]
// step; nested calls (from a proxied impl or another recorded command) stay
// unrecorded because the outer step already replays them. `live` marks a command
// a slider/keystroke stream drives (opacity drags, per-keystroke text.apply,
// layer-effect sliders): `key` is how many leading args identify ONE editing
// stream, so consecutive calls sharing that prefix collapse to the settled
// value; `args` caps what the recorded step keeps, dropping the trailing `live`
// preview flag so a replayed step commits instead of scheduling a preview frame.
type LiveShape = { key: number; args?: number };
function recordedCall<A extends unknown[], R>(path: string, fn: (...args: A) => R, live?: LiveShape): (...args: A) => R {
  return (...args: A): R => {
    if (_opDepth > 0) return fn(...args);
    _opDepth++;
    try {
      const kept = live?.args == null ? args : args.slice(0, live.args);
      const op: ActionOp = [path, retargetRecordedLayerArg(path, kept, store.state.activeLayerId, store.state.layers)];
      if (live && _recording && !_suspended) {
        const lastOp = _recorded[_recorded.length - 1]?.op;
        if (lastOp?.[0] === path && op[1].slice(0, live.key).every((v, i) => v === lastOp[1][i])) _recorded.pop();
      }
      let out!: R;
      rec(() => { out = fn(...args); }, op);
      return out;
    } finally {
      _opDepth--;
    }
  };
}

// Store methods recorded as action steps — Photoshop's layer / selection /
// clipboard / document command coverage. Wrapping the live instance methods
// instruments every caller (menus, panels, shortcuts, scripts, MCP) without a
// per-call-site rec(); each op is registered in visionOps() so recorded
// actions persist, export and replay through the one allowlist.
// Pointer-driven tool commits (brush strokes, lasso and marquee drags) live in
// CanvasView/EngineClient, so they are not store methods: they reach the
// recorder through actions.recordTool, gated by Allow Tool Recording (#471).
const RECORDED_STORE_OPS = [
  // layer lifecycle
  "newDocument", "addLayer", "deleteLayer", "duplicateLayer", "layerViaCopy", "layerViaCut",
  // layer properties
  "renameLayer", "setLayerVisible", "setLayerOpacity", "setLayerBlend", "setLayerLocked", "setFillOpacity",
  // arrange / target
  "moveLayer", "moveLayerInTree", "arrangeLayer", "reverseLayers", "selectLayer", "selectAdjacentLayer",
  // group / merge
  "createGroup", "groupSelectedLayers", "ungroup", "mergeDown", "mergeVisible", "flatten",
  // masks + clipping
  "addLayerMask", "addLayerMaskHidden", "addLayerMaskRevealSelection", "addLayerMaskHideSelection",
  "applyLayerMask", "deleteLayerMask", "maskFromTransparency", "setLayerMaskEnabled", "toggleLayerMaskLinked",
  "setClipping", "toggleClipping",
  // fill / adjustment layers
  "addSolidFillLayer", "addGradientFillLayer", "addPatternFillLayer", "setFillParams", "replacePatternFill",
  "addAdjustmentLayer", "setAdjustmentParams",
  // layer styles + advanced blending (Blending Options dialog, Styles panel,
  // Layer ▸ Layer Style ▸ …) — Photoshop's Set Layer Styles / Effects steps
  "setEffect", "clearEffect", "clearAllEffects", "toggleEffectsVisible",
  "setBlendIf", "setKnockout", "setTransparencyShapes", "setBlendInteriorGroup", "setBlendClippedGroup",
  "setFillOpacityInTransaction", "copyLayerStyle", "pasteLayerStyle", "clearLayerStyle",
  "createLayersFromStyle", "rasterizeLayerStyle", "applyLayerStyleState", "scaleEffects", "setGlobalLight",
  // ponytail: the Styles panel records the preset INDEX, so replay follows the
  // playing machine's preset list — embed the style payload in the step if
  // sharing style macros across machines ever matters.
  "applyStylePreset",
  // selection commands
  "selectAll", "deselect", "invertSelection", "reselect", "selectSky", "expandSelection", "contractSelection",
  "featherSelection", "borderSelection", "smoothSelection", "growSelection", "similarSelection",
  "transformSelection", "selectObject", "selectFocusArea", "colorRangeSelect", "makeSelectionFromPath",
  "magneticLassoApply", "saveSelection", "loadSelection", "deleteSavedSelection",
  // pixel commands
  "fillContents", "strokeSelection", "fillPath", "strokePath", "spotHeal", "defringe", "removeMatte",
  "replaceColor", "fadeLast", "applyImage", "calculations", "contentAwareScale",
  // clipboard (paste replays from the live clipboard, like Photoshop)
  "cut", "copy", "copyMerged", "paste", "pasteInPlace", "pasteInto",
  // Per-INSTANCE effect ops. Layer effects became a multiset (stacked strokes,
  // layered shadows) but only the whole-type setters above were recordable, so
  // adjusting a stacked drop shadow while recording produced no step at all and
  // the action replayed without it.
  "setEffectAt", "removeEffectAt", "moveEffectInstance",
  // Image ▸ Mode — Photoshop records mode and bit-depth conversions, and a
  // "convert to grayscale" macro is one of the most ordinary actions there is.
  "convertGrayscale", "convertIndexed", "convertBitmap", "setColorMode", "setDepth", "conditionalModeChange",
  // Properties panel ▸ mask Density / Feather
  "setLayerMaskDensity", "setLayerMaskFeather",
  // Layer ▸ Align / Distribute / Link
  "alignLayer", "distributeLayers", "linkLayers",
] as const satisfies readonly (keyof Store)[];
// Live-drag setters: keep only the settled value of a slider drag as one step.
// setEffect needs a two-arg key (layer + effect) — keyed on the layer alone,
// enabling a second effect on the same layer would swallow the first one's step.
const LIVE_STORE_OPS: Record<string, LiveShape> = {
  setLayerOpacity: { key: 1 },
  setFillOpacity: { key: 1, args: 2 },
  setFillOpacityInTransaction: { key: 1, args: 2 },
  setFillParams: { key: 1 },
  setAdjustmentParams: { key: 1 },
  setEffect: { key: 2, args: 3 },
  // An instance is identified by layer + effect + INDEX, so the key is three
  // args: keyed on layer+effect alone, dragging the second drop shadow's slider
  // would swallow the first shadow's step.
  setEffectAt: { key: 3, args: 4 },
  setBlendIf: { key: 1, args: 2 },
  setLayerMaskDensity: { key: 1, args: 2 },
  setLayerMaskFeather: { key: 1, args: 2 },
};
for (const name of RECORDED_STORE_OPS) {
  const orig = (store[name] as (...args: unknown[]) => unknown).bind(store);
  (store as unknown as Record<string, unknown>)[name] = recordedCall(`store.${name}`, orig, LIVE_STORE_OPS[name]);
}
// A dialog that opens a history transaction and then DROPS it (Cancel, or OK
// with nothing changed) restores its snapshot through the same recorded store
// methods. Photoshop never records a canceled dialog, so unwind whatever the
// transaction recorded instead of adding a suspend() to every such call site.
let _txMark: ActionRecorderMark | null = null;
{
  const begin = store.beginHistory.bind(store);
  const commit = store.commitHistory.bind(store);
  const drop = store.dropHistory.bind(store);
  store.beginHistory = (label: string) => {
    const mark = actions.mark();
    const opened = begin(label);
    if (opened) _txMark = mark;
    return opened;
  };
  store.commitHistory = () => {
    const mark = _txMark;
    _txMark = null;
    const committed = commit();
    if (!committed && mark) actions.rollback(mark);
    return committed;
  };
  store.dropHistory = () => {
    const mark = _txMark;
    _txMark = null;
    const dropped = drop();
    if (mark) actions.rollback(mark);
    return dropped;
  };
}

// ── Adjustments ────────────────────────────────────────────────
const adjImpl = {
  brightnessContrast: (b: number, c: number) => rec(() => { E().adjust_brightness_contrast(b, c); engine.commit(); }),
  levels: (ib: number, iw: number, gamma: number, ob: number, ow: number, ch: number) =>
    rec(() => { E().adjust_levels(ib, iw, gamma, ob, ow, ch); engine.commit(); }),
  // Levels with a Channel selector: composite + per-channel applied together (each arg [ib,iw,gamma,ob,ow] in 0..1).
  levelsMulti: (comp: Float32Array, red: Float32Array, grn: Float32Array, blu: Float32Array) =>
    rec(() => { E().adjust_levels_multi(comp, red, grn, blu); engine.commit(); }),
  curves: (master: Uint8Array, r: Uint8Array, g: Uint8Array, b: Uint8Array) =>
    rec(() => { E().adjust_curves(master, r, g, b); engine.commit(); }),
  hueSaturation: (h: number, s: number, l: number) => rec(() => { E().adjust_hue_saturation(h, s, l); engine.commit(); }),
  hueSaturationParams: (params: Float32Array) => rec(() => { E().adjust_hue_saturation_params(params); engine.commit(); }),
  vibrance: (v: number, s: number) => rec(() => { E().adjust_vibrance(v, s); engine.commit(); }),
  invert: () => rec(() => { E().adjust_invert(); engine.commit(); }),
  desaturate: () => rec(() => { E().adjust_desaturate(); engine.commit(); }),
  // Image ▸ Auto Tone (per-channel) / Auto Contrast (pooled) — one-click stretch.
  autoTone: () => rec(() => { E().auto_tone(); engine.commit(); }),
  autoContrast: () => rec(() => { E().auto_contrast(); engine.commit(); }),
  autoColor: () => rec(() => { E().auto_color(); engine.commit(); }),
  blackWhite: (rw: number, gw: number, bw: number) => rec(() => { E().adjust_black_white(rw, gw, bw); engine.commit(); }),
  blackWhiteParams: (params: Float32Array) => rec(() => { E().adjust_black_white_params(params); engine.commit(); }),
  threshold: (l: number) => rec(() => { E().adjust_threshold(l); engine.commit(); }),
  posterize: (n: number) => rec(() => { E().adjust_posterize(n); engine.commit(); }),
  exposure: (e: number, off: number, g: number) => rec(() => { E().adjust_exposure(e, off, g); engine.commit(); }),
  colorBalance: (s: Float32Array, m: Float32Array, h: Float32Array, preserve: boolean) =>
    rec(() => { E().adjust_color_balance(s, m, h, preserve); engine.commit(); }),
  photoFilter: (r: number, g: number, b: number, density: number, preserve: boolean) =>
    rec(() => { E().adjust_photo_filter(r, g, b, density, preserve); engine.commit(); }),
  channelMixer: (m: Float32Array) => rec(() => { E().adjust_channel_mixer(m); engine.commit(); }),
  gradientMap: (lut: Uint8Array) => rec(() => { E().adjust_gradient_map(lut); engine.commit(); }),
  /** Show More Options adds a per-band Radius (px) and the Black/White Clip
   *  fractions; the smart-filter param order is the engine's (fid 101). */
  shadowsHighlights: (sa: number, sw: number, ha: number, hw: number, color = 0, midtone = 0, sr = 0, hr = 0, blackClip = 0, whiteClip = 0) =>
    applyFilter(101, [sa, sw, ha, hw, color, midtone, sr, hr, blackClip, whiteClip], () => { E().adjust_shadows_highlights(sa, sw, ha, hw, color, midtone, sr, hr, blackClip, whiteClip); engine.commit(); }),
  selectiveColor: (corr: Float32Array, relative: boolean) =>
    rec(() => { E().adjust_selective_color(corr, relative); engine.commit(); }),
  equalize: () => rec(() => { E().adjust_equalize(); engine.commit(); }),
  hdrToning: (radius: number, detail: number, gamma: number, exposure: number) =>
    rec(() => { E().hdr_toning(radius, detail, gamma, exposure); engine.commit(); }),
  /** Local Adaptation: the full 9-slider panel plus an optional 256-entry toning
   *  curve. Recorded like every other adjustment so it replays from an action
   *  rather than only inside the dialog that ran it. */
  hdrTonePro: (p: Float32Array) =>
    rec(() => { E().hdr_toning_pro(p); engine.commit(); }),
  matchColor: (srcId: number, lum: number, intensity: number, fade: number, neutralize: boolean) =>
    rec(() => { E().match_color(srcId, lum, intensity, fade, neutralize); engine.commit(); }),
  // A bare number is a preset id from an action recorded before #441 packed params.
  colorLookup: (params: Float32Array | number) =>
    rec(() => { E().adjust_color_lookup(typeof params === "number" ? new Float32Array([params]) : params); engine.commit(); }),
  cameraRaw: (temp: number, exposure: number, contrast: number, highlights: number, shadows: number, clarity: number, dehaze: number, vibrance: number, saturation: number, grain: number) =>
    rec(() => { E().camera_raw(temp, exposure, contrast, highlights, shadows, clarity, dehaze, vibrance, saturation, grain); engine.commit(); }),
  // Camera Raw develop workspace apply. On a smart object (kind 7) the recipe
  // rides fid-17 non-destructively: append (smartIndex undefined) or update in
  // place (smartIndex = the existing entry). Otherwise it bakes as ONE history
  // step via the develop orchestrator. `smart_update_filter` is a safe no-op on
  // an out-of-range index, so replaying a recorded update thunk degrades cleanly.
  cameraRawDevelop: (p: Float32Array, smartIndex?: number) =>
    rec(() => {
      const active = store.state.activeLayerId;
      if (E().layer_kind(active) === LAYER_KIND.smartObject) {
        if (smartIndex === undefined) E().smart_add_filter(active, 17, p);
        else E().smart_update_filter(active, smartIndex, p);
        engine.commit();
      } else {
        E().camera_raw_develop(p);
        engine.commit();
      }
    }),
};
export const adj = withOpCapture("adj", adjImpl);

// ── Filters ────────────────────────────────────────────────────
// When the active layer is a smart object (kind 7), filters are added to its
// non-destructive smart-filter stack instead of being baked into the pixels.
// `smartId` must match the fid map in `apply_smart_filter`
// (packages/engine/src/raster/mod.rs); colours and random seeds are baked into
// `params` at call time so stack re-renders replay deterministically.
function applyFilter(smartId: number, params: number[], destructive: () => void, explicitOp?: ActionOp) {
  rec(() => {
    const active = store.state.activeLayerId;
    if (E().layer_kind(active) === LAYER_KIND.smartObject) {
      E().smart_add_filter(active, smartId, new Float32Array(params));
      engine.commit();
    } else {
      destructive();
    }
  }, explicitOp);
}

// The pin workspaces live outside the proxied `fil` namespace because one
// dialog can compose several pin kinds into one action. They still use the
// same smart-object switch as every ordinary Filter-menu command.
export function applyGalleryBlurPins(kind: number, radius: number, pins: Float32Array, lightBokeh = 0, bokehColor = 0) {
  applyFilter(114, [kind, radius, lightBokeh, bokehColor, ...pins], () => {
    E().filter_gallery_blur_pins(kind, radius, pins, lightBokeh, bokehColor);
    engine.commit();
  });
}

export function applySpinBlurPins(angle: number, strobeFlashes: number, pins: Float32Array) {
  applyFilter(115, [angle, strobeFlashes, ...pins], () => {
    E().filter_spin_blur_pins(angle, strobeFlashes, pins);
    engine.commit();
  });
}

type BlurEngineExports = {
  filter_path_blur_paths?: (
    angle: number, speed: number, taper: number, centered: boolean, rearSync: boolean, paths: Float32Array,
  ) => void;
  filter_add_noise_seeded(amount: number, monochromatic: boolean, gaussian: boolean, seed: number): void;
};
export type BlurCommandStep =
  | { op: "gallery"; kind: 0 | 1 | 2 | 3; radius: number; pins: Float32Array; bokeh: number; bokehColor: number }
  | { op: "path"; angle: number; speed: number; taper: number; centered: boolean }
  | { op: "spin"; angle: number; strobe: number; pins: Float32Array }
  | { op: "noise"; amount: number; mono: boolean; gaussian: boolean; seed: number };

/** Apply one serialized Blur Gallery recipe. The recipe, including its noise
 * seed and drawn paths, is the exact payload Actions persist and replay. */
export function runBlurSteps(steps: BlurCommandStep[], paths: Float32Array, rearSync: boolean): number {
  const e = E();
  const smartObject = e.layer_kind(store.state.activeLayerId) === LAYER_KIND.smartObject;
  if (smartObject && paths.length > 0 && steps.some((step) => step.op === "path")) return 0;
  const before = e.undo_pushes();
  for (const step of steps) {
    if (step.op === "gallery") applyGalleryBlurPins(step.kind, step.radius, step.pins, step.bokeh, step.bokehColor);
    else if (step.op === "path") {
      if (smartObject) fil.pathBlur(step.angle, step.speed, step.taper, step.centered);
      else {
        const drawn = (e as typeof e & BlurEngineExports).filter_path_blur_paths;
        if (drawn) drawn.call(e, step.angle, step.speed, step.taper, step.centered, rearSync, paths);
        else e.filter_path_blur(step.angle, step.speed, step.taper, step.centered);
      }
    } else if (step.op === "spin") applySpinBlurPins(step.angle, step.strobe, step.pins);
    else {
      const seed = (step.seed >>> 0) & 0xff_ffff;
      if (smartObject) fil.noise(step.amount, step.mono, step.gaussian, seed);
      else (e as typeof e & BlurEngineExports)
        .filter_add_noise_seeded(step.amount, step.mono, step.gaussian, seed);
    }
  }
  if (steps.length > 0) engine.commit();
  return Math.max(0, Math.round(e.undo_pushes() - before));
}

/** Commit a composed Blur Gallery pass as one history state. `transactionOpen`
 * lets the dialog reuse its preview transaction; action replay starts a fresh one. */
export function commitBlurSteps(
  steps: BlurCommandStep[], paths: Float32Array, rearSync: boolean, transactionOpen = false,
): boolean {
  if (steps.length === 0) return false;
  const e = E() as HistoryTransactionEngine;
  if (!transactionOpen && !e.begin_history_transaction()) return false;
  try {
    const beforeLabel = e.undo_pushes();
    e.push_history("Blur Gallery");
    if (e.undo_pushes() > beforeLabel) {
      actions.suspend(true);
      engine.syncSuspended = true;
      let applied = 0;
      try { applied = runBlurSteps(steps, paths, rearSync); }
      finally { actions.suspend(false); engine.syncSuspended = false; }
      for (let i = 0; i < applied; i++) e.drop_last_undo();
      if (applied === 0) e.drop_last_undo();
    }
    const committed = e.commit_history_transaction();
    if (engine.engine === e) {
      if (committed) engine.commit();
      else engine.refreshFromEngine();
    }
    return committed;
  } catch (error) {
    if (e.cancel_history_transaction() && engine.engine === e) engine.refreshFromEngine();
    throw error;
  } finally {
    engine.syncSuspended = false;
  }
}

const filImpl = {
  gaussian: (r: number) => applyFilter(0, [r], () => { E().filter_gaussian_blur(r); engine.commit(); }),
  box: (r: number) => applyFilter(1, [r], () => { E().filter_box_blur(r); engine.commit(); }),
  // Filter ▸ Blur ▸ Average — fill image/selection with its mean colour.
  average: () => applyFilter(86, [], () => { E().filter_average(); engine.commit(); }),
  sharpen: (a: number) => applyFilter(2, [a], () => { E().filter_sharpen(a); engine.commit(); }),
  // Filter ▸ Sharpen ▸ Sharpen Edges — one-click, edge-gated sharpen.
  sharpenEdges: () => applyFilter(87, [], () => { E().filter_sharpen_edges(); engine.commit(); }),
  unsharp: (r: number, a: number, t: number) => applyFilter(3, [r, a, t], () => { E().filter_unsharp_mask(r, a, t); engine.commit(); }),
  // One seed drives both paths: smart params and destructive pixels now render
  // the same noise field, and an action replays it rather than drawing again.
  noise: (a: number, mono: boolean, gaussian = false, inputSeed?: number) => {
    const seed = (inputSeed === undefined
      ? Math.floor(Math.random() * 0x100_0000)
      : inputSeed >>> 0) & 0xff_ffff;
    applyFilter(11, [a, mono ? 1 : 0, seed, gaussian ? 1 : 0], () => {
      (E() as typeof engine.e & BlurEngineExports).filter_add_noise_seeded(a, mono, gaussian, seed);
      engine.commit();
    }, ["fil.noise", [a, mono, gaussian, seed]]);
  },
  median: (r: number) => applyFilter(4, [r], () => { E().filter_median(r); engine.commit(); }),
  // Filter ▸ Noise ▸ Despeckle — one-click edge-preserving blur.
  despeckle: () => applyFilter(88, [], () => { E().filter_despeckle(); engine.commit(); }),
  // Filter ▸ Pixelate ▸ Facet — one-click clump-into-facets.
  facet: () => applyFilter(89, [], () => { E().filter_facet(); engine.commit(); }),
  // Filter ▸ Pixelate ▸ Mezzotint — high-contrast random dot/line pattern.
  mezzotint: (kind: number) => {
    const seed = Math.floor(Math.random() * 0xffffffff); // fixed in the smart params so re-renders replay the same dots
    applyFilter(85, [kind, seed], () => { E().filter_mezzotint(kind, seed); engine.commit(); });
  },
  // Filter ▸ Blur ▸ Lens Blur — disc-aperture bokeh blur with highlight bloom.
  lensBlur: (radius: number, brightness: number) => applyFilter(18, [radius, brightness], () => { E().filter_lens_blur(radius, brightness); engine.commit(); }),
  // Filter ▸ Sharpen ▸ Smart Sharpen — noise-gated unsharp.
  smartSharpen: (amount: number, radius: number, reduceNoise: number, remove = 0, angle = 0, shadowFade = 0, highlightFade = 0) => applyFilter(19, [amount, radius, reduceNoise, remove, angle, shadowFade, highlightFade], () => { E().filter_smart_sharpen(amount, radius, reduceNoise, remove, angle, shadowFade, highlightFade); engine.commit(); }),
  // Filter ▸ Sharpen ▸ Shake Reduction — Richardson-Lucy deconvolution.
  shakeReduction: (radius: number, iterations: number) => applyFilter(20, [radius, iterations], () => { E().filter_shake_reduction(radius, iterations); engine.commit(); }),
  // Filter ▸ Noise ▸ Reduce Noise — edge-preserving bilateral denoise.
  reduceNoise: (strength: number, reduceColor = 0, preserveDetails = 0, sharpenDetails = 0) => applyFilter(21, [strength, reduceColor, preserveDetails, sharpenDetails], () => { E().filter_reduce_noise(strength, reduceColor, preserveDetails, sharpenDetails); engine.commit(); }),
  deblock: (strength: number) => applyFilter(22, [strength], () => { E().filter_deblock(strength); engine.commit(); }),
  // Filter ▸ Other ▸ HSB/HSL — reinterpret HSB/HSL into RGB channels (mode 0 HSB, 1 HSL).
  hsbHsl: (mode: number) => applyFilter(23, [mode], () => { E().filter_hsb_hsl(mode); engine.commit(); }),
  // Filter ▸ Stylize ▸ Extrude — break the image into extruded blocks.
  extrude: (size: number, depth: number, byBrightness: boolean, kind = 0, solidFront = true, maskIncomplete = false) => {
    const seed = Math.floor(Math.random() * 0xffffffff);
    applyFilter(90, [size, depth, byBrightness ? 1 : 0, seed, kind, solidFront ? 1 : 0, maskIncomplete ? 1 : 0],
      () => { E().filter_extrude(size, depth, byBrightness, seed, kind, solidFront, maskIncomplete); engine.commit(); });
  },
  // Filter ▸ Blur Gallery ▸ Field/Iris/Tilt-Shift — kind 0 field, 1 iris, 2 tilt-shift.
  galleryBlur: (kind: number, radius: number, focus: number, lightBokeh = 0, bokehColor = 0) => applyFilter(24, [kind, radius, focus, lightBokeh, bokehColor], () => { E().filter_gallery_blur(kind, radius, focus, lightBokeh, bokehColor); engine.commit(); }),
  // Filter ▸ Blur Gallery ▸ Spin Blur — rotational blur around the centre.
  spinBlur: (angle: number, strobeFlashes = 0) => applyFilter(25, [angle, strobeFlashes], () => { E().filter_spin_blur(angle, strobeFlashes); engine.commit(); }),
  // Filter ▸ Distort ▸ Displace — self-displace by the R/G channels.
  displace: (scaleH: number, scaleV: number) => applyFilter(26, [scaleH, scaleV], () => { E().filter_displace(scaleH, scaleV); engine.commit(); }),
  // Filter ▸ Lens Correction — radial distortion + vignette correction.
  lensCorrection: (distortion: number, vignette: number, aberration: number, scale = 1, vignetteMid = 0) => applyFilter(27, [distortion, vignette, aberration, scale, vignetteMid], () => { E().filter_lens_correction(distortion, vignette, aberration, scale, vignetteMid); engine.commit(); }),
  // Filter ▸ Lens Correction with independent red/cyan + blue/yellow fringe.
  lensCorrectionCa: (distortion: number, vignette: number, redCyan: number, blueYellow: number, scale = 1, vignetteMid = 0) => applyFilter(116, [distortion, vignette, redCyan, blueYellow, scale, vignetteMid], () => { E().filter_lens_correction_ca(distortion, vignette, redCyan, blueYellow, scale, vignetteMid); engine.commit(); }),
  lensProfile: (params: number[]) => applyFilter(118, params, () => { E().filter_lens_profile(new Float32Array(params)); engine.commit(); }),
  // Filter ▸ Render ▸ Tree — recursive fractal tree with Photoshop's leaves
  // amount/size, branch height/thickness (%) and light direction (0..180°).
  tree: (angle: number, depth: number, r: number, g: number, b: number, leavesAmount = 0, leavesSize = 100, height = 100, thickness = 100, light = 90) =>
    applyFilter(28, [angle, depth, r, g, b, leavesAmount, leavesSize, height, thickness, light], () => { E().filter_tree(angle, depth, r, g, b, leavesAmount, leavesSize, height, thickness, light); engine.commit(); }),
  // Filter ▸ Render ▸ Flame — seeded fire in the foreground colour, rising from
  // the bottom of the selection (or the layer). The seed rides in the params so
  // the dialog's preview, OK and a stack re-render all draw the same fire.
  flame: (length: number, width: number, turbulence: number, opacity: number, seed: number) => {
    const [r, g, b] = hsvToRgba(store.state.fg);
    applyFilter(29, [seed, r, g, b, length, width, turbulence, opacity], () => { E().filter_flame(seed, r, g, b, length, width, turbulence, opacity); engine.commit(); });
  },
  // Filter ▸ Render ▸ Picture Frame — bevelled solid frame around the edge.
  pictureFrame: (width: number, r: number, g: number, b: number) => applyFilter(30, [width, r, g, b], () => { E().filter_picture_frame(width, r, g, b); engine.commit(); }),
  // Filter ▸ 3D ▸ Generate Bump Map — grayscale height field.
  // Filter ▸ 3D ▸ Generate Normal Map — encode the height-field normal as RGB.
  lightingEffects: (o: LightingOptions) => {
    const a = lightingArgs(o, E().width(), E().height());
    applyFilter(91, [...a], () => { E().filter_lighting_effects(...a); engine.commit(); });
  },
  // Filter ▸ Video ▸ NTSC Colors — clamp to the broadcast-safe gamut.
  ntscColors: () => applyFilter(31, [], () => { E().filter_ntsc_colors(); engine.commit(); }),
  // Filter ▸ Video ▸ De-Interlace — rebuild one field from the other.
  deinterlace: (eliminateOdd: boolean, interpolate: boolean) => applyFilter(32, [eliminateOdd ? 1 : 0, interpolate ? 1 : 0], () => { E().filter_deinterlace(eliminateOdd, interpolate); engine.commit(); }),
  findEdges: () => applyFilter(5, [], () => { E().filter_find_edges(); engine.commit(); }),
  // Filter ▸ Stylize ▸ Glowing Edges — bright edge glows on black (plain, not a smart-filter id).
  glowingEdges: (width: number, brightness: number) => applyFilter(33, [width, brightness], () => { E().filter_glowing_edges(width, brightness); engine.commit(); }),
  // Filter ▸ Stylize ▸ Trace Contour — outline one brightness level per channel.
  traceContour: (level: number, upper: boolean) => applyFilter(34, [level, upper ? 1 : 0], () => { E().filter_trace_contour(level, upper); engine.commit(); }),
  // Filter ▸ Stylize ▸ Wind — directional edge streaks; method 0 Wind · 1 Blast · 2 Stagger.
  wind: (method: number, fromLeft: boolean) => applyFilter(35, [method, fromLeft ? 1 : 0], () => { E().filter_wind(method, fromLeft); engine.commit(); }),
  // Filter ▸ Artistic ▸ Poster Edges — posterize colours + dark edge lines.
  posterEdges: (levels: number, thickness: number, intensity: number) => applyFilter(36, [levels, thickness, intensity], () => { E().filter_poster_edges(levels, thickness, intensity); engine.commit(); }),
  // Filter ▸ Artistic ▸ Cutout — flatten into a few flat colour regions (cut-paper look).
  cutout: (levels: number, edgeSimplicity: number, edgeFidelity: number) => applyFilter(37, [levels, edgeSimplicity, edgeFidelity], () => { E().filter_cutout(levels, edgeSimplicity, edgeFidelity); engine.commit(); }),
  // Filter ▸ Artistic ▸ Film Grain — even monochromatic grain (grain/highlight/intensity 0..1).
  filmGrain: (grain: number, highlight: number, intensity: number) => applyFilter(38, [grain, highlight, intensity, Math.floor(Math.random() * 0xffffffff)], () => { E().filter_film_grain(grain, highlight, intensity); engine.commit(); }),
  // Filter ▸ Artistic ▸ Dry Brush — local brush strokes with dry media texture.
  dryBrush: (brushSize: number, brushDetail: number, texture: number) => applyFilter(39, [brushSize, brushDetail, texture], () => { E().filter_dry_brush(brushSize, brushDetail, texture); engine.commit(); }),
  // Filter ▸ Artistic ▸ Watercolor — pigment wash with shadow pooling and paper texture.
  watercolor: (brushDetail: number, shadowIntensity: number, texture: number) => applyFilter(40, [brushDetail, shadowIntensity, texture], () => { E().filter_watercolor(brushDetail, shadowIntensity, texture); engine.commit(); }),
  // Filter ▸ Artistic ▸ Colored Pencil — diagonal colored-pencil hatch on paper.
  coloredPencil: (pencilWidth: number, strokePressure: number, paperBrightness: number) => applyFilter(41, [pencilWidth, strokePressure, paperBrightness], () => { E().filter_colored_pencil(pencilWidth, strokePressure, paperBrightness); engine.commit(); }),
  // Filter ▸ Artistic ▸ Smudge Stick — diagonal smear of darks + highlight lift.
  smudgeStick: (strokeLength: number, highlightArea: number, intensity: number) => applyFilter(42, [strokeLength, highlightArea, intensity], () => { E().filter_smudge_stick(strokeLength, highlightArea, intensity); engine.commit(); }),
  // Filter ▸ Artistic ▸ Sponge — clumped, contrasting paint dabs.
  sponge: (brushSize: number, definition: number, smoothness: number) => applyFilter(43, [brushSize, definition, smoothness], () => { E().filter_sponge(brushSize, definition, smoothness); engine.commit(); }),
  // Filter ▸ Artistic ▸ Palette Knife — flatten detail toward local averages.
  paletteKnife: (strokeSize: number, strokeDetail: number, softness: number) => applyFilter(44, [strokeSize, strokeDetail, softness], () => { E().filter_palette_knife(strokeSize, strokeDetail, softness); engine.commit(); }),
  // Filter ▸ Artistic ▸ Paint Daubs — six brush types; Sharpness restores detail.
  paintDaubs: (brushSize: number, sharpness: number, brushType = 0) => applyFilter(45, [brushSize, sharpness, brushType], () => { E().filter_paint_daubs(brushSize, sharpness, brushType); engine.commit(); }),
  // Filter ▸ Artistic ▸ Fresco — coarse dark dabs with plaster tooth.
  fresco: (brushSize: number, brushDetail: number, texture: number) => applyFilter(46, [brushSize, brushDetail, texture], () => { E().filter_fresco(brushSize, brushDetail, texture); engine.commit(); }),
  // Filter ▸ Artistic ▸ Rough Pastels — diagonal chalk stroke over a relief texture, deeper in dark areas.
  roughPastels: (strokeLength: number, texture: number, scaling: number, relief: number, light: number) => applyFilter(47, [strokeLength, texture, scaling, relief, light], () => { E().filter_rough_pastels(strokeLength, texture, scaling, relief, light); engine.commit(); }),
  // Filter ▸ Artistic ▸ Underpainting — a low-detail smoothed base with a uniform surface texture.
  underpainting: (brushSize: number, textureCoverage: number, texture: number, scaling: number, relief: number, light: number) => applyFilter(48, [brushSize, textureCoverage, texture, scaling, relief, light], () => { E().filter_underpainting(brushSize, textureCoverage, texture, scaling, relief, light); engine.commit(); }),
  // Filter ▸ Brush Strokes ▸ Crosshatch — diagonal pencil hatching by tone (length/sharpness/strength 0..1).
  crosshatch: (length: number, sharpness: number, strength: number) => applyFilter(49, [length, sharpness, strength], () => { E().filter_crosshatch(length, sharpness, strength); engine.commit(); }),
  // Filter ▸ Brush Strokes ▸ Spatter — a spray/scatter (sprayRadius 0..25 px, smoothness 1..15).
  spatter: (sprayRadius: number, smoothness: number) => applyFilter(50, [sprayRadius, smoothness], () => { E().filter_spatter(sprayRadius, smoothness); engine.commit(); }),
  // Filter ▸ Brush Strokes ▸ Angled Strokes — a tone-dependent diagonal smear (length px half-length, balance/sharpness 0..1).
  angledStrokes: (length: number, balance: number, sharpness: number) => applyFilter(51, [length, balance, sharpness], () => { E().filter_angled_strokes(length, balance, sharpness); engine.commit(); }),
  // Filter ▸ Brush Strokes ▸ Dark Strokes — short dark strokes in shadows, long white strokes in highlights (balance/black/white 0..1).
  darkStrokes: (balance: number, blackIntensity: number, whiteIntensity: number) => applyFilter(52, [balance, blackIntensity, whiteIntensity], () => { E().filter_dark_strokes(balance, blackIntensity, whiteIntensity); engine.commit(); }),
  // Filter ▸ Brush Strokes ▸ Sprayed Strokes — angled sprayed streaks (length/radius px, direction 0 RightDiag/1 Horiz/2 LeftDiag/3 Vert).
  sprayedStrokes: (strokeLength: number, sprayRadius: number, direction: number) => applyFilter(53, [strokeLength, sprayRadius, direction], () => { E().filter_sprayed_strokes(strokeLength, sprayRadius, direction); engine.commit(); }),
  // Filter ▸ Brush Strokes ▸ Sumi-e — soft wet-ink blur + jet-black shadow darkening + contrast (all 0..1).
  sumiE: (strokeWidth: number, strokePressure: number, contrast: number) => applyFilter(54, [strokeWidth, strokePressure, contrast], () => { E().filter_sumi_e(strokeWidth, strokePressure, contrast); engine.commit(); }),
  // Filter ▸ Texture ▸ Mosaic Tiles — a tile grid with grayscale grout (tileSize/groutWidth px, lightenGrout 0..1).
  mosaicTiles: (tileSize: number, groutWidth: number, lightenGrout: number) => applyFilter(55, [tileSize, groutWidth, lightenGrout], () => { E().filter_mosaic_tiles(tileSize, groutWidth, lightenGrout); engine.commit(); }),
  // Filter ▸ Texture ▸ Patchwork — raised square tiles, per-cell average + bevel relief (size px, relief 0..1).
  patchwork: (size: number, relief: number) => applyFilter(56, [size, relief], () => { E().filter_patchwork(size, relief); engine.commit(); }),
  // Filter ▸ Texture ▸ Craquelure — a value-noise crack network embossed as relief (spacing px, depth/brightness 0..1).
  craquelure: (spacing: number, depth: number, brightness: number) => applyFilter(57, [spacing, depth, brightness], () => { E().filter_craquelure(spacing, depth, brightness); engine.commit(); }),
  // Filter ▸ Texture ▸ Grain — 10-mode film grain (intensity/contrast 0..1, grainType 0..9); bg colour for Sprinkles/Stippled.
  grain: (intensity: number, contrast: number, grainType: number) => {
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(58, [intensity, contrast, grainType, br, bg, bb], () => { E().filter_texture_grain(intensity, contrast, grainType, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Artistic ▸ Neon Glow — recolour tones into the foreground glow colour (glowSize −1..1, glowBrightness 0..1).
  neonGlow: (glowSize: number, glowBrightness: number) => {
    const [gr, gg, gb] = hsvToRgba(store.state.fg);
    applyFilter(59, [glowSize, glowBrightness, gr, gg, gb], () => { E().filter_neon_glow(glowSize, glowBrightness, gr, gg, gb); engine.commit(); });
  },
  // Filter ▸ Artistic ▸ Plastic Wrap — additive specular sheen on surface curvature (highlightStrength/detail/smoothness 0..1).
  plasticWrap: (highlightStrength: number, detail: number, smoothness: number) => applyFilter(60, [highlightStrength, detail, smoothness], () => { E().filter_plastic_wrap(highlightStrength, detail, smoothness); engine.commit(); }),
  // Filter ▸ Brush Strokes ▸ Accented Edges — accent edges toward white/black (width/brightness/smoothness 0..1).
  accentedEdges: (width: number, brightness: number, smoothness: number) => applyFilter(61, [width, brightness, smoothness], () => { E().filter_accented_edges(width, brightness, smoothness); engine.commit(); }),
  // Filter ▸ Brush Strokes ▸ Ink Outlines — Sobel-edge dark ink over the image + a flat-area brighten (strokeLength/dark/light 0..1).
  inkOutlines: (strokeLength: number, darkIntensity: number, lightIntensity: number) => applyFilter(62, [strokeLength, darkIntensity, lightIntensity], () => { E().filter_ink_outlines(strokeLength, darkIntensity, lightIntensity); engine.commit(); }),
  // Filter ▸ Texture ▸ Texturizer — overlay a surface texture as relief (texture 0..3, scaling/relief 0..1, light 0..7).
  texturizer: (texture: number, scaling: number, relief: number, light: number, invert: boolean) => applyFilter(63, [texture, scaling, relief, light, invert ? 1 : 0], () => { E().filter_texturizer(texture, scaling, relief, light, invert); engine.commit(); }),
  // Filter ▸ Render ▸ Fibers — weave fibers from the foreground/background colours.
  fibers: (variance: number, strength: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(64, [variance, strength, fr, fg, fb, br, bg, bb], () => { E().filter_fibers(variance, strength, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Photocopy — dark-edge outlines in fg over bg.
  photocopy: (detail: number, darkness: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(65, [detail, darkness, fr, fg, fb, br, bg, bb], () => { E().filter_photocopy(detail, darkness, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Stamp — a smoothed-luma hard 2-tone threshold into fg (dark) / bg (light), balance/smoothness 0..1.
  stamp: (balance: number, smoothness: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(66, [balance, smoothness, fr, fg, fb, br, bg, bb], () => { E().filter_stamp(balance, smoothness, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Note Paper — fg/bg ink on textured paper, imageBalance/graininess/relief 0..1.
  notePaper: (imageBalance: number, graininess: number, relief: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(67, [imageBalance, graininess, relief, fr, fg, fb, br, bg, bb], () => { E().filter_note_paper(imageBalance, graininess, relief, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Torn Edges — ragged fg/bg paper threshold, imageBalance/smoothness/contrast 0..1.
  tornEdges: (imageBalance: number, smoothness: number, contrast: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(68, [imageBalance, smoothness, contrast, fr, fg, fb, br, bg, bb], () => { E().filter_torn_edges(imageBalance, smoothness, contrast, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Water Paper — fibrous damp-paper color flow, fiberLength/brightness/contrast 0..1.
  waterPaper: (fiberLength: number, brightness: number, contrast: number) => applyFilter(69, [fiberLength, brightness, contrast], () => { E().filter_water_paper(fiberLength, brightness, contrast); engine.commit(); }),
  // Filter ▸ Sketch ▸ Chalk & Charcoal — a 3-tone luma map: shadows → fg charcoal, highlights → bg chalk, midtones → a solid 50% gray; areas/pressure 0..1.
  chalkCharcoal: (charcoalArea: number, chalkArea: number, strokePressure: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(70, [charcoalArea, chalkArea, strokePressure, fr, fg, fb, br, bg, bb], () => { E().filter_chalk_charcoal(charcoalArea, chalkArea, strokePressure, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Conté Crayon — fg crayon in shadows, bg crayon in highlights, with textured relief.
  conteCrayon: (foregroundLevel: number, backgroundLevel: number, texture: number, scaling: number, relief: number, light: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(71, [foregroundLevel, backgroundLevel, texture, scaling, relief, light, fr, fg, fb, br, bg, bb], () => { E().filter_conte_crayon(foregroundLevel, backgroundLevel, texture, scaling, relief, light, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Reticulation — clustered film-emulsion grain into fg/bg colours.
  reticulation: (density: number, foregroundLevel: number, backgroundLevel: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(72, [density, foregroundLevel, backgroundLevel, fr, fg, fb, br, bg, bb], () => { E().filter_reticulation(density, foregroundLevel, backgroundLevel, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Plaster — fg/bg 3D relief: dark areas raised, light areas sunken.
  plaster: (imageBalance: number, smoothness: number, light: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(73, [imageBalance, smoothness, light, fr, fg, fb, br, bg, bb], () => { E().filter_plaster(imageBalance, smoothness, light, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Graphic Pen — fg-ink strokes on bg paper (strokeLength/balance 0..1, direction 0..3).
  graphicPen: (strokeLength: number, balance: number, direction: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(74, [strokeLength, balance, direction, fr, fg, fb, br, bg, bb], () => { E().filter_graphic_pen(strokeLength, balance, direction, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Charcoal — bold edges + diagonal-stroke midtones in fg charcoal on bg paper (thickness 1..7, detail 0..5, balance 0..1).
  charcoal: (thickness: number, detail: number, balance: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(75, [thickness, detail, balance, fr, fg, fb, br, bg, bb], () => { E().filter_charcoal(thickness, detail, balance, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Halftone Pattern — a fg/bg halftone screen by tone (size px, contrast 0..1, pattern 0 Circle/1 Dot/2 Line).
  halftonePattern: (size: number, contrast: number, pattern: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(76, [size, contrast, pattern, fr, fg, fb, br, bg, bb], () => { E().filter_halftone_pattern(size, contrast, pattern, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Bas Relief — a fg/bg low-relief carve (detail/smoothness 1..15, light 0..7 dir).
  basRelief: (detail: number, smoothness: number, light: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(77, [detail, smoothness, light, fr, fg, fb, br, bg, bb], () => { E().filter_bas_relief(detail, smoothness, light, fr, fg, fb, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Sketch ▸ Chrome — reflective grayscale metal from luminance relief.
  chrome: (detail: number, smoothness: number) => applyFilter(78, [detail, smoothness], () => { E().filter_chrome(detail, smoothness); engine.commit(); }),
  // Filter ▸ Stylize ▸ Tiles — offset tiles; fill 0 bg · 1 fg · 2 inverse · 3 unaltered.
  tiles: (numTiles: number, maxOffsetPct: number, fillMode: number) => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bgc, bb] = hsvToRgba(store.state.bg);
    applyFilter(79, [numTiles, maxOffsetPct / 100, fillMode, fr, fg, fb, br, bgc, bb], () => { E().filter_tiles(numTiles, maxOffsetPct / 100, fillMode, fr, fg, fb, br, bgc, bb); engine.commit(); });
  },
  emboss: (angle: number, amount: number, height = 1) => applyFilter(6, [angle, amount, height], () => { E().filter_emboss(angle, amount, height); engine.commit(); }),
  motion: (angle: number, dist: number) => applyFilter(7, [angle, dist], () => { E().filter_motion_blur(angle, dist); engine.commit(); }),
  // Filter ▸ Blur ▸ Path Blur — a directional streak (trailing when not centered, with a taper). Distinct from Motion Blur.
  pathBlur: (angle: number, speed: number, taper: number, centered: boolean) => applyFilter(15, [angle, speed, taper, centered ? 1 : 0], () => { E().filter_path_blur(angle, speed, taper, centered); engine.commit(); }),
  highPass: (r: number) => applyFilter(8, [r], () => { E().filter_high_pass(r); engine.commit(); }),
  mosaic: (s: number) => applyFilter(9, [s], () => { E().filter_mosaic(s); engine.commit(); }),
  // Filter ▸ Pixelate ▸ Fragment — one-click, no parameters.
  fragment: () => applyFilter(80, [], () => { E().filter_fragment(); engine.commit(); }),
  // Filter ▸ Pixelate ▸ Color Halftone — per-channel screened dots; max radius + 3 channel angles.
  colorHalftone: (maxRadius: number, a1: number, a2: number, a3: number) => applyFilter(81, [maxRadius, a1, a2, a3], () => { E().filter_color_halftone(maxRadius, a1, a2, a3); engine.commit(); }),
  // Filter ▸ Pixelate ▸ Crystallize — solid-coloured Voronoi cells; cell size in px.
  crystallize: (cellSize: number) => applyFilter(82, [cellSize], () => { E().filter_crystallize(cellSize); engine.commit(); }),
  // Filter ▸ Texture ▸ Stained Glass — Voronoi cells with foreground-coloured lead.
  stainedGlass: (cellSize: number, border: number, light: number) => {
    const [r, g, b] = hsvToRgba(store.state.fg);
    applyFilter(83, [cellSize, border, light, r, g, b], () => { E().filter_stained_glass(cellSize, border, light, r, g, b); engine.commit(); });
  },
  // Filter ▸ Pixelate ▸ Pointillize — dots coloured by the image over the background colour.
  pointillize: (cellSize: number) => {
    const [r, g, b] = hsvToRgba(store.state.bg);
    applyFilter(84, [cellSize, r, g, b], () => { E().filter_pointillize(cellSize, r, g, b); engine.commit(); });
  },
  vignette: (a: number) => applyFilter(10, [a], () => { E().filter_vignette(a); engine.commit(); }),
  // Filter ▸ Other ▸ Offset — a geometric shift; the smart params bake the
  // current background colour for edge mode 2 (Set to Background).
  offset: (dx: number, dy: number, edge: number) => {
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(110, [dx, dy, edge, br, bg, bb, 255], () => { E().offset(dx, dy, edge); engine.commit(); });
  },
  // Filter ▸ Other ▸ Maximum (dilate) / Minimum (erode); round = Preserve Roundness.
  maximum: (radius: number, round: boolean) => applyFilter(107, [radius, round ? 1 : 0], () => { E().maximum(radius, round); engine.commit(); }),
  minimum: (radius: number, round: boolean) => applyFilter(108, [radius, round ? 1 : 0], () => { E().minimum(radius, round); engine.commit(); }),
  // Filter ▸ Stylize ▸ Solarize — invert channel values above 50% (one click).
  solarize: () => applyFilter(103, [], () => { E().solarize(); engine.commit(); }),
  // Filter ▸ Stylize ▸ Diffuse — shuffle pixels (0 Normal · 1 Darken Only · 2 Lighten Only).
  diffuse: (mode: number) => applyFilter(111, [mode, Math.floor(Math.random() * 0xffffffff)], () => { E().diffuse(mode); engine.commit(); }),
  // Filter ▸ Render ▸ Lens Flare — bright flare at the image centre; brightness 1.0 = 100%.
  // Filter ▸ Render ▸ Lens Flare — brightness + Lens Type (0 50-300mm Zoom / 1 35mm / 2 105mm / 3 Movie Prime) + flare centre (fractions 0..1).
  lensFlare: (brightness: number, lensType = 0, cx = 0.5, cy = 0.5) => {
    const fx = E().width() * cx;
    const fy = E().height() * cy;
    applyFilter(109, [fx, fy, brightness, lensType], () => { E().lens_flare(fx, fy, brightness, lensType); engine.commit(); });
  },
  // Filter ▸ Render ▸ Clouds — fractal fg/bg noise (one click). The smart
  // params fix the seed and the fg/bg colours so stack re-renders replay.
  clouds: () => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(112, [Math.floor(Math.random() * 0xffffffff), fr, fg, fb, br, bg, bb], () => { E().clouds(); engine.commit(); });
  },
  // Filter ▸ Render ▸ Difference Clouds — clouds blended with the layer via Difference.
  differenceClouds: () => {
    const [fr, fg, fb] = hsvToRgba(store.state.fg);
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(113, [Math.floor(Math.random() * 0xffffffff), fr, fg, fb, br, bg, bb], () => { E().difference_clouds(); engine.commit(); });
  },
  // Filter ▸ Other ▸ Custom — a 5×5 convolution (25 weights, centre at index 12).
  custom: (kernel: number[], scale: number, offset: number) => applyFilter(106, [...kernel.slice(0, 25), scale, offset], () => { E().custom_filter(new Float32Array(kernel), scale, offset); engine.commit(); }),
  // Filter ▸ Noise ▸ Dust & Scratches — thresholded median (radius + threshold).
  dustScratches: (radius: number, threshold: number) => applyFilter(105, [radius, threshold], () => { E().dust_and_scratches(radius, threshold); engine.commit(); }),
  // Filter ▸ Blur ▸ Surface Blur — edge-preserving bilateral blur.
  surfaceBlur: (radius: number, threshold: number) => applyFilter(104, [radius, threshold], () => { E().surface_blur(radius, threshold); engine.commit(); }),
  // Filter ▸ Blur ▸ Smart Blur — edge-aware; mode 0 Normal · 1 Edge Only · 2 Overlay Edge.
  smartBlur: (radius: number, threshold: number, mode: number, quality = 1) => applyFilter(102, [radius, threshold, mode, quality], () => { E().smart_blur(radius, threshold, mode, quality); engine.commit(); }),
};

// Filter ▸ Last Filter (⌘F): replay the most recently applied filter with the
// same settings. The `fil` proxy records each call's bound thunk; the dialogs
// and one-click menu items all dispatch through `fil`, so they're all captured.
let lastFilter: (() => void) | null = null;
export function repeatLastFilter() { lastFilter?.(); }
// Wrap filImpl in the capture proxy FIRST so a ⌘F (Last Filter) replay while
// recording records the right descriptor for free; the outer proxy binds each
// call's thunk for repeatLastFilter.
export const fil = new Proxy(withOpCapture("fil", filImpl), {
  get(target, prop, recv) {
    const v = Reflect.get(target, prop, recv);
    if (typeof v === "function") {
      const fn = v as (...a: never[]) => unknown;
      return (...args: never[]) => { lastFilter = () => fn(...args); return fn(...args); };
    }
    return v;
  },
});

/** Shared Filter/MCP boundary: resolve for the pinned photo and apply one filter. */
export function applyLensProfileCorrection(
  settings: LensCorrectionSettings,
  manual: number[] = [0, 0, 0, 0, 1, 0],
  target = { documentId: store.state.activeDocId, layerId: store.state.activeLayerId },
) {
  if (store.state.activeDocId !== target.documentId || store.state.activeLayerId !== target.layerId) {
    throw new Error("The Lens Correction target changed. Reopen the dialog for the intended layer.");
  }
  const result = resolveLensProfile(store.lensMetadata(target), settings);
  if (result.status === "missing") throw new Error(result.message);
  fil.lensProfile(Array.from(lensFilterParams(result.calibration, settings.profileDistortionAmount ?? 1, settings.profileVignettingAmount ?? 1, manual)));
  return result;
}

// ── Filter Gallery stack ───────────────────────────────────────
// The gallery composes N filters as one coherent result. Each effect's
// UI values are converted to engine args by its catalog def (filterGallery.ts)
// and dispatched to the matching `fil`/`distort` action below. The dialog
// previews by applying the visible stack and undoing it (undo-N) per change;
// OK commits the stack as a SINGLE undoable "Filter Gallery" step via the
// engine's push_history/drop_last_undo primitives.
const GALLERY_DISPATCH: Record<string, (a: number[]) => void> = {
  posterEdges: (a) => fil.posterEdges(a[0], a[1], a[2]),
  cutout: (a) => fil.cutout(a[0], a[1], a[2]),
  filmGrain: (a) => fil.filmGrain(a[0], a[1], a[2]),
  dryBrush: (a) => fil.dryBrush(a[0], a[1], a[2]),
  watercolor: (a) => fil.watercolor(a[0], a[1], a[2]),
  coloredPencil: (a) => fil.coloredPencil(a[0], a[1], a[2]),
  smudgeStick: (a) => fil.smudgeStick(a[0], a[1], a[2]),
  sponge: (a) => fil.sponge(a[0], a[1], a[2]),
  paletteKnife: (a) => fil.paletteKnife(a[0], a[1], a[2]),
  paintDaubs: (a) => fil.paintDaubs(a[0], a[1], a[2]),
  fresco: (a) => fil.fresco(a[0], a[1], a[2]),
  roughPastels: (a) => fil.roughPastels(a[0], a[1], a[2], a[3], a[4]),
  underpainting: (a) => fil.underpainting(a[0], a[1], a[2], a[3], a[4], a[5]),
  neonGlow: (a) => fil.neonGlow(a[0], a[1]),
  plasticWrap: (a) => fil.plasticWrap(a[0], a[1], a[2]),
  crosshatch: (a) => fil.crosshatch(a[0], a[1], a[2]),
  spatter: (a) => fil.spatter(a[0], a[1]),
  angledStrokes: (a) => fil.angledStrokes(a[0], a[1], a[2]),
  darkStrokes: (a) => fil.darkStrokes(a[0], a[1], a[2]),
  sprayedStrokes: (a) => fil.sprayedStrokes(a[0], a[1], a[2]),
  sumiE: (a) => fil.sumiE(a[0], a[1], a[2]),
  accentedEdges: (a) => fil.accentedEdges(a[0], a[1], a[2]),
  inkOutlines: (a) => fil.inkOutlines(a[0], a[1], a[2]),
  oceanRipple: (a) => distort.oceanRipple(a[0], a[1]),
  glass: (a) => distort.glass(a[0], a[1], a[2], a[3]),
  diffuseGlow: (a) => distort.diffuseGlow(a[0], a[1], a[2]),
  photocopy: (a) => fil.photocopy(a[0], a[1]),
  graphicPen: (a) => fil.graphicPen(a[0], a[1], a[2]),
  charcoal: (a) => fil.charcoal(a[0], a[1], a[2]),
  halftonePattern: (a) => fil.halftonePattern(a[0], a[1], a[2]),
  basRelief: (a) => fil.basRelief(a[0], a[1], a[2]),
  chrome: (a) => fil.chrome(a[0], a[1]),
  stamp: (a) => fil.stamp(a[0], a[1]),
  notePaper: (a) => fil.notePaper(a[0], a[1], a[2]),
  tornEdges: (a) => fil.tornEdges(a[0], a[1], a[2]),
  waterPaper: (a) => fil.waterPaper(a[0], a[1], a[2]),
  chalkCharcoal: (a) => fil.chalkCharcoal(a[0], a[1], a[2]),
  conteCrayon: (a) => fil.conteCrayon(a[0], a[1], a[2], a[3], a[4], a[5]),
  reticulation: (a) => fil.reticulation(a[0], a[1], a[2]),
  plaster: (a) => fil.plaster(a[0], a[1], a[2]),
  glowingEdges: (a) => fil.glowingEdges(a[0], a[1]),
  tiles: (a) => fil.tiles(a[0], a[1], a[2]),
  texturizer: (a) => fil.texturizer(a[0], a[1], a[2], a[3], a[4] >= 0.5),
  mosaicTiles: (a) => fil.mosaicTiles(a[0], a[1], a[2]),
  patchwork: (a) => fil.patchwork(a[0], a[1]),
  craquelure: (a) => fil.craquelure(a[0], a[1], a[2]),
  grain: (a) => fil.grain(a[0], a[1], a[2]),
  stainedGlass: (a) => fil.stainedGlass(a[0], a[1], a[2]),
  colorHalftone: (a) => fil.colorHalftone(a[0], a[1], a[2], a[3]),
  crystallize: (a) => fil.crystallize(a[0]),
  pointillize: (a) => fil.pointillize(a[0]),
};

// Apply every visible effect's engine op once, in order. Returns how many undo
// entries were REALLY pushed — measured, not assumed: the engine refuses an edit
// without pushing on a locked / type / vector / adjustment / smart-object layer and
// on 32-bit float documents, so `order.length` over-counted and the caller then
// undid that many REAL user history states. Measured via `undo_pushes()` (a
// monotonic counter) rather than `undo_depth()`, which stops growing at the History
// States cap. Caller manages history/suspend/sync. (#82)
function runGalleryStack(stack: GalleryEffect[]): number {
  const e = E();
  const before = e.undo_pushes();
  const order = composeOrder(stack);
  for (const eff of order) {
    if (!filterDef(eff.id)) continue;
    GALLERY_DISPATCH[eff.id]?.(effectArgs(eff));
  }
  return Math.max(0, Math.round(e.undo_pushes() - before));
}

/** Live preview: reset the transaction's temporary branch, then re-apply the
 *  visible stack with macro recording + the costly UI sync suspended. The real
 *  redo branch and History-States capacity stay parked in the engine. */
export function previewGalleryStack(stack: GalleryEffect[], transactionOpen: boolean): boolean {
  const e = E() as HistoryTransactionEngine;
  if (transactionOpen ? !e.reset_history_transaction() : !e.begin_history_transaction()) return false;
  actions.suspend(true);
  engine.syncSuspended = true;
  try {
    runGalleryStack(stack);
  } catch (error) {
    e.cancel_history_transaction();
    engine.syncSuspended = false;
    if (engine.engine === e) engine.refreshFromEngine();
    throw error;
  } finally {
    actions.suspend(false);
    engine.syncSuspended = false;
  }
  engine.blit(); // ensure the canvas reflects the latest preview (empty stack too)
  return true;
}

/** Cancel a live preview on its captured engine, even after the active document
 *  changes. Only repaint when that engine is still the visible document. */
export function revertGalleryStack(transactionOpen: boolean, target?: HistoryTransactionEngine): void {
  if (!transactionOpen) return;
  const e = target ?? E() as HistoryTransactionEngine;
  if (e.cancel_history_transaction() && engine.engine === e) engine.refreshFromEngine();
}

/** Commit the stack as ONE undoable "Filter Gallery" history step. Assumes the
 *  preview was reverted first (engine sits at the pre-gallery state). The N
 *  per-filter snapshots are dropped, leaving only the single labeled snapshot,
 *  so a single Undo restores the pre-gallery image. Recorded as one macro step
 *  (replay re-runs the whole stack as one coalesced step). */
export function commitGalleryStack(stack: GalleryEffect[]): boolean {
  if (composeOrder(stack).length === 0) return false;
  const work = (): boolean => {
    const e = E() as HistoryTransactionEngine;
    if (!e.begin_history_transaction()) return false;
    try {
      const beforeLabel = e.undo_pushes();
      e.push_history("Filter Gallery");
      if (e.undo_pushes() > beforeLabel) {
        actions.suspend(true);
        engine.syncSuspended = true;
        let n = 0;
        try { n = runGalleryStack(stack); }
        finally { actions.suspend(false); engine.syncSuspended = false; }
        for (let i = 0; i < n; i++) e.drop_last_undo();
        if (n === 0) e.drop_last_undo();
      }
      const committed = e.commit_history_transaction();
      if (engine.engine === e) {
        if (committed) engine.commit();
        else engine.refreshFromEngine();
      }
      return committed;
    } catch (error) {
      if (e.cancel_history_transaction() && engine.engine === e) engine.refreshFromEngine();
      throw error;
    } finally {
      engine.syncSuspended = false;
    }
  };
  const committed = work();
  if (committed) actions.record(work, ["commitGalleryStack", [stack]]);
  else { actions.suspend(true); actions.suspend(false); }
  return committed;
}

export function contentAwareFill() {
  rec(() => { E().content_aware_fill(); engine.commit(); }, ["contentAwareFill", []]);
}
/** The Content-Aware Fill workspace's fill. Its sampling mask is a document-sized
 *  array, so the step records as volatile, like the other preview dialogs. */
export function contentAwareFillWith(o: ContentAwareFillOptions) {
  rec(() => { E().content_aware_fill_workspace(o.sample, o.color, o.rotation, o.scale, o.mirror, o.output); engine.commit(); });
}
export function removeDistractions(strength = 0.75) {
  rec(() => { E().remove_distractions(strength); engine.commit(); }, ["removeDistractions", [strength]]);
}
export function removeReflections(strength = 0.65) {
  rec(() => { E().remove_reflections(strength); engine.commit(); }, ["removeReflections", [strength]]);
}
/** Reflection removal that keeps the result editable: splits into an
 *  "Underlying" (cleaned) layer and a "Reflections" (Linear Dodge) layer that
 *  recompose to the original — hide the Reflections layer to remove it. Uses
 *  the same deterministic detector as removeReflections (the AI-model quality
 *  tier is a documented model-sourcing follow-up). */
export function splitReflections(strength = 0.65) {
  rec(() => { E().split_reflections(strength); engine.commit(); }, ["splitReflections", [strength]]);
}
// Frequency Separation — the classic Photoshop retouching setup. Splits the
// active layer into a "Low Frequency" copy (Gaussian-blurred colour/tone) and a
// "High Frequency" copy (High Pass detail, set to Linear Light), so colour and
// texture can be retouched independently. Both copies use the SAME radius, which
// is what makes Linear-Light(High) over Low reconstruct the original. The source
// layer is left intact beneath the pair. Composable from existing engine ops, so
// no engine change is required.
export function frequencySeparation(radius = 8) {
  rec(() => {
    const e = E();
    const src = store.state.activeLayerId;
    // High Frequency (ends up on top): duplicate → High Pass → Linear Light.
    const high = e.duplicate_layer(src);
    e.set_active_layer(high);
    e.filter_high_pass(radius);
    e.set_layer_name(high, "High Frequency");
    e.set_layer_blend(high, blendIndex("linear-light"));
    // Low Frequency (sits below High): duplicate the source again → Gaussian.
    const low = e.duplicate_layer(src);
    e.set_active_layer(low);
    e.filter_gaussian_blur(radius);
    e.set_layer_name(low, "Low Frequency");
    engine.commit();
  }, ["frequencySeparation", [radius]]);
}
export function patchSelection() {
  const b = E().selection_bounds();
  // The menu command has no drag to take a direction from, so it samples the
  // neighbouring region — to the right when the canvas has room for it, and to
  // the left when it does not. Sampling off the canvas heals nothing.
  const gap = b[2] + 20;
  const fitsRight = b[0] + b[2] + gap <= E().width();
  store.patchSelectionBy(fitsRight ? gap : -gap, 0);
}
// Content-Aware Move tool: relocate the selection's CONTENTS by (dx,dy) and
// content-aware-fill the source region the object vacates — a single undo step.
// The drag from the selection to its drop point supplies the offset. Extend
// copies instead; Structure / Color adapt the dropped object to its new
// surroundings; sx/sy/deg are Transform On Drop's scale and rotation about the
// dropped centre. Recordable — a recording made before these existed carries
// only [dx, dy] and replays with the defaults.
export function contentAwareMoveBy(dx: number, dy: number, extend = false, structure = 4, color = 2, sx = 1, sy = 1, deg = 0) {
  rec(() => { E().content_aware_move(Math.round(dx), Math.round(dy), extend, structure, color, sx, sy, deg); engine.commit(); },
    ["contentAwareMoveBy", [dx, dy, extend, structure, color, sx, sy, deg]]);
}
// Transform On Drop: the drop previews inside a history transaction while the
// on-canvas frame is live. Enter / ✓ / a click elsewhere rolls the preview back
// and re-runs it as ONE recorded step carrying the frame's scale, rotation and
// nudge; Esc / ✕ cancels it history-neutrally. The engine is pinned, so neither
// can land on a document that became active in the meantime.
// ponytail: the frame previews scale/rotate — the pixels re-render once, on commit —
//   and a handle dragged past its anchor does not flip (the engine takes |scale|,
//   as transform_layer does). Upgrade path: a live preview texture + signed scale.
let camDropEngine: HistoryTransactionEngine | null = null;
export function beginContentAwareMoveDrop(dx: number, dy: number) {
  const e = E() as HistoryTransactionEngine;
  if (!e.has_selection() || !e.begin_history_transaction()) return;
  const b = Array.from(e.selection_bounds()) as number[];
  const before = e.undo_pushes();
  const { camExtend, camStructure, camColor } = store.state;
  [dx, dy] = [Math.round(dx), Math.round(dy)];
  e.content_aware_move(dx, dy, camExtend, camStructure, camColor, 1, 1, 0);
  engine.commit();
  if (e.undo_pushes() === before) {
    e.cancel_history_transaction();
    engine.refreshFromEngine();
    return;
  }
  camDropEngine = e;
  store.setOptions({ camDrop: { box: { x: b[0] + dx, y: b[1] + dy, w: b[2], h: b[3] }, dx, dy, t: {} } });
}
export function updateContentAwareMoveDrop(patch: PathTransform) {
  const cur = store.state.camDrop;
  if (cur) store.setOptions({ camDrop: { ...cur, t: { ...cur.t, ...patch } } });
}
export function commitContentAwareMoveDrop() {
  const s = store.state.camDrop, e = camDropEngine;
  store.setOptions({ camDrop: null });
  camDropEngine = null;
  if (!s || !e) return;
  if (engine.engine !== e) { e.cancel_history_transaction(); return; }
  e.reset_history_transaction();
  const { sx = 1, sy = 1, deg = 0, tx = 0, ty = 0 } = s.t;
  const { camExtend, camStructure, camColor } = store.state;
  contentAwareMoveBy(s.dx + Math.round(tx), s.dy + Math.round(ty), camExtend, camStructure, camColor, sx, sy, deg);
  if (e.commit_history_transaction()) engine.commit();
  else engine.refreshFromEngine();
}
export function cancelContentAwareMoveDrop() {
  const e = camDropEngine;
  store.setOptions({ camDrop: null });
  camDropEngine = null;
  if (e?.cancel_history_transaction() && engine.engine === e) engine.refreshFromEngine();
}
export function exposureFusion(removeGhosts = true) {
  E().exposure_fusion(removeGhosts);
  engine.commit();
}
// Keystone perspective: inset the top and bottom edges by the given fractions
// (negative = outset). Maps the 4 corners through the engine's real homography.
export function perspectiveTransform(topInset = 0.15, bottomInset = 0) {
  const w = E().width();
  const h = E().height();
  bakeTransform(() =>
    E().perspective_transform(topInset * w, 0, (1 - topInset) * w, 0, (1 - bottomInset) * w, h, bottomInset * w, h));
}
// Perspective Warp: move each of the four corners independently (TL,TR,BR,BL) via
// the engine's general homography — the arbitrary-quad counterpart to the
// symmetric keystone above.
export function perspectiveWarp(offsets: WarpOffset[]) {
  if (isIdentityWarp(offsets)) return;
  const w = E().width();
  const h = E().height();
  const [x0, y0, x1, y1, x2, y2, x3, y3] = perspectiveWarpCoords(offsets, w, h);
  bakeTransform(() => E().perspective_transform(x0, y0, x1, y1, x2, y2, x3, y3));
}
// Perspective Crop: rectify the source quad (fractional corners TL,TR,BR,BL of
// the current canvas) into a new out_w×out_h canvas — the inverse of the warp.
export function perspectiveCrop(corners: CropCorner[], outW: number, outH: number) {
  const e = E();
  const w = e.width(), h = e.height();
  const targetW = Math.max(1, Math.round(outW)), targetH = Math.max(1, Math.round(outH));
  if (isIdentityCrop(corners, w, h, targetW, targetH)) return;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = cropQuadPixels(corners, w, h);
  e.perspective_crop(x0, y0, x1, y1, x2, y2, x3, y3, targetW, targetH);
  engine.commit();
}

// ── Distort / warp ─────────────────────────────────────────────
const distortImpl = {
  spherize: (a: number, mode = 0) => applyFilter(13, [a, mode], () => { E().spherize(a, mode); engine.commit(); }),
  pinch: (a: number) => applyFilter(16, [a], () => { E().pinch(a); engine.commit(); }),
  twirl: (a: number) => applyFilter(14, [a], () => { E().twirl(a); engine.commit(); }),
  // Filter ▸ Distort ▸ Polar Coordinates (Rect↔Polar).
  polar: (toPolar: boolean) => applyFilter(93, [toPolar ? 1 : 0], () => { E().polar_coordinates(toPolar); engine.commit(); }),
  // Filter ▸ Distort ▸ Ripple — sine displacement; size 0/1/2 = Small/Medium/Large.
  ripple: (amount: number, size: number) => applyFilter(94, [amount, size], () => { E().ripple(amount, size); engine.commit(); }),
  // Filter ▸ Distort ▸ Ocean Ripple — noise-field displacement (underwater look); size/magnitude 0..1.
  oceanRipple: (size: number, magnitude: number) => applyFilter(95, [size, magnitude], () => { E().ocean_ripple(size, magnitude); engine.commit(); }),
  // Filter ▸ Distort ▸ Glass — refract through a textured glass surface (texture 0 Frosted/1 Blocks/2 Canvas, distortion/smoothness/scaling 0..1).
  glass: (texture: number, distortion: number, smoothness: number, scaling: number) => applyFilter(96, [texture, distortion, smoothness, scaling], () => { E().glass(texture, distortion, smoothness, scaling); engine.commit(); }),
  // Filter ▸ Distort ▸ ZigZag — radial sine; style 0 Around Center · 1 Out From Center · 2 Pond Ripples.
  zigzag: (amount: number, ridges: number, style: number) => applyFilter(97, [amount, ridges, style], () => { E().zigzag(amount, ridges, style); engine.commit(); }),
  // Filter ▸ Distort ▸ Shear — slide rows sideways (linear top→bottom curve); wrap vs repeat-edge.
  shear: (top: number, bottom: number, wrap: boolean) => applyFilter(98, [top, bottom, wrap ? 1 : 0], () => { E().shear(top, bottom, wrap); engine.commit(); }),
  // Filter ▸ Distort ▸ Diffuse Glow — bloom highlights toward the background colour.
  diffuseGlow: (graininess: number, glowAmount: number, clearAmount: number) => {
    const [br, bg, bb] = hsvToRgba(store.state.bg);
    applyFilter(100, [graininess, glowAmount, clearAmount, br, bg, bb], () => { E().filter_diffuse_glow(graininess, glowAmount, clearAmount, br, bg, bb); engine.commit(); });
  },
  // Filter ▸ Distort ▸ Wave — multi-generator wave displacement; type 0 Sine · 1 Triangle · 2 Square.
  wave: (numGen: number, wlMin: number, wlMax: number, ampMin: number, ampMax: number, scaleH: number, scaleV: number, type: number, wrap: boolean) =>
    applyFilter(99, [numGen, wlMin, wlMax, ampMin, ampMax, scaleH, scaleV, type, wrap ? 1 : 0], () => { E().wave(numGen, wlMin, wlMax, ampMin, ampMax, scaleH, scaleV, type, wrap); engine.commit(); }),
  // Filter ▸ Blur ▸ Radial Blur — Spin (tangential) or Zoom (radial) blur.
  radialBlur: (amount: number, zoom: boolean, cx = 0.5, cy = 0.5, quality = 1) => applyFilter(92, [amount, zoom ? 1 : 0, cx, cy, quality], () => { E().radial_blur(amount, zoom, cx, cy, quality); engine.commit(); }),
};
export const distort = withOpCapture("distort", distortImpl);
// Edit ▸ Puppet Warp. Opens the pin workspace. Unattended playback and action
// playback do not open it and do not apply a mesh; Commit records applyPuppetWarp.
export function puppetWarp(): boolean {
  if (_unattended || _playDepth > 0 || !engine.engine) return false;
  openPuppetSession(E().width(), E().height());
  return true;
}

/** Rebuild the mesh from recorded pins and warp once. Identity pins are a no-op. */
export function applyPuppetWarp(gw: number, gh: number, pins: PuppetPin[]) {
  const w = E().width();
  const h = E().height();
  if (!pinsMoved(w, h, pins, gw, gh)) return;
  const { dx, dy } = puppetDestinations(w, h, pins, gw, gh);
  E().mesh_warp(gw, gh, dx, dy);
  engine.commit();
}

export function commitPuppetWarp() {
  const taken = takePuppetCommit();
  if (!taken) return;
  const pins = taken.pins.map((pin) => ({ v: pin.v, x: pin.x, y: pin.y }));
  rec(() => applyPuppetWarp(PUPPET_GW, PUPPET_GH, pins), ["applyPuppetWarp", [PUPPET_GW, PUPPET_GH, pins]]);
}

export function cancelPuppetWarp() {
  cancelPuppetSession();
}

// Edit ▸ Transform ▸ Warp — deform the active layer with a preset envelope style
// (Arc/Bulge/Flag/Wave/…) via the engine mesh, reusing the Text-Warp forward map.
export function warpLayer(warp: TextWarp) {
  const gw = 20, gh = 20; // a fine control grid so the preset curves stay smooth
  const { dstX, dstY } = warpGrid(warp, gw, gh, E().width(), E().height());
  rec(() => { E().mesh_warp(gw, gh, dstX, dstY); engine.commit(); }, ["warpLayer", [warp]]);
}

// Filter ▸ Adaptive Wide Angle — apply the constraint-driven correction mesh
// (state/adaptiveWideAngle.ts) via the engine's mesh_warp, same as warpLayer.
export function adaptiveWideAngle(opts: AdaptiveWideOptions) {
  const gw = 32, gh = 32;
  const { dstX, dstY } = adaptiveWideGrid(opts, gw, gh, E().width(), E().height());
  rec(() => { E().mesh_warp(gw, gh, dstX, dstY); engine.commit(); }, ["adaptiveWideAngle", [opts]]);
}

// ── Animation / video timeline ─────────────────────────────────
// Frame edits are document content (saved into the project, exported as GIF):
// they go through engine.commit() so the dirty flag + history sync fire.
const animImpl = {
  addFrame: () => { E().add_frame(); engine.commit(); },
  deleteFrame: (i: number) => { E().delete_frame(i); engine.commit(); },
  tween: (a: number, b: number, n: number) => { E().tween_frames(a, b, n); engine.commit(); },
  clear: () => { E().clear_frames(); engine.commit(); },
  /** Timeline ▸ Reverse Frames. Delays travel with their frames (engine-side). */
  reverseFrames: () => { E().reverse_frames(); engine.commit(); },
  /** Timeline ▸ Make Frames From Layers: one frame per ungrouped layer. */
  framesFromLayers: () => { E().frames_from_layers(); engine.commit(); },
  /** Timeline ▸ Flatten Frames Into Layers: one layer per frame (frames kept). */
  framesToLayers: () => { E().frames_to_layers(); engine.commit(); },
  // Per-frame GIF timing (persisted in the project; 0 = unset → export default).
  setFrameDelay: (i: number, cs: number) => { E().set_frame_delay(i, cs); engine.commit(); },
  setRepeat: (n: number) => { E().set_gif_repeat(n); engine.commit(); },
};
// Display-only reads stay OUTSIDE the op-capture proxy: they run inside render
// paths (CanvasView's onion skin, the Animation panel), and a captured read at
// depth 0 stamps _pendingOp — which would hand a stale persistable descriptor
// to the next actions.suspend(false)/record() (the stale-descriptor regression
// the scripting e2e guards).
const animReads = {
  count: () => (engine.engine ? E().frame_count() : 0),
  thumbUrl: (i: number) => engine.frameThumbUrl(i),
  frameDelay: (i: number) => (engine.engine ? E().frame_delay(i) : 0),
  repeat: () => (engine.engine ? E().gif_repeat() : -1),
};
export const anim = { ...withOpCapture("anim", animImpl), ...animReads };
export function exportGIF(name = "animation.gif", delayCs = 10) {
  try {
    const eng = E();
    refuseNonRgbFlatExport(eng, "GIF");
    saveBytes(name, eng.export_gif(delayCs), "image/gif");
  } catch (e) { reportSave(e); }
}
// Apply a per-pixel adjustment (pixel_adjust kind) across every frame.
export function framesAdjust(kind: number, params: number[]) {
  E().frames_apply_adjustment(kind, new Float32Array(params));
  engine.commit();
}
export async function openGifFile(file: File) {
  // (#64) the caller floats this promise, so report like every sibling open flow
  // instead of leaving a corrupt GIF as a console-only unhandled rejection.
  try {
    const buf = await readBrowserOpenFile(file);
    store.openGif(buf, file.name);
  } catch (e) {
    reportOpen(file.name, e);
  }
}

// Encode the animation frames to a real video using the browser's codec
// (MediaRecorder → VP9/VP8/H.264 depending on platform support).
// WebCodecs note (plan 07 P5): VideoEncoder availability in the Tauri
// WKWebView runtime is unverified — this stays on MediaRecorder, which the
// desktop webview does support; swap the encoder behind this same signature
// once verified on hardware.
export async function recordVideo(
  fps = 12,
  opts: { from?: number; to?: number; bitrate?: number } = {},
): Promise<{ bytes: Uint8Array; mime: string }> {
  const w = E().width(), h = E().height();
  let count = E().frame_count();
  if (count === 0) { E().add_frame(); count = 1; }
  const from = Math.max(0, Math.min(opts.from ?? 0, count - 1));
  const to = Math.max(from, Math.min(opts.to ?? count - 1, count - 1));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const draw = (i: number) => {
    const px = E().frame_thumb(i, w, h);
    const img = ctx.createImageData(w, h);
    img.data.set(px);
    ctx.putImageData(img, 0, 0);
  };
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=h264", "video/mp4"];
  const mime = types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) || "video/webm";
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const rec = new MediaRecorder(stream, { mimeType: mime, ...(opts.bitrate ? { videoBitsPerSecond: opts.bitrate } : {}) });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
  rec.start();
  for (let i = from; i <= to; i++) {
    draw(i);
    track.requestFrame?.();
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  await new Promise((r) => setTimeout(r, 120));
  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: mime });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime };
}
export async function exportVideo(name = "video.webm", fps = 12, opts: { from?: number; to?: number; bitrate?: number } = {}) {
  return reportSaveExport(async () => {
    const { bytes, mime } = await recordVideo(fps, opts);
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    saveBytes(name.replace(/\.(webm|mp4)$/i, "") + "." + ext, bytes, mime);
  });
}

// ── Generative fill ────────────────────────────────────────────
export function generativeFill() {
  rec(() => { E().generative_fill(); engine.commit(); }, ["generativeFill", []]);
}

/** Remove tool stroke release: MI-GAN inpaint of the stroked footprint when
 *  the model is installed (Photoshop's on-device Remove analog); otherwise the
 *  classic content-aware spot heal. The ML path selects the dab union, runs
 *  the same selection-masked inpaint as Generative Fill, then restores the
 *  user's selection; any ML failure falls back to the classic heal so the
 *  stroke always lands. */
export async function removeStroke(points: number[], radius: number): Promise<void> {
  // Tier order: LaMa (large-model) → MI-GAN → classic heal. Whichever ML
  // model is imported is preferred; uninstalling it (Model Manager) is the
  // opt-out, matching the rest of the app's installed-⇒-preferred convention.
  const tier = (await models.lamaInstalled().catch(() => false))
    ? "lama"
    : (await models.miganInstalled().catch(() => false))
      ? "migan"
      : null;
  if (!tier) {
    store.spotHeal(points, radius);
    return;
  }
  const dabs = spotHealDabs(points, radius);
  if (!dabs.length) return;
  const e = E();
  const saved = engine.selectionMask();
  const savedCopy = saved ? Uint8Array.from(saved) : null;
  for (const d of dabs) e.select_ellipse(d.x, d.y, d.w, d.h, d.mode);
  try {
    const onnx = await import("../ml/onnx");
    if (tier === "lama") await onnx.lamaFillML();
    else await onnx.generativeFillML();
  } catch {
    store.spotHeal(points, radius); // classic heal — the stroke must land
  } finally {
    if (savedCopy) e.set_selection_mask(savedCopy);
    else e.select_none();
    engine.commit();
  }
}

// ── Neural-style filters ───────────────────────────────────────
const neuralImpl = {
  superResolution: () => {
    if (!E().super_resolution()) {
      engine.consumeEditError();
      return false;
    }
    if (engine.consumeEditError()) return false;
    store.markDirty();
    engine.afterDocChange();
    store.requestFit();
    return true;
  },
  // Filter ▸ Stylize ▸ Oil Paint — Photoshop's six controls; fid 12 tells the
  // six-param layout from the legacy [radius] one by length.
  oilPaint: (stylization: number, cleanliness: number, scale: number, bristle: number, angle: number, shine: number) =>
    applyFilter(12, [stylization, cleanliness, scale, bristle, angle, shine], () => { E().filter_oil_paint(stylization, cleanliness, scale, bristle, angle, shine); engine.commit(); }),
  colorize: () => {
    // heuristic auto-colorize: map luminance through a natural palette
    const stops = [[18, 26, 58], [28, 92, 112], [186, 124, 92], [246, 236, 212]];
    const lut = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const seg = (i / 255) * 3;
      const s = Math.min(2, Math.floor(seg));
      const f = seg - s;
      const a = stops[s], b = stops[s + 1] ?? stops[s];
      lut[i * 4] = Math.round(a[0] + (b[0] - a[0]) * f);
      lut[i * 4 + 1] = Math.round(a[1] + (b[1] - a[1]) * f);
      lut[i * 4 + 2] = Math.round(a[2] + (b[2] - a[2]) * f);
      lut[i * 4 + 3] = 255;
    }
    rec(() => { E().adjust_gradient_map(lut); engine.commit(); });
  },
};
export const neural = withOpCapture("neural", neuralImpl);

// ── Real ML neural filters (onnxruntime-web, lazy-loaded) ──────
// Genuine pretrained ONNX models — style transfer, super-resolution,
// and U²-Net subject segmentation. Loaded on first use so the ~13 MB
// runtime + model weights never touch the boot path.
type Prog = (m: string) => void;
export const ml = {
  styles: () => ["candy", "mosaic", "rain-princess", "udnie", "pointilism"],
  styleTransfer: (name: string, p?: Prog, opts?: StyleBlendOpts) => import("../ml/onnx").then((m) => m.styleTransfer(name, 512, p, opts)),
  superResolution: (p?: Prog) => import("../ml/onnx").then((m) => m.superResolution(p)),
  selectSubject: (p?: Prog) => import("../ml/onnx").then((m) => m.selectSubject(p)),
  removeBackground: (p?: Prog) => import("../ml/onnx").then((m) => m.removeBackground(p)),
  generativeFill: (p?: Prog) => import("../ml/onnx").then((m) => m.generativeFillML(p)),
  generativeFillPrompt: (prompt: string, steps: number, p?: Prog, ctrl?: GenControls) =>
    import("../ml/onnx").then((m) => m.generativeFillDiffusion(prompt, steps, p, ctrl)),
  generativeExpand: (nw: number, nh: number, dx: number, dy: number, p?: Prog) =>
    import("../ml/onnx").then((m) => m.generativeExpandML(nw, nh, dx, dy, p)),
  aiDenoise: (p?: Prog, amount?: number) => import("../ml/onnx").then((m) => m.aiDenoise(p, amount)),
  generateImage: (prompt: string, steps: number, p?: Prog, ctrl?: GenControls) =>
    import("../ml/diffusion").then((m) => m.generateImage({ prompt, steps, ...ctrl }, p)),
  // Re-roll the active generated document's settings with a fresh seed.
  generateSimilar: (p?: Prog) => import("../ml/diffusion").then((m) => m.generateSimilar(p)),
  // img2img: restyle the current composite by a prompt (reference-image init).
  generateImageReference: (prompt: string, steps: number, strength: number, p?: Prog, ctrl?: GenControls) =>
    import("../ml/onnx").then((m) => m.generateImageReference(prompt, steps, strength, p, ctrl)),
  generateBackground: (prompt: string, steps: number, p?: Prog, ctrl?: GenControls) =>
    import("../ml/onnx").then((m) => m.generateBackgroundML(prompt, steps, p, ctrl)),
  // ── Tier-2 on-device neural filters (plan 06). Wiring is shipped; each model's
  // weights are user-supplied (see MODELS.md) and only run once installed. ──
  /** Learned Colorize; falls back to the heuristic gradient-map when absent. */
  colorize: async (p?: Prog): Promise<{ ok: boolean; model: string }> => {
    try {
      return await import("../ml/onnx").then((m) => m.colorizeML(p));
    } catch {
      p?.("AI model not installed — using heuristic colorize.");
      neural.colorize();
      return { ok: true, model: "heuristic" };
    }
  },
  /** Depth-aware Depth Blur (MiDaS depth → per-pixel bokeh field). */
  depthBlur: (focal: number, strength: number, p?: Prog) =>
    import("../ml/onnx").then((m) => m.depthBlurML(focal, strength, p)),
  /** Neural Harmonize: relight/recolour the active layer to the backdrop. */
  harmonize: (p?: Prog) => import("../ml/onnx").then((m) => m.harmonizeML(p)),
  /** Learned JPEG-artifact / restoration cleanup; falls back to the classic deblock. */
  restore: async (p?: Prog): Promise<{ ok: boolean; model: string }> => {
    try {
      return await import("../ml/onnx").then((m) => m.restoreML(p));
    } catch {
      p?.("AI model not installed — using classic deblock.");
      E().filter_deblock(3);
      engine.commit();
      return { ok: true, model: "classic" };
    }
  },
  /** Image-based Match Font: rank installed families by a pixel classifier. */
  matchFontImage: (p?: Prog) => import("../ml/onnx").then((m) => m.matchFontML(p)),
  /** Face-Aware Liquify: landmark model → parametric mesh warps (full 16-control set + faceIndex). */
  faceAwareLiquify: (params: FaceLiquifyParams, p?: Prog) =>
    import("../ml/onnx").then((m) => m.faceAwareLiquifyML(params, p)),
  /** Every detected face's 68 landmarks in document pixels — feeds the dialog's face picker. */
  detectFaces: (p?: Prog) => import("../ml/onnx").then((m) => m.detectFaceLandmarksML(p)),
  /** Skin Smoothing (Featured Neural Filter): skin-tone chroma gate — ∩ the
   *  68-point face hull (eyes/lips kept sharp) when the landmark model is
   *  installed — drives a selection-masked Smart Blur. Heuristic, model-optional. */
  skinSmoothing: async (blur = 50, smoothness = 50, p?: Prog): Promise<{ ok: boolean; faces: number }> => {
    const { applySkinSmoothing } = await import("./skinSmoothing");
    const stamp = editStamp(engine);
    let faces: [number, number][][] | null = null;
    try {
      faces = (await import("../ml/onnx").then((m) => m.detectFaceLandmarksML(p))).faces;
    } catch {
      p?.("Face model not installed — gating by skin tones only.");
    }
    if (docChanged(engine, stamp)) { p?.("Cancelled — document changed."); return { ok: false, faces: 0 }; }
    p?.("Smoothing skin…");
    const applied = applySkinSmoothing(E(), faces, blur, smoothness);
    if (applied) engine.commit();
    p?.(applied ? "Done." : "Blur too low — nothing to smooth.");
    return { ok: applied, faces: faces?.length ?? 0 };
  },
};

// ── AI model provisioning ─────────────────────────────────────
// Auto-exposed on window.__mv by main.tsx for e2e/scripting; not rec()-wrapped —
// provisioning is not a document action.
function modelDef(id: ModelDef["id"]): ModelDef {
  const def = MODEL_REGISTRY.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`Unknown AI model: ${id}`);
  return def;
}

export const models = {
  registry: () => MODEL_REGISTRY,
  status: (id: ModelDef["id"]) =>
    import("../ml/modelSource").then((m) => m.modelStatus(modelDef(id))),
  download: (id: ModelDef["id"], p?: Parameters<typeof import("../ml/modelDownload").downloadModel>[1], signal?: AbortSignal, opts?: { licenseAccepted?: boolean }) =>
    import("../ml/modelDownload").then((m) => m.downloadModel(modelDef(id), p, signal, opts)),
  installLocal: (id: ModelDef["id"], p?: Parameters<typeof import("../ml/modelDownload").importModel>[1], signal?: AbortSignal, opts?: { licenseAccepted?: boolean }) =>
    import("../ml/modelDownload").then((m) => m.importModel(modelDef(id), p, signal, opts)),
  remove: (id: ModelDef["id"]) =>
    import("../ml/modelDownload").then((m) => m.removeModel(modelDef(id))),
  /** SD weight availability: "real" (local sd15), "demo" (placeholder), or "missing" (inpaint w/o vae_encoder). */
  sdStatus: (inpaint = false): Promise<"real" | "demo" | "missing"> =>
    import("../ml/modelSource").then((m) => m.sdAvailable(inpaint)),
  drunetInstalled: (): Promise<boolean> =>
    import("../ml/modelSource").then(async (m) => ["downloaded", "local"].includes(await m.modelStatus(modelDef("drunet")))),
  miganInstalled: (): Promise<boolean> =>
    import("../ml/modelSource").then(async (m) => ["downloaded", "local"].includes(await m.modelStatus(modelDef("migan")))),
  lamaInstalled: (): Promise<boolean> =>
    import("../ml/modelSource").then(async (m) => ["downloaded", "local"].includes(await m.modelStatus(modelDef("lama")))),

  /** Whether a WebGPU adapter exists — required to actually run the real SD-1.5 weights. */
  webgpu: (): Promise<boolean> =>
    import("../ml/modelSource").then((m) => m.webgpuAvailable()),
};

// ── Libraries (cross-document reusable graphics — a CC-Libraries analog) ──
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
const LIB_MAX_DIM = 256; // captured graphics are downscaled so localStorage stays small
export const library = {
  list: (): LibraryGraphic[] => loadLibrary(),
  /** Capture the current composite as a reusable graphic (downscaled). */
  async capture(name?: string): Promise<LibraryGraphic[]> {
    const png = E().export_png();
    const url = URL.createObjectURL(new Blob([png as unknown as BlobPart], { type: "image/png" }));
    try {
      const img = await loadImg(url);
      const scale = Math.min(1, LIB_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const g: LibraryGraphic = { id: `g${Date.now().toString(36)}`, name: name || `Graphic ${loadLibrary().length + 1}`, dataUrl: c.toDataURL("image/png"), w, h };
      const stored = loadLibrary();
      const next = addGraphic(stored, g);
      // (#137) Storage is full → the capture was never written. Say so and hand
      // back what IS stored, rather than a panel entry that vanishes on reload.
      if (!saveLibrary(next)) {
        notify("Could not add to Libraries — browser storage is full. Remove a graphic and try again.");
        return stored;
      }
      return next;
    } finally { URL.revokeObjectURL(url); }
  },
  /** Place a saved graphic into the active document as a new layer. */
  async insert(id: string): Promise<boolean> {
    const g = loadLibrary().find((x) => x.id === id);
    if (!g) return false;
    const img = await loadImg(g.dataUrl);
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const cx = c.getContext("2d")!; cx.drawImage(img, 0, 0);
    const rgba = new Uint8Array(cx.getImageData(0, 0, w, h).data.buffer.slice(0));
    store.addLayer();
    E().stamp_image(0, 0, w, h, rgba);
    engine.commit();
    return true;
  },
  // (#137) A refused removal is not a removal — keep what is stored and say so.
  remove(id: string): LibraryGraphic[] {
    const next = removeGraphic(loadLibrary(), id);
    if (saveLibrary(next)) return next;
    notify("Could not remove from Libraries — browser storage is full or unavailable. Free storage and try again.");
    return loadLibrary();
  },
};

// ── Scripting / automation ─────────────────────────────────────
// The READ half of the scripting API (V-SCRIPT-1), exposed to a script as
// `await vision.read.*`. Every entry is side-effect free — it observes the
// store/engine and returns structured-cloneable plain data — so the read
// channel widens what a script can KNOW without widening what it can change.
// The worker flushes its pending ops before each read, so a read always sees
// the script's own edits (see scriptWorker.ts).
type VisionRead = (...a: never[]) => unknown;
function visionReads(): Record<string, VisionRead> {
  const st = () => store.state;
  // Layer thumbs are data URLs (tens of KB each) and every read is structured-
  // cloned to the worker — strip them; a script can't paint with a thumb anyway.
  const layers = () => st().layers.map(({ thumb: _thumb, ...rest }) => rest);
  return {
    // The same fact set Insert Conditional tests, so a script branches on
    // exactly what an action's conditional step can.
    doc: () => ({ ...actionConditionContext(), name: st().doc.name, depth: st().depth, resolution: st().resolutionPpi }),
    width: () => st().doc.width,
    height: () => st().doc.height,
    documents: () => st().documents.map((d) => ({ ...d })),
    layers,
    layerCount: () => st().layers.length,
    activeLayerId: () => st().activeLayerId,
    activeLayer: () => layers().find((l) => l.id === st().activeLayerId) ?? null,
    selectedLayerIds: () => [...st().selectedLayerIds],
    hasSelection: () => st().selectionActive,
    selectionBounds: () => (engine.engine ? selectionRect(E().selection_bounds()) : null),
    foreground: () => ({ ...st().fg }),
    background: () => ({ ...st().bg }),
    frameCount: () => anim.count(),
    historyCount: () => st().history.length,
  };
}

// The curated `vision` API a sandboxed script may drive. Each entry runs on the
// main thread against the real engine/store; the script itself never gets a raw
// engine handle (or window/fetch/fs — it runs in a Worker, see scriptWorker.ts).
// Nested namespaces (adj, fil, …) are flattened to dotted op paths.
type VisionOp = (...a: never[]) => unknown;
function visionOps(): Record<string, VisionOp> {
  const top: Record<string, VisionOp> = {
    newDoc: ((w: number, h: number, name = "Script") => store.newDocument(w, h, name)) as VisionOp,
    addLayer: (() => store.addLayer()) as VisionOp,
    selectAll: (() => E().select_all()) as VisionOp,
    selectRect: ((x: number, y: number, w: number, h: number, mode = 0) => E().select_rect(x, y, w, h, mode)) as VisionOp,
    // Pointer gestures captured by Allow Tool Recording (#471). Feather and
    // anti-alias are NOT recorded: they replay with the options bar as it stands,
    // the same way a recorded brush step replays with the recorded brush.
    selectEllipse: ((x: number, y: number, w: number, h: number, mode = 0) => E().select_ellipse(x, y, w, h, mode)) as VisionOp,
    selectPolygon: ((xs: Float32Array, ys: Float32Array, mode = 0) =>
      E().select_polygon(Float32Array.from(xs), Float32Array.from(ys), mode)) as VisionOp,
    paintStroke: ((brush: Float32Array, pts: Float32Array) => {
      engine.replayStroke(Array.from(brush), Array.from(pts));
      engine.commit();
    }) as VisionOp,
    deselect: (() => E().select_none()) as VisionOp,
    fill: ((r: number, g: number, b: number, a = 255) => { E().fill_selection(r, g, b, a); engine.commit(); }) as VisionOp,
    setForeground: ((h: number, s: number, v: number, a = 1) => store.setForeground({ h, s, v, a })) as VisionOp,
    addFrame: (() => anim.addFrame()) as VisionOp,
    commit: (() => engine.commit()) as VisionOp,
    log: ((...args: unknown[]) => console.log("[script]", ...args)) as VisionOp,
    // Recorded free-function ops (their action-descriptor paths). Exposed here so
    // every persisted/imported descriptor is replayable through the one allowlist.
    commitGalleryStack: ((stack: GalleryEffect[]) => commitGalleryStack(stack)) as VisionOp,
    commitBlurSteps: ((steps: BlurCommandStep[], paths: Float32Array, rearSync: boolean) =>
      commitBlurSteps(steps, paths, rearSync)) as VisionOp,
    updatePinnedBlurFilter: ((layer: number, index: number, fid: number, params: Float32Array) =>
      smart.updateFilter(layer, index, fid, params)) as VisionOp,
    selectAndMask: ((params: SamParams, output: SamOutput, decontaminate: boolean) =>
      store.selectAndMask(params, new Uint8Array(engine.width * engine.height), output, decontaminate)) as VisionOp,
    contentAwareFill: (() => contentAwareFill()) as VisionOp,
    removeDistractions: ((s = 0.75) => removeDistractions(s)) as VisionOp,
    removeReflections: ((s = 0.65) => removeReflections(s)) as VisionOp,
    frequencySeparation: ((r = 8) => frequencySeparation(r)) as VisionOp,
    contentAwareMoveBy: ((...args: Parameters<typeof contentAwareMoveBy>) => contentAwareMoveBy(...args)) as VisionOp,
    applyPuppetWarp: ((gw: number, gh: number, pins: PuppetPin[]) => applyPuppetWarp(gw, gh, pins)) as VisionOp,
    warpLayer: ((warp: TextWarp) => warpLayer(warp)) as VisionOp,
    adaptiveWideAngle: ((opts: AdaptiveWideOptions) => adaptiveWideAngle(opts)) as VisionOp,
    generativeFill: (() => generativeFill()) as VisionOp,
    // Save / Export commands (recorded free functions; lazy arrows — the
    // recordedCall consts below initialize after the module-load allowlist use).
    saveDocument: (() => saveDocument()) as VisionOp,
    revertDocument: (() => { void revertDocument(); }) as VisionOp,
    saveDocumentAs: (() => saveDocumentAs()) as VisionOp,
    saveAs: ((path: string) => saveAsPath(path)) as VisionOp,
    open: ((path: string) => openPath(path)) as VisionOp,
    exportPNG: ((name?: string) => exportPNG(name)) as VisionOp,
    exportJPEG: ((name?: string, quality?: number) => exportJPEG(name, quality)) as VisionOp,
    exportPSD: ((name?: string) => exportPSD(name)) as VisionOp,
    exportPSB: ((name?: string) => exportPSB(name)) as VisionOp,
    exportAs: ((first?: string, second?: unknown, third?: unknown, fourth?: unknown) => {
      if (typeof first === "string" && isScriptSavePath(first) && (second === undefined || typeof second === "number") && third === undefined) {
        return exportAsPath(first, typeof second === "number" ? second : undefined);
      }
      return exportAs(first as string, second as never, third as never, fourth as never);
    }) as VisionOp,
  };
  // Recorded store/text command ops route through the same wrapped entry
  // points the UI uses, so persisted/imported steps replay identically.
  for (const name of RECORDED_STORE_OPS) top[`store.${name}`] = store[name] as VisionOp;
  for (const name of RECORDED_TEXT_OPS) top[`text.${name}`] = text[name] as VisionOp;
  const ns: Record<string, Record<string, unknown>> = { adj, fil, xform, neural, anim, distort };
  const flat: Record<string, VisionOp> = { ...top };
  for (const [name, obj] of Object.entries(ns))
    for (const [k, fn] of Object.entries(obj))
      if (typeof fn === "function") flat[`${name}.${k}`] = fn as VisionOp;
  return flat;
}

// Run user script code in the sandboxed Worker. The worker records the curated
// ops the script calls and posts them back; we validate each against the
// allowlist and execute it here. A fresh worker per run = a fresh realm with no
// state carried between scripts.
//
// `await vision.read.*` interleaves: the worker posts a "read" message carrying
// the ops it recorded so far, we replay those, evaluate the read against the
// visionReads() allowlist, and post the value back so the script resumes. Both
// allowlists are re-checked HERE — a tampered worker message can name neither an
// op nor a read the app doesn't already expose.
//
// Returns "" on success, "✓ …" with the script's `vision.log` output when it
// logged anything, or an error message.
const SCRIPT_TIMEOUT_MS = 2_000; // idle: how long the worker may go without a message
const SCRIPT_MAX_RUNTIME_MS = 30_000; // total wall clock — a read loop resets the idle timer, this one it can't
const SCRIPT_MAX_LOG_LINES = 64;
type ScriptMsg = {
  kind?: "read";
  ok?: boolean;
  ops?: [string, unknown[]][];
  error?: string;
  id?: number;
  path?: string;
  args?: unknown[];
};
const scriptLogText = (v: unknown): string => {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};
/** Replay ops the script worker recorded. A returned promise is awaited, and
 *  `false` (a save or export that did not write) is a script error. Exported so
 *  a test can drive the same path when the worker cannot start. */
export async function replayScriptOps(
  ops: [string, unknown[]][],
  flat: Record<string, VisionOp> = visionOps(),
  control?: { aborted?: () => string | null; charge?: () => void },
): Promise<void> {
  for (const [path, args] of ops) {
    const stop = control?.aborted?.();
    if (stop) throw new Error(stop);
    // One unit per op, checked before the op runs, so a budget or a timer that
    // fired during the previous op stops the rest of the batch (#531).
    control?.charge?.();
    const fn = flat[path];
    if (!fn) throw new Error(`Disallowed op: ${path}`);
    const result = await fn(...(args as never[]));
    if (result === false) throw new Error(`${path} failed`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function runScript(code: string): Promise<string> {
  const reads = visionReads();
  const logs: string[] = [];
  // `vision.log` is the script's only output channel — mirror it into the
  // console AND buffer it, so the Scripting Console can show what a read found.
  const flat: Record<string, VisionOp> = {
    ...visionOps(),
    log: ((...args: unknown[]) => {
      console.log("[script]", ...args);
      if (logs.length < SCRIPT_MAX_LOG_LINES) logs.push(args.map(scriptLogText).join(" "));
    }) as VisionOp,
  };
  return new Promise<string>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./scriptWorker.ts", import.meta.url), { type: "module" });
    } catch (e) {
      resolve(e instanceof Error ? e.message : String(e));
      return;
    }
    let settled = false;
    let stopReason: string | null = null;
    let executed = 0; // cumulative across flushes — draining for a read can't refill the budget
    let idle: ReturnType<typeof setTimeout>;
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(`Script timed out after ${SCRIPT_TIMEOUT_MS} ms`), SCRIPT_TIMEOUT_MS);
    };
    const total = setTimeout(() => finish(`Script exceeded the ${SCRIPT_MAX_RUNTIME_MS} ms runtime budget`), SCRIPT_MAX_RUNTIME_MS);
    const finish = (msg: string) => {
      if (settled) return;
      stopReason = msg;
      settled = true;
      clearTimeout(idle);
      clearTimeout(total);
      worker.terminate();
      resolve(msg);
    };
    const replay = async (ops: [string, unknown[]][]) => {
      executed += ops.length;
      if (executed > SCRIPT_MAX_OPS) throw new Error(SCRIPT_LIMIT_ERROR);
      for (const [path] of ops) {
        const fn = flat[path];
        if (!fn) throw new Error(`Disallowed op: ${path}`);
      }
      await replayScriptOps(ops, flat, {
        aborted: () => stopReason,
        charge: () => {
          // The batch length above rejects a flush that would cross the cap.
          // Charging again here would double-count a legal flush, so this only
          // re-checks the cap a timer or a later edit might have tightened.
          if (executed > SCRIPT_MAX_OPS) throw new Error(SCRIPT_LIMIT_ERROR);
        },
      });
    };
    const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
    worker.onmessage = (e: MessageEvent<ScriptMsg>) => {
      const data = e.data;
      armIdle(); // the worker made progress
      void (async () => {
        if (data.kind === "read") {
          // Flush the script's pending edits first, so the read observes them.
          // Commit only when something ran — a read loop must not re-composite
          // the document on every question it asks. Await a save/export the
          // script asked for before answering the read.
          try { const ops = data.ops ?? []; await replay(ops); if (ops.length) engine.commit(); }
          catch (err) { finish(errText(err)); return; }
          const read = reads[data.path ?? ""];
          if (!read) { finish(`Disallowed read: ${data.path}`); return; }
          // A read that throws (no open document) or returns something the
          // structured clone rejects is the SCRIPT's error to catch, not a
          // sandbox breach — hand it back and let the run continue.
          try { worker.postMessage({ id: data.id, ok: true, value: read(...((data.args ?? []) as never[])) }); }
          catch (err) { worker.postMessage({ id: data.id, ok: false, error: errText(err) }); }
          return;
        }
        if (!data.ok) { finish(data.error || "Script error"); return; }
        try {
          await replay(data.ops ?? []);
          engine.commit();
          finish(logs.length ? `✓ ${logs.join("\n")}` : "");
        } catch (err) {
          finish(errText(err));
        }
      })();
    };
    worker.onerror = (e) => finish(e.message || "Script worker failed to run");
    armIdle();
    worker.postMessage({ code, ops: Object.keys(flat), reads: Object.keys(reads) });
  });
}

export const smart = {
  convert: (id: number) => {
    // A group header, or several selected layers, become ONE smart object whose
    // contents keep their stack; a lone plain layer keeps the original flat path.
    const e = E() as unknown as { convert_layers_to_smart_object?: (ids: Uint32Array) => boolean };
    const selected = store.state.selectedLayerIds ?? [];
    const ids = selected.includes(id) && selected.length > 1 ? selected : [id];
    const layered = ids.length > 1 || store.state.layers.find((l) => l.id === id)?.kind === LAYER_KIND.groupHeader;
    if (layered && typeof e.convert_layers_to_smart_object === "function") {
      e.convert_layers_to_smart_object(new Uint32Array(ids));
    } else {
      E().convert_to_smart_object(id);
    }
    for (const layerId of ids) deleteSmartLink(store.state.activeDocId, layerId);
    engine.commit();
  },
  /** Layer ▸ Smart Objects ▸ New Smart Object via Copy: give this instance its
   *  own source so edits stop travelling between it and its former siblings. */
  detach: (id: number) => {
    const e = E() as unknown as { detach_smart_object?: (id: number) => boolean };
    if (typeof e.detach_smart_object === "function") e.detach_smart_object(id);
    engine.commit();
  },
  /** The shared-source id, or 0 when this layer is not an instance. */
  sourceId: (id: number): number => {
    const e = E() as unknown as { smart_source_id?: (id: number) => number };
    return typeof e.smart_source_id === "function" ? e.smart_source_id(id) : 0;
  },
  clearFilters: (id: number) => { E().smart_clear_filters(id); engine.commit(); },
  /** Replace one captured smart-filter row without risking a stale row editing
   *  a different filter after a reorder/delete. */
  updateFilter: (id: number, index: number, fid: number, params: Float32Array): boolean => {
    const e = E();
    if (e.layer_kind(id) !== LAYER_KIND.smartObject || e.smart_filter_id(id, index) !== fid) return false;
    const before = e.undo_pushes();
    e.smart_update_filter(id, index, params);
    engine.commit();
    return e.undo_pushes() > before;
  },
  setFiltersEnabled: (id: number, on: boolean) => { E().set_smart_filters_enabled(id, on); engine.commit(); },
  /** Layer ▸ Smart Filter ▸ Delete Filter Mask. */
  deleteFilterMask: (id: number) => { E().delete_smart_filter_mask(id); engine.commit(); },
  /** Whether the filter mask attenuates the stack (Disable Filter Mask). */
  filterMaskEnabled: (id: number): boolean => E().smart_filter_mask_enabled(id),
  setFilterMaskEnabled: (id: number, on: boolean) => { E().set_smart_filter_mask_enabled(id, on); engine.commit(); },
  rasterize: (id: number) => {
    E().rasterize_smart_object(id);
    deleteSmartLink(store.state.activeDocId, id);
    engine.commit();
  },
  resetTransform: (id: number) => { E().reset_smart_object(id); engine.commit(); },
  linkedInfo(id = store.state.activeLayerId, docId = store.state.activeDocId): SmartLinkInfo | null {
    const info = getSmartLink(docId, id);
    if (!info || store.layerKindInDoc(docId, id) !== 7) return null;
    return { ...info };
  },
  linkedObjects(docId = store.state.activeDocId): SmartLinkInfo[] {
    return smartLinkedObjectsForDoc(docId);
  },
  markLinkedMissing(id = store.state.activeLayerId, missing = true, docId = store.state.activeDocId): boolean {
    if (store.layerKindInDoc(docId, id) !== 7 || !markSmartLinkMissing(docId, id, missing)) return false;
    store.markDocDirty(docId);
    if (docId === store.state.activeDocId) store.syncFromEngine();
    return true;
  },
  convertToLinkedFromBytes(bytes: Uint8Array, name: string, path?: string): boolean {
    const id = store.state.activeLayerId;
    try {
      if (E().layer_kind(id) !== LAYER_KIND.smartObject) E().convert_to_smart_object(id);
      E().replace_smart_object(id, bytes);
      const now = Date.now();
      setSmartLink({
        docId: store.state.activeDocId,
        layerId: id,
        name,
        path,
        missing: false,
        linkedAt: now,
        updatedAt: now,
      });
      engine.commit();
      return true;
    } catch (e) {
      reportOpen(name, e);
      return false;
    }
  },
  relinkContentsFromBytes(bytes: Uint8Array, name: string, path?: string): boolean {
    const id = store.state.activeLayerId;
    if (E().layer_kind(id) !== LAYER_KIND.smartObject) return false;
    try {
      E().replace_smart_object(id, bytes);
      const prev = getSmartLink(store.state.activeDocId, id);
      const now = Date.now();
      setSmartLink({
        docId: store.state.activeDocId,
        layerId: id,
        name,
        path,
        missing: false,
        linkedAt: prev?.linkedAt ?? now,
        updatedAt: now,
      });
      engine.commit();
      return true;
    } catch (e) {
      reportOpen(name, e);
      return false;
    }
  },
  replaceContentsFromBytes(bytes: Uint8Array, name: string, path?: string, id = store.state.activeLayerId): boolean {
    if (E().layer_kind(id) !== LAYER_KIND.smartObject) return false;
    try {
      E().replace_smart_object(id, bytes);
      const prev = getSmartLink(store.state.activeDocId, id);
      if (prev) {
        setSmartLink({
          ...prev,
          name,
          path,
          relativePath: undefined,
          missing: false,
          updatedAt: Date.now(),
        });
      }
      engine.commit();
      return true;
    } catch (e) {
      reportOpen(name, e);
      return false;
    }
  },
  updateLinkedContentsFromBytes(bytes: Uint8Array, id = store.state.activeLayerId, docId = store.state.activeDocId): boolean {
    if (store.layerKindInDoc(docId, id) !== 7) return false;
    const prev = getSmartLink(docId, id);
    if (!prev) return false;
    try {
      return store.mutateDocEngine(docId, (docEngine) => {
        if (docEngine.layer_kind(id) !== LAYER_KIND.smartObject) return false;
        docEngine.replace_smart_object(id, bytes);
        setSmartLink({
          ...prev,
          missing: false,
          updatedAt: Date.now(),
        });
        return true;
      });
    } catch (e) {
      reportOpen(prev.name, e);
      return false;
    }
  },
  async updateLinkedContentsFromPath(id = store.state.activeLayerId, docId = store.state.activeDocId): Promise<boolean> {
    if (store.layerKindInDoc(docId, id) !== 7) return false;
    const prev = getSmartLink(docId, id);
    if (!prev?.path) return false;
    try {
      const bytes = await readSmartLinkedSource(prev.path);
      return smart.updateLinkedContentsFromBytes(bytes, id, docId);
    } catch (e) {
      markSmartLinkMissing(docId, id, true);
      store.markDocDirty(docId);
      if (docId === store.state.activeDocId) store.syncFromEngine();
      reportOpen(prev.path, e);
      return false;
    }
  },
  async updateAllLinkedContentsFromPaths(docId = store.state.activeDocId): Promise<number> {
    let count = 0;
    for (const info of smart.linkedObjects(docId)) {
      if (!info.path) continue;
      if (await smart.updateLinkedContentsFromPath(info.layerId, docId)) count++;
    }
    return count;
  },
  async syncLinkedSourceWatchers(): Promise<void> {
    if (!isTauri() && !smartLinkedSourceWatcherForTests) {
      stopSmartLinkedSourceWatchers();
      return;
    }
    const paths = smartWatchPaths();
    const signature = paths.join("\0");
    if (signature === smartLinkedSourceWatchSignature) return;
    smartLinkedSourceWatchSignature = signature;
    smartLinkedSourceWatchRevision++;
    const revision = smartLinkedSourceWatchRevision;
    const wanted = new Set(paths);
    for (const [path, entry] of smartLinkedSourceWatchers) {
      if (wanted.has(path)) continue;
      entry.unwatch?.();
      smartLinkedSourceWatchers.delete(path);
    }
    const starts: Promise<void>[] = [];
    for (const path of paths) {
      if (smartLinkedSourceWatchers.has(path)) continue;
      smartLinkedSourceWatchers.set(path, { revision });
      starts.push((async () => {
        try {
          const unwatch = await watchSmartLinkedSource(path, (event) => handleSmartLinkedSourceWatch(path, event));
          const entry = smartLinkedSourceWatchers.get(path);
          if (!entry || entry.revision !== revision) {
            unwatch();
            return;
          }
          entry.unwatch = unwatch;
        } catch (e) {
          smartLinkedSourceWatchers.delete(path);
          smartLinkedSourceWatchSignature = "";
          markSmartLinkedPathMissing(path);
          console.warn(`Failed to watch linked source ${path}:`, e);
        }
      })());
    }
    await Promise.all(starts);
  },
  stopLinkedSourceWatchers(): void {
    stopSmartLinkedSourceWatchers();
  },
  setLinkedSourceReaderForTests(reader: SmartLinkedSourceReader | null) {
    smartLinkedSourceReaderForTests = reader;
  },
  setLinkedSourceWatcherForTests(watcher: SmartLinkedSourceWatcher | null) {
    stopSmartLinkedSourceWatchers();
    smartLinkedSourceWatcherForTests = watcher;
    void smart.syncLinkedSourceWatchers();
  },
  embedLinked(id = store.state.activeLayerId): boolean {
    if (!deleteSmartLink(store.state.activeDocId, id)) return false;
    store.markDirty();
    store.syncFromEngine();
    return true;
  },
  embedAllLinked(): number {
    const docId = store.state.activeDocId;
    let count = 0;
    for (const info of listSmartLinks(docId)) {
      if (deleteSmartLink(info.docId, info.layerId)) {
        count++;
      }
    }
    if (count) {
      store.markDirty();
      store.syncFromEngine();
    }
    return count;
  },
  convertToLinked() {
    const id = store.state.activeLayerId;
    if (E().layer_kind(id) !== LAYER_KIND.smartObject && E().layer_kind(id) !== LAYER_KIND.pixel) return;
    if (isTauri()) {
      void (async () => {
        const picked = await pickSmartLinkedSourceFile();
        if (picked) smart.convertToLinkedFromBytes(picked.bytes, picked.name, picked.path);
      })();
      return;
    }
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = SMART_LINK_ACCEPT;
    inp.onchange = async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (!f) return;
      try {
        smart.convertToLinkedFromBytes(await readBrowserImageFile(f, "place"), f.name);
      } catch (e) {
        reportOpen(f.name, e);
      }
    };
    inp.oncancel = () => inp.remove();
    document.body.appendChild(inp);
    inp.click();
  },
  relinkContents() {
    const id = store.state.activeLayerId;
    if (E().layer_kind(id) !== LAYER_KIND.smartObject) return;
    if (isTauri()) {
      void (async () => {
        const picked = await pickSmartLinkedSourceFile();
        if (picked) smart.relinkContentsFromBytes(picked.bytes, picked.name, picked.path);
      })();
      return;
    }
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = SMART_LINK_ACCEPT;
    inp.onchange = async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (!f) return;
      try {
        smart.relinkContentsFromBytes(await readBrowserImageFile(f, "place"), f.name);
      } catch (e) {
        reportOpen(f.name, e);
      }
    };
    inp.oncancel = () => inp.remove();
    document.body.appendChild(inp);
    inp.click();
  },
  updateLinkedContents() {
    const id = store.state.activeLayerId;
    const link = getSmartLink(store.state.activeDocId, id);
    if (E().layer_kind(id) !== LAYER_KIND.smartObject || !link) return;
    if (link.path) {
      void smart.updateLinkedContentsFromPath(id);
      return;
    }
    if (isTauri()) {
      void (async () => {
        const picked = await pickSmartLinkedSourceFile();
        if (picked) smart.updateLinkedContentsFromBytes(picked.bytes, id);
      })();
      return;
    }
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = SMART_LINK_ACCEPT;
    inp.onchange = async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (!f) return;
      try {
        smart.updateLinkedContentsFromBytes(await readBrowserImageFile(f, "place"), id);
      } catch (e) {
        reportOpen(f.name, e);
      }
    };
    inp.oncancel = () => inp.remove();
    document.body.appendChild(inp);
    inp.click();
  },
  /** Layer ▸ Smart Objects ▸ Edit Contents: open the active embedded source in
   *  a separate document tab and remember where it should update back to. */
  editContents(): number | null {
    const parentLayerId = store.state.activeLayerId;
    if (E().layer_kind(parentLayerId) !== LAYER_KIND.smartObject) return null;
    const parentDocId = store.state.activeDocId;
    const base = (store.activeName() || "smart-object").replace(/\.[^.]+$/, "");
    // Layered contents reopen as the real document, stack intact — including a
    // PSD/PSB an imported Smart Object embeds, which the engine decodes here; a
    // flat source still opens as the single rendered PNG it has always been.
    const e = E() as unknown as { smart_object_document?: (id: number) => Uint8Array };
    const doc = typeof e.smart_object_document === "function" ? e.smart_object_document(parentLayerId) : new Uint8Array();
    // An embedded document that cannot be decoded, or that is edited in another
    // mode (a CMYK one opens as RGB), says so before its tab opens.
    engine.consumeEditError();
    if (doc.length) {
      const name = `${base}-smart-contents.mvision`;
      store.openProject(new Uint8Array(doc), name);
      const editDocId = store.state.activeDocId;
      setSmartEditBinding({ editDocId, parentDocId, parentLayerId, name, layered: true });
      return editDocId;
    }
    const bytes = E().export_smart_object_png(parentLayerId);
    if (!bytes.length) return null;
    const name = `${base}-smart-contents.png`;
    store.openImage(bytes, name);
    const editDocId = store.state.activeDocId;
    setSmartEditBinding({ editDocId, parentDocId, parentLayerId, name });
    return editDocId;
  },
  /** Commit the active edited-contents document back into its parent smart
   *  object. This stands in for Photoshop's embedded-PSB save workflow. */
  updateEditedContents(): boolean {
    const editDocId = store.state.activeDocId;
    const binding = getSmartEditBinding(editDocId);
    if (!binding) return false;
    assertHistorySettled(E());
    const bytes = binding.layered ? new Uint8Array() : E().export_png();
    const projectBytes = binding.layered ? new Uint8Array(E().save_project()) : new Uint8Array();
    store.activateDoc(binding.parentDocId);
    if (store.state.activeDocId !== binding.parentDocId) {
      store.activateDoc(editDocId);
      return false;
    }
    if (E().layer_kind(binding.parentLayerId) !== LAYER_KIND.smartObject) {
      store.activateDoc(editDocId);
      return false;
    }
    const e = E() as unknown as { replace_smart_object_document?: (id: number, b: Uint8Array) => boolean };
    if (binding.layered && typeof e.replace_smart_object_document === "function") {
      // The contents are a document, so they commit back as one — keeping the
      // layer stack rather than flattening it into the parent. A refusal says
      // why and leaves the contents tab open to fix.
      if (!e.replace_smart_object_document(binding.parentLayerId, projectBytes)) {
        if (!engine.consumeEditError()) notify("Could not update the Smart Object with these contents.");
        store.activateDoc(editDocId);
        return false;
      }
    } else {
      E().replace_smart_object_preserve_placement(binding.parentLayerId, bytes);
    }
    engine.commit();
    return true;
  },
  /** File ▸ Save while editing Smart Object contents updates the parent instead
   *  of downloading/saving the temporary source tab, matching embedded PSB save
   *  semantics. */
  saveEditedContents(): boolean {
    const editDocId = store.state.activeDocId;
    const updated = smart.updateEditedContents();
    if (updated) store.markDocSaved(editDocId);
    return updated;
  },
  editedContentsBinding(): SmartEditBinding | null {
    return getSmartEditBinding(store.state.activeDocId);
  },
  editedContentsBindingForDoc(docId: number): SmartEditBinding | null {
    return getSmartEditBinding(docId);
  },
  forgetEditedContentsDoc(docId: number) {
    deleteSmartEditBinding(docId);
  },
  saveEditedContentsDoc(docId: number): boolean {
    const binding = getSmartEditBinding(docId);
    if (!binding) return false;
    store.activateDoc(docId);
    return smart.saveEditedContents();
  },
  /** Layer ▸ Smart Objects ▸ Replace Contents: pick an image and swap it into
   *  the active smart object's source (re-running its filter stack). */
  replaceContents() {
    const id = store.state.activeLayerId;
    if (E().layer_kind(id) !== LAYER_KIND.smartObject) return;
    if (isTauri()) {
      void (async () => {
        const picked = await pickSmartLinkedSourceFile();
        if (picked) smart.replaceContentsFromBytes(picked.bytes, picked.name, picked.path, id);
      })();
      return;
    }
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = SMART_LINK_ACCEPT;
    inp.onchange = async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (!f) return;
      try {
        smart.replaceContentsFromBytes(await readBrowserImageFile(f, "place"), f.name, undefined, id);
      } catch (e) {
        reportOpen(f.name, e);
      }
    };
    inp.oncancel = () => inp.remove();
    document.body.appendChild(inp);
    inp.click();
  },
  /** Layer ▸ Smart Objects ▸ Export Contents: save the active smart object's
   *  raw embedded source (pre-filter) as a PNG. */
  exportContents() {
    const id = store.state.activeLayerId;
    if (E().layer_kind(id) !== LAYER_KIND.smartObject) return;
    const bytes = E().export_smart_object_png(id);
    if (!bytes.length) return;
    const base = (store.activeName() || "smart-object").replace(/\.[^.]+$/, "");
    saveBytes(`${base}-contents.png`, bytes, "image/png");
  },
};

store.subscribe(() => { void smart.syncLinkedSourceWatchers(); });

// ── Type / text layers ─────────────────────────────────────────
// The full re-editable type model lives in src/text (spec + Canvas2D
// rasterizer + warp). The engine stores the rendered pixels plus the spec
// JSON opaquely (`set_text_layer_spec`/`layer_text_spec`) so type survives
// project saves and stays editable. The UI and e2e both drive type through
// this single `text` action object.
export interface TextTarget { mode: "create" | "edit"; id: number; ax: number; ay: number; }

function applyTextSpec(id: number, spec: TextSpec): void {
  const r = rasterizeSpec(spec);
  const bytes = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  const dirty = E().set_text_layer_spec(id, r.placeX, r.placeY, r.w, r.h, bytes, JSON.stringify(spec));
  // A coalesced live re-apply returns just the region it cleared + repainted;
  // the full-canvas commit path stays for the first apply / non-session edits.
  if (dirty && dirty[2] > 0 && dirty[3] > 0) engine.commitRegion(dirty[0], dirty[1], dirty[2], dirty[3]);
  else engine.commit();
}
// Type ▸ Save/Load Default Type Styles: persist the character/paragraph defaults
// in localStorage so new type layers (and Load) adopt them across sessions.
const TYPE_STYLE_KEY = "mv.defaultTypeStyle";
function readDefaultTypeStyle(): Partial<TextSpec> | null {
  try { const s = localStorage.getItem(TYPE_STYLE_KEY); return s ? (JSON.parse(s) as Partial<TextSpec>) : null; }
  catch { return null; }
}
function writeDefaultTypeStyle(style: Partial<TextSpec>): boolean {
  return store.persistAuthoredContent(TYPE_STYLE_KEY, JSON.stringify(style), "default type styles");
}
// The layer-level (non-positional, non-content) defaults that make up a "style".
function styleFields(s: TextSpec): Partial<TextSpec> {
  const {
    font, size, color, bold, italic, tracking, kerning, leading, hScale, vScale,
    align, direction, composer, antialias, digits, kashida, diacriticX, diacriticY,
  } = s;
  return {
    font, size, color, bold, italic, tracking, kerning, leading, hScale, vScale,
    align, direction, composer, antialias, digits, kashida, diacriticX, diacriticY,
  };
}
// Character vs paragraph subsets, for named Type ▸ Panels ▸ … Styles.
function charStyleFields(s: TextSpec): Partial<TextSpec> {
  const { font, size, color, bold, italic, tracking, kerning, hScale, vScale, antialias, digits, diacriticX, diacriticY } = s;
  return { font, size, color, bold, italic, tracking, kerning, hScale, vScale, antialias, digits, diacriticX, diacriticY };
}
function paraStyleFields(s: TextSpec): Partial<TextSpec> {
  // Hyphenation, justification, the line composer and hanging punctuation are
  // paragraph-style attributes in Photoshop; leaving them out meant a saved
  // Paragraph Style silently dropped them and applying it restored only the
  // indents and alignment.
  const {
    align, direction, composer, leading, firstIndent, leftIndent, rightIndent, spaceBefore, spaceAfter, kashida,
    hyphenate, hyphenation, justification, lineComposer, hangingPunctuation,
  } = s;
  return {
    align, direction, composer, leading, firstIndent, leftIndent, rightIndent, spaceBefore, spaceAfter, kashida,
    hyphenate, hyphenation, justification, lineComposer, hangingPunctuation,
  };
}
// `basedOn` is Photoshop's style inheritance: a child stores only the fields it
// *differs* from its parent in, so editing the parent flows down to it (and to
// every layer linked to it). `next` is Next Style — the style the following
// paragraph starts in.
type NamedStyle = { name: string; fields: Partial<TextSpec>; basedOn?: string; next?: string };
// A type layer stays LINKED to the named style applied to it: the style name
// rides along in the layer's own spec JSON, so the link survives undo, project
// save/load and duplication without anything else having to carry it. Fields
// that drift from the definition afterwards are overrides (Photoshop's "+"
// badge); redefining a style re-renders every layer still linked to it.
// ponytail: the style *definitions* are still app-global (localStorage), not
// per-document. Moving them into the document needs a DocumentMeta slot + a
// project-envelope field in store.ts, which this change does not own.
type LinkedSpec = TextSpec & { charStyle?: string; paraStyle?: string };
const STYLE_LINK_KEY = { char: "charStyle", para: "paraStyle" } as const;
/** Link (or, with no name, unlink) a spec — an undefined link drops out of the
 *  stored JSON, so an unlinked layer is byte-identical to a pre-styles one. */
function withStyleLink(s: TextSpec, kind: "char" | "para", name?: string): LinkedSpec {
  return kind === "char" ? { ...s, charStyle: name } : { ...s, paraStyle: name };
}
function styleFieldsOf(kind: "char" | "para", s: TextSpec): Partial<TextSpec> {
  return kind === "char" ? charStyleFields(s) : paraStyleFields(s);
}
/** The names of `fields` whose value on `s` no longer matches the definition. */
function overriddenFields(s: TextSpec, fields: Partial<TextSpec>): string[] {
  const have = s as unknown as Record<string, unknown>;
  const want = fields as Record<string, unknown>;
  return Object.keys(want).filter((k) => JSON.stringify(have[k]) !== JSON.stringify(want[k]));
}
/** The fields a style actually renders with: its own on top of everything it
 *  inherits through `basedOn`. `seen` guards a corrupt/cyclic chain — a bad
 *  localStorage payload must not hang the panel. */
function resolveStyleFields(list: NamedStyle[], name: string, seen = new Set<string>()): Partial<TextSpec> {
  const def = list.find((x) => x.name === name);
  if (!def || seen.has(name)) return {};
  seen.add(name);
  return def.basedOn ? { ...resolveStyleFields(list, def.basedOn, seen), ...def.fields } : def.fields;
}
/** What a child stores: only what it differs from its parent in, so a parent
 *  edit reaches it. Parentless styles store the capture whole. */
function deltaFields(list: NamedStyle[], basedOn: string | undefined, fields: Partial<TextSpec>): Partial<TextSpec> {
  if (!basedOn) return fields;
  const parent = resolveStyleFields(list, basedOn) as Record<string, unknown>;
  const own = fields as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(own).filter((k) => JSON.stringify(own[k]) !== JSON.stringify(parent[k])).map((k) => [k, own[k]]),
  ) as Partial<TextSpec>;
}
/** A style plus every style that inherits from it, directly or not — the set a
 *  redefine has to re-render, and the set Based On may not point into. */
function styleFamily(list: NamedStyle[], name: string): string[] {
  const out = [name];
  for (let i = 0; i < out.length; i++) {
    for (const s of list) if (s.basedOn === out[i] && !out.includes(s.name)) out.push(s.name);
  }
  return out;
}
/** Re-render every layer linked to one of `names` from its re-resolved style. */
function restyleLinked(kind: "char" | "para", list: NamedStyle[], names: string[]) {
  for (const l of store.state.layers) {
    const spec = getTextSpec(l.id) as LinkedSpec | null;
    const link = spec?.[STYLE_LINK_KEY[kind]];
    if (spec && link && names.includes(link)) applyTextSpec(l.id, { ...spec, ...resolveStyleFields(list, link) });
  }
}
/** Next Style: what a new type layer inherits from the one that was active —
 *  the `next` of the styles that layer is linked to, applied *and* linked.
 *  ponytail: one spec carries one paragraph style, so Next Style advances at
 *  layer boundaries rather than at Enter; per-paragraph styles would need a
 *  paragraph model in src/text/spec first. */
function nextStyleSeed(): Partial<LinkedSpec> {
  const prev = getTextSpec(store.state.activeLayerId) as LinkedSpec | null;
  if (!prev) return {};
  const all = readTypeStyles();
  let seed: Partial<LinkedSpec> = {};
  for (const kind of ["char", "para"] as const) {
    const list = all[kind] ?? [];
    const link = prev[STYLE_LINK_KEY[kind]];
    const next = link ? list.find((x) => x.name === link)?.next : undefined;
    if (next && list.some((x) => x.name === next)) {
      seed = { ...seed, ...resolveStyleFields(list, next), [STYLE_LINK_KEY[kind]]: next };
    }
  }
  return seed;
}
function readTypeStyles(): { char: NamedStyle[]; para: NamedStyle[] } {
  try { const s = localStorage.getItem("mv.typeStyles"); if (s) return JSON.parse(s); } catch { /* ignore */ }
  return { char: [], para: [] };
}
function writeTypeStyles(all: { char: NamedStyle[]; para: NamedStyle[] }): boolean {
  return store.persistAuthoredContent("mv.typeStyles", JSON.stringify(all), "named type styles");
}
function createTextLayer(spec: TextSpec, seed: Partial<LinkedSpec> = {}): number {
  // New text adopts any saved default style (keeping its own position + runs);
  // an explicit seed (Next Style) outranks the saved default.
  const d = readDefaultTypeStyle();
  const seeded = { ...(d ? { ...spec, ...d, ax: spec.ax, ay: spec.ay, runs: spec.runs } : spec), ...seed };
  const names = new Set(store.state.layers.map((layer) => layer.name));
  let n = 1;
  while (names.has(`Text Layer ${n}`)) n++;
  store.addLayer();
  const id = store.state.activeLayerId;
  E().set_layer_name_untracked(id, `Text Layer ${n}`);
  applyTextSpec(id, seeded);
  return id;
}
function getTextSpecFrom(eng: ReturnType<typeof E>, id: number): TextSpec | null {
  const s = eng.layer_text_spec(id);
  if (!s) return null;
  try { return JSON.parse(s) as TextSpec; } catch { return null; }
}
function getTextSpec(id: number): TextSpec | null {
  return getTextSpecFrom(E(), id);
}

/** The on-canvas text editor's caret range, or null when it isn't open.
 *  ponytail: read straight off the overlay textarea — that DOM node is the only
 *  place the caret lives today, and it keeps its selection while a panel button
 *  takes focus. Panels.tsx has the same four lines privately; fold it onto this
 *  export when that file is next touched. */
export function typeEditorSelection(): [number, number] | null {
  const el = typeof document === "undefined" ? null
    : document.querySelector<HTMLTextAreaElement>("textarea.mv-text-edit");
  if (!el) return null;
  return [el.selectionStart ?? 0, el.selectionEnd ?? 0];
}

/** Collapse the on-canvas editor's caret to `at`. An out-of-band insert leaves
 *  the textarea's selection on the old offsets, so a second glyph would land in
 *  front of the first ("®©"); Photoshop leaves the caret after what it just
 *  inserted. React restores the focused element's selection across the
 *  re-render, so setting it before the store update sticks. */
function setTypeEditorCaret(at: number) {
  const el = typeof document === "undefined" ? null
    : document.querySelector<HTMLTextAreaElement>("textarea.mv-text-edit");
  el?.setSelectionRange?.(at, at);
}

export const text = {
  // pure model helpers (re-exported so the UI and e2e share one source of truth)
  defaultSpec, setText, fullText, applyRangeFormat, mergeRuns, resolveStyle, rasterizeSpec,
  FONTS, WARP_STYLES, ANTIALIAS, ANTIALIAS_LABELS, KERNING, KERNING_LABELS, ALIGNMENTS, DIRECTIONS, COMPOSERS, KASHIDAS, PATH_ALIGNS,
  hyphenationOf, justificationOf, LINE_COMPOSERS,
  // The Type dialog reads this on open to know whether to create or re-edit.
  pending: null as TextTarget | null,
  /** Create a new type layer from a spec; returns the new layer id. */
  create: createTextLayer,
  /** Create a new type layer at (ax,ay) with the current FG colour + a
   *  sensible default size; returns its id. The new layer becomes active,
   *  so the docked Type toolbar appears automatically (no modal). */
  createAt(ax: number, ay: number, extra: Partial<TextSpec> = {}): number {
    // Open the edit session before the first apply so the placeholder render
    // and the subsequent typing fold into a single undo step. `extra` carries
    // tool-specific spec overrides (e.g. the Vertical Type tool sets vertical).
    E().text_edit_session(true);
    const [r, g, b] = hsvToRgba(store.state.fg);
    const id = createTextLayer(defaultSpec("Type", {
      ax, ay,
      color: [r, g, b, 255],
      size: Math.max(24, Math.round(store.state.brush.size * 2)),
      ...extra,
    }), nextStyleSeed());
    // Vertical type is edited through the Type toolbar: the on-canvas editor
    // lays out a horizontal block, so opening it here put up a caret that never
    // rendered and swallowed nothing — keystrokes fell through to the global
    // tool shortcuts. editText refuses for the same reason (#500). Close the
    // coalescing session instead, so the placeholder render is its own step.
    if (extra.vertical) {
      E().text_edit_session(false);
      return id;
    }
    // Open the on-canvas editor right away so you can type in place.
    store.beginTextEdit(id, true);
    return id;
  },
  /** (Re-)render a spec into an existing layer (used for live edit + preview). */
  apply: applyTextSpec,
  /** Parse the stored spec for a layer, or null if it isn't a live type layer. */
  get: getTextSpec,
  /** Rasterize Type: drop the live model, keep the rendered pixels. */
  rasterizeLayer: (id: number) => { store.endTextEdit(); E().rasterize_text_layer(id); engine.commit(); },
  /** Type ▸ Anti-Alias ▸ <mode>: set the active type layer's anti-alias mode. */
  setAntialias(mode: string) {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (s) applyTextSpec(id, { ...s, antialias: mode as TextSpec["antialias"] });
  },
  /** Type ▸ Orientation ▸ Horizontal/Vertical: re-orient the active type layer. */
  setOrientation(vertical: boolean) {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (s) applyTextSpec(id, { ...s, vertical });
  },
  /** Type ▸ Paste Lorem Ipsum: fill the active type layer with placeholder text. */
  pasteLorem() {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (s) applyTextSpec(id, setText(s, "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."));
  },
  /** Type ▸ Update All Text Layers: re-render every type layer from its spec. */
  updateAll() {
    for (const l of store.state.layers) {
      const s = getTextSpec(l.id);
      if (s) applyTextSpec(l.id, s);
    }
  },
  /** Type ▸ Text on Path: create a type layer whose glyphs ride the current Pen
   *  path (draw a path with the Pen tool first). No-op without a path. */
  textOnPath() {
    const p = store.state.penPath;
    if (p.length < 4) return;
    const [r, g, b] = hsvToRgba(store.state.fg);
    createTextLayer(defaultSpec("Text on a path", { path: p.slice(), color: [r, g, b, 255], ax: p[0], ay: p[1], size: 32 }));
    store.setPenPath([]);
  },
  /** Type ▸ Text on Path ▸ Bind to Work Path: move the *active* type layer onto
   *  the current Pen path, keeping its text and on-path options. This is what
   *  makes the binding re-editable — Text on Path is no longer one-shot.
   *  No-op without a work path or an active type layer. */
  bindToPath() {
    const p = store.state.penPath;
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (p.length < 4 || !s) return;
    applyTextSpec(id, { ...s, path: p.slice(), ax: p[0], ay: p[1] });
    store.setPenPath([]);
  },
  /** Type ▸ Type on a Path Options: patch the active on-path type layer's
   *  start/end brackets, flip, align-to-path and spacing. No-op on type that
   *  isn't bound to a path. */
  setOnPathOptions(patch: Partial<Pick<TextSpec, "pathStart" | "pathEnd" | "pathFlip" | "pathAlign" | "pathSpacing">>) {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (!s?.path || s.path.length < 4) return;
    applyTextSpec(id, { ...s, ...patch });
  },
  /** Type ▸ OpenType: toggle any OpenType feature on the active type layer. The
   *  four legacy tags (liga/dlig/frac/ordn) flip their dedicated boolean
   *  (precomposed-glyph substitution + font-feature-settings); every other tag
   *  (ss01–ss20, swsh, salt, calt, onum, titl, jalt) flips spec.features[tag],
   *  applied to editable type via canvas font-feature-settings (see raster.ts). */
  toggleFeature(tag: string) {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (!s) return;
    if (tag === "liga" || tag === "dlig" || tag === "frac" || tag === "ordn") {
      applyTextSpec(id, { ...s, [tag]: !s[tag] });
      return;
    }
    const features = { ...(s.features ?? {}) };
    if (features[tag]) delete features[tag]; else features[tag] = true;
    applyTextSpec(id, { ...s, features });
  },
  /** Type ▸ Glyphs: insert a glyph at the type cursor (replacing the selection),
   *  falling back to the end of the layer when no on-canvas editor is open. */
  insertGlyph(ch: string, features?: Record<string, boolean>) {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (!s) return;
    const range = typeEditorSelection();
    applyTextSpec(id, insertGlyph(s, ch, range, features));
    if (range) {
      // Same clamp insertGlyph splices at, so the caret follows the character
      // even when the editor reports a stale out-of-range selection.
      const at = Math.max(0, Math.min(fullText(s).length, Math.min(range[0], range[1])));
      setTypeEditorCaret(at + ch.length);
    }
  },
  /** Type ▸ Save Default Type Styles: persist the active type layer's character/
   *  paragraph defaults so new type layers adopt them (across sessions). */
  saveDefaultStyles() {
    const s = getTextSpec(store.state.activeLayerId);
    if (s) writeDefaultTypeStyle(styleFields(s));
  },
  /** Type ▸ Load Default Type Styles: apply the saved default style to the active
   *  type layer (new layers already pick it up via createTextLayer). */
  loadDefaultStyles() {
    const d = readDefaultTypeStyle();
    if (!d) return;
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (s) applyTextSpec(id, { ...s, ...d });
  },
  /** Type ▸ Panels ▸ Character/Paragraph Styles: list the saved named styles. */
  typeStyles(kind: "char" | "para"): NamedStyle[] {
    return readTypeStyles()[kind] ?? [];
  },
  /** New Style from Selection: capture the active type layer's character (or
   *  paragraph) attributes as a named style (replacing any same-named one) and
   *  link that layer to it, the way Photoshop links the text it was made from.
   *  With `basedOn`, only the drift from that parent is stored. */
  addTypeStyle(kind: "char" | "para", name: string, basedOn?: string) {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    const nm = name.trim();
    if (!s || !nm) return;
    const all = readTypeStyles();
    const list = all[kind] ?? [];
    const parent = basedOn && basedOn !== nm && list.some((x) => x.name === basedOn) ? basedOn : undefined;
    all[kind] = [...list.filter((x) => x.name !== nm),
      { name: nm, basedOn: parent, fields: deltaFields(list, parent, styleFieldsOf(kind, s)) }];
    writeTypeStyles(all);
    applyTextSpec(id, withStyleLink(s, kind, nm));
  },
  /** Apply a named style to the active type layer and link the layer to it, so
   *  later edits read as overrides and a redefine reaches this layer. Unknown
   *  names are a no-op. */
  applyTypeStyle(kind: "char" | "para", name: string) {
    const list = readTypeStyles()[kind] ?? [];
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (!list.some((x) => x.name === name) || !s) return;
    applyTextSpec(id, withStyleLink({ ...s, ...resolveStyleFields(list, name) }, kind, name));
  },
  /** Style Options ▸ Based On: re-parent a style. The style keeps looking the
   *  way it does now (its resolved fields become the delta from the new
   *  parent); afterwards the parent's edits flow into it. A parent inside the
   *  style's own family, or a missing one, clears the link instead of building
   *  a chain that never resolves. */
  setTypeStyleBasedOn(kind: "char" | "para", name: string, basedOn?: string) {
    const all = readTypeStyles();
    const list = all[kind] ?? [];
    if (!list.some((x) => x.name === name)) return;
    const family = styleFamily(list, name);
    const parent = basedOn && list.some((x) => x.name === basedOn) && !family.includes(basedOn) ? basedOn : undefined;
    const resolved = resolveStyleFields(list, name);
    all[kind] = list.map((x) => (x.name === name ? { ...x, basedOn: parent, fields: deltaFields(list, parent, resolved) } : x));
    writeTypeStyles(all);
    restyleLinked(kind, all[kind], family);
  },
  /** Style Options ▸ Next Style: the style a type layer created after one using
   *  `name` starts in. An unknown target clears it. */
  setTypeStyleNext(kind: "char" | "para", name: string, next?: string) {
    const all = readTypeStyles();
    const list = all[kind] ?? [];
    if (!list.some((x) => x.name === name)) return;
    const target = next && list.some((x) => x.name === next) ? next : undefined;
    all[kind] = list.map((x) => (x.name === name ? { ...x, next: target } : x));
    writeTypeStyles(all);
  },
  /** The styles `name` may legally be based on — everything outside its own
   *  family, so the panel can't offer a cycle. */
  typeStyleBasedOnChoices(kind: "char" | "para", name: string): string[] {
    const list = readTypeStyles()[kind] ?? [];
    const family = styleFamily(list, name);
    return list.filter((x) => !family.includes(x.name)).map((x) => x.name);
  },
  /** The style a type layer is linked to plus the fields it has since
   *  overridden — what the panel's name + "+" badge is drawn from. `null` when
   *  the layer isn't type, isn't linked, or its style no longer exists. */
  typeStyleLink(kind: "char" | "para", id = store.state.activeLayerId): { name: string; overrides: string[] } | null {
    const s = getTextSpec(id) as LinkedSpec | null;
    const name = s?.[STYLE_LINK_KEY[kind]];
    if (!s || !name) return null;
    const list = readTypeStyles()[kind] ?? [];
    return list.some((x) => x.name === name)
      ? { name, overrides: overriddenFields(s, resolveStyleFields(list, name)) }
      : null;
  },
  /** Redefine Style: overwrite the definition with the active layer's current
   *  attributes, then re-render every layer linked to it *or to a style that
   *  inherits from it* — this is what makes the styles live instead of a
   *  one-shot copy. */
  redefineTypeStyle(kind: "char" | "para", name: string) {
    const s = getTextSpec(store.state.activeLayerId);
    if (!s) return;
    const all = readTypeStyles();
    const list = all[kind] ?? [];
    const def = list.find((x) => x.name === name);
    if (!def) return;
    all[kind] = list.map((x) => (x.name === name ? { ...x, fields: deltaFields(list, x.basedOn, styleFieldsOf(kind, s)) } : x));
    writeTypeStyles(all);
    restyleLinked(kind, all[kind], styleFamily(all[kind], name));
  },
  /** Clear Override / Reapply Style: push the linked definition back onto the
   *  active layer, discarding the drift. */
  clearTypeStyleOverride(kind: "char" | "para") {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id) as LinkedSpec | null;
    const name = s?.[STYLE_LINK_KEY[kind]];
    const list = readTypeStyles()[kind] ?? [];
    if (s && name && list.some((x) => x.name === name)) applyTextSpec(id, { ...s, ...resolveStyleFields(list, name) });
  },
  /** Remove a named style, unlinking (but not restyling) the layers using it —
   *  a dangling link would show a style name the panel no longer lists. Its
   *  children are flattened onto what they resolve to today, so losing a parent
   *  never silently restyles them. */
  deleteTypeStyle(kind: "char" | "para", name: string) {
    const all = readTypeStyles();
    const list = all[kind] ?? [];
    all[kind] = list.filter((x) => x.name !== name).map((x) => ({
      ...x,
      ...(x.basedOn === name ? { basedOn: undefined, fields: resolveStyleFields(list, x.name) } : {}),
      ...(x.next === name ? { next: undefined } : {}),
    }));
    writeTypeStyles(all);
    for (const l of store.state.layers) {
      const spec = getTextSpec(l.id) as LinkedSpec | null;
      if (spec?.[STYLE_LINK_KEY[kind]] === name) applyTextSpec(l.id, withStyleLink(spec, kind));
    }
  },
  /** Type ▸ Language Options ▸ Use … Digits: substitute the active type layer's
   *  ASCII digits with Latin / Arabic-Indic / Eastern-Arabic ("Hindi") glyphs. */
  setDigits(mode: "latin" | "arabic" | "hindi") {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (s) applyTextSpec(id, { ...s, digits: mode });
  },
  /** Type ▸ Language Options ▸ Kashidas: choose Arabic tatweel insertion. */
  setKashida(mode: NonNullable<TextSpec["kashida"]>) {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (s) applyTextSpec(id, { ...s, kashida: mode });
  },
  /** Type ▸ Middle Eastern Features: position Arabic combining marks. */
  setDiacriticOffset(x: number, y: number) {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (s) applyTextSpec(id, { ...s, diacriticX: x, diacriticY: y });
  },
  /** Type ▸ Language Options ▸ text direction: choose the paragraph base
   *  direction used by line layout and the platform Canvas shaper. */
  setDirection(direction: TextSpec["direction"]) {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (s) applyTextSpec(id, { ...s, direction });
  },
  /** Type ▸ Language Options ▸ Composer: Latin keeps legacy logical fallback
   *  layout; World-Ready applies a simple Unicode-bidi run order baseline. */
  setComposer(composer: NonNullable<TextSpec["composer"]>) {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (s) applyTextSpec(id, { ...s, composer });
  },
  /** Type ▸ Language Options ▸ East Asian Features: toggle CJK composition on
   *  the active type layer. Off deletes the key, so the spec reads (and exports)
   *  like one saved before the feature existed. */
  toggleEastAsian() {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (!s) return;
    const { eastAsian, ...rest } = s;
    applyTextSpec(id, eastAsian ? rest : { ...rest, eastAsian: true });
  },
  /** Type ▸ Convert to Paragraph Text / Point Text: toggle the active type layer
   *  between point and paragraph (box) text. Converting to paragraph seeds the
   *  box width from the point text's natural rendered width. */
  toggleParagraph() {
    const id = store.state.activeLayerId;
    const s = getTextSpec(id);
    if (!s) return;
    if (s.kind === "point") {
      const r = rasterizeSpec(s);
      applyTextSpec(id, { ...s, kind: "paragraph", boxW: Math.max(32, r.w + 8), boxH: 0 });
    } else {
      applyTextSpec(id, { ...s, kind: "point" });
    }
  },
  /** Type ▸ Replace All Missing Fonts: any type layer (or run) referencing a font
   *  this build doesn't ship falls back to the default family, so imported PSDs
   *  with unavailable fonts still render. */
  replaceMissingFonts() {
    const known = new Set(FONTS.map(fontFamilyKey));
    const fix = (f: string) => (known.has(fontFamilyKey(f)) ? f : FONTS[0]);
    for (const l of store.state.layers) {
      const s = getTextSpec(l.id);
      if (!s) continue;
      const runs = s.runs.map((run) => (run.font && !known.has(fontFamilyKey(run.font)) ? { ...run, font: FONTS[0] } : run));
      const next = { ...s, font: fix(s.font), runs };
      if (next.font !== s.font || runs.some((r, i) => r !== s.runs[i])) applyTextSpec(l.id, next);
    }
  },
  /** Edit ▸ Find and Replace Text: replace occurrences of `find` with `replace`
   *  across the active type layer (or every type layer). Returns the number of
   *  replacements made. Changed layers re-flow with their default character
   *  formatting (per-run rich formatting on replaced spans is not preserved). */
  findReplace(find: string, replace: string, opts: { caseSensitive?: boolean; allLayers?: boolean } = {}): number {
    if (!find) return 0;
    const ids = opts.allLayers ? store.state.layers.map((l) => l.id) : [store.state.activeLayerId];
    const esc = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(esc, opts.caseSensitive ? "g" : "gi");
    let count = 0;
    for (const id of ids) {
      const s = getTextSpec(id);
      if (!s) continue;
      let n = 0;
      const after = fullText(s).replace(re, () => { n++; return replace; });
      if (n > 0) { applyTextSpec(id, setText(s, after)); count += n; }
    }
    return count;
  },
};

// Type commands record like Photoshop's type steps: wrap the mutating entries
// on the live `text` namespace (pure helpers, reads and preset management stay
// unwrapped). `apply` coalesces so a live edit session (per-keystroke applies
// from the on-canvas editor / Type dialog) records one final set-text step.
const RECORDED_TEXT_OPS = [
  "create", "createAt", "apply", "rasterizeLayer", "setAntialias", "setOrientation", "pasteLorem",
  "updateAll", "textOnPath", "bindToPath", "setOnPathOptions", "toggleFeature", "insertGlyph", "loadDefaultStyles",
  "applyTypeStyle", "addTypeStyle", "redefineTypeStyle", "clearTypeStyleOverride", "deleteTypeStyle",
  "setTypeStyleBasedOn",
  "setDigits", "setKashida", "setDiacriticOffset", "setDirection", "setComposer", "toggleEastAsian", "toggleParagraph",
  "replaceMissingFonts", "findReplace",
] as const satisfies readonly (keyof typeof text)[];
for (const name of RECORDED_TEXT_OPS) {
  const orig = (text[name] as (...args: unknown[]) => unknown).bind(text);
  (text as unknown as Record<string, unknown>)[name] = recordedCall(`text.${name}`, orig, name === "apply" ? { key: 1 } : undefined);
}

export async function exportPSDCMYK(name = "monet-vision-cmyk.psd") {
  try {
    assertImportedPhotoshopWritable();
    saveBytes(name, await cmykPsdBytes(), "image/vnd.adobe.photoshop");
  } catch (error) {
    reportSave(error);
  }
}

/** CMYK PSD bytes separated through the working press profile, with that
 *  profile embedded — the profile's own black generation and ink limit make the
 *  plates, matching what the soft proof shows. An empty profile is the engine's
 *  documented signal to use its built-in UCR separation instead, which is what
 *  a failed fetch (offline, missing asset) resolves to. */
async function cmykPsdBytes(): Promise<Uint8Array> {
  const icc = await store.workingCmykProfile();
  return E().export_psd_cmyk_with_icc(icc ?? new Uint8Array(0));
}

// ── Transforms ─────────────────────────────────────────────────
function runGeometryEdit(
  edit: () => void,
  annotations?: { scale?: boolean; dx?: number; dy?: number },
): boolean {
  // `undo_pushes()` (monotonic), not `undo_depth()`: once history reaches the
  // History States cap every push evicts an older entry, so the DEPTH stops
  // changing and this read "nothing happened" for a real Image Size / Crop / Trim /
  // Rotate — leaving the document un-dirtied, so quitting discarded the edit with
  // no save prompt. (#169)
  const before = E().undo_pushes();
  const beforeWidth = E().width(), beforeHeight = E().height();
  edit();
  if (engine.consumeEditError() || E().undo_pushes() === before) return false;
  store.markDirty();
  engine.afterDocChange();
  if (annotations) {
    store.remapDocSpaceAnnotations(
      annotations.scale ? E().width() / beforeWidth : 1,
      annotations.scale ? E().height() / beforeHeight : 1,
      annotations.dx ?? 0,
      annotations.dy ?? 0,
    );
  }
  store.requestFit();
  return true;
}

/** Run a layer transform and surface its settled engine state. The engine owns
 *  atomic Type rasterization after all refusal checks, so one Undo restores the
 *  editable Type layer and a refused transform cannot destroy it. */
function bakeTransform(run: () => void): void {
  run();
  engine.commit();
}

const xformImpl = {
  resizeImage: (w: number, h: number) => { runGeometryEdit(() => E().resize_image(w, h), { scale: true }); },
  // File ▸ Automate ▸ Fit Image. The box is what gets recorded; the pixel size
  // is read from the document that is playing, so a portrait file is not
  // stretched to the landscape size the step was recorded on.
  fitImage: (maxW: number, maxH: number) => {
    const dw = store.state.doc.width, dh = store.state.doc.height;
    const scale = fitWithinScale(dw, dh, maxW, maxH);
    if (scale >= 1) return;
    xformImpl.resizeImage(Math.max(1, Math.round(dw * scale)), Math.max(1, Math.round(dh * scale)));
  },
  resizeCanvas: (w: number, h: number, dx: number, dy: number) => { runGeometryEdit(() => E().resize_canvas(w, h, dx, dy), { dx, dy }); },
  // Canvas Size with a "Canvas extension color": floods the new border on the background layer (rgba = [r,g,b,a]).
  resizeCanvasFilled: (w: number, h: number, dx: number, dy: number, rgba: [number, number, number, number]) => { runGeometryEdit(() => E().resize_canvas_filled(w, h, dx, dy, rgba[0], rgba[1], rgba[2], rgba[3]), { dx, dy }); },
  crop: (x: number, y: number, w: number, h: number) => { runGeometryEdit(() => E().crop(x, y, w, h), { dx: -x, dy: -y }); },
  // Image ▸ Reveal All — grow the canvas to encompass all off-canvas layer content (the inverse of Crop).
  revealAll: () => { runGeometryEdit(() => E().reveal_all()); },
  // Image ▸ Crop — crop the canvas to the bounding box of the active selection.
  cropToSelection: () => {
    const bounds = Array.from(E().selection_bounds());
    runGeometryEdit(() => { E().crop_to_selection(); }, { dx: -(bounds[0] ?? 0), dy: -(bounds[1] ?? 0) });
  },
  // Image ▸ Trim — crop away a uniform border. basedOn: 0 transparent, 1 top-
  // left colour, 2 bottom-right colour; the flags pick which sides to trim.
  trim: (basedOn: number, top: boolean, bottom: boolean, left: boolean, right: boolean) => {
    runGeometryEdit(() => E().trim(basedOn, top, bottom, left, right));
  },
  flipH: () => { E().flip_horizontal(); engine.commit(); },
  flipV: () => { E().flip_vertical(); engine.commit(); },
  rotate90: (cw: boolean) => { runGeometryEdit(() => E().rotate_90(cw)); },
  rotate180: () => { runGeometryEdit(() => E().rotate_180()); },
  rotateArbitrary: (deg: number) => { runGeometryEdit(() => E().rotate_arbitrary(deg)); },
  // Edit ▸ Transform — mirror/turn only the ACTIVE LAYER (not the canvas).
  // EVERY one of these goes through bakeTransform: a live type model cannot
  // represent a baked transform, so without rasterizing first the layer
  // re-renders from its untouched spec on the next type edit and the transform
  // silently vanishes. This used to guard only transformLayer and skewLayer,
  // which left flip/rotate/perspective losing the edit.
  flipLayerH: () => bakeTransform(() => E().flip_layer_h()),
  flipLayerV: () => bakeTransform(() => E().flip_layer_v()),
  rotateLayer180: () => bakeTransform(() => E().rotate_layer_180()),
  rotateLayer90: (cw: boolean) => bakeTransform(() => E().rotate_layer_90(cw)),
  transformLayer: (sx: number, sy: number, ang: number, tx: number, ty: number) => {
    if (sx === 1 && sy === 1 && ang === 0 && tx === 0 && ty === 0) return;
    bakeTransform(() => E().transform_layer(sx, sy, ang, tx, ty));
  },
  // Edit ▸ Transform ▸ Skew — shear the active layer by horizontal/vertical angles.
  skewLayer: (h: number, v: number) => { if (h !== 0 || v !== 0) bakeTransform(() => E().skew_layer(h, v)); },
  perspectiveWarp: (offsets: WarpOffset[]) => perspectiveWarp(offsets),
  perspectiveCrop: (corners: CropCorner[], outW: number, outH: number) => perspectiveCrop(corners, outW, outH),
};

// Edit ▸ Transform ▸ Again (⇧⌘T): replay the last layer transform with the same
// settings. The proxy records each repeatable layer-transform call's bound thunk
// (only the Edit ▸ Transform layer ops — not canvas-geometry/Image-menu ops).
const REPEATABLE_XFORM = new Set(["flipLayerH", "flipLayerV", "rotateLayer180", "rotateLayer90", "transformLayer", "skewLayer", "perspectiveWarp"]);
let lastTransform: (() => void) | null = null;
export function canRepeatLastTransform() { return lastTransform !== null; }
export function repeatLastTransform() { lastTransform?.(); }
export const xform = new Proxy(withOpCapture("xform", xformImpl), {
  get(target, prop, recv) {
    const v = Reflect.get(target, prop, recv);
    if (typeof v === "function" && typeof prop === "string" && REPEATABLE_XFORM.has(prop)) {
      const fn = v as (...a: never[]) => unknown;
      return (...args: never[]) => { lastTransform = () => fn(...args); return fn(...args); };
    }
    return v;
  },
});

// Restore persisted actions on module load (must run after `xform` — the last
// namespace visionOps() enumerates — is initialized). Validated against the
// visionOps() allowlist; a corrupt store yields zero actions + a console warning,
// never a boot failure.
loadPersistedActions();

// ── File IO ────────────────────────────────────────────────────
// The desktop build (Tauri) uses native file dialogs + filesystem save-in-place
// (each document remembers the path it was opened from / last saved to). The
// browser build (and Playwright) falls back to a hidden <input> for open and a
// download anchor for save. The Tauri plugin modules are dynamic-imported only
// inside `isTauri()` branches so the browser bundle never loads them.

/** Every export's last step. The desktop build cannot use the download anchor
 *  — WKWebView cancels its navigation when no download handler is registered
 *  (#505) — so under Tauri the bytes go through the native save panel (or
 *  straight into `destDir` when a multi-file export already picked one folder)
 *  and the durable atomic write. Resolves true once the file is on disk, false
 *  when the user cancelled or the write failed (reported inline, so the many
 *  fire-and-forget callers cannot leak an unhandled rejection). The browser
 *  build downloads through the anchor and resolves true; a failed anchor click
 *  still throws synchronously, before any event is raised. */
export function saveBytes(filename: string, bytes: Uint8Array, mime: string, destDir?: string): Promise<boolean> {
  if (isTauri()) {
    assertHistorySettled(engine.engine);
    return saveBytesNative(filename, bytes, mime, destDir);
  }
  assertHistorySettled(engine.engine);
  downloadBytes(filename, bytes, mime);
  if (/^(image\/|video\/|application\/pdf$)/.test(mime)) void runScriptEventBindings("exportDocument");
  return Promise.resolve(true);
}

/** The desktop half of saveBytes (#505). The Export Document script event
 *  fires only after the bytes reach disk — the same shape the download branch
 *  and the #475 native exports keep. */
async function saveBytesNative(filename: string, bytes: Uint8Array, mime: string, destDir?: string): Promise<boolean> {
  let target = destDir ? `${destDir}/${filename}` : "";
  try {
    if (!target) {
      if (_unattended) {
        reportSave("Save needs a file dialog, and a command-line job cannot show one.");
        return false;
      }
      const { save } = await import("@tauri-apps/plugin-dialog");
      target = await save({ defaultPath: filename }) ?? "";
      if (!target) return false; // Cancel: nothing written, no error
    }
    await atomicWriteBytes(target, bytes);
  } catch (e) {
    reportSave(e);
    return false;
  }
  if (/^(image\/|video\/|application\/pdf$)/.test(mime)) void runScriptEventBindings("exportDocument");
  return true;
}

/** The ONE folder a multi-file desktop export writes into (layers, artboards,
 *  comps, slices, data sets, scale rows). Null when the user cancels — the
 *  export then writes nothing. */
async function pickExportFolder(title: string): Promise<string | null> {
  if (_unattended) {
    reportSave("Export needs a folder dialog, and a command-line job cannot show one.");
    return null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const dir = await open({ directory: true, multiple: false, title });
  return typeof dir === "string" ? dir : null;
}

/** Run an export that may produce `count` files. On the desktop, more than one
 *  file means one folder panel up front — a save panel per file would bury the
 *  user — then every saveBytes writes straight into it. A single file, and the
 *  browser build, run `write` immediately (saveBytes shows its own panel /
 *  downloads as before). Pin the engine and every store read BEFORE calling
 *  this: the writes happen after the panel resolves, and the export must bake
 *  the document it started on. */
function withExportFolder(title: string, count: number, write: (destDir?: string) => void): void {
  if (!isTauri() || count <= 1) { write(); return; }
  void (async () => {
    const dir = await pickExportFolder(title);
    if (dir === null) return; // cancelled: nothing written
    write(dir);
  })().catch(reportSave);
}

/** Hand the browser a file that is NOT document state — a preset written from
 *  inside a preview dialog, where the history transaction is still open and
 *  `saveBytes` rightly refuses. */
export function downloadBytes(filename: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Always schedule the revoke, even if the click/anchor handling throws.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const cameraRawSidecarName = (name: string): string => name.replace(/\.[^.\\/]+$/, "") + ".xmp";
const readSidecarBytes = (path: string) =>
  readNativeFileBounded(path, () => ({ maxBytes: MAX_CAMERA_RAW_XMP_BYTES, label: "Camera Raw XMP" }));

/** The settings a raw on disk opens with, from the .xmp beside it: Vision's own
 *  payload while it still identifies these bytes, else the crs: settings any
 *  Camera Raw XMP carries (Lightroom, ACR, Galerie). No usable sidecar → none. */
async function readNativeRawSidecar(path: string, originalName: string, bytes: Uint8Array, sha256: string | undefined): Promise<{ sidecarPath?: string; recipe?: VisionDevelopRecipe }> {
  const sidecarPath = cameraRawSidecarName(path);
  let xmp: Uint8Array;
  try { xmp = await readSidecarBytes(sidecarPath); } catch { return {}; } // sidecar is optional
  const own = parseCameraRawXmp(xmp);
  if (own) {
    const matches = own.source.originalByteLength === bytes.length
      && (sha256 ? own.source.sha256 === sha256 : own.source.originalName === originalName);
    return matches ? { sidecarPath, recipe: own.recipe } : {};
  }
  const look = parseCameraRawLookXmp(xmp);
  return look ? { sidecarPath, recipe: look.recipe } : {};
}

/** Preferences ▸ Camera Raw ▸ save the settings to a sidecar when opening. It
 *  writes only beside a known source path, so no open (Batch included) ever
 *  prompts, and never over an .xmp Vision didn't write in full: a Lightroom,
 *  ACR or Galerie sidecar keeps every field, and the user is told why. */
export async function saveCameraRawSidecarOnOpen(source: CameraRawSidecarSourceSnapshot): Promise<boolean> {
  if (!isTauri() || !source.originalPath) return false;
  const target = cameraRawSidecarName(source.originalPath);
  const { exists } = await import("@tauri-apps/plugin-fs");
  if (await exists(target) && !isOwnCameraRawXmp(await readSidecarBytes(target))) {
    engine.onEditError?.(`Left ${target.replace(/^.*[\\/]/, "")} as it is: another app wrote it (or added to it), so saving ${source.originalName}'s settings there would have overwritten its fields.`);
    return false;
  }
  await atomicWriteBytes(target, new TextEncoder().encode(serializeCameraRawXmp(source)));
  return true;
}

async function cameraRawSha256(bytes: Uint8Array): Promise<string | undefined> {
  try {
    // Browser/native file reads own a full ArrayBuffer, so hashing can borrow it
    // directly. Only unusual subviews/SharedArrayBuffers need a bounded copy.
    const input: ArrayBuffer = bytes.buffer instanceof ArrayBuffer
      && bytes.byteOffset === 0
      && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : Uint8Array.from(bytes).buffer;
    const digest = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}

/** Persist a Camera Raw recipe beside its native source, or download an XMP in
 * the browser. The packet contains settings/identity only—never camera bytes or
 * a local path. Returns false only when the user cancels a required save dialog;
 * a sidecar another app wrote beside the raw is left untouched (reported, not
 * overwritten) and the save still counts as done. */
export async function saveCameraRawSidecar(source: CameraRawSidecarSourceSnapshot): Promise<boolean> {
  const packet = serializeCameraRawXmp(source);
  if (isTauri()) {
    let target = source.originalPath ? cameraRawSidecarName(source.originalPath) : "";
    if (!target) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      target = await save({
        defaultPath: cameraRawSidecarName(source.originalName),
        filters: [{ name: "Camera Raw Settings", extensions: ["xmp"] }],
      }) ?? "";
    }
    if (!target) return false;
    // Never clobber a sidecar another app wrote beside the raw (Lightroom, ACR,
    // Galerie) — the same ownership test the on-open writer uses. Only the
    // auto-derived target is guarded: a path the user picked in the save panel
    // is their explicit choice, and the panel already confirms a replace.
    if (source.originalPath) {
      const { exists } = await import("@tauri-apps/plugin-fs");
      if (await exists(target) && !isOwnCameraRawXmp(await readSidecarBytes(target))) {
        engine.onEditError?.(`Left ${target.replace(/^.*[\\/]/, "")} as it is: another app wrote it (or added to it), so saving ${source.originalName}'s settings there would have overwritten its fields.`);
        return true; // skipped the foreign write; Done still completes
      }
    }
    await atomicWriteBytes(target, new TextEncoder().encode(packet));
    return true;
  }
  saveBytes(cameraRawSidecarName(source.originalName), new TextEncoder().encode(packet), "application/rdf+xml");
  return true;
}

const XMP_FILTERS = [{ name: "Camera Raw Settings", extensions: ["xmp"] }];
const XMP_ACCEPT = ".xmp,application/rdf+xml,text/xml,application/xml";

/** Browser file pick (no Tauri dialog available). Resolves null when cancelled. */
function pickBrowserFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    const settle = (file: File | null) => { input.remove(); resolve(file); };
    input.onchange = () => settle(input.files?.[0] ?? null);
    input.oncancel = () => settle(null);
    document.body.appendChild(input);
    input.click();
  });
}

/** Apply an XMP's settings to `source`. A Monet sidecar carries Vision's payload
 * and must still identify this exact RAW — a mismatch is rejected outright. A
 * foreign `crs:` document (a Galerie sidecar, a Lightroom/ACR preset) makes no
 * identity claim, so it lands as a look. */
function applyCameraRawXmpBytes(
  source: CameraRawSidecarSourceSnapshot,
  bytes: Uint8Array,
): CameraRawSidecarImport | null {
  const sidecar = parseCameraRawXmp(bytes);
  if (sidecar) {
    const applied = applyCameraRawXmp(source, sidecar);
    return applied ? { source: applied } : null;
  }
  const look = parseCameraRawLookXmp(bytes);
  return look ? { source: { ...source, recipe: look.recipe } } : null;
}

/** An applied XMP. */
export interface CameraRawSidecarImport {
  source: CameraRawSidecarSourceSnapshot;
}

/** Pick and apply an XMP packet to the current source after validating its
 * byte-length/hash identity. A mismatched or malformed sidecar is rejected. */
export async function importCameraRawSidecar(
  source: CameraRawSidecarSourceSnapshot,
): Promise<CameraRawSidecarImport | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, filters: XMP_FILTERS });
    if (!picked || Array.isArray(picked)) return null;
    return applyCameraRawXmpBytes(source, await readNativeFileBounded(
      picked,
      () => ({ maxBytes: MAX_CAMERA_RAW_XMP_BYTES, label: "Camera Raw XMP" }),
    ));
  }
  const file = await pickBrowserFile(XMP_ACCEPT);
  if (!file) return null;
  assertReadableFileSize(file.size, MAX_CAMERA_RAW_XMP_BYTES, "Camera Raw XMP");
  return applyCameraRawXmpBytes(source, new Uint8Array(await file.arrayBuffer()));
}

/** Export a develop preset as `.xmp`, the interchange form Galerie and
 * Lightroom/ACR read. False only when the user cancels the save dialog. */
export async function exportCameraRawPreset(preset: CameraRawPreset): Promise<boolean> {
  const bytes = new TextEncoder().encode(serializeCameraRawPresetXmp(preset));
  const filename = `${preset.name.replace(/[\\/:*?"<>|]/g, "_").trim() || "Preset"}.xmp`;
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const target = await save({ defaultPath: filename, filters: XMP_FILTERS }) ?? "";
    if (!target) return false;
    await atomicWriteBytes(target, bytes);
    return true;
  }
  saveBytes(filename, bytes, "application/rdf+xml");
  return true;
}

/** Pick a `.xmp` develop preset (ours, Galerie's, or Lightroom/ACR's). Null when
 * the user cancels; THROWS when the picked file isn't a usable preset, so the
 * caller reports it rather than silently applying nothing. */
export async function importCameraRawPreset(): Promise<CameraRawPreset | null> {
  let bytes: Uint8Array;
  let fallbackName: string;
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, filters: XMP_FILTERS });
    if (!picked || Array.isArray(picked)) return null;
    bytes = await readNativeFileBounded(picked, () => ({ maxBytes: MAX_CAMERA_RAW_XMP_BYTES, label: "Camera Raw XMP" }));
    fallbackName = picked.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  } else {
    const file = await pickBrowserFile(XMP_ACCEPT);
    if (!file) return null;
    assertReadableFileSize(file.size, MAX_CAMERA_RAW_XMP_BYTES, "Camera Raw XMP");
    bytes = new Uint8Array(await file.arrayBuffer());
    fallbackName = file.name.replace(/\.[^.]+$/, "");
  }
  const preset = parseCameraRawPresetXmp(bytes, fallbackName || "Preset");
  if (!preset) throw new Error("That file isn't a Camera Raw preset (no develop settings found).");
  return preset;
}

const DCP_FILTERS = [{ name: "DNG Camera Profile", extensions: ["dcp"] }];
const DCP_ACCEPT = ".dcp,application/octet-stream";
const DCP_IMPORT_LIMIT: LocalImportLimit = { maxBytes: MAX_CAMERA_PROFILE_BYTES, label: "Camera profile" };

/** Camera Raw ▸ Profile ▸ Load Profile…: pick a DNG camera profile (.dcp) and
 *  add it to the profile library. Null when cancelled; throws an actionable
 *  message for a file that is not a usable profile. */
export async function importCameraRawProfileFile(): Promise<CameraRawProfileEntry | null> {
  let name: string;
  let bytes: Uint8Array;
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, filters: DCP_FILTERS });
    if (!picked || Array.isArray(picked)) return null;
    name = picked.replace(/^.*[\\/]/, "");
    bytes = await readNativeFileBounded(picked, () => DCP_IMPORT_LIMIT);
  } else {
    const file = await pickBrowserFile(DCP_ACCEPT);
    if (!file) return null;
    name = file.name;
    bytes = await readBrowserImportBytes(file, DCP_IMPORT_LIMIT);
  }
  return store.importCameraRawProfile(name, bytes);
}

/** Where Camera Raw ▸ Profile ▸ Load Profile… keeps the user's profiles: on
 *  the desktop, as .dcp files in the app-data CameraProfiles folder (durable
 *  writes, like recovery snapshots); in a browser, in IndexedDB — both beyond
 *  localStorage's ~5 MB, which three Adobe profiles would fill. */
export function cameraRawProfileStorage(): CameraRawProfileStorage {
  if (isTauri()) {
    const folder = async () => {
      const { appDataDir, join } = await import("@tauri-apps/api/path");
      return join(await appDataDir(), "CameraProfiles");
    };
    return {
      async list() {
        const fs = await import("@tauri-apps/plugin-fs");
        const dir = await folder();
        const paths = await collectAdobeProfilePaths(dir, { readDir: (d) => fs.readDir(d) }, [], true, 0);
        const out: { fileName: string; bytes: Uint8Array }[] = [];
        for (const path of paths) {
          try {
            out.push({ fileName: path.slice(dir.length + 1), bytes: await readNativeFileBounded(path, () => DCP_IMPORT_LIMIT) });
          } catch (e) {
            console.warn(`Could not read the camera profile ${path}:`, e);
          }
        }
        return out;
      },
      async put(fileName, bytes) {
        const fs = await import("@tauri-apps/plugin-fs");
        const dir = await folder();
        try { await fs.mkdir(dir, { recursive: true }); } catch { /* already exists */ }
        await atomicWriteBytes(`${dir}/${fileName}`, bytes);
      },
    };
  }
  const database = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("mv.cameraRawProfiles", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("profiles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const settle = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return {
    async list() {
      const db = await database();
      try {
        const profiles = db.transaction("profiles").objectStore("profiles");
        const [names, values] = await Promise.all([settle(profiles.getAllKeys()), settle(profiles.getAll())]);
        return names.flatMap((name, i) => (typeof name === "string" && values[i] instanceof Uint8Array ? [{ fileName: name, bytes: values[i] as Uint8Array }] : []));
      } finally {
        db.close();
      }
    },
    async put(fileName, bytes) {
      const db = await database();
      try {
        const tx = db.transaction("profiles", "readwrite");
        tx.objectStore("profiles").put(bytes, fileName);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("the profile store refused the write"));
        });
      } finally {
        db.close();
      }
    },
  };
}

// Adobe profile files already read this launch (whatever they held).
const scannedAdobeProfiles = new Set<string>();

/** Desktop: list the camera profiles ACR would offer for this camera from
 *  Adobe's CameraProfiles folders (when installed) in Camera Raw ▸ Profile,
 *  for this launch. The system folder holds a set per supported camera, so
 *  only the files named for this one are read.
 *  ponytail: macOS folders only; add Windows' ProgramData/AppData ones if
 *  Vision ships there. */
export async function findAdobeCameraProfiles(metadata: CameraRawSourceMetadata | null): Promise<void> {
  const keys = cameraModelKeys(metadata);
  if (!isTauri() || !keys.length) return;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const { homeDir } = await import("@tauri-apps/api/path");
    const reader = { readDir: (dir: string) => fs.readDir(dir) };
    const [userDir, systemDir] = ADOBE_CAMERA_PROFILE_DIRS;
    const paths = [
      ...await collectAdobeProfilePaths(`${(await homeDir()).replace(/[\\/]$/, "")}/${userDir}`, reader, keys, true),
      ...await collectAdobeProfilePaths(systemDir, reader, keys, false),
    ].filter((path) => !scannedAdobeProfiles.has(path)).slice(0, 256);
    const found: Uint8Array[] = [];
    for (const path of paths) {
      scannedAdobeProfiles.add(path);
      try { found.push(await readNativeFileBounded(path, () => DCP_IMPORT_LIMIT)); } catch { /* unreadable: not offered */ }
    }
    store.addFoundCameraRawProfiles(found);
  } catch (error) {
    console.warn("Could not look for Adobe camera profiles:", error);
  }
}

const LIQUIFY_MESH_FILTERS = [
  { name: "Liquify Mesh", extensions: ["mvmesh", "json"] },
  { name: "JSON", extensions: ["json"] },
];
const LIQUIFY_MESH_ACCEPT = ".mvmesh,.json,application/json,application/vnd.monet.vision.liquify-mesh+json";
const LIQUIFY_MESH_IMPORT_LIMIT: LocalImportLimit = {
  maxBytes: MAX_LIQUIFY_MESH_IMPORT_BYTES,
  label: "Liquify mesh",
};

function liquifyMeshName() {
  const stem = store.state.doc.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "monet-vision";
  return `${stem}-liquify-mesh.mvmesh`;
}

function reportLiquifyMeshImport(name: string) {
  console.warn(`Could not import Liquify mesh for the current document: ${name}`);
  if (typeof alert === "function") alert(`Could not import “${name}”.\nThe mesh file must be valid and match the current document size.`);
}

export async function exportLiquifyMeshFile(): Promise<boolean> {
  const bytes = store.exportLiquifyMesh();
  if (!bytes) return false;
  const name = liquifyMeshName();
  if (isTauri()) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const target = await save({ defaultPath: name, filters: LIQUIFY_MESH_FILTERS });
      if (!target) return false;
      await atomicWriteBytes(target, bytes);
      return true;
    } catch (e) {
      reportSave(e);
      return false;
    }
  }
  saveBytes(name, bytes, LIQUIFY_MESH_MIME);
  return true;
}

export async function importLiquifyMeshFile(): Promise<boolean> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: false, filters: LIQUIFY_MESH_FILTERS });
      if (!sel || Array.isArray(sel)) return false;
      const bytes = await readNativeFileBounded(sel, () => LIQUIFY_MESH_IMPORT_LIMIT);
      const ok = store.importLiquifyMesh(bytes);
      if (!ok) reportLiquifyMeshImport(sel.replace(/^.*[\\/]/, ""));
      return ok;
    } catch (e) {
      reportOpen("Liquify mesh", e);
      return false;
    }
  }
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = LIQUIFY_MESH_ACCEPT;
    inp.onchange = async () => {
      const file = inp.files?.[0] ?? null;
      inp.remove();
      if (!file) { resolve(false); return; }
      try {
        const ok = store.importLiquifyMesh(await readBrowserImportBytes(file, LIQUIFY_MESH_IMPORT_LIMIT));
        if (!ok) reportLiquifyMeshImport(file.name);
        resolve(ok);
      } catch (e) {
        reportOpen(file.name, e);
        resolve(false);
      }
    };
    inp.oncancel = () => { inp.remove(); resolve(false); };
    document.body.appendChild(inp);
    inp.click();
  });
}

// ── Swatches import/export (Adobe .aco / .ase / .act) ───────────────
const SWATCH_FILTERS = [{ name: "Adobe Swatches", extensions: ["aco", "ase", "act"] }];
const SWATCH_ACCEPT = ".aco,.ase,.act,application/octet-stream";

function swatchImportLimit(name: string, prefix: Uint8Array = new Uint8Array()): LocalImportLimit {
  const isAse = /\.ase$/i.test(name)
    || (prefix.length >= 4 && prefix[0] === 0x41 && prefix[1] === 0x53 && prefix[2] === 0x45 && prefix[3] === 0x46);
  if (isAse) return { maxBytes: MAX_ASE_IMPORT_BYTES, label: "Adobe ASE swatches" };
  if (/\.act$/i.test(name)) return { maxBytes: MAX_ACT_IMPORT_BYTES, label: "Adobe ACT color table" };
  return { maxBytes: MAX_ACO_IMPORT_BYTES, label: "Adobe ACO swatches" };
}

/** Parse .aco bytes and merge the colours into the swatch library.
 *  Returns the number of new swatches added (0 if none/invalid). */
export function importSwatchesAco(bytes: Uint8Array): number {
  return importSwatchesFromBytes(bytes);
}

/** Merge swatches from an Adobe .aco, .ase or .act file. Auto-detected:
 *  "ASEF" → .ase; an exact 768/772-byte length → .act (it carries no magic);
 *  otherwise .aco. Returns the number of new swatches added. */
export function importSwatchesFromBytes(bytes: Uint8Array, throwOnEmpty = false): number {
  const isAse = bytes.length >= 4 && bytes[0] === 0x41 && bytes[1] === 0x53 && bytes[2] === 0x45 && bytes[3] === 0x46; // "ASEF"
  const stats: { dropped: number; partial?: boolean } = { dropped: 0 };
  const colours = isAse ? parseAse(bytes, stats) : isActLength(bytes.length) ? parseAct(bytes) : parseAco(bytes, stats);
  if (!colours.length) {
    if (throwOnEmpty) throw new Error("No colours found — this is not a supported swatch file.");
    notify("No colours found — that may not be a swatch file.");
    return 0;
  }
  const added = store.importSwatches(colours);
  const dropped = stats.dropped ? ` ${stats.dropped} ${stats.dropped === 1 ? "colour was" : "colours were"} not imported.` : "";
  const partial = stats.partial ? " Import stopped at a truncated block; more colours may not have been imported." : "";
  const imported = added
    ? stats.partial ? `Imported ${added} colour${added === 1 ? "" : "s"}.` : `Imported ${added} of ${colours.length + stats.dropped} colours.`
    : "Every imported colour is already a swatch.";
  notify(imported + dropped + partial);
  return added;
}

/** Image ▸ Mode ▸ Color Table as #rrggbb: the document's indexed palette, in
 *  slot order — the table Indexed Color, or a Color Table Apply of an edited or
 *  loaded one, last gave it. A document that was never indexed has none, so it
 *  lists the composite's own colours instead. */
export function colorTableHexes(): string[] {
  const palette = engine.engine?.indexed_palette_rgb() ?? new Uint8Array();
  const rgb = palette.length
    ? Array.from({ length: palette.length / 3 }, (_, i) => [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]])
    : engine.colorTable(256);
  return rgb.map(([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
}

/** A colour table as .act bytes — the composite's own unless `hexes` is given
 *  (the Color Table dialog saves what is loaded and edited there, not the
 *  document it has not been applied to yet). */
export function colorTableToAct(hexes: string[] = colorTableHexes()): Uint8Array {
  return buildAct(hexes);
}

/** Save a colour table as an Adobe .act palette file. */
export function exportColorTableAct(name = "color-table.act", hexes?: string[]) {
  saveBytes(name, colorTableToAct(hexes), "application/octet-stream");
}

/** Image ▸ Mode ▸ Color Table ▸ Load…: an Adobe .act table as #rrggbb entries,
 *  null when the picker was cancelled or the file carries no table. */
export async function loadColorTableAct(): Promise<string[] | null> {
  const bytes = await pickLocalFileBytes(
    [{ name: "Adobe Color Table", extensions: ["act"] }],
    { maxBytes: MAX_ACT_IMPORT_BYTES, label: "Adobe ACT color table" },
  );
  if (!bytes) return null;
  const hexes = parseAct(bytes);
  if (!hexes.length) {
    notify("No colours found — that .act file is not a colour table.");
    return null;
  }
  return hexes;
}

export async function importSwatchesFile(): Promise<number> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: false, filters: SWATCH_FILTERS });
      if (!sel || Array.isArray(sel)) return 0;
      return importSwatchesFromBytes(await readNativeFileBounded(sel, (prefix) => swatchImportLimit(sel, prefix)));
    } catch (e) {
      reportOpen("swatches", e);
      return 0;
    }
  }
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = SWATCH_ACCEPT;
    inp.onchange = async () => {
      const file = inp.files?.[0] ?? null;
      inp.remove();
      if (!file) { resolve(0); return; }
      try {
        resolve(importSwatchesFromBytes(await readBrowserImportBytes(file, swatchImportLimit(file.name))));
      } catch (e) {
        reportOpen(file.name, e);
        resolve(0);
      }
    };
    inp.oncancel = () => { inp.remove(); resolve(0); };
    document.body.appendChild(inp);
    inp.click();
  });
}

const STYLE_FILTERS = [{ name: "Adobe Style Library", extensions: ["asl"] }];
const STYLE_ACCEPT = ".asl";
const STYLE_IMPORT_LIMIT: LocalImportLimit = { maxBytes: MAX_ASL_IMPORT_BYTES, label: "Adobe .asl style library" };

/** Parse .asl bytes, merge into the Styles library (renaming name collisions)
 *  and persist. Returns how many presets were read from the file. */
export function importStylesFromBytes(bytes: Uint8Array): number {
  const stats = { dropped: 0 };
  const parsed = parseAsl(bytes, stats);
  if (!parsed.length) {
    notify("No styles found — that may not be an Adobe style library.");
    return 0;
  }
  store.importStylePresets(mergeStylePresets(store.state.stylePresets, parsed));
  notify(`Imported ${parsed.length} style${parsed.length === 1 ? "" : "s"}.${stats.dropped ? ` ${stats.dropped} ${stats.dropped === 1 ? "style was" : "styles were"} not imported.` : ""}`);
  return parsed.length;
}

/** File-picker wrapper for Styles ▸ Import — mirrors importSwatchesFile. */
export async function importStylesFile(): Promise<number> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: false, filters: STYLE_FILTERS });
      if (!sel || Array.isArray(sel)) return 0;
      return importStylesFromBytes(await readNativeFileBounded(sel, () => STYLE_IMPORT_LIMIT));
    } catch (e) {
      reportOpen("styles", e);
      return 0;
    }
  }
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = STYLE_ACCEPT;
    inp.onchange = async () => {
      const file = inp.files?.[0] ?? null;
      inp.remove();
      if (!file) { resolve(0); return; }
      try {
        resolve(importStylesFromBytes(await readBrowserImportBytes(file, STYLE_IMPORT_LIMIT)));
      } catch (e) {
        reportOpen(file.name, e);
        resolve(0);
      }
    };
    inp.oncancel = () => { inp.remove(); resolve(0); };
    document.body.appendChild(inp);
    inp.click();
  });
}

// ── Preset Manager ▸ Load… / Save Set… ──────────────────────────────
// Photoshop's Preset Manager loads and saves each library as its own interchange
// file. Vision reads the Adobe file for every category that has a codec (.aco/
// .ase/.act swatches, .abr brushes, .grd gradients, .asl styles) and its own
// `.mvpresets` JSON set for every category, which is also what Save Set… writes
// where there is no Adobe writer.
// ponytail: Adobe's separate Replace… (drop the library first) is not wired —
// Load merges, and deleting the old rows in the same dialog covers it. Tool
// Presets (.tpl) and Custom Shapes (.csh) read/write only `.mvpresets`: their
// Adobe payloads are Photoshop tool descriptors and béziers with no Vision
// equivalent to land on.

const PRESET_SET_FILTER = { name: "Monet Preset Set", extensions: [PRESET_SET_EXT] };
const PRESET_ADOBE_FILTER: Record<PresetCategory, { name: string; extensions: string[] } | null> = {
  swatches: { name: "Adobe Swatches", extensions: ["aco", "ase", "act"] },
  brushes: { name: "Adobe Brushes", extensions: ["abr"] },
  tools: null,
  patterns: null, // Photoshop .pat has no codec here; the .mvpresets set carries them
  gradients: { name: "Adobe Gradients", extensions: ["grd"] },
  styles: { name: "Adobe Style Library", extensions: ["asl"] },
  shapes: null,
};

function presetImportLimit(cat: PresetCategory, name: string, prefix: Uint8Array = new Uint8Array()): LocalImportLimit {
  const isSet = prefix[0] === 0x7b /* '{' */ || name.toLowerCase().endsWith(`.${PRESET_SET_EXT}`);
  if (isSet) return { maxBytes: MAX_PRESET_SET_BYTES, label: "Monet preset set" };
  switch (cat) {
    case "swatches": return swatchImportLimit(name, prefix);
    case "brushes": return { maxBytes: MAX_ABR_IMPORT_BYTES, label: "Adobe .abr brush library" };
    case "gradients": return { maxBytes: MAX_GRD_IMPORT_BYTES, label: "Adobe .grd gradient library" };
    case "styles": return STYLE_IMPORT_LIMIT;
    default: return { maxBytes: MAX_PRESET_SET_BYTES, label: "Monet preset set" };
  }
}

/** Merge a `.mvpresets` payload. Each category's own persisted-shape validator
 *  checks the items, so a hand-edited or foreign file cannot poison a library. */
function importPresetSetJson(cat: PresetCategory, text: string): number {
  const items = presetSetItems(text, cat);
  const reject = (): never => { throw new Error(`No valid ${cat} presets in that set file`); };
  switch (cat) {
    case "swatches": return store.importSwatches(parseSwatches(items) ?? reject());
    case "brushes": return store.importBrushPresets(parseBrushPresets(items) ?? reject());
    case "tools": return store.importToolPresets(parseToolPresets(items) ?? reject());
    case "gradients": return store.importGradientPresets(parseGradientPresets(items) ?? reject());
    case "shapes": return store.importCustomShapes(parseCustomShapes(items) ?? reject());
    case "patterns": return store.importPatternPresets(parsePatterns(items) ?? reject());
    case "styles": {
      const list = parseStylePresets(items) ?? reject();
      store.importStylePresets(mergeStylePresets(store.state.stylePresets, list));
      return list.length;
    }
  }
}

/** Load a preset library from file bytes into `cat`. A leading `{` is our own
 *  JSON set; anything else is the category's Adobe binary. Throws with a usable
 *  message on an unreadable or wrong-category file. */
export function importPresetSetBytes(cat: PresetCategory, bytes: Uint8Array): number {
  if (bytes[0] === 0x7b) return importPresetSetJson(cat, decodeImportText(bytes));
  switch (cat) {
    case "swatches": return importSwatchesFromBytes(bytes, true);
    case "styles": return importStylesFromBytes(bytes);
    case "brushes": {
      const stats: { dropped: number; partial?: boolean } = { dropped: 0 };
      const added = store.importBrushPresets(parseAbr(bytes, stats));
      if (stats.partial) notify(`Imported ${added} brush${added === 1 ? "" : "es"}. Import stopped at an unreadable brush block; later brushes may not have been imported.`);
      return added;
    }
    case "gradients": return store.importGradientPresets(parseGrd(bytes));
    default: throw new Error(`${cat} presets load from a Monet .${PRESET_SET_EXT} set file`);
  }
}

/** Preset Manager ▸ Load… — file picker for one category (mirrors importStylesFile). */
/** Pick one local file and read it within `limit` — native dialog on the
 *  desktop, an <input type=file> in the browser. Null when the user cancels
 *  or the read is refused (already reported). */
export async function pickLocalFileBytes(
  filters: { name: string; extensions: string[] }[],
  limit: LocalImportLimit,
): Promise<Uint8Array | null> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: false, filters });
      if (!sel || Array.isArray(sel)) return null;
      return await readNativeFileBounded(sel, () => limit);
    } catch (e) {
      reportOpen(limit.label, e);
      return null;
    }
  }
  const accept = filters.flatMap((f) => f.extensions).map((e) => `.${e}`).join(",");
  const file = await pickBrowserFile(accept);
  if (!file) return null;
  try {
    return await readBrowserImportBytes(file, limit);
  } catch (e) {
    reportOpen(file.name, e);
    return null;
  }
}

export async function loadPresetSetFile(cat: PresetCategory): Promise<number> {
  const adobe = PRESET_ADOBE_FILTER[cat];
  const filters = adobe ? [adobe, PRESET_SET_FILTER] : [PRESET_SET_FILTER];
  const accept = [...(adobe?.extensions ?? []), PRESET_SET_EXT].map((e) => `.${e}`).join(",");
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: false, filters });
      if (!sel || Array.isArray(sel)) return 0;
      return importPresetSetBytes(cat, await readNativeFileBounded(sel, (prefix) => presetImportLimit(cat, sel, prefix)));
    } catch (e) {
      reportOpen(`${cat} presets`, e);
      return 0;
    }
  }
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.onchange = async () => {
      const file = inp.files?.[0] ?? null;
      inp.remove();
      if (!file) { resolve(0); return; }
      try {
        resolve(importPresetSetBytes(cat, await readBrowserImportBytes(file, presetImportLimit(cat, file.name))));
      } catch (e) {
        reportOpen(file.name, e);
        resolve(0);
      }
    };
    inp.oncancel = () => { inp.remove(); resolve(0); };
    document.body.appendChild(inp);
    inp.click();
  });
}

/** Preset Manager ▸ Save Set… — write the whole library out in the richest format
 *  Vision can author for that category. */
export function savePresetSet(cat: PresetCategory) {
  const bin = "application/octet-stream";
  switch (cat) {
    case "swatches": return exportSwatchesAco();
    case "styles": return saveBytes("styles.asl", buildAsl(store.state.stylePresets), bin);
    case "gradients": return saveBytes("gradients.grd", buildGrd(store.state.gradientPresets), bin);
    default: return saveBytes(
      `${cat}.${PRESET_SET_EXT}`,
      new TextEncoder().encode(buildPresetSet(cat, store.presetsFor(cat))),
      "application/json",
    );
  }
}

// ── Edit ▸ Presets ▸ Export/Import Presets + Migrate Presets ────────────
// Photoshop's Export/Import Presets moves whole libraries between installations,
// and Migrate Presets pulls in everything an older installation's Presets folder
// holds. Vision writes all seven libraries into one `.mvpresets` bundle for the
// first; for the second it takes a multi-selection of Adobe preset files and
// routes each to its category by extension, reusing the per-category readers.
// ponytail: Migrate is a file multi-select, not a folder sweep — batchIo.ts's
// walker is hard-wired to image extensions. Give collectBatchFolder its match
// pattern as an argument and Migrate can take a directory instead.

const PRESET_BUNDLE_FORMAT = "mvpresets-all";
const ADOBE_PRESET_EXTS = PRESET_CATEGORIES.flatMap((c) => PRESET_ADOBE_FILTER[c]?.extensions ?? []);

interface PresetBundleFile {
  format: typeof PRESET_BUNDLE_FORMAT;
  version: 1;
  sets: Partial<Record<PresetCategory, unknown[]>>;
}

export interface PresetImportReport {
  /** Presets merged into a library. */
  imported: number;
  /** Files that yielded at least one preset. */
  files: number;
  errors: { name: string; reason: string }[];
}

/** Serialise every library into one bundle. Pure: the caller passes the
 *  libraries in, so this needs no store to test. Empty ones are left out. */
export function buildPresetBundle(sets: Partial<Record<PresetCategory, readonly unknown[]>>): string {
  const out: PresetBundleFile["sets"] = {};
  for (const cat of PRESET_CATEGORIES) {
    const items = sets[cat];
    if (items?.length) out[cat] = [...items];
  }
  const file: PresetBundleFile = { format: PRESET_BUNDLE_FORMAT, version: 1, sets: out };
  return JSON.stringify(file, null, 2);
}

/** The libraries in a bundle, still as raw items — each category's own validator
 *  runs on import. Throws on anything that is not our bundle: this is an
 *  untrusted local file, so nothing but the envelope is taken on trust. */
export function parsePresetBundle(text: string): Partial<Record<PresetCategory, unknown[]>> {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("Not a Monet preset bundle"); }
  const file = raw as Partial<PresetBundleFile> | null;
  if (!file || file.format !== PRESET_BUNDLE_FORMAT || !file.sets || typeof file.sets !== "object") {
    throw new Error("Not a Monet preset bundle");
  }
  const sets = file.sets as Record<string, unknown>;
  const out: Partial<Record<PresetCategory, unknown[]>> = {};
  for (const cat of PRESET_CATEGORIES) if (Array.isArray(sets[cat])) out[cat] = sets[cat] as unknown[];
  if (!Object.keys(out).length) throw new Error("That bundle holds no presets");
  return out;
}

/** Which library an Adobe preset file belongs to, by extension. Null for the
 *  formats Photoshop ships that Vision has no reader for (.csh, .tpl), so the
 *  caller can name the reason instead of failing silently. */
export function presetCategoryForFile(name: string): PresetCategory | null {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return PRESET_CATEGORIES.find((c) => PRESET_ADOBE_FILTER[c]?.extensions.includes(ext)) ?? null;
}

function anyPresetImportLimit(name: string, prefix: Uint8Array = new Uint8Array()): LocalImportLimit {
  const cat = presetCategoryForFile(name);
  return cat ? presetImportLimit(cat, name, prefix) : { maxBytes: MAX_PRESET_SET_BYTES, label: "Monet preset file" };
}

/** Our own JSON: a whole-app bundle or a single-category set. A bundle imports
 *  category by category so one corrupt library doesn't cost the others. */
function importPresetJsonFile(text: string): number {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("Not a Monet preset file"); }
  const file = raw as { format?: unknown; category?: unknown } | null;
  if (file?.format === PRESET_BUNDLE_FORMAT) {
    const sets = parsePresetBundle(text);
    let imported = 0;
    let failed = "";
    for (const cat of PRESET_CATEGORIES) {
      const items = sets[cat];
      if (!items) continue;
      try { imported += importPresetSetJson(cat, buildPresetSet(cat, items)); }
      catch (e) { failed ||= e instanceof Error ? e.message : String(e); }
    }
    if (!imported) throw new Error(failed || "That bundle holds no presets");
    return imported;
  }
  const named = typeof file?.category === "string" ? file.category : "";
  const cat = PRESET_CATEGORIES.find((c) => c === named);
  if (!cat) throw new Error("Not a Monet preset file");
  return importPresetSetJson(cat, text);
}

/** Import one preset file of any kind: our bundle, our single-category set, or
 *  an Adobe library named by its extension. Throws with a usable message. */
export function importAnyPresetBytes(name: string, bytes: Uint8Array): number {
  if (bytes[0] === 0x7b /* '{' */) return importPresetJsonFile(decodeImportText(bytes));
  const cat = presetCategoryForFile(name);
  if (!cat) throw new Error("No Vision reader for that preset format — Photoshop's .csh shapes and .tpl tool presets are descriptors Vision has nothing to land on");
  return importPresetSetBytes(cat, bytes);
}

/** Edit ▸ Presets ▸ Export Presets… — every library in one `.mvpresets` file. */
export function exportAllPresets() {
  const sets: Partial<Record<PresetCategory, readonly unknown[]>> = {};
  for (const cat of PRESET_CATEGORIES) sets[cat] = store.presetsFor(cat);
  saveBytes(`presets.${PRESET_SET_EXT}`, new TextEncoder().encode(buildPresetBundle(sets)), "application/json");
}

/** Edit ▸ Presets ▸ Import Presets… (adobe = false) and ▸ Migrate Presets…
 *  (adobe = true, which widens the filter to the formats an older Photoshop
 *  install's Presets folder holds). Every selected file is routed to its own
 *  library; a file that fails lands in `errors` rather than aborting the rest. */
export async function importPresetFiles(adobe: boolean): Promise<PresetImportReport> {
  const report: PresetImportReport = { imported: 0, files: 0, errors: [] };
  const take = async (name: string, read: () => Promise<Uint8Array>) => {
    try {
      report.imported += importAnyPresetBytes(name, await read());
      report.files++;
    } catch (e) {
      report.errors.push({ name, reason: e instanceof Error ? e.message : String(e) });
    }
  };
  const exts = adobe ? [...ADOBE_PRESET_EXTS, PRESET_SET_EXT] : [PRESET_SET_EXT];
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: true, filters: [{ name: adobe ? "Preset Files" : "Monet Preset Set", extensions: exts }] });
      if (!sel) return report;
      for (const path of Array.isArray(sel) ? sel : [sel]) {
        const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
        await take(name, () => readNativeFileBounded(path, (prefix) => anyPresetImportLimit(name, prefix)));
      }
    } catch (e) {
      reportOpen("presets", e);
    }
    return report;
  }
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = true;
    inp.accept = exts.map((e) => `.${e}`).join(",");
    inp.onchange = async () => {
      const files = Array.from(inp.files ?? []);
      inp.remove();
      for (const file of files) await take(file.name, () => readBrowserImportBytes(file, anyPresetImportLimit(file.name)));
      resolve(report);
    };
    inp.oncancel = () => { inp.remove(); resolve(report); };
    document.body.appendChild(inp);
    inp.click();
  });
}

const ACTIONS_FILTERS = [{ name: "Monet Actions", extensions: ["mvactions", "json", "atn"] }];
const ACTIONS_ACCEPT = ".mvactions,.atn,application/json";
type ActionsImportResult = {
  imported: number;
  rejected: { name: string; reason: string }[];
  /** Set only for an imported .atn pack. */
  setName?: string;
  error?: string | null;
};

function actionsImportLimit(name: string, prefix: Uint8Array = new Uint8Array()): LocalImportLimit {
  const isAtn = /\.atn$/i.test(name)
    || (prefix.length >= 4 && prefix[0] === 0 && prefix[1] === 0 && prefix[2] === 0 && prefix[3] === 16);
  return isAtn
    ? { maxBytes: MAX_ATN_IMPORT_BYTES, label: "Adobe actions file" }
    : { maxBytes: MAX_ACTIONS_IMPORT_BYTES, label: "Actions file" };
}

/** Adobe .atn packs open with a big-endian u32 descriptor version of 16 (see
 *  AtnReader in actionSets.ts); .mvactions/.json UTF-8 text never starts with
 *  three NUL bytes, so that's enough to tell the binary format apart. */
function isAtnBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 16;
}

/** Merge an .mvactions/.json payload, or a binary Adobe .atn pack, into the
 *  actions library. .atn is converted to the same JSON shape first, so both
 *  routes share importJson's allowlist validation, duplicate renaming and
 *  persistence. */
export function importActionsFromBytes(bytes: Uint8Array): ActionsImportResult {
  if (isAtnBytes(bytes)) {
    const { json, setName, error } = atnToActionsFile(bytes);
    return { ...actions.importJson(json), setName, error };
  }
  return actions.importJson(decodeImportText(bytes));
}

/** File-picker wrapper for actions.importJson — mirrors importSwatchesFile.
 *  Reads BYTES, not text: an .atn pack is binary and UTF-8 decoding it before
 *  parsing would corrupt it. */
export async function importActionsFile(): Promise<ActionsImportResult> {
  const none: ActionsImportResult = { imported: 0, rejected: [] };
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: false, filters: ACTIONS_FILTERS });
      if (!sel || Array.isArray(sel)) return none;
      return importActionsFromBytes(await readNativeFileBounded(sel, (prefix) => actionsImportLimit(sel, prefix)));
    } catch (e) {
      reportOpen("actions", e);
      return none;
    }
  }
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ACTIONS_ACCEPT;
    inp.onchange = async () => {
      const file = inp.files?.[0] ?? null;
      inp.remove();
      if (!file) { resolve(none); return; }
      try {
        resolve(importActionsFromBytes(await readBrowserImportBytes(file, actionsImportLimit(file.name))));
      } catch (e) {
        reportOpen(file.name, e);
        resolve(none);
      }
    };
    inp.oncancel = () => { inp.remove(); resolve(none); };
    document.body.appendChild(inp);
    inp.click();
  });
}

const NOTE_IMPORT_ACCEPT = ".pdf,.fdf,application/pdf,application/vnd.fdf";
const NOTE_IMPORT_FILTERS = [{ name: "PDF annotations", extensions: ["pdf", "fdf"] }];
const NOTE_IMPORT_LIMIT: LocalImportLimit = { maxBytes: MAX_NOTE_IMPORT_BYTES, label: "PDF/FDF notes" };

/** Parse Adobe PDF/FDF text annotations into the active document's note model. */
export function importNotesFromBytes(bytes: Uint8Array): number {
  const { width, height } = store.state.doc;
  const notes = parseImportedNotes(bytes, width, height);
  if (!notes.length) {
    notify("No notes found — that may not be a PDF or FDF annotation file.");
    return 0;
  }
  const added = store.importNotes(notes);
  notify(added === notes.length
    ? `Imported ${added} note${added === 1 ? "" : "s"}.`
    : `Imported ${added} of ${notes.length} notes; the document note limit was reached.`);
  return added;
}

/** File ▸ Import ▸ Notes. Native builds read the selected path directly; the
 *  browser/E2E path uses the equivalent constrained file chooser. */
export async function importNotesFile(): Promise<number> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: false, filters: NOTE_IMPORT_FILTERS });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return 0;
      return importNotesFromBytes(await readNativeFileBounded(path, () => NOTE_IMPORT_LIMIT));
    } catch (e) {
      reportOpen("notes", e);
      return 0;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = NOTE_IMPORT_ACCEPT;
    input.onchange = async () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      if (!file) { resolve(0); return; }
      try {
        resolve(importNotesFromBytes(await readBrowserImportBytes(file, NOTE_IMPORT_LIMIT)));
      } catch (e) {
        reportOpen(file.name, e);
        resolve(0);
      }
    };
    input.oncancel = () => { input.remove(); resolve(0); };
    document.body.appendChild(input);
    input.click();
  });
}

export function exportSwatchesAco(name = "swatches.aco") {
  saveBytes(name, buildAco(store.state.swatches), "application/octet-stream");
}

const NO_ICC_PROFILE = new Uint8Array();

/** COLOR-04: the raw ICC bytes a flat-image export embeds — the document's
 *  assigned custom profile, or empty, in which case the engine tags its
 *  built-in working profile (Display P3 / Adobe RGB / Rec.2020; plain sRGB
 *  stays untagged). Without this a Vision → PNG → Vision round trip silently
 *  reinterprets the pixels as sRGB, and Galerie inherits the same lie. */
export function exportIccBytes(document?: ProjectDocumentMeta | null): Uint8Array {
  const meta = document ?? store.state;
  return meta.colorProfileAssigned && meta.iccProfileBytes?.length ? meta.iccProfileBytes : NO_ICC_PROFILE;
}

// Save/Export are recorded commands (Photoshop records Save / Save As /
// Export as action steps), so they're recordedCall consts, not declarations.
export const exportPNG = recordedCall("exportPNG", (name: string = "monet-vision.png") => {
  try {
    const eng = E();
    refuseNonRgbFlatExport(eng, "PNG");
    saveBytes(name, eng.export_png_with_icc(exportIccBytes()), "image/png");
  } catch (e) { reportSave(e); }
});
/** File ▸ Print…'s settings rendered into what the spooler gets: the composite
 *  PNG and the page CSS that sizes and places it. Printer Manages Colors sends
 *  the document's own tagged pixels; Photoshop Manages Colors converts them
 *  through the printer profile first (see the engine's `print_pixels`).
 *  Throws a message the user can act on. */
export async function preparePrintJob(settings: PrintSettings): Promise<{ png: Uint8Array; css: string }> {
  const target = E(), stamp = editStamp(engine), sourceIcc = exportIccBytes();
  assertHistorySettled(target);
  const layout = printLayout(settings, target.width(), target.height(), store.state.resolutionPpi);
  const problem = printSettingsError(settings, layout);
  if (problem) throw new Error(problem);
  const css = printPageCss(layout);
  if (settings.colorHandling === "printer") return { png: target.export_png_with_icc(sourceIcc), css };
  const profile = settings.profile === "icc" ? decodeProfileIcc(settings.profileIcc) : await store.workingCmykProfile();
  // The first press-profile fetch can outlive a tab switch, close, or edit.
  if (engine.engine !== target || docChanged(engine, stamp)) throw new Error("Printing was cancelled because the document changed. Print again.");
  assertHistorySettled(target);
  if (!profile) throw new Error("The working CMYK press profile could not be loaded. Load a printer profile, or choose Printer Manages Colors.");
  return { png: target.export_print_png(sourceIcc, profile, settings.intent, settings.bpc), css };
}
/** Spool a prepared job to the OS print dialog, reporting any failure. */
export async function spoolPrintJob(job: { png: Uint8Array; css: string }) {
  try {
    await printPng(job.png, job.css);
  } catch (error) {
    reportPrint(error);
  }
}
/** File ▸ Print One Copy: print with the settings File ▸ Print… last saved, no dialog. */
export async function printDocument() {
  try {
    await spoolPrintJob(await preparePrintJob(loadPrintSettings()));
  } catch (error) {
    reportPrint(error);
  }
}
export const exportJPEG = recordedCall("exportJPEG", (name: string = "monet-vision.jpg", quality: number = 90) => {
  try {
    const eng = E();
    refuseNonRgbFlatExport(eng, "JPEG");
    saveBytes(name, eng.export_jpeg_with_icc(quality, exportIccBytes()), "image/jpeg");
  } catch (e) { reportSave(e); }
});
export function exportOriginalPhotoshop() {
  try {
    const api = importedPhotoshopApi(E());
    if (!api.imported_photoshop_read_only?.() || !api.export_imported_photoshop_original) {
      throw new Error("The active document has no preserved Photoshop source.");
    }
    const extension = api.imported_photoshop_source_is_psb?.() ? "psb" : "psd";
    const base = (store.activeName() || "photoshop-original").replace(/\.[^.\\/]+$/, "");
    saveBytes(`${base}.${extension}`, api.export_imported_photoshop_original(), "image/vnd.adobe.photoshop");
  } catch (error) {
    reportSave(error);
  }
}
/** Resources 2000+/2999 come from whatever the engine was last handed. A path a
 *  PSD cannot carry (over 65,535 anchors) is left out, so say so: a save in
 *  place would otherwise drop it from the file unannounced. */
function handPhotoshopPaths(eng: ReturnType<typeof E>, paths: ProjectDocumentMeta["savedPaths"]) {
  const dropped = eng.set_photoshop_paths(JSON.stringify(toPhotoshopPaths(paths ?? [])));
  if (dropped > 0) {
    const them = dropped === 1 ? "it" : "them";
    notify(`${dropped} saved ${dropped === 1 ? "path was" : "paths were"} left out of the Photoshop file because a Photoshop path holds at most 65,535 anchor points. Simplify ${them} and save again to keep ${them}.`);
  }
}
/** A Duotone document saves as Photoshop's Duotone mode: the inks ride in the
 *  colour mode data and their gradient-map layer stays out of the file.
 *  `duotone` is the document's live record (store.docDuotone); without one the
 *  document saves in its plain mode. An ink layer whose inks are unknown (a
 *  project saved before they were recorded) is only a LUT, which Photoshop
 *  cannot be given, so say how to get them back instead of failing on it. */
function handPhotoshopDuotone(eng: ReturnType<typeof E>, duotone: DuotoneDoc | null) {
  if (!duotone && eng.doc_mode() === 1 && store.existingDuotoneLayer(eng) !== null) {
    throw new Error("This document's Duotone inks were not saved with it, so they cannot go into a Photoshop file. Choose Image ▸ Mode ▸ Duotone…, set the inks and click OK (or delete the Duotone layer), then save again.");
  }
  eng.set_photoshop_duotone(duotone ? encodeDuotoneSpec(duotone) : new Uint8Array(0), duotone?.layerId ?? 0);
}
/** What the Photoshop file holds differently from the document (Smart Object
 *  contents saved in another mode, or as pixels), once the file is written. */
function notePhotoshopExportNotice(eng: ReturnType<typeof E>) {
  const notice = (eng as unknown as { photoshop_export_notice?: () => string }).photoshop_export_notice?.() ?? "";
  if (notice) notify(notice);
}
/** A layered TIFF carries the Photoshop layer data, so it says what that data
 *  holds differently, as a PSD save does. */
function layeredTiffBytes(eng: ReturnType<typeof E>, icc: Uint8Array) {
  const bytes = eng.export_tiff_layered_with_icc(icc);
  notePhotoshopExportNotice(eng);
  return bytes;
}
/** Photoshop's Multichannel mode has no layers, so the file holds the plates of
 *  the flattened image; say so rather than let a reopen come back flat. */
function noteMultichannelFlatten(eng: ReturnType<typeof E>) {
  if (eng.doc_mode() === 4 && eng.layer_count() > 1) {
    notify("Photoshop's Multichannel mode has no layers, so the Photoshop file holds the flattened plates. This document keeps its layers.");
  }
}
function psdExportBytes(
  eng = E(),
  document: ProjectDocumentMeta = {
    colorProfileAssigned: store.state.colorProfileAssigned,
    iccProfileBytes: store.state.iccProfileBytes,
    iccProfileName: store.state.iccProfileName,
    savedPaths: store.state.savedPaths,
  },
  duotone: DuotoneDoc | null = store.docDuotone(store.state.activeDocId),
): Uint8Array {
  assertHistorySettled(eng);
  assertImportedPhotoshopWritable(eng);
  handPhotoshopPaths(eng, document.savedPaths);
  handPhotoshopDuotone(eng, duotone);
  const bytes = document.colorProfileAssigned && document.iccProfileBytes?.length
    ? eng.export_psd_with_icc(document.iccProfileBytes)
    : eng.export_psd_tagged(document.colorProfileAssigned);
  noteMultichannelFlatten(eng);
  notePhotoshopExportNotice(eng);
  return bytes;
}
export function exportPSDBytes(): Uint8Array {
  return psdExportBytes();
}
export const exportPSD = recordedCall("exportPSD", (name: string = "monet-vision.psd") => {
  try {
    saveBytes(name, exportPSDBytes(), "image/vnd.adobe.photoshop");
  } catch (error) {
    reportSave(error);
  }
});
function psbExportBytes(
  eng = E(),
  document: ProjectDocumentMeta = {
    colorProfileAssigned: store.state.colorProfileAssigned,
    iccProfileBytes: store.state.iccProfileBytes,
    iccProfileName: store.state.iccProfileName,
    savedPaths: store.state.savedPaths,
  },
  duotone: DuotoneDoc | null = store.docDuotone(store.state.activeDocId),
): Uint8Array {
  assertHistorySettled(eng);
  assertImportedPhotoshopWritable(eng);
  handPhotoshopPaths(eng, document.savedPaths);
  handPhotoshopDuotone(eng, duotone);
  const bytes = document.colorProfileAssigned && document.iccProfileBytes?.length
    ? eng.export_psb_with_icc(document.iccProfileBytes)
    : eng.export_psb_tagged(document.colorProfileAssigned);
  noteMultichannelFlatten(eng);
  notePhotoshopExportNotice(eng);
  return bytes;
}
export function exportPSBBytes(): Uint8Array {
  return psbExportBytes();
}
export const exportPSB = recordedCall("exportPSB", (name: string = "monet-vision.psb") => {
  try {
    saveBytes(name, exportPSBBytes(), "image/vnd.adobe.photoshop");
  } catch (error) {
    reportSave(error);
  }
});
export type ExportAsFormat = "png" | "jpeg" | "gif";

/** The Export As dialog's last Metadata choice. It is not the engine's save
 *  scope: that stays on All except for the duration of this one export. (#517) */
let exportAsMetadataScope = 3;
export function exportAsMetadataChoice(): number {
  return exportAsMetadataScope;
}
export function rememberExportAsMetadata(scope: number) {
  exportAsMetadataScope = scope >= 0 && scope <= 3 ? Math.round(scope) : 3;
}

function withExportMetadataScope(
  eng: { export_metadata_scope?: () => number; set_export_metadata_scope?: (scope: number) => void },
  scope: number | undefined,
  write: () => void,
) {
  if (scope == null || !eng.set_export_metadata_scope || !eng.export_metadata_scope) {
    write();
    return;
  }
  const previous = eng.export_metadata_scope();
  eng.set_export_metadata_scope(scope);
  try { write(); }
  finally { eng.set_export_metadata_scope(previous); }
}

/** File ▸ Export ▸ Export As…: export the composite at each requested relative
 *  size, using the requested format and JPEG quality. `metadataScope` applies
 *  only while these bytes are encoded. */
export const exportAs = recordedCall("exportAs", (
  baseName: string = "monet-vision",
  requestedRows: readonly Partial<ExportScaleRow>[] = [{ scale: 1, suffix: "" }],
  requestedFormat?: ExportAsFormat,
  requestedQuality?: number,
  metadataScope?: number,
) => {
  try {
    const format = requestedFormat ?? store.state.exportPrefs.format;
    const quality = Math.max(1, Math.min(100, Math.round(requestedQuality ?? store.state.exportPrefs.quality)));
    const extension = format === "jpeg" ? "jpg" : format;
    const rows = normalizeExportScaleRows(requestedRows);
    const duplicate = duplicateExportScaleFilename(baseName, extension, rows);
    if (duplicate) throw new Error(`Duplicate export filename: ${duplicate}`);
    const oversized = rows.find((row) => !exportScaleFits(store.state.doc.width, store.state.doc.height, row.scale));
    if (oversized) throw new Error(`Export scale exceeds the image-size limit: ${oversized.scale}×`);
    // Pinned before a desktop folder pick, so a mid-pick tab switch cannot export
    // another document's pixels or tag them with another document's profile.
    const eng = E();
    refuseNonRgbFlatExport(eng, format === "jpeg" ? "JPEG" : format.toUpperCase());
    const icc = exportIccBytes();
    withExportFolder("Export As", rows.length, (destDir) => {
      withExportMetadataScope(eng, metadataScope, () => {
        for (const row of rows) {
          const filename = exportScaleFilename(baseName, extension, row);
          if (format === "gif") {
            const bytes = row.scale === 1 ? eng.export_gif(10) : eng.export_scaled_gif(row.scale, 10);
            saveBytes(filename, bytes, "image/gif", destDir);
          } else if (format === "jpeg") {
            const bytes = row.scale === 1
              ? eng.export_jpeg_with_icc(quality, icc)
              : eng.export_scaled_jpeg_with_icc(row.scale, quality, icc);
            saveBytes(filename, bytes, "image/jpeg", destDir);
          } else {
            const bytes = row.scale === 1
              ? eng.export_png_with_icc(icc)
              : eng.export_scaled_png_with_icc(row.scale, icc);
            saveBytes(filename, bytes, "image/png", destDir);
          }
        }
      });
    });
  } catch (e) {
    // The alert is for the menu. A script still has to see the failure (#518).
    reportSave(e);
    throw e;
  }
});

export interface LayerExportTarget {
  id: number;
  baseName: string;
  width: number;
  height: number;
}

export function selectedLayerExportTargets(): LayerExportTarget[] {
  const selected = new Set(store.state.selectedLayerIds.length
    ? store.state.selectedLayerIds
    : [store.state.activeLayerId]);
  return store.state.layers.flatMap((layer) => {
    if (!selected.has(layer.id)) return [];
    const [width = 1, height = 1] = E().export_layer_trimmed_size(layer.id);
    return [{
      id: layer.id,
      baseName: layer.name.replace(/[^\w.-]+/g, "_") || "layer",
      width,
      height,
    }];
  });
}

function exportLayerSelection(
  format: "png" | "jpeg",
  quality = 90,
  requestedRows: readonly Partial<ExportScaleRow>[] = [{ scale: 1, suffix: "" }],
  requestedTargets?: readonly LayerExportTarget[],
  metadataScope?: number,
) {
  const extension = format === "jpeg" ? "jpg" : "png";
  const rows = normalizeExportScaleRows(requestedRows);
  const targets = requestedTargets ?? selectedLayerExportTargets();
  const duplicate = duplicateExportScaleTargetFilename(targets.map((target) => target.baseName), extension, rows);
  if (duplicate) throw new Error(`Duplicate export filename: ${duplicate}`);
  const oversized = targets.flatMap((target) => rows.map((row) => ({ target, row })))
    .find(({ target, row }) => !exportScaleFits(target.width, target.height, row.scale));
  if (oversized) throw new Error(`Export scale exceeds the image-size limit: ${oversized.row.scale}×`);
  const eng = E(); // pinned before a desktop folder pick (see exportAs)
  withExportFolder("Export Layers", targets.length * rows.length, (destDir) => {
    withExportMetadataScope(eng, metadataScope, () => {
    for (const target of targets) {
      for (const row of rows) {
        const filename = exportScaleTargetFilename(target.baseName, extension, row);
        if (format === "jpeg") {
          const bytes = row.scale === 1
            ? eng.export_layer_jpeg_trimmed(target.id, quality)
            : eng.export_layer_scaled_jpeg_trimmed(target.id, row.scale, quality);
          saveBytes(filename, bytes, "image/jpeg", destDir);
        } else {
          const bytes = row.scale === 1
            ? eng.export_layer_png_trimmed(target.id)
            : eng.export_layer_scaled_png_trimmed(target.id, row.scale);
          saveBytes(filename, bytes, "image/png", destDir);
        }
      }
    }
    });
  });
}

/** Layer ▸ Quick Export as PNG: one isolated file per selected layer/group. */
export function quickExportSelectedLayers() {
  exportLayerSelection("png");
}

/** Layer ▸ Export As: selected layers/groups using the saved export format. */
export function exportSelectedLayersAs(
  requestedRows: readonly Partial<ExportScaleRow>[] = [{ scale: 1, suffix: "" }],
  requestedFormat?: "png" | "jpeg",
  requestedQuality?: number,
  requestedTargets?: readonly LayerExportTarget[],
  metadataScope?: number,
) {
  try {
    const format = requestedFormat ?? store.state.exportPrefs.format;
    const quality = Math.max(1, Math.min(100, Math.round(requestedQuality ?? store.state.exportPrefs.quality)));
    exportLayerSelection(format, quality, requestedRows, requestedTargets, metadataScope);
  } catch (e) { reportSave(e); }
}
/** File ▸ Export ▸ Export at Sizes: save the composite at each scale (default
 *  1×/2×/3×) as a PNG with an `@Nx` suffix. */
export function exportSizes(scales: number[] = [1, 2, 3], baseName = "monet-vision") {
  try {
    const rows = normalizeExportScaleRows(scales.map((scale) => ({
      scale,
      suffix: scale === 1 ? "" : `@${scale}x`,
    })));
    const oversized = rows.find((row) => !exportScaleFits(store.state.doc.width, store.state.doc.height, row.scale));
    if (oversized) throw new Error(`Export scale exceeds the image-size limit: ${oversized.scale}×`);
    const eng = E(); // pinned before a desktop folder pick (see exportAs)
    refuseNonRgbFlatExport(eng, "PNG");
    const icc = exportIccBytes();
    withExportFolder("Export at Sizes", rows.length, (destDir) => {
      for (const row of rows) {
        // Tagged like every sibling export — an untagged encoder here re-runs the
        // COLOR-04 failure: the document's assigned profile is silently dropped. (#35)
        saveBytes(exportScaleFilename(baseName, "png", row), eng.export_scaled_png_with_icc(row.scale, icc), "image/png", destDir);
      }
    });
  } catch (e) { reportSave(e); }
}
/** File ▸ Export ▸ Content Credentials: save an unsigned C2PA-style provenance
 *  manifest (JSON sidecar) for the current document. Cryptographic signing needs
 *  a certificate and is out of scope. */
export function exportContentCredentials(baseName = "monet-vision") {
  const stem = baseName.replace(/\.[^.]+$/, "");
  const manifest = E().content_credentials("Monet Vision", new Date().toISOString());
  saveBytes(`${stem}.c2pa.json`, new TextEncoder().encode(manifest), "application/json");
}
/** Provenance headers for the native signer: the container, the document's edit
 *  recipe, the file it was opened from (chained as the `parentOf` ingredient)
 *  and every linked placed source (`componentOf` + `c2pa.placed`). Without the
 *  last two a signed export asserts only "this was created", which is the half
 *  of provenance nobody needs.
 *
 *  Paths are percent-encoded (header values are ASCII, photo paths are not) and
 *  joined with `,` — encoding leaves no comma inside an entry. A source that is
 *  missing or was never linked to a file is dropped: we can't vouch for an
 *  ingredient we never read. Pure so the wiring is testable without a signer. */
export function c2paProvenanceHeaders(
  mime: string,
  actions: string,
  parent: string | null,
  placed: readonly SmartLinkInfo[],
): Record<string, string> {
  const headers: Record<string, string> = { "x-c2pa-mime": mime, "x-c2pa-actions": actions };
  if (parent) headers["x-c2pa-parent"] = encodeURIComponent(parent);
  // Two layers linked to the same file are one ingredient, not two.
  const sources = [...new Set(placed.filter((l) => l.path && !l.missing).map((l) => l.path as string))];
  if (sources.length) headers["x-c2pa-placed"] = sources.map(encodeURIComponent).join(",");
  return headers;
}
/** File ▸ Export ▸ Content Credentials (Signed): export a PNG/JPEG/TIFF with a
 *  cryptographically signed C2PA manifest embedded (native only — signing lives
 *  in the Tauri `c2pa` plugin). In the browser build there is no native signer,
 *  so we fall back to the unsigned JSON sidecar. */
export async function exportSignedContentCredentials(baseName = "monet-vision"): Promise<boolean> {
  const stem = baseName.replace(/\.[^.]+$/, "");
  if (!isTauri()) {
    exportContentCredentials(baseName); // no native crypto in the browser build
    return false;
  }
  try {
    // Dialog first: the chosen extension decides the container (PNG/JPEG/TIFF —
    // every format c2pa-rs embeds natively; the Rust command allowlists the mime).
    const { save } = await import("@tauri-apps/plugin-dialog");
    const target = await save({
      defaultPath: `${stem}.png`,
      filters: [
        { name: "PNG", extensions: ["png"] },
        { name: "JPEG", extensions: ["jpg", "jpeg"] },
        { name: "TIFF", extensions: ["tif", "tiff"] },
      ],
    });
    if (!target) return false;
    assertHistorySettled(E());
    const ext = target.replace(/^.*\./, "").toLowerCase();
    const kind = ext === "jpg" || ext === "jpeg" ? "jpeg" : ext === "tif" || ext === "tiff" ? "tiff" : "png";
    const icc = exportIccBytes();
    const bytes = kind === "jpeg"
      ? E().export_jpeg_with_icc(90, icc)
      : kind === "tiff" ? E().export_tiff_with_icc(icc) : E().export_png_with_icc(icc);
    const { invoke } = await import("@tauri-apps/api/core");
    const signed = new Uint8Array(await invoke<ArrayBuffer>(
      "plugin:c2pa|sign_content_credentials",
      bytes,
      {
        headers: c2paProvenanceHeaders(
          `image/${kind}`,
          E().c2pa_action_list(),
          store.activePath(),
          smart.linkedObjects(),
        ),
      },
    ));
    await atomicWriteBytes(target, signed);
    void runScriptEventBindings("exportDocument");
    return true;
  } catch (e) {
    reportSave(e);
    return false;
  }
}
/** Identity of the C2PA signer that File ▸ Export ▸ Content Credentials (Signed)
 *  will use. Mirrors the Rust `SignerInfo` in `src-tauri/src/c2pa_sign.rs`. */
export interface SignerInfo {
  kind: "dev" | "custom";
  issuer: string;
  cert_serial: string;
  alg: string;
  tsa_url: string | null;
  not_after: string | null;
}

/** Preferences ▸ Content Credentials: the active signer identity, or `null` in
 *  the browser build (signing is native-only). */
export async function contentCredentialsSigner(): Promise<SignerInfo | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SignerInfo>("plugin:c2pa|c2pa_signer_info");
}

/** Read a PEM file the user picks (cert or key). Native only; the bytes are
 *  returned to the caller and never written back to disk by the frontend. */
export async function pickPemFile(label: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    title: label,
    filters: [{ name: "PEM", extensions: ["pem", "crt", "cer", "key"] }],
  });
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) return null;
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return readTextFile(path);
}

/** Import a custom signing cert+key (PEM strings) with an optional RFC-3161 TSA
 *  URL. The Rust side validates by test-signing, then persists `0600`; the key
 *  bytes transit IPC once and are never persisted by the frontend. */
export async function importContentCredentialsSigner(
  certPem: string,
  keyPem: string,
  tsaUrl?: string,
): Promise<SignerInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SignerInfo>("plugin:c2pa|c2pa_import_signer", {
    certPem,
    keyPem,
    tsaUrl: tsaUrl && tsaUrl.trim() ? tsaUrl.trim() : null,
  });
}

/** Remove the custom signer, reverting to the labeled dev signer. */
export async function clearContentCredentialsSigner(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("plugin:c2pa|c2pa_clear_signer");
}

/** File ▸ Export ▸ TIFF: RGBA TIFF of the composite at the document's depth. A
 *  layered document first asks TIFF Options whether to keep its layers. */
export function exportTIFF(name = "monet-vision.tif") {
  try {
    // Pinned before the dialog, so a tab switch cannot export another document.
    const eng = E();
    refuseNonRgbFlatExport(eng, "TIFF");
    const icc = exportIccBytes();
    const write = (layers: boolean) => saveBytes(name, layers ? layeredTiffBytes(eng, icc) : eng.export_tiff_with_icc(icc), "image/tiff");
    if (!tiffLayersPicker || eng.layer_count() <= 1) { write(false); return; }
    tiffLayersPicker((layers) => {
      if (layers === null) return; // Cancel: nothing written
      try { write(layers); } catch (e) { reportSave(e); }
    });
  } catch (e) { reportSave(e); }
}
/** File ▸ Export ▸ WebP: lossless WebP (alpha-preserving) of the composite. */
export function exportWebP(name = "monet-vision.webp") {
  try {
    const eng = E();
    refuseNonRgbFlatExport(eng, "WebP");
    saveBytes(name, eng.export_webp_with_icc(exportIccBytes()), "image/webp");
  } catch (e) { reportSave(e); }
}
/** File ▸ Export ▸ WebP (Lossy): the composite encoded to lossy WebP via the
 *  bundled `@jsquash/webp` WASM encoder (the Rust `image` crate only does
 *  lossless WebP). `quality` is 0–100. */
export async function exportWebPLossy(baseName = "monet-vision", quality = 80) {
  const stem = baseName.replace(/\.[^.]+$/, "");
  const png = E().export_png();
  if (!png.length) return;
  const imageData = await pngToImageData(png);
  if (!imageData) return;
  try {
    const { encodeWebpLossy } = await import("./webpEncoder");
    const buf = await encodeWebpLossy(imageData, quality);
    saveBytes(`${stem}.webp`, new Uint8Array(buf), "image/webp");
  } catch (e) {
    console.error("WebP (lossy) export failed", e);
    if (typeof alert === "function") alert("WebP export failed — the encoder could not be initialized.");
  }
}
/** File ▸ Export ▸ Radiance HDR: 32-bit `.hdr` of the composite. */
export function exportHDR(name = "monet-vision.hdr") {
  try {
    const eng = E();
    refuseNonRgbFlatExport(eng, "HDR");
    saveBytes(name, eng.export_hdr(), "image/vnd.radiance");
  } catch (e) { reportSave(e); }
}
/** File ▸ Export ▸ OpenEXR: 32-bit RGBA `.exr` of the composite. */
export function exportEXR(name = "monet-vision.exr") {
  try {
    const eng = E();
    refuseNonRgbFlatExport(eng, "EXR");
    saveBytes(name, eng.export_exr(), "image/x-exr");
  } catch (e) { reportSave(e); }
}
/** File ▸ Export ▸ DNG: a 16-bit derived linear DNG (not a re-mosaiced camera
 * original). RAW-backed documents retain bounded camera identity and embed the
 * canonical XMP recipe; samples come directly from the 16-bit compositor and
 * are linearized from the document's working profile without an 8-bit round-trip. */
export async function exportDNG(baseName = "monet-vision") {
  try {
    const stem = baseName.replace(/\.[^.]+$/, "");
    const docId = store.state.activeDocId;
    const eng = E();
    // Capture every input from one document synchronously. A tab switch or
    // close must never mix another document's ICC/source metadata into these
    // already-pinned pixels.
    const document = store.docDocumentMeta(docId, { includeCameraRaw: false });
    const rawExport = store.cameraRawExportSnapshotForDoc(docId);
    const profileId = eng.doc_profile();
    const width = eng.width(), height = eng.height();
    const rgba16 = eng.export_composite_rgba16();
    if (rgba16.length !== width * height * 4) throw new Error("Could not read the 16-bit document composite");
    const bytes = buildDNG16(rgba16, width, height, {
      inputProfile: resolveDNGInputProfile(profileId, !!document?.iccProfileBytes?.length),
      metadata: rawExport.metadata,
      xmp: rawExport.xmp,
    });
    saveBytes(`${stem}.dng`, bytes, "image/x-adobe-dng");
  } catch (error) {
    reportSave(error);
  }
}
/** File ▸ Export ▸ HEIC: the composite encoded to `.heic` via the macOS OS codec
 *  (ImageIO/HEVC) in the native `heic` plugin — HEVC encode is patent-encumbered,
 *  so, like the HEIC open path, there is no wasm encoder. Desktop-macOS only;
 *  the browser build surfaces a clean "requires the desktop app" message.
 *  `quality` is 0–100. */
export async function exportHEIC(baseName = "monet-vision", quality = 80) {
  const stem = baseName.replace(/\.[^.]+$/, "");
  if (!isTauri()) {
    if (typeof alert === "function") alert("HEIC export requires the Monet Vision desktop app (macOS).");
    return;
  }
  const png = E().export_png();
  if (!png.length) return;
  const imageData = await pngToImageData(png);
  if (!imageData) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { width, height, data } = imageData;
    // Body: [w u32 le][h u32 le][quality u8][rgba…] — matches the native command.
    const body = new Uint8Array(9 + data.length);
    const dv = new DataView(body.buffer);
    dv.setUint32(0, width, true);
    dv.setUint32(4, height, true);
    body[8] = Math.min(100, Math.max(0, Math.round(quality)));
    body.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 9);
    const out = new Uint8Array(await invoke<ArrayBuffer>("plugin:heic|encode_heic", body));
    if (!out.length) throw new Error("HEIC encoder returned no data");
    saveBytes(`${stem}.heic`, out, "image/heic");
  } catch (e) {
    console.error("HEIC export failed", e);
    if (typeof alert === "function") alert("HEIC export failed — the macOS encoder could not produce the file.");
  }
}
interface WebExportPixelWork {
  lut: Uint8Array | null;
  lutN: number;
  matte: number | null;
}

/** The pixel work Save for Web's Matte / Convert to sRGB ask for, or null when
 *  both are no-ops — then the tagged engine encoders stay on the fast path.
 *  Untagged documents already count as sRGB everywhere (View, exports), so
 *  there is nothing to convert for them. */
function webExportPixelWork(prefs: Pick<WebExportPrefs, "matte" | "convertToSRgb">): WebExportPixelWork | null {
  const matte = matteLevel(prefs.matte);
  let lut: Uint8Array | null = null;
  let lutN = 0;
  if (prefs.convertToSRgb && store.state.colorProfileAssigned) {
    const baked = E().display_lut(DISPLAY_LUT_SIZE, exportIccBytes());
    const n = lutSizeFor(baked);
    if (n) { lut = baked; lutN = n; }
  }
  return lut || matte !== null ? { lut, lutN, matte } : null;
}

/** The composite on a canvas with the Save for Web pixel work applied. */
async function webExportCanvas(work: WebExportPixelWork | null): Promise<HTMLCanvasElement | null> {
  const img = await webExportImageData(work);
  return img ? imageDataCanvas(img) : null;
}

/** The composite as pixels, with Matte / Convert to sRGB already applied. The
 *  WebP and AVIF encoders take ImageData, so they branch off here rather than
 *  round-tripping through a canvas. */
async function webExportImageData(work: WebExportPixelWork | null): Promise<ImageData | null> {
  // (#33) Unmanaged decode: `work.lut` is the document→sRGB conversion, so the
  // browser must not have converted these pixels already.
  const img = await pngToImageData(E().export_png(), false);
  if (!img) return null;
  if (work) applyWebExportPixels(img.data, work.lut, work.lutN, work.matte);
  return img;
}

function imageDataCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

async function encodeModernWebImage(
  img: ImageData, format: "webp" | "avif", quality: number,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    if (format === "webp") {
      const { encodeWebpLossy } = await import("./webpEncoder");
      return { bytes: new Uint8Array(await encodeWebpLossy(img, quality)), mime: webExportMime(format) };
    }
    const { encode } = await import("@jsquash/avif");
    return { bytes: new Uint8Array(await encode(img, { quality })), mime: webExportMime(format) };
  } catch (e) {
    console.error(`Save for Web ${format} encode failed`, e);
    return null;
  }
}

/** Encode a region of `src`. These bytes are untagged — Save for Web's
 *  contract, and what Convert to sRGB makes true. */
async function canvasRegionBytes(
  src: HTMLCanvasElement, sx: number, sy: number, w: number, h: number,
  format: SaveForWebFormat, quality: number,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cx = c.getContext("2d");
  if (!cx) return null;
  cx.drawImage(src, sx, sy, w, h, 0, 0, w, h);
  if (format === "webp" || format === "avif") return encodeModernWebImage(cx.getImageData(0, 0, w, h), format, quality);
  const jpeg = format === "jpeg";
  const blob = await new Promise<Blob | null>((res) =>
    c.toBlob(res, jpeg ? "image/jpeg" : "image/png", jpeg ? quality / 100 : undefined));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

async function saveCanvasRegion(
  name: string, src: HTMLCanvasElement, sx: number, sy: number, w: number, h: number,
  format: SaveForWebFormat, quality: number, destDir?: string,
): Promise<boolean> {
  const out = await canvasRegionBytes(src, sx, sy, w, h, format, quality);
  if (!out) return false;
  return saveBytes(name, out.bytes, out.mime, destDir);
}

/** Everything Save for Web encodes with: the persisted prefs plus the choices
 *  the dialog owns for the session (modern formats, metadata scope). */
export interface SaveForWebOptions {
  format: SaveForWebFormat;
  quality: number;
  matte: WebExportMatte;
  convertToSRgb: boolean;
  metadata: SaveForWebMetadata;
}

/** The stored prefs as a full option set, with any dialog overrides on top. */
export function saveForWebOptions(overrides?: Partial<SaveForWebOptions>): SaveForWebOptions {
  const prefs = store.state.webExportPrefs;
  return {
    format: prefs.format,
    quality: prefs.quality,
    matte: prefs.matte,
    convertToSRgb: prefs.convertToSRgb,
    metadata: "all",
    ...overrides,
  };
}

/** The exact bytes Save for Web writes for a whole-composite export. Slice
 *  exports use the same format encoders on each region, so their sizes vary.
 *  Null when the composite could not be rendered or the encoder refused. */
export async function webExportBytes(opts: SaveForWebOptions): Promise<{ bytes: Uint8Array; mime: string } | null> {
  // GIF stays on the engine's animated palette encoder — it owns the frames and
  // the canvas has no GIF path, so Matte / Convert to sRGB do not reach it.
  // ponytail: no palette / colours / dither / lossy controls either; they need
  // `export_gif` to take an options struct (engine + wasm rebuild).
  if (opts.format === "gif") return { bytes: E().export_gif(10), mime: "image/gif" };
  const work = webExportPixelWork(opts);
  // Nothing to do to the pixels and metadata kept → the tagged engine encoders,
  // byte-for-byte what File ▸ Export writes. "none" deliberately falls through
  // to the canvas: the engine tags its working profile even for empty ICC bytes,
  // so untagged output is only reachable via `toBlob`.
  if (!work && opts.metadata === "all") {
    if (opts.format === "png") return { bytes: E().export_png_with_icc(exportIccBytes()), mime: "image/png" };
    if (opts.format === "jpeg") return { bytes: E().export_jpeg_with_icc(opts.quality, exportIccBytes()), mime: "image/jpeg" };
  }
  const img = await webExportImageData(work);
  if (!img) return null;
  if (opts.format === "webp" || opts.format === "avif") return encodeModernWebImage(img, opts.format, opts.quality);
  const c = imageDataCanvas(img);
  return canvasRegionBytes(c, 0, 0, c.width, c.height, opts.format, opts.quality);
}

/** Save for Web's "Optimize to File Size": search Quality for the largest
 *  encode of the current composite that still fits `targetBytes`, and report
 *  it. Null for formats with no quality knob (PNG/GIF) or when encoding fails —
 *  the caller keeps its current quality rather than silently changing it. */
export async function optimizeWebExportToFileSize(
  opts: SaveForWebOptions, targetBytes: number,
): Promise<{ quality: number; bytes: number } | null> {
  if (!webQualityApplies(opts.format)) return null;
  let failed = false;
  const best = await optimizeQualityToSize(targetBytes, async (quality) => {
    const out = await webExportBytes({ ...opts, quality });
    if (!out) { failed = true; return Number.MAX_SAFE_INTEGER; }
    return out.bytes.length;
  });
  return failed ? null : best;
}

/** File ▸ Save for Web: export with web-oriented format/quality preferences.
 *  Matte composites transparency against the chosen colour and Convert to sRGB
 *  runs the composite through the engine's document → sRGB LUT; with neither
 *  asked for, the tagged engine encoders write the bytes as before.
 *  `overrides` carries the dialog's session-only choices. */
export async function saveForWeb(baseName = "monet-vision", overrides?: Partial<SaveForWebOptions>): Promise<number> {
  try {
    const prefs = saveForWebOptions(overrides);
    const slices = store.state.slices
      .map((sl) => clampSliceToDoc(sl, E().width(), E().height()))
      .filter((sl): sl is Slice => !!sl);
    if (!slices.length) {
      const out = await webExportBytes(prefs);
      if (!out) throw new Error("Save for Web could not encode this document in the chosen format.");
      return (await saveBytes(saveForWebFilename(baseName, prefs.format), out.bytes, out.mime)) ? 1 : 0;
    }
    // Desktop: all slices land in ONE picked folder — a save panel per slice
    // would bury the user, and cancelling the pick writes nothing. A single
    // slice still gets saveBytes' own panel.
    let destDir: string | undefined;
    if (slices.length > 1 && isTauri()) {
      const picked = await pickExportFolder("Export Slices");
      if (picked === null) return 0;
      destDir = picked;
    }
    const work = webExportPixelWork(prefs);
    const full = await webExportCanvas(work);
    if (!full) throw new Error("Save for Web could not render this document.");
    const format = prefs.format === "gif" ? "png" : prefs.format;
    if (prefs.format === "gif") notify("Animated GIF cannot be encoded per slice; the slices were exported as PNG.");
    const ext = format === "jpeg" ? "jpg" : format;
    const stem = baseName.replace(/\.[^.]+$/, "");
    let count = 0;
    for (const [i, sl] of slices.entries()) {
      if (await saveCanvasRegion(sliceExportName(stem, i, ext), full, sl.x, sl.y, sl.w, sl.h, format, prefs.quality, destDir)) count++;
    }
    // A desktop run that wrote nothing was cancelled (or each failure already
    // alerted) — "0 of N could not be encoded" would misreport both.
    if (count < slices.length && (count > 0 || !isTauri())) notify(`Exported ${count} of ${slices.length} slices — ${slices.length - count} could not be encoded.`);
    return count;
  } catch (e) {
    reportSave(e);
    return 0;
  }
}

/** PDF page-image quality — Photoshop's "High" JPEG preset. */
const PDF_DEFAULT_QUALITY = 0.9;

async function pngToJpegPage(png: Uint8Array, quality = PDF_DEFAULT_QUALITY): Promise<{ jpeg: Uint8Array; w: number; h: number } | null> {
  // Unmanaged decode: the page is tagged with the document's ICC profile by
  // pdfDocument, so its samples must still BE in that space — a colour-managed
  // decode hands back browser-converted sRGB, and every viewer would then
  // re-expand those numbers through the wide-gamut tag. (#34, same root as #33)
  const img = await pngToImageData(png, false);
  if (!img) return null;
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", quality));
  if (!blob) return null;
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), w: img.width, h: img.height };
}

/** Decode an engine PNG to pixels. `colorManaged` false decodes the bytes as
 *  authored: `export_png` tags the document's working profile as an iCCP chunk,
 *  and an `<img>`/drawImage decode IS colour-managed in both WebKit and Chromium,
 *  so a managed decode hands back values the browser already converted to sRGB —
 *  applying the document→sRGB LUT on top of those converts a SECOND time. Save
 *  for Web (which owns that LUT) decodes unmanaged; the direct AVIF/WebP/HEIC
 *  exports carry no LUT and write untagged files, so they keep the browser's
 *  single conversion. (#33) */
export async function pngToImageData(png: Uint8Array, colorManaged = true): Promise<ImageData | null> {
  const blob = new Blob([png as unknown as BlobPart], { type: "image/png" });
  // `colorSpaceConversion: "none"` is the only decode path that ignores iCCP.
  const raw = !colorManaged && typeof createImageBitmap === "function"
    ? await createImageBitmap(blob, { colorSpaceConversion: "none" })
    : null;
  const url = raw ? "" : URL.createObjectURL(blob);
  try {
    const img: ImageBitmap | HTMLImageElement = raw ?? await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  } finally {
    if (url) URL.revokeObjectURL(url);
    raw?.close();
  }
}

/** File ▸ Export ▸ AVIF: the composite encoded to AVIF via the bundled
 *  `@jsquash/avif` WASM encoder (the Rust `image` AVIF encoder can't compile to
 *  WASM). `quality` is 0–100. */
export async function exportAVIF(baseName = "monet-vision", quality = 60) {
  const stem = baseName.replace(/\.[^.]+$/, "");
  const png = E().export_png();
  if (!png.length) return;
  const imageData = await pngToImageData(png);
  if (!imageData) return;
  try {
    const { encode } = await import("@jsquash/avif");
    const buf = await encode(imageData, { quality });
    saveBytes(`${stem}.avif`, new Uint8Array(buf), "image/avif");
  } catch (e) {
    console.error("AVIF export failed", e);
    if (typeof alert === "function") alert("AVIF export failed — the encoder could not be initialized.");
  }
}

// Image ▸ Variables: preflight every replacement, then commit the whole row.
export const dataVars = {
  /** `report` receives the refusal; the Data Sets dialog shows it in place of the toast. */
  async apply(index: number, signal?: AbortSignal, report: (message: string) => void = notify): Promise<boolean> {
    const sets = store.state.dataSets, variables = store.state.variables;
    const row = sets[index];
    if (!row) return false;
    const e = E();
    const stamp = editStamp(engine);
    try {
      assertHistorySettled(e);
      if (store.state.maskEdit || store.state.channelTarget != null || store.state.quickMask) throw new Error("Select the layer's image thumbnail before applying a data set.");
      const replacements: { id: number; type: "vis" | "text" | "pixel"; value: string; bytes?: Uint8Array }[] = [];
      for (const variable of variables) {
        if (!variable.name || !(variable.name in row)) continue;
        const matches = store.state.layers.filter((l) => l.name === variable.layer);
        if (matches.length !== 1) throw new Error(`Variable “${variable.name}” needs a unique layer named “${variable.layer}”.`);
        const layer = matches[0];
        if (layer.locked || (variable.type !== "vis" && ((layer.locks ?? 0) & 3))) throw new Error(`Unlock “${layer.name}” before applying this data set.`);
        if (variable.type === "text" && layer.kind !== LAYER_KIND.text) throw new Error(`“${layer.name}” is not a text layer.`);
        const replacement = { id: layer.id, type: variable.type, value: row[variable.name], bytes: undefined as Uint8Array | undefined };
        if (variable.type === "pixel") {
          if (layer.kind !== LAYER_KIND.pixel) throw new Error(`Pixel Replacement needs a raster pixel layer: “${layer.name}”.`);
          if (!isTauri()) throw new Error("Pixel Replacement reads local image paths in the Monet Vision desktop app.");
          const path = variableImagePath(replacement.value, store.state.dataSetBaseDir);
          replacement.bytes = await readNativeImagePath(path, "place");
          const decoded = engine.buildImage(replacement.bytes); // bounded engine decode before ANY layer is changed
          decoded.free();
        }
        signal?.throwIfAborted();
        replacements.push(replacement);
      }
      if (docChanged(engine, stamp) || engine.engine !== e || sets !== store.state.dataSets || variables !== store.state.variables) throw new Error("The document changed while reading data-set images. Apply again.");
      signal?.throwIfAborted();
      if (!replacements.length) return true;
      if (!e.begin_history_transaction()) throw new Error("Finish or cancel the current edit before applying a data set.");
      try {
        const before = e.undo_pushes();
        e.clear_last_edit_error();
        e.push_history(`Apply Data Set ${index + 1}`);
        const first = e.undo_pushes();
        if (first === before) throw new Error(e.last_edit_error() || "The engine refused this data set.");
        for (const replacement of replacements) {
          if (replacement.type === "vis") e.set_layer_visible(replacement.id, /^(1|true|yes|on)$/i.test(replacement.value));
          else if (replacement.type === "text") {
            const spec = getTextSpec(replacement.id);
            if (!spec) throw new Error("The bound text layer has an invalid text specification.");
            const changed = setText(spec, replacement.value);
            const raster = rasterizeSpec(changed);
            e.set_text_layer_spec(replacement.id, raster.placeX, raster.placeY, raster.w, raster.h, new Uint8Array(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength), JSON.stringify(changed));
          } else {
            // Existing content replacement preserves masks, properties, offset and
            // the footprint; the temporary Smart Object never escapes the transaction.
            e.convert_to_smart_object(replacement.id);
            if (e.layer_kind(replacement.id) !== LAYER_KIND.smartObject) throw new Error(`Could not replace pixels in layer #${replacement.id}.`);
            e.replace_smart_object_preserve_placement(replacement.id, replacement.bytes!);
            e.rasterize_smart_object(replacement.id);
          }
          const error = e.last_edit_error();
          if (error) throw new Error(error);
        }
        const steps = e.undo_pushes() - first;
        for (let n = 0; n < steps; n++) e.drop_last_undo();
        if (!e.commit_history_transaction()) throw new Error("The engine refused this data set.");
        engine.commit();
        store.setActiveDataSet(index);
        return true;
      } catch (error) {
        e.cancel_history_transaction();
        if (engine.engine === e) engine.refreshFromEngine();
        throw error;
      }
    } catch (error) {
      if (!signal?.aborted) report(`Could not apply data set ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  },
  /** Await each image replacement before encoding its data set. */
  async exportAll(signal?: AbortSignal): Promise<boolean> {
    const sets = store.state.dataSets;
    const docId = store.state.activeDocId;
    // Desktop: every set lands in ONE picked folder — a save panel per set
    // would stop the run; cancelling it applies nothing. Browser: one download
    // per set, as before.
    let destDir: string | undefined;
    if (sets.length > 1 && isTauri()) {
      const picked = await pickExportFolder("Export Data Sets as Files");
      if (picked === null) return false;
      destDir = picked;
    }
    for (let i = 0; i < sets.length; i++) {
      if (signal?.aborted || store.state.activeDocId !== docId || store.state.dataSets !== sets || !await this.apply(i, signal)) return false;
      if (signal?.aborted || store.state.activeDocId !== docId) return false;
      saveBytes(`dataset_${i + 1}.png`, E().export_png_with_icc(exportIccBytes()), "image/png", destDir);
    }
    return true;
  },
  async importFile(): Promise<boolean> {
    const docId = store.state.activeDocId;
    try {
      let csv: string, baseDir = "";
      const limit = { maxBytes: 8 * 1024 * 1024, label: "Variable data sets CSV" };
      if (isTauri()) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const path = await open({ multiple: false, filters: [{ name: "Data Sets", extensions: ["csv", "txt"] }] });
        if (typeof path !== "string") return false;
        csv = decodeImportText(await readNativeFileBounded(path, () => limit));
        baseDir = path.replace(/[\\/][^\\/]*$/, "");
      } else {
        const file = await new Promise<File | null>((resolve) => {
          const input = document.createElement("input");
          input.type = "file"; input.accept = ".csv,.txt,text/csv";
          input.onchange = () => { resolve(input.files?.[0] ?? null); input.remove(); };
          input.oncancel = () => { input.remove(); resolve(null); };
          document.body.appendChild(input); input.click();
        });
        if (!file) return false;
        csv = await readBrowserImportText(file, limit);
      }
      if (store.state.activeDocId !== docId) throw new Error("The active document changed; import the CSV again.");
      store.importDataSets(csv, baseDir);
      return true;
    } catch (error) {
      notify(`Could not import data sets: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  },
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/** File ▸ Export ▸ Zoomify: the tiled JPEG pyramid Photoshop writes —
 *  `ImageProperties.xml`, `TileGroupN/z-x-y.jpg` per halving level and a
 *  viewer page that streams whichever tiles are in view. Every tile is encoded
 *  by the engine and written before the next is asked for, so a gigapixel
 *  document never holds a level, let alone the composite, as encoded bytes.
 *  Desktop writes a `<stem>/` folder under a chosen location; the browser
 *  downloads the same tree as one zip. (#465) */
export async function exportZoomify(stem = "zoomify") {
  return reportSaveExport(async () => {
    const eng = E() as unknown as {
      export_pyramid_tile_jpeg?: (x: number, y: number, w: number, h: number, div: number, quality: number, icc: Uint8Array) => Uint8Array;
    };
    if (typeof eng.export_pyramid_tile_jpeg !== "function") throw new Error("This engine build cannot write Zoomify tiles.");
    const w = E().width(), h = E().height();
    const icc = exportIccBytes();
    const out = await zoomifyWriter(stem);
    if (!out) return;
    E().composite(); // once: every tile reads this build, not its own
    let count = 0;
    for (const t of zoomifyTiles(w, h)) {
      const jpeg = eng.export_pyramid_tile_jpeg(t.x, t.y, t.w, t.h, t.div, ZOOMIFY_QUALITY, icc);
      if (!jpeg.length) throw new Error(`Could not encode tile ${t.path}.`);
      await out.file(t.path, jpeg);
      count++;
    }
    const text = new TextEncoder();
    await out.file("ImageProperties.xml", text.encode(zoomifyImageProperties(w, h, count)));
    await out.file(`${stem}.html`, text.encode(zoomifyViewerHtml(stem, w, h)));
    await out.finish();
    void runScriptEventBindings("exportDocument");
  });
}

/** The multi-file sink behind Zoomify: on desktop a folder picked by the user
 *  (`exportLayersToFiles`' shape, one write per file); in the browser the
 *  files collect into a STORE zip handed to the download anchor at the end.
 *  ponytail: the zip holds every tile until `finish`; `showDirectoryPicker`
 *  would stream it, but only Chromium ships it. Null when the picker is
 *  cancelled. */
async function zoomifyWriter(stem: string): Promise<{ file: (path: string, bytes: Uint8Array) => Promise<void>; finish: () => Promise<void> } | null> {
  if (isTauri()) {
    const [{ open }, fs] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
    const picked = await open({ directory: true, multiple: false, title: "Zoomify Export Folder" });
    if (typeof picked !== "string") return null;
    const root = `${picked}/${stem}`;
    const made = new Set<string>();
    return {
      file: async (path, bytes) => {
        const dir = `${root}/${path.slice(0, path.lastIndexOf("/") + 1)}`;
        if (!made.has(dir)) {
          try { await fs.mkdir(dir, { recursive: true }); } catch { /* already exists */ }
          made.add(dir);
        }
        await atomicWriteBytes(`${root}/${path}`, bytes);
      },
      finish: async () => {},
    };
  }
  const files: [string, Uint8Array][] = [];
  return {
    file: async (path, bytes) => { files.push([`${stem}/${path}`, bytes]); },
    finish: async () => { await saveBytes(`${stem}.zip`, zipStore(files), "application/zip"); },
  };
}

// ── PDF export (VIS-PRINT-02) ──────────────────────────────────────
// Photoshop's PDF Options in the two knobs that change the bytes: which preset
// the file conforms to, and how the page raster is compressed. Every PDF Vision
// writes goes through `pdfDocument` so the profile, the page size in points and
// the document Info reach all of them, not just File ▸ Export ▸ PDF.
export interface PdfExportOptions {
  preset?: PdfPreset;
  compression?: "jpeg" | "lossless";
  quality?: number; // 0..1, JPEG only
}
// The bundled press profile behind View ▸ Proof Setup ▸ Working CMYK doubles as
// the PDF/X-1a output intent — a CMYK PDF/X without one is not PDF/X at all.
const PRESS_PROFILE_URL = "/profiles/ISOcoated_v2_300_eci.icc";

/** Encode one composite PNG as a page image: DCTDecode at `quality`, or
 *  lossless FlateDecode RGB when the prepress side asks for no generation loss. */
async function pdfPageFromPng(
  png: Uint8Array,
  opts: PdfExportOptions,
  ppi = store.state.resolutionPpi,
): Promise<PdfPage | null> {
  if (opts.compression === "lossless") {
    const img = await pngToImageData(png, false); // document-space samples, see pngToJpegPage (#34)
    if (!img) return null;
    const data = await deflate(rgbFromRgba(img.data));
    return { image: { data, filter: "FlateDecode", w: img.width, h: img.height, space: "rgb" }, ppi };
  }
  const pg = await pngToJpegPage(png, opts.quality ?? PDF_DEFAULT_QUALITY);
  return pg && { image: { data: pg.jpeg, filter: "DCTDecode", w: pg.w, h: pg.h, space: "rgb" }, ppi };
}

/** PDF/X-1a admits no RGB, so the page carries the engine's own ink plates —
 *  the same separation the Channels panel and the CMYK PSD writer produce. */
async function pdfCmykPage(ppi = store.state.resolutionPpi): Promise<PdfPage | null> {
  const psd = await cmykPsdBytes();
  const plates = psd.length ? cmykFromPsd(psd) : null;
  if (!plates) return null;
  const data = await deflate(plates.data);
  return { image: { data, filter: "FlateDecode", w: plates.w, h: plates.h, space: "cmyk" }, ppi };
}

async function pressOutputIntent(): Promise<PdfOutputIntent | null> {
  // A document Convert to Profile separated through its own CMYK profile has
  // its plates made for that condition (cmykPsdBytes), so that is the intent —
  // unless this build refused the saved profile: the built-in model then made
  // the plates, and they print for the bundled press condition below.
  const own = E().mode_profile_icc();
  if (own.length && !E().mode_profile_error() && iccColorMode(String.fromCharCode(...own.subarray(16, 20))) === 2) {
    return { icc: own, components: 4, identifier: "Custom", condition: E().mode_profile_name() || "Custom CMYK" };
  }
  try {
    const res = await fetch(PRESS_PROFILE_URL);
    if (!res.ok) return null;
    return {
      icc: new Uint8Array(await res.arrayBuffer()),
      components: 4,
      identifier: "FOGRA39L",
      condition: "ISO coated v2 300% (ECI)",
    };
  } catch {
    return null; // asset missing (browser build without the profile) — refuse below
  }
}

/** Type layers as invisible text over the page raster, so a flattened PDF still
 *  searches and copies. ponytail: one line per hard break at the layer anchor —
 *  no wrapping, kerning or warp, and Helvetica metrics stand in for the real
 *  face; embedding a subsetted font (and reusing the paragraph composer) is the
 *  upgrade path to visible vector type. */
function pdfTextLines(eng: ReturnType<typeof E>): PdfTextLine[] {
  const lines: PdfTextLine[] = [];
  for (let i = 0; i < eng.layer_count(); i++) {
    const id = eng.layer_id_at(i);
    if (eng.layer_kind(id) !== 2 || !eng.layer_visible(id)) continue;
    const spec = getTextSpecFrom(eng, id);
    if (!spec) continue;
    const leading = spec.leading > 0 ? spec.leading : spec.size * 1.2;
    fullText(spec).split("\n").forEach((line, i) => {
      if (line.trim()) lines.push({ x: spec.ax, y: spec.ay + spec.size + i * leading, size: spec.size, text: line });
    });
  }
  return lines;
}

/** Assemble the PDF bytes for `pages` under `preset`, or null when the preset's
 *  colour requirements can't be met — a file that claims PDF/X without an output
 *  intent (or with untagged colour) is worse than no file at all. */
async function pdfDocument(
  pages: PdfPage[],
  title: string,
  preset: PdfPreset,
  document = store.docDocumentMeta(store.state.activeDocId),
): Promise<Uint8Array | null> {
  if (!pages.length) return null;
  const icc = exportIccBytes(document);
  if (preset === "x4" && !icc.length) {
    if (typeof alert === "function") alert("PDF/X-4 needs a colour profile.\nAssign one with Edit ▸ Assign Profile, then export again.");
    return null;
  }
  // X-4 states its colour through the document profile; X-1a through the press
  // condition its plates were separated for.
  const outputIntent = preset === "x1a"
    ? await pressOutputIntent()
    : preset === "x4" ? { icc, components: 3 as const, identifier: "Document RGB", condition: document?.iccProfileName ?? "Document RGB" } : null;
  if (preset !== "standard" && !outputIntent) {
    if (typeof alert === "function") alert("PDF/X-1a needs the bundled press profile, which could not be loaded.");
    return null;
  }
  return buildPdf(pages, { preset, icc: icc.length ? icc : null, outputIntent, title });
}

/** File ▸ Automate ▸ PDF Presentation: one page per open document. */
export async function pdfPresentation() {
  return reportSaveExport(async () => {
    const pages: PdfPage[] = [];
    for (const png of store.eachDocPng()) {
      if (!png.length) continue;
      const pg = await pdfPageFromPng(png, {});
      if (pg) pages.push(pg);
    }
    if (!pages.length) return;
    const bytes = await pdfDocument(pages, "Presentation", "standard");
    if (!bytes) throw new Error("Could not build the PDF presentation.");
    saveBytes("Presentation.pdf", bytes, "application/pdf");
  });
}

/** File ▸ Export ▸ Artboards to PDF: one page per artboard. */
export async function exportArtboardsToPDF() {
  try {
    const count = E().artboard_count();
    if (count === 0) return;
    const pages: PdfPage[] = [];
    for (let i = 0; i < count; i++) {
      const png = E().export_artboard_png(i);
      if (!png.length) continue;
      const pg = await pdfPageFromPng(png, {});
      if (pg) pages.push(pg);
    }
    const bytes = await pdfDocument(pages, "Artboards", "standard");
    if (bytes) saveBytes("Artboards.pdf", bytes, "application/pdf");
  } catch (error) {
    // Isolated artboard export refuses an imported-Photoshop document with an
    // unreconcilable rejected edit — report it instead of escaping the handler.
    reportSave(error);
  }
}

/** File ▸ Export ▸ PDF: a print-ready single-page PDF of the flattened
 *  composite. The default preset tags the page with the document profile, sizes
 *  it in points from the document resolution and keeps type searchable; the
 *  PDF/X presets add the output intent and the identification each standard
 *  wants (X-1a separates to CMYK plates and drops the unembedded type). */
export async function exportPDF(baseName = "monet-vision", opts: PdfExportOptions = {}) {
  return reportSaveExport(async () => {
    const stem = baseName.replace(/\.[^.]+$/, "");
    const bytes = await pdfCompositeBytes(E(), stem, opts);
    if (!bytes) throw new Error("Could not build the PDF for this document.");
    saveBytes(`${stem}.pdf`, bytes, "application/pdf");
  });
}

/** The single-page PDF bytes for `eng`'s composite, or null when the preset's
 *  colour requirements can't be met (or the composite is empty). Shared by
 *  File ▸ Export ▸ PDF and Save As ▸ PDF. The engine read happens before the
 *  first await, so the pixels are pinned to the document the caller chose. */
async function pdfCompositeBytes(
  eng: ReturnType<typeof E>,
  title: string,
  opts: PdfExportOptions,
  document = store.docDocumentMeta(store.state.activeDocId),
): Promise<Uint8Array | null> {
  const preset = opts.preset ?? "standard";
  const ppi = document?.resolutionPpi ?? store.state.resolutionPpi;
  let page: PdfPage | null;
  if (preset === "x1a") {
    page = await pdfCmykPage(ppi);
  } else {
    const png = eng.export_png();
    if (!png.length) return null;
    // Capture the searchable type overlay from the same pinned engine before
    // the image decode awaits; another tab may become active in the meantime.
    const text = preset === "standard" ? pdfTextLines(eng) : undefined;
    page = await pdfPageFromPng(png, opts, ppi);
    // Unembedded base-14 type would break PDF/X conformance, so searchable text
    // is a standard-preset feature.
    if (page && text) page.text = text;
  }
  if (!page) return null;
  return pdfDocument([page], title, preset, document);
}

/** File ▸ Export ▸ PDF/X-1a (CMYK plates + press output intent) and PDF/X-4
 *  (tagged RGB, PDF 1.6 + XMP) — the two prepress delivery presets. */
export const exportPDFX1a = (baseName = "monet-vision") => exportPDF(baseName, { preset: "x1a" });
export const exportPDFX4 = (baseName = "monet-vision") => exportPDF(baseName, { preset: "x4", compression: "lossless" });

/** File ▸ Export ▸ Color Lookup Tables: the document's adjustment-layer colour
 *  transform baked into a 3D .cube LUT. */
export function exportColorLUT(name = "lut.cube") {
  try {
    const cube = E().export_color_lut(33);
    saveBytes(name, new TextEncoder().encode(cube), "text/plain");
  } catch (e) { reportSave(e); }
}

// ── 3D LUT import (Adobe .cube / Autodesk .3dl) — inverse of exportColorLUT ──
const LUT_FILTERS = [{ name: "3D LUT (Cube/3DL)", extensions: ["cube", "3dl"] }];
const LUT_ACCEPT = ".cube,.3dl,text/plain,application/octet-stream";
const LUT_IMPORT_LIMIT: LocalImportLimit = { maxBytes: MAX_CUBE_LUT_IMPORT_BYTES, label: "3D LUT" };

/** Apply a .cube or .3dl 3D LUT (parsed from its text) to the composite, baking
 *  the graded result onto a new layer. Returns false if the text isn't a valid LUT. */
export async function applyColorLutCube(text: string): Promise<boolean> {
  const lut = parseCubeLut(text) ?? parse3dlLut(text);
  if (!lut) return false;
  await bakeColorLut(lut);
  return true;
}

async function bakeColorLut(lut: CubeLut): Promise<void> {
  const eng = E();
  const w = eng.width(), h = eng.height();
  // The engine's own samples. Decoding export_png through <img> is colour-managed,
  // so a Display P3 or Adobe RGB document would be graded as sRGB and stamped back. (#550)
  const rgba16 = eng.export_composite_rgba16();
  if (rgba16.length !== w * h * 4) throw new Error("Could not read the document composite for the 3D LUT.");
  const graded = applyCubeLut16(lut, rgba16);
  const saved = eng.has_selection() ? new Uint8Array(eng.get_selection_mask()) : null;
  store.markDirty();
  store.addLayer();
  // stamp clips to the selection. Clear only for the stamp, then put it back.
  if (saved) eng.select_none();
  const stamp16 = (eng as ReturnType<typeof E> & { stamp_image_rgba16?: (x: number, y: number, iw: number, ih: number, rgba: Uint16Array) => void }).stamp_image_rgba16;
  if (eng.doc_depth() > 8 && stamp16) stamp16.call(eng, 0, 0, w, h, graded);
  else {
    const rgba8 = new Uint8Array(graded.length);
    for (let i = 0; i < graded.length; i++) rgba8[i] = graded[i] >> 8;
    eng.stamp_image(0, 0, w, h, rgba8);
  }
  if (saved) eng.set_selection_mask(saved);
  engine.commit();
}

function parseColorLut(text: string): CubeLut {
  const lut = parseCubeLut(text) ?? parse3dlLut(text);
  if (!lut) throw new Error("Not a supported 3D LUT (.cube / .3dl) — it may be a 1D LUT or an unsupported variant.");
  return lut;
}

/** Pick a .cube/.3dl file and parse it. Null when cancelled or unusable (the
 *  failure is reported, like every import). Shared by File ▸ Import ▸ 3D LUT
 *  (bakes) and the Color Lookup adjustment layer's Load 3D LUT… (#441, live). */
export async function pickColorLutFile(): Promise<CubeLut | null> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: false, filters: LUT_FILTERS });
      if (!sel || Array.isArray(sel)) return null;
      const bytes = await readNativeFileBounded(sel, () => LUT_IMPORT_LIMIT);
      return parseColorLut(decodeImportText(bytes));
    } catch (e) {
      reportOpen("3D LUT", e);
      return null;
    }
  }
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = LUT_ACCEPT;
    inp.onchange = async () => {
      const file = inp.files?.[0] ?? null;
      inp.remove();
      if (!file) { resolve(null); return; }
      try {
        resolve(parseColorLut(await readBrowserImportText(file, LUT_IMPORT_LIMIT)));
      } catch (e) {
        reportOpen(file.name, e);
        resolve(null);
      }
    };
    inp.oncancel = () => { inp.remove(); resolve(null); };
    document.body.appendChild(inp);
    inp.click();
  });
}

/** File ▸ Import ▸ 3D LUT: pick a .cube file and apply it to the document. */
export async function importColorLutFile(): Promise<boolean> {
  const lut = await pickColorLutFile();
  if (!lut) return false;
  try {
    await bakeColorLut(lut);
    return true;
  } catch (e) {
    reportOpen("3D LUT", e);
    return false;
  }
}

// ── View ▸ Proof Setup ▸ Custom: device profile + proof-setup files ────────
const ICC_FILTERS = [{ name: "ICC Profile", extensions: ["icc", "icm"] }];
const ICC_ACCEPT = ".icc,.icm,application/vnd.iccprofile,application/octet-stream";
// Mirrors the engine's MAX_ICC_PROFILE_BYTES trust-boundary cap (10 MiB).
const ICC_IMPORT_LIMIT: LocalImportLimit = { maxBytes: 10 * 1024 * 1024, label: "ICC profile" };

/** Proof Setup ▸ Custom ▸ Load: pick a device ICC profile to simulate. False
 *  when cancelled or unusable (the failure is reported, like every import). */
export async function importProofProfileFile(): Promise<boolean> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: false, filters: ICC_FILTERS });
      if (!sel || Array.isArray(sel)) return false;
      store.setProofProfile(sel.replace(/^.*[\\/]/, ""), await readNativeFileBounded(sel, () => ICC_IMPORT_LIMIT));
      return true;
    } catch (e) {
      reportOpen("ICC profile", e);
      return false;
    }
  }
  const file = await pickBrowserFile(ICC_ACCEPT);
  if (!file) return false;
  try {
    store.setProofProfile(file.name, await readBrowserImportBytes(file, ICC_IMPORT_LIMIT));
    return true;
  } catch (e) {
    reportOpen(file.name, e);
    return false;
  }
}

/** Image ▸ Assign Profile / Convert to Profile / Color Settings ▸ Load Profile…:
 *  pick an ICC profile off disk — RGB unless the caller takes more `spaces`
 *  (Convert to Profile also separates into CMYK, Gray and Lab). Null when
 *  cancelled; THROWS with a reportable message when the file isn't a profile
 *  Vision can use there, so the dialog can show it inline instead of losing
 *  the failure. */
export async function importDocumentIccProfile(spaces?: readonly string[]): Promise<IccProfileInfo | null> {
  let name: string;
  let bytes: Uint8Array;
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: false, filters: ICC_FILTERS });
    if (!sel || Array.isArray(sel)) return null;
    name = sel.replace(/^.*[\\/]/, "");
    bytes = await readNativeFileBounded(sel, () => ICC_IMPORT_LIMIT);
  } else {
    const file = await pickBrowserFile(ICC_ACCEPT);
    if (!file) return null;
    name = file.name;
    bytes = await readBrowserImportBytes(file, ICC_IMPORT_LIMIT);
  }
  return parseIccProfile(bytes, name.replace(/\.(icc|icm)$/i, ""), spaces);
}

// Vision's proof-setup file. JSON with the custom device profile embedded as
// base64 so a setup is portable between machines.
// ponytail: uses the .psf extension but NOT Adobe's binary .psf layout — only
// Vision reads these; a real .psf parser is the upgrade path if anyone asks.
const PSF_FILTERS = [{ name: "Proof Setup", extensions: ["psf"] }];
const PSF_ACCEPT = ".psf,application/json";
const PSF_IMPORT_LIMIT: LocalImportLimit = { maxBytes: 16 * 1024 * 1024, label: "proof setup" };
interface ProofSetupFile {
  monetProofSetup: 1;
  mode: string;
  simulatePaperColor: boolean;
  simulateBlackInk: boolean;
  blackPointCompensation: boolean;
  preserveNumbers: boolean;
  profileName?: string;
  profileB64?: string;
}

/** Proof Setup ▸ Save: write the given (dialog-local) setup to a .psf file. */
export async function saveProofSetupFile(setup: {
  mode: string; simulatePaperColor: boolean; simulateBlackInk: boolean;
  blackPointCompensation: boolean; preserveNumbers: boolean;
}): Promise<boolean> {
  const payload: ProofSetupFile = { monetProofSetup: 1, ...setup };
  const profile = setup.mode === "custom" ? store.getProofProfileBytes() : null;
  if (profile) {
    payload.profileName = store.state.proofProfileName ?? "Device Profile";
    let bin = "";
    for (let i = 0; i < profile.length; i += 0x8000) {
      bin += String.fromCharCode(...profile.subarray(i, i + 0x8000));
    }
    payload.profileB64 = btoa(bin);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (isTauri()) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const target = await save({ defaultPath: "Proof Setup.psf", filters: PSF_FILTERS });
      if (!target) return false;
      await atomicWriteBytes(target, bytes);
      return true;
    } catch (e) {
      reportSave(e);
      return false;
    }
  }
  saveBytes("Proof Setup.psf", bytes, "application/json");
  return true;
}

function applyProofSetup(bytes: Uint8Array) {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as ProofSetupFile;
  if (parsed?.monetProofSetup !== 1 || typeof parsed.mode !== "string") {
    throw new Error("Not a Monet Vision proof setup file");
  }
  if (parsed.profileB64) {
    const bin = atob(parsed.profileB64);
    const profile = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) profile[i] = bin.charCodeAt(i);
    store.setProofProfile(String(parsed.profileName ?? "Device Profile"), profile);
  }
  store.setProof(parsed.mode, {
    simulatePaperColor: !!parsed.simulatePaperColor,
    simulateBlackInk: !!parsed.simulateBlackInk,
    blackPointCompensation: !!parsed.blackPointCompensation,
    preserveNumbers: !!parsed.preserveNumbers,
  });
}

/** Proof Setup ▸ Load: pick a .psf file, install its profile and apply it. */
export async function loadProofSetupFile(): Promise<boolean> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: false, filters: PSF_FILTERS });
      if (!sel || Array.isArray(sel)) return false;
      applyProofSetup(await readNativeFileBounded(sel, () => PSF_IMPORT_LIMIT));
      return true;
    } catch (e) {
      reportOpen("proof setup", e);
      return false;
    }
  }
  const file = await pickBrowserFile(PSF_ACCEPT);
  if (!file) return false;
  try {
    applyProofSetup(await readBrowserImportBytes(file, PSF_IMPORT_LIMIT));
    return true;
  } catch (e) {
    reportOpen(file.name, e);
    return false;
  }
}

/** File ▸ Export ▸ Artboards to Files: one PNG per artboard (cropped to its
 *  bounds). No-op if the document has no artboards. */
export function exportArtboardsToFiles() {
  try {
    const eng = E(); // pinned before a desktop folder pick (see exportAs)
    const count = eng.artboard_count();
    withExportFolder("Export Artboards to Files", count, (destDir) => {
      for (let i = 0; i < count; i++) {
        const name = (eng.artboard_name(i) || `Artboard ${i + 1}`).replace(/[^\w.-]+/g, "_");
        const bytes = eng.export_artboard_png(i);
        if (bytes.length) saveBytes(`${name}.png`, bytes, "image/png", destDir);
      }
    });
  } catch (error) {
    reportSave(error);
  }
}

/** File ▸ Export ▸ Paths to Illustrator: the document's vector geometry as SVG
 *  (Illustrator opens SVG) — shape layers as real Béziers with their fills and
 *  strokes, every other layer as its vector-mask / work-path outline. Pixels are
 *  not included; use exportDocumentSVG for a self-contained document. */
export function exportPathsSVG(name = "paths.svg") {
  try {
    const svg = E().export_paths_svg();
    saveBytes(name, new TextEncoder().encode(svg), "image/svg+xml");
  } catch (e) { reportSave(e); }
}

/** File ▸ Export ▸ SVG (Document): the raster composite embedded as a base64
 *  <image> with the vector geometry overlaid on top — a self-contained document,
 *  unlike exportPathsSVG (vectors only). */
export function exportDocumentSVG(name = "monet-vision.svg") {
  try {
    const eng = E();
    const w = eng.width(), h = eng.height();
    const svg = embedRasterInSvg(eng.export_paths_svg(), w, h, toBase64(eng.export_png()));
    saveBytes(name, new TextEncoder().encode(svg), "image/svg+xml");
  } catch (e) { reportSave(e); }
}

// File ▸ Export ▸ Export Layers to Files: one PNG per layer (in isolation).
export function exportLayersToFiles(baseName: string) {
  try {
    const eng = E(); // pinned before a desktop folder pick (see exportAs)
    const layers = store.state.layers;
    withExportFolder("Export Layers to Files", layers.length, (destDir) => {
      for (const l of layers) {
        const safe = l.name.replace(/[^\w.-]+/g, "_") || "layer";
        saveBytes(`${baseName}_${safe}.png`, eng.export_layer_png(l.id), "image/png", destDir);
      }
    });
  } catch (e) { reportSave(e); }
}

/** Render every layer comp in a disposable clone, leaving the live document and
 *  its undo history untouched. Shared by the Files and PDF exports. */
function renderLayerCompPngs(): { name: string; png: Uint8Array }[] {
  const out: { name: string; png: Uint8Array }[] = [];
  const project = engine.projectBytes();
  for (const comp of store.state.layerComps) {
    const clone = engine.buildProject(project);
    try {
      store.applyBlendGamma(clone); // the comp exports bake the canvas's blend
      store.applyLayerCompToEngine(clone, comp);
      const safe = comp.name.replace(/[^\w.-]+/g, "_") || "comp";
      const png = clone.export_png();
      if (png.length) out.push({ name: safe, png });
    } finally {
      clone.free();
    }
  }
  return out;
}

/** File ▸ Export ▸ Layer Comps to Files: one PNG per saved comp. */
export function exportLayerCompsToFiles(baseName = store.state.doc.name.replace(/\.[^.]+$/, "")) {
  try {
    withExportFolder("Layer Comps to Files", store.state.layerComps.length, (destDir) => {
      for (const comp of renderLayerCompPngs()) {
        saveBytes(`${baseName}_${comp.name}.png`, comp.png, "image/png", destDir);
      }
    });
  } catch (e) { reportSave(e); }
}

/** File ▸ Export ▸ Layer Comps to PDF: one comp per PDF page. */
export async function exportLayerCompsToPDF(baseName = store.state.doc.name.replace(/\.[^.]+$/, "")) {
  return reportSaveExport(async () => {
    const comps = renderLayerCompPngs();
    if (!comps.length) return;
    const pages: PdfPage[] = [];
    for (const comp of comps) {
      const page = await pdfPageFromPng(comp.png, {});
      if (page) pages.push(page);
    }
    const bytes = await pdfDocument(pages, `${baseName} Layer Comps`, "standard");
    if (!bytes) throw new Error("Could not build the layer-comps PDF.");
    saveBytes(`${baseName}_Layer_Comps.pdf`, bytes, "application/pdf");
  });
}

/** File ▸ Automate ▸ Picture Package: lay the active document's composite out at
 *  several preset sizes on a new letter-proportioned page. */
export async function picturePackage() {
  return reportSaveExport(async () => {
    const png = E().export_png();
    const url = URL.createObjectURL(new Blob([png as unknown as BlobPart], { type: "image/png" }));
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url;
      });
      const W = 1000, H = 1294, pad = 18;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const cx = canvas.getContext("2d");
      if (!cx) throw new Error("Could not create the Picture Package canvas.");
      cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, W, H);
      // One large (top), two medium, then a row of four small.
      const slots = [
        { x: pad, y: pad, w: W - 2 * pad, h: H * 0.42 },
        { x: pad, y: H * 0.44, w: (W - 3 * pad) / 2, h: H * 0.26 },
        { x: W / 2 + pad / 2, y: H * 0.44, w: (W - 3 * pad) / 2, h: H * 0.26 },
        ...[0, 1, 2, 3].map((i) => ({ x: pad + i * ((W - 2 * pad) / 4), y: H * 0.72, w: (W - 2 * pad) / 4 - pad / 2, h: H * 0.24 })),
      ];
      for (const s of slots) {
        const scale = Math.min(s.w / img.width, s.h / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        cx.drawImage(img, s.x + (s.w - dw) / 2, s.y + (s.h - dh) / 2, dw, dh);
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not encode the Picture Package.");
      store.openImage(new Uint8Array(await blob.arrayBuffer()), "Picture Package.png", "newDocument");
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}

/** runScript RESOLVES its failures ("Script timed out after…", "Disallowed op:
 *  …") instead of throwing, so a browsed script that half-applied its edits used
 *  to look exactly like a clean run. The Scripting Console prints that value;
 *  every other caller has to surface it. "" = success, "✓ …" = the script's log. (#60) */
function reportScriptResult(message: string) {
  if (message && !message.startsWith("✓")) notify(message);
}

/** File ▸ Scripts ▸ Browse: pick a JavaScript file and run it against the same
 *  `vision` scripting API as the Scripting Console. */
export async function browseAndRunScript() {
  const limit: LocalImportLimit = { maxBytes: MAX_SCRIPT_IMPORT_BYTES, label: "Script" };
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "JavaScript", extensions: ["js", "jsx", "txt"] }],
      });
      if (!selected || Array.isArray(selected)) return;
      reportScriptResult(await runScript(decodeImportText(await readNativeFileBounded(selected, () => limit))));
    } catch (e) {
      console.error("Script failed:", e);
      notify(e instanceof Error ? e.message : String(e));
    }
    return;
  }
  const file = await new Promise<File | null>((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".js,.jsx,.txt,text/javascript";
    inp.onchange = () => { resolve(inp.files?.[0] ?? null); inp.remove(); };
    inp.oncancel = () => { inp.remove(); resolve(null); };
    document.body.appendChild(inp);
    inp.click();
  });
  if (!file) return;
  try { reportScriptResult(await runScript(await readBrowserImportText(file, limit))); }
  catch (e) { console.error("Script failed:", e); notify(e instanceof Error ? e.message : String(e)); }
}

export type { ImageProcessorFormat, ImageProcessorOptions, ImageProcessorSave } from "./imageProcessorIo";

/** File ▸ Scripts ▸ Image Processor: batch-convert picked files to up to four
 *  simultaneous formats, optionally running a saved action on each file first,
 *  resizing to fit within maxW×maxH, embedding a copyright note and saving to
 *  a chosen destination folder (downloads otherwise). Returns the number of
 *  files processed. */
export async function imageProcessor(opts: ImageProcessorOptions): Promise<number> {
  if (!opts.saves.length) return 0;
  const files = opts.files ?? await new Promise<File[]>((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = true;
    inp.accept = OPEN_ACCEPT;
    inp.onchange = () => { resolve(Array.from(inp.files ?? [])); inp.remove(); };
    inp.oncancel = () => { inp.remove(); resolve([]); };
    document.body.appendChild(inp);
    inp.click();
  });
  const copyright = opts.copyright?.trim() ?? "";
  let processed = 0;
  for (const [index, file] of files.entries()) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.(index + 1, files.length, file.name);
    const wasOpen = new Set(store.openDocIds());
    let docId = 0;
    try {
      const bytes = await readBrowserOpenFile(file);
      if (!await openAutomationInput(bytes, file)) continue;
      docId = store.state.activeDocId;
      if (opts.actionId !== undefined && await actions.playNamed(opts.actionId) === false) {
        throw new Error("The action stopped before it finished.");
      }
      const dw = store.state.doc.width, dh = store.state.doc.height;
      const scale = fitWithinScale(dw, dh, opts.maxW ?? 0, opts.maxH ?? 0);
      if (scale < 1) xform.resizeImage(Math.max(1, Math.round(dw * scale)), Math.max(1, Math.round(dh * scale)));
      const base = file.name.replace(/\.[^.]+$/, "");
      const icc = exportIccBytes();
      for (const save of opts.saves) {
        // ponytail: copyright reaches JPEG (COM) and PNG (iTXt) only; PSD/TIFF
        // would need a real IPTC/XMP tag writer in the engine exporters.
        let out: Uint8Array;
        if (save.format === "jpeg") out = jpegWithComment(E().export_jpeg_with_icc(save.quality ?? 85, icc), copyright);
        else if (save.format === "png") out = pngWithCopyright(E().export_png_with_icc(icc), copyright);
        else if (save.format === "tiff") out = E().export_tiff_with_icc(icc);
        else out = psdExportBytes();
        const filename = `${base}.${IMAGE_PROCESSOR_EXT[save.format]}`;
        const folder = IMAGE_PROCESSOR_DIR[save.format];
        const subDir = opts.destDir ? `${opts.destDir}/${folder}` : undefined;
        if (subDir && isTauri()) {
          const target = `${subDir}/${filename}`;
          const { exists } = await import("@tauri-apps/plugin-fs");
          if (await exists(target)) throw new Error(`Could not save ${filename} — ${target} already exists`);
        }
        try {
          await writeBatchOutput(subDir, filename, out, IMAGE_PROCESSOR_MIME[save.format]);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          throw new Error(message.startsWith("Could not save") ? message : `Could not save ${filename}: ${message}`);
        }
      }
      processed++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.startsWith("Could not save")) reportSave(e);
      else reportOpen(file.name, e);
    } finally {
      if (docId && !wasOpen.has(docId)) await closeDocumentTab(docId, true);
    }
  }
  return processed;
}

/** File ▸ Automate ▸ Batch: run a recorded action over a Source (picked files,
 *  a folder tree, or the open documents), name each output through the
 *  File Naming template, and save to a Destination (folder on desktop,
 *  downloads otherwise). Errors are collected — not alert-spammed — and logged
 *  to "Batch Log.txt" beside the outputs when a destination folder exists. */
export type BatchFormat = "png" | "jpeg" | "tiff";
export type BatchSource = "files" | "folder" | "opened";
export interface BatchOptions {
  actionId?: number;          // saved action id; undefined = current recording
  /** The action's NAME, for references that outlive the session (a droplet on
   *  disk). Runtime ids are positional, so the name is what actually resolves;
   *  see actions.resolve. */
  actionName?: string;
  format?: BatchFormat;
  template?: string;          // File Naming template (see expandBatchTemplate)
  destDir?: string;           // Tauri destination folder; undefined = downloads
  stopOnError?: boolean;      // Photoshop "Stop For Errors"; default logs on
  destination?: BatchDestination; // default "folder" (destDir, or downloads)
  startSerial?: number | string;  // Starting serial # for {serial}; default 1
  overrideSave?: boolean;     // Override Action "Save As" Commands (Folder only)
  suppressOpenDialogs?: boolean;     // Suppress File Open Options Dialogs (Camera Raw)
  suppressProfileWarnings?: boolean; // Suppress Color Profile Warnings
  /** Called before each file starts: 1-based index, input count, file name. */
  onProgress?: (index: number, total: number, name: string) => void;
  /** Cancel: checked between files, so the current file always finishes whole. */
  signal?: AbortSignal;
}
export interface BatchRunOptions extends BatchOptions {
  source: BatchSource;
  includeSubfolders?: boolean;
  sourceDir?: string;         // Source = Folder on desktop; undefined opens the picker
}
export interface BatchResult { processed: number; errors: BatchError[]; completed: string[]; cancelled: boolean }
/** One batchable item: `open` makes it the active document (or skips it by
 *  returning false — e.g. a cancelled Camera Raw session). `path` is the
 *  source file on disk, when there is one (Save and Close writes back to it). */
type BatchInput = { name: string; path?: string; open(): Promise<boolean> };

/** Testable core of File ▸ Automate ▸ Batch over browser File objects (also
 *  the e2e/scripting entry). Returns files processed; errors go to the log. */
export async function batchProcessFiles(files: File[], actionId?: number, format: BatchFormat = "png", options: BatchOptions = {}): Promise<number> {
  const result = await runBatchInputs(files.map((file) => ({
    name: file.name,
    open: async () => openAutomationInput(await readBrowserOpenFile(file), file),
  })), { actionId, format, ...options });
  return result.processed;
}

async function runBatchInputs(inputs: BatchInput[], opts: BatchOptions): Promise<BatchResult> {
  const template = opts.template?.trim() || DEFAULT_BATCH_TEMPLATE;
  const destination = opts.destination ?? "folder";
  const result: BatchResult = { processed: 0, errors: [], completed: [], cancelled: false };
  const startSerial = parseBatchSerial(opts.startSerial);
  if (startSerial === null) return { ...result, errors: [{ name: "Starting serial #", message: BATCH_SERIAL_ERROR }] };
  // Resolve once, up front. A droplet whose action was renamed or deleted used
  // to play nothing per file and still export every one of them, counted as
  // processed with an empty error list — an unattended run that reports success
  // and writes untouched copies (#494).
  const resolved = opts.actionId !== undefined || opts.actionName !== undefined
    ? actions.resolve({ id: opts.actionId, name: opts.actionName })
    : undefined;
  if (resolved === null) {
    return {
      ...result,
      errors: [{
        name: opts.actionName ?? `Action #${opts.actionId}`,
        message: "This action is no longer available — nothing was run.",
      }],
    };
  }
  // Only a Folder destination writes its own output in place of the recorded ones.
  const skipOps = destination === "folder" && opts.overrideSave ? BATCH_SAVE_OPS : undefined;
  for (const [index, input] of inputs.entries()) {
    // Checking only between files keeps each file's open, action and output
    // whole and leaves the rest untouched.
    if (opts.signal?.aborted) { result.cancelled = true; break; }
    opts.onProgress?.(index + 1, inputs.length, input.name);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the dialog paint and a Cancel click land
    try {
      _batchOpenSuppress = { dialogs: !!opts.suppressOpenDialogs, profiles: !!opts.suppressProfileWarnings };
      const wasOpen = new Set(store.openDocIds());
      let opened: boolean;
      try { opened = await input.open(); } finally { _batchOpenSuppress = null; }
      if (!opened) continue;
      const docId = store.state.activeDocId;
      // Adopt the source path BEFORE playback: it clears dirty, so the action's
      // edits stay unsaved until the save below really succeeds.
      if (destination === "saveAndClose" && input.path) store.setDocPath(docId, input.path);
      const played = resolved !== undefined
        ? await actions.playNamed(resolved, 0, skipOps)
        : await actions.play(skipOps);
      if (played === false) throw new Error("The action stopped before it finished.");
      if (destination === "folder") {
        const stem = expandBatchTemplate(template, input.name.replace(/\.[^.]+$/, ""), startSerial + result.processed);
        const icc = exportIccBytes();
        if (opts.format === "jpeg") await writeBatchOutput(opts.destDir, `${stem}.jpg`, E().export_jpeg_with_icc(90, icc), "image/jpeg");
        else if (opts.format === "tiff") await writeBatchOutput(opts.destDir, `${stem}.tif`, E().export_tiff_with_icc(icc), "image/tiff");
        else await writeBatchOutput(opts.destDir, `${stem}.png`, E().export_png_with_icc(icc), "image/png");
        // Photoshop closes each file once its copy is in the Folder, so a big
        // batch doesn't pile up open documents (#469). Only one this batch
        // opened: a document the user already had open (Opened Files) stays.
        if (!wasOpen.has(docId)) await closeDocumentTab(docId, true);
      } else if (destination === "saveAndClose") {
        if (!await saveDocument()) throw new Error("could not be saved — it was left open");
        if (!await closeDocumentTab(docId)) throw new Error("was saved but could not be closed");
      }
      result.processed++;
      result.completed.push(input.name);
    } catch (e) {
      result.errors.push({ name: input.name, message: e instanceof Error ? e.message : String(e) });
      if (opts.stopOnError) break;
    }
  }
  if (result.errors.length) {
    console.error(formatBatchLog(result.errors));
    if (opts.destDir && isTauri()) {
      try { await atomicWriteBytes(`${opts.destDir}/Batch Log.txt`, new TextEncoder().encode(formatBatchLog(result.errors))); }
      catch (e) { console.error("Batch log write failed:", e); }
    }
  }
  return result;
}

/** Destination folder on desktop, the download anchor otherwise. */
async function writeBatchOutput(destDir: string | undefined, filename: string, bytes: Uint8Array, mime: string) {
  if (destDir && isTauri()) {
    await atomicWriteBytes(`${destDir}/${filename}`, bytes);
    void runScriptEventBindings("exportDocument"); // saveBytes raises it for the download branch
  } else saveBytes(filename, bytes, mime);
}

/** Source = Folder on desktop: scan `sourceDir` (or a picked directory) for
 *  batchable files. Resolves null when the picker is cancelled. */
async function nativeBatchFolderInputs(includeSubfolders: boolean, sourceDir?: string): Promise<BatchInput[] | null> {
  const dir = sourceDir ?? await (await import("@tauri-apps/plugin-dialog")).open({ directory: true, title: "Batch Source Folder" });
  if (typeof dir !== "string") return null;
  const fs = await import("@tauri-apps/plugin-fs");
  return nativePathInputs(await collectBatchFolder(dir, { readDir: (d) => fs.readDir(d) }, includeSubfolders));
}

/** Source = Choose Files on desktop: the native picker, so every input keeps
 *  its path (Save and Close writes back to it). Resolves null when cancelled. */
async function nativeBatchFileInputs(): Promise<BatchInput[] | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: true, title: "Batch Source Files" });
  if (!picked) return null;
  return nativePathInputs([picked].flat().filter((path) => BATCH_SCAN_RE.test(path)));
}

function nativePathInputs(paths: string[]): BatchInput[] {
  return paths.map((path) => {
    const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
    return {
      name,
      path,
      open: async () => openAutomationInput(
        await readNativeFileBounded(path, (prefix) => openFileReadLimit(path, prefix)),
        { name, lastModified: 0 },
        path,
      ),
    };
  });
}

/** Browser pickers: multi-file input, or a webkitdirectory input for Source =
 *  Folder (filtered to batchable extensions and, without Include Subfolders,
 *  to the folder's direct children). Resolves null on cancel. */
function browserBatchInputs(folder: boolean, includeSubfolders: boolean): Promise<BatchInput[] | null> {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = true;
    if (folder) (inp as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    else inp.accept = OPEN_ACCEPT;
    inp.onchange = () => {
      let files = Array.from(inp.files ?? []);
      if (folder) {
        files = files.filter((f) => BATCH_SCAN_RE.test(f.name)
          && (includeSubfolders || f.webkitRelativePath.split("/").length <= 2));
      }
      inp.remove();
      resolve(files.map((file) => ({
        name: file.name,
        open: async () => openAutomationInput(await readBrowserOpenFile(file), file),
      })));
    };
    inp.oncancel = () => { inp.remove(); resolve(null); };
    document.body.appendChild(inp);
    inp.click();
  });
}

/** Dialog entry: gather the chosen Source's inputs and run the batch.
 *  Resolves null when there is nothing to run (no action, picker cancelled). */
export async function batchProcess(opts: BatchRunOptions): Promise<BatchResult | null> {
  if (opts.actionId === undefined && opts.actionName === undefined && actions.count() === 0) return null;
  let inputs: BatchInput[] | null;
  if (opts.source === "opened") {
    inputs = store.openDocIds().map((id) => ({
      name: store.docName(id) ?? `Untitled-${id}`,
      open: async () => { store.activateDoc(id); return true; },
    }));
  } else if (opts.source === "folder" && isTauri()) {
    inputs = await nativeBatchFolderInputs(opts.includeSubfolders ?? true, opts.sourceDir);
  } else if (isTauri()) {
    inputs = await nativeBatchFileInputs();
  } else {
    inputs = await browserBatchInputs(opts.source === "folder", opts.includeSubfolders ?? true);
  }
  if (!inputs) return null;
  return runBatchInputs(inputs, opts);
}

/** Run a droplet (#469) over the images and folders dropped on it — browser
 *  Files, or native paths from the command line, the droplet app or a window
 *  drop. Its saved Batch settings name the output; with no destination folder
 *  saved it writes to Downloads. Nobody is there to answer Camera Raw or a
 *  profile warning, so both are suppressed, as Batch can. */
export async function runDroplet(
  droplet: DropletDescriptor,
  items: (string | File)[],
  progress: Pick<BatchOptions, "onProgress" | "signal"> = {},
): Promise<BatchResult> {
  const problem = await dropletProblem(droplet);
  if (problem) return { processed: 0, errors: [{ name: "Droplet", message: problem }], completed: [], cancelled: false };
  const inputs: BatchInput[] = [];
  for (const item of items) {
    if (typeof item !== "string") {
      inputs.push({ name: item.name, open: async () => openAutomationInput(await readBrowserOpenFile(item), item) });
      continue;
    }
    const fs = await import("@tauri-apps/plugin-fs");
    // A path that can't be read stays an input, so its failure is reported.
    const folder = await fs.stat(item).then((info) => info.isDirectory, () => false);
    inputs.push(...nativePathInputs(folder ? await collectBatchFolder(item, { readDir: (d) => fs.readDir(d) }, true) : [item]));
  }
  const destDir = droplet.destDir ?? (isTauri() ? await (await import("@tauri-apps/api/path")).downloadDir() : undefined);
  return runBatchInputs(inputs, {
    ...droplet, destDir, destination: "folder", suppressOpenDialogs: true, suppressProfileWarnings: true, ...progress,
  });
}

/** Save a droplet (#469) on desktop: a path ending in .app builds the macOS
 *  droplet app around the descriptor (src-tauri/droplet.rs); any other path
 *  gets the .json descriptor. */
export async function saveDropletFile(path: string, droplet: DropletDescriptor, overwrite = false): Promise<void> {
  const app = /\.app$/i.test(path);
  const json = /\.json$/i.test(path);
  if (!app && !json) throw new Error("A droplet must be saved as .json or .app.");
  if (isTauri()) {
    const { exists } = await import("@tauri-apps/plugin-fs");
    if (await exists(path) && !overwrite) {
      throw new Error(`${path} already exists. Choose a new name, or replace the droplet on purpose.`);
    }
  }
  const text = JSON.stringify(droplet, null, 2);
  if (app) await invoke("plugin:droplet|save_droplet_app", { path, descriptor: text, overwrite });
  else await atomicWriteBytes(path, new TextEncoder().encode(text));
}

/** What stops a droplet before anything opens: its action is no longer saved,
 *  or its destination folder is gone. */
export async function dropletProblem(droplet: DropletDescriptor): Promise<string | null> {
  if (actions.resolve({ id: droplet.actionId, name: droplet.actionName }) === null) {
    const names = actions.list().map((a) => `${a.set}/${a.name}`).join(", ") || "none — save one in the Actions panel";
    return `The droplet's action "${droplet.actionName ?? `#${droplet.actionId}`}" is not saved in Vision any more; saved actions: ${names}. Nothing was run.`;
  }
  if (droplet.destDir && isTauri()) {
    const fs = await import("@tauri-apps/plugin-fs");
    const folder = await fs.stat(droplet.destDir).then((info) => info.isDirectory, () => false);
    if (!folder) return `Destination folder ${droplet.destDir} doesn't exist. Nothing was run.`;
  }
  return null;
}

/** The droplet run a drop started, as the Droplet dialog shows it (#469). */
export interface DropletRun { name: string; abort: AbortController | null; status: string; error?: string }
let _dropletRun: DropletRun | null = null;
let _dropletRuns: Promise<void> = Promise.resolve();
export const dropletRun = () => _dropletRun;

/** Run a dropped droplet in the Droplet dialog: per-file progress, Cancel
 *  between files, then the summary. A second drop waits for the first, since
 *  both would open and close documents. */
function runDropletInDialog(name: string, droplet: DropletDescriptor, items: (string | File)[]): Promise<void> {
  _dropletRuns = _dropletRuns.then(async () => {
    const abort = new AbortController();
    let total = 0;
    const show = (next: Omit<DropletRun, "name">) => { _dropletRun = { name, ...next }; store.bump(); };
    show({ abort, status: "Starting…" });
    store.requestDialog("dropletRun");
    try {
      const result = await runDroplet(droplet, items, {
        signal: abort.signal,
        onProgress: (index, count, file) => { total = count; show({ abort, status: `${index} of ${count} — ${file}` }); },
      });
      // No file started: the droplet couldn't run, or had nothing to run on.
      show({ abort: null, ...(total ? batchSummary(result, total) : {
        status: "",
        error: result.errors[0]?.message ?? "There were no images to process — drop image files or folders on the droplet.",
      }) });
    } catch (e) {
      show({ abort: null, status: "", error: e instanceof Error ? e.message : String(e) });
    }
  });
  return _dropletRuns;
}

/** Native paths dropped on the window or handed over by the OS (Finder, the
 *  droplet app, `open`, argv): a droplet among them runs over the rest (#469);
 *  otherwise they open as documents, a .json that isn't a droplet included. */
export async function openDroppedPaths(paths: string[]) {
  const found = await findDroplet(paths, (path) => path, async (path) =>
    decodeImportText(await readNativeFileBounded(path, () => ({ maxBytes: DROPLET_MAX_BYTES, label: "Droplet" }))));
  return found ? runDropletInDialog(found.name, found.droplet, found.inputs) : openPaths(paths);
}

/** Browser drops, routed the same way as {@link openDroppedPaths}. */
export async function openDroppedFiles(files: File[]) {
  const found = await findDroplet(files, (file) => file.name, async (file) =>
    file.size <= DROPLET_MAX_BYTES ? file.text() : "");
  return found ? runDropletInDialog(found.name, found.droplet, found.inputs) : openImageFiles(files);
}

/** Run `task` with nobody to answer a prompt, as a command-line job does: every
 *  confirm takes its OK branch (what a suppressed Batch dialog answers) and
 *  every alert is collected for the caller instead of shown. */
export async function runUnattended<T>(task: () => Promise<T>): Promise<{ value: T; alerts: string[] }> {
  const alerts: string[] = [];
  const shown = { alert: globalThis.alert, confirm: globalThis.confirm };
  const wasUnattended = _unattended;
  _unattended = true;
  globalThis.alert = (message?: unknown) => { alerts.push(String(message)); };
  globalThis.confirm = () => true;
  try { return { value: await task(), alerts }; }
  finally { _unattended = wasUnattended; Object.assign(globalThis, shown); }
}

/** `monet-vision --run-script`: the Scripting Console's result as a process
 *  status — "" or "✓ log" is success, anything else is the script's error. */
export async function runCliScript(code: string): Promise<CliResult> {
  const out = await runScript(code);
  return !out || out.startsWith("✓")
    ? { code: 0, stdout: out.replace(/^✓ ?/, ""), stderr: "" }
    : { code: 1, stdout: "", stderr: out };
}

/** Run a command-line job main.rs validated (native/cli.ts). The action is
 *  resolved before anything opens, so one that names no saved action exits 2
 *  having changed nothing. */
export async function runCliJob(job: CliJob): Promise<CliResult> {
  const saved = actions.list();
  const meta = job.script || job.droplet ? undefined : findActionRef(saved, job.action ?? "");
  if (meta === null) {
    const names = saved.map((a) => `${a.set}/${a.name}`).join(", ") || "none — save one in the Actions panel";
    return { code: 2, stdout: "", stderr: `No single saved action matches "${job.action}". Use "Set/Name"; saved actions: ${names}.` };
  }
  const { value: result, alerts } = await runUnattended(async (): Promise<CliResult> => {
    if (job.droplet) {
      // main.rs checked the shape; this reads what the batch will run.
      const droplet = parseDroplet(decodeImportText(await readNativeFileBounded(job.droplet, () => ({ maxBytes: DROPLET_MAX_BYTES, label: "Droplet" }))));
      if (!droplet) return { code: 2, stdout: "", stderr: `${job.droplet} is not a Monet droplet.` };
      // Refused before anything opens is bad input, as for --play-action.
      const problem = await dropletProblem(droplet);
      if (problem) return { code: 2, stdout: "", stderr: problem };
      return cliBatchResult(await runDroplet(droplet, job.inputs ?? []), (job.inputs ?? []).join(", "));
    }
    if (!meta) {
      const limit: LocalImportLimit = { maxBytes: MAX_SCRIPT_IMPORT_BYTES, label: "Script" };
      return runCliScript(decodeImportText(await readNativeFileBounded(job.script ?? "", () => limit)));
    }
    const destination = (job.destination ?? "folder") as BatchDestination;
    const batch = await batchProcess({
      source: "folder", sourceDir: job.batch ?? "", includeSubfolders: job.subfolders !== false,
      actionId: meta.id, // not the name: actions in different sets may share one
      destination,
      destDir: job.dest ?? (destination === "folder" ? await (await import("@tauri-apps/api/path")).downloadDir() : undefined),
      format: (job.format ?? "png") as BatchFormat,
      template: job.template ?? undefined,
      startSerial: job.serial ?? undefined,
      overrideSave: !!job.override_save,
      stopOnError: !!job.stop_on_error,
      // A hidden window can show neither Camera Raw nor a profile warning.
      suppressOpenDialogs: true,
      suppressProfileWarnings: true,
    });
    return cliBatchResult(batch, job.batch ?? "");
  });
  // An alert is a failure nobody saw: an image that would not open, a Stop step.
  return alerts.length ? { ...result, code: 1, stderr: [result.stderr, ...alerts].filter(Boolean).join("\n") } : result;
}

/** A batch's result as a command-line status: the count on stdout, every
 *  failure on stderr. */
function cliBatchResult(batch: BatchResult | null, source: string): CliResult {
  const processed = `${batch?.processed ?? 0} processed`;
  if (batch?.errors.length) return { code: 1, stdout: processed, stderr: formatBatchLog(batch.errors) };
  if (!batch?.processed) return { code: 2, stdout: "", stderr: `No images were processed from ${source}` };
  return { code: 0, stdout: processed, stderr: "" };
}

/** File ▸ Automate ▸ Crop and Straighten Photos: detect the separate photo
 *  regions on the active scan and open each as its own cropped document.
 *  (The split is modelled; rotation deskew is not.) */
export function cropAndStraightenPhotos() {
  const regions = Array.from(E().detect_photo_regions()) as number[];
  if (regions.length < 4) return;
  for (let i = 0, n = 1; i + 3 < regions.length; i += 4, n++) {
    const bytes = E().export_region_png(regions[i], regions[i + 1], regions[i + 2], regions[i + 3]);
    if (bytes.length) routeOpen(bytes, `Photo ${n}.png`);
  }
}

/** File ▸ Automate ▸ Contact Sheet II: tile every open document's thumbnail
 *  into a grid on a new "Contact Sheet" document (labels under each cell). */
export async function contactSheet() {
  return reportSaveExport(async () => {
    const cards = store.docCards();
    if (!cards.length) return;
    const cols = Math.ceil(Math.sqrt(cards.length));
    const rows = Math.ceil(cards.length / cols);
    const cw = 220, ch = 180, pad = 12, labelH = 16;
    const canvas = document.createElement("canvas");
    canvas.width = cols * cw;
    canvas.height = rows * ch;
    const cx = canvas.getContext("2d");
    if (!cx) throw new Error("Could not create the Contact Sheet canvas.");
    cx.fillStyle = "#ffffff";
    cx.fillRect(0, 0, canvas.width, canvas.height);
    await Promise.all(cards.map((card, i) => new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const x = (i % cols) * cw + pad, y = Math.floor(i / cols) * ch + pad;
        const availW = cw - 2 * pad, availH = ch - 2 * pad - labelH;
        const scale = Math.min(availW / img.width, availH / img.height, 1);
        const dw = img.width * scale, dh = img.height * scale;
        cx.drawImage(img, x + (availW - dw) / 2, y + (availH - dh) / 2, dw, dh);
        cx.fillStyle = "#111"; cx.font = "11px sans-serif";
        cx.fillText(card.name.slice(0, 30), x, y + availH + 12);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = card.thumb;
    })));
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not encode the Contact Sheet.");
    store.openImage(new Uint8Array(await blob.arrayBuffer()), "Contact Sheet.png", "newDocument");
  });
}

/** Layers named with an asset extension ("button.png", "hero.jpg") — the
 *  Photoshop Generator naming convention shared by one-shot and watch mode. */
function imageAssetLayers(): { id: number; name: string; png: boolean }[] {
  const out: { id: number; name: string; png: boolean }[] = [];
  for (const l of store.state.layers) {
    const m = /^(.+?)\.(png|jpe?g)$/i.exec(l.name.trim());
    if (!m) continue;
    const base = m[1].replace(/[^\w.-]+/g, "_") || "asset";
    const ext = m[2].toLowerCase();
    out.push({ id: l.id, name: `${base}.${ext}`, png: ext === "png" });
  }
  return out;
}

/** File ▸ Generate ▸ Image Assets (one-shot): download each asset layer in
 *  isolation. Returns the number generated. */
export function generateImageAssets(): number {
  const assets = imageAssetLayers();
  const eng = E(); // pinned before a desktop folder pick (see exportAs)
  let count = 0;
  withExportFolder("Image Assets", assets.length, (destDir) => {
    for (const a of assets) {
      if (a.png) saveBytes(a.name, eng.export_layer_png(a.id), "image/png", destDir);
      else saveBytes(a.name, eng.export_layer_jpeg(a.id, 90), "image/jpeg", destDir);
      count++;
    }
  });
  return count;
}

/** Watch-mode Generator (Tauri): silently write the assets next to the saved
 *  document in "<stem>-assets/" — Photoshop Generator's folder convention.
 *  Unsaved documents write nothing until first saved. Returns files written. */
export async function generateImageAssetsWatch(): Promise<number> {
  if (!isTauri()) return 0;
  const path = store.activePath();
  if (!path) return 0;
  const sepIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = `${path.slice(0, sepIndex + 1)}${path.slice(sepIndex + 1).replace(/\.[^.]+$/, "")}-assets`;
  let count = 0;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    try { await fs.mkdir(dir, { recursive: true }); } catch { /* already exists */ }
    for (const a of imageAssetLayers()) {
      const bytes = a.png ? E().export_layer_png(a.id) : E().export_layer_jpeg(a.id, 90);
      await atomicWriteBytes(`${dir}/${a.name}`, bytes);
      count++;
    }
  } catch (e) {
    console.warn("[generator] asset write failed:", e);
  }
  return count;
}

/** File ▸ Generate ▸ Image Assets. Tauri: toggle watch mode (checked menu
 *  item; edits re-export debounced via store.onGeneratorRun), generating once
 *  immediately on enable. Browser: the classic one-shot download. */
export function toggleImageAssetsGenerator() {
  if (!isTauri()) {
    generateImageAssets();
    return;
  }
  // Only the user's switch-on counts as an export: raising from the debounced
  // re-export would loop forever behind any bound action that edits.
  if (store.toggleGeneratorWatch()) void generateImageAssetsWatch().then((count) => { if (count) void runScriptEventBindings("exportDocument"); });
}
store.onGeneratorRun = () => {
  void generateImageAssetsWatch();
};

// Layer ▸ Copy CSS: the active layer's box geometry (+ a box-shadow from its
// drop-shadow effect, if any) to the clipboard.
export function copyLayerCSS() {
  const id = store.state.activeLayerId;
  const b = Array.from(E().active_layer_bounds());
  const lines = ["position: absolute;", `left: ${b[0]}px;`, `top: ${b[1]}px;`, `width: ${b[2]}px;`, `height: ${b[3]}px;`];
  // Every drop-shadow INSTANCE (0 = drop shadow). `layer_effect_params` reads
  // instance 0 only, so a layer with two shadows exported just one.
  const shadows = Array.from(
    { length: store.effectInstanceCount(id, 0) },
    (_, index) => store.effectParamsAt(id, 0, index),
  );
  const boxShadow = boxShadowValue(shadows);
  if (boxShadow) lines.push(`box-shadow: ${boxShadow};`);
  void navigator.clipboard?.writeText(lines.join("\n"));
}

/** Layer ▸ Copy SVG: a shape layer copies as its real Béziers — `<path d="…">`
 *  with fills, strokes and gradients — so Illustrator pastes editable art. Any
 *  other layer has no vector geometry, so it copies as the composite with the
 *  pixels embedded as a data URI (what Photoshop does for pixel layers). */
export function copyLayerSVG() {
  const w = E().width(), h = E().height();
  const svg = E().export_layer_svg(store.state.activeLayerId)
    || embedRasterInSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n</svg>\n`,
      w, h, toBase64(E().export_png()));
  void navigator.clipboard?.writeText(svg);
}

// Color panel ▸ Copy Color's Hex Code / Copy Color as HTML: the chosen swatch
// to the clipboard as `rrggbb` or `color="#rrggbb"`. Returns the copied string.
export function copySwatchColor(source: "fg" | "bg", mode: ColorCopyFormat): string {
  const [r, g, b] = hsvToRgba(store.state[source]);
  const text = formatColor(r, g, b, mode);
  void navigator.clipboard?.writeText(text);
  return text;
}

export function copyForegroundColor(mode: ColorCopyFormat): string {
  return copySwatchColor("fg", mode);
}

const RAW_RE = /\.(cr2|cr3|nef|arw|dng|raf|rw2|orf|pef|srw|raw|nrw|mrw|dcr)$/i;
function openFileReadLimit(name: string, signatureBytes?: Uint8Array): { maxBytes: number; label: string } {
  // A Photoshop signature wins over a misleading name, and a PSB (version 2)
  // uses the large-document cap rather than the 256 MiB image handoff.
  const header = signatureBytes ? photoshopHeader(signatureBytes) : null;
  if (header?.version === 1) return imageReadLimit(name, "open", signatureBytes);
  if (header?.version === 2) return documentFormatReadLimit(name.endsWith(".psb") ? name : `${name}.psb`, signatureBytes);
  if (RAW_RE.test(name)) return { maxBytes: MAX_CAMERA_RAW_SOURCE_BYTES, label: "Camera source" };
  return documentFormatReadLimit(name, signatureBytes);
}
async function readBrowserOpenFile(file: Pick<File, "name" | "size" | "slice" | "arrayBuffer">): Promise<Uint8Array> {
  // Size preflight FIRST, against the name-derived limit: the signature sniff
  // can only tighten a limit (every signature limit ≤ every name limit), so an
  // oversized file is rejected before ANY read — even the 6-byte prefix slice.
  const nameLimit = openFileReadLimit(file.name);
  return readWithinFileSizeLimit(file.size, nameLimit.maxBytes, nameLimit.label, async () => {
    const prefix = new Uint8Array(await file.slice(0, 6).arrayBuffer());
    const limit = openFileReadLimit(file.name, prefix);
    return readWithinFileSizeLimit(file.size, limit.maxBytes, limit.label, async () => (
      new Uint8Array(await file.arrayBuffer())
    ));
  });
}
async function readBrowserImageFile(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  purpose: ImageReadPurpose,
): Promise<Uint8Array> {
  const limit = imageReadLimit(file.name, purpose);
  return readWithinFileSizeLimit(file.size, limit.maxBytes, limit.label, async () => (
    new Uint8Array(await file.arrayBuffer())
  ));
}
async function readNativeImagePath(path: string, purpose: ImageReadPurpose): Promise<Uint8Array> {
  return readNativeFileBounded(path, (prefix) => imageReadLimit(path, purpose, prefix));
}
// The engine importers reject malformed/oversized input with an error (instead
// of panicking); surface it gracefully so a bad file can't break the app.
function reportOpen(name: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`Failed to open ${name}:`, e);
  if (typeof alert === "function") alert(`Could not open “${name}”.\n${msg}`);
}
function reportSave(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("Save failed:", e);
  if (typeof alert === "function") alert(`Could not save the document.\n${msg}`);
}
async function reportSaveExport(work: () => Promise<unknown>): Promise<void> {
  try { await work(); }
  catch (e) { reportSave(e); }
}
function reportPrint(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("Print failed:", e);
  if (typeof alert === "function") alert(`Could not print the document.\n${msg}`);
}
function reportPackage(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("Package failed:", e);
  if (typeof alert === "function") alert(`Could not package the document.\n${msg}`);
}

function smartEditSourcesForParent(parentDocId: number, seen = new Set<number>()): PersistedSmartEditSource[] {
  if (seen.has(parentDocId)) return [];
  seen.add(parentDocId);
  const sources: PersistedSmartEditSource[] = [];
  for (const binding of listSmartEditBindings(parentDocId)) {
    if (store.layerKindInDoc(parentDocId, binding.parentLayerId) !== 7) continue;
    const engineBytes = store.docProjectBytes(binding.editDocId);
    const document = store.docDocumentMeta(binding.editDocId, { copyCameraRawBytes: false });
    if (!engineBytes || !document) continue;
    sources.push({
      parentLayerId: binding.parentLayerId,
      name: store.docName(binding.editDocId) ?? binding.name,
      engineBytes,
      document,
      dirty: store.docDirty(binding.editDocId),
      smartEditSources: smartEditSourcesForParent(binding.editDocId, seen),
    });
  }
  seen.delete(parentDocId);
  return sources;
}

function projectBytesForDoc(docId: number, opts: { commitTransientEdits?: boolean } = {}): Uint8Array {
  return store.saveProjectForDoc(docId, smartEditSourcesForParent(docId), opts) ?? engine.projectBytes();
}

async function resolveNativeProjectBytes(bytes: Uint8Array, path: string): Promise<Uint8Array> {
  const envelope = decodeProjectEnvelope(bytes);
  if (!envelope) return bytes;
  const smartLinks = await resolveProjectLinks(envelope.smartLinks, path);
  if (smartLinks === envelope.smartLinks) return handoffDecodedProjectEnvelope(bytes, envelope);
  const resolved = { ...envelope, smartLinks };
  return handoffDecodedProjectEnvelope(
    encodeProjectEnvelope(resolved.engineBytes, resolved.smartLinks, resolved.document, resolved.smartEditSources),
    resolved,
  );
}

/** Rule 2 (courier): the container each document was OPENED from, kept whole so
 *  a save writes back every entry Vision did not consume. `closeDocumentTab`
 *  drops the entry with the tab. */
const containerCargo = new Map<number, MonetContainer>();

/** Open a v1 Monet container — ANY of the seven extensions, dispatched on the
 *  MANIFEST. Vision loads the `graphics` role and keeps the rest as courier
 *  cargo; a container with no graphics entry is not an error, it is a document
 *  with nothing Vision can show (design doc 11 rule 1). */
function openContainer(bytes: Uint8Array, name: string, path?: string): boolean {
  const container = readContainer(bytes);
  if (entriesByRole(container, "graphics").length === 0) {
    notify(`“${name}” is a Monet document with no graphics content — there is nothing for Vision to open.`);
    return false;
  }
  // Absent on a container written by another app, or by a Vision old enough to
  // have had nowhere to put it — the document opens with defaults, as before.
  const [metaEntry] = entriesByRole(container, VISION_DOCUMENT_ROLE);
  store.openGraphics(bytes, name, metaEntry ? decodeDocumentMetaBytes(metaEntry.data) : null);
  containerCargo.set(store.state.activeDocId, container);
  if (path) store.setActivePath(path);
  const ignored = ignoredContainerEntries(container.manifest);
  if (ignored.length) {
    const shown = ignored.slice(0, 4).join(", ") + (ignored.length > 4 ? ", …" : "");
    notify(`“${name}” also holds ${ignored.length} entr${ignored.length === 1 ? "y" : "ies"} Vision does not open (${shown}). They are preserved when you save.`);
  }
  return true;
}

/** Open bytes as a NEW document tab. Photoshop's 8BPS/version signature wins
 * over the extension, then any Monet container wins over it (the manifest, never
 * the name — a `.mcin` renamed `.mvis` still opens correctly); other formats
 * keep their existing name-based dispatch.
 * `path` (native) is remembered for save-in-place. `interactivePdf` keeps the
 * page picker for ordinary opens; automation opens page 1 before continuing. */
function routeOpen(bytes: Uint8Array, name: string, path?: string, interactivePdf = true, askRawLayout = true): boolean | Promise<boolean> {
  if (path) {
    const existing = store.docIdForSavedPath(path);
    if (existing != null) {
      store.activateDoc(existing);
      return true;
    }
  }
  if (!monetFormatLoaded) {
    // Boot window only: the container sniff needs the format WASM. Retry once
    // it is up rather than mis-routing a container to the raster decoder.
    return monetFormatReady
      .then(() => routeOpen(bytes, name, path, interactivePdf, askRawLayout))
      .catch((e) => { if (!askRawLayout) throw e; reportOpen(name, e); return false; });
  }
  const workingProfile = store.state.colorProfile;
  if (photoshopVersion(bytes) !== null) {
    store.openFormat(bytes, name);
    if (usesPhotoshopRgbProfilePolicy(bytes)) {
      applyOpenedImageProfilePolicy(bytes, name, workingProfile);
    }
    if (path) store.setActivePath(path);
    return true;
  }
  if (isContainer(bytes)) return openContainer(bytes, name, path);
  if (isLayerOpenJpegName(name) && store.state.filePrefs.openJpegAsLayer && store.canOpenImageAsLayer()) {
    E().importImage(bytes, name.replace(/\.[^.]+$/, ""));
    engine.commit();
    if (path) store.recordRecentFile(path);
    return true;
  }
  // GIF must go through the ANIMATED decoder. Falling through to the plain
  // image path kept only frame 1, and because .gif is an in-place save target
  // the next Cmd+S wrote that single frame back over the user's animation and
  // marked the tab clean. import_gif populates frames + per-frame delays +
  // repeat, and the encoder already prefers stored delays, so it round-trips.
  if (/\.gif$/i.test(name)) {
    store.openGif(bytes, name);
    if (path) store.setActivePath(path);
    return true;
  }
  if (AVIF_RE.test(name)) return openAvif(bytes, name, path);
  if (SVG_RE.test(name)) return openSvg(bytes, name, path);
  if (PDF_RE.test(name)) return openPdf(bytes, name, path, interactivePdf);
  if (HEIC_RE.test(name)) return openHeic(bytes, name, path);
  if (TGA_RE.test(name)) return openTga(bytes, name, path);
  if (PNM_RE.test(name)) return openPnm(bytes, name, path);
  if (PCX_RE.test(name)) return openPcx(bytes, name, path);
  if (RAW_RE.test(name)) return Promise.resolve(openCameraRaw(bytes, name, { originalPath: path }, path, askRawLayout)).then((result) => typeof result === "string" || result);
  if (PHOTOSHOP_RAW_RE.test(name)) return askPhotoshopRawLayout(bytes, name, path, askRawLayout);
  if (hasPhotoshopExtension(name)) {
    store.openFormat(bytes, name);
  } else if (/\.xcf$/i.test(name)) store.openFormat(bytes, name);
  else if (/\.mvision$/i.test(name)) store.openProject(bytes, name);
  // A Monet Artisan document is JSON, not pixels — without this it fell through
  // to the raster decoder and failed. The shared engine composites its scene as
  // a kind-3 vector layer.
  else if (ARTISAN_RE.test(name)) store.openArtisan(bytes, name);
  else {
    store.openImage(bytes, name);
    applyOpenedImageProfilePolicy(bytes, name, workingProfile);
  }
  if (path) store.setActivePath(path);
  return true;
}

/** Open one browser-picked automation input, pausing for Camera Raw when needed.
 * Cancel/Done skip that item; Open/Open Object make the accepted document active
 * before the caller runs actions or exports it. */
// Batch's Suppress File Open Options Dialogs / Suppress Color Profile Warnings,
// set only while a batch input opens.
// ponytail: process-global — a file the user opens by hand during that await
// inherits it; thread it through routeOpen if that ever matters.
let _batchOpenSuppress: { dialogs: boolean; profiles: boolean } | null = null;

async function openAutomationInput(bytes: Uint8Array, file: Pick<File, "name" | "lastModified">, path?: string): Promise<boolean> {
  if (photoshopVersion(bytes) !== null || !RAW_RE.test(file.name)) {
    return await routeOpen(bytes, file.name, undefined, false, !_batchOpenSuppress?.dialogs);
  }
  const suppress = _batchOpenSuppress?.dialogs;
  const sha256 = await cameraRawSha256(bytes);
  // A native input opens like File ▸ Open: from its path, with its sidecar's settings.
  const sessionId = await openCameraRaw(bytes, file.name, {
    sha256,
    lastModified: file.lastModified,
    ...(path ? { originalPath: path, ...await readNativeRawSidecar(path, file.name, bytes, sha256) } : {}),
  }, path, !suppress);
  if (typeof sessionId !== "string") return sessionId;
  if (suppress) {
    // Develop with the source's own recipe (its sidecar/defaults) instead of
    // waiting on the workspace — before the App drains the queued request.
    const pending = store.getSnapshot().pendingDialog;
    const recipe = store.cameraRawSession(sessionId)?.session.source?.recipe;
    if (recipe && store.completeCameraRawOpen(sessionId, recipe, false) !== null) {
      const arg = pending?.arg as { sessionId?: unknown } | null | undefined;
      if (pending?.name === "cameraRaw" && arg?.sessionId === sessionId) store.clearPendingDialog(pending.serial);
      return true;
    }
    // Another Camera Raw session is still up: this one waits its turn below.
  }
  const disposition = await store.waitForCameraRawSession(sessionId);
  return disposition === "open" || disposition === "open-as-smart-object";
}

// Photoshop Raw Options (#466): headerless samples need their layout before
// they can open. The React DialogProvider returns a layout on OK and null on
// Cancel; the opener waits so a multi-file selection keeps every dialog.
export interface PhotoshopRawOpenRequest { bytes: Uint8Array; name: string; path?: string; resolve: (layout: PhotoshopRawLayout | null) => void; }
let photoshopRawPicker: ((req: PhotoshopRawOpenRequest) => void) | null = null;
export function registerPhotoshopRawPicker(fn: typeof photoshopRawPicker) { photoshopRawPicker = fn; }

/** Ask for a headerless file's layout and open it (or Cancel doesn't).
 *  `ask` false is a caller nobody answers a modal for (MCP doc.open): it gets
 *  the refusal thrown, because no document opened. */
function askPhotoshopRawLayout(bytes: Uint8Array, name: string, path?: string, ask = true): Promise<boolean> {
  if (!ask) throw new Error("A Photoshop Raw file needs its width, height and channels. Open it with doc.openPhotoshopRaw.");
  const picker = photoshopRawPicker;
  if (!picker) throw new Error("A Photoshop Raw file needs its width, height and channels. Open it from File ▸ Open.");
  return new Promise<PhotoshopRawLayout | null>((resolve) => picker({ bytes, name, path, resolve }))
    .then((layout) => layout !== null && openPhotoshopRaw(bytes, name, layout, path));
}

/** The layout each Photoshop Raw document was opened with, so File ▸ Revert
 *  can re-read its file; `closeDocumentTab` drops the entry with the tab. */
const photoshopRawLayouts = new Map<number, { path: string; layout: PhotoshopRawLayout }>();

/** Open headerless Photoshop Raw laid out as `layout` describes. The samples
 *  carry no profile, so the missing-profile policy applies. Throws what the
 *  engine refused. */
function adoptPhotoshopRaw(bytes: Uint8Array, name: string, layout: PhotoshopRawLayout, path?: string) {
  // wasm-bindgen converts numbers to u32 before Rust can validate them.
  if (![layout.width, layout.height, layout.channels, layout.header].every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff)) {
    throw new Error("Photoshop Raw dimensions, channels and header must be unsigned 32-bit integers.");
  }
  if (layout.depth !== 8 && layout.depth !== 16) throw new Error("Photoshop Raw depth must be 8 or 16.");
  const workingProfile = store.state.colorProfile;
  store.openPhotoshopRaw(bytes, name, layout);
  applyOpenedImageMissingProfilePolicy(name, workingProfile);
  if (!path) return;
  store.setActivePath(path);
  photoshopRawLayouts.set(store.state.activeDocId, { path, layout });
}

/** The Photoshop Raw Options dialog's OK. */
export function openPhotoshopRaw(bytes: Uint8Array, name: string, layout: PhotoshopRawLayout, path?: string): boolean {
  try {
    adoptPhotoshopRaw(bytes, name, layout, path);
    return true;
  } catch (e) {
    reportOpen(name, e);
    return false;
  }
}

/** Open a native path as Photoshop Raw with a known layout (MCP), throwing
 *  instead of alerting. */
export async function openPhotoshopRawPath(path: string, layout: PhotoshopRawLayout) {
  const bytes = await readNativeFileBounded(path, (prefix) => openFileReadLimit(path, prefix));
  adoptPhotoshopRaw(bytes, path.replace(/^.*[\\/]/, ""), layout, path);
}

/** `.raw` is camera raw and Photoshop Raw alike. The camera decoder gets the
 *  first try; a `.raw` it cannot read waits for its Photoshop Raw layout and
 *  returns whether it opened. Other refusals still throw. */
function openCameraRaw(bytes: Uint8Array, name: string, options: Parameters<typeof store.openRaw>[2], path?: string, askLayout = true): string | Promise<boolean> {
  try {
    return store.openRaw(bytes, name, options);
  } catch (e) {
    const undecodable = String(e instanceof Error ? e.message : e).startsWith("raw decode failed");
    if (!undecodable || !PHOTOSHOP_RAW_RE.test(name)) throw e;
    return askPhotoshopRawLayout(bytes, name, path, askLayout);
  }
}

/** Open an AVIF file: the engine's `image` decoder can't handle AVIF in wasm, so
 *  decode it to PNG in TS (via @jsquash/avif) and route that through the normal
 *  image-open path. Async — routeOpen fires it and returns; errors surface via
 *  the same graceful alert as every other open. Exported so it's drivable
 *  programmatically (scripting / e2e) exactly like store.openImage. */
export async function openAvif(bytes: Uint8Array, name: string, path?: string): Promise<boolean> {
  const workingProfile = store.state.colorProfile;
  try {
    const png = await avifToPng(bytes);
    store.openImage(png, name);
    // The transcoded PNG is untagged: the profile lives in the ORIGINAL bytes'
    // colr/prof box, so sniff those, not the PNG (#464).
    applyOpenedImageProfilePolicy(bytes, name, workingProfile);
    if (path) store.setActivePath(path);
    return true;
  } catch (e) {
    reportOpen(name, e);
    return false;
  }
}

/** Open a HEIC/HEIF file: HEVC decode is patent-encumbered, so instead of
 *  bundling a wasm decoder Vision decodes via the macOS OS codec in the native
 *  `heic` Tauri plugin (ImageIO, EXIF orientation honored). The command returns
 *  packed `[w:u32 le][h:u32 le][rgba]`; unpack it, wrap as ImageData → PNG and
 *  route through the normal image-open path (mirrors openAvif). Desktop-only —
 *  the browser dev build has no native codec, so surface a clean message and
 *  create no document. Exported so it's drivable programmatically (scripting /
 *  e2e) exactly like store.openImage. */
/** HEIC/HEIF → PNG through the desktop ImageIO plugin. The profile stays in the original bytes. */
async function heicToPng(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isTauri()) throw new Error("HEIC/HEIF open requires the Monet Vision desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  const packed = new Uint8Array(await invoke<ArrayBuffer>("plugin:heic|decode_heic", bytes));
  if (packed.length < 8) throw new Error("HEIC decode returned no image");
  const dv = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const w = dv.getUint32(0, true), h = dv.getUint32(4, true);
  const rgba = packed.subarray(8);
  if (rgba.length !== w * h * 4) throw new Error("HEIC decode size mismatch");
  return imageDataToPng(new ImageData(new Uint8ClampedArray(rgba), w, h));
}

function rasterImageData(data: Uint8Array, width: number, height: number): ImageData {
  const pixels = new Uint8ClampedArray(data);
  return new ImageData(pixels, width, height);
}

/** Formats the engine's `image` crate cannot decode, as PNG, using Open's transcoders (#516). */
async function rasterBytesForEngine(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  if (AVIF_RE.test(name)) return avifToPng(bytes);
  if (SVG_RE.test(name)) return svgToPng(bytes);
  if (HEIC_RE.test(name)) return heicToPng(bytes);
  if (TGA_RE.test(name)) {
    const dec = decodeTga(bytes);
    if (!dec) throw new Error("Unsupported or corrupt TGA file");
    return imageDataToPng(rasterImageData(dec.data, dec.width, dec.height));
  }
  if (PNM_RE.test(name)) {
    const dec = decodePnm(bytes);
    if (!dec) throw new Error("Unsupported or corrupt Netpbm file");
    return imageDataToPng(rasterImageData(dec.data, dec.width, dec.height));
  }
  if (PCX_RE.test(name)) {
    const dec = decodePcx(bytes);
    if (!dec) throw new Error("Unsupported or corrupt PCX file");
    return imageDataToPng(rasterImageData(dec.data, dec.width, dec.height));
  }
  return bytes;
}

/** Place converts an embedded profile into the document the way Open does, on the new layer only. */
function applyPlacedImageProfile(sourceBytes: Uint8Array, name: string, layerId: number) {
  const embedded = detectEmbeddedRgbProfile(sourceBytes);
  if (!embedded) return;
  const working = store.state.colorProfile;
  const customName = embedded.iccProfileBytes?.length ? embedded.name : null;
  const decision = embeddedProfilePolicyDecision(working, embedded.profile, store.state.colorPolicyPrefs.embeddedProfilePolicy, customName);
  const convert = () => {
    const eng = E() as ReturnType<typeof E> & {
      convert_layer_profile?: (
        id: number, sourceProfile: number, sourceIcc: Uint8Array,
        destinationProfile: number, destinationIcc: Uint8Array,
        intent: number, blackPointCompensation: boolean,
      ) => boolean;
    };
    if (typeof eng.convert_layer_profile !== "function") return;
    const { intent, blackPointCompensation } = store.state.colorPolicyPrefs;
    eng.convert_layer_profile(
      layerId,
      embedded.profile,
      embedded.iccProfileBytes ?? new Uint8Array(),
      working,
      store.state.iccProfileBytes ?? new Uint8Array(),
      intent,
      blackPointCompensation,
    );
  };
  if (decision === "convert") {
    convert();
    return;
  }
  if (decision !== "ask") return;
  const warning = embeddedProfileOpenWarning(working, embedded.profile, name, customName);
  const preserve = !warning || !!_batchOpenSuppress?.profiles || typeof confirm !== "function" || confirm(`${warning}\n\nOK preserves the embedded profile (${customName ?? profileName(embedded.profile)}). Cancel converts to the current working RGB (${profileName(working)}).`);
  if (!preserve) convert();
}

export async function openHeic(bytes: Uint8Array, name: string, path?: string): Promise<boolean> {
  if (!isTauri()) {
    reportOpen(name, new Error("HEIC/HEIF open requires the Monet Vision desktop app."));
    return false;
  }
  const workingProfile = store.state.colorProfile;
  try {
    const png = await heicToPng(bytes);
    store.openImage(png, name);
    // ImageIO preserves the source RGB samples; the profile lives in the
    // ORIGINAL bytes' colr/prof box, not the untagged PNG (#464).
    applyOpenedImageProfilePolicy(bytes, name, workingProfile);
    if (path) store.setActivePath(path);
    return true;
  } catch (e) {
    reportOpen(name, e);
    return false;
  }
}

/** Open an SVG file: Rust's `image` can't decode SVG, so rasterize it to PNG in
 *  TS (browser <img>, secure static mode) and route that through the normal
 *  image-open path. Async — routeOpen fires it and returns; errors surface via
 *  the same graceful alert as every other open. Exported so it's drivable
 *  programmatically (scripting / e2e) exactly like store.openImage. */
export async function openSvg(bytes: Uint8Array, name: string, path?: string): Promise<boolean> {
  const workingProfile = store.state.colorProfile;
  try {
    const png = await svgToPng(bytes);
    store.openImage(png, name);
    applyOpenedImageProfilePolicy(png, name, workingProfile);
    if (path) store.setActivePath(path);
    return true;
  } catch (e) {
    reportOpen(name, e);
    return false;
  }
}

// Bridge: the React DialogProvider registers a page-picker opener so this
// state-layer flow can raise the multi-page chooser. Null in headless/scripting
// contexts (then openPdf just rasterizes the first page).
export interface PdfPageRequest { bytes: Uint8Array; name: string; path?: string; count: number; }
let pdfPagePicker: ((req: PdfPageRequest) => void) | null = null;
export function registerPdfPagePicker(fn: ((req: PdfPageRequest) => void) | null) { pdfPagePicker = fn; }

// Same bridge for TIFF Options: Save As and Export ▸ TIFF ask whether a layered
// document keeps its layers. Resolves true/false, or null for Cancel. Null in
// headless/scripting contexts, where TIFF stays flat.
let tiffLayersPicker: ((resolve: (layers: boolean | null) => void) => void) | null = null;
export function registerTiffLayersPicker(fn: typeof tiffLayersPicker) { tiffLayersPicker = fn; }

// And for JPEG 2000 Options (Lossless / Quality) and Photoshop Raw Options
// (header, channel order, byte order) (#466). Resolves null for Cancel; with
// no picker (headless, scripting) the format's defaults are written.
export interface Jpeg2000Options { lossless: boolean; quality: number; }
export interface SaveFormatOptions { jpeg2000?: Jpeg2000Options; photoshopRaw?: PhotoshopRawSaveOptions; }
export type SaveOptionsFormat = "jpeg2000" | "photoshopRaw";
let saveOptionsPicker: ((format: SaveOptionsFormat, resolve: (options: SaveFormatOptions | null) => void) => void) | null = null;
export function registerSaveOptionsPicker(fn: typeof saveOptionsPicker) { saveOptionsPicker = fn; }
const JPEG2000_SAVE_EXTENSIONS = new Set(["jp2", "jpf", "j2k"]);

/** The options a Save As to `ext` asks for first: `{}` when the format has
 *  none, null when the user cancels. */
function askSaveFormatOptions(ext: string): Promise<SaveFormatOptions | null> {
  const format: SaveOptionsFormat | null = ext === "raw" ? "photoshopRaw" : JPEG2000_SAVE_EXTENSIONS.has(ext) ? "jpeg2000" : null;
  const picker = saveOptionsPicker;
  if (!format || !picker) return Promise.resolve({});
  return new Promise((resolve) => picker(format, resolve));
}

/** Open a PDF file: Rust's `image` can't decode PDF, so rasterize a page to PNG
 *  via pdf.js and route it through the normal image-open path. A single-page PDF
 *  opens its one page directly; a multi-page PDF raises the page picker first
 *  (falling back to page 1 when no picker is registered). Mirrors openSvg. */
export async function openPdf(bytes: Uint8Array, name: string, path?: string, interactive = true): Promise<boolean> {
  try {
    const count = await pdfPageCount(bytes);
    if (count > 1 && interactive && pdfPagePicker) { pdfPagePicker({ bytes, name, path, count }); return false; }
    return await openPdfPage(bytes, name, path, 0);
  } catch (e) {
    reportOpen(name, e);
    return false;
  }
}

/** Rasterize a specific PDF page (0-based) and open it as a new document.
 *  Exported so the page-picker dialog (and scripting / e2e) can drive it. */
export async function openPdfPage(bytes: Uint8Array, name: string, path?: string, pageIndex = 0): Promise<boolean> {
  const workingProfile = store.state.colorProfile;
  try {
    const png = await pdfPageToPng(bytes, pageIndex);
    store.openImage(png, name);
    applyOpenedImageProfilePolicy(png, name, workingProfile);
    if (path) store.setActivePath(path);
    return true;
  } catch (e) {
    reportOpen(name, e);
    return false;
  }
}

/** Open a Truevision TGA file: the Rust `image` build has no tga decoder, so
 *  decode it in TS → PNG → the normal image-open path (mirrors openAvif). */
export async function openTga(bytes: Uint8Array, name: string, path?: string): Promise<boolean> {
  const workingProfile = store.state.colorProfile;
  try {
    const dec = decodeTga(bytes);
    if (!dec) throw new Error("Unsupported or corrupt TGA file");
    const img = new ImageData(new Uint8ClampedArray(dec.data), dec.width, dec.height);
    const png = await imageDataToPng(img);
    store.openImage(png, name);
    applyOpenedImageProfilePolicy(png, name, workingProfile);
    if (path) store.setActivePath(path);
    return true;
  } catch (e) {
    reportOpen(name, e);
    return false;
  }
}

/** `eng`'s composite as 32-bit RLE Targa bytes. The Rust `image` build has no
 *  tga encoder, so the PNG goes through a canvas. Shared by File ▸ Export ▸
 *  Targa and Save As ▸ TGA; the engine read precedes the first await. */
async function tgaCompositeBytes(eng: ReturnType<typeof E>): Promise<Uint8Array> {
  const png = eng.export_png();
  const url = URL.createObjectURL(new Blob([png as unknown as BlobPart], { type: "image/png" }));
  try {
    const img = await loadImg(url);
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const cx = c.getContext("2d")!; cx.drawImage(img, 0, 0);
    return encodeTga(cx.getImageData(0, 0, w, h).data, w, h, { rle: true });
  } finally { URL.revokeObjectURL(url); }
}

/** File ▸ Export ▸ Targa: the composite as a 32-bit RLE-compressed .tga. */
export async function exportTGA(name = "monet-vision.tga") {
  return reportSaveExport(async () => saveBytes(name, await tgaCompositeBytes(E()), "image/x-tga"));
}

/** Open a Netpbm file (.pnm/.ppm/.pgm/.pbm): the Rust `image` build has no pnm
 *  decoder, so decode in TS → PNG → the normal image-open path (mirrors openTga). */
export async function openPnm(bytes: Uint8Array, name: string, path?: string): Promise<boolean> {
  const workingProfile = store.state.colorProfile;
  try {
    const dec = decodePnm(bytes);
    if (!dec) throw new Error("Unsupported or corrupt Netpbm file");
    const img = new ImageData(new Uint8ClampedArray(dec.data), dec.width, dec.height);
    const png = await imageDataToPng(img);
    store.openImage(png, name);
    applyOpenedImageProfilePolicy(png, name, workingProfile);
    if (path) store.setActivePath(path);
    return true;
  } catch (e) {
    reportOpen(name, e);
    return false;
  }
}

/** File ▸ Export ▸ Portable Bitmap: the composite as a binary P6 .ppm. */
export async function exportPPM(name = "monet-vision.ppm") {
  return reportSaveExport(async () => {
    const png = E().export_png();
    const url = URL.createObjectURL(new Blob([png as unknown as BlobPart], { type: "image/png" }));
    try {
      const img = await loadImg(url);
      const w = img.naturalWidth, h = img.naturalHeight;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const cx = c.getContext("2d");
      if (!cx) throw new Error("Could not create the PPM export canvas.");
      cx.drawImage(img, 0, 0);
      saveBytes(name, encodePnm(cx.getImageData(0, 0, w, h).data, w, h), "image/x-portable-pixmap");
    } finally { URL.revokeObjectURL(url); }
  });
}

/** Open a ZSoft PCX file: the Rust `image` build has no pcx decoder, so decode
 *  in TS → PNG → the normal image-open path (mirrors openTga/openPnm). */
export async function openPcx(bytes: Uint8Array, name: string, path?: string): Promise<boolean> {
  const workingProfile = store.state.colorProfile;
  try {
    const dec = decodePcx(bytes);
    if (!dec) throw new Error("Unsupported or corrupt PCX file");
    const img = new ImageData(new Uint8ClampedArray(dec.data), dec.width, dec.height);
    const png = await imageDataToPng(img);
    store.openImage(png, name);
    applyOpenedImageProfilePolicy(png, name, workingProfile);
    if (path) store.setActivePath(path);
    return true;
  } catch (e) {
    reportOpen(name, e);
    return false;
  }
}

/** File ▸ Export ▸ PCX: the composite as a 24-bit RLE .pcx. */
export async function exportPCX(name = "monet-vision.pcx") {
  return reportSaveExport(async () => {
    const png = E().export_png();
    const url = URL.createObjectURL(new Blob([png as unknown as BlobPart], { type: "image/png" }));
    try {
      const img = await loadImg(url);
      const w = img.naturalWidth, h = img.naturalHeight;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const cx = c.getContext("2d");
      if (!cx) throw new Error("Could not create the PCX export canvas.");
      cx.drawImage(img, 0, 0);
      saveBytes(name, encodePcx(cx.getImageData(0, 0, w, h).data, w, h), "image/x-pcx");
    } finally { URL.revokeObjectURL(url); }
  });
}

/** A policy conversion takes Color Settings' Intent and Black Point
 *  Compensation, like every other profile conversion. */
function convertToWorkingRgb(workingProfile: number) {
  const { intent, blackPointCompensation } = store.state.colorPolicyPrefs;
  store.convertToProfile(workingProfile, intent, blackPointCompensation);
}

function applyOpenedImageProfilePolicy(bytes: Uint8Array, name: string, workingProfile: number) {
  const embedded = detectEmbeddedRgbProfile(bytes);
  if (!embedded) {
    applyOpenedImageMissingProfilePolicy(name, workingProfile);
    return;
  }
  // A custom profile (PNG iCCP / JPEG APP2 / TIFF / PSD bytes that match no
  // built-in) clamps to sRGB by id; its own name keeps the policy honest and
  // the prompt naming the real profile (#439).
  const customName = embedded.iccProfileBytes?.length ? embedded.name : null;
  const decision = embeddedProfilePolicyDecision(workingProfile, embedded.profile, store.state.colorPolicyPrefs.embeddedProfilePolicy, customName);
  if (decision === "ask") {
    const warning = embeddedProfileOpenWarning(workingProfile, embedded.profile, name, customName);
    // Suppressed (Batch) takes the answer Photoshop's dialog pre-selects: keep the embedded profile.
    const preserve = !warning || !!_batchOpenSuppress?.profiles || typeof confirm !== "function" || confirm(`${warning}\n\nOK preserves the embedded profile (${customName ?? profileName(embedded.profile)}). Cancel converts to the current working RGB (${profileName(workingProfile)}).`);
    store.assignProfile(embedded.profile, embedded.iccProfileBytes, embedded.name);
    if (!preserve) convertToWorkingRgb(workingProfile);
  } else if (decision === "preserve") {
    store.assignProfile(embedded.profile, embedded.iccProfileBytes, embedded.name);
  } else if (decision === "convert") {
    store.assignProfile(embedded.profile, embedded.iccProfileBytes, embedded.name);
    convertToWorkingRgb(workingProfile);
  } else {
    store.assignProfile(workingProfile);
  }
  store.markActiveSaved();
}

function applyOpenedImageMissingProfilePolicy(name: string, workingProfile: number) {
  const decision = missingProfilePolicyDecision(workingProfile, store.state.colorPolicyPrefs.missingProfilePolicy);
  if (decision === "ask") {
    const warning = missingProfileOpenWarning(workingProfile, name);
    // Suppressed (Batch) takes Photoshop's pre-selected "Leave as is": untagged.
    const assignWorking = !warning || (!_batchOpenSuppress?.profiles && (typeof confirm !== "function" || confirm(`${warning}\n\nOK assigns the current working RGB (${profileName(workingProfile)}). Cancel leaves the file untagged.`)));
    if (assignWorking) store.assignProfile(workingProfile);
    else store.markProfileUntagged(workingProfile);
  } else if (decision === "assign-working") {
    store.assignProfile(workingProfile);
  } else if (decision === "assign-srgb") {
    store.assignProfile(0);
  } else {
    store.markProfileUntagged(workingProfile);
  }
  store.markActiveSaved();
}

/** File ▸ Open as Smart Object: open a picked file as a new document, then
 *  convert its layer to a smart object (non-destructive filter container). */
export async function openAsSmartObject() {
  const file = await new Promise<File | null>((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = OPEN_ACCEPT;
    inp.onchange = () => { resolve(inp.files?.[0] ?? null); inp.remove(); };
    inp.oncancel = () => { inp.remove(); resolve(null); };
    document.body.appendChild(inp);
    inp.click();
  });
  if (!file) return;
  try {
    const bytes = await readBrowserOpenFile(file);
    if (photoshopVersion(bytes) === null && RAW_RE.test(file.name)) {
      const sessionId = await openCameraRaw(bytes, file.name, {
        invocation: "open-as-smart-object",
        sha256: await cameraRawSha256(bytes),
        lastModified: file.lastModified,
      });
      if (typeof sessionId === "string") await store.waitForCameraRawSession(sessionId);
      else if (sessionId) smart.convert(store.state.activeLayerId);
      return;
    }
    if (await routeOpen(bytes, file.name)) smart.convert(store.state.activeLayerId);
  } catch (e) {
    reportOpen(file.name, e);
  }
}

/** Open a File picked by the browser <input> or dropped onto the window. */
export async function openImageFile(file: File) {
  try {
    const bytes = await readBrowserOpenFile(file);
    if (photoshopVersion(bytes) === null && RAW_RE.test(file.name)) {
      const sessionId = await openCameraRaw(bytes, file.name, {
        sha256: await cameraRawSha256(bytes),
        lastModified: file.lastModified,
      });
      if (typeof sessionId === "string") await store.waitForCameraRawSession(sessionId);
      return;
    }
    await routeOpen(bytes, file.name);
  }
  catch (e) { reportOpen(file.name, e); }
}

/** Open browser-picked/dropped files. RAW sources are staged together so they
 * coexist as a Camera Raw filmstrip (bounded by the pending-session cap; extras
 * that exceed it are skipped and reported). Non-RAW files open serially as
 * before. Single-file/automation paths keep using openImageFile (serial await).*/
export async function openImageFiles(files: Iterable<File>) {
  const list = [...files];
  const raws = list.filter((f) => RAW_RE.test(f.name));
  const others = list.filter((f) => !RAW_RE.test(f.name));
  // Stage all RAWs first, without awaiting each workspace's terminal choice, so
  // multiple appear in the filmstrip at once.
  for (const file of raws) {
    try {
      const bytes = await readBrowserOpenFile(file);
      if (photoshopVersion(bytes) === null && RAW_RE.test(file.name)) {
        await openCameraRaw(bytes, file.name, {
          sha256: await cameraRawSha256(bytes),
          lastModified: file.lastModified,
        });
      } else {
        await routeOpen(bytes, file.name); // e.g. a non-RAW file with a RAW-looking name
      }
    } catch (e) { reportOpen(file.name, e); }
  }
  for (const file of others) await openImageFile(file);
}
/** Open a `.mvision` project or any Monet container picked by the browser <input>. */
export async function openProjectFile(file: File) {
  try { await routeOpen(await readBrowserOpenFile(file), file.name); }
  catch (e) { reportOpen(file.name, e); }
}

/** Place decoded bytes directly as a new embedded Smart Object. */
export async function placeEmbeddedFromBytes(bytes: Uint8Array, name: string): Promise<number> {
  const raster = await rasterBytesForEngine(bytes, name);
  const id = E().place_smart_object(raster, name.replace(/\.[^.]+$/, ""));
  applyPlacedImageProfile(bytes, name, id);
  engine.commit();
  return id;
}

/** Place decoded bytes as a new linked Smart Object and retain its source
 *  identity for relink/update/package workflows. Browser picks have no stable
 *  filesystem path, but remain linked-by-name and can be relinked later. */
export async function placeLinkedFromBytes(bytes: Uint8Array, name: string, path?: string): Promise<number> {
  const raster = await rasterBytesForEngine(bytes, name);
  const id = E().place_smart_object(raster, name.replace(/\.[^.]+$/, ""));
  applyPlacedImageProfile(bytes, name, id);
  const now = Date.now();
  setSmartLink({
    docId: store.state.activeDocId,
    layerId: id,
    name,
    path,
    missing: false,
    linkedAt: now,
    updatedAt: now,
  });
  engine.commit();
  return id;
}

/** Place/import an image as a layer in the *current* document (not a new tab).
 *  When the active layer is a Frame container (or sits inside one), the image
 *  fills that frame (centred + clipped) instead — Photoshop's Frame-tool place.
 *  Ordinary File ▸ Place Embedded creates a one-step Smart Object placement. */
export async function placeImageFile(file: File) {
  try {
    if (RAW_RE.test(file.name)) throw new Error("Develop Camera Raw files before placing them.");
    const buf = await readBrowserImageFile(file, "place");
    const name = file.name.replace(/\.[^.]+$/, "");
    const fid = store.activeFrameId();
    if (fid) { store.fillFrame(fid, await rasterBytesForEngine(buf, file.name), name); return; }
    await placeEmbeddedFromBytes(buf, file.name);
  } catch (e) {
    reportOpen(file.name, e);
  }
}

/** File ▸ Place Linked. Native builds keep the selected filesystem path so the
 *  watcher can refresh it; browser builds use a regular file chooser. */
export async function placeLinkedImage() {
  if (isTauri()) {
    const picked = await pickSmartLinkedSourceFile();
    if (!picked) return;
    try { await placeLinkedFromBytes(picked.bytes, picked.name, picked.path); }
    catch (e) { reportOpen(picked.name, e); }
    return;
  }
  const file = await new Promise<File | null>((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = SMART_LINK_ACCEPT;
    inp.onchange = () => { resolve(inp.files?.[0] ?? null); inp.remove(); };
    inp.oncancel = () => { inp.remove(); resolve(null); };
    document.body.appendChild(inp);
    inp.click();
  });
  if (!file) return;
  try { await placeLinkedFromBytes(await readBrowserImageFile(file, "place"), file.name); }
  catch (e) { reportOpen(file.name, e); }
}

/** Drop/place an image INTO a specific frame container (Frame tool): import it
 *  as a centred, clipped member of `frameId`. */
export async function placeImageIntoFrame(file: File, frameId: number) {
  try {
    if (RAW_RE.test(file.name)) throw new Error("Develop Camera Raw files before placing them into a frame.");
    const buf = await readBrowserImageFile(file, "place");
    store.fillFrame(frameId, buf, file.name.replace(/\.[^.]+$/, ""));
  } catch (e) {
    reportOpen(file.name, e);
  }
}

/** Read a native (Tauri) file path's bytes and drop them INTO a frame. */
export async function placePathIntoFrame(path: string, frameId: number) {
  try {
    if (RAW_RE.test(path)) throw new Error("Develop Camera Raw files before placing them into a frame.");
    const bytes = await readNativeImagePath(path, "place");
    store.fillFrame(frameId, bytes, path.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, ""));
  } catch (e) {
    reportOpen(path, e);
  }
}

// Every Monet app's extension: Vision opens any container, so the dialog must
// let the user PICK one (the manifest, not this list, decides how it loads).
const MONET_CONTAINER_EXTENSIONS = CONTAINER_APPS.map((row) => row.ext.slice(1));

// Native (Tauri) dialog file-type filters — mirror the browser <input accept>.
// Photoshop's plug-in formats (#466). `.raw` is listed under RAW too: camera
// raw gets the first try, and a file it can't read opens as Photoshop Raw.
const JPEG2000_EXTENSIONS = ["jp2", "jpf", "jpx", "j2k", "j2c", "jpc"];
const CINEON_EXTENSIONS = ["cin", "dpx", "sdpx"];
const IFF_EXTENSIONS = ["iff", "ilbm", "lbm"];
const DICOM_EXTENSIONS = ["dcm", "dc3", "dic", "dicom"];
const PLUGIN_FORMAT_EXTENSIONS = [...JPEG2000_EXTENSIONS, ...CINEON_EXTENSIONS, ...IFF_EXTENSIONS, ...DICOM_EXTENSIONS];
const OPEN_FILTERS = [
  { name: "All Supported", extensions: [
    "png", "jpg", "jpeg", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff", "gif", "svg", "tga", "pnm", "ppm", "pgm", "pbm", "pcx", "pdf",
    ...PLUGIN_FORMAT_EXTENSIONS, "rawps",
    "psd", "psb", "xcf",
    "cr2", "cr3", "nef", "arw", "dng", "raf", "rw2", "orf", "pef", "srw", "raw", "nrw", "mrw", "dcr",
    "mvision", ...MONET_CONTAINER_EXTENSIONS, "artisan",
  ] },
  { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff", "gif", "svg", "tga", "pnm", "ppm", "pgm", "pbm", "pcx", ...PLUGIN_FORMAT_EXTENSIONS] },
  { name: "JPEG 2000", extensions: JPEG2000_EXTENSIONS },
  { name: "Cineon / DPX", extensions: CINEON_EXTENSIONS },
  { name: "IFF", extensions: IFF_EXTENSIONS },
  { name: "DICOM", extensions: DICOM_EXTENSIONS },
  { name: "Photoshop Raw", extensions: ["raw", "rawps"] },
  { name: "PDF", extensions: ["pdf"] },
  { name: "Layered (PSD/PSB/XCF)", extensions: ["psd", "psb", "xcf"] },
  { name: "RAW", extensions: ["cr2", "cr3", "nef", "arw", "dng", "raf", "rw2", "orf", "pef", "srw", "raw", "nrw", "mrw", "dcr"] },
  { name: "Monet Vision Project", extensions: ["mvision"] },
  { name: "Monet Documents", extensions: MONET_CONTAINER_EXTENSIONS },
  { name: "Monet Artisan", extensions: ["artisan"] },
];
const SAVE_FILTERS = [
  { name: "Monet Vision Project", extensions: ["mvision"] },
  { name: "Monet Vision Document", extensions: [VISION_CONTAINER_EXT] },
  { name: "PNG", extensions: ["png"] },
  { name: "JPEG", extensions: ["jpg", "jpeg"] },
  { name: "Photoshop", extensions: ["psd", "psb"] },
  { name: "Animated GIF", extensions: ["gif"] },
  { name: "TIFF", extensions: ["tif", "tiff"] },
  { name: "WebP", extensions: ["webp"] },
  { name: "PDF", extensions: ["pdf"] },
  { name: "Radiance HDR", extensions: ["hdr"] },
  { name: "OpenEXR", extensions: ["exr"] },
  { name: "Targa", extensions: ["tga"] },
  { name: "JPEG 2000", extensions: ["jp2", "jpf", "j2k"] },
  { name: "Photoshop Raw", extensions: ["raw"] },
];

/** Vision's `.mvis` bytes: the engine's own graphics container, restamped as
 *  written by Vision and merged back over the container this document was
 *  opened from, so every foreign entry and manifest field survives the save
 *  (design doc 11 rule 2). */
function visionContainerBytes(eng: ReturnType<typeof E>, docId: number): Uint8Array {
  const fresh = readContainer(engine.graphicsContainerBytes(eng));
  const merged = courierContainerSave(containerCargo.get(docId) ?? null, fresh);
  // The engine's container holds pixels, masks and channels. Everything else the
  // document owns lives in JS, and without an entry of its own it was destroyed
  // by a save the app then reported as successful (#493).
  const document = store.docDocumentMeta(docId, { copyCameraRawBytes: false });
  if (document) {
    setEntry(merged, VISION_DOCUMENT_ENTRY_PATH, VISION_DOCUMENT_ROLE, encodeDocumentMetaBytes(document));
  }
  return writeContainer(merged);
}

/** The bytes to write for a target file extension (drives save-in-place + Save
 *  As). Callers must choose an explicitly supported extension; silently writing
 *  project bytes under a RAW/unknown suffix can destroy a camera original.
 *  `eng` pins which document's engine to export — saves capture it before any
 *  await, so a mid-save tab switch can never write another document's pixels.
 *  Exported so path-taking callers (the MCP `doc.saveAs` / `doc.exportAs` tools)
 *  write through this one format table instead of keeping their own copy. */
const NON_RGB_MODE_NAMES = ["RGB", "Grayscale", "CMYK", "Lab", "Multichannel"];

/** PNG/JPEG/TIFF/WebP/GIF/HDR/EXR encoders write RGB(A). Refuse a non-RGB
 *  document instead of writing that file and letting a save mark the tab clean. (#520) */
export function refuseNonRgbFlatExport(eng: { doc_mode?: () => number }, format: string): void {
  const mode = eng.doc_mode?.() ?? 0;
  if (mode === 0) return;
  const name = NON_RGB_MODE_NAMES[mode] ?? "non-RGB";
  throw new Error(`This ${name} document cannot be written as an RGB ${format}. Save as Photoshop, or choose Image ▸ Mode ▸ RGB Color.`);
}

export async function bytesForExt(ext: string, opts: { eng?: ReturnType<typeof E>; docId?: number; quality?: number; tiffLayers?: boolean } & SaveFormatOptions = {}): Promise<{ bytes: Uint8Array; mime: string }> {
  if (!isSupportedSaveExtension(ext)) throw new Error(`Unsupported save extension: .${ext || "(none)"}`);
  const eng = opts.eng ?? E();
  assertHistorySettled(eng);
  if (isProjectSaveExtension(ext)) assertImportedPhotoshopWritable(eng);
  const docId = opts.docId ?? store.state.activeDocId;
  const docMeta = store.docDocumentMeta(docId);
  switch (ext) {
    case "png": refuseNonRgbFlatExport(eng, "PNG"); return { bytes: eng.export_png_with_icc(exportIccBytes(docMeta)), mime: "image/png" };
    case "jpg": case "jpeg": refuseNonRgbFlatExport(eng, "JPEG"); return { bytes: eng.export_jpeg_with_icc(opts.quality ?? 92, exportIccBytes(docMeta)), mime: "image/jpeg" };
    case "psd": return { bytes: psdExportBytes(eng, docMeta ?? { colorProfileAssigned: true }, store.docDuotone(docId)), mime: "image/vnd.adobe.photoshop" };
    case "psb": return { bytes: psbExportBytes(eng, docMeta ?? { colorProfileAssigned: true }, store.docDuotone(docId)), mime: "image/vnd.adobe.photoshop" };
    case "gif": refuseNonRgbFlatExport(eng, "GIF"); return { bytes: eng.export_gif(10), mime: "image/gif" };
    case "tif": case "tiff": {
      refuseNonRgbFlatExport(eng, "TIFF");
      const icc = exportIccBytes(docMeta);
      return { bytes: opts.tiffLayers ? layeredTiffBytes(eng, icc) : eng.export_tiff_with_icc(icc), mime: "image/tiff" };
    }
    case "webp": refuseNonRgbFlatExport(eng, "WebP"); return { bytes: eng.export_webp_with_icc(exportIccBytes(docMeta)), mime: "image/webp" };
    case "hdr": refuseNonRgbFlatExport(eng, "HDR"); return { bytes: eng.export_hdr(), mime: "image/vnd.radiance" };
    case "exr": refuseNonRgbFlatExport(eng, "EXR"); return { bytes: eng.export_exr(), mime: "image/x-exr" };
    // JPEG 2000 defaults to lossless: nothing is thrown away without asking.
    case "jp2": case "jpf": case "j2k": {
      const { lossless, quality } = opts.jpeg2000 ?? { lossless: true, quality: 100 };
      return { bytes: eng.export_jpeg2000(lossless, quality, ext === "j2k"), mime: ext === "jpf" ? "image/jpx" : "image/jp2" };
    }
    case "raw": {
      const { interleaved, bigEndian, header } = opts.photoshopRaw ?? DEFAULT_PHOTOSHOP_RAW_SAVE;
      return { bytes: eng.export_photoshop_raw(interleaved, bigEndian, header), mime: "application/octet-stream" };
    }
    // TGA and PDF have no synchronous encoder (canvas / page assembly), but both
    // read the engine before their first await, so the pixels stay pinned.
    case "tga": return { bytes: await tgaCompositeBytes(eng), mime: "image/x-tga" };
    case "pdf": {
      const title = store.docName(docId)?.replace(/\.[^.]+$/, "") ?? "Untitled";
      const bytes = await pdfCompositeBytes(eng, title, {}, docMeta);
      if (!bytes) throw new Error("Could not build the PDF for this document.");
      return { bytes, mime: "application/pdf" };
    }
    case VISION_CONTAINER_EXT:
      return { bytes: visionContainerBytes(eng, docId), mime: "application/vnd.monet.container" };
    case "mvision": return { bytes: projectBytesForDoc(docId), mime: "application/octet-stream" };
    default: throw new Error(`Unsupported save extension: .${ext}`);
  }
}

// Flat raster formats can faithfully hold only a plain single pixel layer.
// A mask, style, smart filter, odd blend, non-RGB mode or a depth the format
// cannot store used to count as "flat" because the only test was layer_count,
// so ⌘S flattened that work into the source file and cleared the dirty flag.
// Photoshop forces Save As in that case. (#546)
type FlatProbe = {
  layer_count(): number;
  layer_id_at(index: number): number;
  layer_kind(id: number): number;
  layer_visible(id: number): boolean;
  layer_blend(id: number): number;
  layer_opacity(id: number): number;
  layer_fill_opacity(id: number): number;
  layer_has_mask(id: number): boolean;
  has_vector_mask(id: number): boolean;
  layer_has_effects(id: number): boolean;
  smart_filter_count(id: number): number;
  layer_has_transparency(id: number): boolean;
  doc_mode(): number;
  doc_depth(): number;
  document_channel_count(): number;
  spot_channel_count(): number;
  frame_count(): number;
};

function flatDocumentFacts(eng: FlatProbe = E() as unknown as FlatProbe): FlatDocumentFacts {
  const layerCount = eng.layer_count();
  let layer: FlatLayerFacts | null = null;
  if (layerCount === 1) {
    const id = eng.layer_id_at(0);
    layer = {
      kind: eng.layer_kind(id),
      visible: eng.layer_visible(id),
      blend: eng.layer_blend(id),
      opacity: eng.layer_opacity(id),
      fill: eng.layer_fill_opacity(id),
      hasMask: eng.layer_has_mask(id),
      hasVectorMask: eng.has_vector_mask(id),
      hasEffects: eng.layer_has_effects(id),
      smartFilterCount: eng.smart_filter_count(id),
      hasTransparency: eng.layer_has_transparency(id),
    };
  }
  return {
    layerCount,
    layer,
    mode: eng.doc_mode(),
    depth: eng.doc_depth(),
    extraChannels: eng.document_channel_count() + eng.spot_channel_count(),
    frameCount: eng.frame_count(),
  };
}

function docFitsFlat(ext: string): boolean {
  return documentFitsFlatFormat(flatDocumentFacts(), ext);
}

/** Save talks to the format table through this object so a test can hand back
 *  an oversized payload without building a multi-hundred-megabyte document. */
export const documentSaveIo = {
  bytesForExt: (ext: string, opts?: Parameters<typeof bytesForExt>[1]) => bytesForExt(ext, opts),
};

function assertPayloadReopenable(ext: string, bytes: { byteLength: number }) {
  const message = savePayloadTooLarge(ext, bytes.byteLength);
  if (message) throw new Error(message);
}

function friendlySaveError(e: unknown): unknown {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("exceeds the decoded size limit")) {
    return new Error("This document is too large to save as .mvision. Save as .mvis or PSB instead.");
  }
  return e;
}

const OPEN_ACCEPT = "image/*,.avif,.heic,.heif,.svg,.tga,.pnm,.ppm,.pgm,.pbm,.pcx,.pdf,.psd,.psb,.xcf,.cr2,.cr3,.nef,.arw,.dng,.raf,.rw2,.orf,.pef,.srw,.raw,.rawps,.nrw,.mrw,.dcr,.mvision,.artisan"
  + [...PLUGIN_FORMAT_EXTENSIONS, ...MONET_CONTAINER_EXTENSIONS].map((ext) => `,.${ext}`).join("");

/** Open files as new document tabs — native dialog under Tauri, else a browser
 *  file picker. Used by the File menu and the document browser. */
export function openFiles() {
  if (isTauri()) { void openFileNative(); return; }
  const inp = document.createElement("input");
  inp.type = "file";
  inp.multiple = true;
  inp.accept = OPEN_ACCEPT;
  inp.style.display = "none";
  inp.onchange = () => { void openImageFiles(Array.from(inp.files ?? [])); inp.remove(); };
  inp.oncancel = () => inp.remove();
  document.body.appendChild(inp);
  inp.click();
}

/** Stack a list of decoded images into ONE new document: the first opens a new
 *  tab (via the normal dispatch), the rest are imported as layers on top.
 *  Returns how many of them landed; the rest were reported. */
export async function stackImages(items: { bytes: Uint8Array; name: string }[]): Promise<number> {
  if (!items.length) return 0;
  const raw = items.find((item) => photoshopVersion(item.bytes) === null && RAW_RE.test(item.name));
  if (raw) {
    reportOpen(raw.name, new Error("Develop Camera Raw files before loading them into a layer stack."));
    return 0;
  }
  const [first, ...rest] = items;
  // A first file that won't open (a compressed DICOM, say) must say why, and
  // the rest must not land in whichever document happens to be active.
  try { if (!await routeOpen(first.bytes, first.name, undefined, false)) return 0; }
  catch (e) { reportOpen(first.name, e); return 0; }
  let landed = 1;
  for (const it of rest) {
    try {
      const raster = await rasterBytesForEngine(it.bytes, it.name);
      const id = E().importImage(raster, it.name.replace(/\.[^.]+$/, ""));
      applyPlacedImageProfile(it.bytes, it.name, id);
      landed++;
    }
    catch (e) { reportOpen(it.name, e); }
  }
  engine.commit();
  return landed;
}

/** Read native files for a layer stack within the stack budget; a file that
 *  can't be read is reported and skipped. */
async function readStackPaths(paths: string[]) {
  const items: { bytes: Uint8Array; name: string }[] = [];
  let retainedBytes = 0;
  for (const p of paths) {
    try {
      let nextRetainedBytes = retainedBytes;
      const bytes = await readNativeFileBounded(
        p,
        (prefix) => imageReadLimit(p, "stack", prefix),
        (size) => { nextRetainedBytes = nextImageStackReadTotal(retainedBytes, size); },
      );
      items.push({ bytes, name: p.replace(/^.*[\\/]/, "") });
      retainedBytes = nextRetainedBytes;
    }
    catch (e) { reportOpen(p, e); }
  }
  return items;
}

/** A DICOM series in Instance Number order; files without one follow, by name. */
function dicomSeriesOrder(items: { bytes: Uint8Array; name: string }[]) {
  return items
    .map((item) => ({ item, n: engine.dicomInstanceNumber(item.bytes) ?? Infinity }))
    .sort((a, b) => a.n - b.n || a.item.name.localeCompare(b.item.name))
    .map(({ item }) => item);
}

/** File ▸ Scripts ▸ Load Files into Stack: pick multiple images and stack them
 *  as layers in a single new document (top-left aligned). `dicom` is Load
 *  Multiple DICOM Files: DICOM files only, one layer per slice in series
 *  order (#466). */
export async function loadFilesIntoStack(dicom = false) {
  const order = dicom ? dicomSeriesOrder : (items: { bytes: Uint8Array; name: string }[]) => items;
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sel = await open({ multiple: true, filters: dicom ? [{ name: "DICOM", extensions: DICOM_EXTENSIONS }] : OPEN_FILTERS });
      if (!sel) return;
      await stackImages(order(await readStackPaths(Array.isArray(sel) ? sel : [sel])));
    } catch (e) {
      console.error("Load Files into Stack failed:", e);
    }
    return;
  }
  const inp = document.createElement("input");
  inp.type = "file";
  inp.multiple = true;
  inp.accept = dicom ? DICOM_EXTENSIONS.map((ext) => `.${ext}`).join(",") : OPEN_ACCEPT;
  inp.onchange = async () => {
    const files = Array.from(inp.files ?? []);
    inp.remove();
    const items: { bytes: Uint8Array; name: string }[] = [];
    let retainedBytes = 0;
    for (const file of files) {
      try {
        const limit = imageReadLimit(file.name, "stack");
        assertReadableFileSize(file.size, limit.maxBytes, limit.label);
        const nextRetainedBytes = nextImageStackReadTotal(retainedBytes, file.size);
        items.push({ bytes: await readBrowserImageFile(file, "stack"), name: file.name });
        retainedBytes = nextRetainedBytes;
      } catch (e) {
        reportOpen(file.name, e);
      }
    }
    await stackImages(order(items));
  };
  inp.oncancel = () => inp.remove();
  document.body.appendChild(inp);
  inp.click();
}

/** File ▸ Scripts ▸ Load Multiple DICOM Files. */
export const loadMultipleDicomFiles = () => loadFilesIntoStack(true);

/** Load Multiple DICOM Files from native paths (MCP); returns how many slices
 *  became layers. */
export async function loadDicomPaths(paths: string[]): Promise<number> {
  // Not the files read: a slice the engine refused is no layer.
  return stackImages(dicomSeriesOrder(await readStackPaths(paths)));
}

// Seek a <video> to time t and resolve once the frame is ready.
function seekVideo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener("seeked", done); resolve(); };
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

/** File ▸ Import ▸ Video Frames to Layers: decode a video with the webview's own
 *  codecs (an off-DOM <video> + canvas — no extra deps), sample evenly-spaced
 *  frames, and stack them as layers in one new document (a frame flipbook). */
export async function importVideoFramesToLayers() {
  const file = await new Promise<File | null>((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "video/*";
    inp.onchange = () => { resolve(inp.files?.[0] ?? null); inp.remove(); };
    inp.oncancel = () => { inp.remove(); resolve(null); };
    document.body.appendChild(inp);
    inp.click();
  });
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("could not decode this video (unsupported codec)"));
    });
    const w = video.videoWidth, h = video.videoHeight, dur = video.duration;
    if (!w || !h || !isFinite(dur) || dur <= 0) throw new Error("unsupported or empty video");
    const count = Math.max(1, Math.min(48, Math.floor(dur * 8))); // ~8 fps, capped at 48 frames
    const step = dur / count;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const cx = canvas.getContext("2d")!;
    const items: { bytes: Uint8Array; name: string }[] = [];
    for (let i = 0; i < count; i++) {
      await seekVideo(video, Math.min(dur - 0.001, i * step));
      cx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (blob) items.push({ bytes: new Uint8Array(await blob.arrayBuffer()), name: `Frame ${i + 1}` });
    }
    await stackImages(items);
  } catch (e) {
    reportOpen(file.name, e);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Image ▸ Analysis ▸ Place Scale Marker: draw a calibrated scale bar (a black
 *  bar `lengthUnits` long at the current measurement scale) near the bottom-left
 *  on its own layer, with an optional caption as a text layer above it. */
export function placeScaleMarker(lengthUnits: number, caption: string) {
  const s = store.state.measureScale;
  const lengthPx = Math.max(1, Math.round((lengthUnits / s.units) * s.px));
  const docH = store.state.doc.height;
  const x = 24, barH = 5, y = Math.max(barH + 2, docH - 28);
  store.addLayer();
  const id = store.state.activeLayerId;
  E().set_layer_name(id, "Scale Marker");
  E().select_rect(x, y, lengthPx, barH, 0);
  E().fill_selection(0, 0, 0, 255);
  E().select_none();
  engine.commit();
  if (caption.trim()) {
    text.create(defaultSpec(caption.trim(), { ax: x, ay: Math.max(0, y - 24), size: 16, color: [0, 0, 0, 255] }));
  }
}

/** Edit ▸ Sky Replacement: create a masked gradient fill layer for the sky area.
 *  Without a selection, the engine floods an image-aware sky mask from the top
 *  edge and falls back to a horizon rectangle only when no sky-like pixels are
 *  found; with a selection, the user-supplied mask is used unchanged. */
export function skyReplacement(opts: SkyReplacementOptions): number {
  const e = E();
  const hadSelection = e.has_selection();
  const saved = hadSelection ? new Uint8Array(e.get_selection_mask()) : null;
  if (!hadSelection) {
    const horizon = opts.horizon ?? 0.45;
    const selected = typeof e.select_sky === "function" ? e.select_sky(horizon, opts.tolerance ?? 0.35) : false;
    if (!selected) {
      const h = Math.max(1, Math.min(store.state.doc.height, Math.round(store.state.doc.height * horizon)));
      e.select_rect(0, 0, store.state.doc.width, h, 0);
    }
  }
  const { width, height } = store.state.doc;
  const edge = skyEdgePixels(width, height, opts.shiftEdge, opts.fadeEdge);
  if (edge.shift > 0) e.expand_selection(edge.shift);
  else if (edge.shift < 0) e.contract_selection(-edge.shift);
  if (edge.fade > 0) e.feather_selection(edge.fade);
  const stops = skyGradientStops(opts);
  const [x0, y0, x1, y1] = skyGradientLine(height, opts.horizon, opts.scale);
  const replaceCurrent = opts.output === "currentLayer";
  let id = store.state.activeLayerId;
  if (!replaceCurrent) {
    id = e.add_layer("Sky Replacement");
  }
  e.gradient_fill(x0, y0, x1, y1, 0, false, stops, false, true, 0, 0, 1); // honour the sky stops' alpha; Classic ramp, Normal 100%
  if (!replaceCurrent && id) e.set_layer_name(id, "Sky Replacement");
  if (saved) e.set_selection_mask(saved);
  else e.select_none();
  engine.commit();
  return id;
}

/** Native multi-file open (Tauri). */
export async function openFileNative() {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: true, filters: OPEN_FILTERS });
    if (!sel) return;
    await openPaths(Array.isArray(sel) ? sel : [sel]);
  } catch (e) {
    console.error("Open dialog failed:", e);
  }
}

/** Read and open a list of native file paths as new document tabs (native open
 *  dialog + OS file-drop both funnel through here). A file that won't open is
 *  reported and skipped so the rest of the drop still lands; it is also
 *  returned, for callers (MCP) that must fail rather than look successful.
 *  Non-interactive callers receive errors without a file-error or Raw layout dialog. */
export async function openPaths(paths: string[], interactive = true) {
  const failed: { path: string; error: unknown }[] = [];
  try {
    for (const p of paths) {
      try {
        let bytes = await readNativeFileBounded(p, (prefix) => openFileReadLimit(p, prefix));
        if (/\.mvision$/i.test(p)) bytes = await resolveNativeProjectBytes(bytes, p);
        if (photoshopVersion(bytes) === null && RAW_RE.test(p)) {
          const sha256 = await cameraRawSha256(bytes);
          const originalName = p.replace(/^.*[\\/]/, "");
          const sessionId = await openCameraRaw(bytes, originalName, {
            originalPath: p,
            sha256,
            ...await readNativeRawSidecar(p, originalName, bytes, sha256),
          }, p, interactive);
          if (typeof sessionId === "string") await store.waitForCameraRawSession(sessionId);
          continue;
        }
        await routeOpen(bytes, p.replace(/^.*[\\/]/, ""), p, true, interactive);
      }
      catch (e) { failed.push({ path: p, error: e }); if (interactive) reportOpen(p, e); }
    }
  } catch (e) {
    console.error("Could not load the file-system plugin:", e);
    failed.push({ path: paths.join(", "), error: e });
  }
  return failed;
}

/** Open ONE native path, returning failures without interactive error dialogs. The
 *  MCP `doc.open` tool has no alert to show — a failed open has to come back as
 *  a tool error instead of a cheerful "Opened …" over the unchanged document. */
export async function openPath(path: string) {
  // No layout dialog either: it would answer "Opened …" over a modal (#466).
  const [failure] = await openPaths([path], false);
  if (failure) throw failure.error instanceof Error ? failure.error : new Error(String(failure.error));
}

/** Decode `bytes` to a fresh Engine. Photoshop's signature and then the
 * container manifest win before the extension, matching routeOpen; other
 * formats keep name-based dispatch. */
function buildForName(bytes: Uint8Array, name: string) {
  const photoshop32BitImport = store.state.filePrefs.photoshop32BitImport;
  if (photoshopVersion(bytes) !== null) return { engine: engine.buildFormat(bytes, photoshop32BitImport) };
  if (isContainer(bytes)) {
    const container = readContainer(bytes);
    const [metaEntry] = entriesByRole(container, VISION_DOCUMENT_ROLE);
    return {
      engine: engine.buildGraphics(bytes),
      document: metaEntry ? decodeDocumentMetaBytes(metaEntry.data) : undefined,
    };
  }
  if (RAW_RE.test(name)) return { engine: engine.buildRaw(bytes) };
  if (hasPhotoshopExtension(name) || /\.xcf$/i.test(name)) return { engine: engine.buildFormat(bytes, photoshop32BitImport) };
  if (/\.mvision$/i.test(name)) {
    const envelope = decodeProjectEnvelope(bytes);
    return { engine: engine.buildProject(envelope?.engineBytes ?? bytes), document: envelope?.document };
  }
  if (ARTISAN_RE.test(name)) return { engine: store.buildArtisan(bytes) };
  return { engine: engine.buildImage(bytes) };
}

/** File ▸ Revert: reload the active document from its file on disk. The
 *  pre-revert pixels stay one Undo away. A document that has never been saved
 *  has nothing to revert to — the menu greys the command out in that case. */
export const revertDocument = recordedCall("revertDocument", async () => {
  const path = store.activePath();
  if (!path) return;
  // Pin the document before the awaits, like every save path does: revertActiveDoc
  // targets whatever is active when it runs, so a tab switch during the read would
  // replace the OTHER document's engine — wiping its history, clearing its dirty
  // flag, dropping its recovery snapshot and re-pinning this path onto it. (#55)
  const docId = store.state.activeDocId;
  // Undo can put the pixels back when the capture succeeds. When it cannot
  // (a document too large to serialize), a dirty document asks first.
  const undoable = store.captureRevertUndo();
  if (!undoable && store.docDirty(docId) && typeof confirm === "function" && !confirm(
    "Revert to the last saved version? This cannot be undone.",
  )) {
    store.discardRevertUndo(docId);
    return;
  }
  try {
    if (RAW_RE.test(path) && store.revertActiveCameraRawSource()) return;
    await monetFormatReady; // buildForName sniffs for a container
    const workingProfile = store.state.colorProfile;
    const bytes = await readNativeFileBounded(path, (prefix) => openFileReadLimit(path, prefix));
    if (store.state.activeDocId !== docId) { // (#55) switched away mid-read
      store.discardRevertUndo(docId);
      notify("Revert was cancelled — you switched documents while the file was being read.");
      return;
    }
    // Open resolves relative smart links before the engine is built. Revert
    // has to do the same, or an in-session relink survives the reload.
    const projectBytes = /\.mvision$/i.test(path) ? await resolveNativeProjectBytes(bytes, path) : bytes;
    const raw = photoshopRawLayouts.get(docId);
    const doc = raw?.path === path ? { engine: engine.buildPhotoshopRaw(projectBytes, raw.layout), document: undefined } : buildForName(projectBytes, path);
    store.revertActiveDoc(doc.engine, doc.document);
    if (/\.mvision$/i.test(path)) store.adoptProjectEnvelope(docId, projectBytes);
    if (!doc.document) store.captureImageMetadata(projectBytes, docId);
    // Re-take the courier cargo from the bytes on disk: the file may have been
    // saved by another app since this document was opened.
    if (isContainer(projectBytes)) containerCargo.set(store.state.activeDocId, readContainer(projectBytes));
    if (usesPhotoshopRgbProfilePolicy(projectBytes)) {
      applyOpenedImageProfilePolicy(projectBytes, path.replace(/^.*[\\/]/, ""), workingProfile);
    }
    store.setActivePath(path); // re-pin the path (revert cleared dirty already; #55 proved it is still `docId`)
  } catch (e) {
    store.discardRevertUndo(docId);
    reportOpen(path, e);
  }
});

/** A script path (`/tmp/x.png`, `C:\\out.jpg`) rather than an Export As base name. */
function isScriptSavePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.[A-Za-z0-9]+$/.test(value);
}

/** `vision.saveAs(path)` — write the document to a path. No dialog. */
async function saveAsPath(path: string): Promise<boolean> {
  return writeScriptPath(path, false);
}

/** `vision.exportAs(path, quality?)` — write a flat file to a path. No dialog. */
async function exportAsPath(path: string, quality?: number): Promise<boolean> {
  return writeScriptPath(path, true, quality);
}

async function writeScriptPath(path: string, asExport: boolean, quality = 92): Promise<boolean> {
  if (!path || typeof path !== "string") {
    reportSave("A destination path is required.");
    return false;
  }
  try {
    const ext = extOf(path) || "png";
    const docId = store.state.activeDocId;
    const contentRevision = store.docContentRevision(docId);
    const { bytes } = await documentSaveIo.bytesForExt(ext, {
      docId,
      quality: Math.max(1, Math.min(100, Math.round(quality))),
    });
    assertPayloadReopenable(ext, bytes);
    await atomicWriteBytes(path, bytes);
    if (!asExport && contentRevision !== null && isProjectSaveExtension(ext)) {
      store.setDocPathAfterSave(docId, path, contentRevision);
    }
    return true;
  } catch (e) {
    reportSave(friendlySaveError(e));
    return false;
  }
}

/** Save the active document. In-place to its remembered path when possible
 *  (native), else falls back to Save As / a browser download. Recorded as an
 *  action step (Photoshop records Save); replay re-runs the live save flow. */
export const saveDocument = recordedCall("saveDocument", () => documentSaveEvent(async (): Promise<boolean> => {
  if (smart.saveEditedContents()) return true;
  // Before the document is pinned: a `.mvis` save writes through the container
  // writer, and everything from here to the export must stay await-free.
  await monetFormatReady;
  const docId = store.state.activeDocId;
  const contentRevision = store.docContentRevision(docId);
  if (contentRevision === null) return false;
  const path = store.activePath();
  const ext = path ? extOf(path) : "";
  // A layered document never silently flattens into its flat source file —
  // route to Save As (defaulting to the lossless project format) instead.
  const native = isTauri();
  if (path && canSaveInPlace(native, path, isProjectSaveExtension(ext) || docFitsFlat(ext))) {
    try {
      // Export BEFORE the awaits, and mark exactly this document saved after.
      const { bytes } = await documentSaveIo.bytesForExt(ext, { docId });
      assertPayloadReopenable(ext, bytes);
      await atomicWriteBytes(path, bytes);
      store.markDocSavedAtRevision(docId, contentRevision);
    } catch (e) { reportSave(friendlySaveError(e)); return false; }
    return true;
  }
  // No remembered path, a non-round-trippable format, or the browser build →
  // prompt for a destination (or download). Unwrapped impl: this fallback runs
  // after awaits (past the depth guard) and must not record a second step.
  return saveDocumentAsImpl();
}));

/** Save the active document to a newly chosen path/format.
 *
 *  `asCopy` is File ▸ Save a Copy…: write the bytes but keep the open document
 *  pointed at its ORIGINAL path and keep its dirty state. Without it Save a Copy
 *  ran the full Save As flow, so the tab silently re-targeted to the copy — every
 *  later ⌘S wrote the copy, the original stopped receiving the work, and the tab
 *  claimed everything was saved. (#237) */
async function saveDocumentAsImpl(asCopy = false): Promise<boolean> {
  await monetFormatReady; // before the document is pinned (see saveDocument)
  const docId = store.state.activeDocId;
  const contentRevision = store.docContentRevision(docId);
  if (contentRevision === null) return false;
  // Everything from here on can throw — reading the engine included — and a
  // Save As that reports nothing looks like a menu item that does nothing.
  let eng: typeof engine.e;
  let flat: boolean;
  let suggested: string;
  try {
    eng = engine.e; // pin the document across the dialog await
    const activeExt = extOf(store.activeName() ?? "");
    flat = activeExt ? docFitsFlat(activeExt) : false;
    suggested = suggestedSaveName(store.activeName(), flat);
  } catch (e) { reportSave(e); return false; }
  if (isTauri()) {
    if (_unattended) {
      reportSave("Save As needs a file dialog, and a command-line job cannot show one.");
      return false;
    }
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const target = await save({ defaultPath: suggested, filters: SAVE_FILTERS });
      if (!target) return false; // cancelled: nothing was written
      const ext = extOf(target) || "mvision";
      const fitsTarget = docFitsFlat(ext);
      if ((ext === "psd" || ext === "psb") && typeof confirm === "function" && !confirm(
        `Vision's current ${ext.toUpperCase()} exporter cannot preserve every editable layer feature.\n\nOK exports a ${ext.toUpperCase()} copy and keeps this document unsaved. Cancel returns without writing.`,
      )) return false;
      const tiffLayers = (ext === "tif" || ext === "tiff") && !fitsTarget && tiffLayersPicker
        ? await new Promise<boolean | null>((resolve) => tiffLayersPicker?.(resolve))
        : false;
      if (tiffLayers === null) return false; // TIFF Options cancelled: nothing was written
      const formatOptions = await askSaveFormatOptions(ext);
      if (!formatOptions) return false; // JPEG 2000 / Photoshop Raw Options cancelled
      const { bytes } = await documentSaveIo.bytesForExt(ext, { eng, docId, tiffLayers, ...formatOptions });
      assertPayloadReopenable(ext, bytes);
      const rawLayout: PhotoshopRawLayout | null = ext === "raw" ? {
        width: eng.width(), height: eng.height(), channels: eng.doc_mode() === 1 ? 1 : 3,
        depth: eng.doc_depth() === 8 ? 8 : 16,
        ...(formatOptions.photoshopRaw ?? DEFAULT_PHOTOSHOP_RAW_SAVE),
      } : null;
      await atomicWriteBytes(target, bytes);
      // Export copies keep the document's identity and dirty state until a
      // lossless project save succeeds. Save a Copy always behaves that way,
      // whatever format was chosen. (#237)
      if (asCopy || saveAsIsCopy(ext, fitsTarget)) return true;
      store.setDocPathAfterSave(docId, target, contentRevision);
      if (rawLayout) photoshopRawLayouts.set(docId, { path: target, layout: rawLayout });
    } catch (e) { reportSave(friendlySaveError(e)); return false; }
    return true;
  }
  // Browser fallback: download under the suggested name.
  const name = /\.[^.\\/]+$/.test(suggested) ? suggested : `${suggested}.mvision`;
  const ext = extOf(name) || "mvision";
  // TGA/PDF encode asynchronously, so resolve the bytes before the (synchronous)
  // download transaction — a failed encode must never mark the document saved.
  const formatOptions = await askSaveFormatOptions(ext);
  if (!formatOptions) return false; // JPEG 2000 / Photoshop Raw Options cancelled
  let file: { bytes: Uint8Array; mime: string };
  try {
    file = await documentSaveIo.bytesForExt(ext, { eng, docId, ...formatOptions });
    assertPayloadReopenable(ext, file.bytes);
  }
  catch (e) { reportSave(friendlySaveError(e)); return false; }
  const fitsDownload = docFitsFlat(ext);
  return runBrowserSave({
    exportFile: () => file,
    download: ({ bytes, mime }) => { assertHistorySettled(eng); downloadBytes(name, bytes, mime); },
    markSaved: () => store.markDocSavedAtRevision(docId, contentRevision),
    reportError: reportSave,
    shouldMarkSaved: !asCopy && !saveAsIsCopy(ext, fitsDownload),
  });
}
export const saveDocumentAs = recordedCall("saveDocumentAs", () => documentSaveEvent(() => saveDocumentAsImpl(false)));
/** File ▸ Save a Copy… — writes a copy without re-targeting the open document. */
export const saveDocumentAsCopy = recordedCall("saveDocumentAsCopy", () => documentSaveEvent(() => saveDocumentAsImpl(true)));

// ── Preferences ▸ File Handling ▸ auto-save recovery information ──────────────
// A dirty document is written as `.mvision` project bytes into the app-data
// recovery folder every N minutes; a save or close deletes its snapshot, so
// anything still there at launch is what an unexpected exit left behind.

/** Live snapshots: doc id → the revision written and the file holding it. */
const recoverySnapshots = new Map<number, { revision: number; file: string }>();
/** One visible warning per document. The timer must not toast on every tick. */
const recoveryWarned = new Set<number>();
let recoveryTimer: ReturnType<typeof setInterval> | null = null;
const documentRecoveryEnabled = () => isTauri()
  && !import.meta.env.DEV
  && import.meta.env.TAURI_ENV_DEBUG !== "true";

async function recoveryFolder(): Promise<string> {
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  return join(await appDataDir(), RECOVERY_DIR);
}

async function removeRecoveryFile(dir: string, file: string) {
  const fs = await import("@tauri-apps/plugin-fs");
  try { await fs.remove(`${dir}/${file}`); } catch { /* already gone */ }
}

/** One timer tick: snapshot every dirty document whose content moved since its
 *  last snapshot, and drop the snapshots of documents that were saved or
 *  closed. A failed snapshot is logged and shown once per document. */
export async function writeRecoverySnapshots(): Promise<number> {
  if (!documentRecoveryEnabled()) return 0;
  const docs = store.state.documents.map((d) => ({
    id: d.id,
    dirty: d.dirty,
    contentRevision: store.docContentRevision(d.id) ?? 0,
  }));
  const plan = planRecovery(docs, recoverySnapshots);
  if (!plan.write.length && !plan.drop.length) return 0;
  let written = 0;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const dir = await recoveryFolder();
    try { await fs.mkdir(dir, { recursive: true }); } catch { /* already exists */ }
    for (const id of plan.drop) {
      const prior = recoverySnapshots.get(id);
      recoverySnapshots.delete(id);
      if (prior) await removeRecoveryFile(dir, prior.file);
    }
    for (const id of plan.write) {
      // Per document: one unserializable tab must not cost every other tab its
      // recovery snapshot.
      try {
        const revision = store.docContentRevision(id);
        if (revision === null) continue;
        // Serialize BEFORE the write awaits, like every other save path, so a
        // concurrent edit cannot be mistaken for the snapshotted revision. The
        // snapshot serializes the document as-is: a live paint-symmetry draft is
        // tool state, and this timer runs behind the user. (#57)
        const bytes = projectBytesForDoc(id, { commitTransientEdits: false });
        const file = recoveryFileName(id, store.docName(id) ?? `document-${id}`);
        const prior = recoverySnapshots.get(id);
        await atomicWriteBytes(`${dir}/${file}`, bytes);
        recoverySnapshots.set(id, { revision, file });
        recoveryWarned.delete(id);
        // A Save As renamed the tab: the snapshot under the old name is stale.
        if (prior && prior.file !== file) await removeRecoveryFile(dir, prior.file);
        written++;
      } catch (e) {
        console.warn(`[recovery] snapshot failed for document ${id}:`, e);
        if (!recoveryWarned.has(id)) {
          recoveryWarned.add(id);
          const name = store.docName(id) ?? "this document";
          const detail = e instanceof Error ? e.message : String(e);
          notify(`Could not save a recovery copy of “${name}”. ${detail}`);
        }
      }
    }
  } catch (e) {
    console.warn("[recovery] snapshot failed:", e);
  }
  return written;
}

/** In-flight snapshot deletes. Quit awaits them so the process cannot exit first. */
let recoveryDrops: Promise<void> = Promise.resolve();

/** Drop one document's snapshot as soon as its changes reach disk. */
function dropRecoverySnapshot(id: number) {
  const prior = recoverySnapshots.get(id);
  if (!prior || !documentRecoveryEnabled()) return;
  recoverySnapshots.delete(id);
  const job = recoveryFolder()
    .then((dir) => removeRecoveryFile(dir, prior.file))
    .then(() => undefined, () => { /* best effort */ });
  recoveryDrops = recoveryDrops.then(() => job);
}

async function flushRecoveryDrops() {
  await recoveryDrops;
}
store.onDocSaved = dropRecoverySnapshot;

/** Launch-time crash recovery: offer to reopen whatever the recovery timer left
 *  behind. Restored snapshots stay until that document is saved or discarded.
 *  Declining the prompt is the discard. A recovered document deliberately
 *  keeps NO saved path — Save routes to Save As, so recovered work can never
 *  silently overwrite the original file it came from. A second process of a
 *  live session (`?recoveryBlocked=1`) neither offers nor deletes anything. */
export async function recoverLastSession(): Promise<number> {
  if (!documentRecoveryEnabled()) return 0;
  if (recoveryLaunchBlocked(typeof location === "undefined" ? "" : location.search)) return 0;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const dir = await recoveryFolder();
    if (!await fs.exists(dir)) return 0;
    const found = (await fs.readDir(dir))
      .filter((entry) => entry.isFile !== false)
      .map((entry) => ({ file: entry.name, parsed: parseRecoveryFileName(entry.name) }))
      .filter((entry): entry is { file: string; parsed: { docId: number; name: string } } => entry.parsed !== null);
    if (!found.length) return 0;
    const { ask } = await import("@tauri-apps/plugin-dialog");
    const restore = await ask(
      `Monet Vision found ${found.length} unsaved document${found.length === 1 ? "" : "s"} from a session that ended unexpectedly:\n\n`
      + found.map((entry) => `• ${entry.parsed.name}`).join("\n")
      + "\n\nRecover them?",
      { title: "Recover Documents", kind: "warning" },
    );
    return restoreRecoveryFiles(
      found.map((entry) => ({ file: `${dir}/${entry.file}`, name: entry.parsed.name })),
      restore,
      {
        read: async (path) => {
          await monetFormatReady; // the recovered project may carry a container
          const file = path.slice(path.lastIndexOf("/") + 1);
          return resolveNativeProjectBytes(
            await readNativeFileBounded(path, (prefix) => openFileReadLimit(file, prefix)),
            path,
          );
        },
        open: (bytes, name, file) => {
          store.openProject(bytes, name);
          const id = store.state.activeDocId;
          store.markDocDirty(id); // still unsaved, by definition
          // Keep the snapshot bound to the new tab until save or discard (#549).
          const base = file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1);
          recoverySnapshots.set(id, { revision: store.docContentRevision(id) ?? 0, file: base });
        },
        remove: async (path) => removeRecoveryFile(dir, path.slice(path.lastIndexOf("/") + 1)),
        report: reportOpen, // keep unreadable files so the user can retry next launch
      },
    );
  } catch (e) {
    console.warn("[recovery] scan failed:", e);
    return 0;
  }
}

/** (Re)start the recovery timer for the current preference. */
export function startAutoRecover() {
  if (recoveryTimer) { clearInterval(recoveryTimer); recoveryTimer = null; }
  const minutes = store.state.autoRecoverMinutes;
  if (!documentRecoveryEnabled() || minutes <= 0) return;
  recoveryTimer = setInterval(() => { void writeRecoverySnapshots(); }, minutes * 60_000);
}
store.onAutoRecoverChange = startAutoRecover;
// Prompt for last session's leftovers before the timer can overwrite them.
// A command-line job's hidden window does neither: nobody is there to answer the
// prompt, and the leftovers belong to the next launch of the GUI.
if (documentRecoveryEnabled() && !isCliBoot()) void recoverLastSession().then(startAutoRecover, startAutoRecover);

/** File ▸ Package: save a portable project plus every linked Smart Object source. */
export async function packageDocument(): Promise<string | null> {
  if (!isTauri()) {
    reportPackage(new Error("Package is available in the desktop app."));
    return null;
  }
  const docId = store.state.activeDocId;
  try {
    if (!store.activePath() || store.docDirty(docId)) await saveDocument();
    if (store.state.activeDocId !== docId || !store.activePath() || store.docDirty(docId)) return null;

    const plan = planPackageLinks(smart.linkedObjects(docId));
    const envelope = decodeProjectEnvelope(projectBytesForDoc(docId));
    if (!envelope) throw new Error("The linked document could not be serialized.");
    const projectBytes = encodeProjectEnvelope(envelope.engineBytes, plan.links, envelope.document, envelope.smartEditSources);
    const [{ open }, fs, pathApi] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
      import("@tauri-apps/api/path"),
    ]);
    for (const copy of plan.copies) {
      if (!await fs.exists(copy.sourcePath)) throw new Error(`Linked source “${copy.sourcePath}” is missing.`);
    }
    const selected = await open({ directory: true, multiple: false, title: "Choose Package Location" });
    const destination = Array.isArray(selected) ? selected[0] : selected;
    if (!destination) return null;

    const sourceName = await pathApi.basename(store.activePath()!);
    const stem = sourceName.replace(/\.[^.]+$/, "") || "Document";
    let packagePath = await pathApi.join(destination, `${stem} Package`);
    for (let n = 2; await fs.exists(packagePath); n++) {
      packagePath = await pathApi.join(destination, `${stem} Package ${n}`);
    }

    await writePackageFiles(
      fs,
      pathApi.join,
      packagePath,
      `${stem}.mvision`,
      plan,
      projectBytes,
      (error) => console.warn("Could not remove incomplete package:", error),
    );
    return packagePath;
  } catch (e) {
    reportPackage(e);
    return null;
  }
}

/** Window ▸ Arrange ▸ Cascade: every document floats into a window of its own
 *  (native/FloatWindows opens new ones down the diagonal already), and those
 *  already out line up there too. Desktop only. */
export async function cascadeFloats(): Promise<void> {
  store.floatAllDocs();
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("plugin:float|cascade", { docs: store.state.floatDocs });
}

/** Confirm discarding unsaved changes before closing a document. */
/** Quit / window-close guard.
 *
 *  Closing a document TAB prompts to save, but quitting the app or closing the
 *  window did not — every unsaved document went silently. Tauri fires
 *  `onCloseRequested` for both the red button and ⌘Q, so one handler covers both;
 *  preventing the event and destroying the window explicitly is the documented way
 *  to gate a close. (#54) */
export async function installUnsavedWorkGuard(): Promise<void> {
  if (!isTauri() || isCliBoot()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.onCloseRequested(async (event) => {
      const dirty = store.dirtyDocNames();
      if (dirty.length === 0) return; // nothing unsaved: let the close proceed
      event.preventDefault();
      if (await resolveDirtyWorkspace("close")) await win.destroy();
    });
    await installQuitGuard(async () => resolveDirtyWorkspace("quit"));
  } catch (e) {
    // A webview without the window API must not block startup; the tab-level
    // prompt still applies there.
    console.warn("unsaved-work guard unavailable", e);
  }
}

export type UnsavedAction = "save" | "discard" | "cancel";

export const UNSAVED_SAVE = "Save";
export const UNSAVED_DISCARD = "Don't Save";
export const UNSAVED_CANCEL = "Cancel";

/** The close / quit question. The buttons are Save, Don't Save and Cancel. */
export function unsavedActionMessage(names: string[], verb: "close" | "quit"): string {
  const action = verb === "close" ? "closing" : "quitting";
  if (names.length === 1) return `Save changes to “${names[0]}” before ${action}?`;
  const shown = names.slice(0, 3).map((n) => `“${n}”`).join(", ");
  return `Save changes to ${names.length} documents (${shown}${names.length > 3 ? ", …" : ""}) before ${action}?`;
}

export function unsavedActionFromDialog(result: unknown): UnsavedAction {
  if (result === UNSAVED_SAVE) return "save";
  if (result === UNSAVED_DISCARD) return "discard";
  return "cancel";
}

/** Save, Don't Save, or Cancel for Close, Close All and Quit (#554). */
export async function chooseUnsavedAction(names: string[], verb: "close" | "quit"): Promise<UnsavedAction> {
  if (_unattended) return "discard";
  if (!names.length) return "discard";
  const msg = unsavedActionMessage(names, verb);
  if (isTauri()) {
    try {
      const { message } = await import("@tauri-apps/plugin-dialog");
      const result = await message(msg, {
        title: "Unsaved Changes",
        kind: "warning",
        buttons: { yes: UNSAVED_SAVE, no: UNSAVED_DISCARD, cancel: UNSAVED_CANCEL },
      });
      return unsavedActionFromDialog(result);
    } catch { /* fall through to web confirm */ }
  }
  if (typeof confirm !== "function") return "cancel";
  if (confirm(`${msg}\n\nChoose OK to save.`)) return "save";
  const discardMsg = verb === "quit" ? "Quit without saving?" : "Close without saving?";
  return confirm(discardMsg) ? "discard" : "cancel";
}

/** Save every dirty document. A cancelled or failed save aborts the close. */
async function saveDirtyDocuments(): Promise<boolean> {
  const ids = store.state.documents.filter((d) => store.docDirty(d.id)).map((d) => d.id);
  for (const id of ids) {
    if (!store.docDirty(id)) continue;
    if (!await saveDocumentForClose(id)) return false;
  }
  return true;
}

async function saveDocumentForClose(id: number): Promise<boolean> {
  try {
    if (store.state.activeDocId !== id) store.activateDoc(id);
    return await saveDocument();
  } catch (e) {
    reportSave(e);
    return false;
  }
}

/** Drop the recovery snapshots of documents the user chose not to keep. */
async function discardRecoveryFor(ids: readonly number[]) {
  for (const id of ids) dropRecoverySnapshot(id);
  await flushRecoveryDrops();
}

async function releaseRecoveryLock() {
  if (!documentRecoveryEnabled()) return;
  try {
    const dir = await recoveryFolder();
    await removeRecoveryFile(dir, "session.lock");
  } catch { /* the next launch treats a dead owner as a crash */ }
}

/** Quit or close the window: Save writes every dirty document first, Don't
 *  Save deletes their recovery snapshots, Cancel leaves the app open. */
async function resolveDirtyWorkspace(verb: "close" | "quit"): Promise<boolean> {
  const dirty = store.dirtyDocNames();
  if (!dirty.length) return true;
  const choice = await chooseUnsavedAction(dirty, verb);
  if (choice === "cancel") return false;
  const ids = store.state.documents.filter((d) => store.docDirty(d.id)).map((d) => d.id);
  if (choice === "save") {
    if (!await saveDirtyDocuments()) return false;
    await flushRecoveryDrops();
  } else {
    await discardRecoveryFor(ids);
  }
  await releaseRecoveryLock();
  return true;
}

/** Confirm discarding every unsaved document at once (quit / window close).
 *  True only for Don't Save. Save and Cancel are not a discard. */
export async function confirmDiscardAll(names: string[]): Promise<boolean> {
  if (_unattended) return true;
  return (await chooseUnsavedAction(names, "quit")) === "discard";
}

export async function confirmDiscard(name: string): Promise<boolean> {
  if (_unattended) return true;
  return (await chooseUnsavedAction([name], "close")) === "discard";
}

async function confirmSaveEditedContents(name: string): Promise<"save" | "discard" | "cancel"> {
  if (_unattended) return "save";
  const saveMsg = `Save changes to “${name}” and update the parent Smart Object?`;
  const discardMsg = `Close “${name}” without updating its parent Smart Object?`;
  let shouldSave = true;
  if (isTauri()) {
    try {
      const { ask } = await import("@tauri-apps/plugin-dialog");
      shouldSave = await ask(saveMsg, { title: "Close Smart Object Contents", kind: "warning" });
      if (shouldSave) return "save";
      return await ask(discardMsg, { title: "Close Smart Object Contents", kind: "warning" }) ? "discard" : "cancel";
    } catch { /* fall through to web confirm */ }
  }
  shouldSave = typeof confirm === "function" ? confirm(saveMsg) : true;
  if (shouldSave) return "save";
  const discard = typeof confirm === "function" ? confirm(discardMsg) : true;
  return discard ? "discard" : "cancel";
}

/** Close a document tab through the UI policy layer. Edited Smart Object source
 *  tabs get a Photoshop-style save-to-parent route before falling back to
 *  discard/cancel; ordinary dirty documents keep the existing discard prompt. */
export async function closeDocumentTab(id: number, discard = false): Promise<boolean> {
  const doc = store.state.documents.find((d) => d.id === id);
  if (!doc) return false;
  // Ask the store, not the published summary: it is the authority on unsaved
  // work, and a metadata-only edit reaches it first. `discard` is for a
  // document Batch opened and has written out: it holds nothing to lose.
  const dirty = !discard && store.docDirty(id);
  const binding = smart.editedContentsBindingForDoc(id);
  if (binding && dirty) {
    const decision = await confirmSaveEditedContents(doc.name);
    if (decision === "cancel") return false;
    if (decision === "save" && !smart.saveEditedContentsDoc(id)) return false;
  } else if (dirty) {
    const choice = await chooseUnsavedAction([doc.name], "close");
    if (choice === "cancel") return false;
    if (choice === "save") {
      if (!await saveDocumentForClose(id)) return false;
      await flushRecoveryDrops();
    } else {
      dropRecoverySnapshot(id);
      await flushRecoveryDrops();
    }
  }
  smart.forgetEditedContentsDoc(id);
  store.closeDoc(id);
  containerCargo.delete(id);
  photoshopRawLayouts.delete(id);
  return true;
}

/** The active document's `.mvision` project bytes (e2e / scripting hook). */
export function saveProjectBytes(docId = store.state.activeDocId): Uint8Array {
  return projectBytesForDoc(docId);
}
