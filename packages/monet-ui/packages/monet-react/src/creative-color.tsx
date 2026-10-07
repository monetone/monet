// ─────────────────────────────────────────────────────────────
// Monet — creative color controls ("monet-cv-" color family)
// ─────────────────────────────────────────────────────────────
// Mocked-but-sharable color tooling in the spirit of pro creative apps
// (Photoshop/Figma/After Effects color pickers): a saturation/value field, hue
// and alpha sliders, a color wheel, a gradient editor, the composite picker,
// and swatch/glyph grids. Behaviour (2D/1D/polar drag, keyboard, clamp, ARIA)
// lives here; visuals come from @monet-ui/monet-core/creative.css.
//
// CANONICAL state is HSV — hex/rgb are derived (see creative-color-graphics).
// The drag handlers copy the Slider core (getBoundingClientRect + window
// pointermove/up + setPointerCapture) and emit through onChange-family
// callbacks so the controls drive real interaction over mocked host data.
//
// Components:
//   <ColorField>        saturation×value square bound to a hue (2D drag)
//   <HueSlider>         1D rainbow hue 0..360
//   <AlphaSlider>       1D opacity over a tinted checkerboard
//   <ColorWheel>        conic HSV wheel (angle=hue, radius=saturation)
//   <EyedropperReadout> swatch + hex/rgb/hsv readout (+ optional pick)
//   <GradientEditor>    gradient bar + draggable stops
//   <ColorPicker>       composite: field + hue + alpha + inputs + swatches
//   <SwatchGrid> / <Swatch>   selectable swatch palette
//   <GlyphGrid>         selectable glyph palette
//   <HexInput>          normalizing "#rrggbb" text field

import React, {
  forwardRef,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Icon, I } from "./icons";
import { IconButton, NumberField } from "./controls";
import { AngleDial } from "./creative-numeric";
import { Swatch, HexInput } from "./creative-color-palette";
import { useControllableState, usePointerSession, cx, clamp, roundTo } from "./internal";
import {
  hsvToRgb,
  rgbToHsv,
  hsvToHex,
  hexToHsv,
  hsvToCss,
  toHsv,
  satValSquareBg,
  hueRainbowBg,
  gradientCss,
  sampleGradient,
  type HSV,
  type RGB,
  type ColorValue,
} from "./creative-color-graphics";

// Re-export the math + value types so creative-color.tsx is the single public
// module (graphics is an implementation split, mirroring primitives-graphics).
export * from "./creative-color-graphics";

// ─── shared helpers ────────────────────────────────────────────

/** Read a value along the active axis from a track rect (Slider-core math). */
function fracFromPointer(
  rect: DOMRect,
  clientX: number,
  clientY: number,
  vertical: boolean,
): number {
  const f = vertical
    ? 1 - (clientY - rect.top) / (rect.height || 1)
    : (clientX - rect.left) / (rect.width || 1);
  return clamp(f, 0, 1);
}

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

// ─── ColorField ────────────────────────────────────────────────

