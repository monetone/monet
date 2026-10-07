import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_SPEEDS, MAX_OPTIMIZE_PROBES, SAVE_FOR_WEB_FORMATS,
  downloadSeconds, formatByteSize, formatDownloadTime, isPersistedWebFormat,
  optimizeQualityToSize, saveForWebFilename, webExportMime, webQualityApplies,
} from "./webExportEstimate";

// VIS-SFW-02: Save for Web had no preview, no size readout, no modern formats
// and no metadata scope. These pin the readout maths and the Optimize to File
// Size search; the wiring block below pins that the dialog's preview and its
// Save button really share one encoder (same idiom as webExportPixels.test.ts).

describe("Save for Web formats", () => {
  it("offers the modern web formats alongside the legacy three", () => {
    expect(SAVE_FOR_WEB_FORMATS.map((f) => f.value)).toEqual(["png", "jpeg", "gif", "webp", "avif"]);
  });

  it("knows which formats persist and which have a quality knob", () => {
    // Every offered format persists now — a user who picks WebP/AVIF gets it
    // back next launch instead of silently reverting to PNG.
    expect(SAVE_FOR_WEB_FORMATS.filter((f) => isPersistedWebFormat(f.value)).map((f) => f.value))
      .toEqual(["png", "jpeg", "gif", "webp", "avif"]);
    expect(SAVE_FOR_WEB_FORMATS.filter((f) => webQualityApplies(f.value)).map((f) => f.value))
      .toEqual(["jpeg", "webp", "avif"]);
  });

  it("names the output file and its mime for every format", () => {
    expect(saveForWebFilename("design.psd", "webp")).toBe("design.webp");
    expect(saveForWebFilename("design.psd", "avif")).toBe("design.avif");
    // The legacy three keep going through webExportPrefs' filename rule.
    expect(saveForWebFilename("design.psd", "jpeg")).toBe("design.jpg");
    expect(saveForWebFilename("", "webp")).toBe("monet-vision.webp");
    expect(webExportMime("jpeg")).toBe("image/jpeg");
    expect(webExportMime("avif")).toBe("image/avif");
  });
});

describe("size and download-time readouts", () => {
  it("formats bytes the way the OS reports the written file", () => {
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(999)).toBe("999 B");
    expect(formatByteSize(1024)).toBe("1.0 KB");
    expect(formatByteSize(186_778)).toBe("182.4 KB");
    expect(formatByteSize(5 * 1024 * 1024)).toBe("5.00 MB");
  });

  it("estimates transfer time in decimal kilobits, and shrugs at unknown speeds", () => {
    // 56.6 Kbps ≈ 7075 bytes/s, so 70 750 bytes is about 10 seconds.
    expect(downloadSeconds(70_750, 56.6)).toBeCloseTo(10, 3);
    expect(downloadSeconds(1000, 0)).toBe(0);
    expect(formatDownloadTime(1000, 0)).toBe("<1 sec");
  });

  it("switches to m:ss past a minute without ever printing :60", () => {
    expect(formatDownloadTime(70_750, 56.6)).toBe("10 sec");
    expect(formatDownloadTime(700_000, 56.6)).toBe("1:39 min");
    // 59.6 s rounds to 60 — must read 1:00, not 0:60.
    expect(formatDownloadTime(Math.round((59.6 * 56.6 * 1000) / 8), 56.6)).toBe("1:00 min");
  });

  it("offers a dial-up-to-fibre spread of speeds", () => {
    expect(DOWNLOAD_SPEEDS[0].kbps).toBe(56.6);
    expect(DOWNLOAD_SPEEDS.every((s) => s.kbps > 0 && s.label.length > 0)).toBe(true);
  });
});

