import { describe, expect, it, vi } from "vitest";

import type { PhotoRow } from "../catalog/types";
import {
  acceptPreview,
  acceptSharedRevision,
  observeRenderedProof,
  renderedObservation,
  resolvePreview,
  resolveSelectionPhoto,
  startSecondaryDisplaySession,
  startSharedSelectionSync,
} from "./SecondaryDisplay";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const photo = (id: number) => ({ id, path: `/photo-${id}.png` }) as PhotoRow;
const shared = (
  activePhotoId: number | null,
  revision: number,
): Parameters<typeof acceptSharedRevision>[0] => ({
  catalogId: "/proof.galcat",
  activePhotoId,
  selection: activePhotoId == null ? [] : [activePhotoId],
  revision,
});

describe("SecondaryDisplay race guards", () => {
  it("resolves proof config before sync and ignores config completion after unmount", async () => {
    const config = deferred<{ catalogPath: string; fixtures: [string, string] } | null>();
    const recordProof = vi.fn();
    const startSync = vi.fn(() => vi.fn());
    const fail = vi.fn();
    const stop = startSecondaryDisplaySession(
      () => config.promise,
      recordProof,
      startSync,
      fail,
    );

    expect(startSync).not.toHaveBeenCalled();
    config.resolve(null);
    await flush();
    expect(recordProof).toHaveBeenCalledWith(null);
    expect(startSync).toHaveBeenCalledOnce();
    stop();
    expect(startSync.mock.results[0].value).toHaveBeenCalledOnce();

    const lateConfig = deferred<{ catalogPath: string; fixtures: [string, string] } | null>();
    const lateRecord = vi.fn();
    const lateStart = vi.fn(() => vi.fn());
    const lateFail = vi.fn();
    const stopBeforeConfig = startSecondaryDisplaySession(
      () => lateConfig.promise,
      lateRecord,
      lateStart,
      lateFail,
    );
    stopBeforeConfig();
    lateConfig.resolve(null);
    await flush();
    expect(lateRecord).not.toHaveBeenCalled();
    expect(lateStart).not.toHaveBeenCalled();
    expect(lateFail).not.toHaveBeenCalled();

    const failedConfig = deferred<null>();
    const failedStart = vi.fn(() => vi.fn());
    const failedFail = vi.fn();
    const stopAfterFailure = startSecondaryDisplaySession(
      () => failedConfig.promise,
      vi.fn(),
      failedStart,
      failedFail,
    );
    failedConfig.reject(new Error("proof unavailable"));
    await flush();
    expect(failedFail).toHaveBeenCalledOnce();
    expect(failedStart).toHaveBeenCalledOnce();
    stopAfterFailure();

    const lateFailure = deferred<null>();
    const ignoredFail = vi.fn();
    const ignoredStart = vi.fn(() => vi.fn());
    const stopBeforeFailure = startSecondaryDisplaySession(
      () => lateFailure.promise,
      vi.fn(),
      ignoredStart,
      ignoredFail,
    );
    stopBeforeFailure();
    lateFailure.reject(new Error("late proof failure"));
    await flush();
    expect(ignoredFail).not.toHaveBeenCalled();
    expect(ignoredStart).not.toHaveBeenCalled();
  });

  it("contains session callback exceptions without starting synchronization twice", async () => {
    const recordError = new Error("record failed");
    const recordFail = vi.fn();
    const recordStart = vi.fn(() => vi.fn());
    startSecondaryDisplaySession(
      async () => null,
      () => {
        throw recordError;
      },
      recordStart,
      recordFail,
    );
    await flush();
    expect(recordFail).toHaveBeenCalledExactlyOnceWith(recordError);
    expect(recordStart).toHaveBeenCalledOnce();

    const syncError = new Error("sync failed");
    const syncFail = vi.fn();
    const syncStart = vi.fn(() => {
      throw syncError;
    });
    startSecondaryDisplaySession(
      async () => null,
      vi.fn(),
      syncStart,
      syncFail,
    );
    await flush();
    expect(syncFail).toHaveBeenCalledExactlyOnceWith(syncError);
    expect(syncStart).toHaveBeenCalledOnce();
  });

  it("keeps a newer event authoritative while the initial snapshot is deferred", async () => {
    const registration = deferred<() => void>();
    const snapshot = deferred<ReturnType<typeof shared>>();
    let handler!: (value: ReturnType<typeof shared>) => void;
    const latestRevision = { current: -1 };
    const applied: Array<{ photo: number | null; preview: string | null; proof: number }> = [];
    const apply = vi.fn(async (value: ReturnType<typeof shared>) => {
      if (acceptSharedRevision(value, latestRevision)) {
        applied.push({
          photo: value.activePhotoId,
          preview: value.activePhotoId == null ? null : `blob:photo-${value.activePhotoId}`,
          proof: value.revision,
        });
      }
    });
    const stop = startSharedSelectionSync(
      (next) => {
        handler = next;
        return registration.promise;
      },
      () => snapshot.promise,
      apply,
      vi.fn(),
    );

    registration.resolve(vi.fn());
    await flush();
    handler(shared(2, 2));
    await flush();
    snapshot.resolve(shared(1, 1));
    await flush();

    expect(applied).toEqual([{ photo: 2, preview: "blob:photo-2", proof: 2 }]);
    expect(latestRevision.current).toBe(2);
    stop();
  });

  it("registers before snapshot and disposes when unmount races registration", async () => {
    const registration = deferred<() => void>();
    const readSnapshot = vi.fn(async () => shared(1, 1));
    const dispose = vi.fn();
    const stop = startSharedSelectionSync(
      () => registration.promise,
      readSnapshot,
      vi.fn(async () => {}),
      vi.fn(),
    );

    expect(readSnapshot).not.toHaveBeenCalled();
    registration.resolve(dispose);
    await flush();
    expect(readSnapshot).toHaveBeenCalledOnce();

    const lateRegistration = deferred<() => void>();
    const lateRead = vi.fn(async () => shared(1, 1));
    const lateDispose = vi.fn();
    const stopBeforeRegistration = startSharedSelectionSync(
      () => lateRegistration.promise,
      lateRead,
      vi.fn(async () => {}),
      vi.fn(),
    );
    stopBeforeRegistration();
    lateRegistration.resolve(lateDispose);
    await flush();

    expect(lateDispose).toHaveBeenCalledOnce();
    expect(lateRead).not.toHaveBeenCalled();
    stop();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("rejects stale lookup and preview results while preserving current failures", async () => {
    let revision = 1;
    const lookup = deferred<PhotoRow | null>();
    const applyPhoto = vi.fn();
    const lookupTask = resolveSelectionPhoto(
      shared(1, 1),
      () => lookup.promise,
      () => revision === 1,
      applyPhoto,
    );
    revision = 2;
    lookup.resolve(photo(1));
    await lookupTask;
    expect(applyPhoto).not.toHaveBeenCalled();

    const lookupFailure = deferred<PhotoRow | null>();
    revision = 1;
    const staleLookupFailure = resolveSelectionPhoto(
      shared(1, 1),
      () => lookupFailure.promise,
      () => revision === 1,
      applyPhoto,
    );
    revision = 2;
    lookupFailure.reject(new Error("old lookup failed"));
    await expect(staleLookupFailure).resolves.toBeUndefined();

    await expect(resolveSelectionPhoto(
      shared(2, 2),
      async () => {
        throw new Error("current lookup failed");
      },
      () => true,
      applyPhoto,
    )).rejects.toThrow("current lookup failed");

    revision = 1;
    const preview = deferred<string | null>();
    const applyPreview = vi.fn();
    const fail = vi.fn();
    const revoke = vi.fn();
    const previewTask = resolvePreview(
      photo(1),
      1,
      () => preview.promise,
      () => revision === 1,
      applyPreview,
      fail,
      revoke,
    );
    revision = 2;
    preview.resolve("blob:photo-1");
    await previewTask;
    expect(applyPreview).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:photo-1");

    const staleFailure = deferred<string | null>();
    revision = 1;
    const failureTask = resolvePreview(
      photo(1),
      1,
      () => staleFailure.promise,
      () => revision === 1,
      applyPreview,
      fail,
      revoke,
    );
    revision = 2;
    staleFailure.reject(new Error("old preview failed"));
    await failureTask;
    expect(fail).not.toHaveBeenCalled();

    const staleNull = deferred<string | null>();
    revision = 1;
    const staleNullTask = resolvePreview(
      photo(1),
      1,
      () => staleNull.promise,
      () => revision === 1,
      applyPreview,
      fail,
      revoke,
    );
    revision = 2;
    staleNull.resolve(null);
    await staleNullTask;
    expect(fail).not.toHaveBeenCalled();

    await resolvePreview(photo(2), 2, async () => null, () => true, applyPreview, fail, revoke);
    expect(fail).toHaveBeenCalledWith("Preview rendering failed for photo 2");
    await resolvePreview(
      photo(2),
      2,
      async () => {
        throw new Error("current preview failed");
      },
      () => true,
      applyPreview,
      fail,
      revoke,
    );
    expect(fail).toHaveBeenCalledWith("Preview rendering failed: Error: current preview failed");

    const acceptedRevoke = vi.fn();
    const release = acceptPreview(
      { url: "blob:photo-2", photoId: 2, revision: 2 },
      applyPreview,
      acceptedRevoke,
    );
    release();
    release();
    expect(acceptedRevoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledTimes(1);

    expect(renderedObservation(
      { url: "blob:photo-1", photoId: 1, revision: 1 },
      shared(2, 2),
      photo(2),
      2,
      32,
      32,
    )).toBeNull();
    expect(renderedObservation(
      { url: "blob:photo-2", photoId: 2, revision: 2 },
      shared(2, 2),
      photo(2),
      2,
      64,
      64,
    )).toMatchObject({ activePhotoId: 2, revision: 2, previewWidth: 64, previewHeight: 64 });
  });

  it("reports current proof observation failures and ignores rejection after unmount", async () => {
    const current = deferred<unknown>();
    const currentFail = vi.fn();
    const currentTask = observeRenderedProof(
      () => current.promise,
      () => true,
      currentFail,
    );
    current.reject(new Error("current observation failed"));
    await currentTask;
    expect(currentFail).toHaveBeenCalledExactlyOnceWith(
      "Proof observation failed: Error: current observation failed",
    );

    let mounted = true;
    const late = deferred<unknown>();
    const lateFail = vi.fn();
    const lateTask = observeRenderedProof(
      () => late.promise,
      () => mounted,
      lateFail,
    );
    mounted = false;
    late.reject(new Error("late observation failed"));
    await expect(lateTask).resolves.toBeUndefined();
    expect(lateFail).not.toHaveBeenCalled();
  });
});
