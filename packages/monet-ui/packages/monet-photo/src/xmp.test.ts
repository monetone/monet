import { describe, expect, it } from "vitest";

import { createDefaultRecipe, normalizeRecipe } from "./developRecipe";
import {
  parseCameraRawXmp,
  serializeCameraRawXmp,
  tryParseCameraRawXmp,
  xmpSidecarPath,
  type XmpPhotoMetadata,
} from "./xmp";

/** A recipe touching every crs: family the dialect writes. */
function recipe() {
  const r = createDefaultRecipe();
  r.basic = { ...r.basic, exposure: 0.75, contrast: 0.2, shadows: -0.4, temp: 0.1, tint: -0.05 };
  r.detail = { ...r.detail, sharpenAmount: 0.5, sharpenRadius: 1.5, nrColor: 0.25 };
  r.effects = { ...r.effects, vignetteAmount: -0.3, grainAmount: 0.2, grainRoughness: 0.6 };
  r.colorMixer.hue[2] = 0.35; // Yellow
  r.colorMixer.saturation[5] = -0.2; // Blue
  r.colorGrading.shadows = { hue: 210, sat: 0.4, lum: 0 };
  r.toneCurve.point = [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }];
  return r;
}

const META: XmpPhotoMetadata = {
  rating: 4,
  label: "Red",
  title: "Fjord & <mist>",
  caption: "A caption",
  creator: "A. Photographer",
  copyright: "© 2026",
  city: "Bergen",
  stateProvince: "Vestland",
  country: "Norway",
  jobTitle: "Staff",
  credit: "Monet",
  source: "Camera",
  keywords: ["fjord", "mist"],
  hierarchical: ["Places|Norway|Bergen"],
};

/** Stands in for Vision's opaque sidecar payload (this module never inspects it). */
const MONET_PAYLOAD = {
  version: 1,
  source: { originalName: "DSC_0001.NEF", originalByteLength: 4096, metadata: { iso: 200 } },
  recipe: { schemaVersion: 2, basic: { exposure: 0.75 } },
  snapshots: [{ id: "a", name: "Snap" }],
};

