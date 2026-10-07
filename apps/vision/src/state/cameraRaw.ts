// ─────────────────────────────────────────────────────────────
// Camera Raw develop recipe ⇄ flat engine params. Pure TS, no engine import
// (the LUT-pattern: builders/parsers live here, the Rust `develop_buf`
// orchestrator consumes the Float32Array). The positional layout below is the
// integration contract with `develop_buf` in packages/engine/src/raster/mod.rs —
// a wrong offset is silent visual corruption, so cameraRaw.test.ts pins the
// exact length and key offsets.
//
//   [0]  version
//   [1]  proxyScale                     (header only — recipe values are NEVER
//                                         pre-scaled TS-side; stored/fid-17
//                                         params always carry scale 1)
//   [2..15]  Basic: temp, tint, exposure, contrast, highlights, shadows,
//            whites, blacks, texture, clarity, dehaze, vibrance, saturation
//   [15..20] Detail: sharpenAmount, sharpenRadius, nrStrength, nrColor, nrDetail
//   [20..23] grain: amount, highlight, intensity
//   [23..25] vignette: amount, midpoint
//   [25]     curveEnabled
//   [26..282]  master[256]   (u8 LUT values 0..255 stored as f32)
//   [282..538] r[256]
//   [538..794] g[256]
//   [794..1050] b[256]
//   [1050..1053] Optics: distortion, aberration, defringe  (appended after the
//                LUTs; a with-default read keeps older 1050-length arrays valid)
//   [1053..1077] HSL / Colour mixer: hue[8], saturation[8], luminance[8] — the
//                eight ACR hue bands (Red, Orange, Yellow, Green, Aqua, Blue,
//                Purple, Magenta), each slider -1..1. Appended after Optics.
//   [1077..1083] Color Grading: (hue°, sat) pairs for Shadows, Midtones,
//                Highlights — three colour wheels. Appended after HSL.
//   [1083..1086] Geometry: vertical, horizontal, rotate — parametric keystone +
//                straighten (each -1..1). Appended after Color Grading.
//   [1086..] optional advanced tail: magic/version, profile+calibration, crop,
//            Enhance, bounded heal spots/local masks, and editable curve state.
//            Neutral/legacy recipes end at 1086 exactly.
// ─────────────────────────────────────────────────────────────

import { buildLut, masterToneLut, type CurvePointLike } from "./toneCurve";
// The 1086-prefix ABI offsets + advanced-tail magic are the shared develop
// layout, defined once in @monet-ui/monet-photo so Vision's codec and Galerie's
// developParams codec can never drift (docs/plans/10 Phase 5).
import { CURVE_BASE, CURVE_END, OPTICS_END, HSL_END, GRADE_END, DEV_ADVANCED_MAGIC, PROFILE_DIGEST_RE, UPRIGHT_CODES, isAsShotKelvin, normalizeProfileSource, type ProfileSourceCamera, normalizeLensSettings, readLensProfileWords, type LensCorrectionSettings, recipeToParams as monetPhotoRecipeToParams, type UprightMode } from "@monet-ui/monet-photo";
import { visionRecipeToV2 } from "./cameraRawToV2";
// CameraRawSource/CameraRawSnapshotEntry persist Vision's working V2 recipe. The
// TYPE is erased at compile time, so this stays acyclic — the working-recipe
// *values* (normalizeWorkingRecipe) and the source/snapshot *lifecycle*
// (normalize/clone) live one level up in ./cameraRawSource, which imports FROM
// this flat codec, never the reverse (docs/plans/10 Phase 5).
import type { VisionDevelopRecipe } from "./visionDevelopRecipe";
import type { RawDemosaic } from "./webExportPrefs";

export const CAMERA_RAW_VERSION = 1;
/** Canonical persisted recipe schema. The original 1086-float engine prefix
 * remains version 1; schema 2 adds an optional, magic-tagged variable tail. */
export const CAMERA_RAW_RECIPE_VERSION = 2;
export const CAMERA_RAW_SOURCE_VERSION = 1;
export const MAX_CAMERA_RAW_SOURCE_BYTES = 256 * 1024 * 1024;
/** ACR-style named snapshots saved WITH the raw source (and its XMP). */
export const MAX_CAMERA_RAW_SNAPSHOTS = 32;
/** Up to this many decoded RAW sources may be staged at once — one active
 * workspace plus queued sources shown as a filmstrip. Bounded so the resident
 * decoded WASM state (and the aggregate source-byte cap below) stays sane. */
export const MAX_CAMERA_RAW_PENDING_SESSIONS = 8;
export const MAX_CAMERA_RAW_PENDING_SOURCE_BYTES = MAX_CAMERA_RAW_SOURCE_BYTES;
export const MAX_CAMERA_RAW_HEAL_SPOTS = 64;
export const MAX_CAMERA_RAW_MASKS = 32;
export const MAX_CAMERA_RAW_MASK_POINTS = 4096;
export const MAX_CAMERA_RAW_MASK_COLORS = 64;
export const MAX_CAMERA_RAW_CURVE_POINTS_PER_CHANNEL = 128;
/** Point Color: up to eight sampled colour sockets (mirrors DEV_MAX_POINT_COLORS). */
export const MAX_CAMERA_RAW_POINT_COLORS = 8;
// CURVE_BASE / CURVE_END / OPTICS_END / HSL_END / GRADE_END are imported from
// @monet-ui/monet-photo (the shared ABI layout) above.
/** The eight ACR hue bands, in engine order (Red…Magenta). */
export const HSL_BANDS = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"] as const;
/** The three Color Grading tonal regions, in engine order. */
export const GRADE_REGIONS = ["shadows", "midtones", "highlights"] as const;
/** Exact params length `develop_buf` parses: 1083 (…+Grade) + 3 Geometry = 1086. */
export const CAMERA_RAW_PARAMS_LEN = GRADE_END + 3;
export const CAMERA_RAW_ADVANCED_MAGIC = DEV_ADVANCED_MAGIC;
export const CAMERA_RAW_ADVANCED_VERSION = 2;
/** V3 appends the Point Color block after the V2 curve-source payload. Emitted
 *  only when a recipe actually has point-color sockets, so point-color-free
 *  recipes stay V2 and older apps keep reading them. */
export const CAMERA_RAW_ADVANCED_V3 = 3;
/** V4 appends the 5-float Transform block and V5 a 12-float extras block after it
 *  (the Detail sub-sliders, lens Vignetting, Defringe hue windows + green amount
 *  and the Upright mode, #444). Emitted only when those fields leave their
 *  defaults; the Canonical recipe has no slot for them, so they read back as a
 *  {@link CameraRawAdvancedTrailer}. */
export const CAMERA_RAW_ADVANCED_V4 = 4;
export const CAMERA_RAW_ADVANCED_V5 = 5;
/** V6 appends the 9-float profile identity (#446): the digest of the DNG camera
 *  profile an embedded/custom profile renders through, as 16-bit words, then
 *  the image's as-shot kelvin (0 = unknown). */
export const CAMERA_RAW_ADVANCED_V6 = 6;
export const CAMERA_RAW_ADVANCED_V7 = 7;
export const CAMERA_RAW_ADVANCED_V8 = 8;

/** The V4/V5 tail fields, in the working (V2) recipe's own domains. */
export interface CameraRawAdvancedTrailer {
  lensProfile?: LensCorrectionSettings;
  transform: { aspect: number; scale: number; xOffset: number; yOffset: number; constrainCrop: boolean };
  extras?: {
    detail: {
      sharpenDetail: number; sharpenMasking: number; nrLuminanceContrast: number;
      nrColorDetail: number; nrColorSmoothness: number;
    };
    optics: {
      vignettingAmount: number; defringePurpleHue: [number, number];
      defringeGreenAmount: number; defringeGreenHue: [number, number];
    };
    upright: UprightMode;
  };
}
const UPRIGHT_BY_CODE = Object.fromEntries(
  Object.entries(UPRIGHT_CODES).map(([mode, code]) => [code, mode]),
) as Record<number, UprightMode>;

