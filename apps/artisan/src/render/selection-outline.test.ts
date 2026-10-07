// ─────────────────────────────────────────────────────────────
// render/selection-outline.test — the inline-edited item is skipped
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — while you edit text, only the text-frame editing
// box is shown; there is no extra selection rectangle on top of it. The Type tool's
// <textarea> draws its own dashed box, so SelectionOutlines must NOT also draw the
// AABB for the item being edited (`hideId`) — otherwise the entry gets a double
// border (the bug this guards against). Other selected items stay outlined.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectionOutlines } from "./overlay";
import { makeDocument, makeRect, makeText, rgba, solid } from "../engine";

function setup() {
  const doc = makeDocument();
  const text = makeText("hi", 0, 0, { fontSize: 20 });
  // Area type → deterministic AABB (no font measurement needed in the test env).
  text.boxWidth = 120;
  text.boxHeight = 40;
  const rect = makeRect(200, 0, 50, 50, 0, 0, { fill: solid(rgba(10, 10, 10)) });
  doc.layers[0].items.push(text, rect);
  return { doc, textId: text.id, rectId: rect.id };
}

const render = (doc: ReturnType<typeof setup>["doc"], selection: string[], hideId?: string) =>
  renderToStaticMarkup(createElement(SelectionOutlines, { doc, selection, hideId }));

describe("SelectionOutlines — inline-edited item", () => {
  it("outlines a selected text item (AABB rect) alongside a selected shape (path)", () => {
    const { doc, textId, rectId } = setup();
    const svg = render(doc, [textId, rectId]);
    expect(svg).toContain("<rect"); // text → world-AABB rectangle
    expect(svg).toContain("<path"); // shape → vector outline
  });

  it("skips the outline of the item being edited (hideId) so the entry isn't double-bordered", () => {
    const { doc, textId, rectId } = setup();
    const svg = render(doc, [textId, rectId], textId);
    expect(svg).not.toContain("<rect"); // edited text's AABB suppressed — no second border
    expect(svg).toContain("<path"); // the other selected item is still outlined
  });
});
