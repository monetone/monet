// pdfImport.test.ts drives the *dispatch* (a .pdf reaching the rasterizer) with
// the rasterizer stubbed. This file is the other half: pdfPageCount and
// pdfPageToPng themselves — the empty-input guard, the buffer copy pdf.js would
// otherwise detach, the out-of-range page guard, the white paper background, the
// clamped canvas size and both encode failures. pdf.js and the 2D canvas are the
// only stubs; everything asserted is the real module.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"

const pdfjs = vi.hoisted(() => ({
  numPages: 3,
  pagePoints: { w: 612, h: 792 },
  loadError: null as Error | null,
  workerOptions: { workerSrc: "" },
  documentArgs: [] as { data: Uint8Array }[],
  destroyed: 0,
  renders: [] as { canvas: unknown; viewport: { scale: number }; background?: string }[],
  requestedPages: [] as number[],
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: pdfjs.workerOptions,
  getDocument: (args: { data: Uint8Array }) => {
    pdfjs.documentArgs.push(args);
    const loadingTask = {
      destroy: () => { pdfjs.destroyed += 1; return Promise.resolve(); },
      promise: Promise.resolve(null as unknown),
    };
    const doc = {
      numPages: pdfjs.numPages,
      loadingTask,
      getPage: async (pageNumber: number) => {
        pdfjs.requestedPages.push(pageNumber);
        return {
          getViewport: ({ scale }: { scale: number }) => ({
            scale,
            width: pdfjs.pagePoints.w * scale,
            height: pdfjs.pagePoints.h * scale,
          }),
          render: (options: { canvas: unknown; viewport: { scale: number }; background?: string }) => {
            pdfjs.renders.push(options);
            return { promise: Promise.resolve() };
          },
        };
      },
    };
    loadingTask.promise = pdfjs.loadError ? Promise.reject(pdfjs.loadError) : Promise.resolve(doc);
    return loadingTask;
  },
}));

import { PDF_MAX_DIM, pdfPageCount, pdfPageToPng, pdfRenderPlan } from "./pdfImport";

type CanvasStub = { width: number; height: number; getContext: () => object | null; toBlob: (cb: (b: Blob | null) => void, type?: string) => void };
const canvasState = { context: true as boolean, encode: true as boolean, made: [] as CanvasStub[] };

