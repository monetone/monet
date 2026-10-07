// Two "the document silently lost its identity" regressions, driven through the
// real code rather than read out of the source:
//
//   #237 File ▸ Save a Copy… re-targeted the open tab at the copy, so every
//        later ⌘S wrote the copy and the original stopped receiving the work.
//   #27  Restoring a History snapshot cleared the dirty flag, so closing threw
//        the restored state away with no prompt — and dropped the crash-recovery
//        snapshot that would have saved it.
//   #511 Restoring a History snapshot replaced the document and wiped the linear
//        history with no way back, so one click discarded every edit since the
//        checkpoint. The engine has no in-place project load, so the restore
//        captures the pre-restore state as its own checkpoint first.
//
// The engine, storage and DOM are stubbed the way app.test.ts stubs them; the
// action layer and the store are what is under test.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: false }));
const dialog = vi.hoisted(() => ({ target: null as string | null }));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: async () => dialog.target, open: async () => null }));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));

import { actions, engine, saveDocumentAs, saveDocumentAsCopy, store } from "./app";
import { atomicWriteBytes } from "./atomicWrite";
import { flatLayerProbe } from "./flatLayerProbe";
import { Store } from "./store";

// ── Test doubles ─────────────────────────────────────────────────────────────

function installStorage(): Map<string, string> {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
  return cells;
}

/** A stand-in Engine: the handful of calls these paths really read, and 0 for
 *  everything else the store's resync pokes at. */
function fakeEngine(overrides: Record<string, unknown> = {}) {
  const target: Record<string, unknown> = {
    ...flatLayerProbe(),
    layer_count: () => 1, // flat → Save As can target a raster format
    export_png_with_icc: () => new Uint8Array([137, 80, 78, 71]),
    ...overrides,
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      if (typeof prop !== "string") return undefined;
      return () => 0;
    },
    has() { return true; },
  });
}

/** Canvas/anchor stand-ins: enough for the layer thumbnails the store resync
 *  builds and for the browser download the save path triggers. */
