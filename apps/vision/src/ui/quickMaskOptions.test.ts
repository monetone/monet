import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Quick Mask Options: the rubylith's colour, opacity and what the colour
// indicates. The data model (quickMaskOverlay.ts) always existed but was only
// ever written by Channel Options for a TARGETED channel — plain Quick Mask
// mode had no UI at all, so Photoshop's defaults were unreachable.
//
// Panels.tsx reaches the engine through state/app, so state/app is stubbed and
// React's hooks are driven by hand (the discipline of ./spotChannels.test.ts).
// state/quickMaskOverlay is NOT stubbed: the assertions below read the overlay
// pixel the canvas would actually draw.
const stub = vi.hoisted(() => {
  const slots: Array<{ current: any }> = [];
  let cursor = 0;
  let rerender: (() => void) | null = null;
  const pending: Array<() => void> = [];
  const calls: Array<[string, ...unknown[]]> = [];
  return {
    calls, pending,
    record: (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); },
    reset() { slots.length = 0; cursor = 0; calls.length = 0; pending.length = 0; },
    begin(fn: () => void) { cursor = 0; rerender = fn; },
    slot(initial: unknown) { const i = cursor++; return (slots[i] ??= { current: initial }); },
    invalidate() { rerender?.(); },
    state: {} as Record<string, any>,
  };
});

vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  return {
    ...real,
    useRef: (initial: unknown) => stub.slot(initial),
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useContext: () => ({ open: () => {}, close: () => {}, current: null, arg: null }),
    useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => {
      const s = stub.slot(null as null | { deps?: unknown[]; cleanup?: (() => void) | void });
      const prev = s.current;
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length
        || deps.some((d, i) => !Object.is(d, prev.deps![i]));
      if (changed) stub.pending.push(() => {
        prev?.cleanup?.();
        const entry: { deps?: unknown[]; cleanup?: (() => void) | void } = { deps };
        s.current = entry;
        entry.cleanup = fn();
      });
    },
    useState: (initial: unknown) => {
      const s = stub.slot(typeof initial === "function" ? (initial as () => unknown)() : initial);
      return [s.current, (next: unknown) => {
        s.current = typeof next === "function" ? (next as (p: unknown) => unknown)(s.current) : next;
        stub.invalidate();
      }];
    },
  };
});

const fakeEngine = vi.hoisted(() => ({
  quickMask: true,
  quick_mask_on() { return this.quickMask; },
  selection_bounds: () => new Int32Array([0, 0, 0, 0]),
}));

vi.mock("../state/app", () => ({
  engine: { engine: fakeEngine, commit: stub.record("commit"), docThumbUrl: () => "" },
  useStore: (select: (s: unknown) => unknown) => select(stub.state),
  store: {
    get state() { return stub.state; },
    setOptions: stub.record("setOptions"),
    savedSelectionNames: () => [],
    channelThumbUrls: () => [],
    // #414: alpha / spot / Quick Mask rows draw their own coverage now.
    savedChannelThumbUrl: () => "",
    spotChannelThumbUrl: () => "",
    quickMaskThumbUrl: () => "",
    targetChannel: () => {}, newSpotChannel: () => {}, removeSpotChannel: () => {},
    duplicateChannel: () => {}, loadChannelAsSelection: () => {}, loadSelection: () => {},
    deleteSavedSelection: () => {}, saveSelection: () => {}, setChannelOptions: () => {},
    setChannelAlone: () => {}, splitChannels: () => {}, mergeChannels: () => {},
  },
  actions: {}, anim: {}, library: {}, smart: {}, text: {},
  exportGIF: () => {}, framesAdjust: () => {}, copySwatchColor: () => {},
  importSwatchesFile: () => {}, exportSwatchesAco: () => {}, saveBytes: () => {},
  importActionsFile: () => {}, importStylesFile: () => {},
}));
vi.mock("./Dialogs", () => ({
  useDialogs: () => ({ open: () => {}, close: () => {}, current: null, arg: null }),
  MeasurementRows: () => null,
  // PropertiesPanel derives its adjustment-layer controls from the dialogs' own
  // spec table, so the mock has to carry it even though this file never renders
  // an adjustment layer.
  ADJ_SPECS: {},
}));
vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

