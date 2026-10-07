# Artisan — QA audit (2026-08-09, second pass)

A full-surface audit run *after* the Illustrator-parity pass, using all four e2e
suites (three of which had never been run here) plus a code-level defect hunt.

## The systemic finding

**No Artisan e2e runs in CI.** The word `artisan` does not appear anywhere in
`.github/workflows/ci.yml`. Every e2e job is `--filter monet-vision`; Artisan is
covered only by the monorepo-wide `typecheck` / `lint` / `test` steps. Its
`mcp:check` is not wired either (Vision's is).

That is the reason everything below could rot silently:

| Suite | Scenes | State when this audit started |
| --- | --- | --- |
| `e2e` (tools) | 360 | 353 passing — 6 stable failures + 1 rotating flake |
| `e2e:raster` | 11 | **5 passing** — 6 failures, never run here before |
| `e2e:svg` | 25 fixtures | clean |
| `e2e:qa` | ~40 scenes | clean, no console errors |

**Recommendation:** add an Artisan job mirroring Vision's — at minimum
`pnpm --filter monet-artisan run e2e:all` plus `mcp:check`. Everything below was
found by simply running suites that CI does not.

## Results

| Check | Before | After |
| --- | --- | --- |
| unit (vitest) | 388 files / 1961 | 391 / 1984 |
| `e2e` tools | 353 / 360 | **360 / 360** |
| `e2e:raster` | 5 / 11 | **9 / 9** |
| `e2e:svg` | 25 fixtures, 0 diffs | unchanged |
| `e2e:qa` | no console errors | unchanged |
| typecheck / lint / build | clean | clean (24 pre-existing warnings) |

## App defects found and fixed

Each was reproduced with a failing test first, and each test was re-run with the
fix stashed to confirm it actually catches the defect.

1. **Save threw and left the document dirty.** `containerBytes` awaits
   `initMonetFormat()` — the *container* wasm — then calls `graphicsContainerFrom`,
   which lives in a *different* module (the render engine) that throws
   "the rendering engine is still loading" until `initEngine()` has run. Nothing
   on the Save path ever booted it, so saving before the canvas had rendered
   failed and the document was never marked clean.

2. **Symbol Stainer and Styler did nothing at all.** Both skipped
   `child.type === "group"` — and every symbol *instance* is a group
   (`makeSymbolInstance` returns a `GroupItem`), so they skipped every instance
   there was. The four transform-based symbolism tools kept working, which is
   exactly why this hid for so long.

3. **Three more tools treated a hover as a drag.** The previous pass fixed this
   class in Perspective Selection and Pencil; I assumed that was the whole class.
   It was not:
   - **Transform tools** (rotate/scale/reflect/shear) never cleared `ids`, so a
     buttonless mouse move after the documented pivot-click ran a real transform
     **outside any transaction** — unundoable.
   - **Slice Selection** never cleared `id`/`slStart`, so a hover dragged the
     slice after the cursor and leaked an open transaction.
   - **Paintbrush** had no `onDeactivate`, so switching tools mid-stroke left
     `startDoc` armed and the next hover replaced the **whole document** with the
     abandoned stroke's snapshot — destroying later work unrecoverably.

4. **Duplicating a live object broke it.** `reidItemTree` remaps
   graph/dimension/mesh/livePaint/perspective ids onto the fresh subtree but
   never `blendKeyIds` or `envelope`. Duplicating a blend and releasing the copy
   matched no child and **spliced the copy out of the document entirely**.

5. **Committed edits left phantoms selected.** `undo`/`redo`/`cancelTransaction`
   already prune selection entries whose items are gone; commits did not. Any op
   that removes items (pathfinder collapsing to nothing, deleting a path's last
   anchors) left `selection`/`anchorSelection`/`keyObjectId` pointing at dead ids.
   Fixed once at the commit point rather than in each command.

6. **SVG import mis-read percentage gradient stops.** `parseFloat` discards the
   `%`, and the `off > 1 ? off/100 : off` heuristic then read any percentage at
   or below 1% as a fraction — `1%` landed at the **end** of the ramp, inverting
   the gradient.

7. **Invisible transform handles still captured drags.** `canvas-view` only
   *draws* the bounding-box handles when none of Hide Edges (⌘H), Hide Bounding
   Box (⇧⌘B) or Trim View is on, but the selection tool hit-tested them whenever
   anything was selected — so in those modes a click near the selection scaled or
   rotated artwork the user meant to click past.

8. **Envelope Distort discarded the group's transform.** (Mine, from the previous
   pass.) `sourceItems` are captured in the group's *local* space, so re-baking
   them yields local geometry — clearing `group.transform` did not normalise
   anything, it threw away every move/scale/rotation applied to the envelope.

