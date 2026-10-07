# Creative color controls

Mocked-but-sharable color tooling in the spirit of pro creative apps (Photoshop / Figma / After Effects color pickers) — a saturation/value field, hue & alpha sliders, a color wheel, a gradient editor, the composite color picker, and swatch / glyph palettes. Behaviour (2D / 1D / polar drag, keyboard, clamp, ARIA) is real even though host data is mocked; everything flows through `onChange`-family callbacks.

> **Stylesheet:** import the Monet stylesheet once at your app root: `import "@monet-ui/monet-core/index.css";`. Without it the controls render unstyled.
>
> **Source:** `packages/monet-react/src/creative-color.tsx` (with `creative-color-math.ts` for the color-space math + paint strings and `creative-color-palette.tsx` for the swatch / glyph leaves).
>
> **Canonical state is HSV.** The source of truth is `HSV { h: 0..360, s: 0..1, v: 0..1, a?: 0..1 }`; hex and RGB are always **derived**. Never store hex as the source of truth — it loses the hue at `s = 0` (every grey is `#nnnnnn`). A `ColorValue` is either an `HSV` or a hex string (`"#rgb"` / `"#rrggbb"` / `"#rrggbbaa"`).
>
> **Patterns:** the drag handlers mirror `Slider` (`getBoundingClientRect` + window `pointermove`/`up` + `setPointerCapture`). Controlled when `value` is supplied; otherwise uncontrolled from `defaultValue`. Pass `accent` (a CSS color or `var(--accent…)`) to tint the focus ring / knobs.

---

## ColorField

A 2D saturation (X) / value (Y) square bound to its HSV's hue. The thumb sits at `left = s·100%`, `top = (1−v)·100%`; the hue paints the background. Pointer-drag sets `s` and `v` together (`setPointerCapture`); Arrow keys nudge `s` (Left/Right) and `v` (Up/Down), **Shift** for ×10, Home/End jump `s` to 0/1. `role="slider"` with an `aria-valuetext` of `"S <n>, V <n>"`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `HSV` | — | Controlled HSV. Omit (with `defaultValue`) for uncontrolled use. |
| `defaultValue` | `HSV` | `{ h: 0, s: 1, v: 1 }` | Initial HSV when uncontrolled. |
| `onChange` | `(hsv: HSV) => void` | — | Fires with the next HSV on each drag tick / keyboard nudge. |
| `onChangeEnd` | `(hsv: HSV) => void` | — | Fires once when a drag ends. |
| `disabled` | `boolean` | — | Inert + non-focusable. |
| `accent` | `string` | — | Accent color for the focus ring. |
| `id` | `string` | — | Element id. |
| `aria-label` | `string` | `"Saturation and brightness"` | Accessible name. |
| `className` | `string` | — | Extra class on the root. |
| `style` | `CSSProperties` | — | Inline style on the root. |

```tsx
import { ColorField } from "@monet-ui/monet-react";

<ColorField defaultValue={{ h: 210, s: 0.6, v: 0.9 }} onChange={setColor} />;
```

---

## HueSlider

A 1D rainbow hue slider over `0..360`. Slider-core drag + keyboard: Arrow (±1), Page (±10), Home/End (0 / 360). `role="slider"` with `aria-valuemin/max/now`. `vertical` flips the axis bottom-to-top. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Controlled hue `0..360`. Omit (with `defaultValue`) for uncontrolled use. |
| `defaultValue` | `number` | `0` | Initial hue when uncontrolled. |
| `onChange` | `(hue: number) => void` | — | Fires with the next hue. |
| `onChangeEnd` | `(hue: number) => void` | — | Fires once when a drag ends. |
| `vertical` | `boolean` | — | Orient bottom-to-top instead of left-to-right. |
| `disabled` | `boolean` | — | Inert + non-focusable. |
| `accent` | `string` | — | Accent color for the focus ring. |
| `id` | `string` | — | Element id. |
| `aria-label` | `string` | `"Hue"` | Accessible name. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { HueSlider } from "@monet-ui/monet-react";

