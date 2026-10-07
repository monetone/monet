// ─────────────────────────────────────────────────────────────
// Monet gallery — Creative › Color
// ─────────────────────────────────────────────────────────────
// One openable demo panel per creative-color control. Interactive controls are
// wrapped in a tiny demo component with useState so they actually respond;
// display-only ones (EyedropperReadout) get mocked data. Each panel renders in
// a ~300×250 floating panel, so demos stay compact.
//
// Docs: docs/components/creative-color.md
// Source: packages/monet-react/src/creative-color{,-math,-palette}.tsx

import { useState } from "react";
import {
  ColorField,
  HueSlider,
  AlphaSlider,
  ColorWheel,
  GradientEditor,
  ColorPicker,
  Swatch,
  SwatchGrid,
  GlyphGrid,
  HexInput,
  EyedropperReadout,
  type HSV,
  type GradientValue,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

/** A small padded wrapper for compact single-control demos. */
function Pad({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 8, padding: 8 }}>{children}</div>;
}

// ─── ColorField ────────────────────────────────────────────────
function ColorFieldDemo() {
  const [c, setC] = useState<HSV>({ h: 210, s: 0.6, v: 0.9 });
  return (
    <div style={{ padding: 8 }}>
      <ColorField value={c} onChange={setC} style={{ height: 160 }} />
    </div>
  );
}

// ─── HueSlider ─────────────────────────────────────────────────
function HueSliderDemo() {
  const [hue, setHue] = useState(28);
  return (
    <Pad>
      <HueSlider value={hue} onChange={setHue} />
      <span style={{ fontSize: 12, opacity: 0.7 }}>Hue {Math.round(hue)}°</span>
    </Pad>
  );
}

// ─── AlphaSlider ───────────────────────────────────────────────
function AlphaSliderDemo() {
  const [alpha, setAlpha] = useState(0.7);
  return (
    <Pad>
      <AlphaSlider color={{ h: 210, s: 0.6, v: 0.9 }} value={alpha} onChange={setAlpha} />
      <span style={{ fontSize: 12, opacity: 0.7 }}>Opacity {Math.round(alpha * 100)}%</span>
    </Pad>
  );
}

// ─── ColorWheel ────────────────────────────────────────────────
function ColorWheelDemo() {
  const [c, setC] = useState<HSV>({ h: 280, s: 0.7, v: 0.95 });
  return (
    <div style={{ display: "grid", placeItems: "center", padding: 8 }}>
      <ColorWheel size={150} value={c} onChange={setC} />
    </div>
  );
}

// ─── GradientEditor ────────────────────────────────────────────
const MOCK_GRADIENT: GradientValue = {
  type: "linear",
  angle: 90,
  stops: [
    { id: "a", offset: 0, color: "#d6884a" },
    { id: "b", offset: 0.5, color: "#4aa6b0" },
    { id: "c", offset: 1, color: "#8a4ad6" },
  ],
};
function GradientEditorDemo() {
  const [grad, setGrad] = useState<GradientValue>(MOCK_GRADIENT);
  return (
    <div style={{ padding: 8 }}>
      <GradientEditor
        value={grad}
        onChange={setGrad}
        onRequestStopColor={(id) => console.log("pick stop", id)}
      />
    </div>
  );
}

// ─── ColorPicker ───────────────────────────────────────────────
function ColorPickerDemo() {
  const [c, setC] = useState<HSV>({ h: 28, s: 0.64, v: 0.82, a: 1 });
  const [swatches, setSwatches] = useState(["#d6884a", "#4aa6b0", "#8a8a8a"]);
  return (
    <ColorPicker
      value={c}
      onChange={setC}
      inputs={["hex", "rgb"]}
      swatches={swatches}
      onSwatchAdd={(hex) => setSwatches((s) => (s.includes(hex) ? s : [...s, hex]))}
    />
  );
}

// ─── Swatch ────────────────────────────────────────────────────
const SWATCH_COLORS = ["#d6884a", "#4aa6b0", "#8a4ad6", "#5bbf6a"];
function SwatchDemo() {
  const [sel, setSel] = useState("#4aa6b0");
  return (
    <Pad>
      <div style={{ display: "flex", gap: 6 }}>
        {SWATCH_COLORS.map((hex) => (
          <Swatch
            key={hex}
            color={hex}
            size={26}
            selected={sel === hex}
            aria-label={hex}
            onClick={() => setSel(hex)}
          />
        ))}
        <Swatch empty color="#000000" size={26} aria-label="No color" onClick={() => setSel("")} />
      </div>
      <span style={{ fontSize: 12, opacity: 0.7 }}>Selected {sel || "none"}</span>
    </Pad>
  );
}

