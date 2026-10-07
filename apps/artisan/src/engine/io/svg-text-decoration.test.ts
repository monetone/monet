// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// io/svg-text-decoration.test — underline / strikethrough export + round-trip
// ─────────────────────────────────────────────────────────────
// text-decoration is a standard SVG attribute, so it renders in any viewer and
// survives our own export → import cycle (import needs a DOM ⇒ happy-dom).

import { describe, it, expect } from "vitest";
import { IO, makeDocument, makeText, Ops, type Document, type Item, type TextItem } from "../index";
import { importSVG } from "../../io/import/svg";

const findText = (doc: Document): TextItem | null => {
  const walk = (items: Item[]): TextItem | null => {
    for (const it of items) {
      if (it.type === "text") return it;
      if (it.type === "group") {
        const r = walk(it.children);
        if (r) return r;
      }
    }
    return null;
  };
  for (const layer of doc.layers) {
    const r = walk(layer.items);
    if (r) return r;
  }
  return null;
};

describe("svg text-decoration", () => {
  it("exports a standard text-decoration attribute for underline + strikethrough", () => {
    const doc = makeDocument();
    const t = makeText("Deco", 10, 20, { fontSize: 24 });
    t.underline = true;
    t.strikethrough = true;
    Ops.Items.addItem(doc, t);
    expect(IO.exportSVG(doc)).toContain('text-decoration="underline line-through"');
  });

  it("emits only underline when strikethrough is off", () => {
    const doc = makeDocument();
    const t = makeText("U", 0, 0, { fontSize: 24 });
    t.underline = true;
    Ops.Items.addItem(doc, t);
    expect(IO.exportSVG(doc)).toContain('text-decoration="underline"');
  });

  it("omits text-decoration when neither flag is set", () => {
    const doc = makeDocument();
    Ops.Items.addItem(doc, makeText("Plain", 0, 0, { fontSize: 24 }));
    expect(IO.exportSVG(doc)).not.toContain("text-decoration=");
  });

  it("round-trips underline + strikethrough through export → import", () => {
    const doc = makeDocument();
    const t = makeText("RT", 5, 5, { fontSize: 24 });
    t.underline = true;
    t.strikethrough = true;
    Ops.Items.addItem(doc, t);
    const reimported = importSVG(IO.exportSVG(doc));
    const it = findText(reimported);
    expect(it?.underline).toBe(true);
    expect(it?.strikethrough).toBe(true);
  });
});
