import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store } from "./store";

// Paths panel ▸ Make Selection… — Photoshop's dialog carries a Feather Radius, an
// Anti-aliased checkbox and a New/Add/Subtract/Intersect Operation group. The store
// call must forward all three to the engine (same harness idiom as ./bezierPath.test.ts).
const TRI = [0, 0, 10, 0, 10, 10];

function storeWith() {
  const calls: { fn: string; args: unknown[] }[] = [];
  const rec = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); };
  const eng = {
    select_polygon: rec("select_polygon"),
    set_selection_antialias: rec("set_selection_antialias"),
    feather_selection: rec("feather_selection"),
  };
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null };
  return { store: new Store(client as never), calls };
}

describe("makeSelectionFromPath", () => {
  it("defaults to New Selection, anti-aliased, no feather", () => {
    const { store, calls } = storeWith();
    store.makeSelectionFromPath(TRI);
    expect(calls.map((c) => c.fn)).toEqual(["set_selection_antialias", "select_polygon", "set_selection_antialias"]);
    expect(calls[0].args).toEqual([true]);
    expect(calls[1].args[2]).toBe(0);
  });

  it("forwards the Operation mode, feather radius and anti-alias choice", () => {
    const { store, calls } = storeWith();
    store.makeSelectionFromPath(TRI, 3, 12, false);
    expect(calls[0].args).toEqual([false]); // Anti-aliased off
    const poly = calls.find((c) => c.fn === "select_polygon")!;
    expect(Array.from(poly.args[0] as Float32Array)).toEqual([0, 10, 10]);
    expect(Array.from(poly.args[1] as Float32Array)).toEqual([0, 0, 10]);
    expect(poly.args[2]).toBe(3); // Intersect with Selection
    expect(calls.find((c) => c.fn === "feather_selection")!.args).toEqual([12]);
  });

  it("skips a feather the engine would ignore, and restores the options-bar anti-alias", () => {
    const { store, calls } = storeWith();
    store.makeSelectionFromPath(TRI, 1, 0.2, false);
    expect(calls.some((c) => c.fn === "feather_selection")).toBe(false);
    expect(calls.at(-1)).toEqual({ fn: "set_selection_antialias", args: [store.state.antiAlias] });
  });

  it("is a no-op for a degenerate path", () => {
    const { store, calls } = storeWith();
    store.makeSelectionFromPath([0, 0, 1, 1]); // < 3 points
    expect(calls).toEqual([]);
  });
});

describe("Paths panel Make Selection wiring", () => {
  const panels = readFileSync(fileURLToPath(new URL("../ui/Panels.tsx", import.meta.url)), "utf8");

  it("offers all four operations, and Option/Alt-click opens the dialog", () => {
    expect(panels).toContain('{ value: "3", label: "Intersect with Selection" }');
    expect(panels).toContain('aria-label="Feather Radius"');
    expect(panels).toContain('aria-label="Anti-aliased"');
    expect(panels).toContain("store.makeSelectionFromPath(store.state.penPath, o.mode, o.feather, o.antialias)");
    expect(panels).toContain("if (event.altKey) { setSelDraft(currentMakeSelection); setMakeSelOpen(true); } else makeSelection(currentMakeSelection);");
  });
});
