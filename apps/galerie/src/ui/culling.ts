// culling — apply a resolved keyboard shortcut to the catalog store. Splits the
// pure key→action mapping (lib/keymap.ts, unit-tested) from these store writes.

import { autoAdvances, cullKeyOf, resolveShortcut, type CullAction } from "../lib/keymap";
import { store } from "../state/store";

/** Handle a keystroke; returns true if it was a Library/culling shortcut.
 *  Caps Lock (or the Shift chord) auto-advances after flag/rating/label. */
export function handleCullingKey(e: {
  key: string;
  code?: string;
  shiftKey?: boolean;
  getModifierState?: (key: string) => boolean;
}): boolean {
  const action = resolveShortcut(cullKeyOf(e));
  if (!action) return false;
  void applyCullAction(action, autoAdvances(e));
  return true;
}

/** Handle Copy/Paste/Sync Develop Settings (⇧⌘C / ⇧⌘V / ⇧⌘S). Copy takes the
 *  active photo; Paste targets the whole selection (or the active photo); Sync
 *  pushes the active photo's settings to the rest of the selection. Returns true
 *  if the keystroke was one of our combos. */
export function handleDevelopClipboardKey(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return false;
  const k = e.key.toLowerCase();
  const s = store.getState();
  if (k === "c") {
    const id = s.activeId ?? s.selection[0];
    if (id != null) void store.copyDevelop(id);
    return true;
  }
  if (k === "v") {
    const ids = s.selection.length ? s.selection : s.activeId != null ? [s.activeId] : [];
    if (ids.length) void store.pasteDevelop(ids);
    return true;
  }
  if (k === "s") {
    // Sync Settings: push the active photo's develop settings to the rest of the
    // selection. Needs ≥2 selected (the source + at least one peer to receive it).
    const source = s.activeId ?? s.selection[0];
    if (source != null && s.selection.length > 1) void store.syncDevelop(source, s.selection);
    else store.notify("Select multiple photos to sync develop settings.");
    return true;
  }
  return false;
}

/** Create Virtual Copy (⌘' / Ctrl+'), targeting the whole selection (one copy
 *  per photo, as LR does). Returns true if the keystroke was the combo. */
export function handlePhotoKey(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return false;
  if (e.key !== "'") return false;
  const s = store.getState();
  const ids = s.selection.length ? s.selection : s.activeId != null ? [s.activeId] : [];
  if (ids.length) void store.createVirtualCopy(ids);
  return true;
}

async function applyCullAction(a: CullAction, autoAdvance = false): Promise<void> {
  if (a.kind === "nav" || a.kind === "navRow") {
    // Compare pins the Select and flips the Candidate; every other view moves the
    // active photo. ↑/↓ move a full grid row in Grid, one photo elsewhere.
    const cols = a.kind === "navRow" && store.getState().module === "grid"
      ? Math.max(1, store.getState().gridColumns)
      : 1;
    if (store.getState().module === "compare") store.moveCompareCandidate(a.delta);
    else store.moveActive(a.delta * cols);
    return;
  }
  if (a.kind === "navEnd") {
    // ponytail: jumps within the LOADED buffer — the paginated main library may
    // hold only a prefix; fine for the culling loop, extend if it ever matters.
    const photos = store.getState().photos;
    if (photos.length) store.setActive(photos[a.dir === 1 ? photos.length - 1 : 0].id);
    return;
  }
  if (a.kind === "loupe") {
    // Space/Enter/Z open Loupe from any other view; inside Loupe the view's own
    // key handler toggles Fit ↔ 1:1.
    if (store.getState().module !== "loupe") store.setModule("loupe");
    return;
  }
  if (a.kind === "gridStyle") {
    store.cycleGridStyle();
    return;
  }
  if (a.kind === "module") {
    store.setModule(a.value);
    return;
  }
  // Flags/ratings/labels hit the WHOLE selection (LR: select N, press P — all N
  // flip), falling back to the active photo; other fields stay per-photo.
  const s = store.getState();
  const ids = s.selection.length ? s.selection : s.activeId != null ? [s.activeId] : [];
  if (!ids.length) return;
  const before = s.activeId;
  if (a.kind === "rate") await store.cullMany(ids, { rating: a.value });
  else if (a.kind === "flag") await store.cullMany(ids, { flag: a.value });
  else if (a.kind === "label") await store.cullMany(ids, { colorLabel: a.value });
  // LR's Caps Lock / Shift chord: advance to the next photo — unless the cull
  // itself already advanced (the photo dropped out of the filtered view).
  if (autoAdvance && store.getState().activeId === before) {
    if (store.getState().module === "compare") store.moveCompareCandidate(1);
    else store.moveActive(1);
  }
}
