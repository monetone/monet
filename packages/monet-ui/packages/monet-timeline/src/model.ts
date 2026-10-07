// ─────────────────────────────────────────────────────────────
// model.ts — the generic timeline document shape + id generation.
//
// A timeline is Sequence ▸ Track ▸ Clip. The engine only knows the *timing*
// backbone of a clip (`start`/`duration`/`inPoint`/`speed`/`enabled`); apps
// extend `TimelineClip` with their own payload (video transform/color, audio
// gain/fades, …) and the generic ops/queries preserve it via structuredClone.
// Time values are plain numbers — frames for video, seconds for audio.
// ─────────────────────────────────────────────────────────────

export type Id = string;

/**
 * The MINIMAL timing span every clip carries, regardless of media domain — the
 * only fields the read-only queries (clipAt, overlapping, edges, snap, …) need.
 * A seconds-based audio clip and a frame-based video clip both satisfy this, so
 * the query engine is reusable across apps that don't share the fuller clip
 * shape below (e.g. audio clips have no in-point/speed/enabled).
 */
export interface TimelineSpan {
  id: Id;
  /** Position on the timeline (frames or seconds). */
  start: number;
  /** Length on the timeline. */
  duration: number;
}

/**
 * The fuller timing backbone the editing ops read/write: a span plus a source
 * in-point, playback speed and an enabled flag. Apps extend it with their own
 * payload (video transform/color, …); ops preserve that via structuredClone.
 */
export interface TimelineClip extends TimelineSpan {
  /** First used source position (the in-point). */
  inPoint: number;
  /** Playback speed multiplier (1 = normal). */
  speed: number;
  enabled: boolean;
}

/** A lane of clips. Apps add name/kind/mixer fields; the engine needs `clips`. */
export interface TimelineTrack<C extends TimelineSpan = TimelineClip> {
  id: Id;
  clips: C[];
  /** Locked tracks are skipped by sweeping ops (e.g. razor-all). */
  locked?: boolean;
}

/** A sequence of tracks. Apps add fps/resolution/markers; the engine needs `tracks`. */
export interface TimelineSequence<C extends TimelineSpan = TimelineClip> {
  tracks: TimelineTrack<C>[];
}

// ── id generation ─────────────────────────────────────────────
// A monotonic counter shared by all generic ops AND the host app's factories
// (import these), so split/duplicate/insert can never mint an id that collides
// with an app-created one — and a per-session random token mixed in so two
// COLLABORATING clients never mint the same id either (the counter alone
// collides across peers). Mirrors Artisan's factory. `resetIds()` clears the
// token so tests get deterministic `clip_1` ids; production never resets.
let _counter = 0;
let _session = sessionToken();

function sessionToken(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID
    ? g.crypto.randomUUID().slice(0, 6)
    : Math.floor(Math.random() * 0x7fffffff).toString(36);
}

/** A globally-unique id with a type prefix (e.g. "clip_k3f9a1_3"): per-session
 *  random token + monotonic counter, unique across collaborators. */
export function newId(prefix: string): Id {
  _counter += 1;
  return _session ? `${prefix}_${_session}_${_counter}` : `${prefix}_${_counter}`;
}

/** Reset the id counter (and clear the session token, so tests get deterministic
 *  ids). `seed` sets the starting counter. NOT called in production. */
export function resetIds(seed = 0): void {
  _counter = seed;
  _session = "";
}
