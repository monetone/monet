// ─────────────────────────────────────────────────────────────
// Monet — creative numeric / transform controls ("monet-cv-")
// ─────────────────────────────────────────────────────────────
// Mocked-but-sharable numeric scrubbers and transform widgets in the spirit of
// pro creative apps (After Effects / Photoshop / Figma inspectors). Behaviour
// (drag-to-scrub, keyboard nudges, clamp/precision, ARIA) lives here; visuals
// come from @monet-ui/monet-core/creative.css (the "monet-cv-" rules).
//
// The drag/keyboard/clamp/precision patterns mirror the Slider (drag) and
// NumberField (clamp/round/draft/commit) sources — see primitives-graphics.tsx
// and controls.tsx. All values flow through onChange-family callbacks so the
// controls drive real interaction even though host data is mocked.
//
// Components:
//   <PropertyRow>      structural inspector row over .monet-row
//   <ScrubbyNumber>    horizontal drag-to-scrub number + type-to-edit
//   <Stepper>          compact inc/dec with optional spinbutton readout
//   <RangeSlider>      two-thumb min/max range
//   <AngleDial>        rotary degree dial (drag the needle)
//   <Knob>             AngleDial preset with a bottom dead-arc
//   <TransformFields>  X/Y/W/H + rotation group with aspect lock

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Icon, I } from "./icons";
import { NumberField } from "./controls";
import { useControllableState, cx, clamp, roundTo } from "./internal";

// ─── shared helpers ────────────────────────────────────────────

/** Decimal places implied by a `step` value ("0.1" → 1, "1" → 0). Mirrors the
 *  precision inference NumberField uses, kept local to this module. */
function precisionOf(step: number): number {
  if (!isFinite(step)) return 0;
  const s = String(step);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Clamp + snap `n` to the [min,max] grid defined by `step`, rounded to `prec`
 *  decimals so snap math never leaves binary-float dust. */
function snap(n: number, min: number, max: number, step: number, prec: number): number {
  const c = clamp(n, min, max);
  const snapped = min + Math.round((c - min) / step) * step;
  return roundTo(clamp(snapped, min, max), prec);
}

/** Bind one window-level pointer drag session (move + end). (#192) The end
 *  teardown is shared by `pointerup` AND `pointercancel` — a touch pan cancels
 *  the gesture and never fires pointerup — and the live session is detached on
 *  unmount, so a drag can't outlive the control that started it. */
function useDragSession() {
  const detach = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    detach.current?.();
    detach.current = null;
  }, []);
  return useCallback(
    (move: (e: PointerEvent) => void, end: () => void) => {
      function stop() {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        detach.current = null;
      }
      function finish() {
        stop();
        end();
      }
      detach.current?.(); // never stack two sessions
      detach.current = stop;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [],
  );
}

// ─── PropertyRow ───────────────────────────────────────────────

export interface PropertyRowProps {
  /** Leading label. Rendered as a <label htmlFor> when `htmlFor` is set. */
  label?: ReactNode;
  /** Control slot (the main editable widget). */
  children?: ReactNode;
  /** Right-aligned monospace readout (→ .val). */
  value?: ReactNode;
  /** Boxed field readout (→ .field). */
  fieldValue?: ReactNode;
  /** Leading icon slot, before the label. */
  icon?: ReactNode;
  /** Associate the label with a control id (renders <label htmlFor>). */
  htmlFor?: string;
  className?: string;
  style?: CSSProperties;
}

/** Structural inspector row built on the chrome `.monet-row` (label · control ·
 *  readout). Purely presentational — carries no role. */
