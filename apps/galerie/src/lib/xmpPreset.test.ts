import { describe, expect, it } from "vitest";

import { parseXmpPreset } from "./xmpPreset";

// A representative ACR/Lightroom develop-preset .xmp with every crs: property
// as an attribute on rdf:Description (the common preset-export shape).
const ATTR_XMP = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    crs:PresetType="Normal"
    crs:UUID="ABCDEF-0123"
    crs:Version="15.4"
    crs:ProcessVersion="11.0"
    crs:WhiteBalance="Custom"
    crs:IncrementalTemperature="20"
    crs:IncrementalTint="-10"
    crs:Exposure2012="0.75"
    crs:Contrast2012="15"
    crs:Highlights2012="-30"
    crs:Shadows2012="25"
    crs:Whites2012="10"
    crs:Blacks2012="-5"
    crs:Clarity2012="20"
    crs:Texture="12"
    crs:Dehaze="8"
    crs:Vibrance="18"
    crs:Saturation="-4"
    crs:Sharpness="60"
    crs:SharpenRadius="1.2"
    crs:SharpenDetail="30"
    crs:SharpenEdgeMasking="5"
    crs:LuminanceSmoothing="15"
    crs:LuminanceNoiseReductionDetail="40"
    crs:ColorNoiseReduction="25"
    crs:ColorNoiseReductionDetail="60"
    crs:HueAdjustmentRed="10"
    crs:SaturationAdjustmentGreen="-20"
    crs:LuminanceAdjustmentBlue="30"
    crs:ColorGradeShadowHue="210"
    crs:ColorGradeShadowSat="40"
    crs:ColorGradeShadowLum="5"
    crs:ColorGradeMidtoneHue="45"
    crs:ColorGradeMidtoneSat="10"
    crs:ColorGradeHighlightHue="55"
    crs:ColorGradeHighlightSat="20"
    crs:ColorGradeGlobalHue="0"
    crs:ColorGradeGlobalSat="0"
    crs:ColorGradeBlending="50"
    crs:PostCropVignetteAmount="-25"
    crs:PostCropVignetteMidpoint="60"
    crs:PostCropVignetteRoundness="10"
    crs:GrainAmount="20"
    crs:GrainSize="30"
    crs:GrainFrequency="40"
    crs:AutoLateralCA="1">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

// Same coverage in the element form, plus nested Name and a tone-curve point list.
const ELEMENT_XMP = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">
   <crs:IncrementalTemperature>20</crs:IncrementalTemperature>
   <crs:IncrementalTint>-10</crs:IncrementalTint>
   <crs:Exposure2012>0.75</crs:Exposure2012>
   <crs:Contrast2012>15</crs:Contrast2012>
   <crs:Vibrance>18</crs:Vibrance>
   <crs:HueAdjustmentRed>10</crs:HueAdjustmentRed>
   <crs:SaturationAdjustmentGreen>-20</crs:SaturationAdjustmentGreen>
   <crs:ColorGradeShadowHue>210</crs:ColorGradeShadowHue>
   <crs:ColorGradeShadowSat>40</crs:ColorGradeShadowSat>
   <crs:PostCropVignetteAmount>-25</crs:PostCropVignetteAmount>
   <crs:GrainAmount>20</crs:GrainAmount>
   <crs:Name>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">My Test Preset</rdf:li>
    </rdf:Alt>
   </crs:Name>
   <crs:ToneCurvePV2012>
    <rdf:Seq>
     <rdf:li>0, 0</rdf:li>
     <rdf:li>64, 80</rdf:li>
     <rdf:li>192, 200</rdf:li>
     <rdf:li>255, 255</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

