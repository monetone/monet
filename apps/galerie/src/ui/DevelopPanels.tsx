// DevelopPanels — the engine-backed slider panels of the Develop module beyond
// Basic: Detail, Effects, Optics, Transform. Each is a thin spec table over a
// shared <SliderPanel>. Sliders run in integer UI units; the stored recipe value
// is `int * scale` — the engine's input domain, mirrored 1:1 from Vision's
// shipped Camera-Raw specs (apps/vision/src/ui/dialogs/CameraRawWorkspace.tsx) so
// both apps drive the same develop engine identically. A field only appears here
// if recipeToParams actually writes it to the ABI (packages/monet-photo
// developParams.ts) — no dead sliders.

import { Button, Checkbox, Select } from "@monet-ui/monet-react";
import { useState, type HTMLAttributes, type ReactNode } from "react";

import { createDefaultRecipe, solveUpright, UPRIGHT_MODES } from "@monet-ui/monet-photo";

import { store } from "../state/store";
import { DevRow } from "./DevRow";

import type {
  CalibrationPanel as CalibrationParams,
  ColorGradingPanel as ColorGradingParams,
  ColorMixerPanel as ColorMixerParams,
  DetailPanel as DetailParams,
  EffectsPanel as EffectsParams,
  OpticsPanel as OpticsParams,
  ProfilePanel as ProfileParams,
  TransformPanel as TransformParams,
} from "@monet-ui/monet-photo";

export interface SliderSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  scale: number;
  /** Stored value a double-click resets to (default 0; e.g. Radius=1, Midpoint=0.5). */
  neutral?: number;
}
export interface ToggleSpec {
  key: string;
  label: string;
}
export interface Section {
  name?: string;
  specs: SliderSpec[];
}

/** Slider int shown for a stored (scaled) value. */
function intOf(value: number, scale: number): number {
  return Math.round(value / scale);
}

type PanelValues = Record<string, number | boolean>;

/** LR's per-panel enable switch + Reset, shared by every panel header. The
 *  switch renders only when the view wires `onToggleEnabled` (recipe.enabled.*),
 *  so callers without the plumbing keep today's Reset-only header. */
export interface PanelEnableProps {
  /** Panel on/off (recipe.enabled.*); undefined = always on (no switch shown). */
  enabled?: boolean;
  onToggleEnabled?: (on: boolean) => void;
}

export function PanelHead({
  title,
  enabled,
  onToggleEnabled,
  onReset,
  children,
}: PanelEnableProps & { title: string; onReset: () => void; children?: ReactNode }) {
  return (
    <div className="gal-dev-head">
      {onToggleEnabled && (
        <Checkbox
          className="gal-dev-enable"
          checked={enabled !== false}
          onChange={onToggleEnabled}
          aria-label={`Enable ${title} panel`}
        />
      )}
      <span className="gal-dev-title">{title}</span>
      {children}
      <Button variant="ghost" size="sm" onClick={onReset}>
        Reset
      </Button>
    </div>
  );
}

/** Body wrapper that dims + inerts a switched-off panel (sliders keep their
 *  values; the switch itself stays in the always-live header). `inert` is not
 *  in React 18's prop types yet, hence the cast — the DOM attribute is what
 *  makes the body keyboard/AT-inert, not just visually dimmed. */
export function PanelBody({ enabled, children }: { enabled?: boolean; children: ReactNode }) {
  const off = enabled === false;
  const inertProps = (off ? { inert: "" } : {}) as HTMLAttributes<HTMLDivElement>;
  return (
    <div style={off ? { opacity: 0.45, pointerEvents: "none" } : undefined} {...inertProps}>
      {children}
    </div>
  );
}

