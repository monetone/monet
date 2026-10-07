// ─────────────────────────────────────────────────────────────
// Monet · DesignCanvas — section / artboard / post-it items
// ─────────────────────────────────────────────────────────────
// The renderable pieces of the canvas world: DCSection (editable title + a
// reorderable row of artboards), DCArtboard (a marker, rendered by
// DCArtboardFrame), DCPostIt (a sticky note), and the inline-rename DCEditable.
//
// Visuals live in @monet-ui/monet-core/canvas.css under the "monet-dc-"
// prefix; this file owns behaviour + accessibility only:
//   • grip reorder is pointer-drag AND keyboard-operable (←/→/Home/End move,
//     Space picks up / drops — announced via aria),
//   • labels/titles are real contentEditable with aria-label + role,
//   • the ⋯ menu is a role="menu" with arming two-click delete,
//   • everything actionable is focusable with :focus-visible (CSS).

import React from "react";
import { useDCContext } from "./canvas-context";
import { Portal, computePosition, useDismiss, useLayer, useReposition } from "./overlay-core";
import {
  dcExport,
  dcFlatten,
  type DCArtboardProps,
  type DCSectionProps,
  type DCPostItProps,
  type DCExportKind,
} from "./canvas-export";

// ─── DCEditable — inline rename ─────────────────────────────────

interface DCEditableProps {
  value?: string;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
  tag?: "span" | "div";
  /** Accessible name for the editable region (it has no associated <label>). */
  ariaLabel?: string;
  onClick?: (e: React.MouseEvent) => void;
}

/** Inline rename — commits on blur or Enter. A real contentEditable region with
 *  `role="textbox"` + an `aria-label` so screen readers announce it. */
export function DCEditable({
  value,
  onChange,
  style,
  tag = "span",
  ariaLabel,
  onClick,
}: DCEditableProps) {
  const T = tag as keyof React.JSX.IntrinsicElements;
  return React.createElement(
    T,
    {
      className: "monet-dc-editable",
      contentEditable: true,
      suppressContentEditableWarning: true,
      role: "textbox",
      "aria-label": ariaLabel,
      "aria-multiline": false,
      tabIndex: 0,
      spellCheck: false,
      onClick,
      onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
      onBlur: (e: React.FocusEvent<HTMLElement>) =>
        onChange && onChange(e.currentTarget.textContent ?? ""),
      onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          // Cancel: restore and bail without committing this edit.
          e.preventDefault();
          e.currentTarget.textContent = value ?? "";
          e.currentTarget.blur();
        }
      },
      style,
    },
    value,
  );
}

// ─── DCArtboard — marker; rendered by DCArtboardFrame via DCSection ──

/** A single design surface. A marker component: DCSection discovers it by type
 *  and renders it through [`DCArtboardFrame`]. Rendering it directly is a no-op. */
export function DCArtboard(_props: DCArtboardProps): React.JSX.Element | null {
  return null;
}

// ─── DCArtboardFrame — chrome + card + reorder + export + delete ──

interface DCArtboardFrameProps {
  artboard: React.ReactElement<DCArtboardProps>;
  label?: string;
  order: string[];
  onRename: (value: string) => void;
  onReorder: (next: string[]) => void;
  onFocus: () => void;
  onDelete: () => void;
  /** Move this artboard to `index` in the section order (keyboard reorder). */
  onMoveTo: (index: number) => void;
}

