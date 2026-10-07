import { beforeEach, describe, expect, it, vi } from "vitest";

// Guards vis-cmyk-01: CMYK/Lab/Multichannel documents have real plates, so the
// Channels panel must offer Duplicate on every mode and be able to write an
// alpha channel back into a plate. The separation itself is the engine's, and is
// covered by packages/engine's mode_cmyk_separates_pixels_and_enforces_the_ink_limit,
// duplicate_channel_extracts_cmyk_and_lab_plates and apply_alpha_to_channel_writes_a_plate.
//
// Panels.tsx reaches that engine through state/app, so state/app is stubbed with
// a recording fake and React's hooks are driven by hand (the discipline of
// ./dialogs/common.test.ts): the real panel renders and its real handlers run.
const stub = vi.hoisted(() => {
  const slots: Array<{ current: unknown }> = [];
  let cursor = 0;
  let rerender: (() => void) | null = null;
  const calls: Array<[string, ...unknown[]]> = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  return {
    calls, record,
    reset() { slots.length = 0; cursor = 0; calls.length = 0; },
    begin(fn: () => void) { cursor = 0; rerender = fn; },
    slot(initial: unknown) { const i = cursor++; return (slots[i] ??= { current: initial }); },
    invalidate() { rerender?.(); },
    state: {} as Record<string, unknown>,
  };
});

vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  return {
    ...real,
    useRef: (initial: unknown) => stub.slot(initial),
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    useContext: () => ({ open: () => {}, close: () => {}, current: null, arg: null }),
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
  apply_alpha_to_channel: (name: string, plate: number) => { stub.calls.push(["apply_alpha_to_channel", name, plate]); },
  pick_cmyk: () => [0.1, 0.2, 0.3, 0.4],
  pick_lab: () => [0, 0, 0],
  pick_sample: () => 0,
  selection_bounds: () => new Int32Array([0, 0, 0, 0]),
}));

