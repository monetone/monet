// ─────────────────────────────────────────────────────────────
// ui/color-convert — bridge engine color/gradient ⇄ Monet color types
// ─────────────────────────────────────────────────────────────

import type { ColorValue, GradientValue, HSV } from "@monet-ui/monet-react";
import { type Gradient, type RGBA, fromHex, hsvToRgb, toHex } from "../engine";

export const colorValueToRgba = (cv: ColorValue): RGBA => {
  if (typeof cv === "string") return fromHex(cv);
  return hsvToRgb({ h: cv.h, s: cv.s, v: cv.v }, cv.a ?? 1);
};

export const hsvToRgba = (hsv: HSV): RGBA => hsvToRgb({ h: hsv.h, s: hsv.s, v: hsv.v }, hsv.a ?? 1);

// GradientValue is the one gradient model shared with Vision, so these converters
// carry Artisan's richer geometry (radial centre/radius, focal point, spread,
// per-stop midpoints) rather than just type/angle/stops — otherwise every edit in
// the shared editor would silently reset it. Vision's sweep kinds ride in `sweep`.
export const gradientToMonet = (g: Gradient): GradientValue => ({
  type: g.sweep ?? g.type,
  angle: Math.round((Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180) / Math.PI),
  stops: g.stops.map((s, i) => ({ id: `s${i}`, offset: s.offset, color: toHex(s.color, true), midpoint: s.midpoint })),
  cx: g.cx,
  cy: g.cy,
  r: g.r,
  fx: g.fx,
  fy: g.fy,
  spread: g.spread,
});

export const monetToGradient = (gv: GradientValue): Gradient => {
  const rad = (gv.angle * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  const sweep = gv.type === "linear" || gv.type === "radial" ? undefined : gv.type;
  return {
    // A sweep has no vector equivalent — draw it as linear, keep the kind in `sweep`.
    type: gv.type === "radial" ? "radial" : "linear",
    sweep,
    stops: [...gv.stops]
      .sort((a, b) => a.offset - b.offset)
      .map((s) => ({ offset: s.offset, color: colorValueToRgba(s.color), midpoint: s.midpoint })),
    x1: 0.5 - dx,
    y1: 0.5 - dy,
    x2: 0.5 + dx,
    y2: 0.5 + dy,
    cx: gv.cx ?? 0.5,
    cy: gv.cy ?? 0.5,
    r: gv.r ?? 0.5,
    fx: gv.fx,
    fy: gv.fy,
    spread: gv.spread,
  };
};
