// Cluster 3 (#520, #517, #541, #550). Each test calls the shipped save, export,
// or LUT function. The assertions fail when a non-RGB document is written as
// RGB and treated as saved, when Export As Metadata: None sticks, when an
// encoder error never reaches the user, or when a 3D LUT grades browser pixels
// and drops the selection.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => false,
}));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));

import {
  applyColorLutCube,
  bytesForExt,
  engine,
  exportAs,
  exportLayerCompsToFiles,
  exportLayersToFiles,
  exportPNG,
  exportSizes,
  exportTIFF,
  store,
} from "./app";
import { documentFitsFlatFormat, type FlatDocumentFacts } from "./nativeIoPolicy";
import { flatLayerProbe } from "./flatLayerProbe";

const alerts: string[] = [];

function installDom() {
  const g = globalThis as Record<string, unknown>;
  g.alert = (message: string) => { alerts.push(String(message)); };
  g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
  g.createImageBitmap = () => { throw new Error("browser decode"); };
  g.document = {
    body: { appendChild() {} },
    createElement: () => ({ href: "", download: "", click() {}, remove() {} }),
  };
  const cells = new Map<string, string>();
  g.localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  };
}

function flatFacts(mode: number): FlatDocumentFacts {
  return {
    layerCount: 1,
    layer: {
      kind: 0, visible: true, blend: 0, opacity: 1, fill: 1,
      hasMask: false, hasVectorMask: false, hasEffects: false, smartFilterCount: 0, hasTransparency: false,
    },
    mode, depth: 8, extraChannels: 0, frameCount: 0,
  };
}

function recordingEngine(mode = 0) {
  let scope = 3;
  const scopesAtEncode: number[] = [];
  const e = {
    ...flatLayerProbe(),
    doc_mode: () => mode,
    export_metadata_scope: () => scope,
    set_export_metadata_scope: (next: number) => { scope = next; },
    export_png_with_icc: vi.fn(() => { scopesAtEncode.push(scope); return new Uint8Array([0x89, 0x50]); }),
    export_scaled_png_with_icc: vi.fn(() => { scopesAtEncode.push(scope); return new Uint8Array([0x89, 0x50]); }),
    export_jpeg_with_icc: vi.fn(() => new Uint8Array([0xff, 0xd8])),
    export_tiff_with_icc: vi.fn(() => new Uint8Array([0x49, 0x49])),
    export_webp_with_icc: vi.fn(() => new Uint8Array([0x52, 0x49])),
    export_gif: vi.fn(() => new Uint8Array([0x47, 0x49])),
    export_scaled_gif: vi.fn(() => new Uint8Array([0x47, 0x49])),
    export_layer_png: vi.fn(() => new Uint8Array([0x89])),
    width: () => 1,
    height: () => 1,
    layer_count: () => 1,
    scopesAtEncode,
  };
  engine.engine = e as never;
  return e;
}

beforeEach(() => {
  alerts.length = 0;
  installDom();
  engine.onSync = null;
});
afterEach(() => {
  engine.engine = null;
  vi.restoreAllMocks();
});

describe("P3 color export (#520 #517 #541 #550)", () => {
  it("does not treat a flat Grayscale, CMYK, or Lab document as an in-place RGB save (#520)", async () => {
    for (const [mode, ext] of [[1, "png"], [2, "jpg"], [3, "tif"]] as const) {
      expect(documentFitsFlatFormat(flatFacts(mode), ext), `${mode} ${ext}`).toBe(false);
    }
    const eng = recordingEngine(2);
    await expect(bytesForExt("png", { eng: eng as never })).rejects.toThrow(/CMYK/);
    expect(eng.export_png_with_icc).not.toHaveBeenCalled();
    exportTIFF("plate.tif");
    expect(eng.export_tiff_with_icc).not.toHaveBeenCalled();
    expect(alerts.some((message) => message.includes("CMYK") && message.includes("Could not save"))).toBe(true);
  });

  it("applies Export As Metadata: None only to that export (#517)", () => {
    const eng = recordingEngine(0);
    exportAs("shot", [{ scale: 1, suffix: "" }], "png", 90, 0);
    expect(eng.scopesAtEncode).toEqual([0]);
    expect(eng.export_metadata_scope()).toBe(3);
    exportPNG("later.png");
    expect(eng.scopesAtEncode).toEqual([0, 3]);
    expect(eng.export_metadata_scope()).toBe(3);
  });

  it("surfaces a refused PNG, an oversized Export at Sizes, and a failed layer or comp export (#541)", () => {
    const eng = recordingEngine(0);
    eng.export_png_with_icc.mockImplementation(() => { throw new Error("encoder refused"); });
    exportPNG("shot.png");
    expect(alerts.some((message) => message.includes("Could not save") && message.includes("encoder refused"))).toBe(true);

    alerts.length = 0;
    vi.spyOn(store, "state", "get").mockReturnValue({
      ...store.state,
      doc: { ...store.state.doc, width: 10_000, height: 10_000 },
      layers: [{ id: 4, name: "Logo", kind: 0, visible: true, opacity: 1, fill: 1, blend: 0, clipped: false }],
      layerComps: [],
    } as never);
    exportSizes([8], "big");
    expect(eng.export_scaled_png_with_icc).not.toHaveBeenCalled();
    expect(alerts.some((message) => message.includes("image-size limit"))).toBe(true);

    alerts.length = 0;
    eng.export_layer_png.mockImplementation(() => { throw new Error("layer export refused"); });
    exportLayersToFiles("stack");
    expect(alerts.some((message) => message.includes("layer export refused"))).toBe(true);

    alerts.length = 0;
    vi.spyOn(engine, "projectBytes").mockImplementation(() => { throw new Error("comp export refused"); });
    exportLayerCompsToFiles("comps");
    expect(alerts.some((message) => message.includes("comp export refused"))).toBe(true);
  });

  it("grades a 3D LUT from the engine samples and keeps the selection (#550)", async () => {
    const mask = new Uint8Array([200]);
    const samples = new Uint16Array([0, 65535, 0, 65535]);
    const stamped: Uint8Array[] = [];
    const restored: Uint8Array[] = [];
    const eng = {
      ...recordingEngine(0),
      doc_profile: () => 1,
      doc_depth: () => 8,
      export_png: vi.fn(() => { throw new Error("png decode path"); }),
      export_composite_rgba16: () => samples,
      has_selection: () => true,
      get_selection_mask: () => mask,
      select_none: vi.fn(),
      set_selection_mask: (next: Uint8Array) => { restored.push(next); },
      stamp_image: (_x: number, _y: number, _w: number, _h: number, rgba: Uint8Array) => { stamped.push(rgba); },
    };
    engine.engine = eng as never;
    vi.spyOn(store, "addLayer").mockImplementation(() => 1);
    vi.spyOn(store, "markDirty").mockImplementation(() => {});
    vi.spyOn(engine, "commit").mockImplementation(() => true);
    const cube = [
      "LUT_3D_SIZE 2",
      "0 0 0", "1 0 0", "0 1 0", "1 1 0",
      "0 0 1", "1 0 1", "0 1 1", "1 1 1",
    ].join("\n");
    await expect(applyColorLutCube(cube)).resolves.toBe(true);
    expect(eng.export_png).not.toHaveBeenCalled();
    expect(stamped).toHaveLength(1);
    expect(Array.from(stamped[0])).toEqual([0, 255, 0, 255]);
    expect(eng.select_none).toHaveBeenCalledOnce();
    expect(restored).toHaveLength(1);
    expect(Array.from(restored[0])).toEqual([200]);
  });
});
