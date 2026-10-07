// ─────────────────────────────────────────────────────────────
// menus-arrowheads.test — Effect ▸ Add Arrowheads menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Effect ▸ Add Arrowheads ▸ {End, Start, Both Ends} exist, gate on a
// selection, and run (menu → command → op → document).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, defaultStroke, solid, rgba, Query } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

type Entry = { id?: string; label?: string; disabled?: boolean; action?: () => void; items?: MenuItemDef[] };

const findById = (entries: Entry[], id: string): Entry | null => {
  for (const e of entries) {
    if (e.id === id) return e;
    if (e.items) {
      const f = findById(e.items as Entry[], id);
      if (f) return f;
    }
  }
  return null;
};

const RED = rgba(220, 0, 0, 1);
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] }, { stroke: { ...defaultStroke(solid(RED)), width: 10 } });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Effect ▸ Add Arrowheads", () => {
  it("exposes End / Start / Both Ends, enabled with a selection", () => {
    const { store } = setup();
    for (const [id, label] of [["arrow-end", "End"], ["arrow-start", "Start"], ["arrow-both", "Both Ends"]] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
  });

  it("disables End with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "arrow-end")!.disabled).toBe(true);
  });

  it("running End wraps the selected line in a 2-child Arrowheads group", () => {
    const { store, p } = setup();
    itemById(store, "arrow-end")!.action!();
    const grp = Query.getItem(store.getState().doc, store.getState().selection[0])!;
    expect(grp.type).toBe("group");
    expect(grp.type === "group" && grp.children.length).toBe(2);
    expect(grp.type === "group" && grp.children[0].id).toBe(p.id);
  });

  it("nests four style submenus (Triangle / Circle / Square / Bar), each gated on a selection", () => {
    const { store } = setup();
    for (const [id, label] of [
      ["arrow-style-triangle", "Triangle"],
      ["arrow-style-circle", "Circle"],
      ["arrow-style-square", "Square"],
      ["arrow-style-bar", "Bar"],
    ] as const) {
      const sub = itemById(store, id);
      expect(sub).toBeTruthy();
      expect(sub!.label).toBe(label);
      expect(sub!.items!.length).toBe(3); // End / Start / Both Ends
    }
    // Each style's End leaf gates on the selection.
    for (const id of ["arrow-end", "arrow-circle-end", "arrow-square-end", "arrow-bar-end"]) {
      expect(itemById(store, id)!.disabled).toBeFalsy();
    }
    store.clearSelection();
    for (const id of ["arrow-end", "arrow-circle-end", "arrow-square-end", "arrow-bar-end"]) {
      expect(itemById(store, id)!.disabled).toBe(true);
    }
  });

  it("each style's End item runs menu → command → op, baking the matching head", () => {
    // head anchor counts: triangle = 3, circle/square/bar = 4.
    for (const [id, count] of [
      ["arrow-end", 3],
      ["arrow-circle-end", 4],
      ["arrow-square-end", 4],
      ["arrow-bar-end", 4],
    ] as const) {
      const { store } = setup();
      itemById(store, id)!.action!();
      const grp = Query.getItem(store.getState().doc, store.getState().selection[0])!;
      expect(grp.type).toBe("group");
      const head = grp.type === "group" && grp.children[1];
      expect(head && head.type === "path" && head.geometry.anchors.length).toBe(count);
      expect(head && head.type === "path" && head.geometry.closed).toBe(true);
    }
  });

  it("Both Ends works for a non-triangle style (circle): two 4-anchor heads", () => {
    const { store, p } = setup();
    itemById(store, "arrow-circle-both")!.action!();
    const grp = Query.getItem(store.getState().doc, store.getState().selection[0])!;
    expect(grp.type).toBe("group");
    expect(grp.type === "group" && grp.children.length).toBe(3); // line + start head + end head
    expect(grp.type === "group" && grp.children[0].id).toBe(p.id);
    for (const i of [1, 2]) {
      const head = grp.type === "group" && grp.children[i];
      expect(head && head.type === "path" && head.geometry.anchors.length).toBe(4); // round dot
      expect(head && head.type === "path" && head.geometry.closed).toBe(true);
    }
  });
});
