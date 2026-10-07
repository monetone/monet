// ─────────────────────────────────────────────────────────────
// Monet gallery — Chrome primitives
// ─────────────────────────────────────────────────────────────
// One openable demo panel per standalone-renderable chrome primitive
// (rails, value widgets, bars, panels, and tab/menu strips).
// Each `render` returns a self-contained demo *component* (which may use
// hooks) — never a bare hook call, since a DockableWorkspace panel render()
// is an unmounted call site.
//
// Pure layout containers (Workspace, Dock, Body, PanelStack, Float, Titlebar)
// have no standalone visual on their own; the ones that read well in a tiny
// panel are shown via tiny composed examples (Panel below, plus the bars that
// already render their own chrome). Workspace/Titlebar/Dock/Body are omitted
// (they want a full window/canvas shell to render meaningfully).

import { useState } from "react";
import {
  ToolRail,
  Slider,
  Waveform,
  StatusBar,
  IconRail,
  OptionsBar,
  Panel,
  TabStrip,
  PanelBody,
  MenuStrip,
  Button,
  type ToolRailTool,
  type IconRailItem,
  type MenuBarEntry,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

const ACCENT = "#7c5cff";

// ─── ToolRail ──────────────────────────────────────────────────
const RAIL_TOOLS: Array<ToolRailTool | "div"> = [
  { id: "move", name: "Move", icon: "cursor" },
  { id: "brush", name: "Brush", icon: "brush", badge: true },
  { id: "erase", name: "Erase", icon: "erase" },
  "div",
  { id: "pen", name: "Pen", icon: "pen" },
  { id: "text", name: "Text", icon: "text" },
  { id: "shape", name: "Shape", icon: "shape" },
];

function ToolRailDemo() {
  const [active, setActive] = useState("brush");
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
      <ToolRail tools={RAIL_TOOLS} active={active} onSelect={setActive} />
    </div>
  );
}

// ─── Slider ────────────────────────────────────────────────────
function SliderDemo() {
  const [opacity, setOpacity] = useState(0.68);
  const [size, setSize] = useState(42);
  return (
    <div style={{ display: "grid", gap: 16, padding: 10 }}>
      <label style={{ display: "grid", gap: 6, fontSize: 11, opacity: 0.75 }}>
        Opacity · {Math.round(opacity * 100)}%
        <Slider value={opacity} accent={ACCENT} aria-label="Opacity" onChange={setOpacity} />
      </label>
      <label style={{ display: "grid", gap: 6, fontSize: 11, opacity: 0.75 }}>
        Brush size · {size}px
        <Slider
          value={size}
          min={1}
          max={120}
          step={1}
          accent={ACCENT}
          aria-label="Brush size"
          onChange={setSize}
        />
      </label>
    </div>
  );
}

// ─── Waveform (pure display) ───────────────────────────────────
function WaveformDemo() {
  return (
    <div style={{ display: "grid", gap: 12, padding: 10, justifyItems: "center" }}>
      <Waveform width={260} height={56} seed={7} accent={ACCENT} />
      <Waveform width={260} height={40} seed={42} accent={ACCENT} />
    </div>
  );
}

// ─── StatusBar ─────────────────────────────────────────────────
function StatusBarDemo() {
  const [zoom, setZoom] = useState(1);
  return (
    <div style={{ display: "grid", gap: 12, padding: 4 }}>
      <StatusBar>
        <span>Zoom {Math.round(zoom * 100)}%</span>
        <span style={{ flex: 1 }} />
        <span>X 1024 · Y 768</span>
        <span style={{ opacity: 0.6 }}>RGB / 8</span>
      </StatusBar>
      <div style={{ padding: "0 6px" }}>
        <Slider value={zoom} min={0.25} max={4} step={0.25} accent={ACCENT} aria-label="Zoom" onChange={setZoom} />
      </div>
    </div>
  );
}

// ─── IconRail ──────────────────────────────────────────────────
function IconRailDemo() {
  const [open, setOpen] = useState("info");
  const items: IconRailItem[] = [
    { id: "info", name: "Info", icon: "search", active: open === "info" },
    { id: "history", name: "History", icon: "loop", active: open === "history" },
    { id: "pin", name: "Pinned", icon: "pin", active: open === "pin" },
    { id: "crop", name: "Crop", icon: "crop", active: open === "crop" },
  ];
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
      <IconRail items={items} side="right" onClick={(id) => setOpen(id)} />
    </div>
  );
}

