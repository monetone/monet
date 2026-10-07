import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewDialog, Row, useScratchAdjustmentLayer } from "./common";

// These dialogs deliberately keep their preview edits in the real engine so
// the document canvas stays live. This small engine mirror proves the modal
// transaction boundary: cap eviction and redo are deferred until OK, while
// Cancel, replacement and target switches restore the exact opening state.
const stub = vi.hoisted(() => {
  type Snap = { label: string; value: number; layers: number[]; activeLayerId: number };

  class HistoryEngine {
    value = 0;
    layers = [3];
    activeLayerId = 3;
    undo: Snap[] = [];
    redo: Snap[] = [];
    redoBeforeLastPush: Snap[] = [];
    transaction: { undoDepth: number; redo: Snap[]; redoBeforeLastPush: Snap[] } | null = null;
    pushes = 0;
    dirtyCommits = 0;
    locked = false;
    readonly log: string[] = [];

    constructor(readonly cap = 3) {}
    private snap(label: string): Snap {
      return { label, value: this.value, layers: [...this.layers], activeLayerId: this.activeLayerId };
    }
    private restore(snap: Snap) {
      this.value = snap.value;
      this.layers = [...snap.layers];
      this.activeLayerId = snap.activeLayerId;
    }
    private push(label: string) {
      this.undo.push(this.snap(label));
      this.pushes++;
      if (!this.transaction) while (this.undo.length > this.cap) this.undo.shift();
      this.redoBeforeLastPush = this.redo;
      this.redo = [];
    }
    edit(label: string, value: number) {
      if (this.locked) return;
      this.push(label);
      this.value = value;
    }
    createLayer(id: number) {
      this.push("New Adjustment Layer");
      this.layers.push(id);
      this.activeLayerId = id;
    }
    editLayer(id: number, value: number) {
      if (!this.layers.includes(id)) return;
      this.push("Adjustment Settings");
      this.value = value;
    }
    push_history(label: string) { this.push(label); }
    drop_last_undo() {
      this.undo.pop();
      this.redo = this.redoBeforeLastPush;
      this.redoBeforeLastPush = [];
    }
    undo_pushes() { return this.pushes; }
    end_prop_edit() { this.log.push("end_prop_edit"); }
    undoOne() {
      const entry = this.undo.pop();
      if (!entry) return;
      this.redo.push(this.snap(entry.label));
      this.restore(entry);
    }
    begin_history_transaction() {
      if (this.transaction) return false;
      this.transaction = {
        undoDepth: this.undo.length,
        redo: this.redo,
        redoBeforeLastPush: this.redoBeforeLastPush,
      };
      this.redo = [];
      this.redoBeforeLastPush = [];
      return true;
    }
    reset_history_transaction() {
      if (!this.transaction || this.undo.length < this.transaction.undoDepth) return false;
      while (this.undo.length > this.transaction.undoDepth) this.restore(this.undo.pop()!);
      this.redo = [];
      this.redoBeforeLastPush = [];
      return true;
    }
    cancel_history_transaction() {
      if (!this.reset_history_transaction()) return false;
      const transaction = this.transaction!;
      this.transaction = null;
      this.redo = transaction.redo;
      this.redoBeforeLastPush = transaction.redoBeforeLastPush;
      while (this.undo.length > this.cap) this.undo.shift();
      return true;
    }
    commit_history_transaction() {
      if (!this.transaction || this.undo.length < this.transaction.undoDepth) return false;
      if (this.undo.length === this.transaction.undoDepth) {
        this.cancel_history_transaction();
        return false;
      }
      this.transaction = null;
      this.redo = [];
      this.redoBeforeLastPush = [];
      while (this.undo.length > this.cap) this.undo.shift();
      return true;
    }
    history_transaction_active() { return this.transaction !== null; }
  }

  const state = { activeDocId: 1, activeLayerId: 3 };
  const docs = new Map<number, HistoryEngine>();
  const calls: string[] = [];
  const slots: Array<{ current: any }> = [];
  const pendingEffects: Array<() => void> = [];
  const rafs = new Map<number, FrameRequestCallback>();
  let cursor = 0;
  let nextRaf = 1;
  let root: (() => void) | null = null;

  const engine = {
    get engine() { return docs.get(state.activeDocId) ?? null; },
    get e() {
      const value = docs.get(state.activeDocId);
      if (!value) throw new Error("no active engine");
      return value;
    },
    syncSuspended: false,
    commit() {
      const active = docs.get(state.activeDocId);
      if (active) {
        state.activeLayerId = active.activeLayerId;
        if (!active.history_transaction_active()) active.dirtyCommits++;
      }
      calls.push(`commit:${state.activeDocId}`);
      return true;
    },
    refreshFromEngine() { calls.push(`refresh:${state.activeDocId}`); },
    blit: () => { calls.push(`blit:${state.activeDocId}`); },
    sync: () => { calls.push(`sync:${state.activeDocId}`); },
  };

  return {
    HistoryEngine, state, docs, calls, slots, pendingEffects, rafs, engine,
    reset() {
      state.activeDocId = 1;
      state.activeLayerId = 3;
      docs.clear();
      calls.length = 0;
      slots.length = 0;
      pendingEffects.length = 0;
      rafs.clear();
      engine.syncSuspended = false;
      cursor = 0;
      nextRaf = 1;
      root = null;
    },
    begin(render: () => void) { cursor = 0; root = render; },
    slot(initial: unknown) { const i = cursor++; return (slots[i] ??= { current: initial }); },
    rerender() { root?.(); },
    flushEffects() { while (pendingEffects.length) pendingEffects.shift()!(); },
    unmount() {
      for (const slot of slots) if (slot.current?.kind === "effect") slot.current.cleanup?.();
    },
    requestFrame(fn: FrameRequestCallback) { const id = nextRaf++; rafs.set(id, fn); return id; },
    cancelFrame(id: number) { rafs.delete(id); },
    flushFrames() {
      const queued = [...rafs.entries()];
      rafs.clear();
      for (const [, fn] of queued) fn(0);
    },
  };
});

vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  return {
    ...real,
    createContext: (value: unknown) => ({ value }),
    useContext: () => ({ close: () => { stub.calls.push("close"); } }),
    useRef: (initial: unknown) => stub.slot(initial),
    useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => {
      const slot = stub.slot(null as null | { kind: "effect"; deps?: unknown[]; cleanup?: (() => void) | void });
      const previous = slot.current;
      const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length
        || deps.some((value, i) => !Object.is(value, previous.deps[i]));
      if (changed) stub.pendingEffects.push(() => {
        previous?.cleanup?.();
        const entry = { kind: "effect" as const, deps, cleanup: undefined as (() => void) | void };
        slot.current = entry;
        entry.cleanup = fn();
      });
    },
  };
});

vi.mock("@monet-ui/monet-react", () => ({
  Dialog: () => null,
  Button: () => null,
  Slider: () => null,
  BLEND_MODES: [],
}));

vi.mock("../../state/app", () => ({
  engine: stub.engine,
  useStore: (select: (state: typeof stub.state) => unknown) => select(stub.state),
  store: {
    get state() { return stub.state; },
    mutateDocEngine(docId: number, mutate: (engine: InstanceType<typeof stub.HistoryEngine>) => boolean) {
      const target = stub.docs.get(docId);
      return target ? mutate(target) : false;
    },
    setAdjustmentParams(id: number, params: Float32Array) {
      const target = stub.docs.get(stub.state.activeDocId)!;
      target.editLayer(id, params[0] ?? 0);
      stub.engine.commit();
    },
    adjParams: () => new Float32Array(),
    setFillParams: () => {},
    replacePatternFill: () => {},
  },
  actions: {
    suspend: () => {},
    record: () => { stub.calls.push("record"); },
    mark: () => ({}),
    rollback: () => { stub.calls.push("rollback"); },
    commit: () => { stub.calls.push("record"); },
  },
}));

globalThis.requestAnimationFrame = ((fn: FrameRequestCallback) => stub.requestFrame(fn)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => stub.cancelFrame(id)) as typeof cancelAnimationFrame;

type El = { props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el);
  walk(el.props.children, out);
  return out;
}

