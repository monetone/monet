// PresetsPanel — Develop-rail develop presets (Phase 2 + GAL-DEV-12). Presets
// are global saved recipes (catalog `preset` table) plus a shipped built-in
// library, shown in collapsible groups (native <details>); a "Folder/Name"
// preset name files a user preset under its own folder. Clicking one applies it
// to the active photo scaled by the Amount slider (onApply → DevelopView's
// applyPresetRecipe, which overlays only the look panels — crop/heal/masks/WB
// survive). Hovering fires the optional onPreview with the scaled recipe for a
// Navigator-style live preview. "Save current" snapshots the live recipe under
// a name; "Import .xmp" parses Adobe Camera Raw preset files (lib/xmpPreset →
// the shared @monet-ui/monet-photo dialect, so a preset Vision writes imports
// here too) into full recipes via normalizeRecipe's deep panel merge, and the
// per-row ⤓ exports back out through the same dialect (serializeCameraRawXmp).

import { Slider } from "@monet-ui/monet-react";
import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  createDefaultRecipe,
  normalizeRecipe,
  serializeCameraRawXmp,
  type DevelopRecipeV2,
} from "@monet-ui/monet-photo";
import { useEffect, useState } from "react";

import { addPreset, catalogAvailable, deletePreset, listPresets } from "../catalog/catalog";
import type { PresetRow } from "../catalog/types";
import { parseXmpPreset } from "../lib/xmpPreset";
import { store } from "../state/store";

// ── Built-in library ─────────────────────────────────────────────────────────
// Shipped looks so a fresh catalog isn't empty (LR ships Adobe Color/B&W/
// Vintage…). Stored as deep-partial patches; normalizeRecipe merges each over
// recipe defaults into a full canonical recipe at apply time. No WB fields —
// applyPresetRecipe preserves the photo's white balance anyway.
export const BUILTIN_PRESET_GROUPS: {
  group: string;
  presets: { name: string; patch: Record<string, unknown> }[];
}[] = [
  {
    group: "Monet Color",
    presets: [
      { name: "Punch", patch: { basic: { contrast: 25, texture: 10, clarity: 15, vibrance: 20 } } },
      {
        name: "Bright & Airy",
        patch: {
          basic: { exposure: 0.35, contrast: -10, highlights: -35, shadows: 40, whites: 15, saturation: -5 },
        },
      },
    ],
  },
  {
    group: "Monet B&W",
    presets: [
      { name: "B&W Standard", patch: { colorMixer: { mode: "bw" } } },
      {
        name: "B&W High Contrast",
        patch: { colorMixer: { mode: "bw" }, basic: { contrast: 30, clarity: 10 } },
      },
      {
        name: "B&W Soft",
        patch: { colorMixer: { mode: "bw" }, basic: { contrast: -15, shadows: 20 } },
      },
    ],
  },
  {
    group: "Monet Vintage",
    presets: [
      {
        name: "Faded Film",
        patch: {
          basic: { contrast: -10, saturation: -15 },
          toneCurve: {
            point: [
              { x: 0, y: 0.09 },
              { x: 0.25, y: 0.28 },
              { x: 0.75, y: 0.72 },
              { x: 1, y: 0.93 },
            ],
          },
          effects: { grainAmount: 25, grainSize: 25, grainRoughness: 50 },
        },
      },
      {
        name: "Warm Fade",
        patch: {
          basic: { saturation: -10 },
          colorGrading: {
            shadows: { hue: 220, sat: 12, lum: 0 },
            highlights: { hue: 45, sat: 15, lum: 0 },
            blending: 50,
            balance: 10,
          },
          effects: { vignetteAmount: -15 },
        },
      },
    ],
  },
];

// ── Amount scaling ───────────────────────────────────────────────────────────
// Keys applyPresetRecipe preserves anyway — interpolating geometry/masks/version
// fields is meaningless (or, for `version`, actively corrupting).
const SCALE_VERBATIM = new Set([
  "version",
  "processVersion",
  "rawDecode",
  "crop",
  "heal",
  "masks",
  "engineMasks",
  "enhance",
  "metadata",
]);

/** Numeric deep-lerp; same-shaped arrays/objects recurse, anything else snaps
 *  to the preset once amount > 0 (a B&W `mode` switch has no half state).
 *  ponytail: a length-mismatched curve snaps whole instead of resampling —
 *  resample points if half-strength curves ever matter. */
