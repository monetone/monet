// The Direct/Path Selection overlay is only correct if it puts anchors exactly
// where `vector_nearest_anchor` says they are — same world transform, same
// {item,index} address. These assert that contract plus the marquee/drag math.
import { describe, it, expect } from "vitest";
import {
  vectorPathsFromSceneJson,
  pathOutlineD,
  anchorsInRect,
  anchorOrigins,
  toggleAnchor,
  anchorKey,
  workPathOverlays,
  nearestOverlayAnchor,
  nearestOverlayHandle,
} from "./vectorPathOverlay";
import { WORK_PATH_ITEM } from "../state/paths";

// Type ▸ Create Work Path hands the work path several glyph loops; Direct
// Selection addresses them the way it addresses a compound's contours. (#452)
describe("the work path's loops", () => {
  // A corner triangle, then a two-anchor loop whose second anchor has handles.
  const anchors = [0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0, 40, 0, 0, 0, 0, 0, 50, 0, -2, 3, 4, -5];

  it("gives each loop its running indexBase", () => {
    const paths = workPathOverlays(anchors, [3, 2]);
    expect(paths.map((p) => [p.item, p.indexBase, p.anchors.length, p.closed]))
      .toEqual([[WORK_PATH_ITEM, 0, 3, true], [WORK_PATH_ITEM, 3, 2, true]]);
    expect(paths[1].anchors[1]).toEqual({ x: 50, y: 0, inX: -2, inY: 3, outX: 4, outY: -5 });
    expect(anchorsInRect(paths, 45, -1, 55, 1)).toEqual([{ item: WORK_PATH_ITEM, index: 4 }]);
    expect(anchorOrigins(paths, [{ item: WORK_PATH_ITEM, index: 3 }]))
      .toEqual([{ item: WORK_PATH_ITEM, index: 3, x: 40, y: 0 }]);
    expect(workPathOverlays(anchors, []), "no counts means one loop").toHaveLength(1);
  });

  it("hit-tests anchors and handle ends by flat index within tolerance", () => {
    const paths = workPathOverlays(anchors, [3, 2]);
    expect(nearestOverlayAnchor(paths, 41, 1, 3)).toEqual({ item: WORK_PATH_ITEM, index: 3 });
    expect(nearestOverlayAnchor(paths, 41, 1, 1)).toBeNull();
    expect(nearestOverlayHandle(paths, 54, -5, 1)).toEqual({ item: WORK_PATH_ITEM, index: 4, end: "out" });
    expect(nearestOverlayHandle(paths, 48, 3, 1)).toEqual({ item: WORK_PATH_ITEM, index: 4, end: "in" });
    expect(nearestOverlayHandle(paths, 10, 10, 3), "zero-length handles are never grabbed").toBeNull();
  });
});

// A translated group holding one square, plus a sibling path with handles.
const SCENE = JSON.stringify({
  layers: [{
    items: [
      {
        type: "group",
        id: "g1",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 100, f: 50 },
        children: [{
          type: "path",
          id: "sq",
          transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 },
          geometry: { closed: true, anchors: [{ point: { x: 0, y: 0 } }, { point: { x: 10, y: 0 } }, { point: { x: 10, y: 10 } }] },
        }],
      },
      {
        type: "path",
        id: "curve",
        geometry: {
          closed: false,
          anchors: [
            { point: { x: 0, y: 0 }, handleOut: { x: 5, y: 0 } },
            { point: { x: 20, y: 0 }, handleIn: { x: -5, y: 0 } },
          ],
        },
      },
    ],
  }],
});

describe("vectorPathsFromSceneJson", () => {
  it("flattens nested items into world space (parent ∘ child transform)", () => {
    const paths = vectorPathsFromSceneJson(SCENE);
    // Children come first, matching the engine's own walk order.
    expect(paths.map((p) => p.item)).toEqual(["sq", "curve"]);
    const sq = paths[0];
    expect(sq.closed).toBe(true);
    expect(sq.anchors[0]).toMatchObject({ x: 100, y: 50 });
    expect(sq.anchors[1]).toMatchObject({ x: 120, y: 50 }); // scaled by 2, then translated
    expect(sq.anchors[2]).toMatchObject({ x: 120, y: 70 });
  });

  it("rotates handles as vectors, not points", () => {
    const rotated = JSON.stringify({
      layers: [{ items: [{ type: "path", id: "r", transform: { a: 0, b: 1, c: -1, d: 0, e: 30, f: 0 },
        geometry: { anchors: [{ point: { x: 10, y: 0 }, handleOut: { x: 4, y: 0 } }] } }] }],
    });
    const [p] = vectorPathsFromSceneJson(rotated);
    expect(p.anchors[0].x).toBeCloseTo(30);
    expect(p.anchors[0].y).toBeCloseTo(10);
    expect(p.anchors[0].outX).toBeCloseTo(0); // handle rotated 90°, NOT translated
    expect(p.anchors[0].outY).toBeCloseTo(4);
  });

  it("skips hidden items and survives garbage", () => {
    const hidden = JSON.stringify({ layers: [{ items: [{ type: "path", id: "h", visible: false, geometry: { anchors: [{ point: { x: 1, y: 1 } }] } }] }] });
    expect(vectorPathsFromSceneJson(hidden)).toEqual([]);
    expect(vectorPathsFromSceneJson("")).toEqual([]);
    expect(vectorPathsFromSceneJson("{ not json")).toEqual([]);
    expect(vectorPathsFromSceneJson("{}")).toEqual([]);
  });
});