export interface ColorFieldProps {
  /** Controlled HSV. Omit (with `defaultValue`) for uncontrolled use. */
  value?: HSV;
  defaultValue?: HSV;
  /** Fires with the next HSV on each drag tick / keyboard nudge. */
  onChange?: (hsv: HSV) => void;
  /** Fires once when a drag ends. */
  onChangeEnd?: (hsv: HSV) => void;
  disabled?: boolean;
  /** Accent color for the focus ring. */
  accent?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_HSV: HSV = { h: 0, s: 1, v: 1 };

/** A 2D saturation(X)/value(Y) square bound to its HSV's hue. The thumb sits at
 *  `left = s·100%`, `top = (1−v)·100%`; the hue paints the background via a
 *  `--hue` custom prop. Pointer-drag sets s,v together (setPointerCapture);
 *  Arrow keys nudge s (L/R) and v (U/D). role="slider". */
export const ColorField = forwardRef<HTMLDivElement, ColorFieldProps>(
  function ColorField(
    { value, defaultValue, onChange, onChangeEnd, disabled, accent, id, className, style, ...aria },
    forwardedRef,
  ) {
    const [hsv, setHsv] = useControllableState<HSV>(
      value,
      defaultValue ?? DEFAULT_HSV,
      onChange,
    );
    const [rootRef, setRef] = useMergedRef<HTMLDivElement>(forwardedRef);
    const startPointerSession = usePointerSession();
    const STEP = 0.01;

    const commit = (s: number, v: number): HSV => {
      const next: HSV = { ...hsv, s: roundTo(clamp(s, 0, 1), 4), v: roundTo(clamp(v, 0, 1), 4) };
      setHsv(next);
      return next;
    };

    const fromPointer = (clientX: number, clientY: number): HSV => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return hsv;
      const s = clamp((clientX - rect.left) / (rect.width || 1), 0, 1);
      const v = 1 - clamp((clientY - rect.top) / (rect.height || 1), 0, 1);
      return commit(s, v);
    };

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.focus();
      const start = hsv;
      let last = fromPointer(e.clientX, e.clientY);
      const move = (ev: PointerEvent) => {
        last = fromPointer(ev.clientX, ev.clientY);
      };
      startPointerSession({ move, up: () => onChangeEnd?.(last), onCancel: () => setHsv(start) });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let { s, v } = hsv;
      const big = e.shiftKey ? STEP * 10 : STEP;
      if (e.key === "ArrowRight") s += big;
      else if (e.key === "ArrowLeft") s -= big;
      else if (e.key === "ArrowUp") v += big;
      else if (e.key === "ArrowDown") v -= big;
      else if (e.key === "Home") s = 0;
      else if (e.key === "End") s = 1;
      else return;
      e.preventDefault();
      const next = commit(s, v);
      onChangeEnd?.(next);
    };

    const sPct = roundTo(clamp(hsv.s, 0, 1) * 100, 2);
    const vPct = roundTo((1 - clamp(hsv.v, 0, 1)) * 100, 2);

    return (
      <div
        ref={setRef}
        id={id}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={aria["aria-label"] ?? "Saturation and brightness"}
        aria-valuetext={`S ${Math.round(hsv.s * 100)}, V ${Math.round(hsv.v * 100)}`}
        aria-disabled={disabled || undefined}
        className={cx("monet-cv-colorfield", disabled && "is-disabled", className)}
        style={
          {
            "--accent": accent,
            "--hue": String(roundTo(hsv.h, 2)),
            background: satValSquareBg(hsv.h),
            ...style,
          } as CSSProperties
        }
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <div
          className="monet-cv-colorfield-thumb"
          aria-hidden="true"
          style={{ left: `${sPct}%`, top: `${vPct}%`, background: hsvToCss({ ...hsv, a: 1 }) }}
        />
      </div>
    );
  },
);

// ─── HueSlider ─────────────────────────────────────────────────

export interface HueSliderProps {
  /** Controlled hue 0..360. Omit (with `defaultValue`) for uncontrolled use. */
  value?: number;
  defaultValue?: number;
  onChange?: (hue: number) => void;
  onChangeEnd?: (hue: number) => void;
  vertical?: boolean;
  disabled?: boolean;
  accent?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

/** A 1D rainbow hue slider over 0..360 (Slider-core drag + keyboard).
 *  role="slider". */
export const HueSlider = forwardRef<HTMLDivElement, HueSliderProps>(
  function HueSlider(
    { value, defaultValue, onChange, onChangeEnd, vertical, disabled, accent, id, className, ...aria },
    forwardedRef,
  ) {
    const [hue, setHue] = useControllableState<number>(value, defaultValue ?? 0, onChange);
    const [trackRef, setRef] = useMergedRef<HTMLDivElement>(forwardedRef);
    const startPointerSession = usePointerSession();

    const commit = (h: number): number => {
      const next = roundTo(clamp(h, 0, 360), 2);
      setHue(next);
      return next;
    };
    const fromPointer = (clientX: number, clientY: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return hue;
      return commit(fracFromPointer(rect, clientX, clientY, !!vertical) * 360);
    };

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.focus();
      const start = hue;
      let last = fromPointer(e.clientX, e.clientY);
      const move = (ev: PointerEvent) => {
        last = fromPointer(ev.clientX, ev.clientY);
      };
      startPointerSession({ move, up: () => onChangeEnd?.(last), onCancel: () => setHue(start) });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let next = hue;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") next = hue + 1;
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = hue - 1;
      else if (e.key === "PageUp") next = hue + 10;
      else if (e.key === "PageDown") next = hue - 10;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = 360;
      else return;
      e.preventDefault();
      const c = commit(next);
      onChangeEnd?.(c);
    };

    const pct = roundTo((clamp(hue, 0, 360) / 360) * 100, 2);
    const knobStyle = (vertical ? { bottom: `${pct}%` } : { left: `${pct}%` }) as CSSProperties;

    return (
      <div
        ref={setRef}
        id={id}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={aria["aria-label"] ?? "Hue"}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={roundTo(hue, 2)}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-disabled={disabled || undefined}
        className={cx("monet-cv-hueslider", vertical && "is-vertical", disabled && "is-disabled", className)}
        style={{ "--accent": accent } as CSSProperties}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <div className="monet-cv-hueslider-track" aria-hidden="true" style={{ background: hueRainbowBg(!vertical) }} />
        <div
          className="monet-cv-hueslider-knob"
          aria-hidden="true"
          style={{ ...knobStyle, background: hsvToCss({ h: hue, s: 1, v: 1 }) }}
        />
      </div>
    );
  },
);

