// Black & White (Image ▸ Adjustments ▸ Black & White). The UI uses Photoshop's
// six hue bands in percent; the engine receives the same values normalised to
// 0..1, followed by optional Tint hue/saturation.

import { hslToRgb, rgbToHsl, type Rgb } from "./hueSaturation";

export const BLACK_WHITE_BANDS = ["Reds", "Yellows", "Greens", "Cyans", "Blues", "Magentas"] as const;
export const BLACK_WHITE_MIN = -200;
export const BLACK_WHITE_MAX = 300;
export const BW_PARAMS = 12;
export const DEFAULT_BLACK_WHITE_BANDS = [40, 60, 40, 60, 20, 80] as const;

export interface BlackWhiteState {
  /** Multiplier for the achromatic base. New six-band adjustments use 1;
   *  migrated legacy RGB weights retain their exact neutral response. */
  neutral: number;
  bands: number[];
  tint: boolean;
  tintHue: number;
  tintSaturation: number;
}

export interface BlackWhitePreset {
  name: string;
  bands: readonly number[];
}

// Photoshop-compatible named starting points. Default is separate so Auto and
// Reset can share the same neutral mix.
export const BLACK_WHITE_PRESETS: readonly BlackWhitePreset[] = [
  { name: "Default", bands: DEFAULT_BLACK_WHITE_BANDS },
  { name: "Blue Filter", bands: [30, 30, 30, 50, 100, 70] },
  { name: "Darker", bands: [30, 50, 30, 50, 10, 70] },
  { name: "Green Filter", bands: [30, 70, 100, 60, 20, 70] },
  { name: "High Contrast Blue Filter", bands: [-10, 20, 30, 70, 110, 50] },
  { name: "High Contrast Red Filter", bands: [120, 70, 20, 30, -10, 70] },
  { name: "Infrared", bands: [-40, 200, -40, 60, 20, 80] },
  { name: "Lighter", bands: [50, 70, 50, 70, 30, 90] },
  { name: "Maximum Black", bands: [-100, -100, -100, -100, -100, -100] },
  { name: "Maximum White", bands: [200, 200, 200, 200, 200, 200] },
  { name: "Neutral Density", bands: [33, 33, 33, 33, 33, 33] },
  { name: "Red Filter", bands: [100, 70, 20, 30, 0, 90] },
  { name: "Yellow Filter", bands: [80, 100, 40, 60, 20, 70] },
];

export function defaultBlackWhite(): BlackWhiteState {
  return { neutral: 1, bands: [...DEFAULT_BLACK_WHITE_BANDS], tint: false, tintHue: 40, tintSaturation: 20 };
}

export function applyBlackWhitePreset(state: BlackWhiteState, name: string): BlackWhiteState {
  const preset = BLACK_WHITE_PRESETS.find((entry) => entry.name === name);
  return preset ? { ...state, neutral: 1, bands: [...preset.bands] } : state;
}

/** Auto's balanced mix. It is deliberately the documented neutral baseline,
 * so it is deterministic for destructive edits and adjustment layers alike. */
export function autoBlackWhite(state: BlackWhiteState): BlackWhiteState {
  return { ...state, neutral: 1, bands: [...DEFAULT_BLACK_WHITE_BANDS] };
}

export function blackWhitePresetName(state: BlackWhiteState): string {
  if (Math.abs(state.neutral - 1) >= 1e-3) return "Custom";
  return BLACK_WHITE_PRESETS.find((preset) => preset.bands.every((value, i) => Math.abs(value - (state.bands[i] ?? 0)) < 1e-3))?.name ?? "Custom";
}

export function packBlackWhite(state: BlackWhiteState): Float32Array {
  const out = new Float32Array(BW_PARAMS);
  out[0] = state.neutral;
  for (let i = 0; i < BLACK_WHITE_BANDS.length; i++) out[3 + i] = (state.bands[i] ?? 0) / 100;
  out[9] = state.tint ? 1 : 0;
  out[10] = state.tintHue;
  out[11] = state.tintSaturation / 100;
  return out;
}

/** Read a widened block or migrate a legacy RGB-weight block. The hidden
 * neutral coefficient plus six bands reproduce the legacy result exactly. */
export function unpackBlackWhite(params: ArrayLike<number>): BlackWhiteState {
  if (params.length >= BW_PARAMS) {
    return {
      neutral: params[0] ?? 1,
      bands: BLACK_WHITE_BANDS.map((_, i) => (params[3 + i] ?? 0) * 100),
      tint: (params[9] ?? 0) > 0.5,
      tintHue: params[10] ?? 0,
      tintSaturation: (params[11] ?? 0) * 100,
    };
  }
  const red = params[0] ?? 0;
  const green = params[1] ?? 0;
  const blue = params[2] ?? 0;
  const rawSum = red + green + blue;
  const sum = Math.max(Math.abs(rawSum), 1e-4);
  return {
    neutral: rawSum / sum,
    bands: [red, red + green, green, green + blue, blue, blue + red].map((value) => value / sum * 100),
    tint: false,
    tintHue: 40,
    tintSaturation: 20,
  };
}

function hueBlend(hue: number): [number, number, number] {
  const x = ((hue % 360) + 360) % 360 / 60;
  const first = Math.floor(x) % 6;
  return [first, (first + 1) % 6, x - Math.floor(x)];
}

/** Pure pixel reference for tests; mirrors `adjust.rs black_white_pixel`. */
export function applyBlackWhite(state: BlackWhiteState, r: number, g: number, b: number): Rgb {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const min = Math.min(rn, gn, bn);
  const chroma = Math.max(rn, gn, bn) - min;
  const [i, j, t] = hueBlend(rgbToHsl(rn, gn, bn).h);
  const gray = Math.max(0, Math.min(1, min * state.neutral + chroma * ((1 - t) * (state.bands[i] ?? 0) + t * (state.bands[j] ?? 0)) / 100));
  if (!state.tint) {
    const value = Math.round(gray * 255);
    return { r: value, g: value, b: value };
  }
  const out = hslToRgb(state.tintHue, Math.max(0, Math.min(1, state.tintSaturation / 100)), gray);
  return { r: Math.round(out.r * 255), g: Math.round(out.g * 255), b: Math.round(out.b * 255) };
}
