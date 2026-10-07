// Guards VIS-SEL-08: the Channels panel can target a channel. Targeting an alpha
// channel routes it through the Quick Mask buffer — the engine's one paintable,
// canvas-visible grayscale plane — so the classic "duplicate a channel, paint it,
// load it as a selection" workflow is reachable. The engine ops themselves
// (load/save_selection, enter/exit_quick_mask, duplicate_channel) are covered in
// packages/engine; this asserts the store's round-trip and the display maths.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, channelPlaneThumb } from "./store";
import { quickMaskPixel, setQuickMaskOverlay } from "./quickMaskOverlay";

type Call = [string, ...unknown[]];

function storeWith() {
  const calls: Call[] = [];
  let qm = false;
  // The undo stack the real engine keeps: each op pushes its own labelled state
  // (mod.rs "Duplicate Channel" / "Load Selection" / "Delete Channel"),
  // `undo_pushes` is monotonic and `drop_last_undo` pops the newest.
  const undo: string[] = [];
  let pushes = 0;
  const push = (label: string) => { undo.push(label); pushes++; };
  const eng = {
    undo,
    set_history_states: () => {},
    drop_last_undo: () => { undo.pop(); },
    undo_pushes: () => pushes,
    quick_mask_on: () => qm,
    enter_quick_mask: () => { qm = true; calls.push(["enter"]); },
    exit_quick_mask: () => { qm = false; calls.push(["exit"]); },
    load_selection: (name: string, mode: number) => { calls.push(["load", name, mode]); push("Load Selection"); },
    save_selection: (name: string) => calls.push(["save", name]),
    duplicate_channel: (channel: number, name: string) => { calls.push(["duplicate", channel, name]); push("Duplicate Channel"); },
    delete_saved_selection: (name: string) => { calls.push(["delete", name]); push("Delete Channel"); },
  };
  const client = { engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null };
  return { store: new Store(client as never), calls, undo };
}

afterEach(() => setQuickMaskOverlay(null));

describe("channel targeting", () => {
  it("loads the targeted channel into the mask buffer", () => {
    const { store, calls } = storeWith();
    store.targetChannel("Alpha 1");
    expect(calls).toEqual([["load", "Alpha 1", 0], ["enter"]]);
    expect(store.state.channelTarget).toBe("Alpha 1");
  });

  it("writes the edited buffer back before switching targets", () => {
    const { store, calls } = storeWith();
    store.targetChannel("Alpha 1");
    calls.length = 0;
    store.targetChannel("Alpha 2");
    expect(calls).toEqual([["exit"], ["save", "Alpha 1"], ["load", "Alpha 2", 0], ["enter"]]);
    expect(store.state.channelTarget).toBe("Alpha 2");
  });

  it("writes back and leaves Quick Mask when the composite is retargeted", () => {
    const { store, calls } = storeWith();
    store.targetChannel("Alpha 1");
    calls.length = 0;
    store.targetChannel(null);
    expect(calls).toEqual([["exit"], ["save", "Alpha 1"]]);
    expect(store.state.channelTarget).toBeNull();
  });

  it("writes back when Quick Mask is toggled off with Q", () => {
    // The data-loss case: without the write-back the painted channel would only
    // become a selection and the channel would keep its pre-edit bytes.
    const { store, calls } = storeWith();
    store.targetChannel("Alpha 1");
    calls.length = 0;
    store.toggleQuickMask();
    expect(calls).toEqual([["exit"], ["save", "Alpha 1"]]);
    expect(store.state.channelTarget).toBeNull();
  });

  it("does nothing when the channel is already targeted", () => {
    const { store, calls } = storeWith();
    store.targetChannel("Alpha 1");
    calls.length = 0;
    store.targetChannel("Alpha 1");
    expect(calls).toEqual([]);
  });

  it("loads a document plate as a selection through a scratch channel", () => {
    const { store, calls, undo } = storeWith();
    store.loadChannelAsSelection(2);
    expect(calls.map((c) => c[0])).toEqual(["duplicate", "load", "delete"]);
    expect(calls[0][1]).toBe(2);
    expect(calls[0][2]).toBe(calls[2][1]); // the scratch channel is dropped again
    // (#85) One click, one undo step: the scratch channel's create/drop pair
    // used to leave "Duplicate Channel"/"Delete Channel" behind, so the first
    // ⌘Z resurrected the hidden channel instead of reverting the selection.
    expect(undo).toEqual(["Load Selection"]);
  });
});

