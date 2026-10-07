import { describe, expect, it } from "vitest";

import { similarOpts } from "./genMeta";

describe("similarOpts", () => {
  it("returns null without metadata (nothing to re-roll)", () => {
    expect(similarOpts(null)).toBeNull();
  });

  it("keeps every setting but draws a fresh seed", () => {
    const meta = { prompt: "a red boat", negativePrompt: "blur", steps: 12, guidance: 6, seed: 41, outputSize: 1024 };
    const o = similarOpts(meta, () => 0.5)!;
    expect(o).toMatchObject({ prompt: "a red boat", negativePrompt: "blur", steps: 12, guidance: 6, outputSize: 1024 });
    expect(o.seed).toBe(500_000);
    expect(o.seed).not.toBe(meta.seed);
  });

  it("bumps a colliding roll so the seed always changes", () => {
    expect(similarOpts({ prompt: "p", seed: 500_000 }, () => 0.5)!.seed).toBe(500_001);
  });

  it("does not mutate the stored metadata", () => {
    const meta = { prompt: "p", seed: 1 };
    similarOpts(meta, () => 0.9);
    expect(meta.seed).toBe(1);
  });
});
