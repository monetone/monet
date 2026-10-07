// Preferences ▸ Performance History States and Preferences ▸ Guides, Grid & Slices
// are application preferences, not document state — Photoshop writes them the moment
// they change and reopens on them. Engine-free (node); the dialogs are e2e-covered.
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

// Minimal Storage stand-in — the unit suite runs in node, which has none.
function installStorage(): Map<string, string> {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
  return cells;
}

function fakeEngine() {
  return { set_history_states: vi.fn<(...args: unknown[]) => void>() };
}

function newStore() {
  const engine = fakeEngine();
  const client = { onCommit: null as null | (() => void), engine, sync: vi.fn(), buildNew: vi.fn(() => engine) };
  return { store: new Store(client as never), engine };
}

let cells: Map<string, string>;
beforeEach(() => { cells = installStorage(); });

describe("History States preference", () => {
  it("writes the clamped value the moment it changes", () => {
    const { store, engine } = newStore();
    store.setHistoryStates(200);
    expect(cells.get("mv.historyStates")).toBe("200");
    expect(engine.set_history_states).toHaveBeenCalledWith(200);
    store.setHistoryStates(9999); // Photoshop's ceiling is 1000
    expect(cells.get("mv.historyStates")).toBe("1000");
  });

  it("reopens on the saved value instead of the 50 default", () => {
    expect(newStore().store.state.historyStates).toBe(50);
    cells.set("mv.historyStates", "200");
    expect(newStore().store.state.historyStates).toBe(200);
  });

  it("ignores junk in user-editable storage", () => {
    for (const junk of ["", "abc", "0", "-5", "{}"]) {
      cells.set("mv.historyStates", junk);
      expect(newStore().store.state.historyStates).toBe(50);
    }
  });
});

describe("grid preferences", () => {
  it("persists spacing and colour set through setOptions", () => {
    const { store } = newStore();
    store.setOptions({ gridSpacing: 64 });
    store.setOptions({ gridColor: "#ff0000" });
    expect(JSON.parse(cells.get("mv.gridPrefs") ?? "null")).toEqual({ spacing: 64, color: "#ff0000" });
  });

  it("leaves storage alone for unrelated option patches", () => {
    const { store } = newStore();
    store.setOptions({ showGrid: true });
    expect(cells.has("mv.gridPrefs")).toBe(false);
  });

  it("reopens on the saved grid", () => {
    const fresh = newStore().store.state;
    expect([fresh.gridSpacing, fresh.gridColor]).toEqual([32, "#8080a0"]);
    cells.set("mv.gridPrefs", JSON.stringify({ spacing: 64, color: "#ff0000" }));
    const restored = newStore().store.state;
    expect([restored.gridSpacing, restored.gridColor]).toEqual([64, "#ff0000"]);
  });

  it("rejects an out-of-range spacing and a non-hex colour", () => {
    cells.set("mv.gridPrefs", JSON.stringify({ spacing: 99999, color: "javascript:alert(1)" }));
    const s = newStore().store.state;
    expect(s.gridSpacing).toBe(512); // clamped to the dialog's max
    expect(s.gridColor).toBe("#8080a0"); // default kept
    cells.set("mv.gridPrefs", "not json");
    expect(newStore().store.state.gridSpacing).toBe(32);
  });
});
