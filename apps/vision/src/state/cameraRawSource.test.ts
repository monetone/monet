// Persisted Camera Raw provenance: this is the bounding/migration layer every
// project, sidecar and envelope load crosses. normalizeCameraRawSnapshots (the
// snapshot cap, the name cleaning, the null-recipe skip) had no direct test at
// all, and the source-level clone/adopt decision was only touched incidentally.
import { describe, expect, it } from "vitest";
import { CAMERA_RAW_SOURCE_VERSION, MAX_CAMERA_RAW_SNAPSHOTS, type CameraRawSource } from "./cameraRaw";
import { cloneCameraRawSource, normalizeCameraRawSnapshots, normalizeCameraRawSource } from "./cameraRawSource";

const SHA = "a".repeat(64);

const source = (overrides: Record<string, unknown> = {}) => ({
  version: CAMERA_RAW_SOURCE_VERSION,
  originalName: "IMG_0001.dng",
  originalBytes: new Uint8Array([1, 2, 3, 4]),
  recipe: { basic: { exposure: 0.5 } },
  ...overrides,
});

describe("normalizeCameraRawSnapshots", () => {
  it("returns an empty list for anything that is not an array", () => {
    for (const value of [undefined, null, {}, "snapshots", 7]) {
      expect(normalizeCameraRawSnapshots(value)).toEqual([]);
    }
  });

  it("keeps named snapshots and normalizes each recipe into the working V2 shape", () => {
    const out = normalizeCameraRawSnapshots([{ name: "Punchy", recipe: { basic: { exposure: 0.5 } } }]);

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Punchy");
    expect(out[0].recipe.basic.exposure).toBe(0.5);
    // A recipe is never stored raw — normalization deep-fills the other panels.
    expect(out[0].recipe.toneCurve).toBeDefined();
  });

  it("replaces a junk recipe with defaults instead of throwing or storing it", () => {
    const out = normalizeCameraRawSnapshots([{ name: "Junk", recipe: "not-a-recipe" }]);

    expect(out).toHaveLength(1);
    expect(typeof out[0].recipe).toBe("object");
    expect(out[0].recipe.basic.exposure).toBe(0);
  });

  it("skips entries that are not records, have no recipe, or have an unusable name", () => {
    const out = normalizeCameraRawSnapshots([
      null,
      "Punchy",
      42,
      { name: "No recipe", recipe: null },
      { name: "No recipe either" },
      { name: "", recipe: {} },
      { name: "   ", recipe: {} }, // whitespace-only cleans down to nothing
      { name: "\u0001\u0002", recipe: {} }, // control characters are stripped away entirely
      { name: 7, recipe: {} },
      { name: "  Kept  ", recipe: {} },
    ]);

    expect(out.map((s) => s.name)).toEqual(["Kept"]); // and the survivor is trimmed
  });

  it("caps the list at MAX_CAMERA_RAW_SNAPSHOTS, keeping the first ones", () => {
    const many = Array.from({ length: MAX_CAMERA_RAW_SNAPSHOTS + 12 }, (_, i) => ({ name: `S${i}`, recipe: {} }));

    const out = normalizeCameraRawSnapshots(many);

    expect(out).toHaveLength(MAX_CAMERA_RAW_SNAPSHOTS);
    expect(out[0].name).toBe("S0");
    expect(out.at(-1)?.name).toBe(`S${MAX_CAMERA_RAW_SNAPSHOTS - 1}`);
  });

  it("does not let skipped entries consume cap slots", () => {
    const out = normalizeCameraRawSnapshots([
      ...Array.from({ length: 20 }, () => null),
      ...Array.from({ length: MAX_CAMERA_RAW_SNAPSHOTS }, (_, i) => ({ name: `S${i}`, recipe: {} })),
    ]);

    expect(out).toHaveLength(MAX_CAMERA_RAW_SNAPSHOTS);
  });
});

