import { describe, expect, it } from "vitest";

import {
  formatAperture,
  formatCamera,
  formatFocal,
  formatGps,
  formatIso,
  formatShutter,
} from "./exifFormat";

describe("formatShutter", () => {
  it("shows sub-second as a reciprocal fraction", () => {
    expect(formatShutter(0.008)).toBe("1/125 s");
    expect(formatShutter(0.5)).toBe("1/2 s");
  });
  it("shows one second and above as decimals", () => {
    expect(formatShutter(1)).toBe("1 s");
    expect(formatShutter(2.5)).toBe("2.5 s");
  });
  it("is null for missing/invalid", () => {
    expect(formatShutter(null)).toBeNull();
    expect(formatShutter(0)).toBeNull();
  });
});

describe("formatAperture / formatFocal / formatIso", () => {
  it("formats each with its unit", () => {
    expect(formatAperture(1.8)).toBe("f/1.8");
    expect(formatFocal(50.4)).toBe("50 mm");
    expect(formatIso(400)).toBe("ISO 400");
  });
  it("null-guards absent values", () => {
    expect(formatAperture(null)).toBeNull();
    expect(formatFocal(0)).toBeNull();
    expect(formatIso(null)).toBeNull();
  });
});

describe("formatCamera", () => {
  it("de-dupes a make repeated in the model", () => {
    expect(formatCamera("Canon", "Canon EOS R5")).toBe("Canon EOS R5");
  });
  it("joins distinct make + model", () => {
    expect(formatCamera("NIKON CORPORATION", "D850")).toBe("NIKON CORPORATION D850");
  });
  it("handles a lone model or nothing", () => {
    expect(formatCamera(null, "X100V")).toBe("X100V");
    expect(formatCamera(null, null)).toBeNull();
  });
});

describe("formatGps", () => {
  it("formats a coordinate pair", () => {
    expect(formatGps(37.1234567, -122.2)).toBe("37.12346, -122.20000");
  });
  it("is null unless both coordinates are present", () => {
    expect(formatGps(37.1, null)).toBeNull();
    expect(formatGps(null, -122.2)).toBeNull();
  });
});
