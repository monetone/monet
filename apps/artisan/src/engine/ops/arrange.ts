// ─────────────────────────────────────────────────────────────
// ops/arrange — z-order (bring to front / forward, send backward / to back)
// ─────────────────────────────────────────────────────────────
// Reordering happens within each container (layer.items or a group's children)
// independently, preserving the relative order of the moved items.

import type { Document, ID, Item } from "../model/types";

type Container = { items: Item[]; from: number };

const containers = (doc: Document): Container[] => {
  const out: Container[] = [];
  const walk = (items: Item[], from = 0) => {
    out.push({ items, from });
    for (const it of items) if (it.type === "group") walk(it.children, it.clip ? 1 : 0);
  };
  for (const layer of doc.layers) walk(layer.items);
  return out;
};

const hasSel = ({ items, from }: Container, set: Set<ID>) => items.slice(from).some((i) => set.has(i.id));

export const bringToFront = (doc: Document, ids: Iterable<ID>): void => {
  const set = new Set(ids);
  for (const container of containers(doc)) {
    const { items: c, from } = container;
    if (!hasSel(container, set)) continue;
    const movable = c.slice(from);
    const sel = movable.filter((i) => set.has(i.id));
    const rest = movable.filter((i) => !set.has(i.id));
    c.splice(from, c.length - from, ...rest, ...sel);
  }
};

export const sendToBack = (doc: Document, ids: Iterable<ID>): void => {
  const set = new Set(ids);
  for (const container of containers(doc)) {
    const { items: c, from } = container;
    if (!hasSel(container, set)) continue;
    const movable = c.slice(from);
    const sel = movable.filter((i) => set.has(i.id));
    const rest = movable.filter((i) => !set.has(i.id));
    c.splice(from, c.length - from, ...sel, ...rest);
  }
};

export const bringForward = (doc: Document, ids: Iterable<ID>): void => {
  const set = new Set(ids);
  for (const { items: c, from } of containers(doc)) {
    for (let i = c.length - 2; i >= 0; i--) {
      if (i >= from && set.has(c[i].id) && !set.has(c[i + 1].id)) {
        [c[i], c[i + 1]] = [c[i + 1], c[i]];
      }
    }
  }
};

export const sendBackward = (doc: Document, ids: Iterable<ID>): void => {
  const set = new Set(ids);
  for (const { items: c, from } of containers(doc)) {
    for (let i = from + 1; i < c.length; i++) {
      if (set.has(c[i].id) && !set.has(c[i - 1].id)) {
        [c[i], c[i - 1]] = [c[i - 1], c[i]];
      }
    }
  }
};
