// filenameTemplate spec — the pure token/sequence renderer behind export naming.

import { describe, expect, it } from "vitest";

import { renderFilenameTemplate, sanitizeFilename, stripExt, type NameTokens } from "./filenameTemplate";

const tok = (over: Partial<NameTokens> = {}): NameTokens => ({
  name: "DSC_0001",
  copyName: null,
  sequence: 1,
  customText: "",
  ...over,
});

describe("renderFilenameTemplate", () => {
  it("passes the original name through", () => {
    expect(renderFilenameTemplate("{name}", tok(), "jpg")).toBe("DSC_0001.jpg");
  });

  it("expands {copyname} to -CopyName only when present", () => {
    expect(renderFilenameTemplate("{name}{copyname}", tok({ copyName: "Edit" }), "jpg")).toBe("DSC_0001-Edit.jpg");
    expect(renderFilenameTemplate("{name}{copyname}", tok({ copyName: null }), "jpg")).toBe("DSC_0001.jpg");
  });

  it("zero-pads {sequence:N} and leaves {sequence} bare", () => {
    expect(renderFilenameTemplate("{customtext}-{sequence:3}", tok({ customText: "Wedding", sequence: 7 }), "jpg")).toBe(
      "Wedding-007.jpg",
    );
    expect(renderFilenameTemplate("{name}-{sequence}", tok({ sequence: 12 }), "png")).toBe("DSC_0001-12.png");
  });

  it("matches tokens case-insensitively", () => {
    expect(renderFilenameTemplate("{Name}-{SEQUENCE:2}", tok({ sequence: 1 }), "jpg")).toBe("DSC_0001-01.jpg");
  });

  it("sanitizes illegal characters coming from a token value", () => {
    expect(renderFilenameTemplate("{name}", tok({ name: "a/b:c*d" }), "jpg")).toBe("abcd.jpg");
  });

  it("leaves an unknown token's text in place (braces stripped by sanitize)", () => {
    expect(renderFilenameTemplate("{foo}-{name}", tok(), "jpg")).toBe("foo-DSC_0001.jpg");
  });

  it("falls back to 'export' when the template renders empty", () => {
    expect(renderFilenameTemplate("", tok(), "jpg")).toBe("export.jpg");
    expect(renderFilenameTemplate("{copyname}", tok({ copyName: null }), "jpg")).toBe("export.jpg");
  });

  it("trims a dangling separator left by an empty token", () => {
    // "Custom Name - Sequence" preset with no custom text → no leading dash.
    expect(renderFilenameTemplate("{customtext}-{sequence:3}", tok({ customText: "", sequence: 1 }), "jpg")).toBe(
      "001.jpg",
    );
  });

  it("preserves unicode letters and digits", () => {
    expect(renderFilenameTemplate("{customtext}", tok({ customText: "José_日本2026" }), "jpg")).toBe("José_日本2026.jpg");
  });
});

describe("stripExt", () => {
  it("drops a single trailing extension", () => {
    expect(stripExt("DSC_0001.NEF")).toBe("DSC_0001");
  });
  it("drops only the last of multiple dots", () => {
    expect(stripExt("beach.pano.cr2")).toBe("beach.pano");
  });
  it("keeps a leading-dot name and an extensionless name", () => {
    expect(stripExt(".gitignore")).toBe(".gitignore");
    expect(stripExt("RAW")).toBe("RAW");
  });
});

describe("sanitizeFilename unicode", () => {
  it("keeps non-ASCII letters and digits", () => {
    expect(sanitizeFilename("José_日本")).toBe("José_日本");
  });
});

describe("sanitizeFilename", () => {
  it("drops path separators and reserved characters, keeps -._ and letters", () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij");
    expect(sanitizeFilename("foo-bar_1.txt")).toBe("foo-bar_1.txt");
  });
  it("collapses internal whitespace", () => {
    expect(sanitizeFilename("  My   Photo  ")).toBe("My Photo");
  });
});