// ─── AlphaSlider ───────────────────────────────────────────────

export interface AlphaSliderProps {
  /** Controlled opacity 0..1. Omit (with `defaultValue`) for uncontrolled use. */
  value?: number;
  defaultValue?: number;
  onChange?: (alpha: number) => void;
  onChangeEnd?: (alpha: number) => void;
  /** The color the opacity ramp is tinted with. */
  color?: ColorValue;
  vertical?: boolean;
  disabled?: boolean;
  accent?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

/** A 1D opacity slider: a transparent→color ramp over a checkerboard, tinted by
 *  `color` via a `--tint` custom prop. role="slider". */
export const AlphaSlider = forwardRef<HTMLDivElement, AlphaSliderProps>(
  function AlphaSlider(
    { value, defaultValue, onChange, onChangeEnd, color = { h: 0, s: 0, v: 0 }, vertical, disabled, accent, id, className, ...aria },
    forwardedRef,
  ) {
    const [alpha, setAlpha] = useControllableState<number>(value, defaultValue ?? 1, onChange);
    const [trackRef, setRef] = useMergedRef<HTMLDivElement>(forwardedRef);
    const startPointerSession = usePointerSession();
    const tintHsv = toHsv(color);
    const tint = hsvToCss({ ...tintHsv, a: 1 });

    const commit = (a: number): number => {
      const next = roundTo(clamp(a, 0, 1), 4);
      setAlpha(next);
      return next;
    };
    const fromPointer = (clientX: number, clientY: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return alpha;
      return commit(fracFromPointer(rect, clientX, clientY, !!vertical));
    };

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.focus();
      const start = alpha;
      let last = fromPointer(e.clientX, e.clientY);
      const move = (ev: PointerEvent) => {
        last = fromPointer(ev.clientX, ev.clientY);
      };
      startPointerSession({ move, up: () => onChangeEnd?.(last), onCancel: () => setAlpha(start) });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let next = alpha;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") next = alpha + 0.01;
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = alpha - 0.01;
      else if (e.key === "PageUp") next = alpha + 0.1;
      else if (e.key === "PageDown") next = alpha - 0.1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = 1;
      else return;
      e.preventDefault();
      const c = commit(next);
      onChangeEnd?.(c);
    };

    const pct = roundTo(clamp(alpha, 0, 1) * 100, 2);
    const knobStyle = (vertical ? { bottom: `${pct}%` } : { left: `${pct}%` }) as CSSProperties;
    const rampDir = vertical ? "to top" : "to right";

    return (
      <div
        ref={setRef}
        id={id}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={aria["aria-label"] ?? "Opacity"}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={roundTo(alpha, 4)}
        aria-valuetext={`${Math.round(alpha * 100)}%`}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-disabled={disabled || undefined}
        className={cx("monet-cv-alphaslider", vertical && "is-vertical", disabled && "is-disabled", className)}
        style={{ "--accent": accent, "--tint": tint } as CSSProperties}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <div
          className="monet-cv-alphaslider-track"
          aria-hidden="true"
          style={{ "--ramp": `linear-gradient(${rampDir}, transparent, ${tint})` } as CSSProperties}
        />
        <div className="monet-cv-alphaslider-knob" aria-hidden="true" style={knobStyle} />
      </div>
    );
  },
);

