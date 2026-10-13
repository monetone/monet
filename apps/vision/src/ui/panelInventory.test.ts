import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

// Guards VIS-WS-04: Actions, Properties and the Measurement Log are real dock
// panels, not a strip inside History and a modal over the canvas.
//
// App.tsx and Panels.tsx reach the WASM engine, Tauri and the DOM through
// state/app, so that boundary is stubbed. The app shell renders through React's
// real hook dispatcher without mounting native dock/canvas children. Panels
// retain the small synchronous harness used by ./dialogs/common.test.ts so
// their returned controls and event handlers can be inspected directly.
const stub = vi.hoisted(() => {
  const slots: Array<{ current: any }> = [];
  const effects: Array<() => void> = [];
  const engine = new Proxy({} as Record<string, any>, { get: (t, key: string) => {
    if (key in t) return t[key];
    if (!state.documents.length && key === "e") throw new Error("Engine not ready");
    if (!state.documents.length && key === "engine") return null;
    return () => "";
  } });
  let cursor = 0;
  let rerender: (() => void) | null = null;
  const calls: Array<[string, ...unknown[]]> = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  // Unknown keys read as [] so the app shell — which selects ~60 slices — can
  // render without this test having to model the whole store.
  const state = new Proxy({} as Record<string, any>, { get: (t, p: string) => (p in t ? t[p] : []) });
  return {
    calls, record, state, effects, engine, rendering: false,
    reset() {
      slots.length = 0; cursor = 0; calls.length = 0; effects.length = 0;
      for (const k of Object.keys(state)) delete state[k];
      for (const k of Object.keys(engine)) delete engine[k];
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
    useRef: (initial: unknown) => stub.rendering ? real.useRef(initial) : stub.slot(initial),
    // Deps-aware, like React: a memo only recomputes when a dep changes
    // identity, so a test can see what a panel re-reads per render.
    useMemo: (fn: () => unknown, deps: unknown[]) => {
      if (stub.rendering) return real.useMemo(fn, deps);
      const s = stub.slot(null) as { current: { deps?: unknown[]; value: unknown } | null };
      const stale = !s.current || !deps || !s.current.deps
        || deps.length !== s.current.deps.length || deps.some((d, i) => !Object.is(d, s.current!.deps![i]));
      if (stale) s.current = { deps, value: fn() };
      return s.current!.value;
    },
    useCallback: (fn: (...args: any[]) => unknown, deps: unknown[]) => stub.rendering ? real.useCallback(fn, deps) : fn,
    useContext: () => ({ open: stub.record("openDialog"), close: stub.record("closeDialog"), current: typeof stub.state.dialogName === "string" ? stub.state.dialogName : null, arg: null }),
    useEffect: (fn: () => void) => { stub.effects.push(fn); },
    useState: (initial: unknown) => {
      if (stub.rendering) return real.useState(initial);
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
  useFileDrop: () => {},
  useMonetContext: () => ({ platform: "mac" }),
  useToast: () => ({ show: () => {}, push: stub.record("toastPush"), dismiss: stub.record("toastDismiss") }),
}));

/** One saved action with two steps — enough for the set list AND the step tree. */
const SAVED = vi.hoisted(() => ({
  action: { id: 1, name: "Sepia", set: "Default", favorite: false, stepCount: 2 },
  steps: [
    { index: 0, label: "Hue/Saturation", args: "", enabled: true, dialog: false, volatile: false },
    { index: 1, label: "Levels", args: "", enabled: true, dialog: false, volatile: false },
  ],
}));

const actionsApi = vi.hoisted(() => ({
  isRecording: () => false,
  count: () => 0,
  list: () => [SAVED.action],
  filter: (query: string, favoritesOnly: boolean) =>
    [SAVED.action].filter((a) => a.name.toLowerCase().includes(query.toLowerCase()) && (!favoritesOnly || a.favorite)),
  isPersistable: () => true,
  getSteps: () => SAVED.steps,
  start: () => {}, stop: () => {}, play: () => {}, save: () => {}, exportJson: () => "[]",
  exportAtn: (...a: unknown[]) => { stub.calls.push(["exportAtn", ...a]); return new Uint8Array([1, 2]); },
  // Insert Menu Item / Insert Conditional / Playback Options (#467).
  menuItemPaths: () => ["adj.invert", "fil.gaussian"],
  insertMenuItem: (id: number, path: string) => {
    stub.calls.push(["insertMenuItem", id, path]);
    return path !== "bogus.op"; // the field is free text, so rejection is reachable
  },
  insertConditional: (...a: unknown[]) => { stub.calls.push(["insertConditional", ...a]); return true; },
  allowToolRecording: () => false,
  setAllowToolRecording: (...a: unknown[]) => { stub.calls.push(["setAllowToolRecording", ...a]); },
  playbackMode: () => "accelerated",
  setPlaybackMode: (...a: unknown[]) => { stub.calls.push(["setPlaybackMode", ...a]); },
}));

// The app shell imports ~85 names from state/app; every one of them is a
// side-effecting singleton or action, so the whole module is stubbed.
vi.mock("../state/app", () => new Proxy({} as Record<string, unknown>, {
  has: () => true,
  getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
  get: (_t, prop: string) => {
    switch (prop) {
      case "useStore": return (select: (s: unknown) => unknown) => select(stub.state);
      case "actions": return actionsApi;
      case "engine": return stub.engine;
      case "store": return new Proxy({}, {
        get: (_s, method: string) => {
          if (method === "state") return stub.state;
          if (method === "getSnapshot") return () => stub.state;
          if (method === "savedSelectionNames" || method === "channelThumbUrls") return () => [];
          if (method === "setPanelOptions") return (patch: Record<string, unknown>) => {
            stub.calls.push(["setPanelOptions", patch]);
            stub.state.panelOptions = { ...stub.state.panelOptions, ...patch };
            stub.invalidate();
          };
          if (method === "layerMaskDensity") return (...a: unknown[]) => { stub.calls.push(["layerMaskDensity", ...a]); return 55; };
          if (method === "layerMaskFeather") return (...a: unknown[]) => { stub.calls.push(["layerMaskFeather", ...a]); return 1.5; };
          // #450: the Shape section reads the live scene per render; the fixture
          // rides in the state so a test can hand the panel a shape (or none).
          if (method === "shapeProps") return () => { stub.calls.push(["shapeProps"]); return stub.state.shape ?? null; };
          return stub.record(method);
        },
      });
      case "then": return undefined;
      default: return stub.record(prop);
    }
  },
}));

const { App } = await import("../App");
const { ActionsPanel, HistoryPanel, LayersPanel, PropertiesPanel, MeasurementLogPanel, ColorPanel, HistogramPanel, ChannelsPanel, SwatchesPanel, CloneSourcePanel, PathsPanel } = await import("./Panels");
const { DEFAULT_CLONE_TRANSFORM } = await import("../state/cloneSample");
const { FX } = await import("../state/effects");
const { MeasurementRows, DialogProvider } = await import("./Dialogs");

type El = { type: any; props: Record<string, any>; ref?: any };
const renderers: ReactTestRenderer[] = [];
function disposeRenders() { act(() => { for (const renderer of renderers.splice(0)) renderer.unmount(); }); }
afterEach(disposeRenders);

/** Shallow capture with React's dispatcher; native children stay unmounted. */
function renderWithHooks(component: () => unknown): unknown {
  let output: unknown;
  function Capture() {
    stub.rendering = true;
    try { output = component(); } finally { stub.rendering = false; }
    return null;
  }
  act(() => { renderers.push(create(createElement(Capture))); });
  return output;
}

function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  return out;
}

function baseState() {
  return {
    doc: { width: 64, height: 48 }, documents: [{ id: 1, name: "Untitled" }], activeDocId: 1, activeLayerId: 3, tool: "move", mode: 0, depth: 8, zoom: 1,
    screenMode: "standard", measureScale: { unit: "px" }, pixelAspect: { name: "Square" },
    layers: [{ id: 3, name: "Layer 1", kind: 0 }],
    history: ["Brush"], historyIndex: 1, canUndo: true, canRedo: false, historyStates: 50,
    historyOptions: { showNewSnapshotDialog: false },
    snapshots: [{ id: 9, name: "Snapshot 1" }],
    measurements: [], dataPoints: {}, shape: null, selectedPaths: [],
  } as Record<string, unknown>;
}

/** Renders a real panel, re-rendering on every setState. */
function mount(component: () => unknown, patch: Record<string, unknown> = {}) {
  stub.reset();
  stub.put({ ...baseState(), ...patch });
  stub.engine.channelHistogram = () => new Uint32Array(256);
  let tree: El[] = [];
  const draw = () => { stub.begin(draw); tree = walk(component() as unknown as El); };
  draw();
  const find = (pred: (e: El) => boolean) => tree.find(pred);
  return {
    tree: () => tree,
    has: (attr: string) => tree.some((e) => attr in e.props),
    byAttr: (attr: string) => find((e) => attr in e.props)!,
    byLabel: (label: string) => find((e) => e.props["aria-label"] === label)!,
    byTitle: (title: string) => find((e) => e.props.title === title)!,
    byText: (text: string) => find((e) => e.props.children === text)!,
    labels: () => tree.map((e) => e.props["aria-label"]).filter(Boolean),
  };
}

/** Renders the app shell down to the dock, and hands back what it configured. */
function mountShell(patch: Record<string, unknown> = {}) {
  disposeRenders();
  stub.reset();
  stub.put({ ...baseState(), ...patch });
  const toasts = renderWithHooks(App) as El;
  const provider = walk(toasts.props.children).find((e) => typeof e.type === "function")!; // DialogProvider
  const editor = walk(provider.props.children).find((e) => e.type?.name === "Editor")!;
  const dock = walk(renderWithHooks(() => editor.type(editor.props))).find((e) => e.props.panels)!;
  const ref = dock.ref ?? dock.props.ref;
  const openPanel = (id: string) => { stub.calls.push(["openPanel", id]); };
  ref.current = { openPanel, closePanel: () => {}, getLayout: () => ({}) };
  return { panels: dock.props.panels, layout: dock.props.initialLayout, menus: dock.props.menus, dock };
}

const menuItem = (items: any[], id: string): any => {
  for (const item of items ?? []) {
    if (item?.id === id) return item;
    const nested = menuItem(item?.items, id);
    if (nested) return nested;
  }
  return undefined;
};

describe("panel flyouts (#480)", () => {
  const colors = { fg: { h: 0, s: 0, v: 0 }, bg: { h: 0, s: 0, v: 100 }, colorRampMode: "spectrum", swatches: ["#123456"], histScope: "histogram", histAllChannels: false, spotChannelNames: [], quickMask: false, layerFilter: "", layerFilterOpen: false, layerColorLabels: {}, layerColorFilter: "all", layerKindFilter: "all", layerAttributeFilter: "all", layerModeFilter: "all", layerEffectFilter: "all" };
  function flyout(ui: ReturnType<typeof mount>, name: string) {
    return ui.tree().find((e) => Array.isArray(e.props.items) && typeof e.props.children === "function"
      && e.props.children({}).props["data-mv-panel-flyout"] === name)!;
  }

  it("exposes accessible flyouts on all seven panels, including alternate histogram views", () => {
    for (const [name, component] of [["Layers", LayersPanel], ["Channels", ChannelsPanel], ["Color", ColorPanel], ["Swatches", SwatchesPanel], ["Histogram", HistogramPanel], ["Actions", ActionsPanel], ["Paths", PathsPanel]] as const) {
      const menu = flyout(mount(component, colors), name);
      expect(menu, name).toBeDefined();
      expect(menu.props.children({}).props["aria-label"]).toBe(`${name} panel menu`);
    }
    expect(flyout(mount(HistogramPanel, { ...colors, histScope: "vectorscope" }), "Histogram")).toBeDefined();
  });

  it("offers Clipping Path… on the Paths flyout once a saved path exists (#457)", () => {
    expect(menuItem(flyout(mount(PathsPanel, colors), "Paths").props.items, "paths-clipping").disabled).toBe(true);

    const savedPaths = [{ name: "Path 1", path: [0, 0, 4, 0, 4, 4] }, { name: "Path 2", path: [0, 0, 4, 0, 4, 4], clipFlatness: 3 }];
    const ui = mount(PathsPanel, { ...colors, savedPaths });
    const openClipping = () => menuItem(flyout(ui, "Paths").props.items, "paths-clipping").action();
    expect(menuItem(flyout(ui, "Paths").props.items, "paths-clipping").disabled).toBe(false);
    expect(ui.byAttr("data-mv-path-clipping").props["data-mv-path-row"]).toBe(1);

    const dialog = () => ui.tree().find((e) => e.props.title === "Clipping Path");
    const button = (label: string) => walk(dialog()!.props.footer).find((e) => e.props.children === label)!;
    openClipping();
    // Seeded from the current clipping path; the field carries Photoshop's range.
    expect(ui.byLabel("Path").props.value).toBe("1");
    expect(ui.byLabel("Flatness").props).toMatchObject({ value: 3, min: 0.2, max: 100 });
    ui.byLabel("Flatness").props.onChange(7);
    button("Cancel").props.onClick();
    expect(dialog()).toBeUndefined();
    expect(stub.calls.filter(([method]) => method === "setClippingPath")).toEqual([]);

    openClipping();
    expect(ui.byLabel("Flatness").props.value).toBe(3); // Cancel discarded the draft
    ui.byLabel("Path").props.onChange("-1");
    button("OK").props.onClick();
    expect(stub.calls.filter(([method]) => method === "setClippingPath")).toEqual([["setClippingPath", null, 3]]);
  });

  it("applies layer/channel thumbnail sizes and swatch list mode to the rendered panel", () => {
    const layers = mount(LayersPanel, colors);
    menuItem(flyout(layers, "Layers").props.items, "layerThumbnailSize-64").action();
    expect(layers.byAttr("data-mv-layers-panel").props.style["--mv-layer-thumbnail-size"]).toBe("64px");
    const channels = mount(ChannelsPanel, colors);
    menuItem(flyout(channels, "Channels").props.items, "channelThumbnailSize-40").action();
    expect(channels.byAttr("data-mv-channel").props.style.minHeight).toBe(44);
    const swatches = mount(SwatchesPanel, colors);
    menuItem(flyout(swatches, "Swatches").props.items, "swatches-list").action();
    expect(swatches.byAttr("data-mv-swatch-view").props["data-mv-swatch-view"]).toBe("list");
    expect(swatches.byAttr("data-mv-swatch-view").props.style.gridTemplateColumns).toBe("1fr");
    expect(swatches.byText("#123456")).toBeDefined();
  });

  it("routes Actions playback, Color ramp and Histogram options to their existing operations", () => {
    const actions = mount(ActionsPanel, colors);
    menuItem(flyout(actions, "Actions").props.items, "playback-stepByStep").action();
    expect(stub.calls).toContainEqual(["setPlaybackMode", "stepByStep"]);
    const color = mount(ColorPanel, colors);
    menuItem(flyout(color, "Color").props.items, "ramp-grayscale").action();
    expect(stub.calls).toContainEqual(["setOptions", { colorRampMode: "grayscale" }]);
    const histogram = mount(HistogramPanel, colors);
    menuItem(flyout(histogram, "Histogram").props.items, "histogram-all-channels").action();
    expect(stub.calls).toContainEqual(["setOptions", { histScope: "histogram", histAllChannels: true }]);
  });

  // The desktop webview has no window.prompt (wry implements no text-input
  // panel), so a prompt-driven item did nothing there. Like Photoshop's
  // Channels button it saves the next Alpha straight away (#480).
  it("saves the selection as the next Alpha channel from the Channels flyout without a prompt", () => {
    expect(typeof prompt).toBe("undefined");
    const channels = mount(ChannelsPanel, { ...colors, selectionActive: true });
    menuItem(flyout(channels, "Channels").props.items, "channels-save").action();
    expect(stub.calls.filter(([method]) => method === "saveSelection")).toEqual([["saveSelection", "Alpha"]]);
  });

  it("shows a saved panel-options load error in the panels whose options it holds", () => {
    const error = "Saved panel options could not be loaded.";
    for (const component of [LayersPanel, ChannelsPanel, SwatchesPanel]) {
      const alert = mount(component, { ...colors, panelOptionsError: error }).tree().find((e) => e.type?.name === "PanelOptionsError");
      expect(alert, component.name).toBeDefined();
      expect(alert!.type(alert!.props).props).toMatchObject({ role: "alert", children: error });
    }
  });
});

it("Home mounts no document panels or tools and only dispatches documentless commands", () => {
  const { dock, menus, panels } = mountShell({ documents: [], doc: { width: 0, height: 0 }, layers: [], activeLayerId: 0 });
  const home = dock.props.canvas;
  expect(home.type.name).toBe("Home");
  home.props.onNew();
  home.props.onOpen();
  home.props.onOpenRecent("/photo.png");
  expect(stub.calls).toContainEqual(["openDialog", "new"]);
  expect(stub.calls).toContainEqual(["openFiles"]);
  expect(stub.calls).toContainEqual(["openPaths", ["/photo.png"]]);
  for (const panel of Object.values(panels) as { render: () => El }[]) expect(panel.render().props.children).toBeUndefined();
  expect(dock.props.toolbarDefs.options.render().props.children).toBeUndefined();
  expect(dock.props.statusBar).toBeNull();
  for (const id of ["save", "undo", "clear", "recordmeasurements"]) expect(menuItem(menus, id).action).toBeUndefined();
  expect(menuItem(menus, "new").action).toBeTypeOf("function");
  expect(menuItem(menus, "openf").action).toBeTypeOf("function");
});

it("Export Preferences saves and closes on Home without accessing an engine", () => {
  const dialog = mount(() => {
    const host = walk(DialogProvider({ children: null })).find((e) => typeof e.type === "function")!;
    const picked = host.type(host.props) as El;
    const rendered = picked.type(picked.props) as El;
    return [rendered, rendered.props.footer];
  }, { documents: [], doc: { width: 0, height: 0 }, dialogName: "exportPrefs", exportPrefs: { format: "png", quality: 90 } });
  expect(() => dialog.byText("OK").props.onClick()).not.toThrow();
  expect(stub.calls).toContainEqual(["setExportPrefs", { format: "png", quality: 90 }]);
  expect(stub.calls).toContainEqual(["closeDialog"]);
});
it("a retained edit-error toast cannot convert a closed or different document", () => {
  mountShell({ pendingDialog: null });
  const original = { doc_depth: () => 32 };
  stub.engine.engine = original;
  stub.engine.onEditError = null;
  for (const effect of stub.effects) {
    effect();
    if (stub.engine.onEditError) break;
  }
  expect(stub.engine.onEditError).toBeTypeOf("function");
  stub.engine.onEditError("Box Blur is not 32-bit-float safe; convert the document to 16 or 8 bits/channel first");
  const notice = stub.calls.find(([kind]) => kind === "toastPush")![1] as { action: { onClick: () => void } };
  notice.action.onClick();
  expect(stub.calls).toContainEqual(["setDepth", 16]);
  stub.calls.length = 0;
  for (const current of [null, { doc_depth: () => 32 }]) {
    stub.engine.engine = current;
    notice.action.onClick();
    expect(stub.calls).not.toContainEqual(["setDepth", 16]);
  }
});
it("a 32-bit edit-error toast offers Convert to 16-bit only when converting fixes it", () => {
  mountShell({ pendingDialog: null });
  stub.engine.engine = { doc_depth: () => 32 };
  stub.engine.onEditError = null;
  for (const effect of stub.effects) {
    effect();
    if (stub.engine.onEditError) break;
  }
  for (const message of [
    "Could not apply the edit because the layer is locked.",
    "Could not save presets — browser storage is full or unavailable. Free storage and try again.",
  ]) {
    stub.calls.length = 0;
    stub.engine.onEditError(message);
    const notice = stub.calls.find(([kind]) => kind === "toastPush")![1] as { message: string; action?: unknown };
    expect(notice.message).toBe(message);
    expect(notice.action).toBeUndefined();
  }
});

/** Every panel id the dock layout puts in a tab strip. */
function layoutTabs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) { for (const n of node) layoutTabs(n, out); return out; }
  if (!node || typeof node !== "object") return out;
  const o = node as Record<string, unknown>;
  if (Array.isArray(o.tabs)) out.push(...(o.tabs as string[]));
  for (const v of Object.values(o)) layoutTabs(v, out);
  return out;
}

