//! Vector rasterize-on-demand subsystem — lifted from Monet Artisan
//! (`apps/artisan/engine/src/`).
//!
//! Owns the Artisan scene graph ([`model::Document`]), tiny-skia rasterization,
//! i_overlay boolean ops, hit-testing, and structural/anchor editing. It knows
//! nothing about the raster `Layer`, `output`, undo, or blend semantics. The
//! surfaces `raster/` depends on are [`rasterize`] (rendering) and the
//! re-exported editing/query modules ([`ops`], [`pathfinder`], [`query`]).
//!
//! NOTE: Artisan's standalone `#[wasm_bindgen] Engine` and its
//! `#[wasm_bindgen(start)]` are deliberately NOT lifted — the merged crate has a
//! single `Engine` (Vision's) and a single panic-hook `start` at the crate root.
//! Only the pure subsystem modules come across.

use tiny_skia as sk;

pub mod factory;
pub mod fonts;
pub mod geom;
pub mod model;
pub mod ops;
pub mod pathfinder;
pub mod query;
pub mod render;
pub mod shapes;

/// The vector scene reused verbatim from the Artisan model: artboards + layers +
/// items, with `#[serde(flatten)] extra` forward-compat. A `kind == Vector`
/// raster layer owns one of these as its editable source of truth.
pub use model::Document as VectorScene;

/// Rasterize a vector scene into **straight-alpha 8-bit RGBA** at `w`×`h`,
/// sampling the scene through `view` (the layer→canvas affine, with DPR/zoom/
/// rotation folded in). This is the single seam `raster/` calls.
///
/// Mirrors Artisan's `Engine::render`, but:
/// - uses [`render::render_layers`] so artboard background pages are NOT painted
///   (design doc §5.4) — the buffer is transparent where the scene is empty;
/// - un-premultiplies tiny-skia's premultiplied pixmap into straight alpha, the
///   exact layout Vision's compositor ingests (no channel swizzle, no
///   re-premultiply).
pub fn rasterize(scene: &model::Document, w: u32, h: u32, view: sk::Transform) -> Vec<u8> {
    let mut out = vec![0u8; (w as usize) * (h as usize) * 4];
    let Some(mut pixmap) = sk::Pixmap::new(w, h) else {
        return out; // zero-area canvas → transparent buffer
    };
    render::render_layers(&mut pixmap, scene, view);

    // tiny-skia stores premultiplied RGBA8; convert to straight alpha in place.
    let src = pixmap.data();
    for i in 0..(w as usize) * (h as usize) {
        let (r, g, b, a) = (src[i * 4], src[i * 4 + 1], src[i * 4 + 2], src[i * 4 + 3]);
        let (ur, ug, ub) = unpremultiply(r, g, b, a);
        out[i * 4] = ur;
        out[i * 4 + 1] = ug;
        out[i * 4 + 2] = ub;
        out[i * 4 + 3] = a;
    }
    out
}

/// Un-premultiply a single premultiplied RGB triplet by `a` (straight alpha).
#[inline]
fn unpremultiply(r: u8, g: u8, b: u8, a: u8) -> (u8, u8, u8) {
    match a {
        0 => (0, 0, 0),
        255 => (r, g, b),
        a => {
            let a = a as u32;
            let up = |c: u8| (((c as u32) * 255 + a / 2) / a).min(255) as u8;
            (up(r), up(g), up(b))
        }
    }
}
