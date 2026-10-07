// ─────────────────────────────────────────────────────────────
// Monet Cinema — the application shell. Composes the Monet dockable workspace
// (tool rail, transport options bar, wired panels, menus, status bar) around
// the program monitor and the editable timeline, all driven by the store.
// ─────────────────────────────────────────────────────────────

import {
  Canvas,
  DockableWorkspace,
  Icon,
  I,
  OptionsBar,
  StatusBar,
  ToolRail,
  useFileDrop,
  useMonetContext,
  type Platform,
  syncMacMenu,
} from "@monet-ui/monet-react";
import { useEffect } from "react";
import * as cmd from "./commands";
import { store, useStore } from "./state/app";
import { player } from "./playback/player";
import { importMediaInteractive } from "./media/import";
import { exportEdl, exportFrame, exportVideoFile, openDroppedFiles, openDroppedPaths, openProject, saveProject } from "./io/files";
import { ProgramMonitor } from "./render/ProgramMonitor";
import { SourceMonitor } from "./render/SourceMonitor";
import { TimelinePanel } from "./render/TimelinePanel";
import { ProjectPanel } from "./ui/panels/project-panel";
import { EffectControlsPanel } from "./ui/panels/effect-controls-panel";
import { EffectsPanel } from "./ui/panels/effects-panel";
import { LumetriPanel } from "./ui/panels/lumetri-panel";
import { AudioMixerPanel } from "./ui/panels/audio-mixer-panel";
import { ScopesPanel } from "./ui/panels/scopes-panel";
import { buildMenus } from "./ui/menus";
import { useShortcuts } from "./ui/use-shortcuts";
import { activeSequence, sequenceDuration } from "./timeline/model/query";
import { framesToTimecode } from "./timeline/time/timecode";
import type { ToolId } from "./state/store";

const ACCENT = "var(--accent-motion)";

const TOOLS: Array<{ id: ToolId; name: string; icon: string; description?: string }> = [
  { id: "select", name: "Selection (V)", icon: "cursor", description: "Select, move, and trim clips in the timeline." },
  { id: "track-fwd", name: "Track Select Forward (A)", icon: "M3 8h8M8 5l3 3-3 3", description: "Select every clip from here to the end of the track." },
  { id: "ripple", name: "Ripple Edit (B)", icon: "M4 4v8M12 4v8M6 8h4", description: "Trim a clip and close the gap, shifting later clips along." },
  { id: "razor", name: "Razor (C)", icon: "cut", description: "Split a clip into two at the click point." },
  { id: "slip", name: "Slip (Y)", icon: "M3 8h10M5 6 3 8l2 2M11 6l2 2-2 2", description: "Shift a clip's in and out points without moving the clip." },
  { id: "slide", name: "Slide (U)", icon: "M3 5h10M3 11h10M6 8h4", description: "Move a clip between its neighbors, retiming them to fit." },
  { id: "pen", name: "Pen (P)", icon: "pen", description: "Add and adjust keyframes on a clip's rubber band." },
  { id: "hand", name: "Hand (H)", icon: "hand", description: "Pan the timeline." },
  { id: "zoom", name: "Zoom (Z)", icon: "zoom", description: "Zoom the timeline in and out." },
];

function TransportBar() {
  const playing = useStore((s) => s.playing);
  const playhead = useStore((s) => s.playhead);
  const project = useStore((s) => s.project);
  const quality = useStore((s) => s.previewQuality);
  const seq = activeSequence(project);
  const fps = seq?.fps ?? 24;
  const dur = seq ? sequenceDuration(seq) : 0;

  return (
    <OptionsBar>
      <OptionsBar.Group>
        <span className="monet-iconbtn" title="Previous edit" onClick={() => cmd.goPrevEdge()}>
          <Icon d={I.rewind} size={13} />
        </span>
        <span className="monet-iconbtn" title="Step back" onClick={() => cmd.stepFrame(-1)}>
          <Icon d="M11 4 6 8l5 4M3 4v8" size={13} />
        </span>
        <span className={"monet-iconbtn" + (playing ? " is-active" : "")} title="Play / Pause (Space)" onClick={() => cmd.togglePlay()}>
          <Icon d={playing ? "M4 3h3v10H4zM9 3h3v10H9z" : I.play} size={12} />
        </span>
        <span className="monet-iconbtn" title="Step forward" onClick={() => cmd.stepFrame(1)}>
          <Icon d="M5 4l5 4-5 4M13 4v8" size={13} />
        </span>
        <span className="monet-iconbtn" title="Next edit" onClick={() => cmd.goNextEdge()}>
          <Icon d="M3 4l5 4-5 4M8 4l5 4-5 4" size={13} />
        </span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: ACCENT }}>{framesToTimecode(playhead, fps)}</span>
        <span style={{ color: "var(--text-3)" }}>/</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)" }}>{framesToTimecode(dur, fps)}</span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span className="monet-chip is-active">{Math.round(fps)} fps</span>
        <span className="monet-chip">{seq ? `${seq.width} × ${seq.height}` : "—"}</span>
      </OptionsBar.Group>
      <div style={{ flex: 1 }} />
      <OptionsBar.Group>
        {(["full", "half", "quarter"] as const).map((q) => (
          <span key={q} className={"monet-chip" + (quality === q ? " is-active" : "")} style={{ cursor: "pointer" }} onClick={() => store.setPreviewQuality(q)}>
            {q === "full" ? "Full" : q === "half" ? "½" : "¼"}
          </span>
        ))}
        <span className="monet-chip" style={{ cursor: "pointer" }} onClick={() => cmd.markIn()}>Mark In</span>
        <span className="monet-chip" style={{ cursor: "pointer" }} onClick={() => cmd.markOut()}>Mark Out</span>
      </OptionsBar.Group>
    </OptionsBar>
  );
}

