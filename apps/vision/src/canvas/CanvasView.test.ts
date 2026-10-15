// @vitest-environment jsdom
// CanvasView behaviour. The component is mounted for real (jsdom) over a
// recording engine double, so every assertion below is on what a gesture, a
// composite sync or a wheel actually does — not on the shape of the source.
//
// The one thing still asserted from source is the marching-ants WASM view
// lifetime (see the last describe): it is a memory-detachment hazard that a JS
// engine double cannot reproduce.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defaultSpec } from "../text/spec";
import { pointTypeCaretXs } from "../text/raster";
import { fitOrientedView } from "../state/zoomPresets";
import { quickMaskPixel } from "../state/quickMaskOverlay";

/** Every engine call the mounted canvas makes, in order. */
const calls: { name: string; args: unknown[] }[] = [];
/** Return values for engine reads, by method name (default: 0). */
const engineReturns = new Map<string, unknown>();
/** Calls the component made on the live-text service. */
const textCalls: { name: string; args: unknown[] }[] = [];
/** The spec `text.get(id)` hands back, or null for "not a live type layer". */
let textSpec: Record<string, unknown> | null = null;
/** 2D-context calls, so canvas-only redraws are observable. */
const ctxCalls: string[] = [];
/** Images handed to putImageData, in call order. */
const putImages: Uint8ClampedArray[] = [];
/** ResizeObserver instances the mounted view registered. Callbacks are not fired
 *  unless a test does it — existing cases still see a viewport of 0×0. */
const resizeObservers: { cb: ResizeObserverCallback; el: Element }[] = [];

const auto = (): never =>
  new Proxy(function () {} as never, { get: (_t, k) => (k === "then" ? undefined : auto()), apply: () => 0 }) as never;

vi.mock("@monet-ui/monet-collab/react", () => ({ CollabCursors: () => null }));
// The float windows' Tauri side (#477): what the main webview invokes and
// emits, and the handlers it listens with, by event name.
const tauriCalls: { cmd: string; args: unknown; opts?: unknown }[] = [];
const tauriListeners = new Map<string, (e: { payload: unknown }) => void>();
let failNext = false;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown, opts?: unknown) => {
    tauriCalls.push({ cmd, args, opts });
    if (failNext) { failNext = false; return Promise.reject(new Error("IPC down")); }
    return Promise.resolve(true);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (e: { payload: unknown }) => void) => { tauriListeners.set(name, handler); return Promise.resolve(() => {}); },
  emitTo: (target: string, name: string, payload: unknown) => { tauriCalls.push({ cmd: `emitTo:${target}:${name}`, args: payload }); return Promise.resolve(); },
}));
vi.mock("../state/app", async () => {
  const { Store, makeUseStore } = await import("../state/store");
  const e = new Proxy({} as Record<string, unknown>, {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push({ name, args });
      return engineReturns.has(name) ? engineReturns.get(name) : 0;
    },
  });
  // The engine client: the members whose answers matter are spelled out, the
  // rest (blits, canvas plumbing, capture hooks) are inert no-ops.
  const client: Record<string, unknown> = {
    engine: e, e,
    commit: () => { calls.push({ name: "commit", args: [] }); return true; },
    sync: () => { calls.push({ name: "sync", args: [] }); },
    frameThumbUrl: () => "",
    liquifyFreezeMaskBuffer: () => null,
    liquifyMesh: () => null,
    quickMaskBuffer: () => null,
    selectionMask: () => null,
    onPaintRegion: null,
    onCommit: null,
    blitListeners: new Set(),
  };
  const engine = new Proxy(client, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => { t[k] = v; return true; },
  });
  const store = new Store(engine as never);
  // The pure spec helpers the text-editor overlay needs to render at all.
  const pure = await import("../text/spec");
  const text = new Proxy({} as Record<string, unknown>, {
    get: (_t, name: string) => (...args: unknown[]) => {
      textCalls.push({ name, args });
      if (name === "get") return textSpec;
      if (name === "resolveStyle") return pure.resolveStyle(...(args as [never, never]));
      if (name === "fullText") return pure.fullText(...(args as [never]));
      return undefined;
    },
  });
  return {
    store, engine, text, useStore: makeUseStore(store),
    anim: auto(), collab: null,
    xform: new Proxy({} as Record<string, unknown>, {
      get: (_t, name: string) => (...args: unknown[]) => { calls.push({ name: `xform.${name}`, args }); },
    }),
    contentAwareMoveBy: () => {}, removeStroke: () => {},
    ...Object.fromEntries(["beginContentAwareMoveDrop", "updateContentAwareMoveDrop", "commitContentAwareMoveDrop", "cancelContentAwareMoveDrop"]
      .map((name) => [name, (...args: unknown[]) => { calls.push({ name, args }); }])),
    // Allow Tool Recording's sink (#471) — every call lands in `calls` like an
    // engine call, so a gesture's recorded step is observable.
    actions: new Proxy({} as Record<string, unknown>, {
      get: (_t, name: string) => (...args: unknown[]) => { calls.push({ name: `actions.${name}`, args }); },
    }),
  };
});

let root: Root;
let host: HTMLElement;
let viewport: HTMLElement;

// Transform the app-sized component graph before starting per-test deadlines.
// A cold dynamic import inside beforeEach can outlive that hook under load and
// leave its unfinished mount racing the next test's fixture.
const { CanvasView } = await import("./CanvasView");
const { store, engine } = await import("../state/app") as unknown as {
  store: import("../state/store").Store;
  engine: {
    onPaintRegion: ((x: number, y: number, w: number, h: number) => void) | null;
    activate: (eng: unknown) => void;
  };
};

const names = () => calls.map((c) => c.name);
const lastCall = (name: string) => [...calls].reverse().find((c) => c.name === name);

/** Mount the real CanvasView into a fresh jsdom tree — plus a Window ▸ Arrange
 *  pane per document id in `panes`. `viewport` stays the main canvas's. */
async function mount(panes: number[] = []): Promise<void> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(el: Element) { resizeObservers.push({ cb: this.cb, el }); }
    unobserve() {}
    disconnect() {}
  };
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({
      canvas: { style: { setProperty() {} }, parentNode: null, offsetWidth: 1 },
    } as Record<string, unknown>, {
      get: (target, k: string) => {
        if (k in target) return target[k];
        if (k === "createImageData") {
          return (w: number, h: number) => {
            ctxCalls.push(k);
            return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
          };
        }
        if (k === "measureText") {
          return (text: unknown) => {
            ctxCalls.push(k);
            return { width: String(text).length, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
          };
        }
        return (...a: unknown[]) => {
          ctxCalls.push(k);
          if (k === "putImageData") {
            const image = a[0] as { data?: Uint8ClampedArray } | undefined;
            if (image?.data) putImages.push(image.data);
          }
          return k === "getImageData" ? { data: new Uint8ClampedArray(4 * Math.max(1, a.length)), width: 1, height: 1 } : undefined;
        };
      },
      set: (target, k: string, v) => { target[k] = v; return true; },
    })) as never;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(Fragment, null, createElement(CanvasView), ...panes.map((id) => createElement(CanvasView, { key: id, paneDocId: id }))));
  });
  viewport = host.querySelector(".mv-canvas-viewport") as HTMLElement;
}

const fire = (type: string, x: number, y: number, init: MouseEventInit = {}) =>
  viewport.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...init }));

/** Let the coalescing requestAnimationFrame actually run (jsdom drives it off a timer). */
const flushFrame = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  calls.length = 0;
  textCalls.length = 0;
  ctxCalls.length = 0;
  putImages.length = 0;
  resizeObservers.length = 0;
  engineReturns.clear();
  textSpec = null;
});

// ─────────────────────────────────────────────────────────────
// Move release (#5)
// ─────────────────────────────────────────────────────────────
// Smart Guides snap the drag (store.ts defaults them on), and the snapped offset
// reaches the engine through the coalescing rAF — which has usually flushed by
// the time the pointer comes up. Recomputing the offset from the raw pointer
// position on release therefore disagrees with what is on screen: a text layer
// re-anchors up to 6 doc px off its previewed snap, and a raw delta that rounds
// to 0 while a non-zero snap is live skips the text branch entirely, letting
// commit_offset bake an offset the spec never learns about.
describe("Move release", () => {
  // Active layer at (100,100,20,20); a sibling at x=97 pulls every vertical
  // alignment to dx = -3, well inside the 6px snap threshold.
  const ACTIVE = Int32Array.from([100, 100, 20, 20]);
  const OTHERS = Int32Array.from([7, 97, 300, 20, 20]);

  beforeEach(async () => {
    engineReturns.set("active_layer_bounds", ACTIVE);
    engineReturns.set("all_layer_bounds", OTHERS);
    engineReturns.set("move_layer_offset", Int32Array.from([0, 0, 0, 0]));
    await mount();
    // zoom 4 so a 1px pointer nudge is a quarter of a doc pixel: the raw delta
    // rounds to 0 while the snap is a live -3.
    await act(async () => { store.setTool("move"); store.setZoom(4, 0, 0); });
    calls.length = 0;
  });

  /** Nudge the pointer by one client px, let the rAF flush, then release. */
  async function snappedDrag(): Promise<void> {
    await act(async () => { fire("pointerdown", 0, 0); fire("pointermove", 1, 0); });
    await flushFrame(); // the coalesced frame lands before the release
    await act(async () => { fire("pointerup", 1, 0); });
  }

  it("hands the engine the snapped offset, not the raw pointer delta", async () => {
    await snappedDrag();
    // Smart Guides turned a 0px raw delta into -3, and that is what the engine
    // holds when the release bakes it in.
    expect(lastCall("move_layer_offset")?.args).toEqual([0, -3, 0]);
    expect(names()).toContain("commit_offset");
  });

  it("re-anchors a text layer by the offset the engine was given", async () => {
    engineReturns.set("layer_kind", 2); // LAYER_KIND.text
    textSpec = { ax: 40, ay: 60, text: "hi" };
    await snappedDrag();
    // The whole point of #5: the raw delta rounds to 0, so a release that
    // recomputed it would skip this branch and let commit_offset bake -3 behind
    // the spec's back.
    expect(names()).not.toContain("commit_offset");
    expect(lastCall("move_layer_offset")?.args).toEqual([0, 0, 0]); // live offset reset
    const applied = textCalls.find((c) => c.name === "apply");
    expect(applied?.args[0]).toBe(0);
    expect(applied?.args[1]).toMatchObject({ ax: 37, ay: 60 });
  });

  it("clears the applied offset when the gesture is cancelled", async () => {
    await act(async () => { fire("pointerdown", 0, 0); fire("pointermove", 1, 0); });
    await flushFrame();
    await act(async () => { viewport.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true })); });
    // A fresh, motionless drag on a text layer must see offset 0 — if the
    // cancelled -3 survived, the text would jump on a plain click.
    engineReturns.set("layer_kind", 2);
    textSpec = { ax: 40, ay: 60, text: "hi" };
    calls.length = 0;
    textCalls.length = 0;
    await act(async () => { fire("pointerdown", 0, 0); fire("pointerup", 0, 0); });
    expect(textCalls.find((c) => c.name === "apply")).toBeUndefined();
    expect(names()).toContain("commit_offset");
  });
});

