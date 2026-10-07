// ─────────────────────────────────────────────────────────────
// ui/transport-bar — the top options strip (transport + readouts)
// ─────────────────────────────────────────────────────────────

import { Icon, I, OptionsBar } from "@monet-ui/monet-react";
import {
  projectDuration,
  setEditorMode,
  setPlayhead,
  toggleMetronome,
} from "../engine";
import { useEditorState, useStore } from "../state/store-context";
import { play, returnToZero, stop, togglePlay } from "../audio/use-playback";
import { recordingSupported, toggleRecording } from "../audio/use-recording";
import { toggleLoop } from "./commands";
import { dbLabel, formatTime, type TimeFormat } from "./format";

export function TransportBar({ timeFormat = "decimal" }: { timeFormat?: TimeFormat }) {
  const store = useStore();
  const st = useEditorState();
  const t = st.transport;
  const total = projectDuration(st.project);
  const fmtOpts = { sampleRate: st.project.sampleRate, tempo: st.project.tempo, timeSignature: st.project.timeSignature };

  return (
    <OptionsBar>
      <OptionsBar.Group>
        <span className="monet-iconbtn" title="Return to start" onClick={() => returnToZero(store)}>
          <Icon d={I.rewind} size={13} />
        </span>
        <span className="monet-iconbtn" title="Stop" onClick={() => stop(store)}>
          <Icon d={I.stop} size={11} />
        </span>
        <span
          className={`monet-iconbtn ${t.playing ? "is-active" : ""}`}
          style={t.playing ? { background: "var(--glass-3)" } : undefined}
          title={t.playing ? "Pause" : "Play (Space)"}
          onClick={() => togglePlay(store)}
        >
          <Icon d={t.playing ? I.pause : I.play} size={12} />
        </span>
        <span
          className={`monet-iconbtn ${t.loopEnabled ? "is-active" : ""}`}
          title={st.selection.range ? "Loop selection" : "Loop"}
          onClick={() => toggleLoop(store)}
        >
          <Icon d={I.loop} size={13} />
        </span>
        <span
          className={`monet-iconbtn ${t.metronome ? "is-active" : ""}`}
          title="Metronome"
          onClick={() => store.dispatch(toggleMetronome(), { history: false })}
        >
          <Icon d="M8 2L13 13L3 13Z M8 2L8 10" size={13} />
        </span>
        <span
          style={{ color: t.recording ? "#fff" : "oklch(0.7 0.2 30)" }}
          className={`monet-iconbtn ${t.recording ? "is-active" : ""}`}
          title={recordingSupported() ? (t.recording ? "Stop recording" : "Record armed tracks") : "Audio input recording unavailable"}
          onClick={() => void toggleRecording(store).catch((err) => console.error("[rythme] recording failed", err))}
        >
          <Icon d={I.record} size={13} />
        </span>
        {(t.recording || t.recordingInput) && (
          <span
            title={`Input ${dbLabel(t.recordingInput?.peakDb ?? -Infinity)} peak · ${dbLabel(t.recordingInput?.rmsDb ?? -Infinity)} RMS${t.recordingInput?.clipped ? " · clipped" : ""}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 118 }}
          >
            <span
              style={{
                position: "relative",
                width: 58,
                height: 6,
                borderRadius: 3,
                overflow: "hidden",
                background: "var(--glass-2)",
                boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--border) 70%, transparent)",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: `${Math.round(Math.min(1, t.recordingInput?.peak ?? 0) * 100)}%`,
                  height: "100%",
                  background: t.recordingInput?.clipped ? "oklch(0.68 0.22 28)" : "var(--accent-audio)",
                }}
              />
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: t.recordingInput?.clipped ? "oklch(0.78 0.18 28)" : "var(--text-3)" }}>
              {dbLabel(t.recordingInput?.peakDb ?? -Infinity)}
            </span>
          </span>
        )}
      </OptionsBar.Group>

      <OptionsBar.Group>
        <span
          className="rh-time"
          style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-1)", minWidth: 92, cursor: "ew-resize" }}
          title="Playhead"
          onClick={() => !t.playing && play(store)}
        >
          {formatTime(t.playhead, timeFormat, fmtOpts)}
        </span>
        <span style={{ color: "var(--text-3)", fontSize: 11 }}>/</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)" }}>{formatTime(total, timeFormat, fmtOpts)}</span>
        <span
          className="monet-iconbtn"
          title="Set playhead to 0"
          onClick={() => store.dispatch(setPlayhead(0), { history: false })}
        >
          ⤒
        </span>
      </OptionsBar.Group>

      <OptionsBar.Group>
        <span
          className={`monet-chip ${st.mode === "multitrack" ? "is-active" : ""}`}
          title="Multitrack Editor"
          onClick={() => store.dispatch(setEditorMode("multitrack"), { history: false, dirty: true })}
        >
          Multitrack
        </span>
        <span
          className={`monet-chip ${st.mode === "waveform" ? "is-active" : ""}`}
          title="Waveform Editor"
          onClick={() => store.dispatch(setEditorMode("waveform"), { history: false, dirty: true })}
        >
          Waveform
        </span>
      </OptionsBar.Group>

      <OptionsBar.Group>
        <span className="monet-chip is-active">{Math.round(st.project.tempo)} BPM</span>
        <span className="monet-chip">{st.project.timeSignature[0]}/{st.project.timeSignature[1]}</span>
        <span className="monet-chip">{(st.project.sampleRate / 1000).toFixed(st.project.sampleRate % 1000 ? 1 : 0)} kHz</span>
      </OptionsBar.Group>

      <div style={{ flex: 1 }} />

      <OptionsBar.Group>
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>
          {st.project.tracks.length} tracks · {st.selection.range ? `${(st.selection.range.end - st.selection.range.start).toFixed(2)}s sel` : st.selection.clipIds.length ? `${st.selection.clipIds.length} clip(s)` : "no selection"}
        </span>
      </OptionsBar.Group>
    </OptionsBar>
  );
}
