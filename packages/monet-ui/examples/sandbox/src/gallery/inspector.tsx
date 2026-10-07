// ─────────────────────────────────────────────────────────────
// Gallery · Inspector & layout demos
// ─────────────────────────────────────────────────────────────
// One openable demo panel per inspector / layout component, built from the real
// @monet-ui/monet-react exports (props verified against
// packages/monet-react/src/creative-inspector.tsx + creative-tree.tsx). Every
// interactive (controlled) component is wrapped in a tiny demo with useState so
// it actually responds; hooks live in the demo components, never in `render()`.
import { useState } from "react";
import {
  Section,
  SegmentedControl,
  ToggleGroup,
  ToolbarGroup,
  ToolbarSeparator,
  Breadcrumb,
  TreeView,
  SearchField,
  Badge,
  ProgressBar,
  Spinner,
  IconButton,
  Button,
  type TreeNode,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

// A compact padded shell for the non-flush demos (panels are ~300×250).
function Pad({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 10, padding: 4 }}>{children}</div>;
}

// ─── Section ───────────────────────────────────────────────────
function SectionDemo() {
  const [open, setOpen] = useState(true);
  const [open2, setOpen2] = useState(false);
  return (
    <Pad>
      <Section
        title="Transform"
        open={open}
        onOpenChange={setOpen}
        badge={<Badge size="sm">3</Badge>}
        actions={<IconButton icon="more" aria-label="Section options" size="sm" />}
      >
        <div style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.85 }}>
          <span>X 240 · Y 128</span>
          <span>W 512 · H 512</span>
          <span>Rotation 0°</span>
        </div>
      </Section>
      <Section title="Effects" open={open2} onOpenChange={setOpen2}>
        <div style={{ fontSize: 12, opacity: 0.85 }}>Drop shadow · Inner glow</div>
      </Section>
      <Section title="Metadata" collapsible={false}>
        <div style={{ fontSize: 12, opacity: 0.85 }}>Always-open (inert header)</div>
      </Section>
    </Pad>
  );
}

// ─── SegmentedControl ──────────────────────────────────────────
function SegmentedControlDemo() {
  const [mode, setMode] = useState("design");
  const [view, setView] = useState("fit");
  return (
    <Pad>
      <SegmentedControl
        aria-label="Editor mode"
        items={[
          { value: "design", label: "Design", dot: true },
          { value: "develop", label: "Develop" },
          { value: "test", label: "Test" },
        ]}
        value={mode}
        onChange={setMode}
      />
      <SegmentedControl
        aria-label="Zoom"
        block
        size="md"
        items={[
          { value: "fit", label: "Fit" },
          { value: "fill", label: "Fill" },
          { value: "100", label: "100%" },
        ]}
        value={view}
        onChange={setView}
      />
      <div style={{ fontSize: 11, opacity: 0.6 }}>mode: {mode} · view: {view}</div>
    </Pad>
  );
}

// ─── ToggleGroup ───────────────────────────────────────────────
function ToggleGroupDemo() {
  const [format, setFormat] = useState<string[]>(["bold"]);
  const [align, setAlign] = useState<string[]>(["left"]);
  return (
    <Pad>
      <ToggleGroup
        aria-label="Text format"
        value={format}
        onChange={setFormat}
        items={[
          { value: "bold", icon: "text", "aria-label": "Bold" },
          { value: "italic", icon: "pen", "aria-label": "Italic" },
          { value: "underline", icon: "minus", "aria-label": "Underline" },
        ]}
      />
      <ToggleGroup
        aria-label="Align"
        exclusive
        value={align}
        onChange={setAlign}
        items={[
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ]}
      />
      <div style={{ fontSize: 11, opacity: 0.6 }}>
        format: {format.join(", ") || "—"} · align: {align[0] ?? "—"}
      </div>
    </Pad>
  );
}

