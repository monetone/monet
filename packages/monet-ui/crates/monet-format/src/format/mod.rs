// ─────────────────────────────────────────────────────────────
// format — the universal `.monet` project envelope (read/write/convert).
//
// Ported 1:1 from the former TypeScript `@monet-ui/monet-format`; this module is
// the single source of truth for the `.monet` schema. The `wasm` feature (see
// `crate::wasm`) exposes `parse`/`serialize`/`convert_sequence_time_base` to JS.
// ─────────────────────────────────────────────────────────────

pub mod convert;
pub mod schema;
pub mod serialize;

pub use convert::{
    convert_sequence_time_base, convert_time, frames_to_seconds, seconds_to_frames,
    seconds_to_time, time_to_seconds,
};
pub use schema::{
    AppInfo, DataBag, Extra, MediaSource, MonetClip, MonetDefaults, MonetDocument, MonetDuration,
    MonetFile, MonetMarker, MonetMedia, MonetSequence, MonetSequenceSettings, MonetTrack, TimeBase,
    MONET_FORMAT, SCHEMA_VERSION,
};
pub use serialize::{create_file, get_data, parse, serialize, set_data, MonetFormatError};

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn clip(id: &str, start: f64, duration: f64, in_point: f64) -> MonetClip {
        MonetClip {
            id: id.to_string(),
            start,
            duration,
            in_point,
            speed: 1.0,
            enabled: true,
            media_id: None,
            name: None,
            data: None,
            extra: Default::default(),
        }
    }

    fn video_doc() -> MonetDocument {
        let mut c = clip("c1", 0.0, 48.0, 12.0);
        c.media_id = Some("m1".to_string());
        c.data = Some(json!({ "cinema": { "transform": { "x": 10 }, "blendMode": "screen" } }));
        MonetDocument {
            id: Some("p1".to_string()),
            name: "Demo".to_string(),
            defaults: Some(MonetDefaults {
                fps: Some(24.0),
                width: Some(1920.0),
                height: Some(1080.0),
                ..Default::default()
            }),
            media: vec![MonetMedia {
                id: "m1".to_string(),
                name: "a.mov".to_string(),
                kind: "video".to_string(),
                source: MediaSource { path: Some("file:///a.mov".to_string()), ..Default::default() },
                duration: Some(MonetDuration { frames: Some(240.0), fps: Some(24.0), ..Default::default() }),
                width: None,
                height: None,
                has_audio: None,
                data: None,
                extra: Default::default(),
            }],
            sequences: vec![MonetSequence {
                id: "s1".to_string(),
                name: Some("Seq".to_string()),
                time_base: TimeBase::Frames { fps: 24.0 },
                settings: Some(MonetSequenceSettings {
                    width: Some(1920.0),
                    height: Some(1080.0),
                    duration: Some(240.0),
                    ..Default::default()
                }),
                tracks: vec![MonetTrack {
                    id: "V1".to_string(),
                    kind: "video".to_string(),
                    name: None,
                    enabled: None,
                    locked: None,
                    clips: vec![c],
                    data: None,
                    extra: Default::default(),
                }],
                markers: Some(vec![MonetMarker {
                    time: 24.0,
                    end: None,
                    name: Some("M".to_string()),
                    color: Some("#fff".to_string()),
                    data: None,
                    extra: Default::default(),
                }]),
                extra: Default::default(),
            }],
            active_sequence_id: Some("s1".to_string()),
            data: None,
            extra: Default::default(),
        }
    }

    #[test]
    fn round_trips_serialize_parse() {
        let file = create_file(
            video_doc(),
            AppInfo { name: "monet-cinema".to_string(), version: "0.1.0".to_string(), extra: Default::default() },
        );
        let back = parse(&serialize(&file)).unwrap();
        assert_eq!(back.format, "monet");
        assert_eq!(back.schema_version, 1);
        assert_eq!(back.app.name, "monet-cinema");
        assert_eq!(back.document.sequences[0].tracks[0].clips[0].in_point, 12.0);
    }

    #[test]
    fn rejects_non_monet_and_future_schema() {
        assert!(parse(&serde_json::to_string(&json!({ "format": "psd" })).unwrap()).is_err());
        assert!(parse("not json").is_err());
        let future = json!({ "format": "monet", "schemaVersion": 99, "document": { "name": "x", "media": [], "sequences": [] } });
        let err = parse(&serde_json::to_string(&future).unwrap()).unwrap_err();
        assert!(err.0.contains("newer"), "expected a 'newer' message, got: {}", err.0);
    }

    #[test]
    fn fills_defaults_and_repairs_dangling_active_sequence() {
        let raw = json!({
            "format": "monet", "schemaVersion": 1, "app": { "name": "x", "version": "1" },
            "document": { "name": "d", "media": [], "sequences": [
                { "id": "real", "timeBase": { "kind": "seconds" }, "tracks": [] }
            ], "activeSequenceId": "ghost" }
        });
        let f = parse(&serde_json::to_string(&raw).unwrap()).unwrap();
        assert_eq!(f.document.active_sequence_id.as_deref(), Some("real"));
    }

    #[test]
    fn data_bags_get_set_preserve_other_namespaces() {
        let mut c = clip("c", 0.0, 24.0, 0.0);
        c.data = Some(json!({ "cinema": { "blendMode": "screen" }, "rythme": { "gainDb": -3 } }));
        assert_eq!(get_data(c.data.as_ref(), "cinema")["blendMode"], json!("screen"));
        set_data(&mut c.data, "rythme", json!({ "gainDb": -6, "pan": 0.5 }));
        assert_eq!(get_data(c.data.as_ref(), "rythme")["gainDb"], json!(-6));
        // the other app's namespace is untouched
        assert_eq!(get_data(c.data.as_ref(), "cinema")["blendMode"], json!("screen"));
    }

    #[test]
    fn scalar_conversions_and_identity() {
        let frames24 = TimeBase::Frames { fps: 24.0 };
        let seconds = TimeBase::Seconds;
        assert_eq!(time_to_seconds(48.0, &frames24), 2.0);
        assert_eq!(seconds_to_time(2.0, &frames24), 48.0);
        assert_eq!(convert_time(48.0, &frames24, &frames24), 48.0);
        assert_eq!(convert_time(2.0, &seconds, &seconds), 2.0);
        assert_eq!(convert_time(48.0, &frames24, &seconds), 2.0);
        assert_eq!(convert_time(2.0, &seconds, &frames24), 48.0);
    }

    #[test]
    fn cross_open_frames_seconds_frames_exact_and_preserves_data() {
        let seq = video_doc().sequences.into_iter().next().unwrap();
        let in_seconds = convert_sequence_time_base(&seq, &TimeBase::Seconds);
        assert!(matches!(in_seconds.time_base, TimeBase::Seconds));
        let c = &in_seconds.tracks[0].clips[0];
        assert_eq!(c.start, 0.0);
        assert_eq!(c.duration, 2.0); // 48f / 24
        assert_eq!(c.in_point, 0.5); // 12f / 24
        assert_eq!(in_seconds.markers.as_ref().unwrap()[0].time, 1.0); // 24f / 24
        assert_eq!(c.data.as_ref().unwrap()["cinema"]["blendMode"], json!("screen"));

        let back = convert_sequence_time_base(&in_seconds, &TimeBase::Frames { fps: 24.0 });
        let c = &back.tracks[0].clips[0];
        assert_eq!((c.start, c.duration, c.in_point), (0.0, 48.0, 12.0));
        assert_eq!(c.data.as_ref().unwrap()["cinema"]["transform"]["x"], json!(10));
    }

    #[test]
    fn convert_does_not_mutate_source() {
        let seq = video_doc().sequences.into_iter().next().unwrap();
        let before = seq.tracks[0].clips[0].duration;
        let _ = convert_sequence_time_base(&seq, &TimeBase::Seconds);
        assert_eq!(seq.tracks[0].clips[0].duration, before);
    }

    #[test]
    fn preserves_unknown_forward_compat_fields() {
        // A future-minor / foreign writer adds fields we don't model — they must
        // survive a parse→serialize round-trip verbatim (the documented contract).
        let raw = json!({
            "format": "monet", "schemaVersion": 1, "app": { "name": "x", "version": "1", "futureAppField": 7 },
            "futureEnvelopeField": "keep",
            "document": { "name": "d", "media": [], "sequences": [{
                "id": "s", "timeBase": { "kind": "seconds" }, "tracks": [{
                    "id": "t", "kind": "audio", "clips": [{
                        "id": "c", "start": 0, "duration": 5, "futureClipField": { "nested": true }
                    }]
                }]
            }], "futureDocField": [1, 2, 3] }
        });
        let back = parse(&serde_json::to_string(&raw).unwrap()).unwrap();
        let out: serde_json::Value = serde_json::from_str(&serialize(&back)).unwrap();
        assert_eq!(out["futureEnvelopeField"], json!("keep"));
        assert_eq!(out["app"]["futureAppField"], json!(7));
        assert_eq!(out["document"]["futureDocField"], json!([1, 2, 3]));
        assert_eq!(
            out["document"]["sequences"][0]["tracks"][0]["clips"][0]["futureClipField"],
            json!({ "nested": true })
        );
    }

    #[test]
    fn lenient_clip_defaults_and_schema_version() {
        // A minimal clip (audio-style) omits inPoint/speed/enabled; a non-numeric
        // schemaVersion is tolerated (falls back to the current version) — both
        // matching the old TS loader rather than failing.
        let raw = json!({
            "format": "monet", "schemaVersion": "1", "app": { "name": "x", "version": "1" },
            "document": { "name": "d", "media": [], "sequences": [{
                "id": "s", "timeBase": { "kind": "seconds" }, "tracks": [{
                    "id": "t", "kind": "audio", "clips": [{ "id": "c", "start": 0, "duration": 5 }]
                }]
            }] }
        });
        let f = parse(&serde_json::to_string(&raw).unwrap()).unwrap();
        let c = &f.document.sequences[0].tracks[0].clips[0];
        assert_eq!((c.in_point, c.speed, c.enabled), (0.0, 1.0, true));
        assert_eq!(f.schema_version, 1);
    }

    #[test]
    fn seconds_to_frames_matches_js_math_round() {
        // JS Math.round rounds half toward +∞; verify our impl matches on the
        // negative half-boundaries where Rust's f64::round would differ.
        assert_eq!(seconds_to_frames(-0.5, 1.0), 0.0); // JS: Math.round(-0.5) == -0
        assert_eq!(seconds_to_frames(-1.5, 1.0), -1.0); // JS: -1, not -2
        assert_eq!(seconds_to_frames(2.5, 1.0), 3.0);
        assert_eq!(seconds_to_frames(0.5, 1.0), 1.0);
    }
}
