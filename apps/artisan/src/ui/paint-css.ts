// Paint → CSS background for swatch previews.
import { type CSSProperties } from "react";
import { type Paint, toCSS } from "../engine";

export function paintBackground(paint: Paint): CSSProperties {
  switch (paint.type) {
    case "none":
      return {
        background:
          "linear-gradient(45deg, transparent 47%, #e0573a 47%, #e0573a 53%, transparent 53%), var(--glass-0)",
      };
    case "solid":
      return { background: toCSS(paint.color) };
    case "gradient": {
      const stops = paint.gradient.stops
        .map((s) => `${toCSS({ ...s.color, a: 1 })} ${Math.round(s.offset * 100)}%`)
        .join(", ");
      const css =
        paint.gradient.type === "radial"
          ? `radial-gradient(circle, ${stops})`
          : `linear-gradient(90deg, ${stops})`;
      return { background: css };
    }
    case "pattern":
      // checker preview — patterns can't be a flat CSS background
      return {
        background:
          "repeating-conic-gradient(var(--text-3) 0% 25%, transparent 0% 50%) 0 / 12px 12px, var(--glass-0)",
      };
  }
}
