// #456: Path Selection ▸ Align / Distribute / Arrange over a shape layer's
// path components. The maths is pure (world-space bounds in, per-component
// deltas out) and the reorder is pure scene-JSON surgery, so both are pinned
// here without an engine.
import { describe, expect, it } from "vitest";
import { alignDeltas, arrangeComponents, distributeDeltas } from "./pathComponents";

const A = { id: "a", x: 0, y: 0, w: 10, h: 10 };
const B = { id: "b", x: 30, y: 20, w: 20, h: 40 };
const C = { id: "c", x: 100, y: 5, w: 10, h: 10 };

const byId = (ds: { id: string; dx: number; dy: number }[]) =>
  Object.fromEntries(ds.map((d) => [d.id, [d.dx, d.dy]]));

describe("alignDeltas", () => {
  it("aligns to the selection's union box, so the outermost component stays put", () => {
    expect(byId(alignDeltas([A, B], 0))).toEqual({ a: [0, 0], b: [-30, 0] }); // left edges → x=0
    expect(byId(alignDeltas([A, B], 2))).toEqual({ a: [40, 0], b: [0, 0] }); // right edges → x=50
    expect(byId(alignDeltas([A, B], 1))).toEqual({ a: [20, 0], b: [-15, 0] }); // h-centres → x=25
    expect(byId(alignDeltas([A, B], 3))).toEqual({ a: [0, 0], b: [0, -20] }); // top edges → y=0
    expect(byId(alignDeltas([A, B], 5))).toEqual({ a: [0, 50], b: [0, 0] }); // bottom edges → y=60
    expect(byId(alignDeltas([A, B], 4))).toEqual({ a: [0, 25], b: [0, -10] }); // v-centres → y=30
  });

  it("moves nothing with one component or an unknown mode", () => {
    expect(alignDeltas([A], 0)).toEqual([]);
    expect(alignDeltas([A, B], 6)).toEqual([]);
  });
});

describe("distributeDeltas", () => {
  it("spaces the middle components evenly between the outer two", () => {
    // Left edges 0, 30, 100 → the middle one lands at 50.
    expect(byId(distributeDeltas([C, A, B], 0, 0))).toEqual({ a: [0, 0], b: [20, 0], c: [0, 0] });
    // H-centres 5, 40, 105 → middle at 55 (b's centre moves 40 → 55).
    expect(byId(distributeDeltas([A, B, C], 0, 1))).toEqual({ a: [0, 0], b: [15, 0], c: [0, 0] });
    // Right edges 10, 50, 110 → middle at 60.
    expect(byId(distributeDeltas([A, B, C], 0, 2))).toEqual({ a: [0, 0], b: [10, 0], c: [0, 0] });
    // Top edges 0, 5, 20 (a, c, b) → c stays the middle, at 10.
    expect(byId(distributeDeltas([A, B, C], 1, 0))).toEqual({ a: [0, 0], b: [0, 0], c: [0, 5] });
  });

  it("makes the gaps equal for the spacing modes", () => {
    // Span 0..110 holds 40 of width → 70 of gap over two gaps = 35 each: b at 45.
    expect(byId(distributeDeltas([A, B, C], 0, 3))).toEqual({ a: [0, 0], b: [15, 0], c: [0, 0] });
  });

  it("needs three components and a known axis/key", () => {
    expect(distributeDeltas([A, B], 0, 1)).toEqual([]);
    expect(distributeDeltas([A, B, C], 2, 1)).toEqual([]);
    expect(distributeDeltas([A, B, C], 0, 4)).toEqual([]);
  });
});

describe("arrangeComponents", () => {
  const scene = (order: string[]) => JSON.stringify({ layers: [{ items: order.map((id) => ({ type: "path", id })) }] });
  const order = (json: string | null) => (JSON.parse(json!) as { layers: { items: { id: string }[] }[] }).layers[0].items.map((i) => i.id);

  it("brings the selection to the end of the list (front) keeping its relative order", () => {
    expect(order(arrangeComponents(scene(["a", "b", "c", "d"]), ["a", "c"], true))).toEqual(["b", "d", "a", "c"]);
  });

  it("sends the selection to the start of the list (back)", () => {
    expect(order(arrangeComponents(scene(["a", "b", "c", "d"]), ["d", "b"], false))).toEqual(["b", "d", "a", "c"]);
  });

  it("reorders a group's children inside the group", () => {
    const json = JSON.stringify({ layers: [{ items: [
      { type: "path", id: "p" },
      { type: "group", id: "g", children: [{ type: "path", id: "x" }, { type: "path", id: "y" }] },
    ] }] });
    const out = JSON.parse(arrangeComponents(json, ["x"], true)!) as { layers: { items: { id: string; children?: { id: string }[] }[] }[] };
    expect(out.layers[0].items.map((i) => i.id)).toEqual(["p", "g"]); // the group itself did not move
    expect(out.layers[0].items[1].children!.map((i) => i.id)).toEqual(["y", "x"]);
  });

  it("returns null when nothing would change, so the store can skip the undo step", () => {
    expect(arrangeComponents(scene(["a", "b"]), ["b"], true)).toBeNull(); // already in front
    expect(arrangeComponents(scene(["a", "b"]), ["a", "b"], false)).toBeNull(); // everything selected
    expect(arrangeComponents(scene(["a", "b"]), [], true)).toBeNull();
    expect(arrangeComponents("{nope", ["a"], true)).toBeNull();
  });

  it("keeps every other field of the scene intact", () => {
    const json = JSON.stringify({ units: "px", layers: [{ name: "L", items: [{ type: "rect", id: "a", width: 3 }, { type: "path", id: "b" }] }] });
    const out = JSON.parse(arrangeComponents(json, ["a"], true)!);
    expect(out.units).toBe("px");
    expect(out.layers[0].name).toBe("L");
    expect(out.layers[0].items[1]).toEqual({ type: "rect", id: "a", width: 3 });
  });
});
