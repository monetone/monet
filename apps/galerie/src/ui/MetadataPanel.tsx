// MetadataPanel — the right-rail Metadata/Keywords panel for the active photo
// (Phase 4 DAM). Read-only EXIF (normalized catalog columns, formatted via
// metadataRows), LR's editable IPTC view — content, creator + contact block,
// location cluster and rights block, persisted on blur — and the KeywordsBar.
// The IPTC editors follow LR's multi-select behavior: with N photos selected,
// differing fields show `<mixed>` and typing a value writes it to all N; Sync
// Metadata pushes the active photo's fields to the rest of the selection.

import { Button, Input, Select, Textarea } from "@monet-ui/monet-react";
import { Fragment, useState } from "react";

import { addSnapshot, listSnapshots, replacePhotoKeywords } from "../catalog/catalog";
import type { PhotoMetadata, PhotoRow } from "../catalog/types";
import type { XmpSnapshot } from "@monet-ui/monet-photo";
import { readSidecarDocument } from "../import";
import { mergeRecipePatch } from "../lib/recipePatch";
import { recordMetadataRead, writeSidecarForPhoto } from "../lib/xmpAutoWrite";
import { sidecarMetadataPatch } from "../lib/xmpSidecar";
import { store, useCatalog } from "../state/store";
import { KeywordsBar } from "./KeywordsBar";
import { metadataStatusBadge } from "./photoBadges";
import { useMetadataStatus } from "./useMetadataStatus";
import {
  METADATA_VIEWS,
  type MetadataViewName,
  filterMetadataRows,
  loadMetadataView,
  saveMetadataView,
} from "../lib/metadataViews";
import { metadataRows } from "./MetadataOverlay";
import { MetadataPresets } from "./MetadataPresets";

/** Save Metadata to File: write an .xmp sidecar (IPTC + develop) beside each
 *  selected photo's source. Operates on the selection, or the active photo. */
async function saveMetadataToFiles(activeId: number): Promise<void> {
  const s = store.getState();
  const ids = s.selection.length ? s.selection : [activeId];
  let ok = 0;
  for (const id of ids) {
    const row = s.photos.find((p) => p.id === id);
    if (!row) continue;
    try {
      await writeSidecarForPhoto(row);
      ok++;
    } catch (e) {
      console.error("galerie save metadata to file failed", id, e);
    }
  }
  store.notify(`Saved metadata to ${ok} sidecar${ok === 1 ? "" : "s"}.`);
}

/** Read Metadata from File: apply each selected photo's .xmp sidecar (IPTC +
 *  rating/label + keywords + the develop block) back into the catalog. The
 *  develop patch is deep-merged onto the photo's current recipe (mergeRecipePatch)
 *  so masks/crop and any field the sidecar doesn't mention survive; each read
 *  lands a History step. A missing/malformed sidecar is skipped, never an error. */
export async function readMetadataFromFiles(activeId: number): Promise<void> {
  const s = store.getState();
  const ids = s.selection.length ? s.selection : [activeId];
  let applied = 0;
  for (const id of ids) {
    const row = s.photos.find((p) => p.id === id);
    if (!row) continue;
    const doc = await readSidecarDocument(row.path);
    if (!doc) continue; // no sidecar beside this source
    const m = doc.metadata;
    try {
      // LR parity: the file's IPTC replaces the catalog's — omitted fields clear.
      await store.setPhotoMetadata(id, sidecarMetadataPatch(m));
      if (m.rating != null || m.label != null) {
        await store.cull(id, m.rating ?? row.rating, row.flag, m.label ?? row.colorLabel);
      }
      await replacePhotoKeywords(id, m.keywords ?? []);
      if (doc.recipe) {
        await store.applyQuickDevelop([id], (r) => mergeRecipePatch(r, doc.recipe!));
      }
      await restoreSnapshots(id, doc.snapshots);
      // Catalog now mirrors the file — baseline the sync from the POST-apply row.
      const fresh = store.getState().photos.find((p) => p.id === id);
      if (fresh) await recordMetadataRead(fresh);
      applied++;
    } catch (e) {
      console.error("galerie read metadata from file failed", id, e);
    }
  }
  store.notify(applied ? `Read metadata from ${applied} sidecar${applied === 1 ? "" : "s"}.` : "No .xmp sidecar found.");
}

/** Restore the sidecar's named develop snapshots into the catalog. Matched by
 *  name: an existing snapshot keeps the catalog's version rather than being
 *  duplicated or silently overwritten, so re-reading a sidecar is idempotent.
 *  Best-effort — a snapshot that won't store must not abort the metadata read. */