export interface CameraRawBasic {
  temp: number; tint: number; exposure: number; contrast: number;
  highlights: number; shadows: number; whites: number; blacks: number;
  texture: number; clarity: number; dehaze: number; vibrance: number; saturation: number;
}
/** ACR parametric-tone region sliders (each -100..100). */
export interface ParametricCurve {
  highlights: number; lights: number; darks: number; shadows: number;
}
export interface CameraRawCurve {
  enabled: boolean;
  /** Four 256-entry u8 LUTs (0..255), the compiled point+parametric result. */
  master: number[]; r: number[]; g: number[]; b: number[];
  /** Editable source state. Optional on legacy/runtime recipes; canonical v2
   * recipes always contain four channels (master, red, green, blue). */
  pointsByChannel?: CurvePointLike[][];
  parametric?: ParametricCurve;
}
export type CanonicalCameraRawCurve = CameraRawCurve & {
  pointsByChannel: CurvePointLike[][];
  parametric: ParametricCurve;
};
export interface CameraRawDetail {
  sharpenAmount: number; sharpenRadius: number;
  nrStrength: number; nrColor: number; nrDetail: number;
}
export interface CameraRawEffects {
  grainAmount: number; grainHighlight: number; grainIntensity: number;
  vignetteAmount: number; vignetteMidpoint: number;
}
export interface CameraRawOptics extends LensCorrectionSettings {
  lensProfile?: LensCorrectionSettings;
  /** Lens distortion correction, -1..1 (barrel↔pincushion). */
  distortion: number;
  /** Chromatic-aberration removal, 0..1. */
  aberration: number;
  /** Defringe width, 0..1 (→ 0..5 px). */
  defringe: number;
}
export interface CameraRawHSL {
  /** Per-band Hue shift, -1..1 (→ ±30°). One entry per {@link HSL_BANDS} band. */
  hue: number[];
  /** Per-band Saturation, -1..1 (-1 fully desaturates the band). */
  sat: number[];
  /** Per-band Luminance, -1..1 (darken↔lighten). */
  lum: number[];
}
/** One Color Grading wheel: hue in degrees (0..360), saturation 0..1. */
export interface GradeWheel { hue: number; sat: number }
export interface CameraRawColorGrade {
  shadows: GradeWheel; midtones: GradeWheel; highlights: GradeWheel;
}
export interface CameraRawGeometry {
  /** Vertical keystone, -1..1 (corrects converging verticals). */
  vertical: number;
  /** Horizontal keystone, -1..1 (corrects converging horizontals). */
  horizontal: number;
  /** Straighten rotation, -1..1 (→ ±15°). */
  rotate: number;
}

export type CameraRawProfileKind = "camera" | "creative" | "embedded" | "custom";
export interface CameraRawProfile {
  /** Stable implementation/profile identifier; display names are not identity. */
  id: string;
  name: string;
  kind: CameraRawProfileKind;
  /** Profile strength, 0..1. */
  amount: number;
  /** An embedded/custom DNG camera profile's digest (V6 tail identity). */
  digest?: string;
  /** The image's as-shot white in kelvin that profile is interpolated at. */
  asShotKelvin?: number;
  sourceCamera?: ProfileSourceCamera;
}
export interface CameraRawPrimaryCalibration { hue: number; saturation: number }
export interface CameraRawCalibration {
  shadowTint: number;
  red: CameraRawPrimaryCalibration;
  green: CameraRawPrimaryCalibration;
  blue: CameraRawPrimaryCalibration;
}
export interface CameraRawCrop {
  enabled: boolean;
  /** Normalized source bounds. */
  x: number; y: number; width: number; height: number;
  /** Straighten angle in degrees, -45..45. */
  angle: number;
  constrainAspect: boolean;
  aspectRatio?: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
}
export type CameraRawHealMode = "heal" | "clone";
export interface CameraRawHealSpot {
  id: string;
  mode: CameraRawHealMode;
  /** Target/source centers and radius are normalized to the uncropped source. */
  x: number; y: number; sourceX: number; sourceY: number; radius: number;
  feather: number;
  opacity: number;
}
export interface CameraRawLocalAdjustments {
  temp: number; tint: number; exposure: number; contrast: number;
  highlights: number; shadows: number; whites: number; blacks: number;
  texture: number; clarity: number; dehaze: number; saturation: number;
  sharpness: number; noiseReduction: number; moire: number; defringe: number;
}
export interface CameraRawMaskPoint { x: number; y: number; pressure: number }
export type CameraRawMaskKind =
  | "brush" | "linear-gradient" | "radial-gradient" | "bidirectional-gradient"
  | "luminance-range" | "color-range" | "subject" | "sky" | "outline";
export interface CameraRawLocalMask {
  id: string;
  name: string;
  kind: CameraRawMaskKind;
  enabled: boolean;
  inverted: boolean;
  opacity: number;
  feather: number;
  /** Brush path or gradient/radial control points, normalized to the source. */
  points: CameraRawMaskPoint[];
  /** Optional normalized min/max range for luminance masks. */
  range?: [number, number];
  /** Optional sRGB samples for color-range masks. */
  colorSamples?: [number, number, number][];
  adjustments: CameraRawLocalAdjustments;
}
export interface CameraRawEnhance {
  denoise: boolean;
  denoiseAmount: number;
  rawDetails: boolean;
  superResolution: boolean;
}
/** Point Color: one sampled colour socket that selectively shifts pixels near
 *  the picked colour. Mirrors the engine's DevelopPointColor. */
export interface CameraRawPointColor {
  id: string;
  /** Sampled reference colour: hue 0..360, saturation/luminance 0..1. */
  refHue: number; refSat: number; refLum: number;
  /** Hue/Saturation/Luminance shifts, -1..1 (hue → ±30°). */
  hue: number; sat: number; lum: number;
  /** Selectivity radius, 0..1 (widens the affected colour neighbourhood). */
  range: number;
}
export interface CameraRawRecipe {
  /** Missing means legacy schema 1 and is normalized to the current schema. */
  schemaVersion?: number;
  basic: CameraRawBasic;
  curve: CameraRawCurve;
  detail: CameraRawDetail;
  effects: CameraRawEffects;
  optics: CameraRawOptics;
  hsl: CameraRawHSL;
  grade: CameraRawColorGrade;
  geometry: CameraRawGeometry;
  /** Schema-2 source-level fields are optional on input for v1 compatibility. */
  profile?: CameraRawProfile;
  calibration?: CameraRawCalibration;
  crop?: CameraRawCrop;
  healSpots?: CameraRawHealSpot[];
  masks?: CameraRawLocalMask[];
  enhance?: CameraRawEnhance;
  pointColors?: CameraRawPointColor[];
}

export type CanonicalCameraRawRecipe = Omit<CameraRawRecipe, "curve"> & {
  schemaVersion: typeof CAMERA_RAW_RECIPE_VERSION;
  curve: CanonicalCameraRawCurve;
  profile: CameraRawProfile;
  calibration: CameraRawCalibration;
  crop: CameraRawCrop;
  healSpots: CameraRawHealSpot[];
  masks: CameraRawLocalMask[];
  enhance: CameraRawEnhance;
  pointColors: CameraRawPointColor[];
};

export type CameraRawMetadataScalar = string | number | boolean;
export interface CameraRawSourceMetadata {
  format?: string;
  make?: string;
  model?: string;
  lens?: string;
  serialNumber?: string;
  capturedAt?: string;
  width?: number;
  height?: number;
  orientation?: number;
  iso?: number;
  exposureSeconds?: number;
  aperture?: number;
  focalLengthMm?: number;
  focalLength35Mm?: number;
  subjectDistanceM?: number;
  bitDepth?: number;
  cfaPattern?: string;
  whiteBalance?: number[];
  blackLevels?: number[];
  whiteLevels?: number[];
  colorMatrix1?: number[];
  colorMatrix2?: number[];
  /** Bounded scalar metadata not covered by the canonical fields above. */
  extra?: Record<string, CameraRawMetadataScalar>;
}

/** Canonical project-owned RAW provenance. Lifecycle/session state deliberately
 * lives separately so temporary document ids are never written to a project. */
export interface CameraRawSnapshotEntry {
  name: string;
  recipe: VisionDevelopRecipe;
}

