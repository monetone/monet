// ─────────────────────────────────────────────────────────────
// Monet — creative timeline / motion components ("monet-cv-" timeline family)
// ─────────────────────────────────────────────────────────────
// Mocked-but-sharable timeline tooling in the spirit of pro motion apps (After
// Effects / Premiere / Figma "Smart Animate" editors): a transport, a tick
// ruler, a draggable playhead, keyframe lanes, and the composite timeline.
// Behaviour (scrub/drag → seconds, frame-stepped keyboard, ARIA) lives here;
// visuals come from @monet-ui/monet-core/creative.css (the "monet-cv-" rules).
//
// One pixels-per-second + offset + fps geometry is threaded through every
// time-based component so the ruler, playhead and lanes stay pixel-aligned:
//   x(seconds) = offset + seconds · pixelsPerSecond
//   seconds(x) = clamp((x − left − offset) / pixelsPerSecond, 0, duration)
// The drag handlers copy the Slider core (getBoundingClientRect + window
// pointermove/up + setPointerCapture on handles); the timecode math lives in the
// node-testable ./creative-time sibling, re-exported so this is the one module.
//
// Components: TimeDisplay (timecode readout, optional click-to-edit), Transport
// (play/pause/stop/loop/record toolbar + readouts), TimelineRuler (scrubbable
// tick ruler), Playhead (draggable seconds head), KeyframeTrack (draggable
// keyframe diamonds), Timeline (composite ruler + playhead + clip/keyframe rows).

import React, {
  forwardRef,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { I } from "./icons";
import { IconButton } from "./controls";
import { useControllableState, cx, clamp, roundTo } from "./internal";
import {
  formatTimecode,
  parseTimecode,
  frameDuration,
  snapToFrame,
  type TimecodeFormat,
  type TimecodeOpts,
} from "./creative-time";

// Re-export the timecode math + types so creative-timeline.tsx is the single
// public module (creative-time is a node-testable implementation split,
// mirroring the creative-color-math / creative-color relationship).
export {
  formatTimecode,
  parseTimecode,
  frameDuration,
  snapToFrame,
} from "./creative-time";
export type { TimecodeFormat, TimecodeOpts } from "./creative-time";

// ─── shared helpers ────────────────────────────────────────────

/** Attach a forwarded ref to a local ref object (the Slider-core setRef). */
function useMergedRef<T>(forwardedRef: React.ForwardedRef<T>) {
  const local = useRef<T | null>(null);
  const set = (el: T | null) => {
    local.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef)
      (forwardedRef as React.MutableRefObject<T | null>).current = el;
  };
  return [local, set] as const;
}

/** seconds → x in pixels for the shared timeline geometry. */
function secondsToX(seconds: number, pps: number, offset: number): number {
  return offset + seconds * pps;
}

/** clientX (against a rect's left edge) → seconds, clamped to [0, duration]. */
function xToSeconds(
  clientX: number,
  rectLeft: number,
  pps: number,
  offset: number,
  duration: number,
): number {
  const px = clientX - rectLeft - offset;
  return clamp(px / (pps || 1), 0, duration);
}

// Loop + record glyphs. These prefer the shared `I.loop` / `I.record` once the
// integrator adds them to ./icons (they're returned in `iconsNeeded`); the
// local fallback paths keep <Transport> rendering a real glyph standalone.
const LOOP_GLYPH =
  (I as Record<string, string>).loop ??
  "M5 5L11 5A2.5 2.5 0 0 1 11 10L5 10M5 5L7 3M5 5L7 7";
const RECORD_GLYPH =
  (I as Record<string, string>).record ?? "M8 4A4 4 0 1 1 8 12A4 4 0 0 1 8 4Z";

/** A "nice" major-tick spacing (seconds) for a px/sec scale: the smallest step
 *  giving ≥56px so labels never crowd. */
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
function niceMajorStep(pps: number): number {
  const minPx = 56;
  for (const step of NICE_STEPS) {
    if (step * pps >= minPx) return step;
  }
  return NICE_STEPS[NICE_STEPS.length - 1];
}

