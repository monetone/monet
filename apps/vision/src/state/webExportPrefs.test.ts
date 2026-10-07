import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_HANDLING_PREFS, DEFAULT_WEB_EXPORT_PREFS,
  isLayerOpenJpegName, normalizeFileHandlingPrefs, normalizeWebExportPrefs, webExportFilename,
} from "./webExportPrefs";

describe("web export and file preferences", () => {
  it("normalizes web export options", () => {
    expect(normalizeWebExportPrefs({ format: "jpeg", quality: 180, matte: "black", convertToSRgb: false })).toEqual({
      format: "jpeg",
      quality: 100,
      matte: "black",
      convertToSRgb: false,
      metadata: "all",
    });
    expect(normalizeWebExportPrefs({ quality: -4 }, DEFAULT_WEB_EXPORT_PREFS).quality).toBe(1);
    // WebP/AVIF now persist rather than falling back to the base format.
    expect(normalizeWebExportPrefs({ format: "webp" }).format).toBe("webp");
    expect(normalizeWebExportPrefs({ format: "avif" }).format).toBe("avif");
    expect(normalizeWebExportPrefs({ format: "bogus" as never }).format).toBe(DEFAULT_WEB_EXPORT_PREFS.format);
    expect(normalizeWebExportPrefs({ metadata: "none" }).metadata).toBe("none");
    expect(normalizeWebExportPrefs({ metadata: "bogus" as never }).metadata).toBe("all");
  });

  it("normalizes file handling preferences", () => {
    expect(normalizeFileHandlingPrefs({ openJpegAsLayer: true, newDocumentBackground: "transparent" })).toEqual({
      openJpegAsLayer: true,
      newDocumentBackground: "transparent",
      photoshop32BitImport: "auto",
      rawDemosaic: "adaptive",
      rawDepth: 16,
    });
    expect(normalizeFileHandlingPrefs({ newDocumentBackground: "bad" as never }, DEFAULT_FILE_HANDLING_PREFS).newDocumentBackground).toBe("white");
    expect(normalizeFileHandlingPrefs({ photoshop32BitImport: "preserve" }).photoshop32BitImport).toBe("preserve");
    expect(normalizeFileHandlingPrefs({ photoshop32BitImport: "bad" as never }).photoshop32BitImport).toBe("auto");
  });

  it("normalizes the Camera Raw import options and keeps them on bad input", () => {
    const chosen = normalizeFileHandlingPrefs({ rawDemosaic: "bilinear", rawDepth: 32 });
    expect(chosen).toMatchObject({ rawDemosaic: "bilinear", rawDepth: 32 });
    // A stored preferences blob from before these options existed loads the defaults.
    expect(normalizeFileHandlingPrefs({ openJpegAsLayer: true })).toMatchObject({ rawDemosaic: "adaptive", rawDepth: 16 });
    // Junk leaves the current choice alone rather than silently resetting it.
    expect(normalizeFileHandlingPrefs({ rawDemosaic: "ahd" as never, rawDepth: 8 as never }, chosen))
      .toMatchObject({ rawDemosaic: "bilinear", rawDepth: 32 });
  });

  it("builds web filenames and detects JPEG names", () => {
    expect(webExportFilename("design.psd", "jpeg")).toBe("design.jpg");
    expect(webExportFilename("design.psd", "gif")).toBe("design.gif");
    expect(isLayerOpenJpegName("photo.JPEG")).toBe(true);
    expect(isLayerOpenJpegName("photo.png")).toBe(false);
  });
});
