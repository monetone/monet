// ─────────────────────────────────────────────────────────────
// Monet — creative curve editors ("monet-cv-curve" family)
// ─────────────────────────────────────────────────────────────
// Mocked-but-sharable SVG bezier curve editors in the spirit of pro creative
// apps: an EQ-style N-point CurveEditor (draggable control points, optional log
// frequency axis + area fill) and an EasingCurve (a single CSS cubic-bezier with
// two draggable handles + named presets). Behaviour (pointer drag → svg units →
// clamped immutable update, keyboard nudges, ARIA) lives here; visuals come from
// @monet-ui/monet-core/creative.css (the "monet-cv-curve" rules).
//
// The drag handlers copy the Slider core — getBoundingClientRect on the SVG +
// window pointermove/up + setPointerCapture on each handle — and emit through
// onChange-family callbacks so the controls drive real interaction over mocked
// host data. Every draggable node is role="slider"; the SVG root is role="group".
//
// Components:
//   <CurveEditor>   general N-point curve (EQ bands, custom transfer curves)
//   <EasingCurve>   one cubic-bezier easing with two handles + preset chips

import React, {
  forwardRef,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { SegmentedControl } from "./creative-inspector";
import { useControllableState, usePointerSession, cx, clamp, roundTo } from "./internal";
import {
  fracToValue,
  valueToFrac,
  formatAxisValue,
  pointToSvg,
  sortByX,
  buildCurvePath,
  closeFillPath,
  easingPath,
  matchPreset,
  EASING_PRESETS,
  type CurvePoint,
  type CurveScale,
  type Vec2,
} from "./creative-curve-math";

// Re-export the math + value types so creative-curve.tsx is the single public
// module (the math is an implementation split, mirroring creative-color).
export {
  fracToValue,
  valueToFrac,
  buildCurvePath,
  easingPath,
  EASING_PRESETS,
} from "./creative-curve-math";
export type { CurvePoint, CurveScale, Vec2 } from "./creative-curve-math";

// ─── shared helpers ────────────────────────────────────────────

/** Attach the forwarded ref to a local ref object (the Slider-core setRef). */
function useMergedRef<T>(forwardedRef: React.ForwardedRef<T>) {
  const local = useRef<T | null>(null);
  const set = (el: T | null) => {
    local.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef)
      (forwardedRef as React.MutableRefObject<T | null>).current = el;
  };
  return [local, set] as const;
}

let curvePtSeq = 0;
const nextPointId = () => `curve-pt-${++curvePtSeq}`;

// ─── CurveEditor ───────────────────────────────────────────────

export interface CurveEditorProps {
  /** Controlled points. Omit (with `defaultPoints`) for uncontrolled use. */
  points?: CurvePoint[];
  defaultPoints?: CurvePoint[];
  /** Fires with the next points array on each drag tick / keyboard nudge / add /
   *  remove. */
  onChange?: (points: CurvePoint[]) => void;
  /** Fires once when a drag ends (or after an add / remove). */
  onChangeEnd?: (points: CurvePoint[]) => void;
  /** Value range the normalised X maps onto (for the aria readout). */
  xRange?: [number, number];
  /** Value range the normalised Y maps onto (for the aria readout). */
  yRange?: [number, number];
  /** X-axis spacing of the readout — `"log"` for frequency. Defaults "linear". */
  xScale?: CurveScale;
  /** Paint the area under the curve. Defaults true. */
  fill?: boolean;
  /** Allow drag / add (bg click) / remove (dblclick). Defaults true. */
  editable?: boolean;
  /** Pixel width of the SVG viewBox. Defaults 240. */
  width?: number;
  /** Pixel height of the SVG viewBox. Defaults 120. */
  height?: number;
  /** Render the background grid. Defaults true. */
  showGrid?: boolean;
  accent?: string;
  "aria-label"?: string;
  className?: string;
}

const DEFAULT_CURVE_POINTS: CurvePoint[] = [
  { id: "cp-0", x: 0, y: 0.5 },
  { id: "cp-1", x: 0.5, y: 0.5 },
  { id: "cp-2", x: 1, y: 0.5 },
];

/** A general N-point SVG bezier curve editor (EQ bands, transfer curves). Drag a
 *  `<circle>` to move its point (setPointerCapture; pointer → svg units → x,y,
 *  inverting the log scale for frequency, clamped to the ranges, immutable
 *  update); click the background to add an interpolated point; double-click a
 *  point to remove it (when `editable`). The `<path>` `d` is built smoothly from
 *  the points. Each point is role="slider" with an `aria-valuetext` of its
 *  mapped value; the SVG root is role="group". Forwards its `ref` to the SVG. */
