import { describe, expect, it } from "vitest";
import {
  canSaveInPlace,
  courierContainerSave,
  documentFitsFlatFormat,
  extOf,
  FLAT_SAVE_EXTENSIONS,
  IN_PLACE_EXTENSIONS,
  isSupportedSaveExtension,
  RAW_EXTENSIONS,
  ignoredContainerEntries,
  saveAsIsCopy,
  SUPPORTED_SAVE_EXTENSIONS,
  suggestedSaveName,
  VISION_CONTAINER_APP,
  type FlatDocumentFacts,
  type FlatLayerFacts,
} from "./nativeIoPolicy";
import { LAYER_KIND } from "./engineContracts";
import { initMonetFormat, readContainer, writeContainer, type MonetContainer } from "@monet-ui/monet-format";

const RAW_SUFFIXES = ["cr2", "cr3", "nef", "arw", "dng", "raf", "rw2", "orf", "pef", "srw", "raw", "nrw", "mrw", "dcr"];

describe("native save policy", () => {
  it("normalizes file extensions from native paths", () => {
    expect(extOf("/Users/a/Work/IMAGE.PNG")).toBe("png");
    expect(extOf("C:\\Users\\a\\photo.JPEG")).toBe("jpeg");
    expect(extOf("/tmp/no-extension")).toBe("");
  });

  it("only writes in place for native remembered paths with safe formats", () => {
    expect(canSaveInPlace(true, "/tmp/doc.mvision", false)).toBe(true);
    expect(canSaveInPlace(true, "/tmp/doc.mvis", false)).toBe(true);
    expect(canSaveInPlace(true, "/tmp/flat.png", true)).toBe(true);
    expect(canSaveInPlace(true, "/tmp/layered.png", false)).toBe(false);
    expect(canSaveInPlace(true, "/tmp/source.psd", true)).toBe(false);
    for (const ext of RAW_SUFFIXES) expect(canSaveInPlace(true, `/tmp/source.${ext}`, true)).toBe(false);
    expect(canSaveInPlace(true, "/tmp/source.unknown", true)).toBe(false);
    expect(canSaveInPlace(false, "/tmp/flat.png", true)).toBe(false);
    expect(canSaveInPlace(true, null, true)).toBe(false);
  });

  it("defaults layered flat-raster saves to the lossless project format", () => {
    expect(suggestedSaveName("scan.png", false)).toBe("scan.mvision");
    expect(suggestedSaveName("scan.jpeg", false)).toBe("scan.mvision");
    expect(suggestedSaveName("design.mvision", false)).toBe("design.mvision");
    expect(suggestedSaveName("design.mvis", false)).toBe("design.mvis");
    expect(suggestedSaveName("scan.png", true)).toBe("scan.png");
    expect(suggestedSaveName(null, false)).toBe("Untitled.mvision");
  });

  it("never suggests a RAW or unknown extension as a writable destination", () => {
    for (const ext of RAW_SUFFIXES) {
      expect(suggestedSaveName(`photo.${ext}`, true)).toBe("photo.mvision");
      expect(suggestedSaveName(`photo.${ext}`, false)).toBe("photo.mvision");
    }
    expect(suggestedSaveName("photo.unknown", true)).toBe("photo.mvision");
    expect(suggestedSaveName("photo", true)).toBe("photo.mvision");
    expect(suggestedSaveName("photo.", true)).toBe("photo.mvision");
    expect(suggestedSaveName(".hidden", true)).toBe(".hidden.mvision");
  });

  it("preserves round-trippable project or flat export suffixes when the document fits", () => {
    expect(suggestedSaveName("design.mvision", false)).toBe("design.mvision");
    expect(suggestedSaveName("design.mvis", false)).toBe("design.mvis");
    expect(suggestedSaveName("layers.psd", false)).toBe("layers.mvision");
    expect(suggestedSaveName("single-layer.psd", true)).toBe("single-layer.mvision");
    expect(suggestedSaveName("layers.psb", false)).toBe("layers.mvision");
    expect(suggestedSaveName("image.png", true)).toBe("image.png");
    expect(suggestedSaveName("image.jpg", true)).toBe("image.jpg");
    expect(suggestedSaveName("image.jpeg", true)).toBe("image.jpeg");
    expect(suggestedSaveName("animation.gif", true)).toBe("animation.gif");
  });

  it("treats every PSD/PSB and layered flat-format Save As as an export copy", () => {
    expect(saveAsIsCopy("psd", true)).toBe(true);
    expect(saveAsIsCopy("PSD", false)).toBe(true);
    expect(saveAsIsCopy("psb", true)).toBe(true);
    expect(saveAsIsCopy("png", false)).toBe(true);
    expect(saveAsIsCopy("png", true)).toBe(false);
    expect(saveAsIsCopy("mvision", false)).toBe(false);
    expect(saveAsIsCopy("mvis", false)).toBe(false);
  });

  it("strictly classifies supported encoder extensions", () => {
    for (const ext of ["mvision", "mvis", "png", "jpg", "jpeg", "gif", "psd", "psb"]) {
      expect(isSupportedSaveExtension(ext)).toBe(true);
      expect(isSupportedSaveExtension(ext.toUpperCase())).toBe(true);
    }
    // Every other format the app already encodes is a Save As destination too.
    for (const ext of ["tif", "tiff", "webp", "hdr", "exr", "tga", "pdf"]) {
      expect(isSupportedSaveExtension(ext)).toBe(true);
      expect(isSupportedSaveExtension(ext.toUpperCase())).toBe(true);
    }
    // `.raw` is also Photoshop Raw (#466); every other camera suffix stays unwritable.
    for (const ext of [...RAW_SUFFIXES.filter((ext) => ext !== "raw"), "unknown", "", "bmp", "avif"]) expect(isSupportedSaveExtension(ext)).toBe(false);
  });

  it("offers JPEG 2000 and Photoshop Raw without ever defaulting onto a camera original (#466)", () => {
    for (const ext of ["jp2", "jpf", "j2k", "raw"]) {
      expect(isSupportedSaveExtension(ext)).toBe(true);
      expect(canSaveInPlace(true, `/tmp/flat.${ext}`, true)).toBe(false);
      expect(saveAsIsCopy(ext, false)).toBe(true);
    }
    expect(suggestedSaveName("scan.jp2", true)).toBe("scan.jp2");
    expect(suggestedSaveName("scan.jp2", false)).toBe("scan.mvision");
    // Save As never pre-fills `.raw`: the open file may be a camera original.
    expect(suggestedSaveName("scan.raw", true)).toBe("scan.mvision");
  });

  it("never overwrites a newly writable flat format in place", () => {
    // Offered as a Save As destination, but ⌘S on one must route to Save As —
    // Vision cannot re-open a .pdf/.exr as the document it flattened, and a
    // layered .tif shares PSD's layer serializer, which drops some features.
    for (const ext of ["tif", "tiff", "webp", "hdr", "exr", "tga", "pdf"]) {
      expect(canSaveInPlace(true, `/tmp/flat.${ext}`, true)).toBe(false);
      expect(saveAsIsCopy(ext, false)).toBe(true); // layered → export copy, stays dirty
      expect(saveAsIsCopy(ext, true)).toBe(false);
    }
    expect(suggestedSaveName("scan.tif", false)).toBe("scan.mvision");
    expect(suggestedSaveName("scan.tif", true)).toBe("scan.tif");
    expect(suggestedSaveName("page.pdf", true)).toBe("page.pdf");
  });

  it("keeps save-policy extension sets intentional", () => {
    expect([...IN_PLACE_EXTENSIONS].sort()).toEqual(["gif", "jpeg", "jpg", "mvis", "mvision", "png"]);
    expect([...FLAT_SAVE_EXTENSIONS].sort()).toEqual(
      ["exr", "gif", "hdr", "j2k", "jp2", "jpeg", "jpf", "jpg", "pdf", "png", "raw", "tga", "tif", "tiff", "webp"],
    );
    expect([...RAW_EXTENSIONS].sort()).toEqual([...RAW_SUFFIXES].sort());
    expect([...SUPPORTED_SAVE_EXTENSIONS].sort()).toEqual(
      ["exr", "gif", "hdr", "j2k", "jp2", "jpeg", "jpf", "jpg", "mvis", "mvision", "pdf", "png", "psb", "psd", "raw", "tga", "tif", "tiff", "webp"],
    );
  });
});

