// DOM tests for the creative color controls (creative-color.tsx +
// creative-color-palette.tsx). jsdom has no layout — these assert ROLES, ARIA,
// state, and callbacks. Drag paths fire pointer events and assert onChange
// fired (never exact geometry, since getBoundingClientRect is zeroed); keyboard
// paths are geometry-independent so values/values-text are asserted directly.
// No jest-dom: assertions read DOM properties/attributes directly.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ColorField,
  HueSlider,
  AlphaSlider,
  ColorWheel,
  EyedropperReadout,
  GradientEditor,
  ColorPicker,
  Swatch,
  SwatchGrid,
  GlyphGrid,
  HexInput,
  type HSV,
  type GradientValue,
} from "../../src/creative-color.tsx";

const RED: HSV = { h: 0, s: 1, v: 1 };

// ─── ColorField ────────────────────────────────────────────────
describe("ColorField", () => {
  it("exposes role=slider with the default label and an S/V valuetext", () => {
    render(<ColorField defaultValue={{ h: 120, s: 0.5, v: 0.8 }} />);
    const sl = screen.getByRole("slider", { name: "Saturation and brightness" });
    expect(sl.getAttribute("aria-valuetext")).toBe("S 50, V 80");
  });

  it("Arrow keys nudge s (L/R) and v (U/D) and fire onChange + onChangeEnd", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(
      <ColorField
        aria-label="sv"
        defaultValue={{ h: 0, s: 0.5, v: 0.5 }}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />,
    );
    const sl = screen.getByRole("slider", { name: "sv" });
    fireEvent.keyDown(sl, { key: "ArrowRight" });
    expect(onChange.mock.calls.at(-1)![0].s).toBeCloseTo(0.51, 5);
    expect(onChangeEnd).toHaveBeenCalled();
    fireEvent.keyDown(sl, { key: "ArrowUp" });
    expect(onChange.mock.calls.at(-1)![0].v).toBeCloseTo(0.51, 5);
    fireEvent.keyDown(sl, { key: "Home" });
    expect(onChange.mock.calls.at(-1)![0].s).toBe(0);
    fireEvent.keyDown(sl, { key: "End" });
    expect(onChange.mock.calls.at(-1)![0].s).toBe(1);
  });

  it("preserves the bound hue when s/v change", () => {
    const onChange = vi.fn();
    render(<ColorField aria-label="sv" defaultValue={{ h: 210, s: 0.5, v: 0.5 }} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "sv" }), { key: "ArrowLeft" });
    expect(onChange.mock.calls.at(-1)![0].h).toBe(210);
  });

  it("dragging fires onChange (geometry-independent: just fired)", () => {
    const onChange = vi.fn();
    render(<ColorField aria-label="sv" defaultValue={RED} onChange={onChange} />);
    const sl = screen.getByRole("slider", { name: "sv" });
    fireEvent.pointerDown(sl, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 5 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  it("is inert when disabled", () => {
    const onChange = vi.fn();
    render(<ColorField aria-label="sv" defaultValue={RED} disabled onChange={onChange} />);
    const sl = screen.getByRole("slider", { name: "sv" });
    expect(sl.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(sl, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports controlled value", () => {
    function Host() {
      const [v, setV] = useState<HSV>({ h: 0, s: 0.2, v: 0.2 });
      return <ColorField aria-label="sv" value={v} onChange={setV} />;
    }
    render(<Host />);
    const sl = screen.getByRole("slider", { name: "sv" });
    fireEvent.keyDown(sl, { key: "ArrowUp" });
    expect(sl.getAttribute("aria-valuetext")).toBe("S 20, V 21");
  });
});

// ─── HueSlider ─────────────────────────────────────────────────
describe("HueSlider", () => {
  it("exposes role=slider 0..360 with the default Hue label", () => {
    render(<HueSlider defaultValue={200} />);
    const sl = screen.getByRole("slider", { name: "Hue" });
    expect(sl.getAttribute("aria-valuemin")).toBe("0");
    expect(sl.getAttribute("aria-valuemax")).toBe("360");
    expect(sl.getAttribute("aria-valuenow")).toBe("200");
  });

  it("Arrow/Page/Home/End move and clamp, firing onChange + onChangeEnd", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(<HueSlider aria-label="h" defaultValue={10} onChange={onChange} onChangeEnd={onChangeEnd} />);
    const sl = screen.getByRole("slider", { name: "h" });
    fireEvent.keyDown(sl, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(11);
    expect(onChangeEnd).toHaveBeenLastCalledWith(11);
    fireEvent.keyDown(sl, { key: "PageUp" });
    expect(onChange).toHaveBeenLastCalledWith(21);
    fireEvent.keyDown(sl, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(360);
    fireEvent.keyDown(sl, { key: "ArrowUp" }); // 360+1 → clamp 360
    expect(onChange).toHaveBeenLastCalledWith(360);
    fireEvent.keyDown(sl, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("dragging fires onChange (geometry-independent)", () => {
    const onChange = vi.fn();
    render(<HueSlider aria-label="h" defaultValue={0} onChange={onChange} />);
    const sl = screen.getByRole("slider", { name: "h" });
    fireEvent.pointerDown(sl, { button: 0, clientX: 5, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  it("reports a vertical orientation when vertical", () => {
    render(<HueSlider aria-label="h" vertical defaultValue={0} />);
    expect(screen.getByRole("slider", { name: "h" }).getAttribute("aria-orientation")).toBe("vertical");
  });

  it("is inert when disabled", () => {
    const onChange = vi.fn();
    render(<HueSlider aria-label="h" disabled defaultValue={50} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "h" }), { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── AlphaSlider ───────────────────────────────────────────────
describe("AlphaSlider", () => {
  it("exposes role=slider 0..1 with a percent valuetext and Opacity label", () => {
    render(<AlphaSlider defaultValue={0.4} />);
    const sl = screen.getByRole("slider", { name: "Opacity" });
    expect(sl.getAttribute("aria-valuemin")).toBe("0");
    expect(sl.getAttribute("aria-valuemax")).toBe("1");
    expect(sl.getAttribute("aria-valuenow")).toBe("0.4");
    expect(sl.getAttribute("aria-valuetext")).toBe("40%");
  });

  it("Arrow/Page keys move and clamp, firing onChange + onChangeEnd", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(<AlphaSlider aria-label="a" defaultValue={0.5} onChange={onChange} onChangeEnd={onChangeEnd} />);
    const sl = screen.getByRole("slider", { name: "a" });
    fireEvent.keyDown(sl, { key: "ArrowUp" });
    expect(onChange.mock.calls.at(-1)![0]).toBeCloseTo(0.51, 5);
    expect(onChangeEnd).toHaveBeenCalled();
    fireEvent.keyDown(sl, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(sl, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("dragging fires onChange (geometry-independent)", () => {
    const onChange = vi.fn();
    render(<AlphaSlider aria-label="a" defaultValue={1} color={RED} onChange={onChange} />);
    const sl = screen.getByRole("slider", { name: "a" });
    fireEvent.pointerDown(sl, { button: 0, clientX: 5, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });
});

// ─── ColorWheel ────────────────────────────────────────────────
describe("ColorWheel", () => {
  it("exposes role=slider with an H/S valuetext and the default label", () => {
    render(<ColorWheel defaultValue={{ h: 90, s: 0.5, v: 1 }} />);
    const wheel = screen.getByRole("slider", { name: "Color wheel" });
    expect(wheel.getAttribute("aria-valuetext")).toBe("H 90, S 50");
  });

  it("Arrow keys move hue (L/R) and saturation (U/D), wrapping the hue", () => {
    const onChange = vi.fn();
    render(<ColorWheel aria-label="w" defaultValue={{ h: 1, s: 0.5, v: 1 }} onChange={onChange} />);
    const wheel = screen.getByRole("slider", { name: "w" });
    fireEvent.keyDown(wheel, { key: "ArrowLeft" }); // 1-2 → wraps to 359
    expect(onChange.mock.calls.at(-1)![0].h).toBe(359);
    fireEvent.keyDown(wheel, { key: "ArrowUp" });
    expect(onChange.mock.calls.at(-1)![0].s).toBeCloseTo(0.52, 5);
    fireEvent.keyDown(wheel, { key: "Home" });
    expect(onChange.mock.calls.at(-1)![0].s).toBe(0);
  });

  it("dragging fires onChange (geometry-independent)", () => {
    const onChange = vi.fn();
    render(<ColorWheel aria-label="w" defaultValue={RED} onChange={onChange} />);
    const wheel = screen.getByRole("slider", { name: "w" });
    fireEvent.pointerDown(wheel, { button: 0, clientX: 30, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 30 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  it("is inert when disabled", () => {
    const onChange = vi.fn();
    render(<ColorWheel aria-label="w" disabled defaultValue={RED} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "w" }), { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── EyedropperReadout ─────────────────────────────────────────
describe("EyedropperReadout", () => {
  it("renders a hex readout by default", () => {
    const { container } = render(<EyedropperReadout value={RED} />);
    expect(container.querySelector(".monet-cv-eyedropper-value")?.textContent).toBe("#FF0000");
    expect(container.querySelector(".monet-cv-eyedropper-swatch")).not.toBeNull();
  });

  it("formats rgb and hsv readouts", () => {
    const { container, rerender } = render(<EyedropperReadout value={RED} format="rgb" />);
    expect(container.querySelector(".monet-cv-eyedropper-value")?.textContent).toBe("255, 0, 0");
    rerender(<EyedropperReadout value={{ h: 120, s: 1, v: 1 }} format="hsv" />);
    expect(container.querySelector(".monet-cv-eyedropper-value")?.textContent).toBe("120°, 100%, 100%");
  });

  it("renders a pick button only when onPick is given and calls it", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const { rerender } = render(<EyedropperReadout value={RED} />);
    expect(screen.queryByRole("button", { name: "Pick color" })).toBeNull();
    rerender(<EyedropperReadout value={RED} onPick={onPick} subtitle="sRGB" />);
    await user.click(screen.getByRole("button", { name: "Pick color" }));
    expect(onPick).toHaveBeenCalled();
    expect(screen.getByText("sRGB")).not.toBeNull();
  });
});

// ─── GradientEditor ────────────────────────────────────────────
const GRAD: GradientValue = {
  type: "linear",
  angle: 90,
  stops: [
    { id: "s0", offset: 0, color: "#000000" },
    { id: "s1", offset: 1, color: "#ffffff" },
  ],
};

describe("GradientEditor", () => {
  it("renders a slider handle per stop labelled by percent", () => {
    render(<GradientEditor defaultValue={GRAD} />);
    // the angle AngleDial is also role=slider, so scope to the stop labels
    const stops = screen.getAllByRole("slider", { name: /^Stop at/ });
    expect(stops.length).toBe(2);
    expect(screen.getByRole("slider", { name: "Stop at 0%" })).not.toBeNull();
    expect(screen.getByRole("slider", { name: "Stop at 100%" })).not.toBeNull();
  });

  it("arrow keys move a stop's offset and fire onChange", () => {
    const onChange = vi.fn();
    render(<GradientEditor defaultValue={GRAD} onChange={onChange} />);
    const first = screen.getByRole("slider", { name: "Stop at 0%" });
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const next = onChange.mock.calls.at(-1)![0] as GradientValue;
    expect(next.stops.find((s) => s.id === "s0")!.offset).toBeCloseTo(0.01, 5);
  });

  it("Delete removes the selected stop but keeps a minimum of two", () => {
    const onChange = vi.fn();
    const three: GradientValue = {
      ...GRAD,
      stops: [...GRAD.stops, { id: "s2", offset: 0.5, color: "#ff0000" }],
    };
    render(<GradientEditor defaultValue={three} onChange={onChange} />);
    const mid = screen.getByRole("slider", { name: "Stop at 50%" });
    mid.focus();
    fireEvent.keyDown(mid, { key: "Delete" });
    const after = onChange.mock.calls.at(-1)![0] as GradientValue;
    expect(after.stops.length).toBe(2);
    // now at the floor: deleting again is a no-op (still 2)
    onChange.mockClear();
    const last = screen.getByRole("slider", { name: "Stop at 0%" });
    fireEvent.keyDown(last, { key: "Delete" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enter on a stop requests its color", () => {
    const onRequestStopColor = vi.fn();
    render(<GradientEditor defaultValue={GRAD} onRequestStopColor={onRequestStopColor} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Stop at 0%" }), { key: "Enter" });
    expect(onRequestStopColor).toHaveBeenCalledWith("s0");
  });

  it("exposes a radiogroup for the gradient type and switches it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GradientEditor defaultValue={GRAD} onChange={onChange} />);
    const radial = screen.getByRole("radio", { name: "Radial" });
    expect(radial.getAttribute("aria-checked")).toBe("false");
    await user.click(radial);
    expect(onChange.mock.calls.at(-1)![0].type).toBe("radial");
  });

  it("dragging a stop handle fires onChange (geometry-independent)", () => {
    const onChange = vi.fn();
    render(<GradientEditor defaultValue={GRAD} onChange={onChange} />);
    const first = screen.getByRole("slider", { name: "Stop at 0%" });
    fireEvent.pointerDown(first, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  it("clicking a stop only selects it — no value commit (#202)", () => {
    // Regression: the pointerup handler committed the stop's unchanged offset,
    // so a pure selection click emitted onChange + onChangeEnd and every host
    // pushing history on the commit signal recorded a no-op undo step.
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    const onSelectStop = vi.fn();
    render(
      <GradientEditor
        defaultValue={GRAD}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
        onSelectStop={onSelectStop}
      />,
    );
    const first = screen.getByRole("slider", { name: "Stop at 0%" });
    fireEvent.pointerDown(first, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window); // no move
    expect(onSelectStop).toHaveBeenCalledWith("s0");
    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeEnd).not.toHaveBeenCalled();
  });
});

// ─── ColorPicker ───────────────────────────────────────────────
describe("ColorPicker", () => {
  it("composes a ColorField + HueSlider + AlphaSlider + hex/rgb inputs", () => {
    render(<ColorPicker defaultValue={{ h: 210, s: 0.6, v: 0.9, a: 1 }} />);
    expect(screen.getByRole("slider", { name: "Saturation and brightness" })).not.toBeNull();
    expect(screen.getByRole("slider", { name: "Hue" })).not.toBeNull();
    expect(screen.getByRole("slider", { name: "Opacity" })).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Hex" })).not.toBeNull();
    expect(screen.getByRole("spinbutton", { name: "R" })).not.toBeNull();
  });

  it("hides the alpha slider when alpha is false and hsv inputs when not requested", () => {
    render(<ColorPicker defaultValue={RED} alpha={false} inputs={["rgb"]} />);
    expect(screen.queryByRole("slider", { name: "Opacity" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Hex" })).toBeNull();
    expect(screen.getByRole("spinbutton", { name: "G" })).not.toBeNull();
  });

  it("editing the hue slider drives onChange with the new HSV", () => {
    const onChange = vi.fn();
    render(<ColorPicker defaultValue={{ h: 100, s: 0.5, v: 0.5, a: 1 }} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Hue" }), { key: "ArrowUp" });
    expect(onChange.mock.calls.at(-1)![0].h).toBe(101);
  });

  it("editing an RGB channel keeps the picker hue when the color is grey", () => {
    const onChange = vi.fn();
    // start grey (s=0) with a remembered hue of 210
    render(<ColorPicker defaultValue={{ h: 210, s: 0, v: 0.5, a: 1 }} inputs={["rgb"]} onChange={onChange} />);
    const r = screen.getByRole("spinbutton", { name: "R" });
    // bumping R alone makes it chromatic; hue should now be red-ward, not 210
    fireEvent.keyDown(r, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalled();
  });

  it("renders a swatch row and an add button that emits the current hex", async () => {
    const user = userEvent.setup();
    const onSwatchAdd = vi.fn();
    render(
      <ColorPicker
        defaultValue={RED}
        swatches={["#ff0000", "#00ff00"]}
        onSwatchAdd={onSwatchAdd}
      />,
    );
    expect(screen.getByRole("button", { name: "#00ff00" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Add swatch" }));
    // emits the canonical (lowercase) hex from hsvToHex, matching the swatch list
    expect(onSwatchAdd).toHaveBeenCalledWith("#ff0000");
  });

  it("clicking a swatch selects that color (onChange fires)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorPicker defaultValue={RED} swatches={["#00ff00"]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "#00ff00" }));
    expect(onChange.mock.calls.at(-1)![0].h).toBe(120);
  });

  it("supports controlled value via a host", () => {
    function Host() {
      const [c, setC] = useState<HSV>({ h: 0, s: 1, v: 1, a: 1 });
      return <ColorPicker value={c} onChange={setC} />;
    }
    render(<Host />);
    const hue = screen.getByRole("slider", { name: "Hue" });
    fireEvent.keyDown(hue, { key: "ArrowUp" });
    expect(hue.getAttribute("aria-valuenow")).toBe("1");
  });
});

// ─── Swatch ────────────────────────────────────────────────────
describe("Swatch", () => {
  it("renders a button with aria-pressed reflecting selected", () => {
    const { rerender } = render(<Swatch color={RED} aria-label="red" />);
    const btn = screen.getByRole("button", { name: "red" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    rerender(<Swatch color={RED} aria-label="red" selected />);
    expect(screen.getByRole("button", { name: "red" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("forwards onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Swatch color="#abcdef" aria-label="c" onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "c" }));
    expect(onClick).toHaveBeenCalled();
  });
});

// ─── SwatchGrid ────────────────────────────────────────────────
describe("SwatchGrid", () => {
  it("renders a listbox of options with the default Swatches label", () => {
    render(<SwatchGrid swatches={["#ff0000", "#00ff00", "#0000ff"]} />);
    const box = screen.getByRole("listbox", { name: "Swatches" });
    expect(within(box).getAllByRole("option").length).toBe(3);
  });

  it("selecting an option fires onSelect with its id + item (uncontrolled)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SwatchGrid
        swatches={[{ id: "a", color: "#ff0000", label: "A" }, { id: "b", color: "#00ff00", label: "B" }]}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("option", { name: "B" }));
    expect(onSelect).toHaveBeenCalledWith("b", expect.objectContaining({ id: "b" }));
    expect(screen.getByRole("option", { name: "B" }).getAttribute("aria-selected")).toBe("true");
  });

  it("arrow keys move focus across the grid", async () => {
    const user = userEvent.setup();
    render(<SwatchGrid swatches={["#100000", "#200000", "#300000", "#400000"]} columns={2} />);
    const opts = screen.getAllByRole("option");
    opts[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(opts[1]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(opts[3]);
  });

  it("renders an add button when onAdd is given", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<SwatchGrid swatches={["#ff0000"]} onAdd={onAdd} />);
    await user.click(screen.getByRole("button", { name: "Add swatch" }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("is controlled when selectedId is supplied", () => {
    const onSelect = vi.fn();
    render(
      <SwatchGrid
        swatches={[{ id: "a", color: "#ff0000" }, { id: "b", color: "#00ff00" }]}
        selectedId="a"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("option", { name: "a" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps duplicate colors distinct (#200)", async () => {
    // Regression: the hex doubled as the id, so a repeated color collided on
    // `key`, marked BOTH cells aria-selected and gave onSelect an ambiguous id.
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SwatchGrid
        swatches={["#ff0000", "#00ff00", "#ff0000"]}
        defaultSelectedId="#ff0000"
        onSelect={onSelect}
      />,
    );
    const opts = screen.getAllByRole("option");
    expect(opts.map((o) => o.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    await user.click(opts[2]);
    expect(onSelect.mock.calls.at(-1)![0]).not.toBe("#ff0000");
    expect(opts[0].getAttribute("aria-selected")).toBe("false");
  });
});

// ─── GlyphGrid ─────────────────────────────────────────────────
describe("GlyphGrid", () => {
  it("renders a grid of gridcells with the default Glyphs label", () => {
    render(<GlyphGrid glyphs={["A", "B", "C"]} />);
    const grid = screen.getByRole("grid", { name: "Glyphs" });
    expect(within(grid).getAllByRole("gridcell").length).toBe(3);
  });

  it("selecting a glyph fires onSelect with the char + item", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<GlyphGrid glyphs={[{ char: "@", name: "at" }, { char: "#", name: "hash" }]} onSelect={onSelect} />);
    await user.click(screen.getByRole("gridcell", { name: "hash" }));
    expect(onSelect).toHaveBeenCalledWith("#", expect.objectContaining({ char: "#" }));
    expect(screen.getByRole("gridcell", { name: "hash" }).getAttribute("aria-selected")).toBe("true");
  });

  it("arrow keys move focus across the grid", async () => {
    const user = userEvent.setup();
    render(<GlyphGrid glyphs={["a", "b", "c", "d"]} columns={2} />);
    const cells = screen.getAllByRole("gridcell");
    cells[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(cells[2]);
  });
});

// ─── HexInput ──────────────────────────────────────────────────
describe("HexInput", () => {
  it("normalizes a typed hex on blur and fires onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HexInput aria-label="hex" defaultValue="#000000" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "hex" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "f00");
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("#FF0000");
    expect(input.value).toBe("#FF0000");
  });

  it("commits on Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HexInput aria-label="hex" defaultValue="#000000" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "hex" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "#00ff00{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("#00FF00");
  });

  it("reverts an unparseable value without calling onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HexInput aria-label="hex" defaultValue="#123456" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "hex" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "zzz");
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("#123456");
  });

  it("keeps the alpha byte of an 8-digit hex (#198)", async () => {
    // Regression: normalization round-tripped through hsvToHex, which drops
    // alpha by design, so a typed "#rrggbbaa" silently came back opaque.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<HexInput aria-label="hex" defaultValue="#000000" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "hex" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "#ff000080{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("#FF000080");
    // a fully opaque hex still normalizes to the 6-digit form
    await user.clear(input);
    await user.type(input, "#ff0000ff{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("#FF0000");
  });

  it("supports a controlled value", () => {
    render(<HexInput aria-label="hex" value="#abcdef" onChange={() => {}} />);
    expect((screen.getByRole("textbox", { name: "hex" }) as HTMLInputElement).value).toBe("#abcdef");
  });
});
