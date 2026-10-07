// ─────────────────────────────────────────────────────────────
// engine/dsp/declipper.test — Audition-style DeClipper / Clip Restoration
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { magnitudes } from "../analysis/fft";
import { sine } from "../generate/tone";
import { deClip } from "./declipper";

const SR = 44100;
const FFT = 8192;
const CLIP = 0.6;

const buffer = (samples: number[]): AudioData => ({ sampleRate: SR, channels: [Float32Array.from(samples)] });

/** Hard-clip a copy of `ch` at ±level (the flat-topped distortion DeClipper repairs). */
function clipTo(ch: Float32Array, level: number): Float32Array {
  const out = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) out[i] = Math.max(-level, Math.min(level, ch[i]));
  return out;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function peak(ch: Float32Array): number {
  let p = 0;
  for (const v of ch) p = Math.max(p, Math.abs(v));
  return p;
}

/** Mean |a-b| over the samples where the ORIGINAL exceeded the clip level (the repaired regions). */
function clippedRegionError(restored: Float32Array, original: Float32Array, level: number): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < original.length; i++) {
    if (Math.abs(original[i]) > level) {
      sum += Math.abs(restored[i] - original[i]);
      count++;
    }
  }
  return count ? sum / count : 0;
}

/** Raw-FFT magnitude at `freq`; callers must place `freq` on an exact bin. */
function magAt(ch: Float32Array, freq: number): number {
  return magnitudes(ch, FFT)[Math.round((freq * FFT) / SR)];
}

