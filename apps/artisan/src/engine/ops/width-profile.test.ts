// ─────────────────────────────────────────────────────────────
// ops/width-profile.test — Stroke Width Profile presets (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: the Stroke panel's Width Profile dropdown applies a variable-width
// profile (Uniform + 6 built-ins). A preset is a half-width multiplier curve,
// resampled to the path's anchor count and stored as Stroke.widthProfile, which
// the renderer draws as a tapering ribbon. Uniform clears the profile.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makeRect, makeGroup, makeAnchor as anchor, solid, rgba, defaultStroke, Path, Ops, Query } from "../index";
import type { PathItem } from "../index";

const A = (x: number, y: number) => anchor({ x, y });
const stroked = { ...defaultStroke(solid(rgba(0, 0, 0, 1))), width: 10 };
const wpOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as PathItem).stroke.widthProfile;
const line = (n: number) => makePath({ closed: false, anchors: Array.from({ length: n }, (_, i) => A(i * 20, 0)) }, { stroke: { ...stroked } });

describe("ops.widthProfile.resampleProfile", () => {
  it("linearly resamples a curve to N anchors", () => {
    expect(Ops.WidthProfile.resampleProfile([0, 1, 0], 5)).toEqual([0, 0.5, 1, 0.5, 0]); // symmetric bulge
    expect(Ops.WidthProfile.resampleProfile([1, 0], 5)).toEqual([1, 0.75, 0.5, 0.25, 0]); // linear taper
    expect(Ops.WidthProfile.resampleProfile([0, 1], 3)).toEqual([0, 0.5, 1]);
    expect(Ops.WidthProfile.resampleProfile([1, 0.2, 1], 3)).toEqual([1, 0.2, 1]); // exact at the sample positions
  });

  it("handles degenerate counts", () => {
    expect(Ops.WidthProfile.resampleProfile([0, 1, 0], 1)).toEqual([0]); // n ≤ 1 → first sample
    expect(Ops.WidthProfile.resampleProfile([0.5], 3)).toEqual([0.5, 0.5, 0.5]); // single-sample curve
  });
});

describe("ops.widthProfile.applyWidthProfile", () => {
  it("sets a per-anchor widthProfile resampled to the path's anchor count", () => {
    const doc = makeDocument();
    const p = line(3);
    Ops.Items.addItem(doc, p);
    expect(Ops.WidthProfile.applyWidthProfile(doc, [p.id], "profile-1")).toEqual([p.id]);
    expect(wpOf(doc, p.id)).toEqual([0, 1, 0]); // profile-1 on 3 anchors

    const q = line(5);
    Ops.Items.addItem(doc, q);
    Ops.WidthProfile.applyWidthProfile(doc, [q.id], "profile-2"); // taper-out [1,0]
    expect(wpOf(doc, q.id)).toEqual([1, 0.75, 0.5, 0.25, 0]);
  });

  it("uniform clears the profile back to an even-width stroke", () => {
    const doc = makeDocument();
    const p = line(4);
    Ops.Items.addItem(doc, p);
    Ops.WidthProfile.applyWidthProfile(doc, [p.id], "profile-1");
    expect(wpOf(doc, p.id)).toBeDefined();
    Ops.WidthProfile.applyWidthProfile(doc, [p.id], "uniform");
    expect(wpOf(doc, p.id)).toBeUndefined();
  });

  it("converts a live shape to a path first so the variable width can render", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 50, 0, 0, { stroke: { ...stroked } });
    Ops.Items.addItem(doc, r);
    Ops.WidthProfile.applyWidthProfile(doc, [r.id], "profile-1");
    const it = Query.getItem(doc, r.id)!;
    expect(it.type).toBe("path"); // converted from a rect
    const wp = (it as PathItem).stroke.widthProfile!;
    expect(wp.length).toBe((it as PathItem).geometry.anchors.length); // one multiplier per anchor
    expect(wp.some((w) => w !== 1)).toBe(true); // genuinely variable → the renderer draws a ribbon
  });

  it("applies one flat profile across a compound's subpaths", () => {
    const doc = makeDocument();
    const compound = makeCompound([line(2).geometry, line(3).geometry], { stroke: { ...stroked } });
    Ops.Items.addItem(doc, compound);

    expect(Ops.WidthProfile.applyWidthProfile(doc, [compound.id], "profile-2")).toEqual([compound.id]);
    expect(Query.getItem(doc, compound.id)?.stroke.widthProfile).toEqual([1, 0.75, 0.5, 0.25, 0]);
  });

  it("skips groups and other non-path items", () => {
    const doc = makeDocument();
    const g = makeGroup([makeRect(0, 0, 10, 10, 0, 0)]);
    Ops.Items.addItem(doc, g);
    expect(Ops.WidthProfile.applyWidthProfile(doc, [g.id], "profile-1")).toEqual([]); // nothing modified
  });

  it("samples a 2-anchor line onto its endpoints only (Adobe-equivalent)", () => {
    // A centre-bulge profile collapses to [0,0] on a single segment (needs ≥3
    // anchors to show a bulge); a taper stays visible. Documented behaviour.
    expect(Ops.WidthProfile.resampleProfile([0, 1, 0], 2)).toEqual([0, 0]);
    const doc = makeDocument();
    const p = line(2);
    Ops.Items.addItem(doc, p);
    Ops.WidthProfile.applyWidthProfile(doc, [p.id], "profile-2"); // taper-out [1,0]
    expect(wpOf(doc, p.id)).toEqual([1, 0]); // still visible
  });

  it("produces a renderable ribbon outline for a converted rect (what the renderer draws)", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 50, 0, 0, { stroke: { ...stroked } });
    Ops.Items.addItem(doc, r);
    Ops.WidthProfile.applyWidthProfile(doc, [r.id], "profile-1");
    const it = Query.getItem(doc, r.id) as PathItem;
    const rings = Path.widthOutline(it.geometry, it.stroke.widthProfile!, it.stroke.width);
    expect(rings.length).toBeGreaterThanOrEqual(1); // the variable-width ribbon geometry exists
  });
});
