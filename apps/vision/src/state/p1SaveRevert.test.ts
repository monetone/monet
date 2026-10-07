// #546 a masked JPEG must not be overwritten and marked saved.
// #545 a payload bigger than the format's open limit must not be written.
// #548 Revert keeps .mvis document meta and .mvision smart links, and Undo
// puts the pre-revert pixels back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initMonetFormat, writeContainer, type MonetContainer } from "@monet-ui/monet-format";

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
vi.mock("./nativeBoundedRead", () => ({ readNativeFileBounded: vi.fn() }));

import {
  documentSaveIo,
  engine,
  revertDocument,
  saveDocument,
  setDocumentNoticeSink,
  store,
} from "./app";
import { atomicWriteBytes } from "./atomicWrite";
import { flatLayerProbe } from "./flatLayerProbe";
import { readNativeFileBounded } from "./nativeBoundedRead";
import { VISION_CONTAINER_APP, VISION_DOCUMENT_ENTRY_PATH, VISION_DOCUMENT_ROLE } from "./nativeIoPolicy";
import { encodeDocumentMetaBytes, encodeProjectEnvelope } from "./projectEnvelope";
import { MAX_PROJECT_ENVELOPE_BYTES } from "./projectEnvelope";
import { clearSmartLinksForDoc, listSmartLinks } from "./smartLinks";
import { LAYER_KIND } from "./engineContracts";
import { Store } from "./store";

function installStorage(): void {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
}

