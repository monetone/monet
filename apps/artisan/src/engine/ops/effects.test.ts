// ─────────────────────────────────────────────────────────────
// ops/effects.test — live effects op (Illustrator Effect ▸ Stylize)
// ─────────────────────────────────────────────────────────────
// addEffect keeps one effect per type (re-applying replaces it) while DIFFERENT
// types stack — so a shape can carry both Outer Glow and Inner Glow at once,
// matching Illustrator. defaultEffect supplies each type's panel defaults.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query, EFFECT_TYPES } from "../index";

const setup = () => {
  const doc = makeDocument();
  const r = makeRect(0, 0, 40, 40);
  Ops.Items.addItem(doc, r);
  return { doc, r };
};
const types = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id)!.effects ?? []).map((e) => e.type);

describe("ops/effects — defaultEffect", () => {
  it("inner-glow defaults to a soft white halo (blur 8, white α 0.75)", () => {
    expect(Ops.Effects.defaultEffect("inner-glow")).toEqual({ type: "inner-glow", blur: 8, color: { r: 255, g: 255, b: 255, a: 0.75 } });
  });

  it("outer glow stays a warm halo (regression — distinct from inner glow)", () => {
    expect(Ops.Effects.defaultEffect("glow")).toEqual({ type: "glow", blur: 8, color: { r: 255, g: 240, b: 120, a: 0.9 } });
  });

  it("EFFECT_TYPES registers inner-glow alongside the existing effects", () => {
    expect(EFFECT_TYPES).toEqual(["drop-shadow", "blur", "feather", "glow", "inner-glow"]);
  });
});

describe("ops/effects — addEffect (inner glow)", () => {
  it("adds an inner glow to the item", () => {
    const { doc, r } = setup();
    Ops.Effects.addEffect(doc, [r.id], Ops.Effects.defaultEffect("inner-glow"));
    expect(types(doc, r.id)).toEqual(["inner-glow"]);
  });

  it("inner glow and outer glow stack as two separate effects", () => {
    const { doc, r } = setup();
    Ops.Effects.addEffect(doc, [r.id], Ops.Effects.defaultEffect("glow"));
    Ops.Effects.addEffect(doc, [r.id], Ops.Effects.defaultEffect("inner-glow"));
    expect(types(doc, r.id).slice().sort()).toEqual(["glow", "inner-glow"]);
  });

  it("re-applying inner glow replaces it (no duplicate)", () => {
    const { doc, r } = setup();
    Ops.Effects.addEffect(doc, [r.id], Ops.Effects.defaultEffect("inner-glow"));
    Ops.Effects.addEffect(doc, [r.id], { type: "inner-glow", blur: 3, color: { r: 0, g: 0, b: 0, a: 1 } });
    const fx = Query.getItem(doc, r.id)!.effects!;
    expect(fx).toHaveLength(1);
    expect(fx[0]).toEqual({ type: "inner-glow", blur: 3, color: { r: 0, g: 0, b: 0, a: 1 } });
  });
});