function SliderPanel({
  title,
  sections,
  toggles,
  values,
  onChange,
  onReset,
  enabled,
  onToggleEnabled,
}: PanelEnableProps & {
  title: string;
  sections: Section[];
  toggles?: ToggleSpec[];
  values: PanelValues;
  onChange: (key: string, value: number | boolean) => void;
  onReset: () => void;
}) {
  return (
    <div className="gal-dev-panel">
      <PanelHead title={title} enabled={enabled} onToggleEnabled={onToggleEnabled} onReset={onReset} />
      <PanelBody enabled={enabled}>
      {toggles?.map((t) => (
        <Checkbox
          key={t.key}
          className="gal-dev-toggle"
          checked={(values[t.key] as number) > 0}
          onChange={(c) => onChange(t.key, c ? 1 : 0)}
        >
          {t.label}
        </Checkbox>
      ))}
      {sections.map((sec, i) => (
        <div key={sec.name ?? i} className="gal-dev-section">
          {sec.name && <div className="gal-dev-sec-label">{sec.name}</div>}
          {sec.specs.map((s) => (
            <DevRow
              key={s.key}
              label={s.label}
              min={s.min}
              max={s.max}
              value={intOf(values[s.key] as number, s.scale)}
              onChange={(v) => onChange(s.key, v * s.scale)}
              onReset={() => onChange(s.key, s.neutral ?? 0)}
            />
          ))}
        </div>
      ))}
      </PanelBody>
    </div>
  );
}

// ── Spec tables (exported for the neutral-default regression test) ─────────────

export const DETAIL_SECTIONS: Section[] = [
  {
    name: "Sharpening",
    specs: [
      { key: "sharpenAmount", label: "Amount", min: 0, max: 100, scale: 0.01 },
      { key: "sharpenRadius", label: "Radius", min: 5, max: 30, scale: 0.1, neutral: 1 },
    ],
  },
  {
    name: "Noise Reduction",
    specs: [
      { key: "nrLuminance", label: "Luminance", min: 0, max: 100, scale: 0.01 },
      { key: "nrLuminanceDetail", label: "Detail", min: 0, max: 100, scale: 0.01 },
      { key: "nrColor", label: "Color", min: 0, max: 100, scale: 0.01 },
    ],
  },
];

export const EFFECTS_SECTIONS: Section[] = [
  {
    name: "Grain",
    specs: [
      { key: "grainAmount", label: "Amount", min: 0, max: 100, scale: 0.01 },
      { key: "grainSize", label: "Size", min: 0, max: 100, scale: 0.01 },
      { key: "grainRoughness", label: "Roughness", min: 0, max: 100, scale: 0.01 },
    ],
  },
  {
    name: "Post-Crop Vignetting",
    specs: [
      { key: "vignetteAmount", label: "Amount", min: -100, max: 100, scale: 0.01 },
      { key: "vignetteMidpoint", label: "Midpoint", min: 0, max: 100, scale: 0.01, neutral: 0.5 },
    ],
  },
];

// The toggle is UX sugar over the continuous `aberration` field: checked ⇒ 1,
// unchecked ⇒ 0 (the engine treats p[1051] continuously; Vision can write any
// value, Galerie only the endpoints).
export const OPTICS_TOGGLES: ToggleSpec[] = [
  { key: "aberration", label: "Remove Chromatic Aberration" },
];
export const OPTICS_SECTIONS: Section[] = [
  {
    name: "Manual",
    specs: [
      { key: "distortionAmount", label: "Distortion", min: -100, max: 100, scale: 0.01 },
      { key: "defringePurpleAmount", label: "Defringe", min: 0, max: 100, scale: 0.01 },
    ],
  },
];

