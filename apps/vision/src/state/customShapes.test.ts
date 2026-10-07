// Unit tests for Define Custom Shape's pure geometry + menu wiring. The geometry
// is engine-free so it runs in node; the Shape-tool draw is covered by
// e2e/custom-shape.spec.ts.
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { normalizePath, denormalizePath, isValidPath, MIN_SHAPE_POINTS, defaultCustomShapeName, removeCustomShapeAt, parseCustomShapes, BUILTIN_CUSTOM_SHAPES, withBuiltinCustomShapes, type CustomShape } from "./customShapes";
import { Store } from "./store";
import { buildPhotoshopMenus } from "../ui/psMenus";
import { PS_MENUS, type PsNode } from "../ui/psMenuData";

const collectMonetIds = (nodes: PsNode[]): string[] =>
  nodes.flatMap((n) =>
    n.kind === "submenu" ? collectMonetIds(n.items) : n.kind === "item" && n.monetId ? [n.monetId] : [],
  );
const flatten = (items: any[]): any[] => items.flatMap((it) => [it, ...(it.items ? flatten(it.items) : [])]);
const allLeaves = (bar: any[]) => bar.flatMap((m) => flatten(m.items));

describe("custom-shape geometry", () => {
  it("normalizePath maps a path to its 0..1 bounding box", () => {
    // triangle: (0,0) (10,0) (10,20) → w=10 h=20
    expect(normalizePath([0, 0, 10, 0, 10, 20])).toEqual([0, 0, 1, 0, 1, 1]);
  });

  it("normalizePath offsets non-origin paths and guards zero extent", () => {
    expect(normalizePath([5, 5, 15, 5, 10, 25])).toEqual([0, 0, 1, 0, 0.5, 1]);
    // degenerate (all identical) → all zeros, no NaN
    expect(normalizePath([7, 7, 7, 7, 7, 7])).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("denormalizePath maps a normalized path into a drag rect", () => {
    const { xs, ys } = denormalizePath([0, 0, 1, 0, 1, 1], 100, 50, 10, 20);
    expect(Array.from(xs)).toEqual([100, 110, 110]);
    expect(Array.from(ys)).toEqual([50, 50, 70]);
  });

  it("normalize→denormalize round-trips into the same rect", () => {
    const norm = normalizePath([2, 4, 22, 4, 12, 24]);
    const { xs, ys } = denormalizePath(norm, 0, 0, 20, 20);
    expect(Array.from(xs)).toEqual([0, 20, 10]);
    expect(Array.from(ys)).toEqual([0, 0, 20]);
  });

  it("isValidPath requires at least a triangle", () => {
    expect(MIN_SHAPE_POINTS).toBe(3);
    expect(isValidPath([0, 0, 1, 1])).toBe(false); // 2 points
    expect(isValidPath([0, 0, 1, 0, 1, 1])).toBe(true); // 3 points
  });
});

describe("custom-shape library helpers", () => {
  const tri = [0, 0, 1, 0, 1, 1];
  const mk = (name: string): CustomShape => ({ name, path: tri });

  it("defaultCustomShapeName counts one past the highest 'Custom Shape N'", () => {
    expect(defaultCustomShapeName([])).toBe("Custom Shape 1");
    expect(defaultCustomShapeName(["Custom Shape 1", "Custom Shape 3", "Star"])).toBe("Custom Shape 4");
    expect(defaultCustomShapeName(["Custom Shape", "my Custom Shape 2"])).toBe("Custom Shape 1"); // non-matching ignored
  });

  it("removeCustomShapeAt removes by index; out-of-range is a same-ref no-op", () => {
    const list = [mk("A"), mk("B")];
    expect(removeCustomShapeAt(list, 0).map((s) => s.name)).toEqual(["B"]);
    expect(removeCustomShapeAt(list, 5)).toBe(list);
    expect(removeCustomShapeAt(list, -1)).toBe(list);
  });

  it("parseCustomShapes round-trips a serialized library", () => {
    const list = [mk("A"), mk("B")];
    expect(parseCustomShapes(JSON.stringify(list))).toEqual(list);
  });

  it("parseCustomShapes returns null for missing, empty, non-array or malformed payloads", () => {
    expect(parseCustomShapes(null)).toBeNull();
    expect(parseCustomShapes("")).toBeNull();
    expect(parseCustomShapes("[]")).toBeNull();                              // empty
    expect(parseCustomShapes("not json")).toBeNull();                        // parse error
    expect(parseCustomShapes('{"name":"x"}')).toBeNull();                    // not an array
    expect(parseCustomShapes('[{"name":"x"}]')).toBeNull();                  // missing path
    expect(parseCustomShapes('[{"name":"x","path":[0,0,1,1]}]')).toBeNull(); // 2 points (< triangle)
    expect(parseCustomShapes('[{"name":"x","path":[0,0,1,0,"a","b"]}]')).toBeNull(); // non-numeric
    expect(parseCustomShapes('[{"path":[0,0,1,0,1,1]}]')).toBeNull();        // missing name
  });
});

// ── The built-in library (#458) ───────────────────────────────────────────────
// Photoshop's picker is stocked on a fresh install; Vision's booted empty, so a
// new profile that picked "Custom" had nothing to draw.

/** A localStorage stub — the Store persists every library change through one. */
const installStorage = () => {
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
};
const freshStore = () => {
  const e = { set_brush_tip_active: vi.fn() };
  return new Store({ onCommit: null, onEditError: vi.fn(), engine: e, e, sync: vi.fn() } as never);
};
const extent = (path: number[], axis: 0 | 1) => {
  const vs = path.filter((_, i) => i % 2 === axis);
  return [Math.min(...vs), Math.max(...vs)];
};

describe("built-in custom shapes", () => {
  it("ships arrows, banners and ornaments with unique names", () => {
    const names = BUILTIN_CUSTOM_SHAPES.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Arrow", "Double Arrow", "Banner", "Talk Bubble", "Ornament"]));
    expect(new Set(names).size).toBe(names.length);
  });

  it("stores every built-in exactly as defineCustomShape would: normalized to the unit box", () => {
    for (const s of BUILTIN_CUSTOM_SHAPES) {
      expect(isValidPath(s.path), `${s.name} needs a triangle`).toBe(true);
      expect(s.path.every(Number.isFinite), `${s.name} has a non-finite coord`).toBe(true);
      expect(extent(s.path, 0), `${s.name} x`).toEqual([0, 1]);
      expect(extent(s.path, 1), `${s.name} y`).toEqual([0, 1]);
      // Re-normalizing an already-normalized path is the identity, so the picker
      // draws the same geometry a user-defined shape would.
      expect(normalizePath(s.path).map((v) => Math.round(v * 1000) / 1000)).toEqual(s.path);
    }
  });

  it("survives the persistence round-trip its own validator gates", () => {
    expect(parseCustomShapes(JSON.stringify(BUILTIN_CUSTOM_SHAPES))).toEqual([...BUILTIN_CUSTOM_SHAPES]);
  });

  it("withBuiltinCustomShapes puts back only what is missing, keeping user shapes", () => {
    const mine: CustomShape = { name: "Mine", path: [0, 0, 1, 0, 1, 1] };
    const restored = withBuiltinCustomShapes([mine, BUILTIN_CUSTOM_SHAPES[1]]);
    expect(restored[0]).toBe(mine);                                            // user shapes stay, in place
    expect(restored.filter((s) => s.name === "Double Arrow")).toHaveLength(1); // no renamed duplicate
    expect(restored).toHaveLength(BUILTIN_CUSTOM_SHAPES.length + 1);
    const complete = [...BUILTIN_CUSTOM_SHAPES];
    expect(withBuiltinCustomShapes(complete)).toBe(complete);                  // same ref → no needless persist
  });
});

describe("the Store's stocked library", () => {
  it("boots stocked on a fresh profile, and a saved library replaces it", () => {
    installStorage();
    const store = freshStore();
    expect(store.state.customShapes.map((s) => s.name)).toEqual(BUILTIN_CUSTOM_SHAPES.map((s) => s.name));
    expect(store.state.activeCustomShape).toBe(0);

    localStorage.setItem("mv.customShapes", JSON.stringify([{ name: "Saved", path: [0, 0, 1, 0, 1, 1] }]));
    store.loadCustomShapes();
    expect(store.state.customShapes.map((s) => s.name)).toEqual(["Saved"]);
  });

  it("keeps a deleted built-in deleted, and Restore Defaults brings it back persisted", () => {
    const cells = installStorage();
    const store = freshStore();
    const gone = BUILTIN_CUSTOM_SHAPES[0].name;
    store.removeCustomShape(0);
    expect(store.state.customShapes.some((s) => s.name === gone)).toBe(false);
    expect(JSON.parse(cells.get("mv.customShapes")!)).toHaveLength(BUILTIN_CUSTOM_SHAPES.length - 1);

    store.loadCustomShapes(); // a reload must not silently re-stock what the user deleted
    expect(store.state.customShapes.some((s) => s.name === gone)).toBe(false);

    expect(store.restoreDefaultCustomShapes()).toBe(1);
    expect(store.state.customShapes.map((s) => s.name).sort()).toEqual(BUILTIN_CUSTOM_SHAPES.map((s) => s.name).sort());
    expect(JSON.parse(cells.get("mv.customShapes")!)).toHaveLength(BUILTIN_CUSTOM_SHAPES.length);
    expect(store.restoreDefaultCustomShapes()).toBe(0); // already complete
  });
});

describe("Preset Manager ▸ Custom Shapes", () => {
  // Dialogs.tsx pulls the WASM engine, so its wiring is asserted from source
  // (the house idiom — see patternPresetManager.test.ts).
  const dialogs = readFileSync(new URL("../ui/Dialogs.tsx", import.meta.url), "utf8");

  it("offers Restore Defaults on the shapes category", () => {
    expect(dialogs).toContain('cat === "shapes" && (');
    expect(dialogs).toContain('data-mv-preset-restore title="');
    expect(dialogs).toContain("store.restoreDefaultCustomShapes()");
  });
});

describe("Define Custom Shape menu wiring", () => {
  it("wires the existing Edit ▸ Define Custom Shape… item (no duplicate)", () => {
    expect(collectMonetIds(PS_MENUS.flatMap((m) => m.tree))).toContain("definecustomshape");
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ definecustomshape: fn });
    const leaves = allLeaves(bar).filter((it: any) => it.label === "Define Custom Shape…" && !it.separator && !it.items);
    expect(leaves).toHaveLength(1); // no duplicate placeholder
    expect(leaves[0].disabled).toBeFalsy();
    leaves[0].action();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
