import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => {
  type Row = { fid: number; params: number[] };
  type Snap = { label: string; rows: Row[] };
  const cloneRows = (rows: Row[]) => rows.map((row) => ({ fid: row.fid, params: [...row.params] }));

  class HistoryEngine {
    rows: Row[];
    undo: Snap[] = [];
    redo: Snap[] = [];
    redoBeforeLastPush: Snap[] = [];
    transaction: { undoDepth: number; redo: Snap[]; redoBeforeLastPush: Snap[] } | null = null;
    pushes = 0;
    cap: number;
    locked = false;
    log: string[] = [];

    constructor(params: number[], cap = 3) {
      this.rows = [{ fid: 114, params: [...params] }];
      this.cap = cap;
    }
    private snapshot(label: string): Snap { return { label, rows: cloneRows(this.rows) }; }
    private push(label: string) {
      this.undo.push(this.snapshot(label));
      this.pushes++;
      if (!this.transaction) while (this.undo.length > this.cap) this.undo.shift();
      this.redoBeforeLastPush = this.redo;
      this.redo = [];
    }
    push_history(label: string) { this.push(label); }
    smart_add_filter(_layer: number, fid: number, params: Float32Array) {
      if (this.locked) return;
      this.push("Smart Filter");
      this.rows.push({ fid, params: Array.from(params) });
    }
    smart_update_filter(_layer: number, index: number, params: Float32Array) {
      if (this.locked || !this.rows[index]) return;
      this.push("Smart Filter");
      this.rows[index] = { fid: this.rows[index].fid, params: Array.from(params) };
    }
    smart_filter_count() { return this.rows.length; }
    smart_filter_id(_layer: number, index: number) { return this.rows[index]?.fid ?? -1; }
    layer_kind(_layer?: number) { return 7; }
    layer_locked(_layer?: number) { return this.locked; }
    undo_pushes() { return this.pushes; }
    set_history_states(cap: number) {
      this.cap = cap;
      if (!this.transaction) while (this.undo.length > this.cap) this.undo.shift();
    }
    drop_last_undo() {
      this.log.push("drop");
      this.undo.pop();
      this.redo = this.redoBeforeLastPush;
      this.redoBeforeLastPush = [];
    }
    undo_one() {
      this.log.push("undo");
      const entry = this.undo.pop();
      if (!entry) return;
      this.redo.push(this.snapshot(entry.label));
      this.rows = cloneRows(entry.rows);
    }
    begin_history_transaction() {
      if (this.transaction) return false;
      this.transaction = {
        undoDepth: this.undo.length,
        redo: this.redo,
        redoBeforeLastPush: this.redoBeforeLastPush,
      };
      this.redo = []; this.redoBeforeLastPush = [];
      return true;
    }
    reset_history_transaction() {
      if (!this.transaction || this.undo.length < this.transaction.undoDepth) return false;
      while (this.undo.length > this.transaction.undoDepth) {
        const entry = this.undo.pop()!;
        this.rows = cloneRows(entry.rows);
      }
      this.redo = []; this.redoBeforeLastPush = [];
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
      this.redo = []; this.redoBeforeLastPush = [];
      while (this.undo.length > this.cap) this.undo.shift();
      return true;
    }
  }

  const original = Array.from(Float32Array.of(1, 18, 0.3, 0.2, 20, 30, 1, 40, 0.5, 0, 1));
  const state = { activeDocId: 1, activeLayerId: 3, historyStates: 3, documents: [{ id: 1, revision: 0 }] };
  const docs = new Map<number, HistoryEngine>();
  const slots: Array<{ current: any }> = [];
  const pendingEffects: Array<() => void> = [];
  const rafs = new Map<number, FrameRequestCallback>();
  let cursor = 0;
  let nextRaf = 1;
  let root: (() => void) | null = null;
  const calls: string[] = [];
  const context = {
    arg: null as unknown,
    current: "irisBlur",
    open: () => {},
    close: () => { calls.push("close"); },
  };

  return {
    HistoryEngine, original, state, docs, slots, pendingEffects, rafs, calls, context,
    reset() {
      state.activeDocId = 1; state.activeLayerId = 3; state.historyStates = 3;
      state.documents = [{ id: 1, revision: 0 }];
      docs.clear(); slots.length = 0; pendingEffects.length = 0; rafs.clear(); calls.length = 0;
      cursor = 0; nextRaf = 1; root = null;
      context.arg = { docId: 1, layerId: 3, index: 0, fid: 114, params: [...original] };
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
      const queued = [...rafs.entries()]; rafs.clear();
      for (const [, fn] of queued) fn(0);
    },
  };
});

vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  return {
    ...real,
    useRef: (initial: unknown) => stub.slot(initial),
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useContext: () => stub.context,
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
    useState: (initial: unknown) => {
      const slot = stub.slot(typeof initial === "function" ? (initial as () => unknown)() : initial);
      return [slot.current, (next: unknown) => {
        slot.current = typeof next === "function" ? (next as (value: unknown) => unknown)(slot.current) : next;
        stub.rerender();
      }];
    },
  };
});

vi.mock("@monet-ui/monet-react", async () => ({
  ...await vi.importActual<Record<string, unknown>>("@monet-ui/monet-react"),
  useMonetContext: () => ({ platform: "mac" }),
  useToast: () => ({ show: () => {} }),
}));

vi.mock("../state/app", () => {
  const views = new WeakMap<object, InstanceType<typeof stub.HistoryEngine>>();
  const view = (value: InstanceType<typeof stub.HistoryEngine>) => {
    let cached = views.get(value);
    if (!cached) {
      cached = new Proxy(value, {
        get(target, prop, receiver) {
          if (prop === "undo") return () => target.undo_one();
          const member = Reflect.get(target, prop, receiver);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
      views.set(value, cached);
    }
    return cached;
  };
  const engine = {
    get engine() {
      const value = stub.docs.get(stub.state.activeDocId);
      return value ? view(value) : null;
    },
    get e() {
      const value = stub.docs.get(stub.state.activeDocId);
      if (!value) throw new Error("no active engine");
      return view(value);
    },
    width: 400, height: 300, syncSuspended: false,
    commit: () => {
      stub.calls.push(`commit:${stub.state.activeDocId}`);
      if (!stub.docs.get(stub.state.activeDocId)?.transaction) stub.calls.push(`dirty:${stub.state.activeDocId}`);
      return true;
    },
    blit: () => { stub.calls.push(`blit:${stub.state.activeDocId}`); },
    sync: () => { stub.calls.push(`sync:${stub.state.activeDocId}`); },
    refreshFromEngine: () => { stub.calls.push(`refresh:${stub.state.activeDocId}`); },
  };
  const smart = {
    updateFilter(layer: number, index: number, fid: number, params: Float32Array) {
      const e = engine.e;
      if (e.layer_kind(layer) !== 7 || e.smart_filter_id(layer, index) !== fid) return false;
      const before = e.undo_pushes();
      e.smart_update_filter(layer, index, params);
      engine.commit();
      return e.undo_pushes() > before;
    },
  };
  const add = (fid: number, params: number[]) => {
    const e = engine.e;
    e.smart_add_filter(stub.state.activeLayerId, fid, Float32Array.from(params));
    engine.commit();
  };
  const values: Record<string, unknown> = {
    engine, smart,
    useStore: (select: (state: typeof stub.state) => unknown) => select(stub.state),
    store: {
      get state() { return stub.state; },
      mutateDocEngine(docId: number, mutate: (e: InstanceType<typeof stub.HistoryEngine>) => boolean) {
        const e = stub.docs.get(docId);
        return e ? mutate(e) : false;
      },
    },
    actions: {
      suspend: () => {},
      mark: () => ({ marker: true }),
      rollback: () => { stub.calls.push("rollback"); },
      commit: (_mark: unknown, _run: () => void, op: unknown) => { stub.calls.push(`record:${JSON.stringify(op)}`); },
    },
    runBlurSteps: () => 0,
    commitBlurSteps: () => false,
    applyGalleryBlurPins: (kind: number, radius: number, pins: Float32Array, bokeh: number, color: number) =>
      add(114, [kind, radius, bokeh, color, ...pins]),
    applySpinBlurPins: (angle: number, strobe: number, pins: Float32Array) => add(115, [angle, strobe, ...pins]),
    fil: {
      pathBlur: (angle: number, speed: number, taper: number, centered: boolean) => add(15, [angle, speed, taper, centered ? 1 : 0]),
      noise: (amount: number, mono: boolean, gaussian: boolean) => add(11, [amount, mono ? 1 : 0, 1, gaussian ? 1 : 0]),
    },
  };
  return new Proxy(values, {
    has: () => true,
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
    get: (target, prop: string) => {
      if (prop === "then") return undefined;
      return prop in target ? target[prop] : (..._args: unknown[]) => undefined;
    },
  });
});

globalThis.requestAnimationFrame = ((fn: FrameRequestCallback) => stub.requestFrame(fn)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => stub.cancelFrame(id)) as typeof cancelAnimationFrame;

const { BlurGallery } = await import("./Dialogs");

type El = { type: unknown; props: Record<string, any> };
function walk(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return out; }
  const el = node as El | null;
  if (!el || typeof el !== "object" || !("props" in el)) return out;
  out.push(el); walk(el.props.children, out); return out;
}

function mount() {
  let value!: El;
  const render = () => { stub.begin(render); value = BlurGallery({ tool: 1 }) as unknown as El; };
  render(); stub.flushEffects(); stub.flushFrames();
  return { value: () => value, rerender: () => { render(); stub.flushEffects(); stub.flushFrames(); }, unmount: () => stub.unmount() };
}

beforeEach(() => { stub.reset(); });

describe("Blur Gallery preview history", () => {
  it("rolls a force-unmounted smart preview back at the cap without losing history or redo", () => {
    const e = new stub.HistoryEngine(stub.original, 3);
    stub.docs.set(1, e);
    for (const label of ["Levels", "Brush", "Crop"]) e.push_history(label);

    const ui = mount();
    expect(e.transaction).not.toBeNull();
    expect(e.cap).toBe(3);
    expect(e.undo.map((entry) => entry.label)).toEqual(["Levels", "Brush", "Crop", "Smart Filter"]);
    ui.unmount();

    expect(e.rows[0].params).toEqual(stub.original);
    expect(e.undo.map((entry) => entry.label)).toEqual(["Levels", "Brush", "Crop"]);
    expect(e.cap).toBe(3);
    expect(e.transaction).toBeNull();
    expect(stub.calls.filter((call) => call.startsWith("dirty:"))).toEqual([]);

    // Repeat with a real redo branch: Cancel's restore-by-drop path must keep it.
    stub.reset();
    const withRedo = new stub.HistoryEngine(stub.original, 3);
    stub.docs.set(1, withRedo);
    withRedo.push_history("Levels"); withRedo.push_history("Crop"); withRedo.undo_one();
    const redoLabel = withRedo.redo[0].label;
    mount().unmount();
    expect(withRedo.redo.map((entry) => entry.label)).toEqual([redoLabel]);
  });

  it("targets the opening document on replacement after a tab switch", () => {
    const first = new stub.HistoryEngine(stub.original, 3);
    const second = new stub.HistoryEngine(stub.original, 3);
    first.push_history("Doc 1 state"); second.push_history("Doc 2 state");
    stub.docs.set(1, first); stub.docs.set(2, second);
    const ui = mount();

    stub.state.activeDocId = 2;
    ui.unmount();

    expect(first.rows[0].params).toEqual(stub.original);
    expect(first.undo.map((entry) => entry.label)).toEqual(["Doc 1 state"]);
    expect(second.undo.map((entry) => entry.label)).toEqual(["Doc 2 state"]);
    expect(second.log).not.toContain("undo");
  });

  it("cancels the captured engine when Revert replaces it under the same document id", () => {
    const first = new stub.HistoryEngine(stub.original, 3);
    stub.docs.set(1, first);
    const ui = mount();
    expect(first.transaction).not.toBeNull();

    const replacement = new stub.HistoryEngine(stub.original, 3);
    stub.docs.set(1, replacement);
    stub.state.documents = [{ id: 1, revision: 1 }];
    ui.rerender();

    expect(first.rows[0].params).toEqual(stub.original);
    expect(first.transaction).toBeNull();
    expect(replacement.undo).toEqual([]);
    const ok = walk(ui.value().props.footer).find((el) => el.props.variant === "primary")!;
    expect(ok.props.disabled).toBe(true);
    ui.unmount();
  });

  it("disables OK after a tab switch and never commits through the new active document", () => {
    const first = new stub.HistoryEngine(stub.original, 3);
    const second = new stub.HistoryEngine(stub.original, 3);
    stub.docs.set(1, first); stub.docs.set(2, second);
    const ui = mount();
    stub.state.activeDocId = 2;
    ui.rerender();

    const ok = walk(ui.value().props.footer).find((el) => el.props.variant === "primary")!;
    expect(ok.props.disabled).toBe(true);
    ok.props.onClick();
    expect(second.undo).toEqual([]);
    expect(first.rows[0].params).toEqual(stub.original);
    ui.unmount();
  });

  it("marks an accepted re-edit dirty once and records its explicit replay op", () => {
    const e = new stub.HistoryEngine(stub.original, 3);
    stub.docs.set(1, e);
    const ui = mount();
    const ok = walk(ui.value().props.footer).find((el) => el.props.variant === "primary")!;
    ok.props.onClick();

    expect(stub.calls.filter((call) => call.startsWith("dirty:"))).toEqual(["dirty:1"]);
    expect(stub.calls.some((call) => call.includes('record:["updatePinnedBlurFilter"'))).toBe(true);
    expect(e.transaction).toBeNull();
    ui.unmount();
  });
});
