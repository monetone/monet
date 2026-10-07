import { describe, expect, it, vi } from "vitest";

// Camera Raw direct manipulation: the on-canvas crop rectangle (eight handles,
// aspect presets), draggable gradient-mask handles, and the Remove brush's
// drag-to-heal stroke — the three ACR affordances the slider-only workspace was
// missing.
//
// Same discipline as ./cameraRawWhiteBalance.test.ts: state/app is stubbed and
// React's hooks are driven by hand, so the REAL component renders and its REAL
// pointer handlers run. Effects (which own the proxy engine and the canvas blit)
// stay unfired, so the geometry is asserted through the panels' numeric rows.
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

const { CameraRawWorkspace, CROP_ASPECT_PRESETS, cropAspectId, cropHandleAt, dragCropRect, maskPointAt } =
  await import("./CameraRawWorkspace");

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
    byAttr: (attr: string) => find((e) => attr in e.props)!,
    byLabel: (label: string) => find((e) => e.props["aria-label"] === label)!,
    byText: (text: string) => find((e) => e.props.children === text)!,
    row: (label: string) => find((e) => e.props.label === label)!,
    rows: (label: string) => tree.filter((e) => e.props.label === label),
    has: (attr: string) => tree.some((e) => attr in e.props),
    hasRow: (label: string) => tree.some((e) => e.props.label === label),
    text: (attr: string) => {
      const el = find((e) => attr in e.props);
      const flat = (n: unknown): string => (Array.isArray(n) ? n.map(flat).join("") : String(n));
      return flat(el?.props.children);
    },
    canvas: () => find((e) => "data-mv-cr-canvas" in e.props)!,
  };
}

/** The preview canvas is displayed 200×100, i.e. a 2:1 frame. */
const FRAME = { left: 0, top: 0, width: 200, height: 100 };
const pointerAt = (fx: number, fy: number, frame = FRAME) => ({
  clientX: frame.left + fx * frame.width, clientY: frame.top + fy * frame.height,
  pointerId: 1, pressure: 1, buttons: 1,
  currentTarget: { setPointerCapture() {}, getBoundingClientRect: () => frame },
});
const down = pointerAt;
const move = pointerAt;

const FULL = { left: 0, top: 0, right: 1, bottom: 1 };

describe("crop handle hit-testing", () => {
  const rect = { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 };

  it("names the corner, edge and interior a point grabs", () => {
    expect(cropHandleAt(rect, { x: 0.2, y: 0.2 })).toBe("nw");
    expect(cropHandleAt(rect, { x: 0.8, y: 0.2 })).toBe("ne");
    expect(cropHandleAt(rect, { x: 0.2, y: 0.8 })).toBe("sw");
    expect(cropHandleAt(rect, { x: 0.8, y: 0.8 })).toBe("se");
    expect(cropHandleAt(rect, { x: 0.5, y: 0.2 })).toBe("n");
    expect(cropHandleAt(rect, { x: 0.5, y: 0.8 })).toBe("s");
    expect(cropHandleAt(rect, { x: 0.2, y: 0.5 })).toBe("w");
    expect(cropHandleAt(rect, { x: 0.8, y: 0.5 })).toBe("e");
    expect(cropHandleAt(rect, { x: 0.5, y: 0.5 })).toBe("move");
  });

  it("grabs nothing outside the rect", () => {
    expect(cropHandleAt(rect, { x: 0.05, y: 0.5 })).toBeNull();
    expect(cropHandleAt(rect, { x: 0.5, y: 0.95 })).toBeNull();
  });

  it("still offers every edge of an uncropped frame", () => {
    expect(cropHandleAt(FULL, { x: 0, y: 0.5 })).toBe("w");
    expect(cropHandleAt(FULL, { x: 1, y: 1 })).toBe("se");
    expect(cropHandleAt(FULL, { x: 0.5, y: 0.5 })).toBe("move");
  });
});

