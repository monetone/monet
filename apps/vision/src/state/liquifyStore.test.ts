// Unit tests for the Liquify Store↔engine wiring added for Brush Rate, Pin
// Edges, and the Mask Options (transparency/layer-mask sourced Freeze Mask
// combine ops). The warp math itself is covered by Rust #[test]s in
// packages/engine/src/raster/mod.rs (mod liquify_warp) and by
// e2e/liquify.spec.ts; this file only proves the Store plumbing that lets the
// UI reach those engine methods.
import { describe, expect, it, vi } from "vitest";

// Store → EngineClient imports the wasm @engine module; mock it so the test
// runs engine-free in node (mirrors src/state/mixerBrush.test.ts).
vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

type Call = { m: string; args: unknown[] };

// A recording stand-in for the wasm Engine + a minimal EngineClient, wired
// just enough for beginLiquifyIfNeeded's session-open path (which briefly
// clones the doc to compute the "behind" backdrop) to complete without
// throwing. `overrides` lets an individual test change one engine reply
// (e.g. simulate a mask op reporting "no change").
function makeStore(overrides: Record<string, (...args: unknown[]) => unknown> = {}) {
  const calls: Call[] = [];
  const engineReplies: Record<string, (...args: unknown[]) => unknown> = {
    active_layer_id: () => 0,
    liquify_begin: () => true,
    liquify_freeze_mask_generation: () => 3,
    liquify_dab: () => [0, 0, 4, 4],
    liquify_mask_dab: () => [0, 0, 0, 0],
    liquify_mask_from_transparency: () => true,
    liquify_mask_from_layer_mask: () => true,
    ...overrides,
  };
  const engine = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => (...args: unknown[]) => {
      calls.push({ m: prop, args });
      return engineReplies[prop]?.(...args);
    },
  });
  // buildProject returns the same recording engine as the "clone"; its
  // layer_count() then reads as undefined, so liquifyBehindActiveCopy's walk
  // never finds a layer and safely resolves to null instead of throwing.
  const clientTarget = { engine, lastBrush: [] as number[], onCommit: null as (() => void) | null, buildProject: () => engine };
  const client = new Proxy(clientTarget as Record<string, unknown>, {
    get: (t, prop: string) => (prop in t ? t[prop] : (...args: unknown[]) => { calls.push({ m: `client.${prop}`, args }); return undefined; }),
  });
  const store = new Store(client as never);
  return { store, calls };
}

const last = (calls: Call[], m: string) => calls.filter((c) => c.m === m).pop();

type LifecycleEngine = {
  engine: Record<string, (...args: unknown[]) => unknown>;
  calls: Call[];
  dabWarps: boolean;
};

function lifecycleEngine(layerIds = [1]): LifecycleEngine {
  const state = { calls: [] as Call[], active: layerIds[0], session: false, warped: false, dabWarps: true };
  const replies: Record<string, (...args: unknown[]) => unknown> = {
    width: () => 2,
    height: () => 2,
    layer_count: () => layerIds.length,
    layer_id_at: (i) => layerIds[Number(i)],
    layer_kind: () => 0,
    layer_name: (id) => `Layer ${id}`,
    layer_visible: () => true,
    layer_locked: () => false,
    layer_opacity: () => 1,
    layer_fill_opacity: () => 1,
    layer_blend: () => 0,
    layer_has_mask: () => false,
    layer_mask_enabled: () => true,
    layer_has_effects: () => false,
    layer_clipping: () => false,
    layer_group: () => 0,
    active_layer_id: () => state.active,
    set_active_layer: (id) => { state.active = Number(id); },
    history_labels: () => [] as string[],
    history_current: () => 0,
    artboard_ids: () => new Uint32Array(),
    liquify_begin: () => { state.session = true; state.warped = false; return true; },
    liquify_dab: () => {
      if (state.dabWarps) state.warped = true;
      return state.dabWarps ? [0, 0, 1, 1] : [0, 0, 0, 0];
    },
    liquify_mask_dab: () => [0, 0, 1, 1],
    liquify_mask_all: () => state.session,
    liquify_mask_clear: () => state.session,
    liquify_mask_invert: () => state.session,
    liquify_mask_from_transparency: () => state.session,
    liquify_mask_from_layer_mask: () => state.session,
    liquify_freeze_mask_generation: () => state.session ? 1 : 0,
    liquify_mesh_fx: () => new Float32Array([state.warped ? 1 : 0, 0, 0, 0]),
    liquify_mesh_fy: () => new Float32Array(4),
    liquify_restore_all: () => { if (!state.session) return false; state.warped = false; return true; },
    liquify_load_mesh: (fx, fy) => {
      if (!state.session) return false;
      state.warped = [...fx as Float32Array, ...fy as Float32Array].some((v) => v !== 0);
      return true;
    },
    liquify_end: () => { state.session = false; state.warped = false; },
    liquify_cancel: () => { state.session = false; state.warped = false; },
  };
  const engine = new Proxy({} as Record<string, (...args: unknown[]) => unknown>, {
    get: (_target, prop: string) => (...args: unknown[]) => {
      state.calls.push({ m: prop, args });
      return replies[prop]?.(...args) ?? 0;
    },
  });
  return {
    engine,
    calls: state.calls,
    get dabWarps() { return state.dabWarps; },
    set dabWarps(value: boolean) { state.dabWarps = value; },
  };
}

