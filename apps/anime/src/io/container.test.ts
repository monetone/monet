// The container contract (docs/plans/11-universal-container.md), from Anime's
// side: it writes a v1 container with `timeline.json` role "time", it opens ANY
// Monet container by its manifest, and — the rule everything else rests on — it
// hands back every entry and manifest field it did not consume, byte-for-byte.

import { describe, expect, it } from "vitest";
import {
  CONTAINER_SCHEMA_VERSION,
  createContainer,
  getEntry,
  isContainer,
  readContainer,
  setEntry,
  writeContainer,
  type MonetContainer,
} from "@monet-ui/monet-format";
import { createProject } from "../model/factory";
import { newContainer, projectFromContainer, projectToContainer } from "./anime";

const bytesOf = (s: string) => new TextEncoder().encode(s);

/** A Vision document, as another app writes it: graphics + pixels, an unknown
 *  top-level manifest field and an unknown per-entry field (forward-compat). */
function visionContainer(): MonetContainer {
  const c = createContainer({ name: "monet-vision", version: "9.9.9" }, "graphics");
  setEntry(c, "graphics.json", "graphics", bytesOf('{"layers":[{"id":"L1"}]}'));
  setEntry(c, "pixels/1.png", "pixels", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  c.manifest.entries[1].colorSpace = "display-p3"; // unknown entry field
  c.manifest.vendorNotes = { retouchedBy: "someone" }; // unknown manifest field
  return c;
}

describe("Anime writes a v1 container", () => {
  const bytes = projectToContainer(createProject("Round Trip"), newContainer());

  it("is a container whose manifest says monet-anime / time", () => {
    expect(isContainer(bytes)).toBe(true);
    const { manifest } = readContainer(bytes);
    expect(manifest.format).toBe("monet");
    expect(manifest.schemaVersion).toBe(CONTAINER_SCHEMA_VERSION);
    expect(manifest.app).toEqual({ name: "monet-anime", version: "0.1.0" });
    expect(manifest.kind).toBe("time");
    expect(manifest.entries).toEqual([{ path: "timeline.json", role: "time" }]);
  });

  it("round-trips the project through it", () => {
    const { project, hasTimeline, ignored } = projectFromContainer(bytes);
    expect(hasTimeline).toBe(true);
    expect(ignored).toEqual([]);
    expect(project.name).toBe("Round Trip");
    expect(project.compositions[0].layers.map((l) => l.name)).toEqual(["Title", "Badge"]);
  });

  it("re-saves byte-identically", () => {
    const { project, container } = projectFromContainer(bytes);
    expect(Array.from(projectToContainer(project, container))).toEqual(Array.from(bytes));
  });
});

describe("opening another app's container", () => {
  const source = writeContainer(visionContainer());
  const opened = projectFromContainer(source);

  it("dispatches on the manifest, not the extension — a .mvis opens", () => {
    // Nothing here ever saw a file name; the bytes alone decide.
    expect(opened.hasTimeline).toBe(false);
    expect(opened.ignored).toEqual(["graphics.json", "pixels/1.png"]);
    // …and it opens to an empty comp rather than throwing: no timeline is not
    // an error, it is a document with nothing for Anime to show.
    expect(opened.project.compositions).toHaveLength(1);
    expect(opened.project.compositions[0].layers).toEqual([]);
  });

  it("couriers every foreign entry and manifest field on save", () => {
    const resaved = readContainer(projectToContainer(opened.project, opened.container));

    // Foreign payloads, byte for byte.
    expect(getEntry(resaved, "graphics.json")).toEqual(bytesOf('{"layers":[{"id":"L1"}]}'));
    expect(getEntry(resaved, "pixels/1.png")).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    // Unknown manifest fields, top-level and per-entry.
    expect(resaved.manifest.vendorNotes).toEqual({ retouchedBy: "someone" });
    expect(resaved.manifest.entries.find((e) => e.path === "pixels/1.png")).toEqual({
      path: "pixels/1.png",
      role: "pixels",
      colorSpace: "display-p3",
    });
    // Anime wrote it last, but graphics is still its primary payload.
    expect(resaved.manifest.app.name).toBe("monet-anime");
    expect(resaved.manifest.kind).toBe("graphics");
    expect(resaved.manifest.entries.map((e) => e.role)).toEqual(["graphics", "pixels", "time"]);
  });

  it("survives a full Vision → Anime → Vision trip unchanged apart from ours", () => {
    const round = readContainer(projectToContainer(opened.project, opened.container));
    const first = readContainer(source);
    for (const entry of first.entries) {
      expect(getEntry(round, entry.path)).toEqual(entry.data);
    }
  });
});

describe("a foreign time entry is replaced where it lives", () => {
  it("writes back to the source path instead of adding a second timeline", () => {
    const c = createContainer({ name: "monet-rythme", version: "0.1.0" }, "time");
    // Same role, different path — role is what a reader dispatches on.
    setEntry(c, "song/timeline.json", "time", bytesOf(projectToJsonOf("Imported")));
    setEntry(c, "audio/take.wav", "audio", Uint8Array.from([1, 2, 3]));

    const opened = projectFromContainer(writeContainer(c));
    expect(opened.hasTimeline).toBe(true);
    expect(opened.project.name).toBe("Imported");
    expect(opened.ignored).toEqual(["audio/take.wav"]);

    const resaved = readContainer(projectToContainer(opened.project, opened.container));
    expect(resaved.manifest.entries.map((e) => e.path)).toEqual(["song/timeline.json", "audio/take.wav"]);
    expect(getEntry(resaved, "audio/take.wav")).toEqual(Uint8Array.from([1, 2, 3]));
  });
});

describe("bad input", () => {
  it("refuses bytes that are not a Monet container", () => {
    expect(() => projectFromContainer(bytesOf("this is not a zip"))).toThrow();
  });
});

/** The timeline body another app would have written: our own serializer. */
function projectToJsonOf(name: string): string {
  const bytes = projectToContainer(createProject(name), newContainer());
  return new TextDecoder().decode(getEntry(readContainer(bytes), "timeline.json"));
}
