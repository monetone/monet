// Store wiring for stacked layer-effect instances (VIS-LS instance model): the
// Layer Style clipboard (copy/paste) and Styles-panel apply both go through
// captureStyle/pasteLayerStyle/applyStylePreset, which now address instances via
// set_layer_effect_at rather than collapsing a type to one. Engine-free (node) —
// a small fake engine mirrors the real one's per-instance semantics (see
// packages/engine/src/raster/mod.rs's set_layer_effect_at/layer_effect_count/
// layer_effect_params_at) so these are true round-trip tests, not just "some
// mock method got called". Mirrors storePreferences.test.ts's newStore() idiom.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";
import { FX, FX_MAX_INSTANCES } from "./effects";
import type { StylePreset } from "./stylePresets";

/** Mirrors the engine's per-layer effect list: an ordered (fx, params) vec,
 *  addressed by (fx, index-within-that-fx) — same rules as set_layer_effect_at:
 *  empty params removes an instance, an out-of-range index appends (capped at
 *  FX_MAX_INSTANCES), and set_layer_effect (whole-type) reads/writes index 0. */
class FakeEngine {
  private byLayer = new Map<number, Array<[number, number[]]>>();
  private blendIfByLayer = new Map<number, number[]>();
  private fillOpacityByLayer = new Map<number, number>();

  layer_effect_count(id: number, fx: number): number {
    return (this.byLayer.get(id) ?? []).filter(([e]) => e === fx).length;
  }
  layer_effect_params_at(id: number, fx: number, index: number): Float32Array {
    const inst = (this.byLayer.get(id) ?? []).filter(([e]) => e === fx)[index];
    return Float32Array.from(inst ? inst[1] : []);
  }
  layer_effect_params(id: number, fx: number): Float32Array {
    return this.layer_effect_params_at(id, fx, 0);
  }
  set_layer_effect_at(id: number, fx: number, index: number, params: Float32Array) {
    const list = this.byLayer.get(id) ?? [];
    const matches = list.map((entry, i) => [entry, i] as const).filter(([entry]) => entry[0] === fx);
    const target = matches[index];
    if (params.length === 0) {
      if (target) list.splice(target[1], 1);
    } else if (target) {
      list[target[1]] = [fx, Array.from(params)];
    } else if (matches.length < FX_MAX_INSTANCES) {
      list.push([fx, Array.from(params)]);
    }
    this.byLayer.set(id, list);
  }
  set_layer_effect(id: number, fx: number, params: Float32Array) {
    const list = (this.byLayer.get(id) ?? []).filter(([e]) => e !== fx);
    if (params.length) list.push([fx, Array.from(params)]);
    this.byLayer.set(id, list);
  }
  clear_layer_effects(id: number) {
    this.byLayer.set(id, []);
  }
  /** The layer-style setters above are RAW by contract — the caller owns the
   *  snapshot. Paste / Clear / Apply Style used to skip it, so destroying a
   *  style cost zero undo steps. Recorded here so the tests can assert it. */
  historyPushes: string[] = [];
  private transactionDepth: number | null = null;
  private pushes = 0;
  begin_history_transaction() {
    if (this.transactionDepth !== null) return false;
    this.transactionDepth = this.historyPushes.length;
    return true;
  }
  cancel_history_transaction() {
    if (this.transactionDepth === null) return false;
    this.historyPushes.splice(this.transactionDepth);
    this.transactionDepth = null;
    return true;
  }
  commit_history_transaction() {
    if (this.transactionDepth === null) return false;
    const changed = this.historyPushes.length > this.transactionDepth;
    if (!changed) { this.cancel_history_transaction(); return false; }
    this.transactionDepth = null;
    return true;
  }
  undo_pushes() { return this.pushes; }
  push_history(label: string) {
    this.historyPushes.push(label);
    this.pushes++;
  }
  set_layer_blend_if(id: number, v: Float32Array) {
    this.blendIfByLayer.set(id, Array.from(v));
  }
  layer_blend_if(id: number): Float32Array {
    return Float32Array.from(this.blendIfByLayer.get(id) ?? []);
  }
  set_layer_fill_opacity(id: number, v: number) {
    this.fillOpacityByLayer.set(id, v);
  }
  set_layer_knockout() {}
  set_layer_transparency_shapes() {}
  set_layer_blend_interior_group() {}
  set_layer_blend_clipped_group() {}
  layer_fill_opacity(id: number): number {
    return this.fillOpacityByLayer.get(id) ?? 1;
  }
}