function lifecycleStore(engines: LifecycleEngine[]) {
  let nextEngine = 0;
  const client = {
    engine: null as LifecycleEngine["engine"] | null,
    onCommit: null as (() => void) | null,
    onSync: null as (() => void) | null,
    lastBrush: [] as number[],
    commits: 0,
    refreshes: 0,
    get e() { return this.engine!; },
    buildImage() { return engines[nextEngine++].engine; },
    buildNew() { return engines[nextEngine++].engine; },
    buildProject() { return this.engine!; },
    projectBytes() { return new Uint8Array([1]); },
    outputCopy() { return new Uint8ClampedArray(16); },
    activeLayerCopy() { return new Uint8ClampedArray(16); },
    engineOutputCopy() { return new Uint8ClampedArray(16); },
    layerThumbUrl() { return ""; },
    docThumbUrl() { return ""; },
    setDisplayProfile() {},
    setIccProofLut() {},
    activate(engine: LifecycleEngine["engine"]) { this.engine = engine; this.onSync?.(); },
    sync() { this.onSync?.(); },
    blit() {},
    paintRegion() {},
    refreshFromEngine() { this.refreshes++; this.onSync?.(); },
    commit() { this.commits++; this.onCommit?.(); this.onSync?.(); return true; },
  };
  const store = new Store(client as never);
  client.onSync = () => store.syncFromEngine();
  for (let i = 0; i < engines.length; i++) store.openImage(new Uint8Array(), `doc-${i + 1}.png`);
  client.commits = 0;
  client.refreshes = 0;
  return { store, client };
}

describe("Liquify store wiring: Pin Edges", () => {
  it("liquifyDab syncs the current pinEdges option to the engine before every warp dab", () => {
    const { store, calls } = makeStore();
    store.liquifyDab(10, 10, 0, 0, 1);
    expect(last(calls, "liquify_set_pin_edges")?.args).toEqual([false]); // default: today's behaviour

    store.setLiquify({ pinEdges: true });
    store.liquifyDab(10, 10, 0, 0, 1);
    expect(last(calls, "liquify_set_pin_edges")?.args).toEqual([true]);
  });

  it("does not sync Pin Edges for the Freeze/Thaw mask brush (mode 6/7)", () => {
    const { store, calls } = makeStore();
    store.setLiquify({ mode: 6, pinEdges: true });
    store.liquifyDab(10, 10, 0, 0, 1);
    expect(last(calls, "liquify_set_pin_edges")).toBeUndefined();
  });

  it("reports a refused session start at the dab instead of leaving it for the next commit", () => {
    const { store, calls } = makeStore({ liquify_begin: () => false });
    store.liquifyDab(1, 1, 0, 0);
    expect(calls.map((c) => c.m)).toContain("client.consumeEditError");
    expect(last(calls, "liquify_dab")).toBeUndefined();
  });
});

describe("Liquify store wiring: Mask Options", () => {
  it("liquifyMaskFromTransparency forwards the combine op and refreshes liquifyMaskGen", () => {
    const { store, calls } = makeStore();
    const ok = store.liquifyMaskFromTransparency(2); // Subtract
    expect(ok).toBe(true);
    expect(last(calls, "liquify_mask_from_transparency")?.args).toEqual([2]);
    expect(store.state.liquifyMaskGen).toBe(3); // from the liquify_freeze_mask_generation() reply
  });

  it("liquifyMaskFromLayerMask forwards the combine op and refreshes liquifyMaskGen", () => {
    const { store, calls } = makeStore();
    const ok = store.liquifyMaskFromLayerMask(3); // Intersect
    expect(ok).toBe(true);
    expect(last(calls, "liquify_mask_from_layer_mask")?.args).toEqual([3]);
    expect(store.state.liquifyMaskGen).toBe(3);
  });

  it("returns false and leaves liquifyMaskGen untouched when the engine reports no change", () => {
    const { store } = makeStore({ liquify_mask_from_transparency: () => false });
    store.liquifyDab(10, 10, 0, 0, 1); // open the session (sets liquifyMaskGen once)
    const genBefore = store.state.liquifyMaskGen;
    const ok = store.liquifyMaskFromTransparency(0);
    expect(ok).toBe(false);
    expect(store.state.liquifyMaskGen).toBe(genBefore);
  });
});

