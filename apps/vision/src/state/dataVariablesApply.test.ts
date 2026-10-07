import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@engine", () => ({ default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }), Engine: class Engine {} }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "/picked"), save: vi.fn(async () => null) }));
vi.mock("./atomicWrite", () => ({ atomicWriteBytes: vi.fn(async () => {}) }));
vi.mock("./nativeBoundedRead", () => ({ readNativeFileBounded: vi.fn() }));
import { dataVars, engine, store, setDocumentNoticeSink } from "./app";
import { atomicWriteBytes } from "./atomicWrite";
import { readNativeFileBounded } from "./nativeBoundedRead";
import type { AppSnapshot } from "./store";

let state: AppSnapshot, pushes: number, pixels: number, visible: boolean, kind: number;
let history: { pixels: number; visible: boolean; kind: number }[];
const notices: string[] = [];
const e = {
  undo_pushes: () => pushes,
  clear_last_edit_error: () => {}, last_edit_error: () => "",
  begin_history_transaction: vi.fn(() => true),
  push_history: vi.fn(() => { history.push({ pixels, visible, kind }); pushes++; }),
  set_layer_visible: vi.fn((_id: number, value: boolean) => { e.push_history(); visible = value; }),
  convert_to_smart_object: vi.fn(() => { e.push_history(); kind = 7; }),
  layer_kind: () => kind,
  replace_smart_object_preserve_placement: vi.fn((_id: number, bytes: Uint8Array) => { e.push_history(); pixels = bytes[0]; }),
  rasterize_smart_object: vi.fn(() => { e.push_history(); kind = 0; }),
  drop_last_undo: () => { history.pop(); },
  commit_history_transaction: vi.fn(() => true),
  cancel_history_transaction: vi.fn(() => { const first = history[0]; if (first) { pixels = first.pixels; visible = first.visible; kind = first.kind; } history = []; return true; }),
  export_png_with_icc: vi.fn(() => new Uint8Array([pixels])),
};

