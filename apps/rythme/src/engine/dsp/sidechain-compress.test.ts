// ─────────────────────────────────────────────────────────────
// engine/dsp/sidechain-compress.test — keyed (sidechain) compressor
// ─────────────────────────────────────────────────────────────
// The target is compressed by a key burst. The defining difference from the
// Auto-Ducker is PROPORTIONALITY: a louder key produces more gain reduction,
// where the ducker would dip to the same fixed level for any key over threshold.

import { describe, expect, it } from "vitest";
import { concat, createAudioData, fromChannels } from "../audio/buffer";
import { channelCount, frameCount } from "../audio/types";
import { sine } from "../generate/tone";
import { generateSilence } from "../generate/silence";
import { sidechainCompress } from "./sidechain-compress";

const SR = 44100;

/** RMS of channel 0 over [t0, t1) seconds. */
function rmsAt(d: { channels: Float32Array[] }, t0: number, t1: number): number {
  const ch = d.channels[0];
  const a = Math.round(t0 * SR);
  const b = Math.round(t1 * SR);
  let sum = 0;
  for (let i = a; i < b; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / Math.max(1, b - a));
}

/** 1.6 s target tone; key silent · loud · silent (burst at 0.4–0.8 s) at `keyAmp`. */
function targetAndKey(keyAmp = 0.7) {
  const target = sine(440, 1.6, { sampleRate: SR, amplitude: 0.5, channels: 2 });
  const key = concat(
    generateSilence(0.4, 2, SR),
    sine(120, 0.4, { sampleRate: SR, amplitude: keyAmp, channels: 2 }),
    generateSilence(0.8, 2, SR),
  );
  return { target, key };
}

describe("sidechainCompress", () => {
  it("pulls the target down under the key and restores it at the ends", () => {
    const { target, key } = targetAndKey();
    const out = sidechainCompress(target, key, { thresholdDb: -24, ratio: 4, attackMs: 10, releaseMs: 120 });
    const startRms = rmsAt(out, 0.0, 0.3);
    const ducked = rmsAt(out, 0.65, 0.78); // settled in the burst
    const endRms = rmsAt(out, 1.4, 1.6);
    expect(startRms).toBeCloseTo(rmsAt(target, 0.0, 0.3), 2); // untouched before the key
    expect(ducked).toBeLessThan(startRms * 0.7);
    expect(endRms).toBeGreaterThan(startRms * 0.85); // recovered after the key
  });

  it("is PROPORTIONAL: a louder key reduces the target more (vs. a fixed duck)", () => {
    const loud = targetAndKey(0.8);
    const quiet = targetAndKey(0.2);
    const opts = { thresholdDb: -30, ratio: 4, attackMs: 10, releaseMs: 120 };
    const outLoud = sidechainCompress(loud.target, loud.key, opts);
    const outQuiet = sidechainCompress(quiet.target, quiet.key, opts);
    expect(rmsAt(outLoud, 0.65, 0.78)).toBeLessThan(rmsAt(outQuiet, 0.65, 0.78) * 0.9);
  });

  it("a higher ratio compresses harder", () => {
    const { target, key } = targetAndKey();
    const soft = sidechainCompress(target, key, { thresholdDb: -30, ratio: 2, attackMs: 10 });
    const hard = sidechainCompress(target, key, { thresholdDb: -30, ratio: 10, attackMs: 10 });
    expect(rmsAt(hard, 0.65, 0.78)).toBeLessThan(rmsAt(soft, 0.65, 0.78));
  });

  it("make-up gain lifts the whole target", () => {
    const { target, key } = targetAndKey();
    const flat = sidechainCompress(target, key, { thresholdDb: -24, ratio: 4, makeupDb: 0 });
    const loud = sidechainCompress(target, key, { thresholdDb: -24, ratio: 4, makeupDb: 6 });
    // where the key is silent, only make-up applies → ~+6 dB (×2).
    expect(rmsAt(loud, 0.0, 0.3) / rmsAt(flat, 0.0, 0.3)).toBeCloseTo(2, 1);
  });

  it("a key below the threshold leaves the target unchanged", () => {
    const { target, key } = targetAndKey(0.01); // ~−40 dBFS key
    const out = sidechainCompress(target, key, { thresholdDb: -24, ratio: 8, makeupDb: 0 });
    let maxErr = 0;
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < frameCount(target); i++) maxErr = Math.max(maxErr, Math.abs(out.channels[c][i] - target.channels[c][i]));
    expect(maxErr).toBeLessThan(2e-3);
  });

  it("leaves the target untouched when the key is silent (no make-up)", () => {
    const target = sine(440, 0.5, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const out = sidechainCompress(target, generateSilence(0.5, 2, SR), { ratio: 8, makeupDb: 0 });
    let maxErr = 0;
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < frameCount(target); i++) maxErr = Math.max(maxErr, Math.abs(out.channels[c][i] - target.channels[c][i]));
    expect(maxErr).toBeLessThan(1e-6);
  });

  it("works on a mono target and does not mutate either input", () => {
    const target = fromChannels([sine(440, 0.6, { sampleRate: SR, amplitude: 0.5 }).channels[0]], SR);
    const key = concat(generateSilence(0.2, 1, SR), sine(120, 0.2, { sampleRate: SR, amplitude: 0.7 }), generateSilence(0.2, 1, SR));
    const tCopy = Array.from(target.channels[0]);
    const kCopy = Array.from(key.channels[0]);
    const out = sidechainCompress(target, key, { thresholdDb: -24, ratio: 4 });
    expect(channelCount(out)).toBe(1);
    expect(frameCount(out)).toBe(frameCount(target));
    expect(Array.from(target.channels[0])).toEqual(tCopy);
    expect(Array.from(key.channels[0])).toEqual(kCopy);
  });

  it("handles an empty target", () => {
    const out = sidechainCompress(createAudioData(2, 0, SR), sine(120, 0.2, { sampleRate: SR }));
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});