// ─── TimeDisplay ───────────────────────────────────────────────

export interface TimeDisplayProps {
  /** Time to render, in seconds. */
  value: number;
  /** Frames per second for the "smpte" frame field. Defaults to 24. */
  fps?: number;
  /** Output shape. Defaults to "smpte". */
  format?: TimecodeFormat;
  /** When set, the readout becomes click-to-edit; fires the parsed seconds on
   *  blur / Enter (a non-numeric entry is ignored). */
  onChange?: (seconds: number) => void;
  /** Dim styling for secondary readouts (e.g. a duration). */
  muted?: boolean;
  accent?: string;
  "aria-label"?: string;
  className?: string;
}

/** A monospace timecode readout. Display-only by default; when `onChange` is
 *  supplied, clicking enters a draft buffer that parses on blur / Enter (Escape
 *  cancels). Renders an <input> while editing, a <span> otherwise. */
export const TimeDisplay = forwardRef<HTMLDivElement, TimeDisplayProps>(
  function TimeDisplay(
    { value, fps = 24, format = "smpte", onChange, muted, accent, className, ...aria },
    forwardedRef,
  ) {
    const editable = onChange !== undefined;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const inputRef = useRef<HTMLInputElement | null>(null);
    const opts: TimecodeOpts = { fps, format };
    const text = formatTimecode(value, opts);

    const beginEdit = () => {
      if (!editable) return;
      setDraft(text);
      setEditing(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    };

    const commit = () => {
      const parsed = parseTimecode(draft, opts);
      setEditing(false);
      if (!Number.isNaN(parsed)) onChange?.(Math.max(0, parsed));
    };

    return (
      <div
        ref={forwardedRef}
        className={cx(
          "monet-cv-timecode",
          muted && "is-muted",
          editable && "is-editable",
          editing && "is-editing",
          className,
        )}
        style={{ "--accent": accent } as CSSProperties}
      >
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            aria-label={aria["aria-label"] ?? "Timecode"}
            className="monet-cv-timecode-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            onBlur={commit}
          />
        ) : (
          <span
            className="monet-cv-timecode-value"
            role={editable ? "button" : undefined}
            tabIndex={editable ? 0 : undefined}
            aria-label={editable ? aria["aria-label"] ?? `Edit timecode ${text}` : aria["aria-label"]}
            onClick={beginEdit}
            onKeyDown={
              editable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      beginEdit();
                    }
                  }
                : undefined
            }
          >
            {text}
          </span>
        )}
      </div>
    );
  },
);

// ─── Transport ─────────────────────────────────────────────────

export interface TransportProps {
  /** Controlled playing state. Omit (with `defaultPlaying`) for uncontrolled. */
  playing?: boolean;
  defaultPlaying?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  /** Fires when the stop button is pressed (also forces playing → false). */
  onStop?: () => void;
  /** Controlled loop toggle. */
  loop?: boolean;
  onLoopChange?: (loop: boolean) => void;
  /** Controlled record toggle. */
  record?: boolean;
  onRecordChange?: (record: boolean) => void;
  /** Current playback time (seconds) shown in the readout. */
  time?: number;
  /** Total duration (seconds) shown as a muted readout. */
  duration?: number;
  fps?: number;
  /** Fires when the skip-to-start (rewind) button is pressed. */
  onSkipStart?: () => void;
  /** Fires when the skip-to-end button is pressed. */
  onSkipEnd?: () => void;
  /** Extra controls appended to the toolbar (after the readouts). */
  children?: ReactNode;
  accent?: string;
  className?: string;
}

/** A media transport toolbar: rewind / play-pause / stop / loop / record icon
 *  buttons plus a time + muted duration readout. role="toolbar"; the play
 *  button's label toggles Play/Pause, loop & record expose aria-pressed. */
