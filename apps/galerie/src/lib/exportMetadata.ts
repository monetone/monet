// exportMetadata — Lightroom's Export ▸ Metadata "Include" scope, applied to the
// XMP fields an export embeds. Pure field filtering; the packet itself is built
// by buildXmpSidecar and embedded by embedXmp.
//
// LR's four Include levels collapse to three here, deliberately: we never write
// camera / Camera Raw info into an export, so "All Except Camera & Camera Raw
// Info" and "All" would be the same option. No fake rows.

import { inPrivateLocation, type SavedLocation } from "./geotag";
import type { XmpMetaFields } from "./xmpSidecar";

export type MetadataInclude = "none" | "copyright" | "copyrightContact" | "all";

export const METADATA_INCLUDE_LABELS: Record<MetadataInclude, string> = {
  none: "None",
  copyright: "Copyright Only",
  copyrightContact: "Copyright & Contact Info Only",
  all: "All",
};

export interface MetadataScope {
  include: MetadataInclude;
  /** LR's "Remove Location Info" — drops the IPTC place fields. */
  removeLocation: boolean;
  /** Saved Locations with the Private flag: a photo whose GPS falls inside one
   *  gets the same location strip regardless of `removeLocation`. */
  privateLocations?: ReadonlyArray<SavedLocation>;
}

const EMPTY = {
  city: null,
  stateProvince: null,
  country: null,
  jobTitle: null,
  credit: null,
  source: null,
  rating: 0,
  label: null,
  title: null,
  caption: null,
  creator: null,
  copyright: null,
  keywords: [],
  hierarchical: [],
} satisfies XmpMetaFields;

/**
 * Narrow `meta` to the fields this export scope may carry, or null when nothing
 * should be written at all (Include = None, or every surviving field is empty —
 * an XMP packet with no content is not worth the bytes).
 *
 * `gps` is the photo's capture position (catalog gps_lat/gps_lon), used only to
 * test `scope.privateLocations` — a photo inside a Private saved location is
 * stripped of location metadata even when "Remove Location Info" is off.
 */
export function filterExportMetadata(
  meta: XmpMetaFields,
  scope: MetadataScope,
  gps?: { lat: number; lon: number } | null,
): XmpMetaFields | null {
  if (scope.include === "none") return null;
  let out: XmpMetaFields;
  switch (scope.include) {
    case "copyright":
      out = { ...EMPTY, copyright: meta.copyright };
      break;
    case "copyrightContact":
      // LR's "contact info" is the creator + the IPTC credit/source/job-title
      // block — the fields that say who made this and who to ask about it.
      out = {
        ...EMPTY,
        copyright: meta.copyright,
        creator: meta.creator,
        credit: meta.credit,
        source: meta.source,
        jobTitle: meta.jobTitle,
      };
      break;
    default:
      out = { ...meta };
      break;
  }
  const inPrivate =
    gps != null && inPrivateLocation(scope.privateLocations ?? [], gps.lat, gps.lon);
  if (scope.removeLocation || inPrivate) {
    // ponytail: the full IPTC location strip is GPS + Sublocation + City/State/
    // Country + ISO code, but XmpMetaFields carries only the place trio and
    // exports never embed GPS/EXIF from the original — when the sidecar schema
    // grows those fields, null them here too; this is the single strip point.
    out = { ...out, city: null, stateProvince: null, country: null };
  }
  return hasContent(out) ? out : null;
}

function hasContent(meta: XmpMetaFields): boolean {
  return (
    meta.rating > 0 ||
    meta.keywords.length > 0 ||
    meta.hierarchical.length > 0 ||
    [
      meta.label, meta.title, meta.caption, meta.creator, meta.copyright,
      meta.city, meta.stateProvince, meta.country, meta.jobTitle, meta.credit, meta.source,
    ].some((v) => typeof v === "string" && v.trim() !== "")
  );
}
