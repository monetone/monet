// ─────────────────────────────────────────────────────────────
// Monet — in-house controls library
// ─────────────────────────────────────────────────────────────
// Accessible, framework-free form controls dressed in Monet liquid
// glass. Visuals live in @monet-ui/monet-core/controls.css; behaviour
// (state, keyboard, focus, ARIA) lives here. Every control:
//   • is built on a real focusable element (button / input / [tabindex])
//   • supports controlled + uncontrolled use
//   • exposes role / aria-* and full keyboard support
//   • forwards refs where natural
//
// Components:
//   <Button variant size>            default | primary | ghost | danger
//   <IconButton icon aria-label>     square icon-only Button (Icon glyph)
//   <Input>                          text field
//   <NumberField min max step>       steppers + Arrow/Page/Home/End + clamp
//   <Textarea>                       multi-line text field
//   <Checkbox> / <Switch>            role=checkbox / role=switch
//   <Radio> + <RadioGroup>           roving-tabindex radio set
//   <Field> / <Label> / <Hint>       accessible labelling helpers
//   <Select>                         (see ./controls-select)
//   <Autocomplete suggestions>       input + Monet suggestion list (see ./controls-autocomplete)
//
// Field wires htmlFor/id + aria-describedby for any control that takes an
// `id` (Input, NumberField, Textarea, Select). The checkbox-family controls
// (Checkbox, Radio, Switch) carry their own inline labels.

import React, {
  forwardRef,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Icon, I } from "./icons";
import { useControllableState, cx } from "./internal";

export { Select } from "./controls-select";
export type {
  SelectOption,
  SelectProps,
} from "./controls-select";
export { Autocomplete } from "./controls-autocomplete";
export type { AutocompleteProps, AutocompleteSuggestion } from "./controls-autocomplete";

// ─── shared helpers ────────────────────────────────────────────
// useControllableState + cx live in ./internal (imported above).

// ─── Button ────────────────────────────────────────────────────

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual emphasis. Defaults to "default". */
  variant?: ButtonVariant;
  /** Control height. "sm" = 22px, "md" = 28px. Defaults to "md". */
  size?: ButtonSize;
  /** Glyph rendered before the label (an `I` key or a raw SVG path). */
  iconStart?: string;
  /** Glyph rendered after the label. */
  iconEnd?: string;
  /** Stretch to fill the available inline space. */
  block?: boolean;
  children?: ReactNode;
}

/** Liquid-glass button. Renders a real <button>; `type` defaults to "button"
 *  so it never accidentally submits a form. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "default",
      size = "md",
      iconStart,
      iconEnd,
      block,
      className,
      type = "button",
      children,
      ...rest
    },
    ref,
  ) {
    const glyph = (d?: string) =>
      d ? <Icon d={I[d as keyof typeof I] || d} size={size === "sm" ? 12 : 14} /> : null;
    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          "monet-btn",
          `monet-btn--${variant}`,
          `monet-btn--${size}`,
          block && "is-block",
          className,
        )}
        {...rest}
      >
        {glyph(iconStart)}
        {children != null && <span className="monet-btn-label">{children}</span>}
        {glyph(iconEnd)}
      </button>
    );
  },
);

// ─── IconButton ────────────────────────────────────────────────

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Glyph to render — an `I` key (e.g. "close") or a raw SVG path string. */
  icon: string;
  /** REQUIRED — icon-only buttons have no visible text. */
  "aria-label": string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Pressed/selected state → aria-pressed + visual highlight. */
  active?: boolean;
}

/** Square, label-less button driving an Icon. `aria-label` is required by the
 *  type so it is always announced. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon, variant = "ghost", size = "md", active, className, type = "button", ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-pressed={active}
        className={cx(
          "monet-btn",
          "monet-iconbtn-ctl",
          `monet-btn--${variant}`,
          `monet-btn--${size}`,
          active && "is-active",
          className,
        )}
        {...rest}
      >
        <Icon d={I[icon as keyof typeof I] || icon} size={size === "sm" ? 14 : 16} />
      </button>
    );
  },
);

// ─── Field / Label / Hint ──────────────────────────────────────
// Accessible labelling helpers. Field generates a stable id and threads it +
// any hint/error id into the single control it wraps via render-prop, so the
// control gets `id`, `aria-describedby`, and `aria-invalid` for free.

export interface FieldRenderProps {
  /** Apply to the control: `<Input {...props} />`. */
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

