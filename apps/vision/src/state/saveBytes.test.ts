// #505: in the macOS desktop app every File ▸ Export command wrote nothing —
// saveBytes only clicked a hidden download anchor, and WKWebView cancels a
// download navigation when no handler is registered. The desktop build now
// shows the native save panel and writes through atomicWriteBytes; exporters
// that produce more than one file pick ONE folder up front. The browser build
// keeps the anchor download, one per file, exactly as before.
//
// The engine, storage and DOM are stubbed exactly the way
// saveAsFormats.test.ts stubs them; the dialog plugin and atomicWriteBytes are
// mocked so the assertions land on the desktop write path itself.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: false }));
const dialog = vi.hoisted(() => ({
  saveCalls: [] as Record<string, unknown>[],
  saveTarget: null as string | null,
  openCalls: [] as Record<string, unknown>[],
  openTarget: null as string | null,
}));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async (opts: Record<string, unknown>) => { dialog.saveCalls.push(opts); return dialog.saveTarget; }),
  open: vi.fn(async (opts: Record<string, unknown>) => { dialog.openCalls.push(opts); return dialog.openTarget; }),
}));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));

import { actions, dataVars, engine, exportArtboardsToFiles, exportAs, exportSizes, saveBytes, store } from "./app";
import { atomicWriteBytes } from "./atomicWrite";
import { SCRIPT_EVENTS_KEY, serializeScriptEventStore } from "./scriptEvents";

const PNG = new Uint8Array([137, 80, 78, 71]);

let cells: Map<string, string>;
function installStorage() {
  cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
}

/** A download anchor + Blob URL that records each click, so the browser half
 *  of saveBytes can run in node. Canvas is stubbed the way saveAsFormats.test.ts
 *  stubs it: store.newDocument syncs layer thumbs through a 2D context. */
function installDownloadAnchor() {
  const saved: string[] = [];
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
      if (tag !== "a") {
        return {
          width: 0, height: 0, style: {},
          getContext: () => ctx,
          toDataURL: () => "data:image/png;base64,AA",
          remove() {},
        };
      }
      const a = { href: "", download: "", style: {}, click: () => saved.push(a.download), remove() {} };
      return a;
    },
  };
  return saved;
}

