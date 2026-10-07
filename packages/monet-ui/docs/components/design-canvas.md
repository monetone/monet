# Design canvas

A Figma-ish infinite design canvas: a warm-gray grid viewport with pan/zoom, reorderable artboards grouped into editable sections, inline-editable labels/titles, a fullscreen focus overlay, per-artboard PNG/HTML export, and pluggable sidecar persistence.

All symbols are exported from the package root:

```tsx
import { DesignCanvas, DCSection, DCArtboard } from "@monet-ui/monet-react";
```

The app imports the stylesheet once (it carries every `monet-dc-*` rule the canvas needs):

```tsx
import "@monet-ui/monet-core/index.css";
```

---

## DesignCanvas

The stateful wrapper. Owns the pan/zoom viewport and the runtime state (per-section order, renamed titles/labels, hidden artboards, focused artboard). Order/titles/labels/hidden round-trip through the pluggable `bridge`; focus is ephemeral.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `React.ReactNode` | — *(optional)* | Canvas content — typically `DCSection`s (each holding `DCArtboard`s). Fragments are flattened; non-`DCSection` children opt out of reorder/focus. |
| `minScale` | `number` | `0.1` | Minimum zoom scale. |
| `maxScale` | `number` | `8` | Maximum zoom scale. |
| `style` | `React.CSSProperties` | — *(optional)* | Extra inline styles merged onto the viewport element. |
| `bridge` | `DesignCanvasBridge` | `defaultDesignCanvasBridge()` | Custom persistence bridge. When omitted, uses the default (fetch-read of the `.design-canvas.state.json` sidecar + a `window.omelette.writeFile` write when present). Pass `{}` to disable persistence entirely. |

```tsx
import { DesignCanvas, DCSection, DCArtboard } from "@monet-ui/monet-react";

<DesignCanvas>
  <DCSection id="onboarding" title="Onboarding" subtitle="First-run variants">
    <DCArtboard id="a" label="A · Dusk" width={260} height={480}>
      {/* artboard contents */}
    </DCArtboard>
    <DCArtboard id="b" label="B · Minimal" width={260} height={480}>
      {/* artboard contents */}
    </DCArtboard>
  </DCSection>
</DesignCanvas>
```

To disable persistence, pass an empty bridge:

```tsx
<DesignCanvas bridge={{}}>{/* … */}</DesignCanvas>
```

---

## DCSection

A labelled group: an editable title/subtitle above a horizontal, reorderable row of `DCArtboard`s, rendered in the user's persisted order. Any non-`DCArtboard` children are rendered after the row.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | falls back to `title` *(optional)* | Stable section id used for persistence keys. |
| `title` | `string` | — *(optional)* | Section title (editable inline; a persisted rename overrides it). |
| `subtitle` | `string` | — *(optional)* | Optional secondary line under the title. |
| `children` | `React.ReactNode` | — *(optional)* | `DCArtboard`s (reordered into the row) plus any other nodes (rendered after the row). |
| `gap` | `number` | `48` | Horizontal gap between artboards, in px. |

```tsx
import { DCSection, DCArtboard } from "@monet-ui/monet-react";

<DCSection id="settings" title="Settings" subtitle="Light / dark" gap={64}>
  <DCArtboard id="light" label="Light" />
  <DCArtboard id="dark" label="Dark" />
</DCSection>
```

---

## DCArtboard

A single framed design surface. It is a **marker component**: `DCSection` discovers it by type and renders it through its internal frame (label row, grip-reorder, kebab menu, focus button, card). Rendering it directly returns `null`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | falls back to `label` *(optional)* | Stable artboard id used for ordering / persistence. |
| `label` | `string` | — *(optional)* | Display label (editable inline; a persisted rename overrides it). |
| `width` | `number` | `260` | Artboard width, in px. |
| `height` | `number` | `480` | Artboard height, in px. |
| `children` | `React.ReactNode` | placeholder showing the id *(optional)* | Card contents. When omitted, a placeholder showing the id is rendered. |
| `style` | `React.CSSProperties` | — *(optional)* | Extra inline styles merged onto the card surface. |

```tsx
import { DCArtboard } from "@monet-ui/monet-react";

<DCArtboard id="home" label="Home" width={320} height={640}>
  <YourScreen />
</DCArtboard>
```

> Note: each artboard's kebab menu offers **Download PNG** / **Download HTML** (via `dcExport`) and a two-click **Delete**.