beforeEach(() => { stub.calls.length = 0; });

describe("dock panel inventory", () => {
  it("registers Properties, Actions and Measurement Log as dock panels", () => {
    const { panels } = mountShell();
    for (const [id, title, component] of [
      ["properties", "Properties", PropertiesPanel],
      ["actions", "Actions", ActionsPanel],
      ["measurementlog", "Measurement Log", MeasurementLogPanel],
    ] as const) {
      expect(panels[id]?.title, id).toBe(title);
      // The registry renders THAT panel — not a placeholder, not History's strip.
      expect((panels[id].render() as El).type, id).toBe(component);
    }
  });

  it("hands the dock an app info panel carrying the GitHub link for the title-bar pill", () => {
    const { dock } = mountShell();
    const panel = dock.props.appPanel as El;
    expect(panel).toBeDefined();
    const tree = walk(panel.type(panel.props));
    expect(tree.some((e) => e.props.href === "https://github.com/monetone/monet")).toBe(true);
  });

  it("docks Properties and Actions in the factory seed, so they are reachable without the Window menu", () => {
    const tabs = layoutTabs(mountShell().layout);
    expect(tabs).toContain("properties");
    expect(tabs).toContain("actions");
  });

  it("registers Clone Source behind Window ▸ Clone Source, leaving the factory seed alone (#427)", () => {
    const { panels, layout, menus } = mountShell();
    expect(panels.clonesource?.title).toBe("Clone Source");
    expect((panels.clonesource.render() as El).type).toBe(CloneSourcePanel);
    const item = menuItem(menus, "panel-clonesource");
    expect(item.label).toBe("Clone Source");
    item.action();
    expect(stub.calls).toContainEqual(["openPanel", "clonesource"]);
    // Saved and built-in layouts predate it; the Window menu docks it on demand.
    expect(layoutTabs(layout)).not.toContain("clonesource");
  });
});

