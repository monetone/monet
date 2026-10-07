// ─────────────────────────────────────────────────────────────
// Dockable workspace — presentational view layer
// ─────────────────────────────────────────────────────────────
// The React renderers + shared pointer/keyboard interaction helpers for the
// dockable engine. These are split out of dockable.tsx purely to keep each file
// under the project's per-file LOC budget; they are internal to the engine
// (consumed only by dockable.tsx, which re-exports just the public component).
// The pure layout algebra + DOM-measurement helpers live in dockable-core.

import React, { useEffect, useId, useReducer, useRef, useState } from "react";
import { Icon, I } from "./icons";
import { beginPointerSession } from "./internal";
export { beginPointerSession } from "./internal";
import {
  tabId2El, panelId2El, findInCols,
  DOCK_CELL, DOCK_GAP,
} from "./dockable-core";

// ─── accessibility / motion helpers ─────────────────────────
// Any JS-driven animation in this file must respect the user's reduced-motion
// preference (CSS transitions are handled by the CSS track). Guarded so it is
// safe in non-DOM / SSR contexts.
export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}

// Keyboard resize step (fraction of a flex unit per Arrow press; Shift = ×4).
export const KB_FLEX_STEP = 0.06;
// Keyboard resize step for outer dock size (px per Arrow press; Shift = ×4).
export const KB_DOCK_STEP = 16;

// The 5-button directional dock widget — center=stack, n/s/e/w=split.
const DOCK_GLYPH: Record<string, string> = {
  center: "M5 5h8v8H5z",
  n: "M9 5l4 5H5z", s: "M9 13l-4-5h8z",
  w: "M5 9l5-4v8z", e: "M13 9l-5 4V5z",
};
export function DockWidget({ wg, accent }: any) {
  if (!wg) return null;
  const off = DOCK_CELL + DOCK_GAP;
  const defs: [string, number, number][] = [["center", 0, 0], ["n", 0, -1], ["s", 0, 1], ["w", -1, 0], ["e", 1, 0]];
  return (
    <div className="monet-dockwidget" aria-hidden="true" style={{ left: wg.cx, top: wg.cy }}>
      {defs.map(([dir, dx, dy]) => {
        const active = wg.active === dir;
        return (
          <div key={dir}
               className={`monet-dw-cell ${active ? "is-active" : ""}`}
               style={{
                 left: dx * off - DOCK_CELL / 2,
                 top: dy * off - DOCK_CELL / 2,
                 width: DOCK_CELL, height: DOCK_CELL,
                 "--accent": accent,
               } as React.CSSProperties}>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d={DOCK_GLYPH[dir]} fill="currentColor"/>
            </svg>
          </div>
        );
      })}
    </div>
  );
}

// Always-on edge strips during a drag — show where whole-side docks land.
// Only render a strip for a side that has no dock yet (an occupied edge
// splits inside the existing dock instead of creating a new one).
export function EdgeHints({ rootEl, target, accent }: any) {
  if (!rootEl) return null;
  const hasDock = (s: string) => !!rootEl.querySelector(`.monet-dock--${s}`);
  const isDock = (s: string) => target && target.kind === "new-dock" && target.side === s;
  const strip = (s: string, style: React.CSSProperties) => hasDock(s) ? null : (
    <div key={s} aria-hidden="true" className={`monet-edgehint ${isDock(s) ? "is-active" : ""}`}
         style={{ ...style, "--accent": accent } as React.CSSProperties}/>
  );
  return (
    <>
      {strip("left",   { left: 3, top: 3, bottom: 3, width: 7 })}
      {strip("right",  { right: 3, top: 3, bottom: 3, width: 7 })}
      {strip("top",    { left: 3, right: 3, top: 3, height: 7 })}
      {strip("bottom", { left: 3, right: 3, bottom: 3, height: 7 })}
    </>
  );
}

