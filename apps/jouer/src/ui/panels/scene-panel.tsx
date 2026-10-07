// ─────────────────────────────────────────────────────────────
// scene-panel.tsx — the scene list + the active scene's object hierarchy.
// Pick/rename/add/delete scenes; select, reveal, toggle visibility/lock and
// reorder the game objects that make up the active scene.
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { Icon, I, Section } from "@monet-ui/monet-react";
import { RenameInput } from "../rename-input";
import * as cmd from "../../commands";
import { store, useStore } from "../../state/app";
import { activeScene, sortForHierarchy, type HierarchySort } from "../../model/query";
import { collectHierarchy, isHierarchyQueryEmpty, parseHierarchyQuery, type HierarchyMatch } from "../../model/hierarchy-search";
import type { GameObject, GameObjectKind, Id } from "../../model/types";

/** Hierarchy-search context threaded to the tree rows (Unity Hierarchy search). */
interface FilterCtx {
  active: boolean;
  matches: Set<Id>;
  visible: Set<Id>;
}
const NO_FILTER: FilterCtx = { active: false, matches: new Set(), visible: new Set() };

// The object id currently being dragged in the hierarchy (Unity drag-to-reparent).
// Module-level so the drag source and any drop target row share it without prop
// threading; dataTransfer.getData isn't readable during dragover, so we track it here.
let dragObjId: Id | null = null;

// Alphabetical-sort glyph (A/Z bars + a down arrow), for the Hierarchy sort toggle.
const SORT_ICON = "M3 4h7M3 8h4M3 12h2M12 3v9m0 0l-2.2-2.2M12 12l2.2-2.2";

const KIND_ICON: Record<GameObjectKind, string> = {
  sprite: I.shape,
  image: I.crop,
  text: I.text,
  rectangle: "M3 4h10v8H3z",
  ellipse: "M8 3.5c2.8 0 4.8 2 4.8 4.5S10.8 12.5 8 12.5 3.2 10.5 3.2 8 5.2 3.5 8 3.5z",
  triangle: "M8 3l5 9H3z",
  hexagon: "M8 2l5 3v6l-5 3-5-3V5z",
  hexagonFlat: "M5 3h6l3 5-3 5H5l-3-5z",
  diamond: "M8 2l6 6-6 6-6-6z",
  capsule: "M5 4h6a4 4 0 0 1 0 8H5a4 4 0 0 1 0-8z",
  container: "M2.5 4.5h4v3h-4zM9.5 8.5h4v3h-4zM6.5 6h3",
};

