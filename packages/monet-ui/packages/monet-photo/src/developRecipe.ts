// developRecipe — DevelopRecipeV2, the canonical, versioned, named source of
// truth for a non-destructive edit. Structured JSON stored in the catalog
// (galerie) / project (vision); float buffers and LUTs are *derived* render
// caches, never canonical. Shared by the Monet photo apps via
// @monet-ui/monet-photo.
//
// This module is the schema + defaults + normalization only — no rendering.
// Panels are grounded in Lightroom Classic's Develop module. Framework-free,
// app-neutral.

import type { LensCalibration } from "./lensProfiles";
import { normalizeLensSettings } from "./lensCorrection";

import {
  createLocalAdjustments,
  createMaskGraph,
  type BrushDab,
  type LocalAdjustments,
  type Mask,
  type MaskComponent,
  type MaskComponentKind,
  type MaskGraph,
} from "./maskGraph";

/** The recipe schema version. A plain discriminator for the CURRENT shape:
 *  `normalizeRecipe` rejects a recipe that declares anything else. */
export const CURRENT_RECIPE_VERSION = 2 as const;

/** The Monet renderer process revision. Only revision 6 is executable. */
export const CURRENT_PROCESS_VERSION = 6;

export type RawDecodeIntent =
  | { mode: "asShot" }
  | { mode: "neutralChromaticity"; x: number; y: number; derivationDigest: string };

/** Lightroom's White Balance menu. `asShot` is the decoder's own neutral,
 *  `custom` is what a hand-edited Temp/Tint becomes; the rest are the lighting
 *  presets in `WB_PRESETS`. `auto` is schema-only for now — deriving it needs
 *  the image, which this framework-free module never sees. */
export type WhiteBalanceMode =
  | "asShot"
  | "auto"
  | "custom"
  | "daylight"
  | "cloudy"
  | "shade"
  | "tungsten"
  | "fluorescent"
  | "flash";

/** The lighting presets, in Lightroom's menu order, carrying the Kelvin/tint
 *  the Adobe app displays for each. */
export const WB_PRESETS = [
  { mode: "daylight", label: "Daylight", kelvin: 5500, tint: 10 },
  { mode: "cloudy", label: "Cloudy", kelvin: 6500, tint: 10 },
  { mode: "shade", label: "Shade", kelvin: 7500, tint: 10 },
  { mode: "tungsten", label: "Tungsten", kelvin: 2850, tint: 0 },
  { mode: "fluorescent", label: "Fluorescent", kelvin: 3800, tint: 21 },
  { mode: "flash", label: "Flash", kelvin: 5500, tint: 0 },
] as const satisfies readonly { mode: WhiteBalanceMode; label: string; kelvin: number; tint: number }[];

export type WhiteBalancePreset = (typeof WB_PRESETS)[number]["mode"];

/** Every value `wbMode` may hold — the trust-boundary whitelist for a stored
 *  recipe (`sanitizeRecipe`) as well as the UI menu's domain. */
const WB_MODES = new Set<string>(["asShot", "auto", "custom", ...WB_PRESETS.map((p) => p.mode)]);

// ponytail: recipe `temp`/`tint` are RELATIVE offsets (engine ABI p[2]/p[3];
// ±1 ≈ ±30% R/B gain), not absolute Kelvin, so a preset is resolved against an
// assumed daylight as-shot base and converted in mireds — the unit in which
// equal steps are equal colour shifts. Ceiling: on a frame shot under tungsten
// the offset is only approximately Adobe's. Upgrade path: the native decoder
// already returns the frame's own `neutralTemperature`/`neutralTint`
// (galerie rawDecode.ts) — feed those in as the base and this becomes exact.
const WB_REFERENCE = { kelvin: 5500, tint: 10 };
/** Mireds spanned by one full unit of `temp`. */
const WB_MIRED_SPAN = 200;

const mired = (kelvin: number): number => 1e6 / kelvin;

/** The relative Temp/Tint a preset writes into the recipe. */
export function whiteBalancePresetOffsets(preset: WhiteBalancePreset): { temp: number; tint: number } {
  const p = WB_PRESETS.find((x) => x.mode === preset)!;
  return {
    temp: Math.max(-1, Math.min(1, (mired(WB_REFERENCE.kelvin) - mired(p.kelvin)) / WB_MIRED_SPAN)),
    tint: (p.tint - WB_REFERENCE.tint) / 100,
  };
}

/** Apply a White Balance menu choice to a Basic panel. `asShot`/`auto` return to
 *  the decoder's neutral (zero offset); `custom` only relabels — the Temp/Tint
 *  the user just dragged are the setting. */
export function applyWhiteBalance(basic: BasicPanel, mode: WhiteBalanceMode): BasicPanel {
  if (mode === "custom") return { ...basic, wbMode: "custom" };
  if (mode === "asShot" || mode === "auto") return { ...basic, wbMode: mode, temp: 0, tint: 0 };
  return { ...basic, wbMode: mode, ...whiteBalancePresetOffsets(mode) };
}

/** Basic panel: WB + Tone + Presence. Neutral = 0 (temp/tint offsets). */
export interface BasicPanel {
  wbMode: WhiteBalanceMode;
  temp: number;
  tint: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture: number;
  clarity: number;
  dehaze: number;
  vibrance: number;
  saturation: number;
}

/** A tone-curve control point; x (input) and y (output) normalized 0..1. */
export interface CurvePoint {
  x: number;
  y: number;
}

/** Tone Curve: parametric regions + editable point curves (master + per-channel)
 *  + TAT state. Points are canonical; the compiled LUT is a derived cache. */
export interface ToneCurvePanel {
  parametric: { highlights: number; lights: number; darks: number; shadows: number };
  /** Parametric region split points (shadow/mid/highlight), 0..1. */
  parametricSplits: [number, number, number];
  point: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
  /** Target-adjustment tool active. */
  targetAdjust: boolean;
  /** Optional Vision-only DECOUPLED compiled render LUTs (master/r/g/b, each 256
   *  entries 0..255). Vision stores the render LUTs independently of the authoring
   *  points; when present, developParams writes these four bands into the render
   *  prefix [CURVE_BASE..] VERBATIM instead of compiling `point`/`red`/…. Absent on
   *  Galerie recipes and createDefaultRecipe (which compile points→LUT). PREFIX
   *  ONLY — it is NOT part of the advanced-tail gate, so a recipe with compiledLuts
   *  + default points still serializes to exactly 1086 floats. */
  compiledLuts?: { master: number[]; r: number[]; g: number[]; b: number[] };
}

/** Color Mixer: HSL / Color / B&W. 8 bands each (r,o,y,g,aqua,blue,purple,mag). */
export interface ColorMixerPanel {
  mode: "hsl" | "color" | "bw";
  hue: number[];
  saturation: number[];
  luminance: number[];
  /** B&W gray mix (8 bands). */
  gray: number[];
  targetAdjust: boolean;
}

/** One Point Color correction (newer LR): source color → HSL shift + range. */
export interface PointColorSample {
  srcHue: number;
  srcSat: number;
  srcLum: number;
  hue: number;
  sat: number;
  lum: number;
  /** Hue/sat/lum selection range (falloff), 0..1. */
  range: number;
}

