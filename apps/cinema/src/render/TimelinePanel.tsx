// ─────────────────────────────────────────────────────────────
// TimelinePanel — the editable timeline surface, rendered from the store's
// active sequence. Video tracks stack top-down (V-high on top), audio below.
//
// Interactions: click a lane/ruler to seek; click a clip to select; the Razor
// tool splits; drag a clip body to move it (across tracks, with edge snapping);
// drag a clip's left/right handle to trim; drop a bin item onto a lane to
// insert. Uses the Monet `monet-track` / `monet-clip` chrome + Waveform.
// ─────────────────────────────────────────────────────────────

import { Icon, I, Waveform } from "@monet-ui/monet-react";
import { useEffect, useRef, useState } from "react";
import { store, useStore } from "../state/app";
import { player } from "../playback/player";
import * as cmd from "../commands";
import {
  activeSequence,
  audioTracks,
  sequenceDuration,
  snapFrame,
  videoTracks,
} from "../timeline/model/query";
import { getHandle } from "../media/registry";
import { MEDIA_DND } from "../ui/dnd";
import { framesToTimecode } from "../timeline/time/timecode";
import type { Clip, Track } from "../timeline/model/types";

const HEAD_W = 132;
const accent = "var(--accent-motion)";
const AUDIO_COLOR = "oklch(0.78 0.14 200)";

interface DragState {
  kind: "move" | "trim-start" | "trim-end";
  clipId: string;
  fromTrackId: string;
  fromKind: "video" | "audio";
  startClientX: number;
  originStart: number;
  originDuration: number;
}
interface Ghost {
  clipId: string;
  startFrame: number;
  durationFrames: number;
}

