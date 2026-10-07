// ─────────────────────────────────────────────────────────────
// ops/trim-marks.test — Object ▸ Create Trim Marks (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Create Trim Marks — adds 8 printer's marks (2 per
// corner) around the selection's bounding box, offset outward so they don't
// cross the artwork, grouped as one object; the artwork itself is preserved.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query, solid, rgba } from "../index";
import type { GroupItem, LineItem } from "../index";

const RED = rgba(220, 0, 0);
const groupOf = (doc: ReturnType<typeof makeDocument>, id: string): GroupItem => {
  const it = Query.getItem(doc, id)!;
  if (it.type !== "group") throw new Error("not a group");
  return it;
};
const lineSegs = (g: GroupItem) => (g.children as LineItem[]).map((l) => [l.x1, l.y1, l.x2, l.y2].join(","));

describe("ops.trim-marks.trimMarks", () => {
  it("adds a Trim Marks group of 8 line marks and keeps the artwork", () => {
    const doc = makeDocument();
    const r = makeRect(100, 100, 200, 150, 0, 0, { fill: solid(RED) }); // bbox 100,100..300,250
    Ops.Items.addItem(doc, r);

    const gid = Ops.TrimMarks.trimMarks(doc, [r.id], { length: 18, offset: 3 });
    expect(gid).toBeTruthy();
    const g = groupOf(doc, gid!);
    expect(g.name).toBe("Trim Marks");
    expect(g.children).toHaveLength(8);
    expect(g.children.every((c) => c.type === "line")).toBe(true);
    expect(doc.layers[0].items).toHaveLength(2); // rect kept + marks group
    expect(Query.getItem(doc, r.id)).toBeTruthy();
  });

  it("places the eight marks at the expected corner positions", () => {
    const doc = makeDocument();
    const r = makeRect(100, 100, 200, 150, 0, 0, { fill: solid(RED) }); // L100 T100 R300 B250
    Ops.Items.addItem(doc, r);
    const g = groupOf(doc, Ops.TrimMarks.trimMarks(doc, [r.id], { length: 18, offset: 3 })!);
    const segs = lineSegs(g);
    expect(segs).toContain("79,100,97,100"); // top-left horizontal (L-o-n → L-o)
    expect(segs).toContain("100,79,100,97"); // top-left vertical (T-o-n → T-o)
    expect(segs).toContain("303,250,321,250"); // bottom-right horizontal (R+o → R+o+n)
    expect(segs).toContain("300,253,300,271"); // bottom-right vertical (B+o → B+o+n)
  });

  it("marks carry a black stroke and no fill", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    const g = groupOf(doc, Ops.TrimMarks.trimMarks(doc, [r.id])!);
    const mark = g.children[0] as LineItem;
    expect(mark.fill.type).toBe("none");
    expect(mark.stroke.paint).toEqual(solid({ r: 0, g: 0, b: 0, a: 1 }));
  });

  it("offset 0 puts the marks flush against the bounding box", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) }); // L0 T0 R100 B100
    Ops.Items.addItem(doc, r);
    const g = groupOf(doc, Ops.TrimMarks.trimMarks(doc, [r.id], { length: 10, offset: 0 })!);
    const segs = lineSegs(g);
    expect(segs).toContain("-10,0,0,0"); // top-left horizontal touches the corner
    expect(segs).toContain("0,-10,0,0"); // top-left vertical touches the corner
  });

  it("uses the combined bounds of a multi-object selection", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 50, 50, 0, 0, { fill: solid(RED) });
    const b = makeRect(150, 100, 50, 50, 0, 0, { fill: solid(RED) }); // combined bbox 0,0..200,150
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    const g = groupOf(doc, Ops.TrimMarks.trimMarks(doc, [a.id, b.id], { length: 10, offset: 0 })!);
    const segs = lineSegs(g);
    expect(segs).toContain("200,150,210,150"); // bottom-right horizontal at combined R/B
  });

  it("returns null for an empty selection", () => {
    const doc = makeDocument();
    expect(Ops.TrimMarks.trimMarks(doc, [])).toBeNull();
    expect(doc.layers[0].items).toHaveLength(0);
  });
});