<HueSlider value={hue} onChange={setHue} />;
```

---

## AlphaSlider

A 1D opacity slider: a transparent→color ramp over a checkerboard, tinted by `color`. Slider-core drag + keyboard (Arrow ±0.01, Page ±0.1, Home/End 0 / 1). `role="slider"` with a percent `aria-valuetext`. `vertical` flips the axis. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Controlled opacity `0..1`. Omit (with `defaultValue`) for uncontrolled use. |
| `defaultValue` | `number` | `1` | Initial opacity when uncontrolled. |
| `onChange` | `(alpha: number) => void` | — | Fires with the next opacity. |
| `onChangeEnd` | `(alpha: number) => void` | — | Fires once when a drag ends. |
| `color` | `ColorValue` | `{ h: 0, s: 0, v: 0 }` | The color the opacity ramp is tinted with. |
| `vertical` | `boolean` | — | Orient bottom-to-top. |
| `disabled` | `boolean` | — | Inert + non-focusable. |
| `accent` | `string` | — | Accent color for the focus ring. |
| `id` | `string` | — | Element id. |
| `aria-label` | `string` | `"Opacity"` | Accessible name. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { AlphaSlider } from "@monet-ui/monet-react";

<AlphaSlider color={{ h: 210, s: 0.6, v: 0.9 }} value={alpha} onChange={setAlpha} />;
```

---

## ColorWheel

A conic HSV wheel — angle = hue, radius = saturation. Polar drag maps the pointer to `h = (atan2(dy,dx)·180/π + 360) mod 360`, `s = min(1, hypot/r)` (value is preserved). Arrow keys move hue (Left/Right) and saturation (Up/Down); Home/End set `s` to 0 / 1. `role="slider"` with an `"H <n>, S <n>"` `aria-valuetext`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `HSV` | — | Controlled HSV. Omit (with `defaultValue`) for uncontrolled use. |
| `defaultValue` | `HSV` | `{ h: 0, s: 1, v: 1 }` | Initial HSV when uncontrolled. |
| `onChange` | `(hsv: HSV) => void` | — | Fires with the next HSV. |
| `onChangeEnd` | `(hsv: HSV) => void` | — | Fires once when a drag ends. |
| `size` | `number` | `56` | Pixel diameter. |
| `disabled` | `boolean` | — | Inert + non-focusable. |
| `accent` | `string` | — | Accent color for the focus ring. |
| `id` | `string` | — | Element id. |
| `aria-label` | `string` | `"Color wheel"` | Accessible name. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { ColorWheel } from "@monet-ui/monet-react";

<ColorWheel size={64} value={color} onChange={setColor} />;
```

---

## EyedropperReadout

A swatch plus a monospace color readout (`hex` / `rgb` / `hsv`), with an optional dropper pick button. Display-only — it owns no color state. The readout uses `I.dropper`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `ColorValue` | — | **Required.** The color to display. |
| `format` | `"hex" \| "rgb" \| "hsv"` | `"hex"` | Readout format. |
| `subtitle` | `ReactNode` | — | Optional secondary line under the value. |
| `onPick` | `() => void` | — | When set, renders a dropper `IconButton` that calls this on click. |
| `accent` | `string` | — | Accent color. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { EyedropperReadout } from "@monet-ui/monet-react";

<EyedropperReadout value="#3d8fc4" format="rgb" subtitle="sRGB" onPick={pickFromScreen} />;
```

---

## GradientEditor

A gradient bar with draggable color stops. Drag a stop handle to move its offset (`setPointerCapture`); click the track to add an interpolated stop; **Delete** removes the selected stop (a minimum of two is kept); **Enter** / double-click requests a stop's color. The type is chosen with a `radiogroup`, the angle with an `AngleDial`. Each handle is `role="slider"` labelled `"Stop at N%"`. Forwards its `ref` to the bar.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `GradientValue` | — | Controlled gradient. Omit (with `defaultValue`) for uncontrolled use. |
| `defaultValue` | `GradientValue` | a black→white linear ramp | Initial gradient when uncontrolled. |
| `onChange` | `(value: GradientValue) => void` | — | Fires with the next gradient. |
| `onChangeEnd` | `(value: GradientValue) => void` | — | Fires once when a drag / discrete edit ends. |
| `selectedStop` | `string` | — | Controlled selected stop id. |
| `onSelectStop` | `(id: string) => void` | — | Fires when a stop becomes selected. |
| `onRequestStopColor` | `(id: string) => void` | — | Fires when a stop's color is requested (host opens a picker). |
| `accent` | `string` | — | Accent color for the angle dial / focus ring. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { GradientEditor } from "@monet-ui/monet-react";

