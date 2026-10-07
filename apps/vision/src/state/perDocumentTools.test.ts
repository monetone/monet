// Tool state that names pixels belongs to the document that owns them. A plane
// or a sampled point carried across a tab switch is not "sticky settings" — it
// is coordinates from another image (#503, #492).
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, defaultVanishingPointPlane, defaultVanishingPointPlanes, type AppSnapshot } from "./store";
import { DEFAULT_MEASURE_SCALE } from "./measureScale";
import { DEFAULT_DOCUMENT_RESOLUTION_PPI } from "./docPresets";
import { DEFAULT_CLONE_TRANSFORM } from "./cloneSample";

const PLANE_A = [1, 1, 9, 1, 9, 9, 1, 9];

// Same idiom as savedPaths.test.ts / matchView.test.ts: a tab switch only moves
// per-document state around, so no wasm engine is involved.
function seedDoc(id: number, plane = defaultVanishingPointPlane(400, 300)) {
  return {
    id, name: `doc-${id}`, engine: null, savedPath: null,
    zoom: 1, panX: 0, panY: 0, rotationAngle: 0, historyLabels: [], dirty: false,
    contentRevision: 0, pristineBlank: false, colorProfileAssigned: true,
    iccProfileBytes: null, iccProfileName: null,
    notes: [], activeNoteId: 0, nextNoteId: 1, layerComps: [], guides: [],
    resolutionPpi: DEFAULT_DOCUMENT_RESOLUTION_PPI, pixelAspect: 1, pixelAspectCorrection: true,
    measureScale: { ...DEFAULT_MEASURE_SCALE },
    savedPaths: [], penPath: [], penAnchors: [], penContours: [],
    vanishingPointPlanes: [{ quad: [...plane], parent: null as number | null, edge: 0, angle: 90 }],
    vanishingPointActivePlane: 0, vanishingPointSource: null,
    duotone: null as { inks: unknown[]; overprints: unknown; layerId: number } | null,
    cameraRaw: null, cameraRawLayerId: null,
  };
}

function setupStore(docs: ReturnType<typeof seedDoc>[]) {
  const client = { engine: null, e: null, onCommit: null, onEditError: vi.fn(), lastBrush: [] as number[], activate: vi.fn() };
  const store = new Store(client as never);
  const internal = store as unknown as {
    docs: ReturnType<typeof seedDoc>[];
    activeDocId: number;
    set: (patch: Partial<AppSnapshot>) => void;
  };
  internal.docs = docs;
  internal.activeDocId = docs[0].id;
  internal.set({
    vanishingPointPlanes: docs[0].vanishingPointPlanes.map((p) => ({ ...p, quad: [...p.quad] })),
    vanishingPointActivePlane: docs[0].vanishingPointActivePlane,
    vanishingPointSource: docs[0].vanishingPointSource,
    documents: docs.map(({ id, name, dirty }) => ({ id, name, dirty })),
  });
  return { store, internal, client };
}

describe("Duotone inks are per document", () => {
  it("keeps the ink specification with the document that was inked", () => {
    // The Duotone adjustment layer's id is per engine, so the state was thrown
    // away on every tab switch. Re-opening the dialog then found no record and
    // stacked a SECOND ink layer on a document that already had one (#492).
    const { store, internal } = setupStore([seedDoc(1), seedDoc(2)]);
    const spec = { inks: [{ name: "Black", color: "#000000", curve: [] }], overprints: {}, layerId: 7 };
    internal.set({ duotone: spec as never });

    store.activateDoc(2);
    expect(store.state.duotone).toBeNull(); // doc 2 is not a duotone document

    store.activateDoc(1);
    expect(store.state.duotone).toEqual(spec);
  });
});

