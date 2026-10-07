// App — the Monet Anime workspace: a DockableWorkspace hosting the composition
// viewport, the layers / properties inspectors, and the timeline, plus the menu
// bar and transport. Drives the playback loop off the store's `playing` flag.

import { useEffect, useMemo, useState } from "react";
import {
  Canvas,
  DockableWorkspace,
  OptionsBar,
  StatusBar,
  ToolRail,
  useFileDrop,
  useMonetContext,
  syncMacMenu,
} from "@monet-ui/monet-react";
import { addLayer, deleteSelected, keyAllTransform } from "./commands";
import { importImages, openDroppedFiles, openDroppedPaths, openProject, saveProject, saveProjectAs } from "./io/files";
import { createProject } from "./model/factory";
import { activeComp } from "./model/query";
import { player } from "./playback/player";
import { Viewport } from "./render/viewport";
import { store, useEditor } from "./state/store";
import { LayersPanel } from "./ui/panels/layers-panel";
import { PropertiesPanel } from "./ui/panels/properties-panel";
import { TimelinePanel } from "./ui/panels/timeline-panel";
import { useShortcuts } from "./ui/use-shortcuts";

const ACCENT = "var(--accent-motion)";

export function App() {
  const ctx = useMonetContext();
  const platform = ctx?.platform ?? "mac";
  const state = useEditor();
  const comp = activeComp(state.project);
  useShortcuts();

  // Drop a `.monet` to open it, or images to place them as layers.
  const [dropping, setDropping] = useState(false);
  useFileDrop({
    onOver: setDropping,
    onPaths: (paths) => void openDroppedPaths(paths),
    onFiles: (files) => void openDroppedFiles(files),
  });

  // Playback loop follows the transport flag.
  useEffect(() => {
    if (state.playing) player.start();
    else player.stop();
    return () => player.stop();
  }, [state.playing]);

  const selId = state.selection.length === 1 ? state.selection[0] : null;
  const docLabel = `${state.project.name}${state.dirty ? " *" : ""}`;

  // Memoized: it is a `useEffect` dependency below, and a fresh array each
  // render would rebuild the macOS menu bar on every render.
  const menus = useMemo(() => [
    {
      id: "file",
      label: "File",
      items: [
        { id: "new", label: "New Project", shortcut: "⌘N", action: () => store.replaceProject(createProject("Untitled"), { markClean: true }) },
        { id: "open", label: "Open…", shortcut: "⌘O", action: () => void openProject() },
        { id: "sep1", separator: true },
        { id: "save", label: "Save", shortcut: "⌘S", action: () => void saveProject() },
        { id: "saveAs", label: "Save As…", shortcut: "⇧⌘S", action: () => void saveProjectAs() },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { id: "undo", label: "Undo", shortcut: "⌘Z", action: () => store.undo() },
        { id: "redo", label: "Redo", shortcut: "⇧⌘Z", action: () => store.redo() },
        { id: "sep1", separator: true },
        { id: "del", label: "Delete Layer", shortcut: "⌦", action: () => deleteSelected() },
      ],
    },
    {
      id: "layer",
      label: "Layer",
      items: [
        { id: "solid", label: "New Solid", action: () => addLayer("solid") },
        { id: "text", label: "New Text", action: () => addLayer("text") },
        { id: "shape", label: "New Shape", action: () => addLayer("shape") },
        { id: "null", label: "New Null", action: () => addLayer("null") },
        { id: "image", label: "Import Image…", action: () => void importImages() },
        { id: "sep1", separator: true },
        { id: "key", label: "Key Transform", shortcut: "K", action: () => selId && keyAllTransform(selId) },
      ],
    },
  ], [selId]);

  const panels = {
    layers: { title: "Layers", flush: true, render: () => <LayersPanel /> },
    properties: { title: "Effect Controls", render: () => <PropertiesPanel /> },
    timeline: { title: `Timeline · ${comp.name}`, flush: true, render: () => <TimelinePanel /> },
  };

  const initialLayout = {
    left: { size: 260, stack: [{ tabs: ["layers"], active: "layers", flex: 1 }] },
    right: { size: 300, stack: [{ tabs: ["properties"], active: "properties", flex: 1 }] },
    bottom: { size: 280, stack: [{ tabs: ["timeline"], active: "timeline", flex: 1 }] },
  };

  const toolbarDefs = {
    tools: {
      render: (orientation: "h" | "v") => (
        <ToolRail
          inline
          orientation={orientation}
          tools={[
            { id: "sel", name: "Selection", icon: "cursor", description: "Select and transform layers in the composition." },
            { id: "hand", name: "Hand", icon: "hand", description: "Pan around the composition viewport." },
            { id: "zoom", name: "Zoom", icon: "zoom", description: "Zoom the viewport in and out." },
          ]}
          active="sel"
        />
      ),
    },
    options: {
      horizontalOnly: true,
      render: () => (
        <OptionsBar>
          <span style={{ fontSize: 11, color: "var(--text-2)" }}>{comp.name}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>
            {comp.width}×{comp.height} · {comp.fps}fps · {comp.duration}s
          </span>
        </OptionsBar>
      ),
    },
  };

  // macOS draws no in-window menu bar — menus live in the system bar — so
  // mirror them there, or every command without a keyboard shortcut or a
  // panel button is unreachable. No-op off mac / outside Tauri.
  useEffect(() => {
    void syncMacMenu(menus, platform, { appName: "Anime" });
  }, [menus, platform]);

  return (
    <DockableWorkspace
      accent={ACCENT}
      app="ANIME"
      platform={platform}
      docs={[docLabel]}
      activeDoc={docLabel}
      menus={menus}
      toolbarDefs={toolbarDefs}
      initialToolbarLayout={{ left: ["tools"], top: ["options"] }}
      canvas={
        <Canvas>
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              outline: dropping ? `2px dashed ${ACCENT}` : undefined,
              outlineOffset: -4,
            }}
          >
            <Viewport />
          </div>
        </Canvas>
      }
      statusBar={
        <StatusBar>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {comp.layers.length} layers · {state.selection.length} selected
          </span>
        </StatusBar>
      }
      panels={panels}
      initialLayout={initialLayout}
    />
  );
}
