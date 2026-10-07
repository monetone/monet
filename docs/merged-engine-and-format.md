# Design: One engine, one format — merging Monet's raster (Vision) and vector (Artisan) engines

**Status:** Phases 0–6 implemented & verified (see §1a)
**Date:** 2026-06-19
**Scope:** The Monet **Vision** (raster) and **Artisan** (vector) Rust/WASM engines and the shared `monet-format` crate. Produces a single new engine crate (`packages/engine`) consumed by both apps, and a unified, serde-backed document format that supersedes `.mvsn` and `.artisan`.
**Author:** Engineering (grounded in a code-level survey of both engine crates, both frontends, and `monet-format`, with the load-bearing mechanics verified against the source)

---

## 1. Summary

This is the **C + D** direction: one merged WASM engine that handles both raster and vector content, plus one document format that represents both. It is the largest of the interop options and the only one that yields genuine **hybrid documents** (raster layers and live vector layers in one stack) rather than one-way content hand-off.

The encouraging finding from the code survey is that the merge is **mechanically much cheaper than it looks**, because of three facts that already hold today:

1. **Both engines already emit the identical pixel buffer** — straight-alpha (non-premultiplied) RGBA8, `w·h·4`, channel order R,G,B,A, no swizzle, no premultiply (Vision `color.rs:33`; Artisan un-premultiplies on read-back). Merging them into one `cdylib` puts both in **one linear memory**, so vector pixels reach the raster compositor by an in-memory copy, never a JS round-trip.
2. **Vision's compositor already routes every non-adjustment layer kind through one code path.** `composite_layer_px` (`lib.rs:726-810`) special-cases only adjustment layers; raster, text, **and smart objects** all fall into the same `else` branch (`770-797`) and are sampled from the layer's own `pixels`. A smart object fills that buffer **out-of-band** in `render_smart` (`lib.rs:350-370`), never inside `composite()`.
3. **A new layer field rides undo for free.** `DocSnap` clones the full `Vec<Layer>` (`doc_snap`, `lib.rs:372-384`) and `Layer` is `#[derive(Clone)]`.

So the chosen design is: **"vector" is a new `Layer` kind (`kind == 3`) whose Artisan-style scene is rasterized on demand by tiny-skia into the layer's `pixels`, exactly mirroring the smart-object precedent.** Vision's compositor, blend modes, filters, adjustments, masks, and effects then apply to it for free. The unified format **reuses Artisan's `model::Document` as the vector half** and **grafts `monet-format`'s `import::` raster model** as the other layer kinds, with serde and a container added.

**Verdict by workstream:**

| Workstream | Difficulty | One-line reason |
|---|---|---|
| Merge Vision's raster core into a shared crate | 🟢 Mechanical | A code move; byte-for-byte golden-image parity is the gate |
| Vector as a layer kind + `render_vector` | 🟢 Moderate | Clones the smart-object out-of-band-rasterize precedent; compositor untouched |
| Unified format (reuse both existing models) | 🟡 Hard | Add serde to the raster IR; reconcile two blend enums; design a container |
| Headless rasterization of text/effects/masks/patterns | 🔴 Very hard | Artisan punts these to a host SVG overlay; a merged engine has none — text + fonts is the long pole |
| Migrating both apps onto one crate | 🟡 Hard | High blast radius; de-risked by keeping the legacy crates until the last phase |

**Bottom line:** Phases 0–2 (scaffold → raster merge → vector layer kind for non-text/effect content) are low-risk and should proceed. Phase 3 (Artisan onto the merged engine) is the real commitment and needs a rollback path. Phase 4 (native text/effects/masks) is open-ended and must not block the rest — the interim host-rendering crutch is correct and cheap.

---

## 1a. Implementation status

This design has been built. The merged crate **`packages/engine`** (`monet-render-engine`) exists and the migration phases below are implemented and verified:

| Phase | What landed | Verification |
|---|---|---|
| **0 Scaffold** | `packages/engine` crate (cdylib+rlib), feature-gated codecs, builds via `wasm-pack` | native + wasm build green |
| **1 Raster core** | Monet Vision's engine lifted into `src/raster/` (re-rooted module paths) | **418** lifted Vision tests pass |
| **2 Vector kind** | Artisan subsystem lifted into `src/vector/`; new `Layer` kind `3` with `render_vector` (tiny-skia → u16, cached, `ensure_vector` in the composite sweep); `vector_*` wasm API; destructive-op guards | **451** tests incl. end-to-end "vector rasterizes & composites through the unchanged compositor", re-raster-on-zoom, scene round-trip |
| **3 Unified format** | serde added to all 13 `monet-format` `import::` types; `monet_format::graphics::GfxDocument` (envelope, versioning, `from_import`); engine `from_gfx`/`to_gfx` + `load_graphics`/`save_graphics`. The engine is a lossless **courier**: document `id`/`name`/`source`, foreign per-app `data` namespaces, unknown top-level `extra`, and the embedded `iccProfile`/`iccProfileName` survive a load→save hop (`Engine::gfx_envelope`; `setDocumentIcc`/`documentIcc` assign it) | **22** `monet-format` tests; `save_graphics`→`load_graphics` reproduces composited output **byte-identically** |
| **4 Vision cutover** | Vision's `engine:build` + `@engine` alias repointed at the shared crate | Vision typechecks **0 errors** (the merged API is a strict superset) |
| **5 Artisan cutover** | Artisan compat shims on the merged `Engine` (`set_document`/`set_view`/`render`/`resize` modelling a transparent single-vector-layer doc); alias + build repointed. **Engine only** — Artisan's file I/O still reads/writes bare `.artisan` JSON (`apps/artisan/src/io/files.ts`); it does not open or save `.monetgfx` yet | Artisan typechecks **0 errors** |
| **6 Deprecate legacy** | the legacy `apps/{vision,artisan}/engine` crate sources are **deleted**; both apps build their engine from `packages/engine` into their `engine/pkg/` sink. Golden-image parity is established by the **418 verbatim-lifted Vision tests** (which assert exact composited pixel values), so the gate is met. | both apps build from the shared crate + typecheck **0 errors** |

The artboard-background fork (§5.4), the `tiny_skia::Transform` view, the layer-preserving vector model, and the `pathfinder(…, counter)` signature from the review corrections are all in the shipped code. Native headless item effects, masks, patterns, stroke alignment, and a deterministic bitmap-glyph text fallback are now in `packages/engine/src/vector/render.rs`. Shaping, kerning and glyph outlines for host-registered faces landed afterwards via `rustybuzz`/`ttf-parser` (§6; the registry is `src/vector/fonts.rs`). Still pending: font discovery/activation from the host catalog, script-aware fallback and cross-run rich bidi, full paragraph composition (§6), and the zip/`raw16` container variant (§8.4 — v1 inlines pixels).

---

## 2. Goals & non-goals

**Goals**

- One Rust/WASM engine crate, consumed by both Vision and Artisan, that composites raster layers and renders vector layers in a single linear memory.
- Vector content is **editable** (anchors, boolean ops, hit-testing at any zoom), not a baked snapshot.
- A single serde-backed document format that losslessly round-trips both a current `.mvsn` raster document and a current `.artisan` vector document, and into which PSD/PSB/XCF still import.
- No big-bang cutover: both apps keep shipping from `main` throughout, and every previously-saved file keeps opening.

