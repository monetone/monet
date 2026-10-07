// blobs — a content-addressed store for large binary (PCM, images) that must
// NOT live in the document CRDT. Bytes are addressed by a content hash; the
// document carries only the hash (see Rythme's collab adapter). Backed by a
// dedicated Y.Map so blobs sync separately from — and never bloat — the document
// tree, with a local in-memory cache.
//
// v1 uses a fast non-cryptographic content hash and eager Yjs sync. Production
// should move to SHA-256 (crypto.subtle) for collision-safety and a lazy subdoc
// fetch so peers pull only the blobs they need (design doc §3.2(6)/§5).

import * as Y from "yjs";

/** 64-bit FNV-1a in two 32-bit lanes (no BigInt). Good enough for addressing. */
function hashBytes(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = (0x811c9dc5 ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
    h2 = Math.imul(h2 ^ bytes[i], 0x01000193);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h1) + hex(h2);
}

interface B64 {
  btoa?: (s: string) => string;
  atob?: (s: string) => string;
  Buffer?: { from(s: string, enc: string): { toString(enc: string): string } };
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const g = globalThis as B64;
  return g.btoa ? g.btoa(bin) : g.Buffer!.from(bin, "binary").toString("base64");
}

function fromBase64(b64: string): Uint8Array {
  const g = globalThis as B64;
  const bin = g.atob ? g.atob(b64) : g.Buffer!.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Content-addressed blob store over a Yjs `Y.Map<hash, base64>`. `put` is
 * idempotent by content (the same bytes always hash the same, so peers dedup).
 * `get` returns null until a peer's blob has synced in; subscribe with `onBlob`
 * to react when one arrives.
 */
export class BlobStore {
  private cache = new Map<string, Uint8Array>();
  private listeners = new Set<(hash: string) => void>();

  constructor(private readonly map: Y.Map<string>) {
    this.map.observe((e) => {
      for (const key of e.keysChanged) {
        if (this.map.has(key) && !this.cache.has(key)) {
          for (const l of this.listeners) l(key);
        }
      }
    });
  }

  /** Store bytes out-of-band. Returns the content hash to embed in the document. */
  put(bytes: Uint8Array): string {
    const hash = hashBytes(bytes);
    this.cache.set(hash, bytes);
    if (!this.map.has(hash)) this.map.set(hash, toBase64(bytes));
    return hash;
  }

  has(hash: string): boolean {
    return this.cache.has(hash) || this.map.has(hash);
  }

  /** Fetch bytes by hash, or null if not yet synced from a peer. */
  get(hash: string): Uint8Array | null {
    const cached = this.cache.get(hash);
    if (cached) return cached;
    const b64 = this.map.get(hash);
    if (b64 == null) return null;
    const bytes = fromBase64(b64);
    this.cache.set(hash, bytes);
    return bytes;
  }

  /** Notify when a blob becomes available (synced from a peer). */
  onBlob(fn: (hash: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
