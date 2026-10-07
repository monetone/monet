// thumbnails.ts — generate a bin poster thumbnail for a media item.

import type { MediaItem } from "../timeline/model/types";
import { setThumb } from "./registry";
import type { ProbeKind } from "./probe";

const THUMB_W = 96;

function drawThumb(src: CanvasImageSource, w: number, h: number): string {
  const ratio = w > 0 ? h / w : 9 / 16;
  const tw = THUMB_W;
  const th = Math.max(1, Math.round(tw * ratio));
  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const cx = c.getContext("2d")!;
  cx.drawImage(src, 0, 0, tw, th);
  return c.toDataURL("image/jpeg", 0.7);
}

function once(el: HTMLMediaElement, event: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => resolve();
    el.addEventListener(event, finish, { once: true });
    setTimeout(finish, timeoutMs);
  });
}

export async function generateThumb(media: MediaItem, url: string, kind: ProbeKind): Promise<void> {
  try {
    if (kind === "image") {
      const img = await loadImage(url);
      setThumb(media.id, drawThumb(img, img.naturalWidth, img.naturalHeight));
    } else if (kind === "video") {
      const v = document.createElement("video");
      v.muted = true;
      v.src = url;
      await once(v, "loadeddata");
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
      await once(v, "seeked");
      setThumb(media.id, drawThumb(v, v.videoWidth, v.videoHeight));
    }
  } catch {
    /* a missing thumbnail is non-fatal */
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}
