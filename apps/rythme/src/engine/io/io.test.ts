import { describe, expect, it } from "vitest";
import { createContainer, getEntry, readContainer, setEntry, writeContainer } from "@monet-ui/monet-format";
import { fromChannels } from "../audio/buffer";
import { channelCount, frameCount } from "../audio/types";
import { sine } from "../generate/tone";
import { peakAmplitude } from "../dsp/normalize";
import { defaultPanelPreferences, emptyProject, newAutomationLane, newBus, newClip, newEffectRack, newEffectSlot, newSend, newTrack, newVideoAsset, newVideoClip, newVideoTrack } from "../model/factory";
import { resetIds } from "../model/ids";
import { decodeWav, decodeWavInfo, encodeWav } from "./wav";
import { decodeAiff, decodeAiffMetadata, encodeAiff } from "./aiff";
import { deserializeProject, readProject, serializeProject } from "./project";
import { decodeAudio, encodeAudio, sniffFormat } from "./import";

const SR = 48000;

/** Another Monet app's container, carrying only its timeline at role "time". */
function foreignTimeline(json: string): Uint8Array {
  const c = createContainer({ name: "monet-cinema", version: "0.1.0" }, "time");
  setEntry(c, "timeline.json", "time", new TextEncoder().encode(json));
  return writeContainer(c);
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("WAV codec", () => {
  for (const bitDepth of [16, 24, 32] as const) {
    it(`round-trips ${bitDepth}-bit PCM within quantization error`, () => {
      const d = sine(440, 0.05, { sampleRate: SR, amplitude: 0.8, channels: 2 });
      const bytes = encodeWav(d, { bitDepth });
      const back = decodeWav(bytes);
      expect(back.sampleRate).toBe(SR);
      expect(channelCount(back)).toBe(2);
      expect(frameCount(back)).toBe(frameCount(d));
      // round-trip error is bounded by ~1.5 LSB of the target bit depth
      const tol = bitDepth === 16 ? 1.5 / 32768 : bitDepth === 24 ? 1.5 / 8388608 : 1 / 1e9;
      expect(maxAbsDiff(d.channels[0], back.channels[0])).toBeLessThan(tol);
    });
  }

  it("round-trips 32-bit float exactly", () => {
    const d = sine(440, 0.02, { sampleRate: SR, amplitude: 0.8 });
    const back = decodeWav(encodeWav(d, { bitDepth: 32, float: true }));
    expect(maxAbsDiff(d.channels[0], back.channels[0])).toBeLessThan(1e-7);
  });

  it("round-trips a 5.1 channel WAV bed", () => {
    const d = fromChannels(
      Array.from({ length: 6 }, (_, c) => [c === 4 ? 0.5 : 0, c === 4 ? -0.5 : 0]),
      SR,
    );
    const back = decodeWav(encodeWav(d, { bitDepth: 24 }));
    expect(channelCount(back)).toBe(6);
    expect(maxAbsDiff(d.channels[4], back.channels[4])).toBeLessThan(2 / 8388608);
    expect(peakAmplitude({ sampleRate: SR, channels: [back.channels[0]] })).toBeLessThan(1e-6);
  });

  it("produces a 44-byte header + data", () => {
    const d = fromChannels([[0, 0, 0]], SR);
    const bytes = encodeWav(d, { bitDepth: 16 });
    expect(bytes.length).toBe(44 + 3 * 2);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("RIFF");
  });

  it("round-trips RIFF INFO metadata", () => {
    const bytes = encodeWav(fromChannels([[0, 0]], SR), {
      metadata: { title: "Cue Sheet", artist: "Rythme", album: "Session", genre: "Post", comment: "mix notes", copyright: "2026" },
    });
    expect(decodeWavInfo(bytes)).toMatchObject({
      title: "Cue Sheet",
      artist: "Rythme",
      album: "Session",
      genre: "Post",
      comment: "mix notes",
      copyright: "2026",
    });
  });

  it("rejects non-RIFF data", () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4]))).toThrow(/RIFF/);
  });
});