export function ScenePanel() {
  const project = useStore((s) => s.project);
  const activeSceneId = useStore((s) => s.project.activeSceneId);
  const filterQuery = useStore((s) => s.hierarchyFilter);
  const sortMode = useStore((s) => s.hierarchySort);
  const renamingSceneId = useStore((s) => s.renamingSceneId);
  const scene = activeScene(project);

  // Unity Hierarchy search: parse the query and collect matching ids + the
  // ancestor chain so nested matches stay reachable. Empty query ⇒ full tree.
  const filtering = !isHierarchyQueryEmpty(filterQuery);
  const found: HierarchyMatch = filtering && scene
    ? collectHierarchy(scene.objects, parseHierarchyQuery(filterQuery))
    : { matches: new Set(), visible: new Set() };
  const filter: FilterCtx = filtering ? { active: true, matches: found.matches, visible: found.visible } : NO_FILTER;

  return (
    <div className="mj-col">
      <Section title="Scenes" defaultOpen actions={
        <button className="mj-tinybtn" title="New scene" onClick={() => cmd.addScene()}><Icon d={I.plus} size={12} /></button>
      }>
        <div className="mj-list" style={{ padding: 0 }}>
          {project.scenes.map((sc) => (
            <div
              key={sc.id}
              data-scene-id={sc.id}
              className={"mj-item" + (sc.id === activeSceneId ? " is-sel" : "")}
              onClick={() => store.setActiveScene(sc.id)}
              onDoubleClick={() => store.setRenamingSceneId(sc.id)}
            >
              <span className="mj-item-icon"><Icon d={I.marker} size={13} /></span>
              {renamingSceneId === sc.id ? (
                <RenameInput initial={sc.name} testid="scene-rename" onCommit={(name) => cmd.renameScene(sc.id, name)} onExit={() => store.setRenamingSceneId(null)} />
              ) : (
                <span className="mj-item-name">{sc.name}</span>
              )}
              <span className="mj-item-meta">{sc.objects.length}</span>
              <span
                data-testid="set-start-scene"
                title={project.startSceneId === sc.id ? "Start scene — the exported game boots here (click to clear)" : "Set as start scene (the exported game boots here)"}
                style={{ cursor: "pointer", flex: "0 0 auto", fontSize: 10, paddingLeft: 4, color: project.startSceneId === sc.id ? "var(--accent)" : undefined, opacity: project.startSceneId === sc.id ? 1 : 0.35 }}
                onClick={(e) => { e.stopPropagation(); cmd.setStartScene(project.startSceneId === sc.id ? null : sc.id); }}
              >
                ▶
              </span>
            </div>
          ))}
        </div>
        <div className="mj-row" style={{ padding: "6px 8px", gap: 6 }}>
          <button className="mj-tinybtn" disabled={!scene} onClick={() => scene && cmd.duplicateScene(scene.id)}>Duplicate</button>
          <button className="mj-tinybtn" disabled={project.scenes.length <= 1} onClick={() => scene && cmd.deleteScene(scene.id)}>Delete</button>
        </div>
      </Section>

      <Section title="Hierarchy" defaultOpen actions={<AddObjectButtons />}>
        <div className="mj-row" style={{ padding: "6px 8px", gap: 6 }}>
          <span className="mj-item-icon" style={{ opacity: 0.6 }}><Icon d={I.search} size={13} /></span>
          <input
            data-testid="hierarchy-search"
            className="mj-search"
            placeholder="Search name or t:type"
            value={filterQuery}
            style={searchStyle}
            onChange={(e) => store.setHierarchyFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") store.setHierarchyFilter(""); }}
          />
          {filtering && (
            <button className="mj-tinybtn" data-testid="hierarchy-clear" title="Clear search" onClick={() => store.setHierarchyFilter("")}>×</button>
          )}
          <button
            className={"mj-tinybtn" + (sortMode === "name" ? " is-on" : "")}
            data-testid="hierarchy-sort"
            title={sortMode === "name" ? "Sort: Alphabetical (click for Transform order)" : "Sort: Transform order (click for Alphabetical)"}
            onClick={() => store.setHierarchySort(sortMode === "name" ? "transform" : "name")}
          >
            <Icon d={SORT_ICON} size={13} />
          </button>
          <button className="mj-tinybtn" data-testid="hierarchy-collapse-all" title="Collapse All" onClick={() => cmd.collapseAllHierarchy()}>
            <Icon d={I.chevRight} size={13} />
          </button>
          <button className="mj-tinybtn" data-testid="hierarchy-expand-all" title="Expand All" onClick={() => cmd.expandAllHierarchy()}>
            <Icon d={I.chevDown} size={13} />
          </button>
        </div>
        {filtering && (
          <div className="mj-muted" data-testid="hierarchy-count" style={{ padding: "0 8px 4px 8px" }}>
            {filter.matches.size > 0 ? `${filter.matches.size} match${filter.matches.size === 1 ? "" : "es"}` : "No matches"}
          </div>
        )}
        <div
          className="mj-fill"
          style={{ minHeight: 80 }}
          onDragOver={(e) => { if (dragObjId) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); if (dragObjId) cmd.reparent(dragObjId, null); dragObjId = null; }}
        >
          {scene && scene.objects.length === 0 && (
            <div className="mj-muted mj-pad">No objects yet. Use the tools on the left or the + buttons above to add sprites, text and shapes.</div>
          )}
          {scene && <ObjectTree objects={scene.objects} depth={0} filter={filter} sort={sortMode} />}
        </div>
      </Section>
    </div>
  );
}

function AddObjectButtons() {
  const kinds: GameObjectKind[] = ["sprite", "text", "rectangle", "ellipse", "triangle", "hexagon", "hexagonFlat", "diamond", "capsule", "container"];
  return (
    <span className="mj-row" style={{ gap: 3 }}>
      {kinds.map((k) => (
        <button key={k} className="mj-tinybtn" title={`Add ${k}`} style={{ padding: "0 5px" }} onClick={() => cmd.addObject(k)}>
          <Icon d={KIND_ICON[k]} size={12} />
        </button>
      ))}
    </span>
  );
}

function ObjectTree({ objects, depth, filter, sort }: { objects: GameObject[]; depth: number; filter: FilterCtx; sort: HierarchySort }) {
  // Order each sibling level by render order (depth desc) or alphabetically
  // (Unity's Transform vs Alphabetical hierarchy sort).
  const ordered = sortForHierarchy(objects, sort);
  return (
    <>
      {ordered.map((o) => (
        <ObjectRow key={o.id} o={o} depth={depth} filter={filter} sort={sort} />
      ))}
    </>
  );
}

