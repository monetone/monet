// App — the Monet Galerie workspace shell: a DockableWorkspace laid out like
// Lightroom Classic (Folders/Collections on the left, Histogram/Metadata on the
// right, a Filmstrip along the bottom, the grid/loupe in the center).
//
// The workspace wires catalog-backed modules around the shared shell.

import { useEffect, useRef, useState } from "react";

import {
  Canvas,
  DockableWorkspace,
  OptionsBar,
  StatusBar,
  ToolRail,
  isEditableTarget,
  useFileDrop,
  useMonetContext,
  syncMacMenu,
} from "@monet-ui/monet-react";

import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { backupCatalog, integrityCheck, optimizeCatalog, revealPath } from "./catalog/catalog";
import type { PhotoRow } from "./catalog/types";
import {
  CONTAINER_EXT,
  CONTAINER_EXTENSIONS,
  defaultContainerName,
} from "./export";
import { importDroppedPaths, synchronizeFolders } from "./import";
import { editInVision } from "./lib/editIn";
import { basename } from "./ui/GridCell";
import { CaptureTimeDialog } from "./ui/CaptureTimeDialog";
import { GeotagDialog } from "./ui/GeotagDialog";
import { SlideshowView } from "./ui/SlideshowView";
import { buildPreviews, previewTargetEdge } from "./lib/thumbnailLoader";
import { slideshowPlaylist } from "./lib/slideshow";
import { RenameDialog } from "./ui/RenameDialog";
import { LabelSetDialog } from "./ui/LabelSetDialog";
import { BackupPrompt } from "./ui/BackupPrompt";
import { PreferencesDialog } from "./ui/PreferencesDialog";
import { ViewOptionsDialog } from "./ui/ViewOptionsDialog";
import { WebGalleryDialog } from "./ui/WebGalleryDialog";
import { AutoImportDialog } from "./ui/AutoImportDialog";
import { restartAutoImport } from "./autoImport";
import { listRecentCatalogs, recordRecentCatalog } from "./lib/recentCatalogs";
import { isBackupDue, loadBackupPolicy, markBackupDone } from "./lib/backupPolicy";
import { importKeywordTree, parseKeywordFile, serializeKeywordFile } from "./lib/keywordFile";
import { newCollectionFromMenu } from "./lib/newCollection";
import { findQuickCollection } from "./lib/quickCollection";
import {
  setXmpAutoWriteEnabled,
  xmpAutoWriteEnabled,
  type KeywordVocabRow,
} from "./lib/xmpAutoWrite";
import { CopySettingsDialog } from "./ui/CopySettingsDialog";
import { ImportCatalogDialog } from "./ui/ImportCatalogDialog";
import { ImportDialog } from "./ui/ImportDialog";
import { PrintDialog } from "./ui/PrintDialog";
import { BookDialog } from "./ui/BookDialog";
import { store, useCatalog, type Module } from "./state/store";
import { openDefaultCatalog } from "./ui/catalogInit";
import { CollectionsPanel } from "./ui/CollectionsPanel";
import { KeywordListPanel } from "./ui/KeywordListPanel";
import { FoldersPanel } from "./ui/FoldersPanel";
import { PublishPanel } from "./ui/PublishPanel";
import { CompareView } from "./ui/CompareView";
import {
  SECONDARY_MODES,
  SECONDARY_READY_EVENT,
  SECONDARY_VIEW_EVENT,
  type SecondaryMode,
} from "./ui/SecondaryDisplay";
import { handleCullingKey, handleDevelopClipboardKey, handlePhotoKey } from "./ui/culling";
import { DevelopView } from "./ui/DevelopView";
import { resetDevelopAdjustments } from "./ui/DevelopPanels";
import { ExportDialog } from "./ui/ExportDialog";
import { RemoveDialog } from "./ui/RemoveDialog";
import { FilterBar } from "./ui/FilterBar";
import { Filmstrip } from "./ui/Filmstrip";
import { HistogramPanel } from "./ui/HistogramPanel";
import { LibraryGrid } from "./ui/LibraryGrid";
import { LoupeView } from "./ui/LoupeView";
import { MetadataPanel, syncMetadata } from "./ui/MetadataPanel";
import { CopyMetadataDialog, pasteMetadata } from "./ui/MetadataPresets";
import { PainterBar } from "./ui/PainterBar";
import { QuickDevelopPanel } from "./ui/QuickDevelopPanel";
import { SurveyView } from "./ui/SurveyView";

const ACCENT = "var(--accent-raster)";

async function optimizeNow() {
  try {
    await optimizeCatalog();
    store.notify("Catalog optimized.");
  } catch (e) {
    store.notify(`Optimize failed: ${String(e)}`);
  }
}

async function checkIntegrityNow() {
  try {
    const r = await integrityCheck();
    store.notify(r === "ok" ? "Integrity check: OK" : `Integrity: ${r}`);
  } catch (e) {
    store.notify(`Integrity check failed: ${String(e)}`);
  }
}

/** LR's Build Previews as a cancellable StatusBar job: one progress row, one
 *  summary toast, and Cancel stops it on the next photo. */
