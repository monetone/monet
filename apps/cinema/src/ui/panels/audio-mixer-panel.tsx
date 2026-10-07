// Audio Mixer: a fader + mute/solo strip per audio track, plus a master.
// Faders write track gain (dB) via cmd.setTrackGain (undoable).

import * as cmd from "../../commands";
import { Slider } from "@monet-ui/monet-react";
import { useStore } from "../../state/app";
import { activeSequence, audioTracks } from "../../timeline/model/query";

const DB_MIN = -60;
const DB_MAX = 6;

export function AudioMixerPanel() {
  const project = useStore((s) => s.project);
  const seq = activeSequence(project);
  const tracks = seq ? audioTracks(seq) : [];

  const strip = (id: string | null, name: string, gain: number, muted: boolean, solo: boolean) => {
    const norm = (gain - DB_MIN) / (DB_MAX - DB_MIN);
    return (
      <div key={id ?? "mix"} style={{ flex: 1, minWidth: 44, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <div style={{ flex: 1, minHeight: 120, display: "flex", alignItems: "stretch", gap: 4 }}>
          <div style={{ width: 8, background: "rgba(0,0,0,0.4)", borderRadius: 2, position: "relative", overflow: "hidden", boxShadow: "inset 0 0 0 0.5px var(--stroke-soft)" }}>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${Math.max(8, norm * 90)}%`, background: "linear-gradient(to top, oklch(0.7 0.18 145) 0% 70%, oklch(0.75 0.18 90) 70% 90%, oklch(0.7 0.2 30) 90% 100%)" }} />
          </div>
          {id && (
            <div style={{ display: "flex", alignItems: "center" }}>
              <Slider
                vertical
                value={Math.max(0, Math.min(1, norm))}
                accent="oklch(0.78 0.14 200)"
                onChange={(f: number) => cmd.setTrackGain(id, +(DB_MIN + f * (DB_MAX - DB_MIN)).toFixed(1))}
              />
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {id && (
            <>
              <span className="monet-iconbtn" style={{ width: 16, height: 14, fontSize: 8, color: muted ? "oklch(0.7 0.2 30)" : "var(--text-3)" }} onClick={() => cmd.toggleTrackMute(id)}>M</span>
              <span className="monet-iconbtn" style={{ width: 16, height: 14, fontSize: 8, color: solo ? "oklch(0.8 0.16 90)" : "var(--text-3)" }} onClick={() => cmd.toggleTrackSolo(id)}>S</span>
            </>
          )}
        </div>
        <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>{name}</div>
        <div style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>{id ? `${gain.toFixed(0)}dB` : ""}</div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", gap: 8, height: "100%", padding: "6px 0" }}>
      {tracks.map((t) => strip(t.id, t.name, t.gain, t.muted, t.solo))}
      {strip(null, "MIX", 0, false, false)}
    </div>
  );
}