// ─── ColorWheel ────────────────────────────────────────────────

export interface ColorWheelProps {
  value?: HSV;
  defaultValue?: HSV;
  onChange?: (hsv: HSV) => void;
  onChangeEnd?: (hsv: HSV) => void;
  /** Pixel diameter. Defaults to 56. */
  size?: number;
  disabled?: boolean;
  accent?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

/** A conic HSV wheel: angle = hue, radius = saturation. Polar drag maps the
 *  pointer to `h = (atan2(dy,dx)·180/π + 360) mod 360`, `s = min(1, hypot/r)`;
 *  value is preserved. role="slider". */
export const ColorWheel = forwardRef<HTMLDivElement, ColorWheelProps>(
  function ColorWheel(
    { value, defaultValue, onChange, onChangeEnd, size = 56, disabled, accent, id, className, ...aria },
    forwardedRef,
  ) {
    const [hsv, setHsv] = useControllableState<HSV>(value, defaultValue ?? DEFAULT_HSV, onChange);
    const [rootRef, setRef] = useMergedRef<HTMLDivElement>(forwardedRef);
    const startPointerSession = usePointerSession();

    const commit = (h: number, s: number): HSV => {
      const next: HSV = { ...hsv, h: roundTo(((h % 360) + 360) % 360, 2), s: roundTo(clamp(s, 0, 1), 4) };
      setHsv(next);
      return next;
    };

    const fromPointer = (clientX: number, clientY: number): HSV => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return hsv;
      const cx2 = rect.left + rect.width / 2;
      const cy2 = rect.top + rect.height / 2;
      const dx = clientX - cx2;
      const dy = clientY - cy2;
      const r = Math.min(rect.width, rect.height) / 2 || 1;
      const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const s = Math.min(1, Math.hypot(dx, dy) / r);
      return commit(h, s);
    };

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.focus();
      const start = hsv;
      let last = fromPointer(e.clientX, e.clientY);
      const move = (ev: PointerEvent) => {
        last = fromPointer(ev.clientX, ev.clientY);
      };
      startPointerSession({ move, up: () => onChangeEnd?.(last), onCancel: () => setHsv(start) });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let { h, s } = hsv;
      if (e.key === "ArrowRight") h += 2;
      else if (e.key === "ArrowLeft") h -= 2;
      else if (e.key === "ArrowUp") s += 0.02;
      else if (e.key === "ArrowDown") s -= 0.02;
      else if (e.key === "Home") s = 0;
      else if (e.key === "End") s = 1;
      else return;
      e.preventDefault();
      const next = commit(h, s);
      onChangeEnd?.(next);
    };

    // Thumb polar position → CSS left/top (center origin, radius = s).
    const rad = (hsv.h * Math.PI) / 180;
    const sat = clamp(hsv.s, 0, 1);
    const left = roundTo(50 + Math.cos(rad) * sat * 50, 2);
    const top = roundTo(50 + Math.sin(rad) * sat * 50, 2);

    return (
      <div
        ref={setRef}
        id={id}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={aria["aria-label"] ?? "Color wheel"}
        aria-valuetext={`H ${Math.round(hsv.h)}, S ${Math.round(hsv.s * 100)}`}
        aria-disabled={disabled || undefined}
        className={cx("monet-cv-colorwheel", disabled && "is-disabled", className)}
        style={{ "--accent": accent, width: size, height: size } as CSSProperties}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <div className="monet-cv-colorwheel-ring" aria-hidden="true" />
        <div
          className="monet-cv-colorwheel-thumb"
          aria-hidden="true"
          style={{ left: `${left}%`, top: `${top}%`, background: hsvToCss({ ...hsv, a: 1 }) }}
        />
      </div>
    );
  },
);

// ─── EyedropperReadout ─────────────────────────────────────────

export interface EyedropperReadoutProps {
  /** The color to display. */
  value: ColorValue;
  /** Readout format. Defaults to "hex". */
  format?: "hex" | "rgb" | "hsv";
  /** Optional secondary line under the value. */
  subtitle?: ReactNode;
  /** When set, renders a dropper IconButton that calls this on click. */
  onPick?: () => void;
  accent?: string;
  className?: string;
}

