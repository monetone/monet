// ─────────────────────────────────────────────────────────────
// Monet Jouer — the application shell. Composes the Monet dockable workspace
// (tool rail, options bar, wired panels, menus, status bar) around the live
// Phaser editor canvas, all driven by the store.
// ─────────────────────────────────────────────────────────────

import { useEffect } from "react";
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
  type ToolRailTool,
  syncMacMenu,
} from "@monet-ui/monet-react";
import { store, useStore } from "./state/app";
import * as cmd from "./commands";
import type { ToolId } from "./state/store";
import { createProject } from "./model/factory";
import { activeScene } from "./model/query";
import { PhaserStage, fitView, frameSelection } from "./phaser/PhaserStage";
import { buildMenus } from "./ui/menus";
import { useShortcuts } from "./ui/use-shortcuts";
import { exportHtml, exportJs, importDroppedImages, openProject, saveProject } from "./io/files";
import { ScenePanel } from "./ui/panels/scene-panel";
import { InspectorPanel } from "./ui/panels/inspector-panel";
import { AssetsPanel } from "./ui/panels/assets-panel";
import { AnimationPanel } from "./ui/panels/animation-panel";
import { TransitionsPanel } from "./ui/panels/transitions-panel";
import { CodePanel } from "./ui/panels/code-panel";
import { EnginesPanel } from "./ui/panels/engines-panel";

const ACCENT = "var(--accent-game)";

const RECT = "M3 4h10v8H3z";
const ELLIPSE = "M8 3.5c2.8 0 4.8 2 4.8 4.5S10.8 12.5 8 12.5 3.2 10.5 3.2 8 5.2 3.5 8 3.5z";
const STEP_BACK = "M3 3h2v10H3z M13 3L13 13L6 8Z";
const STEP_FWD = "M3 3L3 13L10 8Z M11 3h2v10h-2z";

const TOOLS: Array<ToolRailTool | "div"> = [
  { id: "select", name: "Select / Move (V)", icon: "cursor", description: "Select, move, and resize objects in the scene." },
  { id: "hand", name: "Pan (H)", icon: "hand", description: "Pan around the scene." },
  "div",
  { id: "rectangle", name: "Rectangle (R)", icon: RECT, description: "Draw rectangle shapes." },
  { id: "ellipse", name: "Ellipse (E)", icon: ELLIPSE, description: "Draw ellipse and circle shapes." },
  { id: "text", name: "Text (T)", icon: "text", description: "Add and edit text objects." },
  { id: "sprite", name: "Sprite", icon: "crop", description: "Place an image sprite into the scene." },
];