// ─── keyboard-operable splitter ─────────────────────────────
// Wraps the existing .monet-split handle so it is reachable by Tab and operable
// with the keyboard (WAI-ARIA window-splitter pattern): role=separator with an
// orientation and, where the value is meaningful, aria-valuenow/min/max. Arrow
// keys nudge by a step (Shift = larger), Home/End jump to min/max. Pointer drag
// is untouched — onPointerDown is forwarded verbatim.
//   orientation: "vertical"   → handle separates left/right (drag horizontally)
//                "horizontal" → handle separates top/bottom (drag vertically)
// `onStep(delta, big)` receives -1 / +1 and whether Shift was held; `onMinMax`
// receives "min" | "max". Both are optional (a fixed/unsizable handle just gets
// role=separator with no value + no key handling).
function Splitter({ orientation, className, style, onPointerDown, onStep, onMinMax,
                    valueNow, valueMin, valueMax, ariaLabel, disabled }: any) {
  const operable = !disabled && (onStep || onMinMax);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!operable) return;
    const big = e.shiftKey;
    // For a vertical separator, Left/Right move it; for horizontal, Up/Down.
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); onStep?.(-1, big); }
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); onStep?.(1, big); }
    else if (e.key === "Home") { e.preventDefault(); onMinMax?.("min"); }
    else if (e.key === "End") { e.preventDefault(); onMinMax?.("max"); }
  };
  const hasValue = typeof valueNow === "number";
  return (
    <div className={className}
         style={style}
         role="separator"
         data-monet-focusable={operable ? "" : undefined}
         aria-orientation={orientation}
         aria-label={ariaLabel}
         aria-valuenow={hasValue ? Math.round(valueNow) : undefined}
         aria-valuemin={hasValue && typeof valueMin === "number" ? Math.round(valueMin) : undefined}
         aria-valuemax={hasValue && typeof valueMax === "number" ? Math.round(valueMax) : undefined}
         tabIndex={operable ? 0 : undefined}
         aria-disabled={disabled ? true : undefined}
         onPointerDown={onPointerDown}
         onKeyDown={onKeyDown}/>
  );
}

// ─── tab strip ──────────────────────────────────────────────
// Implements the WAI-ARIA tabs pattern (role=tablist / tab, aria-selected,
// roving tabindex). This mirrors the role conventions the primitives-track
// static TabStrip uses so docked + static tabs read identically to AT. Each
// tab id is stable, so its tabpanel can target it via `monet-tabpanel-<id>`
// (tabId2El / panelId2El are imported from dockable-core).

function DTabStrip({ group, side, groupIdx, panels, onActivate, onClose, onDragTab }: any) {
  // Activate (and focus) a tab by index — shared by Arrow / Home / End. Matches
  // the click/pointer activation path exactly.
  const activateAt = (el: HTMLElement, i: number) => {
    const list = group.tabs;
    if (i < 0 || i >= list.length) return;
    onActivate(list[i]);
    // Move DOM focus to the newly-selected tab (roving tabindex).
    const next = el.parentElement?.querySelector<HTMLElement>(`#${CSS.escape(tabId2El(list[i]))}`);
    next?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const list = group.tabs;
    const el = e.currentTarget as HTMLElement;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault(); activateAt(el, (i + 1) % list.length);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault(); activateAt(el, (i - 1 + list.length) % list.length);
    } else if (e.key === "Home") {
      e.preventDefault(); activateAt(el, 0);
    } else if (e.key === "End") {
      e.preventDefault(); activateAt(el, list.length - 1);
    }
  };
  return (
    <div className="monet-tabs" role="tablist" aria-orientation="horizontal">
      {group.tabs.map((tabId: string, i: number) => {
        const meta = panels[tabId];
        const selected = group.active === tabId;
        return (
          <span key={tabId}
                id={tabId2El(tabId)}
                role="tab"
                tabIndex={selected ? 0 : -1}
                aria-selected={selected}
                aria-controls={panelId2El(tabId)}
                data-dock-tab
                data-tab-id={tabId}
                className={`monet-tab ${selected ? "is-active" : ""}`}
                onKeyDown={(e) => onKeyDown(e, i)}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  // first activate on press, then arm drag
                  onActivate(tabId);
                  onDragTab(tabId, side, groupIdx, e);
                }}>
            {meta?.title || tabId}
          </span>
        );
      })}
      <div className="monet-tab-actions" role="presentation">
        <span className="btn" title="Close"
              role="button" tabIndex={0} aria-label="Close panel" data-monet-focusable
              onClick={() => onClose(group.active)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClose(group.active); } }}>
          <Icon d={I.close} size={11}/>
        </span>
      </div>
    </div>
  );
}

