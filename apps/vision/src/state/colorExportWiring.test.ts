// COLOR-04: every flat-image export Vision writes to disk must carry the
// document's color space. The pixel-level proof lives in the engine test
// `raster_exports_embed_the_document_icc_profile`; what is proved here is that
// every export path in the app actually reaches the *_with_icc encoder with the
// document's profile — a path that slipped back to the untagged encoder writes
// bytes claiming to be sRGB.
//
// Each path is invoked for real against a recording engine, so it is the calls
// the encoder receives that are asserted, not the shape of the source.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: false }));
const modernWeb = vi.hoisted(() => ({ calls: [] as { width: number; height: number; quality: number }[] }));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));
vi.mock("./webpEncoder", () => ({
  encodeWebpLossy: async (image: ImageData, quality: number) => {
    modernWeb.calls.push({ width: image.width, height: image.height, quality });
    return new Uint8Array([8, 9, 10]);
  },
}));

import {
  batchProcessFiles,
  engine,
  exportAs,
  exportIccBytes,
  exportJPEG,
  exportPDF,
  exportPNG,
  exportTGA,
  exportTIFF,
  exportWebP,
  contactSheet,
  registerTiffLayersPicker,
  picturePackage,
  saveForWeb,
  saveDocument,
  store,
} from "./app";
import { atomicWriteBytes } from "./atomicWrite";
import { flatLayerProbe } from "./flatLayerProbe";
import { Store, type AppSnapshot } from "./store";
import { encodeTga } from "@monet-ui/monet-imageio";

const ICC = new Uint8Array([1, 2, 3, 4]);
const APP_SOURCE = readFileSync(new URL("./app.ts", import.meta.url), "utf8");

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

/** A download anchor + Blob URL, so `saveBytes` can run in node. */
function installExportDom() {
  const saved: string[] = [];
  const g = globalThis as Record<string, unknown>;
  g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
  g.document = {
    body: { appendChild() {} },
    createElement: () => {
      const a = { href: "", download: "", click: () => saved.push(a.download), remove() {} };
      return a;
    },
  };
  return saved;
}

function installWebExportDom() {
  const saved: string[] = [];
  const g = globalThis as Record<string, unknown>;
  g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
  g.createImageBitmap = async () => ({ width: 100, height: 100, close() {} });
  g.document = {
    body: { appendChild() {} },
    createElement: (tag: string) => {
      if (tag === "canvas") {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage() {}, putImageData() {},
            getImageData: () => ({
              width: canvas.width,
              height: canvas.height,
              data: new Uint8ClampedArray(canvas.width * canvas.height * 4),
            }),
          }),
          toBlob: (cb: (blob: Blob | null) => void, type = "image/png") => cb(new Blob([new Uint8Array([1])], { type })),
        };
        return canvas;
      }
      const a = { href: "", download: "", click: () => saved.push(a.download), remove() {} };
      return a;
    },
  };
  return saved;
}

/** Both halves of every flat encoder: the tagged entry point and the untagged
 *  one it must never fall back to. */
function recordingEngine() {
  const e = {
    export_png: vi.fn(() => new Uint8Array([9])),
    export_png_with_icc: vi.fn(() => new Uint8Array([9])),
    export_jpeg: vi.fn(() => new Uint8Array([9])),
    export_jpeg_with_icc: vi.fn(() => new Uint8Array([9])),
    export_tiff: vi.fn(() => new Uint8Array([9])),
    export_tiff_with_icc: vi.fn(() => new Uint8Array([9])),
    export_tiff_layered_with_icc: vi.fn(() => new Uint8Array([9])),
    export_webp: vi.fn(() => new Uint8Array([9])),
    export_webp_with_icc: vi.fn(() => new Uint8Array([9])),
    export_scaled_png: vi.fn(() => new Uint8Array([9])),
    export_scaled_png_with_icc: vi.fn(() => new Uint8Array([9])),
    export_scaled_jpeg: vi.fn(() => new Uint8Array([9])),
    export_scaled_jpeg_with_icc: vi.fn(() => new Uint8Array([9])),
    layer_count: vi.fn(() => 1),
    width: () => 0,
    height: () => 0,
    ...flatLayerProbe(),
  };
  engine.engine = e as never;
  return e;
}