function TopBar() {
  const playing = useStore((s) => s.playing);
  const zoom = useStore((s) => s.zoom);
  const showGrid = useStore((s) => s.showGrid);
  const snap = useStore((s) => s.snap);
  const hasSelection = useStore((s) => s.selection.length > 0);

  return (
    <OptionsBar>
      <OptionsBar.Group>
        <span className="monet-iconbtn" title="Go to start" onClick={() => store.setPlayhead(0)}><Icon d={I.rewind} size={13} /></span>
        <span className="monet-iconbtn" title="Step back (,)" onClick={() => cmd.stepFrame(-1)}><Icon d={STEP_BACK} size={12} /></span>
        <span className={"monet-iconbtn" + (playing ? " is-active" : "")} title="Play / Pause (Space)" onClick={() => store.togglePlaying()}>
          <Icon d={playing ? I.pause : I.play} size={12} />
        </span>
        <span className="monet-iconbtn" title="Step forward (.)" onClick={() => cmd.stepFrame(1)}><Icon d={STEP_FWD} size={12} /></span>
        <span className="monet-iconbtn" title="Stop" onClick={() => { store.setPlaying(false); store.setPlayhead(0); }}><Icon d={I.stop} size={12} /></span>
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span className={"monet-chip" + (showGrid ? " is-active" : "")} style={{ cursor: "pointer" }} onClick={() => store.setShowGrid(!showGrid)}>Grid</span>
        <span className={"monet-chip" + (snap ? " is-active" : "")} style={{ cursor: "pointer" }} onClick={() => store.setSnap(!snap)}>Snap</span>
      </OptionsBar.Group>
      <div style={{ flex: 1 }} />
      <OptionsBar.Group>
        <span className="monet-iconbtn" title="Zoom out" onClick={() => store.setZoom(zoom / 1.25)}><Icon d={I.minus} size={13} /></span>
        <span className="monet-chip" style={{ minWidth: 44, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <span className="monet-iconbtn" title="Zoom in" onClick={() => store.setZoom(zoom * 1.25)}><Icon d={I.plus} size={13} /></span>
        <span
          className="monet-chip"
          style={{ cursor: hasSelection ? "pointer" : "default", opacity: hasSelection ? 1 : 0.5 }}
          title="Frame selected (F)"
          onClick={() => hasSelection && frameSelection()}
        >
          Frame
        </span>
        <span className="monet-chip" style={{ cursor: "pointer" }} title="Fit to window (Shift+F)" onClick={() => fitView()}>Fit</span>
      </OptionsBar.Group>
    </OptionsBar>
  );
}

function StatusLine() {
  const project = useStore((s) => s.project);
  const dirty = useStore((s) => s.dirty);
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const playhead = useStore((s) => s.playhead);
  const scene = activeScene(project);
  return (
    <StatusBar>
      <span style={{ color: ACCENT }}>● {project.name}{dirty ? "*" : ""}</span>
      <span className="monet-vsep" />
      <span>{scene?.name ?? "—"}</span>
      <span className="monet-vsep" />
      <span>{playhead.toFixed(2)}s</span>
      <span className="monet-vsep" />
      <span>Tool · {tool}</span>
      <span className="grow" />
      <span>{selection.length} selected</span>
      <span className="monet-vsep" />
      <span>{scene ? `${scene.width}×${scene.height}` : ""} · {project.fps}fps</span>
    </StatusBar>
  );
}

function JouerApp({ platform = "mac" }: { platform?: Platform }) {
  const tool = useStore((s) => s.tool);
  const dirty = useStore((s) => s.dirty);
  const project = useStore((s) => s.project);
  // buildMenus() (below) derives menu item enabled-state and the Save/Load
  // Selection labels from the live selection + selection sets; subscribe so the
  // menu bar re-derives when they change. Neither updates during playback, so
  // this adds no per-frame render cost.
  useStore((s) => s.selection);
  useStore((s) => s.selectionSets);
  useStore((s) => s.gridSize); // View ▸ Grid Size checked-state re-derive
  useStore((s) => s.rotationSnap); // View ▸ Rotation Snap checked-state re-derive
  useStore((s) => s.scaleSnap); // View ▸ Scale Snap checked-state re-derive
  useShortcuts();

  // Sprites dropped from Finder (or from another Monet app) land in the asset
  // library. Native drops hand back paths, the vite dev server hands back Files.
  useFileDrop({
    onPaths: (paths) => void importDroppedImages(paths),
    onFiles: (files) => void importDroppedImages(files),
  });

  useEffect(() => {
    const onNew = () => {
      if (store.state.dirty && !confirm("Discard unsaved changes and start a new project?")) return;
      store.replaceProject(createProject("Untitled"));
    };
    const onOpen = () => void openProject();
    const onSave = () => void saveProject();
    const onHtml = () => void exportHtml();
    const onJs = () => void exportJs();
    document.addEventListener("jouer:new", onNew);
    document.addEventListener("jouer:open", onOpen);
    document.addEventListener("jouer:save", onSave);
    document.addEventListener("jouer:export-html", onHtml);
    document.addEventListener("jouer:export-js", onJs);
    return () => {
      document.removeEventListener("jouer:new", onNew);
      document.removeEventListener("jouer:open", onOpen);
      document.removeEventListener("jouer:save", onSave);
      document.removeEventListener("jouer:export-html", onHtml);
      document.removeEventListener("jouer:export-js", onJs);
    };
  }, []);

  const doc = project.name + (dirty ? "*" : "");

  const panels = {
    scene: { title: "Scene", flush: true, render: () => <ScenePanel /> },
    inspector: { title: "Inspector", render: () => <InspectorPanel /> },
    assets: { title: "Assets", render: () => <AssetsPanel /> },
    transitions: { title: "Transitions", render: () => <TransitionsPanel /> },
    animation: { title: "Animation", flush: true, render: () => <AnimationPanel /> },
    code: { title: "Phaser Code", flush: true, render: () => <CodePanel /> },
    engines: { title: "Engines", flush: true, render: () => <EnginesPanel /> },
  };

  const initialLayout = {
    left: {
      size: 268,
      stack: [
        { tabs: ["scene"], active: "scene", flex: 1.3 },
        { tabs: ["assets"], active: "assets", flex: 1 },
      ],
    },
    right: {
      size: 296,
      stack: [
        { tabs: ["inspector", "transitions"], active: "inspector", flex: 1.5 },
        { tabs: ["code", "engines"], active: "engines", flex: 1 },
      ],
    },
    bottom: {
      size: 236,
      stack: [{ tabs: ["animation"], active: "animation", flex: 1 }],
    },
  };

  // macOS draws no in-window menu bar — menus live in the system bar — so

  // mirror them there, or every command without a keyboard shortcut or a

  // panel button is unreachable. No-op off mac / outside Tauri.

  const macMenus = buildMenus();

  useEffect(() => {

    void syncMacMenu(macMenus, platform, { appName: "Jouer" });

  }, [macMenus, platform]);


  return (
    <DockableWorkspace
      accent={ACCENT}
      app="JOUER"
      platform={platform}
      docs={[doc]}
      activeDoc={doc}
      menus={buildMenus()}
      toolbarDefs={{
        tools: { render: (o) => <ToolRail tools={TOOLS} active={tool} orientation={o} inline onSelect={(id) => store.setTool(id as ToolId)} /> },
        options: { horizontalOnly: true, render: () => <TopBar /> },
      }}
      initialToolbarLayout={{ left: ["tools"], top: ["options"] }}
      canvas={<Canvas><PhaserStage /></Canvas>}
      statusBar={<StatusLine />}
      panels={panels}
      initialLayout={initialLayout}
    />
  );
}

export function App() {
  const ctx = useMonetContext();
  return <JouerApp platform={ctx?.platform ?? "mac"} />;
}
