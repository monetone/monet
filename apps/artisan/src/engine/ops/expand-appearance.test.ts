// ─────────────────────────────────────────────────────────────
// ops/expand-appearance.test — Object ▸ Expand Appearance
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Object ▸ Expand Appearance flattens a live
// appearance stack (several fills / strokes, per-entry opacity, blend mode and
// effects) into real objects — one per entry, in the same back-to-front order.
// An object with no explicit stack is left alone: plain fill+stroke belongs to
// Object ▸ Expand.

import { describe, expect, it } from "vitest";
import { Ops, Query, defaultStroke, makeDocument, makeGroup, makeRect, rgba, solid, type GroupItem } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const GREEN = rgba(0, 170, 80);
const BLACK = rgba(0, 0, 0);

const stackedRect = () => {
  const doc = makeDocument("Expand Appearance");
  const rect = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: defaultStroke(solid(BLACK)) });
  doc.layers[0].items.push(rect);
  // Promote to an explicit stack, then add a second fill and a second stroke.
  Ops.Appearance.updateEntry(doc, [rect.id], `${rect.id}:fill`, { paint: solid(RED) });
  Ops.Appearance.addFill(doc, [rect.id], solid(BLUE));
  Ops.Appearance.addStroke(doc, [rect.id], { ...defaultStroke(solid(GREEN)), width: 6 });
  return { doc, rect };
};

describe("ops.pathEdit.expandAppearance", () => {
  it("flattens appearance stacks inside nested selected groups", () => {
    const { doc, rect } = stackedRect();
    const inner = makeGroup([rect]);
    const outer = makeGroup([inner]);
    doc.layers[0].items = [outer];

    const out = Ops.PathEdit.expandAppearance(doc, [outer.id]);

    expect(out).toHaveLength(1);
    expect(inner.children).toHaveLength(1);
    expect(inner.children[0].id).toBe(out[0]);
    expect(Query.getItem(doc, rect.id)).toBeNull();
  });

  it("turns each appearance entry into its own object, in stack order", () => {
    const { doc, rect } = stackedRect();
    const entries = Query.getItem(doc, rect.id)!.appearance!.entries;
    const out = Ops.PathEdit.expandAppearance(doc, [rect.id]);

    expect(out).toHaveLength(1);
    const grp = Query.getItem(doc, out[0]) as GroupItem;
    expect(grp.type).toBe("group");
    expect(grp.children).toHaveLength(entries.length);
    expect(Query.getItem(doc, rect.id)).toBeFalsy(); // the live object is replaced
    // Every produced piece is real filled geometry with no live stack left.
    for (const c of grp.children) {
      expect(c.type).toBe("compound");
      expect(c.appearance).toBeUndefined();
      expect(c.stroke.paint.type).toBe("none");
      expect(c.fill.type).toBe("solid");
    }
  });

  it("fills keep their paint and strokes become outlines filled with the stroke colour", () => {
    const { doc, rect } = stackedRect();
    const out = Ops.PathEdit.expandAppearance(doc, [rect.id])[0];
    const colors = (Query.getItem(doc, out) as GroupItem).children.map((c) => (c.fill.type === "solid" ? c.fill.color : null));
    expect(colors).toContainEqual({ r: 220, g: 0, b: 0, a: 1 }); // fill entry
    expect(colors).toContainEqual({ r: 0, g: 0, b: 220, a: 1 }); // second fill
    expect(colors).toContainEqual({ r: 0, g: 170, b: 80, a: 1 }); // stroke entry → outline
  });

  it("carries per-entry opacity onto the produced object", () => {
    const { doc, rect } = stackedRect();
    const second = Query.getItem(doc, rect.id)!.appearance!.entries.find((e) => e.kind === "fill" && e.paint.type === "solid" && e.paint.color.b === 220)!;
    Ops.Appearance.updateEntry(doc, [rect.id], second.id, { opacity: 0.25 });

    const out = Ops.PathEdit.expandAppearance(doc, [rect.id])[0];
    const piece = (Query.getItem(doc, out) as GroupItem).children.find((c) => c.fill.type === "solid" && c.fill.color.b === 220)!;
    expect(piece.opacity).toBe(0.25);
  });

  it("keeps the object's own opacity and blend mode on the group", () => {
    const { doc, rect } = stackedRect();
    Ops.Items.setOpacity(doc, [rect.id], 0.5);
    const out = Ops.PathEdit.expandAppearance(doc, [rect.id])[0];
    const grp = Query.getItem(doc, out) as GroupItem;
    expect(grp.opacity).toBe(0.5);
  });

  it("carries an object-level effect onto the group exactly once", () => {
    // ensureAppearanceStack COPIES item.effects into scope:"object" placements
    // and leaves item.effects in place, so naively concatenating both sources
    // double-applies every effect — an feDropShadow chain shadowing its own shadow.
    const doc = makeDocument("Expand Appearance");
    const rect = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: defaultStroke(solid(BLACK)) });
    doc.layers[0].items.push(rect);
    Ops.Effects.addEffect(doc, [rect.id], { type: "drop-shadow", dx: 4, dy: 4, blur: 3, color: { r: 0, g: 0, b: 0, a: 0.5 } });
    Ops.Appearance.addFill(doc, [rect.id], solid(BLUE)); // promotes to an explicit stack

    const out = Ops.PathEdit.expandAppearance(doc, [rect.id])[0];
    const grp = Query.getItem(doc, out) as GroupItem;
    expect(grp.effects).toHaveLength(1);
    expect(grp.effects![0]).toMatchObject({ type: "drop-shadow", dx: 4, dy: 4 });
  });

  it("leaves an object with no explicit appearance stack untouched", () => {
    const doc = makeDocument("Expand Appearance");
    const rect = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: defaultStroke(solid(BLACK)) });
    doc.layers[0].items.push(rect);

    expect(Ops.PathEdit.expandAppearance(doc, [rect.id])).toEqual([]);
    expect(Query.getItem(doc, rect.id)).toBeTruthy();
  });

  it("skips hidden entries", () => {
    const { doc, rect } = stackedRect();
    const entries = Query.getItem(doc, rect.id)!.appearance!.entries;
    Ops.Appearance.updateEntry(doc, [rect.id], entries[0].id, { visible: false });

    const out = Ops.PathEdit.expandAppearance(doc, [rect.id])[0];
    expect((Query.getItem(doc, out) as GroupItem).children).toHaveLength(entries.length - 1);
  });
});
