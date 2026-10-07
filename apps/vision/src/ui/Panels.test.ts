import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BLEND_ORDER } from "../state/engineContracts";

// Panels.tsx pulls the WASM engine through state/app, so it can't be imported in
// the Node unit run — the wiring is asserted from source, the same discipline as
// panelInventory.test.ts / typePanels.test.ts.
const source = readFileSync(new URL("./Panels.tsx", import.meta.url), "utf8");

// The panels that cache an engine read behind a `rev` key. Undo bookkeeping is
// not a composite generation: a layer-visibility toggle and every tick after the
// first of a coalesced opacity drag push no undo state (#102), and at the History
// States cap `undo_depth()` is pinned by eviction so a run of same-label edits
// ("Brush", "Brush", …) leaves the whole key byte-identical (#171). Both freeze
// the Histogram / scopes / Channels / Navigator on a stale composite.
describe("panel cache keys", () => {
  it("derives the composite generation from the per-sync `doc` identity", () => {
    expect(source).toContain("const compositeGens = new WeakMap<object, number>();");
    expect(source).toMatch(/function useCompositeGen\(\): number \{\s*return useStore\(\(s\) => \{\s*let gen = compositeGens\.get\(s\.doc\);/);
  });

  it("mixes it into every rev key, so none of them can rest on undoDepth alone", () => {
    const revs = [...source.matchAll(/^ {2}const rev = .*$/gm)].map((m) => m[0]);
    // Vectorscope, Waveform, Histogram, Channels, Navigator.
    expect(revs).toHaveLength(5);
    for (const rev of revs) {
      expect(rev, "a rev key that ignores the composite generation goes stale").toContain("useCompositeGen()");
    }
  });
});

// #104 — `applied` is a bare index into layerComps, so deleting a comp at or
// below it slid the ◆ marker (and the ◀/▶ base) onto a different comp.
describe("Layer Comps keeps the applied index in step with the list (#104)", () => {
  it("remaps `applied` at the delete call site", () => {
    expect(source).toContain("setApplied((a) => (i === a ? -1 : i < a ? a - 1 : a));");
    expect(source, "the row button must go through the remapping helper").toContain("e.stopPropagation(); removeComp(i);");
    expect(source).not.toContain("e.stopPropagation(); store.deleteLayerComp(i);");
  });

  it("models the remap: earlier deletes shift, the applied one clears", () => {
    const remap = (i: number, a: number) => (i === a ? -1 : i < a ? a - 1 : a);
    expect(remap(0, 2)).toBe(1); // the marked comp slid down one slot
    expect(remap(2, 2)).toBe(-1); // it was deleted — nothing is applied
    expect(remap(3, 2)).toBe(2); // a later delete leaves it alone
  });
});

// #105 — FILL_BLEND_OPTIONS used BLEND_ORDER.slice(0, 25) to drop the group-only
// Pass Through, which also cut Darker Color / Lighter Color: two real per-layer
// modes the engine supports and Photoshop's Fill dialog offers.
describe("Fill Path offers every per-layer blend mode (#105)", () => {
  it("builds the roster by exclusion, not by index", () => {
    expect(source).toContain('const FILL_BLEND_OPTIONS = BLEND_ORDER.filter((k) => k !== "pass-through")');
    expect(source).not.toContain("BLEND_ORDER.slice(0, 25)");
  });

  it("that roster keeps darker-color and lighter-color and drops pass-through", () => {
    const modes = BLEND_ORDER.filter((k) => k !== "pass-through");
    expect(modes).toHaveLength(BLEND_ORDER.length - 1);
    expect(modes).toContain("darker-color");
    expect(modes).toContain("lighter-color");
    expect(modes).not.toContain("pass-through");
    expect(BLEND_ORDER.slice(0, 25), "the old slice cut two selectable modes").not.toContain("darker-color");
  });
});
