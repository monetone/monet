# 11 — One container, seven extensions

**Status:** design agreed 2026-07-22. Supersedes the split between the zip
`.monetgfx` graphics container and the bare-JSON `.monet` time document.

## The shape

Every Monet app saves the **same container**: a ZIP (stored, no compression)
whose **first entry is `manifest.json`**. Only the *extension* and the *entries
inside* differ per app.

| App | Extension | Primary entries |
|---|---|---|
| Vision | `.mvis` | `graphics.json` + `pixels/*` |
| Artisan | `.mart` | `graphics.json` (vector layer) + `pixels/*` |
| Galerie | `.mgal` | `db/catalog.sqlite` + `previews/*` |
| Cinema | `.mcin` | `timeline.json` + `media/*` |
| Anime | `.mani` | `timeline.json` + `images/*` |
| Rythme | `.mryt` | `timeline.json` + `audio/*` |
| Jouer | `.mjou` | `scene.json` + `assets/*` |

**Any app may carry its own database.** An entry is opaque bytes at a path, so
a SQLite file is just an entry with `"role": "database"` under `db/`. Galerie's
catalog is the first user; Cinema's media index and Rythme's sample library are
the obvious next ones. Nothing in the container is graphics-specific.

**Every app opens every extension.** Dispatch is on the manifest, never on the
extension — a `.mcin` renamed to `.mvis` still opens correctly, and a `.mvis`
dropped on Rythme opens as far as Rythme understands it.

## manifest.json

```jsonc
{
  "format": "monet",          // universal discriminator
  "schemaVersion": 1,
  "app": { "name": "monet-vision", "version": "0.1.0" },  // who wrote it last
  "kind": "graphics",         // primary payload class: graphics | time | catalog | scene
  "entries": [
    { "path": "graphics.json", "role": "graphics" },
    { "path": "pixels/1.png",  "role": "pixels" }
  ]
}
```

`role` is what a reader dispatches on. An unknown `role` is not an error.

## The four rules

1. **Open what you understand.** An app loads the entries whose `role` it
   handles and reports — visibly, not to the console — what it ignored. A
   Rythme file opened in Vision is not an error; it is a document with no
   graphics entry.

2. **Courier everything else, byte-for-byte.** An app that re-saves a container
   MUST write back every entry it did not consume, unchanged, and preserve
   foreign `data.<app>` namespaces and unknown manifest fields. This is the rule
   the whole design rests on: without it, round-tripping through a second app
   silently destroys the first app's work. It is already enforced for
   `GfxDocument.data`/`extra` and for the `.monet` adapters; the container
   extends it to whole entries.

3. **Additive only.** New entries and new manifest fields never bump
   `schemaVersion`. A v1 reader keeps unknown entries (rule 2) and re-emits
   unknown manifest keys from `extra`. Bump only on a genuinely breaking change,
   and a reader must reject a strictly higher version rather than guess.

4. **No backwards compatibility — this is alpha.** There is exactly one
   readable shape: a v1 container. `format: "monet-graphics"`, bare-JSON
   `.monet` and the per-app legacy readers are **deleted**, not deprecated, and
   files written before this cut do not open. Old data is expected to be thrown
   away. Rule 3 still holds in the other direction: unknown entries and unknown
   manifest fields are couriered, because that is forward-compat, which we do
   want.

   Deleting this removed ~600 lines and, with them, an entire class of defect —
   the legacy path needed byte-identical re-save, read-only semantics, a
   freeze+digest mutation guard and an explicit migrate step, and three review
   rounds still found silent data loss in it. None of that has to be right now.

   **Not migration, and NOT deleted:** foreign-format import (PSD/PSB, XCF,
   AI/EPS, SVG, PDF, CDR, camera RAW/DNG) is interop with other vendors, a
   feature in its own right. `normalizeRecipe`'s clamps and caps are a hostile-
   input trust boundary. Vision's Canonical→V2 conversion is a live boundary
   between its internal authoring vocabulary and the shared schema, not an
   upgrade path for old files.

   A parsed `.monetgfx` **keeps its original bytes** and saves as exactly those
   bytes — a memcpy, not a re-zip that hopes to match. That is what makes the
   byte-identity real, and it removes a whole class of drift for free (entry
   order, general-purpose flag bits, mod times, extra fields, data descriptors).
   The consequence: a legacy container is **read-only**. Its document *is*
   `manifest.json` and its roles are re-derived from paths on every open, so no
   edit can land without rewriting the archive. `set`/`remove` (`setEntry`/
   `removeEntry`) and a mutated manifest all return `Err`/throw, naming the
   remedy — `migrate_to_v1()` / `migrateContainerToV1()`, which is what
   saving-as means. **Fail loudly, not plausibly**: silently accepting a write
   and dropping it on save is worse than refusing the open.

