// HistoryPanel — the Develop history timeline for the active photo. Steps are
// auto-recorded by DevelopView on each genuine edit (label from historyLabel).
// The panel holds a live pointer into the stack (LR's Develop undo): ⌘Z steps
// back, ⇧⌘Z steps forward, clicking a step jumps to it. The bottom step is
// always the synthetic "Import" row (the as-imported default recipe), and Basic
// slider steps show the parameter and its new value. Storage stays
// append-only — DevelopView's baseline-diff recorder appends a row for every
// restore too — so the reload tags that row as an echo of our own restore and
// hides it, and the visible list reads like LR's moving pointer.
// Reloads when `rev` bumps (a step was recorded/cleared).
//
// ponytail: echoes are tagged per-session only, so a reopened photo shows past
// echo rows as ordinary steps and the DB grows one row per undo (capped at 200
// by recordHistory). Upgrade path: a restore hook in DevelopView that moves
// historyBaselineRef without recording, then the echo machinery here deletes.

import { Button, isEditableTarget } from "@monet-ui/monet-react";
import { useEffect, useRef, useState } from "react";

import { createDefaultRecipe, type DevelopRecipeV2 } from "@monet-ui/monet-photo";

import { catalogAvailable, clearHistory, listHistory } from "../catalog/catalog";
import type { HistoryRow } from "../catalog/types";

/** Sentinel id for the synthetic bottom "Import" step (sqlite rowids start at 1). */
export const IMPORT_STEP_ID = 0;

/** LR's bottom "Import" step: restoring it reapplies the as-imported (default)
 *  recipe. Synthetic — never stored, always appended below the recorded rows. */
export function importStep(photoId: number): HistoryRow {
  return {
    id: IMPORT_STEP_ID,
    photoId,
    label: "Import",
    recipeJson: JSON.stringify(createDefaultRecipe()),
    processVersion: null,
    createdAt: 0,
  };
}

// Key-order-insensitive stringify: the Import row's client-side JSON.stringify
// must still match the Rust-canonicalized copy the recorder appends after we
// restore it, or echo detection misses and the pointer resets.
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Same recipe, tolerating canonicalization's key reordering. */
export function sameRecipeJson(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return stableStringify(JSON.parse(a)) === stableStringify(JSON.parse(b));
  } catch {
    return false;
  }
}

// Mirrors BasicPanel's slider specs: UI unit = recipe value / scale (-100..100).
const BASIC_SPECS: { key: string; label: string; scale: number }[] = [
  { key: "temp", label: "Temp", scale: 0.01 },
  { key: "tint", label: "Tint", scale: 0.01 },
  { key: "exposure", label: "Exposure", scale: 0.04 },
  { key: "contrast", label: "Contrast", scale: 0.01 },
  { key: "highlights", label: "Highlights", scale: 0.01 },
  { key: "shadows", label: "Shadows", scale: 0.01 },
  { key: "whites", label: "Whites", scale: 0.01 },
  { key: "blacks", label: "Blacks", scale: 0.01 },
  { key: "texture", label: "Texture", scale: 0.01 },
  { key: "clarity", label: "Clarity", scale: 0.01 },
  { key: "dehaze", label: "Dehaze", scale: 0.01 },
  { key: "vibrance", label: "Vibrance", scale: 0.01 },
  { key: "saturation", label: "Saturation", scale: 0.01 },
];

/** "Parameter +value" detail for a step: the first Basic slider that differs
 *  from the next-older step, in BasicPanel's UI units. Null when the change is
 *  not a Basic slider (the panel label alone tells the story). */
export function stepDetail(olderJson: string, newerJson: string): string | null {
  try {
    const a = (JSON.parse(olderJson) as DevelopRecipeV2).basic as unknown as Record<string, unknown>;
    const b = (JSON.parse(newerJson) as DevelopRecipeV2).basic as unknown as Record<string, unknown>;
    for (const s of BASIC_SPECS) {
      const bv = b[s.key];
      if (typeof bv === "number" && a[s.key] !== bv) {
        const ui = Math.round(bv / s.scale);
        return `${s.label} ${ui > 0 ? "+" : ""}${ui}`;
      }
    }
  } catch {
    // Malformed/pre-schema rows keep their bare label.
  }
  return null;
}

/** The step ⌘Z (`delta` 1, older) or ⇧⌘Z (`delta` -1, newer) lands on from the
 *  pointer, or null at either end of the stack. `visible` is newest-first;
 *  a null (or vanished) pointer means the newest step. */
