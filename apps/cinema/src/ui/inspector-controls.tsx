// Small shared inspector widgets built on Monet's Slider, used by the
// Effect Controls / Lumetri panels.

import { Slider } from "@monet-ui/monet-react";

const ACCENT = "var(--accent-motion)";

export function SliderRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  const { label, value, min, max, onChange, fmt } = props;
  const norm = max > min ? (value - min) / (max - min) : 0;
  return (
    <div className="monet-row">
      <span className="lbl" style={{ minWidth: 78 }}>{label}</span>
      <Slider value={Math.max(0, Math.min(1, norm))} accent={ACCENT} onChange={(f: number) => onChange(min + f * (max - min))} />
      <span className="val" style={{ fontFamily: "var(--font-mono)", fontSize: 10, minWidth: 38, textAlign: "right" }}>
        {fmt ? fmt(value) : value.toFixed(0)}
      </span>
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="monet-section-label" style={{ marginTop: 12 }}>{children}</div>;
}