export function TimelinePanel() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const pxf = useStore((s) => s.pxPerFrame);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const snapping = useStore((s) => s.snapping);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastClient = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const ghostRef = useRef<Ghost | null>(null);

  const seq = activeSequence(project);

  if (!seq) return <div style={{ padding: 12, color: "var(--text-3)" }}>No sequence</div>;

  const total = Math.max(sequenceDuration(seq), seq.fps * 10);
  const laneW = total * pxf;
  const selSet = new Set(selection);
  const vts = [...videoTracks(seq)].reverse();
  const ats = audioTracks(seq);

  const frameFromClientX = (clientX: number): number => {
    const lane = laneRef.current;
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    const x = clientX - rect.left + lane.scrollLeft - HEAD_W;
    return Math.max(0, Math.round(x / pxf));
  };

  const seek = (clientX: number) => {
    store.setPlayhead(frameFromClientX(clientX));
    player.resync();
  };

  const setGhostBoth = (g: Ghost | null) => {
    ghostRef.current = g;
    setGhost(g);
  };

  const beginDrag = (e: React.MouseEvent, clip: Clip, track: Track, kind: DragState["kind"]) => {
    e.stopPropagation();
    e.preventDefault();
    if (tool === "razor") {
      store.setPlayhead(frameFromClientX(e.clientX));
      cmd.razorAtPlayhead(true);
      return;
    }
    if (kind === "move") {
      if (e.shiftKey) store.toggleSelect(clip.id);
      else if (!selSet.has(clip.id)) store.selectOne(clip.id);
    }
    const d: DragState = {
      kind,
      clipId: clip.id,
      fromTrackId: track.id,
      fromKind: track.kind,
      startClientX: e.clientX,
      originStart: clip.start,
      originDuration: clip.duration,
    };
    dragRef.current = d;
    lastClient.current = { x: e.clientX, y: e.clientY };
    setGhostBoth({ clipId: clip.id, startFrame: clip.start, durationFrames: clip.duration });

    // Attach the drag listeners synchronously here (not via an effect) so no
    // pointer frame is dropped: an effect keyed on `ghost` tears down + re-binds
    // every move, which raced the final move/up and could commit a stale ghost
    // (no-op delta) or stale cursor (wrong destination track). pxf/seq/snapping/
    // playhead are constant for the drag's lifetime, so closing over them is safe.
    const onMove = (ev: MouseEvent) => {
      const dd = dragRef.current;
      if (!dd) return;
      lastClient.current = { x: ev.clientX, y: ev.clientY };
      const delta = Math.round((ev.clientX - dd.startClientX) / pxf);
      const thr = 8 / pxf;
      if (dd.kind === "move") {
        let start = Math.max(0, dd.originStart + delta);
        if (snapping) {
          const snapStart = snapFrame(seq, start, thr, dd.clipId, [playhead]);
          const snapEnd = snapFrame(seq, start + dd.originDuration, thr, dd.clipId, [playhead]);
          start = Math.abs(snapStart - start) <= Math.abs(snapEnd - (start + dd.originDuration)) ? snapStart : snapEnd - dd.originDuration;
          start = Math.max(0, start);
        }
        setGhostBoth({ clipId: dd.clipId, startFrame: start, durationFrames: dd.originDuration });
      } else if (dd.kind === "trim-start") {
        let start = Math.min(Math.max(0, dd.originStart + delta), dd.originStart + dd.originDuration - 1);
        if (snapping) start = Math.min(snapFrame(seq, start, thr, dd.clipId, [playhead]), dd.originStart + dd.originDuration - 1);
        setGhostBoth({ clipId: dd.clipId, startFrame: start, durationFrames: dd.originStart + dd.originDuration - start });
      } else {
        let end = Math.max(dd.originStart + 1, dd.originStart + dd.originDuration + delta);
        if (snapping) end = Math.max(dd.originStart + 1, snapFrame(seq, end, thr, dd.clipId, [playhead]));
        setGhostBoth({ clipId: dd.clipId, startFrame: dd.originStart, durationFrames: end - dd.originStart });
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const dd = dragRef.current;
      const g = ghostRef.current;
      dragRef.current = null;
      if (dd && g) {
        if (dd.kind === "move") {
          // Resolve the destination track under the cursor (same kind only).
          const el = document.elementFromPoint(lastClient.current.x, lastClient.current.y) as HTMLElement | null;
          const laneEl = el?.closest("[data-track-id]") as HTMLElement | null;
          const destId = laneEl?.dataset.trackId;
          const destKind = laneEl?.dataset.trackKind;
          const dest = destId && destKind === dd.fromKind ? destId : dd.fromTrackId;
          cmd.moveClipTo(dd.clipId, dest, g.startFrame);
        } else if (dd.kind === "trim-start") {
          cmd.trimClip(dd.clipId, "start", g.startFrame - dd.originStart);
        } else {
          cmd.trimClip(dd.clipId, "end", g.durationFrames - dd.originDuration);
        }
      }
      setGhostBoth(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onDrop = (e: React.DragEvent, track: Track) => {
    e.preventDefault();
    const mediaId = e.dataTransfer.getData(MEDIA_DND);
    if (mediaId) cmd.addMediaAt(mediaId, track.id, frameFromClientX(e.clientX), e.altKey);
  };

  const renderTrack = (track: Track, isAudio: boolean) => (
    <div key={track.id} className="monet-track" style={{ height: track.height, ["--accent" as string]: isAudio ? AUDIO_COLOR : accent }}>
      <div className="monet-track-head" style={{ height: track.height, padding: "0 8px", width: HEAD_W, flex: `0 0 ${HEAD_W}px` }}>
        <span
          className="monet-iconbtn"
          title={isAudio ? "Mute" : "Toggle Output"}
          onClick={() => (isAudio ? cmd.toggleTrackMute(track.id) : cmd.toggleTrackEnabled(track.id))}
          style={{ width: 16, height: 16, color: (isAudio ? !track.muted : track.enabled) ? "var(--text-1)" : "var(--text-3)" }}
        >
          {isAudio ? <span style={{ fontSize: 9 }}>{track.muted ? "M" : "m"}</span> : <Icon d={I.eye} size={11} />}
        </span>
        <span className="monet-iconbtn" title="Lock" onClick={() => cmd.toggleTrackLock(track.id)} style={{ width: 14, height: 14, color: track.locked ? accent : "var(--text-3)", fontSize: 9 }}>
          {track.locked ? "L" : "·"}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-1)" }}>{track.name}</span>
        <span style={{ flex: 1 }} />
        {isAudio && (
          <span className="monet-iconbtn" title="Solo" onClick={() => cmd.toggleTrackSolo(track.id)} style={{ width: 14, height: 14, color: track.solo ? "oklch(0.8 0.16 90)" : "var(--text-3)", fontSize: 9 }}>
            S
          </span>
        )}
      </div>
      <div className="monet-track-body" data-track-id={track.id} data-track-kind={track.kind} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, track)} style={{ position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px)", backgroundSize: `${seq.fps * pxf}px 100%` }} />
        {track.clips.map((c) => {
          const g = ghost && ghost.clipId === c.id ? ghost : null;
          const startF = g ? g.startFrame : c.start;
          const durF = g ? g.durationFrames : c.duration;
          const left = startF * pxf;
          const w = Math.max(2, durF * pxf);
          const sel = selSet.has(c.id);
          const peaks = isAudio ? getHandle(c.mediaId)?.peaks : undefined;
          return (
            <div
              key={c.id}
              className="monet-clip"
              data-clip-id={c.id}
              data-clip-kind={track.kind}
              onMouseDown={(e) => beginDrag(e, c, track, "move")}
              style={{
                position: "absolute",
                left,
                width: w,
                top: 3,
                bottom: 3,
                ["--accent" as string]: isAudio ? AUDIO_COLOR : accent,
                fontSize: 9,
                outline: sel ? "1.5px solid var(--text-1)" : "none",
                outlineOffset: -1,
                opacity: g ? 0.8 : 1,
                cursor: tool === "razor" ? "crosshair" : "grab",
                overflow: "hidden",
              }}
            >
              {/* trim handles */}
              {!track.locked && (
                <>
                  <div data-trim="start" onMouseDown={(e) => beginDrag(e, c, track, "trim-start")} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", zIndex: 2 }} />
                  <div data-trim="end" onMouseDown={(e) => beginDrag(e, c, track, "trim-end")} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize", zIndex: 2 }} />
                </>
              )}
              {c.transitionIn && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: Math.min(w / 2, c.transitionIn.durationFrames * pxf), background: "linear-gradient(to right, rgba(255,255,255,0.35), transparent)", pointerEvents: "none" }} />}
              {c.transitionOut && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: Math.min(w / 2, c.transitionOut.durationFrames * pxf), background: "linear-gradient(to left, rgba(255,255,255,0.35), transparent)", pointerEvents: "none" }} />}
              {isAudio && (
                <div style={{ position: "absolute", inset: "8px 2px 2px", pointerEvents: "none" }}>
                  {peaks ? <PeaksCanvas peaks={peaks} width={Math.max(8, w - 4)} height={Math.max(8, track.height - 18)} /> : <Waveform width={Math.max(8, w - 4)} height={Math.max(8, track.height - 18)} seed={c.start + 7} accent={AUDIO_COLOR} />}
                </div>
              )}
              <span style={{ position: "relative", padding: "0 4px", whiteSpace: "nowrap" }}>{c.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ height: 24, flex: "0 0 24px", display: "flex", alignItems: "center", background: "rgba(0,0,0,0.25)", borderBottom: "0.5px solid var(--stroke-soft)", padding: "0 8px", gap: 6 }}>
        <span className="monet-chip is-active" style={{ height: 18, fontSize: 10 }}>{seq.name}</span>
        <span className="monet-chip" style={{ height: 18, fontSize: 10, cursor: "pointer" }} onClick={() => cmd.newSequence()}>+ New</span>
        <span className="monet-chip" style={{ height: 18, fontSize: 10, cursor: "pointer", opacity: snapping ? 1 : 0.5 }} onClick={() => store.setSnapping(!snapping)} title="Snapping (S)">⌁ Snap</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>{seq.height}p · {Math.round(seq.fps)}</span>
      </div>

      <div ref={laneRef} style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <div onMouseDown={(e) => seek(e.clientX)} style={{ position: "sticky", top: 0, zIndex: 6, height: 18, display: "flex", alignItems: "flex-end", background: "rgba(0,0,0,0.3)", borderBottom: "0.5px solid var(--stroke-soft)", paddingLeft: HEAD_W, cursor: "text" }}>
          <div style={{ position: "relative", width: laneW, height: "100%" }}>
            {Array.from({ length: Math.ceil(total / seq.fps) + 1 }).map((_, i) => (
              <span key={i} style={{ position: "absolute", left: i * seq.fps * pxf, bottom: 0, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-3)", borderLeft: "0.5px solid var(--stroke-soft)", paddingLeft: 3, height: 12 }}>
                {framesToTimecode(i * seq.fps, seq.fps).slice(3)}
              </span>
            ))}
          </div>
        </div>

        <div style={{ position: "relative" }}>
          {vts.map((t) => renderTrack(t, false))}
          <div style={{ height: 4, background: "rgba(0,0,0,0.25)", borderTop: "0.5px solid var(--stroke-soft)", borderBottom: "0.5px solid var(--stroke-soft)" }} />
          {ats.map((t) => renderTrack(t, true))}

          <div style={{ position: "absolute", top: 0, bottom: 0, left: HEAD_W + playhead * pxf, width: 1, background: accent, boxShadow: `0 0 6px ${accent}`, pointerEvents: "none", zIndex: 5 }}>
            <div style={{ position: "absolute", left: -5, top: -2, width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `7px solid ${accent}` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Draw real audio peaks (mirrored) onto a canvas. */
function PeaksCanvas({ peaks, width, height }: { peaks: Float32Array; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = AUDIO_COLOR;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    const mid = height / 2;
    for (let x = 0; x < width; x++) {
      const p = peaks[Math.floor((x / width) * peaks.length)] ?? 0;
      const h = p * mid;
      ctx.moveTo(x + 0.5, mid - h);
      ctx.lineTo(x + 0.5, mid + h);
    }
    ctx.stroke();
  }, [peaks, width, height]);
  return <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />;
}
