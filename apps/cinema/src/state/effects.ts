// ─────────────────────────────────────────────────────────────
// effects.ts — the bridge between the TS ColorGrade model and the engine's
// flat f32 Lumetri param block. The slot layout MUST match engine/src/color.rs
// (COLOR_PARAMS_LEN + the P_* indices). Unit-tested for slot agreement.
// ─────────────────────────────────────────────────────────────

import {
  MAX_CUBE_LUT_IMPORT_BYTES,
  parse3dlLut,
  parseCubeLut,
  type CubeLut,
} from "@monet-ui/monet-photo";
import type { ClipLut, ColorGrade } from "../timeline/model/types";

export const COLOR_PARAMS_LEN = 16;

// Slot indices — keep in lockstep with engine/src/color.rs.
export const P_ENABLED = 0;
export const P_EXPOSURE = 1;
export const P_CONTRAST = 2;
export const P_SATURATION = 3;
export const P_TEMPERATURE = 4;
export const P_TINT = 5;
export const P_HIGHLIGHTS = 6;
export const P_SHADOWS = 7;
export const P_WHITES = 8;
export const P_BLACKS = 9;
export const P_VIBRANCE = 10;
export const P_HUE = 11;
export const P_GAMMA = 12;
export const P_LIFT = 13;
export const P_GAIN = 14;
export const P_LUT_MIX = 15; // creative-LUT blend, 0..1 (0 = no LUT)

/** Pack a ColorGrade into the engine's f32 param block. */
export function gradeToParams(g: ColorGrade): Float32Array {
  const p = new Float32Array(COLOR_PARAMS_LEN);
  p[P_ENABLED] = g.enabled ? 1 : 0;
  p[P_EXPOSURE] = g.exposure;
  p[P_CONTRAST] = g.contrast;
  p[P_SATURATION] = g.saturation;
  p[P_TEMPERATURE] = g.temperature;
  p[P_TINT] = g.tint;
  p[P_HIGHLIGHTS] = g.highlights;
  p[P_SHADOWS] = g.shadows;
  p[P_WHITES] = g.whites;
  p[P_BLACKS] = g.blacks;
  p[P_VIBRANCE] = g.vibrance;
  p[P_HUE] = g.hue;
  p[P_GAMMA] = g.gamma;
  p[P_LIFT] = g.lift;
  p[P_GAIN] = g.gain;
  p[P_LUT_MIX] = g.lut ? clamp01(g.lut.intensity) : 0;
  return p;
}

// ── Creative Look (3D LUT) ────────────────────────────────────
// Cinema stores the `.cube`/`.3dl` SOURCE TEXT on the clip; the parsed lattice
// is a derived render cache. Parsing is shared with Vision/Galerie via
// @monet-ui/monet-photo, so a LUT authored (or exported) in any Monet app
// lands here byte-identically.

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

// ponytail: unbounded, keyed by the source text — one entry per distinct LUT in
// the project, which is a handful. Swap for an LRU if a project ever holds
// hundreds of distinct looks.
const lutCache = new Map<string, CubeLut | null>();

/** Parse a clip's LUT text (memoised) → the lattice, or null if unusable.
 *  Returns the SAME object for the same text, so callers can dedupe uploads by
 *  identity. */
export function resolveLut(lut: ClipLut | undefined): CubeLut | null {
  if (!lut?.text) return null;
  let parsed = lutCache.get(lut.text);
  if (parsed === undefined) {
    parsed = parseCubeLut(lut.text) ?? parse3dlLut(lut.text);
    lutCache.set(lut.text, parsed);
  }
  return parsed;
}

/** Build a clip LUT from an imported file. Null when the text isn't a usable 3D
 *  LUT — the caller reports that loudly rather than attaching a dead look. */
export function makeClipLut(name: string, text: string): ClipLut | null {
  if (!resolveLut({ name, text, intensity: 1 })) return null;
  return { name: name || "LUT", text, intensity: 1 };
}

/** Trust boundary: a `.monet` is untrusted input, and `data.cinema` is ours to
 *  normalise. Keep the text verbatim (it may parse in a newer build) but pin the
 *  shape and bound the size, so nothing absurd reaches the parser or the engine. */
export function sanitizeClipLut(v: unknown): ClipLut | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { name, text, intensity } = v as Partial<ClipLut>;
  if (typeof text !== "string" || !text || text.length > MAX_CUBE_LUT_IMPORT_BYTES) return undefined;
  return {
    name: typeof name === "string" && name ? name : "LUT",
    text,
    intensity: typeof intensity === "number" && Number.isFinite(intensity) ? clamp01(intensity) : 1,
  };
}

/** True if the grade would change pixels (enabled with any non-neutral term). */
export function gradeIsActive(g: ColorGrade): boolean {
  if (!g.enabled) return false;
  if (g.lut && g.lut.intensity > 0) return true;
  return (
    g.exposure !== 0 ||
    g.contrast !== 0 ||
    g.saturation !== 0 ||
    g.temperature !== 0 ||
    g.tint !== 0 ||
    g.highlights !== 0 ||
    g.shadows !== 0 ||
    g.whites !== 0 ||
    g.blacks !== 0 ||
    g.vibrance !== 0 ||
    g.hue !== 0 ||
    g.gamma !== 1 ||
    g.lift !== 0 ||
    g.gain !== 1
  );
}
