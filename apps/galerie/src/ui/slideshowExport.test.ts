import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));
vi.mock("../export", () => ({
  exportBytes: vi.fn(),
  pickExportDir: vi.fn(),
  runExport: vi.fn(),
}));

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

import type { PhotoRow } from "../catalog/types";
import { exportBytes, pickExportDir, runExport } from "../export";
import {
  exportSlideshowJpegs,
  exportSlideshowPdf,
  jpegDims,
  kenBurns,
  videoFrameAt,
  videoMime,
} from "./slideshowExport";

const photo = (id: number) => ({ id, path: `/photos/p${id}.jpg`, format: "jpeg" }) as PhotoRow;

/** Minimal well-formed JPEG: SOI + SOF0 (3 components) + EOI. */
const fakeJpeg = (w: number, h: number) =>
  new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0, length 17, 8-bit
    (h >> 8) & 0xff, h & 0xff,
    (w >> 8) & 0xff, w & 0xff,
    0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, // 3 component specs
    0xff, 0xd9, // EOI
  ]);

const emptyResult = { written: 0, committed: 0, failed: 0, durabilityWarnings: [], failureMessages: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("kenBurns", () => {
  it("is the identity when off", () => {
    expect(kenBurns("off", 3, 0.7)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("pushes in on even slides and pulls back on odd ones", () => {
    expect(kenBurns("low", 0, 0).scale).toBe(1);
    expect(kenBurns("low", 0, 1).scale).toBeCloseTo(1.08);
    expect(kenBurns("low", 1, 0).scale).toBeCloseTo(1.08);
    expect(kenBurns("low", 1, 1).scale).toBe(1);
    expect(kenBurns("high", 0, 1).scale).toBeCloseTo(1.16);
  });

  it("clamps the clock and alternates pan direction", () => {
    expect(kenBurns("low", 0, 5)).toEqual(kenBurns("low", 0, 1));
    expect(kenBurns("low", 0, 1).x).toBeGreaterThan(0);
    expect(kenBurns("low", 2, 1).x).toBeLessThan(0);
  });
});

describe("videoFrameAt", () => {
  const D = 4000;
  const X = 1000;

  it("shows a single slide outside the fade window", () => {
    expect(videoFrameAt(0, 3, D, X)).toMatchObject({ a: 0, b: null, mix: 0 });
    expect(videoFrameAt(2999, 3, D, X).b).toBeNull();
  });

  it("blends into the next slide across the fade tail", () => {
    const f = videoFrameAt(3500, 3, D, X);
    expect(f).toMatchObject({ a: 0, b: 1 });
    expect(f.mix).toBeCloseTo(0.5);
  });

  it("keeps each slide's Ken Burns clock continuous across the handoff", () => {
    const before = videoFrameAt(3999, 3, D, X);
    const after = videoFrameAt(4001, 3, D, X);
    expect(after.a).toBe(1);
    expect(after.ta).toBeCloseTo(before.tb, 2);
  });

  it("never fades the last slide and clamps past the end", () => {
    expect(videoFrameAt(11500, 3, D, X).b).toBeNull();
    expect(videoFrameAt(99999, 3, D, X)).toMatchObject({ a: 2, b: null, ta: 1 });
  });

  it("clamps the crossfade to the slide duration", () => {
    const f = videoFrameAt(2000, 3, D, 99999);
    expect(f).toMatchObject({ a: 0, b: 1 });
    expect(f.mix).toBeCloseTo(0.5);
  });
});

describe("jpegDims", () => {
  it("reads the frame size from the SOF marker", () => {
    expect(jpegDims(fakeJpeg(2048, 1365))).toEqual({ w: 2048, h: 1365 });
  });

  it("rejects non-JPEG bytes", () => {
    expect(() => jpegDims(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(/not a JPEG/);
  });
});

describe("videoMime", () => {
  it("prefers MP4 when the recorder supports it", () => {
    expect(videoMime((t) => t.startsWith("video/mp4"))).toBe("video/mp4;codecs=h264");
  });

  it("falls back to WebM otherwise", () => {
    expect(videoMime((t) => t === "video/webm")).toBe("video/webm");
    expect(videoMime(() => false)).toBe("video/webm");
  });
});

describe("exportSlideshowPdf", () => {
  it("writes one DCTDecode page per slide to the picked path", async () => {
    vi.mocked(save).mockResolvedValue("/out/slideshow.pdf");
    vi.mocked(exportBytes).mockImplementation(async () => fakeJpeg(800, 600));
    expect(await exportSlideshowPdf([photo(1), photo(2)])).toBe(true);

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, bytes] = vi.mocked(writeFile).mock.calls[0];
    expect(path).toBe("/out/slideshow.pdf");
    const text = new TextDecoder("latin1").decode(bytes as Uint8Array);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/DCTDecode");
    expect(text).toContain("/MediaBox [0 0 800 600]");
    expect(text).toContain("%%EOF");
  });

  it("does nothing when the save dialog is cancelled", async () => {
    vi.mocked(save).mockResolvedValue(null);
    expect(await exportSlideshowPdf([photo(1)])).toBe(false);
    expect(exportBytes).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("exportSlideshowJpegs", () => {
  it("routes the slides through the standard export pipeline", async () => {
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    vi.mocked(runExport).mockResolvedValue({ ...emptyResult, written: 2 });
    const slides = [photo(1), photo(2)];
    expect(await exportSlideshowJpegs(slides)).toEqual({ ...emptyResult, written: 2 });
    expect(runExport).toHaveBeenCalledWith(
      slides,
      "/out",
      expect.objectContaining({ format: "jpeg" }),
    );
  });

  it("returns null when the folder pick is cancelled", async () => {
    vi.mocked(pickExportDir).mockResolvedValue(null);
    expect(await exportSlideshowJpegs([photo(1)])).toBeNull();
    expect(runExport).not.toHaveBeenCalled();
  });
});
