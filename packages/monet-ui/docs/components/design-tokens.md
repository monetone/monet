# Design tokens

The shared token vocabulary — the four per-app accents, fixed chrome metrics, corner radii, and the helpers that turn an accent name into a CSS reference — re-exported from `@monet-ui/monet-core` for convenience.

> Visuals come from the core stylesheet. Import it once in your app entry:
> ```ts
> import "@monet-ui/monet-core/index.css";
> ```
> These exports are the **typed mirror** of that stylesheet (`tokens.css` / `styles.css`) so TypeScript consumers and the Rust bridge can share one vocabulary. They are plain values, functions, and types — there are no React components or hooks in this group, so nothing here renders on its own.

All symbols below are importable from `@monet-ui/monet-react`:

```tsx
import {
  ACCENTS,
  ACCENT_NAMES,
  accentVar,
  accentValue,
  resolveAccent,
  METRICS,
  RADII,
} from "@monet-ui/monet-react";
import type { Accent, Platform, AccentDef } from "@monet-ui/monet-react";
```

---

## Functions

### `accentVar`

Returns a `var(--accent-…)` CSS reference for the named accent, suitable for the `--accent` custom property on a `.monet-window`.

**Signature**

```ts
function accentVar(accent: Accent): string
```

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `accent` | `Accent` | yes | One of `"raster" \| "vector" \| "audio" \| "motion"`. |

**Returns:** `string` — e.g. `accentVar("raster")` → `"var(--accent-raster)"`.

```tsx
import { accentVar } from "@monet-ui/monet-react";

const style = { "--accent": accentVar("audio") } as React.CSSProperties;
// <div className="monet-window" style={style}>…</div>
```

---

### `accentValue`

Returns the literal `oklch()` color value for the named accent (the same value defined in `tokens.css`).

**Signature**

```ts
function accentValue(accent: Accent): string
```

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `accent` | `Accent` | yes | One of `"raster" \| "vector" \| "audio" \| "motion"`. |

**Returns:** `string` — e.g. `accentValue("motion")` → `"oklch(0.75 0.18 350)"`.

```tsx
import { accentValue } from "@monet-ui/monet-react";

const cyan = accentValue("raster"); // "oklch(0.78 0.14 200)"
```

---

### `resolveAccent`

Normalizes an accent input that may be a known accent **name**, a `var(--…)` reference, or any raw CSS color. Known names resolve to their `var(--accent-…)` reference; anything else passes through unchanged. Useful for props that accept either a built-in accent or a custom color.

**Signature**

```ts
function resolveAccent(input: Accent | (string & {})): string
```

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | `Accent \| (string & {})` | yes | A known accent name, or any other CSS color / `var(...)` string. The `(string & {})` keeps editor autocomplete for the four accent names while still accepting arbitrary strings. |

**Returns:** `string` — `var(--accent-…)` for a known name, otherwise `input` verbatim.

```tsx
import { resolveAccent } from "@monet-ui/monet-react";

resolveAccent("vector");    // "var(--accent-vector)"
resolveAccent("#ff0080");   // "#ff0080" (passes through)
resolveAccent("var(--x)");  // "var(--x)" (passes through)
```

---

## Constants

### `ACCENTS`

The four per-app accent identities, keyed by accent name. The chrome itself stays neutral — accents only ever tint highlights (active indicators, sliders, focus rings).

**Type:** `Readonly<Record<Accent, AccentDef>>`

Each entry is an [`AccentDef`](#accentdef). The shipped values:

| Key | `cssVar` | `value` | `label` | `context` |
| --- | --- | --- | --- | --- |
| `raster` | `--accent-raster` | `oklch(0.78 0.14 200)` | Raster | Photo · cyan |
| `vector` | `--accent-vector` | `oklch(0.80 0.14 70)` | Vector | Illustration · amber |
| `audio` | `--accent-audio` | `oklch(0.74 0.16 305)` | Audio | Multitrack · violet |
| `motion` | `--accent-motion` | `oklch(0.75 0.18 350)` | Motion | Video · magenta |

```tsx
import { ACCENTS } from "@monet-ui/monet-react";

ACCENTS.audio.label;  // "Audio"
ACCENTS.audio.cssVar; // "--accent-audio"
```

---

### `ACCENT_NAMES`

The accent names in display order — handy for rendering pickers/swatches.

**Type:** `readonly Accent[]`

**Value:** `["raster", "vector", "audio", "motion"]`

```tsx
import { ACCENT_NAMES, ACCENTS } from "@monet-ui/monet-react";

ACCENT_NAMES.map((name) => ACCENTS[name].label);
// ["Raster", "Vector", "Audio", "Motion"]
```

---

### `METRICS`

Fixed chrome component heights/sizes (in pixels), mirroring the metrics section of the design system. Each value is the **default** the CSS uses; `styles.css` reads these through matching `--monet-…` custom properties, so `[data-density="compact"]` can retune the chrome without touching any rule.

**Type:** `const` object (all values `number`, literal-typed)

| Key | Value (px) | What it sizes |
| --- | --- | --- |
| `titlebarMac` | `48` | macOS titlebar height |
| `titlebarWin` | `36` | Windows titlebar height |
| `tabstripWin` | `42` | Windows tabstrip height |
| `menustrip` | `28` | Menu strip height |
| `toolbarH` | `44` | Toolbar height |
| `toolRailV` | `48` | Tool rail width |
| `toolButton` | `36` | Tool button size |
| `panelTabStrip` | `32` | Panel tab-strip height |
| `statusBar` | `24` | Status bar height |

```tsx
import { METRICS } from "@monet-ui/monet-react";

const macTitlebar = METRICS.titlebarMac; // 48
```

> Note: the backing CSS custom property names (e.g. `--monet-h-titlebar-mac`) live in `METRIC_VARS` in `@monet-ui/monet-core`, which is **not** re-exported through `@monet-ui/monet-react`. Import it from `@monet-ui/monet-core` directly if you need the variable names.

---

### `RADII`

Corner radii (in pixels) used across the system.

**Type:** `const` object (all values `number`, literal-typed)

| Key | Value (px) | Use |
| --- | --- | --- |
| `window` | `14` | Window corners |
| `panel` | `10` | Panel corners |
| `control` | `7` | Control corners (buttons, inputs) |
| `pill` | `999` | Fully rounded / pill shapes |

```tsx
import { RADII } from "@monet-ui/monet-react";

const panelRadius = RADII.panel; // 10
```

---

## Types

### `Accent`

The four per-app accent identities. The chrome stays neutral; accents only tint highlights (active indicators, sliders, focus).

```ts
type Accent = "raster" | "vector" | "audio" | "motion";
```

### `Platform`

The platform chrome variants Monet knows how to draw.

```ts
type Platform = "mac" | "win";
```

### `AccentDef`

The shape of each entry in [`ACCENTS`](#accents). All fields are `readonly`.

```ts
interface AccentDef {
  readonly name: Accent;                 // token name, e.g. "raster"
  readonly cssVar: `--accent-${Accent}`; // CSS custom property holding it
  readonly value: string;                // literal oklch() value (matches tokens.css)
  readonly label: string;                // human label
  readonly context: string;              // the creative context it dresses
}
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | `Accent` | Token name, e.g. `"raster"`. |
| `cssVar` | `` `--accent-${Accent}` `` | The CSS custom property that holds it, e.g. `"--accent-raster"`. |
| `value` | `string` | The literal `oklch()` value, matching `tokens.css`. |
| `label` | `string` | Human label, e.g. `"Raster"`. |
| `context` | `string` | Human label's creative context, e.g. `"Photo · cyan"`. |
