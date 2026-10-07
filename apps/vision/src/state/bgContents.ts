// ─────────────────────────────────────────────────────────────
// New Document ▸ Background Contents — pure resolver for the base-layer fill of a
// new document (Photoshop): White, Background Color, or Transparent. Engine-free so
// it unit-tests in node; the store applies the result (fill_selection / clear) to
// the freshly built engine.
// ─────────────────────────────────────────────────────────────

export type BgContents = "white" | "bg" | "transparent";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Background Contents options for the dropdown (White is the Photoshop default). */
export const BG_CONTENTS: { key: BgContents; label: string }[] = [
  { key: "white", label: "White" },
  { key: "bg", label: "Background Color" },
  { key: "transparent", label: "Transparent" },
];

/** The fill to apply to a new document's base layer, or null for transparent
 *  (clear). bgR/bgG/bgB are the current background colour (0..255). */
export function bgFill(kind: BgContents, bgR: number, bgG: number, bgB: number): Rgba | null {
  if (kind === "transparent") return null;
  if (kind === "bg") return { r: bgR, g: bgG, b: bgB, a: 255 };
  return { r: 255, g: 255, b: 255, a: 255 }; // white
}
