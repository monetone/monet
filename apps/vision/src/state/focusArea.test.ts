// VIS-SEL-13 — Select ▸ Focus Area. Engine-free (node): the focus math itself
// is pinned by the Rust tests (packages/engine/src/raster/mod.rs::
// focus_area_preview_auto_and_noise_level). These pin the brush override the
// dialog paints on top of the auto result, the store's engine wiring
// (In-Focus Range / Image Noise Level / Soften Edge / Auto / Output To) and the
// dialog surface itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, applyFocusBrushes } from "./store";

// Minimal fake engine: records the calls the Focus Area paths make. `stale`
// drops the preview/Auto exports, standing in for a wasm build that predates
// them.
function makeStore(stale = false) {
  const calls: unknown[][] = [];
  // The undo stack the real engine keeps: every routing op owns a labelled push
  // (mod.rs "Select Subject" / "Reveal Selection" / "Decontaminate Colors" /
  // "Deselect"), `undo_pushes` is monotonic, `drop_last_undo` pops the newest.
  const undo: string[] = [];
  let pushes = 0;
  let transactionDepth: number | null = null;
  const push = (label: string) => { undo.push(label); pushes++; };
  const preview = {
    focus_area_preview: (t: number, n: number, s: number) => {
      calls.push(["focus_area_preview", t, n, s]);
      return new Uint8Array([0, 0, 255, 255]);
    },
    focus_area_auto_range: (n: number) => {
      calls.push(["focus_area_auto_range", n]);
      return 0.42;
    },
  };
  const e = {
    ...(stale ? {} : preview),
    begin_history_transaction: () => {
      if (transactionDepth !== null) return false;
      transactionDepth = undo.length;
      return true;
    },
    cancel_history_transaction: () => {
      if (transactionDepth === null) return false;
      undo.splice(transactionDepth);
      transactionDepth = null;
      return true;
    },
    commit_history_transaction: () => {
      if (transactionDepth === null) return false;
      const changed = undo.length > transactionDepth;
      transactionDepth = null;
      return changed;
    },
    push_history: (label: string) => push(label),
    set_history_states: () => {},
    drop_last_undo: () => { undo.pop(); },
    undo_pushes: () => pushes,
    select_focus_area: (...args: unknown[]) => calls.push(["select_focus_area", ...args]),
    set_selection_mask: (m: Uint8Array) => { calls.push(["set_selection_mask", m]); push("Select Subject"); },
    add_layer_mask_reveal_selection: (id: number) => { calls.push(["add_layer_mask_reveal_selection", id]); push("Reveal Selection"); },
    active_layer_id: () => 7,
    decontaminate_colors: (a: number) => { calls.push(["decontaminate_colors", a]); push("Decontaminate Colors"); },
    select_none: () => { calls.push(["select_none"]); push("Deselect"); },
  };
  const client = { engine: e, e, sync: vi.fn(), refreshFromEngine: vi.fn(), commit: vi.fn(), onCommit: null };
  return { store: new Store(client as never), calls, undo };
}

describe("Focus Area brushes", () => {
  it("forces painted regions in and out without mutating the auto result", () => {
    const auto = new Uint8Array([0, 255, 0, 255]);
    const add = new Uint8Array([255, 0, 0, 255]);
    const sub = new Uint8Array([0, 255, 0, 255]);
    // add wins on 0, subtract wins on 1 and on 3 (both painted), 2 untouched.
    expect(applyFocusBrushes(auto, add, sub)).toEqual(new Uint8Array([255, 0, 0, 0]));
    expect(auto).toEqual(new Uint8Array([0, 255, 0, 255]));
  });
});

describe("Focus Area store wiring", () => {
  it("previews with the brush overrides applied", () => {
    const { store, calls } = makeStore();
    const cov = store.focusAreaPreview(0.3, 0.1, 4, new Uint8Array([255, 0, 0, 0]), new Uint8Array([0, 0, 255, 0]));
    expect(calls).toEqual([["focus_area_preview", 0.3, 0.1, 4]]);
    expect(cov).toEqual(new Uint8Array([255, 0, 0, 255]));
  });

  it("asks the engine for the Auto In-Focus Range", () => {
    const { store, calls } = makeStore();
    expect(store.focusAreaAutoRange(0.2)).toBe(0.42);
    expect(calls).toEqual([["focus_area_auto_range", 0.2]]);
  });

  it("degrades to the blind apply on a wasm build without the new exports", () => {
    const { store, calls } = makeStore(true);
    expect(store.focusAreaPreview(0.3, 0, 0, new Uint8Array(4), new Uint8Array(4))).toHaveLength(0);
    expect(store.focusAreaAutoRange(0)).toBe(-1);
    expect(calls).toEqual([]);
  });

  it("commits the plain slider path with noise and soften, defaulting both to 0", () => {
    const { store, calls } = makeStore();
    store.selectFocusArea(0.3, 0.1, 4);
    store.selectFocusArea(0.5);
    expect(calls).toEqual([
      ["select_focus_area", 0.3, 0.1, 4],
      ["select_focus_area", 0.5, 0, 0],
    ]);
  });

  it("routes the corrected mask per Output To", () => {
    const mask = new Uint8Array([255, 0, 0, 255]);
    const selection = makeStore();
    selection.store.applyFocusArea(mask);
    expect(selection.calls).toEqual([["set_selection_mask", mask]]);

    const layerMask = makeStore();
    layerMask.store.applyFocusArea(mask, "layermask");
    expect(layerMask.calls).toEqual([
      ["set_selection_mask", mask],
      ["add_layer_mask_reveal_selection", 7],
      ["select_none"],
    ]);

    const newLayer = makeStore();
    newLayer.store.applyFocusArea(mask, "newlayermask");
    expect(newLayer.calls).toEqual([
      ["set_selection_mask", mask],
      ["decontaminate_colors", 0],
      ["select_none"],
    ]);

    // (#172) One dialog OK is one undo step. The routing ops each push their own
    // state, so an undo used to restore the selection while leaving the new
    // layer mask attached — a state the user never created.
    expect(selection.undo).toEqual(["Focus Area"]);
    expect(layerMask.undo).toEqual(["Focus Area"]);
    expect(newLayer.undo).toEqual(["Focus Area"]);
  });
});

describe("Focus Area dialog", () => {
  it("offers the preview, Auto, noise level, brushes, Soften Edge, Output To and the hand-off", () => {
    const dialogs = readFileSync(fileURLToPath(new URL("../ui/Dialogs.tsx", import.meta.url)), "utf8");
    for (const label of [
      "In-Focus Range", "Auto", "Image Noise Level", "Soften Edge", "Output To",
      "Focus Area Brush", "Add (+)", "Subtract (−)", "Select and Mask…",
    ]) {
      expect(dialogs).toContain(label);
    }
    expect(dialogs).toContain('aria-label="Focus Area live preview"');
    expect(dialogs).toContain("store.focusAreaAutoRange(noise / 100)");
    expect(dialogs).toContain("store.applyFocusArea(cov, to)");
  });
});
