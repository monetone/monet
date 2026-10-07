import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { CAMERA_RAW_SOURCE_VERSION, defaultRecipe, type CameraRawSession, type CameraRawSource } from "./cameraRaw";
import { normalizeWorkingRecipe } from "./visionDevelopRecipe";
import { parseCameraRawXmp } from "./cameraRawSidecar";
import { Store } from "./store";

function sourceFixture(): CameraRawSource {
  return {
    version: CAMERA_RAW_SOURCE_VERSION,
    originalName: "capture.dng",
    originalPath: "/photos/capture.dng",
    sha256: "a".repeat(64),
    originalBytes: new Uint8Array([1, 2, 3, 4]),
    metadata: { make: "Monet", model: "M1", serialNumber: "serial-1" },
    recipe: normalizeWorkingRecipe(defaultRecipe()),
  };
}

function makeStore(): Store {
  return new Store({ engine: null, onCommit: null, lastBrush: [] } as never);
}

describe("Camera Raw ownership boundaries", () => {
  it("returns a defensive session snapshot without exposing its freeable engine", () => {
    const store = makeStore();
    const source = sourceFixture();
    const session: CameraRawSession = {
      sessionId: "camera-raw-1",
      invocation: "raw-open",
      disposition: "pending",
      source,
    };
    const liveEngine = { free: vi.fn() };
    const internal = store as unknown as { cameraRawSessions: Map<string, unknown> };
    internal.cameraRawSessions.set(session.sessionId, {
      state: session,
      engine: liveEngine,
      completion: Promise.resolve("cancelled"),
      resolveCompletion: vi.fn(),
    });

    const snapshot = store.cameraRawSession(session.sessionId);
    expect(snapshot).not.toHaveProperty("engine");
    expect(snapshot?.session.source?.originalBytes).not.toBe(source.originalBytes);
    snapshot!.session.source!.originalBytes[0] = 99;
    snapshot!.session.source!.recipe.basic.exposure = 2;
    expect(source.originalBytes[0]).toBe(1);
    expect(source.recipe.basic.exposure).toBe(0);
  });

  it("re-edit and DNG export snapshots never expose or clone project-owned RAW bytes", () => {
    const store = makeStore();
    const source = sourceFixture();
    Object.defineProperty(source.originalBytes, "slice", {
      value: () => { throw new Error("Camera bytes must not be cloned"); },
    });
    const docEngine = {
      layer_count: () => 1,
      layer_id_at: () => 7,
      layer_kind: () => 7,
      smart_filter_count: () => 0,
    };
    const internal = store as unknown as { docs: unknown[] };
    internal.docs = [{ id: 4, engine: docEngine, cameraRaw: source, cameraRawLayerId: 7 }];

    const target = store.cameraRawTarget(4, 7);
    expect(target?.source?.originalByteLength).toBe(source.originalBytes.length);
    expect(target?.source).not.toHaveProperty("originalBytes");
    expect(target?.source?.metadata).not.toBe(source.metadata);
    expect(target?.source?.recipe).not.toBe(source.recipe);
    target!.source!.metadata.make = "changed";
    target!.source!.recipe.basic.exposure = 1;
    expect(source.metadata.make).toBe("Monet");
    expect(source.recipe.basic.exposure).toBe(0);

    const exported = store.cameraRawExportSnapshotForDoc(4);
    expect(exported).toEqual({
      metadata: { make: "Monet", model: "M1", serialNumber: "serial-1" },
      xmp: expect.any(String),
    });
    expect(exported).not.toHaveProperty("source");
    expect(parseCameraRawXmp(exported.xmp!)?.source.originalByteLength).toBe(source.originalBytes.length);
    expect(store).not.toHaveProperty("readCameraRawSourceForDoc");
  });
});
