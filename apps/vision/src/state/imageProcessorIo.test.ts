import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { crc32, fitWithinScale, imageProcessorTargets, jpegWithComment, pngWithCopyright, IMAGE_PROCESSOR_DIR, IMAGE_PROCESSOR_EXT, IMAGE_PROCESSOR_MIME } from "./imageProcessorIo";

describe("fitWithinScale", () => {
  it("downscales to fit within the box", () => {
    expect(fitWithinScale(2000, 1000, 1000, 1000)).toBe(0.5);
    expect(fitWithinScale(1000, 2000, 1000, 1000)).toBe(0.5);
  });

  it("never upscales and treats a non-positive max as no resize", () => {
    expect(fitWithinScale(500, 400, 1920, 1080)).toBe(1);
    expect(fitWithinScale(2000, 1000, 0, 0)).toBe(1);
  });
});

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("jpegWithComment", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9]);

  it("inserts a COM segment right after SOI with the marker length prefix", () => {
    const out = jpegWithComment(jpeg, "© Monet");
    const payload = new TextEncoder().encode("© Monet");
    expect(Array.from(out.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(out.subarray(2, 4))).toEqual([0xff, 0xfe]);
    expect((out[4] << 8) | out[5]).toBe(payload.length + 2);
    expect(Array.from(out.subarray(6, 6 + payload.length))).toEqual(Array.from(payload));
    // the rest of the stream is untouched
    expect(Array.from(out.subarray(6 + payload.length))).toEqual(Array.from(jpeg.subarray(2)));
  });

  it("returns the input unchanged for empty text or a non-JPEG", () => {
    expect(jpegWithComment(jpeg, "")).toBe(jpeg);
    const png = new Uint8Array([0x89, 0x50]);
    expect(jpegWithComment(png, "x")).toBe(png);
  });
});

describe("pngWithCopyright", () => {
  // signature + IHDR (13-byte body) + IEND, both with real CRCs
  const png = (() => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = new Uint8Array(12 + 13);
    new DataView(ihdr.buffer).setUint32(0, 13);
    ihdr.set([0x49, 0x48, 0x44, 0x52], 4);
    new DataView(ihdr.buffer).setUint32(8 + 13, crc32(ihdr.subarray(4, 8 + 13)));
    const iend = new Uint8Array(12);
    iend.set([0x49, 0x45, 0x4e, 0x44], 4);
    new DataView(iend.buffer).setUint32(8, crc32(iend.subarray(4, 8)));
    return new Uint8Array([...sig, ...ihdr, ...iend]);
  })();

  it("inserts a valid iTXt Copyright chunk right after IHDR", () => {
    const out = pngWithCopyright(png, "© Légoless");
    const at = 33; // 8 sig + 25 IHDR
    const len = new DataView(out.buffer).getUint32(at);
    expect(Array.from(out.subarray(at + 4, at + 8))).toEqual([0x69, 0x54, 0x58, 0x74]); // "iTXt"
    const body = out.subarray(at + 8, at + 8 + len);
    expect(new TextDecoder().decode(body)).toBe("Copyright\0\0\0\0\0© Légoless");
    const crc = new DataView(out.buffer).getUint32(at + 8 + len);
    expect(crc).toBe(crc32(out.subarray(at + 4, at + 8 + len)));
    // IEND still terminates the file
    expect(Array.from(out.subarray(out.length - 8, out.length - 4))).toEqual([0x49, 0x45, 0x4e, 0x44]);
  });

  it("returns the input unchanged for empty text or a non-PNG", () => {
    expect(pngWithCopyright(png, "")).toBe(png);
    const jpeg = new Uint8Array([0xff, 0xd8]);
    expect(pngWithCopyright(jpeg, "x")).toBe(jpeg);
  });
});

describe("format tables", () => {
  it("cover every simultaneous output format", () => {
    expect(IMAGE_PROCESSOR_EXT).toEqual({ jpeg: "jpg", png: "png", psd: "psd", tiff: "tif" });
    expect(IMAGE_PROCESSOR_DIR).toEqual({ jpeg: "JPEG", png: "PNG", psd: "PSD", tiff: "TIFF" });
    expect(Object.keys(IMAGE_PROCESSOR_MIME).sort()).toEqual(Object.keys(IMAGE_PROCESSOR_EXT).sort());
  });
});

