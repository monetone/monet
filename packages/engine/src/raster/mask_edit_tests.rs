// Adjustments and filters aimed at a MASK.
//
// `apply16` used to run every adjustment/filter closure over
// `layers[active].pixels` with no mask branch, so with the mask thumbnail
// selected the op damaged the artwork and left the mask alone. These tests pin
// both directions: a masked op leaves the pixels byte-identical, an unmasked op
// leaves the mask byte-identical.

use super::*;

// A 8×6 document with an opaque mid-grey layer and a fully revealing mask.
fn masked_layer() -> (Engine, u32) {
    let mut e = Engine::new(8, 6);
    let id = e.add_layer("art");
    e.select_rect(0, 0, 8, 6, 0);
    e.fill_selection(40, 90, 200, 255);
    e.select_none();
    e.add_layer_mask(id);
    let i = e.layer_index(id).expect("layer present");
    assert_eq!(e.layers[i].mask.len(), 8 * 6);
    (e, id)
}

fn layer(e: &Engine, id: u32) -> &Layer {
    let i = e.layer_index(id).expect("layer present");
    &e.layers[i]
}

#[test]
fn masked_adjustment_edits_the_mask_and_leaves_the_pixels_byte_identical() {
    let (mut e, id) = masked_layer();
    // A non-uniform mask, so an inversion is visible everywhere.
    {
        let i = e.layer_index(id).unwrap();
        for (k, coverage) in Arc::make_mut(&mut e.layers[i].mask).iter_mut().enumerate() {
            *coverage = (k * 5) as u8;
        }
    }
    let pixels = layer(&e, id).pixels.clone();
    let mask = layer(&e, id).mask.clone();

    e.set_mask_edit(true);
    e.adjust_invert();

    assert_eq!(
        layer(&e, id).pixels,
        pixels,
        "a masked adjustment must not touch the artwork"
    );
    let inverted: Vec<u8> = mask.iter().map(|c| 255 - c).collect();
    assert_eq!(layer(&e, id).mask.to_vec(), inverted, "the mask was inverted");

    e.undo();
    assert_eq!(layer(&e, id).mask, mask, "undo restores the mask");
    assert_eq!(layer(&e, id).pixels, pixels);
}

#[test]
fn unmasked_adjustment_edits_the_pixels_and_leaves_the_mask_byte_identical() {
    let (mut e, id) = masked_layer();
    let pixels = layer(&e, id).pixels.clone();
    let mask = layer(&e, id).mask.clone();

    e.set_mask_edit(false);
    e.adjust_invert();

    assert_ne!(layer(&e, id).pixels, pixels, "the artwork was inverted");
    assert_eq!(
        layer(&e, id).mask.to_vec(),
        mask.to_vec(),
        "an unmasked adjustment must not touch the mask"
    );
}

#[test]
fn a_masked_adjustment_honours_the_selection() {
    let (mut e, id) = masked_layer();
    let before = layer(&e, id).mask.clone();

    e.set_mask_edit(true);
    e.select_rect(0, 0, 2, 1, 0);
    e.adjust_invert();

    let after = layer(&e, id).mask.clone();
    for k in 0..8 * 6 {
        if k < 2 {
            assert_eq!(after[k], 255 - before[k], "inside the selection at {k}");
        } else {
            assert_eq!(after[k], before[k], "outside the selection at {k}");
        }
    }
}

#[test]
fn a_masked_spatial_filter_blurs_the_mask_at_the_canvas_stride() {
    let (mut e, id) = masked_layer();
    // Hard vertical edge down the middle of the mask.
    {
        let i = e.layer_index(id).unwrap();
        for y in 0..6usize {
            for x in 0..8usize {
                Arc::make_mut(&mut e.layers[i].mask)[y * 8 + x] = if x < 4 { 0 } else { 255 };
            }
        }
    }
    let pixels = layer(&e, id).pixels.clone();

    e.set_mask_edit(true);
    e.filter_box_blur(1);

    assert_eq!(
        layer(&e, id).pixels,
        pixels,
        "a masked filter must not touch the artwork"
    );
    let mask = &layer(&e, id).mask;
    for y in 0..6usize {
        let (a, b) = (mask[y * 8 + 3], mask[y * 8 + 4]);
        assert!(
            a > 0 && a < 255 && b > 0 && b < 255,
            "row {y} softened across the seam: {a}/{b}"
        );
        assert_eq!(mask[y * 8], 0, "row {y} far left stays hidden");
        assert_eq!(mask[y * 8 + 7], 255, "row {y} far right stays revealed");
    }
}

