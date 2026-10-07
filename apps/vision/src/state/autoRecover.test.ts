import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUTO_RECOVER_MINUTES,
  DEFAULT_AUTO_RECOVER_MINUTES,
  normalizeAutoRecoverMinutes,
  parseRecoveryFileName,
  planRecovery,
  RECOVERY_NAME_MAX,
  recoveryFileName,
  recoveryLaunchBlocked,
  restoreRecoveryFiles,
} from "./autoRecover";

const appSource = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
const storeSource = readFileSync(fileURLToPath(new URL("./store.ts", import.meta.url)), "utf8");

describe("auto-recover interval preference", () => {
  it("offers Photoshop's interval menu and keeps only its values", () => {
    expect([...AUTO_RECOVER_MINUTES]).toEqual([0, 5, 10, 15, 30, 60]);
    for (const m of AUTO_RECOVER_MINUTES) expect(normalizeAutoRecoverMinutes(m)).toBe(m);
    expect(normalizeAutoRecoverMinutes("30")).toBe(30); // localStorage round-trip
    for (const bad of [7, -5, NaN, Infinity, null, undefined, "soon", {}]) {
      expect(normalizeAutoRecoverMinutes(bad)).toBe(DEFAULT_AUTO_RECOVER_MINUTES);
    }
  });
});

describe("recovery file naming", () => {
  it("round-trips the document name", () => {
    for (const name of ["Untitled-1", "sunset.psd", "naïve ☃.png", "100%", "a.mvision"]) {
      const file = recoveryFileName(7, name);
      expect(parseRecoveryFileName(file)).toEqual({ docId: 7, name });
    }
  });

  it("never turns a document name into a path segment", () => {
    for (const name of ["a/b.psd", "..\\..\\secrets", "../../etc/passwd"]) {
      const file = recoveryFileName(7, name);
      expect(file.includes("/")).toBe(false);
      expect(file.includes("\\")).toBe(false);
      expect(parseRecoveryFileName(file)).toBeNull(); // separators never survive the round trip
    }
  });

  it("ignores files it did not write", () => {
    for (const junk of ["notes.txt", "sunset.mvision", "-x.mvision", "3-.mvision", "3-%zz.mvision", "3-%2F.mvision"]) {
      expect(parseRecoveryFileName(junk)).toBeNull();
    }
  });

  it("keeps a long CJK name inside NAME_MAX and still parses it (#534)", () => {
    const name = "画".repeat(80);
    const file = recoveryFileName(12, name);
    expect(file.length).toBeLessThanOrEqual(RECOVERY_NAME_MAX);
    expect(file.includes("/")).toBe(false);
    const parsed = parseRecoveryFileName(file);
    expect(parsed?.docId).toBe(12);
    expect(parsed && name.startsWith(parsed.name)).toBe(true);
    expect(parsed && parsed.name.length).toBeGreaterThan(0);
    // The unclamped percent-encoding of the same name does not fit.
    expect(encodeURIComponent(name).length).toBeGreaterThan(RECOVERY_NAME_MAX);
  });
});

describe("a second process does not scan a live session (#553)", () => {
  it("reads the recoveryBlocked query the native guard puts on the second process", () => {
    expect(recoveryLaunchBlocked("?recoveryBlocked=1")).toBe(true);
    expect(recoveryLaunchBlocked("recoveryBlocked=1")).toBe(true);
    expect(recoveryLaunchBlocked("?cli=1")).toBe(false);
    expect(recoveryLaunchBlocked("")).toBe(false);
    expect(appSource).toContain('if (recoveryLaunchBlocked(typeof location === "undefined" ? "" : location.search)) return 0;');
    const main = readFileSync(fileURLToPath(new URL("../../src-tauri/src/main.rs", import.meta.url)), "utf8");
    const claim = main.indexOf("recovery_session::claim_recovery_session");
    const blockedUrl = main.indexOf('WebviewUrl::App("index.html?recoveryBlocked=1".into())');
    expect(claim).toBeGreaterThan(-1);
    expect(blockedUrl).toBeGreaterThan(claim);
  });
});

describe("recovery tick plan", () => {
  const snapshots = () => new Map<number, { revision: number; file: string }>();

  it("snapshots dirty documents once per content revision", () => {
    const written = snapshots();
    const docs = [{ id: 1, dirty: true, contentRevision: 4 }, { id: 2, dirty: false, contentRevision: 9 }];
    expect(planRecovery(docs, written)).toEqual({ write: [1], drop: [] });

    written.set(1, { revision: 4, file: "1-a.mvision" });
    expect(planRecovery(docs, written)).toEqual({ write: [], drop: [] });

    docs[0].contentRevision = 5; // an edit lands
    expect(planRecovery(docs, written)).toEqual({ write: [1], drop: [] });
  });

  it("drops the snapshot of a document that was saved or closed", () => {
    const written = snapshots();
    written.set(1, { revision: 4, file: "1-a.mvision" });
    written.set(2, { revision: 1, file: "2-b.mvision" });
    // 1 saved (clean), 2 closed entirely.
    expect(planRecovery([{ id: 1, dirty: false, contentRevision: 4 }], written)).toEqual({ write: [], drop: [1, 2] });
  });
});

