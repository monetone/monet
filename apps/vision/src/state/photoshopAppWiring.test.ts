// The Photoshop boundary in app.ts, driven rather than grepped: an `8BPS`
// signature beats any file name, a preserved Photoshop source is never
// overwritten by a lossy re-serialization, and every Photoshop-sensitive native
// read goes through the bounded handle.
//
// `@tauri-apps/plugin-fs` is replaced by an in-memory file; its unbounded entry
// points (readFile / readTextFile / stat) throw, so a regression back to them
// surfaces as a failure instead of an unbounded allocation.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: false }));
const dialog = vi.hoisted(() => ({ open: null as string | string[] | null, save: null as string | null }));
const nativeFs = vi.hoisted(() => ({
  bytes: new Uint8Array(64),
  opened: [] as string[],
}));
/** What the native `heic` plugin's decode_heic returns: `[w][h][rgba]`, 1×1. */
const heic = vi.hoisted(() => ({ packed: new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 255]).buffer }));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const original = await importOriginal<{ invoke: (cmd: string, ...rest: unknown[]) => Promise<unknown> }>();
  return {
    ...original,
    isTauri: () => tauri.enabled,
    invoke: (cmd: string, ...rest: unknown[]) => (
      cmd === "plugin:heic|decode_heic" ? Promise.resolve(heic.packed) : original.invoke(cmd, ...rest)
    ),
  };
});
// The AVIF decoder is wasm; a 1×1 transparent pixel stands in for it. What
// matters here is that the profile is read from the file, not from this.
vi.mock("./avifDecoder", () => ({
  decodeAvif: async () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async () => dialog.open,
  save: async () => dialog.save,
}));
vi.mock("@tauri-apps/plugin-fs", () => {
  const unbounded = (name: string) => () => { throw new Error(`${name} is an unbounded read`); };
  return {
    SeekMode: { Start: 0, Current: 1, End: 2 },
    readFile: unbounded("readFile"),
    readTextFile: unbounded("readTextFile"),
    stat: unbounded("stat"),
    mkdir: async () => {},
    remove: async () => {},
    open: async (path: string) => {
      nativeFs.opened.push(path);
      let cursor = 0;
      return {
        async stat() { return { isFile: true, size: nativeFs.bytes.length }; },
        async read(buffer: Uint8Array) {
          const n = Math.min(buffer.length, nativeFs.bytes.length - cursor);
          if (n <= 0) return null;
          buffer.set(nativeFs.bytes.subarray(cursor, cursor + n));
          cursor += n;
          return n;
        },
        async seek(offset: number) { cursor = offset; return offset; },
        async close() {},
      };
    },
  };
});
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));

import { initMonetFormat } from "@monet-ui/monet-format";
import {
  engine,
  exportOriginalPhotoshop,
  importCameraRawSidecar,
  loadFilesIntoStack,
  openImageFile,
  openPaths,
  placePathIntoFrame,
  revertDocument,
  saveDocumentAs,
  store,
} from "./app";
import { atomicWriteBytes } from "./atomicWrite";
import { flatLayerProbe } from "./flatLayerProbe";

// ── Fixtures ────────────────────────────────────────────────────────────────

const PHOTOSHOP_RGB = 3;
const PHOTOSHOP_CMYK = 4;

/** A 26-byte Photoshop header (the only part the routing/policy layer reads),
 *  padded so it looks like a real file to the size preflight. */
function psdBytes(colorMode = PHOTOSHOP_RGB, version = 1) {
  const b = new Uint8Array(64);
  b.set([0x38, 0x42, 0x50, 0x53]); // "8BPS"
  b[5] = version;
  b[13] = 3; // channels
  b[17] = 8; // height
  b[21] = 8; // width
  b[23] = 8; // depth
  b[25] = colorMode;
  return b;
}

/** Anything that is definitively not a Photoshop document. */
function rawBytes() {
  const b = new Uint8Array(64);
  b.set([0x49, 0x49, 0x2a, 0x00]); // TIFF/CR2-ish little-endian magic
  return b;
}

// ── Test doubles ────────────────────────────────────────────────────────────

let alerts: string[];
let downloads: { name: string; bytes: unknown }[];

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