export const CurveEditor = forwardRef<SVGSVGElement, CurveEditorProps>(
  function CurveEditor(
    {
      points,
      defaultPoints,
      onChange,
      onChangeEnd,
      xRange = [0, 1],
      yRange = [0, 1],
      xScale = "linear",
      fill = true,
      editable = true,
      width = 240,
      height = 120,
      showGrid = true,
      accent,
      className,
      ...aria
    },
    forwardedRef,
  ) {
    const [pts, setPts] = useControllableState<CurvePoint[]>(
      points,
      defaultPoints ?? DEFAULT_CURVE_POINTS,
      onChange,
    );
    const [svgRef, setSvgRef] = useMergedRef<SVGSVGElement>(forwardedRef);
    const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
    const startPointerSession = usePointerSession();

    const emit = (next: CurvePoint[], end: boolean) => {
      setPts(next);
      if (end) onChangeEnd?.(next);
    };

    // Pointer → normalised x,y. Inverts SVG's downward Y so y grows upward.
    const fromPointer = (clientX: number, clientY: number): Vec2 => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const x = clamp((clientX - rect.left) / (rect.width || 1), 0, 1);
      const y = 1 - clamp((clientY - rect.top) / (rect.height || 1), 0, 1);
      return { x, y };
    };

    const setPointAt = (id: string, x: number, y: number): CurvePoint[] =>
      pts.map((p) =>
        p.id === id ? { ...p, x: roundTo(clamp(x, 0, 1), 4), y: roundTo(clamp(y, 0, 1), 4) } : p,
      );

    const onPointPointerDown =
      (id: string) => (e: ReactPointerEvent<SVGCircleElement>) => {
        if (!editable || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        (e.currentTarget as unknown as HTMLElement).focus?.();
        setSelectedId(id);
        const start = pts;
        let next = pts;
        // (#202) Same no-op-commit shape as the easing handles: clicking a point
        // to select it must not fire the commit signal with an unchanged value.
        let moved = false;
        const move = (ev: PointerEvent) => {
          const { x, y } = fromPointer(ev.clientX, ev.clientY);
          next = setPointAt(id, x, y);
          moved = true;
          setPts(next);
        };
        startPointerSession({
          move,
          up: () => { if (moved) onChangeEnd?.(next); },
          onCancel: () => { if (moved) setPts(start); },
        });
      };

    const onPointKeyDown =
      (id: string) => (e: React.KeyboardEvent<SVGCircleElement>) => {
        if (!editable) return;
        const p = pts.find((q) => q.id === id);
        if (!p) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          removePoint(id);
          return;
        }
        const big = e.shiftKey ? 0.1 : 0.01;
        let { x, y } = p;
        if (e.key === "ArrowRight") x += big;
        else if (e.key === "ArrowLeft") x -= big;
        else if (e.key === "ArrowUp") y += big;
        else if (e.key === "ArrowDown") y -= big;
        else if (e.key === "Home") x = 0;
        else if (e.key === "End") x = 1;
        else if (e.key === "PageUp") y += 0.1;
        else if (e.key === "PageDown") y -= 0.1;
        else return;
        e.preventDefault();
        emit(setPointAt(id, x, y), true);
      };

    // Click the background (not a point) → add a point at that x, y.
    const onBgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
      if (!editable || e.button !== 0) return;
      const { x, y } = fromPointer(e.clientX, e.clientY);
      const id = nextPointId();
      const next = sortByX([...pts, { id, x: roundTo(x, 4), y: roundTo(y, 4) }]);
      emit(next, true);
      setSelectedId(id);
    };

    const removePoint = (id: string) => {
      if (pts.length <= 2) return;
      const next = pts.filter((p) => p.id !== id);
      emit(next, true);
      if (selectedId === id) setSelectedId(undefined);
    };

    const sorted = sortByX(pts);
    const curveD = buildCurvePath(pts, width, height);
    const fillD = fill ? closeFillPath(curveD, width, height) : "";
    const gridLines = showGrid ? [0.25, 0.5, 0.75] : [];

    return (
      <svg
        ref={setSvgRef}
        role="group"
        aria-label={aria["aria-label"] ?? "Curve editor"}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={cx("monet-cv-curve", !editable && "is-readonly", className)}
        style={{ "--accent": accent } as CSSProperties}
        onPointerDown={onBgPointerDown}
      >
        {showGrid && (
          <g className="monet-cv-curve-grid" aria-hidden="true">
            {gridLines.map((g) => (
              <line key={`h${g}`} x1={0} y1={g * height} x2={width} y2={g * height} />
            ))}
            {gridLines.map((g) => (
              <line key={`v${g}`} x1={g * width} y1={0} x2={g * width} y2={height} />
            ))}
          </g>
        )}
        {fill && fillD && <path className="monet-cv-curve-fill" d={fillD} aria-hidden="true" />}
        {curveD && <path className="monet-cv-curve-path" d={curveD} aria-hidden="true" />}
        {sorted.map((p) => {
          const c = pointToSvg(p, width, height);
          const xv = formatAxisValue(fracToValue(p.x, xRange[0], xRange[1], xScale));
          const yv = formatAxisValue(fracToValue(p.y, yRange[0], yRange[1]));
          return (
            <circle
              key={p.id}
              role="slider"
              tabIndex={editable ? 0 : -1}
              aria-label={`Point ${xv}`}
              aria-valuemin={yRange[0]}
              aria-valuemax={yRange[1]}
              aria-valuenow={roundTo(fracToValue(p.y, yRange[0], yRange[1]), 2)}
              aria-valuetext={`${xv}, ${yv}`}
              cx={c.x}
              cy={c.y}
              r={5}
              className={cx("monet-cv-curve-point", p.id === selectedId && "is-selected")}
              style={p.color ? ({ "--point-color": p.color } as CSSProperties) : undefined}
              onPointerDown={onPointPointerDown(p.id)}
              onKeyDown={onPointKeyDown(p.id)}
              onDoubleClick={(e) => {
                if (!editable) return;
                e.stopPropagation();
                removePoint(p.id);
              }}
            />
          );
        })}
      </svg>
    );
  },
);

