// Preferences ▸ Cursors / Workspace / Camera Raw (#482): each pane is store
// state persisted under its own `mv.*` key, restored and validated at boot.
// The canvas cursor itself is covered in CanvasView.test.ts, the dialog and the
// reload round trip in e2e/preference-panes.spec.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import {
  DEFAULT_CAMERA_RAW_PREFS, DEFAULT_CURSOR_PREFS, DEFAULT_WORKSPACE_PREFS,
  hiddenPanelsPeek, normalizeCameraRawPrefs, normalizeCursorPrefs, normalizeWorkspacePrefs,
} from "./preferencePanes";
import { defaultRecipe, CAMERA_RAW_SOURCE_VERSION, type CameraRawSession } from "./cameraRaw";
import { normalizeWorkingRecipe } from "./visionDevelopRecipe";
import { Store } from "./store";

// Minimal Storage stand-in — the unit suite runs in node, which has none.
function installStorage(): Map<string, string> {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
  return cells;
}

const onEditError = vi.fn();
const makeStore = () => new Store({ engine: null, onCommit: null, lastBrush: [], onEditError } as never);

let cells: Map<string, string>;
beforeEach(() => { cells = installStorage(); onEditError.mockClear(); });

describe("pane preference validation", () => {
  it("coerces each field back onto its choices, keeping the valid ones", () => {
    expect(normalizeCursorPrefs({ painting: "full", crosshairInTip: "yes", other: "fancy" }))
      .toEqual({ ...DEFAULT_CURSOR_PREFS, painting: "full" });
    expect(normalizeWorkspacePrefs({ largeTabs: false, autoShowHiddenPanels: 1 }))
      .toEqual({ ...DEFAULT_WORKSPACE_PREFS, largeTabs: false });
    expect(normalizeCameraRawPrefs({ openInCameraRaw: false, sidecarOnOpen: null }))
      .toEqual({ ...DEFAULT_CAMERA_RAW_PREFS, openInCameraRaw: false });
  });

  it("reads anything that is not an object as the defaults", () => {
    for (const junk of [null, undefined, 7, "normal", [true]]) {
      expect(normalizeCursorPrefs(junk)).toEqual(DEFAULT_CURSOR_PREFS);
      expect(normalizeWorkspacePrefs(junk)).toEqual(DEFAULT_WORKSPACE_PREFS);
      expect(normalizeCameraRawPrefs(junk)).toEqual(DEFAULT_CAMERA_RAW_PREFS);
    }
  });
});

describe("pane preferences in the store", () => {
  it("persist on change and come back on the next launch", () => {
    const store = makeStore();
    store.setCursorPrefs({ painting: "full", crosshairInTip: true });
    store.setWorkspacePrefs({ largeTabs: false });
    store.setCameraRawPrefs({ openInCameraRaw: false });
    const next = makeStore();
    next.loadPreferencePanes();
    expect(next.state.cursorPrefs).toEqual({ ...DEFAULT_CURSOR_PREFS, painting: "full", crosshairInTip: true });
    expect(next.state.workspacePrefs).toEqual({ ...DEFAULT_WORKSPACE_PREFS, largeTabs: false });
    expect(next.state.cameraRawPrefs).toEqual({ ...DEFAULT_CAMERA_RAW_PREFS, openInCameraRaw: false });
  });

  it("loads corrupt or hand-edited storage as the defaults, field by field", () => {
    cells.set("mv.cursorPrefs", "{not json");
    cells.set("mv.workspacePrefs", JSON.stringify({ largeTabs: "no", autoCollapseIconicPanels: false }));
    cells.set("mv.cameraRawPrefs", JSON.stringify([1, 2]));
    const store = makeStore();
    store.loadPreferencePanes();
    expect(store.state.cursorPrefs).toEqual(DEFAULT_CURSOR_PREFS);
    expect(store.state.workspacePrefs).toEqual({ ...DEFAULT_WORKSPACE_PREFS, autoCollapseIconicPanels: false });
    expect(store.state.cameraRawPrefs).toEqual(DEFAULT_CAMERA_RAW_PREFS);
  });

  it("keeps a launch with no saved panes (older prefs) on the defaults", () => {
    cells.set("mv.filePrefs", JSON.stringify({ openJpegAsLayer: true }));
    const store = makeStore();
    store.loadPreferencePanes();
    expect(store.state.cursorPrefs).toEqual(DEFAULT_CURSOR_PREFS);
    expect(store.state.showBrushPreview).toBe(true);
  });

  it("switches View ▸ Show ▸ Brush Preview with the brush-tip choice, both ways", () => {
    const store = makeStore();
    store.setCursorPrefs({ painting: "precise" });
    expect(store.state.showBrushPreview).toBe(false);
    store.setCursorPrefs({ painting: "full" });
    expect(store.state.showBrushPreview).toBe(true);
    // Hiding the preview keeps the chosen tip for when it comes back…
    store.toggleView("showBrushPreview");
    expect(store.state).toMatchObject({ showBrushPreview: false, cursorPrefs: { painting: "full" } });
    store.toggleView("showBrushPreview");
    expect(store.state).toMatchObject({ showBrushPreview: true, cursorPrefs: { painting: "full" } });
    // …and turning it on under a crosshair brings back the Normal tip.
    store.setCursorPrefs({ painting: "standard" });
    store.toggleView("showBrushPreview");
    expect(store.state).toMatchObject({ showBrushPreview: true, cursorPrefs: { painting: "normal" } });
    // View ▸ Show ▸ All turns the preview on only where a tip is chosen.
    store.setCursorPrefs({ painting: "precise" });
    store.setOptions({ showBrushPreview: true, showGrid: true });
    expect(store.state).toMatchObject({ showBrushPreview: false, showGrid: true });
    store.setCursorPrefs({ painting: "full" });
    store.setOptions({ showBrushPreview: false });
    store.setOptions({ showBrushPreview: true });
    expect(store.state.showBrushPreview).toBe(true);
    // A reload restores the preview state the saved choice implies.
    store.setCursorPrefs({ painting: "precise" });
    const next = makeStore();
    next.loadPreferencePanes();
    expect(next.state.showBrushPreview).toBe(false);
  });
});

