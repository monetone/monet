# 10 — monet-photo: share the photo libraries between Vision & Galerie

Authored 2026-07-20 from a 6-agent read-only scout; **revised same day after a
6-agent adversarial review** (every load-bearing claim re-verified against the
tree at `98f8e33`) **plus an improvement-suggestions scout**. Line counts are
source LOC (tests move alongside but are not counted). File anchors cite the
*current, pre-rename* `monet-develop` / `monet-develop-core` locations; Phase 0
renames them and later phases use the `monet-photo` names.

## TL;DR — the headline verdict

**The shared photo package already exists and is under-used.** `@monet-ui/
monet-develop` declares itself "framework-free photographic develop math +
canonical develop-recipe/mask-graph schema, shared by the Monet photo apps
(Vision, Galerie)" (`src/index.ts:1-4`) and Galerie depends on it (37 files,
~84 imported symbols). **Vision imports it zero times** — it maintains private
copies (five byte-identical) and a parallel develop codec
(`state/cameraRaw.ts`, 1241 LOC). So this refactor is mostly **making Vision
adopt the existing shared package, collapsing duplicates, and carving new
sibling packages** — not building `monet-photo` from scratch.

Two things make it worth doing beyond tidiness:

1. **Real correctness bugs (verified, §6).** (a) Galerie's native full-res
   export runs a different Rust develop path whose serializer
   (`recipe_to_legacy_params`, `develop.rs:66-138`) emits only the 1086-float
   prefix — so **heal/clone spots, Point Color, calibration, and the camera
   profile are absent from every natively exported 16-bit TIFF and Linear
   DNG** (the kernels never receive a tail to parse; `apply_bounded` tops out
   at index 1085). (b) **Worse and broader: local masks are dropped by EVERY
   export route** — JPEG/PNG/Web/Print included — because mask compositing
   exists only in the Develop preview loop (`DevelopView.tsx:281-311`);
   `developToImage` (`export.ts:145-164`) never applies it. Fixing (a) is the
   Rust-core unification below; fixing (b) additionally needs Galerie app work
   (and aiSubject masks use cached raster coverage that *cannot* ride the
   parametric tail — they need a coverage-upload channel).
2. The engine ABI is **already unified** — both apps drive the same wasm
   `camera_raw_develop(&[f32])` with the same 1086-float array — so the hard
   part (the pixel contract) is done; the divergence is in the TS serializers
   and the recipe schemas above it.

**Effort:** Phases 0–4 are ~2–3 weeks total (delete ~500+ duplicated source
lines, add pure-gain packages, land the enablers). The develop-codec
unification (§5) and the Rust-core unification (§6) are each a multi-week
project with hard ABI/persistence invariants — schedule them separately, last.

## The `monet-photo` family (target architecture)

"monet-photo" is the **photo-domain package family**. Its anchor is the
existing shared develop package and its Rust crate, **renamed** to
`monet-photo` / `monet-photo-core` — no package keeps the "develop" name
(decided 2026-07-20). Shape (TS packages under
`packages/monet-ui/packages/`, framework-free ESM, tests co-located):

| Package | Holds | Status |
|---|---|---|
| **monet-photo** (anchor; rename of `monet-develop`) | canonical `DevelopRecipeV2` schema + `recipeToParams` flat-ABI serializer + mask graph + tone curve + develop math | **exists** (Galerie uses it); rename, grow it, make Vision adopt it |
| **monet-color** (new) | ICC/profile/proof/color-management policy, soft-proof + gamut math, display/proof LUT sampling, color-lookup, gradient-map, color-space + swatch primitives | **new** — ~1360 LOC lifted from Vision; Galerie has none (pure gain) |
| **monet-imageio** (new) | client-side image-format codecs, split into a **node-safe entry** (TGA/PNM/PCX/PDF-build/SVG-export/ACO/ASE/ACT, ~650 LOC, zero deps) and a **browser entry** (AVIF/WebP/SVG-rasterize/PDF-import — DOM canvas + wasm deps) | **new** — ~900 LOC lifted from Vision; Galerie has none (pure gain) |
| **monet-scopes** (new, small — decided: its own package, keeps monet-photo node-pure) | vectorscope/waveform canvas-draw + IRE/graticule math (currently hand-synced Vision↔Artisan) + the shared U2-Net pre/post tensor math | **new/small** — kills the "keep the two copies in sync" duplication |
| **monet-photo-core** (Rust anchor; rename of `monet-develop-core`) | native develop recipe codec + pixel kernels + `DevelopFrame` interchange + provenance | **exists** (Galerie backend); rename; make the wasm engine depend on it too (§6) |

