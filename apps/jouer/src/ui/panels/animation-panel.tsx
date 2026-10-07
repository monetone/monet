// ─────────────────────────────────────────────────────────────
// animation-panel.tsx — the keyframe timeline (the headline feature). A
// transport + timeline picker, an "add track" row for the selected object, and
// a ruler/playhead over one KeyframeTrack lane per (object, property) track.
// Drag diamonds to retime, double-click a lane to add, pick a keyframe to set
// its easing. Everything commits through commands as single undo steps.
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { Icon, I, Select, formatTimecode } from "@monet-ui/monet-react";
import { KeyframeTrack, Playhead, TimelineRuler } from "@monet-ui/monet-react";
import * as cmd from "../../commands";
import { store, useStore } from "../../state/app";
import { activeScene, activeTimeline, findObject, objectLabel } from "../../model/query";
import { sampleTrack, timelineExtent } from "../../model/sample";
import { EASES } from "../../model/ease";
import type { AnimTrack, EaseId, Keyframe, TrackProperty } from "../../model/types";

const HEAD = 150;
const ACCENT = "var(--accent-game)";

// "Skip to previous/next keyframe" glyphs (bar + triangle), like Unity's
// Animation-window keyframe-navigation buttons.
const PREV_KEY = "M4 3h2v10H4z M13 3v10l-7-5z";
const NEXT_KEY = "M10 3h2v10h-2z M3 3v10l7-5z";

const PROPS: { value: TrackProperty; label: string }[] = [
  { value: "x", label: "Position X" },
  { value: "y", label: "Position Y" },
  { value: "scaleX", label: "Scale X" },
  { value: "scaleY", label: "Scale Y" },
  { value: "angle", label: "Rotation" },
  { value: "alpha", label: "Alpha" },
  { value: "originX", label: "Origin X" },
  { value: "originY", label: "Origin Y" },
  { value: "width", label: "Width" },
  { value: "height", label: "Height" },
];

