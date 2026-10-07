// ─────────────────────────────────────────────────────────────
// Monet Panel System — primitives
// ─────────────────────────────────────────────────────────────
// Composable, reusable across creative apps. The chrome stays neutral;
// each app passes its own accent via the --accent CSS var on .monet-window.
//
// Components:
//   <Workspace accent title docs activeDoc> ... </Workspace>
//   <MenuStrip menus={[]} />
//   <OptionsBar>...</OptionsBar>
//   <Body>...</Body>
//   <ToolRail tools={[{id,name,icon,badge?}]} active onSelect />
//   <Canvas>...</Canvas>
//   <Dock side="left|right|bottom" width|height>...</Dock>
//   <Splitter />  (resizable, handled by Dock)
//   <Panel>
//     <TabStrip tabs active onSelect onClose onAdd actions />
//     <PanelBody flush>...</PanelBody>
//   </Panel>
//   <Float left top width height title>...</Float>
//   <StatusBar>...</StatusBar>
//   <IconRail items />
//   <SnapOverlay zones />
//
// All visuals come from styles.css. JS handles only behavior:
// splitter drag, dock resize, tab activation, panel minimization.

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { Icon, I } from "./icons";
import type { WindowControls } from "./chrome";
import { useMonetWindowState } from "./chrome";
import { MenuBar, type MenuBarEntry, type MenuItemDef } from "./menu";
import { Tooltip, Popover, type Side } from "./overlay-core";
import { Slider, Waveform, type SliderProps } from "./primitives-graphics";
import { usePointerSession } from "./internal";

// ─── menus prop model ───────────────────────────────────────────
// The chrome menu bars accept a polymorphic `menus` prop:
//   • `string[]`        — legacy: each string is a top-level menu label with no
//                          items. It still renders a clickable trigger that
//                          opens an empty placeholder menu, so nothing breaks.
//   • `MenuBarEntry[]`  — rich: full functional dropdowns with items, submenus,
//                          separators, shortcuts, actions + keyboard/aria.
/** What the chrome menu bars accept for their `menus` prop. */
export type MenusProp = string[] | MenuBarEntry[];

function isRichMenus(menus: MenusProp | undefined): menus is MenuBarEntry[] {
  return Array.isArray(menus) && menus.length > 0 && typeof menus[0] === "object" && menus[0] !== null;
}

// Single placeholder shown for a legacy string-label menu so the dropdown is
// never empty (an empty menu surface would trap focus with nothing to do).
const PLACEHOLDER_ITEMS: MenuItemDef[] = [
  { id: "__placeholder", label: "No actions", disabled: true },
];

/** Coerce either `menus` form into the `MenuBarEntry[]` shape `MenuBar` wants. */
export function normalizeMenus(menus: MenusProp | undefined): MenuBarEntry[] {
  if (!menus || menus.length === 0) return [];
  if (isRichMenus(menus)) return menus;
  return (menus as string[]).map((label) => ({
    id: label,
    label,
    items: PLACEHOLDER_ITEMS,
  }));
}

// Run `fn` when a non-button element with role="button" is activated via the
// keyboard (Enter / Space), matching native button behavior.
function activateOnKey(e: React.KeyboardEvent, fn: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
}

// ─── Workspace shell ───────────────────────────────────────────
export interface WorkspaceProps {
  accent?: string;
  title?: React.ReactNode;
  /** Document tab labels (a trailing `*` marks an unsaved doc). */
  docs?: string[];
  /** Active document label (controlled). Falls back to internal state. */
  activeDoc?: string;
  app?: React.ReactNode;
  children?: React.ReactNode;
}

function Workspace({ accent, title, docs = [], activeDoc, app, children }: WorkspaceProps) {
  return (
    <div className="monet-window" style={{ "--accent": accent } as React.CSSProperties}>
      <Titlebar title={title} docs={docs} activeDoc={activeDoc} app={app} accent={accent} />
      {children}
    </div>
  );
}

// app name in title-case, e.g. "RASTER" → "Raster"
function appLabel(app: React.ReactNode): string {
  if (typeof app !== "string" || !app) return "App";
  return app.charAt(0).toUpperCase() + app.slice(1).toLowerCase();
}

/** Props for the window [`Titlebar`]. Document-tab callbacks are optional —
 *  when omitted the titlebar keeps its own selection/order state so an
 *  uncontrolled host still gets working tabs. */
export interface TitlebarProps {
  title?: React.ReactNode;
  /** Document tab labels (a trailing `*` marks an unsaved doc). */
  docs?: string[];
  /** Active document label (controlled). Falls back to internal state. */
  activeDoc?: string;
  app?: React.ReactNode;
  /** Content for the app pill's info panel; when provided, the macOS pill
   *  renders as a button that opens it. */
  appPanel?: React.ReactNode;
  accent?: string;
  platform?: "mac" | "win";
  /** Menu bar definition — legacy `string[]` or rich [`MenuBarEntry[]`]. */
  menus?: MenusProp;
  controls?: WindowControls;
  /** Enable native `data-tauri-drag-region` hooks (bare Tauri chrome). */
  drag?: boolean;
  /** The OS owns the window frame; render document tabs without fake controls. */
  nativeFrame?: boolean;
  /** Notified when the user activates a document tab. */
  onDocSelect?: (doc: string) => void;
  /** Notified when the user clicks a document tab's close button. */
  onDocClose?: (doc: string) => void;
  /** Notified after a document tab is dragged into a new position. */
  onDocReorder?: (order: string[]) => void;
}

