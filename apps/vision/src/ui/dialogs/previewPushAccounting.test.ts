import { describe, expect, it } from "vitest";

/** #26/#82/#168 — the preview/commit helpers must MEASURE how many undo entries an
 *  engine op pushed instead of assuming one per dispatched op. The engine refuses
 *  edits (locked / type / vector / adjustment / smart-object layers, 32-bit float
 *  docs) without pushing, and at the History States cap the stack depth stops
 *  growing while pushes continue — so only a monotonic push counter is safe.
 *  This models the contract; the real engine's counter is covered by the Rust test
 *  `undo_pushes_counts_real_pushes_only`. */
class FakeEngine {
  pushes = 0;
  depth = 0;
  cap = 3;
  refuse = false;
  /** Mirrors Engine::push_undo: refused ops push nothing; at the cap a push
   *  evicts, so depth stops growing while the counter keeps counting. */
  op() {
    if (this.refuse) return;
    this.pushes += 1;
    if (this.depth < this.cap) this.depth += 1;
  }
  undo_pushes() { return this.pushes; }
  undo_depth() { return this.depth; }
}

/** The pattern every fixed call site now uses. */
function measured(e: FakeEngine, run: () => void): number {
  const before = e.undo_pushes();
  run();
  return Math.max(0, Math.round(e.undo_pushes() - before));
}

describe("preview/commit push accounting", () => {
  it("counts only the ops the engine really pushed", () => {
    const e = new FakeEngine();
    expect(measured(e, () => { e.op(); e.op(); })).toBe(2);
  });

  it("reports zero when the engine refuses every op (the #82 crash case)", () => {
    const e = new FakeEngine();
    e.refuse = true;
    // Three filters dispatched, none applied: the old code returned 3 and then
    // undid three REAL user history states.
    expect(measured(e, () => { e.op(); e.op(); e.op(); })).toBe(0);
  });

  it("stays correct at the History States cap where undo_depth cannot (#169)", () => {
    const e = new FakeEngine();
    e.op(); e.op(); e.op();              // depth is now pinned at cap = 3
    const depthBefore = e.undo_depth();
    const got = measured(e, () => { e.op(); e.op(); });
    expect(e.undo_depth()).toBe(depthBefore);  // depth delta would read 0
    expect(got).toBe(2);                       // the push counter is right
  });
});