function fakeEngine(overrides: Record<string, unknown> = {}) {
  const target: Record<string, unknown> = {
    layer_count: () => 1,
    export_png_with_icc: () => PNG,
    export_scaled_png_with_icc: () => PNG,
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

function openDoc(overrides: Record<string, unknown> = {}) {
  vi.spyOn(engine, "buildNew").mockImplementation(() => fakeEngine(overrides) as never);
  store.newDocument(8, 8, "shot.png", "white", 1);
}

const writes = () => vi.mocked(atomicWriteBytes).mock.calls.map(([path, bytes]) => [path, bytes] as const);
/** Let the dynamic dialog import + folder-pick promise chain settle. */
const flush = async () => { await new Promise((done) => setImmediate(done)); await new Promise((done) => setImmediate(done)); };

beforeEach(() => {
  installStorage();
  vi.mocked(atomicWriteBytes).mockClear();
  // The event bindings reference saved actions by id; resolve them all.
  vi.spyOn(actions, "resolve").mockImplementation((reference) => reference.id ?? null);
});
afterEach(() => {
  tauri.enabled = false;
  dialog.saveCalls = [];
  dialog.saveTarget = null;
  dialog.openCalls = [];
  dialog.openTarget = null;
  engine.engine = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saveBytes in the desktop app (#505)", () => {
  beforeEach(() => { tauri.enabled = true; });

  it("shows the save panel with the suggested name and writes through atomicWriteBytes", async () => {
    const saved = installDownloadAnchor();
    dialog.saveTarget = "/out/shot.png";

    await expect(saveBytes("shot.png", PNG, "image/png")).resolves.toBe(true);

    expect(dialog.saveCalls).toEqual([{ defaultPath: "shot.png" }]);
    expect(writes()).toEqual([["/out/shot.png", PNG]]);
    expect(saved).toEqual([]); // the download anchor is dead in WKWebView
  });

  it("treats a cancelled panel as a no-op: no write, no error, no event", async () => {
    installDownloadAnchor();
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    cells.set(SCRIPT_EVENTS_KEY, serializeScriptEventStore({ enabled: true, bindings: [{ event: "exportDocument", actionId: 1 }] }));
    const play = vi.spyOn(actions, "playNamed").mockResolvedValue(true);
    engine.engine = fakeEngine() as never;

    await expect(saveBytes("shot.png", PNG, "image/png")).resolves.toBe(false);

    expect(writes()).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of leaking an unhandled rejection", async () => {
    installDownloadAnchor();
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    dialog.saveTarget = "/out/shot.png";
    vi.mocked(atomicWriteBytes).mockRejectedValueOnce(new Error("disk full"));

    await expect(saveBytes("shot.png", PNG, "image/png")).resolves.toBe(false);

    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("raises Export Document only after the bytes are on disk", async () => {
    installDownloadAnchor();
    cells.set(SCRIPT_EVENTS_KEY, serializeScriptEventStore({ enabled: true, bindings: [{ event: "exportDocument", actionId: 1 }] }));
    const play = vi.spyOn(actions, "playNamed").mockResolvedValue(true);
    engine.engine = fakeEngine() as never;
    dialog.saveTarget = "/out/shot.png";

    await saveBytes("shot.png", PNG, "image/png");

    expect(play).toHaveBeenCalledTimes(1);
    const writeOrder = vi.mocked(atomicWriteBytes).mock.invocationCallOrder[0];
    expect(play.mock.invocationCallOrder[0]).toBeGreaterThan(writeOrder);
  });

  it("writes straight into a picked export folder without showing a panel", async () => {
    installDownloadAnchor();

    await expect(saveBytes("layer 1.png", PNG, "image/png", "/picked")).resolves.toBe(true);

    expect(dialog.saveCalls).toEqual([]);
    expect(writes()).toEqual([["/picked/layer 1.png", PNG]]);
  });
});

describe("saveBytes in the browser build", () => {
  it("still downloads through the anchor and never touches the native panel", async () => {
    const saved = installDownloadAnchor();
    engine.engine = fakeEngine() as never;

    await expect(saveBytes("shot.png", PNG, "image/png")).resolves.toBe(true);

    expect(saved).toEqual(["shot.png"]);
    expect(dialog.saveCalls).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("keeps multi-file exports synchronous downloads, one per file, no folder pick", () => {
    const saved = installDownloadAnchor();
    openDoc();

    exportAs("shot", [{ scale: 1, suffix: "" }, { scale: 2, suffix: "@2x" }], "png");

    expect(saved).toEqual(["shot.png", "shot@2x.png"]); // settled before the call returns
    expect(dialog.openCalls).toEqual([]);
  });
});

describe("multi-file exporters in the desktop app (#505)", () => {
  beforeEach(() => { tauri.enabled = true; });

  it("Export As with several scale rows picks ONE folder and writes every row into it", async () => {
    installDownloadAnchor();
    openDoc();
    dialog.openTarget = "/picked";

    exportAs("shot", [{ scale: 1, suffix: "" }, { scale: 2, suffix: "@2x" }], "png");
    await vi.waitFor(() => expect(writes()).toHaveLength(2));

    expect(dialog.openCalls).toEqual([{ directory: true, multiple: false, title: "Export As" }]);
    expect(dialog.saveCalls).toEqual([]); // no per-file panel
    expect(writes()).toEqual([["/picked/shot.png", PNG], ["/picked/shot@2x.png", PNG]]);
  });

  it("a cancelled folder pick writes nothing and reports nothing", async () => {
    const saved = installDownloadAnchor();
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    openDoc();

    exportAs("shot", [{ scale: 1, suffix: "" }, { scale: 2, suffix: "@2x" }], "png");
    await flush();

    expect(writes()).toEqual([]);
    expect(saved).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
  });

  it("Export As with a single row shows the save panel, not a folder pick", async () => {
    installDownloadAnchor();
    openDoc();
    dialog.saveTarget = "/out/shot.png";

    exportAs("shot", [{ scale: 1, suffix: "" }], "png");
    await vi.waitFor(() => expect(writes()).toHaveLength(1));

    expect(dialog.openCalls).toEqual([]);
    expect(dialog.saveCalls).toEqual([{ defaultPath: "shot.png" }]);
    expect(writes()).toEqual([["/out/shot.png", PNG]]);
  });

  it("Export at Sizes writes each scale into the one picked folder", async () => {
    installDownloadAnchor();
    openDoc();
    dialog.openTarget = "/picked";

    exportSizes([1, 2], "shot.png");
    await vi.waitFor(() => expect(writes()).toHaveLength(2));

    expect(dialog.openCalls).toEqual([{ directory: true, multiple: false, title: "Export at Sizes" }]);
    expect(writes()).toEqual([["/picked/shot.png", PNG], ["/picked/shot@2x.png", PNG]]);
  });

  it("Artboards to Files picks one folder for several artboards, a panel for one", async () => {
    installDownloadAnchor();
    const boards = (names: string[]) => {
      engine.engine = {
        artboard_count: () => names.length,
        artboard_name: (i: number) => names[i],
        export_artboard_png: () => PNG,
      } as never;
    };
    boards(["Artboard 1", "Artboard 2"]);
    dialog.openTarget = "/picked";

    exportArtboardsToFiles();
    await vi.waitFor(() => expect(writes()).toHaveLength(2));

    expect(writes()).toEqual([["/picked/Artboard_1.png", PNG], ["/picked/Artboard_2.png", PNG]]);
    expect(dialog.saveCalls).toEqual([]);

    vi.mocked(atomicWriteBytes).mockClear();
    dialog.openCalls = [];
    boards(["Solo"]);
    dialog.saveTarget = "/out/Solo.png";

    exportArtboardsToFiles();
    await vi.waitFor(() => expect(writes()).toHaveLength(1));

    expect(dialog.openCalls).toEqual([]);
    expect(dialog.saveCalls).toEqual([{ defaultPath: "Solo.png" }]);
    expect(writes()).toEqual([["/out/Solo.png", PNG]]);
  });

  it("Data Sets as Files picks one folder up front; a cancelled pick applies nothing", async () => {
    installDownloadAnchor();
    const e = fakeEngine();
    engine.engine = e as never;
    vi.spyOn(store, "state", "get").mockReturnValue({
      ...store.state,
      colorProfileAssigned: false,
      dataSets: [{ headline: "A" }, { headline: "B" }],
      variables: [],
    } as never);
    dialog.openTarget = "/picked";

    await expect(dataVars.exportAll()).resolves.toBe(true);

    expect(dialog.openCalls).toEqual([{ directory: true, multiple: false, title: "Export Data Sets as Files" }]);
    expect(writes()).toEqual([["/picked/dataset_1.png", PNG], ["/picked/dataset_2.png", PNG]]);

    vi.mocked(atomicWriteBytes).mockClear();
    dialog.openCalls = [];
    dialog.openTarget = null;

    await expect(dataVars.exportAll()).resolves.toBe(false);

    expect(writes()).toEqual([]);
  });
});
