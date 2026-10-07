// Guards #413: Select and Mask's remembered settings and the Decontaminate
// Amount that used to be binary. The workspace persists to localStorage, so a
// stale or hand-edited blob must not be able to put it in a bad state.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { SAM_DEFAULTS, normalizeSamSettings } from "./selectAndMask";
import { Store } from "./store";

describe("Select and Mask remembered settings (#413)", () => {
  it("round-trips a full settings blob", () => {
    const saved = {
      ...SAM_DEFAULTS, view: "onwhite", viewOpacity: 0.25, radius: 12,
      smartRadius: true, contrast: 0.4, shift: -20, decontaminate: true, decontaminateAmount: 0.6,
      output: "newlayermask",
    };
    expect(normalizeSamSettings(saved)).toEqual(saved);
  });

  it("falls back to defaults for anything missing", () => {
    expect(normalizeSamSettings({})).toEqual(SAM_DEFAULTS);
    expect(normalizeSamSettings(null)).toEqual(SAM_DEFAULTS);
  });

  it("refuses a bad view, output or non-finite number rather than trusting storage", () => {
    const bad = normalizeSamSettings({
      view: "nonsense", output: "elsewhere", radius: Number.NaN,
      viewOpacity: "half", decontaminateAmount: Infinity,
    });
    expect(bad.view).toBe(SAM_DEFAULTS.view);
    expect(bad.output).toBe(SAM_DEFAULTS.output);
    expect(bad.radius).toBe(SAM_DEFAULTS.radius);
    expect(bad.viewOpacity).toBe(SAM_DEFAULTS.viewOpacity);
    expect(bad.decontaminateAmount).toBe(SAM_DEFAULTS.decontaminateAmount);
  });

  it("clamps out-of-range values into what the engine accepts", () => {
    const clamped = normalizeSamSettings({ viewOpacity: 4, decontaminateAmount: -1, shift: 9999 });
    expect(clamped.viewOpacity).toBe(1);
    expect(clamped.decontaminateAmount).toBe(0);
    expect(clamped.shift).toBe(100);
  });
});

describe("Decontaminate Amount reaches the engine (#413)", () => {
  function storeWith() {
    const calls: [string, ...unknown[]][] = [];
    // beginHistory only proceeds if push_history actually grew the stack, so the
    // stub has to move undo_pushes rather than return a constant.
    let pushes = 0;
    const eng = {
      set_history_states: () => {},
      undo_pushes: () => pushes,
      push_history: () => { pushes++; },
      drop_last_undo: () => { pushes = Math.max(0, pushes - 1); },
      undo_depth: () => pushes,
      has_selection: () => true,
      begin_history_transaction: () => true,
      commit_history_transaction: () => true,
      cancel_history_transaction: () => true,
      active_layer_id: () => 1,
      set_selection_mask: () => {},
      select_none: () => calls.push(["select_none"]),
      select_and_mask: () => calls.push(["refine"]),
      select_and_mask_preview: () => new Uint8Array(),
      add_layer_mask_reveal_selection: () => calls.push(["mask"]),
      decontaminate_colors: (a: number) => calls.push(["decontaminate", a]),
    };
    const client = {
      engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true),
      refreshFromEngine: vi.fn(), onCommit: null,
    };
    return { store: new Store(client as never), calls };
  }
  const params = { radius: 0, smartRadius: false, smooth: 0, feather: 0, contrast: 0, shift: 0 };

  it("passes a fractional amount through instead of collapsing it to 1", () => {
    const { store, calls } = storeWith();
    store.selectAndMask(params, new Uint8Array(4), "selection", 0.35);
    expect(calls).toContainEqual(["decontaminate", 0.35]);
  });

  it("still treats the historical `true` as full strength", () => {
    const { store, calls } = storeWith();
    store.selectAndMask(params, new Uint8Array(4), "selection", true);
    expect(calls).toContainEqual(["decontaminate", 1]);
  });

  it("skips decontamination entirely at amount 0", () => {
    const { store, calls } = storeWith();
    store.selectAndMask(params, new Uint8Array(4), "selection", 0);
    expect(calls.some((c) => c[0] === "decontaminate")).toBe(false);
  });
});
