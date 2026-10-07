// ─────────────────────────────────────────────────────────────
// export.ts — offline render of the active sequence to an MP4.
//
// Renders every frame at full resolution: await-decode each visible source
// frame, composite through the engine, read the program RGBA, wrap it as a
// VideoFrame, and feed a WebCodecs VideoEncoder muxed by mp4-muxer. The audio
// mix is baked in the same pass: `renderMix` renders the *playback* graph into
// an OfflineAudioContext and the result is AAC-encoded onto a second track, so
// a Rythme → Cinema round trip yields a finished deliverable without leaving
// the suite. WebCodecs VideoEncoder is required — it's present in
// Chromium-based runtimes; older WKWebViews will throw a clear error. Audio is
// best-effort: a runtime without AudioEncoder/AAC still exports video.
// ─────────────────────────────────────────────────────────────

import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { engine, store } from "../state/app";
import { ensureFrameDecoded } from "../media/decoder";
import { activeSequence, findMedia, sequenceDuration } from "../timeline/model/query";
import { renderMix } from "./audio";
import { renderProgramFrame } from "./compositor";
import { collectVideoSpecs } from "./transition-specs";

export interface ExportProgress {
  frame: number;
  total: number;
}

// WebCodecs globals accessed dynamically so typecheck doesn't depend on the
// lib.dom version shipping the (still newish) VideoEncoder/VideoFrame types.
const G = globalThis as unknown as {
  VideoEncoder?: new (init: { output: (chunk: unknown, meta: unknown) => void; error: (e: unknown) => void }) => {
    configure: (cfg: unknown) => void;
    encode: (frame: unknown, opts?: unknown) => void;
    flush: () => Promise<void>;
    encodeQueueSize: number;
  };
  VideoFrame?: new (src: CanvasImageSource, init: { timestamp: number; duration: number }) => { close: () => void };
  AudioEncoder?: {
    new (init: { output: (chunk: unknown, meta: unknown) => void; error: (e: unknown) => void }): {
      configure: (cfg: unknown) => void;
      encode: (data: unknown) => void;
      flush: () => Promise<void>;
    };
    isConfigSupported?: (cfg: unknown) => Promise<{ supported?: boolean }>;
  };
  AudioData?: new (init: {
    format: string;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: Float32Array;
  }) => { close: () => void };
};

export function canExportVideo(): boolean {
  return typeof G.VideoEncoder !== "undefined" && typeof G.VideoFrame !== "undefined";
}

const AUDIO_CODEC = "mp4a.40.2"; // AAC-LC
const AUDIO_BITRATE = 192_000;

/** AAC-encode a rendered mix onto the muxer's audio track. */
async function encodeMix(muxer: Muxer<ArrayBufferTarget>, mix: AudioBuffer): Promise<void> {
  const { sampleRate, numberOfChannels } = mix;
  const encoder = new G.AudioEncoder!({
    output: (chunk, meta) => muxer.addAudioChunk(chunk as never, meta as never),
    error: (e) => console.error("AudioEncoder error:", e),
  });
  encoder.configure({ codec: AUDIO_CODEC, sampleRate, numberOfChannels, bitrate: AUDIO_BITRATE });

  const channels = Array.from({ length: numberOfChannels }, (_, c) => mix.getChannelData(c));
  const chunkFrames = Math.round(sampleRate / 10); // 100 ms per AudioData
  for (let off = 0; off < mix.length; off += chunkFrames) {
    const n = Math.min(chunkFrames, mix.length - off);
    // f32-planar: channel 0's samples, then channel 1's, …
    const planar = new Float32Array(n * numberOfChannels);
    for (let c = 0; c < numberOfChannels; c++) planar.set(channels[c].subarray(off, off + n), c * n);
    const data = new G.AudioData!({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: n,
      numberOfChannels,
      timestamp: Math.round((off * 1e6) / sampleRate),
      data: planar,
    });
    encoder.encode(data);
    data.close();
  }
  await encoder.flush();
}

export async function exportVideo(onProgress?: (p: ExportProgress) => void): Promise<Blob | null> {
  if (!canExportVideo()) {
    throw new Error("Video export needs WebCodecs (VideoEncoder); use a Chromium-based runtime.");
  }
  const seq = activeSequence(store.getProject());
  if (!seq) return null;
  const W = seq.width;
  const H = seq.height;
  const fps = Math.round(seq.fps) || 24;
  const total = Math.max(1, sequenceDuration(seq));

  // Bake the mix first: the muxer needs the audio track declared up front, and
  // a runtime that can't AAC-encode must fall back to a video-only file rather
  // than finalize an MP4 promising an empty audio track.
  let mix: AudioBuffer | null = null;
  if (G.AudioEncoder && G.AudioData) {
    try {
      mix = await renderMix(seq, total);
      if (mix) {
        const cfg = { codec: AUDIO_CODEC, sampleRate: mix.sampleRate, numberOfChannels: mix.numberOfChannels, bitrate: AUDIO_BITRATE };
        const probe = await G.AudioEncoder.isConfigSupported?.(cfg);
        if (probe && probe.supported === false) mix = null;
      }
    } catch (e) {
      console.warn("Audio mix render failed; exporting video only:", e);
      mix = null;
    }
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    ...(mix ? { audio: { codec: "aac" as const, numberOfChannels: mix.numberOfChannels, sampleRate: mix.sampleRate } } : {}),
    fastStart: "in-memory",
  });
  const encoder = new G.VideoEncoder!({
    output: (chunk, meta) => muxer.addVideoChunk(chunk as never, meta as never),
    error: (e) => console.error("VideoEncoder error:", e),
  });
  encoder.configure({ codec: "avc1.4d0028", width: W, height: H, bitrate: 10_000_000, framerate: fps });

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  for (let f = 0; f < total; f++) {
    // Block until every visible source frame for this output frame is decoded.
    await Promise.all(
      collectVideoSpecs(seq, f)
        .filter((s) => s.clip.kind === "video")
        .map((s) => {
          const m = findMedia(store.getProject(), s.clip.mediaId);
          return m ? ensureFrameDecoded(m, s.sampleFrame) : Promise.resolve();
        }),
    );
    // Re-assert full resolution every frame: the live program monitor re-ensures
    // the engine at *preview* scale, and it gets a turn during the awaits above —
    // a stale size makes readOutput() disagree with W×H. ensure() is a no-op when
    // the size already matches, so render → read stays synchronous and coherent.
    engine.ensure(W, H);
    renderProgramFrame(seq, f, 1);
    const rgba = engine.readOutput();
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), W, H), 0, 0);
    const vf = new G.VideoFrame!(canvas, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
    encoder.encode(vf, { keyFrame: f % fps === 0 });
    vf.close();
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    onProgress?.({ frame: f, total });
  }

  await encoder.flush();
  if (mix) await encodeMix(muxer, mix);
  muxer.finalize();
  return new Blob([muxer.target.buffer as ArrayBuffer], { type: "video/mp4" });
}