## Databases go through a common library

No app talks to SQLite directly. Two shared pieces, and every app interfaces
through them. **Alpha: there is no migration runner** — a database is created at
the current schema in one step, and an older one is not upgraded.

- **`packages/monet-ui/crates/monet-db`** (Rust) — open/create, the migration
  runner (versioned, forward-only), transactions, integrity check, backup,
  and the container lifecycle below. Generic: it knows about *a* database, not
  about photos.
- **`@monet-ui/monet-db`** (TS) — the typed bridge over the Tauri commands, the
  same shape `@monet-ui/monet-format` already uses.

**Extracted, not rewritten — and the generic part is SMALL.** A survey of
`apps/galerie/src-tauri/src/catalog.rs` (8113 lines, the repo's only `rusqlite`
dependency) corrects an earlier estimate in this doc: its `pub mod db` is
overwhelmingly *photo domain* — `import_photo`, `list_photos`, stacks,
snapshots, keywords, presets, virtual copies. That belongs to Galerie and stays
there. What is genuinely generic is a few hundred lines:

- `open` + the pragma set (WAL, foreign keys, busy timeout)
- `version` / `set_version` over `user_version`, and the forward-only migration
  runner — which takes the app's migration steps as data, since the steps
  themselves are app schema
- `ensure_column` (the idempotent column adder every migration needs)
- `integrity_check`, `optimize`, backup, and `VACUUM INTO` — the last one is
  what produces the consistent snapshot the container packs
- `escape_like`, content digest / file identity
- the `Mutex<Option<Connection>>` state guard and its `with_conn` accessor

Galerie is the first consumer, not a parallel implementation. Its ~220 existing
`#[test]`s are the gate: the extraction is correct only if they all still pass
untouched.

**Container ↔ live database lifecycle.** SQLite cannot be operated inside a zip:

1. **Open** — extract the `db/*.sqlite` entry to the app's working directory,
   open it there, and remember the container path it came from.
2. **Work** — all reads/writes go to the working copy, normally.
3. **Save** — checkpoint/`VACUUM INTO` a consistent snapshot and write it back
   as that entry, couriering every other entry unchanged (rule 2).

A `.galcat` opened directly stays a live database with no container around it —
that path is unchanged. The container is for handing a whole session to another
app or another machine.

## Where the code lives

`packages/monet-ui/crates/monet-format` — the shared Rust crate — and reached
from TS through the wasm bridge that package **already has**
(`@monet-ui/monet-format`, `initMonetFormat()`, works in browser and in Node).

This is load-bearing: **jouer, anime and rythme do not link the render engine**,
so the container primitive cannot live in `packages/engine` where `zip_store`
sits today. One implementation, seven consumers.

## Known limits

- **4 GB per entry.** `zip_store` writes 32-bit sizes and offsets (no ZIP64), so
  a single entry — in practice a database — cannot exceed 4 GB, and neither can
  the archive. Far beyond any realistic session, but it is a hard wall, not a
  soft one: the writer must refuse rather than silently truncate.
- **Whole-entry I/O.** Entries are read and written whole, so packing a large
  catalog costs a full copy through memory. Fine at document scale; if a
  multi-GB catalog ever becomes normal, streaming entry I/O is the upgrade path.
  A parsed **legacy** `.monetgfx` costs one copy more: it holds the original
  archive alongside the entries so it can save verbatim.
- **Unknown manifest NUMBERS change on the JS lane.** The manifest crosses the
  wasm bridge as JSON *text* (a JS object cannot even hold a >2^53 integer —
  handing one over used to throw and make the document unopenable). It is then
  `JSON.parse`d into JS doubles and re-printed from there, so a number rule 2
  would otherwise courier byte-for-byte can come back different — in **both**
  directions:
  - **>2^53 integers are altered**: `9007199254740993` reads back as
    `…992` and **re-saves as `…992`**. The value is lost, permanently.
  - **A float's text form is whatever JS prints**: `24.0` → `24`, `1e2` → `100`.
    Semantically equal, not textually identical.

  The pure-Rust lane (`Container`) keeps both exactly; only the JS lane is
  affected. Fixing it needs a BigInt/raw-number-aware JSON parser *and* printer
  on the TS side — worth doing only if a writer ever depends on it. The ceiling
  is asserted in `test/container.test.ts`, not merely documented.
- `.galcat` stays the live-catalog format. `.mgal` is the portable container
  around a snapshot of it.
