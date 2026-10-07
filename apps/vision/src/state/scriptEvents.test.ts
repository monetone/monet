import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@engine", () => ({ default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }), Engine: class Engine {} }));
const tauri = vi.hoisted(() => ({ enabled: false, target: "/out/poster.png" as string | null }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
  invoke: vi.fn(async () => new Uint8Array([7]).buffer),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(async () => tauri.target), open: vi.fn(async () => "/out") }));
vi.mock("@tauri-apps/plugin-fs", () => ({ mkdir: vi.fn(async () => {}) }));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));
import { open } from "@tauri-apps/plugin-dialog";
import { actions, batchProcess, closeDocumentTab, engine, exportSignedContentCredentials, exportZoomify, saveBytes, smart, store, toggleImageAssetsGenerator } from "./app";
import { atomicWriteBytes } from "./atomicWrite";
import { Store } from "./store";
import { SCRIPT_EVENTS_KEY, documentSaveEvent, loadScriptEventStore, runScriptEventBindings, serializeScriptEventStore, type ScriptEventStore } from "./scriptEvents";
// The dialog is the only editor; it writes this JSON through the store.
const seed = (value: ScriptEventStore) => cells.set(SCRIPT_EVENTS_KEY, serializeScriptEventStore(value));
let cells: Map<string, string>;
beforeEach(() => {
  cells = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => cells.get(k) ?? null, setItem: (k: string, v: string) => cells.set(k, v) });
  vi.spyOn(actions, "resolve").mockImplementation((reference) => reference.id ?? null);
  tauri.enabled = false;
  tauri.target = "/out/poster.png";
});
afterEach(() => { engine.engine = null; vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("document event completions", () => {
  it("stores all five events and filters malformed settings without failing startup", () => {
    const value = { enabled: true, bindings: [{ event: "exportDocument" as const, actionId: 3, actionName: "Publish" }] };
    seed(value);
    expect(loadScriptEventStore()).toEqual(value);
    const before = cells.get(SCRIPT_EVENTS_KEY);
    expect(() => seed({ enabled: true, bindings: [{ event: "wrong" as never }] })).toThrow();
    expect(cells.get(SCRIPT_EVENTS_KEY)).toBe(before);
    cells.set(SCRIPT_EVENTS_KEY, JSON.stringify({ enabled: true, bindings: [null, { event: "wrong" }] }));
    expect(loadScriptEventStore().bindings).toEqual([]);
  });
  it("raises Open from the Store only after a successful adoption", () => {
    const png = () => new Uint8Array([1]);
    const e = { export_channel_png: png, merge_channel_pngs: png, calculations_mask: png, encode_gray_png: png };
    const client = { onCommit: null, buildImage: vi.fn(() => ({})), e };
    const documents = new Store(client as never);
    const calls: string[] = [];
    const internal = documents as unknown as { addDoc(): void; docs: unknown[] };
    vi.spyOn(internal, "addDoc").mockImplementation(() => { calls.push("adopt"); });
    documents.onDocumentEvent = (event) => calls.push(event);
    documents.openImage(new Uint8Array([1]), "image.png");
    expect(calls).toEqual(["adopt", "openDocument"]);
    client.buildImage.mockImplementationOnce(() => { throw new Error("Invalid image"); });
    expect(() => documents.openImage(new Uint8Array(), "bad.png")).toThrow();
    expect(calls).toHaveLength(2);
    // Photoshop raises Open only for opened files: Contact Sheet and Picture
    // Package make documents (New), Split/Merge Channels and Calculations are
    // their own commands.
    calls.length = 0;
    documents.openImage(png(), "Contact Sheet.png", "newDocument");
    documents.openImage(png(), "silent.png", null);
    documents.splitChannels();
    internal.docs = ["Red", "Green", "Blue"].map((c) => ({ name: `x_${c}`, engine: { export_png: png } }));
    expect(documents.mergeChannels()).toBe(true);
    expect(documents.calculationsToDocument(0, 0, false, 0, 0, false, "normal", 100)).toBe(true);
    expect(calls).toEqual(["adopt", "newDocument", ...Array(6).fill("adopt")]);
    const app = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
    expect(app).toContain('"Picture Package.png", "newDocument");');
    expect(app).toContain('"Contact Sheet.png", "newDocument");');
  });
  it("raises Export only after a document download succeeds, excluding preset downloads", () => {
    const play = vi.spyOn(actions, "playNamed").mockResolvedValue(true);
    seed({ enabled: true, bindings: [{ event: "exportDocument", actionId: 1 }] });
    const click = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ click, remove: vi.fn() }), body: { appendChild: vi.fn() } });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() });
    engine.engine = {} as never;
    saveBytes("photo.png", new Uint8Array([1]), "image/png");
    expect(play).toHaveBeenCalledTimes(1);
    saveBytes("presets.json", new Uint8Array([1]), "application/json");
    expect(play).toHaveBeenCalledTimes(1);
    click.mockImplementationOnce(() => { throw new Error("Download failed"); });
    expect(() => saveBytes("photo.png", new Uint8Array([1]), "image/png")).toThrow();
    expect(play).toHaveBeenCalledTimes(1);
  });
  it("suppresses recursive events, including a delayed Save started by an action", async () => {
    let complete!: (ok: boolean) => void;
    const delayed = new Promise<boolean>((resolve) => { complete = resolve; });
    let saving: Promise<boolean> | undefined;
    const play = vi.spyOn(actions, "playNamed").mockImplementation(async () => {
      void runScriptEventBindings("saveDocument");
      saving = documentSaveEvent(() => delayed);
      return true;
    });
    seed({ enabled: true, bindings: [{ event: "saveDocument", actionId: 1 }] });
    await runScriptEventBindings("saveDocument");
    complete(true); await saving;
    expect(play).toHaveBeenCalledTimes(1);
  });
  it("does not emit Save on cancellation or failure", async () => {
    const play = vi.spyOn(actions, "playNamed").mockResolvedValue(true);
    seed({ enabled: true, bindings: [{ event: "saveDocument", actionId: 1 }] });
    await expect(documentSaveEvent(async () => false)).resolves.toBe(false);
    await expect(documentSaveEvent(async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    expect(play).not.toHaveBeenCalled();
    await expect(documentSaveEvent(async () => true)).resolves.toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });
});

