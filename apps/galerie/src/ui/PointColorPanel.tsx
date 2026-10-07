// Point Color — Lightroom-style targeted colour correction. Sample a colour off
// the image (the eyedropper arms DevelopView's canvas), then shift the pixels
// near that colour by hue/sat/lum within a selection range. Serialized to the
// engine's v3 advanced tail by recipeToParams.

import { Button } from "@monet-ui/monet-react";

import { DevRow } from "./DevRow";
import { PanelBody, PanelHead, type PanelEnableProps } from "./DevelopPanels";

import type { PointColorPanel as PointColorParams, PointColorSample } from "@monet-ui/monet-photo";

/** Max sockets the engine's Point Color block accepts (DEV_MAX_POINT_COLORS). */
export const MAX_POINT_COLORS = 8;

const SOCKET_SLIDERS: { key: keyof PointColorSample; label: string; min: number; max: number; scale: number; neutral: number }[] = [
  { key: "hue", label: "Hue", min: -100, max: 100, scale: 0.01, neutral: 0 },
  { key: "sat", label: "Saturation", min: -100, max: 100, scale: 0.01, neutral: 0 },
  { key: "lum", label: "Luminance", min: -100, max: 100, scale: 0.01, neutral: 0 },
  { key: "range", label: "Range", min: 0, max: 100, scale: 0.01, neutral: 0.5 },
];

/** CSS colour for a socket's reference swatch (srcHue 0..360, srcSat/srcLum 0..1). */
const swatch = (s: PointColorSample): string =>
  `hsl(${s.srcHue} ${Math.round(s.srcSat * 100)}% ${Math.round(s.srcLum * 100)}%)`;

export function PointColorPanel({
  values,
  onChange,
  onReset,
  picking,
  onPick,
  enabled,
  onToggleEnabled,
}: PanelEnableProps & {
  values: PointColorParams;
  onChange: (next: PointColorParams) => void;
  onReset: () => void;
  picking: boolean;
  onPick: () => void;
}) {
  const samples = values.samples;
  const patch = (i: number, key: keyof PointColorSample, value: number) =>
    onChange({ samples: samples.map((s, j) => (j === i ? { ...s, [key]: value } : s)) });
  const remove = (i: number) => onChange({ samples: samples.filter((_, j) => j !== i) });

  return (
    <div className="gal-dev-panel">
      <PanelHead title="Point Color" enabled={enabled} onToggleEnabled={onToggleEnabled} onReset={onReset} />
      <PanelBody enabled={enabled}>
      <Button
        variant={picking ? "primary" : "ghost"}
        size="sm"
        block
        disabled={!picking && samples.length >= MAX_POINT_COLORS}
        title={samples.length >= MAX_POINT_COLORS ? `Up to ${MAX_POINT_COLORS} point colors` : "Sample a color from the image"}
        onClick={onPick}
      >
        {picking ? "Click the image to sample…" : "＋ Sample color"}
      </Button>
      {samples.length === 0 && (
        <div className="gal-dev-sec-label" style={{ opacity: 0.6, marginTop: 6 }}>
          No point colors yet.
        </div>
      )}
      {samples.map((s, i) => (
        <div key={i} className="gal-dev-section">
          <div className="gal-dev-sec-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              aria-hidden
              style={{ width: 14, height: 14, borderRadius: 3, background: swatch(s), border: "1px solid var(--border)" }}
            />
            <span>Point {i + 1}</span>
            <Button variant="ghost" size="sm" style={{ marginLeft: "auto" }} onClick={() => remove(i)}>
              Remove
            </Button>
          </div>
          {SOCKET_SLIDERS.map((sp) => (
            <DevRow
              key={String(sp.key)}
              label={sp.label}
              min={sp.min}
              max={sp.max}
              value={Math.round((s[sp.key] as number) / sp.scale)}
              onChange={(v) => patch(i, sp.key, v * sp.scale)}
              onReset={() => patch(i, sp.key, sp.neutral)}
            />
          ))}
        </div>
      ))}
      </PanelBody>
    </div>
  );
}
