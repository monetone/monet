// Image ▸ Mode ▸ Indexed Color / Bitmap and Image ▸ Adjustments ▸
// Shadows/Highlights reopen with the values their last OK used (#442), the way
// Select and Mask (samSettings) and Save for Web (webExportPrefs) do. They live
// in localStorage, so a stale or hand-edited blob is coerced field by field back
// onto the dialog's own ranges, and anything unreadable is Photoshop's default.

export const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
const int = (v: unknown, lo: number, hi: number, fallback: number) => Math.round(num(v, lo, hi, fallback));
export const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

export interface IndexedColorPrefs {
  palette: number; // Palette menu index, Exact … Previous (6 Adaptive)
  colors: number; // 2..256
  forced: number; // Forced menu index, None … Web
  dither: boolean;
  transparency: boolean;
  matte: string; // #rrggbb
  custom: string[]; // Palette ▸ Custom's loaded .act, #rrggbb
}

export const INDEXED_COLOR_DEFAULTS: IndexedColorPrefs = {
  palette: 6, colors: 256, forced: 0, dither: true, transparency: true, matte: "#ffffff", custom: [],
};

export function normalizeIndexedColorPrefs(raw: unknown): IndexedColorPrefs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = INDEXED_COLOR_DEFAULTS;
  return {
    palette: int(r.palette, 0, 8, d.palette),
    colors: int(r.colors, 2, 256, d.colors),
    forced: int(r.forced, 0, 3, d.forced),
    dither: bool(r.dither, d.dither),
    transparency: bool(r.transparency, d.transparency),
    matte: isHex(r.matte) ? r.matte : d.matte,
    custom: Array.isArray(r.custom) ? r.custom.filter(isHex).slice(0, 256) : d.custom,
  };
}

/** The highest Output resolution the engine will stamp — a PSD's ceiling. */
export const BITMAP_MAX_OUTPUT_PPI = 65_535;

export interface BitmapPrefs {
  method: number; // 0 threshold … 4 custom pattern
  output: number; // ppi; 0 = the document's own resolution, whatever it is
  frequency: number; // lpi
  angle: number; // degrees
  shape: number; // Halftone Screen shape index, Round … Cross
}

export const BITMAP_DEFAULTS: BitmapPrefs = { method: 1, output: 0, frequency: 53, angle: 45, shape: 0 };

export function normalizeBitmapPrefs(raw: unknown): BitmapPrefs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = BITMAP_DEFAULTS;
  const output = num(r.output, 0, BITMAP_MAX_OUTPUT_PPI, d.output);
  return {
    method: int(r.method, 0, 4, d.method),
    output: output >= 1 ? output : 0,
    frequency: num(r.frequency, 1, 999, d.frequency),
    angle: num(r.angle, -180, 180, d.angle),
    shape: int(r.shape, 0, 5, d.shape),
  };
}

/** In the dialog's own units: percentages, radii in px. */
export interface ShadowsHighlightsPrefs {
  shadowsAmount: number;
  shadowsWidth: number;
  shadowsRadius: number;
  highlightsAmount: number;
  highlightsWidth: number;
  highlightsRadius: number;
  color: number;
  midtone: number;
  blackClip: number;
  whiteClip: number;
}

export const SHADOWS_HIGHLIGHTS_DEFAULTS: ShadowsHighlightsPrefs = {
  shadowsAmount: 35, shadowsWidth: 50, shadowsRadius: 30,
  highlightsAmount: 0, highlightsWidth: 50, highlightsRadius: 30,
  color: 20, midtone: 0, blackClip: 0.01, whiteClip: 0.01,
};

export function normalizeShadowsHighlightsPrefs(raw: unknown): ShadowsHighlightsPrefs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = SHADOWS_HIGHLIGHTS_DEFAULTS;
  return {
    shadowsAmount: num(r.shadowsAmount, 0, 100, d.shadowsAmount),
    shadowsWidth: num(r.shadowsWidth, 1, 100, d.shadowsWidth),
    shadowsRadius: num(r.shadowsRadius, 0, 2500, d.shadowsRadius),
    highlightsAmount: num(r.highlightsAmount, 0, 100, d.highlightsAmount),
    highlightsWidth: num(r.highlightsWidth, 1, 100, d.highlightsWidth),
    highlightsRadius: num(r.highlightsRadius, 0, 2500, d.highlightsRadius),
    color: num(r.color, -100, 100, d.color),
    midtone: num(r.midtone, -100, 100, d.midtone),
    blackClip: num(r.blackClip, 0, 50, d.blackClip),
    whiteClip: num(r.whiteClip, 0, 50, d.whiteClip),
  };
}

function load<T>(key: string, normalize: (raw: unknown) => T): T {
  try {
    return normalize(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch { return normalize(null); }
}
function save<T>(key: string, normalize: (raw: unknown) => T, value: T) {
  try { localStorage.setItem(key, JSON.stringify(normalize(value))); } catch { /* storage denied */ }
}

export const loadIndexedColorPrefs = () => load("mv.indexedColor", normalizeIndexedColorPrefs);
export const saveIndexedColorPrefs = (p: IndexedColorPrefs) => save("mv.indexedColor", normalizeIndexedColorPrefs, p);
export const loadBitmapPrefs = () => load("mv.bitmap", normalizeBitmapPrefs);
/** Photoshop seeds Output from the document, so an Output left at the
 *  document's own ppi is remembered as "the document's" (0), not as a number
 *  that would resample the next document to it. */
export const saveBitmapPrefs = (p: BitmapPrefs, documentPpi: number) =>
  save("mv.bitmap", normalizeBitmapPrefs, { ...p, output: p.output === documentPpi ? 0 : p.output });
/** The Output resolution the Bitmap dialog opens on for a `documentPpi` document. */
export const bitmapOutputFor = (p: BitmapPrefs, documentPpi: number) => p.output || documentPpi;
export const loadShadowsHighlightsPrefs = () => load("mv.shadowsHighlights", normalizeShadowsHighlightsPrefs);
export const saveShadowsHighlightsPrefs = (p: ShadowsHighlightsPrefs) => save("mv.shadowsHighlights", normalizeShadowsHighlightsPrefs, p);
