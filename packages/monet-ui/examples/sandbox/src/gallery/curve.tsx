// Creative curve gallery demos — the SVG bezier curve editors:
//   • CurveEditor  — EQ-style N-point draggable curve (log freq axis + fill)
//   • EasingCurve  — one CSS cubic-bezier with two handles + preset chips
// Both are controlled here (useState) so dragging / keyboard nudges / presets
// drive the readouts live; data is mocked but the interaction is real.
import { useState } from "react";
import {
  CurveEditor,
  EasingCurve,
  type CurvePoint,
  type Bezier,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

// ─── CurveEditor ───────────────────────────────────────────────
// A mocked 3-band EQ: log frequency on X (20 Hz – 20 kHz), gain in dB on Y.
function CurveEditorDemo() {
  const [bands, setBands] = useState<CurvePoint[]>([
    { id: "low", x: 0, y: 0.5, color: "#6aa0ff" },
    { id: "mid", x: 0.5, y: 0.66, color: "#d9a45b" },
    { id: "air", x: 1, y: 0.5, color: "#4aa6b0" },
  ]);
  const top = bands.reduce((a, b) => (b.y > a.y ? b : a), bands[0]);
  return (
    <div style={{ display: "grid", gap: 8, padding: 8 }}>
      <CurveEditor
        points={bands}
        onChange={setBands}
        xRange={[20, 20000]}
        xScale="log"
        yRange={[-12, 12]}
        width={260}
        height={120}
        accent="oklch(0.78 0.14 200)"
      />
      <div style={{ fontSize: 11, opacity: 0.7 }}>
        {bands.length} bands · peak {((top.y - 0.5) * 24).toFixed(1)} dB
      </div>
    </div>
  );
}

// ─── EasingCurve ───────────────────────────────────────────────
// One CSS cubic-bezier with two draggable handles + preset chips.
function EasingCurveDemo() {
  const [ease, setEase] = useState<Bezier>([0.42, 0, 0.58, 1]);
  return (
    <div style={{ display: "grid", gap: 8, padding: 8, justifyItems: "start" }}>
      <EasingCurve
        value={ease}
        onChange={setEase}
        size={150}
        accent="oklch(0.74 0.16 280)"
      />
      <code style={{ fontSize: 11, opacity: 0.7 }}>
        cubic-bezier({ease.map((n) => +n.toFixed(2)).join(", ")})
      </code>
    </div>
  );
}

export const curveEntries: GalleryEntry[] = [
  {
    id: "curve/CurveEditor",
    label: "CurveEditor",
    category: "Curves",
    section: "Creative",
    render: () => <CurveEditorDemo />,
  },
  {
    id: "curve/EasingCurve",
    label: "EasingCurve",
    category: "Curves",
    section: "Creative",
    render: () => <EasingCurveDemo />,
  },
];
