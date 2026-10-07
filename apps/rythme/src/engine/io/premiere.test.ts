// ─────────────────────────────────────────────────────────────
// engine/io/premiere.test — Premiere-friendly EDL / FCP7 XML
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { sine } from "../generate/tone";
import { emptyProject, newClip, newTrack } from "../model/factory";
import { resetIds } from "../model/ids";
import { addClip } from "../ops/clip";
import { exportPremiereEdl, exportPremiereXml, framesToTimecode, secondsToTimecode } from "./premiere";

const SR = 48000;

function fixtureProject() {
  resetIds();
  let project = emptyProject("Mix & Review", 0, SR, 2);
  const music = newTrack(0, { name: "Music" });
  const vox = newTrack(1, { name: "Vox" });
  project = { ...project, tracks: [music, vox] };
  project = addClip(project, music.id, newClip(sine(440, 4, { sampleRate: SR, channels: 2 }), { trackId: music.id, name: "Music Bed", start: 0 }));
  project = addClip(project, vox.id, newClip(sine(220, 3, { sampleRate: SR, channels: 1 }), { trackId: vox.id, name: "Dialogue <01>", start: 1, inPoint: 0.5, duration: 2 }));
  project = addClip(project, vox.id, newClip(sine(330, 1, { sampleRate: SR, channels: 1 }), { trackId: vox.id, name: "Muted", start: 4, muted: true }));
  project.markers.push({ id: "m1", time: 1, end: 3, name: "Scene 1", color: "var(--accent-audio)", kind: "region" });
  return project;
}

describe("Premiere interchange helpers", () => {
  it("converts seconds and frame counts to non-drop-frame timecode", () => {
    expect(framesToTimecode(0, 30)).toBe("00:00:00:00");
    expect(framesToTimecode(30 * 60 + 12, 30)).toBe("00:01:00:12");
    expect(secondsToTimecode(1.5, 30)).toBe("00:00:01:15");
  });

  it("exports a CMX-style EDL with sorted audio events and markers", () => {
    const edl = exportPremiereEdl(fixtureProject(), { frameRate: 30 });

    expect(edl).toContain("TITLE: Mix & Review");
    expect(edl).toContain("FCM: NON-DROP FRAME");
    expect(edl).toContain("* MARKER: 00:00:01:00 - 00:00:03:00 Scene 1");
    expect(edl).toContain("001  MUSICBED A     C        00:00:00:00 00:00:04:00 00:00:00:00 00:00:04:00");
    expect(edl).toContain("002  DIALOGUE A     C        00:00:00:15 00:00:02:15 00:00:01:00 00:00:03:00");
    expect(edl).toContain("* TRACK: Vox");
    expect(edl).not.toContain("Muted");
  });

  it("exports Final Cut Pro 7 XML that Premiere can import as an audio sequence", () => {
    const xml = exportPremiereXml(fixtureProject(), { frameRate: 30 });

    expect(xml).toContain('<xmeml version="5">');
    expect(xml).toContain("<name>Mix &amp; Review</name>");
    expect(xml).toContain("<numOutputChannels>2</numOutputChannels>");
    expect(xml).toContain("<samplerate>48000</samplerate>");
    expect(xml).toContain("<name>Dialogue &lt;01&gt;</name>");
    expect(xml).toContain("<start>30</start>");
    expect(xml).toContain("<end>90</end>");
    expect(xml).toContain("<in>15</in>");
    expect(xml).toContain("<out>75</out>");
    expect(xml).toContain("<marker>");
    expect(xml).toContain("<out>90</out>");
    expect(xml).not.toContain("<name>Muted</name>");
  });

  it("can include muted clips when requested", () => {
    expect(exportPremiereXml(fixtureProject(), { includeMuted: true })).toContain("<name>Muted</name>");
  });
});