/** One plain 8-bit opaque pixel layer. Each #546 case changes exactly one fact. */
function flatFacts(patch: Partial<FlatDocumentFacts> = {}, layer: Partial<FlatLayerFacts> = {}): FlatDocumentFacts {
  const base: FlatLayerFacts = {
    kind: LAYER_KIND.pixel,
    visible: true,
    blend: 0,
    opacity: 1,
    fill: 1,
    hasMask: false,
    hasVectorMask: false,
    hasEffects: false,
    smartFilterCount: 0,
    hasTransparency: false,
  };
  return {
    layerCount: 1,
    layer: { ...base, ...layer },
    mode: 0,
    depth: 8,
    extraChannels: 0,
    frameCount: 0,
    ...patch,
  };
}

describe("a flat raster save fits only a plain pixel layer (#546)", () => {
  it("preserves grayscale at 8 or 16 bits only in Photoshop Raw", () => {
    for (const depth of [8, 16]) {
      const grayscale = flatFacts({ mode: 1, depth });
      expect(documentFitsFlatFormat(grayscale, "raw")).toBe(true);
      expect(saveAsIsCopy("raw", documentFitsFlatFormat(grayscale, "raw"))).toBe(false);
      for (const ext of ["png", "tif", "jp2"]) expect(documentFitsFlatFormat(grayscale, ext), ext).toBe(false);
    }
    expect(documentFitsFlatFormat(flatFacts({ mode: 1, depth: 32 }), "raw")).toBe(false);
    for (const mode of [2, 3, 4]) expect(documentFitsFlatFormat(flatFacts({ mode }), "raw")).toBe(false);
    expect(documentFitsFlatFormat(flatFacts({ mode: 1 }, { hasMask: true }), "raw")).toBe(false);
    expect(documentFitsFlatFormat(flatFacts({ mode: 1, extraChannels: 1 }), "raw")).toBe(false);
  });

  it("treats Photoshop Raw as an export copy when RGB or grayscale has transparency", () => {
    for (const mode of [0, 1]) for (const depth of [8, 16]) {
      const transparent = flatFacts({ mode, depth }, { hasTransparency: true });
      const fits = documentFitsFlatFormat(transparent, "raw");
      expect(fits, `mode ${mode}, depth ${depth}`).toBe(false);
      expect(saveAsIsCopy("raw", fits)).toBe(true);
    }
  });

  it("accepts an 8-bit opaque PNG, JPEG, or GIF", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif"]) {
      expect(documentFitsFlatFormat(flatFacts(), ext), ext).toBe(true);
    }
    expect(documentFitsFlatFormat(flatFacts({ depth: 16 }), "png")).toBe(true);
    expect(documentFitsFlatFormat(flatFacts({ mode: 1 }), "png")).toBe(false);
  });

  it("rejects each disqualifier that would be flattened away", () => {
    const cases: Array<[string, FlatDocumentFacts]> = [
      ["mask", flatFacts({}, { hasMask: true })],
      ["vector mask", flatFacts({}, { hasVectorMask: true })],
      ["effects", flatFacts({}, { hasEffects: true })],
      ["smart filters", flatFacts({}, { smartFilterCount: 1 })],
      ["opacity", flatFacts({}, { opacity: 0.5 })],
      ["fill", flatFacts({}, { fill: 0.5 })],
      ["text layer", flatFacts({}, { kind: LAYER_KIND.text })],
      ["hidden layer", flatFacts({}, { visible: false })],
      ["non-normal blend", flatFacts({}, { blend: 1 })],
      ["extra channels", flatFacts({ extraChannels: 1 })],
      ["grayscale", flatFacts({ mode: 1 })],
      ["cmyk", flatFacts({ mode: 2 })],
      ["lab", flatFacts({ mode: 3 })],
      ["no layer", flatFacts({ layerCount: 0, layer: null })],
      ["two layers", flatFacts({ layerCount: 2 })],
      ["animation", flatFacts({ frameCount: 2 })],
    ];
    for (const [name, facts] of cases) {
      expect(documentFitsFlatFormat(facts, "png"), name).toBe(false);
    }
  });

  it("refuses JPEG transparency and any depth the format cannot store", () => {
    expect(documentFitsFlatFormat(flatFacts({}, { hasTransparency: true }), "jpg")).toBe(false);
    expect(documentFitsFlatFormat(flatFacts({}, { hasTransparency: true }), "jpeg")).toBe(false);
    expect(documentFitsFlatFormat(flatFacts({}, { hasTransparency: true }), "png")).toBe(true);
    expect(documentFitsFlatFormat(flatFacts({ depth: 16 }), "jpg")).toBe(false);
    expect(documentFitsFlatFormat(flatFacts({ depth: 16 }), "gif")).toBe(false);
    expect(documentFitsFlatFormat(flatFacts({ depth: 32 }), "png")).toBe(false);
    expect(documentFitsFlatFormat(flatFacts({ depth: 32 }), "tif")).toBe(false);
    expect(documentFitsFlatFormat(flatFacts({ depth: 32 }), "hdr")).toBe(true);
    expect(documentFitsFlatFormat(flatFacts({ depth: 32 }), "exr")).toBe(true);
    expect(documentFitsFlatFormat(flatFacts(), "mvision")).toBe(false);
  });
});

