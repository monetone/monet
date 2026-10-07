// ─────────────────────────────────────────────────────────────
// Colour formatting — pure helpers for "Copy Color's Hex Code" / "Copy Color as
// HTML" (Photoshop's Color-panel commands). Engine-free so they unit-test in
// node; app.ts wires them to the clipboard.
// ─────────────────────────────────────────────────────────────

const hex2 = (c: number): string =>
  Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0");

export type ColorCopyFormat = "hex" | "html";

/** Photoshop "Copy Color's Hex Code": 6 lowercase hex digits, no leading #. */
export function colorHexCode(r: number, g: number, b: number): string {
  return hex2(r) + hex2(g) + hex2(b);
}

/** Photoshop "Copy Color as HTML": the full color attribute, e.g. color="#ff0000". */
export function colorAsHtml(r: number, g: number, b: number): string {
  return `color="#${colorHexCode(r, g, b)}"`;
}

/** Format a colour for the clipboard in the requested mode. */
export function formatColor(r: number, g: number, b: number, mode: ColorCopyFormat): string {
  return mode === "html" ? colorAsHtml(r, g, b) : colorHexCode(r, g, b);
}
