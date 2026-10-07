// ─────────────────────────────────────────────────────────────
// ops/group.test — Object ▸ Group / Ungroup (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Group or ungroup objects" — grouping places the
// group at the stacking position of the FRONTMOST selected object (objects above
// the selection stay above the group); ungrouping bakes the group's transform
// into its children so they stay visually put.

import { describe, it, expect } from "vitest";
import { defaultStroke, makeDocument, makeGroup, makeRect, noPaint, Ops, paintedFill, Query, rgba, solid } from "../index";

/** Four rects added bottom→top: items = [A, B, C, D]. */
const fourRects = () => {
  const doc = makeDocument();
  const r = ["A", "B", "C", "D"].map((_, i) => makeRect(i * 20, 0, 10, 10));
  Ops.Items.addItems(doc, r);
  return { doc, ids: r.map((x) => x.id) };
};
const topIds = (doc: ReturnType<typeof makeDocument>) =>
  doc.layers[0].items.map((it) => (it.type === "group" ? "G" : it.id));

describe("ops.group — z-order placement", () => {
  it("drops the group at the frontmost selected object's position", () => {
    const { doc, ids } = fourRects();
    const [A, B, C, D] = ids;
    const gid = Ops.Group.group(doc, [A, C])!; // group a NON-top subset
    // Illustrator: group sits where C was (index 1); D stays above it.
    expect(topIds(doc)).toEqual([B, "G", D]);
    const g = Query.getItem(doc, gid)!;
    expect(g.type === "group" && g.children.map((c) => c.id)).toEqual([A, C]); // bottom→top order kept
  });

  it("keeps the group on top when the selection includes the top object", () => {
    const { doc, ids } = fourRects();
    const [A, B, C, D] = ids;
    Ops.Group.group(doc, [C, D]);
    expect(topIds(doc)).toEqual([A, B, "G"]);
  });

  it("collapses the whole selection into a single group", () => {
    const { doc, ids } = fourRects();
    Ops.Group.group(doc, ids);
    expect(doc.layers[0].items.length).toBe(1);
    expect(doc.layers[0].items[0].type).toBe("group");
  });

  it("groups a middle pair without floating it above unselected art", () => {
    const { doc, ids } = fourRects();
    const [, B, C] = ids;
    Ops.Group.group(doc, [B, C]); // indices 1,2 → group at index 1
    expect(topIds(doc)).toEqual([ids[0], "G", ids[3]]);
  });

  it("can regroup every child of an existing group without detaching the result", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(20, 0, 10, 10);
    const parent = makeGroup([a, b]);
    Ops.Items.addItem(doc, parent);

    const id = Ops.Group.group(doc, [a.id, b.id])!;

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].id).toBe(id);
    expect(Query.getItem(doc, id)).not.toBeNull();
  });
});

describe("ops.group — ungroup", () => {
  it("dissolves the group and restores the children", () => {
    const { doc, ids } = fourRects();
    const gid = Ops.Group.group(doc, [ids[0], ids[1]])!;
    expect(doc.layers[0].items.length).toBe(3);
    Ops.Group.ungroup(doc, [gid]);
    expect(doc.layers[0].items.length).toBe(4);
  });

  it("bakes the group transform into children so they stay put", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(40, 0, 10, 10);
    Ops.Items.addItems(doc, [a, b]);
    const gid = Ops.Group.group(doc, [a.id, b.id])!;
    Ops.Transform.translateItems(doc, [gid], 100, 50); // move the group
    const aWorldBefore = Query.worldBounds(doc, a.id)!;
    expect([aWorldBefore.x, aWorldBefore.y]).toEqual([100, 50]);
    Ops.Group.ungroup(doc, [gid]);
    const aWorldAfter = Query.worldBounds(doc, a.id)!;
    expect([aWorldAfter.x, aWorldAfter.y]).toEqual([100, 50]); // unchanged by ungroup
  });

  it("refuses to discard Envelope or Perspective source artwork", () => {
    const envelopeDoc = makeDocument();
    const envelopeSource = makeRect(0, 0, 100, 100, 0, 0, { name: "Original" });
    Ops.Items.addItem(envelopeDoc, envelopeSource);
    const envelopeId = Ops.Envelope.makeWithWarp(envelopeDoc, [envelopeSource.id], { style: "arc", bend: 0.5 })!;

    const perspectiveDoc = makeDocument();
    const perspectiveSource = makeRect(0, 0, 100, 100, 0, 0, { name: "Original" });
    Ops.Items.addItem(perspectiveDoc, perspectiveSource);
    const perspectiveId = Ops.Perspective.makePerspectiveGroup(perspectiveDoc, [perspectiveSource.id])!;

    for (const [doc, id] of [[envelopeDoc, envelopeId], [perspectiveDoc, perspectiveId]] as const) {
      expect(Ops.Group.canUngroup(doc, [id])).toBe(false);
      expect(Ops.Group.ungroup(doc, [id])).toEqual([]);
      expect(Query.getItem(doc, id)?.type).toBe("group");
    }
  });
});

describe("ops.group — clipping masks", () => {
  it("removes an Appearance stack from the clipping path", () => {
    const doc = makeDocument();
    const content = makeRect(0, 0, 100, 100);
    const mask = makeRect(10, 10, 80, 80, 0, 0, { fill: solid(rgba(255, 0, 0)) });
    mask.appearance = {
      entries: [
        { id: "painted-fill", kind: "fill", paint: solid(rgba(0, 0, 255)) },
        { id: "painted-stroke", kind: "stroke", stroke: defaultStroke(solid(rgba(0, 0, 255))) },
      ],
    };
    Ops.Items.addItems(doc, [content, mask]);

    const clipId = Ops.Group.makeClipGroup(doc, [content.id, mask.id])!;
    const clip = Query.getItem(doc, clipId);
    expect(clip?.type).toBe("group");
    const clipPath = (clip as ReturnType<typeof makeGroup>).children[0];
    expect(clipPath.appearance).toBeUndefined();
    expect(paintedFill(clipPath)).toEqual(noPaint());

    Ops.Group.releaseClipGroup(doc, [clipId]);
    expect(paintedFill(mask)).toEqual(noPaint());
  });
});

describe("ops.group — enablement parity (AR-H6)", () => {
  it("is a no-op for a single-item selection (matches the menu disabling at <2)", () => {
    const { doc, ids } = fourRects();
    const before = doc.layers[0].items.length;
    const gid = Ops.Group.group(doc, [ids[0]]);
    expect(gid).toBeNull(); // no 1-child group created
    expect(doc.layers[0].items.length).toBe(before);
    expect(doc.layers[0].items.some((it) => it.type === "group")).toBe(false);
  });
});
