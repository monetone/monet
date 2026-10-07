// ImportDialog — the Library Import modal. Pick files or a whole source folder
// (with Include Subfolders, like LR's Source panel), review the candidates in a
// per-file thumbnail grid with include checkboxes (Check All / Uncheck All),
// choose Add (reference in place), Copy (into a destination folder, optionally
// date-organized, renamed and backed up by a second copy) or Move (the same
// copy, then the source is deleted once it landed), then
// apply keywords, a metadata preset, a develop preset and a collection to
// everything imported. The whole choice set saves as a named Import Preset
// (lib/importPresets, like the Export dialog's). Built on the shared
// @monet-ui/monet-react Dialog + controls; the copy/rename planning is the pure
// lib/importPlan, the file I/O + catalog insert are import.ts.

import { Button, Checkbox, Dialog, Field, Input, NumberField, Select } from "@monet-ui/monet-react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";

import { listCollections, listMetadataPresets, listPresets } from "../catalog/catalog";
import type { CollectionRow, MetadataPresetRow, PresetRow } from "../catalog/types";
import {
  embeddedPreviewUrl,
  IMPORT_EXTENSIONS,
  importWithOptions,
  isRawPath,
  listImportableFiles,
  type PreviewTier,
} from "../import";
import { generateThumbnail, ThumbnailCache } from "../lib/thumbnails";
import type { ImportHandling } from "../lib/importPlan";
import {
  DEFAULT_IMPORT_CONFIG,
  deleteImportPreset,
  listImportPresets,
  saveImportPreset,
  type ImportConfig,
  type ImportPreset,
} from "../lib/importPresets";

// ponytail: LR's fourth mode, "Copy as DNG", is missing on purpose — it needs a
// mosaic raw-container writer that does not exist yet (see export.ts's
// ExportFormat note); the linear-DNG writer bakes a developed sRGB image and
// would silently throw away the raw latitude the mode exists to preserve.
const HANDLING_OPTS = [
  { value: "add", label: "Add (reference in place)" },
  { value: "copy", label: "Copy to folder" },
  { value: "move", label: "Move to folder" },
];

/** LR's Build Previews ladder (import.ts PreviewTier). */
const PREVIEW_TIER_OPTS = [
  { value: "none", label: "None (fastest import)" },
  { value: "minimal", label: "Minimal (grid thumbnails)" },
  { value: "standard", label: "Standard (2560px)" },
  { value: "oneToOne", label: "1:1 (full resolution)" },
];

/** Import presets persist the tier alongside the legacy boolean.
 *  ponytail: the field's proper home is ImportConfig (lib/importPresets, other
 *  workstream); importConfigFrom round-trips unknown keys, so it survives. */
type StoredImportConfig = ImportConfig & { previewTier?: PreviewTier };

const baseName = (p: string): string => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);

/** A row id that no longer exists in this catalog resolves to "none". */
const pickId = (id: number | null, rows: { id: number }[]): number | "" =>
  id != null && rows.some((r) => r.id === id) ? id : "";

const THUMB_EDGE = 96;
/** Review-grid thumbs by source path, LRU'd across dialog opens (revokes on
 *  eviction) — re-opening Import on the same card doesn't re-decode. */
const reviewThumbs = new ThumbnailCache<string>(512);
// ponytail: one decode at a time keeps the dialog responsive; a small pool if
// big cards feel slow. Unmounted rows bail before decoding, so the chain drains.
let thumbChain: Promise<void> = Promise.resolve();
const enqueueThumb = (job: () => Promise<void>): void => {
  thumbChain = thumbChain.then(job, job);
};

/** Lazy thumbnail for a not-yet-imported source file. A file that fails to
 *  decode just shows an empty tile — the checkbox row still works, and the
 *  real import surfaces the failure. */
function FileThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(() => reviewThumbs.get(path) ?? null);
  useEffect(() => {
    if (url != null) return;
    let alive = true;
    enqueueThumb(async () => {
      if (!alive) return;
      const cached = reviewThumbs.get(path);
      if (cached != null) {
        setUrl(cached);
        return;
      }
      try {
        const raw = isRawPath(path);
        if (raw && isTauri()) {
          // LR's Embedded tier: the camera's own JPEG makes a card of RAWs
          // reviewable in seconds — no demosaic. Null (no embedded preview)
          // continues into the real decode below.
          const fast = await embeddedPreviewUrl(path, THUMB_EDGE);
          if (fast) {
            reviewThumbs.set(path, fast);
            if (alive) setUrl(fast);
            return;
          }
        }
        // Native RAW decode reads the path itself; only encoded formats need bytes.
        const bytes = raw && isTauri() ? new Uint8Array() : await readFile(path);
        const t = await generateThumbnail(bytes, raw, THUMB_EDGE, path);
        reviewThumbs.set(path, t.url);
        if (alive) setUrl(t.url);
      } catch {
        // No thumb; keep the empty tile.
      }
    });
    return () => {
      alive = false;
    };
  }, [path, url]);
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-2, #2b2b2f)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      {url && <img src={url} alt="" style={{ maxWidth: "100%", maxHeight: "100%" }} />}
    </div>
  );
}