function installDom(): string[] {
  const downloads: string[] = [];
  const ctx = {
    drawImage() {}, putImageData() {},
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
  const g = globalThis as Record<string, unknown>;
  g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
  g.Blob = class { constructor(public parts: unknown[], public opts: unknown) {} };
  g.document = {
    body: { appendChild() {} },
    createElement: (tag: string) => {
      if (tag === "a") {
        const a = { href: "", download: "", style: {}, click: () => downloads.push(a.download), remove() {} };
        return a;
      }
      return {
        width: 0, height: 0, style: {},
        getContext: () => ctx,
        toDataURL: () => "data:image/png;base64,AA",
        toBlob: (cb: (b: unknown) => void, type: string) => cb({ type }),
        remove() {},
      };
    },
  };
  return downloads;
}

// ── #237 Save a Copy ─────────────────────────────────────────────────────────

describe("Save a Copy keeps the open document on its own path (#237)", () => {
  let downloads: string[];
  let savedIds: number[];
  let docId: number;

  /** Open a document with unsaved work in it and return its id. */
  function openDirtyDoc(layerCount = 1): number {
    vi.spyOn(engine, "buildNew").mockReturnValue(fakeEngine({ layer_count: () => layerCount }) as never);
    store.newDocument(8, 8, "shot.png");
    store.markDirty();
    return store.state.activeDocId;
  }

  beforeEach(() => {
    installStorage();
    downloads = installDom();
    savedIds = [];
    store.onDocSaved = (id) => savedIds.push(id);
    vi.mocked(atomicWriteBytes).mockClear();
  });
  afterEach(() => {
    store.onDocSaved = null;
    tauri.enabled = false;
    dialog.target = null;
    engine.engine = null;
    vi.restoreAllMocks();
  });

  it("writes the copy in the browser without marking the document saved", async () => {
    docId = openDirtyDoc();

    await saveDocumentAsCopy();
    expect(downloads).toEqual(["shot.png"]); // the copy really was produced…
    expect(savedIds).toEqual([]); // …and the document is still unsaved work

    await saveDocumentAs();
    expect(downloads).toEqual(["shot.png", "shot.png"]);
    expect(savedIds).toEqual([docId]); // only Save As clears the dirty flag
    expect(store.state.documents.find((d) => d.id === docId)?.dirty).toBe(false);
  });

  it("never re-targets the native document at the copy it just wrote", async () => {
    tauri.enabled = true;
    dialog.target = "/out/copy.png";
    docId = openDirtyDoc();
    const openedName = store.activeName();
    expect(store.activePath()).toBeNull();

    await saveDocumentAsCopy();
    expect(vi.mocked(atomicWriteBytes).mock.calls.map((c) => c[0])).toEqual(["/out/copy.png"]);
    expect(store.activePath()).toBeNull(); // the tab still has no file of its own
    expect(store.state.documents.find((d) => d.id === docId)?.name).toBe(openedName);
    expect(savedIds).toEqual([]);

    // Save As to the same destination is what DOES adopt it.
    await saveDocumentAs();
    expect(store.activePath()).toBe("/out/copy.png");
    expect(savedIds).toEqual([docId]);
  });

  it("treats a Save As that cannot round-trip the document as a copy too", async () => {
    // A layered document written to a flat format is an export, not a save:
    // adopting that path would point the next ⌘S at a file that cannot hold
    // the layers (saveAsIsCopy). Save a Copy behaves the same way by choice.
    tauri.enabled = true;
    dialog.target = "/out/flattened.png";
    openDirtyDoc(3); // three layers → PNG cannot carry the document

    await saveDocumentAs();
    expect(vi.mocked(atomicWriteBytes).mock.calls.map((c) => c[0])).toEqual(["/out/flattened.png"]);
    expect(store.activePath()).toBeNull();
    expect(savedIds).toEqual([]);
  });

  it("records Save a Copy under its own replayable op, not Save As", async () => {
    openDirtyDoc();
    actions.start();
    await saveDocumentAsCopy();
    actions.stop();
    expect(actions.count()).toBe(1);
    actions.save("Copy");

    const exported = actions.exportJson();
    expect(exported).toContain("saveDocumentAsCopy");
    expect(exported).not.toContain("saveDocumentAs\"");
  });
});

// The menu id → handler binding lives inside the App() component in App.tsx —
// the DOM/WASM app shell that vitest.config.ts excludes from the node run
// because it cannot be instantiated here. `savecopy: doSaveAs` is exactly how
// #237 shipped, so the binding keeps a source guard; everything it dispatches
// TO is exercised behaviourally above.
describe("the File menu reaches the copy entry point (#237)", () => {
  const uiSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

  it("binds savecopy to the copy handler, not Save As", () => {
    expect(uiSource).toContain("savecopy: doSaveCopy,");
    expect(uiSource).toContain("saveDocumentAsCopy()");
    expect(uiSource).not.toContain("savecopy: doSaveAs,");
  });
});

// ── #27 History snapshot restore ─────────────────────────────────────────────

/** A store wired to a fake engine client, so snapshots can be taken and
 *  restored for real without a WASM engine. `setTag` mutates the active
 *  document's engine tag, standing in for an edit between checkpoints. */
function isolatedStore() {
  let tag = 0;
  const client = {
    onCommit: null as null | (() => void),
    engine: null as unknown,
    e: null as unknown,
    sync: () => {},
    commit: () => {},
    afterDocChange: () => {},
    activate(eng: unknown) { this.engine = eng; this.e = eng; },
    buildNew() { const e = fakeEngine({ tag: () => tag }); this.engine = e; this.e = e; return e; },
    buildProject: (bytes: Uint8Array) => fakeEngine({ tag: () => bytes[0] }),
    projectBytes: (source?: unknown) => new Uint8Array([(source as { tag?: () => number } | undefined)?.tag?.() ?? tag]),
    docThumbUrl: () => "",
  };
  const s = new Store(client as never);
  s.newDocument(8, 8, "shot.psd");
  const saved: number[] = [];
  s.onDocSaved = (id) => saved.push(id);
  return { store: s, saved, client, setTag: (t: number) => { tag = t; } };
}

describe("Restoring a History snapshot leaves the document dirty (#27)", () => {
  beforeEach(() => { installStorage(); });

  it("keeps the document dirty after a snapshot restore", () => {
    const { store: s, saved } = isolatedStore();
    const snapId = s.takeSnapshot("Before");
    expect(snapId).toBeGreaterThan(0);
    s.markDirty(); // work done after the checkpoint

    s.restoreSnapshot(snapId);

    const doc = s.state.documents[0];
    expect(doc.dirty).toBe(true); // an in-memory checkpoint never matched disk
    expect(saved).toEqual([]); // …so the crash-recovery snapshot is kept
  });

  it("still comes back clean when the new state really is the file on disk", () => {
    // File ▸ Revert reloads from the saved file, so the default (no opts) path
    // must clear dirty and fire the save hook that drops the recovery snapshot.
    const { store: s, saved, client } = isolatedStore();
    s.markDirty();
    const id = s.openDocIds()[0];

    s.revertActiveDoc(client.buildProject(new Uint8Array([1])) as never, null);

    expect(s.state.documents[0].dirty).toBe(false);
    expect(saved).toEqual([id]);
  });

  it("swaps in the checkpoint's engine, so the restore is not a no-op", () => {
    const { store: s, client } = isolatedStore();
    const before = client.e;
    const snapId = s.takeSnapshot("Before");

    s.restoreSnapshot(snapId);

    expect(client.e).not.toBe(before); // the document now runs the snapshot's engine
    expect(s.getSnapshot().snapshots.map((r) => r.id)).toContain(snapId); // list preserved
  });
});

// ── #511 History snapshot restore is recoverable ─────────────────────────────

describe("Restoring a History snapshot keeps the pre-restore state recoverable (#511)", () => {
  beforeEach(() => { installStorage(); });

  it("captures the pre-restore state as a checkpoint before replacing the document", () => {
    const { store: s, client, setTag } = isolatedStore();
    const target = s.takeSnapshot("Checkpoint");
    setTag(1); // edits made after the checkpoint

    s.restoreSnapshot(target);

    expect(s.getSnapshot().snapshots.map((r) => r.name)).toContain('Before "Checkpoint"');
    expect((client.e as { tag: () => number }).tag()).toBe(0); // the checkpoint's engine
  });

  it("returns to the pre-restore document when that checkpoint is restored", () => {
    const { store: s, client, setTag } = isolatedStore();
    const target = s.takeSnapshot("Checkpoint");
    setTag(1); // edits made after the checkpoint
    s.restoreSnapshot(target);

    const recover = s.getSnapshot().snapshots.find((r) => r.name === 'Before "Checkpoint"');
    expect(recover).toBeDefined();
    s.restoreSnapshot(recover!.id);

    expect((client.e as { tag: () => number }).tag()).toBe(1); // back to the pre-restore state
  });
});
