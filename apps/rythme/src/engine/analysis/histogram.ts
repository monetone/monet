// ─────────────────────────────────────────────────────────────
// engine/analysis/histogram — amplitude distribution (dBFS)
// ─────────────────────────────────────────────────────────────
// The Histogram tab of Audition's Amplitude Statistics: how the sample values
// are distributed across loudness. Each sample's magnitude is converted to dBFS
// and tallied into a bin, so you can see whether the energy clusters near the
// peak (a square/limited signal), spreads out (a sine), or sits in the floor
// (a quiet take). Distinct from the numeric stats (peak / RMS / dynamic range).

import type { AudioData } from "../audio/types";

export interface AmplitudeHistogramOptions {
  /** Lowest dB bin edge (default −120). */
  minDb?: number;
  /** dB per bin (default 1). */
  binDb?: number;
}

export interface AmplitudeHistogramResult {
  /** Bin centre levels in dBFS, ascending (minDb + binDb/2 … −binDb/2). */
  binsDb: number[];
  /** Sample count in each bin, summed across all channels. */
  counts: number[];
  /** Total samples tallied (frames × channels). */
  total: number;
  /** Centre dB of the most-populated bin (the modal amplitude). */
  peakBinDb: number;
}

/** Tally every sample's |amplitude| in dBFS into a histogram. Input unmodified. */
export function amplitudeHistogram(d: AudioData, opts: AmplitudeHistogramOptions = {}): AmplitudeHistogramResult {
  const minDb = opts.minDb ?? -120;
  const binDb = Math.max(0.1, opts.binDb ?? 1);
  const nBins = Math.max(1, Math.ceil(-minDb / binDb)); // minDb … 0 dBFS

  const counts = new Array<number>(nBins).fill(0);
  let total = 0;
  for (const ch of d.channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      let db = a > 0 ? 20 * Math.log10(a) : minDb;
      if (db > 0) db = 0;
      else if (db < minDb) db = minDb;
      let idx = Math.floor((db - minDb) / binDb);
      if (idx >= nBins) idx = nBins - 1;
      else if (idx < 0) idx = 0;
      counts[idx]++;
      total++;
    }
  }

  const binsDb = new Array<number>(nBins);
  for (let i = 0; i < nBins; i++) binsDb[i] = minDb + (i + 0.5) * binDb;

  let best = 0;
  for (let i = 1; i < nBins; i++) if (counts[i] > counts[best]) best = i;

  return { binsDb, counts, total, peakBinDb: binsDb[best] };
}
