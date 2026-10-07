import { describe, expect, it, vi } from "vitest";
vi.mock("@engine", () => ({ default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }), Engine: class Engine {} }));
import { emptyVariableData, normalizeVariableData, parseVariableCsv, variableImagePath } from "./dataVariables";
import { decodeProjectEnvelope, encodeProjectEnvelope, decodeDocumentMetaBytes, encodeDocumentMetaBytes } from "./projectEnvelope";
import { Store } from "./store";

describe("data-driven graphics", () => {
  it("parses quoted paths and rejects malformed CSV without replacing existing rows", () => {
    expect(parseVariableCsv('image,title\r\n"photos/a,b.png","Hello ""world"""')).toEqual([{ image: "photos/a,b.png", title: 'Hello "world"' }]);
    const store = new Store({ onSync: null, onCommit: null } as never);
    store.importDataSets("image,title\na.png,A", "/photos");
    const before = store.state;
    for (const csv of ['image,image\na,b', 'image,title\na', 'image\n"unclosed']) expect(() => store.importDataSets(csv)).toThrow();
    expect(store.state).toBe(before);
  });
  it("resolves paths relative to the CSV and refuses network, empty and context-free paths", () => {
    expect(variableImagePath("photos/a.png", "/jobs")).toBe("/jobs/photos/a.png");
    expect(variableImagePath("/photos/a.png", "")).toBe("/photos/a.png");
    for (const path of ["", "https://example.test/p.png", "relative.png", "a\0.png"]) expect(() => variableImagePath(path, "")).toThrow();
  });
  it("round trips pixel bindings, fit, paths and data sets through project and container metadata", () => {
    const variableData = normalizeVariableData({ variables: [{ layer: "Photo", name: "image", type: "pixel" }], dataSets: [{ image: "a.png" }], dataSetBaseDir: "/jobs" });
    const document = { colorProfileAssigned: true, variableData };
    expect(variableData.variables[0].fit).toBe("conform");
    expect(decodeProjectEnvelope(encodeProjectEnvelope(new Uint8Array([1]), [], document))?.document).toEqual(document);
    expect(decodeDocumentMetaBytes(encodeDocumentMetaBytes(document))).toEqual(document);
    expect(normalizeVariableData(undefined)).toEqual(emptyVariableData());
    expect(normalizeVariableData({ variables: [{ name: "a", layer: "Photo", type: "wrong" }] }).variables).toEqual([]);
  });
  it("validates layer type and unique layer names before replacing definitions", () => {
    const store = new Store({ onSync: null, onCommit: null } as never);
    (store as unknown as { set(p: object): void }).set({ layers: [{ id: 1, name: "Photo", kind: 0 }] });
    store.setVariables([{ layer: "Photo", name: "image", type: "pixel" }]);
    const before = store.state.variables;
    expect(() => store.setVariables([{ layer: "Photo", name: "image", type: "text" }])).toThrow(/text layer/);
    expect(store.state.variables).toBe(before);
  });
});

it("keeps variable state per tab and marks definitions as unsaved document metadata", () => {
  const client = { engine: null, e: null, onCommit: null, activate: vi.fn() };
  const store = new Store(client as never);
  const doc = (id: number, image: string) => ({
    id, engine: null, name: `doc-${id}`, zoom: 1, panX: 0, panY: 0, rotationAngle: 0, historyLabels: [], dirty: false, contentRevision: 0,
    colorProfileAssigned: true, iccProfileBytes: null, notes: [], activeNoteId: 0, nextNoteId: 1, layerComps: [], guides: [],
    resolutionPpi: 72, pixelAspect: 1, pixelAspectCorrection: true, measureScale: { pixels: 1, units: 1, unit: "px" },
    savedPaths: [], penPath: [], penAnchors: [], penContours: [], vanishingPointPlanes: [], vanishingPointActivePlane: 0, vanishingPointSource: null, cameraRaw: null,
    ...normalizeVariableData({ variables: [{ layer: "Photo", name: "image", type: "pixel" }], dataSets: [{ image }], dataSetBaseDir: `/job-${id}` }),
  });
  const docs = [doc(1, "one.png"), doc(2, "two.png")];
  const internal = store as unknown as { docs: typeof docs; activeDocId: number; set(patch: object): void };
  internal.docs = docs; internal.activeDocId = 1;
  internal.set({ ...normalizeVariableData(docs[0]), layers: [{ id: 1, name: "Photo", kind: 0 }], documents: docs.map(({ id, name, dirty }) => ({ id, name, dirty })) });
  store.setVariables([{ layer: "Photo", name: "image", type: "pixel" }]);
  expect(docs[0].dirty).toBe(true);
  store.activateDoc(2);
  expect(store.state.dataSets).toEqual([{ image: "two.png" }]);
  expect(store.state.dataSetBaseDir).toBe("/job-2");
  store.activateDoc(1);
  expect(store.state.dataSets).toEqual([{ image: "one.png" }]);
  expect(store.state.variables[0].fit).toBe("conform");
});
