// ─────────────────────────────────────────────────────────────
// Monet · menu system — MenuBar, Menu, MenuItem, SubMenu, ContextMenu
// ─────────────────────────────────────────────────────────────
// Data-driven menus that in-window menu strips consume. Built on the Portal /
// positioning plumbing in
// overlay-core; self-contained otherwise (no controls.tsx dependency).
//
// Model:
//   MenuItemDef = {
//     id, label, action?, shortcut?, items?,
//     separator?, disabled?, checked?, icon?
//   }
//
// Accessibility:
//   • role=menubar / menu / menuitem / menuitemcheckbox
//   • roving tabindex; Up/Down/Home/End to move, Left/Right to traverse
//   • typeahead (jump to item by first letters)
//   • aria-haspopup / aria-expanded on submenu triggers
//   • Esc closes the active layer; outside click closes all
//   • dropdowns render through the Portal with viewport-aware positioning —
//     or, in the desktop app, in native popup windows (native-popup.tsx)
//
// Visuals live in monet-core/overlays.css.

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Icon, I } from "./icons";
import {
  Portal,
  computePosition,
  useDismiss,
  useLayer,
  useMonetId,
  useReposition,
  type Align,
  type PositionResult,
  type Side,
} from "./overlay-core";
import {
  placeNativePopup,
  renderInPopup,
  useCloseOnAppBlur,
  useNativeKeyForwarding,
  useNativePopup,
  useNativePopupHover,
} from "./native-popup";

// ─── public model ──────────────────────────────────────────────
export interface MenuItemDef {
  /** Stable identifier, unique within its parent menu. */
  id: string;
  /** Visible label. Omitted for separators. */
  label?: ReactNode;
  /** Invoked on activation (click / Enter / Space). */
  action?: () => void;
  /** Display-only shortcut hint, e.g. "⌘S" or "Ctrl+S". */
  shortcut?: string;
  /** Nested items — presence makes this a submenu trigger. */
  items?: MenuItemDef[];
  /** Render a divider instead of an item. */
  separator?: boolean;
  /** Greyed out + not activable. */
  disabled?: boolean;
  /** Checkable item state — renders role="menuitemcheckbox" + a check glyph. */
  checked?: boolean;
  /** Optional leading icon: a key into the icon map `I`, or a raw path string. */
  icon?: string;
}

// check glyph (no entry in the shared icon map, so define the path locally)
const CHECK_PATH = "M3.5 8.5L6.5 11.5L12.5 5";

function isInteractive(item: MenuItemDef): boolean {
  return !item.separator && !item.disabled;
}

// ─── single menu surface (the list rendered inside a popover) ──
interface MenuSurfaceProps {
  items: MenuItemDef[];
  /** Called when any leaf item is activated — bubbles up to close the tree. */
  onActivate: (item: MenuItemDef) => void;
  /** Called to close this menu and everything below it. */
  onClose: () => void;
  /** aria-labelledby target (the trigger). */
  labelledBy?: string;
  /** Auto-focus the first item when the surface mounts. */
  autoFocus?: boolean;
  /** Which side submenus open toward (mac/win both open right by default). */
  submenuSide?: Side;
}

