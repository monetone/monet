// ─────────────────────────────────────────────────────────────
// inspector-controls.tsx — small shared inspector widgets in the Monet style,
// used across the inspector / scene / transition panels.
// ─────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { ScrubbyNumber, Select, type SelectOption } from "@monet-ui/monet-react";

export const ACCENT = "var(--accent-game)";

export function Row({ label, children, title }: { label?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <div className="mj-row" style={{ padding: "3px 0", gap: 8 }} title={title}>
      {label !== undefined && <span className="mj-k" style={{ minWidth: 64, flex: "0 0 auto" }}>{label}</span>}
      <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 6, alignItems: "center" }}>{children}</div>
    </div>
  );
}

export function NumberRow(props: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <Row label={props.label}>
      <ScrubbyNumber
        value={props.value}
        onChange={props.onChange}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        suffix={props.suffix}
        accent={ACCENT}
      />
    </Row>
  );
}

/** Two scrubbers on one row (e.g. X / Y, Scale X / Y). */
export function PairRow(props: {
  label: ReactNode;
  a: { value: number; onChange: (v: number) => void; suffix?: string; step?: number };
  b: { value: number; onChange: (v: number) => void; suffix?: string; step?: number };
}) {
  return (
    <Row label={props.label}>
      <ScrubbyNumber value={props.a.value} onChange={props.a.onChange} step={props.a.step ?? 1} suffix={props.a.suffix} accent={ACCENT} />
      <ScrubbyNumber value={props.b.value} onChange={props.b.onChange} step={props.b.step ?? 1} suffix={props.b.suffix} accent={ACCENT} />
    </Row>
  );
}

export function ColorRow({ label, value, onChange }: { label: ReactNode; value: string; onChange: (hex: string) => void }) {
  return (
    <Row label={label}>
      <input className="mj-swatch" type="color" value={normalizeHex(value)} onChange={(e) => onChange(e.target.value)} />
      <span className="mj-muted" style={{ fontFamily: "var(--font-mono, monospace)" }}>{value}</span>
    </Row>
  );
}

export function SelectRow({ label, value, options, onChange }: { label: ReactNode; value: string; options: SelectOption[]; onChange: (v: string) => void }) {
  return (
    <Row label={label}>
      <Select value={value} options={options} onChange={onChange} size="sm" block />
    </Row>
  );
}

function normalizeHex(s: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return "#" + s.slice(1).split("").map((c) => c + c).join("");
  return "#000000";
}