// Live document-tab drag session. Held in a ref (mutated without re-render)
// while a tab is being dragged; `null` when idle.
interface DragSession {
  doc: string;
  order: string[];
  /** Left edge of each tab at drag start, indexed by slot. */
  L: number[];
  /** Width of each tab at drag start, indexed by slot. */
  W: number[];
  gap: number;
  fromIndex: number;
  target: number;
  n: number;
  startX: number;
  dx: number;
  el: HTMLElement;
  minDx: number;
  maxDx: number;
}

function Titlebar({
  title: _title, docs = [], activeDoc, app, appPanel, accent, platform = "mac", menus = [], controls, drag: dragEnabled,
  nativeFrame,
  onDocSelect, onDocClose, onDocReorder,
}: TitlebarProps) {
  // selectable + macOS-style live-drag document tabs
  const [order, setOrder] = useState<string[]>(docs);
  const [picked, setPicked] = useState<string | undefined>(docs[0]);
  const [, setDragDoc] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const elMap = useRef<Record<string, HTMLElement>>({});  // doc -> tab element
  const drag = useRef<DragSession | null>(null);          // live drag session (mutable, no re-render)
  const settle = useRef<boolean>(false);                  // clear inline styles after a committed reorder
  const startPointerSession = usePointerSession();
  const [appOpen, setAppOpen] = useState(false);
  // Live native window state drives the maximize/restore glyph + dim-on-blur.
  const { focused, maximized } = useMonetWindowState();

  // keep state in sync if the host swaps the document set
  useEffect(() => { setOrder(docs); }, [docs.join(" ")]);

  // (#190) `activeDoc` is controlled — derive the rendered selection from it
  // rather than mirroring it into state, so a host that refuses a click stays
  // authoritative. Uncontrolled, the internal pick falls back to the first tab
  // once the picked document disappears from `docs`.
  const active = activeDoc ?? (picked !== undefined && order.includes(picked) ? picked : order[0]);

  // Activate a doc: update internal state (the uncontrolled fallback) and notify.
  const selectDoc = useCallback((doc: string) => {
    setPicked(doc);
    onDocSelect?.(doc);
  }, [onDocSelect]);

  const setRef = (doc: string) => (el: HTMLElement | null) => { if (el) elMap.current[doc] = el; else delete elMap.current[doc]; };
  const EASE = "transform 0.22s cubic-bezier(.2,.85,.25,1)";

  // resting x-offset the dragged tab animates to so it lands exactly in its new slot
  const restingOffset = (d: DragSession) => {
    if (d.target === d.fromIndex) return 0;
    let off = 0;
    if (d.target > d.fromIndex) for (let i = d.fromIndex + 1; i <= d.target; i++) off += d.W[i] + d.gap;
    else for (let i = d.target; i < d.fromIndex; i++) off -= d.W[i] + d.gap;
    return off;
  };

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    let dx = e.clientX - d.startX;
    dx = Math.max(d.minDx, Math.min(d.maxDx, dx));
    d.dx = dx;
    d.el.style.transition = "none";
    d.el.style.transform = `translateX(${dx}px) translateY(-2px)`;
    if (Math.abs(dx) > 2) d.el.classList.add("is-dragging");

    // which slot is the dragged tab's center over now?
    const center = d.L[d.fromIndex] + dx + d.W[d.fromIndex] / 2;
    let target = d.fromIndex;
    while (target < d.n - 1 && center > d.L[target + 1] + d.W[target + 1] / 2) target++;
    while (target > 0 && center < d.L[target - 1] + d.W[target - 1] / 2) target--;
    d.target = target;

    // slide the other tabs to open a gap at the target slot
    const shift = d.W[d.fromIndex] + d.gap;
    d.order.forEach((doc: string, i: number) => {
      if (i === d.fromIndex) return;
      const el = elMap.current[doc];
      if (!el) return;
      let t = 0;
      if (target > d.fromIndex && i > d.fromIndex && i <= target) t = -shift;
      else if (target < d.fromIndex && i >= target && i < d.fromIndex) t = shift;
      el.style.transition = EASE;
      el.style.transform = t ? `translateX(${t}px)` : "";
    });
  }, []);

  const onPointerUp = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // settle the dragged tab into its new slot, then commit the order
    d.el.style.transition = EASE;
    d.el.style.transform = `translateX(${restingOffset(d)}px)`;
    const newOrder = d.order.slice();
    newOrder.splice(d.target, 0, newOrder.splice(d.fromIndex, 1)[0]);
    setTimeout(() => {
      settle.current = true;
      setDragDoc(null);
      if (d.target === d.fromIndex) { settle.current = false; clearInline(); }
      else { setOrder(newOrder); onDocReorder?.(newOrder); }
    }, 200);
  }, [onPointerMove, onDocReorder]);

  const clearInline = () => {
    Object.values(elMap.current).forEach((el: any) => {
      if (!el) return;
      el.style.transition = "none";
      el.style.transform = "";
      el.style.zIndex = "";
      el.classList.remove("is-dragging");
      void el.offsetWidth;
      el.style.transition = "";
    });
  };

  // after a committed reorder the DOM is already in final positions — drop inline styles with no flash
  useLayoutEffect(() => {
    if (!settle.current) return;
    settle.current = false;
    clearInline();
  }, [order]);

  const onPointerDown = (doc: string) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as Element).closest(".close")) return;
    selectDoc(doc);
    const tabs = order.map((dd) => elMap.current[dd]);
    if (tabs.some((t) => !t) || !rowRef.current) return;
    const rects = tabs.map((t) => t.getBoundingClientRect());
    const L = rects.map((r) => r.left);
    const W = rects.map((r) => r.width);
    const gap = order.length > 1 ? Math.max(0, L[1] - (L[0] + W[0])) : 4;
    const fromIndex = order.indexOf(doc);
    const row = rowRef.current.getBoundingClientRect();
    const el = elMap.current[doc];
    el.style.zIndex = "20";
    drag.current = {
      doc, order: order.slice(), L, W, gap, fromIndex, target: fromIndex,
      n: order.length, startX: e.clientX, dx: 0, el,
      minDx: row.left + 4 - L[fromIndex],
      maxDx: row.right - 4 - (L[fromIndex] + W[fromIndex]),
    };
    setDragDoc(doc);
    startPointerSession({
      move: onPointerMove,
      up: onPointerUp,
      onCancel: () => {
        drag.current = null;
        setDragDoc(null);
        clearInline();
      },
    });
    e.preventDefault();
  };

  const tabClass = (d: string, isWin: boolean) =>
    `monet-doctab${isWin ? " is-win" : ""}` +
    (d === active ? " is-active" : "") +
    (d.endsWith("*") ? " is-modified" : "");

  // Document tabs are real tabs: role=tab, aria-selected, keyboard activation.
  // Enter/Space select; Left/Right move focus across the strip.
  const onTabKeyDown = (d: string) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectDoc(d);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const i = order.indexOf(d);
      const next = e.key === "ArrowRight"
        ? order[(i + 1) % order.length]
        : order[(i - 1 + order.length) % order.length];
      elMap.current[next]?.focus();
    } else if ((e.key === "Backspace" || e.key === "Delete") && onDocClose) {
      e.preventDefault();
      onDocClose(d);
    }
  };

  const closeDoc = (d: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onDocClose?.(d);
  };

  const renderTab = (d: string, isWin: boolean) => (
    <span
      key={d}
      ref={setRef(d)}
      className={tabClass(d, isWin)}
      role="tab"
      aria-selected={d === active}
      tabIndex={d === active ? 0 : -1}
      onPointerDown={onPointerDown(d)}
      onClick={() => selectDoc(d)}
      onKeyDown={onTabKeyDown(d)}
    >
      <span className="dot" style={{ background: d === active ? accent : undefined }} />
      <span className="monet-doctab-label">{d.replace(/\*$/, "")}</span>
      <span
        className="close"
        role="button"
        aria-label={`Close ${d.replace(/\*$/, "")}`}
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={closeDoc(d)}
      >
        <Icon d={I.close} size={9}/>
      </span>
    </span>
  );

  // maximize/restore glyph + label reflect the live native state
  const maxLabel = maximized ? "Restore" : "Maximize";
  // win maximize glyph: a single square (maximize) or stacked squares (restore)
  const winMaxGlyph = maximized
    ? "M4.5 5.5L4.5 3.5L11.5 3.5L11.5 10.5L9.5 10.5 M3.5 6.5L9.5 6.5L9.5 12.5L3.5 12.5Z"
    : "M3.5 3.5L12.5 3.5L12.5 12.5L3.5 12.5Z";
  const blurredCls = focused ? "" : " is-blurred";

  if (nativeFrame && platform === "mac") {
    return (
      <div className={`monet-documentbar${blurredCls}`} {...(dragEnabled ? { "data-tauri-drag-region": "" } : {})}>
        <div className="monet-tab-row" role="tablist" aria-label="Open documents" ref={rowRef} {...(dragEnabled ? { "data-tauri-drag-region": "" } : {})}>
          {order.map((d) => renderTab(d, false))}
        </div>
      </div>
    );
  }

  if (platform === "win") {
    // Windows: menu line lives on the top chrome row (app icon · menus · window controls);
    // document tabs sit on their own strip directly below.
    return (
      <>
        <div className={`monet-titlebar is-win${blurredCls}`} {...(dragEnabled ? { "data-tauri-drag-region": "" } : {})}>
          <span className="monet-win-appicon" style={{ background: accent }}/>
          <span className="monet-win-applabel">{appLabel(app)}</span>
          <MenuBar
            menus={normalizeMenus(menus)}
            className="monet-winmenus"
            itemClassName="monet-menu"
            openClassName="is-open"
          />
          <span className="monet-win-drag" {...(dragEnabled ? { "data-tauri-drag-region": "" } : {})} />
          <div className="monet-winctrls">
            <button type="button" className="monet-winctrl" aria-label="Minimize" title="Minimize" onClick={() => controls?.minimize()}><Icon d="M3 8L13 8" size={11} strokeWidth={1.2}/></button>
            <button type="button" className="monet-winctrl" aria-label={maxLabel} title={maxLabel} onClick={() => controls?.toggleMaximize()}><Icon d={winMaxGlyph} size={11} strokeWidth={1.2}/></button>
            <button type="button" className="monet-winctrl is-close" aria-label="Close" title="Close" onClick={() => controls?.close()}><Icon d={I.close} size={11} strokeWidth={1.2}/></button>
          </div>
        </div>
        <div className="monet-tabstrip-win">
          <div className="monet-tab-row is-win" role="tablist" aria-label="Open documents" ref={rowRef}>
            {order.map((d) => renderTab(d, true))}
          </div>
        </div>
      </>
    );
  }
  // macOS — traffic lights + document tabs + app pill (menus live in the global bar)
  return (
    <div className={`monet-titlebar${blurredCls}`} {...(dragEnabled ? { "data-tauri-drag-region": "" } : {})}>
      {/* Traffic lights stay <i> (the .monet-traffic > i CSS owns their colored
          circles + focus ring); we layer real button semantics + keyboard on top. */}
      <div className="monet-traffic">
        <i role="button" tabIndex={0} aria-label="Close" title="Close" onClick={() => controls?.close()} onKeyDown={(e) => activateOnKey(e, () => controls?.close())}><Icon d={I.close} size={8} strokeWidth={1.6}/></i>
        <i role="button" tabIndex={0} aria-label="Minimize" title="Minimize" onClick={() => controls?.minimize()} onKeyDown={(e) => activateOnKey(e, () => controls?.minimize())}><Icon d="M3.5 8L12.5 8" size={8} strokeWidth={1.6}/></i>
        <i role="button" tabIndex={0} aria-label={maxLabel} title={maxLabel} onClick={() => controls?.toggleMaximize()} onKeyDown={(e) => activateOnKey(e, () => controls?.toggleMaximize())}><Icon d="M5 5L11 11M11 5L5 11" size={7} strokeWidth={1.4}/></i>
      </div>
      <div className="monet-tab-row" role="tablist" aria-label="Open documents" ref={rowRef} {...(dragEnabled ? { "data-tauri-drag-region": "" } : {})}>
        {order.map((d) => renderTab(d, false))}
      </div>
      <div className="monet-titlebar-right" {...(dragEnabled ? { "data-tauri-drag-region": "" } : {})}>
        {appPanel ? (
          <Popover open={appOpen} onOpenChange={setAppOpen} side="bottom" align="end" offset={6} trapFocus={false} label="Application info" className="monet-app-info" content={appPanel}>
            <button type="button" className="monet-app-pill" onClick={() => setAppOpen((v) => !v)}>
              <span className="glyph"/>
              {app}
            </button>
          </Popover>
        ) : (
          <span className="monet-app-pill">
            <span className="glyph"/>
            {app}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── menu strip (Windows: in-window menu bar) ──────────────────
export interface MenuStripProps {
  /** Menu bar definition — legacy `string[]` or rich [`MenuBarEntry[]`]. */
  menus?: MenusProp;
  platform?: "mac" | "win";
}

function MenuStrip({ menus = [], platform = "mac" }: MenuStripProps) {
  return (
    <MenuBar
      menus={normalizeMenus(menus)}
      className={`monet-menustrip ${platform === "win" ? "is-win" : ""}`}
      itemClassName="monet-menu"
      openClassName="is-open"
    />
  );
}

// ─── options bar ───────────────────────────────────────────────
function OptionsBar({ children }: { children?: React.ReactNode }) { return <div className="monet-optionsbar">{children}</div>; }
OptionsBar.Group = ({ children }: { children?: React.ReactNode }) => <div className="group">{children}</div>;

// ─── body container ────────────────────────────────────────────
function Body({ children }: { children?: React.ReactNode }) { return <div className="monet-body">{children}</div>; }

// ─── tool rail ─────────────────────────────────────────────────
// `orientation`: "v" (default) or "h". `inline`: skip the .monet-toolrail wrapper
// (used when embedded inside a relocatable <Toolbar>, which provides its own chrome).
/** A single tool, or the literal `"div"` to draw a divider between groups. */
export interface ToolRailTool {
  id: string;
  name: string;
  /** Icon: a key into the icon map `I`, or a raw SVG path string. */
  icon: string;
  badge?: boolean;
  /**
   * Optional longer description, shown beneath the name in the hover tooltip
   * (which opens after a 1s dwell). When omitted, the tooltip shows just `name`.
   */
  description?: string;
  /**
   * Photoshop-style flyout group. When present, this entry renders as a SINGLE
   * slot (not N buttons): the slot shows the active child's icon when one of the
   * children is the active tool, otherwise the last-picked child (default: the
   * first child), with a corner triangle marking it as a group. A plain click
   * selects the visible child; right-click / long-press opens a flyout to pick
   * any child; Alt-click cycles to the next child. Children should be leaf tools
   * (their own `children`, if any, are ignored). The parent entry's own `id` is
   * only used as a stable key, never selected — selection always targets a child.
   */
  children?: ToolRailTool[];
}
export interface ToolRailProps {
  /**
   * Tools to render. Each entry is a `ToolRailTool`, or a divider. The literal
   * `"div"` is the canonical divider token; any bare string is also accepted as
   * a divider for backward compatibility (mixed `[{…}, "div"]` literals widen
   * the element type to `string`), so legacy tool lists keep type-checking.
   */
  tools?: Array<ToolRailTool | "div" | (string & {})>;
  active?: string;
  onSelect?: (id: string) => void;
  footer?: React.ReactNode;
  orientation?: "v" | "h";
  /** Skip the `.monet-toolrail` wrapper (embedded inside a `<Toolbar>`). */
  inline?: boolean;
}

/**
 * Builds the body for a tool's hover tooltip: a bold `name` line, plus a muted
 * `description` line below it when one is given. Shared by every Monet tool rail
 * (the flat `ToolRail` and apps' own rails) so the popups look identical. Pair
 * it with `<Tooltip delay={1000}>` to match the standard 1-second tool dwell.
 */
export function toolTip(name: React.ReactNode, description?: React.ReactNode): React.ReactNode {
  if (!description) return name;
  return (
    <span className="monet-tool-tip">
      <span className="monet-tool-tip-name">{name}</span>
      <span className="monet-tool-tip-desc">{description}</span>
    </span>
  );
}

/** Resolve an icon key (a key into `I`) or a raw SVG path to a path string. */
function toolIcon(icon: string): string {
  return I[icon as keyof typeof I] || icon;
}

/** A single, non-grouped tool button — the leaf of both the flat rail and the
 *  flyout. Wrapped in a hover Tooltip (name + optional description). */
function ToolRailButton({
  tool, active, onSelect, orientation, tipSide,
}: {
  tool: ToolRailTool;
  active?: string;
  onSelect?: (id: string) => void;
  orientation: "v" | "h";
  tipSide: Side;
}) {
  return (
    <Tooltip content={toolTip(tool.name, tool.description)} delay={1000} side={tipSide}>
      <div
        className={`monet-tool ${tool.id === active ? "is-active" : ""}`}
        data-orient={orientation}
        data-tool={tool.id}
        role="button"
        aria-pressed={tool.id === active}
        aria-label={tool.name}
        tabIndex={0}
        onClick={() => onSelect?.(tool.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(tool.id); }
        }}
      >
        <Icon d={toolIcon(tool.icon)} size={16}/>
        {tool.badge && <span className="badge"/>}
      </div>
    </Tooltip>
  );
}

/** A Photoshop-style flyout group: one slot for several related tools. The slot
 *  shows the active child (or the last-picked one), with a corner triangle. Click
 *  selects the visible tool; right-click / long-press opens the flyout; Alt-click
 *  cycles. Each slot remembers its last-used tool across selections elsewhere. */
function ToolGroup({
  group, active, onSelect, orientation, tipSide,
}: {
  group: ToolRailTool;
  active?: string;
  onSelect?: (id: string) => void;
  orientation: "v" | "h";
  tipSide: Side;
}) {
  const children = group.children ?? [];
  const [open, setOpen] = useState(false);
  const [lastPicked, setLastPicked] = useState(children[0]?.id);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  // Which child does the slot currently show? The active tool when it belongs to
  // this group, else the last-picked child, else the first child. Keep memory in
  // sync so the slot keeps showing this group's last tool after the user picks a
  // tool in another group.
  const activeChild = children.find((c) => c.id === active);
  const visible = activeChild ?? children.find((c) => c.id === lastPicked) ?? children[0];
  useEffect(() => {
    if (activeChild && activeChild.id !== lastPicked) setLastPicked(activeChild.id);
  }, [activeChild, lastPicked]);

  if (children.length === 0) return null;

  const groupActive = !!activeChild;
  const clearHold = () => {
    if (holdTimer.current != null) { clearTimeout(holdTimer.current); holdTimer.current = null; }
  };
  const pick = (id: string) => { setLastPicked(id); setOpen(false); onSelect?.(id); };
  // Open the flyout and mark it as a long-press/right-click so the trailing click
  // doesn't also select the visible tool. Shared by the hold timer + onContextMenu.
  const openFlyout = () => { clearHold(); longPressed.current = true; setOpen(true); };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // right-click handled by onContextMenu
    longPressed.current = false;
    clearHold();
    holdTimer.current = setTimeout(openFlyout, 350);
  };
  const onClick = (e: React.MouseEvent) => {
    clearHold();
    if (longPressed.current) { longPressed.current = false; return; } // long-press opened the flyout
    if (e.altKey && children.length > 1) {
      const idx = children.findIndex((c) => c.id === visible.id);
      pick(children[(idx + 1) % children.length].id);
    } else {
      pick(visible.id);
    }
  };

  const trigger = (
    <div
      className={`monet-tool monet-tool-group ${groupActive ? "is-active" : ""}`}
      data-orient={orientation}
      data-tool-group={group.id}
      data-tool={visible.id}
      role="button"
      aria-pressed={groupActive}
      aria-label={visible.name}
      tabIndex={0}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); openFlyout(); }}
      onPointerDown={onPointerDown}
      onPointerUp={clearHold}
      onPointerLeave={clearHold}
      onPointerCancel={clearHold}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(visible.id); }
        else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setOpen(true); }
      }}
    >
      <Icon d={toolIcon(visible.icon)} size={16}/>
      {visible.badge && <span className="badge"/>}
      <span className="monet-tool-flyout" aria-hidden="true"/>
    </div>
  );

  const flyout = (
    <div className="monet-flyout-list" role="menu" aria-label={group.name}>
      {children.map((c) => (
        <button
          key={c.id}
          type="button"
          role="menuitemradio"
          aria-checked={c.id === active}
          className={`monet-flyout-item ${c.id === active ? "is-active" : ""}`}
          data-flyout-tool={c.id}
          onClick={() => pick(c.id)}
        >
          <span className="monet-flyout-icon"><Icon d={toolIcon(c.icon)} size={16}/></span>
          <span className="monet-flyout-label">{c.name}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side={tipSide}
      align="start"
      offset={6}
      role="menu"
      trapFocus={false}
      label={group.name}
      className="monet-flyout"
      content={flyout}
    >
      {trigger}
    </Popover>
  );
}

function ToolRail({ tools = [], active, onSelect, footer, orientation = "v", inline = false }: ToolRailProps) {
  // Tooltip opens to the side the rail does NOT occupy: a vertical rail sits on
  // an edge, so its tips fly out horizontally (right); a horizontal rail's drop
  // below. Description (when present) renders under the name after a 1s dwell.
  // Flyouts open to the same side.
  const tipSide: Side = orientation === "h" ? "bottom" : "right";
  const items = (
    <>
      {tools.map((t, i) => {
        if (typeof t === "string") return <div key={i} className="monet-divider" data-orient={orientation}/>;
        if (t.children && t.children.length > 0) {
          return <ToolGroup key={t.id} group={t} active={active} onSelect={onSelect} orientation={orientation} tipSide={tipSide}/>;
        }
        return <ToolRailButton key={t.id} tool={t} active={active} onSelect={onSelect} orientation={orientation} tipSide={tipSide}/>;
      })}
      {footer && <>
        {orientation === "v" && <div style={{ flex: 1 }}/>}
        {footer}
      </>}
    </>
  );
  if (inline) return items;
  return <div className="monet-toolrail">{items}</div>;
}

// ─── canvas ────────────────────────────────────────────────────
function Canvas({ children }: { children?: React.ReactNode }) {
  return (
    <div className="monet-canvas">
      <div className="monet-canvas-shell">{children}</div>
    </div>
  );
}

// ─── dock (resizable column/row of panels) ─────────────────────
export interface DockProps {
  /** Which edge the dock is pinned to. */
  side?: "left" | "right" | "bottom";
  /** Starting size in px. Defaults to 220 (bottom) / 320 (left|right). */
  initial?: number;
  children?: React.ReactNode;
  accent?: string;
}

// side: "left"|"right"|"bottom"
// initial: starting size in px
// children: panels (each is its own resizable subregion via inner Splitters)
function Dock({ side = "right", initial, children, accent }: DockProps) {
  const isV = side === "bottom";
  const [size, setSize] = useState(initial ?? (isV ? 220 : 320));
  const dockRef = useRef<HTMLDivElement | null>(null);
  const startPointerSession = usePointerSession();

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const start = isV ? e.clientY : e.clientX;
    const startSize = size;
    const move = (ev: PointerEvent) => {
      const delta = (isV ? ev.clientY : ev.clientX) - start;
      const next = isV ? startSize - delta
                       : side === "left" ? startSize + delta : startSize - delta;
      setSize(Math.max(120, Math.min(640, next)));
    };
    startPointerSession({
      move,
      up: () => {},
      onCancel: () => setSize(startSize),
      cursor: isV ? "row-resize" : "col-resize",
    });
  };

  const cls = `monet-dock monet-dock--${side}`;
  const style = isV ? { height: size, flex: `0 0 ${size}px` }
                    : { width: size, flex: `0 0 ${size}px` };

  // edge splitter — on the side that faces the canvas
  return (
    <>
      {(side === "right" || side === "bottom") &&
        <div className={`monet-split ${isV ? "is-h" : ""}`} onPointerDown={onDown} style={{ "--accent": accent } as React.CSSProperties}/>}
      <div ref={dockRef} className={cls} style={style}>{children}</div>
      {side === "left" &&
        <div className="monet-split" onPointerDown={onDown} style={{ "--accent": accent } as React.CSSProperties}/>}
    </>
  );
}

// ─── panel with optional resize handle to next panel ───────────
// In a Dock, vertical panels are stacked. We render an internal h-splitter
// between siblings via PanelStack.
function PanelStack({ children }: { children?: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  // Each child may carry a `flex` prop (see PanelProps); read it loosely since
  // React.Children.toArray widens the element type beyond our own components.
  const flexOf = (c: any): number => c.props?.flex ?? 1;
  const [sizes, setSizes] = useState<number[]>(() => items.map(flexOf));
  const stackRef = useRef<HTMLDivElement | null>(null);
  const startPointerSession = usePointerSession();

  // recompute when items change
  useEffect(() => { setSizes(items.map(flexOf)); }, [items.length]);

  const startResize = (i: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    if (!stackRef.current) return;
    const rect = stackRef.current.getBoundingClientRect();
    const totalH = rect.height;
    const start = e.clientY;
    const startSizes = sizes.slice();
    const a = startSizes[i], b = startSizes[i+1];
    const total = a + b;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - start;
      const fracDelta = (dy / totalH) * sizes.reduce((s,x)=>s+x,0);
      let na = Math.max(0.2, a + fracDelta);
      let nb = Math.max(0.2, total - (na - a) - (a - a));
      // simpler: redistribute between a and b
      na = Math.max(0.2, a + fracDelta);
      nb = total - na;
      if (nb < 0.2) { nb = 0.2; na = total - nb; }
      const next = startSizes.slice();
      next[i] = na; next[i+1] = nb;
      setSizes(next);
    };
    startPointerSession({
      move,
      up: () => {},
      onCancel: () => setSizes(startSizes),
      cursor: "row-resize",
    });
  };

  return (
    <div ref={stackRef} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {items.map((c, i) => (
        <React.Fragment key={i}>
          <div style={{ flex: sizes[i], minHeight: 0, display: "flex", flexDirection: "column" }}>
            {c}
          </div>
          {i < items.length - 1 && (
            <div className="monet-split is-h" onPointerDown={startResize(i)}/>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── panel ─────────────────────────────────────────────────────
export interface PanelProps {
  children?: React.ReactNode;
  /** Flex grow factor inside a `PanelStack`/dock column. Honored via flexGrow. */
  flex?: number;
}

function Panel({ children, flex }: PanelProps) {
  // Honor `flex` so a panel can claim a share of its column's height. When
  // undefined the panel just participates with the default flex from CSS.
  const style = flex != null ? { flexGrow: flex } : undefined;
  return <div className="monet-panel" style={style}>{children}</div>;
}

export interface TabStripProps {
  tabs?: string[];
  active?: string;
  onSelect?: (tab: string) => void;
  /** Render a close affordance per tab; invoked with the tab id. */
  onClose?: (tab: string) => void;
  /** Render an "add tab" affordance in the actions area; invoked on activate. */
  onAdd?: () => void;
  /** Extra controls injected before the overflow button. */
  actions?: React.ReactNode;
  accent?: string;
}

function TabStrip({ tabs = [], active, onSelect, onClose, onAdd, actions }: TabStripProps) {
  const [internalActive, setInternalActive] = useState<string | undefined>(active ?? tabs[0]);
  useEffect(() => { if (active !== undefined) setInternalActive(active); }, [active]);
  const current = active ?? internalActive;
  const elMap = useRef<Record<string, HTMLElement | null>>({});  // tab -> element

  const select = (t: string) => {
    if (active === undefined) setInternalActive(t);
    onSelect?.(t);
  };

  const onTabKeyDown = (t: string) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(t);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const i = tabs.indexOf(t);
      const next = e.key === "ArrowRight"
        ? tabs[(i + 1) % tabs.length]
        : tabs[(i - 1 + tabs.length) % tabs.length];
      select(next);
      // (#189) the tabIndex is roving, so state alone leaves focus parked on a
      // tab that just became tabIndex=-1 — move it, like Titlebar's tab strip.
      elMap.current[next]?.focus();
    } else if ((e.key === "Backspace" || e.key === "Delete") && onClose) {
      e.preventDefault();
      onClose(t);
    }
  };

  return (
    <div className="monet-tabs" role="tablist">
      {tabs.map((t) => (
        <span key={t}
              ref={(el) => { elMap.current[t] = el; }}
              role="tab"
              aria-selected={t === current}
              tabIndex={t === current ? 0 : -1}
              className={`monet-tab ${t === current ? "is-active" : ""}`}
              onClick={() => select(t)}
              onKeyDown={onTabKeyDown(t)}>
          {t}
          {onClose && (
            <span className="close"
                  role="button"
                  aria-label={`Close ${t}`}
                  tabIndex={-1}
                  onClick={(e) => { e.stopPropagation(); onClose(t); }}>
              <Icon d={I.close} size={9}/>
            </span>
          )}
        </span>
      ))}
      <div className="monet-tab-actions">
        {actions}
        {onAdd && (
          <button type="button" className="btn" aria-label="Add tab" title="Add tab" onClick={onAdd}>
            <Icon d={I.plus} size={13}/>
          </button>
        )}
        <span className="btn" role="button" aria-label="More" tabIndex={0}><Icon d={I.more} size={14}/></span>
      </div>
    </div>
  );
}

export interface PanelBodyProps {
  children?: React.ReactNode;
  flush?: boolean;
}

function PanelBody({ children, flush }: PanelBodyProps) {
  return <div className={`monet-panel-body ${flush ? "is-flush" : ""}`} role="tabpanel">{children}</div>;
}

// ─── float ─────────────────────────────────────────────────────
// Matches the dockable floating mini-dock chrome: a slim move-bar (grip + close)
// on top, then a tab strip carrying the panel title(s), then the body.
export interface FloatProps {
  left?: number | string;
  top?: number | string;
  right?: number | string;
  bottom?: number | string;
  width?: number | string;
  height?: number | string;
  title?: string;
  tabs?: string[];
  /** Active tab label (controlled). Falls back to the first tab. */
  activeTab?: string;
  accent?: string;
  children?: React.ReactNode;
  /** Invoked when the float's close button is activated. */
  onClose?: () => void;
  /** Invoked with the tab id when a tab is clicked. */
  onSelect?: (tab: string) => void;
}

function Float({ left, top, right, bottom, width, height, title, tabs, activeTab, accent, children, onClose, onSelect }: FloatProps) {
  const tabList = tabs || (title ? [title] : []);
  const [internalActive, setInternalActive] = useState<string | undefined>(activeTab ?? tabList[0]);
  useEffect(() => { if (activeTab !== undefined) setInternalActive(activeTab); }, [activeTab]);
  const current = activeTab ?? internalActive;

  const select = (t: string) => {
    if (activeTab === undefined) setInternalActive(t);
    onSelect?.(t);
  };

  return (
    <div className="monet-float" style={{ left, top, right, bottom, width, height, "--accent": accent } as React.CSSProperties}>
      <div className="monet-float-bar" title="Drag to move">
        <span className="monet-float-grip"><Icon d="M3 5h12 M3 8h12 M3 11h12" size={12}/></span>
        <span style={{ flex: 1 }}/>
        <button type="button" className="monet-iconbtn" aria-label="Close" title="Close" style={{ width: 18, height: 18 }} onClick={onClose}><Icon d={I.close} size={10}/></button>
      </div>
      {tabList.length > 0 && (
        <div className="monet-tabs" role="tablist">
          {tabList.map((t) => (
            <span key={t}
                  role="tab"
                  aria-selected={t === current}
                  tabIndex={t === current ? 0 : -1}
                  className={`monet-tab ${t === current ? "is-active" : ""}`}
                  onClick={() => select(t)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(t); } }}>
              {t}
            </span>
          ))}
          <div className="monet-tab-actions">
            <span className="btn" role="button" aria-label="More" tabIndex={0}><Icon d={I.more} size={14}/></span>
          </div>
        </div>
      )}
      <div className="monet-float-cols" style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

// ─── status bar ────────────────────────────────────────────────
function StatusBar({ children }: { children?: React.ReactNode }) { return <div className="monet-statusbar">{children}</div>; }

// ─── icon rail ─────────────────────────────────────────────────
export interface IconRailItem {
  /** Stable id passed back to `onClick`. Falls back to the index. */
  id?: string;
  name?: string;
  /** Icon: a key into the icon map `I`, or a raw SVG path string. */
  icon: string;
  active?: boolean;
}
export interface IconRailProps {
  items?: IconRailItem[];
  side?: "left" | "right";
  /** Invoked when a rail item is activated (click / Enter / Space). */
  onClick?: (id: string, index: number) => void;
}

function IconRail({ items = [], side = "right", onClick }: IconRailProps) {
  const activate = (it: IconRailItem, i: number) => onClick?.(it.id ?? String(i), i);
  return (
    <div className="monet-iconrail" style={side === "left" ? { borderRight: "0.5px solid var(--stroke-soft)", borderLeft: "none" } : undefined}>
      {items.map((it, i) => (
        <span key={it.id ?? i}
              className={`monet-iconbtn ${it.active ? "is-active" : ""}`}
              role="button"
              aria-pressed={it.active}
              aria-label={it.name}
              tabIndex={0}
              title={it.name}
              onClick={() => activate(it, i)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(it, i); } }}>
          <Icon d={I[it.icon as keyof typeof I] || it.icon} size={14}/>
        </span>
      ))}
    </div>
  );
}

// ─── snap overlay ──────────────────────────────────────────────
/** A single snap target: its pixel rect plus an optional hint label. */
export interface SnapZone {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: React.ReactNode;
}
export interface SnapOverlayProps {
  zones?: SnapZone[];
}

function SnapOverlay({ zones = [] }: SnapOverlayProps) {
  return (
    <div className="monet-snaplayer">
      {zones.map((z, i) => (
        <React.Fragment key={i}>
          <div className="monet-snapzone" style={{ left: z.x, top: z.y, width: z.w, height: z.h }}/>
          {z.label && (
            <div className="monet-snaphint" style={{ left: z.x + z.w/2 - 30, top: z.y + z.h/2 - 10 }}>
              {z.label}
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export {
  Workspace, Titlebar, MenuStrip, OptionsBar, Body,
  ToolRail, Canvas, Dock, PanelStack, Panel, TabStrip, PanelBody,
  Float, StatusBar, IconRail, SnapOverlay,
  Slider, Waveform, appLabel,
};
export type { SliderProps };
