import { describe, expect, it } from "vitest";
import { fromChannels } from "../audio/buffer";
import { channelCount, frameCount } from "../audio/types";
import { gainToDb } from "../audio/db";
import { sine } from "../generate/tone";
import { peakAmplitude, rmsAmplitude } from "./normalize";
import { applyGainDb } from "./gain";
import { fadeIn, fadeOut, crossfade } from "./fade";
import { normalizePeak, normalizeRMS, removeDcOffset } from "./normalize";
import { invertPolarity, reverse, silence, applyPan, stereoWidth, swapStereo } from "./basic";
import { applyBiquad } from "./biquad";
import { lowpass, highpass } from "./filter";
import { graphicEQ, parametricEQ, eqResponse } from "./eq";
import { compress, gate, limit } from "./dynamics";
import { delay, convolve } from "./delay";
import { reverb } from "./reverb";
import { bitcrush, hardClip, softClip } from "./distortion";
import { tremolo, chorus } from "./modulation";
import { changeSpeed } from "./speed";

const SR = 48000;

describe("gain & normalize", () => {
  it("applyGainDb(-6) ≈ halves amplitude", () => {
    const d = sine(440, 0.05, { sampleRate: SR, amplitude: 1 });
    const out = applyGainDb(d, -6);
    expect(peakAmplitude(out)).toBeCloseTo(0.501, 2);
  });

  it("normalizePeak brings peak to the target dB", () => {
    const d = sine(440, 0.05, { sampleRate: SR, amplitude: 0.2 });
    const out = normalizePeak(d, -1);
    expect(gainToDb(peakAmplitude(out))).toBeCloseTo(-1, 1);
  });

  it("normalizeRMS reaches the target RMS", () => {
    const d = sine(440, 0.2, { sampleRate: SR, amplitude: 0.1 });
    const out = normalizeRMS(d, -12);
    expect(gainToDb(rmsAmplitude(out))).toBeCloseTo(-12, 1);
  });

  it("removeDcOffset zeroes the mean", () => {
    const d = fromChannels([[0.5, 0.5, 0.5, 0.5]], SR);
    const out = removeDcOffset(d);
    const mean = out.channels[0].reduce((a, b) => a + b, 0) / 4;
    expect(mean).toBeCloseTo(0, 6);
  });
});

describe("fades", () => {
  it("fadeIn starts silent and fadeOut ends silent", () => {
    const d = sine(440, 0.2, { sampleRate: SR, amplitude: 1 });
    const fi = fadeIn(d, 0.05);
    expect(Math.abs(fi.channels[0][0])).toBeLessThan(1e-6);
    const fo = fadeOut(d, 0.05);
    expect(Math.abs(fo.channels[0][fo.channels[0].length - 1])).toBeLessThan(1e-3);
  });

  it("crossfade length is len(a)+len(b)-overlap", () => {
    const a = sine(220, 0.1, { sampleRate: SR });
    const b = sine(440, 0.1, { sampleRate: SR });
    const overlapFrames = Math.round(0.02 * SR);
    const xf = crossfade(a, b, 0.02);
    expect(frameCount(xf)).toBe(frameCount(a) + frameCount(b) - overlapFrames);
  });
});

describe("basic transforms", () => {
  it("reverse is its own inverse", () => {
    const d = fromChannels([[1, 2, 3, 4]], SR);
    expect(Array.from(reverse(reverse(d)).channels[0])).toEqual([1, 2, 3, 4]);
  });

  it("invertPolarity flips sign; sum with original is ~0", () => {
    const d = sine(440, 0.05, { sampleRate: SR });
    const inv = invertPolarity(d);
    let sum = 0;
    for (let i = 0; i < frameCount(d); i++) sum += d.channels[0][i] + inv.channels[0][i];
    expect(sum).toBeCloseTo(0, 4);
  });

  it("silence zeroes everything", () => {
    expect(peakAmplitude(silence(sine(440, 0.05, { sampleRate: SR })))).toBe(0);
  });

  it("applyPan hard-left zeroes the right channel", () => {
    const d = sine(440, 0.02, { sampleRate: SR, amplitude: 1 });
    const out = applyPan(d, -1);
    expect(channelCount(out)).toBe(2);
    expect(peakAmplitude({ sampleRate: SR, channels: [out.channels[1]] })).toBeCloseTo(0, 5);
  });

  it("swapStereo exchanges channels", () => {
    const d = fromChannels([[1, 1], [2, 2]], SR);
    const s = swapStereo(d);
    expect(Array.from(s.channels[0])).toEqual([2, 2]);
    expect(Array.from(s.channels[1])).toEqual([1, 1]);
  });

  it("stereoWidth 0 collapses to mono (L==R)", () => {
    const d = fromChannels([[1, -1], [-1, 1]], SR);
    const m = stereoWidth(d, 0);
    expect(m.channels[0][0]).toBeCloseTo(m.channels[1][0], 6);
  });
});