function StatusLine() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const dirty = useStore((s) => s.dirty);
  const tool = useStore((s) => s.tool);
  const seq = activeSequence(project);
  const fps = seq?.fps ?? 24;
  return (
    <StatusBar>
      <span style={{ color: ACCENT }}>● {project.name}{dirty ? "*" : ""}</span>
      <span className="monet-vsep" />
      <span>{framesToTimecode(playhead, fps)} / {framesToTimecode(seq ? sequenceDuration(seq) : 0, fps)}</span>
      <span className="monet-vsep" />
      <span>Tool · {tool}</span>
      <span className="grow" />
      <span>{seq ? `${seq.width}×${seq.height} · ${Math.round(fps)}fps` : ""}</span>
    </StatusBar>
  );
}

function CinemaApp({ platform = "mac" }: { platform?: Platform }) {
  const tool = useStore((s) => s.tool);
  const dirty = useStore((s) => s.dirty);
  const project = useStore((s) => s.project);
  const playing = useStore((s) => s.playing);
  useShortcuts();

  // Files dropped on the window: a `.monet` opens as the document, media lands
  // in the bin. ponytail: no hover overlay yet — wire `onOver` to a drop
  // highlight when Cinema grows one.
  useFileDrop({
    onPaths: (paths) => void openDroppedPaths(paths),
    onFiles: (files) => void openDroppedFiles(files),
  });

  // Transport: run the player while `playing`.
  useEffect(() => {
    playing ? player.start() : player.stop();
    return () => player.stop();
  }, [playing]);

  // File/menu intents are dispatched as DOM events by the menu bar.
  useEffect(() => {
    const onImport = () => void importMediaInteractive();
    const onOpen = () => void openProject();
    const onSave = () => void saveProject();
    const onExport = () => void exportFrame();
    const onExportEdl = () => void exportEdl();
    const onExportVideo = () => void exportVideoFile();
    document.addEventListener("cinema:import", onImport);
    document.addEventListener("cinema:open", onOpen);
    document.addEventListener("cinema:save", onSave);
    document.addEventListener("cinema:export", onExport);
    document.addEventListener("cinema:export-edl", onExportEdl);
    document.addEventListener("cinema:export-video", onExportVideo);
    return () => {
      document.removeEventListener("cinema:import", onImport);
      document.removeEventListener("cinema:open", onOpen);
      document.removeEventListener("cinema:save", onSave);
      document.removeEventListener("cinema:export", onExport);
      document.removeEventListener("cinema:export-edl", onExportEdl);
      document.removeEventListener("cinema:export-video", onExportVideo);
    };
  }, []);

  const panels = {
    project: { title: "Project", flush: true, render: () => <ProjectPanel /> },
    effects: { title: "Effects", render: () => <EffectsPanel /> },
    source: { title: "Source", flush: true, render: () => <SourceMonitor /> },
    effectControls: { title: "Effect Controls", render: () => <EffectControlsPanel /> },
    lumetri: { title: "Lumetri Color", render: () => <LumetriPanel /> },
    scopes: { title: "Scopes", render: () => <ScopesPanel /> },
    audio: { title: "Audio Mixer", render: () => <AudioMixerPanel /> },
    timeline: { title: "Timeline", flush: true, render: () => <TimelinePanel /> },
  };

  const initialLayout = {
    left: {
      size: 290,
      stack: [
        { tabs: ["project", "effects"], active: "project", flex: 1 },
        { tabs: ["source"], active: "source", flex: 1 },
      ],
    },
    right: {
      size: 300,
      stack: [
        { tabs: ["effectControls", "lumetri"], active: "effectControls", flex: 1.4 },
        { tabs: ["scopes", "audio"], active: "scopes", flex: 0.8 },
      ],
    },
    bottom: {
      size: 280,
      stack: [{ tabs: ["timeline"], active: "timeline", flex: 1 }],
    },
  };

  // macOS draws no in-window menu bar — menus live in the system bar — so

  // mirror them there, or every command without a keyboard shortcut or a

  // panel button is unreachable. No-op off mac / outside Tauri.

  const macMenus = buildMenus();

  useEffect(() => {

    void syncMacMenu(macMenus, platform, { appName: "Cinema" });

  }, [macMenus, platform]);


  return (
    <DockableWorkspace
      accent={ACCENT}
      app="CINEMA"
      platform={platform}
      docs={[project.name + (dirty ? "*" : "")]}
      activeDoc={project.name + (dirty ? "*" : "")}
      menus={buildMenus()}
      toolbarDefs={{
        tools: { render: (o) => <ToolRail tools={TOOLS} active={tool} orientation={o} inline onSelect={(id: string) => store.setTool(id as ToolId)} /> },
        options: { horizontalOnly: true, render: () => <TransportBar /> },
      }}
      initialToolbarLayout={{ left: ["tools"], top: ["options"] }}
      canvas={<Canvas><ProgramMonitor /></Canvas>}
      statusBar={<StatusLine />}
      panels={panels}
      initialLayout={initialLayout}
    />
  );
}

export function App() {
  const ctx = useMonetContext();
  return <CinemaApp platform={ctx?.platform ?? "mac"} />;
}