vi.mock("../state/app", () => ({
  engine: { engine: fakeEngine, commit: stub.record("commit"), docThumbUrl: () => "" },
  useStore: (select: (s: unknown) => unknown) => select(stub.state),
  store: {
    savedSelectionNames: () => ["Alpha"],
    channelThumbUrls: () => [],
    // #414: alpha / spot / Quick Mask rows draw their own coverage now.
    savedChannelThumbUrl: () => "",
    spotChannelThumbUrl: () => "",
    quickMaskThumbUrl: () => "",
    duplicateChannel: stub.record("duplicateChannel"),
    loadChannelAsSelection: stub.record("loadChannelAsSelection"),
    loadSelection: stub.record("loadSelection"),
    deleteSavedSelection: stub.record("deleteSavedSelection"),
    saveSelection: stub.record("saveSelection"),
    setChannelOptions: stub.record("setChannelOptions"),
    setChannelAlone: stub.record("setChannelAlone"),
    splitChannels: stub.record("splitChannels"),
    mergeChannels: stub.record("mergeChannels"),
    targetChannel: stub.record("targetChannel"),
    newSpotChannel: stub.record("newSpotChannel"),
    removeSpotChannel: stub.record("removeSpotChannel"),
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

const { ChannelsPanel, InfoPanel } = await import("./Panels");

type El = { type: unknown; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  return out;
}

const MODES = { rgb: 0, gray: 1, cmyk: 2, lab: 3, multichannel: 4 } as const;

function baseState(mode: number) {
  return {
    mode, doc: {}, activeDocId: 1, selectionGen: 0, undoDepth: 0, undoLabel: "",
    colorProfile: 0, colorProfileAssigned: false, iccProfileName: null,
    selectionActive: true, channelTarget: null, channelAlone: false, channelOptions: {},
    spotChannelNames: [], quickMask: false,
    cursor: { x: 4, y: 5 }, picked: null, colorSamplers: [], sampleSize: 1, sampleMode: 0,
    selectionDragRect: null,
  };
}

/** Renders the real panel, re-rendering on every setState (and on demand). */
function mount(component: () => unknown, mode: number = MODES.rgb) {
  stub.reset();
  stub.state = baseState(mode);
  let tree: El[] = [];
  const draw = () => { stub.begin(draw); tree = walk(component() as unknown as El); };
  draw();
  return {
    redraw: draw,
    setMode(next: number) { stub.state.mode = next; draw(); },
    all: (pred: (e: El) => boolean) => tree.filter(pred),
    find: (pred: (e: El) => boolean) => tree.find(pred),
    rows: (attr: string) => tree.filter((e) => attr in e.props),
    byAttr: (attr: string) => tree.find((e) => attr in e.props)!,
  };
}

/** The buttons inside one channel row, by their tooltip. */
const buttonIn = (row: El, title: string) => walk(row.props.children).find((e) => e.props.title === title);

beforeEach(() => { stub.calls.length = 0; });

describe("Channels panel plates", () => {
  it("offers Duplicate Channel in every colour mode", () => {
    for (const mode of Object.values(MODES)) {
      const ui = mount(ChannelsPanel, mode);
      const rows = ui.rows("data-mv-channel");
      expect(rows.length, `mode ${mode} has channel rows`).toBeGreaterThan(0);
      for (const row of rows) {
        // The old ceiling: Duplicate was RGB/Grayscale only, because CMYK/Lab
        // were said to have no true pixel channels.
        expect(buttonIn(row, "Duplicate this channel to a new alpha channel"), `${row.props["data-mv-channel"]} (mode ${mode})`).toBeDefined();
      }
    }
  });

  it("duplicates the plate the row stands for, under a free name", () => {
    const ui = mount(ChannelsPanel, MODES.cmyk);
    const cyan = ui.rows("data-mv-channel").find((r) => r.props["data-mv-channel"] === "Cyan")!;
    buttonIn(cyan, "Duplicate this channel to a new alpha channel")!.props.onClick();
    expect(stub.calls).toContainEqual(["duplicateChannel", 1, "Cyan copy"]);
  });

  it("indexes plates 1-based, skipping the composite row", () => {
    const cmyk = mount(ChannelsPanel, MODES.cmyk).byAttr("data-mv-apply-plate");
    expect(cmyk.props.options.map((o: { value: string; label: string }) => [o.value, o.label])).toEqual([
      ["1", "Cyan"], ["2", "Magenta"], ["3", "Yellow"], ["4", "Black"],
    ]);
    // Grayscale's single plate IS the composite row, so it is not skipped.
    const gray = mount(ChannelsPanel, MODES.gray).byAttr("data-mv-apply-plate");
    expect(gray.props.options.map((o: { value: string; label: string }) => [o.value, o.label])).toEqual([["1", "Gray"]]);
  });

  it("clamps the apply target when the mode loses plates", () => {
    const ui = mount(ChannelsPanel, MODES.cmyk);
    ui.byAttr("data-mv-apply-plate").props.onChange("4");
    expect(ui.byAttr("data-mv-apply-plate").props.value).toBe("4");
    // CMYK (4 inks) → Lab (3 axes): plate 4 would be one the engine refuses.
    ui.setMode(MODES.lab);
    expect(ui.byAttr("data-mv-apply-plate").props.value).toBe("3");
    buttonIn(ui.byAttr("data-mv-alpha-channel"), "Write this alpha channel into the b channel of the active layer")!.props.onClick();
    expect(stub.calls).toEqual([["apply_alpha_to_channel", "Alpha", 3], ["commit"]]);
  });

  it("writes an alpha channel back into the selected plate", () => {
    const ui = mount(ChannelsPanel, MODES.cmyk);
    ui.byAttr("data-mv-apply-plate").props.onChange("2");
    const alpha = ui.byAttr("data-mv-alpha-channel");
    expect(alpha.props["data-mv-alpha-channel"]).toBe("Alpha");
    buttonIn(alpha, "Write this alpha channel into the Magenta channel of the active layer")!.props.onClick();
    expect(stub.calls).toEqual([["apply_alpha_to_channel", "Alpha", 2], ["commit"]]);
  });
});

describe("Info panel", () => {
  it("shows the ink-limited total coverage on a CMYK document", () => {
    const ui = mount(InfoPanel, MODES.cmyk);
    const total = ui.find((e) => e.props["data-mv-info"] === "total-ink")!;
    // pick_cmyk reports 10/20/30/40% ink — 100% total coverage.
    expect(walk(total.props.children).map((c) => c.props.children)).toEqual(["Total Ink", "100%"]);
  });
});
