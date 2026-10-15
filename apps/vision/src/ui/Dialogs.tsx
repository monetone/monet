import { SCRIPT_EVENTS, SCRIPT_EVENTS_KEY, loadScriptEventStore, serializeScriptEventStore, type ScriptEventId, type ScriptEventBinding, type ScriptEventStore } from "../state/scriptEvents";
export { SCRIPT_EVENTS, runScriptEventBindings, type ScriptEventId, type ScriptEventBinding } from "../state/scriptEvents";
// ─────────────────────────────────────────────────────────────
// Dialogs — adjustment & filter dialogs with live preview, plus the
// document dialogs (New / Image Size / Canvas Size). A dialog applies
// its op through the engine; re-previewing undoes the prior apply so
// the net history is a single step. Cancel reverts.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type CSSProperties, type Ref, type PointerEvent as ReactPointerEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  Dialog, Button, Slider, NumberField, Checkbox, Input, Textarea, CurveEditor, Histogram, Select, SegmentedControl, OptionsBar, Icon, I, BLEND_MODES, GlyphGrid, useToast,
  Radio, RadioGroup, type CurvePoint,
} from "@monet-ui/monet-react";
import { engine, store, useStore, commandPalette, adj, fil, smart, xform, neural, distort, runScript, ml, models, text, typeEditorSelection, openFiles, openImageFiles, openPdfPage, registerPdfPagePicker, registerTiffLayersPicker, registerSaveOptionsPicker, registerPhotoshopRawPicker, closeDocumentTab, placeScaleMarker, exportVideo, anim, actions, batchProcess, dropletRun, saveDropletFile, type BatchFormat, type BatchSource, type HistoryTransactionEngine, skyReplacement, imageProcessor, type ImageProcessorSave, dataVars, contentAwareFill, contentAwareFillWith, removeDistractions, removeReflections, splitReflections, saveForWeb, warpLayer, previewGalleryStack, revertGalleryStack, commitGalleryStack, runBlurSteps as runBlurStepsCommand, commitBlurSteps as commitBlurStepsCommand, exportColorTableAct, colorTableHexes, loadColorTableAct, exportAs, exportSelectedLayersAs, selectedLayerExportTargets, exportAsMetadataChoice, rememberExportAsMetadata, contentCredentialsSigner, pickPemFile, importContentCredentialsSigner, clearContentCredentialsSigner, importProofProfileFile, importDocumentIccProfile, pickColorLutFile, preparePrintJob, spoolPrintJob, pngToImageData, exportIccBytes, saveProofSetupFile, loadProofSetupFile, saveBytes, downloadBytes, pickLocalFileBytes, webExportBytes, optimizeWebExportToFileSize, loadPresetSetFile, savePresetSet, exportAllPresets, importPresetFiles, type SaveForWebOptions, type SignerInfo, type ExportAsFormat, type LayerExportTarget, type PdfPageRequest } from "../state/app";
import { PRESET_CATEGORIES, type PresetCategory } from "../state/presetManager";
import { createDefaultRecipe, type LensCorrectionSettings } from "@monet-ui/monet-photo";
import { applyLensProfileCorrection } from "../state/app";
import { LensProfileControls } from "./dialogs/LensProfileControls";
import {
  PRINT_MEDIA, PRINT_SCALE_MAX, PRINT_SCALE_MIN, decodeProfileIcc, encodeProfileIcc, loadPrintSettings, printLayout,
  printLayoutClips, printPreviewPixels, printSettingsError, savePrintSettings, type PrintSettings,
} from "../state/printSettings";
import { CustomizeToolbar } from "./CustomizeToolbar";
import {
  DOWNLOAD_SPEEDS, SAVE_FOR_WEB_FORMATS, formatByteSize, formatDownloadTime, isPersistedWebFormat,
  saveForWebFilename, webQualityApplies, type SaveForWebFormat, type SaveForWebMetadata,
} from "../state/webExportEstimate";
import { defaultPin, hitTestPins, ringDrag, type BlurPin, type PinKind } from "./blurPins";
import { STAT_MODES, statModeLabel, statModeReady } from "./stackModes";
import {
  defaultBlurPath, flattenBlurPaths, hitTestBlurPaths, samplePath, type BlurPathStroke,
} from "./blurPathStrokes";
import {
  BLUR_TOOLS, BLUR_TOOL_FOR_DIALOG, GALLERY_PINS_FID, PATH_TOOL, SPIN_PINS_FID,
  blurGallerySteps, defaultBlurGalleryState, pinnedBlurSmartFilter, pinnedBlurState,
  type BlurGalleryState, type BlurTool, type GalleryPin, type PinnedBlurEditRequest,
} from "./blurGallery";
import { MODEL_REGISTRY, modelBytes, prettyBytes, type ModelDef } from "../ml/modelRegistry";
import type { FaceLiquifyParams, MlPreviewResult, MlProgress } from "../ml/onnx";
import { beginMlJob, cancelMlJob, isMlCancel } from "../ml/mlJob";
import { modelDownloadReady, modelLocalImportReady } from "../ml/modelDownload";
import type { ModelStatus } from "../ml/modelSource";
import {
  GALLERY_CATEGORIES, filtersInCategory, filterDef, addEffect, duplicateEffect, removeEffect,
  toggleEffect, moveEffect, setEffectValues, composeOrder, type GalleryEffect, type GalleryCategory,
} from "../state/filterGallery";
import { clampZoom, fitZoom } from "../state/zoomPresets";
import { rankFontMatches } from "../state/matchFont";
import { readContentCredentials, VERIFY_URL, type CredentialSummary } from "../state/contentCredentials";
import { SAM_DEFAULTS, SAM_OUTPUTS, SAM_VIEW_MODES, normalizeSamSettings, renderSamView, stampSamBrush, type SamOutput, type SamParams, type SamSettings, type SamViewMode } from "../state/selectAndMask";
import { samplingPreset, tintSamplingOverlay, type SamplingMode } from "../state/contentAwareFill";
import { fontPreviewOptionStyle, normalizeFontPreviewSize, FONT_PREVIEW_CHOICES } from "../state/fontPreview";
import { axisLabel, axisStep, fontAxes, fontStylePatch, fontStyles, matchFontStyle, unknownFontStyleMessage } from "../state/fontStyles";
import { defaultPixelAspectPresetName } from "../state/pixelAspect";
import { deleteMeasureScalePreset, saveMeasureScalePreset } from "../state/measureScale";
import { SELECTION_PREVIEW_MODES, type SelectionPreviewMode } from "../state/selectionPreview";
import { BUILTIN_CONTOURS, customContourSlot, newContour, type ContourPoint, type CustomContour } from "../state/contours";
import { colorRangePreviewMask, tonalPreviewMask, hsvToRgba, BLEND_ORDER, type ColorRangeSample, type GradientStop } from "../state/store";
import { LAYER_KIND } from "../state/engineContracts";
import { LAYER_LABELS, type LayerLabel } from "../state/layerLabels";
import { defaultLayerName, clampLayerOpacity, resolveLayerName } from "../state/newLayer";
import { defaultDuplicateName } from "../state/duplicateLayer";
import { expandGeometry, type ExpandSides } from "../state/generativeExpand";
import { defaultGroupName, resolveGroupName } from "../state/newGroup";
import { FILL_CONTENTS, hexToRgb, type FillContent } from "../state/fillContents";
import { fitsStylePattern, type PatternPreset } from "../state/patternPresets";
import { DEFAULT_LIGHTING, LIGHT_TYPES } from "../state/lightingEffects";
import { suggestedCropSize } from "../state/perspectiveCrop";
import { buildLut, buildCurveLuts, CURVE_CHANNELS } from "../state/toneCurve";
import type { HistChannel } from "../state/channelHistogram";
import {
  DUOTONE_CURVE_INPUTS, DUOTONE_PRESETS, duotoneColorAt, overprintCombos, overprintKey, presetForInkCount, solidOverprint,
  type DuotoneInk, type Ink as DuotoneRgb, type Overprints,
} from "../state/duotone";
import { COLOR_LOOKUP_PRESETS } from "@monet-ui/monet-color";
import {
  DOC_PRESETS,
  CUSTOM_PRESET,
  DOCUMENT_SIZE_UNITS,
  IMAGE_SIZE_UNITS,
  DEFAULT_DOCUMENT_RESOLUTION_PPI,
  MAX_NEW_DOCUMENT_DIMENSION_PX,
  MAX_DOCUMENT_RESOLUTION_PPI,
  convertDocumentLength,
  documentSizeFromPixels,
  documentSizePrecision,
  documentSizeToPixels,
  imageSizeFromPixels,
  imageSizeToPixels,
  loadRulerUnit,
  saveRulerUnit,
  presetByName,
  presetDisplaySize,
  presetForSettings,
  type DocumentSizeUnit,
  type ImageSizeUnit,
} from "../state/docPresets";
import {
  applyInterfacePrefs, loadInterfacePrefs, saveInterfacePrefs, type InterfacePrefs as AppInterfacePrefs,
} from "../state/interfacePrefs";
import { isBrushTipCursor, type OtherCursor, type PaintingCursor } from "../state/preferencePanes";
import { DENSITIES, THEMES } from "@monet-ui/monet-core";
import { orientSize, type Orientation } from "../state/artboardTool";
import { BATCH_SERIAL_ERROR, DEFAULT_BATCH_TEMPLATE, batchSummary, parseBatchSerial, parseDroplet, type BatchDestination, type DropletDescriptor } from "../state/batchIo";
import { linkedHeight, linkedWidth } from "../state/imageSizeLink";
import { commitOwnedEdit } from "./ownedDocumentEdit";
import { resolveCanvasSize, canvasSizeFits, anchorOffset, type AnchorPos } from "../state/canvasAnchor";
import { EXTENSION_COLORS, resolveExtensionColor, type ExtensionColor } from "../state/canvasExtension";
import { LEVELS_CHANNELS, defaultLevels, packLevels, type LevelsParams } from "../state/levelsChannels";
import { isColorLutParams, packColorLut } from "../state/colorLookupLut";
import {
  DEFAULT_AUTO_OPTIONS, DEFAULT_TARGETS, autoCurvePoints, autoLevelsParams, channelHistograms, clippingMask,
  curvesFromDropper, decodeAcv, decodeAlv, encodeAcv, encodeAlv, levelsFromDropper, pencilPoints, setCurvePointValue,
  type AutoAlgorithm, type AutoOptions, type DropperKind, type Rgb as ToneRgb,
} from "../state/levelsCurvesTools";
import { BG_CONTENTS, type BgContents } from "../state/bgContents";
import { DEFAULT_GUIDE_COLOR, defaultGuidePos, clampGuidePos, parseGuidePosition, type Guide, type GuideOrientation } from "../state/newGuide";
import {
  FX, FX_DEFS, FX_MAX_INSTANCES, PATTERNS, fxDef, defaultBlendIf, blendIfIsDefault, isLibraryPattern,
  patternLibraryId, BLEND_IF_CHANNELS, type FxField,
} from "../state/effects";
import type { TextSpec, TextRun, RGBA, Align, WarpStyle } from "../text/spec";
import { GLYPH_CATEGORIES, OPENTYPE_FEATURE_TAGS, categoryChars, glyphReplaceRange } from "../text/spec";
import { fontCoverage, glyphAlternates, pathMetrics } from "../text/raster";
import { loadRecentGlyphs, pushRecentGlyph, saveRecentGlyphs } from "./glyphsRecent";
import { GradientBar } from "./GradientBar";
import {
  GRADIENT_MAP_PRESETS, gradientMapPreset, buildGradientMapLutRgba, buildGradientMapLutF32,
  type GamutWarningPaint,
} from "@monet-ui/monet-color";
import {
  defaultMixer, packMixer, activeRow, channelTotal, setRowField, applyMonochromePreset,
  MIXER_OUTPUTS, MONOCHROME_PRESETS, SOURCE_MIN, SOURCE_MAX, CONST_MIN, CONST_MAX,
  type ChannelMixerState, type OutputChannel,
} from "../state/channelMixer";
import {
  defaultPhotoFilter, PHOTO_FILTER_PRESETS, photoFilterPreset, normalizedColor, densityFraction,
  type PhotoFilterState, type PhotoFilterColor,
} from "../state/photoFilter";
import {
  defaultColorBalance, setBalance, packColorBalanceTriads, COLOR_BALANCE_AXES, BALANCE_MIN, BALANCE_MAX,
  type ColorBalanceState, type ToneRange,
} from "../state/colorBalance";
import {
  defaultExposure, EXPOSURE_MIN, EXPOSURE_MAX, OFFSET_MIN, OFFSET_MAX, GAMMA_MIN, GAMMA_MAX,
  type ExposureState,
} from "../state/exposure";
import {
  HDR_PREVIEW_METHODS, HDR_EXPOSURE_MIN, HDR_EXPOSURE_MAX, HDR_GAMMA_MIN, HDR_GAMMA_MAX,
  hdrPreviewOnDismiss,
  type HdrPreviewMethod,
} from "../state/hdrPreview";
import {
  defaultHueSaturation, packHueSaturation, unpackHueSaturation, HS_RANGES,
  HUE_MIN, HUE_MAX, SAT_MIN, SAT_MAX, LIGHT_MIN, LIGHT_MAX,
  COLORIZE_HUE_MIN, COLORIZE_HUE_MAX, COLORIZE_SAT_MIN, COLORIZE_SAT_MAX,
  type HueSaturationState,
} from "../state/hueSaturation";
import {
  applyBlackWhitePreset, autoBlackWhite, blackWhitePresetName, BLACK_WHITE_BANDS,
  BLACK_WHITE_MAX, BLACK_WHITE_MIN, BLACK_WHITE_PRESETS, defaultBlackWhite,
  packBlackWhite, unpackBlackWhite, type BlackWhiteState,
} from "../state/blackWhite";
import {
  defaultVibrance, vibranceArgs, VIBRANCE_MIN, VIBRANCE_MAX, SATURATION_MIN, SATURATION_MAX,
  type VibranceState,
} from "../state/vibrance";
import {
  SELECTIVE_BANDS, CMYK_LABELS, defaultSelectiveColor, setBandCmyk, packSelectiveColor, CMYK_MIN, CMYK_MAX,
  type SelectiveColorState,
} from "../state/selectiveColor";
import {
  colorModeName, documentProfileName, profilePolicyWarning, cmykWorkingSpace,
  colorSettingsPreset, matchColorSettingsPreset, serializeColorSettings, parseColorSettings,
  COLOR_MODES, HDR_PROOF_CONFIGS, OCIO_PROOF_CONFIGS, RGB_PROFILES, RENDERING_INTENTS,
  CMYK_PROFILES, GRAY_PROFILES, SPOT_PROFILES, COLOR_SETTINGS_PRESETS,
  EMBEDDED_PROFILE_POLICIES, MISSING_PROFILE_POLICIES, PASTE_PROFILE_POLICIES,
  BLEND_GAMMA_MIN, BLEND_GAMMA_MAX, COLOR_ENGINES, CONVERT_ICC_SPACES, iccColorMode, normalizeConvertProfileOptions,
  type RenderingIntentId, type RgbProfileId, type ColorPolicyPrefs, type ColorSettingsFile, type IccProfileInfo,
  type ColorEngineId, type ConvertProfileOptions,
} from "@monet-ui/monet-color";
import { decodeImportText, readBrowserImportBytes, type LocalImportLimit } from "../state/localImport";
import { readNativeFileBounded } from "../state/nativeBoundedRead";
import { VISION_CONTAINER_APP } from "../state/nativeIoPolicy";
import { atomicWriteBytes } from "../state/atomicWrite";
import { cliCommandLine, cliExecutable } from "../native/cli";
import { MAX_SCRIPT_IMPORT_BYTES } from "../state/scriptLimits";
import {
  defaultBrightnessContrast, brightnessContrastArgs, BRIGHTNESS_MIN, BRIGHTNESS_MAX, CONTRAST_MIN, CONTRAST_MAX,
  type BrightnessContrastState,
} from "../state/brightnessContrast";
import { clampLevels, POSTERIZE_MIN, DEFAULT_LEVELS } from "../state/posterize";
import { defaultReplaceColor, replaceColorEngineArgs, type ReplaceColorAdjust } from "../state/replaceColor";
import {
  formatShortcut,
  isToolShortcutAllowed,
  reassignShortcut,
  shortcutConflict,
  shortcutFromEvent,
  toolShortcutFromEvent,
  type ShortcutChord,
  type ShortcutOverrides,
} from "../state/keyboardShortcuts";
import {
  DEFAULT_SHORTCUT_SET_NAME, SHORTCUT_SET_FILTERS, SHORTCUT_SET_LIMIT,
  loadShortcutSets, loadShortcutSetSelection, saveShortcutSets, parseShortcutSet, serializeShortcutSet, putShortcutSet, sameShortcuts,
  type ShortcutSet,
} from "../state/shortcutSets";
import { listMenuCommands, loadHiddenMenuCommands, saveHiddenMenuCommands } from "./psMenus";
import { thresholdFraction, THRESHOLD_MIN, THRESHOLD_MAX, DEFAULT_THRESHOLD } from "../state/threshold";
import {
  DEFAULT_EXPORT_SCALE_ROW,
  EXPORT_SCALE_MAX,
  EXPORT_SCALE_MIN,
  duplicateExportScaleFilename,
  duplicateExportScaleTargetFilename,
  exportScaleDimensions,
  exportScaleFits,
  normalizeExportScaleRows,
  type ExportScaleRow,
} from "../state/exportScaleRows";
import {
  exportAsWebOptions, RAW_DEMOSAIC_OPTIONS, RAW_DEPTH_OPTIONS,
  type Photoshop32BitImport, type RawDemosaic, type RawOpenDepth,
} from "../state/webExportPrefs";
import { BITMAP_MAX_OUTPUT_PPI, bitmapOutputFor, loadBitmapPrefs, loadIndexedColorPrefs, loadShadowsHighlightsPrefs, saveBitmapPrefs, saveIndexedColorPrefs, saveShadowsHighlightsPrefs } from "../state/imageDialogPrefs";
import {
  ACCENT, INP_BASE, Row, PreviewDialog, useScratchAdjustmentLayer, useScratchFillLayer, layerContentArg, Ctx, useDialogs, titleCase, GROUP_BLEND_OPTIONS, type DialogName,
} from "./dialogs/common";
import { CameraRawWorkspaceHost } from "./dialogs/CameraRawWorkspace";
import { Jpeg2000OptionsDialog, PhotoshopRawOpenDialog, PhotoshopRawSaveDialog } from "./dialogs/FileFormatDialogs";

// The dialog context + primitives live in ./dialogs/common (review Arch AM5).
// Re-export the parts App.tsx / Panels.tsx import from "./Dialogs".
export { useDialogs };
export type { DialogName };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<DialogName | null>(null);
  const [arg, setArg] = useState<unknown>(null);
  const [instance, setInstance] = useState(0);
  const open = useCallback((name: DialogName, a?: unknown) => {
    // A function arg (TIFF Options' resolve) must be stored, not run as an updater.
    setArg(() => a ?? null);
    setCurrent(name);
    setInstance((value) => value + 1);
  }, []);
  const close = useCallback(() => setCurrent(null), []);
  // Reopen on the saved Preferences ▸ Interface theme/density. The provider is
  // mounted at the app root, so this is the app's one boot-time stamp.
  useEffect(() => { applyInterfacePrefs(loadInterfacePrefs(), document.documentElement); }, []);
  // Let the state-layer multi-page PDF open raise the page picker through React.
  useEffect(() => {
    registerPdfPagePicker((req) => open("pdfPage", req));
    registerTiffLayersPicker((resolve) => open("tiffOptions", resolve));
    registerSaveOptionsPicker((format, resolve) => open(format === "jpeg2000" ? "jpeg2000Options" : "photoshopRawSave", resolve));
    registerPhotoshopRawPicker((req) => open("photoshopRawOpen", req));
    return () => {
      registerPdfPagePicker(null);
      registerTiffLayersPicker(null);
      registerSaveOptionsPicker(null);
      registerPhotoshopRawPicker(null);
    };
  }, [open]);
  return (
    <Ctx.Provider value={{ open, close, current, arg }}>
      {children}
      <DialogHost key={instance} />
    </Ctx.Provider>
  );
}

// ── adjustment-layer dialogs (non-destructive) ─────────────────
interface AdjControl { label: string; idx: number; min: number; max: number; format?: (v: number) => string;
  /** Render as a checkbox writing 0/1 rather than a slider. */
  toggle?: boolean; }
interface AdjSpec {
  kind: number;
  label: string;
  defaults: number[];
  controls: AdjControl[];
  /** Upgrade a shorter legacy parameter block for editing without changing its look. */
  upgrade?: (params: number[]) => number[];
}

const pct = (v: number) => `${Math.round(v * 100)}`;
const x255 = (v: number) => `${Math.round(v * 255)}`;
const dp2 = (v: number) => v.toFixed(2);
const rgbHex = (c: [number, number, number]) => "#" + c.map((x) => Math.max(0, Math.min(255, x | 0)).toString(16).padStart(2, "0")).join("");
const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const ADJ_SPECS: Record<string, AdjSpec> = {
  alBrightness: { kind: 0, label: "Brightness/Contrast", defaults: [0, 0],
    controls: [{ label: "Brightness", idx: 0, min: -1, max: 1, format: pct }, { label: "Contrast", idx: 1, min: -1, max: 1, format: pct }] },
  alLevels: { kind: 1, label: "Levels", defaults: [0, 1, 1, 0, 1],
    controls: [
      { label: "In black", idx: 0, min: 0, max: 0.99, format: x255 },
      { label: "Gamma", idx: 2, min: 0.1, max: 3, format: dp2 },
      { label: "In white", idx: 1, min: 0.01, max: 1, format: x255 },
      { label: "Out black", idx: 3, min: 0, max: 1, format: x255 },
      { label: "Out white", idx: 4, min: 0, max: 1, format: x255 },
    ] },
  alHueSat: {
    kind: 2,
    label: "Hue/Saturation",
    defaults: Array.from(packHueSaturation(defaultHueSaturation())),
    upgrade: (params) => Array.from(packHueSaturation(unpackHueSaturation(params))),
    controls: [
      { label: "Hue", idx: 0, min: -180, max: 180, format: (v) => `${Math.round(v)}°` },
      { label: "Saturation", idx: 1, min: -1, max: 1, format: pct },
      { label: "Lightness", idx: 2, min: -1, max: 1, format: pct },
      { label: "Colorize", idx: 3, min: 0, max: 1, toggle: true },
      ...HS_RANGES.flatMap((band, i) => [
        { label: `${band} Hue`, idx: 4 + i * 3, min: -180, max: 180, format: (v: number) => `${Math.round(v)}°` },
        { label: `${band} Saturation`, idx: 5 + i * 3, min: -1, max: 1, format: pct },
        { label: `${band} Lightness`, idx: 6 + i * 3, min: -1, max: 1, format: pct },
      ]),
    ],
  },
  alVibrance: { kind: 3, label: "Vibrance", defaults: [0, 0],
    controls: [{ label: "Vibrance", idx: 0, min: -1, max: 1, format: pct }, { label: "Saturation", idx: 1, min: -1, max: 1, format: pct }] },
  alExposure: { kind: 9, label: "Exposure", defaults: [0, 0, 1],
    controls: [{ label: "Exposure", idx: 0, min: -3, max: 3, format: dp2 }, { label: "Offset", idx: 1, min: -0.5, max: 0.5, format: (v) => v.toFixed(3) }, { label: "Gamma", idx: 2, min: 0.1, max: 3, format: dp2 }] },
  alBlackWhite: {
    kind: 6,
    label: "Black & White",
    defaults: Array.from(packBlackWhite(defaultBlackWhite())),
    upgrade: (params) => Array.from(packBlackWhite(unpackBlackWhite(params))),
    controls: [
      ...BLACK_WHITE_BANDS.map((band, i) => ({ label: band, idx: 3 + i, min: -2, max: 3, format: pct })),
      { label: "Tint", idx: 9, min: 0, max: 1, toggle: true },
      { label: "Tint Hue", idx: 10, min: 0, max: 360, format: (v) => `${Math.round(v)}°` },
      { label: "Tint Saturation", idx: 11, min: 0, max: 1, format: pct },
    ],
  },
  alPosterize: { kind: 7, label: "Posterize", defaults: [6],
    controls: [{ label: "Levels", idx: 0, min: 2, max: 32, format: (v) => `${Math.round(v)}` }] },
  alThreshold: { kind: 8, label: "Threshold", defaults: [0.5],
    controls: [{ label: "Level", idx: 0, min: 0, max: 1, format: x255 }] },
  alColorBalance: { kind: 10, label: "Color Balance", defaults: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    controls: [
      { label: "Sh C–R", idx: 0, min: -1, max: 1, format: pct }, { label: "Sh M–G", idx: 1, min: -1, max: 1, format: pct }, { label: "Sh Y–B", idx: 2, min: -1, max: 1, format: pct },
      { label: "Mid C–R", idx: 3, min: -1, max: 1, format: pct }, { label: "Mid M–G", idx: 4, min: -1, max: 1, format: pct }, { label: "Mid Y–B", idx: 5, min: -1, max: 1, format: pct },
      { label: "Hi C–R", idx: 6, min: -1, max: 1, format: pct }, { label: "Hi M–G", idx: 7, min: -1, max: 1, format: pct }, { label: "Hi Y–B", idx: 8, min: -1, max: 1, format: pct },
      { label: "Preserve Luminosity", idx: 9, min: 0, max: 1, toggle: true },
    ] },
  alPhotoFilter: { kind: 11, label: "Photo Filter", defaults: [0.93, 0.54, 0, 0.25, 1],
    controls: [
      { label: "Red", idx: 0, min: 0, max: 1, format: pct },
      { label: "Green", idx: 1, min: 0, max: 1, format: pct },
      { label: "Blue", idx: 2, min: 0, max: 1, format: pct },
      { label: "Density", idx: 3, min: 0, max: 1, format: pct },
      { label: "Preserve Luminosity", idx: 4, min: 0, max: 1, toggle: true },
    ] },
};

function lutToParams(lut: Uint8Array): Float32Array {
  const p = new Float32Array(256);
  for (let i = 0; i < 256; i++) p[i] = lut[i] / 255;
  return p;
}

function sparseSampleIndices(samples: number[][]): number[] {
  if (samples.length < 2) return [0];
  const matches = (start: number, end: number) => {
    const span = end - start;
    for (let i = start + 1; i < end; i++) {
      const t = (i - start) / span;
      for (let c = 0; c < samples[start].length; c++) {
        if (Math.round(samples[start][c] + (samples[end][c] - samples[start][c]) * t) !== samples[i][c]) return false;
      }
    }
    return true;
  };
  const out = [0];
  let start = 0;
  while (start < samples.length - 1) {
    let end = samples.length - 1;
    while (end > start + 1 && !matches(start, end)) end--;
    out.push(end);
    start = end;
  }
  return out;
}

function curvePointsFromParams(params: number[]): CurvePoint[] {
  if (params.length < 256) return [{ id: "lo", x: 0, y: 0 }, { id: "hi", x: 1, y: 1 }];
  const samples = Array.from({ length: 256 }, (_, i) => [Math.round(Math.max(0, Math.min(1, params[i])) * 255)]);
  return sparseSampleIndices(samples).map((i) => ({ id: `lut-${i}`, x: i / 255, y: samples[i][0] / 255 }));
}

function gradientMapStopsFromParams(params: number[]): GradientStop[] {
  if (params.length < 256 * 3) return [{ pos: 0, r: 0, g: 0, b: 0, a: 255 }, { pos: 1, r: 255, g: 255, b: 255, a: 255 }];
  const samples = Array.from({ length: 256 }, (_, i) => [0, 1, 2].map((c) => Math.round(Math.max(0, Math.min(1, params[i * 3 + c])) * 255)));
  return sparseSampleIndices(samples).map((i) => ({ pos: i / 255, r: samples[i][0], g: samples[i][1], b: samples[i][2], a: 255 }));
}

function gradientFillStopsFromParams(params: number[]): GradientStop[] {
  if (params.length < 10) return [{ pos: 0, r: 0, g: 0, b: 0, a: 255 }, { pos: 1, r: 255, g: 255, b: 255, a: 255 }];
  const stops: GradientStop[] = [];
  for (let i = 0; i + 4 < params.length; i += 5) {
    stops.push({
      pos: Math.max(0, Math.min(1, params[i])),
      r: Math.round(Math.max(0, Math.min(1, params[i + 1])) * 255),
      g: Math.round(Math.max(0, Math.min(1, params[i + 2])) * 255),
      b: Math.round(Math.max(0, Math.min(1, params[i + 3])) * 255),
      a: Math.round(Math.max(0, Math.min(1, params[i + 4])) * 255),
    });
  }
  return stops;
}

function packGradientFill(stops: GradientStop[]): Float32Array {
  return new Float32Array([...stops]
    .sort((a, b) => a.pos - b.pos)
    .flatMap((s) => [s.pos, s.r / 255, s.g / 255, s.b / 255, s.a / 255]));
}

function mixerFromParams(params: number[]): ChannelMixerState {
  if (params.length < 12) return defaultMixer();
  const row = (i: number) => ({ red: params[i] * 100, green: params[i + 1] * 100, blue: params[i + 2] * 100, constant: params[i + 3] * 100 });
  const red = row(0), green = row(4), blue = row(8);
  const same = (a: typeof red, b: typeof red) => (Object.keys(a) as (keyof typeof red)[]).every((k) => Math.abs(a[k] - b[k]) < 1e-4);
  return { monochrome: same(red, green) && same(red, blue), red, green, blue, gray: { ...red } };
}

// Per-channel curve/levels tint (RGB uses the app accent; R/G/B use their own hue).
const CURVE_CH_ACCENT = [ACCENT, "#ff5d5d", "#5dff7a", "#5d9bff"];
// The Levels / Curves channel index (0=RGB composite, 1=R, 2=G, 3=B) as the
// histogram channel it reads.
const TONE_HIST_CHANNELS: HistChannel[] = ["luma", "r", "g", "b"];

// Photoshop draws the composite's histogram behind the Levels sliders and the
// Curves grid so a tone edit can be aimed at the distribution it is moving.
// Same engine read the Histogram panel uses (channelHistogramBars → the shared
// channelCounts/downsampleBins helpers).
// ponytail: sampled once per channel, not per preview tick — Photoshop's is the
// pre-edit distribution too, and re-reading the composite on every slider tick
// would make the dialog fight its own live preview.
function AdjustmentHistogram({ channel, height, behind }: { channel: HistChannel; height: number; behind?: boolean }) {
  const data = useMemo(() => engine.channelHistogramBars(channel, 128), [channel]);
  // `behind` parks it under the Curves grid (whose plate is translucent); the
  // Levels strip stacks it in flow above the input sliders it describes.
  const style: CSSProperties = behind
    ? { position: "absolute", inset: 0, opacity: 0.45, pointerEvents: "none" }
    : { marginBottom: 8 };
  return (
    <div data-mv-adj-histogram={channel} aria-hidden="true" style={style}>
      <Histogram data={data} accent={CURVE_CH_ACCENT[TONE_HIST_CHANNELS.indexOf(channel)] ?? ACCENT} height={height} />
    </div>
  );
}

function AdjLayerDialog({ specKey }: { specKey: string }) {
  const spec = ADJ_SPECS[specKey];
  const { close, arg } = useDialogs();
  const edit = layerContentArg(arg, LAYER_KIND.adjustment, spec.kind);
  // A layer saved before a control was added carries fewer params than the spec
  // now declares (Color Balance gained Preserve Luminosity at slot 9, Photo
  // Filter at slot 4). Re-checking `length >= defaults.length` would fail for
  // those and silently reset every slider, so pad instead — with 0, which is
  // exactly what the engine reads for a missing slot (pixel_adjust `get`), so
  // the dialog opens showing what the layer actually renders.
  const initial = edit
    ? spec.upgrade?.(edit.params) ?? Array.from(
        { length: Math.max(spec.defaults.length, edit.params.length) },
        (_, i) => (i < edit.params.length ? edit.params[i] : 0),
      )
    : spec.defaults.slice();
  const [params, setParams] = useState<number[]>(initial);
  const scratch = useScratchAdjustmentLayer(
    () => store.addAdjustmentLayer(spec.kind, new Float32Array(initial), spec.label),
    edit?.layerId,
  );
  const update = (idx: number, v: number) => {
    const next = [...params];
    next[idx] = v;
    setParams(next);
    scratch.applyParams(new Float32Array(next));
  };
  const cancel = () => scratch.cancel(close);
  const finish = () => scratch.finish(close);
  return (
    <Dialog open onClose={cancel} title={`${spec.label} — Adjustment Layer`} width={spec.controls.length > 5 ? 440 : 380}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" onClick={finish}>OK</Button></>}>
      {specKey === "alLevels" && <AdjustmentHistogram channel="luma" height={64} />}
      {spec.controls.map((c) => (c.toggle ? (
        <div key={c.idx + c.label} style={{ padding: "4px 0" }}>
          <Checkbox checked={params[c.idx] > 0.5} aria-label={c.label}
            onChange={(v) => update(c.idx, v ? 1 : 0)}>{c.label}</Checkbox>
        </div>
      ) : (
        <Row key={c.idx + c.label} label={c.label} value={params[c.idx]} min={c.min} max={c.max} onChange={(v) => update(c.idx, v)} format={c.format} />
      )))}
    </Dialog>
  );
}

function CurvesAdjLayer() {
  const { close, arg } = useDialogs();
  const edit = layerContentArg(arg, LAYER_KIND.adjustment, 12);
  const [pts, setPts] = useState<CurvePoint[]>(() => edit ? curvePointsFromParams(edit.params) : [{ id: "lo", x: 0, y: 0 }, { id: "mid", x: 0.5, y: 0.5 }, { id: "hi", x: 1, y: 1 }]);
  const scratch = useScratchAdjustmentLayer(
    () => store.addAdjustmentLayer(12, lutToParams(buildLut(pts)), "Curves"),
    edit?.layerId,
  );
  const onChange = (p: CurvePoint[]) => {
    setPts(p);
    scratch.applyParams(lutToParams(buildLut(p)));
  };
  const cancel = () => scratch.cancel(close);
  return (
    <Dialog open onClose={cancel} title="Curves — Adjustment Layer" width={320}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" onClick={() => scratch.finish(close)}>OK</Button></>}>
      <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 8px" }}>
        <div style={{ position: "relative", width: 256, height: 256 }}>
          <AdjustmentHistogram channel="luma" height={256} behind />
          {/* positioned so it paints over the absolute backdrop */}
          <div style={{ position: "relative" }}>
            <CurveEditor points={pts} onChange={onChange} width={256} height={256} accent={ACCENT} xRange={[0, 255]} yRange={[0, 255]} aria-label="Tone curve" />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// Sample the gradient at each of 256 luminance levels → a normalised RGB LUT
// (engine kind 13). Delegates to the tested, shared builder in state/gradientMap.
function buildGradientLut(stops: GradientStop[]): Float32Array {
  return buildGradientMapLutF32(stops);
}
function GradientMapAdjLayer() {
  const { close, arg } = useDialogs();
  const edit = layerContentArg(arg, LAYER_KIND.adjustment, 13);
  const [stops, setStops] = useState<GradientStop[]>(() => edit ? gradientMapStopsFromParams(edit.params) : [{ pos: 0, r: 0, g: 0, b: 0, a: 255 }, { pos: 1, r: 255, g: 255, b: 255, a: 255 }]);
  const scratch = useScratchAdjustmentLayer(
    () => store.addAdjustmentLayer(13, buildGradientLut(stops), "Gradient Map"),
    edit?.layerId,
  );
  const onChange = (s: GradientStop[]) => { setStops(s); scratch.applyParams(buildGradientLut(s)); };
  const cancel = () => scratch.cancel(close);
  return (
    <Dialog open onClose={cancel} title="Gradient Map — Adjustment Layer" width={460}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" onClick={() => scratch.finish(close)}>OK</Button></>}>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 10 }}>Remaps luminance through the gradient — shadows to the left stop, highlights to the right.</div>
      <GradientBar stops={stops} onChange={onChange} />
    </Dialog>
  );
}

// Shared Channel Mixer controls (output selector + Monochrome + B&W presets +
// Source R/G/B + Constant in %, with the Photoshop Total% readout). Used by both
// the direct dialog and the adjustment-layer dialog; state lives in the parent.
function ChannelMixerControls({
  state, output, setOutput, onChange,
}: {
  state: ChannelMixerState;
  output: OutputChannel;
  setOutput: (o: OutputChannel) => void;
  onChange: (next: ChannelMixerState) => void;
}) {
  const row = activeRow(state, output);
  // Round for display + the "brightness preserved" check: the % sliders run in
  // normalised mode so dragging yields binary-float fuzz (e.g. 100.00000000003).
  const total = Math.round(channelTotal(row));
  return (
    <>
      {!state.monochrome && (
        <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
          <span className="lbl" style={{ width: 96 }}>Output Channel</span>
          <SegmentedControl value={String(output)} onChange={(v) => setOutput(Number(v) as OutputChannel)}
            items={MIXER_OUTPUTS.map((o) => ({ value: String(o.value), label: o.label }))} />
        </div>
      )}
      <div className="monet-row" style={{ marginBottom: 8 }}>
        <Checkbox checked={state.monochrome} onChange={(v) => onChange({ ...state, monochrome: v })}>Monochrome</Checkbox>
      </div>
      {state.monochrome && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {MONOCHROME_PRESETS.map((p) => (
            <Button key={p.name} size="sm" variant="ghost" title={p.name} onClick={() => onChange(applyMonochromePreset(state, p.name))}>
              {p.name.replace("Black & White ", "").replace("with ", "")}
            </Button>
          ))}
        </div>
      )}
      <Row label="Source Red" value={row.red} min={SOURCE_MIN} max={SOURCE_MAX} decimals={0} suffix="%" onChange={(v) => onChange(setRowField(state, output, "red", v))} />
      <Row label="Source Green" value={row.green} min={SOURCE_MIN} max={SOURCE_MAX} decimals={0} suffix="%" onChange={(v) => onChange(setRowField(state, output, "green", v))} />
      <Row label="Source Blue" value={row.blue} min={SOURCE_MIN} max={SOURCE_MAX} decimals={0} suffix="%" onChange={(v) => onChange(setRowField(state, output, "blue", v))} />
      <Row label="Constant" value={row.constant} min={CONST_MIN} max={CONST_MAX} decimals={0} suffix="%" onChange={(v) => onChange(setRowField(state, output, "constant", v))} />
      <div style={{ marginTop: 8, fontSize: 11, color: total === 100 ? "var(--text-3)" : "#d08700" }}>
        Total: {total}%
      </div>
    </>
  );
}

function ChannelMixerAdjLayer() {
  const { close, arg } = useDialogs();
  const edit = layerContentArg(arg, LAYER_KIND.adjustment, 14);
  const [state, setState] = useState<ChannelMixerState>(() => edit ? mixerFromParams(edit.params) : defaultMixer());
  const [output, setOutput] = useState<OutputChannel>(0);
  const scratch = useScratchAdjustmentLayer(
    () => store.addAdjustmentLayer(14, packMixer(state), "Channel Mixer"),
    edit?.layerId,
  );
  const onChange = (next: ChannelMixerState) => { setState(next); scratch.applyParams(packMixer(next)); };
  const cancel = () => scratch.cancel(close);
  return (
    <Dialog open onClose={cancel} title="Channel Mixer — Adjustment Layer" width={420}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" onClick={() => scratch.finish(close)}>OK</Button></>}>
      <ChannelMixerControls state={state} output={output} setOutput={setOutput} onChange={onChange} />
    </Dialog>
  );
}

function SelectiveColorAdjLayer() {
  const { close, arg } = useDialogs();
  const edit = layerContentArg(arg, LAYER_KIND.adjustment, 15);
  const [band, setBand] = useState(0);
  const [relative, setRelative] = useState(() => edit ? edit.params[0] !== 0 : true);
  const [corr, setCorr] = useState<number[]>(() => edit && edit.params.length >= 37 ? edit.params.slice(1, 37) : Array(36).fill(0));
  const build = (rel: boolean, c: number[]) => new Float32Array([rel ? 1 : 0, ...c]);
  const scratch = useScratchAdjustmentLayer(
    () => store.addAdjustmentLayer(15, build(relative, corr), "Selective Color"),
    edit?.layerId,
  );
  const update = (i: number, v: number) => {
    const next = [...corr]; next[band * 4 + i] = v; setCorr(next);
    scratch.applyParams(build(relative, next));
  };
  const setRel = (rel: boolean) => { setRelative(rel); scratch.applyParams(build(rel, corr)); };
  const cancel = () => scratch.cancel(close);
  return (
    <Dialog open onClose={cancel} title="Selective Color — Adjustment Layer" width={420}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" onClick={() => scratch.finish(close)}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 60 }}>Colors</span>
        <Select value={String(band)} onChange={(v) => setBand(+v)} options={SELECTIVE_BANDS.map((b, i) => ({ value: String(i), label: b }))} />
      </div>
      <Row label="Cyan" value={corr[band * 4]} min={-1} max={1} step={0.01} format={pct} onChange={(v) => update(0, v)} />
      <Row label="Magenta" value={corr[band * 4 + 1]} min={-1} max={1} step={0.01} format={pct} onChange={(v) => update(1, v)} />
      <Row label="Yellow" value={corr[band * 4 + 2]} min={-1} max={1} step={0.01} format={pct} onChange={(v) => update(2, v)} />
      <Row label="Black" value={corr[band * 4 + 3]} min={-1} max={1} step={0.01} format={pct} onChange={(v) => update(3, v)} />
      <div className="monet-row" style={{ gap: 10, marginTop: 8 }}>
        <SegmentedControl value={relative ? "rel" : "abs"} onChange={(v) => setRel(v === "rel")}
          items={[{ value: "rel", label: "Relative" }, { value: "abs", label: "Absolute" }]} />
      </div>
    </Dialog>
  );
}

// Built-in Color Lookup look names live in monet-color/colorLookup (index = engine
// preset id, 0 = identity), the single source of truth shared with the engine-mirror
// module. Load 3D LUT… (#441) swaps the look onto an external .cube/.3dl packed into
// the same kind-16 params (state/colorLookupLut): on an adjustment layer it stays
// live, re-editable and saved with the layer; picking a preset again drops the LUT.
function ColorLookupRow({ params, onChange }: { params: Float32Array; onChange: (p: Float32Array) => void }) {
  const hasLut = isColorLutParams(params);
  const loadLut = async () => { const lut = await pickColorLutFile(); if (lut) onChange(packColorLut(lut)); };
  return (
    <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
      <span className="lbl" style={{ width: 60 }}>Preset</span>
      <Select value={hasLut ? "lut" : String(Math.round(params[0] ?? 0))} onChange={(v) => { if (v !== "lut") onChange(new Float32Array([+v])); }}
        options={[
          ...COLOR_LOOKUP_PRESETS.map((l, i) => ({ value: String(i), label: l })),
          ...(hasLut ? [{ value: "lut", label: `3D LUT (${params[1]}³)` }] : []),
        ]} />
      <Button variant="ghost" onClick={() => void loadLut()}>Load 3D LUT…</Button>
    </div>
  );
}
function ColorLookupAdjLayer() {
  const { close, arg } = useDialogs();
  const edit = layerContentArg(arg, LAYER_KIND.adjustment, 16);
  const [params, setParams] = useState<Float32Array>(() => edit ? Float32Array.from(edit.params) : new Float32Array([1]));
  const scratch = useScratchAdjustmentLayer(
    () => store.addAdjustmentLayer(16, params, "Color Lookup"),
    edit?.layerId,
  );
  const update = (p: Float32Array) => { setParams(p); scratch.applyParams(p); };
  const cancel = () => scratch.cancel(close);
  return (
    <Dialog open onClose={cancel} title="Color Lookup — Adjustment Layer" width={420}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" onClick={() => scratch.finish(close)}>OK</Button></>}>
      <ColorLookupRow params={params} onChange={update} />
    </Dialog>
  );
}
function ColorLookupDialog() {
  const [params, setParams] = useState<Float32Array>(() => new Float32Array([1]));
  return (
    <PreviewDialog title="Color Lookup" width={420} deps={[params]} apply={() => adj.colorLookup(params)}>
      <ColorLookupRow params={params} onChange={setParams} />
    </PreviewDialog>
  );
}

// ── adjustment dialogs ─────────────────────────────────────────
function BrightnessContrast() {
  const [state, setState] = useState<BrightnessContrastState>(defaultBrightnessContrast);
  const set = (patch: Partial<BrightnessContrastState>) => setState((s) => ({ ...s, ...patch }));
  return (
    <PreviewDialog title="Brightness / Contrast" deps={[state]} apply={() => adj.brightnessContrast(...brightnessContrastArgs(state))}>
      <Row label="Brightness" value={state.brightness} min={BRIGHTNESS_MIN} max={BRIGHTNESS_MAX} onChange={(v) => set({ brightness: v })} />
      <Row label="Contrast" value={state.contrast} min={CONTRAST_MIN} max={CONTRAST_MAX} onChange={(v) => set({ contrast: v })} />
    </PreviewDialog>
  );
}

// ── Levels / Curves shared tools (#435, #436) ─────────────────────────────
// The eyedroppers, Auto (with Photoshop's Auto Color Correction Options) and
// the .alv/.acv presets are the same three controls in both dialogs, so they
// share a toolbar and a document snapshot. The snapshot is taken on open,
// BEFORE the preview transaction touches the composite: droppers and Auto must
// read the source pixels, not the correction being edited.
const DROPPERS: { kind: DropperKind; label: string; glyph: string }[] = [
  { kind: "black", label: "Set black point", glyph: "●" },
  { kind: "gray", label: "Set gray point", glyph: "◐" },
  { kind: "white", label: "Set white point", glyph: "○" },
];
const PRESET_LIMIT = { maxBytes: 64 * 1024, label: "Photoshop tone preset" };
const toneHex = (c: ToneRgb) => rgbHex([c.r, c.g, c.b]);
const toneRgb = (hex: string): ToneRgb => { const [r, g, b] = hexRgb(hex); return { r, g, b }; };

/** A downsampled copy of the composite as it was when the dialog opened. */
function useDocSnapshot(): ImageData | null {
  const [url] = useState(() => (engine.engine ? engine.docThumbUrl(engine.e, 320, 240) : ""));
  const [image, setImage] = useState<ImageData | null>(null);
  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      setImage(ctx.getImageData(0, 0, c.width, c.height));
    };
    img.src = url;
  }, [url]);
  return image;
}

/** The snapshot, clickable while a dropper is armed; `clip` paints Show
 *  Clipping over it (shadow clip blue, highlight clip red). */
function DropperPreview({ image, armed, onSample, clip }: {
  image: ImageData | null; armed: DropperKind | null; onSample: (px: ToneRgb) => void; clip?: Uint8Array | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!clip) { ctx.putImageData(image, 0, 0); return; }
    const out = ctx.createImageData(image.width, image.height);
    for (let i = 0; i < clip.length; i++) {
      const f = clip[i];
      const o = i * 4;
      if (f === 0) { out.data[o] = out.data[o + 1] = out.data[o + 2] = 128; }
      else { out.data[o] = f & 2 ? 255 : 0; out.data[o + 1] = 0; out.data[o + 2] = f & 1 ? 255 : 0; }
      out.data[o + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }, [image, clip]);
  if (!image) return null;
  return (
    <canvas ref={ref} data-mv-tone-preview aria-label="Document preview — click with an eyedropper to sample"
      style={{ width: "100%", maxHeight: 160, objectFit: "contain", display: "block", margin: "0 0 8px", cursor: armed ? "crosshair" : "default", borderRadius: 4 }}
      onClick={(e) => {
        if (!armed) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const scale = Math.min(rect.width / image.width, rect.height / image.height);
        const dw = image.width * scale, dh = image.height * scale;
        const x = Math.floor((e.clientX - rect.left - (rect.width - dw) / 2) / scale);
        const y = Math.floor((e.clientY - rect.top - (rect.height - dh) / 2) / scale);
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
        const o = (y * image.width + x) * 4;
        onSample({ r: image.data[o], g: image.data[o + 1], b: image.data[o + 2] });
      }} />
  );
}

/** Droppers with their target colours, Auto, Options…, Load…, Save…. */
function ToneToolbar({ armed, setArmed, targets, setTargets, onAuto, optionsOpen, setOptionsOpen, onLoad, onSave, ext }: {
  armed: DropperKind | null; setArmed: (k: DropperKind | null) => void;
  targets: Record<DropperKind, ToneRgb>; setTargets: (t: Record<DropperKind, ToneRgb>) => void;
  onAuto: () => void; optionsOpen: boolean; setOptionsOpen: (v: boolean) => void;
  onLoad: () => void; onSave: () => void; ext: string;
}) {
  return (
    <div className="monet-row" style={{ gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
      {DROPPERS.map((d) => (
        <span key={d.kind} style={{ display: "inline-flex", alignItems: "center" }}>
          <button aria-label={d.label} title={`${d.label} — click the preview`} aria-pressed={armed === d.kind}
            data-mv-tone-dropper={d.kind} onClick={() => setArmed(armed === d.kind ? null : d.kind)}
            style={{ width: 24, height: 22, borderRadius: "4px 0 0 4px", border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: armed === d.kind ? ACCENT : "var(--surface-2, rgba(255,255,255,0.05))", color: armed === d.kind ? "#000" : "var(--text-1)", cursor: "pointer", padding: 0, fontSize: 11 }}>{d.glyph}</button>
          {/* Photoshop edits the target on double-click; the swatch beside the dropper is the same setting, one click away. */}
          <input type="color" aria-label={`${d.label} target color`} value={toneHex(targets[d.kind])}
            onChange={(e) => setTargets({ ...targets, [d.kind]: toneRgb(e.currentTarget.value) })}
            style={{ width: 20, height: 22, padding: 0, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", borderLeft: "none", borderRadius: "0 4px 4px 0", background: "transparent" }} />
        </span>
      ))}
      <span style={{ flex: 1 }} />
      <Button size="sm" variant="ghost" data-mv-tone-auto onClick={onAuto} title="Apply the auto correction chosen under Options">Auto</Button>
      <Button size="sm" variant="ghost" data-mv-tone-options aria-pressed={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)}>Options…</Button>
      <Button size="sm" variant="ghost" data-mv-tone-load onClick={onLoad} title={`Load a Photoshop .${ext} preset`}>Load…</Button>
      <Button size="sm" variant="ghost" data-mv-tone-save onClick={onSave} title={`Save as a Photoshop .${ext} preset`}>Save…</Button>
    </div>
  );
}

const AUTO_ALGORITHMS: { value: AutoAlgorithm; label: string }[] = [
  { value: "monochrome", label: "Enhance Monochromatic Contrast" },
  { value: "perChannel", label: "Enhance Per Channel Contrast" },
  { value: "darkLight", label: "Find Dark & Light Colors" },
];

/** Photoshop's Auto Color Correction Options, inline (a nested dialog would
 *  replace this one — see PreviewDialog's unmount note). */
function AutoOptionsPanel({ opts, setOpts }: { opts: AutoOptions; setOpts: (o: AutoOptions) => void }) {
  const clipField = (key: "shadowClip" | "highlightClip", label: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      {label}
      <input type="number" min={0} max={9.99} step={0.01} value={opts[key]} aria-label={`${label} clip percent`}
        onChange={(e) => setOpts({ ...opts, [key]: Math.max(0, Math.min(9.99, Number(e.currentTarget.value) || 0)) })}
        style={{ ...INP_BASE, width: 58 }} />%
    </label>
  );
  return (
    <div data-mv-tone-auto-options style={{ border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", borderRadius: 6, padding: 8, marginBottom: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="monet-row" style={{ gap: 8 }}>
        <span className="lbl" style={{ width: 60 }}>Algorithm</span>
        <Select aria-label="Auto algorithm" value={opts.algorithm} style={{ flex: 1 }}
          onChange={(v) => setOpts({ ...opts, algorithm: v as AutoAlgorithm })}
          options={AUTO_ALGORITHMS} />
      </div>
      <Checkbox checked={opts.snapNeutral} aria-label="Snap Neutral Midtones" disabled={opts.algorithm !== "darkLight"}
        onChange={(v) => setOpts({ ...opts, snapNeutral: v })}>Snap Neutral Midtones</Checkbox>
      <div className="monet-row" style={{ gap: 12, flexWrap: "wrap" }}>
        {clipField("shadowClip", "Shadows")}
        {clipField("highlightClip", "Highlights")}
      </div>
      <div className="monet-row" style={{ gap: 10, fontSize: 11 }}>
        Target colors
        {(["black", "gray", "white"] as const).map((k) => (
          <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            {k === "black" ? "Shadows" : k === "gray" ? "Midtones" : "Highlights"}
            <input type="color" aria-label={`Auto ${k} target`} value={toneHex(opts.targets[k])}
              onChange={(e) => setOpts({ ...opts, targets: { ...opts.targets, [k]: toneRgb(e.currentTarget.value) } })}
              style={{ width: 22, height: 20, padding: 0, border: "none", background: "transparent" }} />
          </label>
        ))}
      </div>
    </div>
  );
}

function Levels() {
  const [ch, setCh] = useState(0); // 0=RGB(composite), 1=R, 2=G, 3=B
  const [params, setParams] = useState<LevelsParams[]>(() =>
    [defaultLevels(), defaultLevels(), defaultLevels(), defaultLevels()]);
  const [armed, setArmed] = useState<DropperKind | null>(null);
  const [targets, setTargets] = useState<Record<DropperKind, ToneRgb>>({ ...DEFAULT_TARGETS });
  const [auto, setAuto] = useState<AutoOptions>(DEFAULT_AUTO_OPTIONS);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const snapshot = useDocSnapshot();
  const p = params[ch];
  const set = (patch: Partial<LevelsParams>) =>
    setParams((prev) => prev.map((q, i) => (i === ch ? { ...q, ...patch } : q)));
  const runAuto = () => { if (snapshot) setParams(autoLevelsParams(channelHistograms(snapshot.data), { ...auto, targets })); };
  const load = async () => {
    const bytes = await pickLocalFileBytes([{ name: "Photoshop Levels", extensions: ["alv"] }], PRESET_LIMIT);
    if (!bytes) return;
    const loaded = decodeAlv(bytes);
    if (loaded) { setParams(loaded); setMsg(""); } else setMsg("Not a Photoshop Levels (.alv) file");
  };
  return (
    <PreviewDialog title="Levels" deps={[params]}
      apply={() => adj.levelsMulti(packLevels(params[0]), packLevels(params[1]), packLevels(params[2]), packLevels(params[3]))}>
      <ToneToolbar armed={armed} setArmed={setArmed} targets={targets} setTargets={setTargets} onAuto={runAuto}
        optionsOpen={optionsOpen} setOptionsOpen={setOptionsOpen} onLoad={() => void load()} ext="alv"
        onSave={() => downloadBytes("levels.alv", encodeAlv(params), "application/octet-stream")} />
      {optionsOpen && <AutoOptionsPanel opts={auto} setOpts={setAuto} />}
      {msg && <div style={{ fontSize: 10, color: "var(--warn, #e0a020)", marginBottom: 6 }}>{msg}</div>}
      {armed && <DropperPreview image={snapshot} armed={armed}
        onSample={(px) => setParams((prev) => levelsFromDropper(prev, armed, px, targets[armed]))} />}
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 60 }}>Channel</span>
        <Select id="mv-levels-channel" value={String(ch)} aria-label="Channel" style={{ flex: 1 }}
          onChange={(v) => setCh(+v)}
          options={LEVELS_CHANNELS.map((c) => ({ value: String(c.value), label: c.label }))} />
      </div>
      <AdjustmentHistogram channel={TONE_HIST_CHANNELS[ch]} height={64} />
      <Row label="Input black" value={p.ib} min={0} max={254} onChange={(v) => set({ ib: v })} />
      <Row label="Gamma" value={p.gamma} min={0.1} max={3} decimals={2} onChange={(v) => set({ gamma: v })} />
      <Row label="Input white" value={p.iw} min={1} max={255} onChange={(v) => set({ iw: v })} />
      <div style={{ height: 8 }} />
      <Row label="Output black" value={p.ob} min={0} max={255} onChange={(v) => set({ ob: v })} />
      <Row label="Output white" value={p.ow} min={0} max={255} onChange={(v) => set({ ow: v })} />
    </PreviewDialog>
  );
}

// A fresh identity-diagonal point set (one per channel; switching channels keeps
// each channel's own edits, as Photoshop does).
const diagonalPoints = (): CurvePoint[] => [
  { id: "lo", x: 0, y: 0 }, { id: "mid", x: 0.5, y: 0.5 }, { id: "hi", x: 1, y: 1 },
];

/** Which point a CurveEditor change touched: the moved one, else the new one. */
function changedPointId(prev: readonly CurvePoint[], next: readonly CurvePoint[]): string | null {
  for (const n of next) {
    const was = prev.find((p) => p.id === n.id);
    if (!was) return n.id;
    if (was.x !== n.x || was.y !== n.y) return n.id;
  }
  return null;
}

function Curves() {
  const [ch, setCh] = useState(0); // 0=RGB(master), 1=R, 2=G, 3=B
  const [ptsByCh, setPtsByCh] = useState<CurvePoint[][]>(() =>
    [diagonalPoints(), diagonalPoints(), diagonalPoints(), diagonalPoints()]);
  const [selId, setSelId] = useState<string | null>("mid");
  const [armed, setArmed] = useState<DropperKind | null>(null);
  const [targets, setTargets] = useState<Record<DropperKind, ToneRgb>>({ ...DEFAULT_TARGETS });
  const [auto, setAuto] = useState<AutoOptions>(DEFAULT_AUTO_OPTIONS);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [showClipping, setShowClipping] = useState(false);
  const [pencil, setPencil] = useState(false);
  const [msg, setMsg] = useState("");
  const snapshot = useDocSnapshot();
  const strokeRef = useRef<{ x: number; y: number }[] | null>(null);
  const pts = ptsByCh[ch];
  const setActivePts = (next: CurvePoint[]) =>
    setPtsByCh((prev) => prev.map((p, i) => (i === ch ? next : p)));
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  const sel = sorted.find((p) => p.id === selId) ?? sorted[Math.min(1, sorted.length - 1)] ?? null;
  const selIndex = sel ? sorted.indexOf(sel) : -1;
  const runAuto = () => { if (snapshot) setPtsByCh(autoCurvePoints(channelHistograms(snapshot.data), { ...auto, targets })); };
  const load = async () => {
    const bytes = await pickLocalFileBytes([{ name: "Photoshop Curves", extensions: ["acv"] }], PRESET_LIMIT);
    if (!bytes) return;
    const loaded = decodeAcv(bytes);
    if (loaded) { setPtsByCh(loaded); setMsg(""); } else setMsg("Not a Photoshop Curves (.acv) file");
  };
  const clip = showClipping && snapshot ? clippingMask(snapshot.data, buildCurveLuts(ptsByCh)) : null;
  // Pencil: a stroke over the grid is sampled into points on release.
  const strokePoint = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height };
  };
  return (
    <PreviewDialog title="Curves" width={340} deps={[ptsByCh]}
      apply={() => { const l = buildCurveLuts(ptsByCh); adj.curves(l.master, l.r, l.g, l.b); }}>
      <ToneToolbar armed={armed} setArmed={setArmed} targets={targets} setTargets={setTargets} onAuto={runAuto}
        optionsOpen={optionsOpen} setOptionsOpen={setOptionsOpen} onLoad={() => void load()} ext="acv"
        onSave={() => downloadBytes("curves.acv", encodeAcv(ptsByCh), "application/octet-stream")} />
      {optionsOpen && <AutoOptionsPanel opts={auto} setOpts={setAuto} />}
      {msg && <div style={{ fontSize: 10, color: "var(--warn, #e0a020)", marginBottom: 6 }}>{msg}</div>}
      {(armed || showClipping) && <DropperPreview image={snapshot} armed={armed} clip={clip}
        onSample={(px) => setPtsByCh((prev) => curvesFromDropper(prev, armed!, px, targets[armed!]))} />}
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 60 }}>Channel</span>
        <Select id="mv-curves-channel" value={String(ch)} aria-label="Channel" style={{ flex: 1 }}
          onChange={(v) => { setCh(+v); setSelId(null); }}
          options={CURVE_CHANNELS.map((c) => ({ value: String(c.value), label: c.label }))} />
        <Button size="sm" variant={pencil ? "primary" : "ghost"} aria-pressed={pencil} data-mv-curves-pencil
          title="Pencil: draw the curve freehand" onClick={() => setPencil(!pencil)}>✎</Button>
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 8px" }}>
        <div style={{ position: "relative", width: 256, height: 256 }}>
          <AdjustmentHistogram channel={TONE_HIST_CHANNELS[ch]} height={256} behind />
          {/* positioned so it paints over the absolute backdrop */}
          <div style={{ position: "relative" }}>
            <CurveEditor points={pts} width={256} height={256} accent={CURVE_CH_ACCENT[ch]}
              onChange={(next) => { const id = changedPointId(pts, next); if (id) setSelId(id); setActivePts(next); }}
              xRange={[0, 255]} yRange={[0, 255]} aria-label="Tone curve" />
          </div>
          {pencil && (
            <div data-mv-curves-pencil-surface role="application" aria-label="Draw the curve"
              style={{ position: "absolute", inset: 0, cursor: "crosshair", touchAction: "none" }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); strokeRef.current = [strokePoint(e)]; }}
              onPointerMove={(e) => { if (strokeRef.current) strokeRef.current.push(strokePoint(e)); }}
              onPointerUp={() => {
                const stroke = strokeRef.current;
                strokeRef.current = null;
                if (!stroke) return;
                const drawn = pencilPoints(stroke, `pen${ch}`);
                if (drawn.length >= 2) { setActivePts(drawn); setSelId(null); }
              }} />
          )}
        </div>
      </div>
      <div className="monet-row" style={{ gap: 6, marginBottom: 6, alignItems: "center", fontSize: 11 }}>
        <button aria-label="Previous point" disabled={selIndex <= 0} onClick={() => setSelId(sorted[selIndex - 1].id)}
          style={{ width: 20, height: 20, border: "none", background: "transparent", color: "var(--text-2)", cursor: "pointer", padding: 0 }}>◂</button>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>Input
          <input type="number" min={0} max={255} aria-label="Point input" disabled={!sel} data-mv-curves-input
            value={sel ? Math.round(sel.x * 255) : ""} style={{ ...INP_BASE, width: 54 }}
            onChange={(e) => { if (sel) setActivePts(setCurvePointValue(pts, sel.id, "x", Number(e.currentTarget.value))); }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>Output
          <input type="number" min={0} max={255} aria-label="Point output" disabled={!sel} data-mv-curves-output
            value={sel ? Math.round(sel.y * 255) : ""} style={{ ...INP_BASE, width: 54 }}
            onChange={(e) => { if (sel) setActivePts(setCurvePointValue(pts, sel.id, "y", Number(e.currentTarget.value))); }} />
        </label>
        <button aria-label="Next point" disabled={selIndex < 0 || selIndex >= sorted.length - 1} onClick={() => setSelId(sorted[selIndex + 1].id)}
          style={{ width: 20, height: 20, border: "none", background: "transparent", color: "var(--text-2)", cursor: "pointer", padding: 0 }}>▸</button>
        <span style={{ flex: 1 }} />
        <Checkbox checked={showClipping} aria-label="Show Clipping" onChange={setShowClipping}>Show Clipping</Checkbox>
      </div>
      <div className="monet-section-label">Drag to add points · double-click to remove</div>
    </PreviewDialog>
  );
}

export function HueSaturationControls({ state, onChange, onChangeEnd }: {
  state: HueSaturationState;
  onChange: (state: HueSaturationState) => void;
  onChangeEnd?: () => void;
}) {
  const [band, setBand] = useState(-1);
  const colorize = !!state.colorize;
  const activeBand = colorize ? -1 : band;
  const range = activeBand >= 0 ? state.ranges?.[activeBand] ?? [0, 0, 0] : null;
  const value = (slot: 0 | 1 | 2) => range ? range[slot] : slot === 0 ? state.hue : slot === 1 ? state.saturation : state.lightness;
  const update = (slot: 0 | 1 | 2, next: number) => {
    if (!range) {
      const key = (["hue", "saturation", "lightness"] as const)[slot];
      onChange({ ...state, [key]: next });
      return;
    }
    const ranges = (state.ranges ?? HS_RANGES.map(() => [0, 0, 0])).map((entry) => [...entry]);
    ranges[activeBand][slot] = next;
    onChange({ ...state, ranges });
  };
  return (
    <>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 96 }}>Edit</span>
        <Select aria-label="Hue range" value={String(activeBand)} disabled={colorize} onChange={(v) => setBand(Number(v))} style={{ flex: 1 }}
          options={[{ value: "-1", label: "Master" }, ...HS_RANGES.map((name, i) => ({ value: String(i), label: name }))]} />
      </div>
      <Row label="Hue" value={value(0)} min={colorize ? COLORIZE_HUE_MIN : HUE_MIN} max={colorize ? COLORIZE_HUE_MAX : HUE_MAX} onChange={(v) => update(0, v)} onChangeEnd={onChangeEnd} suffix="°" />
      <Row label="Saturation" value={value(1)} min={colorize ? COLORIZE_SAT_MIN : SAT_MIN} max={colorize ? COLORIZE_SAT_MAX : SAT_MAX} onChange={(v) => update(1, v)} onChangeEnd={onChangeEnd} />
      <Row label="Lightness" value={value(2)} min={LIGHT_MIN} max={LIGHT_MAX} onChange={(v) => update(2, v)} onChangeEnd={onChangeEnd} />
      <Checkbox checked={colorize} aria-label="Colorize" onChange={(checked) => {
        if (checked) setBand(-1);
        const hue = checked
          ? ((state.hue % 360) + 360) % 360
          : state.hue > 180 ? state.hue - 360 : state.hue;
        onChange({ ...state, colorize: checked, hue, saturation: checked ? Math.max(0, state.saturation) : state.saturation });
        onChangeEnd?.();
      }}>Colorize</Checkbox>
    </>
  );
}

function HueSaturation() {
  const [state, setState] = useState<HueSaturationState>(defaultHueSaturation);
  return (
    <PreviewDialog title="Hue / Saturation" width={440} deps={[state]} apply={() => adj.hueSaturationParams(packHueSaturation(state))}>
      <HueSaturationControls state={state} onChange={setState} />
    </PreviewDialog>
  );
}

function HueSaturationAdjLayer() {
  const { close, arg } = useDialogs();
  const edit = layerContentArg(arg, LAYER_KIND.adjustment, 2);
  const [state, setState] = useState(() => unpackHueSaturation(edit?.params ?? packHueSaturation(defaultHueSaturation())));
  const scratch = useScratchAdjustmentLayer(
    () => store.addAdjustmentLayer(2, packHueSaturation(state), "Hue/Saturation"),
    edit?.layerId,
  );
  const update = (next: HueSaturationState) => {
    setState(next);
    scratch.applyParams(packHueSaturation(next));
  };
  const cancel = () => scratch.cancel(close);
  return (
    <Dialog open onClose={cancel} title="Hue/Saturation — Adjustment Layer" width={440}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" onClick={() => scratch.finish(close)}>OK</Button></>}>
      <HueSaturationControls state={state} onChange={update} />
    </Dialog>
  );
}

function BlackWhiteControls({ state, onChange }: { state: BlackWhiteState; onChange: (state: BlackWhiteState) => void }) {
  const preset = blackWhitePresetName(state);
  const setBand = (index: number, value: number) => {
    const bands = [...state.bands];
    bands[index] = value;
    onChange({ ...state, bands });
  };
  return (
    <>
      <div className="monet-row" style={{ gap: 8, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 96 }}>Preset</span>
        <Select aria-label="Black & White preset" value={preset} onChange={(v) => onChange(applyBlackWhitePreset(state, v))} style={{ flex: 1 }}
          options={[...(preset === "Custom" ? [{ value: "Custom" }] : []), ...BLACK_WHITE_PRESETS.map((entry) => ({ value: entry.name }))]} />
        <Button size="sm" variant="ghost" onClick={() => onChange(autoBlackWhite(state))}>Auto</Button>
      </div>
      {BLACK_WHITE_BANDS.map((name, i) => (
        <Row key={name} label={name} value={state.bands[i] ?? 0} min={BLACK_WHITE_MIN} max={BLACK_WHITE_MAX} onChange={(value) => setBand(i, value)} />
      ))}
      <Checkbox checked={state.tint} aria-label="Tint" onChange={(tint) => onChange({ ...state, tint })}>Tint</Checkbox>
      {state.tint && <>
        <Row label="Tint Hue" value={state.tintHue} min={0} max={360} onChange={(tintHue) => onChange({ ...state, tintHue })} suffix="°" />
        <Row label="Tint Saturation" value={state.tintSaturation} min={0} max={100} onChange={(tintSaturation) => onChange({ ...state, tintSaturation })} />
      </>}
    </>
  );
}

function BlackWhite() {
  const [state, setState] = useState<BlackWhiteState>(defaultBlackWhite);
  return (
    <PreviewDialog title="Black & White" width={440} deps={[state]} apply={() => adj.blackWhiteParams(packBlackWhite(state))}>
      <BlackWhiteControls state={state} onChange={setState} />
    </PreviewDialog>
  );
}

function BlackWhiteAdjLayer() {
  const { close, arg } = useDialogs();
  const edit = layerContentArg(arg, LAYER_KIND.adjustment, 6);
  const [state, setState] = useState(() => unpackBlackWhite(edit?.params ?? packBlackWhite(defaultBlackWhite())));
  const scratch = useScratchAdjustmentLayer(
    () => store.addAdjustmentLayer(6, packBlackWhite(state), "Black & White"),
    edit?.layerId,
  );
  const update = (next: BlackWhiteState) => {
    setState(next);
    scratch.applyParams(packBlackWhite(next));
  };
  const cancel = () => scratch.cancel(close);
  return (
    <Dialog open onClose={cancel} title="Black & White — Adjustment Layer" width={440}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" onClick={() => scratch.finish(close)}>OK</Button></>}>
      <BlackWhiteControls state={state} onChange={update} />
    </Dialog>
  );
}

function Exposure() {
  const [state, setState] = useState<ExposureState>(defaultExposure);
  const set = (patch: Partial<ExposureState>) => setState((s) => ({ ...s, ...patch }));
  return (
    <PreviewDialog title="Exposure" deps={[state]} apply={() => adj.exposure(state.exposure, state.offset, state.gamma)}>
      <Row label="Exposure" value={state.exposure} min={EXPOSURE_MIN} max={EXPOSURE_MAX} decimals={2} onChange={(v) => set({ exposure: v })} />
      <Row label="Offset" value={state.offset} min={OFFSET_MIN} max={OFFSET_MAX} decimals={3} onChange={(v) => set({ offset: v })} />
      <Row label="Gamma" value={state.gamma} min={GAMMA_MIN} max={GAMMA_MAX} decimals={2} onChange={(v) => set({ gamma: v })} />
    </PreviewDialog>
  );
}

function Vibrance() {
  const [state, setState] = useState<VibranceState>(defaultVibrance);
  const set = (patch: Partial<VibranceState>) => setState((s) => ({ ...s, ...patch }));
  return (
    <PreviewDialog title="Vibrance" deps={[state]} apply={() => adj.vibrance(...vibranceArgs(state))}>
      <Row label="Vibrance" value={state.vibrance} min={VIBRANCE_MIN} max={VIBRANCE_MAX} onChange={(v) => set({ vibrance: v })} />
      <Row label="Saturation" value={state.saturation} min={SATURATION_MIN} max={SATURATION_MAX} onChange={(v) => set({ saturation: v })} />
    </PreviewDialog>
  );
}

function ColorBalanceDialog() {
  const [state, setState] = useState<ColorBalanceState>(defaultColorBalance);
  const triad = (range: ToneRange, label: string) => {
    const t = state[range];
    return (
      <div style={{ marginBottom: 6 }}>
        <div className="monet-section-label">{label}</div>
        {COLOR_BALANCE_AXES.map((ax) => (
          <Row key={ax.key} label={`${ax.negative}–${ax.positive}`} value={t[ax.key]} min={BALANCE_MIN} max={BALANCE_MAX}
            onChange={(v) => setState((cur) => setBalance(cur, range, ax.key, Math.round(v)))} />
        ))}
      </div>
    );
  };
  return (
    <PreviewDialog title="Color Balance" width={420} deps={[state]}
      apply={() => { const p = packColorBalanceTriads(state); adj.colorBalance(p.sh, p.mid, p.hi, state.preserveLuminosity); }}>
      {triad("shadows", "Shadows")}
      {triad("midtones", "Midtones")}
      {triad("highlights", "Highlights")}
      <div className="monet-row" style={{ marginTop: 4 }}>
        <Checkbox checked={state.preserveLuminosity} onChange={(v) => setState((cur) => ({ ...cur, preserveLuminosity: v }))}>Preserve Luminosity</Checkbox>
      </div>
    </PreviewDialog>
  );
}

const PF_CUSTOM = "Custom";
function PhotoFilterDialog() {
  const [state, setState] = useState<PhotoFilterState>(defaultPhotoFilter);
  const hexOf = (c: PhotoFilterColor) =>
    `#${[c.r, c.g, c.b].map((x) => Math.max(0, Math.min(255, x | 0)).toString(16).padStart(2, "0")).join("")}`;
  // The dropdown reflects the matching preset, or "Custom" once the swatch is edited.
  const currentName =
    PHOTO_FILTER_PRESETS.find((p) => p.color.r === state.color.r && p.color.g === state.color.g && p.color.b === state.color.b)?.name ?? PF_CUSTOM;
  const options = [...PHOTO_FILTER_PRESETS.map((p) => ({ value: p.name, label: p.name })), { value: PF_CUSTOM, label: "Custom" }];
  return (
    <PreviewDialog title="Photo Filter" width={420} deps={[state]}
      apply={() => { const [r, g, b] = normalizedColor(state.color); adj.photoFilter(r, g, b, densityFraction(state.density), state.preserveLuminosity); }}>
      <div className="monet-row" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
        <span className="lbl" style={{ width: 56 }}>Filter</span>
        <Select value={currentName} options={options}
          onChange={(v) => { const p = photoFilterPreset(v); if (p) setState((s) => ({ ...s, color: { ...p.color } })); }} />
        <input type="color" aria-label="Filter color" value={hexOf(state.color)}
          onChange={(e) => { const n = parseInt(e.target.value.slice(1), 16); setState((s) => ({ ...s, color: { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 } })); }}
          style={{ width: 28, height: 22, padding: 0, border: "none", background: "none" }} />
      </div>
      <Row label="Density" value={state.density} min={0} max={100} onChange={(v) => setState((s) => ({ ...s, density: Math.round(v) }))} suffix="%" />
      <div className="monet-row" style={{ marginTop: 8 }}>
        <Checkbox checked={state.preserveLuminosity} onChange={(v) => setState((s) => ({ ...s, preserveLuminosity: v }))}>Preserve Luminosity</Checkbox>
      </div>
    </PreviewDialog>
  );
}

function ShadowsHighlights() {
  // Reopens with the last OK'd values (SHADOWS_HIGHLIGHTS_DEFAULTS the first
  // time): Show More Options' Radius per band (px) and Black/White Clip (%)
  // included.
  const [remembered] = useState(loadShadowsHighlightsPrefs);
  const [sa, setSa] = useState(remembered.shadowsAmount); const [sw, setSw] = useState(remembered.shadowsWidth);
  const [ha, setHa] = useState(remembered.highlightsAmount); const [hw, setHw] = useState(remembered.highlightsWidth);
  const [color, setColor] = useState(remembered.color); const [midtone, setMidtone] = useState(remembered.midtone);
  const [sr, setSr] = useState(remembered.shadowsRadius); const [hr, setHr] = useState(remembered.highlightsRadius);
  const [blackClip, setBlackClip] = useState(remembered.blackClip); const [whiteClip, setWhiteClip] = useState(remembered.whiteClip);
  return (
    <PreviewDialog title="Shadows / Highlights" width={420} deps={[sa, sw, ha, hw, color, midtone, sr, hr, blackClip, whiteClip]}
      apply={() => adj.shadowsHighlights(sa / 100, sw / 100, ha / 100, hw / 100, color / 100, midtone / 200, sr, hr, blackClip / 100, whiteClip / 100)}
      onOk={() => saveShadowsHighlightsPrefs({
        shadowsAmount: sa, shadowsWidth: sw, shadowsRadius: sr, highlightsAmount: ha, highlightsWidth: hw, highlightsRadius: hr,
        color, midtone, blackClip, whiteClip,
      })}>
      <div className="monet-section-label">Shadows</div>
      <Row label="Amount" value={sa} min={0} max={100} onChange={setSa} suffix="%" />
      <Row label="Tonal Width" value={sw} min={1} max={100} onChange={setSw} suffix="%" />
      <Row label="Radius" value={sr} min={0} max={2500} onChange={setSr} suffix="px" />
      <div className="monet-section-label">Highlights</div>
      <Row label="Amount" value={ha} min={0} max={100} onChange={setHa} suffix="%" />
      <Row label="Tonal Width" value={hw} min={1} max={100} onChange={setHw} suffix="%" />
      <Row label="Radius" value={hr} min={0} max={2500} onChange={setHr} suffix="px" />
      <div className="monet-section-label">Adjustments</div>
      <Row label="Color" value={color} min={-100} max={100} onChange={setColor} suffix="%" />
      <Row label="Midtone" value={midtone} min={-100} max={100} onChange={setMidtone} suffix="%" />
      <Row label="Black Clip" value={blackClip} min={0} max={50} decimals={2} onChange={setBlackClip} suffix="%" />
      <Row label="White Clip" value={whiteClip} min={0} max={50} decimals={2} onChange={setWhiteClip} suffix="%" />
    </PreviewDialog>
  );
}

// A stable, lightweight per-filter swatch gradient (hash the id → two hues), so
// the picker reads like Photoshop's thumbnail grid without a per-filter render.
function gallerySwatch(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 40 + ((h >> 8) % 140)) % 360;
  return `linear-gradient(135deg, hsl(${a} 68% 56%), hsl(${b} 70% 34%))`;
}

// Filter Gallery preview pane geometry. The pane image is a `docThumbUrl`
// snapshot of the previewed composite, CSS-sized to `docW × zoom` inside a
// fixed scrolling box (native overflow gives the panning Photoshop's pane has).
const GALLERY_PANE_W = 208;
const GALLERY_PANE_H = 300;
// ponytail: the snapshot is regenerated at the zoom's pixel size but capped —
// past this a toDataURL of a full-size document costs more than the pane is
// worth, so deep zooms interpolate. Raise (or switch to a tiled crop render)
// if 1:1 pixel-peeping in the dialog ever matters.
const GALLERY_PANE_SRC_CAP = 1400;

// Filter Gallery — Photoshop's three classic regions: a zoomable preview pane
// (which mirrors the live document preview behind the dialog), a category/
// thumbnail picker, and a stacked, reorderable effect list (eye toggle, new
// effect layer, move up/down, delete) with the selected effect's parameter
// sliders. Apply composes the whole visible stack in order as ONE undoable
// history step (see commitGalleryStack).
function FilterGallery() {
  const { close } = useDialogs();
  const activeDocId = useStore((s) => s.activeDocId);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const targetDocId = useRef(activeDocId).current;
  const targetLayerId = useRef(activeLayerId).current;
  const targetEngine = useRef(engine.e as HistoryTransactionEngine).current;
  const [stack, setStack] = useState<GalleryEffect[]>([]);
  const [selected, setSelected] = useState(-1);
  const [cat, setCat] = useState<GalleryCategory>("Artistic");
  const docW = engine.width, docH = engine.height;
  // Fit, never past 100% — the snapshot is 1:1 at most, so upscaling only blurs.
  const fit = Math.min(1, fitZoom(GALLERY_PANE_W, GALLERY_PANE_H, docW, docH, 1));
  const [zoom, setZoom] = useState(fit);
  const [previewRev, setPreviewRev] = useState(0); // bumped when a preview settles

  const stackRef = useRef(stack);
  stackRef.current = stack;
  const transactionRef = useRef(false);
  const rafRef = useRef(0);
  const settleRef = useRef<ReturnType<typeof setTimeout> | 0>(0);

  const onTarget = () => engine.engine === targetEngine
    && store.state.activeDocId === targetDocId && store.state.activeLayerId === targetLayerId;
  const cancelPreview = () => {
    revertGalleryStack(transactionRef.current, targetEngine);
    transactionRef.current = false;
  };
  const previewNow = () => {
    if (!onTarget()) { cancelPreview(); return; }
    transactionRef.current = previewGalleryStack(stackRef.current, transactionRef.current);
  };
  const clearPending = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (settleRef.current) { clearTimeout(settleRef.current); settleRef.current = 0; }
  };

  // Re-preview on any stack/param change, coalesced to one op + blit per frame
  // with the costly full UI sync deferred until edits settle (mirrors
  // PreviewDialog, generalized to N filters).
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (settleRef.current) clearTimeout(settleRef.current);
    if (!onTarget()) { cancelPreview(); return; }
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; previewNow(); });
    settleRef.current = setTimeout(() => {
      settleRef.current = 0;
      engine.sync();
      setPreviewRev((r) => r + 1); // refresh the pane snapshot off the settled composite
    }, 140);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack, activeDocId, activeLayerId]);

  // Snapshot the previewed composite at the pane's current pixel size (capped).
  const srcCap = Math.max(1, Math.min(GALLERY_PANE_SRC_CAP, Math.round(Math.max(docW, docH) * zoom)));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- previewRev is the cache key (docThumbUrl reads live engine state)
  const previewUrl = useMemo(() => (engine.engine && docW && docH ? engine.docThumbUrl(engine.e, srcCap, srcCap) : ""), [previewRev, srcCap]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (settleRef.current) clearTimeout(settleRef.current);
    engine.syncSuspended = false;
    cancelPreview();
    // The captured target and mutable refs intentionally belong to this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () => {
    clearPending();
    engine.syncSuspended = false;
    cancelPreview();
    close();
  };
  const ok = () => {
    if (!onTarget()) { cancel(); return; }
    const pending = rafRef.current !== 0;
    clearPending();
    if (pending) previewNow();
    engine.syncSuspended = false;
    // Cancel the temporary preview branch, then commit the composed stack as one
    // fresh transaction so action replay owns the same self-contained lifecycle.
    cancelPreview();
    if (composeOrder(stackRef.current).length > 0) commitGalleryStack(stackRef.current);
    close();
  };

  const add = (id: string) => { const at = stackRef.current.length; setStack((s) => addEffect(s, id)); setSelected(at); };
  // Photoshop's "New effect layer": duplicate the selected effect above itself.
  const dup = () => { if (selected < 0) return; setStack((s) => duplicateEffect(s, selected)); setSelected(selected + 1); };
  const toggle = (i: number) => setStack((s) => toggleEffect(s, i));
  // Every row carries its own ↑/↓/✕, so `i` is rarely the selected row: the
  // selection has to follow the effect it points at, or the param sliders
  // silently start editing a different filter. (#98)
  const move = (i: number, dir: number) => {
    setStack((s) => moveEffect(s, i, dir));
    const to = Math.max(0, Math.min(stack.length - 1, i + dir));
    if (selected === i) setSelected(to);
    else if (selected === to) setSelected(i); // the row swapped into i's slot
  };
  const del = (i: number) => {
    setStack((s) => removeEffect(s, i));
    setSelected((sel) => (i < sel ? sel - 1 : Math.min(sel, stack.length - 2)));
  };
  const setParam = (i: number, p: number, val: number) =>
    setStack((s) => setEffectValues(s, i, s[i].values.map((v, k) => (k === p ? val : v))));

  const selDef = selected >= 0 && selected < stack.length ? filterDef(stack[selected].id) : undefined;

  return (
    <Dialog open onClose={cancel} title="Filter Gallery" width={880}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" onClick={ok}>OK</Button></>}>
      <div style={{ display: "flex", gap: 14, minHeight: 360 }}>
        {/* Region 1 — the zoomable preview pane (the document canvas also previews live). */}
        <div style={{ width: GALLERY_PANE_W, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="monet-section-label">Preview</div>
          <div style={{ width: GALLERY_PANE_W, height: GALLERY_PANE_H, borderRadius: 8, border: "1px solid var(--stroke-2)", overflow: "auto", background: "var(--surface-2, rgba(0,0,0,0.2))", display: "grid", placeItems: "center" }}>
            {previewUrl ? (
              <img src={previewUrl} alt="Filter Gallery preview" data-mv-gallery-preview
                style={{ width: Math.max(1, Math.round(docW * zoom)), display: "block" }} />
            ) : (
              <span style={{ color: "var(--text-3)", fontSize: 11, padding: 8, textAlign: "center" }}>No document to preview</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button type="button" aria-label="Zoom out" title="Zoom out" data-mv-gallery-zoom-out
              onClick={() => setZoom((z) => clampZoom(z / 1.25))} style={INP_BASE_BTN}>−</button>
            <button type="button" aria-label="Zoom in" title="Zoom in" data-mv-gallery-zoom-in
              onClick={() => setZoom((z) => clampZoom(z * 1.25))} style={INP_BASE_BTN}>+</button>
            <button type="button" aria-label="Fit preview in view" title="Fit in view" data-mv-gallery-zoom-fit
              onClick={() => setZoom(fit)} style={{ ...INP_BASE_BTN, width: "auto", padding: "0 6px" }}>Fit</button>
            <span data-mv-gallery-zoom style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 10 }}>{Math.round(zoom * 100)}%</span>
          </div>
          <div style={{ color: "var(--text-3)", fontSize: 10 }}>Updates live on the canvas too.</div>
        </div>

        {/* Region 2 — category + thumbnail picker. */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <Select value={cat} onChange={(v) => setCat(v as GalleryCategory)}
            options={GALLERY_CATEGORIES.map((c) => ({ value: c, label: c }))} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, overflowY: "auto", alignContent: "start", maxHeight: 320, paddingRight: 2 }}>
            {filtersInCategory(cat).map((d) => (
              <button key={d.id} type="button" data-mv-gallery-add={d.id} aria-label={`Add ${d.name}`} title={`Add ${d.name}`}
                onClick={() => add(d.id)}
                style={{ height: 64, borderRadius: 8, border: "1px solid var(--stroke-2)", padding: 0, cursor: "pointer", position: "relative", overflow: "hidden", background: gallerySwatch(d.id) }}>
                <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "4px 6px", fontSize: 11, color: "#fff", textAlign: "left", background: "linear-gradient(transparent, rgba(0,0,0,.55))", textShadow: "0 1px 2px rgba(0,0,0,.7)" }}>{d.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Region 3 — the stacked effect list + selected params. */}
        <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div className="monet-section-label" style={{ flex: 1 }}>Effects</div>
            <button type="button" aria-label="New effect layer" title="New effect layer (duplicate the selected effect)"
              data-mv-gallery-dup disabled={selected < 0 || selected >= stack.length} onClick={dup} style={INP_BASE_BTN}>⧉</button>
          </div>
          <div data-mv-gallery-stack style={{ border: "1px solid var(--stroke-2)", borderRadius: 8, maxHeight: 150, overflowY: "auto" }}>
            {stack.length === 0 && <div style={{ padding: 10, color: "var(--text-3)", fontSize: 11 }}>No effects yet — click a thumbnail to add one.</div>}
            {stack.map((e, i) => (
              <div key={i} data-mv-gallery-effect={i} onClick={() => setSelected(i)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", cursor: "pointer", background: i === selected ? "var(--surface-2, rgba(255,255,255,0.06))" : "transparent", borderBottom: "1px solid var(--stroke-2)" }}>
                <input type="checkbox" checked={e.visible} aria-label={`Toggle ${filterDef(e.id)?.name}`} data-mv-gallery-eye={i}
                  onClick={(ev) => ev.stopPropagation()} onChange={() => toggle(i)} />
                <span style={{ flex: 1, fontSize: 12, opacity: e.visible ? 1 : 0.45, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{filterDef(e.id)?.name}</span>
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={(ev) => { ev.stopPropagation(); move(i, -1); }} style={INP_BASE_BTN}>↑</button>
                <button type="button" aria-label="Move down" disabled={i === stack.length - 1} onClick={(ev) => { ev.stopPropagation(); move(i, 1); }} style={INP_BASE_BTN}>↓</button>
                <button type="button" aria-label="Delete effect" data-mv-gallery-del={i} onClick={(ev) => { ev.stopPropagation(); del(i); }} style={INP_BASE_BTN}>✕</button>
              </div>
            ))}
          </div>
          <div style={{ flex: 1 }}>
            {selDef ? (
              <>
                <div className="monet-section-label">{selDef.name}</div>
                {selDef.params.map((p, pi) => p.options ? (
                  <div key={p.key} className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
                    <span className="lbl" style={{ width: 110 }}>{p.label}</span>
                    <Select aria-label={p.label} value={String(stack[selected].values[pi])}
                      onChange={(v) => setParam(selected, pi, +v)}
                      options={p.options.map((label, i) => ({ value: String(p.min + i), label }))} />
                  </div>
                ) : (
                  <Row key={p.key} label={p.label} value={stack[selected].values[pi]} min={p.min} max={p.max}
                    suffix={p.suffix ?? ""} decimals={p.step && p.step < 1 ? 2 : 0} step={p.step}
                    onChange={(v) => setParam(selected, pi, v)} />
                ))}
              </>
            ) : (
              <div style={{ color: "var(--text-3)", fontSize: 11, paddingTop: 4 }}>Select an effect to edit its parameters.</div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
const INP_BASE_BTN: CSSProperties = { width: 22, height: 22, borderRadius: 4, border: "1px solid var(--stroke-2)", background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-1)", cursor: "pointer", fontSize: 11, padding: 0 };
function ScaleEffects() {
  const { close } = useDialogs();
  const activeDocId = useStore((s) => s.activeDocId);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const targetDocId = useRef(activeDocId).current;
  const id = useRef(activeLayerId).current;
  const targetEngine = useRef(engine.e).current;
  const wrongTarget = activeDocId !== targetDocId || activeLayerId !== id || engine.engine !== targetEngine;
  const [scale, setScale] = useState(100);
  const apply = () => {
    if (store.state.activeDocId !== targetDocId || store.state.activeLayerId !== id || engine.engine !== targetEngine) return;
    store.scaleEffects(scale);
    close();
  };
  return (
    <Dialog open onClose={close} title="Scale Effects" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={wrongTarget} onClick={apply}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 56 }}>Scale</span>
        <NumberField value={scale} min={10} max={1000} onChange={setScale} suffix="%" />
      </div>
    </Dialog>
  );
}
function GlobalLight() {
  const { close } = useDialogs();
  const activeDocId = useStore((s) => s.activeDocId);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const targetDocId = useRef(activeDocId).current;
  const id = useRef(activeLayerId).current;
  const targetEngine = useRef(engine.e).current;
  const wrongTarget = activeDocId !== targetDocId || activeLayerId !== id || engine.engine !== targetEngine;
  const cur = (() => {
    for (const d of FX_DEFS) {
      const f = d.fields.find((x) => x.k === "angle");
      const p = store.effectParams(id, d.id);
      if (f && p.length > f.i) return p[f.i];
    }
    return 120;
  })();
  const [angle, setAngle] = useState(cur);
  const apply = () => {
    if (store.state.activeDocId !== targetDocId || store.state.activeLayerId !== id || engine.engine !== targetEngine) return;
    store.setGlobalLight(angle);
    close();
  };
  return (
    <Dialog open onClose={close} title="Global Light" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={wrongTarget} onClick={apply}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 56 }}>Angle</span>
        <NumberField value={angle} min={0} max={360} onChange={setAngle} suffix="°" />
      </div>
      <div className="lbl" style={{ marginTop: 8, color: "var(--text-3)", fontSize: 11 }}>Sets the light angle on the active layer's shadow/bevel effects.</div>
    </Dialog>
  );
}
const PREF_SECTIONS = ["General", "Interface", "Workspace", "Tools", "History Log", "File Handling", "Export", "Content Credentials", "AI Models", "Performance", "Scratch Disks", "Cursors", "Transparency & Gamut", "Units & Rulers", "Guides, Grid & Slices", "Plug-Ins", "Type", "Technology Previews", "Product Improvement", "Camera Raw"];

// Preferences ▸ AI Models — install summary + a jump to the Model Manager.
function AiModelsPrefs() {
  const { open } = useDialogs();
  const [drunet, setDrunet] = useState<boolean | null>(null);
  const [migan, setMigan] = useState<boolean | null>(null);
  const [sd, setSd] = useState<"real" | "demo" | "missing" | null>(null);
  useEffect(() => {
    let live = true;
    void models.drunetInstalled().then((v) => { if (live) setDrunet(v); });
    void models.miganInstalled().then((v) => { if (live) setMigan(v); });
    void models.sdStatus(false).then((v) => { if (live) setSd(v); });
    return () => { live = false; };
  }, []);
  const bundled = MODEL_REGISTRY.filter((d) => d.bundled).length;
  const installed = bundled + (drunet ? 1 : 0) + (migan ? 1 : 0) + (sd === "real" ? 1 : 0);
  const total = MODEL_REGISTRY.length;
  const dim: CSSProperties = { color: "var(--text-3)", fontSize: 11 };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <div style={{ fontWeight: 600 }} data-testid="mv-aimodels-count">AI Models — {installed} of {total} installed</div>
        <div style={dim}>
          {bundled} bundled · MI-GAN {migan ? "installed (local)" : "not shipped"} · AI Denoise {drunet ? "installed" : "not installed"} · Stable Diffusion 1.5 {sd === "real" ? "installed (local)" : sd === "demo" ? "local demo" : "not installed"}
        </div>
      </div>
      <div className="monet-row" style={{ gap: 8 }}>
        <Button variant="ghost" onClick={() => open("modelManager")}>Manage…</Button>
      </div>
    </div>
  );
}
// Preferences ▸ Content Credentials — the C2PA signer used by File ▸ Export ▸
// Content Credentials (Signed). Dev signer is self-signed (untrusted on Verify
// sites); users can import a CA-issued cert+key with an optional RFC-3161 TSA.
function ContentCredentialsPrefs() {
  const [info, setInfo] = useState<SignerInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cert, setCert] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [tsa, setTsa] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const native = isTauri();

  const refresh = async () => {
    try {
      setInfo(await contentCredentialsSigner());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    if (native) void refresh();
    else setLoaded(true);
  }, [native]);

  if (!native) {
    return <div style={{ color: "var(--text-3)" }}>Signing is desktop-only. Run the Monet Vision app to manage Content Credentials signers.</div>;
  }

  const pick = async (which: "cert" | "key") => {
    setError(null);
    try {
      const pem = await pickPemFile(which === "cert" ? "Select signing certificate" : "Select private key");
      if (pem === null) return;
      if (which === "cert") setCert(pem);
      else setKey(pem);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const apply = async () => {
    if (!cert || !key) return;
    setBusy(true);
    setError(null);
    try {
      const next = await importContentCredentialsSigner(cert, key, tsa);
      setInfo(next);
      setCert(null);
      setKey(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearContentCredentialsSigner();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dim: CSSProperties = { color: "var(--text-3)", fontSize: 11 };
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <div className="lbl" style={{ marginBottom: 4 }}>Active signer</div>
        {!loaded ? (
          <div style={dim}>Loading…</div>
        ) : info?.kind === "custom" ? (
          <div>
            <div style={{ fontWeight: 600 }}>{info.issuer || "Custom signer"}</div>
            <div style={dim}>
              Custom certificate · {info.alg?.toUpperCase() || "unknown alg"}
              {info.cert_serial ? ` · serial ${info.cert_serial}` : ""}
            </div>
            <div style={dim}>{info.tsa_url ? `Timestamps via ${info.tsa_url}` : "No timestamp authority"}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontWeight: 600 }}>Development — self-signed, not publicly trusted</div>
            <div style={dim}>
              Verify sites (contentcredentials.org/verify) will show an untrusted signer.
              {info?.alg ? ` ${info.alg.toUpperCase()}.` : ""} Import your own certificate to sign as a named identity.
            </div>
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--stroke-2)", paddingTop: 12, display: "grid", gap: 8 }}>
        <div className="lbl">Import a signing certificate</div>
        <div className="monet-row" style={{ gap: 8 }}>
          <Button variant="ghost" onClick={() => void pick("cert")} disabled={busy}>Import Certificate…</Button>
          <span style={dim}>{cert ? "certificate loaded" : "no certificate selected"}</span>
        </div>
        <div className="monet-row" style={{ gap: 8 }}>
          <Button variant="ghost" onClick={() => void pick("key")} disabled={busy}>Import Key…</Button>
          <span style={dim}>{key ? "private key loaded" : "no key selected"}</span>
        </div>
        <div className="monet-row" style={{ gap: 8, alignItems: "center" }}>
          <label className="lbl" htmlFor="mv-cc-tsa" style={{ width: 130 }}>Timestamp URL (optional)</label>
          <Input id="mv-cc-tsa" aria-label="Timestamp authority URL" value={tsa}
            onChange={(e) => setTsa(e.currentTarget.value)} placeholder="https://timestamp.example/tsa" block />
        </div>
        <div style={dim}>
          A private key is stored as an owner-only (0600) file in the app data folder. A timestamp URL sends a
          hash of the signature to that third-party authority when you export — leave it empty to keep signing local.
        </div>
        {error && <div role="alert" style={{ color: "var(--danger, #ff6b6b)", fontSize: 11 }}>{error}</div>}
        <div className="monet-row" style={{ gap: 8, marginTop: 2 }}>
          <Button variant="primary" onClick={() => void apply()} disabled={busy || !cert || !key}>
            {busy ? "Validating…" : "Use This Certificate"}
          </Button>
          {info?.kind === "custom" && (
            <Button variant="ghost" onClick={() => void remove()} disabled={busy}>Remove</Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Preferences ▸ Interface — theme + chrome density. Both are pure CSS the
// design system already ships (`data-theme` / `data-density` on :root); Vision
// simply had no way to reach them. Photoshop's remaining Interface options
// (UI scaling, per-screen-mode canvas colors) live outside the dialog layer.
function InterfacePrefs() {
  const [prefs, setPrefs] = useState(loadInterfacePrefs);
  const update = (patch: Partial<AppInterfacePrefs>) => {
    const next = saveInterfacePrefs(patch);
    applyInterfacePrefs(next, document.documentElement);
    setPrefs(next);
  };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 110 }}>Color Theme</span>
        <SegmentedControl aria-label="Color theme" value={prefs.theme}
          onChange={(value) => update({ theme: value as AppInterfacePrefs["theme"] })}
          items={THEMES.map((theme) => ({ value: theme, label: theme === "dark" ? "Dark" : "Light" }))} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 110 }}>UI Density</span>
        <SegmentedControl aria-label="UI density" value={prefs.density}
          onChange={(value) => update({ density: value as AppInterfacePrefs["density"] })}
          items={DENSITIES.map((density) => ({ value: density, label: density === "default" ? "Default" : "Compact" }))} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11 }}>
        Applies immediately to the whole window and is remembered between sessions.
        Compact tightens every chrome height (title bar, tool rail, panel tabs, status bar).
      </div>
    </div>
  );
}

// Preferences ▸ Units & Rulers — the unit the size dialogs open in. Photoshop
// also drives the on-canvas rulers and the Info panel from this; those still
// read pixels (they live in CanvasView / Panels, not in the dialog layer).
function UnitsRulersPrefs() {
  const [unit, setUnit] = useState<DocumentSizeUnit>(loadRulerUnit);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <label className="lbl" htmlFor="mv-pref-ruler-unit" style={{ width: 110 }}>Rulers</label>
        <Select id="mv-pref-ruler-unit" aria-label="Ruler units" value={unit}
          onChange={(value) => setUnit(saveRulerUnit(value))}
          options={DOCUMENT_SIZE_UNITS.map((candidate) => ({ value: candidate.value, label: candidate.label }))} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11 }}>
        Image Size and Canvas Size open in this unit; New Document keeps its preset's unit.
        Physical units convert through the document's print resolution, so a 300 ppi document
        measures in real inches.
      </div>
    </div>
  );
}

// Preferences ▸ File Handling — the open/new-document prefs Save for Web also
// edits, plus the recent-file list behind File ▸ Open Recent.
function FileHandlingPrefs() {
  const filePrefs = useStore((s) => s.filePrefs);
  const recentFiles = useStore((s) => s.recentFiles);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Checkbox id="mv-pref-open-jpeg-layer" checked={filePrefs.openJpegAsLayer}
        onChange={(enabled) => store.setFilePrefs({ openJpegAsLayer: enabled })}>
        Open JPEGs into the current document as layers
      </Checkbox>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <label className="lbl" htmlFor="mv-pref-new-bg" style={{ width: 132 }}>New doc background</label>
        <Select id="mv-pref-new-bg" aria-label="New document background" value={filePrefs.newDocumentBackground}
          onChange={(value) => store.setFilePrefs({ newDocumentBackground: value as BgContents })}
          options={BG_CONTENTS.map((o) => ({ value: o.key, label: o.label }))} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <label className="lbl" htmlFor="mv-pref-psd32" style={{ width: 132 }}>32-bit PSD/PSB</label>
        <Select id="mv-pref-psd32" aria-label="32-bit Photoshop import" value={filePrefs.photoshop32BitImport}
          onChange={(value) => store.setFilePrefs({ photoshop32BitImport: value as Photoshop32BitImport })}
          options={[
            { value: "auto", label: "Auto (preserve HDR)" },
            { value: "preserve", label: "Preserve 32-bit" },
            { value: "convert16", label: "Convert to 16-bit" },
          ]} />
      </div>
      <div className="monet-row" style={{ gap: 8, alignItems: "center" }}>
        <Button variant="ghost" disabled={!recentFiles.length} onClick={() => store.clearRecentFiles()}>Clear Recent File List</Button>
        <span style={{ color: "var(--text-3)", fontSize: 11 }}>{recentFiles.length} of 10 remembered</span>
      </div>
    </div>
  );
}

// Preferences ▸ Export — the defaults the two export paths open with: File ▸
// Export As (exportPrefs) and File ▸ Save for Web (webExportPrefs).
function ExportDefaultsPrefs() {
  const exportPrefs = useStore((s) => s.exportPrefs);
  const web = useStore((s) => s.webExportPrefs);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="lbl">Export As</div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 110 }}>Format</span>
        <SegmentedControl aria-label="Export As format" value={exportPrefs.format}
          onChange={(value) => store.setExportPrefs({ format: value as typeof exportPrefs.format })}
          items={[{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }]} />
        <NumberField aria-label="Export As JPEG quality" value={exportPrefs.quality} min={1} max={100}
          onChange={(v) => store.setExportPrefs({ quality: Math.round(v) })} suffix="%" />
      </div>
      <div className="lbl" style={{ borderTop: "1px solid var(--stroke-2)", paddingTop: 12 }}>Save for Web</div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 110 }}>Format</span>
        <SegmentedControl aria-label="Save for Web format" value={web.format}
          onChange={(value) => store.setWebExportPrefs({ format: value as typeof web.format })}
          items={[{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }, { value: "gif", label: "GIF" }]} />
        <NumberField aria-label="Save for Web JPEG quality" value={web.quality} min={1} max={100}
          onChange={(v) => store.setWebExportPrefs({ quality: Math.round(v) })} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <label className="lbl" htmlFor="mv-pref-export-matte" style={{ width: 110 }}>Matte</label>
        <Select id="mv-pref-export-matte" aria-label="Save for Web matte" value={web.matte}
          onChange={(value) => store.setWebExportPrefs({ matte: value as typeof web.matte })}
          options={[{ value: "transparent", label: "Transparent" }, { value: "white", label: "White" }, { value: "black", label: "Black" }]} />
      </div>
      <Checkbox id="mv-pref-export-srgb" checked={web.convertToSRgb}
        onChange={(enabled) => store.setWebExportPrefs({ convertToSRgb: enabled })}>
        Convert to sRGB
      </Checkbox>
    </div>
  );
}

// Preferences ▸ Type — the font-menu preview size (Type ▸ Font Preview Size).
function TypePrefs() {
  const fontPreviewSize = useStore((s) => s.fontPreviewSize);
  return (
    <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
      <label className="lbl" htmlFor="mv-pref-font-preview" style={{ width: 110 }}>Font Preview Size</label>
      <Select id="mv-pref-font-preview" aria-label="Font preview size" value={fontPreviewSize}
        onChange={(value) => store.setFontPreviewSize(normalizeFontPreviewSize(value))}
        options={FONT_PREVIEW_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))} />
    </div>
  );
}

// Preferences ▸ Transparency & Gamut — the View ▸ Gamut Warning overlay. Grey
// at 100% (Photoshop's default) is invisible on a grey-heavy image, so both the
// colour and its coverage are settings. Display-only: the paint lives in the
// EngineClient blit path and never reaches saved or exported pixels.
function TransparencyGamutPrefs() {
  const [paint, setPaint] = useState<GamutWarningPaint>(() => engine.getGamutWarningPaint());
  const apply = (next: GamutWarningPaint) => { setPaint(next); engine.setGamutWarningPaint(next); };
  const hex = "#" + paint.color.map((v) => v.toString(16).padStart(2, "0")).join("");
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 130 }}>Gamut Warning Color</span>
        <input type="color" value={hex} aria-label="Gamut warning color" data-testid="mv-pref-gamut-color"
          onChange={(e) => apply({ ...paint, color: hexToRgb(e.currentTarget.value) })}
          style={{ width: 40, height: 28, padding: 0, border: "none", background: "none" }} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 130 }}>Opacity</span>
        <NumberField value={Math.round(paint.opacity * 100)} min={0} max={100} suffix="%"
          aria-label="Gamut warning opacity" id="mv-pref-gamut-opacity"
          onChange={(v) => apply({ ...paint, opacity: v / 100 })} />
      </div>
      <div className="lbl" style={{ color: "var(--text-3)", fontSize: 11 }}>
        Painted over out-of-gamut pixels while View ▸ Gamut Warning is on. Display only — saved and exported pixels are unchanged.
      </div>
    </div>
  );
}

// Preferences ▸ History Log — Photoshop's edit audit trail: every state that
// lands on the History timeline, plus the session events around it, timestamped.
// Off by default, and "Edit Log Items" picks how much lands in it.
// ponytail: Photoshop's "Save Log Items To: Metadata / Text File / Both" radio is
// absent — the engine's DocMetadata carries no history field, so "Metadata" would
// embed nothing. See Store.setHistoryLog for the upgrade path; today the log is
// session-only and exports as a text file.
const HISTORY_LOG_DETAIL_OPTIONS = [
  { value: "sessions", label: "Sessions Only" },
  { value: "concise", label: "Concise" },
  { value: "detailed", label: "Detailed" },
];

function HistoryLogPrefs() {
  const log = useStore((s) => s.historyLog);
  const entries = useStore((s) => s.historyLogEntries);
  const dim: CSSProperties = { color: "var(--text-3)", fontSize: 11 };
  const saveLog = () => saveBytes("Vision Edit Log.txt", new TextEncoder().encode(store.historyLogText()), "text/plain");
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Checkbox id="mv-pref-history-log" checked={log.enabled} onChange={(enabled) => store.setHistoryLog({ enabled })}>
        History Log
      </Checkbox>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <label className="lbl" htmlFor="mv-pref-history-log-detail" style={{ width: 110, flex: "none" }}>Edit Log Items</label>
        <Select block id="mv-pref-history-log-detail" value={log.detail} disabled={!log.enabled}
          onChange={(value) => store.setHistoryLog({ detail: value as "sessions" | "concise" | "detailed" })}
          options={HISTORY_LOG_DETAIL_OPTIONS} />
      </div>
      <div style={dim}>
        Sessions Only records opening and saving a document. Concise adds every History-panel state;
        Detailed prefixes each state with its document and timeline position.
      </div>
      <div style={{ borderTop: "1px solid var(--stroke-2)", paddingTop: 12, display: "grid", gap: 8 }}>
        <div className="lbl">Log — {entries.length} {entries.length === 1 ? "entry" : "entries"} this session</div>
        <pre role="log" aria-label="History Log" data-testid="mv-history-log-view"
          style={{ margin: 0, maxHeight: 120, overflow: "auto", fontSize: 10, lineHeight: 1.5, whiteSpace: "pre",
            padding: 8, borderRadius: 4, background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-2)" }}>
          {entries.length ? entries.join("\n") : "Nothing logged yet."}
        </pre>
        <div className="monet-row" style={{ gap: 8 }}>
          <Button variant="ghost" disabled={!entries.length} onClick={saveLog}>Save Log…</Button>
          <Button variant="ghost" disabled={!entries.length} onClick={() => store.clearHistoryLog()}>Clear</Button>
        </div>
        <div style={dim}>The log is session-only — it is not written into the document or saved with it.</div>
      </div>
    </div>
  );
}

// Preferences ▸ Workspace — the dock and document-tab behaviours App.tsx and
// the dockable workspace read. Photoshop's other Workspace options have no
// Vision counterpart yet (floating document windows, the narrow options bar).
function WorkspacePane() {
  const prefs = useStore((s) => s.workspacePrefs);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Checkbox id="mv-pref-auto-collapse" checked={prefs.autoCollapseIconicPanels}
        onChange={(enabled) => store.setWorkspacePrefs({ autoCollapseIconicPanels: enabled })}>
        Auto-Collapse Iconic Panels
      </Checkbox>
      <Checkbox id="mv-pref-auto-show" checked={prefs.autoShowHiddenPanels}
        onChange={(enabled) => store.setWorkspacePrefs({ autoShowHiddenPanels: enabled })}>
        Auto-Show Hidden Panels
      </Checkbox>
      <Checkbox id="mv-pref-large-tabs" checked={prefs.largeTabs}
        onChange={(enabled) => store.setWorkspacePrefs({ largeTabs: enabled })}>
        Large Tabs
      </Checkbox>
      <div style={{ color: "var(--text-3)", fontSize: 11 }}>
        Auto-Collapse folds a collapsed dock's open panel away when you click elsewhere; off, it stays
        out until you click its icon again. Auto-Show brings panels hidden with Tab back while the
        pointer is at the window's left or right edge.
      </div>
    </div>
  );
}

// Preferences ▸ Cursors — the canvas pointer. Painting Cursors covers the
// brush-tip tools (the outline View ▸ Show ▸ Brush Preview shows); Other
// Cursors every other tool that draws its own pointer.
function CursorsPane() {
  const prefs = useStore((s) => s.cursorPrefs);
  const showBrushPreview = useStore((s) => s.showBrushPreview);
  const tip = isBrushTipCursor(prefs.painting);
  const dim: CSSProperties = { color: "var(--text-3)", fontSize: 11 };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="lbl">Painting Cursors</div>
      <RadioGroup aria-label="Painting Cursors" value={prefs.painting}
        onChange={(value) => store.setCursorPrefs({ painting: value as PaintingCursor })}>
        <Radio value="standard">Standard</Radio>
        <Radio value="precise">Precise</Radio>
        <Radio value="normal">Normal Brush Tip</Radio>
        <Radio value="full">Full Size Brush Tip</Radio>
      </RadioGroup>
      <Checkbox id="mv-pref-crosshair-tip" checked={prefs.crosshairInTip} disabled={!tip}
        onChange={(enabled) => store.setCursorPrefs({ crosshairInTip: enabled })}>
        Show Crosshair in Brush Tip
      </Checkbox>
      <Checkbox id="mv-pref-crosshair-painting" checked={prefs.crosshairWhilePainting} disabled={!tip}
        onChange={(enabled) => store.setCursorPrefs({ crosshairWhilePainting: enabled })}>
        Show Only Crosshair While Painting
      </Checkbox>
      {tip && !showBrushPreview && (
        <div style={dim}>View ▸ Show ▸ Brush Preview is off, so the brush tip stays hidden until it is turned back on.</div>
      )}
      <div className="lbl" style={{ borderTop: "1px solid var(--stroke-2)", paddingTop: 10 }}>Other Cursors</div>
      <RadioGroup aria-label="Other Cursors" value={prefs.other}
        onChange={(value) => store.setCursorPrefs({ other: value as OtherCursor })}>
        <Radio value="standard">Standard</Radio>
        <Radio value="precise">Precise</Radio>
      </RadioGroup>
      <div style={dim}>
        Normal Brush Tip outlines the part of the brush that paints at 50% opacity or more; Full Size, the
        whole brush. Standard shows the tool's icon. Caps Lock switches to Precise while it is on.
      </div>
    </div>
  );
}

// Preferences ▸ Camera Raw — how opening a raw file goes through Camera Raw
// (store.presentNextCameraRawSession / onCameraRawSidecarOnOpen). Vision's
// Camera Raw reads raw files only, so Photoshop's JPEG/HEIC/TIFF handling has
// nothing to switch. Demosaic and Depth are the file-handling prefs the
// workspace's own Demosaic / Depth menus edit — one stored value, two places.
function CameraRawPane() {
  const prefs = useStore((s) => s.cameraRawPrefs);
  const filePrefs = useStore((s) => s.filePrefs);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Checkbox id="mv-pref-open-camera-raw" checked={prefs.openInCameraRaw}
        onChange={(enabled) => store.setCameraRawPrefs({ openInCameraRaw: enabled })}>
        Show Camera Raw when opening raw files
      </Checkbox>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <label className="lbl" htmlFor="mv-pref-raw-demosaic" style={{ width: 132 }}>Demosaic</label>
        <Select id="mv-pref-raw-demosaic" aria-label="Raw demosaic" value={filePrefs.rawDemosaic}
          onChange={(value) => store.setFilePrefs({ rawDemosaic: value as RawDemosaic })}
          options={RAW_DEMOSAIC_OPTIONS} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <label className="lbl" htmlFor="mv-pref-raw-depth" style={{ width: 132 }}>Depth</label>
        <Select id="mv-pref-raw-depth" aria-label="Raw open depth" value={String(filePrefs.rawDepth)}
          onChange={(value) => store.setFilePrefs({ rawDepth: Number(value) as RawOpenDepth })}
          options={RAW_DEPTH_OPTIONS} />
      </div>
      <Checkbox id="mv-pref-sidecar-on-open" checked={prefs.sidecarOnOpen} disabled={!isTauri()}
        onChange={(enabled) => store.setCameraRawPrefs({ sidecarOnOpen: enabled })}>
        Save settings to a sidecar .xmp when opening an image
      </Checkbox>
      <div style={{ color: "var(--text-3)", fontSize: 11 }}>
        On the desktop a raw file opens with the settings in the .xmp beside it — Vision's own, or
        Lightroom/Camera Raw's — and saving on open writes that .xmp, but never over one another app
        wrote. With Camera Raw off, the file opens straight into a document with those settings or the defaults.
        Demosaic and Depth are what the next raw file decodes and opens with; the workspace's own menus change them too.
      </div>
    </div>
  );
}

// Panes with real settings behind them; everything else in PREF_SECTIONS still
// falls through to the "no options" note rather than faking a control.
const PREF_PANES: Record<string, ComponentType> = {
  Workspace: WorkspacePane,
  Cursors: CursorsPane,
  "Camera Raw": CameraRawPane,
  Interface: InterfacePrefs,
  "History Log": HistoryLogPrefs,
  "Units & Rulers": UnitsRulersPrefs,
  "File Handling": FileHandlingPrefs,
  Export: ExportDefaultsPrefs,
  Type: TypePrefs,
  "Content Credentials": ContentCredentialsPrefs,
  "AI Models": AiModelsPrefs,
  "Transparency & Gamut": TransparencyGamutPrefs,
};

/** Panes the dialog body renders inline (they read Preferences-level state). */
const PREF_INLINE_PANES = ["General", "Tools", "Performance", "Guides, Grid & Slices"];

function Preferences() {
  const { close, arg } = useDialogs();
  const [sec, setSec] = useState(typeof arg === "string" && PREF_SECTIONS.includes(arg) ? arg : "General");
  const hist = useStore((s) => s.historyStates);
  const useShiftKeyForToolSwitch = useStore((s) => s.useShiftKeyForToolSwitch);
  const springLoadedToolShortcuts = useStore((s) => s.springLoadedToolShortcuts);
  const springLoadedToolDelayMs = useStore((s) => s.springLoadedToolDelayMs);
  const gridSpacing = useStore((s) => s.gridSpacing);
  const gridColor = useStore((s) => s.gridColor);
  const Pane = PREF_PANES[sec];
  return (
    <Dialog open onClose={close} title="Preferences" width={580}
      footer={<Button variant="primary" onClick={close}>OK</Button>}>
      <div style={{ display: "flex", gap: 14 }}>
        <div style={{ width: 168, maxHeight: 320, overflowY: "auto", borderRight: "1px solid var(--stroke-2)", paddingRight: 6 }}>
          {PREF_SECTIONS.map((s) => (
            <div key={s} onClick={() => setSec(s)}
              style={{ padding: "4px 8px", fontSize: 12, borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
                background: sec === s ? "var(--accent-raster)" : "transparent", color: sec === s ? "#fff" : "var(--text-2)" }}>
              {s}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 230, fontSize: 12 }}>
          <div className="monet-section-label" style={{ marginBottom: 10 }}>{sec}</div>
          {sec === "General" && (
            <Checkbox id="mv-pref-shift-tool-switch" checked={useShiftKeyForToolSwitch} onChange={(enabled) => store.setUseShiftKeyForToolSwitch(enabled)}>
              Use Shift Key for Tool Switch
            </Checkbox>
          )}
          {sec === "Tools" && (
            <div style={{ display: "grid", gap: 12 }}>
              <Checkbox id="mv-pref-spring-tools" checked={springLoadedToolShortcuts} onChange={(enabled) => store.setSpringLoadedToolPreferences({ springLoadedToolShortcuts: enabled })}>
                Spring-loaded Tool Shortcuts
              </Checkbox>
              <div className="monet-row" style={{ gap: 10 }}>
                <label className="lbl" htmlFor="mv-pref-spring-delay" style={{ width: 110 }}>Timing Sensitivity</label>
                <Slider
                  id="mv-pref-spring-delay"
                  aria-label="Spring-loaded shortcut timing"
                  min={200}
                  max={2000}
                  step={10}
                  accent={ACCENT}
                  value={springLoadedToolDelayMs}
                  disabled={!springLoadedToolShortcuts}
                  onChange={(v) => store.setSpringLoadedToolPreferences({ springLoadedToolDelayMs: v })}
                  style={{ flex: 1 }}
                />
                <span style={{ width: 58, textAlign: "right", color: "var(--text-3)" }}>{springLoadedToolDelayMs} ms</span>
              </div>
            </div>
          )}
          {sec === "Performance" && (
            <div className="monet-row" style={{ gap: 10 }}>
              <span className="lbl" style={{ width: 110 }}>History States</span>
              <NumberField value={hist} min={1} max={1000} onChange={(v) => store.setHistoryStates(Math.round(v))} />
            </div>
          )}
          {sec === "Guides, Grid & Slices" && (
            <>
              <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
                <span className="lbl" style={{ width: 110 }}>Gridline Every</span>
                <NumberField value={gridSpacing} min={2} max={512} onChange={(v) => store.setOptions({ gridSpacing: Math.round(v) })} suffix="px" />
              </div>
              <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
                <span className="lbl" style={{ width: 110 }}>Grid Color</span>
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(gridColor) ? gridColor : "#8080a0"} aria-label="Grid color"
                  onChange={(e) => store.setOptions({ gridColor: e.currentTarget.value })}
                  style={{ width: 40, height: 28, padding: 0, border: "none", background: "none" }} />
              </div>
            </>
          )}
          {Pane && <Pane />}
          {!Pane && !PREF_INLINE_PANES.includes(sec) && (
            <div style={{ color: "var(--text-3)" }}>No configurable options for this pane in this build.</div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ponytail: tool bindings stay at flyout-group granularity; split individual
// members only when Vision supports independent shortcuts without breaking Shift-cycle.
function About() {
  const { close, arg } = useDialogs();
  const systemInfo = arg === "systemInfo";
  let engineBuild = "monet-render-engine · WebAssembly";
  try { engineBuild = `monet-render-engine ${engine.version()} · WebAssembly`; } catch { /* unavailable in a mocked shell */ }
  const platform = typeof navigator === "undefined" ? "Unknown" : navigator.platform || navigator.userAgent;
  const rows = [
    ["Version", VISION_CONTAINER_APP.version],
    ["Engine", engineBuild],
    ["Platform", `${isTauri() ? "Desktop" : "Browser"} · ${platform}`],
  ];
  return (
    <Dialog open onClose={close} title={systemInfo ? "System Info" : "About Monet Vision"} width={440}
      footer={<Button variant="primary" onClick={close}>OK</Button>}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <strong style={{ fontSize: 20 }}>Monet Vision</strong>
        <div style={{ color: "var(--text-3)", marginTop: 4 }}>Raster editing by Monet</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: "8px 12px", fontSize: 12 }}>
        {rows.map(([label, value]) => <div key={label} style={{ display: "contents" }}>
          <strong>{label}</strong><span style={{ overflowWrap: "anywhere" }}>{value}</span>
        </div>)}
        {systemInfo && <><strong>User agent</strong><span style={{ overflowWrap: "anywhere" }}>{typeof navigator === "undefined" ? "Unknown" : navigator.userAgent}</span></>}
      </div>
    </Dialog>
  );
}

// Edit ▸ Keyboard Shortcuts… / Edit ▸ Menus… — Photoshop's one dialog with two
// tabs. `arg === "menus"` opens straight on the Menus tab.
function KeyboardShortcuts() {
  const { close, arg } = useDialogs();
  const [tab, setTab] = useState<"shortcuts" | "menus">(arg === "menus" ? "menus" : "shortcuts");
  const menuCommands = useMemo(listMenuCommands, []);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(loadHiddenMenuCommands);
  const [category, setCategory] = useState<"application" | "tools">("application");
  // The editor edits BINDINGS, not availability: a command that is disabled or
  // hidden right now still owns its chord, so it has to be listed and it has to
  // be counted when detecting a conflict. `catalog` is the unfiltered list;
  // `items` (what is runnable now) is for dispatch and Edit ▸ Search (#501).
  const appCommands = commandPalette.catalog.length ? commandPalette.catalog : commandPalette.items;
  const commands = category === "tools" ? commandPalette.toolItems : appCommands;
  const allCommands = [...appCommands, ...commandPalette.toolItems];
  const [draft, setDraft] = useState<ShortcutOverrides>(() => ({ ...store.state.keyboardShortcuts }));
  const [initialSets] = useState(() => {
    try { return { sets: loadShortcutSets(), selected: loadShortcutSetSelection(), error: "" }; }
    catch (error) { return { sets: [] as ShortcutSet[], selected: null, error: String(error instanceof Error ? error.message : error) }; }
  });
  const [sets, setSets] = useState(initialSets.sets);
  const [setName, setSetName] = useState<string | null>(() => (
    initialSets.selected === "" && !Object.keys(draft).length ? "" : initialSets.sets.find((set) => set.name === initialSets.selected && sameShortcuts(set.shortcuts, draft))?.name
      ?? initialSets.sets.find((set) => sameShortcuts(set.shortcuts, draft))?.name ?? (Object.keys(draft).length ? null : "")
  ));
  const [setsChanged, setSetsChanged] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [setError, setSetError] = useState(initialSets.error);
  const [setBusy, setSetBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(commands[0]?.id ?? "");
  const [pending, setPending] = useState<{ id: string; chord: ShortcutChord; conflictId: string; conflictLabel: string } | null>(null);
  const selectedCommand = commands.find((command) => command.id === selected);
  const visible = commands.filter((command) => command.label.toLowerCase().includes(query.trim().toLowerCase()));
  const current = (command: (typeof commands)[number]) => Object.hasOwn(draft, command.id) ? draft[command.id] : command.defaultChord;

  const request = (id: string, value: ShortcutChord | null) => {
    const conflict = shortcutConflict(draft, allCommands, id, value);
    if (value && conflict) {
      setPending({ id, chord: value, conflictId: conflict.id, conflictLabel: conflict.label });
      return;
    }
    setPending(null);
    setDraft((old) => reassignShortcut(old, allCommands, id, value));
  };
  const capture = (event: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setPending(null);
      event.currentTarget.blur();
      return;
    }
    const value = category === "tools"
      ? toolShortcutFromEvent(event.nativeEvent)
      : shortcutFromEvent(event.nativeEvent);
    if (!value) return;
    if (category === "tools" && !isToolShortcutAllowed(id, value)) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(id);
    request(id, value);
  };
  const acceptConflict = () => {
    if (!pending) return;
    setDraft((old) => reassignShortcut(old, allCommands, pending.id, pending.chord));
    setSelected(pending.id);
    setPending(null);
  };
  const reportSetError = (error: unknown) => setSetError(error instanceof Error ? error.message : String(error));
  const chooseSet = (name: string) => {
    setSetName(name);
    // A selection alone must not let OK write an empty list over a library that failed to load.
    setSetsChanged((changed) => changed || !initialSets.error);
    setDraft({ ...(sets.find((set) => set.name === name)?.shortcuts ?? {}) });
    setPending(null);
    setNewName(null);
    setSetError("");
  };
  const saveSet = (name: string, replace = false) => {
    try {
      const next = putShortcutSet(sets, name, draft, replace, allCommands);
      setSets(next);
      setSetName(name.trim());
      setSetsChanged(true);
      setNewName(null);
      setSetError("");
    } catch (error) { reportSetError(error); }
  };
  const importSet = async () => {
    setSetBusy(true);
    setSetError("");
    try {
      const bytes = await pickLocalFileBytes(SHORTCUT_SET_FILTERS, SHORTCUT_SET_LIMIT);
      if (!bytes) return;
      const imported = parseShortcutSet(decodeImportText(bytes), allCommands);
      // Import never overwrites another profile's set with the same name.
      const base = imported.name.toLowerCase() === DEFAULT_SHORTCUT_SET_NAME.toLowerCase() ? "Monet Defaults Copy" : imported.name;
      let name = base;
      for (let suffix = 2; sets.some((set) => set.name.toLowerCase() === name.toLowerCase()); suffix++) name = `${base.slice(0, 70)} ${suffix}`;
      setSets(putShortcutSet(sets, name, imported.shortcuts));
      setSetName(name);
      setDraft(imported.shortcuts);
      setSetsChanged(true);
      setPending(null);
      setNewName(null);
    } catch (error) { reportSetError(error); }
    finally { setSetBusy(false); }
  };
  const exportSet = async () => {
    setSetBusy(true);
    setSetError("");
    try {
      const name = setName || (setName === "" ? DEFAULT_SHORTCUT_SET_NAME : "My Shortcuts");
      const bytes = new TextEncoder().encode(serializeShortcutSet({ name, shortcuts: draft }));
      const filename = `${name.replace(/[<>:"/\\|?*]/g, "_")}.monetkeys`;
      if (isTauri()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({ defaultPath: filename, filters: SHORTCUT_SET_FILTERS });
        if (path) await atomicWriteBytes(path, bytes);
      } else saveBytes(filename, bytes, "application/json");
    } catch (error) { reportSetError(error); }
    finally { setSetBusy(false); }
  };
  const ok = () => {
    try {
      if (setsChanged) saveShortcutSets(sets, setName);
      store.setKeyboardShortcuts(draft); saveHiddenMenuCommands(hidden); close();
    } catch (error) { reportSetError(error); }
  };
  // Menus tab: the whole bar, keyed by full path (see psMenus.listMenuCommands).
  const visibleMenus = menuCommands.filter((command) => command.path.toLowerCase().includes(query.trim().toLowerCase()));
  const toggleHidden = (path: string) => setHidden((old) => {
    const next = new Set(old);
    if (!next.delete(path)) next.add(path);
    return next;
  });

  return (
    <Dialog open onClose={close} title="Keyboard Shortcuts and Menus" width={720}
      footer={<>
        <Button variant="ghost" data-mv-shortcut-reset
          onClick={() => { if (tab === "menus") setHidden(new Set()); else chooseSet(""); }}>Reset All</Button>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={setBusy || !!pending || newName !== null} onClick={ok}>OK</Button>
      </>}>
      <div style={{ marginBottom: 12 }}>
        <SegmentedControl
          aria-label="Customize"
          value={tab}
          onChange={(value) => { setTab(value as typeof tab); setQuery(""); setPending(null); }}
          items={[{ value: "shortcuts", label: "Keyboard Shortcuts" }, { value: "menus", label: "Menus" }]}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-3)" }}>
          Set
          <Select size="sm" aria-label="Shortcut set" disabled={setBusy} value={setName === null ? "custom" : `set:${setName}`}
            onChange={(v) => chooseSet(v.slice(4))}
            options={[
              { value: "set:", label: `${DEFAULT_SHORTCUT_SET_NAME}${setName === "" && Object.keys(draft).length ? " (modified)" : ""}` },
              ...(setName === null ? [{ value: "custom", label: "Custom", disabled: true }] : []),
              ...sets.map((set) => ({ value: `set:${set.name}`, label: `${set.name}${setName === set.name && !sameShortcuts(draft, set.shortcuts) ? " (modified)" : ""}` })),
            ]} />
        </label>
        {tab === "shortcuts" ? (
          <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-3)" }}>
            Shortcuts For
            <Select
              size="sm"
              aria-label="Shortcuts for"
              data-mv-shortcut-category
              value={category}
              onChange={(value) => {
                const next = value as "application" | "tools";
                const nextCommands = next === "tools" ? commandPalette.toolItems : commandPalette.items;
                setCategory(next);
                setSelected(nextCommands[0]?.id ?? "");
                setQuery("");
                setPending(null);
              }}
              options={[{ value: "application", label: "Application Menus" }, { value: "tools", label: "Tools" }]}
            />
          </label>
        ) : (
          // Monet has no panel menus, so Photoshop's second choice has nothing
          // behind it — the control stays for parity, pinned to the one scope.
          <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-3)" }}>
            Menu For
            <Select size="sm" aria-label="Menu for" value="application" disabled options={[{ value: "application", label: "Application Menus" }]} />
          </label>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <Button variant="ghost" disabled={!setName || setBusy || !!pending} onClick={() => setName && saveSet(setName, true)}>Save Set</Button>
        <Button variant="ghost" disabled={setBusy || !!pending} onClick={() => { setNewName(setName ? `${setName.slice(0, 70)} Copy` : "My Shortcuts"); setSetError(""); }}>Save Set As…</Button>
        <Button variant="ghost" disabled={!setName || setBusy} onClick={() => {
          setSets(sets.filter((set) => set.name !== setName)); setSetsChanged(true); chooseSet("");
        }}>Delete Set</Button>
        <Button variant="ghost" disabled={setBusy || !!pending} onClick={() => { void exportSet(); }}>Export Set…</Button>
        <Button variant="ghost" disabled={setBusy || !!pending} onClick={() => { void importSet(); }}>Import Set…</Button>
      </div>
      {newName !== null && <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input autoFocus aria-label="New shortcut set name" value={newName} maxLength={80} style={{ ...INP_BASE, flex: 1 }}
          onChange={(event) => setNewName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== "Escape") return;
            // Prevented, so the Dialog's Escape dismiss skips it and staged changes survive.
            event.preventDefault(); event.stopPropagation();
            if (event.key === "Enter") saveSet(newName); else { setNewName(null); setSetError(""); }
          }} />
        <Button variant="primary" onClick={() => saveSet(newName)}>Create Set</Button>
        <Button variant="ghost" onClick={() => { setNewName(null); setSetError(""); }}>Cancel Naming</Button>
      </div>}
      {setError && <div role="alert" style={{ color: "var(--error)", fontSize: 12, marginBottom: 10 }}>{setError}</div>}
      <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 10 }}>Shortcut and saved-set changes apply with OK. Export writes the current shortcuts to a file.</div>
      <input
        type="search"
        aria-label={tab === "menus" ? "Search menu commands" : `Search ${category === "tools" ? "tools" : "application menu commands"}`}
        placeholder={tab === "menus" ? "Search menus" : `Search ${category === "tools" ? "tools" : "application menus"}`}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        style={{ ...INP_BASE, width: "100%", marginBottom: 10 }}
      />
      {tab === "menus" ? (<>
        <div role="list" aria-label="Menu visibility" style={{ height: 330, overflow: "auto", border: "1px solid var(--stroke-2)", borderRadius: 6 }}>
          {visibleMenus.map((command, index) => (
            <div key={command.path} role="listitem" data-mv-menu-visibility={command.path}
              style={{ display: "flex", alignItems: "center", minHeight: 28, padding: "2px 8px", paddingLeft: 8 + command.depth * 14, borderBottom: "1px solid var(--stroke-2)" }}>
              <Checkbox id={`mv-menu-vis-${index}`} checked={!hidden.has(command.path)}
                onChange={() => toggleHidden(command.path)}>
                <span title={command.path} style={{ fontSize: 11 }}>{command.path.slice(command.path.lastIndexOf(" ▸ ") + 3)}</span>
              </Checkbox>
            </div>
          ))}
          {!visibleMenus.length && <div style={{ padding: 16, color: "var(--text-3)", fontSize: 12 }}>No matching commands.</div>}
        </div>
        <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 10 }}>
          Unchecked commands are hidden from the menu bar. A submenu left empty is hidden with them.
        </div>
      </>) : (<>
      {pending && (
        <div data-mv-shortcut-conflict style={{ border: "1px solid rgba(245,158,11,.45)", borderRadius: 6, background: "rgba(245,158,11,.1)", padding: 9, marginBottom: 10, fontSize: 11 }}>
          <div><strong>{formatShortcut(pending.chord)}</strong> is already assigned to {pending.conflictLabel}.</div>
          <div style={{ display: "flex", gap: 8, marginTop: 7 }}>
            <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" onClick={acceptConflict}>Accept and Replace</Button>
          </div>
        </div>
      )}
      <div role="list" aria-label={category === "tools" ? "Tool shortcuts" : "Application menu shortcuts"} style={{ height: 330, overflow: "auto", border: "1px solid var(--stroke-2)", borderRadius: 6 }}>
        {visible.map((command) => {
          const active = command.id === selected;
          return (
            <div key={command.id} role="listitem" data-mv-shortcut-row={command.id}
              onClick={() => setSelected(command.id)}
              style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 126px", gap: 10, alignItems: "center", minHeight: 34, padding: "4px 8px", borderBottom: "1px solid var(--stroke-2)", background: active ? "rgba(81,154,255,.12)" : "transparent" }}>
              <span title={command.label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{command.label}</span>
              <input
                readOnly
                data-mv-shortcut-command={command.id}
                aria-label={`Shortcut for ${command.label}`}
                value={formatShortcut(current(command))}
                placeholder="None"
                onFocus={() => setSelected(command.id)}
                onKeyDown={(event) => capture(event, command.id)}
                style={{ ...INP_BASE, width: "100%", textAlign: "center", fontFamily: "var(--font-mono)", cursor: "text" }}
              />
            </div>
          );
        })}
        {!visible.length && <div style={{ padding: 16, color: "var(--text-3)", fontSize: 12 }}>No matching commands.</div>}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <Button variant="ghost" disabled={!selectedCommand} onClick={() => selectedCommand && request(selectedCommand.id, null)}>Delete Shortcut</Button>
        <Button variant="ghost" disabled={!selectedCommand} onClick={() => selectedCommand && request(selectedCommand.id, selectedCommand.defaultChord)}>Use Default</Button>
        <span style={{ color: "var(--text-3)", fontSize: 11 }}>
          {category === "tools" ? "Tool groups and actions use letters, brackets, comma, or period where applicable." : "Select a field, then press the new shortcut."}
        </span>
      </div>
      </>)}
    </Dialog>
  );
}
// File ▸ File Info ▸ Content Credentials — the C2PA provenance attached to the
// file this document was opened from. Native only (the reader lives in the
// `c2pa` plugin) and keyed on the document's own recorded path, so it describes
// the file on disk rather than the unsaved edits on top of it.
function OpenedFileCredentials() {
  const path = isTauri() ? store.activePath() : null;
  // undefined = still reading, null = this file carries none.
  const [cc, setCc] = useState<CredentialSummary | null | undefined>(path ? undefined : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) { setCc(null); return; }
    let live = true;
    setCc(undefined);
    setError(null);
    readContentCredentials(path).then(
      (v) => { if (live) setCc(v); },
      (e) => { if (live) { setCc(null); setError(e instanceof Error ? e.message : String(e)); } },
    );
    return () => { live = false; };
  }, [path]);

  const dim: CSSProperties = { color: "var(--text-3)", fontSize: 11 };
  const rows: [string, string][] = cc
    ? [
      ["Produced by", cc.producer],
      ...(cc.signedBy ? [["Signed by", cc.signedBy] as [string, string]] : []),
      ...(cc.signedOn ? [["Signed on", cc.signedOn] as [string, string]] : []),
      ["Status", cc.state],
      ...(cc.actions.length ? [["Edits", cc.actions.join(", ")] as [string, string]] : []),
      ...(cc.ingredients.length ? [["Derived from", cc.ingredients.join(", ")] as [string, string]] : []),
    ]
    : [];

  return (
    <div data-mv-file-info-credentials={cc ? "present" : error ? "error" : cc === undefined ? "loading" : "none"} style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--stroke-2, rgba(255,255,255,0.12))" }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Content Credentials</div>
      {cc === undefined && <div style={dim}>Reading…</div>}
      {cc === null && !error && (
        <div style={dim}>{path ? "This file has no Content Credentials." : "Save or open a file on disk to inspect its Content Credentials."}</div>
      )}
      {error && <div style={{ ...dim, color: "var(--danger, #f87171)" }}>Couldn’t read Content Credentials: {error}</div>}
      {rows.map(([k, v]) => (
        <div key={k} className="monet-row" data-mv-file-info-row={k} style={{ gap: 10, marginBottom: 8 }}>
          <span className="lbl" style={{ width: 110, color: "var(--text-3)" }}>{k}</span>
          <span style={{ fontSize: 12 }}>{v}</span>
        </div>
      ))}
      {/* A failed signature is the whole point of reading these — never hide it. */}
      {cc?.issues.map((issue) => (
        <div key={issue} data-mv-file-info-credential-issue style={{ ...dim, color: "var(--warn, #f59e0b)" }}>⚠ {issue}</div>
      ))}
      {cc && (
        // ponytail: plain text, not a link — no opener plugin is installed and an
        // <a> would navigate the webview itself. Swap for tauri-plugin-opener.
        <div style={{ ...dim, marginTop: 6, userSelect: "text" }}>Verify independently at {VERIFY_URL}</div>
      )}
    </div>
  );
}

// ── File Info (VIS-META-01) ────────────────────────────────────
// Photoshop's File ▸ File Info is the document's XMP editor, and what it
// authors is what Save As / Export As embed. The fields live on the engine
// (`DocMetadata`) because the engine is what writes the packet into every
// export and what round-trips it through the project file — so this dialog is
// a form over `document_metadata()` and nothing else has to carry them.
// ponytail: one scrolling form, not Photoshop's nine tabs. Camera Data /
// Origin / Raw Data become their own sections here if the field list grows.

interface FileInfoFields {
  title: string;
  creator: string;
  creatorTitle: string;
  description: string;
  keywords: string[];
  copyrightStatus: number;
  copyright: string;
  copyrightUrl: string;
  headline: string;
  credit: string;
  source: string;
  instructions: string;
  city: string;
  state: string;
  country: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
}

const EMPTY_FILE_INFO: FileInfoFields = {
  title: "", creator: "", creatorTitle: "", description: "", keywords: [],
  copyrightStatus: 0, copyright: "", copyrightUrl: "", headline: "", credit: "",
  source: "", instructions: "", city: "", state: "", country: "",
  gpsLatitude: null, gpsLongitude: null,
};

const COPYRIGHT_STATUS_OPTIONS = [
  { value: "0", label: "Unknown" },
  { value: "1", label: "Copyrighted" },
  { value: "2", label: "Public Domain" },
];

/** The engine's stored File Info. Missing keys read as empty; the engine
 *  re-validates and bounds everything on the way back in, so the dialog never
 *  has to be the guard. */
function readFileInfo(): FileInfoFields {
  try {
    const raw: unknown = JSON.parse(engine.e.document_metadata());
    if (!raw || typeof raw !== "object") return EMPTY_FILE_INFO;
    return { ...EMPTY_FILE_INFO, ...(raw as Partial<FileInfoFields>) };
  } catch {
    return EMPTY_FILE_INFO; // no document, or an engine without File Info yet
  }
}

/** A blank or unparseable coordinate is "no position" — the engine drops a
 *  half-set pair rather than exporting a photo onto the prime meridian. */
function parseGpsField(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(value) ? value : null;
}

function FileInfoField({ id, label, value, onChange, placeholder, rows }: {
  id: string; label: string; value: string; placeholder?: string; rows?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8, alignItems: rows ? "flex-start" : "center" }}>
      <label className="lbl" htmlFor={id} style={{ width: 110, flex: "none" }}>{label}</label>
      {rows
        ? <Textarea id={id} data-mv-file-info-field={id} value={value} rows={rows} block
            placeholder={placeholder} onChange={(e) => onChange(e.currentTarget.value)} />
        : <Input id={id} data-mv-file-info-field={id} value={value} block
            placeholder={placeholder} onChange={(e) => onChange(e.currentTarget.value)} />}
    </div>
  );
}

function FileInfo() {
  const { close } = useDialogs();
  const doc = store.state.doc;
  const [fields, setFields] = useState<FileInfoFields>(readFileInfo);
  // Keywords and GPS stay as typed while the dialog is open; they are parsed
  // once on OK so a half-typed list or minus sign is not eaten mid-edit.
  const [keywords, setKeywords] = useState(() => fields.keywords.join(", "));
  const [lat, setLat] = useState(() => fields.gpsLatitude === null ? "" : String(fields.gpsLatitude));
  const [lon, setLon] = useState(() => fields.gpsLongitude === null ? "" : String(fields.gpsLongitude));
  const set = (patch: Partial<FileInfoFields>) => setFields((current) => ({ ...current, ...patch }));
  const rows: [string, string][] = [
    ["Name", doc.name],
    ["Dimensions", `${doc.width} × ${doc.height} px`],
    ["Resolution", `${store.state.resolutionPpi} ppi`],
    ["Color Mode", `${colorModeName(store.state.mode)}, ${store.state.depth}-bit`],
    ["Profile", documentProfileName(store.state.colorProfile, store.state.colorProfileAssigned, store.state.iccProfileName, store.state.mode, store.state.modeProfileName)],
    ["Layers", String(store.state.layers.length)],
  ];
  const save = () => {
    engine.e.set_document_metadata(JSON.stringify({
      ...fields,
      keywords: keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean),
      gpsLatitude: parseGpsField(lat),
      gpsLongitude: parseGpsField(lon),
    }));
    store.markDirty(); // File Info is document content — closing unsaved must warn
    close();
  };
  return (
    <Dialog open onClose={close} title="File Info" width={460}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" data-mv-file-info-save onClick={save}>OK</Button></>}>
      {rows.map(([k, v]) => (
        <div key={k} className="monet-row" data-mv-file-info-row={k} style={{ gap: 10, marginBottom: 8 }}>
          <span className="lbl" style={{ width: 110, color: "var(--text-3)" }}>{k}</span>
          <span style={{ fontSize: 12 }}>{v}</span>
        </div>
      ))}
      <div className="monet-section-label" style={{ marginTop: 12, marginBottom: 6 }}>Description</div>
      <FileInfoField id="mv-file-info-title" label="Document Title" value={fields.title} onChange={(title) => set({ title })} />
      <FileInfoField id="mv-file-info-creator" label="Author" value={fields.creator} onChange={(creator) => set({ creator })} />
      <FileInfoField id="mv-file-info-creator-title" label="Author Title" value={fields.creatorTitle} onChange={(creatorTitle) => set({ creatorTitle })} />
      <FileInfoField id="mv-file-info-description" label="Description" rows={3} value={fields.description} onChange={(description) => set({ description })} />
      <FileInfoField id="mv-file-info-keywords" label="Keywords" value={keywords} onChange={setKeywords} placeholder="Comma separated" />
      <div className="monet-row" style={{ gap: 10, marginBottom: 8, alignItems: "center" }}>
        <label className="lbl" htmlFor="mv-file-info-copyright-status" style={{ width: 110, flex: "none" }}>Copyright Status</label>
        <Select block id="mv-file-info-copyright-status" value={String(fields.copyrightStatus)}
          onChange={(value) => set({ copyrightStatus: Number(value) })} options={COPYRIGHT_STATUS_OPTIONS} />
      </div>
      <FileInfoField id="mv-file-info-copyright" label="Copyright Notice" value={fields.copyright} onChange={(copyright) => set({ copyright })} placeholder="© 2026 Your Name" />
      <FileInfoField id="mv-file-info-copyright-url" label="Rights URL" value={fields.copyrightUrl} onChange={(copyrightUrl) => set({ copyrightUrl })} />
      <div className="monet-section-label" style={{ marginTop: 12, marginBottom: 6 }}>IPTC</div>
      <FileInfoField id="mv-file-info-headline" label="Headline" value={fields.headline} onChange={(headline) => set({ headline })} />
      <FileInfoField id="mv-file-info-credit" label="Credit Line" value={fields.credit} onChange={(credit) => set({ credit })} />
      <FileInfoField id="mv-file-info-source" label="Source" value={fields.source} onChange={(source) => set({ source })} />
      <FileInfoField id="mv-file-info-instructions" label="Instructions" value={fields.instructions} onChange={(instructions) => set({ instructions })} />
      <FileInfoField id="mv-file-info-city" label="City" value={fields.city} onChange={(city) => set({ city })} />
      <FileInfoField id="mv-file-info-state" label="State/Province" value={fields.state} onChange={(state) => set({ state })} />
      <FileInfoField id="mv-file-info-country" label="Country" value={fields.country} onChange={(country) => set({ country })} />
      <div className="monet-section-label" style={{ marginTop: 12, marginBottom: 6 }}>GPS</div>
      <FileInfoField id="mv-file-info-gps-lat" label="Latitude" value={lat} onChange={setLat} placeholder="Decimal degrees, e.g. 49.4194" />
      <FileInfoField id="mv-file-info-gps-lon" label="Longitude" value={lon} onChange={setLon} placeholder="Decimal degrees, e.g. 0.2333" />
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 6 }}>
        These fields are written as XMP (and EXIF caption/author/copyright/GPS) into PNG and JPEG exports, at the scope chosen in Export As ▸ Metadata.
      </div>
      <OpenedFileCredentials />
    </Dialog>
  );
}

const profileOptions = RGB_PROFILES.map((p) => ({ value: String(p.id), label: p.label }));
const cmykProfileOptions = CMYK_PROFILES.map((p) => ({ value: String(p.id), label: p.label }));
const grayProfileOptions = GRAY_PROFILES.map((p) => ({ value: String(p.id), label: p.label }));
const spotProfileOptions = SPOT_PROFILES.map((p) => ({ value: String(p.id), label: p.label }));
const colorSettingsPresetOptions = [
  { value: "custom", label: "Custom" },
  ...COLOR_SETTINGS_PRESETS.map((p) => ({ value: p.id, label: p.label })),
];
const intentOptions = RENDERING_INTENTS.map((i) => ({ value: String(i.id), label: i.label }));
const colorEngineOptions = COLOR_ENGINES.map((e) => ({ value: e.id, label: e.label }));
const embeddedProfilePolicyOptions = EMBEDDED_PROFILE_POLICIES.map((p) => ({ value: p.id, label: p.label }));
const missingProfilePolicyOptions = MISSING_PROFILE_POLICIES.map((p) => ({ value: p.id, label: p.label }));
const pasteProfilePolicyOptions = PASTE_PROFILE_POLICIES.map((p) => ({ value: p.id, label: p.label }));

// Photoshop's Assign / Convert / Color Settings popups list every ICC profile
// installed on the system; Vision lists the four built-ins plus a "Load
// Profile…" entry that reads an .icc/.icm off disk. The store already carries
// arbitrary profile bytes through to the engine, so the picker is the only
// missing half.
// ponytail: an on-demand file pick, not an enumeration of the ColorSync folders
// — scanning /Library/ColorSync/Profiles and parsing every `desc` tag is the
// upgrade path if picking the file each time proves annoying.
const IMPORT_ICC = "import-icc";
const CUSTOM_ICC = "custom-icc";

/** Shared state for the three profile popups: the selected built-in id, or an
 *  imported ICC profile plus the bytes/name the store needs to carry it.
 *  `spaces` widens what Load Profile… accepts beyond RGB. */
function useProfileChoice(initial: number, spaces?: readonly string[]) {
  const [value, setValue] = useState(String(initial));
  const [custom, setCustom] = useState<IccProfileInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => [
    ...profileOptions,
    ...(custom ? [{ value: CUSTOM_ICC, label: custom.name }] : []),
    { value: IMPORT_ICC, label: "Load Profile…" },
  ], [custom]);
  const onChange = (next: string) => {
    if (next !== IMPORT_ICC) { setValue(next); return; }
    void (async () => {
      try {
        const info = await importDocumentIccProfile(spaces);
        if (!info) return; // cancelled — keep the current selection
        setCustom(info);
        setValue(CUSTOM_ICC);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  };
  const picked = value === CUSTOM_ICC ? custom : null;
  return {
    value, options, onChange, error, setError,
    custom: picked,
    profile: picked ? picked.profile : (Number(value) || 0),
    /** Preset / loaded-settings paths: force a built-in and drop the import. */
    select: (id: number) => { setValue(String(id)); setCustom(null); },
  };
}

function ColorPolicyWarning({ kind, text }: { kind: string; text: string | null }) {
  if (!text) return null;
  return (
    <div
      data-mv-color-policy-warning={kind}
      style={{
        marginTop: 8,
        padding: "8px 9px",
        border: "1px solid rgba(245, 158, 11, 0.35)",
        borderRadius: 6,
        background: "rgba(245, 158, 11, 0.08)",
        color: "var(--text-2)",
        fontSize: 11,
        lineHeight: 1.35,
      }}
    >
      {text}
    </div>
  );
}

// Vision's Color Settings file — see monet-color for the .csf caveat.
const CSF_FILTERS = [{ name: "Color Settings", extensions: ["csf"] }];
const CSF_ACCEPT = ".csf,application/json";
const CSF_IMPORT_LIMIT: LocalImportLimit = { maxBytes: 256 * 1024, label: "color settings" };

// ponytail: a private copy of app.ts's browser picker — that module isn't
// exporting one and belongs to another surface; fold the two together when
// a second dialog needs to pick its own file.
function pickCsfFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = CSF_ACCEPT;
    // A cancelled picker fires `cancel`, never `change`: without this branch the
    // promise never settles (Color Settings ▸ Load… hangs with no status) and the
    // hidden input stays appended to the body. (#99)
    const settle = (file: File | null) => { input.remove(); resolve(file); };
    input.onchange = () => settle(input.files?.[0] ?? null);
    input.oncancel = () => settle(null);
    document.body.appendChild(input);
    input.click();
  });
}

/** Resolves false when the picker was cancelled; throws with a reportable
 *  message so the dialog can surface a failed write instead of losing it. */
async function saveColorSettingsFile(file: ColorSettingsFile): Promise<boolean> {
  const bytes = new TextEncoder().encode(serializeColorSettings(file));
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const target = await save({ defaultPath: "Color Settings.csf", filters: CSF_FILTERS });
    if (!target) return false;
    await atomicWriteBytes(target, bytes);
    return true;
  }
  saveBytes("Color Settings.csf", bytes, "application/json");
  return true;
}

/** Null when cancelled; throws when the file is unreadable or isn't ours. */
async function loadColorSettingsFile(base: ColorPolicyPrefs): Promise<ColorSettingsFile | null> {
  let bytes: Uint8Array;
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: false, filters: CSF_FILTERS });
    if (!sel || Array.isArray(sel)) return null;
    bytes = await readNativeFileBounded(sel, () => CSF_IMPORT_LIMIT);
  } else {
    const picked = await pickCsfFile();
    if (!picked) return null;
    bytes = await readBrowserImportBytes(picked, CSF_IMPORT_LIMIT);
  }
  const parsed = parseColorSettings(decodeImportText(bytes), base);
  if (!parsed) throw new Error("That file isn’t a Monet color settings file.");
  return parsed;
}

function ColorSettings() {
  const { close } = useDialogs();
  const choice = useProfileChoice(store.state.colorProfile);
  const [prefs, setPrefs] = useState<ColorPolicyPrefs>(store.state.colorPolicyPrefs);
  const [status, setStatus] = useState<string | null>(null);
  const set = <K extends keyof ColorPolicyPrefs>(key: K, value: ColorPolicyPrefs[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));
  const warning = profilePolicyWarning(store.state.colorProfile, choice.profile, "working", choice.custom?.name, store.state.iccProfileName);
  const press = cmykWorkingSpace(prefs.workingCmyk);
  // An imported working RGB is never one of the presets, and the .csf carries
  // built-in ids only, so both fall back to its nearest built-in.
  const matched = choice.custom ? null : matchColorSettingsPreset(choice.profile, prefs);
  const applyPreset = (id: string) => {
    const found = colorSettingsPreset(id);
    if (!found) return; // "Custom" is a readout, not a choice
    choice.select(found.workingRgb);
    setPrefs(found.prefs);
    setStatus(null);
  };
  const runFile = async (job: () => Promise<string | null>) => {
    try {
      setStatus(await job());
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };
  const save = () => void runFile(async () => (
    await saveColorSettingsFile({ workingRgb: choice.profile as RgbProfileId, prefs })
      ? choice.custom ? `Color settings saved (working RGB stored as ${documentProfileName(choice.profile)}).` : "Color settings saved."
      : null
  ));
  const load = () => void runFile(async () => {
    const loaded = await loadColorSettingsFile(prefs);
    if (!loaded) return null;
    choice.select(loaded.workingRgb);
    setPrefs(loaded.prefs);
    return "Color settings loaded.";
  });
  const ok = () => {
    const before = store.state.colorPolicyPrefs;
    store.assignProfile(choice.profile, choice.custom?.bytes, choice.custom?.name);
    store.setColorPolicyPrefs(prefs);
    // A new conversion default wins over the intent/BPC Convert to Profile
    // remembered from its last use, so the next conversion pre-fills it.
    if (prefs.intent !== before.intent || prefs.blackPointCompensation !== before.blackPointCompensation) {
      forgetConvertProfileDefaults();
    }
    close();
  };
  return (
    <Dialog open onClose={close} title="Color Settings" width={460}
      footer={<>
        <Button variant="ghost" onClick={load}>Load…</Button>
        <Button variant="ghost" onClick={save}>Save…</Button>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={ok}>OK</Button></>}>
      <TField label="Settings">
        <Select block id="mv-color-settings-preset" aria-label="Color settings preset"
          options={colorSettingsPresetOptions} value={matched?.id ?? "custom"} onChange={applyPreset} />
      </TField>

      <SectionLabel>Working Spaces</SectionLabel>
      <TField label="RGB"><Select block id="mv-color-settings-profile" aria-label="Color settings working RGB" options={choice.options} value={choice.value} onChange={choice.onChange} /></TField>
      <TField label="CMYK"><Select block id="mv-color-settings-cmyk" aria-label="Color settings working CMYK" options={cmykProfileOptions} value={String(prefs.workingCmyk)} onChange={(v) => set("workingCmyk", Number(v) as ColorPolicyPrefs["workingCmyk"])} /></TField>
      <TField label="Gray"><Select block id="mv-color-settings-gray" aria-label="Color settings working Gray" options={grayProfileOptions} value={String(prefs.workingGray)} onChange={(v) => set("workingGray", Number(v) as ColorPolicyPrefs["workingGray"])} /></TField>
      <TField label="Spot"><Select block id="mv-color-settings-spot" aria-label="Color settings working Spot" options={spotProfileOptions} value={String(prefs.workingSpot)} onChange={(v) => set("workingSpot", Number(v) as ColorPolicyPrefs["workingSpot"])} /></TField>
      <div data-mv-color-settings-press style={{ color: "var(--text-3)", fontSize: 11 }}>
        {press.label}: {Math.round(press.dotGain * 100)}% midtone dot gain, {Math.round(press.totalInkLimit * 100)}% total ink.
      </div>

      <SectionLabel>Color Management Policies</SectionLabel>
      <TField label="Embedded profile"><Select block id="mv-color-settings-embedded-policy" aria-label="Embedded profile policy" options={embeddedProfilePolicyOptions} value={prefs.embeddedProfilePolicy} onChange={(v) => set("embeddedProfilePolicy", v as ColorPolicyPrefs["embeddedProfilePolicy"])} /></TField>
      <TField label="Missing profile"><Select block id="mv-color-settings-missing-policy" aria-label="Missing profile policy" options={missingProfilePolicyOptions} value={prefs.missingProfilePolicy} onChange={(v) => set("missingProfilePolicy", v as ColorPolicyPrefs["missingProfilePolicy"])} /></TField>
      <TField label="Paste profile"><Select block id="mv-color-settings-paste-policy" aria-label="Paste profile policy" options={pasteProfilePolicyOptions} value={prefs.pasteProfilePolicy} onChange={(v) => set("pasteProfilePolicy", v as ColorPolicyPrefs["pasteProfilePolicy"])} /></TField>

      <SectionLabel>Conversion Options</SectionLabel>
      <TField label="Intent"><Select block id="mv-color-settings-intent" aria-label="Color settings intent" options={intentOptions} value={String(prefs.intent)} onChange={(v) => set("intent", Number(v) as RenderingIntentId)} /></TField>
      <Checkbox id="mv-color-settings-bpc" checked={prefs.blackPointCompensation} onChange={(v) => set("blackPointCompensation", v)}>Use Black Point Compensation</Checkbox>

      <SectionLabel>Advanced</SectionLabel>
      <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 7 }}>
        <Checkbox checked={prefs.desaturateMonitorColors} onChange={(v) => set("desaturateMonitorColors", v)}>Desaturate Monitor Colors By</Checkbox>
        <NumberField value={prefs.desaturateMonitorAmount} min={0} max={100} suffix="%"
          disabled={!prefs.desaturateMonitorColors} aria-label="Desaturate monitor colors amount"
          onChange={(v) => set("desaturateMonitorAmount", v)} />
      </div>
      <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 7 }}>
        <Checkbox checked={prefs.blendRgbColorsUsingGamma} onChange={(v) => set("blendRgbColorsUsingGamma", v)}>Blend RGB Colors Using Gamma</Checkbox>
        <NumberField value={prefs.blendRgbGamma} min={BLEND_GAMMA_MIN} max={BLEND_GAMMA_MAX} step={0.01}
          disabled={!prefs.blendRgbColorsUsingGamma} aria-label="Blend RGB colors gamma"
          onChange={(v) => set("blendRgbGamma", v)} />
      </div>
      <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 7 }}>
        <Checkbox checked={prefs.blendTextColorsUsingGamma} onChange={(v) => set("blendTextColorsUsingGamma", v)}
          aria-describedby="mv-color-settings-text-gamma-note">Blend Text Colors Using Gamma</Checkbox>
        <NumberField value={prefs.blendTextGamma} min={BLEND_GAMMA_MIN} max={BLEND_GAMMA_MAX} step={0.01}
          disabled={!prefs.blendTextColorsUsingGamma} aria-label="Blend text colors gamma"
          onChange={(v) => set("blendTextGamma", v)} />
      </div>
      <div id="mv-color-settings-text-gamma-note" style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 7 }}>
        Photoshop's default is on at 1.45; off keeps existing documents' type edges unchanged.
      </div>

      <ColorPolicyWarning kind="working-icc" text={choice.error} />
      <ColorPolicyWarning kind="working" text={warning} />
      {status && <div data-mv-color-settings-status style={{ color: "var(--text-2)", fontSize: 11, marginTop: 8 }}>{status}</div>}
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>
        Working RGB is the assigned profile for the active document; use Convert to Profile to transform pixels.
        Desaturate Monitor Colors changes only the screen; the blend gammas also shape Normal-mode painting, exports and Flatten.
      </div>
    </Dialog>
  );
}

function AssignProfile() {
  const { close } = useDialogs();
  const choice = useProfileChoice(store.state.colorProfile);
  const warning = profilePolicyWarning(store.state.colorProfile, choice.profile, "assign", choice.custom?.name, store.state.iccProfileName);
  const ok = () => {
    store.assignProfile(choice.profile, choice.custom?.bytes, choice.custom?.name);
    close();
  };
  return (
    <Dialog open onClose={close} title="Assign Profile" width={390}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" onClick={ok}>OK</Button></>}>
      <TField label="Profile"><Select block id="mv-assign-profile" aria-label="Assign profile" options={choice.options} value={choice.value} onChange={choice.onChange} /></TField>
      <ColorPolicyWarning kind="assign-icc" text={choice.error} />
      <ColorPolicyWarning kind="assign" text={warning} />
      <div style={{ color: "var(--text-3)", fontSize: 11 }}>
        Reinterprets existing RGB numbers under the selected profile without changing pixel values.
      </div>
    </Dialog>
  );
}

// Convert to Profile's Conversion Options persist between uses, the way Select
// and Mask remembers its settings. Saved on OK only: Cancel changes nothing.
const CONVERT_PROFILE_OPTIONS_KEY = "mv.convertToProfile";
function loadConvertProfileOptions(): ConvertProfileOptions {
  const { intent, blackPointCompensation } = store.state.colorPolicyPrefs; // first use: Color Settings' defaults
  try {
    return normalizeConvertProfileOptions(JSON.parse(localStorage.getItem(CONVERT_PROFILE_OPTIONS_KEY) ?? "null"), intent, blackPointCompensation);
  } catch { return normalizeConvertProfileOptions(null, intent, blackPointCompensation); }
}
function forgetConvertProfileDefaults() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONVERT_PROFILE_OPTIONS_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return;
    delete saved.intent;
    delete saved.blackPointCompensation;
    localStorage.setItem(CONVERT_PROFILE_OPTIONS_KEY, JSON.stringify(saved));
  } catch { /* storage denied or unreadable: nothing remembered to forget */ }
}

function ConvertToProfile() {
  const { close } = useDialogs();
  const choice = useProfileChoice(store.state.colorProfile, CONVERT_ICC_SPACES);
  const [options, setOptions] = useState(loadConvertProfileOptions);
  const set = <K extends keyof ConvertProfileOptions>(key: K, value: ConvertProfileOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: value }));
  const [flatten, setFlatten] = useState(false);
  // A CMYK, Gray or Lab destination separates the document and changes its mode.
  const deviceMode = choice.custom ? iccColorMode(choice.custom.colorSpace) : null;
  const warning = deviceMode
    ? `Converting to ${choice.custom?.name} separates the document through that profile and changes the mode to ${colorModeName(deviceMode)}.`
    : profilePolicyWarning(store.state.colorProfile, choice.profile, "convert", choice.custom?.name, store.state.iccProfileName);
  const ok = () => {
    // The engine re-validates the destination profile and throws when it can't
    // build the transform; show that inline instead of letting it escape the
    // click handler into the error boundary.
    try {
      store.convertToProfile(choice.profile, options.intent, options.blackPointCompensation, choice.custom?.bytes, choice.custom?.name, options.dither);
    } catch (e) {
      choice.setError(e instanceof Error ? e.message : String(e));
      return;
    }
    try { localStorage.setItem(CONVERT_PROFILE_OPTIONS_KEY, JSON.stringify(options)); } catch { /* storage denied */ }
    // ponytail: Photoshop flattens *before* converting; flattening after keeps a
    // failed conversion from having already collapsed the layers. Swap the order
    // if a document ever needs its composite blended in the source space.
    if (flatten) store.flatten();
    close();
  };
  return (
    <Dialog open onClose={close} title="Convert to Profile" width={420}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" onClick={ok}>OK</Button></>}>
      <TField label="Destination"><Select block id="mv-convert-profile" aria-label="Destination profile" options={choice.options} value={choice.value} onChange={choice.onChange} /></TField>
      <SectionLabel>Conversion Options</SectionLabel>
      <TField label="Engine"><Select block id="mv-convert-profile-engine" aria-label="Conversion engine" options={colorEngineOptions} value={options.engine} onChange={(v) => set("engine", v as ColorEngineId)} /></TField>
      <TField label="Intent"><Select block id="mv-convert-profile-intent" aria-label="Conversion intent" options={intentOptions} value={String(options.intent)} onChange={(v) => set("intent", Number(v) as RenderingIntentId)} /></TField>
      {/* On by default, like Photoshop. A no-op between the built-in matrix
          profiles (they reproduce a true zero black); it lifts shadows only when
          the destination carries a real black point (every press profile). */}
      <Checkbox id="mv-convert-profile-bpc" checked={options.blackPointCompensation} onChange={(v) => set("blackPointCompensation", v)}>Black Point Compensation</Checkbox>
      {/* Only 8-bit channels are dithered; 16/32-bit keep their precision. */}
      <Checkbox id="mv-convert-profile-dither" checked={options.dither} disabled={store.state.depth !== 8} onChange={(v) => set("dither", v)}>Use Dither</Checkbox>
      <Checkbox checked={flatten} onChange={setFlatten}>Flatten Image</Checkbox>
      <ColorPolicyWarning kind="convert-icc" text={choice.error} />
      <ColorPolicyWarning kind="convert" text={warning} />
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>
        Converts layer pixels into the destination profile. A CMYK, Gray or Lab destination also changes the document mode.
      </div>
    </Dialog>
  );
}

// Image ▸ Adjustments ▸ HDR Toning ▸ Local Adaptation — Photoshop's panel:
// Edge Glow, Tone and Detail, Advanced, and the Toning Curve. It is also the
// tone map for the 32-bit radiance document File ▸ Automate ▸ Merge to HDR Pro
// leaves behind. Slider units are Photoshop's; `hdrToningParams` converts them
// to the engine's neutral-at-1.0 exponents (see Engine::hdr_toning_pro).
interface HdrToningState {
  radius: number; strength: number; gamma: number; exposure: number; detail: number;
  shadow: number; highlight: number; vibrance: number; saturation: number;
}

// ponytail: our own tuning of Photoshop's preset names, not their shipped .hdt
// files. Save/load of user presets needs an "hdrToning" preset-manager category
// (state/presetManager.ts) before Load/Save Preset… can be wired here.
const HDR_TONING_PRESETS: { label: string; values: HdrToningState }[] = [
  { label: "Default", values: { radius: 16, strength: 52, gamma: 100, exposure: 0, detail: 30, shadow: 0, highlight: 0, vibrance: 20, saturation: 20 } },
  { label: "Photorealistic", values: { radius: 13, strength: 40, gamma: 100, exposure: 0, detail: 25, shadow: 0, highlight: 0, vibrance: 8, saturation: 8 } },
  { label: "Photorealistic High Contrast", values: { radius: 21, strength: 65, gamma: 95, exposure: 0, detail: 40, shadow: -8, highlight: -6, vibrance: 12, saturation: 12 } },
  { label: "Surrealistic", values: { radius: 45, strength: 130, gamma: 105, exposure: 0.3, detail: 120, shadow: 25, highlight: -25, vibrance: 35, saturation: 35 } },
  { label: "Monochromatic Artistic", values: { radius: 30, strength: 90, gamma: 100, exposure: 0.2, detail: 60, shadow: 10, highlight: -15, vibrance: 0, saturation: -100 } },
  { label: "Saturated", values: { radius: 16, strength: 52, gamma: 100, exposure: 0, detail: 30, shadow: 0, highlight: 0, vibrance: 60, saturation: 55 } },
  { label: "Flat", values: { radius: 8, strength: 20, gamma: 100, exposure: 0, detail: 0, shadow: 0, highlight: 0, vibrance: 0, saturation: 0 } },
];

// Pack the panel into the engine's params slice: nine controls, then the 256
// toning-curve entries — appended only when the curve is not the identity, so a
// neutral panel stays an exact no-op instead of round-tripping through the LUT.
function hdrToningParams(s: HdrToningState, curve: CurvePoint[]): Float32Array {
  const p = [
    s.radius, s.strength / 100, s.gamma / 100, s.exposure, 1 + s.detail / 100,
    s.shadow / 100, s.highlight / 100, s.vibrance / 100, s.saturation / 100,
  ];
  const lut = buildLut(curve);
  if (lut.some((v, i) => v !== i)) for (const v of lut) p.push(v / 255);
  return new Float32Array(p);
}

function HdrToning() {
  const [preset, setPreset] = useState(HDR_TONING_PRESETS[0].label);
  const [state, setState] = useState<HdrToningState>(HDR_TONING_PRESETS[0].values);
  const [curve, setCurve] = useState<CurvePoint[]>(diagonalPoints);
  // Any manual edit drops the preset label, exactly as Photoshop's does.
  const set = (patch: Partial<HdrToningState>) => { setPreset("Custom"); setState((s) => ({ ...s, ...patch })); };
  const pick = (label: string) => {
    const found = HDR_TONING_PRESETS.find((p) => p.label === label);
    setPreset(label);
    if (found) setState(found.values);
  };
  return (
    <PreviewDialog title="HDR Toning" width={460} deps={[state, curve]}
      apply={() => adj.hdrTonePro(hdrToningParams(state, curve))}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 96 }}>Preset</span>
        <Select block id="mv-hdr-toning-preset" aria-label="HDR Toning preset" value={preset} onChange={pick}
          options={[...HDR_TONING_PRESETS.map((p) => ({ value: p.label, label: p.label })), { value: "Custom", label: "Custom" }]} />
      </div>
      <div className="monet-section-label">Edge Glow</div>
      <Row label="Radius" value={state.radius} min={1} max={200} suffix="px" onChange={(v) => set({ radius: v })} />
      <Row label="Strength" value={state.strength} min={0} max={400} suffix="%" onChange={(v) => set({ strength: v })} />
      <div className="monet-section-label">Tone and Detail</div>
      <Row label="Gamma" value={state.gamma} min={10} max={250} suffix="%" onChange={(v) => set({ gamma: v })} />
      <Row label="Exposure" value={state.exposure} min={-5} max={5} decimals={2} suffix=" EV" onChange={(v) => set({ exposure: v })} />
      <Row label="Detail" value={state.detail} min={-100} max={300} suffix="%" onChange={(v) => set({ detail: v })} />
      <div className="monet-section-label">Advanced</div>
      <Row label="Shadow" value={state.shadow} min={-100} max={100} suffix="%" onChange={(v) => set({ shadow: v })} />
      <Row label="Highlight" value={state.highlight} min={-100} max={100} suffix="%" onChange={(v) => set({ highlight: v })} />
      <Row label="Vibrance" value={state.vibrance} min={-100} max={100} suffix="%" onChange={(v) => set({ vibrance: v })} />
      <Row label="Saturation" value={state.saturation} min={-100} max={100} suffix="%" onChange={(v) => set({ saturation: v })} />
      <div className="monet-section-label">Toning Curve</div>
      <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 8px" }}>
        <CurveEditor points={curve} onChange={(p) => { setPreset("Custom"); setCurve(p); }} width={256} height={256}
          accent={ACCENT} xRange={[0, 255]} yRange={[0, 255]} aria-label="Toning curve" />
      </div>
      <div className="monet-row" style={{ justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={() => setCurve(diagonalPoints())}>Reset Curve</Button>
      </div>
    </PreviewDialog>
  );
}

function SelectiveColorDialog() {
  const [band, setBand] = useState(0);
  const [state, setState] = useState<SelectiveColorState>(defaultSelectiveColor);
  const cur = state.bands[band];
  return (
    <PreviewDialog title="Selective Color" width={420} deps={[band, state]}
      apply={() => adj.selectiveColor(packSelectiveColor(state), state.relative)}>
      <div style={{ marginBottom: 8 }}>
        <Select options={SELECTIVE_BANDS.map((b, i) => ({ value: String(i), label: b }))}
          value={String(band)} onChange={(v) => setBand(Number(v))} />
      </div>
      {CMYK_LABELS.map((label, ch) => (
        <Row key={label} label={label} value={cur[ch]} min={CMYK_MIN} max={CMYK_MAX} suffix="%"
          onChange={(v) => setState((s) => setBandCmyk(s, band, ch, v))} />
      ))}
      <div style={{ marginTop: 8 }}>
        <SegmentedControl accent={ACCENT} value={state.relative ? "rel" : "abs"} onChange={(v) => setState((s) => ({ ...s, relative: v === "rel" }))}
          items={[{ value: "rel", label: "Relative" }, { value: "abs", label: "Absolute" }]} />
      </div>
    </PreviewDialog>
  );
}

function Posterize() {
  const [n, setN] = useState(DEFAULT_LEVELS);
  return (
    <PreviewDialog title="Posterize" deps={[n]} apply={() => adj.posterize(clampLevels(n))}>
      <Row label="Levels" value={n} min={POSTERIZE_MIN} max={32} onChange={setN} />
    </PreviewDialog>
  );
}
function Threshold() {
  const [t, setT] = useState(DEFAULT_THRESHOLD);
  return (
    <PreviewDialog title="Threshold" deps={[t]} apply={() => adj.threshold(thresholdFraction(t))}>
      <Row label="Level" value={t} min={THRESHOLD_MIN} max={THRESHOLD_MAX} onChange={setT} />
    </PreviewDialog>
  );
}

function ChannelMixer() {
  const [state, setState] = useState<ChannelMixerState>(defaultMixer);
  const [output, setOutput] = useState<OutputChannel>(0);
  return (
    <PreviewDialog title="Channel Mixer" width={420} deps={[state]} apply={() => adj.channelMixer(packMixer(state))}>
      <ChannelMixerControls state={state} output={output} setOutput={setOutput} onChange={setState} />
    </PreviewDialog>
  );
}

function GradientMapDialog() {
  const [key, setKey] = useState(GRADIENT_MAP_PRESETS[0].name);
  const [reverse, setReverse] = useState(false);
  const lut = useMemo(
    () => buildGradientMapLutRgba(gradientMapPreset(key).stops, { reverse }),
    [key, reverse],
  );
  return (
    <PreviewDialog title="Gradient Map" deps={[key, reverse]} apply={() => adj.gradientMap(lut)}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {GRADIENT_MAP_PRESETS.map((p) => (
          <Button key={p.name} size="sm" variant={p.name === key ? "primary" : "ghost"} onClick={() => setKey(p.name)}>{p.name}</Button>
        ))}
      </div>
      <div className="monet-row" style={{ marginTop: 8 }}>
        <Checkbox checked={reverse} onChange={setReverse}>Reverse</Checkbox>
      </div>
    </PreviewDialog>
  );
}

// ── filter dialogs ─────────────────────────────────────────────
function GaussianBlur() {
  const [r, setR] = useState(4);
  return (
    <PreviewDialog title="Gaussian Blur" deps={[r]} apply={() => fil.gaussian(r)}>
      <Row label="Radius" value={r} min={0} max={60} decimals={1} onChange={setR} suffix="px" />
    </PreviewDialog>
  );
}
function BoxBlur() {
  const [r, setR] = useState(3);
  return (
    <PreviewDialog title="Box Blur" deps={[r]} apply={() => fil.box(Math.round(r))}>
      <Row label="Radius" value={r} min={1} max={30} onChange={setR} suffix="px" />
    </PreviewDialog>
  );
}
function Unsharp() {
  const [r, setR] = useState(2); const [a, setA] = useState(100); const [t, setT] = useState(0);
  return (
    <PreviewDialog title="Unsharp Mask" deps={[r, a, t]} apply={() => fil.unsharp(r, a / 100, t / 255)}>
      <Row label="Radius" value={r} min={0.1} max={250} decimals={1} onChange={setR} suffix="px" />
      <Row label="Amount" value={a} min={1} max={500} onChange={setA} suffix="%" />
      <Row label="Threshold" value={t} min={0} max={255} onChange={setT} />
    </PreviewDialog>
  );
}
function AddNoise() {
  const [a, setA] = useState(12); const [mono, setMono] = useState(false); const [gaussian, setGaussian] = useState(false);
  // Smart-filter params are f32, so keep the u32 seed in their exact integer range.
  const seed = useRef(Math.floor(Math.random() * 0x100_0000)).current;
  return (
    <PreviewDialog title="Add Noise" deps={[a, mono, gaussian]} apply={() => fil.noise(a / 100, mono, gaussian, seed)}>
      <Row label="Amount" value={a} min={0} max={100} onChange={setA} suffix="%" />
      <div className="monet-row" style={{ marginTop: 4, gap: 16 }}>
        <Checkbox checked={gaussian} onChange={setGaussian}>Gaussian</Checkbox>
        <Checkbox checked={mono} onChange={setMono}>Monochromatic</Checkbox>
      </div>
    </PreviewDialog>
  );
}
function Median() {
  const [r, setR] = useState(2);
  return (
    <PreviewDialog title="Median (Noise Reduction)" deps={[r]} apply={() => fil.median(Math.round(r))}>
      <Row label="Radius" value={r} min={1} max={8} onChange={setR} suffix="px" />
    </PreviewDialog>
  );
}
function MotionBlur() {
  const [ang, setAng] = useState(0); const [dist, setDist] = useState(20);
  return (
    <PreviewDialog title="Motion Blur" deps={[ang, dist]} apply={() => fil.motion(ang, dist)}>
      <Row label="Angle" value={ang} min={-360} max={360} onChange={setAng} suffix="°" />
      <Row label="Distance" value={dist} min={1} max={999} onChange={setDist} suffix="px" />
    </PreviewDialog>
  );
}
function Emboss() {
  const [ang, setAng] = useState(135); const [amt, setAmt] = useState(100);
  const [height, setHeight] = useState(1);
  return (
    <PreviewDialog title="Emboss" deps={[ang, amt, height]} apply={() => fil.emboss(ang, amt / 100, height)}>
      <Row label="Angle" value={ang} min={-360} max={360} onChange={setAng} suffix="°" />
      <Row label="Height" value={height} min={1} max={100} onChange={setHeight} suffix=" px" />
      <Row label="Amount" value={amt} min={1} max={500} onChange={setAmt} suffix="%" />
    </PreviewDialog>
  );
}

function HighPass() {
  const [r, setR] = useState(3);
  return (
    <PreviewDialog title="High Pass" deps={[r]} apply={() => fil.highPass(r)}>
      <Row label="Radius" value={r} min={0.5} max={50} decimals={1} onChange={setR} suffix="px" />
    </PreviewDialog>
  );
}
function Mosaic() {
  const [s, setS] = useState(12);
  return (
    <PreviewDialog title="Mosaic (Pixelate)" deps={[s]} apply={() => fil.mosaic(Math.round(s))}>
      <Row label="Cell size" value={s} min={2} max={80} onChange={setS} suffix="px" />
    </PreviewDialog>
  );
}
function VignetteDialog() {
  const [a, setA] = useState(40);
  return (
    <PreviewDialog title="Vignette" deps={[a]} apply={() => fil.vignette(a / 100)}>
      <Row label="Amount" value={a} min={0} max={100} onChange={setA} suffix="%" />
    </PreviewDialog>
  );
}
// Filter ▸ Stylize ▸ Oil Paint — Photoshop's Brush + Lighting control set.
function OilPaint() {
  const [stylization, setStylization] = useState(2.5);
  const [cleanliness, setCleanliness] = useState(5);
  const [scale, setScale] = useState(3);
  const [bristle, setBristle] = useState(5);
  const [angle, setAngle] = useState(0);
  const [shine, setShine] = useState(2);
  return (
    <PreviewDialog title="Oil Paint" deps={[stylization, cleanliness, scale, bristle, angle, shine]}
      apply={() => neural.oilPaint(stylization, cleanliness, scale, bristle, angle, shine)}>
      <div className="lbl" style={{ margin: "2px 0 6px" }}>Brush</div>
      <Row label="Stylization" value={stylization} min={0.1} max={10} decimals={1} onChange={setStylization} />
      <Row label="Cleanliness" value={cleanliness} min={0} max={10} decimals={1} onChange={setCleanliness} />
      <Row label="Scale" value={scale} min={0.1} max={10} decimals={1} onChange={setScale} />
      <Row label="Bristle Detail" value={bristle} min={0} max={10} decimals={1} onChange={setBristle} />
      <div className="lbl" style={{ margin: "8px 0 6px" }}>Lighting</div>
      <Row label="Angle" value={angle} min={0} max={360} onChange={setAngle} suffix="°" />
      <Row label="Shine" value={shine} min={0} max={10} decimals={1} onChange={setShine} />
    </PreviewDialog>
  );
}
function Pinch() {
  const [a, setA] = useState(40);
  return (
    <PreviewDialog title="Pinch" deps={[a]} apply={() => distort.pinch(a / 100)}>
      <Row label="Amount" value={a} min={-100} max={100} onChange={setA} suffix="%" />
    </PreviewDialog>
  );
}
function Spherize() {
  const [a, setA] = useState(40);
  const [mode, setMode] = useState(0); // 0 Normal, 1 Horizontal only, 2 Vertical only
  return (
    <PreviewDialog title="Spherize" deps={[a, mode]} apply={() => distort.spherize(a / 100, mode)}>
      <Row label="Amount" value={a} min={-100} max={100} onChange={setA} suffix="%" />
      <div className="monet-row" style={{ gap: 10, marginTop: 6 }}>
        <span className="lbl" style={{ width: 70 }}>Mode</span>
        <Select aria-label="Mode" value={String(mode)} onChange={(v) => setMode(+v)}
          options={[{ value: "0", label: "Normal" }, { value: "1", label: "Horizontal Only" }, { value: "2", label: "Vertical Only" }]} />
      </div>
    </PreviewDialog>
  );
}
function Twirl() {
  const [a, setA] = useState(120);
  return (
    <PreviewDialog title="Twirl" deps={[a]} apply={() => distort.twirl(a)}>
      <Row label="Angle" value={a} min={-360} max={360} onChange={setA} suffix="°" />
    </PreviewDialog>
  );
}
function PolarCoordinates() {
  const [toPolar, setToPolar] = useState(true);
  return (
    <PreviewDialog title="Polar Coordinates" deps={[toPolar]} apply={() => distort.polar(toPolar)}>
      <SegmentedControl value={toPolar ? "1" : "0"} onChange={(v) => setToPolar(v === "1")}
        items={[{ value: "1", label: "Rectangular to Polar" }, { value: "0", label: "Polar to Rectangular" }]} />
    </PreviewDialog>
  );
}
function LensFlare() {
  const [b, setB] = useState(100);
  const [lens, setLens] = useState("0");
  const [cx, setCx] = useState(50);
  const [cy, setCy] = useState(50);
  const lenses = [
    { value: "0", label: "50-300mm Zoom" },
    { value: "1", label: "35mm Prime" },
    { value: "2", label: "105mm Prime" },
    { value: "3", label: "Movie Prime" },
  ];
  return (
    <PreviewDialog title="Lens Flare" deps={[b, lens, cx, cy]} apply={() => fil.lensFlare(b / 100, +lens, cx / 100, cy / 100)}>
      <Row label="Brightness" value={b} min={10} max={300} onChange={setB} suffix="%" />
      <Row label="Center X" value={cx} min={0} max={100} onChange={setCx} suffix="%" />
      <Row label="Center Y" value={cy} min={0} max={100} onChange={setCy} suffix="%" />
      <div className="lbl" style={{ margin: "8px 0 6px" }}>Lens Type</div>
      <Select value={lens} onChange={setLens} options={lenses} />
    </PreviewDialog>
  );
}
function Ripple() {
  const [amount, setAmount] = useState(100);
  const [size, setSize] = useState("1"); // 0 small · 1 medium · 2 large
  return (
    <PreviewDialog title="Ripple" deps={[amount, size]} apply={() => distort.ripple(amount, +size)}>
      <Row label="Amount" value={amount} min={-999} max={999} onChange={setAmount} suffix="%" />
      <div className="lbl" style={{ margin: "8px 0 6px" }}>Size</div>
      <SegmentedControl value={size} onChange={setSize}
        items={[{ value: "0", label: "Small" }, { value: "1", label: "Medium" }, { value: "2", label: "Large" }]} />
    </PreviewDialog>
  );
}
function ZigZag() {
  const [amount, setAmount] = useState(50);
  const [ridges, setRidges] = useState(5);
  const [style, setStyle] = useState("2"); // 0 around · 1 out · 2 pond
  return (
    <PreviewDialog title="ZigZag" deps={[amount, ridges, style]} apply={() => distort.zigzag(amount, Math.round(ridges), +style)}>
      <Row label="Amount" value={amount} min={-100} max={100} onChange={setAmount} />
      <Row label="Ridges" value={ridges} min={1} max={20} onChange={setRidges} />
      <div className="lbl" style={{ margin: "8px 0 6px" }}>Style</div>
      <SegmentedControl value={style} onChange={setStyle}
        items={[{ value: "0", label: "Around Center" }, { value: "1", label: "Out From Center" }, { value: "2", label: "Pond Ripples" }]} />
    </PreviewDialog>
  );
}
function Shear() {
  const { close } = useDialogs();
  const [top, setTop] = useState(8);
  const [bottom, setBottom] = useState(0);
  const [area, setArea] = useState("0"); // 0 repeat-edge · 1 wrap
  const inp = { ...INP_BASE, width: 70 };
  const field = (label: string, value: number, set: (n: number) => void) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 96 }}>{label}</span>
      <input type="number" value={value} aria-label={label} style={inp} onChange={(e) => set(Number(e.currentTarget.value) || 0)} />
    </div>
  );
  return (
    <Dialog open onClose={close} title="Shear" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { distort.shear(top, bottom, area === "1"); close(); }}>OK</Button></>}>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 10 }}>Slides each row sideways, from Top to Bottom.</div>
      {field("Top Offset", top, setTop)}
      {field("Bottom Offset", bottom, setBottom)}
      <div className="lbl" style={{ margin: "8px 0 6px" }}>Undefined Areas</div>
      <SegmentedControl value={area} onChange={setArea}
        items={[{ value: "0", label: "Repeat Edge Pixels" }, { value: "1", label: "Wrap Around" }]} />
    </Dialog>
  );
}
function DiffuseGlow() {
  const { close } = useDialogs();
  const [graininess, setGrain] = useState(0);
  const [glow, setGlow] = useState(10);
  const [clear, setClear] = useState(5);
  return (
    <Dialog open onClose={close} title="Diffuse Glow" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { distort.diffuseGlow(graininess, glow, clear); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Graininess</span>
        <NumberField value={graininess} min={0} max={10} onChange={setGrain} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Glow Amount</span>
        <NumberField value={glow} min={0} max={20} onChange={setGlow} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Clear Amount</span>
        <NumberField value={clear} min={0} max={20} onChange={setClear} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>The glow uses the background color.</div>
    </Dialog>
  );
}
function Wave() {
  const { close } = useDialogs();
  const [gens, setGens] = useState(5);
  const [wlMin, setWlMin] = useState(10);
  const [wlMax, setWlMax] = useState(120);
  const [ampMin, setAmpMin] = useState(5);
  const [ampMax, setAmpMax] = useState(35);
  const [scaleH, setScaleH] = useState(100);
  const [scaleV, setScaleV] = useState(100);
  const [type, setType] = useState("0"); // 0 sine · 1 triangle · 2 square
  const [area, setArea] = useState("0"); // 0 repeat-edge · 1 wrap
  const inp = { ...INP_BASE, width: 66 };
  const field = (label: string, value: number, set: (n: number) => void) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 150 }}>{label}</span>
      <input type="number" value={value} aria-label={label} style={inp} onChange={(e) => set(Number(e.currentTarget.value) || 0)} />
    </div>
  );
  return (
    <Dialog open onClose={close} title="Wave" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { distort.wave(Math.max(1, Math.round(gens)), wlMin, wlMax, ampMin, ampMax, scaleH / 100, scaleV / 100, +type, area === "1"); close(); }}>OK</Button></>}>
      {field("Number of Generators", gens, setGens)}
      {field("Wavelength Min", wlMin, setWlMin)}
      {field("Wavelength Max", wlMax, setWlMax)}
      {field("Amplitude Min", ampMin, setAmpMin)}
      {field("Amplitude Max", ampMax, setAmpMax)}
      {field("Scale Horiz %", scaleH, setScaleH)}
      {field("Scale Vert %", scaleV, setScaleV)}
      <div className="lbl" style={{ margin: "4px 0 6px" }}>Type</div>
      <SegmentedControl value={type} onChange={setType}
        items={[{ value: "0", label: "Sine" }, { value: "1", label: "Triangle" }, { value: "2", label: "Square" }]} />
      <div className="lbl" style={{ margin: "10px 0 6px" }}>Undefined Areas</div>
      <SegmentedControl value={area} onChange={setArea}
        items={[{ value: "0", label: "Repeat Edge Pixels" }, { value: "1", label: "Wrap Around" }]} />
    </Dialog>
  );
}
function RadialBlur() {
  const { close } = useDialogs();
  const [amount, setAmount] = useState(50);
  const [method, setMethod] = useState("0"); // 0 spin · 1 zoom
  const [quality, setQuality] = useState("1"); // 0 draft · 1 good · 2 best
  const [cx, setCx] = useState(50);
  const [cy, setCy] = useState(50);
  return (
    <Dialog open onClose={close} title="Radial Blur" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { distort.radialBlur(Math.round(amount), method === "1", cx / 100, cy / 100, +quality); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 12 }}>
        <span className="lbl" style={{ width: 60 }}>Amount</span>
        <NumberField value={amount} min={1} max={100} onChange={setAmount} />
      </div>
      <div className="lbl" style={{ marginBottom: 6 }}>Blur Method</div>
      <SegmentedControl value={method} onChange={setMethod}
        items={[{ value: "0", label: "Spin" }, { value: "1", label: "Zoom" }]} />
      <div className="lbl" style={{ margin: "12px 0 6px" }}>Quality</div>
      <SegmentedControl value={quality} onChange={setQuality}
        items={[{ value: "0", label: "Draft" }, { value: "1", label: "Good" }, { value: "2", label: "Best" }]} />
      <div className="monet-row" style={{ gap: 10, marginTop: 12 }}>
        <span className="lbl" style={{ width: 60 }}>Center X</span>
        <NumberField value={cx} min={0} max={100} onChange={setCx} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginTop: 6 }}>
        <span className="lbl" style={{ width: 60 }}>Center Y</span>
        <NumberField value={cy} min={0} max={100} onChange={setCy} suffix="%" />
      </div>
    </Dialog>
  );
}

// ── document dialogs (no preview) ──────────────────────────────
function RenameLayer() {
  const { close } = useDialogs();
  const ownerDocId = useRef(store.state.activeDocId).current;
  const ownerLayerId = useRef(store.state.activeLayerId).current;
  const active = store.state.layers.find((l) => l.id === ownerLayerId);
  const [name, setName] = useState(active?.name ?? "Layer");
  const commit = () => {
    const n = name.trim();
    commitOwnedEdit(ownerDocId, store.state.activeDocId, () => { if (n) store.renameLayer(ownerLayerId, n); }, close);
  };
  return (
    <Dialog open onClose={close} title="Rename Layer" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 48 }}>Name</span>
        <input type="text" value={name} aria-label="Layer name" autoFocus
          style={{ ...INP_BASE, flex: 1 }}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      </div>
    </Dialog>
  );
}
function NewLayer() {
  const { close } = useDialogs();
  // Capture the names once so the auto-numbered default is stable while the dialog
  // is open (Photoshop pre-fills "Layer N").
  const namesAtOpen = store.state.layers.map((l) => l.name);
  const [name, setName] = useState(() => defaultLayerName(namesAtOpen));
  const [label, setLabel] = useState<LayerLabel>("none");
  const [mode, setMode] = useState("normal");
  const [opacity, setOpacity] = useState(100);
  const create = () => {
    store.addLayer(); // creates + activates the new layer
    const id = store.state.activeLayerId;
    store.renameLayer(id, resolveLayerName(name, namesAtOpen));
    if (mode !== "normal") store.setLayerBlend(id, mode);
    const op = clampLayerOpacity(opacity);
    if (op !== 100) store.setLayerOpacity(id, op);
    if (label !== "none") store.setLayerColorLabel(id, label);
    close();
  };
  return (
    <Dialog open onClose={close} title="New Layer" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={create}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 64 }}>Name</span>
        <input id="mv-newlayer-name" type="text" value={name} aria-label="Layer name" autoFocus
          style={{ ...INP_BASE, flex: 1 }}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 64 }}>Color</span>
        <Select id="mv-newlayer-color" value={label} aria-label="Color label" style={{ flex: 1 }}
          onChange={(v) => setLabel(v as LayerLabel)}
          options={LAYER_LABELS} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 64 }}>Mode</span>
        <Select id="mv-newlayer-mode" value={mode} aria-label="Blend mode" style={{ flex: 1 }}
          onChange={(v) => setMode(v)} options={BLEND_MODES} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 64 }}>Opacity</span>
        <NumberField id="mv-newlayer-opacity" value={opacity} min={0} max={100} onChange={setOpacity} suffix="%" />
      </div>
    </Dialog>
  );
}
function NewGroup() {
  const { close } = useDialogs();
  // Capture names once so the auto-numbered default is stable while open
  // (Photoshop pre-fills "Group N").
  const namesAtOpen = store.state.layers.map((l) => l.name);
  const [name, setName] = useState(() => defaultGroupName(namesAtOpen));
  const [label, setLabel] = useState<LayerLabel>("none");
  const [mode, setMode] = useState("pass-through"); // Photoshop's group default
  const [opacity, setOpacity] = useState(100);
  const create = () => {
    // The engine may not activate the new group, so diff layer ids to find it.
    const before = new Set(store.state.layers.map((l) => l.id));
    store.createGroup(); // empty group, named "Group N", pass-through blend
    const made = store.state.layers.find((l) => !before.has(l.id));
    if (made) {
      store.renameLayer(made.id, resolveGroupName(name, namesAtOpen));
      if (mode !== "pass-through") store.setLayerBlend(made.id, mode);
      const op = clampLayerOpacity(opacity);
      if (op !== 100) store.setLayerOpacity(made.id, op);
      if (label !== "none") store.setLayerColorLabel(made.id, label);
    }
    close();
  };
  return (
    <Dialog open onClose={close} title="New Group" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={create}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 64 }}>Name</span>
        <input id="mv-newgroup-name" type="text" value={name} aria-label="Group name" autoFocus
          style={{ ...INP_BASE, flex: 1 }}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 64 }}>Color</span>
        <Select id="mv-newgroup-color" value={label} aria-label="Color label" style={{ flex: 1 }}
          onChange={(v) => setLabel(v as LayerLabel)}
          options={LAYER_LABELS} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 64 }}>Mode</span>
        <Select id="mv-newgroup-mode" value={mode} aria-label="Blend mode" style={{ flex: 1 }}
          onChange={(v) => setMode(v)} options={GROUP_BLEND_OPTIONS} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 64 }}>Opacity</span>
        <NumberField id="mv-newgroup-opacity" value={opacity} min={0} max={100} onChange={setOpacity} suffix="%" />
      </div>
    </Dialog>
  );
}
function DuplicateLayer() {
  const { close } = useDialogs();
  const active = store.state.layers.find((l) => l.id === store.state.activeLayerId);
  // Capture names once so the collision-avoiding "<name> copy" default stays stable
  // while the dialog is open (Photoshop's "As" field, pre-filled).
  const namesAtOpen = store.state.layers.map((l) => l.name);
  const baseName = active?.name ?? "Layer";
  const [name, setName] = useState(() => defaultDuplicateName(baseName, namesAtOpen));
  const commit = () => {
    if (active) {
      // The engine may not activate the copy, so diff layer ids to find it.
      const before = new Set(store.state.layers.map((l) => l.id));
      store.duplicateLayer(active.id);
      const made = store.state.layers.find((l) => !before.has(l.id));
      if (made) store.renameLayer(made.id, name.trim() || defaultDuplicateName(baseName, namesAtOpen));
    }
    close();
  };
  return (
    <Dialog open onClose={close} title="Duplicate Layer" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 48 }}>As</span>
        <input id="mv-duplayer-name" type="text" value={name} aria-label="Duplicate layer name" autoFocus
          style={{ ...INP_BASE, flex: 1 }}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      </div>
    </Dialog>
  );
}
function FindReplace() {
  const { close } = useDialogs();
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [allLayers, setAllLayers] = useState(true);
  const [status, setStatus] = useState("");
  const run = () => {
    const n = text.findReplace(find, replace, { caseSensitive, allLayers });
    setStatus(find ? `${n} replacement${n === 1 ? "" : "s"} made` : "");
  };
  return (
    <Dialog open onClose={close} title="Find and Replace Text" width={400}
      footer={<><span className="val" style={{ flex: 1, opacity: 0.7 }}>{status}</span>
        <Button variant="ghost" onClick={close}>Done</Button>
        <Button variant="primary" onClick={run}>Replace All</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 64 }}>Find</span>
        <input type="text" value={find} aria-label="Find text" autoFocus
          style={{ ...INP_BASE, flex: 1 }}
          onChange={(e) => setFind(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 64 }}>Change To</span>
        <input type="text" value={replace} aria-label="Replace with"
          style={{ ...INP_BASE, flex: 1 }}
          onChange={(e) => setReplace(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }} />
      </div>
      <Checkbox checked={allLayers} onChange={setAllLayers}>Search All Layers</Checkbox>
      <Checkbox checked={caseSensitive} onChange={setCaseSensitive}>Case Sensitive</Checkbox>
    </Dialog>
  );
}
function SpellCheck() {
  const { close } = useDialogs();
  const [targets] = useState(() => store.state.layers.flatMap((layer) => {
    const spec = layer.visible && !layer.locked ? text.get(layer.id) : null;
    return spec ? [{ id: layer.id, name: layer.name, spec }] : [];
  }));
  const active = targets.find((target) => target.id === store.state.activeLayerId);
  const [allLayers, setAllLayers] = useState(false);
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(targets.map((target) => [target.id, text.fullText(target.spec)])));
  const shown = allLayers ? targets : active ? [active] : [];
  const apply = () => {
    for (const target of shown) {
      if (values[target.id] !== text.fullText(target.spec)) text.apply(target.id, text.setText(target.spec, values[target.id]));
    }
    close();
  };
  return (
    <Dialog open onClose={close} title="Check Spelling" width={440}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!active} onClick={apply}>Apply</Button></>}>
      {active ? <>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
          Misspellings are underlined. Right-click a word for suggestions.
        </div>
        {targets.length > 1 && <Checkbox checked={allLayers} onChange={setAllLayers}>Check All Layers</Checkbox>}
        <div style={{ maxHeight: "50vh", overflowY: "auto", marginTop: 8 }}>
          {shown.map((target, i) => <div key={target.id} style={{ marginBottom: i < shown.length - 1 ? 10 : 0 }}>
            {allLayers && <div className="lbl" style={{ marginBottom: 4 }}>{target.name}</div>}
            <Textarea aria-label={`Text to check — ${target.name}`} data-mv-spell-layer={target.id}
              value={values[target.id]} rows={allLayers ? 4 : 8} block autoFocus={i === 0} spellCheck
              lang={navigator.language} onChange={(e) => {
                const value = e.currentTarget.value;
                setValues((current) => ({ ...current, [target.id]: value }));
              }} />
          </div>)}
        </div>
      </> : <div style={{ color: "var(--text-2)" }}>Select an editable type layer.</div>}
    </Dialog>
  );
}
const STAT_OPTIONS = STAT_MODES.map((m) => ({
  value: String(m.mode), label: m.label, disabled: !statModeReady(m.mode),
}));
function Statistics() {
  const { close } = useDialogs();
  const [mode, setMode] = useState(0);
  const commit = () => { store.stackStatistic(mode); close(); };
  return (
    <Dialog open onClose={close} title="Image Statistics" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 96 }}>Stack Mode</span>
        <Select value={String(mode)} onChange={(v) => setMode(+v)} options={STAT_OPTIONS} />
      </div>
      <p className="val" style={{ opacity: 0.6, marginTop: 10, fontSize: 12 }}>
        Combines the visible layers into a new layer by a per-pixel statistic.
        Dimmed modes are not available yet.
      </p>
    </Dialog>
  );
}
function SmartStackMode() {
  const { close } = useDialogs();
  const [mode, setMode] = useState(1);
  const commit = () => {
    const before = store.state.activeLayerId;
    store.stackStatistic(mode);
    const after = store.state.activeLayerId;
    if (after !== before) store.renameLayer(after, `Smart Stack ${statModeLabel(mode)}`);
    close();
  };
  return (
    <Dialog open onClose={close} title="Smart Object Stack Mode" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 96 }}>Stack Mode</span>
        <Select value={String(mode)} onChange={(v) => setMode(+v)} options={STAT_OPTIONS} />
      </div>
      <p className="val" style={{ opacity: 0.6, marginTop: 10, fontSize: 12 }}>
        Combines the visible layers into a new stack-mode layer. Dimmed modes are
        not available yet, and the stack is merged rather than re-editable.
      </p>
    </Dialog>
  );
}
function CommandSearch() {
  const { close } = useDialogs();
  const [q, setQ] = useState("");
  const all = commandPalette.items;
  const query = q.trim().toLowerCase();
  const res = (query ? all.filter((c) => c.label.toLowerCase().includes(query)) : all).slice(0, 40);
  return (
    <Dialog open onClose={close} title="Search" width={460}
      footer={<Button variant="primary" onClick={close}>Close</Button>}>
      <input type="text" value={q} autoFocus placeholder="Search menu commands…" aria-label="Search commands"
        style={{ ...INP_BASE, width: "100%", marginBottom: 8 }}
        onChange={(e) => setQ(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && res[0]) { close(); res[0].run(); } }} />
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {res.map((c, i) => (
          <button key={i} onClick={() => { close(); c.run(); }}
            style={{ display: "block", width: "100%", textAlign: "left", font: "12px var(--font-mono, monospace)", padding: "5px 8px", border: "none", borderRadius: 4, background: "transparent", color: "var(--text-1)", cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2, #2a2e35)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>{c.label}</button>
        ))}
        {res.length === 0 && <p className="val" style={{ opacity: 0.6 }}>No matching commands.</p>}
      </div>
    </Dialog>
  );
}
// Indexed Color, Bitmap and Color Table ▸ Apply turn the document into one
// flattened layer, as Photoshop's "Flatten layers?" does before those modes.
function FlattenNotice({ action }: { action: string }) {
  const layers = useStore((s) => s.layers.length);
  if (layers < 2) return null;
  return (
    <p className="val" data-mv-flatten-notice style={{ opacity: 0.7, marginBottom: 8, fontSize: 12 }}>
      {action} flattens the {layers} layers into one (hidden ones are discarded).
    </p>
  );
}
// Image ▸ Mode ▸ Color Table — the document's palette, not a read-only report of
// it: Load… replaces it from an Adobe .act, each swatch is a native colour input
// (click to edit), and Apply re-indexes the document to whatever the grid now
// holds (convertIndexed ▸ Palette ▸ Custom, which flattens a layered document as
// Indexed Color does), making that table the document palette.
function ColorTable() {
  const { close } = useDialogs();
  // The palette as the document actually holds it, fixed at open: Apply pairs it
  // positionally with the edited grid so a changed swatch — or a loaded .act's
  // entry in the same slot — recolours its pixels. A .act load replaces the
  // grid, not this.
  const [original] = useState<string[]>(colorTableHexes);
  const [indexed] = useState(() => (engine.engine?.indexed_palette_rgb().length ?? 0) > 0);
  const [table, setTable] = useState<string[]>(original);
  const [loaded, setLoaded] = useState(false);
  const load = async () => {
    const next = await loadColorTableAct();
    if (next) { setTable(next); setLoaded(true); }
  };
  const editEntry = (i: number, hex: string) => setTable((cur) => cur.map((c, j) => (j === i ? hex : c)));
  return (
    <Dialog open onClose={close} title="Color Table" width={372}
      footer={<>
        <Button variant="ghost" data-mv-colortable-load onClick={() => void load()} title="Load an Adobe .act colour table">Load .act…</Button>
        <Button variant="ghost" data-mv-colortable-save onClick={() => exportColorTableAct("color-table.act", table)} title="Save this palette as an Adobe .act colour table">Save .act…</Button>
        <Button variant="primary" data-mv-colortable-apply disabled={!table.length}
          onClick={() => { store.convertIndexed(table.length, false, 7, 0, true, "#ffffff", table, original); close(); }}
          title="Re-index the document to this table">Apply</Button>
      </>}>
      <FlattenNotice action="Apply" />
      <p className="val" style={{ opacity: 0.6, marginBottom: 8, fontSize: 12 }}>
        {loaded
          ? `${table.length} loaded colors — click a swatch to edit it, then Apply.`
          : indexed
            ? `${table.length} colors in the document palette — click a swatch to edit it, then Apply.`
            : `${table.length}${table.length >= 256 ? "+" : ""} distinct colors in the image — click a swatch to edit it, then Apply.`}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(16, 1fr)", gap: 1 }}>
        {table.map((hex, i) => (
          <input key={i} type="color" value={hex} title={hex} aria-label={`Color ${i + 1}`} data-mv-colortable-entry={i}
            onChange={(e) => editEntry(i, e.currentTarget.value)}
            style={{ width: "100%", aspectRatio: "1", padding: 0, border: "1px solid rgba(0,0,0,0.25)", background: "none" }} />
        ))}
      </div>
    </Dialog>
  );
}

// Edit ▸ Presets ▸ Preset Manager — reorder / rename / delete saved presets.
// A thin view over the swatch / brush / tool-preset stores (logic lives there).
function PresetRow({ index, count, onUp, onDown, onDelete, children }: {
  index: number; count: number; onUp: () => void; onDown: () => void; onDelete: () => void; children: ReactNode;
}) {
  return (
    <div data-mv-preset-row style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 4px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>{children}</div>
      <Button size="sm" variant="ghost" data-mv-preset-up disabled={index === 0} onClick={onUp} title="Move up">↑</Button>
      <Button size="sm" variant="ghost" data-mv-preset-down disabled={index === count - 1} onClick={onDown} title="Move down">↓</Button>
      <Button size="sm" variant="ghost" data-mv-preset-delete onClick={onDelete} title="Delete">✕</Button>
    </div>
  );
}
/** A CSS `linear-gradient(...)` preview string for a gradient preset's stops. */
function gradientCss(stops: GradientStop[]): string {
  const parts = stops.map((s) => `rgba(${s.r},${s.g},${s.b},${(s.a / 255).toFixed(3)}) ${(s.pos * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}
/** SVG polygon `points` for a flat, bounding-box-normalized custom-shape path. */
function shapePolygonPoints(path: number[]): string {
  const pts: string[] = [];
  for (let i = 0; i + 1 < path.length; i += 2) pts.push(`${path[i]},${path[i + 1]}`);
  return pts.join(" ");
}
const PRESET_CAT_LABELS: Record<PresetCategory, string> = {
  swatches: "Swatches", brushes: "Brushes", tools: "Tool Presets",
  patterns: "Patterns", gradients: "Gradients", styles: "Styles", shapes: "Custom Shapes",
};
function PresetManagerDialog() {
  const { close } = useDialogs();
  const [cat, setCat] = useState<PresetCategory>("swatches");
  const [status, setStatus] = useState("");
  const swatches = useStore((s) => s.swatches);
  const brushes = useStore((s) => s.brushPresets);
  const tools = useStore((s) => s.toolPresets);
  const gradients = useStore((s) => s.gradientPresets);
  const stylePresets = useStore((s) => s.stylePresets);
  const patternPresets = useStore((s) => s.patternPresets);
  const customShapes = useStore((s) => s.customShapes);
  const nameInput: CSSProperties = { ...INP_BASE, flex: 1, minWidth: 0 };
  // Load…/Save Set… are Photoshop's per-category interchange: the Adobe file for
  // the categories Vision has a codec for, its own `.mvpresets` set otherwise.
  const load = async () => {
    const n = await loadPresetSetFile(cat);
    setStatus(n > 0 ? `Loaded ${n} ${PRESET_CAT_LABELS[cat].toLowerCase()} preset${n === 1 ? "" : "s"}.` : "");
  };
  // Export/Import Presets… and Migrate Presets… are Photoshop's all-libraries
  // commands (Edit ▸ Presets). They live in this dialog rather than in two of
  // their own, so the menu's three doors all open here.
  const importAll = async (adobe: boolean) => {
    const r = await importPresetFiles(adobe);
    const failed = r.errors.length ? ` ${r.errors.length} file${r.errors.length === 1 ? "" : "s"} skipped: ${r.errors[0].reason}` : "";
    setStatus(r.files || r.errors.length
      ? `Imported ${r.imported} preset${r.imported === 1 ? "" : "s"} from ${r.files} file${r.files === 1 ? "" : "s"}.${failed}`
      : "");
  };
  return (
    <Dialog open onClose={close} title="Preset Manager" width={420}
      footer={<>
        <Button data-mv-preset-load onClick={() => void load()} title="Load a preset library from a file">Load…</Button>
        <Button data-mv-preset-save onClick={() => { savePresetSet(cat); setStatus(""); }} title="Save this library to a file">Save Set…</Button>
        <Button variant="primary" onClick={close}>Done</Button>
      </>}>
      <div className="monet-row" style={{ gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="lbl" style={{ opacity: 0.7 }}>All libraries</span>
        <Button size="sm" variant="ghost" data-mv-preset-export-all onClick={() => { exportAllPresets(); setStatus(""); }} title="Write every preset library to one .mvpresets file">Export Presets…</Button>
        <Button size="sm" variant="ghost" data-mv-preset-import-all onClick={() => void importAll(false)} title="Read presets back from .mvpresets files">Import Presets…</Button>
        <Button size="sm" variant="ghost" data-mv-preset-migrate onClick={() => void importAll(true)} title="Bring in presets from another installation: .aco/.ase/.act, .abr, .grd, .asl">Migrate Presets…</Button>
      </div>
      <div className="monet-row" style={{ gap: 6, marginBottom: 8 }}>
        {PRESET_CATEGORIES.map((id) => (
          <Button key={id} size="sm" variant={cat === id ? "primary" : "ghost"} data-mv-preset-cat={id} onClick={() => { setCat(id); setStatus(""); }}>{PRESET_CAT_LABELS[id]}</Button>
        ))}
      </div>
      {cat === "shapes" && (
        <div className="monet-row" style={{ gap: 6, marginBottom: 8 }}>
          <Button size="sm" variant="ghost" data-mv-preset-restore title="Put back the built-in custom shapes"
            onClick={() => {
              const n = store.restoreDefaultCustomShapes();
              setStatus(n ? `Restored ${n} built-in shape${n === 1 ? "" : "s"}.` : "Every built-in shape is already in the library.");
            }}>Restore Defaults</Button>
        </div>
      )}
      <div data-mv-preset-list={cat} style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 320, overflowY: "auto" }}>
        {cat === "swatches" && swatches.map((hex, i) => (
          <PresetRow key={`${hex}-${i}`} index={i} count={swatches.length}
            onUp={() => store.reorderSwatch(i, -1)} onDown={() => store.reorderSwatch(i, 1)} onDelete={() => store.removeSwatch(i)}>
            <span style={{ width: 18, height: 18, borderRadius: 3, background: hex, border: "1px solid rgba(255,255,255,0.2)", flexShrink: 0 }} />
            <span style={{ fontSize: 12 }}>{hex}</span>
          </PresetRow>
        ))}
        {cat === "brushes" && brushes.map((p, i) => (
          <PresetRow key={`${p.name}-${i}`} index={i} count={brushes.length}
            onUp={() => store.reorderBrushPreset(i, -1)} onDown={() => store.reorderBrushPreset(i, 1)} onDelete={() => store.removeBrushPreset(i)}>
            <input defaultValue={p.name} data-mv-preset-name style={nameInput}
              onBlur={(e) => store.renameBrushPreset(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          </PresetRow>
        ))}
        {cat === "tools" && tools.map((p, i) => (
          <PresetRow key={`${p.name}-${i}`} index={i} count={tools.length}
            onUp={() => store.reorderToolPreset(i, -1)} onDown={() => store.reorderToolPreset(i, 1)} onDelete={() => store.removeToolPreset(i)}>
            <input defaultValue={p.name} data-mv-preset-name style={nameInput}
              onBlur={(e) => store.renameToolPreset(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          </PresetRow>
        ))}
        {cat === "patterns" && patternPresets.map((p, i) => (
          <PresetRow key={`${p.name}-${i}`} index={i} count={patternPresets.length}
            onUp={() => store.reorderPatternPreset(i, -1)} onDown={() => store.reorderPatternPreset(i, 1)} onDelete={() => store.removePatternPreset(i)}>
            <PatternSwatch preset={p} size={18} />
            <input defaultValue={p.name} data-mv-preset-name style={nameInput}
              onBlur={(e) => store.renamePatternPreset(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          </PresetRow>
        ))}
        {cat === "gradients" && gradients.map((p, i) => (
          <PresetRow key={`${p.name}-${i}`} index={i} count={gradients.length}
            onUp={() => store.reorderGradientPreset(i, -1)} onDown={() => store.reorderGradientPreset(i, 1)} onDelete={() => store.removeGradientPreset(i)}>
            <span data-mv-gradient-swatch style={{ width: 40, height: 18, borderRadius: 3, background: gradientCss(p.stops), border: "1px solid rgba(255,255,255,0.2)", flexShrink: 0 }} />
            <input defaultValue={p.name} data-mv-preset-name style={nameInput}
              onBlur={(e) => store.renameGradientPreset(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          </PresetRow>
        ))}
        {cat === "styles" && stylePresets.map((p, i) => (
          <PresetRow key={`${p.name}-${i}`} index={i} count={stylePresets.length}
            onUp={() => store.reorderStylePreset(i, -1)} onDown={() => store.reorderStylePreset(i, 1)} onDelete={() => store.removeStylePreset(i)}>
            <input defaultValue={p.name} data-mv-preset-name style={nameInput}
              onBlur={(e) => store.renameStylePreset(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          </PresetRow>
        ))}
        {cat === "shapes" && customShapes.map((s, i) => (
          <PresetRow key={`${s.name}-${i}`} index={i} count={customShapes.length}
            onUp={() => store.reorderCustomShape(i, -1)} onDown={() => store.reorderCustomShape(i, 1)} onDelete={() => store.removeCustomShape(i)}>
            <svg data-mv-shape-swatch viewBox="0 0 1 1" width={18} height={18} style={{ flexShrink: 0, background: "rgba(255,255,255,0.06)", borderRadius: 3 }} preserveAspectRatio="xMidYMid meet">
              <polygon points={shapePolygonPoints(s.path)} fill="var(--text-2)" />
            </svg>
            <input defaultValue={s.name} data-mv-preset-name style={nameInput}
              onBlur={(e) => store.renameCustomShape(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          </PresetRow>
        ))}
      </div>
      {status && <div data-mv-preset-status style={{ marginTop: 8, fontSize: 12, color: "var(--text-2)" }}>{status}</div>}
    </Dialog>
  );
}
const codePointLabel = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
// Type ▸ Glyphs — Photoshop's panel: the *font's* repertoire by Unicode
// category (probed via fontCoverage, since a webview can't read a system face's
// cmap), plus the OpenType alternates of the selected glyph. Picking an
// alternate applies the tag to that one character, not to the whole run.
function Glyphs() {
  const { close } = useDialogs();
  const activeId = useStore((s) => s.activeLayerId);
  const layers = useStore((s) => s.layers);
  const isType = layers.find((l) => l.id === activeId)?.kind === LAYER_KIND.text;
  const [family, setFamily] = useState(() => (isType ? text.get(activeId)?.font : null) ?? text.FONTS[0]);
  const [cat, setCat] = useState(GLYPH_CATEGORIES[0].id);
  const [sel, setSel] = useState("");
  const [recent, setRecent] = useState(loadRecentGlyphs);
  const lastInsert = useRef("");
  const glyphs = useMemo(() => fontCoverage(family, categoryChars(cat)), [family, cat]);
  const alts = useMemo(() => (sel ? glyphAlternates(family, sel, OPENTYPE_FEATURE_TAGS) : []), [family, sel]);

  const insert = (ch: string, tag: string | null, swap: boolean) => {
    const s = text.get(activeId);
    if (!s) return;
    const features = tag ? { [tag]: true } : undefined;
    // An alternate of the glyph just inserted replaces that character at the
    // caret. Without an editor, insertGlyph appends and the collapsed-range
    // helper stays null.
    if (swap) {
      const range = glyphReplaceRange(lastInsert.current, ch, typeEditorSelection());
      const el = typeof document === "undefined" ? null : document.querySelector<HTMLTextAreaElement>("textarea.mv-text-edit");
      if (range && el) el.setSelectionRange(range[0], range[1]);
    }
    text.insertGlyph(ch, features, family);
    lastInsert.current = ch;
    // ponytail: the row remembers the character, not the alternate form it was
    // inserted with — re-picking from it gives the default form, and the
    // alternates strip is one click away. Store the tag too if that grates.
    const next = pushRecentGlyph(recent, ch);
    setRecent(next);
    saveRecentGlyphs(next);
  };
  // One alternate chip: the selected glyph previewed with its feature tag on.
  const chip = (tag: string | null, label: string) => (
    <button key={tag ?? "default"} type="button" className="monet-cv-glyph" title={label} aria-label={label}
      disabled={!isType} onClick={() => insert(sel, tag, true)}
      style={{ width: 32, fontFamily: family, fontFeatureSettings: tag ? `"${tag}" 1` : "normal" }}>
      <span className="monet-cv-glyph-char" aria-hidden="true">{sel}</span>
    </button>
  );

  return (
    <Dialog open onClose={close} title="Glyphs" width={460}
      footer={<Button variant="primary" onClick={close}>Close</Button>}>
      {!isType && <p className="val" style={{ opacity: 0.6, marginBottom: 8, fontSize: 12 }}>
        Select a type layer to insert glyphs into it.</p>}
      {recent.length > 0 && (
        <div data-mv-glyph-recent style={{ marginBottom: 8, opacity: isType ? 1 : 0.4 }}>
          <p className="val" style={{ opacity: 0.6, fontSize: 12, marginBottom: 4 }}>Recently Used</p>
          <GlyphGrid columns={12} fontFamily={family} aria-label="Recently used glyphs"
            selectedChar={sel || undefined}
            glyphs={recent.map((g) => ({ char: g, name: codePointLabel(g) }))}
            onSelect={(ch) => { setSel(ch); if (isType) insert(ch, null, false); }} />
        </div>
      )}
      <div className="monet-row" style={{ gap: 6, marginBottom: 8 }}>
        <Select value={family} onChange={setFamily} aria-label="Font"
          options={text.FONTS.map((f) => ({ value: f, label: f.split(",")[0].replace(/['"]/g, "") }))} />
        <Select value={cat} onChange={setCat} aria-label="Category"
          options={GLYPH_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} />
      </div>
      <div data-mv-glyph-grid style={{ maxHeight: 240, overflowY: "auto", opacity: isType ? 1 : 0.4 }}>
        <GlyphGrid columns={12} fontFamily={family} aria-label="Glyphs in this font"
          selectedChar={sel || undefined}
          glyphs={glyphs.map((g) => ({ char: g, name: codePointLabel(g) }))}
          onSelect={(ch) => { setSel(ch); if (isType) insert(ch, null, false); }} />
      </div>
      {glyphs.length === 0 && <p className="val" style={{ opacity: 0.6, fontSize: 12 }}>
        This font has no glyphs in this category.</p>}
      <div data-mv-glyph-alternates style={{ marginTop: 10 }}>
        <p className="val" style={{ opacity: 0.6, fontSize: 12, marginBottom: 4 }}>
          {!sel ? "Select a glyph to see its OpenType alternates."
            : alts.length ? `Alternates for ${sel} (${codePointLabel(sel)})`
              : `${sel} has no OpenType alternates in this font.`}
        </p>
        {sel && alts.length > 0 && (
          <div className="monet-row" style={{ gap: 4, flexWrap: "wrap" }}>
            {chip(null, "Default form")}
            {alts.map((tag) => chip(tag, `${tag} alternate`))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
/** Export As ▸ Metadata — the File Info scope an export may carry. Values are
 *  the engine's `set_export_metadata_scope` codes. */
const EXPORT_METADATA_SCOPES = [
  { value: "0", label: "None" },
  { value: "1", label: "Copyright" },
  { value: "2", label: "Copyright and Contact Info" },
  { value: "3", label: "All" },
];

function ExportPrefs() {
  const { close, arg } = useDialogs();
  const exportArg = arg && typeof arg === "object" && "exportAs" in arg
    ? arg as { exportAs: "document" | "layers"; baseName?: unknown }
    : null;
  const documentExport = exportArg?.exportAs === "document";
  const layerExport = exportArg?.exportAs === "layers";
  const baseName = typeof exportArg?.baseName === "string" ? exportArg.baseName : "monet-vision";
  const prefs = useStore((s) => s.exportPrefs);
  const docSize = useStore((s) => s.doc);
  const [format, setFormat] = useState<ExportAsFormat>(prefs.format);
  const [quality, setQuality] = useState(prefs.quality);
  const [rows, setRows] = useState<ExportScaleRow[]>([{ ...DEFAULT_EXPORT_SCALE_ROW }]);
  // Photoshop's Export As ▸ Metadata scope, read back from the engine so the
  // dialog opens on the choice the last export used.
  const [metadata, setMetadata] = useState(() => String(exportAsMetadataChoice()));
  const [layerTargets] = useState<LayerExportTarget[]>(() => layerExport ? selectedLayerExportTargets() : []);
  const normalizedRows = normalizeExportScaleRows(rows);
  // The composite encoded exactly as Export As will write it at 1× — same
  // engine encoders, same ICC tag — so the size under the preview is the file,
  // not a guess. Layer exports skip it: the composite is not what they write.
  // ponytail: one 1× encode; a measured size per scale row needs a scaled
  // encoder probe (`exportAs`-side helper), so rows show dimensions only.
  const previewOpts = useMemo<SaveForWebOptions>(() => exportAsWebOptions(format, quality), [format, quality]);
  const preview = useWebPreview(previewOpts, 250, documentExport);
  const extension = format === "jpeg" ? "jpg" : format;
  const duplicate = documentExport
    ? duplicateExportScaleFilename(baseName, extension, normalizedRows)
    : layerExport
      ? duplicateExportScaleTargetFilename(layerTargets.map((target) => target.baseName), extension, normalizedRows)
      : null;
  const oversized = documentExport
    ? normalizedRows.find((row) => !exportScaleFits(docSize.width, docSize.height, row.scale))
    : layerExport
      ? layerTargets.flatMap((target) => normalizedRows.map((row) => ({ target, row })))
        .find(({ target, row }) => !exportScaleFits(target.width, target.height, row.scale))?.row
      : null;
  const setRow = (index: number, patch: Partial<ExportScaleRow>) => {
    setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const addRow = () => {
    const scale = Math.min(rows.length + 1, EXPORT_SCALE_MAX);
    setRows((current) => [...current, { scale, suffix: `@${scale}x` }]);
  };
  const removeRow = (index: number) => {
    setRows((current) => current.length === 1 ? current : current.filter((_, i) => i !== index));
  };
  const commit = () => {
    if (duplicate || oversized) return;
    if (format !== "gif") store.setExportPrefs({ format, quality });
    // The choice belongs to this export. exportAs sets the engine scope for
    // the encode and restores it, so a later ⌘S still embeds File Info. (#517)
    if (exportArg) {
      const scope = Number(metadata);
      rememberExportAsMetadata(scope);
      if (documentExport) exportAs(baseName, normalizedRows, format, quality, scope);
      if (layerExport && format !== "gif") exportSelectedLayersAs(normalizedRows, format, quality, layerTargets, scope);
    }
    close();
  };
  return (
    <Dialog open onClose={close} title={exportArg ? "Export As" : "Export Preferences"} width={documentExport ? 480 : exportArg ? 440 : 360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!!duplicate || !!oversized} onClick={commit}>{exportArg ? "Export" : "OK"}</Button></>}>
      <p className="val" style={{ opacity: 0.6, marginBottom: 10, fontSize: 12 }}>
        {documentExport
          ? "Export the composite in one or more relative sizes."
          : layerExport
            ? "Export each selected layer, group, or artboard in one or more relative sizes."
            : "Format and quality used by File and Layer ▸ Export As…"}
      </p>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 72 }}>Format</span>
        <SegmentedControl value={format} onChange={(v) => setFormat(v as ExportAsFormat)}
          items={documentExport
            ? [{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }, { value: "gif", label: "GIF" }]
            : [{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }]} />
      </div>
      {documentExport && <div className="monet-row" style={{ marginBottom: 12 }}>
        <WebPreviewPane title="Preview" note={`${extension.toUpperCase()} at 1×`} height={200} {...preview} />
      </div>}
      {format === "jpeg" && <Row label="Quality" value={quality} min={1} max={100} onChange={setQuality} suffix="%" />}
      {exportArg && <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <label className="lbl" htmlFor="mv-export-metadata" style={{ width: 72 }}>Metadata</label>
        <Select block id="mv-export-metadata" value={metadata} onChange={setMetadata}
          options={EXPORT_METADATA_SCOPES} />
      </div>}
      {exportArg && <>
        <div className="monet-section-label" style={{ marginTop: 12, marginBottom: 6 }}>Scale All</div>
        {rows.map((row, index) => (
          <div key={index} data-mv-export-scale-row={index} style={{ display: "grid", gridTemplateColumns: documentExport ? "104px 1fr 96px 28px" : "104px 1fr 28px", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <NumberField id={`mv-export-scale-${index}`} aria-label={`Scale ${index + 1}`} value={row.scale}
              min={EXPORT_SCALE_MIN} max={EXPORT_SCALE_MAX} step={0.05} precision={2}
              onChange={(scale) => setRow(index, { scale })} suffix="×" />
            <input id={`mv-export-suffix-${index}`} aria-label={`Suffix ${index + 1}`} value={row.suffix}
              onChange={(event) => setRow(index, { suffix: event.target.value })}
              placeholder="Suffix" style={{ ...INP_BASE, width: "100%", boxSizing: "border-box" }} />
            {documentExport && <span data-mv-export-scale-dims={index} style={{ fontSize: 11, opacity: 0.6, fontFamily: "var(--font-mono)", textAlign: "right" }}>
              {exportScaleDimensions(docSize.width, docSize.height, normalizedRows[index].scale).join(" × ")}
            </span>}
            <button type="button" aria-label={`Delete size ${index + 1}`} disabled={rows.length === 1}
              onClick={() => removeRow(index)} style={{ ...INP_BASE_BTN, opacity: rows.length === 1 ? 0.35 : 1 }}>✕</button>
          </div>
        ))}
        <Button size="sm" variant="ghost" data-mv-export-add-size onClick={addRow}>+ Add size</Button>
        {duplicate && <p role="alert" style={{ color: "var(--danger, #d45)", fontSize: 11, marginTop: 8 }}>
          Each row needs a unique output filename. Duplicate: {duplicate}
        </p>}
        {oversized && <p role="alert" style={{ color: "var(--danger, #d45)", fontSize: 11, marginTop: 8 }}>
          {oversized.scale}× exceeds the export image-size limit for this document.
        </p>}
      </>}
    </Dialog>
  );
}
// ── Save for Web (VIS-SFW-02) ──────────────────────────────────
// Photoshop's Save for Web is a preview workspace, not a form: you pick a
// format to watch the file get smaller. The preview measures the whole image;
// slice exports use the same format encoder once per region.

/** Transparency checkerboard behind a preview, so Matte's effect is visible. */
const WEB_PREVIEW_CHECKER = "repeating-conic-gradient(rgba(255,255,255,0.10) 0% 25%, transparent 0% 50%) 50% / 16px 16px";

interface WebPreview { url: string; bytes: number }

/** Keep one encoded preview in sync with `opts`. `delayMs` coalesces slider
 *  drags — a full-composite encode is far too costly to run per pixel of
 *  Quality. `enabled` false skips the encode entirely, for dialogs that only
 *  show a preview in some of their modes. Object URLs are revoked as they are
 *  replaced and on unmount. */
function useWebPreview(opts: SaveForWebOptions, delayMs: number, enabled = true) {
  const [preview, setPreview] = useState<WebPreview | null>(null);
  const [busy, setBusy] = useState(true);
  const urlRef = useRef<string | null>(null);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      void webExportBytes(opts).then((out) => {
        if (!live) return;
        setBusy(false);
        if (!out) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(new Blob([out.bytes as unknown as BlobPart], { type: out.mime }));
        setPreview({ url: urlRef.current, bytes: out.bytes.length });
      }).catch(() => { if (live) setBusy(false); });
    }, delayMs);
    return () => { live = false; clearTimeout(timer); };
  }, [opts, delayMs, enabled]);
  return { preview, busy };
}

/** One preview pane with its measured size. `kbps` adds Save for Web's download
 *  estimate; Export As leaves it off — it writes files, not pages. `height`
 *  keeps the pane inside narrower dialogs. */
function WebPreviewPane({ title, note, preview, busy, kbps, height = 260 }: {
  title: string; note: string; preview: WebPreview | null; busy: boolean; kbps?: number; height?: number;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="lbl" style={{ marginBottom: 4 }}>{title}</div>
      <div style={{
        height, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, background: WEB_PREVIEW_CHECKER,
      }}>
        {preview
          ? <img src={preview.url} alt={`${title} preview`} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          : <span style={{ fontSize: 11, opacity: 0.6 }}>{busy ? "Rendering…" : "No preview"}</span>}
      </div>
      <div aria-live="polite" style={{ fontSize: 11, marginTop: 4, fontFamily: "var(--font-mono)", opacity: busy ? 0.5 : 1 }}>
        {preview
          ? `${note} · ${formatByteSize(preview.bytes)}${kbps ? ` · ${formatDownloadTime(preview.bytes, kbps)}` : ""}`
          : `${note} · —`}
      </div>
    </div>
  );
}

function SaveForWebDialog() {
  const { close } = useDialogs();
  const prefs = useStore((s) => s.webExportPrefs);
  const filePrefs = useStore((s) => s.filePrefs);
  const docName = useStore((s) => s.doc.name);
  const sliceCount = useStore((s) => s.slices.length);
  const [format, setFormat] = useState<SaveForWebFormat>(prefs.format);
  const [quality, setQuality] = useState(prefs.quality);
  const [matte, setMatte] = useState(prefs.matte);
  const [convertToSRgb, setConvertToSRgb] = useState(prefs.convertToSRgb);
  const [metadata, setMetadata] = useState<SaveForWebMetadata>(prefs.metadata); // seeded like its siblings, not hardcoded (#145)
  const [view, setView] = useState<"optimized" | "original" | "2up">("2up");
  const [kbps, setKbps] = useState(DOWNLOAD_SPEEDS[1].kbps);
  const [targetKb, setTargetKb] = useState(100);
  const [optimizing, setOptimizing] = useState(false);
  const [openJpegAsLayer, setOpenJpegAsLayer] = useState(filePrefs.openJpegAsLayer);
  const [newDocumentBackground, setNewDocumentBackground] = useState<BgContents>(filePrefs.newDocumentBackground);

  const opts = useMemo<SaveForWebOptions>(
    () => ({ format, quality, matte, convertToSRgb, metadata }),
    [format, quality, matte, convertToSRgb, metadata]);
  // Original is the untouched composite as lossless PNG — Photoshop's reference
  // pane and the size everything else is compared against. Encoded once.
  const originalOpts = useMemo<SaveForWebOptions>(
    () => ({ format: "png", quality: 100, matte: "transparent", convertToSRgb: false, metadata: "all" }), []);
  const optimized = useWebPreview(opts, 250);
  const original = useWebPreview(originalOpts, 0);

  const optimizeToSize = async () => {
    setOptimizing(true);
    try {
      const best = await optimizeWebExportToFileSize(opts, Math.max(1, Math.round(targetKb * 1024)));
      if (best) setQuality(best.quality);
    } finally {
      setOptimizing(false);
    }
  };

  const commit = () => {
    // Only the three legacy formats round-trip through the persisted prefs; a
    // WebP/AVIF pick keeps the rest of the settings and lasts the session.
    // `metadata` is a persisted field too — omitting it made normalize fall back
    // to the stored value forever, so the dropdown could never stick. (#145)
    store.setWebExportPrefs(isPersistedWebFormat(format)
      ? { format, quality, matte, convertToSRgb, metadata }
      : { quality, matte, convertToSRgb, metadata });
    store.setFilePrefs({ openJpegAsLayer, newDocumentBackground });
    void saveForWeb(docName, opts);
    close();
  };

  return (
    <Dialog open onClose={close} title="Save for Web" width={760}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>Save</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 8, alignItems: "center" }}>
        <SegmentedControl value={view} onChange={(v) => setView(v as typeof view)}
          items={[{ value: "original", label: "Original" }, { value: "optimized", label: "Optimized" }, { value: "2up", label: "2-Up" }]} />
        <span style={{ flex: 1 }} />
        <span className="lbl">Speed</span>
        <Select id="mv-web-speed" value={String(kbps)} onChange={(v) => setKbps(Number(v))}
          options={DOWNLOAD_SPEEDS.map((s) => ({ value: String(s.kbps), label: s.label }))} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
        {view !== "optimized" && <WebPreviewPane title="Original" note="Lossless PNG" {...original} kbps={kbps} />}
        {view !== "original" && <WebPreviewPane title="Optimized" note={sliceCount ? `${format.toUpperCase()} whole-image preview` : saveForWebFilename(docName, format)} {...optimized} kbps={kbps} />}
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 88 }}>Format</span>
        <SegmentedControl value={format} onChange={(v) => setFormat(v as SaveForWebFormat)}
          items={SAVE_FOR_WEB_FORMATS.map((f) => ({ value: f.value, label: f.label }))} />
      </div>
      {sliceCount > 0 && <p role="status" style={{ fontSize: 11, opacity: 0.7, margin: "-4px 0 10px 98px" }}>
        The preview size is for the whole image; {sliceCount} slice{sliceCount === 1 ? "" : "s"} export separately.
        {format === "gif" ? " Animated GIF slices export as PNG." : ""}
      </p>}
      {webQualityApplies(format) && <>
        <Row label="Quality" value={quality} min={1} max={100} onChange={setQuality} suffix="%" />
        <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
          <span className="lbl" style={{ width: 88 }}>Target size</span>
          <NumberField aria-label="Target file size in KB" value={targetKb} min={1} max={100_000} onChange={setTargetKb} suffix=" KB" />
          <Button size="sm" variant="ghost" disabled={optimizing || sliceCount > 0} onClick={() => void optimizeToSize()}>
            {optimizing ? "Optimizing…" : "Optimize to file size"}
          </Button>
        </div>
      </>}
      <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 88 }}>Matte</span>
        <Select id="mv-web-matte" value={matte} onChange={(v) => setMatte(v as typeof matte)}
          options={[
            { value: "transparent", label: "Transparent" },
            { value: "white", label: "White" },
            { value: "black", label: "Black" },
          ]} />
        <span className="lbl" style={{ width: 72 }}>Metadata</span>
        <Select id="mv-web-metadata" value={metadata} onChange={(v) => setMetadata(v as SaveForWebMetadata)}
          options={[{ value: "none", label: "None" }, { value: "all", label: "All (color profile)" }]} />
      </div>
      <Checkbox checked={convertToSRgb} onChange={setConvertToSRgb}>Convert to sRGB</Checkbox>
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "12px 0" }} />
      <Checkbox checked={openJpegAsLayer} onChange={setOpenJpegAsLayer}>Open JPEGs into the current document as layers</Checkbox>
      <div className="monet-row" style={{ gap: 10, marginTop: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 132 }}>New doc background</span>
        <Select id="mv-file-new-bg" value={newDocumentBackground} onChange={(v) => setNewDocumentBackground(v as BgContents)}
          options={BG_CONTENTS.map((o) => ({ value: o.key, label: o.label }))} />
      </div>
    </Dialog>
  );
}
function LayerCleanup() {
  const { close } = useDialogs();
  const [deleteEmpty, setDeleteEmpty] = useState(true);
  const [autoName, setAutoName] = useState(true);
  const [onlyGeneric, setOnlyGeneric] = useState(true);
  const commit = () => { store.cleanupLayers({ deleteEmpty, autoName, onlyGeneric }); close(); };
  return (
    <Dialog open onClose={close} title="Layer Cleanup" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <Checkbox checked={deleteEmpty} onChange={setDeleteEmpty}>Delete empty pixel layers</Checkbox>
      <Checkbox checked={autoName} onChange={setAutoName}>Auto-name layers by kind and state</Checkbox>
      <Checkbox checked={onlyGeneric} onChange={setOnlyGeneric}>Only rename generic layer names</Checkbox>
    </Dialog>
  );
}
function RemoveDistractionsDialog() {
  const { close } = useDialogs();
  const [strength, setStrength] = useState(75);
  const commit = () => { removeDistractions(strength / 100); close(); };
  return (
    <Dialog open onClose={close} title="Remove Distractions" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <Row label="Strength" value={strength} min={1} max={100} onChange={setStrength} suffix="%" />
    </Dialog>
  );
}
function RemoveReflectionsDialog() {
  const { close } = useDialogs();
  const [strength, setStrength] = useState(65);
  const [split, setSplit] = useState(false);
  const commit = () => { (split ? splitReflections : removeReflections)(strength / 100); close(); };
  return (
    <Dialog open onClose={close} title="Remove Reflections" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <Row label="Strength" value={strength} min={1} max={100} onChange={setStrength} suffix="%" />
      <div style={{ marginTop: 12 }}>
        <div className="lbl" style={{ marginBottom: 6 }}>Output</div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 4 }}>
          <input type="radio" name="mv-refl-out" checked={!split} onChange={() => setSplit(false)} data-mv-refl-current />
          Current layer
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="radio" name="mv-refl-out" checked={split} onChange={() => setSplit(true)} data-mv-refl-split />
          New layers (Underlying + Reflections)
        </label>
      </div>
    </Dialog>
  );
}
function SkyReplacementDialog() {
  const { close } = useDialogs();
  const hasSelection = useStore((s) => s.selectionActive);
  const [top, setTop] = useState<[number, number, number]>([68, 151, 231]);
  const [bottom, setBottom] = useState<[number, number, number]>([218, 239, 255]);
  const [horizon, setHorizon] = useState(45);
  const [tolerance, setTolerance] = useState(35);
  const [shiftEdge, setShiftEdge] = useState(0);
  const [fadeEdge, setFadeEdge] = useState(15);
  const [brightness, setBrightness] = useState(0);
  const [temperature, setTemperature] = useState(0);
  const [scale, setScale] = useState(100);
  const [flip, setFlip] = useState(false);
  const [output, setOutput] = useState<"newLayer" | "currentLayer">("newLayer");
  const [opacity, setOpacity] = useState(100);
  const commit = () => {
    skyReplacement({
      top, bottom,
      horizon: horizon / 100,
      tolerance: tolerance / 100,
      shiftEdge: shiftEdge / 100,
      fadeEdge: fadeEdge / 100,
      brightness: brightness / 100,
      temperature: temperature / 100,
      scale: scale / 100,
      flip,
      output,
      opacity: opacity / 100,
    });
    close();
  };
  return (
    <Dialog open onClose={close} title="Sky Replacement" width={420}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
        <span className="lbl" style={{ width: 96 }}>Top Color</span>
        <input type="color" value={rgbHex(top)} onChange={(e) => setTop(hexRgb(e.currentTarget.value))}
          aria-label="Top sky color" style={{ width: 34, height: 24, border: "none", background: "none", padding: 0 }} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
        <span className="lbl" style={{ width: 96 }}>Horizon Color</span>
        <input type="color" value={rgbHex(bottom)} onChange={(e) => setBottom(hexRgb(e.currentTarget.value))}
          aria-label="Horizon sky color" style={{ width: 34, height: 24, border: "none", background: "none", padding: 0 }} />
      </div>
      {!hasSelection && <Row label="Horizon" value={horizon} min={5} max={95} onChange={setHorizon} suffix="%" />}
      {!hasSelection && <Row label="Tolerance" value={tolerance} min={0} max={100} onChange={setTolerance} suffix="%" />}
      <Row label="Shift Edge" value={shiftEdge} min={-100} max={100} onChange={setShiftEdge} suffix="%" />
      <Row label="Fade Edge" value={fadeEdge} min={0} max={100} onChange={setFadeEdge} suffix="%" />
      <Row label="Brightness" value={brightness} min={-100} max={100} onChange={setBrightness} suffix="%" />
      <Row label="Temperature" value={temperature} min={-100} max={100} onChange={setTemperature} suffix="%" />
      <Row label="Scale" value={scale} min={50} max={200} onChange={setScale} suffix="%" />
      <Row label="Opacity" value={opacity} min={1} max={100} onChange={setOpacity} suffix="%" />
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginTop: 8 }}>
        <span className="lbl" style={{ width: 96 }}>Output</span>
        <Select value={output} onChange={(v) => setOutput(v as "newLayer" | "currentLayer")}
          options={[{ value: "newLayer", label: "New Layer" }, { value: "currentLayer", label: "Current Layer" }]} />
      </div>
      <div style={{ marginTop: 8 }}>
        <Checkbox checked={flip} onChange={setFlip}>Flip</Checkbox>
      </div>
    </Dialog>
  );
}
function TypeStyles() {
  const { close, arg } = useDialogs();
  const kind: "char" | "para" = arg === "para" ? "para" : "char";
  const activeId = useStore((s) => s.activeLayerId);
  const layers = useStore((s) => s.layers);
  const isType = layers.find((l) => l.id === activeId)?.kind === LAYER_KIND.text;
  // The list and the link are read straight from the model on every render (both
  // are cheap) and `bump` re-renders after a mutation the store doesn't notify.
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);
  const styles = text.typeStyles(kind);
  const link = isType ? text.typeStyleLink(kind) : null;
  const [name, setName] = useState("");
  const create = () => { if (!name.trim() || !isType) return; text.addTypeStyle(kind, name); setName(""); refresh(); };
  const del = (n: string) => { text.deleteTypeStyle(kind, n); refresh(); };
  const run = (fn: () => void) => { fn(); refresh(); };
  return (
    <Dialog open onClose={close} title={kind === "char" ? "Character Styles" : "Paragraph Styles"} width={440}
      footer={<Button variant="primary" onClick={close}>Close</Button>}>
      {!isType && <p className="val" style={{ opacity: 0.6, marginBottom: 8, fontSize: 12 }}>
        Select a type layer to capture or apply styles.</p>}
      <div className="monet-row" style={{ gap: 8, marginBottom: 10 }}>
        <input type="text" value={name} placeholder="New style name" aria-label="Style name"
          style={{ ...INP_BASE, flex: 1 }} disabled={!isType}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
        <Button onClick={create} disabled={!isType || !name.trim()}>New from Selection</Button>
      </div>
      {styles.length === 0
        ? <p className="val" style={{ opacity: 0.5, fontSize: 12 }}>No saved {kind === "char" ? "character" : "paragraph"} styles yet.</p>
        : <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 280, overflowY: "auto" }}>
            {styles.map((st) => {
              const linked = link && link.name === st.name ? link : null;
              const overrides = linked?.overrides ?? [];
              // Based On may not point back into the style's own family (a cycle
              // would never resolve); Next Style may name any other style.
              const opt = (names: string[]) => [{ value: "", label: "(None)" }, ...names.map((n) => ({ value: n, label: n }))];
              return (
                <div key={st.name} data-mv-type-style={st.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div className="monet-row" style={{ gap: 6, alignItems: "center" }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: linked ? 600 : 400 }}>
                      {st.name}
                      {/* Photoshop's "+" badge: this layer is linked but has drifted. */}
                      {overrides.length > 0 && <span data-mv-type-style-override role="img"
                        aria-label={`${st.name} overridden: ${overrides.join(", ")}`}
                        title={`Overridden: ${overrides.join(", ")}`} style={{ marginLeft: 4, opacity: 0.7 }}>+</span>}
                    </span>
                    <Button onClick={() => run(() => text.applyTypeStyle(kind, st.name))} disabled={!isType}>Apply</Button>
                    <Button onClick={() => run(() => text.redefineTypeStyle(kind, st.name))} disabled={!isType}
                      title="Redefine this style from the active layer and update every layer using it">Redefine</Button>
                    {overrides.length > 0 && <Button variant="ghost" onClick={() => run(() => text.clearTypeStyleOverride(kind))}
                      title="Discard this layer's overrides and reapply the style">Clear Override</Button>}
                    <Button variant="ghost" aria-label={`Delete ${st.name}`} onClick={() => del(st.name)}>✕</Button>
                  </div>
                  <div className="monet-row" style={{ gap: 6, alignItems: "center", fontSize: 11, opacity: 0.85 }}>
                    <span className="lbl">Based On</span>
                    <Select aria-label={`${st.name} based on`} value={st.basedOn ?? ""}
                      options={opt(text.typeStyleBasedOnChoices(kind, st.name))}
                      onChange={(v) => run(() => text.setTypeStyleBasedOn(kind, st.name, v || undefined))} />
                    <span className="lbl" title="The style the next type layer you create starts in">Next Style</span>
                    <Select aria-label={`${st.name} next style`} value={st.next ?? ""}
                      options={opt(styles.filter((o) => o.name !== st.name).map((o) => o.name))}
                      onChange={(v) => run(() => text.setTypeStyleNext(kind, st.name, v || undefined))} />
                  </div>
                </div>
              );
            })}
          </div>}
    </Dialog>
  );
}
// Select ▸ Focus Area — the auto in-focus selection with the corrections
// Photoshop offers around it: a live doc-resolution preview in the Select and
// Mask View modes, In-Focus Range with Auto (Otsu in the engine), Advanced ▸
// Image Noise Level, the add/subtract Focus Area brushes that fix what the auto
// pass missed, Soften Edge, Output To, and the Select and Mask hand-off.
// The focus math is the engine's (raster/mod.rs::focus_area_preview — pure, the
// live selection is untouched until OK); the compositor is state/selectAndMask.ts.
function FocusArea() {
  const { close, open } = useDialogs();
  const docW = engine.engine ? engine.width : 0;
  const docH = engine.engine ? engine.height : 0;
  const composite = useMemo(() => (engine.engine ? engine.outputCopy() : null), []);
  const [range, setRange] = useState(30);
  const [noise, setNoise] = useState(0);
  const [soften, setSoften] = useState(0);
  const [view, setView] = useState<SamViewMode>("bw");
  const [viewOpacity, setViewOpacity] = useState(0.5);
  const [output, setOutput] = useState<SamOutput>("selection");
  const [brushMode, setBrushMode] = useState<"add" | "subtract">("add");
  const [brushSize, setBrushSize] = useState(40);
  const [strokeGen, setStrokeGen] = useState(0); // bumped per dab → re-preview
  const addRef = useRef<Uint8Array>(new Uint8Array(docW * docH));
  const subRef = useRef<Uint8Array>(new Uint8Array(docW * docH));
  const paintingRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const mask = () => store.focusAreaPreview(range / 100, noise / 100, soften, addRef.current, subRef.current);
  // Live preview: recompute the focus coverage (debounced — it is a full-res
  // variance pass) and composite the active View mode.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas || !composite || !docW) return;
      canvas.width = docW;
      canvas.height = docH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cov = mask();
      const img = ctx.createImageData(docW, docH);
      renderSamView(view, viewOpacity, docW, docH, composite, cov.length ? cov : null, img.data);
      ctx.putImageData(img, 0, 0);
    }, 90);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, noise, soften, view, viewOpacity, strokeGen, composite, docW, docH]);

  // Focus Area brushes: dab into the add / subtract override under the pointer.
  const dab = (ev: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) * docW) / rect.width;
    const y = ((ev.clientY - rect.top) * docH) / rect.height;
    // A dab in one direction clears the other, so a mis-stroke is undoable by
    // painting over it with the opposite brush.
    const [paint, erase] = brushMode === "add" ? [addRef, subRef] : [subRef, addRef];
    stampSamBrush(paint.current, docW, docH, x, y, brushSize / 2, true);
    stampSamBrush(erase.current, docW, docH, x, y, brushSize / 2, false);
    setStrokeGen((g) => g + 1);
  };
  const commit = (to: SamOutput) => {
    const cov = mask();
    // No corrections and a plain selection output: the recordable one-call path
    // (identical result — same engine core), so actions can replay it.
    if (!cov.length || (strokeGen === 0 && to === "selection")) store.selectFocusArea(range / 100, noise / 100, soften);
    else store.applyFocusArea(cov, to);
  };
  const autoRange = () => {
    const auto = store.focusAreaAutoRange(noise / 100);
    if (auto >= 0) setRange(Math.round(Math.min(1, auto) * 100));
  };
  const row = (label: string, node: ReactNode) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 6 }}>
      <span className="lbl" style={{ width: 96 }}>{label}</span>
      {node}
    </div>
  );
  const section = (label: string) => (
    <div style={{ fontSize: 11, color: "var(--text-3)", margin: "10px 0 6px" }}>{label}</div>
  );
  return (
    <Dialog open onClose={close} title="Focus Area" width={820}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button onClick={() => { commit("selection"); open("selectandmask"); }}
          title="Apply the focus selection and refine its edge in the Select and Mask workspace">Select and Mask…</Button>
        <Button variant="primary" onClick={() => { commit(output); close(); }}>OK</Button></>}>
      <div style={{ display: "flex", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <canvas ref={canvasRef} role="img" aria-label="Focus Area live preview"
            onPointerDown={(ev) => {
              paintingRef.current = true;
              ev.currentTarget.setPointerCapture(ev.pointerId);
              dab(ev);
            }}
            onPointerMove={(ev) => { if (paintingRef.current) dab(ev); }}
            onPointerUp={() => { paintingRef.current = false; }}
            onPointerCancel={() => { paintingRef.current = false; }}
            style={{
              display: "block", width: "100%", height: "auto", maxHeight: 400, objectFit: "contain",
              cursor: "crosshair", touchAction: "none",
              background: "#000", border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", borderRadius: 4,
            }} />
          <div className="monet-row" style={{ gap: 10, marginTop: 8, alignItems: "center" }}>
            <span className="lbl">Focus Area Brush</span>
            <SegmentedControl value={brushMode} onChange={(v) => setBrushMode(v as "add" | "subtract")}
              items={[{ value: "add", label: "Add (+)" }, { value: "subtract", label: "Subtract (−)" }]} />
            <span className="lbl">Size</span>
            <NumberField value={brushSize} min={4} max={400} onChange={setBrushSize} suffix="px" aria-label="Focus Area brush size" />
          </div>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
            Paint on the preview to force regions the automatic pass missed in or out.
          </div>
        </div>
        <div style={{ width: 250, flexShrink: 0 }}>
          {section("View Mode")}
          {row("View", <Select value={view} onChange={(v) => setView(v as SamViewMode)}
            options={SAM_VIEW_MODES.map(({ value, label }) => ({ value, label }))} aria-label="View mode" />)}
          {row("Opacity", <Slider min={0} max={1} step={0.01} value={viewOpacity} onChange={setViewOpacity}
            aria-label="View opacity" style={{ flex: 1 }} />)}
          {section("Parameters")}
          {row("In-Focus Range", <NumberField value={range} min={0} max={100} onChange={setRange} suffix="%" />)}
          <div style={{ marginBottom: 6 }}>
            <Button onClick={autoRange} title="Pick the In-Focus Range that best splits this image">Auto</Button>
          </div>
          {section("Advanced")}
          {row("Image Noise Level", <NumberField value={noise} min={0} max={100} onChange={setNoise} suffix="%" />)}
          {row("Soften Edge", <NumberField value={soften} min={0} max={100} onChange={setSoften} suffix="px" />)}
          {section("Output Settings")}
          {row("Output To", <Select value={output} onChange={(v) => setOutput(v as SamOutput)}
            options={SAM_OUTPUTS.map(({ value, label }) => ({ value, label }))} aria-label="Output to" />)}
        </div>
      </div>
    </Dialog>
  );
}
// Edit ▸ Content-Aware Fill… — Photoshop's workspace. Paint the Sampling Area
// the fill may copy from (tinted green; Auto / Rectangular / Custom), choose the
// Color and Rotation Adaptation, Scale and Mirror, and where the result goes.
// The dialog sits over the hole on the main canvas, so the live preview is drawn
// in the workspace canvas: the engine composite after each preview apply, with
// the sampling tint on top (the hole itself is never sampled, so the two never
// overlap). The synthesis is the engine's (content_aware_fill_workspace), and
// PreviewDialog owns the history transaction, so Cancel or Esc leaves nothing.
function ContentAwareFillWorkspace() {
  const docW = engine.engine ? engine.width : 0;
  const docH = engine.engine ? engine.height : 0;
  const sel = useMemo(() => (engine.engine ? engine.e.get_selection_mask() : new Uint8Array(0)), []);
  const maskRef = useRef<Uint8Array | null>(null);
  maskRef.current ??= samplingPreset("auto", sel, docW, docH);
  const [mode, setMode] = useState<SamplingMode>("auto");
  const [brushMode, setBrushMode] = useState<"add" | "subtract">("add");
  const [brushSize, setBrushSize] = useState(40);
  const [color, setColor] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [output, setOutput] = useState(0);
  const [previewGen, setPreviewGen] = useState(0); // bumped per stroke / preset → re-preview
  const paintingRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ponytail: a full-document redraw per dab; redraw the dab's dirty rect if big documents lag.
  const draw = () => {
    const canvas = canvasRef.current;
    const composite = canvas && docW ? engine.outputCopy() : null;
    if (!canvas || !composite) return;
    canvas.width = docW;
    canvas.height = docH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(docW, docH);
    tintSamplingOverlay(composite, maskRef.current!, img.data);
    ctx.putImageData(img, 0, 0);
  };
  const apply = () => {
    contentAwareFillWith({ sample: maskRef.current!, color, rotation, scale, mirror, output });
    draw();
  };
  const pickMode = (next: SamplingMode) => {
    setMode(next);
    maskRef.current = samplingPreset(next, sel, docW, docH);
    draw();
    setPreviewGen((g) => g + 1);
  };
  const dab = (ev: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    // object-fit: contain letterboxes the bitmap inside the element's box.
    const r = ev.currentTarget.getBoundingClientRect();
    const k = Math.min(r.width / docW, r.height / docH);
    const x = (ev.clientX - r.left - (r.width - docW * k) / 2) / k;
    const y = (ev.clientY - r.top - (r.height - docH * k) / 2) / k;
    stampSamBrush(maskRef.current!, docW, docH, x, y, brushSize / 2, brushMode === "add");
    draw();
  };
  // One re-fill per stroke. Painting makes the area Custom, as in Photoshop.
  const endStroke = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    const mask = maskRef.current!;
    for (let i = 0; i < mask.length; i++) if (sel[i] > 127) mask[i] = 0;
    setMode("custom");
    setPreviewGen((g) => g + 1);
  };
  const choices = (labels: string[]) => labels.map((label, i) => ({ value: String(i), label }));
  const row = (label: string, node: ReactNode) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 6 }}>
      <span className="lbl" style={{ width: 110 }}>{label}</span>
      {node}
    </div>
  );
  const section = (label: string) => (
    <div style={{ fontSize: 11, color: "var(--text-3)", margin: "10px 0 6px" }}>{label}</div>
  );
  return (
    <PreviewDialog title="Content-Aware Fill" width={860} apply={apply}
      deps={[previewGen, color, rotation, scale, mirror, output]}>
      <div data-mv-caf-workspace style={{ display: "flex", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <canvas ref={canvasRef} id="mv-caf-preview" role="img" aria-label="Content-Aware Fill preview and sampling area"
            onPointerDown={(ev) => {
              paintingRef.current = true;
              ev.currentTarget.setPointerCapture(ev.pointerId);
              dab(ev);
            }}
            onPointerMove={(ev) => { if (paintingRef.current) dab(ev); }}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            style={{
              display: "block", width: "100%", height: "auto", maxHeight: 400, objectFit: "contain",
              cursor: "crosshair", touchAction: "none",
              background: "#000", border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", borderRadius: 4,
            }} />
          <div className="monet-row" style={{ gap: 10, marginTop: 8, alignItems: "center" }}>
            <span className="lbl">Sampling Brush</span>
            <SegmentedControl aria-label="Sampling brush" value={brushMode} onChange={(v) => setBrushMode(v as "add" | "subtract")}
              items={[{ value: "add", label: "Add (+)" }, { value: "subtract", label: "Subtract (−)" }]} />
            <span className="lbl">Size</span>
            <NumberField value={brushSize} min={4} max={400} onChange={setBrushSize} suffix="px" aria-label="Sampling brush size" />
          </div>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
            Paint on the preview to add to or subtract from the green area the fill samples.
          </div>
        </div>
        <div style={{ width: 250, flexShrink: 0 }}>
          {section("Sampling Area Options")}
          <SegmentedControl aria-label="Sampling area" value={mode} onChange={(v) => pickMode(v as SamplingMode)}
            items={[{ value: "auto", label: "Auto" }, { value: "rectangular", label: "Rectangular" }, { value: "custom", label: "Custom" }]} />
          {section("Fill Settings")}
          {row("Color Adaptation", <Select id="mv-caf-color" aria-label="Color adaptation" value={String(color)}
            onChange={(v) => setColor(Number(v))} options={choices(["None", "Default", "High", "Very High"])} />)}
          {row("Rotation Adaptation", <Select id="mv-caf-rotation" aria-label="Rotation adaptation" value={String(rotation)}
            onChange={(v) => setRotation(Number(v))} options={choices(["None", "Low", "Medium", "High", "Full"])} />)}
          <div className="monet-row" style={{ gap: 14, marginBottom: 6 }}>
            <Checkbox checked={scale} onChange={setScale} aria-label="Scale">Scale</Checkbox>
            <Checkbox checked={mirror} onChange={setMirror} aria-label="Mirror">Mirror</Checkbox>
          </div>
          {section("Output Settings")}
          {row("Output To", <Select id="mv-caf-output" aria-label="Output to" value={String(output)}
            onChange={(v) => setOutput(Number(v))} options={choices(["Current Layer", "New Layer", "Duplicate Layer"])} />)}
        </div>
      </div>
    </PreviewDialog>
  );
}
function MeasurementScale() {
  const { close } = useDialogs();
  const presetSelectRef = useRef<HTMLButtonElement>(null);
  const sc = store.state.measureScale;
  const [px, setPx] = useState(sc.px);
  const [units, setUnits] = useState(sc.units);
  const [unit, setUnit] = useState(sc.unit);
  const [presets, setPresets] = useState(() => store.state.measureScalePresets.map((preset) => ({ ...preset })));
  const [selected, setSelected] = useState(() => store.state.measureScalePresets.find((preset) => (
    preset.px === sc.px && preset.units === sc.units && preset.unit === sc.unit
  ))?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState("");
  const valid = Number.isFinite(px) && px > 0 && Number.isFinite(units) && units > 0 && !!unit.trim();
  const replacesPreset = presets.some((preset) => (
    preset.name.toLocaleLowerCase() === presetName.trim().toLocaleLowerCase()
  ));
  const finishSaving = () => {
    setPresetName("");
    setSaving(false);
    requestAnimationFrame(() => presetSelectRef.current?.focus());
  };
  const choosePreset = (name: string) => {
    setSelected(name);
    const preset = presets.find((candidate) => candidate.name === name);
    if (preset) { setPx(preset.px); setUnits(preset.units); setUnit(preset.unit); }
  };
  const savePreset = () => {
    if (!valid || !presetName.trim()) return;
    const next = saveMeasureScalePreset(presets, presetName, { px, units, unit });
    setPresets(next);
    setSelected(next[next.length - 1]?.name ?? "");
    finishSaving();
  };
  const deletePreset = () => {
    if (!selected) return;
    setPresets(deleteMeasureScalePreset(presets, selected));
    setSelected("");
  };
  const commit = () => {
    if (!valid || saving) return;
    store.setMeasureScalePresets(presets);
    store.setMeasureScale(px, units, unit);
    close();
  };
  return (
    <Dialog open onClose={close} title="Measurement Scale" width={430}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!valid || saving} onClick={commit}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
        <label className="lbl" style={{ width: 96 }} htmlFor="mv-measure-scale-preset">Preset</label>
        <Select ref={presetSelectRef} id="mv-measure-scale-preset" value={selected} onChange={choosePreset}
          options={[{ value: "", label: "Custom" }, ...presets.map((preset) => ({ value: preset.name, label: preset.name }))]} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
        <span className="lbl" style={{ width: 96 }}>Pixel Length</span>
        <input type="number" min="0.01" step="any" value={px} aria-label="Pixel length" autoFocus
          style={{ ...INP_BASE, flex: 1 }} onChange={(e) => { setPx(parseFloat(e.currentTarget.value) || 0); setSelected(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
        <span className="lbl" style={{ width: 96 }}>Logical Length</span>
        <input type="number" min="0.01" step="any" value={units} aria-label="Logical length"
          style={{ ...INP_BASE, flex: 1 }} onChange={(e) => { setUnits(parseFloat(e.currentTarget.value) || 0); setSelected(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 10 }}>
        <span className="lbl" style={{ width: 96 }}>Logical Units</span>
        <input type="text" value={unit} maxLength={80} aria-label="Logical units"
          style={{ ...INP_BASE, flex: 1 }} onChange={(e) => { setUnit(e.currentTarget.value); setSelected(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      </div>
      {saving ? <div onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishSaving(); }
      }}>
        <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
          <label className="lbl" style={{ width: 96 }} htmlFor="mv-measure-scale-preset-name">Name</label>
          <input id="mv-measure-scale-preset-name" value={presetName} maxLength={80} autoFocus
            aria-describedby={replacesPreset ? "mv-measure-scale-preset-replace" : undefined}
            style={{ ...INP_BASE, flex: 1 }} onChange={(e) => setPresetName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") savePreset(); }} />
        </div>
        {replacesPreset && <div id="mv-measure-scale-preset-replace"
          style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>
          Saving replaces the preset with this name.
        </div>}
        <div className="monet-row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Button variant="ghost" onClick={finishSaving}>Cancel Save</Button>
          <Button variant="primary" disabled={!valid || !presetName.trim()} onClick={savePreset}>Save</Button>
        </div>
      </div> : <div className="monet-row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <Button onClick={() => setSaving(true)} disabled={!valid}>Save Preset</Button>
        <Button onClick={deletePreset} disabled={!selected}>Delete Preset</Button>
      </div>}
    </Dialog>
  );
}
/** The recorded measurements, columns per Image ▸ Analysis ▸ Select Data Points.
 *  Lives here beside Select Data Points; the Measurement Log *panel* renders it. */
export function MeasurementRows() {
  const rows = useStore((s) => s.measurements);
  const unit = useStore((s) => s.measureScale.unit);
  const dp = useStore((s) => s.dataPoints);
  if (rows.length === 0) {
    return <p className="val" style={{ opacity: 0.6 }}>No measurements recorded. Draw a Ruler line, then Record Measurements.</p>;
  }
  return (
    <table style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12, borderCollapse: "collapse" }}>
      <thead><tr style={{ textAlign: "left", color: "var(--text-3)" }}>
        <th>#</th>{dp.lengthPx && <th>Length (px)</th>}{dp.lengthUnits && <th>Length ({unit})</th>}
        {dp.angle && <th>Angle</th>}{dp.count && <th>Count</th>}
      </tr></thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.n}><td>{m.n}</td>{dp.lengthPx && <td>{m.lengthPx}</td>}{dp.lengthUnits && <td>{m.lengthUnits}</td>}
            {dp.angle && <td>{m.angle}°</td>}{dp.count && <td>{m.count}</td>}</tr>
        ))}
      </tbody>
    </table>
  );
}
function SelectDataPoints() {
  const { close } = useDialogs();
  const dp = useStore((s) => s.dataPoints);
  const row = (k: keyof typeof dp, label: string) => (
    <div style={{ marginBottom: 4 }}>
      <Checkbox checked={dp[k]} onChange={(v) => store.setDataPoints({ [k]: v })}>{label}</Checkbox>
    </div>
  );
  return (
    <Dialog open onClose={close} title="Select Data Points" width={300}
      footer={<Button variant="primary" onClick={close}>OK</Button>}>
      <p className="val" style={{ opacity: 0.6, marginBottom: 8, fontSize: 12 }}>Columns to show in the Measurement Log.</p>
      {row("lengthPx", "Length (pixels)")}
      {row("lengthUnits", "Length (scaled units)")}
      {row("angle", "Angle")}
      {row("count", "Count")}
    </Dialog>
  );
}
function PlaceScaleMarker() {
  const { close } = useDialogs();
  const unit = store.state.measureScale.unit;
  const [len, setLen] = useState(100);
  const [caption, setCaption] = useState(`100 ${unit}`);
  const commit = () => { placeScaleMarker(len, caption); close(); };
  return (
    <Dialog open onClose={close} title="Place Scale Marker" width={380}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
        <span className="lbl" style={{ width: 96 }}>Length ({unit})</span>
        <input type="number" min="0.01" step="any" value={len} aria-label="Marker length" autoFocus
          style={{ ...INP_BASE, flex: 1 }} onChange={(e) => setLen(parseFloat(e.currentTarget.value) || 0)} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 96 }}>Caption</span>
        <input type="text" value={caption} aria-label="Marker caption"
          style={{ ...INP_BASE, flex: 1 }} onChange={(e) => setCaption(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      </div>
    </Dialog>
  );
}
function VariablesDefine() {
  const { close } = useDialogs();
  const layers = useStore((s) => s.layers);
  const existing = useStore((s) => s.variables);
  const [error, setError] = useState("");
  const [binds, setBinds] = useState<Record<string, { name: string; type: "text" | "vis" | "pixel" }>>(() => Object.fromEntries(existing.map((v) => [v.layer, { name: v.name, type: v.type }])));
  const setBind = (layer: string, patch: Partial<{ name: string; type: "text" | "vis" | "pixel" }>) =>
    setBinds((b) => ({ ...b, [layer]: { ...(b[layer] ?? { name: "", type: "vis" }), ...patch } }));
  const commit = () => {
    try {
      store.setVariables(Object.entries(binds).filter(([, b]) => b.name.trim()).map(([layer, b]) => ({ layer, name: b.name.trim(), type: b.type, ...(b.type === "pixel" ? { fit: "conform" as const } : {}) })));
      close();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Dialog open onClose={close} title="Variables — Define" width={540}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" onClick={commit}>OK</Button></>}>
      <p className="val" style={{ opacity: 0.6, marginBottom: 8, fontSize: 12 }}>Bind layers to data-set columns. {isTauri() ? "Pixel Replacement conforms the image to the layer’s footprint." : "Pixel Replacement reads local image paths, so it needs the Monet Vision desktop app."}</p>
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {layers.filter((l) => l.kind !== LAYER_KIND.groupHeader).map((l) => (
          <div className="monet-row" key={l.id} style={{ gap: 8, marginBottom: 4, alignItems: "center" }}>
            <span style={{ width: 110, fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
            <input placeholder="variable" value={binds[l.name]?.name ?? ""} aria-label={`Variable for ${l.name}`}
              style={{ ...INP_BASE, flex: 1 }} onChange={(e) => setBind(l.name, { name: e.currentTarget.value })} />
            <Select aria-label={`Variable type for ${l.name}`} value={binds[l.name]?.type ?? "vis"} onChange={(v) => setBind(l.name, { type: v as "text" | "vis" | "pixel" })}
              options={[...(l.kind === LAYER_KIND.text ? [{ value: "text", label: "Text Replacement" }] : []), { value: "vis", label: "Visibility" }, ...(l.kind === LAYER_KIND.pixel ? [{ value: "pixel", label: "Pixel Replacement (Conform)", disabled: !isTauri() }] : [])]} />
          </div>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
function DataSets() {
  const { close } = useDialogs();
  const sets = useStore((s) => s.dataSets);
  const active = useStore((s) => s.activeDataSet);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => pending.current?.abort(), []);
  const dismiss = () => { pending.current?.abort(); close(); };
  const apply = async () => {
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError("");
    let reason = "";
    const ok = await dataVars.apply(active, controller.signal, (message) => { reason = message; });
    if (!controller.signal.aborted) { setBusy(false); if (!ok) setError(reason || "Data set could not be applied. Check the image paths and layer bindings."); }
  };
  return (
    <Dialog open onClose={dismiss} title="Variables — Data Sets" width={460}
      footer={<><Button variant="ghost" disabled={busy} onClick={() => void dataVars.importFile()}>Import CSV…</Button>
        <Button variant="ghost" disabled={busy || !sets.length} onClick={() => void apply()}>{busy ? "Applying…" : "Apply"}</Button>
        <Button variant="primary" onClick={dismiss}>{busy ? "Cancel" : "Close"}</Button></>}>
      <p style={{ fontSize: 12, color: "var(--text-3)" }}>Pixel columns use local image paths. Relative paths resolve beside the imported CSV in the desktop app.</p>
      {sets.length === 0 ? <p className="val">No data sets. Import a CSV whose header row holds the variable names.</p> : <>
        <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
          <span className="lbl" style={{ width: 70 }}>Data Set</span>
          <Select aria-label="Data set" disabled={busy} value={String(active)} onChange={(v) => store.setActiveDataSet(+v)} options={sets.map((_, i) => ({ value: String(i), label: `Set ${i + 1}` }))} />
        </div>
        <table style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}><tbody>
          {Object.entries(sets[active] ?? {}).map(([k, v]) => <tr key={k}><td style={{ color: "var(--text-3)", paddingRight: 12 }}>{k}</td><td>{v}</td></tr>)}
        </tbody></table>
      </>}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
function ImageProcessor() {
  const { close } = useDialogs();
  const saved = actions.list();
  const [actionId, setActionId] = useState("none");
  const [jpeg, setJpeg] = useState(true);
  const [quality, setQuality] = useState(85);
  const [png, setPng] = useState(false);
  const [psd, setPsd] = useState(false);
  const [tiff, setTiff] = useState(false);
  const [resize, setResize] = useState(false);
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const [destDir, setDestDir] = useState<string | null>(null);
  const [copyright, setCopyright] = useState("");
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const saves: ImageProcessorSave[] = [
    ...(jpeg ? [{ format: "jpeg", quality } satisfies ImageProcessorSave] : []),
    ...(png ? [{ format: "png" } satisfies ImageProcessorSave] : []),
    ...(psd ? [{ format: "psd" } satisfies ImageProcessorSave] : []),
    ...(tiff ? [{ format: "tiff" } satisfies ImageProcessorSave] : []),
  ];
  const pickDest = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Image Processor Destination Folder" });
    if (typeof dir === "string") setDestDir(dir);
  };
  const run = () => {
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning(true);
    setStatus("Starting…");
    void imageProcessor({
      saves,
      actionId: actionId === "none" ? undefined : Number(actionId),
      destDir: destDir ?? undefined,
      copyright: copyright || undefined,
      maxW: resize ? w : 0,
      maxH: resize ? h : 0,
      signal: abort.signal,
      onProgress: (index, total, name) => setStatus(`${index} of ${total} — ${name}`),
    }).then((processed) => {
      setRunning(false);
      setStatus(abort.signal.aborted ? `Stopped. ${processed} processed.` : `${processed} processed.`);
    });
  };
  const row = { gap: 10, alignItems: "center", marginBottom: 8 } as const;
  return (
    <Dialog open onClose={close} title="Image Processor" width={420}
      footer={<><Button variant="ghost" onClick={() => { if (running) abortRef.current?.abort(); else close(); }}>{running ? "Stop" : "Cancel"}</Button>
        <Button variant="primary" disabled={!saves.length || running} onClick={run}>Run…</Button></>}>
      <p className="val" style={{ opacity: 0.6, marginBottom: 8, fontSize: 12 }}>Pick files to batch-convert — each file is saved once per chosen file type.</p>
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 90 }}>Destination</span>
        {isTauri() ? (
          <>
            <Button onClick={() => void pickDest()}>{destDir ? destDir.split(/[/\\]/).pop() : "Choose Folder…"}</Button>
            {destDir && <Button variant="ghost" onClick={() => setDestDir(null)}>Use Downloads</Button>}
          </>
        ) : <span className="val" style={{ opacity: 0.6 }}>Downloads</span>}
      </div>
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 90 }}>File Types</span>
        <Checkbox id="mv-imageproc-jpeg" checked={jpeg} onChange={setJpeg}>JPEG</Checkbox>
        <Checkbox id="mv-imageproc-png" checked={png} onChange={setPng}>PNG</Checkbox>
        <Checkbox id="mv-imageproc-psd" checked={psd} onChange={setPsd}>PSD</Checkbox>
        <Checkbox id="mv-imageproc-tiff" checked={tiff} onChange={setTiff}>TIFF</Checkbox>
      </div>
      {jpeg && (
        <div className="monet-row" style={{ ...row, paddingLeft: 100 }}>
          <NumberField value={quality} min={1} max={100} onChange={setQuality} suffix="Quality" />
        </div>
      )}
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 90 }} />
        <Checkbox id="mv-imageproc-resize" checked={resize} onChange={setResize}>Resize to Fit</Checkbox>
        {resize && (
          <>
            <NumberField value={w} min={1} max={16384} onChange={setW} suffix="W" />
            <NumberField value={h} min={1} max={16384} onChange={setH} suffix="H" />
          </>
        )}
      </div>
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 90 }}>Run Action</span>
        <Select block id="mv-imageproc-action" aria-label="Image Processor action" value={actionId} onChange={setActionId}
          options={[{ value: "none", label: "None" }, ...saved.map((a) => ({ value: String(a.id), label: a.name }))]} />
      </div>
      <div className="monet-row" style={row}>
        <label className="lbl" htmlFor="mv-imageproc-copyright" style={{ width: 90 }}>Copyright Info</label>
        <Input block id="mv-imageproc-copyright" aria-label="Copyright info" value={copyright}
          onChange={(e) => setCopyright(e.currentTarget.value)} placeholder="© 2026 Your Name" />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 6 }}>
        Copyright is embedded into JPEG and PNG outputs. ICC profiles are embedded per the document's color settings.
      </div>
      {status && <p className="val" style={{ marginTop: 8, fontSize: 12 }}>{status}</p>}
    </Dialog>
  );
}
function ConditionalModeChange() {
  const { close } = useDialogs();
  const [sources, setSources] = useState<boolean[]>(() => COLOR_MODES.map(() => true));
  const [target, setTarget] = useState(1);
  const toggle = (i: number) => setSources((s) => s.map((v, k) => (k === i ? !v : v)));
  const commit = () => {
    const src = COLOR_MODES.map((m, i) => (sources[i] ? m.id : -1)).filter((i) => i >= 0);
    store.conditionalModeChange(src, target);
    close();
  };
  return (
    <Dialog open onClose={close} title="Conditional Mode Change" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <p className="val" style={{ opacity: 0.6, marginBottom: 6, fontSize: 12 }}>If current mode is one of:</p>
      {COLOR_MODES.map((m, i) => (
        <div key={m.id} style={{ marginBottom: 3 }}>
          <Checkbox id={`mv-conditional-source-${m.id}`} checked={sources[i]} onChange={() => toggle(i)}>{m.label}</Checkbox>
        </div>
      ))}
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginTop: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Mode</span>
        <Select id="mv-conditional-mode" value={String(target)} onChange={(v) => setTarget(+v)}
          options={COLOR_MODES.map((m) => ({ value: String(m.id), label: m.label }))} />
      </div>
    </Dialog>
  );
}
function NewArtboard() {
  const { close } = useDialogs();
  const [w, setW] = useState(store.state.doc.width);
  const [h, setH] = useState(store.state.doc.height);
  return (
    <Dialog open onClose={close} title="New Artboard" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { store.newArtboard(w, h); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 60 }}>Width</span>
        <NumberField value={w} min={1} max={8192} onChange={setW} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Height</span>
        <NumberField value={h} min={1} max={8192} onChange={setH} suffix="px" />
      </div>
    </Dialog>
  );
}
function Trap() {
  const { close } = useDialogs();
  const [width, setWidth] = useState(2);
  return (
    <Dialog open onClose={close} title="Trap" width={320}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { store.trap(width); close(); }}>OK</Button></>}>
      <p className="val" style={{ opacity: 0.6, marginBottom: 8, fontSize: 12 }}>
        Spreads lighter colours into darker at edges (hides registration gaps).
      </p>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Width</span>
        <NumberField value={width} min={1} max={10} onChange={setWidth} suffix="px" />
      </div>
    </Dialog>
  );
}
function CustomPixelAspect() {
  const { close } = useDialogs();
  const presets = useStore((s) => s.pixelAspectPresets);
  const [name, setName] = useState(() => defaultPixelAspectPresetName(store.state.pixelAspectPresets));
  const [r, setR] = useState(store.state.pixelAspect || 1);
  const commit = () => {
    if (!name.trim() || r < 0.1 || r > 10) return;
    store.savePixelAspectPreset(name, r);
    close();
  };
  return (
    <Dialog open onClose={close} title="Save Pixel Aspect Ratio" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!name.trim() || r < 0.1 || r > 10} onClick={commit}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 10 }}>
        <span className="lbl" style={{ width: 96 }}>Name</span>
        <input value={name} maxLength={80} aria-label="Pixel aspect name" autoFocus style={{ ...INP_BASE, flex: 1 }}
          onChange={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 96 }}>Factor</span>
        <input type="number" step="0.01" min="0.1" max="10" value={r} aria-label="Pixel aspect ratio"
          style={{ ...INP_BASE, flex: 1 }}
          onChange={(e) => setR(parseFloat(e.currentTarget.value) || 0)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      </div>
      {presets.some((preset) => preset.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase()) && (
        <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Saving replaces the preset with this name.</div>
      )}
    </Dialog>
  );
}
function DeletePixelAspect() {
  const { close } = useDialogs();
  const presets = useStore((s) => s.pixelAspectPresets);
  const [name, setName] = useState(() => store.state.pixelAspectPresets[0]?.name ?? "");
  const selected = presets.some((preset) => preset.name === name) ? name : (presets[0]?.name ?? "");
  return (
    <Dialog open onClose={close} title="Delete Pixel Aspect Ratio" width={380}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!selected} onClick={() => { store.deletePixelAspectPreset(selected); close(); }}>Delete</Button></>}>
      {presets.length ? (
        <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
          <span className="lbl" style={{ width: 96 }}>Pixel Aspect</span>
          <Select id="mv-delete-pixel-aspect" value={selected} onChange={setName}
            options={presets.map((preset) => ({ value: preset.name, label: preset.name }))} />
        </div>
      ) : <div style={{ color: "var(--text-3)", fontSize: 12 }}>There are no pixel aspect ratios to delete.</div>}
    </Dialog>
  );
}
function ResetPixelAspects() {
  const { close } = useDialogs();
  return (
    <Dialog open onClose={close} title="Reset Pixel Aspect Ratios" width={410}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button onClick={() => { store.resetPixelAspectPresets("append"); close(); }}>Append</Button>
        <Button variant="primary" onClick={() => { store.resetPixelAspectPresets("replace"); close(); }}>OK</Button></>}>
      <div style={{ color: "var(--text-2)", fontSize: 12, lineHeight: 1.5 }}>
        Append restores missing defaults and keeps your custom ratios. OK replaces the current list with the defaults.
      </div>
    </Dialog>
  );
}
const PROOF_MODE_OPTS: [string, string][] = [
  ["cmyk", "Working CMYK"], ["cyan", "Cyan Plate"], ["magenta", "Magenta Plate"],
  ["yellow", "Yellow Plate"], ["black", "Black Plate"], ["cmy", "CMY Plates"],
  ...OCIO_PROOF_CONFIGS.map((o) => [o.id, o.label] as [string, string]),
  ...HDR_PROOF_CONFIGS.map((o) => [o.id, o.label] as [string, string]),
  ["gamma18", "Legacy Macintosh RGB (Gamma 1.8)"],
  ["srgb", "Internet Standard RGB (sRGB)"], ["monitor", "Monitor RGB"],
  ["protanopia", "Color Blindness — Protanopia"], ["deuteranopia", "Color Blindness — Deuteranopia"],
];
function ProofSetupCustom() {
  const { close } = useDialogs();
  const profileName = useStore((s) => s.proofProfileName);
  const profileIsRgb = useStore((s) => s.proofProfileIsRgb);
  const [mode, setMode] = useState(store.state.proofMode || "cmyk");
  const [simulatePaperColor, setSimulatePaperColor] = useState(store.state.proofSimulatePaperColor);
  const [simulateBlackInk, setSimulateBlackInk] = useState(store.state.proofSimulateBlackInk);
  const [blackPointCompensation, setBlackPointCompensation] = useState(store.state.proofBpc);
  const [preserveNumbers, setPreserveNumbers] = useState(store.state.proofPreserveNumbers);
  // A loaded device profile (RGB or CMYK, View ▸ Proof Setup ▸ Custom ▸ Load…)
  // joins the built-in modes as its own "Device to Simulate" entry.
  const canPreserve = mode === "custom" && profileIsRgb;
  // Photoshop parity: Simulate Paper Color implies Simulate Black Ink (the
  // paper preview is an absolute rendering, which shows the true ink black).
  const blackInkOn = simulateBlackInk || simulatePaperColor;
  const commit = () => {
    store.setProof(mode, { simulatePaperColor, simulateBlackInk: blackInkOn, blackPointCompensation, preserveNumbers: preserveNumbers && canPreserve });
    close();
  };
  const loadProfile = async () => { if (await importProofProfileFile()) setMode("custom"); };
  return (
    <Dialog open onClose={close} title="Customize Proof Condition" width={430}
      footer={<>
        <Button variant="ghost" onClick={() => { void loadProofSetupFile().then((ok) => { if (ok) close(); }); }}>Load…</Button>
        <Button variant="ghost" onClick={() => { void saveProofSetupFile({ mode, simulatePaperColor, simulateBlackInk: blackInkOn, blackPointCompensation, preserveNumbers: preserveNumbers && canPreserve }); }}>Save…</Button>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 110 }}>Device to Simulate</span>
        <Select id="mv-proof-mode" value={mode} onChange={setMode}
          options={[
            ...(profileName ? [{ value: "custom", label: profileName }] : []),
            ...PROOF_MODE_OPTS.map(([v, l]) => ({ value: v, label: l })),
          ]} />
        <Button onClick={() => void loadProfile()}>Load Profile…</Button>
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="lbl" style={{ marginBottom: 6 }}>Display Options</div>
        <Checkbox id="mv-proof-preserve" checked={preserveNumbers && canPreserve} disabled={!canPreserve}
          onChange={setPreserveNumbers}>
          Preserve RGB Numbers
        </Checkbox>
        <Checkbox id="mv-proof-paper-color" checked={simulatePaperColor} onChange={setSimulatePaperColor}>
          Simulate Paper Color
        </Checkbox>
        <Checkbox id="mv-proof-black-ink" checked={blackInkOn} disabled={simulatePaperColor} onChange={setSimulateBlackInk}>
          Simulate Black Ink
        </Checkbox>
        <Checkbox id="mv-proof-bpc" checked={blackPointCompensation && !(preserveNumbers && canPreserve)}
          disabled={preserveNumbers && canPreserve} onChange={setBlackPointCompensation}>
          Black Point Compensation
        </Checkbox>
      </div>
      <p className="val" style={{ opacity: 0.6, marginTop: 10, fontSize: 12 }}>
        Enables Proof Colors with the chosen simulation. Load Profile installs any
        RGB or CMYK device ICC profile; Preserve RGB Numbers sends the document's
        numbers to that device unconverted. Black Point Compensation maps the
        source black onto the proof's black so shadow detail is preserved.
      </p>
    </Dialog>
  );
}
// File ▸ Print… (#440) — Photoshop's Print Settings: a preview of the image on
// the media at its print position and size, Position and Size, and Color
// Management. Done and Print remember the settings, which Print One Copy then
// reuses without this dialog; Cancel forgets every change.
const PRINT_PREVIEW_PX = 230; // the media's long edge in the preview
const PRINT_THUMB_PX = 480; // the composite is sampled once, this big
const PRINT_ICC_SPACES = ["RGB ", "CMYK"] as const;
const WHITE_PIXEL = new Uint8ClampedArray([255, 255, 255, 255]);
function PrintDialog() {
  const { close } = useDialogs();
  const docWidth = store.state.doc.width, docHeight = store.state.doc.height, ppi = store.state.resolutionPpi;
  const [settings, setSettings] = useState(loadPrintSettings);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<PrintSettings>) => { setSettings((s) => ({ ...s, ...patch })); setError(null); };
  const layout = printLayout(settings, docWidth, docHeight, ppi);
  const managed = settings.colorHandling === "photoshop";
  // Top/Left and the print size read in the document's units at its ppi.
  const unit = useMemo(loadRulerUnit, []);
  const unitDef = DOCUMENT_SIZE_UNITS.find((candidate) => candidate.value === unit)!;
  const precision = documentSizePrecision(unit, ppi);
  const toUnit = (inches: number) => convertDocumentLength(inches, "in", unit, ppi);
  const fromUnit = (value: number) => convertDocumentLength(value, unit, "in", ppi);
  const naturalWidth = docWidth / ppi, naturalHeight = docHeight / ppi;

  // The composite, sampled once as raw document numbers (no iCCP decode).
  const [thumb, setThumb] = useState<ImageData | null>(null);
  useEffect(() => {
    let live = true;
    const png = engine.e.export_scaled_png(Math.min(1, PRINT_THUMB_PX / Math.max(docWidth, docHeight)));
    void pngToImageData(png, false).then((img) => { if (live) setThumb(img); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Match Print Colors soft-proofs through the printer profile with the print
  // intent and BPC (View ▸ Proof Colors' own bake); otherwise the display LUT.
  const [printerIcc, setPrinterIcc] = useState<Uint8Array | null>(null);
  useEffect(() => {
    let live = true;
    void (settings.profile === "icc" ? Promise.resolve(decodeProfileIcc(settings.profileIcc)) : store.workingCmykProfile())
      .then((bytes) => { if (live) setPrinterIcc(bytes); });
    return () => { live = false; };
  }, [settings.profile, settings.profileIcc]);
  const proof = managed && settings.matchPrintColors;
  const proofLut = useMemo(
    () => (proof && printerIcc ? engine.e.proof_lut(exportIccBytes(), printerIcc, settings.intent, 33, settings.bpc) : null),
    [proof, printerIcc, settings.intent, settings.bpc],
  );
  const displayLut = useMemo(() => engine.e.display_lut(33, exportIccBytes()), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumb) return;
    canvas.width = thumb.width;
    canvas.height = thumb.height;
    const pixels = printPreviewPixels(thumb.data, proofLut ?? displayLut, !!proofLut, settings.showPaperWhite);
    canvas.getContext("2d")?.putImageData(new ImageData(pixels, thumb.width, thumb.height), 0, 0);
  }, [thumb, proofLut, displayLut, settings.showPaperWhite]);
  const paper = proofLut ? printPreviewPixels(WHITE_PIXEL, proofLut, true, settings.showPaperWhite) : WHITE_PIXEL;
  const k = PRINT_PREVIEW_PX / Math.max(layout.pageWidth, layout.pageHeight); // preview px per inch

  const printerProfiles = [
    { value: "cmyk", label: "Working CMYK — ISO Coated v2 300% (ECI)" },
    ...(settings.profile === "icc" || settings.profileIcc ? [{ value: "icc", label: settings.profileName || "Loaded Profile" }] : []),
    { value: "load", label: "Load Profile…" },
  ];
  const pickProfile = (value: string) => {
    if (value !== "load") { set({ profile: value as PrintSettings["profile"] }); return; }
    void (async () => {
      try {
        const info = await importDocumentIccProfile(PRINT_ICC_SPACES);
        if (info) set({ profile: "icc", profileName: info.name, profileIcc: encodeProfileIcc(info.bytes) });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  };
  const clampScale = (scale: number) => Math.min(PRINT_SCALE_MAX, Math.max(PRINT_SCALE_MIN, Number(scale.toFixed(2))));
  // Unchecking Center or Scale to Fit Media starts from where the image is now.
  const toggleCenter = (center: boolean) => set(center ? { center } : { center, top: layout.top, left: layout.left });
  const toggleFit = (fit: boolean) => set(fit ? { fit } : { fit, scale: clampScale(layout.scale) });
  const sizeField = (natural: number) => ({
    min: toUnit(natural * PRINT_SCALE_MIN / 100), max: toUnit(natural * PRINT_SCALE_MAX / 100),
    onChange: (value: number) => set({ scale: clampScale(fromUnit(value) / natural * 100) }),
  });

  const done = () => {
    const problem = printSettingsError(settings, layout);
    if (problem) { setError(problem); return; }
    savePrintSettings(settings);
    close();
  };
  const print = async () => {
    let job: Awaited<ReturnType<typeof preparePrintJob>>;
    try {
      job = await preparePrintJob(settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    savePrintSettings(settings);
    close();
    await spoolPrintJob(job);
  };
  return (
    <Dialog open onClose={close} title="Print Settings" width={680}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="ghost" onClick={done}>Done</Button>
        <Button variant="primary" onClick={() => void print()}>Print</Button></>}>
      <div style={{ display: "flex", gap: 18 }}>
        <div style={{ width: PRINT_PREVIEW_PX + 10, flexShrink: 0 }}>
          <div style={{ height: PRINT_PREVIEW_PX + 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div data-mv-print-media aria-label="Print preview" role="img"
              style={{ position: "relative", overflow: "hidden", width: layout.pageWidth * k, height: layout.pageHeight * k,
                background: `rgb(${paper[0]}, ${paper[1]}, ${paper[2]})`, boxShadow: "0 1px 4px rgba(0,0,0,0.45)" }}>
              <canvas ref={canvasRef} data-mv-print-preview={proofLut ? (settings.showPaperWhite ? "paper" : "proof") : "display"}
                style={{ position: "absolute", left: layout.left * k, top: layout.top * k, width: layout.width * k, height: layout.height * k }} />
            </div>
          </div>
          <div className="val" data-mv-print-resolution style={{ textAlign: "center", fontSize: 11, opacity: 0.7, marginTop: 6 }}>
            Print Resolution: {Math.round(layout.ppi)} PPI
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionLabel>Printer Setup</SectionLabel>
          <TField label="Media"><Select block id="mv-print-media" aria-label="Media size" value={settings.media}
            onChange={(v) => set({ media: v as PrintSettings["media"] })}
            options={PRINT_MEDIA.map((m) => ({ value: m.id, label: m.label }))} /></TField>
          <TField label="Layout"><Select block id="mv-print-orientation" aria-label="Page orientation"
            value={settings.landscape ? "landscape" : "portrait"} onChange={(v) => set({ landscape: v === "landscape" })}
            options={[{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} /></TField>
          <SectionLabel>Color Management</SectionLabel>
          <TField label="Color Handling"><Select block id="mv-print-color-handling" aria-label="Color handling"
            value={settings.colorHandling} onChange={(v) => set({ colorHandling: v as PrintSettings["colorHandling"] })}
            options={[{ value: "photoshop", label: "Photoshop Manages Colors" }, { value: "printer", label: "Printer Manages Colors" }]} /></TField>
          <TField label="Printer Profile"><Select block id="mv-print-profile" aria-label="Printer profile" disabled={!managed}
            value={settings.profile} onChange={pickProfile} options={printerProfiles} /></TField>
          <TField label="Rendering Intent"><Select block id="mv-print-intent" aria-label="Rendering intent" disabled={!managed}
            value={String(settings.intent)} onChange={(v) => set({ intent: Number(v) as RenderingIntentId })} options={intentOptions} /></TField>
          <Checkbox id="mv-print-bpc" disabled={!managed} checked={settings.bpc} onChange={(v) => set({ bpc: v })}>Black Point Compensation</Checkbox>
          <Checkbox id="mv-print-match" disabled={!managed} checked={settings.matchPrintColors} onChange={(v) => set({ matchPrintColors: v })}>Match Print Colors</Checkbox>
          <Checkbox id="mv-print-paper-white" disabled={!proof} checked={settings.showPaperWhite} onChange={(v) => set({ showPaperWhite: v })}>Show Paper White</Checkbox>
          {managed && <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 4 }}>
            Turn off color management in the print dialog, so the printer does not convert the colors a second time.
          </div>}
          <SectionLabel>Position and Size</SectionLabel>
          <Checkbox id="mv-print-center" checked={settings.center} onChange={toggleCenter}>Center</Checkbox>
          <TField label="Top"><NumberField block id="mv-print-top" aria-label="Top" disabled={settings.center} value={toUnit(layout.top)}
            step={unitDef.step} precision={precision} suffix={unitDef.suffix} onChange={(v) => set({ top: fromUnit(v) })} /></TField>
          <TField label="Left"><NumberField block id="mv-print-left" aria-label="Left" disabled={settings.center} value={toUnit(layout.left)}
            step={unitDef.step} precision={precision} suffix={unitDef.suffix} onChange={(v) => set({ left: fromUnit(v) })} /></TField>
          <Checkbox id="mv-print-fit" checked={settings.fit} onChange={toggleFit}>Scale to Fit Media</Checkbox>
          <TField label="Scale"><NumberField block id="mv-print-scale" aria-label="Scale" disabled={settings.fit} value={Number(layout.scale.toFixed(2))}
            min={PRINT_SCALE_MIN} max={PRINT_SCALE_MAX} step={1} precision={2} suffix="%" onChange={(v) => set({ scale: v })} /></TField>
          <TField label="Height"><NumberField block id="mv-print-height" aria-label="Print height" disabled={settings.fit} value={toUnit(layout.height)}
            step={unitDef.step} precision={precision} suffix={unitDef.suffix} {...sizeField(naturalHeight)} /></TField>
          <TField label="Width"><NumberField block id="mv-print-width" aria-label="Print width" disabled={settings.fit} value={toUnit(layout.width)}
            step={unitDef.step} precision={precision} suffix={unitDef.suffix} {...sizeField(naturalWidth)} /></TField>
          <ColorPolicyWarning kind="print-clip" text={printLayoutClips(layout) ? "Part of the image falls outside the media and will not print." : null} />
          {error && <p role="alert" data-mv-print-error style={{ margin: "8px 0 0", color: "var(--danger, #ff6b6b)", fontSize: 11 }}>{error}</p>}
        </div>
      </div>
    </Dialog>
  );
}
// View ▸ 32-bit Preview Options — display-only exposure/gamma tone map for
// the live canvas of a 32-bit (float) document. Unlike the adjustment
// dialogs above, there is no `apply`/history step: the preview never touches
// pixels, so live sliders just call `engine.setHdrPreview` directly. Cancel
// restores whatever was active when the dialog opened (the same "Cancel
// reverts" contract as the live-preview dialogs, minus the undo).
function HdrPreviewDialog() {
  const { close } = useDialogs();
  const depth = useStore((s) => s.depth);
  const is32 = depth === 32;
  const initial = useRef(engine.getHdrPreview()).current;
  const committed = useRef(false);
  const [on, setOn] = useState(initial.on);
  const [method, setMethod] = useState<HdrPreviewMethod>(initial.method as HdrPreviewMethod);
  const [exposure, setExposure] = useState(initial.exposure);
  const [gamma, setGamma] = useState(initial.gamma);
  useEffect(() => {
    engine.setHdrPreview(on && is32, method, exposure, gamma);
  }, [on, method, exposure, gamma, is32]);
  useEffect(() => () => {
    const next = hdrPreviewOnDismiss(committed.current, initial, engine.getHdrPreview());
    if (!committed.current) engine.setHdrPreview(next.on, next.method, next.exposure, next.gamma);
  }, [initial]);
  const cancel = () => {
    const next = hdrPreviewOnDismiss(false, initial, engine.getHdrPreview());
    engine.setHdrPreview(next.on, next.method, next.exposure, next.gamma);
    close();
  };
  const ok = () => {
    committed.current = true;
    close();
  };
  return (
    <Dialog open onClose={cancel} title="32-bit Preview Options" width={360}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button>
        <Button variant="primary" onClick={ok}>OK</Button></>}>
      {!is32 && (
        <p className="val" style={{ opacity: 0.6, marginBottom: 10, fontSize: 12 }}>
          This document isn't 32-bit — these settings have no effect until it is.
        </p>
      )}
      <Checkbox checked={on} onChange={setOn}>Preview On</Checkbox>
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginTop: 10 }}>
        <span className="lbl" style={{ width: 96 }}>Method</span>
        <Select id="mv-hdr-preview-method" value={String(method)}
          onChange={(v) => setMethod(Number(v) as HdrPreviewMethod)}
          options={HDR_PREVIEW_METHODS.map((m) => ({ value: String(m.value), label: m.label }))} />
      </div>
      <Row label="Exposure" value={exposure} min={HDR_EXPOSURE_MIN} max={HDR_EXPOSURE_MAX} decimals={2}
        onChange={setExposure} />
      {method === 0 && (
        <Row label="Gamma" value={gamma} min={HDR_GAMMA_MIN} max={HDR_GAMMA_MAX} decimals={2}
          onChange={setGamma} />
      )}
    </Dialog>
  );
}
const EXTRAS_OPTS: [string, string][] = [
  ["showGrid", "Grid"], ["showPixelGrid", "Pixel Grid"], ["showLayerEdges", "Layer Edges"],
  ["showSelectionEdges", "Selection Edges"], ["showTargetPath", "Target Path"],
  ["showBrushPreview", "Brush Preview"], ["showGuides", "Guides"], ["showRulers", "Rulers"],
];
function ShowExtrasOptions() {
  const { close } = useDialogs();
  const snap = useStore((s) => s);
  return (
    <Dialog open onClose={close} title="Show Extras Options" width={300}
      footer={<Button variant="primary" onClick={close}>OK</Button>}>
      <p className="val" style={{ opacity: 0.6, marginBottom: 8, fontSize: 12 }}>
        Choose which overlays appear when Extras (⌘H) is on.
      </p>
      {EXTRAS_OPTS.map(([k, label]) => (
        <div key={k} style={{ marginBottom: 4 }}>
          <Checkbox checked={!!(snap as unknown as Record<string, boolean>)[k]}
            onChange={() => store.toggleView(k as Parameters<typeof store.toggleView>[0])}>{label}</Checkbox>
        </div>
      ))}
    </Dialog>
  );
}
function SolidFillLayer() {
  const { close, arg } = useDialogs();
  const edit = layerContentArg(arg, LAYER_KIND.fill, 0);
  const [r0, g0, b0] = hsvToRgba(store.state.fg);
  const initial = edit && edit.params.length >= 3
    ? rgbHex([Math.round(edit.params[0] * 255), Math.round(edit.params[1] * 255), Math.round(edit.params[2] * 255)])
    : rgbHex([r0, g0, b0]);
  const [hex, setHex] = useState(initial);
  const [ir, ig, ib] = hexRgb(initial);
  const scratch = useScratchFillLayer(
    () => store.addSolidFillLayer(ir, ig, ib),
    edit?.layerId,
  );
  const update = (next: string) => {
    setHex(next);
    if (/^#[0-9a-fA-F]{6}$/.test(next)) {
      const [r, g, b] = hexRgb(next);
      scratch.applyParams(new Float32Array([r / 255, g / 255, b / 255, 1]));
    }
  };
  const cancel = () => scratch.cancel(close);
  return (
    <Dialog open onClose={cancel} title="Color Fill" width={320}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button>
        <Button variant="primary" onClick={() => scratch.finish(close)}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 48 }}>Color</span>
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000"} aria-label="Fill color"
          onChange={(e) => update(e.currentTarget.value)}
          style={{ width: 40, height: 28, padding: 0, border: "none", background: "none" }} />
        <input type="text" value={hex} aria-label="Fill color hex" style={{ ...INP_BASE, width: 110 }}
          onChange={(e) => update(e.currentTarget.value)} />
      </div>
    </Dialog>
  );
}

function GradientFillLayer() {
  const { close, arg } = useDialogs();
  const edit = layerContentArg(arg, LAYER_KIND.fill, 1);
  const [stops, setStops] = useState<GradientStop[]>(() => edit
    ? gradientFillStopsFromParams(edit.params)
    : store.state.gradientStops.map((s) => ({ ...s })));
  const scratch = useScratchFillLayer(
    () => store.addGradientFillLayer(stops),
    edit?.layerId,
  );
  const update = (next: GradientStop[]) => {
    setStops(next);
    scratch.applyParams(packGradientFill(next));
  };
  const cancel = () => scratch.cancel(close);
  return (
    <Dialog open onClose={cancel} title="Gradient Fill" width={500}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button>
        <Button variant="primary" onClick={() => scratch.finish(close)}>OK</Button></>}>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 10 }}>
        Edit the top-to-bottom gradient. The attached layer mask controls where the fill appears.
      </div>
      <GradientBar stops={stops} onChange={update} />
    </Dialog>
  );
}

// One pattern tile as a thumbnail. The library keeps 16-bit texels (the engine's
// layout), so the top byte of each channel is the 8-bit canvas value.
function PatternSwatch({ preset, size = 30 }: { preset: PatternPreset; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(preset.w, preset.h);
    for (let i = 0; i < img.data.length; i++) img.data[i] = preset.px[i] >> 8;
    ctx.putImageData(img, 0, 0);
  }, [preset]);
  return (
    <canvas ref={ref} width={preset.w} height={preset.h} aria-hidden="true"
      style={{ width: size, height: size, display: "block", borderRadius: 2, imageRendering: "pixelated" }} />
  );
}

// Photoshop's pattern picker: the named Patterns library (Edit ▸ Define Pattern),
// one thumbnail each. Picking pushes that tile into the engine's active slot,
// which every pattern consumer reads.
// Pick + delete here; rename and reorder live in the Preset Manager alongside the
// other libraries, which now carries a "patterns" category.
function PatternPicker({ onPick }: { onPick?: () => void }) {
  const presets = useStore((s) => s.patternPresets);
  const active = useStore((s) => s.activePattern);
  if (!presets.length) {
    return (
      <span data-mv-pattern-picker style={{ color: "var(--text-3)", fontSize: 11 }}>
        No patterns yet — Edit ▸ Define Pattern captures the selection as one.
      </span>
    );
  }
  return (
    <div data-mv-pattern-picker role="listbox" aria-label="Patterns" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "flex-start" }}>
      {presets.map((p, i) => (
        <div key={`${p.name}-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <button type="button" role="option" aria-selected={i === active} title={p.name} aria-label={p.name}
            data-mv-pattern-swatch onClick={() => { store.selectPattern(i); onPick?.(); }}
            style={{ padding: 2, borderRadius: 4, cursor: "pointer", background: "var(--surface-2, rgba(255,255,255,0.05))",
              border: `2px solid ${i === active ? "var(--accent, #4a9eff)" : "transparent"}` }}>
            <PatternSwatch preset={p} />
          </button>
          <button type="button" aria-label={`Delete ${p.name}`} title={`Delete ${p.name}`}
            data-mv-pattern-delete onClick={() => store.removePatternPreset(i)}
            style={{ border: "none", background: "none", color: "var(--text-3)", cursor: "pointer", fontSize: 11, lineHeight: 1, padding: 0 }}>×</button>
        </div>
      ))}
    </div>
  );
}

function PatternFillLayer() {
  const { close, arg } = useDialogs();
  const edit = layerContentArg(arg, LAYER_KIND.fill, 2);
  const [scale, setScale] = useState(() => Math.max(1, Math.min(1000, edit?.params[2] ?? 100)));
  const scratch = useScratchFillLayer(
    () => store.addPatternFillLayer(),
    edit?.layerId,
  );
  const updateScale = (next: number) => {
    setScale(next);
    scratch.applyPatternScale(next);
  };
  const cancel = () => scratch.cancel(close);
  return (
    <Dialog open onClose={cancel} title="Pattern Fill" width={360}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button>
        <Button variant="primary" onClick={() => scratch.finish(close)}>OK</Button></>}>
      <Row label="Scale" value={scale} min={1} max={1000} format={(v) => `${Math.round(v)}%`} onChange={updateScale} />
      <div style={{ marginTop: 10 }}>
        <div className="lbl" style={{ marginBottom: 4 }}>Pattern</div>
        {/* Picking repoints the engine's tile, then re-stamps it into THIS layer,
            so two pattern fill layers in one document can use different patterns. */}
        <PatternPicker onPick={() => scratch.replacePattern()} />
      </div>
    </Dialog>
  );
}
function DuplicateImage() {
  const { close } = useDialogs();
  const [name, setName] = useState(`${store.state.doc.name.replace(/\.[^.]+$/, "")} copy`);
  const [merged, setMerged] = useState(false);
  return (
    <Dialog open onClose={close} title="Duplicate Image" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { store.duplicateDocument(name, merged); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 12 }}>
        <span className="lbl" style={{ width: 28 }}>As</span>
        <input type="text" value={name} aria-label="Duplicate name"
          style={{ flex: 1, height: 26, fontSize: 12, padding: "0 6px", borderRadius: 4, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-1)" }}
          onChange={(e) => setName(e.currentTarget.value)} />
      </div>
      <Checkbox checked={merged} onChange={setMerged}>Duplicate Merged Layers Only</Checkbox>
    </Dialog>
  );
}
function NewDocument() {
  const { close } = useDialogs();
  const pixelAspectPresets = useStore((s) => s.pixelAspectPresets);
  const [w, setW] = useState(1280); const [h, setH] = useState(800);
  const [resolutionPpi, setResolutionPpi] = useState(DEFAULT_DOCUMENT_RESOLUTION_PPI);
  const [colorMode, setColorMode] = useState(0);
  const [colorProfile, setColorProfile] = useState<number>(() => store.state.documents.length ? 0 : store.state.colorProfile);
  const [unit, setUnit] = useState<DocumentSizeUnit>("px");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [bg, setBg] = useState<BgContents>(store.state.filePrefs.newDocumentBackground);
  const [pixelAspectName, setPixelAspectName] = useState(() => store.state.pixelAspectPresets.find((preset) => preset.ratio === 1)?.name ?? store.state.pixelAspectPresets[0]?.name ?? "Square");
  const pixelSize = documentSizeToPixels(w, h, unit, resolutionPpi, MAX_NEW_DOCUMENT_DIMENSION_PX);
  const presetName = presetForSettings(pixelSize.w, pixelSize.h, resolutionPpi, colorMode, colorProfile, unit)?.name ?? CUSTOM_PRESET;
  const unitDef = DOCUMENT_SIZE_UNITS.find((candidate) => candidate.value === unit)!;
  const sizePrecision = documentSizePrecision(unit, resolutionPpi);
  const minSize = documentSizeFromPixels(1, 1, unit, resolutionPpi);
  const maxSize = documentSizeFromPixels(MAX_NEW_DOCUMENT_DIMENSION_PX, MAX_NEW_DOCUMENT_DIMENSION_PX, unit, resolutionPpi);
  const setWidth = (value: number) => { setW(value); if (value !== h) setOrientation(value > h ? "landscape" : "portrait"); };
  const setHeight = (value: number) => { setH(value); if (w !== value) setOrientation(w > value ? "landscape" : "portrait"); };
  const pickOrientation = (next: string) => {
    const selected = next as Orientation;
    const size = orientSize(w, h, selected);
    setW(size.w); setH(size.h); setOrientation(selected);
  };
  const pickUnit = (next: string) => {
    const selected = next as DocumentSizeUnit;
    const size = documentSizeFromPixels(pixelSize.w, pixelSize.h, selected, resolutionPpi);
    setW(size.w); setH(size.h); setUnit(selected);
  };
  const setResolution = (next: number) => {
    const nextMin = documentSizeFromPixels(1, 1, unit, next);
    const nextMax = documentSizeFromPixels(MAX_NEW_DOCUMENT_DIMENSION_PX, MAX_NEW_DOCUMENT_DIMENSION_PX, unit, next);
    const nextW = Math.min(nextMax.w, Math.max(nextMin.w, w));
    const nextH = Math.min(nextMax.h, Math.max(nextMin.h, h));
    setW(nextW); setH(nextH); setResolutionPpi(next);
    if (nextW !== nextH) setOrientation(nextW > nextH ? "landscape" : "portrait");
  };
  const pixelAspectOptions = pixelAspectPresets.length
    ? pixelAspectPresets.map((preset) => ({ value: preset.name, label: preset.name }))
    : [{ value: "Square", label: "Square" }];
  const pixelAspect = pixelAspectPresets.find((preset) => preset.name === pixelAspectName)?.ratio ?? 1;
  return (
    <Dialog open onClose={close} title="New Document" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { store.newDocument(pixelSize.w, pixelSize.h, "Untitled", bg, pixelAspect, { resolutionPpi, colorMode, colorProfile }); close(); }}>Create</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Preset</span>
        <Select id="mv-doc-preset" value={presetName}
          onChange={(v) => { const p = presetByName(v); if (p) { const size = presetDisplaySize(p); setW(size.w); setH(size.h); setResolutionPpi(p.resolutionPpi); setColorMode(p.colorMode); setColorProfile(p.colorProfile); setUnit(p.unit); if (size.w !== size.h) setOrientation(size.w > size.h ? "landscape" : "portrait"); } }}
          options={[{ value: CUSTOM_PRESET, label: CUSTOM_PRESET }, ...DOC_PRESETS.map((p) => ({ value: p.name, label: p.name }))]} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Width</span>
        <NumberField id="mv-doc-width" aria-label="Width" value={w} min={minSize.w} max={maxSize.w} step={unitDef.step} precision={sizePrecision} onChange={setWidth} suffix={unitDef.suffix} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Height</span>
        <NumberField id="mv-doc-height" aria-label="Height" value={h} min={minSize.h} max={maxSize.h} step={unitDef.step} precision={sizePrecision} onChange={setHeight} suffix={unitDef.suffix} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Units</span>
        <Select id="mv-doc-units" aria-label="Units" value={unit} onChange={pickUnit}
          options={DOCUMENT_SIZE_UNITS.map((candidate) => ({ value: candidate.value, label: candidate.label }))} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Orientation</span>
        <SegmentedControl aria-label="Orientation" value={orientation} onChange={pickOrientation}
          items={[{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Resolution</span>
        <NumberField id="mv-doc-resolution" aria-label="Resolution" value={resolutionPpi} min={1} max={MAX_DOCUMENT_RESOLUTION_PPI} onChange={setResolution} suffix="ppi" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Color Mode</span>
        <Select id="mv-doc-color-mode" aria-label="Color Mode" value={String(colorMode)} onChange={(value) => { const mode = Number(value); setColorMode(mode); if (mode !== 0) setColorProfile(0); }}
          options={COLOR_MODES.map((mode) => ({ value: String(mode.id), label: mode.label }))} />
      </div>
      {colorMode === 0 && <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Profile</span>
        <Select id="mv-doc-color-profile" aria-label="Color Profile" value={String(colorProfile)} onChange={(value) => setColorProfile(Number(value))}
          options={profileOptions} />
      </div>}
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Background</span>
        <Select id="mv-doc-bg" value={bg} onChange={(v) => setBg(v as BgContents)}
          options={BG_CONTENTS.map((o) => ({ value: o.key, label: o.label }))} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginTop: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Pixel Aspect</span>
        <Select id="mv-doc-pixel-aspect" value={pixelAspectName} onChange={setPixelAspectName}
          options={pixelAspectOptions} />
      </div>
    </Dialog>
  );
}
function ImageSize() {
  const { close } = useDialogs();
  const ownerDocId = useRef(store.state.activeDocId).current;
  // Original document dimensions, captured when the dialog opens (constant until close).
  const ow = store.state.doc.width, oh = store.state.doc.height;
  const ppi = store.state.resolutionPpi; // physical units resolve through the document's print resolution
  const [unit, setUnit] = useState<ImageSizeUnit>(loadRulerUnit); // Preferences ▸ Units & Rulers
  const [w, setW] = useState(() => imageSizeFromPixels(ow, unit, ow, ppi));
  const [h, setH] = useState(() => imageSizeFromPixels(oh, unit, oh, ppi));
  const [link, setLink] = useState(true); // Constrain proportions (Photoshop default: on)
  // In percent mode the linked partner mirrors the same percentage (proportional);
  // otherwise it preserves the px aspect and is shown back in the current unit.
  const linkedTo = (v: number, from: number, to: number, partner: (px: number, a: number, b: number) => number) =>
    unit === "percent" ? v : imageSizeFromPixels(partner(imageSizeToPixels(v, unit, from, ppi), ow, oh), unit, to, ppi);
  const onW = (v: number) => { setW(v); if (link) setH(linkedTo(v, ow, oh, linkedHeight)); };
  const onH = (v: number) => { setH(v); if (link) setW(linkedTo(v, oh, ow, linkedWidth)); };
  const onUnit = (u: ImageSizeUnit) => {
    if (u === unit) return;
    const wPx = imageSizeToPixels(w, unit, ow, ppi), hPx = imageSizeToPixels(h, unit, oh, ppi);
    setW(imageSizeFromPixels(wPx, u, ow, ppi));
    setH(imageSizeFromPixels(hPx, u, oh, ppi));
    setUnit(u);
  };
  const unitDef = IMAGE_SIZE_UNITS.find((candidate) => candidate.value === unit)!;
  const precision = unit === "percent" ? 0 : documentSizePrecision(unit, ppi);
  const min = unit === "percent" ? 1 : imageSizeFromPixels(1, unit, ow, ppi);
  const max = unit === "percent" ? 1000 : imageSizeFromPixels(8192, unit, ow, ppi);
  const wPx = imageSizeToPixels(w, unit, ow, ppi), hPx = imageSizeToPixels(h, unit, oh, ppi);
  // The field cap bounds the *unit* value, not the pixel count — 500% of a
  // 4000×3000 photo is 300 Mpx — and the engine's resize_image just returns when
  // dims_ok fails, so an over-budget request would close the dialog and do
  // nothing. Refuse it visibly, the way Canvas Size does. (#160)
  const oversized = !canvasSizeFits(wPx, hPx);
  return (
    <Dialog open onClose={close} title="Image Size" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={oversized} onClick={() => {
          commitOwnedEdit(ownerDocId, store.state.activeDocId, () => { xform.resizeImage(wPx, hPx); }, close);
        }}>Resize</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Width</span>
        <NumberField id="mv-imgsize-w" value={w} min={min} max={max} step={unitDef.step} precision={precision} onChange={onW} suffix={unitDef.suffix} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Height</span>
        <NumberField id="mv-imgsize-h" value={h} min={min} max={max} step={unitDef.step} precision={precision} onChange={onH} suffix={unitDef.suffix} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Units</span>
        <Select id="mv-imgsize-unit" value={unit} aria-label="Units" style={{ flex: 1 }}
          onChange={(v) => onUnit(v as ImageSizeUnit)}
          options={IMAGE_SIZE_UNITS} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Pixel Size</span>
        <span style={{ color: "var(--text-3)" }}>
          {wPx} × {hPx} px at {ppi} ppi
        </span>
      </div>
      <Checkbox id="mv-imgsize-link" checked={link} onChange={setLink}>Constrain proportions</Checkbox>
      {oversized && <p role="alert" style={{ margin: "8px 0 0", color: "var(--danger, #ff6b6b)", fontSize: 11 }}>
        The requested size exceeds the document image-size limit.
      </p>}
    </Dialog>
  );
}
function ExpandContract() {
  const { close } = useDialogs();
  const [n, setN] = useState(4);
  return (
    <Dialog open onClose={close} title="Expand / Contract Selection" width={320}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button onClick={() => { store.contractSelection(n); close(); }}>Contract</Button>
        <Button variant="primary" onClick={() => { store.expandSelection(n); close(); }}>Expand</Button></>}>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Pixels</span>
        <NumberField value={n} min={1} max={500} onChange={setN} suffix="px" />
      </div>
    </Dialog>
  );
}
function FillContents() {
  const { close } = useDialogs();
  const hasHistorySource = useStore((s) => s.hasHistorySource);
  const [contents, setContents] = useState<FillContent>("fg");
  const [color, setColor] = useState("#000000");
  const [mode, setMode] = useState("normal");
  const [opacity, setOpacity] = useState(1);
  const [preserve, setPreserve] = useState(false);
  const apply = () => {
    if (contents === "contentAware") contentAwareFill(); // ignores Preserve Transparency
    else store.fillContents(contents, opacity, mode, hexToRgb(color), preserve);
    close();
  };
  return (
    <Dialog open onClose={close} title="Fill" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={apply}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Contents</span>
        <Select id="mv-fill-contents" value={contents} aria-label="Contents" style={{ flex: 1 }}
          onChange={(v) => setContents(v as FillContent)}
          options={FILL_CONTENTS.map((o) => ({ value: o.value, label: o.label, disabled: o.value === "history" && !hasHistorySource }))} />
      </div>
      {contents === "color" && (
        <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
          <span className="lbl" style={{ width: 70 }}>Color</span>
          <input type="color" id="mv-fill-color" value={color} aria-label="Fill color"
            onChange={(e) => setColor(e.currentTarget.value)} />
        </div>
      )}
      {contents === "pattern" && (
        <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
          <span className="lbl" style={{ width: 70 }}>Pattern</span>
          <PatternPicker />
        </div>
      )}
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Mode</span>
        <Select value={mode} onChange={setMode}
          options={BLEND_ORDER.slice(0, 25).map((k) => ({ value: k, label: titleCase(k) }))} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Opacity</span>
        <Slider min={0} max={1} step={0.01} value={opacity} onChange={setOpacity} />
        <span style={{ width: 40, textAlign: "right" }}>{Math.round(opacity * 100)}%</span>
      </div>
      <Checkbox id="mv-fill-preserve" checked={preserve} onChange={setPreserve}>Preserve Transparency</Checkbox>
    </Dialog>
  );
}
function Fade() {
  const [opacity, setOpacity] = useState(100);
  const [mode, setMode] = useState("normal");
  return (
    <PreviewDialog title="Fade" width={360} deps={[opacity, mode]}
      apply={() => store.fadeLast(opacity / 100, mode)}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Opacity</span>
        <input type="number" value={opacity} aria-label="Opacity" min={0} max={100}
          style={{ width: 70, height: 26, fontSize: 12, padding: "0 6px", borderRadius: 4, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-1)" }}
          onChange={(e) => setOpacity(Number(e.currentTarget.value) || 0)} />
        <span style={{ color: "var(--text-3)", fontSize: 11 }}>%</span>
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Mode</span>
        <Select value={mode} onChange={setMode}
          options={BLEND_ORDER.slice(0, 25).map((k) => ({ value: k, label: titleCase(k) }))} />
      </div>
    </PreviewDialog>
  );
}
function ReplaceColor() {
  const { close } = useDialogs();
  const [state, setState] = useState<ReplaceColorAdjust>(defaultReplaceColor);
  const set = (patch: Partial<ReplaceColorAdjust>) => setState((s) => ({ ...s, ...patch }));
  const inp = { ...INP_BASE, width: 70 };
  const field = (label: string, value: number, onChange: (n: number) => void) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 76 }}>{label}</span>
      <input type="number" value={value} aria-label={label} style={inp} onChange={(e) => onChange(Number(e.currentTarget.value) || 0)} />
    </div>
  );
  return (
    <Dialog open onClose={close} title="Replace Color" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { store.replaceColor(...replaceColorEngineArgs(state)); close(); }}>OK</Button></>}>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 10 }}>Replaces pixels near the foreground colour.</div>
      {field("Fuzziness", state.fuzziness, (n) => set({ fuzziness: n }))}
      {field("Hue", state.hue, (n) => set({ hue: n }))}
      {field("Saturation", state.saturation, (n) => set({ saturation: n }))}
      {field("Lightness", state.lightness, (n) => set({ lightness: n }))}
    </Dialog>
  );
}
type ColorRangeSampleMode = "replace" | "add" | "subtract";
const COLOR_RANGE_PRESETS: readonly {
  value: string;
  label: string;
  samples?: readonly ColorRangeSample[];
  tonal?: number; // 0 shadows / 1 midtones / 2 highlights
  gamut?: boolean;
}[] = [
  { value: "sampled", label: "Sampled Colors" },
  // Tonal bands are a luminance predicate, not an RGB cluster, so they run
  // through select_tonal_range instead of the sampled-colour path.
  { value: "shadows", label: "Shadows", tonal: 0 },
  { value: "midtones", label: "Midtones", tonal: 1 },
  { value: "highlights", label: "Highlights", tonal: 2 },
  // Out of Gamut asks the proof, not the image, so it has its own route too.
  { value: "gamut", label: "Out of Gamut", gamut: true },
  { value: "reds", label: "Reds", samples: [[255, 0, 0], [192, 32, 32], [255, 96, 96]] },
  { value: "yellows", label: "Yellows", samples: [[255, 255, 0], [192, 160, 24], [255, 224, 96]] },
  { value: "greens", label: "Greens", samples: [[0, 255, 0], [32, 160, 48], [112, 224, 96]] },
  { value: "cyans", label: "Cyans", samples: [[0, 255, 255], [32, 160, 192], [96, 224, 255]] },
  { value: "blues", label: "Blues", samples: [[0, 0, 255], [32, 64, 192], [96, 128, 255]] },
  { value: "magentas", label: "Magentas", samples: [[255, 0, 255], [192, 32, 160], [255, 96, 224]] },
  // Representative light→deep skin samples; the graded falloff fills between them.
  { value: "skin", label: "Skin Tones", samples: [[244, 208, 177], [224, 172, 138], [198, 134, 94], [141, 85, 58], [92, 51, 35]] },
];
const sameColorRangeSample = (a: ColorRangeSample, b: ColorRangeSample) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const colorRangeHex = ([r, g, b]: ColorRangeSample) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function ColorRange() {
  const { close } = useDialogs();
  const initialSample = useMemo<ColorRangeSample>(() => {
    const [r, g, b] = hsvToRgba(store.state.fg);
    return [r, g, b];
  }, []);
  const [fuzziness, setFuzz] = useState(40);
  const [mode, setMode] = useState("0");
  const [sampleMode, setSampleMode] = useState<ColorRangeSampleMode>("replace");
  const [samples, setSamples] = useState<ColorRangeSample[]>([initialSample]);
  const [subtractSamples, setSubtractSamples] = useState<ColorRangeSample[]>([]);
  const [preset, setPreset] = useState("sampled");
  const [invert, setInvert] = useState(false);
  const [preview, setPreview] = useState("selection");
  const [range, setRange] = useState(50); // tonal band half-width, %
  const [localized, setLocalized] = useState(false);
  const [clusterRange, setClusterRange] = useState(120); // px
  const [points, setPoints] = useState<[number, number][]>([]);
  const [selectionPreview, setSelectionPreview] = useState<SelectionPreviewMode>("none");
  const chosen = COLOR_RANGE_PRESETS.find((item) => item.value === preset);
  const tonal = chosen?.tonal;
  const isGamut = chosen?.gamut === true;
  const [thumbUrl] = useState(() => engine.engine ? engine.docThumbUrl(engine.e, 300, 180) : "");
  const [previewImage, setPreviewImage] = useState<ImageData | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const inp = { ...INP_BASE, width: 70 };

  useEffect(() => {
    if (!thumbUrl) return;
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (!live) return;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0);
      setPreviewImage(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.src = thumbUrl;
    return () => { live = false; };
  }, [thumbUrl]);

  const previewMask = useMemo(
    () => previewImage
      ? colorRangePreviewMask(previewImage.data, samples, subtractSamples, fuzziness, invert)
      : null,
    [previewImage, samples, subtractSamples, fuzziness, invert],
  );
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !previewImage) return;
    canvas.width = previewImage.width;
    canvas.height = previewImage.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (preview === "image" || !previewMask) {
      ctx.putImageData(previewImage, 0, 0);
      return;
    }
    const image = ctx.createImageData(previewImage.width, previewImage.height);
    for (let i = 0; i < previewMask.length; i++) {
      const value = previewMask[i];
      const p = i * 4;
      image.data[p] = value;
      image.data[p + 1] = value;
      image.data[p + 2] = value;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [preview, previewImage, previewMask]);

  // Photoshop previews on the document, not just in the dialog thumbnail. The
  // coverage is rebuilt from the composited pixels with the same pure helper the
  // thumbnail uses, so what the canvas shows is what OK will select.
  // ponytail: full-resolution pass per settings change, debounced — fine at
  // photo sizes; sample to a grid first if a 100MP document ever feels it.
  useEffect(() => {
    if (selectionPreview === "none" || !engine.engine) { store.setSelectionPreview(null, "none"); return; }
    const timer = setTimeout(() => {
      const pixels = engine.compositeBytes();
      if (!pixels) return;
      const mask = isGamut
        ? engine.outOfGamutMask()
        : tonal !== undefined
          ? tonalPreviewMask(pixels, tonal, range / 100, invert)
          : colorRangePreviewMask(pixels, samples, subtractSamples, fuzziness, invert);
      store.setSelectionPreview(mask, selectionPreview);
    }, 80);
    return () => clearTimeout(timer);
  }, [selectionPreview, isGamut, tonal, range, invert, samples, subtractSamples, fuzziness]);
  useEffect(() => () => store.setSelectionPreview(null, "none"), []);

  const addUnique = (list: ColorRangeSample[], color: ColorRangeSample) =>
    list.some((sample) => sameColorRangeSample(sample, color)) ? list : [...list, color];
  const chooseSample = (color: ColorRangeSample) => {
    setPreset("sampled");
    if (sampleMode === "replace") {
      setSamples([color]);
      setSubtractSamples([]);
    } else if (sampleMode === "add") {
      setSamples((current) => addUnique(current, color));
    } else {
      setSubtractSamples((current) => addUnique(current, color));
    }
  };
  const samplePreview = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    if (!previewImage || !engine.engine) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(engine.width - 1, Math.floor((clientX - rect.left) * engine.width / rect.width)));
    const y = Math.max(0, Math.min(engine.height - 1, Math.floor((clientY - rect.top) * engine.height / rect.height)));
    const color = engine.e.pick_color(x, y) >>> 0;
    // Localized Color Clusters needs where the sample came from, not just what
    // colour it was, so the point is recorded alongside it.
    setPoints((current) => (sampleMode === "replace" ? [[x, y]] : [...current, [x, y]]));
    chooseSample([(color >>> 24) & 255, (color >>> 16) & 255, (color >>> 8) & 255]);
  };
  const choosePreset = (value: string) => {
    setPreset(value);
    const cluster = COLOR_RANGE_PRESETS.find((item) => item.value === value)?.samples;
    if (cluster) {
      setSamples(cluster.map((sample) => [...sample] as ColorRangeSample));
      setSubtractSamples([]);
    }
  };
  const activeSample = samples.at(-1) ?? initialSample;

  return (
    <Dialog open onClose={close} title="Color Range" width={460}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => {
          if (isGamut) store.outOfGamutSelect({ mode: +mode, invert });
          else if (tonal !== undefined) store.tonalRangeSelect(tonal, range / 100, { mode: +mode, invert, allLayers: true });
          else store.colorRangeSelect({
            fuzziness, mode: +mode, samples, subtractSamples, invert, allLayers: true,
            points: localized ? points : undefined,
            clusterRange: localized ? clusterRange : 0,
          });
          close();
        }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 76 }}>Select</span>
        <Select value={preset} onChange={choosePreset}
          options={COLOR_RANGE_PRESETS.map(({ value, label }) => ({ value, label }))} />
      </div>
      <canvas ref={previewRef} role="img" aria-label="Color range image sample"
        onClick={(event) => samplePreview(event.currentTarget, event.clientX, event.clientY)}
        style={{
          display: "block", width: "100%", height: "auto", maxHeight: 180, cursor: "crosshair",
          background: "#000", border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", borderRadius: 4,
        }} />
      <div className="monet-row" style={{ gap: 8, marginTop: 10, marginBottom: 10, alignItems: "center" }}>
        <SegmentedControl value={sampleMode} onChange={(value) => setSampleMode(value as ColorRangeSampleMode)}
          items={[
            { value: "replace", label: "Sample" },
            { value: "add", label: "Add Sample" },
            { value: "subtract", label: "Subtract Sample" },
          ]} />
        <input type="color" aria-label="Sample color" value={colorRangeHex(activeSample)}
          onChange={(event) => {
            const hex = event.currentTarget.value;
            chooseSample([
              Number.parseInt(hex.slice(1, 3), 16),
              Number.parseInt(hex.slice(3, 5), 16),
              Number.parseInt(hex.slice(5, 7), 16),
            ]);
          }} />
      </div>
      <div className="monet-row" style={{ gap: 5, minHeight: 24, marginBottom: 10, flexWrap: "wrap" }}>
        {[...samples.map((color, index) => ({ color, index, subtract: false })),
          ...subtractSamples.map((color, index) => ({ color, index, subtract: true }))].map(({ color, index, subtract }) => (
          <button key={`${subtract ? "sub" : "add"}-${index}-${color.join("-")}`} type="button"
            aria-label={`Remove ${subtract ? "subtracted " : ""}sample ${colorRangeHex(color)}`}
            title={`Remove ${subtract ? "subtracted " : ""}${colorRangeHex(color)}`}
            disabled={!subtract && samples.length === 1}
            onClick={() => subtract
              ? setSubtractSamples((current) => current.filter((_, i) => i !== index))
              : setSamples((current) => current.filter((_, i) => i !== index))}
            style={{
              width: 24, height: 24, padding: 0, borderRadius: 4,
              cursor: !subtract && samples.length === 1 ? "default" : "pointer",
              background: colorRangeHex(color),
              border: subtract ? "2px solid #ff5d5d" : "2px solid var(--text-1)",
            }} />
        ))}
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        {tonal !== undefined ? (
          <>
            <span className="lbl" style={{ width: 76 }}>Range</span>
            <input type="number" value={range} aria-label="Range" min={1} max={100} style={inp}
              onChange={(event) => setRange(Math.max(1, Math.min(100, Number(event.currentTarget.value) || 1)))} />
          </>
        ) : isGamut ? (
          <span className="lbl" style={{ flex: 1, color: "var(--text-3)" }}>
            Selects what the current proof cannot reproduce.
          </span>
        ) : (
          <>
            <span className="lbl" style={{ width: 76 }}>Fuzziness</span>
            <input type="number" value={fuzziness} aria-label="Fuzziness" min={0} max={200} style={inp}
              onChange={(event) => setFuzz(Math.max(0, Math.min(200, Number(event.currentTarget.value) || 0)))} />
          </>
        )}
        <Checkbox id="mv-color-range-invert" checked={invert} onChange={setInvert}>Invert</Checkbox>
      </div>
      {tonal === undefined && !isGamut && (
        <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
          <Checkbox id="mv-color-range-localized" checked={localized} onChange={setLocalized}>Localized Color Clusters</Checkbox>
          {localized && (
            <>
              <span className="lbl" style={{ width: 46 }}>Range</span>
              <input type="number" value={clusterRange} aria-label="Cluster range" min={1} max={4000} style={inp}
                onChange={(event) => setClusterRange(Math.max(1, Math.min(4000, Number(event.currentTarget.value) || 1)))} />
            </>
          )}
        </div>
      )}
      <div style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 5 }}>Preview</div>
        <SegmentedControl value={preview} onChange={setPreview}
          items={[{ value: "image", label: "Image" }, { value: "selection", label: "Selection" }]} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <div className="lbl" style={{ marginBottom: 5 }}>Selection Preview</div>
        <Select value={selectionPreview} onChange={(v) => setSelectionPreview(v as SelectionPreviewMode)}
          options={SELECTION_PREVIEW_MODES.map(({ value, label }) => ({ value, label }))} />
      </div>
      <div>
        <div className="lbl" style={{ marginBottom: 5 }}>Combine With Selection</div>
        <SegmentedControl value={mode} onChange={setMode}
          items={[
            { value: "0", label: "Replace" },
            { value: "1", label: "Add" },
            { value: "2", label: "Subtract" },
            { value: "3", label: "Intersect" },
          ]} />
      </div>
    </Dialog>
  );
}
// Save/Load Selection's Operation, shared by both dialogs (the engine's SelMode
// order). Only same-size documents can trade channels, so the Document picker
// lists exactly those.
const SELECTION_OPS = [
  { value: "0", label: "Replace" }, { value: "1", label: "Add" },
  { value: "2", label: "Subtract" }, { value: "3", label: "Intersect" },
];
const NEW_CHANNEL = ""; // the Channel picker's "New" entry
function SaveSelection() {
  const { close } = useDialogs();
  const docs = store.selectionExchangeDocs();
  const [docId, setDocId] = useState(store.state.activeDocId);
  const [channel, setChannel] = useState(NEW_CHANNEL);
  const [name, setName] = useState("Selection 1");
  const [mode, setMode] = useState("0"); // 0 replace · 1 add · 2 subtract · 3 intersect
  const channels = store.savedSelectionNamesIn(docId);
  const target = channel || name.trim();
  const inp = { ...INP_BASE, flex: 1 };
  return (
    <Dialog open onClose={close} title="Save Selection" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!target}
          onClick={() => { if (target) store.saveSelection(target, channel ? +mode : 0, docId); close(); }}>OK</Button></>}>
      {docs.length > 1 && (
        <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
          <span className="lbl" style={{ width: 60 }}>Document</span>
          <Select value={String(docId)} aria-label="Destination document"
            onChange={(v) => { setDocId(+v); setChannel(NEW_CHANNEL); }}
            options={docs.map((d) => ({ value: String(d.id), label: d.name }))} />
        </div>
      )}
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Channel</span>
        <Select value={channel} onChange={setChannel} aria-label="Destination channel"
          options={[{ value: NEW_CHANNEL, label: "New" }, ...channels.map((n) => ({ value: n, label: n }))]} />
      </div>
      {channel ? (
        <>
          <div className="lbl" style={{ margin: "4px 0 6px" }}>Operation</div>
          <SegmentedControl value={mode} onChange={setMode} items={SELECTION_OPS} />
        </>
      ) : (
        <div className="monet-row" style={{ gap: 10 }}>
          <span className="lbl" style={{ width: 60 }}>Name</span>
          <input type="text" value={name} aria-label="Channel name" style={inp} onChange={(e) => setName(e.currentTarget.value)} />
        </div>
      )}
    </Dialog>
  );
}
function LoadSelection() {
  const { close } = useDialogs();
  const docs = store.selectionExchangeDocs();
  const [docId, setDocId] = useState(store.state.activeDocId);
  const names = store.savedSelectionNamesIn(docId);
  const [name, setName] = useState(names[0] ?? "");
  const [invert, setInvert] = useState(false);
  const [mode, setMode] = useState("0"); // 0 replace · 1 add · 2 subtract · 3 intersect
  return (
    <Dialog open onClose={close} title="Load Selection" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!name} onClick={() => { if (name) store.loadSelection(name, +mode, invert, docId); close(); }}>OK</Button></>}>
      {docs.length > 1 && (
        <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
          <span className="lbl" style={{ width: 60 }}>Document</span>
          <Select value={String(docId)} aria-label="Source document"
            onChange={(v) => { setDocId(+v); setName(store.savedSelectionNamesIn(+v)[0] ?? ""); }}
            options={docs.map((d) => ({ value: String(d.id), label: d.name }))} />
        </div>
      )}
      {names.length === 0 ? (
        <div style={{ color: "var(--text-3)", fontSize: 12 }}>No saved selections yet.</div>
      ) : (
        <>
          <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
            <span className="lbl" style={{ width: 60 }}>Channel</span>
            <Select value={name} onChange={setName} options={names.map((n) => ({ value: n, label: n }))} />
          </div>
          <Checkbox checked={invert} onChange={setInvert}>Invert</Checkbox>
          <div className="lbl" style={{ margin: "8px 0 6px" }}>Operation</div>
          <SegmentedControl value={mode} onChange={setMode} items={SELECTION_OPS} />
        </>
      )}
    </Dialog>
  );
}
function MatchColorDialog() {
  const layers = store.state.layers;
  const initial = layers.find((l) => l.id !== store.state.activeLayerId)?.id ?? store.state.activeLayerId;
  const [srcId, setSrcId] = useState(initial);
  const [lum, setLum] = useState(100);
  const [inten, setInten] = useState(100);
  const [fade, setFade] = useState(0);
  const [neutralize, setNeutralize] = useState(false);
  return (
    <PreviewDialog title="Match Color" width={420} deps={[srcId, lum, inten, fade, neutralize]}
      apply={() => adj.matchColor(srcId, lum / 100, inten / 100, fade / 100, neutralize)}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 96 }}>Source Layer</span>
        <Select value={String(srcId)} onChange={(v) => setSrcId(+v)}
          options={layers.map((l) => ({ value: String(l.id), label: l.name }))} />
      </div>
      <Row label="Luminance" value={lum} min={0} max={200} onChange={setLum} suffix="%" />
      <Row label="Color Intensity" value={inten} min={0} max={200} onChange={setInten} suffix="%" />
      <Row label="Fade" value={fade} min={0} max={100} onChange={setFade} suffix="%" />
      <div style={{ marginTop: 8 }}>
        <Checkbox checked={neutralize} onChange={setNeutralize}>Neutralize</Checkbox>
      </div>
    </PreviewDialog>
  );
}
function MatchFontDialog() {
  const { close } = useDialogs();
  const activeId = useStore((s) => s.activeLayerId);
  const spec = text.get(activeId);
  const activeRun = spec ? runAt(spec, 0) : null;
  const currentStyle = spec && activeRun ? text.resolveStyle(spec, activeRun) : null;
  const current = currentStyle?.font ?? text.FONTS[0];
  const matches = rankFontMatches(current, text.FONTS, currentStyle ?? undefined);
  const candidateFonts = matches.map((m) => m.font);
  const matched = candidateFonts.includes(current) ? current : matches[0]?.font ?? text.FONTS[0];
  const [font, setFont] = useState(matched);
  useEffect(() => setFont(matched), [matched]);
  const selectedMatch = matches.find((m) => m.font === font) ?? matches[0] ?? null;
  const apply = () => {
    if (!spec) return;
    // A font swap is a spec edit, not a named style — it must not link the layer.
    text.apply(activeId, { ...spec, font, runs: spec.runs.map((r) => ({ ...r, font })) });
    close();
  };
  return (
    <Dialog open onClose={close} title="Match Font" width={420}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!spec} onClick={apply}>OK</Button></>}>
      {!spec ? (
        <div style={{ color: "var(--text-3)", fontSize: 12 }}>Select an editable type layer.</div>
      ) : (
        <>
          <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 10 }}>
            <span className="lbl" style={{ width: 92 }}>Font</span>
            <Select block id="mv-match-font" aria-label="Matched font" value={font} onChange={setFont}
              options={matches.map((m) => ({ value: m.font, label: `${m.display} (${m.confidence}%)` }))} />
          </div>
          {selectedMatch && (
            <div data-mv-match-font-confidence className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 10, fontSize: 11 }}>
              <span className="lbl" style={{ width: 92 }}>Confidence</span>
              <span style={{ color: "var(--text-2)" }}>{selectedMatch.confidenceLabel} - {selectedMatch.confidence}%</span>
            </div>
          )}
          <div data-mv-match-font-preview style={{ fontFamily: font, fontSize: 32, lineHeight: 1.2, minHeight: 42, padding: "8px 0" }}>
            {text.fullText(spec) || "Sample"}
          </div>
        </>
      )}
    </Dialog>
  );
}
// Layer Style ▸ Contour Editor — Photoshop's curve authoring for every contour
// slot, plus the named library the slots and the Preset Manager pick from. The
// curve itself is monet-react's CurveEditor; this owns the library around it.
function ContourEditor() {
  const { close } = useDialogs();
  const library = useStore((s) => s.contours);
  const [draft, setDraft] = useState<CustomContour[]>(() => library.map((c) => ({ ...c, points: [...c.points] })));
  const [at, setAt] = useState(0);
  const current = draft[at];
  const setPoints = (points: ContourPoint[]) =>
    setDraft((d) => d.map((c, i) => (i === at ? { ...c, points } : c)));
  return (
    <Dialog open onClose={close} title="Contour Editor" width={460}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { store.setContours(draft); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 8, marginBottom: 10 }}>
        <Select value={String(at)} onChange={(v) => setAt(+v)} aria-label="Contour"
          options={draft.length
            ? draft.map((c, i) => ({ value: String(i), label: c.name }))
            : [{ value: "0", label: "No custom contours" }]} />
        <Button size="sm" variant="ghost" onClick={() => {
          // Photoshop's New starts from Linear and lands at the end of the list.
          setDraft((d) => [...d, newContour(`Contour ${d.length + 1}`)]);
          setAt(draft.length);
        }}>New</Button>
        <Button size="sm" variant="ghost" disabled={!current} onClick={() => {
          setDraft((d) => d.filter((_, i) => i !== at));
          setAt((i) => Math.max(0, i - 1));
        }}>Delete</Button>
      </div>
      {current ? (
        <>
          <div className="monet-row" style={{ gap: 8, marginBottom: 10 }}>
            <span className="lbl" style={{ width: 56 }}>Name</span>
            <Input value={current.name} aria-label="Contour name"
              onChange={(e) => { const v = e.currentTarget.value; setDraft((d) => d.map((c, i) => (i === at ? { ...c, name: v } : c))); }} />
          </div>
          <CurveEditor
            aria-label="Contour curve"
            points={current.points.map((p, i) => ({ id: `cp-${i}`, x: p.x, y: p.y }))}
            onChange={(pts: { x: number; y: number }[]) => setPoints(pts.map(({ x, y }) => ({ x, y })))}
            width={420}
            height={180}
          />
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
            Drag a point to shape the contour, click the curve to add one, double-click a point to remove it.
          </div>
        </>
      ) : (
        <div style={{ color: "var(--text-3)", fontSize: 12 }}>
          Add a contour to shape how an effect&apos;s coverage falls off.
        </div>
      )}
    </Dialog>
  );
}

// Layer ▸ Lock Layers… (⌘/) — Photoshop's four checkboxes for the whole
// selection. Lock All is separate from the three attribute locks in the engine,
// so ticking it here leaves them as they were, exactly as Photoshop does.
function LockLayers() {
  const { close } = useDialogs();
  const ids = store.state.selectedLayerIds.length ? store.state.selectedLayerIds : [store.state.activeLayerId];
  const first = ids[0];
  const [flags, setFlags] = useState(() => store.layerLocks(first));
  const [all, setAll] = useState(() => store.state.layers.find((l) => l.id === first)?.locked ?? false);
  const bit = (b: number) => (flags & b) !== 0;
  const toggle = (b: number) => setFlags((f) => f ^ b);
  return (
    <Dialog open onClose={close} title="Lock Layers" width={320}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => {
          for (const id of ids) {
            store.setLayerLocks(id, flags);
            store.setLayerLocked(id, all);
          }
          close();
        }}>OK</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Checkbox checked={bit(1)} onChange={() => toggle(1)}>Transparent Pixels</Checkbox>
        <Checkbox checked={bit(2)} onChange={() => toggle(2)}>Image Pixels</Checkbox>
        <Checkbox checked={bit(4)} onChange={() => toggle(4)}>Position</Checkbox>
        <Checkbox checked={all} onChange={setAll}>All</Checkbox>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
          Applies to {ids.length} selected layer{ids.length === 1 ? "" : "s"}.
        </div>
      </div>
    </Dialog>
  );
}
function ApplyImage() {
  const { close } = useDialogs();
  const others = store.state.layers.filter((l) => l.id !== store.state.activeLayerId);
  const [srcId, setSrcId] = useState(others[0]?.id ?? 0);
  const [blend, setBlend] = useState("normal");
  const [opacity, setOpacity] = useState(100);
  const [invert, setInvert] = useState(false);
  // Photoshop's Channel picker: RGB by default, or one channel as grey.
  const [channel, setChannel] = useState("255");
  const channelOpts = [{ value: "255", label: "RGB" }, ...channelOptionsFor(store.savedSelectionNames())];
  return (
    <Dialog open onClose={close} title="Apply Image" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={others.length === 0} onClick={() => { store.applyImage(srcId, blend, opacity, invert, +channel); close(); }}>OK</Button></>}>
      {others.length === 0 ? (
        <div style={{ color: "var(--text-3)", fontSize: 12 }}>Add another layer to use as the source.</div>
      ) : (
        <>
          <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
            <span className="lbl" style={{ width: 70 }}>Source</span>
            <Select value={String(srcId)} onChange={(v) => setSrcId(+v)} options={others.map((l) => ({ value: String(l.id), label: l.name }))} />
          </div>
          <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
            <span className="lbl" style={{ width: 70 }}>Channel</span>
            <Select value={channel} onChange={setChannel} options={channelOpts} aria-label="Source channel" />
          </div>
          <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
            <span className="lbl" style={{ width: 70 }}>Blending</span>
            <Select value={blend} onChange={setBlend} options={BLEND_ORDER.map((b) => ({ value: b, label: b }))} />
          </div>
          <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
            <span className="lbl" style={{ width: 70 }}>Opacity</span>
            <NumberField value={opacity} min={0} max={100} onChange={setOpacity} suffix="%" />
          </div>
          <Checkbox checked={invert} onChange={setInvert}>Invert</Checkbox>
        </>
      )}
    </Dialog>
  );
}
/** The channel vocabulary both Apply Image and Calculations offer, matching the
 *  engine's codes: 0 Gray · 1 R · 2 G · 3 B · 4 Transparency · 5+ the saved
 *  alpha channel at that index, in `savedSelectionNames()` order. */
function channelOptionsFor(saved: readonly string[]): { value: string; label: string }[] {
  return [
    { value: "0", label: "Gray" },
    { value: "1", label: "Red" },
    { value: "2", label: "Green" },
    { value: "3", label: "Blue" },
    { value: "4", label: "Transparency" },
    ...saved.map((name, i) => ({ value: String(i + 5), label: name })),
  ];
}

function Calculations() {
  const { close } = useDialogs();
  const layers = store.state.layers;
  const CHAN = channelOptionsFor(store.savedSelectionNames());
  const [s1, setS1] = useState(layers[0]?.id ?? 0);
  const [ch1, setCh1] = useState("0");
  const [inv1, setInv1] = useState(false);
  const [s2, setS2] = useState((layers[1] ?? layers[0])?.id ?? 0);
  const [ch2, setCh2] = useState("0");
  const [inv2, setInv2] = useState(false);
  const [blend, setBlend] = useState("multiply");
  const [opacity, setOpacity] = useState(100);
  // Result: Photoshop's three. New Channel is the blend plus Save Selection —
  // an alpha channel is exactly that here. New Document reads the blend back
  // through `calculations_mask` and opens it as its own grayscale document, so
  // it never disturbs the live selection.
  const [result, setResult] = useState("selection");
  const saved = store.savedSelectionNames();
  const nextAlphaName = (() => {
    let name = "Alpha";
    for (let i = 2; saved.includes(name); i++) name = `Alpha ${i}`;
    return name;
  })();
  const [chanName, setChanName] = useState(nextAlphaName);
  const apply = () => {
    if (result === "document") {
      // Pure readback — the live selection and history are left alone.
      store.calculationsToDocument(s1, +ch1, inv1, s2, +ch2, inv2, blend, opacity);
      close();
      return;
    }
    store.calculations(s1, +ch1, inv1, s2, +ch2, inv2, blend, opacity);
    // ponytail: Photoshop's New Channel result leaves the selection alone; here the
    // blend lands in the selection first, so the selection is replaced too. An
    // engine `calculations_to_channel` would separate them.
    if (result === "channel") store.saveSelection(chanName.trim() || nextAlphaName);
    close();
  };
  const layerOpts = layers.map((l) => ({ value: String(l.id), label: l.name }));
  const sourceRow = (label: string, s: number, setS: (n: number) => void, ch: string, setCh: (v: string) => void, inv: boolean, setInv: (b: boolean) => void) => (
    <div style={{ marginBottom: 10 }}>
      <div className="lbl" style={{ marginBottom: 4 }}>{label}</div>
      <div className="monet-row" style={{ gap: 8, marginBottom: 4 }}>
        <Select value={String(s)} onChange={(v) => setS(+v)} options={layerOpts} />
        <Select value={ch} onChange={setCh} options={CHAN} />
      </div>
      <Checkbox checked={inv} onChange={setInv}>Invert</Checkbox>
    </div>
  );
  return (
    <Dialog open onClose={close} title="Calculations" width={380}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={layers.length === 0} onClick={apply}>OK</Button></>}>
      {sourceRow("Source 1", s1, setS1, ch1, setCh1, inv1, setInv1)}
      {sourceRow("Source 2", s2, setS2, ch2, setCh2, inv2, setInv2)}
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Blending</span>
        <Select value={blend} onChange={setBlend} options={BLEND_ORDER.map((b) => ({ value: b, label: b }))} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Opacity</span>
        <NumberField value={opacity} min={0} max={100} onChange={setOpacity} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Result</span>
        <Select value={result} onChange={setResult}
          options={[{ value: "channel", label: "New Channel" }, { value: "document", label: "New Document" }, { value: "selection", label: "Selection" }]} />
      </div>
      {result === "channel" && (
        <div className="monet-row" style={{ gap: 10, marginTop: 8 }}>
          <label className="lbl" htmlFor="mv-calc-channel" style={{ width: 70 }}>Channel</label>
          <Input block id="mv-calc-channel" aria-label="New channel name" value={chanName}
            onChange={(event) => setChanName(event.currentTarget.value)} placeholder={nextAlphaName} />
        </div>
      )}
    </Dialog>
  );
}
function Defringe() {
  const { close } = useDialogs();
  const [width, setWidth] = useState(1);
  return (
    <Dialog open onClose={close} title="Defringe" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { store.defringe(width); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Width</span>
        <NumberField value={width} min={1} max={64} onChange={setWidth} suffix="px" />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Replaces edge pixels with nearby interior colors.</div>
    </Dialog>
  );
}
function StrokeSelection() {
  const [w, setW] = useState(3);
  const [loc, setLoc] = useState("1"); // 0 inside · 1 center · 2 outside
  return (
    <PreviewDialog title="Stroke" width={340} deps={[w, loc]}
      apply={() => store.strokeSelection(w, +loc)}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Width</span>
        <NumberField value={w} min={1} max={250} onChange={setW} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Location</span>
        <SegmentedControl value={loc} onChange={setLoc}
          items={[{ value: "0", label: "Inside" }, { value: "1", label: "Center" }, { value: "2", label: "Outside" }]} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Strokes with the foreground color.</div>
    </PreviewDialog>
  );
}
function NewGuide() {
  const { close } = useDialogs();
  const doc = useStore((s) => s.doc);
  const resolutionPpi = useStore((s) => s.resolutionPpi);
  const docW = doc.width, docH = doc.height;
  const [o, setO] = useState<GuideOrientation>("h");
  const [pos, setPos] = useState(() => `${defaultGuidePos("h", docW, docH)} px`);
  const [color, setColor] = useState(DEFAULT_GUIDE_COLOR);
  const positionPx = parseGuidePosition(pos, o, docW, docH, resolutionPpi);
  // Switching orientation re-defaults the position to that axis's centre (PS opens
  // the field at a sensible value per orientation).
  const pickOrientation = (next: string) => { const g = next as GuideOrientation; setO(g); setPos(`${defaultGuidePos(g, docW, docH)} px`); };
  return (
    <Dialog open onClose={close} title="New Guide" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={positionPx === null} onClick={() => { if (positionPx !== null) { store.addGuide(o, clampGuidePos(o, positionPx, docW, docH), color); close(); } }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Orientation</span>
        <SegmentedControl value={o} onChange={pickOrientation}
          items={[{ value: "h", label: "Horizontal" }, { value: "v", label: "Vertical" }]} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Position</span>
        <Input id="mv-newguide-pos" aria-label="Position" aria-describedby="mv-newguide-pos-help"
          value={pos} onChange={(event) => setPos(event.currentTarget.value)} invalid={positionPx === null} block />
      </div>
      <div id="mv-newguide-pos-help" role={positionPx === null ? "alert" : undefined}
        style={{ color: positionPx === null ? "var(--danger, #ff6b6b)" : "var(--text-3)", fontSize: 11, margin: "4px 0 0 80px" }}>
        Enter px, %, in, cm, mm, pt, or pc.
      </div>
      <div className="monet-row" style={{ gap: 10, marginTop: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Color</span>
        <input type="color" id="mv-newguide-color" aria-label="Guide color" value={color}
          onChange={(e) => setColor(e.currentTarget.value)} />
      </div>
    </Dialog>
  );
}
function NewGuideLayout() {
  const { close } = useDialogs();
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [color, setColor] = useState(DEFAULT_GUIDE_COLOR);
  const [clearExisting, setClearExisting] = useState(false);
  const apply = () => {
    const w = store.state.doc.width, h = store.state.doc.height;
    const guides: Guide[] = [];
    for (let i = 1; i < cols; i++) guides.push({ o: "v", p: Math.round((w * i) / cols), color });
    for (let i = 1; i < rows; i++) guides.push({ o: "h", p: Math.round((h * i) / rows), color });
    store.setGuides(clearExisting ? guides : [...store.state.guides, ...guides]);
    store.setOptions({ showGuides: true });
    close();
  };
  return (
    <Dialog open onClose={close} title="New Guide Layout" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={apply}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Columns</span>
        <NumberField id="mv-guide-layout-cols" aria-label="Columns" value={cols} min={1} max={50} onChange={setCols} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 70 }}>Rows</span>
        <NumberField id="mv-guide-layout-rows" aria-label="Rows" value={rows} min={1} max={50} onChange={setRows} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginTop: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Color</span>
        <input type="color" id="mv-guide-layout-color" aria-label="Guide layout color" value={color}
          onChange={(e) => setColor(e.currentTarget.value)} />
      </div>
      <Checkbox id="mv-guide-layout-clear" checked={clearExisting} onChange={setClearExisting}>Clear Existing Guides</Checkbox>
    </Dialog>
  );
}
function FitImage() {
  const { close } = useDialogs();
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1920);
  const apply = () => {
    xform.fitImage(w, h);
    close();
  };
  return (
    <Dialog open onClose={close} title="Fit Image" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={apply}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Fit Width</span>
        <NumberField value={w} min={1} max={30000} onChange={setW} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 70 }}>Fit Height</span>
        <NumberField value={h} min={1} max={30000} onChange={setH} suffix="px" />
      </div>
      <div className="lbl" style={{ marginTop: 8, color: "var(--text-3)", fontSize: 11 }}>Scales the image to fit within these dimensions (aspect preserved).</div>
    </Dialog>
  );
}
function ContentAwareScale() {
  const { close } = useDialogs();
  const [w, setW] = useState(store.state.doc.width);
  const [h, setH] = useState(store.state.doc.height);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const runningRef = useRef(false);
  const abortRef = useRef(false);
  const totalRef = useRef(0);
  const closeRef = useRef(close);
  closeRef.current = close;

  const requestClose = () => {
    abortRef.current = true;
    if (runningRef.current) {
      store.cancelContentAwareScale();
      runningRef.current = false;
    }
    closeRef.current();
  };

  const start = () => {
    if (runningRef.current) return;
    abortRef.current = false;
    const total = store.beginContentAwareScale(Math.round(w), Math.round(h));
    if (total <= 0) {
      engine.consumeEditError();
      closeRef.current();
      return;
    }
    totalRef.current = total;
    runningRef.current = true;
    setProgress({ done: 0, total });
    setRunning(true);
  };

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const tick = () => {
      if (abortRef.current || !runningRef.current) return;
      const left = store.stepContentAwareScale(1);
      const total = totalRef.current;
      setProgress({ done: Math.max(0, total - left), total });
      if (left <= 0) {
        runningRef.current = false;
        setRunning(false);
        store.finishContentAwareScale();
        closeRef.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (runningRef.current) {
        store.cancelContentAwareScale();
        runningRef.current = false;
      }
    };
  }, [running]);

  return (
    <Dialog open onClose={requestClose} title="Content-Aware Scale" width={360}
      footer={<><Button variant="ghost" onClick={requestClose}>Cancel</Button>
        <Button variant="primary" disabled={running} onClick={start}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 56 }}>Width</span>
        <NumberField value={w} min={1} max={store.state.doc.width} disabled={running} onChange={setW} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 56 }}>Height</span>
        <NumberField value={h} min={1} max={store.state.doc.height} disabled={running} onChange={setH} suffix="px" />
      </div>
      <div className="lbl" style={{ marginTop: 8, color: "var(--text-3)", fontSize: 11 }}>
        {running && progress ? `${progress.done} of ${progress.total}` : "Seam-carves to a smaller size, preserving busy regions. Esc cancels."}
      </div>
    </Dialog>
  );
}
function Trim() {
  const { close } = useDialogs();
  const [basedOn, setBasedOn] = useState("1"); // 0 transparent · 1 top-left · 2 bottom-right
  const [top, setTop] = useState(true);
  const [bottom, setBottom] = useState(true);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  return (
    <Dialog open onClose={close} title="Trim" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { xform.trim(+basedOn, top, bottom, left, right); close(); }}>OK</Button></>}>
      <div className="lbl" style={{ marginBottom: 6 }}>Based On</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        <SegmentedControl value={basedOn} onChange={setBasedOn}
          items={[{ value: "0", label: "Transparent" }, { value: "1", label: "Top Left" }, { value: "2", label: "Bottom Right" }]} />
      </div>
      <div className="lbl" style={{ marginBottom: 6 }}>Trim Away</div>
      <div className="monet-row" style={{ gap: 16 }}>
        <Checkbox checked={top} onChange={setTop}>Top</Checkbox>
        <Checkbox checked={bottom} onChange={setBottom}>Bottom</Checkbox>
        <Checkbox checked={left} onChange={setLeft}>Left</Checkbox>
        <Checkbox checked={right} onChange={setRight}>Right</Checkbox>
      </div>
    </Dialog>
  );
}
function Offset() {
  const { close } = useDialogs();
  const [dx, setDx] = useState(10);
  const [dy, setDy] = useState(10);
  const [edge, setEdge] = useState("0"); // 0 wrap · 1 repeat · 2 background
  return (
    <Dialog open onClose={close} title="Offset" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.offset(Math.round(dx), Math.round(dy), +edge); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 80 }}>Horizontal</span>
        <NumberField value={dx} min={-8192} max={8192} onChange={setDx} suffix="px right" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 12 }}>
        <span className="lbl" style={{ width: 80 }}>Vertical</span>
        <NumberField value={dy} min={-8192} max={8192} onChange={setDy} suffix="px down" />
      </div>
      <div className="lbl" style={{ marginBottom: 6 }}>Undefined Areas</div>
      <SegmentedControl value={edge} onChange={setEdge}
        items={[{ value: "0", label: "Wrap Around" }, { value: "1", label: "Repeat Edge" }, { value: "2", label: "Background" }]} />
    </Dialog>
  );
}
function RotateCanvas() {
  const { close } = useDialogs();
  const [angle, setAngle] = useState(0);
  const [dir, setDir] = useState("cw"); // cw · ccw
  return (
    <Dialog open onClose={close} title="Rotate Canvas" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { xform.rotateArbitrary(dir === "cw" ? angle : -angle); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 12 }}>
        <span className="lbl" style={{ width: 56 }}>Angle</span>
        <NumberField value={angle} min={-359.99} max={359.99} onChange={setAngle} suffix="°" />
      </div>
      <SegmentedControl value={dir} onChange={setDir}
        items={[{ value: "cw", label: "°CW" }, { value: "ccw", label: "°CCW" }]} />
    </Dialog>
  );
}
function MaxMin({ kind }: { kind: "max" | "min" }) {
  const { close } = useDialogs();
  const [r, setR] = useState(3);
  const [preserve, setPreserve] = useState("0"); // 0 squareness · 1 roundness
  return (
    <Dialog open onClose={close} title={kind === "max" ? "Maximum" : "Minimum"} width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { (kind === "max" ? fil.maximum : fil.minimum)(Math.round(r), preserve === "1"); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 12 }}>
        <span className="lbl" style={{ width: 56 }}>Radius</span>
        <NumberField value={r} min={1} max={250} onChange={setR} suffix="px" />
      </div>
      <div className="lbl" style={{ marginBottom: 6 }}>Preserve</div>
      <SegmentedControl value={preserve} onChange={setPreserve}
        items={[{ value: "0", label: "Squareness" }, { value: "1", label: "Roundness" }]} />
    </Dialog>
  );
}
function GlowingEdges() {
  const { close } = useDialogs();
  const [width, setWidth] = useState(2);
  const [brightness, setBrightness] = useState(6);
  return (
    <Dialog open onClose={close} title="Glowing Edges" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.glowingEdges(Math.round(width), brightness); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 96 }}>Edge Width</span>
        <NumberField value={width} min={1} max={14} onChange={setWidth} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 96 }}>Edge Brightness</span>
        <NumberField value={brightness} min={1} max={20} onChange={setBrightness} />
      </div>
    </Dialog>
  );
}
function TraceContour() {
  const { close } = useDialogs();
  const [level, setLevel] = useState(128);
  const [edge, setEdge] = useState("1"); // 0 lower · 1 upper
  const inp = { ...INP_BASE, width: 70 };
  return (
    <Dialog open onClose={close} title="Trace Contour" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.traceContour(Math.max(0, Math.min(255, Math.round(level))), edge === "1"); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Level</span>
        <input type="number" value={level} aria-label="Level" min={0} max={255} style={inp} onChange={(e) => setLevel(Number(e.currentTarget.value) || 0)} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Edge</span>
        <SegmentedControl value={edge} onChange={setEdge}
          items={[{ value: "0", label: "Lower" }, { value: "1", label: "Upper" }]} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Outlines where each channel crosses the level.</div>
    </Dialog>
  );
}
function Wind() {
  const { close } = useDialogs();
  const [method, setMethod] = useState("0"); // 0 wind · 1 blast · 2 stagger
  const [dir, setDir] = useState("0"); // 0 from left · 1 from right
  return (
    <Dialog open onClose={close} title="Wind" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.wind(+method, dir === "0"); close(); }}>OK</Button></>}>
      <div className="lbl" style={{ margin: "2px 0 6px" }}>Method</div>
      <SegmentedControl value={method} onChange={setMethod}
        items={[{ value: "0", label: "Wind" }, { value: "1", label: "Blast" }, { value: "2", label: "Stagger" }]} />
      <div className="lbl" style={{ margin: "10px 0 6px" }}>Direction</div>
      <SegmentedControl value={dir} onChange={setDir}
        items={[{ value: "0", label: "From the Left" }, { value: "1", label: "From the Right" }]} />
    </Dialog>
  );
}
function Photocopy() {
  const { close } = useDialogs();
  const [detail, setDetail] = useState(2);
  const [darkness, setDarkness] = useState(8);
  return (
    <Dialog open onClose={close} title="Photocopy" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.photocopy(Math.round(detail), darkness); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Detail</span>
        <NumberField value={detail} min={1} max={24} onChange={setDetail} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Darkness</span>
        <NumberField value={darkness} min={1} max={50} onChange={setDarkness} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Uses the foreground and background colors.</div>
    </Dialog>
  );
}
function Stamp() {
  const { close } = useDialogs();
  const [balance, setBalance] = useState(25);
  const [smoothness, setSmoothness] = useState(5);
  return (
    <Dialog open onClose={close} title="Stamp" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.stamp(balance / 50, smoothness / 50); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Light/Dark Balance</span>
        <NumberField value={balance} min={1} max={50} onChange={setBalance} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Smoothness</span>
        <NumberField value={smoothness} min={1} max={50} onChange={setSmoothness} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Uses the foreground and background colors.</div>
    </Dialog>
  );
}
function NotePaper() {
  const { close } = useDialogs();
  const [imageBalance, setImageBalance] = useState(25);
  const [graininess, setGraininess] = useState(10);
  const [relief, setRelief] = useState(11);
  return (
    <Dialog open onClose={close} title="Note Paper" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.notePaper(imageBalance / 50, graininess / 20, relief / 25); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Image Balance</span>
        <NumberField value={imageBalance} min={0} max={50} onChange={setImageBalance} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Graininess</span>
        <NumberField value={graininess} min={0} max={20} onChange={setGraininess} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Relief</span>
        <NumberField value={relief} min={0} max={25} onChange={setRelief} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Uses the foreground and background colors.</div>
    </Dialog>
  );
}
function TornEdges() {
  const { close } = useDialogs();
  const [imageBalance, setImageBalance] = useState(25);
  const [smoothness, setSmoothness] = useState(8);
  const [contrast, setContrast] = useState(25);
  return (
    <Dialog open onClose={close} title="Torn Edges" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.tornEdges(imageBalance / 50, smoothness / 15, contrast / 50); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Image Balance</span>
        <NumberField value={imageBalance} min={0} max={50} onChange={setImageBalance} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Smoothness</span>
        <NumberField value={smoothness} min={1} max={15} onChange={setSmoothness} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Contrast</span>
        <NumberField value={contrast} min={0} max={50} onChange={setContrast} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Uses the foreground and background colors.</div>
    </Dialog>
  );
}
function WaterPaper() {
  const { close } = useDialogs();
  const [fiberLength, setFiberLength] = useState(15);
  const [brightness, setBrightness] = useState(50);
  const [contrast, setContrast] = useState(50);
  return (
    <Dialog open onClose={close} title="Water Paper" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.waterPaper(fiberLength / 50, brightness / 100, contrast / 100); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Fiber Length</span>
        <NumberField value={fiberLength} min={1} max={50} onChange={setFiberLength} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Brightness</span>
        <NumberField value={brightness} min={0} max={100} onChange={setBrightness} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Contrast</span>
        <NumberField value={contrast} min={0} max={100} onChange={setContrast} />
      </div>
    </Dialog>
  );
}
function ChalkCharcoal() {
  const { close } = useDialogs();
  const [charcoalArea, setCharcoalArea] = useState(6);
  const [chalkArea, setChalkArea] = useState(6);
  const [strokePressure, setStrokePressure] = useState(5);
  return (
    <Dialog open onClose={close} title="Chalk & Charcoal" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.chalkCharcoal(charcoalArea / 20, chalkArea / 20, strokePressure / 5); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Charcoal Area</span>
        <NumberField value={charcoalArea} min={0} max={20} onChange={setCharcoalArea} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Chalk Area</span>
        <NumberField value={chalkArea} min={0} max={20} onChange={setChalkArea} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Stroke Pressure</span>
        <NumberField value={strokePressure} min={0} max={5} onChange={setStrokePressure} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Foreground draws the charcoal (shadows); background draws the chalk (highlights); midtones flatten to a solid gray.</div>
    </Dialog>
  );
}
function ConteCrayon() {
  const { close } = useDialogs();
  const [foregroundLevel, setForegroundLevel] = useState(11);
  const [backgroundLevel, setBackgroundLevel] = useState(7);
  const [texture, setTexture] = useState(0);
  const [scaling, setScaling] = useState(100);
  const [relief, setRelief] = useState(10);
  const [light, setLight] = useState(0);
  const textures = ["Canvas", "Sandstone", "Brick", "Burlap"].map((l, i) => ({ value: String(i), label: l }));
  const lights = ["Top", "Top Left", "Left", "Bottom Left", "Bottom", "Bottom Right", "Right", "Top Right"].map((l, i) => ({ value: String(i), label: l }));
  return (
    <Dialog open onClose={close} title="Conté Crayon" width={380}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.conteCrayon(foregroundLevel / 20, backgroundLevel / 20, texture, (scaling - 50) / 150, relief / 50, light); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Foreground Level</span>
        <NumberField value={foregroundLevel} min={0} max={20} onChange={setForegroundLevel} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Background Level</span>
        <NumberField value={backgroundLevel} min={0} max={20} onChange={setBackgroundLevel} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 120 }}>Texture</span>
        <Select value={String(texture)} onChange={(v) => setTexture(+v)} options={textures} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Scaling</span>
        <NumberField value={scaling} min={50} max={200} onChange={setScaling} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Relief</span>
        <NumberField value={relief} min={0} max={50} onChange={setRelief} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 120 }}>Light</span>
        <Select value={String(light)} onChange={(v) => setLight(+v)} options={lights} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Uses the foreground and background colors.</div>
    </Dialog>
  );
}
function Reticulation() {
  const { close } = useDialogs();
  const [density, setDensity] = useState(25);
  const [foregroundLevel, setForegroundLevel] = useState(25);
  const [backgroundLevel, setBackgroundLevel] = useState(25);
  return (
    <Dialog open onClose={close} title="Reticulation" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.reticulation(density / 50, foregroundLevel / 50, backgroundLevel / 50); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Density</span>
        <NumberField value={density} min={0} max={50} onChange={setDensity} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Foreground Level</span>
        <NumberField value={foregroundLevel} min={0} max={50} onChange={setForegroundLevel} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Background Level</span>
        <NumberField value={backgroundLevel} min={0} max={50} onChange={setBackgroundLevel} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Uses the foreground and background colors.</div>
    </Dialog>
  );
}
function Plaster() {
  const { close } = useDialogs();
  const [imageBalance, setImageBalance] = useState(25);
  const [smoothness, setSmoothness] = useState(8);
  const [light, setLight] = useState(0);
  const lights = ["Top", "Top Left", "Left", "Bottom Left", "Bottom", "Bottom Right", "Right", "Top Right"].map((l, i) => ({ value: String(i), label: l }));
  return (
    <Dialog open onClose={close} title="Plaster" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.plaster(imageBalance / 50, smoothness / 15, light); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Image Balance</span>
        <NumberField value={imageBalance} min={0} max={50} onChange={setImageBalance} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Smoothness</span>
        <NumberField value={smoothness} min={1} max={15} onChange={setSmoothness} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 120 }}>Light Direction</span>
        <Select value={String(light)} onChange={(v) => setLight(+v)} options={lights} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Uses the foreground and background colors.</div>
    </Dialog>
  );
}
function Fibers() {
  const { close } = useDialogs();
  const [variance, setVariance] = useState(16);
  const [strength, setStrength] = useState(4);
  return (
    <Dialog open onClose={close} title="Fibers" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.fibers(variance, strength); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Variance</span>
        <NumberField value={variance} min={1} max={64} onChange={setVariance} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Strength</span>
        <NumberField value={strength} min={1} max={64} onChange={setStrength} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Weaves the foreground and background colors.</div>
    </Dialog>
  );
}
function LightingEffects() {
  const [x, setX] = useState(DEFAULT_LIGHTING.x);
  const [y, setY] = useState(DEFAULT_LIGHTING.y);
  const [height, setHeight] = useState(DEFAULT_LIGHTING.height);
  const [intensity, setIntensity] = useState(DEFAULT_LIGHTING.intensity);
  const [ambient, setAmbient] = useState(DEFAULT_LIGHTING.ambient);
  const [bump, setBump] = useState(DEFAULT_LIGHTING.bump);
  const [color, setColor] = useState("#ffffff");
  const [lightType, setLightType] = useState(DEFAULT_LIGHTING.lightType);
  return (
    <PreviewDialog title="Lighting Effects" width={360} deps={[x, y, height, intensity, ambient, bump, color, lightType]}
      apply={() => { const [r, g, b] = hexToRgb(color); fil.lightingEffects({ x, y, height, intensity, ambient, bump, color: { r, g, b }, lightType }); }}>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 10 }}>A light over a relief surface built from the layer&apos;s own luminance.</div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 70 }}>Light Type</span>
        <Select value={String(lightType)} onChange={(v) => setLightType(+v)}
          options={LIGHT_TYPES.map((l, i) => ({ value: String(i), label: l }))} />
      </div>
      <Row label="Light X" value={x} min={0} max={100} decimals={0} suffix="%" onChange={setX} />
      <Row label="Light Y" value={y} min={0} max={100} decimals={0} suffix="%" onChange={setY} />
      <Row label="Height" value={height} min={1} max={200} decimals={0} suffix="%" onChange={setHeight} />
      <Row label="Intensity" value={intensity} min={0} max={3} decimals={2} onChange={setIntensity} />
      <Row label="Ambient" value={ambient} min={0} max={1} decimals={2} onChange={setAmbient} />
      <Row label="Texture" value={bump} min={0} max={4} decimals={1} onChange={setBump} />
      <div className="monet-row" style={{ gap: 10, marginTop: 6 }}>
        <span className="lbl" style={{ width: 70 }}>Light Color</span>
        <input type="color" id="mv-lighting-color" value={color} aria-label="Light color" onChange={(e) => setColor(e.currentTarget.value)} />
      </div>
    </PreviewDialog>
  );
}
function OceanRipple() {
  const { close } = useDialogs();
  const [size, setSize] = useState(9);
  const [magnitude, setMagnitude] = useState(10);
  return (
    <Dialog open onClose={close} title="Ocean Ripple" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { distort.oceanRipple(size / 15, magnitude / 20); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Ripple Size</span>
        <NumberField value={size} min={1} max={15} onChange={setSize} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Ripple Magnitude</span>
        <NumberField value={magnitude} min={0} max={20} onChange={setMagnitude} />
      </div>
    </Dialog>
  );
}
function Glass() {
  const { close } = useDialogs();
  const [texture, setTexture] = useState(0);
  const [distortion, setDistortion] = useState(10);
  const [smoothness, setSmoothness] = useState(3);
  const [scaling, setScaling] = useState(100);
  const textures = ["Frosted", "Blocks", "Canvas"].map((l, i) => ({ value: String(i), label: l }));
  return (
    <Dialog open onClose={close} title="Glass" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { distort.glass(texture, distortion / 20, smoothness / 15, (scaling - 50) / 150); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 90 }}>Texture</span>
        <Select value={String(texture)} onChange={(v) => setTexture(+v)} options={textures} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Distortion</span>
        <NumberField value={distortion} min={0} max={20} onChange={setDistortion} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Smoothness</span>
        <NumberField value={smoothness} min={1} max={15} onChange={setSmoothness} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Scaling</span>
        <NumberField value={scaling} min={50} max={200} onChange={setScaling} suffix="%" />
      </div>
    </Dialog>
  );
}
function Charcoal() {
  const { close } = useDialogs();
  const [thickness, setThickness] = useState(1);
  const [detail, setDetail] = useState(5);
  const [balance, setBalance] = useState(50);
  return (
    <Dialog open onClose={close} title="Charcoal" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.charcoal(thickness, detail, balance / 100); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 130 }}>Charcoal Thickness</span>
        <NumberField value={thickness} min={1} max={7} onChange={setThickness} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 130 }}>Detail</span>
        <NumberField value={detail} min={0} max={5} onChange={setDetail} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 130 }}>Light/Dark Balance</span>
        <NumberField value={balance} min={0} max={100} onChange={setBalance} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Uses the foreground and background colors.</div>
    </Dialog>
  );
}
function GraphicPen() {
  const { close } = useDialogs();
  const [strokeLength, setStrokeLength] = useState(9);
  const [balance, setBalance] = useState(50);
  const [direction, setDirection] = useState(0);
  const dirs = ["Right Diagonal", "Horizontal", "Left Diagonal", "Vertical"].map((l, i) => ({ value: String(i), label: l }));
  return (
    <Dialog open onClose={close} title="Graphic Pen" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.graphicPen(strokeLength / 15, balance / 100, direction); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Stroke Length</span>
        <NumberField value={strokeLength} min={1} max={15} onChange={setStrokeLength} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Light/Dark Balance</span>
        <NumberField value={balance} min={0} max={100} onChange={setBalance} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 120 }}>Stroke Direction</span>
        <Select value={String(direction)} onChange={(v) => setDirection(+v)} options={dirs} />
      </div>
    </Dialog>
  );
}
function HalftonePattern() {
  const { close } = useDialogs();
  const [size, setSize] = useState(4);
  const [contrast, setContrast] = useState(25);
  const [pattern, setPattern] = useState(0); // Photoshop defaults Pattern Type to Circle
  const patterns = ["Circle", "Dot", "Line"].map((l, i) => ({ value: String(i), label: l }));
  return (
    <Dialog open onClose={close} title="Halftone Pattern" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.halftonePattern(size, contrast / 50, pattern); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Size</span>
        <NumberField value={size} min={1} max={12} onChange={setSize} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Contrast</span>
        <NumberField value={contrast} min={0} max={50} onChange={setContrast} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 120 }}>Pattern Type</span>
        <Select value={String(pattern)} onChange={(v) => setPattern(+v)} options={patterns} />
      </div>
    </Dialog>
  );
}
function BasRelief() {
  const { close } = useDialogs();
  const [detail, setDetail] = useState(12);
  const [smoothness, setSmoothness] = useState(3);
  const [light, setLight] = useState(4); // Photoshop defaults the light to Bottom
  // Labels match the engine's light index (clockwise from Top).
  const lights = ["Top", "Top Right", "Right", "Bottom Right", "Bottom", "Bottom Left", "Left", "Top Left"].map((l, i) => ({ value: String(i), label: l }));
  return (
    <Dialog open onClose={close} title="Bas Relief" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.basRelief(detail, smoothness, light); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Detail</span>
        <NumberField value={detail} min={1} max={15} onChange={setDetail} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Smoothness</span>
        <NumberField value={smoothness} min={1} max={15} onChange={setSmoothness} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 120 }}>Light</span>
        <Select value={String(light)} onChange={(v) => setLight(+v)} options={lights} />
      </div>
    </Dialog>
  );
}
function Chrome() {
  const { close } = useDialogs();
  const [detail, setDetail] = useState(4);
  const [smoothness, setSmoothness] = useState(7);
  return (
    <Dialog open onClose={close} title="Chrome" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.chrome(detail, smoothness); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Detail</span>
        <NumberField value={detail} min={1} max={10} onChange={setDetail} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Smoothness</span>
        <NumberField value={smoothness} min={1} max={10} onChange={setSmoothness} />
      </div>
    </Dialog>
  );
}
function Texturizer() {
  const { close } = useDialogs();
  const [texture, setTexture] = useState(0);
  const [scaling, setScaling] = useState(100);
  const [relief, setRelief] = useState(25);
  const [light, setLight] = useState(0);
  const [invert, setInvert] = useState(false);
  const textures = ["Canvas", "Sandstone", "Brick", "Burlap"].map((l, i) => ({ value: String(i), label: l }));
  const lights = ["Top", "Top Left", "Left", "Bottom Left", "Bottom", "Bottom Right", "Right", "Top Right"].map((l, i) => ({ value: String(i), label: l }));
  return (
    <Dialog open onClose={close} title="Texturizer" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.texturizer(texture, (scaling - 50) / 150, relief / 50, light, invert); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 90 }}>Texture</span>
        <Select value={String(texture)} onChange={(v) => setTexture(+v)} options={textures} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Scaling</span>
        <NumberField value={scaling} min={50} max={200} onChange={setScaling} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Relief</span>
        <NumberField value={relief} min={0} max={50} onChange={setRelief} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 90 }}>Light</span>
        <Select value={String(light)} onChange={(v) => setLight(+v)} options={lights} />
      </div>
      <Checkbox checked={invert} onChange={setInvert}>Invert</Checkbox>
    </Dialog>
  );
}
function InkOutlines() {
  const { close } = useDialogs();
  const [strokeLength, setStrokeLength] = useState(4);
  const [darkIntensity, setDarkIntensity] = useState(20);
  const [lightIntensity, setLightIntensity] = useState(10);
  return (
    <Dialog open onClose={close} title="Ink Outlines" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.inkOutlines(strokeLength / 50, darkIntensity / 50, lightIntensity / 50); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Stroke Length</span>
        <NumberField value={strokeLength} min={1} max={50} onChange={setStrokeLength} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Dark Intensity</span>
        <NumberField value={darkIntensity} min={0} max={50} onChange={setDarkIntensity} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Light Intensity</span>
        <NumberField value={lightIntensity} min={0} max={50} onChange={setLightIntensity} />
      </div>
    </Dialog>
  );
}
function AccentedEdges() {
  const { close } = useDialogs();
  const [width, setWidth] = useState(2);
  const [brightness, setBrightness] = useState(38);
  const [smoothness, setSmoothness] = useState(5);
  return (
    <Dialog open onClose={close} title="Accented Edges" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.accentedEdges(width / 14, brightness / 50, smoothness / 15); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Edge Width</span>
        <NumberField value={width} min={1} max={14} onChange={setWidth} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Edge Brightness</span>
        <NumberField value={brightness} min={0} max={50} onChange={setBrightness} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Smoothness</span>
        <NumberField value={smoothness} min={1} max={15} onChange={setSmoothness} />
      </div>
    </Dialog>
  );
}
function Crosshatch() {
  const { close } = useDialogs();
  const [length, setLength] = useState(9);
  const [sharpness, setSharpness] = useState(6);
  const [strength, setStrength] = useState(1);
  return (
    <Dialog open onClose={close} title="Crosshatch" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.crosshatch(length / 50, sharpness / 20, strength / 3); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Stroke Length</span>
        <NumberField value={length} min={1} max={50} onChange={setLength} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Sharpness</span>
        <NumberField value={sharpness} min={0} max={20} onChange={setSharpness} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Strength</span>
        <NumberField value={strength} min={1} max={3} onChange={setStrength} />
      </div>
    </Dialog>
  );
}
function AngledStrokes() {
  const { close } = useDialogs();
  const [balance, setBalance] = useState(50);
  const [length, setLength] = useState(15);
  const [sharpness, setSharpness] = useState(3);
  return (
    <Dialog open onClose={close} title="Angled Strokes" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.angledStrokes(length, balance / 100, sharpness / 10); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 130 }}>Direction Balance</span>
        <NumberField value={balance} min={0} max={100} onChange={setBalance} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 130 }}>Stroke Length</span>
        <NumberField value={length} min={3} max={50} onChange={setLength} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 130 }}>Sharpness</span>
        <NumberField value={sharpness} min={0} max={10} onChange={setSharpness} />
      </div>
    </Dialog>
  );
}
function DarkStrokes() {
  const { close } = useDialogs();
  const [balance, setBalance] = useState(5);
  const [black, setBlack] = useState(5);
  const [white, setWhite] = useState(3);
  return (
    <Dialog open onClose={close} title="Dark Strokes" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.darkStrokes(balance / 10, black / 10, white / 10); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Balance</span>
        <NumberField value={balance} min={0} max={10} onChange={setBalance} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Black Intensity</span>
        <NumberField value={black} min={0} max={10} onChange={setBlack} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 120 }}>White Intensity</span>
        <NumberField value={white} min={0} max={10} onChange={setWhite} />
      </div>
    </Dialog>
  );
}
function SprayedStrokes() {
  const { close } = useDialogs();
  const [strokeLength, setStrokeLength] = useState(12);
  const [sprayRadius, setSprayRadius] = useState(7);
  const [direction, setDirection] = useState(0);
  const dirs = ["Right Diagonal", "Horizontal", "Left Diagonal", "Vertical"].map((l, i) => ({ value: String(i), label: l }));
  return (
    <Dialog open onClose={close} title="Sprayed Strokes" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.sprayedStrokes(strokeLength, sprayRadius, direction); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Stroke Length</span>
        <NumberField value={strokeLength} min={0} max={20} onChange={setStrokeLength} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Spray Radius</span>
        <NumberField value={sprayRadius} min={0} max={25} onChange={setSprayRadius} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 120 }}>Stroke Direction</span>
        <Select value={String(direction)} onChange={(v) => setDirection(+v)} options={dirs} />
      </div>
    </Dialog>
  );
}
function SumiE() {
  const { close } = useDialogs();
  const [strokeWidth, setStrokeWidth] = useState(10);
  const [strokePressure, setStrokePressure] = useState(2);
  const [contrast, setContrast] = useState(16);
  return (
    <Dialog open onClose={close} title="Sumi-e" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.sumiE(strokeWidth / 15, strokePressure / 15, contrast / 40); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Stroke Width</span>
        <NumberField value={strokeWidth} min={0} max={15} onChange={setStrokeWidth} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Stroke Pressure</span>
        <NumberField value={strokePressure} min={0} max={15} onChange={setStrokePressure} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Contrast</span>
        <NumberField value={contrast} min={0} max={40} onChange={setContrast} />
      </div>
    </Dialog>
  );
}
function Spatter() {
  const { close } = useDialogs();
  const [sprayRadius, setSprayRadius] = useState(10);
  const [smoothness, setSmoothness] = useState(5);
  return (
    <Dialog open onClose={close} title="Spatter" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.spatter(sprayRadius, smoothness); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Spray Radius</span>
        <NumberField value={sprayRadius} min={0} max={25} onChange={setSprayRadius} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Smoothness</span>
        <NumberField value={smoothness} min={1} max={15} onChange={setSmoothness} />
      </div>
    </Dialog>
  );
}
function Craquelure() {
  const { close } = useDialogs();
  const [spacing, setSpacing] = useState(40);
  const [depth, setDepth] = useState(6);
  const [brightness, setBrightness] = useState(8);
  return (
    <Dialog open onClose={close} title="Craquelure" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.craquelure(spacing, depth / 10, brightness / 10); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Crack Spacing</span>
        <NumberField value={spacing} min={2} max={100} onChange={setSpacing} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Crack Depth</span>
        <NumberField value={depth} min={0} max={10} onChange={setDepth} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Crack Brightness</span>
        <NumberField value={brightness} min={0} max={10} onChange={setBrightness} />
      </div>
    </Dialog>
  );
}
function Grain() {
  const { close } = useDialogs();
  const [intensity, setIntensity] = useState(40);
  const [contrast, setContrast] = useState(50);
  const [grainType, setGrainType] = useState(0);
  const types = ["Regular", "Soft", "Sprinkles", "Clumped", "Contrasty", "Enlarged", "Stippled", "Horizontal", "Vertical", "Speckle"].map((l, i) => ({ value: String(i), label: l }));
  return (
    <Dialog open onClose={close} title="Grain" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.grain(intensity / 100, contrast / 100, grainType); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Intensity</span>
        <NumberField value={intensity} min={0} max={100} onChange={setIntensity} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Contrast</span>
        <NumberField value={contrast} min={0} max={100} onChange={setContrast} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 90 }}>Grain Type</span>
        <Select value={String(grainType)} onChange={(v) => setGrainType(+v)} options={types} />
      </div>
    </Dialog>
  );
}
function PlasticWrap() {
  const { close } = useDialogs();
  const [highlightStrength, setHighlightStrength] = useState(15);
  const [detail, setDetail] = useState(9);
  const [smoothness, setSmoothness] = useState(7);
  return (
    <Dialog open onClose={close} title="Plastic Wrap" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.plasticWrap(highlightStrength / 20, detail / 15, smoothness / 15); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 130 }}>Highlight Strength</span>
        <NumberField value={highlightStrength} min={0} max={20} onChange={setHighlightStrength} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 130 }}>Detail</span>
        <NumberField value={detail} min={1} max={15} onChange={setDetail} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 130 }}>Smoothness</span>
        <NumberField value={smoothness} min={1} max={15} onChange={setSmoothness} />
      </div>
    </Dialog>
  );
}
function Patchwork() {
  const { close } = useDialogs();
  const [size, setSize] = useState(8);
  const [relief, setRelief] = useState(8);
  return (
    <Dialog open onClose={close} title="Patchwork" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.patchwork(size, relief / 25); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Square Size</span>
        <NumberField value={size} min={2} max={32} onChange={setSize} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Relief</span>
        <NumberField value={relief} min={0} max={25} onChange={setRelief} />
      </div>
    </Dialog>
  );
}
function MosaicTiles() {
  const { close } = useDialogs();
  const [tileSize, setTileSize] = useState(16);
  const [groutWidth, setGroutWidth] = useState(3);
  const [lightenGrout, setLightenGrout] = useState(9); // 0–10 → /10
  return (
    <Dialog open onClose={close} title="Mosaic Tiles" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.mosaicTiles(tileSize, groutWidth, lightenGrout / 10); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Tile Size</span>
        <NumberField value={tileSize} min={2} max={64} onChange={setTileSize} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Grout Width</span>
        <NumberField value={groutWidth} min={1} max={15} onChange={setGroutWidth} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Lighten Grout</span>
        <NumberField value={lightenGrout} min={0} max={10} onChange={setLightenGrout} />
      </div>
    </Dialog>
  );
}
function NeonGlow() {
  const { close } = useDialogs();
  const [size, setSize] = useState(0);
  const [brightness, setBrightness] = useState(25);
  return (
    <Dialog open onClose={close} title="Neon Glow" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.neonGlow(size / 24, brightness / 50); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Glow Size</span>
        <NumberField value={size} min={-24} max={24} onChange={setSize} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Glow Brightness</span>
        <NumberField value={brightness} min={0} max={50} onChange={setBrightness} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Uses the foreground color as the glow color.</div>
    </Dialog>
  );
}
function FilmGrain() {
  const { close } = useDialogs();
  const [grain, setGrain] = useState(4);
  const [highlight, setHighlight] = useState(0);
  const [intensity, setIntensity] = useState(5);
  return (
    <Dialog open onClose={close} title="Film Grain" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.filmGrain(grain / 20, highlight / 20, intensity / 10); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Grain</span>
        <NumberField value={grain} min={0} max={20} onChange={setGrain} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Highlight Area</span>
        <NumberField value={highlight} min={0} max={20} onChange={setHighlight} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Intensity</span>
        <NumberField value={intensity} min={0} max={10} onChange={setIntensity} />
      </div>
    </Dialog>
  );
}
function PosterEdges() {
  const { close } = useDialogs();
  const [levels, setLevels] = useState(4);
  const [thickness, setThickness] = useState(1);
  const [intensity, setIntensity] = useState(4);
  return (
    <Dialog open onClose={close} title="Poster Edges" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.posterEdges(Math.round(levels), Math.round(thickness), intensity); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Posterization</span>
        <NumberField value={levels} min={2} max={8} onChange={setLevels} suffix="levels" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Edge Thickness</span>
        <NumberField value={thickness} min={1} max={10} onChange={setThickness} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Edge Intensity</span>
        <NumberField value={intensity} min={0} max={10} onChange={setIntensity} />
      </div>
    </Dialog>
  );
}
function Cutout() {
  const { close } = useDialogs();
  const [levels, setLevels] = useState(4);
  const [edgeSimplicity, setEdgeSimplicity] = useState(4);
  const [edgeFidelity, setEdgeFidelity] = useState(2);
  return (
    <Dialog open onClose={close} title="Cutout" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.cutout(Math.round(levels), Math.round(edgeSimplicity), Math.round(edgeFidelity)); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>No. of Levels</span>
        <NumberField value={levels} min={2} max={8} onChange={setLevels} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Edge Simplicity</span>
        <NumberField value={edgeSimplicity} min={0} max={10} onChange={setEdgeSimplicity} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Edge Fidelity</span>
        <NumberField value={edgeFidelity} min={1} max={3} onChange={setEdgeFidelity} />
      </div>
    </Dialog>
  );
}
function DryBrush() {
  const { close } = useDialogs();
  const [brushSize, setBrushSize] = useState(6);
  const [brushDetail, setBrushDetail] = useState(5);
  const [texture, setTexture] = useState(1);
  return (
    <Dialog open onClose={close} title="Dry Brush" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.dryBrush(Math.round(brushSize), Math.round(brushDetail), Math.round(texture)); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Brush Size</span>
        <NumberField value={brushSize} min={0} max={10} onChange={setBrushSize} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Brush Detail</span>
        <NumberField value={brushDetail} min={0} max={10} onChange={setBrushDetail} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Texture</span>
        <NumberField value={texture} min={0} max={3} onChange={setTexture} />
      </div>
    </Dialog>
  );
}
function ColoredPencil() {
  const { close } = useDialogs();
  const [pencilWidth, setPencilWidth] = useState(4);
  const [strokePressure, setStrokePressure] = useState(8);
  const [paperBrightness, setPaperBrightness] = useState(25);
  return (
    <Dialog open onClose={close} title="Colored Pencil" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.coloredPencil(Math.round(pencilWidth), Math.round(strokePressure), Math.round(paperBrightness)); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Pencil Width</span>
        <NumberField value={pencilWidth} min={1} max={24} onChange={setPencilWidth} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Stroke Pressure</span>
        <NumberField value={strokePressure} min={0} max={15} onChange={setStrokePressure} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Paper Brightness</span>
        <NumberField value={paperBrightness} min={0} max={50} onChange={setPaperBrightness} />
      </div>
    </Dialog>
  );
}
function SmudgeStick() {
  const { close } = useDialogs();
  const [strokeLength, setStrokeLength] = useState(2);
  const [highlightArea, setHighlightArea] = useState(10);
  const [intensity, setIntensity] = useState(10);
  return (
    <Dialog open onClose={close} title="Smudge Stick" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.smudgeStick(Math.round(strokeLength), Math.round(highlightArea), Math.round(intensity)); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Stroke Length</span>
        <NumberField value={strokeLength} min={0} max={10} onChange={setStrokeLength} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Highlight Area</span>
        <NumberField value={highlightArea} min={0} max={20} onChange={setHighlightArea} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Intensity</span>
        <NumberField value={intensity} min={0} max={10} onChange={setIntensity} />
      </div>
    </Dialog>
  );
}
function Sponge() {
  const { close } = useDialogs();
  const [brushSize, setBrushSize] = useState(2);
  const [definition, setDefinition] = useState(12);
  const [smoothness, setSmoothness] = useState(5);
  return (
    <Dialog open onClose={close} title="Sponge" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.sponge(Math.round(brushSize), Math.round(definition), Math.round(smoothness)); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Brush Size</span>
        <NumberField aria-label="Brush Size" value={brushSize} min={0} max={10} onChange={setBrushSize} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Definition</span>
        <NumberField aria-label="Definition" value={definition} min={0} max={25} onChange={setDefinition} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Smoothness</span>
        <NumberField aria-label="Smoothness" value={smoothness} min={1} max={15} onChange={setSmoothness} />
      </div>
    </Dialog>
  );
}
function PaletteKnife() {
  const { close } = useDialogs();
  const [strokeSize, setStrokeSize] = useState(25);
  const [strokeDetail, setStrokeDetail] = useState(3);
  const [softness, setSoftness] = useState(0);
  return (
    <Dialog open onClose={close} title="Palette Knife" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.paletteKnife(Math.round(strokeSize), Math.round(strokeDetail), Math.round(softness)); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Stroke Size</span>
        <NumberField value={strokeSize} min={1} max={50} onChange={setStrokeSize} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Stroke Detail</span>
        <NumberField value={strokeDetail} min={1} max={3} onChange={setStrokeDetail} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Softness</span>
        <NumberField value={softness} min={0} max={10} onChange={setSoftness} />
      </div>
    </Dialog>
  );
}
function PaintDaubs() {
  const { close } = useDialogs();
  const [brushSize, setBrushSize] = useState(8);
  const [sharpness, setSharpness] = useState(7);
  const [brushType, setBrushType] = useState(0);
  return (
    <Dialog open onClose={close} title="Paint Daubs" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.paintDaubs(Math.round(brushSize), Math.round(sharpness), brushType); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Brush Size</span>
        <NumberField value={brushSize} min={1} max={50} onChange={setBrushSize} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Sharpness</span>
        <NumberField value={sharpness} min={0} max={40} onChange={setSharpness} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Brush Type</span>
        <Select aria-label="Brush Type" value={String(brushType)} onChange={(v) => setBrushType(+v)} options={[
          { value: "0", label: "Simple" },
          { value: "1", label: "Light Rough" },
          { value: "2", label: "Dark Rough" },
          { value: "3", label: "Wide Sharp" },
          { value: "4", label: "Wide Blurry" },
          { value: "5", label: "Sparkle" },
        ]} />
      </div>
    </Dialog>
  );
}
function Fresco() {
  const { close } = useDialogs();
  const [brushSize, setBrushSize] = useState(2);
  const [brushDetail, setBrushDetail] = useState(8);
  const [texture, setTexture] = useState(1);
  return (
    <Dialog open onClose={close} title="Fresco" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.fresco(Math.round(brushSize), Math.round(brushDetail), Math.round(texture)); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Brush Size</span>
        <NumberField value={brushSize} min={0} max={10} onChange={setBrushSize} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Brush Detail</span>
        <NumberField value={brushDetail} min={0} max={10} onChange={setBrushDetail} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 100 }}>Texture</span>
        <NumberField value={texture} min={0} max={3} onChange={setTexture} />
      </div>
    </Dialog>
  );
}
function RoughPastels() {
  const { close } = useDialogs();
  const [strokeLength, setStrokeLength] = useState(20);
  const [texture, setTexture] = useState(0);
  const [scaling, setScaling] = useState(100);
  const [relief, setRelief] = useState(25);
  const [light, setLight] = useState(1);
  const textures = ["Canvas", "Sandstone", "Brick", "Burlap"].map((l, i) => ({ value: String(i), label: l }));
  const lights = ["Top", "Top Left", "Left", "Bottom Left", "Bottom", "Bottom Right", "Right", "Top Right"].map((l, i) => ({ value: String(i), label: l }));
  return (
    <Dialog open onClose={close} title="Rough Pastels" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.roughPastels(strokeLength, texture, (scaling - 50) / 150, relief / 50, light); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Stroke Length</span>
        <NumberField value={strokeLength} min={0} max={40} onChange={setStrokeLength} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 90 }}>Texture</span>
        <Select value={String(texture)} onChange={(v) => setTexture(+v)} options={textures} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Scaling</span>
        <NumberField value={scaling} min={50} max={200} onChange={setScaling} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Relief</span>
        <NumberField value={relief} min={0} max={50} onChange={setRelief} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 90 }}>Light</span>
        <Select value={String(light)} onChange={(v) => setLight(+v)} options={lights} />
      </div>
    </Dialog>
  );
}
function Underpainting() {
  const { close } = useDialogs();
  const [brushSize, setBrushSize] = useState(6);
  const [coverage, setCoverage] = useState(16);
  const [texture, setTexture] = useState(0);
  const [scaling, setScaling] = useState(100);
  const [relief, setRelief] = useState(20);
  const [light, setLight] = useState(1);
  const textures = ["Canvas", "Sandstone", "Brick", "Burlap"].map((l, i) => ({ value: String(i), label: l }));
  const lights = ["Top", "Top Left", "Left", "Bottom Left", "Bottom", "Bottom Right", "Right", "Top Right"].map((l, i) => ({ value: String(i), label: l }));
  return (
    <Dialog open onClose={close} title="Underpainting" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.underpainting(brushSize, coverage, texture, (scaling - 50) / 150, relief / 50, light); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Brush Size</span>
        <NumberField value={brushSize} min={0} max={40} onChange={setBrushSize} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Texture Coverage</span>
        <NumberField value={coverage} min={0} max={40} onChange={setCoverage} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 120 }}>Texture</span>
        <Select value={String(texture)} onChange={(v) => setTexture(+v)} options={textures} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Scaling</span>
        <NumberField value={scaling} min={50} max={200} onChange={setScaling} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Relief</span>
        <NumberField value={relief} min={0} max={50} onChange={setRelief} />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 120 }}>Light</span>
        <Select value={String(light)} onChange={(v) => setLight(+v)} options={lights} />
      </div>
    </Dialog>
  );
}
function Watercolor() {
  const { close } = useDialogs();
  const [brushDetail, setBrushDetail] = useState(6);
  const [shadowIntensity, setShadowIntensity] = useState(0);
  const [texture, setTexture] = useState(1);
  return (
    <Dialog open onClose={close} title="Watercolor" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.watercolor(Math.round(brushDetail), Math.round(shadowIntensity), Math.round(texture)); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Brush Detail</span>
        <NumberField value={brushDetail} min={1} max={14} onChange={setBrushDetail} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Shadow Intensity</span>
        <NumberField value={shadowIntensity} min={0} max={10} onChange={setShadowIntensity} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 120 }}>Texture</span>
        <NumberField value={texture} min={0} max={3} onChange={setTexture} />
      </div>
    </Dialog>
  );
}
function Tiles() {
  const { close } = useDialogs();
  const [num, setNum] = useState(10);
  const [offset, setOffset] = useState(10);
  const [fill, setFill] = useState("0"); // 0 bg · 1 fg · 2 inverse · 3 unaltered
  const inp = { ...INP_BASE, width: 66 };
  const field = (label: string, value: number, set: (n: number) => void) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 150 }}>{label}</span>
      <input type="number" value={value} aria-label={label} style={inp} onChange={(e) => set(Number(e.currentTarget.value) || 0)} />
    </div>
  );
  return (
    <Dialog open onClose={close} title="Tiles" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.tiles(Math.max(1, Math.round(num)), offset, +fill); close(); }}>OK</Button></>}>
      {field("Number Of Tiles", num, setNum)}
      {field("Maximum Offset %", offset, setOffset)}
      <div className="lbl" style={{ margin: "4px 0 6px" }}>Fill Empty Area With</div>
      <SegmentedControl value={fill} onChange={setFill}
        items={[{ value: "0", label: "Background" }, { value: "1", label: "Foreground" }, { value: "2", label: "Inverse" }, { value: "3", label: "Unaltered" }]} />
    </Dialog>
  );
}
function ColorHalftone() {
  const { close } = useDialogs();
  const [maxRadius, setMax] = useState(8);
  const [a1, setA1] = useState(108);
  const [a2, setA2] = useState(162);
  const [a3, setA3] = useState(90);
  const inp = { ...INP_BASE, width: 66 };
  const field = (label: string, value: number, set: (n: number) => void) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 150 }}>{label}</span>
      <input type="number" value={value} aria-label={label} style={inp} onChange={(e) => set(Number(e.currentTarget.value) || 0)} />
    </div>
  );
  return (
    <Dialog open onClose={close} title="Color Halftone" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.colorHalftone(Math.max(1, maxRadius), a1, a2, a3); close(); }}>OK</Button></>}>
      {field("Max Radius", maxRadius, setMax)}
      {field("Channel 1 Angle", a1, setA1)}
      {field("Channel 2 Angle", a2, setA2)}
      {field("Channel 3 Angle", a3, setA3)}
    </Dialog>
  );
}
function Crystallize() {
  const { close } = useDialogs();
  const [cellSize, setCell] = useState(10);
  const inp = { ...INP_BASE, width: 66 };
  return (
    <Dialog open onClose={close} title="Crystallize" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.crystallize(Math.max(2, Math.round(cellSize))); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Cell Size</span>
        <input type="number" value={cellSize} aria-label="Cell Size" min={2} max={300} style={inp} onChange={(e) => setCell(Number(e.currentTarget.value) || 2)} />
      </div>
    </Dialog>
  );
}
function StainedGlass() {
  const { close } = useDialogs();
  const [cellSize, setCell] = useState(10);
  const [border, setBorder] = useState(2);
  const [light, setLight] = useState(0);
  const inp = { ...INP_BASE, width: 66 };
  const field = (label: string, value: number, set: (n: number) => void) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 130 }}>{label}</span>
      <input type="number" value={value} aria-label={label} style={inp} onChange={(e) => set(Number(e.currentTarget.value) || 0)} />
    </div>
  );
  return (
    <Dialog open onClose={close} title="Stained Glass" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.stainedGlass(Math.max(2, Math.round(cellSize)), Math.max(1, Math.round(border)), Math.max(0, light) / 10); close(); }}>OK</Button></>}>
      {field("Cell Size", cellSize, setCell)}
      {field("Border Thickness", border, setBorder)}
      {field("Light Intensity", light, setLight)}
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 4 }}>The seams are drawn in the foreground color.</div>
    </Dialog>
  );
}
function Pointillize() {
  const { close } = useDialogs();
  const [cellSize, setCell] = useState(10);
  const inp = { ...INP_BASE, width: 66 };
  return (
    <Dialog open onClose={close} title="Pointillize" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.pointillize(Math.max(2, Math.round(cellSize))); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 90 }}>Cell Size</span>
        <input type="number" value={cellSize} aria-label="Cell Size" min={2} max={300} style={inp} onChange={(e) => setCell(Number(e.currentTarget.value) || 2)} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11 }}>Uses the background colour for the canvas between dots.</div>
    </Dialog>
  );
}
function DustScratches() {
  const { close } = useDialogs();
  const [radius, setRadius] = useState(2);
  const [threshold, setThreshold] = useState(30);
  return (
    <Dialog open onClose={close} title="Dust & Scratches" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.dustScratches(Math.round(radius), Math.round(threshold)); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Radius</span>
        <NumberField value={radius} min={1} max={100} onChange={setRadius} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Threshold</span>
        <NumberField value={threshold} min={0} max={255} onChange={setThreshold} suffix="levels" />
      </div>
    </Dialog>
  );
}
function Diffuse() {
  const { close } = useDialogs();
  const [mode, setMode] = useState("0"); // 0 normal · 1 darken · 2 lighten · 3 anisotropic
  return (
    <Dialog open onClose={close} title="Diffuse" width={440}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.diffuse(+mode); close(); }}>OK</Button></>}>
      <div className="lbl" style={{ marginBottom: 6 }}>Mode</div>
      <SegmentedControl value={mode} onChange={setMode}
        items={[{ value: "0", label: "Normal" }, { value: "1", label: "Darken Only" }, { value: "2", label: "Lighten Only" }, { value: "3", label: "Anisotropic" }]} />
    </Dialog>
  );
}
function FreeTransform() {
  const { arg } = useDialogs();
  const [w, setW] = useState(100);
  const [h, setH] = useState(100);
  const [angle, setAngle] = useState(0);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const inp = { ...INP_BASE, width: 76 };
  // The Scale / Rotate menu items pre-arm the relevant field (this dialog is one
  // unified transform, so "mode" = which control gets initial focus).
  const focusField = arg === "rotate" ? "Angle" : arg === "scale" ? "Width" : null;
  const field = (label: string, value: number, set: (n: number) => void, suffix: string) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 66 }}>{label}</span>
      <input type="number" value={value} aria-label={label} style={inp} autoFocus={focusField === label}
        onChange={(e) => set(Number(e.currentTarget.value) || 0)} />
      <span style={{ color: "var(--text-3)", fontSize: 11 }}>{suffix}</span>
    </div>
  );
  return (
    <PreviewDialog title="Free Transform" width={320} deps={[w, h, angle, tx, ty]}
      apply={() => xform.transformLayer(w / 100, h / 100, angle, Math.round(tx), Math.round(ty))}>
      {field("Width", w, setW, "%")}
      {field("Height", h, setH, "%")}
      {field("Angle", angle, setAngle, "°")}
      {field("Move X", tx, setTx, "px")}
      {field("Move Y", ty, setTy, "px")}
    </PreviewDialog>
  );
}
function Skew() {
  const [horiz, setHoriz] = useState(0);
  const [vert, setVert] = useState(0);
  const inp = { ...INP_BASE, width: 76 };
  const field = (label: string, value: number, set: (n: number) => void) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 80 }}>{label}</span>
      <input type="number" value={value} aria-label={label} style={inp}
        onChange={(e) => set(Number(e.currentTarget.value) || 0)} />
      <span style={{ color: "var(--text-3)", fontSize: 11 }}>°</span>
    </div>
  );
  return (
    <PreviewDialog title="Skew" width={320} deps={[horiz, vert]}
      apply={() => xform.skewLayer(horiz, vert)}>
      {field("Horizontal", horiz, setHoriz)}
      {field("Vertical", vert, setVert)}
    </PreviewDialog>
  );
}
function PerspectiveWarp() {
  // Each corner moves independently (percent of canvas W/H) — the arbitrary-quad
  // superset of the old symmetric keystone; all-zero = no-op.
  const [tl, setTl] = useState({ dx: 0, dy: 0 });
  const [tr, setTr] = useState({ dx: 0, dy: 0 });
  const [br, setBr] = useState({ dx: 0, dy: 0 });
  const [bl, setBl] = useState({ dx: 0, dy: 0 });
  const offsets = [tl, tr, br, bl];
  return (
    <PreviewDialog title="Perspective Warp" width={360} deps={[tl.dx, tl.dy, tr.dx, tr.dy, br.dx, br.dy, bl.dx, bl.dy]}
      apply={() => xform.perspectiveWarp(offsets)}>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 10 }}>Move each corner independently (percent of canvas; 0 = unchanged).</div>
      <Row label="Top-Left X" value={tl.dx} min={-50} max={50} suffix="%" onChange={(v) => setTl({ ...tl, dx: v })} />
      <Row label="Top-Left Y" value={tl.dy} min={-50} max={50} suffix="%" onChange={(v) => setTl({ ...tl, dy: v })} />
      <Row label="Top-Right X" value={tr.dx} min={-50} max={50} suffix="%" onChange={(v) => setTr({ ...tr, dx: v })} />
      <Row label="Top-Right Y" value={tr.dy} min={-50} max={50} suffix="%" onChange={(v) => setTr({ ...tr, dy: v })} />
      <Row label="Bottom-Right X" value={br.dx} min={-50} max={50} suffix="%" onChange={(v) => setBr({ ...br, dx: v })} />
      <Row label="Bottom-Right Y" value={br.dy} min={-50} max={50} suffix="%" onChange={(v) => setBr({ ...br, dy: v })} />
      <Row label="Bottom-Left X" value={bl.dx} min={-50} max={50} suffix="%" onChange={(v) => setBl({ ...bl, dx: v })} />
      <Row label="Bottom-Left Y" value={bl.dy} min={-50} max={50} suffix="%" onChange={(v) => setBl({ ...bl, dy: v })} />
    </PreviewDialog>
  );
}
function PerspectiveCropDialog() {
  const { close } = useDialogs();
  const docW = useStore((s) => s.doc.width);
  const docH = useStore((s) => s.doc.height);
  // Quad corners as percent of the canvas (TL,TR,BR,BL); default = full rect.
  const [tl, setTl] = useState({ x: 0, y: 0 });
  const [tr, setTr] = useState({ x: 100, y: 0 });
  const [br, setBr] = useState({ x: 100, y: 100 });
  const [bl, setBl] = useState({ x: 0, y: 100 });
  const [outW, setOutW] = useState(docW);
  const [outH, setOutH] = useState(docH);
  const corners = [tl, tr, br, bl].map((c) => ({ x: c.x / 100, y: c.y / 100 }));
  return (
    <Dialog open onClose={close} title="Perspective Crop" width={380}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { xform.perspectiveCrop(corners, outW, outH); close(); }}>OK</Button></>}>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 10 }}>Rectify the source quad (percent of canvas, TL→TR→BR→BL) into a new canvas.</div>
      <Row label="Top-Left X" value={tl.x} min={0} max={100} decimals={0} suffix="%" onChange={(v) => setTl({ ...tl, x: v })} />
      <Row label="Top-Left Y" value={tl.y} min={0} max={100} decimals={0} suffix="%" onChange={(v) => setTl({ ...tl, y: v })} />
      <Row label="Top-Right X" value={tr.x} min={0} max={100} decimals={0} suffix="%" onChange={(v) => setTr({ ...tr, x: v })} />
      <Row label="Top-Right Y" value={tr.y} min={0} max={100} decimals={0} suffix="%" onChange={(v) => setTr({ ...tr, y: v })} />
      <Row label="Bottom-Right X" value={br.x} min={0} max={100} decimals={0} suffix="%" onChange={(v) => setBr({ ...br, x: v })} />
      <Row label="Bottom-Right Y" value={br.y} min={0} max={100} decimals={0} suffix="%" onChange={(v) => setBr({ ...br, y: v })} />
      <Row label="Bottom-Left X" value={bl.x} min={0} max={100} decimals={0} suffix="%" onChange={(v) => setBl({ ...bl, x: v })} />
      <Row label="Bottom-Left Y" value={bl.y} min={0} max={100} decimals={0} suffix="%" onChange={(v) => setBl({ ...bl, y: v })} />
      <div className="monet-row" style={{ gap: 10, marginTop: 8 }}>
        <span className="lbl" style={{ width: 70 }}>Output</span>
        <NumberField value={outW} min={1} max={8192} onChange={setOutW} />
        <span style={{ color: "var(--text-3)" }}>×</span>
        <NumberField value={outH} min={1} max={8192} onChange={setOutH} />
        <Button size="sm" variant="ghost" onClick={() => { const s = suggestedCropSize(corners, docW, docH); setOutW(s.w); setOutH(s.h); }}>Fit to quad</Button>
      </div>
    </Dialog>
  );
}
function TransformSelection() {
  const { close } = useDialogs();
  const [w, setW] = useState(100);
  const [h, setH] = useState(100);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [deg, setDeg] = useState(0);
  const [skewH, setSkewH] = useState(0);
  const [skewV, setSkewV] = useState(0);
  const inp = { ...INP_BASE, width: 76 };
  const field = (label: string, value: number, set: (n: number) => void, suffix: string) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 66 }}>{label}</span>
      <input type="number" value={value} aria-label={label} style={inp} onChange={(e) => set(Number(e.currentTarget.value) || 0)} />
      <span style={{ color: "var(--text-3)", fontSize: 11 }}>{suffix}</span>
    </div>
  );
  // Both paths — numeric OK and the on-canvas frame — read the same spec.
  const spec = () => ({ sx: w / 100, sy: h / 100, deg, skewH, skewV, tx: Math.round(tx), ty: Math.round(ty) });
  return (
    <Dialog open onClose={close} title="Transform Selection" width={320}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="ghost" onClick={() => { if (store.beginSelectionTransform(spec())) close(); }}>On Canvas</Button>
        <Button variant="primary" onClick={() => { const s = spec(); store.transformSelection(s.sx, s.sy, s.tx, s.ty, s.deg, s.skewH, s.skewV); close(); }}>OK</Button></>}>
      {field("Width", w, setW, "%")}
      {field("Height", h, setH, "%")}
      {field("Angle", deg, setDeg, "°")}
      {field("Skew H", skewH, setSkewH, "°")}
      {field("Skew V", skewV, setSkewV, "°")}
      {field("Move X", tx, setTx, "px")}
      {field("Move Y", ty, setTy, "px")}
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 6 }}>
        Transforms the selection outline, not the pixels. <b>On Canvas</b> drops a
        live frame on the marching ants — drag a handle to scale, ⌘/Ctrl an edge
        handle to skew, drag just outside a corner to rotate.
      </div>
    </Dialog>
  );
}
// Layer ▸ Vector Mask ▸ Current Path: the path-op picker (Photoshop's Path
// Operations control, as a one-shot flyout since this app has no persistent
// options-bar mode for the Pen/Shape tools to host it in). Each click applies
// immediately — mirroring a single icon click in that flyout — rather than
// requiring an extra OK, so replacing a mask (the common case) stays one click
// like it was before this picker existed. `addVectorMaskFromPath` reports a
// refusal (e.g. an imported read-only Photoshop source) only via the engine's
// last_edit_error, not a return value, so surface it through the same
// consumeEditError() → onEditError → toast path every other refused edit uses.
const VECTOR_MASK_PATH_OPS: { op: number | undefined; label: string; hint: string }[] = [
  { op: undefined, label: "Replace", hint: "Swap out any existing vector mask with this path." },
  { op: 0, label: "Combine", hint: "Union — add this path to the existing mask." },
  { op: 1, label: "Subtract Front", hint: "Cut this path out of the existing mask." },
  { op: 2, label: "Intersect", hint: "Keep only the overlap with the existing mask." },
  { op: 3, label: "Exclude Overlapping", hint: "Keep everything except the overlap." },
];
export function VectorMaskPathOp({ onClose }: { onClose: () => void }) {
  const apply = (op: number | undefined) => {
    store.addVectorMaskFromPath(op);
    engine.consumeEditError();
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title="Vector Mask ▸ Current Path" width={300}
      footer={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <p className="val" style={{ opacity: 0.6, marginBottom: 8, fontSize: 12 }}>
        Choose how the Pen tool's work path meets the layer's vector mask — mirrors Combine Shapes' path operations.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {VECTOR_MASK_PATH_OPS.map(({ op, label, hint }) => (
          <button key={label} onClick={() => apply(op)} title={hint}
            style={{ display: "block", width: "100%", textAlign: "left", font: "12px var(--font-mono, monospace)", padding: "6px 8px", border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", borderRadius: 4, background: "transparent", color: "var(--text-1)", cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
function TransformPath() {
  const { close, arg } = useDialogs();
  const toast = useToast();
  const [w, setW] = useState(100);
  const [h, setH] = useState(100);
  const [angle, setAngle] = useState(0);
  const [skewH, setSkewH] = useState(0);
  const [skewV, setSkewV] = useState(0);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const inp = { ...INP_BASE, width: 76 };
  // Scale / Rotate / Skew menu items pre-arm the relevant field, mirroring FreeTransform.
  const focusField = arg === "rotate" ? "Angle" : arg === "scale" ? "Width" : arg === "skew" ? "Skew H" : null;
  const field = (label: string, value: number, set: (n: number) => void, suffix: string) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 66 }}>{label}</span>
      <input type="number" value={value} aria-label={label} style={inp} autoFocus={focusField === label}
        onChange={(e) => set(Number(e.currentTarget.value) || 0)} />
      <span style={{ color: "var(--text-3)", fontSize: 11 }}>{suffix}</span>
    </div>
  );
  const apply = () => {
    const ok = store.transformWorkPath({ sx: w / 100, sy: h / 100, deg: angle, skewH, skewV, tx: Math.round(tx), ty: Math.round(ty) });
    if (!ok) toast.push({ title: "Transform Path", message: "No work path to transform.", variant: "warn" });
    close();
  };
  return (
    <Dialog open onClose={close} title="Transform Path" width={320}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={apply}>OK</Button></>}>
      {field("Width", w, setW, "%")}
      {field("Height", h, setH, "%")}
      {field("Angle", angle, setAngle, "°")}
      {field("Skew H", skewH, setSkewH, "°")}
      {field("Skew V", skewV, setSkewV, "°")}
      {field("Move X", tx, setTx, "px")}
      {field("Move Y", ty, setTy, "px")}
    </Dialog>
  );
}
function WarpDialog() {
  const [style, setStyle] = useState<WarpStyle>("arc");
  const [bend, setBend] = useState(0.3);
  const [h, setH] = useState(0);
  const [v, setV] = useState(0);
  const styleOpts = text.WARP_STYLES.filter((w) => w.id !== "none").map((w) => ({ value: w.id, label: w.label }));
  const row = (label: string, value: number, set: (n: number) => void) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8, alignItems: "center" }}>
      <span className="lbl" style={{ width: 76 }}>{label}</span>
      <Slider min={-1} max={1} step={0.01} value={value} onChange={set} />
      <span style={{ width: 44, textAlign: "right", fontSize: 11 }}>{Math.round(value * 100)}%</span>
    </div>
  );
  return (
    <PreviewDialog title="Warp" width={340} deps={[style, bend, h, v]}
      apply={() => warpLayer({ style, bend, h, v, orient: "h" })}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 76 }}>Style</span>
        <Select value={style} onChange={(val) => setStyle(val as WarpStyle)} options={styleOpts} />
      </div>
      {row("Bend", bend, setBend)}
      {row("Horizontal", h, setH)}
      {row("Vertical", v, setV)}
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 6 }}>Deforms the active layer with a preset envelope.</div>
    </PreviewDialog>
  );
}
function SurfaceBlur() {
  const { close } = useDialogs();
  const [radius, setRadius] = useState(5);
  const [threshold, setThreshold] = useState(15);
  return (
    <Dialog open onClose={close} title="Surface Blur" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.surfaceBlur(Math.round(radius), Math.round(threshold)); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Radius</span>
        <NumberField value={radius} min={1} max={100} onChange={setRadius} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Threshold</span>
        <NumberField value={threshold} min={1} max={255} onChange={setThreshold} suffix="levels" />
      </div>
    </Dialog>
  );
}
// Image ▸ Mode ▸ Indexed Color — Photoshop's Palette and Forced menus, in the
// engine's `palette_kind` / `forced` order (see store.convertIndexed).
const INDEXED_PALETTES = ["Exact", "System", "Web", "Uniform", "Perceptual", "Selective", "Adaptive", "Custom", "Previous"];
const INDEXED_FORCED = ["None", "Black and White", "Primaries", "Web"];
// Palettes whose table is the menu entry's own — Exact, System, Web, Custom and
// Previous. Photoshop greys Colors out for them and hands the conversion all 256
// slots, so a Colors of 16 left over from Adaptive cannot truncate the web cube.
const INDEXED_FIXED_COLORS = ["0", "1", "2", "7", "8"];

function IndexedColor() {
  const { close } = useDialogs();
  // Reopens with the last OK'd values (INDEXED_COLOR_DEFAULTS the first time).
  const [remembered] = useState(loadIndexedColorPrefs);
  const [colors, setColors] = useState(remembered.colors);
  const [dither, setDither] = useState(remembered.dither);
  const [palette, setPalette] = useState(String(remembered.palette));
  const [forced, setForced] = useState(String(remembered.forced));
  const [transparency, setTransparency] = useState(remembered.transparency);
  const [matte, setMatte] = useState(remembered.matte);
  // Palette ▸ Custom is Photoshop's "pick a table" door: the .act loaded here is
  // the one the conversion quantizes to, and the same table the Color Table
  // dialog edits.
  const [custom, setCustom] = useState<string[]>(remembered.custom);
  const loadCustom = async () => {
    const table = await loadColorTableAct();
    if (table) { setCustom(table); setPalette("7"); }
  };
  const fixed = INDEXED_FIXED_COLORS.includes(palette);
  const slots = fixed ? 256 : Math.round(colors);
  return (
    <Dialog open onClose={close} title="Indexed Color" width={380}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => {
          // A refusal is reported and leaves the dialog up, its values unsaved.
          if (!store.convertIndexed(slots, dither, +palette, +forced, transparency, matte, custom)) return;
          saveIndexedColorPrefs({ palette: +palette, colors, forced: +forced, dither, transparency, matte, custom });
          close();
        }}>OK</Button></>}>
      <FlattenNotice action="OK" />
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 74 }}>Palette</span>
        <Select block aria-label="Palette" value={palette} onChange={setPalette}
          options={INDEXED_PALETTES.map((label, i) => ({ value: String(i), label }))} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 74 }}>Colors</span>
        <NumberField value={slots} min={2} max={256} onChange={setColors} disabled={fixed} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 74 }}>Forced</span>
        <Select block aria-label="Forced" value={forced} onChange={setForced}
          options={INDEXED_FORCED.map((label, i) => ({ value: String(i), label }))} />
      </div>
      {palette === "7" && (
        <div className="monet-row" style={{ gap: 8, marginBottom: 8 }}>
          <span className="lbl" style={{ width: 74 }} />
          <Button size="sm" variant="ghost" data-mv-indexed-load-act onClick={() => void loadCustom()}
            title="Load an Adobe .act colour table to quantize to">Load .act…</Button>
          <span className="lbl" style={{ opacity: 0.7 }}>
            {custom.length ? `${custom.length} entries` : "no table loaded — falls back to Adaptive"}
          </span>
        </div>
      )}
      <Checkbox checked={dither} onChange={setDither}>Dither (Diffusion)</Checkbox>
      <div style={{ marginTop: 8 }}>
        <Checkbox checked={transparency} onChange={setTransparency}>Transparency</Checkbox>
      </div>
      <div className="monet-row" style={{ gap: 10, marginTop: 8 }}>
        <span className="lbl" style={{ width: 74 }}>Matte</span>
        {/* An indexed image has no partial alpha, so the matte is what soft edges
            are composited onto — that happens with Transparency either way, which
            is why this stays live. The checkbox only decides the FULLY empty
            pixels: kept empty, or filled with the matte too. */}
        <input type="color" value={matte} aria-label="Matte"
          onChange={(e) => setMatte(e.currentTarget.value)}
          style={{ width: 40, height: 26, padding: 0, border: "none", background: "none" }} />
        <span className="lbl" style={{ opacity: 0.7 }}>
          {transparency ? "soft edges only — empty pixels stay transparent" : "soft edges and empty pixels alike"}
        </span>
      </div>
    </Dialog>
  );
}
// Image ▸ Mode ▸ Duotone — Photoshop's Duotone Options: 1–4 named inks, each with
// its own transfer curve, plus Overprint Colors and the shipped preset library.
// The dialog edits an ink specification; the store turns the document into a
// duotone one (gray plate + ink composite) and re-inks it on a second visit.
const DUOTONE_TYPES = ["Monotone", "Duotone", "Tritone", "Quadtone"];
const DUOTONE_CUSTOM = "Custom";
const inkHex = (c: DuotoneRgb): string => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const parseInkHex = (hex: string): DuotoneRgb => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** The 13 curve stops as editor points, and back — the editor may add or move
 *  points freely, so the round trip resamples through the shared curve builder. */
const inkCurvePoints = (curve: number[]): CurvePoint[] =>
  DUOTONE_CURVE_INPUTS.map((x, i) => ({ id: `stop${i}`, x: x / 100, y: (curve[i] ?? 0) / 100 }));
const inkCurveFromPoints = (pts: CurvePoint[]): number[] => {
  const lut = buildLut(pts);
  return DUOTONE_CURVE_INPUTS.map((x) => Math.round((lut[Math.round((x / 100) * 255)] / 255) * 100));
};

function Duotone() {
  const { close } = useDialogs();
  const current = useStore((s) => s.duotone);
  const [inks, setInks] = useState<DuotoneInk[]>(() => current?.inks ?? DUOTONE_PRESETS[1].inks);
  const [overprints, setOverprints] = useState<Overprints>(() => current?.overprints ?? {});
  const [preset, setPreset] = useState(() => (current ? DUOTONE_CUSTOM : DUOTONE_PRESETS[1].name));
  const [curveInk, setCurveInk] = useState(-1); // ink whose curve editor is open, -1 = none
  const [showOverprint, setShowOverprint] = useState(false);
  const count = inks.length;
  const editInk = (i: number, patch: Partial<DuotoneInk>) => {
    setInks((cur) => cur.map((ink, j) => (j === i ? { ...ink, ...patch } : ink)));
    setPreset(DUOTONE_CUSTOM);
  };
  // Type keeps the inks already set up and grows from the matching preset, so
  // Duotone→Quadtone does not throw away two edited inks.
  const setType = (v: string) => {
    const n = +v;
    setInks((cur) => (n <= cur.length ? cur.slice(0, n) : [...cur, ...presetForInkCount(n).inks.slice(cur.length, n)]));
    setCurveInk((i) => (i < n ? i : -1));
    setPreset(DUOTONE_CUSTOM);
  };
  const applyPreset = (name: string) => {
    const p = DUOTONE_PRESETS.find((q) => q.name === name);
    if (!p) return;
    setInks(p.inks);
    setOverprints(p.overprints ?? {});
    setPreset(name);
    setCurveInk(-1);
  };
  // Tone ramp through the inks as they stand — the dialog's live proof.
  const ramp = `linear-gradient(to right, ${[...Array(17).keys()]
    .map((i) => `${inkHex(duotoneColorAt(inks, overprints, (1 - i / 16) * 100))} ${(i / 16) * 100}%`).join(", ")})`;
  return (
    <Dialog open onClose={close} title="Duotone Options" width={460}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { store.convertDuotone(inks, overprints); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 92 }}>Preset</span>
        <Select block aria-label="Duotone preset" value={preset} onChange={applyPreset}
          options={[...DUOTONE_PRESETS.map((p) => ({ value: p.name, label: p.name })), { value: DUOTONE_CUSTOM, label: DUOTONE_CUSTOM }]} />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 12 }}>
        <span className="lbl" style={{ width: 92 }}>Type</span>
        <SegmentedControl value={String(count)} onChange={setType}
          items={DUOTONE_TYPES.map((label, i) => ({ value: String(i + 1), label }))} />
      </div>
      {inks.map((ink, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <div className="monet-row" style={{ gap: 8, alignItems: "center" }}>
            <span className="lbl" style={{ width: 44 }}>{`Ink ${i + 1}`}</span>
            <input type="color" value={inkHex(ink.color)} aria-label={`Ink ${i + 1} color`}
              onChange={(e) => editInk(i, { color: parseInkHex(e.currentTarget.value) })}
              style={{ width: 40, height: 28, padding: 0, border: "none", background: "none" }} />
            <input type="text" value={ink.name} aria-label={`Ink ${i + 1} name`} style={{ ...INP_BASE, flex: 1, minWidth: 0 }}
              onChange={(e) => editInk(i, { name: e.currentTarget.value })} />
            <Button size="sm" variant={curveInk === i ? "primary" : "ghost"} aria-expanded={curveInk === i}
              onClick={() => setCurveInk(curveInk === i ? -1 : i)} title="Edit this ink's transfer curve">Curve…</Button>
          </div>
          {curveInk === i && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0" }}>
              <CurveEditor points={inkCurvePoints(ink.curve)} width={256} height={160} accent={ACCENT}
                xRange={[0, 100]} yRange={[0, 100]} aria-label={`${ink.name} transfer curve`}
                onChange={(pts) => editInk(i, { curve: inkCurveFromPoints(pts) })} />
              <div className="lbl" style={{ opacity: 0.7, marginTop: 4 }}>Image tone % (highlight → shadow) vs ink density %</div>
            </div>
          )}
        </div>
      ))}
      {count > 1 && (
        <>
          <Button size="sm" variant="ghost" aria-expanded={showOverprint} onClick={() => setShowOverprint(!showOverprint)}
            title="Set the measured colour of overlapping inks">Overprint Colors…</Button>
          {showOverprint && (
            <div style={{ margin: "8px 0" }}>
              {overprintCombos(count).map((idx) => {
                const key = overprintKey(idx);
                const color = overprints[key] ?? solidOverprint(inks, idx);
                const label = idx.map((i) => inks[i].name).join(" + ");
                return (
                  <div key={key} className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <input type="color" value={inkHex(color)} aria-label={`${label} overprint color`}
                      onChange={(e) => setOverprints({ ...overprints, [key]: parseInkHex(e.currentTarget.value) })}
                      style={{ width: 32, height: 24, padding: 0, border: "none", background: "none" }} />
                    <span className="lbl" style={{ flex: 1, minWidth: 0 }}>{label}</span>
                    {overprints[key] && <Button size="sm" variant="ghost" onClick={() => {
                      const next = { ...overprints };
                      delete next[key];
                      setOverprints(next);
                    }}>Reset</Button>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <div aria-label="Duotone tone ramp" style={{ height: 20, marginTop: 10, borderRadius: 3, background: ramp }} />
    </Dialog>
  );
}
// Bitmap ▸ Halftone Screen ▸ Shape, in the engine's `shape` order.
const HALFTONE_SHAPES = ["Round", "Diamond", "Ellipse", "Line", "Square", "Cross"];

function Bitmap() {
  const { close } = useDialogs();
  // Reopens with the last OK'd values (BITMAP_DEFAULTS the first time).
  const [remembered] = useState(loadBitmapPrefs);
  const [method, setMethod] = useState(String(remembered.method)); // 0 threshold · 1 diffusion dither
  // Photoshop's Input/Output resolution pair: Input is the document's, Output is
  // the converted document's — OK resamples to it — and what the screen's
  // lines-per-inch is measured against. Seeded from the document unless another
  // Output was picked last time.
  const input = useStore((s) => s.resolutionPpi);
  const [output, setOutput] = useState(() => bitmapOutputFor(remembered, input));
  const [frequency, setFrequency] = useState(remembered.frequency); // lpi — Photoshop's default screen is 53
  const [angle, setAngle] = useState(remembered.angle);
  const [shape, setShape] = useState(String(remembered.shape));
  return (
    <Dialog open onClose={close} title="Bitmap" width={400}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => {
          // A refusal (an Output resolution past the size limit) is reported
          // and leaves the dialog up, its values unsaved.
          if (!store.convertBitmap(+method, method === "3" ? frequency : 0, angle, +shape, output)) return;
          saveBitmapPrefs({ method: +method, output, frequency, angle, shape: +shape }, input);
          close();
        }}>OK</Button></>}>
      <FlattenNotice action="OK" />
      <div className="monet-section-label">Resolution</div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 60 }}>Input</span>
        <span className="val" style={{ opacity: 0.7 }}>{input} ppi</span>
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Output</span>
        <NumberField value={output} min={1} max={BITMAP_MAX_OUTPUT_PPI} onChange={setOutput} suffix="ppi" />
      </div>
      <div className="monet-section-label">Method</div>
      <SegmentedControl value={method} onChange={setMethod}
        items={[{ value: "0", label: "50% Threshold" }, { value: "1", label: "Diffusion Dither" }, { value: "2", label: "Pattern Dither" }, { value: "3", label: "Halftone Screen" }, { value: "4", label: "Custom Pattern" }]} />
      {method === "3" && (
        <div style={{ marginTop: 10 }}>
          <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
            <span className="lbl" style={{ width: 60 }}>Frequency</span>
            <NumberField value={frequency} min={1} max={999} onChange={setFrequency} suffix="lpi" />
          </div>
          <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
            <span className="lbl" style={{ width: 60 }}>Angle</span>
            <NumberField value={angle} min={-180} max={180} onChange={setAngle} suffix="°" />
          </div>
          <div className="monet-row" style={{ gap: 10 }}>
            <span className="lbl" style={{ width: 60 }}>Shape</span>
            <Select block aria-label="Shape" value={shape} onChange={setShape}
              options={HALFTONE_SHAPES.map((label, i) => ({ value: String(i), label }))} />
          </div>
        </div>
      )}
      {method === "4" && (
        <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 10 }}>Screens against the tile from Edit ▸ Define Pattern; without one this is the 50% threshold.</div>
      )}
    </Dialog>
  );
}
function Displace() {
  const { close } = useDialogs();
  const [h, setH] = useState(10);
  const [v, setV] = useState(10);
  return (
    <Dialog open onClose={close} title="Displace" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.displace(h, v); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Horizontal Scale</span>
        <NumberField value={h} min={-100} max={100} onChange={setH} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 110 }}>Vertical Scale</span>
        <NumberField value={v} min={-100} max={100} onChange={setV} suffix="px" />
      </div>
      <div className="lbl" style={{ marginTop: 8, color: "var(--text-3)", fontSize: 11 }}>Uses the image's own red/green channels as the displacement map.</div>
    </Dialog>
  );
}
function LensCorrection() {
  const { close } = useDialogs();
  const target = useRef({ documentId: store.state.activeDocId, layerId: store.state.activeLayerId });
  const [profile, setProfile] = useState<LensCorrectionSettings>(() => createDefaultRecipe().optics);
  const [error, setError] = useState("");
  const [distortion, setDistortion] = useState(0);
  const [vignette, setVignette] = useState(0);
  const [vignetteMid, setVignetteMid] = useState(50);
  const [redCyan, setRedCyan] = useState(0);
  const [blueYellow, setBlueYellow] = useState(0);
  const [scale, setScale] = useState(100);
  const apply = () => {
    try {
      if (store.state.activeDocId !== target.current.documentId || store.state.activeLayerId !== target.current.layerId) throw new Error("The target changed. Reopen Lens Correction for the intended layer.");
      const manual = [distortion / 100, vignette / 100, redCyan / 1000, blueYellow / 1000, scale / 100, vignetteMid / 100];
      if (profile.enableProfileCorrections) applyLensProfileCorrection(profile, manual, target.current);
      else fil.lensCorrectionCa(manual[0], manual[1], manual[2], manual[3], manual[4], manual[5]);
      close();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  return (
    <Dialog open onClose={close} title="Lens Correction" width={420}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={apply}>OK</Button></>}>
      <LensProfileControls value={profile} metadata={store.lensMetadata(target.current)} onChange={(patch) => { setError(""); setProfile((current) => ({ ...current, ...patch })); }} />
      {error && <div role="alert">{error}</div>}
      <div className="monet-section-label" style={{ marginTop: 12 }}>Manual Corrections</div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Distortion</span>
        <NumberField value={distortion} min={-50} max={50} onChange={setDistortion} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Vignette</span>
        <NumberField value={vignette} min={-100} max={100} onChange={setVignette} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Vignette Midpoint</span>
        <NumberField value={vignetteMid} min={0} max={95} onChange={setVignetteMid} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Fix Red/Cyan Fringe</span>
        <NumberField value={redCyan} min={-100} max={100} onChange={setRedCyan} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Fix Blue/Yellow Fringe</span>
        <NumberField value={blueYellow} min={-100} max={100} onChange={setBlueYellow} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 110 }}>Scale</span>
        <NumberField value={scale} min={50} max={200} onChange={setScale} suffix="%" />
      </div>
    </Dialog>
  );
}
// Filter ▸ Render ▸ Tree — branch shape plus Photoshop's leaves, height,
// thickness and light-direction controls, previewed live like the other filters.
function Tree() {
  const [angle, setAngle] = useState(25);
  const [depth, setDepth] = useState(9);
  const [leavesAmount, setLeavesAmount] = useState(70);
  const [leavesSize, setLeavesSize] = useState(100);
  const [height, setHeight] = useState(100);
  const [thickness, setThickness] = useState(100);
  const [light, setLight] = useState(90);
  const [r0, g0, b0] = hsvToRgba(store.state.fg);
  return (
    <PreviewDialog title="Tree" deps={[angle, depth, leavesAmount, leavesSize, height, thickness, light]}
      apply={() => fil.tree(angle, Math.round(depth), r0, g0, b0, leavesAmount, leavesSize, height, thickness, light)}>
      <Row label="Light Direction" value={light} min={0} max={180} onChange={setLight} suffix="°" />
      <Row label="Leaves Amount" value={leavesAmount} min={0} max={100} onChange={setLeavesAmount} suffix="%" />
      <Row label="Leaves Size" value={leavesSize} min={0} max={200} onChange={setLeavesSize} suffix="%" />
      <Row label="Branches Height" value={height} min={50} max={200} onChange={setHeight} suffix="%" />
      <Row label="Branches Thickness" value={thickness} min={0} max={200} onChange={setThickness} suffix="%" />
      <Row label="Branch Angle" value={angle} min={5} max={60} onChange={setAngle} suffix="°" />
      <Row label="Branches" value={depth} min={3} max={13} onChange={setDepth} />
      <div className="lbl" style={{ marginTop: 4, color: "var(--text-3)", fontSize: 11 }}>Drawn in the foreground colour.</div>
    </PreviewDialog>
  );
}
// Filter ▸ Render ▸ Flame — fire rising from the bottom of the selection (or
// the layer) in the foreground colour. The seed is state, not a fresh random
// per apply, so the live preview, OK and a smart-stack re-render all agree.
function Flame() {
  const [length, setLength] = useState(() => Math.max(1, Math.round(engine.e.height() / 2)));
  const [width, setWidth] = useState(32);
  const [turbulence, setTurbulence] = useState(50);
  const [opacity, setOpacity] = useState(100);
  // Smart-filter params are f32, so keep the u32 seed in their exact integer range.
  const randomSeed = () => Math.floor(Math.random() * 0x100_0000);
  const [seed, setSeed] = useState(randomSeed);
  return (
    <PreviewDialog title="Flame" deps={[length, width, turbulence, opacity, seed]}
      apply={() => fil.flame(length, width, turbulence, opacity / 100, seed)}>
      <Row label="Length" value={length} min={1} max={2000} onChange={setLength} suffix="px" />
      <Row label="Width" value={width} min={1} max={500} onChange={setWidth} suffix="px" />
      <Row label="Turbulence" value={turbulence} min={0} max={100} onChange={setTurbulence} suffix="%" />
      <Row label="Opacity" value={opacity} min={0} max={100} onChange={setOpacity} suffix="%" />
      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginTop: 4 }}>
        <span className="lbl" style={{ width: 96 }}>Random Seed</span>
        <NumberField value={seed} min={0} max={0xff_ffff} onChange={(v) => setSeed(Math.round(v))} />
        <Button size="sm" variant="ghost" aria-label="Randomize shapes" onClick={() => setSeed(randomSeed())}>Randomize</Button>
      </div>
      <div className="lbl" style={{ marginTop: 8, color: "var(--text-3)", fontSize: 11 }}>Burns upward from the bottom of the selection in the foreground colour; the same seed always draws the same fire.</div>
    </PreviewDialog>
  );
}
function PictureFrame() {
  const { close } = useDialogs();
  const [width, setWidth] = useState(40);
  const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  const [r0, g0, b0] = hsvToRgba(store.state.fg);
  const [hex, setHex] = useState(toHex(r0, g0, b0));
  const commit = () => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    const n = m ? parseInt(m[1], 16) : 0;
    fil.pictureFrame(Math.round(width), (n >> 16) & 255, (n >> 8) & 255, n & 255);
    close();
  };
  return (
    <Dialog open onClose={close} title="Picture Frame" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={commit}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 56 }}>Width</span>
        <NumberField value={width} min={1} max={400} onChange={setWidth} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 56 }}>Color</span>
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000"} aria-label="Frame color"
          onChange={(e) => setHex(e.currentTarget.value)} style={{ width: 40, height: 28, padding: 0, border: "none", background: "none" }} />
        <input type="text" value={hex} aria-label="Frame color hex" style={{ ...INP_BASE, width: 100 }} onChange={(e) => setHex(e.currentTarget.value)} />
      </div>
    </Dialog>
  );
}
// ── Blur Gallery pin workspace ────────────────────────────────
// ponytail: pins live on an in-dialog preview of the document (the Dialog layer
// is modal, so the real canvas is unreachable while it's open — same pattern as
// Color Range); a non-modal Blur Gallery task space over CanvasView is the
// upgrade path.
function drawBlurPin(ctx: CanvasRenderingContext2D, kind: PinKind, p: BlurPin, s: number, sel: boolean) {
  ctx.save();
  ctx.strokeStyle = sel ? "#57a9ff" : "rgba(255,255,255,0.75)";
  ctx.fillStyle = sel ? "#57a9ff" : "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(p.x * s, p.y * s, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(p.x * s, p.y * s);
  ctx.rotate((p.rotation * Math.PI) / 180);
  ctx.beginPath();
  if (kind === 0) {
    // Field: the pin's blur-amount dial.
    ctx.arc(0, 0, 13, -Math.PI / 2, -Math.PI / 2 + p.amount * Math.PI * 2);
    ctx.stroke();
  } else if (kind === 2) {
    const f = p.focus * s;
    const L = 4000; // band lines run "infinitely" across the preview
    ctx.moveTo(-L, -f); ctx.lineTo(L, -f);
    ctx.moveTo(-L, f); ctx.lineTo(L, f);
    ctx.stroke();
    ctx.setLineDash([4, 3]);
    const o = (p.focus + p.feather) * s;
    ctx.beginPath();
    ctx.moveTo(-L, -o); ctx.lineTo(L, -o);
    ctx.moveTo(-L, o); ctx.lineTo(L, o);
    ctx.stroke();
  } else {
    const rx = Math.max(1, p.focus * s);
    const ry = Math.max(1, p.focus * p.aspect * s);
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Inner dashed ring: iris feather ring · spin full-strength ring.
    const k = kind === 1 ? p.feather : 1 - p.feather;
    if (k > 0.02) {
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * k, ry * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}
// The composited document (EngineClient.docThumbUrl) with every tool's blur
// pins drawn on top: click adds a pin of the active tool, dragging a dot moves
// it, dragging the selected pin's outline resizes/rotates. Each pin carries its
// own kind, so Field / Iris / Tilt-Shift / Spin pins coexist on one surface.
// Pure maths in blurPins.ts.
// A drawn Path Blur stroke: its flattened curve, an arrowhead marking the
// motion direction, and a dot per anchor (the end anchors carry the End Point
// Speed handles, so they read as rings).
function drawBlurPath(ctx: CanvasRenderingContext2D, p: BlurPathStroke, s: number, active: boolean) {
  const pts = samplePath(p);
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineWidth = active ? 2 : 1.5;
  ctx.strokeStyle = active ? "#8ab4ff" : "rgba(255,255,255,0.55)";
  ctx.beginPath();
  pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x * s, q.y * s) : ctx.lineTo(q.x * s, q.y * s)));
  ctx.stroke();
  // Arrowhead at the far end, along the last segment.
  const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(b.x * s, b.y * s);
  for (const turn of [Math.PI * 0.82, -Math.PI * 0.82]) {
    ctx.lineTo(b.x * s + Math.cos(ang + turn) * 9, b.y * s + Math.sin(ang + turn) * 9);
  }
  ctx.stroke();
  p.points.forEach((q, i) => {
    const end = i === 0 || i === p.points.length - 1;
    ctx.beginPath();
    ctx.arc(q.x * s, q.y * s, end ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#8ab4ff" : "rgba(0,0,0,0.55)";
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}
function PinPreviewCanvas({ tool, pins, selected, onPins, onSelect, paths, selPath, onPaths, onSelectPath, previewRev = 0 }: {
  tool: BlurTool; pins: GalleryPin[]; selected: number;
  onPins: (pins: GalleryPin[]) => void; onSelect: (index: number) => void;
  paths: BlurPathStroke[]; selPath: number;
  onPaths: (paths: BlurPathStroke[]) => void; onSelectPath: (index: number) => void;
  previewRev?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ index: number; part: "move" | "ring" } | null>(null);
  const pathDragRef = useRef<{ path: number; point: number } | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const docW = engine.engine ? engine.width : 512;
  const docH = engine.engine ? engine.height : 512;
  useEffect(() => {
    if (!engine.engine) return;
    let live = true;
    const image = new Image();
    image.onload = () => { if (live) setImg(image); };
    image.src = engine.docThumbUrl(engine.e, 380, 240);
    return () => { live = false; };
  }, [previewRev]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = img ? img.naturalWidth : 380;
    const h = img ? img.naturalHeight : Math.max(1, Math.round((380 * docH) / Math.max(1, docW)));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#1b1b1f";
    ctx.fillRect(0, 0, w, h);
    if (img) ctx.drawImage(img, 0, 0);
    const s = w / docW;
    pins.forEach((p, i) => drawBlurPin(ctx, p.kind, p, s, i === selected));
    paths.forEach((p, i) => drawBlurPath(ctx, p, s, tool === PATH_TOOL && i === selPath));
  }, [img, pins, selected, docW, docH, paths, selPath, tool]);
  const toDoc = (ev: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(docW, Math.max(0, ((ev.clientX - rect.left) * docW) / rect.width)),
      y: Math.min(docH, Math.max(0, ((ev.clientY - rect.top) * docH) / rect.height)),
      tol: (10 * docW) / rect.width, // ~10 screen px in doc units
    };
  };
  return (
    <canvas ref={canvasRef} role="img" aria-label="Blur pin workspace preview"
      onPointerDown={(ev) => {
        const { x, y, tol } = toDoc(ev);
        ev.currentTarget.setPointerCapture(ev.pointerId);
        // Path Blur owns the surface while its tool is active: grab an anchor,
        // or extend the selected path with a new one (Adobe click-to-draw).
        if (tool === PATH_TOOL) {
          const on = hitTestBlurPaths(paths, x, y, tol);
          if (on) {
            onSelectPath(on.path);
            pathDragRef.current = on;
            return;
          }
          if (paths.length === 0) {
            onPaths([{ ...defaultBlurPath(docW, docH), points: [{ x, y }, { x, y }] }]);
            onSelectPath(0);
            pathDragRef.current = { path: 0, point: 1 };
            return;
          }
          const at = Math.min(selPath, paths.length - 1);
          const pts = [...paths[at].points, { x, y }];
          onPaths(paths.map((p, i) => (i === at ? { ...p, points: pts } : p)));
          onSelectPath(at);
          pathDragRef.current = { path: at, point: pts.length - 1 };
          return;
        }
        // The ring hit-test only reads the selected pin, so its own kind drives it.
        const hit = hitTestPins(pins, pins[selected]?.kind ?? 0, selected, x, y, tol);
        if (hit) {
          onSelect(hit.index);
          dragRef.current = hit;
        } else {
          onPins([...pins, { kind: tool, ...defaultPin(tool, docW, docH, x, y) }]);
          onSelect(pins.length);
          dragRef.current = { index: pins.length, part: "move" };
        }
      }}
      onPointerMove={(ev) => {
        const pathDrag = pathDragRef.current;
        if (pathDrag) {
          const { x, y } = toDoc(ev);
          onPaths(paths.map((p, i) => i !== pathDrag.path ? p
            : { ...p, points: p.points.map((q, k) => (k === pathDrag.point ? { x, y } : q)) }));
          return;
        }
        const drag = dragRef.current;
        const target = drag && pins[drag.index];
        if (!drag || !target) return;
        const { x, y } = toDoc(ev);
        onPins(pins.map((p, i) => i !== drag.index ? p
          : drag.part === "move" ? { ...p, x, y } : { ...p, ...ringDrag(p.kind, p, x, y) }));
      }}
      onPointerUp={() => { dragRef.current = null; pathDragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; pathDragRef.current = null; }}
      style={{
        display: "block", width: "100%", height: "auto", maxHeight: 240, cursor: "crosshair", touchAction: "none",
        background: "#000", border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", borderRadius: 4,
      }} />
  );
}
// Selected-pin precision fields for the workspace's Blur Tools panel (also the
// keyboard path for pin editing — the preview itself is pointer-driven).
function PinFields({ kind, pin, docW, docH, patch, remove }: {
  kind: PinKind; pin: BlurPin; docW: number; docH: number;
  patch: (p: Partial<BlurPin>) => void; remove: () => void;
}) {
  const row = (label: string, node: ReactNode) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 76 }}>{label}</span>
      {node}
    </div>
  );
  return (
    <>
      {kind === 0 && row("Pin Amount", <NumberField value={Math.round(pin.amount * 100)} min={0} max={100}
        onChange={(v) => patch({ amount: v / 100 })} suffix="%" aria-label="Pin blur amount" />)}
      {kind !== 0 && kind !== 2 && <>
        {row("Size", <NumberField value={Math.round(pin.focus)} min={4} max={8192}
          onChange={(v) => patch({ focus: v })} suffix="px" aria-label="Ellipse size" />)}
        {row("Roundness", <NumberField value={Math.round(pin.aspect * 100)} min={15} max={150}
          onChange={(v) => patch({ aspect: v / 100 })} suffix="%" aria-label="Ellipse roundness" />)}
      </>}
      {kind === 2 && <>
        {row("Band", <NumberField value={Math.round(pin.focus)} min={4} max={8192}
          onChange={(v) => patch({ focus: v })} suffix="px" aria-label="Sharp band half-width" />)}
        {row("Feather", <NumberField value={Math.round(pin.feather)} min={1} max={8192}
          onChange={(v) => patch({ feather: v })} suffix="px" aria-label="Band feather" />)}
      </>}
      {kind === 1 && row("Feather", <NumberField value={Math.round(pin.feather * 100)} min={0} max={95}
        onChange={(v) => patch({ feather: v / 100 })} suffix="%" aria-label="Feather ring position" />)}
      {kind === 3 && row("Feather", <NumberField value={Math.round(pin.feather * 100)} min={1} max={100}
        onChange={(v) => patch({ feather: v / 100 })} suffix="%" aria-label="Edge feather" />)}
      {kind !== 0 && row("Rotation", <NumberField value={Math.round(pin.rotation)} min={-180} max={180}
        onChange={(v) => patch({ rotation: v })} suffix="°" aria-label="Pin rotation" />)}
      <div className="monet-row" style={{ gap: 10, marginBottom: 8, alignItems: "center" }}>
        <span className="lbl" style={{ width: 76 }}>Pin X · Y</span>
        <NumberField value={Math.round(pin.x)} min={0} max={docW} onChange={(v) => patch({ x: v })} aria-label="Pin X" />
        <NumberField value={Math.round(pin.y)} min={0} max={docH} onChange={(v) => patch({ y: v })} aria-label="Pin Y" />
        <Button variant="ghost" onClick={remove}>Delete Pin</Button>
      </div>
    </>
  );
}
// ── The shared Blur Gallery workspace ─────────────────────────
// Photoshop opens ONE workspace from any of the five blur menu items: Field /
// Iris / Tilt-Shift / Path / Spin pins coexist, preview together on the
// document, and Apply commits the whole set as a single "Blur Gallery" history
// step. The right rail carries Adobe's Blur Tools / Effects / Motion Effects /
// Noise panels. Step composition lives in blurGallery.ts.

// Kept as named exports here for the dialog contract tests; the implementation
// lives in the action layer so saved actions can replay the exact recipe.
export const runBlurSteps = (...args: Parameters<typeof runBlurStepsCommand>) => runBlurStepsCommand(...args);
export const commitBlurSteps = (...args: Parameters<typeof commitBlurStepsCommand>) => commitBlurStepsCommand(...args);
// One rail panel. Adobe's panels are collapsible rather than exclusive tabs, so
// all four stay on screen and the rail scrolls.
function BlurRailPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ borderTop: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", padding: "10px 0 2px" }}>
      <div className="lbl" style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {children}
    </section>
  );
}
export function BlurGallery({ tool: initialTool }: { tool: BlurTool }) {
  const { close, arg } = useDialogs();
  const docW = engine.engine ? engine.width : 512;
  const docH = engine.engine ? engine.height : 512;
  const request = arg && typeof arg === "object" ? arg as Partial<PinnedBlurEditRequest> : null;
  const restored = request && (request.fid === GALLERY_PINS_FID || request.fid === SPIN_PINS_FID)
    && Array.isArray(request.params) ? pinnedBlurState(request.fid, request.params, docW, docH) : null;
  const edit = restored && Number.isInteger(request?.docId) && Number.isInteger(request?.layerId)
    && Number.isInteger(request?.index) ? { request: request as PinnedBlurEditRequest, ...restored } : null;
  const invalidEdit = !!request && !edit;
  const activeDocId = useStore((s) => s.activeDocId);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const activeDocument = useStore((s) => s.documents.find((doc) => doc.id === s.activeDocId));
  // Pin add-mode too: a shortcut can switch tabs/layers while this modal is
  // mounted, and no preview may follow that new active target.
  const targetDocId = useRef(edit?.request.docId ?? activeDocId).current;
  const targetLayerId = useRef(edit?.request.layerId ?? activeLayerId).current;
  const targetEngine = useRef(engine.e as HistoryTransactionEngine).current;
  const wrongTarget = activeDocId !== targetDocId || activeLayerId !== targetLayerId
    || engine.engine !== targetEngine;
  const [tool, setTool] = useState<BlurTool>(edit?.tool ?? initialTool);
  const [st, setSt] = useState<BlurGalleryState>(() => edit?.state ?? defaultBlurGalleryState(initialTool, docW, docH));
  const noiseSeed = useRef(Math.floor(Math.random() * 0x100_0000)).current;
  const [selected, setSelected] = useState(0);
  // Path Blur's drawn paths + Basic Blur / Rear Sync Flash. They ride alongside
  // BlurGalleryState rather than inside it: the state object is the four-scalar
  // engine ABI, the paths are their own variable-length record array.
  const [paths, setPaths] = useState<BlurPathStroke[]>([]);
  const [selPath, setSelPath] = useState(0);
  const [rearSync, setRearSync] = useState(false);
  const pathAt = Math.min(selPath, paths.length - 1);
  const patchPath = (p: Partial<BlurPathStroke>) =>
    setPaths((ps) => ps.map((c, i) => (i === pathAt ? { ...c, ...p } : c)));
  // Drawing a path arms the tool: otherwise the first stroke previews nothing
  // and the "Enable Path Blur" checkbox reads as broken.
  const applyPaths = (ps: BlurPathStroke[]) => {
    setPaths(ps);
    if (ps.length > 0) setSt((s) => (s.pathOn ? s : { ...s, pathOn: true }));
  };
  const patch = (p: Partial<BlurGalleryState>) => setSt((s) => ({ ...s, ...p }));
  // Deleting pins can leave `selected` past the end — clamp once so the fields,
  // the edits they make and the highlighted pin never drift apart.
  const sel = Math.min(selected, st.pins.length - 1);
  const pin = st.pins[sel];
  const patchPin = (p: Partial<BlurPin>) =>
    setSt((s) => ({ ...s, pins: s.pins.map((c, i) => (i === sel ? { ...c, ...p } : c)) }));

  // Live preview on the document canvas behind the dialog, coalesced to one
  // pass + blit per frame with the costly full UI sync deferred until edits
  // settle (mirrors FilterGallery, which stacks N filters the same way).
  const stRef = useRef(st);
  stRef.current = st;
  const pathRef = useRef({ paths, rearSync });
  pathRef.current = { paths, rearSync };
  const flatPaths = () => flattenBlurPaths(pathRef.current.paths);
  const transactionRef = useRef(false);
  const [previewRev, setPreviewRev] = useState(0);
  const bumpPinPreview = () => {
    if (store.state.activeDocId !== targetDocId) return;
    setPreviewRev((n) => n + 1);
  };
  const rafRef = useRef(0);
  const settleRef = useRef<ReturnType<typeof setTimeout> | 0>(0);
  const [actionMark] = useState(() => actions.mark());
  const actionDoneRef = useRef(false);
  const onTarget = () => !invalidEdit && engine.engine === targetEngine
    && store.state.activeDocId === targetDocId && store.state.activeLayerId === targetLayerId;
  const rollbackAction = () => {
    if (actionDoneRef.current) return;
    actions.rollback(actionMark);
    actionDoneRef.current = true;
  };
  const cancelPreview = () => {
    if (!transactionRef.current) return;
    const cancelled = targetEngine.cancel_history_transaction();
    transactionRef.current = false;
    if (cancelled && engine.engine === targetEngine) {
      engine.refreshFromEngine();
      bumpPinPreview();
    }
  };
  const prepareTransaction = () => {
    if (!onTarget()) return false;
    if (transactionRef.current) {
      if (targetEngine.reset_history_transaction()) return true;
      targetEngine.cancel_history_transaction();
      transactionRef.current = false;
      return false;
    }
    const began = targetEngine.begin_history_transaction();
    transactionRef.current = began;
    return began;
  };
  const runSmartEdit = () => {
    if (!edit || !onTarget()) return;
    const filter = pinnedBlurSmartFilter(stRef.current, edit.tool);
    if (filter.fid !== edit.request.fid) return;
    smart.updateFilter(edit.request.layerId, edit.request.index, filter.fid, filter.params);
  };
  const previewNow = () => {
    if (!onTarget()) {
      cancelPreview();
      return;
    }
    if (!prepareTransaction()) return;
    actions.suspend(true);
    engine.syncSuspended = true;
    try {
      if (edit) runSmartEdit();
      else runBlurSteps(blurGallerySteps(stRef.current, noiseSeed), flatPaths(), pathRef.current.rearSync);
    }
    catch (error) { cancelPreview(); throw error; }
    finally { actions.suspend(false); engine.syncSuspended = false; }
    engine.blit(); // repaint even when the workspace composes to nothing
    bumpPinPreview();
  };
  const clearPending = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (settleRef.current) { clearTimeout(settleRef.current); settleRef.current = 0; }
  };
  useEffect(() => {
    if (!onTarget()) {
      clearPending();
      engine.syncSuspended = false;
      cancelPreview();
    }
    // `activeDocument` changes when Revert replaces the engine under the same
    // tab id; handlers also re-check identity immediately before every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId, activeLayerId, activeDocument]);
  useEffect(() => {
    if (!onTarget()) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; previewNow(); });
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => { settleRef.current = 0; engine.sync(); }, 140);
    // Mutable target/preview helpers intentionally belong to this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, paths, rearSync, activeDocId, activeLayerId]);
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (settleRef.current) clearTimeout(settleRef.current);
    engine.syncSuspended = false;
    // Dialog replacement/unmount is an implicit Cancel. The captured target
    // engine may now be inactive, so never route this through the live engine.
    cancelPreview();
    rollbackAction();
    // The captured target and mutable refs intentionally belong to this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () => {
    clearPending();
    engine.syncSuspended = false;
    cancelPreview();
    rollbackAction();
    close();
  };
  const ok = () => {
    if (invalidEdit || drawnPathUnsupported || !onTarget()) return;
    const pending = rafRef.current !== 0;
    clearPending();
    if (pending) previewNow();
    engine.syncSuspended = false;
    if (!prepareTransaction()) return; // reset preview back to the captured base
    if (edit) {
      const filter = pinnedBlurSmartFilter(stRef.current, edit.tool);
      let committed = false;
      if (filter.fid === edit.request.fid && onTarget()) {
        const changed = smart.updateFilter(edit.request.layerId, edit.request.index, filter.fid, filter.params);
        committed = changed && targetEngine.commit_history_transaction();
        if (!changed) targetEngine.cancel_history_transaction();
        else if (!committed) targetEngine.cancel_history_transaction();
        transactionRef.current = false;
        if (committed) {
          engine.commit();
          actions.commit(actionMark,
            () => { smart.updateFilter(edit.request.layerId, edit.request.index, filter.fid, filter.params); },
            ["updatePinnedBlurFilter", [edit.request.layerId, edit.request.index, filter.fid, filter.params]]);
          actionDoneRef.current = true;
        } else {
          engine.refreshFromEngine();
          rollbackAction();
        }
      }
      if (transactionRef.current) cancelPreview();
      close();
      return;
    }
    const steps = blurGallerySteps(stRef.current, noiseSeed);
    // Snapshot the paths so the recorded action replays the same geometry.
    const flat = flatPaths();
    const rear = pathRef.current.rearSync;
    if (steps.length > 0) {
      const committed = commitBlurSteps(steps, flat, rear, transactionRef.current);
      transactionRef.current = false;
      if (committed) {
        actions.commit(actionMark, () => { commitBlurSteps(steps, flat, rear); },
          ["commitBlurSteps", [steps, flat, rear]]);
        actionDoneRef.current = true;
      } else rollbackAction();
    } else {
      cancelPreview();
      rollbackAction();
    }
    close();
  };

  const row = (label: string, node: ReactNode) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
      <span className="lbl" style={{ width: 92 }}>{label}</span>
      {node}
    </div>
  );
  const pinCount = (t: BlurTool) =>
    t === PATH_TOOL ? (st.pathOn ? Math.max(1, paths.length) : 0) : st.pins.filter((p) => p.kind === t).length;
  const drawnPathUnsupported = !edit && !invalidEdit && !!engine.engine
    && !wrongTarget && engine.e.layer_kind(targetLayerId) === LAYER_KIND.smartObject
    && st.pathOn && st.pathSpeed > 0 && paths.length > 0;
  return (
    <Dialog open onClose={cancel} title="Blur Gallery" width={760}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button>
        <Button variant="primary" disabled={invalidEdit || !!drawnPathUnsupported || wrongTarget} onClick={ok}>OK</Button></>}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 340px", minWidth: 240 }}>
          <PinPreviewCanvas tool={tool} pins={st.pins} selected={sel} onSelect={setSelected}
            onPins={(pins) => setSt((s) => ({ ...s, pins }))}
            paths={paths} selPath={pathAt} onPaths={applyPaths} onSelectPath={setSelPath}
            previewRev={previewRev} />
          <div style={{ color: "var(--text-3)", fontSize: 11, margin: "6px 0 0" }}>
            {tool === PATH_TOOL
              ? "Click the preview to draw the path · click again to extend it into a curve · drag a point to reshape it. The blur follows each path; with no path it streaks the whole layer at the fallback angle."
              : "Click the preview to add a pin · drag a pin to move it · drag its outline to resize and rotate. Every tool's pins apply together."}
          </div>
          {drawnPathUnsupported && <div role="alert" style={{ color: "var(--danger, #f87171)", fontSize: 11, marginTop: 6 }}>
            Drawn Path Blur cannot be stored in a Smart Filter yet. Delete the drawn path or rasterize the Smart Object before applying.
          </div>}
          {invalidEdit && <div role="alert" style={{ color: "var(--danger, #f87171)", fontSize: 11, marginTop: 6 }}>
            This Smart Filter has an invalid pin payload and cannot be re-edited.
          </div>}
          {wrongTarget && <div role="alert" style={{ color: "var(--danger, #f87171)", fontSize: 11, marginTop: 6 }}>
            Switch back to the document and layer where Blur Gallery was opened to continue.
          </div>}
        </div>
        <div style={{ flex: "1 1 300px", minWidth: 260, maxHeight: 420, overflowY: "auto" }}>
          <BlurRailPanel title="Blur Tools">
            <div className="monet-row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {(edit ? BLUR_TOOLS.filter(({ tool: candidate }) => candidate === edit.tool) : BLUR_TOOLS).map(({ tool: t, label }) => (
                <Button key={t} variant={t === tool ? "primary" : "ghost"} aria-pressed={t === tool}
                  onClick={() => {
                    setTool(t);
                    if (t === PATH_TOOL) return;
                    const at = st.pins.findIndex((p) => p.kind === t);
                    if (at >= 0) setSelected(at);
                  }}>
                  {label}{pinCount(t) > 0 ? ` (${pinCount(t)})` : ""}
                </Button>
              ))}
            </div>
            {tool !== PATH_TOOL && tool !== 3 &&
              row("Blur", <NumberField value={st.radius} min={1} max={100} onChange={(v) => patch({ radius: v })} suffix="px" aria-label="Blur" />)}
            {tool === 3 &&
              row("Blur Angle", <NumberField value={st.spinAngle} min={1} max={90} onChange={(v) => patch({ spinAngle: v })} suffix="°" aria-label="Blur Angle" />)}
            {tool === PATH_TOOL && <>
              <div style={{ marginBottom: 8 }}>
                <Checkbox checked={st.pathOn} onChange={(v) => patch({ pathOn: v })}>Enable Path Blur</Checkbox>
              </div>
              {/* Edit Blur Shapes: the drawn paths, one row per path plus the
                  selected path's End Point Speed handles. */}
              <div className="monet-row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {paths.map((_, i) => (
                  <Button key={i} variant={i === pathAt ? "primary" : "ghost"} aria-pressed={i === pathAt}
                    onClick={() => setSelPath(i)}>{`Path ${i + 1}`}</Button>
                ))}
                <Button variant="ghost" onClick={() => { applyPaths([...paths, defaultBlurPath(docW, docH)]); setSelPath(paths.length); }}>
                  New Path
                </Button>
                {paths.length > 0 && (
                  <Button variant="ghost" onClick={() => { setPaths(paths.filter((_, i) => i !== pathAt)); setSelPath(Math.max(0, pathAt - 1)); }}>
                    Delete Path
                  </Button>
                )}
              </div>
              {paths[pathAt] ? <>
                {row("Start Speed", <NumberField value={Math.round(paths[pathAt].speedStart * 100)} min={0} max={200}
                  onChange={(v) => patchPath({ speedStart: v / 100 })} suffix="%" aria-label="End point speed at the path start" />)}
                {row("End Speed", <NumberField value={Math.round(paths[pathAt].speedEnd * 100)} min={0} max={200}
                  onChange={(v) => patchPath({ speedEnd: v / 100 })} suffix="%" aria-label="End point speed at the path end" />)}
              </> : row("Angle", <NumberField value={st.pathAngle} min={-180} max={180} onChange={(v) => patch({ pathAngle: v })} suffix="°" aria-label="Path angle" />)}
              {row("Speed", <NumberField value={st.pathSpeed} min={0} max={100} onChange={(v) => patch({ pathSpeed: v })} suffix="px" aria-label="Path speed" />)}
              {row("Taper", <NumberField value={st.pathTaper} min={0} max={100} onChange={(v) => patch({ pathTaper: v })} suffix="%" aria-label="Path taper" />)}
              <div style={{ marginBottom: 8 }}>
                <Checkbox checked={st.pathCentered} onChange={(v) => patch({ pathCentered: v })}>Centered Blur</Checkbox>
              </div>
              <div style={{ marginBottom: 8 }}>
                <Checkbox checked={rearSync} onChange={setRearSync}>Rear Sync Flash</Checkbox>
              </div>
            </>}
            {tool !== PATH_TOOL && (pin
              ? <PinFields kind={pin.kind} pin={pin} docW={docW} docH={docH} patch={patchPin}
                  remove={() => {
                    setSt((s) => ({ ...s, pins: s.pins.filter((_, i) => i !== sel) }));
                    setSelected(Math.max(0, sel - 1));
                  }} />
              : <div style={{ color: "var(--text-3)", fontSize: 11 }}>No pins yet — click the preview to place one.</div>)}
          </BlurRailPanel>
          {(!edit || edit.request.fid === GALLERY_PINS_FID) && <BlurRailPanel title="Effects">
            {row("Light Bokeh", <NumberField value={st.bokeh} min={0} max={100} onChange={(v) => patch({ bokeh: v })} suffix="%" aria-label="Light Bokeh" />)}
            {row("Bokeh Color", <NumberField value={st.bokehColor} min={0} max={100} onChange={(v) => patch({ bokehColor: v })} suffix="%" aria-label="Bokeh Color" />)}
          </BlurRailPanel>}
          {(!edit || edit.request.fid === SPIN_PINS_FID) && <BlurRailPanel title="Motion Effects">
            {row("Strobe Flashes", <NumberField value={st.strobe} min={0} max={24} onChange={(v) => patch({ strobe: v })} aria-label="Strobe Flashes" />)}
          </BlurRailPanel>}
          {!edit && <BlurRailPanel title="Noise">
            {row("Amount", <NumberField value={st.noise} min={0} max={100} onChange={(v) => patch({ noise: v })} suffix="%" aria-label="Noise amount" />)}
            <div className="monet-row" style={{ gap: 16 }}>
              <Checkbox checked={st.noiseGaussian} onChange={(v) => patch({ noiseGaussian: v })}>Gaussian</Checkbox>
              <Checkbox checked={st.noiseMono} onChange={(v) => patch({ noiseMono: v })}>Monochromatic</Checkbox>
            </div>
          </BlurRailPanel>}
        </div>
      </div>
    </Dialog>
  );
}
function ExtrudeFilter() {
  const { close } = useDialogs();
  const [size, setSize] = useState(16);
  const [depth, setDepth] = useState(60);
  const [mode, setMode] = useState("1"); // 0 random · 1 by brightness
  const [type, setType] = useState("0"); // 0 blocks · 1 pyramids
  const [solidFront, setSolidFront] = useState(true);
  const [maskIncomplete, setMaskIncomplete] = useState(false);
  return (
    <Dialog open onClose={close} title="Extrude" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.extrude(Math.round(size), depth / 100, mode === "1", +type, solidFront, maskIncomplete); close(); }}>OK</Button></>}>
      <div className="lbl" style={{ marginBottom: 6 }}>Type</div>
      <SegmentedControl value={type} onChange={setType}
        items={[{ value: "0", label: "Blocks" }, { value: "1", label: "Pyramids" }]} />
      <div className="monet-row" style={{ gap: 10, margin: "12px 0 10px" }}>
        <span className="lbl" style={{ width: 70 }}>Size</span>
        <NumberField value={size} min={2} max={255} onChange={setSize} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Depth</span>
        <NumberField value={depth} min={0} max={100} onChange={setDepth} suffix="%" />
      </div>
      <SegmentedControl value={mode} onChange={setMode}
        items={[{ value: "0", label: "Random" }, { value: "1", label: "Level-based" }]} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {type === "0" && <Checkbox checked={solidFront} onChange={setSolidFront}>Solid Front Faces</Checkbox>}
        <Checkbox checked={maskIncomplete} onChange={setMaskIncomplete}>Mask Incomplete Blocks</Checkbox>
      </div>
    </Dialog>
  );
}
function ShapeBlur() {
  const { close } = useDialogs();
  const [shape, setShape] = useState("1"); // 0 square · 1 circle
  const [radius, setRadius] = useState(8);
  return (
    <Dialog open onClose={close} title="Shape Blur" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { shape === "0" ? fil.box(Math.round(radius)) : fil.lensBlur(Math.round(radius), 0); close(); }}>OK</Button></>}>
      <div className="lbl" style={{ marginBottom: 6 }}>Shape</div>
      <SegmentedControl value={shape} onChange={setShape}
        items={[{ value: "0", label: "Square" }, { value: "1", label: "Circle" }]} />
      <div className="monet-row" style={{ gap: 10, margin: "12px 0 4px" }}>
        <span className="lbl" style={{ width: 60 }}>Radius</span>
        <NumberField value={radius} min={1} max={20} onChange={setRadius} suffix="px" />
      </div>
    </Dialog>
  );
}
function Deinterlace() {
  const { close } = useDialogs();
  const [field, setField] = useState("0"); // 0 eliminate odd · 1 eliminate even
  const [method, setMethod] = useState("1"); // 0 duplicate · 1 interpolate
  return (
    <Dialog open onClose={close} title="De-Interlace" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.deinterlace(field === "0", method === "1"); close(); }}>OK</Button></>}>
      <div className="lbl" style={{ marginBottom: 6 }}>Eliminate</div>
      <SegmentedControl value={field} onChange={setField}
        items={[{ value: "0", label: "Odd Fields" }, { value: "1", label: "Even Fields" }]} />
      <div className="lbl" style={{ margin: "12px 0 6px" }}>Create New Fields by</div>
      <SegmentedControl value={method} onChange={setMethod}
        items={[{ value: "0", label: "Duplication" }, { value: "1", label: "Interpolation" }]} />
    </Dialog>
  );
}
const MEZZOTINT_TYPES = ["Fine Dots", "Medium Dots", "Coarse Dots", "Horizontal Lines", "Vertical Lines"];
function Mezzotint() {
  const { close } = useDialogs();
  const [kind, setKind] = useState(0);
  return (
    <Dialog open onClose={close} title="Mezzotint" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.mezzotint(kind); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 48 }}>Type</span>
        <Select value={String(kind)} onChange={(v) => setKind(+v)}
          options={MEZZOTINT_TYPES.map((l, i) => ({ value: String(i), label: l }))} />
      </div>
    </Dialog>
  );
}
function HsbHsl() {
  const { close } = useDialogs();
  const [mode, setMode] = useState("0"); // 0 HSB · 1 HSL
  return (
    <Dialog open onClose={close} title="HSB/HSL" width={320}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.hsbHsl(+mode); close(); }}>OK</Button></>}>
      <div className="lbl" style={{ marginBottom: 6 }}>Reinterpret as</div>
      <SegmentedControl value={mode} onChange={setMode}
        items={[{ value: "0", label: "HSB" }, { value: "1", label: "HSL" }]} />
    </Dialog>
  );
}
function ReduceNoise() {
  const { close } = useDialogs();
  const [strength, setStrength] = useState(60);
  const [preserveDetails, setPreserveDetails] = useState(0);
  const [reduceColor, setReduceColor] = useState(0);
  const [sharpenDetails, setSharpenDetails] = useState(0);
  return (
    <Dialog open onClose={close} title="Reduce Noise" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.reduceNoise(strength / 100, reduceColor / 100, preserveDetails / 100, sharpenDetails / 100); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 130 }}>Strength</span>
        <NumberField value={strength} min={0} max={100} onChange={setStrength} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 130 }}>Preserve Details</span>
        <NumberField value={preserveDetails} min={0} max={100} onChange={setPreserveDetails} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 130 }}>Reduce Color Noise</span>
        <NumberField value={reduceColor} min={0} max={100} onChange={setReduceColor} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 130 }}>Sharpen Details</span>
        <NumberField value={sharpenDetails} min={0} max={100} onChange={setSharpenDetails} suffix="%" />
      </div>
    </Dialog>
  );
}
function Deblock() {
  const { close } = useDialogs();
  const [strength, setStrength] = useState(70);
  return (
    <Dialog open onClose={close} title="JPEG Artifacts Removal" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.deblock(strength / 100); close(); }}>OK</Button></>}>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 8 }}>Softens the 8×8 block seams left by JPEG compression.</div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 90 }}>Strength</span>
        <NumberField value={strength} min={0} max={100} onChange={setStrength} suffix="%" />
      </div>
    </Dialog>
  );
}
function ShakeReduction() {
  const { close } = useDialogs();
  const [radius, setRadius] = useState(3);
  const [iterations, setIterations] = useState(15);
  return (
    <Dialog open onClose={close} title="Shake Reduction" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.shakeReduction(Math.round(radius), Math.round(iterations)); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Blur Size</span>
        <NumberField value={radius} min={1} max={10} onChange={setRadius} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 90 }}>Smoothing</span>
        <NumberField value={iterations} min={1} max={30} onChange={setIterations} />
      </div>
    </Dialog>
  );
}
function SmartSharpen() {
  const { close } = useDialogs();
  const [amount, setAmount] = useState(150);
  const [radius, setRadius] = useState(3);
  const [reduceNoise, setReduceNoise] = useState(20);
  const [remove, setRemove] = useState(0); // 0 Gaussian, 1 Lens, 2 Motion
  const [angle, setAngle] = useState(0);
  const [shadowFade, setShadowFade] = useState(0);
  const [highlightFade, setHighlightFade] = useState(0);
  return (
    <Dialog open onClose={close} title="Smart Sharpen" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.smartSharpen(amount / 100, radius, reduceNoise / 100, remove, angle, shadowFade / 100, highlightFade / 100); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Amount</span>
        <NumberField value={amount} min={0} max={500} onChange={setAmount} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Radius</span>
        <NumberField value={radius} min={1} max={50} onChange={setRadius} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Reduce Noise</span>
        <NumberField value={reduceNoise} min={0} max={100} onChange={setReduceNoise} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: remove === 2 ? 10 : 4 }}>
        <span className="lbl" style={{ width: 110 }}>Remove</span>
        <Select value={String(remove)} onChange={(v) => setRemove(+v)}
          options={[{ value: "0", label: "Gaussian Blur" }, { value: "1", label: "Lens Blur" }, { value: "2", label: "Motion Blur" }]} />
      </div>
      {remove === 2 && (
        <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
          <span className="lbl" style={{ width: 110 }}>Angle</span>
          <NumberField value={angle} min={-180} max={180} onChange={setAngle} suffix="°" />
        </div>
      )}
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 110 }}>Shadow Fade</span>
        <NumberField value={shadowFade} min={0} max={100} onChange={setShadowFade} suffix="%" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 110 }}>Highlight Fade</span>
        <NumberField value={highlightFade} min={0} max={100} onChange={setHighlightFade} suffix="%" />
      </div>
    </Dialog>
  );
}
function LensBlur() {
  const { close } = useDialogs();
  const [radius, setRadius] = useState(8);
  const [brightness, setBrightness] = useState(0);
  return (
    <Dialog open onClose={close} title="Lens Blur" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.lensBlur(Math.round(radius), brightness / 100); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Radius</span>
        <NumberField value={radius} min={1} max={20} onChange={setRadius} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 90 }}>Brightness</span>
        <NumberField value={brightness} min={0} max={100} onChange={setBrightness} suffix="%" />
      </div>
    </Dialog>
  );
}
function SmartBlur() {
  const { close } = useDialogs();
  const [radius, setRadius] = useState(3);
  const [threshold, setThreshold] = useState(25);
  const [mode, setMode] = useState("0"); // 0 normal · 1 edge only · 2 overlay edge
  const [quality, setQuality] = useState("1"); // 0 low · 1 medium · 2 high
  return (
    <Dialog open onClose={close} title="Smart Blur" width={360}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.smartBlur(Math.round(radius), threshold, +mode, +quality); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Radius</span>
        <NumberField value={radius} min={1} max={100} onChange={setRadius} suffix="px" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 70 }}>Threshold</span>
        <NumberField value={threshold} min={1} max={255} onChange={setThreshold} suffix="levels" />
      </div>
      <div className="lbl" style={{ margin: "4px 0 6px" }}>Mode</div>
      <SegmentedControl value={mode} onChange={setMode}
        items={[{ value: "0", label: "Normal" }, { value: "1", label: "Edge Only" }, { value: "2", label: "Overlay Edge" }]} />
      <div className="lbl" style={{ margin: "10px 0 6px" }}>Quality</div>
      <SegmentedControl value={quality} onChange={setQuality}
        items={[{ value: "0", label: "Low" }, { value: "1", label: "Medium" }, { value: "2", label: "High" }]} />
    </Dialog>
  );
}
function CustomFilter() {
  const { close } = useDialogs();
  const ident = () => { const k = Array(25).fill(0); k[12] = 1; return k; };
  const [kernel, setKernel] = useState<number[]>(ident);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState(0);
  const cellStyle = { width: 38, height: 26, fontSize: 11, padding: "0 2px", textAlign: "center" as const, borderRadius: 4, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-1)" };
  return (
    <Dialog open onClose={close} title="Custom" width={300}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { fil.custom(kernel, scale, offset); close(); }}>OK</Button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 38px)", gap: 4, marginBottom: 12 }}>
        {kernel.map((v, i) => (
          <input key={i} type="number" value={v} aria-label={`k${i}`} style={cellStyle}
            onChange={(e) => { const n = [...kernel]; n[i] = Number(e.currentTarget.value) || 0; setKernel(n); }} />
        ))}
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 50 }}>Scale</span>
        <input type="number" value={scale} aria-label="Scale" style={{ ...cellStyle, width: 70 }}
          onChange={(e) => setScale(Number(e.currentTarget.value) || 1)} />
      </div>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 50 }}>Offset</span>
        <input type="number" value={offset} aria-label="Offset" style={{ ...cellStyle, width: 70 }}
          onChange={(e) => setOffset(Number(e.currentTarget.value) || 0)} />
      </div>
    </Dialog>
  );
}
function SmoothSelection() {
  const { close } = useDialogs();
  const [r, setR] = useState(5);
  return (
    <Dialog open onClose={close} title="Smooth Selection" width={320}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { store.smoothSelection(r); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Sample Radius</span>
        <NumberField value={r} min={1} max={100} onChange={setR} suffix="px" />
      </div>
    </Dialog>
  );
}
function BorderSelection() {
  const { close } = useDialogs();
  const [w, setW] = useState(6);
  return (
    <Dialog open onClose={close} title="Border Selection" width={320}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { store.borderSelection(w); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Width</span>
        <NumberField value={w} min={1} max={200} onChange={setW} suffix="px" />
      </div>
    </Dialog>
  );
}
function FeatherSelection() {
  const { close } = useDialogs();
  const [r, setR] = useState(5);
  return (
    <Dialog open onClose={close} title="Feather Selection" width={320}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => { store.featherSelection(r); close(); }}>OK</Button></>}>
      <div className="monet-row" style={{ gap: 10 }}>
        <span className="lbl" style={{ width: 90 }}>Feather Radius</span>
        <NumberField value={r} min={1} max={250} onChange={setR} suffix="px" />
      </div>
    </Dialog>
  );
}
// Select ▸ Select and Mask — the workspace: a live doc-resolution preview with
// Photoshop's seven View modes + View opacity, the Refine Edge Brush painted
// directly on the preview, Edge Detection (Radius + Smart Radius), the Global
// Refinements (Smooth / Feather / Contrast / Shift Edge), and Output To.
// The refine pipeline runs in the engine (select_and_mask_preview — pure, the
// live selection is untouched until OK); the View compositor is
// state/selectAndMask.ts. Photoshop's left rail also carries selection tools so
// the selection can be built and corrected without leaving the workspace: Quick
// Selection and a plain add/subtract Brush do that here, writing the LIVE
// selection through the same engine ops the canvas tools use, so the refine pass
// always runs against what the preview shows.
// Photoshop's Object Aware refine mode is model-backed; only Color Aware (the
// guided-filter matte in selection.rs) is implemented, so no Refine Mode picker
// is offered rather than shipping a control with one real entry.
type SamTool = "refine" | "quick" | "brush" | "lasso" | "polylasso" | "hand";
const SAM_TOOLS: { value: SamTool; label: string }[] = [
  { value: "refine", label: "Refine Edge" },
  { value: "quick", label: "Quick Selection" },
  { value: "brush", label: "Brush" },
  { value: "lasso", label: "Lasso" },
  { value: "polylasso", label: "Poly Lasso" },
  { value: "hand", label: "Hand" },
];
const SAM_TOOL_HINTS: Record<SamTool, string> = {
  refine: "Paint over hair / fur edges to force edge matting there — works even with Radius 0.",
  quick: "Drag to grow the selection into similar neighbouring pixels, Erase to take it back.",
  brush: "Drag to add the brushed area to the selection outright, Erase to remove it.",
  lasso: "Drag a freehand outline; release to close it. Erase (−) subtracts it instead.",
  polylasso: "Click to drop corners; click the first point again, or double-click, to close.",
  hand: "Drag to pan the zoomed preview.",
};
const SAM_SETTINGS_KEY = "mv.selectAndMask";
function loadSamSettings(): SamSettings {
  try {
    return normalizeSamSettings(JSON.parse(localStorage.getItem(SAM_SETTINGS_KEY) ?? "{}"));
  } catch { return SAM_DEFAULTS; }
}
function saveSamSettings(next: SamSettings) {
  try { localStorage.setItem(SAM_SETTINGS_KEY, JSON.stringify(next)); } catch { /* storage denied */ }
}
function SelectAndMask() {
  const { close } = useDialogs();
  const activeDocId = useStore((s) => s.activeDocId);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const activeDocument = useStore((s) => s.documents.find((d) => d.id === s.activeDocId));
  const targetDocId = useRef(activeDocId).current;
  const targetLayerId = useRef(activeLayerId).current;
  const targetEngine = useRef(engine.e as HistoryTransactionEngine).current;
  const docW = useRef(engine.engine ? engine.width : 0).current;
  const docH = useRef(engine.engine ? engine.height : 0).current;
  const [openingSelection] = useState<Uint8Array | null>(() => {
    const mask = engine.selectionMask();
    return mask ? Uint8Array.from(mask) : null;
  });
  const transactionRef = useRef(false);
  const doneRef = useRef(false);
  const invalidRef = useRef(false);
  const [actionMark] = useState(() => actions.mark());
  const actionDoneRef = useRef(false);
  const onTarget = () => !invalidRef.current && engine.engine === targetEngine
    && store.state.activeDocId === targetDocId && store.state.activeLayerId === targetLayerId;
  const wrongTarget = !onTarget();
  const rollbackAction = () => {
    if (actionDoneRef.current) return;
    actions.rollback(actionMark);
    actionDoneRef.current = true;
  };
  const rollback = () => {
    if (transactionRef.current) {
      const cancelled = targetEngine.cancel_history_transaction();
      transactionRef.current = false;
      if (cancelled && engine.engine === targetEngine) engine.refreshFromEngine();
    }
    rollbackAction();
  };
  const cancel = () => {
    doneRef.current = true;
    rollback();
    close();
  };
  // Re-read per selection edit: the workspace's own tools build and correct the
  // live selection, so OK enables (and the preview appears) without a round-trip
  // to the canvas.
  const [selGen, setSelGen] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- selGen is the cache key (has_selection reads live engine state).
  const hasSel = useMemo(() => onTarget() && targetEngine.has_selection(), [selGen, activeDocId, activeLayerId, activeDocument]);
  // Stable pre-workspace composite: the backdrop every View mode renders over.
  const composite = useMemo(() => (engine.engine ? engine.outputCopy() : null), []);
  // Photoshop's "Remember Settings": the panel reopens where it was left.
  const [remembered] = useState(() => loadSamSettings());
  const [view, setView] = useState<SamViewMode>(remembered.view);
  const [viewOpacity, setViewOpacity] = useState(remembered.viewOpacity);
  const [radius, setRadius] = useState(remembered.radius);
  const [smartRadius, setSmartRadius] = useState(remembered.smartRadius);
  const [smooth, setSmooth] = useState(remembered.smooth);
  const [feather, setFeather] = useState(remembered.feather);
  const [contrast, setContrast] = useState(remembered.contrast); // % in the UI, 0..1 to the engine
  const [shift, setShift] = useState(remembered.shift);
  const [decontaminate, setDecontaminate] = useState(remembered.decontaminate);
  const [decontaminateAmount, setDecontaminateAmount] = useState(remembered.decontaminateAmount);
  const [output, setOutput] = useState<SamOutput>(remembered.output);
  // Preview navigation. The canvas is rendered at document resolution and CSS
  // scaled, so pointer maths keeps working off its own bounding rect.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const lassoRef = useRef<number[]>([]);
  const [lassoPts, setLassoPts] = useState<number[]>([]);
  useEffect(() => {
    saveSamSettings({
      view, viewOpacity, radius, smartRadius, smooth, feather, contrast, shift,
      decontaminate, decontaminateAmount, output,
    });
  }, [view, viewOpacity, radius, smartRadius, smooth, feather, contrast, shift, decontaminate, decontaminateAmount, output]);
  const [tool, setTool] = useState<SamTool>("refine");
  const [brushMode, setBrushMode] = useState<"refine" | "erase">("refine");
  const [brushSize, setBrushSize] = useState(40);
  const [strokeGen, setStrokeGen] = useState(0); // bumped per dab → re-preview
  const strokeRef = useRef<Uint8Array>(new Uint8Array(docW * docH));
  // The Brush tool's pending stroke region, flushed into the selection on
  // release so a drag is ONE history step, not one per dab (select_ellipse and
  // set_selection_mask both push their own undo state).
  const brushRef = useRef<Uint8Array>(new Uint8Array(docW * docH));
  const paintingRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const params: SamParams = { radius, smartRadius, smooth, feather, contrast: contrast / 100, shift };

  useEffect(() => {
    if (!onTarget() || !targetEngine.begin_history_transaction()) {
      invalidRef.current = true;
      doneRef.current = true;
      rollbackAction();
      close();
      return;
    }
    transactionRef.current = true;
    return () => { if (!doneRef.current) rollback(); };
    // Captured target + cleanup functions intentionally belong to this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (transactionRef.current && !onTarget()) {
      invalidRef.current = true;
      cancel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId, activeLayerId, activeDocument]);

  // Live preview: recompute the refined coverage in the engine (debounced —
  // the guided-filter matte is full-res) and composite the active View mode.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!transactionRef.current || !onTarget()) return;
      const canvas = canvasRef.current;
      if (!canvas || !composite || !docW) return;
      canvas.width = docW;
      canvas.height = docH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      let cov = hasSel ? store.selectAndMaskPreview(params, strokeRef.current) : new Uint8Array(0);
      // The Brush's un-flushed stroke, so the drag is visible before release.
      if (tool === "brush" && paintingRef.current) {
        if (!cov.length) cov = new Uint8Array(docW * docH);
        const v = brushMode === "refine" ? 255 : 0;
        for (let i = 0; i < brushRef.current.length; i++) if (brushRef.current[i]) cov[i] = v;
      }
      const img = ctx.createImageData(docW, docH);
      renderSamView(view, viewOpacity, docW, docH, composite, cov.length ? cov : null, img.data);
      ctx.putImageData(img, 0, 0);
      // The lasso outline is drawn over the composited view, not into it, so it
      // disappears the moment the selection it describes is committed.
      if (lassoPts.length >= 4) {
        ctx.save();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(1, 1 / zoom);
        ctx.setLineDash([4 / zoom, 3 / zoom]);
        ctx.beginPath();
        ctx.moveTo(lassoPts[0], lassoPts[1]);
        for (let k = 2; k < lassoPts.length; k += 2) ctx.lineTo(lassoPts[k], lassoPts[k + 1]);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }, 90);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius, smartRadius, smooth, feather, contrast, shift, view, viewOpacity, strokeGen, selGen, hasSel, composite, docW, docH, lassoPts, zoom]);

  // One dab of the active tool under the pointer. Refine Edge paints the
  // workspace's own stroke region (the refine pass reads it); Quick Selection
  // and Brush edit the live selection. `first` starts a stroke.
  const docXY = (ev: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) * docW) / rect.width,
      y: ((ev.clientY - rect.top) * docH) / rect.height,
    };
  };
  const lassoDown = (ev: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const { x, y } = docXY(ev);
    // Freehand starts a fresh outline; the polygonal one keeps dropping corners
    // until it is closed, so a click only appends.
    if (tool === "lasso" || !lassoRef.current.length) lassoRef.current = [x, y];
    else lassoRef.current.push(x, y);
    setLassoPts(lassoRef.current.slice());
  };
  const lassoMove = (ev: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const { x, y } = docXY(ev);
    const pts = lassoRef.current;
    if (Math.hypot(x - pts[pts.length - 2], y - pts[pts.length - 1]) > 2) {
      pts.push(x, y);
      setLassoPts(pts.slice());
    }
  };
  const closeLasso = () => {
    const pts = lassoRef.current;
    lassoRef.current = [];
    setLassoPts([]);
    if (pts.length < 6 || !onTarget()) return;
    const n = pts.length / 2;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    for (let i = 0; i < n; i++) { xs[i] = pts[i * 2]; ys[i] = pts[i * 2 + 1]; }
    // The rail's own +/− decides the combine mode, like its sibling tools.
    engine.e.set_selection_antialias(store.state.antiAlias);
    engine.e.select_polygon(xs, ys, brushMode === "refine" ? 1 : 2);
    engine.sync();
    setSelGen((g) => g + 1);
  };
  const dab = (ev: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }, first: boolean) => {
    if (!onTarget()) { cancel(); return; }
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) * docW) / rect.width;
    const y = ((ev.clientY - rect.top) * docH) / rect.height;
    const add = brushMode === "refine";
    if (tool === "refine") {
      stampSamBrush(strokeRef.current, docW, docH, x, y, brushSize / 2, add);
      setStrokeGen((g) => g + 1);
      return;
    }
    if (tool === "quick") {
      // Straight to the engine: store.quickSelectionAt starts a NEW selection on
      // the first dab when the canvas options bar says Mode = New, and this rail
      // has its own explicit +/− instead. Radius follows the workspace Size.
      engine.e.quick_selection(
        Math.round(x), Math.round(y), Math.max(1, Math.round(brushSize / 2)),
        store.state.quickSelectionTolerance, add ? 1 : 2, first,
        store.state.quickSelectionSampleAll, store.state.quickSelectionAutoEnhance,
      );
      engine.sync();
      setSelGen((g) => g + 1);
      return;
    }
    stampSamBrush(brushRef.current, docW, docH, x, y, brushSize / 2, true);
    setStrokeGen((g) => g + 1);
  };
  // Flush the Brush stroke into the live selection: brushed pixels become fully
  // selected (Erase: fully deselected) in one op. With nothing selected yet the
  // stroke starts a selection from scratch, the way Photoshop's does.
  const endStroke = () => {
    paintingRef.current = false;
    if (!onTarget()) { cancel(); return; }
    if (tool !== "brush") return;
    const region = brushRef.current;
    const base = engine.selectionMask();
    const add = brushMode === "refine";
    if (!base && !add) { region.fill(0); return; } // erasing from nothing
    const mask = base ? Uint8Array.from(base) : new Uint8Array(region.length);
    let touched = false;
    for (let i = 0; i < region.length; i++) {
      if (!region[i]) continue;
      touched = true;
      region[i] = 0;
      mask[i] = add ? 255 : 0;
    }
    if (!touched) return;
    engine.e.set_selection_mask(mask);
    engine.sync();
    setSelGen((g) => g + 1);
  };
  const finish = () => {
    if (paintingRef.current) endStroke();
    if (!onTarget()) { cancel(); return; }
    const finalSelection = engine.selectionMask();
    if (!finalSelection) { cancel(); return; }
    const finalMask = Uint8Array.from(finalSelection);
    const stroke = Uint8Array.from(strokeRef.current);
    const strokeChanged = stroke.some(Boolean);
    const selectionUnchanged = openingSelection?.length === finalMask.length
      && finalMask.every((value, i) => value === openingSelection[i]);
    const noRefinement = radius === 0 && !smartRadius && smooth === 0 && feather === 0
      && contrast === 0 && shift === 0 && !strokeChanged
      && output === "selection" && !decontaminate;
    doneRef.current = true;
    rollback(); // discard scratch selection edits before the one-step commit
    if (!selectionUnchanged || !noRefinement) {
      const apply = () => store.selectAndMask(params, stroke, output, decontaminate ? decontaminateAmount : 0, finalMask);
      if (!apply()) {
        actions.rollback(actionMark);
      } else if (selectionUnchanged && !strokeChanged) {
        actions.commit(actionMark,
          () => store.selectAndMask(params, new Uint8Array(engine.width * engine.height), output, decontaminate),
          ["selectAndMask", [params, output, decontaminate]]);
      } else {
        // Painted selection/refine masks are document-sized. Keep exact replay
        // in this session without pretending they fit the portable action cap.
        actions.commit(actionMark, apply, null);
      }
    }
    close();
  };
  const row = (label: string, node: ReactNode) => (
    <div className="monet-row" style={{ gap: 10, marginBottom: 6 }}>
      <span className="lbl" style={{ width: 78 }}>{label}</span>
      {node}
    </div>
  );
  const section = (label: string) => (
    <div style={{ fontSize: 11, color: "var(--text-3)", margin: "10px 0 6px" }}>{label}</div>
  );
  return (
    <Dialog open onClose={cancel} title="Select and Mask" width={880}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button>
        <Button variant="primary" disabled={!hasSel || wrongTarget} onClick={finish}>OK</Button></>}>
      <div style={{ display: "flex", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {!hasSel && (
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>
              No active selection — build one right here with Quick Selection or the Brush, or make one
              with the canvas tools first; the workspace refines it live.
            </div>
          )}
          <div style={{
            maxHeight: 430, overflow: "hidden", position: "relative",
            border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", borderRadius: 4, background: "#000",
          }}>
          <canvas ref={canvasRef} role="img" aria-label="Select and Mask live preview"
            onPointerDown={(ev) => {
              // The Refine Edge Brush needs an edge to refine; the selection
              // tools are how a missing selection gets built.
              if (!hasSel && tool === "refine") return;
              ev.currentTarget.setPointerCapture(ev.pointerId);
              if (tool === "hand") {
                panRef.current = { x: pan.x, y: pan.y, px: ev.clientX, py: ev.clientY };
                return;
              }
              if (tool === "lasso" || tool === "polylasso") { lassoDown(ev); return; }
              paintingRef.current = true;
              dab(ev, true);
            }}
            onPointerMove={(ev) => {
              if (panRef.current) {
                const p = panRef.current;
                setPan({ x: p.x + (ev.clientX - p.px), y: p.y + (ev.clientY - p.py) });
                return;
              }
              if (tool === "lasso" && lassoRef.current.length) { lassoMove(ev); return; }
              if (paintingRef.current) dab(ev, false);
            }}
            onPointerUp={() => {
              if (panRef.current) { panRef.current = null; return; }
              if (tool === "lasso") { closeLasso(); return; }
              endStroke();
            }}
            onDoubleClick={() => { if (tool === "polylasso") closeLasso(); }}
            onPointerCancel={() => { panRef.current = null; endStroke(); }}
            style={{
              display: "block", width: `${zoom * 100}%`, height: "auto", objectFit: "contain",
              transform: `translate(${pan.x}px, ${pan.y}px)`, transformOrigin: "top left",
              cursor: tool === "hand" ? "grab" : hasSel || tool !== "refine" ? "crosshair" : "default",
              touchAction: "none", background: "#000",
            }} />
          </div>
          <div className="monet-row" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
            <span className="lbl">Zoom</span>
            <Button size="sm" variant="ghost" aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(1, +(z / 1.5).toFixed(3)))}>−</Button>
            <span className="lbl" style={{ minWidth: 46, fontVariantNumeric: "tabular-nums" }}>{Math.round(zoom * 100)}%</span>
            <Button size="sm" variant="ghost" aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(16, +(z * 1.5).toFixed(3)))}>+</Button>
            <Button size="sm" variant="ghost" aria-label="Fit preview"
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit</Button>
          </div>
          <div className="monet-row" style={{ gap: 10, marginTop: 8, alignItems: "center" }}>
            <span className="lbl">Tool</span>
            <SegmentedControl value={tool} onChange={(v) => setTool(v as SamTool)} aria-label="Workspace tool"
              items={SAM_TOOLS.map(({ value, label }) => ({ value, label }))} />
            <SegmentedControl value={brushMode} onChange={(v) => setBrushMode(v as "refine" | "erase")}
              aria-label="Brush mode"
              items={[{ value: "refine", label: tool === "refine" ? "Refine (+)" : "Add (+)" }, { value: "erase", label: "Erase (−)" }]} />
            <span className="lbl">Size</span>
            <NumberField value={brushSize} min={4} max={400} onChange={setBrushSize} suffix="px" aria-label="Refine Edge Brush size" />
          </div>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
            {SAM_TOOL_HINTS[tool]}
          </div>
        </div>
        <div style={{ width: 250, flexShrink: 0 }}>
          {section("View Mode")}
          {row("View", <Select value={view} onChange={(v) => setView(v as SamViewMode)}
            options={SAM_VIEW_MODES.map(({ value, label }) => ({ value, label }))} aria-label="View mode" />)}
          {row("Opacity", <Slider min={0} max={1} step={0.01} value={viewOpacity} onChange={setViewOpacity}
            aria-label="View opacity" style={{ flex: 1 }} />)}
          {section("Edge Detection")}
          {row("Radius", <NumberField value={radius} min={0} max={100} onChange={setRadius} suffix="px" />)}
          <Checkbox checked={smartRadius} onChange={setSmartRadius}>Smart Radius</Checkbox>
          {section("Global Refinements")}
          {row("Smooth", <NumberField value={smooth} min={0} max={100} onChange={setSmooth} suffix="px" />)}
          {row("Feather", <NumberField value={feather} min={0} max={250} onChange={setFeather} suffix="px" />)}
          {row("Contrast", <NumberField value={contrast} min={0} max={100} onChange={setContrast} suffix="%" />)}
          {row("Shift Edge", <NumberField value={shift} min={-100} max={100} onChange={setShift} suffix="px" />)}
          {section("Output Settings")}
          <div style={{ marginBottom: 6 }}>
            <Checkbox checked={decontaminate} onChange={setDecontaminate}>Decontaminate Colors</Checkbox>
          </div>
          {decontaminate && row("Amount", <Slider min={0} max={1} step={0.01} value={decontaminateAmount}
            onChange={setDecontaminateAmount} aria-label="Decontaminate amount" style={{ flex: 1 }} />)}
          {row("Output To", <Select value={output} onChange={(v) => setOutput(v as SamOutput)}
            options={SAM_OUTPUTS.map(({ value, label }) => ({ value, label }))} aria-label="Output to" />)}
        </div>
      </div>
    </Dialog>
  );
}
function CanvasSize() {
  const { close } = useDialogs();
  // Current size, captured at open (constant until close).
  const ow = store.state.doc.width, oh = store.state.doc.height;
  const resolutionPpi = store.state.resolutionPpi;
  const [unit, setUnit] = useState<DocumentSizeUnit>(loadRulerUnit); // Preferences ▸ Units & Rulers
  const [w, setW] = useState(() => convertDocumentLength(ow, "px", unit, resolutionPpi));
  const [h, setH] = useState(() => convertDocumentLength(oh, "px", unit, resolutionPpi));
  const [rel, setRel] = useState(false); // Relative: W/H are deltas added to the current size
  const [col, setCol] = useState<AnchorPos>(1); const [row, setRow] = useState<AnchorPos>(1); // anchor (default centre)
  const [ext, setExt] = useState<ExtensionColor>("none"); const [extColor, setExtColor] = useState("#ffffff");
  // Photoshop zeroes the fields when entering Relative; restore the current size on exit.
  const unitDef = DOCUMENT_SIZE_UNITS.find((candidate) => candidate.value === unit)!;
  const precision = documentSizePrecision(unit, resolutionPpi);
  const fieldMin = convertDocumentLength(rel ? -8192 : 1, "px", unit, resolutionPpi);
  const fieldMax = convertDocumentLength(8192, "px", unit, resolutionPpi);
  const pickUnit = (value: string) => {
    const next = value as DocumentSizeUnit;
    setW((current) => convertDocumentLength(current, unit, next, resolutionPpi));
    setH((current) => convertDocumentLength(current, unit, next, resolutionPpi));
    setUnit(next);
  };
  const toggleRel = (v: boolean) => {
    setRel(v);
    if (v) { setW(0); setH(0); }
    else {
      setW(convertDocumentLength(ow, "px", unit, resolutionPpi));
      setH(convertDocumentLength(oh, "px", unit, resolutionPpi));
    }
  };
  const size = resolveCanvasSize(
    ow,
    oh,
    convertDocumentLength(w, unit, "px", resolutionPpi),
    convertDocumentLength(h, unit, "px", resolutionPpi),
    rel,
  );
  const oversized = !canvasSizeFits(size.w, size.h);
  const apply = () => {
    if (oversized) return;
    const off = anchorOffset(ow, oh, size.w, size.h, col, row);
    const fg = hsvToRgba(store.state.fg), bg = hsvToRgba(store.state.bg);
    const rgba = resolveExtensionColor(ext, [fg[0], fg[1], fg[2]], [bg[0], bg[1], bg[2]], extColor);
    if (rgba[3] === 0) xform.resizeCanvas(size.w, size.h, off.dx, off.dy); // transparent = plain resize
    else xform.resizeCanvasFilled(size.w, size.h, off.dx, off.dy, rgba);
    close();
  };
  return (
    <Dialog open onClose={close} title="Canvas Size" width={340}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={oversized} onClick={apply}>Apply</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Width</span>
        <div style={{ flex: 1 }}><NumberField id="mv-canvas-w" aria-label="Width" value={w}
          min={fieldMin} max={fieldMax} step={unitDef.step} precision={precision} onChange={setW} suffix={unitDef.suffix} block /></div>
        <div style={{ width: 104 }}><Select id="mv-canvas-w-unit" aria-label="Width unit" value={unit} onChange={pickUnit}
          options={DOCUMENT_SIZE_UNITS.map((candidate) => ({ value: candidate.value, label: candidate.label }))} block /></div>
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="lbl" style={{ width: 60 }}>Height</span>
        <div style={{ flex: 1 }}><NumberField id="mv-canvas-h" aria-label="Height" value={h}
          min={fieldMin} max={fieldMax} step={unitDef.step} precision={precision} onChange={setH} suffix={unitDef.suffix} block /></div>
        <div style={{ width: 104 }}><Select id="mv-canvas-h-unit" aria-label="Height unit" value={unit} onChange={pickUnit}
          options={DOCUMENT_SIZE_UNITS.map((candidate) => ({ value: candidate.value, label: candidate.label }))} block /></div>
      </div>
      <Checkbox id="mv-canvas-relative" checked={rel} onChange={toggleRel}>Relative</Checkbox>
      {oversized && <p role="alert" style={{ margin: "8px 0 0", color: "var(--danger, #ff6b6b)", fontSize: 11 }}>
        The requested canvas exceeds the document image-size limit.
      </p>}
      <div className="lbl" style={{ margin: "12px 0 6px" }}>Anchor</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 28px)", gap: 4 }}>
        {([0, 1, 2] as const).flatMap((r) => ([0, 1, 2] as const).map((c) => {
          const sel = c === col && r === row;
          return (
            <button key={`${c}-${r}`} type="button" data-mv-anchor={`${c}-${r}`} aria-pressed={sel}
              aria-label={`Anchor ${c}-${r}`} onClick={() => { setCol(c); setRow(r); }}
              style={{ width: 28, height: 28, borderRadius: 4, cursor: "pointer",
                border: `1px solid ${sel ? "var(--accent, #4a9eff)" : "var(--line)"}`,
                background: sel ? "var(--accent, #4a9eff)" : "var(--bg-2)" }} />
          );
        }))}
      </div>
      <div className="monet-row" style={{ gap: 10, margin: "12px 0 0" }}>
        <span className="lbl" style={{ width: 60 }}>Extension</span>
        <Select id="mv-canvas-extension" value={ext} aria-label="Canvas extension color" style={{ flex: 1 }}
          onChange={(v) => setExt(v as ExtensionColor)} options={EXTENSION_COLORS} />
        {ext === "other" && (
          <input type="color" id="mv-canvas-extcolor" value={extColor} aria-label="Extension colour"
            onChange={(e) => setExtColor(e.currentTarget.value)} />
        )}
      </div>
    </Dialog>
  );
}

// Run state lives outside the component: a RAW input without Suppress File
// Open Options Dialogs swaps the single dialog slot to Camera Raw and back,
// remounting this dialog mid-run, and progress, Cancel and the report must
// survive that.
let batchRun: { abort: AbortController | null; status: string; error?: string } | null = null;
let batchMounted = false;

function BatchDialog() {
  const { open, close } = useDialogs();
  const run = useStore(() => batchRun);
  useEffect(() => { batchMounted = true; return () => { batchMounted = false; }; }, []);
  const saved = actions.list();
  const hasRecording = actions.count() > 0;
  const [actionId, setActionId] = useState(saved.length ? String(saved[saved.length - 1].id) : "current");
  const [format, setFormat] = useState<BatchFormat>("png");
  const [source, setSource] = useState<BatchSource>("files");
  const [subfolders, setSubfolders] = useState(true);
  const [sourceDir, setSourceDir] = useState("");
  const [copied, setCopied] = useState(false);
  const [suppressOpen, setSuppressOpen] = useState(false);
  const [suppressProfile, setSuppressProfile] = useState(false);
  const [destination, setDestination] = useState<BatchDestination>("folder");
  const [overrideSave, setOverrideSave] = useState(false);
  const [template, setTemplate] = useState(DEFAULT_BATCH_TEMPLATE);
  const [serial, setSerial] = useState("1");
  const [serialInvalid, setSerialInvalid] = useState(false);
  const serialRef = useRef<HTMLInputElement>(null);
  const [destDir, setDestDir] = useState<string | null>(null);
  const [stopOnError, setStopOnError] = useState(false);
  const busy = !!run?.abort;
  const folder = destination === "folder";
  const canRun = actionId !== "current" || hasRecording;
  const setRun = (next: typeof batchRun) => {
    batchRun = next;
    store.bump();
    if (next && !batchMounted) open("batch"); // Camera Raw took the slot: come back
  };
  const pickFolder = async (title: string, pick: (dir: string) => void) => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title });
    if (typeof dir === "string") pick(dir);
  };
  const pickDest = () => pickFolder("Batch Destination Folder", setDestDir);
  // Copy as Command Line: the command runs in a new process, which only sees
  // saved actions and a source folder on disk.
  const savedAction = saved.find((a) => String(a.id) === actionId);
  const startSerial = parseBatchSerial(serial);
  const copyBlocker = !savedAction ? "Save the action first"
    : !actions.isPersistable(savedAction.id) ? "This action has steps that are not kept between sessions"
    : source !== "folder" ? "Set Source to Folder"
    : !sourceDir.trim() ? "Enter a source folder"
    : folder && startSerial === null ? "Enter a valid Starting serial #" : "";
  const copyCommand = () => {
    if (!savedAction || copyBlocker) return;
    const args = ["--play-action", `${savedAction.set}/${savedAction.name}`, "--batch", sourceDir.trim()];
    if (!subfolders) args.push("--no-subfolders");
    if (folder) {
      if (destDir) args.push("--dest", destDir);
      args.push("--format", format, "--template", template, "--serial", String(startSerial));
      if (overrideSave) args.push("--override-save");
    } else args.push("--destination", destination === "none" ? "none" : "save-and-close");
    if (stopOnError) args.push("--stop-on-error");
    void navigator.clipboard?.writeText(cliCommandLine(cliExecutable(), args));
    setCopied(true);
  };
  const start = async () => {
    // Refuse before any picker opens: nothing is read, opened or written.
    if (folder && parseBatchSerial(serial) === null) {
      setSerialInvalid(true);
      serialRef.current?.focus();
      return;
    }
    const abort = new AbortController();
    let total = 0;
    setRun({ abort, status: "Starting…" });
    try {
      const result = await batchProcess({
        actionId: actionId === "current" ? undefined : Number(actionId),
        format, source, includeSubfolders: subfolders, sourceDir: sourceDir.trim() || undefined,
        template, destDir: destDir ?? undefined, stopOnError,
        destination, startSerial: folder ? serial : undefined, overrideSave: folder && overrideSave,
        suppressOpenDialogs: suppressOpen, suppressProfileWarnings: suppressProfile,
        signal: abort.signal,
        onProgress: (index, count, name) => { total = count; setRun({ abort, status: `${index} of ${count} — ${name}` }); },
      });
      if (!result) { setRun(null); return; } // picker cancelled — leave the dialog as-is
      setRun({ abort: null, ...batchSummary(result, total) });
    } catch (e) {
      setRun({ abort: null, status: "", error: e instanceof Error ? e.message : String(e) });
    }
  };
  // Cancel stops after the current file; Escape, the backdrop and the close
  // button take the same path while a run is going.
  const dismiss = () => {
    if (!batchRun?.abort) { batchRun = null; close(); return; }
    if (batchRun.abort.signal.aborted) return;
    batchRun.abort.abort();
    setRun({ ...batchRun }); // re-render as "Stopping…"
  };
  const row = { gap: 10, marginBottom: 8 } as const;
  const indented = { ...row, paddingLeft: 90 } as const;
  const stopping = !!run?.abort?.signal.aborted;
  return (
    <Dialog open onClose={dismiss} title="Batch" width={420}
      footer={<><Button variant="ghost" id="mv-batch-copy-cli" disabled={busy || !!copyBlocker} onClick={copyCommand}
          title={copyBlocker || "Copy a command that runs this batch without opening Vision"}>Copy as Command Line</Button>
        <Button variant="ghost" disabled={stopping} onClick={dismiss}>{stopping ? "Stopping…" : run && !busy ? "Close" : "Cancel"}</Button>
        <Button variant="primary" disabled={busy || !canRun} onClick={() => void start()}>{busy ? "Processing…" : "Run"}</Button></>}>
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 80 }}>Action</span>
        <Select block id="mv-batch-action" aria-label="Batch action" value={actionId} onChange={setActionId}
          options={[
            ...(hasRecording ? [{ value: "current", label: "Current recording" }] : []),
            ...saved.map((a) => ({ value: String(a.id), label: a.name })),
          ]} />
      </div>
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 80 }}>Source</span>
        <Select block id="mv-batch-source" aria-label="Batch source" value={source} onChange={(v) => setSource(v as BatchSource)}
          options={[{ value: "files", label: "Choose Files…" }, { value: "folder", label: "Folder…" }, { value: "opened", label: "Opened Files" }]} />
      </div>
      <div className="monet-row" style={{ ...indented, flexWrap: "wrap", rowGap: 2 }}>
        {/* No Vision action can record an Open, so every file always comes from Source. */}
        <Checkbox id="mv-batch-override-open" checked disabled aria-describedby="mv-batch-override-open-note">{'Override Action "Open" Commands'}</Checkbox>
        <span id="mv-batch-override-open-note" style={{ color: "var(--text-3)", fontSize: 11 }}>Actions cannot record Open; each file comes from Source.</span>
      </div>
      {source === "folder" && (
        <>
          <div className="monet-row" style={indented}>
            {/* The browser build can't read a typed path, so Run still picks there; the path feeds the command line. */}
            <Input block id="mv-batch-source-dir" aria-label="Batch source folder path" value={sourceDir}
              placeholder={isTauri() ? "Folder path, or choose when you run" : "Folder path for the command line"}
              onChange={(e) => setSourceDir(e.currentTarget.value)} />
            {isTauri() && <Button onClick={() => void pickFolder("Batch Source Folder", setSourceDir)}>Choose…</Button>}
          </div>
          <div className="monet-row" style={indented}>
            <Checkbox id="mv-batch-subfolders" checked={subfolders} onChange={setSubfolders}>Include All Subfolders</Checkbox>
          </div>
          <div role="status" aria-live="polite" id="mv-batch-copy-status" style={{ fontSize: 11, paddingLeft: 90 }}>
            {copied ? "Command copied to the clipboard" : ""}
          </div>
        </>
      )}
      <div className="monet-row" style={indented}>
        <Checkbox id="mv-batch-suppress-open" checked={suppressOpen} onChange={setSuppressOpen}>Suppress File Open Options Dialogs</Checkbox>
      </div>
      <div className="monet-row" style={indented}>
        <Checkbox id="mv-batch-suppress-profile" checked={suppressProfile} onChange={setSuppressProfile}>Suppress Color Profile Warnings</Checkbox>
      </div>
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 80 }}>Destination</span>
        <Select block id="mv-batch-destination" aria-label="Batch destination" value={destination} onChange={(v) => setDestination(v as BatchDestination)}
          options={[{ value: "none", label: "None" }, { value: "saveAndClose", label: "Save and Close" }, { value: "folder", label: "Folder" }]} />
      </div>
      {folder && (
        <div className="monet-row" style={indented}>
          {isTauri() ? (
            <>
              <Button onClick={() => void pickDest()}>{destDir ? destDir.split(/[/\\]/).pop() : "Choose Folder…"}</Button>
              {destDir && <Button variant="ghost" onClick={() => setDestDir(null)}>Use Downloads</Button>}
            </>
          ) : <span className="val" style={{ opacity: 0.6 }}>Downloads</span>}
        </div>
      )}
      <div className="monet-row" style={indented}>
        <Checkbox id="mv-batch-override-save" checked={overrideSave} disabled={!folder} onChange={setOverrideSave}>{'Override Action "Save As" Commands'}</Checkbox>
      </div>
      {folder && (
        <>
          <div className="monet-row" style={row}>
            <label className="lbl" htmlFor="mv-batch-template" style={{ width: 80 }}>File Naming</label>
            <Input block id="mv-batch-template" aria-label="Batch file naming template" value={template}
              onChange={(e) => setTemplate(e.currentTarget.value)} placeholder={DEFAULT_BATCH_TEMPLATE} />
          </div>
          <div className="monet-row" style={row}>
            <label className="lbl" htmlFor="mv-batch-serial" style={{ width: 80 }}>Starting serial #</label>
            <Input ref={serialRef} id="mv-batch-serial" aria-label="Starting serial number" inputMode="numeric" value={serial}
              invalid={serialInvalid} aria-describedby={serialInvalid ? "mv-batch-serial-error" : undefined} style={{ width: 90 }}
              onChange={(e) => { setSerial(e.currentTarget.value); setSerialInvalid(false); }} />
          </div>
          {serialInvalid && <div role="alert" id="mv-batch-serial-error" style={{ color: "var(--danger, #e5534b)", fontSize: 11, marginBottom: 8 }}>{BATCH_SERIAL_ERROR}</div>}
          <div className="monet-row" style={row}>
            <span className="lbl" style={{ width: 80 }}>Save as</span>
            <Select block id="mv-batch-format" aria-label="Batch output format" value={format} onChange={(v) => setFormat(v as BatchFormat)}
              options={[{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG (90)" }, { value: "tiff", label: "TIFF" }]} />
          </div>
        </>
      )}
      <div className="monet-row" style={{ ...row, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 80 }} />
        <Checkbox id="mv-batch-stop" checked={stopOnError} onChange={setStopOnError}>Stop For Errors</Checkbox>
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 6 }}>
        Naming tokens: {"{name}"} (source name), {"{serial}"} (from Starting serial #, 001…), {"{date}"} (yyyymmdd); the format extension is
        appended. Failures are collected into “Batch Log.txt” beside the outputs.
        {saved.length === 0 && !hasRecording ? " Record or save an action first." : ""}
      </div>
      <div role="status" aria-live="polite" id="mv-batch-progress" style={{ fontSize: 11, marginTop: 6 }}>{run?.status}</div>
      {run?.error && <div role="alert" style={{ color: "var(--danger, #e5534b)", fontSize: 11, marginTop: 6 }}>{run.error}</div>}
    </Dialog>
  );
}

// File ▸ Automate ▸ Create Droplet: Photoshop bakes an action + Batch settings
// into a standalone executable that runs when files are dropped on its icon.
// Vision saves them as a JSON descriptor. It runs over images when the two are
// dropped on the window together, given together on the command line
// (`monet-vision droplet.json a.jpg …`) or reopened with "Load & Run…". On
// macOS "Save Droplet App…" also wraps it in an applet Finder accepts drops on,
// which hands the descriptor and the drop to Vision (src-tauri/droplet.rs, #469).
const canSaveDropletApp = () => isTauri() && /^Mac/.test(navigator.platform);

function CreateDropletDialog() {
  const { close } = useDialogs();
  const toast = useToast();
  const saved = actions.list();
  const hasRecording = actions.count() > 0;
  const [actionId, setActionId] = useState(saved.length ? String(saved[saved.length - 1].id) : "current");
  const [format, setFormat] = useState<BatchFormat>("png");
  const [template, setTemplate] = useState(DEFAULT_BATCH_TEMPLATE);
  const [destDir, setDestDir] = useState<string | null>(null);
  const [stopOnError, setStopOnError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const canSave = actionId !== "current" || hasRecording;
  const pickDest = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Droplet Destination Folder" });
    if (typeof dir === "string") setDestDir(dir);
  };
  const descriptor = (id: string): DropletDescriptor => ({
    actionId: id === "current" ? undefined : Number(id),
    actionName: id === "current" ? undefined : saved.find((a) => String(a.id) === id)?.name,
    format, template, destDir: destDir ?? undefined, stopOnError,
  });
  const saveDroplet = async (asApp = false) => {
    // "Current recording" is not something a droplet can name: the recording
    // lives in this session only. Bake it into a saved action first, so the
    // descriptor always points at something a later launch can find (#496).
    let chosen = actionId;
    if (chosen === "current") {
      const baked = actions.save();
      if (!baked) { setSummary("There is nothing recorded to save as a droplet."); return; }
      chosen = String(baked);
      setActionId(chosen);
    }
    const droplet = descriptor(chosen);
    if (!isTauri()) {
      saveBytes("Droplet.json", new TextEncoder().encode(JSON.stringify(droplet, null, 2)), "application/json");
      close();
      return;
    }
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save(asApp
      ? { title: "Save Droplet App", defaultPath: "Droplet.app", filters: [{ name: "Droplet App", extensions: ["app"] }] }
      : { title: "Save Droplet", defaultPath: "Droplet.json", filters: [{ name: "Monet Droplet", extensions: ["json"] }] });
    if (!path) return;
    setBusy(true);
    setSummary(null);
    try { await saveDropletFile(path, droplet, true); }
    catch (e) { setSummary(e instanceof Error ? e.message : String(e)); return; }
    finally { setBusy(false); }
    if (asApp) {
      toast.push({
        title: "Droplet App Saved",
        message: `Drop images or folders on ${path.replace(/^.*[/\\]/, "")} in Finder. It is signed for this Mac only: on another Mac, macOS blocks a copy, so save the droplet app again there.`,
        variant: "info",
      });
    }
    close();
  };
  const loadAndRun = async () => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, filters: [{ name: "Monet Droplet", extensions: ["json"] }] });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return;
    setBusy(true);
    setSummary(null);
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const loaded = parseDroplet(await readTextFile(path));
      if (!loaded) {
        setSummary("That file is not a Monet droplet.");
        return;
      }
      const result = await batchProcess({ ...loaded, source: "files" });
      if (!result) return; // picker cancelled — leave the dialog as-is
      if (result.errors.length) {
        setSummary(`${result.processed} processed, ${result.errors.length} failed — ${result.errors[0].name}: ${result.errors[0].message}`);
      } else close();
    } finally { setBusy(false); }
  };
  const row = { gap: 10, marginBottom: 8 } as const;
  return (
    <Dialog open onClose={close} title="Create Droplet" width={420}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        {isTauri() && <Button variant="ghost" disabled={busy} onClick={() => void loadAndRun()}>{busy ? "Running…" : "Load & Run…"}</Button>}
        {canSaveDropletApp() && <Button variant="ghost" id="mv-droplet-save-app" disabled={busy || !canSave} onClick={() => void saveDroplet(true)}
          title="Save a droplet app you can drop images or folders on in Finder (signed for this Mac only)">Save Droplet App…</Button>}
        <Button variant="primary" disabled={busy || !canSave} onClick={() => void saveDroplet()}>Save Droplet…</Button></>}>
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 80 }}>Action</span>
        <Select block id="mv-droplet-action" aria-label="Droplet action" value={actionId} onChange={setActionId}
          options={[
            ...(hasRecording ? [{ value: "current", label: "Current recording" }] : []),
            ...saved.map((a) => ({ value: String(a.id), label: a.name })),
          ]} />
      </div>
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 80 }}>Destination</span>
        {isTauri() ? (
          <>
            <Button onClick={() => void pickDest()}>{destDir ? destDir.split(/[/\\]/).pop() : "Choose Folder…"}</Button>
            {destDir && <Button variant="ghost" onClick={() => setDestDir(null)}>Use Downloads</Button>}
          </>
        ) : <span className="val" style={{ opacity: 0.6 }}>Downloads</span>}
      </div>
      <div className="monet-row" style={row}>
        <label className="lbl" htmlFor="mv-droplet-template" style={{ width: 80 }}>File Naming</label>
        <Input block id="mv-droplet-template" aria-label="Droplet file naming template" value={template}
          onChange={(e) => setTemplate(e.currentTarget.value)} placeholder={DEFAULT_BATCH_TEMPLATE} />
      </div>
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 80 }}>Save as</span>
        <Select block id="mv-droplet-format" aria-label="Droplet output format" value={format} onChange={(v) => setFormat(v as BatchFormat)}
          options={[{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG (90)" }, { value: "tiff", label: "TIFF" }]} />
      </div>
      <div className="monet-row" style={{ ...row, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 80 }} />
        <Checkbox id="mv-droplet-stop" checked={stopOnError} onChange={setStopOnError}>Stop For Errors</Checkbox>
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 6 }}>
        Save Droplet… saves the action + Batch settings as a .json descriptor. Drop it on the
        window together with images, run <code>monet-vision droplet.json images…</code>, or use
        “Load & Run…” to run it over a fresh set of files.
        {canSaveDropletApp() ? " Save Droplet App… makes a droplet you can drop images or folders on in Finder. It is signed for this Mac only: macOS blocks a copy on another Mac, so save it again there." : ""}
        {saved.length === 0 && !hasRecording ? " Record or save an action first." : ""}
      </div>
      {summary && <div role="alert" style={{ color: "var(--danger, #e5534b)", fontSize: 11, marginTop: 6 }}>{summary}</div>}
    </Dialog>
  );
}

// A droplet dropped with images on the window, or on the droplet app (#469).
// state/app.ts runs it; this shows its progress, Cancel and summary the way
// the Batch dialog does.
function DropletRunDialog() {
  const { close } = useDialogs();
  const run = useStore(() => dropletRun());
  const stopping = !!run?.abort?.signal.aborted;
  // Cancel stops after the current file; Escape and the backdrop do the same.
  const dismiss = () => {
    if (!run?.abort) { close(); return; }
    if (stopping) return;
    run.abort.abort();
    store.bump(); // re-render as "Stopping…"
  };
  return (
    <Dialog open onClose={dismiss} title={`Droplet — ${run?.name ?? ""}`} width={420}
      footer={<Button variant={run?.abort ? "ghost" : "primary"} disabled={stopping} onClick={dismiss}>
        {stopping ? "Stopping…" : run?.abort ? "Cancel" : "Close"}</Button>}>
      <div role="status" aria-live="polite" id="mv-droplet-progress" style={{ fontSize: 11 }}>{run?.status}</div>
      {run?.error && <div role="alert" style={{ color: "var(--danger, #e5534b)", fontSize: 11, marginTop: 6 }}>{run.error}</div>}
    </Dialog>
  );
}

const saveScriptEvents = (value: ScriptEventStore) =>
  store.persistAuthoredContent(SCRIPT_EVENTS_KEY, serializeScriptEventStore(value), "script event bindings");

function ScriptEventsManagerDialog() {
  const { close } = useDialogs();
  const saved = actions.list();
  const initial = loadScriptEventStore();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [bindings, setBindings] = useState<ScriptEventBinding[]>(initial.bindings);
  const [event, setEvent] = useState<ScriptEventId>(SCRIPT_EVENTS[0].id);
  const [kind, setKind] = useState<"action" | "script">("action");
  const [actionId, setActionId] = useState(saved.length ? String(saved[0].id) : "");
  const [code, setCode] = useState("");
  // Edits stay staged until Done; Cancel (or Escape) discards them.
  const add = () => {
    if (kind === "action") {
      if (!actionId) return;
      const chosen = saved.find((a) => String(a.id) === actionId);
      setBindings([...bindings, { event, actionId: Number(actionId), actionName: chosen?.name }]);
    } else {
      if (!code.trim()) return;
      setBindings([...bindings, { event, code }]);
      setCode("");
    }
  };
  const remove = (i: number) => setBindings(bindings.filter((_, idx) => idx !== i));
  const eventLabel = (id: ScriptEventId) => SCRIPT_EVENTS.find((e) => e.id === id)?.label ?? id;
  const targetLabel = (b: ScriptEventBinding) => {
    if (b.actionId === undefined && b.actionName === undefined) return "Script";
    const id = actions.resolve({ id: b.actionId, name: b.actionName });
    return saved.find((a) => a.id === id)?.name ?? `${b.actionName ?? `Action #${b.actionId}`} (missing)`;
  };
  const row = { gap: 10, marginBottom: 8 } as const;
  return (
    <Dialog open onClose={close} title="Script Events Manager" width={420}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" onClick={() => { if (saveScriptEvents({ enabled, bindings })) close(); }}>Done</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 10 }}>
        <Checkbox id="mv-scriptevents-enable" checked={enabled} onChange={setEnabled}>
          Enable Events to Run Scripts/Actions
        </Checkbox>
      </div>
      <div style={{ maxHeight: 140, overflowY: "auto", marginBottom: 10, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", borderRadius: 4 }}>
        {bindings.length === 0
          ? <div style={{ padding: 8, fontSize: 11, color: "var(--text-3)" }}>No events bound.</div>
          : bindings.map((b, i) => (
            <div key={i} className="monet-row" style={{ gap: 8, alignItems: "center", padding: "4px 8px" }}>
              <span style={{ flex: 1, fontSize: 12 }}>{eventLabel(b.event)} → {targetLabel(b)}</span>
              <Button variant="ghost" aria-label={`Remove ${eventLabel(b.event)} → ${targetLabel(b)}`} onClick={() => remove(i)}>Remove</Button>
            </div>
          ))}
      </div>
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 80 }}>Event</span>
        <Select block id="mv-scriptevents-event" aria-label="App event" value={event} onChange={(v) => setEvent(v as ScriptEventId)}
          options={SCRIPT_EVENTS.map((e) => ({ value: e.id, label: e.label }))} />
      </div>
      <div className="monet-row" style={row}>
        <span className="lbl" style={{ width: 80 }}>Run</span>
        <Select block id="mv-scriptevents-kind" aria-label="Binding kind" value={kind} onChange={(v) => setKind(v as "action" | "script")}
          options={[{ value: "action", label: "Action" }, { value: "script", label: "Script" }]} />
      </div>
      {kind === "action" ? (
        <div className="monet-row" style={row}>
          <span className="lbl" style={{ width: 80 }}>Action</span>
          <Select block id="mv-scriptevents-action" aria-label="Bound action" value={actionId} onChange={setActionId}
            options={saved.map((a) => ({ value: String(a.id), label: a.name }))} />
        </div>
      ) : (
        <Textarea aria-label="Script to run" value={code} onChange={(e) => setCode(e.target.value)} rows={3} block placeholder="vision.adj.vibrance(0.4, 0.1);"
          style={{ fontFamily: "var(--font-mono)", fontSize: 12, marginBottom: 8 }} />
      )}
      <Button onClick={add} disabled={kind === "action" ? !actionId : !code.trim()}>Add</Button>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 10 }}>
        Events run after successful document operations. Cancelled operations do not run bindings, and bindings cannot recursively trigger events.
      </div>
    </Dialog>
  );
}

function RenderVideoDialog() {
  const { close } = useDialogs();
  const frames = Math.max(1, anim.count());
  const [fps, setFps] = useState(12);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(frames);
  const [quality, setQuality] = useState("8");
  const [busy, setBusy] = useState(false);
  const render = async () => {
    setBusy(true);
    // The two fields are independent, so "from 5 to 2" is reachable; recordVideo
    // clamps to >= from and would silently render a one-frame video of frame 5
    // instead of the span the user asked for. (#100)
    const lo = Math.min(from, to), hi = Math.max(from, to);
    try {
      await exportVideo(`${store.state.doc.name.replace(/\.[^.]+$/, "")}.webm`, fps,
        { from: lo - 1, to: hi - 1, bitrate: Number(quality) * 1_000_000 });
      close();
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={close} title="Render Video" width={380}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => void render()}>{busy ? "Rendering…" : "Render"}</Button></>}>
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 90 }}>Frame rate</span>
        <NumberField value={fps} min={1} max={60} onChange={(v) => setFps(Math.round(v))} suffix="fps" />
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 90 }}>Range</span>
        <NumberField value={from} min={1} max={frames} onChange={(v) => setFrom(Math.round(v))} />
        <span style={{ color: "var(--text-3)" }}>to</span>
        <NumberField value={to} min={1} max={frames} onChange={(v) => setTo(Math.round(v))} />
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>of {frames}</span>
      </div>
      <div className="monet-row" style={{ gap: 10, marginBottom: 4 }}>
        <span className="lbl" style={{ width: 90 }}>Quality</span>
        <Select id="mv-render-video-quality" aria-label="Video quality" value={quality} onChange={setQuality}
          options={[{ value: "2.5", label: "Low (2.5 Mbps)" }, { value: "8", label: "Medium (8 Mbps)" }, { value: "16", label: "High (16 Mbps)" }]} />
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 6 }}>
        Encodes the animation frames with the platform codec (WebM/MP4).
      </div>
    </Dialog>
  );
}

function ScriptDialog() {
  const { close } = useDialogs();
  const [code, setCode] = useState(
    `// 'vision' drives the engine. Try:\nvision.newDoc(800, 600, "Scripted");\nfor (let i = 0; i < 6; i++) {\n  vision.selectRect(60 + i*110, 80, 90, 440);\n  vision.fill(40 + i*35, 120, 220 - i*30);\n}\nvision.deselect();\nvision.adj.vibrance(0.4, 0.1);\n\n// Read live state back with 'await vision.read.*':\nvision.log(\`\${await vision.read.width()}x\${await vision.read.height()}, \${await vision.read.layerCount()} layer(s)\`);`,
  );
  const [out, setOut] = useState("");
  const [running, setRunning] = useState(false);
  // The script runs in a sandboxed Worker (async), so Run awaits the result.
  const run = async () => {
    setRunning(true);
    try { setOut((await runScript(code)) || "✓ ran"); }
    finally { setRunning(false); }
  };
  // Copy as Command Line runs a file, so the script is saved first: where you
  // choose on desktop, or downloaded as script.js in the browser.
  const copyCommand = async () => {
    const bytes = new TextEncoder().encode(code);
    if (bytes.length > MAX_SCRIPT_IMPORT_BYTES) { setOut("Script exceeds the 1 MiB limit"); return; }
    let path = "script.js";
    if (isTauri()) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const target = await save({ defaultPath: path, filters: [{ name: "JavaScript", extensions: ["js"] }] });
      if (!target) return; // cancelled: nothing written, nothing copied
      await atomicWriteBytes(target, bytes);
      path = target;
    } else downloadBytes(path, bytes, "text/javascript");
    await navigator.clipboard?.writeText(cliCommandLine(cliExecutable(), ["--run-script", path]));
    setOut("✓ Command copied to the clipboard");
  };
  return (
    <Dialog open onClose={close} title="Scripting Console" width={540}
      footer={<><Button variant="ghost" id="mv-script-copy-cli" disabled={running}
          onClick={() => void copyCommand().catch((e) => setOut(e instanceof Error ? e.message : String(e)))}>Copy as Command Line</Button>
        <Button variant="ghost" onClick={close}>Close</Button>
        <Button variant="primary" disabled={running} onClick={() => void run()}>Run</Button></>}>
      <Textarea value={code} onChange={(e) => setCode(e.target.value)} rows={11} block
        style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5 }} />
      {out && (
        <div style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: out.startsWith("✓") ? "var(--text-2)" : "#ff6b6b" }}>{out}</div>
      )}
    </Dialog>
  );
}

// ── AI Models manager (plan 02 Phase 3) ────────────────────────
// Status + checksum-gated native provisioning for every registry model. Rows
// without approved hosted metadata remain manual-only.
type ChipTone = "ok" | "demo" | "off";
function StatusChip({ tone, label, testid }: { tone: ChipTone; label: string; testid?: string }) {
  const c = {
    ok: { bg: "rgba(64,192,96,0.16)", fg: "#5fce7f" },
    demo: { bg: "rgba(230,170,60,0.16)", fg: "#e0a83a" },
    off: { bg: "rgba(255,255,255,0.08)", fg: "var(--text-3)" },
  }[tone];
  return (
    <span data-testid={testid} style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: c.bg, color: c.fg, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function ModelManager() {
  const { close, open } = useDialogs();
  const [status, setStatus] = useState<Partial<Record<ModelDef["id"], ModelStatus>>>({});
  const [hwWarn, setHwWarn] = useState<string | null>(null);
  const [active, setActive] = useState<ModelDef["id"] | null>(null);
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const native = isTauri();

  const refresh = useCallback(async () => {
    const rows = await Promise.all(MODEL_REGISTRY.map(async (def) => [def.id, await models.status(def.id)] as const));
    setStatus(Object.fromEntries(rows));
  }, []);

  useEffect(() => {
    let live = true;
    void refresh().catch(() => {});
    void (async () => {
      // D6: SD-1.5 wants WebGPU with a ≥2 GiB max buffer; deviceMemory is used
      // only when the browser exposes it (WKWebView doesn't). Advisory, not a gate.
      const gpu = (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<{ limits?: { maxBufferSize?: number } } | null> } }).gpu;
      const adapter = gpu?.requestAdapter ? await gpu.requestAdapter().catch(() => null) : null;
      const maxBuf = adapter?.limits?.maxBufferSize ?? 0;
      const devMem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
      let warn: string | null = null;
      if (!adapter) warn = "No WebGPU adapter detected — Stable Diffusion 1.5 needs WebGPU; the wasm fallback is slow and may run out of memory.";
      else if (maxBuf < 2048 * 1024 * 1024) warn = `WebGPU max buffer ${(maxBuf / 1e9).toFixed(1)} GB is below the ~2 GB Stable Diffusion 1.5 wants — generation may fail.`;
      if (devMem !== undefined && devMem < 8) warn = `${warn ? warn + " " : ""}Device memory ~${devMem} GB is low for a 2.1 GB model.`;
      if (live) setHwWarn(warn);
    })();
    return () => { live = false; abort.current?.abort(); };
  }, [refresh]);

  // OpenRAIL-class models must present their license at provision time; with
  // pure-local provisioning, Import IS the provision step. The Accept button
  // is the only path that passes licenseAccepted to the backend gate.
  const [licenseGate, setLicenseGate] = useState<{ def: ModelDef; text: string } | null>(null);
  const installLocal = async (def: ModelDef, licenseAccepted = false) => {
    if (def.licenseAcceptance && !licenseAccepted) {
      try {
        const text = await (await fetch(def.licenseAcceptance.textPath)).text();
        setLicenseGate({ def, text });
      } catch {
        setProblem(`Could not load the ${def.licenseAcceptance.name} license text.`);
      }
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setActive(def.id); setProgress(0); setProblem(null);
    try {
      const installed = await models.installLocal(def.id, (p) => setProgress(p.total ? p.received / p.total : 0), ctrl.signal, { licenseAccepted });
      if (installed) await refresh();
    } catch (error) {
      if (!ctrl.signal.aborted) setProblem(String(error));
    } finally {
      abort.current = null; setActive(null);
    }
  };

  const uninstall = async (def: ModelDef) => {
    setActive(def.id); setProblem(null);
    try { await models.remove(def.id); await refresh(); }
    catch (error) { setProblem(String(error)); }
    finally { setActive(null); }
  };

  const rowChip = (def: ModelDef) => {
    const testid = `model-${def.id}-status`;
    const current = status[def.id];
    if (!current) return <StatusChip testid={testid} tone="off" label="…" />;
    if (current === "bundled") return <StatusChip testid={testid} tone="ok" label="Bundled" />;
    if (current === "downloaded") return <StatusChip testid={testid} tone="ok" label="Installed" />;
    if (current === "local") return <StatusChip testid={testid} tone="ok" label={def.id === "sd15" || def.id === "migan" ? "Installed (local)" : "Installed"} />;
    if (current === "demo") return <StatusChip testid={testid} tone="demo" label="Local demo" />;
    return <StatusChip testid={testid} tone="off" label={def.id === "migan" ? "Not shipped" : def.id === "drunet" || def.id === "sd15" ? "Not installed" : "Not bundled"} />;
  };
  const hint = (def: ModelDef): string | null => {
    if (modelDownloadReady(def)) return null;
    if (def.id === "migan") return "Not shipped — the available blob lacks a directly confirmed redistribution license.";
    if (def.id === "sd15") return "Build the ~2.1 GB fp16 weights locally, then select the sd15 folder containing text_encoder, unet, vae_encoder, vae_decoder, and tokenizer.";
    if (def.id === "drunet") return "Build drunet_color.onnx locally (recipe in public/models/MODELS.md), then install that exact file.";
    return null;
  };

  if (licenseGate) {
    return (
      <Dialog open onClose={() => setLicenseGate(null)} title={`${licenseGate.def.label} — ${licenseGate.def.licenseAcceptance!.name}`} width={560}
        footer={<><Button variant="ghost" onClick={() => setLicenseGate(null)}>Decline</Button>
          <Button variant="primary" data-mv-license-accept
            onClick={() => { const def = licenseGate.def; setLicenseGate(null); void installLocal(def, true); }}>Accept &amp; Import</Button></>}>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>
          This model's license requires reviewing and accepting these terms (including the Attachment A use restrictions) before installation.
        </div>
        <pre style={{ maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.45, background: "rgba(0,0,0,0.25)", padding: 10, borderRadius: 6 }}>{licenseGate.text}</pre>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={close} title="AI Models" width={560}
      footer={<Button variant="primary" onClick={close}>Close</Button>}>
      <div className="monet-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
          On-device models loaded by Filter ▸ Neural Filters run locally via onnxruntime-web. Hosted and disk installs are accepted only for release-pinned artifacts and verified before activation.
        </div>
        <Button size="sm" variant="ghost" onClick={() => open("neuralAI")}>Open Neural Filters</Button>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {MODEL_REGISTRY.map((def) => (
          <div key={def.id} style={{ display: "grid", gap: 4, padding: "10px 12px", borderRadius: 6, border: "1px solid var(--stroke-2)", background: "var(--surface-2, rgba(255,255,255,0.03))" }}>
            <div className="monet-row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{def.label}</div>
              {rowChip(def)}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>{def.role}</div>
            <div style={{ fontSize: 10.5, color: "var(--text-3)", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span>{prettyBytes(modelBytes(def))}</span>
              <span>·</span>
              <span>{def.license}</span>
            </div>
            {!def.bundled && hint(def) && <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{hint(def)}</div>}
            {native && modelLocalImportReady(def) && status[def.id] !== "downloaded" && status[def.id] !== "local" && (
              <div><Button size="sm" disabled={active !== null} onClick={() => void installLocal(def)}>Install from Disk…</Button></div>
            )}
            {native && status[def.id] === "downloaded" && (
              <div><Button size="sm" variant="ghost" disabled={active !== null} onClick={() => void uninstall(def)}>Delete</Button></div>
            )}
            {active === def.id && (
              <div style={{ fontSize: 10.5, color: "var(--text-2)" }}>
                {progress > 0 ? `${Math.round(progress * 100)}%` : "Preparing…"}
                <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>Cancel</Button>
              </div>
            )}
            {def.id === "sd15" && hwWarn && (
              <div role="alert" style={{ fontSize: 10.5, color: "var(--accent-raster)", marginTop: 2 }}>{hwWarn}</div>
            )}
          </div>
        ))}
      </div>
      {problem && <div role="alert" style={{ fontSize: 10.5, color: "var(--accent-raster)", marginTop: 10 }}>{problem}</div>}
      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 12, borderTop: "1px solid var(--stroke-2)", paddingTop: 10 }}>
        {native
          ? "Pinned, redistribution-cleared models can be installed from disk without passing model bytes through the webview. Hosted downloads additionally require an approved HTTPS source."
          : "Browser dev build — optional weights are placed manually under public/models (see MODELS.md)."}
      </div>
    </Dialog>
  );
}

function AiDenoise() {
  const { close } = useDialogs();
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Learned DRUNet denoiser — runs on-device.");
  const apply = async () => {
    if (busy) return;
    let end: () => void;
    try { end = beginMlJob(); }
    catch (e) { setStatus("⚠ " + String(e)); return; }
    setBusy(true);
    try { const r = await ml.aiDenoise((m) => setStatus(m), amount / 100); if ((r as { ok: boolean }).ok) { close(); return; } }
    catch (e) { setStatus(isMlCancel(e) ? "Cancelled." : "⚠ " + String(e)); }
    finally { end(); setBusy(false); }
  };
  return (
    <Dialog open onClose={busy ? () => {} : close} title="AI Denoise" width={360}
      footer={<>
        <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={apply} disabled={busy}>Apply → New Layer</Button>
      </>}>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 12 }}>
        A real learned blind denoiser (DRUNet). <b>Amount</b> blends the denoised result back toward the original — lower it to keep more fine detail.
      </div>
      <div className="monet-row" style={{ gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", width: 56 }}>Amount</span>
        <Slider value={amount / 100} accent="var(--accent-raster)" onChange={(f) => setAmount(Math.round(f * 100))} style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, width: 32 }}>{amount}%</span>
      </div>
      <MlJobStatus busy={busy} status={status} />
    </Dialog>
  );
}

// Labelled slider row for the neural-filter parameter sets (Amount / Focal /
// Eyes / …) — same visual row as the hand-rolled Steps/Guidance rows above it.
function MlRow({ label, value, min = 0, max = 1, display, onChange }: {
  label: string; value: number; min?: number; max?: number; display: string; onChange: (v: number) => void;
}) {
  return (
    <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: "var(--text-3)", width: 78 }}>{label}</span>
      <Slider aria-label={label} value={(value - min) / (max - min)} accent="var(--accent-raster)" onChange={(f) => onChange(min + f * (max - min))} style={{ flex: 1 }} />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, width: 36, textAlign: "right" }}>{display}</span>
    </div>
  );
}

// ── Face-Aware Liquify section ─────────────────────────────────
// Photoshop's full Face-Aware Liquify control set (Eyes / Nose / Mouth / Face
// Shape) over the 68-point landmark model, plus the face picker for group
// shots. Every slider is −1..1 with 0 = no change — the FaceLiquifyParams
// contract ml/onnx.ts already implements and faceLiquify.test.ts pins.
type FaceLiquifyKey = Exclude<keyof FaceLiquifyParams, "faceIndex">;
export const FACE_LIQUIFY_GROUPS: { group: string; controls: [FaceLiquifyKey, string][] }[] = [
  { group: "Eyes", controls: [["eyeSize", "Eye Size"], ["eyeHeight", "Eye Height"], ["eyeWidth", "Eye Width"], ["eyeTilt", "Eye Tilt"], ["eyeDistance", "Eye Distance"]] },
  { group: "Nose", controls: [["noseHeight", "Nose Height"], ["noseWidth", "Nose Width"]] },
  { group: "Mouth", controls: [["smile", "Smile"], ["upperLip", "Upper Lip"], ["lowerLip", "Lower Lip"], ["mouthWidth", "Mouth Width"], ["mouthHeight", "Mouth Height"]] },
  { group: "Face Shape", controls: [["forehead", "Forehead"], ["chinHeight", "Chin Height"], ["jawline", "Jawline"], ["faceWidth", "Face Width"]] },
];

/** Section state: the params under edit plus how many faces the last detection
 *  pass found (0 = never detected, so the picker has nothing to offer yet). */
export interface FaceLiquifyState { params: FaceLiquifyParams; faces: number }
export const FACE_LIQUIFY_INIT: FaceLiquifyState = { params: {}, faces: 0 };

// Controlled by the host dialog so the whole wiring is exercisable without a DOM.
export function FaceAwareLiquifySection({ busy, run, state, onState, sectionRef }: {
  busy: boolean;
  run: (fn: (p: (m: string) => void) => Promise<unknown>) => void;
  state: FaceLiquifyState;
  onState: (next: FaceLiquifyState) => void;
  sectionRef?: Ref<HTMLDivElement>;
}) {
  const { params, faces } = state;
  const faceIndex = params.faceIndex ?? 0;
  const dirty = FACE_LIQUIFY_GROUPS.some((g) => g.controls.some(([key]) => params[key]));
  return (
    <>
      <div ref={sectionRef} style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Face-Aware Liquify <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— landmark-driven face shaping</span></div>
      <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", width: 78 }}>Face</span>
        <Select aria-label="Face" size="sm" block disabled={busy || faces < 2} value={String(faceIndex)}
          options={faces < 1
            ? [{ value: "0", label: "Face 1" }]
            : Array.from({ length: faces }, (_, i) => ({ value: String(i), label: `Face ${i + 1}` }))}
          onChange={(v) => onState({ ...state, params: { ...params, faceIndex: Number(v) } })} />
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async (p) => {
          const r = await ml.detectFaces(p);
          onState({ params: { ...params, faceIndex: 0 }, faces: r.faces.length });
          p(`Found ${r.faces.length} face${r.faces.length === 1 ? "" : "s"}.`);
        })}>Detect Faces</Button>
      </div>
      {FACE_LIQUIFY_GROUPS.map(({ group, controls }) => (
        <div key={group}>
          <div style={{ fontSize: 10.5, color: "var(--text-3)", margin: "8px 0 4px" }}>{group}</div>
          {controls.map(([key, label]) => (
            <MlRow key={key} label={label} value={params[key] ?? 0} min={-1} max={1} display={(params[key] ?? 0).toFixed(2)}
              onChange={(v) => onState({ ...state, params: { ...params, [key]: v } })} />
          ))}
        </div>
      ))}
      <div className="monet-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" disabled={busy || !dirty}
          onClick={() => run((p) => ml.faceAwareLiquify(params, p))}>Apply to Layer</Button>
        <Button size="sm" variant="ghost" disabled={busy}
          onClick={() => onState({ ...state, params: { faceIndex } })}>Reset</Button>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Warps the active layer through the Liquify mesh (undoable). Needs a 68-point landmark model.</div>
    </>
  );
}

// ── Running-job status + Cancel ────────────────────────────────
// Both AI dialogs lock their Close button while a job runs, so before this the
// only escape from a 50-step generation or a 200-tile denoise was changing the
// document. Cancel lands at the next tile/step boundary (ml/mlJob.ts).
export function MlJobStatus({ busy, status }: { busy: boolean; status: string }) {
  return (
    <div className="monet-row" style={{ marginTop: 14, gap: 8, alignItems: "center" }}>
      <div style={{ flex: 1, fontSize: 11, fontFamily: "var(--font-mono)", color: busy ? "var(--accent-raster)" : "var(--text-2)" }}>
        {busy ? "⏳ " : ""}{status}
      </div>
      {busy && <Button size="sm" variant="ghost" onClick={() => cancelMlJob()}>Cancel Job</Button>}
    </div>
  );
}

// ── Neural-filter before/after preview ─────────────────────────
// The dialog used to make the user pick a style/amount blind, apply, look, then
// undo. This runs the SAME filter through ml/onnx previewFilter — real model,
// real post-blend — against a downscaled document, and shows before/after
// instead of stamping a layer.
type OnnxModule = typeof import("../ml/onnx");
export interface NeuralPreviewParams {
  style: string; stStrength: number; stPreserve: number;
  colAmount: number; dbFocal: number; dbStrength: number; hzAmount: number; rsAmount: number;
}
export const PREVIEW_FILTERS: { key: string; label: string; run: (m: OnnxModule, v: NeuralPreviewParams, p?: MlProgress) => Promise<unknown> }[] = [
  // Labels stay distinct from the section headings below them — the picker
  // trigger renders its label as plain text next to those headings.
  { key: "style", label: "Style", run: (m, v, p) => m.styleTransfer(v.style, 0, p, { strength: v.stStrength, preserveColor: v.stPreserve }) },
  { key: "colorize", label: "Colorize", run: (m, v, p) => m.colorizeML(p, v.colAmount) },
  { key: "depthblur", label: "Depth Blur", run: (m, v, p) => m.depthBlurML(v.dbFocal, v.dbStrength, p) },
  { key: "harmonize", label: "Harmonize", run: (m, v, p) => m.harmonizeML(p, v.hzAmount) },
  { key: "restore", label: "Restoration", run: (m, v, p) => m.restoreML(p, v.rsAmount) },
];
export interface NeuralPreviewState { filter: string; showBefore: boolean; result: MlPreviewResult | null }
export const NEURAL_PREVIEW_INIT: NeuralPreviewState = { filter: "style", showBefore: false, result: null };

export function NeuralPreviewPane({ busy, params, state, onState, run }: {
  busy: boolean;
  params: NeuralPreviewParams;
  state: NeuralPreviewState;
  onState: (next: NeuralPreviewState) => void;
  run: (fn: (p: (m: string) => void) => Promise<unknown>) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { result, showBefore } = state;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !result) return;
    c.width = result.w; c.height = result.h;
    const cx = c.getContext("2d");
    if (!cx) return;
    const id = cx.createImageData(result.w, result.h);
    id.data.set(showBefore ? result.before : result.after);
    cx.putImageData(id, 0, 0);
  }, [result, showBefore]);
  const def = PREVIEW_FILTERS.find((f) => f.key === state.filter) ?? PREVIEW_FILTERS[0];
  return (
    <div style={{ border: "1px solid var(--stroke-2)", borderRadius: 6, padding: 8, marginBottom: 12 }}>
      <div className="monet-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>Preview</span>
        <Select aria-label="Preview filter" size="sm" value={state.filter}
          options={PREVIEW_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
          onChange={(v) => onState({ ...state, filter: v, result: null })} />
        <Button size="sm" variant="primary" disabled={busy} onClick={() => run(async (p) => {
          const m = await import("../ml/onnx");
          const preview = await m.previewFilter((prog) => def.run(m, params, prog), p);
          onState({ ...state, showBefore: false, result: preview });
        })}>Run Preview</Button>
        <Button size="sm" variant={showBefore ? "primary" : "ghost"} disabled={!result}
          onClick={() => onState({ ...state, showBefore: !showBefore })}>{showBefore ? "Before" : "After"}</Button>
      </div>
      {result
        ? <canvas ref={canvas} aria-label={`${def.label} preview`} style={{ display: "block", maxWidth: "100%", marginTop: 8, borderRadius: 4 }} />
        : <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6 }}>Runs the selected filter on a downscaled copy of the document — nothing is applied until you press that filter’s Apply button.</div>}
    </div>
  );
}

function NeuralAI() {
  const { close, open, arg } = useDialogs();
  const [sdInpaint, setSdInpaint] = useState<"real" | "demo" | "missing" | null>(null);
  const [sdGen, setSdGen] = useState<"real" | "demo" | "missing" | null>(null);
  const [webgpu, setWebgpu] = useState<boolean | null>(null);
  const [migan, setMigan] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void models.sdStatus(true).then((s) => { if (live) setSdInpaint(s); });
    void models.sdStatus(false).then((s) => { if (live) setSdGen(s); });
    void models.webgpu().then((v) => { if (live) setWebgpu(v); });
    void models.miganInstalled().then((v) => { if (live) setMigan(v); });
    return () => { live = false; };
  }, []);
  const [style, setStyle] = useState("candy");
  // Style Transfer post-blend knobs (VIS-FX-15) — defaults reproduce the old
  // full-strength one-shot. Style Opacity lands as the new layer's opacity.
  const [stStrength, setStStrength] = useState(1);
  const [stOpacity, setStOpacity] = useState(1);
  const [stPreserve, setStPreserve] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Genuine trained networks (ONNX), run on-device.");
  const [prompt, setPrompt] = useState("a serene mountain lake at sunrise, highly detailed");
  const [fillPrompt, setFillPrompt] = useState("");
  const [steps, setSteps] = useState(20);
  const [negPrompt, setNegPrompt] = useState("");
  const [guidance, setGuidance] = useState(7.5);
  const [seed, setSeed] = useState(42);
  const [outputSize, setOutputSize] = useState(512);
  const [strength, setStrength] = useState(0.6); // img2img denoise strength
  const [expandPx, setExpandPx] = useState(256);
  const [expandSides, setExpandSides] = useState<ExpandSides>("all");
  // Per-filter parameter sets for the Tier-2 neural filters (VIS-FX-05): the
  // menu one-shots used to fire these at hardcoded strengths.
  const [colAmount, setColAmount] = useState(1);
  const [dbFocal, setDbFocal] = useState(0.5);
  const [dbStrength, setDbStrength] = useState(1); // 0..2, engine caps the radius
  const [hzAmount, setHzAmount] = useState(1);
  const [rsAmount, setRsAmount] = useState(1);
  const [ssBlur, setSsBlur] = useState(50);
  const [ssSmooth, setSsSmooth] = useState(50);
  const [fl, setFl] = useState<FaceLiquifyState>(FACE_LIQUIFY_INIT);
  // Live before/after preview — starts on the section the caller deep-linked to.
  const [pv, setPv] = useState<NeuralPreviewState>(() => ({
    ...NEURAL_PREVIEW_INIT,
    filter: PREVIEW_FILTERS.some((f) => f.key === arg) ? String(arg) : NEURAL_PREVIEW_INIT.filter,
  }));
  // Shared diffusion knobs threaded into every generative path (Generate Image,
  // Generate Background, prompt-driven Fill). Blank negative prompt → undefined
  // so the backend default (empty uncond) applies.
  const gc = () => ({ negativePrompt: negPrompt.trim() || undefined, guidance, seed, outputSize });
  // Deep-link: the Generate Image / Generate Background / Generative Fill menu
  // items open this dialog focused on their section (it's long — landing on the
  // right one saves scrolling). arg is the section key.
  const fillRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<HTMLDivElement>(null);
  const genRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const dbRef = useRef<HTMLDivElement>(null);
  const hzRef = useRef<HTMLDivElement>(null);
  const rsRef = useRef<HTMLDivElement>(null);
  const flRef = useRef<HTMLDivElement>(null);
  const ssRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = arg === "expand" ? expandRef : arg === "fill" ? fillRef : arg === "generate" ? genRef
      : arg === "colorize" ? colRef : arg === "depthblur" ? dbRef : arg === "harmonize" ? hzRef
      : arg === "restore" ? rsRef : arg === "faceliquify" ? flRef : arg === "skinsmooth" ? ssRef : null;
    t?.current?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (fn: (p: (m: string) => void) => Promise<unknown>) => {
    if (busy) return;
    let end: () => void;
    try { end = beginMlJob(); }
    catch (e) { setStatus("⚠ " + String(e)); return; }
    setBusy(true);
    try { await fn((m) => setStatus(m)); setStatus("✓ Done."); }
    catch (e) { setStatus(isMlCancel(e) ? "Cancelled." : "⚠ " + String(e)); }
    finally { end(); setBusy(false); }
  };
  const doExpand = () => run((p) => {
    const g = expandGeometry(engine.e.width(), engine.e.height(), expandPx, expandSides);
    return ml.generativeExpand(g.nw, g.nh, g.dx, g.dy, p);
  });
  // No-silent-downgrade: a prompt that can't route to real SD-1.5 inpaint gets an
  // explicit notice instead of a quiet fallback ("missing" may offer a locally
  // installed MI-GAN; "demo" means abstract output). Null while probing or
  // when real weights load.
  const fillGate = fillPrompt.trim() && sdInpaint && sdInpaint !== "real" ? sdInpaint : null;
  return (
    <Dialog open onClose={busy ? () => {} : close} title="Neural Filters (AI)" width={460}
      footer={<Button variant="ghost" onClick={close} disabled={busy}>Close</Button>}>
      <div className="monet-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
          Real pretrained neural networks running locally via onnxruntime-web — no cloud, no stubs.
        </div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => open("modelManager")}>Manage AI Models…</Button>
      </div>
      <NeuralPreviewPane busy={busy} state={pv} onState={setPv} run={run}
        params={{ style, stStrength, stPreserve, colAmount, dbFocal, dbStrength, hzAmount, rsAmount }} />
      {sdGen === "real" && webgpu === false && (
        <div role="alert" data-testid="mv-webgpu-warning" style={{ fontSize: 10.5, color: "var(--accent-raster)", marginBottom: 12 }}>
          Real SD-1.5 weights are installed but this browser/webview has no WebGPU — the ~2 GB model can’t run on the wasm CPU backend. Generation needs WebGPU; only separately installed local demo or MI-GAN weights can provide a fallback.
        </div>
      )}
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Style Transfer</div>
      <div className="monet-row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {ml.styles().map((s) => (
          <Button key={s} size="sm" variant={style === s ? "primary" : "ghost"} disabled={busy} onClick={() => setStyle(s)}>{s}</Button>
        ))}
      </div>
      <MlRow label="Strength" value={stStrength} display={`${Math.round(stStrength * 100)}%`} onChange={setStStrength} />
      <MlRow label="Style Opacity" value={stOpacity} display={`${Math.round(stOpacity * 100)}%`} onChange={setStOpacity} />
      <MlRow label="Preserve Color" value={stPreserve} display={`${Math.round(stPreserve * 100)}%`} onChange={setStPreserve} />
      <Button variant="primary" disabled={busy} onClick={() => run((p) => ml.styleTransfer(style, p, { strength: stStrength, styleOpacity: stOpacity, preserveColor: stPreserve }))}>Apply “{style}” → New Layer</Button>
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
      <div ref={fillRef} style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Generative Fill <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— select a region, then fill it</span></div>
      <Textarea value={fillPrompt} onChange={(e) => setFillPrompt(e.target.value)} rows={2} block
        placeholder="Describe what to fill the selection with…" style={{ fontSize: 12, marginBottom: 6 }} />
      <div className="monet-row" style={{ gap: 8, flexWrap: "wrap" }}>
        {fillGate ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => open("modelManager")}>Manage AI Models…</Button>
            {fillGate === "missing"
              ? migan && <Button variant="primary" disabled={busy} onClick={() => run((p) => ml.generativeFill(p))}>Fill with local MI-GAN instead</Button>
              : <Button variant="primary" disabled={busy} onClick={() => run((p) => ml.generativeFillPrompt(fillPrompt, steps, p, gc()))}>Fill anyway (demo)</Button>}
          </>
        ) : (
          <Button variant="primary" disabled={busy || (!fillPrompt.trim() && migan !== true)} onClick={() => run((p) => fillPrompt.trim() ? ml.generativeFillPrompt(fillPrompt, steps, p, gc()) : ml.generativeFill(p))}>
            {fillPrompt.trim() ? "Generative Fill (Prompt · Diffusion)" : migan === false ? "MI-GAN not installed" : "Generative Fill (MI-GAN)"}
          </Button>
        )}
        <Button variant="ghost" disabled={busy || migan !== true} onClick={() => run((p) => ml.generativeFill(p))}>Fill without prompt</Button>
      </div>
      {fillGate ? (
        <div role="alert" data-testid="mv-fill-downgrade" style={{ fontSize: 10.5, color: "var(--accent-raster)", marginTop: 6 }}>
          {fillGate === "missing"
            ? migan
              ? "A local MI-GAN model is available, but using it will ignore the prompt. Real SD-1.5 weights are not installed."
              : "No redistribution-cleared inpainting model is installed. Install licensed local SD or MI-GAN weights to enable this action."
            : "Demo weights — abstract output. Install real SD-1.5 weights for photographic results."}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Prompted fill needs licensed SD weights in <code>/models/sd15</code>. Prompt-free fill needs a separately installed licensed <code>/models/migan.onnx</code>.</div>
      )}
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
      <div ref={expandRef} style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Generative Expand <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— outpaint the canvas from its surroundings</span></div>
      <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", width: 40 }}>Amount</span>
        <NumberField value={expandPx} min={16} max={2048} suffix="px" onChange={setExpandPx} />
        <Select value={expandSides} aria-label="Expand sides" style={{ flex: 1 }}
          onChange={(v) => setExpandSides(v as ExpandSides)}
          options={[
            { value: "all", label: "All sides" },
            { value: "horizontal", label: "Left + Right" },
            { value: "vertical", label: "Top + Bottom" },
            { value: "left", label: "Left" },
            { value: "right", label: "Right" },
            { value: "top", label: "Top" },
            { value: "bottom", label: "Bottom" },
          ]} />
      </div>
      <Button variant="primary" disabled={busy || migan !== true} onClick={doExpand}>Generative Expand → New Layer</Button>
      {migan === false && <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Requires a licensed local <code>/models/migan.onnx</code>; no MI-GAN weights are shipped.</div>}
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
      <div ref={genRef} style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Generate Image <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— local text-to-image (Stable Diffusion, ONNX)</span></div>
      <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} block
        placeholder="Describe the image to generate…" style={{ fontSize: 12, marginBottom: 6 }} />
      <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", width: 40 }}>Steps</span>
        <Slider value={(steps - 4) / 46} accent="var(--accent-raster)" onChange={(f) => setSteps(Math.round(4 + f * 46))} style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, width: 24 }}>{steps}</span>
      </div>
      <Textarea value={negPrompt} onChange={(e) => setNegPrompt(e.target.value)} rows={1} block
        placeholder="Negative prompt — what to avoid (optional)" style={{ fontSize: 12, marginBottom: 6 }} />
      <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", width: 60 }}>Guidance</span>
        <Slider value={(guidance - 1) / 19} accent="var(--accent-raster)" onChange={(f) => setGuidance(Math.round((1 + f * 19) * 10) / 10)} style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, width: 28 }}>{guidance.toFixed(1)}</span>
      </div>
      <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", width: 60 }}>Seed</span>
        <NumberField value={seed} min={0} max={999999} onChange={(v) => setSeed(Math.round(v))} />
        <Button size="sm" variant="ghost" disabled={busy} aria-label="Randomize seed"
          onClick={() => setSeed(Math.floor(Math.random() * 100000))}>🎲</Button>
        <span style={{ fontSize: 10, color: "var(--text-3)", flex: 1 }}>Same seed + prompt reproduces an image.</span>
      </div>
      <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", width: 60 }}>Output</span>
        <Select id="mv-gen-output-size" aria-label="Generated output size" value={String(outputSize)} onChange={(v) => setOutputSize(Number(v))}
          options={[{ value: "512", label: "512 px (native)" }, { value: "1024", label: "1024 px (SR ×2)" }, { value: "2048", label: "2048 px (2K · SR ×4)" }]} />
        <span style={{ fontSize: 10, color: "var(--text-3)", flex: 1 }}>Above the native render, engine super-resolution finishes the size.</span>
      </div>
      <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", width: 60 }}>Strength</span>
        <Slider value={strength} accent="var(--accent-raster)" onChange={setStrength} style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, width: 28 }}>{strength.toFixed(2)}</span>
        <span style={{ fontSize: 10, color: "var(--text-3)", flex: 1 }}>img2img: how far to restyle the current image (low = subtle).</span>
      </div>
      <div className="monet-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" disabled={busy || !prompt.trim()} onClick={() => run((p) => ml.generateImage(prompt, steps, p, gc()))}>Generate → New Document</Button>
        <Button variant="ghost" disabled={busy || !prompt.trim()} data-mv-img2img
          onClick={() => run((p) => ml.generateImageReference(prompt, steps, strength, p, gc()))}>Restyle Current Image → New Document</Button>
        <Button variant="ghost" disabled={busy || !prompt.trim()} onClick={() => run((p) => ml.generateBackground(prompt, steps, p, gc()))}>Replace Background → Behind Subject</Button>
      </div>
      {sdGen && sdGen !== "real" && (
        <div role="alert" data-testid="mv-generate-downgrade" style={{ fontSize: 10.5, color: "var(--accent-raster)", marginTop: 6 }}>
          {sdGen === "demo" ? "Local demo weights — abstract output." : "Stable Diffusion weights are not installed."} Install real SD-1.5 weights (Manage AI Models…) for photographic results.
        </div>
      )}
      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Release builds omit the unlicensed test placeholder. Build a licensed Stable-Diffusion-1.5 ONNX set into <code>/models/sd15</code> for photographic results — see MODELS.md. “Replace Background” keeps the detected subject and repaints everything behind it from the prompt.</div>
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Enhance &amp; Select</div>
      <div className="monet-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run((p) => ml.superResolution(p))}>Super-Resolution 3×</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run((p) => ml.selectSubject(p))}>Select Subject</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run((p) => ml.removeBackground(p))}>Remove Background</Button>
      </div>
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
      <div ref={colRef} style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Colorize <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— learned color for grayscale photos</span></div>
      <MlRow label="Amount" value={colAmount} display={pct(colAmount) + "%"} onChange={setColAmount} />
      {/* Mirrors the ml.colorize facade fallback (no silent downgrade — the status line says so). */}
      <Button variant="primary" disabled={busy} onClick={() => run(async (p) => {
        try { await import("../ml/onnx").then((m) => m.colorizeML(p, colAmount)); }
        catch { p("AI model not installed — using heuristic colorize."); neural.colorize(); }
      })}>Colorize → New Layer</Button>
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
      <div ref={dbRef} style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Depth Blur <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— depth-aware bokeh (MiDaS)</span></div>
      <MlRow label="Focal Distance" value={dbFocal} display={pct(dbFocal) + "%"} onChange={setDbFocal} />
      <MlRow label="Blur Strength" value={dbStrength} max={2} display={dbStrength.toFixed(2)} onChange={setDbStrength} />
      <Button variant="primary" disabled={busy} onClick={() => run((p) => ml.depthBlur(dbFocal, dbStrength, p))}>Depth Blur → New Layer</Button>
      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Pixels at the focal distance stay sharp; blur grows with depth away from it.</div>
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
      <div ref={hzRef} style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Harmonize <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— relight the selection to match the backdrop</span></div>
      <MlRow label="Amount" value={hzAmount} display={pct(hzAmount) + "%"} onChange={setHzAmount} />
      <Button variant="primary" disabled={busy} onClick={() => run((p) => import("../ml/onnx").then((m) => m.harmonizeML(p, hzAmount)))}>Harmonize → New Layer</Button>
      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Uses the current selection as the region; the whole image when there is none.</div>
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
      <div ref={rsRef} style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Photo Restoration <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— learned JPEG-artifact cleanup</span></div>
      <MlRow label="Amount" value={rsAmount} display={pct(rsAmount) + "%"} onChange={setRsAmount} />
      {/* Mirrors the ml.restore facade fallback to the classic deblock filter. */}
      <Button variant="primary" disabled={busy} onClick={() => run(async (p) => {
        try { await import("../ml/onnx").then((m) => m.restoreML(p, rsAmount)); }
        catch { p("AI model not installed — using classic deblock."); engine.e.filter_deblock(3); engine.commit(); }
      })}>Restore → New Layer</Button>
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
      <FaceAwareLiquifySection busy={busy} run={run} state={fl} onState={setFl} sectionRef={flRef} />
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0" }} />
      <div ref={ssRef} style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Skin Smoothing <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— soften skin, keep eyes, lips and hair</span></div>
      <MlRow label="Blur" value={ssBlur} max={100} display={`${Math.round(ssBlur)}%`} onChange={setSsBlur} />
      <MlRow label="Smoothness" value={ssSmooth} max={100} display={`${Math.round(ssSmooth)}%`} onChange={setSsSmooth} />
      {/* One commit inside the facade, so the whole pass is one undo step. */}
      <Button variant="primary" disabled={busy} data-testid="mv-skin-smoothing-apply" onClick={async () => {
        let faces = -1;
        await run(async (p) => {
          const r = await ml.skinSmoothing(ssBlur, ssSmooth, p);
          if (!r.ok) throw new Error("Nothing to smooth — raise Blur above 0.");
          faces = r.faces;
        });
        // The facade's "no face model" progress line is overwritten by Done;
        // say it again where it stays readable, like the MCP tool does.
        if (faces === 0) setStatus("✓ Smoothed skin-toned areas — no face model installed, so the region came from skin tones alone. Install it under Manage AI Models.");
      }}>Smooth Skin</Button>
      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Restricted to detected faces when the face-landmark model is installed; otherwise skin-toned areas across the layer.</div>
      <MlJobStatus busy={busy} status={status} />
    </Dialog>
  );
}

// ── Type (text layer) dialog ───────────────────────────────────
// A live, re-editable Character/Paragraph/Effects/Warp editor. On open it
// creates (or loads) a type layer and re-renders it on every change through
// the shared `text` action layer. Character controls apply to the textarea
// selection (or the whole string when nothing is selected) as rich runs.
const toHex = (c: RGBA) => "#" + [c[0], c[1], c[2]].map((x) => Math.max(0, Math.min(255, x | 0)).toString(16).padStart(2, "0")).join("");
const fromHex = (h: string, a: number): RGBA => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]; };

function runAt(spec: TextSpec, idx: number): TextRun {
  let pos = 0;
  for (const r of spec.runs) { if (idx < pos + r.text.length) return r; pos += r.text.length; }
  return spec.runs[spec.runs.length - 1] ?? { text: "" };
}

function TField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 7 }}>
      <span className="lbl" style={{ width: 92, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>{children}</div>
    </div>
  );
}
function ColorBox({ value, onChange }: { value: RGBA; onChange: (c: RGBA) => void }) {
  return (
    <>
      <input type="color" value={toHex(value)} onChange={(e) => onChange(fromHex(e.target.value, value[3]))}
        aria-label="color" style={{ width: 34, height: 24, border: "none", background: "none", padding: 0, cursor: "pointer" }} />
      <NumberField value={value[3]} min={0} max={255} size="sm" suffix="α" onChange={(a) => onChange([value[0], value[1], value[2], a])} />
    </>
  );
}
function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="monet-section-label" style={{ marginTop: 12, marginBottom: 6 }}>{children}</div>;
}

function TypeDialog() {
  const { close } = useDialogs();
  const fontPreviewSize = useStore((snapshot) => snapshot.fontPreviewSize);
  const activeDocId = useStore((snapshot) => snapshot.activeDocId);
  const activeLayerId = useStore((snapshot) => snapshot.activeLayerId);
  const targetDocId = useRef(activeDocId).current;
  const targetEngine = useRef(engine.e as HistoryTransactionEngine).current;
  const idRef = useRef<number>(-1);
  const transactionRef = useRef(false);
  const doneRef = useRef(false);
  const labelPushesRef = useRef(0);
  const createdRef = useRef(false);
  const initialSpecRef = useRef<TextSpec | null>(null);
  const textSessionRef = useRef(false);
  const [actionMark] = useState(() => actions.mark());
  const actionDoneRef = useRef(false);
  const [spec, setSpec] = useState<TextSpec>(() => text.defaultSpec("Type"));
  const [sel, setSel] = useState<[number, number]>([0, 0]);

  const onTarget = () => engine.engine === targetEngine
    && store.state.activeDocId === targetDocId
    && (idRef.current < 0 || store.state.activeLayerId === idRef.current);
  const rollbackAction = () => {
    if (actionDoneRef.current) return;
    actions.rollback(actionMark);
    actionDoneRef.current = true;
  };
  const cancelTransaction = () => {
    if (textSessionRef.current) {
      targetEngine.text_edit_session(false);
      textSessionRef.current = false;
    }
    if (transactionRef.current) {
      const cancelled = targetEngine.cancel_history_transaction();
      transactionRef.current = false;
      if (cancelled && engine.engine === targetEngine) engine.refreshFromEngine();
    }
    rollbackAction();
  };

  useEffect(() => {
    if (!onTarget() || !targetEngine.begin_history_transaction()) {
      doneRef.current = true;
      rollbackAction();
      close();
      return;
    }
    transactionRef.current = true;
    try {
      const beforeLabel = targetEngine.undo_pushes();
      targetEngine.push_history("Type");
      if (targetEngine.undo_pushes() === beforeLabel) {
        doneRef.current = true;
        cancelTransaction();
        close();
        return;
      }
      labelPushesRef.current = targetEngine.undo_pushes();
      targetEngine.text_edit_session(true);
      textSessionRef.current = true;
      const pend = text.pending;
      text.pending = null;
      let openedExisting = false;
      if (pend && pend.mode === "edit") {
        const s = text.get(pend.id);
        if (s) {
          idRef.current = pend.id;
          initialSpecRef.current = s;
          setSpec(s);
          setSel([0, text.fullText(s).length]);
          openedExisting = true;
        }
      }
      if (!openedExisting) {
        const [r, g, b] = hsvToRgba(store.state.fg);
        const base = text.defaultSpec("Type", {
          ax: pend?.ax ?? 80, ay: pend?.ay ?? 80,
          color: [r, g, b, 255], size: Math.max(24, Math.round(store.state.brush.size * 2)),
        });
        const id = text.create(base);
        idRef.current = id;
        createdRef.current = true;
        setSpec(base); setSel([0, text.fullText(base).length]);
      }
    } catch (error) {
      cancelTransaction();
      throw error;
    }
    return () => { if (!doneRef.current) cancelTransaction(); };
    // The captured engine and mutable refs intentionally belong to this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (transactionRef.current && idRef.current >= 0 && !onTarget()) {
      doneRef.current = true;
      cancelTransaction();
      close();
    }
    // `active*` subscribe this dialog to a target switch; current values come
    // from store.state so cleanup and callbacks never use a stale document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId, activeLayerId]);

  const apply = (next: TextSpec) => {
    if (!transactionRef.current || !onTarget()) {
      doneRef.current = true;
      cancelTransaction();
      close();
      return;
    }
    setSpec(next);
    if (idRef.current >= 0) text.apply(idRef.current, next);
  };
  const patch = (p: Partial<TextSpec>) => apply({ ...spec, ...p });
  const patchWarp = (p: Partial<TextSpec["warp"]>) => apply({ ...spec, warp: { ...spec.warp, ...p } });
  const charPatch = (p: Partial<TextRun>) => {
    const len = text.fullText(spec).length;
    const [a, b] = sel[0] !== sel[1] ? sel : [0, len];
    apply({ ...spec, runs: text.applyRangeFormat(spec.runs, a, b, p) });
  };
  const st = text.resolveStyle(spec, runAt(spec, sel[0]));

  // Cancel restores the opening document and its exact redo branch; OK keeps
  // the Type session's real edits and ends that old branch. (#97)
  const cancel = () => {
    doneRef.current = true;
    cancelTransaction();
    close();
  };
  const finish = () => {
    if (!onTarget()) { cancel(); return; }
    doneRef.current = true;
    const finalSpec = idRef.current >= 0 ? text.get(idRef.current) : null;
    const changed = createdRef.current
      || JSON.stringify(finalSpec) !== JSON.stringify(initialSpecRef.current);
    if (!changed) { cancelTransaction(); close(); return; }
    if (textSessionRef.current) {
      targetEngine.text_edit_session(false);
      textSessionRef.current = false;
    }
    let childPushes = Math.max(0, Math.round(targetEngine.undo_pushes() - labelPushesRef.current));
    while (childPushes-- > 0) targetEngine.drop_last_undo();
    const committed = transactionRef.current && targetEngine.commit_history_transaction();
    transactionRef.current = false;
    if (committed) {
      if (finalSpec) {
        if (createdRef.current) {
          actions.commit(actionMark, () => { text.create(finalSpec); }, ["text.create", [finalSpec]]);
        } else {
          const id = idRef.current;
          actions.commit(actionMark, () => text.apply(id, finalSpec), ["text.apply", [id, finalSpec]]);
        }
      } else {
        actions.rollback(actionMark);
      }
      actionDoneRef.current = true;
      if (engine.engine === targetEngine) engine.commit();
    } else {
      if (engine.engine === targetEngine) engine.refreshFromEngine();
      rollbackAction();
    }
    close();
  };

  const fontOpts = text.FONTS.map((f) => ({
    value: f,
    label: f.split(",")[0].replace(/['"]/g, ""),
    style: fontPreviewOptionStyle(f, fontPreviewSize),
  }));
  const faces = fontStyles(st.font);
  const warpOpts = text.WARP_STYLES.map((w) => ({ value: w.id, label: w.label }));
  const kerningOpts = text.KERNING.map((k) => ({ value: k, label: text.KERNING_LABELS[k] }));

  return (
    <Dialog open onClose={cancel} title="Type" width={540}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" onClick={finish}>OK</Button></>}>
      <div style={{ maxHeight: "66vh", overflowY: "auto", paddingRight: 4 }}>
        <Textarea aria-label="Text" value={text.fullText(spec)} rows={2} block
          onChange={(e) => apply(text.setText(spec, e.target.value))}
          onSelect={(e) => { const t = e.currentTarget; setSel([t.selectionStart ?? 0, t.selectionEnd ?? 0]); }} />

        <SectionLabel>Character {sel[0] !== sel[1] ? `· selection ${sel[0]}–${sel[1]}` : "· all"}</SectionLabel>
        <TField label="Font"><Select block options={fontOpts} value={st.font} onChange={(v) => charPatch({ font: v })} /></TField>
        <TField label="Style">
          <Select block aria-label="Font style" value={matchFontStyle(faces, st.weight, st.italic, st.face)}
            options={faces.map((f) => ({ value: f.value, label: f.label }))}
            onChange={(v) => { const p = fontStylePatch(st.font, v); if (p) charPatch(p); else engine.onEditError?.(unknownFontStyleMessage(st.font)); }} />
        </TField>
        <TField label="Size"><NumberField value={Math.round(st.size)} min={1} max={800} suffix="px" onChange={(v) => charPatch({ size: v })} />
          <NumberField value={Math.round(st.tracking)} min={-50} max={200} suffix="tr" onChange={(v) => charPatch({ tracking: v })} /></TField>
        <TField label="Kerning">
          <Select options={kerningOpts} value={st.kerning} onChange={(v) => charPatch({ kerning: v as TextRun["kerning"] })} />
        </TField>
        <TField label="Color"><ColorBox value={st.color} onChange={(c) => charPatch({ color: c })} /></TField>
        <TField label="Emphasis">
          <Checkbox checked={st.bold} onChange={(v) => charPatch({ weight: v ? 700 : 400, bold: v })}><span style={{ fontWeight: 800 }}>B</span></Checkbox>
          <Checkbox checked={st.italic} onChange={(v) => charPatch({ italic: v })}><span style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}>I</span></Checkbox>
          <Checkbox checked={st.underline} onChange={(v) => charPatch({ underline: v })}><span style={{ textDecoration: "underline" }}>U</span></Checkbox>
          <Checkbox checked={st.strike} onChange={(v) => charPatch({ strike: v })}><span style={{ textDecoration: "line-through" }}>S</span></Checkbox>
        </TField>
        <TField label="Faux">
          <Checkbox checked={st.fauxBold} onChange={(v) => charPatch({ fauxBold: v })}>Bold</Checkbox>
          <Checkbox checked={st.fauxItalic} onChange={(v) => charPatch({ fauxItalic: v })}>Italic</Checkbox>
        </TField>
        <TField label="Case / Pos">
          <Select options={[{ value: "none", label: "Normal" }, { value: "all", label: "ALL CAPS" }, { value: "small", label: "Small Caps" }]}
            value={st.caps} onChange={(v) => charPatch({ caps: v as "none" | "all" | "small" })} />
          <Select options={[{ value: "none", label: "Baseline" }, { value: "super", label: "Super" }, { value: "sub", label: "Sub" }]}
            value={st.script} onChange={(v) => charPatch({ script: v as "none" | "super" | "sub" })} />
        </TField>
        <TField label="Scale">
          <NumberField value={Math.round(st.hScale * 100)} min={10} max={400} suffix="%H" onChange={(v) => charPatch({ hScale: v / 100 })} />
          <NumberField value={Math.round(st.vScale * 100)} min={10} max={400} suffix="%V" onChange={(v) => charPatch({ vScale: v / 100 })} />
          <NumberField value={Math.round(st.baseline)} min={-200} max={200} suffix="bl" onChange={(v) => charPatch({ baseline: v })} />
        </TField>
        <TField label="Leading / AA">
          <NumberField value={Math.round(spec.leading)} min={0} max={400} suffix="px" onChange={(v) => patch({ leading: v })} />
          <Select options={text.ANTIALIAS.map((a) => ({ value: a, label: text.ANTIALIAS_LABELS[a] }))} value={spec.antialias}
            onChange={(v) => patch({ antialias: v as TextSpec["antialias"] })} />
        </TField>

        <SectionLabel>Paragraph</SectionLabel>
        <TField label="Box">
          <SegmentedControl accent={ACCENT} value={spec.kind} onChange={(v) => patch({ kind: v as "point" | "paragraph" })}
            items={[{ value: "point", label: "Point" }, { value: "paragraph", label: "Paragraph" }]} />
          <SegmentedControl accent={ACCENT} value={spec.vertical ? "v" : "h"} onChange={(v) => patch({ vertical: v === "v" })}
            items={[{ value: "h", label: "Horiz" }, { value: "v", label: "Vert" }]} />
        </TField>
        <TField label="Align">
          <SegmentedControl accent={ACCENT} value={spec.align} onChange={(v) => patch({ align: v as Align })}
            items={text.ALIGNMENTS.map((a) => ({ value: a.id, label: a.label }))} />
        </TField>
        <TField label="Direction">
          <SegmentedControl accent={ACCENT} value={spec.direction ?? "ltr"} onChange={(v) => patch({ direction: v as TextSpec["direction"] })}
            items={text.DIRECTIONS.map((d) => ({ value: d.id, label: d.label }))} />
        </TField>
        <TField label="Composer">
          <Select block options={text.COMPOSERS.map((c) => ({ value: c.id, label: c.label }))} value={spec.composer ?? "latin"}
            onChange={(v) => patch({ composer: v as TextSpec["composer"] })} />
        </TField>
        <SectionLabel>Middle Eastern</SectionLabel>
        <TField label="Digits">
          <Select options={[
            { value: "latin", label: "Latin" },
            { value: "arabic", label: "Arabic" },
            { value: "hindi", label: "Hindi" },
          ]} value={spec.digits ?? "latin"} onChange={(v) => patch({ digits: v as TextSpec["digits"] })} />
          <Select options={text.KASHIDAS.map((k) => ({ value: k.id, label: k.label }))} value={spec.kashida ?? "none"}
            onChange={(v) => patch({ kashida: v as TextSpec["kashida"] })} />
        </TField>
        <TField label="Diacritics">
          <NumberField value={Math.round(spec.diacriticX ?? 0)} min={-120} max={120} suffix="x" onChange={(v) => patch({ diacriticX: v })} />
          <NumberField value={Math.round(spec.diacriticY ?? 0)} min={-120} max={120} suffix="y" onChange={(v) => patch({ diacriticY: v })} />
        </TField>
        {spec.kind === "paragraph" && (
          <TField label="Box size">
            <NumberField value={Math.round(spec.boxW)} min={16} max={4000} suffix="w" onChange={(v) => patch({ boxW: v })} />
            <NumberField value={Math.round(spec.boxH)} min={0} max={4000} suffix="h" onChange={(v) => patch({ boxH: v })} />
          </TField>
        )}
        <TField label="Indent">
          <NumberField value={Math.round(spec.firstIndent)} min={-400} max={400} suffix="1st" onChange={(v) => patch({ firstIndent: v })} />
          <NumberField value={Math.round(spec.leftIndent)} min={0} max={400} suffix="L" onChange={(v) => patch({ leftIndent: v })} />
          <NumberField value={Math.round(spec.rightIndent)} min={0} max={400} suffix="R" onChange={(v) => patch({ rightIndent: v })} />
        </TField>
        <TField label="Spacing">
          <NumberField value={Math.round(spec.spaceBefore)} min={0} max={400} suffix="↑" onChange={(v) => patch({ spaceBefore: v })} />
          <NumberField value={Math.round(spec.spaceAfter)} min={0} max={400} suffix="↓" onChange={(v) => patch({ spaceAfter: v })} />
        </TField>

        <SectionLabel>Effects</SectionLabel>
        <TField label="Stroke">
          <Checkbox checked={!!spec.stroke} onChange={(v) => patch({ stroke: v ? { width: 4, color: [0, 0, 0, 255] } : null })}>On</Checkbox>
          {spec.stroke && <NumberField value={spec.stroke.width} min={0} max={60} suffix="px" onChange={(v) => patch({ stroke: { ...spec.stroke!, width: v } })} />}
          {spec.stroke && <ColorBox value={spec.stroke.color} onChange={(c) => patch({ stroke: { ...spec.stroke!, color: c } })} />}
        </TField>
        <TField label="Shadow">
          <Checkbox checked={!!spec.shadow} onChange={(v) => patch({ shadow: v ? { color: [0, 0, 0, 200], blur: 6, dx: 4, dy: 4 } : null })}>On</Checkbox>
          {spec.shadow && <NumberField value={spec.shadow.blur} min={0} max={80} suffix="blur" onChange={(v) => patch({ shadow: { ...spec.shadow!, blur: v } })} />}
        </TField>
        {spec.shadow && (
          <TField label="Shadow xy">
            <NumberField value={spec.shadow.dx} min={-80} max={80} suffix="x" onChange={(v) => patch({ shadow: { ...spec.shadow!, dx: v } })} />
            <NumberField value={spec.shadow.dy} min={-80} max={80} suffix="y" onChange={(v) => patch({ shadow: { ...spec.shadow!, dy: v } })} />
            <ColorBox value={spec.shadow.color} onChange={(c) => patch({ shadow: { ...spec.shadow!, color: c } })} />
          </TField>
        )}

        <SectionLabel>Warp</SectionLabel>
        <TField label="Style">
          <Select block options={warpOpts} value={spec.warp.style} onChange={(v) => patchWarp({ style: v as TextSpec["warp"]["style"] })} />
        </TField>
        <TField label="Orientation">
          <SegmentedControl aria-label="Warp orientation" value={spec.warp.orient}
            onChange={(v) => patchWarp({ orient: v as TextSpec["warp"]["orient"] })}
            items={[{ value: "h", label: "Horizontal" }, { value: "v", label: "Vertical" }]} />
        </TField>
        <Row label="Bend" value={spec.warp.bend} min={-1} max={1} onChange={(v) => patchWarp({ bend: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Row label="Distort H" value={spec.warp.h} min={-1} max={1} onChange={(v) => patchWarp({ h: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Row label="Distort V" value={spec.warp.v} min={-1} max={1} onChange={(v) => patchWarp({ v: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </div>
    </Dialog>
  );
}

// ── Type on a Path Options ─────────────────────────────────────
// Type ▸ Text on Path ▸ Type on a Path Options…: retune a type layer that is
// already bound to a path — Text on Path used to be one-shot. Photoshop drags
// the start/end brackets along the path and flips the run by dragging across
// the line; the same five model fields (layoutOnPath in text/raster.ts) are
// numbers here, applied live through text.setOnPathOptions so every change
// lands as one recordable type step on the active layer. (#451)
// ponytail: numeric start/end window, no on-canvas brackets — add those to the
// pen-path overlay in CanvasView when drag handles land.
type OnPathOpts = Required<Pick<TextSpec, "pathStart" | "pathEnd" | "pathFlip" | "pathAlign" | "pathSpacing">>;

export function OnPathOptions() {
  const { close } = useDialogs();
  const activeLayerId = useStore((s) => s.activeLayerId);
  const spec = text.get(activeLayerId);
  const path = spec?.path;
  const len = path && path.length >= 4 ? pathMetrics(path).len : 0;
  // Modal, so nothing else edits the layer while it is open: seed the draft off
  // the engine's spec once and keep the controlled fields cursor-safe from it.
  const [opts, setOpts] = useState<OnPathOpts>(() => ({
    pathStart: spec?.pathStart ?? 0,
    pathEnd: spec?.pathEnd ?? 0,
    pathFlip: spec?.pathFlip ?? false,
    pathAlign: spec?.pathAlign ?? "baseline",
    pathSpacing: spec?.pathSpacing ?? 0,
  }));
  // Live-apply: every field lands on the layer through the recorded facade, so
  // you see the run move on the canvas and each change is an undoable type step.
  const set = (p: Partial<OnPathOpts>) => { setOpts({ ...opts, ...p }); text.setOnPathOptions(p); };
  const max = Math.max(1, Math.round(len));

  return (
    <Dialog open onClose={close} title="Type on a Path Options" width={400}
      footer={<Button variant="primary" onClick={close}>Done</Button>}>
      {len === 0 ? (
        <div className="lbl" style={{ color: "var(--text-3)", fontSize: 11 }}>
          The active layer isn't type on a path. Draw one with the Pen tool, then Type ▸ Text on Path ▸ Bind to Work Path.
        </div>
      ) : (
        <>
          <TField label="Align to path">
            <Select block aria-label="Align to path" options={text.PATH_ALIGNS.map((a) => ({ value: a.id, label: a.label }))}
              value={opts.pathAlign} onChange={(v) => set({ pathAlign: v as OnPathOpts["pathAlign"] })} />
          </TField>
          <TField label="Flip">
            <Checkbox checked={opts.pathFlip} onChange={(v) => set({ pathFlip: v })}>Flip across the path</Checkbox>
          </TField>
          <TField label="Spacing">
            <NumberField aria-label="Spacing" value={Math.round(opts.pathSpacing)} min={-40} max={200} suffix="px"
              onChange={(v) => set({ pathSpacing: v })} />
          </TField>
          <TField label="Start / End">
            <NumberField aria-label="Start" value={Math.round(opts.pathStart)} min={0} max={max} suffix="px"
              onChange={(v) => set({ pathStart: v })} />
            <NumberField aria-label="End" value={Math.round(opts.pathEnd)} min={0} max={max} suffix="px"
              onChange={(v) => set({ pathEnd: v })} />
          </TField>
          <div className="lbl" style={{ marginTop: 8, color: "var(--text-3)", fontSize: 11 }}>
            Brackets are arc length along the {max}px path; End 0 runs to the end of it.
          </div>
        </>
      )}
    </Dialog>
  );
}

// ── Type toolbar (docked top, shown whenever a type layer is selected) ──
// A Photoshop-style type options bar: a single compact row of icon controls —
// orientation toggle, font + B/I/U/S, size + anti-alias, alignment glyphs, a
// colour swatch and a warp button. Mounted by App's OptionsForTool when the
// active layer is a type layer; keyed by layer id so switching layers reloads
// its spec. Character controls format the whole layer; the advanced bits (warp
// params, layer effects, full paragraph) open the Type dialog via the ⌒ button.
// Photoshop edits the string on-canvas; lacking that, we keep a compact text
// field at the head of the bar.
const TT_ICON = {
  orientH: "M3 4h10M8 4v9",
  orientV: "M4 3v10M4 8h9",
  alignLeft: "M2 3h12v1.7H2z M2 6.4h8v1.7H2z M2 9.8h12v1.7H2z M2 13.2h8v1.7H2z",
  alignCenter: "M2 3h12v1.7H2z M4 6.4h8v1.7H4z M2 9.8h12v1.7H2z M4 13.2h8v1.7H4z",
  alignRight: "M2 3h12v1.7H2z M6 6.4h8v1.7H6z M2 9.8h12v1.7H2z M6 13.2h8v1.7H6z",
  alignJustify: "M2 3h12v1.7H2z M2 6.4h12v1.7H2z M2 9.8h12v1.7H2z M2 13.2h12v1.7H2z",
  warp: "M2 11C5 8 11 8 14 11 M5.5 4.5h5 M8 4.5v6.6",
};

export function TypeToolbar({ id }: { id: number }) {
  const { open } = useDialogs();
  const fontPreviewSize = useStore((snapshot) => snapshot.fontPreviewSize);
  // The engine owns the spec; we mirror it locally for cursor-safe editing of
  // the controlled inputs, then re-adopt the engine's copy whenever it changes
  // underneath us (advanced Type dialog, undo/redo). `pushed` is a baseline of
  // our own last write so external changes are told apart from our own.
  const engineSpec = text.get(id) ?? text.defaultSpec("Type");
  const engineJson = JSON.stringify(engineSpec);
  const pushed = useRef(engineJson);
  const [spec, setSpec] = useState<TextSpec>(engineSpec);
  if (engineJson !== pushed.current) { pushed.current = engineJson; setSpec(engineSpec); }

  const apply = (next: TextSpec) => { pushed.current = JSON.stringify(next); setSpec(next); text.apply(id, next); };
  const patch = (p: Partial<TextSpec>) => apply({ ...spec, ...p });
  const charAll = (p: Partial<TextRun>) => {
    const len = text.fullText(spec).length;
    apply({ ...spec, runs: text.applyRangeFormat(spec.runs, 0, len, p) });
  };
  const st = text.resolveStyle(spec, runAt(spec, 0));
  const fontOpts = text.FONTS.map((f) => ({
    value: f,
    label: f.split(",")[0].replace(/['"]/g, ""),
    style: fontPreviewOptionStyle(f, fontPreviewSize),
  }));
  const aaOpts = text.ANTIALIAS.map((a) => ({ value: a, label: text.ANTIALIAS_LABELS[a] }));
  const kerningOpts = text.KERNING.map((k) => ({ value: k, label: text.KERNING_LABELS[k] }));
  // The family's registered subfamilies (the generic four in the browser build).
  const faces = fontStyles(st.font);
  const axes = fontAxes(st.font, st.face);

  const btn = (label: string, on: boolean, onClick: () => void, glyph: ReactNode) => (
    <button type="button" className={"mv-tt-btn" + (on ? " is-on" : "")} aria-label={label} aria-pressed={on} title={label} onClick={onClick}>
      {glyph}
    </button>
  );
  const alignBtn = (a: Align, d: string, label: string) =>
    btn(label, spec.align === a, () => patch({ align: a }), <Icon d={d} size={15} fill />);

  return (
    <OptionsBar>
      <OptionsBar.Group>
        <span className="mv-tt-tlabel" aria-hidden="true"><Icon d={I.text} size={14} /></span>
        <Textarea aria-label="Text content" className="mv-tt-text" value={text.fullText(spec)} rows={1}
          onChange={(e) => apply(text.setText(spec, e.target.value))}
          style={{ width: 150, height: 28, minHeight: 0, resize: "none", boxSizing: "border-box", padding: "0 9px", lineHeight: "28px" }} />
        {btn(spec.vertical ? "Vertical type" : "Horizontal type", spec.vertical, () => patch({ vertical: !spec.vertical }),
          <Icon d={spec.vertical ? TT_ICON.orientV : TT_ICON.orientH} size={15} />)}
      </OptionsBar.Group>

      <OptionsBar.Group>
        <span className="mv-tt-font"><Select block aria-label="Font" options={fontOpts} value={st.font} onChange={(v) => charAll({ font: v })} /></span>
        <span className="mv-tt-style"><Select block aria-label="Font style" value={matchFontStyle(faces, st.weight, st.italic, st.face)}
          options={faces.map((f) => ({ value: f.value, label: f.label }))}
          onChange={(v) => { const p = fontStylePatch(st.font, v); if (p) charAll(p); else engine.onEditError?.(unknownFontStyleMessage(st.font)); }} /></span>
        {axes.map((axis) => <span key={axis.tag} style={{ display: "flex", alignItems: "center", gap: 6, width: 130 }}>
          <span style={{ fontSize: 11 }}>{axisLabel(axis.tag)}</span>
          <Slider aria-label={`Font ${axisLabel(axis.tag)}`} min={axis.min} max={axis.max} step={axisStep(axis)}
            value={axis.tag === "wght" ? st.weight : st.axes[axis.tag] ?? axis.def}
            onChange={(value) => charAll(axis.tag === "wght" ? { weight: value } : { axes: { [axis.tag]: value } })} />
        </span>)}
        {btn("Bold", st.bold, () => charAll({ weight: st.bold ? 400 : 700, bold: !st.bold }), <span style={{ fontWeight: 800 }}>B</span>)}
        {btn("Italic", st.italic, () => charAll({ italic: !st.italic }), <span style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}>I</span>)}
        {btn("Underline", st.underline, () => charAll({ underline: !st.underline }), <span style={{ textDecoration: "underline" }}>U</span>)}
        {btn("Strikethrough", st.strike, () => charAll({ strike: !st.strike }), <span style={{ textDecoration: "line-through" }}>S</span>)}
      </OptionsBar.Group>

      <OptionsBar.Group>
        <NumberField aria-label="Size" value={Math.round(st.size)} min={1} max={800} size="sm" suffix="px" onChange={(v) => charAll({ size: v })} />
        <span className="mv-tt-kern"><Select block size="sm" aria-label="Kerning" options={kerningOpts} value={st.kerning}
          onChange={(v) => charAll({ kerning: v as TextRun["kerning"] })} /></span>
        <span className="mv-tt-aa"><Select block size="sm" aria-label="Anti-alias" options={aaOpts} value={spec.antialias}
          onChange={(v) => patch({ antialias: v as TextSpec["antialias"] })} /></span>
      </OptionsBar.Group>

      <OptionsBar.Group>
        {alignBtn("left", TT_ICON.alignLeft, "Align left")}
        {alignBtn("center", TT_ICON.alignCenter, "Align center")}
        {alignBtn("right", TT_ICON.alignRight, "Align right")}
        {alignBtn("justify", TT_ICON.alignJustify, "Justify")}
      </OptionsBar.Group>

      <OptionsBar.Group>
        <input type="color" className="mv-tt-color" aria-label="Text color" value={toHex(st.color)}
          onChange={(e) => charAll({ color: fromHex(e.target.value, st.color[3]) })} />
        {btn("Warp / FX…", false, () => { text.pending = { mode: "edit", id, ax: 0, ay: 0 }; open("type"); }, <Icon d={TT_ICON.warp} size={15} />)}
      </OptionsBar.Group>
    </OptionsBar>
  );
}

// ── Blending Options / Layer Style ─────────────────────────────
const BLEND_OPTS = BLEND_ORDER.map((k, i) => ({ value: String(i), label: titleCase(k) }));

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function hexFromRgb01(p: number[], i: number): string {
  const c = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");
  return `#${c(p[i])}${c(p[i + 1])}${c(p[i + 2])}`;
}
function rgb01FromHex(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255];
}

/** Advanced Blending ▸ Channels, in Photoshop's R G B order. */
const BLEND_CHANNEL_BITS = [
  { bit: 1, label: "R" },
  { bit: 2, label: "G" },
  { bit: 4, label: "B" },
];

function SelectRow({ label, value, options, onChange }: {
  label: string; value: number; options: { value: string; label: string }[]; onChange: (v: number) => void;
}) {
  return (
    <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
      <span className="lbl" style={{ width: 110 }}>{label}</span>
      <Select size="sm" options={options} value={String(Math.round(value))} onChange={(v) => onChange(+v)} aria-label={label} />
    </div>
  );
}

function ColorRow({ label, hex, onChange }: { label: string; hex: string; onChange: (hex: string) => void }) {
  return (
    <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
      <span className="lbl" style={{ width: 110 }}>{label}</span>
      <input type="color" value={hex} aria-label={label} onChange={(e) => onChange(e.target.value)}
        style={{ width: 36, height: 24, padding: 0, border: "1px solid var(--glass-2)", borderRadius: 4, background: "none", cursor: "pointer" }} />
      <span style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" }}>{hex}</span>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
      <span className="lbl" style={{ width: 110 }}>{label}</span>
      <Checkbox checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

function FxFieldRow({ field, params, set, end, globalLightSlot }: {
  field: FxField; params: number[]; set: (updates: Record<number, number>) => void; end?: () => void; globalLightSlot?: number;
}) {
  const i = field.i;
  switch (field.k) {
    case "blend":
      return <SelectRow label={field.label} value={params[i]} options={BLEND_OPTS} onChange={(v) => set({ [i]: v })} />;
    case "opacity":
    case "unit":
      return <Row label={field.label} value={Math.round(params[i] * 100)} min={0} max={100} suffix="%" onChange={(v) => set({ [i]: v / 100 })} onChangeEnd={end} />;
    case "angle":
      return (
        <>
          <Row label={field.label} value={Math.round(params[i])} min={0} max={360} suffix="°" onChange={(v) => set({ [i]: Math.round(v) })} onChangeEnd={end} />
          {globalLightSlot !== undefined && (
            <ToggleRow label="Use Global Light" checked={(params[globalLightSlot] ?? 1) >= 0.5} onChange={(b) => set({ [globalLightSlot]: b ? 1 : 0 })} />
          )}
        </>
      );
    case "px":
      return <Row label={field.label} value={Math.round(params[i])} min={field.min} max={field.max} suffix=" px" onChange={(v) => set({ [i]: Math.round(v) })} onChangeEnd={end} />;
    case "num":
      return <Row label={field.label} value={params[i]} min={field.min} max={field.max} step={field.step} decimals={field.step && field.step < 1 ? 2 : 0} onChange={(v) => set({ [i]: v })} onChangeEnd={end} />;
    case "color":
      return <ColorRow label={field.label} hex={hexFromRgb01(params, i)} onChange={(hex) => { const [r, g, b] = rgb01FromHex(hex); set({ [i]: r, [i + 1]: g, [i + 2]: b }); }} />;
    case "select":
      return <SelectRow label={field.label} value={params[i]} options={field.options.map((o, idx) => ({ value: String(idx), label: o }))} onChange={(v) => set({ [i]: v })} />;
    case "contour":
      // Values are not option indices: built-ins are 0-5 and custom curves are
      // 100 + their library position, so the options carry explicit values.
      return <ContourRow value={params[i]} onChange={(v) => set({ [i]: v })} />;
    case "pattern":
      // Also not option indices: 0-3 are the procedural kinds and anything
      // above is a library tile's id (see state/effects.ts).
      return <PatternRow label={field.label} value={params[i]} onChange={(v) => set({ [i]: v })} />;
    case "toggle":
      return <ToggleRow label={field.label} checked={params[i] >= 0.5} onChange={(b) => set({ [i]: b ? 1 : 0 })} />;
  }
}

/** One contour slot: the built-in shapes, the document's custom curves, and the
 *  way into the Contour Editor — Photoshop opens it from the thumbnail. */
function ContourRow({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { open } = useDialogs();
  const library = useStore((s) => s.contours);
  const options = [
    ...BUILTIN_CONTOURS.map((label, i) => ({ value: String(i), label })),
    ...library.map((c, i) => ({ value: String(customContourSlot(i)), label: c.name })),
  ];
  // A style can outlive the curve it named; fall back to Linear rather than
  // showing an empty select.
  const known = options.some((o) => o.value === String(value));
  return (
    <div className="monet-row" style={{ gap: 8, marginBottom: 6, alignItems: "center" }}>
      <span className="lbl" style={{ width: 96 }}>Contour</span>
      <Select value={String(known ? value : 0)} onChange={(v) => onChange(+v)}
        options={options} aria-label="Contour" />
      <Button size="sm" variant="ghost" onClick={() => open("contourEditor")}
        title="Create or edit custom contours">Edit…</Button>
    </div>
  );
}

/** One pattern slot: the procedural kinds, then the Patterns library itself —
 *  Photoshop puts a picker in the Layer Style dialog, so the tile is chosen
 *  without leaving it and two effects can hold two different patterns. */
function PatternRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const presets = useStore((s) => s.patternPresets);
  const picked = isLibraryPattern(value)
    ? presets.findIndex((p) => patternLibraryId(p.name) === Math.round(value))
    : -1;
  const options = [
    ...PATTERNS.map((label, i) => ({ value: String(i), label })),
    ...presets.map((p) => ({ value: String(patternLibraryId(p.name)), label: p.name })),
  ];
  // A style outlives the pattern it named (deleted, renamed, or authored on
  // another machine); say so rather than showing an empty select.
  const orphan = isLibraryPattern(value) && picked < 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 110 }}>{label}</span>
        <Select size="sm" aria-label={label} value={orphan ? "0" : String(Math.round(value))}
          options={orphan ? [...options, { value: String(Math.round(value)), label: "(missing pattern)" }] : options}
          onChange={(v) => onChange(+v)} />
      </div>
      {(isLibraryPattern(value) || Math.round(value) === PATTERNS.length - 1) && (
        <div data-mv-style-pattern-picker role="listbox" aria-label={`${label} library`}
          style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 0 120px" }}>
          {presets.length === 0 && (
            <span style={{ color: "var(--text-3)", fontSize: 11 }}>
              No patterns yet — Edit ▸ Define Pattern captures the selection as one.
            </span>
          )}
          {presets.map((preset, i) => {
            const tooBig = !fitsStylePattern(preset);
            return (
              <button key={`${preset.name}-${i}`} type="button" role="option" data-mv-style-pattern-swatch
                aria-selected={i === picked} disabled={tooBig}
                aria-label={preset.name}
                title={tooBig ? `${preset.name} — too large to use in a layer style` : preset.name}
                onClick={() => onChange(patternLibraryId(preset.name))}
                style={{ padding: 2, borderRadius: 4, cursor: tooBig ? "not-allowed" : "pointer", opacity: tooBig ? 0.4 : 1,
                  background: "var(--surface-2, rgba(255,255,255,0.05))",
                  border: `2px solid ${i === picked ? "var(--accent, #4a9eff)" : "transparent"}` }}>
                <PatternSwatch preset={preset} size={26} />
              </button>
            );
          })}
        </div>
      )}
      {orphan && (
        <div style={{ fontSize: 10, color: "var(--warn, #e0a020)", margin: "4px 0 0 120px" }}>
          This style names a pattern that is not in the library — pick one above.
        </div>
      )}
    </div>
  );
}

function LayerStyle() {
  const { close, arg } = useDialogs();
  const activeDocId = useStore((s) => s.activeDocId);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const activeDocument = useStore((s) => s.documents.find((d) => d.id === s.activeDocId));
  const targetDocId = useRef(activeDocId).current;
  const id = useRef(activeLayerId).current;
  const targetEngine = useRef(engine.e as HistoryTransactionEngine).current;
  const transactionRef = useRef(false);
  const doneRef = useRef(false);
  const invalidRef = useRef(false);
  const [actionMark] = useState(() => actions.mark());
  const actionDoneRef = useRef(false);
  const [fillOp, setFillOp] = useState(() => store.fillOpacity(id));
  const [knock, setKnock] = useState(() => store.knockout(id));
  const [txShapes, setTxShapes] = useState(() => store.transparencyShapes(id));
  const [blendGroup, setBlendGroup] = useState(() => store.blendInteriorGroup(id));
  const [blendClipped, setBlendClipped] = useState(() => store.blendClippedGroup(id));
  const [blendChans, setBlendChans] = useState(() => store.layerBlendChannels(id));
  const [bif, setBif] = useState<number[]>(() => { const v = store.blendIf(id); return v.length === 32 ? v : defaultBlendIf(); });
  const [biChan, setBiChan] = useState(0);
  // Per fx id, every instance's params in render order (bottom→top) — up to
  // FX_MAX_INSTANCES of a type (stacked strokes, layered shadows).
  const [fx, setFx] = useState<Record<number, number[][]>>(() => {
    const o: Record<number, number[][]> = {};
    for (const d of FX_DEFS) {
      const count = store.effectInstanceCount(id, d.id);
      o[d.id] = Array.from({ length: count }, (_, i) => store.effectParamsAt(id, d.id, i));
    }
    return o;
  });
  // Snapshot only for the OK no-change check; the engine transaction restores
  // Cancel/unmount exactly, including redo and a full History-States stack.
  const snap = useRef<{ fillOp: number; knock: number; txShapes: boolean; blendGroup: boolean; blendClipped: boolean; bif: number[]; fx: Record<number, number[][]> }>();
  const onTarget = () => !invalidRef.current && engine.engine === targetEngine
    && store.state.activeDocId === targetDocId && store.state.activeLayerId === id;
  const rollbackAction = () => {
    if (actionDoneRef.current) return;
    actions.rollback(actionMark);
    actionDoneRef.current = true;
  };
  const rollback = () => {
    store.cancelLive();
    if (transactionRef.current) {
      const cancelled = targetEngine.cancel_history_transaction();
      transactionRef.current = false;
      if (cancelled && engine.engine === targetEngine) engine.refreshFromEngine();
    }
    rollbackAction();
  };
  const abort = () => {
    invalidRef.current = true;
    doneRef.current = true;
    rollback();
    close();
  };
  const mutate = (edit: () => void): boolean => {
    if (!transactionRef.current || !onTarget()) { abort(); return false; }
    edit();
    return true;
  };
  const flush = () => { mutate(() => store.flushLive()); };
  useEffect(() => {
    snap.current = { fillOp, knock, txShapes, blendGroup, blendClipped, bif: [...bif], fx: { ...fx } };
    if (!onTarget() || !targetEngine.begin_history_transaction()) { abort(); return; }
    transactionRef.current = true;
    const before = targetEngine.undo_pushes();
    targetEngine.push_history("Blending Options");
    if (targetEngine.undo_pushes() === before) { abort(); return; }
    // Opened from a Layer ▸ Layer Style ▸ <effect> menu item: enable that effect's
    // first instance (Photoshop turns it on when you pick it). Cancel restores it
    // via the snapshot.
    if (typeof arg === "number") {
      const eid = arg;
      const cur = store.effectParamsAt(id, eid, 0);
      const base = (cur.length ? cur : fxDef(eid).def).slice();
      base[0] = 1;
      setFx((p) => { const list = p[eid] ?? []; return { ...p, [eid]: list.length ? [base, ...list.slice(1)] : [base] }; });
      store.setEffectAt(id, eid, 0, base);
    }
    return () => { if (!doneRef.current) rollback(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (transactionRef.current && !onTarget()) abort();
    // Captured target + cleanup functions intentionally belong to this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId, activeLayerId, activeDocument]);

  // Continuous slider drags route through the coalesced live path (one
  // composite+blit per frame, sync deferred); `store.flushLive()` on release.
  const onFill = (pct: number) => {
    if (mutate(() => store.setFillOpacityInTransaction(id, pct, true))) setFillOp(pct);
  };
  const onKnock = (k: number) => {
    if (mutate(() => store.setKnockout(id, k))) setKnock(k);
  }; // discrete (Select)
  const pushBif = (arr: number[]) => {
    if (mutate(() => store.setBlendIf(id, blendIfIsDefault(arr) ? [] : arr, true))) setBif(arr);
  };
  const setBiVal = (slot: number, v01: number) => {
    const arr = [...bif]; const o = biChan * 8;
    arr[o + slot] = v01; arr[o + slot + 1] = v01; // outer + inner equal (hard threshold)
    pushBif(arr);
  };
  const toggleInstance = (eid: number, idx: number, on: boolean) => {
    const list = fx[eid] ?? [];
    const base = (list[idx] ?? fxDef(eid).def).slice();
    const np = [...base]; np[0] = on ? 1 : 0;
    const nextList = list.slice(); nextList[idx] = np;
    if (mutate(() => store.setEffectAt(id, eid, idx, np))) {
      setFx({ ...fx, [eid]: nextList });
    } // discrete (Checkbox) — sync now so the fx badge + sub-controls update
  };
  const patchInstance = (eid: number, idx: number, updates: Record<number, number>) => {
    const list = fx[eid] ?? [];
    const def = fxDef(eid).def;
    const base = (list[idx] ?? def).slice();
    // A legacy document's stored params are legitimately shorter than the def
    // (a missing slot reads as its default). Writing a higher slot straight into
    // that short array leaves holes, which Float32Array.from turns into NaN —
    // silently clearing knockout and dissolving the shadow. Pad first. (#48)
    const np = [...base];
    const maxSlot = Math.max(0, ...Object.keys(updates).map(Number));
    while (np.length < maxSlot) np.push(def[np.length] ?? 0);
    for (const k in updates) np[+k] = updates[+k]; np[0] = 1;
    const nextList = list.slice(); nextList[idx] = np;
    if (mutate(() => store.setEffectAt(id, eid, idx, np, true))) setFx({ ...fx, [eid]: nextList });
  };
  /** Blending Options' per-type "+": append a fresh, enabled instance (no-op
   *  past FX_MAX_INSTANCES — the button is disabled there too). */
  const addInstance = (eid: number) => {
    const list = fx[eid] ?? [];
    if (list.length >= FX_MAX_INSTANCES) return;
    const np = fxDef(eid).def.slice();
    if (mutate(() => store.setEffectAt(id, eid, list.length, np))) setFx({ ...fx, [eid]: [...list, np] });
  };
  const removeInstance = (eid: number, idx: number) => {
    const list = fx[eid] ?? [];
    if (mutate(() => store.removeEffectAt(id, eid, idx))) setFx({ ...fx, [eid]: list.filter((_, i) => i !== idx) });
  };
  const moveInstance = (eid: number, idx: number, dir: -1 | 1) => {
    const list = fx[eid] ?? [];
    const to = idx + dir;
    if (to < 0 || to >= list.length) return;
    const nextList = list.slice();
    [nextList[idx], nextList[to]] = [nextList[to], nextList[idx]];
    if (mutate(() => store.moveEffectInstance(id, eid, idx, to))) setFx({ ...fx, [eid]: nextList });
  };
  // The multi-stop ramp rides past the generic field slots (see effects.ts), so
  // it goes through the store's own pack/unpack instead of patchInstance's slot
  // copy — then re-reads the full params back into `fx` so a later patchInstance
  // on this instance (e.g. Opacity) doesn't clobber the ramp with a stale snapshot.
  const onGradientStops = (eid: number, idx: number, stops: GradientStop[]) => {
    if (!mutate(() => store.setEffectGradientStopsAt(id, idx, stops))) return;
    setFx((p) => {
      const list = p[eid] ?? []; const nextList = list.slice();
      nextList[idx] = store.effectParamsAt(id, eid, idx);
      return { ...p, [eid]: nextList };
    });
  };
  const clearAll = () => {
    if (!mutate(() => {
      store.cancelLive(); // drop any in-flight drag so it can't re-apply after the reset
      store.clearAllEffects(id);
      store.setBlendIf(id, []);
      store.setFillOpacityInTransaction(id, 100);
      store.setKnockout(id, 0);
    })) return;
    const o: Record<number, number[][]> = {}; for (const d of FX_DEFS) o[d.id] = [];
    setFx(o); setBif(defaultBlendIf()); setFillOp(100); setKnock(0);
  };
  const cancel = () => {
    doneRef.current = true;
    rollback();
    close();
  };
  // OK: keep the one snapshot as the undoable step, but if nothing actually
  // changed, drop it so we don't leave a no-op "Blending Options" entry.
  const ok = () => {
    if (!transactionRef.current || !onTarget()) { abort(); return; }
    store.flushLive(); // apply the final dragged value + one full sync before closing
    const s = snap.current!;
    // The three advanced-blending checkboxes go through non-undoable engine
    // setters, so this snapshot is their ONLY history record — leaving them out
    // of the comparison dropped it while the change stayed applied. (#30)
    const same = fillOp === s.fillOp && knock === s.knock
      && txShapes === s.txShapes && blendGroup === s.blendGroup && blendClipped === s.blendClipped
      && JSON.stringify(bif) === JSON.stringify(s.bif)
      && JSON.stringify(fx) === JSON.stringify(s.fx);
    doneRef.current = true;
    let committed = false;
    if (same) {
      rollback();
    } else {
      const acceptedStyle = {
        effects: FX_DEFS.flatMap((d) => (fx[d.id] ?? [])
          .filter((params) => params.length > 0)
          .map((params) => ({ fx: d.id, params: [...params] }))),
        blendIf: blendIfIsDefault(bif) ? [] : [...bif],
        fillOpacity: fillOp,
        knockout: knock,
        transparencyShapes: txShapes,
        blendInteriorGroup: blendGroup,
        blendClippedGroup: blendClipped,
        blendChannels: blendChans,
      };
      committed = targetEngine.commit_history_transaction();
      transactionRef.current = false;
      if (committed) {
        actions.commit(actionMark, () => { store.applyLayerStyleState(acceptedStyle); },
          ["store.applyLayerStyleState", [acceptedStyle]]);
        actionDoneRef.current = true;
        engine.commit();
      } else {
        engine.refreshFromEngine();
        rollbackAction();
      }
    }
    close();
  };

  const o = biChan * 8;
  const u255 = (v: number) => `${Math.round(v * 255)}`;
  return (
    <Dialog open onClose={cancel} title="Blending Options" width={440}
      footer={<><Button variant="ghost" disabled={!transactionRef.current || !onTarget()} onClick={clearAll}>Clear All</Button><span style={{ flex: 1 }} /><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" disabled={!transactionRef.current || !onTarget()} onClick={ok}>OK</Button></>}>
      <div style={{ maxHeight: "62vh", overflowY: "auto", paddingRight: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 0.5, margin: "0 0 8px" }}>Advanced Blending</div>
        <Row label="Fill Opacity" value={fillOp} min={0} max={100} suffix="%" onChange={onFill} onChangeEnd={flush} />
        <SelectRow label="Knockout" value={knock} options={[{ value: "0", label: "None" }, { value: "1", label: "Shallow" }, { value: "2", label: "Deep" }]} onChange={onKnock} />
        {/* Photoshop's "Channels: R G B" row. A cleared box excludes that
            channel from the blend, which is how channel-split looks are made. */}
        <div className="monet-row" style={{ gap: 10, alignItems: "center", marginTop: 6 }}>
          <span className="lbl" style={{ width: 110 }}>Channels</span>
          {BLEND_CHANNEL_BITS.map(({ bit, label }) => (
            <Checkbox key={label} checked={(blendChans & bit) !== 0} aria-label={`Blend ${label}`}
              onChange={(v) => {
                const next = v ? blendChans | bit : blendChans & ~bit;
                if (mutate(() => store.setLayerBlendChannels(id, next))) setBlendChans(next);
              }}>{label}</Checkbox>
          ))}
        </div>
        <div className="monet-row" style={{ marginTop: 6 }}>
          <Checkbox checked={txShapes} onChange={(v) => {
            if (mutate(() => store.setTransparencyShapes(id, v))) setTxShapes(v);
          }}>Transparency Shapes Layer</Checkbox>
        </div>
        <div className="monet-row" style={{ marginTop: 6 }}>
          <Checkbox checked={blendGroup} onChange={(v) => {
            if (mutate(() => store.setBlendInteriorGroup(id, v))) setBlendGroup(v);
          }}>Blend Interior Effects as Group</Checkbox>
        </div>
        <div className="monet-row" style={{ marginTop: 6 }}>
          <Checkbox checked={blendClipped} onChange={(v) => {
            if (mutate(() => store.setBlendClippedGroup(id, v))) setBlendClipped(v);
          }}>Blend Clipped Layers as Group</Checkbox>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 0.5, margin: "14px 0 8px" }}>Blend If</div>
        <SelectRow label="Channel" value={biChan} options={BLEND_IF_CHANNELS.map((c, idx) => ({ value: String(idx), label: c }))} onChange={setBiChan} />
        <Row label="This: Black" value={bif[o] * 255} min={0} max={255} format={u255} onChange={(v) => setBiVal(0, v / 255)} onChangeEnd={flush} />
        <Row label="This: White" value={bif[o + 2] * 255} min={0} max={255} format={u255} onChange={(v) => setBiVal(2, v / 255)} onChangeEnd={flush} />
        <Row label="Under: Black" value={bif[o + 4] * 255} min={0} max={255} format={u255} onChange={(v) => setBiVal(4, v / 255)} onChangeEnd={flush} />
        <Row label="Under: White" value={bif[o + 6] * 255} min={0} max={255} format={u255} onChange={(v) => setBiVal(6, v / 255)} onChangeEnd={flush} />

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 0.5, margin: "14px 0 4px" }}>Effects</div>
        {FX_DEFS.map((d) => {
          const instances = fx[d.id] ?? [];
          const first = instances[0];
          const on = !!first && first[0] >= 0.5;
          const atCap = instances.length >= FX_MAX_INSTANCES;
          return (
            <div key={d.id} style={{ borderTop: "1px solid var(--glass-2)", paddingTop: 8, marginTop: 8 }}>
              <div className="monet-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <Checkbox checked={on} onChange={(b) => toggleInstance(d.id, 0, b)} aria-label={d.name}>
                  <strong style={{ fontSize: 12 }}>{d.name}</strong>
                </Checkbox>
                <button type="button" disabled={atCap} data-mv-fx-add={d.id}
                  title={atCap ? `Up to ${FX_MAX_INSTANCES} per layer` : `Add another ${d.name}`}
                  onClick={() => addInstance(d.id)} style={INP_BASE_BTN}>+</button>
              </div>
              {on && <div style={{ marginTop: 8 }}>{d.fields.map((f, idx) => (
                <FxFieldRow key={idx} field={f} params={first!} set={(u) => patchInstance(d.id, 0, u)} end={flush} globalLightSlot={d.def.length} />
              ))}
              {d.id === FX.GRADIENT_OVERLAY && (
                <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <span className="lbl" style={{ width: 110 }}>Stops</span>
                  <GradientBar stops={store.effectGradientStopsAt(id, 0)} onChange={(stops) => onGradientStops(d.id, 0, stops)} />
                </div>
              )}</div>}
              {instances.slice(1).map((params, i) => {
                const idx = i + 1;
                const instOn = params[0] >= 0.5;
                return (
                  <div key={idx} data-mv-fx-instance={idx} style={{ marginTop: 8, paddingLeft: 10, borderLeft: "2px solid var(--glass-2)" }}>
                    <div className="monet-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <Checkbox checked={instOn} onChange={(b) => toggleInstance(d.id, idx, b)} aria-label={`${d.name} ${idx + 1}`}>
                        <strong style={{ fontSize: 12 }}>{d.name} {idx + 1}</strong>
                      </Checkbox>
                      <div className="monet-row" style={{ gap: 2 }}>
                        <button type="button" disabled={idx === 0} onClick={() => moveInstance(d.id, idx, -1)} aria-label={`Move ${d.name} ${idx + 1} up`} style={INP_BASE_BTN}>↑</button>
                        <button type="button" disabled={idx === instances.length - 1} onClick={() => moveInstance(d.id, idx, 1)} aria-label={`Move ${d.name} ${idx + 1} down`} style={INP_BASE_BTN}>↓</button>
                        <button type="button" onClick={() => removeInstance(d.id, idx)} aria-label={`Remove ${d.name} ${idx + 1}`} style={INP_BASE_BTN}>✕</button>
                      </div>
                    </div>
                    {instOn && <div style={{ marginTop: 8 }}>{d.fields.map((f, fi) => (
                      <FxFieldRow key={fi} field={f} params={params} set={(u) => patchInstance(d.id, idx, u)} end={flush} globalLightSlot={d.def.length} />
                    ))}
                    {d.id === FX.GRADIENT_OVERLAY && (
                      <div className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
                        <span className="lbl" style={{ width: 110 }}>Stops</span>
                        <GradientBar stops={store.effectGradientStopsAt(id, idx)} onChange={(stops) => onGradientStops(d.id, idx, stops)} />
                      </div>
                    )}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

// ── document browser ───────────────────────────────────────────
// A Monet-UI overlay listing every open document as a thumbnail card — click to
// switch, × to close (with an unsaved-changes guard), plus New / Open actions.
// The whole panel is a file drop target.
function DocumentBrowser() {
  const { open, close } = useDialogs();
  // Re-renders whenever the open-document set or active doc changes.
  const documents = useStore((s) => s.documents);
  const activeDocId = useStore((s) => s.activeDocId);
  const [dragging, setDragging] = useState(false);
  // Thumbnails are composited on demand. Closing a card from here mutates the
  // doc set, so re-derive only when the set, its dirty flags, or the active doc
  // actually change — a stable key avoids recompositing on unrelated syncs.
  const cardKey = documents.map((d) => `${d.id}:${d.dirty}`).join(",") + "|" + activeDocId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cards = useMemo(() => store.docCards(), [cardKey]);

  const switchTo = (id: number) => { store.activateDoc(id); close(); };
  const closeCard = async (e: React.MouseEvent, c: { id: number }) => {
    e.stopPropagation();
    await closeDocumentTab(c.id); // panel stays open; the list updates reactively
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void openImageFiles(Array.from(e.dataTransfer?.files ?? []));
  };

  return (
    <Dialog open onClose={close} title="Documents" width={620}
      footer={<>
        <Button variant="ghost" onClick={() => { close(); open("new"); }}>New…</Button>
        <Button variant="primary" onClick={() => { close(); openFiles(); }}>Open…</Button>
      </>}>
      <div
        className={`mv-docbrowser${dragging ? " is-dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={onDrop}
      >
        <div className="mv-docbrowser-grid">
          {cards.map((c) => (
            <button key={c.id} type="button" className={`mv-doccard${c.active ? " is-active" : ""}`}
              onClick={() => switchTo(c.id)} title={c.name}>
              <span className="mv-doccard-thumb">{c.thumb && <img src={c.thumb} alt="" />}</span>
              <span className="mv-doccard-meta">
                <span className="mv-doccard-name">{c.dirty && <span className="mv-doccard-dot" />}{c.name}</span>
                <span className="mv-doccard-dims">{c.width} × {c.height}</span>
              </span>
              <span className="mv-doccard-close" role="button" tabIndex={-1} aria-label={`Close ${c.name}`}
                onClick={(e) => void closeCard(e, c)}><Icon d={I.close} size={10} /></span>
            </button>
          ))}
        </div>
        <div className="mv-docbrowser-hint">Drop image, PSD, or .mvision files here to open them</div>
      </div>
    </Dialog>
  );
}

// Multi-page PDF page chooser. openPdf raises this (via registerPdfPagePicker)
// only when a PDF has 2+ pages; single-page PDFs rasterize directly and skip it.
function PdfPageDialog() {
  const { close, arg } = useDialogs();
  const req = arg as PdfPageRequest | null;
  const count = req && typeof req.count === "number" && req.count > 0 ? req.count : 1;
  const [page, setPage] = useState(1);
  if (!req) return null;
  const openPage = () => { close(); void openPdfPage(req.bytes, req.name, req.path, Math.min(count, Math.max(1, page)) - 1); };
  return (
    <Dialog open onClose={close} title="Select PDF Page" width={320}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={openPage}>Open</Button></>}>
      <div className="monet-row" style={{ gap: 10, alignItems: "center" }}>
        <span className="lbl" style={{ width: 120 }}>{`Page (1–${count})`}</span>
        <NumberField aria-label="PDF page" value={page} min={1} max={count} onChange={setPage} />
      </div>
    </Dialog>
  );
}

// Photoshop's TIFF Options for a layered document, raised by Save As and
// Export ▸ TIFF (via registerTiffLayersPicker). Save layers writes the stack into
// tag 37724; unchecked writes the flat composite. Cancel, Escape or the dialog
// being replaced resolves null, and nothing is written.
function TiffOptionsDialog() {
  const { close, arg } = useDialogs();
  const [layers, setLayers] = useState(true);
  const done = useRef(false);
  const finish = (choice: boolean | null) => {
    if (done.current) return;
    done.current = true;
    (arg as ((layers: boolean | null) => void) | null)?.(choice);
  };
  const finishRef = useRef(finish);
  useEffect(() => () => finishRef.current(null), []);
  const cancel = () => { finish(null); close(); };
  return (
    <Dialog open onClose={cancel} title="TIFF Options" width={300}
      footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button>
        <Button variant="primary" onClick={() => { finish(layers); close(); }}>OK</Button></>}>
      <Checkbox checked={layers} onChange={setLayers}>Save layers</Checkbox>
    </Dialog>
  );
}

function DialogHost() {
  const { current } = useDialogs();
  switch (current) {
    case "docBrowser": return <DocumentBrowser />;
    case "new": return <NewDocument />;
    case "duplicateImage": return <DuplicateImage />;
    case "imageSize": return <ImageSize />;
    case "canvasSize": return <CanvasSize />;
    case "expandContract": return <ExpandContract />;
    case "feather": return <FeatherSelection />;
    case "selectandmask": return <SelectAndMask />;
    case "border": return <BorderSelection />;
    case "smooth": return <SmoothSelection />;
    case "stroke": return <StrokeSelection />;
    case "trim": return <Trim />;
    case "contentAwareScale": return <ContentAwareScale />;
    case "fitImage": return <FitImage />;
    case "newGuideLayout": return <NewGuideLayout />;
    case "newGuide": return <NewGuide />;
    case "rotateCanvas": return <RotateCanvas />;
    case "renameLayer": return <RenameLayer />;
    case "pdfPage": return <PdfPageDialog />;
    case "tiffOptions": return <TiffOptionsDialog />;
    case "jpeg2000Options": return <Jpeg2000OptionsDialog />;
    case "photoshopRawSave": return <PhotoshopRawSaveDialog />;
    case "photoshopRawOpen": return <PhotoshopRawOpenDialog />;
    case "newLayer": return <NewLayer />;
    case "newGroup": return <NewGroup />;
    case "duplicateLayer": return <DuplicateLayer />;
    case "lockLayers": return <LockLayers />;
    case "contourEditor": return <ContourEditor />;
    case "spellCheck": return <SpellCheck />;
    case "findReplace": return <FindReplace />;
    case "statistics": return <Statistics />;
    case "smartStackMode": return <SmartStackMode />;
    case "trap": return <Trap />;
    case "newArtboard": return <NewArtboard />;
    case "conditionalMode": return <ConditionalModeChange />;
    case "imageProcessor": return <ImageProcessor />;
    case "variablesDefine": return <VariablesDefine />;
    case "dataSets": return <DataSets />;
    case "customPixelAspect": return <CustomPixelAspect />;
    case "deletePixelAspect": return <DeletePixelAspect />;
    case "resetPixelAspects": return <ResetPixelAspects />;
    case "proofSetupCustom": return <ProofSetupCustom />;
    case "print": return <PrintDialog />;
    case "hdrPreview": return <HdrPreviewDialog />;
    case "showExtrasOptions": return <ShowExtrasOptions />;
    case "focusArea": return <FocusArea />;
    case "contentAwareFill": return <ContentAwareFillWorkspace />;
    case "glyphs": return <Glyphs />;
    case "typeStyles": return <TypeStyles />;
    case "exportPrefs": return <ExportPrefs />;
    case "saveForWeb": return <SaveForWebDialog />;
    case "layerCleanup": return <LayerCleanup />;
    case "removeDistractions": return <RemoveDistractionsDialog />;
    case "removeReflections": return <RemoveReflectionsDialog />;
    case "skyReplacement": return <SkyReplacementDialog />;
    case "colorTable": return <ColorTable />;
    case "presetManager": return <PresetManagerDialog />;
    case "commandSearch": return <CommandSearch />;
    case "measurementScale": return <MeasurementScale />;
    case "selectDataPoints": return <SelectDataPoints />;
    case "placeScaleMarker": return <PlaceScaleMarker />;
    case "solidFill": return <SolidFillLayer />;
    case "gradientFill": return <GradientFillLayer />;
    case "patternFill": return <PatternFillLayer />;
    case "offset": return <Offset />;
    case "maximum": return <MaxMin kind="max" />;
    case "minimum": return <MaxMin kind="min" />;
    case "custom": return <CustomFilter />;
    case "dustScratches": return <DustScratches />;
    case "surfaceBlur": return <SurfaceBlur />;
    case "smartBlur": return <SmartBlur />;
    case "lensBlur": return <LensBlur />;
    case "shapeBlur": return <ShapeBlur />;
    case "extrudeFilter": return <ExtrudeFilter />;
    // All five blur menu items open the SAME workspace, on the tool they name.
    case "fieldBlur": return <BlurGallery tool={BLUR_TOOL_FOR_DIALOG.fieldBlur} />;
    case "irisBlur": return <BlurGallery tool={BLUR_TOOL_FOR_DIALOG.irisBlur} />;
    case "tiltShift": return <BlurGallery tool={BLUR_TOOL_FOR_DIALOG.tiltShift} />;
    case "spinBlur": return <BlurGallery tool={BLUR_TOOL_FOR_DIALOG.spinBlur} />;
    case "pictureFrame": return <PictureFrame />;
    case "tree": return <Tree />;
    case "flame": return <Flame />;
    case "lensCorrection": return <LensCorrection />;
    case "displace": return <Displace />;
    case "bitmapMode": return <Bitmap />;
    case "duotone": return <Duotone />;
    case "indexedColor": return <IndexedColor />;
    case "smartSharpen": return <SmartSharpen />;
    case "shakeReduction": return <ShakeReduction />;
    case "reduceNoise": return <ReduceNoise />;
    case "deblock": return <Deblock />;
    case "hsbHsl": return <HsbHsl />;
    case "mezzotint": return <Mezzotint />;
    case "deinterlace": return <Deinterlace />;
    case "freeTransform": return <FreeTransform />;
    case "skew": return <Skew />;
    case "transformPath": return <TransformPath />;
    case "perspective": return <PerspectiveWarp />;
    case "perspectiveCrop": return <PerspectiveCropDialog />;
    case "diffuse": return <Diffuse />;
    case "transformSelection": return <TransformSelection />;
    case "warp": return <WarpDialog />;
    case "glowingEdges": return <GlowingEdges />;
    case "traceContour": return <TraceContour />;
    case "colorRange": return <ColorRange />;
    case "saveSelection": return <SaveSelection />;
    case "loadSelection": return <LoadSelection />;
    case "defringe": return <Defringe />;
    case "applyImage": return <ApplyImage />;
    case "calculations": return <Calculations />;
    case "wind": return <Wind />;
    case "posterEdges": return <PosterEdges />;
    case "cutout": return <Cutout />;
    case "coloredPencil": return <ColoredPencil />;
    case "smudgeStick": return <SmudgeStick />;
    case "sponge": return <Sponge />;
    case "paletteKnife": return <PaletteKnife />;
    case "paintDaubs": return <PaintDaubs />;
    case "fresco": return <Fresco />;
    case "roughPastels": return <RoughPastels />;
    case "underpainting": return <Underpainting />;
    case "dryBrush": return <DryBrush />;
    case "watercolor": return <Watercolor />;
    case "filmGrain": return <FilmGrain />;
    case "crosshatch": return <Crosshatch />;
    case "spatter": return <Spatter />;
    case "angledStrokes": return <AngledStrokes />;
    case "darkStrokes": return <DarkStrokes />;
    case "sprayedStrokes": return <SprayedStrokes />;
    case "sumiE": return <SumiE />;
    case "mosaicTiles": return <MosaicTiles />;
    case "patchwork": return <Patchwork />;
    case "craquelure": return <Craquelure />;
    case "grain": return <Grain />;
    case "neonGlow": return <NeonGlow />;
    case "plasticWrap": return <PlasticWrap />;
    case "accentedEdges": return <AccentedEdges />;
    case "inkOutlines": return <InkOutlines />;
    case "texturizer": return <Texturizer />;
    case "graphicPen": return <GraphicPen />;
    case "charcoal": return <Charcoal />;
    case "halftonePattern": return <HalftonePattern />;
    case "basRelief": return <BasRelief />;
    case "chrome": return <Chrome />;
    case "oceanRipple": return <OceanRipple />;
    case "glass": return <Glass />;
    case "fibers": return <Fibers />;
    case "lightingEffects": return <LightingEffects />;
    case "photocopy": return <Photocopy />;
    case "stamp": return <Stamp />;
    case "notePaper": return <NotePaper />;
    case "tornEdges": return <TornEdges />;
    case "waterPaper": return <WaterPaper />;
    case "chalkCharcoal": return <ChalkCharcoal />;
    case "conteCrayon": return <ConteCrayon />;
    case "reticulation": return <Reticulation />;
    case "plaster": return <Plaster />;
    case "tiles": return <Tiles />;
    case "colorHalftone": return <ColorHalftone />;
    case "crystallize": return <Crystallize />;
    case "stainedGlass": return <StainedGlass />;
    case "pointillize": return <Pointillize />;
    case "fill": return <FillContents />;
    case "fade": return <Fade />;
    case "replaceColor": return <ReplaceColor />;
    case "brightnessContrast": return <BrightnessContrast />;
    case "levels": return <Levels />;
    case "curves": return <Curves />;
    case "hueSaturation": return <HueSaturation />;
    case "blackWhite": return <BlackWhite />;
    case "exposure": return <Exposure />;
    case "vibrance": return <Vibrance />;
    case "colorBalance": return <ColorBalanceDialog />;
    case "photoFilter": return <PhotoFilterDialog />;
    case "posterize": return <Posterize />;
    case "threshold": return <Threshold />;
    case "channelMixer": return <ChannelMixer />;
    case "gradientMap": return <GradientMapDialog />;
    case "shadowsHighlights": return <ShadowsHighlights />;
    case "hdrToning": return <HdrToning />;
    case "cameraRaw": return <CameraRawWorkspaceHost />;
    case "filterGallery": return <FilterGallery />;
    case "fileInfo": return <FileInfo />;
    case "colorSettings": return <ColorSettings />;
    case "assignProfile": return <AssignProfile />;
    case "convertToProfile": return <ConvertToProfile />;
    case "preferences": return <Preferences />;
    case "keyboardShortcuts": return <KeyboardShortcuts />;
    case "customizeToolbar": return <CustomizeToolbar />;
    case "about": return <About />;
    case "globalLight": return <GlobalLight />;
    case "scaleEffects": return <ScaleEffects />;
    case "matchColor": return <MatchColorDialog />;
    case "matchFont": return <MatchFontDialog />;
    case "selectiveColor": return <SelectiveColorDialog />;
    case "gaussianBlur": return <GaussianBlur />;
    case "boxBlur": return <BoxBlur />;
    case "unsharp": return <Unsharp />;
    case "addNoise": return <AddNoise />;
    case "median": return <Median />;
    case "motionBlur": return <MotionBlur />;
    case "pathBlur": return <BlurGallery tool={BLUR_TOOL_FOR_DIALOG.pathBlur} />;
    case "emboss": return <Emboss />;
    case "highPass": return <HighPass />;
    case "mosaic": return <Mosaic />;
    case "vignette": return <VignetteDialog />;
    case "oil": return <OilPaint />;
    case "pinch": return <Pinch />;
    case "spherize": return <Spherize />;
    case "twirl": return <Twirl />;
    case "polar": return <PolarCoordinates />;
    case "ripple": return <Ripple />;
    case "zigzag": return <ZigZag />;
    case "shear": return <Shear />;
    case "wave": return <Wave />;
    case "diffuseGlow": return <DiffuseGlow />;
    case "radialBlur": return <RadialBlur />;
    case "lensFlare": return <LensFlare />;
    case "script": return <ScriptDialog />;
    case "neuralAI": return <NeuralAI />;
    case "aiDenoise": return <AiDenoise />;
    case "modelManager": return <ModelManager />;
    case "renderVideo": return <RenderVideoDialog />;
    case "batch": return <BatchDialog />;
    case "createDroplet": return <CreateDropletDialog />;
    case "dropletRun": return <DropletRunDialog />;
    case "scriptEvents": return <ScriptEventsManagerDialog />;
    case "type": return <TypeDialog />;
    case "onPathOptions": return <OnPathOptions />;
    case "layerStyle": return <LayerStyle />;
    case "alCurves": return <CurvesAdjLayer />;
    case "alHueSat": return <HueSaturationAdjLayer />;
    case "alBlackWhite": return <BlackWhiteAdjLayer />;
    case "alGradientMap": return <GradientMapAdjLayer />;
    case "alChannelMixer": return <ChannelMixerAdjLayer />;
    case "alSelectiveColor": return <SelectiveColorAdjLayer />;
    case "alColorLookup": return <ColorLookupAdjLayer />;
    case "colorLookup": return <ColorLookupDialog />;
    case "alBrightness": case "alLevels": case "alVibrance": case "alExposure":
    case "alPosterize": case "alThreshold": case "alColorBalance": case "alPhotoFilter":
      return <AdjLayerDialog specKey={current} />;
    default: return null;
  }
}
