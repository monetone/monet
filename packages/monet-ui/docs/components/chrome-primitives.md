# Chrome primitives — `@monet-ui/monet-react`

Composable, neutral window-chrome building blocks for creative desktop apps: the workspace shell, titlebars and menu bars, docks, panels, floats, rails, snap overlays, and leaf value widgets.

> The chrome stays neutral; each app passes its own accent via the `--accent` CSS variable on `.monet-window` (most components accept an `accent` prop that sets it). All visuals come from the stylesheet — the app imports `@monet-ui/monet-core/index.css` **once**, then renders these components.

All symbols below are exported from the package barrel: `import { … } from "@monet-ui/monet-react"`.

---

## Components

### `Workspace`

Top-level window shell. Renders the `.monet-window` element (carrying the `--accent` var), mounts a `Titlebar`, and renders its children below it.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `accent` | `string` | — | Accent color; set as the `--accent` CSS var on `.monet-window`. |
| `title` | `React.ReactNode` | — | Window title, forwarded to the titlebar. |
| `docs` | `string[]` | `[]` | Document tab labels. A trailing `*` marks an unsaved doc. |
| `activeDoc` | `string` | — | Active document label (controlled); falls back to internal state. |
| `app` | `React.ReactNode` | — | App identity (string or node) shown in the titlebar app pill. |
| `children` | `React.ReactNode` | — | Workspace body (bars, `Body`, etc.). |

```tsx
import { Workspace, Body } from "@monet-ui/monet-react";

<Workspace accent="#7c5cff" title="Untitled" docs={["Comp 1", "Sketch *"]} app="Raster">
  <Body>{/* … */}</Body>
</Workspace>
```

---

### `Titlebar`

The window titlebar. On `platform="mac"` it renders traffic lights, draggable document tabs, and an app pill; on `platform="win"` it renders an app-icon/menu row plus a separate document-tab strip below. With `nativeFrame`, the OS owns the frame and only the draggable document bar is rendered. Document-tab callbacks are optional — when omitted the titlebar keeps its own selection/order state, so an uncontrolled host still gets working tabs. Maximize/restore glyph and dim-on-blur reflect live native window state.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `React.ReactNode` | — | Window title. |
| `docs` | `string[]` | `[]` | Document tab labels. A trailing `*` marks an unsaved doc. |
| `activeDoc` | `string` | — | Active document label (controlled); falls back to internal state. |
| `app` | `React.ReactNode` | — | App identity shown in the app pill (mac) / app label (win). |
| `accent` | `string` | — | Accent color used for the active-tab dot, app icon, etc. |
| `platform` | `"mac" \| "win"` | `"mac"` | Chrome variant. |
| `menus` | `MenusProp` (`string[] \| MenuBarEntry[]`) | `[]` | Menu bar definition (Windows row only; mac menus live in the global bar). |
| `controls` | `WindowControls` | — | Window control callbacks (`close` / `minimize` / `toggleMaximize`). |
| `drag` | `boolean` | — | Enable native `data-tauri-drag-region` hooks (bare Tauri chrome). |
| `nativeFrame` | `boolean` | `false` | Let the OS own the macOS window frame; render document tabs without simulated window controls. |
| `onDocSelect` | `(doc: string) => void` | — | Notified when a document tab is activated. |
| `onDocClose` | `(doc: string) => void` | — | Notified when a document tab's close button is clicked. |
| `onDocReorder` | `(order: string[]) => void` | — | Notified after a document tab is dragged into a new position. |

```tsx
import { Titlebar } from "@monet-ui/monet-react";

<Titlebar
  platform="win"
  app="Raster"
  title="Untitled"
  docs={["Comp 1", "Sketch *"]}
  menus={["File", "Edit", "View"]}
  onDocSelect={(d) => console.log("active", d)}
/>
```

---

### `MenuStrip`

An in-window menu bar (used for Windows-style chrome). Wraps the shared `MenuBar` with the `.monet-menustrip` class.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `menus` | `MenusProp` (`string[] \| MenuBarEntry[]`) | `[]` | Menu bar definition (legacy string labels or rich entries). |
| `platform` | `"mac" \| "win"` | `"mac"` | Adds the `is-win` modifier when `"win"`. |

```tsx
import { MenuStrip } from "@monet-ui/monet-react";

<MenuStrip platform="win" menus={["File", "Edit", "View", "Help"]} />
```

---

### `OptionsBar`

A horizontal toolbar/options strip (`.monet-optionsbar`). Children-only; no own props. Exposes a compound `OptionsBar.Group` subcomponent that wraps children in a `.group` container.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `React.ReactNode` | — | Bar contents. |

`OptionsBar.Group` — props: `{ children?: React.ReactNode }`.

