import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("../catalog/catalog", () => ({ revealPath: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

import { revealPath } from "../catalog/catalog";
import { AFTER_EXPORT_OPTS, runAfterExport, type AfterExportAction } from "./afterExport";

const PATHS = ["/exports/a.jpg", "/exports/b.jpg"];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.mocked(revealPath).mockResolvedValue(undefined);
});

describe("runAfterExport", () => {
  it("does nothing for LR's Do Nothing (empty or absent)", async () => {
    expect(await runAfterExport("", "/exports", PATHS)).toBeNull();
    expect(await runAfterExport(undefined, "/exports", PATHS)).toBeNull();
    expect(revealPath).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reveals the first exported file, falling back to the folder", async () => {
    expect(await runAfterExport("showInFinder", "/exports", PATHS)).toBeNull();
    expect(revealPath).toHaveBeenCalledWith("/exports/a.jpg");

    expect(await runAfterExport("showInFinder", "/exports", [])).toBeNull();
    expect(revealPath).toHaveBeenLastCalledWith("/exports");
  });

  it("hands every exported file to the chosen Monet app", async () => {
    expect(await runAfterExport("openIn:Monet Vision", "/exports", PATHS)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, "plugin:catalog|catalog_open_in_app", {
      app: "Monet Vision",
      path: "/exports/a.jpg",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "plugin:catalog|catalog_open_in_app", {
      app: "Monet Vision",
      path: "/exports/b.jpg",
    });
  });

  it("says so rather than launching nothing when the batch wrote no files", async () => {
    expect(await runAfterExport("openIn:Monet Vision", "/exports", [])).toMatch(/Nothing was exported/);
    expect(invoke).not.toHaveBeenCalled();
  });

  // The action comes back out of a preset in localStorage — a forged one must
  // never reach the native process launcher.
  it("refuses an app outside the native allow-list and an unknown action", async () => {
    const forged = ["openIn:/bin/sh", "openIn:Photoshop", "rm -rf"] as AfterExportAction[];
    for (const action of forged) {
      expect(await runAfterExport(action, "/exports", PATHS)).toBeTruthy();
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(revealPath).not.toHaveBeenCalled();
  });

  it("reports a launch failure instead of throwing — the export already succeeded", async () => {
    vi.mocked(invoke).mockRejectedValue("Monet Vision could not be launched");
    await expect(runAfterExport("openIn:Monet Vision", "/exports", PATHS)).resolves.toMatch(/After Export failed/);
  });

  it("offers Do Nothing first, then reveal, then only allow-listed apps", () => {
    expect(AFTER_EXPORT_OPTS[0]).toEqual({ value: "", label: "Do Nothing" });
    expect(AFTER_EXPORT_OPTS[1].value).toBe("showInFinder");
    expect(AFTER_EXPORT_OPTS.slice(2).map((o) => o.value)).toContain("openIn:Monet Vision");
    expect(AFTER_EXPORT_OPTS.slice(2).every((o) => o.value.startsWith("openIn:Monet "))).toBe(true);
  });
});