function newStore() {
  const fake = new FakeEngine();
  const client = { onCommit: null as null | (() => void), engine: fake, e: fake, sync: vi.fn(), blit: vi.fn(), refreshFromEngine: vi.fn(), buildNew: vi.fn(() => fake), commit: vi.fn() };
  return { store: new Store(client as never), fake, client };
}

const LAYER_ID = 1;
const strokeA = [1, 0, 1, 1, 0, 0, 3, 0]; // inner-ish stroke
const strokeB = [1, 0, 1, 1, 1, 1, 8, 1]; // outer-ish stroke, different colour/size

describe("captureStyle → pasteLayerStyle (Layer Style clipboard)", () => {
  it("round-trips a stacked style — two strokes on the source layer both land on the target", () => {
    const { store, fake } = newStore();
    fake.set_layer_effect_at(LAYER_ID, FX.STROKE, 0, Float32Array.from(strokeA));
    fake.set_layer_effect_at(LAYER_ID, FX.STROKE, 1, Float32Array.from(strokeB));
    fake.set_layer_fill_opacity(LAYER_ID, 0.8);

    store.state.activeLayerId = LAYER_ID;
    store.copyLayerStyle();

    const TARGET_ID = 2;
    store.state.activeLayerId = TARGET_ID;
    store.pasteLayerStyle();

    expect(fake.layer_effect_count(TARGET_ID, FX.STROKE)).toBe(2);
    expect(Array.from(fake.layer_effect_params_at(TARGET_ID, FX.STROKE, 0))).toEqual(strokeA);
    expect(Array.from(fake.layer_effect_params_at(TARGET_ID, FX.STROKE, 1))).toEqual(strokeB);
    expect(fake.layer_fill_opacity(TARGET_ID)).toBeCloseTo(0.8, 5);
  });

  it("paste fully replaces the target's existing stack rather than merging", () => {
    const { store, fake } = newStore();
    fake.set_layer_effect_at(LAYER_ID, FX.DROP_SHADOW, 0, Float32Array.from([1, 0, 0.5, 0, 0, 0, 120, 5]));

    const TARGET_ID = 2;
    fake.set_layer_effect_at(TARGET_ID, FX.STROKE, 0, Float32Array.from(strokeA)); // pre-existing, unrelated effect

    store.state.activeLayerId = LAYER_ID;
    store.copyLayerStyle();
    store.state.activeLayerId = TARGET_ID;
    store.pasteLayerStyle();

    expect(fake.layer_effect_count(TARGET_ID, FX.STROKE)).toBe(0); // replaced, not merged
    expect(fake.layer_effect_count(TARGET_ID, FX.DROP_SHADOW)).toBe(1);
  });
});

describe("applyStylePreset — a preset with two strokes applies both", () => {
  it("pushes every instance of the stacked effect onto the active layer", () => {
    const { store, fake } = newStore();
    const preset: StylePreset = {
      name: "Double Stroke",
      style: {
        effects: [
          { fx: FX.STROKE, params: strokeA },
          { fx: FX.STROKE, params: strokeB },
        ],
        blendIf: [],
        fillOpacity: 100,
      },
    };
    store.importStylePresets([preset]);
    store.state.activeLayerId = LAYER_ID;
    store.applyStylePreset(0);

    expect(fake.layer_effect_count(LAYER_ID, FX.STROKE)).toBe(2);
    expect(Array.from(fake.layer_effect_params_at(LAYER_ID, FX.STROKE, 0))).toEqual(strokeA);
    expect(Array.from(fake.layer_effect_params_at(LAYER_ID, FX.STROKE, 1))).toEqual(strokeB);
  });
});

