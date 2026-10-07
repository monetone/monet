// PublishPanel — Lightroom Classic's Publish Services rail, Hard Drive
// publisher. Each service is a manual collection carrying its settings in the
// rule field (lib/publishService), so photos are dragged in from the grid the
// same way as any collection; clicking a service browses its members. The row
// shows the New / Modified / Published / Deleted counts, and Publish pushes
// only that diff: it writes the new + modified members into the published
// folder and deletes the files of photos that left the service.
//
// ponytail: local Hard Drive publisher only; third-party publish plug-ins are
// not supported.

import { Button, Select } from "@monet-ui/monet-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { remove } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";
import type { DragEvent } from "react";

import * as cat from "../catalog/catalog";
import type { PhotoRow } from "../catalog/types";
import { outputFilename, runExport, type ExportOptions } from "../export";
import { joinPath } from "../lib/folderTree";
import { PHOTO_DRAG_TYPE, readPhotoDrag } from "../lib/photoDrag";
import {
  DEFAULT_PUBLISH_CONFIG,
  findPublishServices,
  forgetPublishService,
  forgetPublished,
  loadPublishRecords,
  markToRepublish,
  publishPlan,
  publishServiceMarker,
  publishSignature,
  publishSummary,
  recordPublished,
  type PublishPlan,
  type PublishServiceConfig,
  type PublishServiceRow,
  type PublishSummary,
} from "../lib/publishService";
import { store, useCatalog } from "../state/store";

/** The export settings a Hard Drive publisher writes with. */
function exportOptions(config: PublishServiceConfig): ExportOptions {
  return {
    format: config.format,
    quality: config.quality,
    longEdge: config.longEdge,
    naming: null,
  };
}

/** Current members + the diff against what the service last wrote.
 *  ponytail: one getRecipe IPC per member on every refresh — fine for a
 *  published folder, move the signature into SQL if services grow huge. */
async function planFor(service: PublishServiceRow): Promise<{ members: PhotoRow[]; plan: PublishPlan }> {
  const members = await cat.listCollectionPhotos(service.row.id, 1_000_000);
  const recipes = await Promise.all(members.map((p) => cat.getRecipe(p.id)));
  const signatures = new Map(
    members.map((p, i) => [p.id, publishSignature(p, recipes[i], service.config)] as const),
  );
  return { members, plan: publishPlan(members, signatures, loadPublishRecords(service.row.id)) };
}

