import { describe, expect, it, vi } from "vitest";

// #451: Type ▸ Text on Path ▸ Type on a Path Options… — the control surface for
// an existing on-path type layer. Align To Path, Flip, Spacing and the start/end
// window must reach text.setOnPathOptions (the recorded facade), and the fields
// must show what the layer is already set to.
//
// Dialogs.tsx reaches the WASM engine, Tauri and the DOM through state/app, so
// state/app is stubbed and React's hooks are driven by hand (the discipline of
// ./panelInventory.test.ts): the dialog renders for real and runs its handlers.
const stub = vi.hoisted(() => {
  const slots: Array<{ current: any }> = [];
  const calls: Array<[string, unknown]> = [];
  const spec: { current: any } = { current: null };
  let cursor = 0;
  return {
    calls, spec,
    reset(next: unknown) { slots.length = 0; cursor = 0; calls.length = 0; spec.current = next; },
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
    useContext: () => ({ open: () => {}, close: () => stub.calls.push(["close", null]), current: null, arg: null }),
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

vi.mock("../state/app", async () => {
  const raster = await vi.importActual<typeof import("../text/raster")>("../text/raster");
  const text = {
    get: () => stub.spec.current,
    PATH_ALIGNS: raster.PATH_ALIGNS,
    setOnPathOptions: (patch: unknown) => { stub.calls.push(["setOnPathOptions", patch]); },
  };
  const state = new Proxy({ activeLayerId: 3 } as Record<string, any>, {
    get: (t, p: string) => (p in t ? t[p] : []),
  });
  return new Proxy({} as Record<string, unknown>, {
    has: () => true,
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
    get: (_t, prop: string) => {
      switch (prop) {
        case "text": return text;
        case "useStore": return (select: (s: unknown) => unknown) => select(state);
        case "engine": return new Proxy({}, { get: () => () => "" });
        case "store": return new Proxy({}, { get: () => () => undefined });
        case "then": return undefined;
        default: return () => {};
      }
    },
  });
});

const { OnPathOptions } = await import("./Dialogs");
const { PATH_ALIGNS } = await import("../text/raster");

type El = { type: any; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  return out;
}

/** A straight 100px path, so the arc-length window has a known length. */
const onPathSpec = (extra: Record<string, unknown> = {}) => ({
  runs: [{ text: "Hi" }], path: [0, 0, 100, 0], ...extra,
});

function mount(spec: unknown): El[] {
  stub.reset(spec);
  const dialog = OnPathOptions() as unknown as El;
  return walk(dialog.props.children);
}
const field = (tree: El[], label: string) => tree.find((e) => e.props["aria-label"] === label);
const patches = () => stub.calls.filter((c) => c[0] === "setOnPathOptions").map((c) => c[1]);

describe("Type on a Path Options (#451)", () => {
  it("offers every align-to-path mode and writes the choice through the facade", () => {
    const tree = mount(onPathSpec());
    const align = field(tree, "Align to path");
    expect(align, "Align to path control").toBeDefined();
    expect(align!.props.options.map((o: { value: string }) => o.value)).toEqual(PATH_ALIGNS.map((a) => a.id));
    expect(align!.props.value).toBe("baseline"); // the layout default
    align!.props.onChange("center");
    expect(patches()).toEqual([{ pathAlign: "center" }]);
  });

  it("flips the run across the path", () => {
    const tree = mount(onPathSpec());
    const flip = tree.find((e) => e.props.children === "Flip across the path");
    expect(flip, "Flip checkbox").toBeDefined();
    expect(flip!.props.checked).toBe(false);
    flip!.props.onChange(true);
    expect(patches()).toEqual([{ pathFlip: true }]);
  });

  it("sets glyph spacing, tightening as well as loosening", () => {
    const spacing = field(mount(onPathSpec()), "Spacing");
    expect(spacing, "Spacing field").toBeDefined();
    spacing!.props.onChange(-6);
    spacing!.props.onChange(12);
    expect(patches()).toEqual([{ pathSpacing: -6 }, { pathSpacing: 12 }]);
  });

  it("sets the start/end brackets, bounded by the path's arc length", () => {
    const tree = mount(onPathSpec());
    const [start, end] = [field(tree, "Start"), field(tree, "End")];
    expect(start, "Start field").toBeDefined();
    expect(end, "End field").toBeDefined();
    expect([start!.props.min, start!.props.max]).toEqual([0, 100]);
    expect([end!.props.min, end!.props.max]).toEqual([0, 100]);
    start!.props.onChange(20);
    end!.props.onChange(80);
    expect(patches()).toEqual([{ pathStart: 20 }, { pathEnd: 80 }]);
  });

  it("shows what the layer is already bound to, not the defaults", () => {
    const tree = mount(onPathSpec({ pathStart: 15, pathEnd: 60, pathFlip: true, pathAlign: "ascender", pathSpacing: 3 }));
    expect(field(tree, "Align to path")!.props.value).toBe("ascender");
    expect(tree.find((e) => e.props.children === "Flip across the path")!.props.checked).toBe(true);
    expect(field(tree, "Spacing")!.props.value).toBe(3);
    expect(field(tree, "Start")!.props.value).toBe(15);
    expect(field(tree, "End")!.props.value).toBe(60);
  });

  it("says how to bind instead of offering dead controls when the layer isn't on a path", () => {
    for (const spec of [null, { runs: [{ text: "Hi" }] }, onPathSpec({ path: [0, 0] })]) {
      const tree = mount(spec);
      expect(field(tree, "Align to path"), `no controls for ${JSON.stringify(spec)}`).toBeUndefined();
      expect(tree.some((e) => String(e.props.children).includes("Bind to Work Path"))).toBe(true);
    }
  });
});
