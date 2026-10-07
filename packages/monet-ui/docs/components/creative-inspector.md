# Inspector & layout

Inspector / layout scaffolding for pro-creative-app panels, plus a few generic leaves (search, badge, progress, spinner) — built on real focusable elements with full keyboard, focus, and ARIA support, reusing the existing chrome classes where they fit and the shared design tokens so theme / density / accent respond automatically.

> **Stylesheet:** import the Monet stylesheet once at your app root: `import "@monet-ui/monet-core/index.css";`. Without it these components render unstyled.
>
> **Source:** `packages/monet-react/src/creative-inspector.tsx` (and `creative-tree.tsx`, re-exported from it). Every component is imported from `@monet-ui/monet-react`.

---

## Section

Collapsible inspector section with an accessible disclosure header — a real `<button aria-expanded aria-controls>` reusing the `.monet-section-label` typography plus a chevron; the body region stays mounted (hidden via `.is-collapsed`) so scroll/focus state survives a toggle. Controlled when `open` is supplied, otherwise uncontrolled from `defaultOpen`. A non-collapsible section is permanently expanded with an inert header.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `ReactNode` | — | **Required.** Header label. |
| `open` | `boolean` | — | Controlled open state. |
| `defaultOpen` | `boolean` | `true` | Initial open state when uncontrolled. |
| `onOpenChange` | `(open: boolean) => void` | — | Fires with the next open state on toggle. |
| `collapsible` | `boolean` | `true` | When `false`, always open + inert header. |
| `actions` | `ReactNode` | — | Right-aligned header slot (clicks here don't toggle). |
| `badge` | `ReactNode` | — | Small status element after the title. |
| `children` | `ReactNode` | — | **Required.** Section body. |
| `id` | `string` | auto-generated (`monet-cv-sec-…`) | Root element id. |
| `className` | `string` | — | Extra class on the root `<section>`. |

```tsx
import { Section, IconButton } from "@monet-ui/monet-react";

<Section title="Transform" actions={<IconButton icon="more" aria-label="More" />}>
  {/* rows… */}
</Section>;
```

---

## SegmentedControl

Exclusive pill toggle (the Photoshop/preset segment) rendered as `role="radiogroup"` with `role="radio"` segments, roving tabindex, and arrow-key navigation that selects on move (per the WAI-ARIA radiogroup pattern). Controlled when `value` is supplied, otherwise uncontrolled from `defaultValue` (which falls back to the first enabled item). Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `SegmentedItem[]` | — | **Required.** The segments. |
| `value` | `string` | — | Controlled selected value. |
| `defaultValue` | `string` | first enabled item | Initial value when uncontrolled. |
| `onChange` | `(value: string) => void` | — | Fires with the newly selected value. |
| `size` | `"sm" \| "md"` | `"sm"` | Control height. |
| `block` | `boolean` | — | Stretch to fill, segments sharing width equally. |
| `accent` | `string` | — | Accent color for the active segment. |
| `aria-label` | `string` | — | Accessible name for the group. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { SegmentedControl } from "@monet-ui/monet-react";

<SegmentedControl
  aria-label="Editor mode"
  items={[
    { value: "design", label: "Design", dot: true },
    { value: "develop", label: "Develop" },
    { value: "test", label: "Test" },
  ]}
  value={mode}
  onChange={setMode}
/>;
```

---

## ToggleGroup

A set of independent toggles (or a single-select set when `exclusive`), rendered as `role="group"` with each button carrying `aria-pressed`. Icon-only items reuse `.monet-iconbtn`; labelled items reuse `.monet-chip`. Roving tabindex (the first pressed enabled item is the tab stop, else the first enabled). Controlled when `value` is supplied, otherwise uncontrolled from `defaultValue`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `ToggleItem[]` | — | **Required.** The toggles. Icon-only items need an `"aria-label"`. |
| `value` | `string[]` | — | Controlled pressed values. |
| `defaultValue` | `string[]` | `[]` | Initial pressed values when uncontrolled. |
| `onChange` | `(value: string[]) => void` | — | Fires with the next pressed set. |
| `exclusive` | `boolean` | `false` | Single-select: pressing one clears the rest. |
| `size` | `"sm" \| "md"` | `"sm"` | Control height. |
| `aria-label` | `string` | — | Accessible name for the group. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { ToggleGroup } from "@monet-ui/monet-react";

<ToggleGroup
  aria-label="Text format"
  value={format}
  onChange={setFormat}
  items={[
    { value: "bold", icon: "text", "aria-label": "Bold" },
    { value: "italic", icon: "pen", "aria-label": "Italic" },
  ]}
/>;
```

---

## ToolbarGroup

An icon-button cluster with roving arrow-key focus across whatever focusable children it contains (discovered at navigation time, so arbitrary children compose). Renders `role="toolbar"` (+ `aria-orientation`) by default — Arrow keys move along the orientation axis, Home/End jump to the ends. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Layout + arrow axis + `aria-orientation`. |
| `children` | `ReactNode` | — | **Required.** Focusable buttons / links (and `ToolbarSeparator`s). |
| `size` | `"sm" \| "md"` | `"md"` | Cluster sizing class. |
| `aria-label` | `string` | — | Accessible name. |
| `role` | `"toolbar" \| "group"` | `"toolbar"` | Container role (`aria-orientation` only emitted for `"toolbar"`). |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { ToolbarGroup, ToolbarSeparator, IconButton } from "@monet-ui/monet-react";

<ToolbarGroup aria-label="Drawing tools">
  <IconButton icon="brush" aria-label="Brush" />
  <IconButton icon="erase" aria-label="Erase" />
  <ToolbarSeparator />
  <IconButton icon="zoom" aria-label="Zoom" />
</ToolbarGroup>;
```

---

## ToolbarSeparator

A hairline divider between toolbar clusters. Renders `role="separator"` with the perpendicular `aria-orientation`. Not focusable, so the `ToolbarGroup` roving navigation skips it.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Orientation of the surrounding toolbar (the rule is drawn perpendicular). |
| `className` | `string` | — | Extra class. |

```tsx
import { ToolbarSeparator } from "@monet-ui/monet-react";

<ToolbarSeparator />;
```

---

## Breadcrumb

A path trail rendered as `<nav><ol><li>`. Interactive crumbs are `<button>`s; the last crumb is `aria-current="page"` and non-interactive. `maxItems` collapses the middle into an `…` ellipsis, always keeping the first and last crumbs. Forwards its `ref` to the `<nav>`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `BreadcrumbItem[]` | — | **Required.** The crumbs, root → leaf. |
| `onNavigate` | `(id: string, index: number) => void` | — | Fires when an interactive crumb is activated. |
| `separator` | `ReactNode` | a chevron (`I.chevRight`) | Element drawn between crumbs. |
| `maxItems` | `number` | — | Collapse the middle once there are more than this many crumbs. |
| `aria-label` | `string` | `"Breadcrumb"` | Accessible name for the `<nav>`. |
| `className` | `string` | — | Extra class on the `<nav>`. |

```tsx
import { Breadcrumb } from "@monet-ui/monet-react";

<Breadcrumb
  items={[
    { id: "home", label: "Home", icon: "hand" },
    { id: "proj", label: "Project" },
    { id: "file", label: "Hero.psd" },
  ]}
  onNavigate={(id) => open(id)}
/>;
```

---

## TreeView

A generic recursive tree implementing the WAI-ARIA tree pattern: `role="tree"` with `role="treeitem"` rows carrying `aria-level`, `aria-selected`, and `aria-expanded` (branches only); a single roving tab stop; ArrowUp/Down move between visible rows; ArrowRight/Left expand/collapse-or-move; Home/End jump to the ends. Selection (`selectedId`) and expansion (`expandedIds`) are each independently controllable, otherwise uncontrolled from their `default…` props. Indentation is exposed as the `--monet-cv-depth` / `--monet-cv-indent` custom properties. Forwards its `ref` to the root. (Lives in `creative-tree.tsx`, re-exported from `creative-inspector.tsx` and the package root.)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `nodes` | `TreeNode[]` | — | **Required.** The root nodes. |
| `selectedId` | `string` | — | Controlled selected id. |
| `defaultSelectedId` | `string` | — | Initial selected id when uncontrolled. |
| `onSelect` | `(id: string, node: TreeNode) => void` | — | Fires with the selected id and node. |
| `expandedIds` | `string[]` | — | Controlled expanded ids. |
| `defaultExpandedIds` | `string[]` | `[]` | Initial expanded ids when uncontrolled. |
| `onExpandedChange` | `(ids: string[]) => void` | — | Fires with the next expanded set. |
| `renderNode` | `(node: TreeNode, info: TreeRenderInfo) => ReactNode` | — | Replace the default row content. |
| `indent` | `number` | `14` | Indentation per depth level, in px. |
| `aria-label` | `string` | — | Accessible name for the tree. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { TreeView, type TreeNode } from "@monet-ui/monet-react";

const nodes: TreeNode[] = [
  { id: "g1", label: "Group", icon: "shape", children: [{ id: "n1", label: "Layer 1" }] },
];

<TreeView nodes={nodes} aria-label="Layers" defaultExpandedIds={["g1"]} onSelect={select} />;
```

---

## SearchField

An `Input` with a leading search glyph and a trailing clear button. Reuses the `.monet-input` family and adds the clear affordance; renders a native `type="search"` input. Controlled when `value` is supplied, otherwise uncontrolled from `defaultValue`. Forwards its `ref` to the underlying `<input>`. Extends `InputProps` minus `type` / `iconStart` and the value props it redefines as string-typed.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | — | Controlled query string. |
| `defaultValue` | `string` | `""` | Initial query when uncontrolled. |
| `onChange` | `(value: string) => void` | — | Fires with the next query string. |
| `onSearch` | `(value: string) => void` | — | Fires on Enter with the current query. |
| `clearable` | `boolean` | `true` | Show the clear button when there is a query. |
| `onClear` | `() => void` | — | Fires after the clear button empties the field. |
| `placeholder` | `string` | `"Search…"` | Placeholder text. |
| `icon` | `string` | `"search"` | Leading glyph (an `I` key or raw SVG path). |
| `size` | `"sm" \| "md"` | `"md"` | Control height. |
| ...rest | `Omit<InputProps, "type" \| "iconStart" \| "value" \| "defaultValue" \| "onChange">` | — | Remaining native input props. |

```tsx
import { SearchField } from "@monet-ui/monet-react";

<SearchField value={q} onChange={setQ} onSearch={runSearch} aria-label="Search layers" />;
```

---

## Badge

A formalisation of the existing `.monet-chip`. `as="button"` renders a real, keyboard-operable `<button>` carrying the chip classes; otherwise a plain `<span>`. Tones map to the existing chip modifiers (`active` → `.is-active`, `accent` → `.is-accent`). Extends `HTMLAttributes<HTMLSpanElement>` and forwards its `ref`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `tone` | `"default" \| "active" \| "accent"` | `"default"` | Visual tone → `.monet-chip` modifier. |
| `icon` | `ReactNode` | — | Leading glyph / element. |
| `as` | `"span" \| "button"` | `"span"` | Render element. `"button"` → interactive. |
| `size` | `"sm" \| "md"` | `"md"` | Chip sizing class. |
| `children` | `ReactNode` | — | Badge content. |
| ...rest | `HTMLAttributes<HTMLSpanElement>` | — | Native props (`onClick`, `title`, …). |

```tsx
import { Badge } from "@monet-ui/monet-react";

<Badge tone="accent" icon={<span aria-hidden>●</span>}>Pro</Badge>;
```

---

## ProgressBar

A determinate or indeterminate progress meter. Renders `role="progressbar"` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax` when determinate (the `value` fraction is clamped into `0..1`); `aria-valuenow` is omitted when indeterminate and a shimmering fill is shown instead. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Progress fraction `0..1`. Omit (or set `indeterminate`) for an unknown bar. |
| `accent` | `string` | — | Accent color for the fill/glow. |
| `size` | `"sm" \| "md"` | `"md"` | Track height. |
| `label` | `ReactNode` | — | Optional caption above the track (labels the bar when no `aria-label`). |
| `indeterminate` | `boolean` | — | Force the indeterminate shimmer regardless of `value`. |
| `className` | `string` | — | Extra class on the root. |
| `aria-label` | `string` | — | Accessible name. |

```tsx
import { ProgressBar } from "@monet-ui/monet-react";

<ProgressBar value={0.62} label="Rendering" />;
<ProgressBar indeterminate aria-label="Loading" />;
```

---

## Spinner

An indeterminate monoline rotating arc. Renders `role="status"` + `aria-label` when `label` is given (so the loading state is announced), otherwise `aria-hidden` (purely decorative). Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | `number` | `16` | Diameter in px. |
| `accent` | `string` | — | Arc color (CSS color or `var(--accent…)`). |
| `label` | `string` | — | Accessible loading label. When omitted the spinner is `aria-hidden`. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { Spinner } from "@monet-ui/monet-react";

<Spinner label="Loading" />;
```

---

## Types

### SegmentedItem

```ts
interface SegmentedItem {
  value: string;
  label?: ReactNode;
  icon?: string;     // an `I` key or a raw SVG path
  disabled?: boolean;
  dot?: boolean;     // show the active-glow dot
}
```

### ToggleItem

```ts
interface ToggleItem {
  value: string;
  label?: ReactNode;
  icon?: string;
  "aria-label"?: string;  // required for icon-only items
  disabled?: boolean;
}
```

### BreadcrumbItem

```ts
interface BreadcrumbItem {
  id: string;
  label: ReactNode;
  icon?: string;
  disabled?: boolean;
}
```

### TreeNode

```ts
interface TreeNode {
  id: string;
  label: ReactNode;
  icon?: string;
  children?: TreeNode[];
  disabled?: boolean;
  data?: unknown;     // arbitrary payload handed back to onSelect / renderNode
}
```

### TreeRenderInfo

```ts
interface TreeRenderInfo {
  depth: number;
  expanded: boolean;
  selected: boolean;
  hasChildren: boolean;
}
```

The object passed to `TreeView`'s `renderNode` callback.

### Exported prop interfaces

Every component also exports its props interface for typing wrappers and refs: `SectionProps`, `SegmentedControlProps`, `ToggleGroupProps`, `ToolbarGroupProps`, `BreadcrumbProps`, `TreeViewProps`, `SearchFieldProps`, `BadgeProps`, `ProgressBarProps`, `SpinnerProps`.
