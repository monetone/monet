// ExportDialog — the Output/Export modal (Phase 5 slice). Format + quality +
// resize, then a folder pick, then a develop-and-write batch (src/export.ts).
// JPEG/PNG use the bounded web route; RGB16 TIFF stays native end to end.
// Built on the shared @monet-ui/monet-react design system (Dialog + controls).

import { Button, Checkbox, Dialog, Field, Input, NumberField, Select, Slider } from "@monet-ui/monet-react";
import { useState } from "react";

import type { PhotoRow } from "../catalog/types";
import type { ExportColorSpace } from "../engine";
import { pickExportDir, runExport, type ExportFormat, type ExportResult } from "../export";
import { store } from "../state/store";
import {
  deleteExportPreset,
  listExportPresets,
  saveExportPreset,
  type ExportConfig,
  type ExportPreset,
} from "../lib/exportPresets";
import { AFTER_EXPORT_OPTS, runAfterExport, type AfterExportAction } from "../lib/afterExport";
import { METADATA_INCLUDE_LABELS, type MetadataInclude } from "../lib/exportMetadata";
import { listSavedLocations } from "../lib/geotag";
import {
  deleteWatermark,
  hasWatermarkContent,
  listWatermarks,
  saveWatermark,
  type ResizeMode,
  type ResizeSpec,
  type ResizeUnit,
  type SavedWatermark,
  type WatermarkSpecEx,
} from "../lib/exportImage";
import type { SharpenAmount, SharpenMedia } from "../lib/outputSharpen";
import type { WatermarkAnchor } from "../lib/watermark";

const FORMAT_OPTS = [
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "tiff8", label: "TIFF (8-bit)" },
  { value: "tiff16", label: "TIFF (RGB 16-bit)" },
  { value: "psd", label: "PSD (flattened)" },
  { value: "linearDng16", label: "Linear DNG (16-bit)" },
  { value: "original", label: "Original (copy source)" },
];
const TIFF_COMPRESSION_OPTS = [
  { value: "none", label: "None" },
  { value: "zip", label: "ZIP" },
];
const PROFILE_OPTS: { value: ExportColorSpace; label: string }[] = [
  { value: "srgb", label: "sRGB" },
  { value: "displayP3", label: "Display P3" },
  { value: "adobeRGB", label: "Adobe RGB (1998)" },
  { value: "prophoto", label: "ProPhoto RGB" },
];
// ponytail: the native TIFF16 route still carries sRGB / Display P3 only —
// widen src-tauri's develop-job profiles, then drop this subset.
const NATIVE_PROFILE_OPTS = PROFILE_OPTS.slice(0, 2);
const SHARPEN_FOR_OPTS = [
  { value: "off", label: "Off" },
  { value: "screen", label: "Screen" },
  { value: "matte", label: "Matte Paper" },
  { value: "glossy", label: "Glossy Paper" },
];
const SHARPEN_AMOUNT_OPTS = [
  { value: "low", label: "Low" },
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
];

// LR's "All Except Camera & Camera Raw Info" is omitted: an export never carries
// camera/Camera Raw info here, so it would duplicate "All".
const METADATA_OPTS = (["all", "copyrightContact", "copyright", "none"] as const).map((value) => ({
  value,
  label: METADATA_INCLUDE_LABELS[value],
}));

