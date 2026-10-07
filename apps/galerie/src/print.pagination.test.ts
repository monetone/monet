// OUT-15: a contact sheet paginates instead of dropping the overflow — a
// selection larger than the grid flows onto further pages, spooled to the
// printer as ONE job or written as one JPEG per page (pageDest naming).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));
vi.mock("./export", () => ({ developToImage: vi.fn() }));

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

import type { PhotoRow } from "./catalog/types";
import { developToImage } from "./export";
import { PAGE_SIZES } from "./lib/printLayout";
import { pageDest, printContactSheet } from "./print";

// ── minimal canvas / webview fakes (vitest runs in node, no DOM) ────────────
const blobs: { type: string }[] = [];
const texts: string[] = [];
const printFrame = { printed: 0, srcdoc: "", released: 0, imgSrcs: [] as string[] };

class FakeCtx {
  fillStyle = "";
  font = "";
  textAlign = "";
  textBaseline = "";
  imageSmoothingQuality = "";
  fillRect(): void {}
  drawImage(): void {}
  putImageData(): void {}
  fillText(t: string): void {
    texts.push(t);
  }
  measureText(t: string): { width: number } {
    return { width: t.length * 10 };
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
}

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): FakeCtx {
    return new FakeCtx();
  }
  convertToBlob(o: { type: string }) {
    blobs.push(o);
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

function fakeFrame() {
  let afterPrint: (() => void) | null = null;
  const el = {
    title: "",
    style: { cssText: "" },
    onload: null as null | (() => void),
    setAttribute: () => {},
    remove: () => {
      printFrame.released++;
    },
    set srcdoc(v: string) {
      printFrame.srcdoc = v;
      printFrame.imgSrcs = [...v.matchAll(/src="([^"]*)"/g)].map((m) => m[1]);
      queueMicrotask(() => el.onload?.());
    },
    contentWindow: {
      addEventListener: (type: string, fn: () => void) => {
        if (type === "afterprint") afterPrint = fn;
      },
      focus: () => {},
      print: () => {
        printFrame.printed++;
        afterPrint?.();
      },
    },
  };
  return el;
}

const photo = (id: number) => ({ id, path: `/photos/p${id}.cr3`, format: "raw:CR3" }) as PhotoRow;
const five = [1, 2, 3, 4, 5].map(photo);
// A 2×2 grid on Letter: 4 cells per page → 5 photos paginate to 2 pages.
const opts = { page: PAGE_SIZES.Letter, margin: 75, gutter: 30, quality: 0.9, grid: { rows: 2, cols: 2 } };

beforeEach(() => {
  vi.clearAllMocks();
  blobs.length = 0;
  texts.length = 0;
  Object.assign(printFrame, { printed: 0, srcdoc: "", released: 0, imgSrcs: [] });
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.stubGlobal("ImageData", FakeImageData);
  vi.stubGlobal("document", { body: { appendChild: () => {} }, createElement: fakeFrame });
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:page-${++n}`);
  URL.revokeObjectURL = vi.fn();
  vi.mocked(developToImage).mockResolvedValue({ rgba: new Uint8Array(4 * 4 * 4), width: 4, height: 4 });
  vi.mocked(save).mockResolvedValue("/out/contact-sheet.jpg");
});

describe("contact-sheet pagination", () => {
  it("spools the overflow as further pages of ONE print job", async () => {
    const res = await printContactSheet(five, {
      ...opts,
      job: { to: "printer", ppi: 300, draft: false, sharpen: null, sixteenBit: false, color: { managedBy: "printer" }, adjust: { brightness: 0, contrast: 0 } },
    });

    expect(res).toMatchObject({ drawn: 5, failed: 0, dropped: 0, pages: 2 });
    expect(printFrame.printed).toBe(1); // one job, not one per page
    expect(printFrame.imgSrcs).toEqual(["blob:page-1", "blob:page-2"]);
    expect(printFrame.srcdoc).toContain("page-break-after:always");
    expect(blobs.filter((b) => b.type === "image/png")).toHaveLength(2);
    expect(printFrame.released).toBe(1);
  });

  it("writes one JPEG per page, numbered from the picked name", async () => {
    const res = await printContactSheet(five, opts);

    expect(res).toMatchObject({ dest: "/out/contact-sheet.jpg", drawn: 5, pages: 2 });
    expect(vi.mocked(writeFile).mock.calls.map((c) => c[0])).toEqual([
      "/out/contact-sheet.jpg",
      "/out/contact-sheet-2.jpg",
    ]);
  });

  it("numbers each page for Page Numbers", async () => {
    await printContactSheet(five, {
      ...opts,
      decor: {
        background: "#fff",
        identityPlate: null,
        watermark: null,
        pageNumbers: true,
        pageInfo: false,
        cropMarks: false,
        photoInfo: null,
      },
    });
    expect(texts).toEqual(["1", "2"]);
  });

  it("skips an all-blank page instead of delivering it", async () => {
    vi.mocked(developToImage).mockImplementation((p: PhotoRow) =>
      p.id === 5
        ? Promise.reject(new Error("corrupt"))
        : Promise.resolve({ rgba: new Uint8Array(4 * 4 * 4), width: 4, height: 4 }),
    );
    const res = await printContactSheet(five, opts);

    expect(res).toMatchObject({ drawn: 4, failed: 1, pages: 1 }); // page 2 was all blank
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("pageDest", () => {
  it("keeps page 1's picked name and splices -N before the extension", () => {
    expect(pageDest("/out/contact-sheet.jpg", 0)).toBe("/out/contact-sheet.jpg");
    expect(pageDest("/out/contact-sheet.jpg", 1)).toBe("/out/contact-sheet-2.jpg");
    expect(pageDest("C:\\out\\sheet.jpg", 2)).toBe("C:\\out\\sheet-3.jpg");
    expect(pageDest("/dotted.dir/sheet", 1)).toBe("/dotted.dir/sheet-2"); // no extension to splice into
  });
});
