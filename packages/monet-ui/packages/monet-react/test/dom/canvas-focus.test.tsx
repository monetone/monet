// DOM tests for the DesignCanvas focus overlay (canvas-focus.tsx). jsdom has no
// layout — these assert event handling only (key routing + wheel suppression).
// The overlay portals into #monet-overlay-root, which setup.ts clears per test.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DesignCanvas } from "../../src/canvas.tsx";
import { DCFocusOverlay } from "../../src/canvas-focus.tsx";
import { DCArtboard, DCSection } from "../../src/canvas-items.tsx";

function renderOverlay() {
  return render(
    <DCFocusOverlay
      entry={{
        sectionId: "s1",
        artboard: (
          <DCArtboard id="a1" label="A1">
            <input aria-label="field" />
          </DCArtboard>
        ),
      }}
      sectionMeta={{ s1: { title: "Section", slotIds: ["a1", "a2"] } }}
      sectionOrder={["s1"]}
    />,
  );
}

describe("DCFocusOverlay", () => {
  // (#181) The overlay binds a document-level keydown; it must not swallow keys
  // typed into a field inside the focused artboard (it renders arbitrary
  // children, so text entry is a supported scenario).
  it("leaves Arrow/Escape alone when they come from an editable surface", () => {
    renderOverlay();
    const input = screen.getByLabelText("field");
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"]) {
      // fireEvent returns false when the handler called preventDefault()
      expect(fireEvent.keyDown(input, { key })).toBe(true);
    }
  });

  it("still handles Arrow/Escape navigation outside a field", () => {
    renderOverlay();
    const surface = document.querySelector<HTMLElement>(".monet-dc-focus")!;
    expect(fireEvent.keyDown(surface, { key: "ArrowRight" })).toBe(false);
    expect(fireEvent.keyDown(surface, { key: "Escape" })).toBe(false);
  });

  it("keeps DesignCanvas focus open when Escape comes from a field", async () => {
    render(
      <DesignCanvas bridge={{}}>
        <DCSection id="s1" title="Section">
          <DCArtboard id="a1" label="A1"><input aria-label="canvas field" /></DCArtboard>
        </DCSection>
      </DesignCanvas>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open A1 in focus view" }));
    const field = document.querySelector<HTMLInputElement>(".monet-dc-focus input")!;
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".monet-dc-focus")).not.toBeNull());
  });

  // (#182) React binds `wheel` at the root with {passive:true}, so an
  // onWheel={e => e.preventDefault()} was a silent no-op — the modal needs a
  // native non-passive listener to suppress the background scroll.
  it("suppresses wheel over the overlay surface", () => {
    renderOverlay();
    const surface = document.querySelector<HTMLElement>(".monet-dc-focus")!;
    const ev = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    surface.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