describe("crop rect dragging", () => {
  it("pulls only the dragged edges in", () => {
    expect(dragCropRect(FULL, "se", -0.25, -0.4)).toEqual({ left: 0, top: 0, right: 0.75, bottom: 0.6 });
    expect(dragCropRect(FULL, "w", 0.3, 0.9)).toEqual({ left: 0.3, top: 0, right: 1, bottom: 1 });
  });

  it("never crosses itself or leaves the frame", () => {
    // Dragging the west edge past the east one stops at the 5% minimum width.
    expect(dragCropRect(FULL, "w", 2, 0).left).toBeCloseTo(0.95, 6);
    expect(dragCropRect(FULL, "n", 2, 2).top).toBeCloseTo(0.95, 6);
    expect(dragCropRect(FULL, "se", 0.5, 0.5)).toEqual(FULL);
    const shifted = dragCropRect({ left: 0.2, top: 0.2, right: 0.6, bottom: 0.6 }, "move", -0.9, 0.9);
    expect(shifted.left).toBe(0);
    expect(shifted.right).toBeCloseTo(0.4, 6);
    expect(shifted.top).toBeCloseTo(0.6, 6);
    expect(shifted.bottom).toBe(1);
  });

  it("moves the rect without resizing it", () => {
    const moved = dragCropRect({ left: 0.1, top: 0.1, right: 0.5, bottom: 0.3 }, "move", 0.2, 0.1);
    expect(moved.right - moved.left).toBeCloseTo(0.4, 6);
    expect(moved.bottom - moved.top).toBeCloseTo(0.2, 6);
    expect(moved.left).toBeCloseTo(0.3, 6);
    expect(moved.top).toBeCloseTo(0.2, 6);
  });

  it("holds a locked aspect in FRAME units, not in the 0..1 rect space", () => {
    // 1:1 on a 2:1 frame: a square crop is half as wide as it is tall in the
    // normalized rect space, so the ratio has to go through the frame aspect.
    const square = dragCropRect(FULL, "se", -0.6, 0, { aspect: 1, frameAspect: 2 });
    expect((square.right - square.left) * 2).toBeCloseTo(square.bottom - square.top, 6);
    // A north/south handle has no horizontal component: height drives width.
    const fromHeight = dragCropRect(FULL, "s", 0, -0.5, { aspect: 1, frameAspect: 2 });
    expect((fromHeight.right - fromHeight.left) * 2).toBeCloseTo(fromHeight.bottom - fromHeight.top, 6);
    // The lock is anchored opposite the handle and never leaves the frame.
    expect(square.left).toBe(0);
    expect(square.top).toBe(0);
    expect(square.right).toBeLessThanOrEqual(1);
    expect(square.bottom).toBeLessThanOrEqual(1);
  });
});

describe("crop aspect presets", () => {
  it("names the preset a stored ratio came from, and Custom for anything else", () => {
    expect(cropAspectId(null)).toBe("original");
    expect(cropAspectId(16 / 9)).toBe("16x9");
    expect(cropAspectId(1)).toBe("1x1");
    expect(cropAspectId(1.234)).toBe("custom");
  });

  it("writes the chosen preset's ratio and relabels itself Custom once it is dialled off", () => {
    const ui = mount("raw-open");
    const menu = () => ui.byLabel("Crop Aspect");
    expect(menu().props.value).toBe("original");
    expect((menu().props.options as { value: string }[]).map((o) => o.value))
      .toEqual([...CROP_ASPECT_PRESETS.map((p) => p.id), "custom"]);
    // Unconstrained: there is no ratio to show.
    expect(ui.hasRow("Aspect Ratio")).toBe(false);

    menu().props.onChange("16x9");
    expect(menu().props.value).toBe("16x9");
    expect(ui.row("Aspect Ratio").props.value).toBeCloseTo(16 / 9, 6);

    // Like the White Balance menu, Custom is a readout: dialling the number off
    // every preset is what selects it.
    ui.row("Aspect Ratio").props.onChange(1.25);
    expect(menu().props.value).toBe("custom");
    expect(ui.row("Aspect Ratio").props.value).toBe(1.25);

    menu().props.onChange("original");
    expect(menu().props.value).toBe("original");
    expect(ui.hasRow("Aspect Ratio")).toBe(false);
  });
});

