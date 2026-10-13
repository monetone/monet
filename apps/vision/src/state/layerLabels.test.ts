// Unit tests for the layer color-label helpers. Engine-free (node); the row chip +
// dot + context-menu submenu are covered by e2e/layer-labels.spec.ts.
import { describe, it, expect, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { labelColor, setLabel, LAYER_LABELS, type LayerLabel } from "./layerLabels";
import { Store, type AppSnapshot } from "./store";
import { DEFAULT_MEASURE_SCALE } from "./measureScale";
import { DEFAULT_DOCUMENT_RESOLUTION_PPI } from "./docPresets";

describe("labelColor", () => {
  it("returns the chip colour for a named label", () => {
    expect(labelColor("red")).toBe("#e2504a");
    expect(labelColor("blue")).toBe("#4a7fd0");
  });

  it("returns undefined for none/unset", () => {
    expect(labelColor("none")).toBeUndefined();
    expect(labelColor(undefined)).toBeUndefined();
  });

  it("has a colour for every label except 'none' and lists No Color first", () => {
    expect(LAYER_LABELS[0].value).toBe("none");
    for (const o of LAYER_LABELS) {
      if (o.value === "none") expect(o.color).toBeUndefined();
      else expect(o.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("setLabel", () => {
  it("sets a label for an id", () => {
    expect(setLabel({}, 1, "red")).toEqual({ 1: "red" });
  });

  it("removes the entry when set to none", () => {
    expect(setLabel({ 1: "red" } as Record<number, LayerLabel>, 1, "none")).toEqual({});
  });

  it("preserves other entries and does not mutate the input", () => {
    const orig: Record<number, LayerLabel> = { 1: "red" };
    const next = setLabel(orig, 2, "blue");
    expect(next).toEqual({ 1: "red", 2: "blue" });
    expect(orig).toEqual({ 1: "red" }); // input untouched
  });
});

// Docs are seeded directly onto the private `docs` array (same idiom as
// savedPaths.test.ts): tab switching only moves per-document state around, so no
// wasm engine is involved.
function seedDoc(id: number) {
  return {
    id, name: `doc-${id}`, engine: null, savedPath: null,
    zoom: 1, panX: 0, panY: 0, rotationAngle: 0, historyLabels: [], dirty: false,
    contentRevision: 0, pristineBlank: false, colorProfileAssigned: true,
    iccProfileBytes: null, iccProfileName: null,
    notes: [], activeNoteId: 0, nextNoteId: 1, layerComps: [],
    layerColorLabels: {} as Record<number, LayerLabel>, guides: [],
    resolutionPpi: DEFAULT_DOCUMENT_RESOLUTION_PPI, pixelAspect: 1, pixelAspectCorrection: true,
    measureScale: { ...DEFAULT_MEASURE_SCALE },
    savedPaths: [], penPath: [], penAnchors: [], penContours: [],
    vanishingPointPlanes: [{ quad: [0, 0, 1, 0, 1, 1, 0, 1], parent: null, edge: 0, angle: 90 }], vanishingPointActivePlane: 0, vanishingPointSource: null,
    cameraRaw: null, cameraRawLayerId: null,
  };
}

describe("layer colour labels are per document (#144)", () => {
  it("does not carry a tag onto the same layer id in another tab", () => {
    const client = { engine: null, e: null, onCommit: null, lastBrush: [] as number[], activate: vi.fn() };
    const store = new Store(client as never);
    const internal = store as unknown as {
      docs: ReturnType<typeof seedDoc>[];
      activeDocId: number;
      set: (patch: Partial<AppSnapshot>) => void;
    };
    internal.docs = [seedDoc(1), seedDoc(2)];
    internal.activeDocId = 1;
    internal.set({ documents: internal.docs.map(({ id, name, dirty, savedPath }) => ({ id, name, dirty, hasFile: !!savedPath })) });

    store.setLayerColorLabel(3, "red"); // doc 1's third layer
    store.activateDoc(2);
    // Every engine starts at layer id 1, so doc 2 has its own layer 3.
    expect(store.state.layerColorLabels).toEqual({});

    store.setLayerColorLabel(3, "blue");
    store.activateDoc(1);
    expect(store.state.layerColorLabels).toEqual({ 3: "red" }); // captured on the way out
    expect(internal.docs[1].layerColorLabels).toEqual({ 3: "blue" });
  });
});
