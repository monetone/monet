// Window ▸ Arrange ▸ Match Zoom/Location/Rotation/All: pushes the active
// document's view onto every other open document (Photoshop's Match View
// family). Docs are seeded directly onto the private `docs` array — same
// idiom as saveRevision.test.ts's setupStore — since matchView only reads
// view fields, never the wasm engine.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, type AppSnapshot } from "./store";
import { docPointAt } from "./viewTransform";

interface SeedDocument {
  id: number;
  zoom: number;
  panX: number;
  panY: number;
  rotationAngle: number;
}

function setupStore(seed: SeedDocument[], activeId: number) {
  const client = { engine: null, onCommit: null, lastBrush: [] as number[] };
  const store = new Store(client as never);
  const internal = store as unknown as {
    docs: SeedDocument[];
    activeDocId: number;
    set: (patch: Partial<AppSnapshot>) => void;
  };
  internal.docs = seed;
  internal.activeDocId = activeId;
  const active = seed.find((d) => d.id === activeId)!;
  // The active document's live view lives in the reactive snapshot, not its
  // own DocEntry (see activateDoc/captureActiveView) — mirror that here.
  internal.set({ zoom: active.zoom, panX: active.panX, panY: active.panY, rotationAngle: active.rotationAngle });
  return { store, internal };
}

describe("Store.matchView", () => {
  const docA: SeedDocument = { id: 1, zoom: 2, panX: 10, panY: 20, rotationAngle: 45 };
  const docB: SeedDocument = { id: 2, zoom: 1, panX: 0, panY: 0, rotationAngle: 0 };
  const docC: SeedDocument = { id: 3, zoom: 0.5, panX: -5, panY: 7, rotationAngle: 90 };

  it("Match Zoom copies only zoom onto other documents", () => {
    const { store, internal } = setupStore([docA, { ...docB }, { ...docC }], 1);
    store.matchView({ zoom: true });
    expect(internal.docs[1]).toMatchObject({ zoom: 2, panX: 0, panY: 0, rotationAngle: 0 });
    expect(internal.docs[2]).toMatchObject({ zoom: 2, panX: -5, panY: 7, rotationAngle: 90 });
  });

  it("Match Location copies only pan onto other documents", () => {
    const { store, internal } = setupStore([docA, { ...docB }, { ...docC }], 1);
    store.matchView({ location: true });
    expect(internal.docs[1]).toMatchObject({ zoom: 1, panX: 10, panY: 20, rotationAngle: 0 });
    expect(internal.docs[2]).toMatchObject({ zoom: 0.5, panX: 10, panY: 20, rotationAngle: 90 });
  });

  it("Match Rotation copies only rotation onto other documents", () => {
    const { store, internal } = setupStore([docA, { ...docB }, { ...docC }], 1);
    store.matchView({ rotation: true });
    expect(internal.docs[1]).toMatchObject({ zoom: 1, panX: 0, panY: 0, rotationAngle: 45 });
    expect(internal.docs[2]).toMatchObject({ zoom: 0.5, panX: -5, panY: 7, rotationAngle: 45 });
  });

  it("Match All copies zoom, pan, and rotation onto other documents", () => {
    const { store, internal } = setupStore([docA, { ...docB }, { ...docC }], 1);
    store.matchView({ zoom: true, location: true, rotation: true });
    expect(internal.docs[1]).toMatchObject({ zoom: 2, panX: 10, panY: 20, rotationAngle: 45 });
    expect(internal.docs[2]).toMatchObject({ zoom: 2, panX: 10, panY: 20, rotationAngle: 45 });
  });

  it("never mutates the active document's own entry", () => {
    const { store, internal } = setupStore([{ ...docA }, { ...docB }, { ...docC }], 1);
    store.matchView({ zoom: true, location: true, rotation: true });
    expect(internal.docs[0]).toMatchObject(docA);
  });

  it("is a no-op for a single-document session", () => {
    const { store, internal } = setupStore([{ ...docA }], 1);
    expect(() => store.matchView({ zoom: true, location: true, rotation: true })).not.toThrow();
    expect(internal.docs[0]).toMatchObject(docA);
  });
});

describe("Store.matchView onto Window ▸ Arrange panes", () => {
  it("matches every open pane about its centre, leaving closed documents' panes alone", () => {
    const engine = { width: () => 200, height: () => 100 };
    const doc = { id: 1, zoom: 2, panX: 10, panY: 20, rotationAngle: 45, engine };
    const { store, internal } = setupStore([doc], 1);
    const pane = { zoom: 1, panX: 30, panY: 50, rotationAngle: 0, viewport: { w: 260, h: 200 } };
    internal.set({
      viewport: { w: 800, h: 600 },
      doc: { width: 200, height: 100, name: "a" },
      paneViews: { 1: pane, 9: pane },
    });
    store.matchView({ zoom: true, location: true, rotation: true });
    const matched = store.state.paneViews[1];
    expect(matched).toMatchObject({ zoom: 2, rotationAngle: 45, viewport: pane.viewport });
    // The canvas centre's document point sits at the pane centre.
    const want = docPointAt(store.state, 1, 200, 100, 400, 300);
    const got = docPointAt(matched, 1, 200, 100, 130, 100);
    expect(got.x).toBeCloseTo(want.x, 9);
    expect(got.y).toBeCloseTo(want.y, 9);
    expect(store.state.paneViews[9]).toBe(pane); // document 9 is not open
  });
});