describe("Camera Raw XMP — one dialect", () => {
  it("round-trips the crs: block, IPTC metadata and the Monet payload in one document", () => {
    const xml = serializeCameraRawXmp({ name: "My Look", recipe: recipe(), metadata: META, monet: MONET_PAYLOAD });
    const doc = parseCameraRawXmp(xml);

    expect(doc.name).toBe("My Look");
    // Develop settings survive through the Adobe-readable crs: block.
    expect(doc.recipe?.basic?.exposure).toBeCloseTo(0.75, 6);
    expect(doc.recipe?.basic?.contrast).toBeCloseTo(0.2, 6);
    expect(doc.recipe?.basic?.shadows).toBeCloseTo(-0.4, 6);
    expect(doc.recipe?.basic?.wbMode).toBe("custom"); // Incremental* implies custom WB
    expect(doc.recipe?.detail?.sharpenRadius).toBeCloseTo(1.5, 6);
    expect(doc.recipe?.effects?.vignetteAmount).toBeCloseTo(-0.3, 6);
    expect(doc.recipe?.effects?.grainRoughness).toBeCloseTo(0.6, 6);
    expect(doc.recipe?.colorMixer?.hue?.[2]).toBeCloseTo(0.35, 6);
    expect(doc.recipe?.colorGrading?.shadows).toEqual({ hue: 210, sat: 0.4 });
    expect(doc.recipe?.toneCurve?.point?.[1].x).toBeCloseTo(128 / 255, 6);

    // …and the lossless Monet payload rides along in the same file.
    expect(doc.monet).toEqual(MONET_PAYLOAD);
    expect(doc.metadata).toEqual(META);
  });

  it("re-emits a foreign Monet payload byte-for-byte (courier rule)", () => {
    const original = serializeCameraRawXmp({ recipe: recipe(), monet: MONET_PAYLOAD });
    const doc = parseCameraRawXmp(original);
    // A non-owner re-saves with its own metadata and must not disturb the payload.
    const resaved = serializeCameraRawXmp({ recipe: recipe(), metadata: META, monetRaw: doc.monetRaw });
    expect(parseCameraRawXmp(resaved).monetRaw).toBe(doc.monetRaw);
    expect(parseCameraRawXmp(resaved).monet).toEqual(MONET_PAYLOAD);
  });

  it("reads the legacy Vision-only dialect (payload, no crs:)", () => {
    const legacy = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:mvcr="https://monet.vision/ns/camera-raw/1.0/">
      <mvcr:Payload encoding="base64">${btoa(JSON.stringify(MONET_PAYLOAD))}</mvcr:Payload>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    const doc = parseCameraRawXmp(legacy);
    expect(doc.monet).toEqual(MONET_PAYLOAD);
    expect(doc.recipe).toBeNull();
  });

  it("reads the legacy Galerie/Lightroom-only dialect (crs:, no payload)", () => {
    const legacy = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
   crs:HasSettings="True"
   crs:Exposure2012="+0.50"
   crs:Blacks2012="-25"
   crs:SharpenDetail="40"
   xmp:Rating="3">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
    const doc = parseCameraRawXmp(legacy);
    expect(doc.monet).toBeNull();
    expect(doc.recipe?.basic?.exposure).toBeCloseTo(0.5, 6);
    expect(doc.recipe?.basic?.blacks).toBeCloseTo(-0.25, 6);
    expect(doc.metadata.rating).toBe(3);
    // Sharpen Detail is ABI-backed since the v5 extras block (#444), so it maps
    // in ACR's own units instead of being skipped.
    expect(doc.recipe?.detail?.sharpenDetail).toBe(40);
    expect(doc.skipped.some((s) => s.startsWith("crs:SharpenDetail"))).toBe(false);
  });

  it("round-trips the v5 Detail and Optics fields in ACR units (#444)", () => {
    const r = createDefaultRecipe();
    r.detail = {
      ...r.detail, sharpenDetail: 60, sharpenMasking: 30, nrLuminanceContrast: 20,
      nrColorDetail: 10, nrColorSmoothness: 80,
    };
    r.optics = {
      ...r.optics, vignettingAmount: -0.4, defringePurpleHue: [20, 80],
      defringeGreenAmount: 0.5, defringeGreenHue: [35, 65],
    };
    const xml = serializeCameraRawXmp({ recipe: r });
    expect(xml).toContain('crs:SharpenDetail="60"');
    expect(xml).toContain('crs:VignetteAmount="-40"');
    expect(xml).toContain('crs:DefringeGreenAmount="10"');
    const back = normalizeRecipe(parseCameraRawXmp(xml).recipe!);
    expect(back.detail).toEqual(r.detail);
    expect(back.optics.vignettingAmount).toBeCloseTo(-0.4, 6);
    expect(back.optics.defringePurpleHue).toEqual([20, 80]);
    expect(back.optics.defringeGreenAmount).toBeCloseTo(0.5, 6);
    expect(back.optics.defringeGreenHue).toEqual([35, 65]);
  });

  it("keeps both legacy readers' anchors intact in a unified document", () => {
    const xml = serializeCameraRawXmp({ recipe: recipe(), metadata: META, monet: MONET_PAYLOAD });
    // Vision keys off exactly one mvcr:Payload element…
    expect(xml.match(/<mvcr:Payload\b/g)).toHaveLength(1);
    // …Galerie/Lightroom off crs: attributes on the rdf:Description.
    expect(xml).toContain('crs:HasSettings="True"');
    expect(xml).toContain('xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"');
    // Metadata stays XML-escaped, so neither reader sees a torn document.
    expect(xml).toContain("Fjord &amp; &lt;mist&gt;");
  });

  it("fails loudly instead of degrading to an empty edit", () => {
    expect(() => parseCameraRawXmp("<x:xmpmeta><rdf:RDF></rdf:RDF></x:xmpmeta>")).toThrow(/no crs:/);
    expect(() => parseCameraRawXmp("not xml at all")).toThrow();
    expect(() => parseCameraRawXmp('<!DOCTYPE x [<!ENTITY a "b">]><x crs:Exposure2012="1"></x>')).toThrow(/DOCTYPE/);
    expect(() => parseCameraRawXmp("<x><crs:Foo></x>")).toThrow(/malformed/);
    const bad = serializeCameraRawXmp({ monet: MONET_PAYLOAD }).replace(/(<mvcr:Payload[^>]*>)./, "$1*");
    expect(() => parseCameraRawXmp(bad)).toThrow(/base64/);
    // An injected payload can't tear the document open.
    expect(() => serializeCameraRawXmp({ monetRaw: "</mvcr:Payload><evil/>" })).toThrow(/monetRaw/);
    // …and the tolerant probe swallows all of it.
    expect(tryParseCameraRawXmp("not xml at all")).toBeNull();
  });

  it("reads a namespace-only crs document as an empty preset, not an error", () => {
    // Galerie has always accepted this shape; `xmlns:crs=` does not contain the
    // substring `crs:`, so a naive discriminator rejects a valid empty preset.
    const xml =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">' +
      "</rdf:Description></rdf:RDF></x:xmpmeta>";
    const doc = parseCameraRawXmp(xml);
    expect(doc.mapped).toEqual([]);
    expect(doc.monetRaw).toBeNull();
    // A document with neither crs nor a payload is still an error.
    expect(() => parseCameraRawXmp("<x:xmpmeta><rdf:RDF></rdf:RDF></x:xmpmeta>")).toThrow(/no crs:/);
  });

  it("keeps a tone curve whose points collapse under 0..255 quantization (#224)", () => {
    // A steep segment authored 0.001 apart in x (Galerie's MIN_GAP) rounds to the
    // same integer on export; the reader must drop the duplicate, not the curve.
    const r = createDefaultRecipe();
    r.toneCurve.point = [{ x: 0, y: 0 }, { x: 0.5, y: 0.3 }, { x: 0.501, y: 0.7 }, { x: 1, y: 1 }];
    const doc = parseCameraRawXmp(serializeCameraRawXmp({ recipe: r }));
    expect(doc.skipped.some((s) => s.includes("ToneCurvePV2012"))).toBe(false);
    const pts = doc.recipe!.toneCurve!.point!;
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[1].x).toBeCloseTo(0.5, 2);
    expect(pts[1].y).toBeCloseTo(0.3, 2);
    expect(pts[2]).toEqual({ x: 1, y: 1 });
    // A list that collapses to fewer than two points is still reported, not guessed.
    const flat = parseCameraRawXmp(
      serializeCameraRawXmp({ recipe: r }).replace(/<rdf:li>0, 0<\/rdf:li>[\s\S]*?<rdf:li>255, 255<\/rdf:li>/,
        "<rdf:li>128, 10</rdf:li>\n      <rdf:li>128, 200</rdf:li>"),
    );
    expect(flat.skipped).toContain("crs:ToneCurvePV2012 (unparseable point list)");
  });

  it("writes a vignette midpoint of 0 instead of losing it to the zero-gate (#118)", () => {
    // `add` skips zeros because 0 is what the parser assumes — but the recipe
    // DEFAULT for midpoint is 0.5, so a legal midpoint=0 came back as 0.5 after a
    // round trip, changing a render the sidecar claimed to reproduce.
    const r = createDefaultRecipe();
    r.effects = { ...r.effects, vignetteAmount: -0.5, vignetteMidpoint: 0 };
    const xml = serializeCameraRawXmp({ recipe: r });
    expect(xml).toContain('crs:PostCropVignetteMidpoint="0"');
    const back = normalizeRecipe(parseCameraRawXmp(xml).recipe);
    expect(back.effects.vignetteMidpoint).toBe(0);
    expect(back.effects.vignetteAmount).toBeCloseTo(-0.5, 6);
    // …and the default itself stays out of the document (it IS what's assumed).
    expect(serializeCameraRawXmp({ recipe: createDefaultRecipe() })).not.toContain("PostCropVignetteMidpoint");
  });

  it("accepts UTF-8 bytes and derives the sidecar path from any source name", () => {
    const xml = serializeCameraRawXmp({ recipe: recipe(), monet: MONET_PAYLOAD });
    expect(parseCameraRawXmp(new TextEncoder().encode(xml))).toEqual(parseCameraRawXmp(xml));
    expect(xmpSidecarPath("/photos/DSC_0001.NEF")).toBe("/photos/DSC_0001.xmp");
    expect(xmpSidecarPath("/photos/no.dot.here/RAW")).toBe("/photos/no.dot.here/RAW.xmp");
  });
});

describe("Tint rides Adobe's axis in XMP (#108)", () => {
  it("negates on write, so a sidecar means what Lightroom thinks it means", () => {
    // The recipe stores tint on the INTERNAL axis (positive = green); crs:Tint is
    // Adobe's (positive = magenta). Writing it straight through made every sidecar
    // apply the opposite correction in ACR/LR.
    const r = createDefaultRecipe();
    r.basic.tint = 0.5; // internal: green
    const xmp = serializeCameraRawXmp({ recipe: r });
    expect(xmp).toContain('IncrementalTint="-50"');
  });

  it("round-trips through the negation without drift", () => {
    const r = createDefaultRecipe();
    r.basic.tint = -0.32;
    const back = parseCameraRawXmp(serializeCameraRawXmp({ recipe: r }));
    expect(back.recipe?.basic?.tint).toBeCloseTo(-0.32, 5);
  });
});