function MenuSurface({
  items,
  onActivate,
  onClose,
  labelledBy,
  autoFocus = true,
  submenuSide = "right",
}: MenuSurfaceProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const [active, setActive] = useState<number>(-1);
  const [openSub, setOpenSub] = useState<number | null>(null);
  const typeahead = useRef<{ buffer: string; ts: number }>({ buffer: "", ts: 0 });

  const indices = useMemo(
    () => items.map((it, i) => (isInteractive(it) ? i : -1)).filter((i) => i >= 0),
    [items],
  );

  const focusIndex = useCallback((i: number) => {
    setActive(i);
    // A row in a native popup is never DOM-focused: focusing into another
    // window's page makes WebKit try to key that window, blurring the app
    // window. The highlight is `active`; keys arrive forwarded to the list.
    const row = itemRefs.current[i];
    if (row?.ownerDocument === document) row.focus();
  }, []);

  // (#178) Auto-focus is a per-OPEN action, not a per-render one. `items` is
  // conventionally rebuilt inline by the host, so `indices` got a fresh identity
  // on every unrelated host re-render (playhead tick, window focus, …) and this
  // effect re-fired mid-navigation, yanking focus and the highlighted row back
  // to the first item. Read the indices off a ref and fire once per mount —
  // every surface (MenuBar, Menu, SubMenu, ContextMenu) mounts fresh per open.
  const indicesRef = useRef(indices);
  indicesRef.current = indices;
  useEffect(() => {
    if (!autoFocus) return;
    const first = indicesRef.current[0];
    if (first != null) focusIndex(first);
  }, [autoFocus, focusIndex]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (indices.length === 0) return;
      const cur = indices.indexOf(active);
      const next = cur === -1 ? (dir === 1 ? 0 : indices.length - 1) : (cur + dir + indices.length) % indices.length;
      focusIndex(indices[next]);
    },
    [active, indices, focusIndex],
  );

  const activate = useCallback(
    (item: MenuItemDef, idx: number) => {
      if (!isInteractive(item)) return;
      if (item.items?.length) {
        setOpenSub(idx);
        return;
      }
      item.action?.();
      onActivate(item);
    },
    [onActivate],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // A dropdown/submenu renders through the Portal but is still a React CHILD
    // of this surface, and React bubbles through the REACT tree — so without
    // this guard every keystroke inside a portalled descendant is replayed here
    // too (ArrowRight in a submenu would also step the menu bar). DOM
    // containment is exactly the test: a portalled node is not inside us.
    const target = e.target as Node;
    if (target !== e.currentTarget && !e.currentTarget.contains(target)) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        step(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        step(-1);
        break;
      case "Home":
        e.preventDefault();
        if (indices[0] != null) focusIndex(indices[0]);
        break;
      case "End":
        e.preventDefault();
        if (indices.length) focusIndex(indices[indices.length - 1]);
        break;
      case "ArrowRight": {
        const item = items[active];
        if (item?.items?.length) {
          e.preventDefault();
          setOpenSub(active);
        }
        break;
      }
      case "ArrowLeft":
        // Let a parent submenu handle closing this level.
        if (submenuSide === "right") {
          e.preventDefault();
          onClose();
        }
        break;
      case "Enter":
      case " ": {
        const item = items[active];
        if (item) {
          e.preventDefault();
          activate(item, active);
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "Tab":
        // Tabbing out of a menu closes it.
        onClose();
        break;
      default: {
        // typeahead: printable single chars
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const now = Date.now();
          const ta = typeahead.current;
          ta.buffer = now - ta.ts > 600 ? e.key : ta.buffer + e.key;
          ta.ts = now;
          const q = ta.buffer.toLowerCase();
          const match = indices.find((i) => {
            const lbl = items[i].label;
            return typeof lbl === "string" && lbl.toLowerCase().startsWith(q);
          });
          if (match != null) focusIndex(match);
        }
      }
    }
  };

  return (
    <div
      ref={listRef}
      role="menu"
      aria-labelledby={labelledBy}
      className="monet-menu-list"
      onKeyDown={onKeyDown}
    >
      {items.map((item, idx) => {
        if (item.separator) {
          return <div key={item.id} role="separator" className="monet-menu-sep" />;
        }
        const hasSub = !!item.items?.length;
        const isCheck = typeof item.checked === "boolean";
        const role = isCheck ? "menuitemcheckbox" : "menuitem";
        const iconPath = item.icon ? (I as Record<string, string>)[item.icon] ?? item.icon : null;

        const row = (
          <div
            key={item.id}
            ref={(n) => {
              itemRefs.current[idx] = n;
            }}
            role={role}
            tabIndex={idx === active ? 0 : -1}
            aria-disabled={item.disabled || undefined}
            aria-checked={isCheck ? item.checked : undefined}
            aria-haspopup={hasSub ? "menu" : undefined}
            aria-expanded={hasSub ? openSub === idx : undefined}
            className={`monet-menu-item${item.disabled ? " is-disabled" : ""}${
              idx === active ? " is-active" : ""
            }`}
            onClick={() => activate(item, idx)}
            onPointerEnter={() => {
              if (!isInteractive(item)) return;
              setActive(idx);
              // Hovering a sibling closes an open submenu; hovering a submenu opens it.
              setOpenSub(hasSub ? idx : null);
            }}
          >
            <span className="monet-menu-check" aria-hidden="true">
              {isCheck && item.checked ? <Icon d={CHECK_PATH} size={13} strokeWidth={1.6} /> : null}
            </span>
            {iconPath ? (
              <span className="monet-menu-icon" aria-hidden="true">
                <Icon d={iconPath} size={14} />
              </span>
            ) : null}
            <span className="monet-menu-label">{item.label}</span>
            {item.shortcut ? <span className="monet-menu-shortcut">{item.shortcut}</span> : null}
            {hasSub ? (
              <span className="monet-menu-arrow" aria-hidden="true">
                <Icon d={I.chevRight} size={12} />
              </span>
            ) : null}
          </div>
        );

        if (!hasSub) return row;

        return (
          <SubMenu
            key={item.id}
            trigger={row}
            triggerRef={{ get current() { return itemRefs.current[idx]; } } as React.RefObject<HTMLElement>}
            items={item.items!}
            open={openSub === idx}
            onClose={() => {
              setOpenSub(null);
              focusIndex(idx);
            }}
            onActivate={(it) => onActivate(it)}
            side={submenuSide}
          />
        );
      })}
    </div>
  );
}