**Non-goals (for this initiative)**

- A from-scratch resolution-independent compositor. Vision's proven u16/sRGB compositor stays the core; vectors rasterize **into** it (the user-chosen "raster-on-zoom" model, like Photoshop shape/smart-object layers).
- A from-scratch neutral IR. We reuse Artisan's vector model rather than inventing one.
- Merging Cinema's engine, or merging the **apps** themselves. Two apps, one shared engine + format.
- True Illustrator-class infinite-zoom vector display (left as an Open Question; the `render_vector` seam is designed to allow swapping it in later).

---

## 3. Where the two engines stand today

### 3.1 The shared output contract (the reason a merge is cheap)

Both engines expose `output_ptr() -> *const u8` into their own linear memory, pointing at a straight-alpha RGBA8 buffer of exactly `w·h·4`. Vision writes it via `Rgba::to_u8` (`color.rs:33-38`); Artisan's `render()` un-premultiplies tiny-skia's premultiplied pixmap into precisely the same layout. Both frontends blit identically: `new Uint8Array(mem.buffer, ptr, w*h*4)` → `imageData.data.set(buf)` → `ctx.putImageData` (Vision `EngineClient.ts:127-163`). **A buffer produced by one engine is directly consumable by the other with zero conversion.**

### 3.2 The "two memories" problem the merge solves

Today they are two `cdylib`s → two `wasm-bindgen` instantiations → **two disjoint linear memories**, so a vector raster can only reach Vision's compositor by copying out to JS and back in. One merged `cdylib` is **one linear memory**: the vector rasterizer writes into the same arena the compositor reads. That is the entire structural reason to merge rather than keep two modules talking over JS.

### 3.3 Key data structures the design must reconcile

| Concern | Vision (`apps/vision/engine`) | Artisan (`apps/artisan/engine`) | `monet-format` |
|---|---|---|---|
| Internal model | Flat `layers: Vec<Layer>` bottom-to-top (`lib.rs:233`); each layer full-canvas `pixels: Vec<u16>` straight-alpha sRGB | `model::Document` scene graph: `artboards` + `layers[].items[]`; cubic-bezier `PathGeometry`, `Paint`, `Stroke`, per-item affine `Matrix` | `import::Document`: raster-only layered IR, baked 8-bit RGBA per layer |
| Output | `output: Vec<u8>` RGBA8 (`lib.rs:236`), `to_u8` straight-alpha (`color.rs:33`) | tiny-skia pixmap → un-premultiplied RGBA8 | n/a (ingestion IR) |
| Precision | u16/channel; modes RGB/Gray/CMYK/Lab; depth 8/16/32; **non-linear/gamma** compositing | 8-bit straight-alpha sRGB (tiny-skia is 8-bit premultiplied internally) | canonical 8-bit straight-alpha RGBA |
| serde | none (hand-rolled binary `save_project`/`load_project`) | **yes** (`model.rs`), forward-compat via `#[serde(flatten)] extra` on `Item` | **none** on the `import::` half; the `format::` timeline envelope has serde |
| Blend modes | 28-entry enum (`blend.rs:9-90`), incl. 12 PS-extended + `PassThrough` | string blend modes; tiny-skia supports ~16 (SVG subset) | `import::BlendMode` (27 variants, no `PassThrough`), `to_index()` matches Vision's bytes |
| wasm size | ~9.16 MB (`image`/`psd`/`rawloader`) | ~1.10 MB (`tiny-skia`/`i_overlay`/`serde`) | n/a |

Neither engine has any `static`/`thread_local`/global state — multiple `Engine` instances already coexist in one memory, which the merge preserves.

---

## 4. Architecture: one crate, one memory, vector as a layer kind

### 4.1 The merged crate

The two engine crates collapse into a single new crate at the monorepo root (a sibling of `apps/` and `packages/monet-ui/`, **not** inside Monet UI, which is the generic outward-facing design system):

```
packages/engine/
  Cargo.toml          # name = "monet-render-engine", lib = "monet_render_engine"
  Cargo.lock          # committed (the crate keeps the empty [workspace] detach line)
  src/
    lib.rs            # the single #[wasm_bindgen] Engine (raster API + vector_* API + Artisan shims)
    document.rs       # unified on-disk layer-stack model + serde
    raster/           # ← lifted from apps/vision/engine/src/  (the compositor core)
      lib.rs          #   Engine, layer stack, composite*/composite_layer_px, undo,
                      #   render_smart(), NEW render_vector()
      blend.rs color.rs adjust.rs pixel_adjust.rs filters.rs effects.rs selection.rs
      format_import.rs
    vector/           # ← lifted from apps/artisan/engine/src/  (rasterize-on-demand subsystem)
      model.rs        #   VectorScene = model::Document (the vector half of the format)
      geom.rs shapes.rs render.rs pathfinder.rs query.rs ops.rs factory.rs
      mod.rs          #   pub fn rasterize(...) — the ONLY raster/ ↔ vector/ seam
```

It keeps the shape every current engine uses: `crate-type = ["cdylib", "rlib"]`, `[profile.release] opt-level=3 / lto=true / codegen-units=1`, the empty `[workspace]` line so `wasm-pack build --target web` stays standalone. Dependencies are the **union** of both engines plus the `monet-format` path dep. The `cdylib` is emitted by `wasm-pack` exactly as today; the per-app Vite `@engine` alias changes only its **filename** (`monet_render_engine.js`), and the `init` / `output_ptr()` / blit contract is byte-for-byte preserved.

### 4.2 Vision's compositor stays the core — the smart-object precedent

The merged engine **is Vision's `Engine`, extended** — not a new compositor. The document core (`raster/lib.rs:229-314`) is unchanged: `layers`, `active`, `next_id`, `output`, the undo stacks, `mode`/`depth`, caches. Compositing remains the per-pixel `composite()` → `composite_region()` → `composite_layer_px()` walk.

> **Vector reuses the smart-object precedent verbatim.** `composite_layer_px` (`lib.rs:726-810`) special-cases only adjustment layers (`kind==1`, which read back the accumulator at `754-769`). *Everything else* — raster, text, and smart-object (`kind==7`, used at `lib.rs:333`, `3322`, `6143`) — falls into the same `else` branch (`770-797`) and is sampled from the layer's own `pixels: Vec<u16>` via `sample_layer` (`497-505`). A smart object populates that buffer out-of-band in `render_smart(idx)` (`lib.rs:350-370`), guarded by `smart_src.len() == w*h*4` (`357-359`), and is never re-run inside `composite()`. **A vector layer does exactly the same:** an out-of-band `render_vector(idx)` rasterizes the vector scene into `pixels`, and the unchanged raster path composites it. All of Vision's pipeline — blend modes, `opacity`/`fill_opacity`, `blend_if`, knockout, clipping, layer effects, masks, and adjustment-layer recoloring — then applies to the rasterized result for free.

> *Citation note:* the struct comment at `lib.rs:47` lists only `0 pixel · 1 adjustment · 2 text · 6 group header` and omits `7 smart object`; the authoritative kind set comes from the code uses above. Codes **3, 4, 5 are unused**; vector takes **`kind == 3`**.

