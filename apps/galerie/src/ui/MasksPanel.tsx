// MasksPanel — the Develop Masking panel (Phase 3, manual gradients). Adds
// Linear/Radial gradient masks, lists them (enable/select/delete), and edits the
// selected mask's local adjustments + opacity/invert (+ radial feather). Geometry
// is dragged on the canvas via MaskOverlay. The mask graph lives in the recipe
// (recipe.masks), so edits persist through the normal Develop save path.

import { Button, Checkbox, Select } from "@monet-ui/monet-react";
import { useState } from "react";

import type {
  ColorRangeComponent,
  CombineMode,
  DepthRangeComponent,
  LocalAdjustments,
  LuminanceRangeComponent,
  Mask,
} from "@monet-ui/monet-photo";

import type { BrushSettings, ComponentKind, DepthKind, GradientKind, RangeKind } from "../lib/maskEdit";
import { DevRow } from "./DevRow";

type LocalKey = keyof LocalAdjustments;

/** Replace one component (matched by id) in a mask immutably. */
function withComponent(mask: Mask, compId: string, next: Mask["components"][number]): Mask {
  return { ...mask, components: mask.components.map((c) => (c.id === compId ? next : c)) };
}

const COMBINE_LABELS: Record<CombineMode, string> = {
  add: "Add",
  subtract: "Subtract",
  intersect: "Intersect",
};
const COMPONENT_LABELS: Record<ComponentKind, string> = {
  linearGradient: "Linear",
  radialGradient: "Radial",
  rangeColor: "Color",
  rangeLuminance: "Luma",
  brush: "Brush",
};
/** Display label for a component row; AI base components aren't in
 *  COMPONENT_LABELS (they can't be added from the stack buttons). */
const componentLabel = (kind: string): string =>
  kind === "aiSubject" ? "Subject" : COMPONENT_LABELS[kind as ComponentKind] ?? kind;

// Local sliders share the Basic panel's scaled domain (sliderInt * scale), so
// foldLocalAdjustments can add them straight onto the recipe's basic values.
const LOCAL_SPECS: { key: LocalKey; label: string; scale: number }[] = [
  { key: "exposure", label: "Exposure", scale: 0.04 },
  { key: "contrast", label: "Contrast", scale: 0.01 },
  { key: "highlights", label: "Highlights", scale: 0.01 },
  { key: "shadows", label: "Shadows", scale: 0.01 },
  { key: "whites", label: "Whites", scale: 0.01 },
  { key: "blacks", label: "Blacks", scale: 0.01 },
  { key: "texture", label: "Texture", scale: 0.01 },
  { key: "clarity", label: "Clarity", scale: 0.01 },
  { key: "dehaze", label: "Dehaze", scale: 0.01 },
  { key: "saturation", label: "Saturation", scale: 0.01 },
  { key: "temp", label: "Temp", scale: 0.01 },
  { key: "tint", label: "Tint", scale: 0.01 },
  { key: "sharpness", label: "Sharpness", scale: 0.01 },
  { key: "noise", label: "Noise", scale: 0.01 },
];

