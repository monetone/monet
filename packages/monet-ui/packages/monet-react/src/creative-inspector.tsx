// ─────────────────────────────────────────────────────────────
// Monet — creative-app inspector & layout components ("monet-cv-")
// ─────────────────────────────────────────────────────────────
// Inspector / layout scaffolding for pro-creative-app panels, plus a few
// generic leaves. Behaviour (state, keyboard, focus, ARIA) lives here; visuals
// come from @monet-ui/monet-core/creative.css. Every component is built on real
// focusable elements, supports controlled + uncontrolled use where it owns
// state, exposes role / aria-* per its WAI-ARIA pattern, and reuses the chrome
// classes (.monet-section-label, .monet-chip, .monet-iconbtn) where they fit.
//
//   <Section>          collapsible inspector section
//   <SegmentedControl> exclusive pill toggle (role=radiogroup)
//   <ToggleGroup>      multi / exclusive toggle set (role=group)
//   <ToolbarGroup> + <ToolbarSeparator>  roving icon-button cluster
//   <Breadcrumb>       path trail (nav > ol)
//   <TreeView>         recursive WAI-ARIA tree
//   <SearchField>      Input + leading glyph + clear
//   <Badge>            formalised .monet-chip
//   <ProgressBar>      determinate / indeterminate progress
//   <Spinner>          monoline rotating arc

import React, {
  forwardRef,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Icon, I } from "./icons";
import { IconButton, Input, type InputProps } from "./controls";
import { useControllableState, cx, clamp } from "./internal";

// ─── shared keyboard helpers ───────────────────────────────────
// The roving sets (SegmentedControl / ToggleGroup) share a "next enabled peer"
// move; kept here rather than re-derived per component.

/** Indices of the enabled entries in `items`, in order. */
function enabledIndices(items: Array<{ disabled?: boolean }>): number[] {
  const out: number[] = [];
  for (let i = 0; i < items.length; i++) if (!items[i].disabled) out.push(i);
  return out;
}

/** Next enabled index from `from` moving `dir` (wraps). -1 if none enabled. */
function nextEnabled(
  items: Array<{ disabled?: boolean }>,
  from: number,
  dir: 1 | -1,
): number {
  const live = enabledIndices(items);
  if (live.length === 0) return -1;
  const pos = live.indexOf(from);
  if (pos < 0) return dir > 0 ? live[0] : live[live.length - 1];
  return live[(pos + dir + live.length) % live.length];
}

// ─── Section ───────────────────────────────────────────────────
// Collapsible inspector section: a real <button> drives aria-expanded /
// aria-controls; the body region stays mounted (hidden via .is-collapsed) so
// scroll/focus state survives a toggle.

export interface SectionProps {
  /** Header label. */
  title: ReactNode;
  /** Controlled open state. Omit (with `defaultOpen`) for uncontrolled use. */
  open?: boolean;
  /** Initial open state when uncontrolled. Defaults to true. */
  defaultOpen?: boolean;
  /** Fires with the next open state on toggle. */
  onOpenChange?: (open: boolean) => void;
  /** When false the section is always open and the header is inert. */
  collapsible?: boolean;
  /** Right-aligned header slot (buttons, badges). Clicks here don't toggle. */
  actions?: ReactNode;
  /** Small status element rendered after the title. */
  badge?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}

/** Collapsible inspector section with an accessible disclosure header. */
export function Section({
  title,
  open,
  defaultOpen = true,
  onOpenChange,
  collapsible = true,
  actions,
  badge,
  children,
  id,
  className,
}: SectionProps) {
  const auto = useId();
  const rootId = id ?? `monet-cv-sec-${auto}`;
  const bodyId = `${rootId}-body`;
  const [isOpen, setOpen] = useControllableState<boolean>(
    open,
    defaultOpen,
    onOpenChange,
  );
  // A non-collapsible section is permanently expanded.
  const expanded = collapsible ? isOpen : true;

  return (
    <section id={rootId} className={cx("monet-cv-section", className)}>
      <div className="monet-cv-section-header">
        <button
          type="button"
          className="monet-cv-section-toggle monet-section-label"
          aria-expanded={expanded}
          aria-controls={bodyId}
          disabled={!collapsible}
          onClick={() => collapsible && setOpen(!isOpen)}
        >
          {collapsible && (
            <span className="monet-cv-section-twisty" aria-hidden="true">
              <Icon d={expanded ? I.chevDown : I.chevRight} size={12} />
            </span>
          )}
          <span className="monet-cv-section-title">{title}</span>
          {badge != null && (
            <span className="monet-cv-section-badge">{badge}</span>
          )}
        </button>
        {actions != null && (
          <div className="monet-cv-section-actions">{actions}</div>
        )}
      </div>
      <div
        id={bodyId}
        role="region"
        aria-label={typeof title === "string" ? title : undefined}
        hidden={!expanded}
        className={cx("monet-cv-section-body", !expanded && "is-collapsed")}
      >
        {children}
      </div>
    </section>
  );
}

