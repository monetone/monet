// `bytesForExt` is the app's one format table for "what bytes does this
// extension want". It used to be private, so the MCP path-taking tools
// (doc.saveAs / doc.exportAs) carried a second, smaller copy that drifted. It is
// exported now, with the JPEG quality that copy needed as an option instead of a
// hardcoded 92.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { bytesForExt, engine, exportPSBBytes, exportPSDBytes, store } from "./app";

const ICC = new Uint8Array([1, 2, 3, 4]);

function recordingEngine(readOnly = false) {
  const e = {
    export_png_with_icc: vi.fn(() => new Uint8Array([9])),
    export_jpeg_with_icc: vi.fn(() => new Uint8Array([8])),
    export_gif: vi.fn(() => new Uint8Array([7])),
    export_psd_tagged: vi.fn(() => new Uint8Array([6])),
    export_psb_tagged: vi.fn(() => new Uint8Array([5])),
    export_psd_with_icc: vi.fn(() => new Uint8Array([4])),
    export_psb_with_icc: vi.fn(() => new Uint8Array([3])),
    export_tiff_with_icc: vi.fn(() => new Uint8Array([2])),
    export_tiff_layered_with_icc: vi.fn(() => new Uint8Array([1])),
    layer_count: vi.fn(() => 1),
    imported_photoshop_read_only: vi.fn(() => readOnly),
    set_photoshop_paths: vi.fn(),
    set_photoshop_duotone: vi.fn(),
    doc_mode: vi.fn(() => 0),
    photoshop_export_notice: vi.fn(() => ""),
  };
  engine.engine = e as never;
  return e;
}

/** A document with a custom profile assigned, so the tagged encoders have
 *  something to embed. */
function taggedDocument() {
  vi.spyOn(store, "state", "get").mockReturnValue({
    ...store.state,
    doc: { ...store.state.doc, width: 10, height: 10 },
    colorProfileAssigned: true,
    iccProfileBytes: ICC,
  });
}

afterEach(() => { engine.engine = null; vi.restoreAllMocks(); });