export const Transport = forwardRef<HTMLDivElement, TransportProps>(
  function Transport(
    {
      playing,
      defaultPlaying = false,
      onPlayingChange,
      onStop,
      loop,
      onLoopChange,
      record,
      onRecordChange,
      time,
      duration,
      fps = 24,
      onSkipStart,
      onSkipEnd,
      children,
      accent,
      className,
    },
    forwardedRef,
  ) {
    const [isPlaying, setPlaying] = useControllableState<boolean>(
      playing,
      defaultPlaying,
      onPlayingChange,
    );
    const [isLoop, setLoop] = useControllableState<boolean>(loop, false, onLoopChange);
    const [isRec, setRec] = useControllableState<boolean>(record, false, onRecordChange);

    return (
      <div
        ref={forwardedRef}
        role="toolbar"
        aria-label="Transport"
        className={cx("monet-cv-transport", className)}
        style={{ "--accent": accent } as CSSProperties}
      >
        <IconButton
          icon="rewind"
          aria-label="Skip to start"
          size="sm"
          className="monet-cv-transport-btn"
          onClick={() => onSkipStart?.()}
        />
        <IconButton
          icon={isPlaying ? I.pause : I.play}
          aria-label={isPlaying ? "Pause" : "Play"}
          size="sm"
          active={isPlaying}
          className="monet-cv-transport-btn is-play"
          onClick={() => setPlaying(!isPlaying)}
        />
        <IconButton
          icon="stop"
          aria-label="Stop"
          size="sm"
          className="monet-cv-transport-btn"
          onClick={() => {
            if (isPlaying) setPlaying(false);
            onStop?.();
          }}
        />
        <IconButton
          icon={LOOP_GLYPH}
          aria-label="Loop"
          size="sm"
          active={isLoop}
          className="monet-cv-transport-btn is-loop"
          onClick={() => setLoop(!isLoop)}
        />
        <IconButton
          icon={RECORD_GLYPH}
          aria-label="Record"
          size="sm"
          active={isRec}
          className={cx("monet-cv-transport-btn", "is-rec", isRec && "is-armed")}
          onClick={() => setRec(!isRec)}
        />
        {time != null && (
          <TimeDisplay
            value={time}
            fps={fps}
            accent={accent}
            aria-label="Current time"
            className="monet-cv-transport-time"
          />
        )}
        {duration != null && (
          <TimeDisplay
            value={duration}
            fps={fps}
            muted
            aria-label="Duration"
            className="monet-cv-transport-duration"
          />
        )}
        {children}
      </div>
    );
  },
);

// ─── TimelineRuler ─────────────────────────────────────────────

export interface TimelineRulerProps {
  /** Total span in seconds. */
  duration: number;
  /** Horizontal scale. Defaults to 60. */
  pixelsPerSecond?: number;
  fps?: number;
  /** Left inset in pixels (e.g. a track-head width). Defaults to 0. */
  offset?: number;
  /** Major-tick spacing in seconds. Auto-chosen from the scale when omitted. */
  majorEvery?: number;
  /** Fires the scrubbed seconds during a drag on the ruler surface. */
  onScrub?: (seconds: number) => void;
  /** Fires once when a scrub ends. */
  onScrubEnd?: (seconds: number) => void;
  accent?: string;
  className?: string;
  /** Overlaid children (e.g. a <Playhead>), positioned over the tick surface. */
  children?: ReactNode;
}

/** A scrubbable tick ruler. The surface maps a pointer to seconds via the shared
 *  geometry and emits onScrub on drag (setPointerCapture + window move/up). Ticks
 *  are placed at `majorEvery` (labelled) with one minor tick between. role=slider
 *  spanning 0..duration. */