describe("Camera Raw crop tool on the preview", () => {
  it("arms and disarms the canvas from the tool button", () => {
    const ui = mount("raw-open");
    expect(ui.byAttr("data-mv-cr-crop-tool").props.variant).toBe("ghost");
    ui.byAttr("data-mv-cr-crop-tool").props.onClick();
    expect(ui.byAttr("data-mv-cr-crop-tool").props.variant).toBe("primary");
    ui.byAttr("data-mv-cr-crop-tool").props.onClick();
    expect(ui.byAttr("data-mv-cr-crop-tool").props.variant).toBe("ghost");
  });

  it("ignores preview drags until the crop tool is armed", () => {
    const ui = mount("raw-open");
    ui.canvas().props.onPointerDown(down(0, 0.5));
    ui.canvas().props.onPointerMove(move(0.3, 0.5));
    expect(ui.row("Left").props.value).toBe(0);
    expect(ui.row("Width").props.value).toBe(100);
  });

  it("drags the west edge and reports it through the Left/Width sliders", () => {
    const ui = mount("raw-open");
    ui.byAttr("data-mv-cr-crop-tool").props.onClick();
    ui.canvas().props.onPointerDown(down(0, 0.5));
    ui.canvas().props.onPointerMove(move(0.3, 0.5));
    expect(ui.row("Left").props.value).toBe(30);
    expect(ui.row("Width").props.value).toBe(70);
    expect(ui.row("Top").props.value).toBe(0);
    expect(ui.row("Height").props.value).toBe(100);
  });

  it("keeps a drag anchored to where it started, not to the previous move", () => {
    const ui = mount("raw-open");
    ui.byAttr("data-mv-cr-crop-tool").props.onClick();
    ui.canvas().props.onPointerDown(down(1, 1));
    ui.canvas().props.onPointerMove(move(0.8, 0.9));
    ui.canvas().props.onPointerMove(move(0.6, 0.7));
    // Absolute, not cumulative: 0.6 from the 1.0 the drag grabbed.
    expect(ui.row("Width").props.value).toBe(60);
    expect(ui.row("Height").props.value).toBe(70);
  });

  it("moves the whole rect when the drag starts inside it", () => {
    const ui = mount("raw-open");
    ui.byAttr("data-mv-cr-crop-tool").props.onClick();
    ui.canvas().props.onPointerDown(down(1, 1));
    ui.canvas().props.onPointerMove(move(0.6, 0.6));
    ui.canvas().props.onPointerUp();
    expect(ui.row("Left").props.value).toBe(0);
    ui.canvas().props.onPointerDown(down(0.3, 0.3));
    ui.canvas().props.onPointerMove(move(0.5, 0.4));
    expect(ui.row("Left").props.value).toBe(20);
    expect(ui.row("Top").props.value).toBe(10);
    expect(ui.row("Width").props.value).toBe(60);
    expect(ui.row("Height").props.value).toBe(60);
  });

  it("holds the locked aspect while dragging", () => {
    const ui = mount("raw-open");
    ui.byLabel("Crop Aspect").props.onChange("1x1");
    ui.byAttr("data-mv-cr-crop-tool").props.onClick();
    ui.canvas().props.onPointerDown(down(1, 1));
    ui.canvas().props.onPointerMove(move(0.4, 1));
    // Square on a 2:1 preview: 40% of the width is the same pixel length as 80%
    // of the height.
    expect(ui.row("Width").props.value * FRAME.width).toBeCloseTo(ui.row("Height").props.value * FRAME.height, 6);
  });

  it("releases the drag so a later move cannot resume it", () => {
    const ui = mount("raw-open");
    ui.byAttr("data-mv-cr-crop-tool").props.onClick();
    ui.canvas().props.onPointerDown(down(1, 0.5));
    ui.canvas().props.onPointerMove(move(0.7, 0.5));
    ui.canvas().props.onPointerUp();
    ui.canvas().props.onPointerMove(move(0.2, 0.5));
    expect(ui.row("Width").props.value).toBe(70);
  });
});