export interface CameraRawSource {
  version: typeof CAMERA_RAW_SOURCE_VERSION;
  originalName: string;
  originalPath?: string;
  mimeType?: string;
  sha256?: string;
  lastModified?: number;
  originalBytes: Uint8Array;
  metadata: CameraRawSourceMetadata;
  recipe: VisionDevelopRecipe;
  /** Named develop snapshots (ACR Snapshots) — persisted with the source/XMP. */
  snapshots?: CameraRawSnapshotEntry[];
  /** How the source was decoded, so Revert rebuilds the same document: the
   *  demosaic (absent = a pre-#443 source: the 3×3 average, no highlight
   *  headroom) and, for an Open at 32 bits, the depth. */
  demosaic?: RawDemosaic;
  depth?: 32;
}

export type CameraRawInvocationKind = "raw-open" | "filter" | "open-as-smart-object" | "reopen";
export type CameraRawDisposition = "pending" | "open" | "open-as-smart-object" | "done" | "cancelled";
/** Runtime-only transaction state for Store/App integration. */
export interface CameraRawSession {
  sessionId: string;
  invocation: CameraRawInvocationKind;
  disposition: CameraRawDisposition;
  source: CameraRawSource | null;
  provisionalDocumentId?: number;
  previousDocumentId?: number;
  targetDocumentId?: number;
  smartObjectLayerId?: number;
  sidecarPath?: string;
  startedAt?: string;
  completedAt?: string;
}

const identityLutArray = (): number[] => Array.from({ length: 256 }, (_, i) => i);
const diagonalCurvePoints = (): CurvePointLike[] => [{ x: 0, y: 0 }, { x: 1, y: 1 }];
const defaultCurveAuthoring = (): Pick<CanonicalCameraRawCurve, "pointsByChannel" | "parametric"> => ({
  pointsByChannel: Array.from({ length: 4 }, diagonalCurvePoints),
  parametric: { highlights: 0, lights: 0, darks: 0, shadows: 0 },
});

const defaultPrimaryCalibration = (): CameraRawPrimaryCalibration => ({ hue: 0, saturation: 0 });
export const defaultCameraRawLocalAdjustments = (): CameraRawLocalAdjustments => ({
  temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0,
  whites: 0, blacks: 0, texture: 0, clarity: 0, dehaze: 0, saturation: 0,
  sharpness: 0, noiseReduction: 0, moire: 0, defringe: 0,
});
export const defaultCameraRawSourceMetadata = (): CameraRawSourceMetadata => ({});

export function defaultRecipe(): CanonicalCameraRawRecipe {
  return {
    schemaVersion: CAMERA_RAW_RECIPE_VERSION,
    basic: {
      temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0,
      whites: 0, blacks: 0, texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
    },
    curve: {
      enabled: false,
      master: identityLutArray(), r: identityLutArray(), g: identityLutArray(), b: identityLutArray(),
      ...defaultCurveAuthoring(),
    },
    // sharpenRadius/vignetteMidpoint carry neutral non-zero defaults; the engine
    // only reads them once amount≠0, so identity output is preserved either way.
    detail: { sharpenAmount: 0, sharpenRadius: 1, nrStrength: 0, nrColor: 0, nrDetail: 0 },
    effects: { grainAmount: 0, grainHighlight: 0, grainIntensity: 0, vignetteAmount: 0, vignetteMidpoint: 0.5 },
    optics: { distortion: 0, aberration: 0, defringe: 0 },
    hsl: { hue: zeros8(), sat: zeros8(), lum: zeros8() },
    grade: {
      shadows: { hue: 0, sat: 0 }, midtones: { hue: 0, sat: 0 }, highlights: { hue: 0, sat: 0 },
    },
    geometry: { vertical: 0, horizontal: 0, rotate: 0 },
    profile: { id: "camera-default", name: "Camera Default", kind: "camera", amount: 1 },
    calibration: {
      shadowTint: 0,
      red: defaultPrimaryCalibration(), green: defaultPrimaryCalibration(), blue: defaultPrimaryCalibration(),
    },
    crop: {
      enabled: false, x: 0, y: 0, width: 1, height: 1, angle: 0,
      constrainAspect: false, flipHorizontal: false, flipVertical: false,
    },
    healSpots: [],
    masks: [],
    enhance: { denoise: false, denoiseAmount: 0, rawDetails: false, superResolution: false },
    pointColors: [],
  };
}

const zeros8 = (): number[] => Array.from({ length: 8 }, () => 0);
/** Read an 8-slider band block with a with-default fallback (older/short arrays). */
function readBand(p: ArrayLike<number>, base: number): number[] {
  return Array.from({ length: 8 }, (_, i) => (base + i < p.length ? p[base + i] : 0));
}

function readLut(p: ArrayLike<number>, base: number): number[] {
  const out = new Array<number>(256);
  for (let i = 0; i < 256; i++) out[i] = base + i < p.length ? p[base + i] : i;
  return out;
}

const LOCAL_ADJUSTMENT_KEYS = [
  "temp", "tint", "exposure", "contrast", "highlights", "shadows", "whites", "blacks",
  "texture", "clarity", "dehaze", "saturation", "sharpness", "noiseReduction", "moire", "defringe",
] as const satisfies readonly (keyof CameraRawLocalAdjustments)[];

type ParsedCameraRawAdvanced = Pick<
  CanonicalCameraRawRecipe,
  "profile" | "calibration" | "crop" | "healSpots" | "masks" | "enhance" | "pointColors"
> & Pick<CanonicalCameraRawCurve, "pointsByChannel" | "parametric"> & { trailer?: CameraRawAdvancedTrailer };

