// ─────────────────────────────────────────────────────────────
// App — composes the Monet dockable workspace around the DAW
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef } from "react";
import { DockableWorkspace, type DockableWorkspaceHandle, StatusBar, useFileDrop, useMonetContext, type Platform,
  syncMacMenu,
} from "@monet-ui/monet-react";
import { deleteProjectWorkspace, projectDuration, saveProjectWorkspace, setActiveWorkspace, setProjectEditorPreferences, type DisplayTimeFormat, type WorkspaceLayoutData } from "./engine";
import { EditorProvider, useEditorState, useStore } from "./state/store-context";
import { TimelineView } from "./render/timeline-view";
import { WaveformEditorView } from "./render/waveform-editor-view";
import { RythmeToolRail } from "./ui/tool-rail";
import { TransportBar } from "./ui/transport-bar";
import { buildMenus } from "./ui/menus";
import { openDroppedFiles } from "./ui/commands";
import { readFiles, readPaths, type PickedFile } from "./ui/io-web";
import { WORKSPACE_LAYOUT, WORKSPACE_TOOLBAR_LAYOUT, focusPanelInLayout, getWorkspaceLayout } from "./ui/workspace-layout";
import { useControlSurfaceBridge } from "./ui/use-control-surface";
import { useShortcuts } from "./ui/use-shortcuts";
import { formatTime } from "./ui/format";
import { TOOL_META } from "./tools/registry";
import {
  AnalyzePanel,
} from "./ui/analyze-panel";
import { EffectsPanel } from "./ui/effects-panel";
import {
  FilesPanel,
  GeneratePanel,
  HistoryPanel,
  MarkersPanel,
  MixerPanel,
  PropertiesPanel,
  VideoPanel,
} from "./ui/panels";

const accent = "var(--accent-audio)";

