# Creative timeline / motion

Mocked-but-sharable timeline tooling in the spirit of pro motion apps (After Effects / Premiere / Figma "Smart Animate"): a media transport, a scrubbable tick ruler, a draggable playhead, keyframe lanes, and the composite timeline. Behaviour (scrub/drag → seconds, frame-stepped keyboard, ARIA) lives in the components; visuals come from the Monet stylesheet.

> **Stylesheet:** import the Monet stylesheet once at your app root: `import "@monet-ui/monet-core/index.css";`. Without it these surfaces render unstyled.
>
> **Source:** `packages/monet-react/src/creative-timeline.tsx` (+ the pure timecode math in `packages/monet-react/src/creative-time.ts`).
>
> **Shared geometry:** one `pixelsPerSecond` + `offset` + `fps` set is threaded through every time-based component so the ruler, playhead and lanes stay pixel-aligned:
> `x(seconds) = offset + seconds · pixelsPerSecond` and `seconds(x) = clamp((x − left − offset) / pixelsPerSecond, 0, duration)`.
>
> **Controlled/uncontrolled:** components own state via the standard Monet convention — controlled when the value prop (`value` / `time` / `playing` / `keyframes` / …) is supplied, otherwise uncontrolled from `default*`. Every interaction emits an `onChange`-family callback.

---

## Timecode helpers

Pure, framework-free functions re-exported from `creative-timeline.tsx` (defined in the node-testable `creative-time.ts`). All anchor on a non-negative number of `seconds`.

| Export | Signature | Description |
| --- | --- | --- |
| `formatTimecode` | `(seconds: number, opts?: TimecodeOpts) => string` | Render seconds as `HH:MM:SS:FF` (`"smpte"`) or `HH:MM:SS.mmm` (`"ms"`). Negative input clamps to zero; smpte frames quantize at `fps`, carrying a round-up that lands on `fps` into the next second. |
| `parseTimecode` | `(input: string, opts?: TimecodeOpts) => number` | Parse a timecode string back to seconds. Lenient about omitted leading fields (`"SS:FF"`, `"MM:SS:FF"`, `"SS.mmm"` all parse); the last `:`-group is frames in smpte mode. Returns `NaN` on unparseable input so callers can keep the previous value. |
| `frameDuration` | `(fps?: number) => number` | Seconds per frame (`1 / fps`, default `fps` 24) — the Arrow-key step for the time components. |
| `snapToFrame` | `(seconds: number, fps?: number) => number` | Snap seconds to the nearest whole frame at `fps`. |

```ts
import { formatTimecode, parseTimecode, type TimecodeOpts } from "@monet-ui/monet-react";

formatTimecode(61.5);                         // "00:01:01:12"
formatTimecode(61.5, { format: "ms" });       // "00:01:01.500"
parseTimecode("00:00:02:12", { fps: 24 });    // 2.5
```

**`TimecodeOpts`**

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `fps` | `number` | `24` | Frames per second for the smpte frame field (floored to a positive integer). |
| `format` | `TimecodeFormat` (`"smpte" \| "ms"`) | `"smpte"` | Output / expected shape. |

---

## TimeDisplay

A monospace timecode readout. Display-only by default; when `onChange` is supplied, clicking enters a draft buffer that parses on blur / Enter (Escape cancels; an unparseable entry is ignored). Forwards its `ref` to the root `<div>`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | **Required.** Time to render, in seconds. |
| `fps` | `number` | `24` | Frames per second for the smpte frame field. |
| `format` | `TimecodeFormat` (`"smpte" \| "ms"`) | `"smpte"` | Output shape. |
| `onChange` | `(seconds: number) => void` | — | When set, the readout becomes click-to-edit; fires the parsed seconds on blur / Enter. |
| `muted` | `boolean` | — | Dim styling for secondary readouts (e.g. a duration). |
| `accent` | `string` | — | Accent color (CSS color or `var(--accent…)`). |
| `aria-label` | `string` | `"Timecode"` / `"Edit timecode …"` | Accessible name for the readout / edit affordance. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { TimeDisplay } from "@monet-ui/monet-react";

