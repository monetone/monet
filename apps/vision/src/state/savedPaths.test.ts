// Paths belong to the document (Photoshop keeps them in the PSD): they persist
// in the project envelope and travel per tab, never as global session state.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { decodeProjectEnvelope, encodeProjectEnvelope, normalizeSavedPaths } from "./projectEnvelope";
import { ANCHOR_STRIDE, MAX_PERSISTED_SAVED_PATHS, type SavedPath } from "./paths";
import { Store, type AppSnapshot } from "./store";
import { DEFAULT_MEASURE_SCALE } from "./measureScale";
import { DEFAULT_DOCUMENT_RESOLUTION_PPI } from "./docPresets";

const SQUARE: SavedPath = { name: "Path 1", path: [0, 0, 10, 0, 10, 10, 0, 10] };
const CURVE: SavedPath = {
  name: "Path 2",
  path: [0, 0, 5, 5, 10, 0],
  anchors: [0, 0, 0, 0, 2, 2, 5, 5, -2, 0, 2, 0, 10, 0, -2, 2, 0, 0],
};

describe("saved paths in the project envelope", () => {
  it("round-trips named paths (flat and bezier) through save/reopen", () => {
    const encoded = encodeProjectEnvelope(new Uint8Array([1, 2, 3]), [], {
      colorProfileAssigned: true,
      savedPaths: [SQUARE, CURVE],
    });
    expect(decodeProjectEnvelope(encoded)?.document.savedPaths).toEqual([SQUARE, CURVE]);
  });

  it("keeps paths alone worth an envelope (an otherwise plain document still saves them)", () => {
    const encoded = encodeProjectEnvelope(new Uint8Array([1, 2, 3]), [], {
      colorProfileAssigned: true,
      savedPaths: [SQUARE],
    });
    expect(decodeProjectEnvelope(encoded)?.document).toEqual({ colorProfileAssigned: true, savedPaths: [SQUARE] });
  });

  it("rejects malformed persisted entries instead of loading them", () => {
    expect(normalizeSavedPaths(undefined)).toEqual([]);
    expect(normalizeSavedPaths([
      { name: "", path: [0, 0, 1, 1, 2, 2] }, // unnamed
      { name: "short", path: [0, 0, 1, 1] }, // fewer than 3 vertices
      { name: "nan", path: [0, 0, 1, Number.NaN, 2, 2] },
      { name: "not an array", path: "0,0" },
      SQUARE,
    ])).toEqual([SQUARE]);
  });

  it("drops an unusable bezier form but keeps the flat path", () => {
    const ragged = { name: "Path 3", path: SQUARE.path, anchors: CURVE.anchors!.slice(0, ANCHOR_STRIDE + 1) };
    expect(normalizeSavedPaths([ragged])).toEqual([{ name: "Path 3", path: SQUARE.path }]);
  });

  it("keeps a multi-loop path's loop counts and drops counts that do not fit (#452)", () => {
    const tri = (x: number) => [x, 0, 0, 0, 0, 0, x + 10, 0, 0, 0, 0, 0, x + 10, 10, 0, -2, 0, 2];
    const loops: SavedPath = { name: "Glyphs", path: [0, 0, 10, 0, 10, 10, 0, 0, 20, 0, 30, 0, 30, 10, 20, 0], anchors: [...tri(0), ...tri(20)], contours: [3, 3] };
    const encoded = encodeProjectEnvelope(new Uint8Array([1, 2, 3]), [], { colorProfileAssigned: true, savedPaths: [loops] });
    expect(decodeProjectEnvelope(encoded)?.document.savedPaths).toEqual([loops]);
    const { contours: _, ...single } = loops;
    for (const contours of [[3, 2], [6.5], [1, 5], "3,3", [Number.NaN, 6]]) {
      expect(normalizeSavedPaths([{ ...loops, contours }])).toEqual([single]);
    }
    expect(normalizeSavedPaths([{ name: "Glyphs", path: loops.path, contours: [3, 3] }]), "counts need a bezier form")
      .toEqual([{ name: "Glyphs", path: loops.path }]);
  });

  it("copies geometry so a normalized entry cannot alias the source", () => {
    const [copy] = normalizeSavedPaths([SQUARE]);
    copy.path[0] = 99;
    expect(SQUARE.path[0]).toBe(0);
  });
});

