// OUT-14: the Image Settings + Page panels reach the composed print page.
// Pins the cell renderer (Zoom to Fill, Rotate to Fit, Stroke Border, Repeat
// One Photo per Page) and the page overlays (background color, Identity Plate,
// watermark — the Export spec, now reachable from print — Page Numbers, Page
// Info, Crop Marks, Photo Info captions).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));
vi.mock("./export", () => ({ developToImage: vi.fn() }));

import { save } from "@tauri-apps/plugin-dialog";

import type { PhotoRow } from "./catalog/types";
import { developToImage } from "./export";
import { PAGE_SIZES } from "./lib/printLayout";
import {
  DEFAULT_PAGE_SETTINGS,
  DEFAULT_PRINT_JOB,
  type ImageSettings,
  pageInfoText,
  type PageSettings,
  photoCaption,
  printContactSheet,
  printPhoto,
  printPicturePackage,
} from "./print";

// ── canvas fakes that record draw calls (vitest runs in node, no DOM) ──────
interface Call {
  op: string;
  args: unknown[];
  fillStyle?: string;
  strokeStyle?: string;
  lineWidth?: number;
  alpha?: number;
}
const calls: Call[] = [];
const ops = (op: string) => calls.filter((c) => c.op === op);

class FakeCtx {
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 0;
  globalAlpha = 1;
  font = "";
  textAlign = "";
  textBaseline = "";
  shadowColor = "";
  shadowBlur = 0;
  imageSmoothingQuality = "";
  fillRect(...args: unknown[]): void {
    calls.push({ op: "fillRect", args, fillStyle: this.fillStyle });
  }
  drawImage(...args: unknown[]): void {
    calls.push({ op: "drawImage", args: args.slice(1) }); // drop the source canvas
  }
  strokeRect(...args: unknown[]): void {
    calls.push({ op: "strokeRect", args, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth });
  }
  fillText(...args: unknown[]): void {
    calls.push({ op: "fillText", args, alpha: this.globalAlpha, fillStyle: this.fillStyle });
  }
  measureText(t: string): { width: number } {
    return { width: t.length * 10 }; // deterministic: 10 px per glyph
  }
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  rect(): void {}
  clip(): void {
    calls.push({ op: "clip", args: [] });
  }
  translate(...args: unknown[]): void {
    calls.push({ op: "translate", args });
  }
  rotate(...args: unknown[]): void {
    calls.push({ op: "rotate", args });
  }
  moveTo(...args: unknown[]): void {
    calls.push({ op: "moveTo", args });
  }
  lineTo(): void {}
  stroke(): void {
    calls.push({ op: "stroke", args: [] });
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  putImageData(): void {}
}

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
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

const photoA = { id: 1, path: "/photos/a.cr3", format: "raw:CR3" } as PhotoRow;
const photoB = { id: 2, path: "/photos/b.jpg", format: "jpeg" } as PhotoRow;
const letter = PAGE_SIZES.Letter; // 2550 × 3300 px; margin 75 → 2400 × 3150 box
const base = { page: letter, margin: 75, quality: 0.9 };
const square = (n: number) => ({ rgba: new Uint8Array(n * n * 4), width: n, height: n });

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.stubGlobal("ImageData", FakeImageData);
  vi.mocked(developToImage).mockResolvedValue(square(4));
  vi.mocked(save).mockResolvedValue("/out/print.jpg");
});

const image = (over: Partial<ImageSettings>): ImageSettings => ({
  zoomToFill: false,
  rotateToFit: false,
  repeatOne: false,
  stroke: null,
  ...over,
});
const decor = (over: Partial<PageSettings>): PageSettings => ({ ...DEFAULT_PAGE_SETTINGS, ...over });

describe("Image Settings", () => {
  it("Stroke Border strokes the placed rect in the chosen width and color", async () => {
    await printPhoto(photoA, { ...base, image: image({ stroke: { width: 6, color: "#123456" } }) });
    // 4×4 photo fitted in the 2400×3150 box → 2400×2400 at (75, 450); the
    // 6 px stroke is inset half a line width.
    expect(ops("strokeRect")).toEqual([
      { op: "strokeRect", args: [78, 453, 2394, 2394], strokeStyle: "#123456", lineWidth: 6 },
    ]);
  });

  it("Zoom to Fill covers the printable box edge-to-edge under a clip", async () => {
    await printPhoto(photoA, { ...base, image: image({ zoomToFill: true }) });
    expect(ops("clip")).toHaveLength(1);
    // cover scale = max(2400/4, 3150/4) = 787.5 → a 3150×3150 draw about the center.
    expect(ops("drawImage")[0].args).toEqual([-1575, -1575, 3150, 3150]);
  });

  it("Rotate to Fit turns a landscape photo upright on a portrait page", async () => {
    vi.mocked(developToImage).mockResolvedValue({ rgba: new Uint8Array(8 * 4 * 4), width: 8, height: 4 });
    await printPhoto(photoA, { ...base, image: image({ rotateToFit: true }) });
    expect(ops("rotate")[0].args).toEqual([Math.PI / 2]);
    // Rotated dims 4×8 fit the 2400×3150 box at scale 393.75; the local draw
    // stays 8×4-shaped (3150 × 1575) and the rotation stands it up.
    expect(ops("drawImage")[0].args).toEqual([-1575, -787.5, 3150, 1575]);
  });

  it("Repeat One Photo per Page gives each photo its own repeated page", async () => {
    const res = await printContactSheet([photoA, photoB], {
      ...base,
      gutter: 30,
      grid: { rows: 2, cols: 2 },
      image: image({ repeatOne: true }),
    });
    // One develop per page (LR: one page per photo), its canvas in every cell.
    expect(developToImage).toHaveBeenCalledTimes(2);
    expect(developToImage).toHaveBeenCalledWith(photoA);
    expect(developToImage).toHaveBeenCalledWith(photoB);
    expect(ops("drawImage")).toHaveLength(8);
    expect(res).toMatchObject({ drawn: 8, failed: 0, dropped: 0, pages: 2 });
  });

  it("a picture package still Zooms to Fill by default", async () => {
    const res = await printPicturePackage(photoA, { ...base, gutter: 30, sizes: [{ w: 1500, h: 1050 }] });
    expect(res?.drawn).toBe(1);
    expect(ops("clip")).toHaveLength(1); // cover-crop path, not fit
  });
});

