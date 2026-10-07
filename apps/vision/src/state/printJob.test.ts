import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { engine, preparePrintJob, store } from "./app";
import { PRINT_DEFAULTS } from "./printSettings";

const printer = new Uint8Array([7, 8]);
const settings = { ...PRINT_DEFAULTS, colorHandling: "photoshop" as const, fit: false, scale: 100 };

function documentEngine() {
  return {
    width: () => 720, height: () => 360,
    undo_pushes: vi.fn(() => 0),
    history_transaction_active: vi.fn(() => false),
    export_print_png: vi.fn(() => new Uint8Array([11])),
    export_png_with_icc: vi.fn(() => new Uint8Array([12])),
  };
}

beforeEach(() => { engine.docGen = 0; });
afterEach(() => { engine.engine = null; vi.restoreAllMocks(); });

it("prints the original document and its profile when the printer profile finishes loading", async () => {
  const source = documentEngine(), icc = new Uint8Array([1, 2, 3]);
  engine.engine = source as never;
  vi.spyOn(store, "state", "get").mockReturnValue({ ...store.state, colorProfileAssigned: true, iccProfileBytes: icc, resolutionPpi: 72 });
  vi.spyOn(store, "workingCmykProfile").mockResolvedValue(printer);
  const job = await preparePrintJob(settings);
  expect(source.export_print_png).toHaveBeenCalledWith(icc, printer, settings.intent, settings.bpc);
  expect(job.png).toEqual(new Uint8Array([11]));
  expect(job.css).toContain("width:10in;height:5in");

  expect((await preparePrintJob({ ...settings, colorHandling: "printer" })).png).toEqual(new Uint8Array([12]));
  expect(source.export_png_with_icc).toHaveBeenCalledWith(icc);
  expect(store.workingCmykProfile).toHaveBeenCalledTimes(1);
});

it.each(["switched", "closed", "edited", "editing"] as const)("refuses a document %s while the printer profile loads", async (change) => {
  const source = documentEngine(), other = documentEngine();
  engine.engine = source as never;
  let resolve!: (profile: Uint8Array) => void;
  vi.spyOn(store, "workingCmykProfile").mockReturnValue(new Promise((done) => { resolve = done; }));
  const pending = preparePrintJob(settings);
  if (change === "switched") engine.engine = other as never;
  else if (change === "closed") engine.engine = null;
  else if (change === "edited") source.undo_pushes.mockReturnValue(1);
  else source.history_transaction_active.mockReturnValue(true);
  resolve(printer);
  await expect(pending).rejects.toThrow(change === "editing" ? "Finish or cancel" : "document changed");
  expect(source.export_print_png).not.toHaveBeenCalled();
  expect(other.export_print_png).not.toHaveBeenCalled();
});
