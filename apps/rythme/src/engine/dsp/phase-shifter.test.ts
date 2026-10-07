// ─────────────────────────────────────────────────────────────
// engine/dsp/phase-shifter.test — Audition-style Graphic Phase Shifter
// ─────────────────────────────────────────────────────────────
// Pins the all-pass identities: a 0° curve reconstructs the signal exactly, any
// curve preserves energy (magnitude), a 180° curve inverts, two 90° passes
// compose to a 180° inversion, and a frequency-dependent curve only flips the
// band where it reaches 180°. Channel select isolates one side for "simulated
// stereo".

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { graphicPhaseShifter, type PhaseShiftPoint } from "./phase-shifter";

const SR = 44100;

const tone = (freq: number) => sine(freq, 0.3, { sampleRate: SR, amplitude: 0.5 });
const flat = (phaseDeg: number): PhaseShiftPoint[] => [{ freq: 0, phaseDeg }, { freq: 22050, phaseDeg }];

function rms(ch: Float32Array, a = 0, b = ch.length): number {
  let s = 0;
  for (let i = a; i < b; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

/** Max |a − b| over the interior (skipping one FFT block at each edge). */
function interiorMaxDiff(a: Float32Array, b: Float32Array, guard = 2048): number {
  let m = 0;
  for (let i = guard; i < a.length - guard; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function negate(ch: Float32Array): Float32Array {
  const out = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) out[i] = -ch[i];
  return out;
}

describe("graphicPhaseShifter — all-pass identities", () => {
  it("a 0° curve reconstructs the input almost exactly", () => {
    const t = tone(1000);
    const out = graphicPhaseShifter(t, { curve: flat(0) });
    expect(interiorMaxDiff(out.channels[0], t.channels[0])).toBeLessThan(1e-5);
  });

  it("an empty curve is a passthrough", () => {
    const t = tone(1000);
    const out = graphicPhaseShifter(t, {});
    expect(interiorMaxDiff(out.channels[0], t.channels[0])).toBeLessThan(1e-5);
  });

  it("preserves energy (magnitude) for any phase curve", () => {
    const noise = whiteNoise(0.3, { sampleRate: SR, amplitude: 0.5, seed: 8, channels: 1 });
    const a = noise.channels[0].length >> 2;
    const b = noise.channels[0].length - a;
    for (const deg of [45, 90, 135]) {
      const out = graphicPhaseShifter(noise, { curve: flat(deg) });
      const ratio = rms(out.channels[0], a, b) / rms(noise.channels[0], a, b);
      expect(ratio).toBeGreaterThan(0.98);
      expect(ratio).toBeLessThan(1.02);
    }
  });

  it("a 180° curve inverts a mid-band tone", () => {
    const t = tone(1000);
    const out = graphicPhaseShifter(t, { curve: flat(180) });
    expect(interiorMaxDiff(out.channels[0], negate(t.channels[0]))).toBeLessThan(1e-3);
  });

  it("two 90° passes compose to a 180° inversion", () => {
    const t = tone(1500);
    const once = graphicPhaseShifter(t, { curve: flat(90) });
    const twice = graphicPhaseShifter(once, { curve: flat(90) });
    expect(interiorMaxDiff(twice.channels[0], negate(t.channels[0]))).toBeLessThan(2e-3);
  });
});

describe("graphicPhaseShifter — frequency dependence", () => {
  const curve: PhaseShiftPoint[] = [{ freq: 2000, phaseDeg: 0 }, { freq: 4000, phaseDeg: 180 }];

  it("passes a tone below the transition and inverts one above it", () => {
    const lo = tone(400);
    const hi = tone(8000);
    const loOut = graphicPhaseShifter(lo, { curve });
    const hiOut = graphicPhaseShifter(hi, { curve });
    expect(interiorMaxDiff(loOut.channels[0], lo.channels[0])).toBeLessThan(2e-3); // unchanged
    expect(interiorMaxDiff(hiOut.channels[0], negate(hi.channels[0]))).toBeLessThan(2e-3); // inverted
  });
});

describe("graphicPhaseShifter — channel select", () => {
  it("shifts only the chosen channel (simulated stereo)", () => {
    const l = tone(1000).channels[0];
    const r = tone(1000).channels[0];
    const stereo: AudioData = { sampleRate: SR, channels: [Float32Array.from(l), Float32Array.from(r)] };
    const out = graphicPhaseShifter(stereo, { curve: flat(180), channel: "left" });
    expect(interiorMaxDiff(out.channels[0], negate(l))).toBeLessThan(1e-3); // left inverted
    expect(interiorMaxDiff(out.channels[1], r)).toBe(0); // right untouched (exact copy)
  });

  it("'right' on a mono buffer leaves it unchanged", () => {
    const t = tone(1000);
    const out = graphicPhaseShifter(t, { curve: flat(180), channel: "right" });
    expect(interiorMaxDiff(out.channels[0], t.channels[0])).toBe(0);
  });
});

describe("graphicPhaseShifter — robustness", () => {
  it("processes a stereo buffer on both channels by default", () => {
    const l = tone(1000).channels[0];
    const r = tone(1000).channels[0];
    const stereo: AudioData = { sampleRate: SR, channels: [Float32Array.from(l), Float32Array.from(r)] };
    const out = graphicPhaseShifter(stereo, { curve: flat(180) });
    expect(interiorMaxDiff(out.channels[0], negate(l))).toBeLessThan(1e-3);
    expect(interiorMaxDiff(out.channels[1], negate(r))).toBeLessThan(1e-3);
  });

  it("does not mutate the input", () => {
    const t = tone(1000);
    const snapshot = Float32Array.from(t.channels[0]);
    graphicPhaseShifter(t, { curve: flat(90) });
    expect(interiorMaxDiff(t.channels[0], snapshot)).toBe(0);
  });

  it("preserves frame count and is deterministic", () => {
    const t = tone(1000);
    const a = graphicPhaseShifter(t, { curve: flat(120) });
    const b = graphicPhaseShifter(t, { curve: flat(120) });
    expect(frameCount(a)).toBe(frameCount(t));
    expect(interiorMaxDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("throws on a non-power-of-two FFT size", () => {
    expect(() => graphicPhaseShifter(tone(1000), { curve: flat(90), fftSize: 1000 })).toThrow();
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(1, 0, SR);
    const out = graphicPhaseShifter(empty, { curve: flat(90) });
    expect(frameCount(out)).toBe(0);
  });
});
