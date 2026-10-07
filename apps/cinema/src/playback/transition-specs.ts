// ─────────────────────────────────────────────────────────────
// transition-specs.ts — PURE layer-spec computation for the program frame.
//
// Turns the model at a frame into an ordered (bottom→top) list of engine layer
// specs. A clip edge carrying an A/B transition (cross-dissolve / wipe / push /
// slide / iris) emits TWO layers — outgoing beneath, incoming on top with a
// ramped opacity / wipe / push offset. Dip-to-black/white + manual fades stay
// single-layer opacity ramps. No engine/store/DOM imports — unit-tested.
// ─────────────────────────────────────────────────────────────

import { clipAt, clipsByStart, videoTracks } from "../timeline/model/query";
import { clipSourceFrame } from "../timeline/model/query";
import type { Clip, Sequence, Track, TransitionKind } from "../timeline/model/types";

export const AB_KINDS = new Set<TransitionKind>(["cross-dissolve", "wipe", "push", "slide", "iris"]);

/** One engine layer to draw this frame. */
export interface LayerSpec {
  clip: Clip;
  sampleFrame: number;
  /** Extra opacity multiplier (transition ramp / fades / dip), 0..1. */
  opacityMul: number;
  wipeKind: number; // 0 none, 1 linear, 2 iris
  wipeProgress: number;
  wipeAngle: number;
  /** Push/slide offset, in sequence pixels. */
  offsetX: number;
  offsetY: number;
}

function prevClip(track: Track, clip: Clip): Clip | null {
  const sorted = clipsByStart(track);
  const i = sorted.findIndex((c) => c.id === clip.id);
  return i > 0 ? sorted[i - 1] : null;
}
function nextClip(track: Track, clip: Clip): Clip | null {
  const sorted = clipsByStart(track);
  const i = sorted.findIndex((c) => c.id === clip.id);
  return i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
}

/** Dip-to-black/white + manual fade opacity envelope (NON-AB), 0..1. */
export function envelopeOpacity(clip: Clip, t: number): number {
  let o = 1;
  const local = t - clip.start;
  const tail = clip.start + clip.duration - t;
  const tin = clip.transitionIn;
  if (tin && (tin.kind === "dip-to-black" || tin.kind === "dip-to-white")) {
    const p = local / Math.max(1, tin.durationFrames);
    if (p < 1) o *= Math.max(0, Math.min(1, p));
  }
  const tout = clip.transitionOut;
  if (tout && (tout.kind === "dip-to-black" || tout.kind === "dip-to-white")) {
    const p = tail / Math.max(1, tout.durationFrames);
    if (p < 1) o *= Math.max(0, Math.min(1, p));
  }
  if (clip.fadeInFrames > 0 && local < clip.fadeInFrames) o *= Math.max(0, local / clip.fadeInFrames);
  if (clip.fadeOutFrames > 0 && tail < clip.fadeOutFrames) o *= Math.max(0, tail / clip.fadeOutFrames);
  return o;
}

function baseSpec(clip: Clip, t: number, opacityMul: number): LayerSpec {
  return { clip, sampleFrame: clipSourceFrame(clip, t), opacityMul, wipeKind: 0, wipeProgress: 1, wipeAngle: 0, offsetX: 0, offsetY: 0 };
}

/** The incoming (on-top) layer of an A/B transition, ramped by progress `p`. */
function incomingSpec(clip: Clip, t: number, p: number, kind: TransitionKind, angleDeg: number, seqW: number, seqH: number): LayerSpec {
  const s = baseSpec(clip, t, 1);
  switch (kind) {
    case "cross-dissolve":
      s.opacityMul = p;
      break;
    case "wipe":
      s.wipeKind = 1;
      s.wipeProgress = p;
      s.wipeAngle = (angleDeg * Math.PI) / 180;
      break;
    case "iris":
      s.wipeKind = 2;
      s.wipeProgress = p;
      break;
    case "push":
      s.offsetX = (1 - p) * seqW;
      break;
    case "slide":
      s.offsetY = (1 - p) * seqH;
      break;
    default:
      s.opacityMul = p;
  }
  return s;
}

/** Build the ordered (bottom→top) layer specs for the program at frame `t`. */
export function collectVideoSpecs(seq: Sequence, t: number): LayerSpec[] {
  const vts = videoTracks(seq);
  const soloed = vts.some((tr) => tr.solo);
  const specs: LayerSpec[] = [];
  for (const track of vts) {
    if (!track.enabled || (soloed && !track.solo)) continue;
    const C = clipAt(track, t);
    if (!C || !C.enabled) continue;

    const tin = C.transitionIn;
    const tout = C.transitionOut;
    if (tin && AB_KINDS.has(tin.kind) && t < C.start + tin.durationFrames) {
      const P = prevClip(track, C);
      const p = (t - C.start) / Math.max(1, tin.durationFrames);
      if (P) specs.push(baseSpec(P, t, envelopeOpacity(P, t)));
      specs.push(incomingSpec(C, t, p, tin.kind, tin.angle ?? 0, seq.width, seq.height));
    } else if (tout && AB_KINDS.has(tout.kind) && t >= C.start + C.duration - tout.durationFrames) {
      const N = nextClip(track, C);
      const p = (t - (C.start + C.duration - tout.durationFrames)) / Math.max(1, tout.durationFrames);
      specs.push(baseSpec(C, t, envelopeOpacity(C, t)));
      if (N) specs.push(incomingSpec(N, t, p, tout.kind, tout.angle ?? 0, seq.width, seq.height));
    } else {
      specs.push(baseSpec(C, t, envelopeOpacity(C, t)));
    }
  }
  return specs;
}
