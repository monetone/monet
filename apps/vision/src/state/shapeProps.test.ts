// #450 — a shape layer stays re-editable: fill, stroke, W/H/X/Y and four
// INDEPENDENT corner radii, read from and patched back into the layer's scene.
import { describe, expect, it } from "vitest";

import {
  formatDash, parseDash, sceneWithShapeProps, shapePropsFromScene, type ShapeProps,
} from "./shapeProps";

const scene = (...items: unknown[]) => JSON.stringify({ layers: [{ items }] });

const RECT = {
  type: "rect", id: "mv-shape-1",
  transform: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 },
  width: 100, height: 50, rx: 6, ry: 6,
  fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 1 } },
};
/** The Shape tool's polygon/star/custom form: a corner-anchored path item. */
const TRI = {
  type: "path", id: "mv-path-1",
  geometry: {
    closed: true,
    anchors: [
      { point: { x: 0, y: 0 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 2, y: 0 } },
      { point: { x: 20, y: 0 } },
      { point: { x: 10, y: 10 } },
    ],
  },
};

/** The item the patch landed on, back out of the scene JSON. */
const itemOf = (json: string, id: string) =>
  (JSON.parse(json).layers[0].items as { id: string }[]).find((it) => it.id === id) as Record<string, any>;

const props = (json: string, id?: string) => shapePropsFromScene(json, id) as ShapeProps;