export interface FieldProps {
  /** Visible label text. Rendered via <Label htmlFor>. */
  label?: ReactNode;
  /** Helper text below the control (id wired into aria-describedby). */
  hint?: ReactNode;
  /** Error text — replaces the hint and sets aria-invalid. */
  error?: ReactNode;
  /** Force a specific id (otherwise auto-generated). */
  id?: string;
  className?: string;
  /** Receives `{ id, aria-describedby, aria-invalid }` to spread on the control. */
  children: (props: FieldRenderProps) => ReactNode;
}

/** Vertical label + control + hint group with full aria wiring. */
export function Field({ label, hint, error, id, className, children }: FieldProps) {
  const auto = useId();
  const fieldId = id ?? `monet-f-${auto}`;
  const hintId = `${fieldId}-hint`;
  const msg = error ?? hint;
  const describedBy = msg != null ? hintId : undefined;
  return (
    <div className={cx("monet-field", error != null && "is-invalid", className)}>
      {label != null && <Label htmlFor={fieldId}>{label}</Label>}
      {children({
        id: fieldId,
        "aria-describedby": describedBy,
        "aria-invalid": error != null ? true : undefined,
      })}
      {msg != null && (
        <Hint id={hintId} error={error != null}>
          {msg}
        </Hint>
      )}
    </div>
  );
}

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children: ReactNode;
}

/** A control label. Pass `htmlFor` to bind it to a control's `id`. */
export function Label({ className, children, ...rest }: LabelProps) {
  return (
    <label className={cx("monet-label", className)} {...rest}>
      {children}
    </label>
  );
}

export interface HintProps
  extends React.HTMLAttributes<HTMLParagraphElement> {
  /** Render as an error (red tint, role=alert). */
  error?: boolean;
  children: ReactNode;
}

/** Helper / error text. When `error`, announced assertively via role=alert. */
export function Hint({ error, className, children, ...rest }: HintProps) {
  return (
    <p
      className={cx("monet-hint", error && "is-error", className)}
      role={error ? "alert" : undefined}
      {...rest}
    >
      {children}
    </p>
  );
}

// ─── Input ─────────────────────────────────────────────────────

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Control height. Defaults to "md". */
  size?: ButtonSize;
  /** Glyph rendered inside the field, leading edge. */
  iconStart?: string;
  /** Visually invalid (also set by Field's `error`). */
  invalid?: boolean;
  block?: boolean;
}

/** Single-line text input. Renders a real <input>; uncontrolled unless you
 *  pass `value` + `onChange` (standard React semantics). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "md", iconStart, invalid, block, className, type = "text", ...rest },
  ref,
) {
  const field = (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || rest["aria-invalid"] ? true : undefined}
      className={cx(
        "monet-input",
        `monet-input--${size}`,
        invalid && "is-invalid",
        block && "is-block",
        className,
      )}
      {...rest}
    />
  );
  if (!iconStart) return field;
  return (
    <div
      className={cx(
        "monet-input-wrap",
        `monet-input--${size}`,
        invalid && "is-invalid",
        block && "is-block",
      )}
    >
      <span className="monet-input-icon" aria-hidden="true">
        <Icon d={I[iconStart as keyof typeof I] || iconStart} size={size === "sm" ? 12 : 14} />
      </span>
      <input
        ref={ref}
        type={type}
        aria-invalid={invalid || rest["aria-invalid"] ? true : undefined}
        className={cx("monet-input", "is-bare", className)}
        {...rest}
      />
    </div>
  );
});

// ─── Textarea ──────────────────────────────────────────────────

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  block?: boolean;
}

/** Multi-line text input. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ invalid, block, className, rows = 3, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={invalid || rest["aria-invalid"] ? true : undefined}
        className={cx(
          "monet-input",
          "monet-textarea",
          invalid && "is-invalid",
          block && "is-block",
          className,
        )}
        {...rest}
      />
    );
  },
);

// ─── NumberField ───────────────────────────────────────────────

export interface NumberFieldProps {
  /** Controlled value. Omit (with `defaultValue`) for uncontrolled use. */
  value?: number;
  /** Initial value when uncontrolled. Defaults to `min` (or 0). */
  defaultValue?: number;
  /** Fires with the next clamped value. */
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  /** Increment for steppers / arrows. Defaults to 1. */
  step?: number;
  /** Larger increment for PageUp/PageDown. Defaults to step * 10. */
  pageStep?: number;
  /** Decimal places to render. Inferred from `step` when omitted. */
  precision?: number;
  /** Optional unit suffix shown after the value (e.g. "%", "px"). */
  suffix?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: ButtonSize;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
  block?: boolean;
}