// A cropped layer keeps a pixel plane LARGER than the canvas, while the mask is
// always canvas-sized — so a spatial filter aimed at the mask must be handed the
// canvas dimensions, not the plane's, or it walks off the end of the coverage
// buffer.
#[test]
fn a_masked_filter_on_an_oversized_plane_uses_canvas_dimensions() {
    let mut e = Engine::new(4, 4);
    let id = e.active_layer_id();
    let bounds = Bounds {
        x: -3,
        y: -2,
        w: 8,
        h: 6,
    };
    {
        let i = e.layer_index(id).unwrap();
        let layer = &mut e.layers[i];
        layer.pixel_bounds = bounds;
        layer.pixels = vec![30_000u16; (8 * 6 * 4) as usize].into();
        layer.pixels_f32 = Arc::from(Vec::new());
        layer.ox = 1;
        layer.oy = 1;
        assert!(layer.pixel_plane_is_valid());
    }
    e.add_layer_mask(id);
    {
        let i = e.layer_index(id).unwrap();
        assert_eq!(e.layers[i].mask.len(), 4 * 4);
        for (k, coverage) in Arc::make_mut(&mut e.layers[i].mask).iter_mut().enumerate() {
            *coverage = if k % 2 == 0 { 0 } else { 255 };
        }
    }
    let pixels = layer(&e, id).pixels.clone();

    e.set_mask_edit(true);
    e.filter_box_blur(1);

    assert_eq!(layer(&e, id).pixels, pixels);
    assert_eq!(layer(&e, id).mask.len(), 4 * 4);
    assert!(
        layer(&e, id).mask.iter().any(|&c| c > 0 && c < 255),
        "the mask actually blurred"
    );
}

#[test]
fn an_adjustment_layer_targets_its_own_mask_rather_than_refusing() {
    let mut e = Engine::new(8, 6);
    let id = e.add_adjustment_layer(0, &[0.2, 0.0], "Brightness");
    let i = e.layer_index(id).expect("adjustment layer present");
    assert_eq!(e.layers[i].kind, 1);
    let pixels = e.layers[i].pixels.clone();
    let mask = e.layers[i].mask.clone();

    e.adjust_invert();

    let i = e.layer_index(id).unwrap();
    assert_eq!(e.layers[i].pixels, pixels, "an adjustment layer has no art");
    assert_eq!(
        e.layers[i].mask.to_vec(),
        mask.iter().map(|c| 255 - c).collect::<Vec<u8>>(),
        "the adjustment landed on the mask"
    );
    assert!(
        e.last_edit_error().is_empty(),
        "no refusal — the mask is a valid target"
    );
}

#[test]
fn invert_mask_flips_coverage_without_the_mask_edit_toggle() {
    let (mut e, id) = masked_layer();
    {
        let i = e.layer_index(id).unwrap();
        for (k, coverage) in Arc::make_mut(&mut e.layers[i].mask).iter_mut().enumerate() {
            *coverage = (k * 3) as u8;
        }
    }
    let mask = layer(&e, id).mask.clone();
    let pixels = layer(&e, id).pixels.clone();

    e.set_mask_edit(false);
    assert!(e.invert_mask());

    assert_eq!(
        layer(&e, id).mask.to_vec(),
        mask.iter().map(|c| 255 - c).collect::<Vec<u8>>()
    );
    assert_eq!(layer(&e, id).pixels, pixels);

    e.undo();
    assert_eq!(layer(&e, id).mask, mask, "undo restores the mask");
}

#[test]
fn invert_mask_reports_a_layer_with_no_mask() {
    let mut e = Engine::new(8, 6);
    let id = e.add_layer("art");
    assert!(layer(&e, id).mask.is_empty());
    assert!(!e.invert_mask());
}

// The Smart Filter mask is the other mask target: with `set_filter_mask_edit`
// on, the same menu ops must edit that plane and leave the layer's rendered
// pixels to the stack re-render rather than being overwritten in place.
#[test]
fn a_filter_mask_edit_targets_the_smart_filter_mask() {
    let mut e = Engine::new(16, 16);
    let id = e.add_layer("src");
    e.select_rect(0, 0, 16, 16, 0);
    e.fill_selection(255, 255, 255, 255);
    e.select_rect(0, 0, 8, 16, 0);
    e.fill_selection(0, 0, 0, 255);
    e.select_none();
    e.convert_to_smart_object(id);
    e.smart_add_filter(id, 0, &[3.0]);
    let i = e.layer_index(id).expect("smart layer present");
    assert_eq!(e.layers[i].smart_mask.len(), 16 * 16);
    let source = e.layers[i].smart_src.clone();
    let mask = e.layers[i].smart_mask.clone();

    e.set_filter_mask_edit(true);
    e.adjust_invert();

    let i = e.layer_index(id).unwrap();
    assert_eq!(
        e.layers[i].smart_mask,
        mask.iter().map(|c| 255 - c).collect::<Vec<u8>>(),
        "the filter mask was inverted"
    );
    assert_eq!(
        e.layers[i].smart_src, source,
        "the smart source is never a destructive target"
    );
    assert!(e.layers[i].mask.is_empty(), "the layer mask stayed empty");
}
