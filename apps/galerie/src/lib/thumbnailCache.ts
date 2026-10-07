// thumbnailCache — the pure, engine-free thumbnail primitives: downscale math
// + an LRU of object URLs. Kept separate from thumbnails.ts (which pulls in the
// wasm engine) so this stays unit-testable under node.

/** Downscale target that fits `w×h` into `maxEdge` (never upscales). */
export function fitDimensions(w: number, h: number, maxEdge: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Recency-ordered (LRU) map of photoId → thumbnail object URL. Evicting or
 * clearing revokes the URL via `onEvict` so blobs are freed. Capacity is
 * entries, not bytes (thumbnails are ~uniform size).
 */
export class ThumbnailCache<K = number> {
  private map = new Map<K, string>();

  constructor(
    private readonly capacity: number,
    private readonly onEvict: (url: string) => void = URL.revokeObjectURL,
  ) {}

  has(id: K): boolean {
    return this.map.has(id);
  }

  /** Get + promote to most-recently-used. */
  get(id: K): string | undefined {
    const url = this.map.get(id);
    if (url !== undefined) {
      this.map.delete(id);
      this.map.set(id, url);
    }
    return url;
  }

  set(id: K, url: string): void {
    const prev = this.map.get(id);
    if (prev !== undefined) {
      if (prev !== url) this.onEvict(prev);
      this.map.delete(id);
    }
    this.map.set(id, url);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.onEvict(this.map.get(oldest)!);
      this.map.delete(oldest);
    }
  }

  delete(id: K): void {
    const url = this.map.get(id);
    if (url !== undefined) {
      this.onEvict(url);
      this.map.delete(id);
    }
  }

  clear(): void {
    for (const url of this.map.values()) this.onEvict(url);
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