function inferPrecision(step: number): number {
  if (!isFinite(step)) return 0;
  const s = String(step);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Numeric input with steppers and a spinbutton role. Arrow keys nudge by
 *  `step`, Page keys by `pageStep`, Home/End jump to min/max. All committed
 *  values are clamped to [min, max] and rounded to `precision`. */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(
  function NumberField(
    {
      value,
      defaultValue,
      onChange,
      min = -Infinity,
      max = Infinity,
      step = 1,
      pageStep,
      precision,
      suffix,
      disabled,
      invalid,
      size = "md",
      id,
      name,
      className,
      block,
      ...aria
    },
    ref,
  ) {
    const prec = precision ?? inferPrecision(step);
    const big = pageStep ?? step * 10;
    const seed = defaultValue ?? (isFinite(min) ? min : 0);
    const [num, setNum] = useControllableState<number>(value, seed, onChange);
    // editing buffer so the user can type intermediate strings ("-", "1.")
    const [draft, setDraft] = useState<string | null>(null);

    const clamp = (n: number) => Math.min(max, Math.max(min, n));
    const round = (n: number) =>
      prec > 0 ? Number(n.toFixed(prec)) : Math.round(n);
    const commit = (n: number) => {
      if (!isFinite(n)) return;
      setNum(round(clamp(n)));
    };
    const display = draft != null ? draft : prec > 0 ? num.toFixed(prec) : String(num);

    const nudge = (delta: number) => {
      setDraft(null);
      // (#186) Parse the draft explicitly — `Number(draft) || num` threw away a
      // typed zero ("0", "-0", "0.0"), nudging from the previous committed value
      // instead. A blank or unparsable draft ("", "-") still falls back to `num`.
      const parsed = draft != null && draft.trim() !== "" ? Number(draft) : NaN;
      commit((isFinite(parsed) ? parsed : num) + delta);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      switch (e.key) {
        case "ArrowUp": e.preventDefault(); nudge(step); break;
        case "ArrowDown": e.preventDefault(); nudge(-step); break;
        case "PageUp": e.preventDefault(); nudge(big); break;
        case "PageDown": e.preventDefault(); nudge(-big); break;
        case "Home": if (isFinite(min)) { e.preventDefault(); setDraft(null); commit(min); } break;
        case "End": if (isFinite(max)) { e.preventDefault(); setDraft(null); commit(max); } break;
        case "Enter": setDraft(null); commit(Number(display)); break;
      }
    };

    return (
      <div
        className={cx(
          "monet-numfield",
          `monet-input--${size}`,
          disabled && "is-disabled",
          invalid && "is-invalid",
          block && "is-block",
          className,
        )}
      >
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          role="spinbutton"
          id={id}
          name={name}
          disabled={disabled}
          value={display}
          aria-valuenow={num}
          aria-valuemin={isFinite(min) ? min : undefined}
          aria-valuemax={isFinite(max) ? max : undefined}
          aria-invalid={invalid || aria["aria-invalid"] ? true : undefined}
          aria-label={aria["aria-label"]}
          aria-describedby={aria["aria-describedby"]}
          className="monet-numfield-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => { setDraft(null); commit(Number(display)); }}
        />
        {suffix && <span className="monet-numfield-suffix" aria-hidden="true">{suffix}</span>}
        <div className="monet-numfield-steppers">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled || num >= max}
            className="monet-numfield-step is-up"
            onClick={() => nudge(step)}
          >
            <Icon d={I.chevDown} size={10} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled || num <= min}
            className="monet-numfield-step is-down"
            onClick={() => nudge(-step)}
          >
            <Icon d={I.chevDown} size={10} />
          </button>
        </div>
      </div>
    );
  },
);

// ─── Checkbox ──────────────────────────────────────────────────