describe("AIFF codec", () => {
  for (const bitDepth of [16, 24] as const) {
    it(`round-trips ${bitDepth}-bit big-endian PCM`, () => {
      const d = sine(330, 0.05, { sampleRate: 44100, amplitude: 0.7, channels: 2 });
      const back = decodeAiff(encodeAiff(d, { bitDepth }));
      expect(back.sampleRate).toBe(44100);
      expect(channelCount(back)).toBe(2);
      expect(frameCount(back)).toBe(frameCount(d));
      const tol = bitDepth === 16 ? 1.5 / 32768 : 1.5 / 8388608;
      expect(maxAbsDiff(d.channels[0], back.channels[0])).toBeLessThan(tol);
    });
  }

  it("encodes the 48 kHz rate via the 80-bit extended field", () => {
    const d = sine(1000, 0.01, { sampleRate: 48000 });
    expect(decodeAiff(encodeAiff(d, { bitDepth: 16 })).sampleRate).toBe(48000);
  });

  it("round-trips AIFF text metadata chunks", () => {
    const bytes = encodeAiff(sine(440, 0.01, { sampleRate: SR }), {
      metadata: { title: "Scene 7", artist: "Dialogue Editor", comment: "clean stem", copyright: "2026" },
    });
    expect(decodeAiffMetadata(bytes)).toMatchObject({
      title: "Scene 7",
      artist: "Dialogue Editor",
      comment: "clean stem",
      copyright: "2026",
    });
  });
});

