// Unit test for the History Brush store wiring: pushBrush must map the
// "historybrush" tool to engine brush mode 12 (no collision with the other brush
// modes), "Set Source" must reach the engine, and Edit ▸ Fill ▸ History must route
// to fill_history (opacity × 255, blend index). The revert algorithm itself is
// covered by a Rust #[test] (raster::history_brush) + e2e/history-brush.spec.ts.
import { describe, expect, it, vi } from "vitest";

// Store → EngineClient imports the wasm @engine module; mock it so the test runs
// engine-free in node (mirrors src/state/mixerBrush.test.ts).
vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

type Call = { m: string; args: unknown[] };

// A recording stand-in for the wasm Engine: every method call is captured so the
// test can assert what the store pushed across the FFI boundary. `engine` and `e`
// share the same Proxy (pushBrush reads `this.engine.engine`, fills read `.e`).
function makeStore() {
  const calls: Call[] = [];
  const engine = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => (...args: unknown[]) => { calls.push({ m: prop, args }); return undefined; },
  });
  const client = {
    engine, e: engine, lastBrush: [] as number[], onCommit: null as (() => void) | null,
    commit: () => { calls.push({ m: "commit", args: [] }); },
  };
  const store = new Store(client as never);
  return { store, calls };
}

const last = (calls: Call[], m: string) => calls.filter((c) => c.m === m).pop();

describe("History Brush store wiring", () => {
  it("pushBrush maps the historybrush tool to engine brush mode 12", () => {
    const { store, calls } = makeStore();
    store.setTool("historybrush");
    expect(last(calls, "set_brush_mode")?.args[0]).toBe(12);
  });

  it("keeps the plain brush on mode 0 — no collision with mode 12", () => {
    const { store, calls } = makeStore();
    store.setTool("brush");
    expect(last(calls, "set_brush_mode")?.args[0]).toBe(0);
  });

  it('"Set Source" captures the source via the engine', () => {
    const { store, calls } = makeStore();
    store.setHistorySource();
    expect(last(calls, "set_history_source")).toBeTruthy();
  });

  it('Fill ▸ History routes to fill_history (opacity × 255, Normal blend index 0)', () => {
    const { store, calls } = makeStore();
    store.fillContents("history", 0.5, "normal");
    const c = last(calls, "fill_history");
    expect(c).toBeTruthy();
    expect(c?.args[0]).toBe(128); // round(0.5 × 255)
    expect(c?.args[1]).toBe(0);   // "normal" → blend index 0
    // History contents is NOT a flat-colour fill — it must not hit fill_blend.
    expect(last(calls, "fill_blend")).toBeUndefined();
  });
});
