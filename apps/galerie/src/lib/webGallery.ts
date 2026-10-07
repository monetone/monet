// webGallery — build a self-contained static HTML gallery page (LR's Web
// module). Pure string builder (unit-tested); the image files are written
// alongside by export.ts. Options mirror LR's panels: Layout Style (template),
// Site Info, Color Palette, Appearance, Image Info, Output Settings. No
// external assets; export.ts owns writing, App.tsx owns the dialog.
//
// ponytail: Export-to-folder only — LR's Upload Settings (named FTP server
// presets + an Upload button) is *not* a cloud-ecosystem non-goal (the server
// is the user's own box, README.md's standing policy doesn't cover it), it is
// blocked on plumbing that does not exist yet in this app: FTP is raw TCP, so
// it needs a native client (`suppaftp` in src-tauri) behind a Tauri command,
// its permission in capabilities/default.json, and — because a preset carries
// a password — somewhere to keep that password that isn't the plaintext
// catalog (no keyring/stronghold dep exists anywhere in the monorepo yet).
// Land those three first; the preset model and the Upload button are then a
// small dialog change over the folder that this module + export.ts already
// produce. Until then, the exported folder uploads with any FTP client.

import type { WatermarkSpecEx } from "./exportImage";
import type { MetadataScope } from "./exportMetadata";
import type { SharpenSpec } from "./outputSharpen";

export interface GalleryItem {
  /** Image filename, relative to the gallery's images/ dir. */
  file: string;
  title: string;
  /** Caption (IPTC description) — shown when Image Info = caption. */
  caption?: string;
}

/** LR's Site Info panel. Empty strings render nothing. */
export interface GallerySiteInfo {
  siteTitle: string;
  /** Collection title; empty falls back to the `title` argument. */
  collectionTitle: string;
  description: string;
  contactName: string;
  /** Web or Mail Link — `https://…` / `http://…` / `mailto:…` only; anything
   *  else renders the contact as plain text (no javascript: injection). */
  contactLink: string;
}

/** LR's Color Palette panel. Values are CSS colors, sanitized at render. */
export interface GalleryPalette {
  background: string;
  text: string;
  /** Detail text — captions, description, contact line. */
  detail: string;
  /** Links + site-title accent. */
  accent: string;
  /** Drives `color-scheme` so form controls/scrollbars match. */
  scheme: "dark" | "light";
}

/** LR's Appearance panel (Grid Pages sizing). */
export interface GalleryAppearance {
  /** Fixed column count (1–12); 0 = responsive auto-fill at `minCellPx`. */
  columns: number;
  /** Thumbnail cell image height, px. */
  cellHeightPx: number;
  /** Minimum cell width for the responsive auto-fill grid, px. */
  minCellPx: number;
  /** cover = LR Grid crop-to-fill; contain = Classic letterbox. */
  fit: "cover" | "contain";
}

/** LR's Image Info panel: which token labels each thumbnail. */
export type GalleryImageInfo = "title" | "caption" | "none";

/** LR's Output Settings panel — consumed by export.ts when encoding the large
 *  images, carried here so one object holds the whole Web dialog state. Field
 *  names match ExportOptions so it spreads straight in (see galleryExportOpts). */
export interface GalleryOutputSettings {
  /** Large-image JPEG quality, 0–1. */
  quality: number;
  /** Large-image long edge, px. */
  longEdge: number;
  sharpen: SharpenSpec | null;
  /** A saved watermark's spec (the named list Export/Print/Slideshow share), so
   *  a graphic watermark works on the Web output too; null = off. */
  watermark: WatermarkSpecEx | null;
  /** null = LR's default, everything. */
  metadata: MetadataScope | null;
}

export interface WebGalleryOptions {
  site: GallerySiteInfo;
  palette: GalleryPalette;
  appearance: GalleryAppearance;
  imageInfo: GalleryImageInfo;
  output: GalleryOutputSettings;
}

/** LR's Layout Style / Template Browser: named palette+appearance bundles. */
export interface WebGalleryTemplate {
  id: string;
  name: string;
  palette: GalleryPalette;
  appearance: GalleryAppearance;
}

const CHARCOAL: GalleryPalette = {
  background: "#111",
  text: "#eee",
  detail: "#aaa",
  accent: "#7ab8ff",
  scheme: "dark",
};

export const WEB_GALLERY_TEMPLATES: WebGalleryTemplate[] = [
  {
    id: "grid-dark",
    name: "Grid (Charcoal)",
    palette: CHARCOAL,
    appearance: { columns: 0, cellHeightPx: 200, minCellPx: 220, fit: "cover" },
  },
  {
    id: "square-dark",
    name: "Square (Charcoal)",
    palette: CHARCOAL,
    appearance: { columns: 0, cellHeightPx: 220, minCellPx: 220, fit: "cover" },
  },
  {
    id: "classic-light",
    name: "Classic (Paper)",
    palette: { background: "#f6f5f2", text: "#222", detail: "#666", accent: "#245a8d", scheme: "light" },
    appearance: { columns: 3, cellHeightPx: 260, minCellPx: 220, fit: "contain" },
  },
];

