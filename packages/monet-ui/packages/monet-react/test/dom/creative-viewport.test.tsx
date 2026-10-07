// DOM tests for the creative viewport / canvas widgets (creative-viewport.tsx).
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
  CanvasRuler,
  ZoomControl,
  Navigator,
  Marquee,
  GridGuides,
  type ViewportRect,
} from "../../src/creative-viewport.tsx";

// ─── CanvasRuler ───────────────────────────────────────────────
describe("CanvasRuler", () => {
  it("is decorative (role=presentation) and renders labelled major ticks", () => {
    const { container } = render(
      <CanvasRuler end={400} pixelsPerUnit={1} majorEvery={100} unit="px" />,
    );
    const ruler = container.querySelector(".monet-cv-canvasruler")!;
    expect(ruler.getAttribute("role")).toBe("presentation");
    const majors = container.querySelectorAll(".monet-cv-canvasruler-tick.is-major");
    // 0, 100, 200, 300, 400
    expect(majors.length).toBe(5);
    expect(container.querySelector(".monet-cv-canvasruler-label")?.textContent).toBe("0px");
  });

  it("honors a non-zero start in the labels", () => {
    const { container } = render(
      <CanvasRuler start={100} end={300} pixelsPerUnit={1} majorEvery={100} unit="px" />,
    );
    const labels = Array.from(
      container.querySelectorAll(".monet-cv-canvasruler-label"),
    ).map((n) => n.textContent);
    expect(labels).toEqual(["100px", "200px", "300px"]);
  });

  it("falls back to the auto step when majorEvery is 0 or negative", () => {
    for (const majorEvery of [0, -1]) {
      const { container, unmount } = render(<CanvasRuler end={100} majorEvery={majorEvery} />);
      expect(container.querySelectorAll(".monet-cv-canvasruler-tick.is-major").length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("applies the vertical modifier class for a vertical edge", () => {
    const { container } = render(<CanvasRuler orientation="vertical" end={100} />);
    const ruler = container.querySelector(".monet-cv-canvasruler")!;
    expect(ruler.classList.contains("is-vertical")).toBe(true);
    expect(ruler.classList.contains("is-horizontal")).toBe(false);
  });

  it("draws a cursor line only when a cursor value is supplied", () => {
    const { container, rerender } = render(<CanvasRuler end={100} />);
    expect(container.querySelector(".monet-cv-canvasruler-cursor")).toBeNull();
    rerender(<CanvasRuler end={100} cursor={50} />);
    expect(container.querySelector(".monet-cv-canvasruler-cursor")).not.toBeNull();
  });
});

// ─── ZoomControl ───────────────────────────────────────────────
describe("ZoomControl", () => {
  it("exposes a spinbutton readout with a percent valuetext", () => {
    render(<ZoomControl defaultValue={1} />);
    const sb = screen.getByRole("spinbutton", { name: "Zoom" });
    expect(sb.textContent).toBe("100%");
    expect(sb.getAttribute("aria-valuenow")).toBe("100");
    expect(sb.getAttribute("aria-valuetext")).toBe("100%");
  });

  it("− / + buttons scale the zoom multiplicatively and fire onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ZoomControl defaultValue={1} step={2} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onChange).toHaveBeenLastCalledWith(2);
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("Arrow keys nudge the readout and Home/End jump to the bounds", () => {
    const onChange = vi.fn();
    render(
      <ZoomControl defaultValue={1} step={2} min={0.25} max={8} onChange={onChange} />,
    );
    const sb = screen.getByRole("spinbutton", { name: "Zoom" });
    fireEvent.keyDown(sb, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(sb, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(8);
    fireEvent.keyDown(sb, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0.25);
  });

  it("clamps at min/max and disables the buttons at the bounds", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ZoomControl defaultValue={8} step={2} min={0.25} max={8} onChange={onChange} />);
    const zin = screen.getByRole("button", { name: "Zoom in" });
    expect((zin as HTMLButtonElement).disabled).toBe(true);
    // out still works
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it("renders a Fit button only when onFit is supplied", async () => {
    const user = userEvent.setup();
    const onFit = vi.fn();
    const { rerender } = render(<ZoomControl defaultValue={1} />);
    expect(screen.queryByRole("button", { name: "Zoom to fit" })).toBeNull();
    rerender(<ZoomControl defaultValue={1} onFit={onFit} />);
    await user.click(screen.getByRole("button", { name: "Zoom to fit" }));
    expect(onFit).toHaveBeenCalled();
  });

  it("offers presets via a Select that commits the chosen zoom", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ZoomControl defaultValue={1} presets={[0.5, 1, 2]} onChange={onChange} />);
    await user.click(screen.getByRole("combobox", { name: "Zoom presets" }));
    await user.click(screen.getByRole("option", { name: "200%" }));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("supports a controlled zoom via a host", () => {
    function Host() {
      const [z, setZ] = useState(1);
      return <ZoomControl value={z} step={2} max={8} onChange={setZ} />;
    }
    render(<Host />);
    const sb = screen.getByRole("spinbutton", { name: "Zoom" });
    fireEvent.keyDown(sb, { key: "ArrowUp" });
    expect(sb.textContent).toBe("200%");
  });
});

// ─── Navigator ─────────────────────────────────────────────────
describe("Navigator", () => {
  it("renders a preview (role=img) and a draggable viewport slider", () => {
    render(<Navigator defaultViewport={{ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }} />);
    expect(screen.getByRole("img", { name: "Document preview" })).not.toBeNull();
    const marquee = screen.getByRole("slider", { name: "Viewport" });
    expect(marquee.getAttribute("aria-valuemin")).toBe("0");
    expect(marquee.getAttribute("aria-valuemax")).toBe("100");
  });

  it("Arrow keys pan the viewport (clamped inside 0..1) and fire onViewportChange", () => {
    const onViewportChange = vi.fn();
    render(
      <Navigator
        defaultViewport={{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }}
        onViewportChange={onViewportChange}
      />,
    );
    const marquee = screen.getByRole("slider", { name: "Viewport" });
    fireEvent.keyDown(marquee, { key: "ArrowRight" });
    const r1 = onViewportChange.mock.calls.at(-1)![0] as ViewportRect;
    expect(r1.x).toBeCloseTo(0.42, 5);
    // End jumps to the far edge but clamps so the rect stays inside (x ≤ 1 - w)
    fireEvent.keyDown(marquee, { key: "End" });
    const r2 = onViewportChange.mock.calls.at(-1)![0] as ViewportRect;
    expect(r2.x).toBeCloseTo(0.8, 5);
    expect(r2.y).toBeCloseTo(0.8, 5);
    // Home jumps to the origin
    fireEvent.keyDown(marquee, { key: "Home" });
    const r3 = onViewportChange.mock.calls.at(-1)![0] as ViewportRect;
    expect(r3.x).toBe(0);
    expect(r3.y).toBe(0);
  });

  it("dragging the marquee fires onViewportChange (geometry-independent)", () => {
    const onViewportChange = vi.fn();
    render(
      <Navigator
        defaultViewport={{ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }}
        onViewportChange={onViewportChange}
      />,
    );
    const marquee = screen.getByRole("slider", { name: "Viewport" });
    fireEvent.pointerDown(marquee, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 12 });
    fireEvent.pointerUp(window);
    expect(onViewportChange).toHaveBeenCalled();
  });

  it("renders a zoom row when zoom controls are supplied", () => {
    const onZoomChange = vi.fn();
    const { container } = render(
      <Navigator zoom={2} onZoomChange={onZoomChange} />,
    );
    expect(container.querySelector(".monet-cv-navigator-zoom")?.textContent).toContain("200%");
    expect(screen.getByRole("slider", { name: "Zoom" })).not.toBeNull();
  });

  it("supports a controlled viewport via a host", () => {
    function Host() {
      const [vp, setVp] = useState<ViewportRect>({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 });
      return <Navigator viewport={vp} onViewportChange={setVp} />;
    }
    render(<Host />);
    const marquee = screen.getByRole("slider", { name: "Viewport" });
    fireEvent.keyDown(marquee, { key: "Home" });
    // centre of a 0.2-wide rect placed at origin → 10%
    expect(marquee.getAttribute("aria-valuenow")).toBe("10");
  });
});

// ─── Marquee ───────────────────────────────────────────────────
describe("Marquee", () => {
  it("is decorative and toggles the marching class", () => {
    const { container, rerender } = render(
      <Marquee rect={{ x: 0, y: 0, w: 10, h: 10 }} />,
    );
    const m = container.querySelector(".monet-cv-marquee")!;
    expect(m.getAttribute("role")).toBe("presentation");
    expect(m.classList.contains("is-marching")).toBe(true);
    rerender(<Marquee rect={{ x: 0, y: 0, w: 10, h: 10 }} marching={false} />);
    expect(
      container.querySelector(".monet-cv-marquee")!.classList.contains("is-marching"),
    ).toBe(false);
  });

  it("positions in px by default and in % when requested", () => {
    const { container, rerender } = render(
      <Marquee rect={{ x: 4, y: 6, w: 20, h: 30 }} />,
    );
    let m = container.querySelector(".monet-cv-marquee") as HTMLElement;
    expect(m.style.left).toBe("4px");
    expect(m.style.width).toBe("20px");
    rerender(<Marquee rect={{ x: 4, y: 6, w: 20, h: 30 }} percent />);
    m = container.querySelector(".monet-cv-marquee") as HTMLElement;
    expect(m.style.left).toBe("4%");
    expect(m.style.height).toBe("30%");
  });

  it("renders an optional corner label", () => {
    const { container } = render(
      <Marquee rect={{ x: 0, y: 0, w: 10, h: 10 }} label="120 × 80" />,
    );
    expect(container.querySelector(".monet-cv-marquee-label")?.textContent).toBe("120 × 80");
  });
});

// ─── GridGuides ────────────────────────────────────────────────
describe("GridGuides", () => {
  it("is aria-hidden and exposes the grid size as a custom prop", () => {
    const { container } = render(<GridGuides gridSize={24} />);
    const overlay = container.querySelector(".monet-cv-gridguides") as HTMLElement;
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.classList.contains("has-grid")).toBe(true);
    expect(overlay.style.getPropertyValue("--grid")).toBe("24px");
  });

  it("adds the subdivision class + custom prop when subdivisions are set", () => {
    const { container } = render(<GridGuides gridSize={20} subdivisions={3} />);
    const overlay = container.querySelector(".monet-cv-gridguides") as HTMLElement;
    expect(overlay.classList.contains("has-sub")).toBe(true);
    expect(overlay.style.getPropertyValue("--grid-sub")).toBe("5px");
  });

  it("renders an x/y guide line per guide", () => {
    const { container } = render(
      <GridGuides
        guides={[
          { axis: "x", pos: 40 },
          { axis: "y", pos: 80 },
        ]}
      />,
    );
    const lines = container.querySelectorAll(".monet-cv-gridguides-line");
    expect(lines.length).toBe(2);
    expect((lines[0] as HTMLElement).classList.contains("is-x")).toBe(true);
    expect((lines[0] as HTMLElement).style.left).toBe("40px");
    expect((lines[1] as HTMLElement).classList.contains("is-y")).toBe(true);
    expect((lines[1] as HTMLElement).style.top).toBe("80px");
  });

  it("omits the grid background when showGrid is false", () => {
    const { container } = render(<GridGuides showGrid={false} />);
    const overlay = container.querySelector(".monet-cv-gridguides")!;
    expect(overlay.classList.contains("has-grid")).toBe(false);
  });

  it("hides guide lines when showGuides is false", () => {
    const { container } = render(
      <GridGuides showGuides={false} guides={[{ axis: "x", pos: 10 }]} />,
    );
    expect(container.querySelector(".monet-cv-gridguides-line")).toBeNull();
  });
});
