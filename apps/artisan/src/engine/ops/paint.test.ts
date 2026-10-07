// ─────────────────────────────────────────────────────────────
// ops/paint.test — Eyedropper "copy appearance" (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Eyedropper — by default it samples and applies
// ALL appearance attributes: fill colour, stroke (weight + attributes), AND
// transparency (opacity/blend mode). applyAppearance is the engine op behind it.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query, solid, rgba, defaultStroke } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);

/** A distinctive "source" appearance to sample. */
const sourceAppearance = () => ({
  fill: solid(RED),
  stroke: { ...defaultStroke(solid(rgba(10, 20, 30))), width: 8, cap: "round" as const, dash: [4, 2] },
  opacity: 0.4,
  blendMode: "multiply" as const,
});

describe("ops.paint — applyAppearance (eyedropper)", () => {
  it("copies fill, full stroke, opacity AND blend mode onto the target", () => {
    const doc = makeDocument();
    const target = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(BLUE), stroke: defaultStroke(solid(rgba(0, 0, 0))), opacity: 1 });
    Ops.Items.addItem(doc, target);

    Ops.Paint.applyAppearance(doc, [target.id], sourceAppearance());

    const t = Query.getItem(doc, target.id)!;
    expect(t.fill).toEqual(solid(RED));
    expect(t.stroke.width).toBe(8);
    expect(t.stroke.cap).toBe("round");
    expect(t.stroke.dash).toEqual([4, 2]);
    expect(t.opacity).toBe(0.4); // transparency copied — the parity fix
    expect(t.blendMode).toBe("multiply");
  });

  it("deep-copies so later edits to the target don't mutate the source value", () => {
    const doc = makeDocument();
    const target = makeRect(0, 0, 10, 10);
    Ops.Items.addItem(doc, target);
    const appearance = sourceAppearance();
    Ops.Paint.applyAppearance(doc, [target.id], appearance);
    const t = Query.getItem(doc, target.id)!;
    if (t.fill.type === "solid") t.fill.color.r = 1;
    expect(appearance.fill.type === "solid" && appearance.fill.color.r).toBe(220); // untouched
  });

  it("recurses into a group, applying the look to every leaf child", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10, 0, 0, { opacity: 1 });
    const b = makeRect(20, 0, 10, 10, 0, 0, { opacity: 1 });
    const g = makeGroup([a, b]);
    Ops.Items.addItem(doc, g);

    Ops.Paint.applyAppearance(doc, [g.id], sourceAppearance());

    for (const id of [a.id, b.id]) {
      const it = Query.getItem(doc, id)!;
      expect(it.fill).toEqual(solid(RED));
      expect(it.stroke.width).toBe(8);
      expect(it.opacity).toBe(0.4);
    }
  });

  it("leaves opacity/blendMode untouched when the sample omits them", () => {
    const doc = makeDocument();
    const target = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(BLUE), opacity: 0.7 });
    target.blendMode = "screen";
    Ops.Items.addItem(doc, target);

    // Only colour sampled (e.g. a custom Eyedropper setup) — transparency preserved.
    Ops.Paint.applyAppearance(doc, [target.id], { fill: solid(RED), stroke: defaultStroke(solid(rgba(0, 0, 0))) });

    const t = Query.getItem(doc, target.id)!;
    expect(t.fill).toEqual(solid(RED));
    expect(t.opacity).toBe(0.7);
    expect(t.blendMode).toBe("screen");
  });

  it("recolours envelope source artwork so the fill survives regeneration", () => {
    const doc = makeDocument();
    const source = makeRect(0, 0, 100, 80, 0, 0, { fill: solid(BLUE) });
    Ops.Items.addItem(doc, source);
    const id = Ops.Envelope.makeWithWarp(doc, [source.id], { style: "arc", bend: 0.2 })!;

    Ops.Paint.applyFill(doc, [id], solid(RED));
    Ops.Envelope.updateWarp(doc, [id], { style: "arc", bend: 0.6 });

    const group = Query.getItem(doc, id)!;
    expect(group.type === "group" && group.children.every((child) => child.fill.type === "solid" && child.fill.color.r === RED.r)).toBe(true);
  });

  it("recolours mesh source points so the fill survives regeneration", () => {
    const doc = makeDocument();
    const source = makeRect(0, 0, 100, 80, 0, 0, { fill: solid(BLUE) });
    Ops.Items.addItem(doc, source);
    const id = Ops.Meshes.createMeshFromItem(doc, source.id)!;

    Ops.Paint.applyFill(doc, [id], solid(RED));
    Ops.Meshes.regenerateMesh(doc, id);

    const group = Query.getItem(doc, id)!;
    expect(group.type === "group" && group.mesh?.points.every((point) => point.color.r === RED.r && point.color.g === RED.g && point.color.b === RED.b)).toBe(true);
    expect(group.type === "group" && group.children.every((child) => child.fill.type === "solid" && child.fill.color.r === RED.r)).toBe(true);
  });
});
