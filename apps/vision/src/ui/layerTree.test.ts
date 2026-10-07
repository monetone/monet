import { describe, expect, it } from "vitest";
import {
  clippingBoundaryLayer,
  flattenLayerTree,
  layerDropPosition,
  planLayerDrop,
  planLayerStep,
  type LayerTreeItem,
} from "./layerTree";

const layer = (id: number, group = 0, kind = 0): LayerTreeItem => ({ id, group, kind });

describe("Layers panel hierarchy", () => {
  const layers = [
    layer(8),
    layer(10, 0, 6),
    layer(11, 10, 6),
    layer(12, 11),
    layer(13, 10),
    layer(9),
  ];

  it("flattens nested groups, collapses descendants, and keeps matching ancestors", () => {
    expect(flattenLayerTree(layers, new Set()).map(({ layer, depth }) => [layer.id, depth]))
      .toEqual([[8, 0], [10, 0], [11, 1], [12, 2], [13, 1], [9, 0]]);
    expect(flattenLayerTree(layers, new Set([11])).map(({ layer }) => layer.id))
      .toEqual([8, 10, 11, 13, 9]);
    expect(flattenLayerTree(layers, new Set(), (item) => item.id === 12).map(({ layer }) => layer.id))
      .toEqual([10, 11, 12]);
  });

  it("plans reorder, reparent, and root drops while rejecting self/descendant drops", () => {
    expect(planLayerDrop(layers, 9, 11, "inside")).toMatchObject({ parentId: 11, positionCode: 1 });
    expect(planLayerDrop(layers, 12, 8, "after")).toMatchObject({ parentId: 0, positionCode: 2 });
    expect(planLayerDrop(layers, 13, 11, "before")).toMatchObject({ parentId: 10, positionCode: 0 });
    expect(planLayerDrop(layers, 10, 10, "inside")).toBeNull();
    expect(planLayerDrop(layers, 10, 11, "inside")).toBeNull();
    expect(planLayerDrop(layers, 10, 12, "before")).toBeNull();
  });

  it("uses the group centre as an inside drop and leaf centres as reorder drops", () => {
    expect(layerDropPosition(11, 10, 40, true)).toBe("before");
    expect(layerDropPosition(30, 10, 40, true)).toBe("inside");
    expect(layerDropPosition(30, 10, 40, false)).toBe("after");
    expect(layerDropPosition(49, 10, 40, true)).toBe("after");
  });

  it("steps only among siblings so groups move as one engine operation", () => {
    expect(planLayerStep(layers, 13, -1)).toMatchObject({ targetId: 11, positionCode: 0 });
    expect(planLayerStep(layers, 11, 1)).toMatchObject({ targetId: 13, positionCode: 2 });
    expect(planLayerStep(layers, 10, 1)).toMatchObject({ targetId: 9, positionCode: 2 });
    expect(planLayerStep(layers, 12, -1)).toBeNull();
  });

  it("keeps artboards top-level while still allowing leaf drops inside them", () => {
    const withArtboard = [...layers, layer(20, 0, 6), layer(21, 20)];
    const artboards = new Set([20]);
    expect(planLayerDrop(withArtboard, 9, 20, "inside", artboards)).toMatchObject({
      parentId: 20,
    });
    expect(planLayerDrop(withArtboard, 10, 20, "inside", artboards)).toBeNull();
    expect(planLayerDrop(withArtboard, 20, 10, "inside", artboards)).toBeNull();
    expect(planLayerDrop(withArtboard, 20, 9, "before", artboards)).not.toBeNull();
  });

  it("resolves only visible, adjacent, same-parent clipping boundaries", () => {
    const hierarchy = [
      { ...layer(1, 0, 6), clipped: false },
      { ...layer(2, 1), clipped: false },
      { ...layer(3, 1), clipped: false },
      { ...layer(4), clipped: false },
    ];
    expect(clippingBoundaryLayer(hierarchy, [1, 2, 3, 4], 3, "top")?.id).toBe(2);
    expect(clippingBoundaryLayer(hierarchy, [1, 2, 3, 4], 3, "bottom")).toBeNull();
    expect(clippingBoundaryLayer(hierarchy, [1, 2, 4], 2, "bottom")).toBeNull();
    hierarchy[1].clipped = true;
    expect(clippingBoundaryLayer(hierarchy, [1, 2, 4], 2, "bottom")?.id).toBe(2);
    hierarchy[0].clipped = true;
    expect(clippingBoundaryLayer(hierarchy, [1, 2, 4], 2, "top")?.id).toBe(1);
  });
});
