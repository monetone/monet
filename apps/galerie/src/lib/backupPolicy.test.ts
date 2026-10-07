import { describe, expect, it } from "vitest";

import type { PresetStorage } from "./exportPresets";
import {
  DEFAULT_BACKUP_POLICY,
  isBackupDue,
  loadBackupPolicy,
  markBackupDone,
  saveBackupPolicy,
} from "./backupPolicy";

function memStorage(initial: Record<string, string> = {}): PresetStorage {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

const DAY = 86_400;

describe("isBackupDue", () => {
  it("never / always are absolute", () => {
    expect(isBackupDue("never", null, 0)).toBe(false);
    expect(isBackupDue("always", Date.UTC(2026, 0, 1) / 1000, 10)).toBe(true);
  });

  it("daily and weekly honor their windows, and a first run is always due", () => {
    expect(isBackupDue("daily", null, 100)).toBe(true);
    expect(isBackupDue("daily", 1000, 1000 + DAY - 1)).toBe(false);
    expect(isBackupDue("daily", 1000, 1000 + DAY)).toBe(true);
    expect(isBackupDue("weekly", 1000, 1000 + 7 * DAY - 1)).toBe(false);
    expect(isBackupDue("weekly", 1000, 1000 + 7 * DAY)).toBe(true);
  });
});

describe("backup policy storage", () => {
  it("round-trips and marks completions", () => {
    const s = memStorage();
    expect(loadBackupPolicy(s)).toEqual(DEFAULT_BACKUP_POLICY);
    saveBackupPolicy({ frequency: "daily", lastBackupAt: null }, s);
    markBackupDone(5000, s);
    expect(loadBackupPolicy(s)).toEqual({ frequency: "daily", lastBackupAt: 5000 });
  });

  it("treats corrupt or unknown values as the default", () => {
    expect(loadBackupPolicy(memStorage({ "galerie.backupPolicy": "{oops" }))).toEqual(
      DEFAULT_BACKUP_POLICY,
    );
    expect(
      loadBackupPolicy(
        memStorage({ "galerie.backupPolicy": '{"frequency":"hourly","lastBackupAt":"x"}' }),
      ),
    ).toEqual(DEFAULT_BACKUP_POLICY);
  });
});
