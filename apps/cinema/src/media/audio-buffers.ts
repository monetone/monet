// audio-buffers.ts — a shared AudioContext + decoded AudioBuffer cache, keyed
// by mediaId. decodeAudioData works on full media files (incl. mp4/webm video
// containers — it extracts the audio track), so video-with-audio clips share
// this path. The waveform peaks module decodes separately (ephemeral context).

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!ctx) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctx();
  }
  return ctx;
}

const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer | null>>();

export async function getAudioBuffer(mediaId: string, objectUrl: string): Promise<AudioBuffer | null> {
  const have = buffers.get(mediaId);
  if (have) return have;
  const inFlight = pending.get(mediaId);
  if (inFlight) return inFlight;
  const p = (async () => {
    try {
      const resp = await fetch(objectUrl);
      const ab = await resp.arrayBuffer();
      const buf = await audioContext().decodeAudioData(ab);
      buffers.set(mediaId, buf);
      return buf;
    } catch {
      return null;
    } finally {
      pending.delete(mediaId);
    }
  })();
  pending.set(mediaId, p);
  return p;
}

export function getBufferSync(mediaId: string): AudioBuffer | null {
  return buffers.get(mediaId) ?? null;
}

export function evictBuffer(mediaId: string): void {
  buffers.delete(mediaId);
}
