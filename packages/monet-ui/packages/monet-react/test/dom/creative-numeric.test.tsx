// DOM tests for the creative numeric / transform controls (creative-numeric.tsx).
// jsdom has no layout — these assert ROLES, ARIA, state, and callbacks. Drag
// paths fire pointer events and assert onChange fired (never exact geometry);
// keyboard paths are geometry-independent so exact values are asserted.
// No jest-dom: assertions read DOM properties/attributes directly.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  PropertyRow,
  ScrubbyNumber,
  Stepper,
  RangeSlider,
  AngleDial,
  Knob,
  TransformFields,
} from "../../src/creative-numeric.tsx";

// jsdom has no layout: the pointer-geometry cases below install the box the
// shipped CSS produces (creative.css) on the elements the math reads.
function stubRect(el: HTMLElement, box: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({
      x: box.left,
      y: box.top,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      right: box.left + box.width,
      bottom: box.top + box.height,
      toJSON: () => ({}),
    }) as DOMRect;
}

// ─── PropertyRow ───────────────────────────────────────────────
describe("PropertyRow", () => {
  it("renders label, value, fieldValue and an associated <label htmlFor>", () => {
    const { container } = render(
      <PropertyRow label="Opacity" htmlFor="op" value="80%" fieldValue="boxed" icon={<i />}>
        <input id="op" aria-label="op" />
      </PropertyRow>,
    );
    const label = container.querySelector("label.lbl") as HTMLLabelElement;
    expect(label.getAttribute("for")).toBe("op");
    expect(label.textContent).toBe("Opacity");
    expect(container.querySelector(".val")?.textContent).toBe("80%");
    expect(container.querySelector(".field")?.textContent).toBe("boxed");
    expect(container.querySelector(".monet-cv-row-icon")).not.toBeNull();
    expect(container.querySelector(".monet-row")).not.toBeNull();
  });

  it("renders the label as a plain span when no htmlFor is given", () => {
    const { container } = render(<PropertyRow label="Blend" />);
    expect(container.querySelector("label.lbl")).toBeNull();
    expect(container.querySelector("span.lbl")?.textContent).toBe("Blend");
  });
});

