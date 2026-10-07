// GAL-MASK-10: local corrections (masks) round-trip through Lightroom's
// crs:MaskGroupBasedCorrections block, so a Galerie-masked photo no longer
// reads as globally-adjusted-only in LR/ACR/Bridge, and an LR sidecar carrying
// masks imports instead of dropping them.
import { describe, expect, it } from "vitest";

import { createDefaultRecipe, type DevelopRecipeV2 } from "./developRecipe";
import { createLocalAdjustments, type Mask } from "./maskGraph";
import { parseCameraRawXmp, serializeCameraRawXmp } from "./xmp";

function maskedRecipe(masks: Mask[]): DevelopRecipeV2 {
  const r = createDefaultRecipe();
  r.masks = { masks };
  return r;
}

function skyMask(): Mask {
  return {
    id: "m1",
    name: "Sky",
    enabled: true,
    inverted: false,
    opacity: 0.8,
    components: [
      { id: "c1", kind: "linearGradient", combine: "add", invert: false, x1: 0.5, y1: 0.1, x2: 0.5, y2: 0.7 },
      { id: "c2", kind: "radialGradient", combine: "subtract", invert: true, cx: 0.25, cy: 0.4, rx: 0.1, ry: 0.2, angle: Math.PI / 4, feather: 0.3 },
    ],
    adjustments: { ...createLocalAdjustments(), exposure: -0.75, contrast: 0.25, temp: -0.4, defringe: 0.1 },
  };
}

/** An <rdf:Description> body a real Lightroom sidecar would carry. */
function lrDocument(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    crs:HasSettings="True"
    crs:Exposure2012="0.25">
${body}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
}