// Desktop exports write through atomicWriteBytes, never saveBytes, so each one
// has to raise Export Document itself once its files are on disk.
describe("Export Document from desktop exports (#475)", () => {
  const bindExport = () => {
    seed({ enabled: true, bindings: [{ event: "exportDocument", actionId: 1 }] });
    return vi.spyOn(actions, "playNamed").mockResolvedValue(true);
  };
  const raised = (play: ReturnType<typeof bindExport>) => play.mock.calls.filter(([id]) => id === 1).length;
  beforeEach(() => {
    tauri.enabled = true;
    vi.stubGlobal("alert", vi.fn());
    vi.spyOn(store, "state", "get").mockReturnValue({ ...store.state, colorProfileAssigned: false, layers: [{ id: 3, name: "button.png" }] } as never);
    vi.spyOn(store, "activePath").mockReturnValue("/work/poster.psd");
  });

  it("raises once after a signed Content Credentials file is written, not when cancelled or failed", async () => {
    const play = bindExport();
    engine.engine = { export_png_with_icc: () => new Uint8Array([1]), c2pa_action_list: () => "[]" } as never;
    vi.spyOn(smart, "linkedObjects").mockReturnValue([]);
    await expect(exportSignedContentCredentials("poster.psd")).resolves.toBe(true);
    expect(atomicWriteBytes).toHaveBeenCalledWith("/out/poster.png", new Uint8Array([7]));
    expect(play).toHaveBeenCalledTimes(1);
    tauri.target = null;
    await expect(exportSignedContentCredentials("poster.psd")).resolves.toBe(false);
    tauri.target = "/out/poster.png";
    vi.mocked(atomicWriteBytes).mockRejectedValueOnce(new Error("disk full"));
    await expect(exportSignedContentCredentials("poster.psd")).resolves.toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("raises once for a Zoomify folder after its last file, not per tile or for a cancelled picker", async () => {
    const play = bindExport();
    engine.engine = { width: () => 600, height: () => 300, composite: () => {}, export_pyramid_tile_jpeg: () => new Uint8Array([1]) } as never;
    await exportZoomify("poster");
    const writes = vi.mocked(atomicWriteBytes).mock;
    expect(writes.calls.length).toBeGreaterThan(3);
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...writes.invocationCallOrder));
    vi.mocked(open).mockResolvedValueOnce(null);
    await exportZoomify("poster");
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("raises for each Batch output written to a destination folder", async () => {
    const play = bindExport();
    engine.engine = { export_png_with_icc: () => new Uint8Array([1]) } as never;
    vi.spyOn(store, "openDocIds").mockReturnValue([4, 5]);
    vi.spyOn(store, "docName").mockImplementation((id) => `shot${id}`);
    vi.spyOn(store, "activateDoc").mockImplementation((() => {}) as never);
    const result = await batchProcess({ source: "opened", actionId: 9, destDir: "/out", format: "png" });
    expect(result?.processed).toBe(2);
    expect(atomicWriteBytes).toHaveBeenCalledTimes(2);
    expect(raised(play)).toBe(2);
  });

  it("raises when Image Assets is switched on and writes, but not for the silent re-export after each edit", async () => {
    const play = bindExport();
    engine.engine = { export_layer_png: () => new Uint8Array([1]) } as never;
    vi.spyOn(store, "toggleGeneratorWatch").mockReturnValue(true);
    toggleImageAssetsGenerator();
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(atomicWriteBytes).toHaveBeenCalledWith("/work/poster-assets/button.png", new Uint8Array([1]));
    // A bound action that edits would otherwise re-trigger the watch forever.
    store.onGeneratorRun?.();
    await vi.waitFor(() => expect(atomicWriteBytes).toHaveBeenCalledTimes(2));
    await new Promise((done) => setImmediate(done));
    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe("Close Document (#475)", () => {
  const seedDocs = (docs: { id: number; name: string; dirty: boolean }[]) => { (store as unknown as { docs: typeof docs }).docs = docs; };
  afterEach(() => seedDocs([]));

  it("raises after the tab is removed, and not when the close is cancelled", async () => {
    seed({ enabled: true, bindings: [{ event: "closeDocument", actionId: 1 }] });
    const openAtEvent: number[][] = [];
    const play = vi.spyOn(actions, "playNamed").mockImplementation(async () => { openAtEvent.push(store.openDocIds()); return true; });
    const docs = [{ id: 1, name: "a.psd", dirty: false }, { id: 2, name: "b.psd", dirty: true }];
    seedDocs([...docs]);
    vi.spyOn(store, "state", "get").mockReturnValue({ ...store.state, documents: docs } as never);
    vi.stubGlobal("confirm", () => false);
    await expect(closeDocumentTab(2)).resolves.toBe(false);
    await new Promise((done) => setImmediate(done));
    expect(play).not.toHaveBeenCalled();
    expect(store.openDocIds()).toEqual([1, 2]);
    let step = 0;
    vi.stubGlobal("confirm", () => ++step === 2); // Don't Save: decline the save question, accept the discard
    await expect(closeDocumentTab(2)).resolves.toBe(true);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(openAtEvent).toEqual([[1]]);
  });
});
