// ─────────────────────────────────────────────────────────────
// Monet — creative layer / channel / artboard inspectors ("monet-cv-")
// ─────────────────────────────────────────────────────────────
// The Photoshop/Figma-style stacks: a layer panel (rows with visibility + lock
// + opacity + blend mode), a channels panel, a nested layer tree, and an
// artboard list. Behaviour (selection, roving keyboard, ARIA) lives here;
// visuals reuse the existing `.monet-layer` row chrome (`.vis`/`.thumb`/`.name`/
// `.meta`) plus the "monet-cv-" rules in @monet-ui/monet-core/creative.css.
//
// The eye / lock affordances are real <button role="switch" aria-pressed> that
// stopPropagation, so toggling visibility/lock never also selects the row. The
// list owns selection + roving tabindex (the WAI-ARIA listbox pattern); the
// tree composes the generic TreeView from ./creative-inspector.
//
// Components:
//   <LayerRow>          one row (role=option) — eye/lock/thumb/name/meta
//   <LayerList>         selectable stack (role=listbox, single or multi-select)
//   <VisibilityToggle>  eye switch button (reused by the rows)
//   <LockToggle>        lock switch button
//   <BlendModeSelect>   Select wrapper preloaded with BLEND_MODES
//   <OpacityControl>    Slider 0..100 + a monospace % readout
//   <ChannelRow> + <ChannelList>  RGB/Red/Green/Blue/Alpha specialization
//   <LayerTree>         nested groups over TreeView, a LayerRow per node
//   <ArtboardList>      artboard picker (role=listbox)

import React, {
  forwardRef,
  useId,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Icon, I } from "./icons";
import { Slider } from "./primitives";
import { Select, type SelectOption, type SelectProps } from "./controls";
import { TreeView, type TreeNode } from "./creative-inspector";
import { useControllableState, cx, clamp, roundTo } from "./internal";

// ─── shared data types ─────────────────────────────────────────

export interface LayerData {
  id: string;
  name: string;
  /** Eye state. Defaults to true (visible). */
  visible?: boolean;
  /** Lock state. Defaults to false (unlocked). */
  locked?: boolean;
  /** Opacity 0..100. Defaults to 100. */
  opacity?: number;
  /** Blend-mode value id (a `BLEND_MODES` value). */
  blendMode?: string;
  /** Small accent swatch shown before the thumb (a CSS color). */
  colorChip?: string;
  /** Custom thumbnail content (an image, a swatch, …). */
  thumb?: ReactNode;
}

// ─── VisibilityToggle + LockToggle ─────────────────────────────
// Tiny on/off switch buttons reused by the rows. role="switch" + aria-pressed;
// they stopPropagation so a click toggles without also selecting the row.

interface ToggleButtonBaseProps {
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

export interface VisibilityToggleProps extends ToggleButtonBaseProps {
  /** Controlled visibility. Omit (with `defaultChecked`) for uncontrolled use. */
  checked?: boolean;
}

export interface LockToggleProps extends ToggleButtonBaseProps {
  /** Controlled lock state. Omit (with `defaultChecked`) for uncontrolled use. */
  on?: boolean;
}

/** Shared switch-button core for the eye / lock affordances. */
const ToggleButton = forwardRef<
  HTMLButtonElement,
  ToggleButtonBaseProps & {
    checked: boolean | undefined;
    icon: string;
    fallbackLabel: string;
    extraClass: string;
  }
>(function ToggleButton(
  {
    checked,
    defaultChecked = true,
    onChange,
    disabled,
    icon,
    fallbackLabel,
    extraClass,
    className,
    ...aria
  },
  ref,
) {
  // (#193) `useControllableState` is the ONE emitter of the host callback. The
  // click handler used to also invoke a second `onValue` channel wired to the
  // same `onChange`, firing every eye/lock toggle twice (two undo entries, and
  // flip-style hosts never changed state at all).
  const [on, setOn] = useControllableState<boolean>(checked, defaultChecked, onChange);
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-pressed={on}
      aria-checked={on}
      aria-label={aria["aria-label"] ?? fallbackLabel}
      disabled={disabled}
      className={cx("vis", extraClass, !on && "is-off", className)}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        setOn(!on);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Icon d={I[icon as keyof typeof I]} size={14} />
    </button>
  );
});

