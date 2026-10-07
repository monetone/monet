// Second half of the caret-aware Glyphs insert: after splicing at the caret the
// on-canvas editor's selection still sat on the OLD offsets, so picking two
// glyphs in a row produced "®©" — the second landed in front of the first.
// `text.insertGlyph` now collapses the editor caret after what it inserted.
//
// The rasterizer is Canvas-2D-only, so it is stubbed the way
// glyphCaretInsert.test.ts stubs it; the spec JSON the engine stores plus the
// textarea's selection are the proof.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

vi.mock("../text/raster", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../text/raster")>()),
  rasterizeSpec: () => ({ w: 1, h: 1, placeX: 0, placeY: 0, data: new Uint8ClampedArray(4) }),
}));

import { engine, store, text } from "./app";
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

/** The on-canvas editor overlay, with a caret that actually moves — a real
 *  textarea keeps whatever `setSelectionRange` last wrote. */
function installEditor(start: number, end = start) {
  const el = {
    selectionStart: start,
    selectionEnd: end,
    setSelectionRange(a: number, b: number) { el.selectionStart = a; el.selectionEnd = b; },
  };
  (globalThis as Record<string, unknown>).document = {
    querySelector: (sel: string) => (sel === "textarea.mv-text-edit" ? el : null),
  };
  return el;
}

const activeSpec = () => JSON.parse(specs.get(1)!) as TextSpec;

describe("Type ▸ Glyphs leaves the caret after the inserted glyph", () => {
  beforeEach(() => installEngine("Hello world"));
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    engine.engine = null;
    vi.restoreAllMocks();
  });

  it("advances the editor caret past the character it inserted", () => {
    const el = installEditor(5);
    text.insertGlyph("©");
    expect([el.selectionStart, el.selectionEnd]).toEqual([6, 6]);
  });

  it("keeps two glyphs picked in a row in the order they were picked", () => {
    installEditor(5);
    text.insertGlyph("©");
    text.insertGlyph("®");
    expect(fullText(activeSpec())).toBe("Hello©® world");
  });

  it("collapses a replaced selection to the end of the insert", () => {
    const el = installEditor(6, 11); // "world" selected
    text.insertGlyph("©");
    expect(fullText(activeSpec())).toBe("Hello ©");
    expect([el.selectionStart, el.selectionEnd]).toEqual([7, 7]);
  });

  it("clamps an out-of-range editor selection like the splice does", () => {
    const el = installEditor(40, 90);
    text.insertGlyph("©");
    expect(fullText(activeSpec())).toBe("Hello world©");
    expect([el.selectionStart, el.selectionEnd]).toEqual([12, 12]);
  });

  it("does not touch the caret when no editor is open", () => {
    (globalThis as Record<string, unknown>).document = { querySelector: () => null };
    expect(() => text.insertGlyph("©")).not.toThrow();
    expect(fullText(activeSpec())).toBe("Hello world©");
  });
});
