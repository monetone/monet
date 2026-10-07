// ─────────────────────────────────────────────────────────────
// batchIo.ts — pure helpers for File ▸ Automate ▸ Batch: the file-naming
// template, the source-folder scan, and the error log. IO stays in app.ts;
// everything here is injectable/synchronous so it unit-tests without Tauri.
// ─────────────────────────────────────────────────────────────

/** Default output name — serial avoids collisions across source folders. */
export const DEFAULT_BATCH_TEMPLATE = "{name}_{serial}_processed";

/** Files eligible when scanning a Source folder — the extensions of
 *  OPEN_ACCEPT plus the plain raster types it covers via "image/*". */
export const BATCH_SCAN_RE = /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|heic|heif|svg|tga|pnm|ppm|pgm|pbm|pcx|jp2|jpf|jpx|j2k|j2c|jpc|cin|dpx|sdpx|iff|ilbm|lbm|dcm|dc3|dic|dicom|pdf|psd|psb|xcf|cr2|cr3|nef|arw|dng|raf|rw2|orf|pef|srw|raw|rawps|nrw|mrw|dcr|mvision|artisan)$/i;

const pad2 = (n: number) => String(n).padStart(2, "0");
const pad3 = (n: number) => String(n).padStart(3, "0");

/** Expand the File Naming template for one output (extension appended by the
 *  caller). Tokens: {name} = source name without extension, {serial} = 3-digit
 *  serial, {date} = yyyymmdd. The result is a bare filename: path separators
 *  are stripped so a template can never escape the destination folder. */
export function expandBatchTemplate(template: string, docName: string, serial: number, now = new Date()): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const expanded = template
    .replaceAll("{name}", docName)
    .replaceAll("{serial}", pad3(serial))
    .replaceAll("{date}", date)
    .replace(/[/\\]/g, "_")
    .trim();
  return expanded || `Batch ${pad3(serial)}`;
}

/** Batch Destination: write to a Folder, write nothing, or save each file in place and close it. */
export type BatchDestination = "folder" | "none" | "saveAndClose";

/** Recorded action steps that write a file — what Override Action "Save As"
 *  Commands skips so only the Batch's own output is written. */
export const BATCH_SAVE_OPS: ReadonlySet<string> = new Set([
  "saveDocument", "saveDocumentAs", "saveDocumentAsCopy",
  "exportPNG", "exportJPEG", "exportPSD", "exportPSB", "exportAs",
]);

export const BATCH_SERIAL_ERROR = "Starting serial # must be a whole number of 0 or more — nothing was run.";

/** Starting serial #: blank means 1, otherwise a whole number of 0 or more.
 *  Returns null for anything else (negative, fractional, exponent, text). */
export function parseBatchSerial(value: unknown): number | null {
  if (value === undefined || (typeof value === "string" && !value.trim())) return 1;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
}

export interface BatchDirEntry { name: string; isDirectory: boolean; isFile: boolean }
export interface BatchDirReader { readDir(dir: string): Promise<BatchDirEntry[]> }

/** Depth-first scan of a Source folder for batchable files, in name order.
 *  Hidden entries (dotfiles, AppleDouble) are skipped; symlinked dirs are not
 *  followed (readDir reports them as neither file nor directory). */
export async function collectBatchFolder(dir: string, reader: BatchDirReader, includeSubfolders: boolean): Promise<string[]> {
  const out: string[] = [];
  const entries = [...await reader.readDir(dir)].sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory) {
      if (includeSubfolders) out.push(...await collectBatchFolder(`${dir}/${e.name}`, reader, true));
    } else if (e.isFile && BATCH_SCAN_RE.test(e.name)) {
      out.push(`${dir}/${e.name}`);
    }
  }
  return out;
}

export interface BatchError { name: string; message: string }

