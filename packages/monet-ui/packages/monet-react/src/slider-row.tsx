// SliderRow — the dense "label · Slider · value" row shared by Camera-Raw-style
// develop panels (Vision) and the Galerie develop rail. Composes the shared
// Slider; double-click the row resets via onReset. Column widths are
// parameterized so both a wide modal dialog and a narrow side rail use one
// component. Renders a plain `.monet-row` (chrome flex row) — no extra styling —
// so it drops in wherever the app already lays out rows.

import type { CSSProperties, ReactNode } from "react";

import { cx } from "./internal";
import { Slider } from "./primitives-graphics";

export interface SliderRowProps {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Fires once when a drag ends — the commit point for undo/history. */
  onChangeEnd?: (v: number) => void;
  /** Double-click the row to reset (e.g. a slider to its neutral value). */
  onReset?: () => void;
  /** Slider fill accent. Defaults to the raster accent var. */
  accent?: string;
  /** Readout suffix (e.g. "%", "°"); ignored when `format` is given. */
  suffix?: string;
  /** Readout decimal places; ignored when `format` is given. */
  decimals?: number;
  /** Custom readout renderer; overrides suffix/decimals. */
  format?: (v: number) => string;
  /** Label / value column widths (px). Defaults suit a modal dialog. */
  labelWidth?: number;
  valueWidth?: number;
  className?: string;
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onChangeEnd,
  onReset,
  accent = "var(--accent-raster)",
  suffix = "",
  decimals = 0,
  format,
  labelWidth = 96,
  valueWidth = 52,
  className,
}: SliderRowProps) {
  const valStyle: CSSProperties = {
    width: valueWidth,
    textAlign: "right",
    fontFamily: "var(--font-mono)",
  };
  return (
    <div
      className={cx("monet-row", className)}
      style={{ gap: 10, alignItems: "center", marginBottom: 8 }}
      onDoubleClick={onReset}
    >
      <span className="lbl" style={{ width: labelWidth }}>
        {label}
      </span>
      <Slider
        aria-label={typeof label === "string" ? label : undefined}
        value={value}
        min={min}
        max={max}
        step={step}
        accent={accent}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
        style={{ flex: 1 }}
      />
      <span className="val" style={valStyle}>
        {format ? format(value) : `${value.toFixed(decimals)}${suffix}`}
      </span>
    </div>
  );
}
