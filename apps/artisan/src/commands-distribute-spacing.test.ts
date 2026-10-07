// ─────────────────────────────────────────────────────────────
// commands-distribute-spacing.test — Align ▸ Distribute Spacing (command path)
// ─────────────────────────────────────────────────────────────
// The Align panel's Distribute Spacing buttons call commands.distributeSpacing:
// one undoable step that spaces the selection with an exact gap; no-op for <2.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query } from "./engine";

const wb = (s: ArtisanStore, id: string) => Query.worldBounds(s.getState().doc, id)!;

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r1 = makeRect(0, 0, 30, 10);
  const r2 = makeRect(100, 0, 50, 10);
  const r3 = makeRect(300, 0, 20, 10);
  doc.layers[0].items.push(r1, r2, r3);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r1.id, r2.id, r3.id]);
  return { store, ids: [r1.id, r2.id, r3.id] };
};

describe("commands.distributeSpacing", () => {
  it("spaces the selection with the exact gap, undoably", () => {
    const { store, ids } = setup();
    commands.distributeSpacing(store, "h", 10);
    expect(wb(store, ids[1]).x).toBe(40); // 30 (r1 trailing) + 10
    expect(wb(store, ids[2]).x).toBe(100); // 90 (r2 trailing) + 10

    store.undo();
    expect(wb(store, ids[1]).x).toBe(100); // original
    expect(wb(store, ids[2]).x).toBe(300);
  });

  it("is a no-op (no undo step) with fewer than two objects selected", () => {
    const { store, ids } = setup();
    store.setSelection([ids[0]]);
    const before = store.canUndo;
    commands.distributeSpacing(store, "h", 10);
    expect(store.canUndo).toBe(before);
    expect(wb(store, ids[0]).x).toBe(0);
  });
});
