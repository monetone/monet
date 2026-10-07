// ─────────────────────────────────────────────────────────────
// engine/analysis/detect — silence & clipping detection
// ─────────────────────────────────────────────────────────────

import { dbToGain } from "../audio/db";
import { mixToMono } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import type { Seconds } from "../model/types";

export interface Region {
  start: Seconds;
  end: Seconds;
}

export interface AudioRegionOptions {
  /** Level at or below which audio counts as silence, dBFS. Default −50. */
  thresholdDb?: number;
  /** A silent gap at least this long separates two regions, ms. Default 300. */
  minSilenceMs?: number;
  /** Drop detected regions shorter than this, ms. Default 100. */
  minAudioMs?: number;
  /** Extend each region outward by this much (capturing onsets/tails), ms. Default 0. */
  padMs?: number;
}

/**
 * Find the non-silent regions — the spoken phrases / takes between the silent
 * gaps — as the complement of `detectSilence`. This is the core of "Mark Audio":
 * each region becomes a cue range. Regions shorter than `minAudioMs` are dropped.
 */
export function detectAudioRegions(d: AudioData, opts: AudioRegionOptions = {}): Region[] {
  const dur = frameCount(d) / d.sampleRate;
  if (dur <= 0) return [];
  const minSilenceSec = (opts.minSilenceMs ?? 300) / 1000;
  const minAudioSec = (opts.minAudioMs ?? 100) / 1000;
  const pad = (opts.padMs ?? 0) / 1000;

  const silence = detectSilence(d, opts.thresholdDb ?? -50, minSilenceSec);
  const spans: Region[] = [];
  let cursor = 0;
  for (const sil of silence) {
    if (sil.start > cursor) spans.push({ start: cursor, end: sil.start });
    cursor = sil.end;
  }
  if (cursor < dur) spans.push({ start: cursor, end: dur });

  const out: Region[] = [];
  for (const r of spans) {
    const start = Math.max(0, r.start - pad);
    const end = Math.min(dur, r.end + pad);
    if (end - start >= minAudioSec) out.push({ start, end });
  }
  return out;
}

/**
 * Find silent regions: spans where the mono mix stays below `thresholdDb` for
 * at least `minSeconds`. Used by "Truncate Silence" and auto-labeling.
 */
export function detectSilence(d: AudioData, thresholdDb = -60, minSeconds = 0.2): Region[] {
  const mono = mixToMono(d).channels[0];
  const sr = d.sampleRate;
  const thresh = dbToGain(thresholdDb);
  const minSamples = Math.round(minSeconds * sr);
  const regions: Region[] = [];
  let runStart = -1;
  for (let i = 0; i <= mono.length; i++) {
    const silent = i < mono.length && Math.abs(mono[i]) < thresh;
    if (silent && runStart < 0) runStart = i;
    if ((!silent || i === mono.length) && runStart >= 0) {
      if (i - runStart >= minSamples) regions.push({ start: runStart / sr, end: i / sr });
      runStart = -1;
    }
  }
  return regions;
}

export interface ClipReport {
  /** Number of clipped samples across all channels. */
  count: number;
  /** Frame indices of the first few clipped samples (capped). */
  positions: number[];
}

/** Detect clipped (full-scale) samples. */
export function detectClipping(d: AudioData, ceiling = 0.999969, maxPositions = 256): ClipReport {
  let count = 0;
  const positions: number[] = [];
  for (const ch of d.channels) {
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) >= ceiling) {
        count++;
        if (positions.length < maxPositions) positions.push(i);
      }
    }
  }
  return { count, positions };
}
