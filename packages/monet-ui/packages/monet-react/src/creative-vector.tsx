// ─────────────────────────────────────────────────────────────
// Monet — creative vector tool groups ("monet-cv-" vector family)
// ─────────────────────────────────────────────────────────────
// Mocked-but-sharable Illustrator-style vector tooling: the Pathfinder
// (shape-mode tiles + compound-path operations) and the AlignBar (align +
// distribute toolbar with an optional "relative to" target). Behaviour
// (aria-pressed toggles, a role=toolbar roving tabindex, the click callbacks)
// is real even though host geometry is mocked; everything flows through the
// on*-family callbacks.
//
// The glyphs are LOCAL monoline `d`-path constants exported from this module
// (PATHFINDER_ICONS / ALIGN_ICONS), promoted from the inline paths the
// examples/vector + examples/sandbox align/pathfinder toolbars drew — they are
// NOT in the shared `I` map. Visuals come from @monet-ui/monet-core/creative.css
// (the "monet-cv-pathfinder" / "monet-cv-alignbar" rules).
//
// Components:
//   <Pathfinder>   shape-mode tiles (aria-pressed group) + operation chips
//   <AlignBar>     align / distribute toolbar (role=toolbar, roving tabindex)

import React, {
  forwardRef,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Select, type SelectOption } from "./controls";
import { cx } from "./internal";

// ─── PATHFINDER_ICONS ──────────────────────────────────────────
// Monoline 16-box `d` paths for the four canonical shape modes — two
// overlapping rounded shapes with the boolean result implied by the stroke /
// fill split. Rendered through the local <VIcon> (which paints `fill` when
// asked), so a mode can show its filled result region.

/** The boolean shape-mode glyph paths (unite / minus / intersect / exclude). */
export const PATHFINDER_ICONS = {
  /** Union of the two reference squares (the merged region). */
  unite: "M3 3H9V7H13V13H7V9H3Z",
  /** The back square with the front overlap subtracted. */
  minus: "M3 3H9V7H7V9H3Z",
  /** Only the overlapping region of the two squares. */
  intersect: "M7 7H9V9H7Z",
  /** Both squares minus their overlap (the two outer corners). */
  exclude: "M3 3H9V7H7V9H3Z M9 7H13V13H7V9H9Z",
} as const;

/** A built-in shape-mode key. */
export type PathfinderShapeMode = keyof typeof PATHFINDER_ICONS;

// ─── ALIGN_ICONS ───────────────────────────────────────────────
// Monoline 16-box `d` paths for the eight align/distribute actions — an edge /
// center guide line plus a small box snapped to it (the distribute glyphs show
// three evenly-gapped marks). Promoted from the examples' inline align toolbars.

export type AlignAction =
  | "left"
  | "center-h"
  | "right"
  | "top"
  | "middle-v"
  | "bottom"
  | "dist-h"
  | "dist-v";

/** The align/distribute glyph paths, keyed by {@link AlignAction}. */
export const ALIGN_ICONS: Record<AlignAction, string> = {
  // align: a guide line on the target edge/center + a box snapped to it
  // (matches the reference app-vector align toolbar glyphs).
  left: "M3 3L3 13 M5 6L9 6L9 10L5 10Z",
  "center-h": "M8 3L8 13 M5 6L11 6L11 10L5 10Z",
  right: "M13 3L13 13 M7 6L11 6L11 10L7 10Z",
  top: "M3 4L13 4 M5 7L9 7L9 11L5 11Z",
  "middle-v": "M3 8L13 8 M5 6L9 6L9 10L5 10Z",
  bottom: "M3 12L13 12 M5 5L9 5L9 9L5 9Z",
  // distribute: three evenly-gapped bars.
  "dist-h": "M3 4V12 M8 4V12 M13 4V12",
  "dist-v": "M4 3H12 M4 8H12 M4 13H12",
};

/** Default left→right (then distribute) ordering for the AlignBar. */
export const ALIGN_ACTIONS: AlignAction[] = [
  "left",
  "center-h",
  "right",
  "top",
  "middle-v",
  "bottom",
  "dist-h",
  "dist-v",
];

/** Human-readable labels for each align/distribute action (accessible names). */
const ALIGN_LABELS: Record<AlignAction, string> = {
  left: "Align left",
  "center-h": "Align center",
  right: "Align right",
  top: "Align top",
  "middle-v": "Align middle",
  bottom: "Align bottom",
  "dist-h": "Distribute horizontally",
  "dist-v": "Distribute vertically",
};

// ─── local glyph renderer ──────────────────────────────────────

/** A 16-box monoline glyph for this module's LOCAL path constants (mirrors the
 *  shared <Icon> shape but kept local so vector glyphs never touch the `I` map);
 *  paints `fill` for shape-mode result regions. */
function VIcon({
  d,
  size = 16,
  fill = false,
  strokeWidth = 1.2,
}: {
  d: string;
  size?: number;
  fill?: boolean;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {fill ? <path d={d} fill="currentColor" fillOpacity={0.18} /> : null}
      <path d={d} />
    </svg>
  );
}

