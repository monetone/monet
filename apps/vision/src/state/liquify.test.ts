import { describe, it, expect } from "vitest";
import { defaultLiquify, liquifyReduce, LIQUIFY_MODES, LIQUIFY_MODE_COUNT, LIQUIFY_RECONSTRUCT_MODES, LIQUIFY_TOOL_MODES } from "./liquify";

describe("defaultLiquify", () => {
  it("is Push mode with medium brush/density/strength and full pressure", () => {
    expect(defaultLiquify()).toEqual({ size: 100, density: 0.5, pressure: 1, strength: 0.5, mode: 0, targetLayerId: 0, preview: true, showBackdrop: false, backdropSource: "all", backdropOpacity: 0.5, showMesh: false, rate: 0, pinEdges: false });
  });
  it("defaults Rate to 0 and Pin Edges to off — today's behaviour, unchanged", () => {
    expect(defaultLiquify().rate).toBe(0);
    expect(defaultLiquify().pinEdges).toBe(false);
  });
  it("returns a fresh object each call (no shared mutable default)", () => {
    const a = defaultLiquify();
    a.size = 999;
    expect(defaultLiquify().size).toBe(100);
  });
});

describe("LIQUIFY_MODES", () => {
  it("exposes the warp and mask modes in engine-index order", () => {
    expect(LIQUIFY_MODES).toEqual([
      "Push", "Bloat", "Pucker", "Twirl CW", "Twirl CCW", "Reconstruct", "Freeze Mask", "Thaw Mask",
      "Smooth", "Push Left", "Recon Rigid", "Recon Stiff", "Recon Smooth", "Recon Loose",
    ]);
    expect(LIQUIFY_MODE_COUNT).toBe(14);
  });

  it("keeps Freeze/Thaw at 6/7 — the Store routes exactly those to the mask brush", () => {
    expect(LIQUIFY_MODES[6]).toBe("Freeze Mask");
    expect(LIQUIFY_MODES[7]).toBe("Thaw Mask");
  });

  it("rails every tool mode exactly once, and no Reconstruct variant", () => {
    expect([...LIQUIFY_TOOL_MODES].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(LIQUIFY_TOOL_MODES[0]).toBe(0); // Forward Warp leads, as in Photoshop
    for (const { mode } of LIQUIFY_RECONSTRUCT_MODES) {
      if (mode !== 5) expect(LIQUIFY_TOOL_MODES).not.toContain(mode);
    }
  });

  it("offers Photoshop's five Reconstruct Options, all reachable mode indices", () => {
    expect(LIQUIFY_RECONSTRUCT_MODES.map((r) => r.label)).toEqual(["Revert", "Rigid", "Stiff", "Smooth", "Loose"]);
    for (const { mode } of LIQUIFY_RECONSTRUCT_MODES) {
      expect(LIQUIFY_MODES[mode]).toBeDefined();
      expect(liquifyReduce(defaultLiquify(), { mode }).mode).toBe(mode);
    }
  });
});

describe("liquifyReduce", () => {
  const base = defaultLiquify();

  it("merges a partial patch, leaving untouched fields", () => {
    expect(liquifyReduce(base, { mode: 3 })).toEqual({ ...base, mode: 3 });
    expect(liquifyReduce(base, { size: 250 }).size).toBe(250);
  });

  it("clamps strength, density and pressure to 0..1", () => {
    expect(liquifyReduce(base, { strength: 5 }).strength).toBe(1);
    expect(liquifyReduce(base, { strength: -2 }).strength).toBe(0);
    expect(liquifyReduce(base, { density: 2 }).density).toBe(1);
    expect(liquifyReduce(base, { density: -0.5 }).density).toBe(0);
    expect(liquifyReduce(base, { pressure: 9 }).pressure).toBe(1);
    expect(liquifyReduce(base, { pressure: -1 }).pressure).toBe(0);
  });

  it("floors the brush size at 1px", () => {
    expect(liquifyReduce(base, { size: 0 }).size).toBe(1);
    expect(liquifyReduce(base, { size: -40 }).size).toBe(1);
    expect(liquifyReduce(base, { size: 320 }).size).toBe(320);
  });

  it("clamps mode to an integer in 0..13", () => {
    expect(liquifyReduce(base, { mode: 13 }).mode).toBe(13);
    expect(liquifyReduce(base, { mode: 99 }).mode).toBe(13);
    expect(liquifyReduce(base, { mode: -3 }).mode).toBe(0);
    expect(liquifyReduce(base, { mode: 2.7 }).mode).toBe(3); // rounded
  });

  it("tracks a non-active layer target using a non-negative integer id", () => {
    expect(liquifyReduce(base, { targetLayerId: 42 }).targetLayerId).toBe(42);
    expect(liquifyReduce(base, { targetLayerId: 42.8 }).targetLayerId).toBe(42);
    expect(liquifyReduce(base, { targetLayerId: -4 }).targetLayerId).toBe(0);
    expect(liquifyReduce(base, { targetLayerId: Number.NaN }).targetLayerId).toBe(0);
  });

  it("tracks and clamps the display-only preview/backdrop options", () => {
    expect(liquifyReduce(base, { preview: false, showBackdrop: true, backdropSource: "active", backdropOpacity: 0.25, showMesh: true })).toEqual({ ...base, preview: false, showBackdrop: true, backdropSource: "active", backdropOpacity: 0.25, showMesh: true });
    expect(liquifyReduce(base, { backdropSource: "behind" }).backdropSource).toBe("behind");
    expect(liquifyReduce(base, { preview: 0 as unknown as boolean }).preview).toBe(false);
    expect(liquifyReduce(base, { showMesh: 1 as unknown as boolean }).showMesh).toBe(true);
    expect(liquifyReduce(base, { backdropSource: "bogus" as "active" }).backdropSource).toBe("all");
    expect(liquifyReduce(base, { backdropOpacity: 4 }).backdropOpacity).toBe(1);
    expect(liquifyReduce(base, { backdropOpacity: -2 }).backdropOpacity).toBe(0);
  });

  it("clamps Rate to 0..1 and coerces Pin Edges to a boolean", () => {
    expect(liquifyReduce(base, { rate: 5 }).rate).toBe(1);
    expect(liquifyReduce(base, { rate: -2 }).rate).toBe(0);
    expect(liquifyReduce(base, { rate: 0.4 }).rate).toBe(0.4);
    expect(liquifyReduce(base, { pinEdges: true }).pinEdges).toBe(true);
    expect(liquifyReduce(base, { pinEdges: 1 as unknown as boolean }).pinEdges).toBe(true);
    expect(liquifyReduce(base, { pinEdges: 0 as unknown as boolean }).pinEdges).toBe(false);
  });

  it("setter is a pure reducer — it does not mutate its input", () => {
    const before = defaultLiquify();
    const snapshot = { ...before };
    liquifyReduce(before, { mode: 4, strength: 0.9 });
    expect(before).toEqual(snapshot);
  });
});