// ─── EasingCurve ───────────────────────────────────────────────

export type Bezier = [number, number, number, number];

export interface EasingCurveProps {
  /** Controlled `[x1,y1,x2,y2]` (the two CSS cubic-bezier control points). */
  value?: Bezier;
  defaultValue?: Bezier;
  /** Fires with the next bezier on each drag tick / keyboard nudge / preset. */
  onChange?: (bezier: Bezier) => void;
  /** Fires once when a drag ends (or after a preset is chosen). */
  onChangeEnd?: (bezier: Bezier) => void;
  /** Named preset chips (CSS easing names). Defaults to the common four. */
  presets?: string[];
  /** Pixel size of the square editor. Defaults 160. */
  size?: number;
  accent?: string;
  "aria-label"?: string;
  className?: string;
}

const DEFAULT_BEZIER: Bezier = [0.42, 0, 0.58, 1];
const DEFAULT_PRESETS = ["ease-in", "ease-out", "ease-in-out"];

type EaseHandle = "p1" | "p2";

/** A single CSS cubic-bezier easing editor. Two draggable handles (P1 = `x1,y1`,
 *  P2 = `x2,y2`) live in a 0..1 box with the fixed 0,0 / 1,1 endpoints; the X of
 *  each handle is clamped to `[0,1]` (CSS requires it) while Y is free. Optional
 *  named-preset chips set the curve. Each handle is role="slider"; the SVG root
 *  is role="group". Forwards its `ref` to the root. */
