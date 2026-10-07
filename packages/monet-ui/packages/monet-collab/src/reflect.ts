// ─────────────────────────────────────────────────────────────
// reflect — two-way reflection between a plain `.monet`-style document tree and
// a Yjs CRDT tree, so the apps keep their whole-state `store.mutate(...)` model
// while edits sync + merge across clients.
//
// Strategy (tuned to the apps' id-keyed trees):
//  • plain object            ↔ Y.Map
//  • array of {id} objects   ↔ Y.Map keyed by id + a `__pos` Y.Map<id, fracKey>
//      → concurrent edits to DIFFERENT entities merge granularly; ORDER is a
//        fractional index per item (see fracdex), so concurrent inserts AND
//        reorders converge and an item can never be duplicated or dropped (each
//        id owns one position slot — LWW per item on a concurrent same-item move).
//  • any other array / scalar↔ replaced wholesale (last-writer-wins) — fine for
//        keyframe arrays, [w,h] tuples, etc.
//
// `reconcile(root, plain)` mutates the Y tree minimally to match a new plain doc
// (called on every local edit); `materialize(root)` rebuilds the plain doc from
// the Y tree (called when a remote update arrives).
// ─────────────────────────────────────────────────────────────

import * as Y from "yjs";
import { initialKeys, keyBetween } from "./fracdex.js";

export type Plain = null | boolean | number | string | Plain[] | { [k: string]: Plain };

/** Reserved key holding an id-keyed collection's per-item fractional positions. */
const POS_KEY = "__pos";

function isIdObject(v: unknown): v is { id: string } {
  return !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as { id?: unknown }).id === "string";
}
/** An EMPTY array counts (#228): every document starts with `layers: []` /
 *  `clips: []`, and storing that as a plain Y.Array made the first insert a
 *  wholesale replace — last-writer-wins, so two collaborators each adding their
 *  first item silently lost one. Emptiness must be type-preserving: the slot
 *  stays an id collection through clear-and-refill too, which is what keeps
 *  `__pos` alive. */
function isIdArray(arr: unknown[]): arr is { id: string }[] {
  return arr.every(isIdObject);
}

/** Build a fresh Y value from a plain value (for first insertion / wholesale replace). */
function toY(value: Plain): unknown {
  if (Array.isArray(value)) {
    if (isIdArray(value)) {
      const map = new Y.Map<unknown>();
      const pos = new Y.Map<string>();
      const keys = initialKeys(value.length);
      value.forEach((item, i) => {
        const id = (item as { id: string }).id;
        map.set(id, toY(item as Plain));
        pos.set(id, keys[i]);
      });
      map.set(POS_KEY, pos);
      return map;
    }
    const arr = new Y.Array<unknown>();
    arr.push(value.map(toY));
    return arr;
  }
  if (value && typeof value === "object") {
    const map = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(value)) map.set(k, toY(v as Plain));
    return map;
  }
  return value;
}

/** Rebuild the plain document from the Y tree. */
export function materialize(value: unknown): Plain {
  if (value instanceof Y.Map) {
    if (value.has(POS_KEY)) {
      const pos = value.get(POS_KEY) as Y.Map<string>;
      const ids = [...value.keys()].filter((k) => k !== POS_KEY && value.has(k));
      ids.sort((x, y) => {
        const kx = pos.get(x) ?? "";
        const ky = pos.get(y) ?? "";
        if (kx !== ky) return kx < ky ? -1 : 1;
        return x < y ? -1 : x > y ? 1 : 0; // stable tie-break by id
      });
      return ids.map((id) => materialize(value.get(id)));
    }
    const obj: { [k: string]: Plain } = {};
    for (const [k, v] of value.entries()) obj[k] = materialize(v);
    return obj;
  }
  if (value instanceof Y.Array) return value.toArray().map(materialize);
  return value as Plain;
}

function plainEquals(a: Plain, b: Plain): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Reconcile a child slot (Y.Map key) to match `plain`, recursing where shapes line up. */
function reconcileChild(parent: Y.Map<unknown>, key: string, plain: Plain): void {
  const cur = parent.get(key);
  if (Array.isArray(plain) && isIdArray(plain) && cur instanceof Y.Map && cur.has(POS_KEY)) {
    reconcileCollection(cur, plain);
  } else if (!Array.isArray(plain) && plain !== null && typeof plain === "object" && cur instanceof Y.Map && !cur.has(POS_KEY)) {
    reconcileMap(cur, plain);
  } else {
    // scalar, non-id array, or shape change → replace (only if it actually changed)
    if (!(cur !== undefined && plainEquals(materialize(cur), plain))) {
      parent.set(key, toY(plain));
    }
  }
}

/** Reconcile a Y.Map to match a plain object. */
export function reconcileMap(map: Y.Map<unknown>, plain: { [k: string]: Plain }): void {
  for (const [k, v] of Object.entries(plain)) reconcileChild(map, k, v);
  for (const k of [...map.keys()]) {
    if (k !== POS_KEY && !(k in plain)) map.delete(k);
  }
}

/** Reconcile an id-keyed collection (Y.Map of items + `__pos`) to match a plain array. */
function reconcileCollection(map: Y.Map<unknown>, plain: { id: string }[]): void {
  const ids = plain.map((it) => it.id);
  const idSet = new Set(ids);
  for (const item of plain) reconcileChild(map, item.id, item as Plain);
  for (const k of [...map.keys()]) {
    if (k !== POS_KEY && !idSet.has(k)) map.delete(k);
  }
  reconcilePositions(map.get(POS_KEY) as Y.Map<string>, ids);
}

/**
 * Assign each id a fractional position key so the collection sorts to `ids`,
 * with MINIMAL writes: an existing key is kept whenever it already sorts after
 * the previous one (so an unchanged order writes nothing, and a concurrent peer
 * insert/reorder elsewhere is preserved); only out-of-order or new ids get a
 * freshly generated key between their settled neighbours.
 */
function reconcilePositions(pos: Y.Map<string>, ids: string[]): void {
  const idSet = new Set(ids);
  for (const k of [...pos.keys()]) {
    if (!idSet.has(k)) pos.delete(k);
  }
  let prev: string | null = null;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const cur = pos.get(id) ?? null;
    if (cur !== null && (prev === null || cur > prev)) {
      prev = cur; // already correctly ordered — keep it
      continue;
    }
    // Find the next existing key that sorts after `prev`, to bound the new key.
    let next: string | null = null;
    for (let j = i + 1; j < ids.length; j++) {
      const k = pos.get(ids[j]) ?? null;
      if (k !== null && (prev === null || k > prev)) {
        next = k;
        break;
      }
    }
    const key = keyBetween(prev, next);
    pos.set(id, key);
    prev = key;
  }
}

/** Reconcile the root Y.Map to a new plain document (call on every local edit). */
export function reconcile(root: Y.Map<unknown>, plain: { [k: string]: Plain }): void {
  reconcileMap(root, plain);
}
