import { describe, expect, it } from "vitest";
import { ArtisanStore, defaultStroke, makeDocument, makeRect, noPaint, rgba, solid } from "../engine";
import { currentPaints } from "./paint-apply";

describe("currentPaints", () => {
  it("reports the top visible appearance fill and stroke", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const red = solid(rgba(220, 0, 0));
    const blue = solid(rgba(0, 0, 220));
    const item = makeRect(0, 0, 40, 40, 0, 0, { fill: red, stroke: defaultStroke(noPaint()) });
    item.appearance = { entries: [
      { id: "hidden", kind: "fill", paint: red, visible: false },
      { id: "fill", kind: "fill", paint: blue },
      { id: "stroke", kind: "stroke", stroke: { ...defaultStroke(red), width: 8 } },
    ] };
    doc.layers[0].items.push(item);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([item.id]);

    expect(currentPaints(store)).toEqual({ fill: blue, stroke: red });
  });
});
