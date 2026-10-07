// DOM tests for the creative layer / channel / artboard inspectors
// (creative-layers.tsx). jsdom has no layout — these assert ROLES, ARIA,
// state, and callbacks only; never pixel geometry. No jest-dom: assertions
// read DOM properties/attributes directly.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  LayerRow,
  LayerList,
  VisibilityToggle,
  LockToggle,
  BlendModeSelect,
  BLEND_MODES,
  OpacityControl,
  ChannelRow,
  ChannelList,
  LayerTree,
  ArtboardList,
  type LayerData,
  type ChannelData,
  type LayerNode,
  type ArtboardData,
} from "../../src/creative-layers.tsx";

// ─── VisibilityToggle ──────────────────────────────────────────
describe("VisibilityToggle", () => {
  it("is a switch button reflecting checked state, default labelled", () => {
    render(<VisibilityToggle defaultChecked />);
    const sw = screen.getByRole("switch", { name: "Toggle visibility" });
    expect(sw.tagName).toBe("BUTTON");
    expect(sw.getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles + fires onChange (uncontrolled)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VisibilityToggle defaultChecked onChange={onChange} aria-label="vis" />);
    const sw = screen.getByRole("switch", { name: "vis" });
    await user.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(false);
    // #193: one click = exactly one emit (the host callback used to be wired on
    // two channels at once, so history-pushing consumers got two entries).
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(sw.getAttribute("aria-pressed")).toBe("false");
  });

  it("respects a controlled checked prop (does not flip locally)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VisibilityToggle checked={true} onChange={onChange} aria-label="vis" />);
    const sw = screen.getByRole("switch", { name: "vis" });
    await user.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(false);
    // controlled: stays pressed because the prop did not change
    expect(sw.getAttribute("aria-pressed")).toBe("true");
  });
});

// ─── LockToggle ────────────────────────────────────────────────
describe("LockToggle", () => {
  it("defaults to unlocked and toggles on", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LockToggle onChange={onChange} aria-label="lock" />);
    const sw = screen.getByRole("switch", { name: "lock" });
    expect(sw.getAttribute("aria-pressed")).toBe("false");
    await user.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenCalledTimes(1); // #193
  });
});

