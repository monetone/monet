// Guards #414: alpha, spot and Quick Mask rows in the Channels panel drew a
// flat swatch of their overlay/ink colour, so every saved channel looked alike.
// The document plates already sampled a real thumbnail; this is the coverage
// twin of that sampler, plus the three sources that feed it.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { Store, coverageThumb } from "./store";

describe("coverage thumbnails (#414)", () => {
  it("renders coverage as opaque grayscale, not a colour swatch", () => {
    const plane = Uint8Array.of(0, 255, 128, 64); // 2x2
    const out = coverageThumb(plane, 2, 2, 2, 2);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(out.slice(4, 8))).toEqual([255, 255, 255, 255]);
    expect(Array.from(out.slice(8, 12))).toEqual([128, 128, 128, 255]);
    expect(out.every((_, i) => i % 4 !== 3 || out[i] === 255)).toBe(true);
  });

  it("nearest-samples down, the same way the document plates do", () => {
    // A 4x1 ramp into 2 columns takes the pixel under each cell CENTRE —
    // floor((x+0.5)*4/2), so indices 1 and 3, identical to channelPlaneThumb.
    const out = coverageThumb(Uint8Array.of(0, 10, 200, 255), 4, 1, 2, 1);
    expect([out[0], out[4]]).toEqual([10, 255]);
  });

  it("distinguishes two channels that share an overlay colour", () => {
    const a = coverageThumb(Uint8Array.of(255, 255, 0, 0), 2, 2, 2, 2);
    const b = coverageThumb(Uint8Array.of(0, 0, 255, 255), 2, 2, 2, 2);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("Channels panel thumbnail sources (#414)", () => {
  function storeWith(over: Record<string, unknown> = {}) {
    const eng = {
      saved_selection_mask: (name: string) => (name === "Alpha 1" ? new Uint8Array(4).fill(200) : new Uint8Array()),
      spot_channel_coverage: (i: number) => (i === 0 ? new Uint8Array(4).fill(120) : new Uint8Array()),
      ...over,
    };
    const client = {
      engine: eng, e: eng, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null,
      width: 2, height: 2,
      quickMaskBuffer: () => new Uint8Array(4).fill(90),
    };
    return new Store(client as never);
  }

  it("refuses a plane whose size does not match the document", () => {
    // A stale channel from a resized document must not be drawn stretched.
    expect(storeWith().coverageThumbUrl(new Uint8Array(9))).toBe("");
  });

  it("returns nothing for an unknown alpha channel rather than a blank tile", () => {
    expect(storeWith().savedChannelThumbUrl("missing")).toBe("");
  });

  it("degrades to no thumbnail on a wasm build without the spot getter", () => {
    // The panel falls back to the ink swatch, exactly as before this change.
    const store = storeWith({ spot_channel_coverage: undefined });
    expect(store.spotChannelThumbUrl(0)).toBe("");
  });

  it("draws nothing for Quick Mask when it is not active", () => {
    const client = {
      engine: {}, e: {}, sync: vi.fn(), commit: vi.fn(() => true), onCommit: null,
      width: 2, height: 2, quickMaskBuffer: () => null,
    };
    expect(new Store(client as never).quickMaskThumbUrl()).toBe("");
  });
});