export function PublishPanel() {
  const st = useCatalog();
  const services = findPublishServices(st.collections);
  const [summaries, setSummaries] = useState<Record<number, PublishSummary>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [dropId, setDropId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const [format, setFormat] = useState<"jpeg" | "png">(DEFAULT_PUBLISH_CONFIG.format);
  const [longEdge, setLongEdge] = useState(String(DEFAULT_PUBLISH_CONFIG.longEdge ?? ""));
  // Bumped after every mutation (publish, republish mark, membership) to re-run
  // the counts — records live outside React state.
  const [revision, setRevision] = useState(0);

  // `st.collections` is a stable store array — it only changes when the tree
  // reloads, so this recounts on tree changes and after our own mutations.
  useEffect(() => {
    if (!st.ready) return;
    let live = true;
    void (async () => {
      const next: Record<number, PublishSummary> = {};
      for (const service of findPublishServices(st.collections)) {
        try {
          const { members, plan } = await planFor(service);
          next[service.row.id] = publishSummary(plan, members.length);
        } catch (e) {
          console.error("galerie publish: count failed", service.row.name, e);
        }
      }
      if (live) setSummaries(next);
    })();
    return () => {
      live = false;
    };
  }, [st.ready, st.collections, revision]);

  const create = async () => {
    const n = name.trim();
    if (!n || !dir) return;
    const edge = Number(longEdge);
    const config: PublishServiceConfig = {
      dir,
      format,
      quality: DEFAULT_PUBLISH_CONFIG.quality,
      longEdge: Number.isFinite(edge) && edge >= 1 ? Math.floor(edge) : null,
    };
    const id = await store.createCollection(n, "collection", publishServiceMarker(config), null);
    if (id == null) return;
    setCreating(false);
    setName("");
    setDir("");
    store.setModule("grid");
    void store.setActiveCollection(id);
  };

  const pickFolder = async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: "Published Folder" });
    if (typeof picked === "string") setDir(picked);
  };

  const removeService = async (service: PublishServiceRow) => {
    await store.removeCollection(service.row.id);
    // Files already written stay on disk (LR keeps them); only the tracking goes.
    forgetPublishService(service.row.id);
    setRevision((r) => r + 1);
  };

  const publish = async (service: PublishServiceRow) => {
    const { row, config } = service;
    setBusyId(row.id);
    try {
      const { plan } = await planFor(service);
      const total = plan.publish.length + plan.remove.length;
      if (total === 0) {
        store.notify(`${row.name} is up to date.`);
        return;
      }
      const opts = exportOptions(config);
      let written = 0;
      let failed = 0;
      await store.runJob(`Publishing ${row.name}`, total, async (job) => {
        const gone: number[] = [];
        for (const entry of plan.remove) {
          if (job.cancelled()) break;
          try {
            await remove(entry.path);
          } catch (e) {
            // Already gone / unwritable: the photo left the service either way,
            // so stop tracking it rather than retry forever.
            console.error("galerie publish: delete failed", entry.path, e);
          }
          gone.push(entry.photoId);
          job.tick();
        }
        forgetPublished(row.id, gone);
        const done: { photoId: number; path: string; signature: string }[] = [];
        // One photo per runExport call so a per-photo failure is not recorded as
        // published (the batch result only carries counts).
        for (const entry of plan.publish) {
          if (job.cancelled()) break;
          const path = joinPath(config.dir, outputFilename(entry.photo, 0, opts));
          const res = await runExport([entry.photo], { dir: config.dir, existingFiles: "overwrite" }, opts);
          if (res.written + res.committed > 0) {
            done.push({ photoId: entry.photo.id, path, signature: entry.signature });
            written++;
          } else {
            failed++;
          }
          job.tick();
        }
        recordPublished(row.id, done);
      });
      const parts = [`${written} published`];
      if (plan.remove.length) parts.push(`${plan.remove.length} removed`);
      if (failed) parts.push(`${failed} failed`);
      store.notify(`${row.name}: ${parts.join(", ")}.`);
    } catch (e) {
      store.notify(`Publish failed: ${String(e)}`);
    } finally {
      setBusyId(null);
      setRevision((r) => r + 1);
    }
  };

  const republish = (service: PublishServiceRow) => {
    if (!st.selection.length) return;
    markToRepublish(service.row.id, st.selection);
    setRevision((r) => r + 1);
  };

  // Drag photos from the grid/filmstrip onto a service to add them (identical to
  // the Collections panel's drop targets).
  const dropProps = (id: number) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(PHOTO_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropId(id);
    },
    onDragLeave: () => setDropId((cur) => (cur === id ? null : cur)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropId(null);
      const ids = readPhotoDrag(e.dataTransfer);
      if (!ids.length) return;
      void store.addToCollection(id, ids).then(() => setRevision((r) => r + 1));
    },
  });

  if (creating) {
    return (
      <div className="gal-col-panel">
        <input
          className="gal-col-input"
          autoFocus
          placeholder="Publish service name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
            if (e.key === "Escape") setCreating(false);
          }}
        />
        <button
          className="gal-col-input"
          style={{ textAlign: "left" }}
          aria-label="Choose published folder"
          onClick={() => void pickFolder()}
        >
          {dir || "Choose published folder…"}
        </button>
        <Select
          block
          style={{ marginBottom: 6 }}
          aria-label="Published file format"
          value={format}
          options={[
            { value: "jpeg", label: "JPEG" },
            { value: "png", label: "PNG" },
          ]}
          onChange={(v) => setFormat(v === "png" ? "png" : "jpeg")}
        />
        <input
          className="gal-col-input"
          aria-label="Long edge in pixels (blank for full size)"
          placeholder="Long edge (px)"
          value={longEdge}
          onChange={(e) => setLongEdge(e.target.value.replace(/[^\d]/g, ""))}
        />
        <div className="gal-col-actions">
          <Button variant="primary" size="sm" disabled={!name.trim() || !dir} onClick={() => void create()}>
            Create
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="gal-col-panel">
      {services.length === 0 && (
        <div className="gal-col-match">No publish services yet.</div>
      )}
      {services.map((service) => {
        const { row } = service;
        const s = summaries[row.id];
        const pending = s ? s.new + s.modified + s.deleted : 0;
        return (
          <div key={row.id}>
            <div
              className={`gal-col-row${st.activeCollectionId === row.id ? " is-active" : ""}${dropId === row.id ? " is-drop" : ""}`}
              {...dropProps(row.id)}
            >
              <button
                className="gal-col-open"
                onClick={() => {
                  store.setModule("grid");
                  void store.setActiveCollection(row.id);
                }}
                title={service.config.dir}
              >
                <span className="gal-col-icon">⇪</span>
                <span className="gal-col-name">{row.name}</span>
                <span className="gal-col-count">{pending}</span>
              </button>
              <button
                className="gal-col-del"
                onClick={() => void removeService(service)}
                aria-label={`Delete publish service ${row.name}`}
                title="Delete publish service (published files stay on disk)"
              >
                ×
              </button>
            </div>
            <div className="gal-col-match">
              {s
                ? `${s.new} new · ${s.modified} modified · ${s.published} published · ${s.deleted} deleted`
                : "counting…"}
            </div>
            <div className="gal-col-actions">
              <Button
                variant="primary"
                size="sm"
                disabled={busyId != null || pending === 0}
                onClick={() => void publish(service)}
              >
                {busyId === row.id ? "Publishing…" : "Publish"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={st.selection.length === 0}
                onClick={() => republish(service)}
                title="Mark the selected photos to republish"
              >
                Mark to Republish
              </Button>
            </div>
          </div>
        );
      })}
      <div className="gal-col-new">
        <button onClick={() => setCreating(true)}>+ Hard Drive publisher…</button>
      </div>
    </div>
  );
}
