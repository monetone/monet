// OUT-06: the Web module's Color Palette and Output Settings panels. The dialog
// only moves values into WebGalleryOptions — this pins what those values are
// contracted to do: palette colours reach the page CSS (and a hostile one does
// not), and Output Settings reach the encoder as ExportOptions, including a
// graphic saved watermark (the Export/Print/Web/Slideshow shared list).

import { describe, expect, it } from "vitest";

import type { WatermarkSpecEx } from "./exportImage";
import {
  DEFAULT_WEB_GALLERY_OPTIONS,
  galleryExportOpts,
  galleryHtml,
  type WebGalleryOptions,
} from "./webGallery";

const opts = (over: Partial<WebGalleryOptions> = {}): WebGalleryOptions => ({
  ...DEFAULT_WEB_GALLERY_OPTIONS,
  ...over,
});

describe("Color Palette", () => {
  it("renders the chosen colours and scheme", () => {
    const html = galleryHtml("G", [{ file: "a.jpg", title: "t" }], opts({
      palette: {
        background: "#fafafa",
        text: "#101010",
        detail: "#707070",
        accent: "#c02020",
        scheme: "light",
      },
    }));
    expect(html).toContain("background: #fafafa");
    expect(html).toContain("color: #101010");
    expect(html).toContain("a { color: #c02020; }");
    expect(html).toContain("color-scheme: light");
  });

  it("falls back on a colour that could escape the <style> block", () => {
    const html = galleryHtml("G", [{ file: "a.jpg", title: "t" }], opts({
      palette: { ...DEFAULT_WEB_GALLERY_OPTIONS.palette, background: "#fff; } body { display:none" },
    }));
    expect(html).not.toContain("display:none");
    expect(html).toContain("background: #111");
  });

  it("renders a non-web contact link as plain text, never an href", () => {
    const html = galleryHtml("G", [], opts({
      site: { ...DEFAULT_WEB_GALLERY_OPTIONS.site, contactName: "Me", contactLink: "javascript:alert(1)" },
    }));
    expect(html).toContain('<p class="contact">Me</p>');
    expect(html).not.toContain("javascript:");
  });
});

describe("Output Settings", () => {
  it("carries sharpening, a graphic watermark and the metadata scope to the encoder", () => {
    // A saved watermark is a WatermarkSpecEx — the graphic fields must survive.
    const watermark: WatermarkSpecEx = {
      text: "",
      anchor: "bottom-right",
      opacity: 0.6,
      sizePct: 8,
      insetPct: 3,
      mode: "graphic",
      graphicDataUrl: "data:image/png;base64,AA==",
    };
    expect(
      galleryExportOpts(opts({
        output: {
          quality: 0.9,
          longEdge: 1024,
          sharpen: { media: "glossy", amount: "high" },
          watermark,
          metadata: { include: "copyright", removeLocation: true },
        },
      })),
    ).toEqual({
      format: "jpeg",
      quality: 0.9,
      longEdge: 1024,
      sharpen: { media: "glossy", amount: "high" },
      watermark,
      metadata: { include: "copyright", removeLocation: true },
    });
  });

  it("defaults to the pre-panel behaviour: no sharpening, no watermark, all metadata", () => {
    expect(galleryExportOpts(DEFAULT_WEB_GALLERY_OPTIONS)).toEqual({
      format: "jpeg",
      quality: 0.85,
      longEdge: 2048,
      sharpen: null,
      watermark: null,
      metadata: null,
    });
  });
});
