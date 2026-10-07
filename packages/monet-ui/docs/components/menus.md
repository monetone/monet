# Menus

Data-driven, fully keyboard-navigable menus for `@monet-ui/monet-react` — a render-prop `Menu` dropdown, a horizontal `MenuBar` application bar, and a pointer-anchored `ContextMenu`, all driven by a shared `MenuItemDef` model and rendered through the Portal with viewport-aware positioning.

> All components render their dropdown surface through the Portal and rely on visuals from `@monet-ui/monet-core/overlays.css`. The app imports the bundled stylesheet **once**:
>
> ```ts
> import "@monet-ui/monet-core/index.css";
> ```

Accessibility is built in: roving `tabindex`, `role=menubar`/`menu`/`menuitem`/`menuitemcheckbox`, Up/Down/Home/End to move, Left/Right to traverse, typeahead, `aria-haspopup`/`aria-expanded` on submenu triggers, Esc to close the active layer, and outside-click to close all.

---

## Menu

A dropdown menu bound to a custom trigger via a render-prop. You own the trigger element; `Menu` hands you the props to spread and manages open/close, positioning, focus, and dismissal. Supports both uncontrolled and controlled open state.

### Props (`MenuProps`)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `MenuItemDef[]` | — (required) | The menu's items. Items with nested `items` become submenu triggers. |
| `children` | `(api) => ReactNode` | — (required) | Render-prop that receives the trigger `api` (see below) and returns the trigger element. |
| `side` | `Side` | `"bottom"` | Preferred side to open toward. `Side` = `"top" \| "bottom" \| "left" \| "right"`. |
| `align` | `"start" \| "center" \| "end"` | `"start"` | Alignment of the dropdown along the trigger's edge. |
| `open` | `boolean` | `undefined` | Controlled open state. Omit for uncontrolled behavior. |
| `onOpenChange` | `(open: boolean) => void` | `undefined` | Called whenever the open state should change. |

**Render-prop `api` shape** (object passed to `children`):

| Field | Type | Description |
| --- | --- | --- |
| `ref` | `(n: HTMLElement \| null) => void` | Ref callback to attach to the trigger element (used as the positioning anchor). |
| `open` | `boolean` | Current open state. |
| `toggle` | `() => void` | Toggles the menu open/closed. |
| `aria-haspopup` | `"menu"` | Spread onto the trigger for a11y. |
| `aria-expanded` | `boolean` | Spread onto the trigger for a11y. |
| `id` | `string` | Trigger id; the dropdown's `aria-labelledby` points at it. |

### Usage

```tsx
import { Menu } from "@monet-ui/monet-react";

function ActionsButton() {
  return (
    <Menu
      items={[
        { id: "open", label: "Open", shortcut: "⌘O", action: () => {} },
        { id: "sep", separator: true },
        { id: "del", label: "Delete", disabled: true },
      ]}
    >
      {({ ref, toggle, open, ...aria }) => (
        <button ref={ref} onClick={toggle} {...aria}>
          Actions {open ? "▴" : "▾"}
        </button>
      )}
    </Menu>
  );
}
```

---

## MenuBar

A horizontal application menu bar (e.g. File / Edit / View). Click or arrow-key to open a menu; once open, hovering siblings switches between them, and Left/Right move between top-level menus. Each dropdown renders through the Portal.

### Props (`MenuBarProps`)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `menus` | `MenuBarEntry[]` | — (required) | The top-level menus, each with its own items. |
| `className` | `string` | `undefined` | Extra className on the menubar row (chrome supplies its own look). |
| `itemClassName` | `string` | `"monet-menu"` | Class applied to each top-level menu button. |
| `openClassName` | `string` | `"is-open"` | Class appended to the open top-level menu button. |

### Usage

```tsx
import { MenuBar } from "@monet-ui/monet-react";

function AppMenuBar() {
  return (
    <MenuBar
      menus={[
        {
          id: "file",
          label: "File",
          items: [
            { id: "new", label: "New", shortcut: "⌘N", action: () => {} },
            { id: "open", label: "Open…", shortcut: "⌘O", action: () => {} },
          ],
        },
        {
          id: "edit",
          label: "Edit",
          items: [
            { id: "undo", label: "Undo", shortcut: "⌘Z", action: () => {} },
            { id: "redo", label: "Redo", shortcut: "⇧⌘Z", action: () => {} },
          ],
        },
      ]}
    />
  );
}
```

