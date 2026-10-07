// OUT-01: the Print dialog can point the Print Job at a real printer, not only
// a JPEG file. Pins runPrint's wiring: the chosen destination reaches print.ts
// as job.to, a printer job's null dest is success (the spooler owns the
// output), and a cancelled save dialog keeps the dialog open.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));
vi.mock("../export", () => ({ developToImage: vi.fn() }));
vi.mock("../print", async (importOriginal) => {
  const real = await importOriginal<typeof import("../print")>();
  return { ...real, printPhoto: vi.fn(), printContactSheet: vi.fn(), printPicturePackage: vi.fn() };
});

import type { PhotoRow } from "../catalog/types";
import { PAGE_SIZES } from "../lib/printLayout";
import { DEFAULT_PRINT_JOB, printContactSheet, printPhoto, printPicturePackage } from "../print";
import { type PrintRun, runPrint } from "./PrintDialog";

const photo = { id: 1, path: "/photos/a.cr3", format: "raw:CR3" } as PhotoRow;
const margin = { top: 75, right: 75, bottom: 75, left: 75 };
const run = (over: Partial<PrintRun>): PrintRun => ({
  layout: "single",
  to: "printer",
  page: PAGE_SIZES.Letter,
  margin,
  gutter: 30,
  quality: 0.92,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("runPrint destination wiring", () => {
  it("Print to = Printer hands print.ts a printer job", async () => {
    vi.mocked(printPhoto).mockResolvedValue({ to: "printer", dest: null, drawn: 1, failed: 0, dropped: 0, pages: 1 });
    const out = await runPrint([photo], run({ to: "printer" }));

    expect(printPhoto).toHaveBeenCalledWith(
      photo,
      expect.objectContaining({ job: { ...DEFAULT_PRINT_JOB, to: "printer" } }),
    );
    expect(out).toEqual({ kind: "done", toast: "Sent to printer." });
  });

  it("Print to = JPEG File still writes a file", async () => {
    vi.mocked(printPhoto).mockResolvedValue({ to: "jpeg", dest: "/out/print.jpg", drawn: 1, failed: 0, dropped: 0, pages: 1 });
    const out = await runPrint([photo], run({ to: "jpeg" }));

    expect(printPhoto).toHaveBeenCalledWith(
      photo,
      expect.objectContaining({ quality: 0.92, job: { ...DEFAULT_PRINT_JOB, to: "jpeg" } }),
    );
    expect(out).toEqual({ kind: "done", toast: "Printed to JPEG." });
  });

  it("a cancelled save dialog keeps the print dialog open", async () => {
    vi.mocked(printPhoto).mockResolvedValue(null);
    expect(await runPrint([photo], run({ to: "jpeg" }))).toEqual({ kind: "cancelled" });
  });
});

describe("runPrint contact sheet / picture package", () => {
  it("a spooled contact sheet's null dest is success, not failure", async () => {
    vi.mocked(printContactSheet).mockResolvedValue({ to: "printer", dest: null, drawn: 4, failed: 0, dropped: 0, pages: 1 });
    const out = await runPrint([photo, photo, photo, photo], run({ layout: "contact", grid: { rows: 2, cols: 2 } }));

    expect(printContactSheet).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ gutter: 30, grid: { rows: 2, cols: 2 }, job: expect.objectContaining({ to: "printer" }) }),
    );
    expect(out).toEqual({ kind: "done", toast: "Contact sheet: 4 placed." });
  });

  it("a paginated contact sheet's toast reports the page count", async () => {
    vi.mocked(printContactSheet).mockResolvedValue({ to: "jpeg", dest: "/out/cs.jpg", drawn: 60, failed: 0, dropped: 0, pages: 7 });
    const out = await runPrint(Array(60).fill(photo), run({ layout: "contact", to: "jpeg", grid: { rows: 3, cols: 3 } }));
    expect(out).toEqual({ kind: "done", toast: "Contact sheet: 60 placed on 7 pages." });
  });

  it("a contact sheet where every photo failed reports failure", async () => {
    vi.mocked(printContactSheet).mockResolvedValue({ to: "printer", dest: null, drawn: 0, failed: 3, dropped: 0, pages: 1 });
    const out = await runPrint([photo, photo, photo], run({ layout: "contact" }));
    expect(out).toEqual({ kind: "failed", message: "Contact sheet failed: all 3 photos could not be rendered." });
  });

  it("a picture package passes its cell sizes and reports a page nothing fits", async () => {
    vi.mocked(printPicturePackage).mockResolvedValue({ to: "printer", dest: null, drawn: 0, failed: 0, dropped: 2, pages: 1 });
    const sizes = [{ w: 1500, h: 1050 }];
    const out = await runPrint([photo], run({ layout: "package", sizes }));

    expect(printPicturePackage).toHaveBeenCalledWith(photo, expect.objectContaining({ sizes }));
    expect(out).toEqual({ kind: "failed", message: "Picture package: no cells fit the page." });
  });
});
