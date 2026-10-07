// The cross-app contract for a shared `<stem>.xmp`: Galerie writes the ONE
// Camera Raw dialect (so Vision reads what Galerie wrote), and a Galerie write
// is a lossless COURIER for Vision's `mvcr:Payload` rather than erasing the
// other app's develop settings.
import {
  createDefaultRecipe,
  parseCameraRawXmp,
  serializeCameraRawXmp,
} from "@monet-ui/monet-photo";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** In-memory disk, so the read-before-write path runs for real. */
const files = new Map<string, string>();

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (p: string) => {
    const f = files.get(p);
    if (f == null) throw new Error(`no such file: ${p}`);
    return f;
  }),
  writeTextFile: vi.fn(async (p: string, c: string) => {
    files.set(p, c);
  }),
}));
vi.mock("../catalog/catalog", () => ({
  getRecipe: vi.fn(async () => null),
  listPhotoKeywords: vi.fn(async () => []),
}));

import { getRecipe } from "../catalog/catalog";
import type { PhotoRow } from "../catalog/types";
import { writeSidecarForPhoto } from "./xmpAutoWrite";
import { buildXmpSidecar, readXmpFields, type XmpMetaFields } from "./xmpSidecar";

const SOURCE = "/photos/IMG_1.cr3";
const SIDECAR = "/photos/IMG_1.xmp";

const photo = () =>
  ({
    id: 1,
    path: SOURCE,
    rating: 5,
    colorLabel: "Red",
    title: "Sunset",
    caption: null,
    creator: "Ansel",
    copyright: null,
    city: null,
    stateProvince: null,
    country: null,
    jobTitle: null,
    credit: null,
    source: null,
  }) as unknown as PhotoRow;

const META: XmpMetaFields = {
  rating: 4,
  label: "Blue",
  title: "Bay",
  caption: null,
  creator: null,
  copyright: null,
  keywords: ["travel"],
  hierarchical: ["travel"],
};

beforeEach(() => {
  files.clear();
  vi.clearAllMocks();
});

describe("Galerie ↔ Vision sidecar interop", () => {
  it("writes a develop block the shared (Vision) parser reads back", () => {
    const r = createDefaultRecipe();
    r.basic.exposure = 0.75;
    r.basic.contrast = -0.2;
    r.effects.grainAmount = 0.2;
    r.colorGrading.shadows.hue = 210;
    r.colorMixer.saturation[5] = -0.3; // Blue

    const doc = parseCameraRawXmp(buildXmpSidecar(META, JSON.stringify(r)));

    expect(doc.recipe?.basic?.exposure).toBeCloseTo(0.75, 6);
    expect(doc.recipe?.basic?.contrast).toBeCloseTo(-0.2, 6);
    expect(doc.recipe?.effects?.grainAmount).toBeCloseTo(0.2, 6);
    expect(doc.recipe?.colorGrading?.shadows?.hue).toBe(210);
    expect(doc.recipe?.colorMixer?.saturation?.[5]).toBeCloseTo(-0.3, 6);
    expect(doc.metadata.rating).toBe(4);
    expect(doc.metadata.keywords).toEqual(["travel"]);
  });

  it("preserves Vision's mvcr:Payload byte-for-byte when Galerie overwrites the sidecar", async () => {
    // What Vision left behind: its lossless payload, no crs: develop settings.
    const visionPayload = { source: SOURCE, recipe: { exposure: 1.25 }, snapshots: [{ id: "a" }] };
    const prior = serializeCameraRawXmp({ monet: visionPayload });
    files.set(SIDECAR, prior);
    const priorRaw = parseCameraRawXmp(prior).monetRaw;
    expect(priorRaw).toBeTruthy();

    vi.mocked(getRecipe).mockResolvedValueOnce(JSON.stringify(createDefaultRecipe()));
    await writeSidecarForPhoto(photo());

    const after = files.get(SIDECAR)!;
    expect(after).not.toBe(prior); // Galerie really did rewrite it…
    const reread = readXmpFields(after);
    expect(reread.monetRaw).toBe(priorRaw); // …carrying Vision's block verbatim
    expect(parseCameraRawXmp(after).monet).toEqual(visionPayload);
    // …and Galerie's own half landed.
    expect(reread.rating).toBe(5);
    expect(reread.label).toBe("Red");
    expect(reread.title).toBe("Sunset");
  });

  it("writes a payload-free sidecar when there is nothing to carry", async () => {
    await writeSidecarForPhoto(photo());
    const written = files.get(SIDECAR)!;
    expect(written).not.toContain("mvcr:Payload");
    expect(readXmpFields(written).monetRaw).toBeNull();
    expect(readXmpFields(written).rating).toBe(5);
  });
});
