// DevelopPanels spec ↔ recipe invariants. These panels write `int * scale` into
// recipe sub-panels that recipeToParams then serializes to the engine ABI. Two
// silent-failure modes to guard: (1) a spec key that isn't a real recipe field
// (a typo → writes a dead property the engine never reads), and (2) a double-
// click `neutral` that doesn't match the field's actual neutral default (reset
// lands on the wrong value, e.g. Radius→0 instead of 1).

import { describe, expect, it } from "vitest";

import { createDefaultRecipe, type DevelopRecipeV2 } from "@monet-ui/monet-photo";
import {
  CALIBRATION_SECTIONS,
  DETAIL_SECTIONS,
  EFFECTS_SECTIONS,
  GRADE_ZONES,
  HSL_BANDS,
  MIXER_CHANNELS,
  OPTICS_SECTIONS,
  OPTICS_TOGGLES,
  TRANSFORM_SECTIONS,
  type Section,
  type ToggleSpec,
} from "./DevelopPanels";

const PANELS: { name: keyof DevelopRecipeV2; sections: Section[]; toggles?: ToggleSpec[] }[] = [
  { name: "detail", sections: DETAIL_SECTIONS },
  { name: "effects", sections: EFFECTS_SECTIONS },
  { name: "optics", sections: OPTICS_SECTIONS, toggles: OPTICS_TOGGLES },
  { name: "transform", sections: TRANSFORM_SECTIONS },
  { name: "calibration", sections: CALIBRATION_SECTIONS },
];

describe("Develop panel specs ↔ recipe defaults", () => {
  const d = createDefaultRecipe();

  for (const { name, sections, toggles } of PANELS) {
    const panel = d[name] as Record<string, number | boolean>;

    for (const s of sections.flatMap((sec) => sec.specs)) {
      it(`${String(name)}.${s.key}: real numeric field, neutral matches default`, () => {
        expect(panel).toHaveProperty(s.key);
        expect(typeof panel[s.key]).toBe("number");
        expect(panel[s.key]).toBe(s.neutral ?? 0);
      });
    }

    for (const t of toggles ?? []) {
      it(`${String(name)}.${t.key}: real numeric field, defaults off (0)`, () => {
        expect(panel).toHaveProperty(t.key);
        // The toggle maps checked→1 / unchecked→0 onto a continuous field.
        expect(typeof panel[t.key]).toBe("number");
        expect(panel[t.key]).toBe(0);
      });
    }
  }
});

describe("Color Mixer channels ↔ recipe bands", () => {
  const cm = createDefaultRecipe().colorMixer as unknown as Record<string, number[]>;

  it("has the 8 ACR hue bands", () => {
    expect(HSL_BANDS).toHaveLength(8);
  });

  for (const c of MIXER_CHANNELS) {
    it(`channel "${c.key}" maps to an 8-band, all-zero default array`, () => {
      expect(Array.isArray(cm[c.key])).toBe(true);
      expect(cm[c.key]).toHaveLength(HSL_BANDS.length);
      expect(cm[c.key].every((x) => x === 0)).toBe(true);
    });
  }
});

describe("Color Grading zones ↔ recipe wheels", () => {
  const cg = createDefaultRecipe().colorGrading as unknown as Record<string, { hue: number; sat: number }>;

  for (const z of GRADE_ZONES) {
    it(`zone "${z.key}" maps to a wheel with neutral hue/sat`, () => {
      expect(cg[z.key]).toBeDefined();
      expect(cg[z.key].hue).toBe(0);
      expect(cg[z.key].sat).toBe(0);
    });
  }
});