export interface CheckboxProps {
  /** Controlled checked state. */
  checked?: boolean;
  /** Initial checked state when uncontrolled. Defaults to false. */
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Indeterminate (visual dash; aria-checked="mixed"). */
  indeterminate?: boolean;
  disabled?: boolean;
  /** Inline label to the right of the box. */
  children?: ReactNode;
  id?: string;
  name?: string;
  value?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  className?: string;
}

/** A custom-rendered checkbox built on a real <button role="checkbox">.
 *  Space/Enter toggle (native button behaviour). */
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  function Checkbox(
    {
      checked,
      defaultChecked = false,
      onChange,
      indeterminate,
      disabled,
      children,
      id,
      name,
      value,
      className,
      ...aria
    },
    ref,
  ) {
    const [on, setOn] = useControllableState<boolean>(checked, defaultChecked, onChange);
    const labelId = useId();
    return (
      <label className={cx("monet-checkrow", disabled && "is-disabled", className)}>
        <button
          ref={ref}
          type="button"
          role="checkbox"
          id={id}
          disabled={disabled}
          aria-checked={indeterminate ? "mixed" : on}
          aria-label={aria["aria-label"]}
          aria-describedby={aria["aria-describedby"]}
          aria-labelledby={children != null && !aria["aria-label"] ? labelId : undefined}
          className={cx("monet-checkbox", (on || indeterminate) && "is-on")}
          onClick={() => !disabled && setOn(!on)}
        >
          <span className="monet-checkbox-mark" aria-hidden="true">
            {indeterminate ? (
              <Icon d={I.minus} size={11} strokeWidth={2} />
            ) : on ? (
              <Icon d="M3.5 8.5L6.5 11.5L12.5 4.5" size={11} strokeWidth={2} />
            ) : null}
          </span>
        </button>
        {name && <input type="hidden" name={name} value={on ? value ?? "on" : ""} />}
        {children != null && (
          <span id={labelId} className="monet-checkrow-label">
            {children}
          </span>
        )}
      </label>
    );
  },
);

// ─── Switch ────────────────────────────────────────────────────

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  className?: string;
}

/** A toggle built on <button role="switch">. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    { checked, defaultChecked = false, onChange, disabled, children, id, name, className, ...aria },
    ref,
  ) {
    const [on, setOn] = useControllableState<boolean>(checked, defaultChecked, onChange);
    const labelId = useId();
    return (
      <label className={cx("monet-switchrow", disabled && "is-disabled", className)}>
        <button
          ref={ref}
          type="button"
          role="switch"
          id={id}
          disabled={disabled}
          aria-checked={on}
          aria-label={aria["aria-label"]}
          aria-describedby={aria["aria-describedby"]}
          aria-labelledby={children != null && !aria["aria-label"] ? labelId : undefined}
          className={cx("monet-switch", on && "is-on")}
          onClick={() => !disabled && setOn(!on)}
        >
          <span className="monet-switch-track" aria-hidden="true">
            <span className="monet-switch-thumb" />
          </span>
        </button>
        {name && <input type="hidden" name={name} value={on ? "on" : ""} />}
        {children != null && (
          <span id={labelId} className="monet-switchrow-label">
            {children}
          </span>
        )}
      </label>
    );
  },
);

// ─── Radio + RadioGroup ────────────────────────────────────────
// RadioGroup owns the value and roving tabindex; Radio reads its group via
// context. Arrow keys move between radios (wrapping) and select on move, per
// the WAI-ARIA radiogroup pattern.

interface RadioGroupContextValue {
  name: string;
  value: string | undefined;
  setValue: (v: string) => void;
  disabled?: boolean;
  /** Register a value (and its disabled state) in document order. */
  registerOrder: (v: string, disabled?: boolean) => void;
  /** True when this value should be the single tab stop (roving tabindex). */
  isTabStop: (v: string) => boolean;
  focusMove: (from: string, dir: 1 | -1) => void;
  refFor: (v: string) => (el: HTMLButtonElement | null) => void;
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps {
  /** Controlled selected value. */
  value?: string;
  /** Initial value when uncontrolled. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Shared form name for the underlying inputs. Auto-generated if omitted. */
  name?: string;
  /** Disable the whole group. */
  disabled?: boolean;
  orientation?: "horizontal" | "vertical";
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  children: ReactNode;
}

/** Container for a set of <Radio> children. Provides roving focus + arrow-key
 *  navigation; renders role="radiogroup". */