export const DEFAULT_WEB_GALLERY_OPTIONS: WebGalleryOptions = {
  site: { siteTitle: "", collectionTitle: "", description: "", contactName: "", contactLink: "" },
  palette: WEB_GALLERY_TEMPLATES[0].palette,
  appearance: WEB_GALLERY_TEMPLATES[0].appearance,
  imageInfo: "title",
  // Matches the pre-dialog hardcodes so an unconfigured export is unchanged.
  output: { quality: 0.85, longEdge: 2048, sharpen: null, watermark: null, metadata: null },
};

/** Selecting a template replaces look (palette+appearance), keeps content. */
export function applyGalleryTemplate(o: WebGalleryOptions, t: WebGalleryTemplate): WebGalleryOptions {
  return { ...o, palette: t.palette, appearance: t.appearance };
}

/** Output Settings → the ExportOptions fields export.ts feeds the encoder. */
export function galleryExportOpts(o: WebGalleryOptions): {
  format: "jpeg";
  quality: number;
  longEdge: number;
  sharpen: SharpenSpec | null;
  watermark: WatermarkSpecEx | null;
  metadata: MetadataScope | null;
} {
  const { quality, longEdge, sharpen, watermark, metadata } = o.output;
  return { format: "jpeg", quality, longEdge, sharpen, watermark, metadata };
}

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

/** Palette values land inside a <style> block — reject anything that could
 *  close it or smuggle a declaration; fall back to the template default. */
function cssColor(v: string, fallback: string): string {
  return /^[#a-zA-Z0-9(),.% -]+$/.test(v.trim()) && v.trim() !== "" ? v.trim() : fallback;
}

/** Only real web/mail links become hrefs (trust boundary: published HTML). */
function safeHref(v: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(v.trim()) ? v.trim() : null;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo;

function cellLabel(it: GalleryItem, info: GalleryImageInfo): string {
  if (info === "title") return it.title;
  if (info === "caption") return it.caption ?? "";
  return "";
}

export function galleryHtml(
  title: string,
  items: GalleryItem[],
  opts: WebGalleryOptions = DEFAULT_WEB_GALLERY_OPTIONS,
): string {
  const { site, imageInfo } = opts;
  const pal = opts.palette;
  const bg = cssColor(pal.background, CHARCOAL.background);
  const fg = cssColor(pal.text, CHARCOAL.text);
  const detail = cssColor(pal.detail, CHARCOAL.detail);
  const accent = cssColor(pal.accent, CHARCOAL.accent);

  const cols = clamp(opts.appearance.columns, 0, 12);
  const cellH = clamp(opts.appearance.cellHeightPx, 40, 2000);
  const minCell = clamp(opts.appearance.minCellPx, 80, 1000);
  const gridCols = cols > 0 ? `repeat(${cols}, 1fr)` : `repeat(auto-fill, minmax(${minCell}px, 1fr))`;
  const fit = opts.appearance.fit === "contain" ? "contain" : "cover";

  const collection = site.collectionTitle.trim() || title;
  const contactHref = safeHref(site.contactLink);
  const contactText = site.contactName.trim() || site.contactLink.trim();
  const head: string[] = [];
  if (site.siteTitle.trim()) head.push(`<div class="site">${esc(site.siteTitle.trim())}</div>`);
  head.push(`<h1>${esc(collection)}</h1>`);
  if (site.description.trim()) head.push(`<p class="desc">${esc(site.description.trim())}</p>`);
  if (contactText) {
    head.push(
      contactHref
        ? `<p class="contact"><a href="${esc(contactHref)}">${esc(contactText)}</a></p>`
        : `<p class="contact">${esc(contactText)}</p>`,
    );
  }

  const cells = items
    .map((it) => {
      const href = `images/${encodeURIComponent(it.file)}`;
      const label = cellLabel(it, imageInfo);
      const span = label ? `<span>${esc(label)}</span>` : "";
      return `<a class="cell" href="${href}"><img src="${href}" alt="${esc(it.title)}" loading="lazy">${span}</a>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(collection)}</title>
<style>
  :root { color-scheme: ${pal.scheme === "light" ? "light" : "dark"}; }
  body { margin: 0; background: ${bg}; color: ${fg}; font: 14px system-ui, sans-serif; }
  header { padding: 20px 20px 0; }
  .site { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: ${accent}; }
  h1 { margin: 4px 0 0; font-size: 18px; font-weight: 600; }
  .desc { margin: 8px 0 0; max-width: 60ch; color: ${detail}; }
  .contact { margin: 4px 0 0; font-size: 12px; color: ${detail}; }
  a { color: ${accent}; }
  .grid { display: grid; grid-template-columns: ${gridCols}; gap: 12px; padding: 20px 20px 40px; }
  .cell { display: block; text-decoration: none; color: inherit; }
  .cell img { width: 100%; height: ${cellH}px; object-fit: ${fit}; border-radius: 6px; background: #000; display: block; }
  .cell span { display: block; margin-top: 6px; font-size: 12px; color: ${detail}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>
<header>
${head.join("\n")}
</header>
<div class="grid">
${cells}
</div>
</body>
</html>
`;
}
