// ui/panels/properties — the Effect-Controls inspector for the selected layer:
// Transform (scrubbable values + per-property keyframe stopwatches), Opacity,
// Effects, and layer appearance/blend.

import { PropertyRow, ScrubbyNumber, Section, Select } from "@monet-ui/monet-react";
import {
  addEffect,
  removeEffect,
  setEffectParam,
  setLayerProps,
  setTransformValue,
  toggleAnimation,
  toggleEffect,
} from "../../commands";
import { replaceLayerImage } from "../../io/files";
import { activeComp, findLayer, isAnimated } from "../../model/query";
import { effectiveTransform } from "../../model/sample";
import type { BlendMode, EffectKind, Layer, TrackProperty } from "../../model/types";
import { useEditor } from "../../state/store";

const ACCENT = "var(--accent-motion, #e64980)";
const BLEND_MODES: BlendMode[] = ["normal", "multiply", "screen", "overlay", "lighten", "darken", "add", "difference"];
const EFFECT_KINDS: { kind: EffectKind; label: string }[] = [
  { kind: "blur", label: "Gaussian Blur" },
  { kind: "glow", label: "Glow" },
  { kind: "dropShadow", label: "Drop Shadow" },
  { kind: "brightness", label: "Brightness" },
  { kind: "tint", label: "Tint" },
];

function Stopwatch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className="anime-stopwatch" data-on={on ? "1" : "0"} onClick={onClick} aria-label="Toggle animation" title="Stopwatch — animate this property">
      {on ? "◆" : "◇"}
    </button>
  );
}

