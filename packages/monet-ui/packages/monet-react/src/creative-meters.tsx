// ─────────────────────────────────────────────────────────────
// Monet — creative meters / data-viz widgets ("monet-cv-" meter family)
// ─────────────────────────────────────────────────────────────
// Mocked-but-sharable measurement / analysis widgets in the spirit of pro
// creative apps (Photoshop's Histogram panel, a DAW channel strip + level
// meters, a spectrum analyzer). The host data is mocked — these take a value (or
// an array of bin magnitudes) and render the inset-dark plot; the interactive
// strip composes the existing Slider (fader) + the LevelMeter from THIS module.
// Visuals come from @monet-ui/monet-core/creative.css (the "monet-cv-" rules).
//
// Pure-display widgets (Histogram / LevelMeter / Spectrum) carry role="img" or
// role="meter" with an aria-label summary and aria-hidden internals; the
// interactive ChannelStrip is a role="group" wrapping a vertical <Slider> fader,
// an embedded <LevelMeter>, and M/S/R aria-pressed buttons. Every interactive
// value flows through an onChange-family callback (controlled when supplied,
// else uncontrolled default*) per the shared Monet convention.
//
// Components:
//   <Histogram>     inset bar plot (mono or R/G/B series) + optional stat rows
//   <LevelMeter>    inset track + gradient fill + dB grid + optional peak marker
//   <ChannelStrip>  mixer strip: fader + embedded meter + M/S/R + name/inserts
//   <Spectrum>      SVG area chart frequency analyzer with gradient fill

import React, {
  forwardRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Slider } from "./primitives-graphics";
import { useControllableState, cx, clamp, roundTo } from "./internal";

// ─── shared helpers ────────────────────────────────────────────

/** Default green→amber→red gradient shared by the level meters. */
const DEFAULT_RAMP =
  "linear-gradient(to top, #34c759 0%, #34c759 55%, #ffcc00 78%, #ff9500 90%, #ff3b30 100%)";

/** Map a 0..1 magnitude through a linear or log perceptual scale. The log scale
 *  expands the quiet end the way an audio/photo meter does (matches the
 *  `scale` prop on the Histogram). */
function scaleMag(v: number, scale: "linear" | "log"): number {
  const c = clamp(v, 0, 1);
  if (scale === "log") {
    // log1p over the unit range, normalised so 0→0 and 1→1.
    return Math.log1p(c * 9) / Math.log(10);
  }
  return c;
}

// ─── Histogram ─────────────────────────────────────────────────

export interface HistogramSeries {
  /** Bar heights 0..1, one per bin. */
  data: number[];
  /** Series color (CSS color, drawn as a translucent overlay). */
  color: string;
}

export interface HistogramStat {
  label: ReactNode;
  value: ReactNode;
}