describe("project format", () => {
  it("round-trips a multitrack project with audio", () => {
    resetIds();
    const p = emptyProject("Mix", 0, SR);
    const t = newTrack(0, { name: "Vox" });
    const clip = newClip(sine(440, 0.05, { sampleRate: SR, amplitude: 0.6, channels: 2 }), {
      trackId: t.id,
      name: "take-1",
      start: 1.5,
    });
    t.clips.push(clip);
    p.tracks.push(t);
    p.markers.push({ id: "m1", time: 2, name: "Chorus", color: "var(--accent-audio)", kind: "cue" });

    const json = serializeProject(p);
    const back = deserializeProject(json);
    expect(back.name).toBe("Mix");
    expect(back.tracks).toHaveLength(1);
    expect(back.tracks[0].name).toBe("Vox");
    expect(back.tracks[0].clips[0].start).toBe(1.5);
    expect(back.markers[0].name).toBe("Chorus");
    const orig = p.tracks[0].clips[0].buffer.channels[0];
    const round = back.tracks[0].clips[0].buffer.channels[0];
    expect(maxAbsDiff(orig, round)).toBeLessThan(1e-7);
    expect(peakAmplitude(back.tracks[0].clips[0].buffer)).toBeCloseTo(0.6, 2);
  });

  it("round-trips project metadata fields", () => {
    const p = emptyProject("Mix", 0, SR);
    p.meta = {
      ...p.meta,
      title: "Podcast Mix",
      artist: "Monet",
      album: "Season 1",
      genre: "Speech",
      comment: "final",
      copyright: "2026 Monet",
      keywords: "dialogue,master",
    };
    const back = deserializeProject(serializeProject(p));
    expect(back.meta).toMatchObject({
      title: "Podcast Mix",
      artist: "Monet",
      album: "Season 1",
      genre: "Speech",
      comment: "final",
      copyright: "2026 Monet",
      keywords: "dialogue,master",
    });
  });

  it("round-trips project favorite effect chains", () => {
    const p = emptyProject("Favorites", 0, SR);
    p.favoriteEffectChains = [
      {
        id: "fav-clean",
        name: "Dialogue Clean",
        steps: [
          { kind: "gain", name: "Trim", enabled: true, params: { gainDb: -3 } },
          { kind: "invertPolarity", name: "Invert", enabled: false, params: {} },
        ],
      },
    ];

    const back = deserializeProject(serializeProject(p));
    expect(back.favoriteEffectChains).toEqual(p.favoriteEffectChains);
  });

  it("round-trips the native plug-in manager inventory", () => {
    const p = emptyProject("Plug-ins", 0, SR);
    p.nativePluginManager = {
      scanRoots: ["/Library/Audio/Plug-Ins/VST3"],
      lastScanAt: 123,
      plugins: [
        {
          id: "native-vst3-pro-q",
          kind: "vst3",
          name: "Pro-Q 3",
          vendor: "FabFilter",
          version: "3.2.1",
          bundleIdentifier: "com.fabfilter.Pro-Q.3",
          path: "/Library/Audio/Plug-Ins/VST3/Pro-Q 3.vst3",
          extension: ".vst3",
          canProcess: false,
          hostStatus: "inventoryOnly",
          enabled: false,
          lastScannedAt: 123,
          validationStatus: "metadataVerified",
          validationIssues: ["Inventory only"],
          entryPointVerified: true,
          presetName: "Dialogue",
          state: { thresholdDb: -18, enabled: true },
        },
      ],
    };

    const back = deserializeProject(serializeProject(p));
    expect(back.nativePluginManager).toEqual(p.nativePluginManager);
  });

  it("round-trips clip, track, bus, and master automation modes", () => {
    const p = emptyProject("Automation Modes", 0, SR);
    const t = newTrack(0, { id: "track-auto", automationMode: "off" });
    const clip = newClip(sine(440, 0.05, { sampleRate: SR, amplitude: 0.6, channels: 2 }), {
      trackId: t.id,
      id: "clip-auto",
      automationMode: "touch",
    });
    t.clips.push(clip);
    p.tracks.push(t);
    p.buses = [newBus(0, { id: "bus-auto", automationMode: "latch" })];
    p.masterAutomationMode = "write";

    const back = deserializeProject(serializeProject(p));
    expect(back.tracks[0].automationMode).toBe("off");
    expect(back.tracks[0].clips[0].automationMode).toBe("touch");
    expect(back.buses?.[0].automationMode).toBe("latch");
    expect(back.masterAutomationMode).toBe("write");
  });

  it("round-trips the project output channel count", () => {
    const p = emptyProject("Surround", 0, SR, 6);
    const back = deserializeProject(serializeProject(p));
    expect(back.channelCount).toBe(6);
  });

  it("round-trips reference video assets and video tracks", () => {
    const p = emptyProject("Picture Lock", 0, SR);
    p.videoFrameRate = 23.976;
    const asset = newVideoAsset({
      id: "asset-picture",
      name: "scene-12.mp4",
      sourceName: "scene-12.mp4",
      sourcePath: "/show/scene-12.mp4",
      mimeType: "video/mp4",
      duration: 8.5,
      width: 1920,
      height: 1080,
      frameRate: 23.976,
      hasAudio: true,
    });
    const video = newVideoTrack(0, {
      id: "video-main",
      clips: [newVideoClip(asset, { id: "vclip-picture", trackId: "video-main", start: 3, duration: 5, inPoint: 1, locked: true })],
    });
    p.videoAssets = [asset];
    p.videoTracks = [video];

    const back = deserializeProject(serializeProject(p));
    expect(back.videoFrameRate).toBe(23.976);
    expect(back.videoAssets?.[0]).toMatchObject({
      id: "asset-picture",
      sourcePath: "/show/scene-12.mp4",
      mimeType: "video/mp4",
      duration: 8.5,
      width: 1920,
      height: 1080,
      frameRate: 23.976,
      hasAudio: true,
    });
    expect(back.videoTracks?.[0].clips[0]).toMatchObject({
      id: "vclip-picture",
      assetId: "asset-picture",
      start: 3,
      duration: 5,
      inPoint: 1,
      locked: true,
    });
  });

  it("round-trips a track surround panner", () => {
    const p = emptyProject("Surround", 0, SR, 6);
    p.tracks.push(newTrack(0, { surroundPan: { x: -0.5, y: 0.25, center: 0.4, lfe: 0.1, divergence: 0.75 } }));
    const back = deserializeProject(serializeProject(p));
    expect(back.tracks[0].surroundPan).toEqual({ x: -0.5, y: 0.25, center: 0.4, lfe: 0.1, divergence: 0.75 });
  });

  it("round-trips audio hardware, editor preferences, and track input assignments", () => {
    const p = emptyProject("Hardware", 0, SR);
    p.audioHardware = {
      inputDeviceId: "mic-a",
      outputDeviceId: "out-a",
      hardwareSampleRate: 96000,
      inputChannels: 2,
      inputMonitoring: "armed",
      latencyCompensationMs: 24,
      preRollSeconds: 2,
      countInBars: 1,
      punchIn: { start: 10, end: 14 },
      meterCalibrationDb: -3,
      meterPeakHoldMs: 2400,
    };
    p.editorPreferences = {
      editorMode: "waveform",
      tool: "envelope",
      snap: false,
      displayTimeFormat: "samples",
      spectralMinHz: 80,
      spectralMaxHz: 16000,
      activeWorkspaceId: "mix-review",
      customWorkspaces: [{
        id: "mix-review",
        name: "Mix Review",
        layout: { left: { size: 280, stack: [{ tabs: ["mixer"], active: "mixer", flex: 1 }] } },
      }],
      keyboardShortcuts: [{ action: "edit.split", key: "x", mod: true, shift: true, alt: false }],
      keyboardShortcutPresets: [{
        id: "editing",
        name: "Editing",
        shortcuts: [{ action: "edit.split", key: "x", mod: true, shift: true, alt: false }],
      }],
    };
    const panelPreferences = defaultPanelPreferences(SR);
    p.panelPreferences = {
      ...panelPreferences,
      analyze: { spectralMinHz: 120, spectralMaxHz: 12000, spectralGainDb: -18 },
      effects: { ...panelPreferences.effects, gainDb: 9, normalizeTargetDb: -1, dehummerHarmonics: 12 },
    };
    p.tracks.push(newTrack(0, { input: { channel: "right", deviceId: "mic-b", label: "Boom", monitoring: "always" } }));
    const back = deserializeProject(serializeProject(p));
    expect(back.audioHardware).toEqual(p.audioHardware);
    expect(back.editorPreferences).toEqual(p.editorPreferences);
    expect(back.panelPreferences).toEqual(p.panelPreferences);
    expect(back.tracks[0].input).toEqual({ channel: "right", deviceId: "mic-b", label: "Boom", monitoring: "always" });
  });

  it("round-trips Essential Sound track roles", () => {
    const p = emptyProject("Roles", 0, SR);
    p.tracks.push(newTrack(0, { name: "Dialogue", audioRole: "dialogue" }));
    p.tracks.push(newTrack(1, { name: "Music", audioRole: "music" }));
    p.tracks.push(newTrack(2, { name: "No Role" }));
    const back = deserializeProject(serializeProject(p));
    expect(back.tracks.map((t) => t.audioRole)).toEqual(["dialogue", "music", undefined]);
  });

  it("round-trips a muted clip's mute state (omitting it when the clip is audible)", () => {
    resetIds();
    const p = emptyProject("Mix", 0, SR);
    const t = newTrack(0);
    const muted = newClip(sine(440, 0.02, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: t.id, name: "muted", start: 0, muted: true });
    const audible = newClip(sine(440, 0.02, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: t.id, name: "audible", start: 1 });
    t.clips.push(muted, audible);
    p.tracks.push(t);

    const back = deserializeProject(serializeProject(p));
    const clips = back.tracks[0].clips;
    expect(clips.find((c) => c.name === "muted")!.muted).toBe(true);
    expect(clips.find((c) => c.name === "audible")!.muted).toBeUndefined(); // omit-when-falsy
  });

  it("round-trips a clip's locked-in-time state (omitting it when the clip is movable)", () => {
    resetIds();
    const p = emptyProject("Mix", 0, SR);
    const t = newTrack(0);
    const locked = newClip(sine(440, 0.02, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: t.id, name: "locked", start: 0, locked: true });
    const movable = newClip(sine(440, 0.02, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: t.id, name: "movable", start: 1 });
    t.clips.push(locked, movable);
    p.tracks.push(t);

    const back = deserializeProject(serializeProject(p));
    const clips = back.tracks[0].clips;
    expect(clips.find((c) => c.name === "locked")!.locked).toBe(true);
    expect(clips.find((c) => c.name === "movable")!.locked).toBeUndefined(); // omit-when-falsy
  });

  it("round-trips a clip's looped state (omitting it when the clip plays once)", () => {
    resetIds();
    const p = emptyProject("Mix", 0, SR);
    const t = newTrack(0);
    const looped = newClip(sine(440, 0.02, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: t.id, name: "looped", start: 0, looped: true });
    const once = newClip(sine(440, 0.02, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: t.id, name: "once", start: 1 });
    t.clips.push(looped, once);
    p.tracks.push(t);

    const back = deserializeProject(serializeProject(p));
    const clips = back.tracks[0].clips;
    expect(clips.find((c) => c.name === "looped")!.looped).toBe(true);
    expect(clips.find((c) => c.name === "once")!.looped).toBeUndefined(); // omit-when-falsy
  });

  it("round-trips advanced session graph fields", () => {
    resetIds();
    const bus = newBus(0, {
      id: "bus-fx",
      effectRack: newEffectRack({ slots: [newEffectSlot("gain", { id: "fx-bus", params: { gainDb: -3 } })] }),
    });
    const t = newTrack(0, {
      id: "track-vox",
      outputId: bus.id,
      sends: [newSend(bus.id, { id: "send-1", gainDb: -9 })],
      automation: [newAutomationLane({ id: "auto-track", target: { kind: "gainDb" }, points: [{ time: 0, value: -6 }] })],
    });
    const clip = newClip(sine(440, 0.02, { sampleRate: SR, amplitude: 0.5, channels: 2 }), {
      trackId: t.id,
      effectRack: newEffectRack({ slots: [newEffectSlot("invertPolarity", { id: "fx-clip" })] }),
    });
    t.clips.push(clip);
    const p = {
      ...emptyProject("Advanced", 0, SR),
      tracks: [t],
      buses: [bus],
      masterEffectRack: newEffectRack({ slots: [newEffectSlot("gain", { id: "fx-master", params: { gainDb: -1 } })] }),
      masterAutomation: [newAutomationLane({ id: "auto-master", target: { kind: "gainDb" }, points: [{ time: 0, value: 0 }] })],
    };

    const back = deserializeProject(serializeProject(p));
    expect(back.tracks[0].outputId).toBe("bus-fx");
    expect(back.tracks[0].sends?.[0].gainDb).toBe(-9);
    expect(back.tracks[0].automation?.[0].id).toBe("auto-track");
    expect(back.tracks[0].clips[0].effectRack?.slots[0].kind).toBe("invertPolarity");
    expect(back.buses?.[0].effectRack?.slots[0].params.gainDb).toBe(-3);
    expect(back.masterEffectRack?.slots[0].params.gainDb).toBe(-1);
    expect(back.masterAutomation?.[0].id).toBe("auto-master");
  });

  it("keeps foreign entries and unknown manifest fields through a save (courier, rule 2)", () => {
    const foreign = createContainer({ name: "monet-vision", version: "0.1.0" }, "graphics");
    (foreign.manifest as Record<string, unknown>).futureManifestKnob = 7;
    setEntry(foreign, "pixels/1.png", "pixels", new Uint8Array([137, 80, 78, 71, 1, 2, 3]));

    const { project, ignored } = readProject(writeContainer(foreign));
    expect(ignored).toEqual(["pixels/1.png"]);
    expect(project.tracks).toHaveLength(0); // no timeline entry — not an error

    const back = readContainer(serializeProject(project));
    expect(getEntry(back, "pixels/1.png")).toEqual(new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
    expect(back.manifest.futureManifestKnob).toBe(7);
    expect(back.manifest.kind).toBe("graphics"); // the primary payload is still Vision's
    expect(back.manifest.app.name).toBe("monet-rythme"); // …but Rythme wrote it last
    expect(back.manifest.entries.map((e) => e.path)).toContain("timeline.json");
  });

  it("writes PCM as real audio/* entries, not base64 inside the timeline", () => {
    const p = emptyProject("Entries", 0, SR);
    const t = newTrack(0);
    t.clips.push(newClip(sine(440, 0.02, { sampleRate: SR, amplitude: 0.5 }), { trackId: t.id, name: "take" }));
    p.tracks.push(t);

    const c = readContainer(serializeProject(p));
    const audio = c.manifest.entries.filter((e) => e.role === "audio");
    expect(audio).toHaveLength(1);
    expect(audio[0].path).toMatch(/^audio\/.+\.wav$/);
    expect(sniffFormat(getEntry(c, audio[0].path)!)).toBe("wav");
    expect(new TextDecoder().decode(getEntry(c, "timeline.json")!)).not.toContain("embed");
  });

  it("rejects bytes that are not a Monet container", () => {
    expect(() => deserializeProject(new TextEncoder().encode(JSON.stringify({ format: "nope" })))).toThrow();
  });

  it("cross-opens a frames-based (Cinema) timeline by converting to seconds", () => {
    const cinema = JSON.stringify({
      format: "monet",
      schemaVersion: 1,
      app: { name: "monet-cinema", version: "0.1.0" },
      document: {
        name: "FilmCut",
        defaults: { fps: 24 },
        media: [],
        sequences: [
          {
            id: "s1",
            name: "Seq",
            timeBase: { kind: "frames", fps: 24 },
            settings: { width: 1920, height: 1080 },
            tracks: [{ id: "A1", kind: "audio", clips: [{ id: "c1", name: "dlg", start: 48, duration: 24, inPoint: 0, speed: 1, enabled: true, data: { cinema: { audioGain: -3 } } }] }],
          },
        ],
        activeSequenceId: "s1",
      },
    });
    const p = deserializeProject(foreignTimeline(cinema));
    expect(p.name).toBe("FilmCut");
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0].clips[0].start).toBe(2); // 48f / 24fps → seconds
    expect(p.tracks[0].clips[0].duration).toBe(1);
  });

  it("cross-opens frames-based video tracks as reference picture tracks", () => {
    const cinema = JSON.stringify({
      format: "monet",
      schemaVersion: 1,
      app: { name: "monet-cinema", version: "0.1.0" },
      document: {
        name: "FilmCut",
        defaults: { fps: 24, width: 1920, height: 1080 },
        media: [{ id: "m-video", name: "plate.mov", kind: "video", source: { path: "/plates/plate.mov" }, duration: { frames: 240, fps: 24 }, width: 1920, height: 1080, hasAudio: true }],
        sequences: [
          {
            id: "s1",
            name: "Seq",
            timeBase: { kind: "frames", fps: 24 },
            settings: { width: 1920, height: 1080 },
            tracks: [{ id: "V1", kind: "video", clips: [{ id: "vc1", mediaId: "m-video", name: "plate", start: 48, duration: 72, inPoint: 24, speed: 1, enabled: true }] }],
          },
        ],
        activeSequenceId: "s1",
      },
    });
    const p = deserializeProject(foreignTimeline(cinema));
    expect(p.videoAssets?.[0]).toMatchObject({ id: "m-video", sourcePath: "/plates/plate.mov", duration: 10, width: 1920, height: 1080 });
    expect(p.videoTracks?.[0].clips[0]).toMatchObject({ id: "vc1", start: 2, duration: 3, inPoint: 1, assetId: "m-video" });
    expect(p.tracks).toHaveLength(0);
  });
});

describe("format sniffing & dispatch", () => {
  it("sniffs WAV and AIFF magic", () => {
    expect(sniffFormat(encodeWav(sine(440, 0.01, { sampleRate: SR })))).toBe("wav");
    expect(sniffFormat(encodeAiff(sine(440, 0.01, { sampleRate: SR })))).toBe("aiff");
    expect(sniffFormat(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toBe("unknown");
  });

  it("decodeAudio dispatches on magic", () => {
    const wav = encodeWav(sine(440, 0.02, { sampleRate: SR }), { bitDepth: 16 });
    expect(frameCount(decodeAudio(wav, "x.wav"))).toBeGreaterThan(0);
  });

  it("encodeAudio picks format from the file name", () => {
    const d = sine(440, 0.01, { sampleRate: SR });
    expect(sniffFormat(encodeAudio(d, "out.aiff"))).toBe("aiff");
    expect(sniffFormat(encodeAudio(d, "out.wav"))).toBe("wav");
  });
});
