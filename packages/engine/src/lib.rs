//! `monet-render-engine` — the unified Monet raster + vector WASM engine.
//!
//! This crate merges the Monet **Vision** raster compositor (`raster/`) and the
//! Monet **Artisan** vector rasterizer (`vector/`) into a single `cdylib` so both
//! halves share one linear memory. A "vector" layer is a new layer kind whose
//! Artisan-style scene is rasterized on demand by tiny-skia into the layer's
//! pixel buffer, then composited by Vision's compositor exactly like a raster
//! layer (the smart-object precedent).
//!
//! See `docs/merged-engine-and-format.md` for the full design.
//!
//! ## Build phases (see the design doc §9)
//! - **Phase 0 (this commit):** scaffold — empty-but-compiling crate + build wiring.
//! - Phase 1: lift Vision's raster core into `raster/`.
//! - Phase 2: lift Artisan's vector subsystem into `vector/`; add the Vector kind.
//! - Phase 3: the unified `document` model + serde + import adapters.

use wasm_bindgen::prelude::*;

pub mod document;
pub mod raster;
pub mod vector;

/// Module-load side effect: install the panic hook once. Idempotent.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// Crate version — smoke-tests the build + JS bindings end-to-end.
#[wasm_bindgen]
pub fn engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_is_pkg_version() {
        assert_eq!(super::engine_version(), env!("CARGO_PKG_VERSION"));
    }
}

/// Phase 2 acceptance: a Vector layer rasterizes via tiny-skia and composites
/// through the UNCHANGED raster compositor, on top of the white background a new
/// Engine seeds — proving the smart-object-precedent wiring end to end.
#[cfg(test)]
mod vector_layer_tests {
    use crate::raster::Engine;

    fn px(e: &Engine, x: u32, y: u32) -> (u8, u8, u8, u8) {
        let w = e.width();
        let buf =
            unsafe { std::slice::from_raw_parts(e.output_ptr(), (w * e.height() * 4) as usize) };
        let i = ((y * w + x) * 4) as usize;
        (buf[i], buf[i + 1], buf[i + 2], buf[i + 3])
    }

    fn red_pixels(e: &Engine) -> usize {
        let n = (e.width() * e.height() * 4) as usize;
        let buf = unsafe { std::slice::from_raw_parts(e.output_ptr(), n) };
        buf.chunks_exact(4)
            .filter(|px| px[0] > 200 && px[1] < 80 && px[2] < 80 && px[3] == 255)
            .count()
    }