describe("normalizeCameraRawSource", () => {
  it("accepts a well-formed source and normalizes its recipe", () => {
    const normalized = normalizeCameraRawSource(source());

    expect(normalized?.version).toBe(CAMERA_RAW_SOURCE_VERSION);
    expect(normalized?.originalName).toBe("IMG_0001.dng");
    expect(normalized?.originalBytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(normalized?.recipe.basic.exposure).toBe(0.5);
    expect(normalized?.metadata).toBeDefined();
  });

  it("rejects a foreign version, a missing name and empty or non-Uint8Array bytes", () => {
    expect(normalizeCameraRawSource(null)).toBeNull();
    expect(normalizeCameraRawSource("nope")).toBeNull();
    expect(normalizeCameraRawSource(source({ version: CAMERA_RAW_SOURCE_VERSION + 1 }))).toBeNull();
    expect(normalizeCameraRawSource(source({ version: String(CAMERA_RAW_SOURCE_VERSION) }))).toBeNull();
    expect(normalizeCameraRawSource(source({ originalName: "" }))).toBeNull();
    expect(normalizeCameraRawSource(source({ originalName: 42 }))).toBeNull();
    expect(normalizeCameraRawSource(source({ originalBytes: new Uint8Array() }))).toBeNull();
    expect(normalizeCameraRawSource(source({ originalBytes: [1, 2, 3] }))).toBeNull();
  });

  it("defensively copies the bytes unless the caller transfers ownership", () => {
    const bytes = new Uint8Array([9, 9, 9]);

    const copied = normalizeCameraRawSource(source({ originalBytes: bytes }));
    expect(copied?.originalBytes).not.toBe(bytes);
    bytes[0] = 1;
    expect(copied?.originalBytes?.[0]).toBe(9); // the copy is unaffected

    const adopted = normalizeCameraRawSource(source({ originalBytes: bytes }), { copyBytes: false });
    expect(adopted?.originalBytes).toBe(bytes);
  });

  it("keeps a valid sha256 lower-cased and drops a malformed one", () => {
    expect(normalizeCameraRawSource(source({ sha256: SHA.toUpperCase() }))?.sha256).toBe(SHA);
    expect(normalizeCameraRawSource(source({ sha256: "z".repeat(64) }))).not.toHaveProperty("sha256");
    expect(normalizeCameraRawSource(source({ sha256: "abc" }))).not.toHaveProperty("sha256");
    expect(normalizeCameraRawSource(source())).not.toHaveProperty("sha256");
  });

  it("keeps optional provenance only when it carries information", () => {
    const full = normalizeCameraRawSource(source({
      originalPath: "/photos/IMG_0001.dng",
      mimeType: "image/x-adobe-dng",
      lastModified: 1_700_000_000_000,
    }));
    expect(full).toMatchObject({
      originalPath: "/photos/IMG_0001.dng",
      mimeType: "image/x-adobe-dng",
      lastModified: 1_700_000_000_000,
    });

    const bare = normalizeCameraRawSource(source({ originalPath: "", mimeType: 5, lastModified: -12 }));
    expect(bare).not.toHaveProperty("originalPath");
    expect(bare).not.toHaveProperty("mimeType");
    expect(bare).not.toHaveProperty("lastModified");
  });

  it("omits the snapshots key entirely when nothing survives normalization", () => {
    expect(normalizeCameraRawSource(source({ snapshots: [{ name: "", recipe: {} }] }))).not.toHaveProperty("snapshots");
    expect(normalizeCameraRawSource(source({ snapshots: "junk" }))).not.toHaveProperty("snapshots");
    expect(normalizeCameraRawSource(source({ snapshots: [{ name: "Keep", recipe: {} }] }))?.snapshots)
      .toHaveLength(1);
  });
});

describe("cloneCameraRawSource", () => {
  it("returns an independent deep copy of a valid source", () => {
    const original = normalizeCameraRawSource(source({ snapshots: [{ name: "Punchy", recipe: {} }] }))!;

    const clone = cloneCameraRawSource(original);

    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(clone.originalBytes).not.toBe(original.originalBytes);
    expect(clone.recipe).not.toBe(original.recipe);
    expect(clone.snapshots).not.toBe(original.snapshots);
  });

  it("throws rather than returning an unusable source", () => {
    expect(() => cloneCameraRawSource({ ...source(), version: 99 } as unknown as CameraRawSource))
      .toThrow("Invalid Camera Raw source");
  });
});