export function ImportDialog({
  onClose,
  initialPaths,
}: {
  onClose: () => void;
  /** Pre-seeded files (Synchronize Folders routes its finds through here). */
  initialPaths?: string[];
}) {
  const d = DEFAULT_IMPORT_CONFIG;
  const [paths, setPaths] = useState<string[]>(initialPaths ?? []);
  /** Folder the candidate list came from (null = hand-picked files). */
  const [sourceDir, setSourceDir] = useState<string | null>(null);
  const [includeSub, setIncludeSub] = useState(true);
  /** Unchecked candidates — reset whenever the candidate list changes. */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [handling, setHandling] = useState<ImportHandling>(d.handling);
  const [destDir, setDestDir] = useState<string | null>(d.destDir);
  const [organizeByDate, setOrganizeByDate] = useState(d.organizeByDate);
  const [secondCopyDir, setSecondCopyDir] = useState<string | null>(d.secondCopyDir);
  const [rename, setRename] = useState(d.rename);
  const [skipDupes, setSkipDupes] = useState(d.skipDupes);
  const [template, setTemplate] = useState(d.template);
  const [startNumber, setStartNumber] = useState(d.startNumber);
  const [keywords, setKeywords] = useState(d.keywords);
  const [previewTier, setPreviewTier] = useState<PreviewTier>(d.buildPreviews ? "standard" : "none");
  const [metaPresets, setMetaPresets] = useState<MetadataPresetRow[]>([]);
  const [metaPresetId, setMetaPresetId] = useState<number | "">("");
  const [devPresets, setDevPresets] = useState<PresetRow[]>([]);
  const [devPresetId, setDevPresetId] = useState<number | "">("");
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [collectionId, setCollectionId] = useState<number | "">("");
  const [presets, setPresets] = useState<ImportPreset[]>(() => listImportPresets());
  const [selPreset, setSelPreset] = useState("");
  const [presetName, setPresetName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    listMetadataPresets().then(setMetaPresets).catch(() => setMetaPresets([]));
    listPresets().then(setDevPresets).catch(() => setDevPresets([]));
    // Only manual collections can take an import: sets are containers and smart
    // collections own their membership through their rule.
    listCollections()
      .then((rows) => setCollections(rows.filter((c) => c.kind === "collection")))
      .catch(() => setCollections([]));
  }, []);

  // Gather / restore every dialog choice for save/load. Kept beside the state so
  // a new option is a one-line addition in both directions.
  const currentConfig = (): StoredImportConfig => ({
    handling, destDir, organizeByDate, secondCopyDir, rename, template, startNumber,
    skipDupes, keywords, buildPreviews: previewTier === "standard", previewTier,
    metadataPresetId: metaPresetId === "" ? null : metaPresetId,
    developPresetId: devPresetId === "" ? null : devPresetId,
    collectionId: collectionId === "" ? null : collectionId,
  });
  const applyConfig = (c: ImportConfig): void => {
    setHandling(c.handling); setDestDir(c.destDir); setOrganizeByDate(c.organizeByDate);
    setSecondCopyDir(c.secondCopyDir); setRename(c.rename); setTemplate(c.template);
    setStartNumber(c.startNumber); setSkipDupes(c.skipDupes); setKeywords(c.keywords);
    // Pre-tier presets only stored the boolean — map it onto the ladder.
    setPreviewTier((c as StoredImportConfig).previewTier ?? (c.buildPreviews ? "standard" : "none"));
    setMetaPresetId(pickId(c.metadataPresetId, metaPresets));
    setDevPresetId(pickId(c.developPresetId, devPresets));
    setCollectionId(pickId(c.collectionId, collections));
  };

  const setCandidates = (files: string[], dir: string | null) => {
    setSourceDir(dir);
    setPaths(files);
    setExcluded(new Set());
    setMsg(dir != null && files.length === 0 ? "No importable photos in that folder." : null);
  };

  const pickFiles = async () => {
    const sel = await open({
      multiple: true,
      directory: false,
      title: "Import Photos",
      filters: [{ name: "Photos", extensions: IMPORT_EXTENSIONS }],
    });
    if (sel != null) setCandidates(Array.isArray(sel) ? sel : [sel], null);
  };

  /** LR's Source panel, the lazy way: the native folder picker + a tree scan. */
  const pickSourceFolder = async () => {
    const dir = await open({ directory: true, multiple: false, title: "Import from Folder" });
    if (typeof dir === "string") setCandidates(await listImportableFiles(dir, includeSub), dir);
  };

  const rescanSubfolders = async (recurse: boolean) => {
    setIncludeSub(recurse);
    if (sourceDir != null) setCandidates(await listImportableFiles(sourceDir, recurse), sourceDir);
  };

  const setChecked = (path: string, on: boolean) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (on) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const pickFolder = async (title: string, set: (dir: string) => void) => {
    const dir = await open({ directory: true, multiple: false, title });
    if (typeof dir === "string") set(dir);
  };

  const checked = paths.filter((p) => !excluded.has(p));

  const doImport = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const count = await importWithOptions(
        checked,
        { handling, destDir, rename, template, startNumber, organizeByDate, secondCopyDir },
        {
          keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
          metadataPreset: metaPresets.find((p) => p.id === metaPresetId) ?? null,
          developPreset: devPresets.find((p) => p.id === devPresetId) ?? null,
          collectionId: collectionId === "" ? null : collectionId,
          previewTier,
        },
        { skipDuplicates: skipDupes },
      );
      if (count > 0) onClose();
      else setMsg("Nothing imported — all files were skipped.");
    } catch (e) {
      setMsg(`Import failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const copy = handling === "copy";
  /** Copy and Move share every destination control except the second copy. */
  const relocates = handling !== "add";
  const canImport = checked.length > 0 && !busy && (!relocates || destDir != null);
  const presetOpts = [{ value: "", label: "Custom…" }, ...presets.map((p) => ({ value: p.name, label: p.name }))];
  const rowOpts = (rows: { id: number; name: string }[]) => [
    { value: "", label: "None" },
    ...rows.map((r) => ({ value: String(r.id), label: r.name })),
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title="Import Photos"
      width={460}
      footer={
        <>
          {msg && <span className="gal-modal-msg">{msg}</span>}
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!canImport} onClick={() => void doImport()}>
            {busy ? "Importing…" : `Import ${checked.length || ""}`}
          </Button>
        </>
      }
    >
      <div className="gal-export-body">
        <Field label="Preset">
          {(p) => (
            <div className="gal-export-inline">
              <Select
                {...p}
                block
                options={presetOpts}
                value={selPreset}
                onChange={(name) => {
                  setSelPreset(name);
                  const pr = presets.find((x) => x.name === name);
                  if (pr) applyConfig(pr.config);
                }}
              />
              {selPreset && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Delete preset"
                  onClick={() => {
                    setPresets(deleteImportPreset(selPreset));
                    setSelPreset("");
                  }}
                >
                  ×
                </Button>
              )}
            </div>
          )}
        </Field>

        <Field label="Save Preset">
          {(p) => (
            <div className="gal-export-inline">
              <Input {...p} block value={presetName} placeholder="Preset name" onChange={(e) => setPresetName(e.target.value)} />
              <Button
                size="sm"
                disabled={!presetName.trim()}
                onClick={() => {
                  setPresets(saveImportPreset(presetName, currentConfig()));
                  setSelPreset(presetName.trim());
                  setPresetName("");
                }}
              >
                Save
              </Button>
            </div>
          )}
        </Field>

        <Field label="Source">
          {() => (
            <div className="gal-export-inline">
              <Button variant="ghost" size="sm" onClick={() => void pickFiles()}>Choose Files…</Button>
              <Button variant="ghost" size="sm" onClick={() => void pickSourceFolder()}>Choose Folder…</Button>
              <span className="gal-import-count">
                {sourceDir != null ? baseName(sourceDir) : paths.length ? "Files" : "None"}
              </span>
            </div>
          )}
        </Field>
        {sourceDir != null && (
          <Checkbox checked={includeSub} onChange={(v) => void rescanSubfolders(v)}>
            Include subfolders
          </Checkbox>
        )}

        {paths.length > 0 && (
          <Field label="Review">
            {() => (
              <div>
                <div className="gal-export-inline" style={{ marginBottom: 6 }}>
                  <Button variant="ghost" size="sm" disabled={excluded.size === 0} onClick={() => setExcluded(new Set())}>
                    Check All
                  </Button>
                  <Button variant="ghost" size="sm" disabled={checked.length === 0} onClick={() => setExcluded(new Set(paths))}>
                    Uncheck All
                  </Button>
                  <span className="gal-import-count">{checked.length} of {paths.length} will import</span>
                </div>
                <div
                  style={{
                    maxHeight: 250,
                    overflowY: "auto",
                    display: "grid",
                    gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_EDGE}px, 1fr))`,
                    gap: 6,
                  }}
                >
                  {paths.map((p) => (
                    <div key={p} title={p} style={{ minWidth: 0 }}>
                      <FileThumb path={p} />
                      <Checkbox checked={!excluded.has(p)} onChange={(v) => setChecked(p, v)}>
                        <span style={{ display: "inline-block", maxWidth: 72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
                          {baseName(p)}
                        </span>
                      </Checkbox>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Field>
        )}

        <Field label="Handling">
          {(p) => (
            <Select {...p} block options={HANDLING_OPTS} value={handling} onChange={(v) => setHandling(v as ImportHandling)} />
          )}
        </Field>

        {relocates && (
          <Field
            label="Destination"
            hint={handling === "move" ? "Originals are deleted once they copy successfully" : undefined}
          >
            {() => (
              <div className="gal-export-inline">
                <Button variant="ghost" size="sm" onClick={() => void pickFolder("Copy Into Folder", setDestDir)}>
                  Choose Folder…
                </Button>
                <span className="gal-import-count">{destDir ?? "None"}</span>
              </div>
            )}
          </Field>
        )}
        {relocates && (
          <Checkbox checked={organizeByDate} onChange={setOrganizeByDate}>
            Organize into dated subfolders (YYYY/YYYY-MM-DD)
          </Checkbox>
        )}
        {copy && (
          <Field label="Second copy" hint="Untouched backup of every original">
            {() => (
              <div className="gal-export-inline">
                <Button variant="ghost" size="sm" onClick={() => void pickFolder("Make a Second Copy To", setSecondCopyDir)}>
                  Choose Folder…
                </Button>
                <span className="gal-import-count">{secondCopyDir ?? "None"}</span>
                {secondCopyDir && (
                  <Button variant="ghost" size="sm" title="No second copy" onClick={() => setSecondCopyDir(null)}>×</Button>
                )}
              </div>
            )}
          </Field>
        )}

        <Checkbox checked={skipDupes} onChange={setSkipDupes}>
          Don't import suspected duplicates
        </Checkbox>
        {relocates && (
          <Checkbox checked={rename} onChange={setRename}>
            {copy ? "Rename copied files" : "Rename moved files"}
          </Checkbox>
        )}
        {relocates && rename && (
          <>
            <Field label="Template" hint="Tokens: {name} {sequence} {sequence:3}">
              {(p) => <Input {...p} block value={template} onChange={(e) => setTemplate(e.target.value)} />}
            </Field>
            <Field label="Start #">
              {(p) => <NumberField {...p} min={0} step={1} value={startNumber} onChange={(v) => setStartNumber(Math.max(0, Math.floor(v)))} />}
            </Field>
          </>
        )}

        <Field label="Metadata preset">
          {(p) => (
            <Select
              {...p}
              block
              value={String(metaPresetId)}
              options={rowOpts(metaPresets)}
              onChange={(v) => setMetaPresetId(v ? Number(v) : "")}
            />
          )}
        </Field>

        <Field label="Develop preset">
          {(p) => (
            <Select
              {...p}
              block
              value={String(devPresetId)}
              options={rowOpts(devPresets)}
              onChange={(v) => setDevPresetId(v ? Number(v) : "")}
            />
          )}
        </Field>

        <Field label="Add to collection">
          {(p) => (
            <Select
              {...p}
              block
              value={String(collectionId)}
              options={rowOpts(collections)}
              onChange={(v) => setCollectionId(v ? Number(v) : "")}
            />
          )}
        </Field>

        <Field label="Keywords" hint="Comma-separated; applied to every imported photo">
          {(p) => <Input {...p} block value={keywords} placeholder="e.g. travel, italy" onChange={(e) => setKeywords(e.target.value)} />}
        </Field>

        <Field label="Build previews" hint="Rendered during import; the grid loads lazily either way">
          {(p) => (
            <Select
              {...p}
              block
              options={PREVIEW_TIER_OPTS}
              value={previewTier}
              onChange={(v) => setPreviewTier(v as PreviewTier)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
