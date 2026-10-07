import { describe, expect, it, vi } from "vitest";
import { runBrowserSave } from "./browserSave";

describe("browser save transaction", () => {
  it("marks the document saved only after export and download succeed", () => {
    const events: string[] = [];
    const result = runBrowserSave({
      exportFile: () => { events.push("export"); return new Uint8Array([1]); },
      download: () => { events.push("download"); },
      markSaved: () => { events.push("saved"); },
      reportError: () => { events.push("error"); },
      shouldMarkSaved: true,
    });

    expect(result).toBe(true);
    expect(events).toEqual(["export", "download", "saved"]);
  });

  it.each(["export", "download"] as const)("reports %s failures without marking saved", (failure) => {
    const error = new Error(`${failure} failed`);
    const markSaved = vi.fn();
    const reportError = vi.fn();
    const result = runBrowserSave({
      exportFile: () => {
        if (failure === "export") throw error;
        return new Uint8Array([1]);
      },
      download: () => {
        if (failure === "download") throw error;
      },
      markSaved,
      reportError,
      shouldMarkSaved: true,
    });

    expect(result).toBe(false);
    expect(reportError).toHaveBeenCalledWith(error);
    expect(markSaved).not.toHaveBeenCalled();
  });

  it("does not mark successful export-copy downloads as project saves", () => {
    const markSaved = vi.fn();
    expect(runBrowserSave({
      exportFile: () => new Uint8Array([1]),
      download: () => undefined,
      markSaved,
      reportError: vi.fn(),
      shouldMarkSaved: false,
    })).toBe(true);
    expect(markSaved).not.toHaveBeenCalled();
  });
});
