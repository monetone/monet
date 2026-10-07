// ─────────────────────────────────────────────────────────────
// Monet · overlay core — Portal, hooks, Tooltip, Popover
// ─────────────────────────────────────────────────────────────
// The foundation for every floating layer (tooltips, popovers, menus,
// dialogs, toasts). Self-contained: no dependency on the controls layer.
// All visuals live in monet-core/overlays.css; this file owns behavior +
// accessibility only (focus management, dismiss handling, positioning).
//
// Exports:
//   <Portal> ......... renders children into a managed root on document.body
//   useFocusTrap ..... cycle Tab inside a container, restore focus on unmount
//   useDismiss ....... Escape + outside-pointerdown dismissal
//   useLayer / useId . z-index stacking + stable ids
//   computePosition .. anchored placement with viewport flip / shift
//   <Tooltip> ........ hover + focus tooltip, role="tooltip", aria-describedby
//   <Popover> ........ anchored floating panel, flip/shift, focus + dismiss
//
// Contracts are intentionally small and composable; menu.tsx and dialog.tsx
// build on top of these without re-implementing the plumbing.

import React, {
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId as useReactId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ForwardedRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

// ─── stable ids ────────────────────────────────────────────────
// Thin wrapper over React 18's useId so callers can opt into a prefix that
// reads well in the accessibility tree (e.g. "monet-tooltip-:r3:").
export function useMonetId(prefix = "monet"): string {
  const raw = useReactId();
  return `${prefix}-${raw.replace(/[:]/g, "")}`;
}

// ─── managed portal root ───────────────────────────────────────
// A single <div id="monet-overlay-root"> is appended to <body> the first time
// any overlay mounts and reused thereafter. Living outside the app subtree
// keeps overlays clear of ancestor overflow/transform/z-index traps.
const ROOT_ID = "monet-overlay-root";

function getOverlayRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let el = document.getElementById(ROOT_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.className = "monet-overlay-root";
    document.body.appendChild(el);
  }
  return el;
}

export interface PortalProps {
  children: ReactNode;
  /** Render into a specific element instead of the managed body root. */
  container?: HTMLElement | null;
}

/** Render `children` into the managed overlay root (or a custom `container`). */
export function Portal({ children, container }: PortalProps): React.ReactPortal | null {
  // Resolve the target only on the client, after mount, so SSR/first paint is a no-op.
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setTarget(container ?? getOverlayRoot());
  }, [container]);
  if (!target) return null;
  return createPortal(children, target);
}

// ─── z-index stacking ──────────────────────────────────────────
// A simple monotonically increasing counter so nested layers (a popover that
// opens a menu, a dialog that raises a toast) always stack above their opener.
// Base 1000 sits above the in-window chrome (which tops out around z-index 95).
const Z_BASE = 1000;
let _zCounter = 0;

/** Reserve a z-index for one overlay instance, fresh on every activation. */
export function useLayer(active = true): number {
  const ref = useRef<number | null>(null);
  // (#115) Release the reservation when the layer closes: holding it for the
  // component's whole lifetime made a reopened overlay keep its original, now
  // low z and render *under* any layer that opened after it.
  if (!active) ref.current = null;
  else if (ref.current === null) ref.current = Z_BASE + (_zCounter += 2);
  return ref.current ?? Z_BASE;
}

// ─── focus trap ────────────────────────────────────────────────
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
  );
}

export interface FocusTrapOptions {
  /** Trap only while true (lets a dialog enable the trap on open). */
  active?: boolean;
  /** Move focus into the container on activate (default true). */
  autoFocus?: boolean;
  /** Restore focus to the previously-focused element on deactivate (default true). */
  restoreFocus?: boolean;
}

