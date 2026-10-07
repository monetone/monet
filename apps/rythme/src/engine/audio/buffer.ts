// ─────────────────────────────────────────────────────────────
// engine/audio/buffer — AudioData construction & manipulation
// ─────────────────────────────────────────────────────────────
// Pure, allocation-honest helpers for building and reshaping sample buffers:
// create / clone / slice / concat / channel up-down-mix / linear resample /
// (de)interleave. Nothing here mutates its input unless the name says so.

import { AudioData, channelCount, frameCount } from "./types";

/** Allocate a silent buffer: `channels` planes of `frames` zeroed samples. */
export function createAudioData(channels: number, frames: number, sampleRate: number): AudioData {
  const ch: Float32Array[] = [];
  for (let c = 0; c < channels; c++) ch.push(new Float32Array(frames));
  return { sampleRate, channels: ch };
}

/** Build an AudioData from existing per-channel arrays (copies them). */
export function fromChannels(channels: ArrayLike<number>[], sampleRate: number): AudioData {
  return { sampleRate, channels: channels.map((c) => Float32Array.from(c)) };
}

/** Deep copy (new Float32Arrays). */
export function cloneAudioData(d: AudioData): AudioData {
  return { sampleRate: d.sampleRate, channels: d.channels.map((c) => c.slice()) };
}

/**
 * Copy a half-open frame range [start, end) into a new buffer. The range is
 * clamped to the buffer; start > end yields an empty (0-frame) buffer.
 */
export function sliceFrames(d: AudioData, start: number, end: number): AudioData {
  const n = frameCount(d);
  const s = Math.max(0, Math.min(n, Math.floor(start)));
  const e = Math.max(s, Math.min(n, Math.floor(end)));
  return { sampleRate: d.sampleRate, channels: d.channels.map((c) => c.slice(s, e)) };
}

/**
 * Concatenate buffers end-to-end. Requires a matching sample rate; channel
 * counts are reconciled up to the widest input (narrower inputs are up-mixed).
 */
export function concat(...parts: AudioData[]): AudioData {
  const real = parts.filter((p) => frameCount(p) > 0);
  if (real.length === 0) return createAudioData(parts[0] ? channelCount(parts[0]) : 1, 0, parts[0]?.sampleRate ?? 44100);
  const sampleRate = real[0].sampleRate;
  for (const p of real) {
    if (p.sampleRate !== sampleRate) throw new Error(`concat: sample-rate mismatch (${p.sampleRate} ≠ ${sampleRate})`);
  }
  const chN = Math.max(...real.map(channelCount));
  const normalized = real.map((p) => setChannelCount(p, chN));
  const total = normalized.reduce((sum, p) => sum + frameCount(p), 0);
  const out = createAudioData(chN, total, sampleRate);
  let offset = 0;
  for (const p of normalized) {
    for (let c = 0; c < chN; c++) out.channels[c].set(p.channels[c], offset);
    offset += frameCount(p);
  }
  return out;
}

/** Down-mix every channel to a single mono channel (equal-weight average). */
export function mixToMono(d: AudioData): AudioData {
  const n = frameCount(d);
  const ch = channelCount(d);
  const mono = new Float32Array(n);
  if (ch === 0) return { sampleRate: d.sampleRate, channels: [mono] };
  for (let c = 0; c < ch; c++) {
    const src = d.channels[c];
    for (let i = 0; i < n; i++) mono[i] += src[i];
  }
  for (let i = 0; i < n; i++) mono[i] /= ch;
  return { sampleRate: d.sampleRate, channels: [mono] };
}

/**
 * Return a buffer with exactly `target` channels.
 *  • equal count → clone
 *  • 1 → N: duplicate the mono channel
 *  • N → 1: average (mixToMono)
 *  • otherwise: keep/zero-pad channels up to target
 */