function mountPreview(value = 10) {
  let dialog!: El;
  let current = value;
  const render = () => {
    stub.begin(render);
    dialog = PreviewDialog({
      title: "Gaussian Blur",
      apply: () => {
        stub.docs.get(stub.state.activeDocId)!.edit("Gaussian Blur", current);
        stub.engine.commit();
      },
      deps: [current],
      children: null,
    }) as unknown as El;
  };
  render();
  stub.flushEffects();
  stub.flushFrames();
  return {
    value: () => dialog,
    rerender: () => { render(); stub.flushEffects(); stub.flushFrames(); },
    update: (next: number) => { current = next; render(); stub.flushEffects(); stub.flushFrames(); },
    unmount: () => stub.unmount(),
  };
}

function mountScratch() {
  let scratch!: ReturnType<typeof useScratchAdjustmentLayer>;
  const Hook = () => {
    stub.begin(Hook);
    scratch = useScratchAdjustmentLayer(() => {
      const target = stub.docs.get(stub.state.activeDocId)!;
      target.createLayer(7);
      stub.engine.commit();
      return 7;
    });
  };
  Hook();
  stub.flushEffects();
  return {
    value: () => scratch,
    rerender: () => { Hook(); stub.flushEffects(); },
    unmount: () => stub.unmount(),
  };
}

beforeEach(() => { stub.reset(); });

describe("Row", () => {
  it("steps in the precision shown to the user", () => {
    const integer = walk(Row({ label: "Hue", value: 0, min: -100, max: 100, onChange: () => {} }) as unknown as El)
      .find((el) => el.props["aria-label"] === "Hue")!;
    const fractional = walk(Row({ label: "Gamma", value: 1, min: 0.1, max: 3, decimals: 2, onChange: () => {} }) as unknown as El)
      .find((el) => el.props["aria-label"] === "Gamma")!;
    expect(integer.props.step).toBe(1);
    expect(fractional.props.step).toBe(0.01);
  });
});

describe("PreviewDialog", () => {
  it("rolls replacement back at the history cap and preserves redo", () => {
    const capped = new stub.HistoryEngine(3);
    stub.docs.set(1, capped);
    for (const label of ["Levels", "Brush", "Crop"]) capped.push_history(label);

    const preview = mountPreview();
    expect(capped.undo.map((entry) => entry.label)).toEqual(["Levels", "Brush", "Crop", "Gaussian Blur"]);
    preview.unmount();
    expect(capped.value).toBe(0);
    expect(capped.undo.map((entry) => entry.label)).toEqual(["Levels", "Brush", "Crop"]);
    expect(capped.transaction).toBeNull();
    expect(capped.dirtyCommits).toBe(0);

    stub.reset();
    const withRedo = new stub.HistoryEngine(3);
    stub.docs.set(1, withRedo);
    withRedo.edit("Levels", 1);
    withRedo.edit("Crop", 2);
    withRedo.undoOne();
    const redo = withRedo.redo.map((entry) => entry.label);
    mountPreview().unmount();
    expect(withRedo.value).toBe(1);
    expect(withRedo.redo.map((entry) => entry.label)).toEqual(redo);
  });

  it("cancels the opening engine and disables/refuses OK after a target switch", () => {
    const first = new stub.HistoryEngine();
    const second = new stub.HistoryEngine();
    second.activeLayerId = 9;
    second.layers = [9];
    stub.docs.set(1, first);
    stub.docs.set(2, second);
    const preview = mountPreview();

    stub.state.activeDocId = 2;
    stub.state.activeLayerId = 9;
    preview.rerender();
    const ok = walk(preview.value().props.footer).find((el) => el.props.variant === "primary")!;
    expect(ok.props.disabled).toBe(true);
    ok.props.onClick();

    expect(first.value).toBe(0);
    expect(first.undo).toEqual([]);
    expect(second.value).toBe(0);
    expect(second.undo).toEqual([]);
    expect(stub.calls).not.toContain("record");
    expect(stub.calls).toContain("close");
    preview.unmount();
  });

  it("commits one final preview at the cap and records only accepted edits", () => {
    const accepted = new stub.HistoryEngine(3);
    stub.docs.set(1, accepted);
    for (const label of ["Levels", "Brush", "Crop"]) accepted.push_history(label);
    const preview = mountPreview();
    preview.update(12);
    expect(accepted.value).toBe(12);
    expect(accepted.undo.map((entry) => entry.label)).toEqual(["Levels", "Brush", "Crop", "Gaussian Blur"]);
    const ok = walk(preview.value().props.footer).find((el) => el.props.variant === "primary")!;
    ok.props.onClick();
    expect(accepted.undo.map((entry) => entry.label)).toEqual(["Brush", "Crop", "Gaussian Blur"]);
    expect(stub.calls).toContain("record");
    expect(accepted.dirtyCommits).toBe(1);
    preview.unmount();

    stub.reset();
    const refused = new stub.HistoryEngine();
    stub.docs.set(1, refused);
    refused.edit("Levels", 1);
    refused.edit("Crop", 2);
    refused.undoOne();
    const redo = refused.redo.map((entry) => entry.label);
    refused.locked = true;
    const lockedPreview = mountPreview();
    const lockedOk = walk(lockedPreview.value().props.footer).find((el) => el.props.variant === "primary")!;
    lockedOk.props.onClick();
    expect(refused.redo.map((entry) => entry.label)).toEqual(redo);
    expect(stub.calls).not.toContain("record");
    expect(refused.dirtyCommits).toBe(0);
    lockedPreview.unmount();
  });
});

