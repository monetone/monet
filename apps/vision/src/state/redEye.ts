// Red Eye tool option helpers (pure; engine-free, node-safe).
//
// Photoshop's Red Eye tool has two options — Pupil Size (the area/sensitivity)
// and Darken Amount (how dark the corrected pupil) — both 0..100%, default 50%.
// Vision stores them as 0..1 and the engine's remove_red_eye takes them as 0..255.

export const REDEYE_PUPIL_DEFAULT = 0.5;
export const REDEYE_DARKEN_DEFAULT = 0.5;

/** Clamp a value into the 0..1 unit range (NaN → 0; ±Infinity clamp to the bounds). */
export function clampUnit(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** Convert the 0..1 Pupil Size / Darken Amount options to the engine's 0..255 args. */
export function redEyeArgs(pupil: number, darken: number): { pupil: number; darken: number } {
  return {
    pupil: Math.round(clampUnit(pupil) * 255),
    darken: Math.round(clampUnit(darken) * 255),
  };
}
