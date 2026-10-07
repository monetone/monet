import { describe, it, expect } from "vitest";
import { svgIntrinsicSize, withExplicitSize, SVG_RE } from "./svgRaster";

describe("SVG_RE", () => {
  it("matches .svg names case-insensitively, not others", () => {
    expect(SVG_RE.test("art.svg")).toBe(true);
    expect(SVG_RE.test("ART.SVG")).toBe(true);
    expect(SVG_RE.test("art.svgz")).toBe(false);
    expect(SVG_RE.test("art.png")).toBe(false);
  });
});

describe("svgIntrinsicSize", () => {
  it("reads explicit width/height (plain and px)", () => {
    expect(svgIntrinsicSize('<svg width="240" height="120"></svg>')).toEqual({ w: 240, h: 120 });
    expect(svgIntrinsicSize('<svg width="240px" height="120px"></svg>')).toEqual({ w: 240, h: 120 });
  });

  it("rounds fractional sizes", () => {
    expect(svgIntrinsicSize('<svg width="99.6" height="10.2"></svg>')).toEqual({ w: 100, h: 10 });
  });

  it("falls back to the viewBox extent when width/height are missing", () => {
    expect(svgIntrinsicSize('<svg viewBox="0 0 64 48"></svg>')).toEqual({ w: 64, h: 48 });
    expect(svgIntrinsicSize('<svg viewBox="0,0,64,48"></svg>')).toEqual({ w: 64, h: 48 }); // comma separators
  });

  it("uses the viewBox for the axis whose unit isn't px (e.g. %)", () => {
    expect(svgIntrinsicSize('<svg width="100%" height="100%" viewBox="0 0 30 20"></svg>')).toEqual({ w: 30, h: 20 });
  });

  it("defaults when nothing usable is present", () => {
    expect(svgIntrinsicSize("<svg></svg>")).toEqual({ w: 512, h: 512 });
    expect(svgIntrinsicSize("<svg></svg>", 200)).toEqual({ w: 200, h: 200 });
    expect(svgIntrinsicSize("not svg at all")).toEqual({ w: 512, h: 512 });
  });

  it("clamps to a sane maximum and minimum", () => {
    expect(svgIntrinsicSize('<svg width="999999" height="1"></svg>')).toEqual({ w: 8192, h: 1 });
    expect(svgIntrinsicSize('<svg width="0" height="-5"></svg>')).toEqual({ w: 512, h: 512 }); // non-positive → default
  });

  it("ignores attributes on child elements (only the root svg tag)", () => {
    expect(svgIntrinsicSize('<svg width="40" height="40"><rect width="999" height="999"/></svg>')).toEqual({ w: 40, h: 40 });
  });

  it("ignores a commented-out root tag in the preamble (#95)", () => {
    const text = '<?xml version="1.0"?>\n<!-- <svg width="1" height="1"> -->\n<svg width="2000" height="1500"></svg>';
    expect(svgIntrinsicSize(text)).toEqual({ w: 2000, h: 1500 });
  });

  it("reads past a '>' inside a quoted attribute value (#95)", () => {
    expect(svgIntrinsicSize(`<svg style="font-family:'a>b'" width="300" height="200"></svg>`)).toEqual({ w: 300, h: 200 });
  });
});

describe("withExplicitSize", () => {
  it("adds width/height to a viewBox-only root", () => {
    const out = withExplicitSize('<svg viewBox="0 0 64 48" xmlns="http://www.w3.org/2000/svg"><rect/></svg>', 64, 48);
    expect(out).toMatch(/<svg[^>]*viewBox="0 0 64 48"/);
    expect(out).toMatch(/width="64"/);
    expect(out).toMatch(/height="48"/);
    expect(out).toContain("<rect/>"); // body preserved
  });

  it("replaces any existing width/height rather than duplicating", () => {
    const out = withExplicitSize('<svg width="10" height="10" viewBox="0 0 64 48"></svg>', 64, 48);
    expect(out.match(/width=/g)?.length).toBe(1);
    expect(out.match(/height=/g)?.length).toBe(1);
    expect(out).toContain('width="64"');
    expect(out).toContain('height="48"');
  });

  it("sizes the real root, not a commented-out one, and keeps the comment (#95)", () => {
    const text = '<!-- <svg width="1" height="1"> -->\n<svg viewBox="0 0 64 48"><rect/></svg>';
    const out = withExplicitSize(text, 64, 48);
    expect(out).toContain('<!-- <svg width="1" height="1"> -->'); // comment untouched
    expect(out).toContain('<svg viewBox="0 0 64 48" width="64" height="48">');
  });

  it("keeps a quoted attribute containing '>' intact (#95)", () => {
    const out = withExplicitSize(`<svg style="font-family:'a>b'" width="10"><rect/></svg>`, 64, 48);
    expect(out).toContain(`style="font-family:'a>b'"`);
    expect(out).toContain('width="64"');
    expect(out).toContain("<rect/>");
    expect(out.match(/width=/g)?.length).toBe(1);
  });
});