// Docs are seeded directly onto the private `docs` array (same idiom as
// matchView.test.ts): tab switching only moves per-document state around, so no
// wasm engine is involved.
function seedDoc(id: number, savedPaths: SavedPath[]) {
  return {
    id, name: `doc-${id}`, engine: null, savedPath: null,
    zoom: 1, panX: 0, panY: 0, rotationAngle: 0, historyLabels: [], dirty: false,
    contentRevision: 0, pristineBlank: false, colorProfileAssigned: true,
    iccProfileBytes: null, iccProfileName: null,
    notes: [], activeNoteId: 0, nextNoteId: 1, layerComps: [], guides: [],
    resolutionPpi: DEFAULT_DOCUMENT_RESOLUTION_PPI, pixelAspect: 1, pixelAspectCorrection: true,
    measureScale: { ...DEFAULT_MEASURE_SCALE },
    savedPaths, penPath: [], penAnchors: [], penContours: [],
    vanishingPointPlanes: [{ quad: [0, 0, 1, 0, 1, 1, 0, 1], parent: null, edge: 0, angle: 90 }], vanishingPointActivePlane: 0, vanishingPointSource: null,
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
  // The active document's live state lives in the reactive snapshot, not its
  // own DocEntry (see activateDoc/captureActiveView) — mirror that here.
  internal.set({ savedPaths: docs[0].savedPaths, documents: docs.map(({ id, name, dirty }) => ({ id, name, dirty })) });
  return { store, internal, client };
}

describe("saved paths are per document", () => {
  it("swaps the Paths panel and the work path on a tab switch", () => {
    const { store, internal } = setupStore([seedDoc(1, [SQUARE]), seedDoc(2, [CURVE])]);
    store.setPenPath([1, 1, 2, 2, 3, 3]);

    store.activateDoc(2);
    expect(store.state.savedPaths).toEqual([CURVE]);
    expect(store.state.penPath).toEqual([]); // doc 2 has no work path of its own

    store.saveWorkPath(); // no work path here → nothing to save
    expect(store.state.savedPaths).toEqual([CURVE]);

    store.activateDoc(1);
    expect(store.state.savedPaths).toEqual([SQUARE]);
    expect(store.state.penPath).toEqual([1, 1, 2, 2, 3, 3]); // captured on the way out
    expect(internal.docs[1].savedPaths).toEqual([CURVE]);
  });

  it("saving a path dirties only its own document and reports it to the envelope", () => {
    const { store, internal } = setupStore([seedDoc(1, []), seedDoc(2, [])]);
    store.setPenPath([0, 0, 4, 0, 4, 4]);
    store.saveWorkPath();

    expect(store.state.savedPaths).toEqual([{ name: "Path 1", path: [0, 0, 4, 0, 4, 4] }]);
    expect(internal.docs[0].dirty).toBe(true); // the file now differs from disk
    expect(internal.docs[1].dirty).toBe(false);
    expect(store.docDocumentMeta(1)?.savedPaths).toEqual([{ name: "Path 1", path: [0, 0, 4, 0, 4, 4] }]);
    expect(store.docDocumentMeta(2)?.savedPaths).toBeUndefined();

    store.deleteSavedPath(0);
    expect(store.state.savedPaths).toEqual([]);
    expect(store.docDocumentMeta(1)?.savedPaths).toBeUndefined();
  });

  it("reports instead of accepting a path that a tab switch would drop", () => {
    const full = Array.from({ length: 512 }, (_, i) => ({ ...SQUARE, name: `Path ${i + 1}` }));
    const { store, client } = setupStore([seedDoc(1, full)]);
    store.setPenPath(SQUARE.path);

    store.saveWorkPath();

    expect(store.state.savedPaths).toHaveLength(512);
    expect(client.onEditError).toHaveBeenCalledWith("This document already has the maximum 512 saved paths.");
  });
});

// Photoshop's Paths panel ▸ Clipping Path…: one saved path, with a flatness,
// becomes the document's clipping path and travels with it (#457).
describe("Clipping Path", () => {
  const MISSING = "That saved path no longer exists. Choose another path for the clipping path.";
  const FLATNESS = "Flatness must be between 0.2 and 100 device pixels.";

  it("marks exactly one saved path, moves the mark, and clears it with None", () => {
    const { store, internal } = setupStore([seedDoc(1, [SQUARE, CURVE]), seedDoc(2, [])]);

    expect(store.setClippingPath(0, 2)).toBe(true);
    expect(store.state.savedPaths).toEqual([{ ...SQUARE, clipFlatness: 2 }, CURVE]);
    expect(internal.docs[0].dirty).toBe(true);
    expect(internal.docs[1].dirty).toBe(false);
    expect(store.docDocumentMeta(1)?.savedPaths).toEqual([{ ...SQUARE, clipFlatness: 2 }, CURVE]);

    expect(store.setClippingPath(1, 0.5)).toBe(true);
    expect(store.state.savedPaths).toEqual([SQUARE, { ...CURVE, clipFlatness: 0.5 }]);

    expect(store.setClippingPath(null, 0.2)).toBe(true);
    expect(store.state.savedPaths).toEqual([SQUARE, CURVE]);
  });

  it("leaves the document clean when nothing changes", () => {
    const { store, internal } = setupStore([seedDoc(1, [{ ...SQUARE, clipFlatness: 2 }])]);
    expect(store.setClippingPath(0, 2)).toBe(true);
    expect(internal.docs[0].dirty).toBe(false);
  });

  it("refuses a missing path or an unstorable flatness, reporting why and changing nothing", () => {
    const { store, internal, client } = setupStore([seedDoc(1, [SQUARE])]);
    for (const [index, flatness, message] of [
      [0, 0.1, FLATNESS], [0, 101, FLATNESS], [0, Number.NaN, FLATNESS],
      [-2, 2, MISSING], [1, 2, MISSING], [0.5, 2, MISSING],
    ] as const) {
      client.onEditError.mockClear();
      expect(store.setClippingPath(index, flatness), `${index} ${flatness}`).toBe(false);
      expect(client.onEditError).toHaveBeenCalledWith(message);
    }
    expect(store.state.savedPaths).toEqual([SQUARE]);
    expect(internal.docs[0].dirty).toBe(false);
  });

  it("stays with its document across a tab switch and goes when its path is deleted", () => {
    const { store } = setupStore([seedDoc(1, [SQUARE, CURVE]), seedDoc(2, [])]);
    store.setClippingPath(1, 4);
    store.activateDoc(2);
    expect(store.state.savedPaths).toEqual([]);
    store.activateDoc(1);
    expect(store.state.savedPaths).toEqual([SQUARE, { ...CURVE, clipFlatness: 4 }]);
    store.deleteSavedPath(1);
    expect(store.state.savedPaths).toEqual([SQUARE]);
  });

  it("round-trips through the envelope, which keeps one clipping path Photoshop can store", () => {
    const clipped = { ...CURVE, clipFlatness: 3.5 };
    const encoded = encodeProjectEnvelope(new Uint8Array([1, 2, 3]), [], {
      colorProfileAssigned: true,
      savedPaths: [SQUARE, clipped],
    });
    expect(decodeProjectEnvelope(encoded)?.document.savedPaths).toEqual([SQUARE, clipped]);
    expect(normalizeSavedPaths([
      { ...SQUARE, name: "small", clipFlatness: 0.1 },
      { ...SQUARE, name: "big", clipFlatness: 101 },
      { ...SQUARE, name: "nan", clipFlatness: Number.NaN },
      { ...SQUARE, name: "text", clipFlatness: "2" },
      { ...SQUARE, name: "first", clipFlatness: 2 },
      { ...SQUARE, name: "second", clipFlatness: 3 },
    ]).map((p) => p.clipFlatness)).toEqual([undefined, undefined, undefined, undefined, 2, undefined]);
  });

  const PSD_PATH = { name: "Path 1", anchors: [8, 8, 0, 0, 0, 0, 32, 8, 0, 0, 0, 0, 20, 32, 0, 0, 0, 0], clip: 2 };
  const PSD_SAVED_PATH: SavedPath = { name: "Path 1", path: [8, 8, 32, 8, 20, 32], clipFlatness: 2 };
  /** An engine a PSD import built: the paths it read and how many it skipped. */
  function psdEngine(paths: unknown[], skipped = 0) {
    return new Proxy({ photoshop_paths_json: () => JSON.stringify(paths), photoshop_paths_skipped: () => skipped, width: () => 40, height: () => 40 } as Record<string | symbol, unknown>, {
      get: (t, key) => (key in t ? t[key] : () => 0),
    });
  }
  function openPsd(eng: ReturnType<typeof psdEngine>) {
    const client = { engine: null, e: null, onCommit: null, onEditError: vi.fn(), lastBrush: [] as number[], activate: vi.fn(), buildFormat: vi.fn(() => eng) };
    const store = new Store(client as never);
    store.openFormat(new Uint8Array([0x38, 0x42, 0x50, 0x53]), "clip.psd");
    return { store, client };
  }

  it("adopts a PSD's named paths and clipping path on open without dirtying the document", () => {
    const { store, client } = openPsd(psdEngine([PSD_PATH]));

    expect(store.state.savedPaths).toEqual([PSD_SAVED_PATH]);
    const docs = (store as unknown as { docs: Array<{ dirty: boolean }> }).docs;
    expect(docs.at(-1)?.dirty).toBe(false);
    expect(client.onEditError).not.toHaveBeenCalled();
  });

  it("reports path entries a PSD open skipped, because saving the file leaves them out", () => {
    const { client } = openPsd(psdEngine([PSD_PATH], 2));
    expect(client.onEditError).toHaveBeenCalledWith(expect.stringContaining("could not open 2 path entries in clip.psd"));

    // Past the per-document limit the store drops paths the engine did read.
    const many = Array.from({ length: MAX_PERSISTED_SAVED_PATHS + 1 }, (_, i) => ({ ...PSD_PATH, name: `Path ${i}`, clip: null }));
    expect(openPsd(psdEngine(many)).client.onEditError).toHaveBeenCalledWith(expect.stringContaining("could not open 1 path entry in clip.psd"));
  });

  // Revert hands no document for a PSD: the reloaded engine's paths are the
  // file's, and dropping them made the next save delete 2000+/2999 from disk.
  it("keeps a PSD's paths and clipping path through File ▸ Revert", () => {
    const { store } = openPsd(psdEngine([PSD_PATH]));
    store.deleteSavedPath(0);

    store.revertActiveDoc(psdEngine([PSD_PATH]) as never, undefined);
    expect(store.state.savedPaths).toEqual([PSD_SAVED_PATH]);
    const { activeDocId } = store as unknown as { activeDocId: number };
    expect(store.docDocumentMeta(activeDocId)?.savedPaths).toEqual([PSD_SAVED_PATH]); // what a save writes

    // A file with no Photoshop paths reverts to none, and a document's own paths win.
    store.revertActiveDoc(psdEngine([]) as never, null);
    expect(store.state.savedPaths).toEqual([]);
    store.revertActiveDoc(psdEngine([PSD_PATH]) as never, { colorProfileAssigned: true, savedPaths: [SQUARE] });
    expect(store.state.savedPaths).toEqual([SQUARE]);
  });
});