describe("Clone Source panel (#427)", () => {
  const slots = () => Array.from({ length: 5 }, (_, i) => ({
    source: i === 1 ? { docId: 1, x: 12.4, y: 7.6 } : null,
    transform: { ...DEFAULT_CLONE_TRANSFORM },
  }));
  const cloneState = (patch: Record<string, unknown> = {}) => ({
    cloneSources: slots(), cloneSourceSlot: 1, cloneOverlay: { show: false, opacity: 100 }, cloneSourceError: "", ...patch,
  });
  const count = (name: string) => stub.calls.filter((c) => c[0] === name).length;
  const key = (k: string) => ({ key: k, preventDefault: () => {}, stopPropagation: () => {} });

  it("offers five labelled slots, the active slot's transform and the overlay", () => {
    const ui = mount(CloneSourcePanel, cloneState());
    const group = ui.byLabel("Clone sources");
    expect(group.props.items.map((i: { label: string }) => i.label)).toEqual(["1", "2", "3", "4", "5"]);
    expect(group.props.value).toBe("1");
    group.props.onChange("3");
    expect(stub.calls).toContainEqual(["selectCloneSlot", 3]);
    expect(ui.byText("Untitled · 12, 8"), "the slot names the document it samples").toBeDefined();
    for (const label of ["Source width (%)", "Source height (%)", "Source angle (°)", "Show Overlay", "Overlay opacity (%)"]) {
      expect(ui.labels()).toContain(label);
    }
    const flip = ui.byText("Flip Horizontal");
    expect(flip.props["aria-pressed"]).toBe(false);
    flip.props.onClick();
    expect(stub.calls).toContainEqual(["setCloneTransform", { flipH: true }]);
    ui.byText("Reset Transform").props.onClick();
    expect(stub.calls).toContainEqual(["setCloneTransform", DEFAULT_CLONE_TRANSFORM]);
    ui.byLabel("Show Overlay").props.onChange(true);
    expect(stub.calls).toContainEqual(["setCloneOverlay", { show: true }]);
    expect(ui.tree().some((e) => e.props.role === "alert")).toBe(false);
  });

  it("hands a typed value to the store unclamped on Enter, and drops it on Escape", () => {
    const width = mount(CloneSourcePanel, cloneState()).byLabel("Source width (%)");
    const field = mount(() => width.type(width.props));
    const input = () => field.byLabel("Source width (%)");
    expect(input().props.value).toBe("100");
    input().props.onBlur(); // tabbing through commits nothing
    expect(count("setCloneTransform")).toBe(0);

    input().props.onChange({ currentTarget: { value: "0" } });
    expect(input().props.value).toBe("0");
    input().props.onKeyDown(key("Enter"));
    expect(stub.calls).toContainEqual(["setCloneTransform", { w: 0 }]); // the store decides, and refuses
    input().props.onBlur(); // the blur that follows Enter is not a second commit
    expect(count("setCloneTransform")).toBe(1);

    input().props.onChange({ currentTarget: { value: "250" } });
    input().props.onKeyDown(key("Escape"));
    input().props.onBlur();
    expect(count("setCloneTransform"), "Escape leaves the edit unapplied").toBe(1);
    expect(input().props.value).toBe("100");
  });

  it("shows a refused edit as an alert", () => {
    const error = "Width must be a number from 1% to 1000%.";
    const ui = mount(CloneSourcePanel, cloneState({ cloneSourceError: error }));
    expect(ui.tree().find((e) => e.props.role === "alert")?.props.children).toBe(error);
  });
});

