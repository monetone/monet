// Pure helpers for Photoshop's Artboard Options ▸ Artboard Background Color
// (White / Black / Transparent / Other) on the Artboard tool's options bar.
// Engine-free so they unit-test in node; the bar feeds the resolved 0..255 RGBA
// to the engine's `set_artboard_background` and reads the current one back from
// `artboard_background`. Reuses hexToRgb from the Fill helper, like the Canvas
// Size dialog's extension-colour picker does.
import { hexToRgb } from "./fillContents";

export type ArtboardBackground = "white" | "black" | "transparent" | "other";
/** 0..255 straight-alpha RGBA, the engine's colour convention. */
export type RGBA = [number, number, number, number];

export const ARTBOARD_BACKGROUNDS: { value: ArtboardBackground; label: string }[] = [
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "transparent", label: "Transparent" },
  { value: "other", label: "Other…" },
];

export const DEFAULT_ARTBOARD_BACKGROUND: RGBA = [255, 255, 255, 255];

/** The RGBA a dropdown pick means. "Transparent" keeps the artboard's colour and
 *  only drops its alpha, so picking a colour again restores it rather than
 *  snapping back to white. */
export function resolveArtboardBackground(
  choice: ArtboardBackground,
  current: RGBA,
  customHex: string,
): RGBA {
  switch (choice) {
    case "white": return [255, 255, 255, 255];
    case "black": return [0, 0, 0, 255];
    case "transparent": return [current[0], current[1], current[2], 0];
    default: { const [r, g, b] = hexToRgb(customHex); return [r, g, b, 255]; }
  }
}

/** Which dropdown entry an engine RGBA reads as. Alpha wins: a transparent
 *  artboard shows as Transparent whatever colour it kept underneath. */
export function artboardBackgroundChoice(c: RGBA): ArtboardBackground {
  if (c[3] === 0) return "transparent";
  if (c[0] === 255 && c[1] === 255 && c[2] === 255) return "white";
  if (c[0] === 0 && c[1] === 0 && c[2] === 0) return "black";
  return "other";
}

/** "#rrggbb" for the options bar's <input type="color"> swatch. */
export function artboardBackgroundHex(c: RGBA): string {
  return "#" + [c[0], c[1], c[2]]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("");
}

/** Normalise what the engine hands back (a Uint8Array, or nothing when the id
 *  isn't an artboard) into an RGBA. Missing → the default white background. */
export function toArtboardBackground(raw: ArrayLike<number> | null | undefined): RGBA {
  if (!raw || raw.length < 4) return [...DEFAULT_ARTBOARD_BACKGROUND];
  return [raw[0], raw[1], raw[2], raw[3]];
}
