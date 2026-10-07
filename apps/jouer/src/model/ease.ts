// ─────────────────────────────────────────────────────────────
// ease.ts — pure easing samplers for the editor's own timeline scrubbing, plus
// the Phaser ease-string each maps to for code export. Keeping the samplers in
// TS (rather than reaching for Phaser.Math.Easing) lets the model + anim-runtime
// stay framework-free and unit-testable in node.
//
// Each fn maps t ∈ [0,1] → eased ∈ [0,1] (over/undershoot allowed for back/
// elastic/bounce). `phaser` is the string passed to a Phaser tween's `ease`.
// ─────────────────────────────────────────────────────────────

import type { EaseId } from "./types";

export interface EaseDef {
  id: EaseId;
  label: string;
  /** Phaser tween `ease` string. "hold" has no Phaser ease (stepped). */
  phaser: string;
  fn: (t: number) => number;
}

const PI = Math.PI;

const sineIn = (t: number) => 1 - Math.cos((t * PI) / 2);
const sineOut = (t: number) => Math.sin((t * PI) / 2);
const sineInOut = (t: number) => -(Math.cos(PI * t) - 1) / 2;

const quadIn = (t: number) => t * t;
const quadOut = (t: number) => 1 - (1 - t) * (1 - t);
const quadInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const cubicIn = (t: number) => t * t * t;
const cubicOut = (t: number) => 1 - Math.pow(1 - t, 3);
const cubicInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const quartInOut = (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);

const expoOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

const C1 = 1.70158;
const C2 = C1 * 1.525;
const C3 = C1 + 1;
const backIn = (t: number) => C3 * t * t * t - C1 * t * t;
const backOut = (t: number) => 1 + C3 * Math.pow(t - 1, 3) + C1 * Math.pow(t - 1, 2);
const backInOut = (t: number) =>
  t < 0.5
    ? (Math.pow(2 * t, 2) * ((C2 + 1) * 2 * t - C2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((C2 + 1) * (t * 2 - 2) + C2) + 2) / 2;

// Match Phaser's Elastic.Out with its defaults (amplitude 0.1 → clamped to 1,
// period 0.1 → s = period/4 = 0.025) so the editor preview is identical to the
// exported `ease: 'Elastic.easeOut'` tween. (The easings.net period-0.3 curve
// looks gentler but diverges sharply from the generated game.)
const ELASTIC_PERIOD = 0.1;
const ELASTIC_S = ELASTIC_PERIOD / 4;
const elasticOut = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin(((t - ELASTIC_S) * (2 * PI)) / ELASTIC_PERIOD) + 1;

const bounceOut = (t: number) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

export const EASES: EaseDef[] = [
  { id: "linear", label: "Linear", phaser: "Linear", fn: (t) => t },
  { id: "hold", label: "Hold (step)", phaser: "Stepped", fn: (t) => (t >= 1 ? 1 : 0) },
  { id: "sineIn", label: "Sine In", phaser: "Sine.easeIn", fn: sineIn },
  { id: "sineOut", label: "Sine Out", phaser: "Sine.easeOut", fn: sineOut },
  { id: "sineInOut", label: "Sine In/Out", phaser: "Sine.easeInOut", fn: sineInOut },
  { id: "quadIn", label: "Quad In", phaser: "Quad.easeIn", fn: quadIn },
  { id: "quadOut", label: "Quad Out", phaser: "Quad.easeOut", fn: quadOut },
  { id: "quadInOut", label: "Quad In/Out", phaser: "Quad.easeInOut", fn: quadInOut },
  { id: "cubicIn", label: "Cubic In", phaser: "Cubic.easeIn", fn: cubicIn },
  { id: "cubicOut", label: "Cubic Out", phaser: "Cubic.easeOut", fn: cubicOut },
  { id: "cubicInOut", label: "Cubic In/Out", phaser: "Cubic.easeInOut", fn: cubicInOut },
  { id: "quartInOut", label: "Quart In/Out", phaser: "Quart.easeInOut", fn: quartInOut },
  { id: "expoOut", label: "Expo Out", phaser: "Expo.easeOut", fn: expoOut },
  { id: "backIn", label: "Back In", phaser: "Back.easeIn", fn: backIn },
  { id: "backOut", label: "Back Out", phaser: "Back.easeOut", fn: backOut },
  { id: "backInOut", label: "Back In/Out", phaser: "Back.easeInOut", fn: backInOut },
  { id: "elasticOut", label: "Elastic Out", phaser: "Elastic.easeOut", fn: elasticOut },
  { id: "bounceOut", label: "Bounce Out", phaser: "Bounce.easeOut", fn: bounceOut },
];

const EASE_BY_ID: Record<string, EaseDef> = Object.fromEntries(EASES.map((e) => [e.id, e]));

/** The set of valid EaseId strings — used by the .jouer loader to validate
 *  externally-sourced ease ids (the only enum the parser must guard). */
export const EASE_IDS: ReadonlySet<string> = new Set(EASES.map((e) => e.id));

export function isEaseId(id: string): id is EaseId {
  return EASE_IDS.has(id);
}

export function easeFn(id: EaseId): (t: number) => number {
  return (EASE_BY_ID[id] ?? EASES[0]).fn;
}

export function phaserEase(id: EaseId): string {
  return (EASE_BY_ID[id] ?? EASES[0]).phaser;
}