export const TimelineRuler = forwardRef<HTMLDivElement, TimelineRulerProps>(
  function TimelineRuler(
    {
      duration,
      pixelsPerSecond = 60,
      fps = 24,
      offset = 0,
      majorEvery,
      onScrub,
      onScrubEnd,
      accent,
      className,
      children,
    },
    forwardedRef,
  ) {
    const [rootRef, setRef] = useMergedRef<HTMLDivElement>(forwardedRef);
    const [scrubVal, setScrubVal] = useState(0);
    // (#209) `??` lets a 0 (or negative) majorEvery through, and the tick loop
    // steps by major/2 — a 0 step never advances and spins the render forever.
    const major = majorEvery && majorEvery > 0 ? majorEvery : niceMajorStep(pixelsPerSecond);

    const fromPointer = (clientX: number): number => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return roundTo(
        xToSeconds(clientX, rect.left, pixelsPerSecond, offset, duration),
        4,
      );
    };

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      let last = fromPointer(e.clientX);
      setScrubVal(last);
      onScrub?.(last);
      const move = (ev: PointerEvent) => {
        last = fromPointer(ev.clientX);
        setScrubVal(last);
        onScrub?.(last);
      };
      // (#204) pointercancel fires INSTEAD of pointerup when the browser takes
      // the pointer over (touch pan/zoom, pen out of range): without it the
      // move closure stays bound to window and keeps scrubbing forever.
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        onScrubEnd?.(last);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };

    // build the tick marks: a major (labelled) tick every `major` seconds, plus
    // one minor tick at the half-step when it still fits on screen.
    const ticks: ReactNode[] = [];
    const minorStep = major / 2;
    const showMinor = minorStep * pixelsPerSecond >= 14;
    for (let t = 0; t <= duration + 1e-6; t += minorStep) {
      const sec = roundTo(t, 6);
      const isMajor = Math.abs(sec / major - Math.round(sec / major)) < 1e-6;
      if (!isMajor && !showMinor) continue;
      const left = secondsToX(sec, pixelsPerSecond, offset);
      ticks.push(
        <div
          key={sec}
          className={cx("monet-cv-ruler-tick", isMajor && "is-major")}
          style={{ left: `${left}px` }}
          aria-hidden="true"
        >
          {isMajor && (
            <span className="monet-cv-ruler-label">
              {formatTimecode(sec, { fps, format: "smpte" })}
            </span>
          )}
        </div>,
      );
    }

    return (
      <div
        ref={setRef}
        role="slider"
        tabIndex={-1}
        aria-label="Timeline ruler"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={roundTo(scrubVal, 4)}
        className={cx("monet-cv-ruler", className)}
        style={{ "--accent": accent } as CSSProperties}
        onPointerDown={onPointerDown}
      >
        {ticks}
        {children}
      </div>
    );
  },
);

// ─── Playhead ──────────────────────────────────────────────────

export interface PlayheadProps {
  /** Controlled position in seconds. Omit (with `defaultValue`) for uncontrolled. */
  value?: number;
  defaultValue?: number;
  onChange?: (seconds: number) => void;
  /** Fires once when a drag / key nudge ends. */
  onChangeEnd?: (seconds: number) => void;
  /** Span the position is clamped to. */
  duration: number;
  pixelsPerSecond?: number;
  /** Left inset in pixels (the shared geometry offset). Defaults to 0. */
  offset?: number;
  fps?: number;
  /** Draw a full-height line (the timeline playhead) vs a compact head. Defaults true. */
  full?: boolean;
  disabled?: boolean;
  accent?: string;
  "aria-label"?: string;
  className?: string;
}

/** A draggable seconds head on a track. Dragging the head maps clientX → seconds
 *  via the shared geometry (setPointerCapture); Arrow steps one frame (±1/fps),
 *  Shift steps ±1s, Home/End jump to the bounds. role=slider with an
 *  aria-valuetext timecode. Positioned at `left = offset + value·pps`. */
