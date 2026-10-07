import { useEffect, useState } from "react";
import {
  Canvas,
  DockableWorkspace,
  MenuBar,
  StatusBar,
  ToastProvider,
  useFileDrop,
  useMonetContext,
  useToast,
  type Platform,
} from "@monet-ui/monet-react";
import type { ArtisanStore } from "./engine";
import { fileCommands, setIoNotifier } from "./io/commands";
import { EditorProvider, useEditorState, useStore } from "./state/store-context";
import { CanvasView } from "./render/canvas-view";
import { TOOL_META } from "./tools/registry";
import { ArtisanToolRail } from "./ui/tool-rail";
import { buildMenus } from "./ui/menus";
import { ArtisanOptionsBar } from "./ui/options-bar";
import { useShortcuts } from "./ui/use-shortcuts";
import { LayersPanel } from "./ui/panels/layers-panel";
import { PropertiesPanel } from "./ui/panels/properties-panel";
import { SwatchesPanel } from "./ui/panels/swatches-panel";
import { AlignPanel } from "./ui/panels/align-panel";
import { PathfinderPanel } from "./ui/panels/pathfinder-panel";
import { ColorPanel } from "./ui/panels/color-panel";
import { ColorGuidePanel } from "./ui/panels/color-guide-panel";
import { GradientPanel } from "./ui/panels/gradient-panel";
import { StrokePanel } from "./ui/panels/stroke-panel";
import { AppearancePanel } from "./ui/panels/appearance-panel";
import { CharacterPanel } from "./ui/panels/character-panel";
import { ParagraphPanel } from "./ui/panels/paragraph-panel";
import { TypeStylesPanel } from "./ui/panels/type-styles-panel";
import { BrushesPanel } from "./ui/panels/brushes-panel";
import { GraphicStylesPanel } from "./ui/panels/graphic-styles-panel";
import { DocumentInfoPanel } from "./ui/panels/document-info-panel";
import { ActionsPanel } from "./ui/panels/actions-panel";
import { AttributesPanel } from "./ui/panels/attributes-panel";
import { LinksPanel } from "./ui/panels/links-panel";
import { SeparationsPanel } from "./ui/panels/separations-panel";
import { PrintPackagePanel } from "./ui/panels/print-package-panel";
import { ExportPanel } from "./ui/panels/export-panel";
import { SymbolsPanel } from "./ui/panels/symbols-panel";
import { ShortcutsPanel } from "./ui/panels/shortcuts-panel";
import { VariablesPanel } from "./ui/panels/variables-panel";
import { FindReplacePanel } from "./ui/panels/find-replace-panel";
import { GraphsPanel } from "./ui/panels/graphs-panel";
import { VectorscopePanel } from "./ui/panels/vectorscope-panel";
import { WaveformPanel } from "./ui/panels/waveform-panel";

const accent = "var(--accent-vector)";

