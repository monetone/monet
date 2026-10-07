// ─────────────────────────────────────────────────────────────
// ops/expand.test — Object ▸ Expand (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Object ▸ Expand" turns live appearance into plain
// editable geometry. We route per leaf: a stroked object is outlined (fill +
// stroke → grouped filled paths), an un-stroked live shape becomes an editable
// path, and already-plain paths are left alone. Groups are descended into.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makePath, makeGroup, makeAnchor as anchor, Ops, Query, solid, noPaint, defaultStroke, rgba } from "../index";
import type { GroupItem, PathItem } from "../index";

const RED = rgba(220, 0, 0);
const BLACK = rgba(0, 0, 0);
const noStroke = () => defaultStroke(noPaint());
const stroked = () => ({ ...defaultStroke(solid(BLACK)), width: 4 });
const wb = (doc: ReturnType<typeof makeDocument>, id: string) => Query.worldBounds(doc, id)!;

describe("ops.pathEdit.expand", () => {
  it("converts an un-stroked live shape into an editable path (same id, paint kept)", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED), stroke: noStroke() });
    Ops.Items.addItem(doc, r);
    const out = Ops.PathEdit.expand(doc, [r.id]);
    expect(out).toEqual([r.id]); // convertToPath keeps the id
    const it = Query.getItem(doc, r.id)!;
    expect(it.type).toBe("path");
    expect((it as PathItem).geometry.anchors).toHaveLength(4); // rect corners
    expect(it.fill.type === "solid" ? it.fill.color : null).toEqual({ r: 220, g: 0, b: 0, a: 1 });
    expect(wb(doc, r.id)).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("outlines a stroked object into a group of [fill, stroke-outline] filled paths", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED), stroke: stroked() });
    Ops.Items.addItem(doc, r);
    const out = Ops.PathEdit.expand(doc, [r.id]);
    expect(out).toHaveLength(1);
    const grp = Query.getItem(doc, out[0]) as GroupItem;
    expect(grp.type).toBe("group");
    expect(grp.children).toHaveLength(2);
    const fills = grp.children.map((c) => (c.fill.type === "solid" ? c.fill.color : null));
    expect(fills).toContainEqual({ r: 220, g: 0, b: 0, a: 1 }); // the fill piece
    expect(fills).toContainEqual({ r: 0, g: 0, b: 0, a: 1 }); // the stroke outline, filled with the stroke colour
    expect(Query.getItem(doc, r.id)).toBeFalsy(); // original replaced
  });

  it("outlines a live shape whose stroke exists only in its appearance stack", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: noPaint(), stroke: noStroke() });
    r.appearance = { entries: [
      { id: "none", kind: "stroke", stroke: noStroke() },
      { id: "visible", kind: "stroke", stroke: { ...defaultStroke(solid(BLACK)), width: 20 } },
    ] };
    Ops.Items.addItem(doc, r);

    const out = Ops.PathEdit.expand(doc, [r.id]);

    expect(out).toHaveLength(1);
    expect(Query.getItem(doc, out[0])!.type).toBe("compound");
  });

  it("leaves an already-plain un-stroked path untouched", () => {
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 })] }, { fill: solid(RED), stroke: noStroke() });
    Ops.Items.addItem(doc, p);
    const out = Ops.PathEdit.expand(doc, [p.id]);
    expect(out).toEqual([p.id]);
    const it = Query.getItem(doc, p.id)!;
    expect(it.type).toBe("path");
    expect((it as PathItem).geometry.anchors).toHaveLength(3); // unchanged
  });

  it("descends into a selected group and expands its live shapes in place", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: noStroke() });
    const b = makeRect(60, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: noStroke() });
    const g = makeGroup([a, b]);
    Ops.Items.addItem(doc, g);
    const out = Ops.PathEdit.expand(doc, [g.id]);
    expect(out.slice().sort()).toEqual([a.id, b.id].sort()); // the leaf shapes
    const grp = Query.getItem(doc, g.id) as GroupItem;
    expect(grp.type).toBe("group"); // group preserved
    expect(grp.children.map((c) => c.type)).toEqual(["path", "path"]); // both expanded
  });

  it("outlines the stroke of a plain stroked path too", () => {
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] }, { fill: solid(RED), stroke: stroked() });
    Ops.Items.addItem(doc, p);
    const out = Ops.PathEdit.expand(doc, [p.id]);
    expect(out).toHaveLength(1);
    expect(Query.getItem(doc, out[0])!.type).toBe("group");
  });

  it("preserves opacity and blend mode through the live-shape → path route", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED), stroke: noStroke() });
    r.opacity = 0.5;
    r.blendMode = "multiply";
    Ops.Items.addItem(doc, r);
    Ops.PathEdit.expand(doc, [r.id]);
    const it = Query.getItem(doc, r.id)!;
    expect(it.opacity).toBe(0.5);
    expect(it.blendMode).toBe("multiply");
  });

  it("carries opacity + blend mode onto the outlined GROUP (children stay neutral)", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED), stroke: stroked() });
    r.opacity = 0.5;
    r.blendMode = "multiply";
    Ops.Items.addItem(doc, r);
    const out = Ops.PathEdit.expand(doc, [r.id]);
    const grp = Query.getItem(doc, out[0]) as GroupItem;
    expect(grp.opacity).toBe(0.5); // group composites at the source opacity…
    expect(grp.blendMode).toBe("multiply");
    expect(grp.children.every((c) => c.opacity === 1)).toBe(true); // …so children must not double it
  });

  it("dedupes leaves reached twice (same id, or a group + its child)", () => {
    const docA = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: noStroke() });
    Ops.Items.addItem(docA, r);
    expect(Ops.PathEdit.expand(docA, [r.id, r.id])).toEqual([r.id]);

    const docB = makeDocument();
    const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: noStroke() });
    const b = makeRect(60, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: noStroke() });
    const g = makeGroup([a, b]);
    Ops.Items.addItem(docB, g);
    expect(Ops.PathEdit.expand(docB, [g.id, a.id]).slice().sort()).toEqual([a.id, b.id].sort());
  });

  it("expands a mixed selection: a live shape becomes a path, a stroked path becomes a group", () => {
    const doc = makeDocument();
    const shape = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: noStroke() });
    const strokedPath = makePath(
      { closed: true, anchors: [anchor({ x: 60, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 40 }), anchor({ x: 60, y: 40 })] },
      { fill: solid(RED), stroke: stroked() },
    );
    Ops.Items.addItems(doc, [shape, strokedPath]);
    const out = Ops.PathEdit.expand(doc, [shape.id, strokedPath.id]);
    expect(Query.getItem(doc, shape.id)!.type).toBe("path"); // live shape converted in place
    expect(Query.getItem(doc, strokedPath.id)).toBeFalsy(); // stroked path replaced by a group
    expect(out).toHaveLength(2);
    expect(out).toContain(shape.id);
    const groupId = out.find((id) => id !== shape.id)!;
    expect(Query.getItem(doc, groupId)!.type).toBe("group");
  });
});