describe("optimizeQualityToSize", () => {
  /** A stand-in encoder: 1 KB per quality point, like a lossy codec's curve. */
  const linearSizer = () => vi.fn<(...args: unknown[]) => Promise<number>>(
    async (...args: unknown[]) => (args[0] as number) * 1024);

  it("returns the highest quality that still fits the target", async () => {
    const sizeAt = linearSizer();
    const best = await optimizeQualityToSize(50 * 1024, sizeAt);
    expect(best).toEqual({ quality: 50, bytes: 50 * 1024 });
  });

  it("never spends more than the probe budget on a full-composite encode", async () => {
    const sizeAt = linearSizer();
    await optimizeQualityToSize(50 * 1024, sizeAt);
    expect(sizeAt.mock.calls.length).toBeLessThanOrEqual(MAX_OPTIMIZE_PROBES);
  });

  it("falls back to the smallest file when nothing fits", async () => {
    const sizeAt = linearSizer();
    const best = await optimizeQualityToSize(10, sizeAt);
    expect(best.quality).toBe(1);
    expect(best.bytes).toBe(1024);
  });

  it("handles a target so generous that top quality fits", async () => {
    const best = await optimizeQualityToSize(10_000 * 1024, linearSizer());
    expect(best.quality).toBe(100);
  });
});

// ── wiring: the preview and the save must share one encoder ────
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("VIS-SFW-02 — Save for Web is a preview workspace", () => {
  const app = read("./app.ts");
  const dialogs = read("../ui/Dialogs.tsx");
  const section = (source: string, start: string, end: string) => {
    const from = source.indexOf(start);
    expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
    const to = source.indexOf(end, from + start.length);
    expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
    return source.slice(from, to);
  };

  it("encodes every offered format from one entry point", () => {
    const body = section(app, "export async function webExportBytes(", "/** Save for Web's \"Optimize to File Size\"");
    const modern = section(app, "async function encodeModernWebImage(", "/** Encode a region of `src`");
    expect(body).toContain("export_gif(");
    expect(body).toContain("export_png_with_icc(");
    expect(body).toContain("export_jpeg_with_icc(");
    expect(body).toContain("encodeModernWebImage(");
    expect(modern).toContain("encodeWebpLossy(");
    expect(modern).toContain("@jsquash/avif");
    // Metadata "none" must not reach the engine encoders — they tag the working
    // profile even for empty ICC bytes, so only the canvas can write untagged.
    expect(body).toContain('opts.metadata === "all"');
  });

  it("writes the file through the same encoder the preview shows", () => {
    expect(section(app, "export async function saveForWeb(", "/** PDF page-image quality"))
      .toContain("webExportBytes(prefs)");
  });

  it("keeps WebP and AVIF for slices and labels the whole-image preview honestly", () => {
    const save = section(app, "export async function saveForWeb(", "/** PDF page-image quality");
    expect(save).toContain('prefs.format === "gif" ? "png" : prefs.format');
    expect(save).toContain("saveCanvasRegion(sliceExportName(stem, i, ext)");
    expect(save).toContain("format, prefs.quality");
    const body = section(dialogs, "function SaveForWebDialog(", "function LayerCleanup(");
    expect(body).toContain("whole-image preview");
    expect(body).toContain("Animated GIF slices export as PNG");
    expect(body).toContain("optimizing || sliceCount > 0");
  });

  it("searches quality with the real encoder for Optimize to File Size", () => {
    const body = section(app, "export async function optimizeWebExportToFileSize(", "/** File ▸ Save for Web:");
    expect(body).toContain("optimizeQualityToSize(");
    expect(body).toContain("webExportBytes({ ...opts, quality })");
  });

  it("renders the preview panes from that encoder and reports the real size", () => {
    const body = section(dialogs, "function useWebPreview(", "function WebPreviewPane(");
    expect(body).toContain("webExportBytes(opts)");
    expect(body).toContain("URL.revokeObjectURL"); // no leaked object URLs per keystroke
    const pane = section(dialogs, "function WebPreviewPane(", "function SaveForWebDialog(");
    expect(pane).toContain("formatByteSize(preview.bytes)");
    expect(pane).toContain("formatDownloadTime(preview.bytes, kbps)");
    expect(pane).toContain("alt="); // the preview image is described
  });

  it("offers the comparison views, the format list and the metadata scope", () => {
    const body = section(dialogs, "function SaveForWebDialog(", "function LayerCleanup(");
    expect(body).toContain('value: "2up"');
    expect(body).toContain("SAVE_FOR_WEB_FORMATS.map(");
    expect(body).toContain("setMetadata(");
    expect(body).toContain("optimizeWebExportToFileSize(");
    // Save hands the dialog's session-only choices to the export path.
    expect(body).toContain("saveForWeb(docName, opts)");
  });
});
