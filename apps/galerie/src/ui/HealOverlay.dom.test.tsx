// @vitest-environment happy-dom
// HealOverlay — a pick in the bar's Heal mode dropdown must not also count as a
// canvas press. The dropdown's options are portalled out of the overlay's DOM
// but still bubble React pointer events through it.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HealPanel } from "@monet-ui/monet-photo";
import { HealOverlay } from "./HealOverlay";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const pointer = (el: Element, type: string, clientX: number, clientY: number) =>
  act(() => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY, pointerId: 1 }));
  });

describe("HealOverlay Heal mode dropdown", () => {
  it("switches the selected spot to Clone without placing a stray spot", () => {
    HTMLElement.prototype.setPointerCapture ??= () => {};
    const spot = { x: 0.5, y: 0.5, radius: 0.05, sourceX: 0.2, sourceY: 0.2, mode: "heal" as const, feather: 0.5, opacity: 1 };
    let heal: HealPanel = { spots: [spot] };
    const onChange = vi.fn((next: HealPanel) => { heal = next; draw(); });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const draw = () => root!.render(
      <HealOverlay heal={heal} onChange={onChange} onDone={() => {}} aspect={1} onDetect={() => {}}
        visualize={false} onVisualize={() => {}} threshold={0.5} onThreshold={() => {}} pickSource={() => null} />,
    );
    act(draw);
    const overlay = container.querySelector(".gal-heal-overlay")!;
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0 }) as DOMRect;

    // Press the spot to select it: the bar grows the Heal mode dropdown.
    pointer(overlay, "pointerdown", 50, 50);
    pointer(overlay, "pointerup", 50, 50);
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Heal mode"]')!;
    act(() => trigger.click());

    // Pick Clone from the portalled list, below the image.
    const clone = document.querySelector('.monet-listbox [data-value="clone"]')!;
    expect(overlay.contains(clone)).toBe(false);
    pointer(clone, "pointerdown", 50, 150);
    pointer(clone, "pointerup", 50, 150);
    act(() => (clone as HTMLElement).click());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(heal.spots).toEqual([{ ...spot, mode: "clone" }]);
  });
});
