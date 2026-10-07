// ─────────────────────────────────────────────────────────────
// Dockable workspace — data-driven, interactive panel manager
// ─────────────────────────────────────────────────────────────
// State shape:
//   layout = {
//     left:   { size: 280, cols: [Column, ...] } | null,
//     right:  { size: 320, cols: [Column, ...] } | null,
//     bottom: { size: 240, cols: [Column, ...] } | null,
//     floating: [{ id, x, y, w, h, cols: [Column, ...] }],   // a free mini-dock
//   }
//   Column = { id, flex, stack: [Group, ...] }
//   Group  = { id, tabs: [tabId], active: tabId, flex }
// (Legacy `{ stack: [...] }` per side is accepted by normLayout and wrapped
//  into a single column.)
//
// panels = { [tabId]: { title, render: () => JSX } }
//
// Interactions wired:
//   • Click tab          → activate
//   • Drag tab           → undocks; shows snap zones; drops into target
//   • Drag float header  → move; drops into snap zones
//   • Splitter drag      → resize dock or split between groups
//   • Close button       → removes tab / floating group (becomes ghost rail)

import React, { useState, useEffect, useRef, useCallback, useContext, forwardRef, useImperativeHandle } from "react";
import { Icon } from "./icons";
import { Titlebar, type MenusProp } from "./primitives";
import { MonetContext, type WindowControls } from "./chrome";
import type { Accent, Platform } from "@monet-ui/monet-core";
import {
  normLayout, normTBL, applyDrop, dockFloatImmutable, removeTabImmutable, openTabImmutable,
  removeTbColImmutable, insertTbColImmutable, setDockCollapsedImmutable,
  stripTbId, tbMoveImmutable, snapLabel,
  getCols, withCols, sameStruct,
  hitTest, computeSnapRects, computeDockWidget, tbHitTest, tbSnapRect,
} from "./dockable-core";
import type {
  DockGroup, DockColumn, DockSide, DockFloat,
  DockLayout, ToolbarFloat, ToolbarLayout,
  NLayout, NTBL, NCol, NPanelCol, NFloat, Cont, DropTarget, TbTarget,
  DockSideName,
} from "./dockable-core";
import {
  beginPointerSession,
  DDock, DFloat, DragGhost, DragSnap, DockWidget, EdgeHints,
} from "./dockable-views";


// ─── Toolbar primitive + edge-slot management ───────────────
// Toolbars are relocatable strips. They live in one of: top, left, right, float.
// Each has a small grip handle the user drags to move/dock.

// The toolbar edge model + the pure edge-model edits (normTBL / stripTbId /
// tbMoveImmutable / …) and the DOM-reading hit-test + snap-rect helpers
// (tbHitTest / tbSnapRect) all live in dockable-core; imported above.

function Toolbar({ id, orientation, accent, isDragging, isFloat, x, y, onGripDown, children }: any) {
  return (
    <div className={`monet-toolbar monet-toolbar--${orientation} ${isDragging ? "is-dragging" : ""} ${isFloat ? "is-float" : ""}`}
         data-toolbar-id={id}
         style={{ "--accent": accent, ...(isFloat ? { left: x, top: y } : {}) } as React.CSSProperties}>
      <div className="monet-toolbar-grip" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onGripDown(id, e); }}>
        <Icon d={orientation === "h" ? "M5 4L5 12 M8 4L8 12 M11 4L11 12" : "M4 5L12 5 M4 8L12 8 M4 11L12 11"} size={10}/>
      </div>
      <div className="monet-toolbar-body">{children}</div>
    </div>
  );
}

// ─── titlebar + menus reused from panels.jsx primitives ────

// ─── public layout types ────────────────────────────────────
// The JSON-serializable layout-tree data contracts (DockGroup / DockColumn /
// DockSide / DockFloat / DockLayout / ToolbarFloat / ToolbarLayout) are defined
// in dockable-core alongside the pure algebra that produces them (imported
// above). Re-export them here so they remain part of the public API surface.
export type {
  DockGroup, DockColumn, DockSide, DockFloat,
  DockLayout, DockSideName, ToolbarFloat, ToolbarLayout,
};

