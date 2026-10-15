//! Artisan's whole-canvas vector shim: one composite for overlapping items,
//! and no extra composite when `set_view` repeats the view already stored.

use super::{composite_calls, reset_composite_calls, Engine};

fn rgba(engine: &Engine, x: i32, y: i32) -> [u32; 4] {
    let packed = engine.pick_color(x, y);
    [
        (packed >> 24) & 255,
        (packed >> 16) & 255,
        (packed >> 8) & 255,
        packed & 255,
    ]
}

fn cache_key(engine: &Engine) -> Option<(u32, u32, [f32; 6])> {
    engine.layers[0]
        .vector_cache_key
        .as_ref()
        .map(|key| (key.w, key.h, key.view))
}

const STACKED: &str = r#"{
  "layers":[{"items":[
    {"type":"group","children":[
      {"type":"group","children":[
        {"type":"rect","width":8,"height":8,
          "transform":{"a":1,"b":0,"c":0,"d":1,"e":1,"f":2},
          "opacity":0.5,
          "fill":{"type":"solid","color":{"r":0,"g":0,"b":255,"a":1}},
          "mask":[{"type":"rect","width":5,"height":14,
            "fill":{"type":"solid","color":{"r":255,"g":255,"b":255,"a":1}}}],
          "effects":[{"type":"drop-shadow","dx":0,"dy":6,"blur":0,
            "color":{"r":0,"g":0,"b":0,"a":1}}]
        }
      ]}
    ]},
    {"type":"rect","width":8,"height":8,
      "transform":{"a":1,"b":0,"c":0,"d":1,"e":4,"f":2},
      "opacity":0.5,
      "fill":{"type":"solid","color":{"r":255,"g":0,"b":0,"a":1}}}
  ]}]
}"#;

#[test]
fn overlapping_transparent_plain_and_masked_effect_composite_once() {
    let mut engine = Engine::new(16, 28);
    engine
        .set_document(STACKED)
        .expect("stacked artisan scene parses");

    let blue = rgba(&engine, 2, 5);
    assert!(
        (100..=160).contains(&blue[3]) && blue[2] > 200 && blue[0] < 20,
        "masked 50% blue is painted once, got {blue:?}"
    );

    let overlap = rgba(&engine, 5, 5);
    // Straight alpha of one 50% red over one 50% blue is about (170, 0, 85, 192).
    // Painting the blue twice before the red drops red toward ~146 and lifts blue toward ~109.
    assert!(
        (170..=210).contains(&overlap[3])
            && (155..=185).contains(&overlap[0])
            && (70..=100).contains(&overlap[2])
            && overlap[1] == 0,
        "50% red over 50% blue is a single composite, got {overlap:?}"
    );

    let red = rgba(&engine, 8, 5);
    assert!(
        (100..=160).contains(&red[3]) && red[0] > 200 && red[2] < 20,
        "plain red outside the mask is painted once, got {red:?}"
    );

    let shadow = rgba(&engine, 2, 12);
    assert!(
        shadow[3] > 40 && shadow[0] < 30 && shadow[2] < 30,
        "drop shadow of the masked item is visible under the source, got {shadow:?}"
    );
    let clipped = rgba(&engine, 8, 12);
    assert!(
        clipped[3] < 10,
        "mask clips the shadow outside the mask, got {clipped:?}"
    );
}

#[test]
fn identical_set_view_keeps_the_vector_cache() {
    let mut engine = Engine::new(16, 16);
    engine.set_document(STACKED).expect("scene parses");
    let key = cache_key(&engine);
    assert!(
        key.is_some(),
        "set_document rasterizes into the vector cache"
    );
    let pixels = engine.layers[0].pixels.clone();

    reset_composite_calls();
    engine.set_view(0.0, 0.0, 1.0, 0.0);
    assert_eq!(
        composite_calls(),
        0,
        "identical set_view does not composite"
    );
    assert_eq!(cache_key(&engine), key);
    assert!(
        std::sync::Arc::ptr_eq(&engine.layers[0].pixels, &pixels),
        "identical set_view does not rebuild the vector plane"
    );

    engine.render();
    assert_eq!(
        composite_calls(),
        0,
        "render uploads the frame already composited for this view"
    );
    assert_eq!(cache_key(&engine), key);
    assert!(std::sync::Arc::ptr_eq(&engine.layers[0].pixels, &pixels));
}

#[test]
fn view_change_and_document_edit_rasterize_once() {
    let mut engine = Engine::new(16, 16);
    let plain = r#"{"layers":[{"items":[
      {"type":"rect","width":4,"height":4,
        "fill":{"type":"solid","color":{"r":220,"g":20,"b":20,"a":1}}}
    ]}]}"#;
    engine.set_document(plain).expect("plain rect parses");
    let before = rgba(&engine, 1, 1);
    assert!(
        before[0] > 180 && before[3] > 200,
        "zoom 1 paints the rect, got {before:?}"
    );
    let identity = cache_key(&engine);

    reset_composite_calls();
    engine.set_view(0.0, 0.0, 2.0, 0.0);
    engine.render();
    assert_eq!(composite_calls(), 1, "a real zoom plus render composites once");
    assert_ne!(cache_key(&engine), identity);
    assert!(cache_key(&engine).is_some());
    let zoomed = rgba(&engine, 6, 6);
    assert!(
        zoomed[0] > 180 && zoomed[3] > 200,
        "zoom 2 enlarges the rect, got {zoomed:?}"
    );

    reset_composite_calls();
    engine.set_view(8.0, 0.0, 2.0, 0.0);
    assert_eq!(composite_calls(), 1, "a real pan composites once");
    let panned = rgba(&engine, 1, 1);
    assert!(
        panned[3] < 10,
        "pan moves the rect off its old pixels, got {panned:?}"
    );

    reset_composite_calls();
    engine.set_view(0.0, 0.0, 1.0, 0.4);
    assert_eq!(composite_calls(), 1, "a real rotation composites once");
    assert!(
        engine.output.iter().any(|byte| *byte > 0),
        "rotation still paints the rect"
    );

    engine.resize(8, 8);
    assert_eq!((engine.w, engine.h), (8, 8));
    assert_eq!(
        cache_key(&engine).map(|(w, h, _)| (w, h)),
        Some((8, 8)),
        "resize rebuilds the cache at the new canvas size"
    );
    reset_composite_calls();
    engine.render();
    assert_eq!(
        composite_calls(),
        0,
        "render uploads the frame resize already composited"
    );

    let moved = r#"{"layers":[{"items":[
      {"type":"rect","width":4,"height":4,
        "transform":{"a":1,"b":0,"c":0,"d":1,"e":10,"f":10},
        "fill":{"type":"solid","color":{"r":220,"g":20,"b":20,"a":1}}}
    ]}]}"#;
    reset_composite_calls();
    engine.set_document(moved).expect("edited scene parses");
    assert!(composite_calls() >= 1, "a document edit composites");
    assert!(cache_key(&engine).is_some());
    let cleared = rgba(&engine, 1, 1);
    assert!(
        cleared[3] < 10,
        "the edit removes the rect from its old pixels, got {cleared:?}"
    );
}
