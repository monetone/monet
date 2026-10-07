# Dockable workspace

A data-driven, interactive panel manager: declare your panels and toolbars as registries, hand it a serializable layout tree, and users get drag-to-dock tabs, splitters, floating mini-docks, and relocatable toolbars.

All components live in `@monet-ui/monet-react`. The visual styling ships separately — the host app imports the stylesheet once, e.g. in its entry point:

```tsx
import "@monet-ui/monet-core/index.css";
```

---

## DockableWorkspace

The top-level workspace. Renders the window chrome, canvas, four edge docks, and floating mini-docks, wiring up all drag/resize/dock interactions. Panels and toolbars are supplied as id-keyed registries (`panels`, `toolbarDefs`) and positioned by a layout tree (`layout` / `initialLayout`, `toolbarLayout` / `initialToolbarLayout`).

It is a `forwardRef` component: attach a `ref` of type [`DockableWorkspaceHandle`](#dockableworkspacehandle) to read and drive the live layout imperatively.

### Props (`DockableWorkspaceProps`)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `accent` | `Accent \| string` | — | Accent color: one of the built-in `Accent` names (`"raster"`, `"vector"`, `"audio"`, `"motion"`) or any CSS color string. Applied as the `--accent` CSS var. |
| `app` | `React.ReactNode` | — | App identity slot shown in the titlebar. |
| `title` | `React.ReactNode` | — | Window title. |
| `docs` | `string[]` | — | Document tab labels. A trailing `*` on a label marks an unsaved doc. |
| `activeDoc` | `string` | — | Active document label (controlled). |
| `menus` | `MenusProp` (`string[] \| MenuBarEntry[]`) | — | Menu bar definition — a legacy `string[]` or rich `MenuBarEntry[]`. |
| `canvas` | `React.ReactNode` | — | Main canvas content rendered between the top and bottom docks. |
| `statusBar` | `React.ReactNode` | — | Status bar content rendered below the body. |
| `iconRail` | `React.ReactNode` | — | Trailing (right-side) icon rail content. |
| `iconRailLeft` | `React.ReactNode` | — | Leading (left-side) icon rail content. |
| `toolbarDefs` | `ToolbarDefMap` (`Record<string, ToolbarDef>`) | `{}` | Relocatable toolbars, keyed by id and referenced from the toolbar layout. |
| `panels` | `PanelMap` (`Record<string, PanelDef>`) | — | Dockable panels, keyed by tab id and referenced from the panel layout. |
| `platform` | `Platform` (`"mac" \| "win"`) | `MonetContext.platform` ?? `"mac"` | Window platform styling. Falls back to context, then `"mac"`. |
| `controls` | `WindowControls` | `MonetContext.controls` | Window control wiring (close/minimize/etc.) passed to the titlebar. Falls back to context. |
| `nativeFrame` | `boolean` | `false` | Use native macOS window decorations and render only the in-app document tab bar. |
| `initialLayout` | `DockLayout` | `{}` | Uncontrolled initial panel layout (seed only; read once at mount). |
| `initialToolbarLayout` | `ToolbarLayout` | `{}` | Uncontrolled initial toolbar layout (seed only; read once at mount). |
| `layout` | `DockLayout` | — | Controlled panel layout. When provided, prop changes reconcile into the live workspace via an effect (no remount). Drag edits still run optimistically; echo `onLayoutChange` back to stay in sync. |
| `toolbarLayout` | `ToolbarLayout` | — | Controlled toolbar layout — see `layout`. |
| `onLayoutChange` | `(layout: DockLayout) => void` | — | Fired after the panel layout changes (skips the initial mount). Receives the current normalized tree. |
| `onToolbarLayoutChange` | `(toolbarLayout: ToolbarLayout) => void` | — | Fired after the toolbar layout changes (skips the initial mount). |

Notes:
- `initialLayout`/`initialToolbarLayout` (uncontrolled) vs `layout`/`toolbarLayout` (controlled) are mutually exclusive ways to seed the same tree. If a controlled value is present at mount it seeds the first render; otherwise the `initial*` seed is used.
- `reset()` on the handle restores the original mount-time seed.

### Usage

Uncontrolled (seed once, observe changes):

```tsx
import { DockableWorkspace } from "@monet-ui/monet-react";

function Editor() {
  return (
    <DockableWorkspace
      accent="vector"
      title="My App"
      docs={["untitled *"]}
      canvas={<main>canvas</main>}
      panels={{
        layers: { title: "Layers", flush: true, render: () => <LayersTree /> },
        props:  { title: "Properties", render: () => <Inspector /> },
      }}
      initialLayout={{
        left:  { size: 280, cols: [{ stack: [{ tabs: ["layers"] }] }] },
        right: { size: 320, cols: [{ stack: [{ tabs: ["props"] }] }] },
      }}
      onLayoutChange={(layout) => console.log("layout changed", layout)}
    />
  );
}
```

Controlled (you own the layout state):

```tsx
import { useState } from "react";
import { DockableWorkspace, type DockLayout } from "@monet-ui/monet-react";

function Editor() {
  const [layout, setLayout] = useState<DockLayout>({
    bottom: { size: 240, cols: [{ stack: [{ tabs: ["console"] }] }] },
  });
  return (
    <DockableWorkspace
      panels={{ console: { title: "Console", render: () => <Console /> } }}
      layout={layout}
      onLayoutChange={setLayout}
    />
  );
}
```

---

## Toolbar

A single relocatable toolbar strip with a drag grip. This is the low-level primitive that `DockableWorkspace` renders internally for each entry in `toolbarDefs`; it is re-exported as part of the public surface but most apps never instantiate it directly — they register a [`ToolbarDef`](#toolbardef--toolbardefmap) and let the workspace place, orient, and drag it.

Its props are untyped in the source (`any`), so the table below documents the runtime shape rather than a checked TypeScript interface.

### Props (runtime shape; not a typed interface)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | — | Toolbar id; written to `data-toolbar-id` and passed to `onGripDown`. |
| `orientation` | `ToolbarOrientation` (`"h" \| "v"`) | — | Layout orientation; drives the grip glyph and `monet-toolbar--{orientation}` class. |
| `accent` | `Accent \| string` | — | Accent color, applied as the `--accent` CSS var. |
| `isDragging` | `boolean` | — | Adds the `is-dragging` class while this toolbar is the active drag. |
| `isFloat` | `boolean` | — | Adds `is-float` and absolutely positions the strip at (`x`, `y`). |
| `x` | `number` | — | Left position (px) when floating. |
| `y` | `number` | — | Top position (px) when floating. |
| `onGripDown` | `(id: string, e: React.PointerEvent) => void` | — | Pointer-down handler on the grip; starts a drag session. |
| `children` | `React.ReactNode` | — | Toolbar body content. |

### Usage

```tsx
import { Toolbar } from "@monet-ui/monet-react";

<Toolbar id="tools" orientation="h" accent="raster" onGripDown={() => {}}>
  <button>Select</button>
  <button>Move</button>
</Toolbar>
```

---

## DockableWorkspaceHandle

Imperative handle exposed via `ref` on `DockableWorkspace`. Lets a host read and drive the live layout without a remount. Getters return the current normalized tree; setters accept any seed `normLayout`/`normTBL` would accept (e.g. a `getLayout()` snapshot or a looser preset).

### Shape

```ts
interface DockableWorkspaceHandle {
  getLayout(): DockLayout;                       // current normalized panel layout
  setLayout(next: DockLayout): void;             // replace panel layout (normalized in)
  getToolbarLayout(): ToolbarLayout;             // current normalized toolbar layout
  setToolbarLayout(next: ToolbarLayout): void;   // replace toolbar layout (normalized in)
  reset(): void;                                  // restore both layouts to the mount-time seed
}
```

### Usage

```tsx
import { useRef } from "react";
import { DockableWorkspace, type DockableWorkspaceHandle } from "@monet-ui/monet-react";

function Editor() {
  const ws = useRef<DockableWorkspaceHandle>(null);
  return (
    <>
      <button onClick={() => console.log(ws.current?.getLayout())}>Snapshot</button>
      <button onClick={() => ws.current?.reset()}>Reset layout</button>
      <DockableWorkspace ref={ws} panels={{ /* … */ }} initialLayout={{ /* … */ }} />
    </>
  );
}
```

---

## Registry types

These describe the `panels` and `toolbarDefs` registries you hand to `DockableWorkspace`.

### PanelDef / PanelMap

One dockable panel: a tab title plus a render fn for the body. `PanelMap` is the registry mapping tab id → definition.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `React.ReactNode` _(optional)_ | — | Tab label shown in the panel's tab strip. Falls back to the tab id when omitted. |
| `render` | `() => React.ReactNode` _(required)_ | — | Renders the panel body. |
| `flush` | `boolean` _(optional)_ | — | Drop the body's default padding for flush content (e.g. a layers tree). |

```ts
type PanelMap = Record<string, PanelDef>;
```

```tsx
const panels: PanelMap = {
  layers: { title: "Layers", flush: true, render: () => <LayersTree /> },
  props:  { title: "Properties", render: () => <Inspector /> },
};
```

### ToolbarDef / ToolbarDefMap

One relocatable toolbar: a render fn that receives the current orientation, plus an optional flag pinning it horizontal. `ToolbarDefMap` is the registry mapping toolbar id → definition.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `render` | `(orientation: ToolbarOrientation) => React.ReactNode` _(required)_ | — | Renders the toolbar body for the given orientation (`"h"` or `"v"`). |
| `horizontalOnly` | `boolean` _(optional)_ | — | Keep this toolbar horizontal even in a vertical (left/right) slot, e.g. an options bar. |

```ts
type ToolbarDefMap = Record<string, ToolbarDef>;
```

```tsx
const toolbarDefs: ToolbarDefMap = {
  tools:   { render: () => <ToolButtons /> },
  options: { horizontalOnly: true, render: () => <OptionsBar /> },
};
```

### ToolbarOrientation

```ts
type ToolbarOrientation = "h" | "v";
```

The orientation a relocatable toolbar is laid out in: `"h"` for a horizontal row (top/bottom edges), `"v"` for a vertical column (left/right edges). Passed to each `ToolbarDef.render`.

---

## Layout-tree types

The JSON-serializable layout data contracts. They describe the **loose seed** you may hand in — every field is optional and several legacy forms are accepted — which `DockableWorkspace` normalizes on the way in. The same shapes are returned by the handle's getters.

### DockLayout

The full dockable panel layout (edge docks + floating mini-docks).

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `left` | `DockSide \| null` _(optional)_ | `null` | Left edge dock. |
| `right` | `DockSide \| null` _(optional)_ | `null` | Right edge dock. |
| `top` | `DockSide \| null` _(optional)_ | `null` | Top edge dock. |
| `bottom` | `DockSide \| null` _(optional)_ | `null` | Bottom edge dock. |
| `floating` | `DockFloat[]` _(optional)_ | `[]` | Free-floating mini-docks. |

### DockSide

One side dock. Per-side default `size` (when omitted): `bottom` → 240, `top` → 200, `left`/`right` → 300.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | `number` _(optional)_ | per-side (see above) | Dock thickness in px (width for left/right, height for top/bottom). |
| `cols` | `DockColumn[]` _(optional)_ | — | Columns inside the dock. |
| `stack` | `DockGroup[]` _(optional, legacy)_ | — | Legacy single-column form: a bare group stack, wrapped into one column by the normalizer. |

### DockColumn

A column inside a container: either a panel column (holds groups) or a docked toolbar wedged between panel columns.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` _(optional)_ | auto-generated | Stable column id. |
| `kind` | `"panel" \| "tb"` _(optional)_ | `"panel"` (or `"tb"` if `tbId` is set) | Column kind. |
| `flex` | `number` _(optional)_ | `1` | Flex weight (panel columns only). |
| `stack` | `DockGroup[]` _(optional)_ | — | Stacked groups (panel columns). |
| `tbId` | `string` _(optional)_ | — | Present when `kind === "tb"`: the toolbar id this column hosts. |

### DockGroup

A stacked group of tabs within a column.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` _(optional)_ | auto-generated | Stable group id. |
| `tabs` | `string[]` _(required)_ | — | Tab ids in this group (each must key into `panels`). |
| `active` | `string` _(optional)_ | first tab | Active tab id. |
| `flex` | `number` _(optional)_ | `1` | Flex weight within the column. |

### DockFloat

A free-floating mini-dock — a column-set with the same shape as a side dock, so the same split/stack/resize machinery works inside it.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` _(optional)_ | auto-generated | Stable float id. |
| `x` | `number` _(optional)_ | `100` | Left position (body-local px). |
| `y` | `number` _(optional)_ | `100` | Top position (body-local px). |
| `w` | `number` _(optional)_ | `280` | Width (px). |
| `h` | `number` _(optional)_ | `220` | Height (px). |
| `cols` | `DockColumn[]` _(optional)_ | — | Columns inside the float. |
| `stack` | `DockGroup[]` _(optional, legacy)_ | — | Legacy: a bare group stack, wrapped into one column. |
| `group` | `DockGroup` _(optional, legacy)_ | — | Legacy: a single group, wrapped into one column. |

Example panel layout seed:

```tsx
const initialLayout: DockLayout = {
  left:   { size: 280, cols: [{ stack: [{ tabs: ["layers", "assets"], active: "layers" }] }] },
  right:  { size: 320, cols: [{ stack: [{ tabs: ["props"] }] }] },
  bottom: { size: 240, cols: [{ stack: [{ tabs: ["console"] }] }] },
  floating: [{ id: "mini", x: 120, y: 120, w: 300, h: 200, cols: [{ stack: [{ tabs: ["history"] }] }] }],
};
```

### ToolbarLayout

Per-edge toolbar lanes plus floating toolbars. Each edge is a list of **lanes**; a lane is a list of toolbar ids. On top/bottom a lane is a horizontal row (lanes stack vertically); on left/right a lane is a vertical column (lanes sit side by side). A legacy flat `string[]` is read as a single lane.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `top` | `string[] \| string[][]` _(optional)_ | — | Toolbar lanes on the top edge. |
| `bottom` | `string[] \| string[][]` _(optional)_ | — | Toolbar lanes on the bottom edge. |
| `left` | `string[] \| string[][]` _(optional)_ | — | Toolbar lanes on the left edge. |
| `right` | `string[] \| string[][]` _(optional)_ | — | Toolbar lanes on the right edge. |
| `float` | `ToolbarFloat[]` _(optional)_ | — | Free-floating toolbars. |

### ToolbarFloat

A free-floating toolbar position. Default float position (when `x`/`y` omitted): `x = 80`, `y = 80`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` _(required)_ | — | Toolbar id (must key into `toolbarDefs`). |
| `x` | `number` _(optional)_ | `80` | Left position (body-local px). |
| `y` | `number` _(optional)_ | `80` | Top position (body-local px). |

Example toolbar layout seed:

```tsx
const initialToolbarLayout: ToolbarLayout = {
  top:   [["tools", "options"]],         // one row with two toolbars
  left:  [["align"], ["distribute"]],    // two side-by-side vertical lanes
  float: [{ id: "swatches", x: 200, y: 160 }],
};
```
