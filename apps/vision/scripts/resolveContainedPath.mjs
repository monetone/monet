import { resolve, sep } from "node:path";

/** Resolve an untrusted URL path below `root`, or return null on traversal. */
export function resolveContainedPath(root, requestPath) {
  let decoded;
  try { decoded = decodeURIComponent(requestPath.split("?", 1)[0]); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const base = resolve(root);
  const candidate = resolve(base, decoded);
  return candidate.startsWith(`${base}${sep}`) ? candidate : null;
}
