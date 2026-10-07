// slideshowExport — deliver the Impromptu Slideshow (LR Slideshow module's
// Export PDF / Export JPEG / Export Video), plus the pure Ken Burns pan-zoom
// and crossfade timeline math shared by the live overlay (SlideshowView) and
// the offline video renderer. Delivery reuses the standard export pipeline
// (exportBytes / runExport) so every slide carries its full develop recipe.

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

import { buildPDF } from "@monet-ui/monet-imageio";
import type { PhotoRow } from "../catalog/types";
import { exportBytes, pickExportDir, runExport, type ExportOptions, type ExportResult } from "../export";

/** Slide rendering options shared by every delivery route. */
const SLIDE_EXPORT: ExportOptions = { format: "jpeg", quality: 0.9, longEdge: 2048 };

// ─── Ken Burns (LR Playback ▸ Pan and Zoom) ──────────────────────────

export type KenBurnsMode = "off" | "low" | "high";

/** Transform for slide `index` at progress `t` ∈ [0,1]. Even slides push in,
 *  odd pull back, and the pan direction alternates every other pair so
 *  consecutive slides never repeat the same move. `x`/`y` are fractions of the
 *  frame size. */
export function kenBurns(
  mode: KenBurnsMode,
  index: number,
  t: number,
): { scale: number; x: number; y: number } {
  if (mode === "off") return { scale: 1, x: 0, y: 0 };
  const depth = mode === "low" ? 0.08 : 0.16;
  const k = Math.min(1, Math.max(0, t));
  const p = index % 2 === 0 ? k : 1 - k;
  const dir = index % 4 < 2 ? 1 : -1;
  return { scale: 1 + depth * p, x: dir * (depth / 4) * p, y: -dir * (depth / 8) * p };
}

/** CSS transform string for the overlay's animated wrapper. */
export const kenBurnsCss = (kb: { scale: number; x: number; y: number }): string =>
  `scale(${kb.scale.toFixed(4)}) translate(${(kb.x * 100).toFixed(2)}%, ${(kb.y * 100).toFixed(2)}%)`;

// ─── Crossfade timeline ──────────────────────────────────────────────

/** Which slide(s) are visible at `tMs` and the crossfade mix (0 = all `a`,
 *  1 = all `b`). The fade occupies the tail of every slide except the last.
 *  `ta`/`tb` are each slide's own Ken Burns clock; a slide's clock starts at
 *  its fade-in (not its handoff) so the motion is continuous across the fade. */
export function videoFrameAt(
  tMs: number,
  count: number,
  durationMs: number,
  crossfadeMs: number,
): { a: number; b: number | null; mix: number; ta: number; tb: number } {
  const D = Math.max(1, durationMs);
  const X = Math.min(Math.max(0, crossfadeMs), D);
  const last = Math.max(0, count - 1);
  const i = Math.min(last, Math.max(0, Math.floor(tMs / D)));
  const phase = tMs - i * D;
  // A slide is visible from its fade-in (i·D − X) to its fade-out end
  // ((i+1)·D), so its Ken Burns clock spans D + X.
  const clock = (slide: number) => Math.min(1, Math.max(0, (tMs - slide * D + X) / (D + X)));
  if (i >= last || phase < D - X) return { a: i, b: null, mix: 0, ta: clock(i), tb: 0 };
  return { a: i, b: i + 1, mix: (phase - (D - X)) / X, ta: clock(i), tb: clock(i + 1) };
}

// ─── JPEG dimensions (for the PDF page boxes) ────────────────────────

/** Width/height from a JPEG's SOF marker. Trust boundary on encoder output:
 *  a malformed stream throws rather than yielding a 0×0 PDF page. */
export function jpegDims(jpeg: Uint8Array): { w: number; h: number } {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("jpegDims: not a JPEG");
  let o = 2;
  while (o + 9 < jpeg.length) {
    if (jpeg[o] !== 0xff) throw new Error("jpegDims: bad marker");
    const m = jpeg[o + 1];
    if (m === 0xff) {
      o++; // fill byte
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      o += 2; // standalone marker
      continue;
    }
    // Any SOFn except the DHT/JPG/DAC pseudo-markers carries the frame size.
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (jpeg[o + 5] << 8) | jpeg[o + 6], w: (jpeg[o + 7] << 8) | jpeg[o + 8] };
    }
    if (m === 0xda) break; // SOS — entropy data follows, no SOF found
    o += 2 + ((jpeg[o + 2] << 8) | jpeg[o + 3]);
  }
  throw new Error("jpegDims: no SOF marker");
}

// ─── Export PDF ──────────────────────────────────────────────────────

/** One PDF page per slide, each the developed JPEG at slideshow resolution.
 *  Returns false if the save dialog was cancelled. */
