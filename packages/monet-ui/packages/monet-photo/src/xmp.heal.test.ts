// GAL-DEV-21 (remainder): heal spots ride crs:RetouchInfo both ways, and the
// structured LR grammars we deliberately don't map (RetouchAreas, PointColors,
// PaintBasedCorrections) surface a documented reason instead of "unrecognized".
import { describe, expect, it } from "vitest";

import { createDefaultRecipe } from "./developRecipe";
import { parseCameraRawXmp, serializeCameraRawXmp } from "./xmp";

function healRecipe() {
  const r = createDefaultRecipe();
  r.heal.spots = [
    { mode: "heal", x: 0.25, y: 0.4, sourceX: 0.3, sourceY: 0.42, radius: 0.015, feather: 0.5, opacity: 1 },
    { mode: "clone", x: 0.7, y: 0.6, sourceX: 0.65, sourceY: 0.58, radius: 0.03, feather: 0.2, opacity: 0.8 },
  ];
  return r;
}

describe("Camera Raw XMP — heal spots via crs:RetouchInfo (GAL-DEV-21)", () => {
  it("round-trips heal and clone spots through the crs: block", () => {
    const xml = serializeCameraRawXmp({ recipe: healRecipe() });
    expect(xml).toContain("<crs:RetouchInfo>");
    expect(xml).toContain("spotType = heal");
    expect(xml).toContain("spotType = clone");

    const doc = parseCameraRawXmp(xml);
    expect(doc.mapped).toContain("crs:RetouchInfo");
    const spots = doc.recipe?.heal?.spots ?? [];
    expect(spots).toHaveLength(2);
    expect(spots[0].mode).toBe("heal");
    expect(spots[0].x).toBeCloseTo(0.25, 6);
    expect(spots[0].y).toBeCloseTo(0.4, 6);
    expect(spots[0].sourceX).toBeCloseTo(0.3, 6);
    expect(spots[0].sourceY).toBeCloseTo(0.42, 6);
    expect(spots[0].radius).toBeCloseTo(0.015, 6);
    expect(spots[1].mode).toBe("clone");
    expect(spots[1].radius).toBeCloseTo(0.03, 6);
  });

  it("omits crs:RetouchInfo when there are no spots", () => {
    expect(serializeCameraRawXmp({ recipe: createDefaultRecipe() })).not.toContain("RetouchInfo");
  });

  it("ingests a Lightroom-authored RetouchInfo, defaulting feather/opacity", () => {
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">
   <crs:RetouchInfo>
    <rdf:Seq>
     <rdf:li>centerX = 0.512000, centerY = 0.446000, radius = 0.016000, sourceState = sourceSetExplicitly, sourceX = 0.529000, sourceY = 0.446000, spotType = heal</rdf:li>
     <rdf:li>centerX = 0.1, centerY = 0.2, radius = 0.01, sourceState = sourceAutoComputed, sourceX = 0.15, sourceY = 0.2, spotType = clone</rdf:li>
     <rdf:li>centerX = bogus, spotType = heal</rdf:li>
    </rdf:Seq>
   </crs:RetouchInfo>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
    const doc = parseCameraRawXmp(xml);
    const spots = doc.recipe?.heal?.spots ?? [];
    expect(spots).toHaveLength(2);
    expect(spots[0]).toMatchObject({ mode: "heal", feather: 0.5, opacity: 1 });
    expect(spots[0].x).toBeCloseTo(0.512, 6);
    expect(spots[1].mode).toBe("clone");
    expect(doc.mapped).toContain("crs:RetouchInfo");
    expect(doc.skipped).toContain("crs:RetouchInfo (1 unparseable spot(s))");
  });

  it("reports the deliberate-skip reason for structured grammars, not 'unrecognized'", () => {
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">
   <crs:PointColors>
    <rdf:Seq><rdf:li>1 149.4 0.87 0.59</rdf:li></rdf:Seq>
   </crs:PointColors>
   <crs:RetouchAreas>
    <rdf:Seq><rdf:li>opaque</rdf:li></rdf:Seq>
   </crs:RetouchAreas>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
    const doc = parseCameraRawXmp(xml);
    expect(doc.skipped.find((s) => s.startsWith("crs:PointColors"))).toContain("mvcr:Payload");
    expect(doc.skipped.find((s) => s.startsWith("crs:RetouchAreas"))).toContain("RetouchInfo");
    expect(doc.skipped.join("\n")).not.toContain("unrecognized property");
  });
});
