// ─────────────────────────────────────────────────────────────
// engine/dsp/sidechain-duck.test — Auto-Ducking (sidechain)
// ─────────────────────────────────────────────────────────────
// A steady target tone is ducked by a key burst placed in the middle: the
// target dips by ~amountDb while the key plays and returns to unity at the ends.

import { describe, expect, it } from "vitest";
import { concat, createAudioData, fromChannels } from "../audio/buffer";
import { dbToGain } from "../audio/db";
import { channelCount, frameCount } from "../audio/types";
import { sine } from "../generate/tone";
import { generateSilence } from "../generate/silence";
import { sidechainDuck } from "./sidechain-duck";

const SR = 44100;

/** RMS of channel 0 over the time window [t0, t1) seconds. */
function rmsAt(d: { channels: Float32Array[] }, t0: number, t1: number): number {
  const ch = d.channels[0];
  const a = Math.round(t0 * SR);
  const b = Math.round(t1 * SR);
  let sum = 0;
  for (let i = a; i < b; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / Math.max(1, b - a));
}

/** A 1.6 s target tone and a key that is silent · loud · silent (burst at 0.4–0.8 s). */
function targetAndKey(keyAmp = 0.6) {
  const target = sine(440, 1.6, { sampleRate: SR, amplitude: 0.5, channels: 2 });
  const key = concat(
    generateSilence(0.4, 2, SR),
    sine(200, 0.4, { sampleRate: SR, amplitude: keyAmp, channels: 2 }),
    generateSilence(0.8, 2, SR),
  );
  return { target, key };
}

describe("sidechainDuck", () => {
  it("dips the target while the key plays and restores it at the ends", () => {
    const { target, key } = targetAndKey();
    const out = sidechainDuck(target, key, { amountDb: -12, attackMs: 30, releaseMs: 150, holdMs: 50 });
    const startRms = rmsAt(out, 0.0, 0.3); // before the key
    const duckedRms = rmsAt(out, 0.7, 0.79); // settled, late in the key burst
    const endRms = rmsAt(out, 1.4, 1.6); // fully released
    const ref = rmsAt(target, 0.0, 0.3);
    expect(startRms).toBeCloseTo(ref, 2); // untouched before the key
    expect(duckedRms).toBeLessThan(startRms * 0.45); // pulled down ~12 dB
    expect(endRms).toBeGreaterThan(startRms * 0.85); // recovered after the key
  });

  it("leaves the target unchanged when the key is silent", () => {
    const target = sine(440, 0.5, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const key = generateSilence(0.5, 2, SR);
    const out = sidechainDuck(target, key, { amountDb: -18 });
    let maxErr = 0;
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < frameCount(target); i++) maxErr = Math.max(maxErr, Math.abs(out.channels[c][i] - target.channels[c][i]));
    expect(maxErr).toBeLessThan(1e-7);
  });

  it("a key below the threshold does not duck", () => {
    const { target, key } = targetAndKey(0.01); // ~−40 dBFS key
    const out = sidechainDuck(target, key, { amountDb: -18, thresholdDb: -30 });
    expect(rmsAt(out, 0.7, 0.79)).toBeCloseTo(rmsAt(target, 0.7, 0.79), 2);
  });

  it("a deeper amount attenuates more", () => {
    const { target, key } = targetAndKey();
    const light = sidechainDuck(target, key, { amountDb: -6, attackMs: 30, holdMs: 50 });
    const heavy = sidechainDuck(target, key, { amountDb: -24, attackMs: 30, holdMs: 50 });
    expect(rmsAt(heavy, 0.7, 0.79)).toBeLessThan(rmsAt(light, 0.7, 0.79));
  });

  it("settles near the requested attenuation deep in a long key", () => {
    const target = sine(440, 2.0, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const key = concat(generateSilence(0.2, 2, SR), sine(200, 1.6, { sampleRate: SR, amplitude: 0.6, channels: 2 }));
    const out = sidechainDuck(target, key, { amountDb: -12, attackMs: 30, releaseMs: 150, holdMs: 50 });
    const ratio = rmsAt(out, 1.5, 1.7) / rmsAt(target, 1.5, 1.7);
    expect(ratio).toBeGreaterThan(dbToGain(-12) * 0.85);
    expect(ratio).toBeLessThan(dbToGain(-12) * 1.2);
  });

  it("reads a key shorter than the target (no duck past the key's end)", () => {
    const target = sine(440, 1.0, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const key = sine(200, 0.3, { sampleRate: SR, amplitude: 0.6, channels: 2 }); // only first 0.3 s
    const out = sidechainDuck(target, key, { amountDb: -18, attackMs: 20, releaseMs: 100, holdMs: 20 });
    expect(rmsAt(out, 0.1, 0.25)).toBeLessThan(rmsAt(target, 0.1, 0.25) * 0.6); // ducked under the key
    expect(rmsAt(out, 0.8, 1.0)).toBeGreaterThan(rmsAt(target, 0.8, 1.0) * 0.8); // unity after it ends
  });

  it("works on a mono target and does not mutate either input", () => {
    const target = fromChannels([sine(440, 0.6, { sampleRate: SR, amplitude: 0.5 }).channels[0]], SR);
    const key = concat(generateSilence(0.2, 1, SR), sine(200, 0.2, { sampleRate: SR, amplitude: 0.6 }), generateSilence(0.2, 1, SR));
    const tCopy = Array.from(target.channels[0]);
    const kCopy = Array.from(key.channels[0]);
    const out = sidechainDuck(target, key, { amountDb: -15 });
    expect(channelCount(out)).toBe(1);
    expect(frameCount(out)).toBe(frameCount(target));
    expect(Array.from(target.channels[0])).toEqual(tCopy);
    expect(Array.from(key.channels[0])).toEqual(kCopy);
  });

  it("handles an empty target", () => {
    const out = sidechainDuck(createAudioData(2, 0, SR), sine(200, 0.2, { sampleRate: SR }));
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});
