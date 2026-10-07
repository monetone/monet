# Creative vector tool groups

Mocked-but-sharable Illustrator-style vector tooling — a `Pathfinder` (boolean shape-mode tiles + compound-path operation chips) and an `AlignBar` (an align / distribute toolbar with an optional "align to" target). Behaviour (the `aria-pressed` toggles, a `role="toolbar"` roving tabindex, the `on*`-family callbacks) is real even though host geometry is mocked.

> **Stylesheet:** import the Monet stylesheet once at your app root: `import "@monet-ui/monet-core/index.css";`. Without it the tool groups render unstyled.
>
> **Source:** `packages/monet-react/src/creative-vector.tsx`.
>
> **Glyphs:** the shape-mode and align/distribute icons are **local** monoline `d`-path constants exported from this module — `PATHFINDER_ICONS` and `ALIGN_ICONS` — promoted from the inline paths the `examples/vector` + `examples/sandbox` align/pathfinder toolbars drew. They are **not** part of the shared `I` icon map, so you can theme or replace them per-app without touching the icon set.
>
> **Patterns:** the shape-mode tiles reuse `.monet-iconbtn` as glass `<button aria-pressed>` toggles in a `role="group"`; the operation chips and labelled align buttons reuse `.monet-chip`; section headings reuse `.monet-section-label`. `AlignBar` is a `role="toolbar"` with a roving tabindex (only one button is in the tab order; **Arrow** keys move focus along the axis, **Home/End** jump to the ends), mirroring the chrome toolbar pattern. Pass `accent` (a CSS color or `var(--accent…)`) to tint the active states.

---

## Pathfinder

The Illustrator Pathfinder panel: a row of glass shape-mode tiles over a row of momentary compound-path operation chips. The shape-mode tiles are a `role="group"` of `<button aria-pressed>` toggles — selection is **single-select and controlled** via `activeMode`: pressing a tile fires `onMode(value)`, and pressing the currently-active tile fires `onMode(null)` to clear it. (Omit `activeMode` and the tiles act as momentary triggers with no pressed state.) The operation chips are momentary — each fires `onOperation(value)` on click and carries no state. Headings reuse `.monet-section-label`; tiles reuse `.monet-iconbtn`; op chips reuse `.monet-chip`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `shapeModes` | `PathfinderShapeModeItem[]` | the four `PATHFINDER_ICONS` modes (unite / minus / intersect / exclude) | Shape-mode tiles. Each `{ value, label, icon? }`; `icon` is a local `d`-path glyph. |
| `activeMode` | `string \| null` | — | Controlled active shape-mode value (single-select; `null` = none active). |
| `onMode` | `(value: string \| null) => void` | — | Fires the pressed shape-mode value; re-pressing the active mode fires `null`. |
| `operations` | `PathfinderOperation[]` | Divide / Trim / Merge / Crop / Outline / Minus Back | Compound-path operation chips. Each `{ value, label, disabled? }`. |
| `onOperation` | `(value: string) => void` | — | Fires the activated operation value (operations are momentary, not state). |
| `shapeModesLabel` | `ReactNode` | `"Shape modes"` | Heading over the shape-mode tiles. Pass `null` to hide it. |
| `operationsLabel` | `ReactNode` | `"Pathfinders"` | Heading over the operation chips. Pass `null` to hide it. |
| `accent` | `string` | — | Accent color for the active-tile tint / focus ring. |
| `aria-label` | `string` | — | Accessible name for the root container. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { Pathfinder } from "@monet-ui/monet-react";

const [mode, setMode] = useState<string | null>("unite");

<Pathfinder
  activeMode={mode}
  onMode={setMode}
  onOperation={(op) => applyPathfinder(op)}
  accent="var(--accent-vector)"
