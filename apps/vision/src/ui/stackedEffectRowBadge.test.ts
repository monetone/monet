// The Layers panel lists the effect types a layer carries. Effects are a
// multiset, and the row read the whole-type getter — instance 0 only — so a
// layer whose FIRST drop shadow was switched off while a second one was still
// painting showed no "Drop Shadow" badge for an effect plainly visible on the
// canvas. Panels.tsx pulls the WASM engine through state/app, so the wiring is
// asserted from source (the house idiom — see stackedEffectOpsWiring.test).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panels = readFileSync(new URL("./Panels.tsx", import.meta.url), "utf8");

/** The `renderRow` effect-badge expression. */
const badge = (() => {
  const from = panels.indexOf("const effects = raw.hasFx");
  expect(from, "missing the effect-badge block").toBeGreaterThan(0);
  return panels.slice(from, panels.indexOf(".map((effect) => effect.name)", from));
})();

describe("the Layers panel effect badge reads every instance", () => {
  it("enumerates the instances of each effect type", () => {
    expect(badge).toContain("store.effectInstanceCount(raw.id, effect.id)");
    expect(badge).toContain("store.effectParamsAt(raw.id, effect.id, i)");
  });

  it("does not use the whole-type getter, which sees instance 0 only", () => {
    expect(badge, "store.effectParams collapses the stack").not.toContain("store.effectParams(");
  });
});
