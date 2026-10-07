// ─────────────────────────────────────────────────────────────
// engine/generate/tone — oscillators, chirp & DTMF
// ─────────────────────────────────────────────────────────────

import { concat, createAudioData } from "../audio/buffer";
import type { AudioData } from "../audio/types";
import { DEFAULT_SAMPLE_RATE } from "../model/factory";

export type Waveform = "sine" | "square" | "sawtooth" | "triangle";

export interface ToneOptions {
  sampleRate?: number;
  amplitude?: number;
  channels?: number;
  /** Starting phase in radians. */
  phase?: number;
}

/** One cycle of the chosen waveform at phase θ (radians), range ~[-1, 1]. */
function oscillator(waveform: Waveform, theta: number): number {
  const t = theta / (2 * Math.PI);
  const frac = t - Math.floor(t); // 0..1
  switch (waveform) {
    case "sine":
      return Math.sin(theta);
    case "square":
      return frac < 0.5 ? 1 : -1;
    case "sawtooth":
      return 2 * frac - 1;
    case "triangle":
      return frac < 0.5 ? 4 * frac - 1 : 3 - 4 * frac;
  }
}

/** Generate a constant-frequency tone. */
export function tone(waveform: Waveform, freq: number, seconds: number, opts: ToneOptions = {}): AudioData {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const amp = opts.amplitude ?? 0.8;
  const channels = opts.channels ?? 1;
  const phase0 = opts.phase ?? 0;
  const n = Math.max(0, Math.round(seconds * sampleRate));
  const d = createAudioData(channels, n, sampleRate);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < n; i++) {
    const v = amp * oscillator(waveform, phase0 + w * i);
    for (let c = 0; c < channels; c++) d.channels[c][i] = v;
  }
  return d;
}

export const sine = (freq: number, seconds: number, opts?: ToneOptions) => tone("sine", freq, seconds, opts);
export const square = (freq: number, seconds: number, opts?: ToneOptions) => tone("square", freq, seconds, opts);
export const sawtooth = (freq: number, seconds: number, opts?: ToneOptions) => tone("sawtooth", freq, seconds, opts);
export const triangle = (freq: number, seconds: number, opts?: ToneOptions) => tone("triangle", freq, seconds, opts);

/**
 * Linear or logarithmic frequency sweep (chirp) from `startHz` to `endHz`.
 * Phase is integrated so the sweep is continuous (no clicks).
 */
export function chirp(
  startHz: number,
  endHz: number,
  seconds: number,
  opts: ToneOptions & { log?: boolean } = {},
): AudioData {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const amp = opts.amplitude ?? 0.8;
  const channels = opts.channels ?? 1;
  const n = Math.max(0, Math.round(seconds * sampleRate));
  const d = createAudioData(channels, n, sampleRate);
  let phase = opts.phase ?? 0;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const f = opts.log
      ? startHz * Math.pow(endHz / startHz, t)
      : startHz + (endHz - startHz) * t;
    phase += (2 * Math.PI * f) / sampleRate;
    const v = amp * Math.sin(phase);
    for (let c = 0; c < channels; c++) d.channels[c][i] = v;
  }
  return d;
}

/** The two-tone frequency pairs for telephone DTMF keys. */
export const DTMF_FREQS: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477], A: [697, 1633],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477], B: [770, 1633],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477], C: [852, 1633],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477], D: [941, 1633],
};

export interface TonesOptions extends ToneOptions {
  /** Base oscillator. Default "sine". */
  waveform?: Waveform;
  /** Frequency-modulation depth in Hz (peak-to-peak: the pitch swings ±depth/2). Default 0. */
  modDepthHz?: number;
  /** Frequency-modulation rate in Hz (the warble speed). Default 0. */
  modRateHz?: number;
  /** Overtones added above the fundamental, 0…5, each at 1/(k+1) amplitude. Default 0. */
  harmonics?: number;
}

/**
 * Adobe Audition–style Generate ▸ Tones: a base frequency with optional
 * frequency modulation (a `modDepthHz`-wide pitch warble at `modRateHz`) and up
 * to five harmonics. The instantaneous frequency is integrated into the phase so
 * the modulation is click-free, and the harmonics track that modulated phase.
 * Output is peak-normalized to `amplitude`. Pure; allocates a fresh buffer.
 */