// ─── floating menu panel (shared by every menu surface) ─────────
// Places the `.monet-menu-popover` beside its anchor: in-window through the
// Portal, or in a native popup window in the desktop app, where it may hang past
// the app window. The anchor is a rect or an element (a submenu's row, which may
// itself sit in a native popup); `anchorKey` changes when the anchor moves
// without the panel remounting (MenuBar switching menus, a new right-click).
// `render` wraps the surface; `panelRef` is the panel element.
function useMenuPanel(
  open: boolean,
  getAnchor: () => Element | DOMRect | null,
  place: { side: Side; align: Align; offset: number },
  onClose: () => void,
  anchorKey?: string,
) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<PositionResult>({ left: 0, top: 0, side: place.side });
  const z = useLayer(open);
  const slot = useNativePopup(open);
  useNativePopupHover(slot);
  useNativeKeyForwarding(slot);
  useCloseOnAppBlur(slot, onClose);
  const anchor = useRef(getAnchor);
  anchor.current = getAnchor;
  const { side, align, offset } = place;
  const measure = useCallback(() => {
    const a = anchor.current();
    const p = panelRef.current;
    if (!a || !p) return;
    // Layout size: the pop-in animation's transform must not shrink the window.
    const size = { width: p.offsetWidth, height: p.offsetHeight };
    if (slot) {
      void placeNativePopup(slot, a, size, { side, align, offset }).then(
        (r) => r && setPos((cur) => (cur.side === r.side ? cur : { left: 0, top: 0, side: r.side })),
      );
      return;
    }
    const rect = "getBoundingClientRect" in a ? a.getBoundingClientRect() : a;
    setPos(computePosition(rect, size, { side, align, offset }));
  }, [slot, side, align, offset]);
  useReposition(measure, open);
  useLayoutEffect(() => {
    if (open) measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey]);
  // A native panel's window follows its content's size.
  useEffect(() => {
    const p = panelRef.current;
    const RO = (slot?.win as (Window & typeof globalThis) | undefined)?.ResizeObserver;
    if (!RO || !p) return;
    const ro = new RO(() => measure());
    ro.observe(p);
    return () => ro.disconnect();
  }, [slot, measure]);
  // (#112) Measure the moment the panel attaches — the Portal mounts a tick
  // after `open` flips, so useReposition's one-shot pass runs before it exists.
  const setPanel = useCallback(
    (el: HTMLDivElement | null) => {
      panelRef.current = el;
      if (el) measure();
    },
    [measure],
  );
  const render = (surface: ReactNode) =>
    renderInPopup(
      slot,
      <div
        ref={setPanel}
        className="monet-popover monet-menu-popover"
        data-side={pos.side}
        style={
          slot
            ? { position: "fixed", left: 0, top: 0, width: "max-content" }
            : { position: "fixed", left: pos.left, top: pos.top, zIndex: z }
        }
        // A press must not focus into a native popup's page: that cancels the
        // click in a window that cannot become key (and would blur the app).
        onMouseDown={slot ? (e) => e.preventDefault() : undefined}
      >
        {surface}
      </div>,
      (node) => <Portal>{node}</Portal>,
    );
  return { panelRef, render };
}