describe("Camera Raw preview zoom", () => {
  it("fits the preview to the dialog until a zoom level is chosen", () => {
    const ui = mount("filter");
    expect(ui.byLabel("Preview Zoom").props.value).toBe("1");
    expect(ui.canvas().props.style).toMatchObject({ maxWidth: "100%", width: "auto" });
    // Fit never overflows, so the preview box must not scroll.
    expect(ui.byAttr("data-mv-cr-preview").props.style.overflow).toBe("hidden");
  });

  it("lays the canvas out past its box and lets the box scroll to pan", () => {
    const ui = mount("filter");
    ui.byLabel("Preview Zoom").props.onChange("4");
    expect(ui.canvas().props.style).toMatchObject({ maxWidth: "none", maxHeight: "none", width: "400%" });
    const box = ui.byAttr("data-mv-cr-preview").props.style;
    expect(box.overflow).toBe("auto");
    // Centring a flex item that overflows would cut off its top-left, which is
    // exactly the part a zoomed preview must be able to scroll back to.
    expect(box.alignItems).toBe("flex-start");
    expect(box.justifyContent).toBe("flex-start");
    ui.byLabel("Preview Zoom").props.onChange("1");
    expect(ui.byAttr("data-mv-cr-preview").props.style.overflow).toBe("hidden");
  });

  it("keeps the pointer tools accurate on a zoomed, scrolled preview", () => {
    // 4× and scrolled: the canvas' client rect is bigger and starts off-screen,
    // so a tool that used anything but that rect would land somewhere else.
    const zoomed = { left: -300, top: -80, width: 800, height: 400 };
    const ui = mount("raw-open");
    ui.byLabel("Preview Zoom").props.onChange("4");
    ui.byAttr("data-mv-cr-crop-tool").props.onClick();
    ui.canvas().props.onPointerDown(down(0, 0.5, zoomed));
    ui.canvas().props.onPointerMove(move(0.3, 0.5, zoomed));
    expect(ui.row("Left").props.value).toBe(30);
    expect(ui.row("Width").props.value).toBe(70);
  });
});

describe("gradient mask handles", () => {
  it("grabs the nearest control point, and nothing beyond the grab radius", () => {
    const points = [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }];
    expect(maskPointAt(points, { x: 0.26, y: 0.51 })).toBe(0);
    expect(maskPointAt(points, { x: 0.74, y: 0.5 })).toBe(1);
    expect(maskPointAt(points, { x: 0.5, y: 0.5 })).toBe(-1);
    expect(maskPointAt([], { x: 0.25, y: 0.5 })).toBe(-1);
  });

  it("arms the handle tool when a gradient mask is created", () => {
    const ui = mount("filter");
    expect(ui.has("data-mv-cr-mask-handles")).toBe(false);
    ui.byAttr("data-mv-cr-mask-bidirectional").props.onClick();
    expect(ui.byAttr("data-mv-cr-mask-handles").props.variant).toBe("primary");
    ui.byAttr("data-mv-cr-mask-handles").props.onClick();
    expect(ui.byAttr("data-mv-cr-mask-handles").props.variant).toBe("ghost");
  });

  it("leaves brush masks without handles", () => {
    const ui = mount("filter");
    ui.byAttr("data-mv-cr-mask-brush").props.onClick();
    expect(ui.has("data-mv-cr-mask-handles")).toBe(false);
  });

  it("drags the grabbed handle and leaves the other one where it was", () => {
    const ui = mount("filter");
    ui.byAttr("data-mv-cr-mask-bidirectional").props.onClick();
    expect([ui.row("Start X").props.value, ui.row("End X").props.value]).toEqual([25, 75]);
    ui.canvas().props.onPointerDown(down(0.25, 0.5));
    ui.canvas().props.onPointerMove(move(0.6, 0.2));
    expect(ui.row("Start X").props.value).toBe(60);
    expect(ui.row("Start Y").props.value).toBe(20);
    expect(ui.row("End X").props.value).toBe(75);
    expect(ui.row("End Y").props.value).toBe(50);
    // Dragging a handle must never append points the way the brush does.
    expect(ui.text("data-mv-cr-mask-count")).toContain("2/4096 points");
  });

  it("moves nothing when the press misses every handle", () => {
    const ui = mount("filter");
    ui.byAttr("data-mv-cr-mask-bidirectional").props.onClick();
    ui.canvas().props.onPointerDown(down(0.5, 0.9));
    ui.canvas().props.onPointerMove(move(0.6, 0.2));
    expect([ui.row("Start X").props.value, ui.row("End X").props.value]).toEqual([25, 75]);
  });

  it("labels a radial mask's handles Center and Edge, and aims it by number", () => {
    const ui = mount("filter");
    ui.byText("Radial").props.onClick();
    expect(ui.hasRow("Start X")).toBe(false);
    expect(ui.row("Center X").props.value).toBe(50);
    expect(ui.row("Edge X").props.value).toBe(72);
    // The numeric rows are the pointer-free way to aim the same handles.
    ui.row("Center Y").props.onChange(30);
    expect(ui.row("Center Y").props.value).toBe(30);
    expect(ui.row("Edge Y").props.value).toBe(50);
  });
});

