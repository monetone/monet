// ─────────────────────────────────────────────────────────────
// engine/io/markers.test — marker CSV export / import
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { newMarker } from "../model/factory";
import { resetIds } from "../model/ids";
import { exportMarkersCsv, parseMarkersCsv } from "./markers";

describe("exportMarkersCsv", () => {
  it("writes a header and one row per marker, with cue/region types", () => {
    resetIds();
    const csv = exportMarkersCsv([
      newMarker({ time: 1.5, name: "Intro" }),
      newMarker({ time: 2, end: 4.25, name: "Verse" }),
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Name,Start,End,Duration,Type");
    expect(lines[1]).toBe("Intro,1.500000,,0.000000,Cue");
    expect(lines[2]).toBe("Verse,2.000000,4.250000,2.250000,Region");
  });

  it("quotes names containing commas or quotes", () => {
    resetIds();
    const csv = exportMarkersCsv([
      newMarker({ time: 0, name: "Take 1, alt" }),
      newMarker({ time: 1, name: 'say "hi"' }),
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[1]).toBe('"Take 1, alt",0.000000,,0.000000,Cue');
    expect(lines[2]).toBe('"say ""hi""",1.000000,,0.000000,Cue');
  });
});

describe("parseMarkersCsv", () => {
  it("round-trips cue and region markers through export → parse", () => {
    resetIds();
    const markers = [
      newMarker({ time: 0.25, name: "A" }),
      newMarker({ time: 1, end: 3, name: "Region, with comma" }),
      newMarker({ time: 5.125, name: 'q"q' }),
    ];
    const back = parseMarkersCsv(exportMarkersCsv(markers));
    expect(back).toHaveLength(3);
    for (let i = 0; i < markers.length; i++) {
      expect(back[i].name).toBe(markers[i].name);
      expect(back[i].time).toBeCloseTo(markers[i].time, 6);
      expect(back[i].end ?? null).toEqual(markers[i].end ?? null);
      expect(back[i].kind).toBe(markers[i].kind);
    }
  });

  it("skips the header and blank/junk lines", () => {
    const csv = "Name,Start,End,Duration,Type\n\nIntro,1.0,,0,Cue\nnonsense row\nVerse,2.0,3.0,1.0,Region\n";
    const m = parseMarkersCsv(csv);
    expect(m).toHaveLength(2);
    expect(m[0].name).toBe("Intro");
    expect(m[0].kind).toBe("cue");
    expect(m[1].name).toBe("Verse");
    expect(m[1].kind).toBe("region");
    expect(m[1].end).toBeCloseTo(3, 6);
  });

  it("infers a region from a positive duration when End is absent", () => {
    const m = parseMarkersCsv("Name,Start,End,Duration,Type\nX,1.0,,2.5,Region\n");
    expect(m[0].end).toBeCloseTo(3.5, 6);
    expect(m[0].kind).toBe("region");
  });

  it("treats an explicit Cue type as a point even if an end is present", () => {
    const m = parseMarkersCsv("Name,Start,End,Duration,Type\nX,1.0,3.0,2.0,Cue\n");
    expect(m[0].end).toBeUndefined();
    expect(m[0].kind).toBe("cue");
  });

  it("returns nothing for an empty or header-only CSV", () => {
    expect(parseMarkersCsv("")).toEqual([]);
    expect(parseMarkersCsv("Name,Start,End,Duration,Type\n")).toEqual([]);
  });
});
