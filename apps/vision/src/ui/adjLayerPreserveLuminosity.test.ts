import { beforeEach, describe, expect, it, vi } from "vitest";

// Color Balance and Photo Filter each exist twice: as Image ▸ Adjustments (which
// always honoured Preserve Luminosity — those dialogs have the checkbox) and as
// an adjustment layer (whose kernel had no slot for it). Same settings, different
// image, depending only on how you applied it. The engine kernels read the flag
// now; these drive the generic adjustment-layer dialog and assert it offers the
// toggle, writes it to the slot the kernel reads, and defaults it ON as
// Photoshop does.
//
// Dialogs.tsx reaches the WASM engine through state/app, so state/app is stubbed
// and React's hooks are driven by hand (the discipline of ./dialogs/common.test.ts):
// the real dialog renders and its real handlers run.
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
    ctx: { current: null as string | null, arg: null as unknown, open: () => {}, close: () => {} },
    // The dialog edits inside an engine history transaction; the scratch layer
    // it pins must stay the active one or every edit is discarded as off-target.
    state: { activeDocId: 1, activeLayerId: 3 },
    engine: {
      end_prop_edit: () => calls.push(["end_prop_edit"]),
      undo: () => calls.push(["undo"]),
      begin_history_transaction: () => true,
      commit_history_transaction: () => true,
      cancel_history_transaction: () => true,
      undo_pushes: () => 0,
      drop_last_undo: () => calls.push(["drop_last_undo"]),
    },
  };
});

vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  return {
    ...real,
    useRef: (initial: unknown) => stub.slot(initial),
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useContext: () => stub.ctx,
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

const SCRATCH_LAYER = 7;
vi.mock("../state/app", () => ({
  engine: {
    // The dialog pins `engine.e` and later checks `engine.engine` is still it,
    // so both must be the one object — as they are on the real client.
    e: stub.engine, engine: stub.engine,
    commit: stub.record("commit"), refreshFromEngine: () => {}, sync: () => {}, syncSuspended: false,
  },
  store: {
    get state() { return stub.state; },
    addAdjustmentLayer: (...args: unknown[]) => {
      stub.calls.push(["addAdjustmentLayer", ...args]);
      stub.state.activeLayerId = SCRATCH_LAYER; // the real store selects what it creates
      return SCRATCH_LAYER;
    },
    setAdjustmentParams: (id: number, params: Float32Array) => { stub.calls.push(["setAdjustmentParams", id, [...params]]); },
  },
  useStore: () => undefined,
  // The scratch-layer hook checkpoints the action recorder on mount and rolls
  // it back on cancel, so the stub must answer the whole mark/rollback pair.
  actions: { suspend: () => {}, record: () => {}, mark: () => ({}), rollback: stub.record("rollback"), commit: stub.record("commit") },
  registerPdfPagePicker: () => {},
}));

const { DialogProvider, ADJ_SPECS } = await import("./Dialogs");
const { LAYER_KIND } = await import("../state/engineContracts");

type El = { type: any; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  walk(el.props?.footer, out);
  return out;
}

/** The dialog component DialogHost picks for `specKey` — the real routing. */
function componentFor(specKey: string): El {
  stub.reset();
  stub.ctx = { ...stub.ctx, current: specKey, arg: null };
  const host = walk(DialogProvider({ children: null })).find((e) => typeof e.type === "function")!;
  const picked = host.type() as El | null;
  expect(picked, `DialogHost routes ${specKey}`).toBeTruthy();
  return picked!;
}

/** Mounts that dialog (optionally editing an existing layer) and keeps it live. */
function mount(specKey: string, arg: unknown = null) {
  const { type, props } = componentFor(specKey);
  stub.reset();
  stub.ctx = { ...stub.ctx, current: specKey, arg };
  // Editing an existing layer means that layer is the selected one.
  stub.state.activeLayerId = (arg as { layerId?: number } | null)?.layerId ?? 3;
  let tree: El[] = [];
  const draw = () => {
    stub.begin(draw);
    tree = walk(type(props));
    while (stub.pending.length) stub.pending.shift()!();
  };
  draw();
  return {
    // A slider control is a Row (props.label); a flag is a Checkbox (aria-label).
    control: (label: string) => tree.find((e) => e.props["aria-label"] === label || e.props.label === label)!,
    labels: () => tree.map((e) => e.props["aria-label"] ?? e.props.label).filter(Boolean),
    ok: () => tree.find((e) => e.props.children === "OK")!,
  };
}

// kind → the param slot the engine reads the flag from (pixel_adjust.rs).
const CASES = [
  { key: "alColorBalance", kind: 10, slot: 9, label: "Color Balance", defaults: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1] },
  { key: "alPhotoFilter", kind: 11, slot: 4, label: "Photo Filter", defaults: [0.93, 0.54, 0, 0.25, 1] },
];

