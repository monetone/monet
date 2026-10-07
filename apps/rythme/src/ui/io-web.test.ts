// ─────────────────────────────────────────────────────────────
// ui/io-web.test — native file IO keeps the PickedFile{name,bytes} contract
// ─────────────────────────────────────────────────────────────
// Inside Tauri, open/save go through the native dialog + plugin-fs. The four
// consumers (commands, panels) still see PickedFile{name,bytes}, so only the
// path[] → PickedFile[] adapter is under test here — plus the two failure
// modes that would silently lose work: a cancelled open must not fall through
// to the web <input> (there is no DOM here), and a cancelled save must not
// clear the session's dirty flag.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyProject, RythmeStore } from "../engine";
import { acceptToFilters, basenameOf, pickFiles, saveText } from "./io-web";
import { saveProject } from "./commands";

const openFile = vi.fn();
const saveFile = vi.fn();

vi.mock("@monet-ui/monet-react", () => ({
  openFile: (...args: unknown[]) => openFile(...args),
  saveFile: (...args: unknown[]) => saveFile(...args),
  message: vi.fn(),
  // Saves go through the shared durable write (fully-synced sibling + rename),
  // so that is the seam here rather than plugin-fs's writeFile.
  atomicWriteBytes: (...args: unknown[]) => writeFile(...args),
}));

const readFile = vi.fn();
const writeFile = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: (...args: unknown[]) => readFile(...args),
  writeFile: (...args: unknown[]) => writeFile(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // isTauriRuntime() sniffs the injected globals; stand them up for the suite.
  (globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} };
});

describe("accept list → native dialog filters", () => {
  it("keeps only .ext tokens, deduped, MIME entries dropped", () => {
    expect(acceptToFilters("audio/*,.wav,.aif,.aiff,.WAV")).toEqual([
      { name: "Supported Files", extensions: ["wav", "aif", "aiff"] },
    ]);
  });

  it("reduces a compound suffix to its real extension", () => {
    expect(acceptToFilters(".json,.rythme-shortcuts.json,application/json")).toEqual([
      { name: "Supported Files", extensions: ["json"] },
    ]);
  });

  it("yields no filter (All Files) when the accept list is MIME-only", () => {
    expect(acceptToFilters("audio/*")).toEqual([]);
  });
});

describe("basenameOf", () => {
  it("takes the last segment on either separator", () => {
    expect(basenameOf("/Users/a/Music/Take 1.wav")).toBe("Take 1.wav");
    expect(basenameOf("C:\\Users\\a\\Take 1.wav")).toBe("Take 1.wav");
    expect(basenameOf("Take 1.wav")).toBe("Take 1.wav");
  });
});

describe("pickFiles (native)", () => {
  it("adapts the picked path[] into PickedFile[] with basename + real bytes", async () => {
    openFile.mockResolvedValue(["/tmp/a.wav", "/tmp/sub/b.aiff"]);
    readFile.mockImplementation(async (p: string) => new Uint8Array([p.length]));

    const files = await pickFiles("audio/*,.wav,.aiff");

    expect(openFile).toHaveBeenCalledWith({
      multiple: true,
      filters: [{ name: "Supported Files", extensions: ["wav", "aiff"] }],
    });
    expect(files).toEqual([
      { name: "a.wav", bytes: new Uint8Array(["/tmp/a.wav".length]) },
      { name: "b.aiff", bytes: new Uint8Array(["/tmp/sub/b.aiff".length]) },
    ]);
  });

  it("wraps a single (multiple:false) selection in an array", async () => {
    openFile.mockResolvedValue("/tmp/session.monet");
    readFile.mockResolvedValue(new Uint8Array([1, 2]));

    expect(await pickFiles(".monet,.rythme,application/json", false)).toEqual([
      { name: "session.monet", bytes: new Uint8Array([1, 2]) },
    ]);
  });

  it("returns [] on cancel instead of falling back to the web <input>", async () => {
    openFile.mockResolvedValue(null);
    // The node test env has no `document`; a fallback would throw, not resolve.
    expect(await pickFiles(".csv,text/csv", false)).toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("saveText (native)", () => {
  it("writes the chosen path and reports success", async () => {
    saveFile.mockResolvedValue("/tmp/out.monet");

    expect(await saveText("Untitled.monet", "{}")).toBe(true);
    expect(saveFile).toHaveBeenCalledWith({ defaultPath: "Untitled.monet" });
    expect(writeFile).toHaveBeenCalledWith("/tmp/out.monet", new TextEncoder().encode("{}"));
  });

  it("reports failure on cancel and writes nothing", async () => {
    saveFile.mockResolvedValue(null);

    expect(await saveText("Untitled.monet", "{}")).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("saveProject", () => {
  it("clears the dirty flag only when the bytes actually landed", async () => {
    const store = new RythmeStore(emptyProject());
    store.replaceProject(emptyProject("Untitled", 4)); // no markClean ⇒ dirty
    expect(store.getState().dirty).toBe(true);

    saveFile.mockResolvedValue(null);
    expect(await saveProject(store)).toBe(false);
    expect(store.getState().dirty).toBe(true);

    saveFile.mockResolvedValue("/tmp/session.monet");
    expect(await saveProject(store)).toBe(true);
    expect(store.getState().dirty).toBe(false);
  });
});
