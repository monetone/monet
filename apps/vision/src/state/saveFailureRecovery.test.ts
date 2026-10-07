// A refused export must cost the user the export, never the document.
//
// The engine half of this is in raster/mod.rs: the PSD exports report their
// limit instead of throwing across the wasm boundary, which used to leave the
// borrow guard held and wedge that Engine for good. These are the two JS-side
// paths the same failure ran through: Save As reported nothing when the throw
// came from its prologue, and switching or closing a tab tore the document list
// in half when the outgoing engine refused to release its live edit.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => false, // the browser branch; the native one shares the prologue
}));

import { engine, saveDocumentAs, store as appStore } from "./app";
import { Store } from "./store";

/** An engine that refuses every call, the way a poisoned one does. */
const poisonedEngine = () => new Proxy({}, {
  get: () => () => { throw new Error("recursive use of an object detected"); },
});

afterEach(() => {
  engine.engine = null as never;
  (appStore as unknown as { docs: unknown[] }).docs = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Save As reports a failure from anywhere in the flow", () => {
  it("alerts when the engine throws before the export starts", async () => {
    engine.engine = poisonedEngine() as never; // layer_count() is its first call
    (appStore as unknown as { docs: unknown[] }).docs = [
      { id: 1, name: "wide.psd", dirty: true, contentRevision: 1, pristineBlank: false },
    ];
    const current = appStore.state;
    vi.spyOn(appStore, "state", "get").mockReturnValue({ ...current, activeDocId: 1 } as never);
    const alerts: string[] = [];
    vi.stubGlobal("alert", (message: string) => { alerts.push(message); });
    vi.spyOn(console, "error").mockImplementation(() => {});

    // The menu voids this promise, so a rejection is invisible to the user —
    // the failure has to come back as a reported outcome (#495).
    await expect(saveDocumentAs()).resolves.toBe(false);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("Could not save the document.");
  });
});

/** A recording stand-in for one wasm Engine (same shape as homeStart.test.ts). */
function fakeEngine(layerIds = [1]) {
  const replies: Record<string, (...args: unknown[]) => unknown> = {
    width: () => 64,
    height: () => 48,
    layer_count: () => layerIds.length,
    layer_id_at: (i) => layerIds[Number(i)],
    layer_kind: () => 0,
    layer_name: (id) => `Layer ${id}`,
    layer_visible: () => true,
    layer_locked: () => false,
    layer_opacity: () => 1,
    layer_fill_opacity: () => 1,
    layer_blend: () => 0,
    layer_has_mask: () => false,
    layer_mask_enabled: () => true,
    layer_has_effects: () => false,
    layer_clipping: () => false,
    layer_group: () => 0,
    active_layer_id: () => layerIds[0],
    history_labels: () => [] as string[],
    history_current: () => 0,
    artboard_ids: () => new Uint32Array(),
    doc_profile: () => 0,
  };
  return new Proxy({} as Record<string, (...args: unknown[]) => unknown>, {
    get: (_t, prop: string) => (...args: unknown[]) => replies[prop]?.(...args) ?? 0,
  });
}

describe("a throwing engine cannot wedge the document list", () => {
  /** Two open documents, the ACTIVE one holding an engine that refuses everything. */
  function twoDocsActivePoisoned() {
    const healthy = fakeEngine();
    const engines = [healthy, fakeEngine()];
    let next = 0;
    const client = {
      engine: null as unknown,
      onCommit: null as (() => void) | null,
      onSync: null as (() => void) | null,
      docGen: 0,
      get e() { if (!this.engine) throw new Error("Engine not ready"); return this.engine; },
      buildImage() { return engines[next++]; },
      buildNew() { return engines[next++]; },
      layerThumbUrl: () => "",
      docThumbUrl: () => "data:image/png;base64,thumb",
      setDisplayProfile() {},
      setIccProofLut() {},
      activate(next: unknown) { this.engine = next; this.docGen++; this.onSync?.(); },
      deactivate() { this.engine = null; this.docGen++; },
      sync() { this.onSync?.(); },
      blit() {},
      commit() { this.onCommit?.(); this.onSync?.(); return true; },
    };
    const store = new Store(client as never);
    client.onSync = () => store.syncFromEngine();
    store.openImage(new Uint8Array(), "healthy.png");
    store.openImage(new Uint8Array(), "poisoned.png");
    const [healthyId, poisonedId] = store.openDocIds();

    // Poison the active document's engine, exactly as a refused export did.
    const poisoned = poisonedEngine();
    const docs = (store as unknown as { docs: { id: number; engine: unknown }[] }).docs;
    docs.find((d) => d.id === poisonedId)!.engine = poisoned;
    client.engine = poisoned;
    return { store, client, healthy, healthyId, poisonedId };
  }

  it("still switches to another tab", () => {
    const { store, client, healthy, healthyId, poisonedId } = twoDocsActivePoisoned();

    expect(() => store.activateDoc(healthyId)).not.toThrow();

    expect(store.openDocIds()).toEqual([healthyId, poisonedId]);
    expect(client.engine).toBe(healthy); // the healthy document is live again
    expect(store.state.activeDocId).toBe(healthyId);
  });

  it("still closes the poisoned tab, leaving the list consistent", () => {
    const { store, healthyId, poisonedId } = twoDocsActivePoisoned();

    expect(() => store.closeDoc(poisonedId)).not.toThrow();

    expect(store.openDocIds()).toEqual([healthyId]);
    expect(store.state.documents.map((d) => d.id)).toEqual([healthyId]);
    expect(store.state.activeDocId).toBe(healthyId);
  });
});
