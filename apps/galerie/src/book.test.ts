// OUT-09: the Book module's output half. These pin what leaves the app — one
// PDF for the whole book or one JPEG per page (Print's "-2" page naming), the
// cover sheet's size, the develop cache, a page that keeps going when a photo
// fails, and the outputs we refuse rather than mislabel.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));
vi.mock("./export", () => ({ developToImage: vi.fn() }));

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

import { bookPageSize, DEFAULT_BOOK_SETTINGS, exportBook, type Book } from "./book";
import type { PhotoRow } from "./catalog/types";
import { developToImage } from "./export";
import { autoLayout, BOOK_SIZES, coverPageSize, type BookPage } from "./lib/bookLayout";

// ── minimal canvas fakes (vitest runs in node, no DOM) ──────────────────────
const canvases: { w: number; h: number }[] = [];

class FakeCtx {
  fillStyle = "";
  font = "";
  textAlign = "";
  textBaseline = "";
  imageSmoothingQuality = "";
  fillRect(): void {}
  fillText(): void {}
  drawImage(): void {}
  putImageData(): void {}
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
}

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {
    canvases.push({ w: width, h: height });
  }
  getContext(): FakeCtx {
    return new FakeCtx();
  }
  convertToBlob() {
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
  }
}

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
vi.stubGlobal("ImageData", FakeImageData);

const photo = (id: number) => ({ id, path: `/photos/p${id}.jpg`, format: "jpeg" }) as PhotoRow;
const photos = [photo(1), photo(2), photo(3)];
const image = { rgba: new Uint8Array(4), width: 2000, height: 1500 };
const trim = BOOK_SIZES[DEFAULT_BOOK_SETTINGS.sizeName];

const book = (over: Partial<Book["settings"]> = {}, pages?: BookPage[]): Book => ({
  settings: { ...DEFAULT_BOOK_SETTINGS, ...over },
  pages: pages ?? autoLayout([1, 2, 3], { name: "one per page", templates: ["one"] }),
});

/** Export a book over the standard selection. */
const run = (b: Book) => exportBook(b, photos);

const pdfText = (bytes: unknown) => new TextDecoder("latin1").decode(bytes as Uint8Array);

/** The composed page canvases — every developed photo also makes a source
 *  canvas at the image's own size, which these are not. */
const pageCanvases = () => canvases.filter((c) => !(c.w === image.width && c.h === image.height));

beforeEach(() => {
  vi.clearAllMocks();
  canvases.length = 0;
  vi.mocked(developToImage).mockResolvedValue(image as Awaited<ReturnType<typeof developToImage>>);
});

describe("exportBook to PDF", () => {
  it("writes ONE PDF holding a page per book page", async () => {
    vi.mocked(save).mockResolvedValue("/out/book.pdf");
    const res = await run(book());

    expect(res).toMatchObject({ to: "pdf", dest: "/out/book.pdf", pages: 4, drawn: 4, failed: 0 });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, bytes] = vi.mocked(writeFile).mock.calls[0];
    expect(path).toBe("/out/book.pdf");
    const text = pdfText(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 4");
    expect(text).toContain("/DCTDecode");
    expect(text).toContain("%%EOF");
  });

  it("composes the cover as a hardcover wrap and the rest at trim size", async () => {
    vi.mocked(save).mockResolvedValue("/out/book.pdf");
    const b = book({ cover: "hardcover-image" });
    await run(b);

    const wrap = coverPageSize(trim, "hardcover-image", b.pages.length - 1);
    expect(bookPageSize(b, 0)).toEqual(wrap);
    // The composed page canvases are the layout sizes at the book's ppi (300).
    expect(pageCanvases()[0]).toEqual({ w: wrap.w, h: wrap.h });
    expect(pageCanvases()[1]).toEqual({ w: trim.w, h: trim.h });
  });

  it("scales every page to the File Resolution", async () => {
    vi.mocked(save).mockResolvedValue("/out/book.pdf");
    await run(book({ ppi: 150, cover: "softcover" }));

    expect(pageCanvases()[1]).toEqual({ w: trim.w / 2, h: trim.h / 2 });
  });

  it("develops each photo once however many pages use it", async () => {
    vi.mocked(save).mockResolvedValue("/out/book.pdf");
    // The cover repeats photo 1, so 4 pages hold only 3 distinct photos.
    await run(book());

    expect(developToImage).toHaveBeenCalledTimes(3);
  });
});

describe("exportBook to JPEG", () => {
  it("writes one file per page, numbered after the first", async () => {
    vi.mocked(save).mockResolvedValue("/out/book.jpg");
    const res = await run(book({ to: "jpeg" }));

    expect(res).toMatchObject({ to: "jpeg", pages: 4 });
    expect(vi.mocked(writeFile).mock.calls.map((c) => c[0])).toEqual([
      "/out/book.jpg",
      "/out/book-2.jpg",
      "/out/book-3.jpg",
      "/out/book-4.jpg",
    ]);
  });
});

describe("exportBook edge cases", () => {
  it("does nothing when the save dialog is cancelled", async () => {
    vi.mocked(save).mockResolvedValue(null);
    expect(await run(book())).toBeNull();
    expect(developToImage).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("does nothing for a book with no pages", async () => {
    expect(await run({ settings: DEFAULT_BOOK_SETTINGS, pages: [] })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses a profile it cannot honour instead of mislabelling the file", async () => {
    await expect(run(book({ profile: "AdobeRGB" }))).rejects.toThrow(/sRGB/);
    expect(save).not.toHaveBeenCalled();
  });

  it("leaves a failed photo's cell blank and still writes the book", async () => {
    vi.mocked(save).mockResolvedValue("/out/book.pdf");
    vi.mocked(developToImage).mockRejectedValueOnce(new Error("decode failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run(book());

    expect(res).toMatchObject({ pages: 4, failed: 1 });
    expect(res!.drawn).toBeGreaterThan(0);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("sharpens the composed page when Sharpening is on", async () => {
    vi.mocked(save).mockResolvedValue("/out/book.pdf");
    const sharpened = vi.spyOn(FakeCtx.prototype, "getImageData");
    // ppi 72 (the settings floor): whether sharpening runs is resolution
    // independent, and a 300-ppi page is ~7M pixels to composite for a boolean.
    // At 300 this test took ~800ms alone and timed out under a full parallel run.
    await run(book({ sharpen: null, ppi: 72 }));
    expect(sharpened).not.toHaveBeenCalled();

    await run(book({ sharpen: { media: "matte", amount: "standard" }, ppi: 72 }));
    expect(sharpened).toHaveBeenCalled();
    sharpened.mockRestore();
  });
});

// A page whose photo id isn't in the passed selection is an empty cell, not a
// failure — the book still composes.
describe("missing photos", () => {
  it("draws an empty cell for a photo that isn't in the selection", async () => {
    vi.mocked(save).mockResolvedValue("/out/book.pdf");
    const pages: BookPage[] = [{ template: "one", photos: [999], text: "" }];
    const res = await run({ settings: DEFAULT_BOOK_SETTINGS, pages });

    expect(res).toMatchObject({ pages: 1, drawn: 0, failed: 0 });
    expect(developToImage).not.toHaveBeenCalled();
  });
});
