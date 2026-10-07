// ─────────────────────────────────────────────────────────────
// Swatches — pure helpers for the Swatches panel's saved-colour list. Engine-
// free so they unit-test in node; the Store delegates to them. Colours are
// stored as normalized #rrggbb hex strings.
// ─────────────────────────────────────────────────────────────

/** A Photoshop-like starter palette. */
export const DEFAULT_SWATCHES = [
  "#000000", "#ffffff", "#ff3b30", "#ff9500", "#ffcc00",
  "#34c759", "#00c7be", "#007aff", "#5856d6", "#af52de",
];
export const MAX_IMPORTED_SWATCHES = 4096;

/** Normalize to lowercase #rrggbb: add a leading #, expand #rgb shorthand. */
export function normalizeSwatchHex(hex: string): string {
  let h = hex.trim().toLowerCase();
  if (h[0] !== "#") h = `#${h}`;
  if (h.length === 4) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`; // #rgb → #rrggbb
  return h;
}

/** Parse the app-level swatch library. An empty list is valid; malformed data
 * leaves the built-in palette untouched. */
export function parseSwatches(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return null;
    const swatches: string[] = [];
    for (const item of value) {
      if (typeof item !== "string") return null;
      const hex = normalizeSwatchHex(item);
      if (!/^#[0-9a-f]{6}$/.test(hex)) return null;
      if (!swatches.includes(hex)) swatches.push(hex);
    }
    return swatches;
  } catch { return null; }
}

/** Append a swatch (normalized); a colour already present is a same-ref no-op. */
export function addSwatchTo(list: string[], hex: string): string[] {
  const h = normalizeSwatchHex(hex);
  if (list.includes(h)) return list;
  return [...list, h];
}

/** Remove the swatch at index `i`; out-of-range is a same-ref no-op. */
export function removeSwatchAt(list: string[], i: number): string[] {
  if (i < 0 || i >= list.length) return list;
  return list.filter((_, j) => j !== i);
}
