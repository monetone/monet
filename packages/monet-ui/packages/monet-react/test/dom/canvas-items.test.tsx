// DOM tests for the DesignCanvas section / artboard chrome (canvas-items.tsx).
// jsdom has no layout, so the drag-reorder assertions are about LIFECYCLE (does
// the drag start, does it end) rather than about where anything landed.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { DCArtboard, DCSection } from "../../src/canvas-items.tsx";
import { DesignCanvas } from "../../src/canvas.tsx";

function renderSection(title: string) {
  return render(
    <DCSection title={title}>
      <DCArtboard id="a1" label="A1" />
      <DCArtboard id="a2" label="A2" />
    </DCSection>,
  );
}

describe("DCSection grip drag-reorder", () => {
  // (#208) sectionId (which falls back to the human-authored title) used to be
  // interpolated into a querySelectorAll attribute selector: a quote in the
  // title made it throw SyntaxError out of the pointerdown handler, so the drag
  // never started and reorder was dead for that section.
  it("starts a drag when the section title contains a quote", () => {
    const { container } = renderSection('Nav — 12" tablet');
    fireEvent.pointerDown(screen.getByRole("button", { name: /^Reorder A1/ }), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    const slot = container.querySelector<HTMLElement>('[data-dc-slot="a1"]')!;
    expect(slot.classList.contains("monet-dc-dragging")).toBe(true);
  });

  // (#204) pointercancel fires INSTEAD of pointerup when the browser takes the
  // pointer over; without it `up()` never ran, so the row kept its drag class +
  // transform, the document listeners leaked and the reorder was dropped.
  it("ends the drag on pointercancel", () => {
    const { container } = renderSection("Nav");
    fireEvent.pointerDown(screen.getByRole("button", { name: /^Reorder A1/ }), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    const slot = container.querySelector<HTMLElement>('[data-dc-slot="a1"]')!;
    expect(slot.classList.contains("monet-dc-dragging")).toBe(true);
    fireEvent.pointerCancel(document);
    expect(slot.classList.contains("monet-dc-dragging")).toBe(false);
    // the move listener is gone too — a later move must not re-transform the row
    slot.style.transform = "";
    fireEvent.pointerMove(document, { clientX: 400, clientY: 0 });
    expect(slot.style.transform).toBe("");
  });
});

describe("DCArtboard ⋯ menu", () => {
  // The menu used to be position:absolute inside the viewport (overflow:hidden)
  // and the world's transform, so an artboard near an edge clipped it.
  it("portals out of the canvas, keeps two-click delete, and closes outside", () => {
    const { container } = renderSection("Nav");
    const kebab = screen.getAllByRole("button", { name: "Artboard actions" })[0]!;
    fireEvent.click(kebab);
    const menu = screen.getByRole("menu", { name: "Artboard actions" });
    expect(container.contains(menu)).toBe(false);
    expect(document.getElementById("monet-overlay-root")!.contains(menu)).toBe(true);
    // arming the delete row is a press inside the menu: it stays open
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("menuitem", { name: "Click again to delete" })).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(kebab.getAttribute("aria-expanded")).toBe("false");
  });

  it("follows its artboard when the canvas pans", async () => {
    render(
      <DesignCanvas bridge={{}}>
        <DCSection id="s1" title="Section">
          <DCArtboard id="a1" label="A1" />
        </DCSection>
      </DesignCanvas>,
    );
    const kebab = await screen.findByRole("button", { name: "Artboard actions" });
    fireEvent.click(kebab);
    const menu = screen.getByRole("menu", { name: "Artboard actions" });
    // jsdom has no layout: pretend the pan carried the kebab to (300, 200).
    kebab.getBoundingClientRect = () => ({ left: 290, right: 300, top: 190, bottom: 200, width: 10, height: 10 }) as DOMRect;
    // A two-finger trackpad scroll (fractional deltas) pans the viewport.
    fireEvent.wheel(document.querySelector(".monet-dc-viewport")!, { deltaX: 0.5, deltaY: 1.5 });
    expect(menu.style.top).toBe("204px"); // bottom + 4px offset
  });
});
