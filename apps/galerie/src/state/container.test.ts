// container.test — the `.mgal` half of the store (docs/plans/11-universal-
// container.md). The zip + SQLite work is native and proven in Rust
// (src-tauri/src/catalog.rs); what is checked here is the part a user meets:
// dispatch happens on the manifest the native side reports, and whatever
// Galerie could not read is said OUT LOUD instead of swallowed.

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => true),
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock("../catalog/catalog", () => ({
  catalogAvailable: () => true,
  openCatalog: vi.fn(async () => 1),
  listPhotos: vi.fn(async () => ({ photos: [], next: null })),
  countPhotos: vi.fn(async () => 0),
  listCollections: vi.fn(async () => []),
  listCollectionPhotos: vi.fn(async () => []),
  listKeywords: vi.fn(async () => []),
  listFolders: vi.fn(async () => []),
  listFilterOptions: vi.fn(async () => ({ cameras: [], lenses: [], years: [] })),
}));

import { invoke } from "@tauri-apps/api/core";
import { CatalogStore, containerOpenSummary, type OpenedContainer } from "./store";

const opened = (over: Partial<OpenedContainer> = {}): OpenedContainer => ({
  schemaVersion: 13,
  working: "/tmp/monet-galerie-containers/open-1/database.sqlite",
  ignored: [],
  app: "monet-galerie",
  kind: "catalog",
  ...over,
});

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

it("names every entry it ignored, so a foreign container reports what it kept", () => {
  const summary = containerOpenSummary(
    "/docs/Session.mryt",
    opened({ app: "monet-rythme", kind: "time", ignored: ["timeline.json (time)", "audio/1.wav (audio)"] }),
  );
  expect(summary).toContain("Session.mryt");
  expect(summary).toContain("monet-rythme");
  expect(summary).toContain("timeline.json (time)");
  expect(summary).toContain("audio/1.wav (audio)");
});

it("summarizes rather than listing when a container ignores a great many entries", () => {
  const ignored = Array.from({ length: 12 }, (_, i) => `previews/${i}.jpg (preview)`);
  const summary = containerOpenSummary("/docs/Big.mgal", opened({ ignored }));
  expect(summary).toContain("previews/0.jpg (preview)");
  expect(summary).not.toContain("previews/11.jpg (preview)");
  expect(summary).toContain("+8 more");
});

it("reports a container with no catalog as a document, not as a failure", () => {
  const summary = containerOpenSummary(
    "/docs/Take.mryt",
    opened({ schemaVersion: null, working: null, app: "monet-rythme", kind: "time", ignored: ["timeline.json (time)"] }),
  );
  expect(summary).toContain("carries no catalog");
  expect(summary).toContain("time document");
});

it("opens the catalog a container carries and points the store at the working copy", async () => {
  const report = opened({ app: "monet-cinema", kind: "time", ignored: ["media/a.mov (media)"] });
  vi.mocked(invoke).mockImplementation(async (cmd) =>
    cmd === "plugin:catalog|catalog_open_container" ? report : undefined,
  );
  const store = new CatalogStore();

  // A `.mcin` renamed `.mvis` still opens: nothing here looks at the name.
  expect(await store.openContainer("/docs/renamed.mvis")).toBe(true);
  expect(invoke).toHaveBeenCalledWith("plugin:catalog|catalog_open_container", {
    path: "/docs/renamed.mvis",
  });
  expect(store.getState().catalogPath).toBe(report.working);
  expect(store.getState().ready).toBe(true);
  // Rule 1: the report is on screen, not in the console.
  expect(store.getState().notice).toContain("media/a.mov (media)");
});

it("leaves the open catalog alone when a container carries none", async () => {
  vi.mocked(invoke).mockImplementation(async (cmd) =>
    cmd === "plugin:catalog|catalog_open_container"
      ? opened({ schemaVersion: null, working: null, app: "monet-jouer", kind: "scene" })
      : undefined,
  );
  const store = new CatalogStore();

  expect(await store.openContainer("/docs/world.mjou")).toBe(false);
  expect(store.getState().catalogPath).toBeNull();
  expect(store.getState().ready).toBe(false);
  expect(store.getState().error).toBeNull(); // not an error — a document
  expect(store.getState().notice).toContain("carries no catalog");
});

it("refuses to save a container with no catalog open, and says so", async () => {
  const store = new CatalogStore();
  expect(await store.saveContainer("/docs/out.mgal")).toBe(false);
  expect(invoke).not.toHaveBeenCalledWith("plugin:catalog|catalog_save_container", expect.anything());
  expect(store.getState().notice).toContain("Open a catalog");
});

it("saves the open catalog into the container the user named", async () => {
  vi.mocked(invoke).mockImplementation(async (cmd) =>
    cmd === "plugin:catalog|catalog_open_container" ? opened() : undefined,
  );
  const store = new CatalogStore();
  await store.openContainer("/docs/in.mgal");

  expect(await store.saveContainer("/docs/out.mgal")).toBe(true);
  expect(invoke).toHaveBeenCalledWith("plugin:catalog|catalog_save_container", {
    path: "/docs/out.mgal",
  });
});

it("surfaces a native save failure instead of reporting success", async () => {
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "plugin:catalog|catalog_open_container") return opened();
    if (cmd === "plugin:catalog|catalog_save_container") throw new Error("disk full");
    return undefined;
  });
  const store = new CatalogStore();
  await store.openContainer("/docs/in.mgal");

  expect(await store.saveContainer("/docs/out.mgal")).toBe(false);
  expect(store.getState().notice).toContain("disk full");
});
