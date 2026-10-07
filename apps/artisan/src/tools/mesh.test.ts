import { describe, expect, it } from "vitest";
import { ArtisanStore, Ops, Query, makeDocument, makeRect, rgba, solid, type GroupItem } from "../engine";
import { createMeshTool } from "./mesh";
import type { ToolContext, ToolPointer } from "./types";

const context = (store: ArtisanStore): ToolContext => ({
  store,
  state: store.getState(),
  worldToScreen: (point) => point,
  screenToWorld: (point) => point,
  requestRender: () => {},
  zoom: 1,
  viewport: { width: 800, height: 600 },
});

const pointer = (x: number, y: number): ToolPointer => ({
  world: { x, y },
  rawWorld: { x, y },
  screen: { x, y },
  shift: false,
  alt: false,
  mod: false,
  button: 0,
  detail: 1,
});

describe("Gradient Mesh tool", () => {
  it("recolors the nearest point when clicking an existing mesh", () => {
    const doc = makeDocument("Mesh Point Tool");
    const rect = makeRect(0, 0, 100, 100);
    Ops.Items.addItem(doc, rect);
    const meshId = Ops.Meshes.createMeshFromItem(doc, rect.id)!;
    const store = new ArtisanStore();
    store.replaceDoc(doc, { markClean: true });
    store.setFill(solid(rgba(230, 20, 60)));

    createMeshTool().onPointerDown!(pointer(1, 1), context(store));

    const mesh = Query.getItem(store.doc, meshId) as GroupItem;
    expect(mesh.mesh?.points.find((point) => point.row === 0 && point.column === 0)?.color)
      .toEqual(rgba(230, 20, 60));
    expect(store.getState().selection).toEqual([meshId]);
    store.undo();
    expect((Query.getItem(store.doc, meshId) as GroupItem).mesh?.points.find((point) => point.row === 0 && point.column === 0)?.color)
      .not.toEqual(rgba(230, 20, 60));
  });
});
