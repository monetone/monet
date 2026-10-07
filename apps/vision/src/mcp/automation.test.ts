import { beforeEach, describe, expect, it, vi } from "vitest";

// The automation half of the MCP surface: actions playback, batch, save/export
// to a path and the sandboxed scripting console. All four reach the filesystem
// or the app's own automation engine, so the stubs mimic how those actually
// fail: `playNamed` no-ops on an unknown id, and `runScript` RESOLVES its
// errors instead of throwing.

const native = vi.hoisted(() => ({ on: true }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.on }));

const writes = vi.hoisted(() => [] as { path: string; bytes: Uint8Array }[]);
vi.mock("../state/atomicWrite", () => ({
  atomicWriteBytes: vi.fn(async (path: string, bytes: Uint8Array) => { writes.push({ path, bytes }); }),
}));

const app = vi.hoisted(() => {
  const saved = [
    { id: 7, name: "Web Export", set: "Default", stepCount: 3, favorite: true, createdAt: 1, lastPlayedAt: null },
    { id: 8, name: "Sharpen Pass", set: "Default", stepCount: 1, favorite: false, createdAt: 2, lastPlayedAt: null },
  ];
  return {
    saved,
    actions: {
      list: vi.fn(() => saved),
      filter: vi.fn((query = "", favoritesOnly = false) => saved.filter((a) =>
        a.name.toLowerCase().includes(query.toLowerCase()) && (!favoritesOnly || a.favorite))),
      playNamed: vi.fn(),
    },
    batchProcess: vi.fn(async () => ({ processed: 2, errors: [{ name: "b.png", message: "boom" }] })),
    runDroplet: vi.fn(async () => ({ processed: 1, errors: [], completed: ["a.jpg"], cancelled: false })),
    saveDropletFile: vi.fn(async () => {}),
    runScript: vi.fn(async () => ""),
    bytesForExt: vi.fn(async (ext: string) => {
      if (!ext || ext === "cr2") throw new Error(`Unsupported save extension: .${ext || "(none)"}`);
      return { bytes: new Uint8Array([ext.length]), mime: "application/octet-stream" };
    }),
    engine: {
      e: {
        export_png_with_icc: vi.fn(() => new Uint8Array([0x89, 0x50])),
        export_jpeg_with_icc: vi.fn(() => new Uint8Array([0xff, 0xd8])),
        export_gif: vi.fn(() => new Uint8Array([0x47, 0x49])),
      },
    },
    openPhotoshopRawPath: vi.fn(async () => {}),
    loadDicomPaths: vi.fn(async (paths: string[]) => paths.length),
    store: {
      state: { activeDocId: 3, activeLayerId: 4, documents: [] as unknown[] },
      docContentRevision: vi.fn(() => 11),
      setDocPathAfterSave: vi.fn(() => true),
    },
    // Imported by commands.ts for the other tool families; unused here.
    adj: {}, fil: {}, xform: {}, ml: {},
    openPath: vi.fn(), removeDistractions: vi.fn(), removeReflections: vi.fn(),
    splitReflections: vi.fn(), adaptiveWideAngle: vi.fn(),
  };
});
vi.mock("../state/app", () => app);
const dropletFile = vi.hoisted(() => ({ text: "" }));
vi.mock("../state/nativeBoundedRead", () => ({
  readNativeFileBounded: vi.fn(async () => new TextEncoder().encode(dropletFile.text)),
}));

import { batchAction, exportDocumentToPath, listActions, loadDicomSeries, openPhotoshopRawDocument, playAction, runDropletOn, saveDroplet, saveDocumentToPath, scriptRun } from "./commands";
import { mcpManifest } from "./mcp.generated";

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  native.on = true;
});