describe("Actions panel", () => {
  it("owns the recorder, the set list and the step tree", () => {
    const ui = mount(ActionsPanel);
    expect(ui.byTitle("Record an action macro")).toBeDefined();
    expect(ui.byLabel("Search actions")).toBeDefined();
    expect(ui.byAttr("data-mv-action-set").props["data-mv-action-set"]).toBe("Default");
    expect(ui.byAttr("data-mv-action-row").props["data-mv-action-row"]).toBe(SAVED.action.id);
    expect(ui.byAttr("data-mv-action-import-atn")).toBeDefined();
    // The steps are behind the row's disclosure, in this panel — not elsewhere.
    expect(ui.has("data-mv-action-step")).toBe(false);
    ui.byLabel("Show action steps").props.onClick();
    expect(ui.tree().filter((e) => "data-mv-action-step" in e.props)).toHaveLength(SAVED.steps.length);
  });

  it("filters the set list from its own search box", () => {
    const ui = mount(ActionsPanel);
    ui.byLabel("Search actions").props.onChange({ currentTarget: { value: "zzz" } });
    expect(ui.has("data-mv-action-row")).toBe(false);
    ui.byLabel("Search actions").props.onChange({ currentTarget: { value: "sep" } });
    expect(ui.has("data-mv-action-row")).toBe(true);
  });

  it("leaves History with only history — no action UI wedged into it", () => {
    const history = mount(HistoryPanel);
    for (const attr of ["data-mv-action-row", "data-mv-action-step", "data-mv-action-import-atn", "data-mv-action-set"]) {
      expect(history.has(attr), attr).toBe(false);
    }
    expect(history.labels()).not.toContain("Search actions");
    // …and History keeps its own controls.
    expect(history.byAttr("data-mv-snapshot-row").props["data-mv-snapshot-row"]).toBe(9);
    expect(history.byAttr("data-mv-history-row")).toBeDefined();
    const flyout = history.tree().find((e) => Array.isArray(e.props.items))!;
    expect(flyout.props.items.map((i: { label?: string }) => i.label)).toContain("History Options…");
  });

  // #467: the flyout commands that make a replay more than a frozen forEach.
  it("saves the actions it is showing as one Adobe .atn set (#473)", () => {
    const ui = mount(ActionsPanel);
    ui.byAttr("data-mv-action-export-atn").props.onClick();
    expect(stub.calls).toContainEqual(["exportAtn", [SAVED.action.id], SAVED.action.set]);
    // …and it writes a file, not just bytes into the void.
    const save = stub.calls.find((c) => c[0] === "saveBytes")!;
    expect(save[1]).toBe(`${SAVED.action.set}.atn`);
  });

  it("offers Allow Tool Recording, off, and turns it on (#471)", () => {
    const ui = mount(ActionsPanel);
    const toggle = ui.byAttr("data-mv-action-tool-recording");
    expect(toggle.props["aria-pressed"]).toBe(false);
    toggle.props.onClick();
    expect(stub.calls).toContainEqual(["setAllowToolRecording", true]);
  });

  it("appends a Menu Item step for a command picked from the allowlist", () => {
    const ui = mount(ActionsPanel);
    ui.byLabel("Show action steps").props.onClick();
    const field = ui.byLabel("Menu item command");
    expect(ui.byAttr("data-mv-action-insert-menu-item").props.disabled).toBe(true); // nothing typed yet
    // The picker offers exactly what the insert validates against.
    expect(field.props.suggestions.map((o: { value: string }) => o.value)).toEqual(["adj.invert", "fil.gaussian"]);
    field.props.onChange(" fil.gaussian ");
    ui.byAttr("data-mv-action-insert-menu-item").props.onClick();
    expect(stub.calls).toContainEqual(["insertMenuItem", SAVED.action.id, "fil.gaussian"]);
  });

  it("says so when the typed command is not one this build can replay", () => {
    const ui = mount(ActionsPanel);
    ui.byLabel("Show action steps").props.onClick();
    ui.byLabel("Menu item command").props.onChange("bogus.op");
    ui.byAttr("data-mv-action-insert-menu-item").props.onClick();
    expect(ui.tree().some((e) => typeof e.props.children === "string"
      && e.props.children.includes("Not a recordable command: bogus.op"))).toBe(true);
  });

  it("appends a Conditional step branching into another action by name", () => {
    const ui = mount(ActionsPanel);
    ui.byLabel("Show action steps").props.onClick();
    expect(ui.byAttr("data-mv-action-insert-conditional").props.disabled).toBe(true); // no branch chosen
    // Branches are picked from the saved actions, so a name typo cannot happen.
    expect(ui.byLabel("Then action").props.options.map((o: { value: string }) => o.value))
      .toEqual(["", SAVED.action.name]);
    ui.byLabel("Condition").props.onChange("documentPortrait");
    ui.byLabel("Then action").props.onChange(SAVED.action.name);
    ui.byAttr("data-mv-action-insert-conditional").props.onClick();
    expect(stub.calls).toContainEqual(["insertConditional", SAVED.action.id, "documentPortrait", SAVED.action.name, ""]);
  });

  it("switches playback mode, reading the live one back from the facade", () => {
    const ui = mount(ActionsPanel);
    const select = ui.byLabel("Playback options");
    expect(select.props.value).toBe("accelerated");
    expect(select.props.options.map((o: { value: string }) => o.value)).toEqual(["accelerated", "stepByStep"]);
    select.props.onChange("stepByStep");
    expect(stub.calls).toContainEqual(["setPlaybackMode", "stepByStep"]);
  });

  it("gives the step tree the whole panel instead of a 180px porthole", () => {
    const ui = mount(ActionsPanel);
    ui.byLabel("Show action steps").props.onClick();
    const step = ui.byAttr("data-mv-action-step");
    const scroller = ui.tree().find((e) => e.props.style?.overflow === "auto")!;
    expect(scroller.props.style.flex, "the step tree fills the panel").toBe(1);
    expect(scroller.props.style.minHeight).toBe(0);
    expect(scroller.props.style.maxHeight, "the 180px porthole is gone").toBeUndefined();
    expect(walk(scroller.props.children)).toContain(step); // …and the steps are inside it
  });
});

