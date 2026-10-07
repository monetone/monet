// Droplets (#469): images dropped together with a droplet descriptor — on the
// window, or on the macOS droplet app, which hands both to Vision as one OS
// open — run the droplet's batch instead of opening as documents, with the
// Batch dialog's progress, Cancel and summary. `monet-vision droplet.json a.png`
// runs it as a command-line job. Driven through the real runner with the
// engine, Tauri and the disk mocked out.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@engine", () => ({ default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }), Engine: class Engine {} }));
const tauri = vi.hoisted(() => ({ enabled: true }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/api/path", () => ({ downloadDir: vi.fn(async () => "/Users/me/Downloads") }));
const disk = vi.hoisted(() => ({
  texts: {} as Record<string, string>,
  folders: {} as Record<string, string[]>,
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  stat: vi.fn(async (path: string) => ({ isDirectory: path in disk.folders, isFile: !(path in disk.folders) })),
  readDir: vi.fn(async (path: string) => disk.folders[path].map((name) => ({ name, isFile: true, isDirectory: false }))),
}));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));
vi.mock("./nativeBoundedRead", () => ({
  readNativeFileBounded: vi.fn(async (path: string) => new TextEncoder().encode(disk.texts[path] ?? "\x01\x02\x03\x04")),
}));
import { actions, dropletRun, engine, openDroppedFiles, openDroppedPaths, runCliJob, store } from "./app";
import { atomicWriteBytes } from "./atomicWrite";

const DROPLET = JSON.stringify({ actionName: "Invert", format: "png", template: "{name}_web", destDir: "/out", stopOnError: false });

