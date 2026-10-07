// PhotoContextMenu — Lightroom's grid/filmstrip right-click menu. Wraps a
// photo surface (LibraryGrid, Filmstrip) in the shared <ContextMenu> and shows
// the per-photo command set acting on the current selection. Cells retarget on
// right-click first (LR: right-click outside the selection acts on the clicked
// photo alone) via `retargetOnContextMenu`, so the menu always reads the
// post-retarget selection when it opens.

import { useState, type ReactNode } from "react";

import { ContextMenu, type MenuItemDef } from "@monet-ui/monet-react";

import { revealPath } from "../catalog/catalog";
import type { CollectionRow, PhotoRow } from "../catalog/types";
import { editInVision } from "../lib/editIn";
import { LABEL_COLORS_ORDER, labelNames } from "../lib/labelSet";
import { findQuickCollection } from "../lib/quickCollection";
import { store, useCatalog } from "../state/store";
import { basename } from "./GridCell";
import { RemoveDialog } from "./RemoveDialog";

/** LR's retarget rule: right-clicking a photo outside the selection selects it
 *  (the menu then acts on it alone); inside the selection keeps the group. */
export function retargetOnContextMenu(id: number): void {
  if (!store.getState().selection.includes(id)) store.select(id);
}

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : "";
}

/** Everything the item builder reads, passed in so it stays a pure function
 *  (unit-testable without the live store). Actions still write to the store. */
export interface PhotoContextDeps {
  /** The photos the menu acts on: the selection, else the active photo. */
  targets: readonly PhotoRow[];
  collections: readonly CollectionRow[];
  /** Grid source: a manual collection id enables "Remove from Collection". */
  activeCollectionId: number | null;
  quickMemberIds: readonly number[];
  /** Tracked folder paths — gates "Go to Folder in Library". */
  folderPaths: readonly string[];
  /** Color-label display names (lib/labelSet `labelNames()`). */
  labels: Record<string, string>;
  /** Opens the Remove from Catalog confirm (the dialog owns the destructive step). */
  onRemove: () => void;
}

/** True when every target agrees (checked marks); false for an empty set. */
const allHave = (targets: readonly PhotoRow[], pred: (p: PhotoRow) => boolean) =>
  targets.length > 0 && targets.every(pred);

