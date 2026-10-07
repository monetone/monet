import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import fixtureOneUrl from "../src-tauri/icons/32x32.png?url";
import fixtureTwoUrl from "../src-tauri/icons/64x64.png?url";
import { getPhoto, previewIdentity, previewPut } from "./catalog/catalog";
import type { ImportPhoto } from "./catalog/types";
import { store } from "./state/store";

interface ProofConfig {
  catalogPath: string;
  fixtures: [string, string];
}

interface SharedSelection {
  catalogId: string | null;
  activePhotoId: number | null;
  selection: number[];
  revision: number;
}

interface Observation {
  stage: "rendered" | "cleared" | "stale-rejected";
  catalogId?: string;
  activePhotoId: number | null;
  selection?: number[];
  revision: number;
  rejectedRevision?: number;
  previewWidth?: number;
  previewHeight?: number;
  viewportMarker: string;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => Promise<T | null>, label: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value != null) return value;
    await pause(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function snapshotFor(id: number, afterRevision = -1): Promise<SharedSelection> {
  return waitFor(async () => {
    const snapshot = await invoke<SharedSelection>("plugin:secondary|shared_selection");
    return snapshot.activePhotoId === id && snapshot.revision > afterRevision ? snapshot : null;
  }, `shared selection ${id}`);
}

async function clearedSnapshot(afterRevision: number): Promise<SharedSelection> {
  return waitFor(async () => {
    const snapshot = await invoke<SharedSelection>("plugin:secondary|shared_selection");
    return snapshot.activePhotoId == null
      && snapshot.selection.length === 0
      && snapshot.revision > afterRevision
      ? snapshot
      : null;
  }, "cleared shared selection");
}

async function windowLabels(count: number): Promise<string[]> {
  return waitFor(async () => {
    const labels = await invoke<string[]>("plugin:secondary|secondary_proof_windows");
    return labels.length === count ? labels : null;
  }, `${count} Tauri webview windows`);
}

export async function runSecondaryWindowProof(): Promise<void> {
  const config = await invoke<ProofConfig | null>("plugin:secondary|secondary_proof_config");
  if (!config) return;

  const observations: Observation[] = [];
  const unlisten = await listen<Observation>("galerie://secondary-proof-observation", (event) => {
    observations.push(event.payload);
  });

  try {
    const opened = await invoke<SharedSelection>("plugin:secondary|shared_selection");
    if (
      opened.catalogId !== config.catalogPath
      || opened.activePhotoId != null
      || opened.selection.length !== 0
    ) {
      throw new Error("Catalog-open snapshot was not reset");
    }
    const fixtureBytes = await Promise.all(
      [fixtureOneUrl, fixtureTwoUrl].map(async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer())),
    );
    const fingerprints = await Promise.all(fixtureBytes.map(async (bytes) =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
    ));
    const records: ImportPhoto[] = config.fixtures.map((path, index) => ({
      path,
      fingerprint: fingerprints[index],
      format: "png",
      byteSize: 0,
      mtime: 0,
      width: index ? 64 : 32,
      height: index ? 64 : 32,
      orientation: 1,
    }));
    const ids = await store.importPhotos(records);
    if (ids.length !== 2 || ids[0] === ids[1]) throw new Error(`Expected two proof photos, got ${ids}`);
    const proofPhotos = await Promise.all(ids.map((id) => getPhoto(id)));
    if (!proofPhotos[0] || !proofPhotos[1]) throw new Error("Secondary proof photos disappeared");
    const identities = await Promise.all(
      proofPhotos.map((photo) => previewIdentity(photo!.id, "secondary", 4096)),
    );
    await Promise.all([
      previewPut(ids[0], "secondary", 4096, identities[0], null, fixtureBytes[0]),
      previewPut(ids[1], "secondary", 4096, identities[1], null, fixtureBytes[1]),
    ]);

    store.select(ids[0]);
    const first = await snapshotFor(ids[0]);
    await invoke("plugin:secondary|open_secondary_display");
    const firstWindows = await windowLabels(2);
    const firstRender = await waitFor(
      async () => observations.find((o) => o.stage === "rendered" && o.revision === first.revision) ?? null,
      "first secondary preview",
    );

    await invoke("plugin:secondary|secondary_proof_close");
    const closedWindows = await windowLabels(1);

    store.select(ids[1]);
    const second = await snapshotFor(ids[1], first.revision);
    await invoke("plugin:secondary|open_secondary_display");
    const reopenedWindows = await windowLabels(2);
    const secondRender = await waitFor(
      async () => observations.find((o) => o.stage === "rendered" && o.revision === second.revision) ?? null,
      "reopened secondary preview",
    );

    await invoke("plugin:secondary|secondary_proof_close");
    const clearedClosedWindows = await windowLabels(1);
    await store.showDuplicates();
    const cleared = await clearedSnapshot(second.revision);
    await invoke("plugin:secondary|open_secondary_display");
    const clearedReopenedWindows = await windowLabels(2);
    const clearRender = await waitFor(
      async () => observations.find((o) => o.stage === "cleared" && o.revision === cleared.revision) ?? null,
      "reopened cleared selection",
    );

    await invoke("plugin:secondary|secondary_proof_emit_stale", { snapshot: second });
    const stale = await waitFor(
      async () => observations.find(
        (o) => o.stage === "stale-rejected"
          && o.rejectedRevision === second.revision
          && o.revision === cleared.revision,
      ) ?? null,
      "stale revision rejection",
    );

    const sharedFields = Object.keys(cleared).sort();
    const exact = (actual: unknown[], expected: unknown[]) =>
      actual.length === expected.length && actual.every((value, index) => value === expected[index]);
    const pass = exact(
      [opened.revision, first.revision, second.revision, cleared.revision],
      [1, 2, 3, 4],
    )
      && exact(firstWindows, ["main", "secondary"])
      && exact(closedWindows, ["main"])
      && exact(reopenedWindows, ["main", "secondary"])
      && exact(clearedClosedWindows, ["main"])
      && exact(clearedReopenedWindows, ["main", "secondary"])
      && exact(ids, [1, 2])
      && first.catalogId === config.catalogPath
      && second.catalogId === config.catalogPath
      && cleared.catalogId === config.catalogPath
      && firstRender.activePhotoId === ids[0]
      && exact(firstRender.selection ?? [], [ids[0]])
      && secondRender.activePhotoId === ids[1]
      && exact(secondRender.selection ?? [], [ids[1]])
      && firstRender.previewWidth === 32
      && firstRender.previewHeight === 32
      && secondRender.previewWidth === 64
      && secondRender.previewHeight === 64
      && firstRender.previewWidth > 0
      && firstRender.previewHeight > 0
      && secondRender.previewWidth > 0
      && secondRender.previewHeight > 0
      && clearRender.activePhotoId == null
      && clearRender.selection?.length === 0
      && clearRender.revision === 4
      && cleared.activePhotoId == null
      && cleared.selection.length === 0
      && stale.rejectedRevision === 3
      && stale.revision === 4
      && stale.activePhotoId == null
      && firstRender.viewportMarker === "secondary:fit"
      && secondRender.viewportMarker === "secondary:fit"
      && sharedFields.join(",") === "activePhotoId,catalogId,revision,selection";
    if (!pass) throw new Error("Secondary proof observations did not satisfy the contract");

    await invoke("plugin:secondary|secondary_proof_finish", {
      report: {
        pass: true,
        windows: {
          firstOpen: firstWindows,
          closed: closedWindows,
          reopened: reopenedWindows,
          clearedClosed: clearedClosedWindows,
          clearedReopened: clearedReopenedWindows,
        },
        catalogId: config.catalogPath,
        revisions: [opened.revision, first.revision, second.revision, cleared.revision],
        selectedPhotoIds: ids,
        previews: [
          { photoId: firstRender.activePhotoId, width: firstRender.previewWidth, height: firstRender.previewHeight },
          { photoId: secondRender.activePhotoId, width: secondRender.previewWidth, height: secondRender.previewHeight },
        ],
        clearSnapshot: {
          revision: clearRender.revision,
          activePhotoId: clearRender.activePhotoId,
          selection: clearRender.selection,
        },
        staleRevision: { rejected: stale.rejectedRevision, retained: stale.revision, photoId: stale.activePhotoId },
        viewportState: { primary: "main:grid", secondary: firstRender.viewportMarker, sharedFields },
        closeReopen: true,
      },
    });
  } catch (error) {
    await invoke("plugin:secondary|secondary_proof_finish", {
      report: { pass: false, error: String(error), observations },
    });
    throw error;
  } finally {
    unlisten();
  }
}
