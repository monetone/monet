// Vision ⇄ Galerie/ACR look interchange: Vision's sidecar and its develop
// presets now speak the ONE shared Camera Raw XMP dialect
// (@monet-ui/monet-photo/xmp), so a look crosses apps instead of dying in a
// private base64 blob (or in localStorage).
import { describe, expect, it } from "vitest";
import { parseCameraRawXmp as parseSharedXmp } from "@monet-ui/monet-photo";
import { CAMERA_RAW_SOURCE_VERSION, defaultRecipe, type CameraRawSource } from "./cameraRaw";
import { normalizeWorkingRecipe, workingRecipeToParams } from "./visionDevelopRecipe";
import {
  CAMERA_RAW_XMP_VERSION,
  parseCameraRawLookXmp,
  parseCameraRawXmp,
  serializeCameraRawXmp,
} from "./cameraRawSidecar";
import {
  DEFAULT_CAMERA_RAW_PRESETS,
  parseCameraRawPresetXmp,
  serializeCameraRawPresetXmp,
} from "./cameraRawPresets";

function sourceFixture(): CameraRawSource {
  const canonical = defaultRecipe();
  canonical.basic.contrast = 0.25;
  canonical.basic.vibrance = 0.35;
  canonical.grade.shadows = { hue: 210, sat: 0.4 };
  return {
    version: CAMERA_RAW_SOURCE_VERSION,
    originalName: "DSC_0042.nef",
    originalPath: "/private/photos/DSC_0042.nef",
    sha256: "b".repeat(64),
    originalBytes: new Uint8Array([1, 2, 3, 4, 5]),
    metadata: { make: "Nikon", model: "Z 8" },
    recipe: normalizeWorkingRecipe(canonical),
  };
}

/** Vision's pre-batch-3 sidecar: an xpacket wrapper around ONLY the base64
 *  payload. Existing user `.xmp` files look exactly like this (invariant #2). */
function legacyVisionPacket(payload: unknown): string {
  const encoded = btoa(JSON.stringify(payload));
  return `<?xpacket begin="${"\uFEFF"}" id="W5M0MpCehiHzreSzNTczkc9d"?>\n`
    + `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n`
    + `  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n`
    + `    <rdf:Description rdf:about="" xmlns:mvcr="https://monet.vision/ns/camera-raw/1.0/">\n`
    + `      <mvcr:Payload encoding="base64">${encoded}</mvcr:Payload>\n`
    + `    </rdf:Description>\n`
    + `  </rdf:RDF>\n`
    + `</x:xmpmeta>\n`
    + `<?xpacket end="w"?>`;
}

/** What Galerie / Lightroom / ACR write: a `crs:` document, no Monet payload. */
const FOREIGN_CRS_XMP = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:HasSettings="True"
   crs:PresetName="Faded Film"
   crs:Exposure2012="0.5"
   crs:Contrast2012="-20"
   crs:ColorGradeShadowHue="60"
   crs:ColorGradeShadowSat="15">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;

describe("Vision Camera Raw XMP speaks the shared dialect", () => {
  it("writes a crs: look Galerie/Lightroom can read AND keeps the lossless payload", () => {
    const source = sourceFixture();
    const xmp = serializeCameraRawXmp(source);

    // The interoperable half: a foreign reader finds real develop settings.
    const shared = parseSharedXmp(xmp);
    expect(shared.recipe?.basic?.contrast).toBeCloseTo(0.25, 6);
    expect(shared.recipe?.basic?.vibrance).toBeCloseTo(0.35, 6);
    expect(shared.recipe?.colorGrading?.shadows).toEqual({ hue: 210, sat: 0.4 });

    // The lossless half: Vision still reloads its own recipe byte-exactly.
    const sidecar = parseCameraRawXmp(xmp)!;
    expect(sidecar.version).toBe(CAMERA_RAW_XMP_VERSION);
    expect(sidecar.source.originalName).toBe(source.originalName);
    expect(sidecar.recipe).toEqual(source.recipe);
    // Still no camera bytes and no local path on the wire.
    expect(xmp).not.toContain(source.originalPath!);
    expect(xmp).not.toContain("AQIDBAU=");
  });

  it("still loads a legacy Vision-only packet (invariant #2)", () => {
    const source = sourceFixture();
    const legacy = legacyVisionPacket({
      version: CAMERA_RAW_XMP_VERSION,
      source: { originalName: "old.nef", originalByteLength: 5, metadata: {} },
      recipe: source.recipe,
    });
    expect(parseCameraRawXmp(legacy)?.recipe).toEqual(source.recipe);
    expect(parseCameraRawXmp(new TextEncoder().encode(legacy))?.source.originalName).toBe("old.nef");
  });

  it("reads a foreign crs:-only document as an identity-free look", () => {
    // The sidecar reader refuses it — it carries no Monet payload to trust.
    expect(parseCameraRawXmp(FOREIGN_CRS_XMP)).toBeNull();

    const look = parseCameraRawLookXmp(FOREIGN_CRS_XMP)!;
    expect(look.name).toBe("Faded Film");
    expect(look.recipe.basic.exposure).toBeCloseTo(0.5, 6);
    expect(look.recipe.basic.contrast).toBeCloseTo(-0.2, 6);
    expect(look.recipe.colorGrading.shadows.hue).toBe(60);
    // Untouched panels fall back to defaults, not undefined → no NaN in the ABI.
    expect(Array.from(workingRecipeToParams(look.recipe)).some(Number.isNaN)).toBe(false);
  });

  it("rejects input that is not a Camera Raw XMP at all", () => {
    expect(parseCameraRawLookXmp("<x:xmpmeta><dc:title>hi</dc:title></x:xmpmeta>")).toBeNull();
    expect(parseCameraRawLookXmp("not xml")).toBeNull();
    expect(parseCameraRawLookXmp(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
  });
});

describe("Camera Raw presets export/import as .xmp", () => {
  it("prefers a Vision sidecar's lossless recipe over its lossy crs look", () => {
    const xmp = serializeCameraRawXmp(sourceFixture());
    expect(parseCameraRawPresetXmp(xmp, "Sidecar")?.recipe)
      .toEqual(parseCameraRawXmp(xmp)?.recipe);
  });

  it("round-trips every starter look to identical engine params", () => {
    for (const preset of DEFAULT_CAMERA_RAW_PRESETS) {
      const back = parseCameraRawPresetXmp(serializeCameraRawPresetXmp(preset))!;
      expect(back.name).toBe(preset.name);
      // The starter looks are authored in Vision's canonical shape, whose
      // tone-curve enable flag defaults the other way from the shared V2 one.
      // Both curves are the identity diagonal, so no pixel differs — align the
      // flag and hold the rest to the full 1086-float ABI.
      back.recipe.enabled = { ...back.recipe.enabled, toneCurve: preset.recipe.enabled.toneCurve };
      expect(Array.from(workingRecipeToParams(back.recipe)))
        .toEqual(Array.from(workingRecipeToParams(preset.recipe)));
    }
  });

  it("imports a Lightroom/ACR preset and names an unnamed one from its file", () => {
    expect(parseCameraRawPresetXmp(FOREIGN_CRS_XMP)!.name).toBe("Faded Film");
    const unnamed = FOREIGN_CRS_XMP.replace(/\s*crs:PresetName="[^"]*"/, "");
    expect(parseCameraRawPresetXmp(unnamed, "Sunset")!.name).toBe("Sunset");
    expect(parseCameraRawPresetXmp("nonsense")).toBeNull();
  });
});
