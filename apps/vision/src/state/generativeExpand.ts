// Pure geometry for Generative Expand (outpainting): given the current canvas
// size, an expansion amount, and which sides to grow, return the target canvas
// size and the offset that re-anchors the original inside it — matching the
// engine's resize_canvas(nw, nh, dx, dy) contract. No engine/DOM, so it's
// unit-testable and shared by the Neural Filters dialog.
export type ExpandSides = "all" | "horizontal" | "vertical" | "left" | "right" | "top" | "bottom";

export function expandGeometry(
  w: number,
  h: number,
  amount: number,
  sides: ExpandSides,
): { nw: number; nh: number; dx: number; dy: number } {
  const a = Math.max(0, Math.round(amount));
  const L = sides === "all" || sides === "horizontal" || sides === "left" ? a : 0;
  const R = sides === "all" || sides === "horizontal" || sides === "right" ? a : 0;
  const T = sides === "all" || sides === "vertical" || sides === "top" ? a : 0;
  const B = sides === "all" || sides === "vertical" || sides === "bottom" ? a : 0;
  return { nw: w + L + R, nh: h + T + B, dx: L, dy: T };
}
