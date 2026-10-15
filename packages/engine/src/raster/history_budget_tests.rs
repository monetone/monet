//! The history byte budget counts animation frames and the selection buffers a
//! stack snapshot retains, not only layer planes.

use super::{Engine, SpotChannel};
use monet_format::import::DocumentChannel;

const TWENTY_MIB: usize = 20 * 1024 * 1024;
const EIGHT_MIB: usize = 8 * 1024 * 1024;

fn engine_with_cap() -> Engine {
    let mut engine = Engine::new(1, 1);
    engine.set_history_bytes_cap(EIGHT_MIB);
    engine.set_history_states(50);
    engine
}

fn push_four(engine: &mut Engine) {
    for _ in 0..4 {
        assert!(!engine.push_stack_undo("Frame"), "the push is accepted");
    }
}

#[test]
fn four_20_mib_frame_snapshots_cannot_fit_under_an_8_mib_cap() {
    let mut engine = engine_with_cap();
    engine.frames.push(vec![9u8; TWENTY_MIB]);
    push_four(&mut engine);
    assert!(
        engine.undo_depth() < 4,
        "four 20 MiB frame snapshots stayed under an 8 MiB cap"
    );
    assert_eq!(
        engine.undo_depth(),
        1,
        "one oversized frame snapshot is kept"
    );

    engine.frames.clear();
    engine.undo();
    assert_eq!(engine.frame_count(), 1);
    assert_eq!(engine.frames[0].len(), TWENTY_MIB);
}

#[test]
fn one_oversized_frame_snapshot_is_kept() {
    let mut engine = engine_with_cap();
    engine.frames.push(vec![4u8; TWENTY_MIB]);
    assert!(!engine.push_stack_undo("Only"));
    assert_eq!(engine.undo_depth(), 1);
}

#[test]
fn saved_selection_and_channel_bytes_count_toward_the_cap() {
    let mut selections = engine_with_cap();
    selections
        .saved_sels
        .push(("plate".into(), vec![1u8; TWENTY_MIB]));
    push_four(&mut selections);
    assert_eq!(selections.undo_depth(), 1);

    let mut channels = engine_with_cap();
    channels.document_channels.push(DocumentChannel {
        name: None,
        identifier: None,
        display: None,
        data: vec![2u8; TWENTY_MIB],
        data16: Vec::new(),
        data32: Vec::new(),
    });
    push_four(&mut channels);
    assert_eq!(channels.undo_depth(), 1);

    let mut spots = engine_with_cap();
    spots.spot_channels.push(SpotChannel {
        name: "Ink".into(),
        ink: [20, 40, 80],
        solidity: 1.0,
        coverage: vec![3u8; TWENTY_MIB],
        visible: true,
    });
    push_four(&mut spots);
    assert_eq!(spots.undo_depth(), 1);

    let mut live = engine_with_cap();
    live.sel.mask = vec![5u8; TWENTY_MIB];
    push_four(&mut live);
    assert_eq!(live.undo_depth(), 1);
    live.sel.mask.clear();
    live.undo();
    assert_eq!(live.sel.mask.len(), TWENTY_MIB);
}

#[test]
fn frame_capture_undo_and_delay_stay_intact() {
    let mut engine = Engine::new(2, 2);
    engine.add_frame();
    engine.set_frame_delay(0, 12);
    engine.add_frame();
    assert_eq!(engine.frame_count(), 2);
    engine.undo();
    assert_eq!(engine.frame_count(), 1);
    assert_eq!(engine.frame_delay(0), 12, "a delay edit is not its own history step");
    engine.redo();
    assert_eq!(engine.frame_count(), 2);
    assert_eq!(engine.frame_delay(0), 12);

    engine.tween_frames(0, 1, 1);
    assert_eq!(engine.frame_count(), 3);
    engine.undo();
    assert_eq!(engine.frame_count(), 2);
}
