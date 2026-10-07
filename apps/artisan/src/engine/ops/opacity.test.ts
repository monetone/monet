// ─────────────────────────────────────────────────────────────
// ops/opacity.test — object Opacity (Transparency panel) parity
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator → Window ▸ Transparency (or the Control/
// Properties bar "Opacity" field). Opacity is a single 0–100 % value applied to
// the WHOLE selected object/group as a unit (a group composites first, then the
// group's opacity is applied — it does NOT multiply onto each child). It maps
// 1:1 to SVG's element-level `opacity` attribute (0..1). A slider drag is ONE
// undoable history step.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query, IO, ArtisanStore, solid, rgba } from "../index";

const RED = solid(rgba(220, 0, 0));

describe("Ops.Items.setOpacity — clamp + targeting", () => {
  it("clamps below 0 → 0 and above 1 → 1", () => {
    const doc = makeDocument();
    const r = makeRect(10, 10, 40, 40, 0, 0, { fill: RED });
    doc.layers[0].items.push(r);
    Ops.Items.setOpacity(doc, [r.id], -0.5);
    expect((Query.getItem(doc, r.id) as { opacity: number }).opacity).toBe(0);
    Ops.Items.setOpacity(doc, [r.id], 1.7);
    expect((Query.getItem(doc, r.id) as { opacity: number }).opacity).toBe(1);
    Ops.Items.setOpacity(doc, [r.id], 0.37);
    expect((Query.getItem(doc, r.id) as { opacity: number }).opacity).toBeCloseTo(0.37, 6);
  });

  it("sets the targeted item only — a sibling is untouched", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 20, 20, 0, 0, { fill: RED });
    const b = makeRect(40, 0, 20, 20, 0, 0, { fill: RED });
    doc.layers[0].items.push(a, b);
    Ops.Items.setOpacity(doc, [a.id], 0.5);
    expect((Query.getItem(doc, a.id) as { opacity: number }).opacity).toBe(0.5);
    expect((Query.getItem(doc, b.id) as { opacity: number }).opacity).toBe(1);
  });

  it("sets GROUP-level opacity as a unit — children keep their own opacity (Illustrator parity)", () => {
    const doc = makeDocument();
    const child = makeRect(0, 0, 20, 20, 0, 0, { fill: RED });
    const g = makeGroup([child]);
    doc.layers[0].items.push(g);
    Ops.Items.setOpacity(doc, [g.id], 0.4);
    expect((Query.getItem(doc, g.id) as { opacity: number }).opacity).toBe(0.4);
    // The group composites first; its opacity is NOT pushed down onto the child.
    expect((Query.getItem(doc, child.id) as { opacity: number }).opacity).toBe(1);
  });

  it("applies to every id in a multi-selection at once", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 20, 20, 0, 0, { fill: RED });
    const b = makeRect(40, 0, 20, 20, 0, 0, { fill: RED });
    doc.layers[0].items.push(a, b);
    Ops.Items.setOpacity(doc, [a.id, b.id], 0.25);
    expect((Query.getItem(doc, a.id) as { opacity: number }).opacity).toBe(0.25);
    expect((Query.getItem(doc, b.id) as { opacity: number }).opacity).toBe(0.25);
  });
});

describe("Opacity — slider drag is one undoable transaction", () => {
  it("a begin → many mutate → end drag commits the final value as ONE undo step", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(10, 10, 40, 40, 0, 0, { fill: RED });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);

    // Mirror properties-panel.onOpacity/onOpacityEnd: one beginTransaction, a
    // stream of mutate() frames as the thumb moves, one endTransaction.
    store.beginTransaction("Opacity");
    for (const v of [0.8, 0.6, 0.45]) store.mutate((d) => Ops.Items.setOpacity(d, [r.id], v));
    store.endTransaction();

    const op = () => (Query.getItem(store.getState().doc, r.id) as { opacity: number }).opacity;
    expect(op()).toBeCloseTo(0.45, 6);
    store.undo(); // a single undo restores the pre-drag value
    expect(op()).toBe(1);
  });
});

describe("Opacity — SVG export (1:1 element opacity)", () => {
  it("opacity 0.5 emits opacity=\"0.5\" on the item; full opacity emits no attr", () => {
    const doc = makeDocument();
    const r = makeRect(20, 20, 60, 40, 0, 0, { fill: RED });
    doc.layers[0].items.push(r);

    Ops.Items.setOpacity(doc, [r.id], 0.5);
    expect(IO.exportSVG(doc)).toMatch(/\sopacity="0\.5"/);

    Ops.Items.setOpacity(doc, [r.id], 1);
    expect(IO.exportSVG(doc)).not.toMatch(/\sopacity="/);
  });
});
