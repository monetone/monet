// ─────────────────────────────────────────────────────────────
// engine/dsp/spectral-edit — Spectral Frequency Display edits
// ─────────────────────────────────────────────────────────────
// Frequency-local gain/silence for Audition-style rectangular spectral
// selections. The processor is pure and works on the supplied buffer; callers
// constrain time by slicing/splitting before invoking it.

import { cloneAudioData } from "../audio/buffer";
import { clamp } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { fftFilter, type FFTFilterPoint } from "./fft-filter";

export type SpectralEditChannel = "all" | "left" | "right";

export interface SpectralGainOptions {
  minHz: number;
  maxHz: number;
  gainDb: number;
  /** FFT size (power of two), default inherited from fftFilter. */
  fftSize?: number;
  /** Width of each transition edge in Hz. */
  transitionHz?: number;
  /** Which channel plane to process. */
  channel?: SpectralEditChannel;
}

export interface SpectralHarmonicGainOptions {
  /** Fundamental frequency for the harmonic stack, in Hz. */
  fundamentalHz: number;
  /** Width of each harmonic band, centered on the harmonic frequency. */
  bandwidthHz: number;
  /** Number of integer harmonics to process, including the fundamental. */
  harmonics: number;
  gainDb: number;
  /** FFT size (power of two), default inherited from fftFilter. */
  fftSize?: number;
  /** Width of each transition edge in Hz. */
  transitionHz?: number;
  /** Which channel plane to process. */
  channel?: SpectralEditChannel;
}

export interface SpectralBrushGainOptions extends SpectralGainOptions {
  /** Raised-cosine blend exponent; higher values make a tighter center. */
  hardness?: number;
  /** Frequency-axis brush tightness; higher values preserve more of the selected band edges. */
  frequencyHardness?: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function bandCurve(sampleRate: number, opts: SpectralGainOptions): FFTFilterPoint[] | null {
  const nyquist = Math.max(1, sampleRate / 2);
  let lo = finiteOr(opts.minHz, 0);
  let hi = finiteOr(opts.maxHz, nyquist);
  if (hi < lo) [lo, hi] = [hi, lo];
  lo = clamp(lo, 0, nyquist);
  hi = clamp(hi, 0, nyquist);
  if (hi <= lo) return null;

  const fftSize = opts.fftSize ?? 2048;
  const transition = Math.max(0, finiteOr(opts.transitionHz ?? (sampleRate / fftSize) * 2, 0));
  const edgeLo = Math.max(0, lo - transition);
  const edgeHi = Math.min(nyquist, hi + transition);
  return [
    { freq: 0, gainDb: lo <= 0 ? opts.gainDb : 0 },
    { freq: edgeLo, gainDb: 0 },
    { freq: lo, gainDb: opts.gainDb },
    { freq: hi, gainDb: opts.gainDb },
    { freq: edgeHi, gainDb: 0 },
    { freq: nyquist, gainDb: hi >= nyquist ? opts.gainDb : 0 },
  ].sort((a, b) => a.freq - b.freq);
}

function brushCurve(sampleRate: number, opts: SpectralBrushGainOptions): FFTFilterPoint[] | null {
  const nyquist = Math.max(1, sampleRate / 2);
  let lo = finiteOr(opts.minHz, 0);
  let hi = finiteOr(opts.maxHz, nyquist);
  if (hi < lo) [lo, hi] = [hi, lo];
  lo = clamp(lo, 0, nyquist);
  hi = clamp(hi, 0, nyquist);
  if (hi <= lo) return null;

  const hardness = clamp(finiteOr(opts.frequencyHardness ?? 4, 4), 0.25, 12);
  const points: FFTFilterPoint[] = [
    { freq: 0, gainDb: 0 },
    { freq: lo, gainDb: 0 },
  ];
  for (let i = 1; i < 16; i++) {
    const t = i / 16;
    const freq = lo + (hi - lo) * t;
    const weight = Math.pow(Math.sin(Math.PI * t), hardness);
    points.push({ freq, gainDb: opts.gainDb * weight });
  }
  points.push(
    { freq: hi, gainDb: 0 },
    { freq: nyquist, gainDb: 0 },
  );
  return points.sort((a, b) => a.freq - b.freq);
}

/** Apply gain to one spectral frequency band, preserving all other bins. */
export function spectralGain(d: AudioData, opts: SpectralGainOptions): AudioData {
  const n = frameCount(d);
  const channels = channelCount(d);
  if (n === 0 || channels === 0) return cloneAudioData(d);
  if (!Number.isFinite(opts.gainDb) || opts.gainDb === 0) return cloneAudioData(d);

  const curve = bandCurve(d.sampleRate, opts);
  if (!curve) return cloneAudioData(d);

  const channel = opts.channel ?? "all";
  if (channel === "all") return fftFilter(d, { curve, fftSize: opts.fftSize });

  const index = channel === "left" ? 0 : 1;
  const out = cloneAudioData(d);
  if (index >= channels) return out;

  const processed = fftFilter({ sampleRate: d.sampleRate, channels: [d.channels[index]] }, { curve, fftSize: opts.fftSize });
  out.channels[index] = processed.channels[0];
  return out;
}

/** Apply a soft time-local spectral brush stroke over one selected band. */
export function spectralBrushGain(d: AudioData, opts: SpectralBrushGainOptions): AudioData {
  const n = frameCount(d);
  const channels = channelCount(d);
  if (n === 0 || channels === 0) return cloneAudioData(d);
  if (!Number.isFinite(opts.gainDb) || opts.gainDb === 0) return cloneAudioData(d);

  const curve = brushCurve(d.sampleRate, opts);
  if (!curve) return cloneAudioData(d);

  const channel = opts.channel ?? "all";
  let processed: AudioData;
  if (channel === "all") {
    processed = fftFilter(d, { curve, fftSize: opts.fftSize });
  } else {
    const index = channel === "left" ? 0 : 1;
    processed = cloneAudioData(d);
    if (index < channels) {
      const channelProcessed = fftFilter({ sampleRate: d.sampleRate, channels: [d.channels[index]] }, { curve, fftSize: opts.fftSize });
      processed.channels[index] = channelProcessed.channels[0];
    }
  }

  const out = cloneAudioData(d);
  const hardness = clamp(finiteOr(opts.hardness ?? 1, 1), 0.25, 8);
  const denom = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0.5 : i / denom;
    const weight = Math.pow(Math.sin(Math.PI * x), hardness);
    for (let ch = 0; ch < channels; ch++) {
      out.channels[ch][i] = out.channels[ch][i] + (processed.channels[ch][i] - out.channels[ch][i]) * weight;
    }
  }
  return out;
}