const { ChannelsPanel } = await import("./Panels");
const { quickMaskPixel, setQuickMaskOverlay } = await import("../state/quickMaskOverlay");

type El = { type: unknown; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  walk(el.props?.footer, out);
  return out;
}

function mount() {
  stub.reset();
  fakeEngine.quickMask = true;
  stub.state = {
    mode: 0, doc: {}, activeDocId: 1, selectionGen: 0, undoDepth: 0, undoLabel: "",
    colorProfile: 0, colorProfileAssigned: false, iccProfileName: null,
    selectionActive: false, channelTarget: null, channelAlone: false, channelOptions: {},
    spotChannelNames: [], quickMask: true, quickMaskGen: 7,
  };
  let tree: El[] = [];
  const draw = () => {
    stub.begin(draw);
    tree = walk(ChannelsPanel() as unknown as El);
    while (stub.pending.length) stub.pending.shift()!();
  };
  draw();
  const byLabel = (label: string) => tree.find((e) => e.props["aria-label"] === label);
  return {
    redraw: draw,
    byLabel,
    row: () => tree.find((e) => "data-mv-quick-mask-channel" in e.props),
    open: () => byLabel("Quick Mask Options")!.props.onClick(),
  };
}

beforeEach(() => { stub.calls.length = 0; });
afterEach(() => setQuickMaskOverlay(null));

describe("Quick Mask Options", () => {
  it("shows the temporary Quick Mask channel only while Quick Mask is on", () => {
    const ui = mount();
    expect(ui.row()).toBeDefined();
    stub.state.quickMask = false;
    ui.redraw();
    expect(ui.row()).toBeUndefined();
    // A targeted alpha channel owns the buffer — and has its own Channel Options.
    stub.state.quickMask = true;
    stub.state.channelTarget = "Alpha 1";
    ui.redraw();
    expect(ui.row()).toBeUndefined();
  });

  it("starts at Photoshop's defaults: red, 50%, Masked Areas", () => {
    const ui = mount();
    ui.open();
    expect(ui.byLabel("Quick Mask color")!.props.value).toBe("#ff0000");
    expect(ui.byLabel("Quick Mask opacity")!.props.value).toBe(50);
    expect(ui.byLabel("Quick Mask color indicates")!.props.value).toBe("masked");
  });

  it("Color Indicates flips which end of the mask tints", () => {
    const ui = mount();
    ui.open();
    // Masked Areas (default): a masked pixel (0) tints, a selected one (255) is clear.
    expect(quickMaskPixel(0).a).toBe(128);
    expect(quickMaskPixel(255).a).toBe(0);
    ui.byLabel("Quick Mask color indicates")!.props.onChange("selected");
    expect(quickMaskPixel(0).a).toBe(0);
    expect(quickMaskPixel(255).a).toBe(128);
  });

  it("Color and Opacity reach the overlay the canvas draws", () => {
    const ui = mount();
    ui.open();
    ui.byLabel("Quick Mask color")!.props.onChange({ target: { value: "#0080ff" } });
    ui.byLabel("Quick Mask opacity")!.props.onChange(25);
    const px = quickMaskPixel(0);
    expect([px.r, px.g, px.b]).toEqual([0, 128, 255]);
    expect(px.a).toBe(64); // 25% of a fully-masked pixel
    // The row's swatch follows the new colour.
    expect(walk(ui.row()!.props.children)[0].props.style.background).toBe("#0080ff");
  });

  it("repaints the overlay instead of waiting for the next engine sync", () => {
    const ui = mount();
    ui.open();
    ui.byLabel("Quick Mask opacity")!.props.onChange(25);
    // quickMaskGen is the canvas overlay's only repaint signal.
    expect(stub.calls).toContainEqual(["setOptions", { quickMaskGen: 8 }]);
  });

  it("keeps the options across leaving and re-entering Quick Mask", () => {
    const ui = mount();
    ui.open();
    ui.byLabel("Quick Mask opacity")!.props.onChange(20);
    stub.state.quickMask = false; // Q
    ui.redraw();
    stub.state.quickMask = true; // Q again
    ui.redraw();
    ui.open();
    expect(ui.byLabel("Quick Mask opacity")!.props.value).toBe(20);
    expect(quickMaskPixel(0).a).toBe(51);
  });
});