describe("Camera Raw remove brush", () => {
  const targets = (ui: ReturnType<typeof mount>) =>
    ui.rows("Target X").map((r) => r.props.value as number);
  const sourceOffsets = (ui: ReturnType<typeof mount>) =>
    ui.rows("Target X").map((_, i) => [
      (ui.rows("Source X")[i].props.value as number) - (ui.rows("Target X")[i].props.value as number),
      (ui.rows("Source Y")[i].props.value as number) - (ui.rows("Target Y")[i].props.value as number),
    ]);

  it("still places exactly one spot for a click", () => {
    const ui = mount("filter");
    ui.byAttr("data-mv-cr-heal-tool").props.onClick();
    ui.canvas().props.onPointerDown(down(0.25, 0.75));
    ui.canvas().props.onPointerUp();
    expect(ui.text("data-mv-cr-heal-count")).toBe("1/64 spots");
    expect(targets(ui)).toEqual([25]);
    expect(ui.row("Source X").props.value).toBe(33);
  });

  it("resamples a drag into a chain of stamps along the stroke", () => {
    const ui = mount("filter");
    ui.byAttr("data-mv-cr-heal-tool").props.onClick();
    ui.canvas().props.onPointerDown(down(0.2, 0.5));
    ui.canvas().props.onPointerMove(move(0.24, 0.5));
    ui.canvas().props.onPointerMove(move(0.3, 0.5));
    const along = targets(ui);
    expect(along.length).toBeGreaterThan(2);
    expect(along[0]).toBe(20);
    expect(along[along.length - 1]).toBe(30);
    // Monotonic along the stroke: stamps follow the path, they do not scatter.
    expect([...along].sort((a, b) => a - b)).toEqual(along);
    // One coherent source offset for the whole stroke (perpendicular to it, so a
    // horizontal drag samples from above or below — never from the blemish line).
    const offsets = sourceOffsets(ui);
    for (const offset of offsets) expect(offset).toEqual(offsets[0]);
    expect(offsets[0][0]).toBe(0);
    expect(Math.abs(offsets[0][1])).toBeGreaterThan(0);
  });

  it("replaces its own stamps as the stroke grows, and keeps earlier strokes", () => {
    const ui = mount("filter");
    ui.byAttr("data-mv-cr-heal-tool").props.onClick();
    ui.canvas().props.onPointerDown(down(0.2, 0.5));
    ui.canvas().props.onPointerMove(move(0.3, 0.5));
    const first = targets(ui);
    expect(first.length).toBeGreaterThan(1);
    // Extending the SAME stroke re-stamps it: the chain grows by the few stamps
    // the new segment needs, it does not stack a second copy of the whole stroke.
    ui.canvas().props.onPointerMove(move(0.32, 0.5));
    const grown = targets(ui);
    expect(grown.length).toBeGreaterThan(first.length);
    expect(grown.length).toBeLessThan(first.length + 4);
    expect(grown[0]).toBe(20);
    expect(grown[grown.length - 1]).toBe(32);
    ui.canvas().props.onPointerUp();
    // A second stroke starts from the spots the first one left behind.
    ui.canvas().props.onPointerDown(down(0.6, 0.2));
    ui.canvas().props.onPointerMove(move(0.7, 0.2));
    const both = targets(ui);
    expect(both.length).toBeGreaterThan(grown.length);
    expect(both.slice(0, grown.length)).toEqual(grown);
  });

  it("does not extend a stroke after the pointer is released", () => {
    const ui = mount("filter");
    ui.byAttr("data-mv-cr-heal-tool").props.onClick();
    ui.canvas().props.onPointerDown(down(0.2, 0.5));
    ui.canvas().props.onPointerUp();
    ui.canvas().props.onPointerMove(move(0.5, 0.5));
    expect(ui.text("data-mv-cr-heal-count")).toBe("1/64 spots");
  });
});