describe("parseXmpPreset", () => {
  it("maps a full attribute-form preset into recipe values with correct scaling", () => {
    const { recipe, mapped, skipped } = parseXmpPreset(ATTR_XMP);

    expect(recipe.basic!.wbMode).toBe("custom");
    expect(recipe.basic!.temp).toBeCloseTo(0.2, 10); // IncrementalTemperature 20 × 0.01
    expect(recipe.basic!.tint).toBeCloseTo(0.1, 10); // Adobe -green axis → internal +green axis (#108)
    expect(recipe.basic!.exposure).toBeCloseTo(0.75, 10); // EV verbatim
    expect(recipe.basic!.contrast).toBeCloseTo(0.15, 10);
    expect(recipe.basic!.highlights).toBeCloseTo(-0.3, 10);
    expect(recipe.basic!.shadows).toBeCloseTo(0.25, 10);
    expect(recipe.basic!.whites).toBeCloseTo(0.1, 10);
    expect(recipe.basic!.blacks).toBeCloseTo(-0.05, 10);
    expect(recipe.basic!.clarity).toBeCloseTo(0.2, 10);
    expect(recipe.basic!.texture).toBeCloseTo(0.12, 10);
    expect(recipe.basic!.dehaze).toBeCloseTo(0.08, 10);
    expect(recipe.basic!.vibrance).toBeCloseTo(0.18, 10);
    expect(recipe.basic!.saturation).toBeCloseTo(-0.04, 10);

    expect(recipe.detail!.sharpenAmount).toBeCloseTo(0.6, 10); // 60 × 0.01
    expect(recipe.detail!.sharpenRadius).toBeCloseTo(1.2, 10); // ACR domain === recipe domain
    expect(recipe.detail!.nrLuminance).toBeCloseTo(0.15, 10);
    expect(recipe.detail!.nrLuminanceDetail).toBeCloseTo(0.4, 10);
    expect(recipe.detail!.nrColor).toBeCloseTo(0.25, 10);

    expect(recipe.colorMixer!.hue![0]).toBeCloseTo(0.1, 10); // Red
    expect(recipe.colorMixer!.saturation![3]).toBeCloseTo(-0.2, 10); // Green
    expect(recipe.colorMixer!.luminance![5]).toBeCloseTo(0.3, 10); // Blue

    expect(recipe.colorGrading!.shadows!.hue).toBeCloseTo(210, 10);
    expect(recipe.colorGrading!.shadows!.sat).toBeCloseTo(0.4, 10);
    expect(recipe.colorGrading!.midtones!.hue).toBeCloseTo(45, 10);
    expect(recipe.colorGrading!.midtones!.sat).toBeCloseTo(0.1, 10);
    expect(recipe.colorGrading!.highlights!.hue).toBeCloseTo(55, 10);
    expect(recipe.colorGrading!.highlights!.sat).toBeCloseTo(0.2, 10);

    expect(recipe.effects!.vignetteAmount).toBeCloseTo(-0.25, 10);
    expect(recipe.effects!.vignetteMidpoint).toBeCloseTo(0.6, 10);
    expect(recipe.effects!.grainAmount).toBeCloseTo(0.2, 10);
    expect(recipe.effects!.grainSize).toBeCloseTo(0.3, 10);
    expect(recipe.effects!.grainRoughness).toBeCloseTo(0.4, 10);

    // +1 WhiteBalance→wbMode, +1 AutoLateralCA→optics.aberration, +3 Detail sub-sliders (#444) as the dialect grew
    expect(mapped.length).toBe(37);
    expect(mapped).toContain("crs:Exposure2012");
    expect(mapped).toContain("crs:GrainFrequency");

    // The Detail sub-sliders became ABI-backed with the v5 extras block (#444).
    expect(recipe.detail!.sharpenDetail).toBe(30);
    expect(recipe.detail!.sharpenMasking).toBe(5);
    expect(recipe.detail!.nrColorDetail).toBe(60);
    // Not ABI-backed but real crs properties: skipped with a reason, not silently dropped.
    expect(skipped.find((s) => s.startsWith("crs:ColorGradeShadowLum"))).toMatch(/lum not ABI-backed/);
    expect(skipped.find((s) => s.startsWith("crs:ColorGradeGlobalHue"))).toMatch(/global wheel/);
    expect(skipped.find((s) => s.startsWith("crs:ColorGradeGlobalSat"))).toMatch(/global wheel/);
    expect(skipped.find((s) => s.startsWith("crs:ColorGradeBlending"))).toMatch(/not ABI-backed/);
    expect(skipped.find((s) => s.startsWith("crs:PostCropVignetteRoundness"))).toMatch(/not ABI-backed/);
    expect(skipped.find((s) => s.startsWith("crs:ProcessVersion"))).toMatch(/unrelated to Monet/);
    // crs:WhiteBalance graduated from skipped (display-only) to mapped when the
    // shared dialect gained wbMode; the fixture's "Custom" must round-trip.
    expect(mapped).toContain("crs:WhiteBalance");
    expect(recipe.basic!.wbMode).toBe("custom");

    // Bookkeeping properties are neither mapped nor skipped.
    expect(mapped.find((s) => /PresetType|:UUID|:Version/.test(s))).toBeUndefined();
    expect(skipped.find((s) => /PresetType|:UUID|:Version/.test(s))).toBeUndefined();
  });

  it("maps an element-form preset, including nested Name and a tone curve", () => {
    const { name, recipe, mapped } = parseXmpPreset(ELEMENT_XMP);

    expect(name).toBe("My Test Preset");
    expect(recipe.basic!.wbMode).toBe("custom");
    expect(recipe.basic!.temp).toBeCloseTo(0.2, 10);
    expect(recipe.basic!.exposure).toBeCloseTo(0.75, 10);
    expect(recipe.basic!.contrast).toBeCloseTo(0.15, 10);
    expect(recipe.basic!.vibrance).toBeCloseTo(0.18, 10);
    expect(recipe.colorMixer!.hue![0]).toBeCloseTo(0.1, 10);
    expect(recipe.colorMixer!.saturation![3]).toBeCloseTo(-0.2, 10);
    expect(recipe.colorGrading!.shadows!.hue).toBeCloseTo(210, 10);
    expect(recipe.colorGrading!.shadows!.sat).toBeCloseTo(0.4, 10);
    expect(recipe.effects!.vignetteAmount).toBeCloseTo(-0.25, 10);
    expect(recipe.effects!.grainAmount).toBeCloseTo(0.2, 10);

    const pts = recipe.toneCurve!.point!;
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[1].x).toBeCloseTo(64 / 255, 10);
    expect(pts[1].y).toBeCloseTo(80 / 255, 10);
    expect(pts[2].x).toBeCloseTo(192 / 255, 10);
    expect(pts[2].y).toBeCloseTo(200 / 255, 10);
    expect(pts[3]).toEqual({ x: 1, y: 1 });
    expect(mapped).toContain("crs:ToneCurvePV2012");
  });

  it("records unrecognized crs properties in skipped with reasons", () => {
    const xml = `<rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      crs:AutoLateralCA="1"
      crs:SomeFutureAIDenoise="42"></rdf:Description>`;
    const { recipe, mapped, skipped } = parseXmpPreset(xml);

    // AutoLateralCA graduated from unrecognized to a real optics mapping.
    expect(mapped).toEqual(["crs:AutoLateralCA"]);
    expect(recipe.optics?.aberration).toBe(1);
    expect(skipped.find((s) => s.startsWith("crs:SomeFutureAIDenoise"))).toMatch(/unrecognized property/);
  });

  it("skips absolute Kelvin temperature/tint, mapping only the Incremental variants", () => {
    const xml = `<rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      crs:Temperature="5500"
      crs:Tint="10"></rdf:Description>`;
    const { recipe, mapped, skipped } = parseXmpPreset(xml);

    expect(recipe.basic).toBeUndefined();
    expect(mapped).toEqual([]);
    expect(skipped.find((s) => s.startsWith("crs:Temperature"))).toMatch(/absolute Kelvin/);
    expect(skipped.find((s) => s.startsWith("crs:Tint"))).toMatch(/paired with absolute Temperature/);
  });

  it("throws on non-XML input", () => {
    expect(() => parseXmpPreset("this is not xml at all")).toThrow();
  });

  it("throws on malformed (unclosed) XML", () => {
    const xml =
      '<x:xmpmeta xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"><rdf:RDF><rdf:Description crs:Exposure2012="1">';
    expect(() => parseXmpPreset(xml)).toThrow();
  });

  it("returns an empty recipe for a valid XMP with no crs properties set", () => {
    const xml =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"></rdf:Description>' +
      "</rdf:RDF></x:xmpmeta>";
    const parsed = parseXmpPreset(xml);

    expect(parsed).toEqual({ name: null, recipe: {}, mapped: [], skipped: [] });
  });

  it("clamps ACR values that exceed the recipe's engine domain", () => {
    const xml = `<rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      crs:Sharpness="150"
      crs:Exposure2012="5"
      crs:Contrast2012="500"></rdf:Description>`;
    const { recipe } = parseXmpPreset(xml);

    expect(recipe.detail!.sharpenAmount).toBeCloseTo(1.0, 10); // ACR max 150 → engine domain caps at 100
    expect(recipe.basic!.exposure).toBeCloseTo(4.0, 10); // ACR max 5 EV → engine domain caps at ±4 EV
    expect(recipe.basic!.contrast).toBeCloseTo(1.0, 10);
  });
});