/** Apply the same spectral edit to a fundamental and its integer harmonics. */
export function spectralHarmonicGain(d: AudioData, opts: SpectralHarmonicGainOptions): AudioData {
  const n = frameCount(d);
  const channels = channelCount(d);
  if (n === 0 || channels === 0) return cloneAudioData(d);
  if (!Number.isFinite(opts.gainDb) || opts.gainDb === 0) return cloneAudioData(d);

  const nyquist = Math.max(1, d.sampleRate / 2);
  const fundamentalHz = clamp(finiteOr(opts.fundamentalHz, 0), 1, nyquist);
  const bandwidthHz = clamp(finiteOr(opts.bandwidthHz, 0), 1, nyquist);
  const harmonics = Math.max(1, Math.min(64, Math.round(finiteOr(opts.harmonics, 1))));
  let out = cloneAudioData(d);

  for (let harmonic = 1; harmonic <= harmonics; harmonic++) {
    const center = fundamentalHz * harmonic;
    if (center > nyquist) break;
    const half = bandwidthHz / 2;
    out = spectralGain(out, {
      minHz: center - half,
      maxHz: center + half,
      gainDb: opts.gainDb,
      fftSize: opts.fftSize,
      transitionHz: opts.transitionHz,
      channel: opts.channel,
    });
  }

  return out;
}

/** Remove a spectral band by applying a practical silence floor. */
export function spectralSilence(d: AudioData, opts: Omit<SpectralGainOptions, "gainDb">): AudioData {
  return spectralGain(d, { ...opts, gainDb: -120 });
}