<TimeDisplay value={time} fps={24} onChange={setTime} />;
```

When editable, the readout renders a `role="button"` span (Enter/Space begins editing) and swaps to a text `<input>` while editing.

---

## Transport

A media transport toolbar: rewind / play-pause / stop / loop / record icon buttons plus a time + muted duration readout. `role="toolbar"` labelled "Transport"; the play button's accessible name toggles **Play** / **Pause**, and loop & record expose `aria-pressed`. Forwards its `ref`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `playing` | `boolean` | — | Controlled playing state. |
| `defaultPlaying` | `boolean` | `false` | Initial playing state when uncontrolled. |
| `onPlayingChange` | `(playing: boolean) => void` | — | Fires when play/pause toggles. |
| `onStop` | `() => void` | — | Fires when stop is pressed (also forces `playing` → `false`). |
| `loop` | `boolean` | — | Controlled loop toggle. |
| `onLoopChange` | `(loop: boolean) => void` | — | Fires when the loop toggle changes. |
| `record` | `boolean` | — | Controlled record toggle. |
| `onRecordChange` | `(record: boolean) => void` | — | Fires when the record toggle changes. |
| `time` | `number` | — | Current playback time (seconds) shown in the readout. |
| `duration` | `number` | — | Total duration (seconds) shown as a muted readout. |
| `fps` | `number` | `24` | Frames per second for the readouts. |
| `onSkipStart` | `() => void` | — | Fires when the rewind / skip-to-start button is pressed. |
| `onSkipEnd` | `() => void` | — | Fires when a skip-to-end control is pressed (supply one via `children`). |
| `children` | `ReactNode` | — | Extra controls appended after the readouts. |
| `accent` | `string` | — | Accent color. |
| `className` | `string` | — | Extra class on the toolbar. |

```tsx
import { Transport } from "@monet-ui/monet-react";

<Transport
  playing={playing}
  onPlayingChange={setPlaying}
  time={time}
  duration={duration}
  onStop={stop}
/>;
```

---

## TimelineRuler

A scrubbable tick ruler over a duration. The surface maps a pointer to seconds via the shared geometry and emits `onScrub` on drag (`setPointerCapture` + `window` move/up); ticks are placed at `majorEvery` (labelled with a timecode) with one minor tick between when it fits. `role="slider"` spanning `0..duration`. Forwards its `ref`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `duration` | `number` | — | **Required.** Total span in seconds. |
| `pixelsPerSecond` | `number` | `60` | Horizontal scale. |
| `fps` | `number` | `24` | Frames per second for the tick labels. |
| `offset` | `number` | `0` | Left inset in pixels (e.g. a track-head width). |
| `majorEvery` | `number` | auto | Major-tick spacing in seconds. Auto-chosen from the scale (so labels never crowd) when omitted. |
| `onScrub` | `(seconds: number) => void` | — | Fires the scrubbed seconds during a drag. |
| `onScrubEnd` | `(seconds: number) => void` | — | Fires once when a scrub ends. |
| `accent` | `string` | — | Accent color. |
| `className` | `string` | — | Extra class on the ruler. |
| `children` | `ReactNode` | — | Overlaid children (e.g. a `<Playhead>`), positioned over the tick surface. |

```tsx
import { TimelineRuler, Playhead } from "@monet-ui/monet-react";

<TimelineRuler duration={120} pixelsPerSecond={20} onScrub={setTime}>
  <Playhead value={time} duration={120} pixelsPerSecond={20} onChange={setTime} />
</TimelineRuler>;
```

---

## Playhead

A draggable seconds head on a track. Dragging the head maps `clientX` → seconds via the shared geometry (`setPointerCapture`); **Arrow** steps one frame (`±1/fps`), **Shift+Arrow** steps `±1s`, **Home/End** jump to the bounds. `role="slider"` with an `aria-valuetext` timecode; positioned at `left = offset + value·pps`. Forwards its `ref`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | — | Controlled position in seconds. |
| `defaultValue` | `number` | `0` | Initial position when uncontrolled. |
| `onChange` | `(seconds: number) => void` | — | Fires the next position on each drag tick / key nudge. |
| `onChangeEnd` | `(seconds: number) => void` | — | Fires once when a drag / key nudge ends. |
| `duration` | `number` | — | **Required.** Span the position is clamped to. |
| `pixelsPerSecond` | `number` | `60` | Horizontal scale. |
| `offset` | `number` | `0` | Left inset in pixels (the shared geometry offset). |
| `fps` | `number` | `24` | Frames per second for the step + valuetext. |
| `full` | `boolean` | `true` | Draw a full-height line (timeline playhead) vs a compact head. |
| `disabled` | `boolean` | — | Inert + non-focusable. |
| `accent` | `string` | — | Accent color. |
| `aria-label` | `string` | `"Playhead"` | Accessible name. |
| `className` | `string` | — | Extra class on the root. |

---

## KeyframeTrack

A lane of draggable keyframe diamonds over the shared timeline geometry. Drag a diamond to retime it (snapping to whole frames when `snap`); double-click the lane adds one; **Delete/Backspace** removes the selected diamond. Built on the chrome `.monet-track` (head + body). Each diamond is `role="slider"` labelled by its timecode. Emits immutable keyframe arrays. Forwards its `ref`.

**`Keyframe`**

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | — | Stable identity. |
| `time` | `number` | — | Position in seconds. |
| `value` | `number` | — | Optional host-defined value carried by the keyframe. |
| `ease` | `KeyframeEase` (`"linear" \| "bezier" \| "hold"`) | `"linear"` | Interpolation kind → diamond style. |
| `selected` | `boolean` | — | Selected highlight (overrides internal selection). |

**`KeyframeTrackProps`**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `keyframes` | `Keyframe[]` | — | Controlled keyframes. |
| `defaultKeyframes` | `Keyframe[]` | `[]` | Initial keyframes when uncontrolled. |
| `onChange` | `(keyframes: Keyframe[]) => void` | — | Fires the next (immutable) array on a move / add / delete. |
| `onChangeEnd` | `(keyframes: Keyframe[]) => void` | — | Fires once when an interaction ends. |
| `duration` | `number` | — | **Required.** Span the diamonds are clamped to. |
| `pixelsPerSecond` | `number` | `60` | Horizontal scale. |
| `offset` | `number` | `0` | Left inset in pixels (the shared geometry offset). |
| `fps` | `number` | `24` | Frames per second for snapping + labels. |
| `snap` | `boolean` | `true` | Snap dragged / added keyframes to whole frames. |
| `label` | `ReactNode` | — | Leading label rendered in the lane head. |
| `addOnDblClick` | `boolean` | `true` | Double-clicking the lane adds a keyframe at that time. |
| `onSelectKeyframe` | `(id: string \| null) => void` | — | Fires the selected keyframe id (or `null` when cleared). |
| `accent` | `string` | — | Accent color. |
| `className` | `string` | — | Extra class on the root track. |

```tsx
import { KeyframeTrack, type Keyframe } from "@monet-ui/monet-react";