describe("hidden panels at the window edge", () => {
  it("shows the side the pointer reaches, and keeps it while the pointer is on it", () => {
    expect(hiddenPanelsPeek("", 3, 1000, false)).toBe("left");
    expect(hiddenPanelsPeek("", 997, 1000, false)).toBe("right");
    expect(hiddenPanelsPeek("left", 200, 1000, true)).toBe("left");
    expect(hiddenPanelsPeek("left", 500, 1000, false)).toBe("");
    expect(hiddenPanelsPeek("", 500, 1000, false)).toBe("");
  });
});

describe("Preferences ▸ Camera Raw ▸ Demosaic and Depth", () => {
  it("are the file-handling prefs the workspace menus edit — one stored copy", () => {
    const store = new Store({ engine: null, onCommit: null, lastBrush: [], onEditError, buildRaw: () => ({ free: vi.fn() }) } as never);
    // The workspace's Demosaic menu re-decodes a staged RAW and writes the pref…
    const recipe = normalizeWorkingRecipe(defaultRecipe());
    const state: CameraRawSession = {
      sessionId: "a", invocation: "raw-open", disposition: "pending",
      source: { version: CAMERA_RAW_SOURCE_VERSION, originalName: "a.dng", originalBytes: new Uint8Array([1]), metadata: {}, recipe, demosaic: "adaptive" },
    };
    (store as unknown as { cameraRawSessions: Map<string, unknown> }).cameraRawSessions
      .set("a", { state, engine: { free: vi.fn() }, working: recipe, completion: Promise.resolve("open"), resolveCompletion: vi.fn() });
    expect(store.setCameraRawSessionDemosaic("a", "bilinear")).toBe(true);
    expect(store.state.filePrefs.rawDemosaic).toBe("bilinear");
    // …and the pane's Depth menu writes the same record the workspace reads.
    store.setFilePrefs({ rawDepth: 32 });
    expect(JSON.parse(cells.get("mv.filePrefs")!)).toMatchObject({ rawDemosaic: "bilinear", rawDepth: 32 });
    expect(cells.get("mv.cameraRawPrefs")).toBeUndefined();
    const next = makeStore();
    next.loadWebAndFilePrefs();
    expect(next.state.filePrefs).toMatchObject({ rawDemosaic: "bilinear", rawDepth: 32 });
  });

  it("binds the pane's menus to those prefs with the workspace's own option lists", () => {
    const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    const dialogs = read("../ui/Dialogs.tsx");
    const pane = dialogs.slice(dialogs.indexOf("function CameraRawPane()"), dialogs.indexOf("const PREF_PANES"));
    expect(pane).toContain("useStore((s) => s.filePrefs)");
    expect(pane).toContain("store.setFilePrefs({ rawDemosaic: value as RawDemosaic })");
    expect(pane).toContain("store.setFilePrefs({ rawDepth: Number(value) as RawOpenDepth })");
    const workspace = read("../ui/dialogs/CameraRawWorkspace.tsx");
    for (const options of ["options={RAW_DEMOSAIC_OPTIONS}", "options={RAW_DEPTH_OPTIONS}"]) {
      expect(pane).toContain(options);
      expect(workspace).toContain(options);
    }
  });
});

