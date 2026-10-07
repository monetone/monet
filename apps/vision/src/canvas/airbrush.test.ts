// Airbrush / Build-up: the app half. `stroke_to` only dabs once the pointer has
// travelled a spacing's worth, so a brush held still deposits nothing — the tick
// below is what keeps paint building up, driven by a rate timer in CanvasView.
// Exercised directly (no pointer): the timer body is a pure step function.
import { afterEach, describe, expect, it, vi } from "vitest";

// CanvasView pulls in the store, which imports the wasm @engine module; mock it
// so this runs engine-free in node (mirrors src/state/mixerBrush.test.ts).
vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@monet-ui/monet-collab/react", () => ({ CollabCursors: () => null }));

import { airbrushIntervalMs, airbrushTick, startAirbrushRepeat } from "./CanvasView";
import { Store } from "../state/store";

/** A stand-in engine that records every stationary dab it is asked for. */
function fakeEngine(rect: number[] = [3, 4, 5, 6]) {
  const dabs: number[][] = [];
  return { dabs, stroke_dab: (x: number, y: number, p: number) => { dabs.push([x, y, p]); return Int32Array.from(rect); } };
}

describe("airbrush build-up tick", () => {
  it("stamps at the held point and repaints the dab's rect", () => {
    const E = fakeEngine([3, 4, 5, 6]);
    const painted: number[][] = [];
    const live = airbrushTick({ strokeActive: true, lx: 12, ly: 34, pressure: 0.5 }, E, (...r) => painted.push(r));
    expect(live).toBe(true);
    expect(E.dabs).toEqual([[12, 34, 0.5]]);
    expect(painted).toEqual([[3, 4, 5, 6]]);
  });

  it("keeps depositing at the SAME point across ticks (a stationary brush builds up)", () => {
    const E = fakeEngine();
    for (let i = 0; i < 3; i++) airbrushTick({ strokeActive: true, lx: 7, ly: 8 }, E, () => {});
    expect(E.dabs).toEqual([[7, 8, 1], [7, 8, 1], [7, 8, 1]]);
  });

  it("defaults pressure to 1 when the drag has none (mouse, not pen)", () => {
    const E = fakeEngine();
    airbrushTick({ strokeActive: true, lx: 1, ly: 2 }, E, () => {});
    expect(E.dabs[0][2]).toBe(1);
  });

  it("skips the repaint when the dab touched nothing", () => {
    const E = fakeEngine([0, 0, 0, 0]);
    const painted: number[][] = [];
    airbrushTick({ strokeActive: true, lx: 1, ly: 2 }, E, (...r) => painted.push(r));
    expect(painted).toEqual([]);
  });

  it("reports dead — so the caller stops the timer — with no drag, no live stroke, or no engine", () => {
    const E = fakeEngine();
    expect(airbrushTick(null, E, () => {})).toBe(false);
    expect(airbrushTick({ lx: 1, ly: 2 }, E, () => {})).toBe(false);
    expect(airbrushTick({ strokeActive: true, lx: 1, ly: 2 }, null, () => {})).toBe(false);
    expect(E.dabs).toEqual([]);
  });
});

describe("airbrush rate", () => {
  it("deposits faster at higher Flow", () => {
    expect(airbrushIntervalMs(1)).toBe(20);
    expect(airbrushIntervalMs(0)).toBe(300);
    expect(airbrushIntervalMs(0.5)).toBeLessThan(airbrushIntervalMs(0.25));
  });

  it("clamps out-of-range Flow instead of returning a nonsense delay", () => {
    expect(airbrushIntervalMs(-1)).toBe(300);
    expect(airbrushIntervalMs(4)).toBe(20);
  });
});

describe("airbrush repeat timer", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("does nothing at all while Airbrush is off", () => {
    vi.useFakeTimers();
    let ticks = 0;
    const id = startAirbrushRepeat({ airbrush: false, flow: 1 }, () => { ticks++; return true; });
    vi.advanceTimersByTime(5000);
    expect(id).toBe(0);
    expect(ticks).toBe(0);
  });

  it("repeats at the Flow-derived rate while Airbrush is on", () => {
    vi.useFakeTimers();
    let ticks = 0;
    startAirbrushRepeat({ airbrush: true, flow: 1 }, () => { ticks++; return true; });
    vi.advanceTimersByTime(19);
    expect(ticks).toBe(0);
    vi.advanceTimersByTime(81); // 100ms total, 20ms apart
    expect(ticks).toBe(5);
  });

  it("stops itself the moment the step reports the stroke is over", () => {
    vi.useFakeTimers();
    let ticks = 0;
    startAirbrushRepeat({ airbrush: true, flow: 1 }, () => ++ticks < 3);
    vi.advanceTimersByTime(5000);
    expect(ticks).toBe(3);
  });
});

describe("BrushState.airbrush", () => {
  it("is off by default and toggles through setBrush", () => {
    const engine = new Proxy({} as Record<string, unknown>, { get: () => () => undefined });
    const store = new Store({ engine, lastBrush: [], onCommit: null } as never);
    expect(store.state.brush.airbrush).toBe(false);
    store.setBrush({ airbrush: true });
    expect(store.state.brush.airbrush).toBe(true);
  });
});