export interface HistogramProps {
  /** Bar heights 0..1, one per bin (the mono / luminance channel). */
  data: number[];
  /** Accent for the mono fill. Defaults to var(--accent). */
  accent?: string;
  /** Per-channel overlays (e.g. R/G/B). When set, each is drawn on top of the
   *  base `data` plot using its own color. */
  series?: HistogramSeries[];
  /** Plot height in pixels. Defaults to 120. */
  height?: number;
  /** Magnitude scaling for the bar heights. Defaults to "linear". */
  scale?: "linear" | "log";
  /** Optional stat rows rendered under the plot (reuse .monet-row label/value). */
  stats?: HistogramStat[];
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

/** Render one channel of bars as flex columns. Decorative — aria-hidden on the
 *  parent; widths share the track equally so any bin count fits. */
function HistoBars({
  data,
  scale,
  color,
  overlay,
}: {
  data: number[];
  scale: "linear" | "log";
  color?: string;
  overlay?: boolean;
}) {
  return (
    <div
      className={cx("monet-cv-histogram-series", overlay && "is-overlay")}
      style={color ? ({ "--series": color } as CSSProperties) : undefined}
    >
      {data.map((v, i) => (
        <span
          key={i}
          className="monet-cv-histogram-bar"
          style={{ height: `${roundTo(scaleMag(v, scale) * 100, 2)}%` }}
        />
      ))}
    </div>
  );
}

/** An inset-dark histogram plot: a base channel of bars (mono / luminance) with
 *  optional translucent R/G/B overlays, and an optional row of stat readouts
 *  underneath. Pure display — role="img" with an aria-label summary; the bars
 *  are aria-hidden. */
export const Histogram = forwardRef<HTMLDivElement, HistogramProps>(
  function Histogram(
    { data, accent, series, height = 120, scale = "linear", stats, className, style, ...aria },
    forwardedRef,
  ) {
    const label =
      aria["aria-label"] ??
      `Histogram, ${data.length} bins${series?.length ? `, ${series.length} channels` : ""}`;
    return (
      <div
        ref={forwardedRef}
        role="img"
        aria-label={label}
        className={cx("monet-cv-histogram", className)}
        style={{ "--accent": accent, ...style } as CSSProperties}
      >
        <div
          className="monet-cv-histogram-plot"
          style={{ height: `${height}px` }}
          aria-hidden="true"
        >
          <HistoBars data={data} scale={scale} />
          {series?.map((s, i) => (
            <HistoBars key={i} data={s.data} scale={scale} color={s.color} overlay />
          ))}
        </div>
        {stats != null && stats.length > 0 && (
          <div className="monet-cv-histogram-stats" aria-hidden="true">
            {stats.map((s, i) => (
              <div key={i} className="monet-row monet-cv-histogram-stat">
                <span className="lbl">{s.label}</span>
                <span className="val">{s.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
);

// ─── LevelMeter ────────────────────────────────────────────────

export interface LevelMeterProps {
  /** Level 0..1 (0 = floor, 1 = peak). Ignored when `channels` is set. */
  value: number;
  /** Optional peak-hold marker 0..1. */
  peak?: number;
  /** When set, renders one adjacent bar per channel (overrides `value`). */
  channels?: number[];
  orientation?: "vertical" | "horizontal";
  /** dB tick lines drawn across the track (negative, below 0 dBFS). */
  gridDb?: number[];
  /** CSS gradient for the fill. Defaults to a green→amber→red ramp. */
  ramp?: string;
  /** Leading label (e.g. a channel name). */
  label?: ReactNode;
  /** dB span the track represents, from 0 down to −rangeDb. Defaults to 30. */
  rangeDb?: number;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

/** A single fill+peak bar for the meter. The fill is a slice of the shared
 *  gradient so the color stays anchored to the full-scale ramp regardless of the
 *  current level (the slice is revealed by sizing along the fill axis). */
function MeterBar({
  value,
  peak,
  ramp,
  vertical,
}: {
  value: number;
  peak?: number;
  ramp: string;
  vertical: boolean;
}) {
  const pct = roundTo(clamp(value, 0, 1) * 100, 2);
  const fillStyle = vertical ? { height: `${pct}%` } : { width: `${pct}%` };
  const peakPct = peak != null ? roundTo(clamp(peak, 0, 1) * 100, 2) : null;
  const peakStyle =
    peakPct == null
      ? undefined
      : ((vertical ? { bottom: `${peakPct}%` } : { left: `${peakPct}%` }) as CSSProperties);
  return (
    <div className="monet-cv-meter-bar" aria-hidden="true">
      <div className="monet-cv-meter-fill" style={{ "--ramp": ramp, ...fillStyle } as CSSProperties} />
      {peakStyle && <div className="monet-cv-meter-peak" style={peakStyle} />}
    </div>
  );
}

/** A signal level meter: an inset track with a gradient fill, a dB tick grid,
 *  and an optional peak-hold marker. Renders one bar (`value`) or a stereo /
 *  multi-channel cluster (`channels`). role="meter" with aria-valuenow/min/max
 *  reflecting the (first) level; the bars + grid are aria-hidden. */
export const LevelMeter = forwardRef<HTMLDivElement, LevelMeterProps>(
  function LevelMeter(
    {
      value,
      peak,
      channels,
      orientation = "vertical",
      gridDb = [-3, -6, -12, -18, -24],
      ramp = DEFAULT_RAMP,
      label,
      rangeDb = 30,
      className,
      style,
      ...aria
    },
    forwardedRef,
  ) {
    const vertical = orientation === "vertical";
    const bars = channels && channels.length > 0 ? channels : [value];
    const now = roundTo(clamp(bars[0], 0, 1), 4);
    const fmtRamp = vertical ? ramp : ramp.replace("to top", "to right");

    // map each dB grid line to a 0..1 fraction up the track (0 dBFS = full).
    const gridLines = gridDb
      .filter((db) => db < 0 && db > -rangeDb)
      .map((db) => ({ db, frac: roundTo(1 - db / -rangeDb, 4) }));

    return (
      <div
        ref={forwardedRef}
        role="meter"
        aria-label={aria["aria-label"] ?? "Level"}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={now}
        aria-valuetext={`${Math.round(now * 100)}%`}
        className={cx(
          "monet-cv-meter",
          vertical ? "is-vertical" : "is-horizontal",
          className,
        )}
        style={style}
      >
        <div className="monet-cv-meter-track" aria-hidden="true">
          <div className="monet-cv-meter-grid" aria-hidden="true">
            {gridLines.map(({ db, frac }) => (
              <span
                key={db}
                className="monet-cv-meter-gridline"
                style={(vertical ? { bottom: `${frac * 100}%` } : { left: `${frac * 100}%` }) as CSSProperties}
              />
            ))}
          </div>
          <div className="monet-cv-meter-bars">
            {bars.map((b, i) => (
              <MeterBar
                key={i}
                value={b}
                peak={bars.length === 1 ? peak : undefined}
                ramp={fmtRamp}
                vertical={vertical}
              />
            ))}
          </div>
        </div>
        {label != null && <span className="monet-cv-meter-label">{label}</span>}
      </div>
    );
  },
);

// ─── ChannelStrip ──────────────────────────────────────────────

export interface ChannelStripProps {
  /** Channel name (also the group's accessible label). */
  name: ReactNode;
  /** Strip accent (the fader / meter / name tint). */
  color?: string;
  /** Controlled fader 0..1. Omit (with `defaultVolume`) for uncontrolled use. */
  volume?: number;
  defaultVolume?: number;
  onVolumeChange?: (v: number) => void;
  /** Controlled mute. */
  mute?: boolean;
  onMuteChange?: (b: boolean) => void;
  /** Controlled solo. */
  solo?: boolean;
  onSoloChange?: (b: boolean) => void;
  /** Controlled record-arm. */
  record?: boolean;
  onRecordChange?: (b: boolean) => void;
  /** Insert / send slot content rendered above the fader. */
  inserts?: ReactNode;
  /** Style this strip as the master bus. */
  master?: boolean;
  /** Live level 0..1 fed to the embedded LevelMeter. */
  meter?: number;
  /** dB readout shown under the fader (e.g. "−6.0 dB"). */
  dbLabel?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** A small aria-pressed toggle button (the M / S / R cluster). Each variant
 *  tints via a CSS class so mute reads red, solo amber, record red-armed. */
function StripToggle({
  label,
  pressed,
  variant,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  variant: "mute" | "solo" | "rec";
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={cx("monet-cv-channelstrip-toggle", `is-${variant}`, pressed && "is-active")}
      onClick={onToggle}
    >
      {label.charAt(0)}
    </button>
  );
}

/** A mixer channel strip: a vertical <Slider> fader (composed from the chrome
 *  Slider) sitting beside an embedded <LevelMeter> (from THIS module), an M/S/R
 *  toggle cluster (aria-pressed), the channel name, and an inserts slot. root
 *  role="group" labelled by `name`. Fader + each toggle are controlled when
 *  their value/handler is supplied, else uncontrolled. */
export const ChannelStrip = forwardRef<HTMLDivElement, ChannelStripProps>(
  function ChannelStrip(
    {
      name,
      color,
      volume,
      defaultVolume = 0.75,
      onVolumeChange,
      mute,
      onMuteChange,
      solo,
      onSoloChange,
      record,
      onRecordChange,
      inserts,
      master,
      meter = 0,
      dbLabel,
      className,
      style,
    },
    forwardedRef,
  ) {
    const [vol, setVol] = useControllableState<number>(volume, defaultVolume, onVolumeChange);
    const [isMute, setMute] = useControllableState<boolean>(mute, false, onMuteChange);
    const [isSolo, setSolo] = useControllableState<boolean>(solo, false, onSoloChange);
    const [isRec, setRec] = useControllableState<boolean>(record, false, onRecordChange);

    return (
      <div
        ref={forwardedRef}
        role="group"
        aria-label={typeof name === "string" ? name : undefined}
        className={cx("monet-cv-channelstrip", master && "is-master", isMute && "is-muted", className)}
        style={{ "--accent": color, ...style } as CSSProperties}
      >
        {inserts != null && <div className="monet-cv-channelstrip-inserts">{inserts}</div>}
        <div className="monet-cv-channelstrip-toggles">
          <StripToggle label="Mute" pressed={isMute} variant="mute" onToggle={() => setMute(!isMute)} />
          <StripToggle label="Solo" pressed={isSolo} variant="solo" onToggle={() => setSolo(!isSolo)} />
          <StripToggle label="Record" pressed={isRec} variant="rec" onToggle={() => setRec(!isRec)} />
        </div>
        <div className="monet-cv-channelstrip-body">
          <Slider
            vertical
            accent={color}
            value={vol}
            onChange={setVol}
            aria-label={`${typeof name === "string" ? name : "Channel"} volume`}
            className="monet-cv-channelstrip-fader"
          />
          <LevelMeter
            value={meter}
            aria-label={`${typeof name === "string" ? name : "Channel"} level`}
            className="monet-cv-channelstrip-meter"
          />
        </div>
        {dbLabel != null && <span className="monet-cv-channelstrip-db">{dbLabel}</span>}
        <span className="monet-cv-channelstrip-name">{name}</span>
      </div>
    );
  },
);

// ─── Spectrum ──────────────────────────────────────────────────

export interface SpectrumProps {
  /** Frequency-bin magnitudes 0..1, low → high. */
  data: number[];
  /** Accent for the area stroke. Defaults to var(--accent). */
  accent?: string;
  /** CSS gradient for the area fill (defaults to an accent-tinted fade). */
  gradient?: string;
  /** Labels placed along the frequency axis (e.g. ["20", "1k", "20k"]). */
  freqLabels?: string[];
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

/** Build the area path (a closed polygon under the magnitude curve) plus the
 *  stroke path (just the top curve) over a 0..100 × 0..100 viewBox. */
function spectrumPaths(data: number[]): { area: string; line: string } {
  const n = data.length;
  if (n === 0) return { area: "", line: "" };
  const x = (i: number) => (n === 1 ? 0 : roundTo((i / (n - 1)) * 100, 3));
  const y = (v: number) => roundTo((1 - clamp(v, 0, 1)) * 100, 3);
  const pts = data.map((v, i) => `${x(i)} ${y(v)}`);
  const line = `M${pts.join(" L")}`;
  const area = `M0 100 L${pts.join(" L")} L100 100 Z`;
  return { area, line };
}

/** A frequency analyzer: an SVG area chart of bin magnitudes with a gradient
 *  fill and a stroked top curve, plus optional frequency-axis labels. Pure
 *  display — role="img" with an aria-label summary. */
export const Spectrum = forwardRef<HTMLDivElement, SpectrumProps>(
  function Spectrum({ data, accent, gradient, freqLabels, className, style, ...aria }, forwardedRef) {
    const { area, line } = spectrumPaths(data);
    const fill =
      gradient ??
      "linear-gradient(to bottom, color-mix(in oklch, var(--accent) 55%, transparent), color-mix(in oklch, var(--accent) 6%, transparent))";
    return (
      <div
        ref={forwardedRef}
        role="img"
        aria-label={aria["aria-label"] ?? `Frequency spectrum, ${data.length} bins`}
        className={cx("monet-cv-spectrum", className)}
        style={{ "--accent": accent, ...style } as CSSProperties}
      >
        <div className="monet-cv-spectrum-plot" aria-hidden="true">
          <svg
            className="monet-cv-spectrum-svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <path className="monet-cv-spectrum-area" d={area} style={{ "--fill": fill } as CSSProperties} />
            <path className="monet-cv-spectrum-line" d={line} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        {freqLabels != null && freqLabels.length > 0 && (
          <div className="monet-cv-spectrum-axis" aria-hidden="true">
            {freqLabels.map((f, i) => (
              <span key={i} className="monet-cv-spectrum-freq">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  },
);