export interface PointColorPanel {
  samples: PointColorSample[];
}

/** One Heal/Clone spot. All coordinates and the radius are normalized to the
 *  un-cropped source frame (radius against min(width, height)); the engine
 *  remaps them through the active crop at render time. */
export interface HealSpot {
  /** "heal" tone-matches the sampled patch to the target; "clone" copies it. */
  mode: "heal" | "clone";
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
  /** 0..1 against min(width, height). */
  radius: number;
  /** Fraction of the radius that fades out, 0..1. */
  feather: number;
  /** 0..1. */
  opacity: number;
}

export interface HealPanel {
  spots: HealSpot[];
}

/** The engine renders at most this many heal spots per recipe. */
export const MAX_HEAL_SPOTS = 64;

/** Resample a free-form Remove-brush stroke into a chain of overlapping heal
 *  stamps (LR's brush-drag remove; REM-04). `points` are normalized un-cropped
 *  coords, `aspect` = width/height so spacing is measured in the engine's
 *  min-dimension radius units. Every stamp shares ONE source offset,
 *  perpendicular to the overall stroke direction and biased toward the frame
 *  centre, so the sampled texture is a coherent translated copy of the path
 *  that never re-samples the blemish line itself. A near-zero-length stroke
 *  degrades to the classic single click spot.
 *  ponytail: chained discs on the frozen 8-float heal ABI, not a free-form
 *  region mask — a per-spot polyline tail (new advanced-tail version +
 *  recipe.rs field) is the upgrade path if disc chains ever band visibly. */
export function healStrokeSpots(
  points: readonly { x: number; y: number }[],
  radius: number,
  aspect: number,
): HealSpot[] {
  if (points.length === 0) return [];
  const r = Math.min(1, Math.max(0.001, clampNum(radius, 0, 1, 0.025)));
  const asp = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  // Per-axis scale from normalized 0..1 deltas into min-dimension units.
  const ax = asp >= 1 ? asp : 1;
  const ay = asp >= 1 ? 1 : 1 / asp;
  // Stamp spacing: midpoints between stamps stay inside the default feather
  // knee (inner = 0.5·r), so the chain reads as one solid stroke.
  const spacing = r * 0.75;

  // Resample by arc length: the start point, then one stamp every `spacing`.
  const centres: { x: number; y: number }[] = [{ x: points[0].x, y: points[0].y }];
  let since = 0;
  let prev = points[0];
  for (let i = 1; i < points.length && centres.length < MAX_HEAL_SPOTS; i++) {
    const cur = points[i];
    let dx = (cur.x - prev.x) * ax;
    let dy = (cur.y - prev.y) * ay;
    let len = Math.hypot(dx, dy);
    while (since + len >= spacing && centres.length < MAX_HEAL_SPOTS) {
      const t = (spacing - since) / len;
      prev = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      centres.push(prev);
      dx = (cur.x - prev.x) * ax;
      dy = (cur.y - prev.y) * ay;
      len = Math.hypot(dx, dy);
      since = 0;
    }
    since += len;
    prev = cur;
  }
  // Cover the stroke tail when the last stamp fell well short of the end.
  if (since > spacing * 0.5 && centres.length < MAX_HEAL_SPOTS) centres.push(prev);

  // Shared source offset. Perpendicular to the overall direction; a click
  // (no direction) falls back to placeHealSpot's horizontal rule.
  const first = centres[0];
  const last = centres[centres.length - 1];
  const dirX = (last.x - first.x) * ax;
  const dirY = (last.y - first.y) * ay;
  const dirLen = Math.hypot(dirX, dirY);
  let nx = 1;
  let ny = 0;
  if (dirLen > 1e-6) {
    nx = -dirY / dirLen;
    ny = dirX / dirLen;
  }
  const off = Math.max(r * 3, 0.06);
  let sdx = (nx * off) / ax; // back to normalized per-axis deltas
  let sdy = (ny * off) / ay;
  // Of the two perpendiculars, take the one whose sources sit nearer the frame
  // centre — likelier in-bounds and in same-context pixels.
  const mid = centres[Math.floor(centres.length / 2)];
  if (
    (mid.x + sdx - 0.5) ** 2 + (mid.y + sdy - 0.5) ** 2 >
    (mid.x - sdx - 0.5) ** 2 + (mid.y - sdy - 0.5) ** 2
  ) {
    sdx = -sdx;
    sdy = -sdy;
  }
  return centres.map((c) => ({
    mode: "heal" as const,
    x: clampNum(c.x, 0, 1, 0.5),
    y: clampNum(c.y, 0, 1, 0.5),
    sourceX: clampNum(c.x + sdx, 0, 1, 0.5),
    sourceY: clampNum(c.y + sdy, 0, 1, 0.5),
    radius: r,
    feather: 0.5,
    opacity: 1,
  }));
}

// ── Engine-mask taxonomy (imported verbatim from Vision's Camera Raw codec:
// apps/vision/src/state/cameraRaw.ts). These records carry Vision's local masks
// through the {tailFormat:"visionV2"} serialization ONLY. Galerie's default
// (auto) tail never emits them — mask_count stays 0 — and createDefaultRecipe
// leaves `engineMasks` undefined, so Galerie recipes and the native recipe.rs
// parser (which only ever sees the default tail) are unaffected. ──

/** Engine caps, mirrored from Vision (MAX_CAMERA_RAW_MASKS/…MASK_POINTS/…MASK_COLORS). */
export const MAX_ENGINE_MASKS = 32;
export const MAX_ENGINE_MASK_POINTS = 4096;
export const MAX_ENGINE_MASK_COLORS = 64;

/** Trust-boundary collection caps for normalizeRecipe, mirrored from Vision's
 *  Camera-Raw codec (MAX_CAMERA_RAW_CURVE_POINTS_PER_CHANNEL / …POINT_COLORS). */
export const MAX_CURVE_POINTS_PER_CHANNEL = 128;
export const MAX_POINT_COLOR_SAMPLES = 8;

/** Trust-boundary caps for the (Galerie-shape) MaskGraph. The XMP parser bounds
 *  what IT reads, but a graph also arrives as raw JSON through MCP patches,
 *  presets and the catalog, so `sanitizeRecipe` applies the SAME bounds (#114);
 *  xmp.ts imports these so the two lanes cannot drift apart. */
export const MAX_GRAPH_MASKS = 32;
export const MAX_MASK_COMPONENTS = 32;
export const MAX_MASK_DABS = 4096;
/** Sampled colors seeding one `rangeColor` component. */
export const MAX_MASK_COLOR_SAMPLES = 64;

export type EngineMaskKind =
  | "brush" | "linear-gradient" | "radial-gradient" | "bidirectional-gradient"
  | "luminance-range" | "color-range" | "subject" | "sky" | "outline";
export interface EngineMaskPoint { x: number; y: number; pressure: number }
/** The 16 local-adjustment sliders, in Vision's serialized order. */
export interface EngineMaskAdjustments {
  temp: number; tint: number; exposure: number; contrast: number;
  highlights: number; shadows: number; whites: number; blacks: number;
  texture: number; clarity: number; dehaze: number; saturation: number;
  sharpness: number; noiseReduction: number; moire: number; defringe: number;
}
/** One engine local mask (Vision CameraRawLocalMask minus the non-serialized
 *  id/name). Field-for-field the record Vision's appendAdvancedParams writes. */