export function PropertyRow({
  label,
  children,
  value,
  fieldValue,
  icon,
  htmlFor,
  className,
  style,
}: PropertyRowProps) {
  return (
    <div className={cx("monet-row", "monet-cv-row", className)} style={style}>
      {icon != null && (
        <span className="monet-cv-row-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {label != null &&
        (htmlFor ? (
          <label className="lbl" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="lbl">{label}</span>
        ))}
      {children}
      {fieldValue != null && <span className="field">{fieldValue}</span>}
      {value != null && <span className="val">{value}</span>}
    </div>
  );
}

// ─── ScrubbyNumber ─────────────────────────────────────────────

export interface ScrubbyNumberProps {
  /** Controlled value. Omit (with `defaultValue`) for uncontrolled use. */
  value?: number;
  /** Initial value when uncontrolled. Defaults to `min` (or 0). */
  defaultValue?: number;
  /** Fires with the next clamped value (on each scrub tick / edit commit). */
  onChange?: (value: number) => void;
  /** Fires once when a scrub drag ends. */
  onChangeEnd?: (value: number) => void;
  min?: number;
  max?: number;
  /** Increment per step. Defaults to 1. */
  step?: number;
  /** Larger increment for PageUp/PageDown. Defaults to step * 10. */
  pageStep?: number;
  /** Decimal places to render. Inferred from `step` when omitted. */
  precision?: number;
  /** Pixels of horizontal drag per `step`. Defaults to 2. */
  dragSensitivity?: number;
  /** Unit suffix shown after the value (e.g. "px", "°"). */
  suffix?: string;
  /** Leading label scrubbed by dragging. */
  label?: ReactNode;
  disabled?: boolean;
  /** Accent color for the focus ring / scrub affordance. */
  accent?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

/** A number you drag horizontally to change (the AE/PS "scrubby" control).
 *  Dragging the label/chrome scrubs the value (Shift = ×10, Alt = ÷10); a click
 *  without movement focuses the inner input for direct typing. Committed values
 *  are clamped + rounded like NumberField. role="spinbutton". */
export const ScrubbyNumber = forwardRef<HTMLDivElement, ScrubbyNumberProps>(
  function ScrubbyNumber(
    {
      value,
      defaultValue,
      onChange,
      onChangeEnd,
      min = -Infinity,
      max = Infinity,
      step = 1,
      pageStep,
      precision,
      dragSensitivity = 2,
      suffix,
      label,
      disabled,
      accent,
      id,
      className,
      ...aria
    },
    forwardedRef,
  ) {
    const prec = precision ?? precisionOf(step);
    const big = pageStep ?? step * 10;
    const seed = defaultValue ?? (isFinite(min) ? min : 0);
    const [num, setNum] = useControllableState<number>(value, seed, onChange);
    const [dragging, setDragging] = useState(false);
    const [editing, setEditing] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const startDrag = useDragSession();
    const autoId = useId();
    const fieldId = id ?? `monet-cv-scrub-${autoId}`;

    const commit = (n: number) => {
      if (!isFinite(n)) return num;
      const next = roundTo(clamp(n, min, max), prec);
      setNum(next);
      return next;
    };

    // pointer-drag on the label/chrome scrubs; a click without movement focuses
    // the input for direct typing (mirrors the AE/PS scrubby affordance).
    const onScrubPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startVal = num;
      let moved = false;
      let last = startVal;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) > 3) {
          moved = true;
          setDragging(true);
        }
        if (!moved) return;
        // Shift accelerates ×10, Alt fine-tunes ÷10 (per-step magnitude).
        const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        const steps = (dx / Math.max(1, dragSensitivity)) * mult;
        last = commit(startVal + steps * step);
      };
      startDrag(move, () => {
        if (moved) {
          setDragging(false);
          onChangeEnd?.(last);
        } else {
          // a plain click → enter type-to-edit mode and focus the input
          setEditing(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      // (#185) while the type-to-edit input is open its keydowns bubble here —
      // leave Arrow/Home/End to the caret instead of nudging the value.
      if (disabled || editing) return;
      let next: number | null = null;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") next = num + step;
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = num - step;
      else if (e.key === "PageUp") next = num + big;
      else if (e.key === "PageDown") next = num - big;
      else if (e.key === "Home" && isFinite(min)) next = min;
      else if (e.key === "End" && isFinite(max)) next = max;
      else return;
      e.preventDefault();
      // commit unconditionally — optional chaining on onChangeEnd would
      // short-circuit and skip the commit() argument when no handler is set.
      const committed = commit(next);
      onChangeEnd?.(committed);
    };

    const display = prec > 0 ? num.toFixed(prec) : String(num);

    return (
      <div
        ref={forwardedRef}
        id={fieldId}
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={aria["aria-label"]}
        aria-valuenow={num}
        aria-valuemin={isFinite(min) ? min : undefined}
        aria-valuemax={isFinite(max) ? max : undefined}
        aria-valuetext={suffix ? `${display}${suffix}` : undefined}
        aria-disabled={disabled || undefined}
        className={cx(
          "monet-cv-scrub",
          dragging && "is-dragging",
          editing && "is-editing",
          disabled && "is-disabled",
          className,
        )}
        style={{ "--accent": accent } as CSSProperties}
        onKeyDown={onKeyDown}
      >
        {label != null && (
          <span
            className="monet-cv-scrub-label"
            onPointerDown={onScrubPointerDown}
          >
            {label}
          </span>
        )}
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            tabIndex={-1}
            aria-hidden="true"
            defaultValue={display}
            disabled={disabled}
            className="monet-cv-scrub-input"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commit(Number((e.target as HTMLInputElement).value));
                setEditing(false);
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
            onBlur={(e) => {
              commit(Number(e.target.value));
              setEditing(false);
            }}
          />
        ) : (
          <span
            className="monet-cv-scrub-value"
            onPointerDown={onScrubPointerDown}
          >
            {display}
            {suffix && <span className="monet-cv-scrub-suffix">{suffix}</span>}
          </span>
        )}
      </div>
    );
  },
);