// LR's Watermark Editor: Text or Graphic (PNG/JPEG), plus the shared knobs.
const WM_MODES = [
  { value: "off", label: "Off" },
  { value: "text", label: "Text" },
  { value: "graphic", label: "Graphic (PNG/JPEG)" },
];
// ponytail: generic CSS stacks, not a system font list — enumerating installed
// fonts needs the Local Font Access API / a native call; add when asked.
const WM_FONTS = [
  { value: "sans-serif", label: "Sans serif" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Monospace" },
];
// LR rotates watermarks in 90° steps.
const WM_ROTATE = [
  { value: "0", label: "None" },
  { value: "1", label: "90° CW" },
  { value: "2", label: "180°" },
  { value: "3", label: "90° CCW" },
];
const WM_POSITIONS: { value: WatermarkAnchor; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "center-left", label: "Center left" },
  { value: "center", label: "Center" },
  { value: "center-right", label: "Center right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
];

const NAMING_PRESETS: { label: string; template: string; custom: boolean; seq: boolean }[] = [
  { label: "Filename", template: "{name}{copyname}", custom: false, seq: false },
  { label: "Custom Name - Sequence", template: "{customtext}-{sequence:3}", custom: true, seq: true },
  { label: "Filename - Sequence", template: "{name}-{sequence:3}", custom: false, seq: true },
];
const NAMING_OPTS = NAMING_PRESETS.map((p, i) => ({ value: String(i), label: p.label }));

// LR's Image Sizing ▸ Resize to Fit modes, plus "full" for no resize.
const RESIZE_OPTS: { value: ResizeMode | "full"; label: string }[] = [
  { value: "full", label: "Full size" },
  { value: "widthHeight", label: "Width & Height" },
  { value: "dimensions", label: "Dimensions" },
  { value: "longEdge", label: "Long Edge" },
  { value: "shortEdge", label: "Short Edge" },
  { value: "megapixels", label: "Megapixels" },
  { value: "percentage", label: "Percentage" },
];
const UNIT_OPTS: { value: ResizeUnit; label: string }[] = [
  { value: "px", label: "pixels" },
  { value: "in", label: "inches" },
  { value: "cm", label: "cm" },
];
/** Modes whose entries are edge lengths (carry a unit); the others are unitless. */
const EDGE_MODES: ReadonlySet<ResizeMode | "full"> = new Set(["widthHeight", "dimensions", "longEdge", "shortEdge"]);

export function formatExportResult(res: ExportResult): string {
  return [
    `Exported ${res.written}`,
    res.committed ? `${res.committed} committed without confirmed durability: ${res.durabilityWarnings.join("; ")}` : "",
    res.failed ? `${res.failed} failed: ${res.failureMessages.join("; ")}` : "",
  ].filter(Boolean).join(" · ") + ".";
}

export function ExportDialog({ photos, onClose }: { photos: PhotoRow[]; onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>("jpeg");
  const [profile, setProfile] = useState<ExportColorSpace>("srgb");
  const [quality, setQuality] = useState(90);
  const [tiffCompression, setTiffCompression] = useState<"none" | "zip">("none");
  // LR: "Limit File Size To ___ K" replaces the Quality slider when on.
  const [limitSize, setLimitSize] = useState(false);
  const [limitKB, setLimitKB] = useState(2048);
  const [resizeMode, setResizeMode] = useState<ResizeMode | "full">("full");
  const [sizeW, setSizeW] = useState(2048);
  const [sizeH, setSizeH] = useState(2048);
  const [sizeUnit, setSizeUnit] = useState<ResizeUnit>("px");
  const [dontEnlarge, setDontEnlarge] = useState(true);
  const [ppi, setPpi] = useState(240); // LR's Resolution default
  const [namingIdx, setNamingIdx] = useState(0);
  const [customText, setCustomText] = useState("");
  const [startNumber, setStartNumber] = useState(1);
  const [sharpenFor, setSharpenFor] = useState<SharpenMedia | "off">("off");
  const [sharpenAmount, setSharpenAmount] = useState<SharpenAmount>("standard");
  const [wmMode, setWmMode] = useState<"off" | "text" | "graphic">("off");
  const [wmText, setWmText] = useState("");
  const [wmPos, setWmPos] = useState<WatermarkAnchor>("bottom-right");
  const [wmOpacity, setWmOpacity] = useState(70);
  const [wmSize, setWmSize] = useState(4);
  const [wmInset, setWmInset] = useState(2);
  const [wmColor, setWmColor] = useState("#ffffff");
  const [wmFont, setWmFont] = useState("sans-serif");
  const [wmBold, setWmBold] = useState(false);
  const [wmItalic, setWmItalic] = useState(false);
  const [wmShadow, setWmShadow] = useState(true);
  const [wmRotate, setWmRotate] = useState<0 | 1 | 2 | 3>(0);
  const [wmGraphic, setWmGraphic] = useState<string | null>(null);
  const [wmSaved, setWmSaved] = useState<SavedWatermark[]>(() => listWatermarks());
  const [selWm, setSelWm] = useState("");
  const [wmName, setWmName] = useState("");
  const [metaInclude, setMetaInclude] = useState<MetadataInclude>("all");
  const [metaRemoveLocation, setMetaRemoveLocation] = useState(false);
  // LR default is on; export.ts's writeKeywordHierarchy treats omitted as on too.
  const [metaHierarchy, setMetaHierarchy] = useState(true);
  // LR's Content Credentials (Beta) — opt-in, off by default (today's export
  // behavior is unchanged unless this is checked). Signs + embeds when a
  // signer is configured (Preferences ▸ Content Credentials), else falls back
  // to the unsigned `.c2pa.json` sidecar — see applyContentCredentials.
  const [contentCredentials, setContentCredentials] = useState(false);
  const [afterExport, setAfterExport] = useState<AfterExportAction>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [presets, setPresets] = useState<ExportPreset[]>(() => listExportPresets());
  const [selPreset, setSelPreset] = useState("");
  const [presetName, setPresetName] = useState("");

  const raster = format === "jpeg" || format === "png";
  // tiff8/psd render through the develop pipeline (sRGB only); original copies
  // the source bytes, so every render-time control disappears for it.
  const developRendered = raster || format === "tiff8" || format === "psd";
  const naming = NAMING_PRESETS[namingIdx];
  // TIFF16 only carries the native subset; a wider pick clamps to sRGB rather
  // than silently riding along into a format that cannot honor it.
  const profileOpts =
    format === "tiff16" ? NATIVE_PROFILE_OPTS
    : format === "tiff8" || format === "psd" ? PROFILE_OPTS.slice(0, 1)
    : PROFILE_OPTS;
  const effProfile: ExportColorSpace = profileOpts.some((o) => o.value === profile) ? profile : "srgb";

  // The full Watermark Editor spec from the wm* state. Also what named saved
  // watermarks store — the LR model where Print/Web/Slideshow pick by name.
  const wmSpec = (): WatermarkSpecEx => ({
    mode: wmMode === "graphic" ? "graphic" : "text",
    text: wmText.trim(),
    anchor: wmPos,
    opacity: wmOpacity / 100,
    sizePct: wmSize,
    insetPct: wmInset,
    color: wmColor,
    font: wmFont,
    bold: wmBold,
    italic: wmItalic,
    shadow: wmShadow,
    rotateQuarter: wmRotate,
    ...(wmGraphic ? { graphicDataUrl: wmGraphic } : {}),
  });
  const applyWm = (s: WatermarkSpecEx): void => {
    setWmMode(s.mode === "graphic" ? "graphic" : "text");
    setWmText(s.text);
    setWmPos(s.anchor);
    setWmOpacity(Math.round(s.opacity * 100));
    setWmSize(s.sizePct);
    setWmInset(s.insetPct);
    setWmColor(s.color ?? "#ffffff");
    setWmFont(s.font ?? "sans-serif");
    setWmBold(s.bold ?? false);
    setWmItalic(s.italic ?? false);
    setWmShadow(s.shadow ?? true);
    setWmRotate(s.rotateQuarter ?? 0);
    setWmGraphic(s.graphicDataUrl ?? null);
  };

  // exportPresets.ts's ExportConfig predates this option; round-trip it as a
  // local extension the same optional/absent-default way every other
  // ExportConfig field is handled, rather than widening that shared type.

  // Gather / restore all dialog choices for save/load. Kept beside the state so a
  // new option is a one-line addition in both directions.
  const currentConfig = (): ExportConfig => ({
    // ponytail: exportPresets' profile union is still srgb|displayP3 — widen it
    // to ExportColorSpace and drop this cast (presets round-trip as JSON, so
    // the wider value already loads back fine).
    format, profile, quality, tiffCompression, limitSize, limitKB,
    resizeMode, sizeW, sizeH, sizeUnit, dontEnlarge, ppi,
    namingIdx, customText, startNumber,
    // Export presets carry the legacy text-watermark fields only; the editor's
    // extras (graphic/font/colour/rotation) round-trip via named saved
    // watermarks instead (the LR model). Off/graphic saves an empty text so
    // loading doesn't re-arm a stale text watermark.
    sharpenFor, sharpenAmount, wmText: wmMode === "text" ? wmText : "", wmPos, wmOpacity, wmSize, wmInset,
    metaInclude, metaRemoveLocation, metaHierarchy, afterExport, contentCredentials,
  });
  const applyConfig = (c: ExportConfig): void => {
    setFormat(c.format); setProfile(c.profile); setQuality(c.quality);
    setTiffCompression(c.tiffCompression ?? "none");
    setLimitSize(c.limitSize ?? false); setLimitKB(c.limitKB ?? 2048);
    // Presets predating Resize to Fit carry only the old longEdge preset value.
    setResizeMode(c.resizeMode ?? (c.longEdge ? "longEdge" : "full"));
    setSizeW(c.sizeW ?? c.longEdge ?? 2048); setSizeH(c.sizeH ?? 2048);
    setSizeUnit(c.sizeUnit ?? "px"); setDontEnlarge(c.dontEnlarge ?? true); setPpi(c.ppi ?? 240);
    setNamingIdx(c.namingIdx); setCustomText(c.customText);
    setStartNumber(c.startNumber); setSharpenFor(c.sharpenFor); setSharpenAmount(c.sharpenAmount);
    setWmMode(c.wmText.trim() ? "text" : "off");
    setWmText(c.wmText); setWmPos(c.wmPos); setWmOpacity(c.wmOpacity); setWmSize(c.wmSize);
    setWmInset(c.wmInset ?? 2); // presets predating the inset knob keep the old hardcoded 2
    // Presets saved before metadata scoping existed fall back to LR's default.
    setMetaInclude(c.metaInclude ?? "all"); setMetaRemoveLocation(c.metaRemoveLocation ?? false);
    setMetaHierarchy(c.metaHierarchy ?? true); // absent = LR's default, on
    setAfterExport(c.afterExport ?? ""); // presets predating Post-Processing do nothing
    setContentCredentials(c.contentCredentials ?? false); // absent = off
  };

  const doExport = async () => {
    if (store.getState().exportJob) {
      setMsg("An export is already running — cancel it or wait for it to finish.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // The native 16-bit routes render in Rust, which has no resize/density step.
      const resize: ResizeSpec | null = developRendered && resizeMode !== "full"
        ? {
            mode: resizeMode,
            value: sizeW,
            ...(resizeMode === "widthHeight" || resizeMode === "dimensions" ? { value2: sizeH } : {}),
            ...(EDGE_MODES.has(resizeMode) ? { unit: sizeUnit } : {}),
            dontEnlarge,
          }
        : null;
      const opts = {
        format,
        quality: quality / 100,
        tiffCompression,
        limitSizeKB: format === "jpeg" && limitSize && limitKB > 0 ? limitKB : null,
        longEdge: null,
        resize,
        ppi: developRendered ? ppi : null,
        profile: effProfile,
        naming: namingIdx === 0 ? null : { template: naming.template, customText, startNumber },
        sharpen: raster && sharpenFor !== "off" ? { media: sharpenFor, amount: sharpenAmount } : null,
        watermark: raster && wmMode !== "off" && hasWatermarkContent(wmSpec()) ? wmSpec() : null,
        // Saved Locations flagged Private strip a photo's location metadata on
        // export (LR parity). Read at export time so a location edited since the
        // dialog opened still applies.
        metadata: {
          include: metaInclude,
          removeLocation: metaRemoveLocation,
          privateLocations: listSavedLocations().filter((l) => l.isPrivate),
        },
        writeKeywordHierarchy: metaHierarchy,
        contentCredentials,
      };
      const dir = await pickExportDir();
      if (dir == null) return; // folder pick cancelled — leave the dialog open
      // LR parity: the export runs in the background — the dialog closes now and
      // the StatusBar shows progress + Cancel; the summary lands as a notice.
      store.beginExportJob(photos.length);
      const writtenPaths: string[] = [];
      let unsignedCredentials = false;
      void runExport(photos, dir, opts, {
        onTick: () => store.tickExportJob(),
        isCancelled: () => store.exportCancelled(),
        onWritten: (path) => writtenPaths.push(path),
        // No signer configured — the batch carries the unsigned sidecar, not
        // embedded credentials. Told once, not silently, per the export.
        onUnsignedCredentials: () => { unsignedCredentials = true; },
      })
        .then(async (res) => {
          const notice = unsignedCredentials
            ? " Content Credentials were written unsigned (no signing certificate configured)."
            : "";
          store.notify((res.cancelled ? "Export cancelled — " : "") + formatExportResult(res) + notice);
          // Post-Processing runs on what actually landed; a cancelled batch still
          // wrote files, so LR's action still applies to them.
          const problem = await runAfterExport(afterExport, dir, writtenPaths);
          if (problem) store.notify(problem);
        })
        .catch((e) => store.notify(`Export failed: ${String(e)}`))
        .finally(() => store.endExportJob());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const presetOpts = [{ value: "", label: "Custom…" }, ...presets.map((p) => ({ value: p.name, label: p.name }))];

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Export ${photos.length} Photo${photos.length === 1 ? "" : "s"}`}
      width={440}
      footer={
        <>
          {msg && <span className="gal-modal-msg">{msg}</span>}
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={busy || photos.length === 0} onClick={() => void doExport()}>
            {busy ? "Exporting…" : "Export…"}
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
              {/* Built-ins ship with the app — nothing to delete. */}
              {selPreset && !presets.find((x) => x.name === selPreset)?.builtIn && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Delete preset"
                  onClick={() => {
                    setPresets(deleteExportPreset(selPreset));
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
                  setPresets(saveExportPreset(presetName, currentConfig()));
                  setSelPreset(presetName.trim());
                  setPresetName("");
                }}
              >
                Save
              </Button>
            </div>
          )}
        </Field>

        <Field label="Format">
          {(p) => (
            <Select {...p} block options={FORMAT_OPTS} value={format}
              onChange={(v) => setFormat(v as "jpeg" | "png" | "tiff16" | "linearDng16")} />
          )}
        </Field>

        {/* Linear DNG is scene-referred — it has no output color space to pick. */}
        {format !== "linearDng16" && (
          <Field label="Color space">
            {(p) => <Select {...p} block options={profileOpts} value={effProfile} onChange={(v) => setProfile(v as ExportColorSpace)} />}
          </Field>
        )}

        {format === "jpeg" && !limitSize && (
          <Field label={`Quality (${quality})`}>
            {(p) => <Slider {...p} min={1} max={100} step={1} value={quality} onChange={(v) => setQuality(Math.round(v))} />}
          </Field>
        )}

        {format === "jpeg" && (
          <Field label="File Size">
            {(p) => (
              <div className="gal-export-inline">
                <Checkbox {...p} checked={limitSize} onChange={setLimitSize}>
                  Limit File Size To
                </Checkbox>
                {limitSize && (
                  <NumberField
                    aria-label="Maximum file size in kilobytes"
                    min={16}
                    step={64}
                    value={limitKB}
                    onChange={(v) => setLimitKB(Math.max(16, Math.round(v)))}
                  />
                )}
                {limitSize && <span>K</span>}
              </div>
            )}
          </Field>
        )}

        {format === "tiff8" && (
          <Field label="Compression">
            {(p) => (
              <Select
                {...p}
                block
                options={TIFF_COMPRESSION_OPTS}
                value={tiffCompression}
                onChange={(v) => setTiffCompression(v as "none" | "zip")}
              />
            )}
          </Field>
        )}

        {raster && (
          <Field label="Resize to Fit">
            {(p) => (
              <Select {...p} block options={RESIZE_OPTS} value={resizeMode}
                onChange={(v) => setResizeMode(v as ResizeMode | "full")} />
            )}
          </Field>
        )}

        {raster && (resizeMode === "widthHeight" || resizeMode === "dimensions") && (
          <>
            <Field label={`Width (${sizeUnit})`}>
              {(p) => <NumberField {...p} min={0} step={sizeUnit === "px" ? 1 : 0.1} value={sizeW} onChange={setSizeW} />}
            </Field>
            <Field label={`Height (${sizeUnit})`}>
              {(p) => <NumberField {...p} min={0} step={sizeUnit === "px" ? 1 : 0.1} value={sizeH} onChange={setSizeH} />}
            </Field>
          </>
        )}

        {raster && (resizeMode === "longEdge" || resizeMode === "shortEdge") && (
          <Field label={`${resizeMode === "longEdge" ? "Long Edge" : "Short Edge"} (${sizeUnit})`}>
            {(p) => <NumberField {...p} min={0} step={sizeUnit === "px" ? 1 : 0.1} value={sizeW} onChange={setSizeW} />}
          </Field>
        )}

        {raster && resizeMode === "megapixels" && (
          <Field label="Megapixels">
            {(p) => <NumberField {...p} min={0} step={0.1} value={sizeW} onChange={setSizeW} />}
          </Field>
        )}

        {raster && resizeMode === "percentage" && (
          <Field label="Percent">
            {(p) => <NumberField {...p} min={0} step={1} value={sizeW} onChange={setSizeW} />}
          </Field>
        )}

        {raster && EDGE_MODES.has(resizeMode) && resizeMode !== "full" && (
          <Field label="Unit">
            {(p) => <Select {...p} block options={UNIT_OPTS} value={sizeUnit} onChange={(v) => setSizeUnit(v as ResizeUnit)} />}
          </Field>
        )}

        {raster && resizeMode !== "full" && (
          <Field label="Sizing">
            {(p) => (
              <Checkbox {...p} checked={dontEnlarge} onChange={setDontEnlarge}>
                Don't Enlarge
              </Checkbox>
            )}
          </Field>
        )}

        {raster && (
          <Field label="Resolution (ppi)">
            {(p) => <NumberField {...p} min={1} step={1} value={ppi} onChange={(v) => setPpi(Math.max(1, Math.round(v)))} />}
          </Field>
        )}

        <Field label="File Naming">
          {(p) => <Select {...p} block options={NAMING_OPTS} value={String(namingIdx)} onChange={(v) => setNamingIdx(Number(v))} />}
        </Field>

        {naming.custom && (
          <Field label="Custom Text">
            {(p) => <Input {...p} block value={customText} placeholder="Custom text" onChange={(e) => setCustomText(e.target.value)} />}
          </Field>
        )}

        {naming.seq && (
          <Field label="Start Number">
            {(p) => <NumberField {...p} min={0} step={1} value={startNumber} onChange={(v) => setStartNumber(Math.max(0, Math.floor(v)))} />}
          </Field>
        )}

        {raster && (
          <Field label="Sharpen For">
            {(p) => <Select {...p} block options={SHARPEN_FOR_OPTS} value={sharpenFor} onChange={(v) => setSharpenFor(v as SharpenMedia | "off")} />}
          </Field>
        )}

        {raster && sharpenFor !== "off" && (
          <Field label="Amount">
            {(p) => <Select {...p} block options={SHARPEN_AMOUNT_OPTS} value={sharpenAmount} onChange={(v) => setSharpenAmount(v as SharpenAmount)} />}
          </Field>
        )}

        {raster && (
          <Field label="Metadata">
            {(p) => (
              <Select
                {...p}
                block
                options={METADATA_OPTS}
                value={metaInclude}
                onChange={(v) => setMetaInclude(v as MetadataInclude)}
              />
            )}
          </Field>
        )}

        {raster && metaInclude !== "none" && (
          <Field label="Metadata">
            {(p) => (
              <div className="gal-export-inline">
                <Checkbox {...p} checked={metaRemoveLocation} onChange={setMetaRemoveLocation}>
                  Remove Location Info
                </Checkbox>
                <Checkbox checked={metaHierarchy} onChange={setMetaHierarchy}>
                  Write Keywords as Lightroom Hierarchy
                </Checkbox>
              </div>
            )}
          </Field>
        )}

        {raster && (
          <Field label="Watermark">
            {(p) => <Select {...p} block options={WM_MODES} value={wmMode} onChange={(v) => setWmMode(v as "off" | "text" | "graphic")} />}
          </Field>
        )}

        {raster && wmMode !== "off" && (
          <>
            {/* Named saved watermarks — the list Print/Web/Slideshow share. */}
            <Field label="Saved watermark">
              {(p) => (
                <div className="gal-export-inline">
                  <Select
                    {...p}
                    block
                    options={[{ value: "", label: "Custom…" }, ...wmSaved.map((w) => ({ value: w.name, label: w.name }))]}
                    value={selWm}
                    onChange={(name) => {
                      setSelWm(name);
                      const s = wmSaved.find((w) => w.name === name);
                      if (s) applyWm(s.spec);
                    }}
                  />
                  {selWm && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Delete saved watermark"
                      onClick={() => {
                        setWmSaved(deleteWatermark(selWm));
                        setSelWm("");
                      }}
                    >
                      ×
                    </Button>
                  )}
                </div>
              )}
            </Field>
            <Field label="Save watermark">
              {(p) => (
                <div className="gal-export-inline">
                  <Input {...p} block value={wmName} placeholder="Watermark name" onChange={(e) => setWmName(e.target.value)} />
                  <Button
                    size="sm"
                    disabled={!wmName.trim()}
                    onClick={() => {
                      setWmSaved(saveWatermark(wmName, wmSpec()));
                      setSelWm(wmName.trim());
                      setWmName("");
                    }}
                  >
                    Save
                  </Button>
                </div>
              )}
            </Field>

            {wmMode === "text" ? (
              <>
                <Field label="Text">
                  {(p) => <Input {...p} block value={wmText} placeholder="© Your Name" onChange={(e) => setWmText(e.target.value)} />}
                </Field>
                <Field label="Font">
                  {(p) => <Select {...p} block options={WM_FONTS} value={wmFont} onChange={setWmFont} />}
                </Field>
                <Field label="Style">
                  {(p) => (
                    <div className="gal-export-inline">
                      <Checkbox {...p} checked={wmBold} onChange={setWmBold}>Bold</Checkbox>
                      <Checkbox checked={wmItalic} onChange={setWmItalic}>Italic</Checkbox>
                      <Checkbox checked={wmShadow} onChange={setWmShadow}>Shadow</Checkbox>
                    </div>
                  )}
                </Field>
                <Field label="Color">
                  {(p) => (
                    <input
                      {...p}
                      type="color"
                      aria-label="Watermark text color"
                      value={wmColor}
                      onChange={(e) => setWmColor(e.target.value)}
                    />
                  )}
                </Field>
              </>
            ) : (
              <Field label="Graphic">
                {(p) => (
                  <input
                    {...p}
                    type="file"
                    accept="image/png,image/jpeg"
                    aria-label="Watermark graphic (PNG or JPEG)"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      // Stored as a data URL so saved watermarks serialize whole.
                      const r = new FileReader();
                      r.onload = () => setWmGraphic(String(r.result));
                      r.readAsDataURL(f);
                    }}
                  />
                )}
              </Field>
            )}

            <Field label="Rotation">
              {(p) => <Select {...p} block options={WM_ROTATE} value={String(wmRotate)} onChange={(v) => setWmRotate(Number(v) as 0 | 1 | 2 | 3)} />}
            </Field>
            <Field label="Position">
              {(p) => <Select {...p} block options={WM_POSITIONS} value={wmPos} onChange={(v) => setWmPos(v as WatermarkAnchor)} />}
            </Field>
            <Field label={`Opacity (${wmOpacity})`}>
              {(p) => <Slider {...p} min={0} max={100} step={1} value={wmOpacity} onChange={(v) => setWmOpacity(Math.round(v))} />}
            </Field>
            <Field label={`Size (${wmSize})`}>
              {(p) => <Slider {...p} min={1} max={20} step={1} value={wmSize} onChange={(v) => setWmSize(Math.round(v))} />}
            </Field>
            <Field label={`Inset (${wmInset})`}>
              {/* 0 = flush to the edge; watermarkLayout clamps above 20, so the max is UX not safety. */}
              {(p) => <Slider {...p} min={0} max={20} step={1} value={wmInset} onChange={(v) => setWmInset(Math.round(v))} />}
            </Field>
          </>
        )}

        {/* LR's Content Credentials (Beta). Unavailable for a byte-for-byte
            Original copy — its credentials, if any, are the source's own. */}
        {format !== "original" && (
          <Field label="Content Credentials">
            {(p) => (
              <Checkbox {...p} checked={contentCredentials} onChange={setContentCredentials}>
                Content Credentials (Beta)
              </Checkbox>
            )}
          </Field>
        )}

        {/* LR's Post-Processing panel, last in the dialog like its original. */}
        <Field label="After Export">
          {(p) => (
            <Select
              {...p}
              block
              options={AFTER_EXPORT_OPTS}
              value={afterExport}
              onChange={(v) => setAfterExport(v as AfterExportAction)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