function lerpValue(base: unknown, preset: unknown, t: number): unknown {
  if (typeof base === "number" && typeof preset === "number") return base + (preset - base) * t;
  if (Array.isArray(base) && Array.isArray(preset) && base.length === preset.length)
    return preset.map((v, i) => lerpValue(base[i], v, t));
  if (
    base != null && preset != null &&
    typeof base === "object" && typeof preset === "object" &&
    !Array.isArray(base) && !Array.isArray(preset)
  ) {
    const out: Record<string, unknown> = { ...(preset as Record<string, unknown>) };
    for (const k of Object.keys(out))
      out[k] = lerpValue((base as Record<string, unknown>)[k], out[k], t);
    return out;
  }
  return t > 0 ? preset : base;
}

/** Scale a preset's strength: lerp its look from the neutral default recipe
 *  (settings are absolute, so "half a preset" is halfway from neutral).
 *  amount is LR's 0–200%; >100 extrapolates and normalizeRecipe re-clamps. */
export function scalePresetRecipe(preset: DevelopRecipeV2, amount: number): DevelopRecipeV2 {
  const t = amount / 100;
  if (t === 1) return preset;
  const d = createDefaultRecipe() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(preset))
    out[k] = SCALE_VERBATIM.has(k) ? v : lerpValue(d[k], v, t);
  return normalizeRecipe(out);
}

// ── Folders ──────────────────────────────────────────────────────────────────
/** "Portraits/Soft Skin" files under a Portraits folder; a bare name goes to
 *  User Presets. ponytail: folder-in-the-name, because the catalog `preset`
 *  table has no group column — add one (and a rename UI) if drag-to-folder
 *  ever matters. */
export function splitPresetName(name: string): { group: string; leaf: string } {
  const i = name.indexOf("/");
  return i > 0 && i < name.length - 1
    ? { group: name.slice(0, i).trim(), leaf: name.slice(i + 1).trim() }
    : { group: "User Presets", leaf: name };
}

