// ─────────────────────────────────────────────────────────────
// Monet — Select (accessible combobox / listbox)
// ─────────────────────────────────────────────────────────────
// A button (role=combobox-style with aria-haspopup="listbox") that opens a
// listbox of options. The listbox renders through the overlay Portal with
// fixed, viewport-aware positioning, so no ancestor's overflow, transform or
// z-index can clip or bury it. Keyboard support follows the
// WAI-ARIA collapsed-listbox pattern:
//   • closed: Enter / Space / ArrowDown / ArrowUp / Alt+ArrowDown open it
//   • open:   ArrowUp/Down move the active option, Home/End jump to ends,
//             typeahead matches by prefix, Enter/Space commit, Esc closes,
//             Tab closes, committing only an option the user moved to
//   • like a native select, re-choosing the current value fires no onChange
//   • aria-activedescendant tracks the active option; click-outside closes,
//     as does a scroll that carries the trigger out of view; handled keys
//     don't propagate past the trigger.
//
// Visuals come from @monet-ui/monet-core/controls.css.

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon, I } from "./icons";
import { cx } from "./internal";
import { Portal, computePosition, useLayer, useReposition } from "./overlay-core";
import { nativePopupMaxSize, placeNativePopup, renderInPopup, useCloseOnAppBlur, useNativePopup, useNativePopupHover } from "./native-popup";

export interface SelectOption {
  /** The value committed via onChange. */
  value: string;
  /** Visible label. Defaults to `value`. */
  label?: string;
  /** Optional leading glyph (an `I` key or raw SVG path). */
  icon?: string;
  disabled?: boolean;
  /** Optional presentation for this popup row (for example, a font preview). */
  style?: CSSProperties;
}

export interface SelectProps {
  /** The available options. */
  options: SelectOption[];
  /** Controlled selected value. */
  value?: string;
  /** Initial value when uncontrolled. */
  defaultValue?: string;
  /** Fires with the chosen option's value. */
  onChange?: (value: string) => void;
  /** Placeholder when nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Control height. Defaults to "md". */
  size?: "sm" | "md";
  block?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  /** Tooltip on the trigger. */
  title?: string;
  className?: string;
  /** Inline style on the root (layout: width, flex, margins). */
  style?: CSSProperties;
  /** `data-*` attributes land on the trigger button. */
  [data: `data-${string}`]: string | number | boolean | undefined;
}

// cx lives in ./internal (imported above).

/** Internal (shared by Select + Autocomplete): fixed, portalled placement for a
 *  `.monet-listbox` anchored under (or, near the bottom edge, over) `anchorRef`.
 *  Attach `setList` as the list's ref, spread `style` onto it and render it with
 *  `portal`; the list stays hidden until measured so it never flashes at the
 *  corner. In the desktop app the list opens in a native popup window, so it can
 *  extend past the app window (see native-popup.tsx). `onScrolledAway` fires once
 *  a scroll carries the anchor out of the scrolled container's view, or when the
 *  app window loses focus while a native popup is up. */
export function useAnchoredListbox(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  onScrolledAway: () => void,
) {
  const z = useLayer(open);
  const slot = useNativePopup(open);
  useNativePopupHover(slot);
  // Like a native popup: rather than float over whatever content the anchor has
  // scrolled under, close once a scroll takes the anchor out of view.
  const lost = useRef(onScrolledAway);
  lost.current = onScrolledAway;
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      const a = anchorRef.current;
      const t = e.target;
      if (!a || !(t instanceof Node) || t === a || !t.contains(a)) return;
      const r = a.getBoundingClientRect();
      const c = t instanceof Element ? t.getBoundingClientRect() : { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
      if (r.bottom < c.top || r.top > c.bottom || r.right < c.left || r.left > c.right) lost.current();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open, anchorRef]);
  const closeOnBlur = useCallback(() => lost.current(), []);
  useCloseOnAppBlur(slot, closeOnBlur);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number } | null>(null);
  const measure = useCallback(() => {
    const a = anchorRef.current;
    const l = listRef.current;
    if (!a || !l) return;
    const r = a.getBoundingClientRect();
    if (slot) {
      // The native window takes the list's own size; it is placed on screen.
      const box = l.getBoundingClientRect();
      void placeNativePopup(slot, r, { width: Math.max(box.width, r.width), height: box.height });
      setPos((p) => (p && p.minWidth === r.width ? p : { left: 0, top: 0, minWidth: r.width }));
      return;
    }
    const p = computePosition(r, { width: Math.max(l.offsetWidth, r.width), height: l.offsetHeight }, { side: "bottom", align: "start", offset: 4 });
    setPos({ left: p.left, top: p.top, minWidth: r.width });
  }, [anchorRef, slot]);
  useReposition(measure, open);
  // A native list re-places itself when its content resizes (filtering, fonts).
  useEffect(() => {
    const l = listRef.current;
    const RO = (slot?.win as (Window & typeof globalThis) | undefined)?.ResizeObserver;
    if (!RO || !l) return;
    const ro = new RO(() => measure());
    ro.observe(l);
    return () => ro.disconnect();
  }, [slot, measure, pos !== null]);
  // The Portal mounts after the `open` commit, so measure when the list attaches.
  const setList = useCallback(
    (el: HTMLUListElement | null) => {
      listRef.current = el;
      if (el) measure();
      else setPos(null);
    },
    [measure],
  );
  const max = slot ? nativePopupMaxSize() : null;
  const style: CSSProperties = max
    ? { left: 0, top: 0, minWidth: pos?.minWidth, width: "max-content", maxWidth: max.width, maxHeight: Math.min(280, max.height) }
    : { zIndex: z, left: pos?.left ?? 0, top: pos?.top ?? 0, minWidth: pos?.minWidth, visibility: pos ? undefined : "hidden" };
  const portal = (node: ReactNode) => renderInPopup(slot, node, (n) => <Portal>{n}</Portal>);
  return { listRef, setList, style, placed: pos !== null, portal };
}

