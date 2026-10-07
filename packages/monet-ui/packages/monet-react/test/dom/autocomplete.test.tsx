// DOM tests for Autocomplete (controls-autocomplete.tsx). jsdom has no layout —
// these assert roles, ARIA, focus and callbacks only. No jest-dom.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Autocomplete, type AutocompleteProps } from "../../src/controls.tsx";

const SUGGESTIONS: AutocompleteProps["suggestions"] = [
  "Banana",
  "Mango",
  "Cherry",
  { value: "adj.brightnessContrast", label: "Brightness Contrast" },
];

function Host(props: Partial<AutocompleteProps> & { initial?: string; spy?: (v: string) => void }) {
  const { initial = "", spy, ...rest } = props;
  const [v, setV] = useState(initial);
  return (
    <Autocomplete
      aria-label="field"
      suggestions={SUGGESTIONS}
      {...rest}
      value={v}
      onChange={(next) => {
        spy?.(next);
        setV(next);
      }}
    />
  );
}

const input = () => screen.getByRole("combobox", { name: "field" }) as HTMLInputElement;
const optionNames = () =>
  within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.getAttribute("data-value"));

describe("Autocomplete", () => {
  it("renders a combobox input and filters by value or label, case-insensitively", async () => {
    const user = userEvent.setup();
    render(<Host className="app-field" data-x="1" />);
    const el = input();
    expect(el.tagName).toBe("INPUT");
    expect(el.className).toBe("app-field");
    expect(el.getAttribute("data-x")).toBe("1");
    expect(el.getAttribute("aria-autocomplete")).toBe("list");
    await user.type(el, "AN");
    expect(el.getAttribute("aria-expanded")).toBe("true");
    expect(el.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    expect(optionNames()).toEqual(["Banana", "Mango"]);
    await user.clear(el);
    await user.type(el, "bright");
    const opt = screen.getByRole("option");
    expect(opt.getAttribute("data-value")).toBe("adj.brightnessContrast");
    expect(opt.textContent).toContain("Brightness Contrast");
  });

  it("hides the list when nothing matches or the only match is already typed", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(input(), "zzz");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.clear(input());
    await user.type(input(), "Cherry");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("ArrowDown/Up move the active option and Enter picks it without reaching onKeyDown", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const onKeyDown = vi.fn();
    render(<Host spy={spy} onKeyDown={onKeyDown} />);
    await user.type(input(), "an");
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}");
    const active = screen.getByRole("option", { name: "Mango" });
    expect(input().getAttribute("aria-activedescendant")).toBe(active.id);
    await user.keyboard("{Enter}");
    expect(spy).toHaveBeenLastCalledWith("Mango");
    expect(input().value).toBe("Mango");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onKeyDown.mock.calls.some(([e]) => e.key === "Enter")).toBe(false);
  });

  it("forwards Enter to onKeyDown when no option is active", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    render(<Host onKeyDown={onKeyDown} />);
    await user.type(input(), "an{Enter}");
    expect(onKeyDown.mock.calls.some(([e]) => e.key === "Enter")).toBe(true);
  });

  it("picks a clicked option without blurring the input", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const onBlur = vi.fn();
    render(<Host spy={spy} onBlur={onBlur} />);
    await user.type(input(), "ch");
    await user.click(screen.getByRole("option", { name: "Cherry" }));
    expect(spy).toHaveBeenLastCalledWith("Cherry");
    expect(onBlur).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes the open list without bubbling to a host; a second Escape does", async () => {
    const user = userEvent.setup();
    const hostEscape = vi.fn();
    const onDocKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && hostEscape();
    document.addEventListener("keydown", onDocKey);
    try {
      render(<Host />);
      await user.type(input(), "an");
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(hostEscape).not.toHaveBeenCalled();
      await user.keyboard("{Escape}");
      expect(hostEscape).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", onDocKey);
    }
  });

  it("portals the list out of a clipping ancestor and closes on a press outside", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <button>elsewhere</button>
        <div style={{ overflow: "hidden", height: 10 }}>
          <Host />
        </div>
      </>,
    );
    await user.click(input());
    const listbox = screen.getByRole("listbox");
    expect(container.contains(listbox)).toBe(false);
    expect(document.getElementById("monet-overlay-root")!.contains(listbox)).toBe(true);
    expect(listbox.className).toBe("monet-listbox");
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
