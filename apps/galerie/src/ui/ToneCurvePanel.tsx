// ToneCurvePanel — the Develop Tone Curve point editor (master RGB + per-channel
// Red/Green/Blue). Points are canonical (recipe.toneCurve); the smooth curve is
// drawn from the engine's compiled LUT (monet-photo buildLut) so the preview
// matches what recipeToParams ships to the engine. Drag a point to move it,
// click empty space to add one, double-click a point to remove it. All editing
// math lives in lib/toneCurveEdit (unit-tested); this view only maps pixels ↔
// the normalized 0..1 curve space.

import { Button, Select } from "@monet-ui/monet-react";
import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

import { DevRow } from "./DevRow";
import { PanelBody, PanelHead, type PanelEnableProps } from "./DevelopPanels";

import {
  buildLut,
  DEFAULT_PARAMETRIC_SPLITS,
  masterToneLut,
  matchToneCurvePreset,
  TONE_CURVE_PRESETS,
  type CurvePoint,
  type ToneCurvePanel as ToneCurveParams,
} from "@monet-ui/monet-photo";
import { insertPoint, movePoint, nearestPoint, removePoint } from "../lib/toneCurveEdit";

const CHANNELS = [
  { key: "point", label: "RGB" },
  { key: "red", label: "Red" },
  { key: "green", label: "Green" },
  { key: "blue", label: "Blue" },
] as const;
type CurveChannel = (typeof CHANNELS)[number]["key"];

type ParamKey = keyof ToneCurveParams["parametric"];
const PARAM_ROWS: { key: ParamKey; label: string }[] = [
  { key: "highlights", label: "Highlights" },
  { key: "lights", label: "Lights" },
  { key: "darks", label: "Darks" },
  { key: "shadows", label: "Shadows" },
];

const HIT_TOL = 0.06;

