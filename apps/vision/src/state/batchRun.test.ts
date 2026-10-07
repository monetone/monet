// File ▸ Automate ▸ Batch run options (#472): Destination None / Save and
// Close, Override Action "Save As" Commands, Starting serial #, Suppress File
// Open Options Dialogs, per-file progress and Cancel — driven through the real
// runner with the engine, Tauri and the disk mocked out.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@engine", () => ({ default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }), Engine: class Engine {} }));
const tauri = vi.hoisted(() => ({ enabled: false }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null), save: vi.fn(async () => null) }));
vi.mock("@tauri-apps/plugin-fs", () => ({}));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));
vi.mock("./nativeBoundedRead", () => ({ readNativeFileBounded: vi.fn(async () => new Uint8Array([1, 2, 3, 4])) }));
import { open } from "@tauri-apps/plugin-dialog";
import { actions, batchProcess, batchProcessFiles, engine, store } from "./app";
import { IF_OP } from "./actionSets";
import { atomicWriteBytes } from "./atomicWrite";
import { BATCH_SERIAL_ERROR } from "./batchIo";
import { flatLayerProbe } from "./flatLayerProbe";

let cells: Map<string, string>;
beforeEach(() => {
  cells = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => cells.get(k) ?? null, setItem: (k: string, v: string) => cells.set(k, v) });
  tauri.enabled = false;
  engine.engine = { ...flatLayerProbe(), export_png_with_icc: vi.fn(() => new Uint8Array([9])), layer_count: () => 1, width: () => 8, height: () => 8 } as never;
});
afterEach(() => {
  actions.clearNamed();
  engine.engine = null;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Source = Opened Files over tabs 4 and 5. */
function openedDocs() {
  vi.spyOn(store, "openDocIds").mockReturnValue([4, 5]);
  vi.spyOn(store, "docName").mockImplementation((id) => `shot${id}.png`);
  return vi.spyOn(store, "activateDoc").mockImplementation((() => {}) as never);
}
/** A saved action (id 9) whose playback is observed rather than run. */
function mockAction() {
  vi.spyOn(actions, "resolve").mockImplementation((reference) => reference.id ?? null);
  return vi.spyOn(actions, "playNamed").mockImplementation(async () => true);
}
const written = () => vi.mocked(atomicWriteBytes).mock.calls.map(([path]) => path);
function fileOf(name: string): File {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  return {
    name, size: bytes.length, lastModified: 0,
    slice: () => ({ arrayBuffer: async () => bytes.buffer }),
    arrayBuffer: async () => bytes.buffer,
  } as unknown as File;
}

describe("Batch Destination and Starting serial #", () => {
  it("Destination None plays the action on every file and writes nothing", async () => {
    openedDocs();
    const play = mockAction();
    const result = await batchProcess({ source: "opened", actionId: 9, destDir: "/out", destination: "none" });
    expect(result).toEqual({ processed: 2, errors: [], completed: ["shot4.png", "shot5.png"], cancelled: false });
    expect(play).toHaveBeenCalledTimes(2);
    expect((engine.engine as unknown as { export_png_with_icc: () => void }).export_png_with_icc).not.toHaveBeenCalled();
    expect(atomicWriteBytes).not.toHaveBeenCalled();
  });

  it("numbers Folder outputs from the Starting serial #", async () => {
    tauri.enabled = true;
    openedDocs();
    mockAction();
    await batchProcess({ source: "opened", actionId: 9, destDir: "/out", startSerial: 7 });
    expect(written()).toEqual(["/out/shot4_007_processed.png", "/out/shot5_008_processed.png"]);
  });

  it("refuses an invalid Starting serial # before any file is opened or played", async () => {
    tauri.enabled = true;
    const activate = openedDocs();
    const play = mockAction();
    for (const startSerial of [-1, 2.5, "abc"]) {
      await expect(batchProcess({ source: "opened", actionId: 9, destDir: "/out", startSerial })).resolves.toEqual({
        processed: 0, completed: [], cancelled: false, errors: [{ name: "Starting serial #", message: BATCH_SERIAL_ERROR }],
      });
    }
    expect(activate).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(atomicWriteBytes).not.toHaveBeenCalled();
  });
});

describe("Batch Override Action \"Save As\" Commands", () => {
  it("skips recorded saves and exports, inside a conditional branch too, only for a Folder destination", async () => {
    tauri.enabled = true;
    openedDocs();
    vi.spyOn(store, "openDocIds").mockReturnValue([4]);
    const adjust = vi.fn(), exportStep = vi.fn(), branchSave = vi.fn();
    actions.start();
    actions.record(branchSave, ["saveDocument", []]);
    actions.save("Branch save");
    actions.start();
    actions.record(adjust, ["adj.invert", []]);
    actions.record(exportStep, ["exportPNG", ["recorded.png"]]);
    // An unknown condition always takes the else branch.
    actions.record(() => {}, [IF_OP, ["noSuchCondition", "", "Branch save"]]);
    const id = actions.save("Publish");
    actions.stop();

    await batchProcess({ source: "opened", actionId: id, destDir: "/out", overrideSave: true });
    expect(adjust).toHaveBeenCalledTimes(1);
    expect(exportStep).not.toHaveBeenCalled();
    expect(branchSave).not.toHaveBeenCalled();

    await batchProcess({ source: "opened", actionId: id, destDir: "/out", overrideSave: false });
    expect(exportStep).toHaveBeenCalledTimes(1);
    expect(branchSave).toHaveBeenCalledTimes(1);

    // Without a Folder there is nothing to write instead, so the recorded writes stay.
    await batchProcess({ source: "opened", actionId: id, destination: "none", overrideSave: true });
    expect(adjust).toHaveBeenCalledTimes(3);
    expect(exportStep).toHaveBeenCalledTimes(2);
    expect(branchSave).toHaveBeenCalledTimes(2);
  });
});

describe("Batch progress and Cancel", () => {
  it("reports n of N per file, and Cancel stops after the current file", async () => {
    tauri.enabled = true;
    const activate = openedDocs();
    const abort = new AbortController();
    const progress: unknown[][] = [];
    const play = mockAction().mockImplementation(async () => { abort.abort(); return true; });
    const result = await batchProcess({
      source: "opened", actionId: 9, destDir: "/out", signal: abort.signal,
      onProgress: (...args) => progress.push(args),
    });
    expect(progress).toEqual([[1, 2, "shot4.png"]]);
    expect(result).toMatchObject({ processed: 1, errors: [], completed: ["shot4.png"], cancelled: true });
    // The current file finished whole: opened, played and written.
    expect(activate).toHaveBeenCalledTimes(1);
    expect(written()).toEqual(["/out/shot4_001_processed.png"]);

    play.mockImplementation(async () => true);
    progress.length = 0;
    await batchProcess({ source: "opened", actionId: 9, destination: "none", onProgress: (...args) => progress.push(args) });
    expect(progress).toEqual([[1, 2, "shot4.png"], [2, 2, "shot5.png"]]);
  });
});

describe("Batch Destination Save and Close", () => {
  function nativeDocument() {
    tauri.enabled = true;
    vi.stubGlobal("alert", vi.fn());
    vi.spyOn(console, "error").mockImplementation(() => {});
    const openImage = vi.spyOn(store, "openImage").mockImplementation(() => 0 as never);
    vi.spyOn(store, "assignProfile").mockImplementation(() => {});
    vi.spyOn(store, "markProfileUntagged").mockImplementation(() => {});
    vi.spyOn(store, "markActiveSaved").mockImplementation(() => {});
    let path: string | null = null;
    const setDocPath = vi.spyOn(store, "setDocPath").mockImplementation((_id, next) => { path = next; });
    vi.spyOn(store, "activePath").mockImplementation(() => path);
    vi.spyOn(store, "docContentRevision").mockReturnValue(3);
    vi.spyOn(store, "docDocumentMeta").mockReturnValue({ colorProfileAssigned: false } as never);
    vi.spyOn(store, "markDocSavedAtRevision").mockReturnValue(true);
    vi.spyOn(store, "docDirty").mockReturnValue(false);
    const closeDoc = vi.spyOn(store, "closeDoc").mockImplementation(() => {});
    vi.spyOn(store, "state", "get").mockReturnValue({ ...store.state, activeDocId: 6, documents: [{ id: 6, name: "a.png" }] } as never);
    return { openImage, setDocPath, closeDoc, play: mockAction() };
  }

  it("picks files natively, writes each back to its own path, then closes it", async () => {
    const { setDocPath, closeDoc, play } = nativeDocument();
    vi.mocked(open).mockResolvedValueOnce(["/src/a.png", "/src/notes.txt"] as never);
    const result = await batchProcess({ source: "files", actionId: 9, destination: "saveAndClose" });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
    expect(result).toMatchObject({ processed: 1, errors: [], completed: ["a.png"] });
    // The path is adopted before playback, so the action's edits stay dirty
    // until the save really succeeds.
    expect(setDocPath).toHaveBeenCalledWith(6, "/src/a.png");
    expect(setDocPath.mock.invocationCallOrder[0]).toBeLessThan(play.mock.invocationCallOrder[0]);
    expect(written()).toEqual(["/src/a.png"]);
    expect(closeDoc).toHaveBeenCalledWith(6);
  });

  it("leaves a document open when its save fails, and honours Stop For Errors", async () => {
    const { openImage, closeDoc } = nativeDocument();
    vi.mocked(open).mockResolvedValueOnce(["/src/a.png", "/src/b.png"] as never);
    vi.mocked(atomicWriteBytes).mockRejectedValueOnce(new Error("disk full"));
    const result = await batchProcess({ source: "files", actionId: 9, destination: "saveAndClose", stopOnError: true });
    expect(result).toMatchObject({ processed: 0, completed: [], errors: [{ name: "a.png", message: "could not be saved — it was left open" }] });
    expect(closeDoc).not.toHaveBeenCalled();
    expect(openImage).toHaveBeenCalledTimes(1);
  });
});

describe("Batch Suppress File Open Options Dialogs", () => {
  it("develops a RAW with its own recipe instead of waiting on the Camera Raw workspace", async () => {
    const recipe = { version: 2 };
    vi.spyOn(store, "openRaw").mockReturnValue("camera-raw-1");
    vi.spyOn(store, "cameraRawSession").mockReturnValue({ session: { source: { recipe } } } as never);
    const complete = vi.spyOn(store, "completeCameraRawOpen").mockReturnValue(3);
    vi.spyOn(store, "getSnapshot").mockReturnValue({
      ...store.getSnapshot(), pendingDialog: { name: "cameraRaw", arg: { sessionId: "camera-raw-1" }, serial: 5 },
    });
    const clear = vi.spyOn(store, "clearPendingDialog").mockImplementation(() => {});
    const wait = vi.spyOn(store, "waitForCameraRawSession").mockResolvedValue("cancelled");
    const raw = fileOf("shot.dng");

    expect(await batchProcessFiles([raw], undefined, "png", { destination: "none", suppressOpenDialogs: true })).toBe(1);
    expect(complete).toHaveBeenCalledWith("camera-raw-1", recipe, false);
    expect(clear).toHaveBeenCalledWith(5);
    expect(wait).not.toHaveBeenCalled();

    // A session that cannot complete here (another workspace is up), or no
    // Suppress at all, still waits on the user's Camera Raw choice.
    complete.mockReturnValueOnce(null);
    expect(await batchProcessFiles([raw], undefined, "png", { destination: "none", suppressOpenDialogs: true })).toBe(0);
    expect(await batchProcessFiles([raw], undefined, "png", { destination: "none" })).toBe(0);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

// Photoshop closes each file once Batch has saved its copy to the Folder, so a
// big batch doesn't pile up open documents (#469). Destination None leaves
// them open, and a document the user already had open is never closed.
describe("Batch closes the files it opened once their output is in the Folder", () => {
  function documents(names: string[]) {
    tauri.enabled = true;
    vi.stubGlobal("alert", vi.fn());
    vi.spyOn(console, "error").mockImplementation(() => {});
    let next = 100;
    let docs = names.map((name, i) => ({ id: i + 1, name }));
    let active = docs.at(-1)?.id ?? -1;
    const real = store.state;
    vi.spyOn(store, "state", "get").mockImplementation(() => ({ ...real, activeDocId: active, documents: docs }) as never);
    vi.spyOn(store, "openDocIds").mockImplementation(() => docs.map((d) => d.id));
    vi.spyOn(store, "docName").mockImplementation((id) => docs.find((d) => d.id === id)?.name ?? null);
    vi.spyOn(store, "activateDoc").mockImplementation(((id: number) => { active = id; }) as never);
    vi.spyOn(store, "docDirty").mockReturnValue(true);
    vi.spyOn(store, "assignProfile").mockImplementation(() => {});
    vi.spyOn(store, "markProfileUntagged").mockImplementation(() => {});
    vi.spyOn(store, "setActivePath").mockImplementation(() => {});
    vi.spyOn(store, "openImage").mockImplementation(((_bytes: Uint8Array, name: string) => {
      docs = [...docs, { id: next, name }];
      active = next++;
    }) as never);
    vi.spyOn(store, "closeDoc").mockImplementation((id) => { docs = docs.filter((d) => d.id !== id); });
    mockAction();
    return () => docs.map((d) => d.name);
  }

  it("Folder closes each picked file after writing it, without asking", async () => {
    const names = documents(["mine.psd"]);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    vi.mocked(open).mockResolvedValueOnce(["/src/a.png", "/src/b.png"] as never);
    const result = await batchProcess({ source: "files", actionId: 9, destDir: "/out" });
    expect(result).toMatchObject({ processed: 2, errors: [] });
    expect(written()).toEqual(["/out/a_001_processed.png", "/out/b_002_processed.png"]);
    expect(names()).toEqual(["mine.psd"]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("Destination None leaves each file open, and Opened Files stay open under Folder", async () => {
    const names = documents(["mine.psd"]);
    vi.mocked(open).mockResolvedValueOnce(["/src/a.png"] as never);
    await batchProcess({ source: "files", actionId: 9, destination: "none" });
    expect(names()).toEqual(["mine.psd", "a.png"]);

    await batchProcess({ source: "opened", actionId: 9, destDir: "/out" });
    expect(written()).toEqual(["/out/mine_001_processed.png", "/out/a_002_processed.png"]);
    expect(names()).toEqual(["mine.psd", "a.png"]);
  });

  it("leaves a file open when its output could not be written", async () => {
    const names = documents([]);
    vi.mocked(open).mockResolvedValueOnce(["/src/a.png"] as never);
    vi.mocked(atomicWriteBytes).mockRejectedValueOnce(new Error("disk full"));
    const result = await batchProcess({ source: "files", actionId: 9, destDir: "/out" });
    expect(result).toMatchObject({ processed: 0, errors: [{ name: "a.png", message: "disk full" }] });
    expect(names()).toEqual(["a.png"]);
  });
});
