// Reflection convergence tests — the heart of the collab substrate. Two Yjs docs
// exchange updates (simulating two clients); we assert the plain document
// converges and that concurrent edits to DIFFERENT entities both survive.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { materialize, reconcile } from "./reflect";

type Doc = { name: string; tracks: { id: string; name: string; clips: { id: string; start: number }[] }[] };

const sample = (): Doc => ({
  name: "Project",
  tracks: [
    { id: "t1", name: "Video", clips: [{ id: "c1", start: 0 }, { id: "c2", start: 24 }] },
    { id: "t2", name: "Audio", clips: [{ id: "c3", start: 0 }] },
  ],
});

/** Apply A's state onto B (one-way sync of the pending update). */
function sync(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

function setup() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const ra = a.getMap("doc");
  reconcile(ra, sample() as unknown as Record<string, never>);
  sync(a, b); // b now has the initial doc
  return { a, b, ra, rb: b.getMap("doc") };
}

describe("reflect — round-trip + convergence", () => {
  it("materializes back to the original plain document", () => {
    const { ra } = setup();
    expect(materialize(ra)).toEqual(sample());
  });

  it("propagates a field edit from A to B", () => {
    const { a, b, ra, rb } = setup();
    const next = sample();
    next.tracks[0].clips[1].start = 100;
    reconcile(ra, next as unknown as Record<string, never>);
    sync(a, b);
    expect((materialize(rb) as unknown as Doc).tracks[0].clips[1].start).toBe(100);
  });

  it("merges concurrent edits to DIFFERENT entities (granular CRDT merge)", () => {
    const { a, b, ra, rb } = setup();
    // A renames track t1; B moves clip c3 — different entities, offline-concurrent.
    const da = sample();
    da.tracks[0].name = "Renamed by A";
    reconcile(ra, da as unknown as Record<string, never>);
    const db = sample();
    db.tracks[1].clips[0].start = 48;
    reconcile(rb, db as unknown as Record<string, never>);
    // exchange both ways
    sync(a, b);
    sync(b, a);
    const ma = materialize(ra) as unknown as Doc;
    const mb = materialize(rb) as unknown as Doc;
    expect(ma).toEqual(mb); // converged
    expect(ma.tracks[0].name).toBe("Renamed by A"); // A's edit survived
    expect(ma.tracks[1].clips[0].start).toBe(48); // B's edit survived
  });

  it("converges on a structural change (add on A, remove on B)", () => {
    const { a, b, ra, rb } = setup();
    const da = sample();
    da.tracks[0].clips.push({ id: "c9", start: 200 });
    reconcile(ra, da as unknown as Record<string, never>);
    const db = sample();
    db.tracks[1].clips = []; // remove c3
    reconcile(rb, db as unknown as Record<string, never>);
    sync(a, b);
    sync(b, a);
    expect(materialize(ra)).toEqual(materialize(rb)); // converged
    const m = materialize(ra) as unknown as Doc;
    expect(m.tracks[0].clips.map((c) => c.id)).toContain("c9"); // A's add survived
    expect(m.tracks[1].clips).toHaveLength(0); // B's remove survived
  });
});

// Collaborative per-user undo — the mechanism CollabSession exposes via a
// Y.UndoManager scoped to local-origin writes. Verified here on bare docs (the
// session itself needs a network provider, exercised by test/e2e.mjs).
describe("collaborative undo", () => {
  const LOCAL = Symbol("local");

  it("undo reverts the local user's edit but preserves a merged remote edit", () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>("doc");

    // Seed BEFORE the undo manager so the seed isn't itself undoable.
    doc.transact(() => reconcile(root, { items: [{ id: "a", v: 1 }] }), LOCAL);
    const undo = new Y.UndoManager(root, { trackedOrigins: new Set([LOCAL]) });

    // Local edit (tracked): a.v 1 → 2.
    doc.transact(() => reconcile(root, { items: [{ id: "a", v: 2 }] }), LOCAL);
    // A collaborator's edit merges in (different origin → NOT tracked): adds b.
    doc.transact(() => reconcile(root, { items: [{ id: "a", v: 2 }, { id: "b", v: 9 }] }), "remote");

    expect(undo.canUndo()).toBe(true);
    undo.undo();

    const after = materialize(root) as unknown as { items: { id: string; v: number }[] };
    const byId = Object.fromEntries(after.items.map((x) => [x.id, x.v]));
    expect(byId.a).toBe(1); // local edit undone…
    expect(byId.b).toBe(9); // …but the remote collaborator's edit is preserved
  });

  it("redo re-applies the undone local edit", () => {
    const doc = new Y.Doc();
    const root = doc.getMap<unknown>("doc");
    doc.transact(() => reconcile(root, { items: [{ id: "a", v: 1 }] }), LOCAL);
    const undo = new Y.UndoManager(root, { trackedOrigins: new Set([LOCAL]) });
    doc.transact(() => reconcile(root, { items: [{ id: "a", v: 2 }] }), LOCAL);

    undo.undo();
    expect((materialize(root) as { items: { v: number }[] }).items[0].v).toBe(1);
    expect(undo.canRedo()).toBe(true);
    undo.redo();
    expect((materialize(root) as { items: { v: number }[] }).items[0].v).toBe(2);
  });
});