describe("channel options", () => {
  it("drives the on-canvas overlay of the targeted channel", () => {
    const { store } = storeWith();
    store.targetChannel("Alpha 1");
    store.setChannelOptions("Alpha 1", { color: "#0000ff", opacity: 1 });
    expect(quickMaskPixel(0)).toEqual({ r: 0, g: 0, b: 255, a: 255 }); // masked → full blue
    expect(quickMaskPixel(255).a).toBe(0); // selected → clear
  });

  it("inverts the tint for Color Indicates: Selected Areas", () => {
    const { store } = storeWith();
    store.targetChannel("Alpha 1");
    store.setChannelOptions("Alpha 1", { indicates: "selected", opacity: 1 });
    expect(quickMaskPixel(255).a).toBe(255);
    expect(quickMaskPixel(0).a).toBe(0);
  });

  it("shows the plane alone, in grayscale, when the eye is on", () => {
    const { store } = storeWith();
    store.targetChannel("Alpha 1");
    store.setChannelAlone(true);
    expect(quickMaskPixel(128)).toEqual({ r: 128, g: 128, b: 128, a: 255 });
  });

  it("keeps the Photoshop defaults once no channel is targeted", () => {
    const { store } = storeWith();
    store.targetChannel("Alpha 1");
    store.setChannelOptions("Alpha 1", { color: "#0000ff", opacity: 1 });
    store.targetChannel(null);
    expect(quickMaskPixel(0)).toEqual({ r: 255, g: 0, b: 0, a: 128 });
  });

  it("remembers each channel's options", () => {
    const { store } = storeWith();
    store.setChannelOptions("Alpha 2", { color: "#00ff00" });
    expect(store.channelOptionsFor("Alpha 2").color).toBe("#00ff00");
    expect(store.channelOptionsFor("Alpha 2").indicates).toBe("masked"); // unpatched fields keep the default
    expect(store.channelOptionsFor("Alpha 1").color).toBe("#ff0000");
  });
});

describe("channel thumbnails", () => {
  const src = [255, 0, 0, 255, 0, 0, 255, 255]; // one red pixel, one blue

  it("samples one document plate into an opaque grayscale thumbnail", () => {
    const red = channelPlaneThumb(src, 2, 1, 2, 1, 0, 1);
    expect([...red]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    const blue = channelPlaneThumb(src, 2, 1, 2, 1, 0, 3);
    expect([...blue]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it("falls back to composite luminance for channel 0 and for Grayscale", () => {
    expect(channelPlaneThumb(src, 2, 1, 2, 1, 0, 0)[0]).toBe(Math.round(255 * 0.299));
    expect(channelPlaneThumb(src, 2, 1, 2, 1, 1, 1)[4]).toBe(Math.round(255 * 0.114));
  });

  it("separates CMYK and Lab plates, not RGB bytes", () => {
    const cyan = channelPlaneThumb(src, 2, 1, 2, 1, 2, 1); // C of pure red is 0%
    expect(cyan[0]).toBe(0);
    expect(channelPlaneThumb(src, 2, 1, 2, 1, 2, 2)[0]).toBe(255); // M of pure red is 100%
    const lightness = channelPlaneThumb(src, 2, 1, 2, 1, 3, 1); // L* of red ≈ 53
    expect(lightness[0]).toBeGreaterThan(100);
    expect(lightness[0]).toBeLessThan(160);
  });

  it("nearest-neighbour samples down to the thumbnail box", () => {
    // Four pixels — red, red, blue, blue — sampled into two: one per half.
    const wide = [...src.slice(0, 4), ...src.slice(0, 4), ...src.slice(4), ...src.slice(4)];
    const half = channelPlaneThumb(wide, 4, 1, 2, 1, 0, 1);
    expect([...half]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });
});
