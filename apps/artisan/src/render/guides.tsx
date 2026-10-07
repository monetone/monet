// ─────────────────────────────────────────────────────────────
// render/guides — ruler guides overlay (screen-space lines)
// ─────────────────────────────────────────────────────────────
// Horizontal guides span the full width at their world-y; vertical guides span
// the full height at their world-x. Rendered in the screen-coord overlay SVG.

import type { Guide, Point } from "../engine";

const GUIDE_COLOR = "var(--artisan-guide, #16d6c6)"; // cyan, like Illustrator

interface GuidesProps {
  guides: Guide[];
  show: boolean;
  worldToScreen: (p: Point) => Point;
  width: number;
  height: number;
}

export function Guides({ guides, show, worldToScreen, width, height }: GuidesProps) {
  if (!show || guides.length === 0) return null;
  return (
    <g className="artisan-guides" pointerEvents="none">
      {guides.map((g) =>
        g.orientation === "h" ? (
          (() => {
            const y = worldToScreen({ x: 0, y: g.pos }).y;
            return <line key={g.id} data-guide="h" x1={0} y1={y} x2={width} y2={y} stroke={GUIDE_COLOR} strokeWidth={1} />;
          })()
        ) : (
          (() => {
            const x = worldToScreen({ x: g.pos, y: 0 }).x;
            return <line key={g.id} data-guide="v" x1={x} y1={0} x2={x} y2={height} stroke={GUIDE_COLOR} strokeWidth={1} />;
          })()
        ),
      )}
    </g>
  );
}
