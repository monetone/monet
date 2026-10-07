# Dialog & toast

Accessible modal dialogs and a toast notification system for `@monet-ui/monet-react`, built on the Portal / focus-trap / dismiss plumbing in `overlay-core`.

> The app imports the stylesheet once: `import "@monet-ui/monet-core/index.css"`. Dialog and toast visuals live in `monet-core/overlays.css`.

## Dialog

An accessible modal dialog: focus-trapped, body-scroll-locked, and dismissible via Escape, backdrop click, or the header close button. It renders through a Portal with `role="dialog"`, `aria-modal="true"`, and wires `aria-labelledby` / `aria-describedby` to the provided `title` / `description`. When `open` is `false` it renders nothing.

### Props (`DialogProps`)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `open` | `boolean` | — (required) | Visibility. |
| `onClose` | `() => void` | — (required) | Requested close (Escape, backdrop click, close button). |
| `title` | `ReactNode` | `undefined` | Accessible title; rendered in the header and wired to `aria-labelledby`. |
| `description` | `ReactNode` | `undefined` | Supporting copy; wired to `aria-describedby`. |
| `children` | `ReactNode` | `undefined` | Body content. |
| `footer` | `ReactNode` | `undefined` | Footer content (typically action buttons). |
| `dismissOnBackdrop` | `boolean` | `true` | Allow closing by clicking the backdrop. |
| `dismissOnEscape` | `boolean` | `true` | Allow closing with Escape. |
| `showClose` | `boolean` | `true` | Show the header close button. |
| `className` | `string` | `undefined` | Extra class on the dialog surface. |
| `width` | `number \| string` | `undefined` (from CSS) | Width hint for the surface (px or CSS length). |
| `ariaLabel` | `string` | `undefined` | Accessible label when no `title` is provided. |

### Usage

```tsx
import { useState } from "react";
import { Dialog } from "@monet-ui/monet-react";

function Example() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Delete project"
      description="This action cannot be undone."
      footer={<button onClick={() => setOpen(false)}>Cancel</button>}
    >
      Are you sure you want to continue?
    </Dialog>
  );
}
```

## ToastProvider

Provides the toast API via context and renders the live-region stack (a Portal-mounted `Toaster`). Wrap your app once near the root; descendants call `useToast()` to push notifications.

### Props (`ToastProviderProps`)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | — (required) | Subtree that gets access to the toast API. |
| `placement` | `"top-left" \| "top-right" \| "bottom-left" \| "bottom-right"` | `"bottom-right"` | Corner the stack anchors to. |
| `max` | `number` | `5` | Max simultaneously visible toasts; older ones drop. |

### Usage

```tsx
import { ToastProvider } from "@monet-ui/monet-react";

function App() {
  return (
    <ToastProvider placement="top-right" max={3}>
      {/* rest of the app */}
    </ToastProvider>
  );
}
```

## useToast

Hook that returns the toast API. Must be called from a component rendered under a `<ToastProvider>`; otherwise it throws `Error("useToast must be used within a <ToastProvider>")`.

### Signature

```ts
function useToast(): ToastApi;
```

- **Params:** none.
- **Returns:** `ToastApi` — `{ push, dismiss, clear }`:
  - `push(opts: ToastOptions): string` — show a toast; returns its `id` for manual dismissal.
  - `dismiss(id: string): void` — dismiss a specific toast.
  - `clear(): void` — dismiss all toasts.

### Usage

```tsx
import { useToast } from "@monet-ui/monet-react";

function SaveButton() {
  const toast = useToast();
  return (
    <button
      onClick={() => {
        const id = toast.push({
          message: "Saved",
          variant: "success",
          action: { label: "Undo", onClick: () => toast.dismiss(id) },
        });
      }}
    >
      Save
    </button>
  );
}
```

## Types & constants

### `ToastVariant`

```ts
type ToastVariant = "info" | "success" | "warn" | "error";
```

Visual + semantic variant of a toast. `error` and `warn` render as assertive (`role="alert"`, `aria-live="assertive"`); `info` and `success` are polite (`role="status"`, `aria-live="polite"`).

### `ToastOptions`

Argument to `push()`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `message` | `ReactNode` | — (required) | Primary message. |
| `title` | `ReactNode` | `undefined` | Optional bold lead-in title. |
| `variant` | `ToastVariant` | `"info"` | Visual + semantic variant. |
| `duration` | `number \| null` | `5000` | Auto-dismiss after N ms. `0` / `null` disables auto-dismiss. |
| `action` | `{ label: string; onClick: () => void }` | `undefined` | Optional single action (e.g. "Undo"). |

### `Toast`

The resolved, stored toast object (`ToastOptions` after defaults are applied), extending `Required<Pick<ToastOptions, "message" | "variant">>`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique id assigned on push (e.g. `monet-toast-1`). |
| `message` | `ReactNode` | Primary message (required). |
| `variant` | `ToastVariant` | Resolved variant (required). |
| `title` | `ReactNode` (optional) | Optional lead-in title. |
| `duration` | `number \| null` | Resolved auto-dismiss duration. |
| `action` | `{ label: string; onClick: () => void }` (optional) | Optional single action. |

### `ToastApi`

The context value returned by `useToast()`.

| Member | Type | Description |
| --- | --- | --- |
| `push` | `(opts: ToastOptions) => string` | Show a toast; returns its id for manual dismissal. |
| `dismiss` | `(id: string) => void` | Dismiss a specific toast. |
| `clear` | `() => void` | Dismiss all toasts. |

### `DialogProps` / `ToastProviderProps`

The prop interfaces documented in the **Dialog** and **ToastProvider** sections above. Both are exported for typing wrapper components.