describe("Properties panel", () => {
  const withMask = { layers: [{ id: 3, name: "Layer 1", kind: 0, hasMask: true }] };

  it("is contextual: no layer selected renders a hint, not controls", () => {
    const ui = mount(PropertiesPanel, { layers: [] });
    expect(ui.tree()[0].props.children).toContain("No layer selected");
    expect(ui.byLabel("Mask density")).toBeUndefined();
  });

  it("reaches the mask Density/Feather the engine has always backed", () => {
    const ui = mount(PropertiesPanel, withMask);
    // Read live from the engine, per render — not a cached copy.
    expect(stub.calls).toContainEqual(["layerMaskDensity", 3]);
    expect(stub.calls).toContainEqual(["layerMaskFeather", 3]);
    expect(ui.byLabel("Mask density").props.value).toBe(55);
    expect(ui.byLabel("Mask feather").props.value).toBe(1.5);
    ui.byLabel("Mask density").props.onChange(40);
    ui.byLabel("Mask feather").props.onChange(2.5);
    expect(stub.calls).toContainEqual(["setLayerMaskDensity", 3, 40]);
    expect(stub.calls).toContainEqual(["setLayerMaskFeather", 3, 2.5]);
  });

  it("offers the mask quick actions, and adding a mask when there is none", () => {
    const ui = mount(PropertiesPanel, withMask);
    ui.byText("Disable").props.onClick();
    ui.byText("Apply").props.onClick();
    ui.byText("Delete").props.onClick();
    ui.byText("Select and Mask…").props.onClick();
    expect(stub.calls).toContainEqual(["toggleLayerMaskEnabled", 3]);
    expect(stub.calls).toContainEqual(["applyLayerMask", 3]);
    expect(stub.calls).toContainEqual(["deleteLayerMask", 3]);
    expect(stub.calls).toContainEqual(["openDialog", "selectandmask"]);

    const noMask = mount(PropertiesPanel); // the same layer, without a mask
    expect(noMask.byLabel("Mask density")).toBeUndefined();
    noMask.byText("Add Mask").props.onClick();
    expect(stub.calls).toContainEqual(["addLayerMask", 3]);
  });
});