export function RadioGroup({
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  orientation = "vertical",
  className,
  children,
  ...aria
}: RadioGroupProps) {
  const autoName = useId();
  const [val, setVal] = useControllableState<string | undefined>(
    value,
    defaultValue,
    onChange as (v: string | undefined) => void,
  );
  const order = useRef<string[]>([]);
  const off = useRef<Set<string>>(new Set());
  const els = useRef<Record<string, HTMLButtonElement | null>>({});

  // (#187) Rebuild the ring on every render instead of only ever appending to
  // it: the Radios all consume this context, so they re-register (in document
  // order) right after this body runs, and an unmounted radio simply never
  // comes back. A stale entry would otherwise be selectable by arrow keys and
  // could hold the group's only tab stop.
  order.current = [];
  off.current = new Set();

  const registerOrder = useCallback((v: string, disabled?: boolean) => {
    if (!order.current.includes(v)) order.current.push(v);
    if (disabled) off.current.add(v);
    else off.current.delete(v);
  }, []);
  const refFor = useCallback(
    (v: string) => (el: HTMLButtonElement | null) => {
      els.current[v] = el;
    },
    [],
  );
  const focusMove = useCallback(
    (from: string, dir: 1 | -1) => {
      const list = order.current;
      const i = list.indexOf(from);
      if (i < 0 || list.length === 0) return;
      // (#188) walk past disabled radios (a disabled <button> is not focusable,
      // and selecting one commits a value the user may not choose); bail out
      // when no enabled sibling exists. Mirrors Select.firstEnabled.
      for (let n = 1; n <= list.length; n++) {
        const next = list[(((i + dir * n) % list.length) + list.length) % list.length];
        if (next === from) return;
        if (off.current.has(next)) continue;
        els.current[next]?.focus();
        setVal(next);
        return;
      }
    },
    [setVal],
  );
  // Roving tabindex: the selected radio is the tab stop. When nothing is
  // selected the first enabled radio becomes the stop so the group is
  // still reachable by Tab (per the WAI-ARIA radiogroup pattern).
  const isTabStop = useCallback(
    (v: string) => {
      if (val !== undefined) return val === v;
      // (#188) a disabled first radio can't be focused — fall through to the
      // first enabled one instead of leaving the group without a tab stop.
      return order.current.find((o) => !off.current.has(o)) === v;
    },
    [val],
  );

  const ctx: RadioGroupContextValue = {
    name: name ?? `monet-radio-${autoName}`,
    value: val,
    setValue: setVal,
    disabled,
    registerOrder,
    isTabStop,
    focusMove,
    refFor,
  };

  return (
    <div
      role="radiogroup"
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      aria-orientation={orientation}
      className={cx("monet-radiogroup", `is-${orientation}`, className)}
    >
      <RadioGroupContext.Provider value={ctx}>{children}</RadioGroupContext.Provider>
    </div>
  );
}

export interface RadioProps {
  /** This radio's value within its group. */
  value: string;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
}

/** A single radio option. Must be rendered inside a <RadioGroup>. */
export function Radio({ value, disabled, children, className }: RadioProps) {
  const ctx = useContext(RadioGroupContext);
  if (!ctx) {
    throw new Error("Monet <Radio> must be used inside a <RadioGroup>.");
  }
  const labelId = useId();
  const isDisabled = disabled || ctx.disabled;
  const checked = ctx.value === value;
  // register in document order so arrow navigation + the default tab stop work
  ctx.registerOrder(value, isDisabled);
  const isTabStop = ctx.isTabStop(value);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isDisabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      ctx.focusMove(value, 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      ctx.focusMove(value, -1);
    }
  };

  return (
    <label className={cx("monet-radiorow", isDisabled && "is-disabled", className)}>
      <button
        ref={ctx.refFor(value)}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-labelledby={children != null ? labelId : undefined}
        disabled={isDisabled}
        tabIndex={isTabStop ? 0 : -1}
        className={cx("monet-radio", checked && "is-on")}
        onClick={() => !isDisabled && ctx.setValue(value)}
        onKeyDown={onKeyDown}
      >
        <span className="monet-radio-dot" aria-hidden="true" />
      </button>
      {children != null && (
        <span id={labelId} className="monet-radiorow-label">
          {children}
        </span>
      )}
      {ctx.name && checked && <input type="hidden" name={ctx.name} value={value} />}
    </label>
  );
}
