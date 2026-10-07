import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<[string, unknown]> = [];
let tauri = true;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    calls.push([cmd, args]);
    return Promise.resolve(13);
  },
  isTauri: () => tauri,
}));

const { dbAvailable, monetDb } = await import("../src/index.js");

describe("monetDb", () => {
  beforeEach(() => {
    calls.length = 0;
    tauri = true;
  });

  it("names commands from the plugin and prefix", async () => {
    const db = monetDb("catalog", "catalog_");
    await db.open("/Photos/Main.galcat");
    expect(calls).toEqual([
      ["plugin:catalog|catalog_open", { path: "/Photos/Main.galcat" }],
    ]);
  });

  it("defaults the prefix to db_", async () => {
    await monetDb("timeline").close();
    expect(calls[0]?.[0]).toBe("plugin:timeline|db_close");
  });

  it("passes every argument through by name", async () => {
    const db = monetDb("catalog");
    await db.close();
    await db.integrityCheck();
    await db.optimize();
    await db.backup("/backups/Main.galcat");
    expect(calls).toEqual([
      ["plugin:catalog|db_close", undefined],
      ["plugin:catalog|db_integrity_check", undefined],
      ["plugin:catalog|db_optimize", undefined],
      ["plugin:catalog|db_backup", { dest: "/backups/Main.galcat" }],
    ]);
  });

  // A bridge may only expose commands an app really registers. A binding with
  // nothing behind it typechecks, autocompletes, and then fails in front of a
  // user — `version`, `open_from_container` and `snapshot_to_container` all sat
  // here for exactly that reason. Adding one must break this list on purpose.
  it("exposes only the commands that exist natively", () => {
    expect(Object.keys(monetDb("catalog")).sort()).toEqual([
      "backup",
      "close",
      "integrityCheck",
      "open",
      "optimize",
    ]);
  });

  it("returns what the command returned", async () => {
    await expect(monetDb("catalog").open("/x.galcat")).resolves.toBe(13);
  });

  it("reports availability from the host", () => {
    expect(dbAvailable()).toBe(true);
    tauri = false;
    expect(dbAvailable()).toBe(false);
  });
});
