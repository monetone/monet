// GAL-DEV-16: the six crs: families the dialect used to drop — Parametric
// (regions + splits), Optics, Transform, Calibration, CameraProfile and Crop —
// round-trip through serialize/parse and ingest from Lightroom-authored XMP.
import { describe, expect, it } from "vitest";

import { createDefaultRecipe, normalizeRecipe } from "./developRecipe";
import { parseCameraRawXmp, serializeCameraRawXmp } from "./xmp";

/** A recipe touching every family GAL-DEV-16 added to the dialect. */
function recipe() {
  const r = createDefaultRecipe();
  r.toneCurve.parametric = { highlights: -30, lights: 15, darks: -10, shadows: 40 };
  r.toneCurve.parametricSplits = [0.2, 0.55, 0.8];
  r.optics = { ...r.optics, distortionAmount: -0.35, aberration: 1, defringePurpleAmount: 0.5 };
  r.transform = {
    ...r.transform,
    vertical: 0.25,
    horizontal: -0.1,
    rotate: 1 / 3, // 5° at the stored 15°-per-unit scale
    aspect: 0.4,
    scale: 1.2,
    xOffset: -0.05,
    yOffset: 0.07,
    constrainCrop: true,
  };
  r.calibration = { shadowTint: -0.3, redHue: 0.25, redSat: -0.15, greenHue: 0.05, greenSat: 0.1, blueHue: -0.2, blueSat: 0.5 };
  r.profile = { ...r.profile, id: "adobe-color", name: "Adobe Color" };
  r.crop = { ...r.crop, rect: { top: 0.05, left: 0.1, bottom: 0.95, right: 0.9 }, angle: -2.5 };
  return r;
}

