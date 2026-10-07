// ─────────────────────────────────────────────────────────────
// Monet — color palette leaf widgets ("monet-cv-" color family)
// ─────────────────────────────────────────────────────────────
// Selectable swatch / glyph palettes and the hex text field. Split out of
// creative-color.tsx purely for file size (mirroring the creative-numeric /
// creative-tree split) and re-exported from it, so the public surface stays a
// single module. Behaviour (2D arrow nav, controlled/uncontrolled selection,
// hex draft buffer, ARIA) lives here; visuals come from monet-core/creative.css.
//
//   <Swatch>      a focusable color chip button
//   <SwatchGrid>  a listbox of selectable swatches (2D arrow nav)
//   <GlyphGrid>   a grid of selectable glyphs (2D arrow nav)
//   <HexInput>    a normalizing "#rrggbb"/"#rrggbbaa" text field

import React, {
  forwardRef,
  useRef,
  useState,
  type CSSProperties,
  type ButtonHTMLAttributes,
} from "react";
import { Icon, I } from "./icons";
import { Input } from "./controls";
import { useControllableState, cx } from "./internal";
import {
  hsvToCss,
  hexToRgb,
  rgbToHex,
  toHsv,
  type ColorValue,
} from "./creative-color-graphics";

// ─── Swatch ────────────────────────────────────────────────────

export interface SwatchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  /** Fill color (any ColorValue). */
  color: ColorValue;
  /** Show the selection ring. */
  selected?: boolean;
  /** Pixel size of the inner swatch. Defaults to 18. */
  size?: number;
  /** Render the empty/"no color" diagonal-slash state. */
  empty?: boolean;
}

/** A focusable color swatch button (the inner chip reuses .monet-swatch). A
 *  selection ring is shown when `selected`. */
export const Swatch = forwardRef<HTMLButtonElement, SwatchProps>(function Swatch(
  { color, selected, size, empty, className, style, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={!!selected}
      className={cx("monet-cv-swatch-btn", selected && "is-selected", empty && "is-empty", className)}
      style={{ "--swatch-size": size != null ? `${size}px` : undefined, ...style } as CSSProperties}
      {...rest}
    >
      <span
        className="monet-swatch monet-cv-swatch-chip"
        aria-hidden="true"
        style={empty ? undefined : { background: hsvToCss(toHsv(color)) }}
      />
    </button>
  );
});

// ─── SwatchGrid ────────────────────────────────────────────────

export interface SwatchItem {
  id?: string;
  color: ColorValue;
  label?: string;
}

export interface SwatchGridProps {
  /** Swatches as items or bare hex strings. */
  swatches: Array<SwatchItem | string>;
  /** Columns in the grid. Defaults to 8. */
  columns?: number;
  /** Controlled selected id. */
  selectedId?: string;
  defaultSelectedId?: string;
  onSelect?: (id: string, item: SwatchItem) => void;
  /** Grid gap in px. Defaults to 4. */
  gap?: number;
  /** Square cells. Defaults to true. */
  square?: boolean;
  /** Fires when the trailing add button is pressed. */
  onAdd?: () => void;
  "aria-label"?: string;
  className?: string;
}

/** Normalize SwatchItem | string entries to items with stable, UNIQUE ids.
 *  (#200) Duplicate colors are ordinary in a palette (recents strips, ramps with
 *  repeated neutrals); deriving the id from the color alone collided on `key`,
 *  marked every duplicate aria-selected at once and gave `onSelect` an id that
 *  could not say which cell was clicked. The first occurrence keeps the plain
 *  hex id (so a hex `selectedId` still works); later ones get a positional
 *  suffix. */
function normSwatches(
  list: Array<SwatchItem | string>,
): Array<SwatchItem & { id: string }> {
  const seen = new Set<string>();
  return list.map((sw, i) => {
    const item: SwatchItem & { id: string } =
      typeof sw === "string"
        ? { id: sw, color: sw }
        : { ...sw, id: sw.id ?? (typeof sw.color === "string" ? sw.color : `swatch-${i}`) };
    while (seen.has(item.id)) item.id = `${item.id}-${i}`;
    seen.add(item.id);
    return item;
  });
}

