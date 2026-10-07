// PrintDialog — Lightroom's Print module as a modal: a live WYSIWYG page
// preview (paginated, the same cells print.ts composes), the Layout / Image
// Settings / Page panels, a Template Browser (built-in + user templates, saved
// in localStorage like the Export presets) and Create Saved Print, which stores
// the selection as a collection *and* its layout under the same name so a print
// is reproducible between sessions. Geometry all lands in lib/printLayout.
// ponytail: still a modal rather than a left/right-panel module — the preview,
// templates and saved prints are the parity-relevant parts; promote to a real
// module shell when the Print panels need to live beside the grid.

import { Button, Checkbox, Dialog, Field, Input, NumberField, Select, Slider } from "@monet-ui/monet-react";
import { useState } from "react";

import type { PhotoRow } from "../catalog/types";
import {
  contactSheetCells,
  fromPx,
  gridForCount,
  marginSides,
  orientPage,
  picturePackageCells,
  printableBox,
  toPx,
  type Margins,
  type PageOrientation,
  type Rect,
  type Unit,
  PAGE_SIZES,
  PICTURE_PACKAGES,
  DPI,
} from "../lib/printLayout";
import { savedOutputMarker } from "../lib/savedOutput";
import type { WatermarkAnchor } from "../lib/watermark";
import {
  DEFAULT_PRINT_JOB,
  type ImageSettings,
  type PageSettings,
  type PhotoInfoToken,
  type PrintDestination,
  printContactSheet,
  printPhoto,
  printPicturePackage,
} from "../print";
import { store } from "../state/store";
import { PreviewImg } from "./PreviewImg";

type Layout = "single" | "contact" | "package";
type GridMode = "auto" | "fixed" | "cell";

const LAYOUT_OPTS = [
  { value: "single", label: "Single Image" },
  { value: "contact", label: "Contact Sheet" },
  { value: "package", label: "Picture Package" },
];
// LR's Print Job "Print To" — the printer path raises the system Print dialog
// (printer choice, copies, Page Setup, driver Print Settings all live there).
const DEST_OPTS = [
  { value: "printer", label: "Printer" },
  { value: "jpeg", label: "JPEG File" },
];
const PAGE_OPTS = Object.keys(PAGE_SIZES).map((k) => ({ value: k, label: k }));
const ORIENT_OPTS = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];
const UNIT_OPTS = [
  { value: "in", label: "Inches" },
  { value: "cm", label: "Centimeters" },
  { value: "px", label: "Pixels" },
];
const GRID_OPTS = [
  { value: "auto", label: "Auto (fit the selection)" },
  { value: "fixed", label: "Fixed rows × columns" },
  { value: "cell", label: "Fixed cell size" },
];
const PACKAGE_OPTS = Object.keys(PICTURE_PACKAGES).map((k) => ({ value: k, label: k }));

const MARGIN_SIDES: { key: keyof Margins; label: string }[] = [
  { key: "top", label: "Top margin" },
  { key: "bottom", label: "Bottom margin" },
  { key: "left", label: "Left margin" },
  { key: "right", label: "Right margin" },
];

// Same 3×3 grid the Export dialog's watermark uses.
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

// LR's Photo Info dropdown (the core tokens print.ts resolves).
const PHOTO_INFO_OPTS: { value: "none" | PhotoInfoToken; label: string }[] = [
  { value: "none", label: "None" },
  { value: "filename", label: "Filename" },
  { value: "date", label: "Date" },
  { value: "exposure", label: "Exposure" },
  { value: "caption", label: "Caption" },
];

// ─────────────────────────────────────────────────────────────
// The layout, as data — one serializable object (OUT-16)
// ─────────────────────────────────────────────────────────────

/** Every Print-dialog choice, flat and JSON-serializable: what a template
 *  stores and what a Saved Print reproduces. Lengths are in page px at DPI. */