describe("action playback tools", () => {
  it("lists saved actions as JSON, honoring the query and favorites filter", () => {
    expect(JSON.parse(listActions())).toHaveLength(2);
    expect(JSON.parse(listActions("sharpen"))).toEqual([expect.objectContaining({ id: 8, name: "Sharpen Pass", stepCount: 1 })]);
    expect(JSON.parse(listActions("", true))).toEqual([expect.objectContaining({ id: 7 })]);
  });

  it("plays a saved action, passing Play From Here through", async () => {
    await expect(playAction(7)).resolves.toBe('Played "Web Export"');
    expect(app.actions.playNamed).toHaveBeenCalledWith(7, 0);
    await expect(playAction(7, 2)).resolves.toBe('Played "Web Export" from step 2');
    expect(app.actions.playNamed).toHaveBeenLastCalledWith(7, 2);
  });

  // playNamed silently returns for an unknown id, so a thin wrapper would have
  // reported a successful play of an action that does not exist.
  it("refuses an unknown action id instead of reporting a fake play", async () => {
    await expect(playAction(99)).rejects.toThrow("No such action #99");
    expect(app.actions.playNamed).not.toHaveBeenCalled();
  });

  it("batches the action over the open documents and reports processed + errors", async () => {
    await expect(batchAction(8, "/out", "jpeg", "{name}_web")).resolves.toBe(
      JSON.stringify({ action: "Sharpen Pass", processed: 2, errors: [{ name: "b.png", message: "boom" }] }),
    );
    expect(app.batchProcess).toHaveBeenCalledWith({
      source: "opened", actionId: 8, destDir: "/out", format: "jpeg", template: "{name}_web",
    });
  });

  it("rejects an unknown action and a destination folder outside the desktop app", async () => {
    await expect(batchAction(99)).rejects.toThrow("No such action #99");
    native.on = false;
    await expect(batchAction(8, "/out")).rejects.toThrow("only available in the desktop app");
    expect(app.batchProcess).not.toHaveBeenCalled();
  });
});

describe("Photoshop plug-in formats (#466)", () => {
  it("opens Photoshop Raw with the dialog's layout, and refuses what the dialog can't express", async () => {
    await expect(openPhotoshopRawDocument("/scans/a.raw", 640, 480, 1, 16, false, "ibm", 128))
      .resolves.toBe("Opened /scans/a.raw as 640 × 480 Photoshop Raw");
    expect(app.openPhotoshopRawPath).toHaveBeenCalledWith("/scans/a.raw", {
      width: 640, height: 480, channels: 1, depth: 16, interleaved: false, bigEndian: false, header: 128,
    });
    await expect(openPhotoshopRawDocument("/scans/a.raw", 640, 480, 3, 12)).rejects.toThrow("depth must be 8 or 16");
    native.on = false;
    await expect(openPhotoshopRawDocument("/scans/a.raw", 640, 480)).rejects.toThrow("only available in the desktop app");
    expect(app.openPhotoshopRawPath).toHaveBeenCalledTimes(1);
  });

  it("loads a DICOM series as layers and fails when nothing opened", async () => {
    app.loadDicomPaths.mockImplementationOnce(async (paths: string[]) => {
      app.store.state.documents.push({});
      return paths.length;
    });
    await expect(loadDicomSeries(["/ct/2.dcm", "/ct/1.dcm"])).resolves.toBe("Loaded 2 DICOM files as layers");
    expect(app.loadDicomPaths).toHaveBeenCalledWith(["/ct/2.dcm", "/ct/1.dcm"]);
    // A slice the engine refused is not reported as loaded.
    app.loadDicomPaths.mockImplementationOnce(async () => { app.store.state.documents.push({}); return 2; });
    await expect(loadDicomSeries(["/ct/1.dcm", "/ct/bad.dcm", "/ct/3.dcm"])).resolves.toBe("Loaded 2 DICOM files as layers; 1 could not be opened");
    await expect(loadDicomSeries(["/ct/bad.dcm"])).rejects.toThrow("None of the DICOM files could be opened");
    await expect(loadDicomSeries([])).rejects.toThrow("at least one DICOM file");
  });

  it("exports JPEG 2000 and Photoshop Raw as flat copies", async () => {
    await expect(exportDocumentToPath("/out/scan.jp2")).resolves.toBe("Exported /out/scan.jp2");
    await expect(exportDocumentToPath("/out/scan.raw")).resolves.toBe("Exported /out/scan.raw");
    expect(app.bytesForExt).toHaveBeenCalledWith("jp2", { docId: 3, quality: 92 });
    expect(app.bytesForExt).toHaveBeenCalledWith("raw", { docId: 3, quality: 92 });
  });
});

