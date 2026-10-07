// ─────────────────────────────────────────────────────────────
// engine/dsp/sidechain-gate.test — keyed (sidechain) gate
// ─────────────────────────────────────────────────────────────
// The target is audible only while the key plays — the INVERSE of the Auto-Duck
// (which is quiet while the key plays). A key burst in the middle leaves the
// target full in the middle and gated at the ends.

import { describe, expect, it } from "vitest";
import { concat, createAudioData, fromChannels } from "../audio/buffer";
import { channelCount, frameCount } from "../audio/types";
import { sine } from "../generate/tone";
import { generateSilence } from "../generate/silence";
import { sidechainGate } from "./sidechain-gate";

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

/** 1.6 s target tone; key silent · loud · silent (burst at 0.4–0.8 s). */
function targetAndKey(keyAmp = 0.6) {
  const target = sine(440, 1.6, { sampleRate: SR, amplitude: 0.5, channels: 2 });
  const key = concat(
    generateSilence(0.4, 2, SR),
    sine(200, 0.4, { sampleRate: SR, amplitude: keyAmp, channels: 2 }),
    generateSilence(0.8, 2, SR),
  );
  return { target, key };
}

describe("sidechainGate", () => {
  it("opens only while the key plays and gates the ends (inverse of ducking)", () => {
    const { target, key } = targetAndKey();
    const out = sidechainGate(target, key, { thresholdDb: -30, rangeDb: -40, attackMs: 5, releaseMs: 80, holdMs: 30 });
    const ref = rmsAt(target, 0.55, 0.78);
    const opened = rmsAt(out, 0.55, 0.78); // during the key → full
    const startGated = rmsAt(out, 0.05, 0.3); // before the key → attenuated
    const endGated = rmsAt(out, 1.4, 1.6); // after the key → attenuated
    expect(opened).toBeGreaterThan(ref * 0.85);
    expect(startGated).toBeLessThan(ref * 0.1);
    expect(endGated).toBeLessThan(ref * 0.1);
  });

  it("fully gates the target when the key is silent", () => {
    const target = sine(440, 0.5, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const out = sidechainGate(target, generateSilence(0.5, 2, SR), { rangeDb: -50 });
    expect(rmsAt(out, 0.1, 0.5)).toBeLessThan(rmsAt(target, 0.1, 0.5) * 0.05);
  });

  it("passes the target when the key is always present", () => {
    const target = sine(440, 0.6, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const key = sine(200, 0.6, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const out = sidechainGate(target, key, { thresholdDb: -30, attackMs: 5 });
    // after the brief opening ramp, the target is essentially untouched
    expect(rmsAt(out, 0.1, 0.6)).toBeCloseTo(rmsAt(target, 0.1, 0.6), 2);
  });

  it("a deeper range attenuates the closed gate more", () => {
    const { target, key } = targetAndKey();
    const shallow = sidechainGate(target, key, { rangeDb: -18, holdMs: 30 });
    const deep = sidechainGate(target, key, { rangeDb: -60, holdMs: 30 });
    expect(rmsAt(deep, 1.4, 1.6)).toBeLessThan(rmsAt(shallow, 1.4, 1.6));
  });

  it("a key below the threshold keeps the gate shut", () => {
    const { target, key } = targetAndKey(0.01); // ~−40 dBFS key
    const out = sidechainGate(target, key, { thresholdDb: -30, rangeDb: -50 });
    expect(rmsAt(out, 0.55, 0.78)).toBeLessThan(rmsAt(target, 0.55, 0.78) * 0.1);
  });

  it("works on a mono target and does not mutate either input", () => {
    const target = fromChannels([sine(440, 0.6, { sampleRate: SR, amplitude: 0.5 }).channels[0]], SR);
    const key = concat(generateSilence(0.2, 1, SR), sine(200, 0.2, { sampleRate: SR, amplitude: 0.6 }), generateSilence(0.2, 1, SR));
    const tCopy = Array.from(target.channels[0]);
    const kCopy = Array.from(key.channels[0]);
    const out = sidechainGate(target, key, { rangeDb: -40 });
    expect(channelCount(out)).toBe(1);
    expect(frameCount(out)).toBe(frameCount(target));
    expect(Array.from(target.channels[0])).toEqual(tCopy);
    expect(Array.from(key.channels[0])).toEqual(kCopy);
  });

  it("handles an empty target", () => {
    const out = sidechainGate(createAudioData(2, 0, SR), sine(200, 0.2, { sampleRate: SR }));
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});