### 4.3 The vector/raster module seam

`raster/` and `vector/` are siblings with one narrow, one-directional seam. The vector subsystem owns the scene graph and its rasterization and knows nothing about `Layer`, `output`, undo, or blend semantics; the raster compositor owns the layer stack and never touches bezier math. They meet at a single function the raster side calls:

```rust
// packages/engine/src/vector/mod.rs — the only surface raster/ depends on.
pub use model::Document as VectorScene;   // Artisan's serde model::Document, reused whole

/// Rasterize a vector scene into straight-alpha 8-bit RGBA at the requested device
/// resolution. `view` is the layer→canvas affine (zoom/transform/DPR folded in).
/// Mirrors render::render_document but (a) returns pixels and (b) SKIPS artboard
/// backgrounds (see §5.4) so the result is transparent where the scene is empty.
pub fn rasterize(scene: &VectorScene, w: u32, h: u32, view: tiny_skia::Transform) -> Vec<u8>;
```

The boundary is deliberately one-directional: `raster/` calls `vector::rasterize` (and the editing/query helpers via the `vector_*` methods); `vector/` never references `raster/`. The only place the two precision/blend models reconcile is the documented `u8→u16` bridge in `render_vector`.

### 4.4 The `Layer` extension

`Layer` (`lib.rs:27-74`) gains fields, paralleling how `smart_src`/`smart_filters` already sit on the same struct:

```rust
// added to struct Layer
/// Artisan-style vector sub-scene (artboards + layers + items). The editable
/// source of truth; `pixels` is a derived cache. Boxed to keep Layer::clone cheap.
vector_scene: Option<Box<vector::model::Document>>,
/// Derived cache validity. NOT snapshotted into undo (treat like fx_cache):
/// on undo/redo it is cleared so the layer re-rasterizes lazily.
vector_cache_key: Option<VectorCacheKey>,
```

Because structural undo clones the full `Vec<Layer>` (`doc_snap`, `lib.rs:372-384`) and `Layer` is `#[derive(Clone)]`, **`vector_scene` is captured by undo automatically with no `Snap`/`DocSnap` change** — exactly as the legacy flat-polygon `vector_path` rides along today. (The legacy `vector_path`/`vector_subpath_lens`/`vector_is_mask` fields, used for vector masks and work-path outlines, are kept for back-compat with old saves; the new kind supersedes them.)

The creators `add_vector_layer(scene_json, name) -> id` and `convert_to_vector(id)` mirror `add_adjustment_layer` / `convert_to_smart_object` (`~lib.rs:3389-3412`): `push_stack_undo`, allocate via `Layer::transparent` (which always allocates a full `w·h·4` buffer), set `kind = 3`, deserialize the scene, `render_vector`, `composite()`.

### 4.5 Public `#[wasm_bindgen]` API shape

**One monolithic `Engine`, additive.** Vision's `Engine` exposes ~356 methods; Artisan's exposes ~54. After the merge there is exactly **one `#[wasm_bindgen] struct Engine`**. A separate vector handle type was considered and **rejected**: it could not share `&mut self` with the layer stack, every edit must re-enter `render_vector` + `composite` on the owning `Engine`, and undo/active-layer/selection state all live on `Engine`. Vector ops are therefore plain `Engine` methods, namespaced by a `vector_` prefix:

```rust
#[wasm_bindgen]
impl Engine {
    // --- existing ~356 raster methods, unchanged ---

    // --- new vector-layer methods (operate on a kind==3 layer by id) ---
    pub fn add_vector_layer(&mut self, scene_json: &str, name: &str) -> u32;
    pub fn convert_to_vector(&mut self, id: u32);
    pub fn vector_scene_json(&self, id: u32) -> String;
    pub fn vector_set_scene(&mut self, id: u32, scene_json: &str) -> Result<(), JsValue>;
    pub fn vector_add_path(&mut self, id: u32, anchors_json: &str) -> Result<String, JsValue>;
    pub fn vector_edit_anchors(&mut self, id: u32, item: &str, edit_json: &str) -> Result<(), JsValue>;
    pub fn vector_boolean(&mut self, id: u32, item_ids_json: &str, op: &str) -> Result<(), JsValue>;
    pub fn vector_set_paint(&mut self, id: u32, item: &str, paint_json: &str) -> Result<(), JsValue>;
    pub fn vector_set_stroke(&mut self, id: u32, item: &str, stroke_json: &str) -> Result<(), JsValue>;
    pub fn vector_hit_test(&self, id: u32, x: f32, y: f32, tol: f32) -> String;
    pub fn vector_set_view(&mut self, id: u32, tx: f32, ty: f32, zoom: f32, angle: f32);
}
```

Every mutating vector method follows the same lifecycle as `smart_add_filter`: locate the `kind==3` layer by id, mutate `vector_scene` via the `vector/` modules, bump the scene revision, `render_vector(idx)`, then `composite()`.

**Artisan compatibility surface.** Artisan drives a whole-canvas document, not a layer stack. Rather than rewrite its `EngineClient`, the merged `Engine` keeps thin shims modelling "a document whose single layer is a Vector layer." Signatures match Artisan's real ones (which return `Result`, e.g. `set_document` at `apps/artisan/engine/src/lib.rs:71`):

```rust
pub fn set_document(&mut self, json: &str) -> Result<(), JsValue>; // build a 1-layer kind==3 doc, render_vector, composite
pub fn set_view(&mut self, tx: f32, ty: f32, zoom: f32, angle: f32);
pub fn render(&mut self);                                          // alias for composite()
// hit_test / document_json / resize / output_ptr / width / height already exist or alias trivially
```

Artisan's `EngineClient` then changes only the `@engine` alias filename.

### 4.6 Instance model

Unchanged: no globals, so N `Engine` instances (each with raster and vector layers) coexist in one linear memory. Vision's `EngineClient` already relies on this (`buildNew`/`buildImage`/`buildProject`/`buildFormat`/`buildRaw` construct several coexisting engines and `activate(engine)` switches between them); the vector rasterizer is a pure function, adding no shared state. Artisan's single lazily-created engine is the N=1 case.

---

## 5. The vector layer kind & on-demand rasterization

### 5.1 `render_vector` — the producer

`render_vector` mirrors `render_smart` one-for-one. It rasterizes the sub-scene with tiny-skia at the **current composite resolution**, un-premultiplies to straight RGBA8, widens to u16 via `color::u8_to_16` (`×257`, exact and lossless for an 8-bit origin — `color.rs:67-69`), and writes the full-canvas `pixels`:

```rust
fn render_vector(&mut self, idx: usize) {
    let layer = &self.layers[idx];
    let Some(scene) = layer.vector_scene.as_deref() else { return };
    let (w, h) = (self.w, self.h);

    // dpi/zoom/pan/rotation are all folded into one affine (§5.5). tiny_skia::Transform
    // is Copy + comparable, so it doubles as part of the cache key.
    let view = self.vector_view_for(idx);
    let key  = VectorCacheKey { w, h, view, revision: scene_revision(scene) };
    if self.layers[idx].vector_cache_key.as_ref() == Some(&key) { return; } // cache hit

    // Guard mirrors render_smart (357-359): reallocate if a resize left pixels stale.
    if self.layers[idx].pixels.len() != (w * h * 4) as usize {
        self.layers[idx].pixels = vec![0u16; (w * h * 4) as usize];
    }

    let rgba8 = vector::rasterize(scene, w, h, view); // tiny-skia, in THIS same memory
    let px = &mut self.layers[idx].pixels;            // Vec<u16>, straight-alpha
    for i in 0..(w * h) as usize {
        // rgba8 is already straight-alpha (rasterize un-premultiplies). No swizzle, no re-premultiply.
        px[i*4]   = color::u8_to_16(rgba8[i*4]);
        px[i*4+1] = color::u8_to_16(rgba8[i*4+1]);
        px[i*4+2] = color::u8_to_16(rgba8[i*4+2]);
        px[i*4+3] = color::u8_to_16(rgba8[i*4+3]);
    }
    self.layers[idx].vector_cache_key = Some(key);
}
```

After it returns, the layer's `pixels` are ordinary u16 straight-alpha sRGB content; the unchanged compositor handles the rest. Destructive raster ops (brush, `apply16` at `lib.rs:333`) must refuse on `kind==3` exactly as they refuse on `kind==7` — the pixels are a derived artifact.

### 5.2 Cache & invalidation

`vector_cache_key` is the single invalidation primitive; re-raster happens **only** when the key changes.

```rust
#[derive(Clone, PartialEq)]
struct VectorCacheKey {
    w: u32, h: u32,                 // composite resolution (canvas resize)
    view: tiny_skia::Transform,     // pan/zoom/rotation/DPR world→pixel mapping
    revision: u64,                  // monotonically bumped on any scene edit
}
```

| Trigger | Re-raster? | Rationale |
|---|---|---|
| Scene edit (anchor move, fill, boolean, add/remove item) | **Yes** — every `ops.rs`/`pathfinder.rs` mutator bumps `revision` | content changed |
| Zoom / rotate (changes `view`) | **Yes** | this is the "raster-on-zoom" reality (§5.6) |
| Canvas resize (`w`/`h`) | **Yes** — reallocate `pixels` first | resolution changed |
| **Pan only** (no zoom change) | **No** — `view` translate differs only by integer blit offset; key designed so pure pan is a cache hit | pixel content unchanged |
| Blend/opacity/mask/clipping/effects on the vector layer | **No** | compositor inputs, not rasterizer inputs |
| Adjustment layer above recolors the stack | **No** | adjustment reads back the accumulator (`754-769`); vector pixels untouched |

`revision` is the only new bookkeeping — a monotonic counter, not a JSON diff. We do not re-rasterize inside `composite()`.

**Invocation site & the `fx_frozen` caveat.** The existing per-layer sweep at the top of `composite_region` (`lib.rs:1045-1049`) runs `ensure_fx(i)` **only when `!self.fx_frozen`** — the sweep is deliberately skipped during Move-tool drags. An `ensure_vector(i)` companion goes here, but must make an explicit decision about drags: vector re-raster should be **frozen during an active drag/zoom gesture** (reuse the cached pixels, blit at the new offset/scale) and fire once on gesture end, so a continuous gesture does not pay a full vector raster per frame. A cache hit is a single key comparison, so calling `ensure_vector` every composite is cheap; the freeze is about not invalidating mid-gesture.

**Memory.** Each vector layer stores the scene (cheap) plus a full-canvas u16 `pixels` cache (`w·h·8` bytes — same as any raster layer). This is the deliberate, PS-shape-layer-matching cost. A future optimization could rasterize to a tight `world_bounds` crop plus `ox/oy` (the compositor already supports offset sampling), but full-canvas is the cheapest correct first cut.

### 5.3 Keeping vectors editable (not baked)

**`vector_scene` is the source of truth; `pixels` is a throwaway cache.** Editing operates on the scene, bumps `revision`, and lets the next composite re-rasterize. The full Artisan toolset moves into `vector/` and operates on `Layer::vector_scene`:

- **Hit-testing** (`query.rs:116`): `hit_test(doc, world_pt, tol)` runs against the live scene, so picking is exact at any zoom, independent of the rasterized cache. The engine maps a pixel-space pointer back to world space (inverse `view`, via `geom::m_invert` at `geom.rs:92`) before calling it.
- **Boolean ops** (`pathfinder.rs`, i_overlay): the real signatures are `pathfinder(doc, ids, op, counter: &mut u64)` and `pathfinder_group(doc, ids, op, counter: &mut u64)` — **they take a mutable id counter**, which the merged engine must source from `Engine.next_id`. *Honest limit:* boolean ops flatten curves to polylines at tolerance `0.3` (`item_world_contours`, `pathfinder.rs:19-43`), so results are polygonal (handle-less anchors) — an Artisan-inherited fidelity ceiling, unchanged by the merge.
- **Structural / anchor editing** (`ops.rs`): `transform_items`, `convert_to_path`, `add_anchor_points`, `make_compound_path`, `set_handle`, `cut_path_at`, `align`/`distribute` — `&mut Document` mutators, each followed by a `revision` bump and (where they create items) sourcing ids from the engine counter.

A "rasterize this vector layer" command (bake to raster, like `rasterize_text_layer` at `lib.rs:3573-3582`) is then trivial: flip `kind 3→0`, drop `vector_scene`, keep `pixels`.

### 5.4 Coordinate / space mapping (and the artboard-background fork)

Artisan items live in **world space** (composed `parent_world · item.transform`, the SVG 2×3 affine `Matrix [a b c d e f]`, `model.rs:12-26`). Vision composites on an integer pixel grid `(0,0)..(w,h)`. The bridge is one affine — Artisan's `set_view(tx, ty, zoom, angle)` (DPR-scaled), converted to a `tiny_skia::Transform` and passed as the root `parent` transform to the rasterizer:

```
pixel = view · world,   view = scale(dpr) · rotate(angle) · scale(zoom) · translate(tx, ty)
```

`render_document` already threads a `view: tiny_skia::Transform` (by value) and composes `t = parent.pre_concat(item.transform)` (`render.rs:62-66`), so this is the existing entry point — **no new view type** (the design carries no invented `View`/`ViewTransform`; the type is `tiny_skia::Transform`).

> **Correctness fork — artboard backgrounds.** `render_document` (`render.rs:24-45`) **first paints opaque white artboard backgrounds** for every artboard with non-zero size (`26-37`), then renders layers. Calling it as-is to fill a transparent Vision layer would paint solid white pages and destroy transparency. The `vector::rasterize` entry therefore uses a **forked/parameterized `render_document` that skips artboard background fills** (or strips artboards from the sub-scene before rendering); artboards are retained in the model for round-trip and editing, just not painted. The golden-image oracle in Phase 2 (§9) must compare against this background-stripped path, not raw `render_document`.

`ox`/`oy` stay `0` for vector layers in the full-canvas scheme — position lives in the world transform.

### 5.5 Resolution-independent vs raster-on-zoom — set expectations honestly