/** Enough of a document for the layer thumbnail the store builds on sync. */
function installDom(): void {
  const ctx = {
    drawImage() {}, putImageData() {},
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
  const g = globalThis as Record<string, unknown>;
  g.document = {
    body: { appendChild() {} },
    createElement: () => ({
      width: 0, height: 0, style: {},
      getContext: () => ctx,
      toDataURL: () => "data:image/png;base64,AA",
      remove() {},
    }),
  };
}

function fakeEngine(overrides: Record<string, unknown> = {}) {
  const target: Record<string, unknown> = {
    ...flatLayerProbe(),
    layer_count: () => 1,
    width: () => 64,
    height: () => 64,
    export_png_with_icc: () => new Uint8Array([137, 80, 78, 71]),
    save_project: () => new Uint8Array([1]),
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

function openDirtyFile(name: string, overrides: Record<string, unknown> = {}): number {
  vi.spyOn(engine, "buildNew").mockReturnValue(fakeEngine(overrides) as never);
  store.newDocument(64, 64, name);
  store.setDocPath(store.state.activeDocId, `/docs/${name}`);
  store.markDirty();
  return store.state.activeDocId;
}

describe("Save refuses a flatten and an oversized payload (#546, #545)", () => {
  let alerts: string[];

  beforeEach(() => {
    installStorage();
    installDom();
    alerts = [];
    vi.stubGlobal("alert", (message: string) => alerts.push(message));
    tauri.enabled = true;
    dialog.target = null;
    vi.mocked(atomicWriteBytes).mockClear();
  });
  afterEach(() => {
    tauri.enabled = false;
    dialog.target = null;
    engine.engine = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes a plain PNG in place and clears the dirty flag", async () => {
    const id = openDirtyFile("flat.png");

    expect(await saveDocument()).toBe(true);

    expect(vi.mocked(atomicWriteBytes).mock.calls.map((c) => c[0])).toEqual(["/docs/flat.png"]);
    expect(store.docDirty(id)).toBe(false);
    expect(alerts).toEqual([]);
  });

  it("does not overwrite a masked JPEG or mark it saved", async () => {
    const id = openDirtyFile("masked.jpg", { layer_has_mask: () => true });

    expect(await saveDocument()).toBe(false);

    expect(atomicWriteBytes).not.toHaveBeenCalled();
    expect(store.docDirty(id)).toBe(true);
  });

  it("refuses a .mvision one byte over the open limit without writing", async () => {
    const id = openDirtyFile("big.mvision");
    vi.spyOn(documentSaveIo, "bytesForExt").mockResolvedValue({
      bytes: { byteLength: MAX_PROJECT_ENVELOPE_BYTES + 1 } as Uint8Array,
      mime: "application/json",
    });

    expect(await saveDocument()).toBe(false);

    expect(atomicWriteBytes).not.toHaveBeenCalled();
    expect(store.docDirty(id)).toBe(true);
    expect(alerts.join("\n")).toContain("too large to save as .mvision");
    expect(alerts.join("\n")).toContain("Save as .mvis or PSB instead.");
  });

  it("rewrites the engine's internal size error into that same sentence", async () => {
    openDirtyFile("big.mvision");
    vi.spyOn(documentSaveIo, "bytesForExt").mockRejectedValue(
      new Error("Monet Vision project engine exceeds the decoded size limit"),
    );

    expect(await saveDocument()).toBe(false);

    expect(atomicWriteBytes).not.toHaveBeenCalled();
    expect(alerts.join("\n")).toContain("This document is too large to save as .mvision. Save as .mvis or PSB instead.");
  });
});

function isolatedStore() {
  let tag = 0;
  const client = {
    onCommit: null as null | (() => void),
    engine: null as unknown,
    e: null as unknown,
    sync: () => {},
    commit: () => {},
    afterDocChange: () => {},
    setDisplayProfile() {},
    setIccProofLut() {},
    activate(eng: unknown) { this.engine = eng; this.e = eng; },
    buildNew() { const e = fakeEngine({ tag: () => tag }); this.engine = e; this.e = e; return e; },
    buildProject: (bytes: Uint8Array) => fakeEngine({ tag: () => bytes[0] ?? 0 }),
    projectBytes: (source?: unknown) => new Uint8Array([(source as { tag?: () => number } | undefined)?.tag?.() ?? tag]),
    docThumbUrl: () => "",
    layerThumbUrl: () => "",
  };
  const s = new Store(client as never);
  s.newDocument(8, 8, "shot.mvision");
  return { store: s, client, setTag: (next: number) => { tag = next; } };
}

describe("Revert is one Undo away (#548)", () => {
  beforeEach(() => { installStorage(); });

  it("restores the pre-revert pixels and the dirty flag", () => {
    const { store: s, client, setTag } = isolatedStore();
    setTag(7);
    s.markDirty();
    expect(s.captureRevertUndo()).toBe(true);

    s.revertActiveDoc(client.buildProject(new Uint8Array([3])) as never, null);
    s.syncFromEngine();

    expect((client.e as { tag: () => number }).tag()).toBe(3);
    expect(s.getSnapshot().canUndo).toBe(true);
    expect(s.getSnapshot().undoLabel).toBe("Revert");
    expect(s.getSnapshot().history).toEqual(["Revert"]);

    s.undo();
    s.syncFromEngine();

    expect((client.e as { tag: () => number }).tag()).toBe(7);
    expect(s.state.documents[0]?.dirty).toBe(true);
    expect(s.getSnapshot().canUndo).toBe(false);
  });
});

const savedMeta = {
  colorProfileAssigned: true,
  notes: [{ id: 1, x: 10, y: 20, text: "keep me", author: "me" }],
  guides: [{ o: "h" as const, p: 12, color: "#33aaff" }],
  layerComps: [{ name: "Comp", layers: [{ id: 1, visible: true, opacity: 100, blendMode: "normal" }] }],
  savedPaths: [{ name: "Path 1", path: [0, 0, 10, 0, 10, 10] }],
};

function documentContainer(): Uint8Array {
  const container: MonetContainer = {
    manifest: {
      format: "monet",
      schemaVersion: 1,
      app: VISION_CONTAINER_APP,
      kind: "graphics",
      entries: [
        { path: "graphics.json", role: "graphics" },
        { path: VISION_DOCUMENT_ENTRY_PATH, role: VISION_DOCUMENT_ROLE },
      ],
    },
    entries: [
      { path: "graphics.json", data: new TextEncoder().encode("{}") },
      { path: VISION_DOCUMENT_ENTRY_PATH, data: encodeDocumentMetaBytes(savedMeta) },
    ],
  };
  return writeContainer(container);
}

describe("Revert reloads the saved document, not just its pixels (#548)", () => {
  const read = vi.mocked(readNativeFileBounded);

  beforeEach(() => {
    installStorage();
    installDom();
    tauri.enabled = true;
    setDocumentNoticeSink(null);
  });
  afterEach(() => {
    tauri.enabled = false;
    engine.engine = null;
    setDocumentNoticeSink(null);
    vi.restoreAllMocks();
  });

  it("keeps guides, notes, comps, and paths from a .mvis", async () => {
    await initMonetFormat();
    const id = openDirtyFile("album.mvis");
    store.setGuides([{ o: "v", p: 1, color: "#ff0000" }]);
    read.mockResolvedValue(documentContainer());
    vi.spyOn(engine, "buildGraphics").mockReturnValue(fakeEngine() as never);

    await revertDocument();

    const snap = store.getSnapshot();
    expect(snap.notes.map((n) => n.text)).toEqual(["keep me"]);
    expect(snap.guides).toEqual(savedMeta.guides);
    expect(snap.layerComps.map((c) => c.name)).toEqual(["Comp"]);
    expect(snap.savedPaths).toEqual(savedMeta.savedPaths);
    expect(store.docDirty(id)).toBe(false);
  });

  it("restores the saved smart link from a .mvision", async () => {
    const id = openDirtyFile("linked.mvision");
    const envelope = encodeProjectEnvelope(new Uint8Array([9]), [{
      layerId: 11,
      name: "plate.png",
      path: "",
      missing: false,
      linkedAt: 1,
      updatedAt: 2,
    }]);
    read.mockResolvedValue(envelope);
    vi.spyOn(engine, "buildProject").mockReturnValue(fakeEngine({
      layer_id_at: () => 11,
      layer_kind: () => LAYER_KIND.smartObject,
    }) as never);
    clearSmartLinksForDoc(id);

    await revertDocument();

    expect(listSmartLinks(id).map((link) => link.name)).toEqual(["plate.png"]);
    clearSmartLinksForDoc(id);
  });
});
