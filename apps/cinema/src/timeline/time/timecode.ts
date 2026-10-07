// timecode.ts — Cinema's frame/timecode math now lives in the shared
// @monet-ui/monet-timeline engine (reused by every Monet NLE). Re-exported here
// so existing `../time/timecode` import sites stay stable.
export {
  clamp,
  framesToSeconds,
  secondsToFrames,
  framesToTimecode,
  timecodeToFrames,
  formatClock,
  sourceFrameAt,
} from "@monet-ui/monet-timeline";
