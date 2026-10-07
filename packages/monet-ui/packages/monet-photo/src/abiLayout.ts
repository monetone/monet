// Shared flat-params ABI layout for the develop engine's 1086-float prefix + the
// advanced-tail sentinel. Vision's Camera Raw codec (apps/vision/state/cameraRaw)
// and this package's developParams codec BOTH serialize into the SAME wasm
// `camera_raw_develop(&[f32])` ABI, so these offsets MUST agree byte-for-byte.
// Defining them ONCE here is the first unification of the two develop codecs
// (docs/plans/10 Phase 5): a drift here would silently corrupt one app's develop.
//
// The frozen 1086 prefix layout:
//   [0]     version           [1]     proxyScale
//   [2..14] Basic (13)        [15..19] Detail (5)     [20..24] Effects (5)
//   [25]    curveEnabled      [26..1049] 4×256 curve LUTs (master,r,g,b)
//   [1050..1052] Optics       [1053..1076] HSL bands (8×3)
//   [1077..1082] Color Grading (3×2)        [1083..1085] Geometry
// The optional advanced tail (profile/calibration/crop/heal/masks/pointColor/…)
// begins at [1086], gated by the DEV_ADVANCED_MAGIC sentinel.
export const CURVE_BASE = 26;
export const CURVE_END = CURVE_BASE + 4 * 256; // 1050 — Optics params begin here
export const OPTICS_END = CURVE_END + 3; // 1053 — HSL band params begin here
export const HSL_END = OPTICS_END + 3 * 8; // 1077 — Color Grading params begin here
export const GRADE_END = HSL_END + 3 * 2; // 1083 — Geometry params begin here

/** Exact prefix length `develop_buf` parses: 1083 (…+Grade) + 3 Geometry = 1086. */
export const DEVELOP_PARAMS_LEN = GRADE_END + 3;

/** Advanced-tail sentinel written at [1086] when a non-neutral tail is present. */
export const DEV_ADVANCED_MAGIC = 22026;