/** A grid of selectable swatches (role=listbox / option) with 2D arrow-key
 *  navigation. Cells are Swatch buttons; the selected one gets a ring. */
export const SwatchGrid = forwardRef<HTMLDivElement, SwatchGridProps>(
  function SwatchGrid(
    { swatches, columns = 8, selectedId, defaultSelectedId, onSelect, gap = 4, square = true, onAdd, className, ...aria },
    ref,
  ) {
    const items = normSwatches(swatches);
    const [sel, setSel] = useControllableState<string | undefined>(
      selectedId,
      defaultSelectedId,
      undefined,
    );
    const els = useRef<Array<HTMLButtonElement | null>>([]);

    const pick = (item: SwatchItem & { id: string }) => {
      if (selectedId === undefined) setSel(item.id);
      onSelect?.(item.id, item);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
      let to = i;
      if (e.key === "ArrowRight") to = Math.min(items.length - 1, i + 1);
      else if (e.key === "ArrowLeft") to = Math.max(0, i - 1);
      else if (e.key === "ArrowDown") to = Math.min(items.length - 1, i + columns);
      else if (e.key === "ArrowUp") to = Math.max(0, i - columns);
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = items.length - 1;
      else return;
      e.preventDefault();
      els.current[to]?.focus();
    };

    return (
      <div
        ref={ref}
        role="listbox"
        aria-label={aria["aria-label"] ?? "Swatches"}
        className={cx("monet-cv-swatchgrid", className)}
        style={
          {
            "--cols": columns,
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: `${gap}px`,
          } as CSSProperties
        }
      >
        {items.map((item, i) => {
          const selected = item.id === sel;
          return (
            <button
              key={item.id}
              ref={(el) => {
                els.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={item.label ?? item.id}
              tabIndex={selected || (sel === undefined && i === 0) ? 0 : -1}
              className={cx("monet-cv-swatch-btn", "monet-cv-swatchgrid-cell", selected && "is-selected", square && "is-square")}
              onClick={() => pick(item)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <span
                className="monet-swatch monet-cv-swatch-chip"
                aria-hidden="true"
                style={{ background: hsvToCss(toHsv(item.color)) }}
              />
            </button>
          );
        })}
        {onAdd && (
          <button
            type="button"
            aria-label="Add swatch"
            tabIndex={-1}
            className="monet-iconbtn monet-cv-swatchgrid-add"
            onClick={onAdd}
          >
            <Icon d={I.plus} size={12} />
          </button>
        )}
      </div>
    );
  },
);

// ─── GlyphGrid ─────────────────────────────────────────────────

export interface GlyphItem {
  char: string;
  name?: string;
  code?: string;
}

export interface GlyphGridProps {
  /** Glyphs as items or bare characters. */
  glyphs: Array<GlyphItem | string>;
  /** Columns in the grid. Defaults to 6. */
  columns?: number;
  /** Font family for the glyph cells. */
  fontFamily?: string;
  /** Controlled selected character. */
  selectedChar?: string;
  defaultSelectedChar?: string;
  onSelect?: (char: string, item: GlyphItem) => void;
  "aria-label"?: string;
  className?: string;
}

/** Normalize a GlyphItem | string to an item. */
function normGlyph(g: GlyphItem | string): GlyphItem {
  return typeof g === "string" ? { char: g } : g;
}

/** A grid of selectable glyphs (role=grid / gridcell) with 2D arrow-key
 *  navigation. */
export const GlyphGrid = forwardRef<HTMLDivElement, GlyphGridProps>(
  function GlyphGrid(
    { glyphs, columns = 6, fontFamily, selectedChar, defaultSelectedChar, onSelect, className, ...aria },
    ref,
  ) {
    const items = glyphs.map(normGlyph);
    const [sel, setSel] = useControllableState<string | undefined>(
      selectedChar,
      defaultSelectedChar,
      undefined,
    );
    const els = useRef<Array<HTMLButtonElement | null>>([]);

    const pick = (item: GlyphItem) => {
      if (selectedChar === undefined) setSel(item.char);
      onSelect?.(item.char, item);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
      let to = i;
      if (e.key === "ArrowRight") to = Math.min(items.length - 1, i + 1);
      else if (e.key === "ArrowLeft") to = Math.max(0, i - 1);
      else if (e.key === "ArrowDown") to = Math.min(items.length - 1, i + columns);
      else if (e.key === "ArrowUp") to = Math.max(0, i - columns);
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = items.length - 1;
      else return;
      e.preventDefault();
      els.current[to]?.focus();
    };

    return (
      <div
        ref={ref}
        role="grid"
        aria-label={aria["aria-label"] ?? "Glyphs"}
        className={cx("monet-cv-glyphgrid", className)}
        style={
          {
            "--cols": columns,
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            fontFamily,
          } as CSSProperties
        }
      >
        {items.map((item, i) => {
          const selected = item.char === sel;
          return (
            <button
              key={`${item.char}-${i}`}
              ref={(el) => {
                els.current[i] = el;
              }}
              type="button"
              role="gridcell"
              aria-selected={selected}
              aria-label={item.name ?? item.char}
              tabIndex={selected || (sel === undefined && i === 0) ? 0 : -1}
              className={cx("monet-cv-glyph", selected && "is-selected")}
              onClick={() => pick(item)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <span className="monet-cv-glyph-char" aria-hidden="true">
                {item.char}
              </span>
            </button>
          );
        })}
      </div>
    );
  },
);

// ─── HexInput ──────────────────────────────────────────────────

export interface HexInputProps {
  /** Controlled hex value. Omit (with `defaultValue`) for uncontrolled use. */
  value?: string;
  defaultValue?: string;
  /** Fires with the normalized "#rrggbb" on blur/Enter — or "#rrggbbaa" when the
   *  typed hex carried an alpha byte below FF. */
  onChange?: (hex: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
}

/** Normalize a typed hex to "#rrggbb"/"#rrggbbaa" (via the parser); returns
 *  null when it can't be parsed so the field can revert. */
function normalizeHex(raw: string): string | null {
  // (#198) Via the RGB path: the HSV round trip goes through `hsvToHex`, which
  // drops alpha by design, so a typed "#rrggbbaa" silently lost its alpha byte
  // and this function could never produce the 8-digit form it documents.
  const rgb = hexToRgb(raw);
  if (!rgb) return null;
  return rgbToHex(rgb).toUpperCase();
}

/** A hex text field that parses + normalizes "#rrggbb" on blur/Enter, using a
 *  draft buffer for intermediate typing. Reuses the .monet-input chrome via
 *  the shared Input. */
export const HexInput = forwardRef<HTMLInputElement, HexInputProps>(function HexInput(
  { value, defaultValue, onChange, placeholder = "#000000", disabled, className, ...aria },
  ref,
) {
  const isControlled = value !== undefined;
  const [committed, setCommitted] = useState<string>(defaultValue ?? value ?? "");
  const display = isControlled ? (value as string) : committed;
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const norm = normalizeHex(raw);
    setDraft(null);
    if (norm == null) return; // unparseable → revert to last value
    if (!isControlled) setCommitted(norm);
    onChange?.(norm);
  };

  return (
    <Input
      ref={ref}
      size="sm"
      type="text"
      inputMode="text"
      disabled={disabled}
      placeholder={placeholder}
      aria-label={aria["aria-label"] ?? "Hex color"}
      className={cx("monet-cv-hexinput", className)}
      value={draft != null ? draft : display}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        else if (e.key === "Escape") setDraft(null);
      }}
      onBlur={(e) => commit(e.target.value)}
    />
  );
});