export interface PrintConfig {
  layout: Layout;
  to: PrintDestination;
  pageName: string;
  orientation: PageOrientation;
  /** Ruler units — a display preference, kept so a template restores the feel. */
  unit: Unit;
  margin: Margins;
  gutter: number;
  gridMode: GridMode;
  rows: number;
  cols: number;
  cellW: number;
  cellH: number;
  pkg: string;
  /** JPEG quality 1–100 (the dialog's scale). */
  quality: number;
  zoomToFill: boolean;
  rotateToFit: boolean;
  repeatOne: boolean;
  strokeOn: boolean;
  strokePt: number;
  strokeColor: string;
  bg: string;
  plate: string;
  wmText: string;
  wmPos: WatermarkAnchor;
  wmOpacity: number;
  pageNumbers: boolean;
  pageInfo: boolean;
  cropMarks: boolean;
  infoToken: "none" | PhotoInfoToken;
  infoSize: number;
}

export const DEFAULT_PRINT_CONFIG: PrintConfig = {
  layout: "single",
  // Printer first: printing is the module's primary purpose (LR's default).
  to: "printer",
  pageName: "Letter",
  orientation: "portrait",
  unit: "in",
  margin: { top: 75, right: 75, bottom: 75, left: 75 },
  gutter: 30,
  gridMode: "auto",
  rows: 3,
  cols: 3,
  cellW: toPx(3.5, "in"),
  cellH: toPx(2.5, "in"),
  pkg: PACKAGE_OPTS[0].value,
  quality: 92,
  zoomToFill: false,
  rotateToFit: false,
  repeatOne: false,
  strokeOn: false,
  strokePt: 1,
  strokeColor: "#000000",
  bg: "#ffffff",
  plate: "",
  wmText: "",
  wmPos: "bottom-right",
  wmOpacity: 70,
  pageNumbers: false,
  pageInfo: false,
  cropMarks: false,
  infoToken: "none",
  infoSize: 10,
};

/** The oriented page size a config prints on. An unknown page name (a template
 *  from a build that had more sizes) falls back rather than throwing. */
export function pageSize(cfg: PrintConfig): { w: number; h: number } {
  return orientPage(PAGE_SIZES[cfg.pageName] ?? PAGE_SIZES.Letter, cfg.orientation);
}

function packageSizes(cfg: PrintConfig): { w: number; h: number }[] {
  const inches = PICTURE_PACKAGES[cfg.pkg] ?? PICTURE_PACKAGES[PACKAGE_OPTS[0].value];
  return inches.map((s) => ({ w: Math.round(s.w * DPI), h: Math.round(s.h * DPI) }));
}

// ─────────────────────────────────────────────────────────────
// Template Browser — built-ins + user templates
// ─────────────────────────────────────────────────────────────

export interface PrintTemplate {
  name: string;
  config: PrintConfig;
  /** Ships with the app: appears in the browser, cannot be deleted. */
  builtIn?: boolean;
}

/** LR's built-in template set, the shapes people actually reach for. */
const BUILT_INS: { name: string; config: Partial<PrintConfig> }[] = [
  { name: "Maximize Size", config: { layout: "single", margin: { top: 30, right: 30, bottom: 30, left: 30 } } },
  {
    name: "Fine Art Mat",
    config: { layout: "single", margin: { top: 450, right: 450, bottom: 600, left: 450 }, strokeOn: true },
  },
  { name: "2×2 Cells", config: { layout: "contact", gridMode: "fixed", rows: 2, cols: 2 } },
  { name: "4×5 Contact Sheet", config: { layout: "contact", gridMode: "fixed", rows: 5, cols: 4, gutter: 20 } },
  { name: "(1) 5×7 + (4) 2.5×3.5", config: { layout: "package", zoomToFill: true } },
];

/** The subset of the Web Storage API used here (so tests can inject a fake). */
export interface TemplateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const TEMPLATE_KEY = "galerie.printTemplates";

/** localStorage, or null where it's unavailable (SSR, locked-down contexts). */
function defaultStorage(): TemplateStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access itself can throw when storage is blocked
  }
}

