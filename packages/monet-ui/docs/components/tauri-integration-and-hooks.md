# Tauri Integration & Hooks

Bridges the Monet React chrome to the native Tauri window — platform/accent/vibrancy config, window controls, live window state, and native menu commands — degrading gracefully to no-ops in a plain browser.

The native Tauri path is verified on macOS and Windows. Linux uses the same chrome with the solid-background fallback supplied by the Rust crate.

> All symbols below are exported from `@monet-ui/monet-react` (re-exported from its `chrome` module). Apps using the chrome import the stylesheet once: `import "@monet-ui/monet-core/index.css";`.

---

## MonetProvider

Provides platform / accent / window-controls / live window-state / menu-command subscription to the Monet chrome, and sets the `--accent` custom property on the document root (so browser-only dev matches the Rust init script). One menu-command listener hub is created per provider instance and disposed on unmount.

### Props (`MonetProviderProps`)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `config` | `Partial<MonetConfig>` | _(optional)_ `undefined` | Override config fields (e.g. pin an accent). |
| `controls` | `WindowControls` | `windowControls` (the Tauri-backed default) | Custom window-control actions. |
| `children` | `ReactNode` | _(required)_ | Subtree that consumes the Monet context. |

```tsx
import { MonetProvider } from "@monet-ui/monet-react";

function Root() {
  return (
    <MonetProvider>
      <App />
    </MonetProvider>
  );
}
```

---

## Hooks

### useMonet

Reads the live Monet config: the synchronously-injected `window.__MONET__` first, then reconciled with the async `monet_config` Tauri command. Outside Tauri it returns a guessed-platform default. An `override` pins specific fields (e.g. force an accent in the Sandbox) and always wins over both sources.

- **Signature:** `useMonet(override?: Partial<MonetConfig>): MonetConfig`
- **Params:** `override?` — partial config whose fields take precedence over the injected/command values.
- **Returns:** a `MonetConfig` (see types below).

```tsx
import { useMonet } from "@monet-ui/monet-react";

function PlatformBadge() {
  const { platform, accent, vibrancy } = useMonet();
  return <span>{platform} · {accent} · {vibrancy ? "vibrant" : "solid"}</span>;
}
```

### useMonetContext

Reads the nearest `MonetProvider` value, or `null` if there is no provider above.

- **Signature:** `useMonetContext(): MonetContextValue | null`
- **Params:** none.
- **Returns:** `MonetContextValue | null` (see types below).

```tsx
import { useMonetContext } from "@monet-ui/monet-react";

function Controls() {
  const ctx = useMonetContext();
  return <button onClick={() => ctx?.controls.close()}>Close</button>;
}
```

### useWindowState

Tracks live native window state by subscribing directly to `WINDOW_EVENT`. Outside Tauri it stays at its initial value (`focused: true`, `maximized: false`) and never updates. Does **not** require a `MonetProvider`.

- **Signature:** `useWindowState(): WindowState`
- **Params:** none.
- **Returns:** `WindowState` — `{ focused: boolean; maximized: boolean }`.

```tsx
import { useWindowState } from "@monet-ui/monet-react";

function MaximizeIcon() {
  const { maximized } = useWindowState();
  return <span>{maximized ? "❐" : "▢"}</span>;
}
```

### useMonetWindowState

Reads just the live `WindowState` from the nearest `MonetProvider`. Falls back to `{ focused: true, maximized: false }` when used outside a provider. (Use this when you already render inside a `MonetProvider`; use `useWindowState` to subscribe independently.)

- **Signature:** `useMonetWindowState(): WindowState`
- **Params:** none.
- **Returns:** `WindowState`.

```tsx
import { useMonetWindowState } from "@monet-ui/monet-react";

function TitleBar() {
  const { focused } = useMonetWindowState();
  return <div data-dim={!focused}>…</div>;
}
```

### useMenuCommand

Subscribes `handler` to native menu commands for the lifetime of the calling component, via the nearest `MonetProvider`. No-op outside a provider or outside Tauri. The handler may change between renders; only the latest is invoked, so it does **not** need to be memoized.

- **Signature:** `useMenuCommand(handler: MenuCommandHandler): void`
- **Params:** `handler: (id: string) => void` — invoked with the activated menu item's id (custom default-menu ids use the `monet:` prefix, e.g. `"monet:preferences"`).
- **Returns:** `void`.

```tsx
import { useMenuCommand } from "@monet-ui/monet-react";

function Prefs() {
  useMenuCommand((id) => {
    if (id === "monet:preferences") openPreferences();
  });
  return null;
}
```

### useMonetAppearance

Reads the appearance the native vibrancy material adopted, from the nearest `MonetProvider`, so the chrome can match its theme tokens to the material. Falls back to `"dark"` outside a provider.

- **Signature:** `useMonetAppearance(): MonetAppearance`
- **Params:** none.
- **Returns:** `MonetAppearance` — `"auto" | "light" | "dark"`.

```tsx
import { useMonetAppearance } from "@monet-ui/monet-react";

function Theme({ children }: { children: React.ReactNode }) {
  const appearance = useMonetAppearance(); // "auto" | "light" | "dark"
  return <div data-appearance={appearance}>{children}</div>;
}
```

---

## Functions & Constants