---

## DCPostIt

A decorative sticky note placed absolutely within a section or the world. Position it with any of `top` / `left` / `right` / `bottom`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `React.ReactNode` | — *(optional)* | Note contents. |
| `top` | `number \| string` | — *(optional)* | Absolute offset from the top. |
| `left` | `number \| string` | — *(optional)* | Absolute offset from the left. |
| `right` | `number \| string` | — *(optional)* | Absolute offset from the right. |
| `bottom` | `number \| string` | — *(optional)* | Absolute offset from the bottom. |
| `rotate` | `number` | `-2` | Rotation, in degrees. |
| `width` | `number` | `180` | Note width, in px. |

```tsx
import { DCPostIt } from "@monet-ui/monet-react";

<DCPostIt top={24} left={24} rotate={3}>
  Ship the dusk variant first.
</DCPostIt>
```

---

## DCEditable

An inline-rename region — a real `contentEditable` with `role="textbox"` and an `aria-label`. Commits on blur or `Enter`; `Escape` cancels and restores the prior value. Used internally for section titles and artboard labels, but exported for custom chrome.

> Note: this component's props interface (`DCEditableProps`) is not exported; the table below reflects the component's actual parameters.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | — *(optional)* | Current text value. |
| `onChange` | `(value: string) => void` | — *(optional)* | Called with the new text on commit (blur / `Enter`). |
| `style` | `React.CSSProperties` | — *(optional)* | Inline styles for the editable element. |
| `tag` | `"span" \| "div"` | `"span"` | Host element tag. |
| `ariaLabel` | `string` | — *(optional)* | Accessible name (the region has no associated `<label>`). |
| `onClick` | `(e: React.MouseEvent) => void` | — *(optional)* | Click handler on the editable element. |

```tsx
import { DCEditable } from "@monet-ui/monet-react";

<DCEditable
  tag="div"
  value={name}
  ariaLabel="Layer name"
  onChange={setName}
/>
```

---

## DCFocusOverlay

Fullscreen focus mode — overlays one artboard over a dimmed backdrop with section + index navigation: `←`/`→` step within the section, `↑`/`↓` step across non-empty sections, `Esc` or a backdrop click exits. `role="dialog"` `aria-modal`, focus-trapped, portaled to `<body>`.

Normally you do not render this yourself — `DesignCanvas` mounts it automatically when an artboard is focused (via its focus button or by clicking the label). It is exported for advanced integrations. It must be used inside a `DesignCanvas` (it reads the canvas context).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `entry` | `DCFocusEntry` | **required** | The focused entry: `{ sectionId, artboard }`. |
| `sectionMeta` | `Record<string, DCSectionMeta>` | **required** | Per-section metadata (`title`, `subtitle`, visible `slotIds`) for cross-section navigation. |
| `sectionOrder` | `string[]` | **required** | Section ids in display order. |

```tsx
import { DCFocusOverlay } from "@monet-ui/monet-react";

<DCFocusOverlay
  entry={focusEntry}
  sectionMeta={sectionMeta}
  sectionOrder={sectionOrder}
/>
```

---

## Hook: useDCContext

Reads the nearest `DesignCanvas` context.

```ts
function useDCContext(): DCContextValue | null
```

- **Params:** none.
- **Returns:** the `DCContextValue` published by the enclosing `DesignCanvas`, or `null` when called outside one.

`DCContextValue` shape:

| Member | Type | Description |
| --- | --- | --- |
| `state` | `DesignCanvasState` | Live runtime state (persisted `sections` + ephemeral `focus`). |
| `section` | `(id: string) => DCSectionState` | Read one section's persisted state (empty object when absent). |
| `patchSection` | `(id: string, patch: Partial<DCSectionState> \| ((prev: DCSectionState) => Partial<DCSectionState>)) => void` | Patch one section's state; the patch may be an object or an updater function. |
| `setFocus` | `(slotId: string \| null) => void` | Open the focus overlay on a slot id (`"sectionId/artboardId"`), or close it with `null`. |

```tsx
import { useDCContext } from "@monet-ui/monet-react";

function FocusFirst({ slotId }: { slotId: string }) {
  const ctx = useDCContext();
  return <button onClick={() => ctx?.setFocus(slotId)}>Focus</button>;
}
```

---

## Functions

### dcExport

