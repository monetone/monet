// ids — process-monotonic id generator for layers/tracks/keyframes/comps.
// Short, session-scoped, prefixed. Reset on a fresh document load.

let counter = 0;

export function newId(prefix: string): string {
  return `${prefix}_${(++counter).toString(36)}`;
}

export function resetIds(): void {
  counter = 0;
}