// ─── ToolbarGroup ──────────────────────────────────────────────
function ToolbarGroupDemo() {
  const [tool, setTool] = useState("brush");
  return (
    <Pad>
      <ToolbarGroup aria-label="Drawing tools">
        <IconButton
          icon="cursor"
          aria-label="Select"
          active={tool === "cursor"}
          onClick={() => setTool("cursor")}
        />
        <IconButton
          icon="brush"
          aria-label="Brush"
          active={tool === "brush"}
          onClick={() => setTool("brush")}
        />
        <IconButton
          icon="erase"
          aria-label="Erase"
          active={tool === "erase"}
          onClick={() => setTool("erase")}
        />
        <ToolbarSeparator />
        <IconButton
          icon="crop"
          aria-label="Crop"
          active={tool === "crop"}
          onClick={() => setTool("crop")}
        />
        <IconButton
          icon="zoom"
          aria-label="Zoom"
          active={tool === "zoom"}
          onClick={() => setTool("zoom")}
        />
      </ToolbarGroup>
      <ToolbarGroup aria-label="View tools" orientation="vertical" size="sm">
        <IconButton icon="hand" aria-label="Pan" />
        <IconButton icon="pin" aria-label="Pin" />
        <IconButton icon="dropper" aria-label="Eyedropper" />
      </ToolbarGroup>
      <div style={{ fontSize: 11, opacity: 0.6 }}>tool: {tool}</div>
    </Pad>
  );
}

// ─── Breadcrumb ────────────────────────────────────────────────
function BreadcrumbDemo() {
  const [last, setLast] = useState("—");
  return (
    <Pad>
      <Breadcrumb
        items={[
          { id: "home", label: "Home", icon: "hand" },
          { id: "proj", label: "Project" },
          { id: "comps", label: "Compositions" },
          { id: "file", label: "Hero.psd" },
        ]}
        onNavigate={(id) => setLast(id)}
      />
      <Breadcrumb
        aria-label="Collapsed path"
        maxItems={3}
        items={[
          { id: "a", label: "Assets" },
          { id: "b", label: "Brand" },
          { id: "c", label: "Logos" },
          { id: "d", label: "Export" },
          { id: "e", label: "logo@2x.png" },
        ]}
        onNavigate={(id) => setLast(id)}
      />
      <div style={{ fontSize: 11, opacity: 0.6 }}>navigated: {last}</div>
    </Pad>
  );
}

// ─── TreeView ──────────────────────────────────────────────────
const TREE_NODES: TreeNode[] = [
  {
    id: "scene",
    label: "Scene",
    icon: "shape",
    children: [
      {
        id: "chars",
        label: "Characters",
        icon: "shape",
        children: [
          { id: "hero", label: "Hero", icon: "cursor" },
          { id: "npc", label: "NPC", icon: "cursor" },
        ],
      },
      { id: "camera", label: "Camera", icon: "zoom" },
      { id: "lights", label: "Lighting", icon: "eye", disabled: true },
    ],
  },
  {
    id: "ui",
    label: "UI Layer",
    icon: "text",
    children: [
      { id: "hud", label: "HUD", icon: "text" },
      { id: "menu", label: "Menu", icon: "text" },
    ],
  },
];
function TreeViewDemo() {
  const [sel, setSel] = useState("hero");
  const [expanded, setExpanded] = useState<string[]>(["scene", "chars"]);
  return (
    <TreeView
      aria-label="Outliner"
      nodes={TREE_NODES}
      selectedId={sel}
      onSelect={setSel}
      expandedIds={expanded}
      onExpandedChange={setExpanded}
    />
  );
}

// ─── SearchField ───────────────────────────────────────────────
function SearchFieldDemo() {
  const [q, setQ] = useState("hero");
  const [ran, setRan] = useState("");
  return (
    <Pad>
      <SearchField
        aria-label="Search layers"
        value={q}
        onChange={setQ}
        onSearch={(v) => setRan(v)}
        onClear={() => setRan("")}
        placeholder="Search layers…"
      />
      <SearchField aria-label="Compact search" size="sm" defaultValue="" placeholder="Filter…" />
      <div style={{ fontSize: 11, opacity: 0.6 }}>
        query: {q || "—"}
        {ran ? ` · searched: ${ran}` : ""}
      </div>
    </Pad>
  );
}

