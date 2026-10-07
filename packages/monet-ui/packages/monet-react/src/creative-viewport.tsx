// ─────────────────────────────────────────────────────────────
// Monet — creative viewport / canvas widgets ("monet-cv-" viewport family)
// ─────────────────────────────────────────────────────────────
// Mocked-but-sharable canvas-edge tooling in the spirit of pro creative apps
// (Photoshop / Figma / After Effects viewports): an edge ruler, a zoom control,
// a navigator (minimap), a selection marquee, and a grid/guides overlay.
// Behaviour (drag → fraction, keyboard nudges, clamp, ARIA) lives here; visuals
// come from @monet-ui/monet-core/creative.css (the "monet-cv-" rules).
//
// The marquee/navigator drag handlers copy the Slider core (getBoundingClientRect
// + window pointermove/up + setPointerCapture); the ZoomControl composes the
// shared IconButton / Select exports. All interactive values flow through
// onChange-family callbacks so the controls drive real interaction over mocked
// host data.
//
// Components:
//   <CanvasRuler>   decorative tick ruler for a canvas edge + optional cursor
//   <ZoomControl>   − / + + monospace % readout + Fit + preset Select
//   <Navigator>     inset preview minimap + draggable viewport marquee + zoom row
//   <Marquee>       dashed marching-ants selection rectangle (presentational)
//   <GridGuides>    absolutely-positioned grid + guide-line overlay

import React, {
  forwardRef,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Icon, I } from "./icons";
import { IconButton, Select } from "./controls";
import { Slider } from "./primitives-graphics";
import { useControllableState, cx, clamp, roundTo } from "./internal";

// ─── shared helpers ────────────────────────────────────────────

/** Attach a forwarded ref to a local ref object (the Slider-core setRef). */
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

// Crosshair / fit glyphs. These prefer the shared `I.crosshair` / `I.fit` once
// the integrator adds them to ./icons (returned in `iconsNeeded`); the local
// fallback paths keep the controls rendering a real glyph standalone.
const FIT_GLYPH =
  (I as Record<string, string>).fit ??
  "M3 6L3 3L6 3M13 6L13 3L10 3M3 10L3 13L6 13M13 10L13 13L10 13M6 6L10 6L10 10L6 10Z";

// ─── CanvasRuler ───────────────────────────────────────────────

export interface CanvasRulerProps {
  /** Edge the ruler decorates. Defaults to "horizontal". */
  orientation?: "horizontal" | "vertical";
  /** First unit value at the ruler origin. Defaults to 0. */
  start?: number;
  /** Last unit value (the span end). */
  end: number;
  /** Pixels drawn per unit. Defaults to 1. */
  pixelsPerUnit?: number;
  /** Major (labelled) tick spacing in units. Auto-chosen from the scale when omitted. */
  majorEvery?: number;
  /** A position marker drawn as a cursor line, in units. */
  cursor?: number;
  /** Unit suffix appended to tick labels (e.g. "px", "%"). */
  unit?: string;
  "aria-label"?: string;
  className?: string;
}

/** A "nice" major-tick spacing (units) for a px/unit scale: the smallest step
 *  giving ≥48px so labels never crowd. */
const NICE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
function niceMajorStep(pixelsPerUnit: number): number {
  const minPx = 48;
  for (const step of NICE_STEPS) {
    if (step * pixelsPerUnit >= minPx) return step;
  }
  return NICE_STEPS[NICE_STEPS.length - 1];
}

/** A decorative tick ruler for a canvas edge. Ticks are placed at `majorEvery`
 *  (labelled) with one minor tick between when it fits; an optional `cursor`
 *  draws a position line that follows a unit value. Purely presentational —
 *  role="presentation" (carries no value semantics). Forwards its `ref`. */
