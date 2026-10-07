// ui/panels/export-panel - Export for Screens setup

import { Select } from "@monet-ui/monet-react";
import { EXPORT_FOR_SCREENS_FORMATS, Ops, exportForScreensManifestOptions, resolvedExportForScreensSettings } from "../../engine";
import type { ExportForScreensFormat } from "../../engine";
import { buildExportForScreensManifest } from "../../io/compatibility";
import { useEditorState, useStore } from "../../state/store-context";

const fieldStyle = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-1)",
  fontSize: 11,
  minWidth: 0,
  padding: "2px 4px",
} as const;

const checkboxStyle = { width: 12, height: 12, margin: 0 } as const;

const FORMAT_LABELS: Record<ExportForScreensFormat, string> = {
  svg: "SVG",
  png: "PNG",
  pdf: "PDF",
  jpeg: "JPEG",
  webp: "WebP",
  tiff: "TIFF",
};

function Row({ label, value, attr }: { label: string; value: string | number; attr?: string }) {
  return (
    <div className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span data-export={attr}>{value}</span>
    </div>
  );
}

function FormatRow({
  format,
  checked,
  onChange,
}: {
  format: ExportForScreensFormat;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "2px 0" }}>
      <span>{FORMAT_LABELS[format]}</span>
      <input
        data-export-format={format}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        style={checkboxStyle}
      />
    </label>
  );
}

export function ExportPanel() {
  const store = useStore();
  const { doc } = useEditorState();
  const settings = resolvedExportForScreensSettings(doc.exportForScreens);
  const manifest = buildExportForScreensManifest(doc, exportForScreensManifestOptions(doc, settings));
  const files = manifest.entries.flatMap((entry) => entry.files);
  const supported = files.filter((file) => file.supported).length;
  const planned = files.length - supported;
  const previewFiles = files.slice(0, 4);

  const update = (patch: Parameters<typeof Ops.Export.setExportForScreensSettings>[1]) => {
    store.transact("Export for Screens", (d) => {
      Ops.Export.setExportForScreensSettings(d, patch);
    });
  };

  const toggleFormat = (format: ExportForScreensFormat, enabled: boolean) => {
    const next = enabled
      ? [...settings.formats, format]
      : settings.formats.filter((entry) => entry !== format);
    update({ formats: next.length ? next : [format] });
  };

  return (
    <div style={{ padding: "4px 8px 8px" }}>
      <div className="monet-section-label">Export for Screens</div>
      <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4, gap: 8 }}>
        <span style={{ fontSize: 11 }}>Target</span>
        <Select
          size="sm"
          data-export-field="target"
          value={settings.target}
          onChange={(v) => update({ target: v as typeof settings.target })}
          style={{ width: 148 }}
          options={[
            { value: "artboards-and-slices", label: "Artboards + Slices" },
            { value: "artboards", label: "Artboards" },
            { value: "slices", label: "Slices" },
          ]}
        />
      </div>
      <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4, gap: 8 }}>
        <span style={{ fontSize: 11 }}>Scale</span>
        <input
          data-export-field="scale"
          type="number"
          min={0.01}
          max={100}
          step={0.25}
          value={settings.scale}
          onChange={(event) => update({ scale: Number(event.currentTarget.value) })}
          style={{ ...fieldStyle, width: 70 }}
        />
      </div>
      <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4, gap: 8 }}>
        <span style={{ fontSize: 11 }}>Base Name</span>
        <input
          data-export-field="base-name"
          value={settings.baseName ?? ""}
          placeholder={doc.name}
          onChange={(event) => update({ baseName: event.currentTarget.value })}
          style={{ ...fieldStyle, width: 148 }}
        />
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Formats</div>
      {EXPORT_FOR_SCREENS_FORMATS.map((format) => (
        <FormatRow
          key={format}
          format={format}
          checked={settings.formats.includes(format)}
          onChange={(value) => toggleFormat(format, value)}
        />
      ))}

      <div className="monet-section-label" style={{ marginTop: 8 }}>Manifest</div>
      <Row label="Path" value={manifest.manifestPath} attr="manifest-path" />
      <Row label="Targets" value={manifest.entries.length} attr="targets" />
      <Row label="Files" value={files.length} attr="files" />
      <Row label="Supported" value={supported} attr="supported-files" />
      <Row label="Planned" value={planned} attr="planned-files" />
      {previewFiles.length > 0 && (
        <div data-export="preview-files" style={{ marginTop: 4, fontSize: 10, color: "var(--text-3)", overflowWrap: "anywhere" }}>
          {previewFiles.map((file) => file.filename).join(" · ")}
        </div>
      )}
      {manifest.issues.length > 0 && (
        <div data-export="issues" style={{ marginTop: 6, fontSize: 10, color: "var(--text-3)" }}>
          {manifest.issues.map((issue) => issue.message).join(" · ")}
        </div>
      )}
    </div>
  );
}
