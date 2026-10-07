// ─────────────────────────────────────────────────────────────
// store.test — mid-gesture tool switch must not leak a transaction (AR-H5)
// ─────────────────────────────────────────────────────────────
// Most drag tools open a transaction on pointer-down. The 16 that have no
// onDeactivate of their own would otherwise leave that transaction OPEN when the
// user switches tools mid-drag (e.g. via a shortcut), corrupting the next tool's
// first-edit undo boundary. The viewport's deactivate path (render/canvas-view)
// runs the old tool's onDeactivate and then discards any still-open transaction;
// this test pins the store mechanics that guard relies on.

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeRect, Ops } from "../index";

describe("mid-gesture tool switch — transaction hygiene (AR-H5)", () => {
  it("a throwing atomic edit preserves the error without leaking its transaction", () => {
    const store = new ArtisanStore();
    const before = store.doc;
    const failure = new Error("op failed");
    let caught: unknown;

    try {
      store.transact("Fail", () => { throw failure; });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(failure);
    expect(store.transactionBase).toBeNull();
    expect(store.doc).toBe(before);
    expect(store.canUndo).toBe(false);
  });

  it("a drag that opened a transaction is left open until explicitly resolved", () => {
    const store = new ArtisanStore();
    store.transact("seed", (d) => Ops.Items.addItem(d, makeRect(0, 0, 10, 10)));
    const id = store.doc.layers[0].items[0].id;
    store.setSelection([id]);

    // Simulate a leaky drag: begin + per-frame mutateFrom, no end/cancel yet.
    store.beginTransaction("Move");
    store.mutateFrom(store.transactionBase!, (d) => Ops.Transform.translateItems(d, [id], 5, 5));
    expect(store.transactionBase).not.toBeNull(); // gesture in flight
  });

  it("the deactivate guard cancels the orphaned transaction and restores the pre-drag doc", () => {
    const store = new ArtisanStore();
    store.transact("seed", (d) => Ops.Items.addItem(d, makeRect(0, 0, 10, 10)));
    const id = store.doc.layers[0].items[0].id;
    store.setSelection([id]);
    const before = store.doc;

    store.beginTransaction("Move");
    store.mutateFrom(store.transactionBase!, (d) => Ops.Transform.translateItems(d, [id], 5, 5));

    // canvas-view deactivate path: old tool has no onDeactivate → discard the tx.
    if (store.transactionBase !== null) store.cancelTransaction();

    expect(store.transactionBase).toBeNull();
    expect(store.doc).toBe(before); // rolled back to the pre-gesture document
    expect(store.canUndo).toBe(true); // only the seed edit remains undoable, not the discarded drag
    expect(store.undoLabel()).toBe("seed");
  });
});
