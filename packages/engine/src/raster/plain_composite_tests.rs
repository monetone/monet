//! Plain Normal stacks take the row composite and match the general per-pixel plan.

use super::{force_slow_composite, Engine};

fn pixels(engine: &Engine) -> Vec<u8> {
    let n = (engine.width() * engine.height() * 4) as usize;
    unsafe { std::slice::from_raw_parts(engine.output_ptr(), n).to_vec() }
}

fn assert_plain_matches_slow(engine: &mut Engine) {
    engine.composite();
    let fast = pixels(engine);
    engine.composite_region(2, 1, 17, 13);
    let fast_region = pixels(engine);
    force_slow_composite(true);
    let _restore = SlowGuard;
    engine.composite();
    let slow = pixels(engine);
    engine.composite_region(2, 1, 17, 13);
    let slow_region = pixels(engine);
    drop(_restore);
    assert_eq!(fast, slow, "full-frame composite");
    assert_eq!(fast_region, slow_region, "region composite");
    assert_eq!(fast, fast_region, "the region pass rewrites the same pixels");
}

struct SlowGuard;

impl Drop for SlowGuard {
    fn drop(&mut self) {
        force_slow_composite(false);
    }
}

#[test]
fn uniform_normal_stack_matches_the_general_composite() {
    let mut engine = Engine::new(24, 16);
    engine.add_layer("red");
    engine.fill_selection(255, 0, 0, 128);
    let id = engine.add_layer("blue");
    engine.fill_selection(0, 0, 255, 255);
    engine.set_layer_opacity(id, 0.5);
    assert_plain_matches_slow(&mut engine);
}

#[test]
fn fill_opacity_and_a_hidden_layer_match() {
    let mut engine = Engine::new(20, 12);
    let green = engine.add_layer("green");
    engine.fill_selection(0, 255, 0, 255);
    engine.set_layer_fill_opacity(green, 0.25);
    let hidden = engine.add_layer("hidden");
    engine.fill_selection(0, 0, 255, 255);
    engine.set_layer_visible(hidden, false);
    assert_plain_matches_slow(&mut engine);
}

#[test]
fn multiply_and_masked_layers_stay_on_the_general_composite() {
    let mut multiply = Engine::new(18, 10);
    let id = multiply.add_layer("mul");
    multiply.fill_selection(255, 128, 0, 200);
    multiply.set_layer_blend(id, 3);
    assert_plain_matches_slow(&mut multiply);

    let mut masked = Engine::new(18, 10);
    let id = masked.add_layer("masked");
    masked.fill_selection(0, 0, 255, 255);
    masked.add_layer_mask(id);
    assert_plain_matches_slow(&mut masked);
}

#[test]
fn odd_u16_samples_match_the_general_composite() {
    let mut engine = Engine::new(8, 6);
    let id = engine.add_layer("odd");
    engine.fill_selection(10, 20, 30, 40);
    let index = engine.layer_index(id).unwrap();
    let pixels = std::sync::Arc::make_mut(&mut engine.layers[index].pixels);
    pixels[0] = 1000;
    pixels[1] = 2000;
    pixels[2] = 40000;
    pixels[3] = 50000;
    assert_plain_matches_slow(&mut engine);
}
