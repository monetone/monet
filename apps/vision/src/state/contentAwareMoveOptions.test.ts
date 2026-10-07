// #429: Content-Aware Move's Mode / Structure / Color reach the engine, old
// two-argument recordings still replay, and Transform On Drop previews inside a
// history transaction that commits as one recorded step or cancels to nothing.
// What each option does to the pixels is covered in packages/engine.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { serializeActionsFile } from "./actionSets";
import {
  actions, beginContentAwareMoveDrop, cancelContentAwareMoveDrop, commitContentAwareMoveDrop,
  contentAwareMoveBy, engine, store, updateContentAwareMoveDrop,
} from "./app";

/** A recording engine with a 8×8 marquee at (5,5); a refused op pushes no undo. */
function fakeEngine() {
  const calls: unknown[][] = [];
  let pushes = 0;
  let open = false;
  const e = {
    calls,
    refuse: false,
    has_selection: () => true,
    selection_bounds: () => Int32Array.from([5, 5, 8, 8]),
    undo_pushes: () => pushes,
    content_aware_move: (...args: unknown[]) => { calls.push(["content_aware_move", ...args]); if (!e.refuse) pushes++; },
    begin_history_transaction: () => { calls.push(["begin"]); open = true; return true; },
    reset_history_transaction: () => { calls.push(["reset"]); return true; },
    commit_history_transaction: () => { calls.push(["commit"]); open = false; return true; },
    cancel_history_transaction: () => { calls.push(["cancel"]); open = false; return true; },
    history_transaction_active: () => open,
  };
  return e;
}

let e: ReturnType<typeof fakeEngine>;
beforeEach(() => {
  vi.restoreAllMocks();
  e = fakeEngine();
  engine.engine = e as never;
  vi.spyOn(engine, "commit").mockReturnValue(true);
  vi.spyOn(engine, "refreshFromEngine").mockImplementation(() => {});
  store.setOptions({ camExtend: false, camStructure: 4, camColor: 2, camDrop: null });
});

describe("Content-Aware Move options reach the engine (#429)", () => {
  it("sends Move / Structure 4 / Color 2 / identity transform by default, with the drag rounded", () => {
    contentAwareMoveBy(20.4, -0.6);
    expect(e.calls).toEqual([["content_aware_move", 20, -1, false, 4, 2, 1, 1, 0]]);
  });

  it("replays an old two-argument recording with those defaults", () => {
    actions.clearNamed();
    const json = serializeActionsFile([
      { name: "Old move", favorite: false, createdAt: 1, steps: [["contentAwareMoveBy", [20, 0]]] },
    ]);
    expect(actions.importJson(json)).toMatchObject({ imported: 1, rejected: [] });

    actions.playNamed(actions.list()[0].id);

    expect(e.calls).toEqual([["content_aware_move", 20, 0, false, 4, 2, 1, 1, 0]]);
  });
});

describe("Transform On Drop (#429)", () => {
  it("previews the drop inside a history transaction and opens the frame over it", () => {
    store.setOptions({ camExtend: true, camStructure: 6, camColor: 9 });

    beginContentAwareMoveDrop(20, 0);

    expect(e.calls).toEqual([["begin"], ["content_aware_move", 20, 0, true, 6, 9, 1, 1, 0]]);
    expect(store.state.camDrop).toEqual({ box: { x: 25, y: 5, w: 8, h: 8 }, dx: 20, dy: 0, t: {} });
  });

  it("commits the frame as one recorded step carrying its scale, rotation and nudge", () => {
    beginContentAwareMoveDrop(20, 0);
    updateContentAwareMoveDrop({ sx: 2, sy: 1.5 });
    updateContentAwareMoveDrop({ deg: 30, tx: 3.4, ty: -1 });
    e.calls.length = 0;
    actions.start();
    try {
      commitContentAwareMoveDrop();
    } finally { actions.stop(); }

    expect(e.calls).toEqual([["reset"], ["content_aware_move", 23, -1, false, 4, 2, 2, 1.5, 30], ["commit"]]);
    expect(actions.count(), "the preview is not recorded, the commit is").toBe(1);
    expect(store.state.camDrop).toBeNull();
  });

  it("cancels history-neutrally without re-running the move", () => {
    beginContentAwareMoveDrop(20, 0);
    e.calls.length = 0;

    cancelContentAwareMoveDrop();

    expect(e.calls).toEqual([["cancel"]]);
    expect(store.state.camDrop).toBeNull();
  });

  it("opens no frame when the engine refuses the preview", () => {
    e.refuse = true;

    beginContentAwareMoveDrop(20, 0);

    expect(e.calls.map((c) => c[0])).toEqual(["begin", "content_aware_move", "cancel"]);
    expect(store.state.camDrop).toBeNull();
  });

  it("cancels on the document it opened on once another document is active", () => {
    beginContentAwareMoveDrop(20, 0);
    const other = fakeEngine();
    engine.engine = other as never;
    e.calls.length = 0;

    commitContentAwareMoveDrop();

    expect(e.calls).toEqual([["cancel"]]);
    expect(other.calls).toEqual([]);
    expect(store.state.camDrop).toBeNull();
  });
});
