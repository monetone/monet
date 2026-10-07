// ─────────────────────────────────────────────────────────────
// engine/dsp/stereo-expander.test — Audition-style Stereo Expander
// ─────────────────────────────────────────────────────────────
// Pins the mid/side identities: expand=100 is a bit-exact passthrough, expand=0
// collapses to mono, the side difference scales linearly with expand, the mono
// sum (centre level) is preserved at pan 0, and the centre pan moves the image.

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { stereoExpander } from "./stereo-expander";

const SR = 44100;

/** A stereo buffer with independent left/right tones (so it has a real side signal). */
function stereoTones(lf: number, rf: number, amp = 0.4): AudioData {
  const l = sine(lf, 0.2, { sampleRate: SR, amplitude: amp }).channels[0];
  const r = sine(rf, 0.2, { sampleRate: SR, amplitude: amp }).channels[0];
  return { sampleRate: SR, channels: [Float32Array.from(l), Float32Array.from(r)] };
}

function rms(ch: Float32Array): number {
  let s = 0;
  for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, ch.length));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** Per-sample side signal (L−R)/2. */
function side(d: AudioData): Float32Array {
  const [l, r] = d.channels;
  const s = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) s[i] = (l[i] - r[i]) / 2;
  return s;
}

/** Per-sample mono sum L+R. */
function sum(d: AudioData): Float32Array {
  const [l, r] = d.channels;
  const out = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) out[i] = l[i] + r[i];
  return out;
}

describe("stereoExpander — width", () => {
  it("expand=100 is a bit-exact passthrough", () => {
    const t = stereoTones(300, 500);
    const out = stereoExpander(t, { expand: 100 });
    expect(maxAbsDiff(out.channels[0], t.channels[0])).toBeLessThan(1e-6);
    expect(maxAbsDiff(out.channels[1], t.channels[1])).toBeLessThan(1e-6);
  });

  it("expand=0 collapses to mono (L==R, side removed)", () => {
    const t = stereoTones(300, 500);
    const out = stereoExpander(t, { expand: 0 });
    expect(maxAbsDiff(out.channels[0], out.channels[1])).toBeLessThan(1e-6);
    expect(rms(side(out))).toBeLessThan(1e-6);
  });

  it("scales the side signal linearly with expand", () => {
    const t = stereoTones(300, 500);
    const base = rms(side(t));
    expect(rms(side(stereoExpander(t, { expand: 200 }))) / base).toBeCloseTo(2, 3);
    expect(rms(side(stereoExpander(t, { expand: 300 }))) / base).toBeCloseTo(3, 3);
    expect(rms(side(stereoExpander(t, { expand: 50 }))) / base).toBeCloseTo(0.5, 3);
  });

  it("widening preserves the mono sum (centre level) at pan 0", () => {
    const t = stereoTones(300, 500);
    const before = sum(t);
    for (const expand of [0, 50, 150, 300]) {
      const after = sum(stereoExpander(t, { expand }));
      expect(maxAbsDiff(after, before)).toBeLessThan(1e-6);
    }
  });
});

describe("stereoExpander — centre pan", () => {
  it("hard right (+100) moves a centre-panned signal fully to the right", () => {
    // A correlated (mono) source: L==R, so it is pure centre with no side.
    const m = sine(440, 0.2, { sampleRate: SR, amplitude: 0.5 }).channels[0];
    const d: AudioData = { sampleRate: SR, channels: [Float32Array.from(m), Float32Array.from(m)] };
    const out = stereoExpander(d, { centerPan: 100 });
    expect(rms(out.channels[0])).toBeLessThan(1e-6); // left silenced
    expect(rms(out.channels[1]) / rms(m)).toBeGreaterThan(0.99); // right keeps it
  });

  it("hard left (−100) moves the centre fully to the left", () => {
    const m = sine(440, 0.2, { sampleRate: SR, amplitude: 0.5 }).channels[0];
    const d: AudioData = { sampleRate: SR, channels: [Float32Array.from(m), Float32Array.from(m)] };
    const out = stereoExpander(d, { centerPan: -100 });
    expect(rms(out.channels[1])).toBeLessThan(1e-6); // right silenced
    expect(rms(out.channels[0]) / rms(m)).toBeGreaterThan(0.99);
  });

  it("pan 0 leaves left/right balance unchanged", () => {
    const t = stereoTones(300, 500);
    const out = stereoExpander(t, { centerPan: 0 });
    expect(maxAbsDiff(out.channels[0], t.channels[0])).toBeLessThan(1e-6);
  });
});

describe("stereoExpander — robustness", () => {
  it("passes mono (and non-stereo) buffers through unchanged", () => {
    const mono = sine(440, 0.1, { sampleRate: SR, amplitude: 0.5 });
    const out = stereoExpander(mono, { expand: 250, centerPan: 50 });
    expect(out.channels.length).toBe(1);
    expect(maxAbsDiff(out.channels[0], mono.channels[0])).toBe(0);
  });

  it("defaults (no opts) are a passthrough", () => {
    const t = stereoTones(300, 500);
    const out = stereoExpander(t);
    expect(maxAbsDiff(out.channels[0], t.channels[0])).toBeLessThan(1e-6);
    expect(maxAbsDiff(out.channels[1], t.channels[1])).toBeLessThan(1e-6);
  });

  it("does not mutate the input", () => {
    const t = stereoTones(300, 500);
    const snapL = Float32Array.from(t.channels[0]);
    stereoExpander(t, { expand: 220, centerPan: 30 });
    expect(maxAbsDiff(t.channels[0], snapL)).toBe(0);
  });

  it("preserves frame count and is deterministic", () => {
    const t = stereoTones(300, 500);
    const a = stereoExpander(t, { expand: 180 });
    const b = stereoExpander(t, { expand: 180 });
    expect(frameCount(a)).toBe(frameCount(t));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("handles an empty stereo buffer", () => {
    const empty = createAudioData(2, 0, SR);
    const out = stereoExpander(empty, { expand: 200 });
    expect(frameCount(out)).toBe(0);
    expect(out.channels.length).toBe(2);
  });
});
