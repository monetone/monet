import { describe, expect, it } from "vitest";
import { CAMERA_RAW_SOURCE_VERSION, defaultRecipe, recipeToParams, type CameraRawSource } from "./cameraRaw";
import { normalizeWorkingRecipe, workingRecipeToParams } from "./visionDevelopRecipe";
import {
  MAX_PROJECT_ENVELOPE_BYTES,
  MAX_PROJECT_DECODED_BINARY_BYTES,
  MAX_PROJECT_ENGINE_BYTES,
  MAX_PROJECT_SMART_EDIT_DEPTH,
  MAX_PROJECT_SMART_EDIT_SOURCES,
  assertProjectEnvelopeSize,
  decodeBase64WithinLimit,
  decodeProjectEnvelope,
  encodeProjectEnvelope,
  handoffDecodedProjectEnvelope,
  type PersistedSmartEditSource,
} from "./projectEnvelope";
import type { PersistedSmartLinkInfo } from "./smartLinks";

describe("Vision project envelope", () => {
  it("leaves raw engine project bytes to the engine loader", () => {
    expect(decodeProjectEnvelope(new Uint8Array([77, 86, 83, 78, 4, 0, 0, 0]))).toBeNull();
  });

  it("round-trips engine bytes and linked Smart Object metadata", () => {
    const link: PersistedSmartLinkInfo = {
      layerId: 12,
      name: "source.png",
      path: "Links/source.png",
      relativePath: "Links/source.png",
      missing: true,
      linkedAt: 1000,
      updatedAt: 2000,
    };
    const encoded = encodeProjectEnvelope(new Uint8Array([1, 2, 3, 255]), [link]);
    const decoded = decodeProjectEnvelope(encoded);

    expect(decoded?.engineBytes).toEqual(new Uint8Array([1, 2, 3, 255]));
    expect(decoded?.smartLinks).toEqual([link]);
    expect(decoded?.smartEditSources).toEqual([]);
    expect(decoded?.document).toEqual({ colorProfileAssigned: true });
  });

  it("writes envelope v2 and round-trips canonical RAW bytes, provenance, and editable curves", () => {
    const canonical = defaultRecipe();
    canonical.basic.exposure = 1.5;
    canonical.curve.pointsByChannel[0] = [
      { x: 0, y: 0 }, { x: 0.35, y: 0.5 }, { x: 1, y: 1 },
    ];
    canonical.curve.parametric = { highlights: 30, lights: 10, darks: -5, shadows: -25 };
    canonical.enhance = { denoise: true, denoiseAmount: 0.5, rawDetails: true, superResolution: false };
    const cameraRaw: CameraRawSource = {
      version: CAMERA_RAW_SOURCE_VERSION,
      originalName: "capture.arw",
      originalPath: "/photos/capture.arw",
      mimeType: "image/x-sony-arw",
      sha256: "d".repeat(64),
      lastModified: 123456,
      originalBytes: new Uint8Array([0, 1, 2, 253, 254, 255]),
      metadata: { make: "Sony", model: "ILCE-1", width: 8640, height: 5760, bitDepth: 14 },
      recipe: normalizeWorkingRecipe(canonical),
    };
    const encoded = encodeProjectEnvelope(new Uint8Array([7, 8, 9]), [], {
      colorProfileAssigned: true,
      cameraRaw,
      cameraRawLayerId: 73,
    });
    const json = JSON.parse(new TextDecoder().decode(encoded)) as {
      version: number;
      document: { cameraRaw: { originalBytes: string; originalPath?: string }; cameraRawLayerId: number };
    };
    const decoded = decodeProjectEnvelope(encoded);
    const portableCameraRaw = { ...cameraRaw };
    delete portableCameraRaw.originalPath;

    expect(json.version).toBe(2);
    expect(json.document.cameraRaw.originalBytes).toBe("AAEC/f7/");
    expect(json.document.cameraRaw.originalPath).toBeUndefined();
    expect(new TextDecoder().decode(encoded)).not.toContain("/photos/capture.arw");
    expect(json.document.cameraRawLayerId).toBe(73);
    expect(decoded?.document.cameraRaw).toEqual(portableCameraRaw);
    expect(decoded?.document.cameraRawLayerId).toBe(73);
    expect(decoded?.document.cameraRaw?.originalBytes).not.toBe(cameraRaw.originalBytes);
    expect(decoded?.document.cameraRaw?.recipe.toneCurve.point).toEqual(cameraRaw.recipe.toneCurve.point);
    expect(decoded?.document.cameraRaw?.recipe.toneCurve.parametric).toEqual(cameraRaw.recipe.toneCurve.parametric);
  });

  it("loads an OLD Canonical-shaped project cameraRaw to byte-identical engine params (invariant #2)", () => {
    // A pre-flip project stored the Canonical recipe shape verbatim in the envelope.
    const canonical = defaultRecipe();
    canonical.basic.exposure = 1.5;
    canonical.grade.shadows = { hue: 210, sat: 0.4 };
    const payload = {
      format: "monet-vision-project",
      version: 2,
      engine: btoa("engine"),
      document: {
        colorProfileAssigned: true,
        cameraRaw: {
          version: CAMERA_RAW_SOURCE_VERSION,
          originalName: "old.arw",
          originalBytes: btoa("raw"),
          metadata: {},
          recipe: canonical,
        },
      },
    };
    const decoded = decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify(payload)));
    expect(Array.from(workingRecipeToParams(decoded!.document.cameraRaw!.recipe)))
      .toEqual(Array.from(recipeToParams(canonical)));
  });

  it("continues to decode legacy v1 envelopes", () => {
    const payload = {
      format: "monet-vision-project",
      version: 1,
      engine: btoa("legacy-engine"),
      document: { colorProfileAssigned: false },
    };
    const decoded = decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify(payload)));
    expect(new TextDecoder().decode(decoded?.engineBytes)).toBe("legacy-engine");
    expect(decoded?.document).toEqual({ colorProfileAssigned: false });
  });

  it("drops malformed untrusted RAW provenance without rejecting an otherwise valid project", () => {
    const payload = {
      format: "monet-vision-project",
      version: 2,
      engine: btoa("engine"),
      document: {
        colorProfileAssigned: true,
        cameraRaw: {
          version: CAMERA_RAW_SOURCE_VERSION,
          originalName: "bad.nef",
          originalBytes: "%%%not-base64%%%",
          metadata: {},
          recipe: defaultRecipe(),
        },
      },
    };
    const decoded = decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify(payload)));
    expect(decoded?.engineBytes).toEqual(new TextEncoder().encode("engine"));
    expect(decoded?.document).toEqual({ colorProfileAssigned: true });

    // A newer schemaVersion is no longer a hard reject: the working loader is
    // lenient (accepts Canonical + V2), so once the RAW bytes are valid the
    // project and its provenance still load with a migrated recipe.
    const futurePayload = {
      ...payload,
      document: {
        ...payload.document,
        cameraRaw: {
          ...payload.document.cameraRaw,
          originalBytes: btoa("raw"),
          recipe: { ...defaultRecipe(), schemaVersion: 99 },
        },
      },
    };
    const future = decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify(futurePayload)));
    expect(future?.document.cameraRaw?.originalName).toBe("bad.nef");
  });

  it("drops an invalid RAW owner id without dropping otherwise valid provenance", () => {
    const cameraRaw: CameraRawSource = {
      version: CAMERA_RAW_SOURCE_VERSION,
      originalName: "capture.dng",
      originalBytes: new Uint8Array([1, 2, 3]),
      metadata: {},
      recipe: normalizeWorkingRecipe(defaultRecipe()),
    };
    const encoded = encodeProjectEnvelope(new Uint8Array([4, 5, 6]), [], {
      colorProfileAssigned: true,
      cameraRaw,
      cameraRawLayerId: -1,
    });

    expect(decodeProjectEnvelope(encoded)?.document).toEqual({ colorProfileAssigned: true, cameraRaw });
  });

  it("round-trips open Smart Object source documents", () => {
    const source = {
      parentLayerId: 42,
      name: "parent-smart-contents.png",
      engineBytes: new Uint8Array([77, 86, 83, 78, 1, 2, 3]),
      document: {
        colorProfileAssigned: false,
        iccProfileBytes: new Uint8Array([9, 8, 7, 6]),
        iccProfileName: "Acme Wide Gamut RGB",
        resolutionPpi: 300,
        pixelAspect: 1.33,
        pixelAspectCorrection: false,
        measureScale: { px: 25, units: 1, unit: "mm" },
        layerComps: [{ name: "Source option", layers: [{ id: 1, visible: true, opacity: 100, blendMode: "normal" }] }],
      },
      dirty: true,
    };
    const encoded = encodeProjectEnvelope(new Uint8Array([1, 2, 3]), [], { colorProfileAssigned: true }, [source]);
    const decoded = decodeProjectEnvelope(encoded);

    expect(decoded?.engineBytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(decoded?.smartEditSources).toEqual([source]);
  });

  it("round-trips nested Smart Object source documents", () => {
    const source = {
      parentLayerId: 42,
      name: "parent-smart-contents.png",
      engineBytes: new Uint8Array([77, 86, 83, 78, 1, 2, 3]),
      document: { colorProfileAssigned: true },
      dirty: false,
      smartEditSources: [{
        parentLayerId: 7,
        name: "nested-smart-contents.png",
        engineBytes: new Uint8Array([77, 86, 83, 78, 8, 9]),
        document: { colorProfileAssigned: false },
        dirty: true,
      }],
    };
    const encoded = encodeProjectEnvelope(new Uint8Array([1, 2, 3]), [], { colorProfileAssigned: true }, [source]);
    const decoded = decodeProjectEnvelope(encoded);

    expect(decoded?.smartEditSources).toEqual([source]);
  });

  it("round-trips untagged document profile metadata", () => {
    const encoded = encodeProjectEnvelope(new Uint8Array([9, 8, 7]), [], { colorProfileAssigned: false });
    const decoded = decodeProjectEnvelope(encoded);

    expect(decoded?.engineBytes).toEqual(new Uint8Array([9, 8, 7]));
    expect(decoded?.smartLinks).toEqual([]);
    expect(decoded?.document).toEqual({ colorProfileAssigned: false });
  });

  it("round-trips custom ICC document profile payloads", () => {
    const iccProfileBytes = new Uint8Array([0, 0, 0, 12, 65, 99, 109, 101, 73, 67, 67, 33]);
    const encoded = encodeProjectEnvelope(new Uint8Array([7, 8, 9]), [], { colorProfileAssigned: true, iccProfileBytes, iccProfileName: "Acme Wide Gamut RGB" });
    const decoded = decodeProjectEnvelope(encoded);

    expect(decoded?.engineBytes).toEqual(new Uint8Array([7, 8, 9]));
    expect(decoded?.document.colorProfileAssigned).toBe(true);
    expect(decoded?.document.iccProfileBytes).toEqual(iccProfileBytes);
    expect(decoded?.document.iccProfileName).toBe("Acme Wide Gamut RGB");
  });

  // The Duotone ink layer keeps only its LUT, so the inks live here (#459).
  it("round-trips a Duotone document's inks, including a Photoshop colour kept as stated", () => {
    const duotone = {
      inks: [
        { name: "Black", color: [0, 0, 0] as [number, number, number], curve: [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100],
          spec: { bytes: [0, 2, 255, 255, 255, 255, 255, 255, 0, 0], rgb: [0, 0, 0] as [number, number, number] } },
        { name: "PMS 7527", color: [176, 122, 45] as [number, number, number], curve: [0, 2, 5, 12, 20, 30, 40, 50, 60, 70, 80, 85, 90] },
      ],
      overprints: { "0+1": [10, 20, 30] as [number, number, number] },
    };
    const encoded = encodeProjectEnvelope(new Uint8Array([1]), [], { colorProfileAssigned: true, duotone });
    expect(decodeProjectEnvelope(encoded)?.document.duotone).toEqual(duotone);
    // A project from before the inks were recorded still opens, with none.
    const legacy = encodeProjectEnvelope(new Uint8Array([1]), [], { colorProfileAssigned: true });
    expect(decodeProjectEnvelope(legacy)?.document.duotone).toBeUndefined();
  });

  it("round-trips document note annotations", () => {
    const notes = [
      { id: 1, x: 12, y: 24, text: "check highlight", author: "Dal" },
      { id: 3, x: 80, y: 40, text: "", author: "Reviewer" },
    ];
    const encoded = encodeProjectEnvelope(new Uint8Array([7, 7, 7]), [], { colorProfileAssigned: true, notes });
    const decoded = decodeProjectEnvelope(encoded);

    expect(decoded?.engineBytes).toEqual(new Uint8Array([7, 7, 7]));
    expect(decoded?.smartLinks).toEqual([]);
    expect(decoded?.document).toEqual({ colorProfileAssigned: true, notes });
  });

  it("round-trips document guides with per-guide colors", () => {
    const guides = [
      { o: "h" as const, p: 24, color: "#ff0000" },
      { o: "v" as const, p: 80, color: "#0000ff" },
    ];
    const encoded = encodeProjectEnvelope(new Uint8Array([4, 5, 6]), [], { colorProfileAssigned: true, guides });

    expect(decodeProjectEnvelope(encoded)?.document).toEqual({ colorProfileAssigned: true, guides });
  });

  it("round-trips a custom document measurement scale", () => {
    const measureScale = { px: 50, units: 1, unit: "microns" };
    const encoded = encodeProjectEnvelope(new Uint8Array([4, 5, 6]), [], { colorProfileAssigned: true, measureScale });

    expect(decodeProjectEnvelope(encoded)?.document).toEqual({ colorProfileAssigned: true, measureScale });
  });

  it("round-trips document Layer Comps with complete appearance state", () => {
    const layerComps = [{
      name: "Client A",
      layers: [{
        id: 8,
        visible: false,
        opacity: 55,
        blendMode: "multiply",
        offset: [3, -2] as [number, number],
        style: { effects: [{ fx: 0, params: [1, 0, 1] }], blendIf: [], fillOpacity: 40 },
      }],
    }];
    const encoded = encodeProjectEnvelope(new Uint8Array([6, 7, 8]), [], { colorProfileAssigned: true, layerComps });
    const decoded = decodeProjectEnvelope(encoded);

    expect(decoded?.engineBytes).toEqual(new Uint8Array([6, 7, 8]));
    expect(decoded?.document).toEqual({ colorProfileAssigned: true, layerComps });
  });

  it("round-trips physical resolution and non-square pixel aspect metadata", () => {
    const encoded = encodeProjectEnvelope(new Uint8Array([5, 6, 7]), [], {
      colorProfileAssigned: true,
      resolutionPpi: 300,
      pixelAspect: 1.25,
      pixelAspectCorrection: false,
    });
    expect(decodeProjectEnvelope(encoded)?.document).toEqual({
      colorProfileAssigned: true,
      resolutionPpi: 300,
      pixelAspect: 1.25,
      pixelAspectCorrection: false,
    });
  });

  it("filters malformed Smart Object links instead of restoring stale metadata", () => {
    const payload = {
      format: "monet-vision-project",
      version: 1,
      engine: btoa("engine"),
      smartLinks: [
        { layerId: 1, name: "ok.png", missing: false, linkedAt: 1, updatedAt: 2 },
        { layerId: 2, name: "bad.png", missing: "no", linkedAt: 1, updatedAt: 2 },
      ],
      smartEditSources: [
        { parentLayerId: 7, name: "ok-source.mvision", engine: btoa("source"), dirty: true },
        { parentLayerId: 8, name: "bad-source.mvision", engine: 4, dirty: true },
      ],
    };
    const decoded = decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify(payload)));

    expect(decoded?.smartLinks).toEqual([{ layerId: 1, name: "ok.png", missing: false, linkedAt: 1, updatedAt: 2 }]);
    expect(decoded?.smartEditSources).toEqual([{
      parentLayerId: 7,
      name: "ok-source.mvision",
      engineBytes: new TextEncoder().encode("source"),
      document: { colorProfileAssigned: true },
      dirty: true,
    }]);
    expect(decoded?.document).toEqual({ colorProfileAssigned: true });
  });

  it("filters malformed document notes instead of restoring stale annotations", () => {
    const payload = {
      format: "monet-vision-project",
      version: 1,
      engine: btoa("engine"),
      document: {
        colorProfileAssigned: true,
        notes: [
          { id: 4, x: 5.4, y: 6.6, text: "ok", author: "Dal" },
          { id: 4, x: 99, y: 99, text: "duplicate", author: "ignored" },
          { id: 5, x: "bad", y: 2, text: "bad", author: "bad" },
          { id: 6, x: 1, y: Number.POSITIVE_INFINITY, text: "bad", author: "bad" },
        ],
      },
    };
    const decoded = decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify(payload)));

    expect(decoded?.document).toEqual({
      colorProfileAssigned: true,
      notes: [{ id: 4, x: 5, y: 7, text: "ok", author: "Dal" }],
    });
  });

  it("normalizes malformed document guides", () => {
    const payload = {
      format: "monet-vision-project",
      version: 1,
      engine: btoa("engine"),
      document: {
        guides: [
          { o: "v", p: 12.6, color: "#AABBCC" },
          { o: "h", p: -4, color: "invalid" },
          { o: "v", p: 20, color: "#abc" },
          { o: "diagonal", p: 5, color: "#123456" },
          { o: "h", p: "bad", color: "#123456" },
        ],
      },
    };
    const decoded = decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify(payload)));

    expect(decoded?.document).toEqual({
      colorProfileAssigned: true,
      guides: [
        { o: "v", p: 13, color: "#aabbcc" },
        { o: "h", p: 0, color: "#33aaff" },
        { o: "v", p: 20, color: "#33aaff" },
      ],
    });
  });

  it("drops a malformed default-equivalent measurement scale", () => {
    const payload = {
      format: "monet-vision-project",
      version: 1,
      engine: btoa("engine"),
      document: { measureScale: { px: 0, units: "bad", unit: "   " } },
    };

    expect(decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify(payload)))?.document)
      .toEqual({ colorProfileAssigned: true });
  });

  it("filters malformed document Layer Comp state", () => {
    const payload = {
      format: "monet-vision-project",
      version: 1,
      engine: btoa("engine"),
      document: {
        layerComps: [
          { name: "kept", layers: [
            { id: 4, visible: true, opacity: 80, blendMode: "normal", offset: [1, 2] },
            { id: 4, visible: false, opacity: 20, blendMode: "screen" },
            { id: 5, visible: "bad", opacity: 50, blendMode: "normal" },
          ] },
          { name: 99, layers: [] },
        ],
      },
    };
    const decoded = decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify(payload)));

    expect(decoded?.document).toEqual({
      colorProfileAssigned: true,
      layerComps: [{ name: "kept", layers: [{ id: 4, visible: true, opacity: 80, blendMode: "normal", offset: [1, 2] }] }],
    });
  });

  it("preflights envelope and decoded base64 sizes before allocating", () => {
    expect(MAX_PROJECT_ENGINE_BYTES).toBe(MAX_PROJECT_DECODED_BINARY_BYTES);
    expect(4 * Math.ceil(MAX_PROJECT_ENGINE_BYTES / 3)).toBe(MAX_PROJECT_ENVELOPE_BYTES);
    expect(() => assertProjectEnvelopeSize(MAX_PROJECT_ENVELOPE_BYTES)).not.toThrow();
    expect(() => assertProjectEnvelopeSize(MAX_PROJECT_ENVELOPE_BYTES + 1)).toThrow("512 MiB size limit");

    expect(decodeBase64WithinLimit("AQID", 3)).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => decodeBase64WithinLimit("AQID", 2, "Engine")).toThrow("Engine exceeds the decoded size limit");
    expect(decodeBase64WithinLimit("AA=A", 3)).toBeNull();
    expect(decodeBase64WithinLimit("====", 3)).toBeNull();
  });

  it("rejects Smart Object source trees beyond the depth and node budgets", () => {
    const source = (id: number, nested?: unknown) => ({
      parentLayerId: id,
      name: `source-${id}.mvision`,
      engine: btoa("source"),
      ...(nested ? { smartEditSources: [nested] } : {}),
    });
    let tooDeep: unknown = source(MAX_PROJECT_SMART_EDIT_DEPTH + 1);
    for (let depth = MAX_PROJECT_SMART_EDIT_DEPTH; depth >= 1; depth--) tooDeep = source(depth, tooDeep);
    const base = {
      format: "monet-vision-project",
      version: 2,
      engine: btoa("engine"),
    };

    expect(() => decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify({
      ...base,
      smartEditSources: [tooDeep],
    })))).toThrow("Smart Object nesting limit");
    expect(() => decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify({
      ...base,
      smartEditSources: Array.from({ length: MAX_PROJECT_SMART_EDIT_SOURCES + 1 }, (_, index) => source(index + 1)),
    })))).toThrow("Smart Object source limit");
  });

  it("enforces the decode budgets while encoding so Save cannot create an unreadable envelope", () => {
    expect(() => encodeProjectEnvelope(new Uint8Array(), [])).toThrow("project engine exceeds");
    const source = (id: number, nested?: PersistedSmartEditSource): PersistedSmartEditSource => ({
      parentLayerId: id,
      name: `source-${id}.mvision`,
      engineBytes: new Uint8Array([id & 0xff]),
      document: { colorProfileAssigned: true },
      dirty: false,
      ...(nested ? { smartEditSources: [nested] } : {}),
    });
    let tooDeep = source(MAX_PROJECT_SMART_EDIT_DEPTH + 1);
    for (let depth = MAX_PROJECT_SMART_EDIT_DEPTH; depth >= 1; depth--) tooDeep = source(depth, tooDeep);

    expect(() => encodeProjectEnvelope(new Uint8Array([1]), [], undefined, [tooDeep]))
      .toThrow("Smart Object nesting limit");
    expect(() => encodeProjectEnvelope(
      new Uint8Array([1]),
      [],
      undefined,
      Array.from({ length: MAX_PROJECT_SMART_EDIT_SOURCES + 1 }, (_, index) => source(index + 1)),
    )).toThrow("Smart Object source limit");
  });

  it("hands a native decode to Store exactly once", () => {
    const encoded = encodeProjectEnvelope(new Uint8Array([4, 5, 6]), []);
    const first = decodeProjectEnvelope(encoded);
    expect(first).not.toBeNull();
    handoffDecodedProjectEnvelope(encoded, first!);

    expect(decodeProjectEnvelope(encoded)).toBe(first);
    expect(decodeProjectEnvelope(encoded)).not.toBe(first);
  });

  it("throws clear errors for malformed and unsupported wrappers", () => {
    expect(() => decodeProjectEnvelope(new TextEncoder().encode("{ nope"))).toThrow("Malformed Monet Vision project envelope");
    expect(() => decodeProjectEnvelope(new TextEncoder().encode(JSON.stringify({
      format: "monet-vision-project",
      version: 99,
      engine: "",
    })))).toThrow("Unsupported Monet Vision project envelope");
  });
});
