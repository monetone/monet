import { describe, expect, it, vi } from "vitest";
vi.mock("@engine", () => ({ default: vi.fn(), Engine: class {} }));
vi.mock("../text/outline", () => ({ typeOutlineScene: (_spec: unknown, outline: (json: string) => string) => outline("positioned text") }));
import { Store } from "./store";
import { WORK_PATH_ITEM } from "./paths";

// outline_text_scene's shape: layer-local points with relative handles, one
// compound item per text item, each glyph contour a closed subpath.
const anchor = (x: number, y: number, hin = [0, 0], hout = [0, 0]) =>
  ({ point: { x, y }, handleIn: { x: hin[0], y: hin[1] }, handleOut: { x: hout[0], y: hout[1] } });
const SCENE = JSON.stringify({ layers: [{ items: [{ type: "compound", id: "c1", subpaths: [
  { closed: true, anchors: [anchor(0, 0, [0, -4], [0, 4]), anchor(10, 10), anchor(0, 20)] },
  { closed: true, anchors: [anchor(30, 0), anchor(40, 0, [-2, 0], [2, 0]), anchor(40, 10), anchor(30, 10)] },
  { closed: false, anchors: [anchor(0, 0), anchor(5, 5)] },
] }] }] });

function setup({ scene = SCENE, spec = "{}", commitOk = true } = {}) {
  const e = {
    layer_text_spec: vi.fn(() => spec),
    outline_text_scene: vi.fn(() => scene), set_type_outline: vi.fn(),
    create_work_path: vi.fn(), convert_to_shape: vi.fn(), vector_begin_edit: vi.fn(),
    layer_offset: vi.fn(() => [100, 50]),
  };
  const client = { engine: e, e, commit: vi.fn(() => commitOk), onCommit: null, onEditError: vi.fn() };
  return { e, client, store: new Store(client as never) };
}

describe("Type outline commands (#452)", () => {
  it("Create Work Path makes the glyph loops the work path, handles and layer offset included", () => {
    const { e, client, store } = setup();
    store.createWorkPath();
    expect(e.outline_text_scene).toHaveBeenCalledWith("positioned text");
    expect(e.set_type_outline).toHaveBeenCalledWith(store.state.activeLayerId, SCENE, false);
    expect(client.commit).toHaveBeenCalledTimes(1);
    expect(store.state.penContours, "open subpaths are not loops").toEqual([3, 4]);
    expect(store.state.penAnchors.slice(0, 6)).toEqual([100, 50, 0, -4, 0, 4]);
    expect(store.state.penAnchors.slice(24, 30)).toEqual([140, 50, -2, 0, 2, 0]);
    expect(store.state.penPath.length).toBeGreaterThan(14);
    expect(e.create_work_path).not.toHaveBeenCalled();
    expect(client.onEditError).not.toHaveBeenCalled();
  });

  it("Convert to Shape commits the shape and leaves the work path alone", () => {
    const { e, client, store } = setup();
    store.setPenPath([1, 1, 2, 2, 3, 3]);
    store.convertToShape();
    expect(e.set_type_outline).toHaveBeenCalledWith(store.state.activeLayerId, SCENE, true);
    expect(client.commit).toHaveBeenCalledTimes(1);
    expect(store.state.penPath).toEqual([1, 1, 2, 2, 3, 3]);
    expect(e.convert_to_shape).not.toHaveBeenCalled();
  });

  it("reports a font with no outline data and changes nothing", () => {
    for (const shape of [false, true]) {
      const { e, client, store } = setup({ scene: "" });
      if (shape) store.convertToShape(); else store.createWorkPath();
      expect(client.onEditError).toHaveBeenCalledWith(expect.stringMatching(/outline data.*Choose an installed font/));
      expect(e.set_type_outline).not.toHaveBeenCalled();
      expect(e.create_work_path).not.toHaveBeenCalled();
      expect(e.convert_to_shape).not.toHaveBeenCalled();
      expect(client.commit).not.toHaveBeenCalled();
      expect(store.state.penPath).toEqual([]);
    }
  });

  it("reports a non-type layer and changes nothing", () => {
    for (const shape of [false, true]) {
      const { e, client, store } = setup({ spec: "" });
      if (shape) store.convertToShape(); else store.createWorkPath();
      expect(client.onEditError).toHaveBeenCalledWith(expect.stringMatching(/needs a type layer/));
      expect(e.outline_text_scene).not.toHaveBeenCalled();
      expect(e.set_type_outline).not.toHaveBeenCalled();
      expect(e.create_work_path).not.toHaveBeenCalled();
      expect(e.convert_to_shape).not.toHaveBeenCalled();
      expect(client.commit).not.toHaveBeenCalled();
    }
  });

  it("keeps the previous work path when the engine refuses the edit (a locked layer)", () => {
    const { store } = setup({ commitOk: false });
    store.setPenPath([1, 1, 2, 2, 3, 3]);
    store.createWorkPath();
    expect(store.state.penPath).toEqual([1, 1, 2, 2, 3, 3]);
    expect(store.state.penContours).toEqual([]);
  });

  it("Direct Selection drags a work-path anchor and handle without an engine edit", () => {
    const { e, store } = setup();
    store.createWorkPath();
    expect(store.directSelectAt(141, 51, 3)).toBe(true);
    expect(store.state.selectedAnchor).toEqual({ item: WORK_PATH_ITEM, index: 4 });
    store.dragSelectedAnchor(145, 58);
    expect(store.state.penAnchors.slice(24, 30), "the point moves, its relative handles follow").toEqual([145, 58, -2, 0, 2, 0]);
    store.endAnchorDrag();
    expect(store.directSelectHandleAt(147, 58, 1)).toBe(true);
    expect(store.state.selectedHandle).toEqual({ item: WORK_PATH_ITEM, index: 4, end: "out" });
    store.dragSelectedHandle(150, 60);
    expect(store.state.penAnchors.slice(24, 30)).toEqual([145, 58, -2, 0, 5, 2]);
    store.moveWorkPathAnchors([{ index: 0, x: 90, y: 40 }, { index: 3, x: 120, y: 45 }]);
    expect(store.state.penAnchors[0]).toBe(90);
    expect(store.state.penAnchors[18]).toBe(120);
    expect(store.state.penContours).toEqual([3, 4]);
    expect(e.vector_begin_edit).not.toHaveBeenCalled();
  });

  it("Free Transform Path, Save and Load keep the loops apart", () => {
    const { store } = setup();
    store.createWorkPath();
    expect(store.transformWorkPath({ sx: 2, sy: 2 })).toBe(true);
    expect(store.state.penContours).toEqual([3, 4]);
    store.saveWorkPath();
    expect(store.state.savedPaths[0].contours).toEqual([3, 4]);
    store.deleteWorkPath();
    expect(store.state.penContours).toEqual([]);
    store.loadSavedPath(0);
    expect(store.state.penContours).toEqual([3, 4]);
    expect(store.state.penAnchors).toEqual(store.state.savedPaths[0].anchors);
  });
});

describe("type-layer font provisioning", () => {
  it("provisions type-layer defaults and every run font", () => {
    const engine = {
      layer_count: () => 1, layer_id_at: () => 7, layer_kind: () => 2,
      layer_text_spec: () => JSON.stringify({ font: "Default", runs: [{ text: "A", font: "Alternate" }, { text: "B" }] }),
    };
    const store = new Store({ engine, e: engine, onCommit: null } as never);
    (store as any).docs = [{ engine }];
    expect(store.vectorFontStacksForOpenDocs()).toEqual(["Alternate", "Default"]);
  });
});
