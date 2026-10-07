// Brush Settings ▸ Transfer: the engine grew set_brush_transfer (per-dab
// opacity/flow jitter — packages/engine raster tests cover the dab maths), so
// this file proves the app half: the clamping/merging in brushDynamics, and
// that the Brushes panel's Transfer sliders actually reach the engine.
//
// BrushesPanel is exported, so the panel half drives the real component through
// react-dom/server with the leaf Slider swapped for a prop recorder — firing the
// recorded onChange runs the very closure the production render built.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

type Props = Record<string, unknown>;
const { controls } = vi.hoisted(() => ({ controls: [] as Props[] }));

vi.mock("@monet-ui/monet-react", async (importOriginal) => {
  const record = (props: Props) => { controls.push(props); return null; };
  return { ...(await importOriginal<Props>()), Slider: record };
});

import { renderToStaticMarkup } from "react-dom/server";
import { BrushesPanel } from "../ui/Panels";
import { engine, store } from "./app";
import { DEFAULT_BRUSH_SCATTER, brushScatter, clampBrushScatter, setBrushScatter, DEFAULT_BRUSH_SHAPE_DYNAMICS, brushShapeDynamics, clampBrushShapeDynamics, setBrushShapeDynamics, DEFAULT_BRUSH_TRANSFER, brushTransfer, clampBrushTransfer, setBrushTransfer } from "./brushDynamics";

/** Fake engine that only records the Transfer pushes. */
function fakeEngine() {
  const calls: number[][] = [];
  engine.engine = {
    set_brush_transfer: (...args: number[]) => { calls.push(args); },
  } as never;
  return calls;
}

beforeEach(() => {
  setBrushTransfer(DEFAULT_BRUSH_TRANSFER); // module state is shared across tests
  controls.length = 0;
});
afterEach(() => {
  engine.engine = null;
  vi.restoreAllMocks();
});

describe("clampBrushTransfer", () => {
  it("holds every field inside 0..1 and leaves untouched fields alone", () => {
    const base = { opacityJitter: 0.4, minOpacity: 0.2, flowJitter: 0.6, minFlow: 0.1 };
    expect(clampBrushTransfer({ opacityJitter: 2, minFlow: -1 }, base)).toEqual({
      opacityJitter: 1, minOpacity: 0.2, flowJitter: 0.6, minFlow: 0,
    });
    expect(clampBrushTransfer({ flowJitter: Number.NaN }, base).flowJitter).toBe(0);
  });
});

describe("setBrushTransfer", () => {
  it("merges the patch, remembers it and pushes the clamped values to the engine", () => {
    const calls = fakeEngine();
    expect(setBrushTransfer({ opacityJitter: 0.5 }, engine.engine as never)).toEqual({
      opacityJitter: 0.5, minOpacity: 0, flowJitter: 0, minFlow: 0,
    });
    expect(calls).toEqual([[0.5, 0, 0, 0]]);

    setBrushTransfer({ minFlow: 3 }, engine.engine as never);
    expect(calls.at(-1)).toEqual([0.5, 0, 0, 1]);
    expect(brushTransfer()).toEqual({ opacityJitter: 0.5, minOpacity: 0, flowJitter: 0, minFlow: 1 });
  });

  it("is a no-op on the engine when there is none (document not open yet)", () => {
    expect(() => setBrushTransfer({ flowJitter: 0.25 }, null)).not.toThrow();
    expect(brushTransfer().flowJitter).toBe(0.25);
  });
});

