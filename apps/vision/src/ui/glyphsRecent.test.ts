import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  RECENT_GLYPHS_MAX, loadRecentGlyphs, pushRecentGlyph, saveRecentGlyphs,
} from "./glyphsRecent";

// Type ▸ Glyphs "Recently Used". The ordering rule is the whole feature: a
// re-inserted glyph jumps to the front instead of appearing twice, and the row
// never grows past one line. Persistence has to survive a missing/garbage
// localStorage — the node test env has none until we install one below.

describe("pushRecentGlyph", () => {
  it("puts the newest glyph first", () => {
    expect(pushRecentGlyph(["©"], "®")).toEqual(["®", "©"]);
  });

  it("promotes a repeat instead of duplicating it", () => {
    expect(pushRecentGlyph(["®", "©", "™"], "™")).toEqual(["™", "®", "©"]);
  });

  it("caps the row and drops the oldest", () => {
    let list: string[] = [];
    for (let i = 0; i < RECENT_GLYPHS_MAX + 3; i++) list = pushRecentGlyph(list, String.fromCodePoint(0x41 + i));
    expect(list).toHaveLength(RECENT_GLYPHS_MAX);
    expect(list[0]).toBe(String.fromCodePoint(0x41 + RECENT_GLYPHS_MAX + 2));
    expect(list).not.toContain("A"); // the oldest fell off the end
  });

  it("leaves the list alone for an empty insert and never mutates the input", () => {
    const list = ["©"];
    expect(pushRecentGlyph(list, "")).toEqual(["©"]);
    pushRecentGlyph(list, "®");
    expect(list).toEqual(["©"]);
  });

  it("keeps a multi-code-unit glyph whole", () => {
    expect(pushRecentGlyph([], "𝒜")).toEqual(["𝒜"]);
  });
});

describe("recent-glyph persistence", () => {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };

  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = stub;
  });
  afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

  it("round-trips the row", () => {
    saveRecentGlyphs(["®", "©"]);
    expect(loadRecentGlyphs()).toEqual(["®", "©"]);
  });

  it("reads nothing when the panel has never been used", () => {
    expect(loadRecentGlyphs()).toEqual([]);
  });

  it("survives garbage in storage", () => {
    store.set("mv.recentGlyphs", "{not json");
    expect(loadRecentGlyphs()).toEqual([]);
    store.set("mv.recentGlyphs", '{"a":1}');
    expect(loadRecentGlyphs()).toEqual([]);
    store.set("mv.recentGlyphs", '["©",7,"",null,"®"]');
    expect(loadRecentGlyphs()).toEqual(["©", "®"]);
  });

  it("trims an oversized persisted row back to one line", () => {
    saveRecentGlyphs(Array.from({ length: 40 }, (_, i) => String.fromCodePoint(0x41 + i)));
    expect(loadRecentGlyphs()).toHaveLength(RECENT_GLYPHS_MAX);
  });

  it("is a no-op rather than a throw with no storage at all", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => saveRecentGlyphs(["©"])).not.toThrow();
    expect(loadRecentGlyphs()).toEqual([]);
  });
});
