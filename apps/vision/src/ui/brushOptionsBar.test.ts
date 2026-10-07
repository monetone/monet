import { describe, expect, it, vi } from "vitest";

// The brush options bar must expose Spacing and Flow Pressure — both fields are
// already pushed to the engine by store.syncBrush, so the controls have to drive
// store.setBrush, not local component state.
//
// App.tsx reaches the WASM engine, Tauri and the DOM through state/app, so
// state/app is stubbed and React's hooks are driven by hand (the discipline of
// ./panelInventory.test.ts): the app shell renders far enough to hand back its
// toolbar registry, and the real options bar renders from there.
const stub = vi.hoisted(() => {
  const slots: Array<{ current: any }> = [];
  let cursor = 0;
  const calls: Array<[string, ...unknown[]]> = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  const state = new Proxy({} as Record<string, any>, { get: (t, p: string) => (p in t ? t[p] : []) });
  return {
    calls, record, state,
    reset() { slots.length = 0; cursor = 0; calls.length = 0; for (const k of Object.keys(state)) delete state[k]; },
    put(patch: Record<string, unknown>) { Object.assign(state, patch); },
    slot(initial: unknown) { const i = cursor++; return (slots[i] ??= { current: initial }); },
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
      }];
    },
  };
});
// monet-react ships its own React copy, so its context hooks cannot run here.
vi.mock("@monet-ui/monet-react", async () => ({
  ...await vi.importActual<Record<string, unknown>>("@monet-ui/monet-react"),
  useFileDrop: () => {},
  useMonetContext: () => ({ platform: "mac" }),
  useToast: () => ({ show: () => {} }),
}));

vi.mock("../state/app", () => new Proxy({} as Record<string, unknown>, {
  has: () => true,
  getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
  get: (_t, prop: string) => {
    switch (prop) {
      case "useStore": return (select: (s: unknown) => unknown) => select(stub.state);
      case "actions": return new Proxy({}, { get: () => () => [] });
      case "engine": return new Proxy({}, { get: () => () => "" });
      case "store": return new Proxy({}, {
        get: (_s, method: string) => {
          if (method === "state") return stub.state;
          if (method === "getSnapshot") return () => stub.state;
          return stub.record(method);
        },
      });
      case "then": return undefined;
      default: return stub.record(prop);
    }
  },
}));

const { App } = await import("../App");

type El = { type: any; props: Record<string, any>; ref?: any };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  return out;
}

const BRUSH = {
  size: 24, hardness: 0.8, flow: 1, opacity: 1, spacing: 0.16, smoothing: 0, angle: 0, roundness: 1,
  sizePressure: true, flowPressure: true, blend: 0, dodgeRange: 1, dodgeExposure: 0.5, protectTones: true,
  spongeMode: 1, spongeRate: 0.5, spongeVibrance: true, blurRate: 0.5, sharpenRate: 0.5, sharpenProtect: false,
  bgEraserTolerance: 0.18, bgEraserProtectFg: true, mixerWet: 0.5, mixerLoad: 0.5, mixerMix: 0.5, smudgeFinger: false,
  sampleAllLayers: false, bgEraserSampling: 1, bgEraserLimits: 0, mixerAutoLoad: true, mixerAutoClean: false,
  healSource: "sampled", healDiffusion: 5, spotHealType: 0, spotHealSampleAll: false,
};

/** Renders the real options bar for `tool` out of the app shell's toolbar registry. */
function mountOptionsBar(patch: Record<string, unknown> = {}) {
  stub.reset();
  stub.put({
    doc: { width: 64, height: 48 }, documents: [{ id: 1, name: "Untitled" }], activeDocId: 1, activeLayerId: 3, tool: "brush", mode: 0, depth: 8, zoom: 1,
    screenMode: "standard", measureScale: { unit: "px" }, pixelAspect: { name: "Square" },
    layers: [{ id: 3, name: "Layer 1", kind: 0 }],
    brush: { ...BRUSH }, liquify: {}, eraserMode: "brush",
    history: ["Brush"], historyIndex: 1, historyStates: 50, historyOptions: {},
    ...patch,
  });
  const toasts = App() as unknown as El;
  const provider = walk(toasts.props.children).find((e) => typeof e.type === "function")!; // DialogProvider
  const editor = walk(provider.props.children).find((e) => e.type?.name === "Editor")!;
  const dock = walk(editor.type(editor.props)).find((e) => e.props.toolbarDefs)!;
  const bar = dock.props.toolbarDefs.options.render("horizontal") as El;
  return walk(bar.type(bar.props));
}

