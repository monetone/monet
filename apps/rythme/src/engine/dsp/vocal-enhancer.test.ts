// ─────────────────────────────────────────────────────────────
// engine/dsp/vocal-enhancer.test — Audition-style Vocal Enhancer
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { rmsAmplitude } from "./normalize";
import { vocalEnhance } from "./vocal-enhancer";

const SR = 44100;

const dropDb = (a: AudioData, b: AudioData) => gainToDb(rmsAmplitude(a)) - gainToDb(rmsAmplitude(b));

describe("vocalEnhance", () => {
  it("male and female modes cut low rumble", () => {
    const rumble = sine(50, 0.3, { sampleRate: SR, amplitude: 0.5 });
    expect(dropDb(rumble, vocalEnhance(rumble, { mode: "male" }))).toBeGreaterThanOrEqual(10);
    expect(dropDb(rumble, vocalEnhance(rumble, { mode: "female" }))).toBeGreaterThanOrEqual(10);
  });

  it("Music mode is gentler on the low end than Male", () => {
    const low = sine(60, 0.3, { sampleRate: SR, amplitude: 0.5 });
    const maleDrop = dropDb(low, vocalEnhance(low, { mode: "male" }));
    const musicDrop = dropDb(low, vocalEnhance(low, { mode: "music" }));
    expect(maleDrop).toBeGreaterThan(musicDrop + 6);
  });

  it("boosts the presence band while leaving an off-band control alone", () => {
    const presence = sine(3500, 0.3, { sampleRate: SR, amplitude: 0.05 }); // quiet → below the compressor
    const control = sine(700, 0.3, { sampleRate: SR, amplitude: 0.05 });
    const presenceBoost = -dropDb(presence, vocalEnhance(presence, { mode: "male" }));
    const controlChange = -dropDb(control, vocalEnhance(control, { mode: "male" }));
    // Both get the compressor's makeup gain; only the presence band gets the
    // ~+3 dB peaking on top, so it must rise meaningfully more than the control.
    expect(presenceBoost - controlChange).toBeGreaterThanOrEqual(1.5);
  });

  it("all three modes run and change a voice-like signal", () => {
    const noise = whiteNoise(0.3, { sampleRate: SR, amplitude: 0.05, seed: 4 }).channels[0];
    const voice: AudioData = { sampleRate: SR, channels: [sine(300, 0.3, { sampleRate: SR, amplitude: 0.4 }).channels[0].map((v, i) => v + noise[i])] };
    for (const mode of ["male", "female", "music"] as const) {
      const out = vocalEnhance(voice, { mode });
      expect(frameCount(out)).toBe(frameCount(voice));
      let changed = false;
      for (let i = 0; i < out.channels[0].length; i++) {
        if (Math.abs(out.channels[0][i] - voice.channels[0][i]) > 1e-4) { changed = true; break; }
        if (!Number.isFinite(out.channels[0][i])) throw new Error("non-finite");
      }
      expect(changed).toBe(true);
    }
  });

  it("preserves channel + frame count and processes stereo", () => {
    const voice = sine(300, 0.2, { sampleRate: SR, amplitude: 0.4, channels: 2 });
    const out = vocalEnhance(voice, { mode: "female" });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(voice));
  });

  it("is deterministic", () => {
    const voice = sine(300, 0.2, { sampleRate: SR, amplitude: 0.4 });
    const a = vocalEnhance(voice, { mode: "male" });
    const b = vocalEnhance(voice, { mode: "male" });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input", () => {
    const voice = sine(300, 0.15, { sampleRate: SR, amplitude: 0.5 });
    const copy = Array.from(voice.channels[0]);
    vocalEnhance(voice, { mode: "male" });
    expect(Array.from(voice.channels[0])).toEqual(copy);
  });

  it("handles an empty buffer", () => {
    const out = vocalEnhance(createAudioData(2, 0, SR), { mode: "male" });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});