/** Format an HSV as the chosen readout string. */
function formatColor(hsv: HSV, format: "hex" | "rgb" | "hsv"): string {
  if (format === "rgb") {
    const { r, g, b } = hsvToRgb(hsv);
    return `${r}, ${g}, ${b}`;
  }
  if (format === "hsv") {
    return `${Math.round(hsv.h)}°, ${Math.round(hsv.s * 100)}%, ${Math.round(hsv.v * 100)}%`;
  }
  return hsvToHex(hsv).toUpperCase();
}

/** A swatch + monospace color readout (hex / rgb / hsv), with an optional
 *  dropper pick button. Display-only — it owns no color state. */
export const EyedropperReadout = forwardRef<HTMLDivElement, EyedropperReadoutProps>(
  function EyedropperReadout({ value, format = "hex", subtitle, onPick, accent, className }, ref) {
    const hsv = toHsv(value);
    return (
      <div
        ref={ref}
        className={cx("monet-cv-eyedropper", className)}
        style={{ "--accent": accent } as CSSProperties}
      >
        <span className="monet-swatch monet-cv-eyedropper-swatch" style={{ background: hsvToCss(hsv) }} aria-hidden="true" />
        <div className="monet-cv-eyedropper-text">
          <span className="monet-cv-eyedropper-value">{formatColor(hsv, format)}</span>
          {subtitle != null && <span className="monet-cv-eyedropper-sub">{subtitle}</span>}
        </div>
        {onPick && (
          <IconButton
            icon="dropper"
            aria-label="Pick color"
            size="sm"
            className="monet-cv-eyedropper-pick"
            onClick={onPick}
          />
        )}
      </div>
    );
  },
);

// ─── GradientEditor ────────────────────────────────────────────

/** Every gradient shape a Monet app can express. `linear`/`radial` are the two the
 *  editor toggles; the sweeps come from the raster side (Vision's Gradient tool) and
 *  ride through untouched so a gradient can cross apps without being flattened. */
export type GradientKind = "linear" | "radial" | "angle" | "reflected" | "diamond";

/** Tiling outside [0,1] (SVG spreadMethod). Absent ⇒ "pad". */
export type GradientSpread = "pad" | "reflect" | "repeat";

export interface GradientStop {
  id: string;
  /** Position along the bar, 0..1. */
  offset: number;
  color: ColorValue;
  /** Midpoint (0..1) of the blend toward the NEXT stop; absent ⇒ 0.5 (linear). */
  midpoint?: number;
}

/** The one gradient model every Monet app converts to and from. The editor only
 *  reads type/angle/stops, but it never drops the rest — the vector side's richer
 *  geometry (radial centre, radius, focal point, spread) rides along so a gradient
 *  survives a round trip through any app instead of flattening to artwork. */
export interface GradientValue {
  type: GradientKind;
  /** Linear gradient angle in degrees. */
  angle: number;
  stops: GradientStop[];
  /** Radial centre + radius, objectBoundingBox units (0..1). */
  cx?: number;
  cy?: number;
  r?: number;
  /** Radial focal point (objectBoundingBox units). */
  fx?: number;
  fy?: number;
  spread?: GradientSpread;
}

export interface GradientEditorProps {
  value?: GradientValue;
  defaultValue?: GradientValue;
  onChange?: (value: GradientValue) => void;
  onChangeEnd?: (value: GradientValue) => void;
  /** Controlled selected stop id. */
  selectedStop?: string;
  onSelectStop?: (id: string) => void;
  /** Fires when a stop's swatch is activated (host opens a color picker). */
  onRequestStopColor?: (id: string) => void;
  accent?: string;
  className?: string;
}

let gradStopSeq = 0;
const nextStopId = () => `grad-stop-${++gradStopSeq}`;

const DEFAULT_GRADIENT: GradientValue = {
  type: "linear",
  angle: 90,
  stops: [
    { id: "grad-a", offset: 0, color: { h: 0, s: 0, v: 0 } },
    { id: "grad-b", offset: 1, color: { h: 0, s: 0, v: 1 } },
  ],
};

/** A gradient bar with draggable color stops. Drag a stop handle to move its
 *  offset (setPointerCapture); click the track to add an interpolated stop;
 *  Delete removes the selected stop (min 2 kept). The type is chosen with a
 *  SegmentedControl-style toggle, the angle with an AngleDial. Each handle is
 *  role="slider" labelled "Stop at N%". */