// ─── SwatchGrid ────────────────────────────────────────────────
const PALETTE = [
  "#e54d42", "#e58a42", "#e5cf42", "#8ae542", "#42e58a", "#42cfe5",
  "#428ae5", "#4242e5", "#8a42e5", "#e542cf", "#e5428a", "#8a8a8a",
];
function SwatchGridDemo() {
  const [sel, setSel] = useState("#42cfe5");
  return (
    <div style={{ padding: 8 }}>
      <SwatchGrid
        swatches={PALETTE}
        columns={6}
        selectedId={sel}
        onSelect={(id) => setSel(id)}
        onAdd={() => console.log("add swatch")}
      />
    </div>
  );
}

// ─── GlyphGrid ─────────────────────────────────────────────────
const GLYPHS = [
  { char: "→", name: "arrow-right" },
  { char: "←", name: "arrow-left" },
  { char: "★", name: "star" },
  { char: "☆", name: "star-outline" },
  { char: "✓", name: "check" },
  { char: "✕", name: "cross" },
  { char: "♥", name: "heart" },
  { char: "☀", name: "sun" },
  { char: "☾", name: "moon" },
];
function GlyphGridDemo() {
  const [sel, setSel] = useState("★");
  return (
    <div style={{ padding: 8 }}>
      <GlyphGrid
        glyphs={GLYPHS}
        columns={6}
        selectedChar={sel}
        onSelect={(char) => setSel(char)}
      />
    </div>
  );
}

// ─── HexInput ──────────────────────────────────────────────────
function HexInputDemo() {
  const [hex, setHex] = useState("#3d8fc4");
  return (
    <Pad>
      <HexInput value={hex} onChange={setHex} />
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.7 }}>
        <span
          aria-hidden
          style={{ width: 16, height: 16, borderRadius: 4, background: hex, display: "inline-block" }}
        />
        {hex}
      </span>
    </Pad>
  );
}

// ─── EyedropperReadout (display-only) ──────────────────────────
function EyedropperReadoutDemo() {
  const [fmt, setFmt] = useState<"hex" | "rgb" | "hsv">("hex");
  return (
    <Pad>
      <EyedropperReadout
        value="#3d8fc4"
        format={fmt}
        subtitle="sRGB"
        onPick={() => console.log("pick from screen")}
      />
      <div style={{ display: "flex", gap: 4 }}>
        {(["hex", "rgb", "hsv"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFmt(f)}
            style={{ fontSize: 11, padding: "2px 6px", opacity: fmt === f ? 1 : 0.6 }}
          >
            {f}
          </button>
        ))}
      </div>
    </Pad>
  );
}

export const colorEntries: GalleryEntry[] = [
  { id: "color/ColorField", label: "ColorField", category: "Color", section: "Creative", render: () => <ColorFieldDemo />, flush: true },
  { id: "color/HueSlider", label: "HueSlider", category: "Color", section: "Creative", render: () => <HueSliderDemo /> },
  { id: "color/AlphaSlider", label: "AlphaSlider", category: "Color", section: "Creative", render: () => <AlphaSliderDemo /> },
  { id: "color/ColorWheel", label: "ColorWheel", category: "Color", section: "Creative", render: () => <ColorWheelDemo />, flush: true },
  { id: "color/GradientEditor", label: "GradientEditor", category: "Color", section: "Creative", render: () => <GradientEditorDemo />, flush: true },
  { id: "color/ColorPicker", label: "ColorPicker", category: "Color", section: "Creative", render: () => <ColorPickerDemo />, flush: true },
  { id: "color/Swatch", label: "Swatch", category: "Color", section: "Creative", render: () => <SwatchDemo /> },
  { id: "color/SwatchGrid", label: "SwatchGrid", category: "Color", section: "Creative", render: () => <SwatchGridDemo />, flush: true },
  { id: "color/GlyphGrid", label: "GlyphGrid", category: "Color", section: "Creative", render: () => <GlyphGridDemo />, flush: true },
  { id: "color/HexInput", label: "HexInput", category: "Color", section: "Creative", render: () => <HexInputDemo /> },
  { id: "color/EyedropperReadout", label: "EyedropperReadout", category: "Color", section: "Creative", render: () => <EyedropperReadoutDemo /> },
];