// ── the universal container (design doc 11) ───────────────────
const bytes = (s: string) => new TextEncoder().encode(s);

/** A container as another app wrote it: our graphics entries plus its own. */
function foreignContainer(): MonetContainer {
  return {
    manifest: {
      format: "monet",
      schemaVersion: 1,
      app: { name: "monet-cinema", version: "9.9.9" },
      kind: "time",
      houseRules: { unknownToVision: true }, // a forward-compat field Vision must not drop
      entries: [
        { path: "graphics.json", role: "graphics" },
        { path: "pixels/0.png", role: "pixels", checksum: "abc" },
        { path: "timeline.json", role: "timeline" },
        { path: "media/clip.mov", role: "media" },
      ],
    },
    entries: [
      { path: "graphics.json", data: bytes("{\"old\":true}") },
      { path: "pixels/0.png", data: bytes("OLD-PIXELS") },
      { path: "timeline.json", data: bytes("{\"cuts\":3}") },
      { path: "media/clip.mov", data: bytes("MOOV") },
    ],
  };
}

/** What Vision's engine just wrote for the edited document. */
function freshContainer(): MonetContainer {
  return {
    manifest: {
      format: "monet",
      schemaVersion: 1,
      app: { name: "monet-render-engine", version: "0.1.0" },
      kind: "graphics",
      entries: [
        { path: "graphics.json", role: "graphics" },
        { path: "pixels/0.png", role: "pixels" },
        { path: "masks/0.png", role: "masks" },
      ],
    },
    entries: [
      { path: "graphics.json", data: bytes("{\"new\":true}") },
      { path: "pixels/0.png", data: bytes("NEW-PIXELS") },
      { path: "masks/0.png", data: bytes("NEW-MASK") },
    ],
  };
}

