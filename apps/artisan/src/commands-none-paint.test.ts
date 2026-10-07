// ─────────────────────────────────────────────────────────────
// commands-none-paint.test — None (/) + Gradient paint apply (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Adobe Illustrator — "/" sets the active fill/stroke to None; the
// Swatches None / Gradient chips do the same via applyPaintToActive.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { applyPaintToActive } from "./ui/paint-apply";
import { ArtisanStore, makeDocument, makeRect, Query, solid, defaultStroke, noPaint, linearGradient, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)), stroke: defaultStroke(solid(rgba(0, 0, 220))) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const item = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id)!;

describe("commands.noneFillStroke + None/Gradient apply", () => {
  it("'/' sets the active FILL to None (selection + default), undoable, stroke kept", () => {
    const { store, r } = setup();
    store.setActivePaint("fill");
    commands.noneFillStroke(store);
    expect(item(store, r.id).fill.type).toBe("none");
    expect(store.getState().fill.type).toBe("none"); // default updated too
    expect(item(store, r.id).stroke.paint.type).toBe("solid"); // stroke untouched
    store.undo();
    expect(item(store, r.id).fill.type).toBe("solid");
  });

  it("'/' with Stroke active sets the stroke to None, fill kept", () => {
    const { store, r } = setup();
    store.setActivePaint("stroke");
    commands.noneFillStroke(store);
    expect(item(store, r.id).stroke.paint.type).toBe("none");
    expect(item(store, r.id).fill.type).toBe("solid");
  });

  it("the Swatches 'None' chip clears the active paint (applyPaintToActive)", () => {
    const { store, r } = setup();
    store.setActivePaint("fill");
    applyPaintToActive(store, noPaint());
    expect(item(store, r.id).fill.type).toBe("none");
  });

  it("the Swatches 'Gradient' chip applies a gradient fill", () => {
    const { store, r } = setup();
    store.setActivePaint("fill");
    applyPaintToActive(store, linearGradient());
    expect(item(store, r.id).fill.type).toBe("gradient");
  });
});
