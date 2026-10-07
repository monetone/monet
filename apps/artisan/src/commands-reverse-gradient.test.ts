// ─────────────────────────────────────────────────────────────
// commands-reverse-gradient.test — Gradient panel Reverse (command path)
// ─────────────────────────────────────────────────────────────
// The gradient panel's "Reverse" button calls commands.reverseGradient(store):
// reverse the selection's gradient fill in one undoable step.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, linearGradient, Query, rgba } from "./engine";
import type { GradientStop } from "./engine";

const RED = rgba(220, 0, 0, 1);
const BLUE = rgba(0, 0, 220, 1);
const grad = (stops: GradientStop[]) => {
  const p = linearGradient();
  if (p.type !== "gradient") throw new Error("expected gradient");
  p.gradient.stops = stops;
  return p;
};
const fillStops = (store: ArtisanStore, id: string) => {
  const f = Query.getItem(store.getState().doc, id)!.fill;
  return f.type === "gradient" ? f.gradient.stops : null;
};
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill: grad([{ offset: 0, color: RED }, { offset: 1, color: BLUE }]) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};

describe("commands.reverseGradient", () => {
  it("reverses the selection's gradient, undoably, keeping the selection", () => {
    const { store, r } = setup();
    commands.reverseGradient(store);
    expect(fillStops(store, r.id)![0].color).toEqual(BLUE); // blue now leads
    expect(store.getState().selection).toEqual([r.id]); // selection preserved

    store.undo();
    expect(fillStops(store, r.id)![0].color).toEqual(RED); // restored
  });

  it("is a no-op with an empty selection (no undo entry)", () => {
    const { store } = setup();
    store.clearSelection();
    const undoBefore = store.canUndo;
    commands.reverseGradient(store);
    expect(store.canUndo).toBe(undoBefore);
  });
});