// ─── Stepper ───────────────────────────────────────────────────

export interface StepperProps {
  /** Controlled value. Omit (with `defaultValue`) for uncontrolled use. */
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  /** Increment per press. Defaults to 1. */
  step?: number;
  /** Show the middle value readout (role="spinbutton"). Defaults to true. */
  showValue?: boolean;
  /** Unit suffix shown after the value. */
  suffix?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  "aria-label"?: string;
  className?: string;
}

/** Compact increment/decrement control — two icon buttons that disable at the
 *  bounds, with an optional middle spinbutton readout (Arrow keys nudge). */
export const Stepper = forwardRef<HTMLDivElement, StepperProps>(function Stepper(
  {
    value,
    defaultValue = 0,
    onChange,
    min = -Infinity,
    max = Infinity,
    step = 1,
    showValue = true,
    suffix,
    disabled,
    size = "sm",
    className,
    ...aria
  },
  forwardedRef,
) {
  const prec = precisionOf(step);
  const [num, setNum] = useControllableState<number>(value, defaultValue, onChange);
  const nudge = (delta: number) => {
    if (disabled) return;
    setNum(roundTo(clamp(num + delta, min, max), prec));
  };
  const atMin = num <= min;
  const atMax = num >= max;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); nudge(step); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); nudge(-step); }
    else if (e.key === "Home" && isFinite(min)) { e.preventDefault(); setNum(min); }
    else if (e.key === "End" && isFinite(max)) { e.preventDefault(); setNum(max); }
  };

  const display = prec > 0 ? num.toFixed(prec) : String(num);
  const dim = size === "sm" ? 14 : 16;

  return (
    <div
      ref={forwardedRef}
      className={cx("monet-cv-stepper", `is-${size}`, disabled && "is-disabled", className)}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled || atMin}
        className="monet-iconbtn monet-cv-stepper-btn is-dec"
        onClick={() => nudge(-step)}
      >
        <Icon d={I.minus} size={dim} />
      </button>
      {showValue && (
        <span
          role="spinbutton"
          tabIndex={disabled ? -1 : 0}
          aria-label={aria["aria-label"]}
          aria-valuenow={num}
          aria-valuemin={isFinite(min) ? min : undefined}
          aria-valuemax={isFinite(max) ? max : undefined}
          aria-disabled={disabled || undefined}
          className="monet-cv-stepper-value"
          onKeyDown={onKeyDown}
        >
          {display}
          {suffix && <span className="monet-cv-stepper-suffix">{suffix}</span>}
        </span>
      )}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled || atMax}
        className="monet-iconbtn monet-cv-stepper-btn is-inc"
        onClick={() => nudge(step)}
      >
        <Icon d={I.plus} size={dim} />
      </button>
    </div>
  );
});

// ─── RangeSlider ───────────────────────────────────────────────

