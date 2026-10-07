// Guards #442: Image ▸ Mode ▸ Indexed Color and Bitmap grew Photoshop's real
// options. The pixel half is covered in packages/engine; this pins the store
// seam the two dialogs drive — the palette/forced/matte argument order, the
// #rrggbb → packed-RGB conversion, and Bitmap's Output resolution, which IS the
// converted document's resolution: the engine resamples and restamps inside its
// Bitmap step, and the store (the ppi's authority on every resync) follows the
// engine's copy through that step and through Undo/Redo across it.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

// A stand-in engine that does what the real convert_bitmap does to the
// document's geometry: an Output resolution other than its own resamples by
// output ÷ input and restamps the ppi, and undo() puts both back.
function storeWith() {
  const calls: [string, ...unknown[]][] = [];
  let doc = { w: 100, h: 50, ppi: 72 };
  const history: typeof doc[] = [];
  const eng: Record<string, unknown> = {
    width: () => doc.w,
    height: () => doc.h,
    resolution_ppi: () => doc.ppi,
    convert_indexed: (...a: unknown[]) => calls.push(["indexed", ...a]),
    convert_bitmap: (...a: unknown[]) => {
      calls.push(["bitmap", ...a]);
      const out = a[4] as number;
      history.push(doc);
      if (out > 0 && out !== doc.ppi) doc = { w: Math.round(doc.w * out / doc.ppi), h: Math.round(doc.h * out / doc.ppi), ppi: out };
    },
    undo: () => { doc = history.pop() ?? doc; },
    set_resolution_ppi: (ppi: number) => calls.push(["ppi", ppi]),
    set_guides: () => {},
  };
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null };
  // A new document's ppi is the store default, 72 — the stand-in's too.
  return { store: new Store(client as never), calls, client, eng };
}

describe("Indexed Color options (#442)", () => {
  it("defaults to Adaptive, no forced entries and kept transparency", () => {
    const { store, calls } = storeWith();
    store.convertIndexed(128, true);
    const [, colors, dither, palette, forced, transparency, matte, custom] = calls[0];
    expect([colors, dither, palette, forced, transparency]).toEqual([128, true, 6, 0, true]);
    expect(Array.from(matte as Uint8Array)).toEqual([255, 255, 255]);
    expect(Array.from(custom as Uint8Array)).toEqual([]);
  });

  it("packs the matte and the custom table as RGB bytes, in menu order", () => {
    const { store, calls } = storeWith();
    store.convertIndexed(2, false, 7, 2, false, "#ff8000", ["#000000", "#0000ff"]);
    const [, , , palette, forced, transparency, matte, custom] = calls[0];
    expect([palette, forced, transparency]).toEqual([7, 2, false]);
    expect(Array.from(matte as Uint8Array)).toEqual([255, 128, 0]);
    expect(Array.from(custom as Uint8Array)).toEqual([0, 0, 0, 0, 0, 255]);
  });

  it("carries Color Table's own palette so an edited entry recolours its pixels", () => {
    const { store, calls } = storeWith();
    // Apply: the grid showed red + dark red, and the user made entry 0 green.
    store.convertIndexed(2, false, 7, 0, true, "#ffffff", ["#00ff00", "#800000"], ["#ff0000", "#800000"]);
    const [, , , , , , , custom, previous] = calls[0];
    expect(Array.from(custom as Uint8Array)).toEqual([0, 255, 0, 128, 0, 0]);
    // Without this pairing the engine re-quantizes and the edit is discarded.
    expect(Array.from(previous as Uint8Array)).toEqual([255, 0, 0, 128, 0, 0]);
  });

  it("leaves Indexed Color quantizing: no pairing unless Color Table supplies one", () => {
    const { store, calls } = storeWith();
    store.convertIndexed(2, false, 7, 0, true, "#ffffff", ["#000000", "#0000ff"]);
    expect(Array.from(calls[0][8] as Uint8Array)).toEqual([]);
  });

  it("never hands the engine more than the 256 entries a table can hold", () => {
    const { store, calls } = storeWith();
    store.convertIndexed(256, false, 7, 0, true, "#ffffff", new Array(300).fill("#123456"));
    expect((calls[0][7] as Uint8Array).length).toBe(256 * 3);
  });
});

describe("Bitmap options (#442)", () => {
  it("converts in place with no screen by default", () => {
    const { store, calls } = storeWith();
    expect(store.convertBitmap(1)).toBe(true);
    expect(calls).toEqual([["bitmap", 1, 0, 45, 0, 0]]);
    expect(store.state.resolutionPpi).toBe(72);
  });

  it("passes the halftone screen through, measured against the Output resolution", () => {
    const { store, calls } = storeWith();
    store.convertBitmap(3, 85, 22.5, 3, 300);
    // The engine measures lpi against the restamped ppi, so the store no longer
    // rescales the frequency itself.
    expect(calls.filter(([name]) => name === "bitmap")).toEqual([["bitmap", 3, 85, 22.5, 3, 300]]);
  });

  it("makes the Output resolution the document's, and Undo takes it back", () => {
    const { store } = storeWith();
    store.convertBitmap(1, 0, 45, 0, 144);
    expect(store.state.resolutionPpi, "every method restamps, not only the halftone").toBe(144);
    store.undo();
    expect(store.state.resolutionPpi, "the ppi rides in the Bitmap step").toBe(72);
  });

  it("scales the doc-space annotations and refits when the image was resampled", () => {
    const { store } = storeWith();
    const remap = vi.spyOn(store, "remapDocSpaceAnnotations").mockImplementation(() => {});
    const fit = vi.spyOn(store, "requestFit");
    store.convertBitmap(0, 0, 45, 0, 144);
    expect(remap).toHaveBeenCalledWith(2, 2, 0, 0);
    expect(fit).toHaveBeenCalled();
  });

  it("normalizes a hostile Output resolution instead of passing it on", () => {
    const { store, calls } = storeWith();
    store.convertBitmap(3, 53, 45, 0, Number.NaN);
    expect(calls[0][5], "NaN is not an output resolution: convert in place").toBe(0);
    store.convertBitmap(3, 53, 45, 0, 1e9);
    expect(calls[1][5]).toBe(100_000);
  });

  it("reports a refusal, leaving the ppi alone", () => {
    const { store, client, eng } = storeWith();
    eng.convert_bitmap = () => {}; // the engine refused (and reported why) …
    client.commit.mockReturnValueOnce(false); // … which commit surfaces
    expect(store.convertBitmap(1, 0, 45, 0, 72 * 40)).toBe(false);
    expect(store.state.resolutionPpi).toBe(72);
  });
});
