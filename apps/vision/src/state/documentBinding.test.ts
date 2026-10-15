// Per-document timeline, playhead, and Fit Layer. A tab switch only moves
// document state, so no wasm engine is involved — same shape as
// perDocumentTools.test.ts.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, type AppSnapshot } from "./store";
import { DEFAULT_MEASURE_SCALE } from "./measureScale";
import { DEFAULT_DOCUMENT_RESOLUTION_PPI } from "./docPresets";
import { defaultVanishingPointPlane } from "./store";
import { fitZoom, orientedDocSize } from "./zoomPresets";
import { panToShow } from "./viewTransform";

function seedDoc(id: number) {
  return {
    id, name: `doc-${id}`, engine: null, savedPath: null,
    zoom: 1, panX: 0, panY: 0, rotationAngle: 0, historyLabels: [], dirty: false,
    contentRevision: 0, pristineBlank: false, colorProfileAssigned: true,
    iccProfileBytes: null, iccProfileName: null,
    notes: [], activeNoteId: 0, nextNoteId: 1, layerComps: [], guides: [],
    resolutionPpi: DEFAULT_DOCUMENT_RESOLUTION_PPI, pixelAspect: 1, pixelAspectCorrection: true,
    measureScale: { ...DEFAULT_MEASURE_SCALE },
    savedPaths: [], penPath: [], penAnchors: [], penContours: [],
    vanishingPointPlanes: [{ quad: [...defaultVanishingPointPlane(400, 300)], parent: null as number | null, edge: 0, angle: 90 }],
    vanishingPointActivePlane: 0, vanishingPointSource: null,
    duotone: null, cameraRaw: null, cameraRawLayerId: null,
    timeline: { fps: 12, durationS: 3, keys: [] as { layerId: number; t: number; opacity: number; dx: number; dy: number }[] },
    playhead: 0,
    layerColorLabels: {},
  };
}

function setupStore(docs: ReturnType<typeof seedDoc>[]) {
  const client = {
    engine: null as { active_layer_bbox?: () => Int32Array | null } | null,
    e: {
      layer_offset: () => [3, 4],
      layer_opacity: () => 0.5,
    },
    onCommit: null,
    onEditError: vi.fn(),
    lastBrush: [] as number[],
    activate: vi.fn(),
    deactivate: vi.fn(),
  };
  const store = new Store(client as never);
  const internal = store as unknown as {
    docs: ReturnType<typeof seedDoc>[];
    activeDocId: number;
    set: (patch: Partial<AppSnapshot>) => void;
  };
  internal.docs = docs;
  internal.activeDocId = docs[0]?.id ?? -1;
  internal.set({
    documents: docs.map(({ id, name, dirty, savedPath }) => ({ id, name, dirty, hasFile: !!savedPath })),
    activeLayerId: 1,
    ready: docs.length > 0,
  });
  return { store, internal, client };
}

describe("timeline and playhead stay with the document", () => {
  it("restores each document's duration and playhead across tab switches", () => {
    const { store } = setupStore([seedDoc(1), seedDoc(2)]);
    store.timelineSetDuration(2);
    store.timelineSetPlayhead(1.5);
    expect(store.state.playhead).toBe(1.5);
    expect(store.state.timeline.durationS).toBe(2);

    store.activateDoc(2);
    expect(store.state.playhead).toBe(0);
    expect(store.state.timeline.durationS).toBe(3);

    store.activateDoc(1);
    expect(store.state.playhead).toBe(1.5);
    expect(store.state.timeline.durationS).toBe(2);
  });

  it("clamps the playhead when the duration shortens and keeps keys past the new end", () => {
    const { store, internal } = setupStore([seedDoc(1)]);
    internal.set({
      activeLayerId: 1,
      playhead: 2.5,
      timeline: { fps: 12, durationS: 3, keys: [{ layerId: 1, t: 2.5, opacity: 1, dx: 0, dy: 0 }] },
    });
    store.timelineSetDuration(1);
    expect(store.state.playhead).toBe(1);
    expect(store.state.timeline.durationS).toBe(1);
    expect(store.state.timeline.keys[0].t).toBe(2.5);
  });

  it("clamps a new key into the current duration", () => {
    const { store } = setupStore([seedDoc(1)]);
    store.timelineSetDuration(1);
    store.timelineAddKey(5);
    expect(store.state.timeline.keys.map((key) => key.t)).toEqual([1]);
    expect(store.state.timeline.keys[0]).toMatchObject({ layerId: 1, opacity: 0.5, dx: 3, dy: 4 });
  });

  it("resets the timeline when the last document closes", () => {
    const { store, client } = setupStore([seedDoc(1)]);
    store.timelineSetDuration(2);
    store.timelineSetPlayhead(1);
    store.closeDoc(1);
    expect(client.deactivate).toHaveBeenCalled();
    expect(store.state.ready).toBe(false);
    expect(store.state.documents).toEqual([]);
    expect(store.state.playhead).toBe(0);
    expect(store.state.timeline.durationS).toBe(3);
    expect(store.state.timeline.keys).toEqual([]);
  });
});

describe("fitLayer", () => {
  it("fits the active layer's inclusive bounds through the oriented view", () => {
    const { store, client, internal } = setupStore([seedDoc(1)]);
    internal.set({
      doc: { width: 200, height: 100, name: "layer" },
      rotationAngle: 90,
      pixelAspect: 1,
      pixelAspectCorrection: true,
    });
    store.setViewport(900, 600);
    client.engine = { active_layer_bbox: () => Int32Array.from([0, 0, 99, 49]) };
    const nonce = store.state.fitNonce;
    store.fitLayer();
    const rw = 99 - 0 + 1;
    const rh = 49 - 0 + 1;
    const box = orientedDocSize(rw, rh, 90, 1);
    const zoom = fitZoom(900, 600, box.w, box.h);
    const pan = panToShow(zoom, 90, 1, 200, 100, { x: (0 + 99 + 1) / 2, y: (0 + 49 + 1) / 2 }, 450, 300);
    expect(zoom).not.toBeCloseTo(fitZoom(900, 600, rw, rh), 5);
    expect(store.state.zoom).toBeCloseTo(zoom, 5);
    expect(store.state.panX).toBeCloseTo(pan.panX, 5);
    expect(store.state.panY).toBeCloseTo(pan.panY, 5);
    expect(store.state.fitNonce).toBe(nonce);
  });

  it("asks the viewport to fit the whole document when the layer has no bounds", () => {
    const { store, client } = setupStore([seedDoc(1)]);
    store.setViewport(900, 600);
    client.engine = { active_layer_bbox: () => null };
    const nonce = store.state.fitNonce;
    store.fitLayer();
    expect(store.state.fitNonce).toBe(nonce + 1);
  });
});
