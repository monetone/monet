// ─────────────────────────────────────────────────────────────
// magic-wand.test — Magic Wand fill-colour tolerance (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Magic Wand — clicking selects every object whose
// fill colour is within a Tolerance (default 32, RGB 0–255) of the clicked one.
// Per-channel match; non-solid fills match by type; hidden/locked objects skip.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query, solid, rgba, linearGradient } from "./index";

const mkFill = (c: ReturnType<typeof rgba>) => makeRect(0, 0, 10, 10, 0, 0, { fill: solid(c) });
const wand = (doc: ReturnType<typeof makeDocument>, c: ReturnType<typeof rgba>, tol?: number) =>
  new Set(Query.magicWandSelect(doc, solid(c), tol));

describe("Query.magicWandSelect", () => {
  it("selects exact + within-tolerance fills, excludes those outside (default 32)", () => {
    const doc = makeDocument();
    const a = mkFill(rgba(220, 90, 90)); // exact
    const b = mkFill(rgba(200, 80, 100)); // Δ(20,10,10) within
    const c = mkFill(rgba(188, 90, 90)); // Δ32 — boundary, ≤ tol → match
    const d = mkFill(rgba(187, 90, 90)); // Δ33 — just over → no match
    const e = mkFill(rgba(80, 120, 220)); // far
    Ops.Items.addItems(doc, [a, b, c, d, e]);
    expect(wand(doc, rgba(220, 90, 90))).toEqual(new Set([a.id, b.id, c.id]));
  });

  it("tolerance 0 → exact match only", () => {
    const doc = makeDocument();
    const a = mkFill(rgba(220, 90, 90));
    const b = mkFill(rgba(219, 90, 90)); // Δ1 — excluded at tol 0
    Ops.Items.addItems(doc, [a, b]);
    expect(Query.magicWandSelect(doc, solid(rgba(220, 90, 90)), 0)).toEqual([a.id]);
  });

  it("does not match a solid fill against a non-solid (gradient) fill", () => {
    const doc = makeDocument();
    const a = mkFill(rgba(220, 90, 90));
    const grad = makeRect(0, 0, 10, 10, 0, 0, { fill: linearGradient() });
    Ops.Items.addItems(doc, [a, grad]);
    expect(Query.magicWandSelect(doc, solid(rgba(220, 90, 90)))).toEqual([a.id]);
  });

  it("matches leaves nested in groups; skips the group container itself", () => {
    const doc = makeDocument();
    const a = mkFill(rgba(220, 90, 90));
    const nested = mkFill(rgba(220, 90, 90));
    const grp = makeGroup([nested]);
    Ops.Items.addItems(doc, [a, grp]);
    expect(wand(doc, rgba(220, 90, 90))).toEqual(new Set([a.id, nested.id]));
  });

  it("skips hidden and locked objects", () => {
    const doc = makeDocument();
    const a = mkFill(rgba(220, 90, 90));
    const hidden = mkFill(rgba(220, 90, 90));
    hidden.visible = false;
    const locked = mkFill(rgba(220, 90, 90));
    locked.locked = true;
    Ops.Items.addItems(doc, [a, hidden, locked]);
    expect(Query.magicWandSelect(doc, solid(rgba(220, 90, 90)))).toEqual([a.id]);
  });
});
