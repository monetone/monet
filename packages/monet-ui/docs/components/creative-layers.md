# Layers, channels & artboards

The Photoshop / Figma stacks: a selectable **layer panel** (rows with visibility, lock, opacity and blend mode), a **channels panel**, a nested **layer tree**, and an **artboard list** — built on real focusable elements with full keyboard, focus and ARIA support. They reuse the existing `.monet-layer` row chrome (`.vis` / `.thumb` / `.name` / `.meta`) and the shared design tokens, so theme / density / accent respond automatically.

The eye and lock affordances are real `<button role="switch" aria-pressed>` controls that `stopPropagation`, so toggling visibility or lock never also selects the row.

> **Stylesheet:** import the Monet stylesheet once at your app root: `import "@monet-ui/monet-core/index.css";`. Without it these components render unstyled.
>
> **Source:** `packages/monet-react/src/creative-layers.tsx`. Every component is imported from `@monet-ui/monet-react`.

---

## LayerRow

A single layer row rendered as `role="option"` on the chrome `.monet-layer` (eye · color chip · thumb · name · meta · lock). The eye + lock are `VisibilityToggle` / `LockToggle` switches that `stopPropagation`, so a click on them toggles state without selecting the row. With no custom `meta`, a `blendMode` / `opacity` readout fills the meta slot. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `ReactNode` | — | **Required.** Layer name (→ `.name`). |
| `visible` | `boolean` | `true` | Eye state. |
| `locked` | `boolean` | `false` | Lock state. |
| `opacity` | `number` | — | Opacity `0..100`, shown in the meta slot when no `meta` is given. |
| `blendMode` | `ReactNode` | — | Blend-mode label shown in the meta slot. |
| `colorChip` | `string` | — | Accent swatch (a CSS color) drawn before the thumb. |
| `thumb` | `ReactNode` | — | Thumbnail content (rendered into a `.thumb` box). |
| `selected` | `boolean` | — | Selected state → `aria-selected` + `.is-selected`. |
| `tabIndex` | `number` | `-1` | Roving tab stop (the list sets this). |
| `onSelect` | `() => void` | — | Fires on click / Enter / Space. |
| `onVisibilityToggle` | `(visible: boolean) => void` | — | Fires with the next visibility when the eye is toggled. |
| `onLockToggle` | `(locked: boolean) => void` | — | Fires with the next lock state when the lock is toggled. |
| `meta` | `ReactNode` | — | Custom right-aligned meta slot (replaces the opacity/blend readout). |
| `id` | `string` | — | Root element id. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { LayerRow } from "@monet-ui/monet-react";

<LayerRow
  name="Subject"
  opacity={80}
  blendMode="Multiply"
  selected
  onSelect={() => select("subject")}
  onVisibilityToggle={(v) => setVisible("subject", v)}
