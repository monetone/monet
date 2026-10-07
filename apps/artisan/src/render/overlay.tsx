// ─────────────────────────────────────────────────────────────
// render/overlay — selection outlines (world) + handles (screen)
// ─────────────────────────────────────────────────────────────

import { Fragment } from "react";
import { Mat, Path as P, type Point, Query, type Rect, Shapes, type Document } from "../engine";
import { handlesForBounds } from "../tools/handles";

const ACCENT = "var(--accent-vector, #4a9eff)";

/** Outline of each selected item, drawn inside the world <g> (non-scaling stroke).
 *  `hideId` (the text item being edited) is skipped: the inline editor's own
 *  dashed box is its selection chrome, so drawing the AABB too would double it. */
export function SelectionOutlines({ doc, selection, hideId, keyId }: { doc: Document; selection: string[]; hideId?: string; keyId?: string | null }) {
  if (selection.length === 0) return null;
  const nodes: React.ReactNode[] = [];
  for (const id of selection) {
    if (id === hideId) continue;
    const loc = Query.findItem(doc, id);
    if (!loc) continue;
    // The Align "Key Object" gets a heavier outline so it reads as the anchor of
    // the alignment (Illustrator parity).
    const isKey = id === keyId;
    const sw = isKey ? 2.5 : 1;
    const keyAttr = isKey ? "true" : undefined;
    const world = Query.worldTransformAt(loc);
    const paths = Shapes.localPaths(loc.item);
    if (paths.length) {
      const d = paths.map((pg) => P.toSVGPath(P.transform(pg, world))).join(" ");
      nodes.push(
        <path key={id} data-key-object={keyAttr} d={d} fill="none" stroke={ACCENT} strokeWidth={sw} vectorEffect="non-scaling-stroke" />,
      );
    } else {
      // groups / text / image → outline the world AABB
      const b = Query.worldBounds(doc, id);
      if (b) {
        nodes.push(
          <rect key={id} data-key-object={keyAttr} x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke={ACCENT} strokeWidth={sw} vectorEffect="non-scaling-stroke" />,
        );
      }
    }
  }
  return <g className="artisan-sel-outline">{nodes}</g>;
}

/** Bounding-box handles, drawn in SCREEN space over the canvas. */
export function SelectionHandles({
  bounds,
  worldToScreen,
  rotatable = true,
}: {
  bounds: Rect | null;
  worldToScreen: (p: Point) => Point;
  rotatable?: boolean;
}) {
  if (!bounds) return null;
  const h = handlesForBounds(bounds, worldToScreen);
  const r = h.rectScreen;
  const sz = 7;
  const half = sz / 2;
  const handlePts = Object.entries(h.screen).filter(([k]) => k !== "rot") as [string, Point][];
  return (
    <g className="artisan-handles" pointerEvents="none">
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={ACCENT} strokeWidth={1} />
      {rotatable && (
        <Fragment>
          <line x1={h.screen.n.x} y1={h.screen.n.y} x2={h.screen.rot.x} y2={h.screen.rot.y} stroke={ACCENT} strokeWidth={1} />
          <circle cx={h.screen.rot.x} cy={h.screen.rot.y} r={4} fill="#fff" stroke={ACCENT} strokeWidth={1.25} />
        </Fragment>
      )}
      {handlePts.map(([k, p]) => (
        <rect key={k} x={p.x - half} y={p.y - half} width={sz} height={sz} fill="#fff" stroke={ACCENT} strokeWidth={1.25} />
      ))}
    </g>
  );
}

export { handlesForBounds };
