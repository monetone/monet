import { describe, expect, it, vi } from "vitest";
import { assertReadableFileSize, readWithinFileSizeLimit } from "./boundedRead";

describe("bounded file reads", () => {
  it("accepts the exact byte limit and rejects unsafe sizes", () => {
    const maxBytes = 1024 * 1024;
    expect(() => assertReadableFileSize(maxBytes, maxBytes, "Project")).not.toThrow();
    expect(() => assertReadableFileSize(maxBytes + 1, maxBytes, "Project")).toThrow("Project exceeds the 1 MiB size limit");
    expect(() => assertReadableFileSize(-1, maxBytes, "Project")).toThrow();
    expect(() => assertReadableFileSize(Number.NaN, maxBytes, "Project")).toThrow();
  });

  it("names a sub-MiB limit in KiB instead of flooring it to 0 MiB", () => {
    expect(() => assertReadableFileSize(256 * 1024 + 1, 256 * 1024, "shortcut set"))
      .toThrow("shortcut set exceeds the 256 KiB size limit");
  });

  it("does not invoke the allocating read when metadata is over budget", async () => {
    const read = vi.fn(async () => new Uint8Array([1, 2, 3]));

    await expect(readWithinFileSizeLimit(1025, 1024, "Project", read)).rejects.toThrow("Project exceeds");
    expect(read).not.toHaveBeenCalled();

    await expect(readWithinFileSizeLimit(1024, 1024, "Project", read)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(read).toHaveBeenCalledOnce();
  });
});
