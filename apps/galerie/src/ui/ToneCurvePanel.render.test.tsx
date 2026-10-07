// ToneCurvePanel — split-point triangles, TAT toggle and point-curve preset
// menu (GAL-DEV-13). Static-markup renders of the real component, like
// HistogramGraph.render.test.tsx.
import type { SelectProps } from "@monet-ui/monet-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createDefaultRecipe, TONE_CURVE_PRESETS } from "@monet-ui/monet-photo";
import { ToneCurvePanel } from "./ToneCurvePanel";

// A Select's options render only while its list is open: record what each one offers.
const offered = vi.hoisted(() => new Map<string, string[]>());
vi.mock("@monet-ui/monet-react", async (importOriginal) => {
  const real = await importOriginal<typeof import("@monet-ui/monet-react")>();
  return { ...real, Select: (p: SelectProps) => { offered.set(p["aria-label"] ?? "", p.options.map((o) => o.value)); return <real.Select {...p} />; } };
});

const noop = () => {};

const render = (extra: Partial<Parameters<typeof ToneCurvePanel>[0]> = {}, toneCurve = createDefaultRecipe().toneCurve) =>
  renderToStaticMarkup(
    <ToneCurvePanel values={toneCurve} onChange={noop} onParametricChange={noop} onReset={noop} {...extra} />,
  );

describe("split points", () => {
  it("renders the three region triangles at the stored splits when wired", () => {
    const tc = { ...createDefaultRecipe().toneCurve, parametricSplits: [0.2, 0.5, 0.8] as [number, number, number] };
    const html = render({ onSplitsChange: noop }, tc);
    expect(html).toContain('aria-label="Parametric region split points"');
    for (const label of ["Shadow split", "Midtone split", "Highlight split"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('aria-valuenow="20"');
    expect(html).toContain('aria-valuenow="80"');
  });

  it("hides the strip when the recipe callback is not wired", () => {
    expect(render()).not.toContain("Parametric region split points");
  });
});

describe("targeted adjustment tool", () => {
  it("shows a pressed/unpressed TAT toggle when wired, none otherwise", () => {
    expect(render({ onToggleTat: noop, tatActive: true })).toContain('aria-pressed="true"');
    expect(render({ onToggleTat: noop, tatActive: false })).toContain('aria-pressed="false"');
    expect(render()).not.toContain("aria-pressed");
  });
});

describe("panel enable switch", () => {
  it("shows a checked/unchecked switch when wired, none otherwise", () => {
    expect(render({ enabled: true, onToggleEnabled: noop })).toContain(
      'aria-checked="true" aria-label="Enable Tone Curve panel"',
    );
    expect(render({ enabled: false, onToggleEnabled: noop })).toContain(
      'aria-checked="false" aria-label="Enable Tone Curve panel"',
    );
    expect(render()).not.toContain("Enable Tone Curve panel");
  });

  it("dims and inerts the body when switched off, leaves it live when on", () => {
    expect(render({ enabled: false, onToggleEnabled: noop })).toContain('opacity:0.45;pointer-events:none" inert=""');
    expect(render({ enabled: true, onToggleEnabled: noop })).not.toContain("pointer-events:none");
  });
});

describe("point-curve presets", () => {
  it("offers every preset and selects Linear for the default (identity) recipe", () => {
    const html = render();
    const linear = TONE_CURVE_PRESETS.find((p) => p.id === "linear")!;
    expect(offered.get("Point curve preset")).toEqual(TONE_CURVE_PRESETS.map((p) => p.id));
    expect(html).toContain('data-value="linear"');
    expect(html).toContain(`>${linear.label}</span>`);
    expect(html).not.toContain("Custom");
  });

  it("falls back to a Custom entry for a hand-edited curve", () => {
    const tc = createDefaultRecipe().toneCurve;
    tc.point = [{ x: 0, y: 0 }, { x: 0.4, y: 0.6 }, { x: 1, y: 1 }];
    const html = render({}, tc);
    expect(offered.get("Point curve preset")).toEqual([...TONE_CURVE_PRESETS.map((p) => p.id), "custom"]);
    expect(html).toContain('data-value="custom"');
    expect(html).toContain(">Custom</span>");
  });
});