// ─── submenu (a menu surface anchored to its parent row) ───────
interface SubMenuProps {
  trigger: ReactNode;
  triggerRef: React.RefObject<HTMLElement | null>;
  items: MenuItemDef[];
  open: boolean;
  onClose: () => void;
  onActivate: (item: MenuItemDef) => void;
  side: Side;
}

function SubMenu({ trigger, triggerRef, items, open, onClose, onActivate, side }: SubMenuProps) {
  // The parent row may itself sit in a native popup: pass the element.
  const { panelRef, render } = useMenuPanel(
    open,
    () => triggerRef.current,
    { side, align: "start", offset: 2 },
    onClose,
  );
  // Submenus live in their own portal; a click inside ANY menu popover (this
  // one or a nested submenu) must not dismiss it — only outside clicks do.
  useDismiss({ onDismiss: onClose, refs: [triggerRef, panelRef], enabled: open, insideSelector: ".monet-menu-popover" });

  return (
    <>
      {trigger}
      {open && render(<MenuSurface items={items} onActivate={onActivate} onClose={onClose} submenuSide={side} />)}
    </>
  );
}

// ─── Menu (a dropdown anchored to an arbitrary trigger) ────────
export interface MenuProps {
  items: MenuItemDef[];
  /** Render-prop / element trigger; receives open state + props to spread. */
  children: (api: {
    ref: (n: HTMLElement | null) => void;
    open: boolean;
    toggle: () => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    id: string;
  }) => ReactNode;
  side?: Side;
  align?: "start" | "center" | "end";
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** A dropdown menu bound to a custom trigger via render-prop. */
export function Menu({ items, children, side = "bottom", align = "start", open: openProp, onOpenChange }: MenuProps) {
  const id = useMonetId("monet-menu");
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const triggerRef = useRef<HTMLElement | null>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenState(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const dismiss = useCallback(() => setOpen(false), [setOpen]);
  const { panelRef, render } = useMenuPanel(
    open,
    () => triggerRef.current,
    { side, align, offset: 4 },
    dismiss,
  );
  // A click in a nested submenu popover (separate portal) must keep this menu open.
  useDismiss({ onDismiss: () => setOpen(false), refs: [triggerRef, panelRef], enabled: open, insideSelector: ".monet-menu-popover" });

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, [setOpen]);

  return (
    <>
      {children({
        ref: (n) => {
          triggerRef.current = n;
        },
        open,
        toggle: () => setOpen(!open),
        "aria-haspopup": "menu",
        "aria-expanded": open,
        id,
      })}
      {open && render(<MenuSurface items={items} labelledBy={id} onActivate={close} onClose={close} />)}
    </>
  );
}

// ─── MenuBar (the data-driven chrome menu bar) ─────────────────
export interface MenuBarEntry {
  /** Stable id for the top-level menu. */
  id: string;
  /** Visible label, e.g. "File". */
  label: ReactNode;
  /** The menu's items. */
  items: MenuItemDef[];
  disabled?: boolean;
}

export interface MenuBarProps {
  menus: MenuBarEntry[];
  /** Extra className on the menubar row (chrome supplies its own look). */
  className?: string;
  /** Class applied to each top-level menu button. */
  itemClassName?: string;
  /** Class applied to an open top-level menu button. */
  openClassName?: string;
}

/**
 * A horizontal application menu bar. Click or arrow-key to open a menu; once a
 * menu is open, hovering siblings switches between them; Left/Right move
 * between top-level menus. Renders each dropdown through the Portal.
 */
export function MenuBar({
  menus,
  className,
  itemClassName = "monet-menu",
  openClassName = "is-open",
}: MenuBarProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const baseId = useMonetId("monet-menubar");

  const openEntry = menus.find((m) => m.id === openId) ?? null;
  const dismiss = useCallback(() => setOpenId(null), []);
  const { panelRef, render } = useMenuPanel(
    openId != null,
    () => (openId ? btnRefs.current[openId] ?? null : null),
    { side: "bottom", align: "start", offset: 4 },
    dismiss,
    openId ?? undefined,
  );
  // Clicks inside a submenu popover (separate portal) must not close the bar's menu.
  useDismiss({ onDismiss: () => setOpenId(null), refs: [barRef, panelRef], enabled: openId != null, insideSelector: ".monet-menu-popover" });

  const enabled = menus.map((m, i) => (m.disabled ? -1 : i)).filter((i) => i >= 0);

  const moveTo = (i: number) => {
    const entry = menus[i];
    if (!entry) return;
    setActive(i);
    btnRefs.current[entry.id]?.focus();
    if (openId != null) setOpenId(entry.id); // keep open state when arrowing across the bar
  };

  const onBarKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // A dropdown/submenu renders through the Portal but is still a React CHILD
    // of this surface, and React bubbles through the REACT tree — so without
    // this guard every keystroke inside a portalled descendant is replayed here
    // too (ArrowRight in a submenu would also step the menu bar). DOM
    // containment is exactly the test: a portalled node is not inside us.
    const target = e.target as Node;
    if (target !== e.currentTarget && !e.currentTarget.contains(target)) return;
    const cur = enabled.indexOf(active);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      moveTo(enabled[(cur + 1) % enabled.length]);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveTo(enabled[(cur - 1 + enabled.length) % enabled.length]);
    } else if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      const entry = menus[active];
      if (entry && !entry.disabled) {
        e.preventDefault();
        setOpenId(entry.id);
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      moveTo(enabled[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      moveTo(enabled[enabled.length - 1]);
    } else if (e.key === "Escape") {
      setOpenId(null);
    }
  };

  const close = useCallback(() => {
    const id = openId;
    setOpenId(null);
    if (id) btnRefs.current[id]?.focus();
  }, [openId]);

  return (
    <div
      ref={barRef}
      role="menubar"
      aria-label="Application menu"
      className={`monet-menubar${className ? ` ${className}` : ""}`}
      onKeyDown={onBarKeyDown}
    >
      {menus.map((m, i) => (
        <button
          key={m.id}
          ref={(n) => {
            btnRefs.current[m.id] = n;
          }}
          type="button"
          role="menuitem"
          id={`${baseId}-${m.id}`}
          tabIndex={i === active ? 0 : -1}
          aria-haspopup="menu"
          aria-expanded={openId === m.id}
          aria-disabled={m.disabled || undefined}
          disabled={m.disabled}
          className={`${itemClassName}${openId === m.id ? ` ${openClassName}` : ""}`}
          onClick={() => {
            setActive(i);
            setOpenId(openId === m.id ? null : m.id);
          }}
          onPointerEnter={() => {
            setActive(i);
            if (openId != null && !m.disabled) setOpenId(m.id);
          }}
          onFocus={() => setActive(i)}
        >
          {m.label}
        </button>
      ))}
      {openEntry &&
        render(
          <MenuSurface
            // (#178) MenuBar is the one surface that swaps `items` in place
            // (hovering / arrowing to a sibling menu). Key it so switching
            // menus remounts — one auto-focus per opened menu, and no stale
            // active row carried over from the previous one.
            key={openEntry.id}
            items={openEntry.items}
            labelledBy={`${baseId}-${openEntry.id}`}
            onActivate={close}
            onClose={close}
          />,
        )}
    </div>
  );
}

// ─── ContextMenu (opens at the pointer on contextmenu) ─────────
export interface ContextMenuProps {
  items: MenuItemDef[];
  /** The region that triggers the menu on right-click / contextmenu. */
  children: ReactNode;
  /** Wrapper className. */
  className?: string;
}

interface CtxState {
  open: boolean;
  x: number;
  y: number;
}

/**
 * Wrap any region to show a menu at the pointer on the `contextmenu` event.
 * Fully keyboard-navigable once open; dismiss on Escape / outside / select.
 */
export function ContextMenu({ items, children, className }: ContextMenuProps) {
  const [state, setState] = useState<CtxState>({ open: false, x: 0, y: 0 });
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setState({ open: true, x: e.clientX, y: e.clientY });
  };

  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  // Anchor to a zero-size rect at the pointer so the menu opens at the click.
  const { panelRef, render } = useMenuPanel(
    state.open,
    () => new DOMRect(state.x, state.y, 0, 0),
    { side: "bottom", align: "start", offset: 0 },
    close,
    `${state.x},${state.y}`,
  );
  useDismiss({ onDismiss: close, refs: [panelRef], enabled: state.open, insideSelector: ".monet-menu-popover" });

  return (
    <div ref={wrapRef} className={className} onContextMenu={onContextMenu}>
      {children}
      {state.open && render(<MenuSurface items={items} onActivate={close} onClose={close} />)}
    </div>
  );
}
