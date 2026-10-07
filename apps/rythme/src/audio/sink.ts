// ─────────────────────────────────────────────────────────────
// audio/sink — optional Web Audio output-device routing
// ─────────────────────────────────────────────────────────────
// Some hosts expose AudioContext.setSinkId. Rythme treats it as a best-effort
// capability: apply the selected output device when available, otherwise keep
// using the system default without breaking playback or recording.

export interface AudioContextSinkLike {
  sinkId?: string;
  setSinkId?: (sinkId: string) => Promise<void> | void;
}

export interface AudioSinkApplyResult {
  requested: boolean;
  supported: boolean;
  applied: boolean;
  sinkId?: string;
  error?: string;
}

export function audioContextSinkSupported(ctx: unknown): ctx is AudioContextSinkLike {
  return typeof (ctx as AudioContextSinkLike | null | undefined)?.setSinkId === "function";
}

export async function applyAudioContextSink(ctx: unknown, outputDeviceId?: string): Promise<AudioSinkApplyResult> {
  const sinkId = outputDeviceId?.trim();
  const supported = audioContextSinkSupported(ctx);
  if (!sinkId) return { requested: false, supported, applied: false };
  if (!supported) return { requested: true, supported: false, applied: false, sinkId };
  const sinkCtx = ctx;
  if (sinkCtx.sinkId === sinkId) return { requested: true, supported: true, applied: true, sinkId };
  try {
    await sinkCtx.setSinkId!(sinkId);
    return { requested: true, supported: true, applied: true, sinkId };
  } catch (err) {
    return { requested: true, supported: true, applied: false, sinkId, error: sinkErrorMessage(err) };
  }
}

function sinkErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Audio output device routing failed";
}
