// Fuzz + invariants for fractional indexing — keyBetween must ALWAYS produce a
// key strictly between its neighbours, under thousands of random insertions.
import { describe, expect, it } from "vitest";
import { keyBetween, initialKeys } from "./fracdex";

describe("fracdex.keyBetween", () => {
  it("orders the basic cases", () => {
    const a = keyBetween(null, null);
    const before = keyBetween(null, a);
    const after = keyBetween(a, null);
    const mid = keyBetween(before, a);
    expect(before < a).toBe(true);
    expect(a < after).toBe(true);
    expect(before < mid && mid < a).toBe(true);
  });

  it("initialKeys are strictly increasing", () => {
    const ks = initialKeys(50);
    for (let i = 1; i < ks.length; i++) expect(ks[i - 1] < ks[i]).toBe(true);
  });

  it("fuzz: 4000 random insertions keep the list strictly ordered", () => {
    // Deterministic LCG so the test is reproducible.
    let seed = 0x9e3779b9;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);

    let keys = [keyBetween(null, null)];
    for (let step = 0; step < 4000; step++) {
      const i = Math.floor(rnd() * (keys.length + 1)); // insert slot 0..len
      const a = i === 0 ? null : keys[i - 1];
      const b = i === keys.length ? null : keys[i];
      const k = keyBetween(a, b);
      // Invariant: strictly between neighbours and never equal to one.
      if (a !== null) expect(a < k).toBe(true);
      if (b !== null) expect(k < b).toBe(true);
      keys.splice(i, 0, k);
    }
    // Whole list still strictly increasing, no collisions.
    for (let i = 1; i < keys.length; i++) expect(keys[i - 1] < keys[i]).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