describe("instance-level store ops", () => {
  it("drops a queued live edit after the active engine changes", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.push(fn); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      const { store, fake, client } = newStore();
      const next = new FakeEngine();
      store.setEffectAt(LAYER_ID, FX.STROKE, 0, strokeA, true);
      client.engine = next;
      client.e = next;

      frames[0](0);

      expect(fake.layer_effect_count(LAYER_ID, FX.STROKE)).toBe(0);
      expect(next.layer_effect_count(LAYER_ID, FX.STROKE)).toBe(0);
      expect(client.blit).not.toHaveBeenCalled();
      store.cancelLive();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("effectInstanceCount / effectParamsAt / setEffectAt add, edit, and remove one instance", () => {
    const { store } = newStore();
    expect(store.effectInstanceCount(LAYER_ID, FX.STROKE)).toBe(0);

    store.setEffectAt(LAYER_ID, FX.STROKE, 0, strokeA);
    store.setEffectAt(LAYER_ID, FX.STROKE, 1, strokeB);
    expect(store.effectInstanceCount(LAYER_ID, FX.STROKE)).toBe(2);
    expect(store.effectParamsAt(LAYER_ID, FX.STROKE, 1)).toEqual(strokeB);

    store.removeEffectAt(LAYER_ID, FX.STROKE, 0);
    expect(store.effectInstanceCount(LAYER_ID, FX.STROKE)).toBe(1);
    expect(store.effectParamsAt(LAYER_ID, FX.STROKE, 0)).toEqual(strokeB); // the survivor shifted down
  });

  it("never grows a type past FX_MAX_INSTANCES", () => {
    const { store } = newStore();
    for (let i = 0; i < FX_MAX_INSTANCES + 3; i++) store.setEffectAt(LAYER_ID, FX.STROKE, i, [1, 0, 1, 1, 0, 0, i, 0]);
    expect(store.effectInstanceCount(LAYER_ID, FX.STROKE)).toBe(FX_MAX_INSTANCES);
  });

  it("moveEffectInstance swaps two instances' params", () => {
    const { store } = newStore();
    store.setEffectAt(LAYER_ID, FX.STROKE, 0, strokeA);
    store.setEffectAt(LAYER_ID, FX.STROKE, 1, strokeB);
    store.moveEffectInstance(LAYER_ID, FX.STROKE, 0, 1);
    expect(store.effectParamsAt(LAYER_ID, FX.STROKE, 0)).toEqual(strokeB);
    expect(store.effectParamsAt(LAYER_ID, FX.STROKE, 1)).toEqual(strokeA);
  });
});

describe("recordable compound style commands", () => {
  it("replays a complete Blending Options state as one undo step", () => {
    const { store, fake } = newStore();
    store.state.activeLayerId = LAYER_ID;

    expect(store.applyLayerStyleState({
      effects: [
        { fx: FX.STROKE, params: strokeA },
        { fx: FX.STROKE, params: strokeB },
      ],
      blendIf: [],
      fillOpacity: 80,
      knockout: 0,
      transparencyShapes: true,
      blendInteriorGroup: false,
      blendClippedGroup: true,
    })).toBe(true);

    expect(fake.historyPushes).toEqual(["Blending Options"]);
    expect(fake.layer_effect_count(LAYER_ID, FX.STROKE)).toBe(2);
    expect(fake.layer_fill_opacity(LAYER_ID)).toBeCloseTo(0.8, 5);
  });

  it("scales every stacked instance under one history step", () => {
    const { store, fake } = newStore();
    store.state.activeLayerId = LAYER_ID;
    fake.set_layer_effect_at(LAYER_ID, FX.STROKE, 0, Float32Array.from(strokeA));
    fake.set_layer_effect_at(LAYER_ID, FX.STROKE, 1, Float32Array.from(strokeB));

    expect(store.scaleEffects(200)).toBe(true);

    expect(fake.historyPushes).toEqual(["Scale Effects"]);
    expect(fake.layer_effect_params_at(LAYER_ID, FX.STROKE, 0)[6]).toBe(6);
    expect(fake.layer_effect_params_at(LAYER_ID, FX.STROKE, 1)[6]).toBe(16);
  });
});

describe("destroying a layer style is undoable", () => {
  // The engine's style setters are raw by contract; only the Blending Options
  // dialog owned a snapshot. Paste / Clear / Apply Style destroyed an entire
  // style for zero undo steps, and because effects live inside the stack
  // snapshot, the next Undo of an EARLIER action jumped the user further back
  // instead of restoring the style.
  it("Clear Layer Style owns exactly one history step", () => {
    const { store, fake } = newStore();
    fake.set_layer_effect_at(LAYER_ID, FX.STROKE, 0, Float32Array.from(strokeA));
    fake.historyPushes.length = 0;

    store.clearLayerStyle();

    expect(fake.historyPushes).toEqual(["Clear Layer Style"]);
    expect(fake.layer_effect_count(LAYER_ID, FX.STROKE)).toBe(0);
  });

  it("does not push a step when there is nothing to paste", () => {
    const { store, fake } = newStore();
    fake.historyPushes.length = 0;
    store.pasteLayerStyle(); // empty clipboard
    expect(fake.historyPushes, "a refused paste must not leave a phantom step").toEqual([]);
  });
});
