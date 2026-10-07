// ─────────────────────────────────────────────────────────────
// SourceMonitor — review a bin item before editing it in. Seeks the media's
// hidden element to the source playhead and draws it; provides scrub, mark
// in/out, and 3-point Insert / Overwrite to the timeline at the program
// playhead. Loaded via double-click in the project bin.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { Icon } from "@monet-ui/monet-react";
import * as cmd from "../commands";
import { store, useStore } from "../state/app";
import { getHandle } from "../media/registry";
import { findMedia } from "../timeline/model/query";
import { framesToTimecode } from "../timeline/time/timecode";

const accent = "var(--accent-motion)";

export function SourceMonitor() {
  const project = useStore((s) => s.project);
  const mediaId = useStore((s) => s.sourceMediaId);
  const sourceFrame = useStore((s) => s.sourceFrame);
  const sourceIn = useStore((s) => s.sourceIn);
  const sourceOut = useStore((s) => s.sourceOut);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const media = mediaId ? findMedia(project, mediaId) : null;

  useEffect(() => {
    if (!media) return;
    const handle = getHandle(media.id);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const el = handle?.el;
    if (el instanceof HTMLVideoElement) {
      const draw = () => {
        canvas.width = media.width || el.videoWidth;
        canvas.height = media.height || el.videoHeight;
        try {
          ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        } catch {
          /* not ready */
        }
      };
      const t = sourceFrame / (media.fps || 24);
      if (Math.abs(el.currentTime - t) > 0.001) {
        el.currentTime = Math.min(t, el.duration || t);
        el.addEventListener("seeked", draw, { once: true });
      } else {
        draw();
      }
    }
  }, [media, sourceFrame]);

  if (!media) {
    return (
      <div style={{ padding: 10 }}>
        <div style={{ aspectRatio: "16/9", background: "#000", borderRadius: 4, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 11, boxShadow: "inset 0 0 0 0.5px var(--stroke-soft)" }}>
          Double-click a bin clip to load
        </div>
      </div>
    );
  }

  const dur = Math.max(1, media.durationFrames);
  const pct = (f: number) => `${(f / dur) * 100}%`;

  return (
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ aspectRatio: media.width ? `${media.width}/${media.height}` : "16/9", background: "#000", borderRadius: 4, position: "relative", overflow: "hidden", boxShadow: "inset 0 0 0 0.5px var(--stroke-soft)" }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
        <div style={{ position: "absolute", left: 10, top: 8, fontFamily: "var(--font-mono)", fontSize: 9, color: accent }}>SRC · {media.name}</div>
        <div style={{ position: "absolute", right: 10, top: 8, fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-2)" }}>{framesToTimecode(sourceFrame, media.fps)}</div>
      </div>

      {/* scrub bar with in/out shading */}
      <div
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const f = Math.round(((e.clientX - rect.left) / rect.width) * dur);
          store.setSourceFrame(f);
        }}
        style={{ height: 8, position: "relative", background: "rgba(0,0,0,0.4)", borderRadius: 3, cursor: "text" }}
      >
        <div style={{ position: "absolute", left: pct(sourceIn), width: pct(sourceOut - sourceIn), top: 0, bottom: 0, background: "color-mix(in oklch, var(--accent-motion) 35%, transparent)" }} />
        <div style={{ position: "absolute", left: pct(sourceFrame), top: -2, bottom: -2, width: 2, background: accent }} />
      </div>

      <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
        <span className="monet-iconbtn" title="Mark In (I)" onClick={() => store.setSourceIn(sourceFrame)}>{"["}</span>
        <span className="monet-iconbtn" onClick={() => store.setSourceFrame(sourceFrame - 1)}><Icon d="M11 4 6 8l5 4" size={12} /></span>
        <span className="monet-iconbtn" onClick={() => store.setSourceFrame(sourceFrame + 1)}><Icon d="M5 4l5 4-5 4" size={12} /></span>
        <span className="monet-iconbtn" title="Mark Out (O)" onClick={() => store.setSourceOut(sourceFrame)}>{"]"}</span>
      </div>

      <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
        <span className="monet-chip" style={{ cursor: "pointer" }} onClick={() => cmd.insertFromSource()} title="3-point Insert (ripple)">Insert</span>
        <span className="monet-chip" style={{ cursor: "pointer" }} onClick={() => cmd.overwriteFromSource()} title="3-point Overwrite">Overwrite</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-3)", alignSelf: "center" }}>
          {framesToTimecode(sourceIn, media.fps)} – {framesToTimecode(sourceOut, media.fps)}
        </span>
      </div>
    </div>
  );
}
