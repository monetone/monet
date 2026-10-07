# @monet-ui/monet-react

The **Monet** liquid-glass panel design system as React + TypeScript components, with
[Tauri 2](https://tauri.app) window integration: neutral chrome primitives (Workspace,
Titlebar, ToolRail, Dock, Panel, StatusBar…), a data-driven **dockable workspace engine**
(`DockableWorkspace` — drag-to-undock, directional snap zones, floating mini-docks),
in-house form controls + overlays + menus + dialogs, a geometric icon set, the
`DesignCanvas`, and the Tauri chrome glue (`MonetProvider`, `useMonet`, `windowControls`).
All visuals come from **[`@monet-ui/monet-core`](../monet-core)**.

## Install

Not published to a registry — consume it directly from the
[monet-ui repo](https://github.com/Legoless/monet-ui) as a git submodule. See the root
README's **“Use Monet in your own app”** for the full recipe; in short:

```sh
git submodule add https://github.com/Legoless/monet-ui vendor/monet-ui
pnpm -C vendor/monet-ui install      # the prepare hook builds dist/ for monet-core + monet-react
```

```jsonc
// package.json — link both packages from the submodule
"@monet-ui/monet-core":  "link:vendor/monet-ui/packages/monet-core",
"@monet-ui/monet-react": "link:vendor/monet-ui/packages/monet-react"
```

Peer dependencies: `react` and `react-dom` (≥ 18.3).

## Use

```tsx
import "@monet-ui/monet-core/index.css";
import { MonetProvider, DockableWorkspace } from "@monet-ui/monet-react";

createRoot(el).render(
  <MonetProvider>           {/* platform + accent from the Rust side; bare chrome in Tauri */}
    <DockableWorkspace …/>
  </MonetProvider>,
);
```

Designed for the **`monet-ui`** Rust crate's transparent + native-vibrancy window. See the
[root README](https://github.com/Legoless/monet-ui#readme) for the full wiring.
The native Tauri path is verified on macOS and Windows; Linux uses the crate's
solid-background fallback.

## License

MIT