export function AnimationPanel() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const loop = useStore((s) => s.loopPlayback);
  const recording = useStore((s) => s.recording);
  const selection = useStore((s) => s.selection);
  const [pps, setPps] = useState(100);
  const [addProp, setAddProp] = useState<TrackProperty>("x");
  const [selKf, setSelKf] = useState<{ trackId: string; kfId: string } | null>(null);

  const scene = activeScene(project);
  const tl = activeTimeline(scene);
  const fps = project.fps || 60;
  if (!scene || !tl) return <div className="mj-pad mj-muted">No timeline.</div>;

  const extent = Math.max(tl.duration, timelineExtent(tl));
  const spanPx = Math.max(320, extent * pps);
  const sole = selection.length === 1 ? findObject(scene, selection[0]) : undefined;
  const selKfData = selKf ? tl.tracks.find((t) => t.id === selKf.trackId)?.keyframes.find((k) => k.id === selKf.kfId) : undefined;

  return (
    <div className="mj-anim">
      <div className="mj-anim-bar">
        <button className="mj-tinybtn" title="Go to start" onClick={() => store.setPlayhead(0)}><Icon d={I.rewind} size={12} /></button>
        <button className="mj-tinybtn" data-testid="prev-keyframe" title="Previous keyframe" onClick={() => cmd.goToPrevKeyframe()}><Icon d={PREV_KEY} size={12} /></button>
        <button className={"mj-tinybtn" + (playing ? " is-on" : "")} title="Play / Pause (Space)" onClick={() => store.togglePlaying()}>
          <Icon d={playing ? I.pause : I.play} size={12} />
        </button>
        <button className="mj-tinybtn" title="Stop" onClick={() => { store.setPlaying(false); store.setPlayhead(0); }}><Icon d={I.stop} size={12} /></button>
        <button className="mj-tinybtn" data-testid="next-keyframe" title="Next keyframe" onClick={() => cmd.goToNextKeyframe()}><Icon d={NEXT_KEY} size={12} /></button>
        <button
          className={"mj-tinybtn" + (recording ? " is-on" : "")}
          data-testid="record-toggle"
          title="Record — auto-key transform edits at the playhead"
          style={recording ? { color: "#ef4444" } : undefined}
          onClick={() => store.setRecording(!recording)}
        >
          <Icon d={I.record} size={12} />
        </button>
        <button className={"mj-tinybtn" + (loop ? " is-on" : "")} title="Loop" onClick={() => store.setLoopPlayback(!loop)}><Icon d={I.loop} size={12} /></button>
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: ACCENT, minWidth: 92 }}>
          {formatTimecode(playhead, { fps, format: "smpte" })}
        </span>
        <span className="mj-muted">/ {extent.toFixed(2)}s · {fps}fps</span>
        <span className="mj-spacer" />
        <Select
          value={tl.id}
          size="sm"
          options={scene.timelines.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(v) => store.setActiveTimeline(v)}
        />
        <button className="mj-tinybtn" title="New timeline" onClick={() => cmd.addTimeline()}><Icon d={I.plus} size={11} /></button>
        <label className="mj-muted mj-row" style={{ gap: 4 }} title="Timeline length">
          dur
          <input
            type="number" min={0.1} step={0.5} value={tl.duration}
            style={numStyle}
            onChange={(e) => cmd.updateTimeline(tl.id, { duration: Math.max(0.1, Number(e.target.value) || 0.1) })}
          />
        </label>
        <label className="mj-muted mj-row" style={{ gap: 4 }} title="Autoplay on start">
          <input type="checkbox" checked={tl.autoplay} onChange={(e) => cmd.updateTimeline(tl.id, { autoplay: e.target.checked })} />auto
        </label>
        <label className="mj-muted mj-row" style={{ gap: 4 }} title="Loop this timeline">
          <input type="checkbox" checked={tl.loop} onChange={(e) => cmd.updateTimeline(tl.id, { loop: e.target.checked })} />loop
        </label>
        <label className="mj-muted mj-row" style={{ gap: 4 }} title="Playback speed (Unity Animator speed; played/exported game)">
          spd
          <input
            type="number" min={0.1} step={0.1} data-testid="tl-speed" value={tl.speed}
            style={numStyle}
            onChange={(e) => cmd.updateTimeline(tl.id, { speed: Math.max(0.1, Number(e.target.value) || 1) })}
          />
        </label>
        <button className="mj-tinybtn" title="Zoom out" onClick={() => setPps((p) => Math.max(20, p / 1.4))}><Icon d={I.minus} size={11} /></button>
        <button className="mj-tinybtn" title="Zoom in" onClick={() => setPps((p) => Math.min(600, p * 1.4))}><Icon d={I.plus} size={11} /></button>
      </div>

      {/* add-track / selected-keyframe controls */}
      <div className="mj-anim-bar" style={{ borderBottom: "0.5px solid var(--stroke-soft)" }}>
        {sole ? (
          <>
            <span className="mj-muted">{objectLabel(sole)}</span>
            <Select value={addProp} size="sm" options={PROPS} onChange={(v) => setAddProp(v as TrackProperty)} />
            <button className="mj-tinybtn" onClick={() => cmd.addTrack(sole.id, addProp)}>+ Track / Key</button>
            <button className="mj-tinybtn" onClick={() => cmd.keyAllTransform(sole.id)}><Icon d={I.record} size={11} /> Key All</button>
          </>
        ) : (
          <span className="mj-muted">Select one object to add animation tracks.</span>
        )}
        <span className="mj-spacer" />
        {selKfData && selKf && (
          <>
            <span className="mj-muted">keyframe @ {selKfData.time.toFixed(2)}s</span>
            <input type="number" step={0.01} value={round(selKfData.value)} style={numStyle}
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && e.target.value.trim() !== "") cmd.updateKeyframe(selKf.trackId, selKf.kfId, { value: v }); }} />
            <Select value={selKfData.ease} size="sm" options={EASES.map((e) => ({ value: e.id, label: e.label }))}
              onChange={(v) => cmd.updateKeyframe(selKf.trackId, selKf.kfId, { ease: v as EaseId })} />
            <button className="mj-tinybtn" data-testid="copy-keyframe" title="Copy keyframe" onClick={() => cmd.copyKeyframe(selKf.trackId, selKf.kfId)}>Copy</button>
            <button className="mj-tinybtn" data-testid="paste-keyframe" title="Paste keyframe at playhead" onClick={() => cmd.pasteKeyframe(selKf.trackId)}>Paste</button>
            <button className="mj-tinybtn" onClick={() => { cmd.deleteKeyframe(selKf.trackId, selKf.kfId); setSelKf(null); }}>
              <Icon d={I.close} size={11} /> Delete
            </button>
          </>
        )}
      </div>

      <div className="mj-anim-body">
        <div style={{ position: "relative", width: HEAD + spanPx + 24, minWidth: "100%" }}>
          {/* ruler row */}
          <div style={{ display: "flex", alignItems: "stretch", height: 24 }}>
            <div style={{ width: HEAD, flex: "0 0 auto" }} className="mj-track-head mj-pad">Time</div>
            <div style={{ width: spanPx, position: "relative" }}>
              <TimelineRuler duration={extent} pixelsPerSecond={pps} fps={fps} offset={0} accent={ACCENT} onScrub={(s) => store.setPlayhead(s)}>
                <Playhead value={playhead} duration={extent} pixelsPerSecond={pps} offset={0} fps={fps} full={false} accent={ACCENT} onChange={(s) => store.setPlayhead(s)} />
              </TimelineRuler>
            </div>
          </div>

          {/* track rows */}
          {tl.tracks.length === 0 && (
            <div className="mj-muted mj-pad">No tracks. Select an object and add a track, or move an object and press <b>K</b> to key its transform.</div>
          )}
          {tl.tracks.map((track) => (
            <TrackRow key={track.id} track={track} scene={scene} extent={extent} pps={pps} fps={fps} selKf={selKf} onSelectKf={setSelKf} />
          ))}

          {/* full-height playhead line over the lanes */}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: HEAD + playhead * pps, width: 1, background: ACCENT, opacity: 0.8, pointerEvents: "none" }} />
        </div>
      </div>
    </div>
  );
}

