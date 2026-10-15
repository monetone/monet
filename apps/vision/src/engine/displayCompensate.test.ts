import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { DISPLAY_LUT_SIZE } from "@monet-ui/monet-color";
import { EngineClient } from "./EngineClient";

/** n=2 invert lattice. A constant LUT would make a second pass identical. */
function invertLut(): Uint8Array {
  const n = 2;
  const lut = new Uint8Array(n * n * n * 3);
  let o = 0;
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++, o += 3) {
        lut[o] = 255 - Math.round((r * 255) / (n - 1));
        lut[o + 1] = 255 - Math.round((g * 255) / (n - 1));
        lut[o + 2] = 255 - Math.round((b * 255) / (n - 1));
      }
    }
  }
  return lut;
}

function clientWith(lut: Uint8Array | null) {
  const calls: [number, number][] = [];
  const client = new EngineClient();
  client.engine = {
    display_lut: (n: number, bytes: Uint8Array) => {
      calls.push([n, bytes.length]);
      return lut ?? new Uint8Array();
    },
  } as unknown as typeof client.engine;
  return { client, calls };
}

describe("displayCompensate", () => {
  it("leaves an assigned sRGB document with no ICC bytes as identity and does not bake a LUT", () => {
    const { client, calls } = clientWith(invertLut());
    client.setDisplayProfile(0, true, null, null);
    expect(calls).toEqual([]);
    const src = new Uint8ClampedArray([10, 20, 30, 40]);
    expect(client.displayCompensate(src)).toBe(src);
  });

  it("bakes a LUT for a non-sRGB assigned profile and for sRGB that carries ICC bytes", () => {
    const adobe = clientWith(invertLut());
    adobe.client.setDisplayProfile(2, true, null, null);
    expect(adobe.calls).toEqual([[DISPLAY_LUT_SIZE, 0]]);
    const src = new Uint8ClampedArray([255, 0, 0, 128]);
    const once = adobe.client.displayCompensate(src);
    expect(Array.from(src)).toEqual([255, 0, 0, 128]);
    expect(Array.from(once)).toEqual([0, 255, 255, 128]);
    expect(Array.from(adobe.client.displayCompensate(once))).toEqual([255, 0, 0, 128]);

    const icc = clientWith(invertLut());
    const bytes = new Uint8Array([1, 2, 3, 4]);
    icc.client.setDisplayProfile(0, true, bytes, "Custom");
    expect(icc.calls).toEqual([[DISPLAY_LUT_SIZE, 4]]);
    icc.client.setDisplayProfile(0, true, bytes, "Custom");
    expect(icc.calls).toEqual([[DISPLAY_LUT_SIZE, 4]]);
  });

  it("does not bake a LUT for an untagged document", () => {
    const { client, calls } = clientWith(invertLut());
    client.setDisplayProfile(2, false, new Uint8Array([1]), "Custom");
    expect(calls).toEqual([]);
    const src = new Uint8ClampedArray([255, 0, 0, 255]);
    expect(client.displayCompensate(src)).toBe(src);
  });
});
