import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { DEFAULT_DOCUMENT_RESOLUTION_PPI } from "./docPresets";
import { Store, type AppSnapshot } from "./store";

function setup() {
  const raster = { set_resolution_ppi: vi.fn(), set_guides: vi.fn() };
  const client = {
    engine: raster,
    e: raster,
    commit: vi.fn(() => true),
    consumeEditError: vi.fn(() => false),
    sync: vi.fn(),
    lastBrush: [] as number[],
    onCommit: null as (() => void) | null,
  };
  const store = new Store(client as never);
  return {
    store,
    raster,
    internals: store as unknown as {
      set: (patch: Partial<AppSnapshot>) => void;
      pushDocumentMetadata: () => void;
    },
  };
}

// The engine is the only thing that writes the PSD, so metadata the store never
// hands down is metadata Photoshop reads back as its own defaults — 72 ppi and
// no guides.
describe("Photoshop document metadata handoff", () => {
  it("hands the active document's ppi to the engine", () => {
    const { raster, internals } = setup();

    internals.pushDocumentMetadata();
    expect(raster.set_resolution_ppi).toHaveBeenLastCalledWith(DEFAULT_DOCUMENT_RESOLUTION_PPI);

    internals.set({ resolutionPpi: 300 });
    internals.pushDocumentMetadata();
    expect(raster.set_resolution_ppi).toHaveBeenLastCalledWith(300);
  });

  it("hands guides down as (direction, position) pairs when they change", () => {
    const { store, raster } = setup();

    store.addGuide("v", 12);
    store.addGuide("h", 40);

    expect(raster.set_guides).toHaveBeenLastCalledWith(new Float32Array([0, 12, 1, 40]));

    store.clearGuides();
    expect(raster.set_guides).toHaveBeenLastCalledWith(new Float32Array([]));
  });

  it("scales and translates every document-space annotation with geometry edits (#332)", () => {
    const { store, raster, internals } = setup();
    internals.set({
      doc: { width: 500, height: 400, name: "Geometry" },
      guides: [
        { o: "v", p: 500, color: "#33aaff" },
        { o: "h", p: 600, color: "#33aaff" },
      ],
      notes: [{ id: 1, x: 500, y: 600, text: "pin", author: "Dal" }],
      colorSamplers: [{ x: 800, y: 700 }],
    });

    store.remapDocSpaceAnnotations(0.5, 0.5);
    expect(store.state.guides.map(({ o, p }) => [o, p])).toEqual([["v", 250], ["h", 300]]);
    expect(store.state.notes[0]).toMatchObject({ x: 250, y: 300 });
    expect(store.state.colorSamplers[0]).toEqual({ x: 400, y: 350 });

    internals.set({ doc: { width: 200, height: 150, name: "Geometry" } });
    store.remapDocSpaceAnnotations(1, 1, -100, -200);
    expect(store.state.guides.map(({ o, p }) => [o, p])).toEqual([["v", 150], ["h", 100]]);
    expect(store.state.notes[0]).toMatchObject({ x: 150, y: 100 });
    expect(store.state.colorSamplers[0]).toEqual({ x: 199, y: 149 });
    expect(raster.set_guides).toHaveBeenLastCalledWith(new Float32Array([0, 150, 1, 100]));
  });
});