// ─── SegmentedControl ──────────────────────────────────────────
// Exclusive pill toggle (the Photoshop/preset segment). role="radiogroup" with
// role="radio" segments + roving tabindex + arrow nav (selects on move, per the
// WAI-ARIA radiogroup pattern). Mirrors the sandbox .sbx-seg look.

export interface SegmentedItem {
  value: string;
  label?: ReactNode;
  /** Optional leading glyph (an `I` key or a raw SVG path). */
  icon?: string;
  disabled?: boolean;
  /** Show the active-glow dot (mirrors the sandbox preset pill). */
  dot?: boolean;
}

export interface SegmentedControlProps {
  items: SegmentedItem[];
  /** Controlled selected value. Pass `null` for "controlled, nothing selected"
   *  (`undefined` means uncontrolled, per the React convention). */
  value?: string | null;
  /** Initial value when uncontrolled. Defaults to the first enabled item. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  size?: "sm" | "md";
  /** Stretch to fill the inline space, segments sharing width equally. */
  block?: boolean;
  /** Accent color for the active segment (CSS color or `var(--accent…)`). */
  accent?: string;
  "aria-label"?: string;
  className?: string;
}

/** Exclusive pill toggle group (role=radiogroup). */
export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl(
    { items, value, defaultValue, onChange, size = "sm", block, accent, className, ...aria },
    ref,
  ) {
    const firstEnabled = items.find((it) => !it.disabled)?.value;
    const [uncontrolled, setVal] = useControllableState<string | undefined>(
      value ?? undefined,
      defaultValue ?? firstEnabled,
      onChange as (v: string | undefined) => void,
    );
    // (#194) `useControllableState` infers control from `value !== undefined`,
    // so a controlled host meaning "nothing is selected" used to flip the group
    // back to its own stale internal state and keep a segment aria-checked.
    // `value={null}` is that state: controlled, with no selection.
    const val = value === null ? undefined : uncontrolled;
    const els = useRef<Array<HTMLButtonElement | null>>([]);
    // The selected segment is the tab stop; with nothing selected the first
    // enabled segment is, so the group is always reachable by Tab.
    const tabStop =
      val !== undefined ? items.findIndex((it) => it.value === val) : -1;
    const defaultStop = items.findIndex((it) => !it.disabled);

    const move = (from: number, dir: 1 | -1) => {
      const to = nextEnabled(items, from, dir);
      if (to < 0) return;
      els.current[to]?.focus();
      setVal(items[to].value);
    };

    return (
      <div
        ref={ref}
        role="radiogroup"
        aria-label={aria["aria-label"]}
        className={cx(
          "monet-cv-segmented",
          `monet-cv-segmented--${size}`,
          block && "is-block",
          className,
        )}
        style={accent ? ({ "--accent": accent } as React.CSSProperties) : undefined}
      >
        {items.map((it, i) => {
          const selected = it.value === val;
          const isTabStop = tabStop >= 0 ? i === tabStop : i === defaultStop;
          return (
            <button
              key={it.value}
              ref={(el) => {
                els.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={it.disabled}
              tabIndex={isTabStop ? 0 : -1}
              className={cx("monet-cv-segment", selected && "is-active")}
              onClick={() => !it.disabled && setVal(it.value)}
              onKeyDown={(e) => {
                if (it.disabled) return;
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
            >
              {it.icon && (
                <Icon d={I[it.icon as keyof typeof I] || it.icon} size={size === "sm" ? 13 : 14} />
              )}
              {it.label != null && <span className="monet-cv-segment-label">{it.label}</span>}
              {it.dot && <span className="monet-cv-segment-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    );
  },
);

// ─── ToggleGroup ───────────────────────────────────────────────
// Independent toggles (or single-select when `exclusive`). role="group"; each
// button carries aria-pressed. Icon-only items reuse .monet-iconbtn, labelled
// items reuse .monet-chip. Roving tabindex (first pressed item, else first).

export interface ToggleItem {
  value: string;
  label?: ReactNode;
  icon?: string;
  /** Required for icon-only items (no visible text). */
  "aria-label"?: string;
  disabled?: boolean;
}

export interface ToggleGroupProps {
  items: ToggleItem[];
  /** Controlled pressed values. */
  value?: string[];
  /** Initial pressed values when uncontrolled. Defaults to []. */
  defaultValue?: string[];
  onChange?: (value: string[]) => void;
  /** Single-select: pressing one clears the rest. Defaults to false (multi). */
  exclusive?: boolean;
  size?: "sm" | "md";
  "aria-label"?: string;
  className?: string;
}

/** Multi (or exclusive) toggle set (role=group). */
export const ToggleGroup = forwardRef<HTMLDivElement, ToggleGroupProps>(
  function ToggleGroup(
    { items, value, defaultValue, onChange, exclusive = false, size = "sm", className, ...aria },
    ref,
  ) {
    const [val, setVal] = useControllableState<string[]>(
      value,
      defaultValue ?? [],
      onChange,
    );
    const els = useRef<Array<HTMLButtonElement | null>>([]);
    const isOn = (v: string) => val.includes(v);

    const toggle = (v: string) => {
      if (exclusive) {
        setVal(isOn(v) ? [] : [v]);
        return;
      }
      setVal(isOn(v) ? val.filter((x) => x !== v) : [...val, v]);
    };

    // Roving tab stop: the first pressed enabled item, else the first enabled.
    const stop =
      items.findIndex((it) => !it.disabled && isOn(it.value)) >= 0
        ? items.findIndex((it) => !it.disabled && isOn(it.value))
        : items.findIndex((it) => !it.disabled);

    const move = (from: number, dir: 1 | -1) => {
      const to = nextEnabled(items, from, dir);
      if (to >= 0) els.current[to]?.focus();
    };

    return (
      <div
        ref={ref}
        role="group"
        aria-label={aria["aria-label"]}
        className={cx("monet-cv-togglegroup", `monet-cv-togglegroup--${size}`, className)}
      >
        {items.map((it, i) => {
          const on = isOn(it.value);
          const iconOnly = it.icon != null && it.label == null;
          return (
            <button
              key={it.value}
              ref={(el) => {
                els.current[i] = el;
              }}
              type="button"
              aria-pressed={on}
              aria-label={it["aria-label"]}
              disabled={it.disabled}
              tabIndex={i === stop ? 0 : -1}
              className={cx(
                "monet-cv-toggle",
                iconOnly ? "monet-iconbtn" : "monet-chip",
                on && "is-active",
              )}
              onClick={() => !it.disabled && toggle(it.value)}
              onKeyDown={(e) => {
                if (it.disabled) return;
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
            >
              {it.icon && (
                <Icon d={I[it.icon as keyof typeof I] || it.icon} size={size === "sm" ? 14 : 16} />
              )}
              {it.label != null && <span className="monet-cv-toggle-label">{it.label}</span>}
            </button>
          );
        })}
      </div>
    );
  },
);

// ─── ToolbarGroup + ToolbarSeparator ───────────────────────────
// Icon-button cluster with roving arrow-key focus. Focusable children are
// discovered at navigation time (no declarative item model) so arbitrary
// children compose. role defaults to "toolbar" (+ aria-orientation).

export interface ToolbarGroupProps {
  orientation?: "horizontal" | "vertical";
  children: ReactNode;
  size?: "sm" | "md";
  "aria-label"?: string;
  role?: "toolbar" | "group";
  className?: string;
}

/** Hairline divider between toolbar clusters. */
export function ToolbarSeparator({
  orientation = "horizontal",
  className,
}: {
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  return (
    <span
      role="separator"
      aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"}
      className={cx("monet-cv-toolbar-sep", `is-${orientation}`, className)}
    />
  );
}

/** Icon-button cluster with roving focus (role=toolbar). */
export const ToolbarGroup = forwardRef<HTMLDivElement, ToolbarGroupProps>(
  function ToolbarGroup(
    { orientation = "horizontal", children, size = "md", role = "toolbar", className, ...aria },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement | null>(null);

    const setRef = (el: HTMLDivElement | null) => {
      rootRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    };

    // Discover the focusable descendants at the moment of navigation so the
    // toolbar works with any children (IconButton, Button, links, …).
    const focusables = (): HTMLElement[] => {
      const root = rootRef.current;
      if (!root) return [];
      const sel =
        'button:not(:disabled),[href],input:not(:disabled),[tabindex]:not([tabindex="-1"]):not(:disabled)';
      return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(
        (el) => el.getAttribute("aria-disabled") !== "true",
      );
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      const fwd = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
      const back = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
      if (e.key !== fwd && e.key !== back && e.key !== "Home" && e.key !== "End") return;
      const list = focusables();
      if (list.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const i = active ? list.indexOf(active) : -1;
      let to = i;
      if (e.key === "Home") to = 0;
      else if (e.key === "End") to = list.length - 1;
      else if (e.key === fwd) to = i < 0 ? 0 : (i + 1) % list.length;
      else to = i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length;
      e.preventDefault();
      list[to]?.focus();
    };

    return (
      <div
        ref={setRef}
        role={role}
        aria-label={aria["aria-label"]}
        aria-orientation={role === "toolbar" ? orientation : undefined}
        className={cx(
          "monet-cv-toolbargroup",
          `is-${orientation}`,
          `monet-cv-toolbargroup--${size}`,
          className,
        )}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    );
  },
);

// ─── Breadcrumb ────────────────────────────────────────────────
// Path trail (<nav><ol><li>). Interactive crumbs are <button>s; the last is
// aria-current="page" and inert. `maxItems` collapses the middle into an
// ellipsis, always keeping the first + last.

export interface BreadcrumbItem {
  id: string;
  label: ReactNode;
  icon?: string;
  disabled?: boolean;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate?: (id: string, index: number) => void;
  /** Separator between crumbs. Defaults to a chevron. */
  separator?: ReactNode;
  /** Collapse the middle with "…" once there are more than this many crumbs. */
  maxItems?: number;
  "aria-label"?: string;
  className?: string;
}

const ELLIPSIS = Symbol("breadcrumb-ellipsis");

/** Path trail (nav > ol > li). The last crumb is the current page. */
export const Breadcrumb = forwardRef<HTMLElement, BreadcrumbProps>(
  function Breadcrumb(
    { items, onNavigate, separator, maxItems, className, ...aria },
    ref,
  ) {
    const sep = separator ?? <Icon d={I.chevRight} size={11} />;

    // Build the visible list, optionally collapsing the middle. Each entry is
    // either a real item (with its original index) or the ellipsis marker.
    type Entry = { item: BreadcrumbItem; index: number } | typeof ELLIPSIS;
    let entries: Entry[];
    if (maxItems != null && maxItems >= 2 && items.length > maxItems) {
      const head = { item: items[0], index: 0 };
      const tailCount = maxItems - 1;
      const tail = items
        .slice(items.length - tailCount)
        .map((item, i) => ({ item, index: items.length - tailCount + i }));
      entries = [head, ELLIPSIS, ...tail];
    } else {
      entries = items.map((item, index) => ({ item, index }));
    }

    return (
      <nav
        ref={ref}
        aria-label={aria["aria-label"] ?? "Breadcrumb"}
        className={cx("monet-cv-breadcrumb", className)}
      >
        <ol className="monet-cv-breadcrumb-list">
          {entries.map((entry, i) => {
            const isLastVisual = i === entries.length - 1;
            if (entry === ELLIPSIS) {
              return (
                <li key="ellipsis" className="monet-cv-crumb-item">
                  <span className="monet-cv-crumb is-ellipsis" aria-hidden="true">
                    {"…"}
                  </span>
                  {!isLastVisual && (
                    <span className="monet-cv-crumb-sep" aria-hidden="true">
                      {sep}
                    </span>
                  )}
                </li>
              );
            }
            const { item, index } = entry;
            const isCurrent = index === items.length - 1;
            const glyph = item.icon ? (
              <Icon d={I[item.icon as keyof typeof I] || item.icon} size={12} />
            ) : null;
            return (
              <li key={item.id} className="monet-cv-crumb-item">
                {isCurrent ? (
                  <span className="monet-cv-crumb is-current" aria-current="page">
                    {glyph}
                    {item.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="monet-cv-crumb"
                    disabled={item.disabled}
                    onClick={() => !item.disabled && onNavigate?.(item.id, index)}
                  >
                    {glyph}
                    {item.label}
                  </button>
                )}
                {!isLastVisual && (
                  <span className="monet-cv-crumb-sep" aria-hidden="true">
                    {sep}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    );
  },
);

// ─── TreeView ──────────────────────────────────────────────────
// The generic recursive tree lives in ./creative-tree (split out for file
// size) and is re-exported here + from the package barrel so it stays part of
// this single public module.
export { TreeView } from "./creative-tree";
export type { TreeNode, TreeRenderInfo, TreeViewProps } from "./creative-tree";

// ─── SearchField ───────────────────────────────────────────────
// An Input with a leading search glyph and a trailing clear button. Reuses the
// .monet-input family and adds the clear affordance. Controlled when `value` is
// supplied, else uncontrolled.

export interface SearchFieldProps
  extends Omit<InputProps, "type" | "iconStart" | "value" | "defaultValue" | "onChange"> {
  /** Controlled query string. */
  value?: string;
  /** Initial query when uncontrolled. Defaults to "". */
  defaultValue?: string;
  /** Fires with the next query string. */
  onChange?: (value: string) => void;
  /** Fires on Enter with the current query. */
  onSearch?: (value: string) => void;
  /** Show the clear button when there is a query. Defaults to true. */
  clearable?: boolean;
  /** Fires when the clear button is pressed (after the value is cleared). */
  onClear?: () => void;
  placeholder?: string;
  /** Override the leading glyph (an `I` key or raw SVG path). */
  icon?: string;
}

/** A search input with a leading glyph and a clear button. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(
    {
      value,
      defaultValue,
      onChange,
      onSearch,
      clearable = true,
      onClear,
      placeholder = "Search…",
      icon = "search",
      size = "md",
      disabled,
      className,
      ...rest
    },
    ref,
  ) {
    const [val, setVal] = useControllableState<string>(value, defaultValue ?? "", onChange);
    const innerRef = useRef<HTMLInputElement | null>(null);

    const setRef = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
    };

    const clear = () => {
      setVal("");
      onClear?.();
      innerRef.current?.focus();
    };

    return (
      <div
        className={cx(
          "monet-cv-search",
          `monet-input--${size}`,
          val !== "" && "has-value",
          disabled && "is-disabled",
          className,
        )}
      >
        <span className="monet-input-icon" aria-hidden="true">
          <Icon d={I[icon as keyof typeof I] || icon} size={size === "sm" ? 12 : 14} />
        </span>
        <Input
          {...rest}
          ref={setRef}
          type="search"
          size={size}
          disabled={disabled}
          placeholder={placeholder}
          className="is-bare monet-cv-search-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            rest.onKeyDown?.(e);
            if (e.key === "Enter") onSearch?.(val);
          }}
        />
        {clearable && val !== "" && !disabled && (
          <IconButton
            icon="close"
            aria-label="Clear search"
            size="sm"
            tabIndex={-1}
            className="monet-cv-search-clear"
            onClick={clear}
          />
        )}
      </div>
    );
  },
);

// ─── Badge ─────────────────────────────────────────────────────
// Formalises the existing .monet-chip. `as="button"` renders a real, keyboard-
// operable <button> carrying the chip classes; otherwise a plain <span>. Tones
// map to the existing chip modifiers.

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Visual tone → .monet-chip modifier. */
  tone?: "default" | "active" | "accent";
  /** Leading glyph / element. */
  icon?: ReactNode;
  /** Render element. "button" → an interactive <button>. */
  as?: "span" | "button";
  size?: "sm" | "md";
  children?: ReactNode;
}

/** A small status chip (formalised .monet-chip). */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "default", icon, as = "span", size = "md", className, children, ...rest },
  ref,
) {
  const classes = cx(
    "monet-chip",
    "monet-cv-badge",
    `monet-cv-badge--${size}`,
    tone === "active" && "is-active",
    tone === "accent" && "is-accent",
    className,
  );
  const content = (
    <>
      {icon != null && <span className="monet-cv-badge-icon" aria-hidden="true">{icon}</span>}
      {children}
    </>
  );
  if (as === "button") {
    const { onClick, ...spanRest } = rest;
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        className={classes}
        onClick={onClick as React.MouseEventHandler<HTMLButtonElement>}
        {...(spanRest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {content}
      </button>
    );
  }
  return (
    <span ref={ref} className={classes} {...rest}>
      {content}
    </span>
  );
});

// ─── ProgressBar ───────────────────────────────────────────────
// Determinate / indeterminate progress meter. role="progressbar" with aria-
// valuenow/min/max when determinate; valuenow is omitted when indeterminate
// (a shimmering fill shows instead).

export interface ProgressBarProps {
  /** Progress fraction 0..1. Omit (or set `indeterminate`) for an unknown bar. */
  value?: number;
  /** Accent color for the fill/glow (CSS color or `var(--accent…)`). */
  accent?: string;
  size?: "sm" | "md";
  /** Optional caption rendered above the track. */
  label?: ReactNode;
  /** Force the indeterminate shimmer regardless of `value`. */
  indeterminate?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Determinate / indeterminate progress meter (role=progressbar). */
export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  function ProgressBar(
    { value, accent, size = "md", label, indeterminate, className, ...aria },
    ref,
  ) {
    const isIndeterminate = indeterminate || value == null || !isFinite(value);
    const unit = isIndeterminate ? 0 : clamp(value, 0, 1);
    const pct = Math.round(unit * 100);
    const labelId = useId();
    return (
      <div
        ref={ref}
        className={cx("monet-cv-progress", `monet-cv-progress--${size}`, className)}
        style={accent ? ({ "--accent": accent } as React.CSSProperties) : undefined}
      >
        {label != null && (
          <div id={labelId} className="monet-cv-progress-label">
            {label}
          </div>
        )}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={isIndeterminate ? undefined : unit}
          aria-label={aria["aria-label"]}
          aria-labelledby={label != null && !aria["aria-label"] ? labelId : undefined}
          className={cx("monet-cv-progress-track", isIndeterminate && "is-indeterminate")}
        >
          <div
            className="monet-cv-progress-fill"
            style={isIndeterminate ? undefined : { width: `${pct}%` }}
          />
        </div>
      </div>
    );
  },
);

// ─── Spinner ───────────────────────────────────────────────────
// Monoline rotating arc. role="status" + aria-label when labelled (announces
// the loading state), otherwise aria-hidden (decorative).

export interface SpinnerProps {
  /** Diameter in px. Defaults to 16. */
  size?: number;
  /** Arc color (CSS color or `var(--accent…)`). */
  accent?: string;
  /** Accessible loading label. When omitted the spinner is aria-hidden. */
  label?: string;
  className?: string;
}

/** Indeterminate rotating-arc spinner (role=status when labelled). */
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { size = 16, accent, label, className },
  ref,
) {
  const stroke = Math.max(1.25, size / 11);
  const r = (size - stroke) / 2;
  const c = size / 2;
  // A ~270° arc: leave a quarter open so the rotation reads as motion.
  const circ = 2 * Math.PI * r;
  return (
    <span
      ref={ref}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx("monet-cv-spinner", className)}
      style={
        {
          width: size,
          height: size,
          ...(accent ? { "--accent": accent } : {}),
        } as React.CSSProperties
      }
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle
          className="monet-cv-spinner-track"
          cx={c}
          cy={c}
          r={r}
          strokeWidth={stroke}
        />
        <circle
          className="monet-cv-spinner-arc"
          cx={c}
          cy={c}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circ * 0.7} ${circ}`}
        />
      </svg>
    </span>
  );
});
