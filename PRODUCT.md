# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS, hand-authored, delivered as `index.html` plus sibling `icons/` and
`shots/` directories. Confirmed by the user for the public progress page: the folder is
uploaded as-is to an existing website, so the page must not require a build step,
a bundler, or a runtime dependency.

- `site/` is exactly the publish folder — `index.html`, `icons/` and `shots/`,
  nothing else.
- `scripts/site/build.mjs` + `progress.json` generate it (`node scripts/site/build.mjs`)
  and are deliberately kept out of the publish folder. Regenerating is how the
  numbers get updated; the markup is not hand-edited.

## Users

The public progress page is written for **developers and contributors** — engineers
evaluating how mature the Monet codebase is and looking for where they could help.
They read it to answer three questions: which apps are real, how well tested each
one is, and where the gaps are. They are comfortable with source-level facts (test
counts, engine architecture, format support) and are put off by marketing language.

The Monet apps themselves serve desktop creative professionals, but they are not
the audience for this surface.

## Product Purpose

Monet is a suite of seven liquid-glass desktop creative applications built as one
pnpm + Cargo monorepo (`monet-core`). Each app targets an established professional
tool: Vision↔Photoshop, Artisan↔Illustrator, Cinema↔Premiere Pro, Rythme↔Audition,
Jouer↔Unity 2D, Anime↔After Effects, Galerie↔Lightroom Classic.

The progress page exists so that anyone outside the project can see the true state
of each app without cloning the repo. Success is a developer forming an accurate
impression of maturity — including the unflattering parts — in under a minute.

## Positioning

Seven professional-class creative apps that share one design system, one render
engine, one document format, and one agent-control surface. A competitor could copy
any single app; the shared substrate across all seven is the part that is not
copyable piecemeal:

- **Monet UI** — a single design system (dark liquid-glass chrome, per-app accents)
  dresses every app, so the suite reads as one product.
- **One merged Rust/WASM engine** (`packages/engine`) serves both raster (Vision)
  and vector (Artisan) work; a vector layer is a `kind`-3 layer rasterized on demand
  into the raster compositor.
- **A universal `.monet` / `.monetgfx` document** moves work between apps.
- **A generated MCP surface per app**, so an MCP client can drive the live desktop
  app; new features gain agent control by annotation plus codegen.

## Operating Context

- Tauri 2 + Vite + React per app; each `src-tauri` is a standalone Cargo workspace.
- Apps are transparent, decorationless, native-vibrancy desktop windows — all chrome
  is drawn by Monet UI, tinted by a per-app accent.
- Dev ports are one per app (vision 1420 … galerie 1426) so two apps can run side by
  side, because every interop feature is a two-app feature.
- Verification is `vitest` unit suites per app, Playwright e2e in Vision/Cinema/Jouer,
  node-based e2e scripts in Artisan/Rythme, and proof scripts in Galerie.

## Capabilities and Constraints

Confirmed, measured on 2026-09-20 by running each app's `test:unit` suite:

| App | Unit tests | Test files | Result |
| --- | --- | --- | --- |
| Vision | 5367 | 484 | all passing |
| Artisan | 2155 | 418 | all passing |
| Rythme | 1468 | 148 | all passing |
| Galerie | 1353 | 165 | all passing |
| Jouer | 440 | 25 | all passing |
| Cinema | 117 | 12 | all passing (unit only; e2e is separate) |
| Anime | 21 | 3 | all passing |

Constraints the page must respect:

- **Publish the real numbers, including the weak ones.** The user explicitly chose
  to show all seven apps unflinchingly; thin apps must read as thin. Credibility is
  the point of the surface.
- Per-app feature percentages are **judgements**, produced by a source-level audit
  and an adversarial verification pass, not instrumented coverage. The page must not
  present them as measured coverage.
- No build step, no external network dependency at runtime.

Undecided / not established: license, pricing, download availability, release dates,
company identity, and any public URL. None of these may be invented on the page.

## Brand Commitments

