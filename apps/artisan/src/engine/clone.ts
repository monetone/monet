// ─────────────────────────────────────────────────────────────
// clone — draft-safe deep clone for model fragments
// ─────────────────────────────────────────────────────────────
// Ops run inside the store's Immer `produce` recipe, so the values they read off
// the document (items, paint, geometry, anchors…) are Immer draft Proxies, which
// `structuredClone` cannot copy (it throws DataCloneError on a Proxy). `cloneDeep`
// unwraps a draft to a plain snapshot via Immer's `current` before cloning, even
// when that draft is nested in a newly-built array/object wrapper.

import { current, isDraft, type Draft } from "immer";

export const cloneDeep = <T>(value: T): T => {
  if (isDraft(value)) return structuredClone(current(value as Draft<T>));
  if (Array.isArray(value)) return value.map(cloneDeep) as T;
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneDeep(nested)])) as T;
  }
  return structuredClone(value);
};