Naming: the anchors are renamed in Phase 0 so no package carries "develop";
the siblings already avoid it. Internal *symbols* keep their names
(`DevelopRecipeV2`, `develop_in_place`, and especially the frozen wasm-bindgen
ABI method `camera_raw_develop` — renaming that is a breaking change and out
of scope; symbol renames are a separate optional cleanup).

## Invariants — must hold at EVERY phase

1. **Frozen engine ABI.** The 1086-float param layout + advanced-tail magic
   `22026` + acceptance of tail versions v1/v2/v3 (`raster/mod.rs:23508-23514`)
   stay byte-frozen. A wrong offset is *silent visual corruption*.
2. **Persisted formats keep parsing.** The flat tail is stored inside Vision
   `.mvision` fid-17 smart-filter payloads (`store.ts:3204`, authoritative on
   reopen via `syncCameraRawRecipeFromEngine`) and Galerie catalog recipes
   (`canonical_recipe_json`, keyed by `PROCESS_VERSION`). Every migration must
   round-trip every stored recipe/preset/snapshot/sidecar.
3. **Untrusted-JSON stays hardened.** MCP `adj.cameraRawRecipe` and XMP ingest
   untrusted JSON; Vision's `normalizeCameraRawRecipe` is a hardened trust
   boundary (bounded strings, clamps, collection caps —
   `cameraRaw.ts:44-58,923`). monet-photo's `normalizeRecipe` is shallow
   (bare `mergePanel` spread; masks accepted wholesale) — **port Vision's
   hardening before any untrusted consumer migrates.**
4. **Render-locus split (updated 2026-07-20 — narrower than first written).**
   Galerie now emits profile, calibration, heal/clone spots, and Point Color
   into the engine tail (`developParams.ts:158-242`); the TS-vs-engine split
   is only **crop + local masks + Enhance**. The unified serializer's
   per-caller mode flag gates exactly those three — emitting both TS-crop and
   engine-crop would double-render (corruption).
5. **Engine golden stays green.** Guard every ABI-adjacent change with the
   golden harness (`monet-develop-core/examples/wasm_golden.rs` + the Galerie
   proof bins and `.mjs` proof scripts). Phases 5 and 6 **share** the canonical
   fixture, `wasm_golden`, and `verify-engine-format-baseline`'s source-hash
   list — whichever phase lands second must re-bless them; never run 5 and 6
   concurrently.
6. **Vendored, not a submodule.** `packages/monet-ui` is vendored in-tree
   (AGENTS.md: "the full Monet UI repo, vendored (no submodule)"; no
   `.gitmodules`, no gitlinks). Package moves/renames are **ordinary monorepo
   commits**. Two surviving obligations: keep monet-ui packages generic /
   app-agnostic, and if changes are ever synced outward to the separate
   `legoless/monet-ui` repo, that is a manual out-of-band step — confirm with
   the user first.

## Phased roadmap (strict risk order — cheapest, safest first)

### Phase 0 — rename the anchors + enablers (~1–2 days, mechanical)

**Preconditions:** remove the three stale `.worktrees` checkouts
(`galerie`/`artisan`/`rythme` — all clean, all branches fully merged into
main; the galerie worktree still contains the old forked engine and would
pollute rename searches). Exclude `.worktrees/` from any repo-wide sed.

**(a) Rename** `packages/monet-ui/packages/monet-develop` → `monet-photo` and
`packages/engine/crates/monet-develop-core` → `monet-photo-core`. Touch list
(verified complete):
- package/crate names; engine `[workspace] members`
  (`packages/engine/Cargo.toml:67`); Galerie path dep
  (`apps/galerie/src-tauri/Cargo.toml:57`); Galerie's 37 importing files +
  its `package.json` dep key; the shared package's own `package.json`
  metadata; the native `use monet_develop_core` sites (`raw_decode.rs`,
  `develop_job.rs`, `catalog.rs`, `linear_dng.rs`, `tiff_export.rs`, the proof
  bins, `wasm_golden.rs`).
- **The three `include_str!` fixture paths inside the Rust crate**
  (`develop.rs:204,252`, `recipe.rs:1268` → the monet-ui path segment changes)
  — missing these breaks the crate build.
