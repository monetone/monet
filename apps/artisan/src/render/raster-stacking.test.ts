// Rust mode and SVG mode each paint overlapping plain, effected, and masked
// items once. The fallback overlay does not stack a second copy on the canvas.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  makeDocument,
  makeGroup,
  makeImage,
  makeRect,
  makeText,
  rgba,
  solid,
  type Effect,
} from "../engine";
import { DocumentContent } from "./document-content";
import { documentForRaster } from "./raster-scene";
import { FallbackOverlay } from "./text-overlay";

const SHADOW: Effect = { type: "drop-shadow", dx: 0, dy: 14, blur: 0, color: { r: 0, g: 0, b: 0, a: 1 } };

function stackedDoc() {
  const blue = makeRect(1, 2, 8, 8, 0, 0, { fill: solid(rgba(0, 0, 255)), opacity: 0.5 });
  blue.mask = [makeRect(0, 0, 5, 8, 0, 0, { fill: solid(rgba(255, 255, 255)) })];
  blue.effects = [SHADOW];
  const red = makeRect(4, 2, 8, 8, 0, 0, { fill: solid(rgba(255, 0, 0)), opacity: 0.5 });
  const text = makeText("Hybrid", 2, 20, { fontSize: 14, fill: solid(rgba(0, 0, 0)) });
  const photo = makeImage("data:image/jpeg;base64,AAAA", 0, 0, 4, 4);
  const doc = makeDocument("Stack", 16, 28);
  doc.layers[0].items.push(makeGroup([makeGroup([blue, text]), photo]), red);
  return { doc, blue, red, text, photo };
}

const markup = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(node);

describe("Artisan stacking", () => {
  it("paints plain, effected, and masked items once in SVG, in document order", () => {
    const { doc, blue, red } = stackedDoc();
    const html = markup(createElement(DocumentContent, { doc }));
    const blueAt = html.indexOf(`data-id="${blue.id}"`);
    const redAt = html.indexOf(`data-id="${red.id}"`);
    expect(blueAt).toBeGreaterThan(-1);
    expect(redAt).toBeGreaterThan(blueAt);

    const blueTag = html.slice(html.lastIndexOf("<g", blueAt), html.indexOf(">", blueAt) + 1);
    expect(blueTag).toContain('opacity="0.5"');
    expect(blueTag).toMatch(/mask="url\(#mask_/);
    expect(html.slice(blueAt, redAt)).toContain("feDropShadow");

    const redTag = html.slice(html.lastIndexOf("<g", redAt), html.indexOf(">", redAt) + 1);
    expect(redTag).toContain('opacity="0.5"');
    expect(html.slice(redAt)).not.toContain("feDropShadow");
    expect(html).toContain("Hybrid");
  });

  it("leaves Rust-painted items out of the raster fallback and keeps an undecodable image", () => {
    const { doc, blue, red, text, photo } = stackedDoc();
    const html = markup(createElement(FallbackOverlay, { doc }));
    expect(html).not.toContain(`data-id="${blue.id}"`);
    expect(html).not.toContain(`data-id="${red.id}"`);
    expect(html).not.toContain(`data-id="${text.id}"`);
    expect(html).not.toContain("feDropShadow");
    expect(html).toContain(`data-id="${photo.id}"`);
    expect(html).toContain("data:image/jpeg;base64,AAAA");

    const hidden = markup(createElement(FallbackOverlay, { doc, hideId: photo.id }));
    expect(hidden).not.toContain(`data-id="${photo.id}"`);
  });

  it("omits the text item the HTML editor is showing from the raster document", () => {
    const { doc, text, red } = stackedDoc();
    expect(documentForRaster(doc)).toBe(doc);
    expect(documentForRaster(doc, "missing")).toBe(doc);

    const raster = documentForRaster(doc, text.id);
    expect(raster).not.toBe(doc);
    const group = raster.layers[0].items[0];
    expect(group.type).toBe("group");
    if (group.type !== "group") return;
    const nested = group.children[0];
    expect(nested.type).toBe("group");
    if (nested.type !== "group") return;
    expect(nested.children.map((item) => item.id)).not.toContain(text.id);
    expect(raster.layers[0].items.some((item) => item.id === red.id)).toBe(true);
    const original = doc.layers[0].items[0];
    if (original.type !== "group" || original.children[0].type !== "group") throw new Error("fixture shape");
    expect(original.children[0].children.map((item) => item.id)).toContain(text.id);

    const source = readFileSync(new URL("./raster-document.tsx", import.meta.url), "utf8");
    expect(source).toContain("documentForRaster(state.doc, state.editingTextId)");
    expect(source).toContain("state.editingTextId]");
  });
});
