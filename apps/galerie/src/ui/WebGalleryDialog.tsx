import { Button, Checkbox, Dialog, Field, Input, NumberField, Select, Slider } from "@monet-ui/monet-react";
import { useMemo, useState } from "react";

import type { PhotoRow } from "../catalog/types";
import { exportWebGallery } from "../export";
import { listWatermarks } from "../lib/exportImage";
import { METADATA_INCLUDE_LABELS, type MetadataInclude } from "../lib/exportMetadata";
import type { SharpenAmount, SharpenMedia } from "../lib/outputSharpen";
import { createSavedOutput, findSavedOutputs } from "../lib/savedOutput";
import {
  DEFAULT_WEB_GALLERY_OPTIONS,
  WEB_GALLERY_TEMPLATES,
  applyGalleryTemplate,
  type GalleryImageInfo,
  type WebGalleryOptions,
} from "../lib/webGallery";
import { store, useCatalogSelector } from "../state/store";

const TEMPLATE_OPTIONS = WEB_GALLERY_TEMPLATES.map((template) => ({
  value: template.id,
  label: template.name,
}));
const IMAGE_INFO_OPTIONS = [
  { value: "title", label: "Title" },
  { value: "caption", label: "Caption" },
  { value: "none", label: "None" },
];
const FIT_OPTIONS = [
  { value: "cover", label: "Crop to Fill" },
  { value: "contain", label: "Fit Entire Image" },
];
const SCHEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];
// Same option sets as the Export dialog's Output Settings — one vocabulary.
const SHARPEN_FOR_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "screen", label: "Screen" },
  { value: "matte", label: "Matte Paper" },
  { value: "glossy", label: "Glossy Paper" },
];
const SHARPEN_AMOUNT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
];
const METADATA_OPTIONS = (["all", "copyrightContact", "copyright", "none"] as const).map((value) => ({
  value,
  label: METADATA_INCLUDE_LABELS[value],
}));
// LR's Web watermark is a pick from the saved list, not its own editor — the
// editor lives in Export.
type PaletteColorKey = "background" | "text" | "detail" | "accent";
const PALETTE_FIELDS: { key: PaletteColorKey; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
  { key: "detail", label: "Detail text" },
  { key: "accent", label: "Accent / links" },
];

/** One palette colour as a patch — keeps the computed key off the JSX. */
function colorPatch(key: PaletteColorKey, value: string): Partial<WebGalleryOptions["palette"]> {
  return { [key]: value };
}

const section = (v: unknown): object => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** A layout read back off a Saved Web Gallery collection. Persisted user data:
 *  a gallery written by an older build misses the newer knobs (defaults fill
 *  in), and the fields galleryHtml/galleryExportOpts call string/number methods
 *  on are coerced here — the rest is clamped at render (cssColor/clamp/esc). */
export function sanitizeGalleryOptions(raw: unknown): WebGalleryOptions {
  const o = section(raw) as Partial<WebGalleryOptions>;
  const d = DEFAULT_WEB_GALLERY_OPTIONS;
  const site = { ...d.site, ...section(o.site) } as WebGalleryOptions["site"];
  const output = { ...d.output, ...section(o.output) } as WebGalleryOptions["output"];
  return {
    site: {
      siteTitle: str(site.siteTitle, ""),
      collectionTitle: str(site.collectionTitle, ""),
      description: str(site.description, ""),
      contactName: str(site.contactName, ""),
      contactLink: str(site.contactLink, ""),
    },
    palette: { ...d.palette, ...section(o.palette) },
    appearance: { ...d.appearance, ...section(o.appearance) },
    imageInfo: o.imageInfo === "caption" || o.imageInfo === "none" ? o.imageInfo : "title",
    output: {
      ...output,
      quality: Math.min(1, Math.max(0.1, num(output.quality, d.output.quality))),
      longEdge: Math.max(1, Math.floor(num(output.longEdge, d.output.longEdge))),
    },
  };
}

