import { assertReadableFileSize } from "./boundedRead";

export interface NativeFileReadLimit {
  maxBytes: number;
  label: string;
}

interface NativeReadHandle {
  read(buffer: Uint8Array): Promise<number | null>;
  seek(offset: number, whence: number): Promise<number>;
  stat(): Promise<{ isFile: boolean; size: number }>;
  close(): Promise<void>;
}

interface OpenedNativeReadHandle {
  file: NativeReadHandle;
  seekStart: number;
}

export type NativeReadOpener = (path: string) => Promise<OpenedNativeReadHandle>;

const PREFIX_BYTES = 6;

async function openNativeReadHandle(path: string): Promise<OpenedNativeReadHandle> {
  const { open, SeekMode } = await import("@tauri-apps/plugin-fs");
  return { file: await open(path, { read: true }), seekStart: SeekMode.Start };
}

async function fill(handle: NativeReadHandle, output: Uint8Array): Promise<number> {
  let offset = 0;
  while (offset < output.length) {
    const read = await handle.read(output.subarray(offset));
    if (read === null || read === 0) break;
    offset += read;
  }
  return offset;
}

/**
 * Read an untrusted desktop file through one open handle. The size preflight,
 * signature sniff, and bounded read therefore all refer to the same file even
 * if the selected path is replaced concurrently. A length change on that open
 * file is rejected instead of returning a torn snapshot.
 */
export async function readNativeFileBounded(
  path: string,
  limitForPrefix: (prefix: Uint8Array) => NativeFileReadLimit,
  beforeAllocate?: (size: number) => void,
  opener: NativeReadOpener = openNativeReadHandle,
): Promise<Uint8Array> {
  const { file, seekStart } = await opener(path);
  try {
    const info = await file.stat();
    if (!info.isFile) throw new Error("Selected path is not a regular file.");

    const prefixBuffer = new Uint8Array(PREFIX_BYTES);
    const prefixLength = await fill(file, prefixBuffer);
    const limit = limitForPrefix(prefixBuffer.subarray(0, prefixLength));
    assertReadableFileSize(info.size, limit.maxBytes, limit.label);
    beforeAllocate?.(info.size);

    await file.seek(0, seekStart);
    const bytes = new Uint8Array(info.size);
    const read = await fill(file, bytes);
    if (read !== bytes.length) {
      throw new Error(`${limit.label} changed while it was being read.`);
    }
    const extra = new Uint8Array(1);
    if (await file.read(extra)) {
      throw new Error(`${limit.label} changed while it was being read.`);
    }
    return bytes;
  } finally {
    await file.close();
  }
}
