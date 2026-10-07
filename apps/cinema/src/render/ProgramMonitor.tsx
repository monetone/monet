// ─────────────────────────────────────────────────────────────
// ProgramMonitor — the program output <canvas>, driven by the wasm compositor.
//
// It sizes the engine to the sequence resolution × preview quality, sets the
// background, and composites the visible video layers at the current playhead.
// Decoded source frames are supplied by the playback compositor
// (playback/compositor.ts); until media is decoded this shows the program
// background + safe-area guides. The blit path is the Monet Vision pattern.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { engine, useStore } from "../state/app";
import { activeSequence } from "../timeline/model/query";
import { framesToTimecode } from "../timeline/time/timecode";
import { renderProgramFrame } from "../playback/compositor";
import { scheduleDecodesFor } from "../media/decoder";

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function ProgramMonitor() {
  const rev = useStore((s) => s.rev);
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const quality = useStore((s) => s.previewQuality);
  const playing = useStore((s) => s.playing);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef.current) engine.setCanvas(canvasRef.current);
    return () => engine.setCanvas(null);
  }, []);

  useEffect(() => {
    const seq = activeSequence(project);
    if (!seq) return;
    const scale = quality === "full" ? 1 : quality === "half" ? 0.5 : 0.25;
    engine.ensure(Math.round(seq.width * scale), Math.round(seq.height * scale));
    const [r, g, b] = hexToRgb(seq.background);
    engine.setBackground(r, g, b);
    // Compose whatever decoded frames the playback layer has cached for this
    // frame; falls back to background when nothing is ready.
    renderProgramFrame(seq, playhead, scale);
    engine.blit();
    // While paused, seek-decode any missing frames (each decode bumps + re-runs
    // this effect). During playback the player's live tick owns the elements, so
    // we must NOT seek here — that would fight native playback's currentTime.
    if (!playing) scheduleDecodesFor(seq, playhead);
  }, [project, playhead, quality, rev, playing]);

  const seq = activeSequence(project);
  const accent = "var(--accent-motion)";

  return (
    <div
      style={{
        width: "86%",
        maxWidth: 880,
        aspectRatio: seq ? `${seq.width}/${seq.height}` : "16/9",
        background: "#000",
        borderRadius: 4,
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 12px 48px rgba(0,0,0,0.6), inset 0 0 0 0.5px rgba(255,255,255,0.08)",
      }}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", imageRendering: "auto" }} />
      <div style={{ position: "absolute", inset: "5%", border: "1px dashed rgba(255,255,255,0.18)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: "10%", border: "1px dashed rgba(255,255,255,0.1)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: 12, top: 10, fontFamily: "var(--font-mono)", fontSize: 10, color: accent, letterSpacing: "0.05em" }}>PROGRAM</div>
      <div style={{ position: "absolute", right: 12, top: 10, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-1)" }}>
        {seq ? framesToTimecode(playhead, seq.fps) : "00:00:00:00"}
      </div>
    </div>
  );
}
