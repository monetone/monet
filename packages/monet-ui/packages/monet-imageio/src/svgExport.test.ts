import { describe, it, expect } from "vitest";
import { embedRasterInSvg } from "./svgExport";

const PATHS = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3" viewBox="0 0 4 3">
  <path fill="none" stroke="#000" d="M0,0 L4,0 L4,3 Z" />
</svg>
`;

describe("embedRasterInSvg", () => {
  it("inserts the raster <image> after the opening <svg> tag, before the paths", () => {
    const out = embedRasterInSvg(PATHS, 4, 3, "QUJD");
    expect(out).toContain('href="data:image/png;base64,QUJD"');
    expect(out).toContain('width="4" height="3"'); // the embedded image dims
    // The <image> background must precede the vector <path> so paths overlay it.
    expect(out.indexOf("<image")).toBeLessThan(out.indexOf("<path"));
    // The original paths + closing tag survive.
    expect(out).toContain('d="M0,0 L4,0 L4,3 Z"');
    expect(out.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("returns the input unchanged when there is no <svg> open tag", () => {
    expect(embedRasterInSvg("not svg", 1, 1, "AA")).toBe("not svg");
  });
});
