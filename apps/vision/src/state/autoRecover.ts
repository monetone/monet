/** Preferences ▸ File Handling ▸ Automatically Save Recovery Information.
 *  The pure half of crash recovery: the interval menu, the recovery file
 *  naming, and the per-tick plan. The I/O half lives in app.ts (`.mvision`
 *  project bytes written into the app-data recovery folder). */

/** Photoshop's interval menu, in minutes. 0 = recovery saving off. */
export const AUTO_RECOVER_MINUTES = [0, 5, 10, 15, 30, 60] as const;
export const DEFAULT_AUTO_RECOVER_MINUTES = 10;

/** Sub-folder of the app-data directory holding the recovery snapshots. */
export const RECOVERY_DIR = "recovery";

export function normalizeAutoRecoverMinutes(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && (AUTO_RECOVER_MINUTES as readonly number[]).includes(n)
    ? n
    : DEFAULT_AUTO_RECOVER_MINUTES;
}

/** One path component. A longer name is rejected by the filesystem (`NAME_MAX`),
 *  and the snapshot is then never written. CJK percent-encodes to nine bytes a
 *  character, so the tab name has to be clamped before encoding. */
export const RECOVERY_NAME_MAX = 255;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Shorten `name` until its percent-encoding fits in `budget` bytes, without
 *  splitting a surrogate pair (that makes `encodeURIComponent` throw). */
function clampRecoveryStem(name: string, budget: number): string {
  if (budget <= 0) return "";
  let end = name.length;
  while (end > 0 && isHighSurrogate(name.charCodeAt(end - 1))) end -= 1;
  while (end > 0 && encodeURIComponent(name.slice(0, end)).length > budget) {
    end -= 1;
    while (end > 0 && isHighSurrogate(name.charCodeAt(end - 1))) end -= 1;
  }
  return end > 0 ? name.slice(0, end) : "";
}

/** `<docId>-<percent-encoded tab name>.mvision`. The document name rides in the
 *  file name so the launch-time prompt can list what it found without a second
 *  index file; percent-encoding is what keeps a name like `../etc/passwd` or
 *  `a/b.psd` from becoming a path. The whole component stays within
 *  `RECOVERY_NAME_MAX`. */
export function recoveryFileName(docId: number, name: string): string {
  const prefix = `${Math.trunc(docId)}-`;
  const suffix = ".mvision";
  const stem = clampRecoveryStem(name, RECOVERY_NAME_MAX - prefix.length - suffix.length);
  return `${prefix}${stem ? encodeURIComponent(stem) : ""}${suffix}`;
}

/** The second process of a live session is launched with this query so its
 *  boot scan neither offers nor deletes the running session's snapshots. */
export function recoveryLaunchBlocked(search: string): boolean {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(query).get("recoveryBlocked") === "1";
}

/** Inverse of `recoveryFileName`, applied to whatever is really on disk — a
 *  hand-dropped or foreign file in the recovery folder returns null and is left
 *  alone. The decoded name is a display/tab name only, never a path segment,
 *  but separators are rejected anyway. */
export function parseRecoveryFileName(file: string): { docId: number; name: string } | null {
  const m = /^(\d+)-(.*)\.mvision$/i.exec(file);
  if (!m) return null;
  let name: string;
  try { name = decodeURIComponent(m[2]); } catch { return null; }
  if (!name || name.includes("/") || name.includes("\\")) return null;
  return { docId: Number(m[1]), name };
}

export interface RecoveryDocState {
  id: number;
  dirty: boolean;
  contentRevision: number;
}

export type RecoveryCandidate = { file: string; name: string };

type RecoveryIO = {
  read(file: string): Promise<Uint8Array>;
  open(bytes: Uint8Array, name: string, file: string): Promise<void> | void;
  remove(file: string): Promise<void>;
  report(name: string, error: unknown): void;
};

/** Apply the launch-time recovery choice. A restored snapshot stays on disk
 *  until that document is saved or explicitly discarded — deleting it at open
 *  loses the work to a second crash inside the auto-save interval. Declining
 *  recovery is that discard. Unreadable files stay for a later retry. */
export async function restoreRecoveryFiles(
  files: readonly RecoveryCandidate[],
  restore: boolean,
  io: RecoveryIO,
): Promise<number> {
  let recovered = 0;
  for (const entry of files) {
    if (!restore) {
      await io.remove(entry.file);
      continue;
    }
    try {
      await io.open(await io.read(entry.file), entry.name, entry.file);
      recovered++;
    } catch (error) {
      io.report(entry.name, error);
    }
  }
  return recovered;
}

/** One timer tick: which documents need a fresh snapshot, and which snapshots
 *  are stale (their document was saved or closed). `written` is the live
 *  doc id → last snapshotted content revision map. */
export function planRecovery(
  docs: readonly RecoveryDocState[],
  written: ReadonlyMap<number, { revision: number }>,
): { write: number[]; drop: number[] } {
  const write: number[] = [];
  for (const d of docs) {
    if (d.dirty && written.get(d.id)?.revision !== d.contentRevision) write.push(d.id);
  }
  const live = new Set(docs.filter((d) => d.dirty).map((d) => d.id));
  const drop = [...written.keys()].filter((id) => !live.has(id));
  return { write, drop };
}
