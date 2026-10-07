import type { DevelopRecipeV2 } from "@monet-ui/monet-photo";

import { recordHistory, setRecipe } from "../catalog/catalog";
import { historyLabel } from "./historyLabel";

export async function persistDevelopRecipe(
  photoId: number,
  recipe: DevelopRecipeV2,
  baselineJson: string | null,
): Promise<{ canonicalJson: string; historyRecorded: boolean }> {
  const canonicalJson = await setRecipe(photoId, JSON.stringify(recipe), recipe.processVersion);
  if (baselineJson == null || baselineJson === canonicalJson) {
    return { canonicalJson, historyRecorded: false };
  }
  let label = "Edit";
  try {
    label = historyLabel(
      JSON.parse(baselineJson) as DevelopRecipeV2,
      JSON.parse(canonicalJson) as DevelopRecipeV2,
    );
  } catch {
    // Native validation owns persisted recipe validity; retain a safe label if
    // an older baseline cannot be decoded for display.
  }
  await recordHistory(photoId, label, canonicalJson, recipe.processVersion);
  return { canonicalJson, historyRecorded: true };
}