describe("Object Selection modifiers", () => {
  beforeEach(async () => {
    await mount();
    await act(async () => { store.setTool("objectselection"); });
  });

  it.each([
    [true, false, 1],
    [false, true, 2],
    [true, true, 3],
  ] as const)("forwards gesture-start Shift=%s Alt=%s as combine mode %s", async (shiftKey, altKey, mode) => {
    await act(async () => {
      fire("pointerdown", 10, 20, { shiftKey, altKey });
      fire("pointerup", 40, 50);
    });
    expect(lastCall("select_object")?.args.at(-1)).toBe(mode);
  });
});

// ─────────────────────────────────────────────────────────────
// Allow Tool Recording (#471)
// ─────────────────────────────────────────────────────────────
// Selection drags go straight to the engine, so — unlike the store commands the
// recorder proxies — nothing about them reached an action. Each now hands the
// recorder the same geometry it gave the engine; the toggle itself gates it
// inside actions.recordTool, so the canvas offers the gesture unconditionally.
describe("pointer gestures reach the action recorder", () => {
  beforeEach(async () => {
    await mount();
    await act(async () => { store.setZoom(1, 0, 0); });
  });

  it("records a marquee drag with the geometry and combine mode it selected", async () => {
    await act(async () => { store.setTool("marquee"); });
    await act(async () => {
      fire("pointerdown", 10, 20, { shiftKey: true });
      fire("pointermove", 40, 60);
      fire("pointerup", 40, 60, { shiftKey: true });
    });
    const rect = lastCall("select_rect")!.args;
    expect(lastCall("actions.recordTool")?.args).toEqual([["selectRect", rect]]);
  });

  it("records an ellipse drag", async () => {
    await act(async () => { store.setTool("ellipse"); });
    await act(async () => {
      fire("pointerdown", 10, 20);
      fire("pointermove", 40, 60);
      fire("pointerup", 40, 60);
    });
    expect(lastCall("actions.recordTool")?.args).toEqual([["selectEllipse", lastCall("select_ellipse")!.args]]);
  });

  it("records a lasso drag as the polygon it selected", async () => {
    await act(async () => { store.setTool("lasso"); });
    await act(async () => {
      fire("pointerdown", 10, 20);
      fire("pointermove", 40, 20);
      fire("pointermove", 40, 60);
      fire("pointerup", 40, 60);
    });
    const poly = lastCall("select_polygon")!.args;
    expect(poly[0]).toBeInstanceOf(Float32Array);
    expect(lastCall("actions.recordTool")?.args).toEqual([["selectPolygon", poly]]);
  });

  it("leaves gestures that are not a selection alone", async () => {
    await act(async () => { store.setTool("move"); });
    await act(async () => {
      fire("pointerdown", 10, 20);
      fire("pointermove", 40, 60);
      fire("pointerup", 40, 60);
    });
    expect(names()).not.toContain("actions.recordTool");
  });
});

