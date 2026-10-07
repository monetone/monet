import { describe, expect, it, vi } from "vitest";

// VIS-FX-04: Camera Raw Filter mode must expose the full ACR Edit stack —
// Masking, Healing, Point Color and Profile/Calibration — on ordinary pixel
// layers. Like Photoshop, only Crop/Straighten (plus RAW-only Enhance and the
// session chrome) stays gated behind `rawOnly`.
//
// The workspace reaches the WASM engine and the canvas through state/app, so
// state/app is stubbed and React's hooks are driven by hand (the discipline of
// ./common.test.ts): the real component renders, and its real handlers run.
// Effects — which own the proxy engine and the canvas blit — stay unfired, so
// this covers the surface and the pointer edits, not the develop pipeline.
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

const { CameraRawWorkspace } = await import("./CameraRawWorkspace");
const { RangeSlider, SegmentedControl } = await import("@monet-ui/monet-react");
const { MAX_CAMERA_RAW_HEAL_SPOTS, MAX_CAMERA_RAW_MASKS, MAX_CAMERA_RAW_MASK_POINTS } =
  await import("../../state/cameraRaw");

type El = { type: unknown; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props?.children, out);
  return out;
}

/** Renders the real workspace for `invocation`, re-rendering on every setState. */
function mount(invocation: "filter" | "raw-open") {
  stub.arg = { invocation };
  let tree: El[] = [];
  const draw = () => { stub.begin(draw); tree = walk(CameraRawWorkspace() as unknown as El); };
  stub.reset();
  draw();
  const find = (pred: (e: El) => boolean) => tree.find(pred);
  return {
    sectionTitles: () => tree.map((e) => e.props.title).filter((t): t is string => typeof t === "string"),
    byAttr: (attr: string) => find((e) => attr in e.props)!,
    row: (label: string) => find((e) => e.props.label === label)!,
    byLabel: (label: string) => find((e) => e.props["aria-label"] === label)!,
    byRole: (role: string) => find((e) => e.props.role === role),
    /** The ParamRows table that renders a slider labelled `label`. */
    paramRows: (label: string) =>
      find((e) => Array.isArray(e.props.rows) && e.props.rows.some((r: { label: string }) => r.label === label))!,
    /** Every slider label, whether a direct Row or a ParamRows table entry. */
    sliderLabels: () => tree.flatMap((e) => Array.isArray(e.props.rows)
      ? e.props.rows.map((r: { label: string }) => r.label)
      : typeof e.props.label === "string" ? [e.props.label] : []),
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

const EDIT_SECTIONS = ["Profile & Calibration", "Point Color", "Healing", "Masking"];

describe("Camera Raw Filter surface", () => {
  it("renders Profile & Calibration, Point Color, Healing and Masking in filter mode", () => {
    const titles = mount("filter").sectionTitles();
    for (const title of EDIT_SECTIONS) expect(titles).toContain(title);
    expect(titles).toContain("Camera Raw Filter"); // the Dialog's own title
  });

  it("offers the same Edit stack when opened on a RAW file", () => {
    const titles = mount("raw-open").sectionTitles();
    for (const title of EDIT_SECTIONS) expect(titles).toContain(title);
  });

  it("keeps Crop & Straighten and Enhance RAW-only", () => {
    expect(mount("filter").sectionTitles()).not.toContain("Crop & Straighten");
    expect(mount("filter").sectionTitles()).not.toContain("Enhance");
    const raw = mount("raw-open").sectionTitles();
    expect(raw).toContain("Crop & Straighten");
    expect(raw).toContain("Enhance");
  });
});

describe("Camera Raw Detail, Optics and Geometry sub-controls (#444)", () => {
  const NEW_SLIDERS = [
    "Sharpen Detail", "Masking", "Luminance Detail", "Luminance Contrast", "Color Detail", "Color Smoothness",
    "Vignetting", "Purple Defringe", "Green Defringe", "Aspect", "Scale", "X Offset", "Y Offset",
  ];

  it("renders every new slider under a label no other slider uses", () => {
    const labels = mount("filter").sliderLabels();
    for (const label of NEW_SLIDERS) expect(labels.filter((l) => l === label), label).toHaveLength(1);
    // The old ambiguous labels are gone.
    expect(labels).not.toContain("Detail");
    expect(labels).not.toContain("Defringe");
  });

  it("drives each new slider into its recipe field", () => {
    const ui = mount("filter");
    ui.paramRows("Sharpen Detail").props.onChange({ sharpenDetail: 70, sharpenMasking: 40 });
    expect(ui.paramRows("Sharpen Detail").props.value).toMatchObject({ sharpenDetail: 70, sharpenMasking: 40 });
    ui.paramRows("Vignetting").props.onChange({ vignettingAmount: -0.5, defringeGreenAmount: 0.3 });
    expect(ui.paramRows("Vignetting").props.value).toMatchObject({ vignettingAmount: -0.5, defringeGreenAmount: 0.3 });
    ui.paramRows("Scale").props.onChange({ scale: 1.25, xOffset: 0.1 });
    expect(ui.paramRows("Scale").props.value).toMatchObject({ scale: 1.25, xOffset: 0.1 });
  });

  it("renders Purple Hue and Green Hue as range sliders bound to the defringe hue windows", () => {
    const ui = mount("filter");
    const purple = ui.byLabel("Purple Hue");
    expect(purple.type).toBe(RangeSlider);
    expect(purple.props).toMatchObject({ min: 0, max: 100, step: 1, minGap: 10, value: { min: 30, max: 70 } });
    expect(ui.byLabel("Green Hue").props.value).toEqual({ min: 40, max: 60 });
    purple.props.onChange({ min: 40, max: 70 });
    expect(ui.byLabel("Purple Hue").props.value).toEqual({ min: 40, max: 70 });
    expect(ui.paramRows("Purple Defringe").props.value.defringePurpleHue).toEqual([40, 70]);
  });

  it("offers Upright as a six-mode radiogroup, and Off clears the keystone", () => {
    const ui = mount("filter");
    const upright = ui.byLabel("Upright");
    expect(upright.type).toBe(SegmentedControl);
    expect(upright.props.items.map((item: { label: string }) => item.label))
      .toEqual(["Off", "Auto", "Level", "Vertical", "Full", "Guided"]);
    expect(upright.props.items.some((item: { disabled?: boolean }) => item.disabled)).toBe(false);
    ui.paramRows("Vertical").props.onChange({ vertical: 0.3, horizontal: -0.2, rotate: 0.1 });
    ui.byLabel("Upright").props.onChange("off");
    expect(ui.paramRows("Vertical").props.value).toMatchObject({ upright: "off", vertical: 0, horizontal: 0, rotate: 0 });
  });

  it("says so when Upright finds no straight lines, and leaves the geometry unchanged", () => {
    const ui = mount("filter");
    ui.paramRows("Vertical").props.onChange({ vertical: 0.3 });
    expect(ui.byRole("status")?.props.children ?? null).toBeNull();
    ui.byLabel("Upright").props.onChange("auto");
    expect(ui.byRole("status")?.props.children).toBe("Upright found no straight lines to correct.");
    expect(ui.paramRows("Vertical").props.value).toMatchObject({ upright: "off", vertical: 0.3 });
    expect(ui.byLabel("Upright").props.value).toBe("off");
  });
});

describe("Camera Raw Filter canvas edits", () => {
  it("places a healing spot from a canvas click in filter mode", () => {
    const ui = mount("filter");
    expect(ui.text("data-mv-cr-heal-count")).toBe(`0/${MAX_CAMERA_RAW_HEAL_SPOTS} spots`);
    // The canvas ignores pointers until a tool is armed…
    ui.byAttr("data-mv-cr-canvas").props.onPointerDown(canvasDown(0.5, 0.5));
    expect(ui.text("data-mv-cr-heal-count")).toBe(`0/${MAX_CAMERA_RAW_HEAL_SPOTS} spots`);
    // …and places a spot at the clicked fraction once Place Spot is on.
    ui.byAttr("data-mv-cr-heal-tool").props.onClick();
    ui.byAttr("data-mv-cr-canvas").props.onPointerDown(canvasDown(0.25, 0.75));
    expect(ui.text("data-mv-cr-heal-count")).toBe(`1/${MAX_CAMERA_RAW_HEAL_SPOTS} spots`);
    expect(ui.row("Target X").props.value).toBe(25);
    expect(ui.row("Target Y").props.value).toBe(75);
  });

  it("draws a Guided Upright guide on the canvas and solves the keystone from it (#444)", () => {
    const ui = mount("filter");
    ui.byLabel("Upright").props.onChange("guided");
    expect(ui.byLabel("Upright").props.value).toBe("guided");
    // Guided arms the guide tool: a drag along a leaning vertical is one guide.
    ui.byAttr("data-mv-cr-canvas").props.onPointerDown(canvasDown(0.55, 0.1));
    ui.byAttr("data-mv-cr-canvas").props.onPointerMove({ ...canvasDown(0.5, 0.9), buttons: 1 });
    ui.byAttr("data-mv-cr-canvas").props.onPointerUp();
    const geometry = ui.paramRows("Rotate").props.value;
    expect(geometry.upright).toBe("guided");
    expect(geometry.rotate).toBeLessThan(0);
  });

  it("adds a brush mask and paints into it in filter mode", () => {
    const ui = mount("filter");
    expect(ui.text("data-mv-cr-mask-count")).toBe(`0/${MAX_CAMERA_RAW_MASKS} masks · 0/${MAX_CAMERA_RAW_MASK_POINTS} points`);
    // Brush both creates the mask and arms the canvas.
    ui.byAttr("data-mv-cr-mask-brush").props.onClick();
    ui.byAttr("data-mv-cr-canvas").props.onPointerDown(canvasDown(0.5, 0.5));
    expect(ui.text("data-mv-cr-mask-count")).toBe(`1/${MAX_CAMERA_RAW_MASKS} masks · 1/${MAX_CAMERA_RAW_MASK_POINTS} points`);
  });
});
