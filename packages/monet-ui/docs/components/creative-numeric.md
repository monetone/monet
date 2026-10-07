# Creative numeric & transform controls

Mocked-but-sharable numeric scrubbers and transform widgets in the spirit of pro creative apps (After Effects / Photoshop / Figma inspectors) — drag-to-scrub numbers, steppers, two-thumb ranges, rotary dials, and a full X/Y/W/H + rotation transform group. Behaviour (drag, keyboard, clamp/precision, ARIA) is real even though host data is mocked; everything flows through `onChange`-family callbacks.

> **Stylesheet:** import the Monet stylesheet once at your app root: `import "@monet-ui/monet-core/index.css";`. Without it the controls render unstyled.
>
> **Source:** `packages/monet-react/src/creative-numeric.tsx`.
>
> **Patterns:** the drag/keyboard/clamp/precision behaviour mirrors `Slider` (drag) and `NumberField` (clamp/round/draft/commit). Controlled when `value` (or `defaultValue` omitted) is supplied; otherwise uncontrolled. Pass `accent` (a CSS color or `var(--accent…)`) to tint the affordances.

---

## PropertyRow

Structural inspector row built on the chrome `.monet-row` (`label · control · readout`). Purely presentational — it carries no role. When `htmlFor` is set the label renders as a real `<label htmlFor>` so it associates with your control's `id`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `label` | `ReactNode` | — | Leading label (→ `.lbl`). Rendered as `<label htmlFor>` when `htmlFor` is set, else a `<span>`. |
| `children` | `ReactNode` | — | Control slot (the main editable widget). |
| `value` | `ReactNode` | — | Right-aligned monospace readout (→ `.val`). |
| `fieldValue` | `ReactNode` | — | Boxed field readout (→ `.field`). |
| `icon` | `ReactNode` | — | Leading icon slot, before the label. |
| `htmlFor` | `string` | — | Associates the label with a control `id` (renders `<label htmlFor>`). |
| `className` | `string` | — | Extra class on the row. |
| `style` | `CSSProperties` | — | Inline style on the row. |

```tsx
import { PropertyRow, ScrubbyNumber } from "@monet-ui/monet-react";

<PropertyRow label="Opacity" value="80%">
  <ScrubbyNumber aria-label="opacity" defaultValue={80} min={0} max={100} suffix="%" />
</PropertyRow>;
```

---

## ScrubbyNumber

A number you drag horizontally to change (the AE/PS "scrubby" control). Dragging the label or value chrome scrubs the value (**Shift** = ×10, **Alt** = ÷10); a click without movement (< ~3px) focuses an inner input for direct typing. Committed values are clamped to `[min, max]` and rounded to `precision` (inferred from `step`). `role="spinbutton"` with `aria-valuemin/max/now` and an `aria-valuetext` that includes the suffix. Keyboard: Arrow (±`step`), Page (±`pageStep`), Home/End (min/max). Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Controlled value. Omit (with `defaultValue`) for uncontrolled use. |
| `defaultValue` | `number` | `min` (or `0`) | Initial value when uncontrolled. |
| `onChange` | `(value: number) => void` | — | Fires with the next clamped value on each scrub tick / edit commit. |
| `onChangeEnd` | `(value: number) => void` | — | Fires once when a scrub drag (or key nudge) ends. |
| `min` | `number` | `-Infinity` | Lower bound. |
| `max` | `number` | `Infinity` | Upper bound. |
| `step` | `number` | `1` | Increment per step. |
| `pageStep` | `number` | `step * 10` | Larger increment for PageUp/PageDown. |
| `precision` | `number` | inferred from `step` | Decimal places to render. |
| `dragSensitivity` | `number` | `2` | Pixels of horizontal drag per `step`. |
| `suffix` | `string` | — | Unit suffix shown after the value (e.g. `"px"`, `"°"`). |
| `label` | `ReactNode` | — | Leading label that is scrubbed by dragging. |
| `disabled` | `boolean` | — | Disable scrubbing + keyboard. |
| `accent` | `string` | — | Accent color for the focus ring / scrub affordance. |
| `id` | `string` | auto-generated | Root element id. |
| `aria-label` | `string` | — | Accessible name. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { ScrubbyNumber } from "@monet-ui/monet-react";

