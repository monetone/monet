// MasksPanel.brush.test — GAL-MASK-08: the brush editor exposes Auto Mask and
// Feather, wired to the stored BrushComponent (the fields maskRender honors),
// not just the transient BrushSettings. Render smoke via static markup, same
// pattern as KeywordsBar.render.test.tsx.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createMask, type BrushComponent, type Mask } from "@monet-ui/monet-photo";

import type { BrushSettings } from "../lib/maskEdit";
import { MasksPanel } from "./MasksPanel";

const brushComp = (over: Partial<BrushComponent> = {}): BrushComponent => ({
  kind: "brush",
  id: "b1",
  combine: "add",
  invert: false,
  dabs: [],
  autoMask: false,
  ...over,
});

const settings: BrushSettings = { radius: 0.05, flow: 1, density: 1, erase: false };

const render = (mask: Mask) =>
  renderToStaticMarkup(
    <MasksPanel
      masks={[mask]}
      selectedId={mask.id}
      selectedComponentId="b1"
      onSelectComponent={() => {}}
      onAddComponent={() => {}}
      onAdd={() => {}}
      onSelect={() => {}}
      onDelete={() => {}}
      onChange={() => {}}
      brushSettings={settings}
      onBrushSettingsChange={() => {}}
    />,
  );

describe("MasksPanel brush editor (GAL-MASK-08)", () => {
  it("renders an Auto Mask checkbox reflecting the component state", () => {
    const off = render(createMask("m1", "Brush 1", brushComp()));
    expect(off).toContain("Auto Mask");
    const on = render(createMask("m1", "Brush 1", brushComp({ autoMask: true })));
    // Checked state must come from the stored component, so the two differ.
    expect(on).not.toEqual(off);
  });

  it("renders a Feather slider defaulting to 100 when the component has none", () => {
    const html = render(createMask("m1", "Brush 1", brushComp()));
    expect(html).toContain("Feather");
    expect(html).toContain(">100<"); // feather ?? 1 → 100 in the value cell
  });

  it("shows the component's stored feather value", () => {
    const html = render(createMask("m1", "Brush 1", brushComp({ feather: 0.25 })));
    expect(html).toContain(">25<");
  });
});
