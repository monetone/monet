// ─────────────────────────────────────────────────────────────
// blend.ts — pure helpers for an object's render Blend Mode (Unity's SpriteRenderer
// material blend, 2D subset). No Phaser, no React. The editor runtime, the player
// and the code exporter all map the model mode through phaserBlendName so the live
// editor, the played game and the exported code blend identically.
// ─────────────────────────────────────────────────────────────

import type { GameObject } from "./types";

/** The blend modes Jouer exposes (Phaser's NORMAL/ADD/MULTIPLY/SCREEN). */
export type BlendMode = "normal" | "add" | "multiply" | "screen";
export const BLEND_MODES: BlendMode[] = ["normal", "add", "multiply", "screen"];

const PHASER_NAME: Record<BlendMode, string> = {
  normal: "NORMAL",
  add: "ADD",
  multiply: "MULTIPLY",
  screen: "SCREEN",
};

/** The Phaser BlendModes key for a mode (accepted by setBlendMode). Defaults to
 *  NORMAL for undefined or any unknown value. */
export function phaserBlendName(mode: GameObject["blendMode"]): string {
  return (mode && PHASER_NAME[mode]) ?? "NORMAL";
}

/** Whether a mode is the default alpha blend (so callers can omit setBlendMode). */
export function isNormalBlend(mode: GameObject["blendMode"]): boolean {
  return !mode || mode === "normal";
}
