// buildPreviewsProgress.test — Build Previews is a cancellable job: it ticks per
// photo and stops on the *next* photo when the StatusBar Cancel is clicked. A
// 20k-photo 1:1 build that only checked at the end would be unstoppable.

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn(async () => new Uint8Array([1])) }));
vi.mock("./thumbnails", () => ({
  fitDimensions: vi.fn(() => ({ width: 1, height: 1 })),
  generateThumbnail: vi.fn(),
  urlFromEncoded: vi.fn(),
}));
vi.mock("../rawDecode", () => ({ rawFrameMetadata: vi.fn((v) => v) }));
vi.mock("../catalog/catalog", () => ({
  catalogAvailable: vi.fn(() => false),
  previewRequest: vi.fn(),
  previewGet: vi.fn(),
  previewPut: vi.fn(),
  onRecipeChanged: vi.fn(() => () => {}),
}));

import type { PhotoRow } from "../catalog/types";
import { buildPreviews } from "./thumbnailLoader";

const photo = (id: number) => ({ id, path: `/p/${id}.dng` }) as PhotoRow;

describe("buildPreviews progress + cancel", () => {
  it("ticks once per photo", async () => {
    const load = vi.fn(async () => null);
    const ticks: number[] = [];
    const failed = await buildPreviews([photo(1), photo(2)], "standard", 2560, load as never, {
      onTick: () => ticks.push(load.mock.calls.length),
    });
    expect(ticks).toEqual([1, 2]);
    expect(failed).toBe(2); // a null URL is a failed preview
  });

  it("stops before the next photo once cancelled, keeping what it built", async () => {
    const seen: number[] = [];
    let cancelled = false;
    const load = async (p: { id: number }) => {
      seen.push(p.id);
      if (p.id === 2) cancelled = true; // Cancel clicked mid-build
      return `blob:${p.id}`;
    };
    const revoked: string[] = [];
    const orig = URL.revokeObjectURL;
    URL.revokeObjectURL = (u: string) => void revoked.push(u);
    try {
      const failed = await buildPreviews(
        [photo(1), photo(2), photo(3), photo(4)],
        "standard",
        2560,
        load as never,
        { isCancelled: () => cancelled },
      );
      expect(seen).toEqual([1, 2]);
      expect(revoked).toEqual(["blob:1", "blob:2"]);
      expect(failed).toBe(0);
    } finally {
      URL.revokeObjectURL = orig;
    }
  });

  it("does nothing when cancelled before the first photo", async () => {
    const load = vi.fn(async () => "blob:x");
    await buildPreviews([photo(1)], "standard", 2560, load as never, { isCancelled: () => true });
    expect(load).not.toHaveBeenCalled();
  });
});