async function restoreSnapshots(photoId: number, snapshots: XmpSnapshot[]): Promise<void> {
  if (!snapshots.length) return;
  try {
    const have = new Set((await listSnapshots(photoId)).map((s) => s.name));
    for (const snap of snapshots) {
      if (!snap.recipe || have.has(snap.name)) continue;
      await addSnapshot(photoId, snap.name, JSON.stringify(snap.recipe));
    }
  } catch (e) {
    console.error("galerie restore sidecar snapshots failed", photoId, e);
  }
}

/** Every editable IPTC column the catalog carries — LR's Metadata ▸ IPTC view.
 *  Mirrors `PhotoIptc` in src-tauri/src/catalog.rs; the IPC command spreads
 *  this set flat. */
export type IptcKey =
  | "title"
  | "caption"
  | "headline"
  | "instructions"
  | "creator"
  | "jobTitle"
  | "credit"
  | "source"
  | "creatorAddress"
  | "creatorCity"
  | "creatorStateProvince"
  | "creatorPostalCode"
  | "creatorCountry"
  | "creatorPhone"
  | "creatorEmail"
  | "creatorWebsite"
  | "sublocation"
  | "city"
  | "stateProvince"
  | "country"
  | "isoCountryCode"
  | "copyright"
  | "copyrightStatus"
  | "rightsUsageTerms"
  | "copyrightInfoUrl";

/** A catalog row / metadata patch widened with the IPTC columns beyond the
 *  original ten. The native row and the IPC command already carry all of them;
 *  `catalog/types.ts` still only names the ten, so widen here rather than let
 *  the panel lose the fields. */
type IptcPhoto = PhotoRow & Partial<Record<IptcKey, string | null>>;
type IptcPatch = PhotoMetadata & Partial<Record<IptcKey, string | null>>;

/** The fields in panel order. A third slot starts a new section above the row;
 *  Caption renders as a textarea, Copyright Status as a closed vocabulary. */
const IPTC_FIELDS: readonly (readonly [IptcKey, string, string?])[] = [
  ["title", "Title"],
  ["caption", "Caption"],
  ["headline", "Headline"],
  ["instructions", "Instructions"],
  ["creator", "Creator", "Creator"],
  ["jobTitle", "Job Title"],
  ["credit", "Credit"],
  ["source", "Source"],
  ["creatorAddress", "Address", "Creator Contact"],
  ["creatorCity", "City"],
  ["creatorStateProvince", "State / Province"],
  ["creatorPostalCode", "Postal Code"],
  ["creatorCountry", "Country"],
  ["creatorPhone", "Phone"],
  ["creatorEmail", "Email"],
  ["creatorWebsite", "Website"],
  ["sublocation", "Sublocation", "Location"],
  ["city", "City"],
  ["stateProvince", "State / Province"],
  ["country", "Country"],
  ["isoCountryCode", "ISO Country Code"],
  ["copyright", "Copyright", "Rights"],
  ["copyrightStatus", "Copyright Status"],
  ["rightsUsageTerms", "Rights Usage Terms"],
  ["copyrightInfoUrl", "Copyright Info URL"],
];

/** IPTC's `xmpRights:Marked` states. "" = Unknown, matching the null column. */
const COPYRIGHT_STATUS_OPTIONS = [
  { value: "", label: "Unknown" },
  { value: "copyrighted", label: "Copyrighted" },
  { value: "publicDomain", label: "Public Domain" },
];

/** A photo's editable IPTC columns as a metadata patch. Driven by IPTC_FIELDS
 *  so a new field never has to be remembered here too. */
const iptcOf = (p: IptcPhoto): IptcPatch =>
  Object.fromEntries(IPTC_FIELDS.map(([k]) => [k, p[k] ?? null])) as unknown as IptcPatch;

/** IPTC keys whose values differ across the given photos (LR's `<mixed>` set). */
export function mixedIptcKeys(photos: IptcPhoto[]): Set<IptcKey> {
  const out = new Set<IptcKey>();
  for (const [k] of IPTC_FIELDS)
    if (photos.some((p) => (p[k] ?? null) !== (photos[0][k] ?? null))) out.add(k);
  return out;
}

/** Write the edited fields to every target photo, preserving each photo's own
 *  values for the untouched fields (LR: typing with N selected edits all N). */
export async function commitIptcEdits(
  photos: IptcPhoto[],
  edits: Partial<Record<IptcKey, string>>,
): Promise<void> {
  const keys = Object.keys(edits) as IptcKey[];
  if (keys.length === 0) return;
  for (const p of photos) {
    const meta = iptcOf(p);
    for (const k of keys) meta[k] = edits[k]! || null;
    await store.setPhotoMetadata(p.id, meta);
  }
}

/** Sync Metadata: push the active photo's IPTC fields to the rest of the
 *  selection (LR: Metadata ▸ Sync Metadata). */
