// P2 playback, Fit Image, unattended prompts, and script saves. The engine is
// stubbed; these tests drive the action layer the menus and --run-script use.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: true }));
const dialog = vi.hoisted(() => ({
  confirm: vi.fn(async () => false),
  ask: vi.fn(async () => false),
  save: vi.fn(async () => "/tmp/should-not-open.png"),
  open: vi.fn(async () => "/tmp"),
}));
const atomic = vi.hoisted(() => ({
  atomicWriteBytes: vi.fn(async () => {}),
}));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => false),
  mkdir: vi.fn(),
  readDir: vi.fn(async () => []),
  remove: vi.fn(),
}));
vi.mock("./atomicWrite", () => atomic);

import { actions, confirmDiscard, confirmDiscardAll, documentSaveIo, engine, replayScriptOps, runUnattended, store, xform } from "./app";
import { fitWithinScale } from "./imageProcessorIo";
import { ACTIVE_LAYER_ARG } from "./actionSets";

const appSource = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");

function installStorage(): void {
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

function patch(next: object): void {
  (store as unknown as { set(patch: object): void }).set(next);
}

let onSync: typeof engine.onSync;
const bytesForExt = documentSaveIo.bytesForExt;

beforeEach(() => {
  installStorage();
  onSync = engine.onSync;
  engine.onSync = null;
  engine.engine = null;
  actions.clearNamed();
  actions.stop();
  actions.setPlaybackMode("accelerated");
  dialog.confirm.mockClear();
  dialog.ask.mockClear();
  dialog.save.mockClear();
  dialog.open.mockClear();
  atomic.atomicWriteBytes.mockReset();
  atomic.atomicWriteBytes.mockResolvedValue(undefined);
  documentSaveIo.bytesForExt = bytesForExt;
  tauri.enabled = true;
});

afterEach(() => {
  engine.onSync = onSync;
  engine.engine = null;
  actions.stop();
  documentSaveIo.bytesForExt = bytesForExt;
  patch({ mode: 0, activeLayerId: 0, layers: [], doc: { ...store.state.doc, width: 0, height: 0 } });
});

describe("Conditional Mode Change and Fit Image (#530)", () => {
  it("records the outer conditional, and a later document in another mode is left alone", async () => {
    const convert = vi.fn();
    engine.engine = {
      undo_pushes: () => 0,
      convert_grayscale: convert,
      last_edit_error: () => "",
      width: () => 0,
      height: () => 0,
    } as never;
    patch({ mode: 0 });
    actions.start();
    store.conditionalModeChange([0], 1);
    actions.stop();
    expect(convert).toHaveBeenCalledOnce();
    const id = actions.save("To gray");
    expect(actions.getSteps(id)).toHaveLength(1);
    const json = actions.exportJson();
    expect(json).toContain("store.conditionalModeChange");
    expect(json).not.toContain("store.convertGrayscale");
    expect(json).not.toContain("store.setColorMode");
    patch({ mode: 2 });
    await actions.playNamed(id);
    expect(store.state.mode).toBe(2);
    expect(convert).toHaveBeenCalledOnce();
  });

  it("records Fit Image as the box, and a portrait file is not upscaled to it", () => {
    patch({ doc: { ...store.state.doc, width: 800, height: 600 } });
    actions.start();
    xform.fitImage(1920, 1920);
    actions.stop();
    const id = actions.save("Fit");
    expect(actions.getSteps(id)).toHaveLength(1);
    const json = actions.exportJson();
    expect(json).toContain("xform.fitImage");
    expect(json).toContain("1920");
    expect(json).not.toContain("xform.resizeImage");
    expect(fitWithinScale(3000, 4000, 1920, 1920)).toBeCloseTo(1920 / 4000);
    expect(fitWithinScale(800, 600, 1920, 1920)).toBe(1);
  });
});

describe("recorded steps keep the call's id and store the play-time target (#521)", () => {
  it("collapses an opacity drag on the active layer and still calls the engine with that id", () => {
    const setOpacity = vi.fn();
    engine.engine = {
      set_active_layer: vi.fn(),
      set_mask_edit: vi.fn(),
      set_layer_opacity: setOpacity,
      last_edit_error: () => "",
      width: () => 0,
      height: () => 0,
      undo_pushes: () => 0,
    } as never;
    patch({
      activeLayerId: 4,
      layers: [{ id: 1, name: "Background", kind: 0, visible: true, locked: false, locks: 0, opacity: 100, blend: "normal", hasMask: false }, { id: 4, name: "Photo", kind: 0, visible: true, locked: false, locks: 0, opacity: 100, blend: "normal", hasMask: false }],
    });
    actions.start();
    store.selectLayer(4);
    store.setLayerOpacity(4, 40);
    store.setLayerOpacity(4, 80);
    actions.stop();
    const id = actions.save("Opacity");
    expect(actions.getSteps(id)).toHaveLength(2);
    const json = actions.exportJson();
    expect(json).toContain('"name":"Photo"');
    expect(json).toContain('"$active":1');
    expect(setOpacity).toHaveBeenLastCalledWith(4, 0.8);
    expect(json.match(/store\.setLayerOpacity/g)).toHaveLength(1);
    expect(ACTIVE_LAYER_ARG.$active).toBe(1);
  });
});

describe("Merge Down defaults to the active layer (#533)", () => {
  it("calls merge_down with the active id when the step carries none", () => {
    const merge = vi.fn();
    engine.engine = {
      merge_down: merge,
      last_edit_error: () => "",
      width: () => 0,
      height: () => 0,
      undo_pushes: () => 0,
    } as never;
    patch({ activeLayerId: 7 });
    store.mergeDown();
    expect(merge).toHaveBeenCalledWith(7);
  });
});

describe("unattended playback (#523)", () => {
  it("continues a modal step and a continuable Stop without opening a native dialog", async () => {
    const portable = {
      name: "Pause", favorite: false, createdAt: 1, set: "Test",
      steps: [[actions.menuItemPaths()[0], []]] as [string, unknown[]][],
    };
    const { serializeActionsFile } = await import("./actionSets");
    expect(actions.importJson(serializeActionsFile([portable])).imported).toBe(1);
    const id = actions.list().find((a) => a.name === "Pause")!.id;
    actions.setStepEnabled(id, 0, false);
    expect(actions.insertMenuItem(id, "log")).toBe(true);
    actions.setStepDialog(id, 1, true);
    actions.insertStop(id, "hold on", true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { value, alerts } = await runUnattended(() => actions.playNamed(id));
    log.mockRestore();
    expect(value).toBe(true);
    expect(alerts).toEqual(["hold on\n\nContinue playing this action?"]);
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(dialog.ask).not.toHaveBeenCalled();
    expect(dialog.save).not.toHaveBeenCalled();
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it("takes the OK branch of a discard prompt without asking", async () => {
    await runUnattended(async () => {
      expect(await confirmDiscard("Shot")).toBe(true);
      expect(await confirmDiscardAll(["Shot", "Other"])).toBe(true);
    });
    expect(dialog.ask).not.toHaveBeenCalled();
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it("checks the unattended flag before importing a save or export dialog", () => {
    const untilImport = (start: string, needle: string) => {
      const from = appSource.indexOf(start);
      expect(from).toBeGreaterThanOrEqual(0);
      const at = appSource.indexOf(needle, from);
      expect(at).toBeGreaterThan(from);
      return appSource.slice(from, at);
    };
    expect(untilImport("async function saveBytesNative(", 'await import("@tauri-apps/plugin-dialog")')).toContain("if (_unattended)");
    expect(untilImport("async function pickExportFolder(", 'await import("@tauri-apps/plugin-dialog")')).toContain("if (_unattended)");
    expect(untilImport("async function saveDocumentAsImpl(", 'await import("@tauri-apps/plugin-dialog")')).toContain("if (_unattended)");
    expect(untilImport("async function confirmPlaybackPause(", 'await import("@tauri-apps/plugin-dialog")')).toContain("if (_unattended)");
    expect(untilImport("export async function chooseUnsavedAction(", 'await import("@tauri-apps/plugin-dialog")')).toContain("if (_unattended)");
    expect(appSource).toContain("export async function confirmDiscardAll(names: string[]): Promise<boolean> {\n  if (_unattended) return true;");
  });
});

describe("script save and export wait for the write (#518)", () => {
  it("does not resolve until the path write settles, and a rejected write is a script error", async () => {
    documentSaveIo.bytesForExt = async () => ({ bytes: new Uint8Array([1, 2, 3, 4]), mime: "image/png" });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    atomic.atomicWriteBytes.mockImplementation(() => gate);
    let settled = false;
    const run = replayScriptOps([["exportAs", ["/tmp/out.png", 80]]]).then(() => { settled = true; });
    await vi.waitFor(() => expect(atomic.atomicWriteBytes).toHaveBeenCalledWith("/tmp/out.png", expect.any(Uint8Array)));
    expect(settled).toBe(false);
    release();
    await run;
    expect(settled).toBe(true);

    atomic.atomicWriteBytes.mockRejectedValueOnce(new Error("disk full"));
    await expect(replayScriptOps([["saveAs", ["/tmp/out.mvision"]]])).rejects.toThrow(/saveAs failed/);
    await expect(replayScriptOps([["exportAs", ["monet-vision"]]])).rejects.toThrow(/Engine not ready/);
    expect(atomic.atomicWriteBytes).toHaveBeenCalledTimes(2);
  });
});
