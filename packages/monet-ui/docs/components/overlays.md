# Overlays

The foundation for every floating layer in Monet — tooltips, popovers, menus, dialogs, and toasts. Self-contained behavior + accessibility (portaling, focus management, dismiss handling, anchored positioning); all visuals live in `@monet-ui/monet-core`.

> Setup: import the stylesheet once at your app entry — `import "@monet-ui/monet-core/index.css"`. Overlay visuals (`.monet-tooltip`, `.monet-popover`, `.monet-overlay-root`) come from `overlays.css`, which `index.css` bundles.

---

## Components

### Portal

Renders `children` into the managed overlay root (a single `<div id="monet-overlay-root" class="monet-overlay-root">` appended to `<body>` on first use), or into a custom `container`. Living outside the app subtree keeps overlays clear of ancestor `overflow`/`transform`/`z-index` traps. Returns `null` on the server and on first paint (resolves its target after mount).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | — (required) | Content to render into the portal target. |
| `container` | `HTMLElement \| null` | `undefined` (managed body root) | Render into a specific element instead of the managed body root. |

```tsx
import { Portal } from "@monet-ui/monet-react";

function Example() {
  return (
    <Portal>
      <div className="monet-tooltip">Floating content</div>
    </Portal>
  );
}
```

---

### Tooltip

Accessible tooltip shown on hover **and** keyboard focus after `delay`. Wires `aria-describedby` from the trigger to the tooltip (`role="tooltip"`), repositions on scroll/resize, and closes on blur, pointer leave, or Escape. The single child must be a valid element that accepts a `ref` and the spread aria/event props; if it is not a valid element, the child is returned as-is.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `content` | `ReactNode` | — (required) | Tooltip text/content (string or simple inline node). |
| `children` | `ReactElement` | — (required) | The trigger element — must accept a ref and the spread aria props. |
| `side` | `Side` (`"top" \| "bottom" \| "left" \| "right"`) | `"top"` | Preferred side; flips if it would overflow the viewport. |
| `align` | `Align` (`"start" \| "center" \| "end"`) | `"center"` | Cross-axis alignment relative to the trigger. |
| `delay` | `number` | `400` | Hover/focus open delay in ms. |
| `disabled` | `boolean` | `false` | Disable the tooltip entirely. |

```tsx
import { Tooltip } from "@monet-ui/monet-react";

function Example() {
  return (
    <Tooltip content="Save changes" side="bottom">
      <button>Save</button>
    </Tooltip>
  );
}
```

> Note: `Tooltip` positions with a fixed `offset` of `6px` (it does not expose an `offset` prop).

---

### Popover

Anchored floating panel with viewport flip/shift, optional focus trap, and dismiss handling (Escape + outside pointerdown). Controlled via `open` / `onOpenChange`. The trigger automatically gets `aria-haspopup`, `aria-expanded`, and `aria-controls` wired up. The single child must be a valid element that accepts a `ref`; otherwise it is returned as-is.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `open` | `boolean` | — (required) | Controls visibility. |
| `onOpenChange` | `(open: boolean) => void` | — (required) | Called when the popover requests close (Escape / outside click). |
| `children` | `ReactElement` | — (required) | The anchor element — must accept a ref. |
| `content` | `ReactNode` | — (required) | Floating content. |
| `side` | `Side` (`"top" \| "bottom" \| "left" \| "right"`) | `"bottom"` | Preferred side; flips if it would overflow the viewport. |
| `align` | `Align` (`"start" \| "center" \| "end"`) | `"center"` | Cross-axis alignment relative to the anchor. |
| `offset` | `number` | `8` | Gap between anchor and panel, in px. |
| `label` | `string` | `undefined` | Accessible label for the floating panel (sets `aria-label`). |
| `labelledBy` | `string` | `undefined` | Id of an element that labels the panel (sets `aria-labelledby`; alternative to `label`). |
| `trapFocus` | `boolean` | `true` | Trap focus inside the panel while open. |
| `className` | `string` | `undefined` | Extra class on the floating panel (appended to `monet-popover`). |
| `role` | `string` | `"dialog"` | Role for the floating panel. When `"menu"`, the trigger's `aria-haspopup` becomes `"menu"`; otherwise `"dialog"`. |

```tsx
import { useState } from "react";
import { Popover } from "@monet-ui/monet-react";

function Example() {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Account menu"
      content={<div>Panel body</div>}
    >
      <button onClick={() => setOpen((v) => !v)}>Open</button>
    </Popover>
  );
}
```

---

## Hooks

### useMonetId

Thin wrapper over React 18's `useId` that prepends a readable prefix (and strips `:` characters) so the value reads well in the accessibility tree.

```ts
function useMonetId(prefix?: string): string; // prefix default: "monet"
```

- **Params:** `prefix` (optional, default `"monet"`).
- **Returns:** a stable id `string`, e.g. `"monet-r3"`.

```tsx
import { useMonetId } from "@monet-ui/monet-react";

const labelId = useMonetId("monet-dialog-label");
```

---

### useLayer

Reserves a monotonically increasing z-index for one overlay instance for its whole lifetime, so nested layers always stack above their opener. Base is `1000` (above the in-window chrome). The reserved value is held in a ref and assigned once.

```ts
function useLayer(active?: boolean): number; // active default: true
```

- **Params:** `active` (optional, default `true`) — when `false` before a value is reserved, returns the base `1000` without consuming a slot.
- **Returns:** a `number` z-index.

```tsx
import { useLayer } from "@monet-ui/monet-react";

const z = useLayer(open);
// style={{ zIndex: z }}
```

---

### useFocusTrap

Confines Tab / Shift+Tab to focusable elements inside `ref`. On activate, focus moves to the first focusable child (or the container itself, made `tabindex="-1"` as a fallback); on deactivate focus returns to whatever was focused before. Used by Dialog and Menu.

