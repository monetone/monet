// Camera Raw import options (#443): the demosaic a staged RAW decodes with and
// the depth Open develops into are persisted preferences, reachable from the
// workspace (store.setCameraRawSessionDemosaic re-decodes the staged source).
// The engine is faked; the real decode/develop is covered by the engine's
// raw_import_pipeline tests and e2e/camera-raw-workspace.spec.ts.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { CAMERA_RAW_SOURCE_VERSION } from "./cameraRaw";
import { normalizeCameraRawSource } from "./cameraRawSource";
import { Store } from "./store";

function rawEngine() {
  return {
    free: vi.fn(),
    raw_metadata_json: () => "",
    active_layer_id: () => 1,
    can_super_resolution: () => true,
    camera_raw_develop: vi.fn(),
    camera_raw_commit: vi.fn((_params: Float32Array, _float: boolean) => true),
    purge: vi.fn(),
    set_history_source: vi.fn(),
    last_edit_error: () => "",
  };
}

type RawEngine = ReturnType<typeof rawEngine>;

function makeStore(buildRaw: (bytes: Uint8Array, demosaic?: string) => RawEngine) {
  const client = { engine: null, onCommit: null, lastBrush: [], buildRaw: vi.fn(buildRaw) };
  return { store: new Store(client as never), buildRaw: client.buildRaw };
}

const bytes = () => new Uint8Array([1, 2, 3, 4]);

describe("Camera Raw demosaic choice", () => {
  it("decodes a staged RAW with the persisted demosaic and records it on the source", () => {
    const { store, buildRaw } = makeStore(() => rawEngine());
    store.setFilePrefs({ rawDemosaic: "bilinear" });
    const id = store.openRaw(bytes(), "shot.dng");
    expect(buildRaw).toHaveBeenCalledWith(expect.any(Uint8Array), "bilinear");
    expect(store.cameraRawSession(id)?.session.source?.demosaic).toBe("bilinear");
  });

  it("re-decodes the staged RAW, frees the old engine and remembers the choice", () => {
    const engines: RawEngine[] = [];
    const { store, buildRaw } = makeStore(() => { const e = rawEngine(); engines.push(e); return e; });
    const id = store.openRaw(bytes(), "shot.dng");
    expect(buildRaw).toHaveBeenLastCalledWith(expect.any(Uint8Array), "adaptive");
    const rev = store.state.cameraRawSessionsRev;

    expect(store.setCameraRawSessionDemosaic(id, "bilinear")).toBe(true);

    expect(buildRaw).toHaveBeenLastCalledWith(new Uint8Array([1, 2, 3, 4]), "bilinear");
    expect(engines[0].free).toHaveBeenCalledTimes(1);
    expect(store.cameraRawWorkspaceSession(id)?.engine).toBe(engines[1]);
    expect(store.cameraRawSession(id)?.session.source?.demosaic).toBe("bilinear");
    expect(store.state.filePrefs.rawDemosaic).toBe("bilinear");
    expect(store.state.cameraRawSessionsRev).toBeGreaterThan(rev);

    // Choosing the method the source already has does not decode again.
    store.setCameraRawSessionDemosaic(id, "bilinear");
    expect(buildRaw).toHaveBeenCalledTimes(2);
  });

  it("leaves the session and the preference alone when the re-decode fails or the input is bad", () => {
    const first = rawEngine();
    let calls = 0;
    const { store } = makeStore(() => {
      if (calls++) throw new Error("RAW decode failed");
      return first;
    });
    const id = store.openRaw(bytes(), "shot.dng");
    expect(() => store.setCameraRawSessionDemosaic(id, "bilinear")).toThrow("RAW decode failed");
    expect(() => store.setCameraRawSessionDemosaic(id, "vng" as never)).toThrow('Unknown demosaic "vng"');
    expect(store.cameraRawWorkspaceSession(id)?.engine).toBe(first);
    expect(first.free).not.toHaveBeenCalled();
    expect(store.cameraRawSession(id)?.session.source?.demosaic).toBe("adaptive");
    expect(store.state.filePrefs.rawDemosaic).toBe("adaptive");
    expect(store.setCameraRawSessionDemosaic("missing", "bilinear")).toBe(false);
  });
});