/** The slider helper renders [label, Slider, readout] — find it by its label. */
function sliderRow(tree: El[], label: string) {
  const row = tree.find((e) => Array.isArray(e.props.children) && e.props.children[0]?.props?.children === label);
  expect(row, `${label} slider`).toBeDefined();
  return { control: row!.props.children[1] as El, readout: (row!.props.children[2] as El).props.children as string };
}

function checkbox(tree: El[], label: string) {
  return tree.find((e) => e.props.children === label && typeof e.props.onChange === "function");
}

/** A SegmentedControl, found by one of the labels it offers. */
function segmented(tree: El[], label: string) {
  return tree.find((e) => Array.isArray(e.props.items)
    && e.props.items.some((i: { label?: string }) => i.label === label));
}

describe("brush options bar", () => {
  it("shows Spacing over Photoshop's 1%..1000% range and writes it to the brush state", () => {
    const tree = mountOptionsBar();
    const { control, readout } = sliderRow(tree, "Spacing");
    expect(readout).toBe("16%");
    // Slider takes a 0..1 fraction; the row maps it back onto the real range.
    expect(control.props.value).toBeCloseTo((0.16 - 0.01) / (10 - 0.01), 6);
    control.props.onChange(0);
    control.props.onChange(1);
    expect(stub.calls.filter((c) => c[0] === "setBrush").map((c) => c[1])).toEqual([
      { spacing: 0.01 }, { spacing: 10 },
    ]);
  });

  it("toggles Flow Pressure through the brush state", () => {
    const tree = mountOptionsBar({ brush: { ...BRUSH, flowPressure: false } });
    const box = checkbox(tree, "Pressure flow");
    expect(box, "Pressure flow checkbox").toBeDefined();
    expect(box!.props.checked).toBe(false);
    box!.props.onChange(true);
    expect(stub.calls).toContainEqual(["setBrush", { flowPressure: true }]);
  });

  // The engine seam (stroke_dab), BrushState.airbrush and the CanvasView rate timer
  // all shipped before this control existed, which left build-up unreachable — a
  // user had no way to switch it on. This is the test that would have caught that.
  it("toggles Airbrush build-up through the brush state", () => {
    const tree = mountOptionsBar({ brush: { ...BRUSH, airbrush: false } });
    const box = checkbox(tree, "Airbrush");
    expect(box, "Airbrush checkbox").toBeDefined();
    expect(box!.props.checked).toBe(false);
    box!.props.onChange(true);
    expect(stub.calls).toContainEqual(["setBrush", { airbrush: true }]);
  });

  it("reflects an already-enabled Airbrush back into the control", () => {
    const tree = mountOptionsBar({ brush: { ...BRUSH, airbrush: true } });
    expect(checkbox(tree, "Airbrush")!.props.checked).toBe(true);
  });

  it("keeps both controls out of the block eraser, which has no tip shape", () => {
    const tree = mountOptionsBar({ tool: "erase", eraserMode: "block" });
    expect(tree.find((e) => Array.isArray(e.props.children) && e.props.children[0]?.props?.children === "Spacing")).toBeUndefined();
    // Flow pressure still applies to the eraser.
    expect(checkbox(tree, "Pressure flow")).toBeDefined();
  });
});

// #432: Erase to History and Auto Erase existed as engine behaviour (mode 12,
// the foreground colour) with no way to reach them from the tool bars.
describe("eraser and pencil bars (#432)", () => {
  it("offers Erase to History on the Eraser, enabled only once a source is set", () => {
    const noSource = mountOptionsBar({ tool: "erase", hasHistorySource: false, brush: { ...BRUSH, eraseToHistory: false } });
    const box = checkbox(noSource, "Erase to History");
    expect(box, "Erase to History checkbox").toBeDefined();
    expect(box!.props.disabled).toBe(true);

    const withSource = mountOptionsBar({ tool: "erase", hasHistorySource: true, brush: { ...BRUSH, eraseToHistory: false } });
    const live = checkbox(withSource, "Erase to History")!;
    expect(live.props.disabled).toBe(false);
    live.props.onChange(true);
    expect(stub.calls).toContainEqual(["setBrush", { eraseToHistory: true }]);
  });

  it("offers Auto Erase on the Pencil, and nowhere else", () => {
    const pencil = mountOptionsBar({ tool: "pencil", brush: { ...BRUSH, autoErase: false } });
    const box = checkbox(pencil, "Auto Erase");
    expect(box, "Auto Erase checkbox").toBeDefined();
    box!.props.onChange(true);
    expect(stub.calls).toContainEqual(["setBrush", { autoErase: true }]);
    expect(checkbox(mountOptionsBar({ tool: "brush" }), "Auto Erase")).toBeUndefined();
    expect(checkbox(mountOptionsBar({ tool: "brush" }), "Erase to History")).toBeUndefined();
  });
});