<GradientEditor
  value={gradient}
  onChange={setGradient}
  onRequestStopColor={(id) => openPickerFor(id)}
/>;
```

---

## ColorPicker

The composite color picker: a `ColorField` + `HueSlider` + (optional) `AlphaSlider`, hex / rgb / hsv inputs, and a swatch quick-pick row. It owns a single `HSV` via `useControllableState` and keeps every sub-control in sync. When an RGB / hex edit collapses to grey (`s = 0`) the picker keeps its remembered hue. Controlled when `value` is supplied; otherwise uncontrolled from `defaultValue`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `ColorValue` | — | Controlled color. Omit (with `defaultValue`) for uncontrolled use. |
| `defaultValue` | `ColorValue` | `{ h: 210, s: 0.6, v: 0.9, a: 1 }` | Initial color when uncontrolled. |
| `onChange` | `(hsv: HSV) => void` | — | Fires with the next HSV. |
| `onChangeEnd` | `(hsv: HSV) => void` | — | Fires once when an interaction ends. |
| `inputs` | `Array<"hex" \| "rgb" \| "hsv">` | `["hex", "rgb"]` | Which numeric input rows to show. |
| `alpha` | `boolean` | `true` | Show the alpha slider. |
| `swatches` | `string[]` | — | Hex strings rendered as a quick-pick row. |
| `onSwatchAdd` | `(hex: string) => void` | — | Fires the current color as a canonical (lowercase) `"#rrggbb"` from the "add swatch" button. |
| `accent` | `string` | — | Accent color. |
| `id` | `string` | — | Element id. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { ColorPicker } from "@monet-ui/monet-react";

<ColorPicker
  value={color}
  onChange={setColor}
  inputs={["hex", "rgb"]}
  swatches={["#ff0000", "#00ff00", "#0000ff"]}
  onSwatchAdd={(hex) => addToPalette(hex)}
/>;
```

---

## SwatchGrid

A grid of selectable swatches (`role="listbox"` / `option`) with 2D arrow-key navigation. Cells are `Swatch` buttons; the selected one gets a ring. Controlled when `selectedId` is supplied; otherwise uncontrolled from `defaultSelectedId`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `swatches` | `Array<SwatchItem \| string>` | — | **Required.** Swatches as items or bare hex strings. |
| `columns` | `number` | `8` | Columns in the grid. |
| `selectedId` | `string` | — | Controlled selected id. |
| `defaultSelectedId` | `string` | — | Initial selected id when uncontrolled. |
| `onSelect` | `(id: string, item: SwatchItem) => void` | — | Fires with the selected id + item. |
| `gap` | `number` | `4` | Grid gap in px. |
| `square` | `boolean` | `true` | Square cells. |
| `onAdd` | `() => void` | — | When set, renders a trailing add button. |
| `aria-label` | `string` | `"Swatches"` | Accessible name. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { SwatchGrid } from "@monet-ui/monet-react";

<SwatchGrid
  swatches={["#ff0000", "#ffaa00", "#00ff00", "#0080ff"]}
  selectedId={selected}
  onSelect={(id) => setSelected(id)}
  onAdd={addSwatch}
/>;
```

---

## Swatch

A focusable color swatch button (the inner chip reuses `.monet-swatch`). A selection ring is shown when `selected`. Extends `ButtonHTMLAttributes<HTMLButtonElement>` (native `color` omitted) and forwards its `ref`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `color` | `ColorValue` | — | **Required.** Fill color. |
| `selected` | `boolean` | — | Show the selection ring (`aria-pressed`). |
| `size` | `number` | `18` | Pixel size of the inner swatch. |
| `empty` | `boolean` | — | Render the empty / "no color" state. |
| `aria-label` | `string` | — | Accessible name (swatches have no visible text). |
| ...rest | `Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color">` | — | All native button props (`onClick`, `disabled`, …). |

```tsx
import { Swatch } from "@monet-ui/monet-react";

<Swatch color="#3d8fc4" aria-label="Ocean" selected onClick={pick} />;
```

---

## GlyphGrid

