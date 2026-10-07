// Opening Photoshop's plug-in formats (#466), driven through app.ts: a `.raw`
// the camera decoder refuses asks for its Photoshop Raw layout, the dialog's
// OK opens it through the engine, and Load Multiple DICOM Files stacks a
// series in Instance Number order. The engine and DOM are stubbed the way
// photoshopAppWiring.test.ts stubs them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => false,
}));
// One in-memory native file for File ▸ Revert's bounded read.
const nativeFile = vi.hoisted(() => ({ bytes: new Uint8Array(0), error: null as Error | null }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  SeekMode: { Start: 0, Current: 1, End: 2 },
  open: async () => {
    if (nativeFile.error) throw nativeFile.error;
    let cursor = 0;
    return {
      async stat() { return { isFile: true, size: nativeFile.bytes.length }; },
      async read(buffer: Uint8Array) {
        const n = Math.min(buffer.length, nativeFile.bytes.length - cursor);
        if (n <= 0) return null;
        buffer.set(nativeFile.bytes.subarray(cursor, cursor + n));
        cursor += n;
        return n;
      },
      async seek(offset: number) { cursor = offset; return offset; },
      async close() {},
    };
  },
}));
const dialogOpens = vi.hoisted(() => [] as { filters: { name: string; extensions: string[] }[] }[]);
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async (options: (typeof dialogOpens)[number]) => { dialogOpens.push(options); return null; },
  save: async () => null,
}));

import {
  engine,
  batchProcessFiles,
  loadDicomPaths,
  loadFilesIntoStack,
  loadMultipleDicomFiles,
  openFileNative,
  openFiles,
  openImageFile,
  openImageFiles,
  openAsSmartObject,
  openPath,
  openPaths,
  openPhotoshopRaw,
  registerPhotoshopRawPicker,
  revertDocument,
  store,
  smart,
  type PhotoshopRawOpenRequest,
} from "./app";
import type { PhotoshopRawLayout } from "./photoshopRaw";

let alerts: string[];
let input: { accept: string; files: unknown[]; onchange: () => Promise<void> } | null;

function fakeEngine(overrides: Record<string, unknown> = {}) {
  const target: Record<string, unknown> = { layer_count: () => 1, ...overrides };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      if (typeof prop !== "string") return undefined;
      return () => 0;
    },
    has() { return true; },
  });
}

function installStorage() {
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

function browserFile(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.length,
    lastModified: 0,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    slice: (a = 0, b = bytes.length) => browserFile(name, bytes.subarray(a, b)),
  } as unknown as File;
}

/** What the engine throws for bytes no camera decoder recognizes. */
const CAMERA_REFUSAL = "raw decode failed: RAW preflight failed: Couldn't find a decoder";
const HEADERLESS = new Uint8Array(48).fill(9);
const LAYOUT: PhotoshopRawLayout = { width: 4, height: 4, channels: 3, interleaved: true, depth: 8, bigEndian: true, header: 0 };

