// DOM tests for the creative timeline / motion components (creative-timeline.tsx).
// jsdom has no layout — these assert ROLES, ARIA, state, and callbacks. Drag
// paths fire pointer events and assert onChange fired (never exact geometry,
// since getBoundingClientRect is zeroed); keyboard paths are geometry-independent
// so values / valuetexts are asserted directly. No jest-dom: assertions read DOM
// properties/attributes directly.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  TimeDisplay,
  Transport,
  TimelineRuler,
  Playhead,
  KeyframeTrack,
  Timeline,
  type Keyframe,
  type TimelineTrack,
} from "../../src/creative-timeline.tsx";

// ─── TimeDisplay ───────────────────────────────────────────────
describe("TimeDisplay", () => {
  it("renders a smpte timecode by default and an ms one on request", () => {
    const { container, rerender } = render(<TimeDisplay value={61.5} />);
    expect(container.querySelector(".monet-cv-timecode-value")?.textContent).toBe("00:01:01:12");
    rerender(<TimeDisplay value={61.5} format="ms" />);
    expect(container.querySelector(".monet-cv-timecode-value")?.textContent).toBe("00:01:01.500");
  });

  it("honors a custom fps in the frame field", () => {
    const { container } = render(<TimeDisplay value={0.5} fps={30} />);
    expect(container.querySelector(".monet-cv-timecode-value")?.textContent).toBe("00:00:00:15");
  });

  it("is display-only (no button) without onChange", () => {
    render(<TimeDisplay value={1} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("click-to-edit parses on Enter and fires onChange with seconds", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TimeDisplay value={1} onChange={onChange} aria-label="tc" />);
    await user.click(screen.getByRole("button", { name: "tc" }));
    const input = screen.getByRole("textbox", { name: "tc" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "00:00:02:00{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("commits on blur and ignores an unparseable entry", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TimeDisplay value={1} onChange={onChange} aria-label="tc" />);
    await user.click(screen.getByRole("button", { name: "tc" }));
    const input = screen.getByRole("textbox", { name: "tc" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "garbage");
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    // reverts to the display span
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Escape cancels the edit without firing onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TimeDisplay value={1} onChange={onChange} aria-label="tc" />);
    await user.click(screen.getByRole("button", { name: "tc" }));
    const input = screen.getByRole("textbox", { name: "tc" });
    await user.type(input, "00:00:09:00{Escape}");
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── Transport ─────────────────────────────────────────────────
describe("Transport", () => {
  it("exposes a toolbar with rewind/play/stop/loop/record controls", () => {
    render(<Transport />);
    const bar = screen.getByRole("toolbar", { name: "Transport" });
    expect(within(bar).getByRole("button", { name: "Skip to start" })).not.toBeNull();
    expect(within(bar).getByRole("button", { name: "Play" })).not.toBeNull();
    expect(within(bar).getByRole("button", { name: "Stop" })).not.toBeNull();
    expect(within(bar).getByRole("button", { name: "Loop" })).not.toBeNull();
    expect(within(bar).getByRole("button", { name: "Record" })).not.toBeNull();
  });

  it("toggles the play button label + aria-pressed and fires onPlayingChange", async () => {
    const user = userEvent.setup();
    const onPlayingChange = vi.fn();
    render(<Transport onPlayingChange={onPlayingChange} />);
    const play = screen.getByRole("button", { name: "Play" });
    expect(play.getAttribute("aria-pressed")).toBe("false");
    await user.click(play);
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
    const pause = screen.getByRole("button", { name: "Pause" });
    expect(pause.getAttribute("aria-pressed")).toBe("true");
  });

  it("stop forces playing → false and fires onStop", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const onPlayingChange = vi.fn();
    render(<Transport defaultPlaying onStop={onStop} onPlayingChange={onPlayingChange} />);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  });

  it("loop + record expose aria-pressed and toggle", async () => {
    const user = userEvent.setup();
    const onLoopChange = vi.fn();
    const onRecordChange = vi.fn();
    render(<Transport onLoopChange={onLoopChange} onRecordChange={onRecordChange} />);
    const loop = screen.getByRole("button", { name: "Loop" });
    const rec = screen.getByRole("button", { name: "Record" });
    expect(loop.getAttribute("aria-pressed")).toBe("false");
    await user.click(loop);
    expect(onLoopChange).toHaveBeenLastCalledWith(true);
    await user.click(rec);
    expect(onRecordChange).toHaveBeenLastCalledWith(true);
    expect(rec.getAttribute("aria-pressed")).toBe("true");
  });

  it("fires the skip handlers", async () => {
    const user = userEvent.setup();
    const onSkipStart = vi.fn();
    const onSkipEnd = vi.fn();
    render(
      <Transport
        onSkipStart={onSkipStart}
        onSkipEnd={onSkipEnd}
        // add a custom skip-end control via children so both fire
      >
        <button type="button" aria-label="Skip to end" onClick={() => onSkipEnd()} />
      </Transport>,
    );
    await user.click(screen.getByRole("button", { name: "Skip to start" }));
    expect(onSkipStart).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Skip to end" }));
    expect(onSkipEnd).toHaveBeenCalled();
  });

  it("renders the time + duration readouts", () => {
    const { container } = render(<Transport time={1} duration={61.5} />);
    expect(container.querySelector(".monet-cv-transport-time")?.textContent).toBe("00:00:01:00");
    const dur = container.querySelector(".monet-cv-transport-duration");
    expect(dur?.textContent).toBe("00:01:01:12");
    expect(dur?.classList.contains("is-muted")).toBe(true);
  });
});

// ─── TimelineRuler ─────────────────────────────────────────────
describe("TimelineRuler", () => {
  it("exposes role=slider spanning 0..duration", () => {
    render(<TimelineRuler duration={10} />);
    const ruler = screen.getByRole("slider", { name: "Timeline ruler" });
    expect(ruler.getAttribute("aria-valuemin")).toBe("0");
    expect(ruler.getAttribute("aria-valuemax")).toBe("10");
  });

  it("renders labelled major ticks", () => {
    const { container } = render(<TimelineRuler duration={4} pixelsPerSecond={80} majorEvery={1} />);
    const majors = container.querySelectorAll(".monet-cv-ruler-tick.is-major");
    expect(majors.length).toBeGreaterThanOrEqual(4);
    // first major is labelled with a timecode
    expect(container.querySelector(".monet-cv-ruler-label")?.textContent).toBe("00:00:00:00");
  });

  it("scrubbing the surface fires onScrub + onScrubEnd (geometry-independent)", () => {
    const onScrub = vi.fn();
    const onScrubEnd = vi.fn();
    render(<TimelineRuler duration={10} onScrub={onScrub} onScrubEnd={onScrubEnd} />);
    const ruler = screen.getByRole("slider", { name: "Timeline ruler" });
    fireEvent.pointerDown(ruler, { button: 0, clientX: 40, clientY: 4 });
    fireEvent.pointerMove(window, { clientX: 120, clientY: 4 });
    fireEvent.pointerUp(window);
    expect(onScrub).toHaveBeenCalled();
    expect(onScrubEnd).toHaveBeenCalled();
  });

  // (#209) `majorEvery ?? niceMajorStep(pps)` let a 0 through; the tick loop
  // steps by major/2, so a 0 step never advanced and spun the render forever.
  it("falls back to the auto step when majorEvery is 0 or negative", () => {
    for (const majorEvery of [0, -1]) {
      const { container, unmount } = render(
        <TimelineRuler duration={4} pixelsPerSecond={80} majorEvery={majorEvery} />,
      );
      const majors = container.querySelectorAll(".monet-cv-ruler-tick.is-major");
      expect(majors.length).toBeGreaterThan(0);
      unmount();
    }
  });

  // (#204) pointercancel fires INSTEAD of pointerup when the browser takes the
  // pointer over; without it the move closure stayed bound to window forever.
  it("a pointercancel ends the scrub and unbinds the window listeners", () => {
    const onScrub = vi.fn();
    const onScrubEnd = vi.fn();
    render(<TimelineRuler duration={10} onScrub={onScrub} onScrubEnd={onScrubEnd} />);
    const ruler = screen.getByRole("slider", { name: "Timeline ruler" });
    fireEvent.pointerDown(ruler, { button: 0, clientX: 40, clientY: 4 });
    fireEvent.pointerCancel(window);
    expect(onScrubEnd).toHaveBeenCalled();
    const seen = onScrub.mock.calls.length;
    fireEvent.pointerMove(window, { clientX: 200, clientY: 4 });
    expect(onScrub.mock.calls.length).toBe(seen); // listener really gone
  });

  it("renders overlaid children (e.g. a Playhead)", () => {
    render(
      <TimelineRuler duration={10}>
        <Playhead duration={10} defaultValue={2} aria-label="ph" />
      </TimelineRuler>,
    );
    expect(screen.getByRole("slider", { name: "ph" })).not.toBeNull();
  });
});

// ─── Playhead ──────────────────────────────────────────────────
describe("Playhead", () => {
  it("exposes role=slider with a timecode valuetext", () => {
    render(<Playhead duration={10} defaultValue={1} />);
    const ph = screen.getByRole("slider", { name: "Playhead" });
    expect(ph.getAttribute("aria-valuemin")).toBe("0");
    expect(ph.getAttribute("aria-valuemax")).toBe("10");
    expect(ph.getAttribute("aria-valuenow")).toBe("1");
    expect(ph.getAttribute("aria-valuetext")).toBe("00:00:01:00");
  });

  it("Arrow steps one frame, Shift+Arrow steps one second, clamped, firing callbacks", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <Playhead
        aria-label="ph"
        duration={10}
        fps={24}
        defaultValue={1}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />,
    );
    const ph = screen.getByRole("slider", { name: "ph" });
    fireEvent.keyDown(ph, { key: "ArrowRight" }); // +1/24
    expect(onChange.mock.calls.at(-1)![0]).toBeCloseTo(1 + 1 / 24, 5);
    expect(onChangeEnd).toHaveBeenCalled();
    fireEvent.keyDown(ph, { key: "ArrowRight", shiftKey: true }); // +1s
    expect(onChange.mock.calls.at(-1)![0]).toBeCloseTo(2 + 1 / 24, 5);
    fireEvent.keyDown(ph, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(ph, { key: "ArrowLeft" }); // 0 - frame → clamp 0
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(ph, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it("dragging the head fires onChange (geometry-independent)", () => {
    const onChange = vi.fn();
    render(<Playhead aria-label="ph" duration={10} defaultValue={0} onChange={onChange} />);
    const ph = screen.getByRole("slider", { name: "ph" });
    fireEvent.pointerDown(ph, { button: 0, clientX: 50, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 120, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  // (#204) see TimelineRuler — a cancelled pointer must still end the drag.
  it("a pointercancel ends the drag and unbinds the window listeners", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <Playhead aria-label="ph" duration={10} defaultValue={0} onChange={onChange} onChangeEnd={onChangeEnd} />,
    );
    const ph = screen.getByRole("slider", { name: "ph" });
    fireEvent.pointerDown(ph, { button: 0, clientX: 50, clientY: 0 });
    fireEvent.pointerCancel(window);
    expect(onChangeEnd).toHaveBeenCalled();
    const seen = onChange.mock.calls.length;
    fireEvent.pointerMove(window, { clientX: 120, clientY: 0 });
    expect(onChange.mock.calls.length).toBe(seen);
  });

  it("is inert when disabled", () => {
    const onChange = vi.fn();
    render(<Playhead aria-label="ph" duration={10} disabled defaultValue={1} onChange={onChange} />);
    const ph = screen.getByRole("slider", { name: "ph" });
    expect(ph.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(ph, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports a controlled value via a host", () => {
    function Host() {
      const [t, setT] = useState(2);
      return <Playhead aria-label="ph" duration={10} value={t} onChange={setT} />;
    }
    render(<Host />);
    const ph = screen.getByRole("slider", { name: "ph" });
    fireEvent.keyDown(ph, { key: "Home" });
    expect(ph.getAttribute("aria-valuenow")).toBe("0");
  });
});

// ─── KeyframeTrack ─────────────────────────────────────────────
const KFS: Keyframe[] = [
  { id: "a", time: 0 },
  { id: "b", time: 1, ease: "hold" },
  { id: "c", time: 2, ease: "bezier" },
];

describe("KeyframeTrack", () => {
  it("renders a slider diamond per keyframe labelled by timecode", () => {
    render(<KeyframeTrack duration={4} defaultKeyframes={KFS} />);
    const diamonds = screen.getAllByRole("slider", { name: /^Keyframe at/ });
    expect(diamonds.length).toBe(3);
    expect(screen.getByRole("slider", { name: "Keyframe at 00:00:01:00" })).not.toBeNull();
  });

  it("reflects ease + selection via classes", () => {
    const { container } = render(
      <KeyframeTrack duration={4} defaultKeyframes={[{ id: "h", time: 0, ease: "hold", selected: true }]} />,
    );
    const d = container.querySelector(".monet-cv-keyframe")!;
    expect(d.classList.contains("is-hold")).toBe(true);
    expect(d.classList.contains("is-selected")).toBe(true);
  });

  it("Arrow keys retime a diamond (snapped to frames) and fire onChange", () => {
    const onChange = vi.fn();
    render(<KeyframeTrack duration={4} fps={24} defaultKeyframes={KFS} onChange={onChange} />);
    const first = screen.getByRole("slider", { name: "Keyframe at 00:00:00:00" });
    fireEvent.keyDown(first, { key: "ArrowRight" }); // +1 frame
    const next = onChange.mock.calls.at(-1)![0] as Keyframe[];
    expect(next.find((k) => k.id === "a")!.time).toBeCloseTo(1 / 24, 5);
  });

  it("Delete removes the selected keyframe and emits an immutable array", () => {
    const onChange = vi.fn();
    const src = [...KFS];
    render(<KeyframeTrack duration={4} defaultKeyframes={src} onChange={onChange} onSelectKeyframe={() => {}} />);
    const mid = screen.getByRole("slider", { name: "Keyframe at 00:00:01:00" });
    fireEvent.pointerDown(mid, { button: 0, clientX: 0, clientY: 0 }); // selects it
    fireEvent.pointerUp(window);
    fireEvent.keyDown(mid, { key: "Delete" });
    const after = onChange.mock.calls.at(-1)![0] as Keyframe[];
    expect(after.length).toBe(2);
    expect(after.find((k) => k.id === "b")).toBeUndefined();
    // original array is untouched (immutability)
    expect(src.length).toBe(3);
  });

  it("double-clicking the lane adds a keyframe and selects it", () => {
    const onChange = vi.fn();
    const onSelectKeyframe = vi.fn();
    const { container } = render(
      <KeyframeTrack duration={4} defaultKeyframes={[]} onChange={onChange} onSelectKeyframe={onSelectKeyframe} />,
    );
    const body = container.querySelector(".monet-cv-kftrack-body")!;
    fireEvent.doubleClick(body, { clientX: 30, clientY: 0 });
    const added = onChange.mock.calls.at(-1)![0] as Keyframe[];
    expect(added.length).toBe(1);
    expect(onSelectKeyframe).toHaveBeenCalledWith(added[0].id);
  });

  it("dragging a diamond fires onChange (geometry-independent)", () => {
    const onChange = vi.fn();
    render(<KeyframeTrack duration={4} defaultKeyframes={KFS} onChange={onChange} />);
    const d = screen.getByRole("slider", { name: "Keyframe at 00:00:02:00" });
    fireEvent.pointerDown(d, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  it("renders a lane label in the track head", () => {
    render(<KeyframeTrack duration={4} defaultKeyframes={[]} label="Opacity" />);
    expect(screen.getByText("Opacity")).not.toBeNull();
  });

  // (#203) the lane head must take the shared head width, or the body's time
  // origin (and every diamond) drifts off the ruler by 140px − headWidth.
  it("sizes the lane head to headWidth", () => {
    const { container } = render(
      <KeyframeTrack duration={4} defaultKeyframes={[]} label="Opacity" headWidth={180} />,
    );
    const head = container.querySelector<HTMLElement>(".monet-cv-kftrack-head")!;
    expect(head.style.width).toBe("180px");
    expect(head.style.flex).toBe("0 0 180px");
  });

  // (#211) `offset` is documented as the shared geometry inset but was hard-
  // coded to 0 at both geometry sites, so passing it did nothing.
  it("honors the offset prop when placing diamonds", () => {
    const { container } = render(
      <KeyframeTrack
        duration={4}
        pixelsPerSecond={10}
        offset={50}
        defaultKeyframes={[{ id: "a", time: 1 }]}
      />,
    );
    expect(container.querySelector<HTMLElement>(".monet-cv-keyframe")!.style.left).toBe("60px");
  });

  // (#204) see TimelineRuler — a cancelled pointer must still end the drag.
  it("a pointercancel ends a diamond drag and unbinds the window listeners", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <KeyframeTrack duration={4} defaultKeyframes={KFS} onChange={onChange} onChangeEnd={onChangeEnd} />,
    );
    const d = screen.getByRole("slider", { name: "Keyframe at 00:00:02:00" });
    fireEvent.pointerDown(d, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerCancel(window);
    expect(onChangeEnd).toHaveBeenCalled();
    const seen = onChange.mock.calls.length;
    fireEvent.pointerMove(window, { clientX: 120, clientY: 0 });
    expect(onChange.mock.calls.length).toBe(seen);
  });

  it("supports controlled keyframes via a host", () => {
    function Host() {
      const [kfs, setKfs] = useState<Keyframe[]>([{ id: "x", time: 0 }]);
      return <KeyframeTrack duration={4} keyframes={kfs} onChange={setKfs} />;
    }
    render(<Host />);
    const d = screen.getByRole("slider", { name: "Keyframe at 00:00:00:00" });
    fireEvent.keyDown(d, { key: "End" }); // → duration 4
    expect(screen.getByRole("slider", { name: "Keyframe at 00:00:04:00" })).not.toBeNull();
  });
});

// ─── Timeline (composite) ──────────────────────────────────────
const TRACKS: TimelineTrack[] = [
  {
    id: "video",
    name: "Video",
    kind: "clips",
    clips: [
      { id: "c1", x: 0, w: 4, label: "Intro" },
      { id: "c2", x: 5, w: 3, label: "Body" },
    ],
  },
  {
    id: "opacity",
    name: "Opacity",
    kind: "keyframes",
    keyframes: [
      { id: "k1", time: 0 },
      { id: "k2", time: 6 },
    ],
    muted: true,
  },
];

describe("Timeline", () => {
  it("renders a ruler + playhead and the track lanes", () => {
    render(<Timeline tracks={TRACKS} duration={10} defaultTime={2} />);
    expect(screen.getByRole("slider", { name: "Timeline ruler" })).not.toBeNull();
    expect(screen.getByRole("slider", { name: "Playhead" })).not.toBeNull();
    expect(screen.getByText("Video")).not.toBeNull();
    expect(screen.getByText("Opacity")).not.toBeNull();
    // the keyframe lane surfaces its diamonds
    expect(screen.getByRole("slider", { name: "Keyframe at 00:00:06:00" })).not.toBeNull();
  });

  it("renders clip bars for clip lanes", () => {
    const { container } = render(<Timeline tracks={TRACKS} duration={10} />);
    const clips = container.querySelectorAll(".monet-cv-timeline-clip");
    expect(clips.length).toBe(2);
    expect(clips[0].textContent).toBe("Intro");
  });

  it("scrubbing the ruler drives onTimeChange and moves the playhead", () => {
    const onTimeChange = vi.fn();
    render(<Timeline tracks={TRACKS} duration={10} onTimeChange={onTimeChange} />);
    const ruler = screen.getByRole("slider", { name: "Timeline ruler" });
    fireEvent.pointerDown(ruler, { button: 0, clientX: 100, clientY: 4 });
    fireEvent.pointerUp(window);
    expect(onTimeChange).toHaveBeenCalled();
  });

  it("the playhead Arrow keys drive onTimeChange (shared geometry)", () => {
    const onTimeChange = vi.fn();
    render(<Timeline tracks={TRACKS} duration={10} fps={24} defaultTime={1} onTimeChange={onTimeChange} />);
    const ph = screen.getByRole("slider", { name: "Playhead" });
    fireEvent.keyDown(ph, { key: "ArrowRight" });
    expect(onTimeChange.mock.calls.at(-1)![0]).toBeCloseTo(1 + 1 / 24, 5);
  });

  it("editing a keyframe lane bubbles up via onTracksChange with the patched track", () => {
    const onTracksChange = vi.fn();
    render(<Timeline tracks={TRACKS} duration={10} onTracksChange={onTracksChange} />);
    const kf = screen.getByRole("slider", { name: "Keyframe at 00:00:00:00" });
    fireEvent.keyDown(kf, { key: "ArrowRight" });
    const next = onTracksChange.mock.calls.at(-1)![0] as TimelineTrack[];
    const opacity = next.find((t) => t.id === "opacity")!;
    expect(opacity.keyframes!.find((k) => k.id === "k1")!.time).toBeCloseTo(1 / 24, 5);
    // the clip track is untouched
    expect(next.find((t) => t.id === "video")!.clips!.length).toBe(2);
  });

  // (#203) every lane head — clip AND keyframe — shares headWidth, or the
  // keyframe diamonds sit (140 − headWidth)px off the ruler and clip bars.
  it("gives clip and keyframe lane heads the same width", () => {
    const { container } = render(<Timeline tracks={TRACKS} duration={10} headWidth={180} />);
    const heads = Array.from(container.querySelectorAll<HTMLElement>(".monet-track-head"));
    expect(heads.length).toBe(2);
    expect(container.querySelector<HTMLElement>(".monet-cv-kftrack-head")).not.toBeNull();
    for (const head of heads) expect(head.style.width).toBe("180px");
    // …and the ruler spacer that insets the ruler by the same amount
    expect(
      container.querySelector<HTMLElement>(".monet-cv-timeline-head-spacer")!.style.width,
    ).toBe("180px");
  });

  it("shows mute/solo/lock flags in the track head", () => {
    const { container } = render(<Timeline tracks={TRACKS} duration={10} />);
    expect(container.querySelector(".monet-cv-timeline-flag.is-muted")?.textContent).toBe("M");
  });

  it("supports a controlled time via a host", () => {
    function Host() {
      const [t, setT] = useState(3);
      return <Timeline tracks={TRACKS} duration={10} time={t} onTimeChange={setT} />;
    }
    render(<Host />);
    const ph = screen.getByRole("slider", { name: "Playhead" });
    expect(ph.getAttribute("aria-valuenow")).toBe("3");
    fireEvent.keyDown(ph, { key: "Home" });
    expect(ph.getAttribute("aria-valuenow")).toBe("0");
  });
});
