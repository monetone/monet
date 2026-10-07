// The `text` namespace's document-wide commands — Find and Replace Text, Text
// on Path / Bind to Work Path, Type on a Path Options, Replace All Missing
// Fonts, Update All Text Layers and Convert to Paragraph/Point Text — had no
// behavioural coverage: the only test that named them asserted they appear in
// RECORDED_TEXT_OPS, which is a spelling check. This drives them against a fake
// engine that stores each layer's spec JSON (exactly what the real one does with
// it) and asserts the spec each command leaves behind. Same stub harness as
// typeStyleLinks.test.ts — the rasterizer is Canvas-2D-only, so it is stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const ls = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => ls.get(k) ?? null,
      setItem: (k: string, v: string) => void ls.set(k, v),
      removeItem: (k: string) => void ls.delete(k),
      clear: () => ls.clear(),
    },
  });
});

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

vi.mock("../text/raster", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../text/raster")>()),
  rasterizeSpec: () => ({ w: 1, h: 1, placeX: 0, placeY: 0, data: new Uint8ClampedArray(4) }),
}));

import { engine, store, text } from "./app";
import { FONTS, defaultSpec, fullText } from "../text/spec";
import type { TextSpec } from "../text/spec";

const specs = new Map<number, string>();
const writes = new Map<number, number>();

/** `ids` become layers; only those in `typeIds` carry a type spec, so the rest
 *  are ordinary pixel layers as far as every command here is concerned. */
function install(ids: number[], active: number, typeSpecs: Record<number, TextSpec> = {}) {
  specs.clear();
  writes.clear();
  engine.engine = {
    layer_text_spec: (id: number) => specs.get(id) ?? "",
    set_text_layer_spec: (id: number, _x: number, _y: number, _w: number, _h: number, _b: Uint8Array, json: string) => {
      specs.set(id, json);
      writes.set(id, (writes.get(id) ?? 0) + 1);
    },
    text_edit_session: () => {},
  } as unknown as typeof engine.engine;
  vi.spyOn(engine, "commit").mockReturnValue(true);
  vi.spyOn(store, "addLayer").mockImplementation(() => {
    const id = Math.max(0, ...store.state.layers.map((l) => l.id)) + 1;
    store.state.layers = [...store.state.layers, { id, name: `Type ${id}` }] as typeof store.state.layers;
    store.state.activeLayerId = id;
  });
  vi.spyOn(store, "beginTextEdit").mockImplementation(() => {});
  store.state.layers = ids.map((id) => ({ id, name: `Layer ${id}` })) as typeof store.state.layers;
  store.state.activeLayerId = active;
  store.state.penPath = [];
  for (const [id, spec] of Object.entries(typeSpecs)) specs.set(Number(id), JSON.stringify(spec));
}
const specOf = (id: number) => JSON.parse(specs.get(id)!) as TextSpec;
const textOf = (id: number) => fullText(specOf(id));

describe("text.findReplace", () => {
  beforeEach(() => {
    install([1, 2, 3], 1, {
      1: defaultSpec("the cat sat on The mat"),
      2: defaultSpec("another cat"),
    });
  });

  it("replaces in the active layer only and returns the replacement count", () => {
    expect(text.findReplace("cat", "dog")).toBe(1);
    expect(textOf(1)).toBe("the dog sat on The mat");
    expect(textOf(2)).toBe("another cat");
  });

  it("is case-insensitive by default and case-sensitive on request", () => {
    expect(text.findReplace("the", "a")).toBe(2);
    expect(textOf(1)).toBe("a cat sat on a mat");

    install([1], 1, { 1: defaultSpec("the cat sat on The mat") });
    expect(text.findReplace("the", "a", { caseSensitive: true })).toBe(1);
    expect(textOf(1)).toBe("a cat sat on The mat");
  });

  it("spans every type layer with allLayers, skipping layers that are not type", () => {
    expect(text.findReplace("cat", "dog", { allLayers: true })).toBe(2);
    expect(textOf(1)).toBe("the dog sat on The mat");
    expect(textOf(2)).toBe("another dog");
    expect(specs.has(3)).toBe(false);
  });

  it("writes nothing when the needle is empty or absent", () => {
    expect(text.findReplace("", "dog")).toBe(0);
    expect(text.findReplace("zebra", "dog", { allLayers: true })).toBe(0);
    expect(writes.size).toBe(0);
  });

  it("matches the needle literally rather than as a regex", () => {
    install([1], 1, { 1: defaultSpec("a.c and abc") });
    expect(text.findReplace("a.c", "X")).toBe(1);
    expect(textOf(1)).toBe("X and abc");
  });
});