describe("BrushesPanel Transfer controls", () => {
  /** Render the panel and hand back its recorded sliders. */
  function mount() {
    controls.length = 0;
    vi.spyOn(store, "getSnapshot").mockReturnValue({
      brushPresets: [], activeBrushPreset: -1, toolPresets: [], brushTips: [], activeBrushTip: -1,
      paintSymmetry: 0, paintSymmetrySegments: 6, paintSymmetryVisible: false, paintSymmetryTransforming: false,
    } as never);
    renderToStaticMarkup(createElement(BrushesPanel));
    return (label: string) => {
      const hit = controls.find((p) => p["aria-label"] === label);
      expect(hit, `no slider labelled "${label}" — the Transfer dynamic is unreachable`).toBeTruthy();
      return hit!;
    };
  }

  it("wires each Transfer slider to its engine parameter", () => {
    const calls = fakeEngine();
    const fire = (label: string, value: number) => {
      (mount()(label).onChange as (v: number) => void)(value);
      return calls.at(-1);
    };
    expect(fire("Opacity Jitter", 0.75)).toEqual([0.75, 0, 0, 0]);
    expect(fire("Minimum", 0.25)).toEqual([0.75, 0.25, 0, 0]);
    expect(fire("Flow Jitter", 0.5)).toEqual([0.75, 0.25, 0.5, 0]);
    expect(fire("Flow Minimum", 0.1)).toEqual([0.75, 0.25, 0.5, 0.1]);
  });

  it("renders the values it last pushed", () => {
    setBrushTransfer({ opacityJitter: 0.3, flowJitter: 0.8 });
    const slider = mount();
    expect(slider("Opacity Jitter").value).toBe(0.3);
    expect(slider("Flow Jitter").value).toBe(0.8);
  });
});

describe("Shape Dynamics (#424)", () => {
  it("defaults to no jitter, with Photoshop's 25% minimums", () => {
    expect(DEFAULT_BRUSH_SHAPE_DYNAMICS).toEqual({
      sizeJitter: 0, minDiameter: 0.25, angleJitter: 0, roundnessJitter: 0, minRoundness: 0.25,
    });
  });

  it("clamps every field into 0..1 and absorbs NaN", () => {
    const c = clampBrushShapeDynamics({
      sizeJitter: 4, minDiameter: -2, angleJitter: Number.NaN, roundnessJitter: 0.5, minRoundness: 9,
    });
    expect(c).toEqual({
      sizeJitter: 1, minDiameter: 0, angleJitter: 0, roundnessJitter: 0.5, minRoundness: 1,
    });
  });

  it("merges a partial patch onto the live values and pushes all five", () => {
    const calls: number[][] = [];
    const eng = { set_brush_shape_dynamics: (...a: number[]) => calls.push(a) };
    setBrushShapeDynamics({ sizeJitter: 0.4 }, eng);
    setBrushShapeDynamics({ angleJitter: 0.8 }, eng);
    // The second push keeps the first edit — the panel sends one slider at a time.
    expect(calls[1]).toEqual([0.4, 0.25, 0.8, 0, 0.25]);
    expect(brushShapeDynamics().sizeJitter).toBeCloseTo(0.4);
  });

  it("works with no engine attached, so the panel can render before one exists", () => {
    expect(() => setBrushShapeDynamics({ sizeJitter: 0.1 }, null)).not.toThrow();
  });
});

describe("Scattering (#425)", () => {
  it("defaults to an unscattered single dab", () => {
    expect(DEFAULT_BRUSH_SCATTER).toEqual({ scatter: 0, bothAxes: false, count: 1, countJitter: 0 });
  });

  it("bounds scatter to Photoshop's 1000% and count to what the engine accepts", () => {
    expect(clampBrushScatter({ scatter: 99, count: 9999, countJitter: 5 }))
      .toEqual({ scatter: 10, bothAxes: false, count: 16, countJitter: 1 });
    expect(clampBrushScatter({ scatter: -1, count: 0 }).count).toBe(1);
  });

  it("rounds a fractional count, since dabs are whole", () => {
    expect(clampBrushScatter({ count: 3.7 }).count).toBe(4);
  });

  it("merges partial patches and pushes all four to the engine", () => {
    const calls: unknown[][] = [];
    const eng = { set_brush_scatter: (...a: unknown[]) => calls.push(a) };
    setBrushScatter({ scatter: 2 }, eng);
    setBrushScatter({ bothAxes: true }, eng);
    expect(calls[1]).toEqual([2, true, 1, 0]);
    expect(brushScatter().scatter).toBe(2);
  });
});