let cells: Map<string, string>;
let opened: string[];
beforeEach(() => {
  cells = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => cells.get(k) ?? null, setItem: (k: string, v: string) => cells.set(k, v) });
  vi.stubGlobal("alert", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
  tauri.enabled = true;
  disk.texts = { "/drops/Resize.json": DROPLET, "/in/package.json": JSON.stringify({ name: "package", format: "png" }) };
  disk.folders = { "/in/more": ["c.png", "notes.txt"], "/out": [] };
  engine.engine = { export_png_with_icc: vi.fn(() => new Uint8Array([9])), layer_count: () => 1, width: () => 0, height: () => 0 } as never;
  opened = [];
  vi.spyOn(store, "openImage").mockImplementation(((_bytes: Uint8Array, name: string) => { opened.push(name); }) as never);
  vi.spyOn(store, "assignProfile").mockImplementation(() => {});
  vi.spyOn(store, "markProfileUntagged").mockImplementation(() => {});
  vi.spyOn(store, "setActivePath").mockImplementation(() => {});
});
afterEach(() => {
  actions.clearNamed();
  engine.engine = null;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Open documents as the store would keep them: the user's `names`, plus one
 *  per image a run opens (store.openImage), gone again once closed. */
function fakeDocuments(names: string[]) {
  let next = 100;
  let docs = names.map((name, i) => ({ id: i + 1, name }));
  let active = docs.at(-1)?.id ?? -1;
  const real = store.state;
  vi.spyOn(store, "state", "get").mockImplementation(() => ({ ...real, activeDocId: active, documents: docs }) as never);
  vi.spyOn(store, "openDocIds").mockImplementation(() => docs.map((d) => d.id));
  vi.spyOn(store, "docDirty").mockReturnValue(true); // each played action left its image edited
  vi.spyOn(store, "openImage").mockImplementation(((_bytes: Uint8Array, name: string) => {
    opened.push(name);
    docs = [...docs, { id: next, name }];
    active = next++;
  }) as never);
  vi.spyOn(store, "closeDoc").mockImplementation((id) => { docs = docs.filter((d) => d.id !== id); });
  return () => docs.map((d) => d.name);
}

/** The saved "Invert" action, observed rather than run. */
function mockAction() {
  vi.spyOn(actions, "resolve").mockImplementation((reference) => (reference.name === "Invert" ? 9 : null));
  return vi.spyOn(actions, "playNamed").mockImplementation(async () => true);
}
const written = () => vi.mocked(atomicWriteBytes).mock.calls.map(([path]) => path);

describe("a droplet dropped or opened with images runs over them", () => {
  it("runs the batch over the other paths and folders, wherever the descriptor is, instead of opening documents", async () => {
    const play = mockAction();
    const request = vi.spyOn(store, "requestDialog");
    await openDroppedPaths(["/in/a.png", "/drops/Resize.json", "/in/more"]);
    expect(request).toHaveBeenCalledWith("dropletRun");
    expect(play).toHaveBeenCalledTimes(2);
    expect(written()).toEqual(["/out/a_web.png", "/out/c_web.png"]); // the folder's image, not its notes
    expect(opened).toEqual(["a.png", "c.png"]); // each input only as a batch step
    expect(dropletRun()).toEqual({ name: "Resize", abort: null, status: "Processed 2 of 2: a.png, c.png", error: undefined });
  });

  it("opens plain files, and JSON that is not a droplet, as documents", async () => {
    const play = mockAction();
    const request = vi.spyOn(store, "requestDialog");
    await openDroppedPaths(["/in/a.png", "/in/package.json"]);
    expect(opened).toEqual(["a.png", "package.json"]); // never dropped silently: it opens, or reports why not
    expect(request).not.toHaveBeenCalledWith("dropletRun");
    expect(play).not.toHaveBeenCalled();
    expect(written()).toEqual([]);
  });

  it("routes browser File drops the same way", async () => {
    tauri.enabled = false;
    const downloads: string[] = [];
    vi.stubGlobal("document", {
      body: { appendChild: vi.fn() },
      createElement: () => ({ download: "", click() { downloads.push(this.download); }, remove: vi.fn() }),
    });
    const play = mockAction();
    const file = (name: string, text = "\x01\x02\x03\x04") => new File([text], name, { type: "image/png" });
    await openDroppedFiles([file("Web.json", DROPLET), file("a.png")]);
    expect(play).toHaveBeenCalledOnce();
    expect(dropletRun()).toMatchObject({ name: "Web", status: "Processed 1 of 1: a.png" });
    expect(downloads).toEqual(["a_web.png"]); // the browser has no folder to write to

    await openDroppedFiles([file("b.png"), file("other.json", "{}")]);
    expect(opened).toEqual(["a.png", "b.png", "other.json"]);
    expect(play).toHaveBeenCalledOnce(); // the plain drop opened, with no batch
  });

  it("shows n of N per file, and Cancel stops after the current one", async () => {
    const statuses: string[] = [];
    vi.spyOn(store, "bump").mockImplementation(() => { statuses.push(dropletRun()?.status ?? ""); });
    mockAction().mockImplementationOnce(async () => { dropletRun()?.abort?.abort(); return true; });
    await openDroppedPaths(["/drops/Resize.json", "/in/a.png", "/in/b.png"]);
    expect(statuses).toContain("1 of 2 — a.png");
    expect(dropletRun()).toMatchObject({ abort: null, status: "Processed 1 of 2 — cancelled: a.png" });
    expect(written()).toEqual(["/out/a_web.png"]);
  });

  // Photoshop closes each file once its copy is in the destination folder;
  // before, a 20-image drop left 20 unsaved documents open (#469).
  it("closes each image once its output is written, without asking, and leaves the user's documents open", async () => {
    const names = fakeDocuments(["mine.psd"]);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    mockAction();
    await openDroppedPaths(["/drops/Resize.json", "/in/a.png", "/in/more"]);
    expect(opened).toEqual(["a.png", "c.png"]);
    expect(written()).toEqual(["/out/a_web.png", "/out/c_web.png"]);
    expect(names()).toEqual(["mine.psd"]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("refuses a droplet whose action or destination folder is gone, and one with nothing to process, opening nothing", async () => {
    mockAction();
    vi.spyOn(actions, "list").mockReturnValue([{ id: 9, name: "Invert", set: "Default Actions" }] as never);
    disk.texts["/drops/Old.json"] = JSON.stringify({ actionName: "Deleted", format: "png", template: "", stopOnError: false });
    await openDroppedPaths(["/drops/Old.json", "/in/a.png"]);
    expect(dropletRun()).toMatchObject({
      status: "",
      error: `The droplet's action "Deleted" is not saved in Vision any more; saved actions: Default Actions/Invert. Nothing was run.`,
    });
    disk.texts["/drops/Moved.json"] = JSON.stringify({ actionName: "Invert", format: "png", template: "", destDir: "/gone", stopOnError: false });
    await openDroppedPaths(["/drops/Moved.json", "/in/a.png"]);
    expect(dropletRun()).toMatchObject({ status: "", error: "Destination folder /gone doesn't exist. Nothing was run." });
    disk.folders["/in/empty"] = [];
    await openDroppedPaths(["/drops/Resize.json", "/in/empty"]);
    expect(dropletRun()).toMatchObject({ status: "", error: "There were no images to process — drop image files or folders on the droplet." });
    expect(opened).toEqual([]);
    expect(written()).toEqual([]);
  });
});

describe("monet-vision droplet.json images… (command line)", () => {
  it("runs the droplet and reports a summary and status", async () => {
    mockAction();
    await expect(runCliJob({ droplet: "/drops/Resize.json", inputs: ["/in/a.png", "/in/more"] }))
      .resolves.toEqual({ code: 0, stdout: "2 processed", stderr: "" });
    expect(written()).toEqual(["/out/a_web.png", "/out/c_web.png"]);
  });

  it("writes to Downloads when the droplet names no folder, and fails when a file fails", async () => {
    mockAction();
    disk.texts["/drops/Resize.json"] = JSON.stringify({ actionName: "Invert", format: "png", template: "{name}", stopOnError: false });
    vi.mocked(atomicWriteBytes).mockRejectedValueOnce(new Error("disk full"));
    const result = await runCliJob({ droplet: "/drops/Resize.json", inputs: ["/in/a.png", "/in/b.png"] });
    expect(result).toMatchObject({ code: 1, stdout: "1 processed" });
    expect(result.stderr).toContain("a.png: disk full");
    expect(written()).toEqual(["/Users/me/Downloads/a.png", "/Users/me/Downloads/b.png", "/Users/me/Downloads/Batch Log.txt"]);
  });

  // Bad input exits 2 before anything opens, as --play-action … --batch does (#468).
  it("exits 2 for a descriptor that is not a droplet, a gone action or folder, or nothing to process", async () => {
    mockAction();
    await expect(runCliJob({ droplet: "/in/package.json", inputs: ["/in/a.png"] }))
      .resolves.toEqual({ code: 2, stdout: "", stderr: "/in/package.json is not a Monet droplet." });
    disk.texts["/drops/Old.json"] = JSON.stringify({ actionName: "Deleted", format: "png", template: "", stopOnError: false });
    const gone = await runCliJob({ droplet: "/drops/Old.json", inputs: ["/in/a.png"] });
    expect(gone).toMatchObject({ code: 2, stdout: "" });
    expect(gone.stderr).toContain(`The droplet's action "Deleted" is not saved in Vision any more`);
    disk.texts["/drops/Moved.json"] = JSON.stringify({ actionName: "Invert", format: "png", template: "", destDir: "/gone", stopOnError: false });
    await expect(runCliJob({ droplet: "/drops/Moved.json", inputs: ["/in/a.png"] }))
      .resolves.toEqual({ code: 2, stdout: "", stderr: "Destination folder /gone doesn't exist. Nothing was run." });
    disk.folders["/in/empty"] = [];
    await expect(runCliJob({ droplet: "/drops/Resize.json", inputs: ["/in/empty"] }))
      .resolves.toEqual({ code: 2, stdout: "", stderr: "No images were processed from /in/empty" });
    expect(opened).toEqual([]);
    expect(written()).toEqual([]);
  });
});
