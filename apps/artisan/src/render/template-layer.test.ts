// ─────────────────────────────────────────────────────────────
// render/template-layer.test — template layers render DIMMED + tagged
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator shows a template layer dimmed (a faded tracing
// reference). DocumentContent renders its <g> at half opacity and tags it
// data-layer-template; normal layers are unchanged.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentContent } from "./document-content";
import { makeDocument, makeLayer, makeRect, solid, rgba } from "../engine";

const draw = (doc: ReturnType<typeof makeDocument>) => renderToStaticMarkup(createElement(DocumentContent, { doc }));

describe("DocumentContent — template layer dimming", () => {
  it("renders a template layer dimmed (opacity 0.5) and tagged, alongside an undimmed normal layer", () => {
    const doc = makeDocument();
    const art = makeLayer("Art", [makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 0)) })]);
    const ref = makeLayer("Ref", [makeRect(20, 0, 10, 10, 0, 0, { fill: solid(rgba(200, 100, 50)) })]);
    ref.template = true;
    doc.layers = [art, ref];
    const svg = draw(doc);
    expect((svg.match(/data-layer-template="true"/g) ?? []).length).toBe(1); // exactly the one template layer
    expect(svg).toContain('opacity="0.5"'); // dimmed
  });

  it("does not tag or dim a normal layer", () => {
    const doc = makeDocument();
    doc.layers = [makeLayer("Art", [makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 0)) })])];
    const svg = draw(doc);
    expect(svg).not.toContain("data-layer-template");
    expect(svg).not.toContain('opacity="0.5"');
  });
});
