// historyLabel — derive a Develop history step's label by diffing two recipes:
// the first tracked panel that changed names the step ("Basic", "Tone Curve", …),
// matching how Lightroom labels history entries by the edited group. Pure +
// DOM-free so it's unit-tested; DevelopView records a step (with this label) each
// time a genuine edit is persisted.

import type { DevelopRecipeV2 } from "@monet-ui/monet-photo";

const PANELS: { key: keyof DevelopRecipeV2; label: string }[] = [
  { key: "basic", label: "Basic" },
  { key: "toneCurve", label: "Tone Curve" },
  { key: "colorMixer", label: "Color Mixer" },
  { key: "colorGrading", label: "Color Grading" },
  { key: "detail", label: "Detail" },
  { key: "optics", label: "Optics" },
  { key: "transform", label: "Transform" },
  { key: "effects", label: "Effects" },
  { key: "crop", label: "Crop" },
  { key: "calibration", label: "Calibration" },
  { key: "profile", label: "Profile" },
  { key: "heal", label: "Heal" },
];

/**
 * Label for the first tracked panel that differs between `prev` and `next`;
 * "Process Version" when only the PV stamp moved; "Edit" otherwise (e.g. masks).
 */
export function historyLabel(prev: DevelopRecipeV2, next: DevelopRecipeV2): string {
  for (const p of PANELS) {
    if (JSON.stringify(prev[p.key]) !== JSON.stringify(next[p.key])) return p.label;
  }
  if (prev.processVersion !== next.processVersion) return "Process Version";
  return "Edit";
}