/** The shape-mode glyph: two overlapping circles — the Illustrator/reference
 *  boolean motif (the same icon across modes; the active highlight + the tile's
 *  aria-label distinguish them, exactly as the reference app-vector toolbar). */
function ShapeModeIcon() {
  return (
    <svg
      width={20}
      height={14}
      viewBox="0 0 20 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      aria-hidden="true"
    >
      <circle cx={7} cy={7} r={4} />
      <circle cx={13} cy={7} r={4} />
    </svg>
  );
}

// ─── Pathfinder ────────────────────────────────────────────────

export interface PathfinderShapeModeItem {
  value: string;
  label: string;
  /** A local `d`-path glyph (e.g. one of PATHFINDER_ICONS). */
  icon?: string;
}

export interface PathfinderOperation {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface PathfinderProps {
  /** Shape-mode tiles. Defaults to the four PATHFINDER_ICONS modes. */
  shapeModes?: PathfinderShapeModeItem[];
  /** Controlled active shape-mode value (single-select; null = none active). */
  activeMode?: string | null;
  /** Fires the chosen shape-mode value (toggles off when re-pressed → null). */
  onMode?: (value: string | null) => void;
  /** Compound-path operation chips (Divide / Trim / Merge / …). */
  operations?: PathfinderOperation[];
  /** Fires the activated operation value (operations are momentary, not state). */
  onOperation?: (value: string) => void;
  /** Heading over the shape-mode tiles. Defaults to "Shape modes". */
  shapeModesLabel?: ReactNode;
  /** Heading over the operation chips. Defaults to "Pathfinders". */
  operationsLabel?: ReactNode;
  accent?: string;
  "aria-label"?: string;
  className?: string;
}

/** The built-in shape modes (unite / minus / intersect / exclude). */
const DEFAULT_SHAPE_MODES: PathfinderShapeModeItem[] = [
  { value: "unite", label: "Unite", icon: PATHFINDER_ICONS.unite },
  { value: "minus", label: "Minus front", icon: PATHFINDER_ICONS.minus },
  { value: "intersect", label: "Intersect", icon: PATHFINDER_ICONS.intersect },
  { value: "exclude", label: "Exclude", icon: PATHFINDER_ICONS.exclude },
];

/** The built-in compound-path operations. */
const DEFAULT_OPERATIONS: PathfinderOperation[] = [
  { value: "divide", label: "Divide" },
  { value: "trim", label: "Trim" },
  { value: "merge", label: "Merge" },
  { value: "crop", label: "Crop" },
  { value: "outline", label: "Outline" },
  { value: "minus-back", label: "Minus Back" },
];

/** The Illustrator Pathfinder panel: a row of glass shape-mode tiles
 *  (`role="group"` of `aria-pressed` buttons — pressing one selects it and
 *  clears the rest; pressing the active one clears to null) over a row of
 *  momentary compound-path operation chips. Headings reuse `.monet-section-label`,
 *  tiles reuse `.monet-iconbtn`, op chips reuse `.monet-chip`. */
export const Pathfinder = forwardRef<HTMLDivElement, PathfinderProps>(
  function Pathfinder(
    {
      shapeModes = DEFAULT_SHAPE_MODES,
      activeMode,
      onMode,
      operations = DEFAULT_OPERATIONS,
      onOperation,
      shapeModesLabel = "Shape modes",
      operationsLabel = "Pathfinders",
      accent,
      className,
      ...aria
    },
    forwardedRef,
  ) {
    // Controlled-only selection: when activeMode is omitted the host hasn't
    // wired selection, so tiles act as momentary triggers (no pressed state).
    const active = activeMode ?? null;

    const pressMode = (value: string) => {
      onMode?.(active === value ? null : value);
    };

    return (
      <div
        ref={forwardedRef}
        aria-label={aria["aria-label"]}
        className={cx("monet-cv-pathfinder", className)}
        style={{ "--accent": accent } as CSSProperties}
      >
        {shapeModes.length > 0 && (
          <>
            {shapeModesLabel != null && (
              <div className="monet-section-label monet-cv-pathfinder-label">
                {shapeModesLabel}
              </div>
            )}
            <div
              role="group"
              aria-label={
                typeof shapeModesLabel === "string" ? shapeModesLabel : "Shape modes"
              }
              className="monet-cv-pathfinder-modes"
            >
              {shapeModes.map((mode) => {
                const on = active === mode.value;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    aria-pressed={on}
                    aria-label={mode.label}
                    title={mode.label}
                    className={cx(
                      "monet-iconbtn",
                      "monet-cv-pathfinder-mode",
                      on && "is-active",
                    )}
                    onClick={() => pressMode(mode.value)}
                  >
                    {(PATHFINDER_ICONS as Record<string, string>)[mode.value] != null ? (
                      <ShapeModeIcon />
                    ) : mode.icon != null ? (
                      <VIcon d={mode.icon} size={18} fill={on} />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {operations.length > 0 && (
          <>
            {operationsLabel != null && (
              <div className="monet-section-label monet-cv-pathfinder-label">
                {operationsLabel}
              </div>
            )}
            <div className="monet-cv-pathfinder-ops">
              {operations.map((op) => (
                <button
                  key={op.value}
                  type="button"
                  disabled={op.disabled}
                  className={cx("monet-chip", "monet-cv-pathfinder-op")}
                  onClick={() => !op.disabled && onOperation?.(op.value)}
                >
                  {op.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  },
);

// ─── AlignBar ──────────────────────────────────────────────────

export interface AlignBarProps {
  /** Which actions to show, in order. Defaults to all eight ALIGN_ACTIONS. */
  actions?: AlignAction[];
  /** Fires the activated align/distribute action (momentary, not state). */
  onAlign?: (action: AlignAction) => void;
  /** Highlight one action as the current selection (aria-pressed). */
  active?: AlignAction;
  /** Controlled "relative to" target value (renders a Select when provided). */
  relativeTo?: string;
  /** Fires the chosen "relative to" value (also opts the Select in). */
  onRelativeToChange?: (value: string) => void;
  /** Options for the "relative to" Select. Defaults to a Selection/Artboard set. */
  relativeToOptions?: SelectOption[];
  /** Bar axis. Defaults to "horizontal". */
  orientation?: "horizontal" | "vertical";
  /** Render the action's label beside its glyph (chip-style) vs icon-only. */
  showLabels?: boolean;
  accent?: string;
  "aria-label"?: string;
  className?: string;
}

const DEFAULT_RELATIVE_TO_OPTIONS: SelectOption[] = [
  { value: "selection", label: "Selection" },
  { value: "key-object", label: "Key Object" },
  { value: "artboard", label: "Artboard" },
];

/** The Illustrator/Figma align toolbar: a `role="toolbar"` of align +
 *  distribute `<button>`s (each with an accessible `aria-label` like
 *  "Align left", and `aria-pressed` when it matches `active`) using a roving
 *  tabindex — only one button is in the tab order; Arrow/Home/End move focus
 *  along the axis. An optional "relative to" target wraps `<Select>`. Buttons
 *  reuse `.monet-iconbtn` (or `.monet-chip` with `showLabels`). */
export const AlignBar = forwardRef<HTMLDivElement, AlignBarProps>(
  function AlignBar(
    {
      actions = ALIGN_ACTIONS,
      onAlign,
      active,
      relativeTo,
      onRelativeToChange,
      relativeToOptions = DEFAULT_RELATIVE_TO_OPTIONS,
      orientation = "horizontal",
      showLabels = false,
      accent,
      className,
      ...aria
    },
    forwardedRef,
  ) {
    const els = useRef<Array<HTMLButtonElement | null>>([]);
    const showRelativeTo =
      relativeTo !== undefined || onRelativeToChange !== undefined;

    // Roving tab stop: the active action when shown, else the first button.
    const activeIdx = active ? actions.indexOf(active) : -1;
    const stop = activeIdx >= 0 ? activeIdx : 0;

    const move = (from: number, dir: 1 | -1) => {
      const n = actions.length;
      if (n === 0) return;
      const to = (from + dir + n) % n;
      els.current[to]?.focus();
    };

    const onKeyDown = (i: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const fwd = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
      const back = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
      if (e.key === fwd) {
        e.preventDefault();
        move(i, 1);
      } else if (e.key === back) {
        e.preventDefault();
        move(i, -1);
      } else if (e.key === "Home") {
        e.preventDefault();
        els.current[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        els.current[actions.length - 1]?.focus();
      }
    };

    return (
      <div
        ref={forwardedRef}
        role="toolbar"
        aria-label={aria["aria-label"] ?? "Align"}
        aria-orientation={orientation}
        className={cx(
          "monet-cv-alignbar",
          `is-${orientation}`,
          showLabels && "is-labelled",
          className,
        )}
        style={{ "--accent": accent } as CSSProperties}
      >
        {actions.map((action, i) => {
          const on = active === action;
          const label = ALIGN_LABELS[action];
          return (
            <button
              key={action}
              ref={(el) => {
                els.current[i] = el;
              }}
              type="button"
              aria-label={label}
              aria-pressed={on}
              title={label}
              tabIndex={i === stop ? 0 : -1}
              className={cx(
                showLabels ? "monet-chip" : "monet-iconbtn",
                "monet-cv-alignbar-btn",
                on && "is-active",
              )}
              onClick={() => onAlign?.(action)}
              onKeyDown={onKeyDown(i)}
            >
              <VIcon d={ALIGN_ICONS[action]} size={14} />
              {showLabels && (
                <span className="monet-cv-alignbar-label">{label}</span>
              )}
            </button>
          );
        })}
        {showRelativeTo && (
          <label className="monet-cv-alignbar-relative">
            <span className="monet-cv-alignbar-relative-label">Align to</span>
            <Select
              size="sm"
              options={relativeToOptions}
              value={relativeTo}
              aria-label="Align to"
              onChange={(v) => onRelativeToChange?.(v)}
            />
          </label>
        )}
      </div>
    );
  },
);
