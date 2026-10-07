// ─────────────────────────────────────────────────────────────
// engine/analysis/amplitude-stats — Adobe Audition–style Amplitude Statistics
// ─────────────────────────────────────────────────────────────
// Audition's Window ▸ Amplitude Statistics panel (General tab): a numeric report
// of a selection's amplitude — per channel and overall — that surfaces dynamic
// range, clipped samples and DC offset at a glance. Pure measurement over the
// samples (no DOM, no mutation): peak (the loudest sample, linear + dBFS),
// signed min/max sample, Possibly Clipped Samples (should be 0), DC offset, the
// minimum / maximum / average / total RMS power, and the dynamic range (max − min
// RMS, ignoring near-silent windows so a fade-to-silence doesn't inflate it).

import { gainToDb } from "../audio/db";
import type { AudioData } from "../audio/types";
import { channelStats, rmsEnvelope } from "./levels";

export interface ChannelAmplitudeStats {
  /** Signed minimum / maximum sample value (linear). */
  minSample: number;
  maxSample: number;
  /** Loudest sample magnitude, linear and dBFS. */
  peak: number;
  peakDb: number;
  /** Samples sitting at (or beyond) full scale — distortion if non-zero. */
  possiblyClippedSamples: number;
  /** Mean (DC) offset, linear and dBFS of its magnitude. */
  dcOffset: number;
  dcOffsetDb: number;
  /** Windowed RMS power statistics, in dBFS. */
  minRmsDb: number;
  maxRmsDb: number;
  averageRmsDb: number;
  /** RMS of the whole channel, in dBFS. */
  totalRmsDb: number;
  /** Max − min RMS over non-silent windows, in dB. */
  dynamicRangeDb: number;
}

export interface AmplitudeStatistics {
  /** Statistics for each channel. */
  channels: ChannelAmplitudeStats[];
  /** Aggregate across all channels. */
  overall: ChannelAmplitudeStats;
  /** RMS analysis window length used, in ms. */
  windowMs: number;
}

export interface AmplitudeStatisticsOptions {
  /** RMS analysis window in ms (default 50). */
  windowMs?: number;
  /** Full-scale ceiling for the clipped-sample count (default ~16-bit FS). */
  ceiling?: number;
  /**
   * Windows quieter than this many dB below the loudest window are treated as
   * silence and excluded from the minimum-RMS / dynamic-range figures. Default 60.
   */
  silenceFloorDb?: number;
}

const DEFAULT_WINDOW_MS = 50;
const DEFAULT_CEILING = 0.999969;
const DEFAULT_SILENCE_FLOOR_DB = 60;

/** Per-channel amplitude statistics for one sample buffer. */
function statsForChannel(ch: Float32Array, sampleRate: number, opts: Required<AmplitudeStatisticsOptions>): ChannelAmplitudeStats {
  const base = channelStats(ch); // peak / dcOffset / clipped (recomputes clipped at our ceiling below)

  let minSample = ch.length ? Infinity : 0;
  let maxSample = ch.length ? -Infinity : 0;
  let clipped = 0;
  for (let i = 0; i < ch.length; i++) {
    const v = ch[i];
    if (v < minSample) minSample = v;
    if (v > maxSample) maxSample = v;
    if (Math.abs(v) >= opts.ceiling) clipped++;
  }
  if (!ch.length) {
    minSample = 0;
    maxSample = 0;
  }

  const windowSamples = Math.max(1, Math.round((opts.windowMs / 1000) * sampleRate));
  const env = rmsEnvelope(ch, windowSamples);
  let maxEnv = 0;
  let sumEnv = 0;
  for (const e of env) {
    if (e > maxEnv) maxEnv = e;
    sumEnv += e;
  }
  // Minimum RMS over non-silent windows only (within silenceFloorDb of the loudest).
  const floor = maxEnv * Math.pow(10, -opts.silenceFloorDb / 20);
  let minEnv = Infinity;
  for (const e of env) if (e >= floor) minEnv = Math.min(minEnv, e);
  if (!Number.isFinite(minEnv)) minEnv = maxEnv; // all silent → no spread
  const avgEnv = env.length ? sumEnv / env.length : 0;

  const maxRmsDb = gainToDb(maxEnv);
  const minRmsDb = gainToDb(minEnv);

  return {
    minSample,
    maxSample,
    peak: base.peak,
    peakDb: base.peakDb,
    possiblyClippedSamples: clipped,
    dcOffset: base.dcOffset,
    dcOffsetDb: gainToDb(Math.abs(base.dcOffset)),
    minRmsDb,
    maxRmsDb,
    averageRmsDb: gainToDb(avgEnv),
    totalRmsDb: base.rmsDb,
    dynamicRangeDb: Math.max(0, maxRmsDb - minRmsDb),
  };
}

/**
 * Compute Amplitude Statistics for a buffer: one entry per channel plus an
 * aggregate over all channels. Pure; the input is never read destructively.
 */
export function amplitudeStatistics(d: AudioData, options: AmplitudeStatisticsOptions = {}): AmplitudeStatistics {
  const opts: Required<AmplitudeStatisticsOptions> = {
    windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
    ceiling: options.ceiling ?? DEFAULT_CEILING,
    silenceFloorDb: options.silenceFloorDb ?? DEFAULT_SILENCE_FLOOR_DB,
  };

  const channels = d.channels.map((ch) => statsForChannel(ch, d.sampleRate, opts));

  // Aggregate: the loudest peak, widest sample extremes, summed clips, and the
  // RMS figures pooled across channels (energy sum for the totals).
  let totalSumSq = 0;
  let totalLen = 0;
  let dcSum = 0;
  for (const ch of d.channels) {
    for (let i = 0; i < ch.length; i++) {
      totalSumSq += ch[i] * ch[i];
      dcSum += ch[i];
    }
    totalLen += ch.length;
  }
  const overallRms = totalLen ? Math.sqrt(totalSumSq / totalLen) : 0;
  const overall: ChannelAmplitudeStats = channels.length
    ? {
        minSample: Math.min(...channels.map((c) => c.minSample)),
        maxSample: Math.max(...channels.map((c) => c.maxSample)),
        peak: Math.max(...channels.map((c) => c.peak)),
        peakDb: Math.max(...channels.map((c) => c.peakDb)),
        possiblyClippedSamples: channels.reduce((a, c) => a + c.possiblyClippedSamples, 0),
        dcOffset: totalLen ? dcSum / totalLen : 0,
        dcOffsetDb: gainToDb(Math.abs(totalLen ? dcSum / totalLen : 0)),
        minRmsDb: Math.min(...channels.map((c) => c.minRmsDb)),
        maxRmsDb: Math.max(...channels.map((c) => c.maxRmsDb)),
        averageRmsDb: gainToDb(overallRms),
        totalRmsDb: gainToDb(overallRms),
        dynamicRangeDb: Math.max(0, Math.max(...channels.map((c) => c.maxRmsDb)) - Math.min(...channels.map((c) => c.minRmsDb))),
      }
    : statsForChannel(new Float32Array(0), d.sampleRate, opts);

  return { channels, overall, windowMs: opts.windowMs };
}
