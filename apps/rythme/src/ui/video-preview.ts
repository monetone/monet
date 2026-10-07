// ─────────────────────────────────────────────────────────────
// ui/video-preview — runtime object URLs for referenced picture assets
// ─────────────────────────────────────────────────────────────

const previewUrls = new Map<string, string>();

export function registerVideoPreviewUrl(assetId: string, url: string): void {
  const previous = previewUrls.get(assetId);
  if (previous && previous !== url) URL.revokeObjectURL(previous);
  previewUrls.set(assetId, url);
}

export function videoPreviewUrl(assetId: string | undefined): string | undefined {
  return assetId ? previewUrls.get(assetId) : undefined;
}