const decode = (c: MonetContainer, path: string) =>
  new TextDecoder().decode(c.entries.find((e) => e.path === path)!.data);

describe("universal container policy", () => {
  it("reports every entry Vision does not open", () => {
    expect(ignoredContainerEntries(foreignContainer().manifest)).toEqual(["timeline.json", "media/clip.mov"]);
    expect(ignoredContainerEntries(freshContainer().manifest)).toEqual([]);
  });

  it("couriers foreign entries and unknown manifest fields through a re-save", () => {
    const source = foreignContainer();
    const merged = courierContainerSave(source, freshContainer());

    // Rule 2: what Vision never read comes back byte-for-byte.
    expect(decode(merged, "timeline.json")).toBe("{\"cuts\":3}");
    expect(decode(merged, "media/clip.mov")).toBe("MOOV");
    expect(merged.manifest.houseRules).toEqual({ unknownToVision: true });
    expect(merged.manifest.entries).toContainEqual({ path: "media/clip.mov", role: "media" });
    // Rules 3/4: the payload class and wire version are never rewritten.
    expect(merged.manifest.kind).toBe("time");
    expect(merged.manifest.schemaVersion).toBe(1);
    // …and Vision's own entries are the fresh ones, exactly once each.
    expect(decode(merged, "graphics.json")).toBe("{\"new\":true}");
    expect(decode(merged, "pixels/0.png")).toBe("NEW-PIXELS");
    expect(merged.entries.map((e) => e.path).filter((p) => p === "pixels/0.png")).toHaveLength(1);
    expect(merged.manifest.entries.filter((e) => e.path === "pixels/0.png")).toHaveLength(1);
    expect(merged.manifest.app).toEqual(VISION_CONTAINER_APP);
    // A source entry under one of our roles that this save no longer produces
    // must not survive as a stale blob.
    expect(courierContainerSave(
      source,
      { ...freshContainer(), manifest: { ...freshContainer().manifest, entries: [{ path: "graphics.json", role: "graphics" }] }, entries: [{ path: "graphics.json", data: bytes("{}") }] },
    ).entries.map((e) => e.path)).toEqual(["timeline.json", "media/clip.mov", "graphics.json"]);
    // Non-destructive: the retained cargo is still intact for the next save.
    expect(decode(source, "graphics.json")).toBe("{\"old\":true}");
  });

  it("survives a real zip round trip through the shared container writer", async () => {
    await initMonetFormat();
    const merged = courierContainerSave(foreignContainer(), freshContainer());
    const reread = readContainer(writeContainer(merged));
    expect(decode(reread, "media/clip.mov")).toBe("MOOV"); // byte-for-byte, through the zip
    expect(decode(reread, "graphics.json")).toBe("{\"new\":true}");
    expect(reread.manifest.houseRules).toEqual({ unknownToVision: true });
    expect(reread.manifest.app).toEqual(VISION_CONTAINER_APP);
    expect(reread.manifest.entries.map((e) => e.path)).toEqual(merged.manifest.entries.map((e) => e.path));
  });

  it("stamps a Vision-authored container without inventing a source", () => {
    const merged = courierContainerSave(null, freshContainer());
    expect(merged.manifest.app).toEqual(VISION_CONTAINER_APP);
    expect(merged.manifest.kind).toBe("graphics");
    expect(merged.entries.map((e) => e.path)).toEqual(["graphics.json", "pixels/0.png", "masks/0.png"]);
  });
});