export const EasingCurve = forwardRef<HTMLDivElement, EasingCurveProps>(
  function EasingCurve(
    {
      value,
      defaultValue,
      onChange,
      onChangeEnd,
      presets = DEFAULT_PRESETS,
      size = 160,
      accent,
      className,
      ...aria
    },
    forwardedRef,
  ) {
    const [bezier, setBezier] = useControllableState<Bezier>(
      value,
      defaultValue ?? DEFAULT_BEZIER,
      onChange,
    );
    const svgRef = useRef<SVGSVGElement | null>(null);
    const autoId = useId();
    const startPointerSession = usePointerSession();

    // Pointer → normalised x,y over the SVG box (X clamped 0..1; Y can overshoot
    // for spring-like curves — (#197) dragging past the top/bottom edge is how
    // you author one; `pointToSvg` keeps the on-screen handle inside the box).
    const fromPointer = (clientX: number, clientY: number): Vec2 => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const x = clamp((clientX - rect.left) / (rect.width || 1), 0, 1);
      const y = 1 - (clientY - rect.top) / (rect.height || 1);
      return { x, y };
    };

    const setHandle = (which: EaseHandle, x: number, y: number): Bezier => {
      const nx = roundTo(clamp(x, 0, 1), 4);
      // (#197) Only X is clamped: CSS cubic-bezier() requires x ∈ [0,1] but
      // allows y outside it (anticipation/overshoot easings). Clamping y here
      // also silently rewrote a controlled y on an X-only keyboard nudge.
      const ny = roundTo(y, 4);
      return which === "p1"
        ? [nx, ny, bezier[2], bezier[3]]
        : [bezier[0], bezier[1], nx, ny];
    };

    const emit = (next: Bezier, end: boolean) => {
      setBezier(next);
      if (end) onChangeEnd?.(next);
    };

    const onHandlePointerDown =
      (which: EaseHandle) => (e: ReactPointerEvent<SVGCircleElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        (e.currentTarget as unknown as HTMLElement).focus?.();
        const start = bezier;
        let next = bezier;
        // (#202) A bare click on a handle is a focus/selection gesture, not an
        // edit: committing `next` (still the current bezier) would push a no-op
        // undo entry in every host that treats onChangeEnd as the commit.
        let moved = false;
        const move = (ev: PointerEvent) => {
          const { x, y } = fromPointer(ev.clientX, ev.clientY);
          next = setHandle(which, x, y);
          moved = true;
          setBezier(next);
        };
        startPointerSession({
          move,
          up: () => { if (moved) onChangeEnd?.(next); },
          onCancel: () => { if (moved) setBezier(start); },
        });
      };

    const onHandleKeyDown =
      (which: EaseHandle) => (e: React.KeyboardEvent<SVGCircleElement>) => {
        const [hx, hy] = which === "p1" ? [bezier[0], bezier[1]] : [bezier[2], bezier[3]];
        const big = e.shiftKey ? 0.1 : 0.01;
        let x = hx;
        let y = hy;
        if (e.key === "ArrowRight") x += big;
        else if (e.key === "ArrowLeft") x -= big;
        else if (e.key === "ArrowUp") y += big;
        else if (e.key === "ArrowDown") y -= big;
        else if (e.key === "Home") x = 0;
        else if (e.key === "End") x = 1;
        else return;
        e.preventDefault();
        emit(setHandle(which, x, y), true);
      };

    const selectPreset = (name: string) => {
      const p = EASING_PRESETS[name];
      if (p) emit([...p] as Bezier, true);
    };

    const curveD = easingPath(bezier, size, size);
    const p1 = pointToSvg({ x: bezier[0], y: bezier[1] }, size, size);
    const p2 = pointToSvg({ x: bezier[2], y: bezier[3] }, size, size);
    const origin = pointToSvg({ x: 0, y: 0 }, size, size);
    const end = pointToSvg({ x: 1, y: 1 }, size, size);
    const active = matchPreset(bezier);

    const segItems = presets.map((name) => ({ value: name, label: name }));

    const handle = (which: EaseHandle, pos: Vec2, anchor: Vec2, label: string, vx: number, vy: number) => (
      <g>
        <line
          className="monet-cv-curve-handle-line"
          x1={anchor.x}
          y1={anchor.y}
          x2={pos.x}
          y2={pos.y}
          aria-hidden="true"
        />
        <circle
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={roundTo(vy, 3)}
          aria-valuetext={`${roundTo(vx, 2)}, ${roundTo(vy, 2)}`}
          cx={pos.x}
          cy={pos.y}
          r={6}
          className="monet-cv-curve-handle"
          onPointerDown={onHandlePointerDown(which)}
          onKeyDown={onHandleKeyDown(which)}
        />
      </g>
    );

    return (
      <div
        ref={forwardedRef}
        className={cx("monet-cv-curve-easing", className)}
        style={{ "--accent": accent } as CSSProperties}
      >
        <svg
          ref={svgRef}
          role="group"
          aria-label={aria["aria-label"] ?? "Easing curve"}
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="monet-cv-curve is-easing"
        >
          <g className="monet-cv-curve-grid" aria-hidden="true">
            <line x1={0} y1={size / 2} x2={size} y2={size / 2} />
            <line x1={size / 2} y1={0} x2={size / 2} y2={size} />
          </g>
          {curveD && <path className="monet-cv-curve-path" d={curveD} aria-hidden="true" />}
          {handle("p1", p1, origin, "Control point 1", bezier[0], bezier[1])}
          {handle("p2", p2, end, "Control point 2", bezier[2], bezier[3])}
        </svg>
        {presets.length > 0 && (
          <SegmentedControl
            items={segItems}
            // (#194) `null` = "no preset matches", not "uncontrolled".
            value={active ?? null}
            accent={accent}
            aria-label="Easing preset"
            className="monet-cv-curve-presets"
            onChange={selectPreset}
          />
        )}
      </div>
    );
  },
);
