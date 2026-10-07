// ─────────────────────────────────────────────────────────────
// engine/dsp/auto-phase — Adobe Audition–style Automatic Phase Correction
// ─────────────────────────────────────────────────────────────
// Audition's Noise Reduction/Restoration ▸ Automatic Phase Correction: it fixes
// azimuth errors (misaligned tape heads), stereo "smearing" from off-centre mic
// placement, and other inter-channel timing problems by *time-shifting* one
// channel into alignment with the other. Two modes:
//   • Auto Align — normalized cross-correlation over a central window finds the
//     lag (within ±maxShiftMs) at which the two channels best line up, then
//     advances/delays the right channel to remove it. If the best match is
//     negative (channels wired out of polarity) it flips the right channel too,
//     restoring mono compatibility.
//   • Global Time Shift — apply a manual, uniform left/right shift in ms.
// Operates on a stereo pair; mono / other channel counts pass through. Length is
// preserved (edges zero-filled). Pure `(AudioData, opts) => AudioData`; the input
// is never mutated.

import { cloneAudioData } from "../audio/buffer";
import { clamp } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";

export interface AutoPhaseCorrectionOptions {
  /** "auto" detects the inter-channel lag; "global" applies manual shifts. Default "auto". */
  mode?: "auto" | "global";
  /** Auto mode: maximum lag searched, in ms (0 = polarity only). Default 5. */
  maxShiftMs?: number;
  /** Auto mode: also flip the right channel if the channels are anti-correlated. Default true. */
  correctPolarity?: boolean;
  /** Global mode: left-channel shift in ms (positive delays, negative advances). Default 0. */
  leftShiftMs?: number;
  /** Global mode: right-channel shift in ms. Default 0. */
  rightShiftMs?: number;
}

/** Shift a channel by `d` samples into a new array (positive delays/right, edges zero-filled). */
function shifted(ch: Float32Array, d: number): Float32Array {
  if (d === 0) return Float32Array.from(ch);
  const out = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) {
    const j = i - d;
    if (j >= 0 && j < ch.length) out[i] = ch[j];
  }
  return out;
}

/**
 * Find the lag (in samples, within ±maxLag) that best aligns `r` to `l`, using a
 * fixed central analysis window so every lag correlates the same number of terms
 * (no bias toward lag 0). Returns the signed lag and the correlation's sign.
 */
function bestAlignment(l: Float32Array, r: Float32Array, maxLag: number): { lag: number; sign: number } {
  const n = l.length;
  // Central window, leaving maxLag of headroom on each side for the shifted reads.
  const start = Math.min(maxLag, n >> 2);
  const end = Math.max(start + 1, n - Math.min(maxLag, n >> 2));
  let bestLag = 0;
  let bestSign = 1;
  let bestAbs = -1;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0;
    let el = 0;
    let er = 0;
    for (let i = start; i < end; i++) {
      const a = l[i];
      const j = i + lag;
      const b = j >= 0 && j < n ? r[j] : 0;
      dot += a * b;
      el += a * a;
      er += b * b;
    }
    const denom = Math.sqrt(el * er);
    const corr = denom > 0 ? dot / denom : 0;
    if (Math.abs(corr) > bestAbs) {
      bestAbs = Math.abs(corr);
      bestLag = lag;
      bestSign = corr < 0 ? -1 : 1;
    }
  }
  return { lag: bestLag, sign: bestSign };
}

/**
 * Apply Automatic Phase Correction to a stereo buffer. In auto mode the right
 * channel is advanced/delayed (and optionally polarity-flipped) to align with
 * the left; in global mode each channel is shifted by the given ms.
 */
export function autoPhaseCorrect(d: AudioData, opts: AutoPhaseCorrectionOptions = {}): AudioData {
  const out = cloneAudioData(d);
  if (out.channels.length !== 2 || frameCount(d) === 0) return out; // needs an L/R pair

  const sr = d.sampleRate;
  if ((opts.mode ?? "auto") === "global") {
    const ls = Math.round(((opts.leftShiftMs ?? 0) / 1000) * sr);
    const rs = Math.round(((opts.rightShiftMs ?? 0) / 1000) * sr);
    out.channels[0] = shifted(d.channels[0], ls);
    out.channels[1] = shifted(d.channels[1], rs);
    return out;
  }

  const maxLag = Math.max(0, Math.round((clamp(opts.maxShiftMs ?? 5, 0, 100) / 1000) * sr));
  const { lag, sign } = bestAlignment(d.channels[0], d.channels[1], maxLag);
  // r[i+lag] aligns with l[i] → advance r by `lag` so r'[i] = r[i+lag] (shift = −lag).
  const right = shifted(d.channels[1], -lag);
  if (sign < 0 && (opts.correctPolarity ?? true)) {
    for (let i = 0; i < right.length; i++) right[i] = -right[i];
  }
  out.channels[0] = Float32Array.from(d.channels[0]);
  out.channels[1] = right;
  return out;
}
