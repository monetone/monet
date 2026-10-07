export interface DataVariable { layer: string; name: string; type: "text" | "vis" | "pixel"; fit?: "conform" }
export interface VariableData { variables: DataVariable[]; dataSets: Record<string, string>[]; dataSetBaseDir: string; activeDataSet: number }
export const emptyVariableData = (): VariableData => ({ variables: [], dataSets: [], dataSetBaseDir: "", activeDataSet: 0 });
export function normalizeVariableData(value: unknown): VariableData {
  const data = emptyVariableData();
  if (!value || typeof value !== "object") return data;
  const raw = value as Partial<VariableData>;
  if (Array.isArray(raw.variables)) data.variables = raw.variables.filter((v) => v && typeof v.layer === "string" && v.layer.length > 0 && typeof v.name === "string" && v.name.trim().length > 0 && ["text", "vis", "pixel"].includes(v.type)).slice(0, 1000).map((v) => ({ layer: v.layer, name: v.name.trim(), type: v.type, ...(v.type === "pixel" ? { fit: "conform" as const } : {}) }));
  if (Array.isArray(raw.dataSets)) data.dataSets = raw.dataSets.slice(0, 10000).filter((row) => row && typeof row === "object" && !Array.isArray(row) && Object.values(row).every((v) => typeof v === "string")).map((row) => ({ ...row }));
  if (typeof raw.dataSetBaseDir === "string") data.dataSetBaseDir = raw.dataSetBaseDir;
  if (Number.isInteger(raw.activeDataSet)) data.activeDataSet = Math.max(0, Math.min(data.dataSets.length - 1, raw.activeDataSet!));
  return data;
}
/** Quoted CSV cells preserve file paths containing commas and escaped quotes. */
export function parseVariableCsv(csv: string): Record<string, string>[] {
  if (csv.length > 8 * 1024 * 1024) throw new Error("Data sets CSV exceeds the 8 MiB limit.");
  const rows: string[][] = [], row: string[] = [];
  let cell = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n" || c === "\r")) {
      row.push(cell.trim()); cell = "";
      if (c !== ",") { if (row.some(Boolean)) rows.push(row.splice(0)); else row.length = 0; if (c === "\r" && csv[i + 1] === "\n") i++; }
    } else cell += c;
  }
  if (quoted) throw new Error("Data sets CSV has an unclosed quote.");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift();
  if (!headers?.length || headers.some((h) => !h) || new Set(headers).size !== headers.length) throw new Error("CSV needs unique, nonempty variable names in its header.");
  if (!rows.length || rows.length > 10000 || headers.length > 1000 || rows.some((r) => r.length !== headers.length)) throw new Error("CSV needs 1–10000 rows matching its header (at most 1000 columns).");
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}
export function variableImagePath(value: string, baseDir: string): string {
  const path = value.trim();
  if (!path || path.includes("\0") || /^[a-z][a-z\d+.-]*:\/\//i.test(path)) throw new Error("Pixel Replacement needs a local image file path.");
  if (/^(\/|[A-Za-z]:[\\/])/.test(path)) return path;
  if (!baseDir) throw new Error(`Use an absolute image path for “${path}”, or import a CSV beside the image in the desktop app.`);
  return `${baseDir}/${path}`;
}
