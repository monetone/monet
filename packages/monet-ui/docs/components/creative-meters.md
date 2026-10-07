# Creative meters

Mocked-but-sharable measurement / analysis widgets in the spirit of pro creative apps — a Photoshop-style histogram, DAW level meters and a channel strip, and a spectrum analyzer. The host data is **mocked**: each widget takes a value (or an array of bin magnitudes) and renders the inset-dark plot. The pure-display widgets carry `role="img"` / `role="meter"` with an `aria-label` summary (their internals are `aria-hidden`); the interactive `ChannelStrip` is a `role="group"` composing the chrome `Slider` (vertical fader) and an embedded `LevelMeter`.

> **Stylesheet:** import the Monet stylesheet once at your app root: `import "@monet-ui/monet-core/index.css";`. Without it the widgets render unstyled.
>
> **Source:** `packages/monet-react/src/creative-meters.tsx`.
>
> **Mocked data:** these are reference surfaces — wire `data` / `value` / `meter` to your real analyser, and drive `ChannelStrip`'s `volume` / `mute` / `solo` / `record` through the `onChange`-family callbacks (controlled when supplied, else uncontrolled from the `default*` props).

---

## Histogram

An inset-dark bar plot of luminance / channel data: a base channel of bars with optional translucent R/G/B overlays (blended additively), plus an optional row of stat readouts underneath (reusing `.monet-row` / `.lbl` / `.val`). Pure display — `role="img"` with an `aria-label` summary; the bars are `aria-hidden`. Forwards its `ref` to the root `<div>`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `number[]` | — | **Required.** Bar heights `0..1`, one per bin (the mono / luminance channel). |
| `accent` | `string` | `var(--accent)` | Accent for the base fill. |
| `series` | `HistogramSeries[]` | — | Per-channel overlays (e.g. R/G/B), each drawn on top of `data` in its own color. |
| `height` | `number` | `120` | Plot height in pixels. |
| `scale` | `"linear" \| "log"` | `"linear"` | Magnitude scaling for the bar heights (`"log"` expands the quiet end). |
| `stats` | `HistogramStat[]` | — | Optional stat rows under the plot. |
| `aria-label` | `string` | `"Histogram, N bins[, M channels]"` | Accessible summary. |
| `className` | `string` | — | Extra class on the root. |
| `style` | `CSSProperties` | — | Inline style on the root. |

```tsx
import { Histogram } from "@monet-ui/monet-react";

<Histogram
  data={luma}
  series={[
    { data: red, color: "#ff5b5b" },
    { data: green, color: "#5bff7a" },
    { data: blue, color: "#5b8bff" },
  ]}
  stats={[
    { label: "Mean", value: "128" },
    { label: "Std dev", value: "42" },
  ]}
/>;
```

---

## LevelMeter

A signal level meter: an inset track with a gradient fill, a dB tick grid, and an optional peak-hold marker. Renders one bar (`value`) or a stereo / multi-channel cluster (`channels`). The fill carries the full green→amber→red ramp pinned to the track so its color stays anchored to 0 dBFS. `role="meter"` with `aria-valuenow`/`min`/`max` reflecting the (first) level; the bars + grid are `aria-hidden`. Forwards its `ref` to the root `<div>`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | **Required.** Level `0..1` (`0` = floor, `1` = peak). Ignored when `channels` is set. |
| `peak` | `number` | — | Peak-hold marker `0..1` (single-bar only). |
| `channels` | `number[]` | — | Renders one adjacent bar per channel, **overriding** `value`. |
| `orientation` | `"vertical" \| "horizontal"` | `"vertical"` | Bar axis. |
| `gridDb` | `number[]` | `[-3, -6, -12, -18, -24]` | dB tick lines (negative, below 0 dBFS) drawn across the track. |
| `ramp` | `string` | green→amber→red gradient | CSS gradient for the fill. |
| `label` | `ReactNode` | — | Leading label (e.g. a channel name). |
| `rangeDb` | `number` | `30` | dB span the track represents, from `0` down to `−rangeDb`. |
| `aria-label` | `string` | `"Level"` | Accessible name. |
| `className` | `string` | — | Extra class on the root. |
| `style` | `CSSProperties` | — | Inline style on the root. |