beforeEach(() => { stub.calls.length = 0; });

describe("Preserve Luminosity reaches the adjustment layers", () => {
  for (const { key, kind, slot, label, defaults } of CASES) {
    it(`${key} creates a kind-${kind} layer with the flag ON at slot ${slot}`, () => {
      const ui = mount(key);
      // Photoshop ships this checked, and the layer is created with it set.
      expect(ui.control("Preserve Luminosity").props.checked).toBe(true);
      expect(stub.calls[0][0]).toBe("addAdjustmentLayer");
      expect(stub.calls[0][1]).toBe(kind);
      expect([...(stub.calls[0][2] as Float32Array)]).toEqual([...new Float32Array(defaults)]);
      expect(stub.calls[0][3]).toBe(label);
      expect(defaults[slot], "the trailing 1 is the flag's default").toBe(1);
    });

    it(`${key} writes the toggle to slot ${slot}, as a flag and not a slider`, () => {
      const ui = mount(key);
      const toggle = ui.control("Preserve Luminosity");
      // A slider would be a Row (label + Slider); the flag is a checkbox.
      expect(toggle.props.checked).toBe(true);
      expect(toggle.props.min).toBeUndefined();
      toggle.props.onChange(false);
      const off = stub.calls.find((c) => c[0] === "setAdjustmentParams")!;
      expect(off[1]).toBe(SCRATCH_LAYER);
      expect((off[2] as number[])[slot]).toBe(0);
      expect(ui.control("Preserve Luminosity").props.checked).toBe(false);
      ui.control("Preserve Luminosity").props.onChange(true);
      const on = stub.calls.filter((c) => c[0] === "setAdjustmentParams").at(-1)!;
      expect((on[2] as number[])[slot]).toBe(1);
    });

    // Adding a slot to `defaults` breaks the old `length >= defaults.length` edit
    // guard: a layer saved with the shorter list fails it and every slider resets
    // to defaults, silently discarding the user's adjustment.
    it(`${key} pads a shorter saved param list instead of resetting it`, () => {
      const saved = defaults.slice(0, slot).map((_, i) => (i + 1) / 100); // a real, edited layer
      const ui = mount(key, { layerKind: LAYER_KIND.adjustment, subtype: kind, layerId: 42, params: saved });
      // No scratch layer: an edit re-opens the layer it was given.
      expect(stub.calls.some((c) => c[0] === "addAdjustmentLayer")).toBe(false);
      // Every saved slider keeps its value…
      const spec = ADJ_SPECS[key];
      for (const c of spec.controls) {
        if (c.idx >= saved.length) continue;
        expect(ui.control(c.label).props.value, c.label).toBe(saved[c.idx]);
      }
      // …and the missing slot reads 0, which is what the engine renders for it.
      expect(ui.control("Preserve Luminosity").props.checked).toBe(false);
      ui.control("Preserve Luminosity").props.onChange(true);
      const params = stub.calls.filter((c) => c[0] === "setAdjustmentParams").at(-1)![2] as number[];
      expect(params).toEqual([...new Float32Array([...saved, 1])]);
      expect(stub.calls.filter((c) => c[0] === "setAdjustmentParams").at(-1)![1]).toBe(42);
    });
  }

  it("keeps the toggle out of the adjustments that have no such flag", () => {
    expect(mount("alBrightness").labels()).toEqual(["Brightness", "Contrast"]);
  });
});
