// ─────────────────────────────────────────────────────────────
// select-inverse.test — Select ▸ Inverse (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Select ▸ Inverse" selects every selectable object
// that is NOT currently selected (visible + unlocked, on a visible + unlocked
// layer) and deselects the ones that were.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query, solid, rgba } from "./index";

const setup = () => {
  const doc = makeDocument();
  const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const b = makeRect(50, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 220, 0)) });
  const c = makeRect(100, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 0, 220)) });
  Ops.Items.addItem(doc, a);
  Ops.Items.addItem(doc, b);
  Ops.Items.addItem(doc, c);
  return { doc, a, b, c };
};

describe("query.selectInverse", () => {
  it("selects the unselected objects (one selected → the other two)", () => {
    const { doc, a, b, c } = setup();
    expect(Query.selectInverse(doc, [a.id]).sort()).toEqual([b.id, c.id].sort());
  });

  it("inverse of everything is empty", () => {
    const { doc, a, b, c } = setup();
    expect(Query.selectInverse(doc, [a.id, b.id, c.id])).toEqual([]);
  });

  it("inverse of nothing is everything", () => {
    const { doc, a, b, c } = setup();
    expect(Query.selectInverse(doc, []).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("excludes locked and hidden objects from the universe", () => {
    const { doc, a, b, c } = setup();
    Query.getItem(doc, b.id)!.locked = true;
    Query.getItem(doc, c.id)!.visible = false;
    expect(Query.selectInverse(doc, [])).toEqual([a.id]); // only a is selectable
  });

  it("excludes objects on a hidden or locked layer", () => {
    const { doc } = setup();
    doc.layers[0].visible = false;
    expect(Query.selectInverse(doc, [])).toEqual([]);
  });
});
