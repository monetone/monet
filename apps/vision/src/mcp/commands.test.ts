import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the action layer that fails the way the real engine fails: a
// refused edit leaves the document alone, so `undo_pushes()` does not advance.
// Destructive refusals (locked / text / adjustment layer) also report through
// the edit-error channel; a geometry edit with out-of-range dimensions is just
// silently dropped.
const app = vi.hoisted(() => {
  const state = { pushes: 0 };
  const engine = {
    onEditError: null as ((message: string) => void) | null,
    e: { undo_pushes: () => state.pushes, layer_kind: () => 0 },
  };
  const ok = () => { state.pushes++; }; // the edit landed → one history entry
  return {
    state,
    engine,
    adj: {
      brightnessContrast: vi.fn(ok), exposure: vi.fn(ok), hueSaturation: vi.fn(ok),
      invert: vi.fn(ok), posterize: vi.fn(ok), threshold: vi.fn(ok), vibrance: vi.fn(ok),
    },
    fil: {
      box: vi.fn(ok), gaussian: vi.fn(ok), median: vi.fn(ok),
      sharpen: vi.fn(ok), sponge: vi.fn(ok), unsharp: vi.fn(ok),
    },
    xform: {
      crop: vi.fn(ok), flipH: vi.fn(ok), flipV: vi.fn(ok),
      resizeImage: vi.fn(ok), rotate180: vi.fn(ok), rotate90: vi.fn(ok),
    },
    store: {
      state: { activeDocId: 1, activeLayerId: 2, floatDocs: [] as number[] }, addLayer: vi.fn(), setPanelOptions: vi.fn(() => true),
      floatDoc: vi.fn(), floatAllDocs: vi.fn(), consolidateFloats: vi.fn(),
      cameraRawDevelopTarget: vi.fn(() => { ok(); return true; }),
    },
    cascadeFloats: vi.fn(async () => {}),
    openPath: vi.fn(),
    removeDistractions: vi.fn(ok),
    removeReflections: vi.fn(ok),
    splitReflections: vi.fn(ok),
    adaptiveWideAngle: vi.fn(ok),
    ml: {},
    preparePrintJob: vi.fn(async () => ({ png: new Uint8Array([1]), css: "@page{margin:0}" })),
    spoolPrintJob: vi.fn(async () => {}), // unused by print.oneCopy on purpose: going back to it must fail the test below, not throw
  };
});
const print = vi.hoisted(() => ({ printPng: vi.fn(async () => {}) }));

vi.mock("../state/app", () => app);
vi.mock("../print", () => print);

import { brightnessContrast, cameraRawProfiles, cameraRawRecipe, collapseDock, crop, gaussian, loadCameraRawProfile, rotate90, setCameraRawImportOptions, setPanelOptions, setPrintSettings, printOneCopy, floatWindows } from "./commands";
import { loadPrintSettings } from "../state/printSettings";

// #440: print.setSettings saves what Print One Copy prints with; settings that
// cannot print are refused and leave the saved ones alone.
it("print.setSettings saves the settings Print One Copy uses and refuses ones that cannot print", () => {
  const cells = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => cells.get(k) ?? null, setItem: (k: string, v: string) => cells.set(k, v) });
  Object.assign(app.store.state, { doc: { width: 3000, height: 2000 }, resolutionPpi: 300 });
  const layout = JSON.parse(setPrintSettings("a4", true, false, 1, 0.5, false, 50, "photoshop", "working-cmyk", "perceptual"));
  expect(layout).toMatchObject({ width: 5, left: 0.5, top: 1, scale: 50, ppi: 600, colorHandling: "photoshop" });
  const saved = loadPrintSettings();
  expect(saved).toMatchObject({ media: "a4", landscape: true, center: false, fit: false, scale: 50, intent: 0, profile: "cmyk", colorHandling: "photoshop" });

  expect(() => setPrintSettings(undefined, undefined, undefined, undefined, 40)).toThrow(/entirely off the page/);
  expect(() => setPrintSettings(undefined, undefined, undefined, undefined, undefined, undefined, 0)).toThrow(/Scale must be between/);
  expect(() => setPrintSettings(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "loaded"))
    .toThrow(/Load the printer profile/);
  expect(() => setPrintSettings("poster" as never)).toThrow(/Unknown media/);
  expect(loadPrintSettings()).toEqual(saved);
  vi.unstubAllGlobals();
});