// #450 — a shape layer stays re-editable: the Properties panel is where its
// fill, stroke, W/H/X/Y and FOUR independent corner radii live.
describe("Properties panel ▸ Shape", () => {
  const SHAPE = {
    id: "mv-shape-1", kind: "rect", x: 10, y: 20, w: 100, h: 50, transformed: false,
    radii: [4, 0, 8, 2],
    fill: [255, 0, 0, 255],
    stroke: { color: [0, 0, 255, 255], width: 3, align: "outside", cap: "round", join: "bevel", dash: [6, 3] },
  };
  const shapeLayer = { layers: [{ id: 3, name: "Shape 1", kind: 3 }], shape: SHAPE };

  it("is contextual: only a shape layer gets the section, keyed to its component", () => {
    expect(mount(PropertiesPanel).has("data-mv-shape-properties"), "raster layer").toBe(false);
    const ui = mount(PropertiesPanel, shapeLayer);
    expect(ui.byAttr("data-mv-shape-properties").props["data-mv-shape-properties"]).toBe("mv-shape-1");
  });

  it("shows the live fill, stroke and geometry the scene carries", () => {
    const ui = mount(PropertiesPanel, shapeLayer);
    expect(ui.byLabel("Shape fill").props.value).toBe("#ff0000");
    expect(ui.byLabel("Shape stroke color").props.value).toBe("#0000ff");
    expect(ui.byLabel("Stroke width").props.value).toBe(3);
    expect(ui.byLabel("Stroke align").props.value).toBe("outside");
    expect(ui.byLabel("Stroke cap").props.value).toBe("round");
    expect(ui.byLabel("Stroke join").props.value).toBe("bevel");
    expect(ui.byLabel("Stroke dash").props.defaultValue).toBe("6, 3");
    expect([ui.byLabel("Shape width").props.value, ui.byLabel("Shape height").props.value]).toEqual([100, 50]);
    expect([ui.byLabel("Shape X").props.value, ui.byLabel("Shape Y").props.value]).toEqual([10, 20]);
    expect(ui.byLabel("Shape width").props.disabled, "a plain translation resizes").toBeFalsy();
  });

  it("greys out W/H for a rotated or scaled component, but still moves it by X/Y", () => {
    const ui = mount(PropertiesPanel, { ...shapeLayer, shape: { ...SHAPE, transformed: true } });
    expect(ui.byLabel("Shape width").props.disabled).toBe(true);
    expect(ui.byLabel("Shape height").props.disabled).toBe(true);
    expect(ui.byLabel("Shape X").props.disabled).toBeFalsy();
    ui.byLabel("Shape X").props.onChange(33);
    expect(stub.calls).toContainEqual(["setShapeProps", { x: 33 }]);
  });

  it("reads the scene once per layer row and pick, not once per render", () => {
    const ui = mount(PropertiesPanel, shapeLayer);
    const reads = () => stub.calls.filter((c) => c[0] === "shapeProps").length;
    expect(reads()).toBe(1);
    // A render with the same layer row and the same pick re-uses the read.
    stub.invalidate();
    expect(reads()).toBe(1);
    // A different component picked, or a new layer row (every engine sync
    // mints one, which is how an undo / MCP edit / drag reaches the panel),
    // reads again.
    stub.put({ selectedPaths: ["mv-shape-2"] });
    stub.invalidate();
    expect(reads()).toBe(2);
    stub.put({ layers: [{ ...shapeLayer.layers[0] }] });
    stub.invalidate();
    expect(reads()).toBe(3);
    expect(ui.byAttr("data-mv-shape-properties")).toBeDefined();
  });

  it("patches each property back through the store, one field per edit", () => {
    const ui = mount(PropertiesPanel, shapeLayer);
    ui.byLabel("Shape fill").props.onChange({ target: { value: "#00ff00" } });
    ui.byLabel("Shape stroke color").props.onChange({ target: { value: "#ffff00" } });
    ui.byLabel("Stroke width").props.onChange(8);
    ui.byLabel("Stroke align").props.onChange("inside");
    ui.byLabel("Stroke cap").props.onChange("square");
    ui.byLabel("Stroke join").props.onChange("miter");
    ui.byLabel("Stroke dash").props.onBlur({ currentTarget: { value: "2 2" } });
    ui.byLabel("Shape width").props.onChange(64);
    ui.byLabel("Shape height").props.onChange(32);
    ui.byLabel("Shape X").props.onChange(-5);
    ui.byLabel("Shape Y").props.onChange(7);
    expect(stub.calls.filter((c) => c[0] === "setShapeProps").map((c) => c[1])).toEqual([
      { fill: [0, 255, 0, 255] },
      { stroke: { color: [255, 255, 0, 255] } },
      { stroke: { width: 8 } },
      { stroke: { align: "inside" } },
      { stroke: { cap: "square" } },
      { stroke: { join: "miter" } },
      { stroke: { dash: [2, 2] } },
      { w: 64 }, { h: 32 }, { x: -5 }, { y: 7 },
    ]);
  });

  it("gives all FOUR corners their own radius field, editable independently", () => {
    const ui = mount(PropertiesPanel, shapeLayer);
    const corners = ["top left", "top right", "bottom right", "bottom left"];
    expect(corners.map((c) => ui.byLabel(`Corner radius ${c}`).props.value)).toEqual([4, 0, 8, 2]);
    // Only the corner touched moves; the other three keep their own radius.
    ui.byLabel("Corner radius bottom right").props.onChange(9);
    expect(stub.calls).toContainEqual(["setShapeProps", { radii: [4, 0, 9, 2] }]);
    // A shape with no corners (ellipse / path component) offers none.
    const round = mount(PropertiesPanel, { ...shapeLayer, shape: { ...SHAPE, kind: "ellipse", radii: null } });
    expect(round.byLabel("Corner radius top left")).toBeUndefined();
    expect(round.byLabel("Shape fill"), "…but still its fill and stroke").toBeDefined();
  });
});