/>;
```

---

## AlignBar

The Illustrator/Figma align toolbar: a `role="toolbar"` of align + distribute `<button>`s, each with an accessible `aria-label` ("Align left", "Distribute horizontally", …) and `aria-pressed` when it matches `active`. Uses a **roving tabindex** — only one button is in the tab order (the `active` one when set, else the first); **ArrowRight/ArrowLeft** (horizontal) or **ArrowUp/ArrowDown** (vertical) move focus along the axis, and **Home/End** jump to the ends. Each button fires `onAlign(action)` on click (actions are momentary; pass `active` to reflect a host selection). An optional "align to" target — shown when `relativeTo` **or** `onRelativeToChange` is supplied — wraps `<Select>`. Buttons reuse `.monet-iconbtn`, or `.monet-chip` with their label when `showLabels` is set. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `actions` | `AlignAction[]` | all eight `ALIGN_ACTIONS` | Which actions to show, in order. |
| `onAlign` | `(action: AlignAction) => void` | — | Fires the activated align/distribute action (momentary, not state). |
| `active` | `AlignAction` | — | Highlight one action as the current selection (`aria-pressed`, and the roving tab stop). |
| `relativeTo` | `string` | — | Controlled "align to" target value (renders the `Select` when provided). |
| `onRelativeToChange` | `(value: string) => void` | — | Fires the chosen "align to" value (also opts the `Select` in). |
| `relativeToOptions` | `SelectOption[]` | Selection / Key Object / Artboard | Options for the "align to" `Select`. |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Bar axis (sets `aria-orientation` and the Arrow-key direction). |
| `showLabels` | `boolean` | `false` | Render each action's label beside its glyph (`.monet-chip`) vs icon-only (`.monet-iconbtn`). |
| `accent` | `string` | — | Accent color for the active-button tint / focus ring. |
| `aria-label` | `string` | `"Align"` | Accessible name for the toolbar. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { AlignBar, type AlignAction } from "@monet-ui/monet-react";

const [target, setTarget] = useState("selection");

<AlignBar
  active="center-h"
  onAlign={(a: AlignAction) => align(a)}
  relativeTo={target}
  onRelativeToChange={setTarget}
  accent="var(--accent-vector)"
/>;
```

---

## Glyph constants

The vector glyphs ship as plain monoline 16-box `d`-path strings so you can render or restyle them yourself (toolbars, menus, exports) without pulling in the shared `I` icon map.

| Export | Type | Description |
| --- | --- | --- |
| `PATHFINDER_ICONS` | `{ unite; minus; intersect; exclude }` (record of `string` paths) | The four boolean shape-mode glyphs (two overlapping shapes with the result implied by the fill/stroke split). |
| `ALIGN_ICONS` | `Record<AlignAction, string>` | The eight align/distribute glyphs, keyed by `AlignAction` (an edge/center guide + a snapped box; distribute glyphs show evenly-gapped marks). |
| `ALIGN_ACTIONS` | `AlignAction[]` | The default left→right (then distribute) action ordering — the `AlignBar` default. |

```tsx
import { ALIGN_ICONS, ALIGN_ACTIONS } from "@monet-ui/monet-react";

// e.g. drive your own icon component from the same paths
ALIGN_ACTIONS.map((a) => <MyGlyph key={a} d={ALIGN_ICONS[a]} />);
```

---

## Types

### AlignAction

```ts
type AlignAction =
  | "left" | "center-h" | "right"      // horizontal alignment
  | "top"  | "middle-v" | "bottom"     // vertical alignment
  | "dist-h" | "dist-v";               // distribute (horizontal / vertical)
```

The action emitted by `AlignBar` and the key into `ALIGN_ICONS`.

### PathfinderShapeMode

```ts
type PathfinderShapeMode = keyof typeof PATHFINDER_ICONS; // "unite" | "minus" | "intersect" | "exclude"
```

The built-in boolean shape-mode keys (a convenience alias over the `PATHFINDER_ICONS` map keys).

### PathfinderShapeModeItem / PathfinderOperation

```ts
interface PathfinderShapeModeItem {
  value: string;     // committed via onMode
  label: string;     // accessible name + tooltip
  icon?: string;     // a local d-path glyph (e.g. PATHFINDER_ICONS.unite)
}

interface PathfinderOperation {
  value: string;     // committed via onOperation
  label: ReactNode;  // visible chip content
  disabled?: boolean;
}
```

The item models for `Pathfinder`'s `shapeModes` and `operations`.

### Exported prop interfaces

Each component also exports its props interface for typing wrappers and refs: `PathfinderProps`, `AlignBarProps`.
