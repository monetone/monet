// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({
  tauri: false,
  openFile: vi.fn<() => Promise<string | string[] | null>>(),
}));

vi.mock("@monet-ui/monet-react", () => ({
  atomicWriteBytes: vi.fn(),
  isTauri: () => ui.tauri,
  openFile: ui.openFile,
  saveFile: vi.fn(),
}));

const { openBinaryFile, openTextFile, pickDirectory } = await import("./files");

beforeEach(() => {
  ui.tauri = false;
  ui.openFile.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("file picker cancellation", () => {
  it("settles both browser file pickers with null on cancel", async () => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event("cancel"));
    });

    await expect(openBinaryFile("*/*")).resolves.toBeNull();
    await expect(openTextFile()).resolves.toBeNull();
  });

  it("distinguishes browser fallback from a cancelled native folder picker", async () => {
    await expect(pickDirectory()).resolves.toEqual({});

    ui.tauri = true;
    ui.openFile.mockResolvedValueOnce(null).mockResolvedValueOnce("/tmp/out");
    await expect(pickDirectory()).resolves.toBeNull();
    await expect(pickDirectory()).resolves.toEqual({ path: "/tmp/out" });
  });
});