Exports one artboard DOM node as a self-contained PNG or HTML file (computed styles baked in; `@font-face` rules, `<img>` srcs, and inline `background-image` urls inlined as data URIs). PNG rasterizes at 3× the artboard's natural width×height; HTML wraps the clone in a minimal standalone document. Independent of viewport zoom. Triggers a browser download.

```ts
function dcExport(
  node: HTMLElement,
  w: number,
  h: number,
  name: string,
  kind: DCExportKind,
): Promise<void>
```

- `node` — the artboard card element to export.
- `w`, `h` — the artboard's natural width / height in px (drives the export resolution).
- `name` — download file name (without extension).
- `kind` — `"png"` or `"html"`.

### dcFlatten

Recursively unwraps `React.Fragment` so `<>…</>` grouping doesn't hide `DCSection` / `DCArtboard` children from the canvas's type-based walks. Non-fragment children pass through unchanged.

```ts
function dcFlatten(children: React.ReactNode): React.ReactNode[]
```

### defaultDesignCanvasBridge

Builds the default persistence bridge: `load` reads the `.design-canvas.state.json` sidecar via `fetch()`; `save` writes through the host's `window.omelette.writeFile` when present (read-only otherwise). Used when `DesignCanvas` receives no `bridge` prop.

```ts
function defaultDesignCanvasBridge(): DesignCanvasBridge
```

---

## Types & constants

### DesignCanvasProps

Props for `DesignCanvas` (see the table above): `children?`, `minScale?` (default `0.1`), `maxScale?` (default `8`), `style?`, `bridge?`.

### DesignCanvasState

The full runtime state.

| Field | Type | Description |
| --- | --- | --- |
| `sections` | `Record<string, DCSectionState>` | Per-section persisted state, keyed by section id. |
| `focus` | `string \| null` | Currently focused slot id (`"sectionId/artboardId"`), or `null`. Ephemeral — never persisted. |

### DesignCanvasPersistedState

The persisted subset that round-trips through the bridge: `{ sections: Record<string, DCSectionState> }`.

### DCSectionState

Persisted per-section state.

| Field | Type | Description |
| --- | --- | --- |
| `title` | `string` *(optional)* | Renamed section title (overrides the `title` prop when present). |
| `order` | `string[]` *(optional)* | Slot ids in the user's chosen display order. |
| `labels` | `Record<string, string>` *(optional)* | Renamed artboard labels, keyed by slot id. |
| `hidden` | `string[]` *(optional)* | Slot ids the user has deleted (scoped to `srcKey`). |
| `srcKey` | `string` *(optional)* | Source-revision key the `hidden` set applies to; when the host content's artboard-id set changes it no longer matches and deletes are dropped. |

### DesignCanvasBridge

Pluggable persistence contract. Either member may be omitted — a missing `save` makes the canvas read-only; a missing `load` starts from source order.

| Member | Type | Description |
| --- | --- | --- |
| `load` | `() => Promise<DesignCanvasPersistedState \| null \| undefined>` *(optional)* | Called once on mount to hydrate the saved arrangement. Return `null`/`undefined` when nothing is saved. |
| `save` | `(state: DesignCanvasPersistedState) => Promise<void> \| void` *(optional)* | Called (debounced) whenever the persisted state changes. May reject; the canvas swallows failures. |

### DCSectionProps / DCArtboardProps / DCPostItProps

Documented in the `DCSection`, `DCArtboard`, and `DCPostIt` sections above.

### DCFocusOverlayProps

Props for `DCFocusOverlay`: `entry: DCFocusEntry`, `sectionMeta: Record<string, DCSectionMeta>`, `sectionOrder: string[]` (all required).

### DCSectionMeta

Per-section metadata the focus overlay needs: `title?: string`, `subtitle?: string`, `slotIds: string[]` (visible slot ids in display order).

### DCFocusEntry

The focused registry entry: `sectionId: string`, `artboard: React.ReactElement<DCArtboardProps>`.

### DCContextValue

The imperative API published by `DesignCanvas` (see the `useDCContext` table above): `state`, `section`, `patchSection`, `setFocus`.

### DCExportKind

```ts
type DCExportKind = "png" | "html"
```

Artboard export format passed to `dcExport`.

### DC_STATE_FILE

```ts
const DC_STATE_FILE = ".design-canvas.state.json"
```

The sidecar file name read/written by the default persistence bridge.
