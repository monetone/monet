// A compact numeric field that commits on Enter / blur (Escape reverts).
import { useEffect, useRef, useState } from "react";

const fmt = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

export function NumberField({
  value,
  onCommit,
  disabled,
  min,
  max,
  step = 1,
  pageStep = step * 10,
}: {
  value: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  pageStep?: number;
}) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  // Enter calls commit() then blur(); guard so the resulting blur doesn't commit a
  // SECOND time (which would double-apply relative edits like the Transform X/W).
  const skipBlur = useRef(false);

  const commit = () => {
    let n = parseFloat(text);
    if (Number.isNaN(n)) {
      setText(fmt(value));
      return;
    }
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    onCommit(n);
  };

  const nudge = (delta: number) => {
    const draft = text.trim() === "" ? NaN : Number(text);
    let next = (Number.isFinite(draft) ? draft : value) + delta;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    setText(fmt(next));
    onCommit(next);
  };

  return (
    <input
      className="artisan-num"
      type="text"
      inputMode="decimal"
      role="spinbutton"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (skipBlur.current) {
          skipBlur.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "PageUp" || e.key === "PageDown") {
          e.preventDefault();
          const delta = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : e.key === "PageUp" ? pageStep : -pageStep;
          nudge(delta);
        } else if (e.key === "Home" && min != null) {
          e.preventDefault();
          setText(fmt(min));
          onCommit(min);
        } else if (e.key === "End" && max != null) {
          e.preventDefault();
          setText(fmt(max));
          onCommit(max);
        } else if (e.key === "Enter") {
          commit();
          skipBlur.current = true; // the blur below must not re-commit
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setText(fmt(value));
          skipBlur.current = true; // Escape reverts WITHOUT committing
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