export interface RangeValue {
  min: number;
  max: number;
}

export interface RangeSliderProps {
  /** Controlled range. Omit (with `defaultValue`) for uncontrolled use. */
  value?: RangeValue;
  defaultValue?: RangeValue;
  onChange?: (range: RangeValue) => void;
  /** Fires once when a thumb drag ends. */
  onChangeEnd?: (range: RangeValue) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Minimum gap enforced between the two thumbs. Defaults to 0. */
  minGap?: number;
  vertical?: boolean;
  disabled?: boolean;
  accent?: string;
  "aria-label"?: string;
  className?: string;
}

type RangeBound = "min" | "max";

/** A two-thumb range slider. Each thumb drags like the Slider core and clamps
 *  against the other thumb ± `minGap`; the fill spans between them. root
 *  role="group"; thumbs are role="slider" labelled "Minimum" / "Maximum". */
export const RangeSlider = forwardRef<HTMLDivElement, RangeSliderProps>(
  function RangeSlider(
    {
      value,
      defaultValue,
      onChange,
      onChangeEnd,
      min = 0,
      max = 1,
      step,
      minGap = 0,
      vertical,
      disabled,
      accent,
      className,
      ...aria
    },
    forwardedRef,
  ) {
    const span = max - min || 1;
    const stepSize = step ?? span / 100;
    const prec = precisionOf(stepSize);
    const seed = defaultValue ?? { min, max };
    const [range, setRange] = useControllableState<RangeValue>(value, seed, onChange);
    // (#184) pointer math must use the INNER track — the root is padded, and the
    // thumb/fill percentages are relative to the track's box, not the root's.
    const trackRef = useRef<HTMLDivElement | null>(null);
    const startDrag = useDragSession();

    const setRef = (el: HTMLDivElement | null) => {
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef)
        (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    };

    const valueFromPointer = (clientX: number, clientY: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return range.min;
      const frac = vertical
        ? 1 - (clientY - rect.top) / (rect.height || 1)
        : (clientX - rect.left) / (rect.width || 1);
      return min + clamp(frac, 0, 1) * span;
    };

    // moving one thumb clamps it against the other ± minGap, then snaps.
    const apply = (bound: RangeBound, raw: number): RangeValue => {
      if (bound === "min") {
        const hi = range.max - minGap;
        return { min: snap(Math.min(raw, hi), min, max, stepSize, prec), max: range.max };
      }
      const lo = range.min + minGap;
      return { min: range.min, max: snap(Math.max(raw, lo), min, max, stepSize, prec) };
    };

    const onThumbPointerDown =
      (bound: RangeBound) => (e: ReactPointerEvent<HTMLDivElement>) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        (e.currentTarget as HTMLElement).focus();
        let next = apply(bound, valueFromPointer(e.clientX, e.clientY));
        setRange(next);
        const move = (ev: PointerEvent) => {
          next = apply(bound, valueFromPointer(ev.clientX, ev.clientY));
          setRange(next);
        };
        startDrag(move, () => onChangeEnd?.(next));
      };

    const onThumbKeyDown =
      (bound: RangeBound) => (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (disabled) return;
        const cur = range[bound];
        let raw = cur;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") raw = cur + stepSize;
        else if (e.key === "ArrowDown" || e.key === "ArrowLeft") raw = cur - stepSize;
        else if (e.key === "PageUp") raw = cur + stepSize * 10;
        else if (e.key === "PageDown") raw = cur - stepSize * 10;
        else if (e.key === "Home") raw = min;
        else if (e.key === "End") raw = max;
        else return;
        e.preventDefault();
        const nextRange = apply(bound, raw);
        setRange(nextRange);
        onChangeEnd?.(nextRange);
      };

    const pctOf = (n: number) => (clamp(n, min, max) - min) / span * 100;
    const lo = pctOf(range.min);
    const hi = pctOf(range.max);
    const fillStyle = vertical
      ? ({ bottom: `${lo}%`, top: `${100 - hi}%` } as CSSProperties)
      : ({ left: `${lo}%`, right: `${100 - hi}%` } as CSSProperties);
    const thumbPos = (pct: number) =>
      (vertical ? { bottom: `${pct}%` } : { left: `${pct}%` }) as CSSProperties;

    const thumb = (bound: RangeBound, label: string, pct: number, now: number) => (
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={now}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-disabled={disabled || undefined}
        className={cx("monet-cv-rangeslider-thumb", `is-${bound}`)}
        style={thumbPos(pct)}
        onPointerDown={onThumbPointerDown(bound)}
        onKeyDown={onThumbKeyDown(bound)}
      />
    );

    return (
      <div
        ref={setRef}
        role="group"
        aria-label={aria["aria-label"]}
        aria-disabled={disabled || undefined}
        className={cx(
          "monet-cv-rangeslider",
          vertical && "is-vertical",
          disabled && "is-disabled",
          className,
        )}
        style={{ "--accent": accent } as CSSProperties}
      >
        <div ref={trackRef} className="monet-cv-rangeslider-track">
          <div className="monet-cv-rangeslider-fill" style={fillStyle} />
          {thumb("min", "Minimum", lo, range.min)}
          {thumb("max", "Maximum", hi, range.max)}
        </div>
      </div>
    );
  },
);