describe("Preferences ▸ Camera Raw ▸ Show Camera Raw", () => {
  type Internals = {
    cameraRawSessions: Map<string, unknown>;
    cameraRawQueue: string[];
    activeCameraRawSessionId: string | null;
    presentNextCameraRawSession(): void;
  };
  function stage(store: Store) {
    const internal = store as unknown as Internals;
    const recipe = normalizeWorkingRecipe(defaultRecipe());
    const state: CameraRawSession = {
      sessionId: "a", invocation: "raw-open", disposition: "pending",
      source: { version: CAMERA_RAW_SOURCE_VERSION, originalName: "a.dng", originalBytes: new Uint8Array([1]), metadata: {}, recipe },
    };
    internal.cameraRawSessions.set("a", { state, engine: { free: vi.fn() }, working: recipe, completion: Promise.resolve("open"), resolveCompletion: vi.fn() });
    internal.cameraRawQueue.push("a");
    return { internal, recipe };
  }
  const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

  it("shows the workspace by default", async () => {
    const store = makeStore();
    const complete = vi.spyOn(store, "completeCameraRawOpen");
    stage(store).internal.presentNextCameraRawSession();
    await flush();
    expect(store.state.pendingDialog?.name).toBe("cameraRaw");
    expect(complete).not.toHaveBeenCalled();
  });

  it("off, opens with the source's own recipe and no workspace", async () => {
    const store = makeStore();
    store.setCameraRawPrefs({ openInCameraRaw: false });
    const complete = vi.spyOn(store, "completeCameraRawOpen").mockReturnValue(2);
    const { internal, recipe } = stage(store);
    internal.presentNextCameraRawSession();
    await flush();
    expect(complete).toHaveBeenCalledWith("a", recipe, false);
    expect(store.state.pendingDialog).toBeNull();
  });

  it("reports a missing lens profile when opening without the workspace", async () => {
    const store = makeStore();
    store.setCameraRawPrefs({ openInCameraRaw: false });
    vi.spyOn(store, "completeCameraRawOpen").mockReturnValue(2);
    const { internal, recipe } = stage(store);
    recipe.optics.enableProfileCorrections = true;
    recipe.optics.profileName = "Uninstalled lens";
    internal.presentNextCameraRawSession();
    await flush();
    expect(onEditError).toHaveBeenCalledWith(expect.stringContaining("Opened a.dng:"));
    expect(onEditError).toHaveBeenCalledWith(expect.stringContaining("lens profile"));
  });

  it("falls back to the workspace for a recipe this build cannot open, and reports a failed open", async () => {
    const store = makeStore();
    store.setCameraRawPrefs({ openInCameraRaw: false });
    const complete = vi.spyOn(store, "completeCameraRawOpen").mockReturnValueOnce(null);
    stage(store).internal.presentNextCameraRawSession();
    await flush();
    expect(store.state.pendingDialog?.name).toBe("cameraRaw");

    const other = makeStore();
    other.setCameraRawPrefs({ openInCameraRaw: false });
    vi.spyOn(other, "completeCameraRawOpen").mockImplementation(() => { throw new Error("out of memory"); });
    stage(other).internal.presentNextCameraRawSession();
    await flush();
    expect(onEditError).toHaveBeenCalledWith(expect.stringContaining("Could not open a.dng with its Camera Raw settings (out of memory)"));
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("hands each opened image's settings to the sidecar writer only while Save on Open is on", () => {
    // Catch-all doubles (every engine call answers 0, every client call is a
    // no-op): enough for the document adoption to go through.
    const develop = new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : k === "can_super_resolution" || k === "camera_raw_commit" ? () => true : () => 0) });
    const client = new Proxy({ engine: null, onCommit: null, lastBrush: [] } as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : () => undefined),
      set: (t, k, v) => { t[k] = v; return true; },
    });
    const open = (sidecarOnOpen: boolean) => {
      const store = new Store(client as never);
      const { internal, recipe } = stage(store);
      (internal.cameraRawSessions.get("a") as { engine: unknown }).engine = develop;
      internal.cameraRawQueue.length = 0;
      internal.activeCameraRawSessionId = "a";
      const write = vi.fn();
      store.onCameraRawSidecarOnOpen = write;
      store.setCameraRawPrefs({ sidecarOnOpen });
      expect(store.completeCameraRawOpen("a", { ...recipe, basic: { ...recipe.basic, exposure: 0.75 } }, false)).not.toBeNull();
      return write;
    };
    const write = open(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({ originalName: "a.dng", recipe: { basic: { exposure: 0.75 } } });
    expect(open(false)).not.toHaveBeenCalled();
  });

  it("leaves a session an opener settled first (Batch) alone", async () => {
    const store = makeStore();
    store.setCameraRawPrefs({ openInCameraRaw: false });
    const complete = vi.spyOn(store, "completeCameraRawOpen").mockReturnValue(2);
    const { internal } = stage(store);
    internal.presentNextCameraRawSession();
    internal.cameraRawSessions.delete("a");
    await flush();
    expect(complete).not.toHaveBeenCalled();
  });
});