describe("action.saveDroplet (#469)", () => {
  it("saves a saved action by name, as Create Droplet does, and refuses an unknown one", async () => {
    await expect(saveDroplet("/drops/Web.app", 7, "jpeg", "{name}_web", "/out", true)).resolves.toBe("Saved droplet /drops/Web.app");
    expect(app.saveDropletFile).toHaveBeenCalledWith("/drops/Web.app", {
      actionId: 7, actionName: "Web Export", format: "jpeg", template: "{name}_web", destDir: "/out", stopOnError: true,
    });
    await expect(saveDroplet("/drops/x.json", 99)).rejects.toThrow("No such action #99");
    native.on = false;
    await expect(saveDroplet("/drops/x.json", 7)).rejects.toThrow("only available in the desktop app");
    expect(app.saveDropletFile).toHaveBeenCalledOnce();
  });
});

describe("action.runDroplet (#469)", () => {
  it("runs a saved droplet over the given images and folders, and refuses other JSON", async () => {
    const droplet = { actionName: "Web Export", format: "jpeg", template: "{name}_web", destDir: "/out", stopOnError: true };
    dropletFile.text = JSON.stringify(droplet);
    await expect(runDropletOn("/drops/Web.json", ["/in/a.jpg", "/in/more"])).resolves.toBe(
      JSON.stringify({ processed: 1, errors: [] }),
    );
    expect(app.runDroplet).toHaveBeenCalledWith(droplet, ["/in/a.jpg", "/in/more"]);

    dropletFile.text = JSON.stringify({ name: "package", format: "png" });
    await expect(runDropletOn("/drops/package.json", ["/in/a.jpg"])).rejects.toThrow("/drops/package.json is not a Monet droplet");
    native.on = false;
    await expect(runDropletOn("/drops/Web.json", ["/in/a.jpg"])).rejects.toThrow("only available in the desktop app");
    expect(app.runDroplet).toHaveBeenCalledOnce();
  });
});

describe("save / export to a path", () => {
  it("writes project bytes and re-targets the tab for both lossless project formats", async () => {
    await expect(saveDocumentToPath("/docs/Sunset.mvision")).resolves.toBe("Saved /docs/Sunset.mvision");
    await expect(saveDocumentToPath("/docs/Sunset.MVIS")).resolves.toBe("Saved /docs/Sunset.MVIS");
    expect(writes).toEqual([
      { path: "/docs/Sunset.mvision", bytes: new Uint8Array([7]) },
      { path: "/docs/Sunset.MVIS", bytes: new Uint8Array([4]) },
    ]);
    expect(app.bytesForExt).toHaveBeenNthCalledWith(1, "mvision", { docId: 3, quality: 92 });
    expect(app.bytesForExt).toHaveBeenNthCalledWith(2, "mvis", { docId: 3, quality: 92 });
    expect(app.store.setDocPathAfterSave).toHaveBeenCalledWith(3, "/docs/Sunset.mvision", 11);
    expect(app.store.setDocPathAfterSave).toHaveBeenCalledWith(3, "/docs/Sunset.MVIS", 11);
  });

  // #237: a flattened copy that re-targets the tab and marks it clean is how
  // layered work gets lost — only the lossless project format may do that.
  it("writes a flattened copy without re-targeting the document", async () => {
    await saveDocumentToPath("/docs/Sunset.psd");
    await saveDocumentToPath("/docs/Sunset.png");
    expect(writes.map((w) => Array.from(w.bytes))).toEqual([[3], [3]]);
    expect(app.store.setDocPathAfterSave).not.toHaveBeenCalled();
  });

  it("refuses an extension nothing can read back, and the browser build", async () => {
    await expect(saveDocumentToPath("/docs/Sunset.cr2")).rejects.toThrow("Unsupported save extension: .cr2");
    await expect(saveDocumentToPath("/docs/Sunset")).rejects.toThrow("Unsupported save extension: .(none)");
    expect(writes).toHaveLength(0);
    native.on = false;
    await expect(saveDocumentToPath("/docs/Sunset.mvision")).rejects.toThrow("only available in the desktop app");
    expect(app.bytesForExt).toHaveBeenCalledTimes(2);
  });

  it("exports a raster copy at the requested quality and leaves the document alone", async () => {
    await expect(exportDocumentToPath("/out/hero.jpg", 60)).resolves.toBe("Exported /out/hero.jpg");
    expect(app.bytesForExt).toHaveBeenCalledWith("jpg", { docId: 3, quality: 60 });
    expect(writes).toEqual([{ path: "/out/hero.jpg", bytes: new Uint8Array([3]) }]);
    expect(app.store.setDocPathAfterSave).not.toHaveBeenCalled();

    await exportDocumentToPath("/out/hero.jpg", 999); // clamped, not passed through
    expect(app.bytesForExt).toHaveBeenLastCalledWith("jpg", { docId: 3, quality: 100 });
  });

  it("inherits additional Save As formats from the shared encoder", async () => {
    await expect(exportDocumentToPath("/out/hero.TIFF")).resolves.toBe("Exported /out/hero.TIFF");
    expect(app.bytesForExt).toHaveBeenCalledWith("tiff", { docId: 3, quality: 92 });
    expect(writes).toEqual([{ path: "/out/hero.TIFF", bytes: new Uint8Array([4]) }]);
  });

  it("propagates the shared read-only Photoshop guard before writing PSD or PSB", async () => {
    const blocked = new Error("Export the original or convert it to RGB before saving an editable copy.");
    app.bytesForExt.mockRejectedValueOnce(blocked).mockRejectedValueOnce(blocked);

    await expect(saveDocumentToPath("/docs/imported.psd")).rejects.toThrow("convert it to RGB");
    await expect(saveDocumentToPath("/docs/imported.psb")).rejects.toThrow("convert it to RGB");

    expect(app.bytesForExt).toHaveBeenNthCalledWith(1, "psd", { docId: 3, quality: 92 });
    expect(app.bytesForExt).toHaveBeenNthCalledWith(2, "psb", { docId: 3, quality: 92 });
    expect(writes).toHaveLength(0);
  });

  it("routes project formats to doc.saveAs instead of silently flattening them", async () => {
    await expect(exportDocumentToPath("/out/hero.mvision")).rejects.toThrow("use doc.saveAs");
    expect(writes).toHaveLength(0);
  });
});

