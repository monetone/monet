// Numeric / transform gallery — drag-to-scrub numbers, steppers, two-thumb
// ranges, rotary dials, and a full X/Y/W/H + rotation transform group. Each
// entry renders an interactive, controlled demo (useState) so the panel
// actually responds; mock data stands in for host inspector values.
import { useState } from "react";
import {
  PropertyRow,
  ScrubbyNumber,
  Stepper,
  RangeSlider,
  AngleDial,
  Knob,
  TransformFields,
  type RangeValue,
  type TransformValue,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

const PAD: React.CSSProperties = { display: "grid", gap: 10, padding: 10 };

// ─── PropertyRow ───────────────────────────────────────────────
// Structural inspector rows: label · control · readout. Wires a couple of
// ScrubbyNumbers in so the rows read like a real inspector.
function PropertyRowDemo() {
  const [opacity, setOpacity] = useState(80);
  const [feather, setFeather] = useState(4.5);
  return (
    <div style={PAD}>
      <PropertyRow label="Opacity" htmlFor="pr-opacity" value={`${opacity}%`}>
        <ScrubbyNumber
          id="pr-opacity"
          aria-label="Opacity"
          value={opacity}
          onChange={setOpacity}
          min={0}
          max={100}
          suffix="%"
        />
      </PropertyRow>
      <PropertyRow label="Feather" htmlFor="pr-feather" value={`${feather.toFixed(1)} px`}>
        <ScrubbyNumber
          id="pr-feather"
          aria-label="Feather"
          value={feather}
          onChange={setFeather}
          min={0}
          max={50}
          step={0.5}
          suffix="px"
        />
      </PropertyRow>
      <PropertyRow label="Blend" fieldValue="Screen" />
    </div>
  );
}

// ─── ScrubbyNumber ─────────────────────────────────────────────
// Drag the label/value horizontally to scrub (Shift ×10, Alt ÷10); click to
// type. Controlled here so each scrub tick updates the live readout.
function ScrubbyNumberDemo() {
  const [x, setX] = useState(0);
  const [scale, setScale] = useState(100);
  const [angle, setAngle] = useState(0);
  return (
    <div style={PAD}>
      <PropertyRow label="Position X" value={`${x} px`}>
        <ScrubbyNumber label="X" suffix="px" value={x} onChange={setX} aria-label="Position X" />
      </PropertyRow>
      <PropertyRow label="Scale" value={`${scale}%`}>
        <ScrubbyNumber
          label="S"
          suffix="%"
          value={scale}
          onChange={setScale}
          min={0}
          max={400}
          aria-label="Scale"
        />
      </PropertyRow>
      <PropertyRow label="Rotation" value={`${angle.toFixed(1)}°`}>
        <ScrubbyNumber
          label="R"
          suffix="°"
          value={angle}
          onChange={setAngle}
          min={-180}
          max={180}
          step={0.5}
          aria-label="Rotation"
        />
      </PropertyRow>
    </div>
  );
}

// ─── Stepper ───────────────────────────────────────────────────
// Compact inc/dec with a middle spinbutton readout; buttons disable at bounds.
function StepperDemo() {
  const [brush, setBrush] = useState(12);
  const [count, setCount] = useState(3);
  const [zoom, setZoom] = useState(100);
  return (
    <div style={PAD}>
      <PropertyRow label="Brush size">
        <Stepper value={brush} onChange={setBrush} min={1} max={64} suffix="px" aria-label="Brush size" />
      </PropertyRow>
      <PropertyRow label="Copies">
        <Stepper value={count} onChange={setCount} min={1} max={12} aria-label="Copies" />
      </PropertyRow>
      <PropertyRow label="Zoom">
        <Stepper
          value={zoom}
          onChange={setZoom}
          min={25}
          max={400}
          step={25}
          suffix="%"
          size="md"
          aria-label="Zoom"
        />
      </PropertyRow>
    </div>
  );
}

// ─── RangeSlider ───────────────────────────────────────────────
// Two-thumb min/max range. Each thumb clamps against the other ± minGap; the
// fill spans between them.
function RangeSliderDemo() {
  const [levels, setLevels] = useState<RangeValue>({ min: 0.15, max: 0.85 });
  const [temp, setTemp] = useState<RangeValue>({ min: 3200, max: 6500 });
  return (
    <div style={PAD}>
      <PropertyRow label="Levels" value={`${levels.min.toFixed(2)} – ${levels.max.toFixed(2)}`}>
        <RangeSlider
          value={levels}
          onChange={setLevels}
          min={0}
          max={1}
          step={0.01}
          minGap={0.05}
          aria-label="Levels"
        />
      </PropertyRow>
      <PropertyRow label="Temp range" value={`${temp.min}–${temp.max}K`}>
        <RangeSlider
          value={temp}
          onChange={setTemp}
          min={2000}
          max={9000}
          step={100}
          minGap={500}
          accent="var(--accent-warm, #d9a45b)"
          aria-label="Temperature range"
        />
      </PropertyRow>
    </div>
  );
}

// ─── AngleDial ─────────────────────────────────────────────────
// Rotary degree dial — drag the needle (0° points up). Full 360° sweep.
function AngleDialDemo() {
  const [rotation, setRotation] = useState(45);
  const [direction, setDirection] = useState(120);
  return (
    <div style={{ ...PAD, justifyItems: "center", gap: 16 }}>
      <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
        <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
          <AngleDial value={rotation} onChange={setRotation} size={56} aria-label="Rotation" />
          <span style={{ fontSize: 11, opacity: 0.7 }}>Rotation · {Math.round(rotation)}°</span>
        </div>
        <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
          <AngleDial
            value={direction}
            onChange={setDirection}
            size={56}
            accent="var(--accent-warm, #d9a45b)"
            aria-label="Light direction"
          />
          <span style={{ fontSize: 11, opacity: 0.7 }}>Light · {Math.round(direction)}°</span>
        </div>
      </div>
    </div>
  );
}

// ─── Knob ──────────────────────────────────────────────────────
// AngleDial preset with a 60° bottom dead-arc and 0..100 bounds — the classic
// gauge look. Tuned here with custom min/max for gain in dB.
function KnobDemo() {
  const [gain, setGain] = useState(50);
  const [mix, setMix] = useState(35);
  return (
    <div style={{ ...PAD, justifyItems: "center", gap: 16 }}>
      <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
        <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
          <Knob value={gain} onChange={setGain} size={52} aria-label="Gain" />
          <span style={{ fontSize: 11, opacity: 0.7 }}>Gain · {Math.round(gain)}</span>
        </div>
        <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
          <Knob
            value={mix}
            onChange={setMix}
            size={52}
            accent="var(--accent-cool, #4aa6b0)"
            aria-label="Wet / dry mix"
          />
          <span style={{ fontSize: 11, opacity: 0.7 }}>Mix · {Math.round(mix)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── TransformFields ───────────────────────────────────────────
// Full transform inspector: X/Y/W/H ScrubbyNumbers + a rotation dial and an
// aspect-lock toggle. Controlled off the resolved `full` transform so locked
// W/H scaling is reflected live.
function TransformFieldsDemo() {
  const [t, setT] = useState<TransformValue>({ x: 64, y: 48, w: 320, h: 200, rotation: 0, shear: 0 });
  return (
    <div style={PAD}>
      <TransformFields value={t} onChange={(_patch, full) => setT(full)} unit="px" lockAspect />
      <div style={{ fontSize: 11, opacity: 0.7, fontFamily: "var(--font-mono, monospace)" }}>
        {Math.round(t.x)}, {Math.round(t.y)} · {Math.round(t.w)}×{Math.round(t.h)} · {Math.round(t.rotation)}°
      </div>
    </div>
  );
}

export const numericEntries: GalleryEntry[] = [
  {
    id: "numeric/PropertyRow",
    label: "PropertyRow",
    category: "Numeric / transform",
    section: "Creative",
    render: () => <PropertyRowDemo />,
  },
  {
    id: "numeric/ScrubbyNumber",
    label: "ScrubbyNumber",
    category: "Numeric / transform",
    section: "Creative",
    render: () => <ScrubbyNumberDemo />,
  },
  {
    id: "numeric/Stepper",
    label: "Stepper",
    category: "Numeric / transform",
    section: "Creative",
    render: () => <StepperDemo />,
  },
  {
    id: "numeric/RangeSlider",
    label: "RangeSlider",
    category: "Numeric / transform",
    section: "Creative",
    render: () => <RangeSliderDemo />,
  },
  {
    id: "numeric/AngleDial",
    label: "AngleDial",
    category: "Numeric / transform",
    section: "Creative",
    render: () => <AngleDialDemo />,
  },
  {
    id: "numeric/Knob",
    label: "Knob",
    category: "Numeric / transform",
    section: "Creative",
    render: () => <KnobDemo />,
  },
  {
    id: "numeric/TransformFields",
    label: "TransformFields",
    category: "Numeric / transform",
    section: "Creative",
    render: () => <TransformFieldsDemo />,
  },
];
