// DOM tests for the creative vector tool groups (creative-vector.tsx).
// jsdom has no layout — these assert ROLES, ARIA, state, and callbacks.
// Roving-tabindex paths fire keyboard events and assert focus moved; click
// paths assert the on*-family callbacks fired with the right values.
// No jest-dom: assertions read DOM properties/attributes directly.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  Pathfinder,
  AlignBar,
  PATHFINDER_ICONS,
  ALIGN_ICONS,
  ALIGN_ACTIONS,
  type AlignAction,
} from "../../src/creative-vector.tsx";

// ─── icon constant maps ────────────────────────────────────────
describe("vector glyph constants", () => {
  it("PATHFINDER_ICONS exposes the four boolean modes as path strings", () => {
    for (const key of ["unite", "minus", "intersect", "exclude"] as const) {
      expect(typeof PATHFINDER_ICONS[key]).toBe("string");
      expect(PATHFINDER_ICONS[key].length).toBeGreaterThan(0);
    }
  });

  it("ALIGN_ICONS covers every ALIGN_ACTIONS entry", () => {
    expect(ALIGN_ACTIONS).toHaveLength(8);
    for (const action of ALIGN_ACTIONS) {
      expect(typeof ALIGN_ICONS[action]).toBe("string");
      expect(ALIGN_ICONS[action].length).toBeGreaterThan(0);
    }
  });
});