beforeEach(() => {
  pushes = 0; pixels = 1; visible = true; kind = 0; history = []; notices.length = 0;
  state = { ...store.state, activeDocId: 9, layers: [{ id: 1, name: "Photo", kind: 0, locked: false } as never], variables: [{ layer: "Photo", name: "image", type: "pixel", fit: "conform" }], dataSets: [{ image: "a.png" }], dataSetBaseDir: "/jobs", maskEdit: false, channelTarget: null, quickMask: false };
  vi.spyOn(store, "state", "get").mockImplementation(() => state);
  vi.spyOn(store, "setActiveDataSet").mockImplementation((i) => { state = { ...state, activeDataSet: i }; });
  vi.spyOn(engine, "buildImage").mockReturnValue({ free: vi.fn() } as never);
  vi.spyOn(engine, "commit").mockReturnValue(true);
  vi.spyOn(engine, "refreshFromEngine").mockImplementation(() => {});
  vi.mocked(readNativeFileBounded).mockResolvedValue(new Uint8Array([9]));
  engine.engine = e as never;
  setDocumentNoticeSink((message) => notices.push(message));
});
afterEach(() => { engine.engine = null; setDocumentNoticeSink(null); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("data-set replacement application", () => {
  it("replaces the bound pixels only and coalesces into one undo step", async () => {
    await expect(dataVars.apply(0)).resolves.toBe(true);
    expect(readNativeFileBounded).toHaveBeenCalledWith("/jobs/a.png", expect.any(Function));
    expect(e.replace_smart_object_preserve_placement).toHaveBeenCalledWith(1, new Uint8Array([9]));
    expect([pixels, kind, visible]).toEqual([9, 0, true]);
    expect(history).toEqual([{ pixels: 1, kind: 0, visible: true }]);
    expect(engine.commit).toHaveBeenCalledTimes(1);
  });
  it("preflights every image before applying any text/visibility changes", async () => {
    state = { ...state, variables: [{ layer: "Photo", name: "show", type: "vis" }, ...state.variables], dataSets: [{ image: "missing.png", show: "false" }] };
    vi.mocked(readNativeFileBounded).mockRejectedValue(new Error("File not found"));
    await expect(dataVars.apply(0)).resolves.toBe(false);
    expect(e.begin_history_transaction).not.toHaveBeenCalled();
    expect([pixels, visible]).toEqual([1, true]);
    expect(notices.join()).toContain("File not found");
  });
  it("hands the specific reason to a caller's reporter instead of the toast", async () => {
    vi.mocked(readNativeFileBounded).mockRejectedValue(new Error("File not found"));
    const report = vi.fn();
    await expect(dataVars.apply(0, undefined, report)).resolves.toBe(false);
    expect(report).toHaveBeenCalledWith("Could not apply data set 1: File not found");
    expect(notices).toEqual([]);
  });
  it("rolls the entire row back when replacement fails", async () => {
    e.replace_smart_object_preserve_placement.mockImplementationOnce(() => { throw new Error("decode failed"); });
    await expect(dataVars.apply(0)).resolves.toBe(false);
    expect(e.cancel_history_transaction).toHaveBeenCalledTimes(1);
    expect([pixels, kind, visible]).toEqual([1, 0, true]);
    expect(engine.commit).not.toHaveBeenCalled();
  });
  it("refuses image/transparency locks and mask/channel targets without beginning an edit", async () => {
    for (const locks of [1, 2]) {
      state = { ...state, layers: [{ ...state.layers[0], locks }] };
      await expect(dataVars.apply(0)).resolves.toBe(false);
    }
    state = { ...state, layers: [{ ...state.layers[0], locks: 0 }], maskEdit: true };
    await expect(dataVars.apply(0)).resolves.toBe(false);
    state = { ...state, maskEdit: false, channelTarget: { type: "rgb", index: 0 } as never };
    await expect(dataVars.apply(0)).resolves.toBe(false);
    expect(e.begin_history_transaction).not.toHaveBeenCalled();
    expect(readNativeFileBounded).not.toHaveBeenCalled();
  });
  it("discards cancelled and stale reads without changing pixels or history", async () => {
    const controller = new AbortController();
    vi.mocked(readNativeFileBounded).mockImplementationOnce(async () => { controller.abort(); return new Uint8Array([9]); });
    await expect(dataVars.apply(0, controller.signal)).resolves.toBe(false);
    vi.mocked(readNativeFileBounded).mockImplementationOnce(async () => { pushes++; return new Uint8Array([9]); });
    await expect(dataVars.apply(0)).resolves.toBe(false);
    expect(e.begin_history_transaction).not.toHaveBeenCalled();
    expect(pixels).toBe(1);
  });
  it("waits for the corresponding image before exporting each row", async () => {
    state = { ...state, dataSets: [{ image: "a.png" }, { image: "b.png" }] };
    const order: string[] = [];
    vi.mocked(readNativeFileBounded).mockImplementation(async (path) => { await Promise.resolve(); order.push(path); return new Uint8Array([path.endsWith("a.png") ? 7 : 8]); });
    e.export_png_with_icc.mockImplementation(() => { order.push(`export:${pixels}`); return new Uint8Array([pixels]); });
    vi.stubGlobal("document", { createElement: () => ({ click: vi.fn(), remove: vi.fn() }), body: { appendChild: vi.fn() } });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() });
    await expect(dataVars.exportAll()).resolves.toBe(true);
    expect(order).toEqual(["/jobs/a.png", "export:7", "/jobs/b.png", "export:8"]);
    // Desktop (#505): both rows land in the ONE folder picked up front.
    expect(vi.mocked(atomicWriteBytes).mock.calls.map(([path]) => path)).toEqual(["/picked/dataset_1.png", "/picked/dataset_2.png"]);
  });
});
