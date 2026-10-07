// DOM tests for the creative curve editors (creative-curve.tsx). jsdom has no
// layout — these assert ROLES, ARIA, state, and callbacks. Drag paths fire
// pointer events and assert onChange fired (never exact geometry); keyboard
// paths are geometry-independent so exact values are asserted. The points/handles
// are SVG <circle>s (role="slider"); the SVG root is role="group".
// No jest-dom: assertions read DOM properties/attributes directly.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

import {
  CurveEditor,
  EasingCurve,
  type CurvePoint,
  type Bezier,
} from "../../src/creative-curve.tsx";

const PTS: CurvePoint[] = [
  { id: "a", x: 0, y: 0.25 },
  { id: "b", x: 0.5, y: 0.5 },
  { id: "c", x: 1, y: 0.75 },
];

// ─── CurveEditor ───────────────────────────────────────────────
describe("CurveEditor", () => {
  it("renders a group containing one slider <circle> per point, with a path", () => {
    const { container } = render(
      <CurveEditor aria-label="eq" defaultPoints={PTS} />,
    );
    const group = screen.getByRole("group", { name: "eq" });
    const sliders = within(group).getAllByRole("slider");
    expect(sliders).toHaveLength(3);
    sliders.forEach((s) => expect(s.tagName.toLowerCase()).toBe("circle"));
    expect(container.querySelector(".monet-cv-curve-path")).not.toBeNull();
  });

  it("maps the point's value into aria-valuetext using xRange/yRange", () => {
    render(
      <CurveEditor
        aria-label="eq"
        defaultPoints={[{ id: "m", x: 0.5, y: 0.5 }, { id: "e", x: 1, y: 1 }]}
        xRange={[0, 100]}
        yRange={[-12, 12]}
      />,
    );
    // x: 0.5 of [0,100] = 50; y: 0.5 of [-12,12] = 0
    const mid = screen.getByRole("slider", { name: "Point 50" });
    expect(mid.getAttribute("aria-valuetext")).toBe("50, 0");
    expect(mid.getAttribute("aria-valuenow")).toBe("0");
    expect(mid.getAttribute("aria-valuemin")).toBe("-12");
    expect(mid.getAttribute("aria-valuemax")).toBe("12");
  });

  it("maps a log x-scale into the readout", () => {
    render(
      <CurveEditor
        aria-label="eq"
        defaultPoints={[{ id: "lo", x: 0, y: 0.5 }, { id: "hi", x: 1, y: 0.5 }]}
        xRange={[20, 20000]}
        xScale="log"
      />,
    );
    // log endpoints map exactly to the bounds
    expect(screen.getByRole("slider", { name: "Point 20" })).not.toBeNull();
    expect(screen.getByRole("slider", { name: "Point 20000" })).not.toBeNull();
  });

  it("Arrow keys move a point and fire onChange + onChangeEnd (immutably)", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <CurveEditor
        aria-label="eq"
        defaultPoints={[{ id: "m", x: 0.5, y: 0.5 }, { id: "e", x: 1, y: 0.5 }]}
        yRange={[0, 1]}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />,
    );
    const mid = screen.getByRole("slider", { name: "Point 0.50" });
    fireEvent.keyDown(mid, { key: "ArrowUp" }); // y: 0.5 → 0.51
    const next = onChange.mock.calls.at(-1)![0] as CurvePoint[];
    expect(next.find((p) => p.id === "m")!.y).toBeCloseTo(0.51, 5);
    expect(onChangeEnd).toHaveBeenCalled();
    // immutable: a new array instance is emitted
    expect(next).not.toBe(PTS);
  });

  it("clamps a point's y to [0,1] on keyboard nudge", () => {
    const onChange = vi.fn();
    render(
      <CurveEditor
        aria-label="eq"
        defaultPoints={[{ id: "m", x: 0.5, y: 1 }, { id: "e", x: 1, y: 0.5 }]}
        onChange={onChange}
      />,
    );
    const mid = screen.getByRole("slider", { name: "Point 0.50" });
    fireEvent.keyDown(mid, { key: "ArrowUp" }); // 1 + 0.01 → clamp 1
    const next = onChange.mock.calls.at(-1)![0] as CurvePoint[];
    expect(next.find((p) => p.id === "m")!.y).toBe(1);
  });

  it("dragging a point fires onChange (geometry-independent: just fired)", () => {
    const onChange = vi.fn();
    render(<CurveEditor aria-label="eq" defaultPoints={PTS} onChange={onChange} />);
    const b = screen.getByRole("slider", { name: "Point 0.50" });
    fireEvent.pointerDown(b, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 40 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  it("clicking the background adds an interpolated point", () => {
    const onChange = vi.fn();
    render(<CurveEditor aria-label="eq" defaultPoints={PTS} onChange={onChange} />);
    const svg = screen.getByRole("group", { name: "eq" });
    fireEvent.pointerDown(svg, { button: 0, clientX: 30, clientY: 30 });
    const next = onChange.mock.calls.at(-1)![0] as CurvePoint[];
    expect(next.length).toBe(4);
  });

  it("double-clicking a point removes it (min 2 kept)", () => {
    const onChange = vi.fn();
    render(<CurveEditor aria-label="eq" defaultPoints={PTS} onChange={onChange} />);
    const b = screen.getByRole("slider", { name: "Point 0.50" });
    fireEvent.doubleClick(b);
    const next = onChange.mock.calls.at(-1)![0] as CurvePoint[];
    expect(next.length).toBe(2);
    expect(next.find((p) => p.id === "b")).toBeUndefined();
  });

  it("Delete on a focused point removes it", () => {
    const onChange = vi.fn();
    render(<CurveEditor aria-label="eq" defaultPoints={PTS} onChange={onChange} />);
    const b = screen.getByRole("slider", { name: "Point 0.50" });
    fireEvent.keyDown(b, { key: "Delete" });
    const next = onChange.mock.calls.at(-1)![0] as CurvePoint[];
    expect(next.length).toBe(2);
  });

  it("does not remove a point when only two remain", () => {
    const onChange = vi.fn();
    render(
      <CurveEditor
        aria-label="eq"
        defaultPoints={[{ id: "a", x: 0, y: 0.5 }, { id: "b", x: 1, y: 0.5 }]}
        onChange={onChange}
      />,
    );
    const a = screen.getByRole("slider", { name: "Point 0" });
    fireEvent.doubleClick(a);
    // emit never fired a 1-point array
    if (onChange.mock.calls.length) {
      const next = onChange.mock.calls.at(-1)![0] as CurvePoint[];
      expect(next.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("is read-only when editable=false (points not focusable, no add/remove)", () => {
    const onChange = vi.fn();
    render(
      <CurveEditor aria-label="eq" defaultPoints={PTS} editable={false} onChange={onChange} />,
    );
    const sliders = screen.getAllByRole("slider");
    sliders.forEach((s) => expect(s.getAttribute("tabindex")).toBe("-1"));
    fireEvent.keyDown(sliders[1], { key: "ArrowUp" });
    const svg = screen.getByRole("group", { name: "eq" });
    fireEvent.pointerDown(svg, { button: 0, clientX: 30, clientY: 30 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("omits the fill path when fill=false", () => {
    const { container } = render(
      <CurveEditor aria-label="eq" defaultPoints={PTS} fill={false} />,
    );
    expect(container.querySelector(".monet-cv-curve-fill")).toBeNull();
  });

  it("supports controlled points", () => {
    function Host() {
      const [pts, setPts] = useState<CurvePoint[]>([
        { id: "m", x: 0.5, y: 0.5 },
        { id: "e", x: 1, y: 0.5 },
      ]);
      return <CurveEditor aria-label="eq" points={pts} onChange={setPts} />;
    }
    render(<Host />);
    const mid = screen.getByRole("slider", { name: "Point 0.50" });
    fireEvent.keyDown(mid, { key: "ArrowUp" });
    expect(mid.getAttribute("aria-valuenow")).toBe("0.51");
  });

  it("renders a per-point color via the --point-color custom prop", () => {
    const { container } = render(
      <CurveEditor
        aria-label="eq"
        defaultPoints={[{ id: "a", x: 0, y: 0.5, color: "#ff0000" }, { id: "b", x: 1, y: 0.5 }]}
      />,
    );
    const colored = container.querySelector(".monet-cv-curve-point") as SVGCircleElement;
    expect(colored.getAttribute("style") || "").toContain("--point-color");
  });

  it("a bare click on a point does not commit anything (#202)", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <CurveEditor
        aria-label="eq"
        defaultPoints={PTS}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />,
    );
    const mid = screen.getAllByRole("slider")[1];
    fireEvent.pointerDown(mid, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window); // selection gesture, no move
    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeEnd).not.toHaveBeenCalled();
  });
});

// ─── EasingCurve ───────────────────────────────────────────────
describe("EasingCurve", () => {
  it("renders a group with two control-point sliders and a path", () => {
    const { container } = render(
      <EasingCurve aria-label="ease" defaultValue={[0.42, 0, 0.58, 1]} />,
    );
    const group = screen.getByRole("group", { name: "ease" });
    const c1 = within(group).getByRole("slider", { name: "Control point 1" });
    const c2 = within(group).getByRole("slider", { name: "Control point 2" });
    expect(c1.getAttribute("aria-valuetext")).toBe("0.42, 0");
    expect(c2.getAttribute("aria-valuetext")).toBe("0.58, 1");
    expect(container.querySelector(".monet-cv-curve-path")).not.toBeNull();
  });

  it("defaults its aria-label to 'Easing curve'", () => {
    render(<EasingCurve />);
    expect(screen.getByRole("group", { name: "Easing curve" })).not.toBeNull();
  });

  it("Arrow keys move a handle and fire onChange + onChangeEnd", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <EasingCurve
        aria-label="ease"
        defaultValue={[0.4, 0.2, 0.6, 0.8]}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />,
    );
    const c1 = screen.getByRole("slider", { name: "Control point 1" });
    fireEvent.keyDown(c1, { key: "ArrowRight" }); // x1: 0.4 → 0.41
    const next = onChange.mock.calls.at(-1)![0] as Bezier;
    expect(next[0]).toBeCloseTo(0.41, 5);
    expect(onChangeEnd).toHaveBeenCalled();
  });

  it("clamps a handle's x to [0,1] (CSS cubic-bezier constraint)", () => {
    const onChange = vi.fn();
    render(
      <EasingCurve aria-label="ease" defaultValue={[1, 0, 0.58, 1]} onChange={onChange} />,
    );
    const c1 = screen.getByRole("slider", { name: "Control point 1" });
    fireEvent.keyDown(c1, { key: "ArrowRight" }); // 1 + 0.01 → clamp 1
    const next = onChange.mock.calls.at(-1)![0] as Bezier;
    expect(next[0]).toBe(1);
  });

  it("leaves y unclamped — CSS allows overshoot (#197)", () => {
    const onChange = vi.fn();
    render(
      <EasingCurve aria-label="ease" value={[0.42, 1.4, 0.58, 1]} onChange={onChange} />,
    );
    const c1 = screen.getByRole("slider", { name: "Control point 1" });
    fireEvent.keyDown(c1, { key: "ArrowRight" }); // x-only edit
    // the controlled y=1.4 (a spring-like overshoot) must survive it
    expect(onChange.mock.calls.at(-1)![0]).toEqual([0.43, 1.4, 0.58, 1]);
    fireEvent.keyDown(c1, { key: "ArrowUp" }); // and y can still climb past 1
    expect((onChange.mock.calls.at(-1)![0] as Bezier)[1]).toBeCloseTo(1.41, 5);
  });

  it("a bare click on a handle does not commit anything (#202)", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <EasingCurve
        aria-label="ease"
        defaultValue={[0.42, 0, 0.58, 1]}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />,
    );
    const c1 = screen.getByRole("slider", { name: "Control point 1" });
    fireEvent.pointerDown(c1, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(window); // no move → focus gesture only
    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeEnd).not.toHaveBeenCalled();
  });

  it("Home/End jump a handle's x to 0 / 1", () => {
    const onChange = vi.fn();
    render(
      <EasingCurve aria-label="ease" defaultValue={[0.42, 0, 0.58, 1]} onChange={onChange} />,
    );
    const c2 = screen.getByRole("slider", { name: "Control point 2" });
    fireEvent.keyDown(c2, { key: "Home" });
    expect((onChange.mock.calls.at(-1)![0] as Bezier)[2]).toBe(0);
    fireEvent.keyDown(c2, { key: "End" });
    expect((onChange.mock.calls.at(-1)![0] as Bezier)[2]).toBe(1);
  });

  it("dragging a handle fires onChange (geometry-independent: just fired)", () => {
    const onChange = vi.fn();
    render(<EasingCurve aria-label="ease" defaultValue={[0.42, 0, 0.58, 1]} onChange={onChange} />);
    const c1 = screen.getByRole("slider", { name: "Control point 1" });
    fireEvent.pointerDown(c1, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 10 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  it("renders preset chips and selecting one sets the curve", () => {
    const onChange = vi.fn();
    render(
      <EasingCurve
        aria-label="ease"
        defaultValue={[0.42, 0, 0.58, 1]}
        presets={["ease-in", "ease-out", "ease-in-out"]}
        onChange={onChange}
      />,
    );
    // SegmentedControl renders the presets as role=radio
    const easeIn = screen.getByRole("radio", { name: "ease-in" });
    fireEvent.click(easeIn);
    expect(onChange).toHaveBeenLastCalledWith([0.42, 0, 1, 1]);
  });

  it("marks the matching preset chip as checked", () => {
    render(
      <EasingCurve
        aria-label="ease"
        defaultValue={[0.42, 0, 0.58, 1]} // = ease-in-out
        presets={["ease-in", "ease-out", "ease-in-out"]}
      />,
    );
    const inOut = screen.getByRole("radio", { name: "ease-in-out" });
    expect(inOut.getAttribute("aria-checked")).toBe("true");
  });

  it("unchecks every chip once the curve leaves the preset (#194)", () => {
    // Regression: `value={matchPreset(...)}` went undefined off-preset, which
    // SegmentedControl read as "uncontrolled" and answered with its own stale
    // internal state — the strip then claimed a preset the curve was not.
    render(
      <EasingCurve
        aria-label="ease"
        defaultValue={[0.42, 0, 0.58, 1]} // = ease-in-out
        presets={["ease-in", "ease-out", "ease-in-out"]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("slider", { name: "Control point 1" }), {
      key: "ArrowRight",
    }); // → [0.43, 0, 0.58, 1]: no preset matches
    screen
      .getAllByRole("radio")
      .forEach((chip) => expect(chip.getAttribute("aria-checked")).toBe("false"));
  });

  it("omits the preset control when presets is empty", () => {
    render(<EasingCurve aria-label="ease" presets={[]} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("supports controlled value", () => {
    function Host() {
      const [b, setB] = useState<Bezier>([0.42, 0, 0.58, 1]);
      return <EasingCurve aria-label="ease" value={b} onChange={setB} />;
    }
    render(<Host />);
    const c2 = screen.getByRole("slider", { name: "Control point 2" });
    // (#197) y is NOT clamped: cubic-bezier() allows overshoot, so 1 → 1.01
    fireEvent.keyDown(c2, { key: "ArrowUp" });
    fireEvent.keyDown(c2, { key: "ArrowLeft" }); // x2: 0.58 → 0.57
    expect(c2.getAttribute("aria-valuetext")).toBe("0.57, 1.01");
  });
});
