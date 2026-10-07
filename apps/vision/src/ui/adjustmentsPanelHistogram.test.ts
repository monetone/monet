import { beforeEach, describe, expect, it, vi } from "vitest";

// Two gap-backlog items, one harness:
//   • the Adjustments panel creates adjustment LAYERS (the `al*` dialogs), not
//     the destructive Image ▸ Adjustments dialogs, and carries Photoshop's 16;
//   • Levels and Curves draw the composite's histogram for the active channel.
//
// Dialogs.tsx / Panels.tsx reach the WASM engine, Tauri and the DOM through
// state/app, so state/app is stubbed and React's hooks are driven by hand — the
// discipline of ./panelInventory.test.ts. The components render for real and
// their own handlers run for real.
const stub = vi.hoisted(() => {
  const slots: Array<{ current: any }> = [];
  let cursor = 0;
  let rerender: (() => void) | null = null;
  const calls: Array<[string, ...unknown[]]> = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  // Unknown keys read as [] so a component that selects a slice this test does
  // not model still renders.
  const state = new Proxy({} as Record<string, any>, { get: (t, p: string) => (p in t ? t[p] : []) });
  const ctx = { current: null as string | null };
  return {
    calls, record, state, ctx,
    reset() {
      slots.length = 0; cursor = 0; calls.length = 0; ctx.current = null;
      for (const k of Object.keys(state)) delete state[k];
    },
    put(patch: Record<string, unknown>) { Object.assign(state, patch); },
    begin(fn: () => void) { cursor = 0; rerender = fn; },
    slot(initial: unknown) { const i = cursor++; return (slots[i] ??= { current: initial }); },
    invalidate() { rerender?.(); },
  };
});

vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  return {
    ...real,
    useRef: (initial: unknown) => stub.slot(initial),
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useContext: () => ({ open: stub.record("openDialog"), close: () => {}, current: stub.ctx.current, arg: null }),
    useEffect: () => {},
    useState: (initial: unknown) => {
      const s = stub.slot(typeof initial === "function" ? (initial as () => unknown)() : initial);
      return [s.current, (next: unknown) => {
        s.current = typeof next === "function" ? (next as (p: unknown) => unknown)(s.current) : next;
        stub.invalidate();
      }];
    },
  };
});
// monet-react ships its own React copy, so its context hooks cannot run here.
vi.mock("@monet-ui/monet-react", async () => ({
  ...await vi.importActual<Record<string, unknown>>("@monet-ui/monet-react"),
  useMonetContext: () => ({ platform: "mac" }),
  useToast: () => ({ show: () => {} }),
}));

/** Deterministic engine: every call is recorded, and channelHistogramBars hands
 *  back a bar array whose first bin identifies the channel it was asked for. */
const CHANNEL_MARK = vi.hoisted<Record<string, number>>(() => ({ luma: 0.1, r: 0.2, g: 0.3, b: 0.4 }));

vi.mock("../state/app", () => new Proxy({} as Record<string, unknown>, {
  has: () => true,
  getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
  get: (_t, prop: string) => {
    switch (prop) {
      case "useStore": return (select: (s: unknown) => unknown) => select(stub.state);
      case "engine": return new Proxy({}, {
        get: (_e, method: string) => (...args: unknown[]) => {
          stub.calls.push([`engine.${method}`, ...args]);
          if (method === "channelHistogramBars") {
            const [channel, bins] = args as [string, number];
            const out = new Array(bins).fill(0);
            out[0] = CHANNEL_MARK[channel] ?? -1;
            return out;
          }
          return "";
        },
      });
      case "store": return new Proxy({}, {
        get: (_s, method: string) => {
          if (method === "state") return stub.state;
          if (method === "getSnapshot") return () => stub.state;
          return stub.record(method);
        },
      });
      case "then": return undefined;
      // The scratch-layer hook checkpoints the action recorder on mount, so
      // `actions` must be an object with mark/rollback, not a bare function.
      case "actions": return {
        mark: () => ({}), rollback: stub.record("actions.rollback"), commit: stub.record("actions.commit"),
        suspend: () => {}, record: () => {},
      };
      default: return stub.record(prop);
    }
  },
}));

const { AdjustmentsPanel } = await import("./Panels");
const { DialogProvider } = await import("./Dialogs");

type El = { type: any; props: Record<string, any>; ref?: any };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  return out;
}
/** Render one component element (function components only) and walk its output. */
const render = (el: El): El[] => walk(el.type(el.props));

function baseState() {
  return { doc: {}, activeDocId: 1, activeLayerId: 3, mode: 0, layers: [{ id: 3, name: "Layer 1", kind: 0 }] } as Record<string, unknown>;
}

/** Renders a component, re-rendering on every setState. */
function mount(component: () => unknown) {
  stub.reset();
  stub.put(baseState());
  let tree: El[] = [];
  const draw = () => { stub.begin(draw); tree = walk(component() as unknown as El); };
  draw();
  return { tree: () => tree };
}