---

## ContextMenu

Wraps any region and shows a menu at the pointer on the `contextmenu` (right-click) event. The menu is fully keyboard-navigable once open and dismisses on Escape, outside click, or selection.

### Props (`ContextMenuProps`)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `MenuItemDef[]` | — (required) | The menu's items, shown at the pointer location. |
| `children` | `ReactNode` | — (required) | The region that triggers the menu on right-click / `contextmenu`. |
| `className` | `string` | `undefined` | Class applied to the wrapper `<div>`. |

### Usage

```tsx
import { ContextMenu } from "@monet-ui/monet-react";

function Canvas() {
  return (
    <ContextMenu
      items={[
        { id: "cut", label: "Cut", action: () => {} },
        { id: "copy", label: "Copy", action: () => {} },
        { id: "sep", separator: true },
        { id: "paste", label: "Paste", action: () => {} },
      ]}
    >
      <div className="canvas">Right-click anywhere</div>
    </ContextMenu>
  );
}
```

---

## Types

### `MenuItemDef`

The shared item model consumed by every menu component. Only `id` is required; the remaining fields are optional and combine to produce leaves, separators, checkable items, and submenus.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Stable identifier, unique within its parent menu. |
| `label` | `ReactNode` | No | Visible label. Omitted for separators. |
| `action` | `() => void` | No | Invoked on activation (click / Enter / Space). |
| `shortcut` | `string` | No | Display-only shortcut hint, e.g. `"⌘S"` or `"Ctrl+S"`. |
| `items` | `MenuItemDef[]` | No | Nested items — presence makes this a submenu trigger. |
| `separator` | `boolean` | No | Render a divider instead of an item. |
| `disabled` | `boolean` | No | Greyed out and not activable. |
| `checked` | `boolean` | No | Checkable item state — renders `role="menuitemcheckbox"` plus a check glyph. |
| `icon` | `string` | No | Optional leading icon: a key into the icon map `I`, or a raw SVG path string. |

```tsx
import type { MenuItemDef } from "@monet-ui/monet-react";

const items: MenuItemDef[] = [
  { id: "wrap", label: "Word Wrap", checked: true, action: () => {} },
  { id: "sep", separator: true },
  {
    id: "more",
    label: "More",
    items: [{ id: "sub", label: "Nested", action: () => {} }],
  },
];
```

### `MenuBarEntry`

A single top-level menu within a `MenuBar`.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Stable id for the top-level menu. |
| `label` | `ReactNode` | Yes | Visible label, e.g. `"File"`. |
| `items` | `MenuItemDef[]` | Yes | The menu's items. |
| `disabled` | `boolean` | No | Disables this top-level menu (skipped by arrow-key navigation). |

```tsx
import type { MenuBarEntry } from "@monet-ui/monet-react";

const fileMenu: MenuBarEntry = {
  id: "file",
  label: "File",
  items: [{ id: "quit", label: "Quit", shortcut: "⌘Q", action: () => {} }],
};
```

---

## Notes

- **No hooks are exported from this group.** `Menu`, `MenuBar`, and `ContextMenu` are components; `MenuItemDef`, `MenuBarEntry`, `MenuProps`, `MenuBarProps`, and `ContextMenuProps` are types/interfaces.
- The `Side` type used by `Menu.side` (and submenu positioning) is re-exported from the overlay-core module: `type Side = "top" | "bottom" | "left" | "right"`.
- `MenuItem` and `SubMenu` are mentioned in the file header but are **internal** (`MenuSurface`, `SubMenu`) — they are not exported and are not part of the public API.
- Submenus always open toward the `right` side by default (the internal `submenuSide` default); this is not configurable through the public `Menu`/`MenuBar`/`ContextMenu` props.
- A `checked` value of `false` (vs. omitting `checked`) still renders the item as a checkbox (`role="menuitemcheckbox"`) with an empty check slot, because the check role is keyed on `typeof item.checked === "boolean"`.
