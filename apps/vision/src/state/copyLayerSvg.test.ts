// Layer ▸ Copy SVG must be *vector* on a shape layer — real <path> geometry from
// the engine — and only fall back to embedded pixels when the layer has none
// (vis-vec-07). The geometry itself is covered by the engine's
// `vector_scene_svg_tests`; here we check which of the two paths the app takes.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { copyLayerSVG, engine, store } from "./app";

const SHAPE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3">\n  <path d="M0,0 C1,1 2,2 3,3 Z" />\n</svg>\n';

/** Install a fake engine whose `export_layer_svg` answers only for `vectorId`,
 *  plus a clipboard spy, and return what Copy SVG wrote. */
function copy(activeLayerId: number, vectorId: number): { text: string; asked: unknown[][] } {
  const writeText = vi.fn<(...args: unknown[]) => void>();
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText } }, configurable: true });
  const exportLayerSvg = vi.fn<(...args: unknown[]) => string>((id) => (id === vectorId ? SHAPE_SVG : ""));
  engine.engine = {
    width: () => 4,
    height: () => 3,
    export_layer_svg: exportLayerSvg,
    export_png: () => new Uint8Array([1, 2, 3]),
  } as unknown as typeof engine.engine;
  store.state.activeLayerId = activeLayerId;
  copyLayerSVG();
  return { text: String(writeText.mock.calls[0][0]), asked: exportLayerSvg.mock.calls };
}

describe("copyLayerSVG", () => {
  it("copies a shape layer as editable path geometry, not a rasterized wrapper", () => {
    const { text, asked } = copy(7, 7);
    expect(asked[0][0]).toBe(7); // the *active* layer, not the document
    expect(text).toContain('<path d="M0,0 C1,1 2,2 3,3 Z"');
    expect(text).not.toContain("<image");
    expect(text).not.toContain("base64");
  });

  it("falls back to the embedded composite for a layer with no vector art", () => {
    const { text } = copy(2, 7);
    expect(text).toContain('href="data:image/png;base64,AQID"');
    expect(text).toContain('viewBox="0 0 4 3"');
    expect(text).not.toContain("<path");
  });
});
