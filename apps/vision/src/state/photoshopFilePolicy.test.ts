import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { readWithinFileSizeLimit } from "./boundedRead";
import { SUPPORTED_SAVE_EXTENSIONS } from "./nativeIoPolicy";
import { MAX_PROJECT_ENVELOPE_BYTES } from "./projectEnvelope";
import {
  MAX_IMAGE_STACK_SOURCE_BYTES,
  MAX_MVIS_SOURCE_BYTES,
  MAX_OPEN_IMAGE_SOURCE_BYTES,
  MAX_PHOTOSHOP_SOURCE_BYTES,
  MAX_PLACED_IMAGE_SOURCE_BYTES,
  MAX_PSB_SOURCE_BYTES,
  PHOTOSHOP_RGB_COLOR_MODE,
  documentFormatReadLimit,
  hasPhotoshopExtension,
  imageReadLimit,
  nextImageStackReadTotal,
  photoshopHeader,
  photoshopVersion,
  savePayloadTooLarge,
  shouldRouteAsPhotoshop,
  usesPhotoshopRgbProfilePolicy,
} from "./photoshopFilePolicy";

function photoshopBytes(version: 1 | 2, colorMode = PHOTOSHOP_RGB_COLOR_MODE): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes.set([0x38, 0x42, 0x50, 0x53, 0, version]);
  bytes.set([0, 4], 12); // channels
  bytes.set([0, 0, 0, 7], 14); // height
  bytes.set([0, 0, 0, 9], 18); // width
  bytes.set([0, 8, 0, colorMode], 22); // depth + color mode
  return bytes;
}

describe("Photoshop file policy", () => {
  it("sniffs PSD/PSB from 8BPS and version before consulting the extension", () => {
    expect(photoshopVersion(photoshopBytes(1))).toBe(1);
    expect(photoshopVersion(photoshopBytes(2))).toBe(2);
    expect(shouldRouteAsPhotoshop(photoshopBytes(1), "renamed.png")).toBe(true);
    expect(shouldRouteAsPhotoshop(new Uint8Array(), "named.PSB")).toBe(true);
    expect(hasPhotoshopExtension("named.PSD")).toBe(true);
  });

  it("rejects bad signatures, unsupported versions, and incomplete signatures", () => {
    const unsupported = photoshopBytes(1);
    unsupported[5] = 3;
    const badMagic = photoshopBytes(1);
    badMagic[0] = 0;
    expect(photoshopVersion(unsupported)).toBeNull();
    expect(photoshopVersion(badMagic)).toBeNull();
    expect(photoshopVersion(new Uint8Array([0x38, 0x42, 0x50, 0x53, 0]))).toBeNull();
  });

  it("reads fixed header metadata and gates RGB profile policy on PSD mode 3", () => {
    expect(photoshopHeader(photoshopBytes(2))).toEqual({
      version: 2,
      channels: 4,
      height: 7,
      width: 9,
      depth: 8,
      colorMode: PHOTOSHOP_RGB_COLOR_MODE,
    });
    expect(usesPhotoshopRgbProfilePolicy(photoshopBytes(1, 3))).toBe(true);
    expect(usesPhotoshopRgbProfilePolicy(photoshopBytes(1, 4))).toBe(false);
    expect(usesPhotoshopRgbProfilePolicy(photoshopBytes(1).subarray(0, 6))).toBe(false);
  });

  it("sets finite caps for Photoshop, placed images, and complete stacks", () => {
    expect(imageReadLimit("large.psd", "open")).toEqual({
      maxBytes: MAX_PHOTOSHOP_SOURCE_BYTES,
      label: "Photoshop document",
    });
    expect(imageReadLimit("large.png", "open")).toEqual({
      maxBytes: MAX_OPEN_IMAGE_SOURCE_BYTES,
      label: "Image document",
    });
    // An unknown extension still receives a finite pre-read cap even when no
    // signature prefix is available.
    expect(imageReadLimit("renamed.bin", "open").maxBytes).toBe(MAX_PHOTOSHOP_SOURCE_BYTES);
    expect(imageReadLimit("placed.png", "place").maxBytes).toBe(MAX_PLACED_IMAGE_SOURCE_BYTES);
    expect(imageReadLimit("layer.png", "stack").maxBytes).toBe(MAX_IMAGE_STACK_SOURCE_BYTES);
    expect(MAX_PHOTOSHOP_SOURCE_BYTES).toBe(256 * 1024 * 1024);
  });

  it("rejects an oversized renamed Photoshop source before allocating it", async () => {
    const signature = photoshopBytes(1).subarray(0, 6);
    const limit = imageReadLimit("renamed-as-project.mvision", "open", signature);
    const read = vi.fn(async () => photoshopBytes(1));

    await expect(readWithinFileSizeLimit(
      limit.maxBytes + 1,
      limit.maxBytes,
      limit.label,
      read,
    )).rejects.toThrow("Photoshop document exceeds the 256 MiB size limit");
    expect(read).not.toHaveBeenCalled();
  });

  it("enforces the stack cap across multiple individually valid files", () => {
    const half = MAX_IMAGE_STACK_SOURCE_BYTES / 2;
    expect(nextImageStackReadTotal(0, half)).toBe(half);
    expect(nextImageStackReadTotal(half, half)).toBe(MAX_IMAGE_STACK_SOURCE_BYTES);
    expect(() => nextImageStackReadTotal(half, half + 1)).toThrow(
      "Image stack exceeds the 256 MiB size limit",
    );
  });

  it("gives .mvis and PSB a read cap the writer can actually fill (#545)", () => {
    const gib = 1024 * 1024 * 1024;
    expect(MAX_MVIS_SOURCE_BYTES).toBe(gib);
    expect(MAX_PSB_SOURCE_BYTES).toBe(gib);
    expect(documentFormatReadLimit("doc.mvis")).toEqual({ maxBytes: gib, label: "Monet Vision document" });
    expect(documentFormatReadLimit("doc.psb")).toEqual({ maxBytes: gib, label: "Large Photoshop document" });
    expect(documentFormatReadLimit("doc.mvision").maxBytes).toBe(MAX_PROJECT_ENVELOPE_BYTES);
    expect(documentFormatReadLimit("doc.psd").maxBytes).toBe(MAX_PHOTOSHOP_SOURCE_BYTES);
    expect(documentFormatReadLimit("doc.png").maxBytes).toBe(MAX_OPEN_IMAGE_SOURCE_BYTES);
    // A PSD signature still loses to a .mvision name here. Open checks the
    // header first, so a renamed PSD stays on the 256 MiB image cap.
    expect(documentFormatReadLimit("renamed.mvision", photoshopBytes(1)).maxBytes).toBe(MAX_PROJECT_ENVELOPE_BYTES);
    const appSource = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
    expect(appSource).toContain('if (header?.version === 1) return imageReadLimit(name, "open", signatureBytes);');
    expect(appSource).toContain("if (header?.version === 2) return documentFormatReadLimit");
  });

  it("refuses a payload one byte over the format's own open limit", () => {
    for (const ext of SUPPORTED_SAVE_EXTENSIONS) {
      const cap = documentFormatReadLimit(`file.${ext}`).maxBytes;
      expect(savePayloadTooLarge(ext, cap), ext).toBeNull();
      const message = savePayloadTooLarge(ext, cap + 1);
      expect(message, ext).toContain(`too large to save as .${ext}`);
      if (ext === "mvis" || ext === "psb") expect(message, ext).not.toContain("Save as .mvis or PSB");
      else expect(message, ext).toContain("Save as .mvis or PSB instead.");
    }
  });
});
