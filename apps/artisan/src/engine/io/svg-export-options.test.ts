// ─────────────────────────────────────────────────────────────
// io/svg-export-options.test — exportSVG options (artboard/bg/region/layers)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Save As / Export ▸ SVG" — the SVG is cropped to
// the chosen ARTBOARD (its rect becomes width/height/viewBox), optionally with a
// white BACKGROUND; hidden layers are omitted and layer opacity is preserved.

import { describe, it, expect } from "vitest";
import { IO, makeDocument, makeArtboard, makeLayer, makeRect, Ops, solid, rgba } from "../index";

const docWithRect = (w = 800, h = 600) => {
  const doc = makeDocument("Doc", w, h); // artboard 0 = (0,0,w,h)
  Ops.Items.addItem(doc, makeRect(10, 10, 51, 52, 0, 0, { fill: solid(rgba(200, 50, 50)) }));
  return doc;
};

describe("exportSVG options", () => {
  it("crops to the active artboard (viewBox + width/height)", () => {
    const svg = IO.exportSVG(docWithRect(800, 600));
    expect(svg).toContain('viewBox="0 0 800 600"');
    expect(svg).toContain('width="800"');
    expect(svg).toContain('height="600"');
  });

  it("background:true paints a white artboard rect; false/omitted does not", () => {
    const doc = docWithRect(800, 600);
    expect(IO.exportSVG(doc, { background: true })).toContain('<rect x="0" y="0" width="800" height="600" fill="#ffffff"/>');
    expect(IO.exportSVG(doc, { background: false })).not.toContain('fill="#ffffff"');
    expect(IO.exportSVG(doc)).not.toContain('fill="#ffffff"'); // default = no bg
  });

  it("artboardIndex selects which artboard's rect becomes the viewBox", () => {
    const doc = docWithRect(800, 600);
    doc.artboards.push(makeArtboard("Artboard 2", 1000, 0, 400, 300));
    const svg = IO.exportSVG(doc, { artboardIndex: 1 });
    expect(svg).toContain('viewBox="1000 0 400 300"');
    expect(svg).toContain('width="400"');
    expect(svg).toContain('height="300"');
  });

  it("region overrides the artboard rect (used for slices)", () => {
    const svg = IO.exportSVG(docWithRect(800, 600), { region: { x: 50, y: 50, width: 120, height: 90 } });
    expect(svg).toContain('viewBox="50 50 120 90"');
    expect(svg).toContain('width="120"');
  });

  it("omits hidden layers", () => {
    const doc = makeDocument("Doc", 800, 600);
    doc.layers.push(makeLayer("Hidden"));
    doc.layers[1].visible = false;
    Ops.Items.addItem(doc, makeRect(0, 0, 51, 51, 0, 0, { fill: solid(rgba(10, 10, 10)) }), doc.layers[0].id); // visible
    Ops.Items.addItem(doc, makeRect(0, 0, 97, 97, 0, 0, { fill: solid(rgba(20, 20, 20)) }), doc.layers[1].id); // hidden
    const svg = IO.exportSVG(doc);
    expect(svg).toContain('width="51"'); // visible rect present
    expect(svg).not.toContain('width="97"'); // hidden layer's rect omitted
  });

  it("preserves layer opacity on the layer group", () => {
    const doc = docWithRect(800, 600);
    doc.layers[0].opacity = 0.5;
    expect(IO.exportSVG(doc)).toContain('<g opacity="0.5">');
  });
});
