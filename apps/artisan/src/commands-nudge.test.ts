// ─────────────────────────────────────────────────────────────
// commands-nudge.test — arrow-key nudge (move the selection by an increment)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — arrow keys move the selection by the Keyboard
// Increment (default 1), Shift×arrow by 10×. Each nudge is one undoable step.
// (The increment/direction mapping lives in use-shortcuts; this exercises the
// underlying command that translates the selection by an explicit delta.)

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, makePath, makeAnchor, Query, solid, rgba, type PathItem } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(50, 50, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, id: r.id };
};
const pos = (store: ArtisanStore, id: string) => {
  const t = Query.getItem(store.getState().doc, id)!.transform;
  return { x: t.e, y: t.f };
};

describe("nudge command", () => {
  it("moves the selection by the given delta", () => {
    const { store, id } = setup();
    commands.nudge(store, 1, 0);
    expect(pos(store, id)).toEqual({ x: 51, y: 50 });
  });

  it("nudges accumulate across directions", () => {
    const { store, id } = setup();
    commands.nudge(store, 1, 0); // right
    commands.nudge(store, 0, 1); // down
    commands.nudge(store, -1, 0); // left
    commands.nudge(store, 0, -10); // up ×10
    expect(pos(store, id)).toEqual({ x: 50, y: 41 });
  });

  it("each nudge is one undoable step", () => {
    const { store, id } = setup();
    commands.nudge(store, 10, 0);
    expect(pos(store, id).x).toBe(60);
    store.undo();
    expect(pos(store, id).x).toBe(50);
  });

  it("is a no-op without a selection", () => {
    const { store, id } = setup();
    store.setSelection([]);
    commands.nudge(store, 5, 5);
    expect(pos(store, id)).toEqual({ x: 50, y: 50 });
    expect(store.canUndo).toBe(false);
  });
});

// ── anchor-level nudge (Direct Selection) ───────────────────────
const pathSetup = (transform?: { a: number; b: number; c: number; d: number; e: number; f: number }) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath(
    { closed: false, anchors: [makeAnchor({ x: 0, y: 0 }), makeAnchor({ x: 50, y: 0 }), makeAnchor({ x: 100, y: 0 })] },
    { fill: solid(rgba(220, 0, 0)), ...(transform ? { transform } : {}) },
  );
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]); // clears anchorSelection…
  store.setAnchorSelection({ [p.id]: [0] }); // …so set it AFTER
  return { store, id: p.id };
};
const anchors = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).geometry.anchors;

describe("nudge command — anchor selection (Direct Selection)", () => {
  it("nudges the SELECTED ANCHORS, not the whole object", () => {
    const { store, id } = pathSetup();
    commands.nudge(store, 1, 0);
    const a = anchors(store, id);
    expect(a[0].point).toEqual({ x: 1, y: 0 }); // selected anchor moved
    expect(a[1].point).toEqual({ x: 50, y: 0 }); // unselected anchor unchanged
    expect(Query.getItem(store.getState().doc, id)!.transform.e).toBe(0); // object not translated
  });

  it("maps the WORLD nudge into the path's local space (scaled path)", () => {
    const { store, id } = pathSetup({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }); // 2× scale
    commands.nudge(store, 2, 0); // world +2 → local +1
    expect(anchors(store, id)[0].point.x).toBeCloseTo(1, 6);
  });

  it("anchor nudge is one undoable step", () => {
    const { store, id } = pathSetup();
    commands.nudge(store, 0, 10);
    expect(anchors(store, id)[0].point).toEqual({ x: 0, y: 10 });
    store.undo();
    expect(anchors(store, id)[0].point).toEqual({ x: 0, y: 0 });
  });
});