describe("text.bindToPath", () => {
  const PATH = [10, 20, 30, 40, 50, 20];

  beforeEach(() => {
    install([1, 2], 1, { 1: defaultSpec("Ride", { ax: 0, ay: 0, size: 24 }) });
    store.state.penPath = PATH.slice();
  });

  it("moves the active type layer onto the work path and consumes the path", () => {
    const before = specOf(1).runs;
    text.bindToPath();
    const after = specOf(1);
    expect(after.path).toEqual(PATH);
    expect([after.ax, after.ay]).toEqual([10, 20]);
    expect(after.runs).toEqual(before); // the text and its formatting ride along
    expect(store.state.penPath).toEqual([]); // the work path is consumed
  });

  it("keeps its own copy of the path, so later pen edits do not mutate the spec", () => {
    text.bindToPath();
    store.state.penPath = [0, 0, 1, 1];
    expect(specOf(1).path).toEqual(PATH);
  });

  it("is a no-op without a work path or on a layer that is not type", () => {
    store.state.penPath = [];
    text.bindToPath();
    expect(specOf(1).path).toBeUndefined();

    store.state.penPath = PATH.slice();
    store.state.activeLayerId = 2;
    text.bindToPath();
    expect(specs.has(2)).toBe(false);
    expect(store.state.penPath).toEqual(PATH); // not consumed either
  });
});

describe("text.setOnPathOptions", () => {
  beforeEach(() => {
    install([1], 1, { 1: defaultSpec("Ride", { path: [0, 0, 100, 0] }) });
  });

  it("patches the on-path options of type bound to a path", () => {
    text.setOnPathOptions({ pathStart: 0.25, pathFlip: true, pathAlign: "center" });
    const s = specOf(1);
    expect([s.pathStart, s.pathFlip, s.pathAlign]).toEqual([0.25, true, "center"]);
    expect(s.path).toEqual([0, 0, 100, 0]); // the binding itself is untouched
  });

  it("is a no-op on type that is not bound to a path", () => {
    install([1], 1, { 1: defaultSpec("Ride") });
    text.setOnPathOptions({ pathStart: 0.25 });
    expect(writes.size).toBe(0);
  });
});

describe("text.replaceMissingFonts", () => {
  const MISSING = "Nonexistent Foundry Display, serif";

  it("falls back only the families this build does not ship", () => {
    install([1], 1, {
      1: defaultSpec("", {
        font: MISSING,
        runs: [{ text: "a", font: FONTS[1] }, { text: "b", font: MISSING }, { text: "c" }],
      }),
    });
    text.replaceMissingFonts();
    const s = specOf(1);
    expect(s.font).toBe(FONTS[0]);
    expect(s.runs.map((r) => r.font)).toEqual([FONTS[1], FONTS[0], undefined]);
  });

  it("leaves a layer whose fonts all exist alone", () => {
    install([1, 2], 1, {
      1: defaultSpec("ok", { font: FONTS[2] }),
      2: defaultSpec("bad", { font: MISSING }),
    });
    text.replaceMissingFonts();
    expect(writes.get(1)).toBeUndefined(); // no needless re-render
    expect(writes.get(2)).toBe(1);
    expect(specOf(2).font).toBe(FONTS[0]);
  });
});

describe("text.updateAll", () => {
  it("re-renders every type layer and skips the rest", () => {
    install([1, 2, 3], 1, { 1: defaultSpec("one"), 3: defaultSpec("three") });
    text.updateAll();
    expect([writes.get(1), writes.get(2), writes.get(3)]).toEqual([1, undefined, 1]);
    expect(textOf(1)).toBe("one"); // re-rendered from the same spec, unchanged
  });
});

describe("text.toggleEastAsian", () => {
  it("persists East Asian Features on the active layer's spec and removes it again", () => {
    install([1, 2], 1, { 1: defaultSpec("日本語の文章。") });
    text.toggleEastAsian();
    expect(specOf(1).eastAsian).toBe(true);
    text.toggleEastAsian();
    expect("eastAsian" in specOf(1), "off deletes the key, so the spec reads like one saved before #455").toBe(false);
    expect(textOf(1)).toBe("日本語の文章。");
  });

  it("writes nothing when the active layer is not type", () => {
    install([1, 2], 2, { 1: defaultSpec("日本語") });
    text.toggleEastAsian();
    expect(writes.size).toBe(0);
  });
});

describe("text.toggleParagraph", () => {
  it("converts point type to a paragraph frame sized to the rendered text", () => {
    install([1], 1, { 1: defaultSpec("Hi", { kind: "point", boxW: 480, boxH: 77 }) });
    text.toggleParagraph();
    const s = specOf(1);
    expect(s.kind).toBe("paragraph");
    expect(s.boxW).toBe(32);  // max(32, stubbed raster width 1 + 8)
    expect(s.boxH).toBe(0);   // auto-height frame
  });

  it("converts a paragraph back to point type without disturbing the box", () => {
    install([1], 1, { 1: defaultSpec("Hi", { kind: "paragraph", boxW: 200, boxH: 90 }) });
    text.toggleParagraph();
    const s = specOf(1);
    expect(s.kind).toBe("point");
    expect([s.boxW, s.boxH]).toEqual([200, 90]);
  });
});
