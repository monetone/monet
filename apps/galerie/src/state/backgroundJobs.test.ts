// backgroundJobs.test — the StatusBar job registry (LR's identity-plate progress
// stack): begin → tick → end, per-job cancellation, and the export job riding on
// top of it. The catalog bridge is stubbed wholesale; no job here touches it.

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), isTauri: () => false }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => true),
  readFile: vi.fn(async () => new Uint8Array([1])),
}));
vi.mock("../lib/fingerprint", () => ({ fingerprint: vi.fn(async () => "fp") }));
// The job registry is pure view state — it never reaches the catalog bridge, so
// an empty module stub is enough (store.ts takes it as a namespace import).
vi.mock("../catalog/catalog", () => ({ catalogAvailable: () => false }));

import { CatalogStore } from "./store";

describe("CatalogStore — background job stack", () => {
  it("tracks concurrent jobs and cancels each independently", () => {
    const s = new CatalogStore();
    expect(s.getState().jobs).toEqual([]);

    const imp = s.beginJob("Importing", 2);
    const prev = s.beginJob("Building 1:1 Previews", 10);
    expect(s.getState().jobs).toEqual([
      { id: imp, label: "Importing", done: 0, total: 2 },
      { id: prev, label: "Building 1:1 Previews", done: 0, total: 10 },
    ]);

    // A dropped folder is one path but N files — the loop corrects the total.
    s.setJobTotal(imp, 40);
    s.tickJob(imp);
    expect(s.getState().jobs[0]).toEqual({ id: imp, label: "Importing", done: 1, total: 40 });

    s.cancelJob(prev);
    expect(s.jobCancelled(prev)).toBe(true);
    expect(s.jobCancelled(imp)).toBe(false);

    s.endJob(prev);
    expect(s.getState().jobs.map((j) => j.id)).toEqual([imp]);
    // Ticking a finished job is a no-op, not a crash.
    s.tickJob(prev);
    expect(s.getState().jobs.map((j) => j.id)).toEqual([imp]);

    s.endJob(imp);
    expect(s.getState().jobs).toEqual([]);
  });

  it("runJob ends the job even when the loop throws", async () => {
    const s = new CatalogStore();
    await expect(
      s.runJob("Importing", 3, async (job) => {
        job.tick();
        expect(s.getState().jobs[0]).toMatchObject({ done: 1, total: 3 });
        throw new Error("decode blew up");
      }),
    ).rejects.toThrow("decode blew up");
    expect(s.getState().jobs).toEqual([]);
  });

  it("runJob's cancelled() flips when the StatusBar Cancel is clicked", async () => {
    const s = new CatalogStore();
    const seen: boolean[] = [];
    await s.runJob("Building Standard Previews", 2, async (job) => {
      seen.push(job.cancelled());
      s.cancelJob(s.getState().jobs[0].id);
      seen.push(job.cancelled());
    });
    expect(seen).toEqual([false, true]);
    // Ending clears the cancel flag with the row.
    expect(s.getState().jobs).toEqual([]);
  });

  it("the export job appears in the stack and still mirrors exportJob", () => {
    const s = new CatalogStore();
    s.beginExportJob(2);
    expect(s.getState().jobs).toEqual([{ id: expect.any(Number), label: "Exporting", done: 0, total: 2 }]);
    expect(s.getState().exportJob).toEqual({ done: 0, total: 2 });

    s.tickExportJob();
    expect(s.getState().jobs[0].done).toBe(1);
    expect(s.getState().exportJob).toEqual({ done: 1, total: 2 });

    // StatusBar Cancel targets the generic row; the export loop polls the mirror.
    s.cancelJob(s.getState().jobs[0].id);
    expect(s.exportCancelled()).toBe(true);

    s.endExportJob();
    expect(s.getState().jobs).toEqual([]);
    expect(s.getState().exportJob).toBeNull();
    expect(s.exportCancelled()).toBe(false);
  });
});
