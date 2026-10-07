// ─────────────────────────────────────────────────────────────
// io/container-courier.test — the universal container, rules 1 and 2
// ─────────────────────────────────────────────────────────────
// Artisan understands one slice of a Monet container: the graphics document.
// Everything else — a Rythme timeline, its audio, an unknown manifest field —
// must come back out of a save byte-for-byte, or a round trip through Artisan
// silently destroys the other app's work (docs/plans/11-universal-container.md).
// This is the check that fails if the courier stops couriering.
//
// The wasm Engine is not loadable in node, so `engine-rs/EngineClient` is
// stubbed with the smallest thing that behaves like it: a writer that emits its
// own graphics container, and a reader that hands back a vector scene.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { courierContainerSave } from "../../../vision/src/state/nativeIoPolicy";
import type { IoNotice } from "./commands";

const ui = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  openFile: vi.fn<() => Promise<string | string[] | null>>(),
  saveFile: vi.fn<() => Promise<string | null>>(),
  ask: vi.fn<() => Promise<boolean>>(async () => true),
  message: vi.fn(async () => {}),
  // Every write goes through the shared durable write now, so that — not
  // plugin-fs — is the seam a save is observed at.
  atomicWriteBytes: vi.fn<(path: string, bytes: Uint8Array) => Promise<void>>(async () => {}),
}));
vi.mock("@monet-ui/monet-react", () => ui);

const fs = vi.hoisted(() => ({
  writeTextFile: vi.fn(async () => {}),
  writeFile: vi.fn<(path: string, bytes: Uint8Array) => Promise<void>>(async () => {}),
  readFile: vi.fn<() => Promise<Uint8Array>>(),
}));
vi.mock("@tauri-apps/plugin-fs", () => fs);

const engine = vi.hoisted(() => ({
  openGraphicsContainer: vi.fn(),
  graphicsContainerFrom: vi.fn(),
  // The save path boots the render-engine wasm before writing graphics bytes.
  initEngine: vi.fn(async () => {}),
}));
vi.mock("../engine-rs/EngineClient", () => engine);

const { createContainer, initMonetFormat, readContainer, setEntry, writeContainer } = await import("@monet-ui/monet-format");
await initMonetFormat();

const { fileCommands, mergeGraphics, setIoNotifier } = await import("./commands");
const { ArtisanStore, IO, makeDocument } = await import("../engine");

const utf8 = (s: string) => new TextEncoder().encode(s);
const RENDER_APP = { name: "monet-render-engine", version: "0.1.0" };

/** A Rythme document: a `time` container Artisan understands nothing of. */
function rythmeContainer(): Uint8Array {
  const c = createContainer({ name: "monet-rythme", version: "0.4.2" }, "time");
  c.manifest.tempo = 128; // an unknown manifest field — rule 2 covers it too
  setEntry(c, "timeline.json", "timeline", utf8('{"bpm":128}'));
  setEntry(c, "audio/kick.wav", "audio", Uint8Array.from([1, 2, 3, 4, 5]));
  return writeContainer(c);
}

/** A Vision document: a graphics container with one foreign sidecar entry. */
function visionContainer(sceneJson: string): Uint8Array {
  const c = createContainer({ name: "monet-vision", version: "0.3.0" }, "graphics");
  setEntry(c, "graphics.json", "graphics", utf8(`{"scene":${JSON.stringify(sceneJson)}}`));
  setEntry(c, "pixels/0.png", "pixels", Uint8Array.from([9, 9, 9]));
  setEntry(c, "notes/review.txt", "notes", utf8("ship it"));
  return writeContainer(c);
}

const notices: IoNotice[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  notices.length = 0;
  setIoNotifier((n) => void notices.push(n));
  ui.isTauri.mockReturnValue(true);
  // The engine's writer: a graphics container with the scene plus one blob.
  engine.graphicsContainerFrom.mockImplementation((sceneJson: string) => {
    const c = createContainer(RENDER_APP, "graphics");
    setEntry(c, "graphics.json", "graphics", utf8(sceneJson));
    setEntry(c, "pixels/0.png", "pixels", Uint8Array.from([7, 7]));
    return writeContainer(c);
  });
});

/** Open `bytes` as `path` through the real File ▸ Open command. */
async function openAs(store: InstanceType<typeof ArtisanStore>, path: string, bytes: Uint8Array): Promise<void> {
  ui.openFile.mockResolvedValueOnce(path);
  fs.readFile.mockResolvedValueOnce(bytes);
  await fileCommands.open(store);
}

/** The container bytes the last save wrote. */
function written(): ReturnType<typeof readContainer> {
  expect(ui.atomicWriteBytes).toHaveBeenCalledTimes(1);
  return readContainer(ui.atomicWriteBytes.mock.calls[0][1]);
}

async function captureDownloads(run: () => Promise<unknown>): Promise<Blob[]> {
  const blobs: Blob[] = [];
  const create = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return `blob:test-${blobs.length}`;
  });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("document", {
    createElement: () => ({ href: "", download: "", click: vi.fn(), remove: vi.fn() }),
    body: { appendChild: vi.fn() },
  });
  vi.useFakeTimers();
  try {
    await run();
    return blobs;
  } finally {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    create.mockRestore();
    revoke.mockRestore();
  }
}

