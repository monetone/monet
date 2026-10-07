import { describe, expect, it } from "vitest";
import {
  CAMERA_RAW_SOURCE_VERSION,
  defaultRecipe,
  recipeToParams,
  type CameraRawSource,
} from "./cameraRaw";
import { normalizeWorkingRecipe, workingRecipeToParams } from "./visionDevelopRecipe";
import { parseCameraRawPresetXmp } from "./cameraRawPresets";
import {
  applyCameraRawXmp,
  isOwnCameraRawXmp,
  parseCameraRawLookXmp,
  cameraRawSidecarSourceSnapshot,
  CAMERA_RAW_XMP_VERSION,
  MAX_CAMERA_RAW_XMP_BYTES,
  parseCameraRawXmp,
  serializeCameraRawXmp,
} from "./cameraRawSidecar";

function sourceFixture(): CameraRawSource {
  // Author in the compact Canonical shape, then migrate to the working V2 recipe
  // the source now carries.
  const canonical = defaultRecipe();
  canonical.basic.exposure = 0.75;
  canonical.curve.pointsByChannel[0] = [
    { x: 0, y: 0 }, { x: 0.45, y: 0.6 }, { x: 1, y: 1 },
  ];
  canonical.curve.parametric = { highlights: 20, lights: -5, darks: 10, shadows: -15 };
  canonical.crop = {
    enabled: true, x: 0.1, y: 0.2, width: 0.75, height: 0.7, angle: 2,
    constrainAspect: false, flipHorizontal: false, flipVertical: false,
  };
  return {
    version: CAMERA_RAW_SOURCE_VERSION,
    originalName: "DSC_0042.nef",
    originalPath: "/private/photos/DSC_0042.nef",
    mimeType: "image/x-nikon-nef",
    sha256: "b".repeat(64),
    lastModified: 1_700_000_000_000,
    originalBytes: new Uint8Array([1, 2, 3, 4, 5]),
    metadata: { make: "Nikon", model: "Z 8", width: 8256, height: 5504, iso: 400 },
    recipe: normalizeWorkingRecipe(canonical),
  };
}

describe("camera raw snapshots", () => {
  it("round-trips named snapshots through XMP and adopts them on apply", () => {
    const source = sourceFixture();
    const alt = defaultRecipe();
    alt.basic.exposure = -0.5;
    source.snapshots = [
      { name: "Base", recipe: normalizeWorkingRecipe(defaultRecipe()) },
      { name: "Moody", recipe: normalizeWorkingRecipe(alt) },
    ];
    const xmp = serializeCameraRawXmp(source);
    const sidecar = parseCameraRawXmp(xmp)!;
    expect(sidecar.snapshots).toHaveLength(2);
    expect(sidecar.snapshots![1].name).toBe("Moody");
    expect(sidecar.snapshots![1].recipe.basic.exposure).toBe(-0.5);

    // applyCameraRawXmp adopts the sidecar's snapshots onto the target source.
    const bare = cameraRawSidecarSourceSnapshot({ ...sourceFixture(), snapshots: undefined });
    const applied = applyCameraRawXmp(bare, sidecar)!;
    expect(applied.snapshots).toHaveLength(2);
    expect(applied.snapshots![0].name).toBe("Base");
  });

  it("loads an OLD Canonical schema-2 sidecar to byte-identical engine params (invariant #2)", () => {
    // A pre-flip sidecar stored the Canonical recipe shape verbatim.
    const canonical = defaultRecipe();
    canonical.basic.exposure = 0.75;
    canonical.grade.shadows = { hue: 210, sat: 0.4 };
    canonical.geometry.vertical = 0.125;
    const xmp = packetFor({
      version: CAMERA_RAW_XMP_VERSION,
      source: { originalName: "old.nef", originalByteLength: 5, metadata: {} },
      recipe: canonical,
    });
    const parsed = parseCameraRawXmp(xmp)!;
    expect(Array.from(workingRecipeToParams(parsed.recipe)))
      .toEqual(Array.from(recipeToParams(canonical)));
  });

  it("drops invalid snapshot entries and caps the list", () => {
    const source = sourceFixture();
    source.snapshots = [
      { name: "", recipe: normalizeWorkingRecipe(defaultRecipe()) }, // empty name → dropped
      { name: "ok", recipe: normalizeWorkingRecipe(defaultRecipe()) },
    ];
    const sidecar = parseCameraRawXmp(serializeCameraRawXmp(source))!;
    expect(sidecar.snapshots?.map((s) => s.name)).toEqual(["ok"]);
  });
});

function packetFor(payload: unknown): string {
  const encoded = btoa(JSON.stringify(payload));
  return `<x:xmpmeta><mvcr:Payload encoding="base64">${encoded}</mvcr:Payload></x:xmpmeta>`;
}