// LR's slider order. Vertical/Horizontal/Rotate render via the frozen prefix
// floats [1083..1085]; Aspect/Scale/X/Y Offset ride the v4 advanced tail
// (developParams). Scale is a factor (neutral 1 = 100%), LR's 50..150% range.
export const TRANSFORM_SECTIONS: Section[] = [
  {
    specs: [
      { key: "vertical", label: "Vertical", min: -100, max: 100, scale: 0.01 },
      { key: "horizontal", label: "Horizontal", min: -100, max: 100, scale: 0.01 },
      { key: "rotate", label: "Rotate", min: -100, max: 100, scale: 0.01 },
      { key: "aspect", label: "Aspect", min: -100, max: 100, scale: 0.01 },
      { key: "scale", label: "Scale", min: 50, max: 150, scale: 0.01, neutral: 1 },
      { key: "xOffset", label: "X Offset", min: -100, max: 100, scale: 0.01 },
      { key: "yOffset", label: "Y Offset", min: -100, max: 100, scale: 0.01 },
    ],
  },
];

// Camera Calibration — shadow tint + per-primary hue/saturation. Ranges mirror
// Vision's Camera-Raw calibration UI (stored value = int * 0.01, i.e. −1..1),
// the domain the engine's develop_profile_calibration reads.
export const CALIBRATION_SECTIONS: Section[] = [
  {
    name: "Shadows",
    specs: [{ key: "shadowTint", label: "Tint", min: -100, max: 100, scale: 0.01 }],
  },
  {
    name: "Red Primary",
    specs: [
      { key: "redHue", label: "Hue", min: -100, max: 100, scale: 0.01 },
      { key: "redSat", label: "Saturation", min: -100, max: 100, scale: 0.01 },
    ],
  },
  {
    name: "Green Primary",
    specs: [
      { key: "greenHue", label: "Hue", min: -100, max: 100, scale: 0.01 },
      { key: "greenSat", label: "Saturation", min: -100, max: 100, scale: 0.01 },
    ],
  },
  {
    name: "Blue Primary",
    specs: [
      { key: "blueHue", label: "Hue", min: -100, max: 100, scale: 0.01 },
      { key: "blueSat", label: "Saturation", min: -100, max: 100, scale: 0.01 },
    ],
  },
];

type PanelProps<T> = PanelEnableProps & {
  values: T;
  onChange: (key: string, value: number | boolean) => void;
  onReset: () => void;
};

export function DetailPanel({ values, onChange, onReset, enabled, onToggleEnabled }: PanelProps<DetailParams>) {
  return (
    <SliderPanel
      title="Detail"
      sections={DETAIL_SECTIONS}
      values={values as unknown as PanelValues}
      onChange={onChange}
      onReset={onReset}
      enabled={enabled}
      onToggleEnabled={onToggleEnabled}
    />
  );
}

export function EffectsPanel({ values, onChange, onReset, enabled, onToggleEnabled }: PanelProps<EffectsParams>) {
  return (
    <SliderPanel
      title="Effects"
      sections={EFFECTS_SECTIONS}
      values={values as unknown as PanelValues}
      onChange={onChange}
      onReset={onReset}
      enabled={enabled}
      onToggleEnabled={onToggleEnabled}
    />
  );
}

export function OpticsPanel({ values, onChange, onReset, enabled, onToggleEnabled }: PanelProps<OpticsParams>) {
  return (
    <SliderPanel
      title="Optics"
      sections={OPTICS_SECTIONS}
      toggles={OPTICS_TOGGLES}
      values={values as unknown as PanelValues}
      onChange={onChange}
      onReset={onReset}
      enabled={enabled}
      onToggleEnabled={onToggleEnabled}
    />
  );
}

// ── Profile (camera / creative) ─────────────────────────────────────────────
// Camera/creative profile + creative Amount, mirroring Vision's Camera-Raw
// Profile control. The id drives the engine profile code (developParams
// PROFILE_CODES → p[1088]); camera-default(0) is the neutral no-op. Amount is the
// creative-LUT strength (0..100% → 0..1, engine p[1089]).

export const PROFILE_OPTIONS = [
  { id: "camera-default", name: "Camera Default" },
  { id: "adobe-color", name: "Adobe Color" },
  { id: "camera-neutral", name: "Camera Neutral" },
  { id: "monochrome", name: "Monochrome" },
] as const;

