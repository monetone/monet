# Artisan — QA audit + Illustrator gap ledger (2026-08-09)

Full-surface QA pass over `apps/artisan` plus a feature-by-feature comparison
against Adobe Illustrator's menus, tool rail, and panels. Everything in
"Closed in this pass" is implemented and tested; everything in "Open gaps" is a
ranked backlog with a recommendation per item.

## Baseline

| Check | Before | After this pass |
| --- | --- | --- |
| `tsc --noEmit` | clean | clean |
| `eslint .` | 0 errors, 24 warnings | 0 errors, 24 warnings (none added) |
| `vitest run` | 370 files / 1853 tests | 384 files / 1941 tests, all green |
| `vite build` | ok | ok |
| `mcp:check` | up to date (31 tools) | up to date |
| `e2e` (visual suite) | **228 / 360** | **354 / 360** |
| Command reachability sweep | 165 commands, 1 unreachable (`cycleDrawingMode`) | 0 unreachable |

The green unit suite is why the interesting findings needed the e2e run and a
targeted defect hunt: 1853 passing tests coexisted with an application whose
entire menu bar did not render.

Six e2e scenes still fail and were **not** investigated:
`cmd-save-marks-clean` (a WASM-still-loading race in the harness, not the app),
`mesh`, `swatches-crud`, `select-object`, `symbol-stainer`, `symbol-styler`.
All six also failed before any of this work.

A **seventh, rotating** failure shows up per run — `draw-behind` one run,
`cmd-bring-to-front` the next — and every one of them passes when run alone.
That is cross-scene contamination in the harness, not an app defect, and it caps
the suite at 353–354/360 rather than 360.

## ⚠ Headline finding — the whole menu bar was unreachable on macOS

`buildMenus()` produced ~200 menu items, `App.tsx` passed them to
`DockableWorkspace`… and Monet's chrome **only draws a menu bar on Windows**.
Its macOS `Titlebar` branch renders traffic lights, document tabs and the app
pill, and drops the `menus` prop entirely — the comment in
`monet-react/src/primitives.tsx:390` reads *"menus live in the global bar"*,
meaning the native macOS menu. But Artisan's Tauri window
(`src-tauri/src/main.rs`) uses the default `MenuMode::Default`, which builds a
generic App/File/Edit/View/Window menu and knows nothing about Artisan's
commands.

Net effect on the primary target platform: **no menu bar in the window, and
nothing but a stock OS menu above it.** Every command without a keyboard
shortcut or a panel button — Envelope Distort, Live Paint, Perspective, Blend
options, most Path ops, Arrange, Align/Distribute, Effects, Select ▸ Same,
Artboards, most of View — had no way to be invoked at all.

Verified empirically, not just read: a Playwright probe of the running app found
zero `[role="menubar"]` and zero `[role="menuitem"]` elements, and the 132
menu-driven e2e scenes had been failing on a 30s selector timeout. Confirmed
pre-existing by reproducing it with this pass's changes stashed.

**Fix (Artisan-only, no shared-package change):** Artisan now renders its own
`MenuBar` as a top toolbar row on non-Windows platforms, styled with the design
system's existing `.monet-menustrip`. Windows still uses Monet's chrome menu, so
there is never a double bar. That, plus the defect fixes below, took the e2e suite from 228/360 to 354/360.

### Correction, and the shared-code answer

An earlier draft of this doc said Vision had the same hole. **It does not.**
Vision solved this properly and is the only app that has:
`apps/vision/src/native/macMenu.ts` (300 lines) mirrors its React `MenuBarEntry[]`
into the **real macOS system menu** via Tauri's JS menu API, and
`apps/vision/src/main.tsx` forces `platform: "win"` in web builds purely so the
menu renders in-window where there is no global bar.

Empirically confirmed with the same DOM probe: Vision renders File/Edit/Image/
Layer/Type/Select/Filter/View/Window/Help.

Which apps have a reachable menu on macOS:

| App | native mac menu | in-window menu | reachable on macOS |
| --- | --- | --- | --- |
| vision | ✅ | ✅ (web forces "win") | ✅ |
| artisan | — | ✅ (this pass) | ✅ in-window |
| cinema, galerie, jouer, rythme, anime | ✅ (now) | ❌ | ✅ |

**Now closed.** `macMenu.ts` moved to `@monet-ui/monet-react` ▸ `mac-menu` behind
`syncMacMenu(menus, platform, { appName, settingsPath?, … })`, and all five
menu-less apps call it. Vision keeps a one-line binding at its old path so its
imports are unchanged.