export interface EngineMask {
  kind: EngineMaskKind;
  enabled: boolean;
  inverted: boolean;
  opacity: number;
  feather: number;
  /** Brush path / gradient control points, normalized to the source. */
  points: EngineMaskPoint[];
  /** Optional normalized min/max range for luminance masks. */
  range?: [number, number];
  /** Optional sRGB samples for color-range masks. */
  colorSamples?: [number, number, number][];
  adjustments: EngineMaskAdjustments;
}

/** Vision-only Enhance (Denoise / Raw Details / Super Resolution). Serialized
 *  ONLY by the visionV2 tail ([1107..1110]); absent on Galerie recipes and
 *  createDefaultRecipe, so the default tail is byte-unchanged and recipe.rs never
 *  sees it. Mirrors Vision's CameraRawEnhance. */
export interface EnginePhotoEnhance {
  denoise: boolean;
  denoiseAmount: number;
  rawDetails: boolean;
  superResolution: boolean;
}

export interface GradeWheel {
  hue: number;
  sat: number;
  lum: number;
}

/** Color Grading: three-way wheels + global, with blending/balance. */
export interface ColorGradingPanel {
  shadows: GradeWheel;
  midtones: GradeWheel;
  highlights: GradeWheel;
  global: GradeWheel;
  blending: number;
  balance: number;
}

/** Detail: Sharpening + Noise Reduction (luminance + color). */
export interface DetailPanel {
  sharpenAmount: number;
  sharpenRadius: number;
  sharpenDetail: number;
  sharpenMasking: number;
  nrLuminance: number;
  nrLuminanceDetail: number;
  nrLuminanceContrast: number;
  nrColor: number;
  nrColorDetail: number;
  nrColorSmoothness: number;
}

/** Lens Corrections (manual now; profile DB is Phase 6). */
export interface OpticsPanel {
  /** Chromatic-aberration removal, continuous 0..1 (the engine treats p[1051]
   *  continuously). Galerie's UI toggle maps to 0/1; Vision writes it verbatim.
   *  Recipes serialized before this field carried a boolean
   *  `removeChromaticAberration` instead — normalizeRecipe migrates it here. */
  aberration: number;
  enableProfileCorrections: boolean;
  profileName: string | null;
  profileId?: string;
  profileDistortionAmount?: number;
  profileVignettingAmount?: number;
  profileFocalLengthMm?: number;
  profileAperture?: number;
  profileCropFactor?: number;
  profileCalibration?: LensCalibration;
  distortionAmount: number;
  vignettingAmount: number;
  defringePurpleAmount: number;
  defringePurpleHue: [number, number];
  defringeGreenAmount: number;
  defringeGreenHue: [number, number];
}

export type UprightMode = "off" | "auto" | "level" | "vertical" | "full" | "guided";

/** Transform / Upright / geometry. */
export interface TransformPanel {
  upright: UprightMode;
  vertical: number;
  horizontal: number;
  rotate: number;
  scale: number;
  xOffset: number;
  yOffset: number;
  aspect: number;
  /** LR's Constrain Crop: auto-crop the transparent borders the geometry warp
   *  exposes (engine-side, v4 advanced tail). OPTIONAL like crop.flipHorizontal:
   *  createDefaultRecipe omits it, so recipes that never toggled it keep their
   *  canonical bytes/digest unchanged. */
  constrainCrop?: boolean;
}

/** Effects: post-crop vignette + grain. */
export interface EffectsPanel {
  vignetteAmount: number;
  vignetteMidpoint: number;
  vignetteRoundness: number;
  vignetteFeather: number;
  vignetteHighlights: number;
  grainAmount: number;
  grainSize: number;
  grainRoughness: number;
}

/** Camera Calibration (also carries process-version-specific primaries). */
export interface CalibrationPanel {
  shadowTint: number;
  redHue: number;
  redSat: number;
  greenHue: number;
  greenSat: number;
  blueHue: number;
  blueSat: number;
}

/** Crop rectangle, normalized 0..1 of the source (pre-orientation). */
export interface CropRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface CropPanel {
  rect: CropRect;
  /** Straighten angle, degrees. */
  angle: number;
  /** EXIF orientation 1..8. */
  orientation: number;
  /** Locked aspect ratio (w/h), or null for free. */
  constrainAspect: number | null;
  /** Vision-only crop flips, serialized ONLY by the visionV2 tail ([1105]/[1106]).
   *  Absent on Galerie recipes; createDefaultRecipe omits them (default tail
   *  unchanged, recipe.rs never sees them). */
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

/** Profile browser selection (camera/DCP/creative). */
export interface ProfilePanel {
  /** Stable profile identity — drives the engine profile code (see developParams
   *  PROFILE_CODES → p[1088]); display names are not identity. Mirrors Vision's
   *  ids: camera-default(0)/adobe-color(1)/camera-neutral(2)/monochrome(3), plus
   *  embedded(4) — a DNG's own profile — and custom(5) — a DNG camera profile
   *  (.dcp) the user loaded. The default "camera-default" maps to engine code 0,
   *  so a neutral recipe stays byte-identical (no advanced tail). Old recipes
   *  without `id` backfill to it via normalizeRecipe's mergePanel, preserving
   *  their code-0 rendering. */
  id: string;
  /** For embedded/custom, the profile's own name (DNG ProfileName). */
  name: string;
  group: string;
  /** Creative-profile amount, 0..2 (1 = full). */
  amount: number;
  /** Which DNG camera profile an embedded/custom id renders through: the
   *  engine's 32-hex-digit fingerprint of its tables (ACR's
   *  CameraProfileDigest). Absent for the built-in looks. */
  digest?: string;
  /** The image's as-shot white balance in kelvin, which such a profile's two
   *  calibration illuminants are interpolated at (moved by Basic ▸ Temp).
   *  The app fills it from the RAW before a develop; absent = 5500 K. */
  asShotKelvin?: number;
  /** Original RAW decoder basis, not the selected DCP's matrix. */
  sourceCamera?: ProfileSourceCamera;
}

export interface ProfileSourceCamera {
  /** Row-major 3×3 transform applied to white-balanced camera samples. */
  cameraToXyz: number[];
  whiteBalance: number[];
}

/** Bound and validate the invertible, three-channel RAW basis before it is
 * persisted or passed to the engine. Four-channel cameras need a separate path. */
export function normalizeProfileSource(value: unknown): ProfileSourceCamera | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { cameraToXyz: m, whiteBalance: wb } = value as Partial<ProfileSourceCamera>;
  if (!Array.isArray(m) || m.length !== 9 || !m.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1000)
    || !Array.isArray(wb) || wb.length !== 3 || !wb.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1_000_000)) return undefined;
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  return Math.abs(det) > 1e-12 ? { cameraToXyz: [...m], whiteBalance: [...wb] } : undefined;
}

/** A ProfilePanel.digest's shape; anything else is dropped at the trust
 *  boundary. */