## Test defects found and fixed

Four e2e failures were the *tests* being wrong. They are fixed rather than
deleted, so the coverage they were meant to provide is back:

- **The whole wasm half of `e2e:raster`** drove a standalone vector `Engine`
  (`e.set_document` / `e.hit_test` / `e.translate` / `e.pathfinder` / `e.group` /
  `e.duplicate`) that ceased to exist when Artisan and Vision merged engines — a
  vector scene is now a *layer*, and the API is `add_vector_layer` + `vector_*`.
  Ported the three with a real counterpart; retired `group`/`duplicate`, which
  have no wasm counterpart (they live in the TS engine).
- **`raster-gradient-fill`** wrapped an already-`Paint` `linearGradient()` in a
  second `{type:"gradient", gradient: …}`, so the renderer found no stops.
- **`mesh`** pinned the pre-refactor group name (`"Mesh"` → `"Gradient Mesh"`,
  which a green unit test asserts).
- **`select-object`** used Playwright's *substring* `hasText` for `"Object"`,
  which matched the disabled "Next Object Above" row — the scene never reached
  the command it was testing.
- **`swatches-crud`** did not claim `activePaint`, which an earlier scene
  (`gradient-stroke`) leaves on `"stroke"`; it saved the default black stroke
  instead of its own fill. Every sibling swatches scene guards against this.
- **The symbolism projection** (`harness.mjs`) signed only each direct child's
  own fill. A symbol instance is a group whose own fill is `none`, so it could
  never observe a Stainer/Styler change; it now includes descendant paint.

## Verified but NOT fixed

Confirmed by reading the code, left open deliberately — each is a behaviour
change worth a separate decision. Now tracked on GitHub:
[#253](https://github.com/Legoless/monet-core/issues/253) (CI runs no Artisan
e2e), [#254](https://github.com/Legoless/monet-core/issues/254) (tool teardown
class), [#255](https://github.com/Legoless/monet-core/issues/255) (opacity-mask
units), [#256](https://github.com/Legoless/monet-core/issues/256) (gradient
units).

- `render/item-node.tsx` — the opacity-mask region combines
  `maskUnits="userSpaceOnUse"` with percentage `x/y/width/height`, so the
  percentages resolve against the canvas viewport rather than the item, clipping
  masked artwork outside a fixed box near the item's local origin.
- `render/paint.tsx` — gradients always use `gradientUnits="objectBoundingBox"`,
  which SVG defines as *ignored* for zero-width/height geometry, so an
  axis-aligned line with a gradient stroke renders as nothing.
- `io/import/svg.ts` — a `clip-path` on a transformed element is applied in the
  wrong coordinate space (the clip group is built with an identity transform
  while the element keeps its own).
- `store.ts` — `mutate` sets `dirty: true` unconditionally, so a no-op
  transaction marks the file modified while correctly pushing no undo entry,
  leaving an unsaved-changes marker the user cannot undo away.
- `io/commands.ts` — `exportSlices` cannot distinguish "user cancelled the folder
  picker" from "no native picker", so cancelling still runs the browser download.
- **~10 further tools** call `mutateFrom` with no `onDeactivate`
  (artboard-tool, dimension, generators, gradient-tool, path-tools, reshape,
  path-shapes, shapes, direct-selection, width). None is proven broken, but they
  share the shape of defect 3 — a shared teardown would beat an eleventh copy.