describe("opening another app's container", () => {
  it("loads what it understands and says — visibly — what it ignored", async () => {
    const store = new ArtisanStore();
    await openAs(store, "/Users/x/Beats/Loop.mryt", rythmeContainer());

    // No graphics entry is not an error: an empty artboard, plus a toast that
    // says so. A silent blank document reads as "my file lost everything".
    expect(store.doc.name).toBe("Loop");
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toMatch(/no vector layer/);
    expect(notices[0].message).toMatch(/timeline\.json/);
    expect(notices[0].message).toMatch(/audio\/kick\.wav/);
    expect(ui.message).not.toHaveBeenCalled(); // reported, not failed
  });

  it("dispatches on the manifest, not the extension", async () => {
    const store = new ArtisanStore();
    // A Rythme container someone renamed `.mvis`. It still opens as what it is.
    await openAs(store, "/Users/x/Beats/Renamed.mvis", rythmeContainer());
    expect(notices[0].message).toMatch(/no vector layer/);
  });
});

describe("re-saving anyone's container", () => {
  it("couriers browser-opened cargo and clears it for a new document", async () => {
    ui.isTauri.mockReturnValue(false);
    const source = rythmeContainer();
    const store = new ArtisanStore();
    await fileCommands.openFiles(store, [{
      name: "Loop.mryt",
      arrayBuffer: async () => source.slice().buffer,
    } as File]);

    const [saved] = await captureDownloads(() => fileCommands.save(store));
    const out = readContainer(new Uint8Array(await saved.arrayBuffer()));
    expect(out.entries.find((entry) => entry.path === "timeline.json")?.data)
      .toEqual(readContainer(source).entries.find((entry) => entry.path === "timeline.json")?.data);
    expect(out.entries.find((entry) => entry.path === "audio/kick.wav")?.data)
      .toEqual(readContainer(source).entries.find((entry) => entry.path === "audio/kick.wav")?.data);
    expect(out.manifest.tempo).toBe(128);

    await fileCommands.new(store);
    const [fresh] = await captureDownloads(() => fileCommands.save(store));
    expect(readContainer(new Uint8Array(await fresh.arrayBuffer())).entries.map((entry) => entry.path))
      .not.toContain("timeline.json");
  });

  it("couriers every entry and manifest field it did not consume", async () => {
    const source = rythmeContainer();
    const store = new ArtisanStore();
    await openAs(store, "/Users/x/Beats/Loop.mryt", source);
    store.transact("edit", (d) => void (d.name = "Loop"));

    await fileCommands.save(store);

    const out = written();
    const before = readContainer(source);
    // Byte-for-byte, both foreign entries.
    for (const path of ["timeline.json", "audio/kick.wav"]) {
      const kept = out.entries.find((e) => e.path === path)?.data;
      expect(kept, path).toEqual(before.entries.find((e) => e.path === path)?.data);
    }
    // Unknown manifest field, and the kind that says what this file mostly is.
    expect(out.manifest.tempo).toBe(128);
    expect(out.manifest.kind).toBe("time");
    // Ours now: the app stamp is who wrote it last, and our entry is there.
    expect(out.manifest.app.name).toBe("monet-artisan");
    expect(out.entries.some((e) => e.path === "graphics.json")).toBe(true);
    expect(store.getState().dirty).toBe(false);
  });

  it("replaces only the graphics family, never a foreign entry", async () => {
    const scene = IO.serializeDocument(makeDocument("Poster"));
    const store = new ArtisanStore();
    engine.openGraphicsContainer.mockReturnValue({
      scene,
      save: (json: string) => engine.graphicsContainerFrom(json, 1, 1),
      dispose: vi.fn(),
    });

    await openAs(store, "/Users/x/Art/Shared.mvis", visionContainer(scene));
    expect(store.doc.name).toBe("Shared");
    expect(notices[0].message).toMatch(/notes\/review\.txt/);

    await fileCommands.save(store);

    const out = written();
    // Vision's sidecar survives; its stale `pixels/0.png` is replaced by ours,
    // because that role is the engine's to re-emit.
    expect(out.entries.find((e) => e.path === "notes/review.txt")?.data).toEqual(utf8("ship it"));
    expect(out.entries.find((e) => e.path === "pixels/0.png")?.data).toEqual(Uint8Array.from([7, 7]));
    expect(out.manifest.entries.find((e) => e.path === "notes/review.txt")?.role).toBe("notes");
  });

  it("round-trips Vision → Artisan → Vision without losing foreign cargo", () => {
    const source = readContainer(visionContainer('{"layers":["vector-a","vector-b"]}'));
    source.manifest.reviewState = { approved: false, owner: "QA" };
    setEntry(source, "timeline.json", "timeline", utf8('{"cuts":3}'));
    setEntry(source, "media/reference.bin", "media", Uint8Array.from([1, 3, 3, 7]));
    setEntry(source, "masks/0.png", "masks", Uint8Array.from([2, 2, 2]));
    setEntry(source, "channels/spot.raw", "channels", Uint8Array.from([4, 4]));
    const foreign = new Map(source.entries
      .filter((entry) => ["timeline.json", "media/reference.bin", "notes/review.txt"].includes(entry.path))
      .map((entry) => [entry.path, entry.data.slice()]));

    const visionFresh = createContainer(RENDER_APP, "graphics");
    setEntry(visionFresh, "graphics.json", "graphics", utf8('{"layers":["vector-a","vector-b"],"visionEdit":1}'));
    setEntry(visionFresh, "pixels/0.png", "pixels", Uint8Array.from([6, 6, 6]));
    setEntry(visionFresh, "masks/0.png", "masks", Uint8Array.from([5, 5, 5]));
    const afterVision = readContainer(writeContainer(courierContainerSave(source, visionFresh)));

    const artisanFresh = createContainer(RENDER_APP, "graphics");
    setEntry(artisanFresh, "graphics.json", "graphics", utf8('{"layers":["vector-a-edited","vector-b"],"visionEdit":1}'));
    setEntry(artisanFresh, "pixels/0.png", "pixels", Uint8Array.from([6, 6, 6]));
    setEntry(artisanFresh, "masks/0.png", "masks", Uint8Array.from([5, 5, 5]));
    const afterArtisan = readContainer(writeContainer(mergeGraphics(afterVision, writeContainer(artisanFresh))));

    const visionFinal = createContainer(RENDER_APP, "graphics");
    setEntry(visionFinal, "graphics.json", "graphics", utf8('{"layers":["vector-a-edited","vector-b"],"visionEdit":2}'));
    setEntry(visionFinal, "pixels/0.png", "pixels", Uint8Array.from([8, 8, 8]));
    setEntry(visionFinal, "masks/0.png", "masks", Uint8Array.from([5, 5, 5]));
    const final = readContainer(writeContainer(courierContainerSave(afterArtisan, visionFinal)));

    for (const [path, bytes] of foreign) {
      expect(final.entries.find((entry) => entry.path === path)?.data, path).toEqual(bytes);
    }
    expect(final.manifest.reviewState).toEqual({ approved: false, owner: "QA" });
    expect(final.manifest.app.name).toBe("monet-vision");
    expect(new TextDecoder().decode(final.entries.find((entry) => entry.path === "graphics.json")?.data)).toContain("vector-a-edited");
    expect(new TextDecoder().decode(final.entries.find((entry) => entry.path === "graphics.json")?.data)).toContain("vector-b");
    expect(final.entries.find((entry) => entry.path === "pixels/0.png")?.data).toEqual(Uint8Array.from([8, 8, 8]));
    for (const path of final.entries.map((entry) => entry.path)) {
      expect(final.entries.filter((entry) => entry.path === path), path).toHaveLength(1);
      expect(final.manifest.entries.filter((entry) => entry.path === path), path).toHaveLength(1);
    }
  });
});