export const PROFILE_DIGEST_RE = /^[0-9A-F]{32}$/;

/** Per-panel enable (LR panel on/off switches). */
export interface PanelEnable {
  basic: boolean;
  toneCurve: boolean;
  colorMixer: boolean;
  pointColor: boolean;
  colorGrading: boolean;
  detail: boolean;
  optics: boolean;
  transform: boolean;
  effects: boolean;
  calibration: boolean;
}

/** Provenance for reproducibility + cache invalidation. */
export interface RecipeMetadata {
  /** App+version that authored the recipe. */
  createdWith: string;
  /** AI model → version, for masks/enhance derived from this recipe. */
  modelVersions: Record<string, string>;
}

/** Derived render facts stored with previews/exports, never in editable intent. */
export interface RenderProvenance {
  engineFingerprint: string;
  decoderBackend: string;
  decoderVersion: string;
  decodeIntentDigest: string;
  sourceOrientation: number;
  workingProfileDigest: string;
}

/** The canonical develop recipe. */
export interface DevelopRecipeV2 {
  version: typeof CURRENT_RECIPE_VERSION;
  /** Monet renderer process revision. Only revision 6 is executable — the
   *  current-value gate lives in `normalizeRecipe`.
   *  ponytail: stays a plain `number` (not the literal 6) so Galerie's PV badge
   *  keeps compiling. */
  processVersion: number;
  rawDecode: RawDecodeIntent;
  profile: ProfilePanel;
  crop: CropPanel;
  basic: BasicPanel;
  toneCurve: ToneCurvePanel;
  colorMixer: ColorMixerPanel;
  pointColor: PointColorPanel;
  colorGrading: ColorGradingPanel;
  detail: DetailPanel;
  optics: OpticsPanel;
  transform: TransformPanel;
  effects: EffectsPanel;
  calibration: CalibrationPanel;
  /** HDR edit intent (LR HDR mode). */
  hdr: { enabled: boolean };
  heal: HealPanel;
  enabled: PanelEnable;
  masks: MaskGraph;
  /** Optional Vision engine-mask records, serialized ONLY by the visionV2 tail
   *  (developParams.recipeToParams with {tailFormat:"visionV2"}). Absent on
   *  Galerie recipes and createDefaultRecipe, so the default tail's mask_count
   *  stays 0 and nothing about the Galerie/native path changes. */
  engineMasks?: EngineMask[];
  /** Optional Vision Enhance record, serialized ONLY by the visionV2 tail
   *  ([1107..1110]). Absent on Galerie recipes and createDefaultRecipe, so the
   *  default tail and the native recipe.rs parser are unaffected. */
  enhance?: EnginePhotoEnhance;
  metadata: RecipeMetadata;
}

