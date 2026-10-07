// ─────────────────────────────────────────────────────────────
// render/key-object-outline.test — the Align Key Object gets a heavier outline
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator draws the "Key Object" with a thicker selection
// border so it reads as the anchor of the alignment. SelectionOutlines marks the
// keyId node with data-key-object="true" and a heavier stroke-width.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectionOutlines } from "./overlay";
import { makeDocument, makeRect, rgba, solid } from "../engine";

function setup() {
  const doc = makeDocument();
  const a = makeRect(0, 0, 50, 50, 0, 0, { fill: solid(rgba(10, 10, 10)) });
  const b = makeRect(200, 0, 50, 50, 0, 0, { fill: solid(rgba(20, 20, 20)) });
  doc.layers[0].items.push(a, b);
  return { doc, A: a.id, B: b.id };
}

const render = (doc: ReturnType<typeof setup>["doc"], selection: string[], keyId?: string | null) =>
  renderToStaticMarkup(createElement(SelectionOutlines, { doc, selection, keyId }));

describe("SelectionOutlines — Key Object highlight", () => {
  it("marks only the key node with data-key-object and a heavier stroke", () => {
    const { doc, A, B } = setup();
    const svg = render(doc, [A, B], B);
    // exactly one key-marked node
    expect((svg.match(/data-key-object="true"/g) || []).length).toBe(1);
    expect(svg).toContain('stroke-width="2.5"'); // key outline is heavier
    expect(svg).toContain('stroke-width="1"'); // the non-key item stays default
  });

  it("adds no key marker when no key is designated", () => {
    const { doc, A, B } = setup();
    const svg = render(doc, [A, B]);
    expect(svg).not.toContain("data-key-object");
    expect(svg).not.toContain('stroke-width="2.5"');
  });
});
