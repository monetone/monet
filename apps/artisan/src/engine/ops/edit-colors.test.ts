// ─────────────────────────────────────────────────────────────
// ops/edit-colors.test — Edit ▸ Edit Colors (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Edit ▸ Edit Colors — Invert Colors and Convert to
// Grayscale recolour the selection in place, touching every fill/stroke colour
// (solid + gradient stops) and recursing into groups.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query, solid, noPaint, defaultStroke, linearGradient, rgba } from "../index";

const fillColor =(doc: ReturnType<typeof makeDocument>, id: string) => {
  const f = Query.getItem(doc, id)!.fill;
  return f.type === "solid" ? f.color : null;
};

describe("ops.edit-colors.editColors — invert", () => {
  it("inverts a fill colour, preserving alpha", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(100, 150, 200, 0.5)) });
    Ops.Items.addItem(doc, r);
    const ids = Ops.EditColors.editColors(doc, [r.id], "invert");
    expect(ids).toEqual([r.id]);
    expect(fillColor(doc, r.id)).toEqual({ r: 155, g: 105, b: 55, a: 0.5 });
  });

  it("inverts the stroke colour too", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: noPaint(), stroke: defaultStroke(solid(rgba(0, 0, 0))) });
    Ops.Items.addItem(doc, r);
    Ops.EditColors.editColors(doc, [r.id], "invert");
    const st = Query.getItem(doc, r.id)!.stroke.paint;
    expect(st.type === "solid" ? st.color : null).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it("inverts every gradient stop", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: linearGradient() }); // white→black
    Ops.Items.addItem(doc, r);
    Ops.EditColors.editColors(doc, [r.id], "invert");
    const f = Query.getItem(doc, r.id)!.fill;
    if (f.type !== "gradient") throw new Error("expected gradient");
    expect(f.gradient.stops[0].color).toEqual({ r: 0, g: 0, b: 0, a: 1 }); // white → black
    expect(f.gradient.stops[1].color).toEqual({ r: 255, g: 255, b: 255, a: 1 }); // black → white
  });

  it("recurses into group children", () => {
    const doc = makeDocument();
    const child = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(10, 20, 30)) });
    const g = makeGroup([child]);
    Ops.Items.addItem(doc, g);
    Ops.EditColors.editColors(doc, [g.id], "invert");
    expect(fillColor(doc, child.id)).toEqual({ r: 245, g: 235, b: 225, a: 1 });
  });

  it("leaves 'none' fills unchanged", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: noPaint() });
    Ops.Items.addItem(doc, r);
    Ops.EditColors.editColors(doc, [r.id], "invert");
    expect(Query.getItem(doc, r.id)!.fill.type).toBe("none");
  });

  it("transforms every appearance entry, including hidden paint", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 220)) });
    r.appearance = {
      entries: [
        { id: "hidden", kind: "fill", paint: solid(rgba(10, 20, 30)), visible: false },
        { id: "visible", kind: "fill", paint: solid(rgba(0, 0, 220)) },
        { id: "stroke", kind: "stroke", stroke: defaultStroke(solid(rgba(0, 160, 60))) },
      ],
    };
    Ops.Items.addItem(doc, r);

    Ops.EditColors.editColors(doc, [r.id], "invert");

    const entries = Query.getItem(doc, r.id)!.appearance!.entries;
    expect(entries[0].kind === "fill" && entries[0].paint).toEqual(solid(rgba(245, 235, 225)));
    expect(entries[1].kind === "fill" && entries[1].paint).toEqual(solid(rgba(255, 255, 35)));
    expect(entries[2].kind === "stroke" && entries[2].stroke.paint).toEqual(solid(rgba(255, 95, 195)));
  });

  it("updates envelope and mesh source colours rather than generated children", () => {
    const sourceColor = rgba(10, 20, 30);
    const expected = rgba(245, 235, 225);

    const envelopeDoc = makeDocument();
    const envelopeSource = makeRect(0, 0, 100, 80, 0, 0, { fill: solid(sourceColor) });
    Ops.Items.addItem(envelopeDoc, envelopeSource);
    const envelopeId = Ops.Envelope.makeWithWarp(envelopeDoc, [envelopeSource.id], { style: "arc", bend: 0.2 })!;
    Ops.EditColors.editColors(envelopeDoc, [envelopeId], "invert");
    Ops.Envelope.updateWarp(envelopeDoc, [envelopeId], { style: "arc", bend: 0.6 });
    const envelope = Query.getItem(envelopeDoc, envelopeId)!;
    expect(envelope.type === "group" && envelope.children.every((child) => child.fill.type === "solid" && child.fill.color.r === expected.r)).toBe(true);

    const meshDoc = makeDocument();
    const meshSource = makeRect(0, 0, 100, 80, 0, 0, { fill: solid(sourceColor) });
    Ops.Items.addItem(meshDoc, meshSource);
    const meshId = Ops.Meshes.createMeshFromItem(meshDoc, meshSource.id)!;
    const meshBefore = Query.getItem(meshDoc, meshId)!;
    if (meshBefore.type !== "group" || !meshBefore.mesh) throw new Error("expected mesh group");
    const before = meshBefore.mesh.points.map((point) => ({ ...point.color }));
    Ops.EditColors.editColors(meshDoc, [meshId], "invert");
    Ops.Meshes.regenerateMesh(meshDoc, meshId);
    const mesh = Query.getItem(meshDoc, meshId)!;
    if (mesh.type !== "group" || !mesh.mesh) throw new Error("expected mesh group");
    expect(mesh.mesh.points).toHaveLength(before.length);
    expect(mesh.mesh.points[0].color).toEqual(rgba(255 - before[0].r, 255 - before[0].g, 255 - before[0].b, before[0].a));
  });
});

