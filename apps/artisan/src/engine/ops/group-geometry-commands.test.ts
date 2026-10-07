// Geometry commands accept selected containers by operating on their authorable leaves.

import { describe, expect, it } from "vitest";
import { Ops, Query, makeAnchor as anchor, makeDocument, makeGroup, makePath, makeRect, type Document, type PathItem } from "../index";

const setup = () => {
  const doc = makeDocument();
  const path = makePath({
    closed: true,
    anchors: [
      anchor({ x: 0, y: 0 }),
      anchor({ x: 50, y: 0 }),
      anchor({ x: 100, y: 0 }),
      anchor({ x: 100, y: 100 }),
      anchor({ x: 0, y: 100 }),
    ],
  });
  const group = makeGroup([path]);
  Ops.Items.addItem(doc, group);
  return { doc, group, path };
};

const geometry = (doc: Document, id: string) => (Query.getItem(doc, id) as PathItem).geometry;

describe("group-selected geometry commands", () => {
  it.each([
    ["Round Corners", (doc: Document, id: string) => Ops.RoundCorners.roundCorners(doc, [id], 8)],
    ["Reverse Path", (doc: Document, id: string) => Ops.ReversePath.reversePath(doc, [id])],
    ["Simplify", (doc: Document, id: string) => Ops.Simplify.simplify(doc, [id], { tolerance: 1 })],
    ["Free Distort", (doc: Document, id: string) => Ops.FreeDistort.freeDistort(doc, [id], {
      topLeft: { x: 0, y: 0 }, topRight: { x: 1.2, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 },
    })],
    ["Pucker & Bloat", (doc: Document, id: string) => Ops.PuckerBloat.puckerBloat(doc, [id], 0.5)],
    ["Roughen", (doc: Document, id: string) => Ops.Roughen.roughen(doc, [id], { size: 4, detail: 1, seed: 2 })],
    ["Tweak", (doc: Document, id: string) => Ops.Tweak.tweak(doc, [id], { horizontal: 4, vertical: 3, seed: 2 })],
    ["Twist", (doc: Document, id: string) => Ops.Twist.twist(doc, [id], Math.PI / 2)],
    ["Zig Zag", (doc: Document, id: string) => Ops.ZigZag.zigZag(doc, [id], { size: 5, ridges: 1 })],
  ] as const)("%s edits the nested path", (_name, run) => {
    const { doc, group, path } = setup();
    const before = JSON.stringify(geometry(doc, path.id));

    expect(run(doc, group.id)).toEqual([path.id]);
    expect(JSON.stringify(geometry(doc, path.id))).not.toBe(before);
  });

  it("Offset Path inserts the result next to the nested source", () => {
    const { doc, group, path } = setup();

    const result = Ops.OffsetPath.offsetPath(doc, [group.id], { distance: 5 });

    expect(result).toHaveLength(1);
    expect(group.children.map((item) => item.id)).toEqual([path.id, result[0]]);
  });

  it("does not edit generated mesh children", () => {
    const doc = makeDocument();
    const rect = makeRect(0, 0, 100, 100);
    Ops.Items.addItem(doc, rect);
    const meshId = Ops.Meshes.createMeshFromItem(doc, rect.id)!;
    const mesh = Query.getItem(doc, meshId)!;
    const before = JSON.stringify(mesh);

    expect(Ops.Roughen.roughen(doc, [meshId], { size: 4, detail: 1 })).toEqual([]);
    expect(JSON.stringify(Query.getItem(doc, meshId))).toBe(before);
  });
});