/** The eye switch — toggles a layer's visibility. */
export const VisibilityToggle = forwardRef<HTMLButtonElement, VisibilityToggleProps>(
  function VisibilityToggle({ checked, defaultChecked = true, onChange, ...rest }, ref) {
    return (
      <ToggleButton
        ref={ref}
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange}
        icon="eye"
        fallbackLabel="Toggle visibility"
        extraClass="monet-cv-vis"
        {...rest}
      />
    );
  },
);

/** The lock switch — toggles a layer's locked state (defaults to unlocked). */
export const LockToggle = forwardRef<HTMLButtonElement, LockToggleProps>(
  function LockToggle({ on, defaultChecked = false, onChange, ...rest }, ref) {
    return (
      <ToggleButton
        ref={ref}
        checked={on}
        defaultChecked={defaultChecked}
        onChange={onChange}
        icon="lock"
        fallbackLabel="Toggle lock"
        extraClass="monet-cv-lock"
        {...rest}
      />
    );
  },
);

// ─── LayerRow ──────────────────────────────────────────────────

/** True when Enter/Space on a row means "activate the row" — i.e. the key did
 *  not land on a nested control. (#196) Rows `preventDefault()` on activation,
 *  which cancels a nested button's own default activation, so a keypress aimed
 *  at the eye/lock switch must be left alone. Shared by LayerRow + ChannelRow. */
function isRowActivationKey(e: React.KeyboardEvent): boolean {
  if (e.key !== "Enter" && e.key !== " ") return false;
  return !(e.target as HTMLElement).closest(
    "button,input,select,textarea,a,[contenteditable]",
  );
}

export interface LayerRowProps {
  name: ReactNode;
  /** Eye state. Defaults to true. */
  visible?: boolean;
  /** Lock state. Defaults to false. */
  locked?: boolean;
  /** Opacity 0..100, shown in the meta slot when no custom `meta` is given. */
  opacity?: number;
  /** Blend-mode label shown in the meta slot. */
  blendMode?: ReactNode;
  /** Accent swatch shown before the thumb (a CSS color). */
  colorChip?: string;
  /** Thumbnail content. */
  thumb?: ReactNode;
  /** Selected state → aria-selected + `.is-selected`. */
  selected?: boolean;
  /** Roving tab stop control (the list sets this). Defaults to -1. */
  tabIndex?: number;
  /** Fires when the row is activated (click / Enter / Space). */
  onSelect?: () => void;
  /** Fires with the next visibility when the eye is toggled. */
  onVisibilityToggle?: (visible: boolean) => void;
  /** Fires with the next lock state when the lock is toggled. */
  onLockToggle?: (locked: boolean) => void;
  /** Supplying this turns the meta slot's opacity readout into a live control
   *  and fires with the next 0..100 value. */
  onOpacityChange?: (opacity: number) => void;
  /** Supplying this turns the meta slot's blend readout into a `BlendModeSelect`
   *  and fires with the chosen `BLEND_MODES` value. */
  onBlendModeChange?: (mode: string) => void;
  /** Custom right-aligned meta slot (replaces the opacity/blend readout). */
  meta?: ReactNode;
  id?: string;
  className?: string;
}

/** A single layer row (role=option) built on the chrome `.monet-layer`. The
 *  eye + lock are real switch buttons that stopPropagation, so toggling them
 *  never also selects the row. */