export const Playhead = forwardRef<HTMLDivElement, PlayheadProps>(function Playhead(
  {
    value,
    defaultValue,
    onChange,
    onChangeEnd,
    duration,
    pixelsPerSecond = 60,
    offset = 0,
    fps = 24,
    full = true,
    disabled,
    accent,
    className,
    ...aria
  },
  forwardedRef,
) {
  const [seconds, setSeconds] = useControllableState<number>(
    value,
    defaultValue ?? 0,
    onChange,
  );
  const headRef = useRef<HTMLDivElement | null>(null);
  const frame = frameDuration(fps);

  const commit = (s: number): number => {
    const next = roundTo(clamp(s, 0, duration), 6);
    setSeconds(next);
    return next;
  };

  const fromPointer = (clientX: number): number => {
    // measure against the head's offsetParent (the track) so the geometry
    // matches the ruler/lanes that share this offset.
    const parent = headRef.current?.offsetParent as HTMLElement | null;
    const rect = parent?.getBoundingClientRect();
    const left = rect ? rect.left : 0;
    return commit(xToSeconds(clientX, left, pixelsPerSecond, offset, duration));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    let last = seconds;
    const move = (ev: PointerEvent) => {
      last = fromPointer(ev.clientX);
    };
    // (#204) pointercancel too — see TimelineRuler.
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onChangeEnd?.(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next = seconds;
    const stepBig = e.shiftKey;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = seconds + (stepBig ? 1 : frame);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = seconds - (stepBig ? 1 : frame);
    else if (e.key === "PageUp") next = seconds + 1;
    else if (e.key === "PageDown") next = seconds - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = duration;
    else return;
    e.preventDefault();
    const c = commit(next);
    onChangeEnd?.(c);
  };

  const left = secondsToX(clamp(seconds, 0, duration), pixelsPerSecond, offset);

  return (
    <div
      ref={(el) => {
        headRef.current = el;
        if (typeof forwardedRef === "function") forwardedRef(el);
        else if (forwardedRef)
          (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={aria["aria-label"] ?? "Playhead"}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={roundTo(seconds, 4)}
      aria-valuetext={formatTimecode(seconds, { fps, format: "smpte" })}
      aria-disabled={disabled || undefined}
      className={cx(
        "monet-cv-playhead",
        full ? "is-full" : "is-compact",
        disabled && "is-disabled",
        className,
      )}
      style={{ "--accent": accent, left: `${left}px` } as CSSProperties}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <div className="monet-cv-playhead-head" aria-hidden="true" />
      <div className="monet-cv-playhead-line" aria-hidden="true" />
    </div>
  );
});

// ─── KeyframeTrack ─────────────────────────────────────────────

export type KeyframeEase = "linear" | "bezier" | "hold";

export interface Keyframe {
  id: string;
  /** Position in seconds. */
  time: number;
  /** Optional value carried by the keyframe (host-defined). */
  value?: number;
  /** Interpolation kind → diamond style. Defaults to "linear". */
  ease?: KeyframeEase;
  /** Selected highlight. */
  selected?: boolean;
}

export interface KeyframeTrackProps {
  /** Controlled keyframes. Omit (with `defaultKeyframes`) for uncontrolled. */
  keyframes?: Keyframe[];
  defaultKeyframes?: Keyframe[];
  /** Fires the next (immutable) keyframe array on a move / add / delete. */
  onChange?: (keyframes: Keyframe[]) => void;
  /** Fires once when an interaction ends. */
  onChangeEnd?: (keyframes: Keyframe[]) => void;
  /** Span the diamonds are clamped to. */
  duration: number;
  pixelsPerSecond?: number;
  /** Left inset in pixels (the shared geometry offset). Defaults to 0. */
  offset?: number;
  fps?: number;
  /** Snap dragged/added keyframes to whole frames. Defaults to true. */
  snap?: boolean;
  /** Leading label rendered in the lane head (.monet-track-head). */
  label?: ReactNode;
  /** Width of that lane head in pixels. Omit to keep the stylesheet default —
   *  set it (as the composite Timeline does) so the lane body's time origin
   *  lines up with the ruler / playhead / clip lanes. */
  headWidth?: number;
  /** Double-clicking the lane adds a keyframe at that time. Defaults to true. */
  addOnDblClick?: boolean;
  /** Fires the selected keyframe id (or null when cleared). */
  onSelectKeyframe?: (id: string | null) => void;
  accent?: string;
  className?: string;
}

let kfSeq = 0;
const nextKfId = () => `monet-kf-${++kfSeq}`;

/** A lane of draggable keyframe diamonds over the shared timeline geometry.
 *  Drag a diamond to retime it (snapping to whole frames); double-click the lane
 *  adds one; Delete/Backspace removes the selected diamond. Built on the chrome
 *  `.monet-track` (head + body). Each diamond is role=slider labelled by its
 *  timecode. */
export const KeyframeTrack = forwardRef<HTMLDivElement, KeyframeTrackProps>(
  function KeyframeTrack(
    {
      keyframes,
      defaultKeyframes,
      onChange,
      onChangeEnd,
      duration,
      pixelsPerSecond = 60,
      offset = 0,
      fps = 24,
      snap = true,
      label,
      headWidth,
      addOnDblClick = true,
      onSelectKeyframe,
      accent,
      className,
    },
    forwardedRef,
  ) {
    const [kfs, setKfs] = useControllableState<Keyframe[]>(
      keyframes,
      defaultKeyframes ?? [],
      onChange,
    );
    const [selected, setSelected] = useState<string | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);

    const select = (id: string | null) => {
      setSelected(id);
      onSelectKeyframe?.(id);
    };

    const emit = (next: Keyframe[], end: boolean) => {
      setKfs(next);
      if (end) onChangeEnd?.(next);
    };

    const timeFromPointer = (clientX: number): number => {
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      // (#211) the lane body already starts after the head, so `offset` is an
      // extra inset INSIDE the body — it must still be honored (it is a
      // documented prop) and must match the diamond placement below.
      const raw = xToSeconds(clientX, rect.left, pixelsPerSecond, offset, duration);
      return snap ? snapToFrame(raw, fps) : roundTo(raw, 6);
    };

    const moveKf = (id: string, time: number, end: boolean) => {
      const next = kfs.map((k) =>
        k.id === id ? { ...k, time: clamp(time, 0, duration) } : k,
      );
      emit(next, end);
    };

    const onDiamondPointerDown =
      (id: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.currentTarget.focus();
        select(id);
        let last = kfs.find((k) => k.id === id)?.time ?? 0;
        const move = (ev: PointerEvent) => {
          last = timeFromPointer(ev.clientX);
          moveKf(id, last, false);
        };
        // (#204) pointercancel too — see TimelineRuler.
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          moveKf(id, last, true);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      };

    const removeKf = (id: string) => {
      const next = kfs.filter((k) => k.id !== id);
      emit(next, true);
      if (selected === id) select(null);
    };

    const onDiamondKeyDown = (id: string) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      const kf = kfs.find((k) => k.id === id);
      if (!kf) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeKf(id);
        return;
      }
      const frame = frameDuration(fps);
      let next = kf.time;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") next += e.shiftKey ? 1 : frame;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next -= e.shiftKey ? 1 : frame;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = duration;
      else return;
      e.preventDefault();
      const snapped = snap ? snapToFrame(next, fps) : next;
      moveKf(id, snapped, true);
    };

    const onLaneDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!addOnDblClick) return;
      const time = timeFromPointer(e.clientX);
      const id = nextKfId();
      const next = [...kfs, { id, time, ease: "linear" as KeyframeEase }];
      emit(next, true);
      select(id);
    };

    return (
      <div
        ref={forwardedRef}
        className={cx("monet-track", "monet-cv-kftrack", className)}
        style={{ "--accent": accent } as CSSProperties}
      >
        {label != null && (
          <div
            className="monet-track-head monet-cv-kftrack-head"
            // (#203) without this the head falls back to the stylesheet's fixed
            // 140px and the lane's time origin drifts off the ruler/clip lanes.
            style={
              headWidth != null
                ? { width: `${headWidth}px`, flex: `0 0 ${headWidth}px` }
                : undefined
            }
          >
            {label}
          </div>
        )}
        <div
          ref={bodyRef}
          className="monet-track-body monet-cv-kftrack-body"
          onDoubleClick={onLaneDoubleClick}
        >
          {kfs.map((kf) => {
            const left = secondsToX(clamp(kf.time, 0, duration), pixelsPerSecond, offset);
            const isSel = kf.selected ?? selected === kf.id;
            const ease = kf.ease ?? "linear";
            return (
              <div
                key={kf.id}
                role="slider"
                tabIndex={0}
                aria-label={`Keyframe at ${formatTimecode(kf.time, { fps, format: "smpte" })}`}
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={roundTo(kf.time, 4)}
                aria-valuetext={formatTimecode(kf.time, { fps, format: "smpte" })}
                className={cx(
                  "monet-cv-keyframe",
                  isSel && "is-selected",
                  ease === "hold" && "is-hold",
                  ease === "bezier" && "is-bezier",
                )}
                style={{ left: `${left}px` }}
                onPointerDown={onDiamondPointerDown(kf.id)}
                onKeyDown={onDiamondKeyDown(kf.id)}
              />
            );
          })}
        </div>
      </div>
    );
  },
);

