// Turns the Photoshop blueprint (psMenuData.ts) into the live Monet menu bar.
// Every blueprint item that carries a `monetId` we actually implement is wired
// to its action; everything else Photoshop has becomes a disabled placeholder,
// so the bar matches Photoshop item-for-item. The same MenuBarEntry[] feeds both
// the in-window Monet menu and the native macOS NSMenu (see native/macMenu.ts).
import type { MenuBarEntry, MenuItemDef } from "@monet-ui/monet-react";
import { PS_MENUS, type PsNode } from "./psMenuData";
import { FONT_PREVIEW_CHOICES } from "../state/fontPreview";
import type { PixelAspectPreset } from "../state/pixelAspect";
import type { MeasureScale, MeasureScalePreset } from "../state/measureScale";

/** Stable, readable id from a label, for placeholder items + submenus. */
function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "item";
}

/** Wire blueprint items whose generated `monetId` is missing or ambiguous to a
 *  Monet command by label, so we don't hand-edit the generated blueprint. */
const LABEL_WIRING: Record<string, string> = {
  "Notes…": "importnotes",
  "Place Linked…": "placelinked",
  "Package…": "packagefile",
  "Photomerge…": "photomerge",
  "Sky": "sky",
  "Layer Comps to Files…": "layercompstofiles",
  "Check Spelling…": "checkspelling",
  "Internet Standard RGB (sRGB)": "proofsrgb",
  "Monitor RGB": "proofmonitor",
  "Layer Content Options…": "layercontentoptions",
  "Fill Content": "rasterizefillcontent",
  // View ▸ 32-bit Preview Options… — how a float (32 bits/channel) document is
  // tone-mapped for the SDR canvas. The blueprint ships it without a monetId.
  "32-bit Preview Options…": "hdrpreview",
  // File ▸ Automate ▸ Create Droplet… (bakes Batch settings into a droppable
  // file) and File ▸ Scripts ▸ Script Events Manager… (binds actions/scripts to
  // app events). Both ship without a monetId, so without a row here psMenus can
  // never reach a host action and they stay permanent placeholders.
  "Create Droplet…": "createdroplet",
  "Script Events Manager…": "scripteventsmanager",
  // File ▸ Scripts ▸ Load Multiple DICOM Files… (#466) ships without one too.
  "Load Multiple DICOM Files…": "loaddicom",
  // Type ▸ Language Options ▸ East Asian / Indic Features — the two feature
  // families beside Middle Eastern (whose commands, direction/digits/kashidas/
  // diacritics, Monet does implement). Both ship without a monetId, so like the
  // two rows above they are unreachable by construction until wired here.
  // East Asian Features toggles spec.eastAsian (App.tsx, #455).
  // ponytail: Indic is menu-layer half only — Monet's composer has no Indic
  // reordering, so it stays a disabled placeholder until wrapPara grows an
  // Indic branch and App.tsx registers `langindic`.
  "East Asian Features": "langeastasian",
  "Indic Features": "langindic",
};

/** Exact menu locations that intentionally expose the same Monet command.
 *  Other duplicate blueprint ids stay first-wins because they represent
 *  different scopes (for example File vs Layer export). */
const SHARED_ACTION_PATHS = new Set([
  "File ▸ Automate ▸ Lens Correction…",
  "Filter ▸ Lens Correction…",
  "File ▸ Scripts ▸ Layer Cleanup…",
  "Layer ▸ Layer Cleanup…",
  "Layer ▸ Smart Objects ▸ Rasterize",
  "Layer ▸ Rasterize ▸ Smart Object",
  // Photoshop's two doors into the one Keyboard Shortcuts and Menus dialog.
  "Edit ▸ Menus…",
  // Same command as Edit ▸ Perspective Warp. The Transform submenu copy was
  // dropped by first-wins because both blueprint rows share monetId "persp".
  "Edit ▸ Transform ▸ Perspective",
  // Same command as View ▸ Show ▸ Guides. Artboard Guides stays first-wins:
  // it is a different scope, not a second door onto canvas guides.
  "View ▸ Show ▸ Canvas Guides",
  // Same command as View ▸ Clear Guides. Clear Selected Artboard Guides stays
  // first-wins for the same reason.
  "View ▸ Clear Canvas Guides",
]);