- **The three Galerie proof/gate `.mjs` scripts** that hardcode crate/fixture
  paths (`shared-core-wasm-proof.mjs:10,22`,
  `verify-engine-format-baseline.mjs:33-36`, `require-engine-proof.mjs:20`) —
  these are the golden gates themselves; re-run `test:shared-core-wasm` +
  `test:engine-require` as part of the Phase 0 gate.
- Docs sweep + lockfiles regenerated by `pnpm install` / a cargo build (never
  hand-edited).
- **Decision (made): persisted provenance strings stay byte-frozen.** The
  `createdWith: "monet-develop/2"` / `"monet-develop-core/1"` strings are
  persisted *data*, embedded in byte-exact goldens
  (`canonical-recipe-v2.json`, `proofs/shared-core/recipe-v2.json`) — exclude
  them and the golden JSONs from the mechanical rename.

`pnpm-workspace.yaml` globs and root `build:libs` (`@monet-ui/*` filter) are
name-agnostic — **no wiring needed** for renamed or new packages beyond each
app's dependency line.

**(b) Vision dependency edge:** add `@monet-ui/monet-photo: workspace:*` to
`apps/vision/package.json`. No code moves yet.

**(c) Test/lint gates become real** (today the root gate silently skips the
refactor's own packages): add `"test:unit": "vitest run"` aliases to the seven
packages that only define `test` (incl. **galerie** and **monet-photo**);
give galerie an eslint config (clone Vision's); require
lint/test:unit/typecheck scripts in every new package from its first commit;
fix the stale `pnpm-workspace.yaml` header comment.

**(d) Minimal CI:** one GitHub Actions workflow — `pnpm install`,
`pnpm typecheck`, `pnpm test`, plus `cargo test` in `packages/engine`,
`packages/engine/crates/monet-photo-core`, and `apps/galerie/src-tauri` when
Rust paths change. No matrix, no release lanes. (There is currently **no CI at
all**; without (c) first, CI would green-light while never running the
packages this plan touches.)

**(e) Capture the Vision ABI golden NOW, not in Phase 5:** build one maximal
recipe (every panel non-default; masks incl. kind-8; heal/clone; Point Color;
calibration; profile), serialize with the *untouched* `cameraRaw.ts`, and
commit the exact float array as a fixture + replay test (mirror the
`canonicalFixture.test.ts` pattern). **Capture the round-trip too:** run the
float array back through `cameraRawParamsToRecipe` and pin the recovered
recipe — fid-17 read-back (params→recipe) is the direction that must stay
bit-stable through Phase 5, and a one-way golden wouldn't guard it. Captured
before any refactoring, this is the executable contract Phase 5 migrates
against and the drift guard for the Phase-5 window. ~1 hour.

**Gate:** galerie typecheck + its 586-test vitest suite + `cargo test` in
`apps/galerie/src-tauri` (~220 `#[test]`s) and `monet-photo-core` (12) + the
shared golden + the two `.mjs` proof gates.

### Phase 1 — collapse Vision's byte-identical copies (~1–2 days, near-zero risk, ~500 source LOC deleted)

`diff -q` re-verified identical on the current tree — delete and re-import:
`state/cubeLut.ts` (145), `histogramStats.ts` (38), `histogramReadout.ts`
(29), `rgbLab.ts` (37), `rgbCmyk.ts` (25). Reconcile the near-duplicates:
`channelHistogram.ts` (keep Vision's 4-line `HistScope` union app-local —
store.ts + Panels.tsx consume it — adopt the shared binning) and
`toneCurve.ts` (Vision's 55 LOC is a literal line-prefix of the shared 103;
adopt the superset and delete the local `parametricCurvePoints`/
`compileCurveLuts` re-declarations at `cameraRaw.ts:1171-1241`, ~71 LOC).
Repoint `state/app.ts:71` + `cameraRaw.ts:37`; fix the path-reading test
`localImportWiring.test.ts:6`. **Done:** Vision imports monet-photo for real;
`cameraRaw.test.ts` + shared tests stay green.

### Phase 2 — new `monet-color` package (~3–5 days, pure gain, ~1360 LOC)

Lift the framework-free color/proof math (all 15 candidate files verified
clean of Tauri/DOM/store imports): `colorManagement.ts` (485),
`engine/proof.ts` (181 — pure math despite its location), `displayLut.ts`
(88), `colorLookup.ts` (154), `gradientMap.ts` (201) + the small primitives
(`colorRamp`, `rgbHsb`, `colorFormat`, `colorSamplers`, `swatches`,
`defaultColors`, `clippingOverlay` ≈ 250). **Excluded (keep in Vision):**
`autoLevels`/`equalize`/`ntscColors` (337 LOC) — they are *test-only mirrors
of Vision's Rust engine* with zero non-test importers; moving them couples the
shared package to Vision engine internals for no reuse. Re-home the type-only
`HSV` import (`colorRamp.ts:8`, `defaultColors.ts:9` ← currently from
monet-react): define it in monet-color and have monet-react re-export.
Fan-out is modest: ~25–30 import sites, concentrated in `store.ts`/`app.ts`.

### Phase 3 — new `monet-imageio` package (~3–4 days, pure gain, ~900 LOC)

The real extraction constraint is **not** native-reader injection — no codec
file touches Tauri or `nativeBoundedRead` (that wiring lives in `app.ts`,
which stays). The genuine blockers, and the design that resolves them:
- **Node-safe default entry** (zero deps, extract as-is): `tga` (115), `pnm`
  (101), `pcx` (108), `pdf`-build (40), `svgExport` (22), `aco` (92), `ase`
  (113), `act` (58) — `aco`/`ase` import only sibling `swatches` (Phase 2).
- **Browser entry** (owns the DOM/canvas work + deps): `avif`+`avifDecoder`
  (DOM canvas + `@jsquash/avif`), `webpEncoder` (`@jsquash/webp`),
  `svg`-rasterize (Image + canvas), `pdfImport` (`pdfjs-dist` + canvas).
  These use **Vite-only `?url` wasm/worker imports** incompatible with the
  tsup/plain-ESM package convention. **Decided approach:** the shared codec
  APIs take an **injected decode/encode function**, and the Vite-specific
  wasm/worker glue (the `?url` imports, ~25 LOC each) **stays app-side** —
  each app passes its own loader in. This keeps the package plain-ESM with no
  bundler coupling; the three npm deps (`@jsquash/avif`, `@jsquash/webp`,
  `pdfjs-dist`) move to whichever side ends up importing them (the glue side).
- **`heic` is not a codec** — a 10-line extension regex; decode is a native
  Tauri plugin per-app. Leave it in Vision (or move the regex with an
  annotation).

### Phase 4 — shared scopes + collapse the ports (~2–3 days, low risk)

Fold Vision's `state/vectorscope.ts` + `waveform.ts` and Artisan's hand-synced
`vectorscope-draw.ts` + `waveform-draw.ts` into one shared module (Vision +
Artisan consumers; Galerie when it adds scopes). Collapse the Galerie↔Vision
ports that are **code-identical modulo header comments**:
`detectDustSpots.ts`, `visualizeSpots.ts`. Lift Galerie's `u2net.ts` pre/post
tensor math **into `monet-scopes`** (decided — apps cannot cross-import, so a
shared destination is required, and keeping it out of monet-photo keeps the
anchor node-pure) and repoint both Galerie and Vision's `ml/onnx.ts segMask`
at it. **Do NOT** touch the
genuinely-drifted trio `straighten`/`cropAspect`/`autoTone` (different
signatures/coordinate models — a separate product decision).
**Definition of done for the dedup arc:** `rg "keep the two copies" apps/`
returns zero. Standing rule thereafter: any knowingly-created hand-copy ships
with a checksum-lockstep test (the `modelRegistry.test.ts` pattern).

### Phase 5 — unify the develop codec (the headline; high-risk, own project, ~4–6 weeks)

> **STATUS 2026-07-21 — ALL of (a)–(e) DONE. Phase 5 complete (and thus the whole plan).**
> Commits: continuous `optics.aberration` superset + legacy migration (`0d29838`);
> V2 `crop` flips + `enhance` superset (`f4f6dbb`); Vision's `recipeToParams`
> delegates to the shared `monet-photo` codec, deleting the duplicate encoder
> (−134 LOC) (`06fe8c2`). Earlier steps ported profile/calibration/heal/point-color/
> geometry into the tail + built the `visionV2` tail (masks/crop/enhance) behind a
> `tailFormat` mode flag (invariant #4: Galerie's default tail zeroes crop/masks/
> enhance — no double-render). **Phase gate MET:** the frozen Phase 0(e) ABI golden
> (masks+pointColors+crop+enhance+aberration+geometry+calibration+heal composed) is
> reproduced byte-exact by the delegated serializer; native==wasm proof 11 cases
> green; full Vision suite 2710/2710; galerie 581; `monet-photo-core` cargo green.
>
> **PROCESS_VERSION NOT bumped (deliberate deviation from (a)'s letter).** The bump
> is unnecessary and would violate invariant #2: the schema growth is additive +
> render-preserving (11-case native==wasm byte-identical) + digest-stable
> (`normalizeRecipe` keeps a legacy recipe's boolean verbatim, never rewrites stored
> canonical JSON) + back-compat (`recipe.rs` accepts legacy `removeChromaticAberration`
> as `Option<bool>`; test `legacy_remove_chromatic_aberration_still_parses_and_migrates`).
> `recipe.rs` hard-rejects `n != PROCESS_VERSION`, so bumping to 7 would *reject*
> every existing `n=6` catalog recipe absent a 6→7 migration, and `cache_identity`
> would force-invalidate every cached preview — for zero render change. Bump only if
> a future Phase 5 change is genuinely render- or digest-affecting.
>
> **(b) `0327d48`** — ported Vision's normalize hardening into monet-photo's
> `normalizeRecipe` via a `sanitizeRecipe` pass, as a proven no-op for every valid
> recipe (superset clamps covering both Galerie's LR-integer envelope and Vision's ±1;
> digest pin + Galerie corpora + XMP unchanged), bounding only hostile input.
>
> **(c) `253d03f`** — canonical `migrateVisionV2` in monet-photo (Vision's schema-2 →
> V2 map, deduped: `visionRecipeToV2` is now a 2-line delegate) + fixed the
> `normalizeRecipe` dispatch that misclassified Vision schema-2 recipes as legacy v1
> (silently dropping every advanced panel).
>
> **(d)/(e) — Vision's internal state migrated onto `DevelopRecipeV2` via a
> working-type strangler** (the atomic 90-site type-flip was declined twice as
> un-one-shot-able; decomposed into committable green slices): `ab37612` d1
> (`ToneCurvePanel.compiledLuts?` homes the Vision curve-LUT decoupling in the shared
> codec — the post-step note above is thus SUPERSEDED, the quirk is now a proper
> additive field, absent on Galerie); `bac25e7` d2a (`VisionDevelopRecipe` working type
> = V2 + optional UI ids + byte-exact engine seams); `bba1bf7` d2b (store runtime holds
> the working recipe, `source.recipe` kept as a transitional Canonical projection so
> consumers migrate one at a time); `e12366f` d2c (`CameraRawWorkspace` 17 hooks → V2
> panels); `40f0ad5` d2d+e (`CameraRawSource.recipe` + XMP sidecar + envelope + presets
> + MCP → V2; retired the Canonical projection + transitional inverse). Persistence
> loads route through `normalizeWorkingRecipe` (migrates old Canonical schema-2 AND new
> V2), and per-surface invariant-#2 tests prove existing `.mvision`/XMP/preset files
> load byte-identically. Kept in Vision (per plan): the flat codec
> `paramsToRecipe`/`parseAdvancedParams` (only params→recipe decoder; used at the engine
> read-back seam). Every slice gated: engine byte-exact + full Vision suite (2723) +
> galerie 581 + native==wasm proof. **Intended behavior change:** an unknown future
> `schemaVersion` MCP/persistence payload is now migrated/clamped rather than
> hard-rejected (still bounded; MCP keeps a non-object guard). **Follow-up:** an
> eval-safe circular import (`cameraRaw` ↔ `visionDevelopRecipe`) to tidy.

Retire `apps/vision/src/state/cameraRaw.ts` (1241 LOC) by growing the renamed
`monet-photo` into the single codec. **Scoping decision this estimate depends
on:** `DevelopRecipeV2` gains Vision's **engine-mask record types verbatim**
as the engine-mode mask representation (9 kinds incl. bidirectional-gradient
and outline, pressure points, uncropped-source geometry, `MASK_KIND_CODES`
layout). V2's `MaskGraph` (combine-mode graphs, brush dabs, crop-relative
geometry) and Vision's engine-tail masks are **mutually non-supersets**, and
the frozen tail cannot encode a combine graph — MaskGraph↔engine-mask
*unification* is explicitly **out of scope** (its own future decision, or
Phase-6-scale tail-v4 work). If unification is pulled in scope, this estimate
is void.

The work:
- **(a) Engine-render mode in `recipeToParams`:** emit crop + engine-masks +
  Enhance into the tail when `mode:'engine'` (Vision), zeroed when
  `mode:'ts'` (Galerie, unchanged — profile/calibration/heal/Point Color are
  already emitted in both modes). Add a continuous chromatic-aberration field
  to `optics` (Vision's is 0..1 at p[1051]; Galerie's is a bool).
  **Coordinated Rust change required:** `monet-photo-core`'s recipe parser
  uses `deny_unknown_fields` and hard-rejects `process_version` mismatch — a
  schema field addition means a lockstep `recipe.rs` update + **PROCESS_VERSION
  6→7 bump** with the same preview-cache-invalidation checklist as Phase 6
  (per `cache_identity.rs` semantics — MVSN is untouched by this phase).
- **(b) Port Vision's `normalizeCameraRawRecipe` hardening** into
  `normalizeRecipe` (invariant #3) — before MCP/XMP migrate. **Galerie blast
  radius:** `normalizeRecipe` is shared — Galerie's catalog recipes, XMP
  presets, and MaskGraph shapes all flow through it, and Vision's caps were
  designed for Vision's mask taxonomy. The ported caps/clamps must be verified
  against Galerie's existing golden/proof corpora (catalog fixtures,
  `proofs/shared-core/recipe-v2.json`, XMP round-trips) so nothing Galerie
  previously accepted is rejected or altered.
- **(c) Extend the migration — the shipped `migrateV1ToV2` is a trap as-is:**
  its auto-detect (`version == null && "geometry" && "hsl"`) **misclassifies
  Vision's current schemaVersion-2 recipes as legacy v1**, and `CameraRawV1Like`
  carries only the scalar core — profile, calibration, crop, heal, masks,
  enhance, pointColors, and real curve points are silently dropped. Add a
  `migrateVisionV2` path (or extend V1Like) covering the full schema-2
  surface, fix the dispatch to key off `schemaVersion`/advanced fields, and
  gate on round-trip tests over recipes containing **every** advanced panel
  (the Phase 0(e) golden is the input).
- **(d) Migrate Vision internals** (Store, `CameraRawWorkspace`,
  `projectEnvelope`, MCP `adj.cameraRawRecipe`, `cameraRawSidecar`) onto
  `DevelopRecipeV2` + the shared serializer, keeping `cameraRaw.ts`'s flat
  codec as a thin compat adapter so fid-17 read-back stays bit-stable
  (Vision's `cameraRawParamsToRecipe` is the only flat→recipe parser anywhere
  — the shared package never reads params back).
- **(e) Compat shims — migration targets, exhaustively:** fid-17 flat
  payloads; `.mvision` envelope source recipe **+ per-snapshot recipes**;
  XMP sidecar recipe **+ snapshots**; the localStorage user-preset library;
  MCP input (keeps accepting the old JSON shape via normalize+migrate — the
  manifest doesn't encode the recipe schema, so the codegen contract is safe;
  still run `mcp:codegen` + `mcp:check` if the wrapper changes). Vision's
  private-JSON XMP keeps reading; switching *writes* to Adobe-CRS for
  Lightroom interop is a product decision, not this refactor.

Field-name traps (same engine slots, different names — mappings already
encoded in `migrateV1ToV2`): grain `[amount,highlight,intensity]` (Vision) vs
`[amount,grainRoughness,grainSize]`; nr `[strength,color,detail]` vs
`[nrLuminance,nrColor,nrLuminanceDetail]`. Gate the whole phase on the
Phase 0(e) golden proving bit-exact params both ways.

### Phase 6 — unify the Rust develop core (fixes the export bugs; own project)

> **STATUS 2026-07-21 — DONE (by this section's own definition of done).** 6a
> landed (`22a267b`): the develop section is now `raster/develop.rs`, byte-verbatim,
> 1066/0 engine tests. 6b's **acceptance proof passes**: `shared-core-develop-proof.mjs`
> (`867cf32`…`d64795e`) develops advanced recipes through BOTH pipelines and
> asserts native `develop_in_place` == wasm `camera_raw_develop(recipeToParams(recipe))`
> **byte-for-byte** (tighter than the tolerance below) across 11 cases —
> profile/calibration, heal/clone, Point Color, geometry, all composed, the
> monochrome arm, and cap/edge values. Native full-res export now applies every
> engine-tail feature it previously dropped.
> **Mechanism nuance:** rather than the literal single-impl extraction below,
> the native tail is a *verbatim copy* in `monet-photo-core/src/develop_advanced.rs`
> kept in lockstep with the wasm tail by the parity proof every run — so the
> dual-impl **drift this plan exists to kill is killed** (the proof is the gate),
> even though the two impls aren't yet one. Collapsing them to a single shared
> module is an optional cleanup whose goal is already met; it needs unifying the
> whole helper closure (color/sample_bi are shared with each crate's divergent
> basic-develop), so it's deferred as low-value/no-new-behavior.
> **DECISION 2026-07-21 (architect feasibility pass) — the proof-gated dual-impl is the
> correct FINAL end state; the literal single-impl unification is deliberately NOT done.**
> The wasm engine *can* trivially depend on `monet-photo-core` (pure Rust, wasm32-clean, no
> `cfg` gate — the earlier worry was unfounded), and 3 selection-free tail fns
> (profile/calibration, geometry, heal) are cleanly shareable. BUT `point_color` is the
> load-bearing blocker: wasm's is **selection-aware** (`adjust.rs:244` `map_rgb(px, sel, sockets)`
> — `camera_raw_develop` doubles as Vision's fid-17 smart-filter which can run against an active
> selection), while `develop_advanced.rs`'s copy hardcodes full coverage — byte-equal only on
> Galerie's inactive-selection path, so a swap is a **behavior change** on the selection-active
> path. `DevelopCropMap` also diverges (wasm's `output_to_source` feeds crop_to_fill + masks).
> True single-impl needs sharing `color`/`sample_bi`, woven into each crate's *divergent
> basic-develop* → a multi-week re-arch with **zero behavior payoff** on frozen ACR-parity math
> already under a byte-exact proof. The double-edit tax is real but rarely paid (frozen tail) and
> self-announcing (the parity proof fails loudly on drift). If ever done, it rides a future
> basic-develop convergence, not a standalone pass.
> **Still a separate item (as this section already says):** crop/masks/enhance in
> native export are app-side (`recipeToParams` zeroes them; `develop.rs:39`:
> "a non-zero count would double-render"), tracked below as Galerie work — NOT
> part of 6b. **Remaining plan phase: Phase 5 only.**
>
> **UPDATE 2026-07-22 — the "mask half" is closed for the app-side routes.** The
> composite that lived only in `DevelopView`'s rAF closure is now
> `apps/galerie/src/lib/maskComposite.ts`, called by both the preview loop and
> `developToImage` — so Export / Web / Print / contact sheet apply local masks
> (JPEG/PNG/8-bit paths). Same pass fixed thumbnails/previews silently rendering
> **uncropped** (`decodeImage` now applies the shared `applyCrop`;
> `SHARED_CORE_REVISION` → `preview-identity-v2.2` invalidates stale previews).
> Native 16-bit/DNG now **refuses** a masked recipe instead of writing an unmasked
> file, matching its existing crop refusal — engine-side masks (and the
> aiSubject raster-coverage channel) remain the open follow-up.


**Phase 6a (mechanical pre-split, ~1 day):** move the develop section of
`raster/mod.rs` — `camera_raw_develop` (~:14292), the advanced-tail functions
(~:23371–24800), and the `mod camera_raw_develop` tests (~:49066) — into a new
`raster/develop.rs` following the existing nine-submodule pattern (a second
`impl Engine` block in a submodule is how `filters.rs`/`adjust.rs` already
work). Zero behavior change; the in-file develop tests move with it. This
turns "de-method thousands of lines inside a 50k-line file" into "extract
functions from a ~3–4k-line file". Do **not** split the rest of mod.rs.

**Phase 6b (the unification):** extract the develop body + tail functions into
`monet-photo-core::kernels` as buffer-in/buffer-out free functions; have
native `apply_bounded` call them; make the wasm `Engine::camera_raw_develop`
delegate to them. **Plus the piece the first draft missed:** extend
`recipe_to_legacy_params` (or add a shared Rust recipe→advanced-tail
serializer mirroring `developParams.ts`) so the native path *produces* the
tail the shared kernels parse — and golden-test the Rust and TS serializers
against each other (this is the same dual-serializer drift this plan exists
to kill). Keep `monet-photo-core` wasm-clean (no moxcms/rawloader/image
without feature gates). Expect a `PROCESS_VERSION`/`SHARED_CORE_REVISION`
bump (Galerie preview-cache invalidation).

**Acceptance proof (definition of done for the bug fix):** the serializer
goldens prove params equality, but the bug is *pixel* divergence — add a
**native-vs-wasm parity proof bin** (Galerie's proof-bin infrastructure exists
for exactly this): develop one advanced recipe (heal + Point Color +
calibration + profile) through both pipelines and pixel-compare within a
stated tolerance. 6b is done when that proof passes.

**Honest fix scope:** 6b fixes the native-export loss of heal/Point Color/
calibration/profile. The **mask half needs Galerie app work beyond this
phase**: either emit masks into export-side params (suppressing the TS
composite) or run the preview's TS mask compositing in `developToImage` —
and aiSubject masks need a raster-coverage channel (e.g. a CoverageView-style
upload), since cached-raster coverage cannot be expressed in the parametric
tail. Track that as its own Galerie work item alongside 6b.

## What stays app-specific (do not chase)

- **Vision editor:** `store.ts`/`app.ts`/`App.tsx`, the ~120 raster filter
  modules, blend modes, selections/paths/masks, text + vector shapes, `mcp/`,
  `ml/` generative (diffusion/onnx), canvas + OS chrome, slices/artboards,
  and the engine-mirror test files (`autoLevels`/`equalize`/`ntscColors`).
- **Galerie DAM:** `catalog.rs` (~8k LOC SQLite `.galcat`), collections,
  keywords, virtual copies, library/filmstrip UI, import/publish/scheduler,
  native output writers (DNG/TIFF), Core Image RAW backend (`raw_decode.rs`).
  Note: `developNative` *refuses* non-identity crop rather than silently
  dropping it (`export.ts:187-189`) — correct behavior, keep it.
- **Divergent-by-design:** RAW decode (Galerie = macOS Core Image for
  camera-profile fidelity; wasm = portable rawloader — only the `DevelopFrame`
  interchange is shared, already). XMP: Vision's private-JSON wrapper vs
  Galerie's Adobe-CRS sidecar are *different contracts*, not duplicate code.

## Suggested sequencing & decisions

- Ship **Phases 0–4** as independent, individually-green commits on `main`
  (this repo is trunk-based; the user owns commits). Phase 0 carries the
  enablers (rename, gates, CI, the ABI golden); each later phase deletes real
  duplication or adds a pure-gain package.
- **Phase 5** and **Phase 6** are separate multi-week projects. Either order
  works, but they share golden fixtures — whichever lands second re-blesses
  them (invariant #5); never run concurrently. Phase 6a can land any time
  after Phase 0. **Coordinate the PROCESS_VERSION bumps:** 5(a) and 6b each
  force one; if the phases land in the same stretch, batch them into a single
  bump so Galerie's preview cache invalidates once, not twice.
- **Freeze develop-stack feature work during Phase 5.** The recurring parity
  loops landed heal/profile/kind-8 into `cameraRaw.ts`/`developParams.ts`
  *this very week* — concurrent feature work in those files during a 4–6-week
  migration is live churn against the migration diff. For that window, new
  develop features land in the shared monet-photo package only (or pause).
- **Open product decisions** (flag, don't block): Vision XMP → Adobe CRS
  interop; the drifted `straighten`/`cropAspect`/`autoTone` trio;
  MaskGraph↔engine-mask unification; internal `Develop*` symbol renames.

**Gates for any phase** (real commands): `pnpm typecheck`, `pnpm lint`,
`pnpm test` (after Phase 0(c) actually covers galerie + monet-photo),
`pnpm build:libs` + `pnpm build:web` where builds matter; `cargo test` in
`packages/engine`, `packages/engine/crates/monet-photo-core`, and
`apps/galerie/src-tauri` where Rust changes; **e2e where behavior could move**
— Vision's Playwright suite (esp. `camera-raw-workspace.spec.ts`, the
behavioral net for Phase 5; invoke via
`pnpm --filter monet-vision exec playwright test`, never root `pnpm exec`);
the Galerie `.mjs` proof gates + the Phase 0(e) ABI golden for anything
ABI-adjacent; `mcp:codegen`+`mcp:check` where MCP wrappers change; no skipped
tests.
