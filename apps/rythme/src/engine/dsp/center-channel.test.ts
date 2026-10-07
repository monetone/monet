// ─────────────────────────────────────────────────────────────
// engine/dsp/center-channel.test — Audition-style Center Channel Extractor
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { peakAmplitude, rmsAmplitude } from "./normalize";
import { centerChannelExtract } from "./center-channel";

const SR = 44100;

/** Build a stereo buffer from explicit left/right channel arrays. */
function stereo(l: Float32Array, r: Float32Array): AudioData {
  return { sampleRate: SR, channels: [l, r] };
}

/** RMS of the steady-state tail (last half) of a channel. */
function tailRms(ch: Float32Array): number {
  const start = Math.floor(ch.length / 2);
  let sum = 0;
  for (let i = start; i < ch.length; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / (ch.length - start));
}

describe("centerChannelExtract", () => {
  it("remove: cancels a center-panned tone to near silence", () => {
    const center = sine(1000, 0.1, { sampleRate: SR, amplitude: 0.6, channels: 2 }); // L == R
    const out = centerChannelExtract(center, { mode: "remove" });
    expect(channelCount(out)).toBe(2);
    expect(gainToDb(peakAmplitude(center)) - gainToDb(peakAmplitude(out))).toBeGreaterThanOrEqual(40);
  });

  it("remove: preserves a hard-panned (side) tone", () => {
    const left = sine(440, 0.1, { sampleRate: SR, amplitude: 0.6 }).channels[0];
    const out = centerChannelExtract(stereo(left, new Float32Array(left.length)), { mode: "remove" });
    // hard-left content survives as side material (≈ half amplitude), not cancelled
    expect(peakAmplitude(out)).toBeGreaterThan(0.25);
  });

  it("remove: retains the side instrument exactly, drops the centered vocal", () => {
    const vocal = sine(1000, 0.1, { sampleRate: SR, amplitude: 0.5 }).channels[0];
    const inst = sine(300, 0.1, { sampleRate: SR, amplitude: 0.5 }).channels[0];
    const l = vocal.map((v, i) => v + inst[i]);
    const r = vocal.slice();
    const out = centerChannelExtract(stereo(l, r), { mode: "remove" });
    // (L - R)/2 = inst/2 on the left, −inst/2 on the right; vocal fully gone.
    let maxErr = 0;
    for (let i = 0; i < inst.length; i++) maxErr = Math.max(maxErr, Math.abs(out.channels[0][i] - inst[i] * 0.5));
    expect(maxErr).toBeLessThan(1e-6);
  });

  it("keep: preserves a center-panned tone", () => {
    const center = sine(1000, 0.1, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const out = centerChannelExtract(center, { mode: "keep" });
    let maxErr = 0;
    for (let i = 0; i < frameCount(center); i++) maxErr = Math.max(maxErr, Math.abs(out.channels[0][i] - center.channels[0][i]));
    expect(maxErr).toBeLessThan(1e-6);
  });

  it("keep: removes pure side content (anti-phase) to near silence", () => {
    const a = sine(700, 0.1, { sampleRate: SR, amplitude: 0.6 }).channels[0];
    const out = centerChannelExtract(stereo(a, a.map((v) => -v)), { mode: "keep" });
    expect(peakAmplitude(out)).toBeLessThan(1e-6);
  });

  it("centerLevelDb gives partial removal (−6 dB ≈ half)", () => {
    const center = sine(1000, 0.1, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const out = centerChannelExtract(center, { mode: "remove", centerLevelDb: -6 });
    const drop = gainToDb(rmsAmplitude(center)) - gainToDb(rmsAmplitude(out));
    expect(Math.abs(drop - 6)).toBeLessThan(0.5);
  });

  it("frequency range: removes in-band center, preserves out-of-band (bass)", () => {
    const bass = sine(200, 0.3, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const vox = sine(5000, 0.3, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const keptBass = centerChannelExtract(bass, { mode: "remove", lowFreq: 1500, highFreq: 12000 });
    const killedVox = centerChannelExtract(vox, { mode: "remove", lowFreq: 1500, highFreq: 12000 });
    const bassDrop = gainToDb(tailRms(bass.channels[0])) - gainToDb(tailRms(keptBass.channels[0]));
    const voxDrop = gainToDb(tailRms(vox.channels[0])) - gainToDb(tailRms(killedVox.channels[0]));
    expect(bassDrop).toBeLessThan(3); // 200 Hz below the band → preserved
    expect(voxDrop).toBeGreaterThanOrEqual(18); // 5 kHz inside the band → removed
  });

  it("preserves frame count and up-mixes mono to stereo", () => {
    const mono = sine(440, 0.1, { sampleRate: SR, amplitude: 0.6, channels: 1 });
    const out = centerChannelExtract(mono, { mode: "remove" });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(mono));
    // a mono source is all-center → remove → silence
    expect(peakAmplitude(out)).toBeLessThan(1e-6);
  });

  it("is deterministic", () => {
    const center = sine(1000, 0.1, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const a = centerChannelExtract(center, { mode: "remove", lowFreq: 200, highFreq: 8000 });
    const b = centerChannelExtract(center, { mode: "remove", lowFreq: 200, highFreq: 8000 });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("handles an empty buffer", () => {
    const out = centerChannelExtract(createAudioData(2, 0, SR), { mode: "remove" });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });

  it("does not mutate its input", () => {
    const l = sine(1000, 0.05, { sampleRate: SR, amplitude: 0.5 }).channels[0];
    const r = sine(300, 0.05, { sampleRate: SR, amplitude: 0.5 }).channels[0];
    const src = stereo(l, r);
    const copyL = Array.from(l);
    centerChannelExtract(src, { mode: "remove", lowFreq: 200, highFreq: 8000 });
    expect(Array.from(src.channels[0])).toEqual(copyL);
  });
});