const identityCurve = (): CurvePoint[] => [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
const band8 = (): number[] => [0, 0, 0, 0, 0, 0, 0, 0];

/** A neutral recipe: every panel at its no-op default. */
export function createDefaultRecipe(): DevelopRecipeV2 {
  return {
    version: CURRENT_RECIPE_VERSION,
    processVersion: CURRENT_PROCESS_VERSION,
    rawDecode: { mode: "asShot" },
    profile: { id: "camera-default", name: "Camera Default", group: "Camera Matching", amount: 1 },
    crop: {
      rect: { top: 0, left: 0, bottom: 1, right: 1 },
      angle: 0,
      orientation: 1,
      constrainAspect: null,
    },
    basic: {
      wbMode: "asShot",
      temp: 0,
      tint: 0,
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      texture: 0,
      clarity: 0,
      dehaze: 0,
      vibrance: 0,
      saturation: 0,
    },
    toneCurve: {
      parametric: { highlights: 0, lights: 0, darks: 0, shadows: 0 },
      parametricSplits: [0.25, 0.5, 0.75],
      point: identityCurve(),
      red: identityCurve(),
      green: identityCurve(),
      blue: identityCurve(),
      targetAdjust: false,
    },
    colorMixer: {
      mode: "hsl",
      hue: band8(),
      saturation: band8(),
      luminance: band8(),
      gray: band8(),
      targetAdjust: false,
    },
    pointColor: { samples: [] },
    colorGrading: {
      shadows: { hue: 0, sat: 0, lum: 0 },
      midtones: { hue: 0, sat: 0, lum: 0 },
      highlights: { hue: 0, sat: 0, lum: 0 },
      global: { hue: 0, sat: 0, lum: 0 },
      blending: 50,
      balance: 0,
    },
    // NOTE: fields the develop ABI reads (recipeToParams) must be neutral in the
    // *engine* domain, not the LR UI-integer domain — sharpenRadius 1.0, all
    // amounts 0 (matches Vision's known-good neutral recipe). The UI defaults
    // (LR's 25/50 for Detail/Sharpen sub-params) belong on the sliders, not the
    // stored recipe. sharpenDetail/nrColor* below are not in the v1 ABI yet, so
    // their value is display-only until a Detail panel + wider ABI lands.
    detail: {
      sharpenAmount: 0,
      sharpenRadius: 1,
      sharpenDetail: 25,
      sharpenMasking: 0,
      nrLuminance: 0,
      nrLuminanceDetail: 0,
      nrLuminanceContrast: 0,
      nrColor: 0,
      nrColorDetail: 50,
      nrColorSmoothness: 50,
    },
    optics: {
      aberration: 0,
      enableProfileCorrections: false,
      profileName: null,
      distortionAmount: 0,
      vignettingAmount: 0,
      defringePurpleAmount: 0,
      defringePurpleHue: [30, 70],
      defringeGreenAmount: 0,
      defringeGreenHue: [40, 60],
    },
    transform: {
      upright: "off",
      vertical: 0,
      horizontal: 0,
      rotate: 0,
      scale: 1,
      xOffset: 0,
      yOffset: 0,
      aspect: 0,
    },
    // vignetteMidpoint is engine-domain (0..1, Vision-neutral 0.5); grain size/
    // roughness are ABI-written so default to the engine-neutral 0 (grain is off
    // at amount 0 regardless). vignetteRoundness/Feather/Highlights aren't in the
    // v1 ABI, so they keep LR-ish UI defaults for a future Effects panel.
    effects: {
      vignetteAmount: 0,
      vignetteMidpoint: 0.5,
      vignetteRoundness: 0,
      vignetteFeather: 50,
      vignetteHighlights: 0,
      grainAmount: 0,
      grainSize: 0,
      grainRoughness: 0,
    },
    calibration: {
      shadowTint: 0,
      redHue: 0,
      redSat: 0,
      greenHue: 0,
      greenSat: 0,
      blueHue: 0,
      blueSat: 0,
    },
    hdr: { enabled: false },
    heal: { spots: [] },
    enabled: {
      basic: true,
      toneCurve: true,
      colorMixer: true,
      pointColor: true,
      colorGrading: true,
      detail: true,
      optics: true,
      transform: true,
      effects: true,
      calibration: true,
    },
    masks: createMaskGraph(),
    metadata: {
      createdWith: `monet-develop/${CURRENT_RECIPE_VERSION}`,
      modelVersions: {},
    },
  };
}

/** Shallow-merge a partial panel over its default (arrays replaced wholesale). */
function mergePanel<T extends object>(base: T, patch: unknown): T {
  if (patch == null || typeof patch !== "object") return base;
  return { ...base, ...(patch as Partial<T>) };
}

/** Normalize Optics while preserving canonical/digest stability. Recipes
 *  serialized before the continuous `aberration` field carry a boolean
 *  `removeChromaticAberration`; keep it verbatim so their canonical bytes and
 *  digest never change — and do NOT inject `aberration` (which would rewrite the
 *  canonical form of every legacy recipe). New recipes carry `aberration`; drop
 *  any stray legacy boolean. The param builders (developParams / develop.rs)
 *  read whichever field is present, so [1051] is byte-identical either way. */
function normalizeOptics(base: OpticsPanel, patch: unknown): OpticsPanel {
  const merged = mergePanel(base, patch) as OpticsPanel & { removeChromaticAberration?: boolean };
  const p = patch && typeof patch === "object" ? (patch as { aberration?: unknown; removeChromaticAberration?: unknown }) : null;
  if (p && typeof p.removeChromaticAberration === "boolean" && p.aberration == null) {
    // Legacy recipe: the boolean is the canonical field; keep it, don't add the
    // new one (so the stored recipe's digest is unchanged).
    delete (merged as { aberration?: number }).aberration;
  } else {
    delete merged.removeChromaticAberration;
  }
  const lens = normalizeLensSettings(merged);
  for (const key of Object.keys(merged)) {
    if (key.startsWith("profile") || key === "enableProfileCorrections") delete (merged as unknown as Record<string, unknown>)[key];
  }
  return { ...merged, ...lens };
}

// ── Trust-boundary hardening (docs/plans/10 Phase 5b) ────────────────────────
// normalizeRecipe is the shared decode boundary for untrusted MCP/XMP JSON.
// `sanitizeRecipe` below bounds genuinely-hostile input (NaN/Infinity,
// out-of-range magnitudes, over-long strings, oversized collections) WITHOUT
// altering any valid stored recipe. Ranges are a SUPERSET of both apps' domains
// — Galerie's LR-integer sliders (e.g. ±100, 0..100) AND Vision's engine domain
// (e.g. ±1) AND the canonical fixture's authoring values — so every in-range
// value passes through byte-identically and the canonical digest stays pinned.
// The clamp's job is to bound hostile input, never to impose one app's ranges.

/** finite-clamp, mirroring Vision's `finite`: non-finite/non-number → fallback. */
const clampNum = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** cleanString-style: strip control chars (< 0x20, 0x7f), bound length, trim.
 *  Non-string → "". Only ever applied to already-required string fields, whose
 *  valid values are short + printable, so they pass through unchanged. */
function cleanStr(v: unknown, max = 512): string {
  if (typeof v !== "string") return "";
  let out = "";
  let seen = 0;
  for (const ch of v) {
    if (seen++ >= max * 4 || out.length + ch.length > max) break;
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out.trim();
}

function sanitizeProfile(profile: ProfilePanel): ProfilePanel {
  const { digest, asShotKelvin, sourceCamera, ...rest } = profile;
  const source = normalizeProfileSource(sourceCamera);
  return {
    ...clampFields(rest, { amount: [0, 10, 1] }),
    id: cleanStr(profile.id, 512),
    name: cleanStr(profile.name, 512),
    group: cleanStr(profile.group, 512),
    ...(typeof digest === "string" && PROFILE_DIGEST_RE.test(digest) ? { digest } : {}),
    ...(isAsShotKelvin(asShotKelvin) ? { asShotKelvin } : {}),
    ...(source ? { sourceCamera: source } : {}),
  };
}

/** A ProfilePanel.asShotKelvin the engine accepts (its V6 tail's range). */
export const isAsShotKelvin = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1000 && value <= 100_000;

type ClampSpec = Record<string, [min: number, max: number, fallback: number]>;
/** Shallow-copy `obj`, clamping each listed numeric field IN PLACE; keys absent
 *  from `spec` (legacy/extra fields like optics.removeChromaticAberration) are
 *  preserved verbatim, and a field absent from `obj` is never added. */
function clampFields<T extends object>(obj: T, spec: ClampSpec): T {
  const out = { ...obj };
  const rec = out as Record<string, unknown>;
  for (const k in spec) {
    if (k in rec) {
      const [mn, mx, fb] = spec[k];
      rec[k] = clampNum(rec[k], mn, mx, fb);
    }
  }
  return out;
}

/** Like `clampFields`, but ALWAYS assigns every spec key. For array ELEMENTS
 *  (heal spots, Point Color samples) there is no default to deep-merge with, so
 *  a missing field would otherwise survive as `undefined` and land in the
 *  Float32Array as NaN — which the engine answers by dropping the WHOLE advanced
 *  tail (#220). Non-spec keys (Vision's working `id`) still ride through. */
function fillFields<T extends object>(obj: unknown, spec: ClampSpec): T {
  const raw = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...raw };
  for (const k in spec) {
    const [mn, mx, fb] = spec[k];
    out[k] = clampNum(raw[k], mn, mx, fb);
  }
  return out as T;
}

const clampPoints = (pts: unknown): CurvePoint[] =>
  (Array.isArray(pts) ? pts.slice(0, MAX_CURVE_POINTS_PER_CHANNEL) : []).map((p) => {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    return { x: clampNum(o.x, 0, 1, 0), y: clampNum(o.y, 0, 1, 0) };
  });

/** Exactly 8 finite entries, always — a SHORT band would leave `band[i]`
 *  undefined for every consumer that reads the eight HSL slots positionally
 *  (crsAttrs writes `undefined * 100` → NaN), so pad as well as cap (#222). */
const clampBand = (b: unknown): number[] =>
  Array.from({ length: 8 }, (_, i) => clampNum(Array.isArray(b) ? b[i] : undefined, -100, 100, 0));

/** Coerce a (possibly hostile) compiledLuts value into four 256-entry bands of
 *  finite numbers clamped 0..255 (non-finite/missing → identity `i`). Returns
 *  undefined for a non-object so an absent field stays absent. */
function clampCompiledLuts(v: unknown): NonNullable<ToneCurvePanel["compiledLuts"]> | undefined {
  if (v == null || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const band = (a: unknown): number[] => {
    const arr = Array.isArray(a) ? a : [];
    return Array.from({ length: 256 }, (_, i) => clampNum(arr[i], 0, 255, i));
  };
  return { master: band(o.master), r: band(o.r), g: band(o.g), b: band(o.b) };
}

const huePair = (v: unknown, def: [number, number]): [number, number] =>
  Array.isArray(v) ? [clampNum(v[0], 0, 360, def[0]), clampNum(v[1], 0, 360, def[1])] : def;

const BASIC_SPEC: ClampSpec = Object.fromEntries(
  ["temp", "tint", "exposure", "contrast", "highlights", "shadows", "whites", "blacks",
    "texture", "clarity", "dehaze", "vibrance", "saturation"].map((k) => [k, [-100, 100, 0]]),
);
const PARAMETRIC_SPEC: ClampSpec = { highlights: [-100, 100, 0], lights: [-100, 100, 0], darks: [-100, 100, 0], shadows: [-100, 100, 0] };
const GRADE_WHEEL_SPEC: ClampSpec = { hue: [0, 360, 0], sat: [0, 100, 0], lum: [-100, 100, 0] };
const DETAIL_SPEC: ClampSpec = {
  sharpenAmount: [0, 100, 0], sharpenRadius: [0, 100, 1], sharpenDetail: [0, 100, 25], sharpenMasking: [0, 100, 0],
  nrLuminance: [0, 100, 0], nrLuminanceDetail: [0, 100, 0], nrLuminanceContrast: [0, 100, 0],
  nrColor: [0, 100, 0], nrColorDetail: [0, 100, 50], nrColorSmoothness: [0, 100, 50],
};
const OPTICS_SPEC: ClampSpec = {
  aberration: [0, 100, 0], distortionAmount: [-100, 100, 0], vignettingAmount: [-100, 100, 0],
  defringePurpleAmount: [0, 100, 0], defringeGreenAmount: [0, 100, 0],
};
const TRANSFORM_SPEC: ClampSpec = {
  vertical: [-100, 100, 0], horizontal: [-100, 100, 0], rotate: [-100, 100, 0], scale: [0, 100, 1],
  xOffset: [-100, 100, 0], yOffset: [-100, 100, 0], aspect: [-100, 100, 0],
};
const EFFECTS_SPEC: ClampSpec = {
  vignetteAmount: [-100, 100, 0], vignetteMidpoint: [0, 100, 0.5], vignetteRoundness: [-100, 100, 0],
  vignetteFeather: [0, 100, 50], vignetteHighlights: [-100, 100, 0],
  grainAmount: [0, 100, 0], grainSize: [0, 100, 0], grainRoughness: [0, 100, 0],
};
const CALIB_SPEC: ClampSpec = Object.fromEntries(
  ["shadowTint", "redHue", "redSat", "greenHue", "greenSat", "blueHue", "blueSat"].map((k) => [k, [-100, 100, 0]]),
);
const CROP_RECT_SPEC: ClampSpec = { top: [0, 1, 0], left: [0, 1, 0], bottom: [0, 1, 1], right: [0, 1, 1] };
const POINT_COLOR_SPEC: ClampSpec = {
  srcHue: [0, 360, 0], srcSat: [0, 100, 0], srcLum: [0, 100, 0],
  hue: [-100, 100, 0], sat: [-100, 100, 0], lum: [-100, 100, 0], range: [0, 100, 0],
};
const HEAL_SPEC: ClampSpec = {
  x: [0, 1, 0.5], y: [0, 1, 0.5], sourceX: [0, 1, 0.5], sourceY: [0, 1, 0.5],
  radius: [0, 1, 0.02], feather: [0, 1, 0.5], opacity: [0, 1, 1],
};
const ENGINE_MASK_ADJ_SPEC: ClampSpec = Object.fromEntries(
  ["temp", "tint", "exposure", "contrast", "highlights", "shadows", "whites", "blacks",
    "texture", "clarity", "dehaze", "saturation", "sharpness", "noiseReduction", "moire", "defringe"]
    .map((k) => [k, [-100, 100, 0]]),
);
const ENGINE_MASK_KINDS = new Set<EngineMaskKind>([
  "brush", "linear-gradient", "radial-gradient", "bidirectional-gradient",
  "luminance-range", "color-range", "subject", "sky", "outline",
]);

// ── MaskGraph hardening (#114) ───────────────────────────────────────────────
// Galerie's MaskGraph reaches this boundary straight from untrusted JSON, so it
// needs the same bounding as every other field: a non-array `masks` crashes the
// consumers that iterate it, and NaN coordinates/opacity flow through
// computeMaskCoverage into blendMasked (whose `a<=0`/`a>=1` guards BOTH fail for
// NaN, writing black), while missing local adjustments become NaN in the develop
// ABI via foldLocalAdjustments.

/** Gradient handles legitimately sit off-frame, so mask geometry is NOT clamped
 *  to 0..1 — this bound only keeps NaN/absurd coordinates out of the renderer
 *  (the same limit the XMP parser uses). */
const MASK_COORD: [number, number, number] = [-4, 4, 0];
const UNIT_0: [number, number, number] = [0, 1, 0];
const UNIT_1: [number, number, number] = [0, 1, 1];

const DAB_SPEC: ClampSpec = { x: MASK_COORD, y: MASK_COORD, radius: [0, 1, 0.05], flow: [0, 1, 1], density: [0, 1, 1] };
const COLOR_SAMPLE_SPEC: ClampSpec = { r: UNIT_0, g: UNIT_0, b: UNIT_0 };
/** The REQUIRED numeric fields of each component kind (see maskGraph.ts). */
const COMPONENT_SPECS: Record<MaskComponentKind, ClampSpec> = {
  brush: {},
  linearGradient: { x1: MASK_COORD, y1: MASK_COORD, x2: MASK_COORD, y2: MASK_COORD },
  radialGradient: {
    cx: MASK_COORD, cy: MASK_COORD, rx: MASK_COORD, ry: MASK_COORD,
    angle: [-1e4, 1e4, 0], feather: [0, 1, 0.5],
  },
  rangeColor: { refine: [0, 1, 0.5] },
  rangeLuminance: { min: UNIT_0, max: UNIT_1, smoothness: [0, 1, 0.5] },
  rangeDepth: { near: UNIT_0, far: UNIT_1 },
  aiSubject: {}, aiSky: {}, aiBackground: {}, aiObjects: {}, aiPeople: {}, aiLandscape: {},
};
/** OPTIONAL numerics (brush.feather, rangeDepth.smoothness): clamped only when
 *  present, so an absent one keeps its documented "absent = …" meaning. */
const COMPONENT_OPTIONAL_SPEC: ClampSpec = { feather: [0, 1, 1], smoothness: [0, 1, 0.5] };
const MASK_ADJ_SPEC: ClampSpec = Object.fromEntries(
  Object.keys(createLocalAdjustments()).map((k) => [k, [-100, 100, 0]]),
);
const COMBINE_MODES = new Set<string>(["add", "subtract", "intersect"]);

/** One component, bounded — or null for a kind this renderer has no geometry
 *  for (guessing at it would paint in the wrong place, so drop it). */
function clampComponent(c: unknown): MaskComponent | null {
  const raw = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
  const kind = raw.kind as MaskComponentKind;
  const spec = COMPONENT_SPECS[kind];
  if (!spec) return null;
  const out = clampFields(fillFields<Record<string, unknown>>(raw, spec), COMPONENT_OPTIONAL_SPEC);
  out.id = cleanStr(raw.id, 512);
  out.combine = COMBINE_MODES.has(raw.combine as string) ? raw.combine : "add";
  out.invert = raw.invert === true;
  if (kind === "brush") {
    out.dabs = (Array.isArray(raw.dabs) ? raw.dabs.slice(0, MAX_MASK_DABS) : []).map((d) => {
      const dab = fillFields<BrushDab>(d, DAB_SPEC);
      dab.erase = (d as { erase?: unknown } | null)?.erase === true;
      return dab;
    });
    out.autoMask = raw.autoMask === true;
  } else if (kind === "rangeColor") {
    out.samples = (Array.isArray(raw.samples) ? raw.samples.slice(0, MAX_MASK_COLOR_SAMPLES) : [])
      .map((s) => fillFields(s, COLOR_SAMPLE_SPEC));
  } else if (kind.startsWith("ai")) {
    out.model = cleanStr(raw.model, 512);
    out.cacheId = typeof raw.cacheId === "string" ? cleanStr(raw.cacheId, 512) : null;
  }
  return out as unknown as MaskComponent;
}

/** Bound a whole mask graph; anything malformed collapses to the empty graph. */
function clampMaskGraph(v: unknown): MaskGraph {
  const list = (v as { masks?: unknown } | null | undefined)?.masks;
  if (!Array.isArray(list)) return createMaskGraph();
  return {
    masks: list.slice(0, MAX_GRAPH_MASKS).map((m): Mask => {
      const raw = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      return {
        ...(raw as unknown as Mask), // unknown/future fields ride through, as elsewhere
        id: cleanStr(raw.id, 512),
        name: cleanStr(raw.name, 512),
        enabled: raw.enabled !== false,
        inverted: raw.inverted === true,
        opacity: clampNum(raw.opacity, 0, 1, 1),
        components: (Array.isArray(raw.components) ? raw.components.slice(0, MAX_MASK_COMPONENTS) : [])
          .map(clampComponent)
          .filter((c): c is MaskComponent => c !== null),
        adjustments: fillFields<LocalAdjustments>(raw.adjustments, MASK_ADJ_SPEC),
      };
    }),
  };
}

/** Clamp/bound/truncate a fully-merged recipe so no NaN, unbounded magnitude,
 *  over-long string, or oversized collection can reach the develop ABI. A no-op
 *  for every valid recipe (see canonicalFixture + developRecipe hardening tests).
 *  Galerie's MaskGraph (`recipe.masks`) is a DIFFERENT shape from Vision's engine
 *  masks, so it has its own caps (`clampMaskGraph`) alongside the ones the
 *  additive Vision-shape `engineMasks` field gets. */
function sanitizeRecipe(recipe: DevelopRecipeV2): DevelopRecipeV2 {
  const { compiledLuts: rawCompiledLuts, ...tc } = recipe.toneCurve;
  const compiledLuts = clampCompiledLuts(rawCompiledLuts);
  const rawSplits = Array.isArray(tc.parametricSplits) ? tc.parametricSplits : [];
  const defSplits: [number, number, number] = [0.25, 0.5, 0.75];
  const splits: [number, number, number] = [
    clampNum(rawSplits[0], 0, 1, defSplits[0]),
    clampNum(rawSplits[1], 0, 1, defSplits[1]),
    clampNum(rawSplits[2], 0, 1, defSplits[2]),
  ];
  // Splits are region boundaries — hostile/degenerate order would fold the
  // shadow/mid/highlight regions, so force ascending here at the trust boundary.
  splits.sort((a, b) => a - b);

  const ca = recipe.crop.constrainAspect;
  const constrainAspect = typeof ca === "number"
    ? (Number.isFinite(ca) ? Math.min(1e4, Math.max(0, ca)) : null)
    : ca;

  const modelVersions: Record<string, string> = {};
  const mv = recipe.metadata?.modelVersions;
  if (mv && typeof mv === "object") {
    let n = 0;
    for (const k of Object.keys(mv)) {
      if (n++ >= 256) break;
      modelVersions[cleanStr(k, 256)] = cleanStr((mv as Record<string, unknown>)[k], 512);
    }
  }

  // rawDecode is a discriminated union, not a panel, so normalizeRecipe can only
  // shallow-merge it: a partial {mode:"neutralChromaticity"} would reach the
  // native decoder with x/y/derivationDigest undefined (#220). An incomplete
  // neutral point is not repairable — fall back to the decoder's own as-shot.
  const rd = recipe.rawDecode as { mode?: unknown; x?: unknown; y?: unknown; derivationDigest?: unknown } | null;
  const rawDecode: RawDecodeIntent =
    rd?.mode === "neutralChromaticity" && typeof rd.derivationDigest === "string"
      && Number.isFinite(rd.x) && Number.isFinite(rd.y)
      ? {
        mode: "neutralChromaticity",
        x: clampNum(rd.x, 0, 1, 0),
        y: clampNum(rd.y, 0, 1, 0),
        derivationDigest: cleanStr(rd.derivationDigest, 512),
      }
      : { mode: "asShot" };

  const engineMasks = Array.isArray(recipe.engineMasks)
    ? recipe.engineMasks.slice(0, MAX_ENGINE_MASKS).map((m): EngineMask => {
      const raw = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      const rawAdj = (raw.adjustments && typeof raw.adjustments === "object" ? raw.adjustments : {}) as Record<string, unknown>;
      // Every one of the 16 sliders MUST be present (developParams reads each
      // positionally) — fill absent/hostile fields with 0 so no NaN reaches the ABI.
      const adjustments = {} as Record<string, number>;
      for (const k in ENGINE_MASK_ADJ_SPEC) {
        const [mn, mx, fb] = ENGINE_MASK_ADJ_SPEC[k];
        adjustments[k] = clampNum(rawAdj[k], mn, mx, fb);
      }
      return {
        kind: ENGINE_MASK_KINDS.has(raw.kind as EngineMaskKind) ? (raw.kind as EngineMaskKind) : "brush",
        enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
        inverted: typeof raw.inverted === "boolean" ? raw.inverted : false,
        opacity: clampNum(raw.opacity, 0, 1, 1),
        feather: clampNum(raw.feather, 0, 1, 0.5),
        points: (Array.isArray(raw.points) ? raw.points.slice(0, MAX_ENGINE_MASK_POINTS) : []).map((p) => {
          const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
          return { x: clampNum(o.x, 0, 1, 0.5), y: clampNum(o.y, 0, 1, 0.5), pressure: clampNum(o.pressure, 0, 1, 1) };
        }),
        adjustments: adjustments as unknown as EngineMaskAdjustments,
        ...(Array.isArray(raw.range)
          ? { range: [clampNum(raw.range[0], 0, 1, 0), clampNum(raw.range[1], 0, 1, 1)] as [number, number] } : {}),
        ...(Array.isArray(raw.colorSamples)
          ? {
            colorSamples: raw.colorSamples.slice(0, MAX_ENGINE_MASK_COLORS).map((c) => {
              const a = Array.isArray(c) ? c : [];
              return [Math.round(clampNum(a[0], 0, 255, 0)), Math.round(clampNum(a[1], 0, 255, 0)), Math.round(clampNum(a[2], 0, 255, 0))] as [number, number, number];
            }),
          } : {}),
      };
    })
    : undefined;

  const enhance = recipe.enhance
    ? { ...recipe.enhance, denoiseAmount: clampNum(recipe.enhance.denoiseAmount, 0, 1, 0) }
    : undefined;

  return {
    ...recipe,
    rawDecode,
    profile: sanitizeProfile(recipe.profile),
    crop: {
      ...clampFields(recipe.crop, { angle: [-360, 360, 0] }),
      rect: clampFields(recipe.crop.rect, CROP_RECT_SPEC),
      orientation: Math.round(clampNum(recipe.crop.orientation, 1, 8, 1)),
      constrainAspect,
    },
    basic: {
      ...clampFields(recipe.basic, BASIC_SPEC),
      // wbMode is a string, so BASIC_SPEC's numeric clamp can't bound it, and it
      // now drives a menu — whitelist it here rather than trust catalog/XMP text.
      wbMode: WB_MODES.has(recipe.basic?.wbMode) ? recipe.basic.wbMode : "asShot",
    },
    toneCurve: {
      ...tc,
      parametric: clampFields(tc.parametric, PARAMETRIC_SPEC),
      parametricSplits: splits,
      point: clampPoints(tc.point),
      red: clampPoints(tc.red),
      green: clampPoints(tc.green),
      blue: clampPoints(tc.blue),
      ...(compiledLuts ? { compiledLuts } : {}),
    },
    colorMixer: {
      ...recipe.colorMixer,
      hue: clampBand(recipe.colorMixer.hue),
      saturation: clampBand(recipe.colorMixer.saturation),
      luminance: clampBand(recipe.colorMixer.luminance),
      gray: clampBand(recipe.colorMixer.gray),
    },
    pointColor: {
      samples: (Array.isArray(recipe.pointColor.samples) ? recipe.pointColor.samples : [])
        .slice(0, MAX_POINT_COLOR_SAMPLES)
        .map((s) => fillFields<PointColorSample>(s, POINT_COLOR_SPEC)),
    },
    colorGrading: {
      ...recipe.colorGrading,
      shadows: clampFields(recipe.colorGrading.shadows, GRADE_WHEEL_SPEC),
      midtones: clampFields(recipe.colorGrading.midtones, GRADE_WHEEL_SPEC),
      highlights: clampFields(recipe.colorGrading.highlights, GRADE_WHEEL_SPEC),
      global: clampFields(recipe.colorGrading.global, GRADE_WHEEL_SPEC),
      blending: clampNum(recipe.colorGrading.blending, 0, 100, 50),
      balance: clampNum(recipe.colorGrading.balance, -100, 100, 0),
    },
    detail: clampFields(recipe.detail, DETAIL_SPEC),
    optics: {
      ...clampFields(recipe.optics, OPTICS_SPEC),
      ...normalizeLensSettings(recipe.optics),
      defringePurpleHue: huePair(recipe.optics.defringePurpleHue, [30, 70]),
      defringeGreenHue: huePair(recipe.optics.defringeGreenHue, [40, 60]),
    },
    transform: clampFields(recipe.transform, TRANSFORM_SPEC),
    effects: clampFields(recipe.effects, EFFECTS_SPEC),
    calibration: clampFields(recipe.calibration, CALIB_SPEC),
    masks: clampMaskGraph(recipe.masks),
    heal: {
      ...recipe.heal,
      spots: (Array.isArray(recipe.heal?.spots) ? recipe.heal.spots : [])
        .slice(0, MAX_HEAL_SPOTS)
        .map((s) => {
          const spot = fillFields<HealSpot>(s, HEAL_SPEC);
          // The only two modes the engine renders; anything else is heal (#220).
          spot.mode = spot.mode === "clone" ? "clone" : "heal";
          return spot;
        }),
    },
    metadata: { ...recipe.metadata, createdWith: cleanStr(recipe.metadata?.createdWith, 512), modelVersions },
    ...(engineMasks ? { engineMasks } : {}),
    ...(enhance ? { enhance } : {}),
  };
}

/**
 * Fill any missing fields of `input` from the defaults and stamp the current
 * version — the single entry point for reading a stored recipe. Never mutates
 * `input`. Untrusted values are then bounded by `sanitizeRecipe` (clamps/caps
 * that no-op on every valid recipe).
 *
 * `version`/`processVersion` are plain discriminators for the CURRENT format:
 * a document declaring anything else is foreign, not something to upgrade, and
 * is rejected the same way garbage input is (→ a neutral recipe). Absent is
 * fine — partial JSON (MCP/XMP, presets) is filled from the defaults.
 */
export function normalizeRecipe(input: unknown): DevelopRecipeV2 {
  const d = createDefaultRecipe();
  if (input == null || typeof input !== "object") return d;
  const r = input as Record<string, unknown>;
  if (r.version != null && r.version !== CURRENT_RECIPE_VERSION) return d;
  if (r.processVersion != null && r.processVersion !== CURRENT_PROCESS_VERSION) return d;

  // Nested object panels need a *deep* fill: a shallow spread would let a partial
  // `colorGrading.shadows` ({hue:5}) drop sat/lum to undefined → NaN in the ABI.
  const cg = r.colorGrading as Partial<ColorGradingPanel> | undefined;
  const tc = r.toneCurve as Partial<ToneCurvePanel> | undefined;

  return sanitizeRecipe({
    ...d,
    version: CURRENT_RECIPE_VERSION,
    processVersion: CURRENT_PROCESS_VERSION,
    rawDecode: mergePanel(d.rawDecode, r.rawDecode) as RawDecodeIntent,
    profile: mergePanel(d.profile, r.profile),
    crop: {
      ...d.crop,
      ...(r.crop as object),
      rect: mergePanel(d.crop.rect, (r.crop as { rect?: unknown })?.rect),
    },
    basic: mergePanel(d.basic, r.basic),
    toneCurve: {
      ...mergePanel(d.toneCurve, tc),
      parametric: mergePanel(d.toneCurve.parametric, tc?.parametric),
    },
    colorMixer: mergePanel(d.colorMixer, r.colorMixer),
    pointColor: mergePanel(d.pointColor, r.pointColor),
    colorGrading: {
      ...mergePanel(d.colorGrading, cg),
      shadows: mergePanel(d.colorGrading.shadows, cg?.shadows),
      midtones: mergePanel(d.colorGrading.midtones, cg?.midtones),
      highlights: mergePanel(d.colorGrading.highlights, cg?.highlights),
      global: mergePanel(d.colorGrading.global, cg?.global),
    },
    detail: mergePanel(d.detail, r.detail),
    optics: normalizeOptics(d.optics, r.optics),
    transform: mergePanel(d.transform, r.transform),
    effects: mergePanel(d.effects, r.effects),
    calibration: mergePanel(d.calibration, r.calibration),
    hdr: mergePanel(d.hdr, r.hdr),
    heal: mergePanel(d.heal, r.heal),
    enabled: mergePanel(d.enabled, r.enabled),
    masks: (r.masks as MaskGraph | undefined)?.masks ? (r.masks as MaskGraph) : d.masks,
    metadata: mergePanel(d.metadata, r.metadata),
    // Carry the additive Vision-shape fields through when present so sanitizeRecipe
    // can cap them; Galerie recipes/createDefaultRecipe omit them, so the default
    // tail (mask_count 0) and the native recipe.rs parser are unaffected.
    ...(Array.isArray(r.engineMasks) ? { engineMasks: r.engineMasks as EngineMask[] } : {}),
    ...(r.enhance && typeof r.enhance === "object" ? { enhance: r.enhance as EnginePhotoEnhance } : {}),
  });
}