export const GradientEditor = forwardRef<HTMLDivElement, GradientEditorProps>(
  function GradientEditor(
    { value, defaultValue, onChange, onChangeEnd, selectedStop, onSelectStop, onRequestStopColor, accent, className },
    forwardedRef,
  ) {
    const [grad, setGrad] = useControllableState<GradientValue>(
      value,
      defaultValue ?? DEFAULT_GRADIENT,
      onChange,
    );
    const [internalSel, setInternalSel] = useState<string | undefined>(grad.stops[0]?.id);
    const selectedId = selectedStop ?? internalSel;
    const [barRef, setBarRef] = useMergedRef<HTMLDivElement>(forwardedRef);
    const startPointerSession = usePointerSession();

    const select = (id: string) => {
      if (selectedStop === undefined) setInternalSel(id);
      onSelectStop?.(id);
    };
    const emit = (next: GradientValue, end: boolean) => {
      setGrad(next);
      if (end) onChangeEnd?.(next);
    };
    const sorted = [...grad.stops].sort((a, b) => a.offset - b.offset);

    const offsetFromPointer = (clientX: number): number => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return clamp((clientX - rect.left) / (rect.width || 1), 0, 1);
    };

    const moveStop = (id: string, offset: number, end: boolean) => {
      const next = {
        ...grad,
        stops: grad.stops.map((s) => (s.id === id ? { ...s, offset: roundTo(clamp(offset, 0, 1), 4) } : s)),
      };
      emit(next, end);
    };

    const onStopPointerDown = (id: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.focus();
      select(id);
      const start = grad;
      let last = grad.stops.find((s) => s.id === id)?.offset ?? 0;
      // (#202) Clicking a stop only selects it. Committing `last` (still the
      // stop's current offset) emitted an onChange + onChangeEnd carrying an
      // unchanged value, so hosts that push history on the commit signal
      // recorded a no-op undo step for a pure selection click.
      let moved = false;
      const move = (ev: PointerEvent) => {
        last = offsetFromPointer(ev.clientX);
        moved = true;
        moveStop(id, last, false);
      };
      startPointerSession({
        move,
        up: () => { if (moved) moveStop(id, last, true); },
        onCancel: () => { if (moved) setGrad(start); },
      });
    };

    // Click the track (not a handle) → add an interpolated stop at that offset.
    const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const offset = offsetFromPointer(e.clientX);
      const id = nextStopId();
      const color = sampleGradient(grad.stops, offset);
      const next = { ...grad, stops: [...grad.stops, { id, offset: roundTo(offset, 4), color }] };
      emit(next, true);
      select(id);
    };

    const removeStop = (id: string) => {
      if (grad.stops.length <= 2) return;
      const next = { ...grad, stops: grad.stops.filter((s) => s.id !== id) };
      emit(next, true);
      if (selectedId === id) select(next.stops[0].id);
    };

    const onStopKeyDown = (id: string) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      const stop = grad.stops.find((s) => s.id === id);
      if (!stop) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeStop(id);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onRequestStopColor?.(id);
        return;
      }
      let next = stop.offset;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") next += e.shiftKey ? 0.1 : 0.01;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next -= e.shiftKey ? 0.1 : 0.01;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = 1;
      else return;
      e.preventDefault();
      moveStop(id, next, true);
    };

    const setType = (type: "linear" | "radial") => emit({ ...grad, type }, true);

    // The preview only knows the two CSS gradient shapes; a sweep kind (angle /
    // reflected / diamond) previews as linear but stays intact in the value.
    const previewCss = gradientCss(grad.stops, grad.type === "radial" ? "radial" : "linear", grad.angle);

    return (
      <div
        className={cx("monet-cv-gradient", className)}
        style={{ "--accent": accent } as CSSProperties}
      >
        <div
          ref={setBarRef}
          className="monet-cv-gradient-bar"
          style={{ "--gradient": previewCss } as CSSProperties}
          onPointerDown={onTrackPointerDown}
        >
          <div className="monet-cv-gradient-preview" aria-hidden="true" style={{ background: previewCss }} />
          {sorted.map((stop) => {
            const pct = roundTo(clamp(stop.offset, 0, 1) * 100, 2);
            const isSel = stop.id === selectedId;
            return (
              <div
                key={stop.id}
                role="slider"
                tabIndex={0}
                aria-label={`Stop at ${Math.round(stop.offset * 100)}%`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(stop.offset * 100)}
                className={cx("monet-cv-gradient-stop", isSel && "is-selected")}
                style={{ left: `${pct}%`, "--stop-color": hsvToCss(toHsv(stop.color)) } as CSSProperties}
                onPointerDown={onStopPointerDown(stop.id)}
                onKeyDown={onStopKeyDown(stop.id)}
                onDoubleClick={() => onRequestStopColor?.(stop.id)}
              />
            );
          })}
        </div>
        <div className="monet-cv-gradient-controls">
          <div className="monet-cv-gradient-types" role="radiogroup" aria-label="Gradient type">
            {(["linear", "radial"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={grad.type === t}
                className={cx("monet-chip", "monet-cv-gradient-type", grad.type === t && "is-active")}
                onClick={() => setType(t)}
              >
                {t === "linear" ? "Linear" : "Radial"}
              </button>
            ))}
          </div>
          {grad.type !== "radial" && (
            <AngleDial
              size={28}
              min={0}
              max={360}
              accent={accent}
              aria-label="Gradient angle"
              value={grad.angle}
              onChange={(d) => setGrad({ ...grad, angle: d })}
              onChangeEnd={(d) => emit({ ...grad, angle: d }, true)}
            />
          )}
        </div>
      </div>
    );
  },
);

