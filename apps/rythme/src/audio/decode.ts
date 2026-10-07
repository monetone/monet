// ─────────────────────────────────────────────────────────────
// audio/decode — browser/WebView codec fallback for imported audio
// ─────────────────────────────────────────────────────────────
// The pure engine owns deterministic WAV/AIFF codecs. Browser-supported
// compressed formats (MP3/AAC/FLAC/OGG/etc.) are decoded here through Web Audio
// and converted into the same planar AudioData model.

import type { AudioData } from "../engine";

export function audioBufferToAudioData(buffer: AudioBuffer): AudioData {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c).slice());
  }
  return { sampleRate: buffer.sampleRate, channels };
}

export function browserAudioDecodeSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  );
}

export async function decodeBrowserAudio(bytes: Uint8Array): Promise<AudioData> {
  if (!browserAudioDecodeSupported()) throw new Error("Browser audio decoding is not available");
  const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtor();
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const decoded = await ctx.decodeAudioData(copy);
    return audioBufferToAudioData(decoded);
  } finally {
    void ctx.close();
  }
}
