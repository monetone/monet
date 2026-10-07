// vis-type-07: named character/paragraph styles are a *linked* style system, not
// a one-shot field copy. Applying a style links the layer, later edits read as
// overrides, and redefining a style re-renders every layer still linked to it.
// The rasterizer is Canvas-2D-only, so it is stubbed — what matters here is the
// spec JSON the engine ends up storing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
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
import { defaultSpec } from "../text/spec";
import type { TextSpec } from "../text/spec";

type LinkedSpec = TextSpec & { charStyle?: string; paraStyle?: string };

/** A fake engine that just remembers each layer's spec JSON, which is exactly
 *  what the real one does with it (opaque, round-tripped through the project). */
const specs = new Map<number, string>();
function install(ids: number[], active: number) {
  specs.clear();
  engine.engine = {
    layer_text_spec: (id: number) => specs.get(id) ?? "",
    set_text_layer_spec: (id: number, _x: number, _y: number, _w: number, _h: number, _b: Uint8Array, json: string) =>
      void specs.set(id, json),
  } as unknown as typeof engine.engine;
  vi.spyOn(engine, "commit").mockReturnValue(true);
  store.state.layers = ids.map((id) => ({ id, name: `Type ${id}` })) as typeof store.state.layers;
  store.state.activeLayerId = active;
  for (const id of ids) specs.set(id, JSON.stringify(defaultSpec("Hello", { size: 24, tracking: 0 })));
}
const specOf = (id: number) => JSON.parse(specs.get(id)!) as LinkedSpec;
const patch = (id: number, p: Partial<TextSpec>) => text.apply(id, { ...specOf(id), ...p });

afterEach(() => {
  engine.onEditError = null;
  vi.restoreAllMocks();
});

describe("linked character styles", () => {
  beforeEach(() => {
    localStorage.clear();
    install([1, 2], 1);
  });

  it("links the layer it was captured from and the layers it is applied to", () => {
    text.addTypeStyle("char", "Headline");
    expect(specOf(1).charStyle).toBe("Headline");

    store.state.activeLayerId = 2;
    text.applyTypeStyle("char", "Headline");
    expect(specOf(2).charStyle).toBe("Headline");
    // The link travels in the layer's own spec JSON, so it survives a save.
    expect(specs.get(2)).toContain('"charStyle":"Headline"');
  });

  it("reports drifted fields as overrides and clears them on demand", () => {
    text.addTypeStyle("char", "Headline");
    expect(text.typeStyleLink("char")).toEqual({ name: "Headline", overrides: [] });

    patch(1, { size: 48 });
    expect(text.typeStyleLink("char")?.overrides).toEqual(["size"]);

    text.clearTypeStyleOverride("char");
    expect(specOf(1).size).toBe(24);
    expect(text.typeStyleLink("char")?.overrides).toEqual([]);
    expect(specOf(1).charStyle).toBe("Headline"); // still linked after the reset
  });

  it("redefining a style re-renders every layer linked to it", () => {
    text.addTypeStyle("char", "Headline");
    store.state.activeLayerId = 2;
    text.applyTypeStyle("char", "Headline");

    patch(2, { size: 48 });
    text.redefineTypeStyle("char", "Headline");

    expect(text.typeStyles("char")[0].fields.size).toBe(48);
    expect(specOf(1).size).toBe(48); // the *other* linked layer followed
    expect(text.typeStyleLink("char", 1)?.overrides).toEqual([]);
  });

  it("carries the paragraph composition settings, not just indents", () => {
    // A Paragraph Style captured Hyphenate / Hyphenation / Justification /
    // Line Break / Roman Hanging Punctuation as part of its definition in
    // Photoshop; here those fields were left out of paraStyleFields, so saving
    // a style silently dropped them and applying it restored only alignment
    // and indents.
    patch(1, {
      leftIndent: 12,
      hyphenate: true,
      hyphenation: { zone: 40 },
      justification: { wordMax: 150 },
      lineComposer: "everyline",
      hangingPunctuation: true,
    });
    text.addTypeStyle("para", "Body");

    store.state.activeLayerId = 2;
    text.applyTypeStyle("para", "Body");
    const applied = specOf(2);
    expect(applied.leftIndent, "the indents came across before, and still do").toBe(12);
    expect(applied.hyphenate).toBe(true);
    expect(applied.hyphenation).toEqual({ zone: 40 });
    expect(applied.justification).toEqual({ wordMax: 150 });
    expect(applied.lineComposer).toBe("everyline");
    expect(applied.hangingPunctuation).toBe(true);
  });

  it("leaves unlinked layers alone when a style is redefined", () => {
    text.addTypeStyle("char", "Headline");
    patch(1, { size: 48 });
    text.redefineTypeStyle("char", "Headline");
    expect(specOf(2).size).toBe(24);
    expect(text.typeStyleLink("char", 2)).toBeNull();
  });

  it("unlinks layers when the style is deleted, without restyling them", () => {
    text.addTypeStyle("char", "Headline");
    patch(1, { size: 48 });
    text.deleteTypeStyle("char", "Headline");
    expect(specOf(1).charStyle).toBeUndefined();
    expect(specOf(1).size).toBe(48);
    expect(text.typeStyleLink("char", 1)).toBeNull();
  });

  it("keeps character and paragraph links independent", () => {
    text.addTypeStyle("char", "Headline");
    text.addTypeStyle("para", "Body");
    expect(specOf(1)).toMatchObject({ charStyle: "Headline", paraStyle: "Body" });

    patch(1, { align: "center" });
    expect(text.typeStyleLink("para")?.overrides).toEqual(["align"]);
    expect(text.typeStyleLink("char")?.overrides).toEqual([]);
  });

  it("surfaces rejected default and named style writes", () => {
    const onEditError = vi.fn();
    engine.onEditError = onEditError;
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });

    text.saveDefaultStyles();
    text.addTypeStyle("char", "Headline");

    expect(onEditError.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("default type styles"),
      expect.stringContaining("named type styles"),
    ]);
  });
});