/** A Monet <Select>, found by its aria-label. */
function select(tree: El[], label: string) {
  const el = tree.find((e) => Array.isArray(e.props.options) && e.props["aria-label"] === label);
  expect(el, `${label} select`).toBeDefined();
  return el!;
}
const optionLabels = (sel: El) => sel.props.options.map((o: { value: string; label?: string }) => o.label ?? o.value);

// #433: the retouch brushes could only read the active layer, the Background
// Eraser keyed once per stroke with no Limits, and the Mixer had neither
// reservoir toggles nor moisture presets — none of it reachable from a bar.
describe("retouch sampling, eraser limits and mixer presets (#433)", () => {
  it("offers Sample All Layers on Blur, Sharpen, Smudge and Mixer only", () => {
    for (const tool of ["blur", "sharpen", "smudge", "mixerbrush"]) {
      const box = checkbox(mountOptionsBar({ tool }), "Sample All Layers");
      expect(box, `${tool} Sample All Layers`).toBeDefined();
      expect(box!.props.checked).toBe(false);
      box!.props.onChange(true);
      expect(stub.calls).toContainEqual(["setBrush", { sampleAllLayers: true }]);
    }
    expect(checkbox(mountOptionsBar({ tool: "brush" }), "Sample All Layers")).toBeUndefined();
    expect(checkbox(mountOptionsBar({ tool: "backgrounderaser" }), "Sample All Layers")).toBeUndefined();
  });

  it("gives the Background Eraser its Sampling and Limits dropdowns", () => {
    const tree = mountOptionsBar({ tool: "backgrounderaser" });
    const sampling = select(tree, "Background Eraser sampling");
    expect(sampling.props.value).toBe("1");
    expect(optionLabels(sampling)).toEqual(["Continuous", "Once", "Background Swatch"]);
    sampling.props.onChange("2");
    const limits = select(tree, "Background Eraser limits");
    // Once + Discontiguous is what the tool did before these dropdowns existed.
    expect(limits.props.value).toBe("0");
    expect(optionLabels(limits)).toEqual(["Discontiguous", "Contiguous", "Find Edges"]);
    limits.props.onChange("1");
    expect(stub.calls).toContainEqual(["setBrush", { bgEraserSampling: 2 }]);
    expect(stub.calls).toContainEqual(["setBrush", { bgEraserLimits: 1 }]);
  });

  it("lets the Mixer pick a moisture preset that sets Wet, Load and Mix together", () => {
    const tree = mountOptionsBar({ tool: "mixerbrush" });
    const preset = select(tree, "Mixer Brush preset");
    expect(preset.props.value).toBe("wet"); // 50 / 50 / 50 is PS's Wet combination
    expect(optionLabels(preset)).toEqual(["Custom", "Dry", "Moist", "Wet", "Very Wet"]);
    preset.props.onChange("dry");
    preset.props.onChange("veryWet");
    expect(stub.calls.filter((c) => c[0] === "setBrush").map((c) => c[1])).toEqual([
      { mixerWet: 0, mixerLoad: 0.5, mixerMix: 1 },
      { mixerWet: 1, mixerLoad: 0.5, mixerMix: 0 },
    ]);
    // Any other combination reads back as Custom, which selects nothing.
    const custom = select(mountOptionsBar({ tool: "mixerbrush", brush: { ...BRUSH, mixerWet: 0.3 } }), "Mixer Brush preset");
    expect(custom.props.value).toBe("custom");
    custom.props.onChange("custom");
    expect(stub.calls.some((c) => c[0] === "setBrush")).toBe(false);
  });

  it("toggles Load / Clean the brush after each stroke through the brush state", () => {
    const tree = mountOptionsBar({ tool: "mixerbrush" });
    const load = checkbox(tree, "Load after stroke");
    const clean = checkbox(tree, "Clean after stroke");
    expect(load?.props.checked).toBe(true);
    expect(clean?.props.checked).toBe(false);
    load!.props.onChange(false);
    clean!.props.onChange(true);
    expect(stub.calls).toContainEqual(["setBrush", { mixerAutoLoad: false }]);
    expect(stub.calls).toContainEqual(["setBrush", { mixerAutoClean: true }]);
  });
});