### windowControls

A `WindowControls` object whose actions are wired to the Monet Tauri app commands (`window_close`, `window_minimize`, `window_toggle_maximize`, `window_start_drag`). All methods are no-ops outside Tauri.

- **Type:** `WindowControls` — `{ close(): void; minimize(): void; toggleMaximize(): void; startDrag(): void }`

```tsx
import { windowControls } from "@monet-ui/monet-react";

<button onMouseDown={() => windowControls.startDrag()}>drag</button>
<button onClick={() => windowControls.toggleMaximize()}>⤢</button>
```

### isTauri

Returns `true` when running inside a Tauri webview (detected via `window.__TAURI_INTERNALS__`).

- **Signature:** `isTauri(): boolean`

```tsx
import { isTauri } from "@monet-ui/monet-react";

if (isTauri()) {
  // native-only paths
}
```

### MENU_EVENT

Tauri event name the Rust side emits for native menu activations.

- **Value:** `"monet://menu"` (typed `as const`). Carries a `MenuCommandPayload`.

### WINDOW_EVENT

Tauri event name the Rust side emits for native window-state changes.

- **Value:** `"monet://window"` (typed `as const`). Carries a `WindowEventPayload`.

---

## Types & Interfaces

### MonetConfig

Per-window config injected by the Rust side as `window.__MONET__` and also returned by the `monet_config` command.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `platform` | `Platform` (from `@monet-ui/monet-core`) | yes | Host platform. |
| `accent` | `Accent` (from `@monet-ui/monet-core`) | yes | Active accent token. |
| `accentVar` | `string` | yes | CSS var reference for the accent, e.g. `"var(--accent-raster)"`. |
| `accentValue` | `string` | yes | Resolved accent colour, e.g. an `oklch(…)` value. |
| `vibrancy` | `boolean` | yes | Whether the native material vibrancy is enabled. |
| `appearance` | `MonetAppearance` | no | Appearance the material adopts; provider defaults it to `"dark"`. |
| `solidColor` | `string` | no | CSS `rgba(…)` background painted when `vibrancy` is `false` (solid / Linux fallback). |

### MonetAppearance

The light/dark/auto appearance the native vibrancy material adopts; the chrome matches its theme tokens to it. Mirrors the Rust `VibrancyAppearance`.

- **Type:** `"auto" | "light" | "dark"`

### WindowState

Live native window state, kept in sync from `WINDOW_EVENT`. Drives the chrome's maximize/restore button and dim-on-blur styling.

| Field | Type | Description |
| --- | --- | --- |
| `focused` | `boolean` | Whether the window currently has key focus (defaults `true`). |
| `maximized` | `boolean` | Whether the window is currently maximized. |

### WindowEventPayload

Payload of `WINDOW_EVENT` — a discriminated union on `type`, mirroring the Rust `WindowEventPayload`.

- **Type:**
  ```ts
  | { type: "focused"; focused: boolean }
  | { type: "maximized"; maximized: boolean }
  | { type: "closeRequested" }
  ```
  (`"closeRequested"` carries no state; advisory only.)

### MenuCommandPayload

Payload of `MENU_EVENT`: the activated menu item's id. Custom default-menu ids live under the `monet:` prefix (e.g. `"monet:preferences"`).

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | The activated menu item's id. |

### MenuCommandHandler

A menu-command handler. Receives the activated menu item id.

- **Type:** `(id: string) => void`

### MenuCommandSubscribe

A subscribe function: register a `MenuCommandHandler`, get back an unsubscribe function. Provided through `MonetProvider` (as `onMenuCommand`) so apps can react to native menu commands. No-op outside Tauri.

- **Type:** `(handler: MenuCommandHandler) => () => void`

### WindowControls

Window-control actions wired to the Monet app commands. No-ops outside Tauri.

| Method | Type | Description |
| --- | --- | --- |
| `close` | `() => void` | Close the window (`window_close`). |
| `minimize` | `() => void` | Minimize the window (`window_minimize`). |
| `toggleMaximize` | `() => void` | Toggle maximize/restore (`window_toggle_maximize`). |
| `startDrag` | `() => void` | Begin a window drag, e.g. on title-bar mousedown (`window_start_drag`). |

### MonetContextValue

The value provided by `MonetProvider` and read via `useMonetContext`.

| Field | Type | Description |
| --- | --- | --- |
| `platform` | `Platform` | Host platform. |
| `accent` | `Accent \| string` | Active accent (string-widened for host overrides). |
| `vibrancy` | `boolean` | Whether native material vibrancy is enabled. |
| `appearance` | `MonetAppearance` | Appearance the material adopts; defaults to `"dark"` when Rust supplies none. |
| `controls` | `WindowControls` | Window-control actions. |
| `windowState` | `WindowState` | Live native window state (focus + maximized). |
| `onMenuCommand` | `MenuCommandSubscribe` | Subscribe to native menu commands; returns an unsubscribe. No-op outside Tauri. |

### MonetContext

The React context object (`React.Context<MonetContextValue | null>`) backing the provider. Prefer the `useMonetContext` / `useMonet…` hooks over consuming this directly.

### MonetProviderProps

Props for `MonetProvider` — see the [MonetProvider props table](#props-monetproviderprops) above.
