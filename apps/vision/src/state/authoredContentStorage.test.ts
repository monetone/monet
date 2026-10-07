// User-authored local libraries must report rejected writes instead of silently
// showing session-only content that disappears on restart.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { serializeBrushTips } from "./brushTips";
import { Store } from "./store";

const installStorage = () => {
  const cells = new Map<string, string>();
  let rejected = false;
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (key: string) => cells.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (rejected) throw new DOMException("quota", "QuotaExceededError");
      cells.set(key, value);
    },
    removeItem: (key: string) => { cells.delete(key); },
  } as Storage;
  return { cells, reject: () => { rejected = true; } };
};

describe("user-authored localStorage libraries", () => {
  it("surfaces quota failures from every Store-owned library", () => {
    const storage = installStorage();
    storage.cells.set("mv.brushTips", JSON.stringify(serializeBrushTips([
      { name: "Tip 1", w: 1, h: 1, alpha: new Uint8Array([255]) },
    ])));
    const onEditError = vi.fn();
    const e = { set_brush_tip_active: vi.fn() };
    const store = new Store({ onCommit: null, onEditError, engine: e, e, sync: vi.fn() } as never);
    store.loadBrushTips();
    storage.reject();

    store.addSwatch("#123456");
    store.importBrushPresets([]);
    store.importToolPresets([]);
    store.importGradientPresets([]);
    store.importStylePresets([]);
    store.importCustomShapes([]);
    store.importPatternPresets([{ name: "Dot", w: 1, h: 1, px: Uint16Array.from([0, 0, 0, 65535]) }]);
    store.resetPixelAspectPresets("replace");
    store.setMeasureScalePresets([{ name: "Print", px: 300, units: 1, unit: "in" }]);
    store.removeBrushTip(0);

    expect(onEditError.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("swatches"),
      expect.stringContaining("brush presets"),
      expect.stringContaining("tool presets"),
      expect.stringContaining("gradient presets"),
      expect.stringContaining("style presets"),
      expect.stringContaining("custom shapes"),
      expect.stringContaining("pattern presets"),
      expect.stringContaining("pixel aspect presets"),
      expect.stringContaining("measurement scale presets"),
      expect.stringContaining("custom brush tips"),
    ]);
  });

  it("keeps every app-owned authored library on the shared visible-failure contract", () => {
    const app = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
    const cameraRaw = readFileSync(fileURLToPath(new URL("./cameraRawPresets.ts", import.meta.url)), "utf8");
    const libraries = readFileSync(fileURLToPath(new URL("./libraries.ts", import.meta.url)), "utf8");
    const dialogs = readFileSync(fileURLToPath(new URL("../ui/Dialogs.tsx", import.meta.url)), "utf8");
    const shell = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

    expect(cameraRaw).toContain("persistLocalStorage(LS_KEY");
    expect(libraries).toContain("persistLocalStorage(KEY");
    expect(app).toContain('store.persistAuthoredContent("mv.actions"');
    expect(app).toContain("store.persistAuthoredContent(TYPE_STYLE_KEY");
    expect(app).toContain('store.persistAuthoredContent("mv.typeStyles"');
    expect(dialogs).toContain("store.persistAuthoredContent(SCRIPT_EVENTS_KEY");
    expect(shell).toContain('store.persistAuthoredContent("mv.workspaces"');
  });
});
