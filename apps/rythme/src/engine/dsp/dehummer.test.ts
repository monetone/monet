// ─────────────────────────────────────────────────────────────
// engine/dsp/dehummer.test — Audition-style hum removal
// ─────────────────────────────────────────────────────────────
// A pure tone's steady-state RMS through an IIR filter reflects the filter's
// magnitude at that frequency. Narrow (high-Q) notches settle slowly, so we
// measure the tail (last half) of long tones to read the steady-state gain
// without the startup transient — then express the attenuation in dB.

import { describe, expect, it } from "vitest";
import { createAudioData, fromChannels } from "../audio/buffer";
import { gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { rmsAmplitude } from "./normalize";
import { deHum } from "./dehummer";

const SR = 8000;

/** RMS of the steady-state tail (last `1-frac` of the channel). */
function tailRms(ch: Float32Array, frac = 0.5): number {
  const start = Math.floor(ch.length * frac);
  let sum = 0;
  for (let i = start; i < ch.length; i++) sum += ch[i] * ch[i];
  const n = ch.length - start;
  return n ? Math.sqrt(sum / n) : 0;
}

/** Steady-state attenuation in dB at channel 0 (positive = attenuated). */
function tailDropDb(input: AudioData, output: AudioData): number {
  return gainToDb(tailRms(input.channels[0])) - gainToDb(tailRms(output.channels[0]));
}

describe("deHum", () => {
  it("attenuates a tone at the fundamental by >= 20 dB", () => {
    const hum = sine(60, 1, { sampleRate: SR, amplitude: 0.5 });
    const out = deHum(hum, { frequency: 60, reductionDb: -24, harmonics: 1 });
    expect(tailDropDb(hum, out)).toBeGreaterThanOrEqual(20);
  });

  it("preserves a tone at a non-harmonic frequency (1000 Hz)", () => {
    const tone = sine(1000, 1, { sampleRate: SR, amplitude: 0.5 });
    const out = deHum(tone, { frequency: 60, reductionDb: -24, harmonics: 8 });
    expect(Math.abs(tailDropDb(tone, out))).toBeLessThan(1.5);
  });

  it("only filters harmonics up to the configured count", () => {
    const third = sine(180, 1, { sampleRate: SR, amplitude: 0.5 }); // 3rd harmonic of 60
    const keep = deHum(third, { frequency: 60, harmonics: 2, reductionDb: -24 });
    const kill = deHum(third, { frequency: 60, harmonics: 3, reductionDb: -24 });
    expect(Math.abs(tailDropDb(third, keep))).toBeLessThan(1.5); // 180 not reached at harmonics=2
    expect(tailDropDb(third, kill)).toBeGreaterThanOrEqual(20); // reached at harmonics=3
  });

  it("harmonicFalloff reduces higher harmonics less than the fundamental", () => {
    const second = sine(120, 1, { sampleRate: SR, amplitude: 0.5 }); // 2nd harmonic
    const uniform = deHum(second, { frequency: 60, harmonics: 2, reductionDb: -24, harmonicFalloff: 1 });
    const tapered = deHum(second, { frequency: 60, harmonics: 2, reductionDb: -24, harmonicFalloff: 0.25 });
    expect(tailDropDb(second, uniform)).toBeGreaterThan(tailDropDb(second, tapered) + 6);
  });

  it("notch mode deeply nulls the fundamental", () => {
    const hum = sine(60, 1, { sampleRate: SR, amplitude: 0.5 });
    const out = deHum(hum, { frequency: 60, harmonics: 1, mode: "notch" });
    expect(tailDropDb(hum, out)).toBeGreaterThanOrEqual(30);
  });

  it("removes hum while keeping a co-mixed voice-band tone", () => {
    const hum = sine(60, 1, { sampleRate: SR, amplitude: 0.4 });
    const voice = sine(900, 1, { sampleRate: SR, amplitude: 0.4 });
    const mixed: AudioData = { sampleRate: SR, channels: [hum.channels[0].map((v, i) => v + voice.channels[0][i])] };
    const out = deHum(mixed, { frequency: 60, harmonics: 4, reductionDb: -30 });
    // Output tail should drop (hum gone) and land close to the voice-only level.
    const voiceDb = gainToDb(tailRms(voice.channels[0]));
    const outDb = gainToDb(tailRms(out.channels[0]));
    expect(outDb).toBeLessThan(gainToDb(tailRms(mixed.channels[0])) - 1);
    expect(Math.abs(outDb - voiceDb)).toBeLessThan(2);
  });

  it("preserves channel count and exact frame count; processes stereo", () => {
    const stereo = sine(60, 1, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const out = deHum(stereo, { frequency: 60, harmonics: 3 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(stereo));
    const rightDrop = gainToDb(tailRms(stereo.channels[1])) - gainToDb(tailRms(out.channels[1]));
    expect(rightDrop).toBeGreaterThanOrEqual(20);
  });

  it("is deterministic", () => {
    const hum = sine(50, 0.3, { sampleRate: SR, amplitude: 0.5 });
    const a = deHum(hum, { frequency: 50, harmonics: 5 });
    const b = deHum(hum, { frequency: 50, harmonics: 5 });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("no-ops (returns an unchanged copy) for degenerate options", () => {
    const tone = sine(440, 0.1, { sampleRate: SR, amplitude: 0.5 });
    for (const opts of [{ harmonics: 0 }, { frequency: 0 }, { reductionDb: 0 }]) {
      const out = deHum(tone, opts);
      expect(frameCount(out)).toBe(frameCount(tone));
      expect(Math.abs(gainToDb(rmsAmplitude(tone)) - gainToDb(rmsAmplitude(out)))).toBeLessThan(1e-6);
      expect(out).not.toBe(tone); // a copy, not the same reference
    }
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(2, 0, SR);
    const out = deHum(empty, { frequency: 60 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });

  it("does not mutate its input", () => {
    const tone = fromChannels([[0.5, -0.5, 0.25, -0.25, 0.1, -0.1, 0.3, -0.3]], SR);
    const copy = Array.from(tone.channels[0]);
    deHum(tone, { frequency: 60, harmonics: 4 });
    expect(Array.from(tone.channels[0])).toEqual(copy);
  });
});
