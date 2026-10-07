// DOM tests for the interactive chrome primitives (primitives.tsx +
// primitives-graphics.tsx). jsdom has no layout — these assert ROLES, ARIA,
// state, and callbacks. The Slider's keyboard path is geometry-independent and
// tested for value changes; its pointer path is only asserted not to throw.
// No jest-dom.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Slider, TabStrip, Titlebar, ToolRail, Panel } from "../../src/primitives.tsx";

// ─── Slider ────────────────────────────────────────────────────
describe("Slider", () => {
  it("renders role=slider with aria-valuemin/max/now", () => {
    render(
      <Slider aria-label="vol" min={0} max={100} step={10} value={50} />,
    );
    const slider = screen.getByRole("slider", { name: "vol" });
    expect(slider.getAttribute("aria-valuemin")).toBe("0");
    expect(slider.getAttribute("aria-valuemax")).toBe("100");
    expect(slider.getAttribute("aria-valuenow")).toBe("50");
  });

  it("ArrowRight/ArrowLeft change aria-valuenow and fire onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Slider
        aria-label="vol"
        min={0}
        max={100}
        step={10}
        value={50}
        onChange={onChange}
      />,
    );
    const slider = screen.getByRole("slider", { name: "vol" });
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(60);
    await user.keyboard("{ArrowLeft}");
    // onChange always fires with the next stepped value relative to current(=50,
    // controlled — value prop is fixed at 50 so each press computes from 50)
    expect(onChange).toHaveBeenLastCalledWith(40);
  });

  it("Home/End jump to min/max", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Slider
        aria-label="vol"
        min={0}
        max={100}
        step={10}
        value={50}
        onChange={onChange}
      />,
    );
    const slider = screen.getByRole("slider", { name: "vol" });
    slider.focus();
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith(0);
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it("updates its own aria-valuenow when uncontrolled (no onChange)", () => {
    render(<Slider aria-label="vol" min={0} max={100} step={10} value={30} />);
    const slider = screen.getByRole("slider", { name: "vol" });
    expect(slider.getAttribute("aria-valuenow")).toBe("30");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(slider.getAttribute("aria-valuenow")).toBe("40");
  });

  it("cancels and unbinds pointer drags", () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    const { unmount } = render(
      <Slider aria-label="vol" min={0} max={100} value={0}
              onChange={onChange} onChangeEnd={onChangeEnd} />,
    );
    const slider = screen.getByRole("slider", { name: "vol" });
    slider.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 100, height: 20,
      right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}),
    });

    fireEvent.pointerDown(slider, { button: 0, clientX: 10 });
    fireEvent.pointerMove(window, { clientX: 50 });
    fireEvent.pointerCancel(window);
    expect(onChangeEnd).not.toHaveBeenCalled();
    onChange.mockClear();
    fireEvent.pointerMove(window, { clientX: 90 });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(slider, { button: 0, clientX: 10 });
    onChange.mockClear();
    unmount();
    fireEvent.pointerMove(window, { clientX: 90 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── TabStrip ──────────────────────────────────────────────────
describe("TabStrip", () => {
  it("fires onAdd when the add affordance is clicked", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<TabStrip tabs={["One", "Two"]} active="One" onAdd={onAdd} />);
    await user.click(screen.getByRole("button", { name: "Add tab" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("fires onClose with the tab id from its close affordance", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TabStrip tabs={["One", "Two"]} active="One" onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close Two" }));
    expect(onClose).toHaveBeenCalledWith("Two");
  });

  it("renders role=tab with aria-selected on the active tab", () => {
    render(<TabStrip tabs={["One", "Two"]} active="Two" onSelect={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    const two = screen.getByRole("tab", { name: /Two/ });
    expect(two.getAttribute("aria-selected")).toBe("true");
  });

  it("fires onSelect when a tab is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TabStrip tabs={["One", "Two"]} active="One" onSelect={onSelect} />);
    await user.click(screen.getByRole("tab", { name: /Two/ }));
    expect(onSelect).toHaveBeenCalledWith("Two");
  });

  // (#189) tabIndex is roving, so arrow keys must move DOM focus too —
  // otherwise focus stays on a tab that just became tabIndex=-1 and the
  // strip is stuck one step in.
  it("moves focus with the arrow keys so every tab is reachable", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TabStrip tabs={["One", "Two", "Three"]} onSelect={onSelect} />);
    screen.getByRole("tab", { name: /One/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenLastCalledWith("Two");
    await user.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenLastCalledWith("Three");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Three/ }));
  });
});

// ─── Titlebar ──────────────────────────────────────────────────
describe("Titlebar", () => {
  it("fires onDocSelect when a document tab is clicked", async () => {
    const user = userEvent.setup();
    const onDocSelect = vi.fn();
    render(
      <Titlebar
        docs={["Doc A", "Doc B"]}
        activeDoc="Doc A"
        onDocSelect={onDocSelect}
      />,
    );
    const tablist = screen.getByRole("tablist", { name: "Open documents" });
    await user.click(within(tablist).getByRole("tab", { name: /Doc B/ }));
    expect(onDocSelect).toHaveBeenCalledWith("Doc B");
  });

  it("fires onDocClose from a document tab's close control", async () => {
    const user = userEvent.setup();
    const onDocClose = vi.fn();
    render(
      <Titlebar
        docs={["Doc A", "Doc B"]}
        activeDoc="Doc A"
        onDocClose={onDocClose}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Close Doc B" }));
    expect(onDocClose).toHaveBeenCalledWith("Doc B");
  });

  // (#190) `activeDoc` is documented as controlled: a host that refuses the
  // selection must stay authoritative (mirroring it into state diverged).
  it("keeps the controlled activeDoc authoritative when the host refuses a click", async () => {
    const user = userEvent.setup();
    render(<Titlebar docs={["Doc A", "Doc B"]} activeDoc="Doc A" onDocSelect={() => {}} />);
    const tablist = screen.getByRole("tablist", { name: "Open documents" });
    await user.click(within(tablist).getByRole("tab", { name: /Doc B/ }));
    expect(within(tablist).getByRole("tab", { name: /Doc A/ }).getAttribute("aria-selected")).toBe("true");
    expect(within(tablist).getByRole("tab", { name: /Doc B/ }).getAttribute("aria-selected")).toBe("false");
  });

  // (#190) uncontrolled: closing the active doc left no selected tab and no
  // tab stop, because the re-sync effect ignored `docs`.
  it("falls back to the first tab when the active document is closed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Titlebar docs={["Doc A", "Doc B"]} />);
    const tablist = screen.getByRole("tablist", { name: "Open documents" });
    await user.click(within(tablist).getByRole("tab", { name: /Doc B/ }));
    expect(within(tablist).getByRole("tab", { name: /Doc B/ }).getAttribute("aria-selected")).toBe("true");
    rerender(<Titlebar docs={["Doc A"]} />);
    const a = screen.getByRole("tab", { name: /Doc A/ });
    expect(a.getAttribute("aria-selected")).toBe("true");
    expect(a.getAttribute("tabindex")).toBe("0");
  });
});

// ─── ToolRail ──────────────────────────────────────────────────
const TOOLS = [
  { id: "move", name: "Move", icon: "cursor" },
  { id: "pen", name: "Pen", icon: "pen" },
];

describe("ToolRail", () => {
  it("renders each tool as role=button with its aria-label", () => {
    render(<ToolRail tools={TOOLS} active="move" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Move" })).not.toBeNull();
    const pen = screen.getByRole("button", { name: "Pen" });
    expect(pen.getAttribute("aria-pressed")).toBe("false");
    expect(
      screen.getByRole("button", { name: "Move" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("fires onSelect when a tool is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ToolRail tools={TOOLS} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Pen" }));
    expect(onSelect).toHaveBeenCalledWith("pen");
  });

  it("activates a tool with Enter and Space", () => {
    const onSelect = vi.fn();
    render(<ToolRail tools={TOOLS} onSelect={onSelect} />);
    const pen = screen.getByRole("button", { name: "Pen" });
    fireEvent.keyDown(pen, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("pen");
    fireEvent.keyDown(pen, { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});

// ─── ToolRail flyout groups (Photoshop-style) ──────────────────
const GROUPED = [
  { id: "move", name: "Move", icon: "cursor" },
  {
    id: "grp-marquee",
    name: "Marquee",
    icon: "marquee",
    children: [
      { id: "marquee", name: "Rectangle Marquee", icon: "marquee" },
      { id: "ellipse", name: "Ellipse Marquee", icon: "ellipse" },
      { id: "singlerow", name: "Single Row Marquee", icon: "singlerow" },
    ],
  },
  "div",
  { id: "zoom", name: "Zoom", icon: "zoom" },
];

describe("ToolRail flyout groups", () => {
  it("collapses a group to one slot showing the active child; siblings stay flat", () => {
    render(<ToolRail tools={GROUPED} active="ellipse" onSelect={() => {}} />);
    // Three top-level slots: Move, the Marquee group (showing the active child
    // Ellipse), and Zoom — NOT one button per marquee member.
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(3);
    const slot = screen.getByRole("button", { name: "Ellipse Marquee" });
    expect(slot.getAttribute("aria-pressed")).toBe("true");
    expect(slot.getAttribute("data-tool-group")).toBe("grp-marquee");
    expect(slot.getAttribute("aria-haspopup")).toBe("menu");
    // The non-visible members are not in the rail until the flyout opens.
    expect(screen.queryByRole("button", { name: "Single Row Marquee" })).toBeNull();
  });

  it("shows the first child by default and a plain click selects the visible tool", () => {
    const onSelect = vi.fn();
    render(<ToolRail tools={GROUPED} active="move" onSelect={onSelect} />);
    // Group not active → the slot shows its default (first) child.
    const slot = screen.getByRole("button", { name: "Rectangle Marquee" });
    expect(slot.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(slot);
    expect(onSelect).toHaveBeenCalledWith("marquee");
  });

  it("Alt-click cycles to the next child", () => {
    const onSelect = vi.fn();
    render(<ToolRail tools={GROUPED} onSelect={onSelect} />);
    const slot = screen.getByRole("button", { name: "Rectangle Marquee" });
    fireEvent.click(slot, { altKey: true });
    expect(onSelect).toHaveBeenCalledWith("ellipse");
  });

  it("right-click opens the flyout listing every child; clicking one selects it", () => {
    const onSelect = vi.fn();
    render(<ToolRail tools={GROUPED} active="marquee" onSelect={onSelect} />);
    const slot = screen.getByRole("button", { name: "Rectangle Marquee" });
    expect(slot.getAttribute("aria-expanded")).toBe("false");

    fireEvent.contextMenu(slot);
    expect(slot.getAttribute("aria-expanded")).toBe("true");
    // The active child is checked; a normally-hidden member is now reachable.
    expect(
      screen.getByRole("menuitemradio", { name: "Rectangle Marquee" }).getAttribute("aria-checked"),
    ).toBe("true");
    const hidden = screen.getByRole("menuitemradio", { name: "Single Row Marquee" });
    fireEvent.click(hidden);
    expect(onSelect).toHaveBeenCalledWith("singlerow");
  });

  it("opens the flyout on a long press (pointer hold)", () => {
    vi.useFakeTimers();
    try {
      const onSelect = vi.fn();
      render(<ToolRail tools={GROUPED} active="marquee" onSelect={onSelect} />);
      const slot = screen.getByRole("button", { name: "Rectangle Marquee" });
      act(() => { fireEvent.pointerDown(slot, { button: 0 }); });
      // Before the dwell elapses the flyout is still closed.
      act(() => { vi.advanceTimersByTime(200); });
      expect(slot.getAttribute("aria-expanded")).toBe("false");
      act(() => { vi.advanceTimersByTime(200); });
      expect(slot.getAttribute("aria-expanded")).toBe("true");
      // A hold is not a click — it must not select the visible tool.
      fireEvent.click(slot);
      expect(onSelect).not.toHaveBeenCalled();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});

describe("ToolRail tooltips", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const TIPPED = [{ id: "move", name: "Move (V)", icon: "cursor", description: "Move things around." }];

  it("opens a name + description popup after a 1s dwell, replacing the native title", () => {
    render(<ToolRail tools={TIPPED} onSelect={() => {}} />);
    const move = screen.getByRole("button", { name: "Move (V)" });
    // The hover popup replaces the browser's native title tooltip.
    expect(move.getAttribute("title")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();

    act(() => {
      fireEvent.focus(move);
    });
    // Still closed before the full 1-second dwell elapses.
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Move (V)");
    expect(tip.textContent).toContain("Move things around.");
    expect(move.getAttribute("aria-describedby")).toBe(tip.id);
  });
});

// ─── Panel ─────────────────────────────────────────────────────
describe("Panel", () => {
  it("applies the flex prop as flexGrow on its style", () => {
    const { container } = render(
      <Panel flex={2}>
        <span>content</span>
      </Panel>,
    );
    const panel = container.querySelector(".monet-panel") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.flexGrow).toBe("2");
  });

  it("omits flexGrow when no flex is given", () => {
    const { container } = render(
      <Panel>
        <span>content</span>
      </Panel>,
    );
    const panel = container.querySelector(".monet-panel") as HTMLElement;
    expect(panel.style.flexGrow).toBe("");
  });
});
