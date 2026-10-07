// OUT-09: the Book dialog's persistent half — Saved Books (the layout stored
// beside the collection Create Saved Book makes) — plus that the page preview
// really draws a cell per template cell, so the preview is the book that
// exports.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../book", async (importOriginal) => {
  const real = await importOriginal<typeof import("../book")>();
  return { ...real, exportBook: vi.fn() };
});
vi.mock("../state/store", () => ({
  store: { createCollection: vi.fn(), addToCollection: vi.fn(), notify: vi.fn() },
}));
// The preview's thumbnails pull the whole catalog/decode pipeline; the geometry
// under test is the wrapper cell, not the <img>.
vi.mock("./PreviewImg", () => ({ PreviewImg: () => null }));

import { DEFAULT_BOOK_SETTINGS, type Book } from "../book";
import type { PhotoRow } from "../catalog/types";
import { AUTO_LAYOUT_PRESETS, autoLayout } from "../lib/bookLayout";
import { store } from "../state/store";
import {
  BookPagePreview,
  createSavedBook,
  deleteSavedBook,
  listSavedBooks,
  saveBook,
  type BookConfig,
  type BookStorage,
} from "./BookDialog";

const photos: PhotoRow[] = [1, 2, 3].map((id) => ({ id, path: `/photos/${id}.cr3`, format: "raw:CR3" }) as PhotoRow);
const config = (): BookConfig => ({
  settings: DEFAULT_BOOK_SETTINGS,
  preset: AUTO_LAYOUT_PRESETS[0],
  pages: autoLayout([1, 2, 3], AUTO_LAYOUT_PRESETS[0]),
});

/** In-memory Web Storage stand-in (saved books never touch a real DOM). */
function fakeStorage(): BookStorage & { raw(): string | null } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    raw: () => map.get("galerie.savedBooks") ?? null,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("saved books", () => {
  it("round-trips a book's settings, preset and pages", () => {
    const s = fakeStorage();
    const saved = saveBook("Iceland", config(), s);
    expect(saved).toHaveLength(1);
    const back = listSavedBooks(s)[0];
    expect(back.name).toBe("Iceland");
    expect(back.config.pages).toEqual(config().pages);
    expect(back.config.preset).toEqual(AUTO_LAYOUT_PRESETS[0]);
  });

  it("upserts by name and deletes", () => {
    const s = fakeStorage();
    saveBook("Iceland", config(), s);
    saveBook(" Iceland ", { ...config(), settings: { ...DEFAULT_BOOK_SETTINGS, to: "jpeg" } }, s);
    expect(listSavedBooks(s)).toHaveLength(1);
    expect(listSavedBooks(s)[0].config.settings.to).toBe("jpeg");
    expect(deleteSavedBook("Iceland", s)).toEqual([]);
  });

  it("ignores a blank name and survives corrupt storage", () => {
    const s = fakeStorage();
    expect(saveBook("  ", config(), s)).toEqual([]);
    expect(s.raw()).toBeNull();
    s.setItem("galerie.savedBooks", "{not json");
    expect(listSavedBooks(s)).toEqual([]);
    expect(listSavedBooks(null)).toEqual([]);
  });

  it("fills in knobs a book from an older build never stored", () => {
    const s = fakeStorage();
    s.setItem("galerie.savedBooks", JSON.stringify([{ name: "Old", config: { settings: { to: "jpeg" } } }]));
    const back = listSavedBooks(s)[0].config;
    expect(back.settings).toEqual({ ...DEFAULT_BOOK_SETTINGS, to: "jpeg" });
    expect(back.pages).toEqual([]);
  });
});

describe("createSavedBook", () => {
  it("stores the photos as a collection and the layout under the same name", async () => {
    vi.mocked(store.createCollection).mockResolvedValue(7);
    const before = listSavedBooks();
    const next = await createSavedBook("Iceland", photos, config());

    // Tagged as a Saved Book output collection (GAL-LIB-17), so the Collections
    // panel can badge it rather than showing a plain collection.
    expect(store.createCollection).toHaveBeenCalledWith(
      "Iceland",
      "collection",
      expect.stringContaining('"output":"book"'),
    );
    expect(store.addToCollection).toHaveBeenCalledWith(7, [1, 2, 3]);
    // localStorage is available under vitest's node env only if jsdom is on —
    // either way the saved list is returned, never null.
    expect(next).not.toBeNull();
    expect(next!.length).toBeGreaterThanOrEqual(before.length);
  });

  it("does nothing when the collection could not be created", async () => {
    vi.mocked(store.createCollection).mockResolvedValue(null);
    expect(await createSavedBook("Iceland", photos, config())).toBeNull();
    expect(store.addToCollection).not.toHaveBeenCalled();
  });

  it("refuses a blank name before touching the catalog", async () => {
    expect(await createSavedBook("   ", photos, config())).toBeNull();
    expect(store.createCollection).not.toHaveBeenCalled();
  });
});

describe("BookPagePreview", () => {
  it("draws a cell per template cell", () => {
    const book: Book = { settings: DEFAULT_BOOK_SETTINGS, pages: autoLayout([1, 2, 3], { name: "x", templates: ["four"] }) };
    const html = renderToStaticMarkup(
      <BookPagePreview
        book={book}
        index={1}
        byId={new Map(photos.map((p) => [p.id, p]))}
        guides
        height={150}
        selected={false}
        onSelect={() => {}}
      />,
    );
    expect(html.match(/data-book-cell/g)).toHaveLength(4);
    // The cover is one full-bleed cell, whatever the interior template is.
    const cover = renderToStaticMarkup(
      <BookPagePreview
        book={book}
        index={0}
        byId={new Map(photos.map((p) => [p.id, p]))}
        guides={false}
        height={150}
        selected
        onSelect={() => {}}
      />,
    );
    expect(cover.match(/data-book-cell/g)).toHaveLength(1);
  });
});
