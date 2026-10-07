// Guards #476: closing the last document leaves the store documentless — the
// UI shows the Home start screen there — instead of fabricating a blank
// "Untitled.psd"; and the recent-files list carries what Home's grid needs (a
// composite thumbnail + the time). The Home surface itself is covered by
// src/ui/home.test.ts and the shell wiring by src/ui/panelInventory.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

type Call = { m: string; args: unknown[] };

/** A recording stand-in for one wasm Engine: enough replies for addDoc +
 *  syncFromEngine to complete (mirrors liquifyStore.test's lifecycleEngine). */
function fakeEngine(layerIds = [1]) {
  const calls: Call[] = [];
  let profile = 0;
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
    assign_profile: (p) => { profile = Number(p); },
    doc_profile: () => profile,
  };
  const engine = new Proxy({} as Record<string, (...args: unknown[]) => unknown>, {
    get: (_t, prop: string) => (...args: unknown[]) => {
      calls.push({ m: prop, args });
      return replies[prop]?.(...args) ?? 0;
    },
  });
  return { engine, calls };
}

function makeStore(engineCount = 1) {
  const engines = Array.from({ length: engineCount }, () => fakeEngine());
  let next = 0;
  const client = {
    engine: null as ReturnType<typeof fakeEngine>["engine"] | null,
    onCommit: null as (() => void) | null,
    onSync: null as (() => void) | null,
    lastBrush: [] as number[],
    docGen: 0,
    get e() { if (!this.engine) throw new Error("Engine not ready"); return this.engine; },
    buildImage() { return engines[next++].engine; },
    buildNew() { return engines[next++].engine; },
    layerThumbUrl() { return ""; },
    docThumbUrl() { return "data:image/png;base64,thumb"; },
    setDisplayProfile() {},
    setIccProofLut() {},
    activate(engine: ReturnType<typeof fakeEngine>["engine"]) { this.engine = engine; this.docGen++; this.onSync?.(); },
    deactivate() { this.engine = null; this.docGen++; },
    sync() { this.onSync?.(); },
    blit() {},
    commit() { this.onCommit?.(); this.onSync?.(); return true; },
  };
  const store = new Store(client as never);
  client.onSync = () => store.syncFromEngine();
  return { store, client, engines };
}

