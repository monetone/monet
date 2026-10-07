// #456: Path Selection selects SEVERAL path components (shift-click), drags
// them together, keeps the selection after release, and gives the options bar
// Align / Distribute / Arrange over exactly those components — each one undo
// step. The store is driven for real over a recording engine double.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

const scene = (order: string[]) => JSON.stringify({ layers: [{ items: order.map((id) => ({ type: "path", id })) }] });

function harness(opts: { hits?: string[]; bounds?: Record<string, number[]>; sceneJson?: string; locked?: boolean } = {}) {
  const calls: [string, ...unknown[]][] = [];
  const hits = [...(opts.hits ?? [])];
  const eng = new Proxy({} as Record<string, unknown>, {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push([name, ...args]);
      switch (name) {
        case "vector_hit_test": return hits.shift() ?? "";
        case "vector_item_bounds": return Float32Array.from(opts.bounds?.[args[1] as string] ?? []);
        case "vector_scene_json": return opts.sceneJson ?? "";
        case "layer_kind": return 3;
        default: return 0;
      }
    },
  });
  const client = new Proxy({ engine: eng, e: eng, onCommit: null } as Record<string, unknown>, {
    get: (t, k: string) => {
      if (k in t) return t[k];
      if (k === "consumeEditError") return () => !!opts.locked;
      return (...args: unknown[]) => { calls.push([`client.${k}`, ...args]); return true; };
    },
    set: (t, k: string, v) => { t[k] = v; return true; },
  });
  const store = new Store(client as never);
  const named = (n: string) => calls.filter((c) => c[0] === n);
  return { store, calls, named };
}

describe("Path Selection multi-select (#456)", () => {
  it("a plain click selects one component and replaces the previous selection", () => {
    const { store } = harness({ hits: ["a", "b"] });
    expect(store.pathSelectAt(1, 1)).toBe(true);
    expect(store.state.selectedPaths).toEqual(["a"]);
    store.pathSelectAt(2, 2);
    expect(store.state.selectedPaths).toEqual(["b"]);
  });

  it("shift-click adds a component, and toggles an already-selected one back out", () => {
    const { store } = harness({ hits: ["a", "b", "a"] });
    store.pathSelectAt(1, 1);
    store.pathSelectAt(2, 2, 6, true);
    expect(store.state.selectedPaths).toEqual(["a", "b"]);
    store.pathSelectAt(1, 1, 6, true);
    expect(store.state.selectedPaths).toEqual(["b"]);
  });

  it("a plain click on a selected component keeps the whole selection, so the drag moves all of it", () => {
    const { store, named } = harness({ hits: ["a", "b", "a"] });
    store.pathSelectAt(1, 1);
    store.pathSelectAt(2, 2, 6, true);
    store.pathSelectAt(1, 1);
    expect(store.state.selectedPaths).toEqual(["a", "b"]);
    store.dragSelectedPath(4, 6); // +3, +5 from the grab at (1,1)
    expect(named("vector_translate_item").map((c) => c.slice(1))).toEqual([[0, "a", 3, 5], [0, "b", 3, 5]]);
  });

  it("a plain click on nothing clears; a shift-click on nothing keeps the selection", () => {
    const { store } = harness({ hits: ["a", "", ""] });
    store.pathSelectAt(1, 1);
    store.pathSelectAt(9, 9, 6, true);
    expect(store.state.selectedPaths).toEqual(["a"]);
    store.pathSelectAt(9, 9);
    expect(store.state.selectedPaths).toEqual([]);
  });

  it("keeps the selection after the drag is released (the options bar acts on it)", () => {
    const { store } = harness({ hits: ["a"] });
    store.pathSelectAt(1, 1);
    store.dragSelectedPath(2, 2);
    store.endPathDrag();
    expect(store.state.selectedPaths).toEqual(["a"]);
    store.dragSelectedPath(5, 5); // but a released selection does not drag
    expect(store.state.selectedPaths).toEqual(["a"]);
  });

  it("clears component selection and an unfinished drag when the active layer or document changes", () => {
    const { store, named } = harness({ hits: ["a", "a"] });
    store.pathSelectAt(1, 1);
    store.setOptions({ activeLayerId: 2 });
    expect(store.state.selectedPaths).toEqual([]);
    store.dragSelectedPath(5, 5);
    store.pathSelectAt(1, 1);
    store.setOptions({ activeDocId: 2 });
    expect(store.state.selectedPaths).toEqual([]);
    store.dragSelectedPath(5, 5);
    expect(named("vector_translate_item")).toHaveLength(0);
  });

  // The pre-#456 behaviour, pinned: one component grabbed, one translate per
  // move with the pointer delta, one undo snapshot at the grab.
  it("still drags a single component exactly as before", () => {
    const { store, named } = harness({ hits: ["a"] });
    store.pathSelectAt(10, 10);
    store.dragSelectedPath(15, 12);
    store.dragSelectedPath(20, 20);
    expect(named("vector_begin_edit")).toHaveLength(1);
    expect(named("vector_translate_item").map((c) => c.slice(1))).toEqual([[0, "a", 5, 2], [0, "a", 5, 8]]);
  });

  it("bails before selecting when the layer is locked", () => {
    const { store, named } = harness({ hits: ["a"], locked: true });
    expect(store.pathSelectAt(1, 1)).toBe(false);
    expect(store.state.selectedPaths).toEqual([]);
    store.dragSelectedPath(5, 5);
    expect(named("vector_translate_item")).toHaveLength(0);
  });
});