// GAP 6 — minimal-diff ordering: concurrent inserts into the SAME ordered list
// must both survive (the old delete-all+re-push made this last-writer-wins).
describe("ordered-list convergence", () => {
  it("two clients appending different clips to the same track both survive", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const ra = a.getMap<unknown>("doc");
    const rb = b.getMap<unknown>("doc");

    const seed = { tracks: [{ id: "t1", clips: [{ id: "c1", start: 0 }] }] };
    a.transact(() => reconcile(ra, seed));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); // B starts from the same state

    // Concurrent, no sync between them: A appends c2, B appends c3.
    a.transact(() => reconcile(ra, { tracks: [{ id: "t1", clips: [{ id: "c1", start: 0 }, { id: "c2", start: 1 }] }] }));
    b.transact(() => reconcile(rb, { tracks: [{ id: "t1", clips: [{ id: "c1", start: 0 }, { id: "c3", start: 2 }] }] }));

    // Exchange updates both ways → converge.
    const ua = Y.encodeStateAsUpdate(a);
    const ub = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, ub);
    Y.applyUpdate(b, ua);

    const ma = materialize(ra) as unknown as { tracks: { clips: { id: string }[] }[] };
    const mb = materialize(rb) as unknown as { tracks: { clips: { id: string }[] }[] };
    const idsA = ma.tracks[0].clips.map((c) => c.id).sort();
    expect(idsA).toEqual(["c1", "c2", "c3"]); // BOTH concurrent inserts survived
    expect(JSON.stringify(ma)).toEqual(JSON.stringify(mb)); // and the two docs converged
  });

  // #228 — the list starts EMPTY, the state of every freshly created document
  // (cinema gives each default track `clips: []`). An empty list used to fail
  // the id-collection test and land as a plain Y.Array, so the first insert was
  // a wholesale replace and one collaborator's item was silently dropped.
  it("two clients adding their FIRST clip to an empty list both survive", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const ra = a.getMap<unknown>("doc");
    const rb = b.getMap<unknown>("doc");

    a.transact(() => reconcile(ra, { tracks: [{ id: "t1", clips: [] }] }));
    expect(materialize(ra)).toEqual({ tracks: [{ id: "t1", clips: [] }] }); // still an array
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    a.transact(() => reconcile(ra, { tracks: [{ id: "t1", clips: [{ id: "cA", start: 1 }] }] }));
    b.transact(() => reconcile(rb, { tracks: [{ id: "t1", clips: [{ id: "cB", start: 2 }] }] }));

    const ua = Y.encodeStateAsUpdate(a);
    const ub = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, ub);
    Y.applyUpdate(b, ua);

    const ma = materialize(ra) as unknown as { tracks: { clips: { id: string }[] }[] };
    const mb = materialize(rb) as unknown as { tracks: { clips: { id: string }[] }[] };
    expect(ma.tracks[0].clips.map((c) => c.id).sort()).toEqual(["cA", "cB"]);
    expect(JSON.stringify(ma)).toEqual(JSON.stringify(mb));
  });

  it("clearing a list and refilling it keeps the id-collection (positions survive)", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const ra = a.getMap<unknown>("doc");
    const rb = b.getMap<unknown>("doc");

    a.transact(() => reconcile(ra, { clips: [{ id: "c1" }] }));
    a.transact(() => reconcile(ra, { clips: [] })); // cleared…
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // …then both clients refill concurrently.
    a.transact(() => reconcile(ra, { clips: [{ id: "cA" }] }));
    b.transact(() => reconcile(rb, { clips: [{ id: "cB" }] }));
    const ua = Y.encodeStateAsUpdate(a);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, ua);

    const ids = (materialize(ra) as unknown as { clips: { id: string }[] }).clips.map((c) => c.id);
    expect([...ids].sort()).toEqual(["cA", "cB"]);
    expect(JSON.stringify(materialize(ra))).toEqual(JSON.stringify(materialize(rb)));
  });
});

// Fractional-index ordering: concurrent reorders of the SAME items must converge
// to a single consistent order with NO duplicated/dropped item (the per-item
// position map makes a same-item move last-writer, never a duplicate — the bug a
// shared order Y.Array would hit on concurrent delete+insert of one element).
describe("concurrent reorder convergence", () => {
  it("two clients reordering the same list converge with every item exactly once", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const ra = a.getMap<unknown>("doc");
    const rb = b.getMap<unknown>("doc");

    const seed = { tracks: [{ id: "t", clips: [{ id: "c1", n: 1 }, { id: "c2", n: 2 }, { id: "c3", n: 3 }] }] };
    a.transact(() => reconcile(ra, seed));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Concurrent, conflicting reorders of the same three clips.
    a.transact(() => reconcile(ra, { tracks: [{ id: "t", clips: [{ id: "c3", n: 3 }, { id: "c1", n: 1 }, { id: "c2", n: 2 }] }] }));
    b.transact(() => reconcile(rb, { tracks: [{ id: "t", clips: [{ id: "c2", n: 2 }, { id: "c3", n: 3 }, { id: "c1", n: 1 }] }] }));

    const ua = Y.encodeStateAsUpdate(a);
    const ub = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, ub);
    Y.applyUpdate(b, ua);

    const ma = materialize(ra) as unknown as { tracks: { clips: { id: string }[] }[] };
    const mb = materialize(rb) as unknown as { tracks: { clips: { id: string }[] }[] };
    const idsA = ma.tracks[0].clips.map((c) => c.id);
    expect([...idsA].sort()).toEqual(["c1", "c2", "c3"]); // each exactly once — no dup, no drop
    expect(JSON.stringify(ma)).toEqual(JSON.stringify(mb)); // both clients converged to one order
  });
});
