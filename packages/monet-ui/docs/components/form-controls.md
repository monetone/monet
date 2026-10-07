# Form controls

Accessible, dependency-free form controls dressed in Monet liquid glass — built on real focusable elements with full keyboard, focus, and ARIA support, and controlled/uncontrolled use throughout.

> **Stylesheet:** import the Monet stylesheet once at your app root: `import "@monet-ui/monet-core/index.css";`. Without it the controls render unstyled.
>
> **Source:** `packages/monet-react/src/controls.tsx` and `packages/monet-react/src/controls-select.tsx`.
>
> **Labelling:** `<Field>` wires `htmlFor`/`id` + `aria-describedby`/`aria-invalid` for any control that takes an `id` (`Input`, `NumberField`, `Textarea`, `Select`). The checkbox-family controls (`Checkbox`, `Radio`, `Switch`) carry their own inline labels via `children`.

---

## Button

Liquid-glass button rendered as a real `<button>`. `type` defaults to `"button"` so it never accidentally submits a form. Extends `ButtonHTMLAttributes<HTMLButtonElement>` and forwards its `ref`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `ButtonVariant` (`"default" \| "primary" \| "ghost" \| "danger"`) | `"default"` | Visual emphasis. |
| `size` | `ButtonSize` (`"sm" \| "md"`) | `"md"` | Control height — `"sm"` = 22px, `"md"` = 28px. |
| `iconStart` | `string` | — | Glyph before the label (an `I` key or a raw SVG path). |
| `iconEnd` | `string` | — | Glyph after the label. |
| `block` | `boolean` | — | Stretch to fill the available inline space. |
| `children` | `ReactNode` | — | Button label. |
| `type` | `"button" \| "submit" \| "reset"` | `"button"` | Inherited from button attrs; defaulted to `"button"`. |
| ...rest | `ButtonHTMLAttributes<HTMLButtonElement>` | — | All native button props (`onClick`, `disabled`, etc.). |

```tsx
import { Button } from "@monet-ui/monet-react";

<Button variant="primary" iconStart="check" onClick={save}>
  Save
</Button>;
```

---

## IconButton

Square, label-less button driving an `Icon`. `aria-label` is **required by the type** so it is always announced. Extends `ButtonHTMLAttributes<HTMLButtonElement>` (with the native `aria-label` overridden to required) and forwards its `ref`. `type` defaults to `"button"`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `icon` | `string` | — | **Required.** Glyph to render — an `I` key (e.g. `"close"`) or a raw SVG path string. |
| `aria-label` | `string` | — | **Required.** Accessible name (icon-only buttons have no visible text). |
| `variant` | `ButtonVariant` | `"ghost"` | Visual emphasis. |
| `size` | `ButtonSize` | `"md"` | Control height. |
| `active` | `boolean` | — | Pressed/selected state → `aria-pressed` + visual highlight. |
| `type` | `"button" \| "submit" \| "reset"` | `"button"` | Defaulted to `"button"`. |
| ...rest | `Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">` | — | All native button props. |

```tsx
import { IconButton } from "@monet-ui/monet-react";

<IconButton icon="close" aria-label="Close" onClick={dismiss} />;
```

---

## Input

