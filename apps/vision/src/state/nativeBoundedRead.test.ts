import { describe, expect, it, vi } from "vitest";
import {
  readNativeFileBounded,
  type NativeReadOpener,
} from "./nativeBoundedRead";

function openerFor(
  source: Uint8Array,
  options: { announcedSize?: number; isFile?: boolean; chunk?: number } = {},
) {
  let cursor = 0;
  const close = vi.fn(async () => {});
  const read = vi.fn(async (output: Uint8Array) => {
    if (cursor >= source.length) return null;
    const length = Math.min(output.length, options.chunk ?? output.length, source.length - cursor);
    output.set(source.subarray(cursor, cursor + length));
    cursor += length;
    return length;
  });
  const open: NativeReadOpener = vi.fn(async () => ({
    seekStart: 0,
    file: {
      read,
      seek: vi.fn(async (offset: number) => {
        cursor = offset;
        return cursor;
      }),
      stat: vi.fn(async () => ({
        isFile: options.isFile ?? true,
        size: options.announcedSize ?? source.length,
      })),
      close,
    },
  }));
  return { open, read, close };
}

const limit = () => ({ maxBytes: 32, label: "Image document" });

describe("readNativeFileBounded", () => {
  it("sniffs, sizes, and reads through one handle even across short reads", async () => {
    const source = Uint8Array.from([0x38, 0x42, 0x50, 0x53, 0, 1, 7, 8, 9]);
    const native = openerFor(source, { chunk: 2 });
    const seen: number[][] = [];

    const bytes = await readNativeFileBounded(
      "/picked/document.bin",
      (prefix) => {
        seen.push([...prefix]);
        return limit();
      },
      undefined,
      native.open,
    );

    expect(bytes).toEqual(source);
    expect(seen).toEqual([[0x38, 0x42, 0x50, 0x53, 0, 1]]);
    expect(native.open).toHaveBeenCalledOnce();
    expect(native.close).toHaveBeenCalledOnce();
  });

  it("rejects an oversized file before allocating or reading its body", async () => {
    const native = openerFor(new Uint8Array(40), { announcedSize: 33 * 1024 * 1024 });

    await expect(readNativeFileBounded(
      "/large.psb",
      () => ({ maxBytes: 32 * 1024 * 1024, label: "Image document" }),
      undefined,
      native.open,
    ))
      .rejects.toThrow("32 MiB size limit");

    expect(native.read).toHaveBeenCalledTimes(1);
    expect(native.read.mock.calls[0][0]).toHaveLength(6);
    expect(native.close).toHaveBeenCalledOnce();
  });

  it("runs aggregate preflight before allocating the declared body", async () => {
    const native = openerFor(new Uint8Array(12));
    const preflight = vi.fn(() => { throw new Error("selection budget exceeded"); });

    await expect(readNativeFileBounded("/stack.png", limit, preflight, native.open))
      .rejects.toThrow("selection budget exceeded");

    expect(preflight).toHaveBeenCalledWith(12);
    expect(native.read).toHaveBeenCalledTimes(1);
    expect(native.close).toHaveBeenCalledOnce();
  });

  it("rejects a file that shrinks or grows while the open handle is read", async () => {
    const shrunk = openerFor(new Uint8Array(7), { announcedSize: 8 });
    await expect(readNativeFileBounded("/shrunk.png", limit, undefined, shrunk.open))
      .rejects.toThrow("changed while it was being read");
    expect(shrunk.close).toHaveBeenCalledOnce();

    const grown = openerFor(new Uint8Array(9), { announcedSize: 8 });
    await expect(readNativeFileBounded("/grown.png", limit, undefined, grown.open))
      .rejects.toThrow("changed while it was being read");
    expect(grown.close).toHaveBeenCalledOnce();
  });

  it("rejects non-files and closes the handle", async () => {
    const native = openerFor(new Uint8Array(), { isFile: false });
    await expect(readNativeFileBounded("/folder", limit, undefined, native.open))
      .rejects.toThrow("not a regular file");
    expect(native.read).not.toHaveBeenCalled();
    expect(native.close).toHaveBeenCalledOnce();
  });
});
