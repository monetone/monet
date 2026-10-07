// Layers, channels & artboards gallery demos — the Photoshop / Figma stacks.
// One GalleryEntry + a small self-contained demo per component, each spawnable
// as a ~300×250 dockable panel. Sources: packages/monet-react/src/creative-layers.tsx
// and docs/components/creative-layers.md (exact prop names / defaults).
import { useState } from "react";
import {
  LayerRow,
  LayerList,
  VisibilityToggle,
  LockToggle,
  BlendModeSelect,
  OpacityControl,
  ChannelList,
  LayerTree,
  ArtboardList,
  type LayerData,
  type LayerNode,
  type ChannelData,
  type ArtboardData,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

// ─── shared mock data ──────────────────────────────────────────

const MOCK_LAYERS: LayerData[] = [
  { id: "dodge", name: "Highlight dodge", opacity: 78, blendMode: "screen", colorChip: "oklch(0.78 0.14 200)" },
  { id: "warm", name: "Curves · warm", opacity: 100, colorChip: "#d9a45b" },
  { id: "subject", name: "Subject", opacity: 100, blendMode: "normal" },
  { id: "glow", name: "Rim glow", opacity: 60, locked: true, colorChip: "#8a6cff" },
  { id: "bg", name: "Background", visible: false, opacity: 100 },
];

// ─── LayerRow ──────────────────────────────────────────────────

function LayerRowDemo() {
  const [visible, setVisible] = useState(true);
  const [locked, setLocked] = useState(false);
  const [selected, setSelected] = useState(true);
  return (
    <div style={{ padding: 4 }} role="listbox" aria-label="Layer row demo">
      <LayerRow
        name="Subject"
        opacity={80}
        blendMode="Multiply"
        colorChip="#d9a45b"
        visible={visible}
        locked={locked}
        selected={selected}
        tabIndex={0}
        onSelect={() => setSelected((s) => !s)}
        onVisibilityToggle={setVisible}
        onLockToggle={setLocked}
      />
    </div>
  );
}

// ─── LayerList ─────────────────────────────────────────────────

function LayerListDemo() {
  const [sel, setSel] = useState("dodge");
  const [layers, setLayers] = useState<LayerData[]>(MOCK_LAYERS);
  const patch = (id: string, next: Partial<LayerData>) =>
    setLayers((rows) => rows.map((l) => (l.id === id ? { ...l, ...next } : l)));
  return (
    <LayerList
      aria-label="Layers"
      layers={layers}
      selectedId={sel}
      onSelect={setSel}
      onVisibilityChange={(id, visible) => patch(id, { visible })}
      onLockChange={(id, locked) => patch(id, { locked })}
    />
  );
}

// ─── VisibilityToggle ──────────────────────────────────────────

function VisibilityToggleDemo() {
  const [visible, setVisible] = useState(true);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 8 }}>
      <VisibilityToggle checked={visible} onChange={setVisible} aria-label="Toggle layer" />
      <span style={{ font: "var(--monet-font-ui, inherit)", opacity: 0.8 }}>
        {visible ? "Visible" : "Hidden"}
      </span>
    </div>
  );
}

// ─── LockToggle ────────────────────────────────────────────────

function LockToggleDemo() {
  const [locked, setLocked] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 8 }}>
      <LockToggle on={locked} onChange={setLocked} aria-label="Lock layer" />
      <span style={{ font: "var(--monet-font-ui, inherit)", opacity: 0.8 }}>
        {locked ? "Locked" : "Unlocked"}
      </span>
    </div>
  );
}

// ─── BlendModeSelect ───────────────────────────────────────────

function BlendModeSelectDemo() {
  const [mode, setMode] = useState("multiply");
  return (
    <div style={{ display: "grid", gap: 8, padding: 8 }}>
      <BlendModeSelect aria-label="Blend mode" value={mode} onChange={setMode} />
      <span style={{ font: "var(--monet-font-mono, monospace)", opacity: 0.7, fontSize: 12 }}>
        value: {mode}
      </span>
    </div>
  );
}

// ─── OpacityControl ────────────────────────────────────────────

function OpacityControlDemo() {
  const [fill, setFill] = useState(78);
  const [stroke, setStroke] = useState(100);
  return (
    <div style={{ display: "grid", gap: 6, padding: 8 }}>
      <OpacityControl value={fill} onChange={setFill} />
      <OpacityControl label="Fill" value={stroke} onChange={setStroke} accent="#8a6cff" />
    </div>
  );
}

// ─── ChannelList ───────────────────────────────────────────────