describe("pathOutlineD", () => {
  it("emits a cubic per segment and closes a closed path", () => {
    const [, curve] = vectorPathsFromSceneJson(SCENE);
    expect(pathOutlineD(curve)).toBe("M 0 0 C 5 0 15 0 20 0");
    const [sq] = vectorPathsFromSceneJson(SCENE);
    const d = pathOutlineD(sq);
    expect(d.startsWith("M 100 50")).toBe(true);
    expect(d.endsWith(" Z")).toBe(true);
    expect(d.split(" C ").length - 1).toBe(3); // closed triangle → 3 segments
  });
  it("is empty for an empty path", () => {
    expect(pathOutlineD({ item: "x", closed: true, anchors: [], indexBase: 0 })).toBe("");
  });
});

describe("marquee + multi-anchor drag", () => {
  it("selects every anchor inside the rubber band, corners in any order", () => {
    const paths = vectorPathsFromSceneJson(SCENE);
    expect(anchorsInRect(paths, 110, 60, 95, 45)).toEqual([{ item: "sq", index: 0 }]); // dragged up-left
    expect(anchorsInRect(paths, 95, 45, 125, 75)).toHaveLength(3);
    expect(anchorsInRect(paths, 500, 500, 600, 600)).toEqual([]);
  });

  it("captures drag origins so the whole set moves by one delta", () => {
    const paths = vectorPathsFromSceneJson(SCENE);
    const sel = [{ item: "sq", index: 1 }, { item: "sq", index: 2 }, { item: "gone", index: 0 }];
    expect(anchorOrigins(paths, sel)).toEqual([
      { item: "sq", index: 1, x: 120, y: 50 },
      { item: "sq", index: 2, x: 120, y: 70 },
    ]);
  });

  it("shift-click toggles one anchor", () => {
    const a = { item: "sq", index: 0 };
    const b = { item: "sq", index: 1 };
    expect(toggleAnchor([a], b)).toEqual([a, b]);
    expect(toggleAnchor([a, b], { ...a })).toEqual([b]);
    expect(anchorKey(a)).toBe("sq#0");
  });
});

// Type ▸ Convert to Shape emits ONE `compound` item whose contours live in
// `subpaths`, so an overlay that only read `geometry` drew nothing at all and
// Direct Selection had no anchors to grab. (#452)
describe("a compound item's contours (#452)", () => {
  const GLYPH = JSON.stringify({
    layers: [{
      items: [{
        type: "compound", id: "glyph",
        subpaths: [
          { closed: true, anchors: [{ point: { x: 0, y: 0 } }, { point: { x: 10, y: 0 } }, { point: { x: 10, y: 10 } }] },
          { closed: true, anchors: [{ point: { x: 3, y: 3 } }, { point: { x: 6, y: 3 } }] },
        ],
      }],
    }],
  });

  it("draws every contour, numbering anchors straight through", () => {
    const paths = vectorPathsFromSceneJson(GLYPH);
    expect(paths).toHaveLength(2);
    expect(paths.map((p) => p.indexBase), "the counter continues the outer contour's numbering")
      .toEqual([0, 3]);
    expect(paths.every((p) => p.item === "glyph")).toBe(true);
  });

  it("addresses a counter's anchor the way the engine does", () => {
    const paths = vectorPathsFromSceneJson(GLYPH);
    // A marquee over the counter's first anchor only.
    expect(anchorsInRect(paths, 2.5, 2.5, 3.5, 3.5)).toEqual([{ item: "glyph", index: 3 }]);
    expect(anchorOrigins(paths, [{ item: "glyph", index: 4 }]))
      .toEqual([{ item: "glyph", index: 4, x: 6, y: 3 }]);
  });
});
