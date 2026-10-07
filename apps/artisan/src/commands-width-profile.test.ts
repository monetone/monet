// ─────────────────────────────────────────────────────────────
// commands-width-profile.test — Stroke panel Width Profile (command path)
// ─────────────────────────────────────────────────────────────
// The Stroke panel's Profile dropdown calls commands.applyWidthProfile to set a
// variable-width profile on the selection in one undoable step.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeRect, makeAnchor as anchor, solid, rgba, defaultStroke, Query } from "./engine";
import type { PathItem } from "./engine";

const A = (x: number, y: number) => anchor({ x, y });
const stroke = () => ({ ...defaultStroke(solid(rgba(0, 0, 0, 1))), width: 10 });
const wpOf = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).stroke.widthProfile;
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath({ closed: false, anchors: [A(0, 0), A(50, 0), A(100, 0)] }, { stroke: stroke() });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};

describe("commands.applyWidthProfile", () => {
  it("applies a preset to the selection, undoably", () => {
    const { store, p } = setup();
    commands.applyWidthProfile(store, "profile-1");
    expect(wpOf(store, p.id)).toEqual([0, 1, 0]); // 3-anchor bulge
    store.undo();
    expect(wpOf(store, p.id)).toBeUndefined();
  });

  it("uniform clears an applied profile", () => {
    const { store, p } = setup();
    commands.applyWidthProfile(store, "profile-2");
    expect(wpOf(store, p.id)).toBeDefined();
    commands.applyWidthProfile(store, "uniform");
    expect(wpOf(store, p.id)).toBeUndefined();
  });

  it("converts a selected live rect to a path and applies the profile", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 50, 0, 0, { stroke: stroke() });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    commands.applyWidthProfile(store, "profile-1");
    const it = Query.getItem(store.getState().doc, r.id)!;
    expect(it.type).toBe("path"); // converted
    expect((it as PathItem).stroke.widthProfile?.some((w) => w !== 1)).toBe(true);
  });

  it("undo of a live-rect conversion restores the rect", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 50, 0, 0, { stroke: stroke() });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([r.id]);
    commands.applyWidthProfile(store, "profile-1");
    expect(Query.getItem(store.getState().doc, r.id)!.type).toBe("path"); // converted
    store.undo();
    expect(Query.getItem(store.getState().doc, r.id)!.type).toBe("rect"); // fully restored in one step
  });

  it("is a no-op with an empty selection (no undo entry)", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.applyWidthProfile(store, "profile-1");
    expect(store.canUndo).toBe(before);
  });
});
