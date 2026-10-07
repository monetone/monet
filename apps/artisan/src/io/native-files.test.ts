// ─────────────────────────────────────────────────────────────
// io/native-files.test — native (Tauri) open/save + save-in-place
// ─────────────────────────────────────────────────────────────
// Inside Tauri, File ▸ Save must go through the native dialog + fs plugin, then
// write straight back to the same path on every later save. The path must NOT
// survive into a different document — otherwise ⌘S after File ▸ New or after
// importing an SVG would silently overwrite the document you had open before.

import { describe, it, expect, beforeEach, vi } from "vitest";

const ui = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  openFile: vi.fn<() => Promise<string | string[] | null>>(),
  saveFile: vi.fn<() => Promise<string | null>>(),
  ask: vi.fn<() => Promise<boolean>>(async () => true),
  message: vi.fn(async () => {}),
  // Writes go through the shared durable write (fully-synced sibling + rename),
  // so that is the seam a save is observed at — not plugin-fs.
  atomicWriteBytes: vi.fn<(path: string, bytes: Uint8Array) => Promise<void>>(async () => {}),
}));
vi.mock("@monet-ui/monet-react", () => ui);

const fs = vi.hoisted(() => ({
  writeTextFile: vi.fn(async () => {}),
  writeFile: vi.fn<(path: string, bytes: Uint8Array) => Promise<void>>(async () => {}),
  readFile: vi.fn<() => Promise<Uint8Array>>(),
}));
vi.mock("@tauri-apps/plugin-fs", () => fs);

// The wasm Engine cannot load in node; the container save only needs its writer.
// `initEngine` boots the render-engine wasm; the save path must await it or
// graphicsContainerFrom throws "the rendering engine is still loading".
const engine = vi.hoisted(() => ({ openGraphicsContainer: vi.fn(), graphicsContainerFrom: vi.fn(), initEngine: vi.fn(async () => {}) }));
vi.mock("../engine-rs/EngineClient", () => engine);

const { createContainer, initMonetFormat, readContainer, setEntry, writeContainer } = await import("@monet-ui/monet-format");
await initMonetFormat();

const { fileCommands } = await import("./commands");
const { ArtisanStore, IO, makeDocument } = await import("../engine");

const utf8 = (s: string) => new TextEncoder().encode(s);

/** The scene JSON inside the container bytes of the nth `writeFile` call. */
const savedScene = (call = 0): string => {
  const c = readContainer(ui.atomicWriteBytes.mock.calls[call][1]);
  return new TextDecoder().decode(c.entries.find((e) => e.path === "graphics.json")?.data);
};

beforeEach(() => {
  vi.clearAllMocks();
  ui.isTauri.mockReturnValue(true);
  ui.ask.mockResolvedValue(true);
  engine.graphicsContainerFrom.mockImplementation((sceneJson: string) => {
    const c = createContainer({ name: "monet-render-engine", version: "0.1.0" }, "graphics");
    setEntry(c, "graphics.json", "graphics", utf8(sceneJson));
    return writeContainer(c);
  });
});