- **Resolution-independent (re-rasterized crisply at every zoom step):** path/shape geometry (`build_path`, `render.rs:386-403`), strokes, gradient/solid fills, and — if text uses outline rendering (§6) — text edges. **Editing (hit-test, boolean, anchor ops) is fully resolution-independent always**, because it reads the live scene, never the cache.
- **Raster-on-zoom (cached pixels):** between re-rasterizations the displayed vector is a fixed-resolution bitmap; zoom past the cached resolution shows soft edges until the next `render_vector`. Any Vision filter/adjustment/effect on top operates on that bitmap.
- **Tonally 8-bit, always (the one real precision ceiling):** tiny-skia rasterizes in 8-bit; the `u8→u16` widen is exact, but vector content in a 16/32-bit document is limited to 256 levels/channel until a higher-precision rasterizer replaces tiny-skia. Re-raster recovers *spatial* crispness, never *tonal* precision.

This is exactly the smart-object contract — the precedent the design follows.

---

## 6. Closing the rasterizer gap (the hard part)

The original Artisan `render_item` had a **skip gate** returning early for content the host drew via its SVG `FallbackOverlay`:

```rust
if item.kind == "text" || has_svg_fallback(item) { return; }
```

That specific invisibility gap is now closed in the merged renderer: `type:"text"` calls `render_text` and reuses the same fill/stroke/effects/blend/mask path as regular vector geometry. Runtime-provisioned faces are shaped with `rustybuzz` and converted to outlines with `ttf-parser`; unsupported text retains deterministic built-in 5x7 glyph paths as a headless fallback.

Other former overlay gaps have native coverage in current `render.rs` as well: item effects, opacity masks, patterns, stroke alignment, variable stroke width, nested clip intersections, gradient-stop midpoints, opt-in World-Ready ordering for mixed-direction plain vector text, and explicit-`boxWidth` word reflow. Remaining text work is deeper fidelity: arbitrary host-font discovery/activation, script-aware fallback and cross-run rich bidi, full paragraph spacing/composition/overflow, and broader real-font pixel references.

| Rasterizer area | Status / remaining closure | Notes | Reuses Vision? |
|---|---|---|---|
| **Text → glyph fill/stroke** | 🟡 MED-HIGH (fidelity) | **Shipped:** deterministic bitmap fallback; runtime registered-face shaping/outlines; face/style and CSS-family fallback; rich runs; OpenType/variation controls; plain-line Unicode-bidi ordering; and metric-aware word reflow for explicit `boxWidth`, including per-run tracking/offset metrics and trimmed wrap separators. **Remaining parity:** arbitrary font catalog activation, complex/script fallback and cross-run rich bidi, paragraph indents/spacing/justification/hyphenation, box-height overflow/overset handling, and broader real-font pixel references. | partial |
| **Live effects** (drop-shadow/blur/glow/feather/inner-glow) | 🟢 Shipped baseline | Per-item and group effects render through offscreen alpha/source pixmaps, with tests for drop shadow, glow, blur, feather, inner glow, unknown effects, group effects, and mask-clipped effects. Remaining parity is the broader Photoshop effect taxonomy and exact parameter curves. | partial |
| **Patterns** | 🟢 Shipped baseline | Pattern paints render their tile artwork to a pixmap and use a repeating tiny-skia pattern shader for fills and strokes. Remaining parity is caching and deeper Illustrator/SVG pattern edge cases. | no |
| **Full clip/opacity masks** (alpha + luminance) | 🟢 Shipped baseline | Item/group opacity masks support luminance and alpha modes, and nested clip groups intersect masks. Remaining parity is exact SVG color-space behavior and more imported-mask fixtures. | partial |
| **Stroke alignment and variable profiles** | 🟢 Shipped baseline | Inside/outside stroke alignment clips a widened stroke to the fill mask, and variable width profiles render as tapered filled ribbons. Remaining parity is exact Illustrator stroke joins under extreme geometry. | no |

Framing: effects, masks, patterns, stroke alignment, and a substantial native text baseline now live in the merged renderer. Text remains a fidelity problem at the font-catalog, script fallback, paragraph-composer, overflow, and reference-pixel layers rather than an invisibility gap.

---

## 7. Blend & color reconciliation

**One canonical blend table.** Vision's 28-variant enum (`blend.rs:9-90`, with `from_u8`/`to_u8` byte-identical to declaration order) is the strict superset and is already what `import::BlendMode::to_index()` targets (`PassThrough=25` reserved, `DarkerColor=26`, `LighterColor=27`). The merged engine and the on-disk format both adopt it verbatim. The hard rule:

> **The outer blend of a vector layer against the raster stack is always evaluated by Vision's `composite_over` in f32 — never delegated to tiny-skia's `paint.blend_mode`.** tiny-skia supports only ~16 of the 28 modes; the 12 PS-extended ones (LinearBurn, LinearDodge, Vivid/Linear/PinLight, HardMix, Subtract, Divide, Dissolve, Darker/LighterColor, PassThrough) would silently fall back to SourceOver. tiny-skia blend modes are used **only** for intra-scene item-vs-item compositing within its 16-mode SVG subset.

**Color.** The bridge (tiny-skia 8-bit straight sRGB → `u8_to_16 ×257` → u16 → f32 `composite_over`) is lossless; all loss is upstream inside tiny-skia's 8-bit rasterization (gradients quantized to 256 levels; 8-bit premultiplied intra-vector blends → low-alpha fringing/banding). **Do not switch Vision to linear-light compositing** — `color.rs` non-linear/gamma compositing is the deliberate PS-matching choice and every existing Vision golden test depends on it. A higher-precision (u16/f32) vector rasterizer is a deferred, optional upgrade behind the same `render_vector` seam (it would mean forking tiny-skia — a large new surface, exactly what the merge is trying to avoid).

---

## 8. The unified document format

Supersedes `.mvsn` and `.artisan` by unifying the two in-memory models into one layer-stack document with a vector layer kind. Design rule: **reuse, don't reinvent** — lift existing types and only *add* the missing serde derives and the few fields the raster IR lacks.

### 8.1 Design constraints (from the code)

- The raster half (`monet-format` `import/document.rs`, 13 types) has **no serde derives anywhere** — they must be added in place under `packages/monet-ui` or mirrored. Tuples (`(i32,i32)`/`(f32,f32)`) serialize as JSON arrays; `[f32;32]` blend_if serializes fine.
- `import::BlendMode::to_index()` already targets Vision's bytes; the unified `BlendMode` is Vision's 28-entry table, with `from_index` added so `PassThrough(25)` round-trips (currently unrepresentable in `import::`).
- **The Artisan vector half is `#[serde(flatten)] extra` on `Item` ONLY** (`model.rs:265`) — **not** on `Document`, `Layer`, `Artboard`, `Paint`, `Stroke`, or `Gradient`. Today, unknown fields at those levels are silently dropped. **To get the lossless round-trip this format promises, `#[serde(flatten)] extra` must be ADDED to those structs as part of the unification work.** This is explicit work, not a free property.
- Layer ordering is bottom-to-top in both models — keep the invariant.
- The `format::` `.monet` envelope is a timeline (sequence/track/clip) — the **wrong spine** but the **right patterns** (envelope header, `extra` flatten, per-app `data` bag, lenient `parse`/`normalize`). Reuse the patterns, not the spine.