export const CanvasRuler = forwardRef<HTMLDivElement, CanvasRulerProps>(
  function CanvasRuler(
    {
      orientation = "horizontal",
      start = 0,
      end,
      pixelsPerUnit = 1,
      majorEvery,
      cursor,
      unit,
      className,
      ...aria
    },
    forwardedRef,
  ) {
    const vertical = orientation === "vertical";
    const major = majorEvery && majorEvery > 0 ? majorEvery : niceMajorStep(pixelsPerUnit);
    const minorStep = major / 2;
    const showMinor = minorStep * pixelsPerUnit >= 10;
    const span = end - start;

    // px offset along the ruler for a unit value (origin at `start`).
    const posOf = (u: number) => (u - start) * pixelsPerUnit;

    const ticks: ReactNode[] = [];
    for (let u = start; u <= end + 1e-6; u += minorStep) {
      const unitVal = roundTo(u, 6);
      const isMajor = Math.abs(unitVal / major - Math.round(unitVal / major)) < 1e-6;
      if (!isMajor && !showMinor) continue;
      const off = posOf(unitVal);
      ticks.push(
        <div
          key={unitVal}
          className={cx("monet-cv-canvasruler-tick", isMajor && "is-major")}
          style={(vertical ? { top: `${off}px` } : { left: `${off}px` }) as CSSProperties}
          aria-hidden="true"
        >
          {isMajor && (
            <span className="monet-cv-canvasruler-label">
              {roundTo(unitVal, 2)}
              {unit}
            </span>
          )}
        </div>,
      );
    }

    const hasCursor = cursor != null && isFinite(cursor);
    const cursorOff = hasCursor ? posOf(clamp(cursor!, start, end)) : 0;

    return (
      <div
        ref={forwardedRef}
        role="presentation"
        aria-label={aria["aria-label"]}
        className={cx(
          "monet-cv-canvasruler",
          vertical ? "is-vertical" : "is-horizontal",
          className,
        )}
        style={{ "--span": span } as CSSProperties}
      >
        {ticks}
        {hasCursor && (
          <div
            className="monet-cv-canvasruler-cursor"
            aria-hidden="true"
            style={(vertical ? { top: `${cursorOff}px` } : { left: `${cursorOff}px` }) as CSSProperties}
          />
        )}
      </div>
    );
  },
);

// ─── ZoomControl ───────────────────────────────────────────────

export interface ZoomControlProps {
  /** Controlled zoom (1 = 100%). Omit (with `defaultValue`) for uncontrolled. */
  value?: number;
  defaultValue?: number;
  onChange?: (zoom: number) => void;
  /** Smallest zoom. Defaults to 0.05 (5%). */
  min?: number;
  /** Largest zoom. Defaults to 64 (6400%). */
  max?: number;
  /** Multiplicative step per − / + press. Defaults to a √2 factor. */
  step?: number;
  /** Preset zoom levels rendered as a quick-pick Select (e.g. [0.5, 1, 2]). */
  presets?: number[];
  /** When set, renders a "Fit" button that calls this. */
  onFit?: () => void;
  disabled?: boolean;
  accent?: string;
  "aria-label"?: string;
  className?: string;
}

/** Format a zoom factor as a whole-percent string (1 → "100%"). */
function zoomPct(z: number): string {
  return `${Math.round(z * 100)}%`;
}

/** A zoom control: − / + buttons that scale multiplicatively, a monospace
 *  percent readout (role="spinbutton", Arrow keys nudge), an optional Fit
 *  button, and an optional preset Select. The readout owns the value via the
 *  controllable-state convention. Forwards its `ref` to the root. */