The obstacle recorded below was solved the same way the durable-save lift was:
the module AND its generic tests live in the package, where `vi.mock` can reach
the Tauri imports. The one Vision-specific case — that the bridge wires up
against Vision's *real* Photoshop menu bar, whose label paths the native-only
aliases resolve against — stayed in Vision, which is where it belongs.

**The refactor this implies:** `macMenu.ts` is app-agnostic infrastructure
(imports are only `react` types, `@tauri-apps/api`, and `MenuBarEntry`/
`MenuItemDef` from the design system) sitting inside one app's folder. Only two
things are Vision-specific: the `"Monet Vision"` strings and three alias label
paths (`Edit ▸ Preferences`, `Help ▸ System Info…`, `Help ▸ Keyboard Shortcuts…`).
It should move to `@monet-ui/monet-react` behind a
`syncMacMenu(menus, platform, { appName, settingsPath?, … })` signature, and the
five menu-less apps should adopt it.

**Attempted and reverted, with the obstacle recorded:** the lift itself works
(both apps typecheck against a shared `mac-menu.ts`), but Vision's
`macMenu.test.ts` mocks `@tauri-apps/api/core` and `@tauri-apps/api/menu`, and
Vitest **externalizes the workspace dependency**, so `vi.mock` cannot reach
through `@monet-ui/monet-react` into the Tauri imports — 4 tests go red. Adding
`server.deps.inline` did not help, and aliasing to monet-react's source is not
viable from Vision's node-environment config (the source is JSX).

The fix is to inject the Tauri surface at the app boundary rather than import it
inside the shared module — `syncMacMenu(menus, platform, { appName, isNative,
loadMenuModule })`, with each app's thin wrapper passing its own (mockable)
imports. That keeps Vision's tests exactly as they are. Worth doing; it was out
of proportion to do unannounced inside this pass, so the shared package and
Vision are left untouched.

Artisan was already very close to Illustrator: 73 tools, 28 panels, and the
Object/Type/Effect/Select menus almost fully populated. The findings below are
therefore mostly *edges* — advertised-but-dead keys, ops that silently no-op on a
valid selection, and a handful of genuinely absent features.

## QA defects found

All four were real, all are fixed, and each has a regression test.

1. **`⌥⌘B` / `⌥⇧⌘B` did the wrong thing.** The Object ▸ Blend menu advertised
   them for Make/Release Blend, but the keyboard handler ignored `altKey` in its
   `case "b"` branch, so `⌥⌘B` ran **Paste in Back** and `⌥⇧⌘B` toggled the
   **bounding box**. Silent data-shaped damage: you press "make blend" and get a
   paste.
2. **`⌘N` was advertised but unbound.** File ▸ New printed `⌘N`; nothing
   listened.
3. **`⇧D` ran the wrong command, and `cycleDrawingMode` was unreachable.** The
   bare-`d` branch didn't check Shift, so Illustrator's "cycle Draw Normal ▸
   Behind ▸ Inside" hit `defaultFillStroke` instead. `commands.cycleDrawingMode`
   existed with no menu item and no key — dead except in its own unit test.
4. **`Ops.Blend.blend` silently no-opped on an existing blend.** A blend group
   carries no outline of its own, so selecting a blend + another object and
   running Object ▸ Blend ▸ Make found only one blendable end and returned
   `null`. Illustrator *extends* the blend. Root-caused in the op (release the
   existing blend back to its key objects first, then blend the flattened run),
   which fixes the menu command, the MCP path, and the new Blend tool at once.

### Defects found by the multi-agent hunt

A second pass fanned six readers across distinct subsystems and put every claim
through an adversarial verifier (refute-by-default). 18 claims, 17 survived. Each
one fixed below was **independently reproduced with a failing test first** — the
test is committed alongside the fix.

5. **Join and Make Compound Path moved the artwork.** Both concatenate their
   inputs in WORLD space, then splice the result into the first input's
   container. Inside a group carrying a transform, the ancestor transform is
   applied a second time: joining two paths in a group translated by (100,50)
   jumped the result to (200,100). Fixed with a shared `cancelAncestors()` helper
   at both splice sites.
6. **`releaseBlend` discarded the blend's own transform.** Move a blend, release
   it (or add a third object to it), and it snapped back to where it was
   originally made. The keys live in the group's space and were spliced out
   without composing `group.transform`. Pre-existing; the new Blend tool made it
   easy to hit.
