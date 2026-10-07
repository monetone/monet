# 1. Engine purity — a React/DOM/Monet-free core

## Status

Accepted.

## Context

Monet Artisan is a vector editor whose value lives in its document model and
geometry: paths, transforms, boolean pathfinding, alignment, text layout, and the
edit operations over them. These need to be exhaustively testable, reusable across
the renderer / tools / commands, and independent of the UI framework or host
window so they can be reasoned about in isolation and ported if the chrome ever
changes.

## Decision

`src/engine/` is pure TypeScript: no React, no DOM, and no Monet UI imports. It
exposes `geometry/`, `model/` (Document/Layer/Item/Path/Paint/Stroke + factories,
query, shapes), `store/` (the observable store and undo/redo), `ops/` (document
operations), and `io/` (SVG export + `.artisan` JSON + path/transform parsing
primitives). Everything that touches React, the DOM, or Monet lives outside the
engine — in `render/`, `tools/`, `ui/`, `state/`, and the DOM-dependent file
*importers* under `src/io/import/`.

## Consequences

- The engine is unit-testable without a DOM or render harness; the suite asserts
  numeric geometry and emitted SVG directly.
- Edit logic is shared by the renderer, tool system, and command layer rather than
  duplicated per surface.
- The boundary is **convention only** — there is no ESLint rule or build check
  that fails when engine code imports React/DOM/Monet. It is upheld by review, so
  contributors must consciously keep `engine/` clean. DOM-touching parsing (e.g.
  the SVG importer's `DOMParser` walk) is deliberately placed in `src/io/import/`,
  not the engine.