export const LayerRow = forwardRef<HTMLDivElement, LayerRowProps>(function LayerRow(
  {
    name,
    visible = true,
    locked = false,
    opacity,
    blendMode,
    colorChip,
    thumb,
    selected,
    tabIndex = -1,
    onSelect,
    onVisibilityToggle,
    onLockToggle,
    onOpacityChange,
    onBlendModeChange,
    meta,
    id,
    className,
  },
  ref,
) {
  const activate = () => onSelect?.();
  // (#201) The meta slot is a readout until the host wires an editor callback:
  // LayerList declared onOpacityChange/onBlendModeChange but rendered no control
  // for either, so hosts that wired them got permanent silence.
  const editable = onBlendModeChange != null || onOpacityChange != null;
  const metaContent =
    meta ??
    (blendMode != null || opacity != null || editable ? (
      <span className="meta">
        {onBlendModeChange ? (
          <BlendModeSelect
            size="sm"
            aria-label="Blend mode"
            value={typeof blendMode === "string" ? blendMode : undefined}
            onChange={onBlendModeChange}
            className="monet-cv-layer-blend"
          />
        ) : (
          blendMode != null && <span className="monet-cv-layer-blend">{blendMode}</span>
        )}
        {onOpacityChange ? (
          <OpacityControl
            label={null}
            value={clamp(roundTo(opacity ?? 100, 0), 0, 100)}
            onChange={onOpacityChange}
            className="monet-cv-layer-opacity"
          />
        ) : (
          opacity != null && (
            <span className="monet-cv-layer-opacity">{Math.round(opacity)}%</span>
          )
        )}
      </span>
    ) : null);

  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={!!selected}
      tabIndex={tabIndex}
      className={cx("monet-layer", "monet-cv-layer", selected && "is-selected", className)}
      onClick={activate}
      onKeyDown={(e) => {
        if (!isRowActivationKey(e)) return;
        e.preventDefault();
        activate();
      }}
    >
      <VisibilityToggle
        checked={visible}
        onChange={(v) => onVisibilityToggle?.(v)}
        aria-label={visible ? "Hide layer" : "Show layer"}
      />
      {colorChip != null && (
        <span
          className="monet-swatch monet-cv-layer-chip"
          style={{ background: colorChip }}
          aria-hidden="true"
        />
      )}
      {thumb !== undefined && <span className="thumb monet-cv-layer-thumb">{thumb}</span>}
      <span className="name">{name}</span>
      {metaContent}
      <LockToggle
        on={locked}
        onChange={(l) => onLockToggle?.(l)}
        aria-label={locked ? "Unlock layer" : "Lock layer"}
        className="monet-cv-layer-lock"
      />
    </div>
  );
});

// ─── roving-list keyboard helper ───────────────────────────────
// LayerList / ChannelList / ArtboardList all drive a vertical listbox of rows
// with a single roving tab stop. The move logic is shared here.

function rovingKeyDown<T extends { id: string }>(
  e: React.KeyboardEvent<HTMLDivElement>,
  items: T[],
  current: string | undefined,
  focusRow: (id: string) => void,
): string | null {
  const idx = items.findIndex((it) => it.id === current);
  switch (e.key) {
    case "ArrowDown": {
      e.preventDefault();
      const next = items[Math.min(idx + 1, items.length - 1)] ?? items[0];
      if (next) focusRow(next.id);
      return null;
    }
    case "ArrowUp": {
      e.preventDefault();
      const prev = items[Math.max(idx - 1, 0)] ?? items[0];
      if (prev) focusRow(prev.id);
      return null;
    }
    case "Home": {
      e.preventDefault();
      if (items[0]) focusRow(items[0].id);
      return null;
    }
    case "End": {
      e.preventDefault();
      const last = items[items.length - 1];
      if (last) focusRow(last.id);
      return null;
    }
    default:
      return null;
  }
}

// ─── LayerList ─────────────────────────────────────────────────

export interface LayerListRenderInfo {
  selected: boolean;
  tabIndex: number;
}

