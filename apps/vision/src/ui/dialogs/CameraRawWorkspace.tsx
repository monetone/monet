// ─────────────────────────────────────────────────────────────
// Camera Raw develop workspace (Phase 2: Basic + Tone Curve + Detail + Effects).
// A large modal Dialog with a downscaled-proxy preview: every slider drag runs
// ONE develop op on a scratch `proxy_engine` (never the live document) and blits
// its output, so Cancel is byte-identical by construction and OK is exactly one
// history step. On a smart object the recipe seeds from / updates the fid-17
// entry; otherwise OK uses the Store's pinned target mutation.
// ─────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Checkbox, CurveEditor, Dialog, Histogram, Input, isEditableTarget, RangeSlider, Section, SegmentedControl, Select, type CurvePoint } from "@monet-ui/monet-react";
import type { Engine } from "@engine";
import {
  engine,
  exportCameraRawPreset,
  findAdobeCameraProfiles,
  importCameraRawPreset,
  importCameraRawProfileFile,
  importCameraRawSidecar,
  saveCameraRawSidecar,
  store,
  useStore,
} from "../../state/app";
import { LAYER_KIND } from "../../state/engineContracts";
import { LensProfileControls } from "./LensProfileControls";
import type { CameraRawDialogRequest } from "../../state/store";
import { channelCounts, downsampleBins } from "../../state/channelHistogram";
import { visualizeSpots } from "@monet-ui/monet-photo";
import { splitBeforeAfter, type SplitMode } from "../../state/splitBeforeAfter";
import { detectDustSpots, healSourceFor, healStrokeSpots } from "@monet-ui/monet-photo";
import { autoDevelopBasic } from "../../state/autoDevelopBasic";
import { clippingOverlay } from "@monet-ui/monet-color";
import {
  autoWhiteBalance,
  clippingCounts,
  compileCurveLuts,
  defaultCameraRawLocalAdjustments,
  proxyMaxDim,
  HSL_BANDS,
  GRADE_REGIONS,
  MAX_CAMERA_RAW_CURVE_POINTS_PER_CHANNEL,
  MAX_CAMERA_RAW_HEAL_SPOTS,
  MAX_CAMERA_RAW_MASK_COLORS,
  MAX_CAMERA_RAW_MASK_POINTS,
  MAX_CAMERA_RAW_MASKS,
  MAX_CAMERA_RAW_POINT_COLORS,
  type ParametricCurve,
  MAX_CAMERA_RAW_SNAPSHOTS,
  type CameraRawSnapshotEntry,
  type CameraRawSourceMetadata,
} from "../../state/cameraRaw";
import {
  cameraModelKeys,
  cameraRawProfileMenu,
  keepProfileName,
  profileMatchesCamera,
  profileMenuValue,
} from "../../state/cameraRawProfiles";
import {
  applyWhiteBalance,
  createDefaultRecipe,
  solveGuidedUpright,
  solveUpright,
  UPRIGHT_MODES,
  WB_PRESETS,
  type UprightLine,
  type UprightMode,
  type WhiteBalanceMode,
  type BasicPanel,
  type CalibrationPanel,
  type ColorGradingPanel,
  type ColorMixerPanel,
  type CropPanel,
  type DetailPanel,
  type EffectsPanel,
  type EngineMaskAdjustments,
  type EngineMaskKind,
  type EnginePhotoEnhance,
  type GradeWheel,
  type OpticsPanel,
  type ProfilePanel,
  type TransformPanel,
} from "@monet-ui/monet-photo";
import {
  engineParamsToWorkingRecipe,
  normalizeWorkingRecipe,
  syncWorkingRecipe,
  applyWorkingPreset,
  workingRecipeToParams,
  type VisionDevelopRecipe,
  type WorkingEngineMask,
  type WorkingHealSpot,
  type WorkingPointColorSample,
} from "../../state/visionDevelopRecipe";
import {
  cameraRawSidecarSourceSnapshot,
  type CameraRawSidecarSourceSnapshot,
} from "../../state/cameraRawSidecar";
import {
  DEFAULT_CAMERA_RAW_PRESETS,
  addCameraRawPresetTo,
  defaultCameraRawPresetName,
  loadCameraRawPresets,
  saveCameraRawPresets,
  type CameraRawPreset,
} from "../../state/cameraRawPresets";
import { ACCENT, Row, useDialogs } from "./common";
import { RAW_DEMOSAIC_OPTIONS, RAW_DEPTH_OPTIONS, type RawDemosaic, type RawOpenDepth } from "../../state/webExportPrefs";

// UI-range → engine-native slider config. `scale` maps the displayed integer to
// the engine value the develop op consumes (recipe values are engine-native).
interface SliderSpec<K extends string> {
  key: K; label: string; min: number; max: number; scale: number;
  /** Display axis runs opposite to the stored value. Only Tint: the recipe (and
   *  the Rust-authoritative canonical fixture) store positive = green, while
   *  Camera Raw / Lightroom show negative = green, positive = magenta. Negating
   *  here fixes the slider direction the user actually drags WITHOUT changing the
   *  stored convention, so saved documents keep their look. (#108) */
  invert?: boolean;
}
// The develop panels carry non-numeric fields (wbMode, upright, optics tuples);
// the slider rows only ever key numeric ones. NumericKeys narrows to those so
// ParamRows' `Record<K, number>` stays sound.
type NumericKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];

// Which Color Mixer sub-channel the HSL panel is editing.
type HslChannel = "hue" | "saturation" | "luminance";
// Vision DECOUPLES the compiled render LUTs from the authoring points (a seeded
// recipe's stored LUT must survive until the curve is re-edited), so the compiled
// bands live in their own state, exactly like the old CameraRawCurve carried them.
interface CurveLuts { master: number[]; r: number[]; g: number[]; b: number[] }
interface CurveState { enabled: boolean; luts: CurveLuts }
const DEFAULT_ENHANCE: EnginePhotoEnhance = { denoise: false, denoiseAmount: 0, rawDetails: false, superResolution: false };
const curveLutsOf = (tc: VisionDevelopRecipe["toneCurve"]): CurveLuts =>
  tc.compiledLuts ?? compileCurveLuts([tc.point, tc.red, tc.green, tc.blue], tc.parametric);
// V2 crop has no explicit `enabled`; the crop is active when the rect isn't the
// whole frame or a straighten angle is set — the exact rule the serializer uses
// for p[1097] (appendVisionV2Tail.cropIsActive).
const cropEnabledOf = (crop: CropPanel): boolean => {
  const { left, top, right, bottom } = crop.rect;
  return left !== 0 || top !== 0 || right !== 1 || bottom !== 1 || crop.angle !== 0;
};

type CropRect = CropPanel["rect"];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Smallest crop side, matching the Width/Height sliders' 5% floor. */
const MIN_CROP = 0.05;
/** Grab radius for on-canvas handles, as a fraction of the preview. */
const HANDLE_TOLERANCE = 0.04;
/** Radius of a heal spot placed by hand, clicked or dragged. */
const HEAL_SPOT_RADIUS = 0.025;

/** ACR's Crop aspect menu. `ratio` is width ÷ height in FRAME units; null is
 *  unconstrained ("Original"). Custom is not here — it is whatever number the
 *  numeric field holds, which is exactly "no preset matches". */
export const CROP_ASPECT_PRESETS: { id: string; label: string; ratio: number | null }[] = [
  { id: "original", label: "Original", ratio: null },
  { id: "1x1", label: "1:1", ratio: 1 },
  { id: "4x5", label: "4:5", ratio: 4 / 5 },
  { id: "5x7", label: "5:7", ratio: 5 / 7 },
  { id: "8.5x11", label: "8.5:11", ratio: 8.5 / 11 },
  { id: "3x2", label: "3:2", ratio: 3 / 2 },
  { id: "16x9", label: "16:9", ratio: 16 / 9 },
];
/** Menu id for a stored constrainAspect: the preset it matches, else Custom.
 *  The stored value round-trips through the engine's f32 params, so matching is
 *  tolerant — no two presets are within 1e-3 of each other. */
export const cropAspectId = (constrainAspect: number | null | undefined): string => {
  if (constrainAspect == null) return "original";
  return CROP_ASPECT_PRESETS.find((p) => p.ratio != null && Math.abs(p.ratio - constrainAspect) < 1e-3)?.id ?? "custom";
};

export type CropHandle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se" | "move";
/** Which crop handle a normalised preview point grabs — one of the eight edge/
 *  corner handles, `move` for the rect's interior, or null for outside it. */
export function cropHandleAt(rect: CropRect, p: { x: number; y: number }, tolerance = HANDLE_TOLERANCE): CropHandle | null {
  const { left, top, right, bottom } = rect;
  if (p.x < left - tolerance || p.x > right + tolerance || p.y < top - tolerance || p.y > bottom + tolerance) return null;
  const v = Math.abs(p.y - top) <= tolerance ? "n" : Math.abs(p.y - bottom) <= tolerance ? "s" : "";
  const h = Math.abs(p.x - left) <= tolerance ? "w" : Math.abs(p.x - right) <= tolerance ? "e" : "";
  return (v || h) ? `${v}${h}` as CropHandle : "move";
}

/** Drag one crop handle by a normalised (dx, dy) from where the drag started.
 *  `constrain.aspect` is the locked width ÷ height in FRAME units, so it needs
 *  the frame's own aspect to become a ratio in this 0..1 rect space; the locked
 *  rect is anchored at the edge opposite the handle being dragged. */
export function dragCropRect(
  rect: CropRect, handle: CropHandle, dx: number, dy: number,
  constrain?: { aspect: number; frameAspect: number } | null,
): CropRect {
  if (handle === "move") {
    const w = rect.right - rect.left, h = rect.bottom - rect.top;
    const left = Math.max(0, Math.min(1 - w, rect.left + dx));
    const top = Math.max(0, Math.min(1 - h, rect.top + dy));
    return { left, top, right: left + w, bottom: top + h };
  }
  const west = handle.includes("w"), east = handle.includes("e");
  const north = handle.includes("n"), south = handle.includes("s");
  let { left, top, right, bottom } = rect;
  if (west) left = Math.min(right - MIN_CROP, clamp01(rect.left + dx));
  if (east) right = Math.max(left + MIN_CROP, clamp01(rect.right + dx));
  if (north) top = Math.min(bottom - MIN_CROP, clamp01(rect.top + dy));
  if (south) bottom = Math.max(top + MIN_CROP, clamp01(rect.bottom + dy));
  if (!constrain || !(constrain.aspect > 0) || !(constrain.frameAspect > 0)) return { left, top, right, bottom };
  const ratio = constrain.aspect / constrain.frameAspect;
  const anchorX = west ? right : left;
  const anchorY = north ? bottom : top;
  const roomX = west ? anchorX : 1 - anchorX;
  const roomY = north ? anchorY : 1 - anchorY;
  // A north/south handle has no horizontal component, so height drives width;
  // every other handle drives height from the width the drag just produced.
  const wanted = (!west && !east) ? (bottom - top) * ratio : right - left;
  const w = Math.max(MIN_CROP, Math.min(wanted, roomX, roomY * ratio));
  const h = w / ratio;
  return {
    left: clamp01(west ? anchorX - w : anchorX), right: clamp01(west ? anchorX : anchorX + w),
    top: clamp01(north ? anchorY - h : anchorY), bottom: clamp01(north ? anchorY : anchorY + h),
  };
}

/** Gradient masks are the ones whose whole geometry IS their control points, so
 *  they are the ones worth dragging on the preview. */
const GRADIENT_MASK_KINDS = new Set<EngineMaskKind>(["linear-gradient", "bidirectional-gradient", "radial-gradient"]);
/** Index of the mask control point a normalised preview point grabs, or -1.
 *  Ties go to the nearest, so overlapping gradient handles stay separable. */
export function maskPointAt(
  points: readonly { x: number; y: number }[], p: { x: number; y: number }, tolerance = HANDLE_TOLERANCE,
): number {
  let best = -1, bestDistance = tolerance;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - p.x, point.y - p.y);
    if (distance <= bestDistance) { best = index; bestDistance = distance; }
  });
  return best;
}

