// Unit tests for the screen-mode cycle helper. Engine-free (node); the F-key
// wiring + chrome CSS are covered by e2e/screen-mode.spec.ts.
import { describe, it, expect } from "vitest";
import { nextScreenMode, SCREEN_MODES, type ScreenMode } from "./screenMode";

describe("SCREEN_MODES", () => {
  it("is the Photoshop order", () => {
    expect(SCREEN_MODES).toEqual(["standard", "fullMenu", "full"]);
  });
});

describe("nextScreenMode", () => {
  it("cycles forward and wraps", () => {
    expect(nextScreenMode("standard")).toBe("fullMenu");
    expect(nextScreenMode("fullMenu")).toBe("full");
    expect(nextScreenMode("full")).toBe("standard");
  });

  it("cycles backward and wraps when reverse", () => {
    expect(nextScreenMode("standard", true)).toBe("full");
    expect(nextScreenMode("full", true)).toBe("fullMenu");
    expect(nextScreenMode("fullMenu", true)).toBe("standard");
  });

  it("treats an unknown current as standard (index 0)", () => {
    expect(nextScreenMode("bogus" as ScreenMode)).toBe("fullMenu");
    expect(nextScreenMode("bogus" as ScreenMode, true)).toBe("full");
  });
});