describe("area type", () => {
  beforeEach(async () => {
    await mount();
    await act(async () => { store.setZoom(1, 0, 0); });
  });

  it.each([
    ["text", false],
    ["horizontaltypemask", false],
    ["verticaltype", true],
    ["verticaltypemask", true],
  ] as const)("creates a paragraph box with the %s tool", async (tool, vertical) => {
    await act(async () => { store.setTool(tool); });
    await act(async () => {
      fire("pointerdown", 10, 20);
      fire("pointermove", 110, 90);
      fire("pointerup", 110, 90);
    });
    expect(textCalls.find((call) => call.name === "createAt")?.args).toEqual([
      10,
      20,
      { ...(vertical ? { vertical: true } : {}), kind: "paragraph", boxW: 100, boxH: 70 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// Overlay cache keys (#102, #171)
// ─────────────────────────────────────────────────────────────
// `undoDepth` is not a composite generation: it never moves for an edit that
// pushes no undo state (a layer-visibility toggle — #102) and it stops moving
// altogether at the History States cap, where a run of same-label edits (every
// brush stroke pushes "Brush") leaves the key byte-identical (#171). `doc` is
// replaced on every engine→store sync, so its identity tracks the composite.
// The engine double keeps every history read pinned at 0, which is exactly the
// capped/no-undo-state situation those bugs describe.
describe("overlay cache keys", () => {
  beforeEach(async () => {
    engineReturns.set("active_layer_bounds", Int32Array.from([10, 20, 30, 40]));
    engineReturns.set("width", 64);
    engineReturns.set("height", 48);
    await mount();
  });

  /** The active-layer bounds the engine is reporting, as drawn. */
  const edgeRect = () =>
    [...host.querySelectorAll("rect")]
      .map((r) => [r.getAttribute("x"), r.getAttribute("y"), r.getAttribute("width"), r.getAttribute("height")].join())
      .filter((s) => s.split(",").every((v) => v && v !== "null"));

  it("redraws the layer edges for a composite change that pushes no undo state", async () => {
    await act(async () => {
      store.setOptions({ showExtras: true, showLayerEdges: true });
      store.syncFromEngine();
    });
    expect(edgeRect()).toContain("10,20,30,40");

    engineReturns.set("active_layer_bounds", Int32Array.from([50, 60, 70, 80]));
    await act(async () => { store.syncFromEngine(); }); // undoDepth is still 0
    expect(edgeRect()).toContain("50,60,70,80");
    expect(edgeRect()).not.toContain("10,20,30,40");
  });

  it("redraws the Move transform box on the same signal", async () => {
    // The transform frame is a quad (it rotates), so its geometry reads off the
    // polygon's corner list rather than a rect.
    const boxQuad = () => host.querySelector("[data-mv-xform-box]")?.getAttribute("points");
    await act(async () => {
      store.setTool("move");
      store.setOptions({ showTransformControls: true });
      store.syncFromEngine();
    });
    expect(boxQuad()).toBe("10,20 40,20 40,60 10,60");

    engineReturns.set("active_layer_bounds", Int32Array.from([50, 60, 70, 80]));
    await act(async () => { store.syncFromEngine(); });
    expect(boxQuad()).toBe("50,60 120,60 120,140 50,140");
  });

  it("re-tiles the Pattern Preview on the same signal", async () => {
    await act(async () => { store.syncFromEngine(); store.setOptions({ patternPreview: true }); });
    const first = ctxCalls.filter((c) => c === "drawImage").length;
    expect(first).toBeGreaterThan(0);
    await act(async () => { store.syncFromEngine(); });
    expect(ctxCalls.filter((c) => c === "drawImage").length).toBeGreaterThan(first);
  });
});

// ─────────────────────────────────────────────────────────────
// Rulers (#11)
// ─────────────────────────────────────────────────────────────
// The content transform scales x by `zoom * parX` (View ▸ Pixel Aspect Ratio
// Correction), and every hit-test follows it. A ruler tick that drops parX
// drifts linearly across the document — the label 1000 landing over doc x=500
// on a 2:1 anamorphic pixel. y carries no stretch, so it must NOT gain one.
describe("rulers (#11)", () => {
  beforeEach(async () => {
    engineReturns.set("width", 400);
    engineReturns.set("height", 400);
    await mount();
    await act(async () => {
      store.syncFromEngine(); // flips `ready`, publishes the 400×400 doc
      store.setOptions({ showRulers: true, pixelAspect: 2, pixelAspectCorrection: true });
      store.setZoom(1, 0, 0);
    });
  });

  /** `x`/`y` of the ruler label for document coordinate `doc`. */
  const label = (doc: number) =>
    [...host.querySelectorAll("text")]
      .filter((t) => t.textContent === String(doc))
      .map((t) => ({ x: Number(t.getAttribute("x")), y: Number(t.getAttribute("y")) }));

  it("stretches the horizontal ruler with the pixel aspect", () => {
    // doc x=100 sits at screen 100 * zoom * parX = 200 (label offset +2).
    expect(label(100).map((p) => p.x)).toContain(202);
  });

  it("leaves the vertical ruler unstretched", () => {
    // doc y=100 sits at screen 100 * zoom = 100 (label offset +8) — no parX.
    expect(label(100).map((p) => p.y)).toContain(108);
    expect(label(100).map((p) => p.y)).not.toContain(208);
  });

  it("drops the stretch when Pixel Aspect Ratio Correction is off", async () => {
    await act(async () => { store.setOptions({ pixelAspectCorrection: false }); });
    expect(label(100).map((p) => p.x)).toContain(102);
  });
});

// ─────────────────────────────────────────────────────────────
// Brush cursor (Preferences ▸ Cursors, #482)
// ─────────────────────────────────────────────────────────────
// Normal Brush Tip rings the part of a dab painted at 50% or more — the engine's
// smootherstep falloff crosses 0.5 at (1 + hardness) / 2 of the radius — while
// Full Size rings the whole footprint. Both follow size × zoom.
describe("brush cursor (#482)", () => {
  beforeEach(async () => {
    await mount();
    await act(async () => { store.setTool("brush"); store.setBrush({ size: 40, hardness: 0 }); store.setZoom(2, 0, 0); });
  });

  const cursor = () => host.querySelector('[data-testid="mv-brush-cursor"]') as HTMLElement;
  const [ring, crosshair] = [() => cursor().children[0] as HTMLElement, () => cursor().children[1] as unknown as SVGElement];
  async function hover(prefs: Partial<import("../state/preferencePanes").CursorPrefs>, init: MouseEventInit = {}) {
    await act(async () => { store.setCursorPrefs(prefs); });
    await act(async () => { fire("pointermove", 50, 60, init); });
  }

  it("rings a soft brush at its 50% falloff for Normal and at full size for Full Size", async () => {
    await hover({ painting: "normal" });
    expect(cursor().style).toMatchObject({ display: "block", width: "40px", height: "40px", left: "50px", top: "60px" });
    await hover({ painting: "full" });
    expect(cursor().style).toMatchObject({ display: "block", width: "80px", height: "80px" });
  });

  it("grows the Normal tip with hardness, and the pencil always paints hard", async () => {
    await act(async () => { store.setBrush({ hardness: 0.5 }); });
    await hover({ painting: "normal" });
    expect(cursor().style.width).toBe("60px");
    await act(async () => { store.setTool("pencil"); });
    await hover({ painting: "normal" });
    expect(cursor().style.width).toBe("80px");
  });

  it("hides the pointer under the tip, and the tip under Standard or Precise", async () => {
    await hover({ painting: "full" });
    expect(viewport.style.cursor).toBe("none");
    await hover({ painting: "precise" });
    expect(cursor().style.display).toBe("none");
    expect(viewport.style.cursor).toBe("crosshair");
    await hover({ painting: "standard" });
    expect(cursor().style.display).toBe("none");
    expect(viewport.style.cursor).toMatch(/^url\("data:image\/svg\+xml,/);
  });

  it("adds the crosshair to the tip, or shows only it while the button is down", async () => {
    await hover({ painting: "full" });
    expect(crosshair().style.display).toBe("none");
    await hover({ crosshairInTip: true });
    expect([ring().style.display, crosshair().style.display]).toEqual(["block", "block"]);
    await hover({ crosshairInTip: false, crosshairWhilePainting: true }, { buttons: 1 });
    expect([ring().style.display, crosshair().style.display]).toEqual(["none", "block"]);
    await hover({}, { buttons: 0 });
    expect([ring().style.display, crosshair().style.display]).toEqual(["block", "none"]);
  });

  it("shows the crosshair instead of an outline too small to see", async () => {
    await act(async () => { store.setBrush({ size: 1 }); store.setZoom(0.72, 0, 0); });
    await hover({ painting: "normal" });
    expect(viewport.style.cursor).toBe("none");
    expect([cursor().style.display, ring().style.display, crosshair().style.display]).toEqual(["block", "none", "block"]);
    await act(async () => { store.setBrush({ size: 40 }); });
    await hover({});
    expect([ring().style.display, crosshair().style.display]).toEqual(["block", "none"]);
  });

  it("swaps to the precise crosshair while Caps Lock is on", async () => {
    await hover({ painting: "full" }, { modifierCapsLock: true } as MouseEventInit);
    expect(cursor().style.display).toBe("none");
    expect(viewport.style.cursor).toBe("crosshair");
  });

  it("uses Other Cursors for a tool without a brush tip", async () => {
    await act(async () => { store.setTool("lasso"); });
    await hover({ other: "precise" });
    expect(cursor().style.display).toBe("none");
    expect(viewport.style.cursor).toBe("crosshair");
    await hover({ other: "standard" });
    expect(viewport.style.cursor).toMatch(/^url\(/);
  });
});

// ─────────────────────────────────────────────────────────────
// Canvas wheel (#12)
// ─────────────────────────────────────────────────────────────
// react-dom's delegated wheel listener is passive, so preventDefault() inside a
// JSX onWheel never blocks the browser's own ctrl+wheel / pinch page zoom. The
// handler must be bound natively with { passive: false } — and jsdom enforces
// the passive rule, so a regression to onWheel={…} makes these fail.
describe("canvas wheel (#12)", () => {
  beforeEach(async () => {
    await mount();
    await act(async () => { store.syncFromEngine(); store.setZoom(1, 0, 0); });
  });

  const wheel = (init: WheelEventInit) => {
    const ev = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 0, clientY: 0, ...init });
    act(() => { viewport.dispatchEvent(ev); });
    return ev;
  };

  it("cancels the browser's own ctrl+wheel page zoom and zooms the document", () => {
    const ev = wheel({ ctrlKey: true, deltaY: -100 });
    expect(ev.defaultPrevented).toBe(true);
    expect(store.state.zoom).toBeCloseTo(1.1, 10);
  });

  it("pans on a plain wheel without swallowing the event", () => {
    const ev = wheel({ deltaX: 30, deltaY: 40 });
    expect(ev.defaultPrevented).toBe(false);
    expect(store.state.panX).toBe(-30);
    expect(store.state.panY).toBe(-40);
  });

  it("unbinds on unmount", async () => {
    await act(async () => { root.unmount(); });
    const before = store.state.zoom;
    viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }));
    expect(store.state.zoom).toBe(before);
    // afterEach unmounts again; React tolerates it, and host.remove() still runs.
  });
});

// ─────────────────────────────────────────────────────────────
// Marching-ants mask view (#13) — kept as a source-level guard.
// ─────────────────────────────────────────────────────────────
// selectionMask() hands back a live view into WASM linear memory; a WASM call
// that allocates (selection_bounds → Vec<i32>) can grow the memory and detach
// that view, after which every read is undefined and the ants come out empty.
// There is no observable behaviour to assert against: the hazard only exists
// when the engine is real WASM, and any JS double keeps the "view" alive by
// construction. The ordering of the calls IS the invariant, so it is checked
// where it is expressed.
describe("marching-ants mask view (#13)", () => {
  it("takes the bounds before building the view, with no WASM call after it", () => {
    const source = readFileSync(resolve(process.cwd(), "src/canvas/CanvasView.tsx"), "utf8");
    const effect = source.slice(
      source.indexOf("// Rebuild the selection boundary list"),
      source.indexOf("boundaryRef.current = new Int32Array(pts);"),
    );
    const view = "const mask = engine.selectionMask()!;";
    expect(effect).toContain(view);
    expect(effect.indexOf("engine.e.selection_bounds()")).toBeLessThan(effect.indexOf(view));
    // …and nothing else calls into the engine between the view and the loop.
    expect(effect.slice(effect.indexOf(view) + view.length)).not.toContain("engine.");
  });
});

// ─────────────────────────────────────────────────────────────
// Interactive layer Free Transform (Selection & transform #1)
// ─────────────────────────────────────────────────────────────
// The Move tool's transform box used to be a decorative SVG with
// pointerEvents:"none" — every layer transform had to go through the blind
// numeric Free Transform dialog. The handles are now live: corner/edge to
// scale (Shift locks the aspect), the ring outside a corner to rotate, inside
// to move, Enter/Escape to commit/cancel. The frame math is the selection
// frame's; the only new maths is the box-centre → doc-centre pivot conversion
// that Engine::transform_layer needs, so that is asserted as a pure function
// against the frame it must reproduce.
describe("layer Free Transform maths", () => {
  const box = { x: 10, y: 40, w: 80, h: 20 };

  /** Where Engine::transform_layer's forward affine puts the frame corners:
   *  the same pathTransformMatrix, but pivoted on the DOC centre. */
  async function engineQuad(t: import("../state/transformControls").PathTransform, docW: number, docH: number) {
    const { layerTransformArgs } = await import("./CanvasView");
    const { pathTransformMatrix, transformPoints } = await import("../state/transformControls");
    const [sx, sy, deg, tx, ty] = layerTransformArgs(box, t, docW, docH);
    const m = pathTransformMatrix({ sx, sy, deg, tx, ty }, docW / 2, docH / 2);
    return transformPoints(
      [box.x, box.y, box.x + box.w, box.y, box.x + box.w, box.y + box.h, box.x, box.y + box.h],
      m,
    );
  }

  /** What the on-screen frame promised, flattened the same way. */
  async function frameQuad(t: import("../state/transformControls").PathTransform) {
    const { selectionFrameQuad } = await import("../state/store");
    return selectionFrameQuad(box, t).flatMap((p) => [p.x, p.y]);
  }

  it.each([
    ["identity", {}],
    ["move", { tx: 7, ty: -13 }],
    ["scale about the box centre", { sx: 2, sy: 0.5 }],
    ["rotate", { deg: 30 }],
    ["scale + rotate + move", { sx: 1.4, sy: 2.2, deg: -25, tx: 12, ty: 6 }],
  ])("bakes %s to the pixels the frame drew", async (_name, t) => {
    const got = await engineQuad(t, 200, 120);
    const want = await frameQuad(t);
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 6));
  });

  it("is the identity bake for an untouched frame", async () => {
    const { layerTransformArgs, layerFrameIsDirty } = await import("./CanvasView");
    expect(layerTransformArgs(box, {}, 200, 120)).toEqual([1, 1, 0, 0, 0]);
    expect(layerFrameIsDirty({})).toBe(false);
    expect(layerFrameIsDirty({ tx: 0.5 })).toBe(true);
  });
});

describe("layer Free Transform gesture", () => {
  // 40×20 layer at (10,10) in a 64×48 doc, at zoom 1 with no pan — so a client
  // px is a doc px and the handles sit where the pointer says they do.
  beforeEach(async () => {
    engineReturns.set("active_layer_bounds", Int32Array.from([10, 10, 40, 20]));
    engineReturns.set("width", 64);
    engineReturns.set("height", 48);
    await mount();
    await act(async () => {
      store.syncFromEngine();
      store.setTool("move");
      store.setZoom(1, 0, 0);
      store.setOptions({ showTransformControls: true });
    });
    calls.length = 0;
  });

  const quad = () => host.querySelector("[data-mv-xform-box]")!.getAttribute("points")!;
  const corners = () => quad().split(" ").map((p) => p.split(",").map(Number));
  const el = (sel: string) => host.querySelector(sel) as Element;
  const pointer = (target: Element, type: string, x: number, y: number, init: MouseEventInit = {}) =>
    act(async () => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...init }));
    });
  const key = (k: string) => act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });

  /** Drag the bottom-right handle (index 4) out to (70, 50): a 2× widen, 2× heighten. */
  async function dragBR(init: MouseEventInit = {}) {
    const h = el('[data-mv-xform-handle="4"]');
    await pointer(h, "pointerdown", 50, 30, init);
    await pointer(h, "pointermove", 70, 50, init);
    await pointer(h, "pointerup", 70, 50, init);
  }

  it("scales the frame from a corner handle instead of starting a layer move", async () => {
    await dragBR();
    // Top-left is the anchor and stays put; the box is now 80×40.
    expect(corners()[0]).toEqual([10, 10]);
    expect(corners()[2][0]).toBeCloseTo(70, 6);
    expect(corners()[2][1]).toBeCloseTo(50, 6);
    // The handle drag must NOT have been read as a Move-tool layer drag.
    expect(names()).not.toContain("move_layer_offset");
  });

  it("commits the dragged frame through transform_layer on Enter", async () => {
    await dragBR();
    expect(names()).not.toContain("xform.transformLayer");
    await key("Enter");
    const baked = lastCall("xform.transformLayer")!;
    // The 40×20 box became 60×40 with its top-left pinned: 1.5× wide, 2× tall.
    // The frame pivots on the box centre (30,20); transform_layer pivots on the
    // doc centre (32,24), d = (−2,−4), so the bake carries the (I − L)·d shift:
    // tx = 10 + (−2 − 1.5·−2) = 11, ty = 10 + (−4 − 2·−4) = 14.
    expect(baked.args[0]).toBeCloseTo(1.5, 6);
    expect(baked.args[1]).toBeCloseTo(2, 6);
    expect(baked.args[2]).toBeCloseTo(0, 6);
    expect(baked.args[3]).toBeCloseTo(11, 6);
    expect(baked.args[4]).toBeCloseTo(14, 6);
    // The frame is gone: the bake is now the layer's own bounds.
    expect(quad()).toBe("10,10 50,10 50,30 10,30");
  });

  it("throws the frame away on Escape without touching the pixels", async () => {
    await dragBR();
    await key("Escape");
    expect(names()).not.toContain("xform.transformLayer");
    expect(quad()).toBe("10,10 50,10 50,30 10,30");
  });

  it("locks the aspect ratio while Shift is held", async () => {
    // Pull the corner to (90,32): free would be 2× wide × 1.1× tall. Shift takes
    // the axis pulled hardest (x, 2×) for both, so the 2:1 box stays 2:1.
    const h = el('[data-mv-xform-handle="4"]');
    await pointer(h, "pointerdown", 50, 30, { shiftKey: true });
    await pointer(h, "pointermove", 90, 32, { shiftKey: true });
    const [w, hgt] = [corners()[2][0] - corners()[0][0], corners()[2][1] - corners()[0][1]];
    expect(w / hgt).toBeCloseTo(40 / 20, 6);
    expect(w).toBeCloseTo(80, 6);
    // …and without Shift the same pull is free-form (1.1× tall, not 2×).
    await pointer(h, "pointermove", 90, 32);
    expect(corners()[2][1] - corners()[0][1]).toBeCloseTo(22, 6);
  });

  it("moves the open frame when the drag starts inside it", async () => {
    await dragBR(); // opens the session; the frame is now 60×40 at (10,10)
    const body = el("[data-mv-xform-box]");
    await pointer(body, "pointerdown", 30, 20);
    await pointer(body, "pointermove", 35, 27);
    await pointer(body, "pointerup", 35, 27);
    expect(corners()[0]).toEqual([15, 17]);
    await key("Enter");
    const baked = lastCall("xform.transformLayer")!;
    expect(baked.args[3]).toBeCloseTo(16, 6); // 11 from the scale + 5 across
    expect(baked.args[4]).toBeCloseTo(21, 6); // 14 from the scale + 7 down
  });

  it("leaves the plain Move-tool drag alone while the frame is untouched", async () => {
    // The decorative box must not swallow the gesture that already moves the
    // layer live (with Smart Guides) — it only takes over once a transform is open.
    engineReturns.set("move_layer_offset", Int32Array.from([0, 0, 0, 0]));
    // jsdom dispatches to whatever element you name, so the hit-transparency is
    // read off the box itself; the drag below proves the tool underneath works.
    const box = () => el("[data-mv-xform-box]") as SVGElement;
    expect(box().style.pointerEvents).toBe("none");
    await act(async () => { fire("pointerdown", 30, 20); fire("pointermove", 36, 20); });
    await flushFrame();
    await act(async () => { fire("pointerup", 36, 20); });
    expect(names()).toContain("move_layer_offset");
    expect(names()).not.toContain("xform.transformLayer");
    // …and once a handle has opened a transform, the body does take the drag.
    await dragBR();
    expect(box().style.pointerEvents).toBe("auto");
  });

  it("rotates about the frame centre from the ring outside a corner", async () => {
    const ring = el('[data-mv-xform-rotate="0"]'); // outside the top-left corner
    // Centre is (30,20). Drag from due-east of it to due-south: +90°.
    await pointer(ring, "pointerdown", 40, 20);
    await pointer(ring, "pointermove", 30, 30);
    await pointer(ring, "pointerup", 30, 30);
    await key("Enter");
    const baked = lastCall("xform.transformLayer")!;
    expect(baked.args[2]).toBeCloseTo(90, 6);
    // A 90° turn about (30,20) inside a 64×48 doc pivoted at (32,24):
    // (I − R)·(−2, −4) = (−2 − 4, −4 + 2) = (−6, −2).
    expect(baked.args[3]).toBeCloseTo(-6, 6);
    expect(baked.args[4]).toBeCloseTo(-2, 6);
  });

  it("offers ✓/✕ buttons only while a frame is live", async () => {
    expect(host.querySelector("[data-mv-xform-commit]")).toBeNull();
    await dragBR();
    await act(async () => { (host.querySelector("[data-mv-xform-commit]") as HTMLButtonElement).click(); });
    expect(names()).toContain("xform.transformLayer");
    expect(host.querySelector("[data-mv-xform-commit]")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// On-canvas selection frames: Transform Selection and Content-Aware Move's
// Transform On Drop (#429) share one frame component.
// ─────────────────────────────────────────────────────────────
describe("on-canvas selection frames", () => {
  beforeEach(async () => {
    engineReturns.set("has_selection", true);
    engineReturns.set("selection_bounds", Int32Array.from([10, 10, 20, 20]));
    await mount();
    await act(async () => { store.setZoom(1, 0, 0); });
    calls.length = 0;
  });

  const el = (sel: string) => host.querySelector(sel) as Element;
  const pointer = (target: EventTarget, type: string, x: number, y: number) =>
    act(async () => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
    });
  const key = (k: string) => act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });

  describe("Transform Selection", () => {
    beforeEach(async () => {
      await act(async () => { store.beginSelectionTransform({ deg: 45 }); });
    });

    it("applies the frame to the marquee on Enter and closes it", async () => {
      expect(el("[data-mv-seltf-body]")).not.toBeNull();
      await key("Enter");
      expect(names()).toContain("transform_selection_affine");
      expect(host.querySelector("[data-mv-seltf-body]")).toBeNull();
    });

    it("closes on Escape without touching the marquee", async () => {
      await key("Escape");
      expect(names().filter((n) => n.startsWith("transform_selection"))).toEqual([]);
      expect(host.querySelector("[data-mv-seltf-body]")).toBeNull();
    });
  });

  describe("Content-Aware Move ▸ Transform On Drop", () => {
    beforeEach(async () => {
      await act(async () => {
        store.setTool("contentawaremove");
        store.setOptions({ camDrop: { box: { x: 30, y: 10, w: 20, h: 20 }, dx: 20, dy: 0, t: {} } });
      });
      calls.length = 0;
    });
    // The helpers are stubs, so nothing closes the session for them; the store
    // outlives this describe and a live drop would swallow later canvas clicks.
    afterEach(async () => { await act(async () => { store.setOptions({ camDrop: null, tool: "brush" }); }); });

    it("draws a frame with eight handles and ✓/✕ over the dropped object", () => {
      expect(el("[data-mv-camdrop-body]").getAttribute("points")).toBe("30,10 50,10 50,30 30,30");
      expect(host.querySelectorAll("[data-mv-camdrop-handle]")).toHaveLength(8);
      expect(el("[data-mv-camdrop-commit]").getAttribute("aria-label")).toBe("Apply Content-Aware Move");
      expect(el("[data-mv-camdrop-cancel]").getAttribute("aria-label")).toBe("Cancel Content-Aware Move");
    });

    it("feeds handle drags into the session", async () => {
      const h = el('[data-mv-camdrop-handle="4"]');
      await pointer(h, "pointerdown", 50, 30);
      await pointer(h, "pointermove", 70, 50);
      await pointer(h, "pointerup", 70, 50);
      const t = lastCall("updateContentAwareMoveDrop")!.args[0] as { sx: number; sy: number };
      expect(t.sx).toBeCloseTo(2, 6);
      expect(t.sy).toBeCloseTo(2, 6);
    });

    it("commits on Enter and cancels on Escape", async () => {
      await key("Enter");
      expect(names()).toEqual(["commitContentAwareMoveDrop"]);
      calls.length = 0;
      await key("Escape");
      expect(names()).toEqual(["cancelContentAwareMoveDrop"]);
    });

    it("settles the drop before a click anywhere outside the canvas reaches its target", async () => {
      await pointer(document.body, "pointerdown", 5, 5);
      expect(names()).toEqual(["commitContentAwareMoveDrop"]);
    });

    it("commits on a canvas click without starting another drag", async () => {
      await act(async () => { fire("pointerdown", 5, 5); fire("pointerup", 5, 5); });
      expect(names()).toContain("commitContentAwareMoveDrop");
      expect(names()).not.toContain("selection_bounds");
      expect(names()).not.toContain("beginContentAwareMoveDrop");
    });
  });
});