describe("Camera Raw XMP — Optics/Transform/Calibration/Profile/Crop/Parametric (GAL-DEV-16)", () => {
  it("round-trips all six families through the crs: block", () => {
    const doc = parseCameraRawXmp(serializeCameraRawXmp({ recipe: recipe() }));
    const r = doc.recipe!;

    expect(r.toneCurve?.parametric).toEqual({ highlights: -30, lights: 15, darks: -10, shadows: 40 });
    expect(r.toneCurve?.parametricSplits?.[0]).toBeCloseTo(0.2, 6);
    expect(r.toneCurve?.parametricSplits?.[1]).toBeCloseTo(0.55, 6);
    expect(r.toneCurve?.parametricSplits?.[2]).toBeCloseTo(0.8, 6);

    expect(r.optics?.distortionAmount).toBeCloseTo(-0.35, 6);
    expect(r.optics?.aberration).toBe(1);
    expect(r.optics?.defringePurpleAmount).toBeCloseTo(0.5, 6);

    expect(r.transform?.vertical).toBeCloseTo(0.25, 6);
    expect(r.transform?.horizontal).toBeCloseTo(-0.1, 6);
    expect(r.transform?.rotate).toBeCloseTo(1 / 3, 5);
    expect(r.transform?.aspect).toBeCloseTo(0.4, 6);
    expect(r.transform?.scale).toBeCloseTo(1.2, 6);
    expect(r.transform?.xOffset).toBeCloseTo(-0.05, 6);
    expect(r.transform?.yOffset).toBeCloseTo(0.07, 6);
    expect(r.transform?.constrainCrop).toBe(true);

    expect(r.calibration?.shadowTint).toBeCloseTo(-0.3, 6);
    expect(r.calibration?.redHue).toBeCloseTo(0.25, 6);
    expect(r.calibration?.blueSat).toBeCloseTo(0.5, 6);

    expect(r.profile?.id).toBe("adobe-color");

    expect(r.crop?.rect).toEqual({ top: 0.05, left: 0.1, bottom: 0.95, right: 0.9 });
    expect(r.crop?.angle).toBeCloseTo(-2.5, 6);

    // The patch survives normalizeRecipe's merge into a full canonical recipe
    // (the exact path PresetsPanel import and sidecar read take).
    const full = normalizeRecipe(r);
    expect(full.transform.scale).toBeCloseTo(1.2, 6);
    expect(full.crop.rect.left).toBeCloseTo(0.1, 6);
    expect(full.toneCurve.parametricSplits[1]).toBeCloseTo(0.55, 6);
  });

  it("a neutral recipe still writes none of the new attributes", () => {
    const xml = serializeCameraRawXmp({ recipe: createDefaultRecipe() });
    for (const prop of ["Parametric", "Perspective", "Crop", "ShadowTint", "RedHue", "CameraProfile", "LensManual", "AutoLateralCA", "Defringe"]) {
      expect(xml).not.toContain(`crs:${prop}`);
    }
  });

  it("ingests a Lightroom-authored preset in ACR domains", () => {
    const lr = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:HasSettings="True"
   crs:CameraProfile="Adobe Monochrome"
   crs:CameraProfileDigest="441F68BA95CD29A6O"
   crs:ParametricShadows="-40"
   crs:ParametricShadowSplit="20"
   crs:LensManualDistortionAmount="25"
   crs:DefringePurpleAmount="20"
   crs:DefringePurpleHueLo="30"
   crs:PerspectiveVertical="-50"
   crs:PerspectiveRotate="5"
   crs:PerspectiveScale="110"
   crs:PerspectiveUpright="4"
   crs:ShadowTint="-30"
   crs:GreenSaturation="25"
   crs:HasCrop="True"
   crs:CropTop="0.1"
   crs:CropLeft="0"
   crs:CropBottom="1"
   crs:CropRight="0.8"
   crs:CropAngle="1.5">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
    const doc = parseCameraRawXmp(lr);
    const r = doc.recipe!;
    expect(r.profile?.id).toBe("monochrome");
    expect(r.toneCurve?.parametric?.shadows).toBe(-40);
    expect(r.toneCurve?.parametricSplits?.[0]).toBeCloseTo(0.2, 6);
    expect(r.optics?.distortionAmount).toBeCloseTo(0.25, 6);
    expect(r.optics?.defringePurpleAmount).toBe(1); // ACR max 20 → full strength
    expect(r.transform?.vertical).toBeCloseTo(-0.5, 6);
    expect(r.transform?.rotate).toBeCloseTo(5 / 15, 6); // degrees → 15°-per-unit
    expect(r.transform?.scale).toBeCloseTo(1.1, 6);
    expect(r.calibration?.shadowTint).toBeCloseTo(-0.3, 6);
    expect(r.calibration?.greenSat).toBeCloseTo(0.25, 6);
    expect(r.crop?.rect).toEqual({ top: 0.1, left: 0, bottom: 1, right: 0.8 });
    expect(r.crop?.angle).toBeCloseTo(1.5, 6);
    // Not silent: what can't be reproduced is reported, not dropped.
    expect(doc.skipped.some((s) => s.startsWith("crs:PerspectiveUpright"))).toBe(true);
    expect(r.optics?.defringePurpleHue).toEqual([30, 70]); // hue windows map since #444
    // Profile-digest bookkeeping is neither mapped nor noise in `skipped`.
    expect(doc.skipped.some((s) => s.includes("CameraProfileDigest"))).toBe(false);
    // An unknown profile name is skipped with a reason, never guessed.
    const unknown = parseCameraRawXmp(lr.replace("Adobe Monochrome", "Fuji Provia v2"));
    expect(unknown.recipe?.profile).toBeUndefined();
    expect(unknown.skipped.some((s) => s.includes('no engine profile for "Fuji Provia v2"'))).toBe(true);
  });

  it("round-trips a DNG camera profile by name + digest, ACR-style (#446)", () => {
    const digest = "0123456789ABCDEF0123456789ABCDEF";
    const custom = createDefaultRecipe();
    custom.profile = { id: "custom", name: "Studio Portrait", group: "Custom", amount: 0.75, digest };
    const xml = serializeCameraRawXmp({ recipe: custom });
    expect(xml).toContain('crs:CameraProfile="Studio Portrait"');
    expect(xml).toContain(`crs:CameraProfileDigest="${digest}"`);
    const back = normalizeRecipe(parseCameraRawXmp(xml).recipe);
    expect(back.profile).toMatchObject({ id: "custom", name: "Studio Portrait", digest });

    const embedded = createDefaultRecipe();
    embedded.profile = { id: "embedded", name: "Adobe Standard", group: "Embedded", amount: 1, digest };
    const embeddedXml = serializeCameraRawXmp({ recipe: embedded });
    expect(embeddedXml).toContain('crs:CameraProfile="Embedded"');
    expect(parseCameraRawXmp(embeddedXml).recipe?.profile).toMatchObject({ id: "embedded", digest });

    // A foreign sidecar's digest is read case-insensitively; a name with no
    // usable digest stays skipped (see the Lightroom test above).
    const foreign = xml.replace(digest, digest.toLowerCase()).replace("Studio Portrait", "Adobe Standard");
    expect(parseCameraRawXmp(foreign).recipe?.profile).toMatchObject({ id: "custom", name: "Adobe Standard", digest });
  });

  it("writes a legacy recipe's CA boolean as a number, never NaN (#221)", () => {
    // normalizeOptics keeps `removeChromaticAberration` and injects no
    // `aberration` (digest stability), exactly like the shipped v2 fixtures.
    const legacy = normalizeRecipe({ optics: { removeChromaticAberration: true } });
    const xml = serializeCameraRawXmp({ recipe: legacy });
    expect(xml).not.toContain("NaN");
    expect(xml).toContain('crs:AutoLateralCA="1"');
    const doc = parseCameraRawXmp(xml);
    expect(doc.recipe?.optics?.aberration).toBe(1);
    expect(doc.skipped.some((s) => s.includes("AutoLateralCA"))).toBe(false);
    // The boolean's false case is the parser's default — nothing to write.
    const off = serializeCameraRawXmp({ recipe: normalizeRecipe({ optics: { removeChromaticAberration: false } }) });
    expect(off).not.toContain("crs:AutoLateralCA");
  });
});