describe("imageProcessorTargets", () => {
  it("writes into the format folder and leaves an existing file untouched", () => {
    const existing = new Set(["photo.jpg"]);
    const { write, refused } = imageProcessorTargets(["a.png", "photo.png", "b.png"], "jpeg", existing);
    expect(write).toEqual(["JPEG/a.jpg", "JPEG/b.jpg"]);
    expect(refused).toEqual(["JPEG/photo.jpg"]);
    expect([...existing]).toEqual(["photo.jpg"]);
  });

  it("refuses a second input that would land on a name this batch already claimed", () => {
    const { write, refused } = imageProcessorTargets(["a.png", "a.tif"], "jpeg", new Set());
    expect(write).toEqual(["JPEG/a.jpg"]);
    expect(refused).toEqual(["JPEG/a.jpg"]);
  });
});

// Source-text wiring assertions in the house photoshopAppWiring.test.ts style —
// app.ts cannot be imported under vitest (engine/Tauri singletons).
describe("Image Processor wiring", () => {
  const appSource = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
  const dialogSource = readFileSync(fileURLToPath(new URL("../ui/Dialogs.tsx", import.meta.url)), "utf8");

  it("runs the chosen action, multi-format saves, copyright and destination", () => {
    const from = appSource.indexOf("export async function imageProcessor(opts: ImageProcessorOptions)");
    expect(from).toBeGreaterThanOrEqual(0);
    const body = appSource.slice(from, appSource.indexOf("\n}", from));
    expect(body).toContain("await actions.playNamed(opts.actionId)");
    expect(body).toContain("for (const save of opts.saves)");
    expect(body).toContain("jpegWithComment(E().export_jpeg_with_icc(save.quality ?? 85, icc), copyright)");
    expect(body).toContain("pngWithCopyright(E().export_png_with_icc(icc), copyright)");
    expect(body).toContain("writeBatchOutput(subDir");
    expect(body).toContain("IMAGE_PROCESSOR_DIR[save.format]");
    expect(body).toContain("already exists");
    expect(body).toContain("reportSave(e)");
    expect(body).toContain("closeDocumentTab(docId, true)");
    expect(body).toContain("opts.onProgress?.(index + 1, files.length, file.name)");
    expect(body).toContain("opts.signal?.aborted");
  });

  // A Step By Step or Stop pause is async, so a batch that did not await
  // playback would write each file before the user answered (#480).
  it("batch waits for playback to finish before writing output", () => {
    const from = appSource.indexOf("async function runBatchInputs(");
    expect(from).toBeGreaterThanOrEqual(0);
    const body = appSource.slice(from, appSource.indexOf("\n}", from));
    expect(body).toContain("await actions.playNamed(resolved, 0, skipOps)");
    expect(body).toContain("await actions.play(skipOps)");
    expect(body).toContain('if (played === false) throw new Error("The action stopped before it finished.")');
    expect(body.indexOf("await actions.play(skipOps)")).toBeLessThan(body.indexOf("writeBatchOutput("));
  });

  it("dialog exposes destination, file types, quality, action and copyright", () => {
    const from = dialogSource.indexOf("function ImageProcessor()");
    expect(from).toBeGreaterThanOrEqual(0);
    const body = dialogSource.slice(from, dialogSource.indexOf("\nfunction ", from + 1));
    for (const needle of ["pickDest", "mv-imageproc-jpeg", "mv-imageproc-tiff", "setQuality", "mv-imageproc-action", "mv-imageproc-copyright"]) {
      expect(body).toContain(needle);
    }
    expect(body).toContain("`${index} of ${total} — ${name}`");
    expect(body).toContain("`Stopped. ${processed} processed.`");
    expect(body).toContain("`${processed} processed.`");
    expect(body).toContain('running ? "Stop" : "Cancel"');
    const runFrom = body.indexOf("const run = () => {");
    const runBody = body.slice(runFrom, body.indexOf("const row =", runFrom));
    expect(runBody).not.toContain("close(");
  });

  it("Fit Image records the box, and the dialog asks the transform for that box", () => {
    const from = dialogSource.indexOf("function FitImage()");
    expect(from).toBeGreaterThanOrEqual(0);
    const body = dialogSource.slice(from, dialogSource.indexOf("\nfunction ", from + 1));
    expect(body).toContain("xform.fitImage(w, h)");
    expect(body).not.toContain("Math.min");
  });
});