// ─────────────────────────────────────────────────────────────
// On-canvas text editor (#453)
// ─────────────────────────────────────────────────────────────
// The invisible textarea positions the caret and selection over the engine's
// glyphs, so it must measure with the font the raster paints: a run's real
// weight (a registered Semibold is not 400 wide) and its variable axes (a
// `wdth` run is a different width again), not a bold-flag 400/700 stand-in.
describe("the on-canvas text editor", () => {
  beforeEach(async () => { await mount(); });
  afterEach(async () => { await act(async () => { store.endTextEdit(); }); });

  it("measures the caret with the run's real weight and variation axes", async () => {
    engineReturns.set("layer_kind", 2); // LAYER_KIND.text
    const spec = defaultSpec("hi", { font: "Inter, sans-serif", leading: 30 });
    textSpec = { ...spec, runs: [{ text: "hi", weight: 600, axes: { wdth: 87.5 } }] } as never;
    await act(async () => { store.beginTextEdit(0, false); });
    const editor = host.querySelector('textarea[aria-label="Text layer editor"]') as HTMLTextAreaElement;
    expect(editor, "the text editor overlay never mounted").toBeTruthy();
    expect(editor.style.fontWeight).toBe("600");
    expect(editor.style.fontVariationSettings).toBe('"wdth" 87.5');
    // The leading still rides in the shorthand — a bare cssFont would drop it.
    expect(editor.style.lineHeight).toBe("30px");
    expect(editor.style.fontFamily).toBe("Inter, sans-serif");
  });
});

// Path Selection multi-select (#456)
// ─────────────────────────────────────────────────────────────
// Shift-click has to reach the store as an EXTENDING select, so two components
// end up selected and a drag then moves both.
describe("Path Selection shift-click (#456)", () => {
  beforeEach(async () => {
    await mount();
    // Zoom 1 so a pointer delta is a doc delta; a click on nothing clears the
    // selection the module-shared store may still hold from an earlier test.
    await act(async () => { store.setTool("pathselect"); store.setZoom(1, 0, 0); });
    engineReturns.set("vector_hit_test", "");
    await act(async () => { fire("pointerdown", 0, 0); fire("pointerup", 0, 0); });
    calls.length = 0;
  });

  it("extends the selection with Shift and drags every selected component", async () => {
    engineReturns.set("vector_hit_test", "p1");
    await act(async () => { fire("pointerdown", 10, 10); fire("pointerup", 10, 10); });
    expect(store.state.selectedPaths).toEqual(["p1"]);
    engineReturns.set("vector_hit_test", "p2");
    await act(async () => { fire("pointerdown", 30, 30, { shiftKey: true }); });
    expect(store.state.selectedPaths).toEqual(["p1", "p2"]);
    await act(async () => { fire("pointermove", 35, 32, { shiftKey: true }); fire("pointerup", 35, 32, { shiftKey: true }); });
    expect(calls.filter((c) => c.name === "vector_translate_item").map((c) => [c.args[1], Math.round(c.args[2] as number), Math.round(c.args[3] as number)])).toEqual([["p1", 5, 2], ["p2", 5, 2]]);
    // Released, the selection is still there for the options bar.
    expect(store.state.selectedPaths).toEqual(["p1", "p2"]);
  });

  it("replaces the selection on a plain click", async () => {
    engineReturns.set("vector_hit_test", "p1");
    await act(async () => { fire("pointerdown", 10, 10); fire("pointerup", 10, 10); });
    engineReturns.set("vector_hit_test", "p2");
    await act(async () => { fire("pointerdown", 30, 30); fire("pointerup", 30, 30); });
    expect(store.state.selectedPaths).toEqual(["p2"]);
  });
});

