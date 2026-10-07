// Preset Manager ▸ Save Set… / Edit ▸ Presets ▸ Export Presets both serialise
// `store.presetsFor(cat)` with a plain JSON.stringify, so the wire shape has to
// survive that on its own. Patterns are the only category whose payload is
// binary (a Uint16Array tile), which is exactly where it broke (#3).
// Engine-free (node); the dialogs are e2e-covered.
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";
import { parsePatterns, type PatternPreset } from "./patternPresets";
import { buildPresetSet, presetSetItems } from "./presetManager";

// Minimal Storage stand-in — the unit suite runs in node, which has none.
function installStorage() {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
}

function newStore(): Store {
  const engine = {};
  return new Store({ onCommit: null, engine, e: engine, sync: () => {}, commit: () => {} } as never);
}

const TILE: PatternPreset = {
  name: "Weave",
  w: 2,
  h: 1,
  px: Uint16Array.from([65535, 0, 0, 65535, 0, 32768, 65535, 65535]),
};

beforeEach(() => { installStorage(); });

describe("presetsFor(\"patterns\")", () => {
  it("round-trips a real tile through Save Set… → Load… (#3)", () => {
    const store = newStore();
    store.importPatternPresets([TILE]);
    const file = buildPresetSet("patterns", store.presetsFor("patterns"));
    const back = parsePatterns(presetSetItems(file, "patterns"));
    expect(back).toHaveLength(1);
    expect(back?.[0]).toEqual(TILE);
  });

  it("hands the exporter a base64 tile, never an index-keyed typed array (#3)", () => {
    const store = newStore();
    store.importPatternPresets([TILE]);
    const [one] = store.presetsFor("patterns") as { px: unknown }[];
    expect(typeof one.px).toBe("string");
  });

  it("leaves the live library holding real Uint16Array tiles", () => {
    const store = newStore();
    store.importPatternPresets([TILE]);
    expect(store.state.patternPresets[0].px).toBeInstanceOf(Uint16Array);
  });
});
