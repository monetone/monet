// MetadataPresets — LR's Edit Metadata Presets, Phase 4 DAM. A preset is a
// named set of IPTC fields plus a keyword list, each with its own checkbox:
// CHECKED with a value writes it, CHECKED and empty clears it, UNCHECKED leaves
// the photo's own value alone. Applying writes to the current selection (or the
// active photo). Presets are global (catalog `metadata_preset` table).
//
// Also home of Copy Metadata / Paste Metadata (LR: Metadata ▸ Copy/Paste
// Metadata): a field-checkbox dialog snapshots a chosen subset of the active
// photo's IPTC + keywords into a session clipboard; Paste overlays exactly
// those fields onto every target, preserving each target's untouched fields.

import { Button, Checkbox, Dialog, Input, Select } from "@monet-ui/monet-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import {
  addKeyword,
  catalogAvailable,
  deleteMetadataPreset,
  listMetadataPresets,
  listPhotoKeywords,
  replacePhotoKeywords,
} from "../catalog/catalog";
import type { MetadataPresetRow, PhotoMetadata, PhotoRow } from "../catalog/types";
import { store, useCatalog } from "../state/store";
// Type-only, so it is erased at build time and never closes the
// MetadataPanel→MetadataPresets import cycle.
import type { IptcKey } from "./MetadataPanel";

// ponytail: mirrors MetadataPanel's IPTC_FIELDS (not exported; a value import
// would close the MetadataPanel↔MetadataPresets cycle). MetadataPanel already
// imports this module, so the fix is to move ITS list down here — worth doing
// the next time either list changes.
/** Every IPTC field a preset or a copy can carry, in dialog order. A third
 *  slot starts a new section above the row. */
const IPTC_FIELDS: readonly (readonly [IptcKey, string, string?])[] = [
  ["title", "Title", "Content"],
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

/** IPTC's `xmpRights:Marked` states — "" is Unknown, matching the null column. */
const COPYRIGHT_STATUS_OPTIONS = [
  { value: "", label: "Unknown" },
  { value: "copyrighted", label: "Copyrighted" },
  { value: "publicDomain", label: "Public Domain" },
];

/** Everything a preset or the copy dialog can check: the IPTC columns plus the
 *  keyword set. */
export type MetadataCopyField = IptcKey | "keywords";
export const METADATA_COPY_FIELDS: readonly (readonly [MetadataCopyField, string, string?])[] = [
  ...IPTC_FIELDS,
  ["keywords", "Keywords", "Keywords"],
];

/** What a metadata preset writes. A key that is PRESENT is owned by the preset
 *  (an empty string clears it on the photo); an ABSENT key leaves the photo's
 *  own value alone — LR's per-field checkboxes, as one JSON object. */
export type MetadataPresetFields = Partial<Record<IptcKey, string>> & { keywords?: string[] };

/** A catalog row / photo row widened with the IPTC columns beyond the original
 *  ten. The native rows carry all of them; `catalog/types.ts` still names only
 *  the ten, so widen here (as MetadataPanel does) rather than lose the rest. */
type IptcPhoto = PhotoRow & Partial<Record<IptcKey, string | null>>;
type PresetRow = MetadataPresetRow & { fields?: MetadataPresetFields };

/** The field map a preset row carries. Empty (writes nothing) if the row came
 *  from somewhere that does not populate it. */
export const presetFields = (p: MetadataPresetRow): MetadataPresetFields =>
  (p as PresetRow).fields ?? {};

/** A photo's editable IPTC columns as a full metadata patch — the preserve
 *  baseline every overlay starts from, so a write never clears a field the
 *  caller did not name. */
const iptcOf = (p: IptcPhoto): PhotoMetadata =>
  Object.fromEntries(IPTC_FIELDS.map(([k]) => [k, p[k] ?? null])) as unknown as PhotoMetadata;

const withField = (
  f: MetadataPresetFields,
  k: MetadataCopyField,
  v: string | string[] | undefined,
): MetadataPresetFields => {
  const next: Record<string, unknown> = { ...f };
  if (v === undefined) delete next[k];
  else next[k] = v;
  return next as MetadataPresetFields;
};

/** Overlay `edits` onto every target, keeping each target's own value for every
 *  field the patch does not name. A named-but-empty value clears (a blank IS a
 *  value). Returns how many photos were written. */
async function overlayMetadata(
  ids: number[],
  edits: Partial<Record<IptcKey, string | null>>,
): Promise<number> {
  const keys = Object.keys(edits) as IptcKey[];
  if (keys.length === 0) return 0;
  const byId = new Map(store.getState().photos.map((p) => [p.id, p as IptcPhoto]));
  let n = 0;
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    const meta = iptcOf(p) as PhotoMetadata & Partial<Record<IptcKey, string | null>>;
    for (const k of keys) meta[k] = edits[k] || null;
    await store.setPhotoMetadata(id, meta);
    n++;
  }
  return n;
}