describe("Save As", () => {
  it("writes a v1 `.mart` container stamped by Artisan", async () => {
    const store = new ArtisanStore();
    store.transact("edit", (d) => void (d.name = "Poster"));
    ui.saveFile.mockResolvedValueOnce("/Users/x/Art/Poster.mart");

    await fileCommands.save(store); // pathless → Save As

    expect(ui.saveFile).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "Poster.mart" }));
    const out = written();
    expect(out.manifest.format).toBe("monet");
    expect(out.manifest.schemaVersion).toBe(1);
    expect(out.manifest.kind).toBe("graphics");
    expect(out.manifest.app.name).toBe("monet-artisan");
    expect(out.manifest.entries.map((e) => e.path)).toContain("graphics.json");
    expect(store.filePath).toBe("/Users/x/Art/Poster.mart");
    expect(store.getState().dirty).toBe(false);
  });

  it("keeps writing an `.artisan` home file as JSON", async () => {
    const store = new ArtisanStore();
    store.markSaved("/Users/x/Art/Poster.artisan");
    store.transact("edit", (d) => void (d.name = "Poster"));

    await fileCommands.save(store);

    // A `.artisan` home file stays plain JSON — written as UTF-8 bytes through
    // the same durable path, never as a container.
    expect(ui.atomicWriteBytes).toHaveBeenCalledTimes(1);
    const [path, bytes] = ui.atomicWriteBytes.mock.calls[0];
    expect(path).toBe("/Users/x/Art/Poster.artisan");
    expect(new TextDecoder().decode(bytes)).toContain("Poster");
  });
});

describe("slice export", () => {
  it("writes and downloads nothing when the native folder picker is cancelled", async () => {
    const store = new ArtisanStore();
    store.transact("slice", (doc) => {
      doc.slices = [{ id: "slice-1", name: "Hero", x: 0, y: 0, width: 10, height: 10 }];
    });
    ui.openFile.mockResolvedValueOnce(null);

    const downloads = await captureDownloads(() => fileCommands.exportSlices(store));

    expect(downloads).toHaveLength(0);
    expect(ui.atomicWriteBytes).not.toHaveBeenCalled();
    expect(ui.message).not.toHaveBeenCalled();
  });
});