/** Photoshop-style "Batch Log" text written beside the outputs on failure. */
export function formatBatchLog(errors: BatchError[]): string {
  return [`Batch: ${errors.length} file(s) could not be processed.`, ...errors.map((e) => `${e.name}: ${e.message}`), ""].join("\n");
}

/** What a finished run shows: "Processed n of N", with the names it finished,
 *  and the first failure. The Batch dialog and a droplet run share it. */
export function batchSummary(
  result: { processed: number; errors: BatchError[]; completed: string[]; cancelled: boolean },
  total: number,
): { status: string; error?: string } {
  const names = result.completed.slice(0, 5).join(", ") + (result.completed.length > 5 ? ", …" : "");
  const failed = result.errors[0];
  return {
    status: `Processed ${result.processed} of ${total}${result.cancelled ? " — cancelled" : ""}${names ? `: ${names}` : ""}`,
    error: failed && `${result.errors.length} failed — ${failed.name}: ${failed.message}`,
  };
}

/** File ▸ Automate ▸ Create Droplet's descriptor (#469): a saved action and the
 *  Batch settings to run it with over whatever is dropped on the droplet. */
export interface DropletDescriptor {
  actionId?: number;
  /** The action's NAME. A droplet is a file the user keeps for months, and the
   *  runtime id is rebuilt from list position on every launch — so the name is
   *  what actually resolves, and the id is only a fallback for droplets written
   *  before this field existed (#494). */
  actionName?: string;
  format: "png" | "jpeg" | "tiff";
  template: string;
  destDir?: string;
  stopOnError: boolean;
}

/** A descriptor is a few hundred bytes; anything bigger is some other JSON. */
export const DROPLET_MAX_BYTES = 64 * 1024;

/** The descriptor in `text`, or null when it isn't one. The shape decides, not
 *  the .json extension, so other JSON still opens as a document. src-tauri's
 *  droplet.rs applies the same rule for the command line (at most one UTF-8
 *  byte order mark, a whole-number actionId); src-tauri/fixtures/
 *  droplet-shapes.json holds both to it. */
export function parseDroplet(text: string | null | undefined): DropletDescriptor | null {
  let value: unknown;
  try { value = JSON.parse((text ?? "").replace(/^\uFEFF/, "")); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const d = value as Record<string, unknown>;
  const actionName = typeof d.actionName === "string" ? d.actionName : undefined;
  const actionId = Number.isInteger(d.actionId) ? d.actionId as number : undefined;
  if (typeof d.template !== "string" || typeof d.stopOnError !== "boolean"
    || (d.format !== "png" && d.format !== "jpeg" && d.format !== "tiff")
    || (actionName === undefined && actionId === undefined)) return null;
  return {
    actionId, actionName, format: d.format, template: d.template,
    destDir: typeof d.destDir === "string" ? d.destDir : undefined, stopOnError: d.stopOnError,
  };
}

/** The droplet's name for its progress dialog: the droplet app's, for the
 *  descriptor inside one, else the file's. */
export function dropletName(path: string): string {
  const app = /([^/\\]+)\.app[/\\]Contents[/\\]Resources[/\\][^/\\]+$/i.exec(path);
  return app ? app[1] : path.replace(/^.*[/\\]/, "").replace(/\.json$/i, "");
}

/** A drop or an OS open that includes a droplet (#469): the first descriptor
 *  among `items`, and everything else as its inputs. Null when there is none —
 *  then the items open as documents. Only .json items are read. */
export async function findDroplet<T>(
  items: T[],
  nameOf: (item: T) => string,
  read: (item: T) => Promise<string>,
): Promise<{ droplet: DropletDescriptor; name: string; inputs: T[] } | null> {
  for (const [index, item] of items.entries()) {
    if (!/\.json$/i.test(nameOf(item))) continue;
    const droplet = parseDroplet(await read(item).catch(() => null));
    if (droplet) return { droplet, name: dropletName(nameOf(item)), inputs: items.filter((_, i) => i !== index) };
  }
  return null;
}
