// waveform.ts — decode an audio track to normalized peak buckets for drawing.

import type { MediaItem } from "../timeline/model/types";
import { setPeaks } from "./registry";

const BUCKETS = 1024;

export async function generatePeaks(media: MediaItem, url: string): Promise<void> {
  try {
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const peaks = new Float32Array(BUCKETS);
    const step = Math.max(1, Math.floor(ch.length / BUCKETS));
    for (let i = 0; i < BUCKETS; i++) {
      let max = 0;
      const start = i * step;
      for (let j = 0; j < step && start + j < ch.length; j++) {
        const v = Math.abs(ch[start + j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    void ctx.close();
    setPeaks(media.id, peaks);
  } catch {
    /* peaks are optional eye-candy */
  }
}