const BASIC_ROWS: SliderSpec<NumericKeys<BasicPanel>>[] = [
  { key: "temp", label: "Temperature", min: -100, max: 100, scale: 0.01 },
  { key: "tint", label: "Tint", min: -100, max: 100, scale: 0.01, invert: true },
  { key: "exposure", label: "Exposure", min: -100, max: 100, scale: 0.04 },
  { key: "contrast", label: "Contrast", min: -100, max: 100, scale: 0.01 },
  { key: "highlights", label: "Highlights", min: -100, max: 100, scale: 0.01 },
  { key: "shadows", label: "Shadows", min: -100, max: 100, scale: 0.01 },
  { key: "whites", label: "Whites", min: -100, max: 100, scale: 0.01 },
  { key: "blacks", label: "Blacks", min: -100, max: 100, scale: 0.01 },
  { key: "texture", label: "Texture", min: -100, max: 100, scale: 0.01 },
  { key: "clarity", label: "Clarity", min: -100, max: 100, scale: 0.01 },
  { key: "dehaze", label: "Dehaze", min: -100, max: 100, scale: 0.01 },
  { key: "vibrance", label: "Vibrance", min: -100, max: 100, scale: 0.01 },
  { key: "saturation", label: "Saturation", min: -100, max: 100, scale: 0.01 },
];
// ACR's Detail order. The sub-sliders (scale 1) are stored in ACR's own 0..100
// units and ride the v5 recipe tail.
const DETAIL_ROWS: SliderSpec<NumericKeys<DetailPanel>>[] = [
  { key: "sharpenAmount", label: "Sharpening", min: 0, max: 100, scale: 0.01 },
  { key: "sharpenRadius", label: "Radius", min: 5, max: 30, scale: 0.1 },
  { key: "sharpenDetail", label: "Sharpen Detail", min: 0, max: 100, scale: 1 },
  { key: "sharpenMasking", label: "Masking", min: 0, max: 100, scale: 1 },
  { key: "nrLuminance", label: "Noise Reduction", min: 0, max: 100, scale: 0.01 },
  { key: "nrLuminanceDetail", label: "Luminance Detail", min: 0, max: 100, scale: 0.01 },
  { key: "nrLuminanceContrast", label: "Luminance Contrast", min: 0, max: 100, scale: 1 },
  { key: "nrColor", label: "Color Noise", min: 0, max: 100, scale: 0.01 },
  { key: "nrColorDetail", label: "Color Detail", min: 0, max: 100, scale: 1 },
  { key: "nrColorSmoothness", label: "Color Smoothness", min: 0, max: 100, scale: 1 },
];
const EFFECTS_ROWS: SliderSpec<NumericKeys<EffectsPanel>>[] = [
  { key: "grainAmount", label: "Grain", min: 0, max: 100, scale: 0.01 },
  { key: "grainRoughness", label: "Grain Highlights", min: 0, max: 100, scale: 0.01 },
  { key: "grainSize", label: "Grain Size", min: 0, max: 100, scale: 0.01 },
  { key: "vignetteAmount", label: "Vignette", min: -100, max: 100, scale: 0.01 },
  { key: "vignetteMidpoint", label: "Midpoint", min: 0, max: 100, scale: 0.01 },
];
const OPTICS_ROWS: SliderSpec<NumericKeys<OpticsPanel>>[] = [
  { key: "distortionAmount", label: "Distortion", min: -100, max: 100, scale: 0.01 },
  { key: "aberration", label: "Remove CA", min: 0, max: 100, scale: 0.01 },
  { key: "vignettingAmount", label: "Vignetting", min: -100, max: 100, scale: 0.01 },
  { key: "defringePurpleAmount", label: "Purple Defringe", min: 0, max: 100, scale: 0.01 },
  { key: "defringeGreenAmount", label: "Green Defringe", min: 0, max: 100, scale: 0.01 },
];
/** Which fringe hues each Defringe desaturates, in ACR's 0..100 hue units. */
const DEFRINGE_HUES = [
  { key: "defringePurpleHue", label: "Purple Hue" },
  { key: "defringeGreenHue", label: "Green Hue" },
] as const;
// Galerie's Transform ranges: Scale is a factor (neutral 1 = 100%), LR's 50..150%.
const GEOMETRY_ROWS: SliderSpec<NumericKeys<TransformPanel>>[] = [
  { key: "vertical", label: "Vertical", min: -100, max: 100, scale: 0.01 },
  { key: "horizontal", label: "Horizontal", min: -100, max: 100, scale: 0.01 },
  { key: "rotate", label: "Rotate", min: -100, max: 100, scale: 0.01 },
  { key: "aspect", label: "Aspect", min: -100, max: 100, scale: 0.01 },
  { key: "scale", label: "Scale", min: 50, max: 150, scale: 0.01 },
  { key: "xOffset", label: "X Offset", min: -100, max: 100, scale: 0.01 },
  { key: "yOffset", label: "Y Offset", min: -100, max: 100, scale: 0.01 },
];
const UPRIGHT_NO_LINES = "Upright found no straight lines to correct.";
/** The recipe without its geometry warp — the image the Upright solver models. */
const unwarped = (r: VisionDevelopRecipe): VisionDevelopRecipe => ({
  ...r,
  transform: { ...r.transform, vertical: 0, horizontal: 0, rotate: 0, aspect: 0, scale: 1, xOffset: 0, yOffset: 0 },
});
const PARAM_ROWS: { key: keyof ParametricCurve; label: string }[] = [
  { key: "highlights", label: "Highlights" },
  { key: "lights", label: "Lights" },
  { key: "darks", label: "Darks" },
  { key: "shadows", label: "Shadows" },
];
const LOCAL_MASK_ROWS: SliderSpec<keyof EngineMaskAdjustments>[] = [
  { key: "temp", label: "Temperature", min: -100, max: 100, scale: 0.01 },
  { key: "tint", label: "Tint", min: -100, max: 100, scale: 0.01 },
  { key: "exposure", label: "Exposure", min: -100, max: 100, scale: 0.04 },
  { key: "contrast", label: "Contrast", min: -100, max: 100, scale: 0.01 },
  { key: "highlights", label: "Highlights", min: -100, max: 100, scale: 0.01 },
  { key: "shadows", label: "Shadows", min: -100, max: 100, scale: 0.01 },
  { key: "whites", label: "Whites", min: -100, max: 100, scale: 0.01 },
  { key: "blacks", label: "Blacks", min: -100, max: 100, scale: 0.01 },
  { key: "texture", label: "Texture", min: -100, max: 100, scale: 0.01 },
  { key: "clarity", label: "Clarity", min: -100, max: 100, scale: 0.01 },
  { key: "dehaze", label: "Dehaze", min: -100, max: 100, scale: 0.01 },
  { key: "saturation", label: "Saturation", min: -100, max: 100, scale: 0.01 },
  { key: "sharpness", label: "Sharpness", min: -100, max: 100, scale: 0.01 },
  { key: "noiseReduction", label: "Noise Reduction", min: -100, max: 100, scale: 0.01 },
  { key: "moire", label: "Moiré", min: -100, max: 100, scale: 0.01 },
  { key: "defringe", label: "Defringe", min: -100, max: 100, scale: 0.01 },
];
const CURVE_CH_ACCENT = [ACCENT, "#ff5d5d", "#5dff7a", "#5d9bff"];
const HIST_BINS = 48;
const diagonalPoints = (): CurvePoint[] => [{ id: "lo", x: 0, y: 0 }, { id: "mid", x: 0.5, y: 0.5 }, { id: "hi", x: 1, y: 1 }];
const curvePointsForUi = (channels?: readonly (readonly { x: number; y: number }[])[]): CurvePoint[][] =>
  Array.from({ length: 4 }, (_, channel) => {
    const points = channels?.[channel];
    return points?.length
      ? points.map((point, index) => ({ id: `cr-${channel}-${index}`, x: point.x, y: point.y }))
      : diagonalPoints();
  });
// Rec.601 rgb (0..255) → hsl (hue 0..360, sat/lum 0..1). Mirrors the engine's
// `color::rgb_to_hsl` so a sampled Point Color swatch matches the selection.
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max - min < 1e-6) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0)
    : max === g ? (b - r) / d + 2
    : (r - g) / d + 4;
  return [h * 60, s, l];
}

// Lightroom/ACR's White Balance menu, in its order: the decoder's neutral, the
// measured Auto, the six lighting presets, then the hand-dialled Custom.
const WB_MODE_OPTIONS: { value: WhiteBalanceMode; label: string }[] = [
  { value: "asShot", label: "As Shot" },
  { value: "auto", label: "Auto" },
  ...WB_PRESETS.map((p) => ({ value: p.mode, label: p.label })),
  { value: "custom", label: "Custom" },
];

/** WB eyedropper solve: the Temperature/Tint that neutralise ONE sampled pixel.
 *  A single pixel is the whole-frame average of a one-pixel frame, so this is
 *  literally `autoWhiteBalance` over that pixel — the eyedropper and Auto White
 *  Balance can never disagree about what "neutral" means or how to reach it. */
export const whiteBalanceFromSample = (rgb: readonly [number, number, number]): { temp: number; tint: number } =>
  autoWhiteBalance([rgb[0], rgb[1], rgb[2], 255]);

const countMaskPoints = (items: readonly WorkingEngineMask[]) =>
  items.reduce((total, mask) => total + mask.points.length, 0);

type CameraRawEngine = Engine & {
  smart_filter_id?: (layerId: number, index: number) => number;
  smart_filter_proxy_engine?: (
    layerId: number, index: number, filterId: number, params: Float32Array,
    x: number, y: number, w: number, h: number, maxDim: number,
  ) => Engine;
};

/** Locate fid 17 by typed engine identity. A large unrelated parameter block is
 * never treated as Camera Raw. */
function developFilterIndex(eng: Engine, layerId: number): number | undefined {
  if (eng.layer_kind(layerId) !== LAYER_KIND.smartObject) return undefined;
  const typed = eng as CameraRawEngine;
  if (!typed.smart_filter_id) return undefined;
  const n = eng.smart_filter_count(layerId);
  for (let i = 0; i < n; i++) if (typed.smart_filter_id(layerId, i) === 17) return i;
  return undefined;
}

function dialogRequest(value: unknown): CameraRawDialogRequest {
  if (value && typeof value === "object") {
    const raw = value as Partial<CameraRawDialogRequest>;
    if (raw.invocation === "raw-open" || raw.invocation === "open-as-smart-object" || raw.invocation === "reopen" || raw.invocation === "filter") {
      return {
        invocation: raw.invocation,
        ...(typeof raw.sessionId === "string" ? { sessionId: raw.sessionId } : {}),
        ...(Number.isInteger(raw.targetDocumentId) ? { targetDocumentId: raw.targetDocumentId } : {}),
        ...(Number.isInteger(raw.targetLayerId) ? { targetLayerId: raw.targetLayerId } : {}),
      };
    }
  }
  return { invocation: "filter", targetDocumentId: store.state.activeDocId, targetLayerId: store.state.activeLayerId };
}

function ParamRows<K extends string>({ rows, value, onChange }: {
  rows: SliderSpec<K>[]; value: Record<K, number>; onChange: (patch: Partial<Record<K, number>>) => void;
}) {
  return (
    <>
      {rows.map((r) => (
        <Row key={r.key} label={r.label} min={r.min} max={r.max}
          value={Math.round((r.invert ? -value[r.key] : value[r.key]) / r.scale)}
          onChange={(v) => onChange({
            [r.key]: (r.invert ? -v : v) * r.scale,
          } as Partial<Record<K, number>>)} />
      ))}
    </>
  );
}

// Keys the workspace on the active session id so a filmstrip switch (which
// re-presents the dialog with a new sessionId) remounts it, reusing the mount
// effect to load the target session's proxy + recipe.
export function CameraRawWorkspaceHost() {
  const { arg } = useDialogs();
  const sessionId = (arg as Partial<CameraRawDialogRequest> | undefined)?.sessionId ?? "cr";
  return <CameraRawWorkspace key={sessionId} />;
}

