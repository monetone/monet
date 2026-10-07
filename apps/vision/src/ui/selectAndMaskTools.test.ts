import { beforeEach, describe, expect, it, vi } from "vitest";

// Select and Mask carries Photoshop's selection tools, not just the Refine Edge
// Brush: Quick Selection and a plain add/subtract Brush build and correct the
// LIVE selection inside the workspace, so a missing selection no longer means
// cancelling out to the canvas.
//
// Dialogs.tsx reaches the WASM engine through state/app, so state/app is stubbed
// and React's hooks are driven by hand — the discipline of
// ./adjustmentsPanelHistogram.test.ts. The dialog renders for real and its own
// pointer handlers run for real against a stateful fake selection.
const W = 8;
const H = 8;
const N = W * H;

const stub = vi.hoisted(() => {
  const slots: Array<{ current: any }> = [];
  let cursor = 0;
  let rerender: (() => void) | null = null;
  const calls: Array<[string, ...unknown[]]> = [];
  return {
    calls,
    reset() { slots.length = 0; cursor = 0; calls.length = 0; },
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
    useContext: () => ({ open: () => {}, close: () => {}, current: "selectandmask", arg: null }),
    useEffect: () => {}, // the debounced preview paints a canvas; not under test here
    useState: (initial: unknown) => {
      const s = stub.slot(typeof initial === "function" ? (initial as () => unknown)() : initial);
      return [s.current, (next: unknown) => {
        s.current = typeof next === "function" ? (next as (p: unknown) => unknown)(s.current) : next;
        stub.invalidate();
      }];
    },
  };
});
vi.mock("@monet-ui/monet-react", async () => ({
  ...await vi.importActual<Record<string, unknown>>("@monet-ui/monet-react"),
  useMonetContext: () => ({ platform: "mac" }),
  useToast: () => ({ show: () => {} }),
}));

/** A stateful stand-in for the engine's selection: null = nothing selected. */
const sel = vi.hoisted(() => ({ mask: null as Uint8Array | null }));

vi.mock("../state/app", () => {
  const log = (name: string, ...args: unknown[]) => { stub.calls.push([name, ...args]); };
  const wasm = {
    has_selection: () => sel.mask !== null,
    quick_selection: (...args: unknown[]) => {
      log("quick_selection", ...args);
      sel.mask ??= new Uint8Array(N); // the grow produced *some* selection
    },
    set_selection_mask: (m: Uint8Array) => {
      log("set_selection_mask", Array.from(m));
      sel.mask = Uint8Array.from(m);
    },
    select_and_mask_preview: () => new Uint8Array(N),
  };
  const engine = {
    get engine() { return wasm; },
    get e() { return wasm; },
    width: W,
    height: H,
    outputCopy: () => new Uint8ClampedArray(N * 4),
    sync: () => log("sync"),
    selectionMask: () => sel.mask,
  };
  const state = {
    activeDocId: 1,
    activeLayerId: 1,
    documents: [{ id: 1 }],
    quickSelectionTolerance: 0.12,
    quickSelectionSampleAll: false,
    quickSelectionAutoEnhance: false,
  };
  const store = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => {
      if (prop === "state") return state;
      if (prop === "getSnapshot") return () => state;
      if (prop === "selectAndMaskPreview") return () => new Uint8Array(N);
      return (...args: unknown[]) => log(prop, ...args);
    },
  });
  return new Proxy({} as Record<string, unknown>, {
    has: () => true,
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
    get: (_t, prop: string) => {
      switch (prop) {
        case "actions": return { mark: () => ({}), rollback: () => {} };
        case "engine": return engine;
        case "store": return store;
        case "useStore": return (select: (s: unknown) => unknown) => select(state);
        case "then": return undefined;
        default: return (...args: unknown[]) => log(prop, ...args);
      }
    },
  });
});

const { DialogProvider } = await import("./Dialogs");

type El = { type: any; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  walk(el.props?.footer, out); // the Dialog's buttons live off `footer`, not children
  return out;
}