function parseAdvancedParams(p: ArrayLike<number>): ParsedCameraRawAdvanced | null {
  if (p.length <= CAMERA_RAW_PARAMS_LEN || p[CAMERA_RAW_PARAMS_LEN] !== CAMERA_RAW_ADVANCED_MAGIC) return null;
  const at = (index: number): number | null => {
    const value = p[index];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const fixedEnd = 1112;
  const version = at(1087);
  if (p.length < fixedEnd
    || (version !== 1 && version !== CAMERA_RAW_ADVANCED_VERSION && version !== CAMERA_RAW_ADVANCED_V3
      && version !== CAMERA_RAW_ADVANCED_V4 && version !== CAMERA_RAW_ADVANCED_V5
      && version !== CAMERA_RAW_ADVANCED_V6 && version !== CAMERA_RAW_ADVANCED_V7 && version !== CAMERA_RAW_ADVANCED_V8)) return null;
  const tailVersion = version ?? 0;
  for (let index = CAMERA_RAW_PARAMS_LEN; index < fixedEnd; index++) if (at(index) === null) return null;
  const rawProfileCode = at(1088)!;
  if (!Number.isInteger(rawProfileCode)) return null;
  const profileCode = rawProfileCode;
  const profiles: Record<number, CameraRawProfile> = {
    0: { id: "camera-default", name: "Camera Default", kind: "camera", amount: at(1089)! },
    1: { id: "adobe-color", name: "Adobe Color", kind: "creative", amount: at(1089)! },
    2: { id: "camera-neutral", name: "Camera Neutral", kind: "camera", amount: at(1089)! },
    3: { id: "monochrome", name: "Monochrome", kind: "creative", amount: at(1089)! },
    4: { id: "embedded", name: "Embedded", kind: "embedded", amount: at(1089)! },
    5: { id: "custom", name: "Custom", kind: "custom", amount: at(1089)! },
  };
  if (!profiles[profileCode]) return null;
  let cursor = fixedEnd;
  const countAt = (index: number, max: number): number | null => {
    const value = at(index);
    if (value === null || value < 0 || value > max || Math.trunc(value) !== value) return null;
    return value;
  };
  const healCount = countAt(1111, MAX_CAMERA_RAW_HEAL_SPOTS);
  if (healCount === null || cursor + healCount * 8 + 1 > p.length) return null;
  const healSpots: CameraRawHealSpot[] = [];
  for (let index = 0; index < healCount; index++) {
    const values = Array.from({ length: 8 }, (_, offset) => at(cursor + offset));
    if (values.some((value) => value === null)) return null;
    const mode = countAt(cursor, 1);
    if (mode === null) return null;
    healSpots.push({
      id: `heal-${index + 1}`,
      mode: mode === 1 ? "clone" : "heal",
      x: values[1]!, y: values[2]!, sourceX: values[3]!, sourceY: values[4]!,
      radius: values[5]!, feather: values[6]!, opacity: values[7]!,
    });
    cursor += 8;
  }
  const maskCount = countAt(cursor++, MAX_CAMERA_RAW_MASKS);
  if (maskCount === null) return null;
  const kinds: CameraRawMaskKind[] = ["brush", "linear-gradient", "radial-gradient", "luminance-range", "color-range", "subject", "sky", "outline", "bidirectional-gradient"];
  const masks: CameraRawLocalMask[] = [];
  let totalPoints = 0;
  for (let index = 0; index < maskCount; index++) {
    if (cursor + 25 > p.length) return null;
    const header = Array.from({ length: 9 }, (_, offset) => at(cursor + offset));
    if (header.some((value) => value === null)) return null;
    const kindCode = countAt(cursor, kinds.length - 1);
    const kind = kindCode === null ? undefined : kinds[kindCode];
    const pointCount = countAt(cursor + 7, MAX_CAMERA_RAW_MASK_POINTS);
    const colorCount = countAt(cursor + 8, MAX_CAMERA_RAW_MASK_COLORS);
    if (!kind || pointCount === null || colorCount === null) return null;
    totalPoints += pointCount;
    if (totalPoints > MAX_CAMERA_RAW_MASK_POINTS) return null;
    cursor += 9;
    const adjustments = {} as CameraRawLocalAdjustments;
    for (const key of LOCAL_ADJUSTMENT_KEYS) {
      const value = at(cursor++);
      if (value === null) return null;
      adjustments[key] = value;
    }
    if (cursor + pointCount * 3 + colorCount * 3 > p.length) return null;
    const points: CameraRawMaskPoint[] = [];
    for (let point = 0; point < pointCount; point++) {
      const x = at(cursor++), y = at(cursor++), pressure = at(cursor++);
      if (x === null || y === null || pressure === null) return null;
      points.push({ x, y, pressure });
    }
    const colorSamples: [number, number, number][] = [];
    for (let color = 0; color < colorCount; color++) {
      const r = at(cursor++), g = at(cursor++), b = at(cursor++);
      if (r === null || g === null || b === null) return null;
      colorSamples.push([r, g, b]);
    }
    masks.push({
      id: `mask-${index + 1}`, name: `${kind.replace(/-/g, " ")} ${index + 1}`, kind,
      enabled: header[1]! >= 0.5, inverted: header[2]! >= 0.5,
      opacity: header[3]!, feather: header[4]!, points,
      range: [header[5]!, header[6]!],
      ...(colorSamples.length ? { colorSamples } : {}),
      adjustments,
    });
  }
  let curveAuthoring = defaultCurveAuthoring();
  if (tailVersion >= CAMERA_RAW_ADVANCED_VERSION) {
    if (cursor + 4 > p.length) return null;
    const parametricValues = Array.from({ length: 4 }, (_, offset) => at(cursor + offset));
    if (parametricValues.some((value) => value === null || value < -100 || value > 100)) return null;
    const parametric: ParametricCurve = {
      highlights: parametricValues[0]!, lights: parametricValues[1]!,
      darks: parametricValues[2]!, shadows: parametricValues[3]!,
    };
    cursor += 4;
    const pointsByChannel: CurvePointLike[][] = [];
    for (let channel = 0; channel < 4; channel++) {
      const pointCount = countAt(cursor++, MAX_CAMERA_RAW_CURVE_POINTS_PER_CHANNEL);
      if (pointCount === null || pointCount < 2 || cursor + pointCount * 2 > p.length) return null;
      const points: CurvePointLike[] = [];
      for (let point = 0; point < pointCount; point++) {
        const x = at(cursor++), y = at(cursor++);
        if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1) return null;
        points.push({ x, y });
      }
      pointsByChannel.push(points);
    }
    curveAuthoring = { pointsByChannel, parametric };
  }
  const pointColors: CameraRawPointColor[] = [];
  if (tailVersion >= CAMERA_RAW_ADVANCED_V3) {
    const pcCount = countAt(cursor++, MAX_CAMERA_RAW_POINT_COLORS);
    if (pcCount === null || cursor + pcCount * 7 > p.length) return null;
    for (let index = 0; index < pcCount; index++) {
      const v = Array.from({ length: 7 }, (_, offset) => at(cursor + offset));
      if (v.some((value) => value === null)) return null;
      pointColors.push({
        id: `point-color-${index + 1}`,
        refHue: v[0]!, refSat: v[1]!, refLum: v[2]!,
        hue: v[3]!, sat: v[4]!, lum: v[5]!, range: v[6]!,
      });
      cursor += 7;
    }
  }
  // V4/V5 blocks, range-checked exactly like the engine parser so a tail it
  // would reject never reads back here either.
  const inRange = (value: number | null, lo: number, hi: number): value is number =>
    value !== null && value >= lo && value <= hi;
  let trailer: CameraRawAdvancedTrailer | undefined;
  if (tailVersion >= CAMERA_RAW_ADVANCED_V4) {
    const [aspect, scale, xOffset, yOffset, constrain] = Array.from({ length: 5 }, (_, offset) => at(cursor + offset));
    if (!inRange(aspect, -1, 1) || !inRange(scale, 0.25, 4) || !inRange(xOffset, -1, 1)
      || !inRange(yOffset, -1, 1) || (constrain !== 0 && constrain !== 1)) return null;
    trailer = { transform: { aspect, scale, xOffset, yOffset, constrainCrop: constrain === 1 } };
    cursor += 5;
  }
  if (trailer && tailVersion >= CAMERA_RAW_ADVANCED_V5) {
    const e = Array.from({ length: 12 }, (_, offset) => at(cursor + offset));
    const [sharpenDetail, sharpenMasking, nrLuminanceContrast, nrColorDetail, nrColorSmoothness,
      vignettingAmount, purpleLo, purpleHi, defringeGreenAmount, greenLo, greenHi] = e;
    const upright = e[11] === null ? undefined : UPRIGHT_BY_CODE[e[11]];
    if (!inRange(sharpenDetail, 0, 100) || !inRange(sharpenMasking, 0, 100)
      || !inRange(nrLuminanceContrast, 0, 100) || !inRange(nrColorDetail, 0, 100)
      || !inRange(nrColorSmoothness, 0, 100) || !inRange(vignettingAmount, -1, 1)
      || !inRange(purpleLo, 0, 100) || !inRange(purpleHi, purpleLo, 100)
      || !inRange(defringeGreenAmount, 0, 1)
      || !inRange(greenLo, 0, 100) || !inRange(greenHi, greenLo, 100) || !upright) return null;
    trailer.extras = {
      detail: { sharpenDetail, sharpenMasking, nrLuminanceContrast, nrColorDetail, nrColorSmoothness },
      optics: {
        vignettingAmount, defringePurpleHue: [purpleLo, purpleHi],
        defringeGreenAmount, defringeGreenHue: [greenLo, greenHi],
      },
      upright,
    };
    cursor += 12;
  }
  let identity: Pick<CameraRawProfile, "digest" | "asShotKelvin" | "sourceCamera"> = {};
  const identityLength = tailVersion === CAMERA_RAW_ADVANCED_V8 ? countAt(cursor++, 21)
    : tailVersion === CAMERA_RAW_ADVANCED_V7 ? 21 : tailVersion === CAMERA_RAW_ADVANCED_V6 ? 9 : 0;
  if (identityLength === null || ![0, 9, 21].includes(identityLength)) return null;
  if (identityLength >= 9) {
    const words = Array.from({ length: 8 }, (_, offset) => countAt(cursor + offset, 0xffff));
    const asShot = at(cursor + 8);
    if (words.some((word) => word === null) || asShot === null || (asShot !== 0 && !isAsShotKelvin(asShot))) return null;
    identity = {
      digest: words.map((word) => word!.toString(16).toUpperCase().padStart(4, "0")).join(""),
      ...(asShot ? { asShotKelvin: asShot } : {}),
    };
    cursor += 9;
  }
  if (identityLength === 21) {
    const sourceCamera = normalizeProfileSource({ cameraToXyz: Array.from({ length: 9 }, (_, i) => p[cursor + i]), whiteBalance: Array.from({ length: 3 }, (_, i) => p[cursor + 9 + i]) });
    if (!sourceCamera) return null;
    identity.sourceCamera = sourceCamera;
    cursor += 12;
  }
  if (tailVersion === CAMERA_RAW_ADVANCED_V8) {
    const lens = readLensProfileWords(p, cursor);
    if (!lens || !trailer) return null;
    trailer.lensProfile = lens.optics; cursor = lens.end;
  }
  if (cursor !== p.length) return null;
  const raw = {
    profile: { ...profiles[profileCode], ...(profileCode >= 4 ? identity : {}) },
    calibration: {
      shadowTint: at(1090),
      red: { hue: at(1091), saturation: at(1092) },
      green: { hue: at(1093), saturation: at(1094) },
      blue: { hue: at(1095), saturation: at(1096) },
    },
    crop: {
      enabled: at(1097)! >= 0.5, x: at(1098), y: at(1099), width: at(1100), height: at(1101), angle: at(1102),
      constrainAspect: at(1103)! >= 0.5, aspectRatio: at(1104)! > 0 ? at(1104) : undefined,
      flipHorizontal: at(1105)! >= 0.5, flipVertical: at(1106)! >= 0.5,
    },
    healSpots,
    masks,
    enhance: {
      denoise: at(1107)! >= 0.5, denoiseAmount: at(1108), rawDetails: at(1109)! >= 0.5, superResolution: at(1110)! >= 0.5,
    },
    pointColors,
  };
  const normalized = normalizeCameraRawRecipe({ ...defaultRecipe(), ...raw });
  return normalized ? {
    profile: normalized.profile,
    calibration: normalized.calibration,
    crop: normalized.crop,
    healSpots: normalized.healSpots,
    masks: normalized.masks,
    enhance: normalized.enhance,
    pointColors: normalized.pointColors,
    ...curveAuthoring,
    ...(trailer ? { trailer } : {}),
  } : null;
}