- The name **Monet**, and the per-app names Anime, Artisan, Cinema, Galerie, Jouer,
  Rythme, Vision.
- **Monet UI is the established visual world** and this page inherits it rather than
  inventing a replacement: dark desktop tones (`--desktop-0: #0b0e14`), three glass
  depths, hairline strokes, `--radius-window: 14px`, and the four accent identities
  defined in `packages/monet-ui/packages/monet-core/tokens.css`:
  - raster `oklch(0.78 0.14 200)` — cyan
  - vector `oklch(0.80 0.14 70)` — amber
  - audio `oklch(0.74 0.16 305)` — violet
  - motion `oklch(0.75 0.18 350)` — magenta
- The existing app icon family: squircle icons with a per-app color gradient and a
  white glyph, in `apps/<app>/src-tauri/icons/`.

## Evidence on Hand

- Real, shipped app icons at `apps/*/src-tauri/icons/128x128@2x.png` (256px) — all
  seven distinct. Galerie previously shipped a byte-identical copy of Anime's icon;
  it now has its own, built 2026-08-04: a white photo-stack glyph on a diagonal
  gradient measured at `#567eef` (cornflower blue) → `#d8dcde` (silver). Its ladder
  was checked numerically against the siblings and matches them to within 1px on
  every geometry the family uses — the loose PNGs' 93.75% squircle and 3px shadow
  bleed, and the `.icns` 81.93% Apple icon-grid inset. Note those are two different
  insets; an `.icns` built at the PNG's 93.75% renders ~14% oversized in the Dock.
- Real per-app READMEs describing implemented features and explicit roadmap gaps.
- Real measured test results (table above).
- Real design tokens in `packages/monet-ui/packages/monet-core/tokens.css`.
- **Real app screenshots** at `site/shots/*.webp` for all seven apps. Six were captured
  2026-08-04 from each app's own built web bundle (the same React UI the Tauri window
  hosts), served locally and photographed with Playwright at 1920×1120 @2x. They are
  captures, never composites or mock-ups. Where a document was needed to make the app
  show its real work, it was created **through the app's own API or UI** — Vision opens
  an image and carries adjustment layers, Artisan's shapes were drawn with its own
  tools, Cinema's clips came from its `+ Color` / `+ Title` sources. The sample artwork
  inside those documents is synthetic demonstration material; the interface around it,
  and every panel reading off it, is real.
  - **Galerie's is a native capture**, not a browser one — its catalogue is served over
    Tauri IPC, so a browser build can only ever render "Catalog unavailable". The real
    app was built and run, twelve photos imported through its own MCP `library.import`
    verb, then rated and flagged through `photo.rate` / `photo.flag`, and the window
    photographed by CGWindowID so nothing else on the desktop could enter the frame.
  - **The photos in Galerie's catalogue are CC0 / public domain**, fetched from
    Wikimedia Commons (Unsplash and Pixabay imports) with the licence read off the
    Commons API for each file and recorded in a manifest. No attribution obligation and
    no share-alike, which is why they are safe on a public page. They are deliberately
    NOT from the user's own photo folders.
- **Absent, and not to be fabricated:** user counts, download links, performance
  benchmarks, testimonials, and release dates.

## Product Principles

1. **Measured beats claimed.** Every number on a public surface traces to a file or
   a command that was actually run; anything judged is labelled as judged.
2. **The weak rows stay in.** Showing an app at 20% next to one at 90% is what makes
   the 90% believable.
3. **One substrate, seven faces.** Shared engine, format, design system and MCP
   surface are the product; the apps are its expressions.
4. **The suite dresses itself.** Monet UI is the visual authority for anything the
   project ships, including its own website.
5. **Gaps are addressable work, not embarrassments.** The audience is looking for
   where to contribute, so name what is missing precisely.

## Accessibility & Inclusion

No product-specific standard has been established. The page follows ordinary web
baselines: text contrast ≥4.5:1, meaningful focus states, content legible without
color alone (progress is stated numerically as well as visually), and full keyboard
operability.
