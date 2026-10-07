# @monet-ui/monet-timeline

A **framework-free, unit-agnostic non-linear timeline engine** shared across the
Monet NLE apps (Cinema — video, Rythme — audio). No React, no DOM — it runs in
the browser, in workers, and in node.

It owns the parts every multitrack editor re-implements identically:

- **Model** — `TimelineClip` (the timing backbone: `start` / `duration` /
  `inPoint` / `speed` / `enabled`), `TimelineTrack<C>`, `TimelineSequence<C>`,
  and a shared monotonic id generator (`newId` / `resetIds`). Generic over the
  app's clip type `C extends TimelineClip`, so each app keeps its own payload
  (video transform/color/effects, audio gain/fades) and the engine preserves it.
- **Ops** — pure editing operations: `splitTrackAt`, `overwriteClip`,
  `insertClip` (ripple), `liftClips`, `rippleDeleteClips`, `closeGapAt`,
  `moveClipToTrack`, `trimClipStart` / `trimClipEnd`, `slipClip`, `slideClip`,
  `rollEdit`, `setClipSpeed`, `cloneClip`, `wouldOverlap`. They mutate the
  passed-in track/sequence and preserve the app payload via `structuredClone`.
- **Query** — `clipAt`, `clipCovers`, `findClip`, `overlapping`, `isRangeFree`,
  `clipsByStart`, `contentEnd`, `nextEdge`, `prevEdge`, `snapTime`.
- **Store** — `TimelineStore<P, S>`, an observable (useSyncExternalStore-ready)
  store with clone-on-write undo/redo, selection, transport (playhead / in-out /
  play), tool, and zoom/scroll. Subclass it and override `snapshot()` to add
  domain UI; bind it to React with your own `useSyncExternalStore` hook.
- **Time** — frame ⇄ timecode ⇄ seconds math (`framesToTimecode`,
  `timecodeToFrames`, `formatClock`, `sourceFrameAt`, `clamp`).

## Unit-agnostic

Time values are plain numbers. **Cinema** uses frames; **Rythme** uses seconds.
The ops/queries don't care — they operate on the numeric backbone.

## Usage

```ts
import {
  type TimelineClip, splitTrackAt, clipAt, snapTime, TimelineStore,
} from "@monet-ui/monet-timeline";

// App clip = engine backbone + your payload.
interface VideoClip extends TimelineClip {
  mediaId: string;
  transform: { /* … */ };
}
// Generic ops just work and preserve the payload:
splitTrackAt(track, 120);
```

Consumed via the monorepo workspace (`workspace:*`); built with `tsup` to
`dist/` on `prepare`. Cinema's `src/timeline/*` are thin adapters that re-export
these generics and layer on domain behavior (transitions, track-kind rules).