const PATH_WIRING: Record<string, string> = {
  // The blueprint ships both HDR merges as "hdr", but they are two different
  // commands: Image ▸ Merge to HDR (Exposure Fusion) blends the bracket into an
  // LDR frame, while Merge to HDR Pro recovers the camera response and leaves a
  // 32-bit radiance document. Without this row the Pro entry would be a second
  // door onto exposure fusion.
  "File ▸ Automate ▸ Merge to HDR Pro…": "hdrpro",
  "Edit ▸ Keyboard Shortcuts…": "keyboardshortcuts",
  // Edit ▸ Menus… is the same "Keyboard Shortcuts and Menus" dialog Photoshop
  // opens from Keyboard Shortcuts…, on its Menus tab. The blueprint ships both
  // (and Toolbar…) with monetId "prefgeneral", which is a different command —
  // hence the explicit paths here.
  "Edit ▸ Menus…": "keyboardshortcuts",
  // Toolbar customization is separate from General Preferences.
  "Edit ▸ Toolbar…": "customizetoolbar",
  "Layer ▸ Export As…": "layerexportas",
  "Filter ▸ Distort ▸ Pinch…": "dpinch",
  // Type ▸ OpenType advanced features for editable type. Wired by full path
  // because the "Set 1"…"Set 20" labels are not collision-safe for LABEL_WIRING.
  // Each id doubles as the CSS feature tag (see state/app.ts toggleFeature).
  "Type ▸ OpenType ▸ Contextual Alternates": "calt",
  "Type ▸ OpenType ▸ Swash": "swsh",
  "Type ▸ OpenType ▸ Oldstyle": "onum",
  "Type ▸ OpenType ▸ Stylistic Alternates": "salt",
  "Type ▸ OpenType ▸ Titling Alternates": "titl",
  "Type ▸ OpenType ▸ Justification Alternates": "jalt",
};
for (let i = 1; i <= 20; i++) {
  PATH_WIRING[`Type ▸ OpenType ▸ Stylistic Sets ▸ Set ${i}`] = `ss${String(i).padStart(2, "0")}`;
}

/**
 * Build the menu bar from the Photoshop blueprint, wiring Monet actions by id.
 * `actions` maps a blueprint `monetId` to the handler to run; ids absent from
 * the map (commands Monet doesn't implement), or false in `enablement`, render
 * as disabled placeholders.
 */
/** Window ▸ Workspace + panel management. Photoshop's blueprint (psMenuData.ts)
 *  has no Window menu, so it's appended here rather than hand-editing the
 *  auto-generated blueprint. */
export interface WindowMenuConfig {
  /** Named layouts, built-ins first. Built-ins can't be deleted, so Delete
   *  Workspace… only appears once the user has saved one of their own. */
  workspaces: { name: string; builtin?: boolean }[];
  onApplyWorkspace: (name: string) => void;
  panels?: { id: string; title: string }[];
  /** Panels currently present in the dock layout — drives the checkmarks. */
  openPanelIds?: ReadonlySet<string>;
  /** Toggle a panel: open it if closed, close it if open (Photoshop behavior). */
  onOpenPanel?: (id: string) => void;
  /** Open documents, bottom of the menu; the active one is checkmarked. */
  documents?: { id: string; name: string }[];
  activeDocumentId?: string;
  onActivateDocument?: (id: string) => void;
}

// ── Edit ▸ Menus… — per-command menu visibility ────────────────
// Photoshop's Menus tab hides individual commands from the bar and saves the
// set into a workspace. Commands are keyed by their full menu path ("Edit ▸
// Transform ▸ Scale") rather than by item id: blueprint monetIds repeat across
// menus (Menus…/Toolbar… both ship as "prefgeneral"), so an id-keyed set would
// hide unrelated commands.
const HIDDEN_MENUS_KEY = "mv.hiddenMenuCommands";
export const NO_HIDDEN: ReadonlySet<string> = new Set();

export function loadHiddenMenuCommands(): ReadonlySet<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HIDDEN_MENUS_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []);
  } catch { return NO_HIDDEN; }
}

