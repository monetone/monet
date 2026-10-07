import { readWithinFileSizeLimit } from "./boundedRead";

export interface LocalImportLimit {
  maxBytes: number;
  label: string;
}

interface BrowserBinaryFile {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface BrowserTextFile {
  size: number;
  text(): Promise<string>;
}

/** Browser File objects are immutable snapshots, so their metadata size is a
 * safe allocation preflight. Keep it centralized so every local import checks
 * the ceiling before calling the allocating arrayBuffer()/text() methods. */
export async function readBrowserImportBytes(
  file: BrowserBinaryFile,
  limit: LocalImportLimit,
): Promise<Uint8Array> {
  return readWithinFileSizeLimit(file.size, limit.maxBytes, limit.label, async () => (
    new Uint8Array(await file.arrayBuffer())
  ));
}

export async function readBrowserImportText(
  file: BrowserTextFile,
  limit: LocalImportLimit,
): Promise<string> {
  return readWithinFileSizeLimit(file.size, limit.maxBytes, limit.label, () => file.text());
}

export function decodeImportText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