/**
 * Confine Tab/Shift+Tab to focusable elements inside `ref`. On activate, focus
 * moves to the first focusable child (or the container itself); on deactivate
 * focus returns to whatever was focused before. Used by Dialog and Menu.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  { active = true, autoFocus = true, restoreFocus = true }: FocusTrapOptions = {},
): void {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    let frame = 0;
    let node: HTMLElement | null = null;
    let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

    const activate = () => {
      node = ref.current;
      // Portal children mount after their owner's passive effects. Retry on the
      // next frame so a modal rendered through Portal still gets its trap.
      if (!node) {
        frame = requestAnimationFrame(activate);
        return;
      }

      if (autoFocus && !node.contains(document.activeElement)) {
        const focusables = focusableWithin(node);
        const first = focusables[0] ?? node;
        // Ensure the container is focusable as a fallback target.
        if (first === node && !node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
        first.focus();
      }

      onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Tab" || !node) return;
        const focusables = focusableWithin(node);
        if (focusables.length === 0) {
          e.preventDefault();
          node.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const activeEl = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (activeEl === first || !node.contains(activeEl)) {
            e.preventDefault();
            last.focus();
          }
        } else if (activeEl === last || !node.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      };

      node.addEventListener("keydown", onKeyDown);
    };

    activate();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (node && onKeyDown) node.removeEventListener("keydown", onKeyDown);
      if (restoreFocus) previouslyFocused.current?.focus?.();
    };
  }, [active, autoFocus, restoreFocus, ref]);
}

// ─── dismiss (Escape + outside pointerdown) ────────────────────
export interface DismissOptions {
  /** Called when an Escape press or an outside pointerdown is detected. */
  onDismiss: () => void;
  /** Elements considered "inside" — a press within any of them is ignored. */
  refs: Array<RefObject<HTMLElement | null>>;
  /** Disable the whole behavior (e.g. while closed). Default true. */
  enabled?: boolean;
  /** Close on Escape (default true). */
  escapeKey?: boolean;
  /** Close on outside pointerdown (default true). */
  outsidePointer?: boolean;
  /** Also treat a press inside any element matching this CSS selector as
   *  "inside" — even when it lives in a separate portal not covered by `refs`
   *  (e.g. a submenu popover whose parent menu owns the dismiss). */
  insideSelector?: string;
}

// (#116) Escape must dismiss only the TOP-MOST layer. Every open layer binds its
// own listener on `document`, and stopPropagation cannot suppress listeners that
// are co-located on the same node — so keep a LIFO stack of the layers currently
// listening for Escape and let only the last-registered one act. It then calls
// preventDefault(), which the `e.defaultPrevented` guard turns into a skip for
// every other layer (and for any consumer handler further up).
const _escapeStack: object[] = [];

/**
 * Dismiss a layer on Escape or a pointerdown outside all `refs`. Pointer
 * handling uses the capture phase so it still fires when inner handlers
 * stopPropagation. Escape is bound on keydown and only reaches the top-most
 * (most recently enabled) layer.
 */
