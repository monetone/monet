// ─────────────────────────────────────────────────────────────
// engine/model/ids — deterministic id generation
// ─────────────────────────────────────────────────────────────
// A monotonic counter rather than random ids: stable across a session, easy to
// assert in tests, and resettable. Ids are prefixed by kind for readability in
// serialised projects and devtools.

let counter = 0;
// Per-session random token mixed into every id so two COLLABORATING clients
// never mint the same id (the counter alone collides across peers). Cleared by
// resetIds() so tests get deterministic `clip-1` ids; production never resets.
let session = sessionToken();

function sessionToken(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID
    ? g.crypto.randomUUID().slice(0, 6)
    : Math.floor(Math.random() * 0x7fffffff).toString(36);
}

/** Next globally-unique id with the given prefix, e.g. `nextId("clip") →
 *  "clip-k3f9a1-7"` (per-session token + counter; unique across collaborators). */
export function nextId(prefix: string): string {
  counter += 1;
  return session ? `${prefix}-${session}-${counter}` : `${prefix}-${counter}`;
}

/** Reset the counter (and clear the session token for deterministic test ids) —
 *  call at the top of tests that assert on ids. */
export function resetIds(seed = 0): void {
  counter = seed;
  session = "";
}