describe("Camera Raw Open depth", () => {
  function openWithDepth(depth: 16 | 32) {
    const session = rawEngine();
    const { store } = makeStore(() => session);
    store.setFilePrefs({ rawDepth: depth });
    const id = store.openRaw(bytes(), "shot.dng");
    // Adoption into a tab is out of scope here: stand in for the private
    // document plumbing so completeCameraRawOpen reaches its engine calls.
    const fields = store as unknown as { docs: { id: number; engine: unknown }[]; activeDocId: number };
    const methods = store as unknown as Record<string, (...args: unknown[]) => unknown>;
    const docs: { id: number; engine: unknown }[] = [];
    fields.docs = docs;
    vi.spyOn(methods, "finalizeActiveDocumentForAdoption").mockReturnValue(true);
    vi.spyOn(methods, "documentAdoptionCheckpoint").mockReturnValue({});
    vi.spyOn(methods, "dirtyEntry").mockImplementation(() => undefined);
    vi.spyOn(methods, "docSummaries").mockReturnValue([]);
    vi.spyOn(methods, "addDoc").mockImplementation((eng: unknown) => {
      docs.push({ id: 7, engine: eng });
      fields.activeDocId = 7;
    });
    const recipe = store.cameraRawSessionWorking(id)!;
    expect(store.completeCameraRawOpen(id, recipe, false)).toBe(7);
    return { session, docs };
  }

  it("opens a 32-bit float document when the depth preference says so", () => {
    const { session, docs } = openWithDepth(32);
    expect(session.camera_raw_develop).toHaveBeenCalledTimes(1);
    const params = session.camera_raw_develop.mock.calls[0][0];
    expect(session.camera_raw_commit).toHaveBeenCalledWith(params, true);
    expect((docs[0] as unknown as { cameraRaw: { depth?: number } }).cameraRaw.depth).toBe(32);
  });

  it("releases the RAW headroom and stays 16-bit by default", () => {
    const { session, docs } = openWithDepth(16);
    const params = session.camera_raw_develop.mock.calls[0][0];
    expect(session.camera_raw_commit).toHaveBeenCalledWith(params, false);
    expect((docs[0] as unknown as { cameraRaw: { depth?: number } }).cameraRaw.depth).toBeUndefined();
  });
});

describe("File ▸ Revert of a RAW document", () => {
  it("rebuilds with the demosaic and depth the RAW was opened with", () => {
    const rebuilt = rawEngine();
    const { store, buildRaw } = makeStore(() => rebuilt);
    const fields = store as unknown as { docs: unknown[]; activeDocId: number };
    const methods = store as unknown as Record<string, (...args: unknown[]) => unknown>;
    const source = normalizeCameraRawSource({
      version: CAMERA_RAW_SOURCE_VERSION,
      originalName: "shot.dng",
      originalBytes: bytes(),
      metadata: {},
      demosaic: "bilinear",
      depth: 32,
    })!;
    fields.docs = [{ id: 3, engine: rawEngine(), cameraRaw: source, cameraRawLayerId: null }];
    fields.activeDocId = 3;
    vi.spyOn(methods, "docDocumentMeta").mockReturnValue({ colorProfileAssigned: true });
    const revert = vi.spyOn(methods, "revertActiveDoc").mockImplementation(() => undefined);

    expect(store.revertActiveCameraRawSource()).toBe(true);
    expect(buildRaw).toHaveBeenCalledWith(source.originalBytes, "bilinear");
    const params = rebuilt.camera_raw_develop.mock.calls[0][0];
    expect(rebuilt.camera_raw_commit).toHaveBeenCalledWith(params, true);
    expect(revert).toHaveBeenCalledWith(rebuilt, expect.anything());
  });
});

describe("File ▸ Revert of a pre-#443 RAW document", () => {
  it("rebuilds through the 3×3 average without highlight headroom", () => {
    const rebuilt = rawEngine();
    const { store, buildRaw } = makeStore(() => rebuilt);
    const fields = store as unknown as { docs: unknown[]; activeDocId: number };
    const methods = store as unknown as Record<string, (...args: unknown[]) => unknown>;
    const source = normalizeCameraRawSource({
      version: CAMERA_RAW_SOURCE_VERSION,
      originalName: "old.dng",
      originalBytes: bytes(),
      metadata: {},
    })!;
    expect(source.demosaic).toBeUndefined();
    fields.docs = [{ id: 3, engine: rawEngine(), cameraRaw: source, cameraRawLayerId: null }];
    fields.activeDocId = 3;
    vi.spyOn(methods, "docDocumentMeta").mockReturnValue({ colorProfileAssigned: true });
    vi.spyOn(methods, "revertActiveDoc").mockImplementation(() => undefined);

    expect(store.revertActiveCameraRawSource()).toBe(true);
    expect(buildRaw).toHaveBeenCalledWith(source.originalBytes, "bilinear");
    // The headroom is released before the develop reads it, then again as the
    // 16-bit Open does.
    const [first, second] = rebuilt.camera_raw_commit.mock.calls;
    expect(first).toEqual([new Float32Array(0), false]);
    expect(rebuilt.camera_raw_commit.mock.invocationCallOrder[0]).toBeLessThan(rebuilt.camera_raw_develop.mock.invocationCallOrder[0]);
    expect(second[1]).toBe(false);
  });
});

describe("persisted Camera Raw source decode fields", () => {
  it("keeps the demosaic and 32-bit depth and drops junk", () => {
    const base = {
      version: CAMERA_RAW_SOURCE_VERSION,
      originalName: "shot.dng",
      originalBytes: bytes(),
      metadata: {},
    };
    expect(normalizeCameraRawSource({ ...base, demosaic: "bilinear", depth: 32 })).toMatchObject({ demosaic: "bilinear", depth: 32 });
    const junk = normalizeCameraRawSource({ ...base, demosaic: "vng", depth: 8 })!;
    expect("demosaic" in junk).toBe(false);
    expect("depth" in junk).toBe(false);
  });
});
