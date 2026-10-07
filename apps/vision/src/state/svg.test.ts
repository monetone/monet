// svgToPng is the whole SVG-open path: blob URL → secure-static-mode <img> →
// canvas → PNG. Only e2e ever ran it, so the intrinsic-size handoff, the
// object-URL lifecycle and both throw branches were unasserted. vitest runs in
// node here, so the four DOM primitives it touches (Image, document.createElement,
// URL.createObjectURL/revokeObjectURL) are stubbed — everything under test is the
// real module.
import { afterEach, describe, expect, it, vi } from "vitest";
import { svgToPng } from "./svg";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

type CanvasStub = {
  width: number;
  height: number;
  getContext: (kind: string) => { drawImage: ReturnType<typeof vi.fn> } | null;
  toBlob: (cb: (blob: Blob | null) => void, type?: string) => void;
};

function stubDom(options: { context?: boolean; encode?: boolean; load?: boolean } = {}) {
  const { context = true, encode = true, load = true } = options;
  const drawImage = vi.fn();
  const urls: string[] = [];
  const revoked: string[] = [];
  const blobs: Blob[] = [];
  const canvases: CanvasStub[] = [];
  const toBlobTypes: (string | undefined)[] = [];
  const loaded: unknown[] = [];

  vi.stubGlobal("URL", {
    createObjectURL: (blob: Blob) => {
      blobs.push(blob);
      const url = `blob:svg-${urls.length}`;
      urls.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => { revoked.push(url); },
  });

  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: ((reason?: unknown) => void) | null = null;
    #src = "";
    get src() { return this.#src; }
    set src(value: string) {
      this.#src = value;
      loaded.push(value);
      queueMicrotask(() => (load ? this.onload?.() : this.onerror?.(new Error("decode failed"))));
    }
  });

  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      expect(tag).toBe("canvas");
      const canvas: CanvasStub = {
        width: 0,
        height: 0,
        getContext: () => (context ? { drawImage } : null),
        toBlob: (cb, type) => {
          toBlobTypes.push(type);
          cb(encode ? new Blob([PNG_BYTES as unknown as BlobPart], { type: "image/png" }) : null);
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  });

  return { drawImage, urls, revoked, blobs, canvases, toBlobTypes, loaded };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("svgToPng", () => {
  it("rasterizes at the SVG's intrinsic size and returns the encoded PNG bytes", async () => {
    const dom = stubDom();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="25"><rect width="40" height="25"/></svg>';

    const png = await svgToPng(new TextEncoder().encode(svg));

    expect(png).toEqual(PNG_BYTES);
    expect(dom.canvases[0].width).toBe(40);
    expect(dom.canvases[0].height).toBe(25);
    expect(dom.drawImage).toHaveBeenCalledTimes(1);
    expect(dom.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 40, 25]);
    expect(dom.toBlobTypes).toEqual(["image/png"]);
  });

  it("sizes a viewBox-only SVG from its viewBox and hands the <img> explicit width/height", async () => {
    const dom = stubDom();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="10" height="10"/></svg>';

    await svgToPng(new TextEncoder().encode(svg));

    expect(dom.canvases[0].width).toBe(120);
    expect(dom.canvases[0].height).toBe(60);
    // A viewBox-only SVG otherwise decodes at a tiny default size, so the blob
    // handed to the <img> must carry the measured size explicitly.
    expect(dom.blobs).toHaveLength(1);
    expect(dom.blobs[0].type).toBe("image/svg+xml");
    const text = await dom.blobs[0].text();
    expect(text).toContain('width="120"');
    expect(text).toContain('height="60"');
    // The <img> loads the object URL, never the raw markup.
    expect(dom.loaded).toEqual(dom.urls);
  });

  it("revokes the object URL after a successful rasterize", async () => {
    const dom = stubDom();

    await svgToPng(new TextEncoder().encode('<svg width="8" height="8"></svg>'));

    expect(dom.revoked).toEqual(dom.urls);
  });

  it("throws when no 2D context is available, still revoking the object URL", async () => {
    const dom = stubDom({ context: false });

    await expect(svgToPng(new TextEncoder().encode('<svg width="8" height="8"></svg>')))
      .rejects.toThrow("2D canvas unavailable");
    expect(dom.revoked).toEqual(dom.urls);
  });

  it("throws when the canvas cannot encode a PNG, still revoking the object URL", async () => {
    const dom = stubDom({ encode: false });

    await expect(svgToPng(new TextEncoder().encode('<svg width="8" height="8"></svg>')))
      .rejects.toThrow("PNG encode failed");
    expect(dom.revoked).toEqual(dom.urls);
  });

  it("rejects and revokes the object URL when the SVG fails to decode", async () => {
    const dom = stubDom({ load: false });

    await expect(svgToPng(new TextEncoder().encode("not an svg at all"))).rejects.toBeDefined();
    expect(dom.revoked).toEqual(dom.urls);
    expect(dom.drawImage).not.toHaveBeenCalled();
  });
});