<KeyframeTrack
  label="Opacity"
  duration={120}
  pixelsPerSecond={20}
  keyframes={kfs}
  onChange={setKfs}
/>;
```

---

## Timeline

The composite timeline: a top `TimelineRuler` (inset by `headWidth`) hosting a `Playhead`, over a scroll region of track rows. Clip lanes render `.monet-clip` bars; keyframe lanes render a `<KeyframeTrack>`. Owns the playhead time via the controllable-state convention and shares one `pixelsPerSecond` / `headWidth` / `fps` with every child so the ruler, playhead and lanes stay pixel-aligned. Forwards its `ref`.

**`TimelineClip`**

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | index | Stable identity (falls back to a lane-index key). |
| `x` | `number` | — | Start in seconds. |
| `w` | `number` | — | Width in seconds. |
| `label` | `ReactNode` | — | Clip label. |

**`TimelineTrack`**

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | — | Stable identity. |
| `name` | `string` | — | Track-head name. |
| `color` | `string` | — | Per-track accent override (CSS color or `var`). |
| `kind` | `"clips" \| "keyframes"` | `"clips"` | Lane content. |
| `clips` | `TimelineClip[]` | — | Clips for a clip lane (x/w in seconds). |
| `keyframes` | `Keyframe[]` | — | Keyframes for a keyframe lane. |
| `muted` / `solo` / `locked` | `boolean` | — | Status flags shown as `M` / `S` / `L` dots in the head. |

**`TimelineProps`**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `tracks` | `TimelineTrack[]` | — | **Required.** The lanes to render, top to bottom. |
| `duration` | `number` | — | **Required.** Total span in seconds. |
| `time` | `number` | — | Controlled playhead time. |
| `defaultTime` | `number` | `0` | Initial playhead time when uncontrolled. |
| `onTimeChange` | `(seconds: number) => void` | — | Fires the next playhead time (scrub or drag). |
| `onTimeChangeEnd` | `(seconds: number) => void` | — | Fires once when a scrub / drag ends. |
| `pixelsPerSecond` | `number` | `15` | Horizontal scale shared down to the ruler, playhead and lanes. |
| `headWidth` | `number` | `160` | Track-head column width in pixels (the shared geometry offset). |
| `fps` | `number` | `24` | Frames per second shared down. |
| `onTracksChange` | `(tracks: TimelineTrack[]) => void` | — | Fires the next tracks array when a keyframe lane mutates. |
| `toolbar` | `ReactNode` | — | Toolbar rendered above the ruler (e.g. a `<Transport>`). |
| `accent` | `string` | — | Accent color shared down. |
| `className` | `string` | — | Extra class on the root. |

```tsx
import { Timeline, Transport, type TimelineTrack } from "@monet-ui/monet-react";

const tracks: TimelineTrack[] = [
  { id: "video", name: "Video", kind: "clips", clips: [{ x: 0, w: 4, label: "Intro" }] },
  { id: "opacity", name: "Opacity", kind: "keyframes", keyframes: [{ id: "k1", time: 0 }] },
];

<Timeline
  tracks={tracks}
  duration={120}
  time={time}
  onTimeChange={setTime}
  onTracksChange={setTracks}
  toolbar={<Transport time={time} duration={120} playing={playing} onPlayingChange={setPlaying} />}
/>;
```