export function saveHiddenMenuCommands(hidden: ReadonlySet<string>): void {
  try { localStorage.setItem(HIDDEN_MENUS_KEY, JSON.stringify([...hidden])); } catch { /* storage denied */ }
}

/** Drop the hidden commands, then tidy the separator runs they leave behind.
 *  A submenu whose every child went hidden goes too — it would open onto
 *  nothing. */
function pruneHidden(items: MenuItemDef[], hidden: ReadonlySet<string>, path: string): MenuItemDef[] {
  const kept: MenuItemDef[] = [];
  for (const item of items) {
    if (item.separator) {
      if (kept.length && !kept[kept.length - 1].separator) kept.push(item);
      continue;
    }
    const at = `${path} ▸ ${String(item.label)}`;
    if (hidden.has(at)) continue;
    if (item.items) {
      const inner = pruneHidden(item.items, hidden, at);
      if (inner.length) kept.push({ ...item, items: inner });
      continue;
    }
    kept.push(item);
  }
  while (kept.length && kept[kept.length - 1].separator) kept.pop();
  return kept;
}

/** Every command the Menus tab can hide, as `{ path }` in bar order. Built from
 *  an action-less, nothing-hidden menu tree — the labels don't depend on the
 *  action map, and listing from the *unfiltered* tree is what keeps an already
 *  hidden command reachable (otherwise hiding one would strand it). */
export function listMenuCommands(): { path: string; depth: number }[] {
  const out: { path: string; depth: number }[] = [];
  const walk = (items: MenuItemDef[], path: string, depth: number) => {
    for (const item of items) {
      if (item.separator) continue;
      const at = `${path} ▸ ${String(item.label)}`;
      out.push({ path: at, depth });
      if (item.items) walk(item.items, at, depth + 1);
    }
  };
  const bar = buildPhotoshopMenus({}, [], () => {}, undefined, undefined, undefined, new Set(), false, NO_HIDDEN);
  for (const menu of bar) walk(menu.items, String(menu.label), 0);
  return out;
}

export interface PixelAspectMenuConfig {
  presets: readonly PixelAspectPreset[];
  currentRatio: number;
  onSelect: (ratio: number) => void;
}

export interface MeasurementScaleMenuConfig {
  presets: readonly MeasureScalePreset[];
  currentScale: MeasureScale;
  onSelect: (scale: MeasureScale) => void;
}

/** Image ▸ Mode's checkmarks, as Photoshop shows them: the document's colour
 *  mode (Duotone rather than Grayscale while duotone inks are set) and its
 *  bit depth. */
export function imageModeCheckedIds(mode: number, depth: number, duotone: boolean): string[] {
  const modeId = mode === 1 && duotone ? "duotone" : ["mrgb", "mgray", "mcmyk", "mlab", "mmultichannel"][mode];
  return [...(modeId ? [modeId] : []), `d${depth}`];
}

/** Edit ▸ Undo names the step it will reverse ("Undo Brush"). An empty label
 *  leaves the blueprint title alone. Only the exact item "Undo" is renamed. */
export function nameUndoItem(items: { label?: unknown; items?: unknown[] }[], undoLabel: string): void {
  if (!undoLabel) return;
  const titled = `Undo ${undoLabel}`;
  const walk = (list: { label?: unknown; items?: unknown[] }[]) => {
    for (const item of list) {
      if (item.label === "Undo") item.label = titled;
      if (Array.isArray(item.items)) walk(item.items);
    }
  };
  walk(items);
}

