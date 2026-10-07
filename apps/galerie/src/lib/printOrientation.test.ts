// Page orientation (OUT-12): landscape is the portrait PAGE_SIZES entry with
// w/h swapped, and downstream geometry sees the rotated page.
import { describe, expect, it } from "vitest";

import { fitOnPage, orientPage, PAGE_SIZES } from "./printLayout";

describe("orientPage", () => {
  it("portrait returns the size unchanged", () => {
    for (const name of Object.keys(PAGE_SIZES)) {
      expect(orientPage(PAGE_SIZES[name], "portrait")).toEqual(PAGE_SIZES[name]);
    }
  });

  it("landscape swaps width and height", () => {
    expect(orientPage(PAGE_SIZES.Letter, "landscape")).toEqual({ w: 3300, h: 2550 });
    expect(orientPage(PAGE_SIZES.A4, "landscape")).toEqual({ w: 3508, h: 2480 });
  });

  it("a panorama fills a landscape page wider than a portrait one", () => {
    const img = { w: 6000, h: 2000 };
    const p = orientPage(PAGE_SIZES.Letter, "portrait");
    const l = orientPage(PAGE_SIZES.Letter, "landscape");
    const onPortrait = fitOnPage(img.w, img.h, p.w, p.h, 75);
    const onLandscape = fitOnPage(img.w, img.h, l.w, l.h, 75);
    expect(onLandscape.w).toBeGreaterThan(onPortrait.w);
    // Both stay within their page's printable box.
    expect(onLandscape.x + onLandscape.w).toBeLessThanOrEqual(l.w - 75);
    expect(onPortrait.x + onPortrait.w).toBeLessThanOrEqual(p.w - 75);
  });
});
