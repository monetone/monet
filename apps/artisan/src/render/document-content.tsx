// ─────────────────────────────────────────────────────────────
// render/document-content — world-space SVG content (artboards + items)
// ─────────────────────────────────────────────────────────────
// Rendered inside the viewport's transformed <g>, so everything here is in
// document/world coordinates.

import { memo } from "react";
import type { Artboard, Document } from "../engine";
import { ItemNode } from "./item-node";

/** Artboard "paper" backgrounds. Kept separate + memoized so the grid can be
 *  rendered between the paper and the artwork (canvas-view) without coupling the
 *  expensive item tree (DocumentContent) to view-dependent grid changes. */
export const ArtboardBackgrounds = memo(function ArtboardBackgrounds({ artboards, outline = false }: { artboards: Artboard[]; outline?: boolean }) {
  return (
    <>
      {artboards.map((ab) => (
        <rect
          key={ab.id}
          className="artisan-artboard"
          data-artboard={ab.id}
          x={ab.x}
          y={ab.y}
          width={ab.width}
          height={ab.height}
          fill={outline ? "none" : "var(--artisan-artboard-bg, #ffffff)"}
          stroke={outline ? "var(--accent-vector,#4a9eff)" : "rgba(0,0,0,0.18)"}
          strokeWidth={outline ? 1 : 0.5}
          vectorEffect={outline ? "non-scaling-stroke" : undefined}
          style={outline ? undefined : { filter: "drop-shadow(0 4px 24px rgba(0,0,0,0.35))" }}
        />
      ))}
    </>
  );
});

interface Props {
  doc: Document;
  outline?: boolean;
  /** Item id to omit from rendering (e.g. a text item being edited inline). */
  hideId?: string;
  /** Currently selected slice id (drawn highlighted). */
  selectedSlice?: string;
}

export const DocumentContent = memo(function DocumentContent({ doc, outline = false, hideId, selectedSlice }: Props) {
  return (
    <>
      {/* Layers bottom→top; items bottom→top within each. */}
      {doc.layers.map((layer) => {
        // Template layers render DIMMED in the editor (a faded tracing reference);
        // they are excluded from export entirely (non-printing) — see io/svg.
        const eff = layer.template ? layer.opacity * 0.5 : layer.opacity;
        return layer.visible ? (
          <g
            key={layer.id}
            data-layer-template={layer.template ? "true" : undefined}
            opacity={eff !== 1 ? eff : undefined}
            style={layer.blendMode !== "normal" ? { mixBlendMode: layer.blendMode } : undefined}
          >
            {layer.items.map((item) => (item.id === hideId ? null : <ItemNode key={item.id} item={item} outline={outline} />))}
          </g>
        ) : null;
      })}
      {/* Export slices (non-scaling overlay). */}
      {(doc.slices ?? []).map((s, i) => (
        <g key={s.id}>
          <rect
            x={s.x}
            y={s.y}
            width={s.width}
            height={s.height}
            fill="none"
            stroke={s.id === selectedSlice ? "var(--accent-vector,#4a9eff)" : "rgba(120,180,255,0.7)"}
            strokeWidth={s.id === selectedSlice ? 1.5 : 1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          <text x={s.x + 3} y={s.y + 12} fontSize={10} fill="rgba(120,180,255,0.9)" style={{ fontFamily: "var(--font-mono,monospace)" }}>
            {String(i + 1).padStart(2, "0")}
          </text>
        </g>
      ))}
    </>
  );
});