async function runPreviewBuild(
  photos: readonly PhotoRow[],
  label: string,
  noun: string,
  maxEdge: number | ((p: PhotoRow) => number),
) {
  const total = photos.length;
  let done = 0;
  const failed = await store.runJob(label, total, (job) =>
    buildPreviews(photos, "standard", maxEdge, undefined, {
      onTick: () => {
        done++;
        job.tick();
      },
      isCancelled: job.cancelled,
    }),
  );
  const built = done - failed;
  const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  store.notify(
    done < total
      ? `Stopped — built ${plural(built)} of ${total}`
      : failed
        ? `Built ${plural(built)} — ${failed} failed`
        : `Built ${plural(built)}`,
  );
}

/** Metadata ▸ Import Keywords: merge a tab-indented keyword file into the
 *  catalog vocabulary. Existing names are reused, so a re-import is a no-op. */
async function importKeywordsFromFile() {
  const path = await openDialog({
    title: "Import Keywords",
    multiple: false,
    filters: [{ name: "Keyword List", extensions: ["txt"] }],
  });
  if (typeof path !== "string") return;
  try {
    const { roots, skipped } = parseKeywordFile(await readTextFile(path));
    const { created, failed } = await importKeywordTree(roots, await store.keywordVocab(), (kw) =>
      invoke<number>("plugin:catalog|catalog_create_keyword", {
        name: kw.name,
        parentId: kw.parentId,
        synonyms: kw.synonyms,
        includeOnExport: kw.includeOnExport,
        // The file format carries neither flag; LR's own defaults apply.
        exportContaining: true,
        exportSynonyms: true,
      }),
    );
    await store.refreshKeywordList();
    const lost = skipped + failed;
    store.notify(
      `Imported ${created} keyword${created === 1 ? "" : "s"}${lost ? ` — ${lost} skipped` : ""}`,
    );
  } catch (e) {
    store.notify(`Import Keywords failed: ${String(e)}`);
  }
}

/** Metadata ▸ Export Keywords: write the whole vocabulary as a keyword file. */
async function exportKeywordsToFile() {
  const path = await save({
    title: "Export Keywords",
    defaultPath: "Keywords.txt",
    filters: [{ name: "Keyword List", extensions: ["txt"] }],
  });
  if (!path) return;
  try {
    const vocab = await store.keywordVocab();
    await writeTextFile(path, serializeKeywordFile(vocab));
    store.notify(`Exported ${vocab.length} keyword${vocab.length === 1 ? "" : "s"}`);
  } catch (e) {
    store.notify(`Export Keywords failed: ${String(e)}`);
  }
}

async function backupNow() {
  const dest = await save({
    title: "Back Up Catalog",
    defaultPath: "backup.galcat",
    filters: [{ name: "Catalog", extensions: ["galcat"] }],
  });
  if (!dest) return;
  try {
    await backupCatalog(dest);
    store.notify("Catalog backed up.");
  } catch (e) {
    store.notify(`Backup failed: ${String(e)}`);
  }
}

