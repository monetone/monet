//! Unified layer-stack document model + serde — Phase 3.
//!
//! `GfxDocument`: one document with a layer stack where each layer is one of
//! { Raster, Adjustment, Text, Group, SmartObject, Vector }. Reuses Artisan's
//! `model::Document` as the Vector payload and grafts `monet-format`'s `import::`
//! raster model for the other kinds, with serde + a zip container added.
//!
//! Supersedes `.mvsn` and `.artisan`; PSD/PSB/XCF import via `monet-format`.
//! See `docs/merged-engine-and-format.md` §8.
//!
//! Phase 0: placeholder.