    #[test]
    fn vector_layer_rasterizes_and_composites() {
        // A solid red rect at world (10,10)..(40,40) over the white background.
        let scene = r#"{"artboards":[],"layers":[{"visible":true,"opacity":1,
            "blendMode":"normal","items":[
              {"type":"rect","transform":{"a":1,"b":0,"c":0,"d":1,"e":10,"f":10},
               "width":30,"height":30,
               "fill":{"type":"solid","color":{"r":220,"g":30,"b":40,"a":1}},
               "stroke":{"paint":{"type":"none"},"width":0},
               "opacity":1,"blendMode":"normal","visible":true}]}]}"#;

        let mut e = Engine::new(64, 64);
        let id = e.add_vector_layer(scene, "Vector");
        assert_eq!(e.layer_kind(id), 3, "layer registered as the Vector kind");

        // Inside the rect → red (straight-alpha RGBA8, opaque).
        let (r, g, b, a) = px(&e, 20, 20);
        assert!(
            r > 180 && g < 80 && b < 90 && a == 255,
            "inside rect = red, got {:?}",
            (r, g, b, a)
        );

        // Outside the rect → the opaque white background shows through.
        let (r, g, b, a) = px(&e, 55, 55);
        assert!(
            r > 250 && g > 250 && b > 250 && a == 255,
            "outside rect = white bg, got {:?}",
            (r, g, b, a)
        );

        // Re-rasterize-on-zoom: doubling the view scale keeps it composable and
        // grows the painted region (the rect now covers (20,20)..(80,80) world).
        e.vector_set_view(id, 0.0, 0.0, 2.0, 0.0);
        let (r, g, b, _) = px(&e, 30, 30);
        assert!(
            r > 180 && g < 80 && b < 90,
            "zoomed rect still red at (30,30), got {:?}",
            (r, g, b)
        );
    }

    #[test]
    fn graphics_document_round_trips_through_engine() {
        // A vector red rect over the white background, saved to the unified
        // format and reloaded into a fresh engine, must composite identically.
        let scene = r#"{"artboards":[],"layers":[{"visible":true,"opacity":1,
            "blendMode":"normal","items":[
              {"type":"rect","transform":{"a":1,"b":0,"c":0,"d":1,"e":8,"f":8},
               "width":24,"height":24,
               "fill":{"type":"solid","color":{"r":220,"g":30,"b":40,"a":1}},
               "opacity":1,"blendMode":"normal","visible":true}]}]}"#;
        let mut a = Engine::new(48, 48);
        a.add_vector_layer(scene, "Vec");

        let json = a.save_graphics();
        assert!(json.contains("monet-graphics"));

        let mut b = Engine::new(4, 4); // wrong size on purpose — load replaces it
        b.load_graphics(&json).expect("load unified document");
        assert_eq!(
            (b.width(), b.height()),
            (48, 48),
            "canvas restored from doc"
        );

        let n = (48 * 48 * 4) as usize;
        let abuf = unsafe { std::slice::from_raw_parts(a.output_ptr(), n) };
        let bbuf = unsafe { std::slice::from_raw_parts(b.output_ptr(), n) };
        assert_eq!(
            abuf, bbuf,
            "composited output identical after gfx round-trip"
        );
    }

    #[test]
    fn vector_scene_round_trips_json() {
        let scene = r#"{"artboards":[],"layers":[{"visible":true,"opacity":1,
            "blendMode":"normal","items":[
              {"type":"rect","transform":{"a":1,"b":0,"c":0,"d":1,"e":0,"f":0},
               "width":10,"height":10,
               "fill":{"type":"solid","color":{"r":10,"g":20,"b":30,"a":1}},
               "opacity":1,"blendMode":"normal","visible":true}]}]}"#;
        let mut e = Engine::new(32, 32);
        let id = e.add_vector_layer(scene, "V");
        let json = e.vector_scene_json(id);
        assert!(
            json.contains("\"rect\""),
            "scene serializes back to JSON: {json}"
        );
        // And it re-parses into the same engine without error.
        e.vector_set_scene(id, &json).expect("re-set parsed scene");
        assert_eq!(e.layer_kind(id), 3);
    }

    #[test]
    fn vector_font_registration_rerenders_existing_vector_layers() {
        crate::vector::fonts::clear_fonts();
        let scene = r#"{"artboards":[],"layers":[{"visible":true,"opacity":1,
            "blendMode":"normal","items":[
              {"type":"text","text":"A","fontFamily":"VisionEngineOutline","fontSize":28,
               "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":34},
               "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
               "opacity":1,"blendMode":"normal","visible":true}]}]}"#;
        let mut e = Engine::new(56, 44);
        e.add_vector_layer(scene, "Text");
        let fallback_count = red_pixels(&e);

        e.register_vector_font(
            "VisionEngineOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("font registers");
        let outline_count = red_pixels(&e);
        crate::vector::fonts::clear_fonts();

        assert!(outline_count > 0, "registered font keeps text visible");
        assert_ne!(
            outline_count, fallback_count,
            "font registration invalidates the existing vector cache and rerenders"
        );
    }

    #[test]
    fn vector_font_batch_defers_rerender_until_end() {
        crate::vector::fonts::clear_fonts();
        let scene = r#"{"artboards":[],"layers":[{"visible":true,"opacity":1,
            "blendMode":"normal","items":[
              {"type":"text","text":"A","fontFamily":"VisionEngineOutline","fontSize":28,
               "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":34},
               "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
               "opacity":1,"blendMode":"normal","visible":true}]}]}"#;
        let mut e = Engine::new(56, 44);
        e.add_vector_layer(scene, "Text");
        let fallback_count = red_pixels(&e);

        e.begin_vector_font_batch();
        e.register_vector_font(
            "VisionEngineOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
        )
        .expect("font registers");
        // Inside the batch the vector cache is untouched, so the composited
        // output still shows the bitmap fallback rather than the outline.
        let during_batch = red_pixels(&e);
        e.end_vector_font_batch();
        let after_end = red_pixels(&e);
        crate::vector::fonts::clear_fonts();

        assert_eq!(
            during_batch, fallback_count,
            "registration inside a batch defers the vector-layer rerender"
        );
        assert!(after_end > 0, "ending the batch keeps the text visible");
        assert_ne!(
            after_end, fallback_count,
            "end_vector_font_batch applies the batched registrations with one rerender"
        );
    }

    #[test]
    fn vector_font_face_registration_rerenders_existing_vector_layers() {
        crate::vector::fonts::clear_fonts();
        let scene = r#"{"artboards":[],"layers":[{"visible":true,"opacity":1,
            "blendMode":"normal","items":[
              {"type":"text","text":"A","fontFamily":"VisionEngineOutline","fontSize":28,"fontWeight":700,
               "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":34},
               "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}},
               "opacity":1,"blendMode":"normal","visible":true}]}]}"#;
        let mut e = Engine::new(56, 44);
        e.add_vector_layer(scene, "Text");
        let fallback_count = red_pixels(&e);

        e.register_vector_font_face(
            "VisionEngineOutline",
            crate::vector::fonts::demo_font_bytes(),
            0,
            700.0,
            false,
        )
        .expect("styled font registers");
        let outline_count = red_pixels(&e);
        crate::vector::fonts::clear_fonts();

        assert!(
            outline_count > 0,
            "styled registered font keeps text visible"
        );
        assert_ne!(
            outline_count, fallback_count,
            "styled font registration invalidates the existing vector cache and rerenders"
        );
    }

    #[test]
    fn vector_font_face_inspection_reports_registerable_metadata() {
        let e = Engine::new(8, 8);
        let json = e
            .inspect_vector_font_faces(crate::vector::fonts::demo_font_bytes())
            .expect("demo font metadata inspects");
        let faces: serde_json::Value = serde_json::from_str(&json).expect("metadata json parses");
        let face = faces
            .as_array()
            .and_then(|items| items.first())
            .expect("at least one face")
            .as_object()
            .expect("face object");

        assert_eq!(face.get("faceIndex").and_then(|v| v.as_u64()), Some(0));
        assert_eq!(face.get("weight").and_then(|v| v.as_f64()), Some(400.0));
        assert_eq!(face.get("italic").and_then(|v| v.as_bool()), Some(false));
        assert_eq!(
            face.get("family").and_then(|v| v.as_str()),
            Some("Untitled Font 1")
        );
    }

    /// Apple's system fonts lead their `name` table with Macintosh records, and
    /// several (Helvetica, Helvetica Neue, Menlo, Futura…) carry their family
    /// name ONLY there. A lookup that gives up on the first record it cannot
    /// decode reported "Untitled Font N" for most of an installed font set, so
    /// the Character panel's Style picker fell back to the generic four and
    /// Type ▸ Convert to Shape never got the real glyph outlines.
    #[test]
    fn face_inspection_reads_macintosh_and_windows_name_records() {
        let e = Engine::new(8, 8);
        let json = e
            .inspect_vector_font_faces(include_bytes!("vector/testdata/named_font.ttf"))
            .expect("named font metadata inspects");
        let faces: serde_json::Value = serde_json::from_str(&json).expect("metadata json parses");
        let face = faces
            .as_array()
            .and_then(|items| items.first())
            .expect("at least one face")
            .as_object()
            .expect("face object");
        let text = |key: &str| face.get(key).and_then(|v| v.as_str());

        // A Macintosh record sits before the Windows one; reaching it must not
        // discard the English family name that follows.
        assert_eq!(text("family"), Some("Windows Family"));
        // Mac Roman only, including a high-half byte (0x8E) ttf-parser declines
        // to decode: "Café Mac", not a dropped name or mojibake.
        assert_eq!(text("fullName"), Some("Café Mac"));
        assert_eq!(text("postscriptName"), Some("MacOnlyPS"));
    }

    /// The seam the "Untitled Font N" defect fell through, from this side: what
    /// the parser returns has to be the name the HOST matches its font stacks
    /// on. Vision's DEFAULT_VECTOR_FONT_STACKS ask for "Verdana"; a face that
    /// comes back as anything else is never registered, and the Character
    /// panel's Style picker silently falls back to the generic four.
    /// The other half is pinned in apps/vision/src/engine/vectorFonts.test.ts.
    #[test]
    fn an_apple_shaped_face_reports_the_family_the_host_asks_for() {
        let e = Engine::new(8, 8);
        let json = e
            .inspect_vector_font_faces(include_bytes!("vector/testdata/stack_font.ttf"))
            .expect("metadata inspects");
        let faces: serde_json::Value = serde_json::from_str(&json).expect("json parses");
        let family = faces
            .as_array()
            .and_then(|items| items.first())
            .and_then(|face| face.get("family"))
            .and_then(|v| v.as_str());

        assert_eq!(family, Some("Verdana"));
    }
}