/** Imperative handle exposed via ref on [`DockableWorkspace`]. Lets a host
 *  read & drive the live layout without a remount. All getters return the
 *  current normalized tree; setters accept any seed normLayout/normTBL accept. */
export interface DockableWorkspaceHandle {
  /** Current normalized panel layout. */
  getLayout(): DockLayout;
  /** Replace the panel layout (normalized on the way in). */
  setLayout(next: DockLayout): void;
  /** Collapse a side into its icon rail, retaining its panels and expanded size. */
  setDockCollapsed(side: DockSideName, collapsed: boolean): void;
  /** Ensure a registered panel is present, reopening it after a persisted close.
   *  A panel iconified in a collapsed dock springs out of the rail instead. */
  openPanel(id: string): void;
  /** Remove a panel from the layout — the inverse of [`openPanel`]. */
  closePanel(id: string): void;
  /** Current normalized toolbar layout. */
  getToolbarLayout(): ToolbarLayout;
  /** Replace the toolbar layout (normalized on the way in). */
  setToolbarLayout(next: ToolbarLayout): void;
  /** Restore both layouts to the initial seed the workspace mounted with. */
  reset(): void;
}

/** All panel tab ids present in a layout (docked sides + floats), in tree
 *  order. Lets a host render a checkmarked panel inventory (e.g. a Window
 *  menu) without knowing the layout tree's shape. Accepts any seed
 *  [`normLayout`] accepts, so persisted snapshots work directly. */
export function dockLayoutPanelIds(layout: DockLayout): string[] {
  const L = normLayout(layout);
  const ids: string[] = [];
  const walk = (cols: NCol[]) => cols.forEach((c) => { if (c.kind === "panel") c.stack.forEach((g) => ids.push(...g.tabs)); });
  for (const side of ["left", "right", "top", "bottom"] as const) { const d = L[side]; if (d) walk(d.cols); }
  L.floating.forEach((f) => walk(f.cols));
  return ids;
}

/** Orientation a relocatable toolbar is currently laid out in: `"h"` for a
 *  horizontal row (top/bottom edges), `"v"` for a vertical column (left/right). */
export type ToolbarOrientation = "h" | "v";

/** One dockable panel: its tab title plus a render fn for the panel body. The
 *  body content slot is intentionally loose (any ReactNode), but the panel
 *  contract itself is typed so the `panels` map can be checked at the call site. */
export interface PanelDef {
  /** Tab label shown in the panel's tab strip. */
  title?: React.ReactNode;
  /** Optional glyph shown in a collapsed dock's icon rail. */
  icon?: React.ReactNode;
  /** Renders the panel body. */
  render: () => React.ReactNode;
  /** Drop the body's default padding (flush content, e.g. a layers tree). */
  flush?: boolean;
}
/** The panel registry: a map from tab id → its definition. */
export type PanelMap = Record<string, PanelDef>;

/** One relocatable toolbar: a render fn (passed the current orientation) plus an
 *  optional flag that pins it horizontal in any slot (e.g. an options bar). */
export interface ToolbarDef {
  /** Renders the toolbar body for the given orientation. */
  render: (orientation: ToolbarOrientation) => React.ReactNode;
  /** Keep this toolbar horizontal even in a vertical (left/right) slot. */
  horizontalOnly?: boolean;
}
/** The toolbar registry: a map from toolbar id → its definition. */
export type ToolbarDefMap = Record<string, ToolbarDef>;

/** Props for [`DockableWorkspace`]. The data contracts (panels, toolbars,
 *  layout, docs, menus) are typed; free-form content slots stay ReactNode. */
