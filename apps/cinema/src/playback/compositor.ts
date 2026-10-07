// ─────────────────────────────────────────────────────────────
// compositor.ts — programs the wasm engine layer stack from the timeline model
// for a single sequence frame, then composites.
//
// `collectVideoSpecs` turns the model at a frame into an ordered list of layer
// specs (bottom→top). A clip edge carrying an A/B transition (cross-dissolve /
// wipe / push / slide / iris) emits TWO layers — the outgoing clip beneath and
// the incoming clip on top with a ramped opacity / wipe / push offset — so real
// two-roll transitions composite (partner frames decode via the same spec list).
// Dip-to-black/white + manual fades stay single-layer opacity ramps through the
// program background.
// ─────────────────────────────────────────────────────────────

import { engine, store } from "../state/app";
import { gradeToParams, resolveLut } from "../state/effects";
import { findMedia } from "../timeline/model/query";
import type { Sequence } from "../timeline/model/types";
import { getNearestFrame, type DecodedFrame } from "./frame-source";
import { collectVideoSpecs, type LayerSpec } from "./transition-specs";

export { collectVideoSpecs };
export type { LayerSpec };

/** kebab blend-mode id → engine BlendMode index (engine/src/blend.rs). */
export const BLEND_INDEX: Record<string, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5,
  "color-dodge": 6, "color-burn": 7, "hard-light": 8, "soft-light": 9,
  difference: 10, exclusion: 11, add: 12, subtract: 13,
};
export const BLEND_MODES = Object.keys(BLEND_INDEX);

const solidCache = new Map<string, DecodedFrame>();
function solidFrame(hex: string): DecodedFrame {
  const cached = solidCache.get(hex);
  if (cached) return cached;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  const data = new Uint8ClampedArray(2 * 2 * 4);
  for (let i = 0; i < 4; i++) {
    data[i * 4] = (n >> 16) & 255;
    data[i * 4 + 1] = (n >> 8) & 255;
    data[i * 4 + 2] = n & 255;
    data[i * 4 + 3] = 255;
  }
  const frame: DecodedFrame = { data, width: 2, height: 2 };
  solidCache.set(hex, frame);
  return frame;
}

function frameForSpec(spec: LayerSpec): DecodedFrame | null {
  if (spec.clip.kind === "color") {
    const media = findMedia(store.getProject(), spec.clip.mediaId);
    return solidFrame(media?.color ?? "#000000");
  }
  return getNearestFrame(spec.clip.mediaId, spec.sampleFrame);
}

/** Program + composite the program frame for `seq` at `playhead` (preview scale). */
export function renderProgramFrame(seq: Sequence, playhead: number, scale: number): void {
  const specs = collectVideoSpecs(seq, playhead);
  engine.setLayerCount(specs.length);

  specs.forEach((spec, li) => {
    const frame = frameForSpec(spec);
    if (!frame) {
      engine.setVisible(li, false);
      return;
    }
    engine.setVisible(li, true);
    engine.writeSource(li, frame.data, frame.width, frame.height);

    const tr = spec.clip.transform;
    // Stored frames may be downscaled (live-playback capture) — map by the
    // media's NATIVE size so a frame fills the same sequence area regardless of
    // its stored pixel dimensions (1 native px = 1 sequence px at scale 100).
    const media = findMedia(store.getProject(), spec.clip.mediaId);
    const nativeW = media?.width || frame.width;
    const nativeH = media?.height || frame.height;
    const sx = (nativeW / frame.width) * (tr.scaleX / 100) * scale;
    const sy = (nativeH / frame.height) * (tr.scaleY / 100) * scale;
    const tx = (seq.width / 2 + tr.x + spec.offsetX) * scale;
    const ty = (seq.height / 2 + tr.y + spec.offsetY) * scale;
    const ax = tr.anchorX * frame.width;
    const ay = tr.anchorY * frame.height;
    engine.setTransform(li, tx, ty, sx, sy, (tr.rotation * Math.PI) / 180, ax, ay);
    engine.setOpacity(li, (tr.opacity / 100) * spec.opacityMul);
    engine.setBlend(li, BLEND_INDEX[tr.blendMode] ?? 0);
    engine.setCrop(li, tr.cropL, tr.cropT, tr.cropR, tr.cropB);
    engine.setColor(li, gradeToParams(spec.clip.color));
    // Creative Look — parsed once and re-uploaded only on change (EngineClient).
    engine.setLut(li, resolveLut(spec.clip.color.lut));
    engine.setWipe(li, spec.wipeKind, spec.wipeProgress, spec.wipeAngle);
  });

  engine.composite();
}
