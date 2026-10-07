// Unit tests for the Camera Raw filmstrip: the pure Synchronize-settings helper
// and the store's pending-session queue/activate/per-session-recipe methods.
// The workspace UI + switching is covered by e2e/camera-raw-workspace.spec.ts.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CAMERA_RAW_SOURCE_VERSION,
  defaultRecipe,
  normalizeCameraRawRecipe,
  paramsToRecipe,
  recipeToParams,
  syncCameraRawRecipe,
  type CameraRawSession,
  type CameraRawSource,
} from "./cameraRaw";
import { normalizeWorkingRecipe, workingRecipeToParams } from "./visionDevelopRecipe";
import { Store } from "./store";

// The frozen ABI golden decodes to a MAXIMAL canonical recipe (crop+aspect,
// calibration, heals, masks, point colours, authored curve, enhance).
const goldenParams: number[] = (JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/cameraRaw-abi-golden.json", import.meta.url)), "utf8"),
) as { params: number[] }).params;

function sourceFixture(name: string): CameraRawSource {
  return {
    version: CAMERA_RAW_SOURCE_VERSION,
    originalName: name,
    originalBytes: new Uint8Array([1, 2, 3, 4]),
    metadata: { make: "Monet", model: "M1", serialNumber: "s" },
    recipe: normalizeWorkingRecipe(defaultRecipe()),
  };
}

function makeStore(): Store {
  return new Store({ engine: null, onCommit: null, lastBrush: [] } as never);
}

type Internals = {
  cameraRawSessions: Map<string, { state: CameraRawSession; engine: { free: () => void }; completion: Promise<unknown>; resolveCompletion: () => void }>;
  cameraRawQueue: string[];
  activeCameraRawSessionId: string | null;
};

function stage(store: Store, sessionId: string, name: string, active: boolean) {
  const internal = store as unknown as Internals;
  const state: CameraRawSession = { sessionId, invocation: "raw-open", disposition: "pending", source: sourceFixture(name) };
  internal.cameraRawSessions.set(sessionId, { state, engine: { free: vi.fn() }, completion: Promise.resolve("cancelled"), resolveCompletion: vi.fn() });
  if (active) internal.activeCameraRawSessionId = sessionId;
  else internal.cameraRawQueue.push(sessionId);
}

describe("syncCameraRawRecipe", () => {
  it("copies develop groups but keeps the target's crop / spots / masks / enhance", () => {
    const src = defaultRecipe();
    src.basic.exposure = 1.5; // a develop change that must propagate
    src.crop.angle = 30; // an image-local field that must NOT propagate
    src.enhance.superResolution = true;
    const tgt = defaultRecipe();
    tgt.crop.angle = 12;
    tgt.enhance.superResolution = false;

    const out = syncCameraRawRecipe(src, tgt);
    const nsrc = normalizeCameraRawRecipe(src)!;
    const ntgt = normalizeCameraRawRecipe(tgt)!;

    // Develop groups come from the source…
    expect(out.basic.exposure).toBeCloseTo(1.5);
    expect(out.basic).toEqual(nsrc.basic);
    // …but the image-local fields stay with the target.
    expect(out.crop.angle).toBe(12);
    expect(out.crop).toEqual(ntgt.crop);
    expect(out.enhance).toEqual(ntgt.enhance);
    expect(out.healSpots).toEqual(ntgt.healSpots);
    expect(out.masks).toEqual(ntgt.masks);
  });
});

describe("Camera Raw filmstrip store methods", () => {
  it("lists pending sessions active-first, then queued", () => {
    const store = makeStore();
    stage(store, "a", "a.dng", true);
    stage(store, "b", "b.dng", false);
    stage(store, "c", "c.dng", false);
    expect(store.pendingCameraRawSessions()).toEqual([
      { sessionId: "a", name: "a.dng" },
      { sessionId: "b", name: "b.dng" },
      { sessionId: "c", name: "c.dng" },
    ]);
  });

  it("activateCameraRawSession swaps the active session and re-queues the old one", () => {
    const store = makeStore();
    stage(store, "a", "a.dng", true);
    stage(store, "b", "b.dng", false);
    stage(store, "c", "c.dng", false);

    expect(store.activateCameraRawSession("b")).toBe(true);
    const order = store.pendingCameraRawSessions().map((s) => s.sessionId);
    expect(order[0]).toBe("b"); // b is now active (listed first)
    expect(order).toContain("a"); // the previously active session survives
    expect(order).toContain("c");
    expect(new Set(order).size).toBe(3);

    expect(store.activateCameraRawSession("a")).toBe(true); // already staged → ok
    expect(store.activateCameraRawSession("nope")).toBe(false); // unknown id
    expect(store.activateCameraRawSession("a")).toBe(true); // already active → no-op true
  });

  it("setCameraRawSessionRecipe persists per-session and leaves others untouched", () => {
    const store = makeStore();
    stage(store, "a", "a.dng", true);
    stage(store, "b", "b.dng", false);

    const recipe = defaultRecipe();
    recipe.basic.exposure = 1.25;
    expect(store.setCameraRawSessionRecipe("a", recipe)).toBe(true);
    expect(store.setCameraRawSessionRecipe("missing", recipe)).toBe(false);

    const internal = store as unknown as Internals;
    expect(internal.cameraRawSessions.get("a")!.state.source!.recipe.basic.exposure).toBeCloseTo(1.25);
    expect(internal.cameraRawSessions.get("b")!.state.source!.recipe.basic.exposure).toBe(0);
  });

  it("loads a maximal OLD Canonical recipe through the working store boundary to byte-identical engine params (invariant #2)", () => {
    // OLD-file load: a stored Canonical recipe (.mvision/preset shape) set on a
    // session is migrated to the working V2 recipe and read back through the
    // session accessor; its engine params must match the Canonical codec exactly.
    const store = makeStore();
    stage(store, "a", "a.dng", true);
    const canonical = normalizeCameraRawRecipe(paramsToRecipe(goldenParams))!;
    expect(store.setCameraRawSessionRecipe("a", canonical)).toBe(true);
    const readBack = store.cameraRawSession("a")!.session.source!.recipe;
    expect(Array.from(workingRecipeToParams(readBack)))
      .toEqual(Array.from(recipeToParams(canonical)));
  });
});
