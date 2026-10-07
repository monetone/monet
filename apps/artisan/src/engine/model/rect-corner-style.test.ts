// ─────────────────────────────────────────────────────────────
// model/rect-corner-style.test — live rect corner styles (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator's live-rectangle Corners — a rounded corner can be
// Round (convex), Inverted Round (concave), or Chamfer (straight cut). The three
// share the corner offset anchors; only the KAPPA handle factor differs
// (round +1, chamfer 0, inverted −1).

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeLayer, Shapes } from "../index";
import { exportSVG } from "../io/svg";

const { rectPath, isRectCustomCorner } = Shapes;
const KAPPA = 0.5522847498307936;

describe("Shapes.isRectCustomCorner", () => {
  it("is true only for a rounded rect with a chamfer/inverted style", () => {
    expect(isRectCustomCorner(0, 0, undefined)).toBe(false); // sharp
    expect(isRectCustomCorner(12, 12, undefined)).toBe(false); // round (default)
    expect(isRectCustomCorner(12, 12, "round")).toBe(false);
    expect(isRectCustomCorner(0, 0, "chamfer")).toBe(false); // sharp → style irrelevant
    expect(isRectCustomCorner(12, 12, "chamfer")).toBe(true);
    expect(isRectCustomCorner(12, 12, "inverted")).toBe(true);
  });
});

describe("rectPath — corner style", () => {
  // index 1 is the top edge's right anchor (w-rx,0); its handleOut spans the corner.
  const cornerHandle = (style?: "round" | "chamfer" | "inverted") => rectPath(100, 60, 12, 12, style).anchors[1].handleOut.x;

  it("round (default) keeps the existing convex KAPPA handles", () => {
    expect(rectPath(100, 60, 12, 12).anchors).toHaveLength(8);
    expect(cornerHandle()).toBeCloseTo(12 * KAPPA, 6);
    expect(cornerHandle("round")).toBeCloseTo(12 * KAPPA, 6);
  });

  it("chamfer zeroes the corner handles (straight cut)", () => {
    expect(rectPath(100, 60, 12, 12, "chamfer").anchors).toHaveLength(8);
    expect(cornerHandle("chamfer")).toBe(0);
  });

  it("inverted negates the corner handles (concave arc)", () => {
    expect(cornerHandle("inverted")).toBeCloseTo(-12 * KAPPA, 6);
  });

  it("a sharp rect (rx or ry = 0) returns the 4-anchor rectangle regardless of style", () => {
    expect(rectPath(100, 60, 0, 0, "chamfer").anchors).toHaveLength(4);
    expect(rectPath(100, 60, 12, 0, "inverted").anchors).toHaveLength(4);
  });
});

describe("exportSVG — rect corner style", () => {
  const rectDoc = (style?: "round" | "chamfer" | "inverted") => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 60, 12, 12);
    if (style) r.cornerStyle = style;
    doc.layers = [makeLayer("L", [r])];
    return doc;
  };

  it("exports a round rounded-rect as <rect> and a chamfer/inverted one as <path>", () => {
    expect(exportSVG(rectDoc())).toContain("<rect"); // round (default)
    expect(exportSVG(rectDoc("round"))).toContain("<rect");
    const chamfer = exportSVG(rectDoc("chamfer"));
    expect(chamfer).toContain("<path");
    expect(chamfer).not.toContain("<rect");
    expect(exportSVG(rectDoc("inverted"))).toContain("<path");
  });
});
