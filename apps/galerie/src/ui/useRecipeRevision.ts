import { useEffect, useState } from "react";

import { onPhotoRecipeChanged } from "../catalog/catalog";

export function useRecipeRevision(photoId: number | null | undefined): number {
  const [revision, setRevision] = useState(0);

  useEffect(
    () => photoId == null
      ? undefined
      : onPhotoRecipeChanged(photoId, () => setRevision((value) => value + 1)),
    [photoId],
  );

  return revision;
}