/** SVG path (viewBox 0..100) for a compiled 256-entry LUT, y-flipped (output up). */
function curvePath(lut: Uint8Array): string {
  let d = "";
  for (let i = 0; i < lut.length; i++) {
    const x = (i / (lut.length - 1)) * 100;
    const y = (1 - lut[i] / 255) * 100;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d.trim();
}

// Keep a dragged split inside its neighbours with a minimum region width, so
// regions can never collapse or cross.
const SPLIT_GAP = 0.05;

export function ToneCurvePanel({
  values,
  onChange,
  onParametricChange,
  onSplitsChange,
  onReset,
  tatActive,
  onToggleTat,
  enabled,
  onToggleEnabled,
}: PanelEnableProps & {
  values: ToneCurveParams;
  onChange: (channel: CurveChannel, points: CurvePoint[]) => void;
  /** Set one parametric region slider (Highlights/Lights/Darks/Shadows). */
  onParametricChange: (key: ParamKey, value: number) => void;
  /** Move the parametric split points (the LR triangles under the graph). */
  onSplitsChange?: (splits: [number, number, number]) => void;
  onReset: () => void;
  /** Targeted Adjustment Tool: drag-on-image adjusts the region under the cursor. */
  tatActive?: boolean;
  onToggleTat?: () => void;
}) {
  const [ch, setCh] = useState<CurveChannel>("point");
  const dragRef = useRef<number | null>(null);
  const splitDragRef = useRef<number | null>(null);
  const points = values[ch];
  const splits = values.parametricSplits ?? DEFAULT_PARAMETRIC_SPLITS;
  // The RGB (master) tab previews the point curve WITH the parametric regions
  // composed in, so the drawn curve matches what recipeToParams ships; per-channel
  // tabs are the plain point curve (parametric only affects the master).
  const curveLut =
    ch === "point" ? masterToneLut(points, values.parametric, splits) : buildLut(points);
  const presetId = matchToneCurvePreset(values.point) ?? "custom";

  const setSplit = (idx: number, x: number) => {
    if (!onSplitsChange) return;
    const lo = (idx === 0 ? 0 : splits[idx - 1]) + SPLIT_GAP;
    const hi = (idx === 2 ? 1 : splits[idx + 1]) - SPLIT_GAP;
    const next = [...splits] as [number, number, number];
    next[idx] = Math.max(lo, Math.min(hi, x));
    onSplitsChange(next);
  };

  const toNorm = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = 1 - (e.clientY - r.top) / r.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const { x, y } = toNorm(e);
    const idx = nearestPoint(points, x, y, HIT_TOL);
    if (idx >= 0) {
      dragRef.current = idx;
    } else {
      const inserted = insertPoint(points, x, y);
      dragRef.current = inserted.index;
      onChange(ch, inserted.points);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current == null) return;
    const { x, y } = toNorm(e);
    onChange(ch, movePoint(points, dragRef.current, x, y));
  };

  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  const onDbl = (e: ReactPointerEvent<SVGSVGElement>) => {
    const { x, y } = toNorm(e);
    const idx = nearestPoint(points, x, y, HIT_TOL);
    if (idx >= 0) onChange(ch, removePoint(points, idx));
  };

  return (
    <div className="gal-dev-panel">
      <PanelHead title="Tone Curve" enabled={enabled} onToggleEnabled={onToggleEnabled} onReset={onReset}>
        {onToggleTat && (
          <Button
            variant={tatActive ? "primary" : "ghost"}
            size="sm"
            onClick={onToggleTat}
            title="Targeted Adjustment — drag on the image to adjust the tone region under the cursor"
            aria-pressed={tatActive}
          >
            ◎
          </Button>
        )}
      </PanelHead>
      <PanelBody enabled={enabled}>
      <div className="gal-dev-tabs">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            className={"gal-dev-tab" + (c.key === ch ? " is-active" : "")}
            onClick={() => setCh(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <svg
        className="gal-dev-curve"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={onDbl}
      >
        <rect x={0} y={0} width={100} height={100} className="gal-curve-bg" />
        {[25, 50, 75].map((g) => (
          <g key={g}>
            <line x1={g} y1={0} x2={g} y2={100} className="gal-curve-grid" />
            <line x1={0} y1={g} x2={100} y2={g} className="gal-curve-grid" />
          </g>
        ))}
        <line x1={0} y1={100} x2={100} y2={0} className="gal-curve-identity" />
        <path d={curvePath(curveLut)} className="gal-curve-line" fill="none" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x * 100} cy={(1 - p.y) * 100} r={2.4} className="gal-curve-pt" />
        ))}
      </svg>
      {onSplitsChange && (
        // LR's split-point triangles: drag to move the shadow/mid/highlight
        // region boundaries; double-click resets them. Arrow keys nudge by 1%.
        <svg
          className="gal-curve-splits"
          // Inline sizing/colour so the strip works before galerie.css styles it
          // (this file doesn't own the stylesheet).
          style={{ width: "100%", height: 10, display: "block", cursor: "ew-resize", color: "var(--accent-raster, #999)" }}
          viewBox="0 0 100 8"
          preserveAspectRatio="none"
          role="group"
          aria-label="Parametric region split points"
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width;
            let idx = 0;
            for (let i = 1; i < 3; i++) if (Math.abs(splits[i] - x) < Math.abs(splits[idx] - x)) idx = i;
            splitDragRef.current = idx;
            setSplit(idx, x);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (splitDragRef.current == null) return;
            const r = e.currentTarget.getBoundingClientRect();
            setSplit(splitDragRef.current, (e.clientX - r.left) / r.width);
          }}
          onPointerUp={(e) => {
            splitDragRef.current = null;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              /* pointer already released */
            }
          }}
          onDoubleClick={() => onSplitsChange([...DEFAULT_PARAMETRIC_SPLITS] as [number, number, number])}
        >
          {splits.map((s, i) => (
            <polygon
              key={i}
              points={`${s * 100},1 ${s * 100 - 2},7 ${s * 100 + 2},7`}
              className="gal-curve-split"
              fill="currentColor"
              tabIndex={0}
              role="slider"
              aria-label={["Shadow split", "Midtone split", "Highlight split"][i]}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(s * 100)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setSplit(i, s - 0.01);
                else if (e.key === "ArrowRight") setSplit(i, s + 0.01);
              }}
            />
          ))}
        </svg>
      )}
      {ch === "point" && (
        <div className="gal-dev-section">
          <label className="gal-dev-sec-label">
            Point Curve{" "}
            <Select
              size="sm"
              aria-label="Point curve preset"
              value={presetId}
              options={[
                ...TONE_CURVE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
                ...(presetId === "custom" ? [{ value: "custom", label: "Custom" }] : []),
              ]}
              onChange={(v) => {
                const preset = TONE_CURVE_PRESETS.find((p) => p.id === v);
                // Clone: preset points are frozen templates, recipes own their arrays.
                if (preset) onChange("point", preset.points.map((p) => ({ ...p })));
              }}
            />
          </label>
        </div>
      )}
      <div className="gal-dev-section">
        <div className="gal-dev-sec-label">Parametric</div>
        {PARAM_ROWS.map(({ key, label }) => (
          <DevRow
            key={key}
            label={label}
            min={-100}
            max={100}
            value={Math.round(values.parametric[key])}
            onChange={(v) => onParametricChange(key, v)}
            onReset={() => onParametricChange(key, 0)}
          />
        ))}
      </div>
      </PanelBody>
    </div>
  );
}
