// Project bin: imported media + synthetic-source generators. Double-click a
// clip to load it into the Source monitor; the import button asks the media
// subsystem (via a DOM event) to open the native picker.

import { Icon, I } from "@monet-ui/monet-react";
import * as cmd from "../../commands";
import { store, useStore } from "../../state/app";
import { getHandle } from "../../media/registry";
import { MEDIA_DND } from "../dnd";
import { formatClock } from "../../timeline/time/timecode";
import type { MediaItem } from "../../timeline/model/types";

const kindGlyph: Record<string, string> = { video: "▦", audio: "♪", image: "▢", color: "■" };

export function ProjectPanel() {
  const project = useStore((s) => s.project);
  const sourceId = useStore((s) => s.sourceMediaId);

  const onOpen = (m: MediaItem) => store.loadSource(m.id, m.durationFrames);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="monet-chip" style={{ cursor: "pointer" }} onClick={() => document.dispatchEvent(new CustomEvent("cinema:import"))}>
          <Icon d={I.plus ?? "M8 3v10M3 8h10"} size={10} /> Import
        </span>
        <span className="monet-chip" style={{ cursor: "pointer" }} onClick={() => cmd.addColorMatte()}>+ Color</span>
        <span className="monet-chip" style={{ cursor: "pointer" }} onClick={() => cmd.addTitle("Title")}>+ Title</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>{project.media.length} items</span>
      </div>

      {project.media.length === 0 && (
        <div style={{ padding: "18px 8px", textAlign: "center", color: "var(--text-3)", fontSize: 11 }}>
          No media. Import a file or add a color matte.
        </div>
      )}

      {project.media.map((m) => {
        const thumb = getHandle(m.id)?.thumb;
        return (
          <div
            key={m.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(MEDIA_DND, m.id)}
            onDoubleClick={() => onOpen(m)}
            title="Double-click to load in Source · drag to the timeline"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px",
              borderRadius: 5,
              cursor: "pointer",
              background: sourceId === m.id ? "color-mix(in oklch, var(--accent-motion) 18%, transparent)" : "transparent",
            }}
          >
            <span
              style={{
                width: 30,
                height: 20,
                flex: "0 0 30px",
                borderRadius: 2,
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                color: "#fff",
                overflow: "hidden",
                background: m.kind === "color" && m.color ? m.color : "linear-gradient(135deg,#2a2a2a,#4a4a4a)",
                boxShadow: "inset 0 0 0 0.5px var(--stroke-soft)",
              }}
            >
              {thumb ? <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : kindGlyph[m.kind] ?? "▦"}
            </span>
            <span style={{ flex: 1, fontSize: 11, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-3)" }}>{m.durationFrames ? formatClock(m.durationFrames, m.fps) : "—"}</span>
            <span className="monet-iconbtn" title="Insert at playhead" onClick={(e) => { e.stopPropagation(); cmd.addMediaToTimeline(m.id); }} style={{ width: 16, color: "var(--text-3)" }}>
              +
            </span>
          </div>
        );
      })}
    </div>
  );
}