export interface DockableWorkspaceProps {
  /** Accent — one of the built-in [`Accent`] names or any CSS color string. */
  accent?: Accent | string;
  app?: React.ReactNode;
  /** Content for the app pill's info panel (see [`Titlebar`]'s `appPanel`). */
  appPanel?: React.ReactNode;
  title?: React.ReactNode;
  /** Document tab labels (a trailing `*` marks an unsaved doc). */
  docs?: string[];
  /** Active document label (controlled). */
  activeDoc?: string;
  /** Fired when a document tab is clicked. */
  onDocSelect?: (doc: string) => void;
  /** Fired when a document tab's close button (or Backspace/Delete) is used. */
  onDocClose?: (doc: string) => void;
  /** Fired after document tabs are reordered by drag. */
  onDocReorder?: (order: string[]) => void;
  /** Menu bar definition — legacy `string[]` or rich [`MenuBarEntry[]`]. */
  menus?: MenusProp;
  canvas?: React.ReactNode;
  statusBar?: React.ReactNode;
  iconRail?: React.ReactNode;
  iconRailLeft?: React.ReactNode;
  /** Relocatable toolbars, keyed by id and referenced from the toolbar layout. */
  toolbarDefs?: ToolbarDefMap;
  /** Dockable panels, keyed by tab id and referenced from the panel layout. */
  panels?: PanelMap;
  platform?: Platform;
  controls?: WindowControls;
  /** Use the OS window frame and keep only the in-app document tab bar. */
  nativeFrame?: boolean;

  /** Uncontrolled initial panel layout (seed only; read once at mount). */
  initialLayout?: DockLayout;
  /** Uncontrolled initial toolbar layout (seed only; read once at mount). */
  initialToolbarLayout?: ToolbarLayout;

  /** Controlled panel layout. When provided, prop changes are reconciled into
   *  the live workspace via an effect (no remount). Internal drag edits still
   *  run optimistically; the host is expected to observe onLayoutChange and
   *  feed the value back to stay in sync. */
  layout?: DockLayout;
  /** Controlled toolbar layout — see `layout`. */
  toolbarLayout?: ToolbarLayout;

  /** Fired after the panel layout changes (skips the initial mount). */
  onLayoutChange?: (layout: DockLayout) => void;
  /** Fired after the toolbar layout changes (skips the initial mount). */
  onToolbarLayoutChange?: (toolbarLayout: ToolbarLayout) => void;

  /** Put a collapsed dock's sprung-out panel away when the user clicks
   *  elsewhere (default). `false` keeps it out until its rail icon is clicked
   *  again or Escape is pressed — Photoshop's Auto-Collapse Iconic Panels. */
  autoCollapseFlyouts?: boolean;
}

// ─── internal drag-state shapes ─────────────────────────────
// Live preview state during a panel drag: a tab being undocked, or an entire
// float being dragged toward a dock target. `target` is the resolved drop spot.
interface PanelDrag {
  kind: "tab" | "float-dock";
  tabId?: string;
  floatId?: string;
  x: number;
  y: number;
  target: DropTarget | null;
}
// Live preview state during a toolbar drag.
interface TbDrag {
  id: string;
  x: number;
  y: number;
  target: TbTarget;
}

