// Unit test for the Paths panel's path ops (Fill Path / Stroke Path options).
// Stroke Path must paint with the DIALOG's tool (routed through the same
// strokeTool the canvas paints with) and restore the live tool afterwards, and
// Simulate Pressure must taper the stroke; Fill Path must route through the same
// fill the Edit ▸ Fill dialog uses (contents, blending, rendering).
import { describe, expect, it, vi } from "vitest";

// Store → EngineClient imports the wasm @engine module; mock it so the test runs
// engine-free in node (mirrors src/state/historyBrush.test.ts).
vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";
import { simulatedPressures } from "./paths";

type Call = { m: string; args: unknown[] };

// Recording stand-in for the wasm Engine (see historyBrush.test.ts). stroke_begin
// must report success or strokePath bails before painting.
function makeStore() {
  const calls: Call[] = [];
  const engine = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => (...args: unknown[]) => {
      calls.push({ m: prop, args });
      return prop === "stroke_begin" ? true : undefined;
    },
  });
  const client = {
    engine, e: engine, lastBrush: [] as number[], onCommit: null as (() => void) | null,
    commit: () => { calls.push({ m: "commit", args: [] }); },
    sync: () => { calls.push({ m: "sync", args: [] }); },
  };
  const store = new Store(client as never);
  return { store, calls };
}

const last = (calls: Call[], m: string) => calls.filter((c) => c.m === m).pop();
const of = (calls: Call[], m: string) => calls.filter((c) => c.m === m);
const SQUARE = [0, 0, 10, 0, 10, 10, 0, 10];

describe("Stroke Path on a multi-loop work path (#452)", () => {
  it("lifts between loops inside one stroke and one commit", () => {
    const { store, calls } = makeStore();
    const loop = (x: number) => [x, 0, 0, 0, 0, 0, x + 10, 0, 0, 0, 0, 0, x + 10, 10, 0, 0, 0, 0];
    store.setPenAnchors([...loop(0), ...loop(20)], [3, 3]);
    store.strokePath(store.state.penPath);
    expect(of(calls, "stroke_begin")).toHaveLength(1);
    expect(of(calls, "stroke_end")).toHaveLength(1);
    expect(of(calls, "commit")).toHaveLength(1);
    expect(of(calls, "stroke_dab").map((c) => c.args.slice(0, 2)), "the pen lifts to the second loop").toEqual([[20, 0]]);
    expect(of(calls, "stroke_to").map((c) => c.args.slice(0, 2)), "each loop closes on itself, nothing crosses the gap")
      .toEqual([[0, 0], [10, 0], [10, 10], [0, 0], [30, 0], [30, 10], [20, 0]]);
  });
});

describe("simulatedPressures", () => {
  it("tapers 0 → 1 → 0 across the outline", () => {
    const p = simulatedPressures([0, 5, 10], [0, 0, 0]);
    expect(p[0]).toBeCloseTo(0.05); // floored so the tip never vanishes
    expect(p[1]).toBeCloseTo(1);
    expect(p[2]).toBeCloseTo(0.05);
  });

  it("weights by arc length, not vertex index", () => {
    // The middle vertex sits at 10% of the length — a per-index ramp would peak there.
    const p = simulatedPressures([0, 1, 10], [0, 0, 0]);
    expect(p[1]).toBeCloseTo(Math.sin(Math.PI * 0.1));
  });

  it("survives a degenerate (zero-length) path", () => {
    expect(simulatedPressures([3, 3], [7, 7])).toEqual([1, 1]);
  });
});

