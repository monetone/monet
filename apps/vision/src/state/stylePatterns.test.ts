// Guards #420: a Layer Style pattern pick used to mean "whatever tile is in the
// engine's one global slot", so two layers could never use different patterns.
// A pick is now a library tile's ID, and the library is pushed to the engine
// alongside it. The engine half is covered in packages/engine.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { PATTERNS, PATTERN_LIBRARY_BASE, isLibraryPattern, patternLibraryId } from "./effects";
import {
  MAX_STYLE_PATTERN_TEXELS, fitsStylePattern, flattenStylePatterns, type PatternPreset,
} from "./patternPresets";
import { Store } from "./store";

const tile = (name: string, w = 1, h = 1): PatternPreset =>
  ({ name, w, h, px: new Uint16Array(w * h * 4).fill(65535) });

describe("pattern ids (#420)", () => {
  it("keeps the procedural kinds below the library base", () => {
    expect(PATTERNS.length).toBeLessThanOrEqual(PATTERN_LIBRARY_BASE);
    for (let kind = 0; kind < PATTERNS.length; kind++) expect(isLibraryPattern(kind)).toBe(false);
    expect(isLibraryPattern(patternLibraryId("Bricks"))).toBe(true);
  });

  it("names a tile by its NAME, so reordering or deleting the library cannot repoint a style", () => {
    const id = patternLibraryId("Bricks");
    expect(patternLibraryId("Bricks")).toBe(id);
    expect(patternLibraryId("Weave")).not.toBe(id);
    // …and stays exactly representable as the f32 an effect slot holds.
    expect(Math.fround(id)).toBe(id);
    expect(Number.isInteger(id)).toBe(true);
  });
});

describe("flattening the library for the engine (#420)", () => {
  it("packs every tile back to back with its size and id", () => {
    const lib = [tile("A"), tile("B", 2, 1)];
    const { flat, widths, heights, ids } = flattenStylePatterns(lib, patternLibraryId);
    expect(Array.from(widths)).toEqual([1, 2]);
    expect(Array.from(heights)).toEqual([1, 1]);
    expect(Array.from(ids)).toEqual([patternLibraryId("A"), patternLibraryId("B")]);
    expect(flat.length).toBe(4 + 8); // the engine asserts exactly this sum
  });

  it("keeps a slot for a tile it will not push, so the ids after it stay addressable", () => {
    const huge = tile("Huge", MAX_STYLE_PATTERN_TEXELS, 2);
    // The oversized tile never allocates its pixels here — only its dimensions matter.
    huge.px = new Uint16Array(0);
    const { flat, widths, heights, ids } = flattenStylePatterns([huge, tile("Small")], patternLibraryId);
    expect(fitsStylePattern(huge)).toBe(false);
    expect(Array.from(widths)).toEqual([0, 1]);
    expect(Array.from(heights)).toEqual([0, 1]);
    expect(ids[1]).toBe(patternLibraryId("Small"));
    expect(flat.length).toBe(4); // only the small tile's pixels
  });

  it("refuses a tile whose pixel buffer is shorter than its declared size", () => {
    const lying = { name: "Lying", w: 4, h: 4, px: new Uint16Array(8) };
    const { flat, widths } = flattenStylePatterns([lying], patternLibraryId);
    expect(Array.from(widths)).toEqual([0]);
    expect(flat.length).toBe(0);
  });
});

describe("the store pushes the library (#420)", () => {
  function storeWith({ hasExport = true } = {}) {
    const calls: [string, ...unknown[]][] = [];
    const eng: Record<string, unknown> = {
      set_pattern: () => {},
      has_pattern: () => true,
    };
    if (hasExport) {
      eng.set_style_patterns = (f: Uint16Array, w: Uint32Array, h: Uint32Array, i: Int32Array) =>
        calls.push(["push", f.length, Array.from(w), Array.from(h), Array.from(i)]);
    }
    const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), blit: vi.fn(), onCommit: null };
    return { store: new Store(client as never), calls };
  }

  it("pushes every tile with the ids styles name them by", () => {
    const { store, calls } = storeWith();
    store.importPatternPresets([tile("A"), tile("B")]);
    expect(calls.at(-1)).toEqual(["push", 8, [1, 1], [1, 1], [patternLibraryId("A"), patternLibraryId("B")]]);
  });

  it("re-pushes when the library changes, so a deleted tile stops rendering", () => {
    const { store, calls } = storeWith();
    store.importPatternPresets([tile("A"), tile("B")]);
    const before = calls.length;
    store.removePatternPreset(0);
    expect(calls.length).toBeGreaterThan(before);
    expect(calls.at(-1)).toEqual(["push", 4, [1], [1], [patternLibraryId("B")]]);
  });

  it("degrades quietly on a wasm build without the export", () => {
    const { store, calls } = storeWith({ hasExport: false });
    expect(() => store.importPatternPresets([tile("A")])).not.toThrow();
    expect(calls).toEqual([]);
  });
});