export function CameraRawWorkspace() {
  const { close, arg } = useDialogs();
  const requestRef = useRef<CameraRawDialogRequest | null>(null);
  if (!requestRef.current) requestRef.current = dialogRequest(arg);
  const request = requestRef.current;
  // Filter mode gets the full ACR Edit stack (masking, healing, point color,
  // profile/calibration) — like Photoshop, only Crop/Straighten and Enhance
  // stay RAW-only. `rawOnly` now gates just those plus session-bound chrome
  // (filmstrip, snapshots, XMP, Open buttons).
  const rawOnly = request.invocation !== "filter";
  // Re-render when the pending Camera Raw session set changes so the filmstrip
  // reflects sources that stage in after this workspace has mounted.
  const sessionsRev = useStore((s) => s.cameraRawSessionsRev);
  // Workflow options: the staged RAW's demosaic (re-decodes it) and the depth
  // Open develops into. Both are the persisted RAW import preferences.
  const rawDepth = useStore((s) => s.filePrefs.rawDepth);
  const [demosaic, setDemosaic] = useState<RawDemosaic>("adaptive");
  const [decodeError, setDecodeError] = useState<string | null>(null);
  // Monotonic count of committed develop frames — flips a data attribute on the
  // canvas so e2e can wait for a real develop to land (not a stale rAF frame).
  const developFrameRef = useRef(0);
  // Per-session filmstrip thumbnails (dataURL), built once as sources stage in.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const thumbDoneRef = useRef<Set<string>>(new Set());
  const def = useMemo<VisionDevelopRecipe>(() => createDefaultRecipe(), []);
  const [basic, setBasic] = useState<BasicPanel>(def.basic);
  const [detail, setDetail] = useState<DetailPanel>(def.detail);
  const [effects, setEffects] = useState<EffectsPanel>(def.effects);
  const [optics, setOptics] = useState<OpticsPanel>(def.optics);
  const [hsl, setHsl] = useState<ColorMixerPanel>(def.colorMixer);
  const [hslCh, setHslCh] = useState<HslChannel>("hue");
  const [grade, setGrade] = useState<ColorGradingPanel>(def.colorGrading);
  const [geometry, setGeometry] = useState<TransformPanel>(def.transform);
  const [curve, setCurve] = useState<CurveState>(() => ({ enabled: def.enabled.toneCurve, luts: curveLutsOf(def.toneCurve) }));
  const [profile, setProfile] = useState<ProfilePanel>(def.profile);
  // Profile menu inputs: the loaded/found DNG camera profiles, and the RAW's
  // camera + embedded profile (#446). `profileMissing` is why the chosen
  // embedded/custom profile renders as Camera Default right now.
  const profileLibrary = useStore((s) => s.cameraRawProfiles);
  const [profileMetadata, setProfileMetadata] = useState<CameraRawSourceMetadata | null>(null);
  const [profileMissing, setProfileMissing] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<CalibrationPanel>(def.calibration);
  const [crop, setCrop] = useState<CropPanel>(def.crop);
  const [healSpots, setHealSpotsState] = useState<WorkingHealSpot[]>(def.heal.spots);
  const [masks, setMasksState] = useState<WorkingEngineMask[]>(def.engineMasks ?? []);
  const [pointColors, setPointColorsState] = useState<WorkingPointColorSample[]>(def.pointColor.samples);
  const [enhance, setEnhance] = useState<EnginePhotoEnhance>(def.enhance ?? DEFAULT_ENHANCE);
  const [activeMaskId, setActiveMaskId] = useState<string | null>(null);
  const [canvasTool, setCanvasTool] = useState<"none" | "heal" | "mask-brush" | "color-sample" | "point-color" | "wb" | "crop" | "mask-handles" | "upright-guides">("none");
  // Upright's no-lines report, and Guided Upright's guide lines.
  // ponytail: guides are session-only (ACR stores them in the XMP); persist them
  // on the recipe if reopening a Guided edit must show its guides again.
  const [uprightStatus, setUprightStatus] = useState<string | null>(null);
  const [uprightLines, setUprightLinesState] = useState<UprightLine[]>([]);
  const [sidecarBusy, setSidecarBusy] = useState(false);
  const [terminalError, setTerminalError] = useState(false);
  const [canSuperResolution, setCanSuperResolution] = useState(false);
  const [editLimitError, setEditLimitError] = useState<string | null>(null);
  // Curve editor authoring state (points + parametric). Kept separate from the
  // compiled LUTs in `curve` so a seeded recipe's LUT survives until re-edited.
  const [curveCh, setCurveCh] = useState(0);
  const [curvePts, setCurvePts] = useState<CurvePoint[][]>(() => curvePointsForUi([def.toneCurve.point, def.toneCurve.red, def.toneCurve.green, def.toneCurve.blue]));
  const [param, setParam] = useState<ParametricCurve>(def.toneCurve.parametric);
  // Preview zoom, as a multiple of the fit-to-dialog size (1 = Fit).
  const [zoom, setZoom] = useState(1);
  const [showBefore, setShowBefore] = useState(false);
  // Visualize Spots: a preview-only dust-reveal (high-contrast edge view). Never
  // persisted to the recipe — it only changes how the preview is displayed.
  const [showSpots, setShowSpots] = useState(false);
  const [spotThreshold, setSpotThreshold] = useState(0.5);
  // Split Before/After: composite the before and developed previews side by side
  // (L/R or T/B). Preview-only, like the peek-before toggle.
  const [splitBA, setSplitBA] = useState<SplitMode>("off");
  // Clipping overlay: mark blown highlights red / crushed shadows blue on the
  // preview (ACR's clipping indicators). Preview-only.
  const [showShadowClip, setShowShadowClip] = useState(false);
  const [showHighlightClip, setShowHighlightClip] = useState(false);
  const [hist, setHist] = useState<number[]>(() => new Array(HIST_BINS).fill(0));
  const [clip, setClip] = useState({ shadow: 0, highlight: 0 });
  const [userPresets, setUserPresets] = useState<CameraRawPreset[]>(() => loadCameraRawPresets());
  const [snapshots, setSnapshots] = useState<CameraRawSnapshotEntry[]>([]);
  const [presetName, setPresetName] = useState("");

  const recipe = useMemo<VisionDevelopRecipe>(() => {
    const base = createDefaultRecipe();
    return {
    ...base,
    basic,
    toneCurve: {
      ...base.toneCurve,
      parametric: param,
      point: curvePts[0].map(({ x, y }) => ({ x, y })),
      red: curvePts[1].map(({ x, y }) => ({ x, y })),
      green: curvePts[2].map(({ x, y }) => ({ x, y })),
      blue: curvePts[3].map(({ x, y }) => ({ x, y })),
      // Prefix render LUTs stay DECOUPLED from the authoring points (Vision writes
      // the stored bands verbatim); the tail carries the authoring points above.
      compiledLuts: { master: curve.luts.master, r: curve.luts.r, g: curve.luts.g, b: curve.luts.b },
    },
    enabled: { ...base.enabled, toneCurve: curve.enabled },
    detail,
    effects,
    optics,
    colorMixer: hsl,
    colorGrading: grade,
    transform: geometry,
    profile,
    calibration,
    crop,
    heal: { spots: healSpots },
    engineMasks: masks,
    enhance,
    pointColor: { samples: pointColors },
    };
  }, [basic, curve, curvePts, param, detail, effects, optics, hsl, grade, geometry, profile, calibration, crop, healSpots, masks, enhance, pointColors]);

  // Where the develop's camera profiles come from (a staged RAW, or a Camera
  // Raw Smart Object's RAW source).
  const profileTarget = { sessionId: request.sessionId, documentId: request.targetDocumentId, layerId: request.targetLayerId };
  const profileOptions = cameraRawProfileMenu(profileLibrary, profileMetadata, profile);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const proxyRef = useRef<Engine | null>(null);
  const proxyScaleRef = useRef(1);
  const pristineRef = useRef<Uint8ClampedArray | null>(null);
  const lastCopyRef = useRef<Uint8ClampedArray | null>(null);
  const appliedRef = useRef(false);
  const smartIndexRef = useRef<number | undefined>(undefined);
  const sourceEngineRef = useRef<Engine | null>(null);
  const sourceLayerRef = useRef(0);
  const smartPreviewRef = useRef(false);
  const proxyMaxRef = useRef(0);
  const sourceRef = useRef<CameraRawSidecarSourceSnapshot | null>(null);
  const nextEditIdRef = useRef(1);
  const rafRef = useRef(0);
  const freedRef = useRef(false);
  // React may batch pointer events. Keep the latest collections synchronous so
  // repeated input cannot cross a canonical limit before the next render.
  const healSpotsRef = useRef<WorkingHealSpot[]>(def.heal.spots);
  const masksRef = useRef<WorkingEngineMask[]>(def.engineMasks ?? []);
  const pointColorsRef = useRef<WorkingPointColorSample[]>(def.pointColor.samples);
  // In-flight on-canvas drags. Each is captured on pointerdown and read on every
  // subsequent move, so a drag stays anchored to where it started even though
  // the rect/points it edits change under it.
  const cropDragRef = useRef<{ handle: CropHandle; x: number; y: number; rect: CropRect } | null>(null);
  const maskDragRef = useRef(-1);
  const healStrokeRef = useRef<{ id: number; base: WorkingHealSpot[]; points: { x: number; y: number }[] } | null>(null);
  const uprightLinesRef = useRef<UprightLine[]>([]);
  const guideDragRef = useRef(false);
  const setHealSpots = (next: WorkingHealSpot[] | ((current: WorkingHealSpot[]) => WorkingHealSpot[])) => {
    const value = typeof next === "function" ? next(healSpotsRef.current) : next;
    healSpotsRef.current = value;
    setHealSpotsState(value);
  };
  // Detect Spots: auto-find dust/blemish blobs in the current preview and seed a
  // healing spot at each (source pulled toward a cleaner area). Replaces the
  // spot list so re-detecting doesn't stack duplicates; each spot is refinable.
  const detectSpots = () => {
    const proxy = proxyRef.current;
    const copy = lastCopyRef.current;
    if (!proxy || !copy) return;
    const found = detectDustSpots(copy, proxy.width(), proxy.height(), {
      sensitivity: 0.6,
      maxSpots: MAX_CAMERA_RAW_HEAL_SPOTS,
    });
    setHealSpots(found.map((s) => {
      const src = healSourceFor(s);
      return {
        id: `detect-${nextEditIdRef.current++}`,
        mode: "heal" as const,
        x: s.x, y: s.y,
        sourceX: src.sourceX, sourceY: src.sourceY,
        radius: Math.max(0.01, s.radius),
        feather: 0.5,
        opacity: 1,
      };
    }));
  };
  const setMasks = (next: WorkingEngineMask[] | ((current: WorkingEngineMask[]) => WorkingEngineMask[])) => {
    const value = typeof next === "function" ? next(masksRef.current) : next;
    masksRef.current = value;
    setMasksState(value);
  };
  const setPointColors = (next: WorkingPointColorSample[] | ((current: WorkingPointColorSample[]) => WorkingPointColorSample[])) => {
    const value = typeof next === "function" ? next(pointColorsRef.current) : next;
    pointColorsRef.current = value;
    setPointColorsState(value);
  };
  // Point Color: sample a preview pixel and seed a socket at its colour (shifts
  // start neutral, a mid range). Mirrors the engine's Rec.601 rgb→hsl so the
  // swatch and the selection agree.
  const addPointColor = (sample: [number, number, number]) => {
    if (pointColorsRef.current.length >= MAX_CAMERA_RAW_POINT_COLORS) {
      refuseEdit(`Camera Raw supports up to ${MAX_CAMERA_RAW_POINT_COLORS} point colours. Delete one before sampling another.`);
      return;
    }
    const [srcHue, srcSat, srcLum] = rgbToHsl(sample[0], sample[1], sample[2]);
    setEditLimitError(null);
    setPointColors((current) => [...current, {
      id: `point-color-${nextEditIdRef.current++}`,
      srcHue, srcSat, srcLum, hue: 0, sat: 0, lum: 0, range: 0.5,
    }]);
  };

  const renderCopy = (copy: Uint8ClampedArray | null) => {
    const cv = canvasRef.current, proxy = proxyRef.current;
    if (!cv || !proxy || !copy) return;
    const w = proxy.width(), h = proxy.height();
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(w, h);
    let shown: Uint8ClampedArray | Uint8Array = copy;
    if (splitBA !== "off" && pristineRef.current && lastCopyRef.current
      && pristineRef.current.length === lastCopyRef.current.length) {
      shown = splitBeforeAfter(pristineRef.current, lastCopyRef.current, w, h, splitBA);
    }
    if (showShadowClip || showHighlightClip) shown = clippingOverlay(shown, w, h, showShadowClip, showHighlightClip);
    if (showSpots) shown = visualizeSpots(shown, w, h, spotThreshold);
    img.data.set(shown);
    ctx.putImageData(img, 0, 0);
    if (splitBA !== "off") {
      ctx.save();
      ctx.strokeStyle = "#ffbf47";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (splitBA === "lr") { ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); }
      else { ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); }
      ctx.stroke();
      ctx.restore();
    }
    if (showBefore) return;
    ctx.save();
    ctx.lineWidth = 1.5;
    if (cropEnabledOf(crop) || canvasTool === "crop") {
      const { left, top, right, bottom } = crop.rect;
      const rx = left * w, ry = top * h, rw = (right - left) * w, rh = (bottom - top) * h;
      ctx.strokeStyle = "#f2f2f2";
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      if (canvasTool === "crop") {
        // Rule-of-thirds guides + the eight grab handles, so the rect reads as
        // draggable and composition is judgeable while dragging it.
        ctx.setLineDash([]);
        ctx.beginPath();
        for (const t of [1 / 3, 2 / 3]) {
          ctx.moveTo(rx + rw * t, ry); ctx.lineTo(rx + rw * t, ry + rh);
          ctx.moveTo(rx, ry + rh * t); ctx.lineTo(rx + rw, ry + rh * t);
        }
        ctx.stroke();
        ctx.fillStyle = "#f2f2f2";
        for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) {
          if (fx === 0.5 && fy === 0.5) continue;
          ctx.fillRect(rx + rw * fx - 3, ry + rh * fy - 3, 6, 6);
        }
      }
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = "#ffbf47";
    for (const spot of healSpots) {
      ctx.beginPath();
      ctx.arc(spot.x * w, spot.y * h, Math.max(3, spot.radius * Math.min(w, h)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(spot.x * w, spot.y * h);
      ctx.lineTo(spot.sourceX * w, spot.sourceY * h);
      ctx.stroke();
    }
    for (const mask of masks) {
      // The selected gradient's handles are what the pointer actually grabs, so
      // they are drawn larger and joined by the axis they define.
      const gradient = GRADIENT_MASK_KINDS.has(mask.kind);
      const active = gradient && mask.id === activeMaskId;
      ctx.fillStyle = active ? "#ffbf47" : "#54b8ff";
      if (gradient && mask.points.length >= 2) {
        ctx.strokeStyle = active ? "#ffbf47" : "#54b8ff";
        ctx.beginPath();
        ctx.moveTo(mask.points[0].x * w, mask.points[0].y * h);
        ctx.lineTo(mask.points[1].x * w, mask.points[1].y * h);
        ctx.stroke();
      }
      for (const point of mask.points) {
        ctx.beginPath();
        ctx.arc(point.x * w, point.y * h, active ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (canvasTool === "upright-guides") {
      ctx.strokeStyle = "#ffbf47";
      for (const guide of uprightLines) {
        ctx.beginPath();
        ctx.moveTo(guide.x0 * w, guide.y0 * h);
        ctx.lineTo(guide.x1 * w, guide.y1 * h);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  const replaceProxy = (next: Engine) => {
    const previous = proxyRef.current;
    proxyRef.current = next;
    freedRef.current = false;
    if (previous && previous !== next) previous.free();
  };

  // Render the pinned target. Smart Object re-edits rebuild a temporary stack
  // from smart_src with fid 17 replaced; ordinary/staged RAW proxies undo and
  // reapply a single develop op. Neither path mutates the live document.
  const applyFrame = () => {
    let proxy = proxyRef.current;
    if (!proxy) return;
    // While Guided guides are drawn, show the un-warped image they are measured on.
    // The chosen camera profile's tables go to the engine first (or it is missing).
    const prepared = store.prepareCameraRawProfile(canvasTool === "upright-guides" ? unwarped(recipe) : recipe, profileTarget);
    const shown = prepared.recipe;
    setProfileMissing(prepared.missing);
    // Found again only now (the library finished loading, or an ACR name
    // matched the embedded profile): show it as what it resolved to.
    const found = prepared.recipe.profile;
    if (found.id !== profile.id || found.digest !== profile.digest) setProfile(found);
    if (smartPreviewRef.current) {
      const source = sourceEngineRef.current as CameraRawEngine | null;
      const make = source?.smart_filter_proxy_engine;
      if (!source || !make || smartIndexRef.current === undefined) return;
      const scale = proxyScaleRef.current;
      const next = make.call(
        source,
        sourceLayerRef.current,
        smartIndexRef.current,
        17,
        workingRecipeToParams(shown, scale),
        0, 0, source.width(), source.height(), proxyMaxRef.current,
      );
      replaceProxy(next);
      proxy = next;
    } else {
      if (appliedRef.current) proxy.undo();
      proxy.camera_raw_develop(workingRecipeToParams(shown, proxyScaleRef.current));
      appliedRef.current = true;
    }
    const copy = engine.engineOutputCopy(proxy);
    if (!copy) return;
    lastCopyRef.current = copy;
    if (!showBefore) renderCopy(copy);
    setHist(downsampleBins(channelCounts(copy, "luma"), HIST_BINS));
    setClip(clippingCounts(copy));
    // Barrier for tests: a develop just committed (renderCopy already painted
    // this same copy above). Overlay/before-after repaints do NOT run applyFrame,
    // so this uniquely marks "the canvas shows a freshly developed frame".
    if (canvasRef.current) canvasRef.current.dataset.mvCrDevelopFrame = String(++developFrameRef.current);
  };

  // Scratch preview of a staged RAW (or pixel document): the whole frame at
  // the dialog's proxy size, developed by applyFrame.
  const stageProxy = (eng: Engine) => {
    const proxy = eng.proxy_engine(0, 0, eng.width(), eng.height(), proxyMaxRef.current);
    replaceProxy(proxy);
    appliedRef.current = false;
    proxyScaleRef.current = Math.max(proxy.width(), proxy.height()) / Math.max(eng.width(), eng.height());
    pristineRef.current = engine.engineOutputCopy(proxy);
    lastCopyRef.current = pristineRef.current;
  };

  const changeDemosaic = (value: string) => {
    if (!request.sessionId) return;
    try {
      store.setCameraRawSessionDemosaic(request.sessionId, value as RawDemosaic);
      setDecodeError(null);
    } catch (error) {
      setDecodeError(`Could not re-decode with that demosaic: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const freeProxy = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (!freedRef.current && proxyRef.current) {
      proxyRef.current.free();
      proxyRef.current = null;
      freedRef.current = true;
    }
  };

  // Resolve the transaction/document once, pin its engine/layer, seed the full
  // canonical recipe, and construct the correct scratch preview.
  useEffect(() => {
    const cancelStagedSession = () => {
      if (request.sessionId) store.cancelCameraRawSession(request.sessionId);
    };
    const runtime = request.sessionId ? store.cameraRawWorkspaceSession(request.sessionId) : null;
    const target = request.targetDocumentId !== undefined && request.targetLayerId !== undefined
      ? store.cameraRawTarget(request.targetDocumentId, request.targetLayerId)
      : null;
    const eng = runtime?.engine ?? target?.engine;
    const layerId = runtime?.engine.active_layer_id() ?? request.targetLayerId;
    if (!eng || layerId === undefined) { cancelStagedSession(); close(); return; }
    sourceEngineRef.current = eng;
    setCanSuperResolution(eng.can_super_resolution());
    sourceLayerRef.current = layerId;
    sourceRef.current = runtime?.source
      ? cameraRawSidecarSourceSnapshot(runtime.source)
      : (request.invocation === "reopen" ? target?.source ?? null : null);
    setSnapshots(sourceRef.current?.snapshots ?? []);
    const dw = eng.width(), dh = eng.height();
    if (!dw || !dh) { cancelStagedSession(); close(); return; }
    const previewWidth = Math.min(window.innerWidth - 420, 1000);
    const maxDim = proxyMaxDim(previewWidth, window.innerHeight - 220, window.devicePixelRatio || 1);
    proxyMaxRef.current = maxDim;
    proxyScaleRef.current = Math.min(1, maxDim / Math.max(dw, dh));
    const idx = developFilterIndex(eng, layerId);
    // The live fid-17 payload is authoritative after undo/redo/history seek.
    // Source metadata is the fallback only for a staged RAW or pixel document.
    const live: VisionDevelopRecipe = idx !== undefined
      ? engineParamsToWorkingRecipe(eng.smart_filter_params(layerId, idx))
      : sourceRef.current?.recipe ?? def;
    // Its camera profile found again (the params name it by digest only).
    const metadata = store.cameraRawProfileMetadata(profileTarget);
    setProfileMetadata(metadata);
    if (rawOnly) void findAdobeCameraProfiles(metadata);
    const prepared = store.prepareCameraRawProfile(
      { ...live, profile: keepProfileName(live.profile, sourceRef.current?.recipe.profile) },
      profileTarget,
    );
    const seeded = prepared.recipe;
    setProfileMissing(prepared.missing);
    applyRecipe(seeded);
    const typed = eng as CameraRawEngine;
    if (idx !== undefined && typed.smart_filter_proxy_engine) {
      smartIndexRef.current = idx;
      smartPreviewRef.current = true;
      // On a re-edit, Before means the last committed Camera Raw result—not a
      // synthetic reset to defaults. This keeps comparison faithful even when
      // the Smart Object already has a non-neutral recipe.
      const before = typed.smart_filter_proxy_engine(
        layerId, idx, 17, workingRecipeToParams(seeded, proxyScaleRef.current), 0, 0, dw, dh, maxDim,
      );
      pristineRef.current = engine.engineOutputCopy(before);
      before.free();
      const proxy = typed.smart_filter_proxy_engine(
        layerId, idx, 17, workingRecipeToParams(seeded, proxyScaleRef.current), 0, 0, dw, dh, maxDim,
      );
      proxyRef.current = proxy;
      lastCopyRef.current = engine.engineOutputCopy(proxy);
    } else {
      stageProxy(eng);
    }
    setDemosaic(runtime?.source.demosaic ?? "bilinear");
    renderCopy(lastCopyRef.current);
    return () => {
      try { freeProxy(); }
      finally {
        // Open, Done, and explicit Cancel retire synchronously, so this is a
        // no-op on normal exits. A replacement/unmount still owns the staged
        // session, and must cancel it so the next queued RAW can be presented.
        cancelStagedSession();
      }
    };
    // The request is intentionally captured once; dialog targets cannot drift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build a small proxy thumbnail per pending filmstrip session, once each. Each
  // session owns its own decoded engine; render it into a throwaway 72px proxy,
  // copy the pixels out, free the proxy immediately (no leak; never touches the
  // main preview proxy). Runs as sources stage in (sessionsRev).
  useEffect(() => {
    if (!rawOnly) return;
    const next: Record<string, string> = {};
    for (const { sessionId } of store.pendingCameraRawSessions()) {
      if (thumbDoneRef.current.has(sessionId)) continue;
      const runtime = store.cameraRawWorkspaceSession(sessionId);
      if (!runtime) continue;
      const eng = runtime.engine;
      const dw = eng.width(), dh = eng.height();
      if (!dw || !dh) continue;
      const proxy = eng.proxy_engine(0, 0, dw, dh, 72);
      const pw = proxy.width(), ph = proxy.height();
      const copy = engine.engineOutputCopy(proxy);
      proxy.free();
      if (!copy) continue;
      const cv = document.createElement("canvas");
      cv.width = pw; cv.height = ph;
      const ctx = cv.getContext("2d");
      if (!ctx) continue;
      const img = ctx.createImageData(pw, ph);
      img.data.set(copy);
      ctx.putImageData(img, 0, 0);
      next[sessionId] = cv.toDataURL("image/png");
      thumbDoneRef.current.add(sessionId);
    }
    if (Object.keys(next).length) setThumbs((prev) => ({ ...prev, ...next }));
  }, [sessionsRev, rawOnly]);

  // rAF-coalesced preview: re-apply whenever the recipe changes (PreviewDialog
  // discipline, but against the scratch engine — no actions.suspend needed).
  useEffect(() => {
    if (!proxyRef.current) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; applyFrame(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, canvasTool === "upright-guides", profileLibrary]);

  // Demosaic (menu or MCP) re-decodes the staged RAW into a new session
  // engine: rebuild the preview from it and develop the current recipe again.
  useEffect(() => {
    if (!request.sessionId || smartPreviewRef.current || !sourceEngineRef.current) return;
    const runtime = store.cameraRawWorkspaceSession(request.sessionId);
    if (!runtime || runtime.engine === sourceEngineRef.current) return;
    sourceEngineRef.current = runtime.engine;
    setDemosaic(runtime.source.demosaic ?? "bilinear");
    stageProxy(runtime.engine);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; applyFrame(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsRev]);

  // Before/after: swap the shown copy without re-running the engine (Y toggles).
  useEffect(() => {
    renderCopy(showBefore ? pristineRef.current : lastCopyRef.current);
    // `renderCopy` intentionally reads the latest overlay state; recipe changes
    // repaint through `applyFrame`, while this effect only swaps before/after and
    // repaints when the Visualize Spots view toggles (no re-develop needed).
    // canvasTool/activeMaskId are here because they change only the OVERLAY (crop
    // grid + handles, which gradient's handles are hot) — arming a tool must show
    // its handles immediately, without waiting for the next develop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBefore, showSpots, spotThreshold, splitBA, showShadowClip, showHighlightClip, canvasTool, activeMaskId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Same guard as App.tsx's global keydown: a focused field (the Preset name
      // Input, a numeric field) owns its keys, and Cmd/Ctrl/Alt+Y is not our
      // shortcut — typing "Sunny Day" must not flash the before/after preview. (#31)
      if (isEditableTarget(e.target)) return;
      // An open Select's type-ahead ("Y…") marks its keys handled.
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "y" || e.key === "Y") setShowBefore((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const recompileCurve = (pts: CurvePoint[][], p: ParametricCurve, enabled: boolean) =>
    setCurve({ enabled, luts: compileCurveLuts(pts, p) });
  const onCurvePts = (next: CurvePoint[]) => {
    if (next.length > MAX_CAMERA_RAW_CURVE_POINTS_PER_CHANNEL) {
      setEditLimitError(`Camera Raw supports up to ${MAX_CAMERA_RAW_CURVE_POINTS_PER_CHANNEL} tone-curve points per channel. Delete a point before adding another.`);
      return;
    }
    setEditLimitError(null);
    const pts = curvePts.map((p, i) => (i === curveCh ? next : p));
    setCurvePts(pts);
    recompileCurve(pts, param, true);
  };
  const onParam = (patch: Partial<ParametricCurve>) => {
    const p = { ...param, ...patch };
    setParam(p);
    recompileCurve(curvePts, p, true);
  };

  const allPresets = [...DEFAULT_CAMERA_RAW_PRESETS, ...userPresets];

  // Seed every panel, including editable curve source data. Canonicalization
  // migrates older presets/filter params and fills every v2 raw-only field.
  const applyRecipe = (r: VisionDevelopRecipe) => {
    const next = structuredClone(r);
    const masksNext = next.engineMasks ?? [];
    setBasic(next.basic);
    setDetail(next.detail);
    setEffects(next.effects);
    setOptics(next.optics);
    setHsl(next.colorMixer);
    setGrade(next.colorGrading);
    setGeometry(next.transform);
    setCurve({ enabled: next.enabled.toneCurve, luts: curveLutsOf(next.toneCurve) });
    setCurvePts(curvePointsForUi([next.toneCurve.point, next.toneCurve.red, next.toneCurve.green, next.toneCurve.blue]));
    setParam(next.toneCurve.parametric);
    setProfile(next.profile);
    setCalibration(next.calibration);
    setCrop(next.crop);
    setHealSpots(next.heal.spots);
    setMasks(masksNext);
    setPointColors(next.pointColor.samples);
    setEditLimitError(null);
    setEnhance(next.enhance ?? DEFAULT_ENHANCE);
    setActiveMaskId(masksNext[0]?.id ?? null);
  };

  // Save the current recipe as a named preset (blank → auto "Preset N"); saving
  // over an existing name replaces it. Persisted to localStorage.
  // ACR Snapshots: named recipe states saved WITH the raw source (and its XMP),
  // unlike presets, which are a cross-document localStorage library.
  const updateSnapshots = (next: CameraRawSnapshotEntry[]) => {
    setSnapshots(next);
    if (sourceRef.current) sourceRef.current = { ...sourceRef.current, snapshots: next };
    if (request.sessionId) store.setCameraRawSnapshots(request.sessionId, next);
  };
  const addSnapshot = () => {
    if (snapshots.length >= MAX_CAMERA_RAW_SNAPSHOTS) return;
    updateSnapshots([...snapshots, { name: `Snapshot ${snapshots.length + 1}`, recipe: normalizeWorkingRecipe(recipe) }]);
  };
  const savePreset = () => {
    const name = presetName.trim() || defaultCameraRawPresetName(allPresets.map((p) => p.name));
    const next = addCameraRawPresetTo(userPresets, { name, recipe: normalizeWorkingRecipe(recipe) });
    if (!saveCameraRawPresets(next)) {
      setEditLimitError("Could not save the Camera Raw preset — browser storage is full or unavailable. Remove an existing preset or free storage, then try again.");
      return;
    }
    setUserPresets(next);
    setEditLimitError(null);
    setPresetName("");
  };
  // Presets travel as `.xmp` in the shared Camera Raw dialect, so a look moves
  // between Vision, Galerie and Lightroom/ACR instead of dying in localStorage.
  const exportPreset = async () => {
    const name = presetName.trim() || defaultCameraRawPresetName(allPresets.map((p) => p.name));
    setSidecarBusy(true);
    try { await exportCameraRawPreset({ name, recipe: normalizeWorkingRecipe(recipe) }); }
    finally { setSidecarBusy(false); }
  };
  const importPreset = async () => {
    setSidecarBusy(true);
    try {
      const preset = await importCameraRawPreset();
      if (!preset) return;
      // The library stores what Vision can render; the report is about THIS
      // import, so it is shown rather than saved (#490).
      const next = addCameraRawPresetTo(userPresets, { name: preset.name, recipe: preset.recipe });
      applyRecipe(applyWorkingPreset(normalizeWorkingRecipe(preset.recipe), recipe));
      if (saveCameraRawPresets(next)) {
        setUserPresets(next);
        setEditLimitError(null);
      } else {
        setEditLimitError("The preset was applied but could not be added to Presets — browser storage is full or unavailable. Remove an existing preset or free storage, then try again.");
      }
    } catch (e) {
      // Fail visibly: an unreadable preset must not look like "nothing changed".
      setEditLimitError(e instanceof Error ? e.message : "Could not import that preset.");
    } finally { setSidecarBusy(false); }
  };

  // Auto White Balance: measure the pristine backdrop's cast and set Temperature
  // + Tint to neutralise it (the preview re-develops from the same backdrop).
  // The menu label moves to Auto even before a backdrop exists, so the choice is
  // never silently discarded.
  const autoWB = () => {
    const measured = pristineRef.current ? autoWhiteBalance(pristineRef.current) : null;
    setBasic((b) => ({ ...b, wbMode: "auto", ...(measured ?? {}) }));
  };
  // White Balance menu: As Shot / Auto / the six lighting presets / Custom.
  // Auto is the only entry that needs the image, so it routes through autoWB;
  // the rest are pure offsets the shared develop schema already defines.
  const setWbMode = (mode: WhiteBalanceMode) => {
    if (mode === "auto") { autoWB(); return; }
    setBasic((b) => applyWhiteBalance(b, mode));
  };
  const wbPreset = WB_PRESETS.find((p) => p.mode === basic.wbMode);
  // Auto tone: derive Exposure/Contrast/Highlights/Shadows/Whites/Blacks from the
  // baseline preview's tonal distribution (ACR's Basic "Auto"). One-click start.
  const autoTone = () => {
    const src = pristineRef.current ?? lastCopyRef.current;
    const proxy = proxyRef.current;
    if (!src || !proxy) return;
    setBasic((b) => ({ ...b, ...autoDevelopBasic(src, proxy.width(), proxy.height()) }));
  };

  // Upright: solve Vertical/Horizontal/Rotate on the un-warped image and bake
  // them into the Geometry sliders; only the mode itself rides the recipe tail.
  const uprightImage = (): { data: Uint8ClampedArray; width: number; height: number } | null => {
    if (!smartPreviewRef.current) {
      const proxy = proxyRef.current;
      return proxy && pristineRef.current
        ? { data: pristineRef.current, width: proxy.width(), height: proxy.height() }
        : null;
    }
    // A re-edit's Before copy is the committed, already-warped result, so render
    // the stack once more without the geometry.
    const source = sourceEngineRef.current as CameraRawEngine | null;
    const make = source?.smart_filter_proxy_engine;
    if (!source || !make || smartIndexRef.current === undefined) return null;
    const flat = make.call(
      source, sourceLayerRef.current, smartIndexRef.current, 17,
      workingRecipeToParams(unwarped(recipe), proxyScaleRef.current),
      0, 0, source.width(), source.height(), proxyMaxRef.current,
    );
    try {
      const data = engine.engineOutputCopy(flat);
      return data ? { data, width: flat.width(), height: flat.height() } : null;
    } finally {
      flat.free();
    }
  };
  const setUprightGuides = (lines: UprightLine[]) => {
    uprightLinesRef.current = lines;
    setUprightLinesState(lines);
    setGeometry((g) => ({ ...g, upright: "guided", ...solveGuidedUpright(lines) }));
  };
  const applyUpright = (mode: UprightMode) => {
    setUprightStatus(null);
    if (mode === "guided") {
      setGeometry((g) => ({ ...g, upright: "guided" }));
      setCanvasTool("upright-guides");
      return;
    }
    setCanvasTool((tool) => (tool === "upright-guides" ? "none" : tool));
    if (mode === "off") {
      uprightLinesRef.current = [];
      setUprightLinesState([]);
      setGeometry((g) => ({ ...g, upright: "off", vertical: 0, horizontal: 0, rotate: 0 }));
      return;
    }
    const image = uprightImage();
    const solved = image && solveUpright(mode, image);
    if (!solved) {
      // Nothing to straighten: say so, and leave the recipe (and mode) alone.
      setUprightStatus(UPRIGHT_NO_LINES);
      return;
    }
    setGeometry((g) => ({ ...g, upright: mode, ...solved }));
  };

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    };
  };
  // Width ÷ height of the DISPLAYED preview: the frame aspect the crop lock and
  // the heal-stroke spacing are measured in (the proxy preserves it).
  const canvasAspect = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return rect.height > 0 ? rect.width / rect.height : 1;
  };
  // Read one proxy pixel under a normalised canvas point. Defaults to the DEVELOPED
  // buffer (what the user is actually pointing at); the WB eyedropper passes the
  // pristine backdrop instead, so its solve shares Auto White Balance's baseline.
  const samplePixel = (
    point: { x: number; y: number },
    pixels: Uint8ClampedArray | null = lastCopyRef.current,
  ): [number, number, number] | null => {
    const proxy = proxyRef.current;
    if (!proxy || !pixels) return null;
    const x = Math.min(proxy.width() - 1, Math.floor(point.x * proxy.width()));
    const y = Math.min(proxy.height() - 1, Math.floor(point.y * proxy.height()));
    const offset = (y * proxy.width() + x) * 4;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
  };
  const refuseEdit = (message: string) => setEditLimitError(message);
  const paintMaskPoint = (point: { x: number; y: number }, pressure: number) => {
    if (!activeMaskId) return;
    const current = masksRef.current;
    if (!current.some((mask) => mask.id === activeMaskId)) return;
    if (countMaskPoints(current) >= MAX_CAMERA_RAW_MASK_POINTS) {
      refuseEdit(`Camera Raw supports up to ${MAX_CAMERA_RAW_MASK_POINTS} mask points. Delete a mask before painting more.`);
      return;
    }
    setEditLimitError(null);
    setMasks(current.map((mask) => mask.id === activeMaskId
      ? { ...mask, points: [...mask.points, { ...point, pressure: Math.max(0.05, pressure || 1) }] }
      : mask));
  };
  // Move one control point of the active mask — from a preview drag, or from the
  // numeric handle rows (which are how a gradient is aimed without a pointer).
  const moveMaskPoint = (index: number, patch: { x?: number; y?: number }) => {
    setMasks((current) => current.map((mask) => (mask.id === activeMaskId
      ? { ...mask, points: mask.points.map((pt, i) => (i === index ? { ...pt, ...patch } : pt)) }
      : mask)));
  };
  // Remove-brush drag: resample the stroke so far into a chain of overlapping
  // heal stamps sharing ONE source offset, and replace the stamps this stroke
  // contributed (the spots that existed when it started are never touched).
  const extendHealStroke = (point: { x: number; y: number }, aspect: number) => {
    const stroke = healStrokeRef.current;
    if (!stroke) return;
    stroke.points.push(point);
    const room = MAX_CAMERA_RAW_HEAL_SPOTS - stroke.base.length;
    if (room <= 0) return;
    setHealSpots([
      ...stroke.base,
      ...healStrokeSpots(stroke.points, HEAL_SPOT_RADIUS, aspect).slice(0, room)
        .map((spot, index) => ({ ...spot, id: `heal-${stroke.id}-${index}` })),
    ]);
  };
  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (canvasTool === "none") return;
    const point = canvasPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (canvasTool === "heal") {
      if (healSpotsRef.current.length >= MAX_CAMERA_RAW_HEAL_SPOTS) {
        refuseEdit(`Camera Raw supports up to ${MAX_CAMERA_RAW_HEAL_SPOTS} healing spots. Remove one before adding another.`);
        return;
      }
      const strokeId = nextEditIdRef.current++;
      setEditLimitError(null);
      // A click stays exactly the classic single spot; only a drag (below)
      // upgrades it into a stroke.
      healStrokeRef.current = { id: strokeId, base: healSpotsRef.current, points: [point] };
      setHealSpots((spots) => [...spots, {
        id: `heal-${strokeId}`, mode: "heal" as const, ...point,
        sourceX: Math.min(1, point.x + 0.08), sourceY: point.y,
        radius: HEAL_SPOT_RADIUS, feather: 0.5, opacity: 1,
      }]);
    } else if (canvasTool === "crop") {
      const handle = cropHandleAt(crop.rect, point);
      // ponytail: a press outside the rect does nothing rather than rubber-banding
      // a new one — the rect starts as the whole frame, so every edge is grabbable.
      cropDragRef.current = handle ? { handle, x: point.x, y: point.y, rect: crop.rect } : null;
    } else if (canvasTool === "mask-handles") {
      const active = masksRef.current.find((mask) => mask.id === activeMaskId);
      maskDragRef.current = active ? maskPointAt(active.points, point) : -1;
      if (maskDragRef.current >= 0) moveMaskPoint(maskDragRef.current, point);
    } else if (canvasTool === "mask-brush") {
      paintMaskPoint(point, event.pressure);
    } else if (canvasTool === "point-color") {
      const sample = samplePixel(point);
      if (sample) addPointColor(sample);
    } else if (canvasTool === "wb") {
      // WB eyedropper: the clicked pixel is declared neutral, so Temperature/Tint
      // become whatever removes ITS cast (ACR's primary white-balance affordance).
      const sample = samplePixel(point, pristineRef.current);
      if (sample) setBasic((b) => ({ ...b, wbMode: "custom", ...whiteBalanceFromSample(sample) }));
    } else if (canvasTool === "upright-guides") {
      // Guided Upright: each drag draws one guide; like ACR, the last four count.
      guideDragRef.current = true;
      setUprightGuides([...uprightLinesRef.current.slice(-3), { x0: point.x, y0: point.y, x1: point.x, y1: point.y }]);
    } else if (activeMaskId) {
      const sample = samplePixel(point);
      if (!sample) return;
      const selected = masksRef.current.find((mask) => mask.id === activeMaskId);
      if (!selected) return;
      if ((selected?.colorSamples?.length ?? 0) >= MAX_CAMERA_RAW_MASK_COLORS) {
        refuseEdit(`Camera Raw supports up to ${MAX_CAMERA_RAW_MASK_COLORS} color samples per mask. Clear samples before adding another.`);
        return;
      }
      setEditLimitError(null);
      setMasks((current) => current.map((mask) => mask.id === activeMaskId
        ? { ...mask, colorSamples: [...(mask.colorSamples ?? []), sample] }
        : mask));
    }
  };
  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if ((event.buttons & 1) === 0) return;
    if (canvasTool === "mask-brush") paintMaskPoint(canvasPoint(event), event.pressure);
    else if (canvasTool === "heal") extendHealStroke(canvasPoint(event), canvasAspect(event));
    else if (canvasTool === "mask-handles" && maskDragRef.current >= 0) moveMaskPoint(maskDragRef.current, canvasPoint(event));
    else if (canvasTool === "upright-guides" && guideDragRef.current) {
      const point = canvasPoint(event);
      const lines = uprightLinesRef.current;
      setUprightGuides([...lines.slice(0, -1), { ...lines[lines.length - 1], x1: point.x, y1: point.y }]);
    }
    else if (canvasTool === "crop" && cropDragRef.current) {
      const drag = cropDragRef.current;
      const point = canvasPoint(event);
      const aspect = crop.constrainAspect;
      setCrop((current) => ({
        ...current,
        rect: dragCropRect(drag.rect, drag.handle, point.x - drag.x, point.y - drag.y,
          aspect != null ? { aspect, frameAspect: canvasAspect(event) } : null),
      }));
    }
  };
  // End every in-flight drag together: the next press re-grabs from scratch.
  const onCanvasPointerUp = () => {
    cropDragRef.current = null;
    maskDragRef.current = -1;
    healStrokeRef.current = null;
    guideDragRef.current = false;
  };
  const addMask = (kind: EngineMaskKind, initialPoints?: { x: number; y: number; pressure: number }[]) => {
    const current = masksRef.current;
    if (current.length >= MAX_CAMERA_RAW_MASKS) {
      refuseEdit(`Camera Raw supports up to ${MAX_CAMERA_RAW_MASKS} masks. Delete one before adding another.`);
      return;
    }
    const id = `mask-${nextEditIdRef.current++}`;
    const points = initialPoints ?? (kind === "linear-gradient" || kind === "bidirectional-gradient"
      ? [{ x: 0.25, y: 0.5, pressure: 1 }, { x: 0.75, y: 0.5, pressure: 1 }]
      : kind === "radial-gradient"
        ? [{ x: 0.5, y: 0.5, pressure: 1 }, { x: 0.72, y: 0.5, pressure: 1 }]
        : []);
    if (countMaskPoints(current) + points.length > MAX_CAMERA_RAW_MASK_POINTS) {
      refuseEdit(`Camera Raw supports up to ${MAX_CAMERA_RAW_MASK_POINTS} mask points. Delete a mask before adding this mask.`);
      return;
    }
    const mask: WorkingEngineMask = {
      id, name: `${kind.replace(/-/g, " ")} ${current.length + 1}`, kind,
      enabled: true, inverted: false, opacity: 1, feather: 0.5,
      points,
      ...(kind === "luminance-range" ? { range: [0.25, 0.75] as [number, number] } : {}),
      ...(kind === "color-range" ? { colorSamples: [] } : {}),
      adjustments: defaultCameraRawLocalAdjustments(),
    };
    setEditLimitError(null);
    setMasks([...current, mask]);
    setActiveMaskId(id);
    setCanvasTool(kind === "brush" ? "mask-brush"
      : kind === "color-range" ? "color-sample"
      // A gradient spawns at a default position it has to be dragged away from,
      // so hand the pointer straight to its handles.
      : GRADIENT_MASK_KINDS.has(kind) ? "mask-handles" : "none");
  };
  // Subject: run U2-Net once and persist the matte OUTLINE into the recipe
  // (kind "outline" — deterministic replay, no model at develop time). The
  // ellipse heuristic remains the fallback when the model is absent. Sky keeps
  // its heuristic: U2-Net is a saliency model, not a sky segmenter.
  const addSubjectMask = async () => {
    try {
      const { subjectOutline } = await import("../../ml/onnx");
      const outline = await subjectOutline();
      if (outline && outline.length >= 3) {
        addMask("outline", outline);
        return;
      }
    } catch { /* model absent or failed — heuristic below */ }
    addMask("subject");
  };
  const activeMask = masks.find((mask) => mask.id === activeMaskId) ?? null;
  const totalMaskPoints = countMaskPoints(masks);
  const updateActiveMask = (patch: Partial<WorkingEngineMask>) => {
    if (!activeMaskId) return;
    setMasks((current) => current.map((mask) => mask.id === activeMaskId ? { ...mask, ...patch } : mask));
  };
  const sourceWithCurrentRecipe = (): CameraRawSidecarSourceSnapshot | null => {
    if (!sourceRef.current) return null;
    return { ...sourceRef.current, recipe: store.prepareCameraRawProfile(recipe, profileTarget).recipe };
  };
  const saveSettings = async (): Promise<boolean> => {
    const source = sourceWithCurrentRecipe();
    if (!source) return false;
    setSidecarBusy(true);
    try { return await saveCameraRawSidecar(source); }
    finally { setSidecarBusy(false); }
  };
  // Profile ▸ Load Profile…: add a .dcp to the library; it is offered for
  // images from the camera it was made for.
  const loadProfile = async () => {
    setProfileError(null);
    try {
      const entry = await importCameraRawProfileFile();
      if (entry && !profileMatchesCamera(entry.model, cameraModelKeys(profileMetadata))) {
        setProfileError(`Loaded “${entry.name}”, but it is made for ${entry.model || "an unnamed camera"}, so it isn't offered for this image.`);
      }
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Could not load that camera profile.");
    }
  };
  const importSettings = async () => {
    const source = sourceWithCurrentRecipe();
    if (!source) return;
    setSidecarBusy(true);
    try {
      const imported = await importCameraRawSidecar(source);
      if (imported) {
        sourceRef.current = imported.source;
        applyRecipe(normalizeWorkingRecipe(imported.source.recipe));
      }
    } finally { setSidecarBusy(false); }
  };
  const done = async () => {
    try {
      if (!request.sessionId || !await saveSettings()) return;
      finishTerminal(() => store.completeCameraRawDone(request.sessionId!));
    } catch {
      setTerminalError(true);
    }
  };
  const openRaw = (asSmartObject: boolean) => {
    if (!request.sessionId) return;
    finishTerminal(() => store.completeCameraRawOpen(request.sessionId!, recipe, asSmartObject) !== null);
  };
  // Generative Expand from the RAW workflow (ACR extends the crop outward and
  // outpaints the new border). Commit the develop as a Smart Object, then — only
  // on success — hand off to the existing Neural Filters ▸ Generative Expand
  // (MI-GAN). The pending-dialog bridge opens it once this workspace closes.
  const generativeExpandFromRaw = () => {
    if (!request.sessionId) return;
    finishTerminal(() => {
      const opened = store.completeCameraRawOpen(request.sessionId!, recipe, true) !== null;
      if (opened) store.requestDialog("neuralAI", "expand");
      return opened;
    });
  };
  const ok = () => {
    if (request.targetDocumentId === undefined || request.targetLayerId === undefined) return;
    if (!store.cameraRawDevelopTarget(request.targetDocumentId, request.targetLayerId, recipe, smartIndexRef.current)) return;
    freeProxy();
    close();
  };
  const cancel = () => {
    finishTerminal(() => !request.sessionId || store.cancelCameraRawSession(request.sessionId));
  };

  function finishTerminal(complete: () => boolean) {
    try {
      if (!complete()) { setTerminalError(true); return; }
      freeProxy();
      close();
    } catch {
      if (request.sessionId && !store.cameraRawWorkspaceSession(request.sessionId)) {
        freeProxy();
        close();
        return;
      }
      setTerminalError(true);
    }
  }

  // Filmstrip: other RAW sources staged alongside this one. Switching saves the
  // current recipe onto its session, activates the target, and re-presents the
  // workspace (keyed on sessionId, so it remounts and loads the target). The
  // sessionsRev subscription (declared with the other hooks) re-reads the list
  // as sources stage in asynchronously after this workspace has mounted.
  const filmstrip = rawOnly && request.sessionId ? store.pendingCameraRawSessions() : [];
  const switchTo = (targetId: string) => {
    if (!request.sessionId || targetId === request.sessionId) return;
    store.setCameraRawSessionWorkingRecipe(request.sessionId, recipe);
    if (store.activateCameraRawSession(targetId)) {
      store.requestDialog("cameraRaw", { invocation: request.invocation, sessionId: targetId } satisfies CameraRawDialogRequest);
    }
  };
  const syncSettings = () => {
    if (!request.sessionId) return;
    for (const s of filmstrip) {
      if (s.sessionId === request.sessionId) continue;
      const theirs = store.cameraRawSessionWorking(s.sessionId);
      if (theirs) store.setCameraRawSessionWorkingRecipe(s.sessionId, syncWorkingRecipe(recipe, theirs));
    }
  };

  const width = Math.min(typeof window !== "undefined" ? window.innerWidth - 64 : 1200, 1440);
  const forceSmartObject = request.invocation === "open-as-smart-object";
  const footer = rawOnly && request.sessionId
    ? <>
      {terminalError && <span role="alert">Could not finish. Retry or Cancel.</span>}
      <Button variant="ghost" disabled={sidecarBusy} data-mv-cr-save-settings onClick={() => { void saveSettings(); }}>Save Settings</Button>
      <Button variant="ghost" disabled={sidecarBusy} data-mv-cr-done onClick={() => { void done(); }}>Done</Button>
      <Button variant="ghost" onClick={cancel}>Cancel</Button>
      {!forceSmartObject && <Button variant="ghost" data-mv-cr-open onClick={() => openRaw(false)}>Open</Button>}
      <Button variant="primary" data-mv-cr-open-object onClick={() => openRaw(true)}>Open Object</Button>
    </>
    : <><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" onClick={ok}>OK</Button></>;

  return (
    <Dialog open onClose={cancel} title={rawOnly ? "Camera Raw" : "Camera Raw Filter"} width={width} footer={footer}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
        {/* Preview column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          {/* Zoom: the preview canvas is laid out wider than its box and the box
              scrolls, so panning is the platform's own (trackpad, scrollbars,
              scroll-into-view) and every pointer tool stays correct — they read
              normalised coordinates off the canvas' own client rect.
              ponytail: zoom is relative to Fit, so it tops out at the proxy's
              resolution; re-proxying the visible region at native resolution
              (proxy_engine already takes x/y/w/h) is the upgrade for true 1:1. */}
          <div data-mv-cr-preview style={{
            display: "flex", background: "var(--surface-2, #1a1a1a)", borderRadius: 6, padding: 8, minHeight: 200,
            alignItems: zoom > 1 ? "flex-start" : "center",
            justifyContent: zoom > 1 ? "flex-start" : "center",
            overflow: zoom > 1 ? "auto" : "hidden",
            maxHeight: "62vh",
          }}>
            <canvas ref={canvasRef} data-mv-cr-canvas onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerUp}
              style={{
                display: "block", height: "auto", flexShrink: 0,
                width: zoom > 1 ? `${zoom * 100}%` : "auto",
                maxWidth: zoom > 1 ? "none" : "100%",
                maxHeight: zoom > 1 ? "none" : "58vh",
              }} />
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Select aria-label="Preview Zoom" value={String(zoom)} onChange={(v) => setZoom(Number(v))}
              options={[{ value: "1", label: "Fit" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }, { value: "8", label: "8×" }]} />
            <Button variant="ghost" onPointerDown={() => setShowBefore(true)} onPointerUp={() => setShowBefore(false)}
              onPointerLeave={() => setShowBefore(false)} data-mv-cr-before>{showBefore ? "Before" : "After"}</Button>
            <Button variant={splitBA === "off" ? "ghost" : "primary"} data-mv-cr-split
              onClick={() => setSplitBA((m) => (m === "off" ? "lr" : m === "lr" ? "tb" : "off"))}>
              {splitBA === "off" ? "Split View" : splitBA === "lr" ? "Split L/R" : "Split T/B"}
            </Button>
            <span data-mv-cr-clip-shadow title="Toggle the shadow-clipping overlay (crushed shadows → blue)"
              onClick={() => setShowShadowClip((v) => !v)}
              style={{ fontSize: 12, cursor: "pointer", color: showShadowClip ? "#4d8dff" : "var(--text-2)", fontWeight: showShadowClip ? 600 : 400 }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: "#4d8dff", marginRight: 4 }} />
              Shadows {clip.shadow}
            </span>
            <span data-mv-cr-clip-highlight title="Toggle the highlight-clipping overlay (blown highlights → red)"
              onClick={() => setShowHighlightClip((v) => !v)}
              style={{ fontSize: 12, cursor: "pointer", color: showHighlightClip ? "#ff5d5d" : "var(--text-2)", fontWeight: showHighlightClip ? 600 : 400 }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: "#ff5d5d", marginRight: 4 }} />
              Highlights {clip.highlight}
            </span>
          </div>
          {rawOnly && request.sessionId && (
            <div data-mv-cr-workflow style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                Demosaic
                <Select aria-label="Demosaic" value={demosaic} onChange={changeDemosaic}
                  options={RAW_DEMOSAIC_OPTIONS} />
              </label>
              {!forceSmartObject && (
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}
                  title="Bit depth of the document Open makes. 32 bits is a float document on the Image ▸ Mode ▸ 32 Bits scale that keeps highlights above white; Open Object keeps them inside the Smart Object at any depth.">
                  Depth
                  <Select aria-label="Open Depth" value={String(rawDepth)}
                    onChange={(value) => store.setFilePrefs({ rawDepth: Number(value) as RawOpenDepth })}
                    options={RAW_DEPTH_OPTIONS} />
                </label>
              )}
              {decodeError && <span role="alert" data-mv-cr-decode-error style={{ fontSize: 12 }}>{decodeError}</span>}
            </div>
          )}
          <Histogram data={hist} accent={ACCENT} height={80} aria-label="Camera Raw histogram" />
          {filmstrip.length > 1 && (
            <div data-mv-cr-filmstrip style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {filmstrip.map((s) => (
                <Button key={s.sessionId} variant={s.sessionId === request.sessionId ? "primary" : "ghost"}
                  data-mv-cr-filmstrip-item title={s.name} onClick={() => switchTo(s.sessionId)}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: 4, maxWidth: 88 }}>
                  {thumbs[s.sessionId]
                    ? <img src={thumbs[s.sessionId]} alt="" style={{ maxWidth: 72, maxHeight: 72, width: "auto", height: "auto", borderRadius: 3, display: "block" }} />
                    : <div style={{ width: 72, height: 54, background: "var(--surface-3)", borderRadius: 3 }} />}
                  <span style={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{s.name}</span>
                </Button>
              ))}
              <Button variant="ghost" data-mv-cr-sync title="Copy these develop settings to every other image (keeps each image's crop, spots, masks, and Enhance)"
                onClick={syncSettings}>Sync Settings</Button>
            </div>
          )}
        </div>

        {/* Panel rail */}
        <div style={{ maxHeight: "68vh", overflowY: "auto", paddingRight: 4 }}>
          {editLimitError && <div role="alert" data-mv-cr-edit-limit
            style={{ position: "sticky", top: 0, zIndex: 1, marginBottom: 8, padding: 8, borderRadius: 4, background: "var(--surface-3)", color: "var(--text-1)" }}>
            {editLimitError}
          </div>}
          <Section title="Presets">
            {/* Apply a built-in or saved develop look, or save the current recipe
                as a new named preset (persisted to localStorage). */}
            <div style={{ marginBottom: 8 }}>
              <Select aria-label="Apply Preset" value="" block
                onChange={(name) => { const p = allPresets.find((x) => x.name === name); if (p) applyRecipe(applyWorkingPreset(normalizeWorkingRecipe(p.recipe), recipe)); }}
                options={[{ value: "", label: "Apply a preset…" }, ...allPresets.map((p) => ({ value: p.name, label: p.name }))]} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Input aria-label="Preset name" placeholder="Preset name" block value={presetName}
                data-mv-cr-preset-name onChange={(e) => setPresetName(e.target.value)} />
              <Button variant="ghost" data-mv-cr-save-preset onClick={savePreset}>Save</Button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Button variant="ghost" block disabled={sidecarBusy} data-mv-cr-import-preset
                onClick={() => { void importPreset(); }}>Import Preset…</Button>
              <Button variant="ghost" block disabled={sidecarBusy} data-mv-cr-export-preset
                onClick={() => { void exportPreset(); }}>Export Preset…</Button>
            </div>
            {rawOnly && sourceRef.current && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Button variant="ghost" block disabled={sidecarBusy} data-mv-cr-import-settings onClick={() => { void importSettings(); }}>Import XMP…</Button>
              <Button variant="ghost" block disabled={sidecarBusy} onClick={() => { void saveSettings(); }}>Export XMP…</Button>
            </div>}
          </Section>
          {rawOnly && sourceRef.current && <Section title="Snapshots">
            {/* Named recipe states saved with THIS raw file (persisted via its
                XMP), applied by click — Photoshop ACR's Snapshots panel. */}
            {snapshots.map((snap, index) => (
              <div key={`${snap.name}-${index}`} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                <Button variant="ghost" block data-mv-cr-snapshot={index}
                  title="Apply this snapshot" onClick={() => applyRecipe(normalizeWorkingRecipe(snap.recipe))}>{snap.name}</Button>
                <Button variant="ghost" aria-label={`Delete ${snap.name}`}
                  onClick={() => updateSnapshots(snapshots.filter((_, i) => i !== index))}>×</Button>
              </div>
            ))}
            <Button variant="ghost" block data-mv-cr-add-snapshot disabled={snapshots.length >= MAX_CAMERA_RAW_SNAPSHOTS}
              onClick={addSnapshot}>+ New Snapshot</Button>
          </Section>}
          <Section title="Profile & Calibration" defaultOpen={false}>
            <Select aria-label="Camera Profile" block value={profileMenuValue(profile)}
              onChange={(value) => {
                const selected = profileOptions.find((option) => option.value === value);
                if (selected) setProfile((current) => ({ ...selected.profile, amount: current.amount }));
              }}
              options={profileOptions.map(({ value, label }) => ({ value, label }))} />
            {rawOnly && (
              <Button variant="ghost" block data-mv-cr-load-profile style={{ marginTop: 6 }}
                title="Add a DNG camera profile (.dcp) to the Profile menu. It is offered for images from the camera it was made for."
                onClick={() => { void loadProfile(); }}>Load Profile…</Button>
            )}
            {(profileError || profileMissing) && (
              <div role="alert" data-mv-cr-profile-warning style={{ fontSize: 12, margin: "6px 0", color: "var(--warn, #ffbf47)" }}>
                {profileError ?? profileMissing}
              </div>
            )}
            {/* Camera Default (and a missing profile rendering as it) has no
                look for Amount to blend in, so the slider is off, as in ACR. */}
            <Row label="Amount" min={0} max={100} value={Math.round(profile.amount * 100)}
              disabled={profile.id === "camera-default" || !!profileMissing}
              onChange={(value) => setProfile((current) => ({ ...current, amount: value / 100 }))} suffix="%" />
            <Row label="Shadow Tint" min={-100} max={100} value={Math.round(calibration.shadowTint * 100)}
              onChange={(value) => setCalibration((current) => ({ ...current, shadowTint: value / 100 }))} />
            {(["red", "green", "blue"] as const).map((channel) => {
              const hueKey = `${channel}Hue` as const;
              const satKey = `${channel}Sat` as const;
              return <div key={channel}>
                <div className="monet-section-label" style={{ textTransform: "capitalize" }}>{channel} Primary</div>
                <Row label="Hue" min={-100} max={100} value={Math.round(calibration[hueKey] * 100)}
                  onChange={(value) => setCalibration((current) => ({ ...current, [hueKey]: value / 100 }))} />
                <Row label="Saturation" min={-100} max={100} value={Math.round(calibration[satKey] * 100)}
                  onChange={(value) => setCalibration((current) => ({ ...current, [satKey]: value / 100 }))} />
              </div>;
            })}
          </Section>
          <Section title="Basic">
            {/* White Balance: the ACR menu drives Temperature/Tint below, the
                eyedropper solves them from one clicked neutral, and dragging
                either slider relabels the menu Custom — exactly as ACR does. */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <Select aria-label="White Balance" block value={basic.wbMode}
                onChange={(mode) => setWbMode(mode as WhiteBalanceMode)}
                options={WB_MODE_OPTIONS} />
              {wbPreset && <span data-mv-cr-wb-readout className="monet-section-label" style={{ whiteSpace: "nowrap" }}>
                {wbPreset.kelvin} K · {wbPreset.tint > 0 ? "+" : ""}{wbPreset.tint}
              </span>}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <Button variant={canvasTool === "wb" ? "primary" : "ghost"} block data-mv-cr-wb-tool
                title="Click a neutral grey in the preview to set Temperature and Tint"
                onClick={() => setCanvasTool((tool) => (tool === "wb" ? "none" : "wb"))}>
                {canvasTool === "wb" ? "Click a neutral…" : "White Balance Tool"}
              </Button>
              <Button variant="ghost" block data-mv-cr-auto-wb onClick={autoWB}>Auto White Balance</Button>
              <Button variant="ghost" block data-mv-cr-auto-tone onClick={autoTone}>Auto Tone</Button>
            </div>
            <ParamRows rows={BASIC_ROWS} value={basic} onChange={(p) => setBasic((b) => ({
              ...b, ...p,
              ...("temp" in p || "tint" in p ? { wbMode: "custom" as const } : {}),
            }))} />
          </Section>
          <Section title="Tone Curve" defaultOpen={false}>
            <div className="monet-row" style={{ gap: 10, marginBottom: 8, alignItems: "center" }}>
              <Checkbox checked={curve.enabled} onChange={(v) => recompileCurve(curvePts, param, v)}>Enable</Checkbox>
              <div style={{ flex: 1 }}>
                <Select aria-label="Curve Channel" value={String(curveCh)} onChange={(v) => setCurveCh(+v)} block
                  options={[{ value: "0", label: "RGB" }, { value: "1", label: "Red" }, { value: "2", label: "Green" }, { value: "3", label: "Blue" }]} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 8px" }}>
              <CurveEditor points={curvePts[curveCh]} onChange={onCurvePts} width={256} height={256}
                accent={CURVE_CH_ACCENT[curveCh]} xRange={[0, 255]} yRange={[0, 255]} aria-label="Tone curve" />
            </div>
            <div data-mv-cr-curve-count style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 8 }}>
              {curvePts[curveCh].length}/{MAX_CAMERA_RAW_CURVE_POINTS_PER_CHANNEL} points
            </div>
            <div className="monet-section-label">Parametric</div>
            {PARAM_ROWS.map((r) => (
              <Row key={r.key} label={r.label} min={-100} max={100} value={param[r.key]}
                onChange={(v) => onParam({ [r.key]: v })} />
            ))}
          </Section>
          <Section title="Detail" defaultOpen={false}>
            <ParamRows rows={DETAIL_ROWS} value={detail} onChange={(p) => setDetail((d) => ({ ...d, ...p }))} />
          </Section>
          <Section title="Effects" defaultOpen={false}>
            <ParamRows rows={EFFECTS_ROWS} value={effects} onChange={(p) => setEffects((e) => ({ ...e, ...p }))} />
          </Section>
          <Section title="Optics" defaultOpen={false}>
            <LensProfileControls value={optics} metadata={store.lensMetadata(profileTarget)} onChange={(patch) => setOptics((current) => ({ ...current, ...patch }))} />
            <ParamRows rows={OPTICS_ROWS} value={optics} onChange={(p) => setOptics((o) => ({ ...o, ...p }))} />
            {DEFRINGE_HUES.map(({ key, label }) => (
              <div key={key} className="monet-row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
                <span className="lbl" style={{ width: 96 }}>{label}</span>
                <div style={{ flex: 1 }}>
                  <RangeSlider aria-label={label} accent={ACCENT} min={0} max={100} step={1} minGap={10}
                    value={{ min: optics[key][0], max: optics[key][1] }}
                    onChange={({ min, max }) => setOptics((o) => ({ ...o, [key]: [min, max] as [number, number] }))} />
                </div>
                <span className="val" style={{ width: 52, textAlign: "right", fontFamily: "var(--font-mono)" }}>
                  {optics[key][0]}–{optics[key][1]}
                </span>
              </div>
            ))}
          </Section>
          <Section title="HSL / Color" defaultOpen={false}>
            {/* One sub-channel (Hue/Saturation/Luminance) at a time × eight ACR hue
                bands. Recipe stores -1..1; sliders display the ±100 ACR range. */}
            <div style={{ marginBottom: 8 }}>
              <Select aria-label="HSL Channel" value={hslCh} onChange={(v) => setHslCh(v as HslChannel)} block
                options={[{ value: "hue", label: "Hue" }, { value: "saturation", label: "Saturation" }, { value: "luminance", label: "Luminance" }]} />
            </div>
            {HSL_BANDS.map((band, i) => (
              <Row key={band} label={band} min={-100} max={100} value={Math.round(hsl[hslCh][i] * 100)}
                onChange={(v) => setHsl((h) => ({ ...h, [hslCh]: h[hslCh].map((x, j) => (j === i ? v / 100 : x)) }))} />
            ))}
          </Section>
          <Section title="Color Grading" defaultOpen={false}>
            {/* Three tonal colour wheels rendered as Hue (0..360°) + Saturation
                (±0..100) pairs. Recipe stores hue in degrees, sat 0..1. */}
            {GRADE_REGIONS.map((region) => {
              const setWheel = (patch: Partial<GradeWheel>) =>
                setGrade((cg) => ({ ...cg, [region]: { ...cg[region], ...patch } }));
              return (
                <div key={region}>
                  <div className="monet-section-label" style={{ textTransform: "capitalize" }}>{region}</div>
                  <Row label="Hue" min={0} max={360} value={Math.round(grade[region].hue)}
                    onChange={(v) => setWheel({ hue: v })} />
                  <Row label="Saturation" min={0} max={100} value={Math.round(grade[region].sat * 100)}
                    onChange={(v) => setWheel({ sat: v / 100 })} />
                </div>
              );
            })}
          </Section>
          <Section title="Point Color" defaultOpen={false}>
            {/* Sample a colour from the preview, then nudge only that colour's
                Hue/Saturation/Luminance. Up to 8 sockets; Range widens the
                affected colours — a targeted alternative to the HSL band mixer. */}
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <Button variant={canvasTool === "point-color" ? "primary" : "ghost"} block data-mv-cr-point-color-tool
                onClick={() => {
                  if (canvasTool !== "point-color" && pointColorsRef.current.length >= MAX_CAMERA_RAW_POINT_COLORS) {
                    refuseEdit(`Camera Raw supports up to ${MAX_CAMERA_RAW_POINT_COLORS} point colours. Delete one before sampling another.`);
                    return;
                  }
                  setEditLimitError(null);
                  setCanvasTool((tool) => tool === "point-color" ? "none" : "point-color");
                }}>
                {canvasTool === "point-color" ? "Click the image to sample…" : "Sample a Colour"}
              </Button>
            </div>
            {pointColors.length === 0 && <div className="monet-section-label">No point colours yet — sample one from the image.</div>}
            {pointColors.map((pc, i) => {
              const setPc = (patch: Partial<WorkingPointColorSample>) =>
                setPointColors((current) => current.map((p) => (p.id === pc.id ? { ...p, ...patch } : p)));
              return (
                <div key={pc.id} data-mv-cr-point-color style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span aria-hidden style={{
                      width: 16, height: 16, borderRadius: 3, border: "1px solid rgba(255,255,255,0.2)",
                      background: `hsl(${pc.srcHue} ${Math.round(pc.srcSat * 100)}% ${Math.round(pc.srcLum * 100)}%)`,
                    }} />
                    <span className="monet-section-label" style={{ flex: 1 }}>Colour {i + 1}</span>
                    <Button variant="ghost" data-mv-cr-point-color-delete
                      onClick={() => setPointColors((current) => current.filter((p) => p.id !== pc.id))}>Delete</Button>
                  </div>
                  <Row label="Hue" min={-100} max={100} value={Math.round(pc.hue * 100)} onChange={(v) => setPc({ hue: v / 100 })} />
                  <Row label="Saturation" min={-100} max={100} value={Math.round(pc.sat * 100)} onChange={(v) => setPc({ sat: v / 100 })} />
                  <Row label="Luminance" min={-100} max={100} value={Math.round(pc.lum * 100)} onChange={(v) => setPc({ lum: v / 100 })} />
                  <Row label="Range" min={0} max={100} value={Math.round(pc.range * 100)} onChange={(v) => setPc({ range: v / 100 })} suffix="%" />
                </div>
              );
            })}
          </Section>
          {rawOnly && <Section title="Crop & Straighten" defaultOpen={false}>
            {/* V2 crop has no explicit `enabled`; it's derived from the rect/angle.
                Disabling resets to the full frame — enabling is driven by the sliders. */}
            <Checkbox checked={cropEnabledOf(crop)} onChange={(enabled) => { if (!enabled) setCrop((current) => ({ ...current, rect: { top: 0, left: 0, bottom: 1, right: 1 }, angle: 0 })); }}>Enable Crop</Checkbox>
            {/* Crop tool: drag the rect and its eight handles on the preview.
                The sliders below stay the precise way to dial the same rect. */}
            <Button variant={canvasTool === "crop" ? "primary" : "ghost"} block data-mv-cr-crop-tool
              title="Drag the crop rectangle and its handles on the preview"
              onClick={() => setCanvasTool((tool) => (tool === "crop" ? "none" : "crop"))}>
              {canvasTool === "crop" ? "Drag the crop on the preview…" : "Crop Tool"}
            </Button>
            <Row label="Left" min={0} max={95} value={Math.round(crop.rect.left * 100)}
              onChange={(value) => setCrop((current) => {
                const left = value / 100;
                const width = Math.min(current.rect.right - current.rect.left, 1 - left);
                return { ...current, rect: { ...current.rect, left, right: left + width } };
              })} suffix="%" />
            <Row label="Top" min={0} max={95} value={Math.round(crop.rect.top * 100)}
              onChange={(value) => setCrop((current) => {
                const top = value / 100;
                const height = Math.min(current.rect.bottom - current.rect.top, 1 - top);
                return { ...current, rect: { ...current.rect, top, bottom: top + height } };
              })} suffix="%" />
            <Row label="Width" min={5} max={100} value={Math.round((crop.rect.right - crop.rect.left) * 100)}
              onChange={(value) => setCrop((current) => {
                const width = Math.min(value / 100, 1 - current.rect.left);
                return { ...current, rect: { ...current.rect, right: current.rect.left + width } };
              })} suffix="%" />
            <Row label="Height" min={5} max={100} value={Math.round((crop.rect.bottom - crop.rect.top) * 100)}
              onChange={(value) => setCrop((current) => {
                const height = Math.min(value / 100, 1 - current.rect.top);
                return { ...current, rect: { ...current.rect, bottom: current.rect.top + height } };
              })} suffix="%" />
            <Row label="Angle" min={-45} max={45} value={crop.angle}
              onChange={(angle) => setCrop((current) => ({ ...current, angle }))} suffix="°" decimals={1} />
            {/* Aspect: ACR's preset menu over the free ratio below it, which is
                shown whenever a ratio is locked. Like the White Balance menu,
                Custom is a READOUT — dialling the number off every preset is what
                selects it. A locked ratio is held while dragging the crop rect. */}
            <Select aria-label="Crop Aspect" block value={cropAspectId(crop.constrainAspect)}
              onChange={(id) => setCrop((current) => {
                const preset = CROP_ASPECT_PRESETS.find((p) => p.id === id);
                return { ...current, constrainAspect: preset ? preset.ratio : (current.constrainAspect ?? 1.5) };
              })}
              options={[...CROP_ASPECT_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Custom" }]} />
            {crop.constrainAspect != null && <Row label="Aspect Ratio" min={0.25} max={4} value={crop.constrainAspect}
              onChange={(aspectRatio) => setCrop((current) => ({ ...current, constrainAspect: aspectRatio }))} decimals={2} />}
            <div style={{ display: "flex", gap: 12 }}>
              <Checkbox checked={crop.flipHorizontal ?? false} onChange={(flipHorizontal) => setCrop((current) => ({ ...current, flipHorizontal }))}>Flip H</Checkbox>
              <Checkbox checked={crop.flipVertical ?? false} onChange={(flipVertical) => setCrop((current) => ({ ...current, flipVertical }))}>Flip V</Checkbox>
            </div>
            {request.sessionId && <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10 }}>
              <Button variant="ghost" block data-mv-cr-generative-expand onClick={generativeExpandFromRaw}>Generative Expand…</Button>
              <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 4 }}>
                Opens this develop as a Smart Object, then outpaints the canvas with the local MI-GAN model.
              </div>
            </div>}
          </Section>}
          <Section title="Healing" defaultOpen={false}>
            <div style={{ marginBottom: 8 }}>
              <Checkbox checked={showSpots} onChange={setShowSpots}>Visualize Spots</Checkbox>
            </div>
            {showSpots && <Row label="Spot Threshold" min={0} max={100} value={Math.round(spotThreshold * 100)}
              onChange={(value) => setSpotThreshold(value / 100)} suffix="%" />}
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <Button variant={canvasTool === "heal" ? "primary" : "ghost"} block data-mv-cr-heal-tool
                onClick={() => {
                  if (canvasTool !== "heal" && healSpotsRef.current.length >= MAX_CAMERA_RAW_HEAL_SPOTS) {
                    refuseEdit(`Camera Raw supports up to ${MAX_CAMERA_RAW_HEAL_SPOTS} healing spots. Remove one before adding another.`);
                    return;
                  }
                  setEditLimitError(null);
                  setCanvasTool((tool) => tool === "heal" ? "none" : "heal");
                }}>Place Spot</Button>
              <Button variant="ghost" block data-mv-cr-detect-spots onClick={() => { setEditLimitError(null); detectSpots(); }}>Detect Spots</Button>
              <Button variant="ghost" block onClick={() => {
                setEditLimitError(null);
                setHealSpots([]);
              }}>Clear</Button>
            </div>
            <div data-mv-cr-heal-count style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 8 }}>
              {healSpots.length}/{MAX_CAMERA_RAW_HEAL_SPOTS} spots
            </div>
            <div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 8 }}>Choose Place Spot, then click the preview for one spot or drag across a blemish to heal the whole stroke. Refine each spot's target and source coordinates below.</div>
            {healSpots.map((spot, index) => <div key={spot.id} style={{ borderTop: "1px solid var(--stroke-2)", paddingTop: 8, marginTop: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1 }}>Spot {index + 1}</span>
                <Select aria-label={`Spot ${index + 1} mode`} value={spot.mode}
                  onChange={(mode) => setHealSpots((items) => items.map((item) => item.id === spot.id ? { ...item, mode: mode as WorkingHealSpot["mode"] } : item))}
                  options={[{ value: "heal", label: "Heal" }, { value: "clone", label: "Clone" }]} />
                <Button variant="ghost" onClick={() => {
                  setEditLimitError(null);
                  setHealSpots((items) => items.filter((item) => item.id !== spot.id));
                }}>Remove</Button>
              </div>
              <Row label="Target X" min={0} max={100} value={Math.round(spot.x * 100)}
                onChange={(value) => setHealSpots((items) => items.map((item) => item.id === spot.id ? { ...item, x: value / 100 } : item))} suffix="%" />
              <Row label="Target Y" min={0} max={100} value={Math.round(spot.y * 100)}
                onChange={(value) => setHealSpots((items) => items.map((item) => item.id === spot.id ? { ...item, y: value / 100 } : item))} suffix="%" />
              <Row label="Source X" min={0} max={100} value={Math.round(spot.sourceX * 100)}
                onChange={(value) => setHealSpots((items) => items.map((item) => item.id === spot.id ? { ...item, sourceX: value / 100 } : item))} suffix="%" />
              <Row label="Source Y" min={0} max={100} value={Math.round(spot.sourceY * 100)}
                onChange={(value) => setHealSpots((items) => items.map((item) => item.id === spot.id ? { ...item, sourceY: value / 100 } : item))} suffix="%" />
              <Row label="Radius" min={1} max={20} value={Math.round(spot.radius * 100)}
                onChange={(value) => setHealSpots((items) => items.map((item) => item.id === spot.id ? { ...item, radius: value / 100 } : item))} suffix="%" />
              <Row label="Feather" min={0} max={100} value={Math.round(spot.feather * 100)}
                onChange={(value) => setHealSpots((items) => items.map((item) => item.id === spot.id ? { ...item, feather: value / 100 } : item))} suffix="%" />
              <Row label="Opacity" min={0} max={100} value={Math.round(spot.opacity * 100)}
                onChange={(value) => setHealSpots((items) => items.map((item) => item.id === spot.id ? { ...item, opacity: value / 100 } : item))} suffix="%" />
            </div>)}
          </Section>
          <Section title="Masking" defaultOpen={false}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
              <Button variant="ghost" data-mv-cr-mask-brush onClick={() => addMask("brush")}>Brush</Button>
              <Button variant="ghost" onClick={() => addMask("linear-gradient")}>Linear</Button>
              <Button variant="ghost" onClick={() => addMask("radial-gradient")}>Radial</Button>
              <Button variant="ghost" data-mv-cr-mask-bidirectional onClick={() => addMask("bidirectional-gradient")}>Bidirectional</Button>
              <Button variant="ghost" onClick={() => void addSubjectMask()}>Subject</Button>
              <Button variant="ghost" onClick={() => addMask("sky")}>Sky</Button>
              <Button variant="ghost" onClick={() => addMask("luminance-range")}>Luminance</Button>
              <Button variant="ghost" onClick={() => addMask("color-range")}>Color Range</Button>
              <Button variant="ghost" onClick={() => {
                setEditLimitError(null);
                setMasks([]); setActiveMaskId(null); setCanvasTool("none");
              }}>Clear All</Button>
            </div>
            <div data-mv-cr-mask-count style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 8 }}>
              {masks.length}/{MAX_CAMERA_RAW_MASKS} masks · {totalMaskPoints}/{MAX_CAMERA_RAW_MASK_POINTS} points
            </div>
            {masks.length > 0 && <Select aria-label="Active Mask" block value={activeMaskId ?? ""} onChange={setActiveMaskId}
              options={masks.map((mask) => ({ value: mask.id ?? "", label: mask.name ?? "" }))} />}
            {activeMask && <>
              {GRADIENT_MASK_KINDS.has(activeMask.kind) && activeMask.points.slice(0, 2).map((pt, index) => {
                // The same two handles the preview drags, as numbers — precise
                // aiming, and the only way to place a gradient without a pointer.
                const label = activeMask.kind === "radial-gradient"
                  ? ["Center", "Edge"][index] : ["Start", "End"][index];
                return <div key={label}>
                  <Row label={`${label} X`} min={0} max={100} value={Math.round(pt.x * 100)}
                    onChange={(value) => moveMaskPoint(index, { x: value / 100 })} suffix="%" />
                  <Row label={`${label} Y`} min={0} max={100} value={Math.round(pt.y * 100)}
                    onChange={(value) => moveMaskPoint(index, { y: value / 100 })} suffix="%" />
                </div>;
              })}
              {GRADIENT_MASK_KINDS.has(activeMask.kind) && <Button block data-mv-cr-mask-handles
                variant={canvasTool === "mask-handles" ? "primary" : "ghost"}
                title="Drag this gradient's control points on the preview to aim it"
                onClick={() => setCanvasTool((tool) => (tool === "mask-handles" ? "none" : "mask-handles"))}>
                {canvasTool === "mask-handles" ? "Drag the handles on the preview…" : "Move Gradient Handles"}
              </Button>}
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <Checkbox checked={activeMask.enabled} onChange={(enabled) => updateActiveMask({ enabled })}>Enabled</Checkbox>
                <Checkbox checked={activeMask.inverted} onChange={(inverted) => updateActiveMask({ inverted })}>Invert</Checkbox>
              </div>
              <Row label="Mask Opacity" min={0} max={100} value={Math.round(activeMask.opacity * 100)}
                onChange={(value) => updateActiveMask({ opacity: value / 100 })} suffix="%" />
              <Row label="Feather" min={0} max={100} value={Math.round(activeMask.feather * 100)}
                onChange={(value) => updateActiveMask({ feather: value / 100 })} suffix="%" />
              {activeMask.kind === "luminance-range" && <>
                <Row label="Range Min" min={0} max={100} value={Math.round((activeMask.range?.[0] ?? 0) * 100)}
                  onChange={(value) => updateActiveMask({ range: [value / 100, Math.max(value / 100, activeMask.range?.[1] ?? 1)] })} suffix="%" />
                <Row label="Range Max" min={0} max={100} value={Math.round((activeMask.range?.[1] ?? 1) * 100)}
                  onChange={(value) => updateActiveMask({ range: [Math.min(activeMask.range?.[0] ?? 0, value / 100), value / 100] })} suffix="%" />
              </>}
              {activeMask.kind === "color-range" && <div style={{ margin: "8px 0" }}>
                <Button variant={canvasTool === "color-sample" ? "primary" : "ghost"} block data-mv-cr-color-sample
                  onClick={() => {
                    if (canvasTool !== "color-sample" && (activeMask.colorSamples?.length ?? 0) >= MAX_CAMERA_RAW_MASK_COLORS) {
                      refuseEdit(`Camera Raw supports up to ${MAX_CAMERA_RAW_MASK_COLORS} color samples per mask. Clear samples before adding another.`);
                      return;
                    }
                    setEditLimitError(null);
                    setCanvasTool((tool) => tool === "color-sample" ? "none" : "color-sample");
                  }}>Sample Color in Preview</Button>
                <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 6 }}>
                  {(activeMask.colorSamples ?? []).length} color sample{(activeMask.colorSamples ?? []).length === 1 ? "" : "s"}
                </div>
                {(activeMask.colorSamples ?? []).length > 0 && <Button variant="ghost" block
                  onClick={() => { setEditLimitError(null); updateActiveMask({ colorSamples: [] }); }}>Clear Color Samples</Button>}
              </div>}
              <ParamRows rows={LOCAL_MASK_ROWS} value={activeMask.adjustments}
                onChange={(patch) => updateActiveMask({ adjustments: { ...activeMask.adjustments, ...patch } })} />
              <Button variant="ghost" block onClick={() => {
                setEditLimitError(null);
                setMasks((items) => items.filter((item) => item.id !== activeMask.id));
                setActiveMaskId(null);
                setCanvasTool("none");
              }}>Delete Mask</Button>
            </>}
          </Section>
          {rawOnly && <Section title="Enhance" defaultOpen={false}>
            <Checkbox checked={enhance.denoise} onChange={(denoise) => setEnhance((current) => ({ ...current, denoise }))}>Denoise</Checkbox>
            <Row label="Denoise" min={0} max={100} value={Math.round(enhance.denoiseAmount * 100)}
              onChange={(value) => setEnhance((current) => ({ ...current, denoiseAmount: value / 100, denoise: value > 0 }))} suffix="%" />
            <Checkbox checked={enhance.rawDetails} onChange={(rawDetails) => setEnhance((current) => ({ ...current, rawDetails }))}>Raw Details</Checkbox>
            {request.sessionId
              ? <>
                <Checkbox
                  checked={enhance.superResolution}
                  disabled={!canSuperResolution && !enhance.superResolution}
                  onChange={(superResolution) => setEnhance((current) => ({ ...current, superResolution }))}
                >Super Resolution (2×)</Checkbox>
                {!canSuperResolution && !enhance.superResolution
                  && <div style={{ color: "var(--text-3)", fontSize: 11 }}>Unavailable at this document size.</div>}
              </>
              : enhance.superResolution && <div style={{ color: "var(--text-2)", fontSize: 12 }}>Super Resolution (2×) was applied when this Smart Object was opened.</div>}
            <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 8 }}>Super Resolution is chosen before opening and creates the document at twice its decoded dimensions; the original RAW remains embedded and unchanged.</div>
          </Section>}
          <Section title="Geometry" defaultOpen={false}>
            {/* Parametric keystone + straighten, baked into the recipe (the manual
                Perspective Warp tool is destructive; this is non-destructive).
                Upright solves Vertical/Horizontal/Rotate from the image, or from
                guides drawn on the preview. */}
            <div style={{ marginBottom: 8 }}>
              <SegmentedControl aria-label="Upright" accent={ACCENT} block value={geometry.upright}
                items={UPRIGHT_MODES.map((mode) => ({ value: mode.key, label: mode.label }))}
                onChange={(mode) => applyUpright(mode as UprightMode)} />
            </div>
            <div role="status" data-mv-cr-upright-status
              style={{ color: "var(--text-2)", fontSize: 12, marginBottom: uprightStatus ? 8 : 0 }}>
              {uprightStatus}
            </div>
            {geometry.upright === "guided" && <Button variant={canvasTool === "upright-guides" ? "primary" : "ghost"} block
              data-mv-cr-upright-guides title="Drag along lines in the preview that should be vertical or horizontal (up to four)"
              onClick={() => setCanvasTool((tool) => (tool === "upright-guides" ? "none" : "upright-guides"))}>
              {canvasTool === "upright-guides" ? "Done Drawing Guides" : "Draw Guides"}
            </Button>}
            <ParamRows rows={GEOMETRY_ROWS} value={geometry} onChange={(p) => setGeometry((geo) => ({ ...geo, ...p }))} />
          </Section>
        </div>
      </div>
    </Dialog>
  );
}
