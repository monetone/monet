import { describe, expect, it } from "vitest";
import { Ops, Query, defaultStroke, makeDocument, makeRect, noPaint, rgba, solid } from "./index";

const BLUE = rgba(0, 0, 220);

describe("appearance read truth", () => {
  it("hit-tests paint that exists only in the appearance stack", () => {
    const doc = makeDocument();
    const fillOnly = makeRect(0, 0, 40, 40, 0, 0, { fill: noPaint(), stroke: defaultStroke(noPaint()) });
    const strokeOnly = makeRect(60, 0, 40, 40, 0, 0, { fill: noPaint(), stroke: defaultStroke(noPaint()) });
    Ops.Items.addItems(doc, [fillOnly, strokeOnly]);
    Ops.Appearance.addFill(doc, [fillOnly.id], solid(BLUE));
    Ops.Appearance.addStroke(doc, [strokeOnly.id], { ...defaultStroke(solid(BLUE)), width: 20 });

    expect(Query.hitTest(doc, { x: 20, y: 20 }, 0)?.leaf.item.id).toBe(fillOnly.id);
    expect(Query.hitTest(doc, { x: 55, y: 20 }, 0)?.leaf.item.id).toBe(strokeOnly.id);
  });
});
