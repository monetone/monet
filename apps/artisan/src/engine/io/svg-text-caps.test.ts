// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// io/svg-text-caps.test — All Caps / Small Caps export + round-trip
// ─────────────────────────────────────────────────────────────
// All Caps / Small Caps export as the standard text-transform / font-variant
// attributes, so they render in any viewer and survive export → import (import
// needs a DOM ⇒ happy-dom). They also persist through the .artisan serializer.

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

const withCaps = (caps: "all" | "small") => {
  const doc = makeDocument();
  const t = makeText("Caps", 10, 20, { fontSize: 24 });
  t.caps = caps;
  Ops.Items.addItem(doc, t);
  return doc;
};

describe("svg text caps export", () => {
  it("exports text-transform=uppercase for All Caps", () => {
    expect(IO.exportSVG(withCaps("all"))).toContain('text-transform="uppercase"');
  });

  it("exports font-variant=small-caps for Small Caps", () => {
    expect(IO.exportSVG(withCaps("small"))).toContain('font-variant="small-caps"');
  });

  it("omits caps attributes when caps is unset", () => {
    const doc = makeDocument();
    Ops.Items.addItem(doc, makeText("Plain", 0, 0, { fontSize: 24 }));
    const svg = IO.exportSVG(doc);
    expect(svg).not.toContain("text-transform=");
    expect(svg).not.toContain("font-variant=");
  });
});

describe("svg text caps round-trip", () => {
  it("round-trips All Caps through export → import", () => {
    const reimported = importSVG(IO.exportSVG(withCaps("all")));
    expect(findText(reimported)?.caps).toBe("all");
  });

  it("round-trips Small Caps through export → import", () => {
    const reimported = importSVG(IO.exportSVG(withCaps("small")));
    expect(findText(reimported)?.caps).toBe("small");
  });

  it("persists caps through the .artisan serializer", () => {
    const restored = IO.deserializeDocument(IO.serializeDocument(withCaps("all")));
    expect(findText(restored)?.caps).toBe("all");
  });
});
