import { describe, expect, it } from "vitest";
import {
  PHOTOSHOP_RAW_RE,
  guessPhotoshopRawLayout,
  initialPhotoshopRawLayout,
  photoshopRawBytesNeeded,
  type PhotoshopRawLayout,
} from "./photoshopRaw";

const layout = (over: Partial<PhotoshopRawLayout> = {}): PhotoshopRawLayout => ({
  width: 0, height: 0, channels: 3, interleaved: true, depth: 8, bigEndian: true, header: 0, ...over,
});

describe("Photoshop Raw layout", () => {
  it("counts the bytes a layout reads, header included", () => {
    expect(photoshopRawBytesNeeded(layout({ width: 4, height: 3, header: 10 }))).toBe(46);
    expect(photoshopRawBytesNeeded(layout({ width: 4, height: 3, channels: 1, depth: 16 }))).toBe(24);
  });

  it("guesses the squarest image that fills the file", () => {
    expect(guessPhotoshopRawLayout(60 * 50 * 3, layout())).toMatchObject({ width: 60, height: 50 });
    expect(guessPhotoshopRawLayout(100 * 100 * 2 + 16, layout({ channels: 1, depth: 16, header: 16 }))).toMatchObject({ width: 100, height: 100 });
    // A byte count that isn't whole pixels has no fit.
    expect(guessPhotoshopRawLayout(10, layout())).toBeNull();
  });

  it("derives the missing side, or the header when both sides are set", () => {
    expect(guessPhotoshopRawLayout(300 * 7 * 3, layout({ width: 300 }))).toMatchObject({ width: 300, height: 7 });
    expect(guessPhotoshopRawLayout(300 * 7 * 3, layout({ height: 300 }))).toMatchObject({ width: 7, height: 300 });
    expect(guessPhotoshopRawLayout(300 * 7 * 3, layout({ width: 301 }))).toBeNull();
    expect(guessPhotoshopRawLayout(64 * 64 * 3 + 128, layout({ width: 64, height: 64 }))).toMatchObject({ header: 128 });
    expect(guessPhotoshopRawLayout(10, layout({ width: 64, height: 64 }))).toBeNull();
  });

  it("starts the dialog on an RGB fit, else one grey channel", () => {
    expect(initialPhotoshopRawLayout(32 * 16 * 3)).toMatchObject({ width: 32, height: 16, channels: 3 });
    expect(initialPhotoshopRawLayout(7 * 11)).toMatchObject({ width: 11, height: 7, channels: 1 });
  });

  it("recognizes both Photoshop Raw suffixes", () => {
    expect(PHOTOSHOP_RAW_RE.test("scan.raw")).toBe(true);
    expect(PHOTOSHOP_RAW_RE.test("scan.RAWPS")).toBe(true);
    expect(PHOTOSHOP_RAW_RE.test("scan.cr2")).toBe(false);
  });
});
