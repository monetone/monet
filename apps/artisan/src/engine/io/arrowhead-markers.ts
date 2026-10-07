// ─────────────────────────────────────────────────────────────
// io/arrowhead-markers — SVG <marker> geometry for stroke arrowheads
// ─────────────────────────────────────────────────────────────
// Shared by the canvas renderer and the SVG exporter so both draw identical
// arrowheads. Each kind is a shape in a 0..10 viewBox plus the alignment point
// (refX/refY) and the marker box size in stroke-width units (markerUnits is
// always "strokeWidth", so arrowheads scale with the stroke).

import type { ArrowheadKind } from "../model/types";

export interface ArrowheadGeom {
  /** Shape path in the 0..10 marker viewBox. */
  d: string;
  /** Alignment point that sits on the path vertex. */
  refX: number;
  refY: number;
  /** Marker box size, in stroke-width units. */
  width: number;
  height: number;
}

/** Geometry for an arrowhead kind, or null for "none" / absent. */
export const arrowheadGeom = (kind: ArrowheadKind | undefined): ArrowheadGeom | null => {
  switch (kind) {
    case "triangle":
      return { d: "M0,0 L10,5 L0,10 z", refX: 9, refY: 5, width: 6, height: 6 };
    case "circle":
      return { d: "M0,5 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0 z", refX: 5, refY: 5, width: 5, height: 5 };
    case "square":
      return { d: "M0,0 H10 V10 H0 z", refX: 5, refY: 5, width: 5, height: 5 };
    case "bar":
      return { d: "M3,0 H7 V10 H3 z", refX: 5, refY: 5, width: 3, height: 6 };
    default:
      return null; // "none" or undefined
  }
};

/** Whether a stroke carries any arrowhead. */
export const hasArrowheads = (startArrow?: ArrowheadKind, endArrow?: ArrowheadKind): boolean =>
  (!!startArrow && startArrow !== "none") || (!!endArrow && endArrow !== "none");
