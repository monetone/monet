// quickDevelop — pure math for the Library Quick Develop panel. LR semantics:
// each button applies a RELATIVE step to every selected photo's existing recipe
// (unlike Develop's absolute sliders), so a mixed selection keeps its per-photo
// differences. Values live in the shared scaled recipe domain (sliderInt ×
// scale, ±100 int range — see BasicPanel.tsx / Vision CameraRawWorkspace).

import type { BasicPanel, DevelopRecipeV2 } from "@monet-ui/monet-photo";

export type QuickKey =
  | "temp" | "tint" | "exposure" | "contrast" | "highlights" | "shadows"
  | "whites" | "blacks" | "clarity" | "vibrance" | "saturation";

export interface QuickSpec {
  key: QuickKey;
  label: string;
  scale: number;
  /** Step sizes in UI-int units (±100 domain). */
  small: number;
  big: number;
}

// LR Classic's Quick Develop row set (no Texture/Dehaze rows). Exposure steps
// mirror LR's ⅓ EV / 1 EV: at scale 0.04, int 8 ≈ 0.32 EV and int 25 = 1 EV.
export const QUICK_SPECS: QuickSpec[] = [
  { key: "temp", label: "Temp", scale: 0.01, small: 5, big: 20 },
  { key: "tint", label: "Tint", scale: 0.01, small: 5, big: 20 },
  { key: "exposure", label: "Exposure", scale: 0.04, small: 8, big: 25 },
  { key: "contrast", label: "Contrast", scale: 0.01, small: 5, big: 20 },
  { key: "highlights", label: "Highlights", scale: 0.01, small: 5, big: 20 },
  { key: "shadows", label: "Shadows", scale: 0.01, small: 5, big: 20 },
  { key: "whites", label: "Whites", scale: 0.01, small: 5, big: 20 },
  { key: "blacks", label: "Blacks", scale: 0.01, small: 5, big: 20 },
  { key: "clarity", label: "Clarity", scale: 0.01, small: 5, big: 20 },
  { key: "vibrance", label: "Vibrance", scale: 0.01, small: 5, big: 20 },
  { key: "saturation", label: "Saturation", scale: 0.01, small: 5, big: 20 },
];

const SPEC_BY_KEY = new Map(QUICK_SPECS.map((spec) => [spec.key, spec]));

/** One relative Quick Develop step; returns a new recipe, input untouched. */
export function quickStep(
  recipe: DevelopRecipeV2,
  key: QuickKey,
  direction: 1 | -1,
  big: boolean,
): DevelopRecipeV2 {
  const spec = SPEC_BY_KEY.get(key);
  if (!spec) throw new Error(`unknown Quick Develop key: ${key}`);
  const current = Math.round(recipe.basic[key] / spec.scale);
  const stepped = Math.max(
    -100,
    Math.min(100, current + direction * (big ? spec.big : spec.small)),
  );
  return { ...recipe, basic: { ...recipe.basic, [key]: stepped * spec.scale } };
}

/** Reset every Quick Develop-controlled Basic field to neutral (0). */
export function quickReset(recipe: DevelopRecipeV2): DevelopRecipeV2 {
  const basic: BasicPanel = { ...recipe.basic };
  for (const spec of QUICK_SPECS) basic[spec.key] = 0;
  return { ...recipe, basic };
}
