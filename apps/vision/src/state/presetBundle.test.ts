// V-PRESET-2 — Edit ▸ Presets ▸ Export/Import Presets and Migrate Presets: the
// all-libraries `.mvpresets` bundle and the by-extension routing that lets a
// pile of Adobe preset files land in the right library. Engine-free (node); the
// pickers themselves are Tauri/DOM and stay out of this.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { buildPresetBundle, importAnyPresetBytes, parsePresetBundle, presetCategoryForFile, store } from "./app";
import { buildPresetSet } from "./presetManager";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("preset bundles", () => {
  it("round-trips every library through one file, skipping the empty ones", () => {
    const text = buildPresetBundle({
      swatches: ["#112233"],
      brushes: [{ name: "Chalk", brush: { size: 9 } }],
      tools: [],
    });
    expect(parsePresetBundle(text)).toEqual({
      swatches: ["#112233"],
      brushes: [{ name: "Chalk", brush: { size: 9 } }],
    });
  });

  it("refuses anything that is not a bundle — including a single-category set", () => {
    expect(() => parsePresetBundle(buildPresetSet("brushes", []))).toThrow(/Not a Monet preset bundle/);
    expect(() => parsePresetBundle("not json")).toThrow(/Not a Monet preset bundle/);
    expect(() => parsePresetBundle(JSON.stringify({ format: "mvpresets-all", version: 1, sets: {} })))
      .toThrow(/no presets/);
  });
});

describe("preset file routing", () => {
  it("maps each Adobe extension to its library, case-insensitively", () => {
    expect(presetCategoryForFile("Pantone.ACO")).toBe("swatches");
    expect(presetCategoryForFile("/a/b/Dry Media.abr")).toBe("brushes");
    expect(presetCategoryForFile("Metals.grd")).toBe("gradients");
    expect(presetCategoryForFile("Web Styles.asl")).toBe("styles");
    expect(presetCategoryForFile("Adobe.ase")).toBe("swatches");
  });

  it("has no library for the formats Vision cannot read", () => {
    expect(presetCategoryForFile("Shapes.csh")).toBeNull();
    expect(presetCategoryForFile("Tools.tpl")).toBeNull();
    expect(presetCategoryForFile("notes.txt")).toBeNull();
  });

  it("names the reason instead of swallowing an unreadable file", () => {
    expect(() => importAnyPresetBytes("Shapes.csh", new Uint8Array([1, 2, 3])))
      .toThrow(/No Vision reader/);
    expect(() => importAnyPresetBytes("junk.mvpresets", utf8('{"format":"nope"}')))
      .toThrow(/Not a Monet preset file/);
  });

  it("imports a bundle into every library it names", () => {
    const before = store.state.swatches.length;
    const n = importAnyPresetBytes("presets.mvpresets", utf8(buildPresetBundle({
      swatches: ["#0a0b0c", "#0d0e0f"],
      gradients: [{ name: "Bundle Ramp", stops: [{ pos: 0, r: 0, g: 0, b: 0, a: 255 }, { pos: 1, r: 255, g: 255, b: 255, a: 255 }] }],
    })));
    expect(n).toBe(3);
    expect(store.state.swatches.slice(before)).toEqual(["#0a0b0c", "#0d0e0f"]);
    expect(store.state.gradientPresets.some((g) => g.name === "Bundle Ramp")).toBe(true);
  });

  it("keeps the good libraries when one in the bundle is corrupt", () => {
    const bad = JSON.stringify({
      format: "mvpresets-all",
      version: 1,
      sets: { swatches: ["#a1b2c3"], brushes: [{ nope: true }] },
    });
    expect(importAnyPresetBytes("mixed.mvpresets", utf8(bad))).toBe(1);
    expect(store.state.swatches).toContain("#a1b2c3");
  });

  it("still accepts a single-category set file", () => {
    const set = buildPresetSet("swatches", ["#c0ffee"]);
    expect(importAnyPresetBytes("swatches.mvpresets", utf8(set))).toBe(1);
    expect(store.state.swatches).toContain("#c0ffee");
  });
});