export const ZoomControl = forwardRef<HTMLDivElement, ZoomControlProps>(
  function ZoomControl(
    {
      value,
      defaultValue,
      onChange,
      min = 0.05,
      max = 64,
      step = Math.SQRT2,
      presets,
      onFit,
      disabled,
      accent,
      className,
      ...aria
    },
    forwardedRef,
  ) {
    const [zoom, setZoom] = useControllableState<number>(
      value,
      defaultValue ?? 1,
      onChange,
    );
    const factor = step > 1 ? step : 1 / step || 2;

    const commit = (z: number): number => {
      const next = roundTo(clamp(z, min, max), 4);
      setZoom(next);
      return next;
    };
    const zoomBy = (mult: number) => {
      if (disabled) return;
      commit(zoom * mult);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (disabled) return;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") {
        e.preventDefault();
        zoomBy(factor);
      } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
        e.preventDefault();
        zoomBy(1 / factor);
      } else if (e.key === "Home") {
        e.preventDefault();
        commit(min);
      } else if (e.key === "End") {
        e.preventDefault();
        commit(max);
      }
    };

    // The select value matches a preset only when the zoom lands on it exactly;
    // otherwise nothing is selected and the placeholder shows the live percent.
    const presetMatch = presets?.find((p) => Math.abs(p - zoom) < 1e-4);

    return (
      <div
        ref={forwardedRef}
        className={cx("monet-cv-zoom", disabled && "is-disabled", className)}
        style={{ "--accent": accent } as CSSProperties}
      >
        <IconButton
          icon="minus"
          aria-label="Zoom out"
          size="sm"
          disabled={disabled || zoom <= min}
          className="monet-cv-zoom-btn"
          onClick={() => zoomBy(1 / factor)}
        />
        <span
          role="spinbutton"
          tabIndex={disabled ? -1 : 0}
          aria-label={aria["aria-label"] ?? "Zoom"}
          aria-valuemin={roundTo(min * 100, 2)}
          aria-valuemax={roundTo(max * 100, 2)}
          aria-valuenow={Math.round(zoom * 100)}
          aria-valuetext={zoomPct(zoom)}
          aria-disabled={disabled || undefined}
          className="monet-cv-zoom-value"
          onKeyDown={onKeyDown}
        >
          {zoomPct(zoom)}
        </span>
        <IconButton
          icon="plus"
          aria-label="Zoom in"
          size="sm"
          disabled={disabled || zoom >= max}
          className="monet-cv-zoom-btn"
          onClick={() => zoomBy(factor)}
        />
        {onFit && (
          <IconButton
            icon={FIT_GLYPH}
            aria-label="Zoom to fit"
            size="sm"
            disabled={disabled}
            className="monet-cv-zoom-fit"
            onClick={() => onFit()}
          />
        )}
        {presets != null && presets.length > 0 && (
          <Select
            size="sm"
            aria-label="Zoom presets"
            disabled={disabled}
            placeholder={zoomPct(zoom)}
            className="monet-cv-zoom-presets"
            value={presetMatch != null ? String(presetMatch) : undefined}
            options={presets.map((p) => ({ value: String(p), label: zoomPct(p) }))}
            onChange={(v) => commit(Number(v))}
          />
        )}
      </div>
    );
  },
);

// ─── Navigator ─────────────────────────────────────────────────

export interface ViewportRect {
  /** Left edge as a 0..1 fraction of the document. */
  x: number;
  /** Top edge as a 0..1 fraction. */
  y: number;
  /** Width as a 0..1 fraction. */
  w: number;
  /** Height as a 0..1 fraction. */
  h: number;
}

export interface NavigatorProps {
  /** Inset preview content (a thumbnail of the document). */
  preview?: ReactNode;
  /** Controlled viewport rect (0..1 fractions). Omit (with `defaultViewport`) for uncontrolled. */
  viewport?: ViewportRect;
  defaultViewport?: ViewportRect;
  /** Fires the next viewport rect on each drag tick / key nudge. */
  onViewportChange?: (rect: ViewportRect) => void;
  /** Controlled zoom for the zoom row (1 = 100%). */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  /** Custom readout for the zoom row (defaults to a percent of `zoom`). */
  zoomLabel?: ReactNode;
  /** Aspect ratio of the preview box. Defaults to "3/2". */
  aspectRatio?: string;
  accent?: string;
  "aria-label"?: string;
  className?: string;
}

const DEFAULT_VIEWPORT: ViewportRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

