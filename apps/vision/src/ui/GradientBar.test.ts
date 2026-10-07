import { beforeEach, describe, expect, it, vi } from "vitest";

// GradientBar reaches the WASM engine through state/app, so state/app is stubbed
// and React's hooks are driven by hand — the same discipline as
// ./dialogs/common.test.ts — which lets the real component render and its real
// pointer handlers run.
const stub = vi.hoisted(() => {
  const slots: Array<{ current: unknown }> = [];
  let cursor = 0;
  let rerender: (() => void) | null = null;
  return {
    slots,
    reset() { slots.length = 0; cursor = 0; },
    begin(fn: () => void) { cursor = 0; rerender = fn; },
    slot(initial: unknown) {
      const i = cursor++;
      return (slots[i] ??= { current: initial });
    },
    invalidate() { rerender?.(); },
    fg: { h: 0, s: 0, v: 0, a: 1 },
    bg: { h: 0, s: 0, v: 1, a: 1 },
    options: [] as Array<Record<string, unknown>>,
    storeStops: [
      { pos: 0, r: 10, g: 10, b: 10, a: 255 },
      { pos: 1, r: 20, g: 20, b: 20, a: 255 },
    ],
  };
});

vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  return {
    ...real,
    useRef: (initial: unknown) => stub.slot(initial),
    useState: (initial: unknown) => {
      const s = stub.slot(typeof initial === "function" ? (initial as () => unknown)() : initial);
      return [s.current, (next: unknown) => {
        s.current = typeof next === "function" ? (next as (p: unknown) => unknown)(s.current) : next;
        stub.invalidate();
      }];
    },
  };
});

vi.mock("../state/app", () => ({
  store: {
    state: { get fg() { return stub.fg; }, get bg() { return stub.bg; } },
    setOptions: (o: Record<string, unknown>) => { stub.options.push(o); },
  },
  useStore: (select: (s: unknown) => unknown) => select({ gradientStops: stub.storeStops }),
}));

const { GradientBar, gradientSample } = await import("./GradientBar");
type Stop = { pos: number; r: number; g: number; b: number; a: number };

type El = { type: unknown; props: Record<string, any>; ref?: unknown };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  return out;
}

/** Renders GradientBar for real and re-renders it whenever a setState fires. */
function mount(initial: Stop[]) {
  let stops = initial;
  let tree: El[] = [];
  const draw = () => {
    stub.begin(draw);
    tree = walk(GradientBar({ stops, onChange: (s) => { stops = s as Stop[]; draw(); } }) as unknown as El);
    // The bar div measures itself: 100px wide at x=0, so clientX === pos * 100.
    const bar = tree.find((e) => e.props.onPointerDown && !e.props.title);
    const ref = (bar as { ref?: { current: unknown } }).ref ?? bar?.props.ref;
    if (ref) ref.current = { getBoundingClientRect: () => ({ left: 0, width: 100 }) };
  };
  stub.reset();
  draw();
  return {
    get stops() { return stops; },
    handles: () => tree.filter((e) => e.props.title === "Drag to move; select to edit"),
    button: (label: string) => tree.find((e) => e.props.children === label),
    input: (label: string) => tree.find((e) => e.props["aria-label"] === label),
    bar: () => tree.find((e) => e.props.onPointerDown && !e.props.title)!,
  };
}

const down = (x: number) => ({ clientX: x, pointerId: 1, stopPropagation() {}, currentTarget: { setPointerCapture() {} } });
const move = (x: number, buttons = 1) => ({ clientX: x, buttons });

const RAMP: Stop[] = [
  { pos: 0, r: 0, g: 0, b: 0, a: 255 },
  { pos: 1, r: 255, g: 255, b: 255, a: 255 },
];

beforeEach(() => { stub.options.length = 0; });

describe("gradientSample", () => {
  it("interpolates the ramp colour between the two nearest stops", () => {
    expect(gradientSample(RAMP, 0.5)).toEqual({ r: 128, g: 128, b: 128, a: 255 });
  });

  it("clamps outside the end stops", () => {
    expect(gradientSample(RAMP, -1).r).toBe(0);
    expect(gradientSample(RAMP, 2).r).toBe(255);
  });
});

