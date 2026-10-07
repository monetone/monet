import { beforeEach, describe, expect, it, vi } from "vitest";

// Guards vis-spot-01: a spot channel is a real editable plate, not a display-only
// overprint. The plate ops themselves are the engine's and are covered by
// packages/engine's spot_channels_are_paintable_editable_and_mergeable; here the
// panel is rendered against a recording fake engine (state/app is stubbed and
// React's hooks are driven by hand, the discipline of ./dialogs/common.test.ts)
// so the Channels-panel side of the round-trip is exercised for real.
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
    // Real effect semantics (dep compare + cleanup): the panel drops its paint
    // target from an effect, and that IS one of the guarantees below.
    useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => {
      const s = stub.slot(null as null | { deps?: unknown[]; cleanup?: (() => void) | void });
      const prev = s.current;
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length
        || deps.some((d, i) => !Object.is(d, prev.deps![i]));
      // The slot is marked run BEFORE the body fires: the body may setState,
      // which re-renders synchronously here, and a half-written slot would
      // re-queue the same effect forever.
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

/** A stateful stand-in for the engine's spot plates. */
const fakeEngine = vi.hoisted(() => {
  const plates = [
    { name: "Spot 1", ink: 0xec008c, solidity: 0.8, visible: true },
    { name: "Spot 2", ink: 0x00a0ff, solidity: 1, visible: false },
  ];
  const log = (name: string, ...args: unknown[]) => { stub.calls.push([name, ...args]); };
  return {
    plates,
    quickMask: false,
    spot_channel_ink: (i: number) => plates[i].ink,
    spot_channel_solidity: (i: number) => plates[i].solidity,
    spot_channel_visible: (i: number) => plates[i].visible,
    set_spot_channel_visible(i: number, on: boolean) { log("set_spot_channel_visible", i, on); plates[i].visible = on; },
    set_spot_channel_options(i: number, name: string, r: number, g: number, b: number, solidity: number) {
      log("set_spot_channel_options", i, name, r, g, b, solidity);
    },
    load_spot_channel_as_selection: (i: number, mode: number) => log("load_spot_channel_as_selection", i, mode),
    save_selection_to_spot_channel: (i: number) => log("save_selection_to_spot_channel", i),
    merge_spot_channel: (i: number) => log("merge_spot_channel", i),
    quick_mask_on() { return this.quickMask; },
    enter_quick_mask() { log("enter_quick_mask"); this.quickMask = true; stub.state.quickMask = true; },
    exit_quick_mask() { log("exit_quick_mask"); this.quickMask = false; stub.state.quickMask = false; },
    selection_bounds: () => new Int32Array([0, 0, 0, 0]),
  };
});

vi.mock("../state/app", () => ({
  engine: { engine: fakeEngine, commit: stub.record("commit"), docThumbUrl: () => "" },
  useStore: (select: (s: unknown) => unknown) => select(stub.state),
  store: {
    savedSelectionNames: () => [],
    channelThumbUrls: () => [],
    // #414: alpha / spot / Quick Mask rows draw their own coverage now.
    savedChannelThumbUrl: () => "",
    spotChannelThumbUrl: () => "",
    quickMaskThumbUrl: () => "",
    targetChannel: stub.record("targetChannel"),
    newSpotChannel: stub.record("newSpotChannel"),
    removeSpotChannel: stub.record("removeSpotChannel"),
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
// Store → EngineClient imports the wasm @engine module; mock it so the store
// half of this file runs engine-free in node (mirrors state/store tests).
vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

const { ChannelsPanel } = await import("./Panels");
const { Store } = await import("../state/store");

type El = { type: unknown; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  walk(el.props?.footer, out); // a Dialog's buttons live in its footer prop
  return out;
}

function mount() {
  stub.reset();
  fakeEngine.quickMask = false;
  fakeEngine.plates[0] = { name: "Spot 1", ink: 0xec008c, solidity: 0.8, visible: true };
  fakeEngine.plates[1] = { name: "Spot 2", ink: 0x00a0ff, solidity: 1, visible: false };
  stub.state = {
    mode: 0, doc: {}, activeDocId: 1, selectionGen: 0, undoDepth: 0, undoLabel: "",
    colorProfile: 0, colorProfileAssigned: false, iccProfileName: null,
    selectionActive: false, channelTarget: null, channelAlone: false, channelOptions: {},
    spotChannelNames: fakeEngine.plates.map((p) => p.name), quickMask: false,
  };
  let tree: El[] = [];
  const draw = () => {
    stub.begin(draw);
    tree = walk(ChannelsPanel() as unknown as El);
    while (stub.pending.length) stub.pending.shift()!();
  };
  draw();
  const rows = () => tree.filter((e) => "data-mv-spot-channel" in e.props);
  return {
    redraw: draw,
    rows,
    row: (i: number) => rows()[i],
    in: (i: number, label: string) => walk(rows()[i].props.children).find((e) => e.props["aria-label"] === label || e.props.title === label)!,
    byAttr: (attr: string) => tree.find((e) => attr in e.props)!,
    byLabel: (label: string) => tree.find((e) => e.props["aria-label"] === label)!,
  };
}

const click = { stopPropagation() {} };
const cmdClick = { metaKey: true, ctrlKey: false, target: { closest: () => null }, stopPropagation() {} };

beforeEach(() => { stub.calls.length = 0; });

describe("Channels panel spot plates", () => {
  it("paints a plate through the Quick Mask buffer and writes it back", () => {
    const ui = mount();
    // Enter: the plate's coverage becomes the paintable plane. An alpha channel
    // and a plate share one buffer, so the alpha target is dropped first.
    ui.in(0, "Paint spot channel Spot 1").props.onClick(click);
    expect(stub.calls).toEqual([
      ["targetChannel", null],
      ["load_spot_channel_as_selection", 0, 0],
      ["enter_quick_mask"],
      ["commit"],
    ]);
    expect(ui.in(0, "Stop painting spot channel Spot 1").props["aria-pressed"]).toBe(true);
    // Leave: the painted plane becomes the plate's coverage again.
    stub.calls.length = 0;
    ui.in(0, "Stop painting spot channel Spot 1").props.onClick(click);
    expect(stub.calls).toEqual([
      ["exit_quick_mask"],
      ["save_selection_to_spot_channel", 0],
      ["commit"],
    ]);
    expect(ui.in(0, "Paint spot channel Spot 1").props["aria-pressed"]).toBe(false);
  });

  it("never writes back a buffer that is no longer the plate's", () => {
    const ui = mount();
    ui.in(0, "Paint spot channel Spot 1").props.onClick(click);
    // Q (or an undo) dropped the Quick Mask buffer behind the panel's back:
    // saving the live selection now would wipe the plate's coverage.
    fakeEngine.quickMask = false;
    stub.calls.length = 0;
    ui.in(0, "Stop painting spot channel Spot 1").props.onClick(click);
    expect(stub.calls).toEqual([["commit"]]);
  });

  it("drops the paint target when the buffer is gone", () => {
    const ui = mount();
    ui.in(0, "Paint spot channel Spot 1").props.onClick(click);
    expect(ui.in(0, "Stop painting spot channel Spot 1")).toBeDefined();
    stub.state.quickMask = false; // Q, outside the panel
    ui.redraw();
    expect(ui.in(0, "Paint spot channel Spot 1").props["aria-pressed"]).toBe(false);
  });

  it("drops the paint target and the options draft on a document swap", () => {
    const ui = mount();
    ui.in(0, "Paint spot channel Spot 1").props.onClick(click);
    ui.in(0, "Spot Channel Options…").props.onClick(click);
    expect(ui.byAttr("data-mv-spot-options-ok")).toBeDefined();
    stub.state.activeDocId = 2; // the plates belong to the other document now
    ui.redraw();
    expect(ui.in(0, "Paint spot channel Spot 1").props["aria-pressed"]).toBe(false);
    expect(ui.byAttr("data-mv-spot-options-ok")).toBeUndefined();
  });

  it("edits ink, solidity and name through Spot Channel Options", () => {
    const ui = mount();
    ui.in(0, "Spot Channel Options…").props.onClick(click);
    ui.byLabel("Spot channel name").props.onChange({ target: { value: "Pantone 806" } });
    ui.byLabel("Spot ink color").props.onChange({ target: { value: "#112233" } });
    ui.byLabel("Spot ink solidity").props.onChange(50);
    // Applied on Done — a per-keystroke apply would be one history step each.
    expect(stub.calls).toEqual([]);
    ui.byAttr("data-mv-spot-options-ok").props.onClick();
    expect(stub.calls).toEqual([
      ["set_spot_channel_options", 0, "Pantone 806", 0x11, 0x22, 0x33, 0.5],
      ["commit"],
    ]);
    expect(ui.byAttr("data-mv-spot-options-ok")).toBeUndefined(); // dialog closed
  });

  it("clamps solidity to 0..100 before it reaches the engine", () => {
    const ui = mount();
    ui.in(0, "Spot Channel Options…").props.onClick(click);
    ui.byLabel("Spot ink solidity").props.onChange(140);
    ui.byAttr("data-mv-spot-options-ok").props.onClick();
    expect(stub.calls[0]).toEqual(["set_spot_channel_options", 0, "Spot 1", 0xec, 0x00, 0x8c, 1]);
  });

  it("shows the real ink and an eye per plate", () => {
    const ui = mount();
    // The old ceiling: every plate drew the same hardcoded magenta swatch and
    // had no visibility toggle. Swatch, solidity and eye come from the engine.
    // The ink chip is the small 10px square; #414 put a coverage thumbnail
    // beside it, which also carries a background, so match on the chip's size.
    const swatches = walk(ui.row(0).props.children).concat(walk(ui.row(1).props.children))
      .filter((e) => typeof e.props.style?.background === "string" && e.props.style.width === 10);
    expect(swatches.map((s) => s.props.style.background)).toEqual(["#ec008c", "#00a0ff"]);
    const text = (row: El) => walk(row.props.children)
      .map((e) => (Array.isArray(e.props.children) ? e.props.children.join("") : String(e.props.children)));
    expect(text(ui.row(0))).toContain("80%"); // the engine's solidity, not a constant
    expect(text(ui.row(1))).toContain("100%");
    expect(ui.in(0, "Hide spot channel Spot 1").props["aria-pressed"]).toBe(true);
    expect(ui.in(1, "Show spot channel Spot 2").props["aria-pressed"]).toBe(false);
    ui.in(0, "Hide spot channel Spot 1").props.onClick(click);
    expect(stub.calls).toEqual([["set_spot_channel_visible", 0, false], ["commit"]]);
    expect(ui.in(0, "Show spot channel Spot 1").props["aria-pressed"]).toBe(false);
  });

  it("offers Merge Spot Channel and loads a plate as a selection", () => {
    const ui = mount();
    walk(ui.row(1).props.children).find((e) => e.props.children === "Merge")!.props.onClick();
    expect(stub.calls).toEqual([["merge_spot_channel", 1], ["commit"]]);
    stub.calls.length = 0;
    ui.row(1).props.onClick(cmdClick); // ⌘-click the row
    expect(stub.calls).toEqual([["load_spot_channel_as_selection", 1, 0], ["commit"]]);
  });

  it("finishes an open paint round-trip before acting on any plate", () => {
    const ui = mount();
    ui.in(0, "Paint spot channel Spot 1").props.onClick(click);
    stub.calls.length = 0;
    walk(ui.row(1).props.children).find((e) => e.props.children === "Merge")!.props.onClick();
    expect(stub.calls).toEqual([
      ["exit_quick_mask"], ["save_selection_to_spot_channel", 0],
      ["merge_spot_channel", 1], ["commit"],
    ]);
  });
});

// A new plate was named `Spot ${count + 1}`, which repeats after a delete: add
// two, delete the first, and the next plate is a second "Spot 2". The alpha
// channel rows already skip past taken names; spot plates now do the same.
describe("spot plate names stay unique", () => {
  /** A Store over an engine that really keeps the plate list. */
  function makeStore() {
    const names: string[] = [];
    const engine = new Proxy({
      spot_channel_count: () => names.length,
      spot_channel_name: (i: number) => names[i],
      add_spot_channel: (name: string) => { names.push(name); },
      remove_spot_channel: (i: number) => { names.splice(i, 1); },
    } as Record<string, unknown>, {
      get: (target, prop: string) => target[prop] ?? (() => undefined),
    });
    const client = { engine, e: engine, sync: () => {}, commit: () => {}, refreshFromEngine: () => {} };
    return { store: new Store(client as never), names };
  }

  it("skips a name a surviving plate already uses", () => {
    const { store, names } = makeStore();
    store.newSpotChannel();
    store.newSpotChannel();
    expect(names).toEqual(["Spot 1", "Spot 2"]);
    store.removeSpotChannel(0);
    store.newSpotChannel(); // count+1 would be "Spot 2" — already taken
    expect(names).toEqual(["Spot 2", "Spot 3"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps every name unique across repeated add/delete cycles", () => {
    const { store, names } = makeStore();
    for (let i = 0; i < 6; i++) {
      store.newSpotChannel();
      if (i % 2 === 1) store.removeSpotChannel(0);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});