/** A navigator (minimap): an inset preview box with a draggable viewport marquee
 *  (drag moves x/y within 0..1, clamped so the rect stays inside), plus an
 *  optional zoom row built on the shared Slider + `.monet-row`. The marquee is
 *  role="slider" (Arrow pans, Shift = ×10, Home/End jump to the edges). The
 *  preview is role="img". Forwards its `ref` to the root. */
export const Navigator = forwardRef<HTMLDivElement, NavigatorProps>(
  function Navigator(
    {
      preview,
      viewport,
      defaultViewport,
      onViewportChange,
      zoom,
      onZoomChange,
      zoomLabel,
      aspectRatio = "3/2",
      accent,
      className,
      ...aria
    },
    forwardedRef,
  ) {
    const [rect, setRect] = useControllableState<ViewportRect>(
      viewport,
      defaultViewport ?? DEFAULT_VIEWPORT,
      onViewportChange,
    );
    const [previewRef, setRef] = useMergedRef<HTMLDivElement>(forwardedRef);
    const STEP = 0.02;

    // clamp the rect's origin so the (fixed-size) viewport stays inside 0..1.
    const place = (x: number, y: number): ViewportRect => {
      const next: ViewportRect = {
        ...rect,
        x: roundTo(clamp(x, 0, Math.max(0, 1 - rect.w)), 4),
        y: roundTo(clamp(y, 0, Math.max(0, 1 - rect.h)), 4),
      };
      setRect(next);
      return next;
    };

    const onMarqueePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.focus();
      const box = previewRef.current?.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = rect;
      const move = (ev: PointerEvent) => {
        const dx = box ? (ev.clientX - startX) / (box.width || 1) : 0;
        const dy = box ? (ev.clientY - startY) / (box.height || 1) : 0;
        place(orig.x + dx, orig.y + dy);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

    const onMarqueeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      let { x, y } = rect;
      const big = e.shiftKey ? STEP * 5 : STEP;
      if (e.key === "ArrowRight") x += big;
      else if (e.key === "ArrowLeft") x -= big;
      else if (e.key === "ArrowDown") y += big;
      else if (e.key === "ArrowUp") y -= big;
      else if (e.key === "Home") {
        x = 0;
        y = 0;
      } else if (e.key === "End") {
        x = 1;
        y = 1;
      } else return;
      e.preventDefault();
      place(x, y);
    };

    const cx100 = roundTo(clamp(rect.x + rect.w / 2, 0, 1) * 100, 1);
    const cy100 = roundTo(clamp(rect.y + rect.h / 2, 0, 1) * 100, 1);

    return (
      <div
        ref={(el) => {
          setRef(el);
        }}
        className={cx("monet-cv-navigator", className)}
        style={{ "--accent": accent } as CSSProperties}
        aria-label={aria["aria-label"] ?? "Navigator"}
        role="group"
      >
        <div
          className="monet-cv-navigator-preview"
          role="img"
          aria-label="Document preview"
          style={{ aspectRatio } as CSSProperties}
        >
          {preview}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Viewport"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={cx100}
            aria-valuetext={`${cx100}%, ${cy100}%`}
            className="monet-cv-navigator-marquee"
            style={
              {
                left: `${roundTo(clamp(rect.x, 0, 1) * 100, 3)}%`,
                top: `${roundTo(clamp(rect.y, 0, 1) * 100, 3)}%`,
                width: `${roundTo(clamp(rect.w, 0, 1) * 100, 3)}%`,
                height: `${roundTo(clamp(rect.h, 0, 1) * 100, 3)}%`,
              } as CSSProperties
            }
            onPointerDown={onMarqueePointerDown}
            onKeyDown={onMarqueeKeyDown}
          />
        </div>
        {(zoom != null || onZoomChange != null) && (
          <div className="monet-row monet-cv-navigator-zoom">
            <span className="lbl">Zoom</span>
            <Slider
              accent={accent}
              min={0.05}
              max={8}
              step={0.01}
              aria-label="Zoom"
              value={zoom ?? 1}
              onChange={(z) => onZoomChange?.(z)}
            />
            <span className="val">{zoomLabel ?? zoomPct(zoom ?? 1)}</span>
          </div>
        )}
      </div>
    );
  },
);

