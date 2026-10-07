// ui/shortcut-registry - curated shortcut editor actions and dispatch

import { commands } from "../commands";
import type { ArtisanStore, Document, ShortcutBinding } from "../engine";
import { formatShortcutBinding, normalizeShortcutBinding, shortcutBindingsEqual, shortcutBindingId } from "../engine";
import { fileCommands } from "../io/commands";

export interface ShortcutAction {
  id: string;
  section: string;
  label: string;
  defaultBinding: ShortcutBinding;
  alternatives?: ShortcutBinding[];
  run: (store: ArtisanStore) => void;
}

const b = (key: string, modifiers: ShortcutBinding["modifiers"]): ShortcutBinding =>
  normalizeShortcutBinding({ key, modifiers });

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "file.save", section: "File", label: "Save", defaultBinding: b("s", ["meta"]), run: (store) => void fileCommands.save(store) },
  // ⇧⌘S was an alternative binding for Save; now that Save writes in place it is
  // Save As, matching every other app.
  { id: "file.save-as", section: "File", label: "Save As…", defaultBinding: b("s", ["meta", "shift"]), run: (store) => void fileCommands.saveAs(store) },
  { id: "file.open", section: "File", label: "Open / Import", defaultBinding: b("o", ["meta"]), alternatives: [b("o", ["meta", "alt"])], run: (store) => void fileCommands.open(store) },
  { id: "file.export-svg", section: "File", label: "Export as SVG", defaultBinding: b("e", ["meta"]), alternatives: [b("e", ["meta", "alt"])], run: (store) => fileCommands.exportSvg(store) },
  { id: "file.export-png", section: "File", label: "Export as PNG", defaultBinding: b("e", ["meta", "shift"]), alternatives: [b("e", ["meta", "alt", "shift"])], run: (store) => void fileCommands.exportPng(store) },
  { id: "edit.undo", section: "Edit", label: "Undo", defaultBinding: b("z", ["meta"]), alternatives: [b("z", ["meta", "alt"])], run: (store) => commands.undo(store) },
  { id: "edit.redo", section: "Edit", label: "Redo", defaultBinding: b("z", ["meta", "shift"]), alternatives: [b("y", ["meta"])], run: (store) => commands.redo(store) },
  { id: "edit.cut", section: "Edit", label: "Cut", defaultBinding: b("x", ["meta"]), alternatives: [b("x", ["meta", "alt"])], run: (store) => commands.cut(store) },
  { id: "edit.copy", section: "Edit", label: "Copy", defaultBinding: b("c", ["meta"]), alternatives: [b("c", ["meta", "alt"])], run: (store) => commands.copy(store) },
  { id: "edit.paste", section: "Edit", label: "Paste", defaultBinding: b("v", ["meta"]), alternatives: [b("v", ["meta", "shift"])], run: (store) => commands.paste(store) },
  { id: "edit.duplicate", section: "Edit", label: "Duplicate", defaultBinding: b("d", ["meta"]), alternatives: [b("x", ["meta", "shift"])], run: (store) => commands.duplicate(store) },
  { id: "object.group", section: "Object", label: "Group", defaultBinding: b("g", ["meta"]), alternatives: [b("g", ["meta", "alt"])], run: (store) => commands.group(store) },
  { id: "object.ungroup", section: "Object", label: "Ungroup", defaultBinding: b("g", ["meta", "shift"]), alternatives: [b("g", ["meta", "alt", "shift"])], run: (store) => commands.ungroup(store) },
  { id: "object.clip-mask", section: "Object", label: "Make Clipping Mask", defaultBinding: b("7", ["meta"]), alternatives: [b("7", ["meta", "shift"])], run: (store) => commands.makeClipMask(store) },
  { id: "object.release-clip-mask", section: "Object", label: "Release Clipping Mask", defaultBinding: b("7", ["meta", "alt"]), alternatives: [b("7", ["meta", "alt", "shift"])], run: (store) => commands.releaseClipMask(store) },
  { id: "object.compound-path", section: "Object", label: "Make Compound Path", defaultBinding: b("8", ["meta"]), alternatives: [b("8", ["meta", "shift"])], run: (store) => commands.makeCompoundPath(store) },
  { id: "object.release-compound-path", section: "Object", label: "Release Compound Path", defaultBinding: b("8", ["meta", "alt"]), alternatives: [b("8", ["meta", "alt", "shift"])], run: (store) => commands.releaseCompoundPath(store) },
  { id: "object.lock", section: "Object", label: "Lock Selection", defaultBinding: b("2", ["meta"]), alternatives: [b("2", ["meta", "shift"])], run: (store) => commands.lockSelection(store) },
  { id: "object.unlock-all", section: "Object", label: "Unlock All", defaultBinding: b("2", ["meta", "alt"]), alternatives: [b("2", ["meta", "alt", "shift"])], run: (store) => commands.unlockAll(store) },
  { id: "object.hide", section: "Object", label: "Hide Selection", defaultBinding: b("3", ["meta"]), alternatives: [b("3", ["meta", "shift"])], run: (store) => commands.hideSelection(store) },
  { id: "object.show-all", section: "Object", label: "Show All", defaultBinding: b("3", ["meta", "alt"]), alternatives: [b("3", ["meta", "alt", "shift"])], run: (store) => commands.showAll(store) },
  { id: "object.join", section: "Object", label: "Join", defaultBinding: b("j", ["meta"]), alternatives: [b("j", ["meta", "alt"])], run: (store) => commands.join(store) },
  { id: "view.zoom-in", section: "View", label: "Zoom In", defaultBinding: b("=", ["meta"]), alternatives: [b("+", ["meta"])], run: (store) => commands.zoomIn(store) },
  { id: "view.zoom-out", section: "View", label: "Zoom Out", defaultBinding: b("-", ["meta"]), alternatives: [b("-", ["meta", "alt"])], run: (store) => commands.zoomOut(store) },
  { id: "view.fit-artboard", section: "View", label: "Fit Artboard", defaultBinding: b("0", ["meta"]), alternatives: [b("0", ["meta", "shift"])], run: (store) => commands.zoomFit(store) },
  { id: "view.actual-size", section: "View", label: "Actual Size", defaultBinding: b("1", ["meta"]), alternatives: [b("1", ["meta", "alt"])], run: (store) => commands.zoomActual(store) },
];