// #431: the Healing Brush blends through a boundary solve and the Spot Healing
// Brush routes three distinct types — all of it engine-side and unreachable
// until the two options bars grew the controls.
describe("healing bars (#431)", () => {
  it("offers the Healing Brush Source: Sampled | Pattern", () => {
    const tree = mountOptionsBar({ tool: "heal" });
    const source = segmented(tree, "Pattern");
    expect(source, "Source control").toBeDefined();
    expect(source!.props.value).toBe("sampled");
    source!.props.onChange("pattern");
    expect(stub.calls).toContainEqual(["setBrush", { healSource: "pattern" }]);
    expect(source!.props.items.map((i: { label: string }) => i.label)).toEqual(["Sampled", "Pattern"]);
  });

  it("offers Diffusion over Photoshop's 1..7 range, as whole steps", () => {
    const { control, readout } = sliderRow(mountOptionsBar({ tool: "heal" }), "Diffusion");
    expect(readout).toBe("5");
    expect(control.props.value).toBeCloseTo((5 - 1) / (7 - 1), 6);
    control.props.onChange(0);
    control.props.onChange(1);
    control.props.onChange(0.5);
    expect(stub.calls.filter((c) => c[0] === "setBrush").map((c) => c[1])).toEqual([
      { healDiffusion: 1 }, { healDiffusion: 7 }, { healDiffusion: 4 },
    ]);
  });

  it("keeps Source and Diffusion off the Clone Stamp, which has neither", () => {
    const clone = mountOptionsBar({ tool: "clone" });
    expect(segmented(clone, "Pattern")).toBeUndefined();
    expect(clone.find((e) => Array.isArray(e.props.children) && e.props.children[0]?.props?.children === "Diffusion")).toBeUndefined();
  });

  it("offers the Spot Healing Type picker and Sample All Layers", () => {
    const tree = mountOptionsBar({ tool: "spothealing" });
    const type = segmented(tree, "Proximity Match");
    expect(type, "Type control").toBeDefined();
    expect(type!.props.items.map((i: { label: string }) => i.label))
      .toEqual(["Content-Aware", "Proximity Match", "Create Texture"]);
    expect(type!.props.value).toBe("0");
    type!.props.onChange("2");
    expect(stub.calls).toContainEqual(["setBrush", { spotHealType: 2 }]);

    const all = checkbox(tree, "Sample All Layers");
    expect(all, "Sample All Layers checkbox").toBeDefined();
    expect(all!.props.checked).toBe(false);
    all!.props.onChange(true);
    expect(stub.calls).toContainEqual(["setBrush", { spotHealSampleAll: true }]);
  });

  it("reflects the picked Spot Healing type back into the control", () => {
    const tree = mountOptionsBar({ tool: "spothealing", brush: { ...BRUSH, spotHealType: 1, spotHealSampleAll: true } });
    expect(segmented(tree, "Proximity Match")!.props.value).toBe("1");
    expect(checkbox(tree, "Sample All Layers")!.props.checked).toBe(true);
  });
});

// #428: the Patch tool's bar was one line of help text — Mode, Source vs
// Destination, Transparent and the Content-Aware Structure / Color sliders had
// no state and no control.
describe("patch options bar (#428)", () => {
  const PATCH = { tool: "patch", patchMode: 0, patchDestination: false, patchTransparent: false, patchStructure: 4, patchColor: 2 };

  it("offers Mode, Source / Destination and Transparent in Normal mode, and writes each to the store", () => {
    const tree = mountOptionsBar(PATCH);
    const mode = segmented(tree, "Content-Aware")!;
    expect(mode.props.value).toBe("0");
    mode.props.onChange("1");
    const dir = segmented(tree, "Destination")!;
    expect(dir.props.value).toBe("source");
    dir.props.onChange("destination");
    const box = checkbox(tree, "Transparent")!;
    expect(box.props.checked).toBe(false);
    box.props.onChange(true);
    expect(stub.calls.filter((c) => c[0] === "setOptions").map((c) => c[1])).toEqual([
      { patchMode: 1 }, { patchDestination: true }, { patchTransparent: true },
    ]);
    // Structure / Color are Content-Aware controls; Normal mode does not show them.
    expect(tree.find((e) => Array.isArray(e.props.children) && e.props.children[0]?.props?.children === "Structure")).toBeUndefined();
  });

  it("swaps Transparent for Structure 1..7 and Color 0..10 in Content-Aware mode", () => {
    const tree = mountOptionsBar({ ...PATCH, patchMode: 1 });
    expect(checkbox(tree, "Transparent")).toBeUndefined();
    const structure = sliderRow(tree, "Structure");
    expect(structure.readout).toBe(4);
    structure.control.props.onChange(1);
    const color = sliderRow(tree, "Color");
    expect(color.readout).toBe(2);
    color.control.props.onChange(0);
    expect(stub.calls.filter((c) => c[0] === "setOptions").map((c) => c[1])).toEqual([
      { patchStructure: 7 }, { patchColor: 0 },
    ]);
  });
});