export function stepTarget(
  visible: readonly HistoryRow[],
  pointerId: number | null,
  delta: 1 | -1,
): HistoryRow | null {
  if (visible.length === 0) return null;
  const cur = pointerId == null ? 0 : Math.max(0, visible.findIndex((s) => s.id === pointerId));
  const next = cur + delta;
  return next >= 0 && next < visible.length ? visible[next] : null;
}

/** Reload bookkeeping: a freshly-appended top step whose json matches the json
 *  we just restored is the echo of our own restore — hide it and keep the
 *  pointer. Anything else (fresh load, genuine new edit, clear) resets the
 *  pointer to the newest step. */
export function classifyReload(
  steps: readonly HistoryRow[],
  restoredJson: string | null,
  echoIds: ReadonlySet<number>,
): { echoId: number | null; resetPointer: boolean } {
  const top = steps[0];
  if (restoredJson != null && top && !echoIds.has(top.id) && sameRecipeJson(top.recipeJson, restoredJson)) {
    return { echoId: top.id, resetPointer: false };
  }
  return { echoId: null, resetPointer: true };
}

export function HistoryPanel({
  photoId,
  rev,
  onRestore,
  onChanged,
}: {
  photoId: number;
  rev: number;
  onRestore: (r: DevelopRecipeV2) => void;
  onChanged: () => void;
}) {
  const [steps, setSteps] = useState<HistoryRow[]>([]);
  // The step the recipe currently sits on; null = newest visible step.
  const [pointerId, setPointerId] = useState<number | null>(null);
  // Json of our last restore, so the next reload can recognize its echo row.
  const restoredJsonRef = useRef<string | null>(null);
  // Ids of this session's echo rows (hidden from the list and from stepping).
  const echoIdsRef = useRef<Set<number>>(new Set());

  // A photo switch invalidates pointer + echo bookkeeping (before the load).
  useEffect(() => {
    restoredJsonRef.current = null;
    echoIdsRef.current = new Set();
    setPointerId(null);
  }, [photoId]);

  useEffect(() => {
    let cancelled = false;
    if (!catalogAvailable()) {
      setSteps([]);
      return;
    }
    listHistory(photoId)
      .then((s) => {
        if (cancelled) return;
        const { echoId, resetPointer } = classifyReload(s, restoredJsonRef.current, echoIdsRef.current);
        restoredJsonRef.current = null;
        if (echoId != null) echoIdsRef.current.add(echoId);
        if (resetPointer) setPointerId(null);
        setSteps(s);
      })
      .catch(() => !cancelled && setSteps([]));
    return () => {
      cancelled = true;
    };
  }, [photoId, rev]);

  // Recorded rows (echoes hidden) plus the synthetic Import baseline at the bottom.
  const visible = [...steps.filter((s) => !echoIdsRef.current.has(s.id)), importStep(photoId)];

  const restore = (s: HistoryRow) => {
    try {
      const r = JSON.parse(s.recipeJson) as DevelopRecipeV2;
      setPointerId(s.id);
      restoredJsonRef.current = s.recipeJson;
      onRestore(r);
    } catch (e) {
      console.error("galerie history: restore failed", s.label, e);
    }
  };

  // ⌘Z / ⇧⌘Z step the pointer while Develop is mounted. App.tsx's global undo
  // handler deliberately skips the develop module and defers to this binding.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "z") return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      const target = stepTarget(visible, pointerId, e.shiftKey ? -1 : 1);
      if (target) restore(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const clear = async () => {
    try {
      await clearHistory(photoId);
      restoredJsonRef.current = null;
      echoIdsRef.current = new Set(); // sqlite may reuse row ids after a clear
      onChanged();
    } catch (e) {
      console.error("galerie history: clear failed", e);
    }
  };

  const currentId = pointerId ?? visible[0]?.id;
  return (
    <div className="gal-dev-panel">
      <div className="gal-dev-head">
        <span className="gal-dev-title">History</span>
        {steps.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        )}
      </div>
      <ul className="gal-snap-list">
        {visible.map((s, i) => {
          const older = visible[i + 1];
          const detail = older ? stepDetail(older.recipeJson, s.recipeJson) : null;
          return (
            <li key={s.id} className="gal-snap-row">
              <button
                className="gal-snap-name"
                aria-current={s.id === currentId ? "step" : undefined}
                // Inline accent: .gal-snap-name has no active rule in galerie.css.
                style={s.id === currentId ? { color: "var(--accent-raster, #22d3ee)" } : undefined}
                onClick={() => restore(s)}
                title="Restore this step"
              >
                {detail ?? s.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