// ─── Pathfinder ────────────────────────────────────────────────
describe("Pathfinder", () => {
  it("renders default shape-mode tiles in a group and default operation chips", () => {
    render(<Pathfinder aria-label="pf" />);
    const group = screen.getByRole("group", { name: "Shape modes" });
    // four default modes, each an aria-pressed button
    expect(within(group).getByRole("button", { name: "Unite" })).not.toBeNull();
    expect(within(group).getByRole("button", { name: "Minus front" })).not.toBeNull();
    expect(within(group).getByRole("button", { name: "Intersect" })).not.toBeNull();
    expect(within(group).getByRole("button", { name: "Exclude" })).not.toBeNull();
    // six default operations
    expect(screen.getByRole("button", { name: "Divide" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Minus Back" })).not.toBeNull();
  });

  it("shape-mode buttons expose aria-pressed driven by activeMode", () => {
    render(<Pathfinder activeMode="intersect" />);
    const intersect = screen.getByRole("button", { name: "Intersect" });
    const unite = screen.getByRole("button", { name: "Unite" });
    expect(intersect.getAttribute("aria-pressed")).toBe("true");
    expect(unite.getAttribute("aria-pressed")).toBe("false");
    expect(intersect.className).toContain("is-active");
  });

  it("pressing a mode fires onMode with its value; re-pressing the active one clears to null", async () => {
    const user = userEvent.setup();
    const onMode = vi.fn();
    render(<Pathfinder activeMode="unite" onMode={onMode} />);
    await user.click(screen.getByRole("button", { name: "Minus front" }));
    expect(onMode).toHaveBeenLastCalledWith("minus");
    // re-press the currently-active mode → null
    await user.click(screen.getByRole("button", { name: "Unite" }));
    expect(onMode).toHaveBeenLastCalledWith(null);
  });

  it("fires onOperation with the activated operation value", async () => {
    const user = userEvent.setup();
    const onOperation = vi.fn();
    render(<Pathfinder onOperation={onOperation} />);
    await user.click(screen.getByRole("button", { name: "Trim" }));
    expect(onOperation).toHaveBeenCalledWith("trim");
  });

  it("respects custom shapeModes / operations and disabled operations", async () => {
    const user = userEvent.setup();
    const onOperation = vi.fn();
    render(
      <Pathfinder
        shapeModes={[{ value: "u", label: "Union", icon: PATHFINDER_ICONS.unite }]}
        operations={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta", disabled: true },
        ]}
        onOperation={onOperation}
      />,
    );
    expect(screen.getByRole("button", { name: "Union" })).not.toBeNull();
    const beta = screen.getByRole("button", { name: "Beta" }) as HTMLButtonElement;
    expect(beta.disabled).toBe(true);
    await user.click(beta);
    expect(onOperation).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Alpha" }));
    expect(onOperation).toHaveBeenCalledWith("a");
  });
});

// ─── AlignBar ──────────────────────────────────────────────────
describe("AlignBar", () => {
  it("renders a toolbar of all eight labelled align/distribute buttons", () => {
    render(<AlignBar />);
    const bar = screen.getByRole("toolbar", { name: "Align" });
    expect(bar.getAttribute("aria-orientation")).toBe("horizontal");
    for (const name of [
      "Align left",
      "Align center",
      "Align right",
      "Align top",
      "Align middle",
      "Align bottom",
      "Distribute horizontally",
      "Distribute vertically",
    ]) {
      expect(within(bar).getByRole("button", { name })).not.toBeNull();
    }
  });

  it("marks the active action with aria-pressed and the others false", () => {
    render(<AlignBar active="center-h" />);
    const center = screen.getByRole("button", { name: "Align center" });
    const left = screen.getByRole("button", { name: "Align left" });
    expect(center.getAttribute("aria-pressed")).toBe("true");
    expect(left.getAttribute("aria-pressed")).toBe("false");
    expect(center.className).toContain("is-active");
  });

  it("fires onAlign with the action value on click", async () => {
    const user = userEvent.setup();
    const onAlign = vi.fn();
    render(<AlignBar onAlign={onAlign} />);
    await user.click(screen.getByRole("button", { name: "Distribute vertically" }));
    expect(onAlign).toHaveBeenCalledWith<[AlignAction]>("dist-v");
  });

  it("uses a roving tabindex: only one button is tabbable, the active one when set", () => {
    render(<AlignBar active="right" />);
    const right = screen.getByRole("button", { name: "Align right" });
    const left = screen.getByRole("button", { name: "Align left" });
    expect(right.getAttribute("tabindex")).toBe("0");
    expect(left.getAttribute("tabindex")).toBe("-1");
  });

  it("defaults the tab stop to the first button when nothing is active", () => {
    render(<AlignBar />);
    const left = screen.getByRole("button", { name: "Align left" });
    expect(left.getAttribute("tabindex")).toBe("0");
  });

  it("ArrowRight/ArrowLeft move focus along a horizontal toolbar", () => {
    render(<AlignBar />);
    const left = screen.getByRole("button", { name: "Align left" });
    const center = screen.getByRole("button", { name: "Align center" });
    left.focus();
    fireEvent.keyDown(left, { key: "ArrowRight" });
    expect(document.activeElement).toBe(center);
    fireEvent.keyDown(center, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(left);
  });

  it("ArrowDown moves focus on a vertical toolbar; Home/End jump to the ends", () => {
    render(<AlignBar orientation="vertical" />);
    const bar = screen.getByRole("toolbar", { name: "Align" });
    expect(bar.getAttribute("aria-orientation")).toBe("vertical");
    const first = screen.getByRole("button", { name: "Align left" });
    const second = screen.getByRole("button", { name: "Align center" });
    const last = screen.getByRole("button", { name: "Distribute vertically" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "End" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });

  it("renders only the requested actions, in order", () => {
    render(<AlignBar actions={["top", "bottom"]} />);
    const bar = screen.getByRole("toolbar", { name: "Align" });
    const buttons = within(bar).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute("aria-label")).toBe("Align top");
    expect(buttons[1].getAttribute("aria-label")).toBe("Align bottom");
  });

  it("renders a relative-to Select when onRelativeToChange is supplied and fires it", async () => {
    const user = userEvent.setup();
    const onRelativeToChange = vi.fn();
    render(<AlignBar onRelativeToChange={onRelativeToChange} />);
    const select = screen.getByRole("combobox", { name: "Align to" });
    await user.click(select);
    await user.click(screen.getByRole("option", { name: "Artboard" }));
    expect(onRelativeToChange).toHaveBeenCalledWith("artboard");
  });

  it("omits the relative-to control by default", () => {
    render(<AlignBar />);
    expect(screen.queryByRole("combobox", { name: "Align to" })).toBeNull();
  });

  it("renders labelled chips when showLabels is set", () => {
    render(<AlignBar showLabels actions={["left"]} />);
    const btn = screen.getByRole("button", { name: "Align left" });
    expect(btn.className).toContain("monet-chip");
    // the visible label text is present alongside the glyph
    expect(btn.textContent).toContain("Align left");
  });

  it("supports a controlled active selection from a host", async () => {
    const user = userEvent.setup();
    function Host() {
      const [active, setActive] = useState<AlignAction>("left");
      return <AlignBar active={active} onAlign={setActive} />;
    }
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Align right" }));
    const right = screen.getByRole("button", { name: "Align right" });
    expect(right.getAttribute("aria-pressed")).toBe("true");
    expect(right.getAttribute("tabindex")).toBe("0");
  });
});