export function photoContextItems(d: PhotoContextDeps): MenuItemDef[] {
  const ids = d.targets.map((p) => p.id);
  const none = ids.length === 0;
  const first = d.targets[0];
  const quick = new Set(d.quickMemberIds);
  const inQuick = allHave(d.targets, (p) => quick.has(p.id));
  // Same collection gating as the Library menu: manual collections only,
  // Quick excluded (it has B and its own row above).
  const quickId = findQuickCollection(d.collections)?.id ?? null;
  const addable = d.collections.filter((c) => c.kind === "collection" && c.id !== quickId);
  const removableCollectionId = d.collections.some(
    (c) => c.id === d.activeCollectionId && c.kind === "collection",
  )
    ? d.activeCollectionId
    : null;
  const dir = first ? dirname(first.path) : null;

  const flagItem = (id: string, label: string, shortcut: string, value: number): MenuItemDef => ({
    id,
    label,
    shortcut,
    checked: allHave(d.targets, (p) => p.flag === value),
    action: () => void store.cullMany(ids, { flag: value }),
  });
  const rateItem = (n: number): MenuItemDef => ({
    id: `rate-${n}`,
    label: n === 0 ? "None" : "★".repeat(n),
    shortcut: String(n),
    checked: allHave(d.targets, (p) => p.rating === n),
    action: () => void store.cullMany(ids, { rating: n }),
  });
  const labelItem = (color: string | null): MenuItemDef => ({
    id: color == null ? "label-none" : `label-${color}`,
    label: color == null ? "None" : d.labels[color] ?? color,
    checked: allHave(d.targets, (p) => (p.colorLabel ?? null) === color),
    action: () => void store.cullMany(ids, { colorLabel: color }),
  });

  return [
    {
      id: "quick",
      label: inQuick ? "Remove from Quick Collection" : "Add to Quick Collection",
      shortcut: "B",
      disabled: none,
      action: () => void store.toggleQuickMembership([...ids]),
    },
    {
      id: "addtocollection",
      label: "Add to Collection",
      disabled: none,
      items: addable.length
        ? addable.map((c) => ({
            id: `addcol-${c.id}`,
            label: c.name,
            action: () => void store.addToCollection(c.id, ids),
          }))
        : [{ id: "nocollections", label: "No Collections", disabled: true }],
    },
    {
      id: "removefromcollection",
      label: "Remove from Collection",
      disabled: none || removableCollectionId == null,
      action: () => {
        if (removableCollectionId != null) void store.removeFromCollection(removableCollectionId, ids);
      },
    },
    { id: "sep-cull", separator: true },
    {
      id: "flag",
      label: "Set Flag",
      disabled: none,
      items: [
        flagItem("flag-pick", "Flagged", "P", 1),
        flagItem("flag-none", "Unflagged", "U", 0),
        flagItem("flag-reject", "Rejected", "X", -1),
      ],
    },
    {
      id: "rating",
      label: "Set Rating",
      disabled: none,
      items: [0, 1, 2, 3, 4, 5].map(rateItem),
    },
    {
      id: "label",
      label: "Set Color Label",
      disabled: none,
      items: [...LABEL_COLORS_ORDER.map((c) => labelItem(c)), labelItem(null)],
    },
    { id: "sep-stack", separator: true },
    {
      id: "stacking",
      label: "Stacking",
      disabled: none,
      items: [
        { id: "stack", label: "Stack Photos", shortcut: "⌘G", action: () => void store.stackSelection() },
        { id: "unstack", label: "Unstack", shortcut: "⇧⌘G", action: () => void store.unstackActive() },
        { id: "splitstack", label: "Split Stack", action: () => void store.splitStackActive() },
        {
          id: "stackcover",
          label: "Move to Top of Stack",
          shortcut: "⇧S",
          action: () => void store.setStackCoverActive(),
        },
        { id: "stackup", label: "Move Up in Stack", action: () => void store.moveInStackActive(-1) },
        { id: "stackdown", label: "Move Down in Stack", action: () => void store.moveInStackActive(1) },
      ],
    },
    {
      id: "vcopy",
      label: "Create Virtual Copy",
      shortcut: "⌘'",
      disabled: none,
      // One copy per selected photo, like LR's ⌘'.
      action: () => void store.createVirtualCopy(ids),
    },
    {
      id: "copyname",
      label: "Set Copy Name…",
      // LR greys this out unless the target is a single virtual copy.
      disabled: ids.length !== 1 || !first?.isVirtualCopy,
      action: () => {
        if (!first?.isVirtualCopy) return;
        const name = window.prompt("Copy name", first.copyName ?? "");
        if (name != null) void store.setCopyName(first.id, name);
      },
    },
    {
      id: "devsettings",
      label: "Develop Settings",
      disabled: none,
      items: [
        {
          id: "copydev",
          label: "Copy Settings",
          shortcut: "⇧⌘C",
          action: () => {
            if (first) void store.copyDevelop(first.id);
          },
        },
        { id: "pastedev", label: "Paste Settings", shortcut: "⇧⌘V", action: () => void store.pasteDevelop([...ids]) },
        {
          id: "syncdev",
          label: "Sync Settings",
          shortcut: "⇧⌘S",
          // Sync needs the source + at least one peer to receive it.
          disabled: ids.length < 2,
          action: () => {
            if (first) void store.syncDevelop(first.id, [...ids]);
          },
        },
      ],
    },
    { id: "sep-go", separator: true },
    {
      id: "gotofolder",
      label: "Go to Folder in Library",
      disabled: dir == null || !d.folderPaths.includes(dir),
      action: () => {
        if (dir != null) void store.setActiveFolder(dir);
      },
    },
    {
      id: "reveal",
      label: "Show in Finder",
      shortcut: "⌘R",
      disabled: none,
      action: () => {
        if (first) void revealPath(first.path);
      },
    },
    {
      id: "editinvision",
      label: "Edit in Monet Vision…",
      disabled: none,
      action: () => {
        if (!first) return;
        store.notify("Rendering a copy for Monet Vision…");
        void editInVision(first).then(
          (r) => {
            const name = basename(r.path);
            store.notify(
              r.launchError
                ? `Created ${name} — Monet Vision didn't open: ${r.launchError}`
                : `Editing ${name} in Monet Vision`,
            );
          },
          (e) => store.notify(`Edit in Monet Vision failed: ${String(e)}`),
        );
      },
    },
    { id: "sep-remove", separator: true },
    { id: "remove", label: "Remove from Catalog…", shortcut: "⌫", disabled: none, action: d.onRemove },
  ];
}

export function PhotoContextMenu({ className, children }: { className?: string; children: ReactNode }) {
  const st = useCatalog();
  const [removeOpen, setRemoveOpen] = useState(false);
  // Same target rule as the menu bar: the selection, else the active photo.
  const targets = st.selection.length
    ? st.photos.filter((p) => st.selection.includes(p.id))
    : st.photos.filter((p) => p.id === st.activeId);
  const items = photoContextItems({
    targets,
    collections: st.collections,
    activeCollectionId: st.activeCollectionId,
    quickMemberIds: st.quickMemberIds,
    folderPaths: st.folders.map((f) => f.path),
    labels: labelNames(),
    onRemove: () => setRemoveOpen(true),
  });
  return (
    <>
      <ContextMenu items={items} className={className}>
        {children}
      </ContextMenu>
      {removeOpen && targets.length > 0 && (
        <RemoveDialog
          count={targets.length}
          onClose={() => setRemoveOpen(false)}
          onConfirm={() => {
            void store.removePhotos(targets.map((p) => p.id));
            setRemoveOpen(false);
          }}
          onDelete={() => {
            void store.deleteFromDisk(targets.map((p) => p.id));
            setRemoveOpen(false);
          }}
        />
      )}
    </>
  );
}