// ponytail: syncs every IPTC field wholesale — no per-field checkbox dialog
// like LR's; add the dialog if partial sync is ever needed. GPS and keywords
// stay per-photo.
export async function syncMetadata(activeId: number): Promise<void> {
  const s = store.getState();
  const src = s.photos.find((p) => p.id === activeId);
  const ids = s.selection.filter((id) => id !== activeId);
  if (!src || ids.length === 0) {
    store.notify("Select multiple photos to sync metadata.");
    return;
  }
  const meta = iptcOf(src);
  for (const id of ids) await store.setPhotoMetadata(id, meta);
  store.notify(`Synced metadata to ${ids.length} photo${ids.length === 1 ? "" : "s"}.`);
}

// Keyed by target ids so a selection change remounts with fresh seed values.
// Fields where the selection disagrees seed empty and show `<mixed>` until
// typed into; blur commits only the touched fields, to every target.
// ponytail: Copyright Status seeds Unknown on a mixed selection rather than
// showing `<mixed>` — a listbox has no placeholder once a value matches an
// option. Nothing is written until it is picked, so no photo is clobbered.
export function IptcFields({ photos }: { photos: IptcPhoto[] }) {
  const [draft, setDraft] = useState<Record<IptcKey, string>>(() => {
    const mixedNow = mixedIptcKeys(photos);
    const d = {} as Record<IptcKey, string>;
    for (const [k] of IPTC_FIELDS) d[k] = mixedNow.has(k) ? "" : (photos[0][k] ?? "");
    return d;
  });
  const [dirty, setDirty] = useState<ReadonlySet<IptcKey>>(new Set());
  const mixed = mixedIptcKeys(photos); // derived from props, stays live post-commit

  const edit = (k: IptcKey, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty((s) => new Set(s).add(k));
  };
  const commit = () => {
    if (dirty.size === 0) return;
    const edits: Partial<Record<IptcKey, string>> = {};
    for (const k of dirty) edits[k] = draft[k];
    setDirty(new Set());
    void commitIptcEdits(photos, edits);
  };
  // A listbox has no blur to commit on — pick writes straight through.
  const pick = (k: IptcKey, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty((s) => {
      const next = new Set(s);
      next.delete(k);
      return next;
    });
    void commitIptcEdits(photos, { [k]: v });
  };

  return (
    <div className="gal-meta-edit">
      {IPTC_FIELDS.map(([k, label, section]) => {
        const shared = {
          value: draft[k],
          placeholder: mixed.has(k) && !dirty.has(k) ? "<mixed>" : undefined,
          onBlur: commit,
        };
        return (
          <Fragment key={k}>
            {section ? <div className="gal-meta-sec">{section}</div> : null}
            {k === "copyrightStatus" ? (
              <div className="gal-meta-field">
                <span>{label}</span>
                <Select
                  block
                  size="sm"
                  aria-label={label}
                  options={COPYRIGHT_STATUS_OPTIONS}
                  value={draft[k]}
                  onChange={(v) => pick(k, v)}
                />
              </div>
            ) : (
              <label className="gal-meta-field">
                <span>{label}</span>
                {k === "caption" ? (
                  <Textarea block rows={2} {...shared} onChange={(e) => edit(k, e.target.value)} />
                ) : (
                  <Input block {...shared} onChange={(e) => edit(k, e.target.value)} />
                )}
              </label>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** LR's Copy Name field, shown only on a virtual copy: rename it to "B&W" or
 *  "Crop for IG" instead of living with "Copy 1", and promote it to master.
 *  Blank clears the name back to absent, matching the catalog write. */
function CopyNameField({ photo }: { photo: PhotoRow }) {
  const [text, setText] = useState(photo.copyName ?? "");
  const commit = () => {
    if ((text.trim() || null) !== (photo.copyName ?? null)) void store.setCopyName(photo.id, text);
  };
  return (
    <div className="gal-meta-edit">
      <label className="gal-meta-field">
        <span>Copy Name</span>
        <Input
          block
          placeholder="Copy name"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
        />
      </label>
      <Button
        variant="ghost"
        size="sm"
        block
        title="Promote this virtual copy to the master photo; the current master becomes a copy"
        onClick={() => void store.makeMasterPhoto(photo.id)}
      >
        Make Master Photo
      </Button>
    </div>
  );
}

/** LR's editable GPS field: one "lat, lon" box plus Delete GPS Location.
 *  Unparseable or out-of-range input snaps back to the stored value rather than
 *  writing garbage (the native command rejects it too). Keyed by photo. */
function GpsField({ photo }: { photo: PhotoRow }) {
  const seed = photo.gpsLat != null && photo.gpsLon != null ? `${photo.gpsLat}, ${photo.gpsLon}` : "";
  const [text, setText] = useState(seed);

  const commit = () => {
    const t = text.trim();
    if (!t) {
      if (photo.gpsLat != null || photo.gpsLon != null) void store.setGps(photo.id, null, null);
      return;
    }
    const [lat, lon] = t.split(/[,\s]+/).map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      setText(seed);
      return;
    }
    if (lat !== photo.gpsLat || lon !== photo.gpsLon) void store.setGps(photo.id, lat, lon);
  };

  return (
    <div className="gal-meta-edit">
      <label className="gal-meta-field">
        <span>GPS</span>
        <Input
          block
          placeholder="lat, lon"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
        />
      </label>
      <Button
        variant="ghost"
        size="sm"
        block
        disabled={photo.gpsLat == null && photo.gpsLon == null}
        title="Clear this photo's GPS coordinate"
        onClick={() => {
          setText("");
          void store.setGps(photo.id, null, null);
        }}
      >
        Delete GPS Location
      </Button>
    </div>
  );
}

/** LR's metadata-status resolve row: names how catalog and sidecar diverged
 *  and which button below resolves it (Read = Import Settings from Disk,
 *  Save = Overwrite Settings). Hidden while synced / never synced. */
function MetadataStatusRow({ photo }: { photo: PhotoRow }) {
  const status = useMetadataStatus(photo);
  const badge = metadataStatusBadge(status);
  if (!badge) return null;
  const hint =
    status === "catalogNewer"
      ? "Save Metadata to File to update the sidecar."
      : status === "fileNewer"
        ? "Read Metadata from File to import the external change."
        : "Read imports the file's settings; Save overwrites them.";
  return (
    <div className="gal-meta-status" role="status">
      {badge.glyph} {badge.label}. {hint}
    </div>
  );
}

export function MetadataPanel() {
  const st = useCatalog();
  const [view, setView] = useState<MetadataViewName>(() => loadMetadataView());
  const active = st.activeId != null ? st.photos.find((p) => p.id === st.activeId) : undefined;

  if (!active) {
    return <div className="gal-meta-empty">No photo selected</div>;
  }

  // The IPTC editors target the whole (loaded) selection, or the active photo.
  const selected = st.photos.filter((p) => st.selection.includes(p.id));
  const targets = selected.length ? selected : [active];
  const rows = filterMetadataRows(metadataRows(active), view).filter(([, v]) => v != null);
  return (
    <div className="gal-meta">
      <Select
        className="gal-meta-view"
        block
        size="sm"
        title="Metadata view — which fields the panel shows"
        value={view}
        options={Object.keys(METADATA_VIEWS).map((n) => ({ value: n }))}
        onChange={(v) => {
          setView(v);
          saveMetadataView(v);
        }}
      />
      <dl className="gal-meta-list">
        {rows.map(([k, v]) => (
          <div key={k} className="gal-meta-row">
            <dt className="gal-meta-k">{k}</dt>
            <dd className="gal-meta-v">{v}</dd>
          </div>
        ))}
      </dl>

      {st.available ? (
        <>
          {active.isVirtualCopy ? (
            <>
              <div className="gal-meta-sec">Copy</div>
              <CopyNameField key={`copy:${active.id}:${active.copyName ?? ""}`} photo={active} />
            </>
          ) : null}
          <div className="gal-meta-sec">IPTC</div>
          <IptcFields
            key={`${targets.map((p) => p.id).join(",")}:${active.title ?? ""}:${active.caption ?? ""}:${active.creator ?? ""}:${active.copyright ?? ""}`}
            photos={targets}
          />
          <GpsField key={`gps:${active.id}:${active.gpsLat ?? ""}:${active.gpsLon ?? ""}`} photo={active} />
          <MetadataPresets active={active} />
          <div className="gal-meta-sidecar">
            <MetadataStatusRow photo={active} />
            <Button
              variant="ghost"
              size="sm"
              block
              title="Write an .xmp sidecar (IPTC + develop settings) beside the source file"
              onClick={() => void saveMetadataToFiles(active.id)}
            >
              Save Metadata to File
            </Button>
            <Button
              variant="ghost"
              size="sm"
              block
              title="Read an .xmp sidecar beside the source and apply its IPTC + keywords"
              onClick={() => void readMetadataFromFiles(active.id)}
            >
              Read Metadata from File
            </Button>
            <Button
              variant="ghost"
              size="sm"
              block
              disabled={st.selection.length < 2}
              title="Push the active photo's IPTC fields to the rest of the selection"
              onClick={() => void syncMetadata(active.id)}
            >
              Sync Metadata
            </Button>
          </div>
          <div className="gal-meta-sec">Keywords</div>
          <KeywordsBar photoId={active.id} />
        </>
      ) : (
        <div className="gal-meta-empty">Editing needs the native catalog.</div>
      )}
    </div>
  );
}
