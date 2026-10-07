// ─────────────────────────────────────────────────────────────
// engine/dsp/stereo-expander — Adobe Audition–style Stereo Expander
// ─────────────────────────────────────────────────────────────
// Audition's Stereo Imagery ▸ Stereo Expander: it widens or narrows a mix's
// stereo image and positions its centre left↔right. It works in the mid/side
// domain — mid = the mono (centre) sum, side = the stereo difference — and
// scales the side to change the *width* (more side = wider), then re-pans the
// mid to move the *centre* of the image. Distinct from the Channel Mixer (a 2×2
// route matrix) and the Center Channel Extractor (vocal isolate/remove): this is
// the dedicated width + placement tool.
//
//   M = (L+R)/2   S = (L−R)/2
//   S' = S · (expand/100)                 // width: 100 = unity, 0 = mono, 300 = ×3
//   L' = M·midL + S'   R' = M·midR − S'    // centre pan re-balances the mid
//
// At expand = 100, pan = 0 this is a bit-exact passthrough. The mono sum
// (L'+R' = 2M) is preserved at pan = 0 for any width, so widening never changes
// the centre level. Pure `(AudioData, opts) => AudioData`; input never mutated.

import { cloneAudioData } from "../audio/buffer";
import type { AudioData } from "../audio/types";

export interface StereoExpanderOptions {
  /**
   * Stereo Expand amount. 100 = unchanged, 0 = collapse to mono (narrowest),
   * up to 300 = ×3 wide. Default 100.
   */
  expand?: number;
  /**
   * Centre position of the stereo image, −100 (hard left) … +100 (hard right).
   * 0 leaves the centre in place. Default 0.
   */
  centerPan?: number;
  automation?: StereoExpanderAutomationOptions;
}

type StereoExpanderParamResolver = (timeSeconds: number, fallback: number) => number;

export interface StereoExpanderAutomationOptions {
  offsetSeconds?: number;
  expand?: StereoExpanderParamResolver;
  centerPan?: StereoExpanderParamResolver;
}

const DEFAULT_EXPAND = 100;

/**
 * Apply the Stereo Expander. Operates on a stereo (2-channel) buffer; mono and
 * other channel counts have no stereo field to expand and pass through
 * unchanged. Frame count is preserved and the input is not mutated.
 */
export function stereoExpander(d: AudioData, opts: StereoExpanderOptions = {}): AudioData {
  const out = cloneAudioData(d);
  if (out.channels.length !== 2) return out; // nothing to widen without an L/R pair

  const expand = opts.expand ?? DEFAULT_EXPAND;
  const centerPan = opts.centerPan ?? 0;
  const sideGain = Math.max(0, expand / 100);
  const theta = Math.max(-1, Math.min(1, centerPan / 100));
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;

  const left = out.channels[0];
  const right = out.channels[1];
  for (let i = 0; i < left.length; i++) {
    const time = offset + i / d.sampleRate;
    const nextSideGain = automation?.expand ? Math.max(0, automation.expand(time, expand) / 100) : sideGain;
    const nextTheta = automation?.centerPan ? Math.max(-1, Math.min(1, automation.centerPan(time, centerPan) / 100)) : theta;
    // Pan the mid: hard right (θ=+1) silences the left mid, hard left (θ=−1) the right.
    const midL = 1 - Math.max(0, nextTheta);
    const midR = 1 + Math.min(0, nextTheta);
    const mid = (left[i] + right[i]) / 2;
    const side = ((left[i] - right[i]) / 2) * nextSideGain;
    left[i] = mid * midL + side;
    right[i] = mid * midR - side;
  }
  return out;
}
