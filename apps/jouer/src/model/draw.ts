// ─────────────────────────────────────────────────────────────
// draw.ts — pure helpers for a textured object's SpriteRenderer Draw Mode
// (Unity parity: Simple / Tiled / Sliced). No Phaser, no React. The editor
// runtime, the player and the code exporter all branch on these so the live
// editor, the played game and the exported code agree on how a sprite/image is
// drawn (single tile, repeating tiles, or a 9-slice).
// ─────────────────────────────────────────────────────────────

import type { GameObject } from "./types";

/** Default draw Size when a tiled/sliced sprite/image has no explicit width/height. */
export const DEFAULT_DRAW_SIZE = 128;

/** Whether an object repeats its texture across the draw Size (Draw Mode "Tiled").
 *  Only sprites/images can; the flag is ignored on every other kind. */
export function isTiled(o: GameObject): boolean {
  return (o.kind === "sprite" || o.kind === "image") && o.drawMode === "tiled";
}

/** Whether an object is a 9-slice (Draw Mode "Sliced"): corners stay fixed while
 *  the edges/centre stretch to the draw Size. Sprites/images only. */
export function isSliced(o: GameObject): boolean {
  return (o.kind === "sprite" || o.kind === "image") && o.drawMode === "sliced";
}

/** The width×height a tiled/sliced sprite/image fills (Unity's SpriteRenderer
 *  "Size"), falling back to a sensible default so a freshly-switched object is
 *  visible. */
export function drawSize(o: GameObject): { width: number; height: number } {
  return { width: o.width ?? DEFAULT_DRAW_SIZE, height: o.height ?? DEFAULT_DRAW_SIZE };
}

/** The 9-slice border insets in px (Unity's sprite border), clamped non-negative.
 *  Corners within these insets are preserved; the rest stretches. */
export function sliceBorders(o: GameObject): { left: number; right: number; top: number; bottom: number } {
  return {
    left: Math.max(0, o.sliceLeft ?? 0),
    right: Math.max(0, o.sliceRight ?? 0),
    top: Math.max(0, o.sliceTop ?? 0),
    bottom: Math.max(0, o.sliceBottom ?? 0),
  };
}
