// DevelopView.reset.test — GAL-DEV-18: an open DevelopView must claim the
// global Reset Adjustments event (Develop > Reset, ⇧⌘R) and reset through its
// own recipe pipeline, and must let the store fallback run while no photo is
// loaded. The store side of the handshake is pinned by DevelopPanels.reset.test.

import { createDefaultRecipe, type DevelopRecipeV2 } from "@monet-ui/monet-photo";
import { describe, expect, it, vi } from "vitest";

import { DEVELOP_RESET_EVENT } from "./DevelopPanels";
import { claimDevelopReset } from "./DevelopView";

/** The cancelable event resetDevelopAdjustments dispatches. */
function resetEvent(): Event {
  return new CustomEvent(DEVELOP_RESET_EVENT, { cancelable: true });
}

describe("claimDevelopReset (GAL-DEV-18)", () => {
  it("loaded photo: cancels the event and applies the default recipe", () => {
    const apply = vi.fn<(r: DevelopRecipeV2) => void>();
    const e = resetEvent();

    expect(claimDevelopReset(e, 7, apply)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toEqual(createDefaultRecipe());
  });

  it("no loaded photo: leaves the event unclaimed so the store fallback runs", () => {
    const apply = vi.fn<(r: DevelopRecipeV2) => void>();
    const e = resetEvent();

    expect(claimDevelopReset(e, null, apply)).toBe(false);
    expect(e.defaultPrevented).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("wired as a listener, dispatchEvent reports the claim (the contract the store checks)", () => {
    const target = new EventTarget();
    const apply = vi.fn<(r: DevelopRecipeV2) => void>();
    let loadedId: number | null = 7;
    target.addEventListener(DEVELOP_RESET_EVENT, (e) => claimDevelopReset(e, loadedId, apply));

    // dispatchEvent returns false when a listener preventDefault()s — exactly
    // what resetDevelopAdjustments keys its "view owns the recipe" branch on.
    expect(target.dispatchEvent(resetEvent())).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);

    loadedId = null;
    expect(target.dispatchEvent(resetEvent())).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
