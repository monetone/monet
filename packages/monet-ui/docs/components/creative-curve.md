# Creative curve editors

Mocked-but-sharable SVG bezier curve editors in the spirit of pro creative apps — an EQ-style N-point `CurveEditor` (draggable control points, optional log frequency axis + area fill) and an `EasingCurve` (a single CSS cubic-bezier with two draggable handles + named preset chips). Behaviour (pointer drag → SVG units → clamped immutable update, keyboard nudges, ARIA) is real even though host data is mocked; everything flows through `onChange`-family callbacks.

> **Stylesheet:** import the Monet stylesheet once at your app root: `import "@monet-ui/monet-core/index.css";`. Without it the editors render unstyled.
>
> **Source:** `packages/monet-react/src/creative-curve.tsx` (with `creative-curve-math.ts` for the pure path / mapping / easing math).
>
> **Patterns:** the drag handlers mirror `Slider` (`getBoundingClientRect` on the SVG + window `pointermove`/`up` + `setPointerCapture` on each handle). Every draggable node is an SVG `<circle role="slider">`; the SVG root is `role="group"`. Controlled when `points` / `value` is supplied; otherwise uncontrolled from `defaultPoints` / `defaultValue`. Pass `accent` (a CSS color or `var(--accent…)`) to tint the path / points / focus ring. **Normalised coordinates:** points and handles store `x`/`y` in `0..1`; `xRange`/`yRange` map them onto display values only (the readout), and `xScale="log"` spaces the X readout geometrically for frequency axes.

---

## CurveEditor

A general N-point SVG bezier curve editor (EQ bands, custom transfer curves). Drag a `<circle>` to move its point (`setPointerCapture`; pointer → SVG units → `x,y`, clamped to `0..1`, immutable array update); click the background to add an interpolated point; double-click a point — or press Delete/Backspace on a focused one — to remove it (a minimum of two points is kept). The smooth `<path>` `d` is synthesised from the points (explicit `hIn`/`hOut` handles win when present). Keyboard on a focused point: Arrow keys nudge `x` (Left/Right) and `y` (Up/Down) by `0.01` (**Shift** ×10), Page keys nudge `y` by `0.1`, Home/End jump `x` to 0/1. Each point is `role="slider"` with an `aria-valuetext` of its mapped `"<x>, <y>"`. Forwards its `ref` to the SVG.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `points` | `CurvePoint[]` | — | Controlled points. Omit (with `defaultPoints`) for uncontrolled use. |
| `defaultPoints` | `CurvePoint[]` | 3 mid-line points | Initial points when uncontrolled. |
| `onChange` | `(points: CurvePoint[]) => void` | — | Fires with the next points on each drag tick / keyboard nudge / add / remove. |
| `onChangeEnd` | `(points: CurvePoint[]) => void` | — | Fires once when a drag ends (or after an add / remove). |
| `xRange` | `[number, number]` | `[0, 1]` | Value range the normalised X maps onto (for the readout). |
| `yRange` | `[number, number]` | `[0, 1]` | Value range the normalised Y maps onto (for the readout). |
| `xScale` | `"linear" \| "log"` | `"linear"` | X-axis spacing of the readout — `"log"` for frequency. |
| `fill` | `boolean` | `true` | Paint the area under the curve. |
| `editable` | `boolean` | `true` | Allow drag / add (bg click) / remove (dblclick / Delete). When `false`, points are non-focusable and inert. |
| `width` | `number` | `240` | Pixel width of the SVG viewBox. |
| `height` | `number` | `120` | Pixel height of the SVG viewBox. |
| `showGrid` | `boolean` | `true` | Render the background grid. |
| `accent` | `string` | — | Accent color for the path / points / focus ring. |
| `aria-label` | `string` | `"Curve editor"` | Accessible name for the group. |
| `className` | `string` | — | Extra class on the SVG. |

```tsx
import { CurveEditor, type CurvePoint } from "@monet-ui/monet-react";

const [bands, setBands] = useState<CurvePoint[]>([
  { id: "low", x: 0, y: 0.5, color: "#6aa0ff" },
  { id: "mid", x: 0.5, y: 0.62 },
  { id: "air", x: 1, y: 0.5 },
]);

<CurveEditor
  points={bands}
  onChange={setBands}
  xRange={[20, 20000]}
  xScale="log"
  yRange={[-12, 12]}
  accent="oklch(0.78 0.14 200)"
/>;
```

---

## EasingCurve

