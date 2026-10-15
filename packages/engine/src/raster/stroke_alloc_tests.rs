//! A small dab keeps its opacity accumulator inside the dirty rect and shares
//! the pre-stroke plane with the undo snapshot.

use super::{Engine, Snap};
use std::sync::Arc;

fn sample(engine: &Engine, x: i32, y: i32) -> [u16; 4] {
    let p = ((y as u32 * engine.width() + x as u32) * 4) as usize;
    let px = &engine.layers[engine.active].pixels;
    [px[p], px[p + 1], px[p + 2], px[p + 3]]
}

#[test]
fn small_dab_does_not_allocate_a_full_canvas_accumulator() {
    let mut engine = Engine::new(400, 300);
    engine.purge();
    let before = sample(&engine, 150, 150);
    assert!(engine.stroke_begin());
    let base = Arc::as_ptr(&engine.stroke_base);
    assert_eq!(base, Arc::as_ptr(&engine.layers[engine.active].pixels));
    match &engine.undo.last().expect("stroke pushes one undo").snap {
        Snap::LayerPx { px, .. } => assert_eq!(base, Arc::as_ptr(px)),
        _ => panic!("a brush stroke snapshots the layer plane"),
    }

    let rect = engine.stroke_to(150.0, 150.0, 1.0);
    assert_eq!(rect, vec![138, 138, 25, 25]);
    let covered = (engine.stroke_acc_w as usize) * (engine.stroke_acc_h as usize);
    let canvas = (engine.width() * engine.height()) as usize;
    assert!(covered < 32 * 32, "accumulator covers {covered} pixels");
    assert!(covered < canvas);
    assert!(engine.stroke_acc.len() < canvas);
    assert_ne!(Arc::as_ptr(&engine.layers[engine.active].pixels), base);
    assert_eq!(Arc::as_ptr(&engine.stroke_base), base);
    assert_ne!(sample(&engine, 150, 150), before);

    let capacity = engine.stroke_acc.capacity();
    engine.stroke_end();
    assert!(engine.stroke_base.is_empty());
    assert_eq!(engine.stroke_acc_w, 0);
    assert_eq!(engine.stroke_acc.capacity(), capacity);

    assert!(engine.stroke_begin());
    engine.stroke_to(180.0, 160.0, 1.0);
    assert!(engine.stroke_acc.capacity() <= capacity);
    assert!(engine.stroke_acc_w <= 25 && engine.stroke_acc_h <= 25);
    engine.stroke_end();
}

#[test]
fn opacity_flow_undo_redo_and_history_brush_stay_intact() {
    let mut engine = Engine::new(80, 80);
    engine.set_brush(20.0, 1.0, 0.4, 1.0, 0.16, 0, 0, 0, 255, false);
    assert!(engine.stroke_begin());
    engine.stroke_dab(40.0, 40.0, 1.0);
    let once = sample(&engine, 40, 40);
    engine.stroke_dab(40.0, 40.0, 1.0);
    let twice = sample(&engine, 40, 40);
    assert!(
        twice[0] < once[0],
        "a second dab accumulates flow, once {once:?} twice {twice:?}"
    );
    engine.stroke_end();
    let committed = sample(&engine, 40, 40);
    engine.undo();
    assert!(sample(&engine, 40, 40)[0] > committed[0]);
    engine.redo();
    assert_eq!(sample(&engine, 40, 40), committed);

    engine.fill_selection(255, 0, 0, 255);
    engine.set_history_source();
    engine.fill_selection(255, 255, 255, 255);
    engine.set_brush(16.0, 1.0, 1.0, 1.0, 0.16, 0, 0, 0, 255, false);
    engine.set_brush_mode(12);
    assert!(engine.stroke_begin(), "history brush accepts a matching source");
    engine.stroke_to(40.0, 40.0, 1.0);
    engine.stroke_end();
    let painted = sample(&engine, 40, 40);
    assert!(
        painted[0] > painted[2] && painted[0] > 40000,
        "history brush restores the red source, got {painted:?}"
    );
}