describe("Measurement Log", () => {
  it("records into the panel instead of a modal over the canvas", () => {
    const { menus } = mountShell();
    const record = menuItem(menus as any[], "recordmeasurements");
    expect(record, "Image ▸ Analysis ▸ Record Measurements").toBeDefined();
    record.action();
    expect(stub.calls).toContainEqual(["recordMeasurement"]);
    expect(stub.calls).toContainEqual(["openPanel", "measurementlog"]);
    // The modal it replaced is gone: nothing opens a "measurementLog" dialog.
    expect(stub.calls.filter((c) => c[0] === "openDialog")).toEqual([]);
  });

  it("shares one table between the panel and Select Data Points' column set", () => {
    const ui = mount(MeasurementLogPanel);
    expect(ui.tree().some((e) => e.type === MeasurementRows)).toBe(true);
  });

  it("exports only once there is something recorded", () => {
    expect(mount(MeasurementLogPanel).byAttr("data-mv-measure-export").props.disabled).toBe(true);
    const ui = mount(MeasurementLogPanel, { measurements: [{ id: 1 }] });
    expect(ui.byAttr("data-mv-measure-export").props.disabled).toBe(false);
    ui.byText("Clear").props.onClick();
    expect(stub.calls).toContainEqual(["clearMeasurements"]);
  });
});