/** The V4/V5 tail fields `paramsToRecipe` cannot represent, or null when `p`
 *  carries no valid V4/V5 advanced tail. */
export function readAdvancedTrailer(p: ArrayLike<number>): CameraRawAdvancedTrailer | null {
  return parseAdvancedParams(p)?.trailer ?? null;
}

/** Build the flat engine params from a recipe. `proxyScale` fills ONLY header
 *  slot [1]; every recipe value is written verbatim (never pre-scaled). */
export function recipeToParams(recipe: CameraRawRecipe, proxyScale = 1): Float32Array {
  const canonical = normalizeCameraRawRecipe(recipe);
  if (!canonical) throw new Error("Invalid Camera Raw recipe");
  // Vision now DELEGATES to the shared monet-photo codec (docs/plans/10 Phase 5):
  // map onto DevelopRecipeV2 and let monet-photo emit the 1086-float prefix + the
  // Vision-v2 advanced tail. The pre-refactor prefix wrote raw recipe scalars
  // verbatim (unclamped); normalization fills the optional tail fields, but the
  // prefix groups pass through raw so out-of-range scalars stay byte-identical.
  // Vision's DECOUPLED render LUTs (recipe.curve.master/r/g/b) ride along as
  // toneCurve.compiledLuts (set by migrateVisionV2); the shared codec writes them
  // into the render prefix VERBATIM — so editing authoring points never recompiles
  // the prefix, and the ABI golden stays byte-exact. No post-step needed.
  const mapped = visionRecipeToV2({
    ...canonical,
    basic: recipe.basic, detail: recipe.detail, effects: recipe.effects,
    optics: recipe.optics, hsl: recipe.hsl, grade: recipe.grade, geometry: recipe.geometry,
  });
  return monetPhotoRecipeToParams(mapped, proxyScale, { tailFormat: "visionV2" });
}

/** Parse flat engine params back into a recipe. Uses a with-default read so a
 *  shorter (older / phase-2) array stays valid under a longer layout — missing
 *  scalars default to 0, missing LUT entries to identity. */
export function paramsToRecipe(p: ArrayLike<number>): CanonicalCameraRawRecipe {
  if (p.length > 0 && (!Number.isFinite(p[0]) || p[0] !== CAMERA_RAW_VERSION)) {
    throw new Error(`Unsupported Camera Raw engine recipe version: ${String(p[0])}`);
  }
  const g = (i: number): number => i < p.length && Number.isFinite(p[i]) ? p[i] : 0;
  const canonical = defaultRecipe();
  const advanced = parseAdvancedParams(p);
  return {
    schemaVersion: CAMERA_RAW_RECIPE_VERSION,
    basic: {
      temp: g(2), tint: g(3), exposure: g(4), contrast: g(5),
      highlights: g(6), shadows: g(7), whites: g(8), blacks: g(9),
      texture: g(10), clarity: g(11), dehaze: g(12), vibrance: g(13), saturation: g(14),
    },
    detail: {
      sharpenAmount: g(15), sharpenRadius: g(16),
      nrStrength: g(17), nrColor: g(18), nrDetail: g(19),
    },
    effects: {
      grainAmount: g(20), grainHighlight: g(21), grainIntensity: g(22),
      vignetteAmount: g(23), vignetteMidpoint: g(24),
    },
    curve: {
      enabled: g(25) >= 0.5,
      master: readLut(p, CURVE_BASE),
      r: readLut(p, CURVE_BASE + 256),
      g: readLut(p, CURVE_BASE + 512),
      b: readLut(p, CURVE_BASE + 768),
      pointsByChannel: advanced?.pointsByChannel ?? canonical.curve.pointsByChannel,
      parametric: advanced?.parametric ?? canonical.curve.parametric,
    },
    optics: { distortion: g(CURVE_END), aberration: g(CURVE_END + 1), defringe: g(CURVE_END + 2),
      ...(advanced?.trailer?.lensProfile ? { lensProfile: advanced.trailer.lensProfile } : {}) },
    hsl: {
      hue: readBand(p, OPTICS_END),
      sat: readBand(p, OPTICS_END + 8),
      lum: readBand(p, OPTICS_END + 16),
    },
    grade: {
      shadows: { hue: g(HSL_END), sat: g(HSL_END + 1) },
      midtones: { hue: g(HSL_END + 2), sat: g(HSL_END + 3) },
      highlights: { hue: g(HSL_END + 4), sat: g(HSL_END + 5) },
    },
    geometry: { vertical: g(GRADE_END), horizontal: g(GRADE_END + 1), rotate: g(GRADE_END + 2) },
    profile: advanced?.profile ?? canonical.profile,
    calibration: advanced?.calibration ?? canonical.calibration,
    crop: advanced?.crop ?? canonical.crop,
    healSpots: advanced?.healSpots ?? canonical.healSpots,
    masks: advanced?.masks ?? canonical.masks,
    enhance: advanced?.enhance ?? canonical.enhance,
    pointColors: advanced?.pointColors ?? canonical.pointColors,
  };
}

type UnknownRecord = Record<string, unknown>;
export const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
const finite = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export const integer = (value: unknown, fallback: number, min: number, max: number): number =>
  Math.round(finite(value, fallback, min, max));
const bool = (value: unknown, fallback: boolean): boolean => typeof value === "boolean" ? value : fallback;
export const cleanString = (value: unknown, max: number, fallback = ""): string => {
  if (typeof value !== "string") return fallback;
  const clean: string[] = [];
  let inspected = 0;
  let outputLength = 0;
  for (const character of value) {
    // Hostile project/XMP strings must not create a full-size Array.from
    // temporary. Inspect only a bounded prefix while allowing a few stripped
    // control characters before the canonical output limit is reached.
    if (inspected++ >= max * 4 || outputLength + character.length > max) break;
    const code = character.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) {
      clean.push(character);
      outputLength += character.length;
    }
  }
  return clean.join("").trim() || fallback;
};
const section = (value: unknown): UnknownRecord => asRecord(value) ?? {};

