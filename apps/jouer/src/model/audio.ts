// ─────────────────────────────────────────────────────────────
// audio.ts — pure helpers for the AudioSource component (Unity parity). No
// Phaser, no React. The code exporter and the live player both build their
// Phaser sound config through soundConfig so the played game and the exported
// code play a clip identically.
// ─────────────────────────────────────────────────────────────

import type { AudioSource } from "./types";

/** Phaser SoundConfig for an AudioSource: only the non-default keys, so a plain
 *  one-shot at full volume serialises to `{}`. Volume/pan clamped; pitch floored. */
export function soundConfig(a: AudioSource): { loop?: true; volume?: number; rate?: number; pan?: number; mute?: true } {
  const c: { loop?: true; volume?: number; rate?: number; pan?: number; mute?: true } = {};
  if (a.loop) c.loop = true;
  if (a.mute) c.mute = true; // Unity AudioSource Mute → Phaser `mute`
  // Only the non-default, finite volume (a NaN/Infinity falls back to full).
  if (Number.isFinite(a.volume) && a.volume !== 1) c.volume = Math.max(0, Math.min(1, a.volume));
  // Unity AudioSource Pitch → Phaser `rate`; only when set and not the default 1.
  // Floored at 0.1 (same as normalize/inspector) so a stray 0/negative can't silence/freeze.
  if (Number.isFinite(a.pitch) && a.pitch !== 1) c.rate = Math.max(0.1, a.pitch);
  // Unity AudioSource Stereo Pan → Phaser `pan`; only when off-centre.
  if (Number.isFinite(a.pan) && a.pan !== 0) c.pan = Math.max(-1, Math.min(1, a.pan));
  return c;
}

/** Whether an AudioSource will actually emit a sound on scene start (it has a
 *  clip and is set to play on awake). */
export function playsOnAwake(a: AudioSource | null | undefined): boolean {
  return !!a && !!a.assetId && a.playOnAwake;
}
