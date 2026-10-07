// ─────────────────────────────────────────────────────────────
// engine/dsp/de-esser.test — Audition-style sibilance reduction
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { lowpass } from "./filter";
import { peakAmplitude, rmsAmplitude } from "./normalize";
import { deEss } from "./de-esser";

const SR = 44100;

function rmsDropDb(input: AudioData, output: AudioData): number {
  return gainToDb(rmsAmplitude(input)) - gainToDb(rmsAmplitude(output));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("deEss", () => {
  it("attenuates a loud tone at the center frequency by >= 8 dB", () => {
    const sib = sine(7000, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const out = deEss(sib, { centerFreq: 7000 });
    expect(rmsDropDb(sib, out)).toBeGreaterThanOrEqual(8);
  });

  it("preserves a low tone well below the sibilant band", () => {
    const low = sine(300, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const out = deEss(low, { centerFreq: 7000 });
    expect(Math.abs(rmsDropDb(low, out))).toBeLessThan(1);
  });

  it("is an exact pass-through below the threshold", () => {
    const quiet = sine(7000, 0.2, { sampleRate: SR, amplitude: 0.01 }); // ≈ −40 dB < −30
    const out = deEss(quiet, { centerFreq: 7000, thresholdDb: -30 });
    expect(maxAbsDiff(out.channels[0], quiet.channels[0])).toBeLessThan(1e-6);
  });

  it.each(["split", "broadband"] as const)("outputSibilanceOnly is the exact complement (%s mode)", (mode) => {
    const sib = sine(7000, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const deEssed = deEss(sib, { centerFreq: 7000, mode });
    const removed = deEss(sib, { centerFreq: 7000, mode, outputSibilanceOnly: true });
    const sum = new Float32Array(frameCount(sib));
    for (let i = 0; i < sum.length; i++) sum[i] = deEssed.channels[0][i] + removed.channels[0][i];
    expect(maxAbsDiff(sum, sib.channels[0])).toBeLessThan(1e-6);
  });

  it("never produces NaN/Inf, even on silence or a degenerate ratio", () => {
    const silence = createAudioData(2, 4096, SR);
    const loud = sine(7000, 0.1, { sampleRate: SR, amplitude: 0.9 });
    for (const out of [deEss(silence, { centerFreq: 7000 }), deEss(loud, { ratio: 0, centerFreq: 7000 })]) {
      for (const ch of out.channels) for (const v of ch) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("split mode preserves the low band of a mix; broadband ducks it", () => {
    const low = sine(300, 0.2, { sampleRate: SR, amplitude: 0.3 }).channels[0];
    const high = sine(7000, 0.2, { sampleRate: SR, amplitude: 0.5 }).channels[0];
    const mix: AudioData = { sampleRate: SR, channels: [low.map((v, i) => v + high[i])] };
    const split = deEss(mix, { centerFreq: 7000, mode: "split" });
    const broad = deEss(mix, { centerFreq: 7000, mode: "broadband" });
    const lowRms = (x: AudioData) => gainToDb(rmsAmplitude(lowpass(x, 1500)));
    expect(lowRms(mix) - lowRms(split)).toBeLessThan(1); // low survives split de-essing
    expect(lowRms(mix) - lowRms(broad)).toBeGreaterThan(1); // broadband ducks everything
  });

  it("rangeDb caps the maximum gain reduction", () => {
    const sib = sine(7000, 0.2, { sampleRate: SR, amplitude: 0.9 });
    const capped = deEss(sib, { centerFreq: 7000, rangeDb: 6 });
    const uncapped = deEss(sib, { centerFreq: 7000 });
    const cappedDrop = rmsDropDb(sib, capped);
    expect(cappedDrop).toBeLessThanOrEqual(7); // ≈ 6 dB ceiling
    expect(cappedDrop).toBeLessThan(rmsDropDb(sib, uncapped) - 5);
  });

  it("processes stereo and preserves channel + frame count", () => {
    const sib = sine(7000, 0.2, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const out = deEss(sib, { centerFreq: 7000 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(sib));
    expect(rmsDropDb({ sampleRate: SR, channels: [sib.channels[1]] }, { sampleRate: SR, channels: [out.channels[1]] })).toBeGreaterThanOrEqual(8);
  });

  it("is deterministic", () => {
    const sib = sine(7000, 0.15, { sampleRate: SR, amplitude: 0.5 });
    const a = deEss(sib, { centerFreq: 7000 });
    const b = deEss(sib, { centerFreq: 7000 });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input", () => {
    const sib = sine(7000, 0.1, { sampleRate: SR, amplitude: 0.5 });
    const copy = Array.from(sib.channels[0]);
    deEss(sib, { centerFreq: 7000, mode: "broadband" });
    expect(Array.from(sib.channels[0])).toEqual(copy);
  });

  it("handles an empty buffer", () => {
    const out = deEss(createAudioData(2, 0, SR), { centerFreq: 7000 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
    expect(peakAmplitude(out)).toBe(0);
  });
});
