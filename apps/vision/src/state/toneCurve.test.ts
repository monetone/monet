// Unit tests for the Curves tone-curve LUT helpers. Engine-free (node); the dialog
// channel-selector wiring is covered by e2e/curves-channel.spec.ts.
import { describe, it, expect } from "vitest";
import { buildLut, identityLut, buildCurveLuts, CURVE_CHANNELS } from "./toneCurve";

const DIAGONAL = [{ x: 0, y: 0 }, { x: 1, y: 1 }];

describe("identityLut", () => {
  it("maps every level to itself", () => {
    const lut = identityLut();
    expect(lut.length).toBe(256);
    expect([lut[0], lut[128], lut[255]]).toEqual([0, 128, 255]);
    expect(Array.from(lut).every((v, i) => v === i)).toBe(true);
  });
});

describe("buildLut", () => {
  it("the identity diagonal yields the identity LUT", () => {
    const lut = buildLut(DIAGONAL);
    expect(Array.from(lut).every((v, i) => v === i)).toBe(true);
  });

  it("an empty point set falls back to identity", () => {
    expect(Array.from(buildLut([]))).toEqual(Array.from(identityLut()));
  });

  it("clamps output to [0,255] and stays monotonic for a steeper line", () => {
    // y = 2x clipped: lifts midtones, clamps the top half to 255.
    const lut = buildLut([{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }]);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBeGreaterThan(128); // midtone lifted
    expect(lut[255]).toBe(255);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });

  it("a flat line maps everything to one level", () => {
    const lut = buildLut([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]);
    expect(Array.from(lut).every((v) => v === 128)).toBe(true);
  });
});

describe("buildCurveLuts channel routing", () => {
  it("routes the edited channel to its slot, leaving the rest identity", () => {
    const editedRed = [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }];
    const { master, r, g, b } = buildCurveLuts([DIAGONAL, editedRed, DIAGONAL, DIAGONAL]);
    const id = identityLut();
    expect(Array.from(master)).toEqual(Array.from(id));
    expect(Array.from(g)).toEqual(Array.from(id));
    expect(Array.from(b)).toEqual(Array.from(id));
    expect(Array.from(r)).toEqual(Array.from(buildLut(editedRed)));
    expect(Array.from(r)).not.toEqual(Array.from(id)); // genuinely changed
  });

  it("exposes the four channel options in order", () => {
    expect(CURVE_CHANNELS.map((c) => c.value)).toEqual([0, 1, 2, 3]);
    expect(CURVE_CHANNELS.map((c) => c.label)).toEqual(["RGB", "Red", "Green", "Blue"]);
  });
});