/** User templates only, as stored. Missing/malformed storage → []. */
function readUser(storage: TemplateStorage | null): PrintTemplate[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(TEMPLATE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as PrintTemplate[])
      .filter((t) => t && typeof t.name === "string" && t.config != null)
      // Templates written by an older build miss the newer knobs; defaults fill in.
      .map((t) => ({ name: t.name, config: { ...DEFAULT_PRINT_CONFIG, ...t.config } }));
  } catch {
    return []; // corrupt JSON — behave as if there are no templates
  }
}

function writeUser(storage: TemplateStorage | null, list: PrintTemplate[]): void {
  try {
    storage?.setItem(TEMPLATE_KEY, JSON.stringify(list.map((t) => ({ name: t.name, config: t.config }))));
  } catch {
    // storage full / unavailable — the caller still gets the intended list
  }
}

/** The Template Browser's list: user templates first, then the built-ins they
 *  don't shadow, sorted by name. A user template named like a built-in wins —
 *  that's how "save over the built-in you tweaked" is expected to behave. */
export function listPrintTemplates(storage: TemplateStorage | null = defaultStorage()): PrintTemplate[] {
  const user = readUser(storage);
  const taken = new Set(user.map((t) => t.name));
  const built = BUILT_INS.filter((b) => !taken.has(b.name)).map(
    (b): PrintTemplate => ({ name: b.name, config: { ...DEFAULT_PRINT_CONFIG, ...b.config }, builtIn: true }),
  );
  return [...user, ...built].sort((a, b) => a.name.localeCompare(b.name));
}

/** Upsert a user template by name (trimmed); returns the updated browser list.
 *  Blank name or unavailable storage is a no-op that returns the current list. */
export function savePrintTemplate(
  name: string,
  config: PrintConfig,
  storage: TemplateStorage | null = defaultStorage(),
): PrintTemplate[] {
  const trimmed = name.trim();
  if (!trimmed || !storage) return listPrintTemplates(storage);
  writeUser(storage, [...readUser(storage).filter((t) => t.name !== trimmed), { name: trimmed, config }]);
  return listPrintTemplates(storage);
}

/** Remove a user template by name; built-ins are untouched. */
export function deletePrintTemplate(
  name: string,
  storage: TemplateStorage | null = defaultStorage(),
): PrintTemplate[] {
  if (storage) writeUser(storage, readUser(storage).filter((t) => t.name !== name));
  return listPrintTemplates(storage);
}

// ─────────────────────────────────────────────────────────────
// Live preview geometry
// ─────────────────────────────────────────────────────────────

/** One cell of a previewed page: where it sits, and which selected photo lands
 *  in it (an index into the selection). */
export interface PreviewCell {
  rect: Rect;
  photo: number;
}

/** The pages a config would compose for `count` photos, in page px. Mirrors
 *  print.ts's own pagination (grid shape, page batching, Repeat One Photo per
 *  Page) so the preview is the thing that prints.
 *  ponytail: that batching is duplicated — print.ts keeps it inside
 *  printContactSheet; hoist it to lib/printLayout when either side changes. */
export function previewPages(
  cfg: PrintConfig,
  count: number,
): { page: { w: number; h: number }; box: Rect; pages: PreviewCell[][] } {
  const page = pageSize(cfg);
  const box = printableBox(page.w, page.h, cfg.margin);
  const n = Math.max(1, count); // an empty selection still previews one page
  if (cfg.layout === "single") return { page, box, pages: [[{ rect: box, photo: 0 }]] };
  if (cfg.layout === "package") {
    const { cells } = picturePackageCells(page.w, page.h, cfg.margin, cfg.gutter, packageSizes(cfg));
    return { page, box, pages: [cells.map((rect) => ({ rect, photo: 0 }))] };
  }
  const m = marginSides(cfg.margin);
  const aspect = (page.w - m.left - m.right) / (page.h - m.top - m.bottom);
  const { rows, cols } = cfg.gridMode !== "auto" ? { rows: cfg.rows, cols: cfg.cols } : gridForCount(n, aspect);
  const cells = contactSheetCells(page.w, page.h, {
    rows,
    cols,
    margin: cfg.margin,
    gutter: cfg.gutter,
    cell: cfg.gridMode === "cell" ? { w: cfg.cellW, h: cfg.cellH } : undefined,
  });
  const per = cells.length;
  const pages = cfg.repeatOne
    ? Array.from({ length: n }, (_, p) => cells.map((rect) => ({ rect, photo: p })))
    : Array.from({ length: Math.ceil(n / per) }, (_, p) =>
        cells.slice(0, Math.min(per, n - p * per)).map((rect, i) => ({ rect, photo: p * per + i })),
      );
  return { page, box, pages };
}