describe("crash-recovery wiring", () => {
  it("runs the timer, the launch prompt and the save cleanup from app.ts", () => {
    expect(appSource).toContain("store.loadAutoRecoverMinutes();");
    expect(appSource).toContain("store.onAutoRecoverChange = startAutoRecover;");
    expect(appSource).toContain("store.onDocSaved = dropRecoverySnapshot;");
    // A command-line job's hidden window (#468) neither prompts nor snapshots.
    expect(appSource).toContain("if (documentRecoveryEnabled() && !isCliBoot()) void recoverLastSession().then(startAutoRecover, startAutoRecover);");
    expect(appSource).toContain("recoveryTimer = setInterval(() => { void writeRecoverySnapshots(); }, minutes * 60_000);");
    // Snapshots go through the atomic writer, like every other save path.
    expect(appSource).toContain("await atomicWriteBytes(`${dir}/${file}`, bytes);");
    // A snapshot that cannot be written is shown once per document, not only logged.
    expect(appSource).toContain("Could not save a recovery copy of");
    expect(appSource).toContain("if (!recoveryWarned.has(id))");
    // Reading a recovery file back stays inside the bounded native reader.
    expect(appSource).toContain("await readNativeFileBounded(path, (prefix) => openFileReadLimit(file, prefix)),");
  });

  it("clears the snapshot wherever the store clears a document's dirty flag", () => {
    // markDocSaved, markDocSavedAtRevision, adoptDocPath clear dirty outright;
    // revertActiveDoc clears it only when the new state really matches disk
    // (`d.dirty = opts?.dirty ?? false`), and fires the hook under that same
    // condition — a snapshot restore is unsaved state and MUST keep its recovery
    // snapshot (#27). A new site that clears dirty has to fire the hook too, or its
    // stale snapshot resurrects at the next launch.
    const cleared = storeSource.split(/d\.dirty = false;/).length - 1;
    const conditionallyCleared = storeSource.split(/d\.dirty = opts\?\.dirty \?\? false;/).length - 1;
    const fired = (storeSource.match(/this\.onDocSaved\?\.\(/g) ?? []).length;
    expect(cleared).toBe(3);
    expect(conditionallyCleared).toBe(1);
    expect(fired).toBe(4);
    // The conditional site must gate the hook on the same flag.
    expect(storeSource).toContain("if (!d.dirty) this.onDocSaved?.(d.id);");
    expect(storeSource).toContain('localStorage.setItem("mv.autoRecoverMinutes", String(next));');
  });

  it("restores valid snapshots from disk and retains a corrupt one for retry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vision-recovery-"));
    try {
      const valid = join(dir, recoveryFileName(1, "valid.mvis"));
      const corrupt = join(dir, recoveryFileName(2, "corrupt.mvis"));
      writeFileSync(valid, new Uint8Array([1, 2, 3]));
      writeFileSync(corrupt, new Uint8Array([0]));
      const opened: string[] = [];
      const errors: string[] = [];
      const io = {
        read: async (file: string) => new Uint8Array(await readFile(file)),
        open: (bytes: Uint8Array, name: string) => {
          if (bytes[0] === 0) throw new Error("corrupt project");
          opened.push(name);
        },
        remove: async (file: string) => { await rm(file); },
        report: (name: string) => { errors.push(name); },
      };

      expect(await restoreRecoveryFiles([
        { file: valid, name: "valid.mvis" },
        { file: corrupt, name: "corrupt.mvis" },
      ], true, io)).toBe(1);
      expect(opened).toEqual(["valid.mvis"]);
      expect(errors).toEqual(["corrupt.mvis"]);
      // #549: opening the recovered document keeps the snapshot for a second crash.
      expect(existsSync(valid)).toBe(true);
      expect(existsSync(corrupt)).toBe(true);

      // Declining recovery is an explicit discard.
      expect(await restoreRecoveryFiles([
        { file: valid, name: "valid.mvis" },
        { file: corrupt, name: "corrupt.mvis" },
      ], false, io)).toBe(0);
      expect(existsSync(valid)).toBe(false);
      expect(existsSync(corrupt)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