// ─── Marquee ───────────────────────────────────────────────────

export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MarqueeProps {
  /** The rectangle to draw. Values are CSS lengths (px or %) — see `unit`. */
  rect: MarqueeRect;
  /** Treat `rect` values as percentages of the parent instead of pixels. Defaults to false. */
  percent?: boolean;
  /** Animate the marching ants. Honors `prefers-reduced-motion`. Defaults to true. */
  marching?: boolean;
  /** Optional label chip rendered at the rect's corner (e.g. a size readout). */
  label?: ReactNode;
  accent?: string;
  className?: string;
  style?: CSSProperties;
}

/** A dashed selection rectangle with a marching-ants animation (the CSS honors
 *  `prefers-reduced-motion`, freezing the dashes). Mostly presentational —
 *  role="presentation"; an optional `label` chip annotates the corner.
 *  Forwards its `ref`. */
export const Marquee = forwardRef<HTMLDivElement, MarqueeProps>(function Marquee(
  { rect, percent, marching = true, label, accent, className, style },
  ref,
) {
  const u = (n: number) => (percent ? `${n}%` : `${n}px`);
  return (
    <div
      ref={ref}
      role="presentation"
      className={cx("monet-cv-marquee", marching && "is-marching", className)}
      style={
        {
          "--accent": accent,
          left: u(rect.x),
          top: u(rect.y),
          width: u(rect.w),
          height: u(rect.h),
          ...style,
        } as CSSProperties
      }
    >
      {label != null && <span className="monet-cv-marquee-label">{label}</span>}
    </div>
  );
});

// ─── GridGuides ────────────────────────────────────────────────

export interface Guide {
  /** "x" → a vertical line at `pos`; "y" → a horizontal line at `pos`. */
  axis: "x" | "y";
  /** Position in pixels from the overlay's top-left origin. */
  pos: number;
}

export interface GridGuidesProps {
  /** Spacing of the background grid in pixels. Defaults to 16. */
  gridSize?: number;
  /** Minor subdivisions drawn between major grid lines. Defaults to 0. */
  subdivisions?: number;
  /** Explicit guide lines drawn over the grid (accent). */
  guides?: Guide[];
  /** Draw the background grid. Defaults to true. */
  showGrid?: boolean;
  /** Draw the explicit guide lines. Defaults to true. */
  showGuides?: boolean;
  accent?: string;
  className?: string;
  style?: CSSProperties;
}

/** An absolutely-positioned overlay drawing a background grid (a CSS
 *  repeating-gradient, with optional subdivisions) plus accent guide lines.
 *  Decorative — aria-hidden, pointer-events: none (set in CSS). Forwards its
 *  `ref`. */
export const GridGuides = forwardRef<HTMLDivElement, GridGuidesProps>(
  function GridGuides(
    {
      gridSize = 16,
      subdivisions = 0,
      guides,
      showGrid = true,
      showGuides = true,
      accent,
      className,
      style,
    },
    ref,
  ) {
    const sub = subdivisions > 0 ? gridSize / (subdivisions + 1) : 0;
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cx(
          "monet-cv-gridguides",
          showGrid && "has-grid",
          sub > 0 && "has-sub",
          className,
        )}
        style={
          {
            "--accent": accent,
            "--grid": `${gridSize}px`,
            "--grid-sub": sub ? `${sub}px` : undefined,
            ...style,
          } as CSSProperties
        }
      >
        {showGuides &&
          guides?.map((g, i) => (
            <div
              key={`${g.axis}-${g.pos}-${i}`}
              className={cx("monet-cv-gridguides-line", `is-${g.axis}`)}
              style={(g.axis === "x" ? { left: `${g.pos}px` } : { top: `${g.pos}px` }) as CSSProperties}
            />
          ))}
      </div>
    );
  },
);