// ── Presets ──────────────────────────────────────────────────

/** Save a metadata preset (upsert by name); null if the name was blank. */
export function saveMetadataPreset(
  name: string,
  fields: MetadataPresetFields,
): Promise<number | null> {
  return invoke<number | null>("plugin:catalog|catalog_add_metadata_preset", { name, fields });
}

/** Apply a preset to every id: it writes exactly the fields it owns and leaves
 *  every other field per-photo. Keywords ADD to each photo's set (LR: a
 *  preset's keywords never replace what the photo already has). */
export async function applyMetadataPreset(preset: MetadataPresetRow, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const fields = presetFields(preset);
  const edits: Partial<Record<IptcKey, string | null>> = {};
  // Driven by the field list, so an unknown key in a hand-edited preset can
  // never reach the IPC command.
  for (const [k] of IPTC_FIELDS) if (fields[k] !== undefined) edits[k] = fields[k]!;

  // setPhotoMetadata reports its own failures onto store.error, so a bad write
  // surfaces without unwinding the rest of the selection.
  let n = await overlayMetadata(ids, edits);
  const keywords = fields.keywords ?? [];
  if (keywords.length) {
    for (const id of ids) {
      for (const kw of keywords) {
        try {
          await addKeyword(id, kw);
        } catch (e) {
          console.error("galerie metadata preset: keyword write failed", id, kw, e);
        }
      }
    }
    n = n || ids.length; // a keywords-only preset still touched every photo
  }
  if (n) store.notify(`Metadata preset applied to ${n} photo${n === 1 ? "" : "s"}.`);
  return n;
}

/** Seed a new preset from the active photo: every non-empty field checked.
 *  Title and caption stay unchecked — they describe one photo, not a studio. */
export function presetSeedFromPhoto(photo: PhotoRow): MetadataPresetFields {
  const p = photo as IptcPhoto;
  let out: MetadataPresetFields = {};
  for (const [k] of IPTC_FIELDS) {
    if (k === "title" || k === "caption") continue;
    const v = p[k];
    if (v) out = withField(out, k, v);
  }
  return out;
}