// ─── AngleDial + Knob ──────────────────────────────────────────

export interface AngleDialProps {
  /** Controlled angle in degrees. Omit (with `defaultValue`) for uncontrolled. */
  value?: number;
  defaultValue?: number;
  onChange?: (deg: number) => void;
  /** Fires once when a drag ends. */
  onChangeEnd?: (deg: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Bottom dead-arc in degrees removed from the usable sweep. Defaults to 0. */
  gap?: number;
  /** Pixel diameter. Defaults to 40. */
  size?: number;
  disabled?: boolean;
  accent?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

/** (#191) The sweep frame. With a dead-arc the sweep is measured from the
 *  BOTTOM (6 o'clock) so the excluded arc — and the min/max discontinuity —
 *  land where they are documented; a gapless dial keeps its 0°-points-up frame
 *  (a plain rotation dial reads 0° at 12 o'clock). Both directions share it so
 *  the needle and the pointer mapping stay inverses of each other. */
const sweepFrame = (angle: number, gap: number) =>
  gap > 0 ? (angle + 180) % 360 : angle;

/** Map an on-screen angle (degrees from up=0) to the [min,max] value range. */
function arcToValue(angleUp: number, gap: number, min: number, max: number): number {
  const startA = gap / 2;
  const usable = 360 - gap || 1;
  const frac = clamp((sweepFrame(angleUp, gap) - startA) / usable, 0, 1);
  return min + frac * (max - min);
}
/** Inverse of arcToValue: value → on-screen angle (degrees from up=0). */
function valueToArc(v: number, gap: number, min: number, max: number): number {
  const range = max - min || 1;
  const usable = 360 - gap;
  return sweepFrame(gap / 2 + ((clamp(v, min, max) - min) / range) * usable, gap);
}

/** A rotary degree dial — drag the needle to set an angle. 0° points up;
 *  angle = (atan2(dy,dx)·180/π + 450) mod 360. A bottom dead-arc (`gap`) maps
 *  the usable sweep onto [min,max]. role="slider", aria-valuetext "<deg>°". */
export const AngleDial = forwardRef<HTMLDivElement, AngleDialProps>(
  function AngleDial(
    {
      value,
      defaultValue,
      onChange,
      onChangeEnd,
      min = 0,
      max = 360,
      step = 1,
      gap = 0,
      size = 40,
      disabled,
      accent,
      id,
      className,
      ...aria
    },
    forwardedRef,
  ) {
    const prec = precisionOf(step);
    const seed = defaultValue ?? min;
    const [deg, setDeg] = useControllableState<number>(value, seed, onChange);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const startDrag = useDragSession();

    const setRef = (el: HTMLDivElement | null) => {
      rootRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef)
        (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    };

    const commit = (n: number) => {
      const next = roundTo(clamp(n, min, max), prec);
      setDeg(next);
      return next;
    };

    const valueFromPointer = (clientX: number, clientY: number): number => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return deg;
      const cx2 = rect.left + rect.width / 2;
      const cy2 = rect.top + rect.height / 2;
      const dx = clientX - cx2;
      const dy = clientY - cy2;
      // 0° points up; clockwise positive. +450 then mod 360 rotates atan2's
      // 0°=east / CCW-positive frame into up=0 / CW-positive.
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const up = (angle + 450) % 360;
      return arcToValue(up, gap, min, max);
    };

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      (e.currentTarget as HTMLElement).focus();
      let last = commit(valueFromPointer(e.clientX, e.clientY));
      const move = (ev: PointerEvent) => {
        last = commit(valueFromPointer(ev.clientX, ev.clientY));
      };
      startDrag(move, () => onChangeEnd?.(last));
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let next = deg;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") next = deg + step;
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = deg - step;
      else if (e.key === "PageUp") next = deg + step * 10;
      else if (e.key === "PageDown") next = deg - step * 10;
      else if (e.key === "Home") next = min;
      else if (e.key === "End") next = max;
      else return;
      e.preventDefault();
      // commit unconditionally — optional chaining would skip commit() when
      // no onChangeEnd handler is set (it short-circuits the argument).
      const committed = commit(next);
      onChangeEnd?.(committed);
    };

    const isKnob = gap > 0;
    const arc = valueToArc(deg, gap, min, max);
    const pct = (clamp(deg, min, max) - min) / (max - min || 1);

    return (
      <div
        ref={setRef}
        id={id}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={aria["aria-label"]}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={deg}
        aria-valuetext={`${roundTo(deg, prec)}°`}
        aria-disabled={disabled || undefined}
        className={cx(
          "monet-cv-angledial",
          isKnob && "is-knob",
          disabled && "is-disabled",
          className,
        )}
        style={
          {
            "--accent": accent,
            "--pct": pct,
            width: size,
            height: size,
          } as CSSProperties
        }
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <div className="monet-cv-angledial-track" aria-hidden="true" />
        <div className="monet-cv-angledial-fill" aria-hidden="true" />
        <div
          className="monet-cv-angledial-needle"
          aria-hidden="true"
          style={{ transform: `rotate(${arc}deg)` }}
        />
      </div>
    );
  },
);