// ─────────────────────────────────────────────────────────────
// Clone / heal source (#484, #485)
// ─────────────────────────────────────────────────────────────
describe("the clone and heal source point", () => {
  beforeEach(async () => {
    await mount();
    engineReturns.set("stroke_begin", 1);
    await act(async () => { store.setZoom(1, 0, 0); });
  });

  it("paints Healing Brush ▸ Source: Pattern with no Alt-clicked point", async () => {
    // The pattern path takes its source from the pattern, not from a sampled
    // point — requiring one made the whole control inert until the user
    // Alt-clicked somewhere the pattern path then ignored.
    await act(async () => { store.setTool("heal"); store.setBrush({ healSource: "pattern" }); });
    await act(async () => { fire("pointerdown", 10, 20); fire("pointerup", 10, 20); });
    expect(names()).toContain("stroke_begin");
  });

  it("still needs one for Healing Brush ▸ Source: Sampled", async () => {
    await act(async () => { store.setTool("heal"); store.setBrush({ healSource: "sampled" }); });
    await act(async () => { fire("pointerdown", 10, 20); fire("pointerup", 10, 20); });
    expect(names()).not.toContain("stroke_begin");
  });

  it("binds the sampled point to its document (#427, #485)", async () => {
    // The point is raw document pixel coordinates. Reused as coordinates in the
    // next tab it would sample whatever lands there in a different image (#485),
    // so the Clone Source slot keeps its document: a stroke in another tab reads
    // the SOURCE document's pixels, and once that document closes there is
    // nothing left to sample.
    const { engine } = await import("../state/app") as unknown as { engine: { e: unknown } };
    const internal = store as unknown as { docs: unknown[]; activeDocId: number; set: (patch: Record<string, unknown>) => void };
    const activate = (id: number) => act(async () => { internal.activeDocId = id; internal.set({ activeDocId: id }); });
    internal.docs = [{ id: 1, name: "source", engine: engine.e }, { id: 2, name: "target", engine: engine.e }];
    await activate(1);
    await act(async () => { store.setTool("clone"); });
    await act(async () => { fire("pointerdown", 10, 20, { altKey: true }); fire("pointerup", 10, 20); });
    expect(store.state.cloneSources[0].source?.docId).toBe(1);

    await activate(2);
    const pixels = new Uint8Array(8);
    engineReturns.set("width", 2);
    engineReturns.set("height", 1);
    engineReturns.set("clone_source_rgba8", pixels);
    engineReturns.set("set_clone_source", true);
    calls.length = 0;
    await act(async () => { fire("pointerdown", 40, 50); fire("pointerup", 40, 50); });
    expect(lastCall("set_clone_source")?.args).toEqual([2, 1, pixels]);
    expect(names().indexOf("set_clone_source"), "pushed right before the stroke begins").toBe(names().indexOf("stroke_begin") - 1);

    await act(async () => { store.closeDoc(1); });
    calls.length = 0;
    await act(async () => { fire("pointerdown", 40, 50); fire("pointerup", 40, 50); });
    expect(names()).not.toContain("stroke_begin");
  });

  it("samples through the slot's transform, keeping identity on the integer offset (#427)", async () => {
    await act(async () => { store.setTool("clone"); store.setOptions({ cloneAligned: false }); });
    await act(async () => { fire("pointerdown", 10, 20, { altKey: true }); fire("pointerup", 10, 20); });
    const src = store.state.cloneSources[0].source!;
    calls.length = 0;
    await act(async () => { fire("pointerdown", 40, 50); fire("pointerup", 40, 50); });
    const offset = lastCall("set_clone")!.args;
    expect(offset[0]).toBe(true);
    expect(offset.slice(1).every(Number.isInteger)).toBe(true);
    expect(names()).not.toContain("set_clone_transform");

    await act(async () => { store.setCloneTransform({ w: 200, flipH: true }); });
    engineReturns.set("set_clone_transform", true);
    calls.length = 0;
    await act(async () => { fire("pointerdown", 40, 50); fire("pointerup", 40, 50); });
    const args = lastCall("set_clone_transform")!.args;
    expect(args.slice(0, 2)).toEqual([src.x, src.y]);
    expect(args.slice(4)).toEqual([200, 100, 0, true, false]);
    expect(names()).toContain("stroke_begin");

    // A transform the engine refuses never begins a stroke.
    engineReturns.set("set_clone_transform", false);
    calls.length = 0;
    await act(async () => { fire("pointerdown", 40, 50); fire("pointerup", 40, 50); });
    expect(names()).not.toContain("stroke_begin");
  });
});

// ─────────────────────────────────────────────────────────────
// Window ▸ Arrange panes (#478)
// ─────────────────────────────────────────────────────────────
// A pane is the same CanvasView with its own view transform. It must steer only
// its own zoom/pan, leave the engine hooks the main canvas owns alone, and —
// over a background document — activate that document before its tool applies
// through the pane's own mapping.
describe("Window ▸ Arrange panes", () => {
  const PANE = 7;
  let pane: HTMLElement;

  beforeEach(async () => {
    await mount([PANE]);
    pane = host.querySelectorAll(".mv-canvas-viewport")[1] as HTMLElement;
    await act(async () => { store.syncFromEngine(); store.setZoom(1, 0, 0); store.setZoom(2, 10, 20, PANE); });
    calls.length = 0;
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("zooms and pans its own view, never the main canvas's", () => {
    act(() => { pane.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 })); });
    const zoomed = store.state.paneViews[PANE];
    expect(zoomed.zoom).toBeCloseTo(2.2, 10);
    act(() => { pane.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 5, deltaY: 6 })); });
    expect(store.state.paneViews[PANE]).toMatchObject({ panX: zoomed.panX - 5, panY: zoomed.panY - 6 });
    expect(store.state).toMatchObject({ zoom: 1, panX: 0, panY: 0 });
  });

  it("leaves the live-stroke hook with the main canvas when it closes", async () => {
    const { engine } = await import("../state/app") as unknown as { engine: { onPaintRegion: unknown } };
    const { CanvasView } = await import("./CanvasView");
    await act(async () => { root.render(createElement(Fragment, null, createElement(CanvasView))); });
    expect(typeof engine.onPaintRegion).toBe("function");
  });

  it("mounts none of the active document's overlays over a background document", async () => {
    expect(pane.querySelectorAll("canvas")).toHaveLength(1); // its own pixels, nothing full-size besides
    const internal = store as unknown as { activeDocId: number; set: (p: object) => void };
    try {
      await act(async () => { internal.activeDocId = PANE; internal.set({ activeDocId: PANE }); });
      expect(pane.querySelectorAll("canvas").length).toBeGreaterThan(1);
    } finally {
      internal.activeDocId = 0;
    }
  });

  // Every engine sync republishes the document list; a 6000×4000 background
  // tile recomposited on each one turned a 95 ms commit into 2 s.
  it("recomposites a background document only when its own content changes", async () => {
    const docPixels = vi.spyOn(store, "docPixels");
    for (let i = 0; i < 5; i++) await act(async () => { store.syncFromEngine(); });
    expect(docPixels).not.toHaveBeenCalled();
    vi.spyOn(store, "docDisplayRevision").mockReturnValue(3); // a write-back into it
    await act(async () => { store.syncFromEngine(); });
    expect(docPixels).toHaveBeenCalledWith(PANE);
  });

  it("hands its canvas to the engine once on activation, not again on every sync", async () => {
    const client = (await import("../state/app") as unknown as { engine: Record<string, unknown> }).engine;
    const internal = store as unknown as { activeDocId: number; set: (p: object) => void };
    const addMirror = vi.fn();
    client.addMirror = addMirror;
    try {
      await act(async () => { internal.activeDocId = PANE; internal.set({ activeDocId: PANE }); });
      expect(addMirror).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 5; i++) await act(async () => { store.syncFromEngine(); });
      expect(store.state.activeDocId).toBe(PANE);
      expect(addMirror).toHaveBeenCalledTimes(1);
    } finally {
      delete client.addMirror;
      internal.activeDocId = 0;
    }
  });

  it("activates its background document on click, then applies the tool through its own view", async () => {
    vi.spyOn(store, "activateDoc").mockImplementation((id: number) => {
      calls.push({ name: "activateDoc", args: [id] });
      (store as unknown as { set: (p: object) => void }).set({ activeDocId: id });
    });
    await act(async () => { store.setTool("bucket"); });
    calls.length = 0;
    // Hovering a background document shows nothing of it.
    await act(async () => { store.setCursor(null); });
    await act(async () => { pane.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 30, clientY: 60 })); });
    expect(store.state.cursor).toBeNull();
    await act(async () => { pane.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 30, clientY: 60, button: 0 })); });
    expect(names().slice(0, 1)).toEqual(["activateDoc"]);
    // (30, 60) through the pane's 200% view panned to (10, 20) is document (10, 20).
    expect(lastCall("bucket_fill")?.args.slice(0, 2)).toEqual([10, 20]);
  });
});


