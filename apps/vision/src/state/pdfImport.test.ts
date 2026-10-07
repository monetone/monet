// The pure render-scale math (PDF_RE, pdfRenderPlan) lives in
// @monet-ui/monet-imageio and is tested in that package's pdfRaster.test.ts.
// What stays Vision-specific is the open wiring: a `.pdf` opened from disk or
// from the file picker has to reach the pdf.js rasterizer and come back as a new
// image document, and `.pdf` has to be offered by both open dialogs.
//
// Driven end to end here with the rasterizer stubbed (pdf.js needs a browser
// canvas) but the real dispatch, the real PDF_RE and the real filter/accept
// lists in play.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: true }));
const pdf = vi.hoisted(() => ({ pages: 1, rendered: [] as number[] }));
const picked = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("./nativeBoundedRead", () => ({ readNativeFileBounded: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async (options: Record<string, unknown>) => { picked.options.push(options); return null; },
}));
// pdf.js only renders onto a browser canvas, so the two rasterizer entry points
// are stubbed — but PDF_RE comes from its real home, so the dispatch under test
// is the production regex.
vi.mock("./pdfImport", async () => {
  const { PDF_RE } = await import("@monet-ui/monet-imageio");
  return {
    PDF_RE,
    pdfPageCount: async () => pdf.pages,
    pdfPageToPng: async (_bytes: Uint8Array, pageIndex = 0) => {
      pdf.rendered.push(pageIndex);
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, pageIndex]);
    },
  };
});

import { openFileNative, openFiles, openPath, openPdfPage, registerPdfPagePicker, store, type PdfPageRequest } from "./app";
import { readNativeFileBounded } from "./nativeBoundedRead";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"

let openImage: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tauri.enabled = true;
  pdf.pages = 1;
  pdf.rendered.length = 0;
  picked.options.length = 0;
  registerPdfPagePicker(null);
  vi.mocked(readNativeFileBounded).mockResolvedValue(PDF_BYTES);
  openImage = vi.spyOn(store, "openImage").mockImplementation(() => 0 as never);
  vi.spyOn(store, "setActivePath").mockImplementation(() => {});
});
afterEach(() => { registerPdfPagePicker(null); vi.restoreAllMocks(); });

describe("opening a .pdf routes through the PDF rasterizer", () => {
  it("rasterizes page 1 of a single-page PDF into a new image document", async () => {
    await openPath("/docs/report.pdf");

    expect(openImage).toHaveBeenCalledTimes(1);
    expect(pdf.rendered).toEqual([0]);
    // The engine never sees the PDF bytes — it gets the rasterized PNG.
    const [bytes, name] = openImage.mock.calls[0];
    expect(name).toBe("report.pdf");
    expect(Array.from(bytes as Uint8Array).slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("raises the page picker for a multi-page PDF instead of silently taking page 1", async () => {
    pdf.pages = 7;
    const requests: PdfPageRequest[] = [];
    registerPdfPagePicker((req) => requests.push(req));

    await openPath("/docs/report.pdf");

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ name: "report.pdf", path: "/docs/report.pdf", count: 7 });
    expect(openImage).not.toHaveBeenCalled(); // nothing opened until a page is chosen
  });

  it("opens the page the picker chose", async () => {
    await openPdfPage(PDF_BYTES, "report.pdf", "/docs/report.pdf", 4);

    expect(pdf.rendered).toEqual([4]);
    expect(openImage).toHaveBeenCalledTimes(1);
    expect(Array.from(openImage.mock.calls[0][0] as Uint8Array).at(-1)).toBe(4);
  });

  it("does not divert a non-PDF file into the PDF path", async () => {
    vi.mocked(readNativeFileBounded).mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6]));

    await openPath("/docs/shot.png");

    expect(openImage).toHaveBeenCalledTimes(1);
    expect(pdf.rendered).toEqual([]); // the raster decoder handled it
  });
});

describe("pdf is offered by both open dialogs", () => {
  it("the native open dialog lists a PDF filter (and includes pdf in All Supported)", async () => {
    await openFileNative();

    const filters = picked.options[0]?.filters as { name: string; extensions: string[] }[];
    expect(filters).toContainEqual({ name: "PDF", extensions: ["pdf"] });
    expect(filters.find((f) => f.name === "All Supported")?.extensions).toContain("pdf");
  });

  it("the browser file input accepts .pdf", () => {
    tauri.enabled = false;
    const inputs: Record<string, unknown>[] = [];
    (globalThis as Record<string, unknown>).document = {
      body: { appendChild() {} },
      createElement: () => {
        const el = { type: "", multiple: false, accept: "", style: {}, onchange: null, click() {}, remove() {} };
        inputs.push(el);
        return el;
      },
    };

    openFiles();

    expect(inputs).toHaveLength(1);
    expect(String(inputs[0].accept)).toContain(".pdf");
  });
});
