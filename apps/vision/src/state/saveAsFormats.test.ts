// Save As offers every format the app already encodes — TIFF, WebP, PDF,
// Radiance HDR, OpenEXR and Targa — not just the six that shipped first.
// Driven through the real Save As flow (native dialog + atomicWriteBytes) so
// the assertions are on the bytes that reach disk, not on the source text.
//
// The engine, storage and DOM are stubbed exactly the way
// saveCopyAndSnapshotDirty.test.ts stubs them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: false }));
const dialog = vi.hoisted(() => ({
  target: null as string | null,
  onSave: null as (() => void) | null,
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
  save: async () => {
    const target = dialog.target;
    dialog.onSave?.();
    return target;
  },
  open: async () => null,
}));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  SeekMode: { Start: 0, Current: 1, End: 2 },
  open: async () => {
    const bytes = new Uint8Array(256);
    let cursor = 0;
    return {
      async stat() { return { isFile: true, size: bytes.length }; },
      async read(buffer: Uint8Array) {
        const length = Math.min(buffer.length, bytes.length - cursor);
        buffer.set(bytes.subarray(cursor, cursor + length));
        cursor += length;
        return length || null;
      },
      async seek(offset: number) { cursor = offset; return offset; },
      async close() {},
    };
  },
}));

import { engine, registerSaveOptionsPicker, registerTiffLayersPicker, revertDocument, saveDocumentAs, store, type SaveFormatOptions, type SaveOptionsFormat } from "./app";
import { flatLayerProbe } from "./flatLayerProbe";
import { atomicWriteBytes } from "./atomicWrite";
import { defaultSpec } from "../text/spec";

// Marker bytes per encoder: whichever one Save As picked shows up on disk.
const TIFF = new Uint8Array([0x49, 0x49, 42, 0]);
const LAYERED_TIFF = new Uint8Array([0x4d, 0x4d, 0, 42]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const HDR = new Uint8Array([0x23, 0x3f, 0x52, 0x41]);
const EXR = new Uint8Array([0x76, 0x2f, 0x31, 0x01]);
const PNG = new Uint8Array([137, 80, 78, 71]);
const JP2 = new Uint8Array([0, 0, 0, 12]);
const PS_RAW = new Uint8Array([7, 7, 7]);

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
    export_png: () => PNG,
    export_png_with_icc: () => PNG,
    export_tiff_with_icc: () => TIFF,
    export_tiff_layered_with_icc: () => LAYERED_TIFF,
    export_webp_with_icc: () => WEBP,
    export_hdr: () => HDR,
    export_exr: () => EXR,
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

// The TGA and PDF encoders are the only two without a synchronous engine call:
// both round-trip the composite PNG through an <img> + canvas. Stub just enough
// of that (a 2×2 opaque image) for the real encoders to run.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

function installDom() {
  const ctx = {
    drawImage() {}, putImageData() {},
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }),
  };
  const g = globalThis as Record<string, unknown>;
  g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
  g.Blob = class { constructor(public parts: unknown[], public opts: unknown) {} };
  g.createImageBitmap = undefined; // force the <img> decode path
  g.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 2; height = 2; naturalWidth = 2; naturalHeight = 2;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  };
  g.document = {
    body: { appendChild() {} },
    createElement: (tag: string) => {
      if (tag === "a") return { href: "", download: "", style: {}, click() {}, remove() {} };
      return {
        width: 0, height: 0, style: {},
        getContext: () => ctx,
        toDataURL: () => "data:image/png;base64,AA",
        toBlob: (cb: (b: unknown) => void) => cb({ arrayBuffer: async () => JPEG.buffer.slice(0) }),
        remove() {},
      };
    },
    querySelector: () => null,
  };
}

const written = () => vi.mocked(atomicWriteBytes).mock.calls.map((c) => [c[0], c[1]] as const);

