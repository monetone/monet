// ─────────────────────────────────────────────────────────────
// commands-pucker-bloat.test — Pucker & Bloat command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: Effect ▸ Distort & Transform ▸ Pucker & Bloat curves the
// selection in one undoable transaction.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query, solid, rgba } from "./engine";
import type { PathItem } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath(
    { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] },
    { fill: solid(rgba(220, 0, 0)) },
  );
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const handle0 = (store: ArtisanStore, id: string) => {
  const it = Query.getItem(store.getState().doc, id) as PathItem;
  return it.geometry.anchors[0].handleOut;
};

describe("commands.puckerBloat", () => {
  it("bloats the selection by the default 50%, undoable", () => {
    const { store, p } = setup();
    commands.puckerBloat(store);
    expect(handle0(store, p.id)).toEqual({ x: -25, y: -25 }); // away from centre (50,50)

    store.undo();
    expect(handle0(store, p.id)).toEqual({ x: 0, y: 0 }); // restored
  });

  it("puckers with a negative amount", () => {
    const { store, p } = setup();
    commands.puckerBloat(store, -0.5);
    expect(handle0(store, p.id)).toEqual({ x: 25, y: 25 }); // toward centre
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.puckerBloat(store);
    expect(store.canUndo).toBe(before);
  });
});
