// VIS-LS-02: a smart filter is an individually editable row, not a name in a
// list. The engine half (render, reorder, persistence) lives in the Rust tests
// (mod.rs › hiding_one_filter_renders_the_rest_of_the_stack et al.); this pins
// the store seam the Layers panel drives — ordering, the Camera Raw exception,
// the write guards, and graceful degradation on a wasm build that predates the
// per-filter exports (the SamEngine feature-detection pattern).
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { CAMERA_RAW_FID, Store } from "./store";
import { LAYER_KIND } from "./engineContracts";

const SMART_ID = 7;
const PIXEL_ID = 9;

type Row = { fid: number; params: number[]; enabled: boolean; blend: number; opacity: number };

// A smart object carrying Gaussian Blur, Camera Raw and Unsharp Mask, plus one
// ordinary pixel layer. `full` off drops the per-filter exports, standing in for
// a wasm binary built before this feature.
function storeWith(full = true) {
  const stack: Row[] = [
    { fid: 0, params: [4], enabled: true, blend: 0, opacity: 1 },
    { fid: CAMERA_RAW_FID, params: new Array(1086).fill(0), enabled: true, blend: 0, opacity: 1 },
    { fid: 3, params: [2, 100, 0], enabled: false, blend: 3, opacity: 0.5 },
  ];
  const update = vi.fn<(...args: unknown[]) => void>();
  const base = {
    layer_count: () => 2,
    layer_id_at: (i: number) => [SMART_ID, PIXEL_ID][i],
    layer_kind: (id: number) => (id === SMART_ID ? LAYER_KIND.smartObject : LAYER_KIND.pixel),
    smart_filter_count: (id: number) => (id === SMART_ID ? stack.length : 0),
    smart_filter_params: (id: number, index: number) =>
      Float32Array.from(id === SMART_ID ? stack[index]?.params ?? [] : []),
    smart_update_filter: update,
  };
  const perFilter = {
    smart_filter_id: (_id: number, index: number) => stack[index]?.fid ?? -1,
    smart_filter_enabled: (_id: number, index: number) => stack[index]?.enabled ?? true,
    smart_filter_blend_mode: (_id: number, index: number) => stack[index]?.blend ?? 0,
    smart_filter_opacity: (_id: number, index: number) => stack[index]?.opacity ?? 1,
    set_smart_filter_enabled: vi.fn<(...args: unknown[]) => void>(),
    set_smart_filter_blend: vi.fn<(...args: unknown[]) => void>(),
    smart_remove_filter: vi.fn<(...args: unknown[]) => void>(),
    smart_move_filter: vi.fn<(...args: unknown[]) => void>(),
  };
  const eng = full ? { ...base, ...perFilter } : base;
  const commit = vi.fn(() => true);
  const client = { engine: eng, e: eng, commit, onCommit: null };
  return { store: new Store(client as never), stack, update, commit, ...perFilter };
}

describe("smart filter rows (VIS-LS-02)", () => {
  it("reports one row per filter, in apply order, with its own state", () => {
    const { store } = storeWith();
    const rows = store.smartFilterRows(SMART_ID);
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.fid)).toEqual([0, CAMERA_RAW_FID, 3]);
    expect(rows[0]).toMatchObject({ enabled: true, blend: 0, opacity: 1, params: [4] });
    // The hidden, half-opacity Multiply row keeps its own blending options.
    expect(rows[2]).toMatchObject({ enabled: false, blend: 3, opacity: 0.5, params: [2, 100, 0] });
  });

  it("never hands the panel Camera Raw's 1086-float recipe as loose fields", () => {
    const { store } = storeWith();
    expect(store.smartFilterRows(SMART_ID)[1].params).toEqual([]);
  });

  it("has no rows for a layer that is not a smart object", () => {
    const { store } = storeWith();
    expect(store.smartFilterRows(PIXEL_ID)).toEqual([]);
    expect(store.smartFilterRows(4242)).toEqual([]); // absent layer
  });

  it("re-edits one parameter in place and leaves the rest of the recipe alone", () => {
    const { store, update, commit } = storeWith();
    store.setSmartFilterParam(SMART_ID, 2, 1, 60); // Unsharp Mask ▸ Amount
    expect(update).toHaveBeenCalledTimes(1);
    const [id, index, params] = update.mock.calls[0];
    expect([id, index]).toEqual([SMART_ID, 2]);
    expect(Array.from(params as Float32Array)).toEqual([2, 60, 0]);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("drops parameter writes that cannot land, without touching history", () => {
    const { store, update, commit } = storeWith();
    store.setSmartFilterParam(SMART_ID, 2, 9, 1); // no such parameter
    store.setSmartFilterParam(SMART_ID, 2, -1, 1);
    store.setSmartFilterParam(SMART_ID, 2, 0, Number.NaN);
    store.setSmartFilterParam(SMART_ID, 2, 0, 2); // already 2 — not an edit
    expect(update).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("passes per-filter edits through, clamping opacity and ignoring a null move", () => {
    const s = storeWith();
    s.store.setSmartFilterEnabled(SMART_ID, 0, false);
    s.store.removeSmartFilter(SMART_ID, 0);
    s.store.setSmartFilterBlend(SMART_ID, 0, 3, 4);
    s.store.moveSmartFilter(SMART_ID, 1, 0);
    s.store.moveSmartFilter(SMART_ID, 1, 1); // a move to itself is not an edit
    expect(s.set_smart_filter_enabled.mock.calls).toEqual([[SMART_ID, 0, false]]);
    expect(s.smart_remove_filter.mock.calls).toEqual([[SMART_ID, 0]]);
    expect(s.set_smart_filter_blend.mock.calls).toEqual([[SMART_ID, 0, 3, 1]]);
    expect(s.smart_move_filter.mock.calls).toEqual([[SMART_ID, 1, 0]]);
    expect(s.commit).toHaveBeenCalledTimes(4);
  });

  it("degrades to read-only default rows on a wasm build without the exports", () => {
    const { store, update, commit } = storeWith(false);
    const rows = store.smartFilterRows(SMART_ID);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.fid)).toEqual([-1, -1, -1]);
    expect(rows.every((r) => r.enabled && r.blend === 0 && r.opacity === 1)).toBe(true);
    // Mutators no-op instead of throwing on the missing export...
    store.setSmartFilterEnabled(SMART_ID, 0, false);
    store.removeSmartFilter(SMART_ID, 0);
    store.moveSmartFilter(SMART_ID, 0, 1);
    store.setSmartFilterBlend(SMART_ID, 0, 3, 0.5);
    expect(commit).not.toHaveBeenCalled();
    // ...while param re-editing, which predates this work, still lands.
    store.setSmartFilterParam(SMART_ID, 0, 0, 8);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
