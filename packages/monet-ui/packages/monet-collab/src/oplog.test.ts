// Op-log — operations broadcast to peers (echo-suppressed by clientId).
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { OpLog } from "./oplog";

const sync = (a, b) => { Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); };

describe("OpLog", () => {
  it("delivers a peer's ops but not your own echoes", () => {
    const da = new Y.Doc(), db = new Y.Doc();
    const a = new OpLog(da, 1, "strokes");
    const b = new OpLog(db, 2, "strokes");
    const aGot = [], bGot = [];
    a.onRemoteOp((op) => aGot.push(op));
    b.onRemoteOp((op) => bGot.push(op));

    a.push({ kind: "stroke", layer: 7, pts: [[0, 0], [3, 4]] });
    sync(da, db);
    expect(bGot).toEqual([{ kind: "stroke", layer: 7, pts: [[0, 0], [3, 4]] }]); // B sees A's op
    expect(aGot).toEqual([]); // A doesn't see its own

    b.push({ kind: "stroke", layer: 8, pts: [[1, 1]] });
    sync(da, db);
    expect(aGot).toEqual([{ kind: "stroke", layer: 8, pts: [[1, 1]] }]); // A sees B's op
  });

  // #229 — a fresh doc has not synced when the OpLog is built, so the cursor it
  // snapshots is 0 and the room's whole history used to arrive through
  // onRemoteOp as if it had just been drawn (and a late joiner following the
  // doc comment's own recipe applied every op TWICE). With the sync gate,
  // history is history: replayAll owns it, onRemoteOp only sees what comes next.
  it("with the sync gate, the room's history is not delivered as live ops", async () => {
    const da = new Y.Doc();
    const a = new OpLog(da, 1);
    a.push({ n: 1 });
    a.push({ n: 2 });

    const dl = new Y.Doc(); // late joiner: OpLog built BEFORE the room syncs
    let markSynced = () => {};
    const synced = new Promise<void>((resolve) => { markSynced = resolve; });
    const late = new OpLog(dl, 9, "ops", { synced });
    const live = [];
    late.onRemoteOp((op) => live.push(op));

    Y.applyUpdate(dl, Y.encodeStateAsUpdate(da)); // the initial sync lands
    expect(live).toEqual([]); // history is not "just drawn"

    markSynced();
    await synced;

    const replayed = [];
    late.replayAll((op) => replayed.push(op));
    expect(replayed).toEqual([{ n: 1 }, { n: 2 }]);

    // …and a genuinely new op afterwards is delivered exactly once, never again
    // through the replay path.
    a.push({ n: 3 });
    Y.applyUpdate(dl, Y.encodeStateAsUpdate(da));
    expect(live).toEqual([{ n: 3 }]);
    const twice = [];
    late.replayAll((op) => twice.push(op));
    expect(live).toEqual([{ n: 3 }]);
    expect(twice).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("replayAll reconstructs the full op history for a late joiner", () => {
    const da = new Y.Doc();
    const a = new OpLog(da, 1);
    a.push({ n: 1 });
    a.push({ n: 2 });
    const dl = new Y.Doc();
    Y.applyUpdate(dl, Y.encodeStateAsUpdate(da)); // late joiner syncs the doc
    const late = new OpLog(dl, 9);
    const seen = [];
    late.replayAll((op) => seen.push(op));
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });
});
