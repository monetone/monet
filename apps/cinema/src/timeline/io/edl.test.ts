import { describe, expect, it } from "vitest";
import { createClip, createSequence, resetIds } from "../model/factory";
import type { Sequence } from "../model/types";
import { exportEdl } from "./edl";

// Parse an EDL into its header text + tokenized event records. Each event line
// is `NNN  AX  <chan> C  <srcIn> <srcOut> <recIn> <recOut>`, optionally followed
// by a `* FROM CLIP NAME:` comment — collapsing runs of spaces gives stable
// positional tokens regardless of the column padding.
function parse(edl: string) {
  const lines = edl.split("\n");
  const header = lines.filter((l) => l.startsWith("TITLE:") || l.startsWith("FCM:"));
  const events: { ev: string; chan: string; srcIn: string; srcOut: string; recIn: string; recOut: string; name?: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\d{3}\s/.test(lines[i])) continue;
    const t = lines[i].split(/\s+/);
    const next = lines[i + 1] ?? "";
    const name = next.startsWith("* FROM CLIP NAME:") ? next.slice("* FROM CLIP NAME:".length).trim() : undefined;
    events.push({ ev: t[0], chan: t[2], srcIn: t[4], srcOut: t[5], recIn: t[6], recOut: t[7], name });
  }
  return { header, events };
}

describe("edl — CMX3600 export", () => {
  it("emits the header + one ordered event per clip with source/record timecodes", () => {
    resetIds();
    // 1 video + 1 audio track @ 24 fps.
    const seq: Sequence = createSequence({ name: "Cut 1", fps: 24, videoTracks: 1, audioTracks: 1 });
    const [v1, a1] = seq.tracks;

    // Pushed out of start order to prove the exporter sorts by start time.
    const clipB = createClip({ name: "B", kind: "video", start: 48, duration: 24, inPoint: 0 });
    const clipA = createClip({ name: "A", kind: "video", start: 0, duration: 48, inPoint: 12 });
    v1.clips.push(clipB, clipA);
    a1.clips.push(createClip({ name: "voice", kind: "audio", start: 0, duration: 24, inPoint: 0 }));

    const { header, events } = parse(exportEdl(seq));

    expect(header).toEqual(["TITLE: Cut 1", "FCM: NON-DROP FRAME"]);
    expect(events.map((e) => e.ev)).toEqual(["001", "002", "003"]); // numbered, zero-padded

    // Event 001 = clipA (earliest start), even though it was pushed second.
    expect(events[0]).toMatchObject({
      chan: "V",
      srcIn: "00:00:00:12", // inPoint 12
      srcOut: "00:00:02:12", // inPoint 12 + duration 48 = 60f
      recIn: "00:00:00:00", // start 0
      recOut: "00:00:02:00", // start 0 + duration 48
      name: "A",
    });
    // Event 002 = clipB (start 48).
    expect(events[1]).toMatchObject({
      chan: "V",
      srcIn: "00:00:00:00",
      srcOut: "00:00:01:00", // duration 24
      recIn: "00:00:02:00", // start 48f = 2s
      recOut: "00:00:03:00", // 48 + 24 = 72f = 3s
      name: "B",
    });
    // Event 003 = the audio clip on A1 (tracks iterate video-first).
    expect(events[2]).toMatchObject({ chan: "A", recIn: "00:00:00:00", recOut: "00:00:01:00", name: "voice" });
  });

  it("falls back to mediaId for an unnamed clip, and defaults the title", () => {
    resetIds();
    const seq = createSequence({ name: "", fps: 24, videoTracks: 1, audioTracks: 0 });
    seq.tracks[0].clips.push(createClip({ name: "", kind: "video", mediaId: "roll_07.mov", start: 0, duration: 24 }));

    const edl = exportEdl(seq);
    expect(edl.startsWith("TITLE: SEQUENCE\n")).toBe(true); // empty name → default title
    expect(parse(edl).events[0].name).toBe("roll_07.mov"); // name || mediaId
  });

  it("emits only the header for a sequence with no clips", () => {
    const seq = createSequence({ name: "Empty", videoTracks: 2, audioTracks: 2 });
    const { header, events } = parse(exportEdl(seq));
    expect(header).toEqual(["TITLE: Empty", "FCM: NON-DROP FRAME"]);
    expect(events).toHaveLength(0);
  });
});