export function setChannelCount(d: AudioData, target: number): AudioData {
  const cur = channelCount(d);
  if (target < 1) throw new Error("setChannelCount: target must be ≥ 1");
  if (cur === target) return cloneAudioData(d);
  const n = frameCount(d);
  if (cur === 1) {
    const out = createAudioData(target, n, d.sampleRate);
    for (let c = 0; c < target; c++) out.channels[c].set(d.channels[0]);
    return out;
  }
  if (target === 1) return mixToMono(d);
  const out = createAudioData(target, n, d.sampleRate);
  for (let c = 0; c < target; c++) {
    if (c < cur) out.channels[c].set(d.channels[c]);
    else out.channels[c].set(d.channels[cur - 1]); // pad with last channel
  }
  return out;
}

/**
 * Resample to `targetRate` via linear interpolation. Cheap and artifact-prone
 * at extreme ratios, but deterministic and dependency-free — adequate for
 * editor preview and tests. Preserves channel count and total duration.
 */
export function resampleLinear(d: AudioData, targetRate: number): AudioData {
  if (targetRate <= 0) throw new Error("resampleLinear: targetRate must be > 0");
  if (targetRate === d.sampleRate) return cloneAudioData(d);
  const n = frameCount(d);
  const ratio = targetRate / d.sampleRate;
  const outN = Math.max(0, Math.round(n * ratio));
  const out = createAudioData(channelCount(d), outN, targetRate);
  if (n === 0) return out;
  for (let c = 0; c < channelCount(d); c++) {
    const src = d.channels[c];
    const dst = out.channels[c];
    for (let i = 0; i < outN; i++) {
      const srcPos = i / ratio;
      const i0 = Math.floor(srcPos);
      const i1 = Math.min(n - 1, i0 + 1);
      const frac = srcPos - i0;
      dst[i] = src[i0] * (1 - frac) + src[i1] * frac;
    }
  }
  return out;
}

/** Interleave planar channels into a single Float32Array (LRLR…). */
export function interleave(d: AudioData): Float32Array {
  const ch = channelCount(d);
  const n = frameCount(d);
  const out = new Float32Array(ch * n);
  for (let c = 0; c < ch; c++) {
    const src = d.channels[c];
    for (let i = 0; i < n; i++) out[i * ch + c] = src[i];
  }
  return out;
}

/** Inverse of {@link interleave}: split interleaved data back into planes. */
export function deinterleave(data: Float32Array, channels: number, sampleRate: number): AudioData {
  const n = Math.floor(data.length / channels);
  const out = createAudioData(channels, n, sampleRate);
  for (let c = 0; c < channels; c++) {
    const dst = out.channels[c];
    for (let i = 0; i < n; i++) dst[i] = data[i * channels + c];
  }
  return out;
}

/**
 * Map every sample through `fn` into a NEW buffer. `fn` receives the sample,
 * its frame index and channel index. Handy for stateless point processors.
 */
export function mapSamples(
  d: AudioData,
  fn: (sample: number, frame: number, channel: number) => number,
): AudioData {
  const out = cloneAudioData(d);
  for (let c = 0; c < out.channels.length; c++) {
    const arr = out.channels[c];
    for (let i = 0; i < arr.length; i++) arr[i] = fn(arr[i], i, c);
  }
  return out;
}

/** Write `src` into `dst` (in place) starting at frame `at`, mixing additively. */
export function mixInto(dst: AudioData, src: AudioData, at: number, gain = 1): void {
  const chN = channelCount(dst);
  const srcN = frameCount(src);
  const dstN = frameCount(dst);
  for (let c = 0; c < chN; c++) {
    const sc = src.channels[Math.min(c, channelCount(src) - 1)];
    if (!sc) continue;
    const dc = dst.channels[c];
    for (let i = 0; i < srcN; i++) {
      const j = at + i;
      if (j < 0 || j >= dstN) continue;
      dc[j] += sc[i] * gain;
    }
  }
}