// ─── Timeline (composite) ──────────────────────────────────────

export interface TimelineClip {
  id?: string;
  /** Start in seconds. */
  x: number;
  /** Width in seconds. */
  w: number;
  label?: ReactNode;
}

export interface TimelineTrack {
  id: string;
  name: string;
  /** Per-track accent override (CSS color or var). */
  color?: string;
  /** Lane content. Defaults to "clips". */
  kind?: "clips" | "keyframes";
  /** Clips for a "clips" lane (x/w in seconds). */
  clips?: TimelineClip[];
  /** Keyframes for a "keyframes" lane. */
  keyframes?: Keyframe[];
  muted?: boolean;
  solo?: boolean;
  locked?: boolean;
}

export interface TimelineProps {
  /** The lanes to render, top to bottom. */
  tracks: TimelineTrack[];
  /** Total span in seconds. */
  duration: number;
  /** Controlled playhead time. Omit (with `defaultTime`) for uncontrolled. */
  time?: number;
  defaultTime?: number;
  onTimeChange?: (seconds: number) => void;
  onTimeChangeEnd?: (seconds: number) => void;
  pixelsPerSecond?: number;
  /** Track-head column width in pixels (the shared geometry offset). Defaults 160. */
  headWidth?: number;
  fps?: number;
  /** Fires the next tracks array when a keyframe lane mutates. */
  onTracksChange?: (tracks: TimelineTrack[]) => void;
  /** Toolbar rendered above the ruler (e.g. a <Transport>). */
  toolbar?: ReactNode;
  accent?: string;
  className?: string;
}