7. **Area-type bounds were one ascent too high.** `estimateTextBounds` applied
   the point-text baseline offset to boxed text too, so an area-type object's
   selection rectangle, transform handles, align/distribute and **hit-testing**
   all sat 0.8 × fontSize above the painted box — a click just inside the bottom
   edge missed, a click above it in empty space selected.
8. **Area type ignored underline / strikethrough / All Caps / Small Caps.** The
   `foreignObject` branch builds its own inline style and simply omitted them, so
   they were stored, exported to SVG, and never rendered.
9. **Placed images silently dropped their effects.** The image branch emitted
   `filter="url(#fx_…)"` but never rendered `defs`, so the filter it pointed at
   did not exist — and a dangling filter reference renders unfiltered.
10. **Stacked effects discarded each other.** Feather, Outer Glow and Inner Glow
    re-read `SourceGraphic`/`SourceAlpha` — the *original* element — instead of
    the previous primitive's result, so a Drop Shadow under a Feather was
    computed and thrown away. The filter is now a real pipeline threading each
    stage's result into the next (still using `SourceAlpha` directly at the head
    of the chain, where it is equivalent and cheaper).
11. **Two tools treated a hover as a drag.** `onPointerMove` fires on every mouse
    move, button or not. Perspective Selection never cleared `ids` on pointer-up,
    so a later hover wrapped the artwork in *another* Perspective Group and left
    a transaction open. Pencil cleared its state only on pointer-up and had no
    `onDeactivate`, so switching tools mid-stroke left `startDoc` set and the
    next hover reverted the entire document to that stale snapshot — outside any
    transaction, so it could not even be undone.

Three of the seventeen were in code written earlier in this same session, and
are fixed: the envelope's Coons patch walked two of its four boundaries the long
way round the outline (every interior point mis-mapped — my own test missed it
because a rectangle's anchors sit exactly on the corners, where the map is exact
regardless); `expandAppearance` double-applied object-level effects;
and the blend transform bug above.

**Systemic guard:** `src/shortcuts-menu-parity.test.tsx` walks the entire menu
tree and, for every item carrying a `shortcut`, asserts that dispatching that
keydown through the real `useShortcuts` hook invokes *the same command* the menu
item runs. That is the fix for the class, not just the three instances — a menu
entry can no longer advertise a key that does nothing or something else.

## Illustrator divergences found in the tool rail

Artisan's letter shortcuts had drifted from Illustrator's on three keys, and the
dispatcher couldn't express Shift-variants at all (`shortcutToTool()` keyed a
bare lowercase letter, so `⇧B` and `B` were indistinguishable). Illustrator pairs
related tools on one letter throughout, so this blocked ~11 correct bindings.

Now keyed `shift+<key>` vs `<key>`, and realigned:

| Key | Was | Now (Illustrator) |
| --- | --- | --- |
| `B` / `⇧B` | Shape Builder / — | Paintbrush / Blob Brush |
| `E` / `⇧E` | Eraser / — | Free Transform / Eraser |
| `W` / `⇧W` | Warp / — | Blend / Width |
| `⇧M` | — | Shape Builder |
| `⇧R` | — | Warp |
| `⇧C`, `+`, `-` | — | Anchor Point, Add Anchor, Delete Anchor |
| `⇧P` / `⇧V` | — | Perspective Grid / Perspective Selection |
| `⇧L`, `⇧S`, `J`, `⇧O`, `⇧K` | — | Live Paint Selection, Symbol Sprayer, Column Graph, Artboard, Slice |

## Closed in this pass

### Tools

- **Curvature tool (`⇧~`)** — `src/tools/curvature.ts`. Click points; the path is
  continuously re-fitted as a smooth curve *through* them (Catmull-Rom tangents),
  no handle dragging. Alt-click drops a corner, clicking an existing point toggles
  smooth ↔ corner, clicking the first point closes, Enter/Escape finishes, and the
  whole draw is one undo step. Reuses the Pencil's spline fit, hoisted to
  `Path.smoothThrough` so both tools share one implementation.
