// useMetadataStatus — one photo's async metadata-status probe (grid cell badge,
// Metadata panel resolve row). Re-probes when the row object changes (the store
// replaces rows immutably on metadata edits), when the photo's recipe changes,
// and after any metadata sync anywhere (a Save/Read just moved a baseline).

import { useEffect, useState } from "react";

import { onPhotoRecipeChanged } from "../catalog/catalog";
import type { PhotoRow } from "../catalog/types";
import { onMetadataStatusChanged, type MetadataStatus } from "../lib/metadataStatus";
import { metadataStatusFor } from "../lib/xmpAutoWrite";

export function useMetadataStatus(photo: PhotoRow): MetadataStatus {
  const [status, setStatus] = useState<MetadataStatus>("unknown");
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void metadataStatusFor(photo).then((s) => {
        if (live) setStatus(s);
      });
    refresh();
    const offSync = onMetadataStatusChanged(refresh);
    const offRecipe = onPhotoRecipeChanged(photo.id, refresh);
    return () => {
      live = false;
      offSync();
      offRecipe();
    };
  }, [photo]);
  return status;
}