describe("deClip", () => {
  it("restores a clipped peak: lower error, peak above the clip level, less 3f distortion", () => {
    const f = (200 * SR) / FFT; // ≈ 1077 Hz, on an exact FFT bin (so is 3f)
    const orig = sine(f, FFT / SR, { sampleRate: SR, amplitude: 0.9 }).channels[0];
    const clipped = clipTo(orig, CLIP);
    const restored = deClip({ sampleRate: SR, channels: [clipped] }, { threshold: 0.55 }).channels[0];

    // 1) closer to the true (unclipped) signal across the repaired regions
    expect(clippedRegionError(restored, orig, CLIP)).toBeLessThan(clippedRegionError(clipped, orig, CLIP) * 0.7);
    // 2) the lost peak is rebuilt above the clip level, still bounded to [-1,1]
    expect(peak(restored)).toBeGreaterThan(CLIP);
    expect(peak(restored)).toBeLessThanOrEqual(1);
    // 3) clipping's odd-harmonic (3f) distortion is reduced
    expect(magAt(restored, 3 * f)).toBeLessThan(magAt(clipped, 3 * f));
  });

  it("leaves an unclipped signal essentially unchanged", () => {
    const clean = sine(440, 0.1, { sampleRate: SR, amplitude: 0.5 });
    const out = deClip(clean, { threshold: 0.95 });
    expect(maxAbsDiff(out.channels[0], clean.channels[0])).toBeLessThan(1e-9);
  });

  it("threshold controls detection (high threshold ignores mild clipping, lower one repairs it)", () => {
    const orig = sine(660, 0.1, { sampleRate: SR, amplitude: 0.9 }).channels[0];
    const clipped = clipTo(orig, CLIP); // flats sit at ±0.6
    const ignored = deClip({ sampleRate: SR, channels: [clipped] }, { threshold: 0.95 }).channels[0];
    const repaired = deClip({ sampleRate: SR, channels: [clipped] }, { threshold: 0.55 }).channels[0];
    // Threshold above the clip level → nothing detected → unchanged.
    expect(maxAbsDiff(ignored, clipped)).toBe(0);
    // Threshold below it → peaks rebuilt above the flat.
    expect(peak(repaired)).toBeGreaterThan(CLIP);
  });

  it("rebuilds both positive and negative clipped half-cycles", () => {
    const orig = sine(500, 0.05, { sampleRate: SR, amplitude: 0.9 }).channels[0];
    const clipped = clipTo(orig, CLIP);
    const restored = deClip({ sampleRate: SR, channels: [clipped] }, { threshold: 0.55 }).channels[0];
    let maxPos = 0;
    let minNeg = 0;
    for (const v of restored) {
      if (v > maxPos) maxPos = v;
      if (v < minNeg) minNeg = v;
    }
    expect(maxPos).toBeGreaterThan(CLIP);
    expect(minNeg).toBeLessThan(-CLIP);
  });

  it("does not push reconstructed samples out of range", () => {
    const orig = sine(330, 0.1, { sampleRate: SR, amplitude: 0.99 }).channels[0];
    const restored = deClip({ sampleRate: SR, channels: [clipTo(orig, 0.5)] }, { threshold: 0.45 }).channels[0];
    expect(peak(restored)).toBeLessThanOrEqual(1);
  });

  it("preserves frame count and is deterministic", () => {
    const clipped = clipTo(sine(440, 0.1, { sampleRate: SR, amplitude: 0.9 }).channels[0], CLIP);
    const src: AudioData = { sampleRate: SR, channels: [clipped] };
    const a = deClip(src, { threshold: 0.55 });
    const b = deClip(src, { threshold: 0.55 });
    expect(frameCount(a)).toBe(frameCount(src));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const clipped = clipTo(sine(440, 0.1, { sampleRate: SR, amplitude: 0.9 }).channels[0], CLIP);
    const src: AudioData = { sampleRate: SR, channels: [clipped] };
    const snap = Float32Array.from(clipped);
    deClip(src, { threshold: 0.55 });
    expect(maxAbsDiff(src.channels[0], snap)).toBe(0);
  });

  it("handles empty and too-short buffers", () => {
    expect(frameCount(deClip(createAudioData(1, 0, SR), {}))).toBe(0);
    const tiny = deClip(buffer([1, 1, 1]), { threshold: 0.5 });
    expect(frameCount(tiny)).toBe(3); // < 4 samples → left untouched, no throw
  });

  it("leaves a clipped run at the buffer edge untouched (no out-of-bounds slope)", () => {
    // Run touches the start: indices 0..1 are clipped, no good samples before.
    const out = deClip(buffer([1, 1, 0.2, -0.1, 0.0, 0.1]), { threshold: 0.9 });
    expect(out.channels[0][0]).toBe(1);
    expect(out.channels[0][1]).toBe(1);
  });

  it("leaves a CLEAN loud (unclipped) tone unchanged across frequencies — no flat plateau", () => {
    // A clean crest is a run of same-sign samples above the threshold but it keeps
    // curving (no flat plateau), so the flatness gate must not 'repair' it.
    for (const f of [200, 1000, 3000, 6000]) {
      const clean = sine(f, 0.05, { sampleRate: SR, amplitude: 0.99 });
      const out = deClip(clean, { threshold: 0.88 }); // the most aggressive shipped threshold
      expect(maxAbsDiff(out.channels[0], clean.channels[0])).toBeLessThan(1e-6);
    }
  });

  it("does not hang or corrupt on non-finite (NaN/Infinity) samples", () => {
    // Forward progress must be guaranteed: NaN samples fail |x|>=threshold and are skipped.
    const src = buffer([0.1, NaN, 0.6, 0.6, 0.6, 0.6, 0.6, Infinity, -0.2, 0.3]);
    const out = deClip(src, { threshold: 0.5, minRunLength: 3 });
    expect(frameCount(out)).toBe(frameCount(src));
    // The finite, non-clipped samples are untouched; NaN/Inf are passed through (still non-finite, never block).
    expect(out.channels[0][0]).toBeCloseTo(0.1, 6);
    expect(out.channels[0][8]).toBeCloseTo(-0.2, 6);
  });

  it("repairs each channel of a stereo buffer independently", () => {
    const left = clipTo(sine(440, 0.1, { sampleRate: SR, amplitude: 0.9 }).channels[0], CLIP);
    const right = clipTo(sine(330, 0.1, { sampleRate: SR, amplitude: 0.9 }).channels[0], CLIP);
    const out = deClip({ sampleRate: SR, channels: [left, right] }, { threshold: 0.55 });
    expect(out.channels.length).toBe(2);
    expect(peak(out.channels[0])).toBeGreaterThan(CLIP);
    expect(peak(out.channels[1])).toBeGreaterThan(CLIP);
  });

  it("leaves plateaus longer than maxRunLength untouched, repairs them when the limit is raised", () => {
    const N = 1200;
    const data = new Float32Array(N);
    for (let i = 0; i < 10; i++) data[i] = (i / 10) * 0.99; // ramp in
    for (let i = 10; i < 1010; i++) data[i] = 0.99; // 1000-sample flat (> default maxRun 882)
    for (let i = 1010; i < N; i++) data[i] = Math.max(0, 0.99 - ((i - 1010) / 10) * 0.99); // ramp out
    const def = deClip({ sampleRate: SR, channels: [Float32Array.from(data)] }, { threshold: 0.9 });
    expect(def.channels[0][500]).toBeCloseTo(0.99, 5); // too long → untouched
    const raised = deClip({ sampleRate: SR, channels: [Float32Array.from(data)] }, { threshold: 0.9, maxRunLength: 2000 });
    expect(raised.channels[0][500]).toBeGreaterThan(0.99); // now within the limit → rebuilt
  });

  it("leaves plateaus shorter than minRunLength untouched", () => {
    // A 3-sample flat at 0.99, default minRunLength 5 → not treated as a clip.
    const data = [0, 0.4, 0.8, 0.99, 0.99, 0.99, 0.8, 0.4, 0, -0.4];
    const out = deClip(buffer(data), { threshold: 0.9 });
    expect(out.channels[0][4]).toBeCloseTo(0.99, 5);
  });
});