- **Blend tool (`W`)** — `src/tools/blend-tool.ts`. Click one object then another
  to blend them; keep clicking to extend the chain (which is what surfaced defect
  #4 above).

### Object menu

- **Envelope Distort** — `src/engine/ops/envelope.ts`, the largest gap closed
  here. Modelled on the existing live-object pattern (`GroupItem.perspective`):
  an envelope group's children are *regenerated* distorted artwork while
  `envelope.sourceItems` keeps the undistorted originals.
  - *Make with Warp* — all seven warp styles, bending the selection inside **one
    shared box** (`WarpOptions.box`, new; Effect ▸ Warp stays per-object as in
    Illustrator).
  - *Make with Top Object* (`⌥⌘C`) — the frontmost selected object is consumed as
    the envelope outline and the rest are mapped into it through a **Coons
    patch**: the outline is split at its four extreme vertices into top/right/
    bottom/left boundary curves and blended bilinearly. A rectangular envelope
    over the same bounds is provably the identity map (tested).
  - *Envelope Options* — re-bends **from the originals**, so repeated edits never
    compound.
  - *Release* (`⌥⇧⌘C`) — restores the undistorted art, and puts the envelope
    outline back as a path for a top-object envelope.
  - *Expand* — keeps the distorted art, drops the metadata.
- **Expand Appearance** — flattens a multi-fill / multi-stroke appearance stack
  into one real object per entry, back-to-front, carrying per-entry opacity,
  blend mode, and effects; stroke entries become filled outlines. Objects with no
  explicit stack are left to Object ▸ Expand.
- **Align submenu** — the Object menu had Distribute but not Align, so the six
  align actions were panel-only.

### Edit menu

- **Find and Replace** — `src/engine/ops/find-replace.ts` + a Find & Replace
  panel. Match Case, Whole Word, document-or-selection scope, live match count.
  The needle is literal text (a typed `(` searches for a bracket), `$` in the
  replacement stays literal, and Replace All is one undo step.

### Type

- **Vertical type family** — Vertical Type, Vertical Area Type, and Vertical
  Type on a Path. The `writingMode` model was already complete end-to-end (SVG
  import/export, renderer, Character panel); only the tools that seed it were
  missing, so the three factories take a `writingMode` option and the rail's type
  flyout gains three slots.

### View menu

- **Snap to Pixel** — new `SnapSettings.toPixel`; rounds drawing and dragging to
  whole document units. Ranks below Snap to Grid and above Smart Guides.
- **Illustrator view shortcuts** now bound and advertised: `⌘R` Rulers, `⌘;`
  Show Guides, `⌘'` Grid, `⇧⌘'` Snap to Grid. (`⌘Y` is deliberately left as
  Redo's alias rather than taken for Outline mode — see open gaps.)

### Correctness fixes (each with a failing test written first)

- **`joinPaths` / `makeCompoundPath`** — new `cancelAncestors()` helper so a
  world-baked result re-parented into a transformed group stays put.
- **`releaseBlend`** — composes the blend group's own transform into each
  restored key.
- **`estimateTextBounds`** — area-type boxes start at the item origin, not one
  ascent above it, so selection/handles/hit-testing line up with the paint.
- **Area-type render** — honours underline, strikethrough, All Caps, Small Caps.
- **Image render** — emits the `<filter>` it references, so image effects work.
- **`buildEffectsFilter`** — threads each effect's result into the next instead
  of restarting from `SourceGraphic`, so stacked effects compose.
- **Stroke-align clip/mask** — uses the item's own winding rule, so an even-odd
  compound's holes are not clipped as solid.
- **Perspective Selection / Pencil** — gate the drag path so a hover can no
  longer create artwork or revert the document.
- **SVG path tokenizer** — arc large-arc/sweep flags are parsed as the single
  characters the spec defines, so the compact form real exporters emit
  (`a25 25 -30 0150 -25`) no longer yields NaN geometry.

### Test hygiene

- `render/appearance-stack.test.ts` rendered `ItemNode` with no `<svg>` ancestor,
  so React resolved the HTML namespace and logged a `<feGaussianBlur /> is using
  incorrect casing` warning on **every full test run**. The markup was always
  correct; the test now renders inside an `<svg>` as the canvas does, which both
  silences the noise and exercises the real namespace.

### Verified defects left open — now CLOSED

All five have been fixed, each reproduced with a failing test first:

- **`outlineStroke` ignored Align Stroke.** It always built a centred ribbon, so
  outlining an inside- or outside-aligned stroke moved every edge by half the
  stroke width away from what was on screen. It now clips the ribbon exactly as
  the renderer does — a 2×-width outline intersected with the shape (inside) or
  subtracted from it (outside) — so op and render agree by construction.
- **Change Case / Smart Punctuation corrupted rich text runs.** Both re-cased
  each run from scratch, so every run boundary looked like a word start
  (`"Hello"` split `"Hel"`+`"lo"` → `"HelLo"` in the renderer and the SVG export
  while `item.text` still read `"Hello"`). Both now carry the preceding
  character as context and rebuild `text` from the runs, so the two
  representations cannot disagree.
- **Editing existing text produced no undo entry.** Selection's double-click
  opened the "Edit Text" transaction and *then* switched tool — and the tool
  switch runs canvas-view's leaked-transaction guard, which cancelled that very
  transaction. The Type tool now opens it in `onActivate`, once it is actually
  live.
- **Emptying an existing text restored its content.** `finish()` rolled the
  transaction back whenever the text was empty. That is right for a stray click
  that just created an object and wrong for one the user deliberately cleared;
  it now only rolls back an object this tool created.
- **A failed open stripped the container.** `openBytes` released the courier
  before `importFile`, which throws on anything unreadable — so a failed open
  silently dropped every container entry Artisan does not author from the
  document that was still open. The courier is now released only on success.

Also closed: **the MCP transaction guard divergence.** Vision refuses MCP
handlers while an edit transaction is open; Artisan passed the generated
handlers through raw, so a tool call mid-drag force-closed the gesture's
transaction and the rest of it became unundoable. Artisan now enforces the same
contract at the single choke point.

## Open gaps, ranked

### Tier 1 — real capability gaps worth building next

1. **Image Trace** (Object ▸ Image Trace, + its panel). The single most-cited
   Illustrator feature absent here: raster → vector. Recommendation: implement in
   the shared Rust engine (`packages/engine`), which already rasterizes and has
   the imaging deps — a potrace-style path tracer over a thresholded/posterized
   bitmap, exposed as one wasm entry point returning path data. Multi-day.
2. **Type ▸ Create Outlines (`⇧⌘O`)**. Blocked on *font bytes*: Artisan renders
   text as SVG `<text>` with CSS families and never loads a font file, and no web
   API returns glyph outlines. The engine already depends on `ttf-parser` +
   `rustybuzz` and has `register_vector_font` — so the path is: read the font via
   Tauri fs, register it into the engine, add a `vector_text_outlines` export
   returning per-glyph path `d`, and build a compound path. Chunky but well-defined.
3. **Recolor Artwork**. Color Guide and Edit Colors exist; the Recolor dialog
   (global color-group remap, harmony-locked editing) does not.
4. **Object ▸ Text Wrap**. Area text is laid out by the browser inside a
   `<foreignObject>`, so the natural implementation is a floated element with
   `shape-outside: polygon(...)` derived from the wrap object's outline. Caveat
   worth stating up front: CSS floats wrap on **one** side, so an object in the
   middle of a column won't push text both ways — partial fidelity, decide
   whether that is acceptable before building.
5. **Effect ▸ 3D** (Extrude & Bevel, Revolve, Rotate). Large, self-contained.

### Tier 2 — smaller, well-scoped

6. **Effect ▸ Apply Last Effect / Last Effect**. Cheap in principle, but the
   13 effect commands would each need to record `{name, args}` into a new
   ephemeral `lastEffect` state (mirroring `lastTransform`). Note the shortcut
   collision: Illustrator uses `⇧⌘E` / `⌥⇧⌘E`, which Artisan currently gives to
   Export PNG.
7. **Guides are not repositionable.** `render/guides.tsx` draws them
   `pointerEvents="none"`, so a guide can only be created and cleared, never
   dragged. This also makes View ▸ Lock Guides meaningless — build the drag
   first, then the lock. Release Guides has no sensible mapping until guides can
   carry their source geometry.
8. **Type menu**: Threaded Text, Area Type Options, Fit Headline, Show Hidden
   Characters, Optical Margin Alignment.
9. **Isolation mode** (double-click a group to edit it in isolation) and
    **Global Edit**.
10. **Missing panels**: Artboards, Navigator, Glyphs, Transparency, Info,
    Pattern Options.
11. **Remaining tools**: Shaper, Touch Type, Join, Path Eraser, Print Tiling.
12. **File menu**: Document Setup, Revert, Save a Copy, Place, Open Recent,
    Package (the panel exists; the menu entry does not), Print.
13. **`⌘Y` (Outline mode)** is Illustrator's binding but is currently Redo's
    alternative here. Changing it would break a redo habit — decide deliberately.
14. **Effect submenus**: Pathfinder effects, SVG Filters, the Photoshop effect
    gallery. Object ▸ Create Object Mosaic.

### Non-goals

Cloud/ecosystem surface — Adobe Stock, Libraries, Bridge, Version History,
Comments, cloud documents — is out of scope for a local-first app.
