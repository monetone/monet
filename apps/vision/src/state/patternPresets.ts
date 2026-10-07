// ─────────────────────────────────────────────────────────────
// Pattern presets — the named Patterns library behind Edit ▸ Define Pattern and
// every pattern consumer (Edit ▸ Fill ▸ Pattern, the Pattern Stamp, Pattern Fill
// layers, the Pattern Overlay layer style). The engine keeps exactly ONE active
// tile; this library keeps the named tiles and pushes the picked one into that
// slot — the same shape brushTips.ts uses to drive the engine's single
// brush-tip slot. A pattern fill layer copies the slot into its own smart_src,
// so two layers in one document can hold different patterns.
// Persisted (unlike brush tips) because a pattern is authored content, not a
// tool setting. These helpers are engine-free so they unit-test in node; the
// Store delegates to them.
// ─────────────────────────────────────────────────────────────

export interface PatternPreset {
  name: string;
  w: number;
  h: number;
  px: Uint16Array; // w·h·4 straight-alpha RGBA16 — the engine's tile layout
}

/** Persisted-tile sanity bound. A tile is a captured selection, so it can be as
 *  large as a document; this only has to stop a corrupt entry from claiming an
 *  absurd allocation before the length check runs. */
const MAX_PATTERN_SIDE = 16384;

/** Per-tile ceiling for the LAYER STYLE library push, in texels. A tile is a
 *  captured selection, so it can be document-sized; a style samples it at a
 *  zoom, and copying a 40-megapixel tile into the engine for a drop shadow is
 *  not a trade worth making. Over-sized tiles are pushed as empty slots and
 *  render as the procedural checker.
 *  ponytail: raise it (or downsample the tile) if real work hits the wall. */
export const MAX_STYLE_PATTERN_TEXELS = 1024 * 1024;

/** Ceiling for the whole push, mirroring the engine's own guard. */
export const MAX_STYLE_PATTERN_LIBRARY_TEXELS = 4 * 1024 * 1024;

/** Whether a tile is small enough to be pushed as a layer-style pattern. */
export function fitsStylePattern(p: { w: number; h: number }): boolean {
  return p.w * p.h <= MAX_STYLE_PATTERN_TEXELS;
}

/** Flatten the library into the (pixels, widths, heights, ids) arrays the
 *  engine's `set_style_patterns` takes — wasm-bindgen cannot pass a nested
 *  array. Every pattern keeps a slot so its id stays addressable; one that is
 *  too large (or that would overflow the budget) is sent as an empty 0×0 tile,
 *  which the engine renders as the checker rather than as another pattern. */
export function flattenStylePatterns(
  library: readonly PatternPreset[],
  idOf: (name: string) => number,
): { flat: Uint16Array; widths: Uint32Array; heights: Uint32Array; ids: Int32Array } {
  const send = library.map((p) => fitsStylePattern(p) && p.px.length >= p.w * p.h * 4);
  let budget = MAX_STYLE_PATTERN_LIBRARY_TEXELS;
  library.forEach((p, i) => {
    if (!send[i]) return;
    if (p.w * p.h > budget) { send[i] = false; return; }
    budget -= p.w * p.h;
  });
  const total = library.reduce((n, p, i) => n + (send[i] ? p.w * p.h * 4 : 0), 0);
  const flat = new Uint16Array(total);
  const widths = new Uint32Array(library.length);
  const heights = new Uint32Array(library.length);
  const ids = new Int32Array(library.length);
  let at = 0;
  library.forEach((p, i) => {
    ids[i] = idOf(p.name);
    if (!send[i]) return;
    widths[i] = p.w;
    heights[i] = p.h;
    flat.set(p.px.subarray(0, p.w * p.h * 4), at);
    at += p.w * p.h * 4;
  });
  return { flat, widths, heights, ids };
}

/** The next "Pattern N" name, one past the highest existing "Pattern <int>"
 *  (Photoshop-like auto-numbering); names not of that form are ignored. */
export function defaultPatternName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Pattern (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Pattern ${max + 1}`;
}

/** Append a pattern; one whose name is already present is a same-ref no-op. */
export function addPatternTo(list: PatternPreset[], p: PatternPreset): PatternPreset[] {
  if (list.some((q) => q.name === p.name)) return list;
  return [...list, p];
}

/** Remove the pattern at index `i`; out-of-range is a same-ref no-op. */
export function removePatternAt(list: PatternPreset[], i: number): PatternPreset[] {
  if (i < 0 || i >= list.length) return list;
  return list.filter((_, j) => j !== i);
}

// ── persistence ──────────────────────────────────────────────────────────────
// Texels ride as base64 of the raw u16 buffer: JSON numbers would be ~6× larger
// and localStorage is quota-bound. Host byte order on both ends (one machine,
// one browser profile), so no endianness swap.

function u16ToB64(px: Uint16Array): string {
  const bytes = new Uint8Array(px.buffer, px.byteOffset, px.byteLength);
  let bin = "";
  const CHUNK = 0x8000; // spread() blows the arg limit on a whole tile
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function b64ToU16(b64: string): Uint16Array | null {
  const bin = atob(b64); // throws on malformed input — the caller catches
  if (bin.length % 2) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint16Array(bytes.buffer);
}

export function serializePatterns(list: readonly PatternPreset[]): string {
  return JSON.stringify(list.map((p) => ({ name: p.name, w: p.w, h: p.h, px: u16ToB64(p.px) })));
}

/** Parse a persisted (or imported) Patterns library. This is user-editable
 *  storage, so every field is re-validated and a bad entry is dropped rather
 *  than trusted — a tile whose buffer doesn't match its dimensions would make
 *  the engine's set_pattern a silent no-op. Returns null when the text is not a
 *  library at all, so the caller keeps its current list. */
export function parsePatterns(text: string | null): PatternPreset[] | null {
  if (!text) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(raw)) return null;
  const out: PatternPreset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { name, w, h, px } = item as { name?: unknown; w?: unknown; h?: unknown; px?: unknown };
    if (typeof name !== "string" || !name.trim() || typeof px !== "string") continue;
    if (!Number.isInteger(w) || !Number.isInteger(h)) continue;
    const tw = w as number, th = h as number;
    if (tw < 1 || th < 1 || tw > MAX_PATTERN_SIDE || th > MAX_PATTERN_SIDE) continue;
    let texels: Uint16Array | null = null;
    try { texels = b64ToU16(px); } catch { continue; }
    if (!texels || texels.length !== tw * th * 4) continue;
    out.push({ name: name.trim(), w: tw, h: th, px: texels });
  }
  return out;
}