/** Renders whichever dialog the host would show for `name`. */
function mountDialog(name: string) {
  stub.reset();
  stub.put(baseState());
  stub.ctx.current = name;
  let tree: El[] = [];
  const draw = () => {
    stub.begin(draw);
    const provider = DialogProvider({ children: null }) as unknown as El;
    // The provider's only element child is DialogHost, which switches on `current`.
    const host = walk(provider.props.children).find((e) => typeof e.type === "function")!;
    const body = host.type(host.props) as El;
    tree = render(body);
  };
  draw();
  return {
    tree: () => tree,
    byLabel: (label: string) => tree.find((e) => e.props["aria-label"] === label)!,
    /** The histogram element, rendered: [0] is its plot div, [1] the Histogram. */
    plot: () => {
      const el = tree.find((e) => typeof e.type === "function" && "channel" in e.props && "height" in e.props);
      return el ? render(el) : null;
    },
    histogram: () => {
      const el = tree.find((e) => typeof e.type === "function" && "channel" in e.props && "height" in e.props);
      return el ? { channel: el.props.channel as string, bars: render(el)[1]?.props.data as number[] } : null;
    },
  };
}

beforeEach(() => { stub.calls.length = 0; });

const opened = () => stub.calls.filter((c) => c[0] === "openDialog").map((c) => c[1]);

describe("Adjustments panel creates adjustment layers, not destructive edits", () => {
  const tiles = () => mount(AdjustmentsPanel).tree().filter((e) => e.props.className === "mv-adj-tile");

  it("carries Photoshop's full 16 tiles", () => {
    expect(tiles().map((t) => t.props.children)).toEqual([
      "Brightness", "Levels", "Curves", "Exposure", "Vibrance", "Hue/Sat", "Color Bal.",
      "Black & White", "Photo Filt.", "Channel Mixer", "Color Lookup", "Invert",
      "Posterize", "Threshold", "Gradient Map", "Selective Color",
    ]);
  });

  it("opens only adjustment-LAYER dialogs — never the destructive Image ▸ Adjustments ones", () => {
    for (const t of tiles()) t.props.onClick();
    expect(opened()).toEqual([
      "alBrightness", "alLevels", "alCurves", "alExposure", "alVibrance", "alHueSat", "alColorBalance",
      "alBlackWhite", "alPhotoFilter", "alChannelMixer", "alColorLookup",
      "alPosterize", "alThreshold", "alGradientMap", "alSelectiveColor",
    ]);
    // The destructive names the panel used to fire.
    for (const destructive of ["levels", "curves", "brightnessContrast", "hueSaturation", "vibrance", "colorBalance", "exposure", "photoFilter", "posterize", "threshold"]) {
      expect(opened(), destructive).not.toContain(destructive);
    }
  });

  it("creates the Invert layer outright — it has no settings dialog", () => {
    const invert = tiles().find((t) => t.props.children === "Invert")!;
    invert.props.onClick();
    expect(opened()).toEqual([]);
    const [call] = stub.calls.filter((c) => c[0] === "addAdjustmentLayer");
    expect(call?.[1]).toBe(4);
    expect(call?.[3]).toBe("Invert");
  });
});

describe("Levels and Curves draw the histogram behind their controls", () => {
  it("Levels reads the composite histogram for the active channel", () => {
    const d = mountDialog("levels");
    expect(d.histogram()).toEqual({ channel: "luma", bars: expect.any(Array) });
    expect(d.histogram()!.bars[0]).toBe(CHANNEL_MARK.luma);
    expect(stub.calls).toContainEqual(["engine.channelHistogramBars", "luma", 128]);
  });

  it("Levels follows its Channel selector", () => {
    const d = mountDialog("levels");
    d.byLabel("Channel").props.onChange("2");
    expect(d.histogram()!.channel).toBe("g");
    expect(d.histogram()!.bars[0]).toBe(CHANNEL_MARK.g);
  });

  it("Curves draws it behind the 256×256 grid, following the same selector", () => {
    const d = mountDialog("curves");
    expect(d.histogram()!.channel).toBe("luma");
    const grid = d.byLabel("Tone curve");
    expect(grid.props.width).toBe(256);
    d.byLabel("Channel").props.onChange("1");
    expect(d.histogram()!.channel).toBe("r");
    expect(d.histogram()!.bars[0]).toBe(CHANNEL_MARK.r);
  });

  it("keeps the plot decorative — the bars must not shadow the curve's own aria tree", () => {
    const plot = mountDialog("curves").plot()![0];
    expect(plot.props["data-mv-adj-histogram"]).toBe("luma");
    expect(plot.props["aria-hidden"]).toBe("true");
    expect(plot.props.style.position, "the Curves plot sits under the grid").toBe("absolute");
  });

  it("the adjustment-LAYER Levels and Curves dialogs get one too", () => {
    expect(mountDialog("alLevels").histogram()!.channel).toBe("luma");
    expect(mountDialog("alCurves").histogram()!.channel).toBe("luma");
  });
});
