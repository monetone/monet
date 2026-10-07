// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// render/effect-inner-glow.test — Illustrator Effect ▸ Stylize ▸ Inner Glow
// ─────────────────────────────────────────────────────────────
// Reference: Inner Glow paints a halo on the INSIDE edges of a shape (vs Outer
// Glow's halo behind it). The filter floods the colour, knocks it OUT against
// the alpha, blurs that inward, then clips IN to the shape and merges ON TOP of
// the source. The unique marker is a `feComposite operator="out"` pass — which
// also lets the importer re-detect it as inner-glow (not a plain blur) on
// round-trip, and keeps it distinct from Outer Glow.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNode } from "./item-node";
import { makeDocument, makeRect, Ops, Query, IO, type Document, type Effect } from "../engine";
import { importSVG } from "../io/import/svg";

// Silence react-dom/server's "incorrect casing" SSR warning for camelCase SVG tags.
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

const INNER: Effect = { type: "inner-glow", blur: 8, color: { r: 255, g: 255, b: 255, a: 0.75 } };
const OUTER: Effect = { type: "glow", blur: 8, color: { r: 255, g: 240, b: 120, a: 0.9 } };

const renderSvg = (effect: Effect) => {
  const item = makeRect(0, 0, 100, 60);
  item.effects = [effect];
  return renderToStaticMarkup(createElement(ItemNode, { item }));
};
const exportSvg = (effect: Effect) => {
  const doc = makeDocument();
  const r = makeRect(10, 10, 100, 60);
  Ops.Items.addItem(doc, r);
  Ops.Effects.addEffect(doc, [r.id], effect);
  return IO.exportSVG(doc, { background: true });
};
const allEffectTypes = (doc: Document): string[] => {
  const out: string[] = [];
  Query.eachItem(doc, (it) => {
    for (const e of it.effects ?? []) out.push(e.type);
  });
  return out;
};

describe("render — Inner Glow", () => {
  it("floods the colour, knocks it OUT, blurs, clips IN, and merges on top", () => {
    const svg = renderSvg(INNER);
    expect(svg).toContain("feFlood");
    expect(svg).toContain('operator="out"'); // unique to inner glow
    expect(svg).toContain('operator="in"');
    expect(svg).toContain("feMerge");
    // The glow sits ON TOP of the source: SourceGraphic merges BEFORE the glow node.
    expect(svg.indexOf('in="SourceGraphic"')).toBeLessThan(svg.lastIndexOf("feMergeNode"));
  });

  it("is distinct from Outer Glow (which never knocks OUT against the alpha)", () => {
    expect(renderSvg(OUTER)).not.toContain('operator="out"');
    expect(renderSvg(INNER)).not.toBe(renderSvg(OUTER));
  });
});

describe("export — Inner Glow SVG", () => {
  it("exports the flood / out / blur / in / merge filter group", () => {
    const svg = exportSvg(INNER);
    expect(svg).toContain("<feFlood");
    expect(svg).toContain('operator="out"');
    expect(svg).toContain('<feGaussianBlur in="igo0" stdDeviation="8"'); // per-effect indexed result
    expect(svg).toContain('flood-opacity="0.75"');
    expect(svg).toMatch(/<feMerge\b/);
  });
});

describe("round-trip — Inner Glow survives SVG export → re-import", () => {
  it("re-imports as inner-glow (not a plain blur or outer glow)", () => {
    const re = importSVG(exportSvg(INNER));
    const types = allEffectTypes(re);
    expect(types).toContain("inner-glow");
    expect(types).not.toContain("blur");
    expect(types).not.toContain("glow");
  });

  it("does NOT steal Outer Glow — that still round-trips as glow", () => {
    const re = importSVG(exportSvg(OUTER));
    const types = allEffectTypes(re);
    expect(types).toContain("glow");
    expect(types).not.toContain("inner-glow");
  });
});
