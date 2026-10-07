// Unit test for the Mixer Brush store wiring: pushBrush must map the "mixerbrush"
// tool to engine brush mode 11 (no collision with the other brush modes) and push
// the Wet/Load/Mix reservoir params. The dab algorithm itself is covered by a Rust
// #[test] (raster::mixer_brush) + e2e/mixer-brush.spec.ts.
import { describe, expect, it, vi } from "vitest";

// Store → EngineClient imports the wasm @engine module; mock it so the test runs
// engine-free in node (mirrors src/engine/EngineClient.test.ts).
vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

type Call = { m: string; args: unknown[] };

// A recording stand-in for the wasm Engine: every method call is captured so the
// test can assert what pushBrush pushed across the FFI boundary.
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

describe("Mixer Brush store wiring", () => {
  it("pushBrush maps the mixerbrush tool to engine brush mode 11", () => {
    const { store, calls } = makeStore();
    store.setTool("mixerbrush");
    expect(last(calls, "set_brush_mode")?.args[0]).toBe(11);
  });

  it("keeps the plain brush on mode 0 — no collision with mode 11", () => {
    const { store, calls } = makeStore();
    store.setTool("brush");
    expect(last(calls, "set_brush_mode")?.args[0]).toBe(0);
  });

  it("setBrush updates the Wet/Load/Mix state and pushes them to the engine", () => {
    const { store, calls } = makeStore();
    store.setTool("mixerbrush");
    store.setBrush({ mixerWet: 0.9, mixerLoad: 0.1, mixerMix: 0.2 });
    expect(store.state.brush.mixerWet).toBe(0.9);
    expect(store.state.brush.mixerLoad).toBe(0.1);
    expect(store.state.brush.mixerMix).toBe(0.2);
    expect(last(calls, "set_mixer_params")?.args).toEqual([0.9, 0.1, 0.2]);
  });

  // #433: the reservoir toggles, Sample All Layers and the Background Eraser's
  // Sampling / Limits ride the same pushBrush as the rest of the brush state.
  it("pushes Load/Clean, Sample All Layers and the eraser Sampling/Limits to the engine", () => {
    const { store, calls } = makeStore();
    store.setBrush({ mixerAutoLoad: false, mixerAutoClean: true, sampleAllLayers: true, bgEraserSampling: 2, bgEraserLimits: 0 });
    expect(last(calls, "set_mixer_auto")?.args).toEqual([false, true]);
    expect(last(calls, "set_retouch_sample_all")?.args).toEqual([true]);
    expect(last(calls, "set_background_eraser_sampling")?.args).toEqual([2, 0]);
  });

  // #433: the defaults the store pushes at startup must be the ones the engine
  // already has (raster/mod.rs `bg_sampling: 1` / `bg_limits: 0`) — Once +
  // Discontiguous, which is what the Background Eraser did before these options
  // existed. Photoshop ships Continuous / Contiguous; adopting either here would
  // silently re-render every existing stroke, so they stay one click away.
  it("ships the eraser Sampling/Limits defaults the engine already has", () => {
    const { store, calls } = makeStore();
    store.setTool("backgrounderaser");
    expect(store.state.brush.bgEraserSampling).toBe(1);
    expect(store.state.brush.bgEraserLimits).toBe(0);
    expect(last(calls, "set_background_eraser_sampling")?.args).toEqual([1, 0]);
  });
});