export type KnobProps = Omit<AngleDialProps, "gap">;

/** A Knob preset: an AngleDial with a 60° bottom dead-arc and bounded
 *  min/max defaults, for the classic gauge look. */
export const Knob = forwardRef<HTMLDivElement, KnobProps>(function Knob(
  { min = 0, max = 100, ...rest },
  ref,
) {
  return <AngleDial ref={ref} gap={60} min={min} max={max} {...rest} />;
});

// ─── TransformFields ───────────────────────────────────────────

export interface TransformValue {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  shear: number;
}

export type TransformField = keyof TransformValue;

export interface TransformFieldsProps {
  /** Controlled transform (partial — unset keys fall back to 0). */
  value?: Partial<TransformValue>;
  defaultValue?: Partial<TransformValue>;
  /** Fires with the changed `patch` and the full resolved transform. */
  onChange?: (patch: Partial<TransformValue>, full: TransformValue) => void;
  /** Fires once when an interaction ends, with the full transform. */
  onChangeEnd?: (full: TransformValue) => void;
  /** Unit suffix on the positional/size fields. Defaults to "px". */
  unit?: string;
  /** Keep W/H proportional when editing. Defaults to true. */
  lockAspect?: boolean;
  /** Controlled handler for the aspect-lock toggle. */
  onLockAspectChange?: (locked: boolean) => void;
  /** Which fields to show, in order. Defaults to ["x","y","w","h","rotation"]. */
  fields?: TransformField[];
  accent?: string;
  className?: string;
}

const TRANSFORM_LABELS: Record<TransformField, string> = {
  x: "X",
  y: "Y",
  w: "W",
  h: "H",
  rotation: "R",
  shear: "Sh",
};

const ZERO_TRANSFORM: TransformValue = { x: 0, y: 0, w: 0, h: 0, rotation: 0, shear: 0 };

/** A transform inspector: a grid of ScrubbyNumbers (X/Y/W/H/shear) plus an
 *  AngleDial for rotation and an aspect-lock toggle. When locked, editing W
 *  scales H proportionally (and vice-versa) before emitting. Composes the
 *  ScrubbyNumber + AngleDial from this module. */
