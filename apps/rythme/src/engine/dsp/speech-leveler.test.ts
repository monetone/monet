// ─────────────────────────────────────────────────────────────
// engine/dsp/speech-leveler.test — Audition-style Speech Volume Leveler
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { speechLeveler } from "./speech-leveler";

const SR = 44100;

/** A mono clip: `loud` amplitude for the first half, `quiet` for the second. */
function twoLevel(loud: number, quiet: number, half = 0.8): AudioData {
  const a = sine(300, half, { sampleRate: SR, amplitude: loud }).channels[0];
  const b = sine(300, half, { sampleRate: SR, amplitude: quiet }).channels[0];
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return { sampleRate: SR, channels: [out] };
}

const tone = (amp: number, dur = 0.8) => sine(300, dur, { sampleRate: SR, amplitude: amp });

/** RMS over the settled tail of a window (last 25%), past the gain ramp. */
function tailRmsDb(ch: Float32Array, from: number, to: number): number {
  const a = Math.floor(from + (to - from) * 0.75);
  let sum = 0;
  for (let i = a; i < to; i++) sum += ch[i] * ch[i];
  return 20 * Math.log10(Math.sqrt(sum / (to - a)) + 1e-12);
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function segmentRms(d: AudioData, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * d.sampleRate));
  const end = Math.min(frameCount(d), Math.round(endSeconds * d.sampleRate));
  let sum = 0;
  let count = 0;
  for (const channel of d.channels) {
    for (let i = start; i < end; i++) {
      sum += channel[i] * channel[i];
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

/** dBFS → linear amplitude. */
function dbToAmp(db: number): number {
  return Math.pow(10, db / 20);
}

describe("speechLeveler", () => {
  it("levels a loud half and a quiet half toward a common loudness", () => {
    const s = twoLevel(0.5, 0.05); // ~20 dB apart
    const mid = s.channels[0].length / 2;
    const inGap = Math.abs(tailRmsDb(s.channels[0], 0, mid) - tailRmsDb(s.channels[0], mid, s.channels[0].length));
    const out = speechLeveler(s, { targetDb: -18, amount: 1, maxGainDb: 30, windowMs: 120 });
    const outGap = Math.abs(tailRmsDb(out.channels[0], 0, mid) - tailRmsDb(out.channels[0], mid, out.channels[0].length));
    expect(inGap).toBeGreaterThan(15);
    expect(outGap).toBeLessThan(inGap * 0.4); // halves converge markedly
  });

  it("does not boost a passage below the silence gate", () => {
    const s = tone(0.001); // ≈ −60 dBFS, under the −50 gate
    const out = speechLeveler(s, { targetDb: -18, amount: 1, gateDb: -50, windowMs: 120 });
    const inDb = tailRmsDb(s.channels[0], 0, s.channels[0].length);
    const outDb = tailRmsDb(out.channels[0], 0, out.channels[0].length);
    expect(outDb).toBeLessThan(inDb + 1); // left alone, NOT lifted ~42 dB to target
  });

  it("caps the boost at maxGainDb", () => {
    const s = tone(0.01); // ≈ −40 dBFS, above the gate; target −18 wants +22 dB
    const out = speechLeveler(s, { targetDb: -18, amount: 1, maxGainDb: 12, gateDb: -50, windowMs: 120 });
    const inDb = tailRmsDb(s.channels[0], 0, s.channels[0].length);
    const outDb = tailRmsDb(out.channels[0], 0, out.channels[0].length);
    expect(outDb - inDb).toBeGreaterThan(8);
    expect(outDb - inDb).toBeLessThan(14); // capped near +12, not the full +22
  });

  it("is an exact passthrough at amount 0", () => {
    const s = tone(0.3);
    const out = speechLeveler(s, { amount: 0 });
    expect(maxAbsDiff(out.channels[0], s.channels[0])).toBe(0);
  });

  it("honors amount automation even when the static amount starts at zero", () => {
    const s = tone(0.05, 1);
    const out = speechLeveler(s, {
      targetDb: -12,
      amount: 0,
      maxGainDb: 30,
      gateDb: -80,
      windowMs: 10,
      automation: { amount: (time) => (time < 0.5 ? 0 : 1) },
    });

    const inFirst = segmentRms(s, 0.15, 0.45);
    const outFirst = segmentRms(out, 0.15, 0.45);
    const outSecond = segmentRms(out, 0.75, 0.95);

    expect(Math.abs(outFirst - inFirst)).toBeLessThan(1e-4);
    expect(outSecond).toBeGreaterThan(outFirst * 2.5);
  });

  it("applies one linked gain to both channels (stereo image preserved)", () => {
    const l = twoLevel(0.5, 0.05).channels[0];
    const r = twoLevel(0.4, 0.04).channels[0];
    const len = Math.min(l.length, r.length);
    const s: AudioData = { sampleRate: SR, channels: [l.slice(0, len), r.slice(0, len)] };
    const out = speechLeveler(s, { amount: 1, windowMs: 120 });
    let cross = 0;
    for (let i = 0; i < len; i++) {
      cross = Math.max(cross, Math.abs(out.channels[0][i] * s.channels[1][i] - out.channels[1][i] * s.channels[0][i]));
    }
    expect(cross).toBeLessThan(1e-7);
  });

  it("leaves a tone already at the target roughly unchanged", () => {
    // A sine's RMS is 3 dB below its amplitude, so scale by √2 to put the RMS
    // (what the leveler targets) at −18 dBFS, not the peak.
    const s = tone(dbToAmp(-18) * Math.SQRT2);
    const out = speechLeveler(s, { targetDb: -18, amount: 1, windowMs: 120 });
    const inDb = tailRmsDb(s.channels[0], 0, s.channels[0].length);
    const outDb = tailRmsDb(out.channels[0], 0, out.channels[0].length);
    expect(Math.abs(outDb - inDb)).toBeLessThan(2);
  });

  it("preserves frame count and is deterministic", () => {
    const s = twoLevel(0.5, 0.05);
    const a = speechLeveler(s, { amount: 0.8 });
    const b = speechLeveler(s, { amount: 0.8 });
    expect(frameCount(a)).toBe(frameCount(s));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const s = twoLevel(0.5, 0.05);
    const snapshot = Float32Array.from(s.channels[0]);
    speechLeveler(s, { amount: 1 });
    expect(maxAbsDiff(s.channels[0], snapshot)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(2, 0, SR);
    const out = speechLeveler(empty, { amount: 1 });
    expect(frameCount(out)).toBe(0);
  });
});
