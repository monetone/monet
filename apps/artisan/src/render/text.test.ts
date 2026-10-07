// ─────────────────────────────────────────────────────────────
// render/text.test — point-type rendering (alignment + multiline)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator point type. Paragraph alignment maps to SVG
// text-anchor (left=start, center=middle, right=end); each line is a <tspan>
// offset by one line-height (fontSize × lineHeight) below the previous.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNode } from "./item-node";
import { makeText } from "../engine";

// `react-dom/server` (only) warns that camelCase SVG tags <textPath>/<foreignObject>
// are "incorrect casing"; the browser `react-dom` renders them fine (the app ships
// both for type-on-a-path and area type). Silence just that SSR-only noise.
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

describe("ItemNode — point-type rendering", () => {
  it("maps paragraph alignment to text-anchor (left→start, center→middle, right→end)", () => {
    const left = renderToStaticMarkup(createElement(ItemNode, { item: makeText("Hi", 10, 10) }));
    expect(left).toMatch(/text-anchor="start"/);
    const center = renderToStaticMarkup(createElement(ItemNode, { item: makeText("Hi", 10, 10, { align: "center" }) }));
    expect(center).toMatch(/text-anchor="middle"/);
    const right = renderToStaticMarkup(createElement(ItemNode, { item: makeText("Hi", 10, 10, { align: "right" }) }));
    expect(right).toMatch(/text-anchor="end"/);
  });

  it("renders a <text> with the item's font-size and content", () => {
    const html = renderToStaticMarkup(createElement(ItemNode, { item: makeText("Hello", 10, 10, { fontSize: 48 }) }));
    expect(html).toMatch(/<text[^>]*font-size="48"/);
    expect(html).toContain("Hello");
  });

  it("breaks a multiline value into one <tspan> per line, each a line-height down", () => {
    // fontSize 40, lineHeight 1.2 → second line dy = 48
    const html = renderToStaticMarkup(createElement(ItemNode, { item: makeText("A\nB", 10, 10, { fontSize: 40 }) }));
    const tspans = html.match(/<tspan/g) ?? [];
    expect(tspans).toHaveLength(2);
    expect(html).toMatch(/dy="48"/); // 40 × 1.2
  });

  it("type-on-a-path renders a <textPath> referencing the baked path geometry", () => {
    const item = { ...makeText("Flow", 0, 0, { fontSize: 32 }), pathD: "M0 0 L100 0" };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    expect(html).toMatch(/<path id="tp_[^"]*" d="M0 0 L100 0"/); // path def
    expect(html).toMatch(/<textPath[^>]*href="#tp_/); // text bound to it
    expect(html).toContain("Flow");
  });

  it("area type renders a <foreignObject> box wrapping the text", () => {
    const item = { ...makeText("Wrapped", 0, 0, { fontSize: 18 }), boxWidth: 200, boxHeight: 100 };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    expect(html).toMatch(/<foreignObject[^>]*width="200"[^>]*height="100"/);
    expect(html).toContain("Wrapped");
  });

  it("area type honours tracking (letter-spacing) on the wrapped box", () => {
    const item = { ...makeText("Wide", 0, 0, { fontSize: 18 }), boxWidth: 200, boxHeight: 100, letterSpacing: 3 };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    expect(html).toMatch(/letter-spacing:3px/);
  });

  it("type-on-a-path moves the textPath startOffset to honour alignment", () => {
    const base = makeText("Flow", 0, 0, { fontSize: 32 });
    const path = "M0 0 L100 0";
    const center = renderToStaticMarkup(createElement(ItemNode, { item: { ...base, pathD: path, align: "center" } }));
    const right = renderToStaticMarkup(createElement(ItemNode, { item: { ...base, pathD: path, align: "right" } }));
    const left = renderToStaticMarkup(createElement(ItemNode, { item: { ...base, pathD: path } }));
    expect(center).toMatch(/startOffset="50%"/);
    expect(right).toMatch(/startOffset="100%"/);
    expect(left).toMatch(/startOffset="0"/);
  });

  it("applies horizontal/vertical scale and baseline shift via the text transform", () => {
    const item = { ...makeText("Hi", 0, 0, { fontSize: 20 }), horizontalScale: 150, verticalScale: 50, baselineShift: 4 };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    expect(html).toMatch(/transform="translate\(0 -4\) scale\(1\.5 0\.5\)"/);
  });

  it("includes paragraph spacing in the multi-line dy and indents every paragraph's first line", () => {
    const item = { ...makeText("A\nB", 0, 0, { fontSize: 40 }), spaceBefore: 5, spaceAfter: 3, indentLeft: 10, indentFirst: 6 };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    expect(html).toMatch(/dy="56"/); // 40×1.2 + 5 + 3
    // each "\n" line is a paragraph, so first-line indent applies to every line
    const xs = [...html.matchAll(/x="(-?\d+)"/g)].map((m) => m[1]);
    expect(xs).toEqual(["16", "16"]); // both lines: indentLeft 10 + first-line 6
  });

  it("renders area-type paragraphs as blocks with indent padding", () => {
    const item = { ...makeText("P1\nP2", 0, 0, { fontSize: 18 }), boxWidth: 200, boxHeight: 100, indentLeft: 12, spaceBefore: 6 };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    expect(html).toMatch(/padding-left:12px/);
    expect(html).toContain("P1");
    expect(html).toContain("P2");
  });

  it("area type uses border-box and scale-aware sizing so indents/scale stay inside the box", () => {
    const item = { ...makeText("Hi", 0, 0, { fontSize: 18 }), boxWidth: 200, boxHeight: 100, indentLeft: 12, horizontalScale: 200 };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    expect(html).toMatch(/box-sizing:border-box/);
    expect(html).toMatch(/width:100px/); // boxWidth 200 ÷ hScale 2 → laid out at 100, scaled back to 200
    expect(html).toMatch(/scale\(2, 1\)/);
  });

  it("area-type paragraph spacing is additive and non-collapsing (padding-top = before + after)", () => {
    const item = { ...makeText("P1\nP2", 0, 0, { fontSize: 18 }), boxWidth: 200, boxHeight: 100, spaceBefore: 5, spaceAfter: 3 };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    expect(html).toMatch(/padding-top:8px/); // 5 + 3 between paragraphs (matches point-text sum)
  });

  it("type-on-path shifts the baseline via tspan dy and omits the distorting layout-wide scale", () => {
    const item = { ...makeText("Flow", 0, 0, { fontSize: 32 }), pathD: "M0 0 L100 0", baselineShift: 4, horizontalScale: 200 };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    expect(html).toMatch(/<tspan dy="-4"/); // baseline shift as an on-path offset
    expect(html).not.toMatch(/scale\(/); // no layout-wide scale that would pull glyphs off the path
  });

  it("area type renders rich runs with per-run weight/style", () => {
    const item = {
      ...makeText("AB", 0, 0, { fontSize: 18 }),
      boxWidth: 200,
      boxHeight: 100,
      runs: [
        { text: "A", fontWeight: 700 },
        { text: "B", fontStyle: "italic" as const },
      ],
    };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    expect(html).toMatch(/<foreignObject/);
    expect(html).toMatch(/font-weight:700/);
    expect(html).toMatch(/font-style:italic/);
  });
});
