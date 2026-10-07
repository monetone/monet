# Creative viewport / canvas

Mocked-but-sharable canvas-edge tooling in the spirit of pro creative apps (Photoshop / Figma / After Effects viewports): an edge ruler, a zoom control, a navigator (minimap), a selection marquee, and a grid/guides overlay. Behaviour (drag → fraction, keyboard nudges, clamp, ARIA) lives in the components; visuals come from the Monet stylesheet.

> **Stylesheet:** import the Monet stylesheet once at your app root: `import "@monet-ui/monet-core/index.css";`. Without it these surfaces render unstyled.
>
> **Source:** `packages/monet-react/src/creative-viewport.tsx`.
>
> **Controlled/uncontrolled:** the interactive widgets own state via the standard Monet convention — controlled when the value prop (`value` / `viewport`) is supplied, otherwise uncontrolled from `default*`. Every interaction emits an `onChange`-family callback. `CanvasRuler`, `Marquee`, and `GridGuides` are presentational and own no state.
>
> **Composition:** `ZoomControl` composes the shared `IconButton` + `Select`; `Navigator`'s zoom row reuses the `Slider` over a `.monet-row`. The marquee/navigator drag handlers copy the `Slider` core (`getBoundingClientRect` + `window` move/up + `setPointerCapture`).

---

## CanvasRuler

A decorative tick ruler for a canvas edge. Ticks are placed at `majorEvery` (labelled with the unit value + `unit` suffix) with one minor tick between when it fits; an optional `cursor` draws a position line that follows a unit value. Purely presentational — `role="presentation"` (carries no value semantics). Forwards its `ref` to the root `<div>`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Edge the ruler decorates. |
| `start` | `number` | `0` | First unit value at the ruler origin. |
| `end` | `number` | — | **Required.** Last unit value (the span end). |
| `pixelsPerUnit` | `number` | `1` | Pixels drawn per unit. |
| `majorEvery` | `number` | auto | Major (labelled) tick spacing in units. Auto-chosen from the scale (so labels never crowd) when omitted. |
| `cursor` | `number` | — | A position marker drawn as a cursor line, in units. |
| `unit` | `string` | — | Unit suffix appended to tick labels (e.g. `"px"`, `"%"`). |
| `aria-label` | `string` | — | Accessible name (the ruler is decorative, so usually omitted). |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { CanvasRuler } from "@monet-ui/monet-react";

<CanvasRuler end={1920} pixelsPerUnit={0.25} unit="px" cursor={pointerX} />;
```

---

## ZoomControl

A zoom control: − / + buttons that scale the zoom multiplicatively, a monospace percent readout (`role="spinbutton"`, **Arrow** keys nudge by the step factor, **Home/End** jump to the bounds), an optional **Fit** button, and an optional preset `Select`. The readout owns the value via the controllable-state convention. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Controlled zoom (`1` = 100%). |
| `defaultValue` | `number` | `1` | Initial zoom when uncontrolled. |
| `onChange` | `(zoom: number) => void` | — | Fires the next zoom on a button / key / preset change. |
| `min` | `number` | `0.05` | Smallest zoom (5%). |
| `max` | `number` | `64` | Largest zoom (6400%). |
| `step` | `number` | `Math.SQRT2` | Multiplicative step per − / + press (a `> 1` factor; e.g. `2` doubles). |
| `presets` | `number[]` | — | Preset zoom levels rendered as a quick-pick `Select` (e.g. `[0.5, 1, 2]`). |
| `onFit` | `() => void` | — | When set, renders a **Fit** button that calls this. |
| `disabled` | `boolean` | — | Inert + non-focusable. |
| `accent` | `string` | — | Accent color (CSS color or `var(--accent…)`). |
| `aria-label` | `string` | `"Zoom"` | Accessible name for the readout. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { ZoomControl } from "@monet-ui/monet-react";

<ZoomControl
  value={zoom}
  onChange={setZoom}
  presets={[0.25, 0.5, 1, 2, 4]}
  onFit={fitToScreen}
/>;
```

The − / + buttons auto-disable at `min` / `max`. The preset `Select` shows a checked option only when the zoom lands on a preset exactly; otherwise its placeholder mirrors the live percent.

---

## Navigator

A navigator (minimap): an inset preview box with a draggable viewport marquee (drag moves `x`/`y` within `0..1`, clamped so the rect stays inside the document), plus an optional zoom row built on the shared `Slider` over a `.monet-row`. The marquee is `role="slider"` (**Arrow** pans, **Shift+Arrow** = ×5, **Home/End** jump to the edges); the preview is `role="img"`. Forwards its `ref` to the root.

