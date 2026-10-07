import { createDefaultRecipe } from "@monet-ui/monet-photo";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../catalog/catalog", () => ({
  setRecipe: vi.fn(),
  recordHistory: vi.fn(),
}));

import { recordHistory, setRecipe } from "../catalog/catalog";
import { persistDevelopRecipe } from "./persistDevelopRecipe";

const persist = vi.mocked(setRecipe);
const history = vi.mocked(recordHistory);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistDevelopRecipe", () => {
  it("records only the exact canonical bytes accepted by Rust", async () => {
    const recipe = createDefaultRecipe();
    recipe.basic.exposure = 0.3;
    const canonical = '{"basic":{"exposure":0.3},"processVersion":6,"version":2}';
    persist.mockResolvedValue(canonical);
    history.mockResolvedValue(41);

    const result = await persistDevelopRecipe(7, recipe, '{"version":2}');

    expect(result).toEqual({ canonicalJson: canonical, historyRecorded: true });
    expect(history).toHaveBeenCalledWith(7, expect.any(String), canonical, 6);
  });

  it("leaves history unchanged when native validation rejects the recipe", async () => {
    const recipe = createDefaultRecipe();
    persist.mockRejectedValue(new Error("invalid recipe"));

    await expect(persistDevelopRecipe(7, recipe, '{"version":2}')).rejects.toThrow(
      "invalid recipe",
    );
    expect(history).not.toHaveBeenCalled();
  });
});