export function useDismiss({
  onDismiss,
  refs,
  enabled = true,
  escapeKey = true,
  outsidePointer = true,
  insideSelector,
}: DismissOptions): void {
  // Keep the latest callback without re-subscribing listeners every render.
  const cb = useRef(onDismiss);
  cb.current = onDismiss;

  useEffect(() => {
    if (!enabled) return;

    const token = {};
    if (escapeKey) _escapeStack.push(token);

    const isInside = (target: Node | null) => {
      if (!target) return false;
      if (refs.some((r) => r.current && r.current.contains(target))) return true;
      const el = target instanceof Element ? target : target.parentElement;
      // A Select's portalled listbox belongs to whichever layer opened it (it
      // closes on any press outside itself, so it is only ever the top layer).
      if (el?.closest(".monet-listbox")) return true;
      if (insideSelector && el?.closest(insideSelector)) return true;
      return false;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!outsidePointer) return;
      if (!isInside(e.target as Node | null)) cb.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!escapeKey || e.defaultPrevented) return;
      if (e.key === "Escape") {
        if (_escapeStack[_escapeStack.length - 1] !== token) return;
        e.preventDefault();
        e.stopPropagation();
        cb.current();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      const i = _escapeStack.indexOf(token);
      if (i >= 0) _escapeStack.splice(i, 1);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
    // refs identity is stable per render in practice; spread its members to be safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, escapeKey, outsidePointer, insideSelector, ...refs]);
}

// ─── positioning ───────────────────────────────────────────────
export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export interface PositionOptions {
  side?: Side;
  align?: Align;
  /** Gap between anchor and floating element, in px. */
  offset?: number;
  /** Viewport padding kept clear when flipping/shifting, in px. */
  padding?: number;
}

export interface PositionResult {
  left: number;
  top: number;
  /** The side actually used after any viewport flip. */
  side: Side;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/**
 * Place a `floating` box of the given size relative to an `anchor` rect.
 * Flips to the opposite side when it would overflow the viewport, then shifts
 * along the cross axis to stay within `padding` of the edges. Pure function —
 * callers feed measured rects and apply the result.
 */
export function computePosition(
  anchor: DOMRect,
  floating: { width: number; height: number },
  { side = "bottom", align = "center", offset = 8, padding = 8 }: PositionOptions = {},
): PositionResult {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;

  const fits = (s: Side): boolean => {
    if (s === "top") return anchor.top - offset - floating.height >= padding;
    if (s === "bottom") return anchor.bottom + offset + floating.height <= vh - padding;
    if (s === "left") return anchor.left - offset - floating.width >= padding;
    return anchor.right + offset + floating.width <= vw - padding;
  };

  let used = side;
  if (!fits(side) && fits(OPPOSITE[side])) used = OPPOSITE[side];

  const isVertical = used === "top" || used === "bottom";

  // Main-axis placement.
  let top: number;
  let left: number;
  if (used === "top") top = anchor.top - offset - floating.height;
  else if (used === "bottom") top = anchor.bottom + offset;
  else top = anchor.top; // left/right resolved below on cross axis
  if (used === "left") left = anchor.left - offset - floating.width;
  else if (used === "right") left = anchor.right + offset;
  else left = anchor.left; // top/bottom resolved below on cross axis

  // Cross-axis alignment.
  if (isVertical) {
    if (align === "center") left = anchor.left + anchor.width / 2 - floating.width / 2;
    else if (align === "end") left = anchor.right - floating.width;
    else left = anchor.left;
  } else {
    if (align === "center") top = anchor.top + anchor.height / 2 - floating.height / 2;
    else if (align === "end") top = anchor.bottom - floating.height;
    else top = anchor.top;
  }

  // Shift to keep within the viewport.
  left = Math.max(padding, Math.min(left, vw - padding - floating.width));
  top = Math.max(padding, Math.min(top, vh - padding - floating.height));

  return { left, top, side: used };
}

/**
 * Subscribe to layout changes (scroll/resize) and re-run a measure callback.
 * Used by Popover/Tooltip/Menu to keep their position glued to the anchor.
 */
export function useReposition(measure: () => void, enabled = true): void {
  const cb = useRef(measure);
  cb.current = measure;
  useLayoutEffect(() => {
    if (!enabled) return;
    const run = () => cb.current();
    run();
    window.addEventListener("scroll", run, true);
    window.addEventListener("resize", run);
    return () => {
      window.removeEventListener("scroll", run, true);
      window.removeEventListener("resize", run);
    };
  }, [enabled]);
}

// ─── Tooltip ───────────────────────────────────────────────────
export interface TooltipProps {
  /** Tooltip text/content (string or simple inline node). */
  content: ReactNode;
  /** The trigger element — must accept a ref and the spread aria props. */
  children: ReactElement;
  side?: Side;
  align?: Align;
  /** Hover/focus open delay in ms (default 400). */
  delay?: number;
  /** Disable the tooltip entirely. */
  disabled?: boolean;
}

/**
 * Accessible tooltip shown on hover AND keyboard focus after `delay`. Wires
 * `aria-describedby` from the trigger to the tooltip (role="tooltip"). Closes
 * on blur, pointer leave, or Escape.
 *
 * Composable: it is a `forwardRef` component and spreads any extra props it
 * receives onto its trigger child, so it can nest *inside* another anchored
 * primitive (e.g. `<Popover><Tooltip>{el}</Tooltip></Popover>`) and share the
 * same DOM anchor — the parent's injected ref + aria flow through to `el`.
 */
export const Tooltip = forwardRef(function Tooltip(
  {
    content,
    children,
    side = "top",
    align = "center",
    delay = 400,
    disabled = false,
    ...rest
  }: TooltipProps,
  forwardedRef: ForwardedRef<HTMLElement>,
) {
  const id = useMonetId("monet-tooltip");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PositionResult>({ left: 0, top: 0, side });
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const z = useLayer(open);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback(() => {
    if (disabled) return;
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [disabled, delay]);
  const hide = useCallback(() => {
    clear();
    setOpen(false);
  }, []);

  useEffect(() => () => clear(), []);

  const measure = useCallback(() => {
    const a = anchorRef.current;
    const t = tipRef.current;
    if (!a || !t) return;
    setPos(
      computePosition(a.getBoundingClientRect(), { width: t.offsetWidth, height: t.offsetHeight }, { side, align, offset: 6 }),
    );
  }, [side, align]);
  useReposition(measure, open);
  // The Portal mounts its children a tick after `open` flips (it resolves its
  // target in an effect), so useReposition's first measure runs before this div
  // exists and bails. Measure again the moment the node attaches, or the tip is
  // stuck at its initial {0,0} (top-left of the viewport).
  const setTip = useCallback(
    (node: HTMLDivElement | null) => {
      tipRef.current = node;
      if (node) measure();
    },
    [measure],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hide]);

  if (!isValidElement(children)) return children ?? null;

  const childProps = children.props as Record<string, unknown>;
  const describedBy = [childProps["aria-describedby"], open ? id : null].filter(Boolean).join(" ") || undefined;

  const trigger = cloneElement(children as ReactElement<any>, {
    // Spread any props the parent injected (e.g. a wrapping Popover's
    // aria-haspopup/expanded) onto the shared anchor first, then layer the
    // tooltip's own ref/handlers/aria on top so they always win.
    ...rest,
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const r = (children as any).ref;
      if (typeof r === "function") r(node);
      else if (r && typeof r === "object") (r as any).current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef && typeof forwardedRef === "object") forwardedRef.current = node;
    },
    "aria-describedby": describedBy,
    onPointerEnter: (e: React.PointerEvent) => {
      (childProps.onPointerEnter as ((e: React.PointerEvent) => void) | undefined)?.(e);
      show();
    },
    onPointerLeave: (e: React.PointerEvent) => {
      (childProps.onPointerLeave as ((e: React.PointerEvent) => void) | undefined)?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      (childProps.onFocus as ((e: React.FocusEvent) => void) | undefined)?.(e);
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      (childProps.onBlur as ((e: React.FocusEvent) => void) | undefined)?.(e);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {open && (
        <Portal>
          <div
            ref={setTip}
            id={id}
            role="tooltip"
            className="monet-tooltip"
            data-side={pos.side}
            style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: z }}
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  );
});

// ─── Popover ───────────────────────────────────────────────────
export interface PopoverProps {
  /** Controls visibility. */
  open: boolean;
  /** Called when the popover requests close (Escape / outside click). */
  onOpenChange: (open: boolean) => void;
  /** The anchor element — must accept a ref. */
  children: ReactElement;
  /** Floating content. */
  content: ReactNode;
  side?: Side;
  align?: Align;
  offset?: number;
  /** Accessible label for the floating panel. */
  label?: string;
  /** Id of an element that labels the panel (alternative to `label`). */
  labelledBy?: string;
  /** Trap focus inside the panel while open (default true). */
  trapFocus?: boolean;
  /** Extra class on the floating panel. */
  className?: string;
  /** Role for the floating panel (default "dialog"). */
  role?: string;
}

/**
 * Anchored floating panel with viewport flip/shift, focus trap, and dismiss
 * handling. The trigger gets `aria-haspopup`/`aria-expanded` wired up. Generic
 * enough that menus and rich popovers build on it.
 */
export function Popover({
  open,
  onOpenChange,
  children,
  content,
  side = "bottom",
  align = "center",
  offset = 8,
  label,
  labelledBy,
  trapFocus = true,
  className,
  role = "dialog",
}: PopoverProps) {
  const id = useMonetId("monet-popover");
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<PositionResult>({ left: 0, top: 0, side });
  const z = useLayer(open);

  const measure = useCallback(() => {
    const a = anchorRef.current;
    const p = panelRef.current;
    if (!a || !p) return;
    setPos(
      computePosition(a.getBoundingClientRect(), { width: p.offsetWidth, height: p.offsetHeight }, { side, align, offset }),
    );
  }, [side, align, offset]);
  useReposition(measure, open);
  // Measure as soon as the panel node attaches: the Portal mounts a tick after
  // `open` flips, so useReposition's first pass runs before the panel exists.
  // Re-measure when its content resizes, so a growing panel stays on screen.
  const resizeObs = useRef<ResizeObserver | null>(null);
  const setPanel = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      resizeObs.current?.disconnect();
      resizeObs.current = null;
      if (!node) return;
      measure();
      if (typeof ResizeObserver === "function") {
        resizeObs.current = new ResizeObserver(() => measure());
        resizeObs.current.observe(node);
      }
    },
    [measure],
  );

  useFocusTrap(panelRef, { active: open && trapFocus });
  useDismiss({ onDismiss: () => onOpenChange(false), refs: [anchorRef, panelRef], enabled: open });

  if (!isValidElement(children)) return children ?? null;

  const trigger = cloneElement(children as ReactElement<any>, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const r = (children as any).ref;
      if (typeof r === "function") r(node);
      else if (r && typeof r === "object") (r as any).current = node;
    },
    "aria-haspopup": role === "menu" ? "menu" : "dialog",
    "aria-expanded": open,
    "aria-controls": open ? id : undefined,
  });

  return (
    <>
      {trigger}
      {open && (
        <Portal>
          <div
            ref={setPanel}
            id={id}
            role={role}
            aria-label={label}
            aria-labelledby={labelledBy}
            className={`monet-popover${className ? ` ${className}` : ""}`}
            data-side={pos.side}
            style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: z }}
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}

// ─── shared focusable selector (re-exported for menu.tsx) ──────
export { FOCUSABLE_SELECTOR, focusableWithin };

// Re-export a couple of React types overlay consumers commonly need.
export type { CSSProperties, ReactNode };