```tsx
import { OptionsBar } from "@monet-ui/monet-react";

<OptionsBar>
  <OptionsBar.Group>{/* controls */}</OptionsBar.Group>
  <OptionsBar.Group>{/* more controls */}</OptionsBar.Group>
</OptionsBar>
```

---

### `Body`

The main content row below the bars (`.monet-body`). Lays out tool rails, the canvas, and docks. Children-only; no own props.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `React.ReactNode` | — | Body contents (e.g. `ToolRail`, `Canvas`, `Dock`). |

```tsx
import { Body, ToolRail, Canvas, Dock } from "@monet-ui/monet-react";

<Body>
  <ToolRail tools={[]} />
  <Canvas>{/* … */}</Canvas>
  <Dock side="right">{/* … */}</Dock>
</Body>
```

---

### `ToolRail`

A vertical or horizontal rail of tool buttons, each rendered with an icon and optional badge, with an optional footer slot. Tools are keyboard-activatable (Enter/Space) and expose `role="button"` + `aria-pressed`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `tools` | `Array<ToolRailTool \| "div" \| (string & {})>` | `[]` | Tools to render. A `ToolRailTool`, or the literal `"div"` (any bare string also accepted) to draw a divider. |
| `active` | `string` | — | Id of the active tool. |
| `onSelect` | `(id: string) => void` | — | Invoked with the tool id on click / Enter / Space. |
| `footer` | `React.ReactNode` | — | Trailing content (pushed to the end with a spacer when `orientation="v"`). |
| `orientation` | `"v" \| "h"` | `"v"` | Rail axis. |
| `inline` | `boolean` | `false` | Skip the `.monet-toolrail` wrapper (when embedded inside a `Toolbar`). |

`ToolRailTool` — `{ id: string; name: string; icon: string; badge?: boolean }`. `icon` is a key into the icon map `I`, or a raw SVG path string.

```tsx
import { ToolRail } from "@monet-ui/monet-react";

<ToolRail
  active="move"
  onSelect={(id) => setTool(id)}
  tools={[
    { id: "move", name: "Move", icon: "cursor" },
    { id: "brush", name: "Brush", icon: "brush", badge: true },
    "div",
    { id: "text", name: "Text", icon: "text" },
  ]}
/>
```

---

### `Canvas`

The central work surface (`.monet-canvas` with an inner `.monet-canvas-shell`). Children-only; no own props.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `React.ReactNode` | — | Canvas content. |

```tsx
import { Canvas } from "@monet-ui/monet-react";

<Canvas>{/* artboard / viewport */}</Canvas>
```

---

### `Dock`

A resizable column or row of panels pinned to a window edge, with a drag splitter on the side facing the canvas. Internally clamps its size to **120–640 px**.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `side` | `"left" \| "right" \| "bottom"` | `"right"` | Which edge the dock is pinned to. |
| `initial` | `number` | `220` when `side="bottom"`, otherwise `320` | Starting size in px. |
| `children` | `React.ReactNode` | — | Panels (typically a `PanelStack` of `Panel`s). |
| `accent` | `string` | — | Accent color applied to the splitter handle. |

```tsx
import { Dock, PanelStack, Panel, PanelBody } from "@monet-ui/monet-react";

<Dock side="right" initial={360} accent="#7c5cff">
  <PanelStack>
    <Panel><PanelBody>Layers</PanelBody></Panel>
    <Panel><PanelBody>Properties</PanelBody></Panel>
  </PanelStack>
</Dock>
```

---

### `PanelStack`

Stacks `Panel` children vertically inside a dock and inserts a draggable horizontal splitter between siblings, redistributing each child's `flex` share on drag. Children-only; no own props.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `React.ReactNode` | — | `Panel`s to stack. Each child's `flex` prop (default `1`) seeds its initial share. |

```tsx
import { PanelStack, Panel } from "@monet-ui/monet-react";

<PanelStack>
  <Panel flex={2}>{/* … */}</Panel>
  <Panel flex={1}>{/* … */}</Panel>
</PanelStack>
```

---

### `Panel`

A single dock panel (`.monet-panel`). Typically contains a `TabStrip` and a `PanelBody`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `React.ReactNode` | — | Panel contents. |
| `flex` | `number` | — | Flex-grow factor inside a `PanelStack`/dock column (applied via `flexGrow`). When undefined, uses the CSS default. |

```tsx
import { Panel, TabStrip, PanelBody } from "@monet-ui/monet-react";

<Panel flex={1}>
  <TabStrip tabs={["Layers", "Channels"]} />
  <PanelBody>{/* … */}</PanelBody>
</Panel>
```

---

### `TabStrip`

