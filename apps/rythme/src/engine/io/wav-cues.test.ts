// ─────────────────────────────────────────────────────────────
// engine/io/wav-cues.test — WAV cue-point markers
// ─────────────────────────────────────────────────────────────
// Markers embedded as a `cue ` chunk (+ LIST/adtl/labl labels) must round-trip
// through encode → decode, and must not disturb the audio decode.

import { describe, expect, it } from "vitest";
import { sine } from "../generate/tone";
import { analyzeLevels } from "../analysis/levels";
import { decodeWav, decodeWavCues, encodeWav } from "./wav";

const SR = 44100;
const tone = (ch = 2, sec = 1) => sine(440, sec, { sampleRate: SR, amplitude: 0.5, channels: ch });

describe("WAV cue points", () => {
  it("round-trips marker times and names", () => {
    const markers = [
      { time: 0.5, name: "Intro" },
      { time: 1.25, name: "Verse" },
      { time: 1.75 },
    ];
    const cues = decodeWavCues(encodeWav(tone(2, 2), { bitDepth: 16, markers }));
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ time: 0.5, name: "Intro" });
    expect(cues[1]).toEqual({ time: 1.25, name: "Verse" });
    expect(cues[2].time).toBeCloseTo(1.75, 6);
    expect(cues[2].name).toBeUndefined(); // an unlabelled cue
  });

  it("preserves the audio when cues are present", () => {
    const d = tone(2, 1);
    const withCues = encodeWav(d, { bitDepth: 16, markers: [{ time: 0.5, name: "X" }] });
    const decoded = decodeWav(withCues);
    expect(decoded.channels[0].length).toBe(d.channels[0].length);
    // a 0.5-amplitude tone still reads ~−6 dBFS peak after the round-trip
    expect(analyzeLevels(decoded).peakDb).toBeCloseTo(-6, 0);
  });

  it("produces byte-identical output to a plain encode when there are no markers", () => {
    const d = tone(2, 0.5);
    const plain = encodeWav(d, { bitDepth: 16 });
    const empty = encodeWav(d, { bitDepth: 16, markers: [] });
    expect(Array.from(empty)).toEqual(Array.from(plain));
  });

  it("handles odd-length labels (word alignment) and many markers", () => {
    const markers = Array.from({ length: 5 }, (_, i) => ({ time: i * 0.3 + 0.1, name: "m".repeat(i + 1) })); // 1..5 chars
    const cues = decodeWavCues(encodeWav(tone(1, 2), { bitDepth: 24, markers })); // 24-bit mono → odd-byte data path
    expect(cues).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(cues[i].time).toBeCloseTo(i * 0.3 + 0.1, 5);
      expect(cues[i].name).toBe("m".repeat(i + 1));
    }
  });

  it("returns no cues for a WAV without a cue chunk", () => {
    expect(decodeWavCues(encodeWav(tone(2, 0.2), { bitDepth: 16 }))).toEqual([]);
    expect(decodeWavCues(new Uint8Array(8))).toEqual([]); // not even a WAV
  });

  it("skips markers at negative or non-finite times", () => {
    const cues = decodeWavCues(encodeWav(tone(2, 1), { bitDepth: 16, markers: [{ time: -1, name: "bad" }, { time: 0.5, name: "ok" }, { time: NaN }] }));
    expect(cues).toHaveLength(1);
    expect(cues[0].name).toBe("ok");
  });
});