export function App() {
  const ctx = useMonetContext();
  const platform = ctx?.platform ?? "mac";
  const st = useCatalog();
  const docLabel = "Catalog";
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Synchronize Folders: new files found on disk, seeded into the Import dialog.
  const [syncPaths, setSyncPaths] = useState<string[]>([]);
  const [captureTimeOpen, setCaptureTimeOpen] = useState(false);
  const [geotagOpen, setGeotagOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [labelSetOpen, setLabelSetOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  // Exit-time backup prompt (LR): shown when the close is intercepted while due.
  const [backupPromptOpen, setBackupPromptOpen] = useState(false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const [webGalleryOpen, setWebGalleryOpen] = useState(false);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [xmpAuto, setXmpAuto] = useState(() => xmpAutoWriteEnabled());
  const [autoImportOpen, setAutoImportOpen] = useState(false);
  // File ▸ Open Recent (LR): most-recent-first catalog paths.
  const [recents, setRecents] = useState<string[]>(() => listRecentCatalogs());

  const openCatalogAt = async (path: string) => {
    await store.open(path);
    recordRecentCatalog(path);
    setRecents(listRecentCatalogs());
    void restartAutoImport(); // the watcher's diff must use the NEW catalog
  };
  const [backupBusy, setBackupBusy] = useState(false);
  const [copySettingsOpen, setCopySettingsOpen] = useState(false);
  const [copyMetadataOpen, setCopyMetadataOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  // Non-empty = the "Delete Rejected" confirm is open for exactly these ids.
  const [rejectIds, setRejectIds] = useState<number[]>([]);
  // Set = the "Import from Another Catalog" merge dialog is open for this path.
  const [mergeCatalogPath, setMergeCatalogPath] = useState<string | null>(null);

  // Photos an Output action targets: the selection, else the active photo.
  const targetPhotos = st.selection.length
    ? st.photos.filter((p) => st.selection.includes(p.id))
    : st.activeId != null
      ? st.photos.filter((p) => p.id === st.activeId)
      : [];
  // Live target ids for the (once-registered) keydown handler to read.
  const targetIdsRef = useRef<number[]>([]);
  targetIdsRef.current = targetPhotos.map((p) => p.id);

  // Photos dropped on the window import in place (Finder, or another Monet app's
  // export). ponytail: no hover chrome — the StatusBar job row + summary toast
  // are the feedback.
  useFileDrop({
    onPaths: (paths) =>
      void store.runJob("Importing", paths.length, (job) =>
        importDroppedPaths(paths, {
          onTick: job.tick,
          onTotal: job.setTotal,
          isCancelled: job.cancelled,
        }),
      ),
  });

  // Open the default catalog on start (loads the first page of photos).
  useEffect(() => {
    void openDefaultCatalog()
      .then(() => {
        // Record the startup catalog in Open Recent.
        const p = store.getState().catalogPath;
        if (p) {
          recordRecentCatalog(p);
          setRecents(listRecentCatalogs());
        }
      })
      .then(() => void restartAutoImport()) // watched-folder Auto Import (LR)
      .then(() => import("./secondaryProof"))
      .then((m) => m.runSecondaryWindowProof())
      .catch((e) => {
        store.notify(`Startup failed: ${String(e)}`);
        void invoke<{ catalogPath: string } | null>("plugin:secondary|secondary_proof_config")
          .then((proof) => proof && invoke("plugin:secondary|secondary_proof_finish", {
            report: { pass: false, error: `Startup failed: ${String(e)}` },
          }))
          .catch((reportError) => console.error("Secondary proof failure report failed:", reportError));
      });
  }, []);

  // Window ▸ Secondary Display ▸ <view>: open the second window and put it in a
  // view. A cold open has no listener yet, so the request is replayed when that
  // window announces itself ready.
  const secondaryView = useRef<SecondaryMode | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    const pending = listen(SECONDARY_READY_EVENT, () => {
      if (secondaryView.current) void emit(SECONDARY_VIEW_EVENT, secondaryView.current);
    });
    return () => {
      void pending.then((dispose) => dispose()).catch(() => {});
    };
  }, []);
  const openSecondaryDisplay = (mode?: SecondaryMode) => {
    secondaryView.current = mode ?? null;
    void invoke("plugin:secondary|open_secondary_display")
      .then(() => mode && emit(SECONDARY_VIEW_EVENT, mode))
      .catch((e) => store.notify(`Secondary display failed: ${String(e)}`));
  };

  // LR's exit-time catalog backup: intercept the window close when the policy
  // says one is due; the prompt then quits via destroy() (which skips this).
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .onCloseRequested((event) => {
          const p = loadBackupPolicy();
          if (!store.getState().ready) return;
          if (!isBackupDue(p.frequency, p.lastBackupAt, Date.now() / 1000)) return;
          event.preventDefault();
          setBackupPromptOpen(true);
        })
        .then((u) => {
          unlisten = u;
        }),
    );
    return () => unlisten?.();
  }, []);

  const quitNow = () =>
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().destroy());

  const backupAndQuit = async () => {
    setBackupBusy(true);
    try {
      const { appDataDir, join } = await import("@tauri-apps/api/path");
      const { mkdir } = await import("@tauri-apps/plugin-fs");
      const dir = await join(await appDataDir(), "backups");
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await backupCatalog(await join(dir, `galerie-${stamp}.galcat`));
      markBackupDone(Date.now() / 1000);
      quitNow();
    } catch (e) {
      // A failed backup must never eat the quit silently — surface and stay.
      setBackupBusy(false);
      setBackupPromptOpen(false);
      store.notify(`Backup failed: ${String(e)} — not quitting.`);
    }
  };

  // Global culling keys (rate/flag/label/navigate/module). Ignore when a text
  // field is focused or a menu shortcut modifier is held.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = isEditableTarget(e.target);
      // Copy/Paste Develop Settings (⇧⌘C / ⇧⌘V) work outside text fields.
      if (!inField && handleDevelopClipboardKey(e)) {
        e.preventDefault();
        return;
      }
      // Create Virtual Copy (⌘' / Ctrl+').
      if (!inField && handlePhotoKey(e)) {
        e.preventDefault();
        return;
      }
      // Export… (⇧⌘E / Ctrl+Shift+E).
      if (!inField && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setExportOpen(true);
        return;
      }
      // Undo / Redo (⌘Z / ⇧⌘Z) for library edits; in Develop, HistoryPanel owns
      // the binding and steps its history-stack pointer instead.
      if (
        !inField &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "z" &&
        store.getState().module !== "develop"
      ) {
        e.preventDefault();
        if (e.shiftKey) void store.redo();
        else void store.undo();
        return;
      }
      // Rename Photos (F2) — Lightroom's batch rename over the selection.
      if (!inField && e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (targetIdsRef.current.length > 0) setRenameOpen(true);
        return;
      }
      // Grid View Options (⌘J).
      if (!inField && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setViewOptionsOpen(true);
        return;
      }
      // Impromptu Slideshow (⌘↩).
      if (!inField && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === "Enter") {
        e.preventDefault();
        setSlideshowOpen(true);
        return;
      }
      // Show in Finder (⌘R): reveal the active photo's source file.
      if (!inField && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        const s = store.getState();
        const p = s.photos.find((x) => x.id === (s.activeId ?? s.selection[0]));
        if (p) void revealPath(p.path);
        return;
      }
      // Reset Adjustments (⇧⌘R / Ctrl+Shift+R): whole-image develop reset.
      if (!inField && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        resetDevelopAdjustments();
        return;
      }
      // Import Photos… (⇧⌘I / Ctrl+Shift+I) — the menu shows this shortcut.
      if (!inField && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setImportOpen(true);
        return;
      }
      // Stack (⌘G) / Unstack (⇧⌘G).
      if (!inField && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) void store.unstackActive();
        else void store.stackSelection();
        return;
      }
      // Select All (⌘A) / Deselect (⌘D) across the loaded library buffer.
      if (!inField && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        store.selectAll();
        return;
      }
      if (!inField && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        store.clearSelection();
        return;
      }
      // Delete Rejected (⌘⌫ / Ctrl+Backspace): collect the reject-flagged photos
      // in the current source, then confirm before removing them.
      if (
        !inField &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === "Backspace" || e.key === "Delete")
      ) {
        e.preventDefault();
        void store.collectRejectedIds().then((ids) => {
          if (ids.length) setRejectIds(ids);
          else store.notify("No rejected photos to remove.");
        });
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (inField) return;
      // Add to Target / Quick Collection (B). Ignore key-autorepeat.
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (!e.repeat) void store.toggleQuickMembership();
        return;
      }
      // Remove from Catalog (⌫ / Delete): open the confirm for the target photos.
      if ((e.key === "Backspace" || e.key === "Delete") && targetIdsRef.current.length > 0) {
        e.preventDefault();
        setRemoveOpen(true);
        return;
      }
      // Stacking: ⇧S moves the active photo to the top of its stack (LR); plain
      // S toggles the active photo's stack open/closed (our modal expand).
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          void store.setStackCoverActive();
        } else {
          const s = store.getState();
          const p = s.photos.find((x) => x.id === (s.activeId ?? s.selection[0]));
          // Develop keeps its grid source; only library views swap to the stack.
          if (s.module !== "develop" && p?.stackId)
            void store.expandStack(s.expandedStackId === p.stackId ? null : p.stackId);
        }
        return;
      }
      // Reference View (⇧R): LR's Develop two-up against the pinned reference.
      // The Develop menu already advertises this shortcut.
      if (e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        const s = store.getState();
        if (s.referencePhotoId == null) {
          store.notify("Pin a photo first: Develop ▸ Set as Reference Photo, or drag one onto the pane.");
        } else {
          if (!s.referenceActive) store.setModule("develop"); // the pane only exists in Develop
          store.toggleReference();
        }
        return;
      }
      if (handleCullingKey(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Library ▸ Add to Collection targets: manual collections only (sets/smart
  // have no manual membership); Quick is excluded — it has B and its own row.
  const quickId = findQuickCollection(st.collections)?.id ?? null;
  const addableCollections = st.collections.filter((c) => c.kind === "collection" && c.id !== quickId);
  // Remove is meaningful only while the grid shows a manual collection.
  const removableCollectionId = st.collections.some(
    (c) => c.id === st.activeCollectionId && c.kind === "collection",
  )
    ? st.activeCollectionId
    : null;

  const menus = [
    {
      id: "file",
      label: "File",
      items: [
        {
          id: "newcatalog",
          label: "New Catalog…",
          action: () =>
            void (async () => {
              const dest = await save({
                title: "New Catalog",
                defaultPath: "catalog.galcat",
                filters: [{ name: "Catalog", extensions: ["galcat"] }],
              });
              if (dest) await openCatalogAt(dest); // open() creates if absent
            })(),
        },
        {
          id: "opencatalog",
          label: "Open Catalog…",
          action: () =>
            void (async () => {
              const sel = await openDialog({
                multiple: false,
                directory: false,
                title: "Open Catalog",
                filters: [{ name: "Catalog", extensions: ["galcat"] }],
              });
              if (typeof sel === "string") await openCatalogAt(sel);
            })(),
        },
        {
          id: "opencontainer",
          label: "Open Container…",
          action: () =>
            void (async () => {
              // EVERY Monet extension, because dispatch is on the manifest —
              // and no filter at all, so a renamed container still opens.
              const sel = await openDialog({
                multiple: false,
                directory: false,
                title: "Open Monet Container",
                filters: [
                  { name: "Monet Container", extensions: CONTAINER_EXTENSIONS },
                  { name: "All Files", extensions: ["*"] },
                ],
              });
              if (typeof sel !== "string") return;
              // ponytail: containers stay out of Open Recent — those entries
              // reopen through `store.open`, which wants a live database, and
              // re-deciding by extension there is exactly what rule 1 forbids.
              // Give recents a per-entry kind if this ever gets asked for.
              if (await store.openContainer(sel)) void restartAutoImport();
            })(),
        },
        {
          id: "savecontainer",
          label: `Save As .${CONTAINER_EXT}…`,
          action: () =>
            void (async () => {
              const dest = await save({
                title: "Save Monet Container",
                defaultPath: defaultContainerName(store.getState().catalogPath),
                filters: [{ name: "Monet Container", extensions: [CONTAINER_EXT] }],
              });
              if (dest) await store.saveContainer(dest);
            })(),
        },
        {
          id: "openrecent",
          label: "Open Recent",
          items: recents.length
            ? recents.map((p, i) => ({
                id: `recent-${i}`,
                label: p.split("/").pop() ?? p,
                action: () => void openCatalogAt(p),
              }))
            : [{ id: "norecent", label: "None", disabled: true }],
        },
        { id: "sep0", separator: true },
        { id: "import", label: "Import Photos…", shortcut: "⇧⌘I", action: () => setImportOpen(true) },
        { id: "autoimport", label: "Auto Import…", action: () => setAutoImportOpen(true) },
        {
          id: "importcatalog",
          label: "Import from Another Catalog…",
          action: () =>
            void (async () => {
              const sel = await openDialog({
                multiple: false,
                directory: false,
                title: "Import from Another Catalog",
                filters: [{ name: "Catalog", extensions: ["galcat"] }],
              });
              // The dialog previews the merge (a rolled-back dry run) first.
              if (typeof sel === "string") setMergeCatalogPath(sel);
            })(),
        },
        { id: "export", label: "Export…", shortcut: "⇧⌘E", action: () => setExportOpen(true) },
        {
          id: "exportcatalog",
          label: "Export as Catalog…",
          action: () =>
            void (async () => {
              // ponytail: the selection, never an implicit "everything" — the
              // grid buffer is windowed (BUFFER_CAP), so an unselected export
              // would silently truncate a big catalog. Whole-catalog handoff is
              // Save As .mgal / Back Up Catalog. Give this an "all photos"
              // option once the catalog can hand out every id in one query.
              if (targetPhotos.length === 0) {
                store.notify("Select the photos to export (⌘A selects the whole grid).");
                return;
              }
              const dest = await save({
                title: "Export as Catalog",
                defaultPath: "export.galcat",
                filters: [{ name: "Catalog", extensions: ["galcat"] }],
              });
              if (dest) await store.exportAsCatalog(dest, targetPhotos.map((p) => p.id));
            })(),
        },
        { id: "copysettings", label: "Copy Settings…", action: () => setCopySettingsOpen(true) },
        { id: "webgallery", label: "Export Web Gallery…", action: () => setWebGalleryOpen(true) },
        { id: "print", label: "Print…", shortcut: "⌘P", action: () => setPrintOpen(true) },
        { id: "book", label: "Book…", action: () => setBookOpen(true) },
        { id: "sep1", separator: true },
        { id: "newCollection", label: "New Collection…", action: () => void newCollectionFromMenu() },
        { id: "sep2", separator: true },
        { id: "findmissing", label: "Find Missing Photos", action: () => void store.syncMissing() },
        {
          id: "syncfolders",
          label: "Synchronize Folders…",
          action: () =>
            void synchronizeFolders().then((found) => {
              if (found.length === 0) {
                store.notify("Folders are up to date — no new photos found");
                return;
              }
              setSyncPaths(found);
              setImportOpen(true);
            }),
        },
        { id: "optimize", label: "Optimize Catalog", action: () => void optimizeNow() },
        { id: "integrity", label: "Check Integrity", action: () => void checkIntegrityNow() },
        { id: "backup", label: "Back Up Catalog…", action: () => void backupNow() },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        {
          id: "undo",
          label: st.undoLabel ? `Undo ${st.undoLabel}` : "Undo",
          shortcut: "⌘Z",
          action: () => void store.undo(),
        },
        {
          id: "labelset",
          label: "Color Label Set…",
          action: () => setLabelSetOpen(true),
        },
        {
          id: "redo",
          label: st.redoLabel ? `Redo ${st.redoLabel}` : "Redo",
          shortcut: "⇧⌘Z",
          action: () => void store.redo(),
        },
        { id: "sep-prefs", separator: true },
        { id: "preferences", label: "Preferences…", action: () => setPreferencesOpen(true) },
      ],
    },
    {
      id: "library",
      label: "Library",
      items: [
        { id: "grid", label: "Grid View", shortcut: "G", action: () => store.setModule("grid") },
        { id: "viewoptions", label: "View Options…", shortcut: "⌘J", action: () => setViewOptionsOpen(true) },
        {
          id: "xmpauto",
          label: `Automatically Write XMP: ${xmpAuto ? "On" : "Off"}`,
          action: () => {
            const next = !xmpAuto;
            setXmpAutoWriteEnabled(next);
            setXmpAuto(next);
            store.notify(`XMP auto-write ${next ? "enabled" : "disabled"}`);
          },
        },
        { id: "loupe", label: "Loupe View", shortcut: "E", action: () => store.setModule("loupe") },
        { id: "compare", label: "Compare View", shortcut: "C", action: () => store.setModule("compare") },
        { id: "survey", label: "Survey View", shortcut: "N", action: () => store.setModule("survey") },
        {
          id: "slideshow",
          label: "Impromptu Slideshow",
          shortcut: "⌘↩",
          action: () => setSlideshowOpen(true),
        },
        {
          id: "renamephotos",
          label: "Rename Photos…",
          shortcut: "F2",
          action: () => targetPhotos.length > 0 && setRenameOpen(true),
        },
        {
          id: "capturetime",
          label: "Edit Capture Time…",
          action: () => targetPhotos.length > 0 && setCaptureTimeOpen(true),
        },
        {
          id: "geotag",
          label: "Geotag Photos…",
          action: () => setGeotagOpen(true),
        },
        { id: "sep-meta", separator: true },
        // LR's Metadata menu trio. ponytail: no ⌥⌘C/⌥⌘V bindings — menu
        // `shortcut` is display-only here, so a real chord needs the global
        // keydown handler; add it there if anyone reaches for the keys.
        {
          id: "copymetadata",
          label: "Copy Metadata…",
          action: () => (st.activeId ?? st.selection[0]) != null && setCopyMetadataOpen(true),
        },
        {
          id: "pastemetadata",
          label: "Paste Metadata",
          // pasteMetadata itself notifies when the clipboard is empty, so the
          // item stays enabled rather than mirroring clipboard state up here.
          action: () => void pasteMetadata(targetPhotos.map((p) => p.id)),
        },
        {
          id: "syncmetadata",
          label: "Sync Metadata",
          action: () => {
            const activeId = st.activeId ?? st.selection[0];
            if (activeId != null) void syncMetadata(activeId);
          },
        },
        {
          id: "importkeywords",
          label: "Import Keywords…",
          action: () => void importKeywordsFromFile(),
        },
        {
          id: "exportkeywords",
          label: "Export Keywords…",
          action: () => void exportKeywordsToFile(),
        },
        {
          id: "buildpreviews",
          label: "Build Standard-Sized Previews",
          action: () => {
            const targets = targetPhotos.length > 0 ? targetPhotos : st.photos;
            if (targets.length === 0) return;
            void runPreviewBuild(targets, "Building Standard Previews", "preview", 2560);
          },
        },
        {
          id: "build11previews",
          label: "Build 1:1 Previews",
          action: () => {
            const targets = targetPhotos.length > 0 ? targetPhotos : st.photos;
            if (targets.length === 0) return;
            void runPreviewBuild(targets, "Building 1:1 Previews", "1:1 preview", (p) =>
              previewTargetEdge(p) || 2560,
            );
          },
        },
        {
          id: "reveal",
          label: "Show in Finder",
          shortcut: "⌘R",
          action: () => {
            const p = targetPhotos[0];
            if (p) void revealPath(p.path);
          },
        },
        {
          id: "editinvision",
          label: "Edit in Monet Vision…",
          action: () => {
            const p = targetPhotos[0];
            if (!p) return;
            store.notify("Rendering a copy for Monet Vision…");
            void editInVision(p).then(
              (r) => {
                const name = basename(r.path);
                store.notify(
                  r.launchError
                    ? `Created ${name} — Monet Vision didn't open: ${r.launchError}`
                    : `Editing ${name} in Monet Vision`,
                );
              },
              (e) => store.notify(`Edit in Monet Vision failed: ${String(e)}`),
            );
          },
        },
        { id: "sep-stack", separator: true },
        { id: "stack", label: "Stack Photos", shortcut: "⌘G", action: () => void store.stackSelection() },
        { id: "unstack", label: "Unstack", shortcut: "⇧⌘G", action: () => void store.unstackActive() },
        { id: "splitstack", label: "Split Stack", action: () => void store.splitStackActive() },
        {
          id: "stackcover",
          label: "Move to Top of Stack",
          shortcut: "⇧S",
          action: () => void store.setStackCoverActive(),
        },
        { id: "stackup", label: "Move Up in Stack", action: () => void store.moveInStackActive(-1) },
        { id: "stackdown", label: "Move Down in Stack", action: () => void store.moveInStackActive(1) },
        {
          id: "expandallstacks",
          label: st.stacksExpanded ? "Collapse All Stacks" : "Expand All Stacks",
          action: () => void store.setStacksExpanded(!st.stacksExpanded),
        },
        { id: "sep-collections", separator: true },
        {
          id: "addtocollection",
          label: "Add to Collection",
          items: addableCollections.length
            ? addableCollections.map((c) => ({
                id: `addcol-${c.id}`,
                label: c.name,
                action: () => void store.addToCollection(c.id, targetPhotos.map((p) => p.id)),
              }))
            : [{ id: "nocollections", label: "No Collections", disabled: true }],
        },
        {
          id: "removefromcollection",
          label: "Remove from Collection",
          disabled: removableCollectionId == null || targetPhotos.length === 0,
          action: () => {
            if (removableCollectionId != null && targetPhotos.length > 0)
              void store.removeFromCollection(removableCollectionId, targetPhotos.map((p) => p.id));
          },
        },
        { id: "sep-remove", separator: true },
        { id: "remove", label: "Remove from Catalog…", shortcut: "⌫", action: () => setRemoveOpen(true) },
        {
          id: "delete-rejected",
          label: "Delete Rejected Photos…",
          shortcut: "⌘⌫",
          action: () =>
            void store.collectRejectedIds().then((ids) => {
              if (ids.length) setRejectIds(ids);
              else store.notify("No rejected photos to remove.");
            }),
        },
        {
          id: "autostack",
          label: "Auto-Stack by Capture Time…",
          action: () => {
            const input = window.prompt("Group photos taken within how many seconds?", "2");
            if (input == null) return;
            const gap = Number(input);
            if (Number.isFinite(gap) && gap > 0) void store.autoStackAll(Math.round(gap));
            else store.notify("Enter a positive number of seconds.");
          },
        },
        { id: "sep-lib", separator: true },
        {
          id: "vcopy",
          label: "Create Virtual Copy",
          shortcut: "⌘'",
          action: () => {
            const s = store.getState();
            // One copy per selected photo, like LR's ⌘'.
            const ids = s.selection.length ? s.selection : s.activeId != null ? [s.activeId] : [];
            if (ids.length) void store.createVirtualCopy(ids);
          },
        },
        {
          id: "copyname",
          label: "Set Copy Name…",
          action: () => {
            const s = store.getState();
            const p = s.photos.find((x) => x.id === (s.activeId ?? s.selection[0]));
            if (!p?.isVirtualCopy) {
              store.notify("Set Copy Name applies to virtual copies.");
              return;
            }
            const name = window.prompt("Copy name", p.copyName ?? "");
            if (name != null) void store.setCopyName(p.id, name);
          },
        },
      ],
    },
    {
      id: "develop",
      label: "Develop",
      items: [
        { id: "enter", label: "Enter Develop", shortcut: "D", action: () => store.setModule("develop") },
        {
          id: "setref",
          label: "Set as Reference Photo",
          action: () => {
            if (st.activeId != null) store.setReference(st.activeId);
          },
        },
        { id: "toggleref", label: "Show Reference View", shortcut: "⇧R", action: () => store.toggleReference() },
        { id: "reset", label: "Reset Adjustments", shortcut: "⇧⌘R", action: resetDevelopAdjustments },
        { id: "sep-sync", separator: true },
        {
          id: "autosync",
          label: `Auto Sync: ${st.autoSync ? "On" : "Off"}`,
          action: () => store.setAutoSync(!st.autoSync),
        },
        {
          id: "matchexposures",
          label: "Match Total Exposures",
          // Needs the active photo plus at least one peer to match to it.
          disabled: st.selection.length < 2,
          action: () => {
            const source = st.activeId ?? st.selection[0];
            if (source != null) void store.matchTotalExposures(source, st.selection);
          },
        },
      ],
    },
    {
      id: "window",
      label: "Window",
      items: [
        { id: "secondary", label: "Secondary Display", action: () => openSecondaryDisplay() },
        { id: "sep-secondary", separator: true },
        ...SECONDARY_MODES.map((m) => ({
          id: `secondary-${m.id}`,
          label: `Secondary ${m.label}`,
          action: () => openSecondaryDisplay(m.id),
        })),
      ],
    },
  ];

  const panels = {
    folders: { title: "Collections", render: () => <CollectionsPanel /> },
    foldertree: { title: "Folders", render: () => <FoldersPanel /> },
    keywordlist: { title: "Keywords", render: () => <KeywordListPanel /> },
    publish: { title: "Publish", render: () => <PublishPanel /> },
    histogram: { title: "Histogram", render: () => <HistogramPanel /> },
    quickdev: { title: "Quick Develop", render: () => <QuickDevelopPanel /> },
    metadata: { title: "Metadata", render: () => <MetadataPanel /> },
    filmstrip: { title: "Filmstrip", flush: true, render: () => <Filmstrip /> },
  };

  const initialLayout = {
    left: { size: 260, stack: [{ tabs: ["folders", "foldertree", "keywordlist", "publish"], active: "folders", flex: 1 }] },
    right: {
      size: 300,
      stack: [{ tabs: ["histogram", "quickdev", "metadata"], active: "histogram", flex: 1 }],
    },
    bottom: { size: 140, stack: [{ tabs: ["filmstrip"], active: "filmstrip", flex: 1 }] },
  };

  const toolbarDefs = {
    tools: {
      render: (orientation: "h" | "v") => (
        <ToolRail
          inline
          orientation={orientation}
          tools={[
            { id: "grid", name: "Grid", icon: "marquee", description: "Browse the catalog as a thumbnail grid." },
            { id: "loupe", name: "Loupe", icon: "zoom", description: "View a single photo at full size." },
            { id: "compare", name: "Compare", icon: "clone", description: "Compare two candidates side by side." },
            { id: "survey", name: "Survey", icon: "grid", description: "Lay out the whole selection to fit." },
          ]}
          active={st.module}
          onSelect={(id) => {
            if (id === "grid" || id === "loupe" || id === "compare" || id === "survey") {
              store.setModule(id as Module);
            }
          }}
        />
      ),
    },
    options: {
      horizontalOnly: true,
      render: () => (
        <OptionsBar>
          <FilterBar />
          <PainterBar />
        </OptionsBar>
      ),
    },
  };

  const selCount = st.selection.length;
  // macOS draws no in-window menu bar — menus live in the system bar — so
  // mirror them there, or every command without a keyboard shortcut or a
  // panel button is unreachable. No-op off mac / outside Tauri.
  const macMenus = menus;
  useEffect(() => {
    void syncMacMenu(macMenus, platform, { appName: "Galerie" });
  }, [macMenus, platform]);

  return (
    <>
    <DockableWorkspace
      accent={ACCENT}
      app="GALERIE"
      platform={platform}
      docs={[docLabel]}
      activeDoc={docLabel}
      menus={menus}
      toolbarDefs={toolbarDefs}
      initialToolbarLayout={{ left: ["tools"], top: ["options"] }}
      canvas={
        <Canvas>
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            {st.module === "loupe" ? (
              <LoupeView />
            ) : st.module === "develop" ? (
              <DevelopView />
            ) : st.module === "compare" ? (
              <CompareView />
            ) : st.module === "survey" ? (
              <SurveyView />
            ) : (
              <LibraryGrid />
            )}
          </div>
        </Canvas>
      }
      statusBar={
        <StatusBar>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {selCount > 0 ? `${selCount} selected · ` : ""}
            {st.total} photos
          </span>
          {/* LR's identity plate: every running task, each with its own Cancel. */}
          {st.jobs.map((j) => (
            <span
              key={j.id}
              className="gal-export-progress"
              role="progressbar"
              aria-label={j.label}
              aria-valuenow={j.done}
              aria-valuemin={0}
              aria-valuemax={j.total}
            >
              {j.label} {j.done}/{j.total}…
              <button type="button" aria-label={`Cancel ${j.label}`} onClick={() => store.cancelJob(j.id)}>
                Cancel
              </button>
            </span>
          ))}
          {st.notice && (
            <span style={{ fontSize: 11, color: "var(--text-2)", marginLeft: 16 }}>{st.notice}</span>
          )}
        </StatusBar>
      }
      panels={panels}
      initialLayout={initialLayout}
    />
    {exportOpen && <ExportDialog photos={targetPhotos} onClose={() => setExportOpen(false)} />}
    {mergeCatalogPath != null && (
      <ImportCatalogDialog path={mergeCatalogPath} onClose={() => setMergeCatalogPath(null)} />
    )}
    {webGalleryOpen && (
      <WebGalleryDialog photos={targetPhotos} onClose={() => setWebGalleryOpen(false)} />
    )}
    {removeOpen && targetPhotos.length > 0 && (
      <RemoveDialog
        count={targetPhotos.length}
        onClose={() => setRemoveOpen(false)}
        onConfirm={() => {
          void store.removePhotos(targetPhotos.map((p) => p.id));
          setRemoveOpen(false);
        }}
        onDelete={() => {
          void store.deleteFromDisk(targetPhotos.map((p) => p.id));
          setRemoveOpen(false);
        }}
      />
    )}
    {rejectIds.length > 0 && (
      <RemoveDialog
        count={rejectIds.length}
        onClose={() => setRejectIds([])}
        onConfirm={() => {
          void store.removePhotos(rejectIds);
          setRejectIds([]);
        }}
        onDelete={() => {
          void store.deleteFromDisk(rejectIds);
          setRejectIds([]);
        }}
      />
    )}
    {labelSetOpen && <LabelSetDialog onClose={() => setLabelSetOpen(false)} />}
    {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
    {viewOptionsOpen && <ViewOptionsDialog onClose={() => setViewOptionsOpen(false)} />}
    {slideshowOpen && (
      <SlideshowView
        photos={slideshowPlaylist(st.photos, st.selection)}
        onClose={() => setSlideshowOpen(false)}
      />
    )}
    {autoImportOpen && <AutoImportDialog onClose={() => setAutoImportOpen(false)} />}
    {backupPromptOpen && (
      <BackupPrompt
        busy={backupBusy}
        onBackup={() => void backupAndQuit()}
        onSkip={quitNow}
        onCancel={() => setBackupPromptOpen(false)}
      />
    )}
    {renameOpen && targetPhotos.length > 0 && (
      <RenameDialog photos={targetPhotos} onClose={() => setRenameOpen(false)} />
    )}
    {captureTimeOpen && targetPhotos[0] && (
      <CaptureTimeDialog photo={targetPhotos[0]} onClose={() => setCaptureTimeOpen(false)} />
    )}
    {geotagOpen && <GeotagDialog photos={targetPhotos} onClose={() => setGeotagOpen(false)} />}
    {(importOpen || st.importRequest != null) && (
      <ImportDialog
        initialPaths={st.importRequest ?? (syncPaths.length ? syncPaths : undefined)}
        onClose={() => {
          setImportOpen(false);
          setSyncPaths([]);
          store.clearImportRequest();
        }}
      />
    )}
    {copySettingsOpen && (st.activeId ?? st.selection[0]) != null && (
      <CopySettingsDialog photoId={(st.activeId ?? st.selection[0])!} onClose={() => setCopySettingsOpen(false)} />
    )}
    {copyMetadataOpen && (st.activeId ?? st.selection[0]) != null && (
      <CopyMetadataDialog photoId={(st.activeId ?? st.selection[0])!} onClose={() => setCopyMetadataOpen(false)} />
    )}
    {printOpen && (
      <PrintDialog photos={targetPhotos} onClose={() => setPrintOpen(false)} />
    )}
    {bookOpen && <BookDialog photos={targetPhotos} onClose={() => setBookOpen(false)} />}
    </>
  );
}