describe("ops.edit-colors.editColors — grayscale", () => {
  it("replaces a colour with its Rec.601 luminance", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(100, 150, 200)) });
    Ops.Items.addItem(doc, r);
    Ops.EditColors.editColors(doc, [r.id], "grayscale");
    // 0.299·100 + 0.587·150 + 0.114·200 = 140.75 → 141
    expect(fillColor(doc, r.id)).toEqual({ r: 141, g: 141, b: 141, a: 1 });
  });

  it("maps pure red/green/blue to their luma weights", () => {
    const doc = makeDocument();
    const it = (c: ReturnType<typeof rgba>) => {
      const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(c) });
      Ops.Items.addItem(doc, r);
      Ops.EditColors.editColors(doc, [r.id], "grayscale");
      return fillColor(doc, r.id)!.r;
    };
    expect(it(rgba(255, 0, 0))).toBe(76); // round(0.299·255)
    expect(it(rgba(0, 255, 0))).toBe(150); // round(0.587·255)
    expect(it(rgba(0, 0, 255))).toBe(29); // round(0.114·255)
  });
});

describe("ops.edit-colors.editColors — saturate / desaturate", () => {
  const recolor = (mode: "saturate" | "desaturate") => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(100, 150, 200)) }); // luma 140.75
    Ops.Items.addItem(doc, r);
    Ops.EditColors.editColors(doc, [r.id], mode);
    return fillColor(doc, r.id);
  };

  it("saturate pushes channels away from the luma (+50%)", () => {
    // 140.75 + (c−140.75)·1.5  →  (80, 155, 230)
    expect(recolor("saturate")).toEqual({ r: 80, g: 155, b: 230, a: 1 });
  });

  it("desaturate pulls channels toward the luma (−50%)", () => {
    // 140.75 + (c−140.75)·0.5  →  (120, 145, 170)
    expect(recolor("desaturate")).toEqual({ r: 120, g: 145, b: 170, a: 1 });
  });

  it("leaves a grey colour unchanged and clamps to [0,255]", () => {
    const doc = makeDocument();
    const grey = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(128, 128, 128)) });
    const vivid = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(255, 0, 0)) });
    Ops.Items.addItem(doc, grey);
    Ops.Items.addItem(doc, vivid);
    Ops.EditColors.editColors(doc, [grey.id, vivid.id], "saturate");
    expect(fillColor(doc, grey.id)).toEqual({ r: 128, g: 128, b: 128, a: 1 }); // grey stays
    const v = fillColor(doc, vivid.id)!; // pure red oversaturates but stays in range
    expect(v.r).toBeLessThanOrEqual(255);
    expect(v.g).toBeGreaterThanOrEqual(0);
    expect(v.b).toBeGreaterThanOrEqual(0);
  });
});