/** Renders the Select and Mask workspace, re-rendering on every setState. */
function mount() {
  stub.reset();
  let tree: El[] = [];
  const draw = () => {
    stub.begin(draw);
    const provider = DialogProvider({ children: null }) as unknown as El;
    const host = walk(provider.props.children).find((e) => typeof e.type === "function")!;
    const body = host.type(host.props) as El;
    tree = walk(body.type(body.props));
  };
  draw();
  const byLabel = (label: string) => tree.find((e) => e.props["aria-label"] === label)!;
  return {
    tree: () => tree,
    byLabel,
    canvas: () => byLabel("Select and Mask live preview"),
    ok: () => tree.find((e) => e.props.variant === "primary")!,
    setTool: (value: string) => byLabel("Workspace tool").props.onChange(value),
    setMode: (value: string) => byLabel("Brush mode").props.onChange(value),
    setSize: (px: number) => byLabel("Refine Edge Brush size").props.onChange(px),
    /** One pointer drag over the preview at document coordinates. */
    drag: (points: Array<[number, number]>) => {
      const target = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
        setPointerCapture: () => {},
      };
      const ev = ([x, y]: [number, number]) => ({ clientX: x, clientY: y, pointerId: 1, currentTarget: target });
      const canvasEl = () => byLabel("Select and Mask live preview");
      canvasEl().props.onPointerDown(ev(points[0]));
      for (const p of points.slice(1)) canvasEl().props.onPointerMove(ev(p));
      canvasEl().props.onPointerUp();
    },
  };
}

const named = (name: string) => stub.calls.filter((c) => c[0] === name);

beforeEach(() => { sel.mask = null; });

describe("Select and Mask carries selection tools, not only the Refine Edge Brush", () => {
  it("offers the full rail: refine, the selection tools, and Hand for the zoomed preview", () => {
    // #413 added Lasso / Poly Lasso / Hand so the workspace no longer needs a
    // Cancel round-trip to the canvas tools.
    const d = mount();
    expect(d.byLabel("Workspace tool").props.items.map((i: { label: string }) => i.label))
      .toEqual(["Refine Edge", "Quick Selection", "Brush", "Lasso", "Poly Lasso", "Hand"]);
  });

  it("Quick Selection grows the live selection per dab, at the workspace brush size", () => {
    sel.mask = new Uint8Array(N);
    const d = mount();
    d.setTool("quick");
    d.setSize(10);
    d.drag([[3, 4], [4, 4]]);
    // radius = size/2; add mode; `first` only on the pointer-down dab, so the
    // whole drag is one undo step in the engine.
    expect(named("quick_selection")).toEqual([
      ["quick_selection", 3, 4, 5, 0.12, 1, true, false, false],
      ["quick_selection", 4, 4, 5, 0.12, 1, false, false, false],
    ]);
    // The Refine Edge stroke region is untouched — this is a selection edit.
    expect(named("set_selection_mask")).toEqual([]);
  });

  it("Erase makes Quick Selection subtract", () => {
    sel.mask = new Uint8Array(N);
    const d = mount();
    d.setTool("quick");
    d.setMode("erase");
    d.drag([[2, 2]]);
    expect(named("quick_selection")[0][5]).toBe(2);
  });

  it("the Brush commits one stroke as a single selection write", () => {
    sel.mask = new Uint8Array(N);
    const d = mount();
    d.setTool("brush");
    d.setSize(4);
    d.drag([[4, 4], [5, 4], [6, 4]]);
    const writes = named("set_selection_mask");
    expect(writes).toHaveLength(1); // one history step for the whole drag
    const mask = writes[0][1] as number[];
    expect(mask[4 * W + 4]).toBe(255); // brushed
    expect(mask[4 * W + 6]).toBe(255); // …all the way along the drag
    expect(mask[0]).toBe(0); // untouched elsewhere
  });

  it("the Brush in Erase mode cuts the brushed area out of the selection", () => {
    sel.mask = new Uint8Array(N).fill(255);
    const d = mount();
    d.setTool("brush");
    d.setSize(4);
    d.setMode("erase");
    d.drag([[4, 4]]);
    const mask = named("set_selection_mask")[0][1] as number[];
    expect(mask[4 * W + 4]).toBe(0);
    expect(mask[0]).toBe(255);
  });

  it("builds a selection from nothing — the Refine Edge Brush still needs one", () => {
    const d = mount();
    expect(d.ok().props.disabled).toBe(true);
    // Refine Edge has no edge to refine yet: the pointer is ignored.
    d.drag([[4, 4]]);
    expect(stub.calls.filter((c) => c[0] !== "sync")).toEqual([]);
    // Quick Selection builds one, and OK comes alive with it.
    d.setTool("quick");
    d.drag([[4, 4]]);
    expect(named("quick_selection")).toHaveLength(1);
    expect(d.ok().props.disabled).toBe(false);
  });
});
