use super::*;

fn replacement_png() -> Vec<u8> {
    let image = image::RgbaImage::from_pixel(2, 1, image::Rgba([0, 255, 0, 255]));
    let mut out = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image).write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

/// A bound pixel layer with an offset, opacities, a mask and (at 32 bits) a
/// float authority, with empty history.
fn fixture(depth: u32) -> (Engine, u32) {
    let mut e = Engine::new(8, 6);
    e.depth = depth as _;
    let id = e.active_layer_id();
    Arc::make_mut(&mut e.layers[0].pixels).fill(0);
    for y in 1..4 {
        for x in 1..5 {
            let p = (y * 8 + x) * 4;
            Arc::make_mut(&mut e.layers[0].pixels)[p..p + 4].copy_from_slice(&[60000, 400, 200, 65535]);
        }
    }
    if depth == 32 {
        Engine::promote_layer_to_float(&mut e.layers[0]);
        Arc::make_mut(&mut e.layers[0].pixels_f32)[(2 * 8 + 2) * 4] = 2.5;
        // In a 32-bit document `pixels` is only a clamped proxy of the f32
        // authority; leave it stale and the first composite re-derives it
        // (and trips the legacy-write tripwire), so the snapshot under test
        // would never match.
        Engine::sync_float_preview(&mut e.layers[0]);
    }
    e.layers[0].ox = 1;
    e.layers[0].opacity = 0.7;
    e.layers[0].fill_opacity = 0.8;
    e.layers[0].mask = vec![128; 8 * 6].into();
    e.layers[0].mask_enabled = true;
    e.purge();
    (e, id)
}

#[test]
fn conform_pixel_variable_preserves_properties_and_one_undo_restores_native_pixels() {
    for depth in [8, 16, 32] {
        let (mut e, id) = fixture(depth);
        let original = e.layers[0].pixels.clone();
        let native = e.layers[0].pixels_f32.clone();
        let bounds = e.active_layer_bbox();
        assert!(e.begin_history_transaction());
        e.push_history("Apply Data Set 1");
        let pushes = e.undo_pushes();
        e.convert_to_smart_object(id);
        e.replace_smart_object_preserve_placement(id, &replacement_png()).unwrap();
        e.rasterize_smart_object(id);
        let added = (e.undo_pushes() - pushes) as usize;
        for _ in 0..added { e.drop_last_undo(); }
        assert!(e.commit_history_transaction());
        assert_eq!(e.undo_depth(), 1);
        assert_eq!(e.layers[0].kind, 0);
        assert_eq!(e.layers[0].id, id);
        assert_eq!(e.layers[0].opacity, 0.7);
        assert_eq!(e.layers[0].fill_opacity, 0.8);
        assert_eq!(e.layers[0].mask.to_vec(), vec![128; 48]);
        assert_eq!(e.active_layer_bbox(), bounds);
        assert_ne!(e.layers[0].pixels, original);
        assert_eq!(e.layers[0].pixels[(2 * 8 + 2) * 4], 0);
        assert!(e.layers[0].pixels[(2 * 8 + 2) * 4 + 1] > 60000);
        e.undo();
        assert_eq!(e.layers[0].pixels, original);
        assert_eq!(e.layers[0].pixels_f32, native);
        assert_eq!(e.layers[0].ox, 1);
    }
}

/// dataVars.apply cancels the transaction when a row fails part-way, possibly
/// while the bound layer is still the temporary Smart Object.
#[test]
fn cancelled_pixel_variable_row_restores_layer_and_history() {
    for depth in [8, 16, 32] {
        for rasterized in [false, true] {
            let (mut e, id) = fixture(depth);
            let state = |e: &Engine| {
                let l = &e.layers[0];
                (e.layers.len(), l.kind, l.id, l.pixels.clone(), l.pixels_f32.clone(), l.mask.clone(), l.ox, l.opacity, l.fill_opacity, e.active_layer_bbox(), e.undo_depth())
            };
            let before = state(&e);
            assert!(e.begin_history_transaction());
            e.push_history("Apply Data Set 1");
            e.convert_to_smart_object(id);
            e.replace_smart_object_preserve_placement(id, &replacement_png()).unwrap();
            if rasterized {
                e.rasterize_smart_object(id);
            } else {
                assert_ne!(e.layers[0].kind, 0, "the row failed while the layer was a Smart Object");
            }
            assert_ne!(e.layers[0].pixels, before.3);
            assert!(e.cancel_history_transaction());
            assert!(!e.history_transaction_active());
            assert_eq!(state(&e), before, "depth {depth}, rasterized {rasterized}");
            assert!(e.begin_history_transaction());
        }
    }
}