describe("shapePropsFromScene", () => {
  it("reads a rect's position, size, fill and four corner radii", () => {
    const p = props(scene(RECT));
    expect(p.id).toBe("mv-shape-1");
    expect(p.kind).toBe("rect");
    expect([p.x, p.y, p.w, p.h]).toEqual([10, 20, 100, 50]);
    expect(p.transformed, "a plain translation is fully editable").toBe(false);
    expect(p.fill).toEqual([255, 0, 0, 255]);
    // A rect saved with the uniform rx/ry pair reads as four equal corners.
    expect(p.radii).toEqual([6, 6, 6, 6]);
    // No stroke on the item → the neutral defaults, not a crash.
    expect(p.stroke).toEqual({ color: null, width: 0, align: "center", cap: "butt", join: "miter", dash: [] });
  });

  it("reads the four independent radii back when they differ", () => {
    expect(props(scene({ ...RECT, radii: [4, 0, 8, 2] })).radii).toEqual([4, 0, 8, 2]);
  });

  it("reads a stroke's colour, width, align, cap, join and dash", () => {
    const stroked = {
      ...RECT,
      stroke: {
        paint: { type: "solid", color: { r: 0, g: 0, b: 255, a: 0.5 } },
        width: 4, align: "outside", cap: "round", join: "bevel", dash: [6, 3],
      },
    };
    expect(props(scene(stroked)).stroke).toEqual({
      color: [0, 0, 255, 128], width: 4, align: "outside", cap: "round", join: "bevel", dash: [6, 3],
    });
  });

  it("measures a path item from its anchors, and reports no radii for it", () => {
    const p = props(scene(TRI));
    expect([p.x, p.y, p.w, p.h]).toEqual([0, 0, 20, 10]);
    expect(p.radii, "corner radii are a rectangle thing").toBeNull();
    expect(p.fill, "no fill paint reads as none, not black").toBeNull();
  });

  it("picks the named component, or the first measurable one when there is no pick", () => {
    const two = scene(RECT, { ...TRI, id: "mv-path-2" });
    expect(props(two).id, "no id → the first component").toBe("mv-shape-1");
    expect(props(two, "mv-path-2").id, "Path Selection's pick").toBe("mv-path-2");
    // An explicit pick that no longer resolves blanks the Shape section. It must
    // NOT fall through to another component: the panel would then show — and
    // edit — a shape the user never selected. Stale ids are already pruned on
    // every engine sync (store.ts refreshFromEngine) and cleared on a layer or
    // document switch, so this is a rare race, not the normal path.
    expect(shapePropsFromScene(two, "gone"), "a stale pick blanks the panel").toBeNull();
    // A group has no geometry of its own; picking one reads as nothing rather
    // than as some other component.
    const grouped = scene({ type: "group", id: "g", children: [RECT] }, { ...RECT, id: "mv-shape-2" });
    expect(props(grouped).id, "no id → the first measurable TOP-LEVEL component").toBe("mv-shape-2");
    expect(shapePropsFromScene(grouped, "g"), "a group measures nothing").toBeNull();
    expect(shapePropsFromScene(scene({ type: "group", id: "g", children: [RECT] }))).toBeNull();
  });

  // Path Selection hit-tests INTO groups and hands back the leaf id (the engine's
  // query::hit_items). Reading only top-level items meant an imported grouped
  // scene showed — and edited — an unrelated component instead.
  // W/H/X/Y describe what the shape OCCUPIES, and a curve bulges past the hull
  // its anchors make. Measuring the hull alone reported a 75px arch as zero
  // high — so its height could not be read, and typing one in did nothing
  // because the panel thought there was no extent to scale.
  it("measures a curve's real extent, not the box its anchors make", () => {
    // A closed arch: both anchors on y=120, the joining cubic's controls 100
    // above them, so the curve tops out at y=45.
    const arch = scene({
      type: "path", id: "arch",
      geometry: {
        closed: true,
        anchors: [
          { point: { x: 20, y: 120 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: -100 } },
          { point: { x: 120, y: 120 }, handleIn: { x: 0, y: -100 }, handleOut: { x: 0, y: 0 } },
        ],
      },
    });

    const p = props(arch, "arch");

    expect([p.x, p.y, p.w, p.h]).toEqual([20, 45, 100, 75]);
  });

  it("resizes a curved shape, which a zero-height reading made impossible", () => {
    const arch = scene({
      type: "path", id: "arch",
      geometry: {
        closed: true,
        anchors: [
          { point: { x: 20, y: 120 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: -100 } },
          { point: { x: 120, y: 120 }, handleIn: { x: 0, y: -100 }, handleOut: { x: 0, y: 0 } },
        ],
      },
    });

    const out = sceneWithShapeProps(arch, "arch", { h: 150 });

    expect(props(out, "arch").h).toBe(150);
  });

  it("reads a grouped child through its parent's transform", () => {
    const child = { ...RECT, id: "kid", transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 } };
    const grouped = scene(
      { ...RECT, id: "top" },
      { type: "group", id: "g", transform: { a: 1, b: 0, c: 0, d: 1, e: 100, f: 60 }, children: [child] },
    );

    const p = props(grouped, "kid");

    expect(p.id, "the selected child, not a top-level sibling").toBe("kid");
    // 5 + 100, 5 + 60: the group's transform composes with the child's.
    expect([p.x, p.y, p.w, p.h]).toEqual([105, 65, 100, 50]);
  });

  it("reports a rotated/scaled component's CANVAS bounds and flags it transformed", () => {
    // 90° about the origin, then shifted: (x, y) → (100 − y, 20 + x). The local
    // 100×50 rect lands as a 50×100 box at (50, 20) — what the canvas shows, not
    // the local numbers an (e, f)-only read would report.
    const rotated = { ...RECT, transform: { a: 0, b: 1, c: -1, d: 0, e: 100, f: 20 } };
    const p = props(scene(rotated));
    expect([p.x, p.y, p.w, p.h]).toEqual([50, 20, 50, 100]);
    expect(p.transformed).toBe(true);
    // A flip (an imported .artisan mirror) is a non-translate matrix too.
    expect(props(scene({ ...RECT, transform: { a: -1, b: 0, c: 0, d: 1, e: 100, f: 0 } })))
      .toMatchObject({ x: 0, y: 0, w: 100, h: 50, transformed: true });
    // A bare translation, with or without the matrix spelled out, is not.
    expect(props(scene({ ...RECT, transform: undefined })).transformed).toBe(false);
  });

  it("returns null for an empty or unparseable scene", () => {
    expect(shapePropsFromScene("")).toBeNull();
    expect(shapePropsFromScene("{oops")).toBeNull();
    expect(shapePropsFromScene(JSON.stringify({ layers: [] }))).toBeNull();
  });
});

