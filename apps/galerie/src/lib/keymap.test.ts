import { describe, expect, it } from "vitest";

import { autoAdvances, cullKeyOf, resolveShortcut } from "./keymap";

describe("resolveShortcut", () => {
  it("maps 0–5 to ratings", () => {
    expect(resolveShortcut("0")).toEqual({ kind: "rate", value: 0 });
    expect(resolveShortcut("5")).toEqual({ kind: "rate", value: 5 });
    expect(resolveShortcut("3")).toEqual({ kind: "rate", value: 3 });
  });

  it("maps 6–9 to color labels", () => {
    expect(resolveShortcut("6")).toEqual({ kind: "label", value: "red" });
    expect(resolveShortcut("9")).toEqual({ kind: "label", value: "blue" });
  });

  it("maps flag keys (case-insensitive)", () => {
    expect(resolveShortcut("p")).toEqual({ kind: "flag", value: 1 });
    expect(resolveShortcut("X")).toEqual({ kind: "flag", value: -1 });
    expect(resolveShortcut("u")).toEqual({ kind: "flag", value: 0 });
  });

  it("maps arrows to navigation", () => {
    expect(resolveShortcut("ArrowRight")).toEqual({ kind: "nav", delta: 1 });
    expect(resolveShortcut("ArrowLeft")).toEqual({ kind: "nav", delta: -1 });
  });

  it("maps G/E/C/N to module switches", () => {
    expect(resolveShortcut("g")).toEqual({ kind: "module", value: "grid" });
    expect(resolveShortcut("e")).toEqual({ kind: "module", value: "loupe" });
    expect(resolveShortcut("c")).toEqual({ kind: "module", value: "compare" });
    expect(resolveShortcut("N")).toEqual({ kind: "module", value: "survey" });
  });

  it("returns null for unhandled keys", () => {
    expect(resolveShortcut("q")).toBeNull();
    expect(resolveShortcut("F5")).toBeNull();
    expect(resolveShortcut("")).toBeNull();
  });
});

describe("resolveShortcut — grid/loupe navigation keys", () => {
  it("maps ↑/↓ to row navigation and Home/End to jumps", () => {
    expect(resolveShortcut("ArrowDown")).toEqual({ kind: "navRow", delta: 1 });
    expect(resolveShortcut("ArrowUp")).toEqual({ kind: "navRow", delta: -1 });
    expect(resolveShortcut("Home")).toEqual({ kind: "navEnd", dir: -1 });
    expect(resolveShortcut("End")).toEqual({ kind: "navEnd", dir: 1 });
  });

  it("maps Space/Enter/Z to Loupe and D to Develop", () => {
    expect(resolveShortcut(" ")).toEqual({ kind: "loupe" });
    expect(resolveShortcut("Enter")).toEqual({ kind: "loupe" });
    expect(resolveShortcut("z")).toEqual({ kind: "loupe" });
    expect(resolveShortcut("d")).toEqual({ kind: "module", value: "develop" });
  });
});

describe("cullKeyOf", () => {
  it("recovers the digit from Shift+number chords (Shift+7 types '&')", () => {
    expect(cullKeyOf({ key: "&", code: "Digit7", shiftKey: true })).toBe("7");
    expect(cullKeyOf({ key: ")", code: "Digit0", shiftKey: true })).toBe("0");
  });

  it("passes ordinary keys through", () => {
    expect(cullKeyOf({ key: "p", code: "KeyP", shiftKey: false })).toBe("p");
    expect(cullKeyOf({ key: "7", code: "Digit7" })).toBe("7");
  });
});

describe("autoAdvances", () => {
  it("advances on Shift or Caps Lock, not otherwise", () => {
    expect(autoAdvances({ shiftKey: true })).toBe(true);
    expect(autoAdvances({ getModifierState: (k) => k === "CapsLock" })).toBe(true);
    expect(autoAdvances({ shiftKey: false, getModifierState: () => false })).toBe(false);
    expect(autoAdvances({})).toBe(false);
  });
});

describe("resolveShortcut — grid style", () => {
  it("maps J to the grid-style cycle", () => {
    expect(resolveShortcut("j")).toEqual({ kind: "gridStyle" });
    expect(resolveShortcut("J")).toEqual({ kind: "gridStyle" });
  });
});