describe("Clone Source slots belong to the document they were sampled in (#427)", () => {
  it("keep their document across tab switches and empty only when that document closes", () => {
    const { store } = setupStore([seedDoc(1), seedDoc(2), seedDoc(3)]);
    store.setCloneSource(4, 5); // slot 1 ← doc 1
    store.selectCloneSlot(1);
    store.activateDoc(2);
    store.setCloneSource(6, 7); // slot 2 ← doc 2
    store.activateDoc(3);
    expect(store.state.cloneSourceSlot).toBe(1); // the slot choice is the panel's, not the document's
    expect(store.state.cloneSources.map((s) => s.source)).toEqual([{ docId: 1, x: 4, y: 5 }, { docId: 2, x: 6, y: 7 }, null, null, null]);

    store.closeDoc(2);
    expect(store.state.cloneSources.map((s) => s.source)).toEqual([{ docId: 1, x: 4, y: 5 }, null, null, null, null]);
  });

  it("hand another document's source pixels to the active engine, and let the active one capture its own", () => {
    const px = new Uint8Array(8);
    const source = { set_clone_sample: vi.fn(), width: () => 2, height: () => 1, clone_source_rgba8: vi.fn(() => px) };
    const docs = [seedDoc(1), seedDoc(2)];
    (docs[0] as { engine: unknown }).engine = source;
    const { store, client, internal } = setupStore(docs);
    const active = { set_clone_source: vi.fn(() => true) };
    (client as { e: unknown }).e = active;
    internal.set({ cloneSample: 0 });
    store.setCloneSource(1, 0);

    internal.activeDocId = 2;
    expect(store.prepareCloneSource()).toBe(true);
    expect(source.set_clone_sample).toHaveBeenCalledWith(0); // the Sample mode picks what is read
    expect(active.set_clone_source).toHaveBeenCalledWith(2, 1, px);

    internal.activeDocId = 1;
    active.set_clone_source.mockClear();
    expect(store.prepareCloneSource()).toBe(true);
    expect(active.set_clone_source).not.toHaveBeenCalled();

    store.selectCloneSlot(3); // an empty slot has nothing to arm
    expect(store.prepareCloneSource()).toBe(false);
    expect(store.cloneSourceImage()).toBeNull();
  });

  it("refuses an out-of-range field with an actionable message and changes nothing", () => {
    const { store } = setupStore([seedDoc(1)]);
    store.setCloneTransform({ w: 150, flipH: true });
    const slots = store.state.cloneSources;
    const overlay = store.state.cloneOverlay;

    store.setCloneTransform({ w: 0, angle: 10 });
    expect(store.state.cloneSourceError).toBe("Width must be a number from 1% to 1000%.");
    expect(store.state.cloneSources).toBe(slots);
    store.setCloneTransform({ angle: Number.NaN });
    expect(store.state.cloneSourceError).toBe("Angle must be a number from -180° to 180°.");
    store.setCloneOverlay({ show: true, opacity: 101 });
    expect(store.state.cloneSourceError).toBe("Overlay opacity must be a number from 0% to 100%.");
    expect(store.state.cloneOverlay).toBe(overlay);
    expect(store.state.cloneSources).toBe(slots);

    store.setCloneOverlay({ opacity: 40 });
    expect(store.state.cloneSourceError).toBe("");
    expect(store.state.cloneOverlay).toEqual({ show: false, opacity: 40 });

    store.selectCloneSlot(7);
    store.selectCloneSlot(1.5);
    expect(store.state.cloneSourceSlot).toBe(0);

    store.setCloneTransform(DEFAULT_CLONE_TRANSFORM); // Reset Transform
    expect(store.state.cloneSources[0].transform).toEqual(DEFAULT_CLONE_TRANSFORM);
  });
});

describe("Vanishing Point is per document", () => {
  it("swaps the plane list and drops the sampled source on a tab switch", () => {
    const { store } = setupStore([seedDoc(1), seedDoc(2)]);
    const planesA = [
      { quad: [...PLANE_A], parent: null, edge: 0, angle: 90 },
      { quad: [9, 1, 17, 1, 17, 9, 9, 9], parent: 0, edge: 1, angle: 120 },
    ];
    store.setOptions({ vanishingPointPlanes: planesA, vanishingPointActivePlane: 1, vanishingPointSource: { x: 5, y: 6 } });

    store.activateDoc(2);
    // Doc 2 was never Alt-clicked, and its planes are its own — carrying either
    // over means the next clone stroke reads the previous document's pixels.
    expect(store.state.vanishingPointSource).toBeNull();
    expect(store.state.vanishingPointPlanes).toEqual(defaultVanishingPointPlanes(400, 300));
    expect(store.state.vanishingPointActivePlane).toBe(0);
    planesA[1].quad[0] = 42; // a list captured by reference would change doc 1's plane too

    store.activateDoc(1);
    expect(store.state.vanishingPointPlanes[1].quad).toEqual([9, 1, 17, 1, 17, 9, 9, 9]); // captured on the way out
    expect(store.state.vanishingPointPlanes[0].quad).toEqual(PLANE_A);
    expect(store.state.vanishingPointActivePlane).toBe(1);
    expect(store.state.vanishingPointSource).toEqual({ x: 5, y: 6 });
  });

  it("derives a new document's plane from its own canvas", () => {
    const wide = defaultVanishingPointPlane(1000, 200);
    const tall = defaultVanishingPointPlane(200, 1000);
    expect(wide).not.toEqual(tall);
    expect(defaultVanishingPointPlanes(1000, 200)).toEqual([{ quad: wide, parent: null, edge: 0, angle: 90 }]);
    for (const [i, v] of wide.entries()) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(i % 2 === 0 ? 1000 : 200);
    }
  });
});