/** A transform row with one stopwatch toggling all its axes + a scrubber each. */
function GroupRow({
  layer,
  t,
  label,
  props,
  suffix,
  step = 1,
  min,
  max,
}: {
  layer: Layer;
  t: number;
  label: string;
  props: TrackProperty[];
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  const xf = effectiveTransform(layer, t);
  const animated = props.every((p) => isAnimated(layer, p));
  return (
    <PropertyRow
      label={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Stopwatch on={animated} onClick={() => props.forEach((p) => (isAnimated(layer, p) === animated ? toggleAnimation(layer.id, p) : undefined))} />
          {label}
        </span>
      }
    >
      <span style={{ display: "inline-flex", gap: 8 }}>
        {props.map((p) => (
          <ScrubbyNumber
            key={p}
            value={Math.round((xf as Record<TrackProperty, number>)[p] * 100) / 100}
            onChange={(v) => setTransformValue(layer.id, p, v)}
            suffix={suffix}
            step={step}
            min={min}
            max={max}
            accent={ACCENT}
          />
        ))}
      </span>
    </PropertyRow>
  );
}

export function PropertiesPanel() {
  const { project, selection, playhead } = useEditor();
  const comp = activeComp(project);
  const layer = selection.length === 1 ? findLayer(comp, selection[0]) : undefined;

  if (!layer) {
    return (
      <div style={{ padding: 16, color: "var(--text-3)", fontSize: 12 }}>
        {selection.length > 1 ? `${selection.length} layers selected` : "Select a layer to edit its properties."}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px 10px" }}>
        <span style={{ width: 14, height: 10, borderRadius: 2, background: layer.color }} />
        <span style={{ fontSize: 12, color: "var(--text-1)" }}>{layer.name}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>{layer.kind}</span>
      </div>

      <Section title="Transform">
        <GroupRow layer={layer} t={playhead} label="Position" props={["x", "y"]} suffix="px" />
        <GroupRow layer={layer} t={playhead} label="Scale" props={["scaleX", "scaleY"]} suffix="%" />
        <GroupRow layer={layer} t={playhead} label="Rotation" props={["rotation"]} suffix="°" />
        <GroupRow layer={layer} t={playhead} label="Anchor" props={["anchorX", "anchorY"]} suffix="px" />
        <GroupRow layer={layer} t={playhead} label="Opacity" props={["opacity"]} suffix="%" min={0} max={100} />
      </Section>

      <Section title="Layer">
        <PropertyRow label="Blend">
          <Select
            size="sm"
            value={layer.blendMode}
            options={BLEND_MODES.map((m) => ({ value: m }))}
            onChange={(v) => setLayerProps(layer.id, { blendMode: v as BlendMode }, "Blend mode")}
          />
        </PropertyRow>
        {(layer.kind === "solid" || layer.kind === "shape" || layer.kind === "text") && (
          <PropertyRow label="Color">
            <input type="color" className="anime-color" value={layer.color} onChange={(e) => setLayerProps(layer.id, { color: e.target.value }, "Color")} />
          </PropertyRow>
        )}
        {layer.kind === "text" && (
          <>
            <PropertyRow label="Text">
              <input className="anime-text-input" value={layer.text ?? ""} onChange={(e) => setLayerProps(layer.id, { text: e.target.value }, "Text")} />
            </PropertyRow>
            <PropertyRow label="Font size">
              <ScrubbyNumber value={layer.fontSize ?? 96} min={4} max={600} onChange={(v) => setLayerProps(layer.id, { fontSize: v }, "Font size")} accent={ACCENT} suffix="px" />
            </PropertyRow>
          </>
        )}
        {layer.kind === "image" && (
          <>
            <PropertyRow label="Source">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {layer.src ? (
                  <img src={layer.src} alt="" style={{ width: 44, height: 30, objectFit: "cover", borderRadius: 3, background: "var(--surface-2)" }} />
                ) : (
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>No image</span>
                )}
                <button className="monet-chip" onClick={() => void replaceLayerImage(layer.id)}>
                  {layer.src ? "Replace…" : "Choose…"}
                </button>
              </span>
            </PropertyRow>
            <PropertyRow label="Size">
              <span style={{ display: "inline-flex", gap: 8 }}>
                <ScrubbyNumber value={layer.width} min={1} onChange={(v) => setLayerProps(layer.id, { width: v }, "Image size")} accent={ACCENT} suffix="px" />
                <ScrubbyNumber value={layer.height} min={1} onChange={(v) => setLayerProps(layer.id, { height: v }, "Image size")} accent={ACCENT} suffix="px" />
              </span>
            </PropertyRow>
          </>
        )}
        <PropertyRow label="In / Out">
          <span style={{ display: "inline-flex", gap: 8 }}>
            <ScrubbyNumber value={Math.round(layer.inPoint * 100) / 100} min={0} step={0.1} onChange={(v) => setLayerProps(layer.id, { inPoint: v }, "In point")} accent={ACCENT} suffix="s" />
            <ScrubbyNumber value={Math.round(layer.outPoint * 100) / 100} min={0} step={0.1} onChange={(v) => setLayerProps(layer.id, { outPoint: v }, "Out point")} accent={ACCENT} suffix="s" />
          </span>
        </PropertyRow>
      </Section>

      <Section
        title="Effects"
        actions={
          <Select
            size="sm"
            value=""
            placeholder="+ Add…"
            options={EFFECT_KINDS.map((f) => ({ value: f.kind, label: f.label }))}
            onChange={(v) => addEffect(layer.id, v as EffectKind)}
          />
        }
      >
        {layer.effects.length === 0 && <div style={{ padding: "4px 2px", fontSize: 11, color: "var(--text-3)" }}>No effects.</div>}
        {layer.effects.map((fx) => (
          <div key={fx.id} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button className="anime-stopwatch" data-on={fx.enabled ? "1" : "0"} onClick={() => toggleEffect(layer.id, fx.id)} aria-label="Toggle effect">
                {fx.enabled ? "●" : "○"}
              </button>
              <span style={{ flex: 1, fontSize: 11, textTransform: "capitalize" }}>{fx.kind}</span>
              <button className="monet-chip" onClick={() => removeEffect(layer.id, fx.id)}>
                Remove
              </button>
            </div>
            {Object.entries(fx.params).map(([key, val]) => (
              <PropertyRow key={key} label={key}>
                <ScrubbyNumber value={val} onChange={(v) => setEffectParam(layer.id, fx.id, key, v)} accent={ACCENT} />
              </PropertyRow>
            ))}
          </div>
        ))}
      </Section>
    </div>
  );
}