// #440: a spool that fails must reach the MCP caller. The File menu toasts it
// (spoolPrintJob); a caller told "sent" for a job that never opened was lied to.
it("print.oneCopy reports a failed spool to its caller instead of claiming it was sent", async () => {
  const cells = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => cells.get(k) ?? null, setItem: (k: string, v: string) => cells.set(k, v) });
  print.printPng.mockRejectedValueOnce(new Error("The print image could not be loaded."));
  await expect(printOneCopy()).rejects.toThrow("The print image could not be loaded.");

  await expect(printOneCopy()).resolves.toBe("Sent the document to the print dialog");
  expect(print.printPng).toHaveBeenLastCalledWith(new Uint8Array([1]), "@page{margin:0}");
  vi.unstubAllGlobals();
});

// #443: bad input changes nothing; a demosaic re-decodes the RAW the workspace shows.
it("cameraRaw.setImportOptions validates both options before changing either", () => {
  const filePrefs = { rawDemosaic: "adaptive", rawDepth: 16 };
  const setFilePrefs = vi.fn((patch: object) => Object.assign(filePrefs, patch));
  const setCameraRawSessionDemosaic = vi.fn((_id: string, demosaic: string) => {
    filePrefs.rawDemosaic = demosaic;
    return true;
  });
  Object.assign(app.store.state, { filePrefs });
  Object.assign(app.store, {
    setFilePrefs,
    setCameraRawSessionDemosaic,
    activeCameraRawSession: () => "camera-raw-2",
    pendingCameraRawSessions: () => [{ sessionId: "camera-raw-1", name: "queued.dng" }],
  });
  expect(() => setCameraRawImportOptions("bilinear", 24)).toThrow(/Use 16 or 32/);
  expect(() => setCameraRawImportOptions("ahd" as never, 32)).toThrow(/Unknown demosaic/);
  expect(setFilePrefs).not.toHaveBeenCalled();
  expect(setCameraRawSessionDemosaic).not.toHaveBeenCalled();

  expect(JSON.parse(setCameraRawImportOptions("bilinear", 32))).toEqual({ demosaic: "bilinear", depth: 32 });
  expect(setCameraRawSessionDemosaic).toHaveBeenCalledWith("camera-raw-2", "bilinear");
  expect(setFilePrefs).toHaveBeenCalledWith({ rawDepth: 32 });

  // With no RAW on screen the demosaic is only the preference for the next
  // open: a queued, not-yet-shown session is not re-decoded behind the user.
  Object.assign(app.store, { activeCameraRawSession: () => null });
  expect(JSON.parse(setCameraRawImportOptions("adaptive"))).toEqual({ demosaic: "adaptive", depth: 32 });
  expect(setCameraRawSessionDemosaic).toHaveBeenCalledTimes(1);
  expect(setFilePrefs).toHaveBeenLastCalledWith({ rawDemosaic: "adaptive" });
});

// #446: an agent loads a .dcp the way Load Profile… does and lists what the RAW on screen is offered.
it("cameraRaw.loadProfile decodes base64 into the library, and cameraRaw.profiles lists the menu", () => {
  const entry = { name: "Studio", model: "Vision E2E", digest: "0123456789ABCDEF0123456789ABCDEF", origin: "user" };
  const importCameraRawProfile = vi.fn(() => entry);
  Object.assign(app.store.state, { cameraRawProfiles: [entry] });
  Object.assign(app.store, {
    importCameraRawProfile,
    activeCameraRawSession: () => "camera-raw-1",
    cameraRawSessionWorking: () => ({ profile: { id: "camera-default", name: "Camera Default", group: "Camera Matching", amount: 1 } }),
    cameraRawProfileMetadata: () => ({ model: "Vision E2E" }),
  });
  expect(() => loadCameraRawProfile("@@not base64")).toThrow(/not valid base64/);
  expect(importCameraRawProfile).not.toHaveBeenCalled();
  expect(JSON.parse(loadCameraRawProfile(btoa("IIRC"), "Studio.dcp"))).toEqual(entry);
  expect(importCameraRawProfile).toHaveBeenCalledWith("Studio.dcp", new Uint8Array([73, 73, 82, 67]));
  const listed = JSON.parse(cameraRawProfiles());
  expect(listed.library).toEqual([entry]);
  expect(listed.menu.map((option: { label: string }) => option.label)).toContain("Studio");
});

// #477: Window ▸ Arrange's float windows are the desktop app's; a browser has none to open.
it("view.floatWindows drives the Arrange float commands on the desktop and refuses in a browser", async () => {
  await expect(floatWindows("float")).rejects.toThrow(/desktop app/);
  expect(app.store.floatDoc).not.toHaveBeenCalled();
  (globalThis as { isTauri?: boolean }).isTauri = true;
  try {
    app.store.state.floatDocs = [1];
    expect(await floatWindows("float")).toBe("[1]");
    expect(app.store.floatDoc).toHaveBeenCalledWith(1); // the active document
    await floatWindows("floatAll");
    expect(app.store.floatAllDocs).toHaveBeenCalledOnce();
    await floatWindows("cascade");
    expect(app.cascadeFloats).toHaveBeenCalledOnce();
    await floatWindows("consolidate");
    expect(app.store.consolidateFloats).toHaveBeenCalledOnce();
  } finally {
    delete (globalThis as { isTauri?: boolean }).isTauri;
  }
});

