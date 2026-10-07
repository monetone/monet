// Unit tests for the Copy Color formatters. Engine-free (node); the panel
// context-menu + clipboard path is covered by e2e/copy-color.spec.ts.
import { describe, it, expect } from "vitest";
import { colorHexCode, colorAsHtml, formatColor } from "./colorFormat";

describe("colorHexCode", () => {
  it("emits 6 lowercase hex digits with no leading #", () => {
    expect(colorHexCode(255, 0, 0)).toBe("ff0000");
    expect(colorHexCode(0, 128, 255)).toBe("0080ff");
    expect(colorHexCode(255, 255, 255)).toBe("ffffff");
    expect(colorHexCode(0, 0, 0)).toBe("000000");
  });
  it("zero-pads single-digit channels and clamps/rounds out-of-range input", () => {
    expect(colorHexCode(1, 2, 3)).toBe("010203");
    expect(colorHexCode(-5, 300, 127.6)).toBe("00ff80"); // clamp <0→00, >255→ff, round 127.6→128
  });
});

describe("colorAsHtml", () => {
  it("wraps the hex in the color attribute", () => {
    expect(colorAsHtml(255, 0, 0)).toBe('color="#ff0000"');
    expect(colorAsHtml(18, 52, 86)).toBe('color="#123456"');
  });
});

describe("formatColor", () => {
  it("dispatches on the mode", () => {
    expect(formatColor(255, 0, 0, "hex")).toBe("ff0000");
    expect(formatColor(255, 0, 0, "html")).toBe('color="#ff0000"');
  });
});