// ─── Badge ─────────────────────────────────────────────────────
function BadgeDemo() {
  const [count, setCount] = useState(2);
  return (
    <Pad>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Badge>Default</Badge>
        <Badge tone="active">Active</Badge>
        <Badge tone="accent" icon={<span aria-hidden>●</span>}>Pro</Badge>
        <Badge size="sm">sm</Badge>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Badge as="button" tone="accent" onClick={() => setCount((c) => c + 1)}>
          Notifications · {count}
        </Badge>
        <Badge as="button" onClick={() => setCount(0)}>Clear</Badge>
      </div>
    </Pad>
  );
}

// ─── ProgressBar ───────────────────────────────────────────────
function ProgressBarDemo() {
  const [value, setValue] = useState(0.62);
  return (
    <Pad>
      <ProgressBar value={value} label="Rendering" />
      <ProgressBar value={value} size="sm" accent="oklch(0.72 0.16 150)" aria-label="Upload" />
      <ProgressBar indeterminate label="Importing assets…" />
      <div style={{ display: "flex", gap: 6 }}>
        <Button size="sm" onClick={() => setValue((v) => Math.max(0, v - 0.1))}>−10%</Button>
        <Button size="sm" onClick={() => setValue((v) => Math.min(1, v + 0.1))}>+10%</Button>
        <span style={{ fontSize: 11, opacity: 0.6, alignSelf: "center" }}>
          {Math.round(value * 100)}%
        </span>
      </div>
    </Pad>
  );
}

// ─── Spinner ───────────────────────────────────────────────────
function SpinnerDemo() {
  return (
    <Pad>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <Spinner size={14} />
        <Spinner size={20} label="Loading" />
        <Spinner size={28} accent="oklch(0.72 0.16 30)" label="Exporting" />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.85 }}>
        <Spinner size={14} label="Saving" />
        <span>Saving changes…</span>
      </div>
    </Pad>
  );
}

export const inspectorEntries: GalleryEntry[] = [
  {
    id: "inspector/Section",
    label: "Section",
    category: "Inspector / layout",
    section: "Creative",
    render: () => <SectionDemo />,
  },
  {
    id: "inspector/SegmentedControl",
    label: "SegmentedControl",
    category: "Inspector / layout",
    section: "Creative",
    render: () => <SegmentedControlDemo />,
  },
  {
    id: "inspector/ToggleGroup",
    label: "ToggleGroup",
    category: "Inspector / layout",
    section: "Creative",
    render: () => <ToggleGroupDemo />,
  },
  {
    id: "inspector/ToolbarGroup",
    label: "ToolbarGroup",
    category: "Inspector / layout",
    section: "Creative",
    render: () => <ToolbarGroupDemo />,
  },
  {
    id: "inspector/Breadcrumb",
    label: "Breadcrumb",
    category: "Inspector / layout",
    section: "Creative",
    render: () => <BreadcrumbDemo />,
  },
  {
    id: "inspector/TreeView",
    label: "TreeView",
    category: "Inspector / layout",
    section: "Creative",
    render: () => <TreeViewDemo />,
    flush: true,
  },
  {
    id: "inspector/SearchField",
    label: "SearchField",
    category: "Inspector / layout",
    section: "Creative",
    render: () => <SearchFieldDemo />,
  },
  {
    id: "inspector/Badge",
    label: "Badge",
    category: "Inspector / layout",
    section: "Creative",
    render: () => <BadgeDemo />,
  },
  {
    id: "inspector/ProgressBar",
    label: "ProgressBar",
    category: "Inspector / layout",
    section: "Creative",
    render: () => <ProgressBarDemo />,
  },
  {
    id: "inspector/Spinner",
    label: "Spinner",
    category: "Inspector / layout",
    section: "Creative",
    render: () => <SpinnerDemo />,
  },
];
