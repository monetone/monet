// ─────────────────────────────────────────────────────────────
// ops/lock-hide.test — Object ▸ Lock / Hide / Unlock All / Show All (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator. Lock (⌘2) makes objects un-selectable but still
// drawn; Hide (⌘3) makes them invisible. Unlock All (⌥⌘2) / Show All (⌥⌘3) revert
// every locked / hidden object.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query, solid, rgba } from "../index";

const RED = rgba(220, 0, 0);
const setup = () => {
  const doc = makeDocument();
  const a = makeRect(0, 0, 50, 50, 0, 0, { fill: solid(RED) });
  const b = makeRect(60, 0, 50, 50, 0, 0, { fill: solid(RED) });
  Ops.Items.addItem(doc, a);
  Ops.Items.addItem(doc, b);
  return { doc, a, b };
};

describe("ops.items — lock / hide / unlock-all / show-all", () => {
  it("setLocked locks an item (now un-selectable); setLocked(false) unlocks it", () => {
    const { doc, a } = setup();
    Ops.Items.setLocked(doc, [a.id], true);
    expect(Query.getItem(doc, a.id)!.locked).toBe(true);
    expect(Query.isSelectable(doc, a.id)).toBe(false);
    Ops.Items.setLocked(doc, [a.id], false);
    expect(Query.getItem(doc, a.id)!.locked).toBe(false);
    expect(Query.isSelectable(doc, a.id)).toBe(true);
  });

  it("setHidden hides an item; setHidden(false) shows it", () => {
    const { doc, a } = setup();
    Ops.Items.setHidden(doc, [a.id], true);
    expect(Query.getItem(doc, a.id)!.visible).toBe(false);
    Ops.Items.setHidden(doc, [a.id], false);
    expect(Query.getItem(doc, a.id)!.visible).toBe(true);
  });

  it("unlockAll unlocks every locked item and returns their ids", () => {
    const { doc, a, b } = setup();
    Ops.Items.setLocked(doc, [a.id, b.id], true);
    expect(Ops.Items.unlockAll(doc).sort()).toEqual([a.id, b.id].sort());
    expect(Query.getItem(doc, a.id)!.locked).toBe(false);
    expect(Query.getItem(doc, b.id)!.locked).toBe(false);
    expect(Ops.Items.unlockAll(doc)).toEqual([]); // nothing left to unlock
  });

  it("showAll reveals only the hidden items and returns their ids", () => {
    const { doc, a } = setup();
    Ops.Items.setHidden(doc, [a.id], true);
    expect(Ops.Items.showAll(doc)).toEqual([a.id]);
    expect(Query.getItem(doc, a.id)!.visible).toBe(true);
  });

  it("operates on items nested inside a group", () => {
    const doc = makeDocument();
    const child = makeRect(0, 0, 30, 30, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, makeGroup([child]));
    Ops.Items.setLocked(doc, [child.id], true);
    expect(Query.getItem(doc, child.id)!.locked).toBe(true);
    expect(Ops.Items.unlockAll(doc)).toEqual([child.id]);
  });
});