// #479: Vision seeds only a right dock; collapsing an absent side changed nothing but reported success.
it("view.collapseDock refuses a side with no dock instead of reporting success", () => {
  const setDockCollapsed = vi.fn();
  Object.assign(app.store, { getWorkspace: () => ({ getLayout: () => ({ right: { size: 440 }, floating: [] }), setDockCollapsed }) });
  expect(() => collapseDock("left", true)).toThrow(/no left dock/i);
  expect(setDockCollapsed).not.toHaveBeenCalled();
  expect(collapseDock("right", true)).toBe("right dock collapsed");
  expect(setDockCollapsed).toHaveBeenLastCalledWith("right", true);
});

// #480: an omitted option must keep its current value, not snap back to a default.
it("view.setPanelOptions changes only the options it is given", () => {
  setPanelOptions("swatches", 40);
  expect(app.store.setPanelOptions.mock.lastCall).toStrictEqual([{ swatchThumbnailSize: 40 }]); // no swatchView key, not even undefined
  setPanelOptions("swatches", 16, "list");
  expect(app.store.setPanelOptions).toHaveBeenLastCalledWith({ swatchThumbnailSize: 16, swatchView: "list" });
});

// #480: a size the flyout does not offer is refused with the sizes that work, and no preference is written.
it("view.setPanelOptions refuses an unsupported size without saving anything", () => {
  app.store.setPanelOptions.mockClear();
  expect(() => setPanelOptions("layers", 50)).toThrow("Unsupported thumbnail size 50 for layers; use 24, 40, 64");
  expect(() => setPanelOptions("swatches", 64, "list")).toThrow("use 16, 24, 40");
  expect(app.store.setPanelOptions).not.toHaveBeenCalled();
});

// #58: every adj/fil/xform tool used to return a hard-coded success string
// because the app's action wrappers discard the engine's refusal, so an agent
// kept building a multi-step pipeline on a document that never changed.
describe("mutating MCP tools report refusals instead of a fake success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    app.state.pushes = 0;
    app.engine.onEditError = null;
  });

  it("still confirms an edit the engine actually applied", () => {
    expect(brightnessContrast(10, 5)).toBe("Applied brightness/contrast");
    expect(app.adj.brightnessContrast).toHaveBeenCalledWith(10, 5);
    expect(rotate90(false)).toBe("Rotated 90° CCW");
  });

  it("throws the engine's own message when a destructive edit is refused", () => {
    app.adj.brightnessContrast.mockImplementationOnce(() => {
      app.engine.onEditError?.("Could not apply the edit because the layer is locked.");
    });
    expect(() => brightnessContrast(10, 5)).toThrow("Could not apply the edit because the layer is locked.");
  });

  it("throws when a geometry edit is silently dropped for out-of-range dimensions", () => {
    app.xform.crop.mockImplementationOnce(() => {}); // engine's `if (!dims_ok(..)) return;`
    expect(() => crop(0, 0, 20000, 20000)).toThrow("refused the edit");
    expect(crop(0, 0, 64, 64)).toBe("Cropped to 64×64 at (0,0)");
  });

  it("does not treat the Camera Raw target's true return as proof the engine accepted an edit", () => {
    expect(cameraRawRecipe("{}")).toBe("Applied Camera Raw recipe");
    for (const reason of ["Convert the 32-bit document before this edit.", "The layer is locked."]) {
      app.store.cameraRawDevelopTarget.mockImplementationOnce(() => {
        app.engine.onEditError?.(reason);
        return true; // target existed, but its commit was refused
      });
      expect(() => cameraRawRecipe("{}")).toThrow(reason);
    }
    app.store.cameraRawDevelopTarget.mockImplementationOnce(() => true);
    expect(() => cameraRawRecipe("{}")).toThrow("refused the edit");
  });

  it("leaves the UI's edit-error sink installed and still notified", () => {
    const toast = vi.fn();
    app.engine.onEditError = toast;
    app.fil.gaussian.mockImplementationOnce(() => {
      app.engine.onEditError?.("Could not apply the edit because the layer is a type layer.");
    });

    expect(() => gaussian(4)).toThrow("type layer");
    expect(toast).toHaveBeenCalledWith("Could not apply the edit because the layer is a type layer.");
    expect(app.engine.onEditError).toBe(toast); // restored, not leaked
  });
});