**`ViewportRect`** — all fields are `0..1` fractions of the document.

| Field | Type | Description |
| --- | --- | --- |
| `x` | `number` | Left edge as a fraction. |
| `y` | `number` | Top edge as a fraction. |
| `w` | `number` | Width as a fraction. |
| `h` | `number` | Height as a fraction. |

**`NavigatorProps`**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `preview` | `ReactNode` | — | Inset preview content (a thumbnail of the document). |
| `viewport` | `ViewportRect` | — | Controlled viewport rect (`0..1` fractions). |
| `defaultViewport` | `ViewportRect` | `{ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }` | Initial viewport when uncontrolled. |
| `onViewportChange` | `(rect: ViewportRect) => void` | — | Fires the next viewport rect on each drag tick / key nudge. |
| `zoom` | `number` | — | Controlled zoom for the zoom row (`1` = 100%). Supplying this (or `onZoomChange`) renders the row. |
| `onZoomChange` | `(zoom: number) => void` | — | Fires the next zoom from the row's slider. |
| `zoomLabel` | `ReactNode` | percent of `zoom` | Custom readout for the zoom row. |
| `aspectRatio` | `string` | `"3/2"` | Aspect ratio of the preview box (a CSS `aspect-ratio`). |
| `accent` | `string` | — | Accent color. |
| `aria-label` | `string` | `"Navigator"` | Accessible name for the group. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { Navigator, type ViewportRect } from "@monet-ui/monet-react";

<Navigator
  preview={<img src={thumb} alt="" />}
  viewport={viewport}
  onViewportChange={setViewport}
  zoom={zoom}
  onZoomChange={setZoom}
/>;
```

---

## Marquee

A dashed selection rectangle with a marching-ants animation (the CSS honors `prefers-reduced-motion`, freezing the dashes). Mostly presentational — `role="presentation"`; an optional `label` chip annotates the corner. Forwards its `ref`.

**`MarqueeRect`**

| Field | Type | Description |
| --- | --- | --- |
| `x` / `y` | `number` | Top-left position (a px or `%` length — see `percent`). |
| `w` / `h` | `number` | Size (a px or `%` length). |

**`MarqueeProps`**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `rect` | `MarqueeRect` | — | **Required.** The rectangle to draw. |
| `percent` | `boolean` | `false` | Treat `rect` values as percentages of the parent instead of pixels. |
| `marching` | `boolean` | `true` | Animate the marching ants (honors `prefers-reduced-motion`). |
| `label` | `ReactNode` | — | Optional label chip rendered at the rect's corner (e.g. a size readout). |
| `accent` | `string` | — | Accent color. |
| `className` | `string` | — | Extra class on the root. |
| `style` | `CSSProperties` | — | Extra inline styles (merged after the position styles). |

```tsx
import { Marquee } from "@monet-ui/monet-react";

<Marquee rect={{ x: 40, y: 24, w: 200, h: 120 }} label="200 × 120" />;
```

Place a `<Marquee>` inside a `position: relative` canvas surface; it positions absolutely from the parent's top-left.

---

## GridGuides

An absolutely-positioned overlay drawing a background grid (a CSS repeating-gradient, with optional `subdivisions`) plus accent guide lines. Decorative — `aria-hidden`, `pointer-events: none`. Forwards its `ref`.

**`Guide`**

| Field | Type | Description |
| --- | --- | --- |
| `axis` | `"x" \| "y"` | `"x"` → a vertical line at `pos`; `"y"` → a horizontal line at `pos`. |
| `pos` | `number` | Position in pixels from the overlay's top-left origin. |

**`GridGuidesProps`**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `gridSize` | `number` | `16` | Spacing of the background grid in pixels. |
| `subdivisions` | `number` | `0` | Minor subdivisions drawn between major grid lines. |
| `guides` | `Guide[]` | — | Explicit guide lines drawn over the grid (accent). |
| `showGrid` | `boolean` | `true` | Draw the background grid. |
| `showGuides` | `boolean` | `true` | Draw the explicit guide lines. |
| `accent` | `string` | — | Accent color for the guide lines. |
| `className` | `string` | — | Extra class on the root. |
| `style` | `CSSProperties` | — | Extra inline styles. |

```tsx
import { GridGuides } from "@monet-ui/monet-react";

<GridGuides
  gridSize={32}
  subdivisions={3}
  guides={[
    { axis: "x", pos: 160 },
    { axis: "y", pos: 90 },
  ]}
/>;
```

Place a `<GridGuides>` as the last child of a `position: relative` canvas surface so it overlays the content without intercepting pointer events.