```tsx
import { LevelMeter } from "@monet-ui/monet-react";

<LevelMeter value={0.72} peak={0.88} label="L" />
<LevelMeter channels={[0.6, 0.55]} orientation="horizontal" />;
```

---

## ChannelStrip

A mixer channel strip: a vertical `<Slider>` fader (composed from the chrome `Slider`) beside an embedded `<LevelMeter>` (from this module), an M / S / R toggle cluster (`aria-pressed`; mute = red, solo = amber, record = red-armed), the channel name, and an inserts slot. Root `role="group"` labelled by `name`. The fader and each toggle are controlled when their `value`/handler is supplied, else uncontrolled. Forwards its `ref` to the root `<div>`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `ReactNode` | — | **Required.** Channel name (also the group's accessible label, when a string). |
| `color` | `string` | `var(--accent)` | Strip accent (fader + strip chrome tint). |
| `volume` | `number` | — | Controlled fader `0..1`. Omit (with `defaultVolume`) for uncontrolled use. |
| `defaultVolume` | `number` | `0.75` | Initial fader value when uncontrolled. |
| `onVolumeChange` | `(v: number) => void` | — | Fires with the next fader value. |
| `mute` | `boolean` | — | Controlled mute. |
| `onMuteChange` | `(b: boolean) => void` | — | Fires with the next mute state. |
| `solo` | `boolean` | — | Controlled solo. |
| `onSoloChange` | `(b: boolean) => void` | — | Fires with the next solo state. |
| `record` | `boolean` | — | Controlled record-arm. |
| `onRecordChange` | `(b: boolean) => void` | — | Fires with the next record state. |
| `inserts` | `ReactNode` | — | Insert / send slot content rendered above the fader. |
| `master` | `boolean` | — | Style this strip as the master bus. |
| `meter` | `number` | `0` | Live level `0..1` fed to the embedded `LevelMeter`. |
| `dbLabel` | `ReactNode` | — | dB readout under the fader (e.g. `"−6.0 dB"`). |
| `className` | `string` | — | Extra class on the root. |
| `style` | `CSSProperties` | — | Inline style on the root. |

```tsx
import { ChannelStrip } from "@monet-ui/monet-react";

<ChannelStrip
  name="Drums"
  meter={level}
  dbLabel="−6.0 dB"
  volume={vol}
  onVolumeChange={setVol}
  mute={muted}
  onMuteChange={setMuted}
/>;
```

---

## Spectrum

A frequency analyzer: an SVG area chart of bin magnitudes with a gradient fill and a stroked top curve, plus optional frequency-axis labels. Pure display — `role="img"` with an `aria-label` summary; the plot is `aria-hidden`. Forwards its `ref` to the root `<div>`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `number[]` | — | **Required.** Frequency-bin magnitudes `0..1`, low → high. |
| `accent` | `string` | `var(--accent)` | Accent for the area stroke. |
| `gradient` | `string` | accent-tinted fade | CSS gradient for the area fill. |
| `freqLabels` | `string[]` | — | Labels placed along the frequency axis (e.g. `["20", "1k", "20k"]`). |
| `aria-label` | `string` | `"Frequency spectrum, N bins"` | Accessible summary. |
| `className` | `string` | — | Extra class on the root. |
| `style` | `CSSProperties` | — | Inline style on the root. |

```tsx
import { Spectrum } from "@monet-ui/monet-react";

<Spectrum data={bins} freqLabels={["20", "200", "2k", "20k"]} />;
```

---

## Types

### HistogramSeries

```ts
interface HistogramSeries {
  data: number[]; // bar heights 0..1, one per bin
  color: string;  // CSS color, drawn as a translucent overlay
}
```

### HistogramStat

```ts
interface HistogramStat {
  label: ReactNode;
  value: ReactNode;
}
```

### Exported prop interfaces

Every component also exports its props interface for typing wrappers and refs: `HistogramProps`, `LevelMeterProps`, `ChannelStripProps`, `SpectrumProps` (plus the `HistogramSeries` / `HistogramStat` value types).