/** LR's Edit Metadata Presets dialog: name + a checkbox and a value per field. */
export function MetadataPresetDialog({
  seedName,
  seedFields,
  onClose,
  onSaved,
}: {
  seedName: string;
  seedFields: MetadataPresetFields;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(seedName);
  const [fields, setFields] = useState<MetadataPresetFields>(seedFields);

  const on = (k: MetadataCopyField) => fields[k] !== undefined;
  const toggle = (k: MetadataCopyField) =>
    setFields((f) => withField(f, k, on(k) ? undefined : k === "keywords" ? [] : ""));
  const setAll = (checked: boolean) =>
    setFields((f) => {
      if (!checked) return {};
      let next = f;
      for (const [k] of METADATA_COPY_FIELDS) if (next[k] === undefined) next = withField(next, k, k === "keywords" ? [] : "");
      return next;
    });

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      await saveMetadataPreset(n, fields);
      onSaved();
    } catch (e) {
      console.error("galerie metadata preset: save failed", e);
    }
    onClose();
  };

  const valueEditor = (k: MetadataCopyField) => {
    if (k === "keywords") {
      return (
        <Input
          size="sm"
          block
          disabled={!on(k)}
          aria-label="Keywords value"
          placeholder="comma, separated"
          value={(fields.keywords ?? []).join(", ")}
          onChange={(e) =>
            setFields((f) =>
              withField(f, k, e.target.value.split(",").map((s) => s.trim()).filter(Boolean)),
            )
          }
        />
      );
    }
    if (k === "copyrightStatus") {
      return (
        <Select
          size="sm"
          block
          disabled={!on(k)}
          aria-label="Copyright Status value"
          value={fields[k] ?? ""}
          options={COPYRIGHT_STATUS_OPTIONS}
          onChange={(v) => setFields((f) => withField(f, k, v))}
        />
      );
    }
    return (
      <Input
        size="sm"
        block
        disabled={!on(k)}
        aria-label={`${k} value`}
        placeholder="(clears the field)"
        value={fields[k] ?? ""}
        onChange={(e) => setFields((f) => withField(f, k, e.target.value))}
      />
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit Metadata Preset"
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="gal-copysettings">
        <Input
          size="sm"
          block
          autoFocus
          aria-label="Preset name"
          placeholder="Preset name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="gal-copysettings-all">
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>Check All</Button>
          <Button variant="ghost" size="sm" onClick={() => setAll(false)}>Check None</Button>
        </div>
        <div style={{ maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {METADATA_COPY_FIELDS.map(([k, label, section]) => (
            <div key={k}>
              {section && <div style={{ color: "var(--text-3)", fontSize: 11, margin: "6px 0 2px" }}>{section}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: "0 0 150px", minWidth: 0 }}>
                  <Checkbox checked={on(k)} onChange={() => toggle(k)}>{label}</Checkbox>
                </div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>{valueEditor(k)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

// ── Copy / Paste Metadata ────────────────────────────────────

// Session-scoped metadata clipboard (LR parity: not persisted, lost on quit).
let metadataClipboard: { meta: Partial<Record<IptcKey, string | null>>; keywords: string[] | null } | null =
  null;

/** Snapshot the chosen subset of one photo's IPTC + keywords for Paste. */
export async function copyMetadata(photoId: number, fields: ReadonlySet<MetadataCopyField>): Promise<void> {
  const src = store.getState().photos.find((p) => p.id === photoId) as IptcPhoto | undefined;
  if (!src || fields.size === 0) return;
  const meta: Partial<Record<IptcKey, string | null>> = {};
  for (const [k] of IPTC_FIELDS) if (fields.has(k)) meta[k] = src[k] ?? null;
  let keywords: string[] | null = null;
  if (fields.has("keywords")) {
    try {
      keywords = (await listPhotoKeywords(photoId)).map((k) => k.name);
    } catch (e) {
      console.error("galerie copy metadata: keyword read failed", e);
      keywords = [];
    }
  }
  metadataClipboard = { meta, keywords };
  store.notify(`Copied ${fields.size} metadata field${fields.size === 1 ? "" : "s"} — Paste Metadata to apply.`);
}

/** Overlay the copied fields onto every target photo. Fields that weren't
 *  copied keep each target's own values; copied-but-empty fields clear (LR
 *  paste semantics — the source's blank IS a value). */
export async function pasteMetadata(ids: number[]): Promise<void> {
  const clip = metadataClipboard;
  if (!clip) {
    store.notify("Copy metadata first (Library ▸ Copy Metadata…).");
    return;
  }
  const n = await overlayMetadata(ids, clip.meta);
  if (clip.keywords) {
    for (const id of ids) {
      try {
        // ponytail: replaces the target's keyword set wholesale (matches Read
        // Metadata from File); merge-on-paste if anyone asks. Keywords-only
        // paste doesn't queue an XMP sidecar write — setPhotoMetadata covers
        // that whenever IPTC fields ride along.
        await replacePhotoKeywords(id, clip.keywords);
      } catch (e) {
        console.error("galerie paste metadata: keyword write failed", id, e);
      }
    }
  }
  const touched = n || (clip.keywords ? ids.length : 0);
  store.notify(`Pasted metadata to ${touched} photo${touched === 1 ? "" : "s"}.`);
}

/** Copy Metadata's field-checkbox dialog (LR: Metadata ▸ Copy Metadata). */
// ponytail: the subset is chosen at Copy time only — Paste applies it as-is,
// no second dialog like LR's paste-side checkboxes; add one if partial paste
// of an existing clip is ever needed.
export function CopyMetadataDialog({ photoId, onClose }: { photoId: number; onClose: () => void }) {
  const [checked, setChecked] = useState<Set<MetadataCopyField>>(
    () => new Set(METADATA_COPY_FIELDS.map(([k]) => k)),
  );

  const toggle = (k: MetadataCopyField) =>
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const setAll = (on: boolean) =>
    setChecked(on ? new Set(METADATA_COPY_FIELDS.map(([k]) => k)) : new Set());

  return (
    <Dialog
      open
      onClose={onClose}
      title="Copy Metadata"
      width={300}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={checked.size === 0}
            onClick={() => {
              void copyMetadata(photoId, checked);
              onClose();
            }}
          >
            Copy
          </Button>
        </>
      }
    >
      <div className="gal-copysettings">
        <div className="gal-copysettings-all">
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>Check All</Button>
          <Button variant="ghost" size="sm" onClick={() => setAll(false)}>Check None</Button>
        </div>
        {METADATA_COPY_FIELDS.map(([k, label]) => (
          <Checkbox key={k} checked={checked.has(k)} onChange={() => toggle(k)}>
            {label}
          </Checkbox>
        ))}
      </div>
    </Dialog>
  );
}

export function MetadataPresets({ active }: { active: PhotoRow }) {
  const st = useCatalog();
  const [presets, setPresets] = useState<MetadataPresetRow[]>([]);
  const [sel, setSel] = useState<number | "">("");
  const [editing, setEditing] = useState<{ name: string; fields: MetadataPresetFields } | null>(null);

  const reload = () => {
    if (!catalogAvailable()) return;
    listMetadataPresets()
      .then(setPresets)
      .catch(() => setPresets([]));
  };
  useEffect(() => {
    reload();
  }, []);

  const apply = () => {
    const p = presets.find((x) => x.id === sel);
    if (!p) return;
    const ids = st.selection.length ? st.selection : [active.id];
    void applyMetadataPreset(p, ids);
  };

  const edit = () => {
    const p = presets.find((x) => x.id === sel);
    setEditing(
      p
        ? { name: p.name, fields: presetFields(p) }
        : { name: "", fields: presetSeedFromPhoto(active) },
    );
  };

  const remove = async () => {
    const p = presets.find((x) => x.id === sel);
    if (!p) return;
    try {
      await deleteMetadataPreset(p.id);
      setSel("");
      reload();
    } catch (e) {
      console.error("galerie metadata preset: delete failed", e);
    }
  };

  return (
    <div className="gal-meta-preset">
      <div className="gal-meta-preset-row">
        <Select
          size="sm"
          block
          value={String(sel)}
          aria-label="Metadata preset"
          options={[
            { value: "", label: "Preset…" },
            ...presets.map((p) => ({ value: String(p.id), label: p.name })),
          ]}
          onChange={(v) => setSel(v ? Number(v) : "")}
        />
        <Button variant="ghost" size="sm" disabled={sel === ""} onClick={apply}>
          Apply
        </Button>
        <Button variant="ghost" size="sm" disabled={sel === ""} onClick={() => void remove()} aria-label="Delete preset">
          ×
        </Button>
      </div>
      <Button variant="ghost" size="sm" onClick={edit}>
        {sel === "" ? "+ New preset…" : "Edit preset…"}
      </Button>
      {editing && (
        <MetadataPresetDialog
          seedName={editing.name}
          seedFields={editing.fields}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
