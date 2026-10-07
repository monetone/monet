// softProof — GAL-DEV-15: Develop's Soft Proofing (LR's S key). Pure display
// math over the engine-baked ICC proof LUT (`bakeProofLut` in engine.ts):
// working sRGB → print profile → sRGB, gamut membership in the alpha byte.
// Applied on the blit path ONLY — the recipe, histogram, export and preview
// pixels never see the proof, exactly like Lightroom.

import {
  iccProofSimulationMap,
  proofLutSizeFor,
  sampleProofLut,
} from "@monet-ui/monet-color";

/** LR paints destination-gamut warnings red (Photoshop uses gray). */
const GAMUT_RED: [number, number, number] = [255, 0, 0];

/** Rendering intents the proof bar offers — the engine's moxcms intent ids. */
export const PROOF_INTENTS = [
  { value: 0, label: "Perceptual" },
  { value: 1, label: "Relative" },
] as const;

export interface SoftProofOptions {
  /** Simulate Paper & Ink (LR's single checkbox): show the paper tint and the
   *  true press black instead of stretching ink black → display black. */
  paperInk: boolean;
  /** Destination gamut warning: overlay out-of-gamut pixels in red. */
  gamutWarning: boolean;
}

/**
 * Remap an sRGB RGBA8 frame through the proof LUT in place. Returns false
 * (frame untouched) when `lut` is not a valid packed proof lattice.
 * ponytail: destination gamut only — a monitor-gamut warning is an identity
 * here because Galerie's working/display space are both sRGB; wire the OS
 * monitor profile through display_lut if that ever changes.
 */
export function applySoftProof(
  rgba: Uint8ClampedArray,
  lut: Uint8Array,
  opts: SoftProofOptions,
): boolean {
  const n = proofLutSizeFor(lut);
  if (n == null) return false;
  // Paper & Ink implies both of Photoshop's simulate boxes; off = the default
  // ink-black → display-black stretch (see iccProofSimulationMap).
  const sim = iccProofSimulationMap(
    [lut[0], lut[1], lut[2]],
    opts.paperInk ? { simulatePaperColor: true, simulateBlackInk: true } : undefined,
  );
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b, gamut] = sampleProofLut(lut, n, rgba[i], rgba[i + 1], rgba[i + 2]);
    if (opts.gamutWarning && gamut !== 0) {
      rgba[i] = GAMUT_RED[0];
      rgba[i + 1] = GAMUT_RED[1];
      rgba[i + 2] = GAMUT_RED[2];
      continue;
    }
    if (sim) {
      // Uint8ClampedArray clamps + rounds the affine remap on write.
      rgba[i] = r * sim.scale[0] + sim.offset[0];
      rgba[i + 1] = g * sim.scale[1] + sim.offset[1];
      rgba[i + 2] = b * sim.scale[2] + sim.offset[2];
    } else {
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
    }
  }
  return true;
}

/**
 * Validate an untrusted .icc/.icm at the load boundary: must carry the 'acsp'
 * signature and an RGB or CMYK device space — anything else (GRAY, Lab, junk)
 * would bake a garbage proof, so refuse it with a readable reason.
 */
export function sniffProofProfile(
  name: string,
  bytes: Uint8Array,
): { name: string; space: "RGB" | "CMYK" } {
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (bytes.length < 132 || tag(36) !== "acsp") {
    throw new Error(`${name} is not a usable ICC profile`);
  }
  const space = tag(16);
  if (space === "RGB ") return { name, space: "RGB" };
  if (space === "CMYK") return { name, space: "CMYK" };
  throw new Error(`${name}: only RGB or CMYK device profiles can be soft-proofed`);
}