/** Accessible single-select. Renders a trigger button + a listbox popup.
 *  Controlled when `value` is supplied, otherwise uncontrolled. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    options,
    value,
    defaultValue,
    onChange,
    placeholder = "Select…",
    disabled,
    invalid,
    size = "md",
    block,
    id,
    name,
    title,
    className,
    style,
    ...rest
  },
  forwardedRef,
) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string | undefined>(defaultValue);
  const selected = isControlled ? value : internal;

  const [open, setOpen] = useState(false);
  // index of the visually-active option while the listbox is open
  const [activeIdx, setActiveIdx] = useState(-1);
  const { "aria-label": ariaLabel, "aria-labelledby": ariaLabelledby, "aria-describedby": ariaDescribedby, "aria-invalid": ariaInvalid, ...dataAttrs } = rest;

  const autoId = useId();
  const baseId = id ?? `monet-select-${autoId}`;
  const listId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });
  // The active option the list opened on: Tab away without moving commits nothing.
  const openedAt = useRef(-1);

  const setRef = useCallback(
    (el: HTMLButtonElement | null) => {
      triggerRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  const selectedIdx = useMemo(
    () => options.findIndex((o) => o.value === selected),
    [options, selected],
  );
  const selectedOption = selectedIdx >= 0 ? options[selectedIdx] : undefined;

  const firstEnabled = useCallback(
    (dir: 1 | -1, from: number): number => {
      const n = options.length;
      for (let step = 1; step <= n; step++) {
        const i = (((from + dir * step) % n) + n) % n;
        if (!options[i]?.disabled) return i;
      }
      return from;
    },
    [options],
  );

  const commit = useCallback(
    (idx: number) => {
      const opt = options[idx];
      if (!opt || opt.disabled || opt.value === selected) return;
      if (!isControlled) setInternal(opt.value);
      onChange?.(opt.value);
    },
    [options, selected, isControlled, onChange],
  );

  const openList = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    // WebKit does not focus a button on click; the open list's keys go through it.
    triggerRef.current?.focus({ preventScroll: true });
    // start the active option on the current selection — even a disabled one,
    // which Enter/Tab then cannot commit — or else the first enabled option
    const start = selectedIdx >= 0 ? selectedIdx : firstEnabled(1, -1);
    openedAt.current = start;
    setActiveIdx(start);
  }, [disabled, selectedIdx, firstEnabled]);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    setActiveIdx(-1);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);
  const { listRef, setList, style: listStyle, placed: listed, portal } = useAnchoredListbox(triggerRef, open, () => close(false));

  // ── click-outside / focus-loss close ──
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !listRef.current?.contains(t)) close(false);
    };
    document.addEventListener("pointerdown", onDocPointer, true);
    return () => document.removeEventListener("pointerdown", onDocPointer, true);
  }, [open, close, listRef]);

  // ── keep the active option scrolled into view ──
  useLayoutEffect(() => {
    if (!open || activeIdx < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(optionId(activeIdx))}`,
    );
    el?.scrollIntoView({ block: "nearest" });
    // optionId is stable for a given index; baseId is stable per mount.
    // `listed`: the portalled list attaches a render after `open` flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIdx, listed]);

  const moveActive = useCallback(
    (dir: 1 | -1) => {
      setActiveIdx((cur) => firstEnabled(dir, cur < 0 ? (dir === 1 ? -1 : 0) : cur));
    },
    [firstEnabled],
  );

  const runTypeahead = useCallback(
    (ch: string) => {
      const now = Date.now();
      const t = typeahead.current;
      if (now - t.at > 600) t.buffer = "";
      t.at = now;
      t.buffer += ch.toLowerCase();
      const n = options.length;
      const base = activeIdx < 0 ? 0 : activeIdx;
      for (let step = 0; step < n; step++) {
        // prefer matches after the current item; single-char repeats cycle
        const i = (base + (t.buffer.length === 1 ? step + 1 : step)) % n;
        const opt = options[i];
        if (opt && !opt.disabled && (opt.label ?? opt.value).toLowerCase().startsWith(t.buffer)) {
          setActiveIdx(i);
          return;
        }
      }
    },
    [options, activeIdx],
  );

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      switch (e.key) {
        case "Enter":
        case " ":
        case "ArrowDown":
        case "ArrowUp":
          e.preventDefault();
          openList();
          return;
      }
      if (e.key === "ArrowDown" && e.altKey) {
        e.preventDefault();
        openList();
      }
      return;
    }
    // open
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); moveActive(1); break;
      case "ArrowUp": e.preventDefault(); moveActive(-1); break;
      case "Home": e.preventDefault(); setActiveIdx(firstEnabled(1, -1)); break;
      case "End": e.preventDefault(); setActiveIdx(firstEnabled(-1, 0)); break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (activeIdx >= 0) commit(activeIdx);
        close();
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        if (activeIdx >= 0 && activeIdx !== openedAt.current) commit(activeIdx);
        close(false);
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          runTypeahead(e.key);
        }
    }
  };

  const triggerLabel = selectedOption?.label ?? selectedOption?.value;

  return (
    <div
      ref={rootRef}
      className={cx(
        "monet-select",
        `monet-input--${size}`,
        disabled && "is-disabled",
        invalid && "is-invalid",
        block && "is-block",
        open && "is-open",
        className,
      )}
      style={style}
    >
      <button
        ref={setRef}
        type="button"
        id={baseId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIdx >= 0 ? optionId(activeIdx) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-invalid={invalid || ariaInvalid ? true : undefined}
        title={title}
        data-value={selected ?? ""}
        {...dataAttrs}
        disabled={disabled}
        className="monet-select-trigger"
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          onTriggerKeyDown(e);
          // A key the combobox consumed must not also drive an ancestor (a
          // roving list's arrows, a dialog's Enter, an app shortcut's letter).
          if (e.isDefaultPrevented()) e.stopPropagation();
        }}
      >
        {selectedOption?.icon && (
          <span className="monet-select-icon" aria-hidden="true">
            <Icon d={I[selectedOption.icon as keyof typeof I] || selectedOption.icon} size={size === "sm" ? 12 : 14} />
          </span>
        )}
        <span className={cx("monet-select-value", triggerLabel == null && "is-placeholder")}>
          {triggerLabel ?? placeholder}
        </span>
        <span className="monet-select-arrow" aria-hidden="true">
          <Icon d={I.chevDown} size={12} />
        </span>
      </button>

      {name && <input type="hidden" name={name} value={selected ?? ""} />}

      {open && portal(
          <ul
            ref={setList}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            tabIndex={-1}
            className="monet-listbox"
            // Hidden until measured so it never flashes at the corner; fixed so
            // it escapes every clipping ancestor.
            style={listStyle}
            // Keep focus (and so keyboard handling) on the trigger while clicking.
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((opt, i) => (
              <li
                key={opt.value}
                id={optionId(i)}
                role="option"
                aria-selected={opt.value === selected}
                data-value={opt.value}
                aria-disabled={opt.disabled || undefined}
                style={opt.style}
                className={cx(
                  "monet-option",
                  i === activeIdx && "is-active",
                  opt.value === selected && "is-selected",
                  opt.disabled && "is-disabled",
                )}
                // pointermove (not mouseenter) keeps the active option under the
                // cursor without fighting keyboard navigation between renders
                onPointerMove={() => !opt.disabled && i !== activeIdx && setActiveIdx(i)}
                onClick={() => {
                  if (opt.disabled) return;
                  commit(i);
                  close();
                }}
              >
                {opt.icon && (
                  <span className="monet-option-icon" aria-hidden="true">
                    <Icon d={I[opt.icon as keyof typeof I] || opt.icon} size={14} />
                  </span>
                )}
                <span className="monet-option-label">{opt.label ?? opt.value}</span>
                {opt.value === selected && (
                  <span className="monet-option-check" aria-hidden="true">
                    <Icon d="M3.5 8.5L6.5 11.5L12.5 4.5" size={12} strokeWidth={2} />
                  </span>
                )}
              </li>
            ))}
          </ul>,
      )}
    </div>
  );
});
