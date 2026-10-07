// Guards #431 at the store seam. The engine grew a boundary solve, a Diffusion
// knob and three Spot Healing types; none of it is reachable unless pushBrush
// pushes the Healing Brush's Source/Diffusion and spotHeal routes the Spot
// Healing Brush's Type + Sample All Layers instead of one fixed fill.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

function storeWith() {
  const calls: [string, ...unknown[]][] = [];
  const eng = new Proxy({} as Record<string, unknown>, {
    get: (_t, name: string) => {
      if (name === "has_pattern") return () => true;
      return (...a: unknown[]) => { calls.push([name, ...a]); return 0; };
    },
    has: () => true,
  });
  const client = {
    engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), blit: vi.fn(),
    onCommit: null, lastBrush: [] as number[], selectionMask: () => null,
  };
  const store = new Store(client as never);
  const last = (name: string) => [...calls].reverse().find((c) => c[0] === name);
  return { store, calls, last };
}

describe("Healing Brush ▸ Source and Diffusion (#431)", () => {
  it("heals from the defined pattern when Source is Pattern", () => {
    const { store, last } = storeWith();
    store.setTool("heal");
    store.setBrush({ healSource: "pattern" });
    expect(last("set_pattern_stamp")).toEqual(["set_pattern_stamp", true]);
    // The pattern only reaches the dab through the clone path, so it has to be on.
    expect(last("set_clone")).toEqual(["set_clone", true, 0, 0]);
    expect(last("set_brush_mode")).toEqual(["set_brush_mode", 5]); // still Heal
  });

  it("goes back to the sampled point when Source is Sampled", () => {
    const { store, last } = storeWith();
    store.setTool("heal");
    store.setBrush({ healSource: "sampled" });
    expect(last("set_pattern_stamp")).toEqual(["set_pattern_stamp", false]);
  });

  it("leaves the Pattern Stamp's own source alone", () => {
    const { store, last } = storeWith();
    store.setTool("patternstamp");
    store.setBrush({ healSource: "sampled" });
    expect(last("set_pattern_stamp")).toEqual(["set_pattern_stamp", true]);
  });

  it("pushes Diffusion to the engine", () => {
    const { store, last } = storeWith();
    store.setTool("heal");
    expect(last("set_heal_diffusion")).toEqual(["set_heal_diffusion", 5]); // Photoshop's default
    store.setBrush({ healDiffusion: 7 });
    expect(last("set_heal_diffusion")).toEqual(["set_heal_diffusion", 7]);
  });
});

describe("Spot Healing Brush ▸ Type and Sample All Layers (#431)", () => {
  it("routes the painted footprint through the picked type", () => {
    const { store, calls } = storeWith();
    store.setBrush({ spotHealType: 2, spotHealSampleAll: true });
    store.spotHeal([20, 20], 8);
    expect(calls).toContainEqual(["spot_heal_selection", 2, true]);
    // The old route — one unconditional Content-Aware Fill — must be gone.
    expect(calls.map((c) => c[0])).not.toContain("content_aware_fill");
  });

  it("defaults to Content-Aware on the active layer", () => {
    const { store, calls } = storeWith();
    store.spotHeal([20, 20], 8);
    expect(calls).toContainEqual(["spot_heal_selection", 0, false]);
  });

  it("still builds the footprint as a selection and leaves none behind", () => {
    const { store, calls } = storeWith();
    store.spotHeal([10, 10, 14, 10], 4);
    expect(calls.filter((c) => c[0] === "select_ellipse")).toHaveLength(2);
    expect(calls.map((c) => c[0])).toContain("select_none");
  });
});
