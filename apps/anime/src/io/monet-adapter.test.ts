// monet-adapter — the courier contract: Anime owns `data.anime` and must hand
// everything else back untouched, converting a frames sequence to seconds once
// on read. These are the interop guarantees a Cinema→Anime→Cinema trip relies on.

import { describe, expect, it } from "vitest";
import { MonetFormatError, parse, serialize, type MonetFile } from "@monet-ui/monet-format";
import { createProject } from "../model/factory";
import { fromMonet, toMonet } from "./monet-adapter";

/** A frames-based (24 fps) document as Cinema would write it, with foreign
 *  namespaces, a media library, two tracks, markers and an unknown clip field. */
const CINEMA_JSON = JSON.stringify({
  format: "monet",
  schemaVersion: 1,
  app: { name: "monet-cinema", version: "0.1.0" },
  document: {
    id: "doc_1",
    name: "Cinema Cut",
    defaults: { fps: 24, width: 1920, height: 1080 },
    media: [
      { id: "m1", name: "shot.mov", kind: "video", source: { path: "/tmp/shot.mov" }, duration: { frames: 240, fps: 24 } },
    ],
    sequences: [
      {
        id: "seq_1",
        name: "Sequence 1",
        timeBase: { kind: "frames", fps: 24 },
        settings: { width: 1280, height: 720, duration: 240, background: "#101010", tempo: 120 },
        tracks: [
          {
            id: "v1",
            kind: "video",
            name: "V1",
            enabled: true,
            locked: false,
            data: { cinema: { height: 56, muted: false } },
            clips: [
              {
                id: "c1",
                start: 48,
                duration: 72,
                inPoint: 12,
                speed: 1,
                enabled: true,
                name: "Shot A",
                mediaId: "m1",
                lensProfile: "anamorphic", // unknown field — forward-compat cargo
                data: { cinema: { kind: "video", audioGain: -3 } },
              },
            ],
          },
          {
            id: "a1",
            kind: "audio",
            name: "A1",
            clips: [
              { id: "c2", start: 0, duration: 240, inPoint: 0, speed: 1, enabled: true, data: { rythme: { gainDb: -6 } } },
            ],
          },
        ],
        markers: [{ time: 96, name: "beat" }],
      },
    ],
    activeSequenceId: "seq_1",
    data: { cinema: { colorSpace: "rec709" } },
  },
});

/** project → .monet → parse, i.e. exactly what a save + reopen produces. */
function saved(file: MonetFile): MonetFile {
  return parse(serialize(file));
}

describe("fromMonet", () => {
  it("converts a frames sequence to seconds and keeps every track's clips", () => {
    const project = fromMonet(parse(CINEMA_JSON));
    const comp = project.compositions[0];

    expect(comp.fps).toBe(24);
    expect(comp.duration).toBe(10); // 240 frames @ 24
    expect(comp.width).toBe(1280);
    // Both tracks' clips arrive as layers, in track order, tagged with origin.
    expect(comp.layers.map((l) => l.id)).toEqual(["c1", "c2"]);
    expect(comp.layers.map((l) => l.trackId)).toEqual(["v1", "a1"]);
    const [shot] = comp.layers;
    expect(shot.inPoint).toBe(2); // 48 frames
    expect(shot.outPoint).toBe(5); // +72 frames
    expect(shot.name).toBe("Shot A");
  });

  it("rejects a document with nothing to open rather than yielding a blank project", () => {
    const empty = parse(JSON.stringify({ format: "monet", schemaVersion: 1, app: { name: "x", version: "1" }, document: { name: "Empty", media: [], sequences: [] } }));
    expect(() => fromMonet(empty)).toThrow(MonetFormatError);
  });
});

describe("courier round-trip (Cinema → Anime → save)", () => {
  const out = saved(toMonet(fromMonet(parse(CINEMA_JSON)))).document;
  const seq = out.sequences[0];

  it("preserves the document's foreign namespace, media library and id", () => {
    expect(out.id).toBe("doc_1");
    expect(out.data?.cinema).toEqual({ colorSpace: "rec709" });
    expect(out.media).toEqual([
      { id: "m1", name: "shot.mov", kind: "video", source: { path: "/tmp/shot.mov" }, duration: { frames: 240, fps: 24 } },
    ]);
  });

  it("keeps the track layout, track payload and markers", () => {
    expect(seq.timeBase).toEqual({ kind: "seconds" });
    expect(seq.tracks.map((t) => [t.id, t.kind, t.name])).toEqual([
      ["v1", "video", "V1"],
      ["a1", "audio", "A1"],
    ]);
    expect(seq.tracks[0].data?.cinema).toEqual({ height: 56, muted: false });
    expect(seq.tracks.map((t) => t.clips.map((c) => c.id))).toEqual([["c1"], ["c2"]]);
    expect(seq.markers).toEqual([{ time: 4, name: "beat" }]); // 96 frames @ 24
    expect(seq.settings?.tempo).toBe(120); // a foreign setting Anime never reads
  });

  it("preserves each clip's foreign data, media link and unknown fields", () => {
    const c1 = seq.tracks[0].clips[0] as typeof seq.tracks[0]["clips"][0] & { lensProfile?: string };
    expect(c1.data?.cinema).toEqual({ kind: "video", audioGain: -3 });
    expect(c1.mediaId).toBe("m1");
    expect(c1.lensProfile).toBe("anamorphic");
    expect(c1.inPoint).toBe(0.5); // source trim, converted 12 frames → seconds
    expect(c1.start).toBe(2);
    expect(c1.duration).toBe(3);
    expect(seq.tracks[1].clips[0].data?.rythme).toEqual({ gainDb: -6 });
    // …and Anime's own namespace rides alongside, never replacing theirs.
    expect(c1.data).toHaveProperty("anime");
  });
});

describe("native round-trip", () => {
  it("re-saves an Anime project byte-identically", () => {
    const project = createProject("Round Trip");
    const first = serialize(toMonet(project));
    const reopened = fromMonet(parse(first));
    const second = serialize(toMonet(reopened));

    expect(reopened.name).toBe("Round Trip");
    expect(reopened.compositions[0].layers.map((l) => l.name)).toEqual(["Title", "Badge"]);
    expect(reopened.compositions[0].layers[0].transform).toEqual(project.compositions[0].layers[0].transform);
    expect(reopened.compositions[0].fps).toBe(project.compositions[0].fps);
    expect(second).toBe(first);
  });
});
