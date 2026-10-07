// AutoImportDialog — Lightroom's File ▸ Auto Import Settings: the watched
// folder, the Destination the files move to (Move To + Subfolder Name), File
// Naming, the Information applied on arrival (develop preset, metadata preset,
// keywords) and Initial Previews. Saving restarts the watcher.

import { Button, Checkbox, Dialog, Field, Input, NumberField, Select } from "@monet-ui/monet-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { restartAutoImport } from "../autoImport";
import { listMetadataPresets, listPresets } from "../catalog/catalog";
import type { MetadataPresetRow, PresetRow } from "../catalog/types";
import type { PreviewTier } from "../import";
import { autoImportDestDir, loadWatchedFolder, saveWatchedFolder } from "../lib/watchedFolder";
import { store } from "../state/store";

// ponytail: mirrors ImportDialog's ladder, which doesn't export it (that file
// belongs to another workstream this pass) — hoist to import.ts when it frees up.
const PREVIEW_TIER_OPTS = [
  { value: "none", label: "None (fastest import)" },
  { value: "minimal", label: "Minimal (grid thumbnails)" },
  { value: "standard", label: "Standard (2560px)" },
  { value: "oneToOne", label: "1:1 (full resolution)" },
];

export function AutoImportDialog({ onClose }: { onClose: () => void }) {
  const [setting, setSetting] = useState(() => loadWatchedFolder());
  const [devPresets, setDevPresets] = useState<PresetRow[]>([]);
  const [metaPresets, setMetaPresets] = useState<MetadataPresetRow[]>([]);

  useEffect(() => {
    listPresets().then(setDevPresets).catch(() => setDevPresets([]));
    listMetadataPresets().then(setMetaPresets).catch(() => setMetaPresets([]));
  }, []);

  const patch = (p: Partial<typeof setting>) => setSetting((s) => ({ ...s, ...p }));
  const pickFolder = (title: string, set: (dir: string) => void) =>
    void open({ directory: true, multiple: false, title }).then((dir) => {
      if (typeof dir === "string") set(dir);
    });
  /** A preset row deleted since the last save resolves to "None". */
  const pickId = (id: number | null, rows: { id: number }[]): string =>
    id != null && rows.some((r) => r.id === id) ? String(id) : "";
  const rowOpts = (rows: { id: number; name: string }[]) => [
    { value: "", label: "None" },
    ...rows.map((r) => ({ value: String(r.id), label: r.name })),
  ];

  const dest = autoImportDestDir(setting);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Auto Import Settings"
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              saveWatchedFolder(setting);
              void restartAutoImport();
              store.notify(
                setting.enabled && setting.path
                  ? `Auto Import watching ${setting.path}`
                  : "Auto Import off",
              );
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="gal-export-body">
        <div className="gal-modal-msg">
          New photos appearing in the watched folder (and its subfolders) import
          automatically; suspected duplicates are skipped.
        </div>

        <Field label="Watched folder">
          {() => (
            <div className="gal-export-inline">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => pickFolder("Watch Folder", (path) => patch({ path }))}
              >
                Choose Folder…
              </Button>
              <span className="gal-import-count">{setting.path ?? "None"}</span>
            </div>
          )}
        </Field>

        <Field
          label="Move to"
          hint={
            dest
              ? `Imported files are moved out of the watched folder into ${dest}`
              : "Without a destination, files import in place and stay in the watched folder"
          }
        >
          {() => (
            <div className="gal-export-inline">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => pickFolder("Move Imported Photos To", (moveTo) => patch({ moveTo }))}
              >
                Choose Folder…
              </Button>
              <span className="gal-import-count">{setting.moveTo ?? "None"}</span>
              {setting.moveTo && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="No destination — import in place"
                  onClick={() => patch({ moveTo: null })}
                >
                  ×
                </Button>
              )}
            </div>
          )}
        </Field>

        {setting.moveTo && (
          <Field label="Subfolder name">
            {(p) => (
              <Input
                {...p}
                block
                value={setting.subfolder}
                placeholder="Auto Imported Photos"
                onChange={(e) => patch({ subfolder: e.target.value })}
              />
            )}
          </Field>
        )}

        {setting.moveTo && (
          <Checkbox checked={setting.rename} onChange={(rename) => patch({ rename })}>
            Rename moved files
          </Checkbox>
        )}
        {setting.moveTo && setting.rename && (
          <>
            <Field label="Template" hint="Tokens: {name} {sequence} {sequence:3}">
              {(p) => (
                <Input
                  {...p}
                  block
                  value={setting.template}
                  onChange={(e) => patch({ template: e.target.value })}
                />
              )}
            </Field>
            <Field label="Start #">
              {(p) => (
                <NumberField
                  {...p}
                  min={0}
                  step={1}
                  value={setting.startNumber}
                  onChange={(v) => patch({ startNumber: Math.max(0, Math.floor(v)) })}
                />
              )}
            </Field>
          </>
        )}

        <Field label="Develop preset">
          {(p) => (
            <Select
              {...p}
              block
              value={pickId(setting.developPresetId, devPresets)}
              options={rowOpts(devPresets)}
              onChange={(v) => patch({ developPresetId: v ? Number(v) : null })}
            />
          )}
        </Field>

        <Field label="Metadata preset">
          {(p) => (
            <Select
              {...p}
              block
              value={pickId(setting.metadataPresetId, metaPresets)}
              options={rowOpts(metaPresets)}
              onChange={(v) => patch({ metadataPresetId: v ? Number(v) : null })}
            />
          )}
        </Field>

        <Field label="Keywords" hint="Comma-separated; applied to every auto-imported photo">
          {(p) => (
            <Input
              {...p}
              block
              value={setting.keywords}
              placeholder="e.g. tethered, studio"
              onChange={(e) => patch({ keywords: e.target.value })}
            />
          )}
        </Field>

        <Field label="Initial previews">
          {(p) => (
            <Select
              {...p}
              block
              options={PREVIEW_TIER_OPTS}
              value={setting.previewTier}
              onChange={(v) => patch({ previewTier: v as PreviewTier })}
            />
          )}
        </Field>

        <Checkbox checked={setting.enabled} onChange={(enabled) => patch({ enabled })}>
          Enable Auto Import
        </Checkbox>
      </div>
    </Dialog>
  );
}