beforeEach(() => {
  installStorage();
  alerts = [];
  nativeFile.error = null;
  input = null;
  vi.stubGlobal("alert", (m: string) => { alerts.push(m); });
  vi.stubGlobal("confirm", () => true);
  const ctx = {
    drawImage() {}, putImageData() {},
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
  vi.stubGlobal("document", {
    body: { appendChild() {} },
    querySelector: () => null,
    // A canvas for the new tab's thumbnail, or the <input type=file> the
    // browser pickers click.
    createElement: () => {
      const el = {
        accept: "", files: [], style: {}, width: 0, height: 0,
        getContext: () => ctx,
        toDataURL: () => "data:image/png;base64,AA",
        click() { input = el as never; },
        remove() {},
      };
      return el;
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  registerPhotoshopRawPicker(null);
  engine.engine = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Open dialog offers every plug-in format", () => {
  const ALL = ["jp2", "jpf", "jpx", "j2k", "j2c", "jpc", "cin", "dpx", "sdpx", "iff", "ilbm", "lbm", "dcm", "dc3", "dic", "dicom", "raw", "rawps"];

  it("in the browser file picker", () => {
    openFiles();
    const accept = input!.accept.split(",");
    for (const ext of ALL) expect(accept).toContain(`.${ext}`);
  });

  it("in the native filters, each with its own entry", async () => {
    dialogOpens.length = 0;
    await openFileNative();
    const filters = new Map(dialogOpens[0].filters.map((f) => [f.name, f.extensions]));
    for (const ext of ALL) expect(filters.get("All Supported")).toContain(ext);
    expect(filters.get("JPEG 2000")).toEqual(["jp2", "jpf", "jpx", "j2k", "j2c", "jpc"]);
    expect(filters.get("Cineon / DPX")).toEqual(["cin", "dpx", "sdpx"]);
    expect(filters.get("IFF")).toEqual(["iff", "ilbm", "lbm"]);
    expect(filters.get("DICOM")).toEqual(["dcm", "dc3", "dic", "dicom"]);
    expect(filters.get("Photoshop Raw")).toEqual(["raw", "rawps"]);
  });
});

describe("Photoshop Raw shares .raw with camera raw", () => {
  it("asks for the layout when the camera decoder can't read a .raw", async () => {
    const picker = vi.fn((req: PhotoshopRawOpenRequest) => req.resolve(null));
    registerPhotoshopRawPicker(picker);
    const buildRaw = vi.spyOn(engine, "buildRaw").mockImplementation(() => { throw CAMERA_REFUSAL; });

    await openImageFile(browserFile("scan.raw", HEADERLESS));

    expect(buildRaw).toHaveBeenCalledTimes(1); // the camera decoder had the first try
    expect(picker).toHaveBeenCalledTimes(1);
    expect(picker.mock.calls[0][0]).toMatchObject({ name: "scan.raw", bytes: HEADERLESS });
    expect(alerts).toEqual([]);
  });

  it("still reports a camera file the decoder refuses under any other suffix", async () => {
    const picker = vi.fn();
    registerPhotoshopRawPicker(picker);
    vi.spyOn(engine, "buildRaw").mockImplementation(() => { throw CAMERA_REFUSAL; });

    await openImageFile(browserFile("shot.cr2", HEADERLESS));

    expect(picker).not.toHaveBeenCalled();
    expect(alerts.join("\n")).toContain("raw decode failed");
  });

  it("sends .rawps straight to the layout dialog", async () => {
    const picker = vi.fn((req: PhotoshopRawOpenRequest) => req.resolve(null));
    registerPhotoshopRawPicker(picker);
    const buildRaw = vi.spyOn(engine, "buildRaw");

    await openImageFile(browserFile("scan.rawps", HEADERLESS));

    expect(buildRaw).not.toHaveBeenCalled();
    expect(picker).toHaveBeenCalledTimes(1);
  });

  // MCP doc.open: the real openPath, because automation.test.ts mocks app.ts
  // whole. A modal nobody answers is not an opened document.
  it("fails doc.open on a headerless file instead of raising the layout dialog", async () => {
    const picker = vi.fn((req: PhotoshopRawOpenRequest) => req.resolve(null));
    registerPhotoshopRawPicker(picker);
    vi.spyOn(engine, "buildRaw").mockImplementation(() => { throw CAMERA_REFUSAL; });
    nativeFile.bytes = HEADERLESS;
    const before = store.state.documents.length;

    await expect(openPath("/in/scan.raw")).rejects.toThrow("Open it with doc.openPhotoshopRaw");
    await expect(openPath("/in/scan.rawps")).rejects.toThrow("Open it with doc.openPhotoshopRaw");
    expect(picker).not.toHaveBeenCalled();
    expect(store.state.documents.length).toBe(before);
    expect(alerts).toEqual([]);

    // File ▸ Open and a file drop of the same path still ask.
    expect(await openPaths(["/in/scan.raw", "/in/scan.rawps"])).toEqual([]);
    expect(picker.mock.calls.map((c) => (c[0] as PhotoshopRawOpenRequest).path)).toEqual(["/in/scan.raw", "/in/scan.rawps"]);
  });

  it.each(["read", "decode"])("returns a native %s error to MCP without a modal, while File Open still alerts", async (failure) => {
    const error = new Error(failure === "read" ? "file not found" : "invalid JPEG 2000 image");
    nativeFile.bytes = HEADERLESS;
    if (failure === "read") nativeFile.error = error;
    else vi.spyOn(store, "openImage").mockImplementation(() => { throw error; });
    const before = store.state.documents.length;

    await expect(openPath("/in/bad.jp2")).rejects.toThrow(error.message);
    expect(alerts).toEqual([]);
    expect(store.state.documents.length).toBe(before);

    expect(await openPaths(["/in/bad.jp2"])).toEqual([{ path: "/in/bad.jp2", error }]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(error.message);
  });

  it("waits for each layout before offering the next file, including after Cancel", async () => {
    const requests: PhotoshopRawOpenRequest[] = [];
    registerPhotoshopRawPicker((req) => requests.push(req));
    vi.spyOn(engine, "buildRaw").mockImplementation(() => { throw CAMERA_REFUSAL; });
    const build = vi.spyOn(engine, "buildPhotoshopRaw").mockReturnValue(fakeEngine() as never);
    const opening = openImageFiles([browserFile("first.raw", HEADERLESS), browserFile("second.rawps", HEADERLESS)]);

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].name).toBe("first.raw");
    expect(build).not.toHaveBeenCalled();
    requests[0].resolve(null);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].name).toBe("second.rawps");
    requests[1].resolve(LAYOUT);
    await opening;
    expect(build).toHaveBeenCalledTimes(1);
    expect(store.activeName()).toBe("second.rawps");
  });

  it.each(["raw", "rawps"])("Open as Smart Object waits for .%s and leaves the previous document alone on Cancel", async (ext) => {
    const requests: PhotoshopRawOpenRequest[] = [];
    registerPhotoshopRawPicker((req) => requests.push(req));
    vi.spyOn(engine, "buildRaw").mockImplementation(() => { throw CAMERA_REFUSAL; });
    vi.spyOn(engine, "buildPhotoshopRaw").mockReturnValue(fakeEngine() as never);
    const convert = vi.spyOn(smart, "convert").mockImplementation(() => {});
    for (const layout of [null, LAYOUT]) {
      const opening = openAsSmartObject();
      input!.files = [browserFile(`smart.${ext}`, HEADERLESS)];
      void input!.onchange();
      await vi.waitFor(() => expect(requests).toHaveLength(layout ? 2 : 1));
      expect(convert).not.toHaveBeenCalled();
      requests.at(-1)!.resolve(layout);
      await opening;
    }
    expect(convert).toHaveBeenCalledTimes(1);
    expect(store.activeName()).toBe(`smart.${ext}`);
  });

  it("batch waits for a raw layout and suppressing dialogs rejects an unknown layout", async () => {
    const requests: PhotoshopRawOpenRequest[] = [];
    registerPhotoshopRawPicker((req) => requests.push(req));
    vi.spyOn(engine, "buildRaw").mockImplementation(() => { throw CAMERA_REFUSAL; });
    vi.spyOn(engine, "buildPhotoshopRaw").mockReturnValue(fakeEngine() as never);
    const file = browserFile("batch.raw", HEADERLESS);
    const processing = batchProcessFiles([file], undefined, "png", { destination: "none" });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0].resolve(LAYOUT);
    expect(await processing).toBe(1);
    expect(await batchProcessFiles([file], undefined, "png", { destination: "none", suppressOpenDialogs: true })).toBe(0);
    expect(requests).toHaveLength(1);
  });

  it("rejects numeric layouts before wasm-bindgen can truncate or wrap them", () => {
    const build = vi.spyOn(engine, "buildPhotoshopRaw");
    for (const patch of [{ width: 2 ** 32 + 4 }, { height: 4.5 }, { channels: NaN }, { header: -1 }]) {
      expect(openPhotoshopRaw(HEADERLESS, "scan.raw", { ...LAYOUT, ...patch })).toBe(false);
    }
    expect(build).not.toHaveBeenCalled();
    expect(alerts).toHaveLength(4);
  });

  it("opens the dialog's layout through the engine, or says why it can't", () => {
    const build = vi.spyOn(engine, "buildPhotoshopRaw").mockReturnValue(fakeEngine() as never);
    const before = store.state.documents.length;

    expect(openPhotoshopRaw(HEADERLESS, "scan.raw", LAYOUT)).toBe(true);
    expect(alerts).toEqual([]);
    expect(build).toHaveBeenCalledWith(HEADERLESS, LAYOUT);
    expect(store.state.documents.length).toBe(before + 1);
    expect(store.activeName()).toBe("scan.raw");

    build.mockImplementation(() => { throw "4 × 4 pixels × 3 channel(s) at 8 bits after a 0-byte header needs 48 bytes, but the file holds 9."; });
    expect(openPhotoshopRaw(HEADERLESS.subarray(0, 9), "short.raw", LAYOUT)).toBe(false);
    expect(alerts.join("\n")).toContain("needs 48 bytes, but the file holds 9");
    expect(store.state.documents.length).toBe(before + 1);
  });

  it("reverts a Photoshop Raw document with the layout it was opened with", async () => {
    const build = vi.spyOn(engine, "buildPhotoshopRaw").mockReturnValue(fakeEngine() as never);
    const buildRaw = vi.spyOn(engine, "buildRaw");
    const revert = vi.spyOn(store, "revertActiveDoc").mockImplementation(() => {});
    vi.spyOn(store, "setActivePath").mockImplementation(() => true);
    vi.spyOn(store, "activePath").mockReturnValue("/in/scan.raw");
    nativeFile.bytes = HEADERLESS;

    expect(openPhotoshopRaw(HEADERLESS, "scan.raw", LAYOUT, "/in/scan.raw")).toBe(true);
    await revertDocument();

    expect(alerts).toEqual([]);
    expect(buildRaw).not.toHaveBeenCalled();
    expect(build).toHaveBeenCalledTimes(2);
    expect(build.mock.calls[1]).toEqual([HEADERLESS, LAYOUT]);
    expect(revert).toHaveBeenCalledTimes(1);
  });
});

