// Pure helper for the Canvas Size dialog's "Canvas extension color" dropdown.
// Engine-free so it unit-tests in node; the dialog feeds the resolved RGBA to the
// engine's resize_canvas_filled. Reuses hexToRgb from the Fill helper (#57).
import { hexToRgb, type RGB } from "./fillContents";

export type ExtensionColor = "none" | "foreground" | "background" | "white" | "black" | "gray" | "other";
export type RGBA = [number, number, number, number];

export const EXTENSION_COLORS: { value: ExtensionColor; label: string }[] = [
  { value: "none", label: "None (Transparent)" },
  { value: "foreground", label: "Foreground" },
  { value: "background", label: "Background" },
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "gray", label: "Gray" },
  { value: "other", label: "Other…" },
];

// The RGBA the new canvas border is flooded with. "none" → fully transparent
// (alpha 0, i.e. a plain resize); everything else is opaque (alpha 255).
export function resolveExtensionColor(choice: ExtensionColor, fg: RGB, bg: RGB, customHex: string): RGBA {
  switch (choice) {
    case "foreground": return [fg[0], fg[1], fg[2], 255];
    case "background": return [bg[0], bg[1], bg[2], 255];
    case "white": return [255, 255, 255, 255];
    case "black": return [0, 0, 0, 255];
    case "gray": return [128, 128, 128, 255];
    case "other": { const [r, g, b] = hexToRgb(customHex); return [r, g, b, 255]; }
    default: return [0, 0, 0, 0]; // none → transparent
  }
}