const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(3)}%`;

/** The WYSIWYG page canvas: the page at its real aspect, the printable box as a
 *  guide, and each cell filled with its photo's cached preview honoring Zoom to
 *  Fill / Stroke Border. Paginates with the job.
 *  ponytail: geometry, background and stroke only — Rotate to Fit and the text
 *  overlays (identity plate, page numbers, watermark, Photo Info captions) are
 *  composed by print.ts at output resolution and are not mirrored here; draw
 *  them if users start mis-setting them blind. */
export function PrintPreview({ photos, cfg }: { photos: PhotoRow[]; cfg: PrintConfig }) {
  const [pageIndex, setPageIndex] = useState(0);
  const { page, box, pages } = previewPages(cfg, photos.length);
  // Clamp instead of syncing state: the layout can shrink under the viewer.
  const idx = Math.min(Math.max(0, pageIndex), pages.length - 1);
  const cells = pages[idx] ?? [];
  // Few cells = a big cell, so ask the thumbnail pipeline for more pixels.
  const edge = cells.length <= 2 ? 640 : 320;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "center", height: 260 }}>
        <div
          role="img"
          aria-label={`Print preview, page ${idx + 1} of ${pages.length}`}
          style={{
            position: "relative",
            height: "100%",
            aspectRatio: `${page.w} / ${page.h}`,
            background: cfg.bg,
            border: "1px solid var(--text-3)",
            boxSizing: "border-box",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: pct(box.x, page.w),
              top: pct(box.y, page.h),
              width: pct(box.w, page.w),
              height: pct(box.h, page.h),
              outline: "1px dashed var(--text-3)",
              opacity: 0.5,
              pointerEvents: "none",
            }}
          />
          {cells.map((c, i) => (
            <div
              key={i}
              data-print-cell=""
              style={{
                position: "absolute",
                left: pct(c.rect.x, page.w),
                top: pct(c.rect.y, page.h),
                width: pct(c.rect.w, page.w),
                height: pct(c.rect.h, page.h),
                boxSizing: "border-box",
                overflow: "hidden",
                border: cfg.strokeOn ? `1px solid ${cfg.strokeColor}` : undefined,
              }}
            >
              {photos[c.photo] && (
                <PreviewImg
                  photo={photos[c.photo]}
                  edge={edge}
                  style={{ width: "100%", height: "100%", objectFit: cfg.zoomToFill ? "cover" : "contain" }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      {pages.length > 1 && (
        <div className="gal-export-inline" style={{ justifyContent: "center", marginTop: 6 }}>
          <Button variant="ghost" size="sm" disabled={idx === 0} aria-label="Previous page" onClick={() => setPageIndex(idx - 1)}>
            ‹
          </Button>
          <span className="gal-modal-msg">{`Page ${idx + 1} of ${pages.length}`}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={idx >= pages.length - 1}
            aria-label="Next page"
            onClick={() => setPageIndex(idx + 1)}
          >
            ›
          </Button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Running a print
// ─────────────────────────────────────────────────────────────

/** One resolved print run — the dialog's state flattened to what print.ts needs. */
export interface PrintRun {
  layout: Layout;
  to: PrintDestination;
  page: { w: number; h: number };
  margin: Margins;
  gutter: number;
  /** JPEG quality 0–1 (ignored by printer jobs). */
  quality: number;
  grid?: { rows: number; cols: number };
  cell?: { w: number; h: number };
  /** Picture-package cell sizes in layout px. */
  sizes?: { w: number; h: number }[];
  /** Image Settings panel; omitted = print.ts defaults. */
  image?: ImageSettings;
  /** Page panel overlays; omitted = a plain white page. */
  decor?: PageSettings;
}

/** A config as print.ts wants it. Pure, so the template → print path is
 *  testable without a DOM (and so a Saved Print really replays its layout). */
export function configToRun(cfg: PrintConfig): PrintRun {
  return {
    layout: cfg.layout,
    to: cfg.to,
    page: pageSize(cfg),
    margin: cfg.margin,
    gutter: cfg.gutter,
    quality: cfg.quality / 100,
    grid: cfg.layout === "contact" && cfg.gridMode !== "auto" ? { rows: cfg.rows, cols: cfg.cols } : undefined,
    cell: cfg.layout === "contact" && cfg.gridMode === "cell" ? { w: cfg.cellW, h: cfg.cellH } : undefined,
    sizes: cfg.layout === "package" ? packageSizes(cfg) : undefined,
    image: {
      zoomToFill: cfg.zoomToFill,
      rotateToFit: cfg.rotateToFit,
      repeatOne: cfg.layout === "contact" && cfg.repeatOne,
      // Stroke width edited in points (LR), stored in layout px at 300 DPI.
      stroke: cfg.strokeOn
        ? { width: Math.max(1, Math.round((cfg.strokePt / 72) * DPI)), color: cfg.strokeColor }
        : null,
    },
    decor: {
      background: cfg.bg,
      identityPlate: cfg.plate.trim() || null,
      watermark: cfg.wmText.trim()
        ? { text: cfg.wmText.trim(), anchor: cfg.wmPos, opacity: cfg.wmOpacity / 100, sizePct: 4, insetPct: 2 }
        : null,
      pageNumbers: cfg.pageNumbers,
      pageInfo: cfg.pageInfo,
      cropMarks: cfg.cropMarks,
      photoInfo: cfg.infoToken !== "none" ? { token: cfg.infoToken, sizePt: cfg.infoSize } : null,
    },
  };
}

export type PrintOutcome =
  | { kind: "cancelled" } // save dialog dismissed — keep the print dialog open
  | { kind: "failed"; message: string }
  | { kind: "done"; toast: string };

/** Route one run to print.ts with the chosen destination. Hoisted out of the
 *  component so the Print To wiring is testable without a DOM (the dialog
 *  itself portals, so it never renders server-side). A printer job's `dest` is
 *  legitimately null — the spooler owns the output — so failure is `drawn`. */
export async function runPrint(photos: PhotoRow[], run: PrintRun): Promise<PrintOutcome> {
  const job = { ...DEFAULT_PRINT_JOB, to: run.to };
  const base = {
    page: run.page,
    margin: run.margin,
    quality: run.quality,
    job,
    image: run.image,
    decor: run.decor,
  };
  if (run.layout === "single") {
    const res = await printPhoto(photos[0], base);
    if (!res) return { kind: "cancelled" };
    return { kind: "done", toast: res.to === "printer" ? "Sent to printer." : "Printed to JPEG." };
  }
  if (run.layout === "contact") {
    const res = await printContactSheet(photos, {
      ...base,
      gutter: run.gutter,
      grid: run.grid,
      cell: run.cell,
    });
    if (!res) return { kind: "cancelled" };
    if (res.drawn === 0) {
      return { kind: "failed", message: `Contact sheet failed: all ${res.failed} photos could not be rendered.` };
    }
    return {
      kind: "done",
      toast:
        `Contact sheet: ${res.drawn} placed` +
        (res.pages > 1 ? ` on ${res.pages} pages` : "") +
        (res.failed ? ` · ${res.failed} failed` : "") +
        ".",
    };
  }
  const res = await printPicturePackage(photos[0], { ...base, gutter: run.gutter, sizes: run.sizes ?? [] });
  if (!res) return { kind: "cancelled" };
  if (res.drawn === 0) return { kind: "failed", message: "Picture package: no cells fit the page." };
  return {
    kind: "done",
    toast:
      res.dropped > 0
        ? `Printed picture package — ${res.dropped} cell${res.dropped === 1 ? "" : "s"} didn't fit`
        : "Printed picture package.",
  };
}