function ObjectRow({ o, depth, filter, sort }: { o: GameObject; depth: number; filter: FilterCtx; sort: HierarchySort }) {
  const selection = useStore((s) => s.selection);
  const collapsed = useStore((s) => s.collapsed);
  const renaming = useStore((s) => s.renamingId) === o.id;
  const [dropHover, setDropHover] = useState(false);
  const selected = selection.includes(o.id);
  const isContainer = o.kind === "container";
  const hasKids = isContainer && (o.children?.length ?? 0) > 0;

  // Hierarchy search: hide rows outside the visible set; highlight direct
  // matches; force containers open so matching descendants stay reachable.
  if (filter.active && !filter.visible.has(o.id)) return null;
  const isMatch = filter.active && filter.matches.has(o.id);
  // Open unless this container is collapsed; an active search forces it open.
  const open = filter.active || !collapsed.has(o.id);

  return (
    <>
      <div
        className={"mj-item" + (selected ? " is-sel" : "") + (isMatch ? " is-match" : "")}
        data-obj-id={o.id}
        draggable={!renaming}
        onDragStart={(e) => { dragObjId = o.id; e.dataTransfer.setData("text/plain", o.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { dragObjId = null; setDropHover(false); }}
        onDragOver={isContainer ? (e) => { if (dragObjId && dragObjId !== o.id) { e.preventDefault(); e.stopPropagation(); setDropHover(true); } } : undefined}
        onDragLeave={isContainer ? () => setDropHover(false) : undefined}
        onDrop={isContainer ? (e) => { e.preventDefault(); e.stopPropagation(); setDropHover(false); if (dragObjId) cmd.reparent(dragObjId, o.id); dragObjId = null; } : undefined}
        style={{ paddingLeft: 8 + depth * 14, opacity: o.visible ? 1 : 0.5, outline: dropHover ? "1px solid var(--accent)" : undefined, outlineOffset: -1 }}
        onClick={(e) => {
          // Unity hierarchy selection: Shift = contiguous range, Cmd/Ctrl =
          // toggle, plain = single. Plain/toggle clicks set the range anchor.
          if (e.shiftKey) { cmd.selectHierarchyRange(o.id); return; }
          if (e.metaKey || e.ctrlKey) { store.toggleSelect(o.id); store.setSelectionAnchor(o.id); return; }
          store.selectOne(o.id); store.setSelectionAnchor(o.id);
        }}
        onDoubleClick={() => store.setRenamingId(o.id)}
      >
        <span
          className="mj-item-icon"
          data-testid="row-twirl"
          style={{ width: 12, opacity: hasKids ? 0.8 : 0, cursor: hasKids ? "pointer" : "default" }}
          onClick={(e) => { e.stopPropagation(); store.toggleCollapsed(o.id); }}
        >
          {hasKids && <Icon d={open ? I.chevDown : I.chevRight} size={11} />}
        </span>
        <input
          data-testid="row-active"
          type="checkbox"
          checked={o.active !== false}
          title={o.active !== false ? "Active (click to deactivate)" : "Inactive (click to activate)"}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => cmd.setActive(o.id, e.target.checked)}
          style={{ width: 12, height: 12, flex: "0 0 auto", margin: 0, accentColor: "var(--accent)", cursor: "pointer" }}
        />
        <span className="mj-item-icon"><Icon d={KIND_ICON[o.kind]} size={13} /></span>
        {renaming ? (
          <RenameInput initial={o.name} testid="row-rename" onCommit={(name) => cmd.renameObject(o.id, name)} onExit={() => store.setRenamingId(null)} />
        ) : (
          <span className="mj-item-name" style={o.active === false ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>{o.name}</span>
        )}
        <span
          className="mj-item-icon"
          title={o.visible ? "Hide" : "Show"}
          style={{ opacity: o.visible ? 0.7 : 0.35 }}
          onClick={(e) => { e.stopPropagation(); cmd.setVisible(o.id, !o.visible); }}
        >
          <Icon d={I.eye} size={13} />
        </span>
        <span
          className="mj-item-icon"
          title={o.locked ? "Unlock" : "Lock"}
          style={{ opacity: o.locked ? 0.9 : 0.3 }}
          onClick={(e) => { e.stopPropagation(); cmd.setLocked(o.id, !o.locked); }}
        >
          <Icon d={I.lock} size={13} />
        </span>
      </div>
      {hasKids && open && <ObjectTree objects={o.children!} depth={depth + 1} filter={filter} sort={sort} />}
    </>
  );
}

const searchStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "var(--glass-1)",
  border: "0.5px solid var(--stroke-soft)",
  borderRadius: 4,
  color: "var(--text-1)",
  fontSize: 11.5,
  padding: "3px 6px",
};
