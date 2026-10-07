// ─────────────────────────────────────────────────────────────
// ops/clip-mask.test — Object ▸ Clipping Mask ▸ Make / Release (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Clipping masks" — the TOP-MOST selected object
// becomes the clipping path; "Regardless of its previous attributes, a clipping
// mask changes to an object with no fill or stroke", and it stays unpainted
// after the mask is released.

import { describe, it, expect } from "vitest";
import { makeDocument, makeGroup, makeRect, Ops, Query, IO, solid, rgba } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);

/** a (bottom, red, big) + b (top, blue, small). Returns [doc, a, b]. */
const setup = () => {
  const doc = makeDocument("C", 200, 200);
  const a = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
  const b = makeRect(20, 20, 60, 60, 0, 0, { fill: solid(BLUE) });
  Ops.Items.addItem(doc, a); // bottom
  Ops.Items.addItem(doc, b); // top
  return { doc, a, b };
};

describe("ops.group — Make Clipping Mask", () => {
  it("makes the TOP-MOST object the clip path and strips its fill + stroke", () => {
    const { doc, b } = setup();
    const gid = Ops.Group.makeClipGroup(doc, [doc.layers[0].items[0].id, b.id])!;
    const g = Query.getItem(doc, gid)!;
    expect(g.type).toBe("group");
    if (g.type !== "group") return;
    expect(g.clip).toBe(true);
    expect(g.children.length).toBe(2);
    // children[0] is the clip path = the former top object (b)
    expect(g.children[0].id).toBe(b.id);
    expect(g.children[0].fill.type).toBe("none"); // appearance stripped
    expect(g.children[0].stroke.paint.type).toBe("none");
    // the clipped content keeps its own paint
    expect(g.children[1].fill).toEqual(solid(RED));
  });

  it("still clips: exporting the group yields a <clipPath>", () => {
    const { doc, b } = setup();
    Ops.Group.makeClipGroup(doc, [doc.layers[0].items[0].id, b.id]);
    const svg = IO.exportSVG(doc, { background: true });
    expect(svg).toContain("<clipPath");
    expect(svg).toContain("clip-path=");
  });
});

describe("ops.group — Release Clipping Mask", () => {
  it("dissolves the group and leaves the former clip path UNPAINTED", () => {
    const { doc, b } = setup();
    const gid = Ops.Group.makeClipGroup(doc, [doc.layers[0].items[0].id, b.id])!;
    const released = Ops.Group.releaseClipGroup(doc, [gid]);
    expect(released.length).toBe(2);
    expect(Query.getItem(doc, gid)).toBeNull(); // group dissolved
    // the former clipping path (b) survives but stays with no fill / no stroke
    const formerClip = Query.getItem(doc, b.id)!;
    expect(formerClip.fill.type).toBe("none");
    expect(formerClip.stroke.paint.type).toBe("none");
  });

  it("deleting the mask clears clip instead of promoting the next child (#362)", () => {
    const doc = makeDocument();
    const mask = makeRect(0, 0, 100, 100);
    const a = makeRect(10, 10, 20, 20);
    const b = makeRect(20, 20, 20, 20);
    const clip = makeGroup([mask, a, b]);
    clip.clip = true;
    Ops.Items.addItem(doc, clip);

    Ops.Items.removeItems(doc, [mask.id]);
    expect(clip.clip).toBe(false);
    expect(clip.children.map((child) => child.id)).toEqual([a.id, b.id]);
  });
});
