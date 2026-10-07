// VIS-LS-12 — the Smart Filter mask: ONE coverage plane over the whole filter
// stack (Photoshop's white thumbnail under the layer row). Black restores the
// raw smart-object source, white keeps the filtered result, grey lerps.

use super::*;

// A 16×16 smart object — white with a black left half — blurred hard enough
// that the pixels either side of the seam move a long way.
fn blurred_smart_object() -> (Engine, u32, usize) {
    let mut e = Engine::new(16, 16);
    let id = e.add_layer("src");
    e.select_rect(0, 0, 16, 16, 0);
    e.fill_selection(255, 255, 255, 255);
    e.select_rect(0, 0, 8, 16, 0);
    e.fill_selection(0, 0, 0, 255);
    e.select_none();
    e.convert_to_smart_object(id);
    e.smart_add_filter(id, 0, &[3.0]); // gaussian blur
    let i = e.layer_index(id).expect("smart layer present");
    assert_ne!(
        e.layers[i].pixels, e.layers[i].smart_src,
        "the stack actually changes the source"
    );
    (e, id, i)
}

fn px(e: &Engine, i: usize, x: usize, y: usize) -> u16 {
    e.layers[i].pixels[(y * 16 + x) * 4]
}

fn src(e: &Engine, i: usize, x: usize, y: usize) -> u16 {
    e.layers[i].smart_src[(y * 16 + x) * 4]
}

#[test]
fn filter_mask_attenuates_the_stack_locally() {
    let (mut e, id, i) = blurred_smart_object();
    let filtered = e.layers[i].pixels.clone();

    // The mask arrives with the first smart filter, as in Photoshop — there is
    // no Add Filter Mask command, and nothing in the app ever called one, so a
    // filter mask could not exist at all before.
    assert!(e.has_smart_filter_mask(id), "adding a smart filter creates its filter mask");
    e.render_smart(i);
    assert_eq!(
        e.layers[i].pixels, filtered,
        "a white filter mask changes nothing"
    );

    // Mask the left half off entirely, leave one mid-grey column.
    for y in 0..16usize {
        for x in 0..8usize {
            e.layers[i].smart_mask[y * 16 + x] = 0;
        }
        e.layers[i].smart_mask[y * 16 + 8] = 128;
    }
    e.render_smart(i);

    for y in 0..16usize {
        assert_eq!(px(&e, i, 6, y), src(&e, i, 6, y), "masked-off = raw source");
        assert_eq!(
            px(&e, i, 12, y),
            filtered[(y * 16 + 12) * 4],
            "unmasked = full filter"
        );
        // Grey column lerps by its exact 128/255 coverage — not one end or the other.
        let (raw, full) = (src(&e, i, 8, y) as f32, filtered[(y * 16 + 8) * 4] as f32);
        let want = (raw + (full - raw) * (128.0 / 255.0)).round() as i32;
        let got = px(&e, i, 8, y) as i32;
        assert!(
            (got - want).abs() <= 1,
            "partial coverage lerps: raw {raw}, full {full}, want {want}, got {got}"
        );
    }
}

#[test]
fn disable_and_delete_filter_mask_restore_the_whole_stack() {
    let (mut e, id, i) = blurred_smart_object();
    let filtered = e.layers[i].pixels.clone();
    e.add_smart_filter_mask(id);
    e.layers[i].smart_mask.fill(0);
    e.render_smart(i);
    assert_eq!(e.layers[i].pixels, e.layers[i].smart_src, "fully masked off");

    // Disable Filter Mask: bytes retained, coverage ignored.
    assert!(e.set_smart_filter_mask_enabled(id, false));
    assert!(e.has_smart_filter_mask(id), "mask kept under the red X");
    assert!(!e.smart_filter_mask_enabled(id));
    assert_eq!(e.layers[i].pixels, filtered, "disabled = stack everywhere");

    assert!(e.set_smart_filter_mask_enabled(id, true));
    assert_eq!(e.layers[i].pixels, e.layers[i].smart_src, "re-enabled");

    // Delete Filter Mask: the plane is gone for good.
    assert!(e.delete_smart_filter_mask(id));
    assert!(!e.has_smart_filter_mask(id));
    assert!(e.smart_filter_mask_gray(id).is_empty());
    assert_eq!(e.layers[i].pixels, filtered, "deleted = stack everywhere");
}

#[test]
fn brush_paints_the_filter_mask_and_leaves_the_layer_mask_alone() {
    let (mut e, id, _) = blurred_smart_object();
    e.set_active_layer(id);
    e.add_layer_mask(id); // a normal (white) layer mask that must not be touched
    assert!(e.has_smart_filter_mask(id), "created with the smart filter");

    e.set_filter_mask_edit(true);
    e.set_brush(8.0, 1.0, 1.0, 1.0, 0.1, 0, 0, 0, 255, false); // black = hide the filter
    e.set_brush_mode(0);
    assert!(e.stroke_begin(), "a smart object's filter mask is paintable");
    e.stroke_to(8.0, 8.0, 1.0);
    e.stroke_end();

    let i = e.layer_index(id).expect("smart layer present");
    assert_eq!(e.layers[i].smart_mask[8 * 16 + 8], 0, "dab centre hides it");
    assert!(
        e.layers[i].mask.iter().all(|&m| m == 255),
        "the layer mask stayed untouched"
    );
    // stroke_end re-runs the stack, so the canvas already shows the raw source.
    assert_eq!(px(&e, i, 8, 8), src(&e, i, 8, 8));

    e.undo();
    let i = e.layer_index(id).expect("smart layer present");
    assert!(
        e.layers[i].smart_mask.iter().all(|&m| m == 255),
        "the stroke is one undo step"
    );
}

#[test]
fn filter_mask_survives_a_project_round_trip_and_a_crop() {
    let (mut e, id, i) = blurred_smart_object();
    e.add_smart_filter_mask(id);
    e.layers[i].smart_mask.fill(0);
    e.set_smart_filter_mask_enabled(id, false);

    let loaded = Engine::load_project(&e.save_project()).expect("v24 project loads");
    let li = loaded.layer_index(id).expect("smart layer present");
    assert_eq!(loaded.layers[li].smart_mask, e.layers[i].smart_mask);
    assert!(!loaded.smart_filter_mask_enabled(id), "Disable flag persists");

    // Image ▸ Image Size resamples the plane with the rest of the document —
    // a stale-size mask would silently stop masking.
    let mut resized = loaded;
    resized.resize_image(8, 8);
    let ri = resized.layer_index(id).expect("smart layer present");
    assert_eq!(resized.layers[ri].smart_mask.len(), 8 * 8);
}
