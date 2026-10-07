import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEB_GALLERY_OPTIONS,
  WEB_GALLERY_TEMPLATES,
  applyGalleryTemplate,
  galleryExportOpts,
  galleryHtml,
} from "./webGallery";

describe("galleryHtml", () => {
  it("emits one linked cell per item, referencing images/", () => {
    const html = galleryHtml("Trip", [
      { file: "a.jpg", title: "First" },
      { file: "b.jpg", title: "Second" },
    ]);
    expect(html).toContain("<title>Trip</title>");
    expect(html.match(/class="cell"/g)).toHaveLength(2);
    expect(html).toContain('href="images/a.jpg"');
    expect(html).toContain('src="images/b.jpg"');
  });

  it("escapes HTML in the title and captions (no injection)", () => {
    const html = galleryHtml("A & B <x>", [{ file: "c.jpg", title: '"><script>' }]);
    expect(html).toContain("<title>A &amp; B &lt;x&gt;</title>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("url-encodes spaces in filenames", () => {
    const html = galleryHtml("G", [{ file: "my shot.jpg", title: "t" }]);
    expect(html).toContain("images/my%20shot.jpg");
  });

  it("applies template, site, appearance, labels, and output settings", () => {
    const themed = applyGalleryTemplate(
      {
        ...DEFAULT_WEB_GALLERY_OPTIONS,
        site: {
          siteTitle: "Monet Studio",
          collectionTitle: "Summer",
          description: "Selected work",
          contactName: "Contact",
          contactLink: "https://example.com",
        },
        output: { ...DEFAULT_WEB_GALLERY_OPTIONS.output, quality: 0.72, longEdge: 1600 },
      },
      WEB_GALLERY_TEMPLATES[2],
    );
    const options = { ...themed, imageInfo: "caption" as const };
    const html = galleryHtml("Fallback", [{ file: "a.jpg", title: "Title", caption: "Caption" }], options);

    expect(html).toContain("<title>Summer</title>");
    expect(html).toContain("Monet Studio");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("grid-template-columns: repeat(3, 1fr)");
    expect(html).toContain("object-fit: contain");
    expect(html).toContain("<span>Caption</span>");
    expect(galleryExportOpts(options)).toMatchObject({ format: "jpeg", quality: 0.72, longEdge: 1600 });
  });
});
