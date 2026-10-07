// ui/panels/timeline — the master timeline: a bar per layer + a keyframe lane
// per animated property, the playhead, and the transport. Scrub sets the
// playhead; dragging a keyframe writes its new time back to the model.

import { Timeline, type TimelineTrack, Transport } from "@monet-ui/monet-react";
import { goToEnd, goToStart, togglePlay } from "../../commands";
import { setTrackKeyframes } from "../../commands";
import { activeComp, findLayer } from "../../model/query";
import { compExtent } from "../../model/sample";
import type { EaseId, Keyframe as ModelKeyframe, TrackProperty } from "../../model/types";
import { player } from "../../playback/player";
import { store, useEditor } from "../../state/store";

const ACCENT = "var(--accent-motion, #e64980)";
const SEP = "::";

const diamond = (e: EaseId): "linear" | "bezier" | "hold" => (e === "hold" ? "hold" : e === "linear" ? "linear" : "bezier");

export function TimelinePanel() {
  const { project, playhead, playing, loop, pixelsPerSecond } = useEditor();
  const comp = activeComp(project);
  const duration = Math.max(0.001, comp.duration, compExtent(comp));

  const tracks: TimelineTrack[] = [];
  for (const layer of comp.layers) {
    tracks.push({
      id: `${layer.id}${SEP}bar`,
      name: layer.name,
      kind: "clips",
      color: layer.color,
      clips: [{ x: layer.inPoint, w: Math.max(0.05, layer.outPoint - layer.inPoint), label: layer.kind }],
      locked: layer.locked,
    });
    for (const tr of layer.tracks) {
      tracks.push({
        id: `${layer.id}${SEP}${tr.property}`,
        name: `    ${tr.property}`,
        kind: "keyframes",
        color: layer.color,
        keyframes: tr.keyframes.map((kf) => ({ id: kf.id, time: kf.time, ease: diamond(kf.ease) })),
      });
    }
  }

  const onTracksChange = (next: TimelineTrack[]) => {
    for (const t of next) {
      if (t.kind !== "keyframes") continue;
      const [layerId, prop] = t.id.split(SEP) as [string, TrackProperty];
      const layer = findLayer(comp, layerId);
      const model = layer?.tracks.find((x) => x.property === prop);
      if (!model) continue;
      const byId = new Map(model.keyframes.map((k) => [k.id, k]));
      const merged: ModelKeyframe[] = (t.keyframes ?? []).map((k) => {
        const prev = byId.get(k.id);
        return prev ? { ...prev, time: k.time } : { id: k.id, time: k.time, value: 0, ease: "linear" as EaseId };
      });
      const changed = JSON.stringify(merged.map((m) => [m.id, m.time])) !== JSON.stringify(model.keyframes.map((m) => [m.id, m.time]));
      if (changed) setTrackKeyframes(layerId, prop, merged);
    }
  };

  return (
    <div style={{ height: "100%" }}>
      <Timeline
        tracks={tracks}
        duration={duration}
        time={playhead}
        onTimeChange={(t) => {
          store.setPlayhead(t);
          if (store.getState().playing) player.resync();
        }}
        onTracksChange={onTracksChange}
        pixelsPerSecond={pixelsPerSecond}
        headWidth={180}
        fps={comp.fps}
        accent={ACCENT}
        toolbar={
          <Transport
            playing={playing}
            onPlayingChange={() => togglePlay()}
            loop={loop}
            onLoopChange={(l) => store.setLoop(l)}
            time={playhead}
            duration={duration}
            fps={comp.fps}
            onSkipStart={goToStart}
            onSkipEnd={goToEnd}
            accent={ACCENT}
          />
        }
      />
    </div>
  );
}
