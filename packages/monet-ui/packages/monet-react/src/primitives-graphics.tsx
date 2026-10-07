// ─────────────────────────────────────────────────────────────
// Monet Panel System — graphics/value primitives
// ─────────────────────────────────────────────────────────────
// Self-contained leaf widgets used inside panels: the accessible range
// Slider and the decorative Waveform. Split out of primitives.tsx purely for
// file size; both are re-exported from primitives.tsx (and the package barrel)
// so the public surface is unchanged.
//
// All visuals come from monet-core/styles.css.

import React from "react";
import { usePointerSession } from "./internal";

// ─── slider ────────────────────────────────────────────────────
// Functional, accessible range slider. Keeps the original .monet-slider DOM
// (track + .fill + .knob) so existing apps render identically, and stays
// backward compatible with `<Slider value={0.68} accent={…}/>`.
//
//   • controlled when `onChange` is given, otherwise uncontrolled internal state
//   • min/max/step default to 0..1 (so a bare `value` prop positions as before)
//   • pointer-drag on the track or knob; click to jump
//   • keyboard: Arrow keys (±step), Home/End (min/max), PageUp/Down (±10·step)
//   • role="slider" + aria-valuemin/max/now + aria-orientation, tabIndex
//   • `vertical` flips the axis; `disabled` inerts it
export interface SliderProps {
  /** Current value. With no min/max this is the 0..1 fill fraction. */
  value?: number;
  /** Accent color for the fill/glow (CSS color or `var(--accent…)`). */
  accent?: string;
  /** Fires with the next clamped, stepped value. Omit for uncontrolled use. */
  onChange?: (value: number) => void;
  /** Called once when a pointer drag ends (good for committing edits). */
  onChangeEnd?: (value: number) => void;
  min?: number;
  max?: number;
  /** Step granularity. Defaults to 0.01 over a 0..1 range. */
  step?: number;
  /** Larger increment for PageUp/PageDown. Defaults to step * 10. */
  pageStep?: number;
  disabled?: boolean;
  /** Orient bottom-to-top instead of left-to-right. */
  vertical?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const Slider = React.forwardRef<HTMLDivElement, SliderProps>(function Slider(
  {
    value,
    accent,
    onChange,
    onChangeEnd,
    min = 0,
    max = 1,
    step,
    pageStep,
    disabled,
    vertical,
    id,
    className,
    style,
    ...aria
  },
  forwardedRef,
) {
  const span = max - min || 1;
  const stepSize = step ?? span / 100;
  const big = pageStep ?? stepSize * 10;
  // Controlled when an onChange handler is supplied; otherwise uncontrolled,
  // with internal state seeded from `value` so a bare `value` prop still sets
  // the initial position (backward compatible with the static examples).
  const isControlled = onChange !== undefined;
  const [internal, setInternal] = React.useState<number>(value ?? min);
  const current = isControlled ? (value ?? min) : internal;
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const startPointerSession = usePointerSession();

  const setRef = (el: HTMLDivElement | null) => {
    trackRef.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  };

  const clampStep = (n: number) => {
    const clamped = Math.min(max, Math.max(min, n));
    const snapped = min + Math.round((clamped - min) / stepSize) * stepSize;
    // round away binary-float fuzz introduced by the snap math
    const decimals = (String(stepSize).split(".")[1] || "").length;
    const v = Math.min(max, Math.max(min, snapped));
    return decimals ? Number(v.toFixed(decimals)) : v;
  };

  const commit = (n: number) => {
    const next = clampStep(n);
    if (next === current) return;
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };

  // pointer position → value along the active axis
  const valueFromPointer = (clientX: number, clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return current;
    const frac = vertical
      ? 1 - (clientY - rect.top) / (rect.height || 1)
      : (clientX - rect.left) / (rect.width || 1);
    return min + Math.min(1, Math.max(0, frac)) * span;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    trackRef.current?.focus();
    const start = current;
    let last = valueFromPointer(e.clientX, e.clientY);
    commit(last);
    const move = (ev: PointerEvent) => {
      last = valueFromPointer(ev.clientX, ev.clientY);
      commit(last);
    };
    startPointerSession({
      move,
      up: () => onChangeEnd?.(clampStep(last)),
      onCancel: () => {
        if (!isControlled) setInternal(start);
        else onChange?.(start);
      },
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next = current;
    // Up/Right always increase, Down/Left always decrease (both orientations).
    if (e.key === "ArrowUp" || e.key === "ArrowRight") next = current + stepSize;
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = current - stepSize;
    else if (e.key === "PageUp") next = current + big;
    else if (e.key === "PageDown") next = current - big;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    else return;
    e.preventDefault();
    commit(next);
    onChangeEnd?.(clampStep(next));
  };

  const pct = (Math.min(max, Math.max(min, current)) - min) / span * 100;
  const fillStyle = vertical ? { height: `${pct}%`, width: undefined, top: "auto", bottom: 0 } : { width: `${pct}%` };
  const knobStyle = vertical ? { bottom: `${pct}%`, top: "auto", left: "50%" } : { left: `${pct}%` };

  return (
    <div
      ref={setRef}
      id={id}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clampStep(current)}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-disabled={disabled || undefined}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      aria-describedby={aria["aria-describedby"]}
      className={`monet-slider${vertical ? " is-vertical" : ""}${disabled ? " is-disabled" : ""}${className ? " " + className : ""}`}
      style={{ "--accent": accent, ...style } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <div className="fill" style={fillStyle as React.CSSProperties}/>
      <div className="knob" style={knobStyle as React.CSSProperties}/>
    </div>
  );
});

// ─── waveform helper ───────────────────────────────────────────
export interface WaveformProps {
  width?: number;
  height?: number;
  /** PRNG seed for the bar heights — same seed renders the same waveform. */
  seed?: number;
  /** Accent color for the peak bars (CSS color or `var(--accent…)`). */
  accent?: string;
}

export function Waveform({ width = 240, height = 60, seed = 1, accent }: WaveformProps) {
  const bars = 60;
  const path: string[] = [];
  const peakPath: string[] = [];
  let rnd = seed;
  const random = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
  for (let i = 0; i < bars; i++) {
    const h = 0.2 + 0.8 * Math.pow(Math.abs(Math.sin(i * 0.3)) * (0.5 + random() * 0.5), 0.7);
    const isPeak = h > 0.7;
    const x = (i / bars) * width;
    const w = (width / bars) * 0.7;
    const y = height / 2 - (h * height) / 2;
    const rect = `M${x} ${y}h${w}v${h * height}h-${w}z`;
    (isPeak ? peakPath : path).push(rect);
  }
  return (
    <svg className="monet-wave" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ "--accent": accent } as React.CSSProperties}>
      <path d={path.join(" ")}/>
      <path className="peak" d={peakPath.join(" ")}/>
    </svg>
  );
}
