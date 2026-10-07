import { useState } from "react";
import {
  DockableWorkspace,
  Canvas,
  StatusBar,
  Slider,
  Icon,
  I,
  useMonetContext,
  openFile,
  saveFile,
} from "@monet-ui/monet-react";

// A minimal Monet desktop app: a DockableWorkspace with a native-style menu
// bar, a canvas, and two dockable panels (Inspector + Layers). Everything is
// drawn inside the transparent native-material Tauri window created by the
// monet-ui Rust crate (see src-tauri/src/main.rs).

const accent = "var(--accent-__APP_ACCENT__)";

// File ▸ Open… — native OS open dialog via Monet's `openFile` wrapper. Outside
// a Tauri window (plain `vite dev`) this resolves to null and is a no-op.
async function demoOpen() {
  const path = await openFile({ multiple: false });
  if (path) console.log(`[__APP_PRODUCT_NAME__] Opened: ${path}`);
}

// File ▸ Save… — native OS save dialog via Monet's `saveFile` wrapper.
async function demoSave() {
  const path = await saveFile({ defaultPath: "untitled.txt" });
  if (path) console.log(`[__APP_PRODUCT_NAME__] Saving to: ${path}`);
}

// Functional menu bar wired to the chrome. File ▸ Open…/Save… call the native
// OS dialogs (registered in src-tauri via `monet_ui::dialog_plugin()`); other
// actions are logged. Replace them with your own commands.
function appMenus(run: (label: string) => void) {
  return [
    { id: "file", label: "File", items: [
      { id: "new",  label: "New…",  shortcut: "⌘N", action: () => run("File · New") },
      { id: "open", label: "Open…", shortcut: "⌘O", action: () => void demoOpen() },
      { id: "sep1", separator: true },
      { id: "save", label: "Save",  shortcut: "⌘S", action: () => void demoSave() },
    ]},
    { id: "edit", label: "Edit", items: [
      { id: "undo", label: "Undo", shortcut: "⌘Z", action: () => run("Edit · Undo") },
      { id: "redo", label: "Redo", shortcut: "⇧⌘Z", action: () => run("Edit · Redo") },
    ]},
    { id: "view", label: "View", items: [
      { id: "grid", label: "Show Grid", checked: true, action: () => run("View · Toggle Grid") },
    ]},
  ];
}

export function App() {
  const { platform } = useMonetContext() ?? { platform: "mac" as const };
  const [zoom, setZoom] = useState(0.5);
  const menus = appMenus((label) => console.log(`[menu] ${label}`));

  const panels = {
    inspector: { title: "Inspector", render: () => (
      <div>
        <div className="monet-section-label">Transform</div>
        <div className="monet-row"><span className="lbl">X</span><span className="val">0 px</span></div>
        <div className="monet-row"><span className="lbl">Y</span><span className="val">0 px</span></div>
        <div className="monet-row" style={{ marginTop: 8 }}>
          <span className="lbl">Zoom</span>
          <Slider value={zoom} accent={accent} onChange={setZoom} />
          <span className="val">{Math.round(zoom * 200)}%</span>
        </div>
      </div>
    )},
    layers: { title: "Layers", render: () => (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {["Background", "Content", "Overlay"].map((name, i) => (
          <div key={name} className={`monet-layer ${i === 1 ? "is-selected" : ""}`}>
            <span className="vis"><Icon d={I.eye} size={12} /></span>
            <span className="name">{name}</span>
          </div>
        ))}
      </div>
    )},
  };

  const initialLayout = {
    right: {
      size: 280,
      cols: [
        { flex: 1, stack: [
          { tabs: ["inspector"], active: "inspector", flex: 1 },
          { tabs: ["layers"], active: "layers", flex: 1 },
        ]},
      ],
    },
  };

  const canvas = (
    <Canvas>
      <div style={{
        width: 520, height: 360, borderRadius: 4,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: accent, fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.1em",
        textTransform: "uppercase",
        backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 12px, rgba(255,255,255,0.02) 12px 24px)",
        boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.5)",
      }}>__APP_PRODUCT_NAME__</div>
    </Canvas>
  );

  const statusBar = (
    <StatusBar>
      <span>{Math.round(zoom * 200)}%</span>
      <span className="monet-vsep" />
      <span style={{ color: accent }}>● Ready</span>
      <span className="grow" />
      <span>__APP_PRODUCT_NAME__</span>
    </StatusBar>
  );

  return (
    <DockableWorkspace
      accent={accent}
      app="__APP_ACCENT__"
      platform={platform}
      docs={["untitled"]}
      activeDoc="untitled"
      menus={menus}
      canvas={canvas}
      statusBar={statusBar}
      panels={panels}
      initialLayout={initialLayout}
    />
  );
}
