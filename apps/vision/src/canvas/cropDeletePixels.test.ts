// @vitest-environment jsdom
// Crop tool ▸ Delete Cropped Pixels. `reframe_document` deliberately keeps a
// raster layer's whole plane when the canvas shrinks — that is what makes Image ▸
// Reveal All work — but it also meant a crop reclaimed NOTHING: a 200×200
// document cropped to 20×20 still saved every original pixel (measured at ~90×
// a natively-small document). Photoshop's checkbox is on by default.
//
// The engine op itself is covered by packages/engine's `delete_cropped_pixels`
// module. Here the real CanvasView is mounted over a recording engine double and
// driven with real pointer events, so the assertions are on the calls a crop
// drag actually makes — not on the shape of the source that makes them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/** Every engine call the mounted canvas makes, in order. */
const calls: { name: string; args: unknown[] }[] = [];
/** Return values for engine reads, by method name (default: 0). */
const engineReturns = new Map<string, unknown>();
/** Anything the component only pokes at (anim, text, …). */
const auto = (): never =>
  new Proxy(function () {} as never, { get: (_t, k) => (k === "then" ? undefined : auto()), apply: () => 0 }) as never;

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@monet-ui/monet-collab/react", () => ({ CollabCursors: () => null }));
vi.mock("../state/app", async () => {
  const { Store, makeUseStore } = await import("../state/store");
  const e = new Proxy({} as Record<string, unknown>, {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push({ name, args });
      return engineReturns.has(name) ? engineReturns.get(name) : 0;
    },
  });
  const engine = {
    engine: e, e,
    commit: () => { calls.push({ name: "commit", args: [] }); return true; },
    sync: () => { calls.push({ name: "sync", args: [] }); },
    blitRegion: () => {},
    onCommit: null,
    selectionMask: () => null,
  };
  const store = new Store(engine as never);
  return {
    store, engine, useStore: makeUseStore(store),
    anim: auto(), collab: null, text: auto(),
    contentAwareMoveBy: () => {}, removeStroke: () => {},
    beginContentAwareMoveDrop: () => {}, updateContentAwareMoveDrop: () => {},
    commitContentAwareMoveDrop: () => {}, cancelContentAwareMoveDrop: () => {},
  };
});

let root: Root;
let host: HTMLElement;
let store: import("../state/store").Store;

/** Mount the real CanvasView with the crop tool armed. */
async function mountCrop(): Promise<HTMLElement> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    class { observe() {} unobserve() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({}, { get: (_t, k) => () => (k === "getImageData" ? { data: new Uint8ClampedArray(4), width: 1, height: 1 } : undefined) })) as never;
  const { CanvasView } = await import("./CanvasView");
  ({ store } = await import("../state/app") as unknown as { store: import("../state/store").Store });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(CanvasView)); });
  await act(async () => {
    store.setTool("crop");
    store.setOptions({ cropDeletePixels: true, cropContentAware: false, cropAspect: "free" });
  });
  calls.length = 0;
  return host.querySelector(".mv-canvas-viewport") as HTMLElement;
}

/** Drag a crop rectangle from (x0,y0) to (x1,y1) in client px (zoom 1 → doc px). */
function cropDrag(vp: HTMLElement, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const fire = (type: string, x: number, y: number) =>
    vp.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
  return act(async () => {
    fire("pointerdown", x0, y0);
    fire("pointermove", x1, y1);
    fire("pointerup", x1, y1);
  });
}

const names = () => calls.map((c) => c.name);

afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  calls.length = 0;
  engineReturns.clear();
});

beforeAll(async () => {
  await import("./CanvasView");
  await import("../state/app");
}, 30_000);

describe("Delete Cropped Pixels is reachable and defaults on", () => {
  let vp: HTMLElement;
  beforeEach(async () => { vp = await mountCrop(); }, 20_000);

  it("the crop tool calls the engine op when the option is set", async () => {
    expect(store.state.cropDeletePixels).toBe(true);
    await cropDrag(vp, 10, 10, 100, 100);
    expect(calls.find((c) => c.name === "crop")?.args).toEqual([10, 10, 90, 90]);
    expect(names()).toContain("delete_cropped_pixels");
  });

  it("leaves the pixels alone when the option is cleared", async () => {
    await act(async () => { store.setOptions({ cropDeletePixels: false }); });
    calls.length = 0;
    await cropDrag(vp, 10, 10, 100, 100);
    expect(names()).toContain("crop");
    expect(names()).not.toContain("delete_cropped_pixels");
  });

  it("runs AFTER the crop, so it folds into that undo step", async () => {
    await cropDrag(vp, 10, 10, 100, 100);
    // The op takes no snapshot of its own; ordering plus the single commit is
    // what makes one Ctrl+Z revert the whole crop rather than leaving a
    // half-cropped document.
    expect(names().indexOf("crop")).toBeLessThan(names().indexOf("delete_cropped_pixels"));
    expect(names().indexOf("delete_cropped_pixels")).toBeLessThan(names().indexOf("commit"));
    expect(names().filter((n) => n === "commit")).toHaveLength(1);
  });

  it("still deletes behind a Content-Aware crop", async () => {
    await act(async () => { store.setOptions({ cropContentAware: true }); });
    calls.length = 0;
    await cropDrag(vp, 10, 10, 100, 100);
    expect(names()).toContain("crop_content_aware");
    expect(names()).not.toContain("crop");
    expect(names().indexOf("crop_content_aware")).toBeLessThan(names().indexOf("delete_cropped_pixels"));
  });

  it("ignores a degenerate drag entirely", async () => {
    await cropDrag(vp, 10, 10, 11, 11);
    expect(names()).not.toContain("crop");
    expect(names()).not.toContain("delete_cropped_pixels");
  });
});

describe("Delete Cropped Pixels option surface", () => {
  it("defaults to on, as Photoshop ships it", async () => {
    const { Store } = await import("../state/store");
    const fresh = new Store({ engine: {}, e: {}, commit: () => true, sync: () => {} } as never);
    expect(fresh.state.cropDeletePixels).toBe(true);
  });

  // The options-bar checkbox lives inline in App.tsx, which cannot be mounted
  // here: monet-react is a workspace source dep with its own React copy, so its
  // hooks throw "Invalid hook call" under vision's vitest resolution. The
  // behaviour the checkbox drives (setOptions → the crop honours it) is covered
  // above; this is the remaining presence-of-control guard.
  it("has an options-bar checkbox bound to the same option", () => {
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(app).toContain("store.setOptions({ cropDeletePixels: v })");
    expect(app).toContain("Delete Cropped Pixels");
  });
});