function DCArtboardFrame({
  artboard,
  label,
  order,
  onRename,
  onReorder,
  onFocus,
  onDelete,
  onMoveTo,
}: DCArtboardFrameProps) {
  const {
    id: rawId,
    label: rawLabel,
    width = 260,
    height = 480,
    children,
    style = {},
  } = artboard.props;
  const id = (rawId ?? rawLabel) as string;
  const ref = React.useRef<HTMLDivElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const kebabRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [grabbed, setGrabbed] = React.useState(false);

  const idx = order.indexOf(id);
  const count = order.length;

  // ⋯ menu: portalled + fixed so the viewport's overflow and the world's
  // transform can't clip it; closes on Escape or any outside pointerdown.
  // Two-click delete lives inside the menu — first click arms the row, second
  // commits; closing disarms.
  const menuZ = useLayer(menuOpen);
  const [menuPos, setMenuPos] = React.useState({ left: 0, top: 0 });
  const placeMenu = React.useCallback(() => {
    const a = kebabRef.current;
    const m = menuRef.current;
    if (a && m)
      setMenuPos(computePosition(a.getBoundingClientRect(), { width: m.offsetWidth, height: m.offsetHeight }, { side: "bottom", align: "end", offset: 4 }));
  }, []);
  useReposition(placeMenu, menuOpen);
  // The Portal mounts after the `open` commit, so place the menu as it attaches.
  const setMenu = React.useCallback(
    (el: HTMLDivElement | null) => {
      menuRef.current = el;
      if (el) placeMenu();
    },
    [placeMenu],
  );
  useDismiss({ onDismiss: () => setMenuOpen(false), refs: [kebabRef, menuRef], enabled: menuOpen });
  React.useEffect(() => {
    if (!menuOpen) setConfirming(false);
  }, [menuOpen]);

  const doExport = (kind: DCExportKind) => {
    setMenuOpen(false);
    if (!cardRef.current) return;
    const name = String(label || id || "artboard").replace(/[^\w\s.-]+/g, "_");
    dcExport(cardRef.current, width, height, name, kind).catch((e) =>
      console.error("[monet-dc] export failed:", e),
    );
  };

  // Live drag-reorder: the dragged card sticks to the cursor; siblings slide
  // into their would-be slots in real time via transforms. DOM order only
  // changes on drop. Pointer deltas are screen-space; translateX is local
  // (pre-scale) space — divide by the viewport scale so it tracks at any zoom.
  const onGripDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const me = ref.current;
    if (!me) return;
    const scale = me.getBoundingClientRect().width / me.offsetWidth || 1;
    // (#208) Query the section SUBTREE instead of interpolating sectionId into
    // a selector: the id falls back to the human-authored title, and a `"`, `\`
    // or `]` in it made querySelectorAll throw SyntaxError out of this handler
    // (drag-reorder silently dead for that section).
    const root = me.closest<HTMLElement>("[data-dc-section]") ?? document;
    const peers = Array.from(root.querySelectorAll<HTMLElement>("[data-dc-slot]"));
    const homes = peers.map((el) => ({
      el,
      id: el.dataset.dcSlot as string,
      x: el.getBoundingClientRect().left,
    }));
    const slotXs = homes.map((h) => h.x);
    const startIdx = order.indexOf(id);
    const startX = e.clientX;
    let liveOrder = order.slice();
    me.classList.add("monet-dc-dragging");

    const layout = () => {
      for (const h of homes) {
        if (h.id === id) continue;
        const slot = liveOrder.indexOf(h.id);
        h.el.style.transform = `translateX(${(slotXs[slot] - h.x) / scale}px)`;
      }
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      me.style.transform = `translateX(${dx / scale}px)`;
      const cur = homes[startIdx].x + dx;
      let nearest = 0;
      let best = Infinity;
      for (let i = 0; i < slotXs.length; i++) {
        const d = Math.abs(slotXs[i] - cur);
        if (d < best) {
          best = d;
          nearest = i;
        }
      }
      if (liveOrder.indexOf(id) !== nearest) {
        liveOrder = order.filter((k) => k !== id);
        liveOrder.splice(nearest, 0, id);
        layout();
      }
    };

    // (#204) pointercancel fires INSTEAD of pointerup when the browser takes
    // the pointer over (touch pan/zoom, pen out of range). Without it `up`
    // never runs: the listeners leak, the row keeps its drag transform and
    // .monet-dc-dragging, and the reorder is silently dropped.
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      const finalSlot = liveOrder.indexOf(id);
      me.classList.remove("monet-dc-dragging");
      me.style.transform = `translateX(${(slotXs[finalSlot] - homes[startIdx].x) / scale}px)`;
      // After the settle transition, kill transitions + clear transforms +
      // commit the reorder in the same frame so there's no visual snap-back.
      setTimeout(() => {
        for (const h of homes) {
          h.el.style.transition = "none";
          h.el.style.transform = "";
        }
        if (liveOrder.join("|") !== order.join("|")) onReorder(liveOrder);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            for (const h of homes) h.el.style.transition = "";
          }),
        );
      }, 180);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  };

  // Keyboard reorder on the grip: Space/Enter toggles "grabbed" mode (announced
  // via aria-pressed + aria-label), then ←/→ move one slot and Home/End jump to
  // the ends. Esc drops without moving. Works at any zoom; no pointer needed.
  const onGripKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setGrabbed((g) => !g);
      return;
    }
    if (e.key === "Escape") {
      if (grabbed) {
        e.preventDefault();
        setGrabbed(false);
      }
      return;
    }
    if (!grabbed) return;
    let next = idx;
    if (e.key === "ArrowLeft") next = Math.max(0, idx - 1);
    else if (e.key === "ArrowRight") next = Math.min(count - 1, idx + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else return;
    e.preventDefault();
    if (next !== idx) onMoveTo(next);
  };

  const slotPos = `${idx + 1} of ${count}`;
  return (
    <div ref={ref} data-dc-slot={id} className="monet-dc-slot" role="listitem"
      style={{ position: "relative", flexShrink: 0 }}>
      <div
        className="monet-dc-header"
        data-omelette-chrome=""
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="monet-dc-labelrow">
          <button
            type="button"
            className="monet-dc-grip"
            onPointerDown={onGripDown}
            onKeyDown={onGripKeyDown}
            aria-pressed={grabbed}
            aria-label={
              grabbed
                ? `Moving ${label || id}, position ${slotPos}. Use arrow keys to move, Space to drop`
                : `Reorder ${label || id}, position ${slotPos}. Press Space to pick up`
            }
            title="Drag to reorder"
          >
            <svg width="9" height="13" viewBox="0 0 9 13" fill="currentColor" aria-hidden="true">
              <circle cx="2" cy="2" r="1.1" />
              <circle cx="7" cy="2" r="1.1" />
              <circle cx="2" cy="6.5" r="1.1" />
              <circle cx="7" cy="6.5" r="1.1" />
              <circle cx="2" cy="11" r="1.1" />
              <circle cx="7" cy="11" r="1.1" />
            </svg>
          </button>
          <div
            className="monet-dc-labeltext"
            onClick={onFocus}
            title="Click to focus"
          >
            <DCEditable
              value={label}
              onChange={onRename}
              ariaLabel="Artboard label"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
        <div className="monet-dc-btns">
          <button
            ref={kebabRef}
            type="button"
            className="monet-dc-kebab"
            title="More"
            aria-label="Artboard actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <circle cx="2.5" cy="6" r="1.1" />
              <circle cx="6" cy="6" r="1.1" />
              <circle cx="9.5" cy="6" r="1.1" />
            </svg>
          </button>
          {menuOpen && (
            <Portal>
              <div
                ref={setMenu}
                className="monet-dc-menu"
                role="menu"
                aria-label="Artboard actions"
                style={{ left: menuPos.left, top: menuPos.top, zIndex: menuZ }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button type="button" role="menuitem" onClick={() => doExport("png")}>
                  Download PNG
                </button>
                <button type="button" role="menuitem" onClick={() => doExport("html")}>
                  Download HTML
                </button>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  className="monet-dc-danger"
                  onClick={() => {
                    if (confirming) {
                      setMenuOpen(false);
                      onDelete();
                    } else setConfirming(true);
                  }}
                >
                  {confirming ? "Click again to delete" : "Delete"}
                </button>
              </div>
            </Portal>
          )}
          <button
            type="button"
            className="monet-dc-expand"
            onClick={onFocus}
            title="Focus"
            aria-label={`Open ${label || id} in focus view`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M7 1h4v4M5 11H1V7M11 1L7.5 4.5M1 11l3.5-3.5" />
            </svg>
          </button>
        </div>
      </div>
      <div
        ref={cardRef}
        className="monet-dc-card"
        style={{ width, height, ...style }}
      >
        {children || <div className="monet-dc-placeholder">{id}</div>}
      </div>
    </div>
  );
}

// ─── DCSection — editable title + reorderable artboard row ──────

/** A labelled group: an editable title/subtitle above a horizontal,
 *  reorderable row of [`DCArtboard`]s rendered in the user's persisted order. */
export function DCSection({ id, title, subtitle, children, gap = 48 }: DCSectionProps) {
  const ctx = useDCContext();
  const sid = (id ?? title) as string;
  const all = React.Children.toArray(dcFlatten(children));
  const artboards = all.filter(
    (c): c is React.ReactElement<DCArtboardProps> =>
      React.isValidElement(c) && c.type === DCArtboard,
  );
  const rest = all.filter(
    (c) => !(React.isValidElement(c) && c.type === DCArtboard),
  );
  const sec = (ctx && sid && ctx.section(sid)) || {};
  // Must match DesignCanvas's srcKey computation exactly (it filters falsy
  // IDs), or onDelete persists a srcKey DesignCanvas never recognizes.
  const allIds = artboards
    .map((a) => a.props.id ?? a.props.label)
    .filter(Boolean) as string[];
  const srcKey = allIds.join("\x1f");
  const hidden = sec.srcKey === srcKey ? sec.hidden || [] : [];
  const srcOrder = allIds.filter((k) => !hidden.includes(k));

  const order = React.useMemo(() => {
    const kept = (sec.order || []).filter((k) => srcOrder.includes(k));
    return [...kept, ...srcOrder.filter((k) => !kept.includes(k))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sec.order, srcOrder.join("|")]);

  const byId: Record<string, React.ReactElement<DCArtboardProps>> =
    Object.fromEntries(artboards.map((a) => [a.props.id ?? a.props.label, a]));

  const move = (k: string, toIndex: number) => {
    if (!ctx) return;
    const next = order.filter((x) => x !== k);
    next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, k);
    ctx.patchSection(sid, { order: next });
  };

  // marginBottom counter-scales so the on-screen gap between sections stays
  // constant. paddingBottom is just enough for the 24px artboard header
  // (abs-positioned above each card) plus ~8px.
  return (
    <div
      data-dc-section={sid}
      className="monet-dc-section"
      style={{ marginBottom: "calc(80px * var(--dc-inv-zoom, 1))", position: "relative" }}
    >
      <div style={{ padding: "0 60px" }}>
        <div className="monet-dc-sectionhead">
          <DCEditable
            tag="div"
            value={sec.title ?? title}
            ariaLabel="Section title"
            onChange={(v) => ctx && sid && ctx.patchSection(sid, { title: v })}
            style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.4, marginBottom: 6, display: "inline-block" }}
          />
          {subtitle && <div className="monet-dc-subtitle">{subtitle}</div>}
        </div>
      </div>
      <div
        className="monet-dc-row"
        role="list"
        aria-label={`${sec.title ?? title ?? "Section"} artboards`}
        style={{ gap, padding: "0 60px" }}
      >
        {order.map((k) => (
          <DCArtboardFrame
            key={k}
            artboard={byId[k]}
            order={order}
            label={(sec.labels || {})[k] ?? byId[k].props.label}
            onRename={(v) =>
              ctx &&
              ctx.patchSection(sid, (x) => ({ labels: { ...x.labels, [k]: v } }))
            }
            onReorder={(next) => ctx && ctx.patchSection(sid, { order: next })}
            onMoveTo={(i) => move(k, i)}
            onDelete={() =>
              ctx &&
              ctx.patchSection(sid, (x) => ({
                hidden: [
                  ...(x.srcKey === srcKey ? x.hidden || [] : []),
                  k,
                ],
                srcKey,
              }))
            }
            onFocus={() => ctx && ctx.setFocus(`${sid}/${k}`)}
          />
        ))}
      </div>
      {rest}
    </div>
  );
}

// ─── DCPostIt — absolute-positioned sticky note ─────────────────

/** A decorative sticky note placed absolutely within a section/world. */
export function DCPostIt({
  children,
  top,
  left,
  right,
  bottom,
  rotate = -2,
  width = 180,
}: DCPostItProps) {
  return (
    <div
      className="monet-dc-postit"
      style={{
        top,
        left,
        right,
        bottom,
        width,
        transform: `rotate(${rotate}deg)`,
      }}
    >
      {children}
    </div>
  );
}
