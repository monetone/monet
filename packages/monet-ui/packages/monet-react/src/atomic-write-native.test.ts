// atomicWrite.test.ts covers the injected-operations fallback. What it cannot
// reach is the native decision in front of it: under Tauri, atomicWriteBytes
// first tries the `atomicsave` plugin (which fsyncs before renaming), and falls
// back to the plugin-fs write/rename ONLY when that command is unavailable. That
// silent `catch { return false }` is exactly the branch a durability bug would
// hide in, so it gets its own file — the Tauri modules have to be mocked at the
// module level, which the sibling file deliberately does not do.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: true, invoke: vi.fn() }));
const fs = vi.hoisted(() => ({
  writeFile: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauri.enabled,
  invoke: tauri.invoke,
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: (...args: unknown[]) => fs.writeFile(...args),
  rename: (...args: unknown[]) => fs.rename(...args),
  remove: (...args: unknown[]) => fs.remove(...args),
}));

import { atomicWriteBytes, type AtomicWriteOperations } from "./atomic-write";

const DESTINATION = "/documents/portrait.mvision";
const BYTES = new Uint8Array([1, 2, 250]);

beforeEach(() => {
  tauri.enabled = true;
  tauri.invoke.mockReset().mockResolvedValue(undefined);
  fs.writeFile.mockReset().mockResolvedValue(undefined);
  fs.rename.mockReset().mockResolvedValue(undefined);
  fs.remove.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("atomicWriteBytes under Tauri", () => {
  it("hands the write to the durable atomicsave plugin and does not touch plugin-fs", async () => {
    await atomicWriteBytes(DESTINATION, BYTES);

    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    const [command, body, options] = tauri.invoke.mock.calls[0];
    expect(command).toBe("plugin:atomicsave|atomic_write");
    expect(body).toEqual(BYTES);
    expect(options).toEqual({ headers: { "x-destination": encodeURIComponent(DESTINATION) } });
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it("falls back to the plugin-fs write/rename when the atomicsave command is unavailable", async () => {
    tauri.invoke.mockRejectedValue(new Error("Command plugin:atomicsave|atomic_write not found"));

    await atomicWriteBytes(DESTINATION, BYTES);

    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const [temporary, written, options] = fs.writeFile.mock.calls[0];
    expect(temporary).not.toBe(DESTINATION);
    expect(String(temporary).startsWith("/documents/")).toBe(true); // staged as a sibling
    expect(String(temporary).endsWith(".tmp")).toBe(true);
    expect(written).toEqual(BYTES);
    expect(options).toEqual({ createNew: true });
    expect(fs.rename).toHaveBeenCalledWith(temporary, DESTINATION);
    expect(fs.remove).not.toHaveBeenCalled();
  });

  it("cleans up its temporary file when the fallback write itself fails", async () => {
    tauri.invoke.mockRejectedValue(new Error("no such command"));
    const failure = new Error("disk full");
    fs.writeFile.mockRejectedValue(failure);

    await expect(atomicWriteBytes(DESTINATION, BYTES)).rejects.toBe(failure);

    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.remove).toHaveBeenCalledTimes(1);
    expect(fs.remove.mock.calls[0][0]).toBe(fs.writeFile.mock.calls[0][0]);
    expect(fs.remove.mock.calls[0][0]).not.toBe(DESTINATION);
  });

  it("uses a fresh temporary path per invocation so a retry cannot collide", async () => {
    tauri.invoke.mockRejectedValue(new Error("no such command"));

    await atomicWriteBytes(DESTINATION, BYTES);
    await atomicWriteBytes(DESTINATION, BYTES);

    expect(fs.writeFile.mock.calls[0][0]).not.toBe(fs.writeFile.mock.calls[1][0]);
  });

  it("never invokes the native command when operations are injected (the test seam stays hermetic)", async () => {
    const calls: string[] = [];
    const operations: AtomicWriteOperations = {
      async writeFile(path) { calls.push(`write:${path}`); },
      async rename(from, to) { calls.push(`rename:${from}->${to}`); },
      async remove(path) { calls.push(`remove:${path}`); },
    };

    await atomicWriteBytes(DESTINATION, BYTES, operations);

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
    expect(calls[1].endsWith(`->${DESTINATION}`)).toBe(true);
  });

  it("never invokes the native command in the browser build", async () => {
    tauri.enabled = false;

    await atomicWriteBytes(DESTINATION, BYTES);

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledTimes(1); // plugin-fs path, as before
    expect(fs.rename).toHaveBeenCalledTimes(1);
  });
});
