// ─────────────────────────────────────────────────────────────
// monet-format — Monet's shared format library.
//
// One crate, three parts:
//   • `container` — the ONE document container every app reads + writes (a
//     stored ZIP whose first entry is `manifest.json`), with the courier rule
//     that keeps a foreign app's entries intact across a re-save. See
//     docs/plans/11-universal-container.md.
//   • `format` — the universal `.monet` PROJECT envelope every Monet app reads +
//     writes (sequences/tracks/clips with a self-describing per-sequence
//     timeBase and namespaced per-app `data` bags). Ported from the former
//     TypeScript `@monet-ui/monet-format`; it is the single source of truth.
//   • `import` — importers for foreign layered-document formats (Adobe PSD/PSB,
//     GIMP XCF today; "all kinds" over time) into a neutral `Document` IR.
//
// Pure logic by default, so it links into Rust apps (e.g. the Vision wasm
// engine) AND runs natively under `cargo test`. The optional `wasm` feature adds
// wasm-bindgen JS bindings for the `format` half, which `wasm-pack` packages for
// the app frontends (Cinema, Rythme, …).
// ─────────────────────────────────────────────────────────────

pub mod container;
pub mod format;
pub mod graphics;
pub mod import;

#[cfg(feature = "wasm")]
mod wasm;
