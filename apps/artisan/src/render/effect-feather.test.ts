// ─────────────────────────────────────────────────────────────
// render/effect-feather.test — Illustrator "Feather" ≠ "Gaussian Blur"
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Effect ▸ Blur ▸ Gaussian Blur (blurs the whole
// object) vs Effect ▸ Stylize ▸ Feather (fades only the edge alpha, keeps the
// interior crisp). The two must NOT render to the same SVG filter.
//   blur    → <feGaussianBlur stdDeviation>            (blurs colour + alpha)
//   feather → <feGaussianBlur in="SourceAlpha"> + <feComposite in="SourceGraphic" operator="in">

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNode } from "./item-node";
import { makeDocument, makeRect, Ops, IO, type Effect } from "../engine";

// react-dom/server warns "incorrect casing" for camelCase SVG tags (clipPath/
// feGaussianBlur); react-dom in the browser does not. Silence that SSR noise.
let restoreErr: (() => void) | undefined;
beforeAll(() => {
  const orig = console.error;
  restoreErr = () => (console.error = orig);
  console.error = (...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].includes("incorrect casing")) return;
    orig(...(a as []));
  };
});
afterAll(() => restoreErr?.());

const rectWith = (effect: Effect) => {
  const item = makeRect(0, 0, 100, 60);
  item.effects = [effect];
  return item;
};
const renderSvg = (effect: Effect) => renderToStaticMarkup(createElement(ItemNode, { item: rectWith(effect) }));

const exportSvg = (effect: Effect) => {
  const doc = makeDocument();
  const r = makeRect(10, 10, 100, 60);
  Ops.Items.addItem(doc, r);
  Ops.Effects.addEffect(doc, [r.id], effect);
  return IO.exportSVG(doc, { background: true });
};

describe("render — Feather vs Gaussian Blur", () => {
  it("blur blurs the whole graphic (plain feGaussianBlur, no alpha trick)", () => {
    const svg = renderSvg({ type: "blur", radius: 4 });
    expect(svg).toContain("feGaussianBlur");
    expect(svg).not.toContain("SourceAlpha");
    expect(svg).not.toContain("feComposite");
  });

  it("feather blurs the alpha and composites the crisp source through it", () => {
    const svg = renderSvg({ type: "feather", radius: 8 });
    expect(svg).toContain('in="SourceAlpha"');
    expect(svg).toContain("feComposite");
    expect(svg).toContain('operator="in"');
    expect(svg).toContain('in="SourceGraphic"');
  });

  it("the two effects produce DIFFERENT filters", () => {
    expect(renderSvg({ type: "feather", radius: 6 })).not.toBe(renderSvg({ type: "blur", radius: 6 }));
  });
});

describe("export — Feather vs Gaussian Blur SVG", () => {
  it("exports feather as a SourceAlpha-blur + SourceGraphic composite", () => {
    const svg = exportSvg({ type: "feather", radius: 8 });
    expect(svg).toContain('in="SourceAlpha"');
    expect(svg).toContain("feComposite");
    expect(svg).toContain('in="SourceGraphic"');
  });

  it("exports blur as a plain feGaussianBlur (no alpha compositing)", () => {
    const svg = exportSvg({ type: "blur", radius: 4 });
    expect(svg).toContain("feGaussianBlur");
    expect(svg).not.toContain("SourceAlpha");
    expect(svg).not.toContain("feComposite");
  });
});
