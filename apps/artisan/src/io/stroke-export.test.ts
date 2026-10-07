// ─────────────────────────────────────────────────────────────
// io/stroke-export.test — Stroke Cap/Join/Miter/Dash SVG export (parity)
// ─────────────────────────────────────────────────────────────
// Illustrator writes stroke-linecap / stroke-linejoin / stroke-miterlimit /
// stroke-dasharray / stroke-dashoffset to SVG. The exporter must emit all five.
// (SVG's default miter limit is 4; Illustrator's stroke default is 10 and it
// writes it explicitly.) The IMPORT side + full round-trip is covered in the e2e
// suite (`stroke-roundtrip`) because the importer needs a real DOM (DOMParser).

import { describe, it, expect } from "vitest";
import { IO, Path, makeCompound, makeDocument, makePath, makeAnchor as anchor, defaultStroke, solid, rgba, type Document, type Stroke } from "../engine";

const BLACK = rgba(0, 0, 0);
const mkDoc = (stroke: Stroke): Document => {
  const doc = makeDocument();
  const p = makePath(
    { closed: true, anchors: [anchor({ x: 10, y: 10 }), anchor({ x: 90, y: 10 }), anchor({ x: 90, y: 90 }), anchor({ x: 10, y: 90 })] },
    { fill: solid(rgba(200, 120, 60)), stroke },
  );
  doc.layers[0].items.push(p);
  return doc;
};
const stroked = (over: Partial<Stroke>): Stroke => ({ ...defaultStroke(solid(BLACK)), width: 3, ...over });

describe("SVG export — stroke cap/join/miter/dash", () => {
  it("writes all five stroke attributes", () => {
    const svg = IO.exportSVG(mkDoc(stroked({ cap: "round", join: "bevel", miterLimit: 8, dash: [5, 3], dashOffset: 2 })));
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="bevel"');
    expect(svg).toContain('stroke-miterlimit="8"');
    expect(svg).toContain('stroke-dasharray="5,3"');
    expect(svg).toContain('stroke-dashoffset="2"');
  });

  it("writes the default miter limit (10) but omits it at the SVG default (4)", () => {
    expect(IO.exportSVG(mkDoc(stroked({})))).toContain('stroke-miterlimit="10"');
    expect(IO.exportSVG(mkDoc(stroked({ miterLimit: 4 })))).not.toContain("stroke-miterlimit");
  });

  it("omits cap/join/dash at their defaults (butt/miter/no-dash)", () => {
    const svg = IO.exportSVG(mkDoc(stroked({})));
    expect(svg).not.toContain("stroke-linecap");
    expect(svg).not.toContain("stroke-linejoin");
    expect(svg).not.toContain("stroke-dasharray");
  });
});

describe("SVG export — non-native stroke geometry", () => {
  it.each(["inside", "outside"] as const)("preserves %s stroke alignment", (align) => {
    const svg = IO.exportSVG(mkDoc(stroked({ width: 20, align })));
    expect(svg).toContain(`data-stroke-align="${align}"`);
    expect(svg).toContain('stroke-width="40"');
    expect(svg).not.toContain('stroke-width="20"');
    if (align === "inside") {
      expect(svg).toContain("<clipPath");
      expect(svg).toContain('clip-path="url(#');
    } else {
      expect(svg).toContain("<mask");
      expect(svg).toContain('mask="url(#');
      expect(svg).toContain('fill="white"');
      expect(svg).toContain('fill="black"');
    }
  });

  it("exports a width profile as the renderer's filled ribbon", () => {
    const geometry = {
      closed: false,
      anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 50 }), anchor({ x: 100, y: 0 })],
    };
    const widthProfile = [0.1, 2, 0.1];
    const doc = makeDocument();
    const item = makePath(geometry, { fill: solid(rgba(255, 255, 255)), stroke: stroked({ width: 10, widthProfile }) });
    doc.layers[0].items.push(item);

    const ribbon = Path.widthOutline(geometry, widthProfile, 10).map(Path.toSVGPath).join(" ");
    const svg = IO.exportSVG(doc);
    expect(svg).toContain(`d="${ribbon}"`);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toContain('stroke-width="10"');
  });

  it("exports each compound subpath from its flat width profile slice", () => {
    const subpaths = [
      { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] },
      { closed: false, anchors: [anchor({ x: 0, y: 40 }), anchor({ x: 100, y: 40 })] },
    ];
    const widthProfile = [1, 1, 1, 3];
    const doc = makeDocument();
    doc.layers[0].items.push(makeCompound(subpaths, { stroke: stroked({ width: 10, widthProfile }) }));

    const ribbon = Path.widthOutlines(subpaths, widthProfile, 10).map(Path.toSVGPath).join(" ");
    const svg = IO.exportSVG(doc);

    expect(svg).toContain(`d="${ribbon}"`);
    expect(svg).not.toContain('stroke-width="10"');
  });
});
