export interface PanelOptions {
  layerThumbnailSize: number;
  channelThumbnailSize: number;
  swatchThumbnailSize: number;
  swatchView: "grid" | "list";
}

export const DEFAULT_PANEL_OPTIONS: PanelOptions = {
  layerThumbnailSize: 24,
  channelThumbnailSize: 26,
  swatchThumbnailSize: 24,
  swatchView: "grid",
};

export const PANEL_THUMBNAIL_SIZES = {
  layerThumbnailSize: [24, 40, 64],
  channelThumbnailSize: [26, 40, 64],
  swatchThumbnailSize: [16, 24, 40],
} as const;

/** Preferences are user-editable storage; accept only the choices the UI offers. */
export function normalizePanelOptions(value: unknown): PanelOptions {
  const next = { ...DEFAULT_PANEL_OPTIONS };
  if (!value || typeof value !== "object" || Array.isArray(value)) return next;
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(PANEL_THUMBNAIL_SIZES) as (keyof typeof PANEL_THUMBNAIL_SIZES)[]) {
    const size = input[key];
    if (typeof size === "number" && (PANEL_THUMBNAIL_SIZES[key] as readonly number[]).includes(size)) next[key] = size;
  }
  if (input.swatchView === "list") next.swatchView = "list";
  return next;
}
