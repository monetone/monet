import { createDefaultRecipe } from "@monet-ui/monet-photo";
import { describe, expect, it } from "vitest";

import { parseXmpPreset } from "./xmpPreset";
import {
  buildXmpSidecar,
  readXmpFields,
  sidecarPath,
  type XmpMetaFields,
} from "./xmpSidecar";

const META: XmpMetaFields = {
  city: "Ljubljana",
  stateProvince: "Osrednjeslovenska",
  country: "Slovenia",
  jobTitle: "Photographer",
  credit: "Monet Wire",
  source: "Assignment 2026",
  rating: 4,
  label: "Red",
  title: "Sunset",
  caption: "Bay & <coast>",
  creator: "Ansel",
  copyright: "© 2026",
  keywords: ["travel", "italy"],
  hierarchical: ["Places|Italy"],
};

describe("buildXmpSidecar — develop round-trips through parseXmpPreset", () => {
  it("recovers the ABI-backed develop fields", () => {
    const r = createDefaultRecipe();
    r.basic.exposure = 0.5;
    r.basic.contrast = 0.2;
    r.basic.highlights = -0.3;
    r.basic.temp = 0.15;
    r.detail.sharpenAmount = 0.4;
    r.detail.nrLuminance = 0.25;
    r.effects.grainAmount = 0.25;
    r.effects.vignetteAmount = -0.4;
    r.colorMixer.hue[2] = 0.5; // Yellow
    r.colorMixer.saturation[5] = -0.3; // Blue
    r.colorGrading.shadows.hue = 210;
    r.colorGrading.shadows.sat = 0.3;
    r.toneCurve.point = [{ x: 0, y: 0.2 }, { x: 1, y: 0.8 }];

    const { recipe } = parseXmpPreset(buildXmpSidecar(META, JSON.stringify(r)));

    expect(recipe.basic?.exposure).toBeCloseTo(0.5, 6);
    expect(recipe.basic?.contrast).toBeCloseTo(0.2, 6);
    expect(recipe.basic?.highlights).toBeCloseTo(-0.3, 6);
    expect(recipe.basic?.temp).toBeCloseTo(0.15, 6);
    expect(recipe.detail?.sharpenAmount).toBeCloseTo(0.4, 6);
    expect(recipe.detail?.nrLuminance).toBeCloseTo(0.25, 6);
    expect(recipe.effects?.grainAmount).toBeCloseTo(0.25, 6);
    expect(recipe.effects?.vignetteAmount).toBeCloseTo(-0.4, 6);
    expect(recipe.colorMixer?.hue?.[2]).toBeCloseTo(0.5, 6);
    expect(recipe.colorMixer?.saturation?.[5]).toBeCloseTo(-0.3, 6);
    expect(recipe.colorGrading?.shadows?.hue).toBe(210);
    expect(recipe.colorGrading?.shadows?.sat).toBeCloseTo(0.3, 6);
    expect(recipe.toneCurve?.point).toEqual([{ x: 0, y: 0.2 }, { x: 1, y: 0.8 }]);
  });

  it("omits the crs develop block when there is no recipe", () => {
    const xml = buildXmpSidecar(META, null);
    expect(xml).not.toContain("crs:Exposure2012");
    expect(xml).toContain('crs:HasSettings="True"');
  });
});