describe("native save", () => {
  it("asks once, then writes in place on every later save", async () => {
    const store = new ArtisanStore();
    store.transact("edit", (d) => void (d.name = "Poster"));
    expect(store.filePath).toBeUndefined();

    ui.saveFile.mockResolvedValueOnce("/Users/x/Art/Poster.mart");
    await fileCommands.save(store);

    expect(ui.saveFile).toHaveBeenCalledTimes(1);
    expect(store.filePath).toBe("/Users/x/Art/Poster.mart");
    expect(store.getState().dirty).toBe(false);
    expect(ui.atomicWriteBytes).toHaveBeenCalledWith("/Users/x/Art/Poster.mart", expect.any(Uint8Array));
    expect(savedScene(0)).toContain("Poster");

    // Second save: no dialog, same path.
    store.transact("edit again", (d) => void (d.name = "Poster v2"));
    await fileCommands.save(store);
    expect(ui.saveFile).toHaveBeenCalledTimes(1);
    expect(ui.atomicWriteBytes).toHaveBeenLastCalledWith("/Users/x/Art/Poster.mart", expect.any(Uint8Array));
    expect(savedScene(1)).toContain("Poster v2");
    expect(store.getState().dirty).toBe(false);
  });

  it("keeps the document dirty and pathless when the dialog is cancelled", async () => {
    const store = new ArtisanStore();
    store.transact("edit", (d) => void (d.name = "Untitled"));
    ui.saveFile.mockResolvedValueOnce(null);

    await fileCommands.save(store);

    expect(ui.atomicWriteBytes).not.toHaveBeenCalled();
    expect(store.filePath).toBeUndefined();
    expect(store.getState().dirty).toBe(true);
  });

  it("surfaces a write failure instead of claiming the document is saved", async () => {
    const store = new ArtisanStore();
    store.transact("edit", (d) => void (d.name = "Poster"));
    ui.saveFile.mockResolvedValueOnce("/ro/Poster.mart");
    ui.atomicWriteBytes.mockRejectedValueOnce(new Error("permission denied"));

    await fileCommands.save(store);

    expect(ui.message).toHaveBeenCalledWith(expect.stringContaining("permission denied"), expect.objectContaining({ kind: "error" }));
    expect(store.getState().dirty).toBe(true);
  });

  it("stays dirty when the document changes during an in-flight save", async () => {
    const store = new ArtisanStore();
    store.markSaved("/Users/x/Art/Poster.artisan");
    store.transact("first edit", (d) => void (d.name = "Written snapshot"));
    let finishWrite!: () => void;
    ui.atomicWriteBytes.mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve; }));

    const saving = fileCommands.save(store);
    store.transact("edit during write", (d) => void (d.name = "Newer edit"));
    finishWrite();
    await saving;

    expect(new TextDecoder().decode(ui.atomicWriteBytes.mock.calls[0][1])).toContain("Written snapshot");
    expect(store.doc.name).toBe("Newer edit");
    expect(store.getState().dirty).toBe(true);
  });
});

describe("native open", () => {
  it("refuses New and Open when discarding dirty work is declined", async () => {
    const store = new ArtisanStore();
    store.transact("edit", (d) => void (d.name = "Keep Me"));
    ui.ask.mockResolvedValue(false);

    expect(await fileCommands.new(store)).toBe(false);
    expect(store.doc.name).toBe("Keep Me");

    const replacement = makeDocument("Replacement");
    ui.openFile.mockResolvedValueOnce("/Users/x/Art/Replacement.artisan");
    fs.readFile.mockResolvedValueOnce(utf8(IO.serializeDocument(replacement, true)));
    expect(await fileCommands.open(store)).toBe(false);
    expect(store.doc.name).toBe("Keep Me");
    expect(store.getState().dirty).toBe(true);
    expect(ui.ask).toHaveBeenCalledTimes(2);
  });

  it("re-checks for edits made while Open is awaiting the file", async () => {
    const store = new ArtisanStore();
    const replacement = makeDocument("Replacement");
    let finishRead!: (bytes: Uint8Array) => void;
    ui.openFile.mockResolvedValueOnce("/Users/x/Art/Replacement.artisan");
    fs.readFile.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    ui.ask.mockResolvedValue(false);

    const opening = fileCommands.open(store);
    await vi.waitFor(() => expect(fs.readFile).toHaveBeenCalled());
    store.transact("edit during picker", (d) => void (d.name = "Late Edit"));
    finishRead(utf8(IO.serializeDocument(replacement, true)));

    expect(await opening).toBe(false);
    expect(store.doc.name).toBe("Late Edit");
  });

  it("reads the picked path and remembers it for an .artisan document", async () => {
    const doc = makeDocument();
    doc.name = "Opened";
    ui.openFile.mockResolvedValueOnce("/Users/x/Art/Opened.artisan");
    fs.readFile.mockResolvedValueOnce(utf8(IO.serializeDocument(doc, true)));

    const store = new ArtisanStore();
    await fileCommands.open(store);

    expect(store.doc.name).toBe("Opened");
    expect(store.filePath).toBe("/Users/x/Art/Opened.artisan");
    expect(store.getState().dirty).toBe(false);
  });

  it("does not inherit the previous document's path (⌘S must not clobber it)", async () => {
    const store = new ArtisanStore();
    store.markSaved("/Users/x/Art/Previous.artisan");
    expect(store.filePath).toBe("/Users/x/Art/Previous.artisan");

    // Any fresh document — File ▸ New, or a non-native import — starts pathless.
    store.replaceDoc(makeDocument(), { markClean: true });

    expect(store.filePath).toBeUndefined();
  });
});
