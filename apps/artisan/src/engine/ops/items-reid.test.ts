// ─────────────────────────────────────────────────────────────
// ops/items.test — id-collision repair on import (SEC-M2 / AR-H3)
// ─────────────────────────────────────────────────────────────
// findItem returns the FIRST id match, so duplicate ids make it silently target
// the wrong item. Imports detect collisions and re-mint; well-formed docs (incl.
// lossless .artisan reopen) are left untouched so they stay byte-identical.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops } from "../index";

describe("ops.items — duplicate-id detection & repair", () => {
  it("reports no duplicates for a normally-built document", () => {
    const doc = makeDocument();
    Ops.Items.addItems(doc, [makeRect(0, 0, 10, 10), makeRect(20, 0, 10, 10)]);
    expect(Ops.Items.hasDuplicateItemIds(doc)).toBe(false);
  });

  it("detects a collision and reidDocument repairs it (keeping item count)", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(20, 0, 10, 10);
    Ops.Items.addItems(doc, [a, b]);
    b.id = a.id; // simulate a malformed import with colliding ids
    expect(Ops.Items.hasDuplicateItemIds(doc)).toBe(true);

    Ops.Items.reidDocument(doc);
    expect(Ops.Items.hasDuplicateItemIds(doc)).toBe(false);
    expect(doc.layers[0].items.length).toBe(2);
  });
});