/>;
```

---

## LayerList

A selectable layer stack rendered as `role="listbox"`. Single-select by default (`selectedId` / `onSelect`), or multi-select (`multiSelect` adds `aria-multiselectable`, **Space** toggles a row's membership, `selectedIds` / `onSelectionChange`). Roving tabindex with **Arrow** / **Home** / **End**; the eye / lock switches inside each row toggle without changing selection. Controlled when the matching `selected*` prop is supplied, otherwise uncontrolled from `defaultSelected*`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `layers` | `LayerData[]` | — | **Required.** The rows, top → bottom. |
| `selectedId` | `string` | — | Controlled selected id (single-select). |
| `defaultSelectedId` | `string` | — | Initial selected id when uncontrolled. |
| `onSelect` | `(id: string) => void` | — | Fires with the selected id (single-select). |
| `multiSelect` | `boolean` | — | Allow multiple rows selected (adds `aria-multiselectable`). |
| `selectedIds` | `string[]` | — | Controlled selected ids (multi-select). |
| `defaultSelectedIds` | `string[]` | `[]` | Initial selected ids when uncontrolled (multi-select). |
| `onSelectionChange` | `(ids: string[]) => void` | — | Fires with the next selection (multi-select). |
| `onVisibilityChange` | `(id: string, visible: boolean) => void` | — | Fires when a row's eye toggles. |
| `onLockChange` | `(id: string, locked: boolean) => void` | — | Fires when a row's lock toggles. |
| `onOpacityChange` | `(id: string, opacity: number) => void` | — | Reserved for custom rows that edit opacity. |
| `onBlendModeChange` | `(id: string, mode: string) => void` | — | Reserved for custom rows that edit the blend mode. |
| `renderRow` | `(layer: LayerData, info: { selected: boolean; tabIndex: number }) => ReactNode` | — | Replace the default `LayerRow` rendering. |
| `header` | `ReactNode` | — | Header content above the rows. |
| `footer` | `ReactNode` | — | Footer content below the rows (a toolbar, etc.). |
| `aria-label` | `string` | `"Layers"` | Accessible name for the listbox. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { LayerList } from "@monet-ui/monet-react";

<LayerList
  aria-label="Layers"
  layers={[
    { id: "bg", name: "Background", opacity: 100 },
    { id: "subj", name: "Subject", opacity: 80, blendMode: "Normal" },
    { id: "glow", name: "Glow", opacity: 60, locked: true },
  ]}
  selectedId={layer}
  onSelect={setLayer}
  onVisibilityChange={(id, v) => setVisible(id, v)}
/>;
```

---

## VisibilityToggle

A small eye switch button — `role="switch"` + `aria-pressed`. Used inside `LayerRow` / `ChannelRow`; it `stopPropagation`s so toggling never bubbles to a row's selection. Controlled when `checked` is supplied, otherwise uncontrolled from `defaultChecked`. Forwards its `ref` to the `<button>`. Reuses the `.monet-layer .vis` style.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `checked` | `boolean` | — | Controlled visibility. |
| `defaultChecked` | `boolean` | `true` | Initial visibility when uncontrolled. |
| `onChange` | `(checked: boolean) => void` | — | Fires with the next visibility. |
| `disabled` | `boolean` | — | Disable the switch. |
| `aria-label` | `string` | `"Toggle visibility"` | Accessible name. |
| `className` | `string` | — | Extra class. |

```tsx
import { VisibilityToggle } from "@monet-ui/monet-react";

<VisibilityToggle checked={visible} onChange={setVisible} aria-label="Toggle layer" />;
```

---

## LockToggle

A small lock switch button — `role="switch"` + `aria-pressed`, defaulting to **unlocked**. Controlled when `on` is supplied, otherwise uncontrolled from `defaultChecked`. Forwards its `ref` to the `<button>`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `on` | `boolean` | — | Controlled lock state. |
| `defaultChecked` | `boolean` | `false` | Initial lock state when uncontrolled. |
| `onChange` | `(locked: boolean) => void` | — | Fires with the next lock state. |
| `disabled` | `boolean` | — | Disable the switch. |
| `aria-label` | `string` | `"Toggle lock"` | Accessible name. |
| `className` | `string` | — | Extra class. |

```tsx
import { LockToggle } from "@monet-ui/monet-react";

<LockToggle on={locked} onChange={setLocked} aria-label="Lock layer" />;
```

---

## BlendModeSelect

A thin wrapper over the form `Select`, preloaded with the Photoshop blend-mode roster (the exported `BLEND_MODES` constant — kebab-case value ids). Pass any `Select` prop except `options`; override `options` to use a custom roster. Forwards its `ref` to the trigger.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `options` | `SelectOption[]` | `BLEND_MODES` | The option roster. |
| ...rest | `Omit<SelectProps, "options">` | — | Any `Select` prop (`value`, `defaultValue`, `onChange`, `size`, `aria-label`, …). |

```tsx
import { BlendModeSelect } from "@monet-ui/monet-react";

<BlendModeSelect aria-label="Blend mode" value={mode} onChange={setMode} />;
```

---

## OpacityControl