export function PresetsPanel({
  currentRecipe,
  onApply,
  onPreview,
}: {
  currentRecipe: DevelopRecipeV2;
  onApply: (r: DevelopRecipeV2) => void;
  /** Hover preview: the scaled preset on enter/focus, null on leave/blur. */
  onPreview?: (r: DevelopRecipeV2 | null) => void;
}) {
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(100);

  const reload = () => {
    if (!catalogAvailable()) return;
    listPresets()
      .then(setPresets)
      .catch(() => setPresets([]));
  };
  useEffect(() => {
    reload();
  }, []);

  const apply = (recipe: DevelopRecipeV2) => {
    onApply(scalePresetRecipe(recipe, amount));
  };

  const parseRow = (p: PresetRow): DevelopRecipeV2 | null => {
    try {
      return JSON.parse(p.recipeJson) as DevelopRecipeV2;
    } catch (e) {
      console.error("galerie preset: bad recipe json", p.name, e);
      return null;
    }
  };

  const savePreset = async () => {
    const n = name.trim();
    if (!n) return;
    setName("");
    setNaming(false);
    try {
      await addPreset(n, JSON.stringify(currentRecipe), currentRecipe.processVersion ?? null);
      reload();
    } catch (e) {
      console.error("galerie preset: save failed", e);
    }
  };

  const remove = async (id: number) => {
    try {
      await deletePreset(id);
      reload();
    } catch (e) {
      console.error("galerie preset: delete failed", e);
    }
  };

  const importXmp = async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      title: "Import Develop Presets",
      filters: [{ name: "ACR/Lightroom presets", extensions: ["xmp"] }],
    });
    if (selected == null) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    let imported = 0;
    let failed = 0;
    for (const path of paths) {
      try {
        // Bytes go straight in: the shared parser is the one that bounds the
        // size and rejects non-UTF-8, rather than a lossy decode hiding it.
        const parsed = parseXmpPreset(await readFile(path));
        const fallback = path.slice(path.lastIndexOf("/") + 1).replace(/\.xmp$/i, "");
        // The parse is a deep-partial patch; normalizeRecipe merges each panel
        // over recipe defaults into a full canonical recipe.
        const recipe = normalizeRecipe(parsed.recipe);
        await addPreset(parsed.name?.trim() || fallback, JSON.stringify(recipe), null);
        if (parsed.skipped.length > 0) {
          console.info("galerie preset import: skipped properties", path, parsed.skipped);
        }
        imported++;
      } catch (e) {
        console.error("galerie preset import: failed", path, e);
        failed++;
      }
    }
    if (imported) reload();
    store.notify(
      `Imported ${imported} preset${imported === 1 ? "" : "s"}` +
        (failed ? `, ${failed} failed` : ""),
    );
  };

  const exportXmp = async (presetName: string, recipe: DevelopRecipeV2) => {
    try {
      const path = await save({
        title: "Export Develop Preset",
        defaultPath: `${presetName.replace(/\//g, "-")}.xmp`,
        filters: [{ name: "ACR/Lightroom preset", extensions: ["xmp"] }],
      });
      if (path == null) return;
      await writeTextFile(path, serializeCameraRawXmp({ name: presetName, recipe }));
      store.notify(`Exported ${presetName}`);
    } catch (e) {
      console.error("galerie preset export: failed", presetName, e);
      store.notify("Preset export failed");
    }
  };

  /** One clickable row; recipe is lazy so a corrupt user row degrades per-click. */
  const row = (
    key: string | number,
    label: string,
    getRecipe: () => DevelopRecipeV2 | null,
    onDelete?: () => void,
  ) => (
    <li key={key} className="gal-snap-row">
      <button
        className="gal-snap-name"
        onClick={() => {
          const r = getRecipe();
          if (r) apply(r);
        }}
        onMouseEnter={() => {
          if (!onPreview) return;
          const r = getRecipe();
          if (r) onPreview(scalePresetRecipe(r, amount));
        }}
        onMouseLeave={() => onPreview?.(null)}
        onFocus={() => {
          if (!onPreview) return;
          const r = getRecipe();
          if (r) onPreview(scalePresetRecipe(r, amount));
        }}
        onBlur={() => onPreview?.(null)}
        title="Apply preset"
      >
        {label}
      </button>
      {isTauri() && (
        <button
          className="gal-snap-del"
          onClick={() => {
            const r = getRecipe();
            if (r) void exportXmp(label, r);
          }}
          aria-label={`Export preset ${label} as .xmp`}
          title="Export .xmp"
        >
          ⤓
        </button>
      )}
      {onDelete && (
        <button className="gal-snap-del" onClick={onDelete} aria-label={`Delete preset ${label}`}>
          ×
        </button>
      )}
    </li>
  );

  // User presets filed into folders by "Folder/Name"; insertion order.
  const userGroups = new Map<string, { row: PresetRow; leaf: string }[]>();
  for (const p of presets) {
    const { group, leaf } = splitPresetName(p.name);
    let list = userGroups.get(group);
    if (!list) userGroups.set(group, (list = []));
    list.push({ row: p, leaf });
  }

  return (
    <div className="gal-dev-panel">
      <div className="gal-dev-head">
        <span className="gal-dev-title">Presets</span>
      </div>
      <label className="gal-snap-amount">
        Amount
        <Slider
          aria-label="Preset amount"
          min={0}
          max={200}
          step={5}
          accent="var(--accent-raster)"
          value={amount}
          onChange={setAmount}
        />
        <span>{amount}%</span>
      </label>
      {[...userGroups.entries()].map(([group, rows]) => (
        <details key={group} open>
          <summary className="gal-dev-title">{group}</summary>
          <ul className="gal-snap-list">
            {rows.map(({ row: p, leaf }) =>
              row(p.id, leaf, () => parseRow(p), () => void remove(p.id)),
            )}
          </ul>
        </details>
      ))}
      {BUILTIN_PRESET_GROUPS.map((g) => (
        <details key={g.group}>
          <summary className="gal-dev-title">{g.group}</summary>
          <ul className="gal-snap-list">
            {g.presets.map((p) => row(p.name, p.name, () => normalizeRecipe(p.patch)))}
          </ul>
        </details>
      ))}
      {naming ? (
        <input
          className="gal-col-input"
          autoFocus
          placeholder="Preset name (Folder/Name groups)…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void savePreset();
            if (e.key === "Escape") {
              setNaming(false);
              setName("");
            }
          }}
        />
      ) : (
        <>
          <button className="gal-col-addrule" onClick={() => setNaming(true)}>
            + Save current
          </button>
          {isTauri() && (
            <button className="gal-col-addrule" onClick={() => void importXmp()}>
              Import .xmp…
            </button>
          )}
        </>
      )}
    </div>
  );
}
