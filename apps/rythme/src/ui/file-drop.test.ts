// ─────────────────────────────────────────────────────────────
// ui/file-drop.test — dropped paths/files land in the session
// ─────────────────────────────────────────────────────────────
// App.tsx feeds useFileDrop's payload through readPaths/readFiles into
// openDroppedFiles. The two halves under test are the path[] → PickedFile[]
// adapter (a dropped folder must not kill the whole drop) and the routing:
// a .monet replaces the session, audio imports as a track, and a drop that
// lands nothing must say so instead of looking like it worked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as E from "../engine";
import { RythmeStore, emptyProject } from "../engine";
import { readPaths } from "./io-web";
import { openDroppedFiles } from "./commands";

const message = vi.fn();
vi.mock("@monet-ui/monet-react", () => ({
  openFile: vi.fn(),
  saveFile: vi.fn(),
  message: (...args: unknown[]) => message(...args),
}));

const readFile = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: (...args: unknown[]) => readFile(...args),
  writeFile: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function wavBytes(seconds = 0.1): Uint8Array {
  return E.IO.encodeWav(E.silentBuffer(seconds));
}

describe("readPaths (native drop payload)", () => {
  it("adapts paths into PickedFile[] with basename + real bytes", async () => {
    readFile.mockImplementation(async (p: string) => new Uint8Array([p.length]));

    expect(await readPaths(["/tmp/a.wav", "/tmp/sub/b.aiff"])).toEqual([
      { name: "a.wav", bytes: new Uint8Array(["/tmp/a.wav".length]) },
      { name: "b.aiff", bytes: new Uint8Array(["/tmp/sub/b.aiff".length]) },
    ]);
  });

  it("skips an unreadable path (a dropped folder) instead of failing the drop", async () => {
    readFile.mockImplementation(async (p: string) => {
      if (p === "/tmp/folder") throw new Error("EISDIR");
      return new Uint8Array([7]);
    });

    expect(await readPaths(["/tmp/folder", "/tmp/ok.wav"])).toEqual([
      { name: "ok.wav", bytes: new Uint8Array([7]) },
    ]);
  });
});

describe("openDroppedFiles", () => {
  it("imports dropped audio as a track", async () => {
    const store = new RythmeStore(emptyProject("Untitled", 0));

    expect(await openDroppedFiles(store, [{ name: "Take 1.wav", bytes: wavBytes() }])).toBe(1);

    const tracks = store.getState().project.tracks;
    expect(tracks).toHaveLength(1);
    expect(tracks[0].name).toBe("Take 1");
    expect(tracks[0].clips).toHaveLength(1);
    expect(message).not.toHaveBeenCalled();
  });

  it("a dropped container replaces the session (whatever it is named), and wins over loose audio", async () => {
    const store = new RythmeStore(emptyProject("Untitled", 0));
    // Named `.mcin`, sniffed as a container: dispatch is on the bytes, not the name.
    const bytes = E.IO.serializeProject(emptyProject("Dropped Session", 2));

    expect(
      await openDroppedFiles(store, [
        { name: "Take 1.wav", bytes: wavBytes() },
        { name: "Dropped Session.mcin", bytes },
      ]),
    ).toBe(1);

    expect(store.getState().project.name).toBe("Dropped Session");
    expect(store.getState().project.tracks).toHaveLength(2);
    expect(store.getState().dirty).toBe(false);
  });

  it("reports a drop it cannot open rather than silently doing nothing", async () => {
    const store = new RythmeStore(emptyProject("Untitled", 0));

    expect(await openDroppedFiles(store, [{ name: "artwork.psd", bytes: new Uint8Array([1]) }])).toBe(0);

    expect(store.getState().project.tracks).toHaveLength(0);
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining("artwork.psd"),
      expect.objectContaining({ kind: "error" }),
    );
  });

  it("reports a corrupt session instead of leaving an empty Untitled session", async () => {
    const store = new RythmeStore(emptyProject("Keep Me", 1));

    expect(
      await openDroppedFiles(store, [{ name: "broken.mryt", bytes: new TextEncoder().encode("{oops") }]),
    ).toBe(0);

    expect(store.getState().project.name).toBe("Keep Me");
    expect(message).toHaveBeenCalledWith(
      expect.stringContaining("broken.mryt"),
      expect.objectContaining({ kind: "error" }),
    );
  });
});
