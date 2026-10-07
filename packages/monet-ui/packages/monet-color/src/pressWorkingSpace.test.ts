// Color Settings ▸ Working Spaces ▸ CMYK picks the press the soft proof and the
// gamut warning are supposed to model. The proof math used one hard-coded dot
// gain and one hard-coded ink limit, so every choice rendered identically while
// the dialog printed that press's numbers underneath it (#488).
import { describe, expect, it } from "vitest";
import { cmykWorkingSpace } from "./colorManagement";
import { isCmykGamutWarning, proofPixel } from "./proof";

const COATED = cmykWorkingSpace(1); // Sheetfed Coated: 10% gain, 350% ink
const UNCOATED = cmykWorkingSpace(4); // Web Uncoated: 22% gain, 260% ink

describe("the working CMYK space drives the proof", () => {
  it("renders a different proof pixel on a heavier press", () => {
    const coated = proofPixel("cmyk", 40, 90, 150, { press: COATED });
    const uncoated = proofPixel("cmyk", 40, 90, 150, { press: UNCOATED });
    expect(uncoated).not.toEqual(coated);
  });

  it("warns at the ink limit the chosen press actually has", () => {
    // A near-black blue: ~265% total ink at 22% dot gain, under 260% at 10%.
    // Over an uncoated stock's 260% limit, comfortably inside a coated 350%.
    const rgb = [0, 5, 13] as const;
    expect(isCmykGamutWarning(rgb[0], rgb[1], rgb[2], UNCOATED)).toBe(true);
    expect(isCmykGamutWarning(rgb[0], rgb[1], rgb[2], COATED)).toBe(false);
  });

  it("keeps the previous behaviour when no press is named", () => {
    const swop = cmykWorkingSpace(0); // the old hard-coded 12% / 300%
    expect(proofPixel("cmyk", 40, 90, 150)).toEqual(proofPixel("cmyk", 40, 90, 150, { press: swop }));
    expect(isCmykGamutWarning(250, 20, 20)).toBe(isCmykGamutWarning(250, 20, 20, swop));
  });
});
