// Image ▸ Analysis ▸ Measurement Log ▸ Export — Photoshop writes the log as
// tab-delimited text, which is what spreadsheets paste cleanly.
//
// Kept pure and engine-free so it is node-testable: the panel only has to hand it
// the rows, the visible columns and the scale unit.

/** One recorded row, as the store holds it. */
export interface MeasurementRow {
  n: number;
  lengthPx: number;
  lengthUnits: number;
  angle: number;
  count: number;
}

/** Which columns are shown — Image ▸ Analysis ▸ Select Data Points. */
export interface DataPointSelection {
  lengthPx: boolean;
  lengthUnits: boolean;
  angle: boolean;
  count: boolean;
}

/** A tab or newline in the unit would break the row apart in a spreadsheet. */
const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();

/** The log as tab-delimited text, honouring the SAME column selection the panel
 *  renders — exporting hidden columns would not match what the user sees.
 *  Returns "" when there is nothing recorded, so callers can skip writing a file. */
export function measurementLogText(
  rows: readonly MeasurementRow[],
  dataPoints: DataPointSelection,
  unit: string,
): string {
  if (rows.length === 0) return "";
  const columns: { header: string; value: (r: MeasurementRow) => string }[] = [
    { header: "#", value: (r) => String(r.n) },
  ];
  if (dataPoints.lengthPx) columns.push({ header: "Length (px)", value: (r) => String(r.lengthPx) });
  if (dataPoints.lengthUnits) {
    columns.push({ header: `Length (${clean(unit) || "units"})`, value: (r) => String(r.lengthUnits) });
  }
  if (dataPoints.angle) columns.push({ header: "Angle", value: (r) => String(r.angle) });
  if (dataPoints.count) columns.push({ header: "Count", value: (r) => String(r.count) });

  const lines = [columns.map((c) => c.header).join("\t")];
  for (const row of rows) lines.push(columns.map((c) => c.value(row)).join("\t"));
  return `${lines.join("\n")}\n`;
}
