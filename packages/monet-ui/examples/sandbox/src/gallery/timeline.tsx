// Component-gallery demos — Creative · Timeline / motion (Wave 3).
// One GalleryEntry + a self-contained, hook-using demo component per timeline
// component (TimeDisplay, Transport, TimelineRuler, Playhead, KeyframeTrack,
// Timeline). Each renders inside a ~300×250 floating panel, so the demos stay
// compact and lean on realistic mock clips / keyframes / track data.
import { useState } from "react";
import {
  TimeDisplay,
  Transport,
  TimelineRuler,
  Playhead,
  KeyframeTrack,
  Timeline,
  type Keyframe,
  type TimelineTrack,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

// ─── TimeDisplay ───────────────────────────────────────────────
// Click-to-edit timecode readout (controlled). A muted duration readout sits
// alongside it to show the secondary styling.
function TimeDisplayDemo() {
  const [time, setTime] = useState(61.5);
  return (
    <div style={{ display: "grid", gap: 10, padding: 8, justifyItems: "start" }}>
      <TimeDisplay value={time} fps={24} onChange={setTime} accent="var(--accent-1)" />
      <TimeDisplay value={time} format="ms" onChange={setTime} />
      <TimeDisplay value={142} muted aria-label="Duration" />
      <span style={{ fontSize: 11, opacity: 0.6 }}>Click a readout to edit (Enter / blur commits)</span>
    </div>
  );
}

// ─── Transport ─────────────────────────────────────────────────
// Full media-transport toolbar (controlled playing / loop / record) over a mock
// 142s clip. Stop and the skip buttons rewind the readout.
function TransportDemo() {
  const duration = 142;
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [record, setRecord] = useState(false);
  const [time, setTime] = useState(28.25);
  return (
    <div style={{ padding: 8 }}>
      <Transport
        playing={playing}
        onPlayingChange={setPlaying}
        loop={loop}
        onLoopChange={setLoop}
        record={record}
        onRecordChange={setRecord}
        time={time}
        duration={duration}
        fps={24}
        onSkipStart={() => setTime(0)}
        onStop={() => setTime(0)}
        accent="var(--accent-2)"
      />
    </div>
  );
}

// ─── TimelineRuler ─────────────────────────────────────────────
// A scrubbable tick ruler hosting a draggable Playhead — both share one
// pixelsPerSecond / duration so they stay pixel-aligned. Scrubbing the surface
// and dragging the head both drive `time`.
function TimelineRulerDemo() {
  const duration = 30;
  const pps = 24;
  const [time, setTime] = useState(8);
  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
      <TimelineRuler
        duration={duration}
        pixelsPerSecond={pps}
        fps={24}
        onScrub={setTime}
        accent="var(--accent-1)"
      >
        <Playhead
          value={time}
          duration={duration}
          pixelsPerSecond={pps}
          fps={24}
          full
          onChange={setTime}
          accent="var(--accent-1)"
        />
      </TimelineRuler>
    </div>
  );
}

// ─── Playhead ──────────────────────────────────────────────────
// A draggable seconds head on a bare track (compact). Drag it or use Arrow keys
// (frame step) / Shift+Arrow (1s) / Home·End once focused; a TimeDisplay echoes
// the position. The relatively-positioned track is the head's offsetParent.
function PlayheadDemo() {
  const duration = 20;
  const pps = 28;
  const [time, setTime] = useState(6);
  return (
    <div style={{ display: "grid", gap: 12, padding: 12, alignContent: "center" }}>
      <div
        style={{
          position: "relative",
          height: 44,
          width: duration * pps,
          maxWidth: "100%",
          background: "var(--surface-2, rgba(255,255,255,0.04))",
          borderRadius: 6,
        }}
      >
        <Playhead
          value={time}
          duration={duration}
          pixelsPerSecond={pps}
          fps={24}
          full={false}
          onChange={setTime}
          accent="var(--accent-3)"
        />
      </div>
      <TimeDisplay value={time} fps={24} aria-label="Playhead time" />
    </div>
  );
}