function normalizeLut(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value) || value.length !== 256) return fallback.slice();
  return value.map((entry, i) => integer(entry, fallback[i], 0, 255));
}
function normalizeBand(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 8) return zeros8();
  return value.map((entry) => finite(entry, 0, -1, 1));
}
function normalizeCurveAuthoring(curve: UnknownRecord): Pick<CanonicalCameraRawCurve, "pointsByChannel" | "parametric"> | null {
  const defaults = defaultCurveAuthoring();
  let pointsByChannel = defaults.pointsByChannel;
  if (curve.pointsByChannel !== undefined) {
    if (!Array.isArray(curve.pointsByChannel) || curve.pointsByChannel.length !== 4) return null;
    pointsByChannel = [];
    for (const channel of curve.pointsByChannel) {
      if (!Array.isArray(channel) || channel.length < 2 || channel.length > MAX_CAMERA_RAW_CURVE_POINTS_PER_CHANNEL) return null;
      pointsByChannel.push(channel.flatMap((entry) => {
        const point = asRecord(entry);
        return point ? [{ x: finite(point.x, 0, 0, 1), y: finite(point.y, 0, 0, 1) }] : [];
      }));
      if (pointsByChannel[pointsByChannel.length - 1].length < 2) return null;
    }
  }
  const parametric = section(curve.parametric);
  return {
    pointsByChannel,
    parametric: {
      highlights: finite(parametric.highlights, 0, -100, 100),
      lights: finite(parametric.lights, 0, -100, 100),
      darks: finite(parametric.darks, 0, -100, 100),
      shadows: finite(parametric.shadows, 0, -100, 100),
    },
  };
}
function normalizePrimary(value: unknown): CameraRawPrimaryCalibration {
  const raw = section(value);
  return { hue: finite(raw.hue, 0, -1, 1), saturation: finite(raw.saturation, 0, -1, 1) };
}
function normalizeLocalAdjustments(value: unknown): CameraRawLocalAdjustments {
  const raw = section(value);
  return {
    temp: finite(raw.temp, 0, -1, 1), tint: finite(raw.tint, 0, -1, 1),
    exposure: finite(raw.exposure, 0, -10, 10), contrast: finite(raw.contrast, 0, -1, 1),
    highlights: finite(raw.highlights, 0, -1, 1), shadows: finite(raw.shadows, 0, -1, 1),
    whites: finite(raw.whites, 0, -1, 1), blacks: finite(raw.blacks, 0, -1, 1),
    texture: finite(raw.texture, 0, -1, 1), clarity: finite(raw.clarity, 0, -1, 1),
    dehaze: finite(raw.dehaze, 0, -1, 1), saturation: finite(raw.saturation, 0, -1, 1),
    sharpness: finite(raw.sharpness, 0, -1, 1), noiseReduction: finite(raw.noiseReduction, 0, -1, 1),
    moire: finite(raw.moire, 0, -1, 1), defringe: finite(raw.defringe, 0, -1, 1),
  };
}

function normalizeHealSpots(value: unknown): CameraRawHealSpot[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CAMERA_RAW_HEAL_SPOTS) return null;
  const out: CameraRawHealSpot[] = [];
  for (let i = 0; i < value.length; i++) {
    const raw = asRecord(value[i]);
    if (!raw) continue;
    out.push({
      id: cleanString(raw.id, 128, `heal-${i + 1}`),
      mode: raw.mode === "clone" ? "clone" : "heal",
      x: finite(raw.x, 0.5, 0, 1), y: finite(raw.y, 0.5, 0, 1),
      sourceX: finite(raw.sourceX, 0.5, 0, 1), sourceY: finite(raw.sourceY, 0.5, 0, 1),
      radius: finite(raw.radius, 0.02, 0.00001, 1),
      feather: finite(raw.feather, 0.5, 0, 1), opacity: finite(raw.opacity, 1, 0, 1),
    });
  }
  return out;
}

function normalizePointColors(value: unknown): CameraRawPointColor[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CAMERA_RAW_POINT_COLORS) return null;
  const out: CameraRawPointColor[] = [];
  for (let i = 0; i < value.length; i++) {
    const raw = asRecord(value[i]);
    if (!raw) continue;
    out.push({
      id: cleanString(raw.id, 128, `point-color-${i + 1}`),
      refHue: finite(raw.refHue, 0, 0, 360), refSat: finite(raw.refSat, 0, 0, 1), refLum: finite(raw.refLum, 0.5, 0, 1),
      hue: finite(raw.hue, 0, -1, 1), sat: finite(raw.sat, 0, -1, 1), lum: finite(raw.lum, 0, -1, 1),
      range: finite(raw.range, 0, 0, 1),
    });
  }
  return out;
}

const MASK_KINDS = new Set<CameraRawMaskKind>([
  "brush", "linear-gradient", "radial-gradient", "bidirectional-gradient", "luminance-range", "color-range", "subject", "sky", "outline",
]);
function normalizeMasks(value: unknown): CameraRawLocalMask[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CAMERA_RAW_MASKS) return null;
  const out: CameraRawLocalMask[] = [];
  let totalPoints = 0;
  for (let i = 0; i < value.length; i++) {
    const raw = asRecord(value[i]);
    if (!raw) continue;
    if (raw.points !== undefined && !Array.isArray(raw.points)) continue;
    const pointsRaw = (raw.points as unknown[] | undefined) ?? [];
    totalPoints += pointsRaw.length;
    if (totalPoints > MAX_CAMERA_RAW_MASK_POINTS) return null;
    const points: CameraRawMaskPoint[] = [];
    for (const entry of pointsRaw) {
      const point = asRecord(entry);
      if (!point) continue;
      points.push({
        x: finite(point.x, 0.5, 0, 1), y: finite(point.y, 0.5, 0, 1),
        pressure: finite(point.pressure, 1, 0, 1),
      });
    }
    const rangeRaw = Array.isArray(raw.range) && raw.range.length === 2 ? raw.range : null;
    const range: [number, number] | undefined = rangeRaw
      ? [finite(rangeRaw[0], 0, 0, 1), finite(rangeRaw[1], 1, 0, 1)] : undefined;
    if (range && range[0] > range[1]) [range[0], range[1]] = [range[1], range[0]];
    if (Array.isArray(raw.colorSamples) && raw.colorSamples.length > MAX_CAMERA_RAW_MASK_COLORS) return null;
    const colorSamples: [number, number, number][] | undefined = Array.isArray(raw.colorSamples)
      ? raw.colorSamples.flatMap((entry) => Array.isArray(entry) && entry.length === 3
        ? [[integer(entry[0], 0, 0, 255), integer(entry[1], 0, 0, 255), integer(entry[2], 0, 0, 255)] as [number, number, number]]
        : [])
      : undefined;
    const kind = typeof raw.kind === "string" && MASK_KINDS.has(raw.kind as CameraRawMaskKind)
      ? raw.kind as CameraRawMaskKind : "brush";
    out.push({
      id: cleanString(raw.id, 128, `mask-${i + 1}`),
      name: cleanString(raw.name, 256, `Mask ${i + 1}`),
      kind,
      enabled: bool(raw.enabled, true), inverted: bool(raw.inverted, false),
      opacity: finite(raw.opacity, 1, 0, 1), feather: finite(raw.feather, 0.5, 0, 1),
      points,
      ...(range ? { range } : {}),
      ...(colorSamples?.length ? { colorSamples } : {}),
      adjustments: normalizeLocalAdjustments(raw.adjustments),
    });
  }
  return out;
}

/** Normalize trusted runtime or untrusted JSON into the canonical recipe. Root
 * shape/version and collection limits reject; individual scalar values are
 * clamped and malformed collection entries are discarded. */
