// ─────────────────────────────────────────────────────────────
// render/image-effects.test — a placed image's effects must actually render
// ─────────────────────────────────────────────────────────────
// `common` carries filter="url(#fx_<id>)" for any item with effects, but the
// <filter> element itself lives in `defs`. The image branch rendered `mk.el`
// (arrowhead markers, which an image never has) and dropped `defs`, so an image
// with a drop shadow pointed at a filter that was never emitted — in SVG a
// dangling filter reference makes the element render with no filter at all.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeImage, type ImageItem } from "../engine";
import { ItemNode } from "./item-node";

const render = (item: ImageItem) => renderToStaticMarkup(createElement("svg", null, createElement(ItemNode, { item })));

const img = (): ImageItem => makeImage("data:image/png;base64,iVBORw0KGgo=", 0, 0, 100, 80);

describe("placed image effects", () => {
  it("emits the <filter> it references", () => {
    const it = img();
    it.effects = [{ type: "drop-shadow", dx: 4, dy: 4, blur: 3, color: { r: 0, g: 0, b: 0, a: 0.5 } }];
    const html = render(it);

    const ref = /filter="url\(#([^)]+)\)"/.exec(html);
    expect(ref, "the image should reference a filter").toBeTruthy();
    expect(html).toContain(`<filter id="${ref![1]}"`);
    expect(html).toContain("feDropShadow");
  });

  it("renders a blur on an image too", () => {
    const it = img();
    it.effects = [{ type: "blur", radius: 4 }];
    const html = render(it);
    expect(html).toContain("feGaussianBlur");
  });

  it("emits no filter when the image has no effects", () => {
    expect(render(img())).not.toContain("<filter");
  });
});