```ts
function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  options?: FocusTrapOptions,
): void;
```

`FocusTrapOptions`:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `active` | `boolean` | `true` | Trap only while true (lets a dialog enable the trap on open). |
| `autoFocus` | `boolean` | `true` | Move focus into the container on activate. |
| `restoreFocus` | `boolean` | `true` | Restore focus to the previously-focused element on deactivate. |

- **Returns:** `void`.

```tsx
import { useRef } from "react";
import { useFocusTrap } from "@monet-ui/monet-react";

const panelRef = useRef<HTMLDivElement>(null);
useFocusTrap(panelRef, { active: open });
```

---

### useDismiss

Dismisses a layer on Escape or a pointerdown outside all `refs`. Pointer handling uses the capture phase (so it still fires when inner handlers call `stopPropagation`); Escape is bound on keydown and calls `stopPropagation` before dismissing.

```ts
function useDismiss(options: DismissOptions): void;
```

`DismissOptions`:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `onDismiss` | `() => void` | — (required) | Called when an Escape press or an outside pointerdown is detected. |
| `refs` | `Array<RefObject<HTMLElement \| null>>` | — (required) | Elements considered "inside" — a press within any of them is ignored. |
| `enabled` | `boolean` | `true` | Disable the whole behavior (e.g. while closed). |
| `escapeKey` | `boolean` | `true` | Close on Escape. |
| `outsidePointer` | `boolean` | `true` | Close on outside pointerdown. |

- **Returns:** `void`.

```tsx
import { useRef } from "react";
import { useDismiss } from "@monet-ui/monet-react";

const anchorRef = useRef<HTMLElement>(null);
const panelRef = useRef<HTMLDivElement>(null);
useDismiss({
  onDismiss: () => setOpen(false),
  refs: [anchorRef, panelRef],
  enabled: open,
});
```

---

### useReposition

Subscribes to layout changes (capture-phase `scroll` + `resize`) and re-runs a measure callback, then runs it once immediately. Used by Popover / Tooltip / Menu to keep position glued to the anchor. Latest callback is tracked via a ref, so listeners are not re-subscribed every render.

```ts
function useReposition(measure: () => void, enabled?: boolean): void; // enabled default: true
```

- **Params:** `measure` (required) — the function to run on mount and on every scroll/resize; `enabled` (optional, default `true`).
- **Returns:** `void`.

```tsx
import { useReposition } from "@monet-ui/monet-react";

useReposition(() => {
  // measure anchor + floating, then setPos(...)
}, open);
```

---

## Functions

### computePosition

Pure positioning function: places a `floating` box of a given size relative to an `anchor` rect. Flips to the opposite side when the preferred side would overflow the viewport, then shifts along the cross axis to stay within `padding` of the edges. Callers feed measured rects and apply the result. Falls back to a `1024×768` viewport when `window` is undefined.

```ts
function computePosition(
  anchor: DOMRect,
  floating: { width: number; height: number },
  options?: PositionOptions,
): PositionResult;
```

`PositionOptions`:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `side` | `Side` | `"bottom"` | Preferred side. |
| `align` | `Align` | `"center"` | Cross-axis alignment. |
| `offset` | `number` | `8` | Gap between anchor and floating element, in px. |
| `padding` | `number` | `8` | Viewport padding kept clear when flipping/shifting, in px. |

Returns `PositionResult`: `{ left: number; top: number; side: Side }` — where `side` is the side actually used after any viewport flip.

```tsx
import { computePosition } from "@monet-ui/monet-react";

const { left, top, side } = computePosition(
  anchorEl.getBoundingClientRect(),
  { width: panel.offsetWidth, height: panel.offsetHeight },
  { side: "bottom", align: "start", offset: 8 },
);
```

---

### focusableWithin

Returns the visible focusable descendants of `root` (matched by `FOCUSABLE_SELECTOR`, filtered to elements with layout box or the current `activeElement`). Re-exported for `menu.tsx`.

```ts
function focusableWithin(root: HTMLElement): HTMLElement[];
```

```tsx
import { focusableWithin } from "@monet-ui/monet-react";

const first = focusableWithin(panelEl)[0];
first?.focus();
```

---

## Types & Constants

| Symbol | Kind | Definition / Notes |
| --- | --- | --- |
| `Side` | type | `"top" \| "bottom" \| "left" \| "right"` — placement side for anchored layers. |
| `Align` | type | `"start" \| "center" \| "end"` — cross-axis alignment. |
| `PositionOptions` | interface | `{ side?: Side; align?: Align; offset?: number; padding?: number }` — input to `computePosition`. |
| `PositionResult` | interface | `{ left: number; top: number; side: Side }` — output of `computePosition`; `side` reflects the side after any flip. |
| `FocusTrapOptions` | interface | Options for `useFocusTrap` — see the hook's table. |
| `DismissOptions` | interface | Options for `useDismiss` — see the hook's table. |
| `PortalProps` | interface | Props for `Portal` — `{ children: ReactNode; container?: HTMLElement \| null }`. |
| `TooltipProps` | interface | Props for `Tooltip` — see the component's table. |
| `PopoverProps` | interface | Props for `Popover` — see the component's table. |
| `FOCUSABLE_SELECTOR` | const `string` | Comma-joined CSS selector matching focusable elements: `a[href]`, `button:not([disabled])`, `input:not([disabled])`, `select:not([disabled])`, `textarea:not([disabled])`, `[tabindex]:not([tabindex="-1"])`. Re-exported for `menu.tsx`. |

> Convenience re-exports: `overlay-core.tsx` also re-exports the React types `CSSProperties` and `ReactNode` for overlay consumers.