export function normalizeCameraRawRecipe(value: unknown): CanonicalCameraRawRecipe | null {
  const raw = asRecord(value);
  if (!raw) return null;
  if (raw.schemaVersion !== undefined
    && (typeof raw.schemaVersion !== "number" || !Number.isInteger(raw.schemaVersion))) return null;
  const inputVersion = raw.schemaVersion === undefined ? 1 : raw.schemaVersion;
  if (inputVersion < 1 || inputVersion > CAMERA_RAW_RECIPE_VERSION) return null;
  const def = defaultRecipe();
  const basic = section(raw.basic), curve = section(raw.curve), detail = section(raw.detail);
  const effects = section(raw.effects), optics = section(raw.optics), hsl = section(raw.hsl);
  const grade = section(raw.grade), geometry = section(raw.geometry);
  const shadows = section(grade.shadows), midtones = section(grade.midtones), highlights = section(grade.highlights);
  const healSpots = normalizeHealSpots(raw.healSpots);
  const masks = normalizeMasks(raw.masks);
  const pointColors = normalizePointColors(raw.pointColors);
  const curveAuthoring = normalizeCurveAuthoring(curve);
  if (!healSpots || !masks || !pointColors || !curveAuthoring) return null;
  const profile = section(raw.profile), calibration = section(raw.calibration);
  const crop = section(raw.crop), enhance = section(raw.enhance);
  const profileKind = typeof profile.kind === "string" && ["camera", "creative", "embedded", "custom"].includes(profile.kind)
    ? profile.kind as CameraRawProfileKind : def.profile.kind;
  const x = finite(crop.x, 0, 0, 1), y = finite(crop.y, 0, 0, 1);
  const width = Math.min(finite(crop.width, 1, 0.00001, 1), 1 - x || 0.00001);
  const height = Math.min(finite(crop.height, 1, 0.00001, 1), 1 - y || 0.00001);
  const ratio = finite(crop.aspectRatio, 0, 0, 1000);
  return {
    schemaVersion: CAMERA_RAW_RECIPE_VERSION,
    basic: {
      temp: finite(basic.temp, 0, -1, 1), tint: finite(basic.tint, 0, -1, 1),
      exposure: finite(basic.exposure, 0, -10, 10), contrast: finite(basic.contrast, 0, -1, 1),
      highlights: finite(basic.highlights, 0, -1, 1), shadows: finite(basic.shadows, 0, -1, 1),
      whites: finite(basic.whites, 0, -1, 1), blacks: finite(basic.blacks, 0, -1, 1),
      texture: finite(basic.texture, 0, -1, 1), clarity: finite(basic.clarity, 0, -1, 1),
      dehaze: finite(basic.dehaze, 0, -1, 1), vibrance: finite(basic.vibrance, 0, -1, 1),
      saturation: finite(basic.saturation, 0, -1, 1),
    },
    curve: {
      enabled: bool(curve.enabled, false),
      master: normalizeLut(curve.master, def.curve.master), r: normalizeLut(curve.r, def.curve.r),
      g: normalizeLut(curve.g, def.curve.g), b: normalizeLut(curve.b, def.curve.b),
      ...curveAuthoring,
    },
    detail: {
      sharpenAmount: finite(detail.sharpenAmount, 0, 0, 1), sharpenRadius: finite(detail.sharpenRadius, 1, 0, 3),
      nrStrength: finite(detail.nrStrength, 0, 0, 1), nrColor: finite(detail.nrColor, 0, 0, 1),
      nrDetail: finite(detail.nrDetail, 0, 0, 1),
    },
    effects: {
      grainAmount: finite(effects.grainAmount, 0, 0, 1), grainHighlight: finite(effects.grainHighlight, 0, 0, 1),
      grainIntensity: finite(effects.grainIntensity, 0, 0, 1), vignetteAmount: finite(effects.vignetteAmount, 0, -1, 1),
      vignetteMidpoint: finite(effects.vignetteMidpoint, 0.5, 0, 1),
    },
    optics: {
      distortion: finite(optics.distortion, 0, -1, 1), aberration: finite(optics.aberration, 0, 0, 1),
      defringe: finite(optics.defringe, 0, 0, 1),
      ...((asRecord(optics.lensProfile) || Object.keys(optics).some((key) => key === "enableProfileCorrections" || key.startsWith("profile"))) ? { lensProfile: normalizeLensSettings(optics.lensProfile ?? optics) } : {}),
    },
    hsl: { hue: normalizeBand(hsl.hue), sat: normalizeBand(hsl.sat), lum: normalizeBand(hsl.lum) },
    grade: {
      shadows: { hue: finite(shadows.hue, 0, 0, 360), sat: finite(shadows.sat, 0, 0, 1) },
      midtones: { hue: finite(midtones.hue, 0, 0, 360), sat: finite(midtones.sat, 0, 0, 1) },
      highlights: { hue: finite(highlights.hue, 0, 0, 360), sat: finite(highlights.sat, 0, 0, 1) },
    },
    geometry: {
      vertical: finite(geometry.vertical, 0, -1, 1), horizontal: finite(geometry.horizontal, 0, -1, 1),
      rotate: finite(geometry.rotate, 0, -1, 1),
    },
    profile: {
      id: cleanString(profile.id, 256, def.profile.id), name: cleanString(profile.name, 256, def.profile.name),
      kind: profileKind, amount: finite(profile.amount, 1, 0, 1),
      ...(typeof profile.digest === "string" && PROFILE_DIGEST_RE.test(profile.digest) ? { digest: profile.digest } : {}),
      ...(isAsShotKelvin(profile.asShotKelvin) ? { asShotKelvin: profile.asShotKelvin } : {}),
      ...(normalizeProfileSource(profile.sourceCamera) ? { sourceCamera: normalizeProfileSource(profile.sourceCamera) } : {}),
    },
    calibration: {
      shadowTint: finite(calibration.shadowTint, 0, -1, 1),
      red: normalizePrimary(calibration.red), green: normalizePrimary(calibration.green), blue: normalizePrimary(calibration.blue),
    },
    crop: {
      enabled: bool(crop.enabled, false), x, y, width, height,
      angle: finite(crop.angle, 0, -45, 45), constrainAspect: bool(crop.constrainAspect, false),
      ...(ratio > 0 ? { aspectRatio: ratio } : {}),
      flipHorizontal: bool(crop.flipHorizontal, false), flipVertical: bool(crop.flipVertical, false),
    },
    healSpots,
    masks,
    enhance: {
      denoise: bool(enhance.denoise, false), denoiseAmount: finite(enhance.denoiseAmount, 0, 0, 1),
      rawDetails: bool(enhance.rawDetails, false), superResolution: bool(enhance.superResolution, false),
    },
    pointColors,
  };
}

export function cloneCameraRawRecipe(recipe: CameraRawRecipe): CanonicalCameraRawRecipe {
  return normalizeCameraRawRecipe(recipe) ?? defaultRecipe();
}

/** ACR "Synchronize Settings": copy every develop group from `source` onto a
 *  `target` image, but KEEP the target's image-local fields — crop, spot
 *  removal, local masks, and Enhance — which are per-photo and must not be
 *  overwritten. Returns a fresh canonical recipe for the target. */
export function syncCameraRawRecipe(source: CameraRawRecipe, target: CameraRawRecipe): CanonicalCameraRawRecipe {
  const merged: CameraRawRecipe = {
    ...source,
    crop: target.crop,
    healSpots: target.healSpots,
    masks: target.masks,
    enhance: target.enhance,
  };
  return normalizeCameraRawRecipe(merged) ?? defaultRecipe();
}

function normalizeSmallNumberArray(value: unknown, maxLength: number, min: number, max: number): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const flattened: unknown[] = [];
  for (const entry of value) {
    if (Array.isArray(entry)) {
      for (const nested of entry) {
        if (flattened.length === maxLength) return undefined;
        flattened.push(nested);
      }
    } else {
      if (flattened.length === maxLength) return undefined;
      flattened.push(entry);
    }
  }
  return flattened.length ? flattened.map((entry) => finite(entry, 0, min, max)) : undefined;
}