/** Create Saved Print: the selection becomes a collection and the layout is
 *  saved as a template under the same name, so reopening Print on that
 *  collection and picking its template reproduces the print. Returns the new
 *  template list, or null when the collection could not be created. */
export async function createSavedPrint(
  name: string,
  photos: PhotoRow[],
  cfg: PrintConfig,
): Promise<PrintTemplate[] | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Tagged as an output collection so the Collections panel shows it as a Saved
  // Print; the layout itself stays in the template store under the same name.
  const id = await store.createCollection(trimmed, "collection", savedOutputMarker("print", null));
  if (id == null) return null; // store already surfaced the failure
  await store.addToCollection(
    id,
    photos.map((p) => p.id),
  );
  return savePrintTemplate(trimmed, cfg);
}

export function PrintDialog({ photos, onClose }: { photos: PhotoRow[]; onClose: () => void }) {
  const [cfg, setCfg] = useState<PrintConfig>(() => ({
    ...DEFAULT_PRINT_CONFIG,
    layout: photos.length > 1 ? "contact" : "single",
  }));
  const [templates, setTemplates] = useState<PrintTemplate[]>(() => listPrintTemplates());
  const [selTpl, setSelTpl] = useState("");
  const [tplName, setTplName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Every edit goes through here, so picking a template and nudging a field are
  // the same kind of change and the preview simply re-derives.
  const set = <K extends keyof PrintConfig>(key: K, value: PrintConfig[K]) =>
    setCfg((c) => ({ ...c, [key]: value }));

  const step = cfg.unit === "px" ? 1 : 0.05;
  // A length field edited in `cfg.unit`, stored in px.
  const lengthField = (label: string, px: number, apply: (px: number) => void) => (
    <Field key={label} label={`${label} (${cfg.unit})`}>
      {(p) => (
        <NumberField
          {...p}
          min={0}
          step={step}
          value={fromPx(px, cfg.unit)}
          onChange={(v) => apply(toPx(Math.max(0, v), cfg.unit))}
        />
      )}
    </Field>
  );

  const doPrint = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await runPrint(photos, configToRun(cfg));
      if (out.kind === "cancelled") return;
      if (out.kind === "failed") {
        setMsg(out.message);
        return;
      }
      store.notify(out.toast);
      onClose();
    } catch (e) {
      setMsg(`Print failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doSavedPrint = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await createSavedPrint(savedName, photos, cfg);
      if (!next) {
        setMsg("Could not create the saved print.");
        return;
      }
      setTemplates(next);
      setSelTpl(savedName.trim());
      store.notify(`Saved print "${savedName.trim()}" created.`);
      setSavedName("");
    } catch (e) {
      setMsg(`Could not create the saved print: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const tplOpts = [{ value: "", label: "Custom…" }, ...templates.map((t) => ({ value: t.name, label: t.name }))];
  const selectedIsUser = templates.some((t) => t.name === selTpl && !t.builtIn);
  const needsOne = cfg.layout !== "contact";
  const disabled = busy || photos.length === 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Print"
      width={480}
      footer={
        <>
          {msg && <span className="gal-modal-msg">{msg}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={disabled} onClick={() => void doPrint()}>
            {busy ? "Printing…" : cfg.to === "printer" ? "Print…" : "Print to JPEG…"}
          </Button>
        </>
      }
    >
      <PrintPreview photos={photos} cfg={cfg} />

      <Field label="Template">
        {(p) => (
          <div className="gal-export-inline">
            <Select
              {...p}
              block
              options={tplOpts}
              value={selTpl}
              onChange={(name) => {
                setSelTpl(name);
                const t = templates.find((x) => x.name === name);
                if (t) setCfg(t.config);
              }}
            />
            {selectedIsUser && (
              <Button
                variant="ghost"
                size="sm"
                title="Delete template"
                onClick={() => {
                  setTemplates(deletePrintTemplate(selTpl));
                  setSelTpl("");
                }}
              >
                ×
              </Button>
            )}
          </div>
        )}
      </Field>

      <Field label="Save Template">
        {(p) => (
          <div className="gal-export-inline">
            <Input
              {...p}
              block
              value={tplName}
              placeholder="Template name"
              onChange={(e) => setTplName(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!tplName.trim()}
              onClick={() => {
                setTemplates(savePrintTemplate(tplName, cfg));
                setSelTpl(tplName.trim());
                setTplName("");
              }}
            >
              Save
            </Button>
          </div>
        )}
      </Field>

      <Field label="Saved Print" hint="Stores this selection as a collection with the layout above.">
        {(p) => (
          <div className="gal-export-inline">
            <Input
              {...p}
              block
              value={savedName}
              placeholder="Saved print name"
              onChange={(e) => setSavedName(e.target.value)}
            />
            <Button size="sm" disabled={disabled || !savedName.trim()} onClick={() => void doSavedPrint()}>
              Create
            </Button>
          </div>
        )}
      </Field>

      <Field label="Print to" hint={cfg.to === "printer" ? "Printer, copies and Print Settings are in the system dialog." : undefined}>
        {(p) => <Select {...p} block options={DEST_OPTS} value={cfg.to} onChange={(v) => set("to", v as PrintDestination)} />}
      </Field>

      <Field label="Layout" hint={needsOne && photos.length > 1 ? "Prints the first selected photo." : undefined}>
        {(p) => (
          <Select
            {...p}
            block
            options={LAYOUT_OPTS}
            value={cfg.layout}
            onChange={(v) =>
              // LR's Picture Package default is Zoom to Fill; it stays editable after.
              setCfg((c) => ({ ...c, layout: v as Layout, zoomToFill: v === "package" ? true : c.zoomToFill }))
            }
          />
        )}
      </Field>

      {cfg.layout === "package" && (
        <Field label="Package">
          {(p) => <Select {...p} block options={PACKAGE_OPTS} value={cfg.pkg} onChange={(v) => set("pkg", v)} />}
        </Field>
      )}

      <Field label="Page size">
        {(p) => <Select {...p} block options={PAGE_OPTS} value={cfg.pageName} onChange={(v) => set("pageName", v)} />}
      </Field>

      <Field label="Orientation">
        {(p) => (
          <Select
            {...p}
            block
            options={ORIENT_OPTS}
            value={cfg.orientation}
            onChange={(v) => set("orientation", v as PageOrientation)}
          />
        )}
      </Field>

      <Field label="Units">
        {(p) => <Select {...p} block options={UNIT_OPTS} value={cfg.unit} onChange={(v) => set("unit", v as Unit)} />}
      </Field>

      {MARGIN_SIDES.map((s) =>
        lengthField(s.label, cfg.margin[s.key], (px) => setCfg((c) => ({ ...c, margin: { ...c.margin, [s.key]: px } }))),
      )}

      {cfg.layout !== "single" && lengthField("Cell spacing", cfg.gutter, (px) => set("gutter", px))}

      {cfg.layout === "contact" && (
        <Field label="Grid">
          {(p) => <Select {...p} block options={GRID_OPTS} value={cfg.gridMode} onChange={(v) => set("gridMode", v as GridMode)} />}
        </Field>
      )}

      {cfg.layout === "contact" && cfg.gridMode !== "auto" && (
        <>
          <Field label="Rows">
            {(p) => <NumberField {...p} min={1} max={50} step={1} value={cfg.rows} onChange={(v) => set("rows", Math.max(1, Math.round(v)))} />}
          </Field>
          <Field label="Columns">
            {(p) => <NumberField {...p} min={1} max={50} step={1} value={cfg.cols} onChange={(v) => set("cols", Math.max(1, Math.round(v)))} />}
          </Field>
        </>
      )}

      {cfg.layout === "contact" && cfg.gridMode === "cell" && (
        <>
          {lengthField("Cell width", cfg.cellW, (px) => set("cellW", Math.max(1, px)))}
          {lengthField("Cell height", cfg.cellH, (px) => set("cellH", Math.max(1, px)))}
        </>
      )}

      {/* Image Settings (LR panel): how each photo sits in its cell. */}
      <Field label="Image Settings">
        {(p) => (
          <Checkbox {...p} checked={cfg.zoomToFill} onChange={(v) => set("zoomToFill", v)}>
            Zoom to Fill
          </Checkbox>
        )}
      </Field>
      <Field>
        {(p) => (
          <Checkbox {...p} checked={cfg.rotateToFit} onChange={(v) => set("rotateToFit", v)}>
            Rotate to Fit
          </Checkbox>
        )}
      </Field>
      {cfg.layout === "contact" && (
        <Field>
          {(p) => (
            <Checkbox {...p} checked={cfg.repeatOne} onChange={(v) => set("repeatOne", v)}>
              Repeat One Photo per Page
            </Checkbox>
          )}
        </Field>
      )}
      <Field>
        {(p) => (
          <div className="gal-export-inline">
            <Checkbox {...p} checked={cfg.strokeOn} onChange={(v) => set("strokeOn", v)}>
              Stroke Border
            </Checkbox>
            {cfg.strokeOn && (
              <>
                <NumberField
                  aria-label="Stroke border width in points"
                  min={1}
                  max={20}
                  step={1}
                  value={cfg.strokePt}
                  onChange={(v) => set("strokePt", Math.max(1, Math.round(v)))}
                />
                <input
                  type="color"
                  aria-label="Stroke border color"
                  value={cfg.strokeColor}
                  onChange={(e) => set("strokeColor", e.target.value)}
                />
              </>
            )}
          </div>
        )}
      </Field>

      {/* Page panel (LR): background + overlays composed onto the page. */}
      <Field label="Page Background Color">
        {(p) => <input {...p} type="color" value={cfg.bg} onChange={(e) => set("bg", e.target.value)} />}
      </Field>
      <Field label="Identity Plate">
        {(p) => <Input {...p} block value={cfg.plate} placeholder="Text (blank = off)" onChange={(e) => set("plate", e.target.value)} />}
      </Field>
      <Field label="Watermark">
        {(p) => <Input {...p} block value={cfg.wmText} placeholder="Text (blank = off)" onChange={(e) => set("wmText", e.target.value)} />}
      </Field>
      {cfg.wmText.trim() !== "" && (
        <>
          <Field label="Watermark position">
            {(p) => <Select {...p} block options={WM_POSITIONS} value={cfg.wmPos} onChange={(v) => set("wmPos", v as WatermarkAnchor)} />}
          </Field>
          <Field label={`Watermark opacity (${cfg.wmOpacity})`}>
            {(p) => <Slider {...p} min={0} max={100} step={1} value={cfg.wmOpacity} onChange={(v) => set("wmOpacity", Math.round(v))} />}
          </Field>
        </>
      )}
      <Field>
        {(p) => (
          <Checkbox {...p} checked={cfg.pageNumbers} onChange={(v) => set("pageNumbers", v)}>
            Page Numbers
          </Checkbox>
        )}
      </Field>
      <Field>
        {(p) => (
          <Checkbox {...p} checked={cfg.pageInfo} onChange={(v) => set("pageInfo", v)}>
            Page Info
          </Checkbox>
        )}
      </Field>
      <Field>
        {(p) => (
          <Checkbox {...p} checked={cfg.cropMarks} onChange={(v) => set("cropMarks", v)}>
            Crop Marks
          </Checkbox>
        )}
      </Field>
      <Field label="Photo Info">
        {(p) => (
          <div className="gal-export-inline">
            <Select
              {...p}
              block
              options={PHOTO_INFO_OPTS}
              value={cfg.infoToken}
              onChange={(v) => set("infoToken", v as "none" | PhotoInfoToken)}
            />
            {cfg.infoToken !== "none" && (
              <NumberField
                aria-label="Photo info font size in points"
                min={6}
                max={72}
                step={1}
                value={cfg.infoSize}
                onChange={(v) => set("infoSize", Math.max(6, Math.round(v)))}
              />
            )}
          </div>
        )}
      </Field>

      {cfg.to === "jpeg" && (
        <Field label={`Quality (${cfg.quality})`}>
          {(p) => <Slider {...p} min={1} max={100} step={1} value={cfg.quality} onChange={(v) => set("quality", Math.round(v))} />}
        </Field>
      )}
    </Dialog>
  );
}
