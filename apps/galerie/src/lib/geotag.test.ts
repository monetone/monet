import { describe, expect, it } from "vitest";

import { filterExportMetadata } from "./exportMetadata";
import type { PresetStorage } from "./exportPresets";
import {
  autoTagPhotos,
  distanceMeters,
  inPrivateLocation,
  isWithinLocation,
  listSavedLocations,
  locateAtTime,
  parseGpx,
  parseGpxBounded,
  parseTrackOffset,
  radiusMeters,
  saveSavedLocations,
  summarizeAutoTag,
  type SavedLocation,
  type TrackPoint,
} from "./geotag";
import type { XmpMetaFields } from "./xmpSidecar";

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <trk><name>Morning walk</name><trkseg>
    <trkpt lat="64.1466" lon="-21.9426"><ele>12</ele><time>2026-07-01T08:00:00Z</time></trkpt>
    <trkpt lon="-21.9400" lat="64.1500"><time>2026-07-01T08:10:00Z</time></trkpt>
    <trkpt lat="64.1600" lon="-21.9300"><ele>15</ele></trkpt>
    <trkpt lat="123.0" lon="-21.9300"><time>2026-07-01T08:20:00Z</time></trkpt>
    <trkpt lat="64.1700" lon="-21.9200"><time>2026-07-01T08:20:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

describe("parseGpx", () => {
  it("parses trkpts with either attribute order, drops timeless and out-of-range points", () => {
    const pts = parseGpx(GPX);
    expect(pts).toHaveLength(3); // no-<time> and lat=123 dropped
    expect(pts[0]).toEqual({ time: Date.parse("2026-07-01T08:00:00Z") / 1000, lat: 64.1466, lon: -21.9426 });
    expect(pts[1].lat).toBe(64.15);
    expect(pts.map((p) => p.time)).toEqual([...pts.map((p) => p.time)].sort((a, b) => a - b));
  });

  it("returns [] for garbage input", () => {
    expect(parseGpx("not xml at all")).toEqual([]);
  });
});

describe("parseGpxBounded", () => {
  it("parses like parseGpx when under the limit", () => {
    expect(parseGpxBounded(GPX, 10_000)).toEqual(parseGpx(GPX));
  });

  it("returns null (not []) when over the limit — untrusted-input bound", () => {
    expect(parseGpxBounded(GPX, GPX.length - 1)).toBeNull();
    expect(parseGpxBounded(GPX, GPX.length)).not.toBeNull(); // boundary: exactly at the limit is fine
  });
});

describe("parseTrackOffset", () => {
  it("parses signed HH:mm to seconds", () => {
    expect(parseTrackOffset("02:00")).toBe(7200);
    expect(parseTrackOffset("+1:30")).toBe(5400);
    expect(parseTrackOffset("-00:45")).toBe(-2700);
  });

  it("rejects malformed values", () => {
    expect(parseTrackOffset("2h")).toBeNull();
    expect(parseTrackOffset("01:75")).toBeNull();
    expect(parseTrackOffset("")).toBeNull();
  });
});

// A simple straight track: lat 10→11, lon 20→21 over 100s starting at t=1000.
const TRACK: TrackPoint[] = [
  { time: 1000, lat: 10, lon: 20 },
  { time: 1100, lat: 11, lon: 21 },
];

describe("locateAtTime", () => {
  it("interpolates linearly between bracketing points", () => {
    expect(locateAtTime(TRACK, 1050)).toEqual({ lat: 10.5, lon: 20.5 });
    expect(locateAtTime(TRACK, 1000)).toEqual({ lat: 10, lon: 20 });
    expect(locateAtTime(TRACK, 1100)).toEqual({ lat: 11, lon: 21 });
  });

  it("returns null outside the track window (photos stay untagged)", () => {
    expect(locateAtTime(TRACK, 999)).toBeNull();
    expect(locateAtTime(TRACK, 1101)).toBeNull();
    expect(locateAtTime([], 1050)).toBeNull();
  });

  it("applies the tracklog time offset to the track clock", () => {
    // Camera 1h ahead of the logger: capture 4650 matches track time 1050.
    expect(locateAtTime(TRACK, 4650, 3600)).toEqual({ lat: 10.5, lon: 20.5 });
  });

  it("handles duplicate timestamps without dividing by zero", () => {
    const dup: TrackPoint[] = [
      { time: 1000, lat: 10, lon: 20 },
      { time: 1000, lat: 12, lon: 22 },
    ];
    // Coincident timestamps: either point is a valid answer; must not be NaN.
    expect(locateAtTime(dup, 1000)).toEqual({ lat: 12, lon: 22 });
  });
});

describe("autoTagPhotos", () => {
  it("tags matchable photos and skips the rest", () => {
    const matches = autoTagPhotos(
      [
        { id: 1, captureTime: 1050 },
        { id: 2, captureTime: null },
        { id: 3, captureTime: 5000 },
      ],
      TRACK,
    );
    expect(matches).toEqual([{ id: 1, lat: 10.5, lon: 20.5 }]);
  });
});