describe("Camera Raw XMP sidecars", () => {
  it("round-trips the full editable recipe without leaking source bytes or paths", () => {
    const source = sourceFixture();
    const xmp = serializeCameraRawXmp(source);
    const parsed = parseCameraRawXmp(xmp);

    expect(parsed).toEqual({
      version: CAMERA_RAW_XMP_VERSION,
      source: {
        originalName: source.originalName,
        originalByteLength: source.originalBytes.length,
        mimeType: source.mimeType,
        sha256: source.sha256,
        lastModified: source.lastModified,
        metadata: source.metadata,
      },
      recipe: source.recipe,
    });
    expect(parsed?.recipe.toneCurve.point).toEqual(source.recipe.toneCurve.point);
    expect(parsed?.recipe.toneCurve.parametric).toEqual(source.recipe.toneCurve.parametric);
    expect(xmp).not.toContain(source.originalPath!);
    expect(xmp).not.toContain("AQIDBAU=");
    expect(parseCameraRawXmp(new TextEncoder().encode(xmp))).toEqual(parsed);
  });

  it("applies a matching sidecar through a byte-free source snapshot", () => {
    const source = sourceFixture();
    const originalBytes = source.originalBytes;
    Object.defineProperty(originalBytes, "slice", {
      value: () => { throw new Error("Camera bytes must not be cloned"); },
    });
    const snapshot = cameraRawSidecarSourceSnapshot(source);
    const sidecar = parseCameraRawXmp(serializeCameraRawXmp(source))!;
    sidecar.recipe.basic.exposure = -1.25;
    const applied = applyCameraRawXmp(snapshot, sidecar);

    expect(applied?.recipe.basic.exposure).toBe(-1.25);
    expect(snapshot.originalByteLength).toBe(originalBytes.length);
    expect(snapshot).not.toHaveProperty("originalBytes");
    expect(applied).not.toHaveProperty("originalBytes");
    expect(source.originalBytes).toBe(originalBytes);
  });

  it("rejects mismatched identities, malformed packets, entities, and future payloads", () => {
    const source = sourceFixture();
    const snapshot = cameraRawSidecarSourceSnapshot(source);
    const sidecar = parseCameraRawXmp(serializeCameraRawXmp(source))!;
    sidecar.source.sha256 = "c".repeat(64);
    expect(applyCameraRawXmp(snapshot, sidecar)).toBeNull();
    delete sidecar.source.sha256;
    expect(applyCameraRawXmp(snapshot, sidecar)).toBeNull();
    sidecar.source.sha256 = source.sha256;
    sidecar.source.originalByteLength++;
    expect(applyCameraRawXmp(snapshot, sidecar)).toBeNull();

    expect(parseCameraRawXmp("<mvcr:Payload>%%%bad%%%</mvcr:Payload>")).toBeNull();
    expect(parseCameraRawXmp(`<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]>${serializeCameraRawXmp(source)}`)).toBeNull();
    expect(parseCameraRawXmp(`${serializeCameraRawXmp(source)}${serializeCameraRawXmp(source)}`)).toBeNull();
    expect(parseCameraRawXmp(packetFor({ ...sidecar, version: 99 }))).toBeNull();
  });

  it("tells a sidecar Vision wrote in full from one another app wrote or added to", () => {
    const own = serializeCameraRawXmp(sourceFixture());
    expect(isOwnCameraRawXmp(own)).toBe(true);
    expect(isOwnCameraRawXmp(new TextEncoder().encode(own))).toBe(true);
    // Galerie/Lightroom added a keyword to Vision's file: overwriting it would drop the keyword.
    expect(isOwnCameraRawXmp(own.replace("  </rdf:Description>", "   <dc:subject><rdf:Bag><rdf:li>trip</rdf:li></rdf:Bag></dc:subject>\n  </rdf:Description>"))).toBe(false);
    const lightroom = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
 <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Version="15.0" crs:Exposure2012="+0.50"/>
</rdf:RDF></x:xmpmeta>`;
    expect(isOwnCameraRawXmp(lightroom)).toBe(false);
    expect(isOwnCameraRawXmp("not xml")).toBe(false);
  });

  it("enforces the bounded XMP trust boundary", () => {
    expect(parseCameraRawXmp("x".repeat(MAX_CAMERA_RAW_XMP_BYTES + 1))).toBeNull();
    expect(parseCameraRawXmp(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
  });
});

describe("an imported look keeps its Transform warp in Vision (#113, #490, #444)", () => {
  it("carries an ACR preset's Perspective Scale into Vision's v4 tail", () => {
    // Vision's tail dialect used to have no slot for these, so the preset warp
    // was dropped (at best with a banner). It now renders.
    const xmp = `<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/">
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
          crs:Name="Warped" crs:PerspectiveScale="120"/>
      </rdf:RDF></x:xmpmeta>`;
    const preset = parseCameraRawPresetXmp(xmp, "fallback");
    expect(preset).not.toBeNull();
    expect(preset).not.toHaveProperty("unsupported");
    expect(preset!.recipe.transform.scale).toBeCloseTo(1.2, 6);
    const params = workingRecipeToParams(preset!.recipe);
    expect(params[1087]).toBe(4);
    expect(params[params.length - 4]).toBeCloseTo(1.2, 5);
  });

  it("keeps Perspective Aspect and X on a look", () => {
    const xmp = `<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/">
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
          crs:PerspectiveAspect="40" crs:PerspectiveX="20"/>
      </rdf:RDF></x:xmpmeta>`;
    const look = parseCameraRawLookXmp(xmp);
    expect(look).not.toHaveProperty("unsupported");
    expect(look!.recipe.transform).toMatchObject({ aspect: 0.4, xOffset: 0.2 });
    expect(Array.from(workingRecipeToParams(look!.recipe).slice(-5)).map((v) => Math.round(v * 100) / 100))
      .toEqual([0.4, 1, 0.2, 0, 0]);
  });
});
