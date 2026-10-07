// GAL-OUT-04: the Print module has to reach a printer, not only a JPEG file.
// These pin the Print Job panel's downstream half — destination (spool vs file),
// Print Resolution, Draft Mode, Print Adjustment — plus the jobs we refuse
// rather than print wrong (16-bit output, an app-side printer profile).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));
vi.mock("./export", () => ({ developToImage: vi.fn() }));

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

import type { PhotoRow } from "./catalog/types";
import { developToImage } from "./export";
import { PAGE_SIZES } from "./lib/printLayout";
import {
  applyPrintAdjustment,
  DEFAULT_PRINT_JOB,
  DRAFT_PPI,
  effectivePpi,
  MAX_PPI,
  MIN_PPI,
  type PrintJob,
  printPhoto,
} from "./print";

// ── minimal canvas / webview fakes (vitest runs in node, no DOM) ────────────
const canvases: { w: number; h: number }[] = [];
const blobs: { type: string }[] = [];
const printFrame = { printed: 0, srcdoc: "", released: 0, imgSrc: "" };

class FakeCtx {
  fillStyle = "";
  imageSmoothingQuality = "";
  fillRect(): void {}
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
      printFrame.imgSrc = /src="([^"]*)"/.exec(v)?.[1] ?? "";
      // A real srcdoc frame fires load once its image has loaded.
      queueMicrotask(() => el.onload?.());
    },
    contentWindow: {
      addEventListener: (type: string, fn: () => void) => {
        if (type === "afterprint") afterPrint = fn;
      },
      focus: () => {},
      print: () => {
        printFrame.printed++;
        afterPrint?.(); // the dialog is modal: afterprint follows print()
      },
    },
  };
  return el;
}

const photo = { id: 1, path: "/photos/a.cr3", format: "raw:CR3" } as PhotoRow;
const letter = PAGE_SIZES.Letter;
const job = (over: Partial<PrintJob>): PrintJob => ({ ...DEFAULT_PRINT_JOB, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  canvases.length = 0;
  blobs.length = 0;
  Object.assign(printFrame, { printed: 0, srcdoc: "", released: 0, imgSrc: "" });
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.stubGlobal("ImageData", FakeImageData);
  vi.stubGlobal("document", { body: { appendChild: () => {} }, createElement: fakeFrame });
  URL.createObjectURL = vi.fn(() => "blob:page");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(developToImage).mockResolvedValue({ rgba: new Uint8Array(4 * 4 * 4), width: 4, height: 4 });
  vi.mocked(save).mockResolvedValue("/out/print.jpg");
});

describe("Print To = Printer", () => {
  it("spools the composed page instead of writing a file", async () => {
    const res = await printPhoto(photo, { page: letter, margin: 75, quality: 0.9, job: job({ to: "printer" }) });

    expect(printFrame.printed).toBe(1); // reached the OS print dialog
    expect(save).not.toHaveBeenCalled(); // no "save as JPEG" detour
    expect(writeFile).not.toHaveBeenCalled();
    expect(blobs[0].type).toBe("image/png"); // lossless to the spooler
    expect(res).toEqual({ to: "printer", dest: null, drawn: 1, failed: 0, dropped: 0, pages: 1 });
  });

  it("spools a page-sized document and releases the frame", async () => {
    await printPhoto(photo, { page: letter, margin: 75, quality: 0.9, job: job({ to: "printer" }) });

    expect(printFrame.srcdoc).toContain("@page{size:8.500in 11.000in;margin:0}");
    expect(printFrame.imgSrc).toBe("blob:page");
    expect(printFrame.released).toBe(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:page");
  });
});

describe("Print To = JPEG File", () => {
  it("still writes the JPEG (the default job)", async () => {
    const res = await printPhoto(photo, { page: letter, margin: 75, quality: 0.9 });

    expect(save).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith("/out/print.jpg", expect.any(Uint8Array));
    expect(printFrame.printed).toBe(0);
    expect(res?.dest).toBe("/out/print.jpg");
  });

  it("returns null and writes nothing when the save dialog is cancelled", async () => {
    vi.mocked(save).mockResolvedValue(null);
    expect(await printPhoto(photo, { page: letter, margin: 75, quality: 0.9 })).toBeNull();
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("Print Resolution", () => {
  it("composes the page at the job's ppi, not at the layout's 300", async () => {
    await printPhoto(photo, { page: letter, margin: 75, quality: 0.9, job: job({ ppi: 150 }) });
    expect(canvases[0]).toEqual({ w: 1275, h: 1650 }); // 8.5 × 11 in at 150 ppi
  });

  it("Draft Mode caps the resolution", async () => {
    await printPhoto(photo, { page: letter, margin: 75, quality: 0.9, job: job({ ppi: 600, draft: true }) });
    expect(canvases[0]).toEqual({ w: 816, h: 1056 }); // 8.5 × 11 in at 96 ppi
  });

  it("clamps out-of-range ppi", () => {
    expect(effectivePpi(job({ ppi: 1 }))).toBe(MIN_PPI);
    expect(effectivePpi(job({ ppi: 99999 }))).toBe(MAX_PPI);
    expect(effectivePpi(job({ ppi: Number.NaN }))).toBe(300);
    expect(effectivePpi(job({ ppi: 600, draft: true }))).toBe(DRAFT_PPI);
  });
});

describe("jobs we refuse rather than print wrong", () => {
  it("rejects 16 Bit Output", async () => {
    await expect(
      printPhoto(photo, { page: letter, margin: 75, quality: 0.9, job: job({ sixteenBit: true }) }),
    ).rejects.toThrow(/16 Bit Output/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("rejects an app-side printer profile", async () => {
    const color = { managedBy: "monet", profile: "Epson Glossy", intent: "perceptual" } as const;
    await expect(
      printPhoto(photo, { page: letter, margin: 75, quality: 0.9, job: job({ color }) }),
    ).rejects.toThrow(/Epson Glossy/);
    expect(printFrame.printed).toBe(0);
  });
});

describe("Print Adjustment", () => {
  const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 128]);

  it("brightens without touching alpha", () => {
    const d = px(100, 100, 100);
    applyPrintAdjustment(d, 20, 0);
    expect([...d]).toEqual([126, 126, 126, 128]); // +20 → +25.5, clamped-rounded
  });

  it("pivots contrast on mid-grey", () => {
    const d = px(128, 200, 50);
    applyPrintAdjustment(d, 0, 50);
    expect(d[0]).toBe(128); // the pivot is fixed
    expect(d[1]).toBe(236); // (200-128)*1.5+128
    expect(d[2]).toBe(11); // (50-128)*1.5+128
  });

  it("is a no-op at zero", () => {
    const d = px(7, 200, 90);
    applyPrintAdjustment(d, 0, 0);
    expect([...d]).toEqual([7, 200, 90, 128]);
  });

  it("clamps rather than wrapping", () => {
    const d = px(250, 5, 128);
    applyPrintAdjustment(d, 100, 0);
    expect([...d]).toEqual([255, 132, 255, 128]);
  });
});
