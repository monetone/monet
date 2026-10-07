// GAL-META-01: Read Metadata from File is a full replace, not a merge — the
// location/attribution cluster round-trips, and a field the sidecar omits
// CLEARS the catalog value (LR parity) instead of keeping the stale one.

import { describe, expect, it } from "vitest";

import { buildXmpSidecar, readXmpFields, sidecarMetadataPatch, type XmpMetaFields } from "./xmpSidecar";

const FULL: XmpMetaFields = {
  city: "Ljubljana",
  stateProvince: "Osrednjeslovenska",
  country: "Slovenia",
  jobTitle: "Photographer",
  credit: "Monet Wire",
  source: "Assignment 2026",
  rating: 3,
  label: "Red",
  title: "Sunset",
  caption: "Bay",
  creator: "Ansel",
  copyright: "© 2026",
  keywords: ["travel", "italy"],
  hierarchical: [],
};

describe("sidecarMetadataPatch — LR Read Metadata replace semantics", () => {
  it("round-trips the full IPTC set including the location/attribution cluster", () => {
    const fields = readXmpFields(buildXmpSidecar(FULL, null));
    expect(sidecarMetadataPatch(fields)).toEqual({
      title: "Sunset",
      caption: "Bay",
      creator: "Ansel",
      copyright: "© 2026",
      city: "Ljubljana",
      stateProvince: "Osrednjeslovenska",
      country: "Slovenia",
      jobTitle: "Photographer",
      credit: "Monet Wire",
      source: "Assignment 2026",
    });
  });

  it("clears every field the sidecar omits (cleared-in-catalog values stay cleared after Save→Read)", () => {
    const cleared: XmpMetaFields = {
      ...FULL,
      city: null,
      stateProvince: null,
      country: null,
      jobTitle: null,
      credit: null,
      source: null,
      title: null,
      caption: null,
      creator: null,
      copyright: null,
    };
    const patch = sidecarMetadataPatch(readXmpFields(buildXmpSidecar(cleared, null)));
    for (const v of Object.values(patch)) expect(v).toBeNull();
  });

  it("hands back the keyword list exactly as written, so removals on disk apply", () => {
    const fields = readXmpFields(buildXmpSidecar({ ...FULL, keywords: ["travel"] }, null));
    expect(fields.keywords).toEqual(["travel"]);
  });
});
