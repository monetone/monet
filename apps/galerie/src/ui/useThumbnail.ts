// useThumbnail — bind a photo cell to the lazy thumbnail pipeline. Returns the
// cached URL synchronously when present, else null until generation resolves.

import { useEffect, useState } from "react";

import type { PhotoRow } from "../catalog/types";
import { loadThumbnail, peekThumbnail } from "../lib/thumbnailLoader";
import { useRecipeRevision } from "./useRecipeRevision";

export function useThumbnail(photo: PhotoRow, maxEdge: number): string | null {
  const [url, setUrl] = useState<string | null>(() => peekThumbnail(photo.id, maxEdge));
  const revision = useRecipeRevision(photo.id);

  useEffect(() => {
    let cancelled = false;
    const cached = peekThumbnail(photo.id, maxEdge);
    setUrl(cached);
    loadThumbnail(photo, maxEdge).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [photo.id, photo.readPath, maxEdge, revision]);

  return url;
}
