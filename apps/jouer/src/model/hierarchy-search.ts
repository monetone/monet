// ─────────────────────────────────────────────────────────────
// hierarchy-search.ts — Unity's Hierarchy-window search, as a pure filter.
//
// Unity's Hierarchy search bar filters the object tree by **name** (a
// case-insensitive substring) and by **type** with the `t:` prefix (e.g.
// `t:Light`). Multiple `t:` terms broaden the type set; plain words narrow by
// name. Jouer mirrors that: `t:<kind>` matches a GameObject's `kind` (with a few
// Unity-ish synonyms/abbreviations), plain words must all appear in the name.
//
// Adaptation: Unity flattens the tree while searching; Jouer keeps the tree so
// matches stay reachable — a row is shown when it matches OR has a matching
// descendant (its ancestors come along as the path to the match).
//
// Pure + framework-free (no React/Phaser/DOM, no mutation): operates on plain
// GameObject[] so it is trivially unit-testable. Editor-only — the search query
// is never written to the `.jouer` document.
// ─────────────────────────────────────────────────────────────

import type { GameObject, GameObjectKind, Id } from "./types";

/** A parsed Hierarchy query: name substrings (ANDed) + allowed kinds (ORed). */
export interface ParsedQuery {
  /** Lowercased name fragments; every one must be a substring of the name. */
  names: string[];
  /** Allowed object kinds from `t:` terms; empty ⇒ no type constraint. Unknown
   *  type tokens are kept verbatim so they simply match nothing (Unity-like:
   *  searching for a non-existent type returns no results). */
  kinds: string[];
}

/** Unity-ish aliases/abbreviations for the `t:` type filter → canonical kind. */
const KIND_ALIASES: Record<string, GameObjectKind> = {
  sprite: "sprite",
  sprites: "sprite",
  image: "image",
  images: "image",
  img: "image",
  text: "text",
  txt: "text",
  label: "text",
  rectangle: "rectangle",
  rect: "rectangle",
  box: "rectangle",
  quad: "rectangle",
  ellipse: "ellipse",
  circle: "ellipse",
  oval: "ellipse",
  triangle: "triangle",
  tri: "triangle",
  hexagon: "hexagon",
  hex: "hexagon",
  hexagonflat: "hexagonFlat",
  hexflat: "hexagonFlat",
  flathex: "hexagonFlat",
  diamond: "diamond",
  dia: "diamond",
  capsule: "capsule",
  cap: "capsule",
  pill: "capsule",
  container: "container",
  group: "container",
  folder: "container",
};

const ALL_KINDS: GameObjectKind[] = [
  "sprite",
  "image",
  "text",
  "rectangle",
  "ellipse",
  "triangle",
  "hexagon",
  "hexagonFlat",
  "diamond",
  "capsule",
  "container",
];

/** Resolve a `t:` type token to a canonical kind: exact alias → kind-name prefix
 *  → the raw token (an impossible filter, so unknown types match nothing). */
function resolveKind(token: string): string {
  if (KIND_ALIASES[token]) return KIND_ALIASES[token];
  const prefix = ALL_KINDS.find((k) => k.startsWith(token));
  return prefix ?? token;
}

/** Whether a raw query is effectively empty (nothing to filter by). */
export function isHierarchyQueryEmpty(raw: string): boolean {
  return raw.trim().length === 0;
}

/** Split a raw query into name fragments + allowed kinds. Whitespace-delimited;
 *  `t:<type>` (non-empty type) contributes a kind, every other token a name. */
export function parseHierarchyQuery(raw: string): ParsedQuery {
  const names: string[] = [];
  const kinds: string[] = [];
  for (const tok of raw.toLowerCase().split(/\s+/)) {
    if (!tok) continue;
    if (tok.startsWith("t:")) {
      const type = tok.slice(2);
      if (!type) continue; // a bare "t:" is not a filter
      const kind = resolveKind(type);
      if (!kinds.includes(kind)) kinds.push(kind);
    } else {
      names.push(tok);
    }
  }
  return { names, kinds };
}

/** Whether an object matches a parsed query: every name fragment is a substring
 *  of its name (AND) AND its kind is allowed (when any `t:` term was given). */
export function objectMatchesQuery(o: GameObject, q: ParsedQuery): boolean {
  if (q.kinds.length > 0 && !q.kinds.includes(o.kind)) return false;
  if (q.names.length > 0) {
    const name = o.name.toLowerCase();
    if (!q.names.every((n) => name.includes(n))) return false;
  }
  return q.names.length > 0 || q.kinds.length > 0;
}

export interface HierarchyMatch {
  /** Ids of objects that directly match the query. */
  matches: Set<Id>;
  /** Ids to render: every match plus all of its ancestors (so nested matches
   *  stay reachable in the tree). Empty when the query is empty. */
  visible: Set<Id>;
}

/** Walk a scene's object tree and collect the matching ids plus the ancestor
 *  chain needed to reach them. An empty query yields empty sets (the caller
 *  shows the full, unfiltered tree). */
export function collectHierarchy(objects: GameObject[], q: ParsedQuery): HierarchyMatch {
  const matches = new Set<Id>();
  const visible = new Set<Id>();
  if (q.names.length === 0 && q.kinds.length === 0) return { matches, visible };

  const rec = (list: GameObject[], ancestors: Id[]): void => {
    for (const o of list) {
      if (objectMatchesQuery(o, q)) {
        matches.add(o.id);
        visible.add(o.id);
        for (const a of ancestors) visible.add(a);
      }
      if (o.children && o.children.length) rec(o.children, [...ancestors, o.id]);
    }
  };
  rec(objects, []);
  return { matches, visible };
}
