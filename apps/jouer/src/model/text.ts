// ─────────────────────────────────────────────────────────────
// text.ts — pure helpers for text rendering config. No Phaser, no React. The
// editor runtime, the player and the code exporter all build their Phaser text
// style through these so the live editor, the played game and the exported code
// render identical text.
// ─────────────────────────────────────────────────────────────

import type { TextStyle } from "./types";

/** Phaser Text `shadow` style config (subset we drive). */
export interface TextShadowConfig {
  offsetX: number;
  offsetY: number;
  color: string;
  blur: number;
  /** Cast the shadow from the filled glyphs (the normal drop shadow). */
  fill: true;
  /** We don't shadow the stroke separately. */
  stroke: false;
}

/** Build the Phaser Text shadow config for a style (Unity UI "Shadow" component),
 *  or null when the shadow is invisible. A shadow is only visible when it has a
 *  non-zero offset or a positive blur — a zero-distance, zero-blur shadow renders
 *  nothing, so we omit it entirely (keeps the editor, player and export clean,
 *  mirroring how wrapWidth===0 omits wordWrap). */
export function textShadowConfig(style: TextStyle | undefined): TextShadowConfig | null {
  if (!style) return null;
  const offsetX = style.shadowOffsetX ?? 0;
  const offsetY = style.shadowOffsetY ?? 0;
  const blur = style.shadowBlur ?? 0;
  if (offsetX === 0 && offsetY === 0 && blur <= 0) return null;
  return {
    offsetX,
    offsetY,
    color: style.shadowColor ?? "#000000",
    blur: Math.max(0, blur),
    fill: true,
    stroke: false,
  };
}