An opacity row: a `0..100` `Slider` plus a monospace `%` readout, laid out on the chrome `.monet-row`. Controlled when `value` is supplied, otherwise uncontrolled from `defaultValue`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Controlled value `0..100`. |
| `defaultValue` | `number` | `100` | Initial value when uncontrolled. |
| `onChange` | `(pct: number) => void` | — | Fires with the next percentage. |
| `label` | `ReactNode` | `"Opacity"` | Leading label (→ `.lbl`). |
| `accent` | `string` | — | Accent color for the slider fill. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { OpacityControl } from "@monet-ui/monet-react";

<OpacityControl value={opacity} onChange={setOpacity} />;
```

---

## ChannelRow

A single channel row — a `LayerRow` specialization with one visibility switch and no lock; the meta slot carries the channel `shortcut`. Renders `role="option"`. The composite (RGB) channel gets the `.is-composite` modifier. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `ReactNode` | — | **Required.** Channel name. |
| `visible` | `boolean` | `true` | Eye state. |
| `thumb` | `ReactNode` | — | Channel thumbnail content. |
| `shortcut` | `ReactNode` | — | Keyboard-shortcut hint shown in the meta slot (e.g. `⌘3`). |
| `composite` | `boolean` | — | Marks the composite (RGB) channel → `.is-composite`. |
| `selected` | `boolean` | — | Selected state → `aria-selected` + `.is-selected`. |
| `tabIndex` | `number` | `-1` | Roving tab stop (the list sets this). |
| `onSelect` | `() => void` | — | Fires on click / Enter / Space. |
| `onVisibilityToggle` | `(visible: boolean) => void` | — | Fires when the eye toggles. |
| `id` | `string` | — | Root element id. |
| `className` | `string` | — | Extra class. |

---

## ChannelList

A channels panel rendered as `role="listbox"` — a thin specialization over `ChannelRow` for the RGB / Red / Green / Blue / Alpha stack. Single-select with roving **Arrow** / **Home** / **End**; each row's eye toggles visibility independently. Controlled when `selectedId` is supplied, otherwise uncontrolled from `defaultSelectedId`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `channels` | `ChannelData[]` | — | **Required.** The channels. |
| `selectedId` | `string` | — | Controlled selected id. |
| `defaultSelectedId` | `string` | — | Initial selected id when uncontrolled. |
| `onSelect` | `(id: string) => void` | — | Fires with the selected id. |
| `onVisibilityChange` | `(id: string, visible: boolean) => void` | — | Fires when a channel's eye toggles. |
| `aria-label` | `string` | `"Channels"` | Accessible name for the listbox. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { ChannelList } from "@monet-ui/monet-react";

<ChannelList
  aria-label="Channels"
  channels={[
    { id: "rgb", name: "RGB", composite: true, shortcut: "⌘2" },
    { id: "r", name: "Red", shortcut: "⌘3" },
    { id: "g", name: "Green", shortcut: "⌘4" },
    { id: "b", name: "Blue", shortcut: "⌘5" },
  ]}
  selectedId={channel}
  onSelect={setChannel}
/>;
```

---

## LayerTree

A nested layer tree (groups + children) that **composes** the generic `TreeView`, rendering a `LayerRow` per node — so each row keeps its eye / lock affordances while the tree owns the twisty, indentation and WAI-ARIA tree keyboard navigation (`role="tree"` / `role="treeitem"`). Uncontrolled expansion seeds from each node's `expanded` flag unless `defaultExpandedIds` is given. Selection and expansion are each independently controllable. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `nodes` | `LayerNode[]` | — | **Required.** The root nodes (each may have `children`). |
| `selectedId` | `string` | — | Controlled selected id. |
| `defaultSelectedId` | `string` | — | Initial selected id when uncontrolled. |
| `onSelect` | `(id: string) => void` | — | Fires with the selected id. |
| `expandedIds` | `string[]` | — | Controlled expanded ids. |
| `defaultExpandedIds` | `string[]` | nodes flagged `expanded` | Initial expanded ids when uncontrolled. |
| `onExpandedChange` | `(ids: string[]) => void` | — | Fires with the next expanded set. |
| `onVisibilityChange` | `(id: string, visible: boolean) => void` | — | Fires when a node's eye toggles. |
| `onLockChange` | `(id: string, locked: boolean) => void` | — | Fires when a node's lock toggles. |
| `indent` | `number` | `14` | Indentation per depth level, in px. |
| `header` | `ReactNode` | — | Header content above the tree. |
| `footer` | `ReactNode` | — | Footer content below the tree. |
| `aria-label` | `string` | `"Layers"` | Accessible name for the tree. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { LayerTree, type LayerNode } from "@monet-ui/monet-react";