describe("buildXmpSidecar — IPTC / keywords", () => {
  const xml = buildXmpSidecar(META, null);

  it("writes rating + label as xmp attributes", () => {
    expect(xml).toContain('xmp:Rating="4"');
    expect(xml).toContain('xmp:Label="Red"');
  });

  it("writes creator / copyright / title / caption", () => {
    expect(xml).toContain("<dc:creator>");
    expect(xml).toContain("Ansel</rdf:li>");
    expect(xml).toContain("<dc:rights>");
    expect(xml).toContain("<dc:title>");
    expect(xml).toContain("<dc:description>");
  });

  it("writes flat + hierarchical keywords", () => {
    expect(xml).toContain("<dc:subject>");
    expect(xml).toContain("<rdf:li>travel</rdf:li>");
    expect(xml).toContain("<rdf:li>Places|Italy</rdf:li>");
  });

  it("XML-escapes special characters", () => {
    expect(xml).toContain("Bay &amp; &lt;coast&gt;");
  });

  it("declares every namespace prefix it emits — undeclared prefixes are not well-formed XML", () => {
    const declared = new Set([...xml.matchAll(/xmlns:([A-Za-z0-9_-]+)=/g)].map((m) => m[1]));
    const used = new Set([...xml.matchAll(/<\/?([A-Za-z0-9_-]+):|\s([A-Za-z0-9_-]+):[A-Za-z]+="/g)]
      .map((m) => m[1] ?? m[2]));
    used.delete("xmlns");
    used.delete("xml"); // reserved prefix (xml:lang) — implicitly bound, never declared
    expect([...used].filter((prefix) => !declared.has(prefix))).toEqual([]);
  });

  it("omits rating 0 and null/empty fields", () => {
    const bare = buildXmpSidecar(
      { rating: 0, label: null, title: null, caption: null, creator: null, copyright: null, keywords: [], hierarchical: [] },
      null,
    );
    expect(bare).not.toContain("xmp:Rating");
    expect(bare).not.toContain("dc:subject");
    expect(bare).not.toContain("dc:creator");
  });
});

describe("readXmpFields — write → read round-trip", () => {
  it("recovers IPTC + keywords written by buildXmpSidecar", () => {
    const f = readXmpFields(buildXmpSidecar(META, null));
    expect(f.rating).toBe(4);
    expect(f.label).toBe("Red");
    expect(f.title).toBe("Sunset");
    expect(f.caption).toBe("Bay & <coast>"); // unescaped back to the original
    expect(f.creator).toBe("Ansel");
    expect(f.copyright).toBe("© 2026");
    expect(f.city).toBe("Ljubljana");
    expect(f.stateProvince).toBe("Osrednjeslovenska");
    expect(f.country).toBe("Slovenia");
    expect(f.jobTitle).toBe("Photographer");
    expect(f.credit).toBe("Monet Wire");
    expect(f.source).toBe("Assignment 2026");
    expect(f.keywords).toEqual(["travel", "italy"]);
    expect(f.hierarchical).toEqual(["Places|Italy"]);
    expect(f.recipe).toBeNull(); // HasSettings-only → no develop patch
  });

  it("recovers the develop patch when a recipe was written", () => {
    const r = createDefaultRecipe();
    r.basic.exposure = 0.5;
    const f = readXmpFields(buildXmpSidecar(META, JSON.stringify(r)));
    expect(f.recipe?.basic?.exposure).toBeCloseTo(0.5, 6);
  });

  it("is defensive on empty / non-XMP input", () => {
    const f = readXmpFields("not xmp at all");
    expect(f.rating).toBeNull();
    expect(f.title).toBeNull();
    expect(f.keywords).toEqual([]);
    expect(f.recipe).toBeNull();
  });
});

describe("buildXmpSidecar / readXmpFields — snapshot round-trip", () => {
  it("round-trips named snapshots through crs:Snapshots", () => {
    const r = createDefaultRecipe();
    r.basic.exposure = 0.3;
    const xml = buildXmpSidecar(META, null, null, [{ name: "Before edits", recipe: r }]);
    expect(xml).toContain("<crs:Snapshots>");

    const fields = readXmpFields(xml);
    expect(fields.snapshots).toHaveLength(1);
    expect(fields.snapshots[0].name).toBe("Before edits");
    expect(fields.snapshots[0].recipe?.basic?.exposure).toBeCloseTo(0.3, 6);
  });

  it("omits crs:Snapshots and reads back [] when none are given", () => {
    const xml = buildXmpSidecar(META, null);
    expect(xml).not.toContain("crs:Snapshots");
    expect(readXmpFields(xml).snapshots).toEqual([]);
  });
});

describe("sidecarPath", () => {
  it("replaces the extension with .xmp", () => {
    expect(sidecarPath("/photos/IMG_1.CR3")).toBe("/photos/IMG_1.xmp");
    expect(sidecarPath("/a/b.c/IMG.dng")).toBe("/a/b.c/IMG.xmp");
  });
  it("appends .xmp when there is no extension", () => {
    expect(sidecarPath("/photos/noext")).toBe("/photos/noext.xmp");
  });
});

it("writes the IPTC location + attribution cluster as photoshop:* elements", () => {
  const xml = buildXmpSidecar(
    {
      rating: 0,
      label: null,
      title: null,
      caption: null,
      creator: null,
      copyright: null,
      city: "Ljubljana",
      stateProvince: "Osrednjeslovenska",
      country: "Slovenia",
      jobTitle: "Photographer",
      credit: "Monet Wire",
      source: "Assignment <2026>",
      keywords: [],
      hierarchical: [],
    },
    null,
  );
  expect(xml).toContain("<photoshop:City>Ljubljana</photoshop:City>");
  expect(xml).toContain("<photoshop:State>Osrednjeslovenska</photoshop:State>");
  expect(xml).toContain("<photoshop:Country>Slovenia</photoshop:Country>");
  expect(xml).toContain("<photoshop:AuthorsPosition>Photographer</photoshop:AuthorsPosition>");
  expect(xml).toContain("<photoshop:Credit>Monet Wire</photoshop:Credit>");
  expect(xml).toContain("<photoshop:Source>Assignment &lt;2026&gt;</photoshop:Source>"); // escaped
});
