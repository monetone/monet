import { describe, expect, it, vi } from "vitest";
import { readBrowserImportBytes, readBrowserImportText } from "./localImport";

describe("bounded browser local imports", () => {
  it("accepts bytes and text at the exact declared ceiling", async () => {
    const bytes = vi.fn(async () => Uint8Array.from([1, 2, 3, 4]).buffer);
    const text = vi.fn(async () => "test");

    await expect(readBrowserImportBytes(
      { size: 4, arrayBuffer: bytes },
      { maxBytes: 4, label: "Binary preset" },
    )).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
    await expect(readBrowserImportText(
      { size: 4, text },
      { maxBytes: 4, label: "Text preset" },
    )).resolves.toBe("test");

    expect(bytes).toHaveBeenCalledOnce();
    expect(text).toHaveBeenCalledOnce();
  });

  it("rejects one byte over the ceiling before invoking allocating File methods", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const text = vi.fn(async () => "");

    await expect(readBrowserImportBytes(
      { size: 5, arrayBuffer },
      { maxBytes: 4, label: "Binary preset" },
    )).rejects.toThrow("Binary preset exceeds");
    await expect(readBrowserImportText(
      { size: 5, text },
      { maxBytes: 4, label: "Text preset" },
    )).rejects.toThrow("Text preset exceeds");

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });
});