<ScrubbyNumber label="X" suffix="px" defaultValue={0} step={1} aria-label="x position" />;
```

---

## Stepper

Compact increment/decrement control — two icon buttons that disable at the bounds, with an optional middle `role="spinbutton"` readout (Arrow keys nudge by `step`; Home/End jump to bounds). Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Controlled value. Omit (with `defaultValue`) for uncontrolled use. |
| `defaultValue` | `number` | `0` | Initial value when uncontrolled. |
| `onChange` | `(value: number) => void` | — | Fires with the next clamped value. |
| `min` | `number` | `-Infinity` | Lower bound (disables the dec button when reached). |
| `max` | `number` | `Infinity` | Upper bound (disables the inc button when reached). |
| `step` | `number` | `1` | Increment per press / Arrow key. |
| `showValue` | `boolean` | `true` | Show the middle spinbutton readout. |
| `suffix` | `string` | — | Unit suffix shown after the value. |
| `disabled` | `boolean` | — | Disable the control. |
| `size` | `"sm" \| "md"` | `"sm"` | Control size. |
| `aria-label` | `string` | — | Accessible name for the readout. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { Stepper } from "@monet-ui/monet-react";

<Stepper defaultValue={1} min={1} max={64} suffix="px" aria-label="Brush size" />;
```

---

## RangeSlider

A two-thumb min/max range slider. Each thumb drags like the `Slider` core and clamps against the other thumb ± `minGap`; the fill spans between them. The root is `role="group"`; the two thumbs are `role="slider"` labelled `"Minimum"` / `"Maximum"`. Keyboard on a thumb: Arrow (±`step`), Page (±10·`step`), Home/End. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `RangeValue` (`{ min: number; max: number }`) | — | Controlled range. Omit (with `defaultValue`) for uncontrolled use. |
| `defaultValue` | `RangeValue` | `{ min, max }` | Initial range when uncontrolled. |
| `onChange` | `(range: RangeValue) => void` | — | Fires with the next range on each thumb move. |
| `onChangeEnd` | `(range: RangeValue) => void` | — | Fires once when a thumb drag ends. |
| `min` | `number` | `0` | Track lower bound. |
| `max` | `number` | `1` | Track upper bound. |
| `step` | `number` | `(max - min) / 100` | Step granularity. |
| `minGap` | `number` | `0` | Minimum gap enforced between the two thumbs. |
| `vertical` | `boolean` | — | Orient bottom-to-top instead of left-to-right. |
| `disabled` | `boolean` | — | Inert the slider. |
| `accent` | `string` | — | Accent color for the fill / thumbs. |
| `aria-label` | `string` | — | Accessible name for the group. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { RangeSlider } from "@monet-ui/monet-react";

<RangeSlider
  defaultValue={{ min: 0.2, max: 0.8 }}
  min={0}
  max={1}
  step={0.05}
  minGap={0.05}
  aria-label="Levels"
/>;
```

---

## AngleDial

A rotary degree dial — drag the needle to set an angle. `0°` points up; the pointer angle is `(atan2(dy, dx)·180/π + 450) mod 360`. A bottom dead-arc (`gap`, in degrees) removes a slice from the usable sweep and maps the remainder onto `[min, max]`. `role="slider"` with `aria-valuetext` rendered as `"<deg>°"`. Keyboard: Arrow (±`step`), Page (±10·`step`), Home/End. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Controlled angle in degrees. Omit (with `defaultValue`) for uncontrolled. |
| `defaultValue` | `number` | `min` | Initial angle when uncontrolled. |
| `onChange` | `(deg: number) => void` | — | Fires with the next clamped angle. |
| `onChangeEnd` | `(deg: number) => void` | — | Fires once when a drag (or key nudge) ends. |
| `min` | `number` | `0` | Lower bound (degrees). |
| `max` | `number` | `360` | Upper bound (degrees). |
| `step` | `number` | `1` | Increment per Arrow key. |
| `gap` | `number` | `0` | Bottom dead-arc in degrees removed from the usable sweep. |
| `size` | `number` | `40` | Pixel diameter. |
| `disabled` | `boolean` | — | Inert the dial. |
| `accent` | `string` | — | Accent color for the needle / fill. |
| `id` | `string` | — | Root element id. |
| `aria-label` | `string` | — | Accessible name. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { AngleDial } from "@monet-ui/monet-react";

<AngleDial defaultValue={0} aria-label="Rotation" />;
```