// ─────────────────────────────────────────────────────────────
// Window ▸ Arrange float windows, main-webview side (#477)
// ─────────────────────────────────────────────────────────────
// A floated document's OS window is only a canvas: the main webview opens it,
// replays its input into an unseen view of the document — the same CanvasView
// pipeline every view runs, onto the element under the pointer — and streams
// back the pixels (only what the window lacks), the ants and the chrome.
describe("Window ▸ Arrange float windows", () => {
  const DOC = 7;
  const IMG = { width: 4, height: 2, data: new Uint8ClampedArray(32).fill(9) };
  const input = (m: object) => act(async () => { tauriListeners.get("monet://float/input")!({ payload: { doc: DOC, ...m } }); });
  const invoked = (cmd: string) => tauriCalls.filter((c) => c.cmd === cmd);
  const frames = () => invoked("plugin:float|frame").map((c) => {
    const [, kind, docW, docH, x, y, w, h] = String((c.opts as { headers: Record<string, string> }).headers["x-float-frame"]).split(",").map(Number);
    return { kind, docW, docH, x, y, w, h, body: c.args as Uint8Array };
  });
  const emitted = (name: string) => tauriCalls.filter((c) => c.cmd === `emitTo:float-${DOC}:${name}`).map((c) => c.args);
  const pointer = { button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", pressure: 0.5, tiltX: 0, tiltY: 0, deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false };
  let client: Record<string, unknown>;
  let hits: Element[] = [];
  const internal = () => store as unknown as { docs: object[]; activeDocId: number; set: (p: object) => void };
  /** Make the float's document the one the engine holds (or not). */
  const hold = (on: boolean) => act(async () => {
    internal().activeDocId = on ? DOC : 0;
    internal().set({ activeDocId: on ? DOC : 0, doc: { width: 4, height: 2, name: "float.psd" } });
  });

  beforeEach(async () => {
    await mount();
    client = (await import("../state/app") as unknown as { engine: Record<string, unknown> }).engine;
    client.docGen = 1;
    client.displayImage = () => IMG;
    internal().docs = [{ id: DOC, name: "float.psd", dirty: false, contentRevision: 0, displayRevision: 0, engine: { width: () => 4, height: () => 2 } }];
    await hold(false); // the float's document is a background one
    vi.spyOn(store, "docPixels").mockReturnValue(IMG as never);
    // jsdom lays nothing out; say what sits under the replayed pointer.
    hits = [];
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => hits;
    const { FloatWindows } = await import("../native/FloatWindows");
    await act(async () => { store.floatDoc(DOC); root.render(createElement(FloatWindows)); });
    tauriCalls.length = 0;
    calls.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    tauriCalls.length = 0;
    delete client.docGen;
    delete client.displayImage;
    delete client.selectionMask;
    internal().activeDocId = 0;
  });

  it("opens the document's window at its cascade spot, and closes it when the document goes back to the tabs", async () => {
    await act(async () => { root.render(createElement("div")); });
    const { FloatWindows } = await import("../native/FloatWindows");
    await act(async () => { root.render(createElement(FloatWindows)); });
    expect(invoked("plugin:float|open")[0]?.args).toEqual({ doc: DOC, title: "float.psd", index: 0 });
    await act(async () => { store.consolidateFloats(); });
    expect(invoked("plugin:float|close")[0]?.args).toEqual({ doc: DOC });
    expect(host.querySelector(`[data-mv-float-host="${DOC}"]`)).toBeNull();
  });

  it("paints through the window's view when its pointer is replayed, activating the document first", async () => {
    vi.spyOn(store, "activateDoc").mockImplementation((id: number) => {
      calls.push({ name: "activateDoc", args: [id] });
      (store as unknown as { set: (p: object) => void }).set({ activeDocId: id });
    });
    await input({ type: "resize", w: 300, h: 200 });
    const hidden = host.querySelector(`[data-mv-float-host="${DOC}"]`) as HTMLElement;
    expect([hidden.style.width, hidden.style.height, hidden.style.visibility]).toEqual(["300px", "200px", "hidden"]);
    await act(async () => { store.setTool("bucket"); store.setZoom(2, 10, 20, DOC); });
    calls.length = 0;
    await input({ type: "pointerdown", x: 30, y: 60, ...pointer });
    await input({ type: "pointerup", x: 30, y: 60, ...pointer, buttons: 0 });
    expect(names().slice(0, 1)).toEqual(["activateDoc"]);
    // (30, 60) in the window, through its 200% view panned to (10, 20), is document (10, 20).
    expect(lastCall("bucket_fill")?.args.slice(0, 2)).toEqual([10, 20]);
    expect(hidden.style.visibility).toBe("hidden"); // only hit-testable while replaying
  });

  it("drives the view's editors: a handle takes the press and the drag, and the ✓ its click", async () => {
    await hold(true);
    await act(async () => { internal().set({ selectionTransform: { box: { x: 0, y: 0, w: 4, h: 2 }, t: {} } }); });
    const update = vi.spyOn(store, "updateSelectionTransform");
    const commit = vi.spyOn(store, "commitSelectionTransform");
    const hidden = host.querySelector(`[data-mv-float-host="${DOC}"]`) as HTMLElement;
    const handle = hidden.querySelector('[data-mv-seltf-handle="2"]')!, ok = hidden.querySelector("[data-mv-seltf-commit]")!;
    hits = [handle];
    await input({ type: "pointerdown", x: 5, y: 5, ...pointer });
    hits = []; // the drag leaves the handle, and stays with it
    await input({ type: "pointermove", x: 40, y: 30, ...pointer });
    expect(update).toHaveBeenCalled();
    await input({ type: "pointerup", x: 40, y: 30, ...pointer, buttons: 0 });
    hits = [ok];
    await input({ type: "pointerdown", x: 1, y: 1, ...pointer });
    await input({ type: "pointerup", x: 1, y: 1, ...pointer, buttons: 0 });
    await input({ type: "click", x: 1, y: 1, ...pointer, buttons: 0 });
    expect(commit).toHaveBeenCalled();
  });

  // A crop (or ⌘0) in the window refits the view the window shows.
  it("fits the window's view on a fit request while its document is the active one", async () => {
    const { fitZoom } = await import("../state/zoomPresets");
    const view = host.querySelector(`[data-mv-float-host="${DOC}"] .mv-canvas-viewport`) as HTMLElement;
    view.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
    const kept = store.state.paneViews[DOC];
    await act(async () => { store.fit(); });
    expect(store.state.paneViews[DOC]).toBe(kept); // a background document's window keeps its view
    await hold(true);
    await act(async () => { store.setZoom(5, 0, 0, DOC); store.fit(); });
    expect(store.state.paneViews[DOC].zoom).toBeCloseTo(fitZoom(300, 200, 4, 2), 10);
  });

  it("makes the document active when its window takes focus, and takes it back to the tabs when it closes", async () => {
    const activate = vi.spyOn(store, "activateDoc").mockImplementation(() => {});
    await act(async () => { tauriListeners.get("monet://float/focus")!({ payload: DOC }); });
    expect(activate).toHaveBeenCalledWith(DOC);
    await act(async () => { tauriListeners.get("monet://float/closed")!({ payload: DOC }); });
    expect(store.state.floatDocs).toEqual([]);
    expect(store.openDocIds()).toEqual([DOC]); // still open
  });

  it("streams one frame at a time once the window listens, and the view it shows", async () => {
    await input({ type: "ready" });
    expect(frames()).toHaveLength(1);
    // A background document goes whole: its own bytes, with its size and place.
    expect(frames()[0]).toMatchObject({ kind: 0, docW: 4, docH: 2, x: 0, y: 0, w: 4, h: 2 });
    expect(frames()[0].body.buffer).toBe(IMG.data.buffer);
    expect(emitted("monet://float/view")).toHaveLength(1);

    // A background repaint is the next frame only after the window acks the last.
    vi.spyOn(store, "docDisplayRevision").mockReturnValue(99);
    await act(async () => { store.bump(); });
    expect(frames()).toHaveLength(1);
    await input({ type: "ack" });
    expect(frames()).toHaveLength(2);
  });

  // Two 6000×4000 floats took ~2.5 s per focus switch: each resent its whole
  // document although neither had changed.
  it("resends nothing on a focus switch when the window already has the pixels", async () => {
    const blit = (x: number, y: number, w: number, h: number) => {
      for (const f of client.blitListeners as Set<(...r: number[]) => void>) f(x, y, w, h);
    };
    await input({ type: "ready" });
    await input({ type: "ack" });
    expect(frames()).toHaveLength(1);

    // Activated: the engine repaints it whole — the window has that already.
    await hold(true);
    client.docGen = 2;
    await act(async () => { blit(0, 0, 4, 2); });
    // Deactivated again, nothing having changed.
    await hold(false);
    expect(frames()).toHaveLength(1);

    // A dab while it is live goes as its own rect; then a real background edit goes whole.
    await hold(true);
    client.docGen = 3;
    await act(async () => { blit(0, 0, 4, 2); blit(1, 0, 2, 1); });
    expect(frames().slice(1)).toMatchObject([{ x: 1, y: 0, w: 2, h: 1 }]);
    await input({ type: "ack" });
    await hold(false);
    expect(frames()).toHaveLength(2);
    await act(async () => { store.mutateDocEngine(DOC, () => true); });
    await input({ type: "ack" });
    expect(frames().slice(2)).toMatchObject([{ w: 4, h: 2 }]);
  });

  it("keeps restored pixels queued across batch document switches while an inverted frame is in flight", async () => {
    const revision = vi.spyOn(store, "docDisplayRevision").mockReturnValue(1);
    await hold(true);
    await input({ type: "ready" });
    await input({ type: "ack" });
    let display = { ...IMG, data: new Uint8ClampedArray(32).fill(200) };
    client.displayImage = () => display;
    const repaint = () => {
      for (const callback of client.blitListeners as Set<(...args: number[]) => void>) callback(0, 0, 4, 2);
    };
    revision.mockReturnValue(2);
    await act(async () => { repaint(); }); // inverted pixels; no ack yet
    display = { ...IMG, data: new Uint8ClampedArray(32).fill(9) };
    revision.mockReturnValue(3);
    await act(async () => { repaint(); }); // inverse restores original pixels
    await hold(false); // batch opens a different file
    await hold(true); // batch closes it and returns to this document
    client.docGen = 2;
    await act(async () => { repaint(); });
    await input({ type: "ack" });
    expect(frames().filter((frame) => frame.kind === 0).at(-1)?.body).toEqual(new Uint8Array(32).fill(9));
  });

  it("recovers from a failed hand-over instead of stopping the window for good", async () => {
    await input({ type: "ready" });
    expect(frames()).toHaveLength(1);
    failNext = true;
    vi.spyOn(store, "docDisplayRevision").mockReturnValue(5);
    await input({ type: "ack" });
    await act(async () => { store.bump(); });
    expect(frames()).toHaveLength(2); // this one fails…
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(frames()).toHaveLength(3); // …and is sent again on the next frame
  });

  it("sends the view's marching ants as the boundary, for the window to animate", async () => {
    await input({ type: "ready" });
    await input({ type: "ack" });
    client.selectionMask = () => new Uint8Array(8).fill(255);
    engineReturns.set("selection_bounds", [0, 0, 4, 2]);
    await hold(true);
    await act(async () => { internal().set({ selectionActive: true, selectionGen: 1 }); });
    await input({ type: "ack" });
    const ants = frames().find((f) => f.kind === 1)!;
    expect(ants).toBeDefined();
    // Every pixel of a 4×2 selection is on its edge: eight (x, y) pairs.
    expect([...new Int32Array(ants.body.buffer, ants.body.byteOffset, ants.body.byteLength / 4)]).toEqual([0, 0, 1, 0, 2, 0, 3, 0, 0, 1, 1, 1, 2, 1, 3, 1]);
  });

  it("keeps the selection already present when the float mounts", async () => {
    await act(async () => { root.render(createElement("div")); });
    client.selectionMask = () => new Uint8Array(8).fill(255);
    engineReturns.set("selection_bounds", [0, 0, 4, 2]);
    await hold(true);
    await act(async () => { internal().set({ selectionActive: true, selectionGen: 1 }); });
    const { FloatWindows } = await import("../native/FloatWindows");
    await act(async () => { root.render(createElement(FloatWindows)); });
    tauriCalls.length = 0;
    await input({ type: "ready" });
    await input({ type: "ack" });
    expect(frames().some((f) => f.kind === 1 && f.body.byteLength > 0)).toBe(true);
  });

  it("does not replay a background float's stale keys or textEnd into another document", async () => {
    const end = vi.spyOn(store, "endTextEdit");
    const key = vi.fn();
    document.body.addEventListener("keydown", key);
    try {
      await input({ type: "textEnd" });
      await input({ type: "keydown", key: "z", code: "KeyZ", ...pointer });
      expect(end).not.toHaveBeenCalled();
      expect(key).not.toHaveBeenCalled();
      await hold(true);
      await input({ type: "keydown", key: "z", code: "KeyZ", ...pointer });
      expect(key).toHaveBeenCalledTimes(1);
    } finally { document.body.removeEventListener("keydown", key); }
  });

  it("streams Quick Mask pixels, refreshes during a dab, and clears the overlay on exit", async () => {
    const images = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      const pixels = () => {
        if (images.get(this)?.length !== this.width * this.height * 4) images.set(this, new Uint8ClampedArray(this.width * this.height * 4));
        return images.get(this)!;
      };
      return new Proxy({
        createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (img: ImageData) => pixels().set(img.data),
        clearRect: () => pixels().fill(0),
        drawImage: (source: HTMLCanvasElement) => { const data = images.get(source); if (data) pixels().set(data); },
        getImageData: () => ({ width: this.width, height: this.height, data: pixels().slice() }),
      }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) }) as never;
    });
    const mask = new Uint8Array(8);
    client.quickMaskBuffer = () => mask;
    await hold(true);
    await input({ type: "ready" });
    await input({ type: "ack" });
    await act(async () => { internal().set({ quickMask: true, quickMaskGen: 1 }); });
    await input({ type: "ack" });
    const first = frames().filter((f) => f.kind === 2).at(-1)!;
    expect(first).toMatchObject({ docW: 4, docH: 2, w: 4, h: 2 });
    expect(first.body[3]).toBeGreaterThan(0);
    mask[0] = 255;
    await act(async () => {
      for (const callback of client.blitListeners as Set<(...args: number[]) => void>) callback(0, 0, 1, 1);
    });
    await input({ type: "ack" });
    await input({ type: "ack" });
    expect(frames().filter((f) => f.kind === 2).at(-1)!.body[3]).toBe(0);
    await act(async () => { internal().set({ quickMask: false }); });
    await input({ type: "ack" });
    expect(frames().filter((f) => f.kind === 2).at(-1)).toMatchObject({ docW: 0, docH: 0, body: new Uint8Array(0) });
    delete client.quickMaskBuffer;
  });

  it("mirrors the view's editing chrome and open text edit, and types what the window's field holds", async () => {
    await hold(true);
    engineReturns.set("layer_kind", 2);
    textSpec = { ...defaultSpec(), ax: 1, ay: 1, runs: [{ text: "Lorem" }] };
    await act(async () => { internal().set({ selectionTransform: { box: { x: 0, y: 0, w: 4, h: 2 }, t: {} }, textEdit: { id: 3, fresh: true } }); });
    await act(async () => { await Promise.resolve(); });
    const overlay = emitted("monet://float/overlay").at(-1) as { html: string; text: { id: number; fresh: boolean; value: string; css: string } };
    expect(overlay.html).toContain("data-mv-seltf-handle");
    expect(overlay.html).not.toContain("<canvas");
    expect(overlay.text).toMatchObject({ id: 3, fresh: true });
    expect(overlay.text.css).toContain("position: absolute");

    textCalls.length = 0;
    await input({ type: "text", value: "hi", revision: 3 });
    expect(textCalls.map((c) => c.name)).toEqual(["get", "setText", "apply"]);
    expect((emitted("monet://float/overlay").at(-1) as { text: { revision: number } }).text.revision).toBe(3);
    textCalls.length = 0;
    await input({ type: "text", value: "stale", revision: 2 });
    expect(textCalls.some((c) => c.name === "apply")).toBe(false);
    const end = vi.spyOn(store, "endTextEdit");
    await input({ type: "textEnd" });
    expect(end).toHaveBeenCalled();
  });

  it("mirrors every cursor preference and updates a stationary float pointer after size, zoom and tool changes", async () => {
    await hold(true);
    await act(async () => {
      store.setTool("brush"); store.setBrush({ size: 40, hardness: 0 }); store.setZoom(2, 0, 0, DOC);
      store.setCursorPrefs({ painting: "full", crosshairInTip: false, crosshairWhilePainting: false });
    });
    await input({ type: "pointermove", x: 40, y: 30, ...pointer, buttons: 0 });
    const cursor = () => (emitted("monet://float/overlay").at(-1) as import("../native/floatProtocol").FloatOverlay).cursor!;
    const tip = document.createElement("div");
    const read = () => { tip.style.cssText = cursor().tipCss; tip.innerHTML = cursor().tipHtml; return tip; };
    expect(cursor().css).toBe("none");
    expect(read().style).toMatchObject({ display: "block", width: "80px", height: "80px" });
    await act(async () => { store.setCursorPrefs({ painting: "normal", crosshairInTip: true }); });
    expect(read().style.width).toBe("40px");
    expect((tip.lastElementChild as SVGElement).style.display).toBe("block");
    await act(async () => { store.setBrush({ size: 60 }); store.setZoom(3, 0, 0, DOC); });
    expect(read().style.width).toBe("90px");
    await act(async () => { store.setCursorPrefs({ painting: "precise" }); });
    expect(cursor().css).toBe("crosshair");
    expect(read().style.display).toBe("none");
    await act(async () => { store.setCursorPrefs({ painting: "standard" }); });
    expect(cursor().css).toMatch(/^url\(/);
    await act(async () => { store.setTool("lasso"); store.setCursorPrefs({ other: "precise" }); });
    expect(cursor().css).toBe("crosshair");
    await act(async () => { store.setCursorPrefs({ other: "standard" }); });
    expect(cursor().css).toMatch(/^url\(/);
    await act(async () => { store.setTool("brush"); store.setCursorPrefs({ painting: "full", crosshairWhilePainting: true }); });
    await input({ type: "pointermove", x: 40, y: 30, ...pointer });
    read();
    expect((tip.firstElementChild as HTMLElement).style.display).toBe("none");
    expect((tip.lastElementChild as SVGElement).style.display).toBe("block");
  });
});