describe("Path Selection ▸ Align / Distribute (#456)", () => {
  const bounds = { a: [0, 0, 10, 10], b: [30, 20, 20, 40], c: [100, 5, 10, 10] };

  it("aligns only the selected components, in ONE undo step", () => {
    const { store, named, calls } = harness({ hits: ["a", "b"], bounds });
    store.pathSelectAt(1, 1);
    store.pathSelectAt(2, 2, 6, true);
    calls.length = 0;
    store.alignPathComponents(0); // left edges → x = 0: only b moves
    expect(named("vector_begin_edit")).toHaveLength(1);
    expect(named("vector_translate_item").map((c) => c.slice(1))).toEqual([[0, "b", -30, 0]]);
    expect(named("client.commit")).toHaveLength(1);
    // c exists in the scene but was never selected: untouched, never even measured.
    expect(named("vector_item_bounds").map((c) => c[2])).toEqual(["a", "b"]);
  });

  it("distributes three selected components between the outer two", () => {
    const { store, named, calls } = harness({ hits: ["a", "b", "c"], bounds });
    store.pathSelectAt(1, 1);
    store.pathSelectAt(2, 2, 6, true);
    store.pathSelectAt(3, 3, 6, true);
    calls.length = 0;
    store.distributePathComponents(0, 1); // horizontal centres 5, 40, 105 → b's to 55
    expect(named("vector_begin_edit")).toHaveLength(1);
    expect(named("vector_translate_item").map((c) => c.slice(1))).toEqual([[0, "b", 15, 0]]);
    expect(named("client.commit")).toHaveLength(1);
  });

  it("pushes no undo step when nothing can move", () => {
    const { store, named, calls } = harness({ hits: ["a"], bounds });
    store.pathSelectAt(1, 1);
    calls.length = 0;
    store.alignPathComponents(0); // one component
    store.distributePathComponents(0, 0); // fewer than three
    expect(named("vector_begin_edit")).toHaveLength(0);
    expect(named("client.commit")).toHaveLength(0);
  });

  it("refuses on a locked layer without moving anything", () => {
    const opts = { hits: ["a", "b"], bounds, locked: false };
    const { store, named, calls } = harness(opts);
    store.pathSelectAt(1, 1);
    store.pathSelectAt(2, 2, 6, true);
    calls.length = 0;
    // Lock after selecting: the drain now reports a refusal.
    opts.locked = true;
    store.alignPathComponents(0);
    expect(named("vector_translate_item")).toHaveLength(0);
    expect(named("client.commit")).toHaveLength(0);
  });
});

describe("Path Selection ▸ Arrange (#456)", () => {
  it("brings the selected components to the front of the scene in one vector_set_scene", () => {
    const { store, named, calls } = harness({ hits: ["a", "c"], sceneJson: scene(["a", "b", "c", "d"]) });
    store.setTool("pathselect");
    store.pathSelectAt(1, 1);
    store.pathSelectAt(3, 3, 6, true);
    calls.length = 0;
    expect(store.arrangePathComponents(true)).toBe(true);
    const [, id, json] = named("vector_set_scene")[0] as [string, number, string];
    expect(id).toBe(0);
    expect((JSON.parse(json) as { layers: { items: { id: string }[] }[] }).layers[0].items.map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
    expect(named("client.commit")).toHaveLength(1);
    expect(named("vector_begin_edit")).toHaveLength(0); // the scene write is the one undo step
  });

  it("sends to back", () => {
    const { store, named } = harness({ hits: ["d"], sceneJson: scene(["a", "b", "c", "d"]) });
    store.setTool("pathselect");
    store.pathSelectAt(1, 1);
    store.arrangePathComponents(false);
    const json = named("vector_set_scene")[0][2] as string;
    expect((JSON.parse(json) as { layers: { items: { id: string }[] }[] }).layers[0].items.map((i) => i.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("claims the command without an undo step when the order would not change", () => {
    const { store, named } = harness({ hits: ["d"], sceneJson: scene(["a", "b", "c", "d"]) });
    store.setTool("pathselect");
    store.pathSelectAt(1, 1);
    expect(store.arrangePathComponents(true)).toBe(true); // already frontmost
    expect(named("vector_set_scene")).toHaveLength(0);
    expect(named("client.commit")).toHaveLength(0);
  });

  it("leaves Layer ▸ Arrange to the layer when Path Selection is not the tool or nothing is selected", () => {
    const { store, named } = harness({ hits: ["a"], sceneJson: scene(["a", "b"]) });
    store.setTool("pathselect");
    expect(store.arrangePathComponents(true)).toBe(false); // nothing selected
    store.pathSelectAt(1, 1);
    store.setTool("move");
    expect(store.arrangePathComponents(true)).toBe(false); // wrong tool
    expect(named("vector_set_scene")).toHaveLength(0);
  });
});
