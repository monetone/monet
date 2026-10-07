// maskGraph.manage.test — GAL-MASK-09: mask management (duplicate, Duplicate
// and Invert, reorder). The panel's buttons are thin wiring over these two.

import { describe, expect, it } from "vitest";

import {
  createMask,
  duplicateMask,
  moveMask,
  type BrushComponent,
  type Mask,
} from "./maskGraph";

const brush = (id: string): BrushComponent => ({
  kind: "brush",
  id,
  combine: "add",
  invert: false,
  dabs: [{ x: 0.5, y: 0.5, radius: 0.1, flow: 1, density: 1, erase: false }],
  autoMask: false,
});

const mask = (id: string, name = id): Mask => createMask(id, name, brush(`${id}-c`));

let n = 0;
const ids = () => `new-${++n}`;

describe("duplicateMask (GAL-MASK-09)", () => {
  it("gives the copy and every component a fresh id", () => {
    const src = { ...mask("m1"), components: [brush("c1"), { ...brush("c2"), combine: "subtract" as const }] };
    const copy = duplicateMask(src, ids);
    const fresh = [copy.id, ...copy.components.map((c) => c.id)];
    expect(new Set(fresh).size).toBe(3); // mask + 2 components, all distinct
    expect(fresh.some((id) => id === src.id || id === "c1" || id === "c2")).toBe(false);
    // Everything else survives: kinds, combine modes, stroke data.
    expect(copy.components.map((c) => c.kind)).toEqual(["brush", "brush"]);
    expect(copy.components[1].combine).toBe("subtract");
    expect((copy.components[0] as BrushComponent).dabs).toHaveLength(1);
    expect(src.components.map((c) => c.id)).toEqual(["c1", "c2"]); // source untouched
  });

  it("names the plain copy and leaves inversion alone", () => {
    const src = mask("m1", "Brush 1");
    const copy = duplicateMask(src, ids);
    expect(copy.name).toBe("Brush 1 copy");
    expect(copy.inverted).toBe(false);
  });

  it("Duplicate and Invert flips the copy's inversion, not the source's", () => {
    const src = mask("m1", "Subject 1");
    const copy = duplicateMask(src, ids, true);
    expect(copy.name).toBe("Subject 1 inverted");
    expect(copy.inverted).toBe(true);
    expect(src.inverted).toBe(false);
    // Inverting an already-inverted mask gives back the un-inverted half.
    expect(duplicateMask(copy, ids, true).inverted).toBe(false);
  });
});

describe("moveMask (GAL-MASK-09)", () => {
  const list = [mask("a"), mask("b"), mask("c")];
  const order = (ms: Mask[]) => ms.map((m) => m.id).join("");

  it("moves by delta in either direction", () => {
    expect(order(moveMask(list, "c", -1))).toBe("acb");
    expect(order(moveMask(list, "a", 2))).toBe("bca");
  });

  it("clamps at the ends and no-ops on an unknown id", () => {
    expect(order(moveMask(list, "a", -1))).toBe("abc");
    expect(order(moveMask(list, "c", 5))).toBe("abc");
    expect(moveMask(list, "zzz", 1)).toBe(list);
    expect(order(list)).toBe("abc"); // never mutates the input
  });
});