// ─── group renderer ─────────────────────────────────────────
function DGroup({ group, side, cont, colIdx, colId, groupIdx, panels, accent, height, onActivate, onClose, onDragTab }: any) {
  const meta = panels[group.active];
  return (
    <div className="monet-panel"
         data-dock-group
         data-side={side}
         data-col-idx={colIdx}
         data-col-id={colId}
         data-g-idx={groupIdx}
         data-g-id={group.id}
         style={{ height: height ?? undefined, minHeight: 0, flex: height ? "0 0 auto" : 1 }}>
      <DTabStrip
        group={group}
        side={side}
        groupIdx={groupIdx}
        panels={panels}
        accent={accent}
        onActivate={(t: string) => onActivate(cont, colIdx, groupIdx, t)}
        onClose={(t: string) => onClose(cont, colIdx, groupIdx, t)}
        onDragTab={onDragTab}
      />
      <div className={`monet-panel-body ${meta?.flush ? "is-flush" : ""}`}
           role="tabpanel"
           id={group.active ? panelId2El(group.active) : undefined}
           aria-labelledby={group.active ? tabId2El(group.active) : undefined}
           tabIndex={0}>
        {meta ? meta.render() : <div style={{color:"var(--text-3)", fontSize:11, padding:10}}>Empty panel</div>}
      </div>
    </div>
  );
}

