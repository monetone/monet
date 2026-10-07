import { describe, expect, it, vi } from "vitest";
import { Store } from "./store";
import { TOOL_ACTION_SHORTCUT_DEFAULTS, isToolShortcutAllowed, toolShortcutFromEvent } from "./keyboardShortcuts";

// Photoshop's mask-thumbnail gestures: ⌥-click shows the mask alone as
// grayscale, ⇧-click disables it (red X), `\` previews it as a red rubylith
// over the image. All three are display-only — the composite is never tinted.
function storeWith(hasMask = true) {
  const e = {
    layer_has_mask: vi.fn<(...args: unknown[]) => boolean>(() => hasMask),
    layer_mask_enabled: vi.fn<(...args: unknown[]) => boolean>(() => true),
    set_layer_mask_enabled: vi.fn<(...args: unknown[]) => void>(),
    layer_mask_gray: vi.fn<(...args: unknown[]) => Uint8Array>(() => new Uint8Array([0, 128, 255, 255])),
    set_active_layer: vi.fn<(...args: unknown[]) => void>(),
    set_mask_edit: vi.fn<(...args: unknown[]) => void>(),
    set_mask_reveal: vi.fn<(...args: unknown[]) => void>(),
  };
  const client = { engine: e, e, commit: vi.fn(() => true), sync: vi.fn(), onCommit: null };
  return { store: new Store(client as never), e };
}

describe("layer mask preview", () => {
  it("⌥-click toggles the grayscale mask view on the targeted mask", () => {
    const { store } = storeWith();
    expect(store.state.maskView).toBe("off");
    store.toggleMaskGrayView(0); // 0 is already active, so no re-target
    expect(store.state.maskView).toBe("gray");
    store.toggleMaskGrayView(0);
    expect(store.state.maskView).toBe("off");
  });

  it("`\\` toggles the rubylith preview, and both previews need a mask", () => {
    const { store } = storeWith();
    store.toggleMaskRubylith();
    expect(store.state.maskView).toBe("rubylith");
    store.toggleMaskRubylith();
    expect(store.state.maskView).toBe("off");

    const bare = storeWith(false).store;
    bare.toggleMaskRubylith();
    bare.toggleMaskGrayView(0);
    expect(bare.state.maskView).toBe("off");
  });

  it("⇧-click flips the mask's enabled flag (the red X in the panel)", () => {
    const { store, e } = storeWith();
    store.toggleLayerMaskEnabled(7);
    expect(e.set_layer_mask_enabled.mock.calls[0]).toEqual([7, false]);
  });

  it("reads the mask plane from the engine only while a preview is running", () => {
    const { store, e } = storeWith();
    expect(store.layerMaskBuffer()).toBeNull();
    expect(e.layer_mask_gray).not.toHaveBeenCalled();
    store.toggleMaskRubylith();
    expect(store.layerMaskBuffer()).toEqual(new Uint8Array([0, 128, 255, 255]));
  });

  it("targeting another layer drops the preview with it", () => {
    const { store } = storeWith();
    store.toggleMaskRubylith();
    store.selectLayer(4);
    expect(store.state.maskView).toBe("off");
  });

  it("binds bare `\\` to the rubylith preview", () => {
    const event = { altKey: false, code: "Backslash", ctrlKey: false, key: "\\", metaKey: false, shiftKey: false };
    expect(toolShortcutFromEvent(event)).toBe("Backslash");
    expect(TOOL_ACTION_SHORTCUT_DEFAULTS["tool-mask-rubylith"]).toBe("Backslash");
    expect(isToolShortcutAllowed("tool-mask-rubylith", "Backslash")).toBe(true);
    // ⌘\ and ⌥\ stay with the application-menu catalog.
    expect(toolShortcutFromEvent({ ...event, metaKey: true })).toBeNull();
    expect(toolShortcutFromEvent({ ...event, altKey: true })).toBeNull();
  });
});