beforeEach(() => {
  pdfjs.numPages = 3;
  pdfjs.pagePoints = { w: 612, h: 792 };
  pdfjs.loadError = null;
  pdfjs.documentArgs.length = 0;
  pdfjs.destroyed = 0;
  pdfjs.renders.length = 0;
  pdfjs.requestedPages.length = 0;
  canvasState.context = true;
  canvasState.encode = true;
  canvasState.made.length = 0;

  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      expect(tag).toBe("canvas");
      const canvas: CanvasStub = {
        width: 0,
        height: 0,
        getContext: () => (canvasState.context ? {} : null),
        toBlob: (cb) => cb(canvasState.encode ? new Blob([PNG_BYTES as unknown as BlobPart], { type: "image/png" }) : null),
      };
      canvasState.made.push(canvas);
      return canvas;
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("pdfPageCount", () => {
  it("reports the page count and always tears the document down", async () => {
    pdfjs.numPages = 7;

    await expect(pdfPageCount(PDF_BYTES)).resolves.toBe(7);
    expect(pdfjs.destroyed).toBe(1);
  });

  it("refuses empty input before ever loading pdf.js", async () => {
    await expect(pdfPageCount(new Uint8Array())).rejects.toThrow("Empty PDF");
    await expect(pdfPageToPng(new Uint8Array())).rejects.toThrow("Empty PDF");
    expect(pdfjs.documentArgs).toHaveLength(0);
  });

  it("propagates a corrupt-document failure", async () => {
    pdfjs.loadError = new Error("InvalidPDFException");

    await expect(pdfPageCount(PDF_BYTES)).rejects.toThrow("InvalidPDFException");
  });

  it("hands pdf.js a copy, so a second read of the same bytes still works", async () => {
    await pdfPageCount(PDF_BYTES);
    await pdfPageToPng(PDF_BYTES, 0);

    expect(pdfjs.documentArgs).toHaveLength(2);
    for (const args of pdfjs.documentArgs) {
      expect(args.data).not.toBe(PDF_BYTES); // pdf.js may detach what it is given
      expect(args.data).toEqual(PDF_BYTES);
    }
  });

  it("points pdf.js at the locally bundled worker, never a CDN", async () => {
    await pdfPageCount(PDF_BYTES);

    expect(pdfjs.workerOptions.workerSrc).toBeTruthy();
    expect(pdfjs.workerOptions.workerSrc).not.toMatch(/^https?:/);
  });
});

describe("pdfPageToPng", () => {
  it("renders the requested 0-based page onto white paper at the planned size", async () => {
    const png = await pdfPageToPng(PDF_BYTES, 2);

    expect(png).toEqual(PNG_BYTES);
    expect(pdfjs.requestedPages).toEqual([3]); // pdf.js pages are 1-based
    const plan = pdfRenderPlan(612, 792);
    expect(canvasState.made[0].width).toBe(plan.w);
    expect(canvasState.made[0].height).toBe(plan.h);
    expect(pdfjs.renders).toHaveLength(1);
    expect(pdfjs.renders[0].canvas).toBe(canvasState.made[0]);
    expect(pdfjs.renders[0].viewport.scale).toBe(plan.scale);
    expect(pdfjs.renders[0].background).toBe("#ffffff"); // opaque paper, not transparent
    expect(pdfjs.destroyed).toBe(1);
  });

  it("defaults to the first page", async () => {
    await pdfPageToPng(PDF_BYTES);

    expect(pdfjs.requestedPages).toEqual([1]);
  });

  it("forwards the caller's clamp options to the render plan", async () => {
    await pdfPageToPng(PDF_BYTES, 0, { maxDim: 100 });

    const plan = pdfRenderPlan(612, 792, { maxDim: 100 });
    expect(canvasState.made[0].height).toBe(plan.h);
    expect(canvasState.made[0].height).toBeLessThanOrEqual(100);
    expect(pdfjs.renders[0].viewport.scale).toBe(plan.scale);
  });

  it("never allocates an enormous canvas for a huge page", async () => {
    pdfjs.pagePoints = { w: 200_000, h: 200_000 };

    await pdfPageToPng(PDF_BYTES);

    expect(canvasState.made[0].width).toBeLessThanOrEqual(PDF_MAX_DIM);
    expect(canvasState.made[0].height).toBeLessThanOrEqual(PDF_MAX_DIM);
  });

  it("rejects an out-of-range or non-integer page without rendering, still tearing down", async () => {
    for (const bad of [3, 99, -1, 1.5, Number.NaN]) {
      pdfjs.destroyed = 0;
      await expect(pdfPageToPng(PDF_BYTES, bad)).rejects.toThrow(/PDF has no page/);
      expect(pdfjs.renders).toHaveLength(0);
      expect(pdfjs.destroyed).toBe(1);
    }
  });

  it("names both the requested and the available page count in the range error", async () => {
    await expect(pdfPageToPng(PDF_BYTES, 5)).rejects.toThrow("PDF has no page 6 (of 3)");
  });

  it("throws when no 2D context is available, still tearing the document down", async () => {
    canvasState.context = false;

    await expect(pdfPageToPng(PDF_BYTES)).rejects.toThrow("2D canvas unavailable");
    expect(pdfjs.renders).toHaveLength(0);
    expect(pdfjs.destroyed).toBe(1);
  });

  it("throws when the canvas cannot encode a PNG, still tearing the document down", async () => {
    canvasState.encode = false;

    await expect(pdfPageToPng(PDF_BYTES)).rejects.toThrow("PNG encode failed");
    expect(pdfjs.destroyed).toBe(1);
  });
});
