// ─────────────────────────────────────────────────────────────
// ui/stroke-dash — build a stroke dash array from the panel's dash/gap fields
// ─────────────────────────────────────────────────────────────
// Illustrator's Stroke panel offers multiple dash-gap pairs for patterns like
// "long dash, short dash". We expose two pairs; an all-zero second pair collapses
// back to a single pair so the array stays clean (and SVG renders just one pair).

/** A dash array from two dash/gap pairs. Drops the second pair when it is 0/0. */
export const dashPattern = (dash1: number, gap1: number, dash2: number, gap2: number): number[] =>
  dash2 === 0 && gap2 === 0 ? [dash1, gap1] : [dash1, gap1, dash2, gap2];
