import { describe, expect, it } from "vitest";

import { filterExportMetadata } from "./exportMetadata";
import type { XmpMetaFields } from "./xmpSidecar";

const META: XmpMetaFields = {
  rating: 4,
  label: "Red",
  title: "Harbour",
  caption: "Dawn over the harbour",
  creator: "A. Photographer",
  copyright: "© 2026 A. Photographer",
  city: "Reykjavík",
  stateProvince: "Capital Region",
  country: "Iceland",
  jobTitle: "Staff Photographer",
  credit: "Wire Service",
  source: "Original",
  keywords: ["harbour", "dawn"],
  hierarchical: [],
};

describe("filterExportMetadata", () => {
  it("writes nothing when Include is None", () => {
    expect(filterExportMetadata(META, { include: "none", removeLocation: false })).toBeNull();
  });

  it("Copyright Only keeps the notice and drops everything else", () => {
    const out = filterExportMetadata(META, { include: "copyright", removeLocation: false })!;
    expect(out.copyright).toBe(META.copyright);
    expect(out.creator).toBeNull();
    expect(out.caption).toBeNull();
    expect(out.city).toBeNull();
    expect(out.keywords).toEqual([]);
    expect(out.rating).toBe(0);
  });

  it("Copyright & Contact keeps the who-made-this fields, not the descriptive ones", () => {
    const out = filterExportMetadata(META, { include: "copyrightContact", removeLocation: false })!;
    expect([out.copyright, out.creator, out.credit, out.source, out.jobTitle]).toEqual([
      META.copyright, META.creator, META.credit, META.source, META.jobTitle,
    ]);
    expect([out.title, out.caption, out.label]).toEqual([null, null, null]);
    expect(out.keywords).toEqual([]);
  });

  it("All passes every field through", () => {
    expect(filterExportMetadata(META, { include: "all", removeLocation: false })).toEqual(META);
  });

  it("Remove Location Info drops the place fields at any include level", () => {
    const out = filterExportMetadata(META, { include: "all", removeLocation: true })!;
    expect([out.city, out.stateProvince, out.country]).toEqual([null, null, null]);
    expect(out.copyright).toBe(META.copyright); // and nothing else
    expect(out.keywords).toEqual(META.keywords);
  });

  it("returns null when the scope leaves no content to write", () => {
    const noCopyright = { ...META, copyright: null };
    expect(filterExportMetadata(noCopyright, { include: "copyright", removeLocation: false })).toBeNull();
  });

  it("keeps a location-only photo's remaining fields from collapsing to null", () => {
    const placeOnly: XmpMetaFields = {
      ...META, rating: 0, label: null, title: null, caption: null, creator: null,
      copyright: null, jobTitle: null, credit: null, source: null, keywords: [],
    };
    expect(filterExportMetadata(placeOnly, { include: "all", removeLocation: false })).not.toBeNull();
    // …and with the places stripped there is genuinely nothing left.
    expect(filterExportMetadata(placeOnly, { include: "all", removeLocation: true })).toBeNull();
  });
});