describe("script.run", () => {
  it("returns the script's log output", async () => {
    app.runScript.mockResolvedValueOnce("✓ 12 layers");
    await expect(scriptRun("vision.log(12 + ' layers')")).resolves.toBe("✓ 12 layers");
    expect(app.runScript).toHaveBeenCalledWith("vision.log(12 + ' layers')");
  });

  it("reports a silent run without pretending it failed", async () => {
    await expect(scriptRun("vision.invert()")).resolves.toMatch(/no output/);
  });

  // runScript resolves (never rejects) on a disallowed op or a timeout, so the
  // wrapper has to turn that resolved string into a tool error.
  it("turns a resolved sandbox failure into a tool error", async () => {
    app.runScript.mockResolvedValueOnce("Disallowed op: fs.write");
    await expect(scriptRun("fs.write()")).rejects.toThrow("Disallowed op: fs.write");
    app.runScript.mockResolvedValueOnce("Script timed out after 2000 ms");
    await expect(scriptRun("while(true){}")).rejects.toThrow("Script timed out after 2000 ms");
  });

  it("rejects a script over the published size limit before running it", async () => {
    const schema = mcpManifest.tools.find((t) => t.name === "script.run")?.inputSchema.properties?.code;
    expect(schema).toMatchObject({ type: "string", maxLength: 1_048_576 });
    await expect(scriptRun("x".repeat(schema!.maxLength! + 1))).rejects.toThrow("1 MiB limit");
    expect(app.runScript).not.toHaveBeenCalled();
  });
});

describe("manifest", () => {
  it("publishes every automation tool with its required arguments", () => {
    const byName = new Map(mcpManifest.tools.map((t) => [t.name, t.inputSchema]));
    expect(byName.get("action.list")).toMatchObject({ properties: { favoritesOnly: { type: "boolean", default: false } } });
    expect(byName.get("action.list")?.required).toBeUndefined(); // both args optional
    expect(byName.get("action.play")).toMatchObject({ properties: { actionId: { type: "number" } }, required: ["actionId"] });
    expect(byName.get("action.batch")).toMatchObject({
      properties: { format: { enum: ["png", "jpeg", "tiff"] } },
      required: ["actionId"],
    });
    expect(byName.get("doc.saveAs")).toMatchObject({ properties: { path: { type: "string" } }, required: ["path"] });
    expect(byName.get("doc.exportAs")).toMatchObject({
      properties: { quality: { type: "number", minimum: 1, maximum: 100 } },
      required: ["path"],
    });
    expect(byName.get("script.run")).toMatchObject({ required: ["code"] });
    expect(byName.get("action.runDroplet")).toMatchObject({
      properties: { paths: { type: "array", items: { type: "string" } } },
      required: ["dropletPath", "paths"],
    });
  });
});