describe("Stroke Path options", () => {
  it("strokes with the dialog's tool, then restores the live tool's brush", () => {
    const { store, calls } = makeStore();
    store.setTool("brush");
    store.strokePath(SQUARE, "dodge");
    const modes = of(calls, "set_brush_mode").map((c) => c.args[0]);
    expect(modes.at(-2)).toBe(2); // Dodge pushed for the stroke
    expect(modes.at(-1)).toBe(0); // …and the live Brush restored after it
    expect(last(calls, "stroke_end")).toBeTruthy();
    expect(last(calls, "commit")).toBeTruthy();
  });

  it("defaults to the active tool when the dialog picks none", () => {
    const { store, calls } = makeStore();
    store.setTool("burn");
    store.strokePath(SQUARE);
    expect(of(calls, "set_brush_mode").map((c) => c.args[0]).at(-1)).toBe(3); // Burn
  });

  it("Simulate Pressure tapers the dabs and forces size dynamics on", () => {
    const { store, calls } = makeStore();
    store.strokePath(SQUARE, "brush", true);
    expect(last(calls, "set_brush_dynamics")?.args[0]).toBe(true);
    const p = of(calls, "stroke_to").map((c) => c.args[2] as number);
    expect(p).toHaveLength(5); // 4 vertices + the closing repeat
    expect(p[0]).toBeCloseTo(0.05);
    expect(Math.max(...p)).toBeCloseTo(1);
    expect(p.at(-1)).toBeCloseTo(0.05);
  });

  it("strokes at full pressure when Simulate Pressure is off", () => {
    const { store, calls } = makeStore();
    store.strokePath(SQUARE, "brush");
    expect(of(calls, "stroke_to").every((c) => c.args[2] === 1)).toBe(true);
  });
});

describe("Fill Path options", () => {
  it("fills with the chosen contents, blend mode and opacity", () => {
    const { store, calls } = makeStore();
    store.fillPath(SQUARE, { contents: "color", custom: [10, 20, 30], mode: "multiply", opacity: 0.5 });
    const c = last(calls, "fill_blend");
    expect(c?.args.slice(0, 4)).toEqual([10, 20, 30, 128]); // round(0.5 × 255)
    expect(c?.args[4]).toBe(3); // "multiply" → blend index 3
    expect(last(calls, "select_none")).toBeTruthy(); // the fill leaves no selection
    expect(of(calls, "commit")).toHaveLength(1); // select + fill + deselect = ONE history step
  });

  it("honours Preserve Transparency", () => {
    const { store, calls } = makeStore();
    store.fillPath(SQUARE, { preserve: true });
    expect(last(calls, "fill_blend_preserve")).toBeTruthy();
    expect(last(calls, "fill_blend")).toBeUndefined();
  });

  it("applies the Rendering group (feather + anti-alias)", () => {
    const { store, calls } = makeStore();
    store.fillPath(SQUARE, { feather: 4, antialias: false });
    expect(of(calls, "set_selection_antialias")[0]?.args[0]).toBe(false);
    expect(last(calls, "feather_selection")?.args[0]).toBe(4);
    // Sub-0.5 radii are no-ops (the engine ignores them) — no stray call.
    const clean = makeStore();
    clean.store.fillPath(SQUARE, { feather: 0 });
    expect(last(clean.calls, "feather_selection")).toBeUndefined();
  });

  it("routes Content-Aware to its own op, not a flat-colour fill", () => {
    const { store, calls } = makeStore();
    store.fillPath(SQUARE, { contents: "contentAware" });
    expect(last(calls, "content_aware_fill")).toBeTruthy();
    expect(last(calls, "fill_blend")).toBeUndefined();
  });

  it("defaults to a plain foreground fill (the old no-dialog behaviour)", () => {
    const { store, calls } = makeStore();
    store.fillPath(SQUARE);
    const c = last(calls, "fill_blend");
    expect(c?.args[3]).toBe(255); // 100% opacity
    expect(c?.args[4]).toBe(0);   // Normal
  });

  it("ignores a path with too few vertices", () => {
    const { store, calls } = makeStore();
    store.fillPath([0, 0, 5, 5]);
    store.strokePath([0, 0, 5, 5]);
    expect(last(calls, "fill_blend")).toBeUndefined();
    expect(last(calls, "stroke_begin")).toBeUndefined();
  });
});