describe("sceneWithShapeProps", () => {
  it("moves the grouped child that was selected, not a top-level sibling", () => {
    const child = { ...RECT, id: "kid", transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 } };
    const grouped = scene(
      { ...RECT, id: "top" },
      { type: "group", id: "g", transform: { a: 1, b: 0, c: 0, d: 1, e: 100, f: 60 }, children: [child] },
    );

    const out = sceneWithShapeProps(grouped, "kid", { x: 0, y: 0 });

    const items = JSON.parse(out).layers[0].items as Record<string, any>[];
    expect(items[0].transform, "the sibling the panel used to edit is untouched")
      .toEqual({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
    // X/Y are canvas-space: the child sat at 105,65 (its own 5,5 through the
    // group's 100,60), so moving it to 0,0 leaves the group alone and folds the
    // whole delta into the child — 0 - 100, 0 - 60.
    expect(items[1].children[0].transform).toEqual({ a: 1, b: 0, c: 0, d: 1, e: -100, f: -60 });
    expect(shapePropsFromScene(out, "kid")!.x).toBe(0);
    expect(shapePropsFromScene(out, "kid")!.y).toBe(0);
  });

  it("moves a rect by its transform and resizes it by width/height", () => {
    const out = sceneWithShapeProps(scene(RECT), "mv-shape-1", { x: 0, y: 5, w: 40, h: 30 });
    const it = itemOf(out, "mv-shape-1");
    expect([it.transform.e, it.transform.f]).toEqual([0, 5]);
    expect([it.width, it.height]).toEqual([40, 30]);
    expect(props(out)).toMatchObject({ x: 0, y: 5, w: 40, h: 30 });
  });

  it("scales a path item's anchors and handles, keeping its top-left where it was", () => {
    const out = sceneWithShapeProps(scene(TRI), "mv-path-1", { w: 40, h: 5 });
    const anchors = itemOf(out, "mv-path-1").geometry.anchors;
    expect(anchors.map((a: any) => [a.point.x, a.point.y])).toEqual([[0, 0], [40, 0], [20, 5]]);
    // Handles are RELATIVE to their anchor, so they scale but don't re-origin.
    expect(anchors[0].handleOut).toEqual({ x: 4, y: 0 });
    expect(props(out)).toMatchObject({ x: 0, y: 0, w: 40, h: 5 });
  });

  it("translates a path item without touching its geometry", () => {
    const out = sceneWithShapeProps(scene(TRI), "mv-path-1", { x: 7, y: -3 });
    const it = itemOf(out, "mv-path-1");
    expect([it.transform.e, it.transform.f]).toEqual([7, -3]);
    expect(it.geometry.anchors[1].point).toEqual({ x: 20, y: 0 });
    expect(props(out)).toMatchObject({ x: 7, y: -3, w: 20, h: 10 });
  });

  it("writes four INDEPENDENT corner radii, and keeps uniform ones as the plain rx/ry pair", () => {
    const four = sceneWithShapeProps(scene(RECT), "mv-shape-1", { radii: [4, 0, 8, 2] });
    expect(itemOf(four, "mv-shape-1").radii).toEqual([4, 0, 8, 2]);
    expect(props(four).radii).toEqual([4, 0, 8, 2]);
    // The pair a reader without `radii` (Artisan's TS engine) falls back to is
    // the closest ONE radius — the mean — not whichever corner came first.
    expect([itemOf(four, "mv-shape-1").rx, itemOf(four, "mv-shape-1").ry]).toEqual([3.5, 3.5]);

    // Back to one value everywhere: the list goes away so every reader (and the
    // engine's uniform path) still sees the right corners.
    const uniform = sceneWithShapeProps(four, "mv-shape-1", { radii: [3, 3, 3, 3] });
    const it = itemOf(uniform, "mv-shape-1");
    expect(it.radii).toBeUndefined();
    expect([it.rx, it.ry]).toEqual([3, 3]);
    expect(props(uniform).radii).toEqual([3, 3, 3, 3]);

    // Corner radii are meaningless on a path item and must not be invented.
    expect(itemOf(sceneWithShapeProps(scene(TRI), "mv-path-1", { radii: [4, 4, 4, 4] }), "mv-path-1").radii)
      .toBeUndefined();
  });

  it("writes the fill and every stroke property, merging into what is there", () => {
    let out = sceneWithShapeProps(scene(RECT), "mv-shape-1", { fill: [0, 128, 255, 255] });
    expect(itemOf(out, "mv-shape-1").fill).toEqual({ type: "solid", color: { r: 0, g: 128, b: 255, a: 1 } });

    out = sceneWithShapeProps(out, "mv-shape-1", { stroke: { width: 5 } });
    // A width with no colour would stroke nothing — black is the visible default.
    expect(props(out).stroke).toMatchObject({ width: 5, color: [0, 0, 0, 255] });

    out = sceneWithShapeProps(out, "mv-shape-1", {
      stroke: { color: [255, 255, 0, 255], align: "inside", cap: "square", join: "round", dash: [6, 3] },
    });
    expect(props(out).stroke).toEqual({
      color: [255, 255, 0, 255], width: 5, align: "inside", cap: "square", join: "round", dash: [6, 3],
    });
    // One field at a time: setting the dash must not drop the width or align.
    out = sceneWithShapeProps(out, "mv-shape-1", { stroke: { dash: [] } });
    expect(props(out).stroke).toMatchObject({ width: 5, align: "inside", dash: [] });
  });

  it("moves a rotated component by X/Y but refuses to resize it", () => {
    const rotated = scene({ ...RECT, transform: { a: 0, b: 1, c: -1, d: 0, e: 100, f: 20 } });
    // X/Y edit the canvas box: +10 in X is +10 on the translation, whatever the
    // rest of the matrix is, and the box reads back where it was asked to go.
    const moved = sceneWithShapeProps(rotated, "mv-shape-1", { x: 60, y: 25 });
    expect(itemOf(moved, "mv-shape-1").transform).toEqual({ a: 0, b: 1, c: -1, d: 0, e: 110, f: 25 });
    expect(props(moved)).toMatchObject({ x: 60, y: 25, w: 50, h: 100 });
    // W/H of a rotated shape have no one local answer: the write is refused and,
    // being a no-op, hands the scene back untouched (no undo step).
    expect(sceneWithShapeProps(rotated, "mv-shape-1", { w: 80, h: 30 })).toBe(rotated);
    expect(itemOf(moved, "mv-shape-1").width).toBe(100);
  });

  it("leaves the scene untouched when there is nothing to patch", () => {
    const json = scene(RECT);
    expect(sceneWithShapeProps("", "x", { x: 1 })).toBe("");
    expect(sceneWithShapeProps("{oops", "x", { x: 1 })).toBe("{oops");
    expect(sceneWithShapeProps(JSON.stringify({ layers: [] }), "x", { x: 1 }))
      .toBe(JSON.stringify({ layers: [] }));
    // Nothing negative, nothing NaN — a junk field must not corrupt the shape.
    const out = sceneWithShapeProps(json, "mv-shape-1", { w: -5, h: Number.NaN, x: Number.NaN });
    expect(props(out)).toMatchObject({ w: 0, h: 50, x: 10 });
  });

  it("hands back the SAME text for a no-op edit, even on an item with no transform", () => {
    // The same values back is not an edit — and neither is what writing them
    // would materialise (an identity transform, a stroke object with nothing in
    // it): the store keys "spend an undo step" on the text changing.
    const bare = scene({ type: "rect", id: "b", width: 100, height: 50, fill: RECT.fill });
    expect(sceneWithShapeProps(bare, "b", { x: 0, y: 0, w: 100, h: 50 })).toBe(bare);
    expect(sceneWithShapeProps(bare, "b", { radii: [0, 0, 0, 0], fill: [255, 0, 0, 255] })).toBe(bare);
    expect(sceneWithShapeProps(bare, "b", { stroke: { width: 0, dash: [] } })).toBe(bare);
    expect(sceneWithShapeProps(scene(TRI), "mv-path-1", { w: 20, h: 10, x: 0 })).toBe(scene(TRI));
    // …while a real change on the same item still goes through.
    expect(props(sceneWithShapeProps(bare, "b", { x: 3 }))).toMatchObject({ x: 3, y: 0 });
  });
});

describe("dash pattern text", () => {
  it("round-trips a pattern, and reads a solid stroke out of junk", () => {
    expect(parseDash("6, 3")).toEqual([6, 3]);
    expect(parseDash("6 3 1")).toEqual([6, 3, 1]);
    expect(parseDash("")).toEqual([]);
    expect(parseDash("solid, -2")).toEqual([]);
    expect(formatDash([6, 3])).toBe("6, 3");
    expect(parseDash(formatDash([6, 3, 1]))).toEqual([6, 3, 1]);
  });
});
