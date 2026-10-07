// backupPolicy — Lightroom's exit-time catalog backup schedule: how often to
// prompt (never / every exit / daily / weekly) and when the last backup ran.
// Pure due-logic + the same localStorage idiom as the other UI-workflow
// settings; the window-close interception lives in App.

import type { PresetStorage } from "./exportPresets";

export type BackupFrequency = "never" | "always" | "daily" | "weekly";

export interface BackupPolicy {
  frequency: BackupFrequency;
  /** Epoch seconds of the last completed backup, or null = never. */
  lastBackupAt: number | null;
}

/** Lightroom's default cadence. */
export const DEFAULT_BACKUP_POLICY: BackupPolicy = { frequency: "weekly", lastBackupAt: null };

const DAY = 86_400;

/** Is a backup due now (epoch seconds)? */
export function isBackupDue(
  frequency: BackupFrequency,
  lastBackupAt: number | null,
  now: number,
): boolean {
  switch (frequency) {
    case "never":
      return false;
    case "always":
      return true;
    case "daily":
      return lastBackupAt == null || now - lastBackupAt >= DAY;
    case "weekly":
      return lastBackupAt == null || now - lastBackupAt >= 7 * DAY;
  }
}

const KEY = "galerie.backupPolicy";

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const FREQUENCIES: readonly BackupFrequency[] = ["never", "always", "daily", "weekly"];

/** The stored policy; missing/corrupt storage yields Lightroom's default. */
export function loadBackupPolicy(storage: PresetStorage | null = defaultStorage()): BackupPolicy {
  if (!storage) return { ...DEFAULT_BACKUP_POLICY };
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return { ...DEFAULT_BACKUP_POLICY };
    const parsed = JSON.parse(raw) as Partial<BackupPolicy>;
    return {
      frequency: FREQUENCIES.includes(parsed.frequency as BackupFrequency)
        ? (parsed.frequency as BackupFrequency)
        : DEFAULT_BACKUP_POLICY.frequency,
      lastBackupAt: typeof parsed.lastBackupAt === "number" ? parsed.lastBackupAt : null,
    };
  } catch {
    return { ...DEFAULT_BACKUP_POLICY };
  }
}

export function saveBackupPolicy(
  policy: BackupPolicy,
  storage: PresetStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(policy));
  } catch {
    // storage unavailable — the session keeps its in-memory choice
  }
}

/** Record a completed backup at `now` (epoch seconds). */
export function markBackupDone(now: number, storage: PresetStorage | null = defaultStorage()): void {
  const p = loadBackupPolicy(storage);
  saveBackupPolicy({ ...p, lastBackupAt: now }, storage);
}