export function ProfilePanel({
  values,
  onSelect,
  onAmount,
  onReset,
}: {
  values: ProfileParams;
  onSelect: (id: string, name: string) => void;
  onAmount: (amount: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="gal-dev-panel">
      <div className="gal-dev-head">
        <span className="gal-dev-title">Profile</span>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset
        </Button>
      </div>
      <Select
        size="sm"
        block
        style={{ marginBottom: 8 }}
        aria-label="Camera Profile"
        value={values.id}
        options={PROFILE_OPTIONS.map((o) => ({ value: o.id, label: o.name }))}
        onChange={(v) => {
          const opt = PROFILE_OPTIONS.find((o) => o.id === v);
          if (opt) onSelect(opt.id, opt.name);
        }}
      />
      <div className="gal-dev-section">
        <DevRow
          label="Amount"
          min={0}
          max={100}
          value={Math.round(values.amount * 100)}
          onChange={(v) => onAmount(v / 100)}
          onReset={() => onAmount(1)}
          suffix="%"
        />
      </div>
    </div>
  );
}

export function CalibrationPanel({ values, onChange, onReset, enabled, onToggleEnabled }: PanelProps<CalibrationParams>) {
  return (
    <SliderPanel
      title="Calibration"
      sections={CALIBRATION_SECTIONS}
      values={values as unknown as PanelValues}
      onChange={onChange}
      onReset={onReset}
      enabled={enabled}
      onToggleEnabled={onToggleEnabled}
    />
  );
}

// ── Upright ───────────────────────────────────────────────────────────────────
// LR's Upright buttons. The solver lives in @monet-ui/monet-photo, shared with
// Vision's Camera Raw Geometry section (#444); the re-exports keep this module's
// public names.

export type UprightMode = TransformParams["upright"];
export { solveGuidedUpright, solveUpright, UPRIGHT_MODES } from "@monet-ui/monet-photo";
export type { UprightLine, UprightSolution } from "@monet-ui/monet-photo";

/** Grab a downscaled copy of the live develop preview for the Upright solver.
 *  ponytail: reaches into the DOM by class instead of plumbing an ImageData
 *  prop through DevelopView — swap to a prop if this ever needs to be driven
 *  headlessly. */
function readDevelopPreview(): { data: Uint8ClampedArray; width: number; height: number } | null {
  const cv = document.querySelector<HTMLCanvasElement>("canvas.gal-dev-canvas");
  const ctx = cv?.getContext("2d", { willReadFrequently: true });
  if (!cv || !ctx || cv.width < 8 || cv.height < 8) return null;
  const scale = Math.min(1, 320 / Math.max(cv.width, cv.height));
  const w = Math.max(8, Math.round(cv.width * scale));
  const h = Math.max(8, Math.round(cv.height * scale));
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d");
  if (!octx) return null;
  octx.drawImage(cv, 0, 0, w, h);
  return { data: octx.getImageData(0, 0, w, h).data, width: w, height: h };
}

export function TransformPanel({ values, onChange, onReset, enabled, onToggleEnabled }: PanelProps<TransformParams>) {
  // `upright` is the one non-numeric transform field; DevelopView's patchPanel
  // spreads the value verbatim, so route the mode string through the numeric
  // onChange with a cast rather than widening every panel's onChange type.
  const set = (key: string, v: number | boolean | string) => onChange(key, v as unknown as number);
  const applyUpright = (mode: UprightMode) => {
    if (mode === "off") {
      // ponytail: solved Upright is baked into the three keystone floats, so
      // Off zeroes them (LR keeps Upright separate from manual transforms —
      // that split needs dedicated recipe fields if anyone misses it).
      set("upright", "off");
      set("vertical", 0);
      set("horizontal", 0);
      set("rotate", 0);
      return;
    }
    if (mode === "guided") return; // solver ready (solveGuidedUpright), overlay pending
    const img = readDevelopPreview();
    if (!img) return;
    const s = solveUpright(mode, img);
    if (!s) return;
    set("upright", mode);
    set("vertical", s.vertical);
    set("horizontal", s.horizontal);
    set("rotate", s.rotate);
  };
  return (
    <div className="gal-dev-panel">
      <PanelHead title="Transform" enabled={enabled} onToggleEnabled={onToggleEnabled} onReset={onReset} />
      <PanelBody enabled={enabled}>
      <div className="gal-dev-sec-label">Upright</div>
      <div className="gal-dev-tabs">
        {UPRIGHT_MODES.map((m) => (
          <button
            key={m.key}
            className={"gal-dev-tab" + (values.upright === m.key ? " is-active" : "")}
            disabled={m.key === "guided"}
            title={
              m.key === "guided"
                ? "Guided Upright — draw-on-image guides are not wired up yet"
                : `Upright: ${m.label}`
            }
            onClick={() => applyUpright(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="gal-dev-section">
        {TRANSFORM_SECTIONS.flatMap((sec) => sec.specs).map((s) => (
          <DevRow
            key={s.key}
            label={s.label}
            min={s.min}
            max={s.max}
            value={intOf((values as unknown as PanelValues)[s.key] as number, s.scale)}
            onChange={(v) => onChange(s.key, v * s.scale)}
            onReset={() => onChange(s.key, s.neutral ?? 0)}
          />
        ))}
      </div>
      <Checkbox
        className="gal-dev-toggle"
        checked={values.constrainCrop === true}
        onChange={(c) => onChange("constrainCrop", c)}
      >
        Constrain Crop
      </Checkbox>
      </PanelBody>
    </div>
  );
}

// ── Color Mixer (HSL) ──────────────────────────────────────────────────────────
// One sub-channel (Hue/Saturation/Luminance) at a time × the eight ACR hue bands.
// Recipe stores -1..1 per band; sliders show the ±100 ACR range (scale 0.01).
// Mirrors Vision's HSL panel + the engine bands at developParams offset 1053.

export const HSL_BANDS = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"] as const;
export const MIXER_CHANNELS = [
  { key: "hue", label: "Hue" },
  { key: "saturation", label: "Saturation" },
  { key: "luminance", label: "Luminance" },
] as const;
export type MixerChannel = (typeof MIXER_CHANNELS)[number]["key"];
const HSL_SCALE = 0.01;

export function ColorMixerPanel({
  values,
  onChange,
  onReset,
  channel,
  onChannelChange,
  tatActive,
  onToggleTat,
  enabled,
  onToggleEnabled,
}: PanelEnableProps & {
  values: ColorMixerParams;
  onChange: (channel: MixerChannel, band: number, value: number) => void;
  onReset: () => void;
  /** Controlled sub-channel (falls back to internal state if omitted). */
  channel?: MixerChannel;
  onChannelChange?: (channel: MixerChannel) => void;
  /** Targeted Adjustment Tool: drag-on-image adjusts the current sub-channel. */
  tatActive?: boolean;
  onToggleTat?: () => void;
}) {
  const [internalCh, setInternalCh] = useState<MixerChannel>("hue");
  const ch = channel ?? internalCh;
  const setCh = (c: MixerChannel) => (onChannelChange ? onChannelChange(c) : setInternalCh(c));
  const band = values[ch];
  return (
    <div className="gal-dev-panel">
      <PanelHead title="Color Mixer" enabled={enabled} onToggleEnabled={onToggleEnabled} onReset={onReset}>
        {onToggleTat && (
          <Button
            variant={tatActive ? "primary" : "ghost"}
            size="sm"
            onClick={onToggleTat}
            title="Targeted Adjustment — drag on the image to adjust the band under the cursor"
            aria-pressed={tatActive}
          >
            ◎
          </Button>
        )}
      </PanelHead>
      <PanelBody enabled={enabled}>
      <div className="gal-dev-tabs">
        {MIXER_CHANNELS.map((c) => (
          <button
            key={c.key}
            className={"gal-dev-tab" + (c.key === ch ? " is-active" : "")}
            onClick={() => setCh(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="gal-dev-section">
        {HSL_BANDS.map((b, i) => (
          <DevRow
            key={b}
            label={b}
            min={-100}
            max={100}
            value={Math.round((band[i] ?? 0) / HSL_SCALE)}
            onChange={(v) => onChange(ch, i, v * HSL_SCALE)}
            onReset={() => onChange(ch, i, 0)}
          />
        ))}
      </div>
      </PanelBody>
    </div>
  );
}

// ── Color Grading (three-way) ──────────────────────────────────────────────────
// Shadows/Midtones/Highlights, each a Hue (0..360°, stored in degrees) +
// Saturation (0..100 → 0..1, scale 0.01) pair. The engine renders these six
// values at developParams offset 1077; Global wheel, Luminance, blending and
// balance aren't in the v1 ABI yet, so they're intentionally not shown.

export const GRADE_ZONES = [
  { key: "shadows", label: "Shadows" },
  { key: "midtones", label: "Midtones" },
  { key: "highlights", label: "Highlights" },
] as const;
export type GradeZone = (typeof GRADE_ZONES)[number]["key"];
const GRADE_SAT_SCALE = 0.01;

export function ColorGradingPanel({
  values,
  onChange,
  onReset,
  enabled,
  onToggleEnabled,
}: PanelEnableProps & {
  values: ColorGradingParams;
  onChange: (zone: GradeZone, field: "hue" | "sat", value: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="gal-dev-panel">
      <PanelHead title="Color Grading" enabled={enabled} onToggleEnabled={onToggleEnabled} onReset={onReset} />
      <PanelBody enabled={enabled}>
      {GRADE_ZONES.map((z) => {
        const w = values[z.key];
        return (
          <div key={z.key} className="gal-dev-section">
            <div className="gal-dev-sec-label">{z.label}</div>
            <DevRow
              label="Hue"
              min={0}
              max={360}
              value={Math.round(w.hue)}
              onChange={(v) => onChange(z.key, "hue", v)}
              onReset={() => onChange(z.key, "hue", 0)}
            />
            <DevRow
              label="Sat"
              min={0}
              max={100}
              value={Math.round(w.sat / GRADE_SAT_SCALE)}
              onChange={(v) => onChange(z.key, "sat", v * GRADE_SAT_SCALE)}
              onReset={() => onChange(z.key, "sat", 0)}
            />
          </div>
        );
      })}
      </PanelBody>
    </div>
  );
}

/** Window event asking an open DevelopView to reset the loaded photo to the
 *  default recipe. The view cancels the event to claim it, so the reset flows
 *  through its live recipe path (canvas + debounced persist + History). */
export const DEVELOP_RESET_EVENT = "galerie:develop-reset";

/** Reset Adjustments (Develop menu / ⇧⌘R): every target photo back to the
 *  default develop settings in one step, recorded as a History entry (LR's
 *  whole-image Reset). An open DevelopView claims the event and owns the
 *  write; otherwise the store persists the default recipe per photo. */
export function resetDevelopAdjustments(): void {
  // ponytail: an unclaimed dispatch while Develop is open writes behind the
  // view's back and the canvas shows it stale (the ceiling ⇧⌘V paste already
  // has there); a DEVELOP_RESET_EVENT listener in DevelopView is the upgrade.
  if (!window.dispatchEvent(new CustomEvent(DEVELOP_RESET_EVENT, { cancelable: true }))) return;
  const s = store.getState();
  const ids = s.selection.length ? s.selection : s.activeId != null ? [s.activeId] : [];
  if (ids.length) void store.applyQuickDevelop(ids, () => createDefaultRecipe());
}