// ─── LayerRow ──────────────────────────────────────────────────
describe("LayerRow", () => {
  it("renders role=option with aria-selected and an eye + lock switch", () => {
    render(<LayerRow name="Sky" selected />);
    const row = screen.getByRole("option", { name: /Sky/ });
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(row.className).toContain("monet-layer");
    expect(row.className).toContain("is-selected");
    // two switches inside the row: visibility + lock
    expect(within(row).getAllByRole("switch")).toHaveLength(2);
  });

  it("click activates onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<LayerRow name="Sky" onSelect={onSelect} />);
    await user.click(screen.getByRole("option", { name: /Sky/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("toggling the eye fires onVisibilityToggle WITHOUT selecting the row", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onVisibilityToggle = vi.fn();
    render(
      <LayerRow
        name="Sky"
        visible
        onSelect={onSelect}
        onVisibilityToggle={onVisibilityToggle}
      />,
    );
    const eye = screen.getByRole("switch", { name: "Hide layer" });
    await user.click(eye);
    expect(onVisibilityToggle).toHaveBeenLastCalledWith(false);
    expect(onVisibilityToggle).toHaveBeenCalledTimes(1); // #193
    // stopPropagation: the row's onSelect must not fire
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("toggling the lock fires onLockToggle without selecting", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onLockToggle = vi.fn();
    render(<LayerRow name="Sky" onSelect={onSelect} onLockToggle={onLockToggle} />);
    await user.click(screen.getByRole("switch", { name: "Lock layer" }));
    expect(onLockToggle).toHaveBeenLastCalledWith(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Enter / Space on the row activate onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<LayerRow name="Sky" onSelect={onSelect} />);
    const row = screen.getByRole("option", { name: /Sky/ });
    row.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("leaves Enter and Space activation to interactive controls in the name", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onAction = vi.fn();
    render(
      <LayerRow
        name={
          <button onClick={(e) => { e.stopPropagation(); onAction(); }}>
            Toggle mask
          </button>
        }
        onSelect={onSelect}
      />,
    );
    const button = screen.getByRole("button", { name: "Toggle mask" });
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders opacity + blend in the default meta slot", () => {
    render(<LayerRow name="Sky" opacity={60} blendMode="Multiply" />);
    const row = screen.getByRole("option", { name: /Sky/ });
    expect(within(row).getByText("60%")).not.toBeNull();
    expect(within(row).getByText("Multiply")).not.toBeNull();
  });
});

// ─── LayerList ─────────────────────────────────────────────────
const LAYERS: LayerData[] = [
  { id: "l1", name: "Background", opacity: 100 },
  { id: "l2", name: "Subject", opacity: 80, blendMode: "Normal" },
  { id: "l3", name: "Glow", opacity: 60, locked: true },
];

describe("LayerList", () => {
  it("renders role=listbox with option rows + a roving tab stop", () => {
    render(<LayerList layers={LAYERS} aria-label="layers" defaultSelectedId="l2" />);
    const box = screen.getByRole("listbox", { name: "layers" });
    const opts = within(box).getAllByRole("option");
    expect(opts).toHaveLength(3);
    const selected = screen.getByRole("option", { name: /Subject/ });
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.getAttribute("tabindex")).toBe("0");
    expect(
      screen.getByRole("option", { name: /Background/ }).getAttribute("tabindex"),
    ).toBe("-1");
  });

  it("clicking a row selects it and fires onSelect (uncontrolled)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<LayerList layers={LAYERS} aria-label="layers" onSelect={onSelect} />);
    await user.click(screen.getByRole("option", { name: /Glow/ }));
    expect(onSelect).toHaveBeenLastCalledWith("l3");
    expect(
      screen.getByRole("option", { name: /Glow/ }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("Arrow/Home/End move focus across rows", async () => {
    const user = userEvent.setup();
    render(<LayerList layers={LAYERS} aria-label="layers" defaultSelectedId="l1" />);
    const first = screen.getByRole("option", { name: /Background/ });
    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /Subject/ }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /Glow/ }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(first);
  });

  it("multiSelect marks aria-multiselectable; Space toggles membership", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(
      <LayerList
        layers={LAYERS}
        aria-label="layers"
        multiSelect
        onSelectionChange={onSelectionChange}
      />,
    );
    const box = screen.getByRole("listbox", { name: "layers" });
    expect(box.getAttribute("aria-multiselectable")).toBe("true");
    await user.click(screen.getByRole("option", { name: /Background/ }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(["l1"]);
    // Space adds another to the selection
    const subject = screen.getByRole("option", { name: /Subject/ });
    subject.focus();
    await user.keyboard(" ");
    expect(onSelectionChange).toHaveBeenLastCalledWith(["l1", "l2"]);
  });

  it("row visibility / lock toggles bubble up with the layer id (not selection)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onVisibilityChange = vi.fn();
    const onLockChange = vi.fn();
    render(
      <LayerList
        layers={LAYERS}
        aria-label="layers"
        onSelect={onSelect}
        onVisibilityChange={onVisibilityChange}
        onLockChange={onLockChange}
      />,
    );
    const subjectRow = screen.getByRole("option", { name: /Subject/ });
    await user.click(within(subjectRow).getByRole("switch", { name: "Hide layer" }));
    expect(onVisibilityChange).toHaveBeenLastCalledWith("l2", false);
    expect(onVisibilityChange).toHaveBeenCalledTimes(1); // #193
    expect(onSelect).not.toHaveBeenCalled();
    // Glow is locked → its switch is pressed and labelled "Unlock layer"
    const glowRow = screen.getByRole("option", { name: /Glow/ });
    await user.click(within(glowRow).getByRole("switch", { name: "Unlock layer" }));
    expect(onLockChange).toHaveBeenLastCalledWith("l3", false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("wires onOpacityChange / onBlendModeChange to real row controls (#201)", async () => {
    // Regression: both props were declared and destructured but rendered
    // nowhere, so hosts that wired them (vision, anime) got permanent silence.
    const user = userEvent.setup();
    const onOpacityChange = vi.fn();
    const onBlendModeChange = vi.fn();
    render(
      <LayerList
        layers={LAYERS}
        aria-label="layers"
        onOpacityChange={onOpacityChange}
        onBlendModeChange={onBlendModeChange}
      />,
    );
    const subject = screen.getAllByRole("option")[1]; // LAYERS[1] = Subject, 80%
    within(subject).getByRole("slider", { name: "Opacity" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(onOpacityChange).toHaveBeenLastCalledWith("l2", 79);
    await user.click(within(subject).getByRole("combobox", { name: "Blend mode" }));
    await user.click(screen.getByRole("option", { name: "Multiply" }));
    expect(onBlendModeChange).toHaveBeenLastCalledWith("l2", "multiply");
  });

  it("keeps the meta slot a plain readout when no editor is wired", () => {
    render(<LayerList layers={LAYERS} aria-label="layers" />);
    const subject = screen.getAllByRole("option")[1];
    expect(within(subject).getByText("80%")).not.toBeNull();
    expect(within(subject).queryByRole("slider")).toBeNull();
    expect(within(subject).queryByRole("combobox")).toBeNull();
  });

  it("renders header + footer slots", () => {
    render(
      <LayerList
        layers={LAYERS}
        aria-label="layers"
        header={<div>HEAD</div>}
        footer={<div>FOOT</div>}
      />,
    );
    expect(screen.getByText("HEAD")).not.toBeNull();
    expect(screen.getByText("FOOT")).not.toBeNull();
  });

  it("supports a controlled selectedId", async () => {
    const user = userEvent.setup();
    function Host() {
      const [id, setId] = useState("l1");
      return <LayerList layers={LAYERS} aria-label="layers" selectedId={id} onSelect={setId} />;
    }
    render(<Host />);
    await user.click(screen.getByRole("option", { name: /Glow/ }));
    expect(
      screen.getByRole("option", { name: /Glow/ }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("renderRow replaces the default row", () => {
    render(
      <LayerList
        layers={LAYERS}
        aria-label="layers"
        renderRow={(layer, info) => (
          <div role="option" aria-selected={info.selected} tabIndex={info.tabIndex}>
            CUSTOM {layer.name}
          </div>
        )}
      />,
    );
    expect(screen.getByText(/CUSTOM Background/)).not.toBeNull();
  });

  it("keeps Arrow/Home/End roving navigation working under renderRow (#195)", async () => {
    // Regression: renderRow rows were emitted inside a bare Fragment with no
    // ref, so the private els map stayed empty and every Arrow/Home/End press
    // moved focus nowhere — Vision's whole layer stack uses renderRow.
    const user = userEvent.setup();
    render(
      <LayerList
        layers={LAYERS}
        aria-label="layers"
        defaultSelectedId="l1"
        renderRow={(layer, info) => (
          <div role="option" aria-selected={info.selected} tabIndex={info.tabIndex}>
            CUSTOM {layer.name}
          </div>
        )}
      />,
    );
    const first = screen.getByRole("option", { name: /CUSTOM Background/ });
    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /CUSTOM Subject/ }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /CUSTOM Glow/ }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(first);
  });
});

// ─── BlendModeSelect ───────────────────────────────────────────
describe("BlendModeSelect", () => {
  it("exposes the full blend-mode roster (27 modes, kebab ids)", () => {
    expect(BLEND_MODES).toHaveLength(27);
    expect(BLEND_MODES[0]).toEqual({ value: "normal", label: "Normal" });
    expect(BLEND_MODES.find((m) => m.label === "Color Burn")?.value).toBe("color-burn");
    expect(BLEND_MODES.find((m) => m.label === "Darker Color")?.value).toBe("darker-color");
    expect(BLEND_MODES.find((m) => m.label === "Lighter Color")?.value).toBe("lighter-color");
    expect(BLEND_MODES.find((m) => m.label === "Luminosity")?.value).toBe("luminosity");
  });

  it("renders a Select preloaded with the modes and fires onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BlendModeSelect aria-label="blend" defaultValue="normal" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "blend" });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Multiply" }));
    expect(onChange).toHaveBeenLastCalledWith("multiply");
  });

  it("accepts a custom options roster", () => {
    render(
      <BlendModeSelect
        aria-label="blend"
        options={[{ value: "normal", label: "Normal" }]}
        defaultValue="normal"
      />,
    );
    expect(screen.getByRole("combobox", { name: "blend" })).not.toBeNull();
  });
});

// ─── OpacityControl ────────────────────────────────────────────
describe("OpacityControl", () => {
  it("renders a labelled slider (0..100) + a % readout", () => {
    render(<OpacityControl defaultValue={60} />);
    const slider = screen.getByRole("slider", { name: "Opacity" });
    expect(slider.getAttribute("aria-valuemin")).toBe("0");
    expect(slider.getAttribute("aria-valuemax")).toBe("100");
    expect(slider.getAttribute("aria-valuenow")).toBe("60");
    expect(screen.getByText("60%")).not.toBeNull();
  });

  it("keyboard nudges fire onChange and update the readout (uncontrolled)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OpacityControl defaultValue={60} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Opacity" });
    slider.focus();
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith(61);
    expect(screen.getByText("61%")).not.toBeNull();
  });

  it("a pointer drag on the slider fires onChange", () => {
    const onChange = vi.fn();
    render(<OpacityControl defaultValue={50} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Opacity" });
    // jsdom has no layout (rect=0); we only assert the drag path fires onChange.
    fireEvent.pointerDown(slider, { button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 5 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
  });

  it("supports a controlled value", () => {
    render(<OpacityControl value={25} label="Fill" />);
    const slider = screen.getByRole("slider", { name: "Fill" });
    expect(slider.getAttribute("aria-valuenow")).toBe("25");
    expect(screen.getByText("25%")).not.toBeNull();
  });
});

// ─── ChannelRow + ChannelList ──────────────────────────────────
const CHANNELS: ChannelData[] = [
  { id: "rgb", name: "RGB", composite: true, shortcut: "⌘2" },
  { id: "r", name: "Red", shortcut: "⌘3" },
  { id: "g", name: "Green", shortcut: "⌘4" },
  { id: "b", name: "Blue", shortcut: "⌘5" },
];

describe("ChannelRow", () => {
  it("is role=option with a single visibility switch (no lock)", () => {
    render(<ChannelRow name="Red" shortcut="⌘3" />);
    const row = screen.getByRole("option", { name: /Red/ });
    expect(within(row).getAllByRole("switch")).toHaveLength(1);
    expect(within(row).getByText("⌘3")).not.toBeNull();
  });

  it("marks the composite channel with .is-composite", () => {
    render(<ChannelRow name="RGB" composite />);
    expect(screen.getByRole("option", { name: /RGB/ }).className).toContain("is-composite");
  });

  it("leaves Enter/Space aimed at the eye switch to the switch (#196)", () => {
    // Regression: the row handled the bubbled keydown, preventDefault()-ing the
    // button's own activation — a keyboard user selected the row instead of
    // toggling channel visibility, and could never toggle it at all.
    const onSelect = vi.fn();
    render(<ChannelRow name="Red" onSelect={onSelect} onVisibilityToggle={vi.fn()} />);
    const eye = screen.getByRole("switch", { name: "Hide channel" });
    // fireEvent returns false when a handler cancelled the event
    expect(fireEvent.keyDown(eye, { key: " " })).toBe(true);
    expect(fireEvent.keyDown(eye, { key: "Enter" })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still activates on Enter/Space aimed at the row itself", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ChannelRow name="Red" onSelect={onSelect} />);
    const row = screen.getByRole("option", { name: /Red/ });
    row.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});

describe("ChannelList", () => {
  it("renders role=listbox of channel options", () => {
    render(<ChannelList channels={CHANNELS} aria-label="channels" defaultSelectedId="rgb" />);
    const box = screen.getByRole("listbox", { name: "channels" });
    expect(within(box).getAllByRole("option")).toHaveLength(4);
    expect(
      screen.getByRole("option", { name: /RGB/ }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("selects on click and toggles channel visibility independently", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onVisibilityChange = vi.fn();
    render(
      <ChannelList
        channels={CHANNELS}
        aria-label="channels"
        onSelect={onSelect}
        onVisibilityChange={onVisibilityChange}
      />,
    );
    await user.click(screen.getByRole("option", { name: /Green/ }));
    expect(onSelect).toHaveBeenLastCalledWith("g");
    const blueRow = screen.getByRole("option", { name: /Blue/ });
    await user.click(within(blueRow).getByRole("switch"));
    expect(onVisibilityChange).toHaveBeenLastCalledWith("b", false);
  });

  it("Arrow keys move focus across channels", async () => {
    const user = userEvent.setup();
    render(<ChannelList channels={CHANNELS} aria-label="channels" defaultSelectedId="rgb" />);
    const rgb = screen.getByRole("option", { name: /RGB/ });
    rgb.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /Red/ }));
  });
});

// ─── LayerTree ─────────────────────────────────────────────────
const TREE: LayerNode[] = [
  {
    id: "grp",
    name: "Group",
    expanded: true,
    children: [
      { id: "c1", name: "Child 1", opacity: 100 },
      { id: "c2", name: "Child 2", locked: true },
    ],
  },
  { id: "bg", name: "Background" },
];

describe("LayerTree", () => {
  it("composes a tree of treeitems, each rendering a LayerRow with switches", () => {
    render(<LayerTree nodes={TREE} aria-label="layers" />);
    const tree = screen.getByRole("tree", { name: "layers" });
    const grp = within(tree).getByRole("treeitem", { name: /Group/ });
    expect(grp.getAttribute("aria-level")).toBe("1");
    expect(grp.getAttribute("aria-expanded")).toBe("true");
    // expanded group reveals its children at level 2
    const child = within(tree).getByRole("treeitem", { name: /Child 1/ });
    expect(child.getAttribute("aria-level")).toBe("2");
    // each treeitem carries the LayerRow eye/lock switches
    expect(within(child).getAllByRole("switch").length).toBeGreaterThanOrEqual(2);
  });

  it("seeds expansion from node.expanded flags", () => {
    render(<LayerTree nodes={TREE} aria-label="layers" />);
    // Group is expanded → Child 1 is visible
    expect(screen.queryByRole("treeitem", { name: /Child 1/ })).not.toBeNull();
  });

  it("clicking a node fires onSelect with its id", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<LayerTree nodes={TREE} aria-label="layers" onSelect={onSelect} />);
    await user.click(screen.getByRole("treeitem", { name: /Background/ }));
    expect(onSelect).toHaveBeenLastCalledWith("bg");
  });

  it("a node's eye toggle fires onVisibilityChange with its id, not selection", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onVisibilityChange = vi.fn();
    render(
      <LayerTree
        nodes={TREE}
        aria-label="layers"
        onSelect={onSelect}
        onVisibilityChange={onVisibilityChange}
      />,
    );
    const child = screen.getByRole("treeitem", { name: /Child 1/ });
    await user.click(within(child).getByRole("switch", { name: "Hide layer" }));
    expect(onVisibilityChange).toHaveBeenLastCalledWith("c1", false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ArrowLeft collapses an expanded group (controlled expansion callback)", async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    render(
      <LayerTree
        nodes={TREE}
        aria-label="layers"
        defaultExpandedIds={["grp"]}
        onExpandedChange={onExpandedChange}
      />,
    );
    const grp = screen.getByRole("treeitem", { name: /Group/ });
    grp.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onExpandedChange).toHaveBeenLastCalledWith([]);
  });
});

// ─── ArtboardList ──────────────────────────────────────────────
const ARTBOARDS: ArtboardData[] = [
  { id: "a1", name: "Home", size: "1440 × 1024" },
  { id: "a2", name: "Settings", size: "1440 × 1024" },
  { id: "a3", name: "Profile", size: "375 × 812" },
];

describe("ArtboardList", () => {
  it("renders role=listbox of artboard options with size meta", () => {
    render(<ArtboardList artboards={ARTBOARDS} aria-label="artboards" defaultSelectedId="a1" />);
    const box = screen.getByRole("listbox", { name: "artboards" });
    expect(within(box).getAllByRole("option")).toHaveLength(3);
    const home = screen.getByRole("option", { name: /Home/ });
    expect(home.getAttribute("aria-selected")).toBe("true");
    expect(within(home).getByText("1440 × 1024")).not.toBeNull();
  });

  it("selects on click and fires onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ArtboardList artboards={ARTBOARDS} aria-label="artboards" onSelect={onSelect} />);
    await user.click(screen.getByRole("option", { name: /Profile/ }));
    expect(onSelect).toHaveBeenLastCalledWith("a3");
  });

  it("double-click and Enter fire onActivate", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <ArtboardList artboards={ARTBOARDS} aria-label="artboards" onActivate={onActivate} />,
    );
    const settings = screen.getByRole("option", { name: /Settings/ });
    await user.dblClick(settings);
    expect(onActivate).toHaveBeenLastCalledWith("a2");
    settings.focus();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenLastCalledWith("a2");
  });

  it("Arrow keys move focus across artboards", async () => {
    const user = userEvent.setup();
    render(<ArtboardList artboards={ARTBOARDS} aria-label="artboards" defaultSelectedId="a1" />);
    const home = screen.getByRole("option", { name: /Home/ });
    home.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /Settings/ }));
  });
});
