// Quick Selection options-bar wiring: the pointer only knows the Alt modifier, so
// the store resolves the options-bar Mode (New/Add/Subtract) into the engine mode
// and carries it through the stroke, and it pushes Sample All Layers +
// Auto-Enhance across the FFI. The enhance matte itself is covered by a Rust
// #[test] (raster::selection::auto_enhance).
import { describe, expect, it, vi } from "vitest";

// Store → EngineClient imports the wasm @engine module; mock it so the test runs
// engine-free in node (mirrors src/engine/EngineClient.test.ts).
vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

type Call = { m: string; args: unknown[] };

// A recording stand-in for the wasm Engine (same shape as mixerBrush.test.ts).
function makeStore() {
  const calls: Call[] = [];
  const engine = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => (...args: unknown[]) => { calls.push({ m: prop, args }); return undefined; },
  });
  const client = {
    engine, e: engine, lastBrush: [] as number[], onCommit: null as (() => void) | null,
    sync: () => {}, commit: () => {},
  };
  return { store: new Store(client as never), calls };
}

const dabs = (calls: Call[]) => calls.filter((c) => c.m === "quick_selection").map((c) => c.args);

describe("Quick Selection options bar", () => {
  it("defaults to New: the first dab replaces, the rest of the stroke adds", () => {
    const { store, calls } = makeStore();
    store.quickSelectionAt(10, 10, 0, true);
    store.quickSelectionAt(12, 10, 1, false);
    expect(dabs(calls).map((a) => a[4])).toEqual([0, 1]);
  });

  it("Mode = Add makes the first dab add instead of replacing", () => {
    const { store, calls } = makeStore();
    store.setOptions({ quickSelectionMode: 1 });
    store.quickSelectionAt(10, 10, 0, true);
    store.quickSelectionAt(12, 10, 1, false);
    expect(dabs(calls).map((a) => a[4])).toEqual([1, 1]);
  });

  it("Mode = Subtract subtracts for the whole stroke, not just the first dab", () => {
    const { store, calls } = makeStore();
    store.setOptions({ quickSelectionMode: 2 });
    store.quickSelectionAt(10, 10, 0, true);
    store.quickSelectionAt(12, 10, 1, false);
    expect(dabs(calls).map((a) => a[4])).toEqual([2, 2]);
  });

  it("Alt still subtracts whatever the options bar says", () => {
    const { store, calls } = makeStore();
    store.setOptions({ quickSelectionMode: 1 });
    store.quickSelectionAt(10, 10, 2, true); // Alt-down on the first dab
    store.quickSelectionAt(12, 10, 2, false);
    expect(dabs(calls).map((a) => a[4])).toEqual([2, 2]);
  });

  it("a fresh stroke re-reads the options bar (the previous stroke's mode is not sticky)", () => {
    const { store, calls } = makeStore();
    store.quickSelectionAt(10, 10, 2, true); // Alt-subtract stroke
    store.quickSelectionAt(30, 30, 0, true); // plain stroke → back to Mode = New
    expect(dabs(calls).map((a) => a[4])).toEqual([2, 0]);
  });

  it("pushes Sample All Layers and Auto-Enhance to the engine", () => {
    const { store, calls } = makeStore();
    store.quickSelectionAt(10, 10, 0, true);
    expect(dabs(calls)[0].slice(6)).toEqual([false, false]); // Photoshop defaults: both off
    store.setOptions({ quickSelectionSampleAll: true, quickSelectionAutoEnhance: true });
    store.quickSelectionAt(10, 10, 0, true);
    expect(dabs(calls)[1].slice(6)).toEqual([true, true]);
  });

  it("radius follows the brush size and tolerance comes from the options bar", () => {
    const { store, calls } = makeStore();
    store.setBrush({ size: 40 });
    store.setOptions({ quickSelectionTolerance: 0.3 });
    store.quickSelectionAt(10, 10, 0, true);
    const [x, y, radius, tol] = dabs(calls)[0];
    expect([x, y, radius, tol]).toEqual([10, 10, 20, 0.3]);
  });
});