export function buildPhotoshopMenus(
  registeredActions: Record<string, () => void>,
  recent: { name: string; path: string }[] = [],
  onOpenRecent: (path: string) => void = () => {},
  windowMenu?: WindowMenuConfig,
  pixelAspectMenu?: PixelAspectMenuConfig,
  measurementScaleMenu?: MeasurementScaleMenuConfig,
  checkedIds: Set<string> = new Set(),
  photoshopOriginalAvailable = false,
  hidden: ReadonlySet<string> = loadHiddenMenuCommands(),
  enablement: Readonly<Record<string, boolean>> = {},
): MenuBarEntry[] {
  // Filter once at the dispatcher boundary: every blueprint and injected menu
  // item below already treats a missing action as disabled.
  const actions: Record<string, () => void> = Object.fromEntries(
    Object.entries(registeredActions).filter(([id]) => enablement[id] !== false),
  );
  const wired = new Set<string>();
  let sep = 0;

  const convert = (nodes: PsNode[], parentPath: string[]): MenuItemDef[] => {
    const ids = new Set<string>();
    const uniq = (base: string): string => {
      let id = base;
      for (let i = 2; ids.has(id); i++) id = `${base}-${i}`;
      ids.add(id);
      return id;
    };
    return nodes.map((n): MenuItemDef => {
      if (n.kind === "separator") return { id: `sep${sep++}`, separator: true };
      if (n.kind === "submenu") {
        if (n.label === "Pixel Aspect Ratio" && pixelAspectMenu) {
          const actionItem = (id: string, label: string, disabled = false): MenuItemDef => ({
            id,
            label,
            ...(actions[id] && !disabled ? { action: actions[id] } : { disabled: true }),
          });
          return {
            id: uniq(slug(n.label)),
            label: n.label,
            items: [
              actionItem("custompixelaspect", "Custom Pixel Aspect Ratio…"),
              actionItem("deletepixelaspect", "Delete Pixel Aspect Ratio…", pixelAspectMenu.presets.length === 0),
              actionItem("resetpixelaspects", "Reset Pixel Aspect Ratios…"),
              { id: `sep${sep++}`, separator: true },
              ...pixelAspectMenu.presets.map((preset, index): MenuItemDef => ({
                id: `par-preset-${index}`,
                label: preset.name,
                checked: Math.abs(preset.ratio - pixelAspectMenu.currentRatio) < 1e-9,
                action: () => pixelAspectMenu.onSelect(preset.ratio),
              })),
            ],
          };
        }
        const inner = convert(n.items, [...parentPath, n.label]);
        if (n.label === "Font Preview Size") {
          const previewItems = inner.map((item) => {
            const choice = FONT_PREVIEW_CHOICES.find((entry) => entry.label === item.label);
            if (!choice) return item;
            const next: MenuItemDef = { ...item, id: choice.command };
            const action = actions[choice.command];
            if (action) { delete next.disabled; next.action = action; }
            return next;
          });
          return { id: uniq(slug(n.label)), label: n.label, items: previewItems };
        }
        // File ▸ Open Recent: prepend the live recent-files list.
        if (n.label === "Open Recent" && recent.length) {
          const recents: MenuItemDef[] = recent.map((r, i) => ({
            id: uniq(`recent${i}`), label: r.name, action: () => onOpenRecent(r.path),
          }));
          return { id: uniq(slug(n.label)), label: n.label, items: [...recents, { id: `sep${sep++}`, separator: true }, ...inner] };
        }
        // File ▸ Import: append "3D LUT (.cube/.3dl)…" — the inverse of File ▸ Export ▸
        // Color Lookup Tables. Injected here (not in the auto-generated blueprint).
        if (n.label === "Import") {
          const lut: MenuItemDef = { id: uniq("importlut"), label: "3D LUT (.cube/.3dl)…", ...(actions.importlut ? { action: actions.importlut } : { disabled: true }) };
          return { id: uniq(slug(n.label)), label: n.label, items: [...inner, { id: `sep${sep++}`, separator: true }, lut] };
        }
        // File ▸ Export: add the current Layer Comps to PDF companion beside
        // Layer Comps to Files, then append Monet's extra export encoders.
        // Injected here (not in the auto-generated blueprint).
        if (n.label === "Export") {
          const originalPsd: MenuItemDef = { id: uniq("psdoriginal"), label: "Export Preserved Photoshop Original…", ...(actions.psdoriginal && photoshopOriginalAvailable ? { action: actions.psdoriginal } : { disabled: true }) };
          const lcpdf: MenuItemDef = { id: uniq("layercompstopdf"), label: "Layer Comps to PDF…", ...(actions.layercompstopdf ? { action: actions.layercompstopdf } : { disabled: true }) };
          const tga: MenuItemDef = { id: uniq("exporttga"), label: "Export Targa (.tga)…", ...(actions.exporttga ? { action: actions.exporttga } : { disabled: true }) };
          const ppm: MenuItemDef = { id: uniq("exportppm"), label: "Export Portable Bitmap (.ppm)…", ...(actions.exportppm ? { action: actions.exportppm } : { disabled: true }) };
          const pcx: MenuItemDef = { id: uniq("exportpcx"), label: "Export PCX (.pcx)…", ...(actions.exportpcx ? { action: actions.exportpcx } : { disabled: true }) };
          const svgdoc: MenuItemDef = { id: uniq("exportsvgdoc"), label: "Export SVG (Document)…", ...(actions.exportsvgdoc ? { action: actions.exportsvgdoc } : { disabled: true }) };
          const webplossy: MenuItemDef = { id: uniq("webplossy"), label: "Export WebP (Lossy)…", ...(actions.webplossy ? { action: actions.webplossy } : { disabled: true }) };
          const heic: MenuItemDef = { id: uniq("exportheic"), label: "Export HEIC…", ...(actions.exportheic ? { action: actions.exportheic } : { disabled: true }) };
          const dng: MenuItemDef = { id: uniq("exportdng"), label: "Export DNG…", ...(actions.exportdng ? { action: actions.exportdng } : { disabled: true }) };
          // Photoshop reaches PDF/X through presets inside the Save Adobe PDF
          // dialog; Vision has no such dialog yet, so the two presets it can
          // actually write get their own entries rather than shipping dead.
          const pdfx1a: MenuItemDef = { id: uniq("exportpdfx1a"), label: "Export PDF/X-1a…", ...(actions.exportpdfx1a ? { action: actions.exportpdfx1a } : { disabled: true }) };
          const pdfx4: MenuItemDef = { id: uniq("exportpdfx4"), label: "Export PDF/X-4…", ...(actions.exportpdfx4 ? { action: actions.exportpdfx4 } : { disabled: true }) };
          const at = inner.findIndex((item) => item.label === "Layer Comps to Files…");
          const withPdf = at < 0 ? inner : [...inner.slice(0, at + 1), lcpdf, ...inner.slice(at + 1)];
          return { id: uniq(slug(n.label)), label: n.label, items: [originalPsd, { id: `sep${sep++}`, separator: true }, ...withPdf, { id: `sep${sep++}`, separator: true }, tga, ppm, pcx, svgdoc, webplossy, heic, dng, pdfx1a, pdfx4] };
        }
        // Filter ▸ Render: append "Lighting Effects…" (a classic Photoshop render
        // filter absent from this blueprint). Injected here, not hand-edited in.
        if (n.label === "Render") {
          const lfx: MenuItemDef = { id: uniq("lightingfx"), label: "Lighting Effects…", ...(actions.lightingfx ? { action: actions.lightingfx } : { disabled: true }) };
          return { id: uniq(slug(n.label)), label: n.label, items: [...inner, { id: `sep${sep++}`, separator: true }, lfx] };
        }
        // Filter ▸ Stylize (this blueprint's Filter-Gallery bucket): append the
        // Artistic filters absent from the auto-generated blueprint (they share one
        // separator, like the File ▸ Export encoders).
        if (n.label === "Stylize") {
          const cp: MenuItemDef = { id: uniq("coloredpencil"), label: "Colored Pencil…", ...(actions.coloredpencil ? { action: actions.coloredpencil } : { disabled: true }) };
          const ss: MenuItemDef = { id: uniq("smudgestick"), label: "Smudge Stick…", ...(actions.smudgestick ? { action: actions.smudgestick } : { disabled: true }) };
          const sp: MenuItemDef = { id: uniq("sponge"), label: "Sponge…", ...(actions.sponge ? { action: actions.sponge } : { disabled: true }) };
          const pk: MenuItemDef = { id: uniq("paletteknife"), label: "Palette Knife…", ...(actions.paletteknife ? { action: actions.paletteknife } : { disabled: true }) };
          const pd: MenuItemDef = { id: uniq("paintdaubs"), label: "Paint Daubs…", ...(actions.paintdaubs ? { action: actions.paintdaubs } : { disabled: true }) };
          const fr: MenuItemDef = { id: uniq("fresco"), label: "Fresco…", ...(actions.fresco ? { action: actions.fresco } : { disabled: true }) };
          const rp: MenuItemDef = { id: uniq("roughpastels"), label: "Rough Pastels…", ...(actions.roughpastels ? { action: actions.roughpastels } : { disabled: true }) };
          const up: MenuItemDef = { id: uniq("underpainting"), label: "Underpainting…", ...(actions.underpainting ? { action: actions.underpainting } : { disabled: true }) };
          return { id: uniq(slug(n.label)), label: n.label, items: [...inner, { id: `sep${sep++}`, separator: true }, cp, ss, sp, pk, pd, fr, rp, up] };
        }
        // Edit ▸ Transform: append "Perspective Crop…" (Photoshop's Perspective
        // Crop is a toolbar tool with no menu entry; exposed here as a command).
        if (n.label === "Transform") {
          const pc: MenuItemDef = { id: uniq("perspcrop"), label: "Perspective Crop…", ...(actions.perspcrop ? { action: actions.perspcrop } : { disabled: true }) };
          return { id: uniq(slug(n.label)), label: n.label, items: [...inner, { id: `sep${sep++}`, separator: true }, pc] };
        }
        return { id: uniq(slug(n.label)), label: n.label, items: inner };
      }
      // Edit ▸ Presets — Photoshop's submenu (Preset Manager plus the two
      // all-libraries commands); the blueprint flattens it to one item.
      // ponytail: Export/Import Presets and Migrate Presets are buttons inside
      // the Preset Manager, so all three doors open that one dialog. Give them
      // their own ids here once App.tsx registers dedicated commands.
      if (n.label === "Presets" && parentPath.join(" ▸ ") === "Edit") {
        const pm = actions.presetmanager;
        const child = (id: string, label: string): MenuItemDef => ({ id, label, ...(pm ? { action: pm } : { disabled: true }) });
        return {
          id: uniq("presets"),
          label: n.label,
          items: [
            child("presetmanager", "Preset Manager…"),
            child("migratepresets", "Migrate Presets…"),
            child("exportimportpresets", "Export/Import Presets…"),
          ],
        };
      }
      if (n.label === "Set Measurement Scale" && measurementScaleMenu) {
        const custom = actions.setmeasurescale;
        return {
          id: uniq("set-measurement-scale"),
          label: n.label,
          items: [
            { id: "setmeasurescale", label: "Custom…", ...(custom ? { action: custom } : { disabled: true }) },
            ...(measurementScaleMenu.presets.length ? [{ id: `sep${sep++}`, separator: true } as MenuItemDef] : []),
            ...measurementScaleMenu.presets.map((preset): MenuItemDef => ({
              id: `measure-scale-preset:${preset.name.toLocaleLowerCase()}`,
              label: preset.name,
              checked: preset.px === measurementScaleMenu.currentScale.px
                && preset.units === measurementScaleMenu.currentScale.units
                && preset.unit === measurementScaleMenu.currentScale.unit,
              action: () => measurementScaleMenu.onSelect(preset),
            })),
          ],
        };
      }
      const path = [...parentPath, n.label].join(" ▸ ");
      const mid = PATH_WIRING[path] ?? LABEL_WIRING[n.label] ?? n.monetId;
      const item: MenuItemDef = { id: uniq(mid ?? slug(n.label)), label: n.label };
      if (n.shortcut) item.shortcut = n.shortcut;
      const action = mid && (!wired.has(mid) || SHARED_ACTION_PATHS.has(path)) ? actions[mid] : undefined;
      if (action) {
        wired.add(mid!);
        item.action = action;
      } else {
        item.disabled = true; // Photoshop command Monet doesn't implement
      }
      // Per-layer checkmarks (Type ▸ OpenType toggles). MenuItemDef already
      // supports `checked` (see the injected preset submenus) — no monet-ui change.
      if (mid && checkedIds.has(mid)) item.checked = true;
      return item;
    });
  };

  const base = PS_MENUS.map((m) => {
    const items = convert(m.tree, [m.label]);
    // View ▸ inject "Fit Layer(s) on Screen" right after "Fit on Screen" — zooms
    // to the active layer's content bbox (Photoshop; absent from this blueprint).
    // Same fit group as the neighbours, so no separator.
    if (m.id === "view") {
      const at = items.findIndex((it) => it.label === "Fit on Screen");
      if (at >= 0) {
        items.splice(at + 1, 0, { id: "fitlayer", label: "Fit Layer(s) on Screen", ...(actions.fitlayer ? { action: actions.fitlayer } : { disabled: true }) });
      }
    }
    // Photoshop's "Generate Similar" lives on generated layers (Task Bar /
    // Properties panel); Monet surfaces the same re-roll beside its Generate
    // Image entry. Absent from the blueprint, so inject it here.
    if (m.id === "edit") {
      const at = items.findIndex((it) => it.label === "Generate Image (AI · Diffusion)…");
      if (at >= 0) {
        items.splice(at + 1, 0, {
          id: "gensimilar",
          label: "Generate Similar",
          ...(actions.gensimilar ? { action: actions.gensimilar } : { disabled: true }),
        });
      }
    }
    // Adobe exposes the active Paint Symmetry path transform at Image level.
    // It is absent from the generated blueprint, so place it beside Image Rotation.
    if (m.id === "image") {
      const at = items.findIndex((it) => it.label === "Image Rotation");
      if (at >= 0) {
        items.splice(at + 1, 0, {
          id: "transformsymmetry",
          label: "Transform Symmetry",
          ...(actions.transformsymmetry ? { action: actions.transformsymmetry } : { disabled: true }),
        });
      }
    }
    // Type ▸ Text on Path: the blueprint ships only the one-shot create, which
    // left an on-path type layer un-editable once made. Grow it into Photoshop's
    // submenu — re-bind to the current work path, and the Align/Flip/Spacing/
    // start-end options dialog — here rather than hand-editing the generated
    // blueprint (same discipline as the injections above). (#451)
    if (m.id === "type") {
      const at = items.findIndex((it) => it.label === "Text on Path");
      if (at >= 0) {
        const child = (id: string, label: string): MenuItemDef =>
          ({ id, label, ...(actions[id] ? { action: actions[id] } : { disabled: true }) });
        items[at] = {
          id: "text-on-path",
          label: "Text on Path",
          items: [
            { ...items[at], label: "Create from Work Path" },
            child("bindtoworkpath", "Bind to Work Path"),
            { id: `sep${sep++}`, separator: true },
            child("typeonpathoptions", "Type on a Path Options…"),
          ],
        };
      }
    }
    return { id: m.id, label: m.label, items };
  });

  // Append the Window menu (absent from the Photoshop blueprint): Arrange,
  // Workspace management, the Contextual Task Bar, the checkmarked panel
  // inventory, and the open-document list — mirroring Photoshop's order.
  const act = (id: string): Partial<MenuItemDef> =>
    actions[id] ? { action: actions[id] } : { disabled: true };
  const ws = windowMenu?.workspaces ?? [];
  const onOpenPanel = windowMenu?.onOpenPanel;
  const panelItems: MenuItemDef[] = (windowMenu?.panels ?? []).map((panel) => ({
    id: `panel-${panel.id}`,
    label: panel.title,
    ...(windowMenu?.openPanelIds?.has(panel.id) ? { checked: true } : {}),
    ...(onOpenPanel ? { action: () => onOpenPanel(panel.id) } : { disabled: true }),
  }));
  const wsEntry = (w: { name: string }, i: number): MenuItemDef =>
    ({ id: `ws-${i}`, label: w.name, action: () => windowMenu?.onApplyWorkspace(w.name) });
  const builtinWs = ws.filter((w) => w.builtin);
  const customWs = ws.filter((w) => !w.builtin);
  const workspaceItems: MenuItemDef[] = [
    ...builtinWs.map((w) => wsEntry(w, ws.indexOf(w))),
    ...(builtinWs.length && customWs.length ? [{ id: `sep${sep++}`, separator: true } as MenuItemDef] : []),
    ...customWs.map((w) => wsEntry(w, ws.indexOf(w))),
    ...(ws.length ? [{ id: `sep${sep++}`, separator: true } as MenuItemDef] : []),
    { id: "savews", label: "Save Workspace…", ...act("savews") },
    { id: "resetws", label: "Reset Panels", ...act("resetws") },
    ...(customWs.length ? [{ id: "delws", label: "Delete Workspace…", ...act("delws") } as MenuItemDef] : []),
  ];
  // Window ▸ Arrange — Photoshop's item list, wired through `act` like the
  // blueprint menus, so an entry is enabled exactly when the host implements it.
  const activeDoc = windowMenu?.documents?.find((d) => d.id === windowMenu.activeDocumentId);
  const arrangeItems: MenuItemDef[] = [
    { id: "tileallvert", label: "Tile All Vertically", ...act("tileallvert") },
    { id: "tileallhoriz", label: "Tile All Horizontally", ...act("tileallhoriz") },
    { id: "consolidatetabs", label: "Consolidate All to Tabs", ...act("consolidatetabs") },
    { id: `sep${sep++}`, separator: true },
    { id: "cascade", label: "Cascade", ...act("cascade") },
    { id: "tile", label: "Tile", ...act("tile") },
    { id: "floatinwindow", label: "Float in Window", ...act("floatinwindow") },
    { id: "floatallwindows", label: "Float All in Windows", ...act("floatallwindows") },
    { id: `sep${sep++}`, separator: true },
    { id: "matchzoom", label: "Match Zoom", ...act("matchzoom") },
    { id: "matchlocation", label: "Match Location", ...act("matchlocation") },
    { id: "matchrotation", label: "Match Rotation", ...act("matchrotation") },
    { id: "matchall", label: "Match All", ...act("matchall") },
    { id: `sep${sep++}`, separator: true },
    { id: "newwindowfordoc", label: `New Window for ${activeDoc?.name ?? "Document"}`, ...act("newwindowfordoc") },
  ];
  // Open documents, checkmarked on the active one (Photoshop's bottom section).
  const onActivateDocument = windowMenu?.onActivateDocument;
  const documentItems: MenuItemDef[] = (windowMenu?.documents ?? []).map((docEntry) => ({
    id: `doc-${docEntry.id}`,
    label: docEntry.name,
    ...(docEntry.id === windowMenu?.activeDocumentId ? { checked: true } : {}),
    ...(onActivateDocument ? { action: () => onActivateDocument(docEntry.id) } : { disabled: true }),
  }));
  const windowEntry: MenuBarEntry = {
    id: "window",
    label: "Window",
    items: [
      { id: "arrange", label: "Arrange", items: arrangeItems },
      { id: "workspace", label: "Workspace", items: workspaceItems },
      { id: `sep${sep++}`, separator: true },
      { id: "toggletaskbar", label: "Contextual Task Bar", ...act("toggletaskbar") },
      { id: `sep${sep++}`, separator: true },
      ...panelItems,
      ...(documentItems.length ? [{ id: `sep${sep++}`, separator: true } as MenuItemDef, ...documentItems] : []),
    ],
  };

  const helpEntry: MenuBarEntry = {
    id: "help",
    label: "Help",
    items: [
      { id: "about", label: "About Monet Vision…", ...act("about") },
      { id: "systeminfo", label: "System Info…", ...act("systeminfo") },
      { id: `sep${sep++}`, separator: true },
      { id: "keyboardshortcuts", label: "Keyboard Shortcuts…", ...act("keyboardshortcuts") },
    ],
  };

  const bar = [...base, windowEntry, helpEntry];
  // Edit ▸ Menus… — apply the user's hidden set last, so the injections above
  // (Window, Export encoders, …) are hideable like the blueprint's own items.
  // ponytail: read straight from localStorage on each build, so a change made in
  // the dialog lands on the next menu rebuild rather than instantly. Upgrade
  // path: hold the set in the store beside `keyboardShortcuts` and add it to
  // App.tsx's baseMenus deps.
  if (!hidden.size) return bar;
  return bar
    .map((menu) => ({ ...menu, items: pruneHidden(menu.items, hidden, String(menu.label)) }))
    .filter((menu) => menu.items.length);
}
