import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportAsWebOptions } from "../state/webExportPrefs";

// VIS-EXP-01: Export As was a settings sheet — no preview, no idea what a
// quality setting costs before the file was written. It now previews through
// `webExportBytes`, the encoder Save for Web uses, because at 1× that encoder
// produces the very bytes `exportAs` writes. These pin that equivalence: the
// option set, the encoder calls on both sides, and the dialog wiring.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const section = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
};

describe("Export As preview options", () => {
  it("asks for the document's own pixels with the profile tagged", () => {
    expect(exportAsWebOptions("png", 90)).toEqual({
      format: "png", quality: 90, matte: "transparent", convertToSRgb: false, metadata: "all",
    });
  });

  it("clamps quality the way exportAs does", () => {
    expect(exportAsWebOptions("jpeg", 0).quality).toBe(1);
    expect(exportAsWebOptions("jpeg", 900).quality).toBe(100);
    expect(exportAsWebOptions("jpeg", 82.4).quality).toBe(82);
  });
});

describe("Export As previews with the encoder that writes the file", () => {
  const app = read("../state/app.ts");
  const dialogs = read("./Dialogs.tsx");

  it("writes 1× through the tagged engine encoders", () => {
    const body = section(app, "export const exportAs = recordedCall(", "export interface LayerExportTarget");
    expect(body).toContain("export_gif(10)");
    // The hoisted `icc` IS exportIccBytes(), pinned before the desktop folder
    // pick (#505) so the rows tag with the starting document's profile.
    expect(body).toContain("const icc = exportIccBytes();");
    expect(body).toContain("export_jpeg_with_icc(quality, icc)");
    expect(body).toContain("export_png_with_icc(icc)");
  });

  it("reaches those same encoders for the preview's option set", () => {
    // matte transparent + no sRGB convert ⇒ no pixel work ⇒ metadata "all"
    // takes webExportBytes down the tagged-engine path exportAs writes with.
    const body = section(app, "export async function webExportBytes(", "/** Save for Web's \"Optimize to File Size\"");
    expect(body).toContain('opts.metadata === "all"');
    expect(body).toContain("export_gif(10)");
    expect(body).toContain("export_jpeg_with_icc(opts.quality, exportIccBytes())");
    expect(body).toContain("export_png_with_icc(exportIccBytes())");
    expect(section(app, "function webExportPixelWork(", "/** The composite on a canvas"))
      .toContain("return lut || matte !== null ? { lut, lutN, matte } : null;");
  });

  it("wires the dialog's preview, size readout and per-row dimensions", () => {
    const body = section(dialogs, "function ExportPrefs()", "// ── Save for Web (VIS-SFW-02)");
    expect(body).toContain("exportAsWebOptions(format, quality)");
    // Document export only — the composite is not what a layer export writes.
    expect(body).toContain("useWebPreview(previewOpts, 250, documentExport)");
    expect(body).toContain("<WebPreviewPane");
    expect(body).toContain("exportScaleDimensions(docSize.width, docSize.height");
  });

  it("keeps the size readout on every preview pane", () => {
    const pane = section(dialogs, "function WebPreviewPane(", "function SaveForWebDialog(");
    expect(pane).toContain("formatByteSize(preview.bytes)");
    // Download time is Save for Web's; Export As passes no speed and gets none.
    expect(pane).toContain("kbps?: number");
  });
});
