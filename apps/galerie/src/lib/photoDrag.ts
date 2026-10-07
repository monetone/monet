// photoDrag — the grid/filmstrip → Collections panel drag payload (LR's
// drag-selection-onto-a-collection). One custom MIME type carrying a JSON
// array of photo ids, so a Finder file drop never reads as a photo drop.

export const PHOTO_DRAG_TYPE = "application/x-galerie-photo-ids";

/** Ids a drag starting on `photoId` carries: the whole selection when the
 *  grabbed photo is part of it, else just that photo (LR's behavior). */
export function dragPayloadIds(selection: number[], photoId: number): number[] {
  return selection.includes(photoId) ? selection : [photoId];
}

export function writePhotoDrag(dt: DataTransfer, ids: number[]): void {
  dt.setData(PHOTO_DRAG_TYPE, JSON.stringify(ids));
  dt.effectAllowed = "copy";
}

/** Parse a drop; [] for foreign or malformed payloads (drops are a trust
 *  boundary — anything can set a DataTransfer entry). */
export function readPhotoDrag(dt: DataTransfer): number[] {
  try {
    const v: unknown = JSON.parse(dt.getData(PHOTO_DRAG_TYPE));
    return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}
