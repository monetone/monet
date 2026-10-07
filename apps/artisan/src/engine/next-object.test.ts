// ─────────────────────────────────────────────────────────────
// next-object.test — Select ▸ Next Object Above / Below (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Select ▸ Next Object Above / Below" (⌥⌘] / ⌥⌘[)
// — moves the selection to the sibling directly in front of / behind the current
// object in the SAME container's paint order. It does not wrap and does not cross
// out of a group. Paint order = the container array: index 0 is the back-most.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query } from "./index";

// Three rects added back-to-front: a (index 0, back) · b (1) · c (2, front).
const stack = () => {
  const doc = makeDocument();
  const a = makeRect(0, 0, 10, 10);
  const b = makeRect(0, 0, 10, 10);
  const c = makeRect(0, 0, 10, 10);
  Ops.Items.addItems(doc, [a, b, c]);
  return { doc, a, b, c };
};

describe("Query.nextObject", () => {
  it("'above' walks toward the front, 'below' toward the back", () => {
    const { doc, a, b, c } = stack();
    expect(Query.nextObject(doc, b.id, "above")).toBe(c.id);
    expect(Query.nextObject(doc, b.id, "below")).toBe(a.id);
    expect(Query.nextObject(doc, a.id, "above")).toBe(b.id);
    expect(Query.nextObject(doc, c.id, "below")).toBe(b.id);
  });

  it("returns null at the front/back of the container (no wrap)", () => {
    const { doc, a, c } = stack();
    expect(Query.nextObject(doc, c.id, "above")).toBeNull(); // c is front-most
    expect(Query.nextObject(doc, a.id, "below")).toBeNull(); // a is back-most
  });

  it("navigates within a group and never escapes it", () => {
    const doc = makeDocument();
    const x = makeRect(0, 0, 10, 10);
    const y = makeRect(0, 0, 10, 10);
    const g = makeGroup([x, y]); // group children: x (back) · y (front)
    const z = makeRect(0, 0, 10, 10);
    Ops.Items.addItems(doc, [g, z]); // top level: g (back) · z (front)
    expect(Query.nextObject(doc, x.id, "above")).toBe(y.id); // sibling inside the group
    expect(Query.nextObject(doc, y.id, "above")).toBeNull(); // front of the group → does NOT jump to z
    expect(Query.nextObject(doc, g.id, "above")).toBe(z.id); // the group itself navigates at the top level
  });

  it("skips hidden and locked siblings (they can't be selected)", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    const hidden = makeRect(0, 0, 10, 10);
    hidden.visible = false;
    const locked = makeRect(0, 0, 10, 10);
    locked.locked = true;
    const c = makeRect(0, 0, 10, 10);
    Ops.Items.addItems(doc, [a, hidden, locked, c]); // a · hidden · locked · c
    expect(Query.nextObject(doc, a.id, "above")).toBe(c.id); // steps over hidden + locked
    expect(Query.nextObject(doc, c.id, "below")).toBe(a.id); // and back the other way
  });

  it("returns null when every sibling beyond the boundary is unselectable", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    const hidden = makeRect(0, 0, 10, 10);
    hidden.visible = false;
    Ops.Items.addItems(doc, [a, hidden]);
    expect(Query.nextObject(doc, a.id, "above")).toBeNull(); // only sibling above is hidden
  });

  it("navigates two levels of nesting without escaping the inner group", () => {
    const doc = makeDocument();
    const p = makeRect(0, 0, 10, 10);
    const q = makeRect(0, 0, 10, 10);
    const inner = makeGroup([p, q]);
    const r = makeRect(0, 0, 10, 10);
    const outer = makeGroup([inner, r]); // outer children: inner (back) · r (front)
    Ops.Items.addItems(doc, [outer]);
    expect(Query.nextObject(doc, p.id, "above")).toBe(q.id); // siblings inside inner
    expect(Query.nextObject(doc, q.id, "above")).toBeNull(); // front of inner → does NOT escape to r
    expect(Query.nextObject(doc, inner.id, "above")).toBe(r.id); // inner navigates within outer
    expect(Query.nextObject(doc, inner.id, "below")).toBeNull(); // back of outer
  });

  it("returns null for a missing object", () => {
    const { doc } = stack();
    expect(Query.nextObject(doc, "nope", "above")).toBeNull();
  });
});