### 8.2 Rust type sketch — `GfxDocument`

A new module `packages/monet-ui/crates/monet-format/src/graphics/`, a third sibling to `import::` and `format::`. The vector payload **carries the full Artisan structure** (artboards + layers + items) so multi-layer `.artisan` files keep per-layer opacity/blend/visible/template/name — it does **not** flatten to a bare item list.

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GfxDocument {
    #[serde(skip_serializing_if = "Option::is_none")] pub id: Option<String>,
    #[serde(default = "untitled")] pub name: String,
    pub width: u32,
    pub height: u32,
    #[serde(default = "depth8")] pub depth: u8,          // 8/16/32 — metadata; storage is u16
    #[serde(default)] pub color_mode: ColorMode,         // RGB working space; CMYK/Lab import-only
    #[serde(default)] pub layers: Vec<Layer>,            // bottom-to-top
    #[serde(skip_serializing_if = "Option::is_none")] pub source: Option<SourceFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,                             // per-app bags { "vision": {…}, "artisan": {…} }
    #[serde(flatten)] pub extra: Map<String, Value>,     // ADDED for forward-compat
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub parent: Option<u32>,
    #[serde(default)] pub name: String,
    pub kind: LayerKind,
    // Common compositing fields (grafted from import::Layer)
    #[serde(default = "one")] pub opacity: f32,
    #[serde(default = "one")] pub fill_opacity: f32,
    #[serde(default)] pub blend: BlendMode,
    #[serde(default = "yes")] pub visible: bool,
    #[serde(default)] pub clipping: bool,
    #[serde(default)] pub locked: bool,
    #[serde(default)] pub knockout: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub blend_if: Option<[f32; 32]>,
    #[serde(default)] pub pass_through: bool,            // group-only → BlendMode::PassThrough
    #[serde(default, skip_serializing_if = "Option::is_none")] pub mask: Option<Mask>,
    // NEW: resolution-independent per-layer affine (import:: has only integer bounds)
    #[serde(default, skip_serializing_if = "is_identity")] pub transform: Matrix,
    // Kind-specific payload (exactly one populated)
    #[serde(default, flatten, skip_serializing_if = "RasterPayload::is_empty")]
    pub raster: RasterPayload,                           // Raster/Text/SmartObject/Adjustment/Group
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vector: Option<VectorPayload>,                   // Vector kind
    #[serde(flatten)] pub extra: Map<String, Value>,     // ADDED
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RasterPayload {
    #[serde(default, skip_serializing_if = "Bounds::is_zero")] pub bounds: Bounds,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub rgba: Option<PixelRef>, // → zip entry
    #[serde(default, skip_serializing_if = "Option::is_none")] pub adjustment: Option<Adjustment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]  pub effects: Vec<Effect>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub text: Option<Text>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub raw_blend_key: Option<[u8; 4]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorPayload {
    /// The FULL Artisan scene — artboards + layers + items — reused verbatim from
    /// vector::model::Document, so a multi-layer .artisan file round-trips without
    /// dropping per-layer opacity/blend/visible/template/name. (Artboard backgrounds
    /// are NOT painted on rasterize; see §5.4.)
    pub scene: VectorDocument,                           // = vector::model::Document
    #[serde(default = "yes")] pub text_as_outline: bool, // NEW: bake text to beziers on raster
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LayerKind { Raster, Adjustment, Text, Group, SmartObject, Vector }
```

`VectorDocument` (and its `Item`/`Paint`/`Stroke`/`Gradient`/`Matrix`) re-exports Artisan's `model::` types, which gain `#[serde(flatten)] extra` at the `Document`/`Layer`/`Artboard`/`Paint`/`Stroke`/`Gradient` levels as part of this work (per §8.1).

### 8.3 What we add that the raster IR lacks

| Addition | Type | Why |
|---|---|---|
| Per-layer affine | `Layer.transform: Matrix` | `import::Layer` has only integer `bounds` (ox/oy); vector/shape/smart layers need a real affine to re-rasterize crisply on zoom |
| `LayerKind::Vector` | enum variant → kind byte 3 | the new kind |
| Resolution-independent paint | `Paint`/`Gradient` (Artisan) | raster IR has only baked pixels |
| Stroke geometry incl. `align` | `Stroke` (Artisan) | the engine must honor inside/outside alignment Artisan skips today |
| Text-as-outline option | `VectorPayload.text_as_outline` | bake text to beziers headlessly (closes the text skip gap) |
| `extra` flatten on vector sub-structs | (see §8.1) | true lossless round-trip — not free today |

### 8.4 On-disk container

A **zip archive** (deflate), not bare JSON, because `RasterPayload.rgba` and `Mask.data` are large (`w·h·4` bytes per layer):

```
document.monetgfx          (zip)   # or .monet with kind discriminator if one suite extension is wanted
├── manifest.json          { format:"monet-graphics", schemaVersion, app, document: GfxDocument }
├── pixels/<layerId>.png   one PNG per raster layer's rgba (8-bit straight-alpha)
├── masks/<layerId>.png    one grayscale PNG per layer mask
└── thumbnail.png          optional
```

- **`PixelRef` decouples pixels from JSON.** `PixelRef { kind:"png", path, w, h }` is the default (the `image 0.25` codec is already a dependency; PNG gives free spatial compression). **`PixelRef { kind:"raw16" }` (a deflate chunk of the native `Vec<u16>`) is required for `depth>8` documents** — saving a 16/32-bit doc through 8-bit PNG silently loses tonal precision (see §10.5). A `kind:"base64"` variant keeps a pure-JSON escape hatch for zip-less environments.
- **Manifest is pretty-printed JSON** via `serde_json::to_string_pretty`, with `serde_json` `features=["preserve_order"]` (already on, `Cargo.toml:34`) so foreign `data`/`extra` round-trip byte-faithfully.
- **Reuse the envelope patterns, fresh spine.** `GfxDocument` is a sibling to the timeline `MonetDocument`, reusing the `format`/`schemaVersion`/`app` header, `#[serde(flatten)] extra`, camelCase + `skip_serializing_if`, and the per-app `data` bag with the exact `get_data`/`set_data` accessors (`serialize.rs:101-119`).

### 8.5 Versioning & forward-compat

1. **Envelope version gate** (from `format::parse`, `serialize.rs:42-80`): validate `format`, reject `schemaVersion > SCHEMA_VERSION`, tolerate a non-numeric version, then deserialize and run `normalize_graphics_document` (fill defaults, repair dangling `parent` ids, default `transform` to identity).
2. **`#[serde(flatten)] extra` everywhere** + `preserve_order`: a v1 reader opening a v2 file preserves v2-only fields on save.
3. `parse` adopts Artisan's lenient unwrap (`model.rs:336-348`): accept either the bare `GfxDocument` or the `{format, schemaVersion, document}` wrapper.

### 8.6 Import adapters (read-only paths into the unified doc)

All are stateless `fn(input) -> GfxDocument`, slotting between the existing parsers and the engine. `format_import::from_doc` is retargeted to consume `GfxDocument`; `LayerKind::Vector` falls into its kind dispatch like `Raster`/`SmartObject`.

| Source | Adapter | Mapping |
|---|---|---|
| **PSD / PSB / XCF** | `from_import(import::Document)` | reuse the existing `monet-format` importers; each `import::Layer` → `GfxDocument::Layer` 1:1 (grafted fields are identical); `to_index()` → `BlendMode::from_u8`; `source` recorded |
| **`.artisan`** | `from_artisan(model::Document)` | the whole document becomes **one `LayerKind::Vector` layer** whose `scene` is the parsed `model::Document` (preserving its internal artboards/layers/items); `meta.colorMode/units/dpi` → `color_mode` + `extra` |
| **`.mvsn`** | `from_mvsn(reader)` | Vision's current project is a **header-led binary blob** written and read in `packages/engine/src/raster/mod.rs` — magic `b"MVSN"` at offset 0, version at offset 4, current `MVSN_VERSION = 15`; **not** a trailer. Version 15 appends the bounded Paint Symmetry mode/segments plus its centre, normalized angle, and uniform scale. The adapter reads its layer fields (pixels u16→PNG/raw16, mask, blend byte, the legacy flat-polygon vector fields) into `GfxDocument::Layer`; legacy `vector_path` polygons are upgraded into a `VectorPayload` (handle-less `Anchor`s, `closed:true`) |

PSD/PSB layers identified by `SoLd`/`PlLd` retain `SmartObject` kind through the
adapter. Until the import IR carries the native embedded or linked source, the
layer's rendered full-canvas proxy is also its engine `smart_src`; this preserves
the non-destructive Vision lifecycle without claiming native source recovery.
Unified `.monetgfx` import applies the same kind/proxy mapping, but its current
export still carries only the rendered proxy—not an existing Smart Filter stack,
source payload, or placement metadata. Those remain `.mvision`-only state.

### 8.7 MVSN-only Vision state needs an explicit home

Several pieces of Vision state have **no first-class field** in the unified document and would be silently lost unless explicitly persisted into the per-app `data["vision"]` bag. Enumerate and persist them there:

- animation `frames` (the `Vec<Vec<u8>>` snapshots), saved selections / channels, `link_group`, `solo`, document `mode` (Gray/CMYK/Lab) and `depth`, Paint Symmetry mode/segments/similarity transform, and the legacy `vector_path`/`vector_subpath_lens`/`vector_is_mask` for any layer not upgraded to a Vector kind.

Likewise Artisan-only document state goes in `data["artisan"]`. This keeps the shared schema clean while making the round-trip provably lossless.

---

## 9. Migration & rollout

**Strictly incremental and dual-live:** at the end of every phase both apps ship from `main` with UX intact, every saved file still opens, and **both legacy engine crates remain buildable until the final phase**. The riskiest work (moving Vision's ~642 KB `lib.rs` / 356 methods) happens *behind a still-unused crate* before either app depends on it.

**Invariants across all phases:** the blit contract (`init` → cache `memory` → `new Engine` → `Uint8Array(mem, output_ptr(), w*h*4)` → `putImageData`) never changes; the exported `Engine` type **name** never changes (so the TS `import` line is untouched and the only Vite edit is the alias filename); `@engine` stays an alias to a `wasm-pack --target web` artifact; **byte-for-byte golden-image parity** is the acceptance gate for any phase that routes an app's pixels through new code.

| Phase | Ships | Both apps keep working because… | Tests / gate |
|---|---|---|---|
| **0. Scaffold** | empty-but-compiling `packages/engine/` + build/Vite plumbing; apps still alias their own `pkg/` | nothing is repointed yet | CI builds the scaffold to wasm; a smoke `cargo test` |
| **1. Raster core in** | `git mv apps/vision/engine/src/* → packages/engine/src/raster/`; merged `Engine` *is* Vision's `Engine`; **no app aliases it yet** | Vision still on its legacy crate; Artisan untouched | **Parity oracle (0-diff):** link both rlibs, assert `engine_a.output == engine_b.output` over a PSD/`.mvsn` corpus. This is a pure move, so it must be 0-diff |
| **2. Vector layer kind** | `git mv apps/artisan/engine/src/* → packages/engine/src/vector/`; add `kind==3`, `vector_scene` field, `render_vector` (background-stripped rasterize), creators; extend `save_project`/`load_project` for the new field; `composite_layer_px` untouched | Vector kind is dormant — no live frontend calls a creator yet | Vector golden tests vs Artisan's own (background-stripped) rasterizer as oracle; exact u8→u16→f32 bridge test; assert the documented skip-set still produces overlay-compatible "nothing drawn" |
| **3. Format + adapters** | `document.rs` unified `GfxDocument` + serde (+ add serde to the 13 `import::` types & `extra`-flatten to Artisan sub-structs on a monet-ui branch); adapters from `.mvsn`/`.artisan`/PSD | adapters are **additive readers**; no frontend emits the new format yet, so no saved file is rewritten | round-trip tests (the `extra` map survives byte-faithfully **after** flatten is added); adapter golden tests reuse the Phase 1 & 2 oracles |
| **4. Vision cutover** | repoint Vision's `engine:build`/Vite alias to `packages/engine`; **`EngineClient.ts` unedited** (same `Engine` type/methods + additive `vector_*`) | legacy `apps/vision/engine/` stays in the tree → rollback is a one-line alias revert | Phase 1 parity corpus stays 0-diff against the shipped wasm (**go/no-go**); Vision `test:e2e`; one e2e creating a vector layer + applying a filter on top |
| **5. Artisan cutover** | repoint Artisan's build/alias; whole-canvas flow preserved via the thin `set_document`/`set_view`/`render` shims (single Vector-layer doc); **SVG fallback split retained as-is** | the SVG overlay keeps drawing the skip-set, so Artisan output is visually unchanged | Artisan-vs-merged golden (non-skipped set 0-diff; skipped set draws nothing → no double-draw); Artisan `e2e:all` |
| **6. Deprecate legacy** | delete both `apps/*/engine/{Cargo,src}`; collapse root `build:engines` to build the shared crate per app sink (+ cinema untouched) | both apps build solely from `packages/engine`; dead-code removal only | full green: `build:engines`, both app builds, `cargo test`, both e2e suites — the standing CI definition of done |

**Rollback posture:** per-phase rollback is a one-line revert of a Vite alias filename (4, 5) or a script (0–3); the legacy crates survive until Phase 6, whose deletion is gated on two phases of shipped parity. **Closing the skip-gap natively (text/effects/masks/patterns/stroke-align) is post-migration work** sequenced after Phase 5 — each capability removes one branch from `has_svg_fallback` independently, behind a golden test against the overlay, with text last and largest.

**Build-wiring Option A vs B (binding — see §10.1):** Option A double-builds the merged wasm into each app's own `pkg/` (preserves `@engine` verbatim, smallest diff, **keeps codec feature-gating viable**). Option B ships one shared `packages/engine/pkg/` (single artifact, but forces Artisan to carry Vision's full codec weight and needs `server.fs.allow` to include the repo root). The plan uses **Option A**.

---

## 10. Risks, tradeoffs & performance

### 10.1 Bundle size — Artisan inherits Vision's ~9 MB codecs (HIGH)

A naive merge ships one ~9 MB wasm to both apps; Artisan's grows ~8× for `psd`/`rawloader`/`image` it never uses. **Mitigation: Cargo feature gating.**

```toml
# packages/engine/Cargo.toml
[features]
default = []
codecs-psd = ["dep:psd"]; codecs-raw = ["dep:rawloader"]; codecs-image = ["dep:image"]
vision-import = ["codecs-psd", "codecs-raw", "codecs-image"]
```

Build Vision `--features vision-import`, Artisan with none; gate `format_import.rs` and any codec-touching `#[wasm_bindgen]` method behind `#[cfg(feature = …)]`. Because each app loads its own `pkg/` (Option A), the builds can legitimately differ — feature gating **does not** cost the merge's core benefit (zero-copy holds *within* one module). **Binding consequence:** Option B (one shared module) is mutually exclusive with feature gating. Runtime code-splitting inside one wasm module is not practical; compile-time gating is the lever.

### 10.2 Build time & LTO (MED)

Fat `lto=true` + `codegen-units=1` over the unioned dependency tree lengthens release builds super-linearly. Use `lto="thin"` for the merged release profile (reserve fat LTO for shipping), keep `--dev` (no LTO) for iteration; feature-gating also drops three codec crates from Artisan's build. Measure wasm-size delta before committing.

### 10.3 Re-rasterizing on zoom (MED — guard in review)

The cost per re-raster at 4K is ~33 M u16 writes for the promotion alone, on the main thread (neither app uses a worker). Caching bounds it, and the bounds must be enforced in review:

- **`composite()`/`composite_region()` must never call `render_vector` in the hot loop** — the failure mode is every brush dab / slider drag paying a full vector raster. Re-raster entry points are scene edit, zoom, layer transform, and resize only.
- **Pure pan is a cache hit** (key designed so only zoom/size/revision invalidate). 
- **Clamp resolution during an active zoom gesture** (cap at viewport pixels) and re-raster sharp on gesture end — and respect the `fx_frozen`-style freeze during drags (§5.2).

### 10.4 Faithfulness — the skip-gap & interim overlay (HIGH for text)

Until text/effects/masks/patterns/stroke-align are native (§6), a vector layer using them rasterizes **incomplete** (no host overlay sits over a Vision canvas). **Interim strategy:** keep host rendering for the skip-set during the transition — host-rasterize text to RGBA8 (as Vision already does at `lib.rs:3433-3554`) and blit it, or emit path geometry and overlay SVG for just those items. Explicit, documented debt; text shaping/fonts is the long pole (OQ1).

### 10.5 Color-precision loss (MED, documented)

The bridge is lossless; loss is upstream in tiny-skia's 8-bit rasterization (256 levels/channel for vector content in a 16-bit doc; premultiplied low-alpha fringing). The outer blend stays in Vision's f32 `composite_over`. Ship 8-bit first; a u16 vector rasterizer is a deferred upgrade behind the same seam. **Persist `depth>8` documents via `raw16` `PixelRef`, not PNG** (§8.4), or the precision is lost on save too. Do **not** switch Vision to linear compositing.

### 10.6 Coupling two products (inherent)

One crate → a bug in shared composite/blend/color code, or a memory-growth/OOB bug, destabilizes **both** apps, and the shared linear memory means one half can scribble the other's buffers. Cannot be designed away, only contained: keep `console_error_panic_hook`, pin each app to a known-good `Cargo.lock`, and run **both** apps' e2e on every shared-crate change (non-negotiable).

### 10.7 The Vision integration surface (MED — bounded)

Good news from the survey: the **compositor and undo need no change** (vector composites through the same else-branch as smart objects; the new `Layer` field rides `#[derive(Clone)]` undo). The bounded, additive work is: a kind code, the `vector_scene` field, `render_vector`, the `save_project`/`load_project` extension, and the two creators. The real cost lives in re-homing Artisan's 54 methods and **re-rooting `query.rs`/`ops.rs`/`pathfinder.rs` to operate on a scene nested inside a Vision layer** rather than a top-level `Document` — the index paths and world-transform threading there assume `Document.layers[].items[]`, and that re-rooting is the likeliest place for subtle bugs. Contain `lib.rs` growth by keeping `vector/*` as separate files that thin `#[wasm_bindgen]` methods delegate into (mirroring `adjust`/`blend`/`effects`/`filters`).

---

## 11. Open questions for the team

1. **Text rendering + fonts in wasm (the long pole).** The engine now uses `rustybuzz`/`ttf-parser` with a runtime font-provisioning API and deterministic fallback glyphs. Remaining decisions are how broadly to expose the host catalog, how to perform script-aware fallback and paragraph composition, and when to promote `extra["text"]` runs/props to first-class fields.
2. **Do vectors ever need true resolution-independent display, or is raster-on-zoom sufficient forever?** The chosen design is raster-on-zoom; if infinite-zoom crispness is later required it needs a different display path (GPU tessellation / re-raster-per-frame). Keep the `render_vector` seam swappable.
3. **Container: base64-in-JSON for v1, or the zip container up front?** Zip is leaner but more code; base64 ships fastest. (`raw16` for `depth>8` is required either way.)
4. **Invest in a u16 vector rasterizer?** Ship 8-bit tiny-skia first; revisit only if banding in 16-bit documents proves unacceptable.
5. **Does Cinema's engine join later?** `cinema-engine` is near-empty and untouched here; decide whether the merged graphics engine should eventually back Cinema's per-frame graphics (which would influence bridging the format to the `format::` timeline envelope).
6. **Build-wiring A vs B** (binding, §10.1): if Artisan bundle size matters at all, Option A is mandatory.

---

## 12. Recommendation — carried out

This recommendation is **discharged**: Phases 0–6 shipped as planned (§1a), the
legacy `apps/vision/engine` and `apps/artisan/engine` crates are deleted, and
Vision, Artisan and Galerie all build from `packages/engine`. Cinema's
`apps/cinema/engine` (`cinema-engine`) is still a standalone crate, built by its
own `cd engine && wasm-pack`, and is not yet merged. The phasing held, though
the rollback estimate above was optimistic by a line: each cutover (592f20f2)
repointed three lines per app — `engine:build`, `engine:build:release` and the
`@engine` alias — not one, and stayed revertible until the legacy crates were
removed in Phase 6. The skip-gap was closed natively afterwards, as sequenced,
with text last.

The architecture held for the reason predicted: the merge reuses two things that already exist — Vision's compositor (which can't tell a rasterized vector layer from a smart object) and Artisan's vector model (which becomes the format's vector half wholesale). The **headless text** work called out here as the open-ended risk is now in the engine (`rustybuzz`/`ttf-parser` shaping with runtime font provisioning); what remains of it is the §11 question of catalog exposure and paragraph composition, not the substrate.

---

*Provenance: this design was produced from a code-level survey of `apps/vision/engine`, `apps/artisan/engine`, both frontends, and `packages/monet-ui/crates/monet-format`, and its load-bearing claims (the smart-object composite path, the 28-entry blend reconciliation, the `serde`/`extra` round-trip behavior, the MVSN header format, and the artboard-background fork) were verified against the source before publication.*
