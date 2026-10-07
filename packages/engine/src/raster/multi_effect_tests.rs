// VIS-LS-08 — a layer carries up to ten instances of each effect type, not one.
// Photoshop's stacked strokes and layered shadows are the whole point: the list
// is a multiset keyed by effect id, and instances of a type render in stored
// order within that type's place in the compositing ORDER.

use super::*;

const W: usize = 32;

// One black 8×8 square (x/y 12..20) on an opaque white backdrop.
fn square_doc() -> (Engine, u32) {
    let mut e = Engine::new(W as u32, W as u32);
    e.select_rect(0, 0, W as i32, W as i32, 0);
    e.fill_selection(255, 255, 255, 255);
    e.select_none();

    let id = e.add_layer("shape");
    e.select_rect(12, 12, 8, 8, 0);
    e.fill_selection(0, 0, 0, 255);
    e.select_none();
    (e, id)
}

// Stroke (fx 9): [enabled, blend, opacity, r, g, b, size, position]. Position 0
// is Outside, so `size` counts rings out from the shape edge.
fn stroke(rgb: [f32; 3], size: f32) -> Vec<f32> {
    vec![1.0, 0.0, 1.0, rgb[0], rgb[1], rgb[2], size, 0.0]
}

const RED: [f32; 3] = [1.0, 0.0, 0.0];
const GREEN: [f32; 3] = [0.0, 1.0, 0.0];

fn is(e: &Engine, x: usize, y: usize, rgb: [f32; 3]) -> bool {
    let o = (y * W + x) * 4;
    (0..3).all(|k| {
        let want = (rgb[k] * 255.0) as i32;
        (e.output[o + k] as i32 - want).abs() < 40
    })
}

// The classic double stroke: a wide green band with a narrow red one over it.
// Before this landed the renderer took the FIRST entry per id and the second
// stroke never reached the compositor at all.
#[test]
fn two_strokes_on_one_layer_both_render() {
    let (mut e, id) = square_doc();
    e.set_layer_effect_at(id, 9, 0, &stroke(GREEN, 4.0));
    e.set_layer_effect_at(id, 9, 1, &stroke(RED, 2.0));
    e.composite();

    assert_eq!(e.layer_effect_count(id, 9), 2, "both strokes stored");
    assert!(
        is(&e, 11, 15, RED),
        "the narrow stroke sits over the wide one at 1px out"
    );
    assert!(
        is(&e, 9, 15, GREEN),
        "the wide stroke still paints at 3px out — the second instance did not replace it"
    );
    assert!(
        is(&e, 6, 15, [1.0, 1.0, 1.0]),
        "and neither stroke leaks past its size"
    );
}

// Instance order is the stack order: swap the two and the wide stroke wins the
// overlap instead.
#[test]
fn instance_order_decides_which_stroke_is_on_top() {
    let (mut e, id) = square_doc();
    e.set_layer_effect_at(id, 9, 0, &stroke(RED, 2.0));
    e.set_layer_effect_at(id, 9, 1, &stroke(GREEN, 4.0));
    e.composite();

    assert!(is(&e, 11, 15, GREEN), "the later instance composites above");
}

#[test]
fn set_layer_effect_at_edits_removes_and_caps() {
    let (mut e, id) = square_doc();
    for _ in 0..effects::FX_MAX_INSTANCES + 3 {
        // An out-of-range index appends, so this is the "add another" path.
        e.set_layer_effect_at(id, 9, u32::MAX, &stroke(RED, 2.0));
    }
    assert_eq!(
        e.layer_effect_count(id, 9) as usize,
        effects::FX_MAX_INSTANCES,
        "the per-type instance cap holds"
    );

    // Edit in place: the instance keeps its position in the stack.
    e.set_layer_effect_at(id, 9, 1, &stroke(GREEN, 7.0));
    assert_eq!(e.layer_effect_params_at(id, 9, 1)[4], 1.0, "green written");
    assert_eq!(e.layer_effect_params_at(id, 9, 0)[4], 0.0, "0 untouched");
    assert_eq!(e.layer_effect_params_at(id, 9, 2)[4], 0.0, "2 untouched");

    // Empty params removes just that instance…
    e.set_layer_effect_at(id, 9, 1, &[]);
    assert_eq!(
        e.layer_effect_count(id, 9) as usize,
        effects::FX_MAX_INSTANCES - 1,
        "one instance removed"
    );
    assert_eq!(e.layer_effect_params_at(id, 9, 1)[4], 0.0, "the green one");

    // …while the whole-type op still collapses the stack (pasted styles use it).
    e.set_layer_effect(id, 9, &stroke(RED, 3.0));
    assert_eq!(e.layer_effect_count(id, 9), 1, "whole-type set replaces all");
}

#[test]
fn stacked_instances_survive_a_project_round_trip() {
    let (mut e, id) = square_doc();
    e.set_layer_effect_at(id, 9, 0, &stroke(GREEN, 4.0));
    e.set_layer_effect_at(id, 9, 1, &stroke(RED, 2.0));
    // Drop Shadow (fx 0) alongside, so the reload is not just one id's list.
    e.set_layer_effect_at(id, 0, 0, &[1.0, 3.0, 0.75, 0.0, 0.0, 0.0, 120.0, 6.0]);

    let bytes = e.save_project();
    let e2 = Engine::load_project(&bytes)
        .ok()
        .expect("load_project failed");
    assert_eq!(e2.layer_effect_count(id, 9), 2, "stroke stack lost on reload");
    assert_eq!(e2.layer_effect_params_at(id, 9, 1)[3], 1.0, "order lost");
    assert_eq!(e2.layer_effect_count(id, 0), 1, "drop shadow lost");
}