export interface LayerListProps {
  layers: LayerData[];
  /** Controlled selected id (single-select). */
  selectedId?: string;
  /** Initial selected id when uncontrolled. */
  defaultSelectedId?: string;
  onSelect?: (id: string) => void;
  /** Allow selecting multiple rows (role becomes aria-multiselectable). */
  multiSelect?: boolean;
  /** Controlled selected ids (multi-select). */
  selectedIds?: string[];
  /** Initial selected ids when uncontrolled (multi-select). */
  defaultSelectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onVisibilityChange?: (id: string, visible: boolean) => void;
  onLockChange?: (id: string, locked: boolean) => void;
  /** Wiring this renders an editable opacity control in each row's meta slot.
   *  Ignored when `renderRow` supplies the row. */
  onOpacityChange?: (id: string, opacity: number) => void;
  /** Wiring this renders a `BlendModeSelect` in each row's meta slot. Ignored
   *  when `renderRow` supplies the row. */
  onBlendModeChange?: (id: string, mode: string) => void;
  /** Replace the default LayerRow rendering for a layer. */
  renderRow?: (layer: LayerData, info: LayerListRenderInfo) => ReactNode;
  /** Sticky header content above the rows. */
  header?: ReactNode;
  /** Footer content below the rows (a toolbar, etc.). */
  footer?: ReactNode;
  "aria-label"?: string;
  className?: string;
}

/** A selectable layer stack (role=listbox). Single-select by default, or
 *  multi-select (Space toggles, role gains aria-multiselectable). Roving
 *  tabindex with Arrow/Home/End; the eye/lock buttons inside each row toggle
 *  without changing selection. */
export const LayerList = forwardRef<HTMLDivElement, LayerListProps>(function LayerList(
  {
    layers,
    selectedId,
    defaultSelectedId,
    onSelect,
    multiSelect,
    selectedIds,
    defaultSelectedIds,
    onSelectionChange,
    onVisibilityChange,
    onLockChange,
    onOpacityChange,
    onBlendModeChange,
    renderRow,
    header,
    footer,
    className,
    ...aria
  },
  ref,
) {
  const [single, setSingle] = useControllableState<string | undefined>(
    selectedId,
    defaultSelectedId,
    onSelect as (v: string | undefined) => void,
  );
  const [multi, setMulti] = useControllableState<string[]>(
    selectedIds,
    defaultSelectedIds ?? [],
    onSelectionChange,
  );
  const els = useRef<Record<string, HTMLDivElement | null>>({});

  const isSelected = (id: string) => (multiSelect ? multi.includes(id) : single === id);
  // (#195) A `renderRow` row is tracked through a display:contents wrapper (the
  // host node itself carries no ref channel), so the real row is that wrapper's
  // first child. Without this, `els` stayed empty under renderRow and the
  // documented Arrow/Home/End roving navigation moved focus nowhere.
  const rowEl = (id: string): HTMLElement | null => {
    const el = els.current[id];
    if (!el) return null;
    return renderRow ? (el.firstElementChild as HTMLElement | null) : el;
  };
  const focusRow = (id: string) => rowEl(id)?.focus();

  const select = (id: string) => {
    if (multiSelect) {
      const next = multi.includes(id) ? multi.filter((x) => x !== id) : [...multi, id];
      setMulti(next);
    } else {
      setSingle(id);
    }
  };

  // Roving tab stop: the (first) selected row if any, else the first row.
  const selectedRowId = layers.find((l) => isSelected(l.id))?.id;
  const tabStopId = selectedRowId ?? layers[0]?.id;

  return (
    <div
      ref={ref}
      className={cx("monet-cv-layerlist", className)}
    >
      {header != null && <div className="monet-cv-layerlist-header">{header}</div>}
      <div
        role="listbox"
        aria-label={aria["aria-label"] ?? "Layers"}
        aria-multiselectable={multiSelect || undefined}
        className="monet-cv-layerlist-body"
        onKeyDown={(e) => {
          const active = document.activeElement as HTMLElement | null;
          const activeId = layers.find((l) => rowEl(l.id) === active)?.id;
          if (e.key === " " && multiSelect && activeId) {
            e.preventDefault();
            select(activeId);
            return;
          }
          rovingKeyDown(e, layers, activeId ?? tabStopId, focusRow);
        }}
      >
        {layers.map((layer) => {
          const sel = isSelected(layer.id);
          const tabIndex = layer.id === tabStopId ? 0 : -1;
          if (renderRow) {
            return (
              // (#195) display:contents adds no box, so the host row still lays
              // out as a direct listbox child — but the wrapper gives `els` the
              // ref channel `renderRow`'s signature does not have.
              <div
                key={layer.id}
                style={{ display: "contents" }}
                ref={(el) => {
                  els.current[layer.id] = el;
                }}
              >
                {renderRow(layer, { selected: sel, tabIndex })}
              </div>
            );
          }
          return (
            <LayerRow
              key={layer.id}
              ref={(el) => {
                els.current[layer.id] = el;
              }}
              id={layer.id}
              name={layer.name}
              visible={layer.visible ?? true}
              locked={layer.locked ?? false}
              opacity={layer.opacity}
              blendMode={layer.blendMode}
              colorChip={layer.colorChip}
              thumb={layer.thumb}
              selected={sel}
              tabIndex={tabIndex}
              onSelect={() => select(layer.id)}
              onVisibilityToggle={(v) => onVisibilityChange?.(layer.id, v)}
              onLockToggle={(l) => onLockChange?.(layer.id, l)}
              // (#201) Only pass a handler through when the host wired one —
              // the row renders a readout otherwise.
              onOpacityChange={
                onOpacityChange ? (o) => onOpacityChange(layer.id, o) : undefined
              }
              onBlendModeChange={
                onBlendModeChange ? (m) => onBlendModeChange(layer.id, m) : undefined
              }
            />
          );
        })}
      </div>
      {footer != null && <div className="monet-cv-layerlist-footer">{footer}</div>}
    </div>
  );
});