describe("Camera Raw XMP — masks via crs:MaskGroupBasedCorrections (GAL-MASK-10)", () => {
  it("round-trips gradient masks, blend modes and local adjustments", () => {
    const xml = serializeCameraRawXmp({ recipe: maskedRecipe([skyMask()]) });
    expect(xml).toContain("<crs:MaskGroupBasedCorrections>");
    expect(xml).toContain('crs:What="Correction"');
    expect(xml).toContain('crs:CorrectionName="Sky"');
    expect(xml).toContain('crs:What="Mask/Gradient"');
    expect(xml).toContain('crs:What="Mask/CircularGradient"');
    expect(xml).toContain('crs:LocalExposure2012="-0.75"');

    const doc = parseCameraRawXmp(xml);
    expect(doc.mapped).toContain("crs:MaskGroupBasedCorrections");
    const masks = doc.recipe?.masks?.masks ?? [];
    expect(masks).toHaveLength(1);
    expect(masks[0].name).toBe("Sky");
    expect(masks[0].opacity).toBeCloseTo(0.8, 6);
    expect(masks[0].adjustments.exposure).toBeCloseTo(-0.75, 6);
    expect(masks[0].adjustments.contrast).toBeCloseTo(0.25, 6);
    expect(masks[0].adjustments.temp).toBeCloseTo(-0.4, 6);
    expect(masks[0].adjustments.defringe).toBeCloseTo(0.1, 6);
    expect(masks[0].adjustments.shadows).toBe(0);

    const [lin, rad] = masks[0].components;
    expect(lin).toMatchObject({ kind: "linearGradient", combine: "add", invert: false });
    if (lin.kind !== "linearGradient") throw new Error("expected a linear gradient");
    expect([lin.x1, lin.y1, lin.x2, lin.y2]).toEqual([0.5, 0.1, 0.5, 0.7]);
    expect(rad).toMatchObject({ kind: "radialGradient", combine: "subtract", invert: true });
    if (rad.kind !== "radialGradient") throw new Error("expected a radial gradient");
    expect(rad.cx).toBeCloseTo(0.25, 6);
    expect(rad.cy).toBeCloseTo(0.4, 6);
    expect(rad.rx).toBeCloseTo(0.1, 6);
    expect(rad.ry).toBeCloseTo(0.2, 6);
    expect(rad.angle).toBeCloseTo(Math.PI / 4, 5);
    expect(rad.feather).toBeCloseTo(0.3, 6);
  });

  it("round-trips a brush mask through crs:MaskDabs", () => {
    const brush = skyMask();
    brush.components = [
      {
        id: "b", kind: "brush", combine: "add", invert: false, autoMask: true,
        dabs: [
          { x: 0.2, y: 0.3, radius: 0.04, flow: 0.5, density: 1, erase: false },
          { x: 0.22, y: 0.31, radius: 0.04, flow: 0.5, density: 1, erase: false },
          { x: 0.9, y: 0.9, radius: 0.04, flow: 0.5, density: 1, erase: true }, // no LR slot
        ],
      },
    ];
    const xml = serializeCameraRawXmp({ recipe: maskedRecipe([brush]) });
    expect(xml).toContain('crs:What="Mask/Paint"');
    expect(xml).toContain('crs:Radius="0.04"');
    expect(xml).toContain("<rdf:li>d 0.2 0.3</rdf:li>");

    const comp = (parseCameraRawXmp(xml).recipe?.masks?.masks ?? [])[0]?.components[0];
    if (comp?.kind !== "brush") throw new Error("expected a brush component");
    expect(comp.dabs).toHaveLength(2); // the eraser dab has no slot in LR's grammar
    expect(comp.dabs[0]).toMatchObject({ x: 0.2, y: 0.3, radius: 0.04, flow: 0.5, erase: false });
  });

  it("folds a single-component mask inversion into crs:MaskInverted", () => {
    const m = skyMask();
    m.inverted = true;
    m.components = [m.components[0]];
    const xml = serializeCameraRawXmp({ recipe: maskedRecipe([m]) });
    expect(xml).toContain('crs:MaskInverted="true"');
    expect((parseCameraRawXmp(xml).recipe?.masks?.masks ?? [])[0].components[0].invert).toBe(true);
  });

  it("ingests a Lightroom-authored mask group", () => {
    const xml = lrDocument(`   <crs:MaskGroupBasedCorrections>
    <rdf:Seq>
     <rdf:li>
      <rdf:Description
       crs:What="Correction"
       crs:CorrectionAmount="1.000000"
       crs:CorrectionActive="true"
       crs:CorrectionName="Subject"
       crs:LocalExposure2012="0.500000"
       crs:LocalClarity2012="0.200000">
       <crs:CorrectionMasks>
        <rdf:Seq>
         <rdf:li>
          <rdf:Description
           crs:What="Mask/CircularGradient"
           crs:MaskValue="1.000000"
           crs:MaskBlendMode="0"
           crs:MaskInverted="false"
           crs:Top="0.200000"
           crs:Left="0.300000"
           crs:Bottom="0.800000"
           crs:Right="0.700000"
           crs:Angle="0.000000"
           crs:Midpoint="50"
           crs:Roundness="0"
           crs:Feather="40"/>
         </rdf:li>
         <rdf:li>
          <rdf:Description
           crs:What="Mask/Image"
           crs:MaskBlendMode="2"
           crs:MaskSubType="1"
           crs:ReferencePoint="0.5 0.5"/>
         </rdf:li>
        </rdf:Seq>
       </crs:CorrectionMasks>
      </rdf:Description>
     </rdf:li>
    </rdf:Seq>
   </crs:MaskGroupBasedCorrections>`);

    const doc = parseCameraRawXmp(xml);
    const masks = doc.recipe?.masks?.masks ?? [];
    expect(masks).toHaveLength(1);
    expect(masks[0].name).toBe("Subject");
    expect(masks[0].adjustments.exposure).toBeCloseTo(0.5, 6);
    expect(masks[0].adjustments.clarity).toBeCloseTo(0.2, 6);
    expect(masks[0].components).toHaveLength(1); // Mask/Image needs a segmentation blob
    const c = masks[0].components[0];
    if (c.kind !== "radialGradient") throw new Error("expected a radial gradient");
    expect(c.cx).toBeCloseTo(0.5, 6);
    expect(c.cy).toBeCloseTo(0.5, 6);
    expect(c.rx).toBeCloseTo(0.2, 6);
    expect(c.ry).toBeCloseTo(0.3, 6);
    expect(c.feather).toBeCloseTo(0.4, 6);
    expect(doc.skipped.find((s) => s.includes("Mask/Image"))).toBeTruthy();
    // The global block still parses alongside the nested grammar…
    expect(doc.recipe?.basic?.exposure).toBeCloseTo(0.25, 6);
    // …and no nested crs:Local*/crs:Mask* attribute leaks into the flat scan.
    expect(doc.skipped.join("\n")).not.toContain("unrecognized property");
  });

  it("ingests the pre-LR11 per-tool correction blocks", () => {
    const xml = lrDocument(`   <crs:CircularGradientBasedCorrections>
    <rdf:Seq>
     <rdf:li>
      <rdf:Description crs:What="Correction" crs:CorrectionAmount="1" crs:LocalDehaze="0.3">
       <crs:CorrectionMasks>
        <rdf:Seq>
         <rdf:li>
          <rdf:Description crs:What="Mask/CircularGradient" crs:Top="0" crs:Left="0" crs:Bottom="0.5" crs:Right="0.5" crs:Feather="50" crs:Flipped="true"/>
         </rdf:li>
        </rdf:Seq>
       </crs:CorrectionMasks>
      </rdf:Description>
     </rdf:li>
    </rdf:Seq>
   </crs:CircularGradientBasedCorrections>
   <crs:PaintBasedCorrections>
    <rdf:Seq>
     <rdf:li>
      <rdf:Description crs:What="Correction" crs:CorrectionAmount="1" crs:CorrectionName="Brush 1">
       <crs:CorrectionMasks>
        <rdf:Seq>
         <rdf:li>
          <rdf:Description crs:What="Mask/Paint" crs:Radius="0.02" crs:Flow="0.75" crs:MaskBlendMode="1">
           <crs:MaskDabs>
            <rdf:Seq>
             <rdf:li>d 0.100000 0.200000</rdf:li>
             <rdf:li>m 0.900000 0.900000</rdf:li>
            </rdf:Seq>
           </crs:MaskDabs>
          </rdf:Description>
         </rdf:li>
        </rdf:Seq>
       </crs:CorrectionMasks>
      </rdf:Description>
     </rdf:li>
    </rdf:Seq>
   </crs:PaintBasedCorrections>`);

    const doc = parseCameraRawXmp(xml);
    const masks = doc.recipe?.masks?.masks ?? [];
    expect(masks).toHaveLength(2);
    expect(doc.mapped).toContain("crs:CircularGradientBasedCorrections");
    expect(doc.mapped).toContain("crs:PaintBasedCorrections");
    expect(masks[0].name).toBe("Mask 1"); // unnamed legacy correction
    expect(masks[0].adjustments.dehaze).toBeCloseTo(0.3, 6);
    expect(masks[0].components[0].invert).toBe(true); // legacy crs:Flipped
    const brush = masks[1].components[0];
    if (brush.kind !== "brush") throw new Error("expected a brush component");
    expect(brush.combine).toBe("subtract");
    expect(brush.dabs).toHaveLength(1); // the "m" stroke form isn't a dab
    expect(brush.dabs[0]).toMatchObject({ x: 0.1, y: 0.2, radius: 0.02, flow: 0.75 });
  });

  it("omits the block for a recipe with no expressible mask", () => {
    expect(serializeCameraRawXmp({ recipe: createDefaultRecipe() })).not.toContain("MaskGroupBasedCorrections");

    const rangeOnly = skyMask();
    rangeOnly.components = [
      { id: "r", kind: "rangeLuminance", combine: "add", invert: false, min: 0.2, max: 0.8, smoothness: 0.5 },
    ];
    const xml = serializeCameraRawXmp({ recipe: maskedRecipe([rangeOnly]) });
    expect(xml).not.toContain("MaskGroupBasedCorrections");
    expect(parseCameraRawXmp(xml).recipe?.masks).toBeUndefined();
  });

  it("bounds a hostile correction block at the trust boundary", () => {
    const bogus = `   <crs:MaskGroupBasedCorrections>
    <rdf:Seq>
     <rdf:li>
      <rdf:Description crs:What="Correction" crs:CorrectionAmount="99" crs:LocalExposure2012="1e9">
       <crs:CorrectionMasks>
        <rdf:Seq>
         <rdf:li>
          <rdf:Description crs:What="Mask/Gradient" crs:ZeroX="-1e9" crs:ZeroY="NaN" crs:FullX="1e9" crs:FullY="1"/>
         </rdf:li>
        </rdf:Seq>
       </crs:CorrectionMasks>
      </rdf:Description>
     </rdf:li>
    </rdf:Seq>
   </crs:MaskGroupBasedCorrections>`;
    const masks = parseCameraRawXmp(lrDocument(bogus)).recipe?.masks?.masks ?? [];
    expect(masks).toHaveLength(1);
    expect(masks[0].opacity).toBe(1);
    expect(masks[0].adjustments.exposure).toBe(4); // clamped to the Basic domain
    const g = masks[0].components[0];
    if (g.kind !== "linearGradient") throw new Error("expected a linear gradient");
    expect(g.x1).toBe(-4);
    expect(g.x2).toBe(4);
    expect(g.y1).toBe(0); // NaN falls back to the default, never reaches the renderer
  });
});