// ─── ColorPicker ───────────────────────────────────────────────

export interface ColorPickerProps {
  value?: ColorValue;
  defaultValue?: ColorValue;
  onChange?: (hsv: HSV) => void;
  onChangeEnd?: (hsv: HSV) => void;
  /** Which numeric input rows to show. Defaults to ["hex","rgb"]. */
  inputs?: Array<"hex" | "rgb" | "hsv">;
  /** Show the alpha slider. Defaults to true. */
  alpha?: boolean;
  /** Swatch hex strings rendered as a quick-pick row. */
  swatches?: string[];
  /** Fires the current color as a canonical (lowercase) "#rrggbb" when the
   *  "add swatch" button is pressed. */
  onSwatchAdd?: (hex: string) => void;
  accent?: string;
  id?: string;
  className?: string;
}

/** The composite color picker: a ColorField + HueSlider + (optional)
 *  AlphaSlider, hex/rgb/hsv inputs, and a swatch quick-pick row. Owns a single
 *  HSV via useControllableState and keeps every sub-control in sync. */
export const ColorPicker = forwardRef<HTMLDivElement, ColorPickerProps>(
  function ColorPicker(
    { value, defaultValue, onChange, onChangeEnd, inputs = ["hex", "rgb"], alpha = true, swatches, onSwatchAdd, accent, id, className },
    ref,
  ) {
    const seed = defaultValue != null ? toHsv(defaultValue) : { h: 210, s: 0.6, v: 0.9, a: 1 };
    const controlled = value != null ? toHsv(value) : undefined;
    const [hsv, setHsv] = useControllableState<HSV>(controlled, seed, onChange);
    const end = (h: HSV) => onChangeEnd?.(h);

    const patch = (p: Partial<HSV>, commit = false) => {
      const next = { ...hsv, ...p };
      setHsv(next);
      if (commit) end(next);
    };

    const rgb = hsvToRgb(hsv);
    const setRgb = (chan: "r" | "g" | "b", v: number) => {
      const nextRgb: RGB = { ...rgb, [chan]: clamp(v, 0, 255) };
      const conv = rgbToHsv(nextRgb);
      // keep the picker's hue/alpha when the RGB collapses to grey (s=0)
      const next: HSV = {
        h: conv.s === 0 ? hsv.h : conv.h,
        s: conv.s,
        v: conv.v,
        a: hsv.a,
      };
      setHsv(next);
      end(next);
    };

    return (
      <div
        ref={ref}
        id={id}
        className={cx("monet-cv-colorpicker", className)}
        style={{ "--accent": accent } as CSSProperties}
      >
        <ColorField
          accent={accent}
          value={hsv}
          onChange={(h) => patch({ s: h.s, v: h.v })}
          onChangeEnd={(h) => end({ ...hsv, s: h.s, v: h.v })}
        />
        <div className="monet-cv-colorpicker-sliders">
          <HueSlider
            accent={accent}
            value={hsv.h}
            onChange={(h) => patch({ h })}
            onChangeEnd={(h) => end({ ...hsv, h })}
          />
          {alpha && (
            <AlphaSlider
              accent={accent}
              color={hsv}
              value={hsv.a ?? 1}
              onChange={(a) => patch({ a })}
              onChangeEnd={(a) => end({ ...hsv, a })}
            />
          )}
        </div>
        <div className="monet-cv-colorpicker-inputs">
          {inputs.includes("hex") && (
            <label className="monet-cv-colorpicker-input is-hex">
              <span className="monet-cv-colorpicker-input-label">Hex</span>
              <HexInput
                aria-label="Hex"
                value={hsvToHex(hsv)}
                onChange={(hex) => {
                  const conv = hexToHsv(hex);
                  if (conv) {
                    const next: HSV = { h: conv.s === 0 ? hsv.h : conv.h, s: conv.s, v: conv.v, a: hsv.a };
                    setHsv(next);
                    end(next);
                  }
                }}
              />
            </label>
          )}
          {inputs.includes("rgb") && (
            <div className="monet-cv-colorpicker-rgb">
              {(["r", "g", "b"] as const).map((chan) => (
                <label key={chan} className="monet-cv-colorpicker-input">
                  <span className="monet-cv-colorpicker-input-label">{chan.toUpperCase()}</span>
                  <NumberField
                    size="sm"
                    min={0}
                    max={255}
                    step={1}
                    aria-label={chan.toUpperCase()}
                    value={rgb[chan]}
                    onChange={(v) => setRgb(chan, v)}
                  />
                </label>
              ))}
            </div>
          )}
          {inputs.includes("hsv") && (
            <div className="monet-cv-colorpicker-hsv">
              <label className="monet-cv-colorpicker-input">
                <span className="monet-cv-colorpicker-input-label">H</span>
                <NumberField size="sm" min={0} max={360} step={1} aria-label="H" value={roundTo(hsv.h, 0)} onChange={(h) => patch({ h }, true)} />
              </label>
              <label className="monet-cv-colorpicker-input">
                <span className="monet-cv-colorpicker-input-label">S</span>
                <NumberField size="sm" min={0} max={100} step={1} suffix="%" aria-label="S" value={Math.round(hsv.s * 100)} onChange={(s) => patch({ s: clamp(s / 100, 0, 1) }, true)} />
              </label>
              <label className="monet-cv-colorpicker-input">
                <span className="monet-cv-colorpicker-input-label">V</span>
                <NumberField size="sm" min={0} max={100} step={1} suffix="%" aria-label="V" value={Math.round(hsv.v * 100)} onChange={(v) => patch({ v: clamp(v / 100, 0, 1) }, true)} />
              </label>
            </div>
          )}
        </div>
        {swatches != null && (
          <div className="monet-cv-colorpicker-swatches">
            {swatches.map((sw, i) => (
              <Swatch
                key={`${sw}-${i}`}
                color={sw}
                aria-label={sw}
                onClick={() => {
                  const conv = hexToHsv(sw);
                  if (conv) {
                    const next: HSV = { ...conv, a: hsv.a };
                    setHsv(next);
                    end(next);
                  }
                }}
              />
            ))}
            {onSwatchAdd && (
              <button
                type="button"
                aria-label="Add swatch"
                className="monet-iconbtn monet-cv-colorpicker-add"
                onClick={() => onSwatchAdd(hsvToHex(hsv))}
              >
                <Icon d={I.plus} size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  },
);

// ─── palette leaves (re-exported) ──────────────────────────────
// Swatch / SwatchGrid / GlyphGrid / HexInput live in ./creative-color-palette
// (split out for file size) and are re-exported here so creative-color remains
// the single public module (mirrors the creative-numeric / creative-tree split).
export {
  Swatch,
  SwatchGrid,
  GlyphGrid,
  HexInput,
} from "./creative-color-palette";
export type {
  SwatchProps,
  SwatchItem,
  SwatchGridProps,
  GlyphItem,
  GlyphGridProps,
  HexInputProps,
} from "./creative-color-palette";
