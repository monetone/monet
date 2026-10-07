// #438: Edit ▸ Color Settings ▸ Advanced reaches the pixels. The blend gammas
// are compositor state in every open document's engine (the Rust tests in
// raster/mod.rs `blend_gamma_tests` prove the composite changes); Desaturate
// Monitor Colors is a display-only step of the blit (EngineClient.test.ts).
// What is proved here is that the store hands both to the right places:
// every open engine, each engine adopted later, and the canvas client.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COLOR_POLICY_PREFS } from "@monet-ui/monet-color";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

/** A recording engine: every call is logged, anything unknown answers 0. */
function fakeEngine() {
  const calls: unknown[][] = [];
  const replies: Record<string, () => unknown> = {
    width: () => 8,
    height: () => 8,
    layer_count: () => 1,
    layer_id_at: () => 1,
    active_layer_id: () => 1,
    layer_name: () => "Background",
    layer_visible: () => true,
    layer_opacity: () => 1,
    layer_fill_opacity: () => 1,
    history_labels: () => [] as string[],
    artboard_ids: () => new Uint32Array(),
  };
  const engine = new Proxy({}, {
    get: (_t, prop: string) => (...args: unknown[]) => {
      if (prop === "set_blend_gamma") calls.push(args);
      if (prop === "flatten") calls.push(["flatten"]);
      return replies[prop]?.() ?? 0;
    },
  });
  return { engine, calls };
}

function makeStore() {
  const engines: ReturnType<typeof fakeEngine>[] = [];
  const client = {
    engine: null as object | null,
    onCommit: null, onSync: null, lastBrush: [] as number[], docGen: 0,
    get e() { return this.engine; },
    buildImage() { const e = fakeEngine(); engines.push(e); return e.engine; },
    buildProject() { return this.buildImage(); },
    projectBytes: () => new Uint8Array([1]),
    layerThumbUrl: () => "", docThumbUrl: () => "",
    setDisplayProfile() {}, setIccProofLut() {},
    activate(engine: object) {
      // The adopted engine must already carry the policy before its first blit.
      activatedWith.push(engines.find((e) => e.engine === engine)!.calls.at(-1));
      this.engine = engine;
    },
    sync: vi.fn(), commit: () => true,
    setMonitorDesaturation: vi.fn(),
    blit: vi.fn(),
  };
  const activatedWith: unknown[] = [];
  return { store: new Store(client as never), client, engines, activatedWith };
}

function installStorage(seed?: string) {
  const cells = new Map<string, string>(seed ? [["mv.colorPolicyPrefs", seed]] : []);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  };
  return cells;
}

afterEach(() => { Reflect.deleteProperty(globalThis, "localStorage"); });

describe("Color Settings ▸ Advanced rendering", () => {
  it("pushes the blend gammas into every open document and each one opened later", () => {
    installStorage();
    const { store, client, engines, activatedWith } = makeStore();
    store.openImage(new Uint8Array(), "A.png", null);
    store.openImage(new Uint8Array(), "B.png", null);
    expect(activatedWith, "off by default: both composite as before").toEqual([[0, 0], [0, 0]]);

    store.setColorPolicyPrefs({
      blendRgbColorsUsingGamma: true, blendRgbGamma: 1,
      blendTextColorsUsingGamma: true, blendTextGamma: 1.45,
      desaturateMonitorColors: true, desaturateMonitorAmount: 30,
    });
    // The background document too: its exports must bake the same blend.
    expect(engines.map((e) => e.calls.at(-1))).toEqual([[1, 1.45], [1, 1.45]]);
    expect(client.setMonitorDesaturation).toHaveBeenLastCalledWith(30);
    expect(client.blit).toHaveBeenCalled();
    // The composite changed, so the panels caching it (Navigator, Histogram)
    // get a resync; a policy-only change does not need one.
    expect(client.sync).toHaveBeenCalledTimes(1);
    store.setColorPolicyPrefs({ pasteProfilePolicy: "convert", desaturateMonitorAmount: 40 });
    expect(client.sync).toHaveBeenCalledTimes(1);

    store.openImage(new Uint8Array(), "C.png", null);
    expect(activatedWith.at(-1)).toEqual([1, 1.45]);

    // Unchecking keeps the value for next time but turns the effect off.
    store.setColorPolicyPrefs({ blendRgbColorsUsingGamma: false, blendTextColorsUsingGamma: false, desaturateMonitorColors: false });
    expect(engines.map((e) => e.calls.at(-1))).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect(client.setMonitorDesaturation).toHaveBeenLastCalledWith(0);
    expect(store.state.colorPolicyPrefs.blendRgbGamma).toBe(1);
  });

  it("bakes the blend into Image ▸ Duplicate ▸ Merged Layers Only", () => {
    installStorage();
    const { store, engines } = makeStore();
    store.openImage(new Uint8Array(), "A.png", null);
    store.setColorPolicyPrefs({ blendRgbColorsUsingGamma: true, blendRgbGamma: 1 });
    store.duplicateDocument("A merged", true);
    // The copy's engine takes the gamma before it flattens.
    expect(engines[1].calls.slice(0, 2)).toEqual([[1, 0], ["flatten"]]);
  });

  it("applies the saved settings at startup", () => {
    installStorage(JSON.stringify({ ...DEFAULT_COLOR_POLICY_PREFS, desaturateMonitorColors: true, desaturateMonitorAmount: 45, blendRgbColorsUsingGamma: true, blendRgbGamma: 1.8 }));
    const { store, client, activatedWith } = makeStore();
    store.loadColorPolicyPrefs();
    expect(client.setMonitorDesaturation).toHaveBeenLastCalledWith(45);
    store.openImage(new Uint8Array(), "A.png", null);
    expect(activatedWith).toEqual([[1.8, 0]]);
  });
});
