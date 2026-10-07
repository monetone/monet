// Preferences ▸ Transparency & Gamut — the Gamut Warning paint round-trip:
// preference → EngineClient → the blit path's out-of-gamut pixels. The engine
// is mocked (as in EngineClient.test.ts) so this runs wasm-free in node.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GAMUT_WARNING } from "@monet-ui/monet-color";

const engineModule = vi.hoisted(() => ({
  memory: new WebAssembly.Memory({ initial: 1 }),
  init: vi.fn(),
}));

engineModule.init.mockResolvedValue({ memory: engineModule.memory });

vi.mock("@engine", () => ({
  default: engineModule.init,
  Engine: class Engine {},
}));

import { EngineClient } from "./EngineClient";

// The node test env has no Storage; a Map-backed stand-in exercises the
// persistence branch (and, left undefined, the "storage unavailable" one).
function stubStorage(seed?: string) {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set("mv.gamutWarningPaint", seed);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  });
  return map;
}

/** Run one pixel through the private display-remap path (blit's inner loop). */
function displayPixel(client: EngineClient, rgb: [number, number, number]): number[] {
  const data = new Uint8ClampedArray([...rgb, 255]);
  const inner = client as unknown as {
    imageData: { data: Uint8ClampedArray };
    applyDisplayRect(x: number, y: number, w: number, h: number): void;
  };
  inner.imageData = { data };
  client.width = 1;
  client.height = 1;
  inner.applyDisplayRect(0, 0, 1, 1);
  return [data[0], data[1], data[2]];
}

describe("gamut warning paint", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("defaults to Photoshop's opaque medium gray when nothing is stored", () => {
    stubStorage();
    expect(new EngineClient().getGamutWarningPaint()).toEqual(DEFAULT_GAMUT_WARNING);
    // No storage at all must not throw at construction.
    Reflect.deleteProperty(globalThis, "localStorage");
    expect(new EngineClient().getGamutWarningPaint()).toEqual(DEFAULT_GAMUT_WARNING);
  });

  it("paints out-of-gamut pixels in the preferred colour and coverage", () => {
    stubStorage();
    const client = new EngineClient();
    client.setGamutWarning(true);

    // Saturated red is out of the CMYK heuristic's gamut; a neutral is not.
    expect(displayPixel(client, [255, 0, 0])).toEqual([128, 128, 128]);
    expect(displayPixel(client, [128, 128, 128])).toEqual([128, 128, 128]);

    client.setGamutWarningPaint({ color: [255, 0, 255], opacity: 0.5 });
    expect(displayPixel(client, [255, 0, 0])).toEqual([255, 0, 128]);
    expect(displayPixel(client, [90, 120, 150])).toEqual([90, 120, 150]); // in gamut, untouched

    // A fully transparent warning leaves the pixel alone; turning the warning
    // off does the same regardless of the paint.
    client.setGamutWarningPaint({ color: [255, 0, 255], opacity: 0 });
    expect(displayPixel(client, [255, 0, 0])).toEqual([255, 0, 0]);
    client.setGamutWarningPaint(DEFAULT_GAMUT_WARNING);
    client.setGamutWarning(false);
    expect(displayPixel(client, [255, 0, 0])).toEqual([255, 0, 0]);
  });

  it("persists the preference and sanitizes whatever comes back", () => {
    const store = stubStorage();
    const client = new EngineClient();
    client.setGamutWarningPaint({ color: [300, -4, 12.6], opacity: 4 });
    expect(client.getGamutWarningPaint()).toEqual({ color: [255, 0, 13], opacity: 1 });
    expect(JSON.parse(store.get("mv.gamutWarningPaint")!)).toEqual({ color: [255, 0, 13], opacity: 1 });

    // A fresh client (i.e. the next session) restores it.
    expect(new EngineClient().getGamutWarningPaint()).toEqual({ color: [255, 0, 13], opacity: 1 });

    // Corrupt or hand-edited storage falls back to the default, never throws.
    stubStorage("{ not json");
    expect(new EngineClient().getGamutWarningPaint()).toEqual(DEFAULT_GAMUT_WARNING);
    stubStorage(JSON.stringify({ color: "red", opacity: null }));
    expect(new EngineClient().getGamutWarningPaint()).toEqual(DEFAULT_GAMUT_WARNING);
  });
});
