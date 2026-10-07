// ─────────────────────────────────────────────────────────────
// mlJob.ts — cooperative cancellation for on-device ML jobs.
//
// A 50-step SD-1.5 generation or a several-hundred-tile denoise used to be
// escapable only by changing the document (the docChanged guard). The model
// call itself can't be interrupted, but every long job already has a natural
// boundary — a tile, a diffusion step, the stamp — so a job that checks the
// token at those points can be stopped in ~one unit of work.
//
// ponytail: `beginMlJob` is the one single-flight gate shared by dialogs and
// MCP, so a single module-level controller is enough and no signal has to be
// threaded through twenty call sites. Swap in per-call AbortSignals if
// concurrent ML jobs ever land; the boundary checks stay where they are.
// ─────────────────────────────────────────────────────────────

let ctrl: AbortController | null = null;

/** Mark the start of a cancellable job. Returns the cleanup for its `finally`. */
export function beginMlJob(): () => void {
  if (ctrl) throw new Error("Another ML job is already running.");
  const mine = new AbortController();
  ctrl = mine;
  return () => { if (ctrl === mine) ctrl = null; };
}

/** Ask the running job to stop; false when nothing is running. */
export function cancelMlJob(): boolean {
  if (!ctrl || ctrl.signal.aborted) return false;
  ctrl.abort();
  return true;
}

/** Throw at a tile/step/stamp boundary once the user hit Cancel. */
export function throwIfCancelled(): void {
  ctrl?.signal.throwIfAborted();
}

/** True once Cancel was pressed for the job still in flight. */
export function mlJobCancelled(): boolean {
  return ctrl?.signal.aborted ?? false;
}

/** Tell a user-pressed Cancel apart from a real failure in a catch block. */
export function isMlCancel(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { name?: string }).name === "AbortError";
}
