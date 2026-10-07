// Unit tests for the default-colors helper. Engine-free (node); the D shortcut +
// Default button are covered by e2e/default-colors.spec.ts.
import { describe, it, expect } from "vitest";
import { defaultColors } from "./defaultColors";

describe("defaultColors", () => {
  it("is black fg / white bg when not editing a mask", () => {
    expect(defaultColors(false)).toEqual({ fg: { h: 0, s: 0, v: 0, a: 1 }, bg: { h: 0, s: 0, v: 1, a: 1 } });
  });

  it("inverts to white fg / black bg while editing a mask", () => {
    expect(defaultColors(true)).toEqual({ fg: { h: 0, s: 0, v: 1, a: 1 }, bg: { h: 0, s: 0, v: 0, a: 1 } });
  });

  it("is the normal black fg / white bg in Quick Mask (not inverted)", () => {
    expect(defaultColors(false, true)).toEqual({ fg: { h: 0, s: 0, v: 0, a: 1 }, bg: { h: 0, s: 0, v: 1, a: 1 } });
    // Quick Mask wins over the maskEdit inversion.
    expect(defaultColors(true, true)).toEqual({ fg: { h: 0, s: 0, v: 0, a: 1 }, bg: { h: 0, s: 0, v: 1, a: 1 } });
  });

  it("returns fresh, non-shared objects each call", () => {
    const a = defaultColors(false);
    const b = defaultColors(false);
    expect(a.fg).not.toBe(b.fg);
    expect(a.bg).not.toBe(b.bg);
  });
});
