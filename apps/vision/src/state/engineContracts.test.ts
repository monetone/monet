import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEPARABLE_BLEND_MODES } from "./blendModes";
import { BLEND_ORDER, LAYER_KIND } from "./engineContracts";
import { NON_SEPARABLE_BLEND_MODES } from "./nonSeparableBlend";

const rasterDir = new URL("../../../../packages/engine/src/raster/", import.meta.url);
const rustRaster = readFileSync(new URL("mod.rs", rasterDir), "utf8");
const rustBlend = readFileSync(new URL("blend.rs", rasterDir), "utf8");
const kebab = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

describe("TypeScript/Rust engine contracts", () => {
  it("keeps layer-kind wire ids aligned with the Rust declaration", () => {
    const declaration = rustRaster.match(/kind:\s*u8,\s*\/\/\s*([^\n]+)/)?.[1];
    expect(declaration).toBeTruthy();
    expect(declaration!.split(", ")).toEqual(
      Object.entries(LAYER_KIND).map(([name, value]) => `${value} ${kebab(name).replaceAll("-", " ")}`),
    );
  });

  it("keeps blend-mode ids aligned with Rust and the TS mode metadata", () => {
    const fromU8 = rustBlend.match(/pub fn from_u8[\s\S]*?match v \{([\s\S]*?)_ => Normal,/)?.[1];
    expect(fromU8).toBeTruthy();
    const rustOrder = [...fromU8!.matchAll(/^\s*(\d+)\s*=>\s*(\w+),$/gm)]
      .map(([, value, name]) => [Number(value), kebab(name)]);
    expect(rustOrder).toEqual(BLEND_ORDER.map((name, value) => [value, name]));

    for (const mode of [...SEPARABLE_BLEND_MODES, ...NON_SEPARABLE_BLEND_MODES]) {
      expect(BLEND_ORDER[mode.value]).toBe(kebab(mode.key));
    }
  });
});
