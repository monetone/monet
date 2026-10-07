// DOM tests for the in-house form controls (controls.tsx / controls-select.tsx).
// jsdom has no layout — these assert ROLES, ARIA, state, and callbacks only.
// No jest-dom: assertions read DOM properties/attributes directly.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  Button,
  IconButton,
  Input,
  Textarea,
  NumberField,
  Checkbox,
  Switch,
  Radio,
  RadioGroup,
  Select,
} from "../../src/controls.tsx";

// ─── Button ────────────────────────────────────────────────────
describe("Button", () => {
  it("renders a real button and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(btn.type).toBe("button");
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

// ─── IconButton ────────────────────────────────────────────────
describe("IconButton", () => {
  it("exposes its aria-label and active → aria-pressed", () => {
    render(<IconButton icon="close" aria-label="Close panel" active />);
    const btn = screen.getByRole("button", { name: "Close panel" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});

// ─── Input ─────────────────────────────────────────────────────
describe("Input", () => {
  it("supports a controlled value + onChange", async () => {
    const user = userEvent.setup();
    function Host() {
      const [v, setV] = useState("");
      return (
        <Input
          aria-label="name"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
      );
    }
    render(<Host />);
    const input = screen.getByRole("textbox", { name: "name" }) as HTMLInputElement;
    await user.type(input, "abc");
    expect(input.value).toBe("abc");
  });
});

// ─── Textarea ──────────────────────────────────────────────────
describe("Textarea", () => {
  it("supports a controlled value + onChange", async () => {
    const user = userEvent.setup();
    function Host() {
      const [v, setV] = useState("");
      return (
        <Textarea
          aria-label="notes"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
      );
    }
    render(<Host />);
    const ta = screen.getByRole("textbox", { name: "notes" }) as HTMLTextAreaElement;
    await user.type(ta, "hi");
    expect(ta.value).toBe("hi");
  });
});

// ─── NumberField ───────────────────────────────────────────────
describe("NumberField", () => {
  it("exposes role=spinbutton with aria value bounds", () => {
    render(<NumberField aria-label="qty" defaultValue={5} min={0} max={10} />);
    const sb = screen.getByRole("spinbutton", { name: "qty" });
    expect(sb.getAttribute("aria-valuenow")).toBe("5");
    expect(sb.getAttribute("aria-valuemin")).toBe("0");
    expect(sb.getAttribute("aria-valuemax")).toBe("10");
  });

  it("ArrowUp/ArrowDown change the value by step", () => {
    const onChange = vi.fn();
    render(
      <NumberField
        aria-label="qty"
        defaultValue={5}
        min={0}
        max={10}
        step={2}
        onChange={onChange}
      />,
    );
    const sb = screen.getByRole("spinbutton", { name: "qty" });
    fireEvent.keyDown(sb, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(7);
    fireEvent.keyDown(sb, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("clamps at min and max", () => {
    const onChange = vi.fn();
    render(
      <NumberField
        aria-label="qty"
        defaultValue={9}
        min={0}
        max={10}
        step={5}
        onChange={onChange}
      />,
    );
    const sb = screen.getByRole("spinbutton", { name: "qty" });
    fireEvent.keyDown(sb, { key: "ArrowUp" }); // 9+5 → clamp 10
    expect(onChange).toHaveBeenLastCalledWith(10);
    fireEvent.keyDown(sb, { key: "Home" }); // jump to min
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(sb, { key: "ArrowDown" }); // 0-5 → clamp 0
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(sb, { key: "End" }); // jump to max
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it("nudges from a typed draft, including a draft of zero (#186)", () => {
    // Regression: the base value was resolved as `Number(draft) || num`, and
    // Number("0") is falsy — so a typed 0 was thrown away and the nudge ran off
    // the previous committed value (50 → 51 instead of 0 → 1).
    const onChange = vi.fn();
    render(
      <NumberField aria-label="qty" defaultValue={50} min={0} max={100} step={1} onChange={onChange} />,
    );
    const sb = screen.getByRole("spinbutton", { name: "qty" }) as HTMLInputElement;
    fireEvent.change(sb, { target: { value: "0" } });
    fireEvent.keyDown(sb, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(sb.value).toBe("1");
    // control case: a nonzero draft was always honoured
    fireEvent.change(sb, { target: { value: "7" } });
    fireEvent.keyDown(sb, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(8);
    // a blank / unparsable draft still falls back to the committed value
    fireEvent.change(sb, { target: { value: "" } });
    fireEvent.keyDown(sb, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(9);
  });
});

// ─── Checkbox ──────────────────────────────────────────────────
describe("Checkbox", () => {
  it("toggles aria-checked and fires onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox onChange={onChange}>Agree</Checkbox>);
    const cb = screen.getByRole("checkbox", { name: "Agree" });
    expect(cb.getAttribute("aria-checked")).toBe("false");
    await user.click(cb);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(cb.getAttribute("aria-checked")).toBe("true");
  });

  it("renders indeterminate as aria-checked=mixed", () => {
    render(
      <Checkbox indeterminate aria-label="all">
        All
      </Checkbox>,
    );
    expect(
      screen.getByRole("checkbox", { name: "all" }).getAttribute("aria-checked"),
    ).toBe("mixed");
  });
});

// ─── Switch ────────────────────────────────────────────────────
describe("Switch", () => {
  it("renders role=switch and toggles aria-checked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch onChange={onChange}>Wifi</Switch>);
    const sw = screen.getByRole("switch", { name: "Wifi" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await user.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });
});

// ─── RadioGroup ────────────────────────────────────────────────
describe("RadioGroup", () => {
  it("arrow keys select + roving tabindex, and wrap around", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RadioGroup aria-label="color" defaultValue="r" onChange={onChange}>
        <Radio value="r">Red</Radio>
        <Radio value="g">Green</Radio>
        <Radio value="b">Blue</Radio>
      </RadioGroup>,
    );
    const red = screen.getByRole("radio", { name: "Red" });
    const green = screen.getByRole("radio", { name: "Green" });
    const blue = screen.getByRole("radio", { name: "Blue" });

    // selected radio is the single tab stop (roving tabindex)
    expect(red.getAttribute("tabindex")).toBe("0");
    expect(green.getAttribute("tabindex")).toBe("-1");

    red.focus();
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("g");
    expect(green.getAttribute("aria-checked")).toBe("true");
    expect(green.getAttribute("tabindex")).toBe("0");
    expect(red.getAttribute("tabindex")).toBe("-1");

    // wrap: ArrowRight from Blue (last) → Red (first)
    blue.focus();
    await user.keyboard("{ArrowRight}"); // green→...; move from blue
    // ensure we're on blue first
    blue.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("r");
  });

  // (#187) the document-order ring used to only ever grow
  it("drops unmounted radios from the arrow-key ring", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const group = (values: string[]) => (
      <RadioGroup aria-label="n" defaultValue="0" onChange={onChange}>
        {values.map((v) => (
          <Radio key={v} value={v}>{v}</Radio>
        ))}
      </RadioGroup>
    );
    const { rerender } = render(group(["0", "1", "2"]));
    rerender(group(["0", "1"]));
    screen.getByRole("radio", { name: "0" }).focus();
    await user.keyboard("{ArrowUp}"); // wraps to the last MOUNTED radio
    expect(onChange).toHaveBeenLastCalledWith("1");
  });

  // (#187) the fallback tab stop pointed at a radio that no longer exists
  it("keeps a tab stop when the first radio unmounts", () => {
    const { rerender } = render(
      <RadioGroup aria-label="n">
        <Radio value="a">A</Radio>
        <Radio value="b">B</Radio>
      </RadioGroup>,
    );
    rerender(
      <RadioGroup aria-label="n">
        <Radio value="b">B</Radio>
      </RadioGroup>,
    );
    expect(screen.getByRole("radio", { name: "B" }).getAttribute("tabindex")).toBe("0");
  });

  // (#188) a disabled <button> can't take focus — selecting it strands the user
  it("skips disabled radios when arrowing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RadioGroup aria-label="color" defaultValue="r" onChange={onChange}>
        <Radio value="r">Red</Radio>
        <Radio value="g" disabled>Green</Radio>
        <Radio value="b">Blue</Radio>
      </RadioGroup>,
    );
    screen.getByRole("radio", { name: "Red" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("b");
    expect(screen.getByRole("radio", { name: "Green" }).getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Blue" }));
  });

  // (#188) …and it can't hold the group's only tab stop either
  it("does not park the fallback tab stop on a disabled radio", () => {
    render(
      <RadioGroup aria-label="color">
        <Radio value="r" disabled>Red</Radio>
        <Radio value="g">Green</Radio>
      </RadioGroup>,
    );
    expect(screen.getByRole("radio", { name: "Red" }).getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("radio", { name: "Green" }).getAttribute("tabindex")).toBe("0");
  });
});

// ─── Select ────────────────────────────────────────────────────
const OPTIONS = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
];

describe("Select", () => {
  it("renders a combobox trigger that is collapsed by default", () => {
    render(<Select options={OPTIONS} aria-label="fruit" />);
    const trigger = screen.getByRole("combobox", { name: "fruit" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("applies an option's presentation style to its popup row", async () => {
    const user = userEvent.setup();
    render(<Select options={[{ value: "georgia", label: "Georgia", style: { fontFamily: "Georgia, serif", fontSize: 24, minHeight: 38 } }]} aria-label="font" />);
    await user.click(screen.getByRole("combobox", { name: "font" }));
    const option = screen.getByRole("option", { name: "Georgia" }) as HTMLElement;
    expect(option.style.fontFamily).toBe("Georgia, serif");
    expect(option.style.fontSize).toBe("24px");
    expect(option.style.minHeight).toBe("38px");
  });

  it("opens, moves active option (aria-activedescendant), selects with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select options={OPTIONS} aria-label="fruit" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "fruit" });
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);

    // no selection → first enabled (apple) is active
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      within(listbox).getByRole("option", { name: "Apple" }).id,
    );
    await user.keyboard("{ArrowDown}"); // → banana
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      within(listbox).getByRole("option", { name: "Banana" }).id,
    );
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("banana");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("typeahead jumps to a matching option", async () => {
    const user = userEvent.setup();
    render(<Select options={OPTIONS} aria-label="fruit" />);
    const trigger = screen.getByRole("combobox", { name: "fruit" });
    await user.click(trigger);
    const listbox = screen.getByRole("listbox");
    await user.keyboard("c"); // → Cherry
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      within(listbox).getByRole("option", { name: "Cherry" }).id,
    );
  });

  it("Escape closes the listbox", async () => {
    const user = userEvent.setup();
    render(<Select options={OPTIONS} aria-label="fruit" />);
    const trigger = screen.getByRole("combobox", { name: "fruit" });
    await user.click(trigger);
    expect(screen.getByRole("listbox")).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("marks the selected option with aria-selected", async () => {
    const user = userEvent.setup();
    render(<Select options={OPTIONS} aria-label="fruit" defaultValue="banana" />);
    const trigger = screen.getByRole("combobox", { name: "fruit" });
    await user.click(trigger);
    const listbox = screen.getByRole("listbox");
    expect(
      within(listbox)
        .getByRole("option", { name: "Banana" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      within(listbox)
        .getByRole("option", { name: "Apple" })
        .getAttribute("aria-selected"),
    ).toBe("false");
  });
  it("portals the listbox out of a clipping ancestor and commits a click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <div style={{ overflow: "hidden", height: 10 }}>
        <Select options={OPTIONS} aria-label="fruit" onChange={onChange} />
      </div>,
    );
    await user.click(screen.getByRole("combobox", { name: "fruit" }));
    const listbox = screen.getByRole("listbox");
    expect(container.contains(listbox)).toBe(false);
    expect(document.getElementById("monet-overlay-root")!.contains(listbox)).toBe(true);
    await user.click(within(listbox).getByRole("option", { name: "Cherry" }));
    expect(onChange).toHaveBeenCalledWith("cherry");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on a press outside both trigger and listbox", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>elsewhere</button>
        <Select options={OPTIONS} aria-label="fruit" />
      </>,
    );
    await user.click(screen.getByRole("combobox", { name: "fruit" }));
    expect(screen.getByRole("listbox")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("passes title, style and data-* through and exposes the value", async () => {
    const user = userEvent.setup();
    render(<Select options={OPTIONS} aria-label="fruit" defaultValue="banana" title="Pick" style={{ width: 90 }} data-field="fruit" />);
    const trigger = screen.getByRole("combobox", { name: "fruit" });
    expect(trigger.getAttribute("title")).toBe("Pick");
    expect(trigger.getAttribute("data-field")).toBe("fruit");
    expect(trigger.getAttribute("data-value")).toBe("banana");
    expect((trigger.parentElement as HTMLElement).style.width).toBe("90px");
    await user.click(trigger);
    expect(screen.getByRole("option", { name: "Cherry" }).getAttribute("data-value")).toBe("cherry");
  });

  it("keeps the keys it consumes from reaching an ancestor's key handler", async () => {
    const user = userEvent.setup();
    const onAncestorKey = vi.fn();
    const onChange = vi.fn();
    render(
      <div onKeyDown={(e) => onAncestorKey(e.key)}>
        <Select options={OPTIONS} aria-label="fruit" onChange={onChange} />
      </div>,
    );
    screen.getByRole("combobox", { name: "fruit" }).focus();
    await user.keyboard("{ArrowDown}{ArrowDown}c{Enter}");
    expect(onChange).toHaveBeenCalledWith("cherry");
    expect(onAncestorKey).not.toHaveBeenCalled();
    await user.keyboard("{Escape}"); // closed: not the Select's key
    expect(onAncestorKey).toHaveBeenCalledWith("Escape");
  });

  it("fires no change for a no-op gesture: re-choosing the value, or Tab without moving", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select options={OPTIONS} aria-label="fruit" value="banana" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "fruit" });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Banana" }));
    await user.keyboard("{ArrowDown}{Enter}"); // open on Banana, Enter re-picks it
    await user.keyboard("{ArrowDown}{Tab}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("on Tab commits only an option the user moved to, even from a placeholder", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select options={OPTIONS} aria-label="fruit" value="" placeholder="Add…" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "fruit" });
    trigger.focus();
    await user.keyboard("{ArrowDown}{Tab}"); // opens on Apple; Tab away adds nothing
    expect(onChange).not.toHaveBeenCalled();
    trigger.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Tab}");
    expect(onChange).toHaveBeenCalledWith("banana");
  });

  it("opens on a disabled current value, which Enter cannot commit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const options = [{ value: "a", label: "A" }, { value: "custom", label: "Custom", disabled: true }, { value: "b", label: "B" }];
    render(<Select options={options} aria-label="set" value="custom" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "set" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Custom" }).id);
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes once a scroll carries the trigger out of its container's view", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scroller" style={{ overflow: "auto" }}>
        <Select options={OPTIONS} aria-label="fruit" />
      </div>,
    );
    const trigger = screen.getByRole("combobox", { name: "fruit" });
    const scroller = screen.getByTestId("scroller");
    await user.click(trigger);
    // jsdom has no layout: an in-view scroll (all-zero rects) keeps it open…
    fireEvent.scroll(scroller);
    expect(screen.queryByRole("listbox")).not.toBeNull();
    // …a scroll that leaves the trigger above the container's top closes it.
    scroller.getBoundingClientRect = () => ({ top: 100, bottom: 300, left: 0, right: 200 }) as DOMRect;
    trigger.getBoundingClientRect = () => ({ top: 40, bottom: 68, left: 0, right: 100 }) as DOMRect;
    fireEvent.scroll(scroller);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