const MOCK_CHANNELS: ChannelData[] = [
  { id: "rgb", name: "RGB", composite: true, shortcut: "⌘2" },
  { id: "r", name: "Red", shortcut: "⌘3" },
  { id: "g", name: "Green", shortcut: "⌘4" },
  { id: "b", name: "Blue", shortcut: "⌘5" },
  { id: "a", name: "Alpha", visible: false, shortcut: "⌘6" },
];
function ChannelListDemo() {
  const [sel, setSel] = useState("rgb");
  const [channels, setChannels] = useState<ChannelData[]>(MOCK_CHANNELS);
  return (
    <ChannelList
      aria-label="Channels"
      channels={channels}
      selectedId={sel}
      onSelect={setSel}
      onVisibilityChange={(id, visible) =>
        setChannels((rows) => rows.map((c) => (c.id === id ? { ...c, visible } : c)))
      }
    />
  );
}

// ─── LayerTree ─────────────────────────────────────────────────

const MOCK_TREE: LayerNode[] = [
  {
    id: "fx",
    name: "Color grade",
    expanded: true,
    colorChip: "#4aa6b0",
    children: [
      { id: "dodge", name: "Highlight dodge", opacity: 78, blendMode: "screen" },
      { id: "warm", name: "Curves · warm", opacity: 100 },
    ],
  },
  {
    id: "subj",
    name: "Subject",
    children: [
      { id: "hair", name: "Hair", opacity: 100 },
      { id: "skin", name: "Skin retouch", locked: true },
    ],
  },
  { id: "bg", name: "Background", visible: false },
];
function LayerTreeDemo() {
  const [sel, setSel] = useState("dodge");
  const [tree, setTree] = useState<LayerNode[]>(MOCK_TREE);
  const patch = (id: string, next: Partial<LayerNode>): LayerNode[] => {
    const walk = (nodes: LayerNode[]): LayerNode[] =>
      nodes.map((n) => ({
        ...n,
        ...(n.id === id ? next : null),
        ...(n.children ? { children: walk(n.children) } : null),
      }));
    return walk(tree);
  };
  return (
    <LayerTree
      aria-label="Layers"
      nodes={tree}
      selectedId={sel}
      onSelect={setSel}
      onVisibilityChange={(id, visible) => setTree(patch(id, { visible }))}
      onLockChange={(id, locked) => setTree(patch(id, { locked }))}
    />
  );
}

// ─── ArtboardList ──────────────────────────────────────────────

const MOCK_ARTBOARDS: ArtboardData[] = [
  { id: "home", name: "Home", size: "1440 × 1024" },
  { id: "settings", name: "Settings", size: "1440 × 1024" },
  { id: "profile", name: "Profile", size: "375 × 812" },
  { id: "onboard", name: "Onboarding", size: "375 × 812" },
];
function ArtboardListDemo() {
  const [sel, setSel] = useState("home");
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%" }}>
      <div style={{ padding: "6px 10px", fontSize: 12, opacity: 0.7 }}>
        {opened ? `Opened: ${opened}` : "Double-click to open"}
      </div>
      <ArtboardList
        aria-label="Artboards"
        artboards={MOCK_ARTBOARDS}
        selectedId={sel}
        onSelect={setSel}
        onActivate={setOpened}
      />
    </div>
  );
}

// ─── catalog ───────────────────────────────────────────────────

export const layersEntries: GalleryEntry[] = [
  { id: "layers/LayerRow", label: "LayerRow", category: "Layers", section: "Creative", render: () => <LayerRowDemo />, flush: true },
  { id: "layers/LayerList", label: "LayerList", category: "Layers", section: "Creative", render: () => <LayerListDemo />, flush: true },
  { id: "layers/VisibilityToggle", label: "VisibilityToggle", category: "Layers", section: "Creative", render: () => <VisibilityToggleDemo /> },
  { id: "layers/LockToggle", label: "LockToggle", category: "Layers", section: "Creative", render: () => <LockToggleDemo /> },
  { id: "layers/BlendModeSelect", label: "BlendModeSelect", category: "Layers", section: "Creative", render: () => <BlendModeSelectDemo /> },
  { id: "layers/OpacityControl", label: "OpacityControl", category: "Layers", section: "Creative", render: () => <OpacityControlDemo /> },
  { id: "layers/ChannelList", label: "ChannelList", category: "Layers", section: "Creative", render: () => <ChannelListDemo />, flush: true },
  { id: "layers/LayerTree", label: "LayerTree", category: "Layers", section: "Creative", render: () => <LayerTreeDemo />, flush: true },
  { id: "layers/ArtboardList", label: "ArtboardList", category: "Layers", section: "Creative", render: () => <ArtboardListDemo />, flush: true },
];