type StoreInternal = {
  docs: Record<string, unknown>[];
  activeDocId: number;
  set: (patch: Record<string, unknown>) => void;
};
const internalStore = () => store as unknown as StoreInternal;

function resetIssueState() {
  const internal = internalStore();
  internal.docs = [];
  internal.activeDocId = 0;
  internal.set({
    documents: [],
    activeDocId: 0,
    ready: false,
    tool: "brush",
    patternPreview: false,
    maskView: "off",
    showTransformControls: false,
    doc: { width: 0, height: 0, name: "Untitled" },
    fg: { h: 0, s: 0, v: 0, a: 1 },
    penPath: [],
    penAnchors: [],
    penContours: [],
    textEdit: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    rotationAngle: 0,
    pixelAspect: 1,
    pixelAspectCorrection: true,
    activeLayerId: 0,
    camDrop: null,
    selectionTransform: null,
    spacePan: false,
    paintSymmetryTransforming: false,
    showTargetPath: true,
    showExtras: true,
    picked: null,
  });
}

function sizeOf(el: Element, w: number, h: number) {
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => w });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => h });
}

const sceneAt = (x: number) => JSON.stringify({
  layers: [{
    items: [{
      id: "p1",
      geometry: {
        closed: true,
        anchors: [
          { point: { x, y: 0 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { point: { x: x + 40, y: 0 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { point: { x: x + 40, y: 30 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
        ],
      },
    }],
  }],
});

describe("eyedropper sampling", () => {
  beforeEach(async () => { resetIssueState(); await mount(); });
  afterEach(() => { resetIssueState(); });

  it("paints a transparent or partial sample at full foreground alpha and keeps a chosen alpha", async () => {
    engineReturns.set("pick_sample", 0x11223300);
    await act(async () => { store.setTool("dropper"); });
    await act(async () => { fire("pointerdown", 4, 4); });
    expect(store.state.fg.a).toBe(1);
    expect(store.state.picked).toMatchObject({ r: 0x11, g: 0x22, b: 0x33, a: 0 });

    await act(async () => { store.setForeground({ ...store.state.fg, a: 0.4 }); });
    engineReturns.set("pick_sample", 0x11223380);
    await act(async () => { fire("pointerdown", 4, 4); });
    expect(store.state.fg.a).toBe(0.4);
    expect(store.state.picked).toMatchObject({ r: 0x11, g: 0x22, b: 0x33, a: 128 });
  });

  it("samples with Alt+brush and does not start a stroke", async () => {
    engineReturns.set("pick_sample", 0x11223380);
    engineReturns.set("stroke_begin", 1);
    await act(async () => {
      store.setForeground({ h: 0, s: 0, v: 0, a: 0.4 });
      store.setTool("brush");
    });
    calls.length = 0;
    await act(async () => { fire("pointerdown", 4, 4, { altKey: true }); });
    expect(names()).not.toContain("stroke_begin");
    expect(store.state.fg.a).toBe(0.4);
    expect(store.state.picked?.a).toBe(128);
  });
});

describe("the first positive viewport fits, then locks", () => {
  afterEach(() => { resetIssueState(); });

  it("fits a cold document twice before the frame lock and ignores a later resize", async () => {
    const queued: FrameRequestCallback[] = [];
    const real = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    }) as typeof requestAnimationFrame;
    try {
      await mount();
      queued.length = 0;
      internalStore().set({ doc: { width: 200, height: 100, name: "cold" }, rotationAngle: 0, pixelAspect: 1, pixelAspectCorrection: true });
      const ro = resizeObservers.find((entry) => entry.el === viewport);
      expect(ro).toBeTruthy();
      const fireSize = async (w: number, h: number) => {
        sizeOf(viewport, w, h);
        await act(async () => { ro!.cb([], {} as ResizeObserver); });
      };
      await fireSize(0, 0);
      expect(store.state.zoom).toBe(1);
      await fireSize(900, 600);
      const first = fitOrientedView(900, 600, 200, 100, 0, 1);
      expect(store.state.zoom).toBeCloseTo(first.zoom, 5);
      expect(store.state.panX).toBeCloseTo(first.panX, 5);
      await fireSize(1000, 800);
      const second = fitOrientedView(1000, 800, 200, 100, 0, 1);
      expect(store.state.zoom).toBeCloseTo(second.zoom, 5);
      await act(async () => {
        const raf1 = queued.shift();
        raf1?.(0);
        const raf2 = queued.pop();
        raf2?.(0);
      });
      await fireSize(400, 300);
      expect(store.state.zoom).toBeCloseTo(second.zoom, 5);
      await fireSize(0, 0);
      expect(store.state.zoom).toBeCloseTo(second.zoom, 5);
    } finally {
      globalThis.requestAnimationFrame = real;
    }
  });

  it("fits an arrange pane once", async () => {
    internalStore().docs = [{ id: 7, engine: { width: () => 200, height: () => 100 } }];
    await mount([7]);
    const pane = host.querySelectorAll(".mv-canvas-viewport")[1];
    const ro = resizeObservers.find((entry) => entry.el === pane);
    expect(ro).toBeTruthy();
    const zoom = () => store.state.paneViews[7]?.zoom;
    sizeOf(pane, 500, 400);
    await act(async () => { ro!.cb([], {} as ResizeObserver); });
    const fitted = fitOrientedView(500, 400, 200, 100, 0, 1);
    expect(zoom()).toBeCloseTo(fitted.zoom, 5);
    sizeOf(pane, 800, 200);
    await act(async () => { ro!.cb([], {} as ResizeObserver); });
    expect(zoom()).toBeCloseTo(fitted.zoom, 5);
  });
});

describe("mask and pattern previews", () => {
  afterEach(() => { resetIssueState(); });

  it("paints a gray mask as opaque gray and a rubylith mask with the quick-mask pixel", async () => {
    resetIssueState();
    engineReturns.set("layer_mask_gray", new Uint8Array([10, 20, 30, 40]));
    internalStore().set({ ready: true, maskView: "gray", doc: { width: 2, height: 2, name: "mask" } });
    await mount();
    const gray = putImages.at(-1);
    expect(gray?.[0]).toBe(10);
    expect(gray?.[1]).toBe(10);
    expect(gray?.[2]).toBe(10);
    expect(gray?.[3]).toBe(255);
    putImages.length = 0;
    engineReturns.set("layer_mask_gray", new Uint8Array([128, 0, 0, 0]));
    await act(async () => { internalStore().set({ maskView: "rubylith" }); });
    const ruby = putImages.at(-1);
    const px = quickMaskPixel(128);
    expect(ruby?.[0]).toBe(px.r);
    expect(ruby?.[1]).toBe(px.g);
    expect(ruby?.[2]).toBe(px.b);
    expect(ruby?.[3]).toBe(px.a);
  });

  it("repaints the mask overlay on a paint and on a density or undo sync without toggling the mode", async () => {
    resetIssueState();
    engineReturns.set("layer_mask_gray", new Uint8Array([10, 20, 30, 40]));
    internalStore().set({ ready: true, maskView: "gray", doc: { width: 2, height: 2, name: "mask" } });
    await mount();
    expect(putImages.at(-1)?.[0]).toBe(10);

    putImages.length = 0;
    engineReturns.set("layer_mask_gray", new Uint8Array([80, 90, 100, 110]));
    await act(async () => { engine.onPaintRegion?.(1, 0, 1, 1); });
    expect(store.state.maskView).toBe("gray");
    expect(putImages.some((img) => img[0] === 80 && img[4] === 90 && img[3] === 255)).toBe(true);

    putImages.length = 0;
    engineReturns.set("layer_mask_gray", new Uint8Array([200, 210, 220, 230]));
    await act(async () => {
      internalStore().set({ doc: { width: 2, height: 2, name: "mask" } });
    });
    expect(store.state.maskView).toBe("gray");
    expect(putImages.some((img) => img[0] === 200 && img[4] === 210 && img[3] === 255)).toBe(true);
  });

  it("clears each pattern tile before drawing it, including after a paint region", async () => {
    resetIssueState();
    internalStore().set({ ready: true, patternPreview: true, doc: { width: 8, height: 8, name: "pattern" } });
    await mount();
    const paired = () => ctxCalls.some((name, i) => name === "clearRect" && ctxCalls[i + 1] === "drawImage");
    expect(paired()).toBe(true);
    ctxCalls.length = 0;
    await act(async () => { engine.onPaintRegion?.(0, 0, 4, 4); });
    expect(paired()).toBe(true);
  });
});

describe("pen anchors follow the active document", () => {
  afterEach(() => { resetIssueState(); });

  it("restores the new document's anchors and closes that path", async () => {
    const anchors = (points: [number, number][]) => points.flatMap(([x, y]) => [x, y, 0, 0, 0, 0]);
    const doc = (id: number, points: [number, number][]) => ({
      id, name: `doc-${id}`, engine: null, savedPath: null,
      zoom: 1, panX: 0, panY: 0, rotationAngle: 0, historyLabels: [], dirty: false,
      notes: [], activeNoteId: 0, nextNoteId: 1, layerComps: [], guides: [],
      resolutionPpi: 72, pixelAspect: 1, pixelAspectCorrection: true,
      savedPaths: [], penPath: points.flatMap(([x, y]) => [x, y]), penAnchors: anchors(points), penContours: [],
      vanishingPointPlanes: [{ quad: [1, 1, 9, 1, 9, 9, 1, 9], parent: null, edge: 0, angle: 90 }],
      vanishingPointActivePlane: 0, vanishingPointSource: null,
      measureScale: { px: 1, units: 1, unit: "px" },
      layerColorLabels: {},
      timeline: { fps: 12, durationS: 3, keys: [] },
      playhead: 0,
    });
    const a = anchors([[0, 0], [20, 0], [20, 30]]);
    resetIssueState();
    const internal = internalStore();
    internal.docs = [doc(1, [[0, 0], [20, 0], [20, 30]]), doc(2, [[5, 6], [15, 6], [15, 40]])];
    internal.activeDocId = 1;
    internal.set({
      ready: true,
      doc: { width: 100, height: 80, name: "doc-1" },
      activeDocId: 1,
      penAnchors: a,
      penPath: [0, 0, 20, 0, 20, 30],
      documents: [
        { id: 1, name: "doc-1", dirty: false, hasFile: false },
        { id: 2, name: "doc-2", dirty: false, hasFile: false },
      ],
    });
    engine.activate = () => { internal.set({ activeDocId: internal.activeDocId }); };
    await mount();
    await act(async () => { store.setTool("pen"); });
    const circles = () => [...host.querySelectorAll("[data-mv-pen-anchor]")].map((node) => [node.getAttribute("cx"), node.getAttribute("cy")]);
    expect(circles()[0]).toEqual(["0", "0"]);
    await act(async () => { store.activateDoc(2); });
    expect(circles().map((pair) => pair.map(Number))).toEqual([[5, 6], [15, 6], [15, 40]]);
    calls.length = 0;
    await act(async () => { viewport.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    const polygon = lastCall("select_polygon");
    const xs = polygon?.args[0] as Float32Array;
    expect(xs[0]).toBe(5);
    expect(xs[1]).toBe(15);
  });
});

describe("a path drag redraws the outline", () => {
  beforeEach(async () => { await mount(); });
  afterEach(() => { resetIssueState(); });

  it("reads the scene again when the drag bumps the vector revision", async () => {
    resetIssueState();
    internalStore().docs = [];
    engineReturns.set("layer_kind", 3);
    engineReturns.set("vector_scene_json", sceneAt(0));
    engineReturns.set("vector_hit_test", "p1");
    await act(async () => {
      internalStore().set({ ready: true, doc: { width: 80, height: 60, name: "path" } });
      store.setTool("pathselect");
      store.setZoom(1, 0, 0);
    });
    const outline = () => host.querySelector("[data-mv-vector-paths] path")?.getAttribute("d") ?? "";
    expect(outline()).toContain("M 0 0");
    await act(async () => { fire("pointerdown", 0, 0); });
    engineReturns.set("vector_scene_json", sceneAt(12));
    await act(async () => { fire("pointermove", 5, 0); });
    expect(outline()).toContain("M 12 0");
  });
});

describe("a layer transform does not bake into a different document", () => {
  beforeEach(async () => { await mount(); });
  afterEach(() => { resetIssueState(); });

  it("ignores Enter after the active document changed and applies it when the document is still the owner", async () => {
    resetIssueState();
    engineReturns.set("active_layer_bounds", Int32Array.from([10, 10, 40, 30]));
    await act(async () => {
      store.setTool("move");
      internalStore().set({
        ready: true,
        showTransformControls: true,
        doc: { width: 100, height: 80, name: "xform" },
      });
    });
    const handle = host.querySelector("[data-mv-xform-handle]") as Element;
    expect(handle).toBeTruthy();
    const pointer = (type: string, x: number, y: number) => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
    await act(async () => { pointer("pointerdown", 10, 10); pointer("pointermove", 80, 80); pointer("pointerup", 80, 80); });
    expect(host.querySelector("[data-mv-xform-commit]")).toBeTruthy();
    calls.length = 0;
    const previous = store.state.activeDocId;
    store.state.activeDocId = 9;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(names()).not.toContain("xform.transformLayer");
    store.state.activeDocId = previous;
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(names()).toContain("xform.transformLayer");
  });
});

describe("mixed horizontal scales position the on-canvas caret", () => {
  beforeEach(async () => { await mount(); });
  afterEach(async () => {
    await act(async () => { store.endTextEdit(); });
    resetIssueState();
  });

  it("scales a uniform run with CSS and does not measure a caret layout", async () => {
    engineReturns.set("layer_kind", 2);
    textSpec = { ...defaultSpec("AB", { hScale: 2, kind: "paragraph", boxW: 100, boxH: 40 }) } as never;
    await act(async () => {
      internalStore().set({ ready: true, doc: { width: 200, height: 100, name: "type" } });
      store.beginTextEdit(0, false);
    });
    const editor = host.querySelector("textarea.mv-text-edit") as HTMLTextAreaElement;
    expect(editor.style.transform).toBe("scaleX(2)");
    expect(editor.style.width).toBe("50px");
    expect(host.querySelector("[data-mv-text-caret]")).toBeNull();
  });

  it("places the caret from the laid-out boundaries when the runs disagree", async () => {
    engineReturns.set("layer_kind", 2);
    const spec = {
      ...defaultSpec("AB"),
      runs: [{ text: "A", hScale: 2 }, { text: "B", hScale: 1 }],
    };
    textSpec = spec as never;
    await act(async () => {
      internalStore().set({ ready: true, doc: { width: 200, height: 100, name: "type" } });
      store.beginTextEdit(0, false);
    });
    const editor = host.querySelector("textarea.mv-text-edit") as HTMLTextAreaElement;
    expect(editor.style.caretColor).toBe("transparent");
    const xs = pointTypeCaretXs(spec);
    const caret = () => host.querySelector("[data-mv-text-caret]") as HTMLElement;
    // Opening an existing layer parks the textarea at the end. Place the caret
    // through the same pointer path a click uses, so the overlay is not racing
    // that initial selection.
    await act(async () => {
      editor.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: xs[0] - 1, clientY: 0 }));
    });
    expect(editor.selectionStart).toBe(0);
    expect(parseFloat(caret().style.left)).toBeCloseTo(spec.ax + xs[0], 5);
    const x = (xs[1] + xs[2]) / 2 - 0.1;
    await act(async () => {
      editor.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: 0 }));
    });
    expect(editor.selectionStart).toBe(1);
    expect(parseFloat(caret().style.left)).toBeCloseTo(spec.ax + xs[1], 5);
  });
});