describe("Save As reaches every format the app can encode", () => {
  beforeEach(() => {
    installStorage();
    installDom();
    tauri.enabled = true;
    vi.mocked(atomicWriteBytes).mockClear();
  });
  afterEach(() => {
    tauri.enabled = false;
    dialog.target = null;
    dialog.onSave = null;
    engine.engine = null;
    registerTiffLayersPicker(null);
    registerSaveOptionsPicker(null);
    vi.restoreAllMocks();
  });

  function openFlatDoc(layerCount = 1, name = "shot.png", resolutionPpi = 72, overrides: Record<string, unknown> = {}) {
    vi.spyOn(engine, "buildNew").mockImplementation(() => fakeEngine({ layer_count: () => layerCount, ...overrides }) as never);
    store.newDocument(8, 8, name, "white", 1, { resolutionPpi });
    store.markDirty();
  }

  it.each([
    ["/out/scan.tif", TIFF],
    ["/out/scan.tiff", TIFF],
    ["/out/scan.webp", WEBP],
    ["/out/scan.hdr", HDR],
    ["/out/scan.exr", EXR],
  ])("writes %s through its own encoder", async (target, expected) => {
    openFlatDoc();
    dialog.target = target;

    await saveDocumentAs();

    expect(written()).toEqual([[target, expected]]);
  });

  it("encodes Targa through the canvas path", async () => {
    openFlatDoc();
    dialog.target = "/out/sprite.tga";

    await saveDocumentAs();

    const [[path, bytes]] = written();
    expect(path).toBe("/out/sprite.tga");
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[2]).toBe(10); // TGA image type 10 = RLE true-colour
  });

  it("assembles a PDF page for a .pdf destination", async () => {
    openFlatDoc();
    dialog.target = "/out/page.pdf";

    await saveDocumentAs();

    const [[path, bytes]] = written();
    expect(path).toBe("/out/page.pdf");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("keeps PDF title, resolution, ICC profile, and searchable text pinned when the dialog switches tabs", async () => {
    const sourceIcc = new Uint8Array(137).fill(0x41);
    const otherIcc = new Uint8Array(149).fill(0x42);
    openFlatDoc(1, "pinned-source.png", 300, {
      layer_id_at: () => 101,
      layer_kind: () => 2,
      layer_visible: () => true,
      layer_text_spec: () => JSON.stringify(defaultSpec("Pinned source text", { ax: 1, ay: 1, size: 10 })),
    });
    store.assignProfile(0, sourceIcc, "Pinned RGB");
    dialog.target = "/out/export.pdf";
    dialog.onSave = () => {
      openFlatDoc(1, "other-tab.png", 72, {
        layer_id_at: () => 202,
        layer_kind: () => 2,
        layer_visible: () => true,
        layer_text_spec: () => JSON.stringify(defaultSpec("Other tab text", { ax: 2, ay: 2, size: 12 })),
      });
      store.assignProfile(0, otherIcc, "Other RGB");
    };

    await saveDocumentAs();

    const [[, bytes]] = written();
    const pdf = new TextDecoder().decode(bytes);
    expect(pdf).toContain("/Title (pinned-source)");
    expect(pdf).toContain("/MediaBox [0 0 0.48 0.48]"); // 2 px at 300 ppi
    expect(pdf).toContain("<< /N 3 /Length 137 >>");
    expect(pdf).toContain("(Pinned source text) Tj");
    expect(pdf).not.toContain("/Title (other-tab)");
    expect(pdf).not.toContain("/Length 149");
    expect(pdf).not.toContain("(Other tab text) Tj");
  });

  it("still refuses a destination Vision cannot encode", async () => {
    openFlatDoc();
    dialog.target = "/out/scan.bmp";

    await saveDocumentAs();

    expect(written()).toEqual([]);
  });

  it("keeps a layered document dirty after a flat Save As to one of them", async () => {
    // The document has three layers, so TIFF is an export copy: it must not
    // adopt the path or clear the dirty flag (saveAsIsCopy).
    const saved: number[] = [];
    store.onDocSaved = (id) => saved.push(id);
    try {
      openFlatDoc(3);
      dialog.target = "/out/flat.tif";

      await saveDocumentAs();

      expect(written()).toEqual([["/out/flat.tif", TIFF]]);
      expect(store.activePath()).toBeNull();
      expect(saved).toEqual([]);
    } finally {
      store.onDocSaved = null;
    }
  });

  describe("JPEG 2000 and Photoshop Raw Options (#466)", () => {
    const answer = (choice: SaveFormatOptions | null) => {
      const picker = vi.fn((_format: SaveOptionsFormat, resolve: (options: SaveFormatOptions | null) => void) => resolve(choice));
      registerSaveOptionsPicker(picker);
      return picker;
    };
    const encoders = () => {
      const jp2 = vi.fn(() => JP2);
      const raw = vi.fn(() => PS_RAW);
      openFlatDoc(1, "shot.png", 72, { export_jpeg2000: jp2, export_photoshop_raw: raw });
      return { jp2, raw };
    };

    it("writes the lossy JPEG 2000 the dialog chose, as a codestream for .j2k", async () => {
      const picker = answer({ jpeg2000: { lossless: false, quality: 40 } });
      const { jp2 } = encoders();
      dialog.target = "/out/scan.jp2";
      await saveDocumentAs();
      dialog.target = "/out/scan.j2k";
      await saveDocumentAs();

      expect(picker.mock.calls.map((c) => c[0])).toEqual(["jpeg2000", "jpeg2000"]);
      expect(jp2.mock.calls).toEqual([[false, 40, false], [false, 40, true]]);
      expect(written()).toEqual([["/out/scan.jp2", JP2], ["/out/scan.j2k", JP2]]);
    });

    it("writes the Photoshop Raw layout the dialog chose", async () => {
      const picker = answer({ photoshopRaw: { interleaved: false, bigEndian: false, header: 64 } });
      const { raw } = encoders();
      dialog.target = "/out/scan.raw";

      await saveDocumentAs();

      expect(picker.mock.calls[0][0]).toBe("photoshopRaw");
      expect(raw).toHaveBeenCalledWith(false, false, 64);
      expect(written()).toEqual([["/out/scan.raw", PS_RAW]]);
    });

    it("reverts Photoshop Raw with the layout actually written by Save As", async () => {
      answer({ photoshopRaw: { interleaved: false, bigEndian: false, header: 64 } });
      openFlatDoc(1, "source.png", 72, {
        width: () => 8, height: () => 4, doc_mode: () => 1, doc_depth: () => 16,
        export_photoshop_raw: () => PS_RAW,
      });
      const build = vi.spyOn(engine, "buildPhotoshopRaw").mockReturnValue(fakeEngine() as never);
      const camera = vi.spyOn(engine, "buildRaw");
      vi.spyOn(store, "revertActiveDoc").mockImplementation(() => {});
      dialog.target = "/out/scan.raw";

      expect(await saveDocumentAs()).toBe(true);
      expect(store.activePath()).toBe("/out/scan.raw");
      await revertDocument();

      expect(camera).not.toHaveBeenCalled();
      expect(build).toHaveBeenCalledWith(expect.any(Uint8Array), {
        width: 8, height: 4, channels: 1, depth: 16,
        interleaved: false, bigEndian: false, header: 64,
      });
    });

    it.each([[0, 8], [0, 16], [1, 8], [1, 16]])("keeps transparent mode %s depth %s dirty when exporting Photoshop Raw", async (mode, depth) => {
      answer({ photoshopRaw: { interleaved: false, bigEndian: false, header: 64 } });
      openFlatDoc(1, "source.png", 72, {
        doc_mode: () => mode, doc_depth: () => depth,
        layer_has_transparency: () => true,
        export_photoshop_raw: () => PS_RAW,
      });
      const id = store.state.activeDocId;
      const name = store.activeName();
      dialog.target = "/out/scan.raw";

      expect(await saveDocumentAs()).toBe(true);

      expect(written()).toEqual([["/out/scan.raw", PS_RAW]]);
      expect(store.activePath()).toBeNull();
      expect(store.activeName()).toBe(name);
      expect(store.docDirty(id)).toBe(true);
    });

    it("writes nothing when the options dialog is cancelled", async () => {
      answer(null);
      const { jp2, raw } = encoders();
      dialog.target = "/out/scan.jp2";
      await saveDocumentAs();
      dialog.target = "/out/scan.raw";
      await saveDocumentAs();

      expect(jp2).not.toHaveBeenCalled();
      expect(raw).not.toHaveBeenCalled();
      expect(written()).toEqual([]);
    });

    it("writes lossless JPEG 2000 and plain interleaved Mac raw without a picker", async () => {
      const { jp2, raw } = encoders();
      dialog.target = "/out/scan.jpf";
      await saveDocumentAs();
      dialog.target = "/out/scan.raw";
      await saveDocumentAs();

      expect(jp2).toHaveBeenCalledWith(true, 100, false);
      expect(raw).toHaveBeenCalledWith(true, true, 0);
    });
  });

  describe("TIFF Options on a layered document (#461)", () => {
    const answer = (choice: boolean | null) => {
      const picker = vi.fn((resolve: (layers: boolean | null) => void) => resolve(choice));
      registerTiffLayersPicker(picker);
      return picker;
    };

    it("writes the layer stack when Save layers stays checked", async () => {
      const picker = answer(true);
      openFlatDoc(3);
      dialog.target = "/out/layers.tif";

      await saveDocumentAs();

      expect(picker).toHaveBeenCalledTimes(1);
      expect(written()).toEqual([["/out/layers.tif", LAYERED_TIFF]]);
      expect(store.activePath()).toBeNull(); // still an export copy, like PSD
    });

    it("writes the flat composite when Save layers is unchecked", async () => {
      answer(false);
      openFlatDoc(3);
      dialog.target = "/out/flat.tiff";

      await saveDocumentAs();

      expect(written()).toEqual([["/out/flat.tiff", TIFF]]);
    });

    it("writes nothing when TIFF Options is cancelled", async () => {
      answer(null);
      openFlatDoc(3);
      dialog.target = "/out/layers.tif";

      await saveDocumentAs();

      expect(written()).toEqual([]);
    });

    it("never asks for a one-layer document or another format", async () => {
      const picker = answer(true);
      openFlatDoc(1);
      dialog.target = "/out/single.tif";
      await saveDocumentAs();
      openFlatDoc(3);
      dialog.target = "/out/layers.webp";
      await saveDocumentAs();

      expect(picker).not.toHaveBeenCalled();
      expect(written()).toEqual([["/out/single.tif", TIFF], ["/out/layers.webp", WEBP]]);
    });
  });
});
