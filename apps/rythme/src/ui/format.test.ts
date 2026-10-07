// ─────────────────────────────────────────────────────────────
// ui/format.test — Display Time Format (Adobe Audition parity)
// ─────────────────────────────────────────────────────────────
// Pins each Audition Display Time Format to exact, hand-computable anchors.

import { describe, expect, it } from "vitest";
import { TIME_FORMATS, formatTime, timecode } from "./format";

describe("Display Time Format (Audition's View ▸ Display Time Format)", () => {
  it("offers Audition's four core formats in order", () => {
    expect(TIME_FORMATS.map((f) => f.id)).toEqual(["decimal", "smpte30", "samples", "barsBeats"]);
  });

  it("decimal matches the existing mm:ss.ms timecode", () => {
    expect(formatTime(75.5, "decimal")).toBe("01:15.500");
    expect(formatTime(75.5, "decimal")).toBe(timecode(75.5));
    expect(formatTime(0, "decimal")).toBe("00:00.000");
  });

  it("samples = round(seconds × sampleRate)", () => {
    expect(formatTime(1.5, "samples", { sampleRate: 44100 })).toBe("66150");
    expect(formatTime(1.5, "samples", { sampleRate: 48000 })).toBe("72000");
    expect(formatTime(0, "samples", { sampleRate: 48000 })).toBe("0");
    // defaults to 44.1 kHz when no rate is supplied
    expect(formatTime(2, "samples")).toBe("88200");
  });

  it("smpte30 is hh:mm:ss:ff at 30 non-drop fps", () => {
    expect(formatTime(1.5, "smpte30")).toBe("00:00:01:15"); // 45 frames → 1s + 15f
    expect(formatTime(0, "smpte30")).toBe("00:00:00:00");
    expect(formatTime(3661, "smpte30")).toBe("01:01:01:00"); // 1h 1m 1s exactly
    expect(formatTime(1 / 30, "smpte30")).toBe("00:00:00:01"); // one frame
  });

  it("barsBeats counts bars:beat:ticks from tempo + time signature", () => {
    const o = { tempo: 120, timeSignature: [4, 4] as [number, number] };
    expect(formatTime(0, "barsBeats", o)).toBe("1:1:000");
    expect(formatTime(0.5, "barsBeats", o)).toBe("1:2:000"); // 1 beat @120bpm = 0.5s
    expect(formatTime(1.0, "barsBeats", o)).toBe("1:3:000");
    expect(formatTime(2.0, "barsBeats", o)).toBe("2:1:000"); // 4 beats → next bar
  });

  it("barsBeats respects the time signature numerator (3/4 → 3 beats per bar)", () => {
    const o = { tempo: 120, timeSignature: [3, 4] as [number, number] };
    expect(formatTime(1.5, "barsBeats", o)).toBe("2:1:000"); // 3 beats = one 3/4 bar
  });

  it("clamps negative time to zero", () => {
    expect(formatTime(-5, "samples", { sampleRate: 48000 })).toBe("0");
    expect(formatTime(-5, "smpte30")).toBe("00:00:00:00");
  });
});
