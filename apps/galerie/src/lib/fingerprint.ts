// fingerprint — content identity for duplicate detection on import.
//
/** Full-file SHA-256 used for duplicate identity and source-change detection. */
export async function fingerprint(bytes: Uint8Array, _byteSize = bytes.byteLength): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