describe("Load Multiple DICOM Files", () => {
  it("does not import later stack files into the previous document when the first open is cancelled", async () => {
    const requests: PhotoshopRawOpenRequest[] = [];
    registerPhotoshopRawPicker((req) => requests.push(req));
    const importImage = vi.fn();
    engine.engine = fakeEngine({ importImage }) as never;
    const commit = vi.spyOn(engine, "commit");
    await loadFilesIntoStack();
    input!.files = [browserFile("first.rawps", HEADERLESS), browserFile("next.png", HEADERLESS)];
    const opening = input!.onchange();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(importImage).not.toHaveBeenCalled();
    requests[0].resolve(null);
    await opening;
    expect(importImage).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("offers DICOM files and stacks them in Instance Number order", async () => {
    const slice = (n: number) => new Uint8Array([n]);
    const instances = new Map<number, number | undefined>([[1, 3], [2, 1], [3, undefined], [4, 2]]);
    vi.spyOn(engine, "dicomInstanceNumber").mockImplementation((bytes) => instances.get(bytes[0]));
    const openImage = vi.spyOn(store, "openImage").mockImplementation(() => {});
    vi.spyOn(store, "assignProfile").mockImplementation(() => {});
    vi.spyOn(store, "markProfileUntagged").mockImplementation(() => {});
    vi.spyOn(store, "markActiveSaved").mockImplementation(() => {});
    const importImage = vi.fn();
    engine.engine = fakeEngine({ importImage }) as never;
    vi.spyOn(engine, "commit").mockReturnValue(true);

    await loadMultipleDicomFiles();
    expect(input?.accept).toBe(".dcm,.dc3,.dic,.dicom");
    input!.files = [
      browserFile("c.dcm", slice(1)), browserFile("a.dcm", slice(2)),
      browserFile("z.dcm", slice(3)), browserFile("b.dcm", slice(4)),
    ];
    await input!.onchange();

    // Instance 1 opens the document; 2 and 3 stack above it; no number goes last.
    expect(openImage.mock.calls.map((c) => c[1])).toEqual(["a.dcm"]);
    expect(importImage.mock.calls.map((c) => c[1])).toEqual(["b", "c", "z"]);
  });

  it("counts the slices that became layers, not the files it read (MCP)", async () => {
    nativeFile.bytes = new Uint8Array([1]);
    vi.spyOn(engine, "dicomInstanceNumber").mockReturnValue(undefined);
    vi.spyOn(store, "openImage").mockImplementation(() => {});
    vi.spyOn(store, "assignProfile").mockImplementation(() => {});
    vi.spyOn(store, "markProfileUntagged").mockImplementation(() => {});
    vi.spyOn(store, "markActiveSaved").mockImplementation(() => {});
    const importImage = vi.fn((_bytes: Uint8Array, name: string) => { if (name === "bad") throw "unsupported transfer syntax"; });
    engine.engine = fakeEngine({ importImage }) as never;
    vi.spyOn(engine, "commit").mockReturnValue(true);

    expect(await loadDicomPaths(["/ct/a.dcm", "/ct/bad.dcm", "/ct/c.dcm"])).toBe(2);
    expect(alerts.join("\n")).toContain("unsupported transfer syntax");
  });
});