A panel tab strip with selectable tabs (controlled or uncontrolled), optional per-tab close, an optional "add tab" button, a custom actions slot, and an always-present overflow ("More") control. Tabs support Enter/Space to select, Arrow keys to move, and Backspace/Delete to close (when `onClose` is set).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `tabs` | `string[]` | `[]` | Tab labels. |
| `active` | `string` | — | Active tab (controlled). When `undefined`, the strip is uncontrolled (seeds from `tabs[0]`). |
| `onSelect` | `(tab: string) => void` | — | Invoked with the tab id on selection. |
| `onClose` | `(tab: string) => void` | — | Render a per-tab close affordance; invoked with the tab id. |
| `onAdd` | `() => void` | — | Render an "add tab" button in the actions area; invoked on activate. |
| `actions` | `React.ReactNode` | — | Extra controls injected before the overflow button. |
| `accent` | `string` | — | Accent color. (Accepted by the interface; not consumed by the implementation.) |

```tsx
import { TabStrip } from "@monet-ui/monet-react";

<TabStrip
  tabs={["Layers", "Channels", "Paths"]}
  active="Layers"
  onSelect={(t) => setTab(t)}
  onClose={(t) => closeTab(t)}
  onAdd={() => addTab()}
/>
```

---

### `PanelBody`

The scrollable content region of a panel (`.monet-panel-body`, `role="tabpanel"`).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `React.ReactNode` | — | Body content. |
| `flush` | `boolean` | — | Remove inner padding (adds `is-flush`). |

```tsx
import { PanelBody } from "@monet-ui/monet-react";

<PanelBody flush>{/* edge-to-edge content */}</PanelBody>
```

---

### `Float`

A floating mini-dock: a slim drag bar (grip + close), an optional tab strip carrying the panel title(s), then the body. Position and size accept numbers (px) or CSS strings.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `left` | `number \| string` | — | CSS `left`. |
| `top` | `number \| string` | — | CSS `top`. |
| `right` | `number \| string` | — | CSS `right`. |
| `bottom` | `number \| string` | — | CSS `bottom`. |
| `width` | `number \| string` | — | CSS `width`. |
| `height` | `number \| string` | — | CSS `height`. |
| `title` | `string` | — | Single panel title. Used as the lone tab when `tabs` is omitted. |
| `tabs` | `string[]` | — | Tab labels. Falls back to `[title]`, or `[]` if neither is given. |
| `activeTab` | `string` | — | Active tab (controlled); falls back to the first tab. |
| `accent` | `string` | — | Accent color (set as `--accent` on the float). |
| `children` | `React.ReactNode` | — | Float body. |
| `onClose` | `() => void` | — | Invoked when the close button is activated. |
| `onSelect` | `(tab: string) => void` | — | Invoked with the tab id when a tab is clicked. |

```tsx
import { Float, PanelBody } from "@monet-ui/monet-react";

<Float left={40} top={120} width={260} height={300} title="Color" accent="#7c5cff" onClose={() => hide()}>
  <PanelBody>{/* swatches */}</PanelBody>
</Float>
```

---

### `StatusBar`

The bottom status strip (`.monet-statusbar`). Children-only; no own props.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `React.ReactNode` | — | Status content. |

```tsx
import { StatusBar } from "@monet-ui/monet-react";

<StatusBar>{/* zoom · coordinates · messages */}</StatusBar>
```

---

### `IconRail`

A slim rail of icon buttons pinned to the left or right. Each item exposes `role="button"` + `aria-pressed` and is keyboard-activatable (Enter/Space).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `IconRailItem[]` | `[]` | Rail items. |
| `side` | `"left" \| "right"` | `"right"` | Which edge to pin to (flips the border when `"left"`). |
| `onClick` | `(id: string, index: number) => void` | — | Invoked on activation. `id` falls back to the item index. |

`IconRailItem` — `{ id?: string; name?: string; icon: string; active?: boolean }`. `icon` is a key into the icon map `I`, or a raw SVG path string.

```tsx
import { IconRail } from "@monet-ui/monet-react";

<IconRail
  side="right"
  onClick={(id) => open(id)}
  items={[
    { id: "info", name: "Info", icon: "info", active: true },
    { id: "history", name: "History", icon: "history" },
  ]}
/>
```

---

### `SnapOverlay`

A full-surface overlay that paints docking snap targets (and optional centered hint labels) during a drag.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `zones` | `SnapZone[]` | `[]` | Snap targets to draw. |

`SnapZone` — `{ x: number; y: number; w: number; h: number; label?: React.ReactNode }`.

```tsx
import { SnapOverlay } from "@monet-ui/monet-react";

<SnapOverlay zones={[{ x: 0, y: 0, w: 320, h: 600, label: "Dock left" }]} />
```

---

### `Slider`

