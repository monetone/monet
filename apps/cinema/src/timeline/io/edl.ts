// edl.ts — CMX3600 EDL export for a sequence, in pure TS. One event per clip per
// track; source + record timecodes at the sequence frame rate. The interchange
// path Premiere/Resolve/Avid read. Covered by edl.test.ts.

import { framesToTimecode } from "../time/timecode";
import { clipsByStart } from "../model/query";
import type { Sequence } from "../model/types";

export function exportEdl(seq: Sequence): string {
  const fps = seq.fps;
  let out = `TITLE: ${seq.name || "SEQUENCE"}\nFCM: NON-DROP FRAME\n`;
  let event = 1;
  for (const track of seq.tracks) {
    const channel = track.kind === "audio" ? "A" : "V";
    for (const clip of clipsByStart(track)) {
      const srcIn = framesToTimecode(clip.inPoint, fps);
      const srcOut = framesToTimecode(clip.inPoint + clip.duration, fps);
      const recIn = framesToTimecode(clip.start, fps);
      const recOut = framesToTimecode(clip.start + clip.duration, fps);
      const ev = String(event).padStart(3, "0");
      out += `${ev}  AX       ${channel.padEnd(4)} C        ${srcIn} ${srcOut} ${recIn} ${recOut}\n`;
      const name = clip.name || clip.mediaId;
      if (name) out += `* FROM CLIP NAME: ${name}\n`;
      event += 1;
    }
  }
  return out;
}