/** Bounded RAW metadata normalization shared by project and sidecar decoders. */
export function normalizeCameraRawSourceMetadata(value: unknown): CameraRawSourceMetadata {
  const raw = section(value);
  const extraRaw = asRecord(raw.extra);
  const extra: Record<string, CameraRawMetadataScalar> = {};
  if (extraRaw) {
    let inspected = 0;
    for (const key in extraRaw) {
      if (!Object.prototype.hasOwnProperty.call(extraRaw, key)) continue;
      if (inspected++ >= 64) break;
      const entry = extraRaw[key];
      const cleanKey = cleanString(key, 64);
      if (!cleanKey) continue;
      if (typeof entry === "string") extra[cleanKey] = cleanString(entry, 512);
      else if (typeof entry === "boolean") extra[cleanKey] = entry;
      else if (typeof entry === "number" && Number.isFinite(entry)) extra[cleanKey] = entry;
    }
  }
  const first = (...values: unknown[]): unknown => values.find((entry) => entry !== undefined);
  const text = (key: string, max = 256) => cleanString(raw[key], max);
  const textAlias = (max: number, ...values: unknown[]) => cleanString(first(...values), max);
  const width = integer(first(raw.width, raw.outputWidth, raw.sourceWidth), 0, 0, 100_000);
  const height = integer(first(raw.height, raw.outputHeight, raw.sourceHeight), 0, 0, 100_000);
  const orientation = integer(raw.orientation, 0, 0, 8), iso = integer(raw.iso, 0, 0, 10_000_000);
  const exposureSeconds = finite(raw.exposureSeconds, 0, 0, 86_400);
  const aperture = finite(raw.aperture, 0, 0, 1024), focalLengthMm = finite(raw.focalLengthMm, 0, 0, 100_000);
  const focalLength35Mm = finite(raw.focalLength35Mm, 0, 0, 65_535), subjectDistanceM = finite(raw.subjectDistanceM, 0, 0, 1_000_000_000);
  const bitDepth = integer(raw.bitDepth, 0, 0, 64);
  const whiteBalance = normalizeSmallNumberArray(first(raw.whiteBalance, raw.wbCoefficients), 4, 0, 1_000_000);
  const blackLevels = normalizeSmallNumberArray(raw.blackLevels, 4, -1_000_000, 1_000_000);
  const whiteLevels = normalizeSmallNumberArray(raw.whiteLevels, 4, 0, 1_000_000_000);
  const colorMatrix1 = normalizeSmallNumberArray(first(raw.colorMatrix1, raw.xyzToCamera), 12, -1000, 1000);
  const colorMatrix2 = normalizeSmallNumberArray(first(raw.colorMatrix2, raw.cameraToXyz), 12, -1000, 1000);
  const addExtra = (key: string, candidate: unknown) => {
    if (extra[key] !== undefined) return;
    if (typeof candidate === "string") {
      const clean = cleanString(candidate, 512);
      if (clean) extra[key] = clean;
    } else if (typeof candidate === "number" && Number.isFinite(candidate)) extra[key] = candidate;
    else if (typeof candidate === "boolean") extra[key] = candidate;
  };
  addExtra("cleanMake", raw.cleanMake);
  addExtra("cleanModel", raw.cleanModel);
  addExtra("sourceWidth", raw.sourceWidth);
  addExtra("sourceHeight", raw.sourceHeight);
  addExtra("outputWidth", raw.outputWidth);
  addExtra("outputHeight", raw.outputHeight);
  addExtra("samplesPerPixel", raw.cpp);
  addExtra("sampleFormat", raw.sampleFormat);
  // A DNG's UniqueCameraModel and its own profile (#446): what Camera Raw ▸
  // Profile matches camera profiles against and offers as Embedded.
  addExtra("uniqueCameraModel", raw.uniqueCameraModel);
  if (isAsShotKelvin(raw.asShotKelvin)) addExtra("asShotKelvin", raw.asShotKelvin);
  const embedded = asRecord(raw.embeddedProfile);
  if (embedded && typeof embedded.digest === "string" && PROFILE_DIGEST_RE.test(embedded.digest)) {
    addExtra("embeddedProfileName", embedded.name);
    addExtra("embeddedProfileDigest", embedded.digest);
  }
  return {
    ...(textAlias(64, raw.format) ? { format: textAlias(64, raw.format) } : {}),
    ...(text("make") ? { make: text("make") } : {}), ...(text("model") ? { model: text("model") } : {}),
    ...(text("lens") ? { lens: text("lens") } : {}),
    ...(text("serialNumber") ? { serialNumber: text("serialNumber") } : {}),
    ...(text("capturedAt", 64) ? { capturedAt: text("capturedAt", 64) } : {}),
    ...(width > 0 ? { width } : {}), ...(height > 0 ? { height } : {}),
    ...(orientation > 0 ? { orientation } : {}), ...(iso > 0 ? { iso } : {}),
    ...(exposureSeconds > 0 ? { exposureSeconds } : {}), ...(aperture > 0 ? { aperture } : {}),
    ...(focalLengthMm > 0 ? { focalLengthMm } : {}), ...(bitDepth > 0 ? { bitDepth } : {}),
    ...(focalLength35Mm > 0 ? { focalLength35Mm } : {}), ...(subjectDistanceM > 0 ? { subjectDistanceM } : {}),
    ...(textAlias(64, raw.cfaPattern) ? { cfaPattern: textAlias(64, raw.cfaPattern) } : {}),
    ...(whiteBalance ? { whiteBalance } : {}), ...(blackLevels ? { blackLevels } : {}),
    ...(whiteLevels ? { whiteLevels } : {}), ...(colorMatrix1 ? { colorMatrix1 } : {}),
    ...(colorMatrix2 ? { colorMatrix2 } : {}), ...(Object.keys(extra).length ? { extra } : {}),
  };
}

// The source/snapshot lifecycle (normalizeCameraRawSource / normalizeCameraRawSnapshots
// / cloneCameraRawSource) migrates persisted recipes through the working-recipe
// normalizer, a higher-altitude concern that now lives in ./cameraRawSource so this
// flat codec never imports a runtime value from ./visionDevelopRecipe.

// ACR parametric-tone control points now live in the shared tone-curve module
// (this file carried a byte-identical duplicate). Re-exported so existing
// importers of `parametricCurvePoints` from ./cameraRaw are unchanged; Vision's
// ParametricCurve is structurally the shared ParametricRegions.
export { parametricCurvePoints } from "./toneCurve";

/** Compile the four channel point curves + master parametric into the recipe's
 *  256-entry LUTs. Parametric is composed after the master point curve — reuses
 *  the shared `masterToneLut` (paramLut ∘ pointLut) for the master channel. */
export function compileCurveLuts(
  pointsByChannel: readonly (readonly CurvePointLike[])[],
  parametric: ParametricCurve,
): Pick<CameraRawCurve, "master" | "r" | "g" | "b"> {
  return {
    master: Array.from(masterToneLut(pointsByChannel[0] ?? [], parametric)),
    r: Array.from(buildLut(pointsByChannel[1] ?? [])),
    g: Array.from(buildLut(pointsByChannel[2] ?? [])),
    b: Array.from(buildLut(pointsByChannel[3] ?? [])),
  };
}

/** Auto White Balance: measure the average colour cast of an RGBA byte buffer and
 *  return the {temp, tint} (each -1..1) that neutralises it. Inverts the engine's
 *  temp (R×(1+0.3t) / B×(1−0.3t)) and tint (G×(1+0.3t) / RB×(1−0.3t)) gain model
 *  so the mean red≈blue and mean green≈mean(red,blue). A starting point, not an
 *  exact joint solve (temp and tint interact) — like ACR's Auto WB. */
export function autoWhiteBalance(rgba: ArrayLike<number>): { temp: number; tint: number } {
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) { sr += rgba[i]; sg += rgba[i + 1]; sb += rgba[i + 2]; n++; }
  if (n === 0) return { temp: 0, tint: 0 };
  const mr = sr / n, mg = sg / n, mb = sb / n;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const temp = clamp((mb - mr) / (0.3 * Math.max(1e-4, mr + mb)));
  const mrb = (mr + mb) / 2;
  const tint = clamp((mrb - mg) / (0.3 * Math.max(1e-4, mg + mrb)));
  return { temp, tint };
}

/** Shadow/highlight clipping pixel counts for the ACR-style warning badges, over
 *  an RGBA byte buffer. A pixel clips highlights if any channel hits 255, shadows
 *  if any channel hits 0 (counted independently, alpha ignored). */
export function clippingCounts(rgba: ArrayLike<number>): { shadow: number; highlight: number } {
  let shadow = 0, highlight = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    if (r >= 255 || g >= 255 || b >= 255) highlight++;
    if (r <= 0 || g <= 0 || b <= 0) shadow++;
  }
  return { shadow, highlight };
}

/** Long-edge cap (device px) for the proxy preview engine — keeps the scratch
 *  engine near ~3.5 MP even on huge documents (Risks: ~2200px long edge). */
export function proxyMaxDim(viewW: number, viewH: number, dpr = 1): number {
  const longEdge = Math.max(viewW, viewH) * dpr;
  return Math.max(1, Math.min(2200, Math.round(longEdge)));
}
