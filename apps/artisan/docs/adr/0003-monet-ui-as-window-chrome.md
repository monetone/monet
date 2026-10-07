# 3. Monet UI as window chrome

## Status

Accepted; storage mechanism superseded by monorepo consolidation.

## Context

Monet Artisan targets an Adobe Illustrator-class desktop experience: a title bar,
dockable panels, tool rails, a status bar, and a liquid-glass native-vibrancy
window. Hand-rolling that chrome — docking, panels, color/gradient editors,
align/pathfinder UI, rulers/zoom/navigator — would be a large, app-specific
effort duplicating what the shared Monet UI design system already provides. The
Monet vector *example* (`../../../../packages/monet-ui/examples/vector`) is only
a static SVG mock; Artisan needs the real editor behind that look.

## Decision

Monet UI supplies all window chrome. The app is a transparent, decorationless
native-vibrancy Tauri window; Monet draws the title bar, docks, panels, rails, and
status bar in the webview from `@monet-ui/monet-react` primitives. Artisan draws
its **vector editing surface inside Monet's `Canvas`**. `@monet-ui/*` packages are
linked from `packages/monet-ui` through the root pnpm workspace.
The convention: reach for a Monet component before writing a new one, and accent
through `var(--accent-vector)` rather than baking colors into chrome.

## Consequences

- Consistent, polished chrome for free; UI work focuses on Artisan's editing
  panels and the vector surface, not window furniture.
- Clean app builds require the root workspace dependencies and built Monet UI
  packages (`pnpm install` followed by `pnpm build:libs`).
- Artisan's look is coupled to Monet's design tokens and primitives; bespoke
  chrome that bypasses Monet is discouraged to avoid visual drift.
- The Rust shell brings up the window via the `monet_ui` crate.