export const TransformFields = forwardRef<HTMLDivElement, TransformFieldsProps>(
  function TransformFields(
    {
      value,
      defaultValue,
      onChange,
      onChangeEnd,
      unit = "px",
      lockAspect = true,
      onLockAspectChange,
      fields = ["x", "y", "w", "h", "rotation"],
      accent,
      className,
    },
    forwardedRef,
  ) {
    const seed: TransformValue = { ...ZERO_TRANSFORM, ...defaultValue };
    const isControlled = value !== undefined;
    const [internal, setInternal] = useState<TransformValue>(seed);
    const current: TransformValue = isControlled
      ? { ...ZERO_TRANSFORM, ...value }
      : internal;
    // Lock is controlled only when a change handler is supplied; otherwise it's
    // internal state seeded from `lockAspect` so the toggle works standalone.
    const lockControlled = onLockAspectChange !== undefined;
    const [internalLock, setInternalLock] = useState<boolean>(lockAspect);
    const locked = lockControlled ? lockAspect : internalLock;
    const setLocked = (next: boolean) => {
      if (!lockControlled) setInternalLock(next);
      onLockAspectChange?.(next);
    };
    const lockId = useId();

    const emit = (patch: Partial<TransformValue>, end: boolean) => {
      const full: TransformValue = { ...current, ...patch };
      if (!isControlled) setInternal(full);
      onChange?.(patch, full);
      if (end) onChangeEnd?.(full);
    };

    // Build the patch for a single field; when aspect is locked, W and H scale
    // each other proportionally off the previous value.
    const patchFor = (field: TransformField, next: number): Partial<TransformValue> => {
      if (locked && (field === "w" || field === "h")) {
        const prev = current[field];
        if (prev) {
          const ratio = next / prev;
          return field === "w"
            ? { w: next, h: roundTo(current.h * ratio, 2) }
            : { h: next, w: roundTo(current.w * ratio, 2) };
        }
      }
      return { [field]: next } as Partial<TransformValue>;
    };

    const change = (field: TransformField, next: number, end: boolean) => {
      emit(patchFor(field, next), end);
    };

    const toggleLock = () => {
      const nextLocked = !locked;
      setLocked(nextLocked);
    };

    return (
      <div
        ref={forwardedRef}
        className={cx("monet-cv-transform", className)}
        style={{ "--accent": accent } as CSSProperties}
      >
        <div className="monet-cv-transform-grid">
          {fields.map((field) =>
            field === "rotation" ? (
              <div key={field} className="monet-cv-transform-cell is-rotation">
                <span className="monet-cv-transform-label" aria-hidden="true">
                  {TRANSFORM_LABELS[field]}
                </span>
                <AngleDial
                  size={28}
                  min={0}
                  max={360}
                  accent={accent}
                  aria-label="Rotation"
                  value={current.rotation}
                  onChange={(d) => change("rotation", d, false)}
                  // (#183) pass the committed angle: an empty patch would
                  // rebuild `full` from the pre-change `current` (AngleDial
                  // fires onChange + onChangeEnd in the same tick) and revert.
                  onChangeEnd={(d) => change("rotation", d, true)}
                />
              </div>
            ) : (
              <div key={field} className="monet-cv-transform-cell">
                <ScrubbyNumber
                  label={TRANSFORM_LABELS[field]}
                  suffix={field === "shear" ? "°" : unit}
                  accent={accent}
                  aria-label={field}
                  value={current[field]}
                  onChange={(n) => change(field, n, false)}
                  onChangeEnd={(n) => change(field, n, true)}
                />
              </div>
            ),
          )}
          {(fields.includes("w") || fields.includes("h")) && (
            <button
              type="button"
              id={lockId}
              aria-label="Lock aspect ratio"
              aria-pressed={locked}
              className={cx("monet-iconbtn", "monet-cv-transform-lock", locked && "is-active")}
              onClick={toggleLock}
            >
              <Icon d={locked ? I.lock : I.link} size={14} />
            </button>
          )}
        </div>
      </div>
    );
  },
);