describe("useScratchAdjustmentLayer", () => {
  it("cancels a created layer and its edits on replacement without consuming history", () => {
    const target = new stub.HistoryEngine(3);
    stub.docs.set(1, target);
    for (const label of ["Levels", "Brush", "Crop"]) target.push_history(label);
    const scratch = mountScratch();
    scratch.value().applyParams(new Float32Array([8]));
    expect(target.undo.map((entry) => entry.label)).toEqual([
      "Levels", "Brush", "Crop", "New Adjustment Layer",
    ]);

    scratch.unmount();
    expect(target.layers).toEqual([3]);
    expect(target.value).toBe(0);
    expect(target.undo.map((entry) => entry.label)).toEqual(["Levels", "Brush", "Crop"]);
    expect(target.transaction).toBeNull();
    expect(target.dirtyCommits).toBe(0);
    expect(stub.calls).toContain("rollback");

    stub.reset();
    const withRedo = new stub.HistoryEngine();
    stub.docs.set(1, withRedo);
    withRedo.edit("Levels", 1);
    withRedo.edit("Crop", 2);
    withRedo.undoOne();
    const redo = withRedo.redo.map((entry) => entry.label);
    const redoScratch = mountScratch();
    redoScratch.value().applyParams(new Float32Array([8]));
    redoScratch.unmount();
    expect(withRedo.value).toBe(1);
    expect(withRedo.redo.map((entry) => entry.label)).toEqual(redo);
  });

  it("commits on-target edits but refuses OK after a document switch", () => {
    const accepted = new stub.HistoryEngine();
    stub.docs.set(1, accepted);
    for (const label of ["Levels", "Brush", "Crop"]) accepted.push_history(label);
    const scratch = mountScratch();
    scratch.value().applyParams(new Float32Array([8]));
    scratch.value().finish(() => { stub.calls.push("close"); });
    expect(accepted.layers).toEqual([3, 7]);
    expect(accepted.value).toBe(8);
    expect(accepted.transaction).toBeNull();
    expect(accepted.log).toEqual(["end_prop_edit"]);
    expect(accepted.dirtyCommits).toBe(1);
    expect(stub.calls).not.toContain("rollback");
    expect(accepted.undo.map((entry) => entry.label)).toEqual(["Brush", "Crop", "New Adjustment Layer"]);
    accepted.undoOne();
    expect(accepted.layers).toEqual([3]);
    expect(accepted.value).toBe(0);
    scratch.unmount();

    stub.reset();
    const first = new stub.HistoryEngine();
    const second = new stub.HistoryEngine();
    second.activeLayerId = 9;
    second.layers = [9];
    stub.docs.set(1, first);
    stub.docs.set(2, second);
    const switched = mountScratch();
    switched.value().applyParams(new Float32Array([8]));
    stub.state.activeDocId = 2;
    stub.state.activeLayerId = 9;
    switched.rerender();
    switched.value().finish(() => { stub.calls.push("close"); });

    expect(first.layers).toEqual([3]);
    expect(first.value).toBe(0);
    expect(first.undo).toEqual([]);
    expect(second.layers).toEqual([9]);
    expect(second.undo).toEqual([]);
    expect(stub.calls).toContain("rollback");
    expect(stub.calls).toContain("close");
    switched.unmount();
  });
});