Single-line text input rendered as a real `<input>`. Uncontrolled unless you pass `value` + `onChange` (standard React semantics). Extends `InputHTMLAttributes<HTMLInputElement>` (native `size` omitted) and forwards its `ref`. `type` defaults to `"text"`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | `ButtonSize` (`"sm" \| "md"`) | `"md"` | Control height. Replaces the native `size` attribute. |
| `iconStart` | `string` | — | Glyph rendered inside the field, leading edge. When set, the input is wrapped in a `monet-input-wrap`. |
| `invalid` | `boolean` | — | Visually invalid (also sets `aria-invalid`; Field's `error` sets this too). |
| `block` | `boolean` | — | Stretch to fill the available inline space. |
| `type` | `string` | `"text"` | Native input type. |
| ...rest | `Omit<InputHTMLAttributes<HTMLInputElement>, "size">` | — | All native input props (`value`, `onChange`, `placeholder`, `disabled`, ...). |

```tsx
import { Input } from "@monet-ui/monet-react";

<Input iconStart="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />;
```

---

## Textarea

Multi-line text input rendered as a real `<textarea>`. Extends `TextareaHTMLAttributes<HTMLTextAreaElement>` and forwards its `ref`. `rows` defaults to `3`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `invalid` | `boolean` | — | Visually invalid (also sets `aria-invalid`). |
| `block` | `boolean` | — | Stretch to fill the available inline space. |
| `rows` | `number` | `3` | Visible rows. |
| ...rest | `TextareaHTMLAttributes<HTMLTextAreaElement>` | — | All native textarea props. |

```tsx
import { Textarea } from "@monet-ui/monet-react";

<Textarea rows={5} placeholder="Notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />;
```

---

## NumberField

Numeric input with steppers and a `role="spinbutton"`. Arrow keys nudge by `step`, Page keys by `pageStep`, Home/End jump to min/max. All committed values are clamped to `[min, max]` and rounded to `precision`. An internal draft buffer lets the user type intermediate strings (`"-"`, `"1."`). Controlled when `value` + `onChange` are given; otherwise uncontrolled from `defaultValue`. Forwards its `ref` to the underlying `<input>`. This is **not** a native-input passthrough — it declares an explicit prop set (no `...HTMLAttributes` spread).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Controlled value. Omit (with `defaultValue`) for uncontrolled use. |
| `defaultValue` | `number` | `min` (or `0` when `min` is `-Infinity`) | Initial value when uncontrolled. |
| `onChange` | `(value: number) => void` | — | Fires with the next clamped value. |
| `min` | `number` | `-Infinity` | Lower bound. |
| `max` | `number` | `Infinity` | Upper bound. |
| `step` | `number` | `1` | Increment for steppers / arrow keys. |
| `pageStep` | `number` | `step * 10` | Larger increment for PageUp/PageDown. |
| `precision` | `number` | inferred from `step` | Decimal places to render. |
| `suffix` | `string` | — | Unit suffix shown after the value (e.g. `"%"`, `"px"`). |
| `disabled` | `boolean` | — | Disable the field and steppers. |
| `invalid` | `boolean` | — | Visually invalid + `aria-invalid`. |
| `size` | `ButtonSize` (`"sm" \| "md"`) | `"md"` | Control height. |
| `id` | `string` | — | Element id (wired by `Field`). |
| `name` | `string` | — | Form field name. |
| `block` | `boolean` | — | Stretch to fill the available inline space. |
| `className` | `string` | — | Extra class on the wrapper. |
| `aria-label` | `string` | — | Accessible name. |
| `aria-describedby` | `string` | — | Describing element id. |
| `aria-invalid` | `boolean` | — | Forces invalid state. |

```tsx
import { NumberField } from "@monet-ui/monet-react";

<NumberField min={0} max={100} step={5} suffix="%" value={opacity} onChange={setOpacity} />;
```

---

## Checkbox

A custom-rendered checkbox built on a real `<button role="checkbox">`; Space/Enter toggle (native button behaviour). Supports an `indeterminate` ("mixed") state. Controlled when `checked` + `onChange` are given; otherwise uncontrolled from `defaultChecked`. Forwards its `ref` to the button. Declares an explicit prop set (no native-input spread). When `name` is set, a hidden `<input>` mirrors the state for form submission (`value ?? "on"` when checked, empty otherwise).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `checked` | `boolean` | — | Controlled checked state. |
| `defaultChecked` | `boolean` | `false` | Initial checked state when uncontrolled. |
| `onChange` | `(checked: boolean) => void` | — | Fires with the next checked state. |
| `indeterminate` | `boolean` | — | Indeterminate (visual dash; `aria-checked="mixed"`). |
| `disabled` | `boolean` | — | Disable the control. |
| `children` | `ReactNode` | — | Inline label to the right of the box. |
| `id` | `string` | — | Element id. |
| `name` | `string` | — | Form field name (renders a hidden input). |
| `value` | `string` | `"on"` (when checked, if no `value` given) | Submitted value when checked. |
| `className` | `string` | — | Extra class on the row label. |
| `aria-label` | `string` | — | Accessible name when no visible `children`. |
| `aria-describedby` | `string` | — | Describing element id. |

```tsx
import { Checkbox } from "@monet-ui/monet-react";

<Checkbox checked={agree} onChange={setAgree}>
  I agree to the terms
</Checkbox>;
```

---

## Switch

A toggle built on `<button role="switch">`. Controlled when `checked` + `onChange` are given; otherwise uncontrolled from `defaultChecked`. Forwards its `ref` to the button. When `name` is set, a hidden `<input>` mirrors the state (`"on"` when checked, empty otherwise).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `checked` | `boolean` | — | Controlled checked state. |
| `defaultChecked` | `boolean` | `false` | Initial checked state when uncontrolled. |
| `onChange` | `(checked: boolean) => void` | — | Fires with the next checked state. |
| `disabled` | `boolean` | — | Disable the control. |
| `children` | `ReactNode` | — | Inline label to the right of the track. |
| `id` | `string` | — | Element id. |
| `name` | `string` | — | Form field name (renders a hidden input). |
| `className` | `string` | — | Extra class on the row label. |
| `aria-label` | `string` | — | Accessible name when no visible `children`. |
| `aria-describedby` | `string` | — | Describing element id. |

```tsx
import { Switch } from "@monet-ui/monet-react";

<Switch checked={dark} onChange={setDark}>
  Dark mode
</Switch>;
```

---

## RadioGroup

Container for a set of `<Radio>` children. Owns the selected value, provides roving tabindex + arrow-key navigation (wrapping; selects on move per the WAI-ARIA radiogroup pattern), and renders `role="radiogroup"`. Controlled when `value` + `onChange` are given; otherwise uncontrolled from `defaultValue`. This is a plain function component (not `forwardRef`).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | — | Controlled selected value. |
| `defaultValue` | `string` | — | Initial value when uncontrolled. |
| `onChange` | `(value: string) => void` | — | Fires with the newly selected value. |
| `name` | `string` | auto-generated (`monet-radio-…`) | Shared form name for the underlying inputs. |
| `disabled` | `boolean` | — | Disable the whole group. |
| `orientation` | `"horizontal" \| "vertical"` | `"vertical"` | Layout + `aria-orientation`. |
| `className` | `string` | — | Extra class on the group. |
| `children` | `ReactNode` | — | **Required.** The `<Radio>` options. |
| `aria-label` | `string` | — | Accessible name for the group. |
| `aria-labelledby` | `string` | — | Id of an element labelling the group. |

```tsx
import { RadioGroup, Radio } from "@monet-ui/monet-react";

<RadioGroup value={align} onChange={setAlign} aria-label="Alignment">
  <Radio value="left">Left</Radio>
  <Radio value="center">Center</Radio>
  <Radio value="right">Right</Radio>
</RadioGroup>;
```

---

## Radio

A single radio option. **Must be rendered inside a `<RadioGroup>`** — it reads the group via context and throws `"Monet <Radio> must be used inside a <RadioGroup>."` otherwise. Plain function component (no ref).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | — | **Required.** This radio's value within its group. |
| `disabled` | `boolean` | — | Disable this option (also disabled if the group is disabled). |
| `children` | `ReactNode` | — | Inline label to the right of the dot. |
| `className` | `string` | — | Extra class on the row label. |

```tsx
import { RadioGroup, Radio } from "@monet-ui/monet-react";

<RadioGroup defaultValue="md" aria-label="Size">
  <Radio value="sm">Small</Radio>
  <Radio value="md">Medium</Radio>
</RadioGroup>;
```

---

## Select

Accessible single-select. Renders a trigger `<button role="combobox" aria-haspopup="listbox">` plus an absolutely-positioned listbox popup — **self-contained positioning that does not depend on the overlay layer**. Keyboard: closed → Enter/Space/ArrowDown/ArrowUp/Alt+ArrowDown open; open → Arrow keys move the active option, Home/End jump to ends, typeahead matches by prefix, Enter/Space commit, Esc closes, Tab commits + closes; click-outside closes. Controlled when `value` is supplied, otherwise uncontrolled from `defaultValue`. Forwards its `ref` to the trigger button. (Exported from `controls-select.tsx`, re-exported by the package root.)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `options` | `SelectOption[]` | — | **Required.** The available options. |
| `value` | `string` | — | Controlled selected value. |
| `defaultValue` | `string` | — | Initial value when uncontrolled. |
| `onChange` | `(value: string) => void` | — | Fires with the chosen option's value. |
| `placeholder` | `string` | `"Select…"` | Shown when nothing is selected. |
| `disabled` | `boolean` | — | Disable the control. |
| `invalid` | `boolean` | — | Visually invalid + `aria-invalid`. |
| `size` | `"sm" \| "md"` | `"md"` | Control height. |
| `block` | `boolean` | — | Stretch to fill the available inline space. |
| `id` | `string` | auto-generated (`monet-select-…`) | Trigger element id. |
| `name` | `string` | — | Form field name (renders a hidden input mirroring the value). |
| `className` | `string` | — | Extra class on the root. |
| `aria-label` | `string` | — | Accessible name. |
| `aria-labelledby` | `string` | — | Id of a labelling element. |
| `aria-describedby` | `string` | — | Describing element id. |
| `aria-invalid` | `boolean` | — | Forces invalid state. |

```tsx
import { Select } from "@monet-ui/monet-react";

<Select
  options={[
    { value: "auto", label: "Automatic" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark", icon: "moon" },
  ]}
  value={theme}
  onChange={setTheme}
  aria-label="Theme"
/>;
```

---

## Field

Vertical label + control + hint group with full ARIA wiring. Generates a stable `id` and threads it plus any hint/error id into the single control it wraps via a **render-prop** child, so the control gets `id`, `aria-describedby`, and `aria-invalid` for free. `error` replaces the hint and sets the invalid state. Plain function component (no ref). The render-prop receives a `FieldRenderProps` object (see Types).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `label` | `ReactNode` | — | Visible label text, rendered via `<Label htmlFor>`. |
| `hint` | `ReactNode` | — | Helper text below the control (its id is wired into `aria-describedby`). |
| `error` | `ReactNode` | — | Error text — replaces the hint and sets `aria-invalid`. |
| `id` | `string` | auto-generated (`monet-f-…`) | Force a specific id. |
| `className` | `string` | — | Extra class on the field wrapper. |
| `children` | `(props: FieldRenderProps) => ReactNode` | — | **Required.** Receives `{ id, "aria-describedby", "aria-invalid" }` to spread on the control. |

```tsx
import { Field, Input } from "@monet-ui/monet-react";

<Field label="Email" hint="We'll never share it." error={emailError}>
  {(props) => <Input {...props} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
</Field>;
```

---

## Label

A control label rendered as a `<label>`. Pass `htmlFor` to bind it to a control's `id`. Extends `LabelHTMLAttributes<HTMLLabelElement>`. (Usually rendered for you by `Field`.)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | — | **Required.** Label content. |
| `htmlFor` | `string` | — | Binds the label to a control's `id` (native attribute). |
| ...rest | `LabelHTMLAttributes<HTMLLabelElement>` | — | All native label props. |

```tsx
import { Label } from "@monet-ui/monet-react";

<Label htmlFor="bio">Biography</Label>;
```

---

## Hint

Helper / error text rendered as a `<p>`. When `error` is set, it gains an error tint and is announced assertively via `role="alert"`. Extends `HTMLAttributes<HTMLParagraphElement>`. (Usually rendered for you by `Field`.)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `error` | `boolean` | — | Render as an error (red tint, `role="alert"`). |
| `children` | `ReactNode` | — | **Required.** Hint content. |
| ...rest | `HTMLAttributes<HTMLParagraphElement>` | — | All native paragraph props. |

```tsx
import { Hint } from "@monet-ui/monet-react";

<Hint error>Password is too short.</Hint>;
```

---

## Types & constants

### ButtonVariant

```ts
type ButtonVariant = "default" | "primary" | "ghost" | "danger";
```

Visual-emphasis options shared by `Button` and `IconButton`.

### ButtonSize

```ts
type ButtonSize = "sm" | "md";
```

Control-height options (`"sm"` = 22px, `"md"` = 28px). Used by `Button`, `IconButton`, `Input`, and `NumberField`. (`Select` declares the same union inline rather than reusing this alias.)

### SelectOption

```ts
interface SelectOption {
  value: string;        // value committed via onChange
  label?: string;       // visible label; defaults to `value`
  icon?: string;        // optional leading glyph (an `I` key or raw SVG path)
  disabled?: boolean;
}
```

A single option for `Select`.

### FieldRenderProps

```ts
interface FieldRenderProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}
```

The object passed to `Field`'s render-prop child; spread it onto the wrapped control.

### Exported prop interfaces

Every component also exports its props interface for typing wrappers and refs: `ButtonProps`, `IconButtonProps`, `InputProps`, `TextareaProps`, `NumberFieldProps`, `CheckboxProps`, `SwitchProps`, `RadioProps`, `RadioGroupProps`, `SelectProps`, `FieldProps`, `LabelProps`, `HintProps`.

---

## Hooks

This group exports **no public hooks**. The internal `useControllableState` helper (used by `Button`-family and toggle controls to bridge controlled/uncontrolled state) is private to `controls.tsx` and is not exported.
