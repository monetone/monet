// Drop routing + container dispatch: a dropped Monet container must open as the
// document — whatever its extension says — and everything else must land in the
// bin. files.ts pulls in the app singletons (engine client, collab) and the
// video exporter; none of that is needed here. The container io is real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContainer, setEntry, writeContainer } from "@monet-ui/monet-format";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("../state/app", () => ({
  engine: {},
  store: {
    replaceProject: vi.fn(),
    getProject: vi.fn(() => ({ name: "T", media: [] })),
    markSaved: vi.fn(),
  },
}));
vi.mock("../playback/export", () => ({ exportVideo: vi.fn() }));
vi.mock("../media/resolve", () => ({ relinkProjectMedia: vi.fn() }));
vi.mock("../media/import", () => ({ importFromPath: vi.fn(), importFromUrl: vi.fn() }));

import { importFromUrl } from "../media/import";
import { store } from "../state/app";
import { createProject } from "../timeline/model/factory";
import { projectToJson } from "../timeline/io/cinema";
import { isProjectFile, openDroppedFiles } from "./files";

const file = (name: string, bytes: Uint8Array | string) => new File([bytes as BlobPart], name);

/** A container written by `app`, with our timeline plus any extra entries. */
function container(app: string, name: string, extra: Array<[string, string]> = []): Uint8Array {
  const c = createContainer({ name: app as "monet-cinema", version: "0.1.0" }, "time");
  setEntry(c, "timeline.json", "time", new TextEncoder().encode(projectToJson(createProject(name))));
  for (const [path, role] of extra) setEntry(c, path, role, new Uint8Array([1, 2, 3]));
  return writeContainer(c);
}

/** files.ts reports visibly (a DOM live region); vitest runs in node, so stand
 *  in the two calls `notify` makes and read the text back. */
const notices: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  notices.length = 0;
  globalThis.URL.createObjectURL = vi.fn(() => "blob:test");
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ setAttribute() {}, style: {}, remove() {} }),
    body: { append: (el: { textContent: string }) => notices.push(el.textContent) },
  };
});

describe("isProjectFile", () => {
  it("matches every Monet container extension, not media", () => {
    expect(["a.mcin", "b.MRYT", "c.mvis", "d.mart", "e.mgal", "f.mani", "g.mjou"].every(isProjectFile)).toBe(true);
    expect(["h.monet", "i.json", "clip.mov", "song.wav", "still.png", "noext"].some(isProjectFile)).toBe(false);
  });
});

describe("openDroppedFiles", () => {
  it("opens a dropped container and imports the rest as media", async () => {
    await openDroppedFiles([file("clip.mov", ""), file("show.mcin", container("monet-cinema", "Show"))]);

    expect(vi.mocked(store.replaceProject).mock.calls[0]?.[0]).toMatchObject({ name: "Show" });
    expect(importFromUrl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(importFromUrl).mock.calls[0]?.[0]).toBe("clip.mov");
  });

  it("dispatches on the manifest, not the extension", async () => {
    // A Rythme container renamed `.mvis`: still a time document, so it opens.
    await openDroppedFiles([file("song.mvis", container("monet-rythme", "Song", [["audio/1.pcm", "audio"]]))]);

    expect(vi.mocked(store.replaceProject).mock.calls[0]?.[0]).toMatchObject({ name: "Song" });
    // Rule 1: what we ignored is reported to the user, not just the console.
    expect(notices.join("\n")).toContain("audio/1.pcm");
  });

  it("reports a non-container instead of opening it", async () => {
    await openDroppedFiles([file("fake.mcin", '{"name":"nope"}')]);

    expect(store.replaceProject).not.toHaveBeenCalled();
    expect(notices.join("\n")).toContain("not a Monet document");
  });

  it("leaves the document alone for a media-only drop", async () => {
    await openDroppedFiles([file("a.mov", ""), file("b.wav", "")]);

    expect(store.replaceProject).not.toHaveBeenCalled();
    expect(importFromUrl).toHaveBeenCalledTimes(2);
  });
});
