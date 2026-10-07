// ─────────────────────────────────────────────────────────────
// render/paint — Paint → SVG (solid colors + gradient <defs>)
// ─────────────────────────────────────────────────────────────

import { Fragment } from "react";
import { Shapes, type Item, type Paint, toCSS } from "../engine";

/** The SVG paint attribute value: "none" | css color | url(#id). */
export const paintRef = (paint: Paint, gradientId: string): string => {
  switch (paint.type) {
    case "none":
      return "none";
    case "solid":
      return toCSS({ ...paint.color, a: 1 });
    case "gradient":
    case "pattern":
      return `url(#${gradientId})`;
  }
};

/** Opacity carried by a solid paint's alpha (used for fill/stroke-opacity). */
export const paintOpacity = (paint: Paint): number => (paint.type === "solid" ? paint.color.a : 1);

/** Gradient definition element for a gradient paint (else null). */
export function GradientDef({ paint, id, item }: { paint: Paint; id: string; item: Item }) {
  if (paint.type !== "gradient") return null;
  const g = paint.gradient;
  const b = Shapes.localBounds(item);
  const userSpace = Math.abs(b.width) < 1e-6 || Math.abs(b.height) < 1e-6;
  const x = (v: number) => (userSpace ? b.x + v * b.width : v);
  const y = (v: number) => (userSpace ? b.y + v * b.height : v);
  const spread = g.spread && g.spread !== "pad" ? g.spread : undefined;
  const stops = g.stops.map((s, i) => (
    <stop key={i} offset={s.offset} stopColor={toCSS({ ...s.color, a: 1 })} stopOpacity={s.color.a} />
  ));
  if (g.type === "linear") {
    return (
      <linearGradient id={id} gradientUnits={userSpace ? "userSpaceOnUse" : "objectBoundingBox"} x1={x(g.x1)} y1={y(g.y1)} x2={x(g.x2)} y2={y(g.y2)} spreadMethod={spread}>
        {stops}
      </linearGradient>
    );
  }
  return (
    <radialGradient
      id={id}
      gradientUnits={userSpace ? "userSpaceOnUse" : "objectBoundingBox"}
      cx={x(g.cx)}
      cy={y(g.cy)}
      r={userSpace ? g.r * Math.max(Math.abs(b.width), Math.abs(b.height)) : g.r}
      fx={x(g.fx ?? g.cx)}
      fy={y(g.fy ?? g.cy)}
      spreadMethod={spread}
    >
      {stops}
    </radialGradient>
  );
}

/** Both fill + stroke gradient defs for an item, if any. */
export function ItemDefs({ item, fill, stroke, fillId, strokeId }: { item: Item; fill: Paint; stroke: Paint; fillId: string; strokeId: string }) {
  const needFill = fill.type === "gradient";
  const needStroke = stroke.type === "gradient";
  if (!needFill && !needStroke) return null;
  return (
    <Fragment>
      {needFill && <GradientDef paint={fill} id={fillId} item={item} />}
      {needStroke && <GradientDef paint={stroke} id={strokeId} item={item} />}
    </Fragment>
  );
}