// Photoshop's Layers filter bar: Mode and Effect join Kind/Attribute/Name/Color (#423).
describe("Layers filter bar", () => {
  const layer = (id: number, o: Record<string, unknown>) =>
    ({ id, name: `Layer ${id}`, kind: 0, visible: true, locked: false, opacity: 100, fillOpacity: 100, blendMode: "normal", thumb: "", hasMask: false, hasFx: false, group: 0, ...o });
  const open = (patch: Record<string, unknown> = {}) => mount(LayersPanel, {
    layers: [layer(3, {}), layer(4, { blendMode: "multiply", hasFx: true, fxMask: 1 << FX.STROKE })],
    selectedLayerIds: [3], layerColorLabels: {}, layerFilter: "", layerFilterOpen: true,
    layerKindFilter: "all", layerAttributeFilter: "all", layerModeFilter: "all", layerEffectFilter: "all",
    ...patch,
  });
  const count = (ui: ReturnType<typeof mount>) => (ui.byAttr("data-mv-layer-count").props.children as unknown[]).join("");
  const options = (ui: ReturnType<typeof mount>, label: string) =>
    (ui.byLabel(label).props.options as { value: string; label: string }[]).map((o) => [o.value, o.label]);

  it("offers a Mode dropdown of every blend mode and an Effect dropdown of the ten effect types", () => {
    const ui = open();
    const modes = options(ui, "Filter by mode");
    expect(modes[0]).toEqual(["all", "All"]);
    expect(modes.map(([v]) => v)).toContain("multiply");
    expect(modes.map(([v]) => v)).toContain("pass-through");
    expect(options(ui, "Filter by effect")).toEqual([
      ["all", "All"], ["0", "Drop Shadow"], ["1", "Inner Shadow"], ["2", "Outer Glow"], ["3", "Inner Glow"], ["4", "Bevel & Emboss"],
      ["5", "Satin"], ["6", "Color Overlay"], ["7", "Gradient Overlay"], ["8", "Pattern Overlay"], ["9", "Stroke"],
    ]);
    expect(count(ui)).toBe("2/2");
  });

  it("picking a mode narrows the rows and the n/m count to layers set to it", () => {
    expect(count(open({ layerModeFilter: "multiply" }))).toBe("1/2");
    expect(count(open({ layerModeFilter: "screen" }))).toBe("0/2");
    // The filter only applies while the bar is open — closing it restores every row.
    const closed = open({ layerModeFilter: "screen", layerFilterOpen: false });
    expect(closed.has("data-mv-layer-count")).toBe(false);
    expect(closed.tree().find((e) => Array.isArray(e.props.layers))!.props.layers).toHaveLength(2);
  });

  it("picking an effect narrows the rows to layers carrying that effect, not any effect", () => {
    expect(count(open({ layerEffectFilter: FX.STROKE }))).toBe("1/2");
    expect(count(open({ layerEffectFilter: FX.DROP_SHADOW }))).toBe("0/2");
    // The Attribute filter's "Layer Effects" is still the any-effect switch.
    expect(count(open({ layerAttributeFilter: "fx" }))).toBe("1/2");
  });

  it("stores the picked effect as its FX id, and 'all' as the pass-through", () => {
    const ui = open();
    ui.byLabel("Filter by effect").props.onChange("9");
    ui.byLabel("Filter by effect").props.onChange("all");
    ui.byLabel("Filter by mode").props.onChange("multiply");
    expect(stub.calls).toEqual([
      ["setOptions", { layerEffectFilter: 9 }],
      ["setOptions", { layerEffectFilter: "all" }],
      ["setOptions", { layerModeFilter: "multiply" }],
    ]);
  });
});

// A Select's options are portalled out of the Layers panel but still bubble
// React events through it — they are role="option" like a row, so the row
// handlers must only act on rows in the panel's own DOM.
describe("Layers panel row events", () => {
  const row = { id: "3" };
  const option = { id: "mv-layer-kind-opt-2" }; // `+id` would be NaN
  const event = (hit: object, extra: Record<string, unknown> = {}) => ({
    target: { closest: (sel: string) => (sel === '[role="option"]' ? hit : null) },
    currentTarget: { contains: (n: unknown) => n === row },
    stopPropagation: () => {}, preventDefault: () => {}, ...extra,
  });

  it("acts on its own rows but ignores a portalled dropdown option", () => {
    const panel = mount(LayersPanel, { layerFilter: "", layerColorLabels: {}, selectedLayerIds: [3] }).byAttr("onContextMenuCapture").props;
    const before = stub.calls.length;
    for (const hit of [option, row]) {
      panel.onContextMenuCapture(event(hit));
      panel.onPointerDownCapture(event(hit, { shiftKey: true }));
      panel.onDoubleClickCapture(event(hit));
    }
    expect(stub.calls.slice(before)).toEqual([["selectLayer", 3], ["toggleLayerInSelection", 3], ["selectLayer", 3]]);
  });
});
