// ─────────────────────────────────────────────────────────────
// engine/analysis/phase-analysis — Adobe Audition–style Phase Analysis
// ─────────────────────────────────────────────────────────────
// Audition's Phase Analysis / Phase Meter: compares the phase relationship of a
// stereo pair so you can catch out-of-phase content that turns thin or cancels
// when summed to mono. The headline number is the correlation: +1 = identical
// content in both channels (perfectly in phase / mono-safe), 0 = uncorrelated
// (wide), −1 = one channel is the polarity-inverted other (total cancellation in
// mono). Alongside it we report the L↔R balance, the stereo width (how much of
// the energy lives in the side signal), and the mono compatibility (how much
// level survives a fold-down to mono). Pure measurement; never mutates input.

import type { AudioData } from "../audio/types";

export interface PhaseAnalysis {
  /** L/R correlation, −1 (inverted) … 0 (uncorrelated) … +1 (identical). */
  correlation: number;
  /** Energy balance, −1 (hard left) … 0 (centred) … +1 (hard right). */
  balance: number;
  /** Stereo width from the mid/side split: 0 (mono) … 1 (all side / fully inverted). */
  width: number;
  /** Mono fold-down survival: rms(mid) ÷ louder channel, 0 (cancels) … ~1 (intact). */
  monoCompatibility: number;
  /** True when the input has a real L/R pair to compare. */
  stereo: boolean;
}

/** Default reading for content with no phase relationship to measure (mono / silence). */
const IN_PHASE: Omit<PhaseAnalysis, "stereo"> = { correlation: 1, balance: 0, width: 0, monoCompatibility: 1 };

/**
 * Phase analysis of a stereo pair (channels 0 and 1). Mono input — or a stereo
 * buffer with no energy — reads as perfectly in-phase (nothing can cancel).
 */
export function phaseAnalysis(d: AudioData): PhaseAnalysis {
  if (d.channels.length < 2) return { ...IN_PHASE, stereo: false };

  const L = d.channels[0];
  const R = d.channels[1];
  const n = Math.min(L.length, R.length);

  let sumLR = 0;
  let sumLL = 0;
  let sumRR = 0;
  let sumMid = 0;
  let sumSide = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i];
    const r = R[i];
    sumLR += l * r;
    sumLL += l * l;
    sumRR += r * r;
    const mid = (l + r) / 2;
    const side = (l - r) / 2;
    sumMid += mid * mid;
    sumSide += side * side;
  }

  if (sumLL <= 0 && sumRR <= 0) return { ...IN_PHASE, stereo: true }; // silence

  const denom = Math.sqrt(sumLL * sumRR);
  const correlation = denom > 0 ? clampUnit(sumLR / denom) : 0;
  const balance = sumLL + sumRR > 0 ? (sumRR - sumLL) / (sumRR + sumLL) : 0;
  const width = sumMid + sumSide > 0 ? sumSide / (sumMid + sumSide) : 0;
  const louder = Math.sqrt(Math.max(sumLL, sumRR));
  const monoCompatibility = louder > 0 ? Math.sqrt(sumMid) / louder : 1;

  return { correlation, balance, width, monoCompatibility, stereo: true };
}

function clampUnit(x: number): number {
  return Math.max(-1, Math.min(1, x));
}