// ─── OptionsBar ────────────────────────────────────────────────
function OptionsBarDemo() {
  const [flow, setFlow] = useState(0.8);
  return (
    <div style={{ padding: 6 }}>
      <OptionsBar>
        <OptionsBar.Group>
          <Button variant="ghost">Brush</Button>
          <Button variant="ghost">Smooth</Button>
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ fontSize: 11, opacity: 0.7, display: "inline-flex", alignItems: "center", gap: 8 }}>
            Flow
            <span style={{ width: 90, display: "inline-block" }}>
              <Slider value={flow} accent={ACCENT} aria-label="Flow" onChange={setFlow} />
            </span>
          </span>
        </OptionsBar.Group>
      </OptionsBar>
    </div>
  );
}

// ─── Panel (composed: TabStrip + PanelBody inside a Panel) ─────
function PanelDemo() {
  const [tab, setTab] = useState("Layers");
  return (
    <Panel>
      <TabStrip tabs={["Layers", "Channels", "Paths"]} active={tab} onSelect={setTab} />
      <PanelBody>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          <strong>{tab}</strong> panel body. A <code>Panel</code> stacks a{" "}
          <code>TabStrip</code> over a scrollable <code>PanelBody</code>.
        </div>
      </PanelBody>
    </Panel>
  );
}

// ─── TabStrip (controlled, closable + addable) ─────────────────
function TabStripDemo() {
  const [tabs, setTabs] = useState(["Layers", "Channels", "Paths"]);
  const [active, setActive] = useState("Layers");
  const close = (t: string) => {
    setTabs((prev) => {
      const next = prev.filter((x) => x !== t);
      if (t === active && next.length) setActive(next[0]);
      return next;
    });
  };
  const add = () => {
    const name = `Tab ${tabs.length + 1}`;
    setTabs((prev) => [...prev, name]);
    setActive(name);
  };
  return (
    <div style={{ padding: 4 }}>
      <TabStrip tabs={tabs} active={active} onSelect={setActive} onClose={close} onAdd={add} />
      <div style={{ padding: 10, fontSize: 12, opacity: 0.75 }}>Active: {active || "—"}</div>
    </div>
  );
}

// ─── MenuStrip ─────────────────────────────────────────────────
const MENUS: MenuBarEntry[] = [
  {
    id: "file",
    label: "File",
    items: [
      { id: "new", label: "New", shortcut: "⌘N" },
      { id: "open", label: "Open…", shortcut: "⌘O" },
      { id: "sep1", separator: true },
      { id: "save", label: "Save", shortcut: "⌘S" },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    items: [
      { id: "undo", label: "Undo", shortcut: "⌘Z" },
      { id: "redo", label: "Redo", shortcut: "⇧⌘Z" },
    ],
  },
  { id: "view", label: "View", items: [{ id: "zoomin", label: "Zoom In", shortcut: "⌘+" }] },
  { id: "help", label: "Help", items: [{ id: "about", label: "About" }] },
];

function MenuStripDemo() {
  return (
    <div style={{ padding: 4 }}>
      <MenuStrip platform="win" menus={MENUS} />
      <div style={{ padding: 10, fontSize: 11, opacity: 0.65 }}>
        In-window menu bar (Windows chrome). Click a label to open its dropdown.
      </div>
    </div>
  );
}

export const chromeEntries: GalleryEntry[] = [
  { id: "chrome/ToolRail", label: "ToolRail", category: "Chrome primitives", section: "Components", render: () => <ToolRailDemo /> },
  { id: "chrome/Slider", label: "Slider", category: "Chrome primitives", section: "Components", render: () => <SliderDemo /> },
  { id: "chrome/Waveform", label: "Waveform", category: "Chrome primitives", section: "Components", render: () => <WaveformDemo /> },
  { id: "chrome/StatusBar", label: "StatusBar", category: "Chrome primitives", section: "Components", render: () => <StatusBarDemo /> },
  { id: "chrome/IconRail", label: "IconRail", category: "Chrome primitives", section: "Components", render: () => <IconRailDemo /> },
  { id: "chrome/OptionsBar", label: "OptionsBar", category: "Chrome primitives", section: "Components", render: () => <OptionsBarDemo /> },
  { id: "chrome/Panel", label: "Panel", category: "Chrome primitives", section: "Components", render: () => <PanelDemo />, flush: true },
  { id: "chrome/TabStrip", label: "TabStrip", category: "Chrome primitives", section: "Components", render: () => <TabStripDemo />, flush: true },
  { id: "chrome/MenuStrip", label: "MenuStrip", category: "Chrome primitives", section: "Components", render: () => <MenuStripDemo />, flush: true },
];
