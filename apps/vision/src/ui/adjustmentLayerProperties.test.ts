import { beforeEach, describe, expect, it, vi } from "vitest";

// Gap backlog, Adjustments & filters #1 — an adjustment layer is re-editable.
// Selecting one shows ITS controls in the Properties panel, seeded from the
// params the layer carries, and every edit writes THAT layer instead of
// stacking a second adjustment on top of it.
//
// Panels.tsx reaches the WASM engine and the DOM through state/app, so state/app
// is stubbed and React's hooks are driven by hand — the discipline of
// ./panelInventory.test.ts. The panel renders for real and its handlers run.
const stub = vi.hoisted(() => {
  const slots: Array<{ current: any }> = [];
  let cursor = 0;
  let rerender: (() => void) | null = null;
  const calls: Array<[string, ...unknown[]]> = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  const state = new Proxy({} as Record<string, any>, { get: (t, p: string) => (p in t ? t[p] : []) });
  // The engine's view of the selected adjustment layer.
  const adj = { kind: 0, params: [] as number[] };
  return {
    calls, record, state, adj,
    reset() {
      slots.length = 0; cursor = 0; calls.length = 0;
      adj.kind = 0; adj.params = [];
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
    useContext: () => ({ open: stub.record("openDialog"), close: () => {}, current: null, arg: null }),
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

vi.mock("../state/app", () => new Proxy({} as Record<string, unknown>, {
  has: () => true,
  getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
  get: (_t, prop: string) => {
    switch (prop) {
      case "useStore": return (select: (s: unknown) => unknown) => select(stub.state);
      case "engine": return {
        commit: stub.record("engine.commit"),
        e: new Proxy({}, {
          get: (_e, method: string) => (...args: unknown[]) => {
            stub.calls.push([`e.${method}`, ...args]);
            if (method === "layer_adj_kind") return stub.adj.kind;
            if (method === "layer_kind") return stub.state.activeLayerKind;
            if (method === "undo_pushes") return 0;
            return "";
          },
        }),
      };
      case "store": return new Proxy({}, {
        get: (_s, method: string) => {
          if (method === "state") return stub.state;
          if (method === "getSnapshot") return () => stub.state;
          if (method === "adjParams") return (...a: unknown[]) => {
            stub.calls.push(["adjParams", ...a]);
            return Float32Array.from(stub.adj.params);
          };
          if (method === "setAdjustmentParams") return (id: number, params: Float32Array) => {
            stub.calls.push(["setAdjustmentParams", id, [...params]]);
            // The engine really does hold the new params: the panel reads back
            // per render, so a second edit must build on the first.
            stub.adj.params = [...params];
          };
          return stub.record(method);
        },
      });
      case "fil": return { pathBlur: stub.record("fil.pathBlur"), noise: stub.record("fil.noise") };
      case "then": return undefined;
      default: return stub.record(prop);
    }
  },
}));

const { PropertiesPanel, SmartFilterRows } = await import("./Panels");
const { ADJ_SPECS, HueSaturationControls } = await import("./Dialogs");
const { LAYER_KIND } = await import("../state/engineContracts");

type El = { type: any; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  if (el.type === HueSaturationControls) {
    walk(HueSaturationControls(el.props as Parameters<typeof HueSaturationControls>[0]), out);
    return out;
  }
  walk(el.props?.children, out);
  return out;
}

const LAYER_ID = 3;

/** Mounts the Properties panel with `id` selected as an adjustment of `kind`. */
function mount(kind: number, params: number[]) {
  stub.reset();
  stub.adj.kind = kind;
  stub.adj.params = params;
  stub.put({
    doc: {}, activeDocId: 1, activeLayerId: LAYER_ID,
    layers: [{ id: LAYER_ID, name: "Brightness/Contrast", kind: LAYER_KIND.adjustment }],
  });
  let tree: El[] = [];
  const draw = () => { stub.begin(draw); tree = walk(PropertiesPanel() as unknown as El); };
  draw();
  return {
    tree: () => tree,
    redraw: () => draw(),
    section: () => tree.find((e) => "data-mv-adj-properties" in e.props),
    control: (label: string) => tree.find((e) => e.props.label === label || e.props["aria-label"] === label),
    labels: () => tree.map((e) => e.props.label ?? e.props["aria-label"]).filter(Boolean),
    byText: (text: string) => tree.find((e) => e.props.children === text),
  };
}

const wrote = () => stub.calls.filter((c) => c[0] === "setAdjustmentParams");
const opened = () => stub.calls.filter((c) => c[0] === "openDialog");

beforeEach(() => { stub.reset(); });

describe("Properties panel re-opens an adjustment layer's own controls", () => {
  it("renders the sliders of the kind the layer actually is, seeded from its params", () => {
    const ui = mount(ADJ_SPECS.alBrightness.kind, [0.25, -0.5]);
    expect(stub.calls).toContainEqual(["e.layer_adj_kind", LAYER_ID]);
    expect(stub.calls).toContainEqual(["adjParams", LAYER_ID]);
    expect(ui.section()).toBeTruthy();
    expect(ui.labels()).toEqual(expect.arrayContaining(["Brightness", "Contrast"]));
    expect(ui.control("Brightness")!.props.value).toBe(0.25);
    expect(ui.control("Contrast")!.props.value).toBe(-0.5);
  });

  it("shows a different kind's controls — it is not one hard-coded block", () => {
    const hueSat = mount(ADJ_SPECS.alHueSat.kind, [30, 0.4, -0.1]);
    expect(hueSat.labels()).toEqual(expect.arrayContaining(["Hue", "Saturation", "Lightness"]));
    expect(hueSat.control("Hue")!.props.value).toBe(30);
    expect(hueSat.control("Brightness")).toBeUndefined();

    const posterize = mount(ADJ_SPECS.alPosterize.kind, [8]);
    expect(posterize.control("Levels")!.props.value).toBe(8);
    expect(posterize.control("Hue")).toBeUndefined();
  });

  it("uses Colorize-aware bounds and hides ignored range sliders", () => {
    const ui = mount(ADJ_SPECS.alHueSat.kind, [30, -0.4, 0]);
    expect(ui.control("Hue")!.props).toMatchObject({ value: 30, min: -180, max: 180 });
    expect(ui.control("Saturation")!.props).toMatchObject({ min: -100, max: 100 });
    expect(ui.control("Saturation")!.props.value).toBeCloseTo(-40, 5);
    expect(ui.control("Hue range")!.props).toMatchObject({ value: "-1", disabled: false });
    expect(ui.control("Reds Hue")).toBeUndefined();

    ui.control("Colorize")!.props.onChange(true);
    ui.redraw();
    expect(ui.control("Hue")!.props).toMatchObject({ value: 30, min: 0, max: 360 });
    expect(ui.control("Saturation")!.props).toMatchObject({ value: 0, min: 0, max: 100 });
    expect(ui.control("Hue range")!.props).toMatchObject({ value: "-1", disabled: true });
    expect(ui.control("Reds Hue")).toBeUndefined();

    ui.control("Hue")!.props.onChange(300);
    ui.redraw();
    ui.control("Colorize")!.props.onChange(false);
    expect((wrote().at(-1)![2] as number[]).slice(0, 4)).toEqual([-60, 0, 0, 0]);
    ui.redraw();
    expect(ui.control("Hue")!.props).toMatchObject({ value: -60, min: -180, max: 180 });
  });

  it("shows persisted Colorize params in the same canonical domain the engine renders", () => {
    const params = Array(22).fill(0);
    params.splice(0, 4, -60, -0.4, 0, 1);
    const ui = mount(ADJ_SPECS.alHueSat.kind, params);

    expect(ui.control("Hue")!.props).toMatchObject({ value: 300, min: 0, max: 360 });
    expect(ui.control("Saturation")!.props).toMatchObject({ value: 0, min: 0, max: 100 });
    ui.control("Hue")!.props.onChange(300);
    expect((wrote().at(-1)![2] as number[]).slice(0, 4)).toEqual([300, 0, 0, 1]);
  });

  it("upgrades legacy Hue/Saturation and Black & White params only when edited", () => {
    const hueSat = mount(ADJ_SPECS.alHueSat.kind, [30, 0.4, -0.1]);
    expect(wrote()).toHaveLength(0);
    hueSat.control("Hue range")!.props.onChange("0");
    hueSat.control("Hue")!.props.onChange(20);
    const hsParams = wrote().at(-1)![2] as number[];
    expect(hsParams).toHaveLength(22);
    expect(hsParams.slice(0, 3)).toEqual(expect.arrayContaining([30, expect.closeTo(0.4, 5), expect.closeTo(-0.1, 5)]));

    const blackWhite = mount(ADJ_SPECS.alBlackWhite.kind, [0.3, 0.59, 0.11]);
    expect(blackWhite.control("Reds")!.props.value).toBeCloseTo(0.3, 5);
    expect(blackWhite.control("Yellows")!.props.value).toBeCloseTo(0.89, 5);
    blackWhite.control("Blues")!.props.onChange(0.5);
    expect((wrote().at(-1)![2] as number[])).toHaveLength(12);
  });

  it("edits the SAME layer instead of stacking a new adjustment", () => {
    const ui = mount(ADJ_SPECS.alBrightness.kind, [0.25, -0.5]);
    ui.control("Brightness")!.props.onChange(0.75);
    expect(wrote()).toEqual([["setAdjustmentParams", LAYER_ID, [0.75, -0.5]]]);
    // Nothing created a second layer.
    expect(stub.calls.some((c) => c[0] === "addAdjustmentLayer")).toBe(false);

    // A second edit builds on the first — the panel re-read the layer.
    ui.redraw();
    ui.control("Contrast")!.props.onChange(0.5);
    expect(wrote().at(-1)).toEqual(["setAdjustmentParams", LAYER_ID, [0.75, 0.5]]);
  });

  it("closes the undo chain on release so each drag is one history step", () => {
    const ui = mount(ADJ_SPECS.alBrightness.kind, [0, 0]);
    expect(stub.calls.some((c) => c[0] === "e.end_prop_edit")).toBe(false);
    ui.control("Brightness")!.props.onChange(0.4);
    ui.control("Brightness")!.props.onChangeEnd(0.4);
    expect(stub.calls).toContainEqual(["e.end_prop_edit"]);
  });

  it("writes a toggle to the slot the kernel reads, on the same layer", () => {
    const spec = ADJ_SPECS.alPhotoFilter;
    const flag = spec.controls.find((c) => c.toggle)!;
    const ui = mount(spec.kind, spec.defaults.slice());
    expect(ui.control(flag.label)!.props.checked).toBe(true);
    ui.control(flag.label)!.props.onChange(false);
    const written = wrote().at(-1)![2] as number[];
    expect(written[flag.idx]).toBe(0);
    expect(wrote().at(-1)![1]).toBe(LAYER_ID);
  });

  it("pads a layer saved before a control existed instead of resetting it", () => {
    const spec = ADJ_SPECS.alColorBalance;
    const short = spec.defaults.slice(0, 9); // no Preserve Luminosity slot
    const ui = mount(spec.kind, short);
    const flag = spec.controls.find((c) => c.toggle)!;
    expect(ui.control(flag.label)!.props.checked).toBe(false); // reads as the engine does
    ui.control("Sh C–R")!.props.onChange(0.3);
    expect((wrote()[0][2] as number[]).length).toBe(spec.defaults.length);
  });

  it("re-opens the custom-editor kinds on the SAME layer, not as a new one", () => {
    const ui = mount(12, [0.25, 0.5]); // Curves — a curve canvas, not sliders
    ui.byText("Curves")!; // section title
    const edit = ui.tree().find((e) => Array.isArray(e.props.children) && e.props.children.join("") === "Edit Curves…")!;
    expect(edit).toBeTruthy();
    edit.props.onClick();
    expect(opened()).toEqual([["openDialog", "alCurves", {
      layerId: LAYER_ID, layerKind: LAYER_KIND.adjustment, subtype: 12, params: [0.25, 0.5],
    }]]);
  });

  it("says so plainly for an adjustment with no settings (Invert)", () => {
    const ui = mount(4, []);
    expect(ui.section()).toBeTruthy();
    expect(ui.byText("This adjustment has no settings.")).toBeTruthy();
  });

  it("leaves a non-adjustment layer alone — no adjustment section, no engine read", () => {
    stub.reset();
    stub.put({ doc: {}, activeDocId: 1, activeLayerId: LAYER_ID, layers: [{ id: LAYER_ID, name: "Layer 1", kind: LAYER_KIND.pixel }] });
    const tree = walk(PropertiesPanel() as unknown as El);
    expect(tree.find((e) => "data-mv-adj-properties" in e.props)).toBeUndefined();
    expect(stub.calls.some((c) => c[0] === "e.layer_adj_kind")).toBe(false);
    expect(stub.calls.some((c) => c[0] === "adjParams")).toBe(false);
  });
});

describe("smart-filter parameter fields", () => {
  it("reopens pinned Gallery and Spin rows in their pin workspace with the captured target", () => {
    stub.reset();
    stub.put({ activeDocId: 8 });
    const galleryParams = [1, 18, 0.3, 0.2, 20, 30, 1, 40, 0.5, 0, 1];
    const spinParams = [35, 4, 20, 30, 40, 32, 0, 0.25];
    const rows = [
      { index: 2, fid: 114, enabled: true, blend: 0, opacity: 1, params: galleryParams },
      { index: 3, fid: 115, enabled: true, blend: 0, opacity: 1, params: spinParams },
    ];
    let tree: El[] = [];
    const draw = () => { stub.begin(draw); tree = walk(SmartFilterRows({ layerId: LAYER_ID, rows }) as unknown as El); };
    draw();

    tree.find((e) => e.props["aria-label"] === "Edit Blur Gallery")!.props.onClick();
    tree.find((e) => e.props["aria-label"] === "Edit Spin Blur")!.props.onClick();
    expect(stub.calls.filter(([name]) => name === "openDialog")).toEqual([
      ["openDialog", "irisBlur", { docId: 8, layerId: LAYER_ID, index: 2, fid: 114, params: galleryParams }],
      ["openDialog", "spinBlur", { docId: 8, layerId: LAYER_ID, index: 3, fid: 115, params: spinParams }],
    ]);
  });

  it("renders mapped labels and ranges while keeping discrete values integral", () => {
    stub.reset();
    const rows = [
      { index: 0, fid: 38, enabled: true, blend: 0, opacity: 1, params: [0.2, 0.3, 0.4, 7] },
      { index: 1, fid: 39, enabled: true, blend: 0, opacity: 1, params: [6, 5, 1] },
      { index: 2, fid: 11, enabled: true, blend: 0, opacity: 1, params: [0.5, 1, 7, 0] },
      { index: 3, fid: 6, enabled: true, blend: 0, opacity: 1, params: [-45, 1, 2] },
      { index: 4, fid: 109, enabled: true, blend: 0, opacity: 1, params: [320, 240, 1, 0] },
      { index: 5, fid: 79, enabled: true, blend: 0, opacity: 1, params: [4, 0.25, 2, 10, 20, 30, 40, 50, 60] },
    ];
    let tree: El[] = [];
    const draw = () => { stub.begin(draw); tree = walk(SmartFilterRows({ layerId: LAYER_ID, rows }) as unknown as El); };
    const control = (label: string) => tree.find((e) => e.props["aria-label"] === label);
    const open = (name: string) => {
      const edit = control(`Edit ${name}`);
      expect(edit, `no edit control for ${name}`).toBeTruthy();
      edit!.props.onClick();
    };
    draw();

    open("Film Grain");
    expect(control("Film Grain Grain")?.props).toMatchObject({ min: 0, max: 1, step: 0.01, precision: 2 });

    open("Dry Brush");
    expect(control("Dry Brush Texture")?.props).toMatchObject({ min: 0, max: 3, step: 1, precision: 0 });

    open("Add Noise");
    const monochromatic = control("Add Noise Monochromatic");
    expect(monochromatic?.props).toMatchObject({ min: 0, max: 1, step: 1, precision: 0 });
    monochromatic!.props.onChange(0);
    expect(stub.calls).toContainEqual(["setSmartFilterParam", LAYER_ID, 2, 1, 0]);

    open("Emboss");
    expect(control("Emboss Angle")?.props).toMatchObject({ min: -360, max: 360 });

    open("Lens Flare");
    expect(control("Lens Flare Center X")?.props).toMatchObject({ value: 320, min: undefined, max: undefined });

    open("Tiles");
    expect(control("Tiles Fill Empty Area")?.props).toMatchObject({ min: 0, max: 3, step: 1, precision: 0 });
    expect(control("Tiles Background B")?.props).toMatchObject({ value: 60, min: 0, max: 255, step: 1 });
  });
});
