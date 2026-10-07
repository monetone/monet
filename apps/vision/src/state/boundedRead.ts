/** Reject an untrusted file size before allocating or reading its contents. */
export function assertReadableFileSize(size: number, maxBytes: number, label: string) {
  if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
    const shown = maxBytes >= 1024 * 1024 ? `${Math.floor(maxBytes / (1024 * 1024))} MiB` : `${Math.floor(maxBytes / 1024)} KiB`;
    throw new Error(`${label} exceeds the ${shown} size limit.`);
  }
}

/** Keep the size check and the potentially allocating read in one operation so
 * callers cannot accidentally move the read ahead of the preflight. */
export async function readWithinFileSizeLimit<T>(
  size: number,
  maxBytes: number,
  label: string,
  read: () => Promise<T>,
): Promise<T> {
  assertReadableFileSize(size, maxBytes, label);
  return read();
}
