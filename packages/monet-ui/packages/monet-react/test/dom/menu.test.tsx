// DOM tests for the MenuBar / MenuSurface keyboard model (menu.tsx).
// Hosts conventionally build their menu arrays inline (`menus={buildMenus()}`),
// so every unrelated host re-render hands the bar a fresh `items` identity —
// that must not disturb an open menu's keyboard state.

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MenuBar } from "../../src/menu.tsx";

// A fresh array + fresh item objects on every call — the cinema/jouer/galerie
// pattern (apps/cinema/src/App.tsx `menus={buildMenus()}`).
const MENUS = () => [
  { id: "file", label: "File", items: [{ id: "new", label: "New" }, { id: "save", label: "Save" }] },
  { id: "edit", label: "Edit", items: [{ id: "undo", label: "Undo" }, { id: "redo", label: "Redo" }] },
];

const activeRow = () => document.querySelector(".monet-menu-item.is-active")?.textContent;

describe("MenuBar keyboard focus", () => {
  it("keeps the focused row when the host re-renders with a new items array (#178)", () => {
    const { rerender } = render(<MenuBar menus={MENUS()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "File" }));
    expect(document.activeElement?.textContent).toContain("New");

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Save");
    expect(activeRow()).toContain("Save");

    // An unrelated host render (playhead tick, window-focus event, …) used to
    // yank focus and the highlight back to the first item.
    rerender(<MenuBar menus={MENUS()} />);
    expect(document.activeElement?.textContent).toContain("Save");
    expect(activeRow()).toContain("Save");
  });

  it("still auto-focuses the first row when the open menu switches", () => {
    render(<MenuBar menus={MENUS()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "File" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(activeRow()).toContain("Save");

    // Hovering a sibling top-level menu while one is open switches menus.
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "Edit" }));
    expect(document.activeElement?.textContent).toContain("Undo");
    expect(activeRow()).toContain("Undo");
  });
});

// A dropdown and its submenus render through the Portal, but they are still
// React CHILDREN of the surface (and of the bar) — and React bubbles events
// through the React tree, not the DOM tree. Without a containment guard every
// keystroke inside an open dropdown is replayed by its ancestors' handlers.
const NESTED = () => [
  {
    id: "file",
    label: "File",
    items: [
      { id: "new", label: "New" },
      { id: "recent", label: "Open Recent", items: [{ id: "a", label: "A.txt" }, { id: "b", label: "B.txt" }] },
    ],
  },
  { id: "edit", label: "Edit", items: [{ id: "undo", label: "Undo" }] },
];

const openMenu = (label: string) => {
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
  return document.querySelector('[role="menu"]') as HTMLElement;
};

describe("MenuBar — portalled descendants do not re-drive their ancestors", () => {
  it("ArrowDown in the dropdown does not also move the bar's own selection", () => {
    render(<MenuBar menus={NESTED()} />);
    const surface = openMenu("File");
    const barBefore = screen.getByRole("menuitem", { name: "File" }).getAttribute("tabindex");

    fireEvent.keyDown(surface, { key: "ArrowDown" });

    // The bar's ArrowDown branch opens the active menu; it must not have been
    // re-entered by the dropdown's own ArrowDown.
    expect(screen.getByRole("menuitem", { name: "File" }).getAttribute("tabindex")).toBe(barBefore);
  });

  it("ArrowRight to open a submenu does not switch the top-level menu", () => {
    render(<MenuBar menus={NESTED()} />);
    const surface = openMenu("File");

    // Opening the dropdown already lands on the first row, so one ArrowDown
    // moves onto the submenu row; ArrowRight then opens it.
    fireEvent.keyDown(surface, { key: "ArrowDown" });
    fireEvent.keyDown(surface, { key: "ArrowRight" });

    // The bar's ArrowRight branch would have moved File → Edit.
    expect(document.querySelectorAll('[role="menu"]').length).toBeGreaterThan(1);
    expect(screen.getByRole("menuitem", { name: "File" }).getAttribute("aria-expanded")).toBe("true");
  });
});
