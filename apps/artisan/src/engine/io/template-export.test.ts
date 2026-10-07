// ─────────────────────────────────────────────────────────────
// io/template-export.test — Template layers are non-printing (excluded)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator template layers are non-printing — they never
// appear in exported / printed output. exportSVG must drop them while keeping
// sibling normal layers.

import { describe, it, expect } from "vitest";
import { exportSVG } from "./svg";
import { makeDocument, makeLayer, makeRect, solid, rgba } from "../index";

const docWith = (template: boolean) => {
  const doc = makeDocument();
  doc.layers = [makeLayer("Art", [makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(10, 20, 30)) })])];
  doc.layers[0].template = template;
  return doc;
};

describe("exportSVG — template layers are non-printing", () => {
  it("exports a normal layer's shape but omits the same layer when it is a template", () => {
    expect(exportSVG(docWith(false))).toContain("<rect"); // normal → shape present
    expect(exportSVG(docWith(true))).not.toContain("<rect"); // template → excluded
  });

  it("keeps a normal layer while dropping a sibling template layer", () => {
    const doc = makeDocument();
    const art = makeLayer("Art", [makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 0)) })]);
    const ref = makeLayer("Ref", [makeRect(20, 0, 10, 10, 0, 0, { fill: solid(rgba(200, 100, 50)) })]);
    ref.template = true;
    doc.layers = [art, ref];
    const svg = exportSVG(doc);
    // exactly one shape survives — the normal layer's, not the template's
    expect((svg.match(/<rect/g) ?? []).length).toBe(1);
  });
});
