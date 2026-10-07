// Type ▸ Glyphs inserts at the type cursor. `text.insertGlyph` used to do
// `setText(s, fullText(s) + ch)`, so a glyph picked with the caret in the middle
// of a word landed at the end of the layer. It now reads the on-canvas editor's
// selection (the same textarea the Character panel formats through) and splices
// there, replacing whatever is selected.
//
// The rasterizer is Canvas-2D-only, so it is stubbed the way
// typeStyleLinks.test.ts stubs it; the spec JSON the engine stores is the proof.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

vi.mock("../text/raster", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../text/raster")>()),
  rasterizeSpec: () => ({ w: 1, h: 1, placeX: 0, placeY: 0, data: new Uint8ClampedArray(4) }),
}));

import { engine, store, text, typeEditorSelection } from "./app";
import { defaultSpec, fullText, type TextSpec } from "../text/spec";

const specs = new Map<number, string>();

function installEngine(initial: string) {
  specs.clear();
  specs.set(1, JSON.stringify(defaultSpec(initial)));
  engine.engine = {
    layer_text_spec: (id: number) => specs.get(id) ?? "",
    set_text_layer_spec: (id: number, _x: number, _y: number, _w: number, _h: number, _b: Uint8Array, json: string) =>
      void specs.set(id, json),
  } as unknown as typeof engine.engine;
  vi.spyOn(engine, "commit").mockReturnValue(true);
  store.state.layers = [{ id: 1, name: "Type 1" }] as typeof store.state.layers;
  store.state.activeLayerId = 1;
}

/** Stand in for the on-canvas editor overlay: `null` = no editor open. */
function installEditor(selection: [number, number] | null) {
  (globalThis as Record<string, unknown>).document = {
    querySelector: (sel: string) =>
      selection && sel === "textarea.mv-text-edit"
        ? { selectionStart: selection[0], selectionEnd: selection[1] }
        : null,
  };
}

const activeSpec = () => JSON.parse(specs.get(1)!) as TextSpec;

describe("Type ▸ Glyphs inserts at the caret", () => {
  beforeEach(() => installEngine("Hello world"));
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    engine.engine = null;
    vi.restoreAllMocks();
  });

  it("splices the glyph at the editor's caret", () => {
    installEditor([5, 5]);
    text.insertGlyph("©");
    expect(fullText(activeSpec())).toBe("Hello© world");
  });

  it("replaces the editor's selection", () => {
    installEditor([6, 11]);
    text.insertGlyph("©");
    expect(fullText(activeSpec())).toBe("Hello ©");
  });

  it("appends when no on-canvas editor is open", () => {
    installEditor(null);
    text.insertGlyph("©");
    expect(fullText(activeSpec())).toBe("Hello world©");
  });

  it("carries a per-glyph OpenType alternate onto the inserted character only", () => {
    installEditor([5, 5]);
    text.insertGlyph("R", { swsh: true });
    const runs = activeSpec().runs;
    expect(fullText(activeSpec())).toBe("HelloR world");
    expect(runs.filter((r) => r.features).map((r) => r.text)).toEqual(["R"]);
  });

  it("reads the caret straight off the overlay textarea", () => {
    installEditor([2, 7]);
    expect(typeEditorSelection()).toEqual([2, 7]);
    installEditor(null);
    expect(typeEditorSelection()).toBeNull();
  });
});