export const shortcutBindingFromEvent = (event: KeyboardEvent): ShortcutBinding =>
  normalizeShortcutBinding({
    key: event.key,
    modifiers: [
      ...(event.metaKey || event.ctrlKey ? ["meta"] as const : []),
      ...(event.altKey ? ["alt"] as const : []),
      ...(event.shiftKey ? ["shift"] as const : []),
    ],
  });

const overrideFor = (doc: Document, actionId: string) =>
  (doc.shortcuts?.overrides ?? []).find((override) => override.actionId === actionId);

export const resolvedShortcutBinding = (doc: Document, action: ShortcutAction): ShortcutBinding | null => {
  const override = overrideFor(doc, action.id);
  if (override?.enabled === false) return null;
  return override?.binding ? normalizeShortcutBinding(override.binding) : action.defaultBinding;
};

export const shortcutChoiceValue = (binding: ShortcutBinding): string =>
  `binding:${shortcutBindingId(binding)}`;

export const shortcutChoiceLabel = (binding: ShortcutBinding): string =>
  formatShortcutBinding(binding);

export const shortcutChoiceBindings = (action: ShortcutAction): ShortcutBinding[] => {
  const out = [action.defaultBinding, ...(action.alternatives ?? [])];
  const seen = new Set<string>();
  return out.filter((binding) => {
    const id = shortcutBindingId(binding);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

export const handleRegisteredShortcut = (event: KeyboardEvent, store: ArtisanStore): boolean => {
  const doc = store.getState().doc;
  const eventBinding = shortcutBindingFromEvent(event);

  for (const action of SHORTCUT_ACTIONS) {
    const active = resolvedShortcutBinding(doc, action);
    if (active && shortcutBindingsEqual(eventBinding, active)) {
      event.preventDefault();
      action.run(store);
      return true;
    }
    if (shortcutBindingsEqual(eventBinding, action.defaultBinding) && (!active || !shortcutBindingsEqual(active, action.defaultBinding))) {
      event.preventDefault();
      return true;
    }
  }

  return false;
};