// ─── BlendModeSelect ───────────────────────────────────────────

/** The Photoshop blend-mode roster, as Select options (kebab-case value ids). */
export const BLEND_MODES: SelectOption[] = [
  { value: "normal", label: "Normal" },
  { value: "dissolve", label: "Dissolve" },
  { value: "darken", label: "Darken" },
  { value: "multiply", label: "Multiply" },
  { value: "color-burn", label: "Color Burn" },
  { value: "linear-burn", label: "Linear Burn" },
  { value: "darker-color", label: "Darker Color" },
  { value: "lighten", label: "Lighten" },
  { value: "screen", label: "Screen" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "linear-dodge", label: "Linear Dodge" },
  { value: "lighter-color", label: "Lighter Color" },
  { value: "overlay", label: "Overlay" },
  { value: "soft-light", label: "Soft Light" },
  { value: "hard-light", label: "Hard Light" },
  { value: "vivid-light", label: "Vivid Light" },
  { value: "linear-light", label: "Linear Light" },
  { value: "pin-light", label: "Pin Light" },
  { value: "hard-mix", label: "Hard Mix" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "subtract", label: "Subtract" },
  { value: "divide", label: "Divide" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

export interface BlendModeSelectProps extends Omit<SelectProps, "options"> {
  /** Override the option roster. Defaults to BLEND_MODES. */
  options?: SelectOption[];
}

/** A `Select` preloaded with the blend-mode roster (`BLEND_MODES`). */
export const BlendModeSelect = forwardRef<HTMLButtonElement, BlendModeSelectProps>(
  function BlendModeSelect({ options = BLEND_MODES, className, ...rest }, ref) {
    return (
      <Select
        ref={ref}
        options={options}
        className={cx("monet-cv-blendmode", className)}
        {...rest}
      />
    );
  },
);

// ─── OpacityControl ────────────────────────────────────────────

export interface OpacityControlProps {
  /** Controlled value 0..100. Omit (with `defaultValue`) for uncontrolled use. */
  value?: number;
  /** Initial value when uncontrolled. Defaults to 100. */
  defaultValue?: number;
  onChange?: (pct: number) => void;
  /** Leading label (→ .lbl). Defaults to "Opacity". */
  label?: ReactNode;
  accent?: string;
  className?: string;
}

/** An opacity row: a 0..100 `Slider` plus a monospace `%` readout, laid out on
 *  the chrome `.monet-row`. */
export const OpacityControl = forwardRef<HTMLDivElement, OpacityControlProps>(
  function OpacityControl(
    { value, defaultValue = 100, onChange, label = "Opacity", accent, className },
    ref,
  ) {
    const [pct, setPct] = useControllableState<number>(value, defaultValue, onChange);
    const autoId = useId();
    const sliderId = `monet-cv-opacity-${autoId}`;
    const clamped = clamp(roundTo(pct, 0), 0, 100);
    return (
      <div
        ref={ref}
        className={cx("monet-row", "monet-cv-opacity", className)}
        style={{ "--accent": accent } as CSSProperties}
      >
        {label != null && (
          <label className="lbl" htmlFor={sliderId}>
            {label}
          </label>
        )}
        <Slider
          id={sliderId}
          min={0}
          max={100}
          step={1}
          accent={accent}
          aria-label={typeof label === "string" ? label : "Opacity"}
          value={pct}
          onChange={(n) => setPct(n)}
          className="monet-cv-opacity-slider"
        />
        <span className="val monet-cv-opacity-val">{clamped}%</span>
      </div>
    );
  },
);

// ─── ChannelRow + ChannelList ──────────────────────────────────

export interface ChannelData {
  id: string;
  name: string;
  /** Eye state. Defaults to true. */
  visible?: boolean;
  thumb?: ReactNode;
  /** Keyboard shortcut hint shown in the meta slot (e.g. "⌘3"). */
  shortcut?: ReactNode;
  /** Marks the composite (RGB) channel — gets the `.is-composite` modifier. */
  composite?: boolean;
}

export interface ChannelRowProps {
  name: ReactNode;
  visible?: boolean;
  thumb?: ReactNode;
  shortcut?: ReactNode;
  composite?: boolean;
  selected?: boolean;
  tabIndex?: number;
  onSelect?: () => void;
  onVisibilityToggle?: (visible: boolean) => void;
  id?: string;
  className?: string;
}

/** A single channel row — a `LayerRow` specialization (no lock; the meta slot
 *  carries the channel shortcut). role=option. */
export const ChannelRow = forwardRef<HTMLDivElement, ChannelRowProps>(function ChannelRow(
  { name, visible = true, thumb, shortcut, composite, selected, tabIndex = -1, onSelect, onVisibilityToggle, id, className },
  ref,
) {
  const activate = () => onSelect?.();
  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={!!selected}
      tabIndex={tabIndex}
      className={cx(
        "monet-layer",
        "monet-cv-channel",
        composite && "is-composite",
        selected && "is-selected",
        className,
      )}
      onClick={activate}
      onKeyDown={(e) => {
        if (!isRowActivationKey(e)) return;
        e.preventDefault();
        activate();
      }}
    >
      <VisibilityToggle
        checked={visible}
        onChange={(v) => onVisibilityToggle?.(v)}
        aria-label={visible ? "Hide channel" : "Show channel"}
      />
      {thumb !== undefined && <span className="thumb monet-cv-channel-thumb">{thumb}</span>}
      <span className="name">{name}</span>
      {shortcut != null && <span className="meta monet-cv-channel-shortcut">{shortcut}</span>}
    </div>
  );
});

export interface ChannelListProps {
  channels: ChannelData[];
  selectedId?: string;
  defaultSelectedId?: string;
  onSelect?: (id: string) => void;
  onVisibilityChange?: (id: string, visible: boolean) => void;
  "aria-label"?: string;
  className?: string;
}

/** A channels panel (role=listbox) — a thin `LayerList`-style specialization
 *  over `ChannelRow` for the RGB/Red/Green/Blue/Alpha stack. */
export const ChannelList = forwardRef<HTMLDivElement, ChannelListProps>(
  function ChannelList(
    { channels, selectedId, defaultSelectedId, onSelect, onVisibilityChange, className, ...aria },
    ref,
  ) {
    const [sel, setSel] = useControllableState<string | undefined>(
      selectedId,
      defaultSelectedId,
      onSelect as (v: string | undefined) => void,
    );
    const els = useRef<Record<string, HTMLDivElement | null>>({});
    const focusRow = (id: string) => els.current[id]?.focus();
    const tabStopId = channels.find((c) => c.id === sel)?.id ?? channels[0]?.id;

    return (
      <div
        ref={ref}
        role="listbox"
        aria-label={aria["aria-label"] ?? "Channels"}
        className={cx("monet-cv-channellist", className)}
        onKeyDown={(e) => {
          const active = document.activeElement as HTMLElement | null;
          const activeId = channels.find((c) => els.current[c.id] === active)?.id;
          rovingKeyDown(e, channels, activeId ?? tabStopId, focusRow);
        }}
      >
        {channels.map((ch) => (
          <ChannelRow
            key={ch.id}
            ref={(el) => {
              els.current[ch.id] = el;
            }}
            id={ch.id}
            name={ch.name}
            visible={ch.visible ?? true}
            thumb={ch.thumb}
            shortcut={ch.shortcut}
            composite={ch.composite}
            selected={sel === ch.id}
            tabIndex={ch.id === tabStopId ? 0 : -1}
            onSelect={() => setSel(ch.id)}
            onVisibilityToggle={(v) => onVisibilityChange?.(ch.id, v)}
          />
        ))}
      </div>
    );
  },
);

// ─── LayerTree ─────────────────────────────────────────────────

export interface LayerNode extends LayerData {
  children?: LayerNode[];
  /** Initial expanded state (folds into the tree's defaultExpandedIds). */
  expanded?: boolean;
}

export interface LayerTreeProps {
  nodes: LayerNode[];
  selectedId?: string;
  defaultSelectedId?: string;
  onSelect?: (id: string) => void;
  expandedIds?: string[];
  defaultExpandedIds?: string[];
  onExpandedChange?: (ids: string[]) => void;
  onVisibilityChange?: (id: string, visible: boolean) => void;
  onLockChange?: (id: string, locked: boolean) => void;
  /** Indentation per depth level, in px. Defaults to 14. */
  indent?: number;
  header?: ReactNode;
  footer?: ReactNode;
  "aria-label"?: string;
  className?: string;
}

/** Map a LayerNode tree to TreeView nodes, carrying the layer payload on `data`. */
function toTreeNodes(nodes: LayerNode[]): TreeNode[] {
  return nodes.map((n) => ({
    id: n.id,
    label: n.name,
    data: n,
    children: n.children ? toTreeNodes(n.children) : undefined,
  }));
}

/** Collect the ids of nodes flagged `expanded` (the tree's uncontrolled seed). */
function expandedSeed(nodes: LayerNode[], out: string[]): string[] {
  for (const n of nodes) {
    if (n.expanded) out.push(n.id);
    if (n.children) expandedSeed(n.children, out);
  }
  return out;
}

/** A nested layer tree (groups + children). Composes the generic `TreeView`,
 *  rendering a `LayerRow` per node so each row keeps its eye/lock affordances;
 *  the tree owns the twisty, indentation and keyboard navigation. */
export const LayerTree = forwardRef<HTMLDivElement, LayerTreeProps>(function LayerTree(
  {
    nodes,
    selectedId,
    defaultSelectedId,
    onSelect,
    expandedIds,
    defaultExpandedIds,
    onExpandedChange,
    onVisibilityChange,
    onLockChange,
    indent = 14,
    header,
    footer,
    className,
    ...aria
  },
  ref,
) {
  const treeNodes = React.useMemo(() => toTreeNodes(nodes), [nodes]);
  const seed = React.useMemo(
    () => defaultExpandedIds ?? expandedSeed(nodes, []),
    [defaultExpandedIds, nodes],
  );

  return (
    <div ref={ref} className={cx("monet-cv-layertree", className)}>
      {header != null && <div className="monet-cv-layerlist-header">{header}</div>}
      <TreeView
        nodes={treeNodes}
        aria-label={aria["aria-label"] ?? "Layers"}
        indent={indent}
        selectedId={selectedId}
        defaultSelectedId={defaultSelectedId}
        onSelect={(id) => onSelect?.(id)}
        expandedIds={expandedIds}
        defaultExpandedIds={seed}
        onExpandedChange={onExpandedChange}
        renderNode={(node, info) => {
          const layer = node.data as LayerData;
          return (
            <LayerRow
              name={node.label}
              visible={layer.visible ?? true}
              locked={layer.locked ?? false}
              opacity={layer.opacity}
              blendMode={layer.blendMode}
              colorChip={layer.colorChip}
              thumb={info.hasChildren ? undefined : layer.thumb}
              selected={info.selected}
              className="monet-cv-layertree-row"
              onVisibilityToggle={(v) => onVisibilityChange?.(node.id, v)}
              onLockToggle={(l) => onLockChange?.(node.id, l)}
            />
          );
        }}
      />
      {footer != null && <div className="monet-cv-layerlist-footer">{footer}</div>}
    </div>
  );
});

// ─── ArtboardList ──────────────────────────────────────────────

export interface ArtboardData {
  id: string;
  name: string;
  /** Size readout shown in the meta slot (e.g. "1440 × 1024"). */
  size?: ReactNode;
  thumb?: ReactNode;
}

export interface ArtboardListProps {
  artboards: ArtboardData[];
  selectedId?: string;
  defaultSelectedId?: string;
  onSelect?: (id: string) => void;
  /** Fires on double-click / Enter (open the artboard). */
  onActivate?: (id: string) => void;
  "aria-label"?: string;
  className?: string;
}

/** An artboard picker (role=listbox) reusing the `.monet-layer` row (thumb +
 *  name + size meta). Selecting fires `onSelect`; double-click / Enter fires
 *  `onActivate`. */
export const ArtboardList = forwardRef<HTMLDivElement, ArtboardListProps>(
  function ArtboardList(
    { artboards, selectedId, defaultSelectedId, onSelect, onActivate, className, ...aria },
    ref,
  ) {
    const [sel, setSel] = useControllableState<string | undefined>(
      selectedId,
      defaultSelectedId,
      onSelect as (v: string | undefined) => void,
    );
    const els = useRef<Record<string, HTMLDivElement | null>>({});
    const focusRow = (id: string) => els.current[id]?.focus();
    const tabStopId = artboards.find((a) => a.id === sel)?.id ?? artboards[0]?.id;

    return (
      <div
        ref={ref}
        role="listbox"
        aria-label={aria["aria-label"] ?? "Artboards"}
        className={cx("monet-cv-artboardlist", className)}
        onKeyDown={(e) => {
          const active = document.activeElement as HTMLElement | null;
          const activeId = artboards.find((a) => els.current[a.id] === active)?.id;
          if (e.key === "Enter" && activeId) {
            e.preventDefault();
            onActivate?.(activeId);
            return;
          }
          rovingKeyDown(e, artboards, activeId ?? tabStopId, focusRow);
        }}
      >
        {artboards.map((ab) => (
          <div
            key={ab.id}
            ref={(el) => {
              els.current[ab.id] = el;
            }}
            id={ab.id}
            role="option"
            aria-selected={sel === ab.id}
            tabIndex={ab.id === tabStopId ? 0 : -1}
            className={cx("monet-layer", "monet-cv-artboard", sel === ab.id && "is-selected")}
            onClick={() => setSel(ab.id)}
            onDoubleClick={(e: ReactMouseEvent) => {
              e.preventDefault();
              onActivate?.(ab.id);
            }}
            onKeyDown={(e) => {
              if (e.key === " ") {
                e.preventDefault();
                setSel(ab.id);
              }
            }}
          >
            {ab.thumb !== undefined && (
              <span className="thumb monet-cv-artboard-thumb">{ab.thumb}</span>
            )}
            <span className="name">{ab.name}</span>
            {ab.size != null && <span className="meta monet-cv-artboard-size">{ab.size}</span>}
          </div>
        ))}
      </div>
    );
  },
);