const nodes: LayerNode[] = [
  {
    id: "grp",
    name: "Group",
    expanded: true,
    children: [
      { id: "c1", name: "Child 1", opacity: 100 },
      { id: "c2", name: "Child 2", locked: true },
    ],
  },
  { id: "bg", name: "Background" },
];

<LayerTree nodes={nodes} aria-label="Layers" selectedId={layer} onSelect={setLayer} />;
```

---

## ArtboardList

An artboard picker rendered as `role="listbox"`, reusing the `.monet-layer` row (thumb · name · size meta). A click selects (fires `onSelect`); a double-click or **Enter** opens it (fires `onActivate`). Roving **Arrow** / **Home** / **End** focus. Controlled when `selectedId` is supplied, otherwise uncontrolled from `defaultSelectedId`. Forwards its `ref` to the root.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `artboards` | `ArtboardData[]` | — | **Required.** The artboards. |
| `selectedId` | `string` | — | Controlled selected id. |
| `defaultSelectedId` | `string` | — | Initial selected id when uncontrolled. |
| `onSelect` | `(id: string) => void` | — | Fires with the selected id. |
| `onActivate` | `(id: string) => void` | — | Fires on double-click / Enter. |
| `aria-label` | `string` | `"Artboards"` | Accessible name for the listbox. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { ArtboardList } from "@monet-ui/monet-react";

<ArtboardList
  aria-label="Artboards"
  artboards={[
    { id: "home", name: "Home", size: "1440 × 1024" },
    { id: "settings", name: "Settings", size: "1440 × 1024" },
    { id: "profile", name: "Profile", size: "375 × 812" },
  ]}
  selectedId={board}
  onSelect={setBoard}
  onActivate={openBoard}
/>;
```

---

## Types

### LayerData

```ts
interface LayerData {
  id: string;
  name: string;
  visible?: boolean;    // default true
  locked?: boolean;     // default false
  opacity?: number;     // 0..100, default 100
  blendMode?: string;   // a BLEND_MODES value id
  colorChip?: string;   // a CSS color
  thumb?: ReactNode;
}
```

### LayerNode

```ts
interface LayerNode extends LayerData {
  children?: LayerNode[];
  expanded?: boolean;   // seeds the tree's uncontrolled expansion
}
```

### ChannelData

```ts
interface ChannelData {
  id: string;
  name: string;
  visible?: boolean;    // default true
  thumb?: ReactNode;
  shortcut?: ReactNode;
  composite?: boolean;  // marks the composite (RGB) channel
}
```

### ArtboardData

```ts
interface ArtboardData {
  id: string;
  name: string;
  size?: ReactNode;     // e.g. "1440 × 1024"
  thumb?: ReactNode;
}
```

### BLEND_MODES

The Photoshop blend-mode roster as `SelectOption[]` (kebab-case value ids): `normal`, `dissolve`, `darken`, `multiply`, `color-burn`, `linear-burn`, `lighten`, `screen`, `color-dodge`, `linear-dodge`, `overlay`, `soft-light`, `hard-light`, `vivid-light`, `linear-light`, `pin-light`, `hard-mix`, `difference`, `exclusion`, `subtract`, `divide`, `hue`, `saturation`, `color`, `luminosity`.

### Exported prop interfaces

Every component also exports its props interface for typing wrappers and refs: `LayerRowProps`, `LayerListProps`, `VisibilityToggleProps`, `LockToggleProps`, `BlendModeSelectProps`, `OpacityControlProps`, `ChannelRowProps`, `ChannelListProps`, `LayerTreeProps`, `ArtboardListProps`.
