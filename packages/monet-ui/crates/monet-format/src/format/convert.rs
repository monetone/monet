// ─────────────────────────────────────────────────────────────
// format::convert — timeBase conversion. Seconds is the canonical bridge unit
// for any cross-unit math (`seconds = frames / fps`, `frames = round(seconds*fps)`).
// Same-base reopen never converts (exactly lossless). Ported from `convert.ts`.
// ─────────────────────────────────────────────────────────────

use super::schema::{MonetClip, MonetMarker, MonetSequence, MonetTrack, TimeBase};

/// frames → seconds (monet-timeline's `framesToSeconds`).
pub fn frames_to_seconds(frames: f64, fps: f64) -> f64 {
    if fps > 0.0 {
        frames / fps
    } else {
        0.0
    }
}

/// seconds → whole frames (monet-timeline's `secondsToFrames`). Uses JS
/// `Math.round` semantics — round half toward +∞ — via `(x + 0.5).floor()`, so
/// negative half-frame boundaries match the old TS exactly (Rust's `f64::round`
/// rounds half away from zero, which would differ by one frame at e.g. -0.5).
pub fn seconds_to_frames(seconds: f64, fps: f64) -> f64 {
    (seconds * fps + 0.5).floor()
}

/// A time value (in `tb` units) → seconds.
pub fn time_to_seconds(t: f64, tb: &TimeBase) -> f64 {
    match tb {
        TimeBase::Seconds => t,
        TimeBase::Frames { fps } => frames_to_seconds(t, *fps),
    }
}

/// Seconds → a time value in `tb` units (rounded to a whole frame for frames).
pub fn seconds_to_time(s: f64, tb: &TimeBase) -> f64 {
    match tb {
        TimeBase::Seconds => s,
        TimeBase::Frames { fps } => seconds_to_frames(s, *fps),
    }
}

/// Identical base (both seconds, or both frames at the same fps) → exact, no math.
fn same_base(from: &TimeBase, to: &TimeBase) -> bool {
    match (from, to) {
        (TimeBase::Seconds, TimeBase::Seconds) => true,
        (TimeBase::Frames { fps: a }, TimeBase::Frames { fps: b }) => a == b,
        _ => false,
    }
}

/// Convert a time value from one timeBase to another (via the seconds bridge).
pub fn convert_time(t: f64, from: &TimeBase, to: &TimeBase) -> f64 {
    if same_base(from, to) {
        return t;
    }
    seconds_to_time(time_to_seconds(t, from), to)
}

fn convert_clip(c: &MonetClip, from: &TimeBase, to: &TimeBase) -> MonetClip {
    let min = if matches!(to, TimeBase::Frames { .. }) { 1.0 } else { 1e-6 };
    MonetClip {
        start: convert_time(c.start, from, to),
        duration: convert_time(c.duration, from, to).max(min),
        in_point: convert_time(c.in_point, from, to),
        ..c.clone() // id/speed/enabled/media_id/name/data preserved verbatim
    }
}

fn convert_marker(m: &MonetMarker, from: &TimeBase, to: &TimeBase) -> MonetMarker {
    MonetMarker {
        time: convert_time(m.time, from, to),
        end: m.end.map(|e| convert_time(e, from, to)),
        ..m.clone()
    }
}

fn convert_track(t: &MonetTrack, from: &TimeBase, to: &TimeBase) -> MonetTrack {
    MonetTrack {
        clips: t.clips.iter().map(|c| convert_clip(c, from, to)).collect(),
        ..t.clone() // id/kind/name/enabled/locked/data preserved
    }
}

/// A copy of `seq` with every backbone time converted to `to`. Domain `data` bags
/// are preserved verbatim — only the shared timing backbone is unit-converted. The
/// returned sequence carries `to` as its timeBase.
pub fn convert_sequence_time_base(seq: &MonetSequence, to: &TimeBase) -> MonetSequence {
    let from = &seq.time_base;
    if same_base(from, to) {
        return seq.clone();
    }
    MonetSequence {
        time_base: to.clone(),
        settings: seq.settings.as_ref().map(|s| {
            let mut s = s.clone();
            s.duration = s.duration.map(|d| convert_time(d, from, to));
            s
        }),
        tracks: seq.tracks.iter().map(|t| convert_track(t, from, to)).collect(),
        markers: seq
            .markers
            .as_ref()
            .map(|ms| ms.iter().map(|m| convert_marker(m, from, to)).collect()),
        ..seq.clone()
    }
}
