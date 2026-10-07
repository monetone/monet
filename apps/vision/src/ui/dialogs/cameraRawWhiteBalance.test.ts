import { describe, expect, it, vi } from "vitest";

// Camera Raw White Balance: the ACR mode menu (As Shot / Auto / the six lighting
// presets / Custom) and the eyedropper that solves Temperature+Tint from one
// clicked neutral.
//
// Same discipline as ./cameraRawFilterSurface.test.ts: state/app is stubbed and
// React's hooks are driven by hand, so the REAL component renders and its REAL
// handlers run. Effects (which own the proxy engine and the pixel buffers) stay
// unfired, so the pixel-solving math is asserted through the exported solver.
const stub = vi.hoisted(() => {
  const slots: Array<{ current: unknown }> = [];
  let cursor = 0;
  let rerender: (() => void) | null = null;
  return {
    reset() { slots.length = 0; cursor = 0; },
    begin(fn: () => void) { cursor = 0; rerender = fn; },
    slot(initial: unknown) { const i = cursor++; return (slots[i] ??= { current: initial }); },
    invalidate() { rerender?.(); },
    arg: {} as unknown,
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
    useContext: () => ({ open: () => {}, close: () => {}, current: "cameraRaw", arg: stub.arg }),
    useState: (initial: unknown) => {
      const s = stub.slot(typeof initial === "function" ? (initial as () => unknown)() : initial);
      return [s.current, (next: unknown) => {
        s.current = typeof next === "function" ? (next as (p: unknown) => unknown)(s.current) : next;
        stub.invalidate();
      }];
    },
  };
});

vi.mock("../../state/app", () => ({
  engine: { e: null, sync: () => {}, commit: () => {} },
  store: {
    state: { activeDocId: 1, activeLayerId: 2 },
    pendingCameraRawSessions: () => [],
    cameraRawWorkspaceSession: () => null,
    lensMetadata: () => ({}),
  },
  // The workspace's store selectors: session revision, Open depth, profile library.
  useStore: (select: (s: object) => unknown) => select({ cameraRawSessionsRev: 0, filePrefs: { rawDepth: 16 }, cameraRawProfiles: [] }),
  exportCameraRawPreset: async () => {},
  importCameraRawPreset: async () => null,
  importCameraRawSidecar: async () => null,
  saveCameraRawSidecar: async () => {},
}));

const { CameraRawWorkspace, whiteBalanceFromSample } = await import("./CameraRawWorkspace");
const { autoWhiteBalance } = await import("../../state/cameraRaw");
const { WB_PRESETS, whiteBalancePresetOffsets } = await import("@monet-ui/monet-photo");

type El = { type: unknown; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  return out;
}

function mount() {
  stub.arg = { invocation: "filter" };
  let tree: El[] = [];
  const draw = () => { stub.begin(draw); tree = walk(CameraRawWorkspace() as unknown as El); };
  stub.reset();
  draw();
  const find = (pred: (e: El) => boolean) => tree.find(pred);
  return {
    byAttr: (attr: string) => find((e) => attr in e.props)!,
    byLabel: (label: string) => find((e) => e.props["aria-label"] === label)!,
    has: (attr: string) => tree.some((e) => attr in e.props),
    /** The Basic panel's slider block: `value` is the live BasicPanel and
     *  `onChange` is the patch seam every Basic slider drag goes through. */
    basic: () => find((e) => Array.isArray(e.props.rows)
      && (e.props.rows as { key: string }[]).some((r) => r.key === "temp")
      && (e.props.rows as { key: string }[]).some((r) => r.key === "vibrance"))!,
    text: (attr: string) => {
      const el = find((e) => attr in e.props);
      const flat = (n: unknown): string => (Array.isArray(n) ? n.map(flat).join("") : String(n));
      return flat(el?.props.children);
    },
  };
}

/** A pointerdown at (fx, fy) of a 200×100 preview canvas. */
const canvasDown = (fx: number, fy: number) => ({
  clientX: fx * 200, clientY: fy * 100, pointerId: 1, pressure: 1,
  currentTarget: {
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
  },
});