describe("Page panel", () => {
  it("fills the page with the Page Background Color", async () => {
    await printPhoto(photoA, { ...base, decor: decor({ background: "#001122" }) });
    expect(ops("fillRect")[0]).toMatchObject({ args: [0, 0, 2550, 3300], fillStyle: "#001122" });
  });

  it("draws the Export watermark spec over the placed photo", async () => {
    const wm = { text: "© Me", anchor: "bottom-right" as const, opacity: 0.7, sizePct: 4, insetPct: 2 };
    await printPhoto(photoA, { ...base, decor: decor({ watermark: wm }) });
    // font = 4% of the 2400 px photo = 96 px; inset = 48; text box 40×96 →
    // photo-local (2312, 2256), photo placed at (75, 450).
    expect(ops("fillText")).toEqual([
      { op: "fillText", args: ["© Me", 2387, 2706], alpha: 0.7, fillStyle: "#ffffff" },
    ]);
  });

  it("captions each photo with its Photo Info token", async () => {
    await printContactSheet([photoA, photoB], {
      ...base,
      gutter: 30,
      grid: { rows: 1, cols: 2 },
      decor: decor({ photoInfo: { token: "filename", sizePt: 10 } }),
    });
    const texts = ops("fillText").map((c) => c.args[0]);
    expect(texts).toEqual(["a.cr3", "b.jpg"]);
  });

  it("draws Identity Plate, Page Info and the Page Number", async () => {
    await printPhoto(photoA, {
      ...base,
      decor: decor({ identityPlate: "Monet Studio", pageInfo: true, pageNumbers: true }),
    });
    const texts = ops("fillText").map((c) => c.args[0]);
    expect(texts).toContain("Monet Studio");
    expect(texts).toContain("300 ppi · Managed by Printer");
    expect(texts).toContain("1"); // single-page module: always page 1
  });

  it("draws 8 crop-mark ticks around the placed photo", async () => {
    await printPhoto(photoA, { ...base, decor: decor({ cropMarks: true }) });
    expect(ops("moveTo")).toHaveLength(8); // 2 ticks × 4 corners
    expect(ops("stroke")).toHaveLength(1);
  });

  it("a plain job draws no overlays (the pre-OUT-14 page)", async () => {
    await printPhoto(photoA, base);
    expect(ops("fillText")).toHaveLength(0);
    expect(ops("strokeRect")).toHaveLength(0);
    expect(ops("clip")).toHaveLength(0);
    expect(ops("fillRect")[0].fillStyle).toBe("#fff");
  });
});

describe("photoCaption", () => {
  it("resolves filename across path styles", () => {
    expect(photoCaption(photoA, "filename")).toBe("a.cr3");
    expect(photoCaption({ path: "C:\\pics\\b 1.jpg" } as PhotoRow, "filename")).toBe("b 1.jpg");
  });

  it("formats exposure and falls back to empty strings", () => {
    const p = { exposureTime: 0.005, fNumber: 2.8, iso: 100 } as PhotoRow;
    expect(photoCaption(p, "exposure")).toBe("1/200s  f/2.8  ISO 100");
    expect(photoCaption({ captureTime: null } as PhotoRow, "date")).toBe("");
    expect(photoCaption({ captureTime: 86400 } as PhotoRow, "date")).not.toBe("");
    expect(photoCaption({ caption: "hello" } as PhotoRow, "caption")).toBe("hello");
    expect(photoCaption({ caption: null } as PhotoRow, "caption")).toBe("");
  });
});

describe("pageInfoText", () => {
  it("summarizes ppi, sharpening and color management", () => {
    expect(pageInfoText(DEFAULT_PRINT_JOB)).toBe("300 ppi · Managed by Printer");
    expect(pageInfoText({ ...DEFAULT_PRINT_JOB, sharpen: { media: "glossy", amount: "high" } })).toBe(
      "300 ppi · Sharpening: high (glossy) · Managed by Printer",
    );
    expect(pageInfoText({ ...DEFAULT_PRINT_JOB, draft: true })).toBe("96 ppi · Draft · Managed by Printer");
  });
});
