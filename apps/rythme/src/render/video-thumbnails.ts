// ─────────────────────────────────────────────────────────────
// render/video-thumbnails — runtime decoded frame strips for picture lanes
// ─────────────────────────────────────────────────────────────

export interface VideoThumbnailStrip {
  key: string;
  assetId: string;
  status: "loading" | "ready" | "error";
  frames: HTMLCanvasElement[];
  error?: string;
}

const strips = new Map<string, VideoThumbnailStrip>();
const listeners = new Set<() => void>();

export function subscribeVideoThumbnailInvalidation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestVideoThumbnailStrip(assetId: string, url: string, duration: number | undefined, count = 8): VideoThumbnailStrip {
  const safeCount = Math.max(1, Math.min(16, Math.round(count)));
  const key = `${assetId}|${url}|${Math.max(0, duration ?? 0).toFixed(3)}|${safeCount}`;
  const existing = strips.get(key);
  if (existing) return existing;

  const strip: VideoThumbnailStrip = { key, assetId, status: "loading", frames: [] };
  strips.set(key, strip);
  void decodeVideoThumbnailStrip(strip, url, duration, safeCount);
  return strip;
}

export function videoThumbnailStats(assetId?: string): { loading: number; ready: number; error: number; frames: number; errors: string[] } {
  let loading = 0;
  let ready = 0;
  let error = 0;
  let frames = 0;
  const errors: string[] = [];
  for (const strip of strips.values()) {
    if (assetId && strip.assetId !== assetId) continue;
    if (strip.status === "loading") loading++;
    if (strip.status === "ready") ready++;
    if (strip.status === "error") error++;
    frames += strip.frames.length;
    if (strip.error) errors.push(strip.error);
  }
  return { loading, ready, error, frames, errors };
}

export function clearVideoThumbnailStrips(assetId?: string): void {
  for (const [key, strip] of [...strips]) {
    if (!assetId || strip.assetId === assetId) strips.delete(key);
  }
  notify();
}

async function decodeVideoThumbnailStrip(strip: VideoThumbnailStrip, url: string, duration: number | undefined, count: number): Promise<void> {
  try {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.load();
    await waitForVideoMetadata(video);
    await waitForVideoData(video);
    const metadataDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
    const safeDuration = Math.max(0.05, metadataDuration ?? Math.min(0.5, duration ?? 0.5));
    const frames: HTMLCanvasElement[] = [];
    for (let i = 0; i < count; i++) {
      const t = Math.min(safeDuration - 0.01, Math.max(0, safeDuration * ((i + 0.5) / count)));
      if (metadataDuration) await seekVideo(video, t).catch(() => undefined);
      frames.push(captureVideoFrame(video));
    }
    strip.frames = frames;
    strip.status = "ready";
  } catch (err) {
    strip.status = "error";
    strip.error = err instanceof Error ? err.message : String(err);
  } finally {
    notify();
  }
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1) return Promise.resolve();
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("video metadata unavailable"));
    }),
    4000,
    "video metadata timed out",
  );
}

function waitForVideoData(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.oncanplay = () => resolve();
      video.onerror = () => reject(new Error("video data unavailable"));
    }),
    4000,
    "video data timed out",
  );
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return Promise.resolve();
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      const done = () => resolve();
      video.onseeked = done;
      video.oncanplay = done;
      video.onerror = () => reject(new Error("video seek failed"));
      try {
        video.currentTime = time;
      } catch (err) {
        reject(err);
      }
    }),
    4000,
    "video seek timed out",
  );
}

function captureVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 54;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("thumbnail canvas unavailable");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const scale = Math.min(canvas.width / vw, canvas.height / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  return canvas;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function notify(): void {
  for (const listener of listeners) listener();
}
