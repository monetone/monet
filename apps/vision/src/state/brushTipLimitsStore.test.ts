import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { MAX_BRUSH_TIPS, serializeBrushTips, type BrushTip } from "./brushTips";
import { encodeProjectEnvelope } from "./projectEnvelope";
import { Store } from "./store";

const tip = (name: string): BrushTip => ({ name, w: 1, h: 1, alpha: new Uint8Array([255]) });

function installStorage() {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (key: string) => cells.get(key) ?? null,
    setItem: (key: string, value: string) => { cells.set(key, value); },
    removeItem: (key: string) => { cells.delete(key); },
  } as Storage;
}

function fakeEngine() {
  return new Proxy({
    width: () => 1,
    height: () => 1,
    layer_count: () => 0,
    define_brush_from_selection: vi.fn(),
    has_brush_tip: () => true,
    brush_tip_w: () => 1,
    brush_tip_h: () => 1,
    brush_tip_bytes: () => new Uint8Array([255]),
    set_brush_tip: vi.fn(),
    set_brush_tip_active: vi.fn(),
  }, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      return () => 0;
    },
  });
}

function fullStore() {
  const onEditError = vi.fn();
  const e = fakeEngine();
  const client = {
    onCommit: null as null | (() => void),
    onEditError,
    engine: e,
    e,
    lastBrush: [] as number[],
    sync: vi.fn(),
    buildProject: vi.fn(() => e),
    activate(next: typeof e) { this.engine = next; this.e = next; },
  };
  const store = new Store(client as never);
  const full = Array.from({ length: MAX_BRUSH_TIPS }, (_, i) => tip(`Tip ${i + 1}`));
  localStorage.setItem("mv.brushTips", JSON.stringify(serializeBrushTips(full)));
  store.loadBrushTips();
  return { store, client, onEditError };
}

describe("Store custom-brush-tip persistence bounds", () => {
  beforeEach(installStorage);

  it("reports a Define Brush Preset refused at the live-library cap", () => {
    const { store, client, onEditError } = fullStore();

    store.defineBrushPreset();

    expect(store.state.brushTips).toHaveLength(MAX_BRUSH_TIPS);
    expect(onEditError).toHaveBeenCalledWith(expect.stringContaining(`${MAX_BRUSH_TIPS} tips`));
    expect(client.e.set_brush_tip_active).toHaveBeenCalledWith(false);
  });

  it("routes project-open merges through the same cap instead of overfilling", () => {
    const { store, onEditError } = fullStore();
    const project = encodeProjectEnvelope(new Uint8Array([1]), [], {
      colorProfileAssigned: true,
      brushTips: [tip("Imported")],
    });

    store.openProject(project, "bounded.mvision");

    expect(store.state.brushTips).toHaveLength(MAX_BRUSH_TIPS);
    expect(store.state.brushTips.some((item) => item.name === "Imported")).toBe(false);
    expect(onEditError).toHaveBeenCalledWith(expect.stringContaining(`${MAX_BRUSH_TIPS} tips`));
  });
});
