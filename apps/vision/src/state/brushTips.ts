// ─────────────────────────────────────────────────────────────
// Brush tips — pure helpers for the Brushes panel's custom-tip library (Edit ▸
// Define Brush Preset). A tip is a captured grayscale ALPHA bitmap (one byte per
// texel) that the engine paints with instead of its procedural round disc. A tip
// is authored content, not a tool setting, so the library is persisted to
// localStorage AND carried in the .mvision document meta (like patternPresets);
// only the active tip's bytes are pushed into the engine. These
// helpers are engine-free so they unit-test in node; the Store delegates to them.
// Mirrors brushPresets.ts (the numeric BrushPreset library is separate).
// ─────────────────────────────────────────────────────────────

export interface BrushTip {
  name: string;
  w: number;
  h: number;
  alpha: Uint8Array; // w·h bytes, 0 transparent … 255 opaque
}

/** Persisted-tip sanity bounds, shared by live insertion and decode. */
export const MAX_BRUSH_TIP_SIDE = 5000; // Photoshop's own custom-tip ceiling
export const MAX_BRUSH_TIPS = 256;
export const MAX_BRUSH_TIP_LIBRARY_BYTES = 64 * 1024 * 1024;

/** The next "Tip N" name, one past the highest existing "Tip <int>"
 *  (Photoshop-like auto-numbering); names not of that form are ignored. */
export function defaultBrushTipName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Tip (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Tip ${max + 1}`;
}

/** Append a valid tip that the persistence clone can retain; otherwise same-ref. */
export function addBrushTipTo(list: BrushTip[], tip: BrushTip): BrushTip[] {
  if (list.some((t) => t.name === tip.name)) return list;
  if (list.length >= MAX_BRUSH_TIPS
    || !Number.isInteger(tip.w) || !Number.isInteger(tip.h)
    || tip.w < 1 || tip.h < 1 || tip.w > MAX_BRUSH_TIP_SIDE || tip.h > MAX_BRUSH_TIP_SIDE
    || tip.alpha.length !== tip.w * tip.h) return list;
  const bytes = list.reduce((total, item) => total + item.alpha.length, tip.alpha.length);
  if (bytes > MAX_BRUSH_TIP_LIBRARY_BYTES) return list;
  return [...list, tip];
}

/** Remove the tip at index `i`; out-of-range is a same-ref no-op. */
export function removeBrushTipAt(list: BrushTip[], i: number): BrushTip[] {
  if (i < 0 || i >= list.length) return list;
  return list.filter((_, j) => j !== i);
}

/** The active-tip index after the tip at `removed` is deleted: the active tip
 *  itself going away reverts to the round brush (-1); higher indices shift down;
 *  a no-op removal (negative index) leaves it unchanged. */
export function activeAfterRemove(active: number, removed: number): number {
  if (removed < 0) return active;
  if (active === removed) return -1;
  if (active > removed) return active - 1;
  return active;
}

// ── persistence ──────────────────────────────────────────────────────────────
// Wire form of a tip: alpha rides as base64 of the raw bytes, because JSON
// numbers would be ~4× larger and localStorage is quota-bound. Same shape as
// patternPresets' tiles.

export interface SerializedBrushTip {
  name: string;
  w: number;
  h: number;
  alpha: string; // base64 of the w·h alpha bytes
}

function alphaToB64(a: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000; // spread() blows the arg limit on a whole tip
  for (let i = 0; i < a.length; i += CHUNK) bin += String.fromCharCode(...a.subarray(i, i + CHUNK));
  return btoa(bin);
}

function b64ToAlpha(b64: string): Uint8Array {
  const bin = atob(b64); // throws on malformed input — the caller catches
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function serializeBrushTips(list: readonly BrushTip[]): SerializedBrushTip[] {
  return list.map((t) => ({ name: t.name, w: t.w, h: t.h, alpha: alphaToB64(t.alpha) }));
}

/** Parse a persisted tip library. Accepts the localStorage JSON *text*, the
 *  already-parsed wire array, or the runtime array (alpha still a Uint8Array),
 *  so the same validator serves localStorage, .mvision decode and .mvision
 *  encode. This is user-editable storage, so every field is re-validated and a
 *  bad entry is dropped rather than trusted — a tip whose buffer doesn't match
 *  its dimensions would make the engine's set_brush_tip a silent no-op. Returns
 *  null when the value is not a library at all, so the caller keeps its current
 *  list; an empty array is a valid saved library (the user deleted every tip). */
export function parseBrushTips(value: unknown): BrushTip[] | null {
  let raw = value;
  if (typeof raw === "string") {
    if (!raw) return null;
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(raw)) return null;
  const out: BrushTip[] = [];
  let bytes = 0;
  for (const item of raw.slice(0, MAX_BRUSH_TIPS)) {
    if (!item || typeof item !== "object") continue;
    const { name, w, h, alpha } = item as { name?: unknown; w?: unknown; h?: unknown; alpha?: unknown };
    if (typeof name !== "string" || !name.trim()) continue;
    if (!Number.isInteger(w) || !Number.isInteger(h)) continue;
    const tw = w as number, th = h as number;
    if (tw < 1 || th < 1 || tw > MAX_BRUSH_TIP_SIDE || th > MAX_BRUSH_TIP_SIDE) continue;
    if (bytes + tw * th > MAX_BRUSH_TIP_LIBRARY_BYTES) break;
    let texels: Uint8Array | null = null;
    if (alpha instanceof Uint8Array) texels = new Uint8Array(alpha);
    else if (typeof alpha === "string") { try { texels = b64ToAlpha(alpha); } catch { continue; } }
    if (!texels || texels.length !== tw * th) continue;
    bytes += texels.length;
    out.push({ name: name.trim(), w: tw, h: th, alpha: texels });
  }
  return out;
}
