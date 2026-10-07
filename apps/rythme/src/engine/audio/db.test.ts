import { describe, expect, it } from "vitest";
import { clamp, clampSample, dbToGain, DB_FLOOR, gainToDb } from "./db";

describe("dB conversions", () => {
  it("0 dB is unity gain", () => {
    expect(dbToGain(0)).toBeCloseTo(1);
    expect(gainToDb(1)).toBeCloseTo(0);
  });

  it("-6 dB ≈ half amplitude", () => {
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
  });

  it("+6 dB ≈ double amplitude", () => {
    expect(dbToGain(6)).toBeCloseTo(1.995, 2);
  });

  it("round-trips a range of values", () => {
    for (const db of [-48, -24, -12, -3, 0, 3, 6]) {
      expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 5);
    }
  });

  it("silence maps to the floor, not -Infinity", () => {
    expect(gainToDb(0)).toBe(DB_FLOOR);
  });

  it("clampSample hard-clips to [-1,1]", () => {
    expect(clampSample(2)).toBe(1);
    expect(clampSample(-2)).toBe(-1);
    expect(clampSample(0.5)).toBe(0.5);
  });

  it("clamp respects bounds", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