A single CSS cubic-bezier easing editor. Two draggable handles — `P1 = [x1, y1]` and `P2 = [x2, y2]` — live in a `0..1` box with the fixed `0,0` / `1,1` endpoints; each handle's **X is clamped to `[0, 1]`** (CSS `cubic-bezier()` requires it) while Y is free to move (kept on-screen by the same clamp). Keyboard on a focused handle: Arrow keys nudge by `0.01` (**Shift** ×10), Home/End jump X to 0/1. Optional named-preset chips (rendered with `SegmentedControl`) set the curve and highlight the matching preset. Each handle is `role="slider"`; the SVG root is `role="group"`. Forwards its `ref` to the root element.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `Bezier` (`[number, number, number, number]`) | — | Controlled `[x1,y1,x2,y2]` (the two cubic-bezier control points). |
| `defaultValue` | `Bezier` | `[0.42, 0, 0.58, 1]` (ease-in-out) | Initial curve when uncontrolled. |
| `onChange` | `(bezier: Bezier) => void` | — | Fires with the next bezier on each drag tick / keyboard nudge / preset. |
| `onChangeEnd` | `(bezier: Bezier) => void` | — | Fires once when a drag ends (or after a preset is chosen). |
| `presets` | `string[]` | `["ease-in", "ease-out", "ease-in-out"]` | Named CSS-easing preset chips. Pass `[]` to hide the control. |
| `size` | `number` | `160` | Pixel size of the square editor. |
| `accent` | `string` | — | Accent color for the path / handles / preset highlight. |
| `aria-label` | `string` | `"Easing curve"` | Accessible name for the group. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { EasingCurve, type Bezier } from "@monet-ui/monet-react";

const [ease, setEase] = useState<Bezier>([0.42, 0, 0.58, 1]);

<EasingCurve value={ease} onChange={setEase} accent="var(--accent)" />;
```

---

## Curve math & path helpers

Pure, framework-free helpers (no React, no DOM) behind the editors, re-exported from `creative-curve.tsx`. Useful for rendering the same curves yourself (previews, exports) or wiring custom inputs.

| Export | Signature | Description |
| --- | --- | --- |
| `fracToValue` | `(frac, lo, hi, scale?) => number` | Map a normalised `0..1` fraction onto `[lo, hi]` (`"log"` spaces it geometrically; falls back to linear when a bound ≤ 0). |
| `valueToFrac` | `(value, lo, hi, scale?) => number` | Inverse of `fracToValue` — a value → its clamped `0..1` fraction (log-aware). |
| `buildCurvePath` | `(points, width, height, smoothing?) => string` | Build the open smooth-curve `d` (cubic segments) through the points in SVG pixel space; honours explicit `hIn`/`hOut` handles. |
| `easingPath` | `(bezier, width, height, n?) => string` | Sample a CSS cubic-bezier `[x1,y1,x2,y2]` into an SVG `d` over `n` segments. |
| `EASING_PRESETS` | `Record<string, Bezier>` | The named CSS easings (`linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`). |

```tsx
import { easingPath, EASING_PRESETS } from "@monet-ui/monet-react";

const d = easingPath(EASING_PRESETS["ease-in-out"], 160, 160);
// → "M 0 160 L … L 160 0"
```

---

## Types

### CurvePoint

```ts
interface CurvePoint {
  id: string;
  x: number;        // normalised 0..1 along the X axis
  y: number;        // normalised 0..1 along the Y axis
  color?: string;   // optional per-point swatch (e.g. an EQ band color)
  hIn?: Vec2;       // optional incoming bezier handle, normalised offset
  hOut?: Vec2;      // optional outgoing bezier handle, normalised offset
}
```

One editable point on a `CurveEditor`. `x`/`y` are normalised; `xRange`/`yRange` map them onto display values only.

### Bezier

```ts
type Bezier = [number, number, number, number]; // [x1, y1, x2, y2] — the two cubic-bezier control points
```

The value of an `EasingCurve` (endpoints are fixed at `0,0` and `1,1`, matching CSS `cubic-bezier()`).

### CurveScale / Vec2

```ts
type CurveScale = "linear" | "log";
type Vec2 = { x: number; y: number };
```

`CurveScale` selects the X-readout spacing on `CurveEditor`; `Vec2` is the normalised handle-offset shape used by `CurvePoint`.

### Exported prop interfaces

Each component also exports its props interface for typing wrappers and refs: `CurveEditorProps`, `EasingCurveProps`.