// ─── stack of groups inside a single column ─────────────────
// For left/right/float, the stack is vertical; for bottom, horizontal.
function DStack({ side, cont, colIdx, col, panels, accent, onActivate, onClose, onDragTab, onResizeGroup }: any) {
  const isH = side === "bottom" || side === "top";
  const ref = useRef<any>(null);
  // Clamp + commit a resize between groups i / i+1 given their target a flex.
  const commit = (i: number, a0: number, b0: number, na: number) => {
    const total = a0 + b0;
    na = Math.max(0.15, Math.min(total - 0.15, na));
    onResizeGroup(cont, colIdx, i, na, total - na);
  };
  const startResize = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const rect = ref.current.getBoundingClientRect();
    const dim = isH ? rect.width : rect.height;
    const start = isH ? e.clientX : e.clientY;
    const a0 = col.stack[i].flex, b0 = col.stack[i+1].flex;
    const sum = col.stack.reduce((s: number, g: any) => s + g.flex, 0);
    const onMove = (ev: PointerEvent) => {
      const d = (isH ? ev.clientX : ev.clientY) - start;
      commit(i, a0, b0, a0 + (d / dim) * sum);
    };
    const up = () => {};
    // Escape restores the pre-drag flexes.
    const onCancel = () => onResizeGroup(cont, colIdx, i, a0, b0);
    beginPointerSession({ move: onMove, up, onCancel, cursor: isH ? "col-resize" : "row-resize" });
  };
  // Keyboard: nudge the boundary by a flex step (Shift = ×4), Home/End to min/max.
  const onStep = (i: number) => (dir: number, big: boolean) => {
    const a0 = col.stack[i].flex, b0 = col.stack[i+1].flex;
    commit(i, a0, b0, a0 + dir * KB_FLEX_STEP * (big ? 4 : 1));
  };
  const onMinMax = (i: number) => (which: "min" | "max") => {
    const a0 = col.stack[i].flex, b0 = col.stack[i+1].flex;
    commit(i, a0, b0, which === "min" ? 0 : a0 + b0);
  };
  return (
    <div ref={ref}
         data-dock-col
         data-side={side}
         data-col-idx={colIdx}
         data-col-id={col.id}
         style={{ display:"flex", flexDirection: isH ? "row" : "column", flex:1, minHeight:0, minWidth:0 }}>
      {col.stack.map((g: any, i: number) => (
        <React.Fragment key={g.id}>
          <div style={{ flex: g.flex, minWidth:0, minHeight:0, display:"flex", flexDirection:"column" }}>
            <DGroup group={g} side={side} cont={cont} colIdx={colIdx} colId={col.id} groupIdx={i} panels={panels} accent={accent}
                    onActivate={onActivate} onClose={onClose} onDragTab={onDragTab}/>
          </div>
          {i < col.stack.length - 1 && (
            <Splitter className={`monet-split ${isH ? "" : "is-h"}`}
                      // groups stacked along this axis: horizontal stack → vertical separator.
                      orientation={isH ? "vertical" : "horizontal"}
                      ariaLabel="Resize panels"
                      valueNow={Math.round(g.flex / (g.flex + col.stack[i+1].flex) * 100)}
                      valueMin={0} valueMax={100}
                      onStep={onStep(i)} onMinMax={onMinMax(i)}
                      onPointerDown={startResize(i)} style={{"--accent": accent}}/>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── columns layout — places columns across the cross-axis of a container ───
function DColumns({ side, cont, cols, panels, accent, onActivate, onClose, onDragTab, onResizeGroup, onResizeCol, renderTbCol }: any) {
  // Bottom & top docks: cols stack vertically (cross-axis is vertical).
  // Left/right docks + floats: cols stack horizontally.
  const colsVertical = side === "bottom" || side === "top";
  const ref = useRef<any>(null);
  const resizable = (i: number) => cols[i]?.kind === "panel" && cols[i+1]?.kind === "panel";
  const commit = (i: number, a0: number, b0: number, na: number) => {
    const total = a0 + b0;
    na = Math.max(0.15, Math.min(total - 0.15, na));
    onResizeCol(cont, i, na, total - na);
  };
  const startResize = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    // Only resize between two flexible (panel) cols.
    if (!resizable(i)) return;
    const rect = ref.current.getBoundingClientRect();
    const dim = colsVertical ? rect.height : rect.width;
    const start = colsVertical ? e.clientY : e.clientX;
    const a0 = cols[i].flex, b0 = cols[i+1].flex;
    const panelSum = cols.filter((c: any) => c.kind === "panel").reduce((s: number, c: any) => s + c.flex, 0);
    const onMove = (ev: PointerEvent) => {
      const d = (colsVertical ? ev.clientY : ev.clientX) - start;
      commit(i, a0, b0, a0 + (d / dim) * panelSum);
    };
    const up = () => {};
    const onCancel = () => onResizeCol(cont, i, a0, b0);
    beginPointerSession({ move: onMove, up, onCancel, cursor: colsVertical ? "row-resize" : "col-resize" });
  };
  const onStep = (i: number) => (dir: number, big: boolean) => {
    if (!resizable(i)) return;
    const a0 = cols[i].flex, b0 = cols[i+1].flex;
    commit(i, a0, b0, a0 + dir * KB_FLEX_STEP * (big ? 4 : 1));
  };
  const onMinMax = (i: number) => (which: "min" | "max") => {
    if (!resizable(i)) return;
    const a0 = cols[i].flex, b0 = cols[i+1].flex;
    commit(i, a0, b0, which === "min" ? 0 : a0 + b0);
  };
  const tbOrient = colsVertical ? "h" : "v";
  return (
    <div ref={ref} style={{
      display:"flex",
      flexDirection: colsVertical ? "column" : "row",
      flex:1, minHeight:0, minWidth:0,
    }}>
      {cols.map((col: any, i: number) => (
        <React.Fragment key={col.id}>
          {col.kind === "tb" ? (
            <div data-dock-col data-dock-col-kind="tb" data-side={side} data-col-idx={i} data-col-id={col.id}
                 style={{ flex:"0 0 auto", display:"flex", flexDirection:"column", minHeight:0, minWidth:0 }}>
              {renderTbCol ? renderTbCol(col.tbId, tbOrient) : null}
            </div>
          ) : (
            <div style={{ flex: col.flex, minWidth:0, minHeight:0, display:"flex", flexDirection:"column" }}>
              <DStack side={side} cont={cont} colIdx={i} col={col} panels={panels} accent={accent}
                      onActivate={onActivate} onClose={onClose} onDragTab={onDragTab}
                      onResizeGroup={onResizeGroup}/>
            </div>
          )}
          {i < cols.length - 1 && (
            <Splitter className={`monet-split ${colsVertical ? "is-h" : ""} ${!resizable(i) ? "is-fixed" : ""}`}
                      // cols laid across this axis: horizontal cols → vertical separator.
                      orientation={colsVertical ? "horizontal" : "vertical"}
                      ariaLabel="Resize columns"
                      disabled={!resizable(i)}
                      valueNow={resizable(i) ? Math.round(cols[i].flex / (cols[i].flex + cols[i+1].flex) * 100) : undefined}
                      valueMin={0} valueMax={100}
                      onStep={onStep(i)} onMinMax={onMinMax(i)}
                      onPointerDown={startResize(i)}
                      style={{"--accent": accent}}/>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── dock wrapper (handles outer size + outer splitter) ─────
export function DDock({ side, dock, panels, accent, onActivate, onClose, onDragTab, onResizeDock, onResizeGroup, onResizeCol, renderTbCol, onCollapse, revision, flyoutRequest, autoCollapse = true }: any) {
  const isV = side === "bottom" || side === "top";
  const collapsed = dock.collapsed === true;
  const [flyoutTab, setFlyoutTab] = useState<string | null>(null);
  const [, relayout] = useReducer((n: number) => n + 1, 0);
  const dockRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const insidePointer = useRef<PointerEvent | null>(null);
  const seenRequest = useRef(flyoutRequest);
  const flyoutId = useId();
  const location = flyoutTab ? findInCols(dock.cols, flyoutTab) : null;
  const flyout = collapsed && location ? { ...location, group: dock.cols[location.colIdx].stack[location.groupIdx] } : null;
  const hasPanels = dock.cols.some((c: any) => c.kind === "panel");
  // The rail is persistent; its open panel is transient. Workspace replacement,
  // expansion or removing/undocking its last tab dismisses the temporary view.
  useEffect(() => { setFlyoutTab(null); }, [collapsed, revision]);
  useEffect(() => {
    if (!flyoutTab || location) return;
    setFlyoutTab(null);
  }, [flyoutTab, location]);
  // openPanel() on a panel iconified in this rail springs it out, the way
  // Window ▸ <panel> does in Photoshop, instead of expanding the whole dock.
  // A request that predates this dock's mount is not ours to replay.
  useEffect(() => {
    if (flyoutRequest === seenRequest.current) return;
    seenRequest.current = flyoutRequest;
    const id = flyoutRequest?.id;
    if (!collapsed || !id || !findInCols(dock.cols, id)) return;
    triggerRef.current = dockRef.current?.querySelector<HTMLButtonElement>(`[data-rail-tab="${CSS.escape(id)}"]`) ?? null;
    setFlyoutTab(id);
  }, [flyoutRequest]);
  useEffect(() => {
    if (!flyout) return;
    flyoutRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    window.addEventListener("resize", relayout);
    const outside = (event: PointerEvent) => {
      // Listen in the capture phase: canvas controls stop pointerdown before it
      // bubbles to document. Decide once the dispatch is over, because React's
      // capture pass, which also sees portal children (Select menus, color
      // pickers) whose DOM lives outside this dock but still belongs to its
      // panel, runs after document capture.
      setTimeout(() => {
        if (insidePointer.current !== event && !dockRef.current?.contains(event.target as Node)) {
          if (flyoutRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
          setFlyoutTab(null);
        }
      });
    };
    // Without auto-collapse the panel stays out until its rail icon or Escape
    // puts it away.
    if (autoCollapse) document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("resize", relayout);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [flyoutTab, !!flyout, autoCollapse]);
  // The flyout opens at the dock's expanded size, but never past the far edge
  // of the workspace: a 900px dock collapsed in a narrow window would otherwise
  // spring its panel out beyond the window. `dock.size` is body-local px, so the
  // screen-px room is divided by the .monet-body scale like every other measure.
  const flyoutSize = () => {
    const body = dockRef.current?.closest(".monet-body") as HTMLElement | null;
    if (!dockRef.current || !body) return dock.size;
    const d = dockRef.current.getBoundingClientRect(), b = body.getBoundingClientRect();
    if (!b.width && !b.height) return dock.size;   // not laid out (SSR / jsdom)
    const scale = (body.offsetWidth > 0 ? b.width / body.offsetWidth : 1) || 1;
    const room = side === "left" ? b.right - d.right : side === "right" ? d.left - b.left
      : side === "top" ? b.bottom - d.bottom : d.top - b.top;
    return Math.max(0, Math.min(dock.size, room / scale));
  };
  const dismiss = () => { setFlyoutTab(null); triggerRef.current?.focus(); };
  const toggle = () => { setFlyoutTab(null); onCollapse?.(side, !collapsed); };
  const DOCK_MIN = 140, DOCK_MAX = 900;
  const clampSize = (n: number) => Math.max(DOCK_MIN, Math.min(DOCK_MAX, n));
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const start = isV ? e.clientY : e.clientX;
    const s0 = dock.size;
    // (#179) `dock.size` is a body-local (pre-transform) px value, the pointer
    // delta is screen px. Inside a scaled parent (design-canvas zoom) the dock
    // edge drifted away from the cursor for the whole drag — convert the delta
    // through the .monet-body scale, exactly like DFloat's resize below.
    const rootEl = (e.currentTarget as HTMLElement).closest(".monet-body") as HTMLElement | null;
    const scale = (rootEl && rootEl.offsetWidth > 0
      ? rootEl.getBoundingClientRect().width / rootEl.offsetWidth : 1) || 1;
    const move = (ev: PointerEvent) => {
      const d = ((isV ? ev.clientY : ev.clientX) - start) / scale;
      // The splitter sits on the dock's inner edge: left & top docks grow as it
      // moves toward the far edge (s0 + d); right & bottom grow as it moves back.
      const next = (side === "left" || side === "top") ? s0 + d : s0 - d;
      onResizeDock(side, clampSize(next));
    };
    const up = () => {};
    const onCancel = () => onResizeDock(side, s0);   // Escape restores pre-drag size.
    beginPointerSession({ move, up, onCancel, cursor: isV ? "row-resize" : "col-resize" });
  };
  // Keyboard: Arrow keys grow/shrink the dock by a px step (Shift = ×4), Home/End
  // to min/max. "grow" is whichever Arrow points away from the dock's edge.
  const grows = (side === "left" || side === "top") ? 1 : -1;  // direction the size increases
  const onStep = (dir: number, big: boolean) => {
    onResizeDock(side, clampSize(dock.size + dir * grows * KB_DOCK_STEP * (big ? 4 : 1)));
  };
  const onMinMax = (which: "min" | "max") => onResizeDock(side, which === "min" ? DOCK_MIN : DOCK_MAX);
  const size = collapsed ? 36 : dock.size;
  const style = isV ? { height: size, flex:`0 0 ${size}px` }
                    : { width: size, flex:`0 0 ${size}px` };
  const handle = (
    <Splitter className={`monet-split ${isV ? "is-h" : ""}`}
              orientation={isV ? "horizontal" : "vertical"}
              ariaLabel={`Resize ${side} dock`}
              valueNow={dock.size} valueMin={DOCK_MIN} valueMax={DOCK_MAX}
              onStep={onStep} onMinMax={onMinMax}
              onPointerDown={onDown} style={{"--accent": accent}}/>
  );
  return (
    <>
      {!collapsed && (side === "right" || side === "bottom") && handle}
      <div ref={dockRef} className={`monet-dock monet-dock--${side}${collapsed ? " is-collapsed" : ""}`} style={style}
           onPointerDownCapture={(e) => { insidePointer.current = e.nativeEvent; }}
           role="region" aria-label={`${side} dock`}>
        {hasPanels && onCollapse && <div className="monet-dock-header" onDoubleClick={toggle}>
          <button type="button" className="monet-iconbtn monet-dock-collapse"
                  aria-label={`${collapsed ? "Expand" : "Collapse"} ${side} dock`} aria-expanded={!collapsed}
                  title={`${collapsed ? "Expand" : "Collapse"} ${side} dock`}
                  onClick={(e) => { if (e.detail < 2) toggle(); }} onDoubleClick={(e) => e.stopPropagation()}>
            <span aria-hidden="true">{(side === "left" || side === "top") !== collapsed ? "«" : "»"}</span>
          </button>
        </div>}
        {collapsed ? <>
          <div className="monet-dock-rail" aria-label={`${side} panels`}>
            {dock.cols.map((col: any, colIdx: number) => col.kind === "tb"
              ? <React.Fragment key={col.id}>{renderTbCol?.(col.tbId, isV ? "h" : "v")}</React.Fragment>
              : <div className="monet-dock-rail-group" key={col.id}>
                  {col.stack.flatMap((group: any, groupIdx: number) => group.tabs.map((id: string) => {
                    const meta = panels?.[id];
                    const label = typeof meta?.title === "string" ? meta.title : id;
                    return <button type="button" key={id} className={`monet-iconbtn${flyoutTab === id ? " is-active" : ""}`}
                      data-rail-tab={id} data-g-id={group.id} aria-label={label} title={label} aria-expanded={flyoutTab === id} aria-controls={flyoutTab === id ? flyoutId : undefined}
                      onClick={(e) => {
                        triggerRef.current = e.currentTarget;
                        setFlyoutTab(flyoutTab === id ? null : id);
                        if (flyoutTab !== id) onActivate({ side }, colIdx, groupIdx, id);
                      }}>
                      <span aria-hidden="true">{meta?.icon ?? <Icon d={I.gradient}/>}</span>
                    </button>;
                  }))}
                </div>)}
          </div>
          {flyout && <div ref={flyoutRef} id={flyoutId} className="monet-float monet-dock-flyout"
            role="dialog" aria-label={`${typeof panels?.[flyoutTab!]?.title === "string" ? panels[flyoutTab!].title : flyoutTab} panel`}
            style={isV ? { height: flyoutSize() } : { width: flyoutSize() }}
            onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); dismiss(); } }}>
            <DGroup group={{ ...flyout.group, active: flyoutTab }} side={side} cont={{ side }}
              colIdx={flyout.colIdx} colId={dock.cols[flyout.colIdx].id} groupIdx={flyout.groupIdx} panels={panels} accent={accent}
              onActivate={(cont: any, ci: number, gi: number, id: string) => { onActivate(cont, ci, gi, id); setFlyoutTab(id); }}
              onClose={(cont: any, ci: number, gi: number, id: string) => { onClose(cont, ci, gi, id); dismiss(); }} onDragTab={onDragTab}/>
          </div>}
        </> : <DColumns side={side} cont={{ side }} cols={dock.cols} panels={panels} accent={accent}
                  onActivate={onActivate} onClose={onClose} onDragTab={onDragTab}
                  onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}
                  renderTbCol={renderTbCol}/>}
      </div>
      {!collapsed && (side === "left" || side === "top") && handle}
    </>
  );
}

// ─── floating panel — a free-positioned mini-dock ──────────
export function DFloat({ f, panels, accent, onActivate, onClose, onDragTab, onDragHeader, onCloseFloat, onResize, onResizeGroup, onResizeCol }: any) {
  const headerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-float-close]")) return;
    onDragHeader(f.id, e);
  };
  const resizeDown = (corner: string) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const { x, y, w, h } = f;
    // Floats live inside .monet-body which may be scaled by the design-canvas zoom.
    // Convert screen-pixel pointer deltas to body-local pixels so resize tracks
    // the cursor at every zoom level.
    const floatEl = e.currentTarget.closest("[data-float-id]");
    const rootEl = floatEl?.parentElement;
    const scale = (rootEl && rootEl.offsetWidth > 0
      ? rootEl.getBoundingClientRect().width / rootEl.offsetWidth : 1) || 1;
    const move = (ev: PointerEvent) => {
      let nx = x, ny = y, nw = w, nh = h;
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      if (corner.includes("e")) nw = Math.max(200, w + dx);
      if (corner.includes("s")) nh = Math.max(140, h + dy);
      if (corner.includes("w")) { nw = Math.max(200, w - dx); nx = x + (w - nw); }
      if (corner.includes("n")) { nh = Math.max(140, h - dy); ny = y + (h - nh); }
      onResize(f.id, { x: nx, y: ny, w: nw, h: nh });
    };
    const up = () => {};
    const onCancel = () => onResize(f.id, { x, y, w, h });   // Escape restores geometry.
    beginPointerSession({ move, up, onCancel });
  };
  // Escape closes the float from its OWN chrome — the move-bar grip or the float
  // root, the two things this component makes focusable. It must not fire for
  // panel content: a float wraps arbitrary app UI, and Escape inside a search
  // field or a colour input is the app's to handle, not a request to delete the
  // whole panel out of the layout.
  const onFloatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (e.defaultPrevented) return;   // a drag session already handled it
    const target = e.target as HTMLElement;
    if (target !== e.currentTarget && !target.closest(".monet-float-bar")) return;
    e.stopPropagation();
    onCloseFloat(f.id);
  };
  return (
    <div className="monet-float" data-float-id={f.id}
         role="dialog" aria-label="Floating panel" tabIndex={-1}
         onKeyDown={onFloatKeyDown}
         style={{ left:f.x, top:f.y, width:f.w, height:f.h, "--accent": accent } as React.CSSProperties}>
      <div className="monet-float-bar" onPointerDown={headerDown} title="Drag to move" tabIndex={0}
           role="button" aria-label="Move floating panel (drag, or Escape to close)" data-monet-focusable>
        <span className="monet-float-grip"><Icon d="M3 5h12 M3 8h12 M3 11h12" size={12}/></span>
        <span style={{flex:1}}/>
        <span data-float-close className="monet-iconbtn" style={{width:18, height:18}}
              role="button" tabIndex={0} aria-label="Close floating panel" data-monet-focusable
              onClick={() => onCloseFloat(f.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCloseFloat(f.id); } }}>
          <Icon d={I.close} size={10}/>
        </span>
      </div>
      <div className="monet-float-cols" style={{flex:1, minHeight:0, minWidth:0, display:"flex"}}>
        <DColumns side="float" cont={{ floatId: f.id }} cols={f.cols} panels={panels} accent={accent}
                  onActivate={onActivate} onClose={onClose} onDragTab={onDragTab}
                  onResizeGroup={onResizeGroup} onResizeCol={onResizeCol}/>
      </div>
      {/* resize grips — pointer-only affordances (keyboard sizing lives on the
          dock splitters); hidden from AT so they don't add empty stops. */}
      <div aria-hidden="true" style={{position:"absolute", right:0, bottom:0, width:14, height:14, cursor:"se-resize"}} onPointerDown={resizeDown("se")}/>
      <div aria-hidden="true" style={{position:"absolute", right:0, top:8, bottom:14, width:5, cursor:"e-resize"}} onPointerDown={resizeDown("e")}/>
      <div aria-hidden="true" style={{position:"absolute", left:8, right:14, bottom:0, height:5, cursor:"s-resize"}} onPointerDown={resizeDown("s")}/>
      <div aria-hidden="true" style={{position:"absolute", left:0, top:8, bottom:14, width:5, cursor:"w-resize"}} onPointerDown={resizeDown("w")}/>
    </div>
  );
}

// ─── drag ghost ─────────────────────────────────────────────
export function DragGhost({ drag, panels, originRect, scale = 1 }: any) {
  if (!drag) return null;
  const meta = panels[drag.tabId];
  const ox = originRect ? originRect.left : 0;
  const oy = originRect ? originRect.top : 0;
  return (
    <div aria-hidden="true" style={{
      position:"absolute",
      left: (drag.x - ox) / scale - 40,
      top: (drag.y - oy) / scale - 12,
      pointerEvents:"none", zIndex: 100,
      padding:"5px 12px", borderRadius:6,
      background:"var(--glass-3)",
      backdropFilter:"var(--blur-strong)",
      boxShadow:"0 12px 32px rgba(0,0,0,0.5), inset 0 0 0 0.5px var(--stroke-strong), 0 0 0 1.5px var(--accent)",
      fontSize:11, fontWeight:600,
      color:"var(--text-1)",
      transform:"rotate(-2deg)",
    }}>{meta?.title || drag.tabId}</div>
  );
}

// ─── snap zone overlay ──────────────────────────────────────
export function DragSnap({ rect, label, accent, bounds }: any) {
  if (!rect) return null;
  // Pill is a fixed-size box centered on the snap rect. When the rect is a thin
  // strip at an edge (e.g. "Dock left" / "New column"), a naive centered pill
  // spills past the workspace and gets clipped — clamp it to stay fully visible.
  const PAD = 6, LW = 100, LH = 20;
  let lx = rect.x + rect.w/2 - LW/2;
  let ly = rect.y + rect.h/2 - LH/2;
  if (bounds) {
    lx = Math.max(PAD, Math.min(lx, bounds.w - LW - PAD));
    ly = Math.max(PAD, Math.min(ly, bounds.h - LH - PAD));
  }
  // The snap rect slides between targets via a CSS transition; drop it when the
  // user prefers reduced motion so the box jumps instead of animating.
  const reduce = prefersReducedMotion();
  return (
    <div aria-hidden="true">
      <div style={{
        position:"absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        background: `color-mix(in oklch, ${accent} 20%, transparent)`,
        boxShadow: `inset 0 0 0 1.5px ${accent}, 0 0 24px color-mix(in oklch, ${accent} 40%, transparent)`,
        pointerEvents:"none", zIndex: 90,
        borderRadius: 4,
        backdropFilter: "blur(8px)",
        transition: reduce ? "none" : "left .09s ease, top .09s ease, width .09s ease, height .09s ease",
      }}/>
      {label && <div style={{
        position:"absolute",
        left: lx, top: ly,
        padding:"3px 10px",
        background: accent,
        color:"#0b0e14",
        fontSize:10, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase",
        borderRadius:4,
        textAlign:"center",
        width: LW, boxSizing:"border-box",
        whiteSpace:"nowrap",
        pointerEvents:"none", zIndex: 91,
        boxShadow:"0 2px 8px rgba(0,0,0,0.4)",
      }}>{label}</div>}
    </div>
  );
}
