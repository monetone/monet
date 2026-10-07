// GAL-MASK-06: AI-mask coverage persistence. storeSubjectCoverage writes a
// Uint8-quantized matte under <appDataDir>/ai-masks/<cacheId>.bin and
// hydrateSubjectCoverage loads it back after a "relaunch" (fresh module), so
// AI masks no longer render as nothing after a reload. missingAiCoverage is
// the AI-Edit-Status predicate over the same cache.

import { U2NET_SIZE } from "@monet-ui/monet-scopes";
import { createDefaultRecipe, type DevelopRecipeV2 } from "@monet-ui/monet-photo";
import { describe, expect, it, vi } from "vitest";

// Tauri mocks: an in-memory "app-data dir". Variadic-unknown signatures so the
// call assertions typecheck (vi.fn() with no signature yields an empty tuple).
const fs = vi.hoisted(() => ({
  mkdir: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  writeFile: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  readDir: vi.fn<(...args: unknown[]) => Promise<{ name: string }[]>>(async () => []),
  readFile: vi.fn<(...args: unknown[]) => Promise<Uint8Array>>(),
}));
vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/appdata",
  join: async (...parts: string[]) => parts.join("/"),
}));

const N = U2NET_SIZE * U2NET_SIZE;

function rampCoverage(): Float32Array {
  const cov = new Float32Array(N);
  for (let i = 0; i < N; i++) cov[i] = (i % 256) / 255;
  return cov;
}

describe("subject coverage persistence", () => {
  it("persists on store and hydrates after a relaunch", async () => {
    const sm = await import("./subjectMask");
    const cov = rampCoverage();
    sm.storeSubjectCoverage("abc", cov);
    // Same session: the in-memory cache serves it immediately.
    expect(sm.getSubjectCoverage("abc")).toBe(cov);
    // The fire-and-forget write lands with the quantized matte.
    await vi.waitFor(() => expect(fs.writeFile).toHaveBeenCalledTimes(1));
    const [path, bytes] = fs.writeFile.mock.calls[0] as [string, Uint8Array];
    expect(path).toBe("/appdata/ai-masks/abc.bin");
    expect(bytes.length).toBe(N);
    expect(fs.mkdir).toHaveBeenCalledWith("/appdata/ai-masks", { recursive: true });

    // "Relaunch": a fresh module hydrates the matte back from disk.
    vi.resetModules();
    fs.readDir.mockResolvedValue([{ name: "abc.bin" }]);
    fs.readFile.mockResolvedValue(bytes);
    const fresh = await import("./subjectMask");
    await fresh.hydrateSubjectCoverage();
    const back = fresh.getSubjectCoverage("abc");
    expect(back).toBeDefined();
    expect(back!.length).toBe(N);
    // Uint8 quantization: within half a step of the original everywhere.
    for (let i = 0; i < N; i++) {
      if (Math.abs(back![i] - cov[i]) > 0.5 / 255) {
        throw new Error(`coverage[${i}] drifted: ${back![i]} vs ${cov[i]}`);
      }
    }
  });

  it("ignores truncated files instead of caching garbage", async () => {
    vi.resetModules();
    fs.readDir.mockResolvedValue([{ name: "bad.bin" }]);
    fs.readFile.mockResolvedValue(new Uint8Array(10));
    const fresh = await import("./subjectMask");
    await fresh.hydrateSubjectCoverage();
    expect(fresh.getSubjectCoverage("bad")).toBeUndefined();
  });
});

describe("missingAiCoverage (AI Edit Status)", () => {
  it("reports enabled AI masks whose coverage is absent", async () => {
    vi.resetModules();
    fs.readDir.mockResolvedValue([]);
    const sm = await import("./subjectMask");
    const mc = await import("./maskComposite");
    const { newAiSubjectMask } = await import("./maskEdit");
    sm.storeSubjectCoverage("hit", rampCoverage());
    const off = newAiSubjectMask("m3", "Subject 3", "also-miss");
    off.enabled = false;
    const recipe: DevelopRecipeV2 = {
      ...createDefaultRecipe(),
      masks: {
        masks: [
          newAiSubjectMask("m1", "Subject 1", "hit"),
          newAiSubjectMask("m2", "Subject 2", "miss"),
          off, // disabled → never renders, so never "stale"
        ],
      },
    };
    expect(mc.missingAiCoverage(recipe)).toEqual(["m2"]);
  });
});