export function MasksPanel({
  masks,
  selectedId,
  onAdd,
  selectedComponentId,
  onSelectComponent,
  onAddComponent,
  onSelect,
  onDelete,
  onDuplicate,
  onMove,
  onChange,
  onPickColorSample,
  pickingMaskId,
  onToggleBrush,
  brushMaskId,
  brushSettings,
  onBrushSettingsChange,
  onClearBrush,
  onSelectSubject,
  subjectBusy,
  hasDepth = false,
}: {
  masks: Mask[];
  selectedId: string | null;
  onAdd: (kind: GradientKind | RangeKind | DepthKind | "brush") => void;
  /** The component (within the selected mask) the editors act on. */
  selectedComponentId: string | null;
  onSelectComponent: (id: string) => void;
  /** Append a component to the selected mask (Add/Subtract/Intersect refinement). */
  onAddComponent: (kind: ComponentKind) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  /** Copy a mask below itself; `invert` = LR's Duplicate and Invert Mask. */
  onDuplicate?: (id: string, invert: boolean) => void;
  /** Reorder a mask by `delta` places (masks composite in list order). */
  onMove?: (id: string, delta: number) => void;
  onChange: (mask: Mask) => void;
  /** Arm the canvas to add a color sample to this mask (color-range picker). */
  onPickColorSample?: (maskId: string) => void;
  /** The mask currently armed for color picking, if any. */
  pickingMaskId?: string | null;
  /** Arm/disarm brush painting for this mask. */
  onToggleBrush?: (maskId: string) => void;
  /** The brush mask currently armed for painting, if any. */
  brushMaskId?: string | null;
  brushSettings?: BrushSettings;
  onBrushSettingsChange?: (settings: BrushSettings) => void;
  onClearBrush?: (maskId: string) => void;
  /** Run AI Select Subject and add a mask from its coverage. */
  onSelectSubject?: () => void;
  /** Select Subject inference is running. */
  subjectBusy?: boolean;
  /** Does the current photo actually carry decoded depth data? Drives whether
   *  "+ Depth" is offered — a Depth Range mask covers zero pixels without it
   *  (GAL-MASK-07: Galerie has no depth ingest yet, so this is false for every
   *  real photo today; the prop exists so the button turns itself on the day a
   *  render site populates RenderedFrame.depth, instead of needing a second fix
   *  here). Defaults to false — the honest state when the caller doesn't know. */
  hasDepth?: boolean;
}) {
  // The mask whose name is being edited inline (double-click, as in LR).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const commitRename = (m: Mask, value: string) => {
    const name = value.trim();
    if (name && name !== m.name) onChange({ ...m, name }); // empty name would leave the row unidentifiable
    setRenamingId(null);
  };

  const sel = masks.find((m) => m.id === selectedId) ?? null;
  // The editors act on the selected component (falling back to the base/first).
  const selComp =
    sel?.components.find((c) => c.id === selectedComponentId) ?? sel?.components[0] ?? null;
  const radialSel = selComp?.kind === "radialGradient" ? selComp : null;
  const colorSel = selComp?.kind === "rangeColor" ? (selComp as ColorRangeComponent) : null;
  const lumaSel = selComp?.kind === "rangeLuminance" ? (selComp as LuminanceRangeComponent) : null;
  const depthSel = selComp?.kind === "rangeDepth" ? (selComp as DepthRangeComponent) : null;
  const brushSel = selComp?.kind === "brush" ? selComp : null;

  return (
    <div className="gal-dev-panel">
      <div className="gal-dev-head">
        <span className="gal-dev-title">Masking</span>
        <div className="gal-mask-add">
          <Button variant="ghost" size="sm" onClick={() => onAdd("linearGradient")} title="Linear Gradient">
            + Linear
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onAdd("radialGradient")} title="Radial Gradient">
            + Radial
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onAdd("rangeColor")} title="Color Range">
            + Color
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onAdd("rangeLuminance")} title="Luminance Range">
            + Luma
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAdd("rangeDepth")}
            disabled={!hasDepth}
            title={hasDepth ? "Depth Range" : "No depth data for this photo — Depth Range would select nothing"}
          >
            + Depth
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onAdd("brush")} title="Brush">
            + Brush
          </Button>
          {onSelectSubject && (
            <Button
              variant="ghost"
              size="sm"
              disabled={subjectBusy}
              onClick={onSelectSubject}
              title="Detect the subject with AI (U²-Net)"
            >
              {subjectBusy ? "Detecting…" : "◆ Subject"}
            </Button>
          )}
        </div>
      </div>

      {masks.length === 0 && <div className="gal-mask-empty">No masks. Add a gradient to edit locally.</div>}

      {masks.map((m, i) => (
        <div key={m.id} className={"gal-mask-row" + (m.id === selectedId ? " is-sel" : "")}>
          <Checkbox
            checked={m.enabled}
            aria-label={m.enabled ? "Disable mask" : "Enable mask"}
            onChange={(c) => onChange({ ...m, enabled: c })}
          />
          {renamingId === m.id ? (
            <input
              className="gal-mask-name"
              aria-label="Mask name"
              defaultValue={m.name}
              autoFocus
              onBlur={(e) => commitRename(m, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(m, e.currentTarget.value);
                else if (e.key === "Escape") setRenamingId(null);
              }}
            />
          ) : (
            <button
              className="gal-mask-name"
              title="Click to select, double-click to rename"
              onClick={() => onSelect(m.id)}
              onDoubleClick={() => setRenamingId(m.id)}
            >
              {m.name}
            </button>
          )}
          {/* Row actions share the panel's flex class so the row keeps its
              three grid columns however many buttons live here. */}
          <div className="gal-mask-add">
            {onDuplicate && (
              <>
                <button
                  className="gal-mask-name gal-mask-act"
                  title="Duplicate Mask"
                  aria-label="Duplicate mask"
                  onClick={() => onDuplicate(m.id, false)}
                >
                  ⧉
                </button>
                <button
                  className="gal-mask-name gal-mask-act"
                  title="Duplicate and Invert Mask"
                  aria-label="Duplicate and invert mask"
                  onClick={() => onDuplicate(m.id, true)}
                >
                  ⊘
                </button>
              </>
            )}
            {onMove && (
              <>
                <button
                  className="gal-mask-name gal-mask-act"
                  title="Move up"
                  aria-label="Move mask up"
                  disabled={i === 0}
                  onClick={() => onMove(m.id, -1)}
                >
                  ↑
                </button>
                <button
                  className="gal-mask-name gal-mask-act"
                  title="Move down"
                  aria-label="Move mask down"
                  disabled={i === masks.length - 1}
                  onClick={() => onMove(m.id, 1)}
                >
                  ↓
                </button>
              </>
            )}
            <button className="gal-mask-del" title="Delete mask" onClick={() => onDelete(m.id)}>
              ×
            </button>
          </div>
        </div>
      ))}

      {sel && (
        <div className="gal-mask-edit">
          <label className="gal-mask-invrow" title="Invert">
            <Checkbox checked={sel.inverted} onChange={(c) => onChange({ ...sel, inverted: c })}>
              Invert
            </Checkbox>
          </label>
          <DevRow
            label="Opacity"
            min={0}
            max={100}
            value={Math.round(sel.opacity * 100)}
            onChange={(v) => onChange({ ...sel, opacity: v / 100 })}
          />

          {/* Every mask, AI or manual, accepts stacked refinement components
              (the canonical LR gesture: Select Subject, then Subtract > Brush). */}
          <div className="gal-dev-sec-label">Components</div>
          {sel.components.map((c, i) => (
            <div
              key={c.id}
              className={"gal-mask-comp" + (c.id === selComp?.id ? " is-sel" : "")}
            >
              <button
                className="gal-mask-comp-name"
                onClick={() => onSelectComponent(c.id)}
                title="Edit this component"
              >
                {componentLabel(c.kind)}
              </button>
              {i === 0 ? (
                <span className="gal-mask-comp-base" title="Base component">
                  Base
                </span>
              ) : (
                <Select
                  size="sm"
                  value={c.combine}
                  aria-label="Combine mode"
                  options={(["add", "subtract", "intersect"] as const).map((m) => ({
                    value: m,
                    label: COMBINE_LABELS[m],
                  }))}
                  onChange={(v) => onChange(withComponent(sel, c.id, { ...c, combine: v as CombineMode }))}
                />
              )}
              <Checkbox
                className="gal-mask-comp-inv"
                checked={c.invert}
                aria-label="Invert component"
                onChange={(iv) => onChange(withComponent(sel, c.id, { ...c, invert: iv }))}
              >
                Inv
              </Checkbox>
              {i !== 0 && (
                <button
                  className="gal-mask-comp-del"
                  title="Remove component"
                  onClick={() =>
                    onChange({ ...sel, components: sel.components.filter((x) => x.id !== c.id) })
                  }
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <div className="gal-mask-add">
            {(Object.keys(COMPONENT_LABELS) as ComponentKind[]).map((k) => (
              <Button
                key={k}
                variant="ghost"
                size="sm"
                onClick={() => onAddComponent(k)}
                title={`Add a ${COMPONENT_LABELS[k]} component to this mask`}
              >
                + {COMPONENT_LABELS[k]}
              </Button>
            ))}
          </div>

          {radialSel && (
            <DevRow
              label="Feather"
              min={0}
              max={100}
              value={Math.round(radialSel.feather * 100)}
              onChange={(v) => onChange(withComponent(sel, radialSel.id, { ...radialSel, feather: v / 100 }))}
            />
          )}

          {colorSel && (
            <>
              <div className="gal-dev-sec-label">Color Range</div>
              <div className="gal-mask-samples">
                {colorSel.samples.map((s, i) => (
                  <span
                    key={i}
                    className="gal-mask-swatch"
                    style={{ background: `rgb(${Math.round(s.r * 255)},${Math.round(s.g * 255)},${Math.round(s.b * 255)})` }}
                    title="Sampled color"
                  />
                ))}
                {colorSel.samples.length === 0 && (
                  <span className="gal-mask-hint">Pick colors from the image</span>
                )}
              </div>
              <div className="gal-mask-add">
                <Button
                  variant={pickingMaskId === sel.id ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => onPickColorSample?.(sel.id)}
                  title="Click the image to add a color"
                >
                  {pickingMaskId === sel.id ? "Picking…" : "Pick Color"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={colorSel.samples.length === 0}
                  onClick={() => onChange(withComponent(sel, colorSel.id, { ...colorSel, samples: [] }))}
                >
                  Clear
                </Button>
              </div>
              <DevRow
                label="Refine"
                min={0}
                max={100}
                value={Math.round(colorSel.refine * 100)}
                onChange={(v) => onChange(withComponent(sel, colorSel.id, { ...colorSel, refine: v / 100 }))}
              />
            </>
          )}

          {lumaSel && (
            <>
              <div className="gal-dev-sec-label">Luminance Range</div>
              {([
                ["Min", "min"],
                ["Max", "max"],
                ["Smoothness", "smoothness"],
              ] as const).map(([label, key]) => (
                <DevRow
                  key={key}
                  label={label}
                  min={0}
                  max={100}
                  value={Math.round(lumaSel[key] * 100)}
                  onChange={(iv) => {
                    const v = iv / 100;
                    // Keep min ≤ max so the band never inverts (zero coverage).
                    const next = { ...lumaSel, [key]: v };
                    if (key === "min" && v > lumaSel.max) next.max = v;
                    if (key === "max" && v < lumaSel.min) next.min = v;
                    onChange(withComponent(sel, lumaSel.id, next));
                  }}
                />
              ))}
            </>
          )}

          {depthSel && (
            <>
              <div className="gal-dev-sec-label">Depth Range</div>
              {/* ponytail: no importer decodes a depth map yet (iPhone Portrait
                  HEIC auxiliary image / a depth model) — until one does, this
                  band selects nothing on every real photo; see
                  maskComposite.ts's RenderedFrame.depth. */}
              <span className="gal-mask-hint">No depth data yet — needs Portrait HEIC or depth-model import</span>
              {([
                ["Near", "near"],
                ["Far", "far"],
                ["Smoothness", "smoothness"],
              ] as const).map(([label, key]) => (
                <DevRow
                  key={key}
                  label={label}
                  min={0}
                  max={100}
                  value={Math.round((key === "smoothness" ? depthSel.smoothness ?? 0.5 : depthSel[key]) * 100)}
                  onChange={(iv) => {
                    const v = iv / 100;
                    // Keep near ≤ far so the band never inverts (zero coverage).
                    const next = { ...depthSel, [key]: v };
                    if (key === "near" && v > depthSel.far) next.far = v;
                    if (key === "far" && v < depthSel.near) next.near = v;
                    onChange(withComponent(sel, depthSel.id, next));
                  }}
                />
              ))}
            </>
          )}

          {brushSel && brushSettings && onBrushSettingsChange && (
            <>
              <div className="gal-dev-sec-label">Brush</div>
              <div className="gal-mask-add">
                <Button
                  variant={brushMaskId === sel.id ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => onToggleBrush?.(sel.id)}
                  title="Paint on the image to add to this mask"
                >
                  {brushMaskId === sel.id ? "Painting…" : "Paint"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={brushSel.dabs.length === 0}
                  onClick={() => onClearBrush?.(sel.id)}
                >
                  Clear ({brushSel.dabs.length})
                </Button>
              </div>
              <Checkbox
                className="gal-dev-toggle"
                checked={brushSettings.erase}
                aria-label="Erase — remove from the mask instead of adding"
                onChange={(er) => onBrushSettingsChange({ ...brushSettings, erase: er })}
              >
                Erase
              </Checkbox>
              <Checkbox
                className="gal-dev-toggle"
                checked={brushSel.autoMask}
                aria-label="Auto Mask — constrain strokes to similar colors"
                onChange={(am) => onChange(withComponent(sel, brushSel.id, { ...brushSel, autoMask: am }))}
              >
                Auto Mask
              </Checkbox>
              {([
                ["Size", "radius", 1, 40] as const,
                ["Flow", "flow", 1, 100] as const,
                ["Density", "density", 1, 100] as const,
              ]).map(([label, key, lo, hi]) => (
                <DevRow
                  key={key}
                  label={label}
                  min={lo}
                  max={hi}
                  value={Math.round(brushSettings[key] * 100)}
                  onChange={(v) => onBrushSettingsChange({ ...brushSettings, [key]: v / 100 })}
                />
              ))}
              {/* Feather lives on the component (like radial feather), not in
                  BrushSettings — it reshapes already-stamped dabs too, matching
                  LR's live feather slider. Absent = 1 (pre-feather look). */}
              <DevRow
                label="Feather"
                min={0}
                max={100}
                value={Math.round((brushSel.feather ?? 1) * 100)}
                onChange={(v) => onChange(withComponent(sel, brushSel.id, { ...brushSel, feather: v / 100 }))}
              />
            </>
          )}

          <div className="gal-dev-sec-label">Local Adjustments</div>
          {LOCAL_SPECS.map((s) => (
            <DevRow
              key={s.key}
              label={s.label}
              min={-100}
              max={100}
              value={Math.round(sel.adjustments[s.key] / s.scale)}
              onChange={(v) => onChange({ ...sel, adjustments: { ...sel.adjustments, [s.key]: v * s.scale } })}
              onReset={() => onChange({ ...sel, adjustments: { ...sel.adjustments, [s.key]: 0 } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
