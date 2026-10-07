import { describe, expect, it } from "vitest";
import { createContainer, getEntry, setEntry, writeContainer } from "@monet-ui/monet-format";
import { createClip, createProject, resetIds } from "../model/factory";
import { activeSequence } from "../model/query";
import type { MediaItem } from "../model/types";
import { projectFromContainer, projectFromJson, projectToContainer, projectToJson } from "./cinema";

describe("cinema project IO", () => {
  it("round-trips a project through JSON", () => {
    resetIds();
    const p = createProject("Doc");
    const seq = activeSequence(p)!;
    seq.tracks[0].clips.push(createClip({ name: "a", kind: "video", start: 0, duration: 48, inPoint: 5 }));
    const json = projectToJson(p);
    const back = projectFromJson(json);
    expect(back.name).toBe("Doc");
    expect(activeSequence(back)!.tracks[0].clips[0].inPoint).toBe(5);
    expect(back.activeSequenceId).toBe(p.activeSequenceId);
  });

  it("strips runtime-only media fields on save", () => {
    const p = createProject("M");
    const m: MediaItem = {
      id: "media_x",
      name: "clip.mov",
      path: "/x.mov",
      kind: "video",
      durationFrames: 100,
      fps: 24,
      width: 1920,
      height: 1080,
      hasAudio: true,
      objectUrl: "blob:should-not-persist",
      thumb: "data:...",
      ready: true,
    };
    p.media.push(m);
    const json = projectToJson(p);
    expect(json).not.toContain("blob:should-not-persist");
    expect(json).not.toContain("data:...");
    const back = projectFromJson(json);
    expect(back.media[0].objectUrl).toBeUndefined();
    expect(back.media[0].ready).toBe(false);
    expect(back.media[0].durationFrames).toBe(100);
  });

  it("persists a resolvable media path for the relink pass", () => {
    const p = createProject("P");
    p.media.push({
      id: "media_p",
      name: "take.mov",
      path: "/Users/x/Movies/take.mov",
      kind: "video",
      durationFrames: 48,
      fps: 24,
      width: 1920,
      height: 1080,
      hasAudio: true,
    });
    const back = projectFromJson(projectToJson(p));
    expect(back.media[0].path).toBe("/Users/x/Movies/take.mov");
  });

  it("repairs a dangling active-sequence pointer", () => {
    const p = createProject("R");
    p.activeSequenceId = "does-not-exist";
    const back = projectFromJson(projectToJson(p));
    expect(back.activeSequenceId).toBe(p.sequences[0].id);
  });
});

describe("cinema container IO", () => {
  it("writes a v1 `time` container Cinema reads back", () => {
    const p = createProject("Doc");
    const opened = projectFromContainer(projectToContainer(p));
    expect(opened.container.manifest.kind).toBe("time");
    expect(opened.container.manifest.app.name).toBe("monet-cinema");
    expect(opened.project?.name).toBe("Doc");
    expect(opened.ignored).toEqual([]);
  });

  it("opens a graphics container as a document with no timeline, keeping its entries", () => {
    const c = createContainer({ name: "monet-vision", version: "0.1.0" }, "graphics");
    setEntry(c, "graphics.json", "graphics", new TextEncoder().encode("{}"));

    const opened = projectFromContainer(writeContainer(c));
    expect(opened.project).toBeNull();
    expect(opened.ignored).toEqual(["graphics.json"]);
  });

  it("couriers every entry and manifest field it did not consume", () => {
    // A Rythme container: our timeline entry plus payload + fields Cinema knows nothing about.
    const c = createContainer({ name: "monet-rythme", version: "0.1.0" }, "time");
    c.manifest.mixdown = { master: -3 }; // unknown manifest field (rule 3)
    setEntry(c, "timeline.json", "time", new TextEncoder().encode(projectToJson(createProject("Song"))));
    setEntry(c, "audio/1.pcm", "audio", new Uint8Array([1, 2, 3, 4]));

    const opened = projectFromContainer(writeContainer(c));
    expect(opened.ignored).toEqual(["audio/1.pcm"]);

    // Re-save through Cinema: our entry is replaced, everything else survives.
    const back = projectFromContainer(projectToContainer(opened.project!, opened.container));
    expect(getEntry(back.container, "audio/1.pcm")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(back.container.manifest.mixdown).toEqual({ master: -3 });
    expect(back.container.manifest.app.name).toBe("monet-cinema");
    expect(back.project?.name).toBe("Song");
  });

  it("replaces a foreign timeline entry in place instead of adding a second one", () => {
    const c = createContainer({ name: "monet-anime", version: "0.1.0" }, "time");
    setEntry(c, "time/main.json", "time", new TextEncoder().encode(projectToJson(createProject("Anim"))));

    const opened = projectFromContainer(writeContainer(c));
    const back = projectFromContainer(projectToContainer(opened.project!, opened.container));
    expect(back.container.manifest.entries.filter((e) => e.role === "time").map((e) => e.path)).toEqual(["time/main.json"]);
  });
});