---

## Knob

A `Knob` preset: an `AngleDial` with a 60° bottom dead-arc (`gap={60}`) and bounded `min`/`max` defaults (`0`…`100`), for the classic gauge look. Carries the `.is-knob` modifier. Accepts every `AngleDial` prop except `gap`. Forwards its `ref` to the underlying dial.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Controlled value. Omit (with `defaultValue`) for uncontrolled. |
| `defaultValue` | `number` | `min` | Initial value when uncontrolled. |
| `onChange` | `(value: number) => void` | — | Fires with the next clamped value. |
| `onChangeEnd` | `(value: number) => void` | — | Fires once when an interaction ends. |
| `min` | `number` | `0` | Lower bound. |
| `max` | `number` | `100` | Upper bound. |
| `step` | `number` | `1` | Increment per Arrow key. |
| `size` | `number` | `40` | Pixel diameter. |
| `disabled` | `boolean` | — | Inert the knob. |
| `accent` | `string` | — | Accent color for the needle / fill. |
| `id` | `string` | — | Root element id. |
| `aria-label` | `string` | — | Accessible name. |
| `className` | `string` | — | Extra class on the root. |

`KnobProps` is `Omit<AngleDialProps, "gap">`.

```tsx
import { Knob } from "@monet-ui/monet-react";

<Knob defaultValue={50} aria-label="Gain" />;
```

---

## TransformFields

A transform inspector: a grid of `ScrubbyNumber`s (X / Y / W / H / shear) plus an `AngleDial` for rotation and an aspect-lock toggle (`role="button"`, `aria-pressed`). When locked, editing W scales H proportionally (and vice-versa) off the previous value before emitting. Each change emits both the `patch` (just what changed) and the `full` resolved transform. The lock is controlled only when `onLockAspectChange` is supplied; otherwise it toggles internally from `lockAspect`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `Partial<TransformValue>` | — | Controlled transform (unset keys fall back to `0`). |
| `defaultValue` | `Partial<TransformValue>` | `{}` (all `0`) | Initial transform when uncontrolled. |
| `onChange` | `(patch: Partial<TransformValue>, full: TransformValue) => void` | — | Fires with the changed `patch` and the full resolved transform. |
| `onChangeEnd` | `(full: TransformValue) => void` | — | Fires once when an interaction ends, with the full transform. |
| `unit` | `string` | `"px"` | Unit suffix on the positional/size fields. |
| `lockAspect` | `boolean` | `true` | Keep W/H proportional when editing (initial state, or controlled value when `onLockAspectChange` is set). |
| `onLockAspectChange` | `(locked: boolean) => void` | — | Controlled handler for the aspect-lock toggle. |
| `fields` | `TransformField[]` (`keyof TransformValue`) | `["x","y","w","h","rotation"]` | Which fields to show, in order. |
| `accent` | `string` | — | Accent color passed to the child fields / dial. |
| `className` | `string` | — | Extra class on the root. |

`TransformValue` is `{ x; y; w; h; rotation; shear }` (all `number`); `TransformField` is `keyof TransformValue`.

```tsx
import { TransformFields } from "@monet-ui/monet-react";

<TransformFields
  defaultValue={{ x: 0, y: 0, w: 320, h: 200, rotation: 0 }}
  unit="px"
  lockAspect
  onChange={(patch, full) => console.log(patch, full)}
/>;
```

---

## Types

Every component also exports its props interface for typing wrappers and refs: `PropertyRowProps`, `ScrubbyNumberProps`, `StepperProps`, `RangeSliderProps` (+ `RangeValue`), `AngleDialProps`, `KnobProps`, and `TransformFieldsProps` (+ `TransformValue`, `TransformField`).