describe("content-aware move options bar (#429)", () => {
  const CAM = { tool: "contentawaremove", camExtend: false, camStructure: 4, camColor: 2, camTransformOnDrop: false };

  it("offers Mode (Move / Extend), Structure, Color and Transform On Drop, and writes each to the store", () => {
    const tree = mountOptionsBar(CAM);
    const mode = segmented(tree, "Extend")!;
    expect(mode.props.items.map((i: { label: string }) => i.label)).toEqual(["Move", "Extend"]);
    expect(mode.props.value).toBe("move");
    expect(mode.props["aria-label"]).toBe("Mode");
    mode.props.onChange("extend");
    const structure = sliderRow(tree, "Structure");
    expect(structure.readout).toBe(4);
    structure.control.props.onChange(1);
    const color = sliderRow(tree, "Color");
    expect(color.readout).toBe(2);
    color.control.props.onChange(0);
    const drop = checkbox(tree, "Transform On Drop")!;
    expect(drop.props.checked).toBe(false);
    drop.props.onChange(true);
    expect(stub.calls.filter((c) => c[0] === "setOptions").map((c) => c[1])).toEqual([
      { camExtend: true }, { camStructure: 7 }, { camColor: 0 }, { camTransformOnDrop: true },
    ]);
  });

  it("names the sliders for assistive tech and steps them one whole unit per arrow key", () => {
    const tree = mountOptionsBar(CAM);
    const structure = sliderRow(tree, "Structure").control.props;
    expect(structure["aria-label"]).toBe("Structure");
    expect(structure.step).toBeCloseTo(1 / 6, 9);
    const color = sliderRow(tree, "Color").control.props;
    expect(color["aria-label"]).toBe("Color");
    expect(color.step).toBeCloseTo(1 / 10, 9);
  });
});

// #456: with the Path Selection tool active the options bar retargets Align /
// Distribute to the shift-click-selected path components, and adds Arrange.
describe("path selection bar (#456)", () => {
  const button = (tree: El[], id: string) => tree.find((e) => e.props.id === id);
  // Rendering also reads store predicates (canRepeat…); only the actions matter here.
  const actions = () => stub.calls.filter((c) => /^(align|distribute|arrange)/.test(c[0]));

  it("aligns and distributes the selected COMPONENTS, not the layers", () => {
    const tree = mountOptionsBar({ tool: "pathselect", selectedPaths: ["a", "b"] });
    button(tree, "mv-align-left")!.props.onClick();
    button(tree, "mv-align-bottom")!.props.onClick();
    button(tree, "mv-dist-hcenter")!.props.onClick();
    button(tree, "mv-dist-vspace")!.props.onClick();
    expect(actions()).toEqual([
      ["alignPathComponents", 0], ["alignPathComponents", 5],
      ["distributePathComponents", 0, 1], ["distributePathComponents", 1, 3],
    ]);
  });

  it("offers Bring to Front / Send to Back over the selection", () => {
    const tree = mountOptionsBar({ tool: "pathselect", selectedPaths: ["a"] });
    button(tree, "mv-arrange-front")!.props.onClick();
    button(tree, "mv-arrange-back")!.props.onClick();
    expect(actions()).toEqual([["arrangePathComponents", true], ["arrangePathComponents", false]]);
    expect(tree.some((e) => e.props.children?.[0] === 1 && e.props.children?.[1] === " component")).toBe(true);
  });

  it("leaves the Move tool's strip on the layers", () => {
    const tree = mountOptionsBar({ tool: "move", selectedPaths: ["a", "b"] });
    button(tree, "mv-align-left")!.props.onClick();
    button(tree, "mv-dist-hcenter")!.props.onClick();
    expect(actions()).toEqual([["alignLayer", 0], ["distributeLayers", 0, 1]]);
    expect(button(tree, "mv-arrange-front")).toBeUndefined();
  });
});