describe("closing the last document (#476)", () => {
  it("starts with no document or active engine", () => {
    const { store, client } = makeStore();
    expect(store.state.documents).toEqual([]);
    expect(store.state.doc.width).toBe(0);
    expect(client.engine).toBeNull();
  });
  it("leaves the store documentless instead of fabricating an Untitled", () => {
    const { store, client } = makeStore();
    store.openImage(new Uint8Array(), "photo.png");
    const [id] = store.openDocIds();
    const generation = client.docGen;
    expect(store.state.ready).toBe(true);

    store.closeDoc(id);

    expect(store.openDocIds()).toEqual([]);
    expect(store.state.documents).toEqual([]);
    expect(store.state.activeDocId).toBe(-1);
    expect(store.state.ready).toBe(false);
    expect(store.state.doc).toEqual({ width: 0, height: 0, name: "" });
    expect(store.state.layers).toEqual([]);
    expect(client.engine).toBeNull();
    expect(client.docGen).toBe(generation + 1); // in-flight async jobs see the document go
    expect(() => client.e).toThrow("Engine not ready");
  });

  // Full Screen hides the menubar and exists to give the CANVAS the whole
  // window. Carrying it onto Home left no menubar, no canvas, and no way out:
  // the screen-mode commands are disabled with no document, and Home's keyboard
  // branch returns before Escape and F are handled.
  it("leaves Full Screen when the last document closes", () => {
    const { store } = makeStore();
    store.openImage(new Uint8Array(), "photo.png");
    store.setScreenMode("full");
    expect(store.state.screenMode).toBe("full");

    store.closeDoc(store.openDocIds()[0]);

    expect(store.state.screenMode, "Home is never the immersive canvas mode").toBe("standard");
  });

  it("brings the workspace back as soon as a document exists again", () => {
    const { store, client } = makeStore(2);
    store.openImage(new Uint8Array(), "photo.png");
    store.closeDoc(store.openDocIds()[0]);

    store.newDocument(64, 48, "Untitled");

    expect(store.state.documents.map((d) => d.name)).toEqual(["Untitled"]);
    expect(store.state.activeDocId).toBe(store.openDocIds()[0]);
    expect(store.state.ready).toBe(true);
    expect(store.state.doc.width).toBe(64);
    expect(client.engine).not.toBeNull();
  });

  it("still activates a neighbour when a non-last tab closes", () => {
    const { store } = makeStore(2);
    store.openImage(new Uint8Array(), "a.png");
    store.openImage(new Uint8Array(), "b.png");
    const [aId, bId] = store.openDocIds();
    store.closeDoc(bId);
    expect(store.openDocIds()).toEqual([aId]);
    expect(store.state.activeDocId).toBe(aId);
    expect(store.state.ready).toBe(true);
  });

  it("cancels an asynchronous proof bake when the last document closes", async () => {
    let resolve!: (response: { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }) => void;
    vi.stubGlobal("fetch", () => new Promise((done) => { resolve = done; }));
    try {
      const { store, engines } = makeStore();
      store.openImage(new Uint8Array(), "photo.png");
      store.setOptions({ proofMode: "cmyk", proofOn: true });
      store.refreshIccProof();
      store.closeDoc(store.openDocIds()[0]);
      resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(128) });
      await new Promise<void>((done) => setImmediate(done));
      expect(engines[0].calls.some((call) => call.m === "proof_lut")).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });

  it("keeps Color Settings chosen on Home for the next New document", () => {
    const { store, engines } = makeStore();
    const icc = new Uint8Array([1, 2, 3]);
    expect(() => store.assignProfile(2, icc, "Working RGB")).not.toThrow();
    expect(store.state.colorProfile).toBe(2);
    expect(store.state.documents).toEqual([]);
    store.newDocument(64, 48);
    expect(store.state.colorProfile).toBe(2);
    expect(store.state.iccProfileName).toBe("Working RGB");
    expect(engines[0].calls).toContainEqual({ m: "setDocumentIcc", args: [icc, "Working RGB"] });
  });

  it("can restore the spring-loaded tool after closing an Adjustment Brush document", () => {
    const { store } = makeStore();
    store.openImage(new Uint8Array(), "photo.png");
    store.setTool("adjustmentbrush");
    store.closeDoc(store.openDocIds()[0]);
    expect(() => store.setTool("brush")).not.toThrow();
    expect(store.state.tool).toBe("brush");
  });

  it("abandons every delayed Paste variant after the last document closes", async () => {
    try {
      for (const mode of ["paste", "pasteInPlace", "pasteInto"] as const) {
        let resolve!: (items: unknown[]) => void;
        vi.stubGlobal("navigator", { clipboard: { read: () => new Promise((done) => { resolve = done; }) } });
        const { store, engines } = makeStore();
        store.openImage(new Uint8Array(), "photo.png");
        const pending = mode === "pasteInto" ? store.pasteInto(false) : store[mode]();
        store.closeDoc(store.openDocIds()[0]);
        resolve([]);
        await expect(pending).resolves.toBeUndefined();
        expect(engines[0].calls.some((call) => /^(paste|paste_in_place|paste_into|set_clipboard_from_image)$/.test(call.m))).toBe(false);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not adopt a delayed clipboard image after switching away and back", async () => {
    let resolve!: (items: unknown[]) => void;
    vi.stubGlobal("navigator", { clipboard: { read: () => new Promise((done) => { resolve = done; }) } });
    try {
      const { store, engines } = makeStore(2);
      store.openImage(new Uint8Array(), "a.png");
      store.openImage(new Uint8Array(), "b.png");
      const [a, b] = store.openDocIds();
      const pending = store.paste();
      store.activateDoc(a); store.activateDoc(b);
      resolve([{ types: ["image/png"], getType: async () => new Blob([new Uint8Array([1, 2, 3])]) }]);
      await pending;
      expect(engines.flatMap((e) => e.calls).some((call) => /^(paste|set_clipboard_from_image)$/.test(call.m))).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});

// #477: a Window ▸ Arrange float window is a view of its document, so it goes
// whichever way the document leaves — not only through File ▸ Close.
describe("a floated document's window goes with its document", () => {
  it("keeps a floated user New document when another New opens (#528)", () => {
    const { store } = makeStore(2);
    store.newDocument(64, 48, "vp-a");
    const [a] = store.openDocIds();
    store.floatDoc(a);
    expect(store.state.floatDocs).toEqual([a]);

    store.newDocument(64, 48, "vp-b");
    expect(store.openDocIds()).toContain(a);
    expect(store.state.floatDocs).toEqual([a]);
  });

  it("unfloats a closed document and keeps the others floated", () => {
    const { store } = makeStore(2);
    store.openImage(new Uint8Array(), "a.png");
    store.openImage(new Uint8Array(), "b.png");
    const [a, b] = store.openDocIds();
    store.floatAllDocs();
    store.closeDoc(a);
    expect(store.state.floatDocs).toEqual([b]);
  });
});

describe("recent files carry the Home grid's thumbnail and date (#476)", () => {
  const stored = new Map<string, string>();
  let quotaFull = false;
  beforeEach(() => {
    stored.clear();
    quotaFull = false;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => { if (quotaFull && v.includes("data:image")) throw new Error("QuotaExceededError"); stored.set(k, v); },
      removeItem: (k: string) => { stored.delete(k); },
    });
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("records the active document's composite thumbnail and the time, and persists both", () => {
    const { store } = makeStore();
    store.openImage(new Uint8Array(), "photo.png");
    store.setActivePath("/pics/photo.png");
    expect(store.state.recentFiles).toEqual([
      { name: "photo.png", path: "/pics/photo.png", thumb: "data:image/png;base64,thumb", openedAt: 1_700_000_000_000 },
    ]);
    expect(JSON.parse(stored.get("mv.recentFiles")!)).toEqual(store.state.recentFiles);

    // Reopening moves the entry to the top with a fresh thumbnail — no duplicate.
    store.recordRecentFile("/pics/other.png");
    store.recordRecentFile("/pics/photo.png");
    expect(store.state.recentFiles.map((r) => r.path)).toEqual(["/pics/photo.png", "/pics/other.png"]);
  });

  it("keeps names and paths when the thumbnails do not fit the storage quota", () => {
    const { store } = makeStore();
    store.openImage(new Uint8Array(), "photo.png");
    quotaFull = true;
    store.setActivePath("/pics/photo.png");
    expect(store.state.recentFiles[0].thumb).toBe("data:image/png;base64,thumb"); // this session still has it
    expect(JSON.parse(stored.get("mv.recentFiles")!)).toEqual([
      { name: "photo.png", path: "/pics/photo.png", openedAt: 1_700_000_000_000 },
    ]);
  });

  it("restores entries persisted before thumbnails existed", () => {
    stored.set("mv.recentFiles", JSON.stringify([{ name: "old.psd", path: "/old.psd" }]));
    const { store } = makeStore();
    store.loadRecentFiles();
    expect(store.state.recentFiles).toEqual([{ name: "old.psd", path: "/old.psd" }]);
  });

  it("ignores corrupt stored cards and invalid dates or thumbnail sources", () => {
    stored.set("mv.recentFiles", JSON.stringify([null, 1, { path: "/bad" },
      { name: "photo.png", path: "/photo.png", thumb: "https://example.com/pixel", openedAt: 1e20 },
    ]));
    const { store } = makeStore();
    store.loadRecentFiles();
    expect(store.state.recentFiles).toEqual([{ name: "photo.png", path: "/photo.png" }]);
    stored.set("mv.recentFiles", "{}");
    expect(() => store.loadRecentFiles()).not.toThrow();
  });
});
