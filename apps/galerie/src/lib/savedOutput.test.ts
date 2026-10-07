// GAL-LIB-17: saving a Print/Book/Slideshow/Web layout must leave a "Saved …"
// collection behind — a normal manual collection whose rule field carries the
// module + layout, so the Collections panel can badge it and the module can
// reopen it. Pins the marker round-trip, the rejection of every other rule-field
// tenant (smart rules, publish services, junk), and the create path.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createCollection = vi.fn<(...args: unknown[]) => Promise<number | null>>(async () => 12);
const addToCollection = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

vi.mock("../state/store", () => ({
  store: { createCollection, addToCollection, notify: vi.fn() },
  useCatalogSelector: vi.fn(),
}));
vi.mock("../export", () => ({ exportWebGallery: vi.fn() }));

import type { CollectionRow } from "../catalog/types";
import { publishServiceMarker } from "./publishService";

// Dynamic, so the store mock above is in place before the module reads it.
const {
  createSavedOutput,
  findSavedOutputs,
  parseSavedOutput,
  savedOutputMarker,
  savedOutputModule,
} = await import("./savedOutput");
const { sanitizeGalleryOptions } = await import("../ui/WebGalleryDialog");
const { DEFAULT_WEB_GALLERY_OPTIONS } = await import("./webGallery");

const row = (over: Partial<CollectionRow>): CollectionRow => ({
  id: 1,
  name: "Iceland",
  kind: "collection",
  parentId: null,
  ruleAst: null,
  sortOrder: 0,
  createdAt: 0,
  ...over,
});

beforeEach(() => {
  createCollection.mockClear().mockResolvedValue(12);
  addToCollection.mockClear();
});

describe("saved-output marker", () => {
  it("round-trips the module and its layout blob", () => {
    const parsed = parseSavedOutput(savedOutputMarker("web", { site: { siteTitle: "Iceland" } }));
    expect(parsed?.module).toBe("web");
    expect(parsed?.config).toEqual({ site: { siteTitle: "Iceland" } });
  });

  it("rejects every other tenant of the rule field", () => {
    expect(parseSavedOutput(null)).toBeNull();
    expect(parseSavedOutput("not json")).toBeNull();
    expect(parseSavedOutput(JSON.stringify({ match: "all", rules: [] }))).toBeNull(); // smart rule
    expect(parseSavedOutput(publishServiceMarker({ dir: "/out", format: "jpeg", quality: 0.8, longEdge: null }))).toBeNull();
    // A marker naming a module this build doesn't have is not an output either.
    expect(parseSavedOutput(JSON.stringify({ monetSystemCollection: "saved-output", output: "video" }))).toBeNull();
  });

  it("only treats manual collections as saved outputs", () => {
    const ruleAst = savedOutputMarker("print", null);
    expect(savedOutputModule(row({ ruleAst }))).toBe("print");
    expect(savedOutputModule(row({ kind: "smart", ruleAst }))).toBeNull();
    expect(savedOutputModule(row({}))).toBeNull();
  });

  it("lists one module's saved outputs in tree order", () => {
    const rows = [
      row({ id: 1, name: "Plain" }),
      row({ id: 2, name: "Trip Show", ruleAst: savedOutputMarker("slideshow", { durationMs: 9000 }) }),
      row({ id: 3, name: "Trip Web", ruleAst: savedOutputMarker("web", null) }),
      row({ id: 4, name: "Wedding Show", ruleAst: savedOutputMarker("slideshow", null) }),
    ];
    expect(findSavedOutputs(rows, "slideshow").map((s) => s.row.id)).toEqual([2, 4]);
    expect(findSavedOutputs(rows, "slideshow")[0].config).toEqual({ durationMs: 9000 });
    expect(findSavedOutputs(rows, "web").map((s) => s.row.name)).toEqual(["Trip Web"]);
  });
});

// The layout comes back off the catalog row, so it is untrusted persisted data:
// galleryHtml/galleryExportOpts call .trim()/arithmetic on these fields.
describe("sanitizeGalleryOptions", () => {
  it("fills in the knobs a gallery saved by an older build is missing", () => {
    const opts = sanitizeGalleryOptions({ site: { siteTitle: "Iceland" }, imageInfo: "caption" });
    expect(opts.site.siteTitle).toBe("Iceland");
    expect(opts.site.description).toBe("");
    expect(opts.imageInfo).toBe("caption");
    expect(opts.appearance).toEqual(DEFAULT_WEB_GALLERY_OPTIONS.appearance);
  });

  it("replaces values of the wrong type rather than letting them reach the writer", () => {
    const opts = sanitizeGalleryOptions({
      site: 7,
      imageInfo: "javascript:",
      output: { quality: "nine", longEdge: Number.NaN },
    });
    expect(opts.site.siteTitle).toBe("");
    expect(opts.imageInfo).toBe("title");
    expect(opts.output.quality).toBe(DEFAULT_WEB_GALLERY_OPTIONS.output.quality);
    expect(opts.output.longEdge).toBe(DEFAULT_WEB_GALLERY_OPTIONS.output.longEdge);
  });
});

describe("createSavedOutput", () => {
  it("creates a tagged collection and fills it with the photos", async () => {
    const id = await createSavedOutput("  Trip Show  ", "slideshow", [3, 4], { durationMs: 9000 });
    expect(id).toBe(12);
    const [name, kind, ruleAst] = createCollection.mock.calls[0];
    expect(name).toBe("Trip Show");
    expect(kind).toBe("collection");
    expect(parseSavedOutput(ruleAst as string)).toEqual({
      module: "slideshow",
      config: { durationMs: 9000 },
    });
    expect(addToCollection).toHaveBeenCalledWith(12, [3, 4]);
  });

  it("refuses a blank name and reports a refused create", async () => {
    expect(await createSavedOutput("   ", "web", [1], null)).toBeNull();
    expect(createCollection).not.toHaveBeenCalled();

    createCollection.mockResolvedValue(null);
    expect(await createSavedOutput("Trip", "web", [1], null)).toBeNull();
    expect(addToCollection).not.toHaveBeenCalled();
  });
});
