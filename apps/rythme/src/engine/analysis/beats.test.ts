// ─────────────────────────────────────────────────────────────
// engine/analysis/beats.test — onset / beat detection + tempo
// ─────────────────────────────────────────────────────────────
// A synthetic click track at a known BPM must round-trip: the detector finds a
// click on each beat and recovers the tempo from the inter-onset spacing.

import { describe, expect, it } from "vitest";
import { fromChannels } from "../audio/buffer";
import { sine } from "../generate/tone";
import { generateSilence } from "../generate/silence";
import { detectBeats } from "./beats";

const SR = 44100;

/** A mono click track: `count` short 2 kHz bursts spaced at `bpm`. */
function clickTrack(bpm: number, count: number): { audio: ReturnType<typeof fromChannels>; interval: number } {
  const interval = 60 / bpm;
  const n = Math.round(count * interval * SR);
  const ch = new Float32Array(n);
  const burst = Math.round(0.006 * SR); // 6 ms decaying click
  for (let k = 0; k < count; k++) {
    const start = Math.round(k * interval * SR);
    for (let i = 0; i < burst && start + i < n; i++) {
      ch[start + i] = 0.9 * Math.sin((2 * Math.PI * 2000 * i) / SR) * (1 - i / burst);
    }
  }
  return { audio: fromChannels([ch], SR), interval };
}

describe("detectBeats", () => {
  it("recovers 120 BPM and one beat per click", () => {
    const { audio } = clickTrack(120, 8);
    const r = detectBeats(audio);
    expect(r.bpm).toBeGreaterThan(117);
    expect(r.bpm).toBeLessThan(123);
    expect(r.beats.length).toBeGreaterThanOrEqual(7);
    expect(r.beats.length).toBeLessThanOrEqual(9);
  });

  it("recovers a slower 90 BPM tempo", () => {
    const r = detectBeats(clickTrack(90, 8).audio);
    expect(r.bpm).toBeGreaterThan(87);
    expect(r.bpm).toBeLessThan(93);
  });

  it("places the beats on the click grid (≈ every interval)", () => {
    const { audio, interval } = clickTrack(120, 6);
    const { beats } = detectBeats(audio);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i]).toBeGreaterThan(beats[i - 1]); // strictly ascending
      expect(Math.abs(beats[i] - beats[i - 1] - interval)).toBeLessThan(0.02); // within 20 ms of the grid
    }
  });

  it("a steady tone has no rhythmic structure (bpm 0)", () => {
    const r = detectBeats(sine(440, 3, { sampleRate: SR, amplitude: 0.6 }));
    expect(r.bpm).toBe(0);
    expect(r.beats.length).toBeLessThanOrEqual(1); // only the initial onset, if any
  });

  it("silence yields no beats", () => {
    const r = detectBeats(generateSilence(2, 1, SR));
    expect(r.beats).toEqual([]);
    expect(r.bpm).toBe(0);
  });

  it("a faster tempo packs more beats into the same duration", () => {
    const fast = detectBeats(clickTrack(150, 10).audio); // ~4.0 s
    const slow = detectBeats(clickTrack(75, 5).audio); // ~4.0 s
    expect(fast.beats.length).toBeGreaterThan(slow.beats.length);
    expect(fast.bpm).toBeGreaterThan(slow.bpm);
  });

  it("works on a stereo click track", () => {
    const mono = clickTrack(120, 6).audio.channels[0];
    const r = detectBeats(fromChannels([mono, mono], SR));
    expect(r.bpm).toBeGreaterThan(117);
    expect(r.bpm).toBeLessThan(123);
  });
});
