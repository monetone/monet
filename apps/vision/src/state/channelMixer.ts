// ─────────────────────────────────────────────────────────────
// Channel Mixer (Image ▸ Adjustments ▸ Channel Mixer) — pure matrix building.
//
// Rebuilds each output channel (R/G/B) as a weighted sum of the source channels
// plus a flat constant, with a Monochrome mode and the classic black-and-white
// film presets. Engine-free so it unit-tests in node; the dialog packs the state
// to the engine's 12-float matrix:
//   • direct adjustment → `adjust_channel_mixer` (3×4 matrix);
//   • kind-14 adjustment layer → `Float32Array(12)`, each output clamped to [0,1].
// Layout (both): `[r,g,b,const] × 3` rows, row o producing output channel o, where
// weights are fractions (1.0 = 100%) — so this MUST match `adjust.rs channel_mixer`
// / `pixel_adjust.rs` kind 14. Mirrors `gradientMap.ts` / `toneCurve.ts`.
//
// State is kept in Photoshop's UI units (percent) so presets read like the docs and
// a Total% readout is natural; `packMixer` divides by 100 on the way to the engine.
// ─────────────────────────────────────────────────────────────

/** One output channel's recipe, in Photoshop percent units: how much of each
 *  source channel contributes, plus a flat constant. */
export interface MixerRow {
  red: number;
  green: number;
  blue: number;
  constant: number;
}

/** Output channel: 0 = Red, 1 = Green, 2 = Blue. */
export type OutputChannel = 0 | 1 | 2;

export interface ChannelMixerState {
  /** Monochrome ⇒ all three outputs use the single `gray` recipe (result is gray). */
  monochrome: boolean;
  red: MixerRow; // output R (colour mode)
  green: MixerRow; // output G (colour mode)
  blue: MixerRow; // output B (colour mode)
  gray: MixerRow; // the recipe used in monochrome mode
}

export const MIXER_OUTPUTS = [
  { value: 0, label: "Red" },
  { value: 1, label: "Green" },
  { value: 2, label: "Blue" },
] as const;

// Photoshop slider ranges (percent).
export const SOURCE_MIN = -200;
export const SOURCE_MAX = 200;
export const CONST_MIN = -100;
export const CONST_MAX = 100;

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** The identity recipe for an output channel: 100% of its own source, nothing else. */
export function identityRow(ch: OutputChannel): MixerRow {
  return {
    red: ch === 0 ? 100 : 0,
    green: ch === 1 ? 100 : 0,
    blue: ch === 2 ? 100 : 0,
    constant: 0,
  };
}

// Photoshop's default Monochrome mix (sums to 100%).
export const DEFAULT_GRAY: MixerRow = { red: 40, green: 40, blue: 20, constant: 0 };

/** A fresh, no-op Channel Mixer state (identity per channel, colour mode). */
export function defaultMixer(): ChannelMixerState {
  return {
    monochrome: false,
    red: identityRow(0),
    green: identityRow(1),
    blue: identityRow(2),
    gray: { ...DEFAULT_GRAY },
  };
}

// The colour-mode row for an output channel.
function colourRow(state: ChannelMixerState, output: OutputChannel): MixerRow {
  return output === 0 ? state.red : output === 1 ? state.green : state.blue;
}

/** The recipe currently being edited: the gray recipe in monochrome mode, else the
 *  selected output channel's row. */
export function activeRow(state: ChannelMixerState, output: OutputChannel): MixerRow {
  return state.monochrome ? state.gray : colourRow(state, output);
}

/** Photoshop's "Total" readout for a row: the sum of its three source %s (the
 *  constant is excluded, matching Photoshop). 100% preserves overall brightness. */
export function channelTotal(row: MixerRow): number {
  return row.red + row.green + row.blue;
}

// Clamp a field to its Photoshop range (constant is ±100, sources ±200).
function clampField(field: keyof MixerRow, value: number): number {
  return field === "constant" ? clamp(value, CONST_MIN, CONST_MAX) : clamp(value, SOURCE_MIN, SOURCE_MAX);
}

/** Immutably set one field of the active recipe (gray in monochrome, else the
 *  selected output row), clamped to Photoshop's ranges. */
export function setRowField(
  state: ChannelMixerState,
  output: OutputChannel,
  field: keyof MixerRow,
  value: number,
): ChannelMixerState {
  const v = clampField(field, value);
  if (state.monochrome) return { ...state, gray: { ...state.gray, [field]: v } };
  const key = output === 0 ? "red" : output === 1 ? "green" : "blue";
  return { ...state, [key]: { ...state[key], [field]: v } };
}

/** Pack to the engine's `Float32Array(12)` = `[r,g,b,const] × 3` in fractions.
 *  In monochrome mode every output row uses the gray recipe so the result is gray. */
export function packMixer(state: ChannelMixerState): Float32Array {
  const rows = state.monochrome
    ? [state.gray, state.gray, state.gray]
    : [state.red, state.green, state.blue];
  const out = new Float32Array(12);
  for (let o = 0; o < 3; o++) {
    const row = rows[o];
    out[o * 4] = row.red / 100;
    out[o * 4 + 1] = row.green / 100;
    out[o * 4 + 2] = row.blue / 100;
    out[o * 4 + 3] = row.constant / 100;
  }
  return out;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Apply the mix to an 8-bit pixel exactly as the engine does: normalise, apply the
 *  matrix, clamp each output to [0,1], back to 8-bit. For tests / previews without
 *  WASM. */
export function applyChannelMixer(state: ChannelMixerState, r: number, g: number, b: number): Rgb {
  const m = packMixer(state);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const out = (o: number) => clamp01(m[o * 4] * rn + m[o * 4 + 1] * gn + m[o * 4 + 2] * bn + m[o * 4 + 3]);
  return { r: Math.round(out(0) * 255), g: Math.round(out(1) * 255), b: Math.round(out(2) * 255) };
}

export interface MixerPreset {
  name: string;
  gray: MixerRow;
}

// Photoshop's Channel Mixer monochrome presets (the classic B&W film looks). Each
// gray recipe sums to 100% so overall brightness is preserved.
export const MONOCHROME_PRESETS: readonly MixerPreset[] = [
  { name: "Black & White Infrared", gray: { red: -70, green: 200, blue: -30, constant: 0 } },
  { name: "Black & White with Blue Filter", gray: { red: 0, green: 0, blue: 100, constant: 0 } },
  { name: "Black & White with Green Filter", gray: { red: 0, green: 100, blue: 0, constant: 0 } },
  { name: "Black & White with Orange Filter", gray: { red: 50, green: 50, blue: 0, constant: 0 } },
  { name: "Black & White with Red Filter", gray: { red: 100, green: 0, blue: 0, constant: 0 } },
  { name: "Black & White with Yellow Filter", gray: { red: 34, green: 66, blue: 0, constant: 0 } },
];

/** Apply a monochrome preset by name: switches to Monochrome and loads its gray
 *  recipe. Unknown names leave the state unchanged. */
export function applyMonochromePreset(state: ChannelMixerState, name: string): ChannelMixerState {
  const preset = MONOCHROME_PRESETS.find((p) => p.name === name);
  if (!preset) return state;
  return { ...state, monochrome: true, gray: { ...preset.gray } };
}