// ─── KeyframeTrack ─────────────────────────────────────────────
// A lane of draggable keyframe diamonds (controlled) with mixed easing styles.
// Drag a diamond to retime it (snaps to frames), double-click the lane to add
// one, Delete to remove the selected diamond.
const OPACITY_KFS: Keyframe[] = [
  { id: "k1", time: 0, value: 0, ease: "linear" },
  { id: "k2", time: 1.5, value: 100, ease: "bezier" },
  { id: "k3", time: 4, value: 100, ease: "hold" },
  { id: "k4", time: 6, value: 40, ease: "bezier" },
];
function KeyframeTrackDemo() {
  const duration = 8;
  const [kfs, setKfs] = useState<Keyframe[]>(OPACITY_KFS);
  return (
    <div style={{ display: "grid", alignContent: "center", height: "100%" }}>
      <KeyframeTrack
        label="Opacity"
        keyframes={kfs}
        onChange={setKfs}
        duration={duration}
        pixelsPerSecond={28}
        fps={24}
        accent="var(--accent-2)"
      />
    </div>
  );
}

// ─── Timeline (composite) ──────────────────────────────────────
// The composite editor: a Transport toolbar over a ruler + playhead, with mixed
// clip and keyframe lanes. `onTracksChange` keeps the keyframe lane editable;
// `onTimeChange` threads the scrubbed/dragged playhead time back in.
const TIMELINE_TRACKS: TimelineTrack[] = [
  {
    id: "video",
    name: "Video",
    color: "var(--accent-1)",
    kind: "clips",
    clips: [
      { id: "intro", x: 0, w: 4, label: "Intro" },
      { id: "b-roll", x: 5, w: 7, label: "B-roll" },
      { id: "outro", x: 14, w: 4, label: "Outro" },
    ],
  },
  {
    id: "audio",
    name: "Audio",
    color: "var(--accent-3)",
    kind: "clips",
    muted: true,
    clips: [{ id: "score", x: 0, w: 18, label: "Score" }],
  },
  {
    id: "opacity",
    name: "Opacity",
    color: "var(--accent-2)",
    kind: "keyframes",
    keyframes: [
      { id: "o1", time: 0, ease: "linear" },
      { id: "o2", time: 4, ease: "bezier" },
      { id: "o3", time: 12, ease: "hold" },
    ],
  },
];
function TimelineDemo() {
  const duration = 20;
  const [time, setTime] = useState(6);
  const [playing, setPlaying] = useState(false);
  const [tracks, setTracks] = useState<TimelineTrack[]>(TIMELINE_TRACKS);
  return (
    <Timeline
      tracks={tracks}
      duration={duration}
      time={time}
      onTimeChange={setTime}
      onTracksChange={setTracks}
      pixelsPerSecond={14}
      headWidth={96}
      fps={24}
      toolbar={
        <Transport
          playing={playing}
          onPlayingChange={setPlaying}
          time={time}
          duration={duration}
          onSkipStart={() => setTime(0)}
          onStop={() => setTime(0)}
        />
      }
    />
  );
}

export const timelineEntries: GalleryEntry[] = [
  {
    id: "timeline/TimeDisplay",
    label: "TimeDisplay",
    category: "Timeline / motion",
    section: "Creative",
    render: () => <TimeDisplayDemo />,
  },
  {
    id: "timeline/Transport",
    label: "Transport",
    category: "Timeline / motion",
    section: "Creative",
    render: () => <TransportDemo />,
  },
  {
    id: "timeline/TimelineRuler",
    label: "TimelineRuler",
    category: "Timeline / motion",
    section: "Creative",
    render: () => <TimelineRulerDemo />,
    flush: true,
  },
  {
    id: "timeline/Playhead",
    label: "Playhead",
    category: "Timeline / motion",
    section: "Creative",
    render: () => <PlayheadDemo />,
  },
  {
    id: "timeline/KeyframeTrack",
    label: "KeyframeTrack",
    category: "Timeline / motion",
    section: "Creative",
    render: () => <KeyframeTrackDemo />,
    flush: true,
  },
  {
    id: "timeline/Timeline",
    label: "Timeline",
    category: "Timeline / motion",
    section: "Creative",
    render: () => <TimelineDemo />,
    flush: true,
  },
];