/** The composite timeline: a top TimelineRuler (inset by `headWidth`) hosting a
 *  Playhead, over a scroll region of track rows. Clip lanes render `.monet-clip`
 *  bars; keyframe lanes render a <KeyframeTrack>. Owns the playhead time via
 *  useControllableState and shares one pixelsPerSecond / headWidth / fps with
 *  every child so the ruler, playhead and lanes stay pixel-aligned. */
export const Timeline = forwardRef<HTMLDivElement, TimelineProps>(function Timeline(
  {
    tracks,
    duration,
    time,
    defaultTime,
    onTimeChange,
    onTimeChangeEnd,
    pixelsPerSecond = 15,
    headWidth = 160,
    fps = 24,
    onTracksChange,
    toolbar,
    accent,
    className,
  },
  forwardedRef,
) {
  const [playTime, setPlayTime] = useControllableState<number>(
    time,
    defaultTime ?? 0,
    onTimeChange,
  );

  const setTime = (s: number) => setPlayTime(clamp(s, 0, duration));

  const patchTrackKeyframes = (id: string, keyframes: Keyframe[]) => {
    onTracksChange?.(tracks.map((t) => (t.id === id ? { ...t, keyframes } : t)));
  };

  return (
    <div
      ref={forwardedRef}
      className={cx("monet-cv-timeline", className)}
      style={{ "--accent": accent } as CSSProperties}
    >
      {toolbar != null && <div className="monet-cv-timeline-toolbar">{toolbar}</div>}
      <div className="monet-cv-timeline-head">
        <div
          className="monet-cv-timeline-head-spacer"
          style={{ width: `${headWidth}px`, flex: `0 0 ${headWidth}px` }}
          aria-hidden="true"
        />
        <TimelineRuler
          duration={duration}
          pixelsPerSecond={pixelsPerSecond}
          fps={fps}
          offset={0}
          accent={accent}
          className="monet-cv-timeline-ruler"
          onScrub={setTime}
          onScrubEnd={(s) => onTimeChangeEnd?.(s)}
        >
          <Playhead
            value={playTime}
            duration={duration}
            pixelsPerSecond={pixelsPerSecond}
            offset={0}
            fps={fps}
            accent={accent}
            onChange={setTime}
            onChangeEnd={(s) => onTimeChangeEnd?.(s)}
          />
        </TimelineRuler>
      </div>
      <div className="monet-cv-timeline-body">
        {tracks.map((track) => {
          const kind = track.kind ?? "clips";
          const trackAccent = track.color ?? accent;
          if (kind === "keyframes") {
            return (
              <KeyframeTrack
                key={track.id}
                keyframes={track.keyframes}
                duration={duration}
                pixelsPerSecond={pixelsPerSecond}
                offset={0}
                fps={fps}
                accent={trackAccent}
                // (#203) the keyframe lane head must share the clip lanes' width
                label={<TrackHeadLabel track={track} />}
                headWidth={headWidth}
                onChange={(kfs) => patchTrackKeyframes(track.id, kfs)}
                className="monet-cv-timeline-lane"
              />
            );
          }
          return (
            <div key={track.id} className="monet-track monet-cv-timeline-lane">
              <div
                className="monet-track-head"
                style={{ width: `${headWidth}px`, flex: `0 0 ${headWidth}px` }}
              >
                <TrackHeadLabel track={track} />
              </div>
              <div className="monet-track-body">
                {(track.clips ?? []).map((clip, i) => (
                  <div
                    key={clip.id ?? `${track.id}-clip-${i}`}
                    className="monet-clip monet-cv-timeline-clip"
                    style={
                      {
                        "--accent": trackAccent,
                        left: `${secondsToX(clip.x, pixelsPerSecond, 0)}px`,
                        width: `${Math.max(0, clip.w) * pixelsPerSecond}px`,
                      } as CSSProperties
                    }
                  >
                    {clip.label}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/** The track-head content shared by clip + keyframe lanes (name + mute/solo/lock
 *  status dots). Internal to the composite Timeline. */
function TrackHeadLabel({ track }: { track: TimelineTrack }) {
  return (
    <span className="monet-cv-timeline-track-name">
      <span className="monet-cv-timeline-track-text">{track.name}</span>
      {(track.muted || track.solo || track.locked) && (
        <span className="monet-cv-timeline-track-flags" aria-hidden="true">
          {track.solo && <span className="monet-cv-timeline-flag is-solo">S</span>}
          {track.muted && <span className="monet-cv-timeline-flag is-muted">M</span>}
          {track.locked && <span className="monet-cv-timeline-flag is-locked">L</span>}
        </span>
      )}
    </span>
  );
}
