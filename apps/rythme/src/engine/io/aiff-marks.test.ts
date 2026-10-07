// ─────────────────────────────────────────────────────────────
// engine/io/aiff-marks.test — AIFF MARK chunk markers
// ─────────────────────────────────────────────────────────────
// Markers embedded as an AIFF `MARK` chunk (big-endian, Pascal-string names)
// must round-trip through encode → decode without disturbing the audio.

import { describe, expect, it } from "vitest";
import { sine } from "../generate/tone";
import { analyzeLevels } from "../analysis/levels";
import { decodeAiff, decodeAiffMarks, encodeAiff } from "./aiff";

const SR = 44100;
const tone = (ch = 2, sec = 1) => sine(440, sec, { sampleRate: SR, amplitude: 0.5, channels: ch });

describe("AIFF markers", () => {
  it("round-trips marker times and names", () => {
    const markers = [
      { time: 0.5, name: "Intro" },
      { time: 1.25, name: "Verse" },
      { time: 1.75 },
    ];
    const marks = decodeAiffMarks(encodeAiff(tone(2, 2), { bitDepth: 16, markers }));
    expect(marks).toHaveLength(3);
    expect(marks[0]).toEqual({ time: 0.5, name: "Intro" });
    expect(marks[1]).toEqual({ time: 1.25, name: "Verse" });
    expect(marks[2].time).toBeCloseTo(1.75, 6);
    expect(marks[2].name).toBeUndefined(); // an unnamed marker
  });

  it("preserves the audio when markers are present", () => {
    const d = tone(2, 1);
    const decoded = decodeAiff(encodeAiff(d, { bitDepth: 16, markers: [{ time: 0.5, name: "X" }] }));
    expect(decoded.channels[0].length).toBe(d.channels[0].length);
    expect(analyzeLevels(decoded).peakDb).toBeCloseTo(-6, 0); // a 0.5-amp tone is still ~−6 dBFS
  });

  it("is byte-identical to a plain encode when there are no markers", () => {
    const d = tone(2, 0.5);
    expect(Array.from(encodeAiff(d, { bitDepth: 16, markers: [] }))).toEqual(Array.from(encodeAiff(d, { bitDepth: 16 })));
  });

  it("handles odd-length names (Pascal-string padding) and many markers", () => {
    const markers = Array.from({ length: 5 }, (_, i) => ({ time: i * 0.3 + 0.1, name: "m".repeat(i + 1) })); // 1..5 chars
    const marks = decodeAiffMarks(encodeAiff(tone(1, 2), { bitDepth: 24, markers })); // 24-bit mono → odd-byte data
    expect(marks).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(marks[i].time).toBeCloseTo(i * 0.3 + 0.1, 5);
      expect(marks[i].name).toBe("m".repeat(i + 1));
    }
  });

  it("returns no markers for an AIFF without a MARK chunk or a non-AIFF file", () => {
    expect(decodeAiffMarks(encodeAiff(tone(2, 0.2), { bitDepth: 16 }))).toEqual([]);
    expect(decodeAiffMarks(new Uint8Array(8))).toEqual([]);
  });

  it("skips markers at negative or non-finite times", () => {
    const marks = decodeAiffMarks(encodeAiff(tone(2, 1), { bitDepth: 16, markers: [{ time: -1, name: "bad" }, { time: 0.5, name: "ok" }, { time: NaN }] }));
    expect(marks).toHaveLength(1);
    expect(marks[0].name).toBe("ok");
  });
});