function Shell({ platform }: { platform: Platform }) {
  const store = useStore();
  const state = useEditorState();
  const [, setClipboardVersion] = useState(0);
  useShortcuts(store);

  useEffect(() => {
    const refreshMenus = () => setClipboardVersion((version) => version + 1);
    globalThis.addEventListener("artisan-clipboard-change", refreshMenus);
    return () => globalThis.removeEventListener("artisan-clipboard-change", refreshMenus);
  }, []);

  // Route IO failures/warnings to toasts (io/commands falls back to the native
  // message dialog while no sink is installed, so nothing is ever console-only).
  const toast = useToast();
  useEffect(() => {
    setIoNotifier(toast.push);
    return () => setIoNotifier(null);
  }, [toast]);

  // OS drag-and-drop: one shared hook, both worlds (Tauri paths / browser Files).
  useFileDrop({
    onPaths: (paths) => void fileCommands.openPaths(store, paths),
    onFiles: (files) => void fileCommands.openFiles(store, files),
  });

  const menus = buildMenus(store, state);
  const ab = state.doc.artboards[state.doc.activeArtboard] ?? state.doc.artboards[0];
  const docLabel = `${state.doc.name}${state.dirty ? "*" : ""}`;

  const panels = {
    properties: { title: "Properties", render: () => <PropertiesPanel /> },
    align: { title: "Align", render: () => <AlignPanel /> },
    pathfinder: { title: "Pathfinder", render: () => <PathfinderPanel /> },
    appearance: { title: "Appearance", render: () => <AppearancePanel /> },
    character: { title: "Character", render: () => <CharacterPanel /> },
    paragraph: { title: "Paragraph", render: () => <ParagraphPanel /> },
    "type-styles": { title: "Type Styles", render: () => <TypeStylesPanel /> },
    stroke: { title: "Stroke", render: () => <StrokePanel /> },
    color: { title: "Color", render: () => <ColorPanel /> },
    "color-guide": { title: "Color Guide", render: () => <ColorGuidePanel /> },
    gradient: { title: "Gradient", render: () => <GradientPanel /> },
    swatches: { title: "Swatches", render: () => <SwatchesPanel /> },
    brushes: { title: "Brushes", render: () => <BrushesPanel /> },
    "graphic-styles": { title: "Graphic Styles", render: () => <GraphicStylesPanel /> },
    symbols: { title: "Symbols", render: () => <SymbolsPanel /> },
    graphs: { title: "Graphs", render: () => <GraphsPanel /> },
    actions: { title: "Actions", render: () => <ActionsPanel /> },
    attributes: { title: "Attributes", render: () => <AttributesPanel /> },
    vectorscope: { title: "Vectorscope", render: () => <VectorscopePanel /> },
    waveform: { title: "Waveform", render: () => <WaveformPanel /> },
    "document-info": { title: "Document Info", render: () => <DocumentInfoPanel /> },
    links: { title: "Links", render: () => <LinksPanel /> },
    separations: { title: "Separations Preview", render: () => <SeparationsPanel /> },
    "print-package": { title: "Print & Package", render: () => <PrintPackagePanel /> },
    "export-for-screens": { title: "Export", render: () => <ExportPanel /> },
    shortcuts: { title: "Shortcuts", render: () => <ShortcutsPanel /> },
    variables: { title: "Variables", render: () => <VariablesPanel /> },
    "find-replace": { title: "Find & Replace", render: () => <FindReplacePanel /> },
    layers: { title: "Layers", flush: true, render: () => <LayersPanel /> },
  };

  const initialLayout = {
    right: {
      size: 300,
      stack: [
        { tabs: ["properties", "character", "paragraph", "type-styles", "appearance", "stroke", "attributes", "align", "pathfinder", "actions", "variables", "find-replace", "shortcuts", "links", "separations", "print-package", "export-for-screens", "document-info"], active: "properties", flex: 1 },
        { tabs: ["color", "gradient", "swatches", "brushes", "graphic-styles", "symbols", "graphs", "color-guide", "vectorscope", "waveform"], active: "color", flex: 1 },
        { tabs: ["layers"], active: "layers", flex: 1.1 },
      ],
    },
  };

  const statusBar = (
    <StatusBar>
      <span>{Math.round(state.view.zoom * 100)}%</span>
      <span className="monet-vsep" />
      <span>
        {ab ? `${ab.name} · ${Math.round(ab.width)} × ${Math.round(ab.height)}` : "—"} · {state.doc.meta.colorMode}
      </span>
      <span className="monet-vsep" />
      <span style={{ color: accent }}>
        ● {state.selection.length ? `${state.selection.length} selected` : "Nothing selected"}
      </span>
      <span className="grow" />
      <span style={{ color: "var(--text-3)" }}>{TOOL_META.find((t) => t.id === state.tool)?.name ?? state.tool}</span>
    </StatusBar>
  );

  return (
    <DockableWorkspace
      accent={accent}
      app="ARTISAN"
      platform={platform}
      docs={[docLabel]}
      activeDoc={docLabel}
      menus={menus}
      toolbarDefs={{
        tools: { render: (o: "v" | "h") => <ArtisanToolRail orientation={o} /> },
        // Monet's chrome draws a menu bar only on Windows; on macOS it expects the
        // native global bar, which Artisan does not populate (its Tauri window uses
        // the default OS menu). Without this row every command with no keyboard
        // shortcut and no panel button is unreachable, so Artisan draws its own.
        // ponytail: an in-window bar, not the mac-native one Vision builds in
        // apps/vision/src/native/macMenu.ts — see docs/plans/12 for the lift.
        ...(platform === "win"
          ? {}
          : { menubar: { horizontalOnly: true, render: () => <MenuBar menus={menus} className="monet-menustrip" itemClassName="monet-menu" openClassName="is-open" /> } }),
        options: { horizontalOnly: true, render: () => <ArtisanOptionsBar /> },
      }}
      initialToolbarLayout={{ left: ["tools"], top: platform === "win" ? ["options"] : ["menubar", "options"] }}
      canvas={
        <Canvas>
          <CanvasView />
        </Canvas>
      }
      statusBar={statusBar}
      panels={panels}
      initialLayout={initialLayout}
    />
  );
}

export function App({ store }: { store?: ArtisanStore } = {}) {
  const { platform } = useMonetContext() ?? { platform: "mac" as const };
  return (
    <ToastProvider>
      <EditorProvider store={store}>
        <Shell platform={platform} />
      </EditorProvider>
    </ToastProvider>
  );
}