export function WebGalleryDialog({ photos, onClose }: { photos: PhotoRow[]; onClose: () => void }) {
  const [templateId, setTemplateId] = useState(WEB_GALLERY_TEMPLATES[0].id);
  const [options, setOptions] = useState<WebGalleryOptions>(() => ({
    ...DEFAULT_WEB_GALLERY_OPTIONS,
    site: { ...DEFAULT_WEB_GALLERY_OPTIONS.site },
    palette: { ...DEFAULT_WEB_GALLERY_OPTIONS.palette },
    appearance: { ...DEFAULT_WEB_GALLERY_OPTIONS.appearance },
    output: { ...DEFAULT_WEB_GALLERY_OPTIONS.output },
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // The saved-watermark list can't change while this modal is up.
  const [savedWatermarks] = useState(() => listWatermarks());
  const [watermarkName, setWatermarkName] = useState("");
  // Saved Web Galleries are catalog collections carrying their layout, so the
  // list is store state (unlike the built-in Layout Style templates above).
  const collections = useCatalogSelector((s) => s.collections);
  const saved = useMemo(() => findSavedOutputs(collections, "web"), [collections]);
  const [savedName, setSavedName] = useState("");
  const patchSite = (patch: Partial<WebGalleryOptions["site"]>) =>
    setOptions((current) => ({ ...current, site: { ...current.site, ...patch } }));
  const patchPalette = (patch: Partial<WebGalleryOptions["palette"]>) =>
    setOptions((current) => ({ ...current, palette: { ...current.palette, ...patch } }));
  const patchAppearance = (patch: Partial<WebGalleryOptions["appearance"]>) =>
    setOptions((current) => ({ ...current, appearance: { ...current.appearance, ...patch } }));
  const patchOutput = (patch: Partial<WebGalleryOptions["output"]>) =>
    setOptions((current) => ({ ...current, output: { ...current.output, ...patch } }));
  const metadata = options.output.metadata ?? { include: "all" as MetadataInclude, removeLocation: false };

  // Create Saved Web Gallery: these photos become a collection carrying this
  // layout, so picking it below reproduces the gallery.
  const createSaved = async () => {
    const name = savedName.trim();
    const id = await createSavedOutput(
      name,
      "web",
      photos.map((p) => p.id),
      options,
    );
    if (id == null) return;
    setSavedName("");
    store.notify(`Saved Web Gallery "${name}" created.`);
  };

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportWebGallery(photos, options);
      if (!result) return;
      store.notify(`Web gallery: ${result.written} exported${result.failed ? ` · ${result.failed} failed` : ""}.`);
      onClose();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Export Web Gallery"
      width={440}
      footer={
        <>
          {message && <span className="gal-modal-msg">{message}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || photos.length === 0} onClick={() => void run()}>
            {busy ? "Exporting…" : "Export Folder…"}
          </Button>
        </>
      }
    >
      <div className="gal-export-body">
        <Field label="Template">
          {(props) => (
            <Select
              {...props}
              block
              options={TEMPLATE_OPTIONS}
              value={templateId}
              onChange={(id) => {
                setTemplateId(id);
                const template = WEB_GALLERY_TEMPLATES.find((item) => item.id === id);
                if (template) setOptions((current) => applyGalleryTemplate(current, template));
              }}
            />
          )}
        </Field>
        <Field label="Saved Web Gallery" hint="Stores this selection as a collection with the layout below.">
          {(props) => (
            <div className="gal-export-inline">
              <Input
                {...props}
                block
                value={savedName}
                placeholder="Saved gallery name"
                onChange={(event) => setSavedName(event.target.value)}
              />
              <Button
                size="sm"
                disabled={busy || photos.length === 0 || !savedName.trim()}
                onClick={() => void createSaved()}
              >
                Create
              </Button>
            </div>
          )}
        </Field>
        {saved.length > 0 && (
          <Field label="Open saved">
            {(props) => (
              <Select
                {...props}
                block
                options={[
                  { value: "", label: "Choose…" },
                  ...saved.map((s) => ({ value: String(s.row.id), label: s.row.name })),
                ]}
                value=""
                onChange={(id) => {
                  const found = saved.find((s) => String(s.row.id) === id);
                  if (found) setOptions(sanitizeGalleryOptions(found.config));
                }}
              />
            )}
          </Field>
        )}
        <Field label="Site title">
          {(props) => (
            <Input
              {...props}
              block
              value={options.site.siteTitle}
              onChange={(event) => patchSite({ siteTitle: event.target.value })}
            />
          )}
        </Field>
        <Field label="Collection title">
          {(props) => (
            <Input
              {...props}
              block
              placeholder="Gallery"
              value={options.site.collectionTitle}
              onChange={(event) => patchSite({ collectionTitle: event.target.value })}
            />
          )}
        </Field>
        <Field label="Description">
          {(props) => (
            <Input
              {...props}
              block
              value={options.site.description}
              onChange={(event) => patchSite({ description: event.target.value })}
            />
          )}
        </Field>
        <Field label="Contact name">
          {(props) => (
            <Input
              {...props}
              block
              value={options.site.contactName}
              onChange={(event) => patchSite({ contactName: event.target.value })}
            />
          )}
        </Field>
        <Field label="Contact link">
          {(props) => (
            <Input
              {...props}
              block
              placeholder="https://… or mailto:…"
              value={options.site.contactLink}
              onChange={(event) => patchSite({ contactLink: event.target.value })}
            />
          )}
        </Field>
        {/* Color Palette — the template seeds these; editing one keeps the rest. */}
        {PALETTE_FIELDS.map(({ key, label }) => (
          <Field key={key} label={label}>
            {(props) => (
              <input
                {...props}
                type="color"
                aria-label={`${label} colour`}
                value={options.palette[key]}
                onChange={(event) => patchPalette(colorPatch(key, event.target.value))}
              />
            )}
          </Field>
        ))}
        <Field label="Colour scheme" hint="Matches scrollbars and form controls">
          {(props) => (
            <Select
              {...props}
              block
              options={SCHEME_OPTIONS}
              value={options.palette.scheme}
              onChange={(scheme) => patchPalette({ scheme: scheme as "dark" | "light" })}
            />
          )}
        </Field>
        <Field label="Image labels">
          {(props) => (
            <Select
              {...props}
              block
              options={IMAGE_INFO_OPTIONS}
              value={options.imageInfo}
              onChange={(imageInfo) => setOptions((current) => ({
                ...current,
                imageInfo: imageInfo as GalleryImageInfo,
              }))}
            />
          )}
        </Field>
        <Field label="Columns" hint="0 uses a responsive grid">
          {(props) => (
            <NumberField
              {...props}
              min={0}
              max={12}
              step={1}
              value={options.appearance.columns}
              onChange={(columns) => patchAppearance({ columns: Math.max(0, Math.min(12, Math.round(columns))) })}
            />
          )}
        </Field>
        <Field label="Thumbnail height">
          {(props) => (
            <NumberField
              {...props}
              min={40}
              max={2000}
              step={10}
              value={options.appearance.cellHeightPx}
              onChange={(cellHeightPx) => patchAppearance({ cellHeightPx: Math.max(40, Math.round(cellHeightPx)) })}
            />
          )}
        </Field>
        <Field label="Image fit">
          {(props) => (
            <Select
              {...props}
              block
              options={FIT_OPTIONS}
              value={options.appearance.fit}
              onChange={(fit) => patchAppearance({ fit: fit as "cover" | "contain" })}
            />
          )}
        </Field>
        <Field label="Long edge (px)">
          {(props) => (
            <NumberField
              {...props}
              min={64}
              max={12000}
              step={1}
              value={options.output.longEdge}
              onChange={(longEdge) => patchOutput({ longEdge: Math.max(64, Math.round(longEdge)) })}
            />
          )}
        </Field>
        <Field label={`JPEG quality (${Math.round(options.output.quality * 100)})`}>
          {(props) => (
            <Slider
              {...props}
              min={1}
              max={100}
              step={1}
              value={Math.round(options.output.quality * 100)}
              onChange={(quality) => patchOutput({ quality: quality / 100 })}
            />
          )}
        </Field>
        <Field label="Sharpen for">
          {(props) => (
            <Select
              {...props}
              block
              options={SHARPEN_FOR_OPTIONS}
              value={options.output.sharpen?.media ?? "off"}
              onChange={(media) =>
                patchOutput({
                  sharpen:
                    media === "off"
                      ? null
                      : { media: media as SharpenMedia, amount: options.output.sharpen?.amount ?? "standard" },
                })
              }
            />
          )}
        </Field>
        {options.output.sharpen && (
          <Field label="Sharpen amount">
            {(props) => (
              <Select
                {...props}
                block
                options={SHARPEN_AMOUNT_OPTIONS}
                value={options.output.sharpen?.amount ?? "standard"}
                onChange={(amount) =>
                  patchOutput({
                    sharpen: { media: options.output.sharpen?.media ?? "screen", amount: amount as SharpenAmount },
                  })
                }
              />
            )}
          </Field>
        )}
        <Field label="Metadata">
          {(props) => (
            <Select
              {...props}
              block
              options={METADATA_OPTIONS}
              value={metadata.include}
              onChange={(include) =>
                patchOutput({ metadata: { ...metadata, include: include as MetadataInclude } })
              }
            />
          )}
        </Field>
        {metadata.include !== "none" && (
          <Field label="Location">
            {(props) => (
              <Checkbox
                {...props}
                checked={metadata.removeLocation}
                onChange={(removeLocation) => patchOutput({ metadata: { ...metadata, removeLocation } })}
              >
                Remove Location Info
              </Checkbox>
            )}
          </Field>
        )}
        <Field label="Watermark" hint="Saved watermarks come from the Export dialog">
          {(props) => (
            <Select
              {...props}
              block
              options={[
                { value: "", label: "None" },
                ...savedWatermarks.map((w) => ({ value: w.name, label: w.name })),
              ]}
              value={watermarkName}
              onChange={(name) => {
                setWatermarkName(name);
                patchOutput({ watermark: savedWatermarks.find((w) => w.name === name)?.spec ?? null });
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
