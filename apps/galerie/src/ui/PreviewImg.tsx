// PreviewImg — load + show a photo's cached preview, owning the object-URL
// lifecycle (revokes on unmount/photo change). Shared by Compare/Survey; the
// Loupe keeps its own loader because it also drives the metadata overlay.

import { useEffect, useState } from "react";

import type { PhotoRow } from "../catalog/types";
import { loadPreview } from "../lib/thumbnailLoader";
import { useRecipeRevision } from "./useRecipeRevision";

export function PreviewImg({
  photo,
  edge,
  kind = "standard",
  className,
  style,
  onLoad,
}: {
  photo: PhotoRow;
  edge: number;
  kind?: string;
  className?: string;
  /** Optional inline style (Compare's synced-zoom transform). */
  style?: React.CSSProperties;
  /** Fires with the img's natural size once decoded. */
  onLoad?: (naturalWidth: number, naturalHeight: number) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const recipeRevision = useRecipeRevision(photo.id);

  useEffect(() => {
    let cancelled = false;
    let obj: string | null = null;
    setUrl(null);
    void (async () => {
      const u = await loadPreview(photo, kind, edge);
      obj = u;
      if (cancelled) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      setUrl(u);
    })();
    return () => {
      cancelled = true;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [photo.id, photo.readPath, kind, edge, recipeRevision]);

  return url ? (
    <img
      className={className}
      style={style}
      src={url}
      alt=""
      draggable={false}
      onLoad={(e) => onLoad?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
    />
  ) : (
    <div className="gal-cell-spinner" />
  );
}