function TrackRow(props: {
  track: AnimTrack;
  scene: ReturnType<typeof activeScene>;
  extent: number;
  pps: number;
  fps: number;
  selKf: { trackId: string; kfId: string } | null;
  onSelectKf: (s: { trackId: string; kfId: string } | null) => void;
}) {
  const { track, scene, extent, pps, fps, onSelectKf } = props;
  const obj = scene ? findObject(scene, track.targetId) : undefined;
  const propLabel = PROPS.find((p) => p.value === track.property)?.label ?? track.property;

  return (
    <div style={{ display: "flex", alignItems: "stretch", height: 30, borderTop: "0.5px solid var(--stroke-soft)" }}>
      <div style={{ width: HEAD, flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, padding: "0 8px", minWidth: 0 }}>
        <span className="mj-item-name" style={{ fontSize: 11.5, opacity: track.muted ? 0.4 : undefined }} title={`${obj ? objectLabel(obj) : "?"} · ${propLabel}`}>
          {obj ? objectLabel(obj) : "(missing)"}
        </span>
        <span className="mj-muted" style={{ flex: "0 0 auto", opacity: track.muted ? 0.4 : undefined }}>{propLabel}</span>
        <span className="mj-spacer" />
        <span
          data-testid="track-solo"
          title={track.solo ? "Unsolo track" : "Solo track (play only soloed tracks)"}
          style={{ cursor: "pointer", flex: "0 0 auto", fontSize: 10, fontWeight: 700, color: track.solo ? ACCENT : undefined, opacity: track.solo ? 1 : 0.5 }}
          onClick={() => cmd.setTrackSolo(track.id, !track.solo)}
        >
          S
        </span>
        <span
          data-testid="track-mute"
          title={track.muted ? "Unmute track" : "Mute track"}
          style={{ cursor: "pointer", flex: "0 0 auto", fontSize: 10, fontWeight: 700, color: track.muted ? ACCENT : undefined, opacity: track.muted ? 1 : 0.5 }}
          onClick={() => cmd.setTrackMuted(track.id, !track.muted)}
        >
          M
        </span>
        <span
          data-testid="track-lock"
          title={track.locked ? "Unlock track" : "Lock track (read-only; still plays)"}
          style={{ cursor: "pointer", flex: "0 0 auto", fontSize: 10, fontWeight: 700, color: track.locked ? ACCENT : undefined, opacity: track.locked ? 1 : 0.5 }}
          onClick={() => cmd.setTrackLocked(track.id, !track.locked)}
        >
          L
        </span>
        <span className="mj-item-icon" title="Remove track" style={{ cursor: "pointer", opacity: 0.6 }} onClick={() => cmd.removeTrack(track.id)}>
          <Icon d={I.close} size={11} />
        </span>
      </div>
      <div style={{ width: props.extent ? undefined : 0, flex: 1, position: "relative" }}>
        <KeyframeTrack
          keyframes={track.keyframes.map((k) => ({ id: k.id, time: k.time, value: k.value, ease: diamondEase(k.ease) }))}
          duration={extent}
          pixelsPerSecond={pps}
          fps={fps}
          offset={0}
          accent={ACCENT}
          snap={false}
          onSelectKeyframe={(id) => onSelectKf(id ? { trackId: track.id, kfId: id } : null)}
          onChange={(kfs) => cmd.liveTrackKeyframes(track.id, toModelKeyframes(track, kfs))}
          onChangeEnd={(kfs) => cmd.commitTrackKeyframes(track.id, toModelKeyframes(track, kfs))}
        />
      </div>
    </div>
  );
}

/** Map the timeline component's keyframes back to the model, preserving each
 *  keyframe's easing and giving a newly-added (double-clicked) diamond a sensible
 *  value sampled from the track at its time rather than a hard 0. */
function toModelKeyframes(track: AnimTrack, kfs: { id: string; time: number; value?: number }[]): Keyframe[] {
  return kfs.map((k) => {
    const existing = track.keyframes.find((e) => e.id === k.id);
    const value = k.value ?? existing?.value ?? sampleTrack(track, k.time) ?? 0;
    return { id: k.id, time: k.time, value, ease: existing?.ease ?? "sineInOut" };
  });
}

/** Reduce the model's 18 easings to the timeline's 3 diamond styles (a hold
 *  keyframe draws as a square, eased ones as bezier, linear as a plain diamond). */
function diamondEase(e: EaseId): "linear" | "bezier" | "hold" {
  return e === "hold" ? "hold" : e === "linear" ? "linear" : "bezier";
}

const numStyle: React.CSSProperties = {
  width: 64,
  background: "var(--glass-1)",
  border: "0.5px solid var(--stroke-soft)",
  borderRadius: 4,
  color: "var(--text-1)",
  fontSize: 11.5,
  padding: "2px 5px",
};
const round = (n: number) => Math.round(n * 1000) / 1000;
