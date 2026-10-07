// Unit test for the Brush Mode (blend) store wiring: pushBrush must push the
// brush's blend index across the FFI to the engine's set_brush_blend. The dab
// composite behaviour itself is covered by a Rust #[test]
// (raster::brush_mode_composites_the_dab_through_the_blend).
import { describe, expect, it, vi } from "vitest";

// Store → EngineClient imports the wasm @engine module; mock it so the test runs
// engine-free in node (mirrors mixerBrush.test.ts).
vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

type Call = { m: string; args: unknown[] };

function makeStore() {
  const calls: Call[] = [];
  const engine = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => (...args: unknown[]) => { calls.push({ m: prop, args }); return undefined; },
  });
  const client = { engine, lastBrush: [] as number[], onCommit: null as (() => void) | null };
  const store = new Store(client as never);
  return { store, calls };
}

const last = (calls: Call[], m: string) => calls.filter((c) => c.m === m).pop();

describe("Brush Mode (blend) store wiring", () => {
  it("defaults the brush blend to Normal (0)", () => {
    const { store, calls } = makeStore();
    store.setTool("brush");
    expect(last(calls, "set_brush_blend")?.args[0]).toBe(0);
  });

  it("setBrush updates the blend state and pushes the index to the engine", () => {
    const { store, calls } = makeStore();
    store.setTool("brush");
    store.setBrush({ blend: 3 }); // Multiply
    expect(store.state.brush.blend).toBe(3);
    expect(last(calls, "set_brush_blend")?.args[0]).toBe(3);
    expect(last(calls, "set_brush_paint_mode")?.args[0]).toBe(0); // not Behind/Clear
  });

  it("decodes the Behind sentinel (-1) to paint mode 1", () => {
    const { store, calls } = makeStore();
    store.setTool("brush");
    store.setBrush({ blend: -1 });
    expect(last(calls, "set_brush_paint_mode")?.args[0]).toBe(1);
    expect(last(calls, "set_brush_blend")?.args[0]).toBe(0); // blend reset to Normal
  });

  it("decodes the Clear sentinel (-2) to paint mode 2", () => {
    const { store, calls } = makeStore();
    store.setTool("brush");
    store.setBrush({ blend: -2 });
    expect(last(calls, "set_brush_paint_mode")?.args[0]).toBe(2);
  });
});