A functional, accessible range slider (`React.forwardRef<HTMLDivElement, SliderProps>`). Controlled when `onChange` is supplied, otherwise uncontrolled with internal state seeded from `value`. Supports pointer drag / click-to-jump and keyboard (Arrows ±`step`, PageUp/Down ±`pageStep`, Home/End to min/max). Exposes `role="slider"` with `aria-valuemin/max/now` and `aria-orientation`. With no `min`/`max`, `value` is the 0..1 fill fraction (backward compatible).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Current value. With no `min`/`max`, the 0..1 fill fraction. |
| `accent` | `string` | — | Accent color for the fill/glow (set as `--accent`). |
| `onChange` | `(value: number) => void` | — | Fires with the next clamped, stepped value. Omit for uncontrolled use. |
| `onChangeEnd` | `(value: number) => void` | — | Called once when a pointer drag (or key press) ends — good for committing edits. |
| `min` | `number` | `0` | Range minimum. |
| `max` | `number` | `1` | Range maximum. |
| `step` | `number` | `(max - min) / 100` (i.e. `0.01` over 0..1) | Step granularity. |
| `pageStep` | `number` | `step * 10` | Larger increment for PageUp/PageDown. |
| `disabled` | `boolean` | — | Inerts the slider (`tabIndex=-1`, `aria-disabled`). |
| `vertical` | `boolean` | — | Orient bottom-to-top instead of left-to-right. |
| `id` | `string` | — | Element id. |
| `aria-label` | `string` | — | Accessible label. |
| `aria-labelledby` | `string` | — | Id of a labelling element. |
| `aria-describedby` | `string` | — | Id of a describing element. |
| `className` | `string` | — | Extra class names. |
| `style` | `React.CSSProperties` | — | Inline style (merged with `--accent`). |

```tsx
import { Slider } from "@monet-ui/monet-react";

const [opacity, setOpacity] = React.useState(0.68);

<Slider value={opacity} accent="#7c5cff" aria-label="Opacity" onChange={setOpacity} />
```

---

### `Waveform`

A decorative, seeded waveform SVG (`.monet-wave`). Deterministic: the same `seed` renders the same bars; bars above a threshold render as accented "peaks".

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `width` | `number` | `240` | SVG width in px. |
| `height` | `number` | `60` | SVG height in px. |
| `seed` | `number` | `1` | PRNG seed for bar heights. |
| `accent` | `string` | — | Accent color for the peak bars (set as `--accent`). |

> Note: `Waveform` is exported, but its `WaveformProps` interface is not part of the public barrel surface (it is not re-exported by name).

```tsx
import { Waveform } from "@monet-ui/monet-react";

<Waveform width={320} height={48} seed={7} accent="#7c5cff" />
```

---

## Types & constants

### `MenusProp`

```ts
type MenusProp = string[] | MenuBarEntry[];
```

What the chrome menu bars accept for their `menus` prop. A legacy `string[]` (each string is a top-level label that opens an empty placeholder menu) or a rich `MenuBarEntry[]` (full functional dropdowns with items, submenus, separators, shortcuts, actions, plus keyboard/aria). Accepted by `Titlebar` and `MenuStrip`.

### `ToolRailTool`

```ts
interface ToolRailTool { id: string; name: string; icon: string; badge?: boolean }
```

A single `ToolRail` tool. `icon` is a key into the icon map `I`, or a raw SVG path string. In a `tools` array, the literal `"div"` (or any bare string) is treated as a divider instead.

### `IconRailItem`

```ts
interface IconRailItem { id?: string; name?: string; icon: string; active?: boolean }
```

A single `IconRail` item. `id` falls back to the item index when omitted; `icon` is an `I` key or raw SVG path.

### `SnapZone`

```ts
interface SnapZone { x: number; y: number; w: number; h: number; label?: React.ReactNode }
```

A single `SnapOverlay` snap target: its pixel rect plus an optional centered hint label.

### `normalizeMenus`

```ts
function normalizeMenus(menus: MenusProp | undefined): MenuBarEntry[];
```

Coerces either `menus` form into the `MenuBarEntry[]` shape the underlying `MenuBar` wants. Returns `[]` for empty/undefined input; passes rich entries through unchanged; maps legacy string labels to entries whose only item is a disabled "No actions" placeholder (so a string-label dropdown is never empty). Used internally by the menu-bearing chrome components.

### `appLabel`

```ts
function appLabel(app: React.ReactNode): string;
```

Title-cases a string app name (e.g. `"RASTER"` → `"Raster"`). Returns `"App"` for non-string or empty input. Used by `Titlebar` for the Windows label.

---

## Stylesheet

These components ship no inline styles for their chrome — they rely on classes (`.monet-window`, `.monet-titlebar`, `.monet-dock`, `.monet-panel`, `.monet-slider`, …). Import the stylesheet **once** at your app root:

```ts
import "@monet-ui/monet-core/index.css";
```