describe("Camera Raw White Balance mode menu", () => {
  it("offers Lightroom's menu in order", () => {
    const options = mount().byLabel("White Balance").props.options as { value: string; label: string }[];
    expect(options.map((o) => o.value)).toEqual([
      "asShot", "auto", "daylight", "cloudy", "shade", "tungsten", "fluorescent", "flash", "custom",
    ]);
    expect(options.map((o) => o.label)).toContain("As Shot");
  });

  it("starts on As Shot with no offset and no preset readout", () => {
    const ui = mount();
    expect(ui.byLabel("White Balance").props.value).toBe("asShot");
    expect(ui.basic().props.value).toMatchObject({ temp: 0, tint: 0 });
    expect(ui.has("data-mv-cr-wb-readout")).toBe(false);
  });

  it("writes a preset's Temperature/Tint offsets and shows its Kelvin/tint", () => {
    const ui = mount();
    ui.byLabel("White Balance").props.onChange("tungsten");
    const offsets = whiteBalancePresetOffsets("tungsten");
    // Tungsten is far cooler than the daylight reference, so Temperature swings down.
    expect(offsets.temp).toBeLessThan(0);
    expect(ui.byLabel("White Balance").props.value).toBe("tungsten");
    expect(ui.basic().props.value).toMatchObject({ wbMode: "tungsten", ...offsets });
    const tungsten = WB_PRESETS.find((p) => p.mode === "tungsten")!;
    expect(ui.text("data-mv-cr-wb-readout")).toContain(String(tungsten.kelvin));
  });

  it("returns to the decoder's neutral on As Shot", () => {
    const ui = mount();
    ui.byLabel("White Balance").props.onChange("shade");
    expect(ui.basic().props.value.temp).not.toBe(0);
    ui.byLabel("White Balance").props.onChange("asShot");
    expect(ui.byLabel("White Balance").props.value).toBe("asShot");
    expect(ui.basic().props.value).toMatchObject({ temp: 0, tint: 0 });
  });

  it("labels the menu Auto when Auto White Balance runs", () => {
    const ui = mount();
    ui.byAttr("data-mv-cr-auto-wb").props.onClick();
    expect(ui.byLabel("White Balance").props.value).toBe("auto");
  });

  it("relabels the menu Custom as soon as Temperature or Tint is dragged", () => {
    const ui = mount();
    ui.byLabel("White Balance").props.onChange("cloudy");
    expect(ui.byLabel("White Balance").props.value).toBe("cloudy");
    ui.basic().props.onChange({ temp: 0.4 });
    expect(ui.byLabel("White Balance").props.value).toBe("custom");
    expect(ui.basic().props.value.temp).toBe(0.4);
    ui.byLabel("White Balance").props.onChange("flash");
    ui.basic().props.onChange({ tint: -0.2 });
    expect(ui.byLabel("White Balance").props.value).toBe("custom");
    // A non-WB slider must NOT touch the label.
    ui.byLabel("White Balance").props.onChange("flash");
    ui.basic().props.onChange({ exposure: 0.4 });
    expect(ui.byLabel("White Balance").props.value).toBe("flash");
  });
});

describe("Camera Raw White Balance eyedropper", () => {
  it("arms and disarms the canvas from the tool button", () => {
    const ui = mount();
    expect(ui.byAttr("data-mv-cr-wb-tool").props.variant).toBe("ghost");
    ui.byAttr("data-mv-cr-wb-tool").props.onClick();
    expect(ui.byAttr("data-mv-cr-wb-tool").props.variant).toBe("primary");
    ui.byAttr("data-mv-cr-wb-tool").props.onClick();
    expect(ui.byAttr("data-mv-cr-wb-tool").props.variant).toBe("ghost");
  });

  it("takes over from another canvas tool instead of stacking with it", () => {
    const ui = mount();
    ui.byAttr("data-mv-cr-point-color-tool").props.onClick();
    ui.byAttr("data-mv-cr-wb-tool").props.onClick();
    expect(ui.byAttr("data-mv-cr-wb-tool").props.variant).toBe("primary");
    expect(ui.byAttr("data-mv-cr-point-color-tool").props.variant).toBe("ghost");
  });

  it("leaves White Balance untouched when there is no preview to sample", () => {
    const ui = mount();
    ui.byAttr("data-mv-cr-wb-tool").props.onClick();
    ui.byAttr("data-mv-cr-canvas").props.onPointerDown(canvasDown(0.5, 0.5));
    expect(ui.byLabel("White Balance").props.value).toBe("asShot");
    expect(ui.basic().props.value).toMatchObject({ temp: 0, tint: 0 });
  });

  it("leaves an already-neutral sample alone", () => {
    expect(whiteBalanceFromSample([128, 128, 128])).toEqual({ temp: 0, tint: 0 });
  });

  it("warms a blue-cast sample and adds green to a magenta one", () => {
    // b > r ⇒ the pixel is too cool, so Temperature moves warm (positive).
    expect(whiteBalanceFromSample([100, 128, 160]).temp).toBeGreaterThan(0);
    expect(whiteBalanceFromSample([160, 128, 100]).temp).toBeLessThan(0);
    // r/b above g ⇒ magenta cast, and the recipe stores positive tint = green.
    expect(whiteBalanceFromSample([150, 100, 150]).tint).toBeGreaterThan(0);
    expect(whiteBalanceFromSample([100, 150, 100]).tint).toBeLessThan(0);
  });

  it("agrees with Auto White Balance on a flat frame", () => {
    // One sampled pixel IS the average of a uniform frame, so clicking anywhere
    // in it must land on exactly what Auto White Balance measures.
    const flat = new Uint8ClampedArray(4 * 16);
    for (let i = 0; i < flat.length; i += 4) flat.set([90, 120, 170, 255], i);
    expect(whiteBalanceFromSample([90, 120, 170])).toEqual(autoWhiteBalance(flat));
  });
});
