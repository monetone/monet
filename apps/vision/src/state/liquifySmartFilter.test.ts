// VIS-FX-08: Liquify on a smart object commits its displacement mesh as a
// re-editable fid-117 smart filter. The engine half (session gating, mesh
// pack/unpack, undo) lives in the Rust tests (mod.rs › liquify_smart_filter);
// this pins the store seam — the Layers panel must never copy the mesh out of
// wasm on every repaint, the way it already refuses Camera Raw's recipe.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { CAMERA_RAW_FID, LIQUIFY_MESH_FID, Store } from "./store";
import { LAYER_KIND } from "./engineContracts";

const SMART_ID = 7;

// A smart object carrying Gaussian Blur, a Liquify mesh and Camera Raw.
function storeWithMesh() {
  // 33×33 grid + the 2-float header — what a small canvas actually packs.
  const mesh = [33, 33, ...new Array(33 * 33 * 2).fill(0.01)];
  const stack = [
    { fid: 0, params: [4] },
    { fid: LIQUIFY_MESH_FID, params: mesh },
    { fid: CAMERA_RAW_FID, params: new Array(1086).fill(0) },
  ];
  const params = vi.fn<(...args: unknown[]) => Float32Array>((_id, index) =>
    Float32Array.from(stack[index as number]?.params ?? []));
  const eng = {
    layer_kind: () => LAYER_KIND.smartObject,
    layer_count: () => 1,
    layer_id_at: () => SMART_ID,
    smart_filter_count: () => stack.length,
    smart_filter_params: params,
    smart_filter_id: (_id: number, index: number) => stack[index]?.fid ?? -1,
    smart_filter_enabled: () => true,
    smart_filter_blend_mode: () => 0,
    smart_filter_opacity: () => 1,
  };
  const client = { engine: eng, e: eng, commit: vi.fn(() => true), onCommit: null };
  return { store: new Store(client as never), params, mesh };
}

describe("Liquify as a smart filter (VIS-FX-08)", () => {
  it("shows the mesh as its own stack row", () => {
    const rows = storeWithMesh().store.smartFilterRows(SMART_ID);
    expect(rows.map((r) => r.fid)).toEqual([0, LIQUIFY_MESH_FID, CAMERA_RAW_FID]);
  });

  it("never copies the mesh (or the develop recipe) out of wasm as loose fields", () => {
    const { store, params } = storeWithMesh();
    const rows = store.smartFilterRows(SMART_ID);
    expect(rows[1].params).toEqual([]);
    expect(rows[2].params).toEqual([]);
    expect(rows[0].params).toEqual([4]); // ordinary filters still expose theirs
    // The thousands-of-floats reads never even happen.
    expect(params.mock.calls.map((c) => c[1])).toEqual([0]);
  });
});
