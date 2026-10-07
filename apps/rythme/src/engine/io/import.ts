// ─────────────────────────────────────────────────────────────
// engine/io/import — format-sniffing audio import & export
// ─────────────────────────────────────────────────────────────
// One entry point that dispatches on the file's magic bytes (with the
// extension as a fallback) so the UI can open any supported audio file without
// knowing its type up front.

import type { AudioData } from "../audio/types";
import { decodeAiff, encodeAiff, type AiffEncodeOptions } from "./aiff";
import { decodeWav, encodeWav, type WavEncodeOptions } from "./wav";

export type AudioFormat = "wav" | "aiff" | "unknown";

/** Identify a buffer by its RIFF/FORM magic. */
export function sniffFormat(bytes: Uint8Array): AudioFormat {
  const tag = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) if (bytes[o + i] !== s.charCodeAt(i)) return false;
    return true;
  };
  if (tag(0, "RIFF") && tag(8, "WAVE")) return "wav";
  if (tag(0, "FORM") && (tag(8, "AIFF") || tag(8, "AIFC"))) return "aiff";
  return "unknown";
}

/** Decode any supported audio file into AudioData. `name` is a fallback hint. */
export function decodeAudio(bytes: Uint8Array, name = ""): AudioData {
  let fmt = sniffFormat(bytes);
  if (fmt === "unknown") {
    const lower = name.toLowerCase();
    if (lower.endsWith(".wav")) fmt = "wav";
    else if (lower.endsWith(".aif") || lower.endsWith(".aiff") || lower.endsWith(".aifc")) fmt = "aiff";
  }
  switch (fmt) {
    case "wav":
      return decodeWav(bytes);
    case "aiff":
      return decodeAiff(bytes);
    default:
      throw new Error(`decodeAudio: unrecognised audio format for "${name || "buffer"}"`);
  }
}

/** Encode AudioData to the format implied by `name`'s extension. */
export function encodeAudio(
  d: AudioData,
  name: string,
  opts: WavEncodeOptions & AiffEncodeOptions = {},
): Uint8Array {
  const lower = name.toLowerCase();
  if (lower.endsWith(".aif") || lower.endsWith(".aiff")) return encodeAiff(d, opts);
  return encodeWav(d, opts);
}