function fakeEngine(overrides: Record<string, unknown> = {}) {
  const target: Record<string, unknown> = {
    ...flatLayerProbe(),
    layer_count: () => 1,
    export_png_with_icc: () => new Uint8Array([137, 80, 78, 71]),
    save_project: () => new Uint8Array([1, 2, 3]),
    try_save_project: undefined, // the engine's fallible variant is absent here
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

function installDom() {
  downloads = [];
  const ctx = {
    drawImage() {}, putImageData() {},
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
  const g = globalThis as Record<string, unknown>;
  let lastBlob: unknown = null;
  g.Blob = class { constructor(parts: unknown[]) { lastBlob = parts[0]; } };
  g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
  g.document = {
    body: { appendChild() {} },
    createElement: (tag: string) => {
      if (tag === "a") {
        const a = {
          href: "", download: "", style: {},
          click: () => downloads.push({ name: a.download, bytes: lastBlob }),
          remove() {},
        };
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
}

function browserFile(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.length,
    lastModified: 0,
    arrayBuffer: async () => bytes.buffer.slice(0),
    slice: (a = 0, b = bytes.length) => browserFile(name, bytes.subarray(a, b)),
    text: async () => new TextDecoder().decode(bytes),
  } as unknown as File;
}

/** Silence and capture the store side of an open so no engine is needed. */
function stubOpens() {
  return {
    openFormat: vi.spyOn(store, "openFormat").mockImplementation(() => {}),
    openRaw: vi.spyOn(store, "openRaw").mockReturnValue("session" as never),
    openImage: vi.spyOn(store, "openImage").mockImplementation(() => {}),
    setActivePath: vi.spyOn(store, "setActivePath").mockImplementation(() => {}),
    assignProfile: vi.spyOn(store, "assignProfile").mockImplementation(() => {}),
    markProfileUntagged: vi.spyOn(store, "markProfileUntagged").mockImplementation(() => {}),
    markActiveSaved: vi.spyOn(store, "markActiveSaved").mockImplementation(() => {}),
    waitFor: vi.spyOn(store, "waitForCameraRawSession").mockResolvedValue("open" as never),
  };
}

beforeAll(async () => { await initMonetFormat(); });

beforeEach(() => {
  installStorage();
  installDom();
  alerts = [];
  vi.stubGlobal("alert", (m: string) => { alerts.push(m); });
  vi.spyOn(console, "error").mockImplementation(() => {});
  nativeFs.bytes = psdBytes();
  nativeFs.opened.length = 0;
  dialog.open = null;
  dialog.save = null;
  vi.mocked(atomicWriteBytes).mockClear();
});
afterEach(() => {
  tauri.enabled = false;
  engine.engine = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Signature-first routing ─────────────────────────────────────────────────

describe("an 8BPS signature outranks the file name", () => {
  it("opens a native PSD that is named .jpg as a Photoshop document", async () => {
    tauri.enabled = true;
    const spies = stubOpens();
    nativeFs.bytes = psdBytes();

    expect(await openPaths(["/in/photo.jpg"])).toEqual([]);

    expect(spies.openFormat).toHaveBeenCalledTimes(1);
    expect(spies.openFormat.mock.calls[0][1]).toBe("photo.jpg");
    expect(spies.openImage).not.toHaveBeenCalled();
    expect(spies.setActivePath).toHaveBeenCalledWith("/in/photo.jpg");
  });

  it("does not let a misleading Camera Raw extension bypass native routing", async () => {
    tauri.enabled = true;
    const spies = stubOpens();
    nativeFs.bytes = psdBytes();

    await openPaths(["/in/photo.cr2"]);

    expect(spies.openFormat).toHaveBeenCalledTimes(1);
    expect(spies.openRaw).not.toHaveBeenCalled();
  });

  it("does not let a misleading Camera Raw extension bypass browser routing", async () => {
    const spies = stubOpens();

    await openImageFile(browserFile("photo.cr2", psdBytes()));

    expect(spies.openFormat).toHaveBeenCalledTimes(1);
    expect(spies.openRaw).not.toHaveBeenCalled();
  });

  it("still routes a genuine Camera Raw file to the RAW workspace", async () => {
    tauri.enabled = true;
    const spies = stubOpens();
    nativeFs.bytes = rawBytes();

    await openPaths(["/in/photo.cr2"]);

    expect(spies.openRaw).toHaveBeenCalledTimes(1);
    expect(spies.openFormat).not.toHaveBeenCalled();
  });
});

describe("the RGB profile policy runs only for an RGB Photoshop document", () => {
  it("applies the open policy to a mode-3 (RGB) PSD", async () => {
    tauri.enabled = true;
    const spies = stubOpens();
    nativeFs.bytes = psdBytes(PHOTOSHOP_RGB);

    await openPaths(["/in/rgb.psd"]);

    const decided = spies.assignProfile.mock.calls.length + spies.markProfileUntagged.mock.calls.length;
    expect(decided).toBeGreaterThan(0);
  });

  it("leaves a mode-4 (CMYK) PSD's profile alone", async () => {
    tauri.enabled = true;
    const spies = stubOpens();
    nativeFs.bytes = psdBytes(PHOTOSHOP_CMYK);

    await openPaths(["/in/cmyk.psd"]);

    expect(spies.openFormat).toHaveBeenCalledTimes(1);
    expect(spies.assignProfile).not.toHaveBeenCalled();
    expect(spies.markProfileUntagged).not.toHaveBeenCalled();
  });
});

// ── Revert ──────────────────────────────────────────────────────────────────

describe("File ▸ Revert decodes by signature and reads within bounds", () => {
  it("rebuilds a PSD named .cr2 through the Photoshop importer", async () => {
    tauri.enabled = true;
    stubOpens();
    vi.spyOn(store, "activePath").mockReturnValue("/in/photo.cr2");
    vi.spyOn(store, "revertActiveCameraRawSource").mockReturnValue(false);
    const revert = vi.spyOn(store, "revertActiveDoc").mockImplementation(() => {});
    const buildFormat = vi.spyOn(engine, "buildFormat").mockReturnValue(fakeEngine() as never);
    const buildRaw = vi.spyOn(engine, "buildRaw").mockReturnValue(fakeEngine() as never);
    nativeFs.bytes = psdBytes();

    await revertDocument();

    expect(buildFormat).toHaveBeenCalledTimes(1);
    expect(buildRaw).not.toHaveBeenCalled();
    expect(revert).toHaveBeenCalledTimes(1);
    expect(nativeFs.opened).toEqual(["/in/photo.cr2"]); // the bounded handle
    expect(alerts).toEqual([]);
  });
});

describe("every Photoshop-sensitive native read uses the bounded handle", () => {
  beforeEach(() => { tauri.enabled = true; });

  it("opens paths, stacks, sidecars and placements without an unbounded API", async () => {
    stubOpens();
    vi.spyOn(store, "fillFrame").mockImplementation((() => {}) as never);
    vi.spyOn(engine, "buildImage").mockReturnValue(fakeEngine() as never);
    engine.engine = fakeEngine() as never;
    nativeFs.bytes = psdBytes();

    dialog.open = "/in/a.psd";
    await openPaths(["/in/a.psd"]);
    await placePathIntoFrame("/in/a.psd", 1);
    dialog.open = ["/in/a.psd", "/in/b.psd"];
    await loadFilesIntoStack();
    dialog.open = "/in/a.xmp";
    await importCameraRawSidecar({ originalName: "a.cr2", originalByteLength: 4 } as never)
      .catch(() => null); // the XMP body is not valid; the READ is what is under test

    expect(nativeFs.opened.length).toBeGreaterThanOrEqual(5);
    expect(alerts.join("\n")).not.toContain("unbounded read");
  });
});

// ── Preserved Photoshop authority ───────────────────────────────────────────

describe("a preserved Photoshop source is never overwritten by a re-serialization", () => {
  /** Open a document backed by a read-only imported Photoshop engine. */
  function openReadOnlyDoc(overrides: Record<string, unknown> = {}) {
    const eng = fakeEngine({ imported_photoshop_read_only: () => true, ...overrides });
    vi.spyOn(engine, "buildNew").mockReturnValue(eng as never);
    store.newDocument(8, 8, "imported.psd");
    store.markDirty();
    return eng;
  }

  it("refuses to hand out project bytes for a read-only import", () => {
    const saveProject = vi.fn(() => new Uint8Array([1]));
    const eng = fakeEngine({ imported_photoshop_read_only: () => true, save_project: saveProject });

    expect(() => engine.projectBytes(eng as never)).toThrow();
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("still serializes a document that was not imported read-only", () => {
    const eng = fakeEngine({ imported_photoshop_read_only: () => false });
    expect(engine.projectBytes(eng as never)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("blocks Save As to an editable format and writes nothing", async () => {
    tauri.enabled = true;
    dialog.save = "/out/copy.mvision";
    openReadOnlyDoc();

    await saveDocumentAs();

    expect(atomicWriteBytes).not.toHaveBeenCalled();
    expect(alerts).toHaveLength(1);
    expect(store.activePath()).toBeNull();
  });

  it("still allows a flat raster export of the same document", async () => {
    tauri.enabled = true;
    dialog.save = "/out/copy.png";
    openReadOnlyDoc();

    await saveDocumentAs();

    expect(vi.mocked(atomicWriteBytes).mock.calls.map((c) => c[0])).toEqual(["/out/copy.png"]);
  });

  it("exports the preserved original bytes under the source's own extension", () => {
    const original = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 2]);
    openReadOnlyDoc({
      export_imported_photoshop_original: () => original,
      imported_photoshop_source_is_psb: () => true,
    });

    const stem = store.activeName().replace(/\.[^.]+$/, "");

    exportOriginalPhotoshop();

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe(`${stem}.psb`); // .psb, from the SOURCE, not the tab's .psd
    expect(downloads[0].bytes).toBe(original); // the exact preserved source
  });

  it("reports instead of downloading when there is no preserved source", () => {
    vi.spyOn(engine, "buildNew").mockReturnValue(fakeEngine() as never);
    store.newDocument(8, 8, "plain.png");

    exportOriginalPhotoshop();

    expect(downloads).toEqual([]);
    expect(alerts).toHaveLength(1);
  });
});

describe("a browser save that fails leaves the document unsaved", () => {
  it("does not mark saved and does not download when the export throws", async () => {
    const eng = fakeEngine({ export_png_with_icc: () => { throw new Error("encoder failed"); } });
    vi.spyOn(engine, "buildNew").mockReturnValue(eng as never);
    store.newDocument(8, 8, "shot.png");
    store.markDirty();
    const savedIds: number[] = [];
    store.onDocSaved = (id) => savedIds.push(id);

    await saveDocumentAs();

    expect(downloads).toEqual([]);
    expect(savedIds).toEqual([]);
    expect(alerts).toHaveLength(1);
    store.onDocSaved = null;
  });
});

// The Photoshop-specific menu entry, the read-only status badge and the
// "Convert to RGB" affordance live inside the App() component in App.tsx — the
// DOM/WASM app shell that vitest.config.ts excludes from the node run because it
// cannot be instantiated here. Everything they dispatch to is exercised above,
// so only the bindings themselves keep a source guard.
describe("the UI shell exposes the preserved-source affordances", () => {
  const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

  it("binds the export command, the read-only badge and the RGB conversion", () => {
    expect(appSource).toContain("psdoriginal: () => exportOriginalPhotoshop()");
    expect(appSource).toContain("data-mv-photoshop-read-only");
    expect(appSource).toContain("Convert to RGB");
  });
});

// ── Embedded custom ICC profiles (#439) ─────────────────────────────────────

/** A minimal RGB ICC profile whose `desc` tag names it. */
function iccNamed(name: string): Uint8Array {
  const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const tag = [...ascii("desc"), 0, 0, 0, 0, 0, 0, 0, name.length + 1, ...ascii(name), 0];
  const icc = new Uint8Array(144 + tag.length);
  const view = new DataView(icc.buffer);
  view.setUint32(0, icc.length);
  icc.set(ascii("RGB "), 16);
  icc.set(ascii("acsp"), 36);
  view.setUint32(128, 1); // one tag
  icc.set(ascii("desc"), 132);
  view.setUint32(136, 144);
  view.setUint32(140, tag.length);
  icc.set(tag, 144);
  return icc;
}

/** Big-endian TIFF: header + a one-entry IFD0 (tag 34675) + the profile. */
function tiffWithIcc(icc: Uint8Array): Uint8Array {
  const out = new Uint8Array(26 + icc.length);
  const view = new DataView(out.buffer);
  out.set([0x4d, 0x4d, 0, 42]);
  view.setUint32(4, 8);
  view.setUint16(8, 1);
  view.setUint16(10, 34675); view.setUint16(12, 7); view.setUint32(14, icc.length); view.setUint32(18, 26);
  out.set(icc, 26);
  return out;
}

describe("a custom embedded ICC profile survives open (#439)", () => {
  it("tags the document with the file's own bytes and desc name", async () => {
    const spies = stubOpens();
    const icc = iccNamed("Acme Wide Gamut RGB");

    await openImageFile(browserFile("scan.tif", tiffWithIcc(icc)));

    expect(spies.openImage).toHaveBeenCalledTimes(1);
    // The store keeps these bytes + name: the status bar / Assign Profile show
    // the real name and exportIccBytes() hands the same bytes to every encoder.
    expect(spies.assignProfile).toHaveBeenCalledWith(0, icc, "Acme Wide Gamut RGB");
    expect(spies.markProfileUntagged).not.toHaveBeenCalled();
    expect(alerts).toEqual([]);
  });
});

/** RIFF/WEBP: a VP8X header chunk then the ICCP chunk. */
function webpWithIcc(icc: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + 18 + 8 + icc.length);
  const view = new DataView(out.buffer);
  const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  out.set(ascii("RIFF"), 0); view.setUint32(4, out.length - 8, true); out.set(ascii("WEBP"), 8);
  out.set(ascii("VP8X"), 12); view.setUint32(16, 10, true); out[20] = 0x20; // ICC flag; 1×1 canvas
  out.set(ascii("ICCP"), 30); view.setUint32(34, icc.length, true); out.set(icc, 38);
  return out;
}

/** ftyp + meta{ iprp{ ipco{ colr } } } — the ISOBMFF shape AVIF and HEIC
 *  share; `colr` carries `prof` + the profile, or `nclx` (no ICC) for `null`. */
function heifWithIcc(brand: string, icc: Uint8Array | null): Uint8Array {
  const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const box = (type: string, ...parts: ArrayLike<number>[]) => {
    const out = new Uint8Array(8 + parts.reduce((n, p) => n + p.length, 0));
    new DataView(out.buffer).setUint32(0, out.length);
    out.set(ascii(type), 4);
    let at = 8;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const colr = icc ? box("colr", ascii("prof"), icc) : box("colr", ascii("nclx"), [0, 1, 0, 13, 0, 1, 0x80]);
  return Uint8Array.from([
    ...box("ftyp", ascii(brand), [0, 0, 0, 0], ascii("mif1")),
    ...box("meta", [0, 0, 0, 0], box("iprp", box("ipco", colr))),
  ]);
}

const RealBlob = globalThis.Blob;
/** The AVIF/HEIC importers transcode to PNG through the platform Blob +
 *  CompressionStream (which installDom's download stub replaces) and HEIC
 *  wraps its pixels in an ImageData; give them both back. */
function installTranscodeDom() {
  vi.stubGlobal("Blob", RealBlob);
  vi.stubGlobal("ImageData", class {
    constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
  });
}

describe("TIFF, WebP, AVIF and HEIC run the EMBEDDED profile policy (#464)", () => {
  it("a WebP's ICCP chunk tags the document", async () => {
    const spies = stubOpens();
    const icc = iccNamed("Acme Wide Gamut RGB");
    await openImageFile(browserFile("photo.webp", webpWithIcc(icc)));
    expect(spies.openImage).toHaveBeenCalledTimes(1);
    expect(spies.assignProfile).toHaveBeenCalledWith(0, icc, "Acme Wide Gamut RGB");
    expect(spies.markProfileUntagged).not.toHaveBeenCalled();
    expect(alerts).toEqual([]);
  });

  it("an AVIF's colr/prof profile is read from the original bytes, not the transcoded PNG", async () => {
    installTranscodeDom();
    const spies = stubOpens();
    const icc = iccNamed("Acme Wide Gamut RGB");
    await openImageFile(browserFile("photo.avif", heifWithIcc("avif", icc)));
    expect(spies.openImage).toHaveBeenCalledTimes(1);
    expect(spies.assignProfile).toHaveBeenCalledWith(0, icc, "Acme Wide Gamut RGB");
    expect(alerts).toEqual([]);
  });

  it("an untagged AVIF still takes the missing-profile path (assign working RGB, no bytes)", async () => {
    installTranscodeDom();
    const spies = stubOpens();
    await openImageFile(browserFile("plain.avif", heifWithIcc("avif", null)));
    expect(spies.openImage).toHaveBeenCalledTimes(1);
    expect(spies.assignProfile).toHaveBeenCalledTimes(1);
    expect(spies.assignProfile).toHaveBeenCalledWith(store.state.colorProfile);
    expect(alerts).toEqual([]);
  });

  it("a HEIC's colr/prof profile is read from the original bytes (native decode)", async () => {
    tauri.enabled = true;
    installTranscodeDom();
    const spies = stubOpens();
    const icc = iccNamed("Acme Wide Gamut RGB");
    await openImageFile(browserFile("IMG_0001.heic", heifWithIcc("heic", icc)));
    expect(spies.openImage).toHaveBeenCalledTimes(1);
    expect(spies.assignProfile).toHaveBeenCalledWith(0, icc, "Acme Wide Gamut RGB");
    expect(alerts).toEqual([]);
  });
});
