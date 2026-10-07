// Unit tests for the number-key opacity helpers. Engine-free (node); the keydown
// routing is covered by e2e/opacity-shortcuts.spec.ts.
import { describe, it, expect } from "vitest";
import { codeDigit, codeDigitPercent, digitOpacity, digitSequencePercent, isOpacityTool } from "./opacityShortcuts";

describe("digitOpacity", () => {
  it("maps 1-9 to 10-90 percent", () => {
    expect(digitOpacity("1")).toBe(10);
    expect(digitOpacity("5")).toBe(50);
    expect(digitOpacity("9")).toBe(90);
  });

  it("maps 0 to 100 percent", () => {
    expect(digitOpacity("0")).toBe(100);
  });

  it("returns null for non-digits and multi-character keys", () => {
    expect(digitOpacity("a")).toBeNull();
    expect(digitOpacity("10")).toBeNull();
    expect(digitOpacity("")).toBeNull();
    expect(digitOpacity("Enter")).toBeNull();
  });
});

describe("isOpacityTool", () => {
  it("is true for the brush-family (opacity-slider) tools", () => {
    for (const t of ["brush", "erase", "clone", "heal", "dodge", "burn", "smudge"]) {
      expect(isOpacityTool(t)).toBe(true);
    }
  });

  it("is false for non-paint tools", () => {
    for (const t of ["move", "marquee", "zoom", "hand", "crop", "pen"]) {
      expect(isOpacityTool(t)).toBe(false);
    }
  });
});

describe("codeDigitPercent", () => {
  it("maps physical number-key codes to percent (Digit1-9 → 10-90, Digit0 → 100)", () => {
    expect(codeDigitPercent("Digit5")).toBe(50);
    expect(codeDigitPercent("Digit9")).toBe(90);
    expect(codeDigitPercent("Digit0")).toBe(100);
  });

  it("returns null for non-digit codes", () => {
    expect(codeDigitPercent("KeyA")).toBeNull();
    expect(codeDigitPercent("Digit")).toBeNull();
    expect(codeDigitPercent("")).toBeNull();
    expect(codeDigitPercent("Numpad5")).toBeNull();
  });
});

describe("codeDigit", () => {
  it("reads the unshifted digit from a physical number key", () => {
    expect(codeDigit("Digit5")).toBe("5");
    expect(codeDigit("Digit0")).toBe("0");
    expect(codeDigit("Numpad5")).toBeNull();
    expect(codeDigit("KeyA")).toBeNull();
  });
});

describe("digitSequencePercent", () => {
  it("keeps the immediate one-digit mapping", () => {
    expect(digitSequencePercent(null, "4")).toBe(40);
    expect(digitSequencePercent(null, "0")).toBe(100);
  });

  it("maps two digits to an exact percentage", () => {
    expect(digitSequencePercent("4", "5")).toBe(45);
    expect(digitSequencePercent("0", "5")).toBe(5);
    expect(digitSequencePercent("0", "0")).toBe(0);
  });

  it("rejects an invalid next key and ignores an invalid first key", () => {
    expect(digitSequencePercent("4", "x")).toBeNull();
    expect(digitSequencePercent("x", "5")).toBe(50);
  });
});
