// Guards #412: the Color Range options the dialog had no route for — tonal
// bands, Out of Gamut, Localized Color Clusters, and the Selection Preview
// renderings. The engine predicates are covered in packages/engine; these
// assert the store picks the right route and that the preview the document
// paints matches what OK will select.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, tonalPreviewMask } from "./store";
import { selectionPreviewPixel } from "./selectionPreview";

type Call = [string, ...unknown[]];

function storeWith(gamut = new Uint8Array([255, 0, 0, 255])) {
  const calls: Call[] = [];
  const eng = {
    select_color_range_batch: (...a: unknown[]) => calls.push(["batch", ...a]),
    select_color_range_localized: (s: Uint8Array, p: Float32Array, f: number, r: number, m: number) =>
      calls.push(["localized", Array.from(s), Array.from(p), f, r, m]),
    select_tonal_range: (k: number, r: number, m: number, inv: boolean) => calls.push(["tonal", k, r, m, inv]),
    apply_selection_mask: (mask: Uint8Array, mode: number) => calls.push(["apply", Array.from(mask), mode]),
  };
  const client = {
    engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null,
    outOfGamutMask: () => gamut.slice(),
  };
  return { store: new Store(client as never), calls };
}

describe("Color Range tonal bands (#412)", () => {
  it("routes Highlights/Midtones/Shadows to the luminance predicate, not a colour cluster", () => {
    const { store, calls } = storeWith();
    store.tonalRangeSelect(2, 0.75, { mode: 1, invert: true });
    expect(calls).toEqual([["tonal", 2, 0.75, 1, true]]);
  });

  it("clamps the band and the kind to what the engine accepts", () => {
    const { store, calls } = storeWith();
    store.tonalRangeSelect(9, 4, {});
    expect(calls[0]).toEqual(["tonal", 2, 1, 0, false]);
  });

  it("previews the same band the engine will select", () => {
    // black, mid, white
    const pixels = new Uint8Array([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    const shadows = tonalPreviewMask(pixels, 0, 0.75);
    expect(shadows[0]).toBeGreaterThan(shadows[1]);
    expect(shadows[2]).toBe(0);
    const mid = tonalPreviewMask(pixels, 1, 0.5);
    expect(mid[1]).toBeGreaterThan(mid[0]);
    expect(tonalPreviewMask(pixels, 2, 0.75, true)[0]).toBeGreaterThan(0); // invert
  });
});

describe("Color Range Out of Gamut (#412)", () => {
  it("selects the proof's out-of-gamut flags through the shared apply path", () => {
    const { store, calls } = storeWith(new Uint8Array([255, 0, 0, 255]));
    store.outOfGamutSelect({ mode: 2 });
    expect(calls).toEqual([["apply", [255, 0, 0, 255], 2]]);
  });

  it("inverts before applying, so Invert means 'in gamut'", () => {
    const { store, calls } = storeWith(new Uint8Array([255, 0]));
    store.outOfGamutSelect({ invert: true });
    expect(calls[0]).toEqual(["apply", [0, 255], 0]);
  });

  it("does nothing when no proof is available to ask", () => {
    const { store, calls } = storeWith(new Uint8Array());
    store.outOfGamutSelect({});
    expect(calls).toEqual([]);
  });
});

describe("Localized Color Clusters (#412)", () => {
  it("uses the localized engine path only when a range and matching points exist", () => {
    const { store, calls } = storeWith();
    store.colorRangeSelect({
      fuzziness: 40, samples: [[255, 0, 0]], points: [[3, 4]], clusterRange: 20,
    });
    expect(calls[0]).toEqual(["localized", [255, 0, 0], [3, 4], 40, 20, 0]);
  });

  it("falls back to the plain match when the option is off", () => {
    const { store, calls } = storeWith();
    store.colorRangeSelect({ fuzziness: 40, samples: [[255, 0, 0]], points: [[3, 4]], clusterRange: 0 });
    expect(calls[0][0]).toBe("batch");
  });

  it("falls back rather than mispairing when points and samples disagree", () => {
    const { store, calls } = storeWith();
    store.colorRangeSelect({
      fuzziness: 40, samples: [[255, 0, 0], [0, 255, 0]], points: [[3, 4]], clusterRange: 20,
    });
    expect(calls[0][0]).toBe("batch");
  });
});

describe("Selection Preview renderings (#412)", () => {
  it("draws nothing at all for None", () => {
    expect(selectionPreviewPixel(255, "none").a).toBe(0);
  });

  it("shows the coverage itself, opaque, for Grayscale", () => {
    expect(selectionPreviewPixel(200, "gray")).toEqual({ r: 200, g: 200, b: 200, a: 255 });
  });

  it("covers only the unselected part for the mattes, so an edge stays partial", () => {
    expect(selectionPreviewPixel(255, "black").a).toBe(0); // fully selected → matte clears
    expect(selectionPreviewPixel(0, "black")).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(selectionPreviewPixel(0, "white")).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(selectionPreviewPixel(128, "white").a).toBe(127);
  });

  it("reuses the Quick Mask rubylith, so it matches pressing Q", () => {
    const px = selectionPreviewPixel(0, "quickmask");
    expect([px.r, px.g, px.b]).toEqual([255, 0, 0]);
    expect(selectionPreviewPixel(255, "quickmask").a).toBe(0);
  });
});
