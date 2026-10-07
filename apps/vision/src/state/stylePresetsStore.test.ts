// Styles panel ▸ Store wiring: `importStylePresets` — Styles ▸ Import's write
// path once mergeStylePresets has already computed the merged list (VIS-LS-16).
// Engine-free (node); mirrors storePreferences.test.ts's installStorage() +
// newStore() idiom. stylePresets.ts's pure helpers (addStylePresetTo,
// mergeStylePresets, parseStylePresets, …) are covered by stylePresets.test.ts.
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";
import { STYLE_PRESETS_KEY, type StylePreset } from "./stylePresets";

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

function newStore() {
  const engine = {};
  const client = { onCommit: null as null | (() => void), engine, sync: vi.fn(), buildNew: vi.fn(() => engine) };
  return new Store(client as never);
}

const mk = (name: string): StylePreset => ({
  name,
  style: { effects: [], blendIf: [0, 255, 0, 255], fillOpacity: 100 },
});

let cells: Map<string, string>;
beforeEach(() => { cells = installStorage(); });

describe("importStylePresets", () => {
  it("sets the library to the given (already-merged) list and persists it", () => {
    const store = newStore();
    const list = [mk("A"), mk("B")];
    store.importStylePresets(list);
    expect(store.state.stylePresets).toEqual(list);
    expect(JSON.parse(cells.get(STYLE_PRESETS_KEY)!)).toEqual(list);
  });

  it("replaces rather than merges — callers pre-merge via mergeStylePresets", () => {
    const store = newStore();
    store.importStylePresets([mk("Old")]);
    store.importStylePresets([mk("New")]);
    expect(store.state.stylePresets.map((p) => p.name)).toEqual(["New"]);
  });
});
