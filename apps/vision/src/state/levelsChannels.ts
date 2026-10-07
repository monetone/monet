// Pure helpers for the Levels dialog's per-channel (RGB/Red/Green/Blue) editing.
// Engine-free so the param packing unit-tests in node; the dialog feeds the packed
// arrays to engine adjust_levels_multi (composite + per-channel in one pass).
export type LevelsParams = { ib: number; iw: number; gamma: number; ob: number; ow: number };

// The Levels Channel dropdown: 0 = RGB (composite), 1/2/3 = Red/Green/Blue.
export const LEVELS_CHANNELS = [
  { value: 0, label: "RGB" },
  { value: 1, label: "Red" },
  { value: 2, label: "Green" },
  { value: 3, label: "Blue" },
] as const;

// Identity Levels (no change): full input range, gamma 1, full output range.
export const defaultLevels = (): LevelsParams => ({ ib: 0, iw: 255, gamma: 1, ob: 0, ow: 255 });

// Pack a channel's params to the engine's [in_black, in_white, gamma, out_black,
// out_white] array (0..1 except gamma) for adjust_levels_multi.
export function packLevels(p: LevelsParams): Float32Array {
  return new Float32Array([p.ib / 255, p.iw / 255, p.gamma, p.ob / 255, p.ow / 255]);
}

// ─────────────────────────────────────────────────────────────
// Levels transfer function — the actual per-channel transform the engine applies,
// mirrored here so it unit-tests in node (the dialog feeds packLevels to the engine
// for the live render; this is the testable reference / preview math).
// ─────────────────────────────────────────────────────────────

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Round-half-up to 8-bit (matches the engine's `to8` helper). Note the engine's
// adjustment pipeline actually stores u16 and reads 8-bit back via `>>8`, which can
// differ from this by ≤1 LSB on ~9% of values — invisible in the engine-driven
// render; this is the preview/test reference.
const byte = (n: number): number => Math.round(clamp01(n) * 255);

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The Levels transfer on a normalised channel (0..1 in/out). Exact mirror of
 *  `adjust.rs levels_one`: clip to the input range, apply gamma, remap to the
 *  output range. `ib`/`iw`/`ob`/`ow` are 0..1; `gamma` as-is (guarded ≥1e-4, as is
 *  the input span). */
export function levelsTransfer(
  c: number,
  ib: number,
  iw: number,
  gamma: number,
  ob: number,
  ow: number,
): number {
  const inv = Math.max(iw - ib, 1e-4);
  const v = Math.pow(clamp01((c - ib) / inv), 1 / Math.max(gamma, 1e-4));
  return ob + v * (ow - ob);
}

// The transfer for one channel's params (0..255 units → normalised internally).
function transfer(c01: number, p: LevelsParams): number {
  return levelsTransfer(c01, p.ib / 255, p.iw / 255, p.gamma, p.ob / 255, p.ow / 255);
}

/** Apply one channel's {@link LevelsParams} to an 8-bit value → 8-bit. */
export function applyLevelsChannel(value: number, p: LevelsParams): number {
  return byte(transfer(value / 255, p));
}

/** Apply one params set to all channels of an 8-bit pixel (the composite-only /
 *  kind-1 single-channel adjustment). */
export function applyLevels(p: LevelsParams, r: number, g: number, b: number): Rgb {
  return { r: applyLevelsChannel(r, p), g: applyLevelsChannel(g, p), b: applyLevelsChannel(b, p) };
}

/** Apply composite levels (to every channel) then the per-channel levels, in one
 *  pass — exact mirror of the engine's `levels_multi`. The two transfers compose in
 *  normalised space (rounded to 8-bit only at the end), so it is not the same as
 *  rounding between them. */
export function applyLevelsMulti(
  comp: LevelsParams,
  red: LevelsParams,
  grn: LevelsParams,
  blu: LevelsParams,
  r: number,
  g: number,
  b: number,
): Rgb {
  const ch = (v: number, per: LevelsParams) => byte(transfer(transfer(v / 255, comp), per));
  return { r: ch(r, red), g: ch(g, grn), b: ch(b, blu) };
}