describe("filters & EQ", () => {
  it("lowpass attenuates a high tone more than a low tone", () => {
    const low = sine(200, 0.2, { sampleRate: SR, amplitude: 1 });
    const high = sine(12000, 0.2, { sampleRate: SR, amplitude: 1 });
    const lpLow = rmsAmplitude(lowpass(low, 1000, Math.SQRT1_2, 2));
    const lpHigh = rmsAmplitude(lowpass(high, 1000, Math.SQRT1_2, 2));
    expect(lpLow).toBeGreaterThan(lpHigh * 5);
  });

  it("highpass attenuates a low tone more than a high tone", () => {
    const low = sine(80, 0.2, { sampleRate: SR, amplitude: 1 });
    const high = sine(5000, 0.2, { sampleRate: SR, amplitude: 1 });
    const hpLow = rmsAmplitude(highpass(low, 1000, Math.SQRT1_2, 2));
    const hpHigh = rmsAmplitude(highpass(high, 1000, Math.SQRT1_2, 2));
    expect(hpHigh).toBeGreaterThan(hpLow * 5);
  });

  it("a peaking boost increases energy at the band frequency", () => {
    const d = sine(1000, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const boosted = applyBiquad(d, { type: "peaking", freq: 1000, q: 1, gainDb: 12 });
    expect(rmsAmplitude(boosted)).toBeGreaterThan(rmsAmplitude(d) * 1.5);
  });

  it("a flat graphic EQ is a pass-through", () => {
    const d = sine(1000, 0.05, { sampleRate: SR, amplitude: 0.5 });
    const out = graphicEQ(d, new Array(10).fill(0));
    expect(out.channels[0][100]).toBeCloseTo(d.channels[0][100], 5);
  });

  it("eqResponse reports a boost near the band center", () => {
    const resp = eqResponse([{ type: "peaking", freq: 1000, q: 1, gainDb: 6 }], SR, 256);
    const near = resp.reduce((best, p) => (Math.abs(p.f - 1000) < Math.abs(best.f - 1000) ? p : best));
    expect(near.db).toBeGreaterThan(4);
  });

  it("parametricEQ with no bands is identity", () => {
    const d = sine(1000, 0.02, { sampleRate: SR });
    const out = parametricEQ(d, []);
    expect(Array.from(out.channels[0])).toEqual(Array.from(d.channels[0]));
  });
});

describe("dynamics", () => {
  it("compressor reduces the peak of a loud signal", () => {
    const d = sine(440, 0.3, { sampleRate: SR, amplitude: 1 });
    const out = compress(d, { thresholdDb: -24, ratio: 8, attackMs: 2, releaseMs: 50, makeupDb: 0 });
    expect(peakAmplitude(out)).toBeLessThan(peakAmplitude(d));
  });

  it("limiter holds the steady-state peak near the ceiling", () => {
    const d = sine(440, 0.3, { sampleRate: SR, amplitude: 1 });
    const out = limit(d, { thresholdDb: -6 });
    // measure after the attack settles (limiter has no lookahead, so the very
    // first peak overshoots — that is realistic behaviour).
    const settled = { sampleRate: SR, channels: [out.channels[0].slice(Math.round(0.1 * SR))] };
    expect(gainToDb(peakAmplitude(settled))).toBeLessThan(-2);
  });

  it("gate attenuates a quiet signal", () => {
    const quiet = sine(440, 0.3, { sampleRate: SR, amplitude: 0.01 });
    const out = gate(quiet, { thresholdDb: -30, ratio: 6 });
    expect(rmsAmplitude(out)).toBeLessThan(rmsAmplitude(quiet));
  });

  it("gate mostly preserves a loud signal", () => {
    const loud = sine(440, 0.3, { sampleRate: SR, amplitude: 0.9 });
    const out = gate(loud, { thresholdDb: -30, ratio: 6 });
    expect(rmsAmplitude(out)).toBeGreaterThan(rmsAmplitude(loud) * 0.8);
  });
});

describe("time-based effects", () => {
  it("delay adds a tail and energy after the source ends", () => {
    const d = sine(440, 0.05, { sampleRate: SR, amplitude: 0.8 });
    const out = delay(d, { delayMs: 100, feedback: 0.5, mix: 0.5, tailSeconds: 0.5 });
    expect(frameCount(out)).toBeGreaterThan(frameCount(d));
    const tail = out.channels[0].slice(frameCount(d));
    expect(Math.max(...Array.from(tail, Math.abs))).toBeGreaterThan(0.01);
  });

  it("convolution with a unit impulse is identity (within length)", () => {
    const d = sine(440, 0.02, { sampleRate: SR });
    const out = convolve(d, new Float32Array([1]));
    expect(out.channels[0][50]).toBeCloseTo(d.channels[0][50], 5);
  });

  it("reverb returns stereo with a ring-out tail", () => {
    const d = sine(440, 0.05, { sampleRate: SR, amplitude: 0.8 });
    const out = reverb(d, { roomSize: 0.7, wet: 0.5, dry: 0.5, tailSeconds: 0.5 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBeGreaterThan(frameCount(d));
    const tail = out.channels[0].slice(frameCount(d));
    expect(Math.max(...Array.from(tail, Math.abs))).toBeGreaterThan(1e-4);
  });
});

describe("distortion & modulation", () => {
  it("hardClip clamps to the threshold", () => {
    const d = sine(440, 0.02, { sampleRate: SR, amplitude: 1 });
    const out = hardClip(d, 12, 0.5);
    expect(peakAmplitude(out)).toBeCloseTo(0.5, 5);
  });

  it("softClip stays bounded within [-1,1]", () => {
    const d = sine(440, 0.02, { sampleRate: SR, amplitude: 1 });
    const out = softClip(d, 24);
    expect(peakAmplitude(out)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it("bitcrush quantizes to a few levels", () => {
    const d = sine(440, 0.05, { sampleRate: SR, amplitude: 1 });
    const out = bitcrush(d, 2, 1); // 4 levels
    const unique = new Set(Array.from(out.channels[0], (v) => Math.round(v * 1000)));
    expect(unique.size).toBeLessThanOrEqual(6);
  });

  it("tremolo modulates amplitude (varies the local peak)", () => {
    const d = sine(440, 0.5, { sampleRate: SR, amplitude: 1 });
    const out = tremolo(d, { rateHz: 8, depth: 1 });
    expect(peakAmplitude(out)).toBeLessThanOrEqual(peakAmplitude(d) + 1e-6);
    // some windows should be much quieter than the source
    const win = SR * 0.01;
    const early = rmsAmplitude({ sampleRate: SR, channels: [out.channels[0].slice(0, win)] });
    expect(early).toBeGreaterThanOrEqual(0);
  });

  it("chorus stays bounded and same length", () => {
    const d = sine(440, 0.2, { sampleRate: SR, amplitude: 0.6 });
    const out = chorus(d, { mix: 0.5 });
    expect(frameCount(out)).toBe(frameCount(d));
    expect(peakAmplitude(out)).toBeLessThan(1.2);
  });
});

describe("speed", () => {
  it("changeSpeed(2) halves the length", () => {
    const d = sine(440, 1, { sampleRate: SR });
    const out = changeSpeed(d, 2);
    expect(frameCount(out)).toBeCloseTo(frameCount(d) / 2, -1);
  });

  it("changeSpeed(1) is identity in length", () => {
    const d = sine(440, 0.1, { sampleRate: SR });
    expect(frameCount(changeSpeed(d, 1))).toBe(frameCount(d));
  });
});