describe("Liquify session lifecycle", () => {
  it("cancels the captured engine before switching document tabs", () => {
    const a = lifecycleEngine();
    const b = lifecycleEngine();
    const { store, client } = lifecycleStore([a, b]);
    const [aId, bId] = store.openDocIds();
    store.activateDoc(aId);
    store.liquifyDab(1, 1, 1, 0);
    const before = store.docContentRevision(aId);

    store.activateDoc(bId);

    expect(a.calls.filter((c) => c.m === "liquify_cancel")).toHaveLength(1);
    expect(a.calls.some((c) => c.m === "liquify_end")).toBe(false);
    expect(store.state.activeDocId).toBe(bId);
    expect(store.docContentRevision(aId)).toBe(before);
    expect(client.commits).toBe(0);
  });

  it("cancels before changing the target layer", () => {
    const target = lifecycleEngine([1, 2]);
    const { store, client } = lifecycleStore([target]);
    store.liquifyDab(1, 1, 1, 0);
    const start = target.calls.length;

    store.selectLayer(2);

    const transition = target.calls.slice(start);
    const cancel = transition.findIndex((c) => c.m === "liquify_cancel");
    const select = transition.findIndex((c) => c.m === "set_active_layer" && c.args[0] === 2);
    expect(cancel).toBeGreaterThanOrEqual(0);
    expect(select).toBeGreaterThan(cancel);
    expect(store.hasLiquifySession()).toBe(false);
    expect(client.commits).toBe(0);
  });

  it("does not overwrite a newer layer choice made outside the Store", () => {
    const target = lifecycleEngine([1, 2]);
    const { store } = lifecycleStore([target]);
    store.liquifyDab(1, 1, 1, 0);
    target.engine.set_active_layer(2);

    expect(store.hasLiquifySession()).toBe(false);
    expect(target.engine.active_layer_id()).toBe(2);
    expect(target.calls.filter((c) => c.m === "liquify_cancel")).toHaveLength(1);
  });

  it("cancels the old engine before a same-id Revert replacement", () => {
    const original = lifecycleEngine([1]);
    const replacement = lifecycleEngine([1]);
    const { store, client } = lifecycleStore([original]);
    store.liquifyDab(1, 1, 1, 0);

    store.revertActiveDoc(replacement.engine as never, null);

    expect(original.calls.filter((c) => c.m === "liquify_cancel")).toHaveLength(1);
    expect(replacement.calls.some((c) => ["liquify_begin", "liquify_dab", "liquify_end", "liquify_cancel"].includes(c.m))).toBe(false);
    expect(store.hasLiquifySession()).toBe(false);
    expect(client.engine).toBe(replacement.engine);
    expect(client.commits).toBe(0);
  });

  it("cancels before closing the session document", () => {
    const a = lifecycleEngine();
    const b = lifecycleEngine();
    const { store, client } = lifecycleStore([a, b]);
    const [aId, bId] = store.openDocIds();
    store.activateDoc(aId);
    store.liquifyDab(1, 1, 1, 0);

    store.closeDoc(aId);

    expect(a.calls.filter((c) => c.m === "liquify_cancel")).toHaveLength(1);
    expect(store.openDocIds()).toEqual([bId]);
    expect(store.state.activeDocId).toBe(bId);
    expect(client.commits).toBe(0);
  });

  it("keeps Cancel dirty-neutral", () => {
    const target = lifecycleEngine([1, 2]);
    const { store, client } = lifecycleStore([target]);
    const id = store.state.activeDocId;
    const before = store.docContentRevision(id);
    store.setLiquify({ targetLayerId: 2 });
    store.liquifyDab(1, 1, 1, 0);

    store.cancelLiquify();

    expect(store.docContentRevision(id)).toBe(before);
    expect(client.commits).toBe(0);
    expect(client.refreshes).toBe(1);
    expect(target.calls.filter((c) => c.m === "set_active_layer").at(-1)?.args).toEqual([1]);
  });

  it.each([
    ["a zero-effect dab", (store: Store, target: LifecycleEngine) => { target.dabWarps = false; store.liquifyDab(1, 1, 1, 0); }],
    ["Freeze Mask only", (store: Store) => { expect(store.liquifyMaskAll()).toBe(true); }],
    ["Restore All after a warp", (store: Store) => { store.liquifyDab(1, 1, 1, 0); store.restoreLiquify(); }],
  ])("keeps Apply dirty-neutral after %s", (_name, prepare) => {
    const target = lifecycleEngine();
    const { store, client } = lifecycleStore([target]);
    const id = store.state.activeDocId;
    const before = store.docContentRevision(id);
    prepare(store, target);

    store.endLiquify();

    expect(store.docContentRevision(id)).toBe(before);
    expect(client.commits).toBe(0);
    expect(client.refreshes).toBe(1);
  });

  it("marks one revision for a warped Apply", () => {
    const target = lifecycleEngine();
    const { store, client } = lifecycleStore([target]);
    const id = store.state.activeDocId;
    const before = store.docContentRevision(id)!;
    store.liquifyDab(1, 1, 1, 0);

    store.endLiquify();

    expect(store.docContentRevision(id)).toBe(before + 1);
    expect(client.commits).toBe(1);
    expect(client.refreshes).toBe(0);
    expect(target.calls.filter((c) => c.m === "liquify_end")).toHaveLength(1);
  });
});
