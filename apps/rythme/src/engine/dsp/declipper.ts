// ─────────────────────────────────────────────────────────────
// engine/dsp/declipper — Adobe Audition–style DeClipper / Clip Restoration
// ─────────────────────────────────────────────────────────────
// Audio driven past 0 dBFS clips: the peaks that should rise above full scale
// are flattened into plateaus pinned at the ceiling, which adds harsh harmonic
// distortion. The DeClipper finds those flats and rebuilds the lost peak.
//
// Detection is two-stage so a *clean* loud crest (which is also a run of same-sign
// samples above the threshold) is NOT mistaken for clipping: (1) scan for a
// same-sign run with |x| ≥ threshold, then (2) within it find the longest
// contiguous run of NEAR-CONSTANT samples (a true clipped plateau is flat to
// within flatnessEps; a clean crest keeps curving, so it has no extended flat).
// Only a flat plateau of at least minRunLength samples is repaired: a cubic-Hermite
// arch is fitted through the good samples just outside the plateau, using their
// slopes as the entry/exit tangents so the curve bulges back up over the gap. The
// reconstruction is clamped to stay at/above the plateau level (it can only have
// been louder there) and within [-1, 1]. Distinct from the DeClicker, which
// removes short transient clicks via a prediction-residual detector and linear
// interpolation. Pure `(AudioData, opts) => AudioData`; never mutates the input.

import { cloneAudioData } from "../audio/buffer";
import { clamp, clampSample } from "../audio/db";
import { type AudioData } from "../audio/types";

export interface DeClipperOptions {
  /** Samples with |value| ≥ threshold (0…1) are candidates for a clipped flat. Default 0.95. */
  threshold?: number;
  /** Max difference between consecutive samples for a run to count as a flat plateau (vs a clean curving crest). Default 1e-4. */
  flatnessEps?: number;
  /** Shortest flat plateau (in samples) to treat as clipping and repair. Default 5. */
  minRunLength?: number;
  /** Longest plateau to attempt rebuilding — longer flats carry no peak information. Default 882 (~20 ms @44.1k). */
  maxRunLength?: number;
}

/** Cubic-Hermite basis blend of two points (p0,p1) and tangents (m0,m1) at parameter t∈[0,1] over an interval of `span` samples. */
function hermite(p0: number, p1: number, m0: number, m1: number, span: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * p0 + h10 * span * m0 + h01 * p1 + h11 * span * m1;
}

/**
 * Detect and repair clipped (flat-topped) regions. The output keeps the input's
 * channel and frame count; the input is not mutated.
 *
 * @remarks Detection keys on flatness, so a very-low-frequency clean tone (whose
 * crest is naturally near-constant for many samples) at very high level can in
 * principle look like a short plateau; the minRunLength gate keeps this out of the
 * tested 50 Hz–15 kHz range.
 */
export function deClip(d: AudioData, opts: DeClipperOptions = {}): AudioData {
  const threshold = clamp(opts.threshold ?? 0.95, 0, 1);
  const flatEps = Math.max(0, opts.flatnessEps ?? 1e-4);
  const minRun = Math.max(2, Math.floor(opts.minRunLength ?? 5));
  const maxRun = Math.max(minRun, Math.floor(opts.maxRunLength ?? 882));

  const out = cloneAudioData(d);
  for (const ch of out.channels) {
    const n = ch.length;
    if (n < 4) continue;

    let i = 0;
    while (i < n) {
      // Negated comparison so a non-finite (NaN) sample fails the test and is
      // skipped — this guarantees forward progress and cannot infinite-loop.
      if (!(Math.abs(ch[i]) >= threshold)) {
        i++;
        continue;
      }
      // A maximal run of consecutive same-sign above-threshold samples [rStart, rEnd].
      const sign = ch[i] >= 0 ? 1 : -1;
      const rStart = i;
      while (i < n && Math.abs(ch[i]) >= threshold && (ch[i] >= 0 ? 1 : -1) === sign) i++;
      const rEnd = i - 1; // i has advanced past the run → progress guaranteed

      // The clipped plateau is the longest contiguous NEAR-CONSTANT stretch inside
      // the run; a clean crest keeps curving and never forms one.
      let bestStart = rStart;
      let bestLen = 1;
      let curStart = rStart;
      for (let j = rStart + 1; j <= rEnd; j++) {
        if (Math.abs(ch[j] - ch[j - 1]) <= flatEps) {
          if (j - curStart + 1 > bestLen) {
            bestLen = j - curStart + 1;
            bestStart = curStart;
          }
        } else {
          curStart = j;
        }
      }

      const fStart = bestStart;
      const fEnd = bestStart + bestLen - 1;
      // Repair only a genuine plateau with good samples (and slopes) on both sides.
      if (bestLen < minRun || bestLen > maxRun || fStart < 2 || fEnd > n - 3) continue;

      const a = fStart - 1; // last good sample before the plateau
      const b = fEnd + 1; // first good sample after the plateau
      const mL = ch[a] - ch[a - 1]; // slope entering the plateau
      const mR = ch[b + 1] - ch[b]; // slope leaving the plateau
      const span = b - a;
      const plateau = Math.abs(ch[fStart]); // the actual rail level the run sat at

      for (let j = fStart; j <= fEnd; j++) {
        const t = (j - a) / span;
        let v = hermite(ch[a], ch[b], mL, mR, span, t);
        // The true signal was at least as loud as the plateau here, with the run's
        // sign — never reconstruct back below the flat it replaces.
        v = sign > 0 ? Math.max(v, plateau) : Math.min(v, -plateau);
        ch[j] = clampSample(v);
      }
    }
  }
  return out;
}