export function tones(freq: number, seconds: number, opts: TonesOptions = {}): AudioData {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const amp = opts.amplitude ?? 0.8;
  const channels = opts.channels ?? 1;
  const waveform = opts.waveform ?? "sine";
  const depth = Math.max(0, opts.modDepthHz ?? 0);
  const rate = Math.max(0, opts.modRateHz ?? 0);
  const harmonics = Math.max(0, Math.min(5, Math.round(opts.harmonics ?? 0)));
  const n = Math.max(0, Math.round(seconds * sampleRate));
  const d = createAudioData(channels, n, sampleRate);

  // Normalize so the fundamental + harmonics together peak near `amp`.
  let norm = 1;
  for (let h = 1; h <= harmonics; h++) norm += 1 / (h + 1);
  const scale = amp / norm;
  const twoPiPerSr = (2 * Math.PI) / sampleRate;

  let phase = opts.phase ?? 0; // integrated phase of the fundamental
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const instFreq = freq + (depth / 2) * Math.sin(2 * Math.PI * rate * t);
    let v = oscillator(waveform, phase);
    for (let h = 1; h <= harmonics; h++) v += oscillator(waveform, phase * (h + 1)) / (h + 1);
    const s = scale * v;
    for (let c = 0; c < channels; c++) d.channels[c][i] = s;
    phase += twoPiPerSr * instFreq;
  }
  return d;
}

/** Generate a DTMF dual-tone for a keypad key. */
export function dtmf(key: string, seconds = 0.2, opts: ToneOptions = {}): AudioData {
  const pair = DTMF_FREQS[key.toUpperCase()];
  if (!pair) throw new Error(`dtmf: unknown key "${key}"`);
  const a = sine(pair[0], seconds, { ...opts, amplitude: (opts.amplitude ?? 0.8) / 2 });
  const b = sine(pair[1], seconds, { ...opts, amplitude: (opts.amplitude ?? 0.8) / 2 });
  for (let c = 0; c < a.channels.length; c++) {
    for (let i = 0; i < a.channels[c].length; i++) a.channels[c][i] += b.channels[c][i];
  }
  return a;
}

export interface DtmfSequenceOptions extends ToneOptions {
  /** Length of each key's tone, ms. Default 100. */
  toneMs?: number;
  /** Silence between consecutive tones, ms. Default 50. */
  breakMs?: number;
  /** Silence inserted for a pause character (space / comma / dash), ms. Default 500. */
  pauseMs?: number;
}

/** Is `ch` a pause / separator character in a dial string? */
function isDtmfPause(ch: string): boolean {
  return ch === " " || ch === "," || ch === "-";
}

/**
 * Adobe Audition–style Generate ▸ DTMF Signals: dial a whole string of touch
 * tones. Each valid key (0–9, *, #, A–D) becomes a dual-tone of `toneMs`, tones
 * are separated by `breakMs` of silence, and a space / comma / dash inserts a
 * `pauseMs` pause. Unknown characters are skipped. Pure; allocates a new buffer.
 */
export function dtmfSequence(dialString: string, opts: DtmfSequenceOptions = {}): AudioData {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const channels = opts.channels ?? 1;
  const toneSec = Math.max(0, (opts.toneMs ?? 100) / 1000);
  const breakN = Math.max(0, Math.round(((opts.breakMs ?? 50) / 1000) * sampleRate));
  const pauseN = Math.max(0, Math.round(((opts.pauseMs ?? 500) / 1000) * sampleRate));

  const segments: AudioData[] = [];
  let prevWasTone = false;
  for (const raw of dialString) {
    if (isDtmfPause(raw)) {
      if (pauseN > 0) segments.push(createAudioData(channels, pauseN, sampleRate));
      prevWasTone = false;
      continue;
    }
    if (!(raw.toUpperCase() in DTMF_FREQS)) continue; // skip unknown characters
    if (prevWasTone && breakN > 0) segments.push(createAudioData(channels, breakN, sampleRate));
    segments.push(dtmf(raw, toneSec, { sampleRate, channels, amplitude: opts.amplitude }));
    prevWasTone = true;
  }

  if (!segments.length) return createAudioData(channels, 0, sampleRate);
  return concat(...segments);
}
