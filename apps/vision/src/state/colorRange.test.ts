import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, colorRangePreviewMask } from "./store";

function makeStore() {
  const calls: unknown[][] = [];
  const e = {
    select_color_range_batch: (...args: unknown[]) => calls.push(["batch", ...args]),
  };
  const client = { engine: e, e, sync: vi.fn(), onCommit: null };
  return { store: new Store(client as never), calls, sync: client.sync };
}

describe("VIS-SEL-02 — Color Range samples", () => {
  it("applies image samples, subtraction, invert and intersect in one engine call", () => {
    const { store, calls, sync } = makeStore();
    store.colorRangeSelect({
      fuzziness: 60,
      samples: [[255, 0, 0], [0, 0, 255]],
      subtractSamples: [[128, 0, 128]],
      mode: 3,
      invert: true,
      allLayers: false,
    });

    expect(calls).toEqual([
      [
        "batch",
        new Uint8Array([255, 0, 0, 0, 0, 255]),
        new Uint8Array([128, 0, 128]),
        60,
        3,
        true,
        false,
      ],
    ]);
    expect(sync).toHaveBeenCalledOnce();
  });

  it("previews the same graded add/subtract mask without touching the document", () => {
    const pixels = new Uint8Array([
      255, 0, 0, 255,
      0, 0, 255, 255,
      0, 255, 0, 255,
    ]);
    expect(colorRangePreviewMask(
      pixels,
      [[255, 0, 0], [0, 0, 255]],
      [[0, 0, 255]],
      40,
    )).toEqual(new Uint8Array([255, 0, 0]));
    expect(colorRangePreviewMask(
      pixels,
      [[255, 0, 0], [0, 0, 255]],
      [[0, 0, 255]],
      40,
      true,
    )).toEqual(new Uint8Array([0, 255, 255]));
  });

  it("exposes the image picker, sample controls, presets, preview, invert and Intersect UI", () => {
    const dialogs = readFileSync(
      fileURLToPath(new URL("../ui/Dialogs.tsx", import.meta.url)),
      "utf8",
    );
    for (const label of ["Sampled Colors", "Skin Tones", "Add Sample", "Subtract Sample", "Preview", "Invert", "Intersect"]) {
      expect(dialogs).toContain(label);
    }
    expect(dialogs).toContain('aria-label="Color range image sample"');
    expect(dialogs).toContain("samplePreview(event.currentTarget");
    expect(dialogs).toContain("engine.e.pick_color(x, y)");
  });
});
