// ─────────────────────────────────────────────────────────────
// embed.ts — decode Rythme's embedded PCM (`media.source.embed` in a `.monet`)
// into WAV bytes Cinema can feed to an <audio> element / decodeAudioData.
// Rythme stores each channel as base64 little-endian Float32 (see rythme's
// engine/io/base64.ts); Cinema has no float-PCM path, so without this a Rythme
// project cross-opens with audio clips that exist but are silent.
// ─────────────────────────────────────────────────────────────

/** The audio payload Rythme writes into `MonetMedia.source.embed`. */
export interface PcmEmbed {
  encoding: "f32-base64";
  sampleRate: number;
  channels: string[];
}

export function isPcmEmbed(v: unknown): v is PcmEmbed {
  const e = v as PcmEmbed | null | undefined;
  return (
    !!e &&
    e.encoding === "f32-base64" &&
    typeof e.sampleRate === "number" &&
    Array.isArray(e.channels) &&
    e.channels.every((c) => typeof c === "string")
  );
}

/** base64 → Float32 channel (little-endian, matching Rythme's writer). */
function b64ToFloats(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 4));
}

/**
 * Rythme PCM embed → a 16-bit PCM WAV file.
 * ponytail: 16-bit quantization is the ceiling — inaudible for playback/scrub,
 * but if Cinema ever re-exports embedded audio, emit float32 WAV (fmt tag 3)
 * or build an AudioBuffer directly instead of round-tripping through a file.
 */
export function pcmEmbedToWav(embed: PcmEmbed): Uint8Array {
  const channels = embed.channels.map(b64ToFloats);
  const numCh = Math.max(1, channels.length);
  const frames = channels.length > 0 ? Math.min(...channels.map((c) => c.length)) : 0;
  const rate = embed.sampleRate > 0 ? Math.round(embed.sampleRate) : 48000;
  const dataBytes = frames * numCh * 2;

  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const tag = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format = PCM integer
  view.setUint16(22, numCh, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * numCh * 2, true); // byte rate
  view.setUint16(32, numCh * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  tag(36, "data");
  view.setUint32(40, dataBytes, true);

  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
      off += 2;
    }
  }
  return new Uint8Array(buf);
}

/**
 * Pull `id → PcmEmbed` out of raw `.monet` JSON. Cinema's MediaItem model has
 * no field for embedded bytes, so the relink pass reads them straight off the
 * document text the open dialog already produced.
 * ponytail: a plain JSON.parse (the caller has already validated the file via
 * monet-format's `parse`); give MediaItem an `embed` field if more than the
 * relink pass ever needs it.
 */
export function pcmEmbedsFromJson(json: string): Map<string, PcmEmbed> {
  const out = new Map<string, PcmEmbed>();
  let media: unknown;
  try {
    media = (JSON.parse(json) as { document?: { media?: unknown } }).document?.media;
  } catch {
    return out;
  }
  if (!Array.isArray(media)) return out;
  for (const m of media as { id?: unknown; source?: { embed?: unknown } }[]) {
    const embed = m?.source?.embed;
    if (typeof m?.id === "string" && isPcmEmbed(embed)) out.set(m.id, embed);
  }
  return out;
}