describe("summarizeAutoTag", () => {
  const photos = [
    { id: 1, captureTime: 1050 }, // in range
    { id: 2, captureTime: null }, // no capture time
    { id: 3, captureTime: 5000 }, // out of range
  ];

  it("breaks down why the untagged photos were skipped", () => {
    const summary = summarizeAutoTag(photos, TRACK);
    expect(summary.tagged).toEqual([{ id: 1, lat: 10.5, lon: 20.5 }]);
    expect(summary.noCaptureTime).toBe(1);
    expect(summary.outOfRange).toBe(1);
  });

  it("agrees with autoTagPhotos on the tagged set (autoTagPhotos delegates to it)", () => {
    expect(summarizeAutoTag(photos, TRACK).tagged).toEqual(autoTagPhotos(photos, TRACK));
  });
});

const reykjavik = { lat: 64.1466, lon: -21.9426 };

function loc(over: Partial<SavedLocation> = {}): SavedLocation {
  return { id: "l1", name: "Home", ...reykjavik, radius: 1, unit: "km", isPrivate: true, ...over };
}

describe("saved locations", () => {
  it("converts radius units to meters", () => {
    expect(radiusMeters({ radius: 2, unit: "km" })).toBe(2000);
    expect(radiusMeters({ radius: 1, unit: "mi" })).toBeCloseTo(1609.344);
    expect(radiusMeters({ radius: 100, unit: "ft" })).toBeCloseTo(30.48);
  });

  it("haversine distance is sane (1° of latitude ≈ 111.2 km)", () => {
    expect(distanceMeters(0, 0, 1, 0)).toBeCloseTo(111195, -3);
  });

  it("isWithinLocation respects the radius", () => {
    // ~740m north of the center — inside 1km, outside 500m.
    const nearby = { lat: reykjavik.lat + 1 / 150, lon: reykjavik.lon };
    expect(isWithinLocation(loc(), nearby.lat, nearby.lon)).toBe(true);
    expect(isWithinLocation(loc({ radius: 500, unit: "m" }), nearby.lat, nearby.lon)).toBe(false);
  });

  it("inPrivateLocation only matches Private locations", () => {
    expect(inPrivateLocation([loc()], reykjavik.lat, reykjavik.lon)).toBe(true);
    expect(inPrivateLocation([loc({ isPrivate: false })], reykjavik.lat, reykjavik.lon)).toBe(false);
    expect(inPrivateLocation([loc()], 0, 0)).toBe(false);
  });
});

function fakeStorage(): PresetStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("saved locations persistence", () => {
  it("round-trips through storage", () => {
    const s = fakeStorage();
    saveSavedLocations([loc()], s);
    expect(listSavedLocations(s)).toEqual([loc()]);
  });

  it("tolerates missing or corrupt storage", () => {
    expect(listSavedLocations(null)).toEqual([]);
    const s = fakeStorage();
    s.data.set("galerie.savedLocations", "{nope");
    expect(listSavedLocations(s)).toEqual([]);
    s.data.set("galerie.savedLocations", JSON.stringify([loc(), { id: "bad", lat: 999 }]));
    expect(listSavedLocations(s)).toEqual([loc()]);
  });
});

const META: XmpMetaFields = {
  rating: 3,
  label: null,
  title: "Harbour",
  caption: null,
  creator: null,
  copyright: null,
  city: "Reykjavík",
  stateProvince: "Capital Region",
  country: "Iceland",
  jobTitle: null,
  credit: null,
  source: null,
  keywords: [],
  hierarchical: [],
};

describe("Private saved locations on export", () => {
  const scope = { include: "all", removeLocation: false, privateLocations: [loc()] } as const;

  it("strips the IPTC place fields for a photo inside a Private location", () => {
    const out = filterExportMetadata(META, scope, reykjavik)!;
    expect(out.city).toBeNull();
    expect(out.stateProvince).toBeNull();
    expect(out.country).toBeNull();
    expect(out.title).toBe("Harbour"); // only location is stripped
  });

  it("keeps location for photos outside, without GPS, or in non-private locations", () => {
    expect(filterExportMetadata(META, scope, { lat: 0, lon: 0 })!.city).toBe("Reykjavík");
    expect(filterExportMetadata(META, scope, null)!.city).toBe("Reykjavík");
    expect(filterExportMetadata(META, scope)!.city).toBe("Reykjavík");
    const publicScope = { ...scope, privateLocations: [loc({ isPrivate: false })] };
    expect(filterExportMetadata(META, publicScope, reykjavik)!.city).toBe("Reykjavík");
  });

  it("Remove Location Info still strips independently of GPS", () => {
    const out = filterExportMetadata(META, { include: "all", removeLocation: true }, reykjavik)!;
    expect(out.city).toBeNull();
  });
});