export async function exportSlideshowPdf(slides: PhotoRow[]): Promise<boolean> {
  if (slides.length === 0) return false;
  const path = await save({ defaultPath: "slideshow.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (typeof path !== "string") return false;
  const pages: { jpeg: Uint8Array; w: number; h: number }[] = [];
  for (const p of slides) {
    const jpeg = await exportBytes(p, SLIDE_EXPORT);
    pages.push({ jpeg, ...jpegDims(jpeg) });
  }
  await writeFile(path, buildPDF(pages));
  return true;
}

// ─── Export JPEG ─────────────────────────────────────────────────────

/** LR's slideshow Export JPEG: one file per slide through the standard export
 *  pipeline (naming, collision handling). Returns null if cancelled. */
export async function exportSlideshowJpegs(slides: PhotoRow[]): Promise<ExportResult | null> {
  if (slides.length === 0) return null;
  const dir = await pickExportDir();
  if (!dir) return null;
  return runExport(slides, dir, SLIDE_EXPORT);
}

// ─── Export Video ────────────────────────────────────────────────────

/** LR's video preset menu (H.264 sizes; 16:9). */
export const VIDEO_PRESETS = {
  "480p": { width: 854, height: 480, bitrate: 4_000_000 },
  "720p": { width: 1280, height: 720, bitrate: 8_000_000 },
  "1080p": { width: 1920, height: 1080, bitrate: 12_000_000 },
} as const;
export type VideoPreset = keyof typeof VIDEO_PRESETS;

/** Recorder mime, MP4 first for LR parity: the WKWebView desktop runtime
 *  records H.264 MP4; Chromium dev builds fall back to WebM. */
export function videoMime(supported: (t: string) => boolean): string {
  const types = ["video/mp4;codecs=h264", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  return types.find(supported) ?? "video/webm";
}

export interface SlideshowVideoOptions {
  durationMs: number;
  crossfadeMs: number;
  kenBurns: KenBurnsMode;
  preset: VideoPreset;
}

/** Draw one output frame: the current slide (and, mid-fade, the incoming one
 *  blended on top), each with its Ken Burns transform applied. */
export function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  bitmaps: ImageBitmap[],
  tMs: number,
  o: SlideshowVideoOptions,
  W: number,
  H: number,
): void {
  const drawSlide = (bmp: ImageBitmap, index: number, t: number, alpha: number) => {
    const k = kenBurns(o.kenBurns, index, t);
    // Contain-fit when static (LR letterboxes); cover-fit under pan-zoom so
    // the move never drags the frame edge into view.
    const base =
      o.kenBurns === "off"
        ? Math.min(W / bmp.width, H / bmp.height)
        : Math.max(W / bmp.width, H / bmp.height);
    const s = base * k.scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(bmp, (W - bmp.width * s) / 2 + k.x * W, (H - bmp.height * s) / 2 + k.y * H, bmp.width * s, bmp.height * s);
  };
  const f = videoFrameAt(tMs, bitmaps.length, o.durationMs, o.crossfadeMs);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  drawSlide(bitmaps[f.a], f.a, f.ta, 1);
  if (f.b !== null) drawSlide(bitmaps[f.b], f.b, f.tb, f.mix);
  ctx.globalAlpha = 1;
}

/** Render the slideshow to a video file (MP4 where the webview records it,
 *  else WebM) with Ken Burns and crossfade baked in. Returns false if the
 *  save dialog was cancelled. */
export async function exportSlideshowVideo(
  slides: PhotoRow[],
  o: SlideshowVideoOptions,
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  if (slides.length === 0) return false;
  const { width: W, height: H, bitrate } = VIDEO_PRESETS[o.preset];
  const mime = videoMime((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
  const ext = mime.includes("mp4") ? "mp4" : "webm";
  const path = await save({ defaultPath: `slideshow.${ext}`, filters: [{ name: "Video", extensions: [ext] }] });
  if (typeof path !== "string") return false;

  // Develop + decode each slide once up front at export size.
  const bitmaps: ImageBitmap[] = [];
  try {
    for (const p of slides) {
      const jpeg = await exportBytes(p, { ...SLIDE_EXPORT, longEdge: Math.max(W, H) });
      bitmaps.push(await createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" })));
    }

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const fps = 30;
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((res) => {
      rec.onstop = () => res();
    });
    rec.start();
    // ponytail: realtime capture — MediaRecorder stamps wall-clock time, so
    // the export runs as long as the slideshow does (same ceiling as Vision's
    // recordVideo). Swap to the offline WebCodecs VideoEncoder + mp4-muxer
    // path (apps/cinema/src/playback/export.ts) once mp4-muxer lands in
    // galerie's manifest.
    const total = slides.length * Math.max(1, o.durationMs);
    for (let t = 0; t < total; t += 1000 / fps) {
      drawVideoFrame(ctx, bitmaps, t, o, W, H);
      track.requestFrame?.();
      onProgress?.(t / total);
      await new Promise((r) => setTimeout(r, 1000 / fps));
    }
    await new Promise((r) => setTimeout(r, 120)); // let the last frame land
    rec.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mime });
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  } finally {
    for (const b of bitmaps) b.close();
  }
}