// ─── main workspace component ───────────────────────────────
const DockableWorkspace = forwardRef<DockableWorkspaceHandle, DockableWorkspaceProps>(function DockableWorkspace({
  accent, app, appPanel, title, docs, activeDoc,
  onDocSelect, onDocClose, onDocReorder,
  menus, canvas, statusBar, iconRail, iconRailLeft,
  toolbarDefs = {}, initialToolbarLayout = {},
  panels, initialLayout, platform: platformProp, controls: controlsProp,
  nativeFrame,
  layout: layoutProp, toolbarLayout: tbLayoutProp,
  onLayoutChange, onToolbarLayoutChange, autoCollapseFlyouts = true,
}: DockableWorkspaceProps, ref) {
  const _ctx = useContext(MonetContext);
  const platform = platformProp ?? _ctx?.platform ?? "mac";
  const controls = controlsProp ?? _ctx?.controls;
  const useNativeFrame = nativeFrame === true && platform === "mac";

  // Initial seed: the uncontrolled `initial*` props are the canonical seed and
  // are read exactly once. If the workspace mounts already controlled, seed
  // from the controlled value instead so the very first render matches it.
  const initLayoutSeed = useRef<DockLayout>(initialLayout ?? {});
  const initTbLayoutSeed = useRef<ToolbarLayout>(initialToolbarLayout);
  const [layout, setLayout] = useState<NLayout>(() => normLayout(layoutProp ?? initLayoutSeed.current));
  const [tbLayout, setTbLayout] = useState<NTBL>(() => normTBL(tbLayoutProp ?? initTbLayoutSeed.current));
  const [layoutRevision, setLayoutRevision] = useState(0);
  // A fresh object per openPanel() call, so opening the same panel twice still
  // springs it out of a collapsed rail the second time.
  const [flyoutRequest, setFlyoutRequest] = useState<{ id: string } | null>(null);
  const [drag, setDrag] = useState<PanelDrag | null>(null);  // panel tab/header drag
  const [tbDrag, setTbDrag] = useState<TbDrag | null>(null);  // toolbar drag
  const hostRef = useRef<any>(null);
  const bodyRef = useRef<any>(null);

  // ─── controlled / observable / imperative layout API ──────────
  // Controlled-mode reconcile: when the host passes a `layout` (resp.
  // `toolbarLayout`) prop, push it into internal state whenever it differs
  // structurally from what we're already holding. We compare the incoming prop
  // against its own last-seen value (not against `layout`) so optimistic drag
  // edits don't get clobbered before the host echoes them back — and we never
  // re-normalize-and-set when nothing changed, which would otherwise loop with
  // the onChange effect below.
  const lastLayoutProp = useRef<any>(layoutProp);
  useEffect(() => {
    if (layoutProp === undefined) return;            // uncontrolled — ignore
    if (sameStruct(layoutProp, lastLayoutProp.current)) return;
    lastLayoutProp.current = layoutProp;
    const norm = normLayout(layoutProp);
    if (!sameStruct(layout, norm)) {
      setLayout(norm);
      setLayoutRevision(n => n + 1);
    }
  }, [layoutProp]);

  const lastTbLayoutProp = useRef<any>(tbLayoutProp);
  useEffect(() => {
    if (tbLayoutProp === undefined) return;          // uncontrolled — ignore
    if (sameStruct(tbLayoutProp, lastTbLayoutProp.current)) return;
    lastTbLayoutProp.current = tbLayoutProp;
    const norm = normTBL(tbLayoutProp);
    setTbLayout(prev => sameStruct(prev, norm) ? prev : norm);
  }, [tbLayoutProp]);

  // Observable: fire onLayoutChange after the layout settles, skipping the
  // initial mount. A ref tracks the latest callback so the effect can depend
  // only on `layout` (firing exactly when the tree changes) without re-running
  // when the host passes a new inline callback each render.
  const onLayoutChangeRef = useRef(onLayoutChange);
  onLayoutChangeRef.current = onLayoutChange;
  const layoutMounted = useRef(false);
  useEffect(() => {
    if (!layoutMounted.current) { layoutMounted.current = true; return; }
    onLayoutChangeRef.current?.(layout);
  }, [layout]);

  const onTbLayoutChangeRef = useRef(onToolbarLayoutChange);
  onTbLayoutChangeRef.current = onToolbarLayoutChange;
  const tbMounted = useRef(false);
  useEffect(() => {
    if (!tbMounted.current) { tbMounted.current = true; return; }
    onTbLayoutChangeRef.current?.(tbLayout);
  }, [tbLayout]);

  // Imperative handle: read/drive the live layout without a remount. Setters
  // normalize their input (so a host can replay a getLayout() snapshot or a
  // looser preset); reset() restores the original mount-time seed.
  useImperativeHandle(ref, (): DockableWorkspaceHandle => ({
    getLayout: () => layout,
    setLayout: (next) => { setLayout(normLayout(next)); setLayoutRevision(n => n + 1); },
    setDockCollapsed: (side, collapsed) => {
      // Validate before queuing a state update so an invalid imperative request
      // throws to its caller without failing the next React render.
      setDockCollapsedImmutable(layout, side, collapsed);
      setLayout(current => setDockCollapsedImmutable(current, side, collapsed));
    },
    openPanel: (id) => { setLayout((current) => openTabImmutable(current, id)); setFlyoutRequest({ id }); },
    closePanel: (id) => setLayout((current) => removeTabImmutable(current, id)),
    getToolbarLayout: () => tbLayout,
    setToolbarLayout: (next) => setTbLayout(normTBL(next)),
    reset: () => {
      setLayout(normLayout(initLayoutSeed.current));
      setTbLayout(normTBL(initTbLayoutSeed.current));
      setLayoutRevision(n => n + 1);
    },
  }), [layout, tbLayout]);

  // resolve cursor → drop target; only consider hits within body
  const computeTarget = (x: number, y: number) => hitTest(bodyRef.current, x, y);

  // drag a tab off
  const onDragTab = useCallback((tabId: string, _fromSide: DockSideName | "float", _fromGroupIdx: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!started && Math.hypot(dx, dy) < 5) return;
      started = true;
      const target = computeTarget(ev.clientX, ev.clientY);
      setDrag({ kind: "tab", tabId, x: ev.clientX, y: ev.clientY, target });
    };
    const up = (ev: PointerEvent) => {
      if (started) {
        const target = computeTarget(ev.clientX, ev.clientY);
        // if dropping back on the same group's tab strip (no change), skip
        setLayout(L => applyDrop(L, tabId, target));
      }
      setDrag(null);
    };
    // A tab drag never mutated `layout` until drop, so cancelling just clears
    // the drag preview — nothing to restore.
    const onCancel = () => setDrag(null);
    beginPointerSession({ move, up, onCancel });
  }, []);

  // drag a floating panel header (move + dock)
  const onDragHeader = useCallback((floatId: string, e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const float = layout.floating.find(f => f.id === floatId);
    if (!float) return;
    const startFx = float.x, startFy = float.y;
    const body = bodyRef.current;
    const bodyScale = (body && body.offsetWidth > 0
      ? body.getBoundingClientRect().width / body.offsetWidth : 1) || 1;
    // Self-drops aren't dock targets. The dragged float is excluded from
    // hit-testing, but guard anyway.
    const isSelfDrop = (t: DropTarget | null) => t && t.cont && t.cont.floatId === floatId;
    // Exclude the dragged float from hit-testing — the float follows the cursor
    // and would otherwise always be the topmost hit, blocking docks underneath.
    const hit = (x: number, y: number) => hitTest(bodyRef.current, x, y, floatId);
    const firstTab = (() => {
      for (const c of float.cols) if (c.kind === "panel" && c.stack.length) return c.stack[0].active;
      return null;
    })();
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / bodyScale, dy = (ev.clientY - startY) / bodyScale;
      const target = hit(ev.clientX, ev.clientY);
      const docking = target && target.kind !== "float" && !isSelfDrop(target);
      setLayout(L => ({
        ...L,
        floating: L.floating.map(f => f.id === floatId
          ? { ...f, x: startFx + dx, y: startFy + dy } : f),
      }));
      if (docking) {
        setDrag({ kind: "float-dock", floatId, x: ev.clientX, y: ev.clientY, target, tabId: firstTab ?? undefined });
      } else {
        setDrag(null);
      }
    };
    const up = (ev: PointerEvent) => {
      const target = hit(ev.clientX, ev.clientY);
      if (target && target.kind !== "float" && !isSelfDrop(target)) {
        // (#177) dock the float as ONE group — never one group/column per tab
        setLayout(L => dockFloatImmutable(L, floatId, target));
      }
      setDrag(null);
    };
    // Escape restores the float to where it started (the live move mutated it).
    const onCancel = () => {
      setLayout(L => ({
        ...L,
        floating: L.floating.map(f => f.id === floatId ? { ...f, x: startFx, y: startFy } : f),
      }));
      setDrag(null);
    };
    beginPointerSession({ move, up, onCancel });
  }, [layout]);

  const onActivate = (cont: Cont, colIdx: number, groupIdx: number, tabId: string) => {
    setLayout(L => {
      const cols = getCols(L, cont); if (!cols) return L;
      const ncols = cols.slice();
      // Activation only targets panel cols (tab strips live in panel groups).
      const col = ncols[colIdx] as NPanelCol;
      const stack = col.stack.slice();
      stack[groupIdx] = { ...stack[groupIdx], active: tabId };
      ncols[colIdx] = { ...col, stack };
      return withCols(L, cont, ncols);
    });
  };

  const onCloseTab = (_cont: Cont, _colIdx: number, _groupIdx: number, tabId: string) => {
    setLayout(L => removeTabImmutable(L, tabId));
  };
  const onCloseFloat = (id: string) => {
    setLayout(L => ({ ...L, floating: L.floating.filter(f => f.id !== id) }));
  };
  const onResizeFloat = (id: string, geom: Partial<NFloat>) => {
    setLayout(L => ({ ...L, floating: L.floating.map(f => f.id === id ? { ...f, ...geom } : f) }));
  };

  const onResizeDock = (side: DockSideName, size: number) => {
    setLayout(L => {
      const d = L[side]; if (!d) return L;
      return { ...L, [side]: { ...d, size } };
    });
  };
  const onCollapseDock = (side: DockSideName, collapsed: boolean) => {
    setLayout(L => setDockCollapsedImmutable(L, side, collapsed));
  };
  const onResizeGroup = (cont: Cont, colIdx: number, i: number, na: number, nb: number) => {
    setLayout(L => {
      const cols = getCols(L, cont); if (!cols) return L;
      const ncols = cols.slice();
      // Group resizing only applies inside panel cols.
      const col = ncols[colIdx] as NPanelCol;
      const stack = col.stack.slice();
      stack[i] = { ...stack[i], flex: na };
      stack[i+1] = { ...stack[i+1], flex: nb };
      ncols[colIdx] = { ...col, stack };
      return withCols(L, cont, ncols);
    });
  };
  const onResizeCol = (cont: Cont, i: number, na: number, nb: number) => {
    setLayout(L => {
      const cols = getCols(L, cont); if (!cols) return L;
      const ncols = cols.slice();
      // Only panel cols are resizable (the view disables splitters next to tb cols).
      ncols[i] = { ...(ncols[i] as NPanelCol), flex: na };
      ncols[i+1] = { ...(ncols[i+1] as NPanelCol), flex: nb };
      return withCols(L, cont, ncols);
    });
  };

  // snap rect to draw
  const snapRect = drag && drag.target && drag.target.kind !== "float"
    ? computeSnapRects(bodyRef.current, drag.target) : null;
  // Hide the floating text label whenever the directional widget is on screen
  // (the widget already communicates intent) — keep it for edge/float docks.
  const snapText = drag?.target?.gid ? "" : snapLabel(drag?.target);

  // ─── toolbar drag ─────────────────────────────────────────
  const onTbGripDown = useCallback((id: string, e: React.PointerEvent) => {
    const startX = e.clientX, startY = e.clientY;
    let started = false;
    // Pre-drag snapshots so Escape can restore both trees (the move live-detaches
    // the toolbar into a float, mutating layout + tbLayout). Captured lazily on
    // the first mutating move via the functional setters.
    let snapLayout: NLayout | null = null, snapTb: NTBL | null = null;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!started && Math.hypot(dx, dy) < 4) return;
      started = true;
      const target = tbHitTest(bodyRef.current, ev.clientX, ev.clientY, id);
      setTbDrag({ id, x: ev.clientX, y: ev.clientY, target });
      // Live-detach the toolbar to a floating position so it follows the
      // cursor — same UX as the floating panel header drag. If the cursor is
      // back in an edge zone, the toolbar still floats during the drag and
      // only commits to that dock on pointerup.
      if (target.side === "float") {
        // If the toolbar was previously a docked col, peel it out so it can
        // float freely.
        setLayout(L => { if (!snapLayout) snapLayout = L; return removeTbColImmutable(L, id); });
        setTbLayout(L => {
          if (!snapTb) snapTb = L;
          const next = stripTbId(L, id);
          next.float.push({ id, x: (target.x ?? 0) - 80, y: (target.y ?? 0) - 14 });
          return next;
        });
      }
    };
    const up = (ev: PointerEvent) => {
      if (started) {
        const target = tbHitTest(bodyRef.current, ev.clientX, ev.clientY, id);
        // Toolbar may currently live in either tbLayout (edge/float) or
        // inside layout.cols (docked between panel cols). Strip it from both
        // before placing it in its final position.
        setLayout(L => { if (!snapLayout) snapLayout = L; return removeTbColImmutable(L, id); });
        if (target.kind === "in-dock") {
          setLayout(L => insertTbColImmutable(L, id, target));
          // Make sure tbLayout doesn't keep a stale ghost copy.
          setTbLayout(L => { if (!snapTb) snapTb = L; return stripTbId(L, id); });
        } else {
          setTbLayout(L => { if (!snapTb) snapTb = L; return tbMoveImmutable(L, id, target); });
        }
      }
      setTbDrag(null);
    };
    // Escape restores both trees to their pre-drag snapshots (if any mutation
    // had occurred) and clears the drag preview.
    const onCancel = () => {
      if (snapLayout) setLayout(snapLayout);
      if (snapTb) setTbLayout(snapTb);
      setTbDrag(null);
    };
    beginPointerSession({ move, up, onCancel });
  }, []);

  const tbSnap = tbDrag && tbDrag.target.side !== "float"
    ? tbSnapRect(bodyRef.current, tbDrag.target) : null;

  // helper to render one toolbar by id
  const renderTB = (id: string, orientation: ToolbarOrientation, opts: { isFloat?: boolean; x?: number; y?: number } = {}) => {
    const def = toolbarDefs[id];
    if (!def) return null;
    // Some toolbars (e.g. the options bar) only make sense laid out horizontally.
    // Keep them horizontal in any slot; the vertical slot sizes to fit the row.
    const orient = def.horizontalOnly ? "h" : orientation;
    const isDragging = tbDrag?.id === id;
    return (
      <Toolbar key={id} id={id} orientation={orient} accent={accent}
               isDragging={isDragging} isFloat={opts.isFloat} x={opts.x} y={opts.y}
               onGripDown={onTbGripDown}>
        {def.render(orient)}
      </Toolbar>
    );
  };

  // Render one edge's toolbar lanes. Top/bottom: lanes are horizontal rows
  // stacked vertically. Left/right: lanes are vertical columns side by side.
  const renderTbEdge = (side: DockSideName) => {
    const lanes = tbLayout[side];
    if (!lanes.length) return null;
    const isH = side === "top" || side === "bottom";
    return (
      <div className={`monet-tb-lanes monet-tb-lanes--${isH ? "h" : "v"}`} data-tb-side={side}>
        {lanes.map((lane, li) => (
          <div key={li} className={`monet-tb-strip monet-tb-strip--${isH ? "h" : "v"}`}
               data-tb-side={side} data-tb-lane={li}>
            {lane.map(id => renderTB(id, isH ? "h" : "v"))}
          </div>
        ))}
      </div>
    );
  };

  const windowEl = (
    <div className={`monet-window monet-window--${platform} ${useNativeFrame ? "monet-window--native-frame" : "monet-window--bare"}`} ref={hostRef} style={{ "--accent": accent } as React.CSSProperties}>
      <Titlebar title={title} app={app} appPanel={appPanel} docs={docs} activeDoc={activeDoc} onDocSelect={onDocSelect} onDocClose={onDocClose} onDocReorder={onDocReorder} accent={accent} platform={platform} menus={menus} controls={controls} drag nativeFrame={useNativeFrame} />
      <div className="monet-body" ref={bodyRef}>
        {iconRailLeft}
        {renderTbEdge("left")}
        {layout.left && <DDock revision={layoutRevision} flyoutRequest={flyoutRequest} autoCollapse={autoCollapseFlyouts} side="left" dock={layout.left} panels={panels} accent={accent} onCollapse={onCollapseDock}
                                onActivate={onActivate} onClose={onCloseTab} onDragTab={onDragTab}
                                onResizeDock={onResizeDock} onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}
                                renderTbCol={renderTB}/>}
        <div style={{flex:1, display:"flex", flexDirection:"column", minWidth:0, minHeight:0}}>
          {renderTbEdge("top")}
          {layout.top && <DDock revision={layoutRevision} flyoutRequest={flyoutRequest} autoCollapse={autoCollapseFlyouts} side="top" dock={layout.top} panels={panels} accent={accent} onCollapse={onCollapseDock}
                                onActivate={onActivate} onClose={onCloseTab} onDragTab={onDragTab}
                                onResizeDock={onResizeDock} onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}
                                renderTbCol={renderTB}/>}
          {canvas}
          {layout.bottom && <DDock revision={layoutRevision} flyoutRequest={flyoutRequest} autoCollapse={autoCollapseFlyouts} side="bottom" dock={layout.bottom} panels={panels} accent={accent} onCollapse={onCollapseDock}
                                    onActivate={onActivate} onClose={onCloseTab} onDragTab={onDragTab}
                                    onResizeDock={onResizeDock} onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}
                                    renderTbCol={renderTB}/>}
          {renderTbEdge("bottom")}
        </div>
        {layout.right && <DDock revision={layoutRevision} flyoutRequest={flyoutRequest} autoCollapse={autoCollapseFlyouts} side="right" dock={layout.right} panels={panels} accent={accent} onCollapse={onCollapseDock}
                                  onActivate={onActivate} onClose={onCloseTab} onDragTab={onDragTab}
                                  onResizeDock={onResizeDock} onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}
                                  renderTbCol={renderTB}/>}
        {renderTbEdge("right")}
        {iconRail}

        {/* floating mini-docks */}
        {layout.floating.map(f => (
          <DFloat key={f.id} f={f} panels={panels} accent={accent}
                  onActivate={onActivate}
                  onClose={onCloseTab}
                  onDragTab={onDragTab}
                  onResizeGroup={onResizeGroup}
                  onResizeCol={onResizeCol}
                  onDragHeader={onDragHeader}
                  onCloseFloat={onCloseFloat}
                  onResize={onResizeFloat}/>
        ))}

        {/* floating toolbars */}
        {tbLayout.float.map(f => renderTB(f.id, "h", { isFloat: true, x: f.x, y: f.y }))}

        {/* panel snap visualization */}
        {drag && <EdgeHints rootEl={bodyRef.current} target={drag.target} accent={accent}/>}
        {drag && <DragSnap rect={snapRect} label={snapText} accent={accent} bounds={bodyRef.current ? {w: bodyRef.current.offsetWidth, h: bodyRef.current.offsetHeight} : null}/>}
        {drag && <DockWidget wg={computeDockWidget(bodyRef.current, drag.target)} accent={accent}/>}
        {drag && drag.kind === "tab" && <DragGhost drag={drag} panels={panels} originRect={bodyRef.current?.getBoundingClientRect()} scale={(bodyRef.current ? (bodyRef.current.getBoundingClientRect().width / bodyRef.current.offsetWidth) : 1) || 1}/>}

        {/* toolbar snap visualization */}
        {tbDrag && <DragSnap rect={tbSnap} bounds={bodyRef.current ? {w: bodyRef.current.offsetWidth, h: bodyRef.current.offsetHeight} : null} label={
          tbDrag.target.side === "float" ? "Float"
            : typeof tbDrag.target.newLane === "number"
              ? ((tbDrag.target.side === "top" || tbDrag.target.side === "bottom") ? "New row" : "New column")
              : `Dock ${tbDrag.target.side}`
        } accent={accent}/>}
      </div>
      {statusBar}
    </div>
  );
  return windowEl;
});

// Public surface: the component + the relocatable Toolbar primitive only. The
// layout algebra (applyDrop / hitTest / normLayout / findGroupById / …) is now
// internal to the engine and lives in dockable-core; the public TYPES are
// exported via the interface declarations + the `export type` re-export above.
export {
  DockableWorkspace, Toolbar,
};
