// ─────────────────────────────────────────────────────────────
// engine/dsp/declick.test — Audition-style DeClicker
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData, fromChannels } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { rmsAmplitude } from "./normalize";
import { deClick } from "./declick";

const SR = 44100;
const CLICKS = [500, 1500, 2500, 3500, 4500, 5500, 6500];

/** Clean tone with large impulse clicks injected (opposite sign to the local sample). */
function withClicks(clean: AudioData): AudioData {
  const ch = clean.channels[0].slice();
  for (const p of CLICKS) ch[p] = 0.99 * (clean.channels[0][p] >= 0 ? -1 : 1);
  return { sampleRate: SR, channels: [ch] };
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("deClick", () => {
  it("removes injected clicks and restores the underlying tone", () => {
    const clean = sine(440, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const clicked = withClicks(clean);
    const out = deClick(clicked);
    expect(maxAbsDiff(clicked.channels[0], clean.channels[0])).toBeGreaterThan(0.8); // clicks really are big
    expect(maxAbsDiff(out.channels[0], clean.channels[0])).toBeLessThan(0.15); // and gone after de-click
  });

  it("preserves a clean signal (nothing flagged below the floor)", () => {
    const clean = sine(440, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const out = deClick(clean);
    expect(maxAbsDiff(out.channels[0], clean.channels[0])).toBeLessThan(1e-6);
  });

  it("removes the clicks' excess energy (RMS back toward clean)", () => {
    const clean = sine(440, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const clicked = withClicks(clean);
    const out = deClick(clicked);
    expect(rmsAmplitude(clicked)).toBeGreaterThan(rmsAmplitude(clean));
    expect(Math.abs(rmsAmplitude(out) / rmsAmplitude(clean) - 1)).toBeLessThan(0.05);
  });

  it("a high threshold detects nothing (clicks left intact)", () => {
    const clicked = withClicks(sine(440, 0.2, { sampleRate: SR, amplitude: 0.5 }));
    const out = deClick(clicked, { threshold: 2.0 }); // floor above any residual
    expect(maxAbsDiff(out.channels[0], clicked.channels[0])).toBeLessThan(1e-6);
  });

  it("preserves channel + frame count and processes stereo", () => {
    const clean = sine(440, 0.1, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const ch0 = clean.channels[0].slice();
    const ch1 = clean.channels[1].slice();
    ch0[1000] = -0.99;
    ch1[1500] = 0.99;
    const out = deClick({ sampleRate: SR, channels: [ch0, ch1] });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(clean));
  });

  it("is deterministic", () => {
    const clicked = withClicks(sine(440, 0.1, { sampleRate: SR, amplitude: 0.5 }));
    const a = deClick(clicked);
    const b = deClick(clicked);
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input", () => {
    const clicked = withClicks(sine(440, 0.1, { sampleRate: SR, amplitude: 0.5 }));
    const copy = Array.from(clicked.channels[0]);
    deClick(clicked);
    expect(Array.from(clicked.channels[0])).toEqual(copy);
  });

  it("handles short and empty buffers", () => {
    expect(frameCount(deClick(createAudioData(1, 0, SR)))).toBe(0);
    const tiny = fromChannels([[0.1, -0.2]], SR); // < 3 samples → returned as-is
    expect(Array.from(deClick(tiny).channels[0])).toEqual([0.1, -0.2].map((v) => Math.fround(v)));
  });
});