// #106 — a drag that is cancelled (touch scroll takeover, pen leaving
// proximity, OS gesture) fires pointercancel, never pointerup, so dragRef stayed
// armed; onMove runs on plain hover, so the next pass over any stop handle
// snapped that stop to the cursor without a click.
describe("GradientBar clears a cancelled stop drag (#106)", () => {
  it("drags the held stop while the button is down", () => {
    const ui = mount(RAMP);
    ui.handles()[0].props.onPointerDown(down(0));
    ui.handles()[0].props.onPointerMove(move(40));
    expect(ui.stops[0].pos).toBeCloseTo(0.4);
  });

  it("pointercancel disarms the drag, so a later hover cannot teleport the stop", () => {
    const ui = mount(RAMP);
    ui.handles()[0].props.onPointerDown(down(0));
    ui.handles()[0].props.onPointerCancel();
    // Hovering with the button still reported down: the stale drag would move it.
    ui.handles()[1].props.onPointerMove(move(70));
    expect(ui.stops.map((s) => s.pos)).toEqual([0, 1]);
  });

  it("pointerup disarms the drag as well", () => {
    const ui = mount(RAMP);
    ui.handles()[0].props.onPointerDown(down(0));
    ui.handles()[0].props.onPointerUp();
    ui.handles()[0].props.onPointerMove(move(70));
    expect(ui.stops[0].pos).toBe(0);
  });

  it("ignores a move with no button held, so a stale drag can't teleport a stop", () => {
    const ui = mount(RAMP);
    ui.handles()[0].props.onPointerDown(down(0));
    ui.handles()[0].props.onPointerMove(move(70, 0));
    expect(ui.stops[0].pos).toBe(0);
  });
});

describe("GradientBar editing", () => {
  it("a click on the bar inserts a stop sampled from the ramp", () => {
    const ui = mount(RAMP);
    ui.bar().props.onPointerDown(down(50));
    expect(ui.stops).toHaveLength(3);
    expect(ui.stops[2]).toMatchObject({ r: 128, g: 128, b: 128, a: 255 });
    expect(ui.stops[2].pos).toBeCloseTo(0.5);
  });

  it("edits the selected stop's colour and opacity", () => {
    const ui = mount(RAMP);
    ui.handles()[1].props.onPointerDown(down(100));
    ui.input("Stop color")!.props.onChange({ target: { value: "#204060" } });
    expect(ui.stops[1]).toMatchObject({ r: 0x20, g: 0x40, b: 0x60 });
    ui.input("Stop opacity")!.props.onChange({ target: { value: "50" } });
    expect(ui.stops[1].a).toBe(128);
  });

  it("keeps at least two stops: Delete is disabled on a two-stop ramp", () => {
    const ui = mount(RAMP);
    expect(ui.button("Delete")!.props.disabled).toBe(true);
    const three = mount([...RAMP, { pos: 0.5, r: 1, g: 2, b: 3, a: 255 }]);
    expect(three.button("Delete")!.props.disabled).toBe(false);
    three.button("Delete")!.props.onClick();
    expect(three.stops).toHaveLength(2);
  });

  it("the B→W preset replaces the ramp with black-to-white", () => {
    const ui = mount([{ pos: 0, r: 9, g: 9, b: 9, a: 12 }, { pos: 1, r: 3, g: 3, b: 3, a: 4 }]);
    ui.button("B→W")!.props.onClick();
    expect(ui.stops).toEqual([
      { pos: 0, r: 0, g: 0, b: 0, a: 255 },
      { pos: 1, r: 255, g: 255, b: 255, a: 255 },
    ]);
  });

  it("uncontrolled, it writes the ramp back to the store instead of a callback", () => {
    stub.reset();
    stub.begin(() => {});
    walk(GradientBar({ stops: undefined, onChange: undefined }) as unknown as El)
      .find((e) => e.props.children === "B→W")!.props.onClick();
    expect(stub.options).toEqual([{ gradientStops: [
      { pos: 0, r: 0, g: 0, b: 0, a: 255 },
      { pos: 1, r: 255, g: 255, b: 255, a: 255 },
    ] }]);
  });
});
