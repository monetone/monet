// ─────────────────────────────────────────────────────────────
// store.test — large-document edit budget (PERF-C1 regression guard)
// ─────────────────────────────────────────────────────────────
// The store edits the document via Immer structural sharing rather than a
// whole-document deep clone per frame. This pins a generous wall-clock ceiling so
// a regression back to clone-the-world (or an accidental O(n²) edit path) fails
// loudly. Threshold is deliberately loose to avoid CI flakiness — it is a
// catastrophe detector, not a microbenchmark.

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeRect, Ops } from "../index";

describe("perf budget — interactive edits on a large document", () => {
  it("runs 200 single-item drag frames over a 4,000-item doc well under budget", () => {
    const store = new ArtisanStore();
    const ids: string[] = [];
    store.transact("seed", (d) => {
      for (let i = 0; i < 4000; i++) {
        const r = makeRect((i % 100) * 5, Math.floor(i / 100) * 5, 4, 4);
        Ops.Items.addItem(d, r);
        ids.push(r.id);
      }
    });
    expect(store.doc.layers[0].items.length).toBe(4000);

    const one = [ids[0]];
    const t0 = performance.now();
    for (let f = 0; f < 200; f++) {
      store.mutateFrom(store.doc, (d) => Ops.Transform.translateItems(d, one, 1, 0));
    }
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000); // ~10ms/frame ceiling; a full-doc clone-per-frame regression blows past this
  });
});
