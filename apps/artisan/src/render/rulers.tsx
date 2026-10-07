// ─────────────────────────────────────────────────────────────
// render/rulers — top + left measurement rulers
// ─────────────────────────────────────────────────────────────

import type { ViewState } from "../engine";

export const RULER_SIZE = 20;

/** A "nice" tick step (1·2·5·10…) giving ~targetPx spacing at the current zoom. */
export const niceStep = (zoom: number, targetPx = 70): number => {
  const raw = targetPx / zoom;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
};

const fmtLabel = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

interface RulerProps {
  orientation: "h" | "v";
  /** Pixel length of the canvas along this axis. */
  size: number;
  view: ViewState;
  /** Cursor position (world coord on this axis) to mark, or null. */
  cursor?: number | null;
}

export function Ruler({ orientation, size, view, cursor }: RulerProps) {
  const horizontal = orientation === "h";
  const { zoom } = view;
  const t = horizontal ? view.tx : view.ty;
  const step = niceStep(zoom);
  const sub = 5;
  const worldMin = (0 - t) / zoom;
  const worldMax = (size - t) / zoom;

  const ticks: React.ReactNode[] = [];
  const first = Math.ceil(worldMin / step) * step;
  for (let w = first; w <= worldMax; w += step) {
    const s = w * zoom + t;
    // subticks
    for (let k = 1; k < sub; k++) {
      const sw = w + (step / sub) * k;
      const ss = sw * zoom + t;
      if (ss < 0 || ss > size) continue;
      ticks.push(
        horizontal ? (
          <line key={`s${w}-${k}`} x1={ss} y1={RULER_SIZE - 4} x2={ss} y2={RULER_SIZE} stroke="var(--artisan-ruler-fg)" strokeWidth={0.5} opacity={0.5} />
        ) : (
          <line key={`s${w}-${k}`} x1={RULER_SIZE - 4} y1={ss} x2={RULER_SIZE} y2={ss} stroke="var(--artisan-ruler-fg)" strokeWidth={0.5} opacity={0.5} />
        ),
      );
    }
    if (s < -2 || s > size + 2) continue;
    if (horizontal) {
      ticks.push(<line key={`t${w}`} x1={s} y1={RULER_SIZE - 8} x2={s} y2={RULER_SIZE} stroke="var(--artisan-ruler-fg)" strokeWidth={0.75} />);
      ticks.push(
        <text key={`l${w}`} x={s + 2} y={9} fontSize={8} fontFamily="var(--font-mono, monospace)" fill="var(--artisan-ruler-fg)">
          {fmtLabel(w)}
        </text>,
      );
    } else {
      ticks.push(<line key={`t${w}`} x1={RULER_SIZE - 8} y1={s} x2={RULER_SIZE} y2={s} stroke="var(--artisan-ruler-fg)" strokeWidth={0.75} />);
      ticks.push(
        <text key={`l${w}`} x={2} y={s - 2} fontSize={8} fontFamily="var(--font-mono, monospace)" fill="var(--artisan-ruler-fg)" transform={`rotate(-90 6 ${s - 2})`}>
          {fmtLabel(w)}
        </text>,
      );
    }
  }

  const cursorMark =
    cursor != null
      ? (() => {
          const s = cursor * zoom + t;
          return horizontal ? (
            <line x1={s} y1={0} x2={s} y2={RULER_SIZE} stroke="var(--accent-vector,#4a9eff)" strokeWidth={0.75} />
          ) : (
            <line x1={0} y1={s} x2={RULER_SIZE} y2={s} stroke="var(--accent-vector,#4a9eff)" strokeWidth={0.75} />
          );
        })()
      : null;

  return (
    <svg
      className={`artisan-ruler artisan-ruler-${orientation}`}
      width={horizontal ? size : RULER_SIZE}
      height={horizontal ? RULER_SIZE : size}
      style={{ display: "block" }}
    >
      {ticks}
      {cursorMark}
    </svg>
  );
}