// ─── ScrubbyNumber ─────────────────────────────────────────────
describe("ScrubbyNumber", () => {
  it("exposes role=spinbutton with aria value bounds + valuetext suffix", () => {
    render(
      <ScrubbyNumber aria-label="x" defaultValue={12} min={0} max={100} suffix="px" />,
    );
    const sb = screen.getByRole("spinbutton", { name: "x" });
    expect(sb.getAttribute("aria-valuenow")).toBe("12");
    expect(sb.getAttribute("aria-valuemin")).toBe("0");
    expect(sb.getAttribute("aria-valuemax")).toBe("100");
    expect(sb.getAttribute("aria-valuetext")).toBe("12px");
  });

  it("Arrow/Page/Home/End nudge the value and fire onChange + onChangeEnd", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <ScrubbyNumber
        aria-label="x"
        defaultValue={5}
        min={0}
        max={20}
        step={2}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />,
    );
    const sb = screen.getByRole("spinbutton", { name: "x" });
    fireEvent.keyDown(sb, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(7);
    expect(onChangeEnd).toHaveBeenLastCalledWith(7);
    fireEvent.keyDown(sb, { key: "PageUp" }); // 7 + step*10=20 → clamp 20
    expect(onChange).toHaveBeenLastCalledWith(20);
    fireEvent.keyDown(sb, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(sb, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(20);
  });

  it("infers precision from a fractional step", () => {
    render(<ScrubbyNumber aria-label="o" defaultValue={1} step={0.1} />);
    const sb = screen.getByRole("spinbutton", { name: "o" });
    fireEvent.keyDown(sb, { key: "ArrowDown" });
    expect(sb.getAttribute("aria-valuenow")).toBe("0.9");
  });

  it("dragging the label fires onChange (geometry-independent: just fired)", () => {
    const onChange = vi.fn();
    render(
      <ScrubbyNumber aria-label="x" label="X" defaultValue={0} onChange={onChange} />,
    );
    const lbl = screen.getByText("X");
    fireEvent.pointerDown(lbl, { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 40 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  it("does not respond to keyboard when disabled", () => {
    const onChange = vi.fn();
    render(
      <ScrubbyNumber aria-label="x" defaultValue={5} disabled onChange={onChange} />,
    );
    const sb = screen.getByRole("spinbutton", { name: "x" });
    expect(sb.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(sb, { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports controlled value", () => {
    function Host() {
      const [v, setV] = useState(3);
      return <ScrubbyNumber aria-label="x" value={v} onChange={setV} step={1} />;
    }
    render(<Host />);
    const sb = screen.getByRole("spinbutton", { name: "x" });
    fireEvent.keyDown(sb, { key: "ArrowUp" });
    expect(sb.getAttribute("aria-valuenow")).toBe("4");
  });

  // (#185) the type-to-edit input is a child of the role=spinbutton root, so
  // its keydowns bubble — caret keys must not nudge the value being typed.
  it("leaves Arrow/Page keys to the caret while the edit input is open", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ScrubbyNumber aria-label="x" defaultValue={10} step={1} onChange={onChange} />,
    );
    // pointerdown + pointerup with no movement = a click → type-to-edit
    fireEvent.pointerDown(container.querySelector(".monet-cv-scrub-value")!, {
      button: 0,
      clientX: 5,
    });
    fireEvent.pointerUp(window);
    const input = container.querySelector(".monet-cv-scrub-input") as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "PageDown" });
    expect(onChange).not.toHaveBeenCalled();
  });

  // (#192) a touch pan cancels the gesture with pointercancel, never pointerup
  it("ends the scrub on pointercancel instead of scrubbing forever", () => {
    const onChange = vi.fn();
    render(<ScrubbyNumber aria-label="x" label="X" defaultValue={0} onChange={onChange} />);
    fireEvent.pointerDown(screen.getByText("X"), { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 20 });
    expect(onChange).toHaveBeenCalled();
    fireEvent.pointerCancel(window);
    onChange.mockClear();
    fireEvent.pointerMove(window, { clientX: 200 });
    expect(onChange).not.toHaveBeenCalled();
  });

  // (#192) an inspector panel can close mid-drag
  it("detaches an in-flight scrub when the control unmounts", () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <ScrubbyNumber aria-label="x" label="X" defaultValue={0} onChange={onChange} />,
    );
    fireEvent.pointerDown(screen.getByText("X"), { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 20 });
    unmount();
    onChange.mockClear();
    fireEvent.pointerMove(window, { clientX: 200 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── Stepper ───────────────────────────────────────────────────
describe("Stepper", () => {
  it("renders dec/inc buttons + a spinbutton readout, and steps on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <Stepper aria-label="count" defaultValue={2} min={0} max={5} onChange={onChange} />,
    );
    const sb = screen.getByRole("spinbutton", { name: "count" });
    expect(sb.getAttribute("aria-valuenow")).toBe("2");
    const inc = container.querySelector(".is-inc") as HTMLButtonElement;
    const dec = container.querySelector(".is-dec") as HTMLButtonElement;
    await user.click(inc);
    expect(onChange).toHaveBeenLastCalledWith(3);
    await user.click(dec);
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("disables the inc button at max and the dec button at min", () => {
    const { container, rerender } = render(
      <Stepper aria-label="c" value={5} min={0} max={5} />,
    );
    expect((container.querySelector(".is-inc") as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector(".is-dec") as HTMLButtonElement).disabled).toBe(false);
    rerender(<Stepper aria-label="c" value={0} min={0} max={5} />);
    expect((container.querySelector(".is-inc") as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector(".is-dec") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Arrow keys on the readout nudge by step", () => {
    const onChange = vi.fn();
    render(<Stepper aria-label="c" defaultValue={2} min={0} max={10} step={3} onChange={onChange} />);
    const sb = screen.getByRole("spinbutton", { name: "c" });
    fireEvent.keyDown(sb, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(sb, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("hides the readout when showValue is false", () => {
    render(<Stepper aria-label="c" showValue={false} />);
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
});

// ─── RangeSlider ───────────────────────────────────────────────
describe("RangeSlider", () => {
  it("renders a group with Minimum/Maximum sliders and aria bounds", () => {
    render(
      <RangeSlider aria-label="band" defaultValue={{ min: 0.2, max: 0.8 }} min={0} max={1} step={0.1} />,
    );
    const group = screen.getByRole("group", { name: "band" });
    const min = within(group).getByRole("slider", { name: "Minimum" });
    const max = within(group).getByRole("slider", { name: "Maximum" });
    expect(min.getAttribute("aria-valuenow")).toBe("0.2");
    expect(max.getAttribute("aria-valuenow")).toBe("0.8");
    expect(min.getAttribute("aria-valuemin")).toBe("0");
    expect(max.getAttribute("aria-valuemax")).toBe("1");
  });

  it("keyboard moves a thumb and fires onChange with the new range", () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        aria-label="band"
        defaultValue={{ min: 0.2, max: 0.8 }}
        min={0}
        max={1}
        step={0.1}
        onChange={onChange}
      />,
    );
    const min = screen.getByRole("slider", { name: "Minimum" });
    fireEvent.keyDown(min, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ min: 0.3, max: 0.8 });
    const max = screen.getByRole("slider", { name: "Maximum" });
    fireEvent.keyDown(max, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith({ min: 0.3, max: 0.7 });
  });

  it("clamps the min thumb against the max thumb minus minGap", () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        aria-label="band"
        defaultValue={{ min: 0.4, max: 0.5 }}
        min={0}
        max={1}
        step={0.1}
        minGap={0.1}
        onChange={onChange}
      />,
    );
    const min = screen.getByRole("slider", { name: "Minimum" });
    // pushing min up past (max - minGap = 0.4) is clamped to 0.4
    fireEvent.keyDown(min, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ min: 0.4, max: 0.5 });
  });

  it("dragging a thumb fires onChange (geometry-independent: just fired)", () => {
    const onChange = vi.fn();
    render(
      <RangeSlider aria-label="band" defaultValue={{ min: 0.2, max: 0.8 }} onChange={onChange} />,
    );
    const max = screen.getByRole("slider", { name: "Maximum" });
    fireEvent.pointerDown(max, { button: 0, clientX: 10, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  // (#184) the root carries `padding: 0 7px`; the thumbs are percentages of the
  // inner track, so pointer math must read the track's box, not the root's.
  it("maps pointer positions against the inner track, not the padded root", () => {
    const onChange = vi.fn();
    const { container } = render(
      <RangeSlider
        aria-label="band"
        defaultValue={{ min: 0, max: 100 }}
        min={0}
        max={100}
        step={1}
        onChange={onChange}
      />,
    );
    stubRect(container.querySelector(".monet-cv-rangeslider")!, { left: 0, top: 0, width: 140, height: 16 });
    stubRect(container.querySelector(".monet-cv-rangeslider-track")!, { left: 7, top: 0, width: 126, height: 16 });
    // pressing the min thumb where it actually renders (the track's left edge)
    // must not move it — with the root's box this jumped by 7/140 of the range
    fireEvent.pointerDown(screen.getByRole("slider", { name: "Minimum" }), {
      button: 0,
      clientX: 7,
      clientY: 8,
    });
    expect(onChange).toHaveBeenLastCalledWith({ min: 0, max: 100 });
    // and the track's right edge still reaches max
    fireEvent.pointerMove(window, { clientX: 133, clientY: 8 });
    expect(onChange).toHaveBeenLastCalledWith({ min: 100, max: 100 });
    fireEvent.pointerUp(window);
  });

  it("is inert when disabled", () => {
    const onChange = vi.fn();
    render(
      <RangeSlider aria-label="band" defaultValue={{ min: 0.2, max: 0.8 }} disabled onChange={onChange} />,
    );
    const min = screen.getByRole("slider", { name: "Minimum" });
    expect(min.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(min, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── AngleDial / Knob ──────────────────────────────────────────
describe("AngleDial", () => {
  it("renders role=slider with aria-valuetext in degrees", () => {
    render(<AngleDial aria-label="rot" defaultValue={45} />);
    const dial = screen.getByRole("slider", { name: "rot" });
    expect(dial.getAttribute("aria-valuenow")).toBe("45");
    expect(dial.getAttribute("aria-valuetext")).toBe("45°");
    expect(dial.getAttribute("aria-valuemin")).toBe("0");
    expect(dial.getAttribute("aria-valuemax")).toBe("360");
  });

  it("keyboard rotates and clamps within [min,max]", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <AngleDial aria-label="rot" defaultValue={10} min={0} max={90} step={5} onChange={onChange} onChangeEnd={onChangeEnd} />,
    );
    const dial = screen.getByRole("slider", { name: "rot" });
    fireEvent.keyDown(dial, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(15);
    expect(onChangeEnd).toHaveBeenLastCalledWith(15);
    fireEvent.keyDown(dial, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(90);
    fireEvent.keyDown(dial, { key: "ArrowUp" }); // 90+5 → clamp 90
    expect(onChange).toHaveBeenLastCalledWith(90);
    fireEvent.keyDown(dial, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("dragging the dial fires onChange (geometry-independent: just fired)", () => {
    const onChange = vi.fn();
    render(<AngleDial aria-label="rot" defaultValue={0} onChange={onChange} />);
    const dial = screen.getByRole("slider", { name: "rot" });
    fireEvent.pointerDown(dial, { button: 0, clientX: 30, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 30 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  it("is inert when disabled", () => {
    const onChange = vi.fn();
    render(<AngleDial aria-label="rot" defaultValue={20} disabled onChange={onChange} />);
    const dial = screen.getByRole("slider", { name: "rot" });
    expect(dial.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(dial, { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Knob", () => {
  it("is an AngleDial preset with the is-knob class and bounded defaults", () => {
    render(<Knob aria-label="gain" defaultValue={50} />);
    const knob = screen.getByRole("slider", { name: "gain" });
    expect(knob.className).toContain("is-knob");
    expect(knob.getAttribute("aria-valuemin")).toBe("0");
    expect(knob.getAttribute("aria-valuemax")).toBe("100");
    expect(knob.getAttribute("aria-valuenow")).toBe("50");
  });

  // (#191) the 60° dead-arc is documented as a BOTTOM dead-arc: the sweep runs
  // clockwise from bottom-left (min) over the top (mid) to bottom-right (max).
  it("puts the dead-arc at the bottom of the dial", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Knob aria-label="gain" defaultValue={0} min={0} max={100} onChange={onChange} />,
    );
    const knob = screen.getByRole("slider", { name: "gain" });
    stubRect(knob, { left: 0, top: 0, width: 100, height: 100 }); // centre (50,50)

    const press = (x: number, y: number) => {
      fireEvent.pointerDown(knob, { button: 0, clientX: x, clientY: y });
      fireEvent.pointerUp(window);
    };
    press(50, 100); // 6 o'clock → inside the dead arc → min
    expect(onChange).toHaveBeenLastCalledWith(0);
    press(0, 50); // 9 o'clock → a fifth into the sweep
    expect(onChange).toHaveBeenLastCalledWith(20);
    press(100, 50); // 3 o'clock → four fifths in
    expect(onChange).toHaveBeenLastCalledWith(80);
    press(50, 0); // 12 o'clock → mid-range, needle straight up
    expect(onChange).toHaveBeenLastCalledWith(50);
    expect(
      (container.querySelector(".monet-cv-angledial-needle") as HTMLElement).style.transform,
    ).toBe("rotate(0deg)");
  });

  it("leaves a gapless AngleDial reading 0° at the top", () => {
    const onChange = vi.fn();
    render(<AngleDial aria-label="rot" defaultValue={0} min={0} max={360} onChange={onChange} />);
    const dial = screen.getByRole("slider", { name: "rot" });
    stubRect(dial, { left: 0, top: 0, width: 100, height: 100 });
    fireEvent.pointerDown(dial, { button: 0, clientX: 100, clientY: 50 }); // 3 o'clock
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenLastCalledWith(90);
  });
});

// ─── TransformFields ───────────────────────────────────────────
describe("TransformFields", () => {
  it("renders the requested scrubby fields + a rotation dial", () => {
    render(
      <TransformFields
        defaultValue={{ x: 10, y: 20, w: 100, h: 50, rotation: 30 }}
      />,
    );
    expect(screen.getByRole("spinbutton", { name: "x" }).getAttribute("aria-valuenow")).toBe("10");
    expect(screen.getByRole("spinbutton", { name: "y" }).getAttribute("aria-valuenow")).toBe("20");
    expect(screen.getByRole("spinbutton", { name: "w" }).getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByRole("spinbutton", { name: "h" }).getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByRole("slider", { name: "Rotation" }).getAttribute("aria-valuenow")).toBe("30");
  });

  it("emits the patch + full transform on a field change", () => {
    const onChange = vi.fn();
    render(
      <TransformFields
        defaultValue={{ x: 0, y: 0, w: 100, h: 50 }}
        lockAspect={false}
        fields={["x", "y", "w", "h"]}
        onChange={onChange}
      />,
    );
    const x = screen.getByRole("spinbutton", { name: "x" });
    fireEvent.keyDown(x, { key: "ArrowUp" }); // step 1 → x=1
    expect(onChange).toHaveBeenLastCalledWith(
      { x: 1 },
      { x: 1, y: 0, w: 100, h: 50, rotation: 0, shear: 0 },
    );
  });

  // (#183) the dial fires onChange + onChangeEnd in the same tick; an empty
  // end-patch rebuilt `full` from the pre-change snapshot and reverted it.
  it("commits the rotation dial instead of reverting it", () => {
    const onChangeEnd = vi.fn();
    render(
      <TransformFields
        defaultValue={{ x: 1, y: 2, w: 10, h: 20 }}
        onChangeEnd={onChangeEnd}
      />,
    );
    const dial = screen.getByRole("slider", { name: "Rotation" });
    fireEvent.keyDown(dial, { key: "ArrowUp" });
    expect(dial.getAttribute("aria-valuenow")).toBe("1");
    expect(onChangeEnd).toHaveBeenLastCalledWith({
      x: 1, y: 2, w: 10, h: 20, rotation: 1, shear: 0,
    });
    fireEvent.keyDown(dial, { key: "ArrowUp" });
    fireEvent.keyDown(dial, { key: "ArrowUp" });
    expect(dial.getAttribute("aria-valuenow")).toBe("3");
  });

  it("scales H proportionally when aspect is locked and W changes", () => {
    const onChange = vi.fn();
    render(
      <TransformFields
        defaultValue={{ x: 0, y: 0, w: 100, h: 50 }}
        lockAspect
        fields={["w", "h"]}
        onChange={onChange}
      />,
    );
    const w = screen.getByRole("spinbutton", { name: "w" });
    // w: 100 → 110 (ratio 1.1) ⇒ h: 50 → 55
    for (let i = 0; i < 10; i++) fireEvent.keyDown(w, { key: "ArrowUp" });
    const [patch, full] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(patch.w).toBe(110);
    expect(patch.h).toBe(55);
    expect(full.h).toBe(55);
  });

  it("exposes an aria-pressed aspect-lock toggle that flips on click (uncontrolled)", async () => {
    const user = userEvent.setup();
    render(<TransformFields defaultValue={{ w: 100, h: 50 }} fields={["w", "h"]} />);
    const lock = screen.getByRole("button", { name: "Lock aspect ratio" });
    expect(lock.getAttribute("aria-pressed")).toBe("true");
    await user.click(lock);
    expect(lock.getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onLockAspectChange and stays controlled when handled", async () => {
    const user = userEvent.setup();
    const onLockAspectChange = vi.fn();
    render(
      <TransformFields
        defaultValue={{ w: 100, h: 50 }}
        fields={["w", "h"]}
        lockAspect
        onLockAspectChange={onLockAspectChange}
      />,
    );
    const lock = screen.getByRole("button", { name: "Lock aspect ratio" });
    await user.click(lock);
    expect(onLockAspectChange).toHaveBeenCalledWith(false);
    // controlled: prop pins it true until the parent updates lockAspect
    expect(lock.getAttribute("aria-pressed")).toBe("true");
  });
});
