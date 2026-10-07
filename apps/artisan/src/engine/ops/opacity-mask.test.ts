// ─────────────────────────────────────────────────────────────
// ops/opacity-mask.test — Make / Release Opacity Mask (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator opacity masks apply to a SINGLE item, so when
// several objects are selected the front-most becomes the mask and everything
// below it is GROUPED and masked as a whole. The mask's luminance drives the
// target's opacity; releasing restores the mask object.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeEllipse, Ops, Query } from "../index";

describe("ops.group — Make Opacity Mask (multiple objects below)", () => {
  it("groups all objects below the mask and masks the group", () => {
    const doc = makeDocument("M", 200, 200);
    const t1 = makeRect(0, 0, 50, 50);
    const t2 = makeRect(60, 0, 50, 50);
    const mask = makeEllipse(10, 5, 110, 50); // front-most = the mask
    Ops.Items.addItems(doc, [t1, t2, mask]); // mask on top
    const gid = Ops.Group.makeOpacityMask(doc, [t1.id, t2.id, mask.id])!;

    const g = Query.getItem(doc, gid)!;
    expect(g.type).toBe("group");
    if (g.type !== "group") return;
    expect(g.children.map((c) => c.id)).toEqual([t1.id, t2.id]); // both targets grouped
    expect(g.mask?.length).toBe(1); // the group carries the opacity mask
    expect(g.mask?.[0].id).toBe(mask.id);
    expect(Query.getItem(doc, mask.id)).toBeNull(); // mask left the layer (lives on .mask)
    expect(doc.layers[0].items.length).toBe(1); // [group] only
  });

  it("preserves the mask's world position (group has identity transform)", () => {
    const doc = makeDocument("M", 200, 200);
    const t1 = makeRect(0, 0, 50, 50);
    const t2 = makeRect(60, 0, 50, 50);
    const mask = makeEllipse(10, 5, 110, 50);
    Ops.Items.addItems(doc, [t1, t2, mask]);
    const gid = Ops.Group.makeOpacityMask(doc, [t1.id, t2.id, mask.id])!;
    const g = Query.getItem(doc, gid)!;
    if (g.type !== "group") return;
    expect([g.mask![0].transform.e, g.mask![0].transform.f]).toEqual([10, 5]); // unchanged
  });

  it("releases a grouped opacity mask: restores the mask, keeps the group", () => {
    const doc = makeDocument("M", 200, 200);
    const t1 = makeRect(0, 0, 50, 50);
    const t2 = makeRect(60, 0, 50, 50);
    const mask = makeEllipse(10, 5, 110, 50);
    Ops.Items.addItems(doc, [t1, t2, mask]);
    const gid = Ops.Group.makeOpacityMask(doc, [t1.id, t2.id, mask.id])!;

    const released = Ops.Group.releaseOpacityMask(doc, [gid]);
    expect(released).toContain(mask.id);
    expect(Query.getItem(doc, gid)?.mask).toBeUndefined(); // mask cleared
    expect(Query.getItem(doc, mask.id)).not.toBeNull(); // mask restored to the layer
    expect(Query.getItem(doc, gid)?.type).toBe("group"); // content stays grouped
  });

  it("single object below the mask is NOT wrapped in a group", () => {
    const doc = makeDocument("M", 100, 100);
    const target = makeRect(0, 0, 50, 50);
    const mask = makeEllipse(0, 0, 50, 50);
    Ops.Items.addItems(doc, [target, mask]);
    const tid = Ops.Group.makeOpacityMask(doc, [target.id, mask.id])!;
    expect(tid).toBe(target.id); // the target itself, no group
    expect(Query.getItem(doc, target.id)?.mask?.length).toBe(1);
  });
});