describe("bytesForExt", () => {
  it("encodes each extension through its tagged encoder and names the mime type", async () => {
    taggedDocument();
    const e = recordingEngine();

    await expect(bytesForExt("png")).resolves.toEqual({ bytes: new Uint8Array([9]), mime: "image/png" });
    await expect(bytesForExt("gif")).resolves.toEqual({ bytes: new Uint8Array([7]), mime: "image/gif" });
    expect(e.export_png_with_icc).toHaveBeenCalledWith(ICC);
  });

  it("defaults JPEG to quality 92 and takes an override", async () => {
    taggedDocument();
    const e = recordingEngine();

    await bytesForExt("jpg");
    expect(e.export_jpeg_with_icc).toHaveBeenCalledWith(92, ICC);

    await bytesForExt("jpeg", { quality: 55 });
    expect(e.export_jpeg_with_icc).toHaveBeenLastCalledWith(55, ICC);
  });

  it("refuses an extension it cannot write, rather than putting project bytes under it", async () => {
    taggedDocument();
    recordingEngine();
    await expect(bytesForExt("cr2")).rejects.toThrow(/Unsupported save extension/);
    await expect(bytesForExt("")).rejects.toThrow(/Unsupported save extension/);
  });

  it("never exports a temporary history-transaction preview", async () => {
    taggedDocument();
    const e = recordingEngine() as ReturnType<typeof recordingEngine> & { history_transaction_active: () => boolean };
    e.history_transaction_active = () => true;

    await expect(bytesForExt("png")).rejects.toThrow("Finish or cancel the current edit");
    expect(e.export_png_with_icc).not.toHaveBeenCalled();
  });

  it("blocks every editable serialization of a read-only Photoshop import", async () => {
    taggedDocument();
    const e = recordingEngine(true);

    for (const ext of ["mvision", "mvis", "psd", "psb"]) {
      await expect(bytesForExt(ext)).rejects.toThrow("convert it to RGB");
    }
    expect(() => exportPSDBytes()).toThrow("convert it to RGB");
    expect(() => exportPSBBytes()).toThrow("convert it to RGB");
    expect(e.export_psd_tagged).not.toHaveBeenCalled();
    expect(e.export_psb_tagged).not.toHaveBeenCalled();
    expect(e.export_psd_with_icc).not.toHaveBeenCalled();
    expect(e.export_psb_with_icc).not.toHaveBeenCalled();
    await expect(bytesForExt("png")).resolves.toEqual({ bytes: new Uint8Array([9]), mime: "image/png" });
  });

  // The engine writes resources 2000+/2999 from what it was last handed, so a
  // PSD export must hand it this document's paths first (#457).
  it("hands the document's saved paths and clipping path to the engine before a PSD or PSB export", () => {
    const savedPaths = [{ name: "Path 1", path: [0, 0, 10, 0, 10, 10], clipFlatness: 2 }];
    vi.spyOn(store, "state", "get").mockReturnValue({
      ...store.state,
      doc: { ...store.state.doc, width: 10, height: 10 },
      colorProfileAssigned: true,
      iccProfileBytes: ICC,
      savedPaths,
    });
    const e = recordingEngine();
    const courier = JSON.stringify([{ name: "Path 1", anchors: [0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0], clip: 2 }]);

    exportPSDBytes();
    expect(e.set_photoshop_paths).toHaveBeenCalledWith(courier);
    expect(e.set_photoshop_paths.mock.invocationCallOrder[0]).toBeLessThan(e.export_psd_with_icc.mock.invocationCallOrder[0]);
    exportPSBBytes();
    expect(e.set_photoshop_paths).toHaveBeenCalledTimes(2);
    expect(e.set_photoshop_paths.mock.invocationCallOrder[1]).toBeLessThan(e.export_psb_with_icc.mock.invocationCallOrder[0]);
  });

  it("tells the user when the engine leaves a saved path out of the Photoshop file", () => {
    taggedDocument();
    const e = recordingEngine();
    const onEditError = vi.fn();
    engine.onEditError = onEditError;
    try {
      exportPSDBytes();
      expect(onEditError).not.toHaveBeenCalled();
      e.set_photoshop_paths.mockReturnValue(2 as never);
      exportPSBBytes();
      expect(onEditError).toHaveBeenCalledWith(expect.stringContaining("2 saved paths were left out of the Photoshop file"));
      expect(e.export_psb_with_icc).toHaveBeenCalled(); // a warning, not a refused save
    } finally {
      engine.onEditError = null;
    }
  });

  it("says what the Photoshop file holds differently once it is written (#460)", () => {
    taggedDocument();
    const e = recordingEngine();
    const onEditError = vi.fn();
    engine.onEditError = onEditError;
    try {
      exportPSDBytes();
      expect(onEditError).not.toHaveBeenCalled();
      const notice = '"Logo": its edited contents were a CMYK document and are saved as RGB.';
      e.photoshop_export_notice.mockReturnValue(notice as never);
      exportPSDBytes();
      exportPSBBytes();
      expect(onEditError).toHaveBeenCalledTimes(2);
      expect(onEditError).toHaveBeenCalledWith(notice);
    } finally {
      engine.onEditError = null;
    }
  });

  it("a layered TIFF says what its Photoshop layer data holds differently, as a PSD does (#460)", async () => {
    taggedDocument();
    const e = recordingEngine();
    const onEditError = vi.fn();
    engine.onEditError = onEditError;
    try {
      const notice = '"Logo": its edited contents were a CMYK document and are saved as RGB.';
      e.photoshop_export_notice.mockReturnValue(notice as never);
      await expect(bytesForExt("tif")).resolves.toEqual({ bytes: new Uint8Array([2]), mime: "image/tiff" });
      expect(onEditError).not.toHaveBeenCalled(); // a flat TIFF carries no layer data
      await expect(bytesForExt("tif", { tiffLayers: true })).resolves.toEqual({ bytes: new Uint8Array([1]), mime: "image/tiff" });
      expect(onEditError).toHaveBeenCalledWith(notice);
    } finally {
      engine.onEditError = null;
    }
  });

  // Inks are handed in only from the document's own live record: none here, so
  // the engine is told there are none (#459).
  it("hands the engine no Duotone inks when the document has none", () => {
    taggedDocument();
    const e = recordingEngine();
    exportPSDBytes();
    expect(e.set_photoshop_duotone).toHaveBeenCalledWith(new Uint8Array(0), 0);
    expect(e.set_photoshop_duotone.mock.invocationCallOrder[0]).toBeLessThan(e.export_psd_with_icc.mock.invocationCallOrder[0]);
  });

  it("says a Multichannel save holds the flattened plates, once the file is written", () => {
    taggedDocument();
    const e = recordingEngine();
    e.doc_mode.mockReturnValue(4);
    const onEditError = vi.fn();
    engine.onEditError = onEditError;
    try {
      exportPSDBytes();
      expect(onEditError).not.toHaveBeenCalled(); // a single layer loses nothing
      e.layer_count.mockReturnValue(3);
      exportPSBBytes();
      expect(onEditError).toHaveBeenCalledWith(expect.stringContaining("Multichannel mode has no layers"));
      e.export_psd_with_icc.mockImplementation(() => { throw new Error("refused"); });
      onEditError.mockClear();
      expect(() => exportPSDBytes()).toThrow("refused");
      expect(onEditError).not.toHaveBeenCalled();
    } finally {
      engine.onEditError = null;
    }
  });
});
