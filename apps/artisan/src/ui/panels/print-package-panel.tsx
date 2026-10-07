// ui/panels/print-package-panel - print setup and package summary

import { Select } from "@monet-ui/monet-react";
import { Ops, Query } from "../../engine";
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

type PrintPatch = Parameters<typeof Ops.Prepress.setPrintSettings>[1];

function Row({ label, value, attr }: { label: string; value: string | number; attr?: string }) {
  return (
    <div className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span data-print-package={attr}>{value}</span>
    </div>
  );
}

function CheckRow({ label, checked, attr, onChange }: { label: string; checked: boolean; attr: string; onChange: (value: boolean) => void }) {
  return (
    <label className="monet-row" style={{ justifyContent: "space-between", fontSize: 11, padding: "2px 0" }}>
      <span>{label}</span>
      <input
        data-print-field={attr}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        style={checkboxStyle}
      />
    </label>
  );
}

export function PrintPackagePanel() {
  const store = useStore();
  const { doc } = useEditorState();
  const report = Query.packageReport(doc);
  const print = report.printSettings;
  const bleed = Math.max(print.bleed.top, print.bleed.right, print.bleed.bottom, print.bleed.left);

  const updatePrint = (patch: PrintPatch) => {
    store.transact("Print Setup", (d) => {
      Ops.Prepress.setPrintSettings(d, patch);
    });
  };

  return (
    <div style={{ padding: "4px 8px 8px" }}>
      <div className="monet-section-label">Print Setup</div>
      <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4, gap: 8 }}>
        <span style={{ fontSize: 11 }}>Target</span>
        <Select
          size="sm"
          data-print-field="target"
          value={print.target}
          onChange={(v) => updatePrint({ target: v as PrintPatch["target"] })}
          style={{ width: 148 }}
          options={[
            { value: "active-artboard", label: "Active Artboard" },
            { value: "all-artboards", label: "All Artboards" },
            { value: "selection", label: "Selection" },
          ]}
        />
      </div>
      <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4, gap: 8 }}>
        <span style={{ fontSize: 11 }}>Page</span>
        <Select
          size="sm"
          data-print-field="page-size"
          value={print.pageSize}
          onChange={(v) => updatePrint({ pageSize: v as PrintPatch["pageSize"] })}
          style={{ width: 148 }}
          options={[
            { value: "artboard", label: "Artboard" },
            { value: "letter", label: "Letter" },
            { value: "a4", label: "A4" },
            { value: "custom", label: "Custom" },
          ]}
        />
      </div>
      <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4, gap: 8 }}>
        <span style={{ fontSize: 11 }}>Orientation</span>
        <Select
          size="sm"
          data-print-field="orientation"
          value={print.orientation}
          onChange={(v) => updatePrint({ orientation: v as PrintPatch["orientation"] })}
          style={{ width: 148 }}
          options={[
            { value: "auto", label: "Auto" },
            { value: "portrait", label: "Portrait" },
            { value: "landscape", label: "Landscape" },
          ]}
        />
      </div>
      <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4, gap: 8 }}>
        <span style={{ fontSize: 11 }}>Scale</span>
        <input
          data-print-field="scale"
          type="number"
          min={1}
          max={1000}
          step={1}
          value={Math.round(print.scale)}
          onChange={(event) => updatePrint({ scaleMode: "custom", scale: Number(event.currentTarget.value) })}
          style={{ ...fieldStyle, width: 70 }}
        />
      </div>
      <div className="monet-row" style={{ justifyContent: "space-between", marginTop: 4, gap: 8 }}>
        <span style={{ fontSize: 11 }}>Bleed</span>
        <input
          data-print-field="bleed"
          type="number"
          min={0}
          step={0.25}
          value={bleed}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            updatePrint({ bleed: { top: value, right: value, bottom: value, left: value } });
          }}
          style={{ ...fieldStyle, width: 70 }}
        />
      </div>

      <div className="monet-section-label" style={{ marginTop: 8 }}>Marks</div>
      <CheckRow label="Trim Marks" attr="trim-marks" checked={print.marks.trim} onChange={(value) => updatePrint({ marks: { trim: value } })} />
      <CheckRow label="Registration" attr="registration" checked={print.marks.registration} onChange={(value) => updatePrint({ marks: { registration: value } })} />
      <CheckRow label="Color Bars" attr="color-bars" checked={print.marks.colorBars} onChange={(value) => updatePrint({ marks: { colorBars: value } })} />
      <CheckRow label="Page Info" attr="page-info" checked={print.marks.pageInfo} onChange={(value) => updatePrint({ marks: { pageInfo: value } })} />

      <div className="monet-section-label" style={{ marginTop: 8 }}>Package</div>
      <Row label="Linked Assets" value={report.linkedAssets} attr="linked-assets" />
      <Row label="Embedded Assets" value={report.embeddedAssets} attr="embedded-assets" />
      <Row label="Missing Assets" value={report.missingAssets} attr="missing-assets" />
      <Row label="Fonts" value={report.fonts.length} attr="fonts" />
      <Row label="Missing Fonts" value={report.missingFonts.length} attr="missing-fonts" />
      <Row label="Spot Inks" value={report.spotInks} attr="spot-inks" />

      {report.warnings.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-3)" }} data-print-package="warnings">
          {report.warnings.join(" · ")}
        </div>
      )}
    </div>
  );
}