A grid of selectable glyphs (`role="grid"` / `gridcell`) with 2D arrow-key navigation. Controlled when `selectedChar` is supplied; otherwise uncontrolled from `defaultSelectedChar`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `glyphs` | `Array<GlyphItem \| string>` | — | **Required.** Glyphs as items or bare characters. |
| `columns` | `number` | `6` | Columns in the grid. |
| `fontFamily` | `string` | — | Font family for the glyph cells. |
| `selectedChar` | `string` | — | Controlled selected character. |
| `defaultSelectedChar` | `string` | — | Initial selected character when uncontrolled. |
| `onSelect` | `(char: string, item: GlyphItem) => void` | — | Fires with the selected character + item. |
| `aria-label` | `string` | `"Glyphs"` | Accessible name. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { GlyphGrid } from "@monet-ui/monet-react";

<GlyphGrid
  glyphs={[{ char: "→", name: "arrow" }, { char: "★", name: "star" }]}
  onSelect={(char) => insert(char)}
/>;
```

---

## HexInput

A hex text field that parses + normalizes `"#rrggbb"` on blur / Enter, using a draft buffer for intermediate typing (an unparseable value reverts on commit). Reuses the `.monet-input` chrome via the shared `Input`. Controlled when `value` is supplied; otherwise uncontrolled from `defaultValue`. Forwards its `ref` to the underlying `<input>`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | — | Controlled hex value. Omit (with `defaultValue`) for uncontrolled use. |
| `defaultValue` | `string` | `""` | Initial value when uncontrolled. |
| `onChange` | `(hex: string) => void` | — | Fires with the normalized `"#rrggbb"` on blur / Enter. |
| `placeholder` | `string` | `"#000000"` | Placeholder text. |
| `aria-label` | `string` | `"Hex color"` | Accessible name. |
| `disabled` | `boolean` | — | Disable the field. |
| `className` | `string` | — | Extra class on the input. |

```tsx
import { HexInput } from "@monet-ui/monet-react";

<HexInput value={hex} onChange={setHex} />;
```

---

## Color math & paint helpers

Pure, framework-free color-space conversions (re-exported from the package root). The source of truth is `HSV`; everything else derives from it. Greys (`s = 0`) report hue `0`.

```ts
import {
  hsvToRgb, rgbToHsv,        // HSV ↔ RGB (channels 0..255)
  hsvToHex, hexToHsv,        // HSV ↔ "#rrggbb"
  rgbToHex, hexToRgb,        // RGB ↔ hex ("#rgb" / "#rrggbb" / "#rrggbbaa")
  hsvToCss, colorToCss,      // → "rgb()" / "rgba()" paint strings
  toHsv,                     // ColorValue → HSV (with a fallback)
} from "@monet-ui/monet-react";
```

`hexToRgb` / `hexToHsv` return `null` on an unparseable string so callers can keep the previous value. `hsvToHex` drops alpha (always 6 digits); use the RGB path when you need `"#rrggbbaa"`.

---

## Types

### HSV

```ts
interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
  a?: number; // 0..1 — treated as 1 when omitted
}
```

The canonical color. Hex / RGB are always derived from it.

### ColorValue

```ts
type ColorValue = HSV | string; // an HSV, or a hex string ("#rgb" / "#rrggbb" / "#rrggbbaa")
```

The color accepted by every component (normalized internally via `toHsv`).

### GradientStop / GradientValue

```ts
interface GradientStop {
  id: string;
  offset: number; // 0..1
  color: ColorValue;
}

interface GradientValue {
  type: "linear" | "radial";
  angle: number; // linear gradient angle, degrees
  stops: GradientStop[];
}
```

The gradient model used by `GradientEditor`.

### SwatchItem / GlyphItem

```ts
interface SwatchItem { id?: string; color: ColorValue; label?: string }
interface GlyphItem  { char: string; name?: string; code?: string }
```

Items for `SwatchGrid` and `GlyphGrid` (each also accepts a bare string).

### Exported prop interfaces

Every component also exports its props interface for typing wrappers and refs: `ColorFieldProps`, `HueSliderProps`, `AlphaSliderProps`, `ColorWheelProps`, `EyedropperReadoutProps`, `GradientEditorProps`, `ColorPickerProps`, `SwatchProps`, `SwatchGridProps`, `GlyphGridProps`, `HexInputProps`.