function Shell({ platform }: { platform: Platform }) {
  const store = useStore();
  const state = useEditorState();
  useShortcuts(store);
  useControlSurfaceBridge(store);

  // Drop audio or a .monet session anywhere on the window. Native drops arrive
  // as OS paths, browser drops as File objects; both become PickedFile[].
  const openDropped = useCallback(async (read: Promise<PickedFile[]>) => {
    try {
      await openDroppedFiles(store, await read);
    } catch (err) {
      console.error("drop failed", err);
    }
  }, [store]);
  useFileDrop({
    onPaths: (paths) => void openDropped(readPaths(paths)),
    onFiles: (files) => void openDropped(readFiles(files)),
  });

  // Memoized: the `?? []` fallback made a fresh array every render, which re-ran
  // the layout effect below and reset the dock on every render.
  const customWorkspaces = useMemo(
    () => state.project.editorPreferences?.customWorkspaces ?? [],
    [state.project.editorPreferences?.customWorkspaces],
  );
  const activeWorkspaceId = state.project.editorPreferences?.activeWorkspaceId ?? "default";

  // Bring a docked panel to the front (the Window menu), via the workspace handle.
  const workspaceRef = useRef<DockableWorkspaceHandle>(null);
  useEffect(() => {
    workspaceRef.current?.setLayout(getWorkspaceLayout(activeWorkspaceId, customWorkspaces));
  }, [activeWorkspaceId, customWorkspaces]);
  const focusPanel = useCallback((panelId: string) => {
    const handle = workspaceRef.current;
    if (handle) handle.setLayout(focusPanelInLayout(handle.getLayout(), panelId));
  }, []);
  // Switch to a named workspace preset / reset the dock (Window ▸ Workspace).
  const applyWorkspace = useCallback((id: string) => {
    workspaceRef.current?.setLayout(getWorkspaceLayout(id, customWorkspaces));
    store.dispatch(setActiveWorkspace(id), { history: false, dirty: true, label: "Workspace" });
  }, [customWorkspaces, store]);
  const saveWorkspace = useCallback(() => {
    const layout = workspaceRef.current?.getLayout();
    if (!layout) return;
    const customWorkspaces = store.getState().project.editorPreferences?.customWorkspaces ?? [];
    const fallback = `Custom Workspace ${customWorkspaces.length + 1}`;
    const name = typeof window !== "undefined" ? window.prompt("Workspace name", fallback) : fallback;
    if (!name?.trim()) return;
    store.dispatch(saveProjectWorkspace({ name, layout: layout as WorkspaceLayoutData }), { history: false, dirty: true, label: "Save workspace" });
  }, [store]);
  const deleteActiveWorkspace = useCallback(() => {
    const id = store.getState().project.editorPreferences?.activeWorkspaceId;
    if (!id) return;
    store.dispatch(deleteProjectWorkspace(id), { history: false, dirty: true, label: "Delete workspace" });
    workspaceRef.current?.setLayout(WORKSPACE_LAYOUT);
  }, [store]);
  const resetWorkspace = useCallback(() => {
    workspaceRef.current?.reset();
    store.dispatch(setActiveWorkspace("default"), { history: false, dirty: true, label: "Reset workspace" });
  }, [store]);
  const timeFormat = state.project.editorPreferences?.displayTimeFormat ?? "decimal";
  const fmtOpts = { sampleRate: state.project.sampleRate, tempo: state.project.tempo, timeSignature: state.project.timeSignature };

  const menus = buildMenus(store, state, {
    focusPanel,
    applyWorkspace,
    saveWorkspace,
    deleteActiveWorkspace,
    resetWorkspace,
    timeFormat,
    setTimeFormat: (id) => store.dispatch(setProjectEditorPreferences({ displayTimeFormat: id as DisplayTimeFormat }), { history: false, dirty: true, label: "Display time format" }),
  });
  const docLabel = `${state.project.name}${state.dirty ? "*" : ""}`;
  const toolName = TOOL_META.find((t) => t.id === state.tool)?.name ?? state.tool;
  const canvas = state.mode === "waveform" ? <WaveformEditorView timeFormat={timeFormat} /> : <TimelineView />;

  const panels = {
    properties: { title: "Properties", render: () => <PropertiesPanel /> },
    effects: { title: "Effects Rack", render: () => <EffectsPanel /> },
    generate: { title: "Generate", render: () => <GeneratePanel /> },
    analyze: { title: "Analyze", render: () => <AnalyzePanel /> },
    markers: { title: "Markers", render: () => <MarkersPanel /> },
    files: { title: "Files", render: () => <FilesPanel /> },
    video: { title: "Video", render: () => <VideoPanel /> },
    mixer: { title: "Mixer", flush: true, render: () => <MixerPanel /> },
    history: { title: "History", render: () => <HistoryPanel /> },
  };

  const statusBar = (
    <StatusBar>
      <span style={{ color: state.transport.recording ? "oklch(0.7 0.2 30)" : state.transport.playing ? "oklch(0.7 0.18 145)" : "var(--text-3)" }}>
        ● {state.transport.recording ? "REC" : state.transport.playing ? "PLAY" : "STOP"}
      </span>
      <span className="monet-vsep" />
      <span className="rh-time" style={{ fontFamily: "var(--font-mono)" }}>{formatTime(state.transport.playhead, timeFormat, fmtOpts)}</span>
      <span className="monet-vsep" />
      <span>{projectDuration(state.project).toFixed(2)}s · {state.project.tracks.length} audio · {state.project.videoTracks?.length ?? 0} video</span>
      <span className="monet-vsep" />
      <span style={{ color: accent }}>
        ● {state.selection.range ? `${(state.selection.range.end - state.selection.range.start).toFixed(2)}s selected` : state.selection.clipIds.length ? `${state.selection.clipIds.length} clip(s)` : "Nothing selected"}
      </span>
      <span className="grow" />
      <span style={{ color: "var(--text-3)" }}>{toolName}</span>
      <span className="monet-vsep" />
      <span style={{ color: "var(--text-3)" }}>{(state.project.sampleRate / 1000).toFixed(0)} kHz</span>
    </StatusBar>
  );

  // macOS draws no in-window menu bar — menus live in the system bar — so
  // mirror them there, or every command without a keyboard shortcut or a
  // panel button is unreachable. No-op off mac / outside Tauri.
  useEffect(() => {
    void syncMacMenu(menus, platform, { appName: "Rythme" });
  }, [menus, platform]);

  return (
    <DockableWorkspace
      ref={workspaceRef}
      accent={accent}
      app="RYTHME"
      platform={platform}
      docs={[docLabel]}
      activeDoc={docLabel}
      menus={menus}
      toolbarDefs={{
        tools: { render: (o: "v" | "h") => <RythmeToolRail orientation={o} /> },
        options: { horizontalOnly: true, render: () => <TransportBar timeFormat={timeFormat} /> },
      }}
      initialToolbarLayout={WORKSPACE_TOOLBAR_LAYOUT}
      canvas={canvas}
      statusBar={statusBar}
      panels={panels}
      initialLayout={WORKSPACE_LAYOUT}
    />
  );
}

export function App() {
  const { platform } = useMonetContext() ?? { platform: "mac" as const };
  return (
    <EditorProvider>
      <Shell platform={platform} />
    </EditorProvider>
  );
}
