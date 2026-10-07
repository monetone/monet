// BasicPanel — the Develop Basic panel (WB / Tone / Presence). Sliders run
// -100..100 in the UI; the stored recipe value is `sliderInt * scale` (the
// engine's expected domain, matching Vision's Camera-Raw specs). Editing a
// slider writes the scaled value back into the recipe.
//
// The White Balance row leads with Lightroom's preset menu, because picking one
// is the first move of most RAW edits — a relative Temp nudge is the fallback,
// not the entry point. A preset writes real Temp/Tint offsets (see
// developRecipe's applyWhiteBalance), so nothing here is a dead control.

import { Button, Select } from "@monet-ui/monet-react";

import {
  applyWhiteBalance,
  WB_PRESETS,
  type BasicPanel as BasicParams,
  type WhiteBalanceMode,
} from "@monet-ui/monet-photo";

import { DevRow } from "./DevRow";
import { PanelBody, PanelHead, type PanelEnableProps } from "./DevelopPanels";

type BasicKey =
  | "wbMode"
  | "temp" | "tint" | "exposure" | "contrast" | "highlights" | "shadows"
  | "whites" | "blacks" | "texture" | "clarity" | "dehaze" | "vibrance" | "saturation";

/** Every numeric key — the WB menu is the only non-numeric writer. */
type SliderKey = Exclude<BasicKey, "wbMode">;

// ponytail: "Auto" is deliberately absent. Adobe's Auto WB analyses the frame,
// and this panel only ever sees the recipe — offering it would be a menu entry
// that does nothing. Upgrade path: DevelopView already computes a histogram for
// Auto Tone (`applyAutoTone`); hang Auto WB off the same render and add the
// entry then. `wbMode: "auto"` already exists in the schema for that day.
const WB_MENU: { mode: WhiteBalanceMode; label: string }[] = [
  { mode: "asShot", label: "As Shot" },
  ...WB_PRESETS.map((p) => ({ mode: p.mode as WhiteBalanceMode, label: p.label })),
  { mode: "custom", label: "Custom" },
];

interface Spec {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  scale: number;
}

interface Section {
  name: string;
  specs: Spec[];
  /** Renders the WB preset menu above the section's sliders. */
  wb?: true;
}

// Mirrors apps/vision CameraRawWorkspace basic specs (engine input domain).
const SECTIONS: Section[] = [
  {
    name: "White Balance",
    wb: true,
    specs: [
      { key: "temp", label: "Temp", min: -100, max: 100, scale: 0.01 },
      { key: "tint", label: "Tint", min: -100, max: 100, scale: 0.01 },
    ],
  },
  {
    name: "Tone",
    specs: [
      { key: "exposure", label: "Exposure", min: -100, max: 100, scale: 0.04 },
      { key: "contrast", label: "Contrast", min: -100, max: 100, scale: 0.01 },
      { key: "highlights", label: "Highlights", min: -100, max: 100, scale: 0.01 },
      { key: "shadows", label: "Shadows", min: -100, max: 100, scale: 0.01 },
      { key: "whites", label: "Whites", min: -100, max: 100, scale: 0.01 },
      { key: "blacks", label: "Blacks", min: -100, max: 100, scale: 0.01 },
    ],
  },
  {
    name: "Presence",
    specs: [
      { key: "texture", label: "Texture", min: -100, max: 100, scale: 0.01 },
      { key: "clarity", label: "Clarity", min: -100, max: 100, scale: 0.01 },
      { key: "dehaze", label: "Dehaze", min: -100, max: 100, scale: 0.01 },
      { key: "vibrance", label: "Vibrance", min: -100, max: 100, scale: 0.01 },
      { key: "saturation", label: "Saturation", min: -100, max: 100, scale: 0.01 },
    ],
  },
];

/** Slider int shown for a stored (scaled) value. */
function toInt(value: number, scale: number): number {
  return Math.round(value / scale);
}

export function BasicPanel({
  basic,
  onChange,
  onAuto,
  onReset,
  enabled,
  onToggleEnabled,
}: PanelEnableProps & {
  basic: BasicParams;
  onChange: (key: BasicKey, value: number | WhiteBalanceMode) => void;
  /** Auto Tone: derive Exposure/Contrast from the current render's histogram. */
  onAuto: () => void;
  onReset: () => void;
}) {
  /** Apply a menu choice as the three fields it moves. `onChange` is one key at
   *  a time and its setter is functional, so the three land together. */
  const selectWb = (mode: WhiteBalanceMode): void => {
    const next = applyWhiteBalance(basic, mode);
    onChange("wbMode", next.wbMode);
    onChange("temp", next.temp);
    onChange("tint", next.tint);
  };

  /** Dragging Temp/Tint by hand is what "Custom" means (Lightroom does the same). */
  const setSlider = (key: SliderKey, value: number): void => {
    onChange(key, value);
    if (key === "temp" || key === "tint") onChange("wbMode", "custom");
  };

  return (
    <div className="gal-dev-panel">
      <PanelHead title="Basic" enabled={enabled} onToggleEnabled={onToggleEnabled} onReset={onReset}>
        <Button variant="ghost" size="sm" onClick={onAuto} title="Auto Tone (Exposure, Contrast, Highlights, Shadows, Whites, Blacks)">
          Auto
        </Button>
      </PanelHead>
      <PanelBody enabled={enabled}>
      {SECTIONS.map((sec) => (
        <div key={sec.name} className="gal-dev-section">
          <div className="gal-dev-sec-label">{sec.name}</div>
          {sec.wb && (
            <Select
              size="sm"
              block
              style={{ marginBottom: 6 }}
              aria-label="White Balance"
              value={basic.wbMode}
              options={[
                ...WB_MENU.map((o) => ({ value: o.mode, label: o.label })),
                // A stored "auto" would otherwise have no option to select.
                ...(basic.wbMode === "auto" ? [{ value: "auto", label: "Auto" }] : []),
              ]}
              onChange={(v) => selectWb(v as WhiteBalanceMode)}
            />
          )}
          {sec.specs.map((s) => (
            <DevRow
              key={s.key}
              label={s.label}
              min={s.min}
              max={s.max}
              value={toInt(basic[s.key], s.scale)}
              onChange={(v) => setSlider(s.key, v * s.scale)}
              onReset={() => setSlider(s.key, 0)}
            />
          ))}
        </div>
      ))}
      </PanelBody>
    </div>
  );
}