/** Every untagged encoder that could be reached by mistake. */
function expectNothingUntagged(e: ReturnType<typeof recordingEngine>) {
  for (const name of [
    "export_png", "export_jpeg", "export_tiff", "export_webp", "export_scaled_png", "export_scaled_jpeg",
  ] as const) {
    expect(e[name], `${name} writes bytes that claim to be sRGB`).not.toHaveBeenCalled();
  }
}

/** A document with a custom profile assigned. */
function taggedDocument() {
  vi.spyOn(store, "state", "get").mockReturnValue({
    ...store.state,
    doc: { ...store.state.doc, width: 100, height: 100 },
    colorProfileAssigned: true,
    iccProfileBytes: ICC,
  });
}

let onSync: typeof engine.onSync;
let saved: string[];

beforeEach(() => {
  installStorage();
  saved = installExportDom();
  onSync = engine.onSync;
  engine.onSync = null;
  tauri.enabled = false;
  modernWeb.calls.length = 0;
});
afterEach(() => { engine.onSync = onSync; engine.engine = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("COLOR-04 — the profile comes from the document", () => {
  it("uses the document's assigned ICC bytes", () => {
    taggedDocument();
    expect(exportIccBytes()).toBe(ICC);
  });

  it("is empty for an untagged document, so the engine tags its working profile", () => {
    vi.spyOn(store, "state", "get").mockReturnValue({
      ...store.state, colorProfileAssigned: false, iccProfileBytes: ICC,
    });
    expect(exportIccBytes()).toHaveLength(0);
  });

  it("prefers an explicitly passed document over the active one", () => {
    // Saves pin the document they started on; reading the ACTIVE document here
    // would embed another tab's profile after a mid-save tab switch.
    taggedDocument();
    const other = new Uint8Array([7, 7]);
    expect(exportIccBytes({ colorProfileAssigned: true, iccProfileBytes: other })).toBe(other);
    expect(exportIccBytes({ colorProfileAssigned: false, iccProfileBytes: other })).toHaveLength(0);
  });
});

describe("COLOR-04 — every export path writes tagged bytes", () => {
  it("File ▸ Export ▸ PNG / JPEG", () => {
    taggedDocument();
    const e = recordingEngine();

    exportPNG("shot.png");
    exportJPEG("shot.jpg", 80);

    expect(e.export_png_with_icc).toHaveBeenCalledWith(ICC);
    expect(e.export_jpeg_with_icc).toHaveBeenCalledWith(80, ICC);
    expectNothingUntagged(e);
    expect(saved).toEqual(["shot.png", "shot.jpg"]);
  });

  it("File ▸ Export ▸ Export As, at every scale and in both raster formats", () => {
    taggedDocument();
    const e = recordingEngine();

    exportAs("shot", [{ scale: 1, suffix: "" }, { scale: 2, suffix: "@2x" }], "png");
    exportAs("shot", [{ scale: 1, suffix: "" }, { scale: 2, suffix: "@2x" }], "jpeg", 70);

    expect(e.export_png_with_icc).toHaveBeenCalledWith(ICC);
    expect(e.export_scaled_png_with_icc).toHaveBeenCalledWith(2, ICC);
    expect(e.export_jpeg_with_icc).toHaveBeenCalledWith(70, ICC);
    expect(e.export_scaled_jpeg_with_icc).toHaveBeenCalledWith(2, 70, ICC);
    expectNothingUntagged(e);
  });

  it("File ▸ Export ▸ TIFF / WebP", () => {
    taggedDocument();
    const e = recordingEngine();

    exportTIFF("shot.tif");
    exportWebP("shot.webp");

    expect(e.export_tiff_with_icc).toHaveBeenCalledWith(ICC);
    expect(e.export_webp_with_icc).toHaveBeenCalledWith(ICC);
    expectNothingUntagged(e);
  });

  it("File ▸ Export ▸ TIFF with TIFF Options keeps the profile either way (#461)", () => {
    taggedDocument();
    const e = recordingEngine();
    e.layer_count.mockReturnValue(3);
    const pending: { resolve?: (layers: boolean | null) => void } = {};
    registerTiffLayersPicker((resolve) => { pending.resolve = resolve; });
    try {
      exportTIFF("cancelled.tif");
      pending.resolve?.(null);
      expect(e.export_tiff_layered_with_icc).not.toHaveBeenCalled();
      expect(e.export_tiff_with_icc).not.toHaveBeenCalled();

      exportTIFF("layers.tif");
      pending.resolve?.(true);
      expect(e.export_tiff_layered_with_icc).toHaveBeenCalledWith(ICC);

      exportTIFF("flat.tif");
      pending.resolve?.(false);
      expect(e.export_tiff_with_icc).toHaveBeenCalledWith(ICC);
      expectNothingUntagged(e);
      expect(saved).toEqual(["layers.tif", "flat.tif"]);
    } finally {
      registerTiffLayersPicker(null);
    }
  });

  it("File ▸ Automate ▸ Batch", async () => {
    taggedDocument();
    const e = recordingEngine();
    vi.spyOn(store, "openImage").mockImplementation(() => 0 as never);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = {
      name: "in.png",
      size: bytes.length,
      lastModified: 0,
      slice: () => ({ arrayBuffer: async () => bytes.buffer }),
      arrayBuffer: async () => bytes.buffer,
    } as unknown as File;

    expect(await batchProcessFiles([file], undefined, "png")).toBe(1);
    expect(e.export_png_with_icc).toHaveBeenCalledWith(ICC);

    expect(await batchProcessFiles([file], undefined, "jpeg")).toBe(1);
    expect(e.export_jpeg_with_icc).toHaveBeenCalledWith(90, ICC);

    expect(await batchProcessFiles([file], undefined, "tiff")).toBe(1);
    expect(e.export_tiff_with_icc).toHaveBeenCalledWith(ICC);

    expectNothingUntagged(e);
  });

  it("does not export the previous document when an async input decoder fails", async () => {
    const e = recordingEngine();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = {
      name: "broken.tga",
      size: bytes.length,
      lastModified: 0,
      slice: () => ({ arrayBuffer: async () => bytes.buffer }),
      arrayBuffer: async () => bytes.buffer,
    } as unknown as File;

    expect(await batchProcessFiles([file], undefined, "png")).toBe(0);
    expect(e.export_png_with_icc).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("waits for an async input decoder before exporting", async () => {
    let opened = false;
    vi.stubGlobal("ImageData", class {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data; this.width = width; this.height = height;
      }
    });
    vi.spyOn(store, "openImage").mockImplementation(() => { opened = true; return 0 as never; });
    vi.spyOn(store, "assignProfile").mockImplementation(() => {});
    vi.spyOn(store, "markActiveSaved").mockImplementation(() => {});
    const e = recordingEngine();
    e.export_png_with_icc.mockImplementation(() => {
      expect(opened).toBe(true);
      return new Uint8Array([9]);
    });
    const bytes = encodeTga(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1);
    const file = {
      name: "pixel.tga",
      size: bytes.length,
      lastModified: 0,
      slice: () => ({ arrayBuffer: async () => bytes.buffer }),
      arrayBuffer: async () => bytes.buffer,
    } as unknown as File;

    expect(await batchProcessFiles([file], undefined, "png")).toBe(1);
    expect(opened).toBe(true);
    expect(e.export_png_with_icc).toHaveBeenCalledOnce();
  });

  it("Save / Save As in place", async () => {
    // Save-in-place goes through bytesForExt, which resolves the profile from
    // the PINNED document rather than the live active one.
    tauri.enabled = true;
    const e = recordingEngine();
    vi.spyOn(store, "docContentRevision").mockReturnValue(3);
    vi.spyOn(store, "docDocumentMeta").mockReturnValue({ colorProfileAssigned: true, iccProfileBytes: ICC } as never);
    const markSaved = vi.spyOn(store, "markDocSavedAtRevision").mockReturnValue(true);

    vi.spyOn(store, "activePath").mockReturnValue("/docs/a.png");
    await saveDocument();
    expect(e.export_png_with_icc).toHaveBeenCalledWith(ICC);

    vi.spyOn(store, "activePath").mockReturnValue("/docs/a.jpg");
    await saveDocument();
    expect(e.export_jpeg_with_icc).toHaveBeenCalledWith(92, ICC);

    expectNothingUntagged(e);
    expect(markSaved).toHaveBeenCalledTimes(2);
    expect(vi.mocked(atomicWriteBytes).mock.calls.map(([path]) => path)).toEqual(["/docs/a.png", "/docs/a.jpg"]);
  });
});

describe("async export failures are visible", () => {
  it("routes every fire-and-forget async exporter through the shared reporter", () => {
    for (const name of [
      "exportVideo", "pdfPresentation", "exportPDF", "exportLayerCompsToPDF",
      "picturePackage", "contactSheet", "exportTGA", "exportPPM", "exportPCX",
    ]) {
      const start = APP_SOURCE.indexOf(`export async function ${name}(`);
      expect(start, name).toBeGreaterThanOrEqual(0);
      expect(APP_SOURCE.slice(start, start + 500), name).toContain("reportSaveExport(");
    }
  });

  it("reports thrown PDF/TGA failures instead of rejecting fire-and-forget menu calls", async () => {
    const alerts: string[] = [];
    vi.stubGlobal("alert", (message: string) => alerts.push(message));
    const e = recordingEngine();
    vi.spyOn(console, "error").mockImplementation(() => {});
    e.export_png.mockImplementation(() => { throw new Error("engine encode failed"); });

    await expect(exportPDF()).resolves.toBeUndefined();
    await expect(exportTGA()).resolves.toBeUndefined();
    expect(alerts).toHaveLength(2);
    expect(alerts.every((message) => message.includes("engine encode failed"))).toBe(true);

    alerts.length = 0;
    e.export_png.mockReturnValue(new Uint8Array());
    await expect(exportPDF()).resolves.toBeUndefined();
    expect(alerts[0]).toContain("Could not build the PDF");
  });

  it("reports a Save for Web encoder failure and returns zero", async () => {
    const alerts: string[] = [];
    vi.stubGlobal("alert", (message: string) => alerts.push(message));
    const e = recordingEngine();
    vi.spyOn(console, "error").mockImplementation(() => {});
    e.export_png_with_icc.mockImplementation(() => { throw new Error("web encode failed"); });

    await expect(saveForWeb("poster.psd", {
      format: "png", quality: 80, matte: "transparent", convertToSRgb: false, metadata: "all",
    })).resolves.toBe(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("web encode failed");
  });

  it("settles and reports Picture Package and Contact Sheet callback failures", async () => {
    const alerts: string[] = [];
    vi.stubGlobal("alert", (message: string) => alerts.push(message));
    vi.spyOn(console, "error").mockImplementation(() => {});
    recordingEngine();
    let rejectBytes = true;
    vi.stubGlobal("Image", class {
      width = 10;
      height = 10;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    (globalThis as Record<string, unknown>).document = {
      body: { appendChild() {} },
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: "", font: "", fillRect() {}, drawImage() {}, fillText() {},
        }),
        toBlob: (cb: (blob: Blob | null) => void) => cb({
          arrayBuffer: async () => {
            if (rejectBytes) throw new Error("blob read failed");
            return new ArrayBuffer(1);
          },
        } as Blob),
      }),
    };

    await expect(picturePackage()).resolves.toBeUndefined();
    expect(alerts.at(-1)).toContain("blob read failed");

    rejectBytes = false;
    const docCards = vi.spyOn(store, "docCards").mockImplementation(() => { throw new Error("thumbnail failed"); });
    await expect(contactSheet()).resolves.toBeUndefined();
    expect(alerts.at(-1)).toContain("thumbnail failed");

    docCards.mockReturnValue([{
      id: 1, name: "One", thumb: "blob:one", dirty: false, active: true, width: 10, height: 10,
    }]);
    vi.spyOn(store, "openImage").mockImplementation(() => { throw new Error("open image failed"); });
    await expect(contactSheet()).resolves.toBeUndefined();
    expect(alerts.at(-1)).toContain("open image failed");
  });

  it("encodes slices as the selected WebP format", async () => {
    saved = installWebExportDom();
    const e = recordingEngine();
    e.width = () => 100;
    e.height = () => 100;
    const current = store.state;
    vi.spyOn(store, "state", "get").mockReturnValue({
      ...current,
      slices: [{ x: 10, y: 20, w: 30, h: 40 }],
      colorProfileAssigned: false,
    } as never);

    await expect(saveForWeb("poster.psd", {
      format: "webp", quality: 73, matte: "transparent", convertToSRgb: false, metadata: "none",
    })).resolves.toBe(1);
    expect(modernWeb.calls).toEqual([{ width: 30, height: 40, quality: 73 }]);
    expect(saved).toEqual(["poster_01.webp"]);
  });
});

// COLOR-04, other half: the engine owns the `.monetgfx` envelope, so the profile
// Vision holds in JS state has to be mirrored into it or a container saved from
// Vision carries no `iccProfile` at all and every other Monet app guesses sRGB.
describe("COLOR-04 — the assigned profile reaches the .monetgfx envelope", () => {
  function newStore() {
    const icc: [Uint8Array, string][] = [];
    const e = {
      setDocumentIcc: (bytes: Uint8Array, name: string) => { icc.push([bytes, name]); },
      assign_profile: () => {},
      convert_profile_with_icc: () => {},
      set_display_profile: () => {},
      width: () => 0,
      height: () => 0,
    };
    const client = {
      onCommit: null, engine: e, e,
      sync: () => {},
      commit: () => true,
      setDisplayProfile: () => {},
      setIccProofLut: () => {},
    };
    return { store: new Store(client as never), icc };
  }
  const patch = (s: Store, p: Partial<AppSnapshot>) =>
    (s as unknown as { set(patch: Partial<AppSnapshot>): void }).set(p);

  it("mirrors an assigned custom profile into the engine envelope", () => {
    const { store, icc } = newStore();
    store.assignProfile(2, ICC, "My Profile");
    expect(icc).toHaveLength(1);
    expect(Array.from(icc[0][0])).toEqual([...ICC]);
    expect(icc[0][1]).toBe("My Profile");
  });

  it("mirrors a conversion's DESTINATION profile", () => {
    const { store, icc } = newStore();
    const dest = new Uint8Array([5, 6]);
    store.convertToProfile(3, 1, false, dest, "Dest");
    expect(icc).toHaveLength(1);
    expect(Array.from(icc[0][0])).toEqual([5, 6]);
    expect(icc[0][1]).toBe("Dest");
  });

  it("clears the envelope when the document is marked untagged", () => {
    const { store, icc } = newStore();
    store.assignProfile(2, ICC, "My Profile");
    store.markProfileUntagged(0);

    // Untagged: the container must not claim a profile.
    expect(icc).toHaveLength(2);
    expect(Array.from(icc[1][0])).toEqual([]);
    expect(icc[1][1]).toBe("");
    expect(store.state.colorProfileAssigned).toBe(false);
    expect(store.state.iccProfileBytes).toBeNull();
  });

  it("keeps the mirrored profile in step with the snapshot after each mutation", () => {
    const { store, icc } = newStore();
    patch(store, { colorProfile: 0 });
    store.assignProfile(1, ICC, "A");
    store.convertToProfile(2, 1, false, new Uint8Array([8]), "B");
    store.markProfileUntagged(2);
    store.assignProfile(3, new Uint8Array([9]), "C");

    expect(icc.map(([bytes, name]) => [Array.from(bytes), name])).toEqual([
      [[...ICC], "A"],
      [[8], "B"],
      [[], ""],
      [[9], "C"],
    ]);
  });
});
