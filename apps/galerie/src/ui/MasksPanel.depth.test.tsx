// MasksPanel.depth.test — GAL-MASK-07: Depth Range mask coverage is real (the
// mask math is paid for — maskRender.depth.test.ts, in monet-photo), but
// Galerie has no depth ingest (no importer decodes an iPhone Portrait HEIC
// auxiliary image, engine.ts never populates RenderedFrame.depth — see
// maskComposite.ts). Offering "+ Depth" unconditionally let a user pick a
// mask that always selects zero pixels. The fix: "+ Depth" is disabled unless
// the caller says depth data actually exists for this photo (`hasDepth`),
// same render-smoke pattern as MasksPanel.brush.test.tsx.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createMask, type LinearGradientComponent, type Mask } from "@monet-ui/monet-photo";

import { MasksPanel } from "./MasksPanel";

const gradComp: LinearGradientComponent = {
  kind: "linearGradient",
  id: "g1",
  combine: "add",
  invert: false,
  x1: 0.5,
  y1: 0.15,
  x2: 0.5,
  y2: 0.55,
};

const mask: Mask = createMask("m1", "Gradient 1", gradComp);

const render = (hasDepth?: boolean) =>
  renderToStaticMarkup(
    <MasksPanel
      masks={[mask]}
      selectedId={mask.id}
      selectedComponentId="g1"
      onSelectComponent={() => {}}
      onAddComponent={() => {}}
      onAdd={() => {}}
      onSelect={() => {}}
      onDelete={() => {}}
      onChange={() => {}}
      hasDepth={hasDepth}
    />,
  );

/** Button markup renders as `<button ...>...<span class="monet-btn-label">+
 *  Depth</span></button>` — grab the nearest enclosing `<button>` for the
 *  "+ Depth" label so assertions can check its `disabled`/`title`. */
const depthButton = (html: string): string => {
  const labelAt = html.indexOf("+ Depth");
  const start = html.lastIndexOf("<button", labelAt);
  const end = html.indexOf("</button>", labelAt) + "</button>".length;
  return html.slice(start, end);
};

describe("MasksPanel + Depth button (GAL-MASK-07)", () => {
  it("is disabled when the caller doesn't say depth data exists (default false)", () => {
    const html = render(undefined);
    expect(html).toContain("+ Depth"); // sanity: the button is present
    const btn = depthButton(html);
    expect(btn).toContain("disabled");
    expect(btn).toContain("No depth data for this photo");
  });

  it("is disabled when hasDepth is explicitly false", () => {
    expect(depthButton(render(false))).toContain("disabled");
  });

  it("is enabled, with the plain title, when hasDepth is true", () => {
    const btn = depthButton(render(true));
    expect(btn).not.toContain("disabled");
    expect(btn).toContain('title="Depth Range"');
  });
});
