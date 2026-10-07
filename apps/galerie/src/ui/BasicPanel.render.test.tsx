// BasicPanel — panel enable switch (GAL-DEV-14). Static-markup render of the
// real component, mirroring ToneCurvePanel.render.test.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDefaultRecipe } from "@monet-ui/monet-photo";
import { BasicPanel } from "./BasicPanel";

const noop = () => {};
const basic = createDefaultRecipe().basic;

const render = (extra: Partial<Parameters<typeof BasicPanel>[0]> = {}) =>
  renderToStaticMarkup(<BasicPanel basic={basic} onChange={noop} onAuto={noop} onReset={noop} {...extra} />);

describe("panel enable switch", () => {
  it("shows a checked/unchecked switch when wired, none otherwise", () => {
    expect(render({ enabled: true, onToggleEnabled: noop })).toContain(
      'aria-checked="true" aria-label="Enable Basic panel"',
    );
    expect(render({ enabled: false, onToggleEnabled: noop })).toContain(
      'aria-checked="false" aria-label="Enable Basic panel"',
    );
    expect(render()).not.toContain("Enable Basic panel");
  });

  it("dims and inerts the section list when switched off, leaves it live when on", () => {
    expect(render({ enabled: false, onToggleEnabled: noop })).toContain('opacity:0.45;pointer-events:none" inert=""');
    expect(render({ enabled: true, onToggleEnabled: noop })).not.toContain("pointer-events:none");
  });
});
