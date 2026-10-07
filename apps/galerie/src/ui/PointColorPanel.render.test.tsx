// PointColorPanel — panel enable switch (GAL-DEV-14). Static-markup render of
// the real component, mirroring ToneCurvePanel.render.test.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDefaultRecipe } from "@monet-ui/monet-photo";
import { PointColorPanel } from "./PointColorPanel";

const noop = () => {};
const values = createDefaultRecipe().pointColor;

const render = (extra: Partial<Parameters<typeof PointColorPanel>[0]> = {}) =>
  renderToStaticMarkup(
    <PointColorPanel values={values} onChange={noop} onReset={noop} picking={false} onPick={noop} {...extra} />,
  );

describe("panel enable switch", () => {
  it("shows a checked/unchecked switch when wired, none otherwise", () => {
    expect(render({ enabled: true, onToggleEnabled: noop })).toContain(
      'aria-checked="true" aria-label="Enable Point Color panel"',
    );
    expect(render({ enabled: false, onToggleEnabled: noop })).toContain(
      'aria-checked="false" aria-label="Enable Point Color panel"',
    );
    expect(render()).not.toContain("Enable Point Color panel");
  });

  it("dims and inerts the body when switched off, leaves it live when on", () => {
    expect(render({ enabled: false, onToggleEnabled: noop })).toContain('opacity:0.45;pointer-events:none" inert=""');
    expect(render({ enabled: true, onToggleEnabled: noop })).not.toContain("pointer-events:none");
  });
});
