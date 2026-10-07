/// <reference types="node" />
// @vitest-environment node
// (the package default is jsdom, where import.meta.url is not a file: URL and
//  the source-inspection assertion below cannot read its own module)
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { atomicWriteBytes, type AtomicWriteOperations } from "./atomic-write";

function memoryOperations(files: Map<string, Uint8Array>) {
  const removed: string[] = [];
  const operations: AtomicWriteOperations = {
    async writeFile(path, bytes) { files.set(path, Uint8Array.from(bytes)); },
    async rename(from, to) {
      const bytes = files.get(from);
      if (!bytes) throw new Error("missing temporary file");
      files.set(to, bytes);
      files.delete(from);
    },
    async remove(path) { removed.push(path); files.delete(path); },
  };
  return { operations, removed };
}

describe("atomic desktop writes", () => {
  it("renames a fully written sibling over the destination without cleanup", async () => {
    const destination = "/documents/image.mvision";
    const files = new Map([[destination, new Uint8Array([1])]]);
    const { operations, removed } = memoryOperations(files);

    await atomicWriteBytes(destination, new Uint8Array([7, 8]), operations);

    expect(files.get(destination)).toEqual(new Uint8Array([7, 8]));
    expect(files.size).toBe(1);
    expect(removed).toEqual([]);
  });

  it("preserves the destination and cleans only its temporary file on write failure", async () => {
    const destination = "/documents/image.mvision";
    const original = new Uint8Array([1, 2, 3]);
    const files = new Map([[destination, original]]);
    const { operations, removed } = memoryOperations(files);
    const writeError = new Error("write failed");
    operations.writeFile = async (path, bytes) => {
      files.set(path, Uint8Array.from(bytes));
      throw writeError;
    };
    operations.rename = vi.fn();

    await expect(atomicWriteBytes(destination, new Uint8Array([9]), operations)).rejects.toBe(writeError);

    expect(files.get(destination)).toEqual(original);
    expect(operations.rename).not.toHaveBeenCalled();
    expect(removed).toHaveLength(1);
    expect(removed[0]).not.toBe(destination);
    expect(files.has(removed[0])).toBe(false);
  });

  it("preserves the destination and removes the staged bytes on rename failure", async () => {
    const destination = "C:\\documents\\image.mvision";
    const original = new Uint8Array([4, 5, 6]);
    const files = new Map([[destination, original]]);
    const { operations, removed } = memoryOperations(files);
    const renameError = new Error("rename failed");
    operations.rename = async () => { throw renameError; };

    await expect(atomicWriteBytes(destination, new Uint8Array([8]), operations)).rejects.toBe(renameError);

    expect(files.get(destination)).toEqual(original);
    expect(removed).toHaveLength(1);
    expect(removed[0]).not.toBe(destination);
    expect(files.has(removed[0])).toBe(false);
  });

  it("allocates a distinct sibling temporary path for concurrent saves", async () => {
    const written: string[] = [];
    const operations: AtomicWriteOperations = {
      async writeFile(path) { written.push(path); },
      async rename() {},
      async remove() {},
    };

    await Promise.all(Array.from({ length: 32 }, (_, value) => (
      atomicWriteBytes("/documents/image.mvision", new Uint8Array([value]), operations)
    )));

    expect(new Set(written).size).toBe(32);
    expect(written.every((path) => path.startsWith("/documents/") && !path.includes("image.mvision"))).toBe(true);
    expect(written.every((path) => !path.slice("/documents/".length).startsWith("."))).toBe(true);
  });
});

describe("durable native save (#4)", () => {
  const source = readFileSync(new URL("./atomic-write.ts", import.meta.url), "utf8");

  it("tries the fsync-backed native command before the plugin-fs fallback", () => {
    // tauri-plugin-fs only write_all()s and exposes no sync, so a rename could land
    // while the data was still in the page cache — a power cut then lost BOTH the
    // old and the new document, with the recovery snapshot already deleted.
    expect(source).toContain('invoke("plugin:atomicsave|atomic_write", bytes, {');
    const guard = source.indexOf("durableNativeWrite(destination, bytes)) return;");
    const fallback = source.indexOf("await operations.writeFile(temporary, bytes");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(fallback);
  });

  it("still uses injected operations verbatim, so tests never hit the native path", () => {
    expect(source).toContain("if (!injectedOperations && isTauri()");
  });

  it("falls back rather than failing when the command is unavailable", () => {
    const fn = source.slice(
      source.indexOf("async function durableNativeWrite"),
      source.indexOf("export async function atomicWriteBytes"),
    );
    expect(fn).toContain("return false;");
  });
});
