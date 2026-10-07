import { describe, expect, it } from "vitest";
import {
  clamp,
  formatClock,
  framesToSeconds,
  framesToTimecode,
  secondsToFrames,
  sourceFrameAt,
  timecodeToFrames,
} from "./timecode";

describe("timecode", () => {
  it("formats non-drop timecode", () => {
    expect(framesToTimecode(0, 24)).toBe("00:00:00:00");
    expect(framesToTimecode(23, 24)).toBe("00:00:00:23");
    expect(framesToTimecode(24, 24)).toBe("00:00:01:00");
    expect(framesToTimecode(24 * 60, 24)).toBe("00:01:00:00");
    expect(framesToTimecode(24 * 3600, 24)).toBe("01:00:00:00");
  });

  it("round-trips timecode ⇄ frames", () => {
    for (const f of [0, 1, 24, 25, 1000, 99999]) {
      expect(timecodeToFrames(framesToTimecode(f, 24), 24)).toBe(f);
    }
  });

  it("parses partial timecodes", () => {
    expect(timecodeToFrames("12", 24)).toBe(12);
    expect(timecodeToFrames("01:00", 24)).toBe(24);
    expect(timecodeToFrames("01:00:00", 24)).toBe(24 * 60);
  });

  it("uses a drop-frame separator for 29.97", () => {
    expect(framesToTimecode(0, 29.97, true)).toBe("00:00:00;00");
  });

  it("seconds conversions", () => {
    expect(framesToSeconds(48, 24)).toBe(2);
    expect(secondsToFrames(2, 24)).toBe(48);
    expect(framesToSeconds(10, 0)).toBe(0);
  });

  it("formats a compact clock", () => {
    expect(formatClock(24 * 5, 24)).toBe("0:05");
    expect(formatClock(24 * 65, 24)).toBe("1:05");
    expect(formatClock(24 * 3725, 24)).toBe("1:02:05");
  });

  it("maps timeline frame → source frame with speed + in-point", () => {
    expect(sourceFrameAt(10, 0, 0, 1)).toBe(10);
    expect(sourceFrameAt(10, 5, 100, 1)).toBe(105);
    expect(sourceFrameAt(10, 0, 0, 2)).toBe(20);
    expect(sourceFrameAt(0, 5, 100, 1)).toBe(95);
    expect(sourceFrameAt(-100, 0, 0, 1)).toBe(0); // clamped ≥ 0
  });

  it("clamps", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
